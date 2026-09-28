'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { upscaleImageToCanvas } from '@/lib/upscale';

interface OptimizedImageProps {
  src: string;
  srcSet?: string;
  sizes?: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  loading?: 'eager' | 'lazy';
  decoding?: 'async' | 'auto' | 'sync';
  onError?: () => void;
  onLoad?: () => void;
  /** Ancho TMDB de la miniatura del first paint (default w92 ≈ 2-6KB) */
  lowWidth?: number;
  /** Prioridad de fetch del <img> final (hero / primeras cards) */
  fetchPriority?: 'high' | 'low' | 'auto';
  /** Fuerza del unsharp del upscale (0..1) */
  sharpen?: number;
}

/**
 * Pipeline de carga en fases con upscale GPU en tiempo real:
 *
 *  1. La miniatura (w92 por defecto, ~2-6KB) se descarga con el lazy-load
 *     NATIVO del navegador (solo al acercarse al viewport) y se pinta ya.
 *  2. Al cargar, se reescala en la GPU (Catmull-Rom + unsharp) a su
 *     resolución natural — el placeholder se ve nítido, no blando/borroso.
 *     "Cargar a menor calidad" no se percibe como peor calidad.
 *  3. En paralelo baja la resolución final y entra con un crossfade corto.
 *     srcSet/sizes solo se aplican en la fase final (antes anulaban la
 *     miniatura: el browser elegía del srcSet e ignoraba el src, y las
 *     cards descargaban miniatura ADEMÁS del srcSet).
 */
export default function OptimizedImage({
  src,
  srcSet,
  sizes,
  alt,
  className,
  style,
  loading = 'lazy',
  decoding = 'async',
  onError,
  onLoad,
  lowWidth = 154,
  fetchPriority,
  sharpen = 0.3,
}: OptimizedImageProps) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [finalSrc, setFinalSrc] = useState<string | null>(null);
  const [finalReady, setFinalReady] = useState(false);
  const [hasError, setHasError] = useState(false);
  // true cuando el thumb mostrado ya es la versión GPU (evita re-proceso
  // cuando el <img> dispara load otra vez por el swap a dataURL).
  const upgradedRef = useRef(false);
  const thumbShownRef = useRef(false);

  const lowResSrc = useMemo(() => toLowRes(src, lowWidth), [src, lowWidth]);

  // Reset al cambiar de contenido (misma instancia, item distinto).
  useEffect(() => {
    upgradedRef.current = false;
    thumbShownRef.current = false;
    setThumbUrl(null);
    setFinalSrc(null);
    setFinalReady(false);
    setHasError(false);
  }, [src, lowResSrc]);

  /** onLoad del <img> de la miniatura: upscale GPU + arrancar la final. */
  const handleThumbLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    if (upgradedRef.current) return;
    upgradedRef.current = true;
    thumbShownRef.current = true;
    const el = e.currentTarget;
    try {
      const natW = el.naturalWidth || lowWidth;
      const natH = el.naturalHeight || Math.round(lowWidth * 1.5);
      const canvas = upscaleImageToCanvas(el, natW, natH, sharpen);
      const url = canvasToUrl(canvas);
      setThumbUrl(url || lowResSrc);
    } catch {
      setThumbUrl(lowResSrc);
    }
    // Con el first paint asegurado, baja la resolución final en paralelo.
    startFinal();
  };

  /** Precarga + swap a la resolución final. */
  const startFinal = () => {
    if (finalSrc) return;
    const high = new Image();
    high.decoding = 'async';
    high.onload = () => {
      setFinalSrc(src);
      // Un frame con opacity 0 para que el crossfade anime desde el thumb.
      requestAnimationFrame(() => requestAnimationFrame(() => setFinalReady(true)));
      onLoad?.();
    };
    high.onerror = () => {
      // Sin la final nos quedamos con la miniatura upscaled; solo es un
      // error real si tampoco hubo miniatura.
      if (!thumbShownRef.current) { setHasError(true); onError?.(); }
    };
    high.src = src;
  };

  if (hasError || !src) return null;

  const finalPhase = !!finalSrc;

  return (
    <>
      {!finalPhase && (
        <img
          src={thumbUrl || lowResSrc}
          alt={alt}
          className={className}
          style={{ ...style, opacity: 1 }}
          loading={loading}
          decoding={decoding}
          // El dataURL re-decodifica al instante; el guard en el handler
          // evita procesar ese segundo load.
          onLoad={handleThumbLoad}
          onError={() => {
            // La miniatura falló → intentar directo con la final.
            if (!thumbShownRef.current) startFinal();
          }}
          // arranca la final apenas la miniatura ya se mostró (load o cache)
          ref={(el) => {
            if (el && el.complete && el.naturalWidth > 0 && !upgradedRef.current) {
              handleThumbLoad({ currentTarget: el } as React.SyntheticEvent<HTMLImageElement>);
            }
          }}
        />
      )}
      {finalPhase && (
        <img
          src={finalSrc}
          srcSet={srcSet}
          sizes={sizes}
          alt={alt}
          className={className}
          style={{ ...style, transition: 'opacity 0.3s ease', opacity: finalReady ? 1 : 0 }}
          loading={loading}
          decoding={decoding}
          fetchPriority={fetchPriority}
          onError={onError}
        />
      )}
    </>
  );
}

/** Convierte un URL TMDB en su versión de ancho `lowWidth`. */
function toLowRes(src: string, lowWidth: number): string {
  if (!src) return src;
  return src.replace(/\/t\/p\/[^/]+\//, `/t/p/w${lowWidth}/`);
}

/** Canvas → dataURL (webp con fallback jpeg). Solo se usa una vez por card. */
function canvasToUrl(canvas: HTMLCanvasElement | null): string | null {
  if (!canvas || !canvas.width || !canvas.height) return null;
  try {
    return canvas.toDataURL('image/webp', 0.85);
  } catch {
    try { return canvas.toDataURL('image/jpeg', 0.85); } catch { return null; }
  }
}
