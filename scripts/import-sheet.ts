import { enqueueCompany, enqueueContact, enqueuePipeline } from '../src/lib/trygestion/outbox';
import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { ContactSource, ConsentStatus, Country, LegalBasis, PrismaClient } from '@prisma/client';
import { normalizeText, normalizeDomain } from '../src/lib/normalization';
import { companyWebsiteCandidate, hasDirectContact } from '../src/lib/company-contact';

const file = process.argv[2];
if (!file) throw new Error('Uso: npm run import:sheet -- archivo.csv');
const prisma = new PrismaClient();
const stageMap: Record<string, string> = { 'Por investigar': 'DETECTED', 'Por contactar': 'RESEARCHED', Contactado: 'CONTACTING', 'Reunión agendada': 'MEETING', 'Propuesta enviada': 'PROPOSAL', Ganado: 'WON', Descartado: 'LOST' };
function parseDate(value?: string) { if (!value) return null; const parts = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return new Date(parts ? `${parts[3]}-${parts[2]}-${parts[1]}T00:00:00.000Z` : `${value}T00:00:00.000Z`); }
function normalizedRow(row: Record<string, string>) { return Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeText(key).replace(/ /g, '_'), value])); }
async function main() {
  const rows = parse(await readFile(file, 'utf8'), { columns: true, skip_empty_lines: true, trim: true, bom: true }) as Record<string, string>[];
  for (const rawRow of rows) {
    await prisma.$transaction(async tx => {
    const row = normalizedRow(rawRow);
    const sourceId = row.id || undefined;
    const normalizedName = normalizeText(row.empresa || row.nombre || '');
    if (!normalizedName) throw new Error('Cada fila debe incluir id o empresa/nombre.');
    const country = row.pais === 'Colombia' || row.pais === 'CO' ? Country.CO : Country.ES;
    const city = row.municipio || row.ciudad || null;
    const named = sourceId ? [] : await tx.company.findMany({ where: { normalizedName, country } });
    if (!sourceId && !city && named.length > 1) throw new Error('Nombre ambiguo: indica id o municipio para importar una empresa homónima.');
    const existing = sourceId ? await tx.company.findUnique({ where: { sourceId } }) : named.find(item => !city || normalizeText(item.city ?? '') === normalizeText(city));
    const name = row.empresa || row.nombre;
    const data = { name, priority: row.prioridad || null, pipelineStage: stageMap[row.estado] ?? 'DETECTED', sector: row.sector || null, city: row.municipio || row.ciudad || null, comarca: row.comarca || null, region: row.provincia || row.region || null, nextAction: row.proxima_accion || null, nextActionAt: parseDate(row.fecha_proxima_accion || row.fecha), sourceDetail: 'Importación de hoja compartida' };
    const company = existing ? await tx.company.update({ where: { id: existing.id }, data }) : await tx.company.create({ data: { ...data, sourceId, normalizedName, country, source: ContactSource.CSV } });
    const rawContact = row.contacto_corporativo || row.contacto || '';
    const website = companyWebsiteCandidate([row.web, row.website, rawContact].filter(Boolean).join(' '));
    if (website) await tx.company.updateMany({ where: { id: company.id, OR: [{ website: null }, { website: '' }] }, data: { website, normalizedDomain: normalizeDomain(website) } });
    if (rawContact && rawContact !== 'Pendiente') {
      const email = rawContact.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0] ?? null;
      const phone = rawContact.match(/\b\d{3}[\d\s]{5,}\d\b/)?.[0]?.trim() ?? null;
      const verified = hasDirectContact({ email, phone }) && !/verificar/i.test(rawContact);
      const changed = await tx.contact.updateMany({ where: { companyId: company.id, fullName: 'Contacto general' }, data: { email, phone, verified } });
      if (changed.count === 0) await tx.contact.create({ data: { companyId: company.id, fullName: 'Contacto general', email, phone, verified, source: ContactSource.CSV, sourceDetail: 'Importación de hoja compartida', legalBasis: LegalBasis.PENDING, consentStatus: ConsentStatus.PENDING } });
    }
    await enqueueCompany(tx, company.id);
    for (const contact of await tx.contact.findMany({ where: { companyId: company.id } })) await enqueueContact(tx, contact.id);
    if (existing && existing.pipelineStage !== company.pipelineStage) await enqueuePipeline(tx, company.id, company.pipelineStage, company.updatedAt.toISOString());
    });
  }
  console.log(`Importadas/actualizadas ${rows.length} filas.`);
}
main().finally(() => prisma.$disconnect());
