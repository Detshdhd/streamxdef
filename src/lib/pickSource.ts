/* ─── Sondeo paralelo de fuentes ───
 * Durante outages parciales (CDNs de vidrock 403 intermitente, verificado
 * 28-sep) el fallback serial del player tarda 10-25s en llegar a una fuente
 * viva. Este sondeo pregunta el master de las primeras N fuentes EN
 * PARALELO y devuelve el índice de la primera que responde bien — el play
 * arranca directo en la viva (~1s) en vez de descender en cascada.
 * Si ninguna contesta dentro del presupuesto, devuelve 0 (comportamiento
 * anterior: el fallback normal se encarga).
 */
import type { SourceInfo } from '@/lib/sourceCache';

function proxyUrl(originalUrl: string): string {
  return `/api/proxy?url=${encodeURIComponent(originalUrl)}`;
}

export async function pickFirstAliveSource(sources: SourceInfo[], probeCount = 4): Promise<number> {
  if (typeof window === 'undefined' || sources.length === 0) return 0;
  const candidates = sources.slice(0, probeCount);
  if (candidates.length === 1) return 0;

  let settled = false;
  return new Promise<number>((resolve) => {
    const finish = (idx: number) => { if (!settled) { settled = true; resolve(idx); } };
    // Presupuesto global del sondeo: si nadie confirmó, arranque por 0.
    setTimeout(() => finish(0), 4500);

    candidates.forEach((src, i) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      fetch(proxyUrl(src.url), { signal: ctrl.signal })
        .then((r) => {
          clearTimeout(timer);
          const ct = r.headers.get('content-type') || '';
          if (r.ok && (ct.includes('mpegurl') || ct.includes('video') || ct.includes('octet-stream'))) finish(i);
          else finish(-1);
        })
        .catch(() => { clearTimeout(timer); finish(-1); });
    });
  });
}
