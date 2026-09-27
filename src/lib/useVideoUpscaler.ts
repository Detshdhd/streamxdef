'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { GpuUpscaler } from '@/lib/upscale';

/** Fuerza del unsharp aplicado al video upscaled (0..1). */
const SHARPEN = 0.32;
/** El upscale solo aporta cuando el stream queda al menos 15% por debajo. */
const BENEFIT_SCALE = 1.15;
/** Cap de canvas en píxeles dispositivo — no procesar más de 1080p-ish. */
const MAX_CANVAS_W = 1920;
const MAX_CANVAS_H = 1080;
/** Presupuesto de frame: si el draw medio supera esto, apagamos. */
const MAX_DRAW_MS = 8;
/** Frames consecutivos malos antes del auto-apagado (~1s a 60fps). */
const BAD_FRAME_LIMIT = 50;

export interface VideoUpscaler {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** true cuando el canvas GPU está reemplazando visualmente al <video>. */
  engaged: boolean;
  /** true cuando la guarda de rendimiento lo apagó para esta sesión. */
  autoDisabled: boolean;
}

/**
 * Upscaler de video en tiempo real: cada frame del <video> se pasa por la
 * GPU (Catmull-Rom + unsharp) hacia un canvas superpuesto cuando el stream
 * actual está por debajo de la resolución de la pantalla — exactamente lo
 * que pasa mientras el ABR hace la rampa desde calidad baja, y con
 * streams que solo existen en 480p/720p reproducidos en ventana grande.
 * Es el par de "empezar en calidad baja para cargar rápido": el arranque
 * instantáneo no se ve peor porque la GPU lo reescala con nitidez.
 *
 * Guardas de seguridad:
 *  - Si el draw cuesta demasiado (GPU lenta), se auto-desactiva y el
 *    <video> nativo vuelve a verse — jamás rompemos la reproducción.
 *  - Solo se activa cuando hay beneficio real (scale > 1.15x).
 *  - Nunca toca el audio ni el elemento <video>: solo lo dibuja.
 */
export function useVideoUpscaler(
  videoRef: RefObject<HTMLVideoElement | null>,
  userEnabled: boolean,
): VideoUpscaler {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [engaged, setEngaged] = useState(false);
  const [autoDisabled, setAutoDisabled] = useState(false);

  useEffect(() => {
    if (!userEnabled || autoDisabled) {
      setEngaged(false);
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;

    const upscaler = new GpuUpscaler(canvas);
    if (!upscaler.ok) {
      setAutoDisabled(true);
      return;
    }

    let raf = 0;
    let running = true;
    let badFrames = 0;
    let drawEma = 0;
    let engagedNow = false;

    const resizeCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = canvas.clientWidth || 1280;
      const cssH = canvas.clientHeight || 720;
      canvas.width = Math.min(MAX_CANVAS_W, Math.max(2, Math.round(cssW * dpr)));
      canvas.height = Math.min(MAX_CANVAS_H, Math.max(2, Math.round(cssH * dpr)));
    };

    const tick = () => {
      if (!running) return;
      raf = requestAnimationFrame(tick);
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;

      const cw = canvas.width;
      const ch = canvas.height;
      if (cw < 4 || ch < 4) resizeCanvas();

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const scale = Math.min(cw / vw, ch / vh);

      // ¿Hay beneficio? Fuera de él, el video nativo ya se ve 1:1.
      if (scale < BENEFIT_SCALE) {
        if (engagedNow) { engagedNow = false; setEngaged(false); }
        return;
      }

      const fw = Math.max(2, Math.round(vw * scale));
      const fh = Math.max(2, Math.round(vh * scale));
      const rect = { x: (cw - fw) / 2, y: (ch - fh) / 2, w: fw, h: fh };

      const t0 = performance.now();
      const ok = upscaler.render(video, vw, vh, fw, fh, SHARPEN, rect);
      const dt = performance.now() - t0;

      if (!ok) { setAutoDisabled(true); running = false; return; }

      // Guarda de rendimiento: EMA del tiempo de draw.
      drawEma = drawEma === 0 ? dt : drawEma * 0.9 + dt * 0.1;
      if (dt > 14 || drawEma > MAX_DRAW_MS) badFrames += 1;
      else if (badFrames > 0) badFrames -= 1;
      if (badFrames > BAD_FRAME_LIMIT) {
        setAutoDisabled(true);
        engagedNow = false;
        setEngaged(false);
        running = false;
        return;
      }

      if (!engagedNow) { engagedNow = true; setEngaged(true); }
    };

    resizeCanvas();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resizeCanvas) : null;
    ro?.observe(canvas);
    raf = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      if (engagedNow) setEngaged(false);
    };
  }, [userEnabled, autoDisabled, videoRef]);

  return { canvasRef, engaged, autoDisabled };
}
