import { create } from 'zustand';

export interface MediaItem {
  id: number;
  title?: string;
  name?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  overview: string;
  vote_average: number;
  vote_count?: number;
  release_date?: string;
  first_air_date?: string;
  media_type?: string;
  genre_ids?: number[];
  popularity?: number;
  adult?: boolean;
  original_language?: string;
  original_title?: string;
  original_name?: string;
}

export interface MediaDetail extends MediaItem {
  genres: { id: number; name: string }[];
  runtime?: number;
  number_of_seasons?: number;
  number_of_episodes?: number;
  status?: string;
  tagline?: string;
  credits?: {
    cast: { id: number; name: string; character: string; profile_path: string | null; order: number }[];
    crew?: { id: number; name: string; job: string; department: string }[];
  };
  similar?: { results: MediaItem[] };
  videos?: { results: { id: string; key: string; name: string; site: string; type: string }[] };
  seasons?: { id: number; season_number: number; name: string; episode_count: number; poster_path: string | null }[];
}

export interface Episode {
  id: number;
  episode_number: number;
  name: string;
  overview: string;
  still_path: string | null;
  air_date: string;
  runtime: number;
  vote_average: number;
}

export interface ContinueWatchingItem {
  id: number;
  type: 'movie' | 'tv';
  title: string;
  poster_path: string;
  backdrop_path: string;
  progress: { watched: number; duration: number };
  last_updated: number;
  number_of_seasons?: number;
  last_season_watched?: string;
  last_episode_watched?: string;
}

export interface DownloadItem {
  id: number;
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
  media_type: string;
  progress: number;
  status: 'pending' | 'downloading' | 'completed' | 'error';
  size?: number;
  error?: string;
}

export type ActiveTab = 'inicio' | 'peliculas' | 'series' | 'mi-lista' | 'descargas' | 'buscar';

// Source blacklist — items that have no working sources
const BLACKLIST_KEY = 'streamx-no-sources';
// Bumped to v4: entries used to live 7 days, so a single transient failure
// (e.g. Cloudflare rate-limiting Vidrock for a few hours) hid a title from
// search and home rows for a whole week even though its servers were back.
const BLACKLIST_VERSION_KEY = 'streamx-bl-v4';
const BLACKLIST_TTL = 6 * 60 * 60 * 1000; // 6 hours

interface BlacklistEntry {
  id: number;
  timestamp: number;
}

function loadBlacklist(): BlacklistEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    // One-time migration: clear blacklist that was built with the buggy
    // TV source-check (no season/episode). After clearing, mark the
    // version so it never runs again.
    if (!localStorage.getItem(BLACKLIST_VERSION_KEY)) {
      localStorage.removeItem(BLACKLIST_KEY);
      localStorage.setItem(BLACKLIST_VERSION_KEY, '1');
      return [];
    }
    const raw = localStorage.getItem(BLACKLIST_KEY);
    if (!raw) return [];
    const entries: BlacklistEntry[] = JSON.parse(raw);
    const now = Date.now();
    return entries.filter(e => now - e.timestamp < BLACKLIST_TTL);
  } catch { return []; }
}

function saveBlacklist(list: BlacklistEntry[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(BLACKLIST_KEY, JSON.stringify(list.slice(-200))); // Keep last 200
  } catch { /* quota exceeded */ }
}

interface AppState {
  // Tab
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;

  // My List (persisted)
  myList: MediaItem[];
  toggleMyList: (item: MediaItem) => void;
  isInMyList: (id: number) => boolean;

  // Downloads
  downloads: DownloadItem[];
  startDownload: (item: MediaItem) => void;
  removeDownload: (id: number) => void;
  updateDownloadProgress: (id: number, progress: number) => void;
  updateDownloadStatus: (id: number, status: DownloadItem['status'], extra?: Partial<DownloadItem>) => void;

  // Selected content
  selectedItem: MediaItem | null;
  selectedItemDetail: MediaDetail | null;
  showDetail: boolean;

