'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Facebook, Instagram, Youtube, Play, Trash2, AlertCircle, CheckCircle, Loader2, X as XIcon, Search, Heart, Download, Sparkles } from 'lucide-react';
import Navbar from '@/components/netflix/Navbar';
import HeroBanner from '@/components/netflix/HeroBanner';
import ContentRow from '@/components/netflix/ContentRow';
import { useStore, type MediaItem, type ContinueWatchingItem, type DownloadItem } from '@/store/useStore';

// Code-split the modal and player (hls.js is ~400KB) out of the initial
// bundle — the page opens faster because it no longer ships the player
// code on load. The chunks download in the background right after mount
// (see the idle prefetch effect below) so opening a movie isn't delayed.
const DetailModal = dynamic(() => import('@/components/netflix/DetailModal'), { ssr: false });
const VideoPlayer = dynamic(() => import('@/components/netflix/VideoPlayer'), { ssr: false });

interface ContentSection {
  title: string;
  type: string;
  filter?: 'movie' | 'tv' | 'all';
  data: MediaItem[];
  loading: boolean;
  isTopTen?: boolean;
}

// Sections for the HOME tab — rich variety of genres, best-rated per genre
const HOME_SECTIONS: { title: string; type: string; filter: 'movie' | 'tv' | 'all'; isTopTen?: boolean }[] = [
  { title: 'Tendencias ahora', type: 'trending', filter: 'all' },
  { title: 'Películas más valoradas', type: 'top-rated', filter: 'movie' },
  { title: 'Series populares', type: 'popular-tv', filter: 'tv' },
  { title: 'Acción', type: 'action', filter: 'movie' },
  { title: 'Thriller', type: 'thriller', filter: 'movie' },
  { title: 'Comedia', type: 'comedy', filter: 'movie' },
  { title: 'Terror', type: 'horror', filter: 'movie' },
  { title: 'Ciencia ficción', type: 'scifi-movies', filter: 'movie' },
  { title: 'Romance', type: 'romance', filter: 'movie' },
  { title: 'Animación', type: 'animation', filter: 'movie' },
  { title: 'Fantasía', type: 'fantasy', filter: 'movie' },
  { title: 'Misterio', type: 'mystery', filter: 'movie' },
  { title: 'Drama', type: 'drama-movies', filter: 'movie' },
  { title: 'Crimen', type: 'crime-movies', filter: 'movie' },
  { title: 'Aventura', type: 'adventure', filter: 'movie' },
  { title: 'Documentales', type: 'documentary', filter: 'movie' },
  { title: 'Guerra', type: 'war', filter: 'movie' },
  { title: 'Western', type: 'western', filter: 'movie' },
  { title: 'Clásicos de los 90s', type: 'classics-90s', filter: 'movie' },
  { title: 'Mejores del 2000', type: 'best-2000s', filter: 'movie' },
  { title: 'Estrenos recientes', type: 'now-playing', filter: 'movie' },
  { title: 'Acción y thriller', type: 'action-thriller', filter: 'movie' },
  { title: 'Comedia romántica', type: 'romcom', filter: 'movie' },
  { title: 'Terror y misterio', type: 'horror-mystery', filter: 'movie' },
  { title: 'Ciencia ficción y fantasía', type: 'scifi-fantasy', filter: 'movie' },
  { title: 'Series de drama', type: 'drama-series', filter: 'tv' },
  { title: 'Series de ciencia ficción', type: 'scifi-series', filter: 'tv' },
  { title: 'Series de crimen', type: 'crime-series', filter: 'tv' },
  { title: 'Series de animación', type: 'animation-series', filter: 'tv' },
  { title: 'Series de misterio', type: 'mystery-series', filter: 'tv' },
  { title: 'Series de comedia', type: 'comedy-series', filter: 'tv' },
  { title: 'Series en emisión', type: 'on-the-air', filter: 'tv' },
];

// Sections for the MOVIES tab — ONLY movies, best-rated by genre + combos + decades
const MOVIE_SECTIONS: { title: string; type: string; filter: 'movie' }[] = [
  { title: 'Películas más valoradas', type: 'top-rated', filter: 'movie' },
  { title: 'En cartelera', type: 'now-playing', filter: 'movie' },
  { title: 'Próximamente', type: 'upcoming', filter: 'movie' },
  { title: 'Acción', type: 'action', filter: 'movie' },
  { title: 'Thriller', type: 'thriller', filter: 'movie' },
  { title: 'Comedia', type: 'comedy', filter: 'movie' },
  { title: 'Terror', type: 'horror', filter: 'movie' },
  { title: 'Ciencia ficción', type: 'scifi-movies', filter: 'movie' },
  { title: 'Romance', type: 'romance', filter: 'movie' },
  { title: 'Animación', type: 'animation', filter: 'movie' },
  { title: 'Fantasía', type: 'fantasy', filter: 'movie' },
  { title: 'Misterio', type: 'mystery', filter: 'movie' },
  { title: 'Drama', type: 'drama-movies', filter: 'movie' },
  { title: 'Crimen', type: 'crime-movies', filter: 'movie' },
  { title: 'Aventura', type: 'adventure', filter: 'movie' },
  { title: 'Documentales', type: 'documentary', filter: 'movie' },
  { title: 'Guerra', type: 'war', filter: 'movie' },
  { title: 'Western', type: 'western', filter: 'movie' },
  { title: 'Familia', type: 'family', filter: 'movie' },
  { title: 'Historia', type: 'history', filter: 'movie' },
  { title: 'Acción y thriller', type: 'action-thriller', filter: 'movie' },
  { title: 'Comedia romántica', type: 'romcom', filter: 'movie' },
  { title: 'Terror y misterio', type: 'horror-mystery', filter: 'movie' },
  { title: 'Ciencia ficción y fantasía', type: 'scifi-fantasy', filter: 'movie' },
  { title: 'Clásicos de los 90s', type: 'classics-90s', filter: 'movie' },
  { title: 'Mejores del 2000', type: 'best-2000s', filter: 'movie' },
  { title: 'Mejores del 2010', type: 'best-2010s', filter: 'movie' },
  { title: 'Acción reciente', type: 'top-action-2020s', filter: 'movie' },
  { title: 'Joyas ocultas', type: 'highly-rated-hidden', filter: 'movie' },
  { title: 'Películas populares', type: 'popular-movies', filter: 'movie' },
];

