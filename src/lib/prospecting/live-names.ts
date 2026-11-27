import { GooglePlacesAdapter } from '../sources/google-places';

export type DisplayCompany = {
  id: string; name: string; acceptanceStatus?: string;
  sourceIdentities?: readonly { source: string; sourceRef: string }[];
};
export type LiveNames = ReadonlyMap<string, string>;
const prefix = 'Empresa detectada ·';
/** Also used on independently confirmed names: an identifier is never a label. */
export function withoutPlaceIds(text: string) { return text.replace(/ChIJ[\w-]*/g, '').trim(); }
function pending(company: DisplayCompany) { return company.name.startsWith(prefix) && company.acceptanceStatus !== 'ACCEPTED'; }
function placeId(company: DisplayCompany) {
  return company.sourceIdentities?.find(ref => ref.source === 'google-places')?.sourceRef
    ?? company.name.match(/·\s*([\w-]+)\s*$/)?.[1];
}
export function hasLiveCompanyName(company: DisplayCompany, names: LiveNames) {
  return pending(company) && Boolean(names.get(company.id));
}
export function displayCompanyName(company: DisplayCompany, names: LiveNames = new Map()): string {
  if (!company.name.startsWith(prefix) || company.acceptanceStatus === 'ACCEPTED') return withoutPlaceIds(company.name) || 'Pendiente de verificar';
  if (hasLiveCompanyName(company, names)) return withoutPlaceIds(names.get(company.id)!) || 'Pendiente de verificar';
  const profile = withoutPlaceIds(company.name.slice(prefix.length).replace(/·\s*[\w-]+\s*$/, '').trim()).replace(/\s*·\s*$/, '');
  return `Pendiente de verificar${profile ? ` · ${profile}` : ''}`;
}

/** Request-local results only. No database access, React/global or persistent cache. */
export async function liveCompanyNames(companies: readonly DisplayCompany[], options: {
  apiKey?: string; read?: (id: string, signal: AbortSignal) => Promise<string>; budgetMs?: number;
} = {}): Promise<LiveNames> {
  const names = new Map<string, string>();
  const key = options.apiKey ?? process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!key) return names;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const groups = new Map<string, DisplayCompany[]>();
    for (const company of companies) {
      if (!pending(company)) continue;
      const ref = placeId(company);
      if (!ref) continue;
      if (!groups.has(ref) && groups.size >= 60) continue;
      groups.set(ref, [...groups.get(ref) ?? [], company]);
    }
    const jobs = [...groups]; let next = 0;
    const read = options.read ?? ((id, signal) => new GooglePlacesAdapter(key).displayName(id, signal));
    const workers = Array.from({ length: Math.min(6, jobs.length) }, async () => {
      while (!controller.signal.aborted && next < jobs.length) {
        const [ref, rows] = jobs[next++];
        try {
          const name = withoutPlaceIds(await read(ref, controller.signal));
          if (name && !controller.signal.aborted) for (const row of rows) names.set(row.id, name);
        } catch { /* One unavailable name must not affect the other companies. */ }
      }
    });
    await Promise.race([
      Promise.allSettled(workers),
      new Promise<void>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(); }, options.budgetMs ?? 3_000); }),
    ]);
  } catch { /* Rendering always has a safe fallback. */ }
  finally { if (timer) clearTimeout(timer); controller.abort(); }
  return names;
}
