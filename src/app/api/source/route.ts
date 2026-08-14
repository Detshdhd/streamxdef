import { NextRequest, NextResponse } from 'next/server';
import { createDecipheriv } from 'crypto';

// Allow up to 10s on Vercel so both Vidrock + Vimeus can finish.
export const maxDuration = 10;
// Pin to same region as /api/proxy so CDN tokens (ASN-bound) match.
export const preferredRegion = 'iad1';

/**
 * /api/source
 *
 * Combines TWO providers for maximum coverage:
 *   1. VIMEUS   — Spanish/Latino sources (goodstream.one is reliable)
 *   2. VIDROCK  — English m3u8 sources via API + AES-GCM decryption
 *
 * VIDEASY REMOVED — broken, no sources found.
 * Vidrock re-added — now works with AES-GCM decryption of API responses.
 * 
 * KEY FIXES:
 *   - Removed HEAD verification (many HLS servers reject HEAD but work with GET)
 *   - VIDROCK: decrypt AES-GCM encrypted URLs from vidrock.ru/api endpoint
 *   - Vimeus: skip browser-only providers earlier to save time
 */

/* ─── Shared Types ──────────────────────────────────────────────── */

interface ResolvedSource {
  name: string;
  url: string;
  type: 'hls' | 'mp4';
  quality?: string;
  language: string | null;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// In-memory source cache — avoids re-scraping Vimeus/Vidrock on every request.
const sourceCache = new Map<string, { sources: ResolvedSource[]; timestamp: number }>();
const SOURCE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/* ═══════════════════════════════════════════════════════════════════
   VIDROCK — English m3u8 sources via API + AES-GCM decryption
   ═══════════════════════════════════════════════════════════════════ */

const VIDROCK_API = 'https://vidrock.ru/api';

// AES-GCM key extracted from vidrock.ru JS bundle (index-sQtBxu0M.js)
// Key: xQ = "7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f"
const VIDROCK_AES_KEY_HEX = '7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f';

/**
 * Decrypt a Vidrock AES-GCM encrypted URL.
 * The vidrock API returns base64url-encoded ciphertext.
 * Format: first 12 bytes = IV, rest = ciphertext + 16-byte auth tag.
 * Uses AES-256-GCM with a fixed key derived from hex string.
 */
function decryptVidrockUrl(encodedUrl: string): string | null {
  try {
    // Base64url decode: replace - with +, _ with /, add padding
    let b64 = encodedUrl.replace(/-/g, '+').replace(/_/g, '/');
    const padNeeded = 4 - (b64.length % 4);
    if (padNeeded !== 4) b64 += '='.repeat(padNeeded);

    const raw = Buffer.from(b64, 'base64');
    if (raw.length < 28) return null; // ciphertext too short

    // Split: IV (12 bytes) | ciphertext+tag (rest)
    const iv = raw.subarray(0, 12);
    const ciphertextWithTag = raw.subarray(12);
    const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16);
    const authTag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);

    // Convert hex key to 32-byte raw key
    const key = Buffer.from(VIDROCK_AES_KEY_HEX, 'hex');

