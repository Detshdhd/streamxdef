import { NextRequest, NextResponse } from 'next/server';

// Pin to same region as /api/source so both share the same outgoing IP/ASN.
// goodstream CDN tokens are ASN-bound — if source extraction and proxy fetch
// happen from different IPs, segments return 403/404.
export const preferredRegion = 'iad1';

/**
 * /api/proxy
 * 
 * Proxy video streams through our server.
 * Handles Vimeus embed sources, Vidrock CDN (Cloudflare Workers), and fallback CDN domains.
 * Adds required headers and rewrites m3u8 playlists to go through our proxy.
 * Includes retry logic for rate-limited CDN responses (429).
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/**
 * Block SSRF targets: loopback, private, link-local (incl. cloud metadata
 * 169.254.169.254), CGNAT, and non-http(s) schemes — checked by IP literal,
 * not naive substring (the old code matched e.g. 'notlocalhost.com').
 * NOTE: this is a name/literal check; a hardened deploy should also pin an
 * egress allowlist, but this closes the trivial metadata-reading hole.
 */
function isBlocked(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return true;
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets

    if (host === 'localhost' || host.endsWith('.localhost') ||
        host === 'metadata.google.internal' || host === 'metadata' ||
        host === '169.254.169.254') {
      return true;
    }

    // IPv4 literal
    const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m) {
      const [a, b] = m.slice(1).map(Number);
      if (a === 0 || a === 10 || a === 127) return true;             // 0.0.0.0/8, 10/8, loopback
      if (a === 169 && b === 254) return true;                       // link-local + cloud metadata
      if (a === 172 && b >= 16 && b <= 31) return true;              // 172.16.0.0/12
      if (a === 192 && b === 168) return true;                       // 192.168.0.0/16
      if (a === 100 && b >= 64 && b <= 127) return true;            // 100.64.0.0/10 (CGNAT)
    }

    // IPv6 loopback / link-local / unique-local / IPv4-mapped
    if (host === '::1' || host === '::') return true;
    if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
    if (host.startsWith('::ffff:') || host.startsWith('64:ff9b:')) {
      const v4 = host.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
      if (v4) return isBlocked(`http://${v4[0]}/`); // re-check embedded IPv4
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

/**
 * Determine which headers to use based on the URL domain
 */
function getHeadersForUrl(url: string): Record<string, string> {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    // hakunaymatata CDN — legacy CDN domain (kept for backward compat)
    if (hostname.includes('hakunaymatata')) {
      return {
        'User-Agent': UA,
        'Referer': 'https://hakunaymatata.com/',
        'Origin': 'https://hakunaymatata.com',
        'Accept': '*/*',
        'Accept-Encoding': 'identity',
      };
    }

    // goodstream.one — the most reliable streaming provider
    // Must include the correct referer and Accept-Encoding to pass CDN authentication
    if (hostname.includes('goodstream')) {
      return {
        'User-Agent': UA,
        'Referer': 'https://goodstream.one/',
        'Origin': 'https://goodstream.one',
        'Accept': '*/*',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Accept-Encoding': 'identity',
      };
    }

    // hlswish.com
    if (hostname.includes('hlswish')) {
      return {
        'User-Agent': UA,
        'Referer': 'https://hlswish.com/',
        'Origin': 'https://hlswish.com',
        'Accept': '*/*',
      };
    }

    // voe.sx
    if (hostname.includes('voe')) {
      return {
        'User-Agent': UA,
        'Referer': 'https://voe.sx/',
        'Origin': 'https://voe.sx',
        'Accept': '*/*',
      };
    }

    // filemoon.sx
    if (hostname.includes('filemoon')) {
      return {
        'User-Agent': UA,
        'Referer': 'https://filemoon.sx/',
        'Origin': 'https://filemoon.sx',
        'Accept': '*/*',
      };
    }

    // vimeos.net
    if (hostname.includes('vimeos')) {
      return {
        'User-Agent': UA,
        'Referer': 'https://vimeos.net/',
        'Origin': 'https://vimeos.net',
        'Accept': '*/*',
      };
    }

    // streamtape
    if (hostname.includes('streamtape')) {
      return {
        'User-Agent': UA,
        'Referer': 'https://streamtape.com/',
        'Origin': 'https://streamtape.com',
        'Accept': '*/*',
      };
    }

    // doodstream
    if (hostname.includes('dood')) {
      return {
        'User-Agent': UA,
        'Referer': 'https://doodstream.com/',
        'Origin': 'https://doodstream.com',
        'Accept': '*/*',
      };
    }

    // mixdrop
    if (hostname.includes('mixdrop')) {
      return {
        'User-Agent': UA,
        'Referer': 'https://mixdrop.ag/',
        'Origin': 'https://mixdrop.ag',
        'Accept': '*/*',
      };
    }

    // Vimeus domain
    if (hostname.includes('vimeus')) {
      return {
        'User-Agent': UA,
        'Referer': 'https://vimeus.com/',
        'Origin': 'https://vimeus.com',
        'Accept': '*/*',
      };
    }

    // Vidrock CDN — Cloudflare Workers. Vidrock rotates the worker subdomain
    // (47qzoobg8k, bison-6d7, …), so match ANY *.workers.dev host and send the
    // vidrock.ru origin it requires. Confirmed: vidrock.ru origin → 200, generic → 404.
    if (hostname.endsWith('workers.dev')) {
      return {
        'User-Agent': UA,
        'Referer': 'https://vidrock.ru/',
        'Origin': 'https://vidrock.ru',
        'Accept': '*/*',
      };
    }

    // Vidrock API — vidrock.ru/api endpoint
    if (hostname.includes('vidrock')) {
      return {
        'User-Agent': UA,
        'Referer': 'https://vidrock.ru/',
        'Origin': 'https://vidrock.ru',
        'Accept': 'application/json, */*',
      };
    }

    // Vidvault CDN — vidvault.ru video hosting
    if (hostname.includes('vidvault')) {
      return {
        'User-Agent': UA,
        'Referer': 'https://vidrock.ru/',
        'Origin': 'https://vidrock.ru',
        'Accept': '*/*',
      };
    }

    // 1shows.app — legacy CDN domain
    if (hostname.includes('1shows.app')) {
      return {
        'User-Agent': UA,
        'Referer': 'https://cdn.1shows.app/',
        'Origin': 'https://cdn.1shows.app',
        'Accept': '*/*',
      };
    }

    // TikTok CDN
    if (hostname.includes('tiktokcdn')) {
      return {
        'User-Agent': UA,
        'Referer': 'https://cdn.1shows.app/',
        'Accept': '*/*',
        'Accept-Encoding': 'identity',
      };
    }

    // lookcrew / ironwallnet segment CDN — legacy VIDEASY video segments (kept for backward compat)
    if (hostname.includes('lookcrew') || hostname.includes('crew') || hostname.includes('ironwallnet')) {
      return {
        'User-Agent': UA,
        'Referer': new URL(url).origin + '/',
        'Origin': new URL(url).origin,
        'Accept': '*/*',
      };
    }

    // Generic CDN headers - try with the URL's own origin as referer
    return {
      'User-Agent': UA,
      'Referer': `${parsed.protocol}//${parsed.hostname}/`,
      'Origin': `${parsed.protocol}//${parsed.hostname}`,
      'Accept': '*/*',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    };
  } catch {
    return {
      'User-Agent': UA,
      'Accept': '*/*',
    };
  }
}

