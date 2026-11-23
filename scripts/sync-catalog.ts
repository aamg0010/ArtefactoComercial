import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import { PrismaClient } from '@prisma/client';
import { productCatalog } from '../src/lib/products/catalog';

/** Crea o actualiza las líneas de producto del catálogo (idempotente; no borra ni desactiva ninguna). */
async function main() {
  const prisma = new PrismaClient();
  try {
    for (const { line, description } of productCatalog) {
      const existing = await prisma.product.findUnique({ where: { line } });
      await prisma.product.upsert({ where: { line }, update: { description, active: true }, create: { name: line, line, description } });
      console.log(`${existing ? 'actualizada' : 'creada'}: ${line}`);
    }
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
