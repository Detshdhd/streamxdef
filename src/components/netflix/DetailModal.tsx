'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { X, Play, Plus, ThumbsUp, ChevronDown, ChevronUp, Download, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { useStore, type MediaDetail, type Episode } from '@/store/useStore';

/* ── Anime detection ── */
const ANIME_GENRE_IDS = [16]; // Animation genre in TMDB
function isLikelyAnime(item: { genre_ids?: number[]; original_language?: string; media_type?: string; name?: string }): boolean {
  const hasAnimation = item.genre_ids?.some(id => ANIME_GENRE_IDS.includes(id));
  const isJapanese = item.original_language === 'ja';
  return !!(hasAnimation && isJapanese);
}

function getContentTypeLabel(item: { genre_ids?: number[]; original_language?: string; media_type?: string; name?: string }): string {
  const isTV = item.media_type === 'tv' || !!item.name;
  if (isTV && isLikelyAnime(item)) return 'Anime';
  if (isTV) return 'Serie';
  return 'Película';
}

export default function DetailModal() {
  const showDetail = useStore(s => s.showDetail);
  const selectedItem = useStore(s => s.selectedItem);
  const selectedItemDetail = useStore(s => s.selectedItemDetail);
  const closeDetail = useStore(s => s.closeDetail);
  const setDetail = useStore(s => s.setDetail);
  const playMovie = useStore(s => s.playMovie);
  const playEpisode = useStore(s => s.playEpisode);
  const handleCardClick = useStore(s => s.handleCardClick);
  const selectedSeason = useStore(s => s.selectedSeason);
  const setSelectedSeason = useStore(s => s.setSelectedSeason);
  const selectedEpisode = useStore(s => s.selectedEpisode);
  const setSelectedEpisode = useStore(s => s.setSelectedEpisode);
  const episodes = useStore(s => s.episodes);
  const setEpisodes = useStore(s => s.setEpisodes);
  const setLoadingEpisodes = useStore(s => s.setLoadingEpisodes);
  const loadingEpisodes = useStore(s => s.loadingEpisodes);
  const isPlaying = useStore(s => s.isPlaying);
  const startDownload = useStore(s => s.startDownload);
  const downloads = useStore(s => s.downloads);

  const [showFullOverview, setShowFullOverview] = useState(false);
  const loadingRef = useRef(false);
  const fetchedIdRef = useRef<number | null>(null);
  const prefetchedSourceKeyRef = useRef<string | null>(null);

  const loadSeason = useCallback(async (tvId: number, seasonNum: number) => {
    setLoadingEpisodes(true);
    setSelectedSeason(seasonNum);
    try {
      const res = await fetch(`/api/tmdb?type=season-detail&id=${tvId}&season=${seasonNum}`);
      const data = await res.json();
      setEpisodes(data.episodes || []);
    } catch { setEpisodes([]); }
    setLoadingEpisodes(false);
  }, [setLoadingEpisodes, setSelectedSeason, setEpisodes]);

  useEffect(() => {
    if (!showDetail || !selectedItem || isPlaying) return;
    if (fetchedIdRef.current === selectedItem.id) return;
    const mediaType = selectedItem.media_type === 'tv' || selectedItem.name ? 'tv' : 'movie';
    const currentId = selectedItem.id;
    if (loadingRef.current) return;
    loadingRef.current = true;
    fetchedIdRef.current = currentId;

    // Details barely change — cache them in localStorage for 24h so opening
    // a title for the second time is instant, even after a reload.
    const detailCacheKey = `detail:${mediaType}:${currentId}`;
    try {
      const raw = localStorage.getItem(detailCacheKey);
      if (raw) {
        const { data: cached, ts } = JSON.parse(raw);
        if (cached && Date.now() - ts < 24 * 60 * 60 * 1000) {
          setDetail(cached);
          if (mediaType === 'tv' && cached.seasons && cached.seasons.length > 0) {
            loadSeason(currentId, 1);
          }
          loadingRef.current = false;
          return;
        }
      }
    } catch { /* corrupted entry — fall through to network */ }

    fetch(`/api/tmdb?type=detail-${mediaType}&id=${currentId}`)
      .then(res => res.json())
      .then((data: MediaDetail) => {
        if (selectedItem && selectedItem.id === currentId) {
          setDetail(data);
          try {
            localStorage.setItem(detailCacheKey, JSON.stringify({ data, ts: Date.now() }));
          } catch { /* quota full — ignore */ }
          if (mediaType === 'tv' && data.seasons && data.seasons.length > 0) {
            loadSeason(currentId, 1);
          }
        }
      })
      .catch(() => {})
      .finally(() => { loadingRef.current = false; });
  }, [showDetail, selectedItem?.id, isPlaying, setDetail, loadSeason, setEpisodes, selectedItem]);

  // Source resolution belongs to the player. Avoid scraping providers and
  // warming playlists while the user is only reading the detail screen.
  useEffect(() => {
    if (!showDetail) prefetchedSourceKeyRef.current = null;
  }, [showDetail]);

  useEffect(() => {
    if (showDetail && !isPlaying) {
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    };
  }, [showDetail, isPlaying]);

  useEffect(() => {
    if (!showDetail) {
      fetchedIdRef.current = null;
      prefetchedSourceKeyRef.current = null;
    }
  }, [showDetail]);

  // YouTube-style: the moment a movie modal opens, playback is likely next.
  // Make sure the lazily-split player chunk (567KB, hls.js included) is
  // downloaded NOW so pressing Play never waits for a chunk download.
  useEffect(() => {
    if (showDetail) {
      import('@/components/netflix/VideoPlayer').catch(() => {});
    }
  }, [showDetail]);

  if (!showDetail || !selectedItem || isPlaying) return null;

  const detail = selectedItemDetail;
  const mediaType = selectedItem.media_type === 'tv' || selectedItem.name ? 'tv' : 'movie';
  const isAnime = mediaType === 'tv' && isLikelyAnime(selectedItem);
  const contentTypeLabel = isAnime ? 'Anime' : (mediaType === 'tv' ? 'Serie' : 'Película');
  const title = detail?.title || detail?.name || selectedItem.title || selectedItem.name || '';
  const year = (detail?.release_date || detail?.first_air_date || selectedItem.release_date || selectedItem.first_air_date || '').substring(0, 4);
  const backdrop = detail?.backdrop_path || selectedItem.backdrop_path;
  const overview = detail?.overview || selectedItem.overview || '';
  const rating = detail?.vote_average || selectedItem.vote_average || 0;
  const runtime = detail?.runtime;

  const handlePlay = () => {
    if (mediaType === 'tv') {
      playEpisode(selectedSeason, 1);
    } else {
      playMovie(selectedItem);
    }
  };

  const formatRuntime = (min?: number) => {
    if (!min) return '';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const visibleSeasons = detail?.seasons?.filter(s => s.season_number > 0) || [];

  // Download state for this item
  const downloadItem = downloads.find(d => d.id === selectedItem.id);
  const isDownloaded = downloadItem?.status === 'completed';
  const isDownloading = downloadItem?.status === 'downloading';

  return (
    <div
      className="fixed inset-0 z-[1400] bg-black/70 overflow-y-auto overscroll-behavior-contain"
      onClick={closeDetail}
      style={{ scrollBehavior: 'auto' }}
    >
      {/* Centering wrapper */}
      <div
        className="flex justify-center min-h-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal content — solid #1f1f1f like the Apple TV /co detail page */}
        <div className="relative w-full max-w-[850px] min-h-screen shadow-[0_0_80px_rgba(0,0,0,0.9)] flex flex-col animate-nfx-modal-in rounded-none md:rounded-t-[18px] md:mt-4 bg-[#1f1f1f]">

          {/* Close button — glass */}
          <button
            onClick={closeDetail}
            className="absolute top-[12px] right-[12px] md:top-[16px] md:right-[16px] z-[1450] w-[36px] h-[36px] rounded-full glass flex items-center justify-center hover:bg-white/15 transition-colors duration-200"
            aria-label="Cerrar"
          >
            <X className="w-[18px] h-[18px] text-white" />
          </button>

          {/* Hero backdrop — 16:9 */}
          <div className="relative w-full aspect-[16/9] bg-[#1f1f1f] overflow-hidden shrink-0">
            {backdrop ? (
              <img
                src={`https://image.tmdb.org/t/p/w1280${backdrop}`}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-[#1d1d20] to-[#101012]" />
            )}

            <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/30" />

            <div className="absolute bottom-[24px] md:bottom-[32px] left-[24px] md:left-[32px] right-[60px]">
              <h2 className="nfx-font-hero text-[32px] md:text-[40px] text-white mb-4 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
                {title}
              </h2>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={handlePlay}
                  className="nfx-btn-play"
                >
                  <Play className="w-6 h-6 fill-black text-black" />
                  <span>Reproducir</span>
                </button>

                <button
                  className="nfx-circle-btn !w-[38px] !h-[38px]"
                  onClick={() => useStore.getState().toggleMyList(selectedItem)}
                >
                  <Plus className="w-5 h-5" />
                </button>
                <button
                  className="nfx-circle-btn !w-[38px] !h-[38px]"
                  onClick={() => useStore.getState().toggleMyList(selectedItem)}
                  title="Añadir a Mi Lista"
                >
                  <ThumbsUp className="w-4 h-4" />
                </button>

                {/* Download button */}
                <button
                  onClick={() => {
                    if (!isDownloading && !isDownloaded) {
                      startDownload(selectedItem);
                    }
                  }}
                  className="nfx-circle-btn !w-[38px] !h-[38px]"
                  title={isDownloaded ? 'Descargado' : 'Descargar'}
                >
                  {isDownloading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : isDownloaded ? (
                    <CheckCircle className="w-4 h-4 text-[#2cb67c]" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                </button>

                <button
                  className="nfx-circle-btn !w-[38px] !h-[38px] ml-auto"
                  onClick={() => setShowFullOverview(v => !v)}
                  title={showFullOverview ? 'Ocultar sinopsis' : 'Ver sinopsis'}
                >
                  <ChevronDown className={`w-5 h-5 transition-transform duration-200 ${showFullOverview ? 'rotate-180' : ''}`} />
                </button>
              </div>
            </div>
          </div>

          {/* Info section */}
          <div className="px-[24px] md:px-[32px] py-6 md:py-8">
            {!detail ? (
              <div className="space-y-4">
                <div className="h-5 bg-white/[0.04] rounded-lg animate-pulse w-2/3" />
                <div className="h-4 bg-white/[0.04] rounded-lg animate-pulse w-full" />
                <div className="h-4 bg-white/[0.04] rounded-lg animate-pulse w-5/6" />
              </div>
            ) : (
              <div className="flex flex-col md:flex-row gap-6 md:gap-8">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 md:gap-3 text-[13px] mb-3 flex-wrap">
                    {rating > 0 && (
                      <span className="text-white/70 font-bold">{Math.round(rating * 10)}% Relevante</span>
                    )}
                    <span className="text-white/50">{year}</span>
                    {runtime && runtime > 0 && (
                      <span className="text-white/50">{formatRuntime(runtime)}</span>
                    )}
                    <span className="text-white/30 border border-white/15 rounded-full px-1.5 py-[1px] text-[10px]">HD</span>
                    {/* Content type badge */}
                    <span className="inline-block bg-white/12 text-white/80 text-[10px] rounded-full px-2 py-[1px] font-medium">
                      {contentTypeLabel}
                    </span>
                  </div>

                  {overview && (
                    <p className={`text-white/55 text-[14px] leading-[1.7] mb-2 ${showFullOverview ? '' : 'line-clamp-3'}`}>
                      {overview}
                    </p>
                  )}
                  {overview && overview.length > 200 && (
                    <button
                      onClick={() => setShowFullOverview(!showFullOverview)}
                      className="text-white/70 text-sm hover:text-white hover:underline mb-4 inline-flex items-center gap-1 transition-colors duration-200"
                    >
                      {showFullOverview ? 'Ver menos' : 'Ver más'}
                      {showFullOverview ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  )}

                  {detail?.genres && detail.genres.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 text-[13px] mt-2">
                      {detail.genres.map((g, i) => (
                        <span key={g.id} className="nfx-glass-chip text-[11px]">
                          {g.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="md:w-[260px] shrink-0">
                  {/* Director */}
                  {detail?.credits?.crew && (() => {
                    const director = detail.credits.crew.find(c => c.job === 'Director');
                    const creators = detail.credits.crew.filter(c => c.job === 'Creator' || c.department === 'Writing').slice(0, 2);
                    const name = director?.name || creators.map(c => c.name).join(', ');
                    if (!name) return null;
                    return (
                      <div className="mb-4">
                        <p className="text-white/30 text-[13px] mb-1.5">{director ? 'Dirección' : 'Creación'}</p>
                        <p className="text-white/50 text-[13px] leading-[1.6]">{name}</p>
                      </div>
                    );
                  })()}
                  {/* Cast */}
                  {detail?.credits?.cast && detail.credits.cast.length > 0 && (
                    <div>
                      <p className="text-white/30 text-[13px] mb-1.5">Reparto</p>
                      <p className="text-white/50 text-[13px] leading-[1.6]">
                        {detail.credits.cast.slice(0, 8).map((p, i) => (
                          <span key={p.id}>
                            {i > 0 && <span className="text-white/20">, </span>}
                            <span className="hover:underline cursor-pointer">{p.name}</span>
                          </span>
                        ))}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Episode section (TV/Anime only) */}
            {mediaType === 'tv' && detail?.seasons && (
              <div className="mt-6 md:mt-8">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-white text-[18px] font-bold">
                    {isAnime ? 'Episodios' : 'Episodios'}
                  </h3>
                </div>

                {visibleSeasons.length > 0 && (
                  <div className="flex items-center gap-1 mb-4 overflow-x-auto scrollbar-hide bg-white/5 rounded-full p-1">
                    {visibleSeasons.map((season) => (
                      <button
                        key={season.id}
                        onClick={() => {
                          setSelectedEpisode(1);
                          loadSeason(selectedItem.id, season.season_number);
                        }}
                        className={`px-3 py-1.5 text-[12px] font-medium whitespace-nowrap transition-all duration-200 rounded-full ${
                          selectedSeason === season.season_number
                            ? 'bg-white text-black'
                            : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                        }`}
                      >
                        T{season.season_number}
                      </button>
                    ))}
                  </div>
                )}

                {loadingEpisodes && (
                  <div className="space-y-0">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex gap-3 p-3 animate-pulse">
                        <div className="w-8 h-6 bg-white/[0.06] rounded" />
                        <div className="w-28 h-16 bg-white/[0.06] rounded" />
                        <div className="flex-1 space-y-2 py-1">
                          <div className="h-3 bg-white/[0.06] rounded w-12" />
                          <div className="h-4 bg-white/[0.06] rounded w-3/4" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {!loadingEpisodes && episodes.length > 0 && (
                  <div>
                    {episodes.map((ep: Episode, idx: number) => (
                      <button
                        key={ep.id}
                        onClick={() => {
                          setSelectedEpisode(ep.episode_number);
                          playEpisode(selectedSeason, ep.episode_number);
                        }}
                        className={`nfx-ep-row w-full text-left rounded-xl ${
                          selectedEpisode === ep.episode_number && selectedSeason === selectedSeason
                            ? 'bg-white/[0.08]'
                            : ''
                        }`}
                      >
                        <div className="nfx-ep-num">
                          <span>{idx + 1}</span>
                          <div className="nfx-ep-play-icon">
                            <Play className="w-5 h-5 text-white fill-white" />
                          </div>
                        </div>

                        {ep.still_path ? (
                          <img
                            src={`https://image.tmdb.org/t/p/w300${ep.still_path}`}
                            alt=""
                            className="w-[112px] md:w-[130px] aspect-video object-cover rounded-lg shrink-0"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-[112px] md:w-[130px] aspect-video rounded-lg shrink-0 bg-[#1d1d20] flex items-center justify-center">
                            <Play className="w-4 h-4 text-white/20" />
                          </div>
                        )}

                        <div className="min-w-0 flex-1 py-0.5">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-white text-[14px] font-medium truncate">{ep.name}</p>
                            <span className="text-white/25 text-[12px] shrink-0">
                              {ep.runtime > 0 ? `${ep.runtime}m` : ''}
                            </span>
                          </div>
                          <p className="text-white/30 text-[12px] mt-1 line-clamp-2 leading-[1.5] hidden sm:block">
                            {ep.overview}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {!loadingEpisodes && episodes.length === 0 && (
                  <div className="text-white/30 text-sm text-center py-8">
                    {visibleSeasons.length > 0 ? 'Selecciona una temporada' : 'No hay episodios disponibles'}
                  </div>
                )}
              </div>
            )}

            {/* For movies: just show a big play button area */}
            {mediaType === 'movie' && !detail && (
              <div className="mt-6 flex justify-center py-8">
                <Loader2 className="w-8 h-8 text-white/40 animate-spin" />
              </div>
            )}

            {/* ── More Like This — similar titles ── */}
            {detail?.similar?.results && detail.similar.results.filter(s => s.poster_path).length > 0 && (
              <div className="mt-8 md:mt-10">
                <h3 className="text-white text-[18px] font-bold mb-4">Más como esto</h3>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                  {detail.similar.results.filter(s => s.poster_path).slice(0, 12).map((s) => (
                    <button
                      key={s.id}
                      onClick={() => handleCardClick(s)}
                      className="group text-left"
                    >
                      <div className="nfx-card-img aspect-[2/3]">
                        <img
                          src={`https://image.tmdb.org/t/p/w342${s.poster_path}`}
                          alt={s.title || s.name || ''}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </div>
                      <p className="text-white/70 text-[12px] mt-2 line-clamp-1 group-hover:text-white transition-colors">
                        {s.title || s.name}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="h-20 shrink-0" />
        </div>
      </div>
    </div>
  );
}
