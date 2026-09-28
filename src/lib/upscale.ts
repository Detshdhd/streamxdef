/* ─── GPU Upscaler — Catmull-Rom bicubic + unsharp, en un solo draw ───
 *
 * Un contexto WebGL2 por canvas objetivo:
 *  - Instancia compartida (offscreen) para IMÁGENES: convierte una miniatura
 *    de ~3KB en un first paint nítido (mejor que bilinear y sin el blur del
 *    placeholder clásico).
 *  - Una instancia por canvas visible para VIDEO en tiempo real: cada frame
 *    del <video> se pasa por el shader cuando el stream está por debajo de
 *    la resolución de pantalla (rampa ABR, o streams 480p/720p en 1080p).
 *
 * Si no hay WebGL2 (o el draw falla), `upscaleImageToCanvas` cae a un
 * canvas 2D suavizado — el caller nunca se queda sin placeholder.
 */

const VERT_SRC = `#version 300 es
in vec2 aPos;
out vec2 vUv;
uniform vec4 uRect; // xy centro en clip space, zw semi-tamaño
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos * uRect.zw + uRect.xy, 0.0, 1.0);
}`;

// Kernel Mitchell-Netravali (B=1/3, C=1/3) — el estándar de cine para
// reescalar. A diferencia del Catmull-Rom, sus lóbulos negativos son
// mínimos: no "ringea" en bordes duros (parte de los "bordes horribles"
// venía de ahí, no solo del sharpen).
const FRAG_UPSCALE_SRC = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uSrcSize;

// Mitchell-Netravali B=1/3 C=1/3, evaluada en |x|
float mitchellK(float x) {
  float ax = abs(x);
  float x2 = ax * ax;
  float x3 = x2 * ax;
  if (ax < 1.0) return (7.0 * x3 - 12.0 * x2 + 5.3333333) / 6.0;
  if (ax < 2.0) return (-2.3333333 * x3 + 12.0 * x2 - 20.0 * x + 10.6666667) / 6.0;
  return 0.0;
}

vec4 mitchellWeights(float f) {
  return vec4(mitchellK(f + 1.0), mitchellK(f), mitchellK(1.0 - f), mitchellK(2.0 - f));
}

vec4 mitchellRom(vec2 uv) {
  vec2 texel = 1.0 / uSrcSize;
  vec2 st = uv / texel - 0.5;
  vec2 i = floor(st);
  vec2 f = st - i;
  vec4 wx = mitchellWeights(f.x);
  vec4 wy = mitchellWeights(f.y);
  vec4 sum = vec4(0.0);
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      vec2 pos = (i + vec2(float(x) - 1.0, float(y) - 1.0) + 0.5) * texel;
      sum += texture(uTex, pos) * (wx[x] * wy[y]);
    }
  }
  return sum;
}

void main() { outColor = mitchellRom(vUv); }`;

// Unsharp CON TOPE DE RANGO (la esencia del RCAS de FSR, sin los constantes
// mágicos): el resultado afilado se recorta al rango natural [min,max] del
// vecindario 3x3 — matemáticamente IMPOSIBLE que genere halos u overshoot.
// La nitidez que sobra (el overshoot que pintaba "bordes horribles
// artificiales") simplemente no puede existir.
const FRAG_SHARPEN_SRC = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uAmount;

void main() {
  vec4 c = texture(uTex, vUv);
  vec3 n = texture(uTex, vUv + vec2(0.0, -uTexel.y)).rgb;
  vec3 s = texture(uTex, vUv + vec2(0.0,  uTexel.y)).rgb;
  vec3 e = texture(uTex, vUv + vec2( uTexel.x, 0.0)).rgb;
  vec3 w = texture(uTex, vUv + vec2(-uTexel.x, 0.0)).rgb;
  vec3 blur = (n + s + e + w) * 0.25;
  vec3 sharp = c.rgb + (c.rgb - blur) * uAmount;
  // Halo protection: clamp al rango natural del vecindario.
  vec3 mn = min(c.rgb, min(min(n, s), min(e, w)));
  vec3 mx = max(c.rgb, max(max(n, s), max(e, w)));
  outColor = vec4(clamp(sharp, mn, mx), c.a);
}`;

