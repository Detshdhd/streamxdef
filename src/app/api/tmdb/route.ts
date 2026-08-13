import { NextRequest, NextResponse } from 'next/server';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const API_KEY = process.env.TMDB_API_KEY!;
const BEARER = process.env.TMDB_BEARER!;

async function tmdbFetch(path: string, params: Record<string, string> = {}) {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set('api_key', API_KEY);
  url.searchParams.set('language', 'es-ES');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { 'Authorization': `Bearer ${BEARER}`, 'Content-Type': 'application/json' },
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`TMDB error: ${res.status}`);
  return res.json();
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || '';

  try {
    switch (type) {
      /* ─── General ─────────────────────────────────────────────── */
      case 'trending':
        return NextResponse.json(await tmdbFetch('/trending/all/week'));

      /* ─── Movies ──────────────────────────────────────────────── */
      case 'popular-movies':
        return NextResponse.json(await tmdbFetch('/discover/movie', {
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '6.0',
        }));
      case 'top-rated':
        return NextResponse.json(await tmdbFetch('/movie/top_rated'));
      case 'now-playing':
        return NextResponse.json(await tmdbFetch('/movie/now_playing'));
      case 'upcoming':
        return NextResponse.json(await tmdbFetch('/movie/upcoming'));

      /* ─── TV ──────────────────────────────────────────────────── */
      case 'popular-tv':
        return NextResponse.json(await tmdbFetch('/discover/tv', {
          sort_by: 'popularity.desc',
          'vote_count.gte': '200',
          'vote_average.gte': '6.5',
        }));
      case 'top-rated-series':
        return NextResponse.json(await tmdbFetch('/tv/top_rated'));
      case 'on-the-air':
        return NextResponse.json(await tmdbFetch('/tv/on_the_air'));

      /* ─── Movie Genres — best-rated + popular (no obscure films) ──
         Strategy: sort by popularity.desc with high vote_count.gte + vote_average.gte
         This ensures we get well-known, highly-rated movies — not obscure 10.0-rated films with 5 votes.
      */
      case 'action':
        return NextResponse.json(await tmdbFetch('/discover/movie', {
          with_genres: '28',
          sort_by: 'popularity.desc',
          'vote_count.gte': '1000',
          'vote_average.gte': '6.5',
        }));
      case 'comedy':
        return NextResponse.json(await tmdbFetch('/discover/movie', {
          with_genres: '35',
          sort_by: 'popularity.desc',
          'vote_count.gte': '1000',
          'vote_average.gte': '6.5',
        }));
      case 'horror':
        return NextResponse.json(await tmdbFetch('/discover/movie', {
          with_genres: '27',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '6.0',
        }));
      case 'animation':
        return NextResponse.json(await tmdbFetch('/discover/movie', {
          with_genres: '16',
          sort_by: 'popularity.desc',
          'vote_count.gte': '1000',
          'vote_average.gte': '6.5',
        }));
      case 'documentary':
        return NextResponse.json(await tmdbFetch('/discover/movie', {
          with_genres: '99',
          sort_by: 'popularity.desc',
          'vote_count.gte': '300',
          'vote_average.gte': '7.0',
        }));
      case 'thriller':
        return NextResponse.json(await tmdbFetch('/discover/movie', {
          with_genres: '53',
          sort_by: 'popularity.desc',
          'vote_count.gte': '1000',
          'vote_average.gte': '6.5',
        }));
      case 'romance':
        return NextResponse.json(await tmdbFetch('/discover/movie', {
          with_genres: '10749',
          sort_by: 'popularity.desc',
          'vote_count.gte': '1000',
          'vote_average.gte': '6.5',
        }));
      case 'fantasy':
        return NextResponse.json(await tmdbFetch('/discover/movie', {
          with_genres: '14',
          sort_by: 'popularity.desc',
          'vote_count.gte': '1000',
          'vote_average.gte': '6.5',
        }));
      case 'mystery':
        return NextResponse.json(await tmdbFetch('/discover/movie', {
          with_genres: '9648',
          sort_by: 'popularity.desc',
          'vote_count.gte': '1000',
          'vote_average.gte': '6.5',
        }));
      case 'war':
        return NextResponse.json(await tmdbFetch('/discover/movie', {
          with_genres: '10752',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '6.5',
        }));
      case 'western':
        return NextResponse.json(await tmdbFetch('/discover/movie', {
          with_genres: '37',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '6.5',
        }));
      case 'scifi-movies':
        return NextResponse.json(await tmdbFetch('/discover/movie', {
          with_genres: '878',
          sort_by: 'popularity.desc',
          'vote_count.gte': '1000',
          'vote_average.gte': '6.5',
        }));
      case 'drama-movies':
        return NextResponse.json(await tmdbFetch('/discover/movie', {
          with_genres: '18',
          sort_by: 'popularity.desc',
          'vote_count.gte': '1000',
          'vote_average.gte': '6.5',
        }));
      case 'crime-movies':
        return NextResponse.json(await tmdbFetch('/discover/movie', {
          with_genres: '80',
          sort_by: 'popularity.desc',
          'vote_count.gte': '1000',
          'vote_average.gte': '6.5',
        }));
      case 'adventure':
        return NextResponse.json(await tmdbFetch('/discover/movie', {
          with_genres: '12',
          sort_by: 'popularity.desc',
          'vote_count.gte': '1000',
          'vote_average.gte': '6.5',
        }));
      case 'family':
        return NextResponse.json(await tmdbFetch('/discover/movie', {
          with_genres: '10751',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '6.5',
        }));
      case 'history':
        return NextResponse.json(await tmdbFetch('/discover/movie', {
          with_genres: '36',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '6.5',
        }));
      case 'music':
        return NextResponse.json(await tmdbFetch('/discover/movie', {
          with_genres: '10402',
          sort_by: 'popularity.desc',
          'vote_count.gte': '300',
          'vote_average.gte': '6.5',
        }));

      /* ─── Genre Combinations & Decades ── */
      case 'action-thriller':
        return NextResponse.json(await tmdbFetch('/discover/movie', {
          with_genres: '28,53',
          sort_by: 'popularity.desc',
          'vote_count.gte': '1000',
          'vote_average.gte': '6.5',
        }));
      case 'romcom':
        return NextResponse.json(await tmdbFetch('/discover/movie', {
          with_genres: '35,10749',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '6.0',
        }));
      case 'horror-mystery':
        return NextResponse.json(await tmdbFetch('/discover/movie', {
          with_genres: '27,9648',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '6.0',
        }));
      case 'scifi-fantasy':
        return NextResponse.json(await tmdbFetch('/discover/movie', {
          with_genres: '878,14',
          sort_by: 'popularity.desc',
          'vote_count.gte': '1000',
          'vote_average.gte': '6.5',
        }));
      case 'classics-90s':
        return NextResponse.json(await tmdbFetch('/discover/movie', {
          'primary_release_date.gte': '1990-01-01',
          'primary_release_date.lte': '1999-12-31',
          sort_by: 'popularity.desc',
          'vote_count.gte': '2000',
          'vote_average.gte': '7.0',
        }));
      case 'best-2000s':
        return NextResponse.json(await tmdbFetch('/discover/movie', {
          'primary_release_date.gte': '2000-01-01',
          'primary_release_date.lte': '2009-12-31',
          sort_by: 'popularity.desc',
          'vote_count.gte': '2000',
          'vote_average.gte': '7.0',
        }));
      case 'best-2010s':
        return NextResponse.json(await tmdbFetch('/discover/movie', {
          'primary_release_date.gte': '2010-01-01',
          'primary_release_date.lte': '2019-12-31',
          sort_by: 'popularity.desc',
          'vote_count.gte': '2000',
          'vote_average.gte': '7.0',
        }));
      case 'top-action-2020s':
        return NextResponse.json(await tmdbFetch('/discover/movie', {
          with_genres: '28',
          'primary_release_date.gte': '2020-01-01',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '6.5',
        }));
      case 'highly-rated-hidden':
        return NextResponse.json(await tmdbFetch('/discover/movie', {
          sort_by: 'vote_average.desc',
          'vote_count.gte': '50',
          'vote_count.lte': '500',
          'vote_average.gte': '7.5',
        }));

      /* ─── TV Genres — best-rated + popular ── */
      case 'drama-series':
        return NextResponse.json(await tmdbFetch('/discover/tv', {
          with_genres: '18',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '7.0',
        }));
      case 'scifi-series':
        return NextResponse.json(await tmdbFetch('/discover/tv', {
          with_genres: '10765',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '7.0',
        }));
      case 'crime-series':
        return NextResponse.json(await tmdbFetch('/discover/tv', {
          with_genres: '80',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '7.0',
        }));
      case 'animation-series':
        return NextResponse.json(await tmdbFetch('/discover/tv', {
          with_genres: '16',
          sort_by: 'popularity.desc',
          'vote_count.gte': '300',
          'vote_average.gte': '7.0',
        }));
      case 'comedy-series':
        return NextResponse.json(await tmdbFetch('/discover/tv', {
          with_genres: '35',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '7.0',
        }));
      case 'mystery-series':
        return NextResponse.json(await tmdbFetch('/discover/tv', {
          with_genres: '9648',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '7.0',
        }));
      case 'thriller-series':
        return NextResponse.json(await tmdbFetch('/discover/tv', {
          with_genres: '53',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '7.0',
        }));
      case 'action-series':
        return NextResponse.json(await tmdbFetch('/discover/tv', {
          with_genres: '10759',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '7.0',
        }));
      case 'war-series':
        return NextResponse.json(await tmdbFetch('/discover/tv', {
          with_genres: '10768',
          sort_by: 'popularity.desc',
          'vote_count.gte': '300',
          'vote_average.gte': '7.0',
        }));
      case 'documentary-series':
        return NextResponse.json(await tmdbFetch('/discover/tv', {
          with_genres: '99',
          sort_by: 'popularity.desc',
          'vote_count.gte': '300',
          'vote_average.gte': '7.0',
        }));
      case 'drama-crime-series':
        return NextResponse.json(await tmdbFetch('/discover/tv', {
          with_genres: '18,80',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '7.0',
        }));
      case 'scifi-mystery-series':
        return NextResponse.json(await tmdbFetch('/discover/tv', {
          with_genres: '10765,9648',
          sort_by: 'popularity.desc',
          'vote_count.gte': '300',
          'vote_average.gte': '7.0',
        }));
      case 'reality-series':
        return NextResponse.json(await tmdbFetch('/discover/tv', {
          with_genres: '10764',
          sort_by: 'popularity.desc',
          'vote_count.gte': '200',
          'vote_average.gte': '6.0',
        }));
      case 'kids-series':
        return NextResponse.json(await tmdbFetch('/discover/tv', {
          with_genres: '10762',
          sort_by: 'popularity.desc',
          'vote_count.gte': '200',
          'vote_average.gte': '6.0',
        }));

      /* ─── Backward compat aliases ────────────────────────────── */
      case 'drama':
        return NextResponse.json(await tmdbFetch('/discover/tv', {
          with_genres: '18',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '7.0',
        }));
      case 'scifi':
        return NextResponse.json(await tmdbFetch('/discover/tv', {
          with_genres: '10765',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '7.0',
        }));
      case 'crime':
        return NextResponse.json(await tmdbFetch('/discover/tv', {
          with_genres: '80',
          sort_by: 'popularity.desc',
          'vote_count.gte': '500',
          'vote_average.gte': '7.0',
        }));
      case 'popular-tv-series':
        return NextResponse.json(await tmdbFetch('/tv/popular'));

      /* ─── Search & Details ────────────────────────────────────── */
      case 'search': {
        const query = searchParams.get('query') || '';
        if (!query) return NextResponse.json({ results: [] });
        return NextResponse.json(await tmdbFetch('/search/multi', { query }));
      }
      case 'detail-movie': {
        const id = searchParams.get('id') || '';
        const [details, credits, similar, videos] = await Promise.all([
          tmdbFetch(`/movie/${id}`),
          tmdbFetch(`/movie/${id}/credits`),
          tmdbFetch(`/movie/${id}/similar`),
          tmdbFetch(`/movie/${id}/videos`),
        ]);
        return NextResponse.json({ ...details, credits, similar, videos });
      }
      case 'detail-tv': {
        const id = searchParams.get('id') || '';
        const [details, credits, similar, videos] = await Promise.all([
          tmdbFetch(`/tv/${id}`),
          tmdbFetch(`/tv/${id}/credits`),
          tmdbFetch(`/tv/${id}/similar`),
          tmdbFetch(`/tv/${id}/videos`),
        ]);
        return NextResponse.json({ ...details, credits, similar, videos });
      }
      case 'season-detail': {
        const id = searchParams.get('id') || '';
        const season = searchParams.get('season') || '1';
        const data = await tmdbFetch(`/tv/${id}/season/${season}`);
        return NextResponse.json(data);
      }
      default:
        return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }
  } catch (error) {
    console.error('TMDB API error:', error);
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
  }
}