// Sections for the SERIES tab — ONLY series (NO movies!), best-rated by genre
const SERIES_SECTIONS: { title: string; type: string; filter: 'tv' }[] = [
  { title: 'Series populares', type: 'popular-tv', filter: 'tv' },
  { title: 'Series más valoradas', type: 'top-rated-series', filter: 'tv' },
  { title: 'En emisión', type: 'on-the-air', filter: 'tv' },
  { title: 'Drama', type: 'drama-series', filter: 'tv' },
  { title: 'Ciencia ficción y fantasía', type: 'scifi-series', filter: 'tv' },
  { title: 'Crimen', type: 'crime-series', filter: 'tv' },
  { title: 'Animación', type: 'animation-series', filter: 'tv' },
  { title: 'Misterio', type: 'mystery-series', filter: 'tv' },
  { title: 'Comedia', type: 'comedy-series', filter: 'tv' },
  { title: 'Thriller', type: 'thriller-series', filter: 'tv' },
  { title: 'Acción y aventura', type: 'action-series', filter: 'tv' },
  { title: 'Guerra y política', type: 'war-series', filter: 'tv' },
  { title: 'Documentales', type: 'documentary-series', filter: 'tv' },
  { title: 'Drama y crimen', type: 'drama-crime-series', filter: 'tv' },
  { title: 'Sci-Fi y misterio', type: 'scifi-mystery-series', filter: 'tv' },
];

// IMDB quality filter — minimum rating and vote count
const MIN_RATING = 6.0;
const MIN_VOTE_COUNT = 50;

function SkeletonRow() {
  return (
    <div className="mb-[20px] md:mb-[28px]">
      <div className="h-[16px] w-36 bg-white/[0.04] rounded-lg animate-pulse mb-[8px] px-[3%]" />
      <div className="flex gap-[5px] px-[3%] pt-[16px]">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="shrink-0 w-[120px] sm:w-[155px] md:w-[220px] aspect-[2/3] rounded-lg skeleton-shimmer" />
        ))}
      </div>
    </div>
  );
}

function SkeletonHero() {
  return (
    <div className="nfx-hero">
      <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a0f]/60 via-transparent to-[#0a0a0f]" />
      <div className="absolute bottom-[12%] left-[4%] space-y-3">
        <div className="h-[48px] w-64 bg-white/[0.04] rounded-lg animate-pulse" />
        <div className="h-3 w-80 bg-white/[0.04] rounded-lg animate-pulse" />
        <div className="h-3 w-52 bg-white/[0.04] rounded-lg animate-pulse" />
        <div className="flex gap-3 mt-2">
          <div className="h-[44px] w-36 bg-white/[0.04] rounded-full animate-pulse" />
          <div className="h-[44px] w-44 bg-white/[0.04] rounded-full animate-pulse" />
        </div>
      </div>
    </div>
  );
}

