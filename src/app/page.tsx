import HomeClient from './HomeClient';
import type { MediaItem } from '@/store/useStore';

// ISR: el HTML (con trending DENTRO) se regenera cada 5 min y se sirve
// desde el edge. El hero + primera fila pintan con el documento — el
// waterfall JS→API→render desaparece del arranque.
export const revalidate = 300;

const TMDB_BASE = 'https://api.themoviedb.org/3';

async function getTrending(): Promise<MediaItem[]> {
  const key = process.env.TMDB_API_KEY;
  const bearer = process.env.TMDB_BEARER;
  if (!key || !bearer) return [];
  try {
    const pages = await Promise.all([1, 2, 3].map(async (p) => {
      const url = `${TMDB_BASE}/trending/all/week?api_key=${key}&language=es-ES&page=${p}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`TMDB ${res.status}`);
      return (await res.json()) as { results?: MediaItem[] };
    }));
    return pages.flatMap(p => p.results || []);
  } catch {
    // Sin datos embebidos, HomeClient cae a su fetch normal — la página
    // nunca se rompe por un TMDB lento.
    return [];
  }
}

export default async function Page() {
  const trending = await getTrending();
  return <HomeClient initialTrending={trending} />;
}
