'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import {
  ArrowLeft, Maximize, Minimize, Play, Pause,
  SkipBack, SkipForward, Volume2, VolumeX, Volume1, AlertCircle, Subtitles,
} from 'lucide-react';
import {
  useStore,
} from '@/store/useStore';

/* ─── Types ──────────────────────────────────────────────────────── */

interface SourceInfo {
  name: string;
  url: string;
  type: 'hls' | 'mp4';
  quality?: string;
  language: string | null;
}

interface PlayerInnerProps {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  season?: number;
  episode?: number;
  title: string;
  preloadedSources?: SourceInfo[];
}

/* ─── Client-side source cache ──────────────────────────────────── */
// Sources are expensive to resolve (1-5s of live scraping). Cache them in
// sessionStorage for 10 minutes so re-opening a movie or switching language
// is instant. Keys: "src:{tmdbId}:{type}:{s}:{e}".
const SOURCE_CACHE_TTL = 10 * 60 * 1000; // 10 min (matches server-side)

function getCachedSources(key: string): SourceInfo[] | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { sources, ts } = JSON.parse(raw);
    if (Date.now() - ts > SOURCE_CACHE_TTL) {
      sessionStorage.removeItem(key);
      return null;
    }
    return sources;
  } catch { return null; }
}

function setCachedSources(key: string, sources: SourceInfo[]) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ sources, ts: Date.now() }));
  } catch { /* quota full — ignore */ }
}

/* ─── Helpers ────────────────────────────────────────────────────── */

function proxyUrl(originalUrl: string): string {
  const url = originalUrl.toLowerCase();

  // These domains MUST go through our proxy (need correct Referer)
  const mustProxy = ['hakunaymatata', 'goodstream', 'voe', 'filemoon', 'ironwallnet', 'vidrock', 'workers.dev', 'vidvault', '1shows.app', 'tiktokcdn'];
  if (mustProxy.some(d => url.includes(d))) {
    return `/api/proxy?url=${encodeURIComponent(originalUrl)}`;
  }

  // All others → proxy through our server
  return `/api/proxy?url=${encodeURIComponent(originalUrl)}`;
}

