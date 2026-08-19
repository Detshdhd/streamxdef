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
  // 'hls' | 'mp4' → direct stream URL played by our hls.js player.
  // 'embed' → third-party player page (vimeos.net) rendered in an iframe;
  //           its signed tokens only validate when the page itself loads in
  //           the user's browser, so we embed rather than extract.
  type: 'hls' | 'mp4' | 'embed';
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

// 'vimeos' REMOVED from browser-only: it is now Vimeus' primary (and often
// only) Latino provider, and its stream IS server-side extractable — the
// signed master.m3u8 sits inside a P.A.C.K.E.R.-packed jwplayer setup
// (see extractVimeosDirect below).
const BROWSER_ONLY_PROVIDERS = ['voe', 'filemoon', 'diasfem', 'sblanh', 'watchsb', 'sbfull', 'sbfast', 'suzihaza', 'fembed', 'streamwish', 'doodstream', 'mixdrop', 'streamtape'];
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

async function extractStreamFromEmbed(embedUrl: string, timeoutMs = 2000): Promise<{ streamUrl: string | null; streamType: 'hls' | 'mp4' | null }> {
  try {
    const response = await fetch(embedUrl, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Referer': VIMEUS_DOMAIN,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
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

/* ═══════════════════════════════════════════════════════════════════
   VIMEOS DIRECT EXTRACTION
   The vimeos.net embed page carries the signed master.m3u8 inside a
   P.A.C.K.E.R.-obfuscated jwplayer setup. The CDN token is minted per
   embed-page load, and the origin poisons a random share of the tokens
   it hands to non-browser clients (measured: ~70% of mints validate,
   ~30% answer 403 — independent of host, headers and file). So we
   re-mint in PARALLEL (4 attempts) and keep the first master that
   answers 200: >99% success in ~1.5s. Same playback model as Vidrock —
   our proxy fetches the segments, so the user's browser gets a clean
   hls.js stream with NO vimeos iframe and NO third-party ads.
   ═══════════════════════════════════════════════════════════════════ */

const VIMEOS_EMBED_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-419,es;q=0.9',
  'Referer': 'https://vimeus.com/',
  'Sec-Fetch-Dest': 'iframe',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'cross-site',
  'Upgrade-Insecure-Requests': '1',
  'sec-ch-ua': '"Chromium";v="151", "Not.A/Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
};

// Mirrors of the vimeos CDN that hang or RST instead of serving. The origin
// assigns tokens per (file, shard): files whose shard lives only on a dead
// mirror (e.g. shard s12) can never validate, so skip probing them and let
// the parallel pool spend its attempts on reachable mirrors.
const DEAD_VIMEOS_HOSTS = ['s12.vimeos.net'];

/**
 * Decode a P.A.C.K.E.R. payload WITHOUT the packer's self-running
 * decoder. Replicates its exact substitution — replace every base-N
 * encoded index token with its key, from the highest index down — so
 * the output is the original jwplayer setup JS containing the
 * `sources:[{file:"https://…/master.m3u8?t=…"}]` URL.
 */
function unpackVimeosPacker(html: string): string | null {
  const m = html.match(
    /while\(c--\)[\s\S]*?return p\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)\)/
  );
  if (!m) return null;

  let payload = m[1].replace(/\\'/g, "'");
  const base = parseInt(m[2], 10);
  let count = parseInt(m[3], 10);
  const keys = m[4].split('|');
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  while (count--) {
    if (keys[count]) {
      payload = payload.replace(
        new RegExp('\\b' + escapeRe(count.toString(base)) + '\\b', 'g'),
        keys[count]
      );
    }
  }
  return payload;
}

/**
 * One mint attempt: fetch the embed page, unpack the packer, extract
 * the master.m3u8 URL and probe it. Returns the URL only when the CDN
 * actually serves the playlist (poisoned tokens answer 403 here).
 */
async function mintVimeosMaster(embedUrl: string): Promise<string | null> {
  try {
    const page = await fetch(embedUrl, {
      headers: VIMEOS_EMBED_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(4000),
    });
    if (!page.ok) return null;

    const js = unpackVimeosPacker(await page.text());
    if (!js) return null;

    const fileMatch = js.match(/file:"(https:[^"]+\.m3u8[^"]*)"/);
    if (!fileMatch) return null;

    // Skip known-dead mirrors instantly — their connections hang until the
    // timeout, which would burn this attempt for nothing.
    const host = new URL(fileMatch[1]).hostname.toLowerCase();
    if (DEAD_VIMEOS_HOSTS.some(d => host === d || host.endsWith('.' + d))) return null;

    const probe = await fetch(fileMatch[1], {
      headers: { 'User-Agent': UA, 'Referer': 'https://vimeos.net/' },
      redirect: 'follow',
      signal: AbortSignal.timeout(2500),
    });
    // Drain the (tiny) body so the connection is released back to the pool.
    await probe.text().catch(() => {});
    return probe.ok ? fileMatch[1] : null;
  } catch {
    return null;
  }
}

/**
 * Extract a DIRECT m3u8 from a vimeos embed. Fire 6 mint attempts in
 * parallel and keep the first that validates — measured ~70% per-mint
 * success on healthy mirrors, so 6 attempts land ≥99% overall in ~1.5s.
 */
async function extractVimeosDirect(embedUrl: string): Promise<string | null> {
  const attempts = await Promise.all(
    Array.from({ length: 6 }, () => mintVimeosMaster(embedUrl))
  );
  return attempts.find((url): url is string => url !== null) ?? null;
}

function getServerDisplayName(embed: VimeusEmbed, index: number): string {
  const url = embed.url.toLowerCase();
  // vimeos is Vimeus' own player — usually dual-audio (Español/English)
  if (url.includes('vimeos.')) return `Vega${embed.lang ? ` (${embed.lang})` : ' (Latino)'}`;
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

    // VIMEOS.NET (Vimeus' own player) — extract the signed master.m3u8
    // DIRECTLY (extractVimeosDirect). The resulting source plays through
    // our proxy in the native hls.js player: no vimeos iframe, no
    // third-party ads. Only when every parallel mint fails do we fall
    // back to the iframe passthrough below (type 'embed', sorted last).
    const vimeosEmbeds = sortedEmbeds.filter(e => e.url.includes('vimeos.'));
    for (const embed of vimeosEmbeds) {
      const directUrl = await extractVimeosDirect(embed.url);
      if (directUrl) {
        console.log(`[Vimeus] ✅ vimeos DIRECT m3u8: ${directUrl.substring(0, 90)}...`);
        allSources.push({
          name: getServerDisplayName(embed, 0),
          url: directUrl,
          type: 'hls',
          quality: embed.quality || undefined,
          language: embed.lang || 'Latino',
        });
      } else {
        console.log(`[Vimeus] ⚠️ direct extraction failed — iframe fallback: ${embed.url}`);
        allSources.push({
          name: getServerDisplayName(embed, 0),
          url: embed.url,
          type: 'embed',
          quality: embed.quality || undefined,
          language: embed.lang || 'Latino',
        });
      }
    }
    const extractableEmbeds = sortedEmbeds.filter(e => !e.url.includes('vimeos.'));

    // Try server-side extractable embeds (goodstream, streamtape, mixdrop, dood).
    // Run all extractions in PARALLEL — sequential extraction was the dominant cost
    // of a cold /api/source request (up to 6 embeds × ~1.5s = ~9s). Promise.all keeps
    // the results in input order so display names/indices stay stable.
    const MAX_EMBEDS = 3;
    const embedsToTry = extractableEmbeds.slice(0, MAX_EMBEDS);

    const extractedResults = await Promise.all(
      embedsToTry.map(async (embed, idx) => ({
        embed,
        idx,
        extracted: await extractStreamFromEmbed(embed.url, 2000),
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
    // Third-party embed players (vimeos Latino, with their own ads) are
    // LAST-RESORT: only reachable when the user explicitly picks Spanish
    // from the language menu. Never the auto-loaded first source.
    const embedDiff = (a.type === 'embed' ? 1 : 0) - (b.type === 'embed' ? 1 : 0);
    if (embedDiff !== 0) return embedDiff;

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
  // cache upgrade to deliver Spanish sources on a later call. Typical totals
  // are fast (Vidrock ~0.7s, Vimeus data page ~0.4s — vimeos needs no
  // server-side fetch anymore); the ceiling only matters when a provider
  // stalls, where waiting beats returning nothing.
  const HARD_CEILING = 5000;
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
