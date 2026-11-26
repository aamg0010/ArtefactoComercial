/** Ejemplo reproducible, sin base de datos ni red: node scripts/run-typescript.cjs scripts/example-script-prompt.ts */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { companyScriptContext, scriptPrompt } from '../src/lib/research/script-context';
import { mockResearch } from '../src/lib/research/schema';
import { mockScript, type StandardStep } from '../src/lib/research/scripts';
import { productCatalog } from '../src/lib/products/catalog';

async function main() {
  const date = new Date('2026-11-26T09:00:00.000Z');
  // Todos los datos siguientes son simulados para revisar el prompt; no se atribuyen a la empresa real.
  const company = {
    id: 'ejemplo-borsao', name: 'Bodegas Borsao', sector: 'Bodega DOP Campo de Borja', city: 'Borja', region: 'Zaragoza', country: 'ES', website: 'https://borsao.example.invalid', employeeRange: null, updatedAt: date,
    evidence: [{ id: 'ejemplo-web', kind: 'WEB_OWN', data: { confirmed: { actividad: 'Elaboración y embotellado de vino de garnacha', cnae: '1102', descripcion: 'Cuaderno de bodega, depósitos y lotes de vendimia' } } }],
    contacts: [{ id: 'ejemplo-contact', fullName: 'Marta López', role: 'Responsable de operaciones' }],
    activities: [{ id: 'ejemplo-llamada', type: 'CALL', createdAt: date, interlocutor: 'Marta López', result: 'Contactado', body: 'En la conversación solicitó información sobre cómo consultar los movimientos de lotes entre depósitos.' }],
  } as unknown as Parameters<typeof companyScriptContext>[0];
  const sources = [{ id: 'web-1', url: company.website!, date: date.toISOString(), text: 'Bodegas Borsao: bodega DOP Campo de Borja. Elabora y embotella vino de garnacha, con depósitos y lotes de vendimia registrados en el cuaderno de bodega.' }];
  const research = mockResearch(sources, company.sector, ['Athenea'], 'Ejemplo con datos simulados, sin consulta de la web real');
  const file = JSON.parse(await readFile('data/guiones.json', 'utf8')) as { cadencia_estandar: StandardStep[]; guiones: unknown[] };
  const context = companyScriptContext(company, research);
  const example = mockScript(company.name, 'Athenea', { ...research, sources: context.evidence }, file.cadencia_estandar);
  const input = scriptPrompt(context, research, productCatalog.find(p => p.line === 'Athenea')!, file.guiones, file.cadencia_estandar, example);
  await mkdir('docs', { recursive: true });
  await writeFile('docs/fase14-borsao-prompt.json', JSON.stringify(input, null, 2) + '\n', 'utf8');
  console.log('Ejemplo completo de system + prompt guardado en docs/fase14-borsao-prompt.json (datos simulados).');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
