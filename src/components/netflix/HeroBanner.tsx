'use client';

import { Play, Info } from 'lucide-react';
import { useStore, type MediaItem } from '@/store/useStore';

interface HeroBannerProps {
  items: MediaItem[];
}

/**
 * Static featured shelf. Posters keep the same portrait geometry as the
 * catalogue rows and avoid the extra network cost of an autoplay hero.
 */
export default function HeroBanner({ items }: HeroBannerProps) {
  const { selectItem, openDetail, playMovie } = useStore();
  const candidates = items
    .filter((item) => item.poster_path && (item.title || item.name))
    .slice(0, 8);

  if (candidates.length === 0) return null;

  return (
    <section className="nfx-featured" aria-label="Contenido destacado">
      <div className="nfx-featured-header">
        <h1 className="nfx-font-hero">Destacados</h1>
        <span>Portadas seleccionadas para ti</span>
      </div>
      <div className="nfx-featured-track">
        {candidates.map((candidate, index) => {
          const title = candidate.title || candidate.name || '';
          const year = (candidate.release_date || candidate.first_air_date || '').substring(0, 4);
          const isTV = candidate.media_type === 'tv' || !!candidate.name;

          return (
            <article key={`${candidate.id}-${candidate.media_type || 'movie'}`} className="nfx-featured-card">
              <button
                type="button"
                className="nfx-featured-artwork"
                onClick={() => { selectItem(candidate); openDetail(); }}
                aria-label={`Más información: ${title}`}
              >
                <img
                  src={`https://image.tmdb.org/t/p/w342${candidate.poster_path}`}
                  srcSet={`https://image.tmdb.org/t/p/w185${candidate.poster_path} 185w, https://image.tmdb.org/t/p/w342${candidate.poster_path} 342w`}
                  sizes="(max-width: 640px) 34vw, (max-width: 900px) 20vw, 172px"
                  alt={title}
                  className="nfx-featured-image"
                  loading={index < 4 ? 'eager' : 'lazy'}
                  decoding="async"
                />
                <span className="nfx-featured-shade" />
                <span className="nfx-featured-play" aria-hidden="true">
                  <Play className="w-4 h-4 fill-black text-black" />
                </span>
              </button>
              <div className="nfx-featured-copy">
                <strong>{title}</strong>
                <span>{[year, isTV ? 'Serie' : 'Película'].filter(Boolean).join(' · ')}</span>
              </div>
              <button
                type="button"
                className="nfx-featured-info"
                onClick={() => playMovie(candidate)}
              >
                <Info className="w-3.5 h-3.5" />
                Reproducir
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
