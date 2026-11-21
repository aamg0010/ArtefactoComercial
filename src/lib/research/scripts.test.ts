import { expect, it } from 'vitest';
import templates from '../../../data/guiones.json';
import { mockResearch } from './schema';
import { mockScript } from './scripts';

it.each(['Limabril S.L.', 'Empresa S.A.', 'Empresa sin punto'])('termina las frases de %s sin duplicar puntos ni perder el pie legal', name => {
  const research = mockResearch([{ id: 'crm', url: 'urn:test:company', date: '2026-11-21T00:00:00.000Z', text: name }], null, ['Athenea'], 'Sin web');
  const script = mockScript(name, 'Athenea', research, templates.cadencia_estandar);
  for (const email of script.emails) {
    expect(email.cuerpo).not.toContain('..');
    expect(email.cuerpo).toContain(`${name}${name.endsWith('.') ? '' : '.'} No hemos verificado`);
    expect(email.cuerpo).toContain('BAJA'); expect(email.cuerpo).toContain('[TELÉFONO]'); expect(email.cuerpo).toContain('[WEB]');
  }
});
