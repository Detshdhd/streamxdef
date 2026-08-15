'use client';

import { useRef, useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Play, Heart, Star } from 'lucide-react';
import { useStore, type MediaItem } from '@/store/useStore';

interface ContentRowProps {
  title: string;
  items: MediaItem[];
  isTopTen?: boolean;
  rowIndex?: number;
}

/* ────────────────────────────────────────────
   Content Card — Friendly with warm accents
   ──────────────────────────────────────────── */
function ContentCard({ item, index, isTopTen }: { item: MediaItem; index: number; isTopTen?: boolean }) {
  const handleCardClick = useStore((s) => s.handleCardClick);
  const toggleMyList = useStore((s) => s.toggleMyList);
  const myList = useStore((s) => s.myList);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const isFav = myList.some(m => m.id === item.id);
  const title = item.title || item.name || '';
  const rating = item.vote_average ? item.vote_average.toFixed(1) : null;
  const year = (item.release_date || item.first_air_date || '').substring(0, 4);
  const isHighRated = item.vote_average >= 7.5;

  // Disney+-style: landscape 16:9 tiles, wider than portrait posters
  const cardWidth = 'w-[230px] sm:w-[280px] md:w-[310px] lg:w-[330px]';

  // Prefer the backdrop for landscape tiles; fall back to the poster
  // (cropped by object-cover) when no backdrop exists.
  const imgPath = item.backdrop_path || item.poster_path;

  if (!imgPath || imgError) {
    return (
      <div className={`${cardWidth} shrink-0`}>
        <div className="nfx-card-img nfx-card-img-landscape flex items-center justify-center">
          <span className="text-white/10 text-xs text-center px-3 leading-snug">{title}</span>
        </div>
        <p className="text-white text-[13px] font-medium mt-2 truncate">{title}</p>
      </div>
    );
  }

  return (
    <div
      className={`${cardWidth} shrink-0 relative group`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className="nfx-card-img nfx-card-img-landscape cursor-pointer"
        onClick={() => handleCardClick(item)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') handleCardClick(item); }}
      >
        {!imgLoaded && <div className="absolute inset-0 skeleton-shimmer" />}
        <img
          src={`https://image.tmdb.org/t/p/w300${imgPath}`}
          alt={title}
          className="w-full h-full object-cover transition-opacity duration-300"
          style={{ opacity: imgLoaded ? 1 : 0 }}
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgError(true)}
          loading="lazy"
        />

        {/* Top-10 badge inside the tile (Disney+ puts rank on the artwork) */}
        {isTopTen && index < 10 && (
          <div className="absolute top-2 left-2 z-20 flex items-center gap-1 bg-black/60 backdrop-blur-sm rounded-md px-2 py-[3px]">
            <span className="text-[#e50914] text-[12px] font-black leading-none">{index + 1}</span>
          </div>
        )}

        {/* ── Hover overlay ── */}
        <div
          className={`absolute inset-0 transition-all duration-300 ${
            isHovered ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className="absolute inset-0 bg-black/35" />

          {/* Heart button — top-right */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleMyList(item); }}
            className="absolute top-2 right-2 z-20 w-[30px] h-[30px] rounded-full glass flex items-center justify-center hover:bg-[#e50914]/20 transition-all duration-200 hover:scale-110"
            aria-label={isFav ? 'Quitar de Mi Lista' : 'Agregar a Mi Lista'}
          >
            <Heart
              className={`w-4 h-4 transition-all duration-200 ${
                isFav ? 'fill-[#e50914] text-[#e50914]' : 'text-white/80'
              }`}
            />
          </button>

          {/* Play button — center */}
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="w-[46px] h-[46px] rounded-full bg-[#e50914]/25 backdrop-blur-sm flex items-center justify-center border border-[#e50914]/40 hover:bg-[#e50914]/40 transition-all duration-200 hover:scale-105 shadow-[0_0_18px_rgba(229,9,20,0.25)]">
              <Play className="w-[18px] h-[18px] fill-white text-white ml-[2px]" />
            </div>
          </div>
        </div>
      </div>

      {/* Disney+-style: title + metadata ALWAYS visible below the artwork */}
      <div className="mt-2 px-0.5">
        <p className="text-white text-[13px] font-medium leading-tight truncate group-hover:text-white transition-colors">
          {title}
        </p>
        <div className="flex items-center gap-1.5 mt-[3px] text-[11px]">
          {year && <span className="text-white/40">{year}</span>}
          {rating && (
            <span className={`flex items-center gap-0.5 ${isHighRated ? 'text-[#34d399]' : 'text-white/40'}`}>
              <Star className={`w-[10px] h-[10px] ${isHighRated ? 'fill-[#34d399]' : 'fill-white/40'}`} />
              {rating}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────
   Content Row — Horizontal scroll
   ──────────────────────────────────────────── */
export default function ContentRow({ title, items, isTopTen, rowIndex = 0 }: ContentRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(true);
  const [mounted, setMounted] = useState(false);

  const checkScroll = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setShowLeft(scrollLeft > 20);
    setShowRight(scrollLeft + clientWidth < scrollWidth - 20);
  };

  useEffect(() => { checkScroll(); }, [items]);
  useEffect(() => { setMounted(true); }, []);

  const scroll = (dir: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const amount = scrollRef.current.clientWidth * 0.85;
    scrollRef.current.scrollBy({ left: dir === 'left' ? -amount : amount, behavior: 'smooth' });
  };

  if (!items || items.length === 0) return null;

  return (
    <div
      className="mb-[34px] md:mb-[46px] animate-nfx-row-enter"
      style={mounted ? { animationDelay: `${rowIndex * 60}ms` } : undefined}
      suppressHydrationWarning
    >
      {/* Row title — Disney+ style: clean white, medium weight */}
      <div className="px-[3%] mb-[10px] md:mb-[12px]">
        <h2 className="text-white font-semibold text-[17px] md:text-[20px] tracking-tight select-none">
          {title}
        </h2>
      </div>

      {/* Scrollable container */}
      <div className="nfx-row-container">
        {showLeft && (
          <button
            type="button"
            onClick={() => scroll('left')}
            className="nfx-row-arrow nfx-row-arrow-left"
            aria-label="Anterior"
          >
            <ChevronLeft className="w-5 h-5 md:w-6 md:h-6 text-white/80" />
          </button>
        )}

        <div
          ref={scrollRef}
          onScroll={checkScroll}
          className="flex gap-[10px] md:gap-[12px] overflow-x-auto px-[3%] pb-1 scrollbar-hide"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {items.map((item, idx) => (
            <ContentCard
              key={`${item.id}-${item.media_type || 'movie'}`}
              item={item}
              index={idx}
              isTopTen={isTopTen}
            />
          ))}
        </div>

        {showRight && (
          <button
            type="button"
            onClick={() => scroll('right')}
            className="nfx-row-arrow nfx-row-arrow-right"
            aria-label="Siguiente"
          >
            <ChevronRight className="w-5 h-5 md:w-6 md:h-6 text-white/80" />
          </button>
        )}
      </div>
    </div>
  );
}
