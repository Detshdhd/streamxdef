/* ─── Motor de remasterización en tiempo real (WebGL2, 3 pases) ───
 *
 * Estilo procesador de TV: cada frame del <video> (o miniatura) pasa por:
 *
 *   PASE 1 · DEBLOCK/DENOISE (a resolución fuente)
 *     Bilateral 3x3 que preserva bordes: elimina el ruido de compresión
 *     y los bloques MPEG sin tocar los bordes reales.
 *
 *   PASE 2 · UPSCALE DIRIGIDO POR BORDES (a resolución de pantalla)
 *     Bilineal con guía de luma: los 4 taps del cuadrado se re-ponderan
 *     según su distancia al luma local — los taps del MISMO lado de un
 *     borde dominan. Reconstruye bordes definidos sin cruzarlos
 *     (sin blur, sin ringing, sin halos).
 *
 *   PASE 3 · TEXTURA + REMASTER HDR-PERCEPTUAL
 *     Sharpening con tope de rango (cero halos) + grade adaptativo por
 *     análisis de escena: lift de sombras, contraste S y vibrance —
 *     parámetros calculados en JS desde un muestreo 16x16 del frame
 *     (readPixels de 1KB cada ~500ms). Es la versión perceptual de la
 *     "remasterización HDR": colores más vivos y contraste marcado.
 *
 * Todo corre en GPU en tiempo real. Sin redes neuronales (un modelo SR
 * real pesa decenas de MB y no cabe en 60fps en hardware mixto) — pero
 * cada pase implementa la técnica que la IA de las TVs aplica, y el
 * análisis de escena es real, no decorativo.
 */

const VERT_SRC = `#version 300 es
in vec2 aPos;
out vec2 vUv;
uniform vec4 uRect; // xy centro en clip space, zw semi-tamaño
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos * uRect.zw + uRect.xy, 0.0, 1.0);
}`;

/* ── PASE 1: deblock/denoise con preservación de bordes ── */
const FRAG_DEBLOCK_SRC = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uDenoise;

void main() {
  vec3 c = texture(uTex, vUv).rgb;
  vec3 n[8] = vec3[8](
    texture(uTex, vUv + vec2( 0.0,  uTexel.y)).rgb,
    texture(uTex, vUv + vec2( 0.0, -uTexel.y)).rgb,
    texture(uTex, vUv + vec2( uTexel.x, 0.0)).rgb,
    texture(uTex, vUv + vec2(-uTexel.x, 0.0)).rgb,
    texture(uTex, vUv + vec2( uTexel.x,  uTexel.y)).rgb,
    texture(uTex, vUv + vec2(-uTexel.x,  uTexel.y)).rgb,
    texture(uTex, vUv + vec2( uTexel.x, -uTexel.y)).rgb,
    texture(uTex, vUv + vec2(-uTexel.x, -uTexel.y)).rgb
  );
  // Bilateral: los vecinos del MISMO lado de un borde dominan; el ruido
  // de compresión (bloques 8x8, mosquito noise) se promedia fuera.
  vec3 sum = c;
  float wsum = 1.0;
  for (int i = 0; i < 8; i++) {
    float dist = dot(abs(n[i] - c), vec3(0.3333));
    float w = exp(-dist * dist * 42.0);
    sum += n[i] * w;
    wsum += w;
  }
  vec3 smoothed = sum / wsum;
  outColor = vec4(mix(c, smoothed, uDenoise), 1.0);
}`;

/* ── PASE 2: upscale dirigido por bordes ── */
const FRAG_EDGEUPSCALE_SRC = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uSrcSize;

void main() {
  vec2 texel = 1.0 / uSrcSize;
  vec2 p = vUv * uSrcSize - 0.5;
  vec2 b = floor(p);
  vec2 f = p - b;

  vec3 c00 = texture(uTex, (b + vec2(0.5, 0.5)) * texel).rgb;
  vec3 c10 = texture(uTex, (b + vec2(1.5, 0.5)) * texel).rgb;
  vec3 c01 = texture(uTex, (b + vec2(0.5, 1.5)) * texel).rgb;
  vec3 c11 = texture(uTex, (b + vec2(1.5, 1.5)) * texel).rgb;

  float w00 = (1.0 - f.x) * (1.0 - f.y);
  float w10 = f.x * (1.0 - f.y);
  float w01 = (1.0 - f.x) * f.y;
  float w11 = f.x * f.y;

  float l00 = dot(c00, vec3(0.3333));
  float l10 = dot(c10, vec3(0.3333));
  float l01 = dot(c01, vec3(0.3333));
  float l11 = dot(c11, vec3(0.3333));

  float lc = (l00 * w00 + l10 * w10 + l01 * w01 + l11 * w11)
           / max(w00 + w10 + w01 + w11, 1e-5);

  // Guía de borde: los taps del mismo lado del borde dominan.
  float s2 = 0.006;
  w00 *= exp(-(l00 - lc) * (l00 - lc) / s2);
  w10 *= exp(-(l10 - lc) * (l10 - lc) / s2);
  w01 *= exp(-(l01 - lc) * (l01 - lc) / s2);
  w11 *= exp(-(l11 - lc) * (l11 - lc) / s2);

  float ws = w00 + w10 + w01 + w11;
  vec3 col = (c00 * w00 + c10 * w10 + c01 * w01 + c11 * w11) / max(ws, 1e-5);
  outColor = vec4(col, 1.0);
}`;

