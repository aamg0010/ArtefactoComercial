import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { ContactSource, ConsentStatus, Country, LegalBasis, PrismaClient } from '@prisma/client';
import { normalizeText } from '../src/lib/normalization';

const file = process.argv[2];
if (!file) throw new Error('Uso: npm run import:sheet -- archivo.csv');
const prisma = new PrismaClient();
const stageMap: Record<string, string> = { 'Por investigar': 'DETECTED', 'Por contactar': 'RESEARCHED', Contactado: 'CONTACTING', 'Reunión agendada': 'MEETING', 'Propuesta enviada': 'PROPOSAL', Ganado: 'WON', Descartado: 'LOST' };
function parseDate(value?: string) { return value ? new Date(`${value}T00:00:00.000Z`) : null; }
async function main() {
  const rows = parse(await readFile(file, 'utf8'), { columns: true, skip_empty_lines: true, trim: true, bom: true }) as Record<string, string>[];
  for (const row of rows) {
    const sourceId = row.id || undefined;
    const normalizedName = normalizeText(row.empresa || row.nombre || '');
    if (!normalizedName) throw new Error('Cada fila debe incluir id o empresa/nombre.');
    const country = row.pais === 'Colombia' || row.pais === 'CO' ? Country.CO : Country.ES;
    const where = sourceId ? { sourceId } : { normalizedName_country: { normalizedName, country } };
    const name = row.empresa || row.nombre;
    const data = { name, priority: row.prioridad || null, pipelineStage: stageMap[row.estado] ?? 'DETECTED', sector: row.sector || null, city: row.municipio || row.ciudad || null, comarca: row.comarca || null, region: row.provincia || row.region || null, nextAction: row.proxima_accion || null, nextActionAt: parseDate(row.fecha_proxima_accion), sourceDetail: 'Importación de hoja compartida' };
    const company = await prisma.company.upsert({ where, update: data, create: { ...data, sourceId, normalizedName, country, source: ContactSource.CSV } });
    const rawContact = row.contacto_corporativo || row.contacto || '';
    if (rawContact && rawContact !== 'Pendiente') { const email = rawContact.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0] ?? null; const phone = rawContact.match(/\b\d{3}[\d\s]{5,}\d\b/)?.[0]?.trim() ?? null; const changed = await prisma.contact.updateMany({ where: { companyId: company.id, fullName: 'Contacto general' }, data: { email, phone, verified: !/verificar/i.test(rawContact) } }); if (changed.count === 0) await prisma.contact.create({ data: { companyId: company.id, fullName: 'Contacto general', email, phone, verified: !/verificar/i.test(rawContact), source: ContactSource.CSV, sourceDetail: 'Importación de hoja compartida', legalBasis: LegalBasis.PENDING, consentStatus: ConsentStatus.PENDING } }); }
  }
  console.log(`Importadas/actualizadas ${rows.length} filas.`);
}
main().finally(() => prisma.$disconnect());
