import { PrismaClient, ContactSource, Country, LegalBasis, ConsentStatus, UserRole } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();
const products = [
  ['Ganadex', 'Plataforma SaaS de gestión digital agro-ganadera'], ['trygestión', 'ERP de gestión empresarial general'], ['Athenea', 'ERP de trazabilidad integral'], ['Soporte técnico', 'Soporte in situ y remoto'], ['Ciberseguridad', 'Diagnóstico, protección y formación'], ['Sistemas de gestión', 'Procesos, ISO y digitalización'], ['Bots / IA', 'Chatbots, automatizaciones y agentes'],
] as const;
const companyNames = ['Agropecuaria Los Olivos', 'Cooperativa Verde Norte', 'Lácteos Sierra Clara', 'Distribuciones Ebro', 'Talleres Mestral', 'Bodegas Campo Alto', 'Ganadería La Encina', 'Frutales del Segre', 'Cárnicas Montseny', 'Servicios Delta', 'Café Antioquia', 'Granja El Porvenir', 'Alimentos Córdoba', 'Comercializadora Andina', 'Finca La Esperanza', 'Tecnologías del Maíz', 'Cooperativa San Jorge', 'Manufacturas Ronda', 'Logística Turia', 'Viveros del Ebro'];

async function main() {
  const passwordHash = await hash('TryComercial2025!', 12);
  const admin = await prisma.user.upsert({ where: { email: 'admin@try.company' }, update: {}, create: { email: 'admin@try.company', name: 'Administración try!', role: UserRole.ADMIN, passwordHash } });
  await prisma.user.upsert({ where: { email: 'comercial@try.company' }, update: {}, create: { email: 'comercial@try.company', name: 'Comercial Demo', role: UserRole.SALES, passwordHash } });
  for (const [line, description] of products) await prisma.product.upsert({ where: { line }, update: { name: line, description }, create: { name: line, line, description } });
  for (const [index, name] of companyNames.entries()) {
    const country = index >= 10 && index < 17 ? Country.CO : Country.ES;
    const slug = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const company = await prisma.company.upsert({
      where: { normalizedName_country: { normalizedName: slug, country } },
      update: {},
      create: { name, normalizedName: slug, fictional: true, country, region: country === Country.ES ? (index % 2 ? 'Cataluña' : 'Aragón') : (index % 2 ? 'Antioquia' : 'Córdoba'), city: country === Country.ES ? (index % 2 ? 'Lleida' : 'Zaragoza') : (index % 2 ? 'Medellín' : 'Montería'), sector: index % 3 ? 'Agroalimentario' : 'Servicios', employeeRange: index % 2 ? '11-50' : '1-10', website: `https://${slug}.example.test`, normalizedDomain: `${slug}.example.test`, email: `info@${slug}.example.test`, source: ContactSource.MANUAL, sourceDetail: 'Seed de demostración; empresa ficticia', ownerId: admin.id },
    });
    await prisma.contact.upsert({ where: { id: `seed-contact-${index}` }, update: {}, create: { id: `seed-contact-${index}`, companyId: company.id, fullName: `Responsable de ${name}`, role: 'Gerencia', email: `contacto@${slug}.example.test`, source: ContactSource.MANUAL, sourceDetail: 'Seed ficticio', legalBasis: LegalBasis.PENDING, consentStatus: ConsentStatus.PENDING, requiresConsent: true } });
  }
  console.log('Seed completado: catálogo, 2 usuarios y 20 empresas ficticias.');
}
main().finally(() => prisma.$disconnect());
