'use client';

import { useRef, useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Play, Heart } from 'lucide-react';
import { useStore, type MediaItem } from '@/store/useStore';

interface ContentRowProps {
  title: string;
  items: MediaItem[];
  isTopTen?: boolean;
  rowIndex?: number;
  onViewAll?: () => void;
}

  /* ────────────────────────────────────────────
   Content Card — Apple TV-style storefront tile.
   Posters stay portrait, but the shelf uses larger rounded tiles
   with enough room for the artwork to carry the hierarchy.
   ──────────────────────────────────────────── */
function ContentCard({ item, index, isTopTen }: { item: MediaItem; index: number; isTopTen?: boolean }) {
  const handleCardClick = useStore((s) => s.handleCardClick);
  const toggleMyList = useStore((s) => s.toggleMyList);
  const myList = useStore((s) => s.myList);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [imagePath, setImagePath] = useState(item.poster_path || item.backdrop_path);
  const [isHovered, setIsHovered] = useState(false);

  const isFav = myList.some(m => m.id === item.id);
  const title = item.title || item.name || '';

  const cardWidth = 'w-[172px] sm:w-[190px] md:w-[214px] lg:w-[224px]';

  const handleImageError = () => {
    if (imagePath === item.poster_path && item.backdrop_path) {
      setImgLoaded(false);
      setImagePath(item.backdrop_path);
      return;
    }
    setImgError(true);
  };

  const artworkUrl = imagePath
    ? `https://image.tmdb.org/t/p/${imagePath === item.poster_path ? 'w342' : 'w780'}${imagePath}`
    : null;
  const artworkSrcSet = imagePath
    ? imagePath === item.poster_path
      ? `https://image.tmdb.org/t/p/w185${imagePath} 185w, https://image.tmdb.org/t/p/w342${imagePath} 342w`
      : `https://image.tmdb.org/t/p/w342${imagePath} 342w, https://image.tmdb.org/t/p/w780${imagePath} 780w`
    : undefined;

  if (!artworkUrl || imgError) {
    return (
      <div
        className={`${cardWidth} shrink-0 relative group`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <button
          type="button"
          className="nfx-card-img flex items-center justify-center cursor-pointer w-full"
          onClick={() => handleCardClick(item)}
          aria-label={`Más información: ${title}`}
        >
          <span className="text-white/25 text-[11px] font-medium text-center px-4 leading-snug">{title}</span>
        </button>
        <p className="text-white/85 text-[13px] font-normal leading-tight mt-2 truncate">{title}</p>
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
        className="nfx-card-img cursor-pointer"
        onClick={() => handleCardClick(item)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') handleCardClick(item); }}
      >
        {!imgLoaded && <div className="absolute inset-0 skeleton-shimmer" />}
        <img
          src={artworkUrl}
          srcSet={artworkSrcSet}
          sizes="(max-width: 640px) 172px, (max-width: 900px) 190px, 224px"
          alt={title}
          className="w-full h-full object-cover transition-opacity duration-300"
          style={{ opacity: imgLoaded ? 1 : 0 }}
          onLoad={() => setImgLoaded(true)}
          onError={handleImageError}
          loading={index < 2 ? 'eager' : 'lazy'}
          decoding="async"
        />

        {/* Top-10 rank on the artwork (Apple: white on dark glass) */}
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

      <p className="text-white/[0.88] text-[13px] font-medium leading-tight mt-2 line-clamp-1">
        {title}
      </p>
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
  const [mounted] = useState(true);

  const checkScroll = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setShowLeft(scrollLeft > 20);
    setShowRight(scrollLeft + clientWidth < scrollWidth - 20);
  };

  useEffect(() => { checkScroll(); }, [items]);
  const scroll = (dir: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const amount = scrollRef.current.clientWidth * 0.85;
    scrollRef.current.scrollBy({ left: dir === 'left' ? -amount : amount, behavior: 'smooth' });
  };

  if (!items || items.length === 0) return null;

  return (
    <div
      className="mb-[28px] md:mb-[22px] animate-nfx-row-enter"
      style={mounted ? { animationDelay: `${rowIndex * 60}ms` } : undefined}
      suppressHydrationWarning
    >
      <div className="nfx-row-heading px-[3%] mb-[12px]">
        <button
          type="button"
          onClick={onViewAll}
          className={`inline-flex items-center gap-1 text-left ${onViewAll ? 'cursor-pointer' : 'cursor-default'}`}
          aria-label={onViewAll ? `Ver todo: ${title}` : title}
        >
          <h2 className="text-white/[0.94] font-semibold text-[20px] tracking-[-0.015em] select-none">
            {title}
          </h2>
          <ChevronRight className="w-5 h-5 text-white/70" aria-hidden="true" />
        </button>
        {onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            className="text-[12px] text-white/55 hover:text-white transition-colors"
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
          className="flex gap-[14px] md:gap-[22px] overflow-x-auto px-[3%] pb-1 scrollbar-hide"
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