    // AES-256-GCM decrypt — Node.js requires authTag to be set before final()
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf-8');
  } catch (e) {
    console.log(`[Vidrock] Decrypt error: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

interface VidrockServer {
  url: string | null;
  type: string | null;
  language: string | null;
  flag: string | null;
}

async function fetchVidrockSources(tmdbId: number, type: string, season?: string, episode?: string): Promise<ResolvedSource[]> {
  const allSources: ResolvedSource[] = [];

  try {
    // Build API URL
    const path = type === 'tv'
      ? `tv/${tmdbId}/${season || '1'}/${episode || '1'}`
      : `movie/${tmdbId}`;
    const apiUrl = `${VIDROCK_API}/${path}`;

    console.log(`[Vidrock] Fetching API: ${apiUrl}`);
    // Vidrock's API (behind Cloudflare) occasionally stalls past a short timeout,
    // which used to drop ALL English sources. Retry once with a longer budget.
    let res: Response | null = null;
    for (let attempt = 0; attempt < 2 && !res; attempt++) {
      try {
        res = await fetch(apiUrl, {
          headers: {
            'User-Agent': UA,
            'Accept': 'application/json, text/plain, */*',
            'Referer': 'https://vidrock.ru/',
            'Origin': 'https://vidrock.ru',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(attempt === 0 ? 2500 : 4000),
        });
      } catch (e) {
        console.log(`[Vidrock] API attempt ${attempt + 1} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (!res || !res.ok) {
      console.log(`[Vidrock] API unavailable${res ? ` (status ${res.status})` : ''}`);
      return allSources;
    }

    const data: Record<string, VidrockServer> = await res.json();
    console.log(`[Vidrock] API returned servers: ${Object.keys(data).join(', ')}`);

    // Process each server (Nova, Atlas, Orion, Astra, Luna, Vega)
    for (const [serverName, serverData] of Object.entries(data)) {
      if (!serverData || !serverData.url || !serverData.type) continue;

      const decryptedUrl = decryptVidrockUrl(serverData.url);
      if (!decryptedUrl) {
        console.log(`[Vidrock] Failed to decrypt ${serverName}`);
        continue;
      }

      // Map vidrock server names to friendly display names
      const displayName = serverName === 'Orion' ? 'Vidrock Orion' :
                          serverName === 'Nova' ? 'Vidrock Nova' :
                          serverName === 'Atlas' ? 'Vidrock Atlas' :
                          serverName === 'Astra' ? 'Vidrock Astra' :
                          serverName === 'Luna' ? 'Vidrock Luna' :
                          serverName === 'Vega' ? 'Vidrock Vega' :
                          `Vidrock ${serverName}`;

      const lang = serverData.language || 'English';
      const streamType = serverData.type === 'mp4' ? 'mp4' : 'hls';

      // Deduplicate
      if (!allSources.some(s => s.url === decryptedUrl)) {
        allSources.push({
          name: displayName,
          url: decryptedUrl,
          type: streamType,
          quality: streamType === 'hls' ? '1080p' : undefined,
          language: lang,
        });
        console.log(`[Vidrock] ✅ ${displayName}: ${decryptedUrl.substring(0, 80)}... (${lang}, ${streamType})`);
      }
    }

    console.log(`[Vidrock] Total sources: ${allSources.length}`);
  } catch (e) {
    console.log(`[Vidrock] Error: ${e instanceof Error ? e.message : String(e)}`);
  }

  return allSources;
}

/* ═══════════════════════════════════════════════════════════════════
   VIMEUS — Spanish/Latino sources
   ═══════════════════════════════════════════════════════════════════ */

const VIMEUS_VIEW_KEY = '-lSqv306Lsq7S9v2cVW8ifCRR67VxaPXYvIxJXjdAok';
const VIMEUS_DOMAIN = 'https://vimeus.com';

function buildVimeusEmbedUrl(contentType: string, tmdbId: number, season?: number, episode?: number): string {
  // contentType is already 'serie' or 'movie' — no double conversion
  const base = `${VIMEUS_DOMAIN}/e/${contentType}`;
  const url = new URL(base);
  url.searchParams.set('tmdb', String(tmdbId));
  url.searchParams.set('view_key', VIMEUS_VIEW_KEY);
  if (season) url.searchParams.set('se', String(season));
  if (episode) url.searchParams.set('ep', String(episode));
  return url.toString();
}

interface VimeusEmbed {
  format: string | null;
  lang: string | null;
  quality: string | null;
  resolution: string | null;
  sala_id: number;
  server: string | null;
  size: string | null;
  subtitle: number;
  url: string;
}

const BROWSER_ONLY_PROVIDERS = ['voe', 'filemoon', 'vimeos', 'diasfem', 'sblanh', 'watchsb', 'sbfull', 'sbfast', 'suzihaza', 'fembed', 'streamwish', 'doodstream', 'mixdrop', 'streamtape'];
const DEAD_PROVIDERS = ['hlswish'];

function isTestVideoUrl(url: string): boolean {
  return url.includes('test-videos.co.uk') ||
         url.includes('big_buck_bunny') ||
         url.includes('Big_Buck_Bunny') ||
         url.includes('trailer_test');
}

