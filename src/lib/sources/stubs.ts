import type { SourceAdapter, SearchCriteria, CandidateCompany } from './types';

export class StubSourceAdapter implements SourceAdapter {
  constructor(readonly id: 'apollo' | 'einforma' | 'rues' | 'linkedin-export') {}
  // TODO apollo: authorized company-only API integration; never enrich personal contacts.
  // TODO einforma: licensed corporate NIF/CNAE data and contractual retention rules.
  // TODO rues: official corporate records with an authorized adapter.
  // TODO linkedin-export: manual company export only; no scraping or personal profiles.
  async search(_criteria: SearchCriteria): Promise<CandidateCompany[]> { throw new Error(`SOURCE_NOT_IMPLEMENTED:${this.id}`); }
}