/* ── PASE 3: textura (sharpen sin halos) + remaster HDR-perceptual ── */
const FRAG_GRADE_SRC = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uSharpen;
uniform float uVibrance;
uniform float uContrast;
uniform float uLift;

void main() {
  vec4 c = texture(uTex, vUv);
  vec3 col = c.rgb;

  // Remaster HDR-perceptual (parámetros del análisis de escena):
  col = col + uLift * (1.0 - col);              // lift suave de sombras
  col = clamp((col - 0.5) * uContrast + 0.5, 0.0, 1.0); // contraste S
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float sat = max(max(col.r, col.g), col.b) - min(min(col.r, col.g), col.b);
  col = mix(vec3(luma), col, 1.0 + uVibrance * (1.0 - sat)); // vibrance
  col = clamp(col, 0.0, 1.0);

  // Sharpening con tope de rango — sin halos, sin bordes artificiales.
  vec3 n = texture(uTex, vUv + vec2(0.0, -uTexel.y)).rgb;
  vec3 s = texture(uTex, vUv + vec2(0.0,  uTexel.y)).rgb;
  vec3 e = texture(uTex, vUv + vec2( uTexel.x, 0.0)).rgb;
  vec3 w = texture(uTex, vUv + vec2(-uTexel.x, 0.0)).rgb;
  vec3 blur = (n + s + e + w) * 0.25;
  vec3 sharp = col + (col - blur) * uSharpen;
  vec3 mn = min(col, min(min(n, s), min(e, w)));
  vec3 mx = max(col, max(max(n, s), max(e, w)));
  col = clamp(sharp, mn, mx);

  outColor = vec4(col, c.a);
}`;

export interface UpscaleRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RemasterParams {
  denoise: number;   // 0..1 deblock
  sharpen: number;   // 0..1
  vibrance: number;  // 0..0.3
  contrast: number;  // 1.0..1.15
  lift: number;      // 0..0.08
}

export const DEFAULT_REMASTER: RemasterParams = {
  denoise: 0.6,
  sharpen: 0.28,
  vibrance: 0.14,
  contrast: 1.04,
  lift: 0.015,
};

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

export interface SceneStats {
  avgLuma: number;
  sat: number;
  contrast: number;
}

/** Deriva parámetros del grade desde las estadísticas de la escena. */
export function paramsFromScene(s: SceneStats): RemasterParams {
  return {
    denoise: DEFAULT_REMASTER.denoise,
    sharpen: DEFAULT_REMASTER.sharpen,
    // Escenas oscuras → lift de sombras; planas → más contraste;
    // poco saturadas → más vibrance. Todo acotado para no procesar de más.
    lift: Math.min(0.06, Math.max(0.0, (0.42 - s.avgLuma) * 0.22)),
    contrast: Math.min(1.10, Math.max(1.0, 1.0 + (0.22 - s.contrast) * 0.18)),
    vibrance: Math.min(0.28, Math.max(0.05, 0.28 - s.sat * 0.9)),
  };
}

export class GpuUpscaler {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private progDeblock: WebGLProgram | null = null;
  private progEdge: WebGLProgram | null = null;
  private progGrade: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private srcTex: WebGLTexture | null = null;
  private fboA: WebGLFramebuffer | null = null;   // deblock (res fuente)
  private fboATex: WebGLTexture | null = null;
  private fboAW = 0;
  private fboAH = 0;
  private fboB: WebGLFramebuffer | null = null;   // upscale (res destino)
  private fboBTex: WebGLTexture | null = null;
  private fboBW = 0;
  private fboBH = 0;
  private srcW = 0;
  private srcH = 0;
  private tinyFbo: WebGLFramebuffer | null = null;  // análisis 16x16
  private tinyTex: WebGLTexture | null = null;
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

    this.progDeblock = link(gl, VERT_SRC, FRAG_DEBLOCK_SRC);
    this.progEdge = link(gl, VERT_SRC, FRAG_EDGEUPSCALE_SRC);
    this.progGrade = link(gl, VERT_SRC, FRAG_GRADE_SRC);
    if (!this.progDeblock || !this.progEdge || !this.progGrade) { this.failed = true; return; }

    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    if (!vao || !buf) { this.failed = true; return; }
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.progDeblock, 'aPos');
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

  private ensureTex(
    current: WebGLTexture | null,
    w: number,
    h: number,
    curW: number,
    curH: number,
  ): { tex: WebGLTexture; w: number; h: number } {
    const gl = this.gl!;
    let tex = current;
    if (!tex) {
      tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      return { tex, w, h };
    }
    if (w !== curW || h !== curH) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    return { tex, w, h };
  }

  private uploadSrc(src: TexImageSource, srcW: number, srcH: number): void {
    const gl = this.gl!;
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
  }

  /** Análisis de escena: baja el frame a 16x16 y mide luma/sat/contraste. */
  analyze(src: TexImageSource, srcW: number, srcH: number): SceneStats | null {
    const gl = this.gl;
    if (!gl || this.failed) return null;
    try {
      this.uploadSrc(src, srcW, srcH);
      const T = 16;
      if (!this.tinyFbo) {
        this.tinyTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.tinyTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, T, T, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this.tinyFbo = gl.createFramebuffer();
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.tinyFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tinyTex, 0);
      gl.viewport(0, 0, T, T);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
      gl.useProgram(this.progDeblock);
      gl.bindVertexArray(this.vao);
      gl.uniform1i(this.uni(this.progDeblock!, 'uTex'), 0);
      gl.uniform2f(this.uni(this.progDeblock!, 'uTexel'), 1 / srcW, 1 / srcH);
      gl.uniform1f(this.uni(this.progDeblock!, 'uDenoise'), 0.0);
      gl.uniform4f(this.uni(this.progDeblock!, 'uRect'), 0, 0, 1, 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);

      const px = new Uint8Array(T * T * 4);
      gl.readPixels(0, 0, T, T, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      let sumL = 0, sumL2 = 0, sumS = 0;
      const n = T * T;
      for (let i = 0; i < n; i++) {
        const r = px[i * 4] / 255, g = px[i * 4 + 1] / 255, b = px[i * 4 + 2] / 255;
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        sumL += l;
        sumL2 += l * l;
        sumS += Math.max(r, g, b) - Math.min(r, g, b);
      }
      const avgL = sumL / n;
      const contrast = Math.sqrt(Math.max(0, sumL2 / n - avgL * avgL));
      return { avgLuma: avgL, sat: sumS / n, contrast };
    } catch {
      return null;
    }
  }

  /**
   * Pipeline completo: deblock → upscale dirigido por bordes → grade.
   * Con `rect`, dibuja SOLO ese rectángulo del canvas (letterbox del video).
   */
  render(
    src: TexImageSource,
    srcW: number,
    srcH: number,
    dstW: number,
    dstH: number,
    params: RemasterParams,
    rect?: UpscaleRect,
  ): boolean {
    const gl = this.gl;
    const progDeblock = this.progDeblock;
    const progEdge = this.progEdge;
    const progGrade = this.progGrade;
    if (!gl || this.failed || !progDeblock || !progEdge || !progGrade || !this.vao) return false;
    if (!srcW || !srcH || !dstW || !dstH) return false;

    try {
      if (!rect) {
        if (this.canvas.width !== dstW || this.canvas.height !== dstH) {
          this.canvas.width = dstW;
          this.canvas.height = dstH;
        }
      }
      const target = rect ?? { x: 0, y: 0, w: dstW, h: dstH };

      this.uploadSrc(src, srcW, srcH);

      // PASE 1: deblock → fboA (resolución fuente)
      const a = this.ensureTex(this.fboATex, srcW, srcH, this.fboAW, this.fboAH);
      this.fboATex = a.tex; this.fboAW = a.w; this.fboAH = a.h;
      if (!this.fboA) this.fboA = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboATex, 0);
      gl.viewport(0, 0, srcW, srcH);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
      gl.useProgram(this.progDeblock);
      gl.bindVertexArray(this.vao);
      gl.uniform1i(this.uni(progDeblock, 'uTex'), 0);
      gl.uniform2f(this.uni(progDeblock, 'uTexel'), 1 / srcW, 1 / srcH);
      gl.uniform1f(this.uni(progDeblock, 'uDenoise'), params.denoise);
      gl.uniform4f(this.uni(progDeblock, 'uRect'), 0, 0, 1, 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);

      // PASE 2: upscale dirigido por bordes → fboB (tamaño del rect)
      const b = this.ensureTex(this.fboBTex, target.w, target.h, this.fboBW, this.fboBH);
      this.fboBTex = b.tex; this.fboBW = b.w; this.fboBH = b.h;
      if (!this.fboB) this.fboB = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboB);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboBTex, 0);
      gl.viewport(0, 0, target.w, target.h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.fboATex);
      gl.useProgram(this.progEdge);
      gl.bindVertexArray(this.vao);
      gl.uniform1i(this.uni(progEdge, 'uTex'), 0);
      gl.uniform2f(this.uni(progEdge, 'uSrcSize'), srcW, srcH);
      gl.uniform4f(this.uni(progEdge, 'uRect'), 0, 0, 1, 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);

      // PASE 3: sharpen + grade → canvas visible
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.fboBTex);
      gl.useProgram(this.progGrade);
      gl.bindVertexArray(this.vao);
      gl.uniform1i(this.uni(progGrade, 'uTex'), 0);
      gl.uniform2f(this.uni(progGrade, 'uTexel'), 1 / target.w, 1 / target.h);
      gl.useProgram(progGrade);
      gl.bindVertexArray(this.vao);
      gl.uniform1i(this.uni(progGrade, 'uTex'), 0);
      gl.uniform2f(this.uni(progGrade, 'uTexel'), 1 / target.w, 1 / target.h);
      gl.uniform1f(this.uni(progGrade, 'uSharpen'), params.sharpen);
      gl.uniform1f(this.uni(progGrade, 'uVibrance'), params.vibrance);
      gl.uniform1f(this.uni(progGrade, 'uContrast'), params.contrast);
      gl.uniform1f(this.uni(progGrade, 'uLift'), params.lift);
      const cw = gl.drawingBufferWidth;
      const ch = gl.drawingBufferHeight;
      const cx = ((target.x + target.w / 2) / cw) * 2 - 1;
      const cy = 1 - ((target.y + target.h / 2) / ch) * 2;
      gl.uniform4f(this.uni(progGrade, 'uRect'), cx, cy, target.w / cw, target.h / ch);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);
      return true;
    } catch {
      this.failed = true;
      return false;
    }
  }
}

/** Instancia compartida (offscreen) para el first paint de imágenes. */
let shared: GpuUpscaler | null = null;

/** Fallback 2D: suavizado de alta calidad. */
function fallback2d(img: HTMLImageElement, dstW: number, dstH: number): HTMLCanvasElement | null {
  try {
    const c = document.createElement('canvas');
    c.width = dstW;
    c.height = dstH;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
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
 * Remasteriza `img` (crossOrigin=anonymous si es cross-origin) al tamaño
 * destino con el pipeline GPU (deblock + upscale por bordes + grade suave).
 * Devuelve el canvas del upscaler compartido — consumir inmediatamente.
 */
export function upscaleImageToCanvas(
  img: HTMLImageElement,
  dstW: number,
  dstH: number,
  sharpen = 0.26,
): HTMLCanvasElement | null {
  if (!dstW || !dstH) return null;
  try {
    if (!shared) shared = new GpuUpscaler();
    if (shared.ok && shared.render(
      img, img.naturalWidth, img.naturalHeight, dstW, dstH,
      { ...DEFAULT_REMASTER, sharpen, denoise: 0.45, vibrance: 0.08, contrast: 1.02, lift: 0.008 },
    )) {
      return shared.canvas;
    }
  } catch { /* tainted canvas, GL caído, etc. */ }
  return fallback2d(img, dstW, dstH);
}
