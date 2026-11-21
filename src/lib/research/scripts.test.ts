import { expect, it } from 'vitest';
import templates from '../../../data/guiones.json';
import { mockResearch } from './schema';
import { generatedScriptSchema, mockScript } from './scripts';

it('el filtro del guion rechaza nombres y cifras inventados y deja pasar la marca y los productos propios', () => {
  const sources = [{ id: 'crm', url: 'urn:test:company', date: '2026-11-21T00:00:00.000Z', text: 'Cooperativa Ejemplo · fundada en 2020 · 45 socios' }];
  const research = mockResearch(sources, null, ['Athenea'], 'Sin web');
  const base = mockScript('Cooperativa Ejemplo', 'Athenea', research, templates.cadencia_estandar);
  const schema = generatedScriptSchema(sources, 'Athenea', templates.cadencia_estandar, ['Try Business Solutions', 'Athenea']);
  const conTexto = (motivo: string) => ({ ...base, llamada: { ...base.llamada, motivo } });
  const errores = (motivo: string) => { const r = schema.safeParse(conTexto(motivo)); return r.success ? [] : r.error.issues.map(i => i.message); };
  expect(errores('Con Athenea y Try Business Solutions trabajamos con sus 45 socios.')).toEqual([]);
  expect(errores('Antonio Cerdán nos recomendó llamarles.').join(' ')).toContain('Antonio Cerdán');
  expect(errores('¿Hablamos 20 minutos?').join(' ')).toContain('Cifra no documentada: 20');
  expect(errores('Es una hipótesis pendiente de verificar.').join(' ')).toContain('frases internas');
});

it.each(['Limabril S.L.', 'Empresa S.A.', 'Empresa sin punto'])('termina las frases de %s sin duplicar puntos ni perder el pie legal', name => {
  const research = mockResearch([{ id: 'crm', url: 'urn:test:company', date: '2026-11-21T00:00:00.000Z', text: name }], null, ['Athenea'], 'Sin web');
  const script = mockScript(name, 'Athenea', research, templates.cadencia_estandar);
  for (const email of script.emails) {
    expect(email.cuerpo).not.toContain('..');
    expect(email.cuerpo).toContain(`${name}${name.endsWith('.') ? '' : '.'} Nos gustaría conocer`);
    expect(email.cuerpo).toContain('BAJA'); expect(email.cuerpo).toContain('[TELÉFONO]'); expect(email.cuerpo).toContain('[WEB]');
  }
});
