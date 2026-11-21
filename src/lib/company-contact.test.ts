import { expect, it } from 'vitest';
import prospects from '../../data/prospectos.json';
import { companyWebsiteCandidate, hasDirectContact, isVerifiedDirectContact } from './company-contact';

export const websiteCases = [
  ['limabril-s-l', 'limabril.com'],
  ['cooperativa-ganadera-de-caspe', 'ganaderacaspe.com'],
  ['pastores-grupo-cooperativo', 'grupopastores.coop'],
  ['grupo-arcoiris', 'grupoarcoiris.com'],
  ['venta-d-aubert', 'ventadaubert.com'],
  ['la-calandina-s-coop', 'lacalandina.com'],
] as const;

it.each(websiteCases)('extrae la web de %s desde los datos reales', (id, domain) => {
  const prospect = prospects.find(item => item.id === id)!;
  expect(companyWebsiteCandidate(prospect.contacto.texto)).toBe(`https://${domain}`);
});
it('prioriza la web explícita y no confunde un dominio de email con una web independiente', () => {
  expect(companyWebsiteCandidate('info@correo-corporativo.test · www.web-real.test')).toBe('https://www.web-real.test');
  expect(companyWebsiteCandidate('visitas@ventadaubert.com · ventadaubert.com')).toBe('https://ventadaubert.com');
});
it.each(['gmail.com', 'hotmail.es', 'outlook.com', 'yahoo.es', 'live.com', 'icloud.com', 'proton.me'])('no infiere una web corporativa del correo personal %s', domain => {
  expect(companyWebsiteCandidate(`persona@${domain}`)).toBeNull();
});
it('una web sola y los campos vacíos no son un canal directo ni un contacto verificado', () => {
  expect(hasDirectContact({ email: null, phone: null })).toBe(false);
  expect(hasDirectContact({ email: ' ', phone: '' })).toBe(false);
  expect(isVerifiedDirectContact({ verified: true, email: null, phone: null })).toBe(false);
  expect(isVerifiedDirectContact({ verified: true, email: 'info@empresa.test' })).toBe(true);
  expect(hasDirectContact({ phone: '976 632 132' })).toBe(true);
});
