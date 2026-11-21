import { createHash } from 'node:crypto';
import { type SourceAdapter, type SearchCriteria, type CandidateCompany, searchQueries } from './types';

export class MockSourceAdapter implements SourceAdapter {
  readonly id = 'mock' as const;
  async search(criteria: SearchCriteria): Promise<CandidateCompany[]> {
    if (process.env.GOOGLE_PLACES_API_KEY?.trim()) throw new Error('MOCK_DISABLED_WITH_GOOGLE_KEY');
    const query = searchQueries(criteria).next().value;
    if (!query) return [];
    criteria.onQuery?.(query.text);
    return Array.from({ length: criteria.maxResults }, (_, index) => {
      const ref = createHash('sha256').update(`${criteria.country}:${query.text}:${index}`).digest('hex').slice(0, 24);
      return { name: `[SIMULADA] ${query.keyword} ${query.city} ${index + 1}`, city: query.city, province: query.province, country: criteria.country,
        address: null, website: `https://empresa-${ref}.example.invalid`, corporatePhone: null,
        category: query.keyword, source: this.id, sourceRef: ref, sourceUrl: `https://example.invalid/mock/${ref}`, simulated: true };
    });
  }
}
