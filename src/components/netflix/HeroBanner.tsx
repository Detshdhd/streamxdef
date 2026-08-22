'use client';

import { useState } from 'react';
import { Play, Info } from 'lucide-react';
import { useStore, type MediaItem } from '@/store/useStore';

interface HeroBannerProps {
  items: MediaItem[];
}

function FeaturedCard({ candidate, index }: { candidate: MediaItem; index: number }) {
  const handleCardClick = useStore((state) => state.handleCardClick);
  const playMovie = useStore((state) => state.playMovie);
  const title = candidate.title || candidate.name || '';
  const year = (candidate.release_date || candidate.first_air_date || '').substring(0, 4);
  const isTV = candidate.media_type === 'tv' || !!candidate.name;
  const [imagePath, setImagePath] = useState(candidate.poster_path || candidate.backdrop_path);
  const [imageError, setImageError] = useState(false);
  const isPoster = imagePath === candidate.poster_path;
  const imageUrl = imagePath
    ? `https://image.tmdb.org/t/p/${isPoster ? 'w342' : 'w780'}${imagePath}`
    : null;

  const handleImageError = () => {
    if (isPoster && candidate.backdrop_path) {
      setImagePath(candidate.backdrop_path);
      return;
    }
    setImageError(true);
  };

  return (
    <article className="nfx-featured-card">
      <button
        type="button"
        className="nfx-featured-artwork"
        onClick={() => handleCardClick(candidate)}
        aria-label={`Más información: ${title}`}
      >
        {imageUrl && !imageError ? (
          <img
            src={imageUrl}
            srcSet={imagePath ? (isPoster
              ? `https://image.tmdb.org/t/p/w185${imagePath} 185w, https://image.tmdb.org/t/p/w342${imagePath} 342w`
              : `https://image.tmdb.org/t/p/w342${imagePath} 342w, https://image.tmdb.org/t/p/w780${imagePath} 780w`) : undefined}
            sizes="(max-width: 640px) 172px, (max-width: 900px) 190px, (max-width: 1100px) 214px, 224px"
            alt={title}
            className="nfx-featured-image"
            loading={index < 2 ? 'eager' : 'lazy'}
            decoding="async"
            onError={handleImageError}
          />
        ) : (
          <span className="flex h-full items-center justify-center px-4 text-center text-[11px] font-medium leading-snug text-white/35">
            {title}
          </span>
        )}
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
}

/** Static featured shelf. Posters keep the same portrait geometry as catalogue rows. */
export default function HeroBanner({ items }: HeroBannerProps) {
  const candidates = items
    .filter((item) => (item.poster_path || item.backdrop_path) && (item.title || item.name))
    .slice(0, 8);

  if (candidates.length === 0) return null;

  return (
    <section className="nfx-featured" aria-label="Contenido destacado">
      <div className="nfx-featured-header">
        <h1 className="nfx-font-hero">Destacados</h1>
        <span>Portadas seleccionadas para ti</span>
      </div>
      <div className="nfx-featured-track">
        {candidates.map((candidate, index) => (
          <FeaturedCard
            key={`${candidate.id}-${candidate.media_type || 'movie'}`}
            candidate={candidate}
            index={index}
          />
        ))}
      </div>
    </section>
  );
}
