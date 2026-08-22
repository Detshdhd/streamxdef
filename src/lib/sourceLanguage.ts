export type AllowedSourceLanguage = 'English' | 'Español Latino';

/** Normalize provider labels to the only audio languages the player exposes. */
export function normalizeSourceLanguage(
  raw: string | null | undefined,
  fallback?: AllowedSourceLanguage,
): AllowedSourceLanguage | null {
  const value = (raw || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (!value) return fallback || null;
  if (/sub(title)?|caption|closed captions?|\bcc\b/.test(value)) return null;
  if (/castellano|\bes-es\b|spain/.test(value)) return null;
  if (/ingles|english|\beng?\b|\ben-us\b|\ben-gb\b/.test(value)) return 'English';
  if (/latino|latam|latin america|es-419|spanish latino|espanol latino/.test(value)) {
    return 'Español Latino';
  }
  return null;
}

export function isAllowedSourceLanguage(
  language: AllowedSourceLanguage | null | undefined,
): language is AllowedSourceLanguage {
  return language === 'English' || language === 'Español Latino';
}

export function sourceLanguageKey(language: string | null | undefined): 'en' | 'es-latino' | null {
  const normalized = normalizeSourceLanguage(language);
  if (normalized === 'English') return 'en';
  if (normalized === 'Español Latino') return 'es-latino';
  return null;
}
