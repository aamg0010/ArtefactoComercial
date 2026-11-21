import { z } from 'zod';
import type { Evidence, Research } from './schema';
import { unsupportedNames } from './schema';

function sentence(value: string) { return /[.!?…]$/.test(value.trim()) ? value.trim() : `${value.trim()}.`; }

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
export function generatedScriptSchema(evidence: Evidence[], product: string, cadence: StandardStep[], allowedNames: string[] = []) {
  return generatedScriptShape.superRefine((script, context) => {
    const issue = (message: string) => context.addIssue({ code: 'custom', message });
    if (script.producto_principal !== product) issue('Producto principal incorrecto.');
    for (const source of script.fuentes) if (!evidence.some(item => item.id === source)) issue('Fuente desconocida.');
    if (JSON.stringify(script.cadencia.map(({ dia, canal }) => ({ dia, canal }))) !== JSON.stringify(cadence.map(({ dia, canal }) => ({ dia, canal })))) issue('Cadencia distinta de la estándar.');
    const texts = [...Object.values(script.llamada).filter((value): value is string => typeof value === 'string'), ...Object.values(script.llamada.objeciones), ...script.emails.flatMap(email => [email.asunto, email.cuerpo])];
    for (const text of texts) {
      // Los mensajes nombran lo detectado para que la IA lo corrija en el siguiente intento.
      const names = unsupportedNames(text, evidence, allowedNames);
      if (names.length) issue(`Nombre no presente en la ficha: ${names.join(', ')}. Quítalo o usa una expresión genérica.`);
      // Número completo: "20" no vale porque aparezca dentro de "2020".
      for (const number of text.match(/\d+(?:[.,]\d+)*/g) ?? []) {
        const whole = new RegExp(`(^|[^\\d.,])${number.replace(/[.,]/g, '\\$&')}($|[^\\d]|[.,](?!\\d))`);
        if (!evidence.some(item => whole.test(item.text))) issue(`Cifra no documentada: ${number}. Quítala.`);
      }
      if (/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text) || /https?:\/\//i.test(text)) issue('No insertar contactos ni URLs: usa variables.');
    }
    if (texts.some(text => /hip[oó]tesis|no hemos verificado|borrador|revisi[oó]n humana|pendiente de verificar|<[^>]+>/i.test(text))) issue('Hay frases internas o marcadores <...> en el texto para el cliente: reescríbelas.');
    for (const email of script.emails) if (!email.cuerpo.includes('BAJA') || !email.cuerpo.includes('[TELÉFONO]') || !email.cuerpo.includes('[WEB]') || !email.cuerpo.includes('try! company')) issue('Falta identificación, variables o pie de baja.');
  });
}

/** Estructura que se enseña a la IA: las claves y la cadencia exactas, pero sin frases que pueda copiar. */
export function scriptSkeleton(example: GeneratedScript): Record<string, unknown> {
  return {
    producto_principal: example.producto_principal,
    llamada: {
      apertura: '<saludo breve presentándote como el equipo de try! company y pidiendo hablar con el rol decisor de la ficha>',
      motivo: '<por qué llamas a ESTA empresa, citando con naturalidad algo concreto de su actividad o señales de la ficha>',
      pregunta_clave: '<una pregunta abierta sobre el dolor más probable de la ficha>',
      propuesta_valor: '<cómo el producto ayuda en ese dolor: productividad, rentabilidad, menos riesgo o mejores decisiones>',
      objeciones: { precio: '<respuesta>', ya_tenemos_programa: '<respuesta>', no_es_momento: '<respuesta>', envieme_info: '<respuesta>' },
      cierre: '<propuesta concreta de una breve reunión o demostración>',
      mensaje_voz: '<mensaje de buzón breve con motivo y que volverás a llamar>',
    },
    emails: example.emails.map(email => ({ dia: email.dia, asunto: '<asunto corto y concreto para esta empresa, sin sonar a publicidad>', cuerpo: '<cuerpo personalizado (ver instrucciones), terminado en el pie con try! company, [TELÉFONO], [WEB] y la opción BAJA>' })),
    cadencia: example.cadencia,
    fuentes: example.fuentes,
    nota: '<nota interna para el comercial: qué verificar antes de usar el guion>',
  };
}

export function mockScript(company: string, product: string, research: Research, cadence: StandardStep[]): GeneratedScript {
  // El pie va al cliente: identificación, contacto y opción de baja (nada de notas internas).
  const footer = '\n\ntry! company · [TELÉFONO] · [WEB]\nSi prefiere no recibir más comunicaciones nuestras, responda BAJA.';
  return {
    producto_principal: product,
    llamada: {
      apertura: `Buenos días, soy del equipo de try! company. ¿Puedo hablar con la persona responsable de gestión de ${company}?`,
      motivo: `Queremos saber si ${product} podría ayudarles a reducir trabajo manual y mejorar la rentabilidad. ¿Es algo que les preocupa ahora mismo?`,
      pregunta_clave: '¿Qué proceso les quita más tiempo o dificulta tomar decisiones hoy?',
      propuesta_valor: `Podemos valorar ${product} con un diagnóstico de su proceso, sin presuponer necesidades ni prometer cifras.`,
      objeciones: { precio: 'Primero validamos el problema y el retorno antes de hablar de una propuesta.', ya_tenemos_programa: 'Partimos de lo que ya funciona. ¿Qué tarea queda todavía fuera del sistema?', no_es_momento: '¿Cuándo sería oportuno retomar la conversación?', envieme_info: '¿Qué proceso le interesa mejorar para enviar sólo información relevante?' },
      cierre: '¿Le encaja una conversación de diagnóstico para confirmar si podemos ayudar?',
      mensaje_voz: 'Soy del equipo de try! company. Quería consultar una posible mejora de gestión; le enviaré información sólo si procede por su base legal.',
    },
    emails: [1, 6, 15].map((dia, index) => ({ dia, asunto: `${index ? 'Seguimiento: ' : ''}gestión en ${company}`, cuerpo: `Buenos días,\n${sentence(`Queremos explorar si ${product} puede ayudar a mejorar la productividad de ${company}`)} Nos gustaría conocer primero cómo trabajan hoy. ¿Le encaja una conversación breve?${footer}` })),
    cadencia: cadence.map(step => ({ ...step, canal: step.canal as 'email' | 'llamada', accion: step.accion.replace(/\s*\((?:emails?\[\d+\]|llamada)\)/gi, '') })),
    fuentes: research.sources.map(source => source.id), nota: 'Propuesta estimada; confirmar las necesidades y el rol del decisor antes de usar.',
  };
}
