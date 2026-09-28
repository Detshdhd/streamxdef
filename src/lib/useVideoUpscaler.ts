'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { GpuUpscaler, paramsFromScene, DEFAULT_REMASTER, type RemasterParams } from '@/lib/upscale';

/** Presupuesto de frame: si el draw medio supera esto, apagamos. */
const MAX_DRAW_MS = 8;
/** Frames consecutivos malos antes del auto-apagado (~1s a 60fps). */
const BAD_FRAME_LIMIT = 50;
/** Frecuencia del análisis de escena (ms) que alimenta el grade. */
const ANALYZE_EVERY_MS = 600;
/** Cap de canvas en píxeles dispositivo. */
const MAX_CANVAS_W = 1920;
const MAX_CANVAS_H = 1080;

export interface VideoUpscaler {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** true cuando el canvas GPU está reemplazando visualmente al <video>. */
  engaged: boolean;
  /** true cuando la guarda de rendimiento lo apagó para esta sesión. */
  autoDisabled: boolean;
}

/**
 * Remasterización en tiempo real estilo procesador de TV (directiva del
 * dueño: SIEMPRE activa): cada frame pasa por deblock → upscale dirigido
 * por bordes → textura + remaster HDR-perceptual, con análisis de escena
 * cada 600ms que ajusta lift/contraste/vibrance. Guardas:
 *  - Si el draw cuesta demasiado (GPU lenta), auto-apagado y vuelve el
 *    <video> nativo — jamás rompe la reproducción.
 *  - El toggle del menú de calidad apaga todo el pipeline.
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
    let params: RemasterParams = { ...DEFAULT_REMASTER };
    let lastAnalyze = 0;

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
      const fw = Math.max(2, Math.round(vw * scale));
      const fh = Math.max(2, Math.round(vh * scale));
      const rect = { x: (cw - fw) / 2, y: (ch - fh) / 2, w: fw, h: fh };

      // Análisis de escena cada ANALYZE_EVERY_MS → parámetros del grade.
      const now = performance.now();
      if (now - lastAnalyze > ANALYZE_EVERY_MS) {
        lastAnalyze = now;
        const stats = upscaler.analyze(video, vw, vh);
        if (stats) params = paramsFromScene(stats);
      }

      const t0 = performance.now();
      const ok = upscaler.render(video, vw, vh, fw, fh, params, rect);
      const dt = performance.now() - t0;

      if (!ok) { setAutoDisabled(true); running = false; return; }

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
