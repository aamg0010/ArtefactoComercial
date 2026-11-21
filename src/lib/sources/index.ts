import { GooglePlacesAdapter } from './google-places';
import { MockSourceAdapter } from './mock';
import { CsvSourceAdapter } from './csv';
import { StubSourceAdapter } from './stubs';
import { OpenStreetMapAdapter, DatabaseOverpassGate } from './openstreetmap';
import type { PrismaClient } from '@prisma/client';
import { sourceNames, type SourceAdapter } from './types';

export function prospectingSimulated() { return !process.env.GOOGLE_PLACES_API_KEY?.trim(); }
export function sourceAdapter(source: typeof sourceNames[number], db?: PrismaClient): SourceAdapter {
  if (source === 'google-places' || source === 'mock') return prospectingSimulated() ? new MockSourceAdapter() : new GooglePlacesAdapter(process.env.GOOGLE_PLACES_API_KEY!);
  if (source === 'csv') return new CsvSourceAdapter();
  if (source === 'openstreetmap') return new OpenStreetMapAdapter(db ? { gate: new DatabaseOverpassGate(db) } : {});
  return new StubSourceAdapter(source);
}
