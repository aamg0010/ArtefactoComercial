import { createHash } from 'node:crypto';
import { parseCompanyCsv } from '../csv';
import { type SourceAdapter, type CandidateCompany, type SearchCriteria, candidateSchema } from './types';

/** Reuse the existing CSV parser, discarding all personal contact/email columns. */
export function csvCandidates(input: string): CandidateCompany[] {
  return parseCompanyCsv(input).map(row => ({ name: row.nombre, city: row.ciudad || 'Pendiente', province: row.region || '', country: row.pais,
    address: null, website: row.web ? new URL(row.web.includes('://') ? row.web : `https://${row.web}`).href : null,
    corporatePhone: row.telefono || null, category: row.sector || '', nif: row.nifNit || null,
    source: 'csv', sourceRef: createHash('sha256').update(`${row.normalizedName}:${row.ciudad || ''}:${row.pais}`).digest('hex'),
    sourceUrl: null, simulated: false }));
}
export class CsvSourceAdapter implements SourceAdapter {
  readonly id = 'csv' as const;
  async search(criteria: SearchCriteria) {
    criteria.onQuery?.('Importación de CSV corporativo');
    return candidateSchema.array().parse(criteria.csvCandidates ?? []).filter(item => item.country === criteria.country).slice(0, criteria.maxResults);
  }
}
