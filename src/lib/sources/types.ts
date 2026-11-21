import { z } from 'zod';

export const sourceNames = ['google-places', 'openstreetmap', 'mock', 'csv', 'apollo', 'einforma', 'rues', 'linkedin-export'] as const;
const httpUrl = z.string().url().refine(value => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } });
export const candidateSchema = z.object({
  name: z.string().min(2).max(250), city: z.string().min(1), province: z.string(), country: z.enum(['ES', 'CO']),
  address: z.string().nullable(), website: httpUrl.nullable(), corporatePhone: z.string().nullable(),
  category: z.string(), source: z.enum(sourceNames), sourceRef: z.string().min(1), sourceUrl: httpUrl.nullable(),
  nif: z.string().nullable().optional(), simulated: z.boolean().default(false),
  corporateEmail: z.string().email().nullable().optional(), attribution: z.string().optional(),
  attributions: z.array(z.object({ displayName: z.string(), uri: httpUrl })).optional(),
});
export type CandidateCompany = z.infer<typeof candidateSchema>;
export type SearchCriteria = {
  country: 'ES' | 'CO'; provinces: string[]; comarcas: string[]; municipalities: string[];
  keywords: string[]; cnaeCodes: string[]; productLine: string; maxResults: number;
  csvCandidates?: unknown; onQuery?: (query: string) => void;
};
export interface SourceAdapter { readonly id: typeof sourceNames[number]; search(criteria: SearchCriteria): Promise<CandidateCompany[]> }

export function* searchQueries(criteria: SearchCriteria) {
  for (const keyword of criteria.keywords) for (const city of criteria.municipalities) for (const province of criteria.provinces) {
    yield { keyword, city, province, text: `${keyword} en ${city}, ${province}` };
  }
}
