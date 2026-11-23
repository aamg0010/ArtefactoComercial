import { GooglePlacesAdapter, SourceError } from './google-places';
import { MockSourceAdapter } from './mock';
import { CsvSourceAdapter } from './csv';
import { StubSourceAdapter } from './stubs';
import { OpenStreetMapAdapter, DatabaseOverpassGate } from './openstreetmap';
import { EinformaAdapter, einformaCredentials } from './einforma';
export { einformaCredentials } from './einforma';
import type { PrismaClient } from '@prisma/client';
import { sourceNames, type SourceAdapter } from './types';

export function googlePlacesConfigured() { return Boolean(process.env.GOOGLE_PLACES_API_KEY?.trim()); }
/** Las empresas simuladas solo se permiten en desarrollo y pruebas: en producción nunca se inventan empresas. */
export function simulationAllowed() { return process.env.PROSPECTING_ALLOW_MOCK === '1' || process.env.NODE_ENV !== 'production'; }
export function prospectingSimulated() { return !googlePlacesConfigured() && simulationAllowed(); }
export function sourceAdapter(source: typeof sourceNames[number], db?: PrismaClient): SourceAdapter {
  if (source === 'google-places' || source === 'mock') {
    if (googlePlacesConfigured()) return new GooglePlacesAdapter(process.env.GOOGLE_PLACES_API_KEY!);
    if (simulationAllowed()) return new MockSourceAdapter();
    return { id: 'google-places', search: async () => { throw new SourceError('GOOGLE_PLACES_NOT_CONFIGURED'); } };
  }
  if (source === 'einforma') {
    const credentials = einformaCredentials();
    if (credentials) return new EinformaAdapter(credentials);
    return { id: 'einforma', search: async () => { throw new SourceError('EINFORMA_NOT_CONFIGURED'); } };
  }
  if (source === 'csv') return new CsvSourceAdapter();
  if (source === 'openstreetmap') return new OpenStreetMapAdapter(db ? { gate: new DatabaseOverpassGate(db) } : {});
  return new StubSourceAdapter(source);
}
