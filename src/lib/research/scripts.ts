import { z } from 'zod';
import type { Evidence, Research } from './schema';
import { unsupportedNames } from './schema';

export const generatedScriptShape = z.object({
  producto_principal: z.string(),
  llamada: z.object({ apertura: z.string().min(1), motivo: z.string().min(1), pregunta_clave: z.string().min(1), propuesta_valor: z.string().min(1), objeciones: z.object({ precio: z.string().min(1), ya_tenemos_programa: z.string().min(1), no_es_momento: z.string().min(1), envieme_info: z.string().min(1) }), cierre: z.string().min(1), mensaje_voz: z.string().min(1) }),
  emails: z.array(z.object({ dia: z.number().int().positive(), asunto: z.string().min(1), cuerpo: z.string().min(1) })).min(3).max(4),
  cadencia: z.array(z.object({ dia: z.number().int().positive(), canal: z.enum(['email', 'llamada']), accion: z.string().min(1) })).min(5),
  fuentes: z.array(z.string()).min(1),
  nota: z.string(),
});
export type GeneratedScript = z.infer<typeof generatedScriptShape>;
export type StandardStep = { dia: number; canal: string; accion: string };
export function generatedScriptSchema(evidence: Evidence[], product: string, cadence: StandardStep[]) {
  return generatedScriptShape.superRefine((script, context) => {
    const issue = (message: string) => context.addIssue({ code: 'custom', message });
    if (script.producto_principal !== product) issue('Producto principal incorrecto.');
    for (const source of script.fuentes) if (!evidence.some(item => item.id === source)) issue('Fuente desconocida.');
    if (JSON.stringify(script.cadencia.map(({ dia, canal }) => ({ dia, canal }))) !== JSON.stringify(cadence.map(({ dia, canal }) => ({ dia, canal })))) issue('Cadencia distinta de la estándar.');
    const texts = [...Object.values(script.llamada).filter((value): value is string => typeof value === 'string'), ...Object.values(script.llamada.objeciones), ...script.emails.flatMap(email => [email.asunto, email.cuerpo])];
    for (const text of texts) {
      if (unsupportedNames(text, evidence).length) issue('Nombre no presente en la ficha.');
      for (const number of text.match(/\d+(?:[.,]\d+)*/g) ?? []) if (!evidence.some(item => item.text.includes(number))) issue('Cifra no documentada.');
      if (/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text) || /https?:\/\//i.test(text)) issue('No insertar contactos ni URLs: usa variables.');
    }
    for (const email of script.emails) if (!email.cuerpo.includes('BAJA') || !email.cuerpo.includes('[TELÉFONO]') || !email.cuerpo.includes('[WEB]') || !email.cuerpo.includes('try! company')) issue('Falta identificación, variables o pie de baja.');
  });
}

export function mockScript(company: string, product: string, research: Research, cadence: StandardStep[]): GeneratedScript {
  const footer = '\n\ntry! company · [TELÉFONO] · [WEB]\nLe contactamos para explorar una posible mejora de gestión. Si no desea más comunicaciones, responda BAJA. Borrador sujeto a revisión humana y verificación de la base legal antes de enviar.';
  return {
    producto_principal: product,
    llamada: {
      apertura: `Buenos días, soy del equipo de try! company. ¿Puedo hablar con la persona responsable de gestión de ${company}?`,
      motivo: `Queremos explorar si ${product} puede ayudarles a reducir trabajo manual y mejorar la rentabilidad. Es una hipótesis pendiente de verificar.`,
      pregunta_clave: '¿Qué proceso les quita más tiempo o dificulta tomar decisiones hoy?',
      propuesta_valor: `Podemos valorar ${product} con un diagnóstico de su proceso, sin presuponer necesidades ni prometer cifras.`,
      objeciones: { precio: 'Primero validamos el problema y el retorno antes de hablar de una propuesta.', ya_tenemos_programa: 'Partimos de lo que ya funciona. ¿Qué tarea queda todavía fuera del sistema?', no_es_momento: '¿Cuándo sería oportuno retomar la conversación?', envieme_info: '¿Qué proceso le interesa mejorar para enviar sólo información relevante?' },
      cierre: '¿Le encaja una conversación de diagnóstico para confirmar si podemos ayudar?',
      mensaje_voz: 'Soy del equipo de try! company. Quería consultar una posible mejora de gestión; le enviaré información sólo si procede por su base legal.',
    },
    emails: [1, 6, 15].map((dia, index) => ({ dia, asunto: `${index ? 'Seguimiento: ' : ''}gestión en ${company}`, cuerpo: `Buenos días,\nQueremos explorar si ${product} puede ayudar a mejorar la productividad de ${company}. No hemos verificado sus necesidades. ¿Le encaja una conversación para conocer el proceso?${footer}` })),
    cadencia: cadence.map(step => ({ ...step, canal: step.canal as 'email' | 'llamada', accion: step.accion.replace(/\s*\((?:emails?\[\d+\]|llamada)\)/gi, '') })),
    fuentes: research.sources.map(source => source.id), nota: 'Propuesta estimada; confirmar las necesidades y el rol del decisor antes de usar.',
  };
}
