/* ─── Client-side source cache (shared by DetailModal prefetch + VideoPlayer) ─── */

export interface SourceInfo {
  name: string;
  url: string;
  type: 'hls' | 'mp4';
  quality?: string;
  language: string | null;
}

// Sources are expensive to resolve (1-5s of live scraping). Cache them in
// sessionStorage for 10 minutes so re-opening a movie or switching language
// is instant. Must match the server-side cache window in /api/source.
const SOURCE_CACHE_TTL = 10 * 60 * 1000;

export function sourceCacheKey(tmdbId: number, mediaType: string, season?: number, episode?: number): string {
  return `src:${tmdbId}:${mediaType}:${season || ''}:${episode || ''}`;
}

export function getCachedSources(key: string): SourceInfo[] | null {
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

export function setCachedSources(key: string, sources: SourceInfo[]) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ sources, ts: Date.now() }));
  } catch { /* quota full — ignore */ }
}
