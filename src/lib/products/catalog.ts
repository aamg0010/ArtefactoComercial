/**
 * Catálogo de líneas de producto de try! company. La descripción se pasa a la IA para que sepa
 * qué ofrece cada línea al investigar empresas y al escribir guiones.
 * Para aplicar cambios en una base existente: node scripts/run-typescript.cjs scripts/sync-catalog.ts
 */
export const productCatalog: readonly { line: string; description: string }[] = [
  { line: 'Ganadex', description: 'Plataforma SaaS de gestión digital agro-ganadera' },
  { line: 'trygestión', description: 'ERP de gestión empresarial general' },
  { line: 'Athenea', description: 'ERP de trazabilidad integral' },
  {
    line: 'SaaS a medida',
    description: 'Aplicación web y móvil hecha a medida para el día a día de la empresa cuando un software estándar no encaja. Sustituye Excel, papel y WhatsApp por partes de trabajo desde el móvil (funcionan sin cobertura), control de horas, flota y combustible, costes y margen por obra o pedido, cierre de mes y facturación propuesta a partir de los partes. Caso real en producción en una empresa de construcción y transporte (obras, camiones y grúas). Encaja en cualquier sector con procesos propios: construcción, transporte, talleres, servicios de campo, industria y distribución.',
  },
  { line: 'Soporte técnico', description: 'Soporte in situ y remoto' },
  { line: 'Ciberseguridad', description: 'Diagnóstico, protección y formación' },
  { line: 'Sistemas de gestión', description: 'Procesos, ISO y digitalización' },
  { line: 'Bots / IA', description: 'Chatbots, automatizaciones y agentes' },
];
