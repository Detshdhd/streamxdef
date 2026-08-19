import { NextRequest, NextResponse } from 'next/server';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const API_KEY = process.env.TMDB_API_KEY!;
const BEARER = process.env.TMDB_BEARER!;

async function tmdbFetch(path: string, params: Record<string, string> = {}, page?: string | null) {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set('api_key', API_KEY);
  url.searchParams.set('language', 'es-ES');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  if (page && (path.startsWith('/discover') || path.startsWith('/trending') || path === '/movie/top_rated' || path === '/movie/now_playing' || path === '/movie/upcoming' || path === '/tv/top_rated' || path === '/tv/on_the_air' || path === '/tv/popular')) {
    url.searchParams.set('page', page);
  }
  const res = await fetch(url.toString(), {
    headers: { 'Authorization': `Bearer ${BEARER}`, 'Content-Type': 'application/json' },
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`TMDB error: ${res.status}`);
  return res.json();
}

// Resolve raw TMDB data for a given type. The GET wrapper below adds
// Cache-Control headers so the Vercel edge CDN serves repeat requests
// in ~20ms without invoking the function or hitting TMDB upstream.
async function resolveData(type: string, searchParams: URLSearchParams, page: string | null): Promise<unknown> {
  switch (type) {
      /* ─── General ─────────────────────────────────────────────── */
      case 'trending':
        return await tmdbFetch('/trending/all/week');

      /* ─── Movies ──────────────────────────────────────────────── */
      case 'popular-movies':
        return await tmdbFetch('/discover/movie', {
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '6.0',
        }, page);
      case 'top-rated':
        return await tmdbFetch('/movie/top_rated', {}, page);
      case 'now-playing':
        return await tmdbFetch('/movie/now_playing', {}, page);
      case 'upcoming':
        return await tmdbFetch('/movie/upcoming', {}, page);

      /* ─── TV ──────────────────────────────────────────────────── */
      case 'popular-tv':
        return await tmdbFetch('/discover/tv', {
          sort_by: 'popularity.desc',
          'vote_count.gte': '200',
          'vote_average.gte': '6.5',
        }, page);
      case 'top-rated-series':
        return await tmdbFetch('/tv/top_rated', {}, page);
      case 'on-the-air':
        return await tmdbFetch('/tv/on_the_air', {}, page);

      /* ─── Movie Genres — best-rated + popular (no obscure films) ──
         Strategy: sort by popularity.desc with high vote_count.gte + vote_average.gte
         This ensures we get well-known, highly-rated movies — not obscure 10.0-rated films with 5 votes.
      */
      case 'action':
        return await tmdbFetch('/discover/movie', {
          with_genres: '28',
          sort_by: 'popularity.desc',
          'vote_count.gte': '1000',
          'vote_average.gte': '6.5',
        }, page);
      case 'comedy':
        return await tmdbFetch('/discover/movie', {
          with_genres: '35',
          sort_by: 'popularity.desc',
          'vote_count.gte': '1000',
          'vote_average.gte': '6.5',
        }, page);
      case 'horror':
        return await tmdbFetch('/discover/movie', {
          with_genres: '27',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '6.0',
        }, page);
      case 'animation':
        return await tmdbFetch('/discover/movie', {
          with_genres: '16',
          sort_by: 'popularity.desc',
          'vote_count.gte': '1000',
          'vote_average.gte': '6.5',
        }, page);
      case 'documentary':
        return await tmdbFetch('/discover/movie', {
          with_genres: '99',
          sort_by: 'popularity.desc',
          'vote_count.gte': '300',
          'vote_average.gte': '7.0',
        }, page);
      case 'thriller':
        return await tmdbFetch('/discover/movie', {
          with_genres: '53',
          sort_by: 'popularity.desc',
          'vote_count.gte': '1000',
          'vote_average.gte': '6.5',
        }, page);
      case 'romance':
        return await tmdbFetch('/discover/movie', {
          with_genres: '10749',
          sort_by: 'popularity.desc',
          'vote_count.gte': '1000',
          'vote_average.gte': '6.5',
        }, page);
      case 'fantasy':
        return await tmdbFetch('/discover/movie', {
          with_genres: '14',
          sort_by: 'popularity.desc',
          'vote_count.gte': '1000',
          'vote_average.gte': '6.5',
        }, page);
      case 'mystery':
        return await tmdbFetch('/discover/movie', {
          with_genres: '9648',
          sort_by: 'popularity.desc',
          'vote_count.gte': '1000',
          'vote_average.gte': '6.5',
        }, page);
      case 'war':
        return await tmdbFetch('/discover/movie', {
          with_genres: '10752',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '6.5',
        }, page);
      case 'western':
        return await tmdbFetch('/discover/movie', {
          with_genres: '37',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '6.5',
        }, page);
      case 'scifi-movies':
        return await tmdbFetch('/discover/movie', {
          with_genres: '878',
          sort_by: 'popularity.desc',
          'vote_count.gte': '1000',
          'vote_average.gte': '6.5',
        }, page);
      case 'drama-movies':
        return await tmdbFetch('/discover/movie', {
          with_genres: '18',
          sort_by: 'popularity.desc',
          'vote_count.gte': '1000',
          'vote_average.gte': '6.5',
        }, page);
      case 'crime-movies':
        return await tmdbFetch('/discover/movie', {
          with_genres: '80',
          sort_by: 'popularity.desc',
          'vote_count.gte': '1000',
          'vote_average.gte': '6.5',
        }, page);
      case 'adventure':
        return await tmdbFetch('/discover/movie', {
          with_genres: '12',
          sort_by: 'popularity.desc',
          'vote_count.gte': '1000',
          'vote_average.gte': '6.5',
        }, page);
      case 'family':
        return await tmdbFetch('/discover/movie', {
          with_genres: '10751',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '6.5',
        }, page);
      case 'history':
        return await tmdbFetch('/discover/movie', {
          with_genres: '36',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '6.5',
        }, page);
      case 'music':
        return await tmdbFetch('/discover/movie', {
          with_genres: '10402',
          sort_by: 'popularity.desc',
          'vote_count.gte': '300',
          'vote_average.gte': '6.5',
        }, page);

      /* ─── Genre Combinations & Decades ── */
      case 'action-thriller':
        return await tmdbFetch('/discover/movie', {
          with_genres: '28,53',
          sort_by: 'popularity.desc',
          'vote_count.gte': '1000',
          'vote_average.gte': '6.5',
        }, page);
      case 'romcom':
        return await tmdbFetch('/discover/movie', {
          with_genres: '35,10749',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '6.0',
        }, page);
      case 'horror-mystery':
        return await tmdbFetch('/discover/movie', {
          with_genres: '27,9648',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '6.0',
        }, page);
      case 'scifi-fantasy':
        return await tmdbFetch('/discover/movie', {
          with_genres: '878,14',
          sort_by: 'popularity.desc',
          'vote_count.gte': '1000',
          'vote_average.gte': '6.5',
        }, page);
      case 'classics-90s':
        return await tmdbFetch('/discover/movie', {
          'primary_release_date.gte': '1990-01-01',
          'primary_release_date.lte': '1999-12-31',
          sort_by: 'popularity.desc',
          'vote_count.gte': '2000',
          'vote_average.gte': '7.0',
        }, page);
      case 'best-2000s':
        return await tmdbFetch('/discover/movie', {
          'primary_release_date.gte': '2000-01-01',
          'primary_release_date.lte': '2009-12-31',
          sort_by: 'popularity.desc',
          'vote_count.gte': '2000',
          'vote_average.gte': '7.0',
        }, page);
      case 'best-2010s':
        return await tmdbFetch('/discover/movie', {
          'primary_release_date.gte': '2010-01-01',
          'primary_release_date.lte': '2019-12-31',
          sort_by: 'popularity.desc',
          'vote_count.gte': '2000',
          'vote_average.gte': '7.0',
        }, page);
      case 'top-action-2020s':
        return await tmdbFetch('/discover/movie', {
          with_genres: '28',
          'primary_release_date.gte': '2020-01-01',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '6.5',
        }, page);
      case 'highly-rated-hidden':
        return await tmdbFetch('/discover/movie', {
          sort_by: 'vote_average.desc',
          'vote_count.gte': '50',
          'vote_count.lte': '500',
          'vote_average.gte': '7.5',
        }, page);

      /* ─── TV Genres — best-rated + popular ── */
      case 'drama-series':
        return await tmdbFetch('/discover/tv', {
          with_genres: '18',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '7.0',
        }, page);
      case 'scifi-series':
        return await tmdbFetch('/discover/tv', {
          with_genres: '10765',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '7.0',
        }, page);
      case 'crime-series':
        return await tmdbFetch('/discover/tv', {
          with_genres: '80',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '7.0',
        }, page);
      case 'animation-series':
        return await tmdbFetch('/discover/tv', {
          with_genres: '16',
          sort_by: 'popularity.desc',
          'vote_count.gte': '300',
          'vote_average.gte': '7.0',
        }, page);
      case 'comedy-series':
        return await tmdbFetch('/discover/tv', {
          with_genres: '35',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '7.0',
        }, page);
      case 'mystery-series':
        return await tmdbFetch('/discover/tv', {
          with_genres: '9648',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '7.0',
        }, page);
      case 'thriller-series':
        return await tmdbFetch('/discover/tv', {
          with_genres: '53',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '7.0',
        }, page);
      case 'action-series':
        return await tmdbFetch('/discover/tv', {
          with_genres: '10759',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '7.0',
        }, page);
      case 'war-series':
        return await tmdbFetch('/discover/tv', {
          with_genres: '10768',
          sort_by: 'popularity.desc',
          'vote_count.gte': '300',
          'vote_average.gte': '7.0',
        }, page);
      case 'documentary-series':
        return await tmdbFetch('/discover/tv', {
          with_genres: '99',
          sort_by: 'popularity.desc',
          'vote_count.gte': '300',
          'vote_average.gte': '7.0',
        }, page);
      case 'drama-crime-series':
        return await tmdbFetch('/discover/tv', {
          with_genres: '18,80',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '7.0',
        }, page);
      case 'scifi-mystery-series':
        return await tmdbFetch('/discover/tv', {
          with_genres: '10765,9648',
          sort_by: 'popularity.desc',
          'vote_count.gte': '300',
          'vote_average.gte': '7.0',
        }, page);
      case 'reality-series':
        return await tmdbFetch('/discover/tv', {
          with_genres: '10764',
          sort_by: 'popularity.desc',
          'vote_count.gte': '200',
          'vote_average.gte': '6.0',
        }, page);
      case 'kids-series':
        return await tmdbFetch('/discover/tv', {
          with_genres: '10762',
          sort_by: 'popularity.desc',
          'vote_count.gte': '200',
          'vote_average.gte': '6.0',
        }, page);

      /* ─── Backward compat aliases ────────────────────────────── */
      case 'drama':
        return await tmdbFetch('/discover/tv', {
          with_genres: '18',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '7.0',
        }, page);
      case 'scifi':
        return await tmdbFetch('/discover/tv', {
          with_genres: '10765',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '7.0',
        }, page);
      case 'crime':
        return await tmdbFetch('/discover/tv', {
          with_genres: '80',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '7.0',
        }, page);
      case 'popular-tv-series':
        return await tmdbFetch('/tv/popular', {}, page);

      /* ─── Search & Details ────────────────────────────────────── */
      case 'search': {
        const query = searchParams.get('query') || '';
        if (!query) return { results: [] };
        return await tmdbFetch('/search/multi', { query });
      }
      case 'detail-movie': {
        const id = searchParams.get('id') || '';
        const [details, credits, similar, videos] = await Promise.all([
          tmdbFetch(`/movie/${id}`),
          tmdbFetch(`/movie/${id}/credits`),
          tmdbFetch(`/movie/${id}/similar`),
          tmdbFetch(`/movie/${id}/videos`),
        ]);
        return { ...details, credits, similar, videos };
      }
      case 'detail-tv': {
        const id = searchParams.get('id') || '';
        const [details, credits, similar, videos] = await Promise.all([
          tmdbFetch(`/tv/${id}`),
          tmdbFetch(`/tv/${id}/credits`),
          tmdbFetch(`/tv/${id}/similar`),
          tmdbFetch(`/tv/${id}/videos`),
        ]);
        return { ...details, credits, similar, videos };
      }
      case 'season-detail': {
        const id = searchParams.get('id') || '';
        const season = searchParams.get('season') || '1';
        const data = await tmdbFetch(`/tv/${id}/season/${season}`);
        return data;
      }
      default:
        return { __invalid: true };
  }
}


export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || '';

  try {
    const page = searchParams.get('page');
    const data = await resolveData(type, searchParams, page);

    if (data && typeof data === 'object' && '__invalid' in data) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }

    // ─── EDGE CACHE TTLs ───
    // s-maxage makes the Vercel CDN cache this response: the next request
    // (any user, same query) is served from the edge in ~20ms with ZERO
    // function invocations and ZERO TMDB upstream calls.
    //   trending    → 5 min  (rotates daily-ish, 5min is plenty)
    //   details     → 24 h   (movie/TV metadata basically never changes)
    //   search      → 1 min  (short, queries vary)
    //   lists/genres→ 1 h    (discover lists barely change)
    const isTrending = type === 'trending';
    const isDetail = type.startsWith('detail-') || type === 'season-detail';
    const isSearch = type === 'search';
    const sMaxage = isSearch ? 60 : isTrending ? 300 : isDetail ? 86400 : 3600;
    const swr = isSearch ? 300 : 86400;

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': `public, s-maxage=${sMaxage}, stale-while-revalidate=${swr}`,
      },
    });
  } catch (error) {
    console.error('TMDB API error:', error);
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
  }
}
