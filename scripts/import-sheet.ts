import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { ContactSource, Country, PrismaClient } from '@prisma/client';
import { normalizeText } from '../src/lib/normalization';

const file = process.argv[2];
if (!file) throw new Error('Uso: npm run import:sheet -- archivo.csv');
const prisma = new PrismaClient();
async function main() {
  const rows = parse(await readFile(file, 'utf8'), { columns: true, skip_empty_lines: true, trim: true, bom: true }) as Record<string, string>[];
  for (const row of rows) {
    const sourceId = row.id || undefined;
    const normalizedName = normalizeText(row.empresa || row.nombre || '');
    if (!normalizedName) throw new Error('Cada fila debe incluir id o empresa/nombre.');
    const country = row.pais === 'Colombia' || row.pais === 'CO' ? Country.CO : Country.ES;
    const where = sourceId ? { sourceId } : { normalizedName_country: { normalizedName, country } };
    await prisma.company.upsert({ where, update: { name: row.empresa || row.nombre, sourceDetail: 'Importación de hoja compartida' }, create: { sourceId, name: row.empresa || row.nombre, normalizedName, country, region: row.provincia || row.region || null, city: row.municipio || row.ciudad || null, sector: row.sector || null, source: ContactSource.CSV, sourceDetail: 'Importación de hoja compartida' } });
  }
  console.log(`Importadas/actualizadas ${rows.length} filas.`);
}
main().finally(() => prisma.$disconnect());