export interface UpscaleRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram | null {
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const p = gl.createProgram();
  if (!p) return null;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    gl.deleteProgram(p);
    return null;
  }
  return p;
}

export class GpuUpscaler {
  /** Canvas donde vive el contexto GL y donde queda el resultado del render. */
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private progUp: WebGLProgram | null = null;
  private progSharp: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private srcTex: WebGLTexture | null = null;
  private fbo: WebGLFramebuffer | null = null;
  private fboTex: WebGLTexture | null = null;
  private fboW = 0;
  private fboH = 0;
  private srcW = 0;
  private srcH = 0;
  private uniCache = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  private failed = false;

  constructor(target?: HTMLCanvasElement) {
    this.canvas = target ?? document.createElement('canvas');
    try {
      this.init();
    } catch {
      this.failed = true;
    }
  }

  get ok(): boolean {
    return !this.failed && !!this.gl;
  }

  private init(): void {
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    });
    if (!gl) { this.failed = true; return; }
    this.gl = gl;

    this.progUp = link(gl, VERT_SRC, FRAG_UPSCALE_SRC);
    this.progSharp = link(gl, VERT_SRC, FRAG_SHARPEN_SRC);
    if (!this.progUp || !this.progSharp) { this.failed = true; return; }

    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    if (!vao || !buf) { this.failed = true; return; }
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.progUp, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.vao = vao;

    const tex = gl.createTexture();
    if (!tex) { this.failed = true; return; }
    this.srcTex = tex;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  private uni(prog: WebGLProgram, name: string): WebGLUniformLocation | null {
    let m = this.uniCache.get(prog);
    if (!m) { m = new Map(); this.uniCache.set(prog, m); }
    if (!m.has(name)) m.set(name, this.gl!.getUniformLocation(prog, name));
    return m.get(name)!;
  }

  /**
   * Renderiza `src` (img/canvas/video) escalado a dstW×dstH con Catmull-Rom
   * + unsharp. Con `rect`, dibuja SOLO ese rectángulo del canvas (letterbox
   * del video); sin rect, llena el canvas completo.
   */
  render(
    src: TexImageSource,
    srcW: number,
    srcH: number,
    dstW: number,
    dstH: number,
    sharpen: number,
    rect?: UpscaleRect,
  ): boolean {
    const gl = this.gl;
    if (!gl || !this.progUp || !this.progSharp || !this.vao || this.failed) return false;
    if (!srcW || !srcH || !dstW || !dstH) return false;

    try {
      // Canvas destino: instancia propia de imágenes lo redimensiona; para
      // video el canvas es el visible y lo controla el hook.
      if (!rect) {
        if (this.canvas.width !== dstW || this.canvas.height !== dstH) {
          this.canvas.width = dstW;
          this.canvas.height = dstH;
        }
      }

      // 1) Subir la fuente. FLIP_Y porque el origen de video/imagen es
      // top-down y GL es bottom-up — con esto el quad sale derecho.
      gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      if (srcW !== this.srcW || srcH !== this.srcH) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
        this.srcW = srcW;
        this.srcH = srcH;
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
      }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

      const target = rect ?? { x: 0, y: 0, w: dstW, h: dstH };

      if (sharpen > 0.01) {
        // 2a) Upscale → FBO intermedio al tamaño del rect.
        this.ensureFbo(target.w, target.h);
        // ensureFbo deja el FBO-texture en la unidad activa; hay que volver
        // a colgar la fuente o el draw lee y escribe la misma textura
        // (GL_INVALID_OPERATION: feedback loop).
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.viewport(0, 0, target.w, target.h);
        this.drawPass(this.progUp, { uTexUnit: 0 }, 'full');
        // 2b) Sharpen → canvas visible.
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
        this.drawPass(this.progSharp, { uTexUnit: 0, texel: [1 / target.w, 1 / target.h], amount: sharpen }, rect ?? 'full');
      } else {
        // Sin sharpen: upscale directo al canvas.
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        this.drawPass(this.progUp, { uTexUnit: 0 }, rect ?? 'full');
      }
      return true;
    } catch {
      this.failed = true;
      return false;
    }
  }

  // Helpers internos tipados vía declaración de módulo abajo.
  private ensureFbo(w: number, h: number): void {
    const gl = this.gl!;
    if (this.fbo && this.fboW === w && this.fboH === h) return;
    if (this.fboTex) gl.deleteTexture(this.fboTex);
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    this.fboTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
    this.fboW = w;
    this.fboH = h;
  }

  private drawPass(
    prog: WebGLProgram,
    uniforms: { uTexUnit: number; texel?: [number, number]; amount?: number },
    rect: UpscaleRect | 'full',
  ): void {
    const gl = this.gl!;
    const cw = gl.drawingBufferWidth;
    const ch = gl.drawingBufferHeight;
    gl.useProgram(prog);
    gl.bindVertexArray(this.vao);
    gl.uniform1i(this.uni(prog, 'uTex'), uniforms.uTexUnit);
    if (prog === this.progUp) {
      gl.uniform2f(this.uni(prog, 'uSrcSize'), this.srcW, this.srcH);
    } else {
      gl.uniform2f(this.uni(prog, 'uTexel'), uniforms.texel![0], uniforms.texel![1]);
      gl.uniform1f(this.uni(prog, 'uAmount'), uniforms.amount!);
    }
    if (rect === 'full') {
      gl.uniform4f(this.uni(prog, 'uRect'), 0, 0, 1, 1);
    } else {
      // Coordenadas clip: GL origen abajo-izquierda, canvas origen arriba.
      const cx = ((rect.x + rect.w / 2) / cw) * 2 - 1;
      const cy = 1 - ((rect.y + rect.h / 2) / ch) * 2;
      gl.uniform4f(this.uni(prog, 'uRect'), cx, cy, rect.w / cw, rect.h / ch);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }
}

