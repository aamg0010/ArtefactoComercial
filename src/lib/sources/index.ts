import { GooglePlacesAdapter } from './google-places';
import { MockSourceAdapter } from './mock';
import { CsvSourceAdapter } from './csv';
import { StubSourceAdapter } from './stubs';
import { sourceNames, type SourceAdapter } from './types';

export function prospectingSimulated() { return !process.env.GOOGLE_PLACES_API_KEY?.trim(); }
export function sourceAdapter(source: typeof sourceNames[number]): SourceAdapter {
  if (source === 'google-places' || source === 'mock') return prospectingSimulated() ? new MockSourceAdapter() : new GooglePlacesAdapter(process.env.GOOGLE_PLACES_API_KEY!);
  if (source === 'csv') return new CsvSourceAdapter();
  return new StubSourceAdapter(source);
}