/**
 * Fetch the upstream with a two-tier timeout:
 *   - headers must arrive within HEADER_TIMEOUT (a stalled CDN should not
 *     hold the player forever)
 *   - once headers arrive, the body is allowed to stream without our own
 *     abort: hls.js aborts the client request on ITS timeout, which cancels
 *     the upstream connection and lets the next fragment request proceed.
 * Using a manual AbortController (not AbortSignal.timeout) prevents the old
 * bug where a slow-but-working 1080p segment was killed mid-pipe (the
 * `500 in 15.1s` / `failed to pipe response` / `TMEOUT_ERR` seen in dev.log),
 * which forced the player down to 720p/480p.
 */
const HEADER_TIMEOUT = 10000;

async function fetchUpstream(url: string, headers: Record<string, string>): Promise<Response> {
  const controller = new AbortController();

  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => controller.abort(), HEADER_TIMEOUT);

    fetch(url, {
      headers,
      redirect: 'follow',
      signal: controller.signal,
    })
      .then((response) => {
        // Headers arrived — stop the waiting timer. The body streams freely.
        clearTimeout(timer);
        resolve(response);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url || isBlocked(url)) {
    return NextResponse.json({ error: 'invalid or blocked url' }, { status: 400 });
  }

  const headers = getHeadersForUrl(url);

  try {
    // Direct fetch — no retry wrapper for speed (segments are short-lived;
    // hls.js retries naturally on failure).
    const response = await fetchUpstream(url, headers);

    if (!response.ok) {
      return NextResponse.json(
        { error: `upstream error: ${response.status}` },
        { status: response.status }
      );
    }

    const contentType = response.headers.get('content-type') || '';
    const contentLength = response.headers.get('content-length');
    const isM3u8 = contentType.includes('mpegurl') || url.endsWith('.m3u8') || url.includes('.m3u8');

    // For m3u8 playlists: rewrite segment URLs to go through our proxy.
    // The proxy adds required Referer/Origin headers that browsers can't set.
    if (isM3u8) {
      const text = await response.text();
      const parsedUrl = new URL(url);
      const origin = parsedUrl.origin;
      const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
      const proxyBase = '/api/proxy?url=';

      const rewritten = text
        // 1) Rewrite URI="..." inside #EXT tags (key maps, etc.)
        .replace(/URI="([^"]+)"/g, (_m, uri: string) => {
          const full = uri.startsWith('http') ? uri
            : uri.startsWith('/') ? origin + uri
            : baseUrl + uri;
          return `URI="${proxyBase}${encodeURIComponent(full)}"`;
        })
        // 2) Rewrite non-comment lines (segment URLs) — absolute
        .replace(/^(https?:\/\/\S+)$/gm, (m) => `${proxyBase}${encodeURIComponent(m)}`)
        // 3) Relative starting with /
        .replace(/^(\/\S+)$/gm, (m) => `${proxyBase}${encodeURIComponent(origin + m)}`)
        // 4) Relative without / (prepend baseUrl)
        .replace(/^([^#\s\/][^\s]*)$/gm, (m) => `${proxyBase}${encodeURIComponent(baseUrl + m)}`);

      return new NextResponse(rewritten, {
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-cache, no-store',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // For video segments and mp4: stream through
    const isSegment = url.endsWith('.ts') || url.endsWith('.m4s') || url.endsWith('.html')
      || url.includes('/page-') || url.includes('/seg.') || url.includes('enproxy');
    const respHeaders: Record<string, string> = {
      'Content-Type': isSegment ? 'video/mp2t' : (contentType || 'video/mp4'),
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Length',
    };
    if (contentLength) respHeaders['Content-Length'] = contentLength;

    return new NextResponse(response.body, { headers: respHeaders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'proxy error';
    console.error('[Proxy Error]', msg, url);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

// Handle OPTIONS for CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