function formatTime(s: number): string {
  if (!s || isNaN(s) || !isFinite(s)) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function isIOS(): boolean {
  if (typeof window === 'undefined') return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function getLangDisplayName(lang: string | null): string {
  if (!lang) return 'Desconocido';
  const l = lang.toLowerCase().trim();
  if (/ingl|engl|en\b|english/.test(l)) return 'Ingles';
  if (/latino/.test(l)) return 'Espanol Latino';
  if (/sub/.test(l) && /esp/.test(l)) return 'Sub Espanol';
  if (/castellano/.test(l)) return 'Espanol Castellano';
  if (/espanol|español|^es$|spanish/.test(l)) return 'Espanol';
  return lang;
}

function getLangKey(lang: string | null): string {
  if (!lang) return 'unknown';
  const l = lang.toLowerCase().trim();
  if (/ingl|engl|en\b|english/.test(l)) return 'en';
  if (/latino/.test(l)) return 'es-latino';
  if (/sub/.test(l) && /esp/.test(l)) return 'es-sub';
  if (/castellano/.test(l)) return 'es-castellano';
  if (/espanol|español|^es$|spanish/.test(l)) return 'es';
  return l;
}

function getAvailableLanguages(sources: SourceInfo[]): { key: string; label: string; sourceIndex: number }[] {
  const seen = new Map<string, { key: string; label: string; sourceIndex: number }>();
  sources.forEach((src, idx) => {
    const key = getLangKey(src.language);
    if (!seen.has(key)) {
      seen.set(key, { key, label: getLangDisplayName(src.language), sourceIndex: idx });
    }
  });
  return Array.from(seen.values());
}

function findSourceForLanguage(sources: SourceInfo[], langKey: string): number {
  return sources.findIndex(src => getLangKey(src.language) === langKey);
}

/* ═══════════════════════════════════════════════════════════════════
   MobilePlayer  —  triggers the phone's native video player
   ═══════════════════════════════════════════════════════════════════ */

function MobilePlayer({ tmdbId, mediaType, season, episode, title, preloadedSources }: PlayerInnerProps) {
  const closePlayer = useStore(s => s.closePlayer);
  const addToBlacklist = useStore(s => s.addToBlacklist);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sourceIdx, setSourceIdx] = useState(0);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const closedRef = useRef(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const switchingRef = useRef(false);
  // Preserves playback position across language switches (resume at same timestamp).
  const resumeTimeRef = useRef(0);

  // Continue Watching + next-episode + subtitles (parity with DesktopPlayer).
  const updateProgress = useStore(s => s.updateProgress);
  const getProgress = useStore(s => s.getProgress);
  const playEpisode = useStore(s => s.playEpisode);
  const selectedItem = useStore(s => s.selectedItem);
  const lastProgressSaveRef = useRef(0);
  const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);
  const subtitlesFetchedRef = useRef(false);

  // Fetch sources (or use preloaded/cached ones)
  useEffect(() => {
    if (preloadedSources && preloadedSources.length > 0) {
      setSources(preloadedSources);
      return;
    }

    let cancelled = false;
    const params = new URLSearchParams({ id: String(tmdbId), type: mediaType });
    if (mediaType === 'tv' && season && episode) {
      params.set('s', String(season));
      params.set('e', String(episode));
    }

    // Check client-side cache first — instant on repeat visits
    const cacheKey = `src:${tmdbId}:${mediaType}:${season || ''}:${episode || ''}`;
    const cached = getCachedSources(cacheKey);
    if (cached && cached.length > 0) {
      setSources(cached);
      return;
    }

    fetch(`/api/source?${params}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        const allSources = data.sources || [];
        if (allSources.length > 0) {
          setCachedSources(cacheKey, allSources);
          setSources(allSources);
        } else {
          setError('No se pudo reproducir este contenido');
          setLoading(false);
          addToBlacklist(tmdbId);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('No se pudo cargar el contenido');
          setLoading(false);
          addToBlacklist(tmdbId);
        }
      });

    return () => { cancelled = true; };
  }, [tmdbId, mediaType, season, episode, preloadedSources]);

  // Load video source
  useEffect(() => {
    if (sources.length === 0) return;
    const src = sources[sourceIdx];
    if (!src) return;

    const video = videoRef.current;
    if (!video) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    video.removeAttribute('src');
    video.load();

    setLoading(true);
    setError('');
    switchingRef.current = false;

    const loadTimeout = setTimeout(() => {
      if (switchingRef.current) return;
      switchingRef.current = true;
      if (sourceIdx < sources.length - 1) {
        setSourceIdx(prev => prev + 1);
      } else {
        setError('Este contenido no está disponible ahora');
        setLoading(false);
        addToBlacklist(tmdbId);
      }
    }, 10000);

    const handleError = () => {
      if (switchingRef.current) return;
      switchingRef.current = true;
      clearTimeout(loadTimeout);
      if (sourceIdx < sources.length - 1) {
        setSourceIdx(prev => prev + 1);
      } else {
        setError('Error al reproducir');
        setLoading(false);
        addToBlacklist(tmdbId);
      }
    };

    const onCanPlay = () => {
      clearTimeout(loadTimeout);
      setLoading(false);
      // Resume position: language switch (resumeTimeRef) or Continue Watching
      // (getProgress). Skip if nearly finished → restart from 0.
      let resumeAt = resumeTimeRef.current;
      if (resumeAt === 0) {
        const saved = getProgress(tmdbId);
        if (saved && saved.duration > 0 && saved.watched / saved.duration < 0.95) {
          resumeAt = saved.watched;
        }
      }
      if (resumeAt > 0 && video.duration && resumeAt < video.duration) {
        video.currentTime = resumeAt;
      }
      resumeTimeRef.current = 0;
      video.play().catch(() => {});
    };

    if (isIOS() && src.type === 'hls') {
      // iOS Safari plays HLS natively. Attach the same listeners as the plain
      // branch so the 15s loadTimeout is cleared on success — otherwise it
      // falsely fires, shows an error, and blacklists the title.
      video.src = proxyUrl(src.url);
      video.addEventListener('canplay', onCanPlay, { once: true });
      video.addEventListener('error', handleError, { once: true });
    } else if (src.type === 'hls' && Hls.isSupported()) {
      const proxiedUrl = proxyUrl(src.url);
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 15,
        maxMaxBufferLength: 20,
        manifestLoadingTimeOut: 15000,
        manifestLoadingMaxRetry: 3,
        levelLoadingTimeOut: 15000,
        levelLoadingMaxRetry: 4,
        fragLoadingTimeOut: 15000,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 500,
        startLevel: -1,
        capLevelToPlayerSize: false,
        abrEwmaDefaultEstimate: 5000000,
        maxBufferSize: 30 * 1000 * 1000,
        maxBufferHole: 0.5,
        startFragPrefetch: true,
        testBandwidth: false,
      });
      hlsRef.current = hls;
      hls.loadSource(proxiedUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        clearTimeout(loadTimeout);
        setLoading(false);
        if (resumeTimeRef.current > 0 && video.duration && resumeTimeRef.current < video.duration) {
          video.currentTime = resumeTimeRef.current;
        }
        resumeTimeRef.current = 0;
        video.play().catch(() => {});
      });

      // Jump straight to the BEST quality after the first fragment buffers —
      // measured: 1080p segments (434KB) load in ~0.33s, same as 360p (270KB),
      // so there's no bandwidth reason to stay low. Start low only for the
      // very first frame, then upgrade immediately.
      hls.once(Hls.Events.FRAG_BUFFERED, () => {
        if (hls.levels && hls.levels.length > 0) {
          hls.currentLevel = hls.levels.length - 1; // max quality
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              // Proxy/CDN hiccup — resume from current position instead of
              // killing the stream. This fixes "se cae en mitad del stream".
              console.log('[HLS] Fatal network error, recovering...');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log('[HLS] Fatal media error, recovering...');
              hls.recoverMediaError();
              break;
            default:
              // Truly unrecoverable — try next source
              handleError();
              break;
          }
        }
      });
    } else {
      video.src = proxyUrl(src.url);
      video.addEventListener('canplay', onCanPlay, { once: true });
      video.addEventListener('error', handleError, { once: true });
    }

    return () => {
      clearTimeout(loadTimeout);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('error', handleError);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [sources, sourceIdx]);

  // On mobile: save progress + auto-play next episode on end (TV), and close
  // when native fullscreen exits. Mirrors DesktopPlayer's Continue Watching.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const saveProgress = (atTime: number, dur: number) => {
      const poster = selectedItem?.poster_path || '';
      const backdrop = selectedItem?.backdrop_path || poster;
      updateProgress(tmdbId, mediaType, title, poster, backdrop, atTime, dur, season, episode);
    };

    const onEnded = () => {
      if (closedRef.current) return;
      if (video.duration > 0) saveProgress(video.duration, video.duration);
      if (mediaType === 'tv' && season && episode) {
        playEpisode(season, episode + 1); // auto-play next episode
      } else {
        closedRef.current = true;
        closePlayer();
      }
    };

    const onTimeUpdate = () => {
      // Save to Continue Watching at most every 5s.
      const now = Date.now();
      if (video.duration > 0 && now - lastProgressSaveRef.current > 5000) {
        lastProgressSaveRef.current = now;
        saveProgress(video.currentTime, video.duration);
      }
    };

    const onFullscreenChange = () => {
      if (!document.fullscreenElement && !closedRef.current) {
        closedRef.current = true;
        setTimeout(() => closePlayer(), 300);
      }
    };

    video.addEventListener('ended', onEnded);
    video.addEventListener('timeupdate', onTimeUpdate);
    document.addEventListener('fullscreenchange', onFullscreenChange);

    const onWebkitFSChange = () => {
      const el = document as unknown as { webkitFullscreenElement?: Element };
      if (!el.webkitFullscreenElement && !closedRef.current) {
        closedRef.current = true;
        setTimeout(() => closePlayer(), 300);
      }
    };
    document.addEventListener('webkitfullscreenchange', onWebkitFSChange);

    return () => {
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('timeupdate', onTimeUpdate);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onWebkitFSChange);
    };
  }, [closePlayer, updateProgress, playEpisode, selectedItem, tmdbId, mediaType, title, season, episode]);

  // Fetch Spanish subtitles once and attach as a <track> so the native mobile
  // player can offer them in its CC/subtitle picker.
  useEffect(() => {
    if (sources.length === 0 || subtitlesFetchedRef.current) return;
    subtitlesFetchedRef.current = true;
    const params = new URLSearchParams({ id: String(tmdbId), type: mediaType });
    if (mediaType === 'tv' && season && episode) {
      params.set('s', String(season));
      params.set('e', String(episode));
    }
    fetch(`/api/subtitles?${params}`)
      .then(r => {
        const ct = r.headers.get('content-type') || '';
        if (r.ok && (ct.includes('text/vtt') || ct.includes('text/plain'))) return r.text();
        return null;
      })
      .then(vtt => {
        if (vtt) setSubtitleUrl(URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' })));
      })
      .catch(() => {});
  }, [sources, tmdbId, mediaType, season, episode]);

  // Inject the subtitle <track> into the video element when available.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.querySelectorAll('track').forEach(t => t.remove());
    if (subtitleUrl) {
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = 'Español';
      track.srclang = 'es';
      track.src = subtitleUrl;
      video.appendChild(track);
    }
  }, [subtitleUrl]);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col items-center justify-center">
      <video
        ref={videoRef}
        className="absolute opacity-0 pointer-events-none"
        style={{ width: 1, height: 1 }}
        playsInline={false}
        autoPlay
      />

      {loading && sources.length > 0 && (
        <div className="w-32 h-[3px] bg-white/10 rounded-full overflow-hidden">
          <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-[#e50914] to-transparent rounded-full" style={{ animation: 'shimmerBar 1.5s ease-in-out infinite' }} />
        </div>
      )}

      {error && (
        <div className="flex flex-col items-center gap-7 px-8">
          <div className="w-14 h-14 rounded-2xl bg-red-500/[0.07] flex items-center justify-center border border-red-500/15 shadow-lg shadow-red-500/10">
            <AlertCircle className="w-7 h-7 text-red-400/70" />
          </div>
          <p className="text-white/80 text-lg font-semibold tracking-tight">{error}</p>
          <button
            onClick={closePlayer}
            className="px-8 py-3 bg-white/[0.06] hover:bg-white/[0.12] rounded-xl text-white/80 hover:text-white font-medium transition-all duration-300 border border-white/[0.08] hover:border-white/20 hover:shadow-lg hover:shadow-white/[0.03]"
           
          >
            Volver
          </button>
        </div>
      )}

      {sources.length === 0 && !error && (
        <div className="flex flex-col items-center">
          <h2 className="text-white text-xl font-bold tracking-tight mb-5 text-center px-6">{title}</h2>
          <div className="w-32 h-[3px] bg-white/10 rounded-full overflow-hidden">
            <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-[#e50914] to-transparent rounded-full" style={{ animation: 'shimmerBar 1.5s ease-in-out infinite' }} />
          </div>
        </div>
      )}

      {!loading && !error && sources.length > 0 && (
        <button
          onClick={closePlayer}
          className="absolute top-5 right-5 w-11 h-11 rounded-full bg-white/[0.07] backdrop-blur-xl flex items-center justify-center z-10 hover:bg-white/[0.15] transition-all duration-300 border border-white/[0.08] hover:border-white/20 shadow-lg shadow-black/40"
        >
          <span className="text-white/70 text-xl font-light hover:text-white/90 transition-colors">&times;</span>
        </button>
      )}

      {/* IDIOMA button — mobile language selector */}
      {!loading && !error && sources.length > 0 && (() => {
        const langs = getAvailableLanguages(sources);
        if (langs.length <= 1) return null;
        const currentLang = getLangDisplayName(sources[sourceIdx]?.language);
        return (
          <>
            <button
              onClick={() => setLangMenuOpen(!langMenuOpen)}
              className="absolute bottom-7 left-5 px-5 py-3 bg-[#e50914]/85 backdrop-blur-xl rounded-xl text-white text-sm font-semibold z-10 flex items-center gap-3 shadow-xl shadow-[#e50914]/25 hover:bg-[#e50914] transition-all duration-300 border border-[#e50914]/30"
             
            >
              IDIOMA
              <span className="w-px h-4 bg-white/25" />
              <span className="text-white/85 font-medium">{currentLang}</span>
            </button>
            {langMenuOpen && (
              <div className="absolute bottom-22 left-5 bg-[#131318]/98 backdrop-blur-2xl rounded-xl border border-white/[0.08] overflow-hidden min-w-[220px] shadow-2xl shadow-black/60 z-20">
                <div className="px-4 py-2.5 border-b border-white/[0.04] text-white/30 text-xs font-light tracking-[0.15em] uppercase">
                  Seleccionar idioma
                </div>
                {langs.map((lang) => (
                  <button
                    key={lang.key}
                    onClick={() => {
                      const idx = findSourceForLanguage(sources, lang.key);
                      if (idx >= 0 && idx !== sourceIdx) {
                        // Save position before switching so we resume there.
                        const v = videoRef.current;
                        if (v && v.currentTime > 0) {
                          resumeTimeRef.current = v.currentTime;
                        }
                        if (hlsRef.current) {
                          hlsRef.current.destroy();
                          hlsRef.current = null;
                        }
                        if (v) {
                          v.removeAttribute('src');
                          v.load();
                        }
                        setSourceIdx(idx);
                      }
                      setLangMenuOpen(false);
                    }}
                    className={`w-full text-left px-5 py-3.5 text-sm transition-all duration-200 ${
                      lang.sourceIndex === sourceIdx
                        ? 'bg-[#e50914]/15 text-white font-semibold'
                        : 'text-white/50 hover:bg-white/[0.04] hover:text-white/85'
                    }`}
                   
                  >
                    {lang.sourceIndex === sourceIdx && (
                      <span className="mr-2.5 text-[#e50914]">&#10003;</span>
                    )}
                    {lang.label}
                  </button>
                ))}
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   DesktopPlayer  —  Cinema-grade professional player (desktop only)
   
   Premium aesthetic: deep glass-morphism, cinematic gradients,
   red accent system, micro-interactions, sound visualization,
   keyboard shortcut overlay, time tooltip on progress hover.
   ═══════════════════════════════════════════════════════════════════ */

function DesktopPlayer({ tmdbId, mediaType, season, episode, title, preloadedSources }: PlayerInnerProps) {
  const closePlayer = useStore(s => s.closePlayer);
  const addToBlacklist = useStore(s => s.addToBlacklist);
  const updateProgress = useStore(s => s.updateProgress);
  const getProgress = useStore(s => s.getProgress);
  const playEpisode = useStore(s => s.playEpisode);
  const selectedItem = useStore(s => s.selectedItem);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const controlsTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const progressRef = useRef<HTMLDivElement>(null);
  const centerPlayTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const volumeSliderRef = useRef<HTMLDivElement>(null);

  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [currentSource, setCurrentSource] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [buffered, setBuffered] = useState(0);
  const [centerPlayVisible, setCenterPlayVisible] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [seekHint, setSeekHint] = useState<{ direction: string; seconds: number } | null>(null);
  const langMenuRef = useRef<HTMLDivElement>(null);
  const switchingRef = useRef(false);
  const prevSourceRef = useRef(-1);
  const seekHintTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Preserves playback position across language/server switches so the
  // video resumes at the same timestamp instead of restarting from 0.
  const resumeTimeRef = useRef(0);
  // Throttle for saving playback progress to "Continue Watching".
  const lastProgressSaveRef = useRef(0);
  // Auto-play next episode + skip intro + playback speed
  const [nextEpisodeCountdown, setNextEpisodeCountdown] = useState<number | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const nextEpisodeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const speedMenuRef = useRef<HTMLDivElement>(null);

  // ─── Keyboard shortcut hint overlay state (visual-only enhancement) ───
  const [shortcutHint, setShortcutHint] = useState<string | null>(null);
  const shortcutHintTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // ─── Progress bar hover state for time tooltip ───
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);

  // ─── Subtitles state ───
  const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);
  const [showSubtitles, setShowSubtitles] = useState(false);
  // Refs mirroring subtitle state so event handlers (registered once per
  // source load) always read the latest values without stale closures.
  const subtitleUrlRef = useRef<string | null>(null);
  const showSubtitlesRef = useRef(false);
  useEffect(() => { subtitleUrlRef.current = subtitleUrl; }, [subtitleUrl]);
  useEffect(() => { showSubtitlesRef.current = showSubtitles; }, [showSubtitles]);
  const [subtitleLoading, setSubtitleLoading] = useState(false);
  const subtitlesFetchedRef = useRef<Set<string>>(new Set());

  // FETCH SUBTITLES once per content (regardless of source language).
  // Subtitles are tied to the movie/episode, not to which server is
  // playing — so we fetch them as soon as sources load and keep them
  // available while switching between English / Latino sources.
  useEffect(() => {
    if (sources.length === 0) return;

    // Cache key is the content, not the source index, so switching
    // language/server never triggers a re-fetch or wipes the subtitle.
    const cacheKey = `${tmdbId}-${mediaType}-${season}-${episode}`;
    if (subtitlesFetchedRef.current.has(cacheKey)) return;
    subtitlesFetchedRef.current.add(cacheKey);

    setSubtitleLoading(true);
    const params = new URLSearchParams({ id: String(tmdbId), type: mediaType });
    if (mediaType === 'tv' && season && episode) {
      params.set('s', String(season));
      params.set('e', String(episode));
    }

    fetch(`/api/subtitles?${params}`)
      .then(r => {
        const ct = r.headers.get('content-type') || '';
        if (ct.includes('text/vtt') || ct.includes('text/plain')) {
          return r.text().then(vtt => {
            // Create a blob URL for the VTT content
            const blob = new Blob([vtt], { type: 'text/vtt' });
            const url = URL.createObjectURL(blob);
            setSubtitleUrl(url);
            setShowSubtitles(true);
            console.log('[Player] Spanish subtitles loaded');
          });
        }
        // If JSON response, no subtitles found
        return r.json().then(() => {
          setSubtitleUrl(null);
        });
      })
      .catch(() => {
        setSubtitleUrl(null);
      })
      .finally(() => {
        setSubtitleLoading(false);
      });
  }, [sources, tmdbId, mediaType, season, episode]);

  // Clean up blob URL on unmount
  useEffect(() => {
    return () => {
      if (subtitleUrl && subtitleUrl.startsWith('blob:')) {
        URL.revokeObjectURL(subtitleUrl);
      }
    };
  }, [subtitleUrl]);

  // FETCH SOURCES
  useEffect(() => {
    if (preloadedSources && preloadedSources.length > 0) {
      setSources(preloadedSources);
      return;
    }

    let cancelled = false;
    const params = new URLSearchParams({ id: String(tmdbId), type: mediaType });
    if (mediaType === 'tv' && season && episode) {
      params.set('s', String(season));
      params.set('e', String(episode));
    }

    // Check client-side cache first
    const cacheKey = `src:${tmdbId}:${mediaType}:${season || ''}:${episode || ''}`;
    const cached = getCachedSources(cacheKey);
    if (cached && cached.length > 0) {
      setSources(cached);
      return;
    }

    fetch(`/api/source?${params}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        const allSources = data.sources || [];
        if (allSources.length > 0) {
          setCachedSources(cacheKey, allSources);
          setSources(allSources);
        } else {
          setError('No se pudo reproducir este contenido');
          setLoading(false);
          addToBlacklist(tmdbId);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('No se pudo cargar el contenido');
          setLoading(false);
          addToBlacklist(tmdbId);
        }
      });

    return () => { cancelled = true; };
  }, [tmdbId, mediaType, season, episode, preloadedSources]);

  // LOAD VIDEO
  useEffect(() => {
    if (sources.length === 0) return;
    const src = sources[currentSource];
    if (!src) return;

    const video = videoRef.current;
    if (!video) return;

    if (prevSourceRef.current === currentSource) return;
    prevSourceRef.current = currentSource;

    // On the first source load for this title, restore the saved playback
    // position from "Continue Watching" (skip if nearly finished → restart).
    if (currentSource === 0 && resumeTimeRef.current === 0) {
      const saved = getProgress(tmdbId);
      if (saved && saved.duration > 0 && saved.watched / saved.duration < 0.95) {
        resumeTimeRef.current = saved.watched;
      }
    }

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    video.removeAttribute('src');
    video.load();

    setLoading(true);
    setError('');
    switchingRef.current = false;

    console.log(`[Player] Loading source ${currentSource + 1}/${sources.length}: ${src.name} (${src.language})`);

    const loadTimeout = setTimeout(() => {
      if (switchingRef.current) return;
      switchingRef.current = true;
      if (currentSource < sources.length - 1) {
        prevSourceRef.current = -1;
        setCurrentSource(prev => prev + 1);
      } else {
        setError('Este contenido no está disponible ahora');
        setLoading(false);
        addToBlacklist(tmdbId);
      }
    }, 10000);

    const onSourceError = () => {
      if (switchingRef.current) return;
      switchingRef.current = true;
      clearTimeout(loadTimeout);
      if (currentSource < sources.length - 1) {
        prevSourceRef.current = -1;
        setCurrentSource(prev => prev + 1);
      } else {
        setError('No se pudo reproducir este contenido');
        setLoading(false);
        addToBlacklist(tmdbId);
      }
    };

    const proxiedUrl = proxyUrl(src.url);

    if (src.type === 'hls' && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 15,
        maxMaxBufferLength: 20,
        manifestLoadingTimeOut: 15000,
        manifestLoadingMaxRetry: 3,
        levelLoadingTimeOut: 15000,
        levelLoadingMaxRetry: 4,
        fragLoadingTimeOut: 15000,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 500,
        startLevel: -1,
        capLevelToPlayerSize: false,
        abrEwmaDefaultEstimate: 5000000,
        maxBufferSize: 30 * 1000 * 1000,
        maxBufferHole: 0.5,
        startFragPrefetch: true,
        testBandwidth: false,
      });
      hlsRef.current = hls;
      hls.loadSource(proxiedUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        // Force MAX quality immediately — segments load in ~0.3s regardless
        // of resolution, so there's no speed gain from starting low.
        if (hls.levels && hls.levels.length > 0) {
          const top = hls.levels.length - 1;
          hls.startLevel = top;
          hls.currentLevel = top;
          hls.autoLevelCapping = top;
          hls.capLevelToPlayerSize = false;
        }
        clearTimeout(loadTimeout);
        setLoading(false);
        // Resume at saved position (language/server switch). We must wait
        // for loadedmetadata so video.duration is valid — in MANIFEST_PARSED
        // it is still NaN, which silently skipped the seek (movie restarted).
        const resumeAt = resumeTimeRef.current;
        if (resumeAt > 0) {
          const doSeek = () => {
            if (video.duration && isFinite(video.duration) && resumeAt < video.duration) {
              video.currentTime = resumeAt;
            }
            resumeTimeRef.current = 0;
            video.removeEventListener('loadedmetadata', doSeek);
          };
          // If metadata already loaded (duration valid), seek now.
          if (video.duration && isFinite(video.duration)) {
            doSeek();
          } else {
            video.addEventListener('loadedmetadata', doSeek);
          }
        }
        video.play().catch(() => {});
      });

      // Track non-fatal network errors so we can recover gracefully.
      let nonFatalRetries = 0;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          clearTimeout(loadTimeout);
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              // Proxy/CDN hiccup — resume from current position instead of
              // killing the stream. This fixes "se cae en mitad del stream".
              console.log('[HLS] Fatal network error, recovering...');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log('[HLS] Fatal media error, recovering...');
              hls.recoverMediaError();
              break;
            default:
              onSourceError();
              break;
          }
        } else if (!data.fatal && nonFatalRetries < 3) {
          // Transient fragment/level load errors — kick HLS to retry from
          // the current position instead of freezing silently.
          if (data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR ||
              data.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR ||
              data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
            nonFatalRetries++;
            setLoading(true);
            try { hls.startLoad(video.currentTime); } catch { /* ignore */ }
          }
        }
      });
    } else if (src.type === 'mp4') {
      video.src = proxiedUrl;
      video.addEventListener('loadedmetadata', () => {
        clearTimeout(loadTimeout);
        setLoading(false);
        if (resumeTimeRef.current > 0 && video.duration && resumeTimeRef.current < video.duration) {
          video.currentTime = resumeTimeRef.current;
        }
        resumeTimeRef.current = 0;
        video.play().catch(() => {});
      }, { once: true });
      video.addEventListener('error', onSourceError, { once: true });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = proxiedUrl;
      video.addEventListener('loadedmetadata', () => {
        clearTimeout(loadTimeout);
        setLoading(false);
        if (resumeTimeRef.current > 0 && video.duration && resumeTimeRef.current < video.duration) {
          video.currentTime = resumeTimeRef.current;
        }
        resumeTimeRef.current = 0;
        video.play().catch(() => {});
      }, { once: true });
      video.addEventListener('error', onSourceError, { once: true });
    } else {
      onSourceError();
    }

    return () => {
      clearTimeout(loadTimeout);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [sources, currentSource]);

  // SUBTITLE TRACK MANAGEMENT — apply subtitles to the video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Remove existing subtitle tracks
    const existingTracks = video.querySelectorAll('track');
    existingTracks.forEach(t => t.remove());

    // Clear text tracks mode
    for (let i = 0; i < video.textTracks.length; i++) {
      video.textTracks[i].mode = 'hidden';
    }

    if (subtitleUrl && showSubtitles) {
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = 'Español';
      track.srclang = 'es';
      track.src = subtitleUrl;
      track.default = true;
      video.appendChild(track);

      // Enable the track after a short delay (needs to be loaded)
      requestAnimationFrame(() => {
        for (let i = 0; i < video.textTracks.length; i++) {
          if (video.textTracks[i].language === 'es') {
            video.textTracks[i].mode = 'showing';
          }
        }
      });
    }
  }, [subtitleUrl, showSubtitles]);

  // VIDEO EVENTS
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => {
      setIsPaused(false);
      // Re-enable the Spanish subtitle track after a source reload —
      // video.load() resets textTrack modes to 'disabled'.
      if (subtitleUrlRef.current && showSubtitlesRef.current) {
        requestAnimationFrame(() => {
          for (let i = 0; i < video.textTracks.length; i++) {
            if (video.textTracks[i].language === 'es') {
              video.textTracks[i].mode = 'showing';
            }
          }
        });
      }
    };
    const onPause = () => setIsPaused(true);
    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      // Save progress to "Continue Watching" at most every 5 seconds.
      const now = Date.now();
      if (video.duration > 0 && now - lastProgressSaveRef.current > 5000) {
        lastProgressSaveRef.current = now;
        const poster = selectedItem?.poster_path || '';
        const backdrop = selectedItem?.backdrop_path || poster;
        updateProgress(tmdbId, mediaType, title, poster, backdrop, video.currentTime, video.duration, season, episode);
      }
    };
    const onDurationChange = () => setDuration(video.duration);
    const onProgress = () => {
      if (video.buffered.length > 0) {
        setBuffered(video.buffered.end(video.buffered.length - 1));
      }
    };
    const onEnded = () => {
      // Save final progress, then for series trigger the next-episode
      // auto-play countdown.
      if (video.duration > 0) {
        const poster = selectedItem?.poster_path || '';
        const backdrop = selectedItem?.backdrop_path || poster;
        updateProgress(tmdbId, mediaType, title, poster, backdrop, video.duration, video.duration, season, episode);
      }
      setIsPaused(true);
      if (mediaType === 'tv' && season && episode) {
        setNextEpisodeCountdown(10);
      }
    };
    const onCanPlay = () => setLoading(false);
    // Buffering feedback: show spinner when the video stalls waiting for
    // data, hide it once playback resumes. Without this, a network hiccup
    // mid-playback looks like a frozen app.
    const onWaiting = () => setLoading(true);
    const onPlaying = () => setLoading(false);
    const onSeeking = () => setLoading(true);
    const onSeeked = () => setLoading(false);

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('progress', onProgress);
    video.addEventListener('ended', onEnded);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('seeking', onSeeking);
    video.addEventListener('seeked', onSeeked);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('progress', onProgress);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('seeked', onSeeked);
    };
  }, [sources]);

  // Next-episode auto-play countdown
  useEffect(() => {
    if (nextEpisodeCountdown === null) return;
    if (nextEpisodeCountdown <= 0) {
      // Time's up — play next episode
      if (mediaType === 'tv' && season && episode) {
        playEpisode(season, episode + 1);
      }
      setNextEpisodeCountdown(null);
      return;
    }
    nextEpisodeTimer.current = setTimeout(() => {
      setNextEpisodeCountdown(prev => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => { if (nextEpisodeTimer.current) clearTimeout(nextEpisodeTimer.current); };
  }, [nextEpisodeCountdown, mediaType, season, episode, playEpisode]);

  // Apply playback rate to the video element whenever it changes
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = playbackRate;
  }, [playbackRate, currentSource]);

  // Close speed menu on outside click
  useEffect(() => {
    if (!speedMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (speedMenuRef.current && !speedMenuRef.current.contains(e.target as Node)) {
        setSpeedMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [speedMenuOpen]);

  // AGGRESSIVE SCROLL LOCK
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;

    const origHtmlOverflow = html.style.overflow;
    const origHtmlOverscroll = html.style.overscrollBehavior;
    const origBodyOverflow = body.style.overflow;
    const origBodyOverscroll = body.style.overscrollBehavior;
    const origBodyPosition = body.style.position;
    const origBodyTop = body.style.top;
    const origBodyWidth = body.style.width;

    html.style.overflow = 'hidden';
    html.style.overscrollBehavior = 'none';
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    body.style.position = 'fixed';
    body.style.top = '0';
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';

    return () => {
      html.style.overflow = origHtmlOverflow;
      html.style.overscrollBehavior = origHtmlOverscroll;
      body.style.overflow = origBodyOverflow;
      body.style.overscrollBehavior = origBodyOverscroll;
      body.style.position = origBodyPosition;
      body.style.top = origBodyTop;
      body.style.width = origBodyWidth;
    };
  }, []);

  // Prevent wheel/scroll events
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const preventWheel = (e: WheelEvent) => e.preventDefault();
    const preventTouchMove = (e: TouchEvent) => e.preventDefault();

    container.addEventListener('wheel', preventWheel, { passive: false });
    container.addEventListener('touchmove', preventTouchMove, { passive: false });

    return () => {
      container.removeEventListener('wheel', preventWheel);
      container.removeEventListener('touchmove', preventTouchMove);
    };
  }, []);

  // AUTO FULLSCREEN ON MOUNT
  useEffect(() => {
    const t = setTimeout(() => {
      if (containerRef.current && !document.fullscreenElement) {
        containerRef.current.requestFullscreen().catch(() => {});
      }
    }, 300);
    return () => clearTimeout(t);
  }, []);

  // FULLSCREEN CHANGE LISTENER
  useEffect(() => {
    const handler = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // AUTO-HIDE CONTROLS (3s timeout — Netflix standard)
  const resetTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
    controlsTimeout.current = setTimeout(() => {
      const v = videoRef.current;
      if (v && !v.paused) setShowControls(false);
    }, 3000);
  }, []);

  useEffect(() => {
    const onMouseMove = () => resetTimer();
    window.addEventListener('mousemove', onMouseMove);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
    };
  }, [resetTimer]);

  // LANGUAGE MENU — close on outside click
  useEffect(() => {
    if (!langMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) {
        setLangMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [langMenuOpen]);

  // VIDEO CONTROLS
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
    resetTimer();

    setCenterPlayVisible(true);
    if (centerPlayTimer.current) clearTimeout(centerPlayTimer.current);
    centerPlayTimer.current = setTimeout(() => setCenterPlayVisible(false), 600);
  }, [resetTimer]);

  const seek = useCallback((seconds: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + seconds));
    resetTimer();
  }, [resetTimer]);

  const seekTo = useCallback((pct: number) => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    v.currentTime = pct * v.duration;
    resetTimer();
  }, [resetTimer]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setIsMuted(v.muted);
    resetTimer();
  }, [resetTimer]);

  const changeVolume = useCallback((vol: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = Math.max(0, Math.min(1, vol));
    setVolume(v.volume);
    if (v.muted && vol > 0) { v.muted = false; setIsMuted(false); }
  }, []);

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await containerRef.current.requestFullscreen().catch(() => {});
    }
  };

  const handleClose = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    closePlayer();
  };

  // ─── Retry handler — resets source index to re-attempt playback ───
  const handleRetry = useCallback(() => {
    prevSourceRef.current = -1;
    setCurrentSource(0);
    setError('');
    setLoading(true);
  }, []);

  // ─── Shortcut hint helper (visual overlay only, no logic change) ───
  const showShortcutHint = useCallback((hint: string) => {
    setShortcutHint(hint);
    if (shortcutHintTimer.current) clearTimeout(shortcutHintTimer.current);
    shortcutHintTimer.current = setTimeout(() => setShortcutHint(null), 1200);
  }, []);

  // KEYBOARD SHORTCUTS
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
        handleClose();
        return;
      }

      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFullscreen(); showShortcutHint('F — Pantalla completa'); }
      if (e.key === ' ') { e.preventDefault(); togglePlay(); showShortcutHint(isPaused ? '▶ Play' : '⏸ Pause'); }
      if (e.key === 'ArrowRight') { e.preventDefault(); seek(10); setSeekHint({ direction: '→', seconds: 10 }); if (seekHintTimeout.current) clearTimeout(seekHintTimeout.current); seekHintTimeout.current = setTimeout(() => setSeekHint(null), 800); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); seek(-10); setSeekHint({ direction: '←', seconds: 10 }); if (seekHintTimeout.current) clearTimeout(seekHintTimeout.current); seekHintTimeout.current = setTimeout(() => setSeekHint(null), 800); }
      if (e.key === 'ArrowUp') { e.preventDefault(); changeVolume(volume + 0.1); resetTimer(); showShortcutHint('↑ Volumen'); }
      if (e.key === 'ArrowDown') { e.preventDefault(); changeVolume(volume - 0.1); resetTimer(); showShortcutHint('↓ Volumen'); }
      if (e.key === 'm' || e.key === 'M') { toggleMute(); showShortcutHint('M — Mute'); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [closePlayer, togglePlay, seek, toggleMute, changeVolume, volume, resetTimer, toggleFullscreen, showShortcutHint, isPaused]);

  // PROGRESS BAR INTERACTION
  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || !duration) return;
    const rect = progressRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekTo(pct);
  };

  const handleProgressHover = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || !duration) return;
    const rect = progressRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverTime(pct * duration);
    setHoverX(e.clientX - rect.left);
  };

  const handleProgressHoverEnd = () => {
    setHoverTime(null);
  };

  const handleVolumeClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    changeVolume(pct);
  };

  const changeLanguage = (langKey: string) => {
    const idx = findSourceForLanguage(sources, langKey);
    if (idx >= 0 && idx !== currentSource) {
      // Save current position before tearing down so we can resume there.
      const video = videoRef.current;
      if (video && video.currentTime > 0) {
        resumeTimeRef.current = video.currentTime;
      }
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (video) {
        video.removeAttribute('src');
        video.load();
      }
      prevSourceRef.current = -1;
      setCurrentSource(idx);
      console.log(`[Player] Switching language to ${langKey}, source index ${idx}, resume @ ${resumeTimeRef.current.toFixed(1)}s`);
    }
    setLangMenuOpen(false);
  };

  // Current source info (used by the language menu)
  const currentSourceInfo = sources[currentSource];


  const soundBars = !isMuted && volume > 0;


  // RENDER
  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[9999] bg-black select-none flex items-center justify-center"
      style={{ overflow: 'hidden', touchAction: 'none', cursor: showControls ? 'default' : 'none' }}
      onMouseMove={resetTimer}
    >
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-contain"
        playsInline
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
      />

      {/* ─── BUFFERING — subtle shimmer bar, no spinner ─── */}
      {loading && sources.length > 0 && (
        <div className="absolute inset-0 z-[5] flex items-center justify-center pointer-events-none">
          <div className="w-32 h-[3px] bg-white/10 rounded-full overflow-hidden">
            <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-[#e50914] to-transparent rounded-full" style={{ animation: 'shimmerBar 1.5s ease-in-out infinite' }} />
          </div>
        </div>
      )}

      {/* ─── ERROR STATE — Clean liquid glass ─── */}
      {error && (
        <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center bg-[#0a0a0f]">
          <div className="text-center max-w-md px-10">
            <div className="w-16 h-16 rounded-2xl glass flex items-center justify-center mb-7 mx-auto">
              <AlertCircle className="w-8 h-8 text-[#e50914]/70" />
            </div>
            <p className="text-white/90 text-lg font-semibold mb-2 tracking-tight">{error}</p>
            <p className="text-white/35 text-sm font-light mb-9">Intenta con otro contenido o cambia el idioma</p>
            <div className="flex items-center gap-3 justify-center">
              <button onClick={handleRetry} className="nfx-btn-play">
                Reintentar
              </button>
              <button onClick={handleClose} className="nfx-glass-button">
                Volver
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── PREPARING — Cinematic title shimmer ─── */}
      {sources.length === 0 && !error && (
        <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center bg-[#0a0a0f]">
          <h2 className="text-white text-2xl md:text-3xl font-bold tracking-tight mb-6 text-center px-6 hero-text-shimmer">{title}</h2>
          <div className="w-40 h-[3px] bg-white/10 rounded-full overflow-hidden">
            <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-[#e50914] to-transparent rounded-full" style={{ animation: 'shimmerBar 1.5s ease-in-out infinite' }} />
          </div>
        </div>
      )}

      {/* ─── NEXT EPISODE AUTO-PLAY OVERLAY ─── */}
      {nextEpisodeCountdown !== null && (
        <div className="absolute bottom-[120px] right-6 md:right-12 z-[20] pointer-events-auto">
          <div className="glass-heavy rounded-2xl p-5 min-w-[320px] shadow-2xl">
            <p className="text-white/50 text-xs font-medium tracking-wide uppercase mb-1">Siguiente episodio</p>
            <p className="text-white text-lg font-semibold mb-4">
              {title} · T{season} · E{(episode || 1) + 1}
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => { if (season && episode) playEpisode(season, episode + 1); setNextEpisodeCountdown(null); }}
                className="nfx-btn-play !h-10 !text-sm !px-5"
              >
                <Play className="w-4 h-4 fill-[#0a0a0f] text-[#0a0a0f]" />
                <span>Reproducir ahora</span>
              </button>
              <button
                onClick={() => setNextEpisodeCountdown(null)}
                className="nfx-glass-button !h-10 !text-sm !px-5"
              >
                Cancelar
              </button>
              <div className="ml-auto w-10 h-10 relative shrink-0">
                <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="2" />
                  <circle cx="18" cy="18" r="16" fill="none" stroke="#e50914" strokeWidth="2"
                    strokeDasharray={`${2 * Math.PI * 16}`}
                    strokeDashoffset={`${2 * Math.PI * 16 * (1 - nextEpisodeCountdown / 10)}`}
                    style={{ transition: 'stroke-dashoffset 1s linear' }}
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-white text-sm font-bold">{nextEpisodeCountdown}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── SKIP INTRO BUTTON ─── */}
      {mediaType === 'tv' && currentTime > 3 && currentTime < 45 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            const video = videoRef.current;
            if (video) video.currentTime += 30;
            resetTimer();
          }}
          className="absolute bottom-[140px] left-1/2 -translate-x-1/2 md:left-auto md:right-[280px] md:translate-x-0 z-[18] px-5 py-2.5 glass-heavy rounded-full text-white text-sm font-semibold hover:bg-white/20 transition-all pointer-events-auto shadow-lg"
        >
          Saltar intro
        </button>
      )}

      {/* ─── SEEK HINT OVERLAY (I) — Direction + time ─── */}
      {seekHint && (
        <div
          className="absolute inset-0 z-[15] flex items-center justify-center pointer-events-none"
          style={{
            animation: 'seekHintPop 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
            
          }}
        >
          <div className="flex items-center gap-3 px-8 py-4 rounded-2xl bg-black/60 backdrop-blur-2xl border border-white/[0.1] shadow-2xl shadow-[#e50914]/20">
            <span className="text-[#e50914] text-3xl font-bold tracking-tight">{seekHint.direction}</span>
            <span className="w-px h-8 bg-white/10" />
            <span className="text-white/90 text-2xl font-semibold tabular-nums">{seekHint.seconds}s</span>
          </div>
        </div>
      )}

      {/* ─── KEYBOARD SHORTCUT HINT OVERLAY (J) ─── */}
      {shortcutHint && (
        <div
          className="absolute inset-0 z-[15] flex items-end justify-center pb-[30%] pointer-events-none"
          style={{
            animation: 'shortcutFade 1.2s cubic-bezier(0.4, 0, 0.2, 1) forwards',
            
          }}
        >
          <div className="px-5 py-2.5 rounded-xl bg-white/[0.06] backdrop-blur-2xl text-white/60 text-sm font-medium tracking-tight border border-white/[0.06] shadow-xl shadow-black/30">
            {shortcutHint}
          </div>
        </div>
      )}

      {/* ─── CONTROLS OVERLAY ─── */}
      <div
        className={`absolute inset-0 z-[10] flex flex-col justify-between pointer-events-none ${
          showControls ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ transition: 'opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1)' }}
      >
        {/* ─── TOP BAR — Cinematic gradient ─── */}
        <div className="pointer-events-auto shrink-0" style={{ transform: showControls ? 'translateY(0)' : 'translateY(-20px)', transition: 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)' }}>
          <div className="h-[140px] bg-gradient-to-b from-black/90 via-black/50 to-transparent" />
          <div className="flex items-center gap-4 -mt-[72px] px-6 md:px-12">
            {/* Back button — glass */}
            <button
              onClick={(e) => { e.stopPropagation(); handleClose(); }}
              className="nfx-circle-btn !w-11 !h-11"
              title="Volver"
            >
              <ArrowLeft className="w-5 h-5 text-white/80" />
            </button>

            {/* Title + episode badge */}
            <div className="flex items-center gap-3 min-w-0">
              <h2 className="text-white text-base md:text-lg font-semibold truncate max-w-[260px] md:max-w-[480px] tracking-tight hero-text-shadow">
                {title}
              </h2>
              {mediaType === 'tv' && season && episode && (
                <span className="nfx-glass-chip shrink-0 text-[#ff5a63]">
                  T{season} · E{episode}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ─── CENTER PLAY/PAUSE INDICATOR ─── */}
        <div className="flex items-center justify-center pointer-events-none">
          <div className={`flex items-center justify-center transition-all duration-300 ${centerPlayVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}`}>
            <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center">
              {isPaused ? (
                <Play className="w-8 h-8 md:w-9 md:h-9 text-white fill-white ml-1" />
              ) : (
                <Pause className="w-8 h-8 md:w-9 md:h-9 text-white fill-white" />
              )}
            </div>
          </div>
        </div>

        {/* ─── BOTTOM BAR ─── */}
        <div className="pointer-events-auto shrink-0" style={{ transform: showControls ? 'translateY(0)' : 'translateY(20px)', transition: 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)' }}>
          {/* Cinematic bottom gradient */}
          <div className="h-[150px] bg-gradient-to-t from-black/95 via-black/60 to-transparent" />

          {/* ─── PROGRESS BAR — Premium Netflix-style ─── */}
          <div
            ref={progressRef}
            className="mx-6 md:mx-16 -mt-[110px] mb-5 relative group/progress cursor-pointer"
            onClick={handleProgressClick}
            onMouseMove={handleProgressHover}
            onMouseLeave={handleProgressHoverEnd}
          >
            {/* Scrub preview vertical line */}
            {hoverTime !== null && (
              <div
                className="absolute top-[-8px] bottom-[-8px] w-[1.5px] bg-white/20 pointer-events-none z-[2]"
                style={{ left: `${hoverX}px` }}
              />
            )}

            {/* Track — 3px normally, 6px on hover */}
            <div className="h-[3px] group-hover/progress:h-[6px] bg-white/[0.18] rounded-full cursor-pointer relative overflow-visible" style={{ transition: 'height 0.25s cubic-bezier(0.4, 0, 0.2, 1)' }}>
              {/* Buffered indicator — gradient */}
              <div
                className="absolute top-0 left-0 h-full rounded-full transition-all duration-200 bg-gradient-to-r from-white/[0.15] to-white/[0.25]"
                style={{ width: duration ? `${(buffered / duration) * 100}%` : '0%' }}
              />

              {/* Progress glow trail — blurred red accent behind the fill */}
              <div
                className="absolute top-[-2px] left-0 h-[calc(100%+4px)] rounded-full bg-[#e50914]/20 blur-[3px] transition-[width] duration-100"
                style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%' }}
              />

              {/* Progress fill — red gradient */}
              <div
                className="absolute top-0 left-0 h-full rounded-full bg-gradient-to-r from-[#e50914] to-[#ff4d4f] transition-[width] duration-100"
                style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%' }}
              >
                {/* Always-visible playhead — grows on hover with glow */}
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-[10px] h-[10px] group-hover/progress:w-[16px] group-hover/progress:h-[16px] rounded-full bg-white shadow-lg shadow-[#e50914]/50 border-2 border-[#e50914] z-10" style={{ transition: 'width 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), height 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)' }} />
                {/* Playhead glow — subtle always, stronger on hover */}
                <div className="absolute right-[-4px] top-1/2 -translate-y-1/2 w-4 h-4 group-hover/progress:w-8 group-hover/progress:h-8 rounded-full bg-[#e50914]/25 group-hover/progress:bg-[#e50914]/40 blur-md transition-all duration-300" />
              </div>
            </div>

            {/* ─── TIME TOOLTIP on hover ─── */}
            {hoverTime !== null && duration > 0 && (
              <div
                className="absolute -top-14 pointer-events-none px-4 py-2 rounded-xl bg-black/90 backdrop-blur-2xl text-white/95 text-xs font-semibold tabular-nums border border-white/[0.12] shadow-2xl shadow-black/60"
                style={{
                  left: `${hoverX}px`,
                  transform: 'translateX(-50%)',
                  
                }}
              >
                {formatTime(hoverTime)}
              </div>
            )}
          </div>

          {/* ─── CONTROLS ROW ─── */}
          <div className="flex items-center justify-between px-6 md:px-12 pb-6 md:pb-7">
            {/* Left controls */}
            <div className="flex items-center gap-1 md:gap-2">
              {/* Play/Pause */}
              <button onClick={togglePlay} className="nfx-circle-btn !w-11 !h-11 group/play">
                {isPaused ? (
                  <Play className="w-5 h-5 text-white fill-white group-hover/play:scale-110 transition-transform" />
                ) : (
                  <Pause className="w-5 h-5 text-white fill-white group-hover/play:scale-110 transition-transform" />
                )}
              </button>

              {/* Skip Back */}
              <button onClick={() => seek(-10)} className="nfx-circle-btn !w-11 !h-11 group/sb">
                <div className="relative">
                  <SkipBack className="w-[18px] h-[18px] text-white/70 group-hover/sb:text-white transition-colors" />
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[8px] text-white/30 group-hover/sb:text-white/70 font-semibold">10</span>
                </div>
              </button>

              {/* Skip Forward */}
              <button onClick={() => seek(10)} className="nfx-circle-btn !w-11 !h-11 group/sf">
                <div className="relative">
                  <SkipForward className="w-[18px] h-[18px] text-white/70 group-hover/sf:text-white transition-colors" />
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[8px] text-white/30 group-hover/sf:text-white/70 font-semibold">10</span>
                </div>
              </button>

              {/* Volume */}
              <div
                className="flex items-center group/vol relative"
                onMouseEnter={() => setShowVolumeSlider(true)}
                onMouseLeave={() => setShowVolumeSlider(false)}
              >
                <button onClick={toggleMute} className="nfx-circle-btn !w-11 !h-11">
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-[18px] h-[18px] text-white/70" />
                  ) : volume < 0.5 ? (
                    <Volume1 className="w-[18px] h-[18px] text-white/70" />
                  ) : (
                    <Volume2 className="w-[18px] h-[18px] text-white/70" />
                  )}
                </button>

                {/* Volume slider */}
                <div
                  ref={volumeSliderRef}
                  className={`w-24 h-1 group-hover/vol:h-1.5 bg-white/[0.15] rounded-full cursor-pointer relative overflow-visible transition-all duration-300 ml-1 ${
                    showVolumeSlider ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0 md:opacity-100 md:scale-x-100 w-0 md:w-24'
                  }`}
                  onClick={handleVolumeClick}
                >
                  <div
                    className="h-full bg-[#e50914] rounded-full relative"
                    style={{ width: `${(isMuted ? 0 : volume) * 100}%` }}
                  >
                    <div className="absolute right-[-5px] top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg shadow-[#e50914]/40 border-2 border-[#e50914] transition-all group-hover/vol:w-3.5 group-hover/vol:h-3.5" />
                  </div>
                </div>
              </div>

              {/* Time display */}
              <span className="text-white/55 text-[13px] tabular-nums ml-3 font-medium hidden md:block">
                <span className="text-white/80">{formatTime(currentTime)}</span>
                <span className="text-white/25 mx-1.5">/</span>
                <span className="text-white/40">{formatTime(duration)}</span>
              </span>
            </div>

            {/* Right controls */}
            <div className="flex items-center gap-1 md:gap-2">
              {/* Language selector */}
              {sources.length > 0 && (() => {
                const langs = getAvailableLanguages(sources);
                if (langs.length <= 1) return null;
                const currentLangKey = getLangKey(currentSourceInfo?.language);
                const currentLangLabel = getLangDisplayName(currentSourceInfo?.language);
                return (
                  <div ref={langMenuRef} className="relative">
                    <button
                      onClick={(e) => { e.stopPropagation(); setLangMenuOpen(!langMenuOpen); resetTimer(); }}
                      className="glass rounded-full px-4 py-2 text-white text-xs flex items-center gap-2 hover:bg-white/10 transition-all active:scale-95"
                    >
                      <Subtitles className="w-4 h-4 text-[#e50914]/80" />
                      <span className="text-white/85 font-medium">{currentLangLabel}</span>
                    </button>
                    {/* Language menu */}
                    {langMenuOpen && (
                      <div className="absolute bottom-full right-0 mb-3 glass-heavy rounded-2xl overflow-hidden min-w-[200px] z-50 animate-nfx-fade-in">
                        <div className="px-4 py-2.5 border-b border-white/[0.06] text-white/35 text-[10px] font-medium tracking-[0.15em] uppercase">Idioma</div>
                        {langs.map((lang) => (
                          <button
                            key={lang.key}
                            onClick={(e) => { e.stopPropagation(); changeLanguage(lang.key); }}
                            className={`w-full text-left px-4 py-3 text-sm transition-all relative ${
                              lang.key === currentLangKey
                                ? 'text-white font-medium bg-[#e50914]/10'
                                : 'text-white/45 hover:bg-white/[0.04] hover:text-white/85'
                            }`}
                          >
                            {lang.key === currentLangKey && (
                              <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#e50914] rounded-r" />
                            )}
                            {lang.key === currentLangKey && (
                              <span className="mr-2 text-[#e50914]">&#10003;</span>
                            )}
                            {lang.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* CC / Subtitles */}
              {subtitleUrl && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowSubtitles(!showSubtitles); resetTimer(); }}
                  className={`glass rounded-full px-3.5 py-2 text-xs flex items-center gap-1.5 transition-all active:scale-95 ${
                    showSubtitles ? '!bg-[#e50914]/15 !border-[#e50914]/30 text-[#e50914]' : 'text-white/50 hover:text-white/85 hover:bg-white/10'
                  }`}
                >
                  <Subtitles className="w-4 h-4" />
                  <span className="font-semibold tracking-wider">CC</span>
                </button>
              )}
              {subtitleLoading && (
                <div className="glass rounded-full px-3.5 py-2 text-white/40 text-xs flex items-center gap-2">
                  <div className="w-6 h-[2px] bg-white/15 rounded-full overflow-hidden">
                    <div className="h-full w-1/2 bg-[#e50914] rounded-full" style={{ animation: 'shimmerBar 1.2s ease-in-out infinite' }} />
                  </div>
                </div>
              )}

              {/* Playback speed */}
              <div ref={speedMenuRef} className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setSpeedMenuOpen(!speedMenuOpen); resetTimer(); }}
                  className="glass rounded-full px-3.5 py-2 text-xs text-white/60 hover:text-white hover:bg-white/10 transition-all active:scale-95 font-medium"
                >
                  {playbackRate === 1 ? '1×' : `${playbackRate}×`}
                </button>
                {speedMenuOpen && (
                  <div className="absolute bottom-full right-0 mb-3 glass-heavy rounded-2xl overflow-hidden min-w-[120px] z-50 animate-nfx-fade-in">
                    <div className="px-4 py-2.5 border-b border-white/[0.06] text-white/35 text-[10px] font-medium tracking-[0.15em] uppercase">Velocidad</div>
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                      <button
                        key={rate}
                        onClick={(e) => { e.stopPropagation(); setPlaybackRate(rate); setSpeedMenuOpen(false); resetTimer(); }}
                        className={`w-full text-left px-4 py-2.5 text-sm transition-all relative ${
                          playbackRate === rate
                            ? 'text-white font-medium bg-[#e50914]/10'
                            : 'text-white/45 hover:bg-white/[0.04] hover:text-white/85'
                        }`}
                      >
                        {playbackRate === rate && <span className="mr-2 text-[#e50914]">&#10003;</span>}
                        {rate === 1 ? 'Normal' : `${rate}×`}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Fullscreen */}
              <button
                onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
                className="nfx-circle-btn !w-11 !h-11 group/fs"
              >
                {isFullscreen ? (
                  <Minimize className="w-[18px] h-[18px] text-white/70 group-hover/fs:text-white transition-colors" />
                ) : (
                  <Maximize className="w-[18px] h-[18px] text-white/70 group-hover/fs:text-white transition-colors" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ─── CSS keyframe animations ─── */}
      <style>{`
        @keyframes shimmerBar {
          0% { transform: translateX(-150%); }
          100% { transform: translateX(450%); }
        }
        .hero-text-shimmer {
          background: linear-gradient(90deg, rgba(255,255,255,0.4) 0%, #fff 50%, rgba(255,255,255,0.4) 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: textShine 2.5s linear infinite;
        }
        @keyframes textShine {
          0% { background-position: 200% center; }
          100% { background-position: -200% center; }
        }
        @keyframes seekHintPop {
          0% { opacity: 0; transform: scale(0.7); }
          20% { opacity: 1; transform: scale(1); }
          70% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(0.9); }
        }
        @keyframes shortcutFade {
          0% { opacity: 0; transform: translateY(10px); }
          15% { opacity: 1; transform: translateY(0); }
          70% { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-5px); }
        }
      `}</style>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   BlobPlayer  —  plays a local blob URL (downloaded content)
   ═══════════════════════════════════════════════════════════════════ */

function BlobPlayer({ blobUrl, title }: { blobUrl: string; title: string }) {
  const closePlayer = useStore(s => s.closePlayer);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const centerPlayTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [centerPlayVisible, setCenterPlayVisible] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);

  const isMobile = isMobileDevice();

  // Lock scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = '0';
    document.body.style.width = '100%';
    return () => {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
    };
  }, []);

  // Load video
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !blobUrl) return;
    video.src = blobUrl;
    video.play().catch(() => {});
  }, [blobUrl]);

  // Video events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => setIsPaused(false);
    const onPause = () => setIsPaused(true);
    const onTimeUpdate = () => setCurrentTime(video.currentTime);
    const onDurationChange = () => setDuration(video.duration);
    const onEnded = () => { setIsPaused(true); setCurrentTime(0); };
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('ended', onEnded);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('ended', onEnded);
    };
  }, [blobUrl]);

  // Auto-hide controls
  const resetTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
    controlsTimeout.current = setTimeout(() => {
      const v = videoRef.current;
      if (v && !v.paused) setShowControls(false);
    }, 3500);
  }, []);

  useEffect(() => {
    const onMouseMove = () => resetTimer();
    window.addEventListener('mousemove', onMouseMove);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
    };
  }, [resetTimer]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
    resetTimer();
    setCenterPlayVisible(true);
    if (centerPlayTimer.current) clearTimeout(centerPlayTimer.current);
    centerPlayTimer.current = setTimeout(() => setCenterPlayVisible(false), 600);
  }, [resetTimer]);

  const seek = useCallback((seconds: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + seconds));
    resetTimer();
  }, [resetTimer]);

  const seekTo = useCallback((pct: number) => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    v.currentTime = pct * v.duration;
    resetTimer();
  }, [resetTimer]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setIsMuted(v.muted);
    resetTimer();
  }, [resetTimer]);

  const changeVolume = useCallback((vol: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = Math.max(0, Math.min(1, vol));
    setVolume(v.volume);
    if (v.muted && vol > 0) { v.muted = false; setIsMuted(false); }
  }, []);

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await containerRef.current.requestFullscreen().catch(() => {});
  };

  const handleClose = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    closePlayer();
  };

  // Keyboard
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); handleClose(); return; }
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFullscreen(); }
      if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); seek(10); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); seek(-10); }
      if (e.key === 'ArrowUp') { e.preventDefault(); changeVolume(volume + 0.1); resetTimer(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); changeVolume(volume - 0.1); resetTimer(); }
      if (e.key === 'm' || e.key === 'M') toggleMute();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [closePlayer, togglePlay, seek, toggleMute, changeVolume, volume, resetTimer, toggleFullscreen]);

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || !duration) return;
    const rect = progressRef.current.getBoundingClientRect();
    seekTo(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
  };

  const handleVolumeClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    changeVolume(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
  };

  // Auto fullscreen
  useEffect(() => {
    const t = setTimeout(() => {
      if (isMobile && videoRef.current) {
        const vid = videoRef.current as HTMLVideoElement & { webkitEnterFullscreen?: () => Promise<void> };
        if (vid.webkitEnterFullscreen) vid.webkitEnterFullscreen().catch(() => {});
        else if (vid.requestFullscreen) vid.requestFullscreen().catch(() => {});
        return;
      }
      if (containerRef.current && !document.fullscreenElement) {
        containerRef.current.requestFullscreen().catch(() => {});
      }
    }, 300);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  if (isMobile) {
    return (
      <div className="fixed inset-0 z-[9999] bg-black flex items-center justify-center">
        <video
          ref={videoRef}
          className="absolute opacity-0 pointer-events-none"
          style={{ width: 1, height: 1 }}
          playsInline={false}
          autoPlay
        />
        <div className="flex flex-col items-center">
          <h2 className="text-white text-xl font-bold tracking-tight mb-5 text-center px-6 hero-text-shimmer">{title}</h2>
          <div className="w-32 h-[3px] bg-white/10 rounded-full overflow-hidden">
            <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-[#e50914] to-transparent rounded-full" style={{ animation: 'shimmerBar 1.5s ease-in-out infinite' }} />
          </div>
        </div>
        <button onClick={handleClose} className="absolute top-5 right-5 w-11 h-11 rounded-full bg-white/[0.07] backdrop-blur-xl flex items-center justify-center z-10 hover:bg-white/[0.15] transition-all duration-300 border border-white/[0.08] shadow-lg shadow-black/40">
          <span className="text-white/70 text-xl font-light">&times;</span>
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[9999] bg-black select-none flex items-center justify-center"
      style={{ overflow: 'hidden', touchAction: 'none' }}
      onMouseMove={resetTimer}
    >
      <video ref={videoRef} className="absolute inset-0 w-full h-full object-contain" playsInline onClick={togglePlay} onDoubleClick={toggleFullscreen} />

      <div className={`absolute inset-0 z-[10] flex flex-col justify-between pointer-events-none ${showControls ? 'opacity-100' : 'opacity-0'}`} style={{ transition: 'opacity 0.5s cubic-bezier(0.4, 0, 0.2, 1)' }}>
        <div className="pointer-events-auto shrink-0">
          <div className="h-[120px] bg-gradient-to-b from-black/95 via-black/60 to-transparent" />
          <div className="flex items-center gap-4 -mt-[72px] px-6 md:px-16">
            <button onClick={(e) => { e.stopPropagation(); handleClose(); }} className="group w-11 h-11 rounded-full bg-white/[0.06] backdrop-blur-xl flex items-center justify-center hover:bg-white/[0.12] transition-all duration-300 border border-white/[0.07] hover:border-white/20 shadow-lg shadow-black/30 active:scale-[0.92]" style={{ transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
              <ArrowLeft className="w-[18px] h-[18px] text-white/75 group-hover:text-white transition-colors duration-200" />
            </button>
            <div className="px-3 py-1.5 rounded-lg bg-black/40 backdrop-blur-xl border border-white/[0.04]">
              <h2 className="text-white/90 text-base md:text-lg font-semibold truncate max-w-[280px] md:max-w-[480px] tracking-tight leading-tight">{title}</h2>
            </div>
          </div>
        </div>

        <div className="pointer-events-auto flex items-center justify-center">
          <button onClick={(e) => { e.stopPropagation(); togglePlay(); }} className={`w-[72px] h-[72px] md:w-[88px] md:h-[88px] rounded-full bg-white/[0.08] hover:bg-white/[0.15] backdrop-blur-2xl flex items-center justify-center active:scale-[0.85] border border-white/[0.08] hover:border-white/20 shadow-2xl shadow-black/40 ${centerPlayVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-60'}`} style={{ transition: 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
            {isPaused ? <Play className="w-10 h-10 md:w-12 md:h-12 text-white fill-white ml-1.5" /> : <Pause className="w-10 h-10 md:w-12 md:h-12 text-white fill-white" />}
          </button>
        </div>

        <div className="pointer-events-auto shrink-0">
          <div className="h-[120px] bg-gradient-to-t from-black/95 via-black/60 to-transparent" />
          <div ref={progressRef} className="mx-6 md:mx-16 -mt-[105px] mb-4 relative group/progress" onClick={handleProgressClick}>
            <div className="h-[3px] group-hover/progress:h-[6px] bg-white/[0.12] rounded-full transition-all duration-300 cursor-pointer relative overflow-visible" style={{ transition: 'height 0.25s cubic-bezier(0.4, 0, 0.2, 1)' }}>
              <div className="absolute top-0 left-0 h-full bg-gradient-to-r from-[#e50914]/90 to-[#e50914] rounded-full" style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%' }}>
                <div className="absolute right-[-6px] top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-[#e50914]/30 blur-sm opacity-0 group-hover/progress:opacity-100 transition-opacity duration-300" />
                <div className="absolute right-[-5px] top-1/2 -translate-y-1/2 w-[13px] h-[13px] group-hover/progress:w-[15px] group-hover/progress:h-[15px] bg-white rounded-full opacity-0 group-hover/progress:opacity-100 transition-all duration-300 shadow-lg shadow-[#e50914]/40 border-2 border-[#e50914]" style={{ transition: 'opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1), width 0.25s cubic-bezier(0.4, 0, 0.2, 1), height 0.25s cubic-bezier(0.4, 0, 0.2, 1)' }} />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between px-6 md:px-16 pb-5 md:pb-8">
            <div className="flex items-center gap-1.5 md:gap-2">
              <button onClick={togglePlay} className="w-11 h-11 flex items-center justify-center hover:bg-white/[0.06] rounded-xl transition-all duration-200 group/play active:scale-[0.88]" style={{ transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
                {isPaused ? <Play className="w-7 h-7 text-white fill-white group-hover/play:scale-110 transition-transform duration-200" /> : <Pause className="w-7 h-7 text-white fill-white group-hover/play:scale-110 transition-transform duration-200" />}
              </button>
              <button onClick={() => seek(-10)} className="w-11 h-11 flex items-center justify-center hover:bg-white/[0.06] rounded-xl transition-all duration-200 group/sb active:scale-[0.88]" style={{ transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
                <SkipBack className="w-[18px] h-[18px] text-white/55 group-hover/sb:text-white/90 transition-colors duration-200" />
              </button>
              <button onClick={() => seek(10)} className="w-11 h-11 flex items-center justify-center hover:bg-white/[0.06] rounded-xl transition-all duration-200 group/sf active:scale-[0.88]" style={{ transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
                <SkipForward className="w-[18px] h-[18px] text-white/55 group-hover/sf:text-white/90 transition-colors duration-200" />
              </button>
              <div className="flex items-center gap-0 ml-1 group/vol">
                <button onClick={toggleMute} className="w-11 h-11 flex items-center justify-center hover:bg-white/[0.06] rounded-xl transition-all duration-200 active:scale-[0.88]" style={{ transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
                  {isMuted || volume === 0 ? <VolumeX className="w-[18px] h-[18px] text-white/40" /> : <Volume2 className="w-[18px] h-[18px] text-white/60" />}
                </button>
                <div className="w-24 h-[3px] group-hover/vol:h-[5px] bg-white/[0.12] rounded-full cursor-pointer relative overflow-visible transition-all duration-300" onClick={handleVolumeClick} style={{ transition: 'height 0.25s cubic-bezier(0.4, 0, 0.2, 1)' }}>
                  <div className="h-full bg-gradient-to-r from-white/60 to-white/80 rounded-full relative transition-all duration-100" style={{ width: `${(isMuted ? 0 : volume) * 100}%` }}>
                    <div className="absolute right-[-4px] top-1/2 -translate-y-1/2 w-[11px] h-[11px] bg-white rounded-full shadow-lg shadow-white/20 border border-white/40 group-hover/vol:w-[13px] group-hover/vol:h-[13px] transition-all duration-200" />
                  </div>
                </div>
              </div>
              <span className="text-white/45 text-[13px] tabular-nums ml-2 font-light tracking-[0.04em]">
                {formatTime(currentTime)} <span className="text-white/25 mx-1.5">/</span> {formatTime(duration)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }} className="w-11 h-11 flex items-center justify-center hover:bg-white/[0.06] rounded-xl transition-all duration-200 group/fs active:scale-[0.88]" style={{ transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
                {isFullscreen ? <Minimize className="w-[18px] h-[18px] text-white/55 group-hover/fs:text-white/90 transition-colors duration-200" /> : <Maximize className="w-[18px] h-[18px] text-white/55 group-hover/fs:text-white/90 transition-colors duration-200" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   VideoPlayer  —  wrapper that reads store state and routes to
                   MobilePlayer, DesktopPlayer, or BlobPlayer
   ═══════════════════════════════════════════════════════════════════ */

export default function VideoPlayer() {
  const isPlaying = useStore(s => s.isPlaying);
  const playerTmdbId = useStore(s => s.playerTmdbId);
  const playerMediaType = useStore(s => s.playerMediaType);
  const playerSeason = useStore(s => s.playerSeason);
  const playerEpisode = useStore(s => s.playerEpisode);
  const playerTitle = useStore(s => s.playerTitle);
  const directPlayUrl = useStore(s => s.directPlayUrl);
  const directPlayTitle = useStore(s => s.directPlayTitle);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [sourceLoading, setSourceLoading] = useState(true);
  const [sourceError, setSourceError] = useState('');

  // Track which movie the loaded sources belong to — prevents the
  // "opens previous movie" bug when switching titles.
  const currentMovieKey = `${playerTmdbId}-${playerMediaType}-${playerSeason || ''}-${playerEpisode || ''}`;
  const [sourcesForMovie, setSourcesForMovie] = useState('');
  const sourcesMatch = sourcesForMovie === currentMovieKey;

  // Fetch sources at the wrapper level
  useEffect(() => {
    if (!isPlaying || !playerTmdbId) return;
    let cancelled = false;
    setSources([]);               // Clear old sources immediately
    setSourcesForMovie('');       // Mark as stale
    setSourceLoading(true);
    setSourceError('');

    const params = new URLSearchParams({ id: String(playerTmdbId), type: playerMediaType });
    if (playerMediaType === 'tv' && playerSeason && playerEpisode) {
      params.set('s', String(playerSeason));
      params.set('e', String(playerEpisode));
    }

    // Check client-side cache first — instant on repeat visits
    const cacheKey = `src:${playerTmdbId}:${playerMediaType}:${playerSeason || ''}:${playerEpisode || ''}`;
    const cached = getCachedSources(cacheKey);
    if (cached && cached.length > 0) {
      setSources(cached);
      setSourcesForMovie(currentMovieKey);
      setSourceLoading(false);
      return;
    }

    fetch(`/api/source?${params}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (data.sources?.length > 0) {
          setCachedSources(cacheKey, data.sources);
          setSources(data.sources);
          setSourcesForMovie(currentMovieKey);
        } else {
          setSourceError('No se pudo reproducir este contenido');
        }
        setSourceLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setSourceError('No se pudo cargar el contenido');
          setSourceLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [isPlaying, playerTmdbId, playerMediaType, playerSeason, playerEpisode]);

  if (isPlaying && directPlayUrl) {
    return <BlobPlayer key={directPlayUrl} blobUrl={directPlayUrl} title={directPlayTitle || playerTitle} />;
  }

  if (!isPlaying || !playerTmdbId) return null;

  const playerProps: PlayerInnerProps = {
    tmdbId: playerTmdbId,
    mediaType: playerMediaType,
    season: playerSeason,
    episode: playerEpisode,
    title: playerTitle,
  };

  const playerKey = `${playerTmdbId}-${playerMediaType}-${playerSeason}-${playerEpisode}`;

  if (sourceLoading || !sourcesMatch) {
    return (
      <div className="fixed inset-0 z-[2000] bg-[#0a0a0f] flex flex-col items-center justify-center">
        <h2 className="text-white text-2xl md:text-3xl font-bold tracking-tight mb-6 text-center px-6 hero-text-shimmer">{playerTitle}</h2>
        <div className="w-40 h-[3px] bg-white/10 rounded-full overflow-hidden">
          <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-[#e50914] to-transparent rounded-full" style={{ animation: 'shimmerBar 1.5s ease-in-out infinite' }} />
        </div>
      </div>
    );
  }

  if (sourceError && sources.length === 0) {
    return (
      <div className="fixed inset-0 z-[2000] bg-gradient-to-b from-black via-black/95 to-[#0a0a0f] flex items-center justify-center">
        <div className="absolute inset-0 bg-gradient-to-br from-[#e50914]/[0.03] via-transparent to-red-900/[0.04] animate-pulse" style={{ animationDuration: '4s' }} />
        <div className="text-center max-w-sm px-10 relative">
          <div className="w-16 h-16 rounded-2xl bg-red-500/[0.06] flex items-center justify-center mb-7 mx-auto border border-red-500/12 shadow-2xl shadow-red-500/[0.08] animate-pulse" style={{ animationDuration: '3s' }}>
            <AlertCircle className="w-8 h-8 text-red-400/70" />
          </div>
          <p className="text-white/85 text-xl font-semibold mb-3 tracking-tight">{sourceError}</p>
          <p className="text-white/35 text-sm font-light mb-9 leading-relaxed">Este contenido no está disponible en este momento</p>
          <button
            onClick={() => useStore.getState().closePlayer()}
            className="px-10 py-4 bg-white/[0.06] hover:bg-white/[0.12] rounded-xl text-white/75 hover:text-white font-medium transition-all duration-300 border border-white/[0.07] hover:border-white/20 hover:shadow-xl hover:shadow-white/[0.04] active:scale-[0.97]"
            style={{ transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
          >
            Volver
          </button>
        </div>
      </div>
    );
  }

  if (isMobileDevice()) {
    return <MobilePlayer key={playerKey} {...playerProps} preloadedSources={sources} />;
  }

  return <DesktopPlayer key={playerKey} {...playerProps} preloadedSources={sources} />;
}
