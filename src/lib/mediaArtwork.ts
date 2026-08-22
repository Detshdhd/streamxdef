import type { MediaItem } from '@/store/useStore';

export function hasArtwork(item: { poster_path?: string | null; backdrop_path?: string | null }): boolean {
  return Boolean(item.poster_path || item.backdrop_path);
}

export function artworkUrl(path: string | null | undefined, kind: 'poster' | 'backdrop' = 'poster'): string | null {
  if (!path) return null;
  return `https://image.tmdb.org/t/p/${kind === 'poster' ? 'w342' : 'w780'}${path}`;
}