function isDeadProvider(url: string): boolean {
  return DEAD_PROVIDERS.some(p => url.toLowerCase().includes(p));
}

function isBrowserOnlyProvider(url: string): boolean {
  return BROWSER_ONLY_PROVIDERS.some(p => url.toLowerCase().includes(p));
}

async function extractStreamFromEmbed(embedUrl: string): Promise<{ streamUrl: string | null; streamType: 'hls' | 'mp4' | null }> {
  try {
    const response = await fetch(embedUrl, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Referer': VIMEUS_DOMAIN,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(2000),
    });

    if (!response.ok) return { streamUrl: null, streamType: null };
    const html = await response.text();

    if (html.includes('no longer available') || html.includes('expired') || html.includes('deleted') ||
        html.includes('File is no longer') || html.includes('not available')) {
      return { streamUrl: null, streamType: null };
    }

    // For goodstream: special handling - look for JSON data in script tags
    if (embedUrl.includes('goodstream')) {
      // goodstream often has the m3u8 URL in a JSON structure inside script tags
      const jsonScriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
      if (jsonScriptMatch) {
        for (const script of jsonScriptMatch) {
          // Try to find JSON objects containing m3u8
          const jsonObjMatch = script.match(/\{[\s\S]*"file"\s*:\s*"[^"]*\.m3u8[^"]*"[\s\S]*\}/i);
          if (jsonObjMatch) {
            try {
              const data = JSON.parse(jsonObjMatch[0]);
              if (data.file && data.file.includes('.m3u8')) {
                return { streamUrl: data.file, streamType: 'hls' };
              }
            } catch { /* not valid JSON */ }
          }

          // Try sources array format
          const sourcesArrMatch = script.match(/sources\s*:\s*\[[\s\S]*?\]/i);
          if (sourcesArrMatch) {
            try {
              const arrStr = sourcesArrMatch[0].replace(/sources\s*:\s*/, '');
              const sources = JSON.parse(arrStr);
              for (const src of sources) {
                if (src.file && src.file.includes('.m3u8')) {
                  return { streamUrl: src.file, streamType: 'hls' };
                }
                if (src.src && src.src.includes('.m3u8')) {
                  return { streamUrl: src.src, streamType: 'hls' };
                }
              }
            } catch { /* not valid JSON */ }
          }
        }
      }
    }

    // Generic m3u8 extraction
    const m3u8Match = html.match(/["'](https?:\/\/[^"']*\.m3u8[^"']*)["']/i);
    if (m3u8Match) {
      const url = m3u8Match[1];
      if (!isTestVideoUrl(url)) return { streamUrl: url, streamType: 'hls' };
    }

    const mp4Match = html.match(/["'](https?:\/\/[^"']*\.mp4[^"']*)["']/i);
    if (mp4Match) {
      const url = mp4Match[1];
      if (!isTestVideoUrl(url)) return { streamUrl: url, streamType: 'mp4' };
    }

    const sourcePatterns = [
      /sources\s*:\s*\[[\s\S]*?src\s*:\s*["']([^"']+)["']/i,
      /sources\s*:\s*\[[\s\S]*?file\s*:\s*["']([^"']+)["']/i,
      /file\s*:\s*["']([^"']+)["']/i,
      /source\s*:\s*["']([^"']+)["']/i,
      /video_url\s*[:=]\s*["']([^"']+)["']/i,
      /stream_url\s*[:=]\s*["']([^"']+)["']/i,
    ];

    for (const pattern of sourcePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        const url = match[1];
        if (url.includes('.m3u8')) return { streamUrl: url, streamType: 'hls' };
        if (url.includes('.mp4')) return { streamUrl: url, streamType: 'mp4' };
        if (url.startsWith('http') && (url.includes('stream') || url.includes('video') || url.includes('media'))) {
          return { streamUrl: url, streamType: 'hls' };
        }
      }
    }

    // Try base64 encoded URLs
    const atobPatterns = [/atob\s*\(\s*["']([A-Za-z0-9+/=]+)["']\s*\)/gi];
    for (const pattern of atobPatterns) {
      let b64Match;
      while ((b64Match = pattern.exec(html)) !== null) {
        try {
          const decoded = Buffer.from(b64Match[1], 'base64').toString('utf-8');
          const m3u8 = decoded.match(/https?:\/\/[^\s"']*\.m3u8[^\s"']*/i);
          if (m3u8 && !isTestVideoUrl(m3u8[0])) return { streamUrl: m3u8[0], streamType: 'hls' };
          const mp4 = decoded.match(/https?:\/\/[^\s"']*\.mp4[^\s"']*/i);
          if (mp4 && !isTestVideoUrl(mp4[0])) return { streamUrl: mp4[0], streamType: 'mp4' };
        } catch { /* ignore */ }
      }
    }

    return { streamUrl: null, streamType: null };
  } catch {
    return { streamUrl: null, streamType: null };
  }
}

function getServerDisplayName(embed: VimeusEmbed, index: number): string {
  if (embed.server && embed.server !== 'Online' && embed.server.length > 1) {
    const serverName = embed.server.charAt(0).toUpperCase() + embed.server.slice(1);
    const langLabel = embed.lang ? ` (${embed.lang})` : '';
    return `${serverName}${langLabel}`;
  }

  const url = embed.url.toLowerCase();
  if (url.includes('goodstream')) return `Orion${embed.lang ? ` (${embed.lang})` : ''}`;
  if (url.includes('voe')) return `Atlas${embed.lang ? ` (${embed.lang})` : ''}`;
  if (url.includes('filemoon')) return `Titan${embed.lang ? ` (${embed.lang})` : ''}`;
  if (url.includes('vimeos')) return `Vega${embed.lang ? ` (${embed.lang})` : ''}`;
  if (url.includes('streamtape')) return `Sirius${embed.lang ? ` (${embed.lang})` : ''}`;
  if (url.includes('dood')) return `Rigel${embed.lang ? ` (${embed.lang})` : ''}`;
  if (url.includes('mixdrop')) return `Polaris${embed.lang ? ` (${embed.lang})` : ''}`;
  if (url.includes('diasfem')) return `Diasfem${embed.lang ? ` (${embed.lang})` : ''}`;
  if (url.includes('fembed')) return `Fembed${embed.lang ? ` (${embed.lang})` : ''}`;

  return `Servidor ${index + 1}${embed.lang ? ` (${embed.lang})` : ''}`;
}

async function fetchVimeusSources(tmdbId: number, type: string, season?: string, episode?: string): Promise<ResolvedSource[]> {
  const contentType = type === 'tv' ? 'serie' : 'movie';
  const embedUrl = buildVimeusEmbedUrl(
    contentType,
    tmdbId,
    season ? parseInt(season, 10) : undefined,
    episode ? parseInt(episode, 10) : undefined,
  );

  try {
    const response = await fetch(embedUrl, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Referer': VIMEUS_DOMAIN,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) {
      console.log(`[Vimeus] Embed page returned ${response.status} for ${embedUrl}`);
      // Try to read the body anyway - sometimes 403 pages still contain data
      const errorBody = await response.text();
      console.log(`[Vimeus] Error body length: ${errorBody.length}`);
      // Check if the body actually contains the data we need (some sites return 403 but still include data)
      const dataMatchInError = new RegExp('<script[^>]*id="data"[^>]*>([\\s\\S]*?)</script>', 'i').exec(errorBody);
      if (dataMatchInError) {
        try {
          const vimeusData = JSON.parse(dataMatchInError[1]);
          if (vimeusData?.embeds?.length > 0) {
            console.log(`[Vimeus] Found data in error response (${response.status})`);
            // Continue processing below...
            const embeds: VimeusEmbed[] = vimeusData.embeds || [];
            const allEmbeds = embeds;
            const sortedEmbeds = [...allEmbeds]
              .filter(e => !isDeadProvider(e.url) && !isBrowserOnlyProvider(e.url))
              .sort((a, b) => {
                const getPriority = (url: string): number => {
                  if (url.includes('goodstream')) return 0;
                  return 5;
                };
                return getPriority(a.url) - getPriority(b.url);
              });
            const allSources: ResolvedSource[] = [];
            for (let idx = 0; idx < sortedEmbeds.length; idx++) {
              const embed = sortedEmbeds[idx];
              const displayName = getServerDisplayName(embed, idx);
              const lang = embed.lang || 'Latino';
              const extracted = await extractStreamFromEmbed(embed.url);
              if (extracted.streamUrl && extracted.streamType) {
                if (isTestVideoUrl(extracted.streamUrl)) continue;
                allSources.push({ name: displayName, url: extracted.streamUrl, type: extracted.streamType, quality: embed.quality || undefined, language: lang });
              }
            }
            return allSources;
          }
        } catch { /* data parse failed */ }
      }
      return [];
    }

    const html = await response.text();
    const dataScriptRegex = new RegExp('<script[^>]*id="data"[^>]*>([\\s\\S]*?)</script>', 'i');
    const dataMatch = dataScriptRegex.exec(html);
    if (!dataMatch) {
      console.log(`[Vimeus] No JSON data found in page`);
      return [];
    }

    let vimeusData;
    try { vimeusData = JSON.parse(dataMatch[1]); } catch { return []; }

    const embeds: VimeusEmbed[] = vimeusData.embeds || [];
    if (embeds.length === 0) return [];

    console.log(`[Vimeus] Found ${embeds.length} embeds`);

    // Take Spanish/Latino embeds
    const spanishEmbeds = embeds.filter(e => {
      const lang = (e.lang || '').toLowerCase();
      return /latino|español|es\b|spanish|castellano|sub/i.test(lang) || !lang;
    });

    const allEmbeds = spanishEmbeds.length > 0 ? spanishEmbeds : embeds;

    // Filter and sort: goodstream first, skip dead & browser-only providers
    const sortedEmbeds = [...allEmbeds]
      .filter(e => !isDeadProvider(e.url) && !isBrowserOnlyProvider(e.url))
      .sort((a, b) => {
        const getPriority = (url: string): number => {
          if (url.includes('goodstream')) return 0;
          if (url.includes('streamtape')) return 1;
          if (url.includes('mixdrop')) return 2;
          if (url.includes('dood')) return 3;
          return 5;
        };
        return getPriority(a.url) - getPriority(b.url);
      });

    // Also try browser-only providers but only if no server-side ones work
    const browserOnlyEmbeds = allEmbeds.filter(e => !isDeadProvider(e.url) && isBrowserOnlyProvider(e.url));

    const allSources: ResolvedSource[] = [];

    // Try server-side extractable embeds first (goodstream, streamtape, mixdrop, dood).
    // Run all extractions in PARALLEL — sequential extraction was the dominant cost
    // of a cold /api/source request (up to 6 embeds × ~1.5s = ~9s). Promise.all keeps
    // the results in input order so display names/indices stay stable.
    const MAX_EMBEDS = 3;
    const embedsToTry = sortedEmbeds.slice(0, MAX_EMBEDS);

    const extractedResults = await Promise.all(
      embedsToTry.map(async (embed, idx) => ({
        embed,
        idx,
        extracted: await extractStreamFromEmbed(embed.url),
      }))
    );

    for (const { embed, idx, extracted } of extractedResults) {
      const displayName = getServerDisplayName(embed, idx);
      const lang = embed.lang || 'Latino';

      if (extracted.streamUrl && extracted.streamType) {
        if (isTestVideoUrl(extracted.streamUrl)) continue;

        console.log(`[Vimeus] ✅ Extracted ${extracted.streamType} from ${displayName}: ${extracted.streamUrl.substring(0, 80)}...`);
        allSources.push({
          name: displayName,
          url: extracted.streamUrl,
          type: extracted.streamType,
          quality: embed.quality || undefined,
          language: lang,
        });
      } else {
        console.log(`[Vimeus] ❌ Could not extract from ${displayName} (${embed.url.substring(0, 60)})`);
      }
    }

    // If no server-side sources found, try browser-only embeds (they might have simpler formats)
    if (allSources.length === 0 && browserOnlyEmbeds.length > 0) {
      for (const embed of browserOnlyEmbeds.slice(0, 2)) {
        const displayName = getServerDisplayName(embed, 0);
        const lang = embed.lang || 'Latino';

        const extracted = await extractStreamFromEmbed(embed.url);
        if (extracted.streamUrl && extracted.streamType) {
          if (isTestVideoUrl(extracted.streamUrl)) continue;
          console.log(`[Vimeus] ✅ Extracted ${extracted.streamType} from browser-only ${displayName}: ${extracted.streamUrl.substring(0, 80)}...`);
          allSources.push({
            name: displayName,
            url: extracted.streamUrl,
            type: extracted.streamType,
            quality: embed.quality || undefined,
            language: lang,
          });
        }
      }
    }

    return allSources;
  } catch (error) {
    console.error('[Vimeus] Error:', error instanceof Error ? error.message : String(error));
    return [];
  }
}

/* ═══════════════════════════════════════════════════════════════════
   CDN HEALTH CLASSIFICATION
   Vidrock serves from several CDNs; some currently return HTTP 403
   (confirmed via dev.log). We rank them so the player tries the
   working ones first and only falls back to the dead CDNs last.
   ═══════════════════════════════════════════════════════════════════ */

// Vidrock CDN domains that currently return HTTP 403 for the master
// playlist / segments (confirmed in production logs). We keep these
// sources as last-resort fallbacks rather than dropping them entirely.
const DEAD_VIDROCK_DOMAINS = ['1shows.app'];

// Vidrock CDN domains confirmed working at 1080p in production.
const HEALTHY_VIDROCK_DOMAINS = [
  'jenks426set.com',
  'lizer123.site',
  '47qzoobg8k.workers.dev',
  'vidvault',
];

function isDeadCdn(url: string): boolean {
  const lower = url.toLowerCase();
  return DEAD_VIDROCK_DOMAINS.some(d => lower.includes(d));
}

// Vidrock serves via Cloudflare Workers and rotates the worker subdomain
// (47qzoobg8k, bison-6d7, …). Treat any *.workers.dev host as a healthy Vidrock CDN.
function isVidrockWorker(url: string): boolean {
  return url.toLowerCase().includes('workers.dev');
}

/**
 * Rank a source URL for sort ordering. Lower = tried first.
 *   0 = healthy Vidrock CDN (1080p English, working)
 *   1 = goodstream (reliable Latino)
 *   2 = other working sources
 *   9 = dead CDN (1shows.app) — last resort
 */
function getSourceRank(url: string): number {
  if (isDeadCdn(url)) return 9;
  if (isVidrockWorker(url) || HEALTHY_VIDROCK_DOMAINS.some(d => url.toLowerCase().includes(d))) return 0;
  if (url.includes('goodstream')) return 1;
  return 2;
}

/**
 * Merge Vimeus (Spanish/Latino) + Vidrock (English) into a single ranked
 * list. Order: healthy CDNs first (working 1080p English), then goodstream,
 * then everything else; dead CDNs (1shows.app) pinned to the end. Within the
 * same tier, English beats Spanish.
 */
function combineAndSort(vimeusSources: ResolvedSource[], vidrockSources: ResolvedSource[]): ResolvedSource[] {
  const allSources: ResolvedSource[] = [];

  // Vimeus (Spanish/Latino) first
  for (const src of vimeusSources) {
    allSources.push({
      ...src,
      language: src.language || 'Latino',
    });
  }

  // Vidrock (English m3u8) — deduplicated
  for (const src of vidrockSources) {
    const isDuplicate = allSources.some(existing => existing.url === src.url);
    if (!isDuplicate) {
      allSources.push({
        ...src,
        language: src.language || 'English',
      });
    }
  }

  allSources.sort((a, b) => {
    // Primary: CDN health rank (0 healthy Vidrock → 9 dead 1shows.app)
    const rankDiff = getSourceRank(a.url) - getSourceRank(b.url);
    if (rankDiff !== 0) return rankDiff;

    // Within the same tier, prefer English (1080p English > Latino 720p)
    const aLang = (a.language || '').toLowerCase();
    const bLang = (b.language || '').toLowerCase();
    const aEng = /ingl|engl|\ben\b|english/.test(aLang);
    const bEng = /ingl|engl|\ben\b|english/.test(bLang);
    if (aEng && !bEng) return -1;
    if (!aEng && bEng) return 1;

    const aSpa = /latino|español|\bes\b|spanish|castellano|sub/.test(aLang);
    const bSpa = /latino|español|\bes\b|spanish|castellano|sub/.test(bLang);
    if (aSpa && !bSpa) return -1;
    if (!aSpa && bSpa) return 1;

    return 0;
  });

  return allSources;
}

function pruneSourceCache() {
  if (sourceCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of sourceCache.entries()) {
      if (now - v.timestamp > SOURCE_CACHE_TTL) sourceCache.delete(k);
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN HANDLER — Combines VIDROCK + VIMEUS
   ═══════════════════════════════════════════════════════════════════ */

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tmdbId = searchParams.get('id');
  const type = searchParams.get('type');
  const season = searchParams.get('s');
  const episode = searchParams.get('e');

  // Warm-up ping: the client fires this on page load so the serverless
  // instance boots BEFORE the user presses Play. Returns immediately.
  if (searchParams.get('warm')) {
    return NextResponse.json(
      { ok: true },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (!tmdbId || !type) {
    return NextResponse.json({ error: 'id and type required' }, { status: 400 });
  }

  // In-memory cache: source resolution is expensive (4-5s of live scraping).
  // Cache for 10 minutes so repeated plays / language switches are instant.
  const cacheKey = `${tmdbId}-${type}-${season || ''}-${episode || ''}`;
  const cached = sourceCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < SOURCE_CACHE_TTL) {
    console.log(`[Source] Cache HIT for ${cacheKey} (${cached.sources.length} sources)`);
    return NextResponse.json({ sources: cached.sources });
  }

  // WAIT-FOR-BOTH RULE — fire Vidrock + Vimeus in parallel and wait for BOTH
  // to finish (up to a 5s ceiling). On serverless (Vercel) there's no
  // persistent memory between requests, so we can't rely on a background
  // cache upgrade to deliver Spanish sources on a later call. In practice
  // both providers finish quickly (Vidrock ~0.7s, Vimeus ~1.2s), so the
  // total wait is still fast.
  const HARD_CEILING = 3000;
  const empty: ResolvedSource[] = [];

  const vidrockP = fetchVidrockSources(parseInt(tmdbId, 10), type, season || undefined, episode || undefined)
    .catch(() => empty);
  const vimeusP = fetchVimeusSources(parseInt(tmdbId, 10), type, season || undefined, episode || undefined)
    .catch(() => empty);

  // Wait for both with a hard ceiling so a stalled provider can't hang the
  // request indefinitely.
  const timeoutP = new Promise<ResolvedSource[]>((resolve) =>
    setTimeout(() => resolve(empty), HARD_CEILING),
  );
  const [vidrockSources, vimeusSources] = await Promise.all([
    Promise.race([vidrockP, timeoutP]),
    Promise.race([vimeusP, timeoutP.then(() => empty)]),
  ]);

  console.log(`[Source] Vimeus: ${vimeusSources.length}, Vidrock: ${vidrockSources.length}`);

  const allSources = combineAndSort(vimeusSources, vidrockSources);

  if (allSources.some(s => isDeadCdn(s.url))) {
    console.log(`[Source] Sorted ${allSources.length} sources — dead CDN (1shows.app) pushed to the end`);
  }

  // Store in cache for subsequent requests (language switch, replay, etc.)
  // On serverless (Vercel) this only helps within the same warm instance.
  if (allSources.length > 0) {
    sourceCache.set(cacheKey, { sources: allSources, timestamp: Date.now() });
  }
  pruneSourceCache();

  // EDGE CACHE: a successful resolution is cached by the Vercel CDN for
  // 10 min — the player's 700ms retry, replays, and OTHER USERS watching
  // the same title get it in ~50ms instead of another 3s cold resolution.
  // Empty responses are NEVER cached (no-store) so a cold-start failure
  // doesn't stick.
  const headers = allSources.length > 0
    ? { 'Cache-Control': 'public, s-maxage=600' }
    : { 'Cache-Control': 'no-store' };

  return NextResponse.json({ sources: allSources }, { headers });
}