/** Instancia compartida (offscreen) para el first paint de imágenes. */
let shared: GpuUpscaler | null = null;

/** Fallback 2D: suavizado de alta calidad (+contraste leve). */
function fallback2d(img: HTMLImageElement, dstW: number, dstH: number): HTMLCanvasElement | null {
  try {
    const c = document.createElement('canvas');
    c.width = dstW;
    c.height = dstH;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Doble paso (mitad → final) aproxima el resultado bicúbico.
    if (dstW > img.width * 3) {
      const mid = document.createElement('canvas');
      mid.width = Math.max(1, Math.floor(dstW / 2));
      mid.height = Math.max(1, Math.floor(dstH / 2));
      const mctx = mid.getContext('2d');
      if (mctx) {
        mctx.imageSmoothingEnabled = true;
        mctx.imageSmoothingQuality = 'high';
        mctx.drawImage(img, 0, 0, mid.width, mid.height);
        ctx.drawImage(mid, 0, 0, dstW, dstH);
        return c;
      }
    }
    ctx.drawImage(img, 0, 0, dstW, dstH);
    return c;
  } catch {
    return null;
  }
}

/**
 * Escala `img` (crossOrigin=anonymous obligatorio si es cross-origin) a
 * dstW×dstH con la GPU. Devuelve el canvas del upscaler compartido — el
 * caller debe consumirlo (toDataURL/drawImage) inmediatamente.
 */
export function upscaleImageToCanvas(
  img: HTMLImageElement,
  dstW: number,
  dstH: number,
  sharpen = 0.3,
): HTMLCanvasElement | null {
  if (!dstW || !dstH) return null;
  try {
    if (!shared) shared = new GpuUpscaler();
    if (shared.ok && shared.render(img, img.naturalWidth, img.naturalHeight, dstW, dstH, sharpen)) {
      return shared.canvas;
    }
  } catch { /* tainted canvas, GL caído, etc. */ }
  return fallback2d(img, dstW, dstH);
}
