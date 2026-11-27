import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { claimDeploymentReload, isDeploymentError, isMissingActionResponse, recordWorkingDeployment } from './deployment-error';
import { ErrorMessage } from '../app/error-message';

it.each(['Failed to find Server Action abc. This request might be from an older or newer deployment.', 'ChunkLoadError: Loading chunk 135 failed.', 'Failed to fetch dynamically imported module: /_next/static/chunk.js'])('reconoce un despliegue distinto: %s', message => {
  expect(isDeploymentError(new Error(message))).toBe(true);
});
it('recarga solo una vez y tolera almacenamiento bloqueado', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  expect(claimDeploymentReload(storage)).toBe(true);
  expect(claimDeploymentReload(storage)).toBe(false);
  recordWorkingDeployment({ removeItem: key => { values.delete(key); } });
  expect(claimDeploymentReload(storage)).toBe(true);
  recordWorkingDeployment({ removeItem: () => { throw Error('blocked'); } });
  expect(claimDeploymentReload({ getItem: () => { throw Error('blocked'); }, setItem: () => {} })).toBe(false);
});
it('otros errores muestran mensaje amable, reintento y digest sin revelar el error interno', () => {
  expect(isDeploymentError(new Error('database password'))).toBe(false);
  const html = renderToStaticMarkup(createElement(ErrorMessage, { error: Object.assign(new Error('secret'), { digest: 'support-17' }), reset: () => {} }));
  expect(html).toContain('Ha ocurrido un problema. Puedes volver a intentarlo.');
  expect(html).toContain('Reintentar'); expect(html).toContain('support-17'); expect(html).not.toContain('secret');
});

it('detecta HTML inesperado en una acción sin confundir Flight, errores o redirecciones legítimas', () => {
  const response = (status: number, type: string, redirect = false) => ({ status, headers: new Headers({ 'content-type': type, ...(redirect ? { 'x-action-redirect': '/login' } : {}) }) });
  expect(isMissingActionResponse(response(200, 'text/html; charset=utf-8'))).toBe(true);
  expect(isMissingActionResponse(response(404, 'text/html'))).toBe(true);
  expect(isMissingActionResponse(response(200, 'text/x-component'))).toBe(false);
  expect(isMissingActionResponse(response(404, 'text/x-component'))).toBe(false);
  expect(isMissingActionResponse(response(500, 'text/html'))).toBe(false);
  expect(isMissingActionResponse(response(200, 'text/html', true))).toBe(false);
});
