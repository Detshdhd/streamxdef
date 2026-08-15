'use client';

import { useRef, useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Play, Heart, Star } from 'lucide-react';
import { useStore, type MediaItem } from '@/store/useStore';

// Cards render at ~120-235px wide — w185 is visually identical at that size
// and ~3x lighter than w342, so poster grids load dramatically faster.
const TMDB_IMG = 'https://image.tmdb.org/t/p/w185';

interface ContentRowProps {
  title: string;
  items: MediaItem[];
  isTopTen?: boolean;
  rowIndex?: number;
  /** Opens the full grid view for this category ("Ver todo"). */
  onViewAll?: () => void;
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
  const isHighRated = item.vote_average >= 7.5;

  const cardWidth = isTopTen
    ? 'w-[120px] sm:w-[155px] md:w-[200px] lg:w-[220px]'
    : 'w-[120px] sm:w-[155px] md:w-[220px] lg:w-[235px]';

  if (!item.poster_path || imgError) {
    return (
      <div className={`${cardWidth} shrink-0`}>
        {isTopTen && index < 10 && (
          <div className="nfx-top10-wrapper"><span className="nfx-top10-number">{index + 1}</span></div>
        )}
        <div className="nfx-card-img flex items-center justify-center">
          <span className="text-white/10 text-xs text-center px-3 leading-snug">{title}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${cardWidth} shrink-0 relative group`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {isTopTen && index < 10 && (
        <div className="nfx-top10-wrapper"><span className="nfx-top10-number">{index + 1}</span></div>
      )}

      <div
        className="nfx-card-img cursor-pointer"
        onClick={() => handleCardClick(item)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') handleCardClick(item); }}
      >
        {!imgLoaded && <div className="absolute inset-0 skeleton-shimmer" />}
        <img
          src={`${TMDB_IMG}${item.poster_path}`}
          alt={title}
          className="w-full h-full object-cover transition-opacity duration-300"
          style={{ opacity: imgLoaded ? 1 : 0 }}
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgError(true)}
          loading="lazy"
        />

        {/* ── Hover overlay ── */}
        <div
          className={`absolute inset-0 transition-all duration-300 ${
            isHovered ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {/* Dark gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />

          {/* Heart button — top-right */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleMyList(item); }}
            className="absolute top-[6px] right-[6px] z-20 w-[28px] h-[28px] rounded-full glass flex items-center justify-center hover:bg-[#e50914]/20 transition-all duration-200 hover:scale-110"
            aria-label={isFav ? 'Quitar de Mi Lista' : 'Agregar a Mi Lista'}
          >
            <Heart
              className={`w-[14px] h-[14px] transition-all duration-200 ${
                isFav ? 'fill-[#e50914] text-[#e50914]' : 'text-white/80'
              }`}
            />
          </button>

          {/* Play button — center with subtle red glow */}
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="w-[44px] h-[44px] rounded-full bg-[#e50914]/20 backdrop-blur-sm flex items-center justify-center border border-[#e50914]/30 hover:bg-[#e50914]/30 transition-all duration-200 hover:scale-105 shadow-[0_0_16px_rgba(229,9,20,0.20)]">
              <Play className="w-4 h-4 fill-white text-white ml-[2px]" />
            </div>
          </div>

          {/* Bottom info */}
          <div className="absolute bottom-0 left-0 right-0 p-2.5 z-10">
            {/* Rating badge */}
            {rating && (
              <div className="flex items-center gap-1 mb-1">
                <Star className={`w-3 h-3 ${isHighRated ? 'fill-[#34d399] text-[#34d399]' : 'fill-white/40 text-white/40'}`} />
                <span className={`text-[10px] font-bold ${isHighRated ? 'text-[#34d399]' : 'text-white/50'}`}>
                  {rating}
                </span>
              </div>
            )}

            {/* Title */}
            <p className="text-white text-[10px] font-medium leading-tight line-clamp-2">
              {title}
            </p>
          </div>
        </div>

        {/* Always-visible bottom gradient for title */}
        <div className="absolute bottom-0 left-0 right-0 h-[35%] bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />

        {/* Rating badge — always visible top-left for high rated */}
        {isHighRated && !isHovered && (
          <div className="absolute top-[6px] left-[6px] z-20 flex items-center gap-0.5 bg-[#e50914]/20 backdrop-blur-sm rounded-full px-1.5 py-[2px]">
            <Star className="w-2.5 h-2.5 fill-[#34d399] text-[#34d399]" />
            <span className="text-[9px] font-bold text-[#34d399]">{rating}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────
   Content Row — Horizontal scroll
   ──────────────────────────────────────────── */
export default function ContentRow({ title, items, isTopTen, rowIndex = 0, onViewAll }: ContentRowProps) {
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
      className="mb-[20px] md:mb-[28px] animate-nfx-row-enter"
      style={mounted ? { animationDelay: `${rowIndex * 60}ms` } : undefined}
      suppressHydrationWarning
    >
      {/* Row title — clicking it (or "Ver todo") opens the full grid */}
      <div
        className={`group/row flex items-center justify-between px-[3%] mb-[8px] ${onViewAll ? 'cursor-pointer' : ''}`}
        onClick={onViewAll}
      >
        <h2 className="text-white font-bold text-[16px] md:text-[18px] group-hover/row:text-white/80 transition-colors duration-200 select-none flex items-center gap-2">
          {title}
          <ChevronRight className="w-4 h-4 opacity-0 group-hover/row:opacity-100 transition-all duration-300 -translate-x-1 group-hover/row:translate-x-0 text-[#e50914]" />
        </h2>
        {onViewAll && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onViewAll(); }}
            className="text-[11px] text-[#e50914]/60 hover:text-[#e50914] font-medium opacity-0 group-hover/row:opacity-100 transition-all duration-300 focus:opacity-100 cursor-pointer"
          >
            Ver todo
          </button>
        )}
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
          className="flex gap-[4px] md:gap-[5px] overflow-x-auto px-[3%] scrollbar-hide"
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
