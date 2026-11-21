import { expect, it } from 'vitest';
import { appCompanyUrl, trygestionEmpresaUrl, trygestionPipelineUrl, trygestionWebUrl } from './links';

it('construye los enlaces a trygestión (por defecto en la raíz de trygestion.com)', () => {
  expect(trygestionEmpresaUrl('840775f8-ac01', {})).toBe('https://trygestion.com/empresas?ver=840775f8-ac01');
  expect(trygestionPipelineUrl({ TRYGESTION_WEB_URL: 'https://trycompany.es/gestion/' })).toBe('https://trycompany.es/gestion/pipeline');
  expect(trygestionWebUrl({ TRYGESTION_WEB_URL: 'javascript:alert(1)' })).toBe('https://trygestion.com');
});
it('el enlace a la ficha de try! Comercial solo existe si hay dirección pública válida', () => {
  expect(appCompanyUrl('abc', {})).toBeNull();
  expect(appCompanyUrl('abc', { APP_PUBLIC_URL: 'http://100.89.173.49:3001/' })).toBe('http://100.89.173.49:3001/empresas/abc');
  expect(appCompanyUrl('abc', { APP_PUBLIC_URL: 'https://user:pass@x.test' })).toBeNull();
});
