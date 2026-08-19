'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '@/store/useStore';
import { Search, X, Bell, ChevronDown, Home, Film, Tv, Heart, Download } from 'lucide-react';
import type { ActiveTab, MediaItem } from '@/store/useStore';

const NAV_LINKS: { key: ActiveTab | string; label: string; icon?: typeof Home }[] = [
  { key: 'inicio', label: 'Inicio', icon: Home },
  { key: 'peliculas', label: 'Películas', icon: Film },
  { key: 'series', label: 'Series', icon: Tv },
  { key: 'mi-lista', label: 'Mi Lista', icon: Heart },
  { key: 'descargas', label: 'Descargas', icon: Download },
];

const MOBILE_TABS: { key: ActiveTab; label: string; icon: typeof Home }[] = [
  { key: 'inicio', label: 'Inicio', icon: Home },
  { key: 'peliculas', label: 'Películas', icon: Film },
  { key: 'series', label: 'Series', icon: Tv },
  { key: 'mi-lista', label: 'Mi Lista', icon: Heart },
  { key: 'descargas', label: 'Descargas', icon: Download },
];

export default function Navbar() {
  const {
    activeTab,
    setActiveTab,
    searchQuery,
    searchOpen,
    searching,
    searchResults,
    setSearchQuery,
    setSearchOpen,
    setSearchResults,
    setSearching,
    handleCardClick,
    isPlaying,
  } = useStore();
  const activeDownloadCount = useStore(s => s.downloads.filter(d => d.status === 'downloading').length);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [profileHover, setProfileHover] = useState(false);
  const [mobileActiveIndex, setMobileActiveIndex] = useState(0);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (searchOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [searchOpen]);

  useEffect(() => {
    const idx = MOBILE_TABS.findIndex(t => t.key === activeTab);
    if (idx >= 0) setTimeout(() => setMobileActiveIndex(idx), 0);
  }, [activeTab]);

  const doSearch = useCallback(
    async (query: string) => {
      if (!query.trim()) { setSearchResults([]); return; }
      setSearching(true);
      try {
        const res = await fetch(`/api/tmdb?type=search&query=${encodeURIComponent(query)}`);
        const data = await res.json();
        const filtered = (data.results || []).filter(
          (item: { media_type: string; poster_path: string | null }) =>
            (item.media_type === 'movie' || item.media_type === 'tv') && item.poster_path
        );
        setSearchResults(filtered.slice(0, 10));
      } catch { setSearchResults([]); }
      setSearching(false);
    },
    [setSearching, setSearchResults]
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(searchQuery), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery, doSearch]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        if (searchOpen) { setSearchOpen(false); setSearchQuery(''); setSearchResults([]); }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [searchOpen, setSearchOpen, setSearchQuery, setSearchResults]);

  const handleSelect = (item: MediaItem) => {
    handleCardClick(item);
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  const getYear = (item: MediaItem) => {
    if (item.release_date) return item.release_date.substring(0, 4);
    if (item.first_air_date) return item.first_air_date.substring(0, 4);
    return '';
  };

  const getTypeLabel = (item: MediaItem) => {
    if (item.media_type === 'tv' || item.name) return 'Serie';
    return 'Película';
  };

  const closeSearch = () => { setSearchOpen(false); setSearchQuery(''); setSearchResults([]); };
  const openSearch = () => { setActiveTab('buscar'); };

  if (isPlaying) return null;

  return (
    <>
      {/* ── Apple TV-style top navigation ── */}
      <nav className={`nfx-nav ${scrolled ? 'nfx-nav--scrolled' : 'nfx-glass-frost'}`}>
        <div className="nfx-nav-inner">
          {/* Desktop links stay visually centered between the two control groups. */}
          <div className="nfx-nav-links">
            {NAV_LINKS.map(({ key, label }) => {
              const isActive = activeTab === key;
              return (
                <button
                  key={key}
                  onClick={() => setActiveTab(key as ActiveTab)}
                  className={`nfx-nav-link ${isActive ? 'nfx-nav-link--active' : ''}`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Search, notifications and profile */}
          <div className="nfx-nav-actions">
            <div className={`nfx-search-shell ${searchOpen ? 'nfx-search-shell--open' : ''}`} ref={searchContainerRef}>
              <Search className="nfx-search-icon" aria-hidden="true" />
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => { if (!searchOpen) openSearch(); }}
                placeholder="Buscar"
                aria-label="Buscar"
              />
              {searchOpen && (
                <button onClick={closeSearch} className="nfx-search-close" aria-label="Cerrar búsqueda">
                  <X />
                </button>
              )}
            </div>

            <button
              onClick={() => setActiveTab('descargas')}
              className="nfx-nav-icon hidden md:flex"
              aria-label="Descargas"
              title="Descargas"
            >
              <Bell />
              {activeDownloadCount > 0 && <span className="nfx-notification-dot" />}
            </button>

            <div
              className="relative"
              onMouseEnter={() => setProfileHover(true)}
              onMouseLeave={() => setProfileHover(false)}
            >
              <button className="nfx-profile" aria-label="Perfil">
                <span>S</span>
                <ChevronDown className={`nfx-profile-chevron ${profileHover ? 'rotate-180' : ''}`} />
              </button>

              {profileHover && (
                <div className="absolute top-full right-0 mt-2 w-[200px] glass-heavy rounded-xl py-2 animate-nfx-fade-in">
                  <button
                    onClick={() => setActiveTab('mi-lista')}
                    className="w-full text-left px-4 py-2.5 text-[13px] text-white/60 hover:text-white hover:bg-white/5 transition-colors duration-150"
                  >Mi Lista</button>
                  <button
                    onClick={() => setActiveTab('descargas')}
                    className="w-full text-left px-4 py-2.5 text-[13px] text-white/60 hover:text-white hover:bg-white/5 transition-colors duration-150"
                  >Descargas</button>
                  <div className="border-t border-white/5 my-1" />
                  <button
                    onClick={() => {
                      if (confirm('¿Limpiar Mi Lista, Seguir viendo y recargar la app?')) {
                        localStorage.removeItem('streamx-my-list');
                        localStorage.removeItem('streamx-cw');
                        localStorage.removeItem('streamx-downloads');
                        window.location.reload();
                      }
                    }}
                    className="w-full text-left px-4 py-2.5 text-[13px] text-white/40 hover:text-white hover:bg-white/5 transition-colors duration-150"
                  >Limpiar datos</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Search Results Dropdown */}
      {searchOpen && (searchResults.length > 0 || (searchQuery.trim() && !searching)) && (
        <div className="nfx-search-dropdown absolute top-[64px] right-[3%] w-[380px] lg:w-[420px] overflow-hidden max-h-[70vh] overflow-y-auto z-[1001] rounded-xl">
          {searching && (
            <div className="p-6 text-center text-white/30 text-sm">Buscando...</div>
          )}
          {!searching && searchResults.length === 0 && searchQuery.trim() && (
            <div className="p-6 text-center text-white/30 text-sm">
              No encontramos &quot;{searchQuery}&quot;
            </div>
          )}
          {searchResults.map((item) => (
            <button
              key={`${item.id}-${item.media_type}`}
              onClick={() => handleSelect(item)}
              className="flex items-center gap-3 w-full px-4 py-3 hover:bg-white/8 transition-colors duration-150 text-left"
            >
              {item.poster_path && (
                <img
                  src={`https://image.tmdb.org/t/p/w92${item.poster_path}`}
                  alt=""
                  className="w-[40px] h-[60px] object-cover shrink-0 rounded-lg"
                  loading="lazy"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-white text-[13px] font-medium truncate">
                  {item.title || item.name || ''}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[11px] text-white/30">{getYear(item)}</span>
                  <span className="inline-flex bg-white/10 text-[10px] text-white/70 rounded-full px-1.5 py-[1px]">
                    {getTypeLabel(item)}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ── Mobile Bottom Nav ── */}
      <div className="md:hidden nfx-mobile-nav">
        <div className="relative flex items-center justify-around h-[52px] px-1">
          {/* Active indicator */}
          <div
            className="nfx-mobile-nav-indicator"
            style={{
              width: `${100 / MOBILE_TABS.length}%`,
              left: `${(mobileActiveIndex / MOBILE_TABS.length) * 100}%`,
              bottom: 0,
            }}
          />

          {MOBILE_TABS.map(({ key, label, icon: Icon }, idx) => {
            const isActive = activeTab === key;
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`relative flex flex-col items-center gap-[3px] py-2 flex-1 transition-all duration-200 ${
                  isActive ? 'text-white' : 'text-white/25'
                }`}
              >
                <Icon className={`w-[18px] h-[18px] transition-transform duration-200 ${isActive ? 'scale-110' : ''}`} />
                <span className="text-[9px] font-medium">{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
