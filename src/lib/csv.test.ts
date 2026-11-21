import { describe, expect, it } from 'vitest';
import { parseCompanyCsv } from './csv';
describe('importación CSV', () => {
  it('normaliza nombre y dominio', () => { const [company] = parseCompanyCsv('nombre,pais,web\nÁrbol & Hijos,ES,www.arbol.test'); expect(company).toMatchObject({ normalizedName: 'arbol hijos', normalizedDomain: 'arbol.test' }); });
  it('rechaza países y filas inválidas', () => { expect(() => parseCompanyCsv('nombre,pais\nEmpresa,XZ')).toThrow('Fila 2'); });
  it('acepta el formato de prospectos y asume España', () => { const [company] = parseCompanyCsv('empresa,provincia,municipio,sector,contacto_corporativo\nEmpresa Aragón,Teruel,Alcañiz,Industria,info@empresa.test'); expect(company).toMatchObject({ nombre: 'Empresa Aragón', pais: 'ES', region: 'Teruel', ciudad: 'Alcañiz' }); });
});
