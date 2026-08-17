'use client';

import { useRef, useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Play, Heart } from 'lucide-react';
import { useStore, type MediaItem } from '@/store/useStore';

interface ContentRowProps {
  title: string;
  items: MediaItem[];
  isTopTen?: boolean;
  rowIndex?: number;
}

/* ────────────────────────────────────────────
   Content Card — Apple TV+ style
   Landscape 16:9 tile with rounded corners;
   title + year BELOW the artwork in small text.
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
  const year = (item.release_date || item.first_air_date || '').substring(0, 4);

  // Apple TV+ tiles: landscape 16:9, wider than portrait posters
  const cardWidth = 'w-[230px] sm:w-[280px] md:w-[310px] lg:w-[330px]';

  // Prefer the backdrop for landscape tiles; fall back to the poster
  // (cropped by object-cover) when no backdrop exists.
  const imgPath = item.backdrop_path || item.poster_path;

  if (!imgPath || imgError) {
    return (
      <div className={`${cardWidth} shrink-0`}>
        <div className="nfx-card-img nfx-card-img-landscape flex items-center justify-center">
          <span className="text-white/25 text-[11px] font-medium text-center px-4 leading-snug">{title}</span>
        </div>
        {/* Caption below — same as loaded cards */}
        <p className="text-white text-[13px] font-medium leading-tight mt-2 truncate">{title}</p>
        {year && <p className="text-white/45 text-[12px] mt-[1px] truncate">{year}</p>}
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

        {/* Top-10 rank on the artwork (Apple TV+: white on dark glass) */}
        {isTopTen && index < 10 && (
          <div className="absolute top-2 left-2 z-20 bg-black/55 backdrop-blur-sm rounded-md px-2 py-[3px]">
            <span className="text-white text-[12px] font-bold leading-none">{index + 1}</span>
          </div>
        )}

        {/* ── Hover overlay ── */}
        <div
          className={`absolute inset-0 transition-all duration-300 ${
            isHovered ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className="absolute inset-0 bg-black/30" />

          {/* Heart button — top-right (Apple: dark glass, white icon) */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleMyList(item); }}
            className="absolute top-2 right-2 z-20 w-[30px] h-[30px] rounded-full bg-black/55 backdrop-blur-md flex items-center justify-center hover:bg-black/75 transition-all duration-200 hover:scale-110"
            aria-label={isFav ? 'Quitar de Mi Lista' : 'Agregar a Mi Lista'}
          >
            <Heart
              className={`w-4 h-4 transition-all duration-200 ${
                isFav ? 'fill-white text-white' : 'text-white/85'
              }`}
            />
          </button>

          {/* Play button — center (Apple: white disc, black glyph) */}
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="w-[44px] h-[44px] rounded-full bg-white/95 flex items-center justify-center transition-all duration-200 group-hover:scale-105 shadow-2xl">
              <Play className="w-[18px] h-[18px] fill-black text-black ml-[2px]" />
            </div>
          </div>
        </div>
      </div>

      {/* ── Apple TV+: caption BELOW the artwork — title white,
           metadata gray, never on top of the image ── */}
      <div className="mt-2">
        <p className="text-white text-[13px] md:text-[13.5px] font-medium leading-tight line-clamp-1">
          {title}
        </p>
        {year && (
          <p className="text-white/45 text-[11.5px] md:text-[12px] mt-[1px] line-clamp-1">
            {year}
          </p>
        )}
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
      {/* Row title — Apple TV+ shelf header: bold, larger, with chevron */}
      <div className="px-[3%] mb-[10px] md:mb-[12px]">
        <button
          type="button"
          onClick={() => scroll('right')}
          className="group/header flex items-center gap-1.5 select-none"
        >
          <h2 className="text-white font-bold text-[19px] md:text-[24px] tracking-[-0.01em] group-hover/header:text-white/90 transition-colors">
            {title}
          </h2>
          <ChevronRight className="w-[18px] h-[18px] md:w-5 md:h-5 text-white/40 group-hover/header:text-white/80 transition-all duration-200 group-hover/header:translate-x-0.5" />
        </button>
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
          className="flex gap-[12px] md:gap-[16px] overflow-x-auto px-[3%] pb-1 scrollbar-hide"
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
