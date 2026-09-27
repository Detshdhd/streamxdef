import HomeClient from './HomeClient';
import type { MediaItem } from '@/store/useStore';

// ISR: el HTML (con trending + las 4 primeras filas DENTRO) se regenera
// cada 5 min y se sirve desde el edge. El arranque pinta el catálogo
// completo desde el documento — cero API, cero waterfall.
export const revalidate = 300;

const TMDB_BASE = 'https://api.themoviedb.org/3';

async function tmdb(path: string, params: Record<string, string> = {}): Promise<MediaItem[]> {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set('language', 'es-ES');
  if (process.env.TMDB_API_KEY) url.searchParams.set('api_key', process.env.TMDB_API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { 'Authorization': `Bearer ${process.env.TMDB_BEARER}` },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  const data = await res.json() as { results?: MediaItem[] };
  return data.results || [];
}

/** Los mismos tipos que la primera pantalla del home, con los mismos
 *  filtros exactos que usa /api/tmdb — el cliente no repite el trabajo. */
async function getInitialData(): Promise<Record<string, MediaItem[]>> {
  const guard = <T,>(p: Promise<T>): Promise<T | []> => p.catch(() => [] as unknown as T);
  const [trending, topRated, popularTv, action, thriller] = await Promise.all([
    guard(Promise.all([1, 2, 3].map(p =>
      tmdb('/trending/all/week', { page: String(p) })
    ))).then(pages => (pages as MediaItem[][]).flat()),
    guard(tmdb('/movie/top_rated')),
    guard(tmdb('/discover/tv', { sort_by: 'popularity.desc', 'vote_count.gte': '200', 'vote_average.gte': '6.5' })),
    guard(tmdb('/discover/movie', { with_genres: '28', sort_by: 'popularity.desc', 'vote_count.gte': '1000', 'vote_average.gte': '6.5' })),
    guard(tmdb('/discover/movie', { with_genres: '53', sort_by: 'popularity.desc', 'vote_count.gte': '1000', 'vote_average.gte': '6.5' })),
  ]);
  const out: Record<string, MediaItem[]> = {};
  if (trending.length) out.trending = trending;
  if (topRated.length) out['top-rated'] = topRated;
  if (popularTv.length) out['popular-tv'] = popularTv;
  if (action.length) out.action = action;
  if (thriller.length) out.thriller = thriller;
  return out;
}

export default async function Page() {
  const initialData = await getInitialData();
  return <HomeClient initialData={initialData} />;
}