function NetflixFooter() {
  return (
    <footer className="relative z-10 px-[3%] pt-12 pb-[80px] md:pb-12">
      {/* Divider — warm gradient */}
      <div className="h-px bg-gradient-to-r from-transparent via-[#e50914]/10 to-transparent mb-8" />

      <div className="flex gap-3 mb-6">
        {[Facebook, Instagram, Youtube].map((Icon, i) => (
          <a key={i} href="#" className="w-9 h-9 rounded-full flex items-center justify-center text-white/15 hover:text-[#e50914] hover:bg-[#e50914]/10 transition-all duration-300" aria-label="Social">
            <Icon className="w-[18px] h-[18px]" />
          </a>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1.5 mb-8">
        {['Centro de ayuda', 'Términos de uso', 'Privacidad', 'Preferencias de cookies', 'Avisos legales', 'Información corporativa', 'Contáctanos', 'Prensa'].map((link) => (
          <a key={link} href="#" className="nfx-footer-link">{link}</a>
        ))}
      </div>

      <p className="text-[10px] text-white/12 leading-relaxed">
        © 2026 StreamX. Todo el contenido proviene de fuentes externas. StreamX no almacena ningún archivo.
      </p>
    </footer>
  );
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function formatRemaining(seconds: number): string {
  if (!seconds || seconds < 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m < 60) return `${m}m ${s}s restantes`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m restantes`;
}

/* ── Continue Watching Row — wide cards with progress bar ── */
function ContinueWatchingRow({ items }: { items: ContinueWatchingItem[] }) {
  const playMovie = useStore(s => s.playMovie);
  const playEpisode = useStore(s => s.playEpisode);
  const removeFromContinueWatching = useStore(s => s.removeFromContinueWatching);

  if (items.length === 0) return null;

  const handleClick = (cw: ContinueWatchingItem) => {
    // Build a minimal MediaItem to feed the player open path.
    const item: MediaItem = {
      id: cw.id,
      title: cw.type === 'movie' ? cw.title : undefined,
      name: cw.type === 'tv' ? cw.title : undefined,
      poster_path: cw.poster_path || null,
      backdrop_path: cw.backdrop_path || null,
      overview: '',
      vote_average: 0,
      media_type: cw.type,
    } as MediaItem;
    if (cw.type === 'tv') {
      // Need to set selectedItem first for playEpisode to work.
      useStore.getState().handleCardClick(item);
      const s = cw.last_season_watched ? Number(cw.last_season_watched) : 1;
      const e = cw.last_episode_watched ? Number(cw.last_episode_watched) : 1;
      setTimeout(() => playEpisode(s, e), 0);
    } else {
      playMovie(item);
    }
  };

  return (
    <div className="mb-[20px] md:mb-[28px]">
      <div className="px-[3%] mb-[8px]">
        <h2 className="text-white font-bold text-[16px] md:text-[18px] select-none">Seguir viendo</h2>
      </div>
      <div className="flex gap-[8px] md:gap-[12px] overflow-x-auto px-[3%] pb-2 scrollbar-hide">
        {items.map((cw) => {
          const pct = cw.progress.duration > 0 ? Math.min(100, (cw.progress.watched / cw.progress.duration) * 100) : 0;
          const remaining = cw.progress.duration - cw.progress.watched;
          const img = cw.backdrop_path
            ? `https://image.tmdb.org/t/p/w300${cw.backdrop_path}`
            : cw.poster_path
              ? `https://image.tmdb.org/t/p/w185${cw.poster_path}`
              : '';
          return (
            <div
              key={cw.id}
              className="nfx-glass-card shrink-0 w-[260px] md:w-[320px] cursor-pointer overflow-hidden group relative"
              onClick={() => handleClick(cw)}
            >
              <div className="relative aspect-video bg-[#1a1a20] overflow-hidden">
                {img && (
                  <img src={img} alt={cw.title} className="w-full h-full object-cover" loading="lazy" />
                )}
                {/* Dark gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                {/* Play button on hover */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
                    <Play className="w-5 h-5 fill-[#0a0a0f] text-[#0a0a0f] ml-0.5" />
                  </div>
                </div>
                {/* Remove button */}
                <button
                  onClick={(e) => { e.stopPropagation(); removeFromContinueWatching(cw.id); }}
                  className="absolute top-2 right-2 w-7 h-7 rounded-full glass flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Quitar de continuar viendo"
                >
                  <XIcon className="w-3.5 h-3.5 text-white/80" />
                </button>
                {/* Episode badge */}
                {cw.type === 'tv' && cw.last_season_watched && cw.last_episode_watched && (
                  <div className="absolute top-2 left-2 nfx-glass-chip text-[10px]">
                    T{cw.last_season_watched} · E{cw.last_episode_watched}
                  </div>
                )}
              </div>
              <div className="p-3">
                <p className="text-white text-[13px] font-medium truncate mb-1">{cw.title}</p>
                <p className="text-white/35 text-[11px] mb-2">{formatRemaining(remaining)}</p>
                {/* Progress bar */}
                <div className="h-1 bg-white/15 rounded-full overflow-hidden">
                  <div className="h-full bg-[#e50914] rounded-full" style={{ width: `${pct}%` }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


/* ── Mi Lista Tab ── */
function MiListaTab() {
  const { myList, handleCardClick, setActiveTab } = useStore();

  if (myList.length === 0) {
    return (
      <div className="px-[3%] py-20 text-center">
        <div className="w-16 h-16 rounded-2xl bg-[#e50914]/10 mx-auto mb-4 flex items-center justify-center">
          <Heart className="w-7 h-7 text-[#e50914]/40" />
        </div>
        <p className="text-white/40 text-lg font-medium mb-2">Tu lista está vacía</p>
        <p className="text-white/20 text-sm mb-6">Agrega pelis y series tocando el corazón</p>
        <button onClick={() => setActiveTab('peliculas')} className="nfx-btn-play !h-11 !text-sm">
          <Play className="w-4 h-4 fill-[#0a0a0f] text-[#0a0a0f]" />
          Explora películas
        </button>
      </div>
    );
  }

  return (
    <div className="px-[3%] py-8">
      <h1 className="nfx-font-hero text-[28px] md:text-[36px] text-white mb-6">Mi Lista</h1>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-4">
        {myList.map((item) => (
          <div
            key={item.id}
            className="cursor-pointer group"
            onClick={() => handleCardClick(item)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCardClick(item); }}
          >
            <div className="nfx-card-img">
              {item.poster_path ? (
                <img
                  src={`https://image.tmdb.org/t/p/w185${item.poster_path}`}
                  alt={item.title || item.name || ''}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full bg-[#22222a] flex items-center justify-center">
                  <span className="text-white/20 text-xs">{item.title || item.name}</span>
                </div>
              )}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                <div className="w-12 h-12 rounded-full bg-[#e50914]/20 flex items-center justify-center border border-[#e50914]/30">
                  <Play className="w-6 h-6 fill-white text-white ml-0.5" />
                </div>
              </div>
            </div>
            <p className="text-white/70 text-[13px] mt-2 truncate group-hover:text-white transition-colors">
              {item.title || item.name}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Search Tab ── */
function SearchTab() {
  const handleCardClick = useStore((s) => s.handleCardClick);
  const noSourceIds = useStore((s) => s.noSourceIds);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MediaItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [checkingSources, setCheckingSources] = useState(false);
  const checkedRef = useRef<Set<string>>(new Set()); // Cache checked queries

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/tmdb?type=search&query=${encodeURIComponent(query)}`);
        const data = await res.json();
        
        // Filter: only movies and series with poster, good IMDB rating, and not blacklisted
        const filtered = (data.results || []).filter(
          (item: { media_type: string; poster_path: string | null; vote_average?: number; vote_count?: number; id?: number }) =>
            (item.media_type === 'movie' || item.media_type === 'tv') && 
            item.poster_path &&
            (item.vote_average || 0) >= MIN_RATING &&
            (item.vote_count || 0) >= MIN_VOTE_COUNT &&
            item.id &&
            !noSourceIds.has(item.id)
        ).slice(0, 20) as MediaItem[];

        // Check source availability for the top results via source-check API
        setCheckingSources(true);
        const movieIds = filtered
          .filter((item: MediaItem) => item.media_type === 'movie' || (!item.media_type && !!item.title))
          .map((item: MediaItem) => item.id);
        const tvIds = filtered
          .filter((item: MediaItem) => item.media_type === 'tv' || (!item.media_type && !!item.name))
          .map((item: MediaItem) => item.id);

        const availableIds = new Set<number>();

        // Check movies
        if (movieIds.length > 0) {
          try {
            const checkRes = await fetch(`/api/source-check?ids=${movieIds.join(',')}&type=movie`);
            const checkData = await checkRes.json();
            for (const [id, avail] of Object.entries(checkData.available || {})) {
              if (avail) availableIds.add(parseInt(id));
            }
          } catch { /* source check failed, show all */ }
        }

        // Check TV
        if (tvIds.length > 0) {
          try {
            const checkRes = await fetch(`/api/source-check?ids=${tvIds.join(',')}&type=tv`);
            const checkData = await checkRes.json();
            for (const [id, avail] of Object.entries(checkData.available || {})) {
              if (avail) availableIds.add(parseInt(id));
            }
          } catch { /* source check failed, show all */ }
        }

        // If source check returned results, filter to only available
        if (availableIds.size > 0) {
          const sourceFiltered = filtered.filter((item: MediaItem) => availableIds.has(item.id));
          setResults(sourceFiltered.length > 0 ? sourceFiltered : filtered);
        } else {
          setResults(filtered);
        }

        setCheckingSources(false);
      } catch { setResults([]); setCheckingSources(false); }
      setIsSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, noSourceIds]);

  const handleSelect = (item: MediaItem) => {
    handleCardClick(item);
    setQuery('');
    setResults([]);
  };

  const getYear = (item: MediaItem) => {
    if (item.release_date) return item.release_date.substring(0, 4);
    if (item.first_air_date) return item.first_air_date.substring(0, 4);
    return '';
  };

  const isTv = (item: MediaItem) => item.media_type === 'tv' || (!item.media_type && !!item.name);

  return (
    <div className="px-[4%] py-4">
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e50914]/40" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar películas y series..."
            autoFocus
            className="w-full bg-[#1a1a20] border border-[#e50914]/15 rounded-xl text-white text-[16px] py-3 pl-11 pr-4 outline-none focus:border-[#e50914]/40 transition-colors placeholder:text-white/20"
          />
        </div>
        {query && (
          <button onClick={() => { setQuery(''); setResults([]); }} className="text-white/50 hover:text-white p-2">
            <XIcon className="w-5 h-5" />
          </button>
        )}
      </div>

      {query.trim() === '' && (
        <div className="text-white/30 text-center py-16">
          <Search className="w-12 h-12 mx-auto mb-4 text-[#e50914]/15" />
          <p className="text-lg">¿Qué quieres ver hoy?</p>
        </div>
      )}

      {query.trim() && (isSearching || checkingSources) && (
        <div className="text-white/40 text-center py-16">
          <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-white/20" />
          <p>{isSearching ? 'Buscando...' : 'Cargando...'}</p>
        </div>
      )}

      {query.trim() && !isSearching && !checkingSources && results.length === 0 && (
        <div className="text-white/30 text-center py-16">
          <p>No se encontraron resultados para &quot;{query}&quot;</p>
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((item) => (
            <button
              key={`${item.id}-${item.media_type}`}
              onClick={() => handleSelect(item)}
              className="flex items-center gap-3 w-full px-3 py-2.5 hover:bg-[#e50914]/8 rounded-xl transition-colors text-left"
            >
              {item.poster_path && (
                <img
                  src={`https://image.tmdb.org/t/p/w92${item.poster_path}`}
                  alt=""
                  className="w-[45px] h-[68px] object-cover shrink-0 rounded-[3px]"
                  loading="lazy"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-white text-[14px] truncate font-medium">
                  {item.title || item.name || ''}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[12px] text-white/40">{getYear(item)}</span>
                  <span className="inline-block bg-[#e50914]/15 text-[10px] text-[#ff5a63] rounded-full px-1.5 py-[1px]">
                    {isTv(item) ? 'Serie' : 'Película'}
                  </span>
                  {item.vote_average > 0 && (
                    <span className="text-[11px] text-[#34d399] font-medium">
                      {item.vote_average.toFixed(1)}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Downloads Tab ── */
function DownloadsTab() {
  const { downloads, removeDownload, playDirect, selectItem, setActiveTab } = useStore();

  const handlePlay = async (dl: DownloadItem) => {
    try {
      const dbReq = indexedDB.open('streamx-db', 1);
      await new Promise<void>((resolve, reject) => {
        dbReq.onupgradeneeded = () => {
          const db = dbReq.result;
          if (!db.objectStoreNames.contains('videos')) db.createObjectStore('videos');
        };
        dbReq.onsuccess = () => resolve();
        dbReq.onerror = () => reject(dbReq.error);
      });
      const db = dbReq.result;
      const tx = db.transaction('videos', 'readonly');
      const req = tx.objectStore('videos').get(dl.id);
      const blob: Blob | null = await new Promise((resolve) => {
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });

      if (!blob) {
        alert('El archivo no se encontró. Puede que necesites descargarlo de nuevo.');
        return;
      }

      const blobUrl = URL.createObjectURL(blob);
      const item: MediaItem = {
        id: dl.id,
        title: dl.title,
        name: dl.title,
        poster_path: dl.poster_path,
        backdrop_path: dl.backdrop_path,
        overview: '',
        vote_average: 0,
        media_type: dl.media_type,
      };
      playDirect(blobUrl, dl.title, item);
    } catch {
      alert('Error al reproducir el archivo descargado.');
    }
  };

  if (downloads.length === 0) {
    return (
      <div className="px-[3%] py-20 text-center">
        <div className="w-16 h-16 rounded-2xl bg-[#f5b342]/10 mx-auto mb-4 flex items-center justify-center">
          <Download className="w-7 h-7 text-[#f5b342]/40" />
        </div>
        <p className="text-white/40 text-lg font-medium mb-2">No hay descargas</p>
        <p className="text-white/20 text-sm mb-6">Descarga pelis y series para verlas sin conexión</p>
        <button onClick={() => setActiveTab('peliculas')} className="nfx-btn-play !h-11 !text-sm">
          <Play className="w-4 h-4 fill-[#0a0a0f] text-[#0a0a0f]" />
          Explora contenido
        </button>
      </div>
    );
  }

  return (
    <div className="px-[3%] py-8">
      <h1 className="nfx-font-hero text-[28px] md:text-[36px] text-white mb-6">Descargas</h1>
      <div className="space-y-3 max-w-3xl">
        {downloads.map((dl) => (
          <div
            key={dl.id}
            className="flex items-center gap-4 p-3 bg-[#1a1a20] rounded-xl group hover:bg-[#22222a] transition-colors"
          >
            <div
              className="w-[60px] h-[90px] rounded-lg overflow-hidden shrink-0 bg-[#22222a] cursor-pointer"
              onClick={() => dl.status === 'completed' ? handlePlay(dl) : undefined}
            >
              {dl.poster_path ? (
                <img
                  src={`https://image.tmdb.org/t/p/w200${dl.poster_path}`}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Play className="w-5 h-5 text-white/20" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-[14px] font-medium truncate">{dl.title}</p>
              <p className="text-white/40 text-[12px] mt-0.5">
                {dl.media_type === 'tv' ? 'Serie' : 'Película'}
                {dl.size && ` · ${formatFileSize(dl.size)}`}
              </p>
              {dl.status === 'downloading' && (
                <div className="mt-2 w-full h-[4px] bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-[#e50914] rounded-full transition-all duration-300" style={{ width: `${dl.progress}%` }} />
                </div>
              )}
              <div className="flex items-center gap-1.5 mt-1">
                {dl.status === 'downloading' && (
                  <><Loader2 className="w-3 h-3 text-[#f5b342] animate-spin" /><span className="text-[#f5b342] text-[11px]">{dl.progress}% descargando...</span></>
                )}
                {dl.status === 'completed' && (
                  <><CheckCircle className="w-3 h-3 text-[#34d399]" /><span className="text-[#34d399] text-[11px]">Descargado</span></>
                )}
                {dl.status === 'error' && (
                  <><AlertCircle className="w-3 h-3 text-red-400" /><span className="text-red-400 text-[11px]">{dl.error || 'Error'}</span></>
                )}
                {dl.status === 'pending' && (
                  <><Loader2 className="w-3 h-3 text-white/30 animate-spin" /><span className="text-white/30 text-[11px]">Pendiente...</span></>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {dl.status === 'completed' && (
                <button onClick={() => handlePlay(dl)} className="w-9 h-9 rounded-full bg-gradient-to-br from-[#e50914] to-[#b00610] flex items-center justify-center hover:from-[#ff3d47] hover:to-[#e50914] transition-colors" title="Reproducir">
                  <Play className="w-4 h-4 fill-white text-white ml-0.5" />
                </button>
              )}
              <button onClick={() => removeDownload(dl.id)} className="w-9 h-9 rounded-full border border-white/15 flex items-center justify-center hover:border-[#e50914]/40 hover:bg-[#e50914]/10 transition-all opacity-0 group-hover:opacity-100" title="Eliminar">
                <XIcon className="w-4 h-4 text-white/70" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   VIEW ALL — full-screen grid for a category ("Ver todo")
   ═══════════════════════════════════════════════════════════════════ */
function ViewAllGrid({ section, onClose }: {
  section: { title: string; type: string; filter: 'movie' | 'tv' | 'all' };
  onClose: () => void;
}) {
  const handleCardClick = useStore((s) => s.handleCardClick);
  const noSourceIds = useStore((s) => s.noSourceIds);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch 3 pages (~60 titles) of the category in parallel
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    // Check local cache first (same key format as the home rows)
    const cacheKey = `tmdb:${section.type}`;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const { data } = JSON.parse(raw);
        if (data?.results?.length) setItems(data.results);
      }
    } catch { /* ignore */ }

    Promise.all(
      [1, 2, 3].map(p =>
        fetch(`/api/tmdb?type=${section.type}&page=${p}`)
          .then(r => r.json())
          .catch(() => ({ results: [] }))
      )
    ).then(pages => {
      if (cancelled) return;
      const seen = new Set<number>();
      const all: MediaItem[] = [];
      for (const page of pages) {
        for (const item of (page.results || []) as MediaItem[]) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          // Same quality filters as the home rows
          if (!item.poster_path) continue;
          if ((item.vote_average || 0) < MIN_RATING) continue;
          if ((item.vote_count || 0) < MIN_VOTE_COUNT) continue;
          if (item.media_type && item.media_type !== 'movie' && item.media_type !== 'tv') continue;
          if (section.filter !== 'all' && item.media_type && item.media_type !== section.filter) continue;
          if (noSourceIds.has(item.id)) continue;
          all.push(item);
        }
      }
      setItems(all);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [section.type, section.filter, noSourceIds]);

  // ESC to close + lock body scroll
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[1500] bg-[#0a0a0f] overflow-y-auto animate-nfx-fade-in">
      <div className="sticky top-0 z-10 bg-[#0a0a0f]/95 backdrop-blur-sm border-b border-white/[0.06] px-[3%] py-4 flex items-center justify-between">
        <h1 className="nfx-font-hero text-[22px] md:text-[28px] text-white">{section.title}</h1>
        <button
          onClick={onClose}
          className="w-10 h-10 rounded-full bg-white/[0.07] hover:bg-white/[0.15] flex items-center justify-center text-white/70 hover:text-white transition-all active:scale-95 cursor-pointer"
          aria-label="Cerrar"
        >
          <XIcon className="w-5 h-5" />
        </button>
      </div>

      <div className="px-[3%] py-6">
        {loading && items.length === 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-4">
            {Array.from({ length: 18 }).map((_, i) => (
              <div key={i} className="aspect-[2/3] rounded-lg bg-white/[0.04] animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="text-white/40 text-center py-20">No hay contenido disponible</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-4">
            {items.map((item) => (
              <div
                key={item.id}
                className="cursor-pointer group"
                onClick={() => handleCardClick(item)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCardClick(item); }}
              >
                <div className="nfx-card-img">
                  {item.poster_path ? (
                    <img
                      src={`https://image.tmdb.org/t/p/w185${item.poster_path}`}
                      alt={item.title || item.name || ''}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full bg-[#22222a] flex items-center justify-center">
                      <span className="text-white/20 text-xs">{item.title || item.name}</span>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                    <div className="w-12 h-12 rounded-full bg-[#e50914]/20 flex items-center justify-center border border-[#e50914]/30">
                      <Play className="w-6 h-6 fill-white text-white ml-0.5" />
                    </div>
                  </div>
                </div>
                <p className="text-white/70 text-[13px] mt-2 truncate group-hover:text-white transition-colors">
                  {item.title || item.name}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN HOME COMPONENT
   ═══════════════════════════════════════════════════════════════════ */

export default function Home() {
  const { activeTab, continueWatching, myList, isPlaying, downloads, hydrateMyList, noSourceIds } = useStore();

  // Hydrate myList and blacklist from localStorage after mount
  useEffect(() => {
    hydrateMyList();
  }, [hydrateMyList]);

  // Download the lazily-split modal/player chunks in the background
  // IMMEDIATELY — pressing Play must never wait for a 567KB chunk download.
  useEffect(() => {
    const t = setTimeout(() => {
      import('@/components/netflix/DetailModal').catch(() => {});
      import('@/components/netflix/VideoPlayer').catch(() => {});
    }, 0);
    return () => clearTimeout(t);
  }, []);

  // Boot the /api/source serverless function NOW so it's hot when the user
  // presses Play — kills the cold-start penalty (measured: cold source
  // resolution took 3.1s, warm ~1s).
  useEffect(() => {
    fetch('/api/source?warm=1').catch(() => {});
  }, []);

  const [sections, setSections] = useState<ContentSection[]>([]);
  const [trendingItems, setTrendingItems] = useState<MediaItem[]>([]);
  const [viewAll, setViewAll] = useState<{ title: string; type: string; filter: 'movie' | 'tv' | 'all' } | null>(null);
  const [sourceCheckedIds, setSourceCheckedIds] = useState<Set<number>>(new Set());
  const sourceCheckInProgress = useRef(false);
  // Avoid SSR/CSR hydration mismatch: continue-watching comes from
  // localStorage which is only available on the client.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // ── LAZY loading: only a few rows load on mount; the rest load as the
  // user approaches the bottom (IntersectionObserver on a sentinel). This
  // avoids firing ~31 TMDB category requests the moment the page opens.
  const INITIAL_ROWS = 5;
  const ROWS_PER_BATCH = 4;
  const [loadedCount, setLoadedCount] = useState(INITIAL_ROWS);
  const fetchedTypesRef = useRef<Set<string>>(new Set());
  const bottomSentinelRef = useRef<HTMLDivElement>(null);

  // Helper: determine media type for an item
  const getMediaType = useCallback((item: MediaItem): 'movie' | 'tv' => {
    if (item.media_type === 'tv' || item.media_type === 'movie') return item.media_type;
    if (item.name && !item.title) return 'tv';
    return 'movie';
  }, []);

  // Get sections based on active tab
  const getActiveSections = useCallback(() => {
    if (activeTab === 'peliculas') return MOVIE_SECTIONS;
    if (activeTab === 'series') return SERIES_SECTIONS;
    return HOME_SECTIONS;
  }, [activeTab]);

  // Reset lazy-loading state when the tab changes
  useEffect(() => {
    fetchedTypesRef.current = new Set();
    setLoadedCount(INITIAL_ROWS);
    setSourceCheckedIds(new Set());
  }, [activeTab, getActiveSections]);

  // Load sections up to `loadedCount` (lazy). Trending (hero) is always
  // fetched first, then the first INITIAL_ROWS rows, then more on scroll.
  useEffect(() => {
    let cancelled = false;
    const activeSections = getActiveSections();
    const wanted = activeSections.slice(0, loadedCount);

    // Initialize slots + set visible ones to loading state (but keep the
    // data already loaded for rows that are still in view)
    setSections(prev => activeSections.map((s, idx) => {
      const existing = prev.find(p => p.type === s.type);
      const loading = idx < loadedCount && !(existing && existing.data.length > 0);
      return {
        ...s,
        data: existing?.data || [],
        loading,
      };
    }));

    // ── LOCAL CACHE with stale-while-revalidate ──
    // Sections are cached in localStorage (trending 5 min, lists 1 h).
    // Repeat visits render INSTANTLY from cache; stale data is shown
    // immediately and refreshed in the background.
    const cacheTtl = (type: string) => type === 'trending' ? 5 * 60 * 1000 : 60 * 60 * 1000;

    function readCache(type: string): { results: MediaItem[] } | null {
      try {
        const raw = localStorage.getItem(`tmdb:${type}`);
        if (!raw) return null;
        const { data, ts } = JSON.parse(raw);
        if (!data?.results || Date.now() - ts > cacheTtl(type) * 2) {
          localStorage.removeItem(`tmdb:${type}`);
          return null;
        }
        return data;
      } catch { return null; }
    }

    function writeCache(type: string, data: { results?: MediaItem[] }) {
      try {
        if (data?.results?.length) {
          localStorage.setItem(`tmdb:${type}`, JSON.stringify({ data, ts: Date.now() }));
        }
      } catch { /* quota full — ignore */ }
    }

    async function fetchSection(type: string) {
      // 1. Fresh local cache → use it, no network at all
      const cachedData = readCache(type);
      if (cachedData) {
        // Stale-while-revalidate: if past TTL, refresh quietly in background
        if (Date.now() - JSON.parse(localStorage.getItem(`tmdb:${type}`)!).ts > cacheTtl(type)) {
          fetch(`/api/tmdb?type=${type}`)
            .then(r => r.json())
            .then(fresh => { if (!cancelled) writeCache(type, fresh); })
            .catch(() => {});
        }
        return { type, data: cachedData };
      }
      // 2. No cache → network (edge-cached on Vercel, so usually fast)
      const r = await fetch(`/api/tmdb?type=${type}`);
      const data = await r.json();
      writeCache(type, data);
      return { type, data };
    }

    async function loadAll() {
      // ALL sections load in PARALLEL — including trending. The old code
      // awaited trending before firing the rest, adding ~500ms serially.
      // SKIP any type already fetched (scroll-loading never refetches).
      const toFetch = wanted.filter(s => !fetchedTypesRef.current.has(s.type));
      const results = await Promise.all(
        toFetch.map(async (section) => {
          try { return await fetchSection(section.type); }
          catch { return { type: section.type, data: { results: [] } }; }
        })
      );

      if (cancelled) return;

      for (const result of results) {
        fetchedTypesRef.current.add(result.type);

        // Trending feeds the hero carousel AND its own row
        if (result.type === 'trending') {
          const trending = (result.data.results || [])
            .filter((item: MediaItem) =>
              item.poster_path &&
              (item.vote_average || 0) >= MIN_RATING &&
              (item.vote_count || 0) >= MIN_VOTE_COUNT &&
              (item.media_type === 'movie' || item.media_type === 'tv')
            );
          setTrendingItems(trending);
        }

        const items: MediaItem[] = (result.data.results || [])
          .filter((item: MediaItem) =>
            item.poster_path &&
            (item.vote_average || 0) >= MIN_RATING &&
            (item.vote_count || 0) >= MIN_VOTE_COUNT
          );
        const idx = wanted.findIndex(s => s.type === result.type);
        if (idx >= 0) {
          setSections(prev => {
            const next = [...prev];
            next[idx] = { ...next[idx], data: items, loading: false };
            return next;
          });
        }
      }
    }

    loadAll();
    return () => { cancelled = true; };
  }, [activeTab, getActiveSections, loadedCount]);

  // Load more rows when the user scrolls near the bottom
  useEffect(() => {
    const el = bottomSentinelRef.current;
    if (!el) return;
    const total = getActiveSections().length;
    const obs = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) {
        setLoadedCount(c => (c < total ? Math.min(c + ROWS_PER_BATCH, total) : c));
      }
    }, { rootMargin: '800px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [getActiveSections, loadedCount]);

  // Background source check — check Vimeus for items that loaded
  // This runs AFTER sections are loaded and checks availability in batches
  useEffect(() => {
    if (sourceCheckInProgress.current) return;
    
    // Collect all loaded item IDs
    const allItems: { id: number; type: string }[] = [];
    for (const section of sections) {
      if (section.loading) continue;
      for (const item of section.data) {
        if (!sourceCheckedIds.has(item.id) && !noSourceIds.has(item.id)) {
          const mt = getMediaType(item);
          allItems.push({ id: item.id, type: mt });
        }
      }
    }

    if (allItems.length === 0) return;

    // Deduplicate
    const seen = new Set<number>();
    const unique = allItems.filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });

    if (unique.length === 0) return;

    sourceCheckInProgress.current = true;

    // Check in batches of 20
    const movieIds = unique.filter(i => i.type === 'movie').map(i => i.id);
    const tvIds = unique.filter(i => i.type === 'tv').map(i => i.id);

    const unavailableIds = new Set<number>();

    (async () => {
      // Check movies in batches
      for (let i = 0; i < movieIds.length; i += 20) {
        const batch = movieIds.slice(i, i + 20);
        try {
          const res = await fetch(`/api/source-check?ids=${batch.join(',')}&type=movie`);
          const data = await res.json();
          for (const [id, available] of Object.entries(data.available || {})) {
            if (!available) {
              unavailableIds.add(parseInt(id));
            }
          }
        } catch { /* source check failed, don't filter */ }
      }

      // Check TV in batches
      for (let i = 0; i < tvIds.length; i += 20) {
        const batch = tvIds.slice(i, i + 20);
        try {
          const res = await fetch(`/api/source-check?ids=${batch.join(',')}&type=tv`);
          const data = await res.json();
          for (const [id, available] of Object.entries(data.available || {})) {
            if (!available) {
              unavailableIds.add(parseInt(id));
            }
          }
        } catch { /* source check failed, don't filter */ }
      }

      // Update checked IDs
      setSourceCheckedIds(prev => {
        const next = new Set(prev);
        for (const item of unique) next.add(item.id);
        return next;
      });

      // Add unavailable IDs to blacklist
      if (unavailableIds.size > 0) {
        const { addToBlacklist } = useStore.getState();
        for (const id of unavailableIds) {
          addToBlacklist(id);
        }
      }

      sourceCheckInProgress.current = false;
    })();
  }, [sections, noSourceIds, sourceCheckedIds, getMediaType]);

  // Filter sections to remove blacklisted items (items with no sources)
  const filteredSections = useMemo(() => {
    return sections.map(section => ({
      ...section,
      data: section.data.filter(item => !noSourceIds.has(item.id)),
    }));
  }, [sections, noSourceIds]);

  // Further filter: in series tab, ensure NO movies leak through
  // In movies tab, ensure NO series leak through
  const cleanedSections = useMemo(() => {
    return filteredSections.map(section => {
      if (activeTab === 'series') {
        return {
          ...section,
          data: section.data.filter(item => getMediaType(item) === 'tv'),
        };
      }
      if (activeTab === 'peliculas') {
        return {
          ...section,
          data: section.data.filter(item => getMediaType(item) === 'movie'),
        };
      }
      return section;
    });
  }, [filteredSections, activeTab, getMediaType]);

  // Hero items filtered by tab. We deliberately do NOT filter the hero by
  // the source blacklist — the hero is the first thing users see and must
  // always show content. Availability is verified at playback time, so a
  // hero item without a known source simply shows "no disponible" if the
  // user tries to play it, rather than disappearing.
  const heroItems = useMemo(() => {
    if (activeTab === 'inicio') return trendingItems;
    const wanted = activeTab === 'peliculas' ? 'movie' : 'tv';
    return trendingItems.filter(item => getMediaType(item) === wanted);
  }, [trendingItems, activeTab, getMediaType]);

  const cwItems: MediaItem[] = useMemo(() => {
    return continueWatching.map(cw => ({
      id: cw.id,
      title: cw.title,
      name: cw.title,
      poster_path: cw.poster_path || null,
      backdrop_path: cw.backdrop_path || null,
      overview: '',
      vote_average: 0,
      media_type: cw.type,
    }));
  }, [continueWatching]);

  // Special tab content
  if (activeTab === 'buscar') {
    return (
      <div className="min-h-screen bg-[#0a0a0f]">
        <Navbar />
        <div className="pt-[64px]">
          <SearchTab />
        </div>
        <DetailModal />
        <VideoPlayer />
      </div>
    );
  }

  if (activeTab === 'mi-lista') {
    return (
      <div className="min-h-screen bg-[#0a0a0f]">
        <Navbar />
        <div className="pt-[64px]">
          <MiListaTab />
        </div>
        <DetailModal />
        <VideoPlayer />
      </div>
    );
  }

  if (activeTab === 'descargas') {
    return (
      <div className="min-h-screen bg-[#0a0a0f]">
        <Navbar />
        <div className="pt-[64px]">
          <DownloadsTab />
        </div>
        <DetailModal />
        <VideoPlayer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col">
      <Navbar />

      {/* Hero */}
      {heroItems.length > 0 ? (
        <HeroBanner items={heroItems} />
      ) : (
        <SkeletonHero />
      )}

      {/* Content rows with tab transition */}
      <div
        className="relative z-10 pb-16 md:pb-8 animate-nfx-tab-fade"
        key={activeTab}
      >
        {myList.length > 0 && activeTab === 'inicio' && (
          <ContentRow title="Mi Lista" items={myList} />
        )}
        {mounted && continueWatching.length > 0 && activeTab === 'inicio' && (
          <ContinueWatchingRow items={continueWatching} />
        )}

        {cleanedSections.map((section, idx) =>
          section.loading ? (
            <SkeletonRow key={section.type} />
          ) : (
            section.data.length > 0 && (
              <ContentRow
                key={section.type}
                title={section.title}
                items={section.data}
                isTopTen={section.isTopTen}
                rowIndex={idx}
                onViewAll={() => setViewAll({ title: section.title, type: section.type, filter: section.filter || 'all' })}
              />
            )
          )
        )}

        {/* Sentinel — triggers lazy-loading of the next rows */}
        <div ref={bottomSentinelRef} className="h-1" aria-hidden="true" />
      </div>

      <div className="mt-auto">
        <NetflixFooter />
      </div>

      <DetailModal />
      <VideoPlayer />
      {viewAll && <ViewAllGrid section={viewAll} onClose={() => setViewAll(null)} />}
    </div>
  );
}
