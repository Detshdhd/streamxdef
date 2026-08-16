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
  const [loaded, setLoaded] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Pick top candidates for rotation
  const candidates = useMemo(() => {
    if (!items || items.length === 0) return [];
    const pool = items.filter(
      (i) => i.backdrop_path && (i.title || i.name) && i.vote_average > 6.5
    );
    return pool.length > 0 ? pool.slice(0, 6) : items.filter((i) => i.backdrop_path).slice(0, 6);
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

  useEffect(() => { setLoaded(false); }, [item?.id]);

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
  const matchPercent = item.vote_average > 0 ? Math.round(item.vote_average * 10) : 0;

  return (
    <div className="nfx-hero">
      {/* Backdrop with Ken Burns */}
      <div className={`absolute inset-0 transition-opacity duration-500 ${isTransitioning ? 'opacity-0' : 'opacity-100'}`}>
        {item.backdrop_path && (
          <img
            src={`https://image.tmdb.org/t/p/w780${item.backdrop_path}`}
            alt=""
            className={`w-full h-full object-cover animate-ken-burns transition-opacity duration-[800ms] ease-out ${
              loaded ? 'opacity-100' : 'opacity-0'
            }`}
            onLoad={() => setLoaded(true)}
          />
        )}

        {/* Gradient layers — deep dark base (Apple TV+: neutral, no tint) */}
        <div className="absolute inset-x-0 top-0 h-[35%] bg-gradient-to-b from-[#0a0a0f] via-[#0a0a0f]/60 to-transparent" />
        <div className="absolute inset-y-0 right-0 w-[50%] bg-gradient-to-l from-transparent to-[#0a0a0f]/40" />
        <div className="absolute inset-x-0 bottom-0 h-[70%] bg-gradient-to-t from-[#0a0a0f] via-[#0a0a0f]/80 to-transparent" />
      </div>

      {/* Content — bottom-left with animation */}
      <div className={`absolute bottom-[12%] left-[4%] right-[4%] md:right-[45%] z-10 transition-all duration-500 ${isTransitioning ? 'opacity-0 translate-y-4' : 'opacity-100 translate-y-0'}`}>
        {/* Type badge — Apple TV+ "chip" above the title */}
        <div className="flex items-center gap-2.5 mb-3 animate-nfx-slide-up animate-nfx-slide-up-d1">
          <span className="nfx-glass-chip text-[11px] font-semibold uppercase tracking-wider">
            {isTV ? 'Serie' : 'Película'}
          </span>
          {matchPercent >= 70 && (
            <span className="text-white/55 text-[12px] font-medium">{matchPercent}% relevante</span>
          )}
        </div>

        {/* Title */}
        <h1 className="nfx-font-hero text-[36px] sm:text-[48px] md:text-[56px] lg:text-[64px] text-white leading-[1.05] mb-3 md:mb-4 hero-text-shadow animate-nfx-slide-up animate-nfx-slide-up-d2">
          {title}
        </h1>

        {/* Metadata row */}
        <div className="flex items-center gap-2.5 mb-3 md:mb-4 text-[12px] md:text-[13px] animate-nfx-slide-up animate-nfx-slide-up-d3">
          <span className="text-white/60">{year}</span>
          <span className="text-white/30 hidden sm:inline">{isTV ? 'Serie' : 'Película'}</span>
          <span className="text-[10px] font-bold tracking-wider bg-white/15 text-white rounded-full px-2 py-[2px] hidden sm:inline-flex">HD</span>
        </div>

        {/* Description */}
        <p className="text-white/45 text-[12px] md:text-[14px] leading-[1.7] mb-5 md:mb-6 line-clamp-2 max-w-[460px] animate-nfx-slide-up animate-nfx-slide-up-d3">
          {item.overview}
        </p>

        {/* Buttons */}
        <div className="flex items-center gap-2.5 animate-nfx-slide-up animate-nfx-slide-up-d4">
          <button
            onClick={(e) => { e.stopPropagation(); playMovie(item); }}
            className="nfx-btn-play"
          >
            <Play className="w-5 h-5 fill-[#0a0a0f] text-[#0a0a0f]" />
            <span>Reproducir</span>
          </button>

          <button
            onClick={(e) => { e.stopPropagation(); selectItem(item); openDetail(); }}
            className="nfx-btn-info"
          >
            <Info className="w-5 h-5" />
            <span className="sm:inline">Más información</span>
          </button>
        </div>
      </div>

      {/* Dot indicators — friendlier shape */}
      {candidates.length > 1 && (
        <div className="absolute bottom-[5%] left-1/2 -translate-x-1/2 z-20 flex items-center gap-2">
          {candidates.map((_, idx) => (
            <button
              key={idx}
              onClick={() => goTo(idx)}
              className={`transition-all duration-300 rounded-full ${
                idx === currentIndex
                  ? 'w-6 h-1.5 bg-white'
                  : 'w-1.5 h-1.5 bg-white/25 hover:bg-white/50'
              }`}
              aria-label={`Slide ${idx + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