  // Player
  isPlaying: boolean;
  playerTmdbId: number;
  playerMediaType: 'movie' | 'tv';
  playerSeason: number;
  playerEpisode: number;
  playerTitle: string;
  directPlayUrl: string | null;
  directPlayTitle: string;
  selectedSeason: number;
  selectedEpisode: number;
  episodes: Episode[];
  loadingEpisodes: boolean;
  showPlayerInfo: boolean;

  // Search
  searchQuery: string;
  searchOpen: boolean;
  searchResults: MediaItem[];
  searching: boolean;

  // Continue watching
  continueWatching: ContinueWatchingItem[];
  setContinueWatching: (items: ContinueWatchingItem[]) => void;
  updateProgress: (id: number, type: 'movie' | 'tv', title: string, posterPath: string, backdropPath: string, watched: number, duration: number, season?: number, episode?: number) => void;
  getProgress: (id: number) => { watched: number; duration: number; season?: number; episode?: number } | null;
  removeFromContinueWatching: (id: number) => void;

  // Actions
  selectItem: (item: MediaItem) => void;
  openDetail: () => void;
  closeDetail: () => void;
  setDetail: (detail: MediaDetail) => void;

  playMovie: (item: MediaItem) => void;
  playEpisode: (season: number, episode: number) => void;
  playDirect: (blobUrl: string, title: string, item?: MediaItem) => void;
  closePlayer: () => void;
  setEpisodes: (episodes: Episode[]) => void;
  setLoadingEpisodes: (loading: boolean) => void;
  setSelectedSeason: (season: number) => void;
  setSelectedEpisode: (episode: number) => void;
  setShowPlayerInfo: (show: boolean) => void;

  handleCardClick: (item: MediaItem) => void;

  setSearchQuery: (query: string) => void;
  setSearchOpen: (open: boolean) => void;
  setSearchResults: (results: MediaItem[]) => void;
  setSearching: (searching: boolean) => void;

  // Source blacklist
  noSourceIds: Set<number>;
  addToBlacklist: (id: number) => void;
  isInBlacklist: (id: number) => boolean;

  // Hydration
  hydrateMyList: () => void;
}

// Hydration-safe: ALWAYS start with empty client state so the first client
// render matches the server HTML exactly (React #418 otherwise). All
// localStorage-backed lists (my list, continue watching, downloads) are
// loaded in a useEffect after mount via hydrateMyList().
function loadMyList(): MediaItem[] {
  return [];
}

// See loadMyList: reads below only run AFTER mount (from hydrateMyList),
// never at store creation — otherwise the client's first render differs
// from the server HTML and React hydration fails (#418).

function loadMyListFromStorage(): MediaItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const saved = localStorage.getItem('streamx-my-list');
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

function saveMyList(list: MediaItem[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('streamx-my-list', JSON.stringify(list));
  } catch { /* quota exceeded */ }
}

// ── Continue Watching persistence (post-mount only — see loadMyList) ──
function loadContinueWatching(): ContinueWatchingItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const saved = localStorage.getItem('streamx-cw');
    if (!saved) return [];
    const items: ContinueWatchingItem[] = JSON.parse(saved);
    // Drop entries saved before the image-paths fix (no poster/backdrop).
    const valid = items.filter(cw => cw.poster_path || cw.backdrop_path);
    if (valid.length !== items.length) saveContinueWatching(valid);
    return valid;
  } catch { return []; }
}

function saveContinueWatching(list: ContinueWatchingItem[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('streamx-cw', JSON.stringify(list.slice(0, 40)));
  } catch { /* quota exceeded */ }
}

// ── Downloads metadata persistence (the video blob itself lives in IndexedDB) ──
function loadDownloads(): DownloadItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const saved = localStorage.getItem('streamx-downloads');
    if (!saved) return [];
    const list: DownloadItem[] = JSON.parse(saved);
    // A 'downloading' entry didn't finish before reload — mark it errored so
    // the user can retry, instead of showing a stuck spinner forever.
    return list.map(d =>
      d.status === 'downloading' || d.status === 'pending'
        ? { ...d, status: 'error', error: 'Descarga interrumpida' }
        : d
    );
  } catch { return []; }
}

