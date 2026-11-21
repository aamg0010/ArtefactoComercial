import { z } from 'zod';
import { sourceNames } from '../sources/types';

const list = z.array(z.string().trim().min(1).max(160)).max(40);
export const profileSchema = z.object({
  name: z.string().trim().min(2).max(150), active: z.boolean(), country: z.enum(['ES', 'CO']),
  provinces: list.min(1), comarcas: list, municipalities: list.min(1), keywords: list.min(1),
  cnaeCodes: z.array(z.string().regex(/^\d{2,4}$/)).max(30), productLine: z.string().min(1),
  source: z.enum(sourceNames), maxResults: z.number().int().min(1).max(200),
  sources: z.array(z.enum(sourceNames)).min(1).max(8),
});
export const exampleProfiles = [
  { id: 'seed-profile-food', name: 'Agroalimentaria Bajo Aragón', active: false, country: 'ES' as const,
    provinces: ['Teruel', 'Zaragoza'], comarcas: ['Bajo Aragón', 'Bajo Aragón-Caspe', 'Matarraña', 'Bajo Martín', 'Andorra-Sierra de Arcos'],
    municipalities: ['Alcañiz', 'Calanda', 'Caspe', 'Valderrobres', 'Alcorisa', 'Andorra', 'La Puebla de Híjar'],
    keywords: ['almazara', 'cooperativa agrícola', 'fruta', 'secadero de jamón', 'bodega'], cnaeCodes: [], productLine: 'Athenea', source: 'google-places', sources: ['openstreetmap', 'google-places'], maxResults: 10 },
  { id: 'seed-profile-livestock', name: 'Ganadería Teruel y Zaragoza', active: false, country: 'ES' as const,
    provinces: ['Teruel', 'Zaragoza'], comarcas: ['Bajo Aragón', 'Bajo Aragón-Caspe'], municipalities: ['Alcañiz', 'Calanda', 'Caspe'],
    keywords: ['granja porcina', 'cooperativa ganadera', 'ovino'], cnaeCodes: [], productLine: 'Ganadex', source: 'google-places', sources: ['openstreetmap', 'google-places'], maxResults: 10 },
  { id: 'seed-profile-services', name: 'Pymes de servicios Alcañiz', active: false, country: 'ES' as const,
    provinces: ['Teruel'], comarcas: ['Bajo Aragón'], municipalities: ['Alcañiz'], keywords: ['gestoría', 'distribución', 'taller', 'limpieza'],
    cnaeCodes: [], productLine: 'Soporte técnico', source: 'google-places', sources: ['openstreetmap', 'google-places'], maxResults: 10 },
];
