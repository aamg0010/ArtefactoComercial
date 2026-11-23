import { expect, it } from 'vitest';
import { legalBasisInfo, sameContact, sourceLink } from './labels';

it('detecta el mismo contacto por email, teléfono o nombre', () => {
  const ana = { fullName: 'Ana Pérez', email: 'Ana@Empresa.es', phone: '978 83 12 34' };
  expect(sameContact(ana, { fullName: 'Otra', email: 'ana@empresa.es' })).toBe(true);
  expect(sameContact(ana, { fullName: 'Otra', phone: '+34 978831234' })).toBe(true);
  expect(sameContact(ana, { fullName: 'ana perez' })).toBe(true);
  expect(sameContact(ana, { fullName: 'Luis Gil', email: 'luis@empresa.es', phone: '978000000' })).toBe(false);
});

it('enlaza Google Maps sin mostrar el identificador interno', () => {
  expect(sourceLink('google-places', 'ChIJF1234567890abcdef')).toBe('https://www.google.com/maps/place/?q=place_id:ChIJF1234567890abcdef');
  expect(sourceLink('openstreetmap', 'node/1', 'https://www.openstreetmap.org/node/1')).toBe('https://www.openstreetmap.org/node/1');
  expect(sourceLink('rues', '22-186462')).toBeNull();
});

it('todas las bases legales tienen nombre y explicación en castellano', () => {
  expect(Object.keys(legalBasisInfo)).toEqual(['LEGITIMATE_INTEREST', 'CONSENT', 'CONTRACT', 'PENDING']);
  expect(Object.values(legalBasisInfo).every(info => info.label && info.help.length > 30)).toBe(true);
});
