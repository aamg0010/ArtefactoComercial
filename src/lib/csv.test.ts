import { describe, expect, it } from 'vitest';
import { parseCompanyCsv } from './csv';
describe('importación CSV', () => {
  it('normaliza nombre y dominio', () => { const [company] = parseCompanyCsv('nombre,pais,web\nÁrbol & Hijos,ES,www.arbol.test'); expect(company).toMatchObject({ normalizedName: 'arbol hijos', normalizedDomain: 'arbol.test' }); });
  it('rechaza países y filas inválidas', () => { expect(() => parseCompanyCsv('nombre,pais\nEmpresa,XZ')).toThrow('Fila 2'); });
});
