import { NextRequest, NextResponse } from 'next/server';

/**
 * /api/source-check
 * 
 * Batch source availability check using Vimeus.
 * Vimeus is RELIABLE — it only lists actual content with playable sources.
 * Vidrock returns data for every TMDB ID (even non-existent), so it's unreliable.
 * 
 * Results are cached in-memory for 30 minutes.
 * Client-side blacklist catches items that pass but still fail in playback.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const VIMEUS_VIEW_KEY = '-lSqv306Lsq7S9v2cVW8ifCRR67VxaPXYvIxJXjdAok';
const VIMEUS_DOMAIN = 'https://vimeus.com';

// In-memory cache
const sourceCache = new Map<string, { available: boolean; timestamp: number }>();
const inFlightChecks = new Map<string, Promise<boolean | null>>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

type CheckResult = boolean | null;

function getCacheKey(id: number, type: string): string {
  return `${type}-${id}`;
}

/**
 * Check Vimeus: fetch the provider page and check for actual sources.
 */
async function checkVimeus(tmdbId: number, type: string, season?: string, episode?: string): Promise<CheckResult> {
  const contentType = type === 'tv' ? 'serie' : 'movie';
  
  try {
    const url = new URL(`${VIMEUS_DOMAIN}/e/${contentType}`);
    url.searchParams.set('tmdb', String(tmdbId));
    url.searchParams.set('view_key', VIMEUS_VIEW_KEY);
    if (season) url.searchParams.set('se', season);
    if (episode) url.searchParams.set('ep', episode);

    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Referer': VIMEUS_DOMAIN,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) return null;

    const html = await response.text();
    const dataMatch = html.match(/<script[^>]*id="data"[^>]*>([\s\S]*?)<\/script>/i);
    if (!dataMatch) return null;

    try {
      const vimeusData = JSON.parse(dataMatch[1]);
      const sources = vimeusData.embeds || [];
      return sources.some((e: { url?: string; lang?: string | null; subtitle?: number }) => {
        if (!e.url || e.subtitle) return false;
        const value = (e.lang || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return /latino|latam|latin america|es-419|spanish latino|espanol latino|ingles|english|\beng?\b/.test(value)
          || /vimeos\./i.test(e.url);
      });
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Check a single item using Vimeus with cache.
 */
async function checkSingle(id: number, type: string): Promise<CheckResult> {
  const cacheKey = getCacheKey(id, type);
  const cached = sourceCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) return cached.available;

  const existing = inFlightChecks.get(cacheKey);
  if (existing) return existing;

  // TV checks are only a hint; playback validates the selected episode.
  const season = type === 'tv' ? '1' : undefined;
  const episode = type === 'tv' ? '1' : undefined;
  const request = checkVimeus(id, type, season, episode).then((available) => {
    if (available !== null) sourceCache.set(cacheKey, { available, timestamp: Date.now() });
    return available;
  }).finally(() => {
    if (inFlightChecks.get(cacheKey) === request) inFlightChecks.delete(cacheKey);
  });
  inFlightChecks.set(cacheKey, request);
  return request;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const idsParam = searchParams.get('ids') || '';
  const type = searchParams.get('type') || 'movie';

  if (!idsParam) {
    return NextResponse.json({ error: 'ids parameter required (comma-separated)' }, { status: 400 });
  }

  const ids = idsParam.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));

  if (ids.length === 0) {
    return NextResponse.json({ error: 'No valid IDs provided' }, { status: 400 });
  }

  // Limit batch size to 20 to prevent overload
  const batchIds = ids.slice(0, 20);

  // Check all items with limited concurrency (5 at a time)
  const results: Record<string, boolean> = {};
  const concurrency = 5;

  for (let i = 0; i < batchIds.length; i += concurrency) {
    const chunk = batchIds.slice(i, i + concurrency);
      const checks = await Promise.all(
        chunk.map(async (id) => {
          const available = await checkSingle(id, type);
          return { id, available };
        })
      );
      for (const { id, available } of checks) {
        if (available !== null) results[String(id)] = available;
      }
  }

  // Periodically clean old cache entries
  if (sourceCache.size > 500) {
    const now = Date.now();
    for (const [key, value] of sourceCache.entries()) {
      if (now - value.timestamp > CACHE_TTL) {
        sourceCache.delete(key);
      }
    }
  }

  return NextResponse.json({ available: results });
}
