import { NextRequest, NextResponse } from 'next/server';

/**
 * /api/subtitles
 *
 * Fetch Spanish subtitles from OpenSubtitles API for movies/series.
 * Returns VTT-format subtitles that can be loaded directly into the video player.
 *
 * Flow: Search subtitles → Download SRT → Convert to VTT → Return
 *
 * Requires env: OPENSUBTITLES_API_KEY
 */

const OS_API_KEY = process.env.OPENSUBTITLES_API_KEY!;
const OS_BASE = 'https://api.opensubtitles.com/api/v1';
const UA = 'StreamX/1.0';

/**
 * Search for subtitles on OpenSubtitles and return the best file_id
 */
async function findSubtitleFileId(
  tmdbId: number,
  type: string,
  season?: string,
  episode?: string
): Promise<number | null> {
  try {
    const params: Record<string, string> = {
      tmdb_id: String(tmdbId),
      languages: 'es',
    };

    if (type === 'tv' && season) {
      params.season_number = season;
      if (episode) params.episode_number = episode;
    }

    const url = new URL(`${OS_BASE}/subtitles`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    console.log(`[Subtitles] Searching: tmdb=${tmdbId} type=${type} s=${season} e=${episode}`);

    const res = await fetch(url.toString(), {
      headers: {
        'Api-Key': OS_API_KEY,
        'User-Agent': UA,
        'Accept': 'application/json',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.log(`[Subtitles] Search API returned ${res.status}`);
      return null;
    }

    const data = await res.json();
    const subs = data.data || [];

    if (subs.length === 0) {
      console.log(`[Subtitles] No Spanish subtitles found for tmdb=${tmdbId}`);
      return null;
    }

    // Pick the best subtitle: prefer non-AI-translated, high download count, non-hearing-impaired
    const sorted = subs
      .map((sub: any) => ({
        fileId: sub.attributes?.files?.[0]?.file_id,
        downloadCount: sub.attributes?.download_count || 0,
        aiTranslated: sub.attributes?.ai_translated || false,
        hearingImpaired: sub.attributes?.hearing_impaired || false,
        fps: sub.attributes?.fps || 0,
      }))
      .filter((s: any) => s.fileId)
      .sort((a: any, b: any) => {
        // Prefer non-AI
        if (a.aiTranslated !== b.aiTranslated) return a.aiTranslated ? 1 : -1;
        // Prefer non-hearing-impaired
        if (a.hearingImpaired !== b.hearingImpaired) return a.hearingImpaired ? 1 : -1;
        // Prefer higher download count
        return b.downloadCount - a.downloadCount;
      });

    if (sorted.length === 0) {
      console.log(`[Subtitles] No valid file_ids found for tmdb=${tmdbId}`);
      return null;
    }

    const bestFileId = sorted[0].fileId;
    console.log(`[Subtitles] Found best subtitle file_id=${bestFileId} for tmdb=${tmdbId}`);
    return bestFileId;
  } catch (e) {
    console.log(`[Subtitles] Search error: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/**
 * Download SRT from OpenSubtitles using the download endpoint
 */
async function downloadSrt(fileId: number): Promise<string | null> {
  try {
    const dlRes = await fetch(`${OS_BASE}/download`, {
      method: 'POST',
      headers: {
        'Api-Key': OS_API_KEY,
        'User-Agent': UA,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file_id: fileId }),
      signal: AbortSignal.timeout(10000),
    });

    if (!dlRes.ok) {
      console.log(`[Subtitles] Download API returned ${dlRes.status}`);
      return null;
    }

    const dlData = await dlRes.json();
    const downloadLink = dlData.link;

    if (!downloadLink) {
      console.log(`[Subtitles] No download link in response`);
      return null;
    }

    // Download the actual SRT file
    const srtRes = await fetch(downloadLink, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(10000),
    });

    if (!srtRes.ok) {
      console.log(`[Subtitles] SRT download returned ${srtRes.status}`);
      return null;
    }

    const srtText = await srtRes.text();

    // Validate it's actually an SRT file
    if (!srtText.includes('-->')) {
      console.log(`[Subtitles] Downloaded file doesn't look like SRT`);
      return null;
    }

    return srtText;
  } catch (e) {
    console.log(`[Subtitles] Download error: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/**
 * Convert SRT to VTT format
 */
function srtToVtt(srt: string): string {
  let vtt = 'WEBVTT\n\n';

  const blocks = srt.trim().split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;

    // Find the timestamp line (contains -->)
    let tsLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) {
        tsLineIdx = i;
        break;
      }
    }
    if (tsLineIdx === -1) continue;

    // Convert timestamp: 00:00:00,000 → 00:00:00.000
    const tsLine = lines[tsLineIdx]
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');

    // Get text lines (everything after the timestamp)
    const textLines = lines.slice(tsLineIdx + 1).join('\n');

    // Clean up HTML tags but keep basic formatting
    const cleanText = textLines
      .replace(/<i>/g, '').replace(/<\/i>/g, '')
      .replace(/<b>/g, '').replace(/<\/b>/g, '')
      .replace(/<font[^>]*>/g, '').replace(/<\/font>/g, '')
      .replace(/\{[^}]*\}/g, ''); // Remove ASS-style tags

    vtt += `${tsLine}\n${cleanText}\n\n`;
  }

  return vtt;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tmdbId = searchParams.get('id');
  const type = searchParams.get('type') || 'movie';
  const season = searchParams.get('s') || undefined;
  const episode = searchParams.get('e') || undefined;

  if (!tmdbId) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  // Step 1: Find the best subtitle file_id
  const fileId = await findSubtitleFileId(parseInt(tmdbId, 10), type, season, episode);

  if (!fileId) {
    return NextResponse.json({ subtitles: [] });
  }

  // Step 2: Download the SRT file
  const srtText = await downloadSrt(fileId);

  if (!srtText) {
    return NextResponse.json({ subtitles: [] });
  }

  // Step 3: Convert SRT to VTT
  const vtt = srtToVtt(srtText);

  console.log(`[Subtitles] Returning VTT (${vtt.length} chars) for tmdb=${tmdbId}`);

  return new NextResponse(vtt, {
    headers: {
      'Content-Type': 'text/vtt; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