function saveDownloads(list: DownloadItem[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('streamx-downloads', JSON.stringify(list));
  } catch { /* quota exceeded */ }
}

// Active download controllers for cancellation
const activeDownloads = new Map<number, AbortController>();

export const useStore = create<AppState>((set, get) => ({
  activeTab: 'inicio',
  setActiveTab: (tab) => set({ activeTab: tab }),

  // My List — persisted to localStorage
  myList: loadMyList(),
  toggleMyList: (item) => {
    const { myList } = get();
    const exists = myList.some(m => m.id === item.id);
    const next = exists
      ? myList.filter(m => m.id !== item.id)
      : [...myList, item];
    set({ myList: next });
    saveMyList(next);
  },
  isInMyList: (id) => get().myList.some(m => m.id === id),

  // Downloads — persisted to localStorage, hydrated after mount
  downloads: [],
  startDownload: (item) => {
    const { downloads } = get();
    const existing = downloads.find(d => d.id === item.id);
    if (existing) {
      if (existing.status === 'downloading') return;
      if (existing.status === 'completed') return;
      set({
        downloads: downloads.map(d =>
          d.id === item.id ? { ...d, status: 'downloading' as const, progress: 0, error: undefined } : d
        ),
      });
    } else {
      set({
        downloads: [...downloads, {
          id: item.id,
          title: item.title || item.name || 'Desconocido',
          poster_path: item.poster_path,
          backdrop_path: item.backdrop_path,
          media_type: item.media_type || 'movie',
          progress: 0,
          status: 'downloading',
        }],
      });
    }

    const tmdbId = item.id;
    const mediaType = item.media_type === 'tv' || item.name ? 'tv' : 'movie';
    const controller = new AbortController();
    activeDownloads.set(tmdbId, controller);

    (async () => {
      try {
        const params = new URLSearchParams({ id: String(tmdbId), type: mediaType });
        // Use the season/episode selected in the detail modal, not hardcoded S1E1.
        if (mediaType === 'tv') {
          params.set('s', String(get().selectedSeason || 1));
          params.set('e', String(get().selectedEpisode || 1));
        }
        const srcRes = await fetch(`/api/source?${params}`, { signal: controller.signal });
        const srcData = await srcRes.json();
        const sources: { url: string; type: string; name: string }[] = srcData.sources || [];
        if (sources.length === 0) throw new Error('No hay fuentes');

        // HLS (m3u8) can't be downloaded as one playable file without remuxing.
        // Only allow real mp4 sources; otherwise abort cleanly instead of saving
        // a junk m3u8-playlist blob that won't play in BlobPlayer.
        const source = sources.find(s => s.type === 'mp4');
        if (!source) throw new Error('No hay fuente descargable (MP4) para este contenido');
        const proxyUrl = `/api/proxy?url=${encodeURIComponent(source.url)}`;

        const videoRes = await fetch(proxyUrl, { signal: controller.signal });
        if (!videoRes.ok) throw new Error('Error al descargar');
        if (!videoRes.body) throw new Error('No hay stream');

        const reader = videoRes.body.getReader();
        const contentLength = parseInt(videoRes.headers.get('content-length') || '0');
        let received = 0;
        const chunks: Uint8Array[] = [];

        while (true) {
          if (controller.signal.aborted) break;
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          if (contentLength > 0) {
            const pct = Math.round((received / contentLength) * 100);
            set(state => ({
              downloads: state.downloads.map(d =>
                d.id === tmdbId ? { ...d, progress: pct } : d
              ),
            }));
          }
        }

        if (controller.signal.aborted) return;

        const blob = new Blob(chunks as BlobPart[], { type: 'video/mp4' });

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
        const tx = db.transaction('videos', 'readwrite');
        tx.objectStore('videos').put(blob, tmdbId);
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });

        set(state => ({
          downloads: state.downloads.map(d =>
            d.id === tmdbId ? { ...d, status: 'completed' as const, progress: 100, size: blob.size } : d
          ),
        }));
        saveDownloads(get().downloads);
      } catch (err) {
        if (controller.signal.aborted) return;
        const msg = err instanceof Error ? err.message : 'Error desconocido';
        set(state => ({
          downloads: state.downloads.map(d =>
            d.id === tmdbId ? { ...d, status: 'error' as const, error: msg } : d
          ),
        }));
        saveDownloads(get().downloads);
      } finally {
        activeDownloads.delete(tmdbId);
      }
    })();
  },
  removeDownload: (id) => {
    const ctrl = activeDownloads.get(id);
    if (ctrl) { ctrl.abort(); activeDownloads.delete(id); }
    set(state => ({ downloads: state.downloads.filter(d => d.id !== id) }));
    saveDownloads(get().downloads);
    try {
      const dbReq = indexedDB.open('streamx-db', 1);
      dbReq.onsuccess = () => {
        const db = dbReq.result;
        try {
          const tx = db.transaction('videos', 'readwrite');
          tx.objectStore('videos').delete(id);
        } catch { /* store might not exist */ }
      };
    } catch { /* ignore */ }
  },
  updateDownloadProgress: (id, progress) => {
    set(state => ({
      downloads: state.downloads.map(d => d.id === id ? { ...d, progress } : d),
    }));
  },
  updateDownloadStatus: (id, status, extra) => {
    set(state => ({
      downloads: state.downloads.map(d => d.id === id ? { ...d, status, ...extra } : d),
    }));
  },

  selectedItem: null,
  selectedItemDetail: null,
  showDetail: false,

  isPlaying: false,
  playerTmdbId: 0,
  playerMediaType: 'movie',
  playerSeason: 1,
  playerEpisode: 1,
  playerTitle: '',
  directPlayUrl: null,
  directPlayTitle: '',
  selectedSeason: 1,
  selectedEpisode: 1,
  episodes: [],
  loadingEpisodes: false,
  showPlayerInfo: false,

  searchQuery: '',
  searchOpen: false,
  searchResults: [],
  searching: false,

  // Continue watching — persisted to localStorage, hydrated after mount
  continueWatching: [],
  setContinueWatching: (items) => {
    set({ continueWatching: items });
    saveContinueWatching(items);
  },
  updateProgress: (id, type, title, posterPath, backdropPath, watched, duration, season, episode) => {
    const list = get().continueWatching.filter(cw => cw.id !== id);
    const item: ContinueWatchingItem = {
      id,
      type,
      title,
      poster_path: posterPath,
      backdrop_path: backdropPath,
      progress: { watched, duration },
      last_updated: Date.now(),
      last_season_watched: season ? String(season) : undefined,
      last_episode_watched: episode ? String(episode) : undefined,
    };
    const next = [item, ...list].slice(0, 40);
    set({ continueWatching: next });
    saveContinueWatching(next);
  },
  getProgress: (id) => {
    const item = get().continueWatching.find(cw => cw.id === id);
    if (!item) return null;
    return {
      watched: item.progress.watched,
      duration: item.progress.duration,
      season: item.last_season_watched ? Number(item.last_season_watched) : undefined,
      episode: item.last_episode_watched ? Number(item.last_episode_watched) : undefined,
    };
  },
  removeFromContinueWatching: (id) => {
    const next = get().continueWatching.filter(cw => cw.id !== id);
    set({ continueWatching: next });
    saveContinueWatching(next);
  },

  // Source blacklist
  noSourceIds: new Set<number>(),
  addToBlacklist: (id) => {
    const blacklist = loadBlacklist();
    if (!blacklist.some(e => e.id === id)) {
      blacklist.push({ id, timestamp: Date.now() });
      saveBlacklist(blacklist);
    }
    set(state => {
      const next = new Set(state.noSourceIds);
      next.add(id);
      return { noSourceIds: next };
    });
  },
  isInBlacklist: (id) => get().noSourceIds.has(id),

  selectItem: (item) => set({ selectedItem: item }),
  openDetail: () => {
    set({ showDetail: true });
    // Push history so the browser/mobile back button closes the modal.
    if (typeof window !== 'undefined' && !window.history.state?.streamxOverlay) {
      window.history.pushState({ streamxOverlay: 'detail' }, '');
    }
  },
  closeDetail: () => set({ showDetail: false, selectedItem: null, selectedItemDetail: null }),
  setDetail: (detail) => set({ selectedItemDetail: detail }),

  playMovie: (item) => {
    const mediaType = item.media_type === 'tv' || item.name ? 'tv' : 'movie';
    const title = item.title || item.name || '';
    // Push history so the browser/mobile back button closes the player.
    if (typeof window !== 'undefined' && !window.history.state?.streamxOverlay) {
      window.history.pushState({ streamxOverlay: 'player' }, '');
    }
    set({
      isPlaying: true,
      playerTmdbId: item.id,
      playerMediaType: mediaType as 'movie' | 'tv',
      playerSeason: 1,
      playerEpisode: 1,
      playerTitle: title,
      directPlayUrl: null,
      showDetail: false,
      showPlayerInfo: false,
      selectedItem: item,
    });
  },

  playEpisode: (season, episode) => {
    const item = get().selectedItem;
    if (!item) return;
    const title = item.title || item.name || '';
    set({
      isPlaying: true,
      playerTmdbId: item.id,
      playerMediaType: 'tv',
      playerSeason: season,
      playerEpisode: episode,
      playerTitle: title,
      directPlayUrl: null,
      showDetail: false,
      showPlayerInfo: false,
      selectedSeason: season,
      selectedEpisode: episode,
    });
  },

  playDirect: (blobUrl, title, item) => {
    set({
      isPlaying: true,
      playerTmdbId: item?.id || 0,
      playerMediaType: 'movie',
      playerSeason: 1,
      playerEpisode: 1,
      playerTitle: title,
      directPlayUrl: blobUrl,
      directPlayTitle: title,
      showDetail: false,
      showPlayerInfo: false,
      selectedItem: item || null,
    });
  },

  closePlayer: () => {
    const { directPlayUrl } = get();
    if (directPlayUrl) {
      try { URL.revokeObjectURL(directPlayUrl); } catch { /* ignore */ }
    }
    set({
      isPlaying: false,
      playerTmdbId: 0,
      playerMediaType: 'movie',
      playerSeason: 1,
      playerEpisode: 1,
      playerTitle: '',
      directPlayUrl: null,
      directPlayTitle: '',
      episodes: [],
      selectedSeason: 1,
      selectedEpisode: 1,
      showPlayerInfo: false,
    });
  },

  setEpisodes: (episodes) => set({ episodes }),
  setLoadingEpisodes: (loading) => set({ loadingEpisodes: loading }),
  setSelectedSeason: (season) => set({ selectedSeason: season }),
  setSelectedEpisode: (episode) => set({ selectedEpisode: episode }),
  setShowPlayerInfo: (show) => set({ showPlayerInfo: show }),

  // Always open detail modal first for ALL items
  handleCardClick: (item) => {
    set({
      selectedItem: item,
      showDetail: true,
      selectedItemDetail: null,
      episodes: [],
      selectedSeason: 1,
      selectedEpisode: 1,
    });
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearchOpen: (open) => set({ searchOpen: open }),
  setSearchResults: (results) => set({ searchResults: results }),
  setSearching: (searching) => set({ searching }),

  // Hydrate ALL localStorage-backed state after mount (hydration-safe).
  // Runs once from a useEffect, never during render.
  hydrateMyList: () => {
    const stored = loadMyListFromStorage();
    if (stored.length > 0) {
      set({ myList: stored });
    }
    // Continue watching + downloads (previously read at store creation,
    // which caused the React #418 hydration mismatch on the home page)
    set({ continueWatching: loadContinueWatching(), downloads: loadDownloads() });
    // Also hydrate blacklist
    const blacklist = loadBlacklist();
    if (blacklist.length > 0) {
      const ids = new Set(blacklist.map(e => e.id));
      set({ noSourceIds: ids });
    }
  },
}));

// Browser/mobile back-button support: when the user pressed back after we
// pushed an overlay state, close the modal/player instead of leaving the app.
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    const s = useStore.getState();
    if (s.isPlaying) {
      s.closePlayer();
    } else if (s.showDetail) {
      s.closeDetail();
    }
  });
}
