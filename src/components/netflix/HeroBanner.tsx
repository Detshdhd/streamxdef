'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import { Play, Info } from 'lucide-react';
import { useStore, type MediaItem } from '@/store/useStore';

interface HeroBannerProps {
  items: MediaItem[];
}

const ROTATION_INTERVAL = 8000; // 8 seconds per slide

export default function HeroBanner({ items }: HeroBannerProps) {
  const { selectItem, openDetail, playMovie } = useStore();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Pick top candidates for rotation
  const candidates = useMemo(() => {
    if (!items || items.length === 0) return [];
    const pool = items.filter(
      (i) => i.backdrop_path && (i.title || i.name) && i.vote_average > 6.5
    );
    return pool.length > 0 ? pool.slice(0, 5) : items.filter((i) => i.backdrop_path).slice(0, 5);
  }, [items]);

  const item = candidates[currentIndex] || null;

  // Auto-rotation
  useEffect(() => {
    if (candidates.length <= 1) return;
    const timer = setInterval(() => {
      setIsTransitioning(true);
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % candidates.length);
        setIsTransitioning(false);
      }, 300);
    }, ROTATION_INTERVAL);
    return () => clearInterval(timer);
  }, [candidates.length]);

  const goTo = useCallback((idx: number) => {
    if (idx === currentIndex) return;
    setIsTransitioning(true);
    setTimeout(() => {
      setCurrentIndex(idx);
      setIsTransitioning(false);
    }, 300);
  }, [currentIndex]);

  if (!item) return null;

  const title = item.title || item.name || '';
  const year = (item.release_date || item.first_air_date || '').substring(0, 4);
  const isTV = item.media_type === 'tv' || !!item.name;

  return (
    <section className="nfx-featured" aria-label="Contenido destacado">
      <div className="nfx-featured-track">
        {candidates.slice(0, 5).map((candidate, index) => {
          const candidateTitle = candidate.title || candidate.name || '';
          const candidateYear = (candidate.release_date || candidate.first_air_date || '').substring(0, 4);
          const candidateIsTV = candidate.media_type === 'tv' || !!candidate.name;
          const isActive = index === currentIndex;
          return (
            <button
              key={`${candidate.id}-${index}`}
              type="button"
              className={`nfx-featured-card ${isActive ? 'nfx-featured-card--active' : ''}`}
              onClick={() => {
                if (isActive) {
                  selectItem(candidate);
                  openDetail();
                } else {
                  goTo(index);
                }
              }}
            >
              <img
                src={`https://image.tmdb.org/t/p/w780${candidate.backdrop_path}`}
                alt=""
                className="nfx-featured-image"
                loading={index < 2 ? 'eager' : 'lazy'}
              />
              <span className="nfx-featured-shade" />
              <span className="nfx-featured-copy">
                <span className="nfx-featured-kicker">{candidateIsTV ? 'Serie' : 'Película'} <b>★ {(candidate.vote_average || 0).toFixed(1)}</b></span>
                <strong>{candidateTitle}</strong>
                <span className="nfx-featured-meta">{candidateYear} · HD</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="nfx-featured-bottom">
        <div className="nfx-featured-dots" role="tablist" aria-label="Destacados">
          {candidates.map((_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => goTo(idx)}
              className={idx === currentIndex ? 'is-active' : ''}
              aria-label={`Destacado ${idx + 1}`}
            />
          ))}
        </div>
        <div className="nfx-featured-actions">
          <button type="button" className="nfx-btn-play nfx-featured-play" onClick={() => playMovie(item)}>
            <Play className="w-4 h-4 fill-black text-black" />
            <span>Reproducir</span>
          </button>
          <button type="button" className="nfx-btn-info nfx-featured-info" onClick={() => { selectItem(item); openDetail(); }}>
            <Info className="w-4 h-4" />
            <span>Más información</span>
          </button>
        </div>
      </div>
    </section>
  );
}
