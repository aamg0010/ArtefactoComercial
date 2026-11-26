import { expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import templates from '../../../data/guiones.json';
import { companyScriptContext, scriptPrompt, lacksWebsiteResearch } from './script-context';
import { mockResearch } from './schema';
import { forbiddenPhrases, generatedScriptSchema, isReusableDraft, mockScript, normalizeScriptText } from './scripts';
import { defaultSignature, emailBodyWithoutFooter, personalizeGreeting } from '../mi-dia/script-email';
import { productCatalog } from '../products/catalog';
import { generateJson } from '../llm';

const sources = [{ id: 'web-1', url: 'https://borsao.example.invalid', date: '2026-11-26T09:00:00.000Z', text: 'Bodegas Borsao elabora vino de garnacha en la DOP Campo de Borja y registra los lotes de vendimia y embotellado.' }];
const research = mockResearch(sources, 'vino de garnacha', ['Athenea'], '');
const cadence = templates.cadencia_estandar;
const base = () => mockScript('Bodegas Borsao', 'Athenea', research, cadence);
const schema = generatedScriptSchema(sources, 'Athenea', cadence, ['Bodegas Borsao', 'Athenea'], { companyName: 'Bodegas Borsao', personNames: ['Marta López'] });
const errors = (script: unknown) => { const result = schema.safeParse(script); return result.success ? '' : result.error.issues.map(i => i.message).join(' '); };

it('el mock completo cumple los rangos, cadencia y personalización', () => expect(errors(base())).toBe(''));
it.each(forbiddenPhrases)('rechaza la frase %s en llamadas y emails sin distinguir tildes ni mayúsculas', phrase => {
  const script = base(); script.llamada.motivo += ` ${normalizeScriptText(phrase).toUpperCase()}`;
  expect(errors(script)).toContain(`Frase prohibida: «${phrase}»`);
  script.llamada.motivo = base().llamada.motivo;
  script.emails[1].cuerpo += ` ${phrase}`;
  expect(errors(script)).toContain('Frase prohibida');
});
it('rechaza nombres conocidos, asuntos repetidos, emails cortos y ausencia de datos concretos', () => {
  const script = base(); script.emails[1].cuerpo += ' Marta López';
  expect(errors(script)).toContain('No escribas nombres de personas');
  script.emails = base().emails; script.emails[1].asunto = script.emails[0].asunto;
  expect(errors(script)).toContain('asuntos deben ser distintos');
  script.emails = base().emails; script.emails[2].cuerpo = 'Buenos días, [NOMBRE]: ¿Hablamos?';
  expect(errors(script)).toContain('Email 3:');
  script.emails = base().emails; script.emails[0].cuerpo = 'Buenos días, [NOMBRE]:\n' + 'Su empresa tiene una actividad. '.repeat(17);
  expect(errors(script)).toContain('término concreto');
});
it('sustituye el saludo por contacto destinatario y permite editar la firma por usuario', () => {
  const contacts = [{ fullName: 'Marta López', email: 'marta@example.invalid' }];
  expect(personalizeGreeting('Buenos días, [NOMBRE]:\nTexto', 'MARTA@example.invalid', contacts)).toBe('Buenos días, Marta:\nTexto');
  expect(personalizeGreeting('Buenos días, [NOMBRE]:\nTexto', 'info@example.invalid', contacts)).toBe('Buenos días:\nTexto');
  expect(defaultSignature()).toEqual({ nombre: 'Andrés Martínez', cargo: 'Gerente' });
  expect(defaultSignature({ signatureName: 'Ana', signatureTitle: 'Directora Comercial' })).toEqual({ nombre: 'Ana', cargo: 'Directora Comercial' });
});
it('elimina firma y pie antiguos sin mutilar la palabra trabajan', () => {
  expect(emailBodyWithoutFooter('Cómo trabajan.\n\nUn saludo,\n\nAndrés\ntry! company\n[TELÉFONO] · [WEB]\nResponda BAJA.')).toBe('Cómo trabajan.');
  expect(emailBodyWithoutFooter(base().emails[0].cuerpo)).toBe(base().emails[0].cuerpo);
});
it('aporta evidencias de datos confirmados y conversaciones sin red; el prompt solo incluye el manual elegido', () => {
  const company = { id: 'borsao', name: 'Bodegas Borsao', sector: 'vino de garnacha', country: 'ES', website: sources[0].url, updatedAt: new Date(sources[0].date), evidence: [{ id: 'web-own', kind: 'WEB_OWN', data: { confirmed: { description: 'Cuaderno de bodega y embotellado', cnae: '1102' } } }], contacts: [{ id: 'ejemplo-contact', fullName: 'Marta López', role: 'Compras' }], activities: [{ id: 'call', type: 'CALL', createdAt: new Date(sources[0].date), interlocutor: 'Marta López', result: 'Contactado', body: 'Solicita información sobre lotes' }] } as unknown as Parameters<typeof companyScriptContext>[0];
  const context = companyScriptContext(company, research);
  expect(context.evidence.map(e => e.id)).toEqual(['web-1', 'company-record', 'evidence-web-own', 'contact-ejemplo-contact', 'activity-call']);
  expect(context.personNames).toContain('Marta López');
  const input = scriptPrompt(context, research, productCatalog.find(p => p.line === 'Athenea')!, [], cadence, base());
  const data = JSON.parse(input.prompt);
  expect(data.manual.sector).toBe('bodegas y vino'); expect(data.respaldo.sector).toBe('general');
  expect(data.casos).toBe('ERP de trazabilidad en producción en la planta de una empresa industrial.');
  expect(input.system).toContain('PRIMERA PERSONA SINGULAR');
  expect(lacksWebsiteResearch(sources[0].url, research)).toBe(false);
  expect(lacksWebsiteResearch('https://otra.example.invalid', research)).toBe(true);
});
it('tras tres respuestas inválidas falla e indica al proveedor qué frase retirar', async () => {
  const script = base(); script.llamada.motivo = 'He notado que trabajan aquí';
  const fetcher = vi.fn().mockImplementation(async () => Response.json({ content: [{ type: 'text', text: JSON.stringify(script) }] }));
  const create = vi.fn();
  await expect(generateJson({ system: '', prompt: '', schema }, { db: { aiRun: { create } } as unknown as PrismaClient, companyId: 'borsao', purpose: 'script', mockResponse: {}, env: { LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test' }, fetcher, pause: async () => {} })).rejects.toThrow('VALIDATION_ERROR');
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(JSON.parse(fetcher.mock.calls[1][1].body).messages[0].content).toContain('he notado');
});

it('acepta cifras que forman parte del nombre de la empresa y sigue rechazando las inventadas', () => {
  const named = generatedScriptSchema(sources, 'Athenea', cadence, ['Talleres 2000 S.L.', 'Athenea'], { companyName: 'Talleres 2000 S.L.' });
  const script = base(); script.emails[1].cuerpo += ' Talleres 2000 lo tiene claro.';
  const issues = (s: unknown) => { const r = named.safeParse(s); return r.success ? '' : r.error.issues.map(i => i.message).join(' '); };
  expect(issues(script)).not.toContain('Cifra no documentada: 2000');
  script.emails[1].cuerpo += ' Ahorra 35 horas.';
  expect(issues(script)).toContain('Cifra no documentada: 35');
});

it('solo reutiliza borradores con el marco nuevo; los antiguos o aprobados se regeneran', () => {
  expect(isReusableDraft({ status: 'BORRADOR', content: base() })).toBe(true);
  expect(isReusableDraft({ status: 'APPROVED', content: base() })).toBe(false);
  const antiguo = base(); antiguo.emails = antiguo.emails.map(e => ({ ...e, cuerpo: e.cuerpo.replace('[NOMBRE]', 'equipo') }));
  expect(isReusableDraft({ status: 'BORRADOR', content: antiguo })).toBe(false);
  expect(isReusableDraft({ status: 'BORRADOR', content: { otro: true } })).toBe(false);
});
