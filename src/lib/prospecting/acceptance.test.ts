import { expect, it } from 'vitest';
import { extractSiteBusiness } from '../research/site-details';
import { signProposal, verifyProposal, acceptanceInput, type AcceptanceProposal } from './acceptance';

it('extrae datos sólo de Organization y canales genéricos de la web, no de Person', () => {
  const html = '<title>Empresa propia | Inicio</title><script type="application/ld+json">{"@graph":[{"@type":"Person","name":"Nombre privado","email":"persona@gmail.com"},{"@type":"Organization","name":"Empresa Legal S.L.","telephone":"978000111","email":"info@empresa.test","address":{"addressLocality":"Alcañiz"}}]}</script>';
  expect(extractSiteBusiness(html, 'https://empresa.test', '2026-11-21T00:00:00.000Z')).toMatchObject({ name: 'Empresa Legal S.L.', city: 'Alcañiz', phone: '978000111', email: 'info@empresa.test' });
});
it('las propuestas sin datos estructurados usan el título y mailto/tel corporativos', () => {
  const data = extractSiteBusiness('<title>Empresa pública</title><a href="mailto:juan@gmail.com">Privado</a><a href="mailto:contacto@empresa.test">Email</a><a href="tel:+34978000111">Tel</a>', 'https://empresa.test', '2026-11-21T00:00:00.000Z');
  expect(data).toMatchObject({ name: 'Empresa pública', phone: '+34978000111', email: 'contacto@empresa.test' });
});
it('no atribuye a la web una propuesta manipulada, caducada o de otra empresa', () => {
  const proposal: AcceptanceProposal = { companyId: 'company', expires: Date.now() + 10000, fields: { name: { value: 'Empresa propia', url: 'https://empresa.test', date: new Date().toISOString() } } };
  const token = signProposal(proposal, 'test-secret');
  expect(verifyProposal(token, 'company', 'test-secret')).toEqual(proposal);
  expect(verifyProposal(`${token}modified`, 'company', 'test-secret')).toBeUndefined();
  expect(verifyProposal(token, 'other-company', 'test-secret')).toBeUndefined();
  expect(verifyProposal(signProposal({ ...proposal, expires: 0 }, 'test-secret'), 'company', 'test-secret')).toBeUndefined();
});
it('exige revisión humana y rechaza emails personales al aceptar', () => {
  const input = { name: 'Empresa', city: 'Alcañiz', website: '', phone: '', email: 'info@empresa.test', confirmed: true };
  expect(acceptanceInput.safeParse(input).success).toBe(true);
  expect(acceptanceInput.safeParse({ ...input, confirmed: false }).success).toBe(false);
  expect(acceptanceInput.safeParse({ ...input, email: 'juan@gmail.com' }).success).toBe(false);
  expect(acceptanceInput.safeParse({ ...input, email: 'juan.perez@empresa.test' }).success).toBe(false);
});
