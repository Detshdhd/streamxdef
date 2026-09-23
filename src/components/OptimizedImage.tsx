'use client';

import { useState, useEffect } from 'react';

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
  /** Override del ancho de la miniatura usada como first paint (default w185) */
  lowWidth?: number;
}

/**
 * Carga la imagen en dos fases (FSR-style):
 *  1. Primero pinta una versión de baja resolución (w185 por defecto) para
 *     que el usuario vea el contenido al instante.
 *  2. Luego intercambia por la resolución final y usa un transition CSS
 *     (blur + opacity) para que el upscale no sea percibido como un
 *     parpadeo, sino como un desenfoque que se resuelve.
 *
 * Esto reduce el TTFB percibido porque el archivo small se sirve más
 * rápido y el alto-ruido inicial actúa como placeholder del contenido.
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
  lowWidth = 185,
}: OptimizedImageProps) {
  const [currentSrc, setCurrentSrc] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  // Deriva la URL de baja resolución a partir del src final.
  // TMDB usa: https://image.tmdb.org/t/p/w342/path
  // La miniatura: https://image.tmdb.org/t/p/w185/path
  const lowResSrc = toLowRes(src, lowWidth);

  // Secuencia: primero la miniatura, luego el final.
  useEffect(() => {
    if (!src) return;
    let cancelled = false;

    // 1. Miniatura rápida
    const lowImg = new Image();
    lowImg.decoding = 'async';
    lowImg.onload = () => {
      if (cancelled) return;
      setCurrentSrc(lowResSrc);
      // 2. Precarga la versión final mientras se muestra la miniatura
      const highImg = new Image();
      highImg.decoding = 'async';
      highImg.onload = () => {
        if (cancelled) return;
        setCurrentSrc(src);
        setIsLoaded(true);
        onLoad?.();
      };
      highImg.onerror = () => {
        if (cancelled) return;
        // Si falla el alto, quedamos con la miniatura (no es un error crítico)
        setIsLoaded(true);
        onLoad?.();
      };
      highImg.src = src;
    };
    lowImg.onerror = () => {
      if (cancelled) return;
      // Si la miniatura falla, intentamos directamente con el alto
      const highImg = new Image();
      highImg.decoding = 'async';
      highImg.onload = () => {
        if (cancelled) return;
        setCurrentSrc(src);
        setIsLoaded(true);
        onLoad?.();
      };
      highImg.onerror = () => {
        if (cancelled) return;
        setHasError(true);
        onError?.();
      };
      highImg.src = src;
    };
    lowImg.src = lowResSrc;

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, lowResSrc, onError, onLoad]);

  if (hasError || !currentSrc) {
    return null;
  }

  return (
    <img
      src={currentSrc}
      srcSet={srcSet}
      sizes={sizes}
      alt={alt}
      className={className}
      style={{
        ...style,
        // Suaviza el salto mini → alto: desenfoque + opacidad.
        transition: 'filter 0.4s ease, opacity 0.4s ease',
        filter: isLoaded ? 'blur(0px)' : 'blur(6px)',
        opacity: isLoaded ? 1 : 0.85,
      }}
      loading={loading}
      decoding={decoding}
    />
  );
}

/** Convierte un URL TMDB en su versión de ancho `lowWidth`. */
function toLowRes(src: string, lowWidth: number): string {
  if (!src) return src;
  // Reemplaza el último /t/p/XXXX/ por /t/p/w{lowWidth}/
  return src.replace(/\/t\/p\/[^/]+\//, `/t/p/w${lowWidth}/`);
}