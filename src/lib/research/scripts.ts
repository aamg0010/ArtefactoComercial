import { z } from 'zod';
import type { Evidence, Research } from './schema';
import { unsupportedNames } from './schema';
import { detectSector, sectorPlaybooks } from '../scripts/sector-playbook';

export const normalizeScriptText = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const forbiddenPhrases = ['he notado', 'he visto que', 'nos especializamos', 'soy el equipo', 'somos el equipo', 'quería hacer un seguimiento', 'hacer un seguimiento', 'mi correo anterior', 'espero que se encuentre bien', 'espero que este correo', 'no dude en', 'soluciones innovadoras', 'siguiente nivel', 'sinergia', 'líder', 'optimizar', 'optimización'];
export function companyEvidenceTerms(evidence: Evidence[], companyName = '') {
  const excluded = new Set(normalizeScriptText(`${companyName} empresa gestion company nombre municipio provincia comarca pais actividad sector empleados confirmado datos servicios productos nuestra nuestro desde sobre para`).match(/[a-z]+/g) ?? []);
  return [...new Set(evidence.flatMap(e => normalizeScriptText(e.text).match(/[a-z]{5,}/g) ?? []).filter(w => !excluded.has(w)))];
}

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
export function generatedScriptSchema(evidence: Evidence[], product: string, cadence: StandardStep[], allowedNames: string[] = [], options: { companyName?: string; personNames?: string[]; companyEvidence?: Evidence[] } = {}) {
  return generatedScriptShape.superRefine((script, context) => {
    const issue = (message: string) => context.addIssue({ code: 'custom', message });
    if (script.producto_principal !== product) issue('Producto principal incorrecto.');
    for (const source of script.fuentes) if (!evidence.some(item => item.id === source)) issue('Fuente desconocida.');
    if (JSON.stringify(script.cadencia.map(({ dia, canal }) => ({ dia, canal }))) !== JSON.stringify(cadence.map(({ dia, canal }) => ({ dia, canal })))) issue('Cadencia distinta de la estándar.');
    const texts = [...Object.values(script.llamada).filter((value): value is string => typeof value === 'string'), ...Object.values(script.llamada.objeciones), ...script.emails.flatMap(email => [email.asunto, email.cuerpo])];
    for (const text of texts) {
      const normalized = normalizeScriptText(text);
      for (const phrase of forbiddenPhrases) if (normalized.includes(normalizeScriptText(phrase))) issue(`Frase prohibida: «${phrase}». Quítala y reescribe.`);
      // El nombre de la empresa no es un nombre de persona aunque contenga un apellido (p. ej. «Frutos Secos Gil»).
      const forNames = options.companyName ? normalized.split(normalizeScriptText(options.companyName)).join(' ') : normalized;
      for (const name of (options.personNames ?? []).filter(n => !isOrganizationName(n, options.companyName ?? ''))) {
        const parts = [name, name.split(/\s+/)[0]].filter(v => v.length > 2);
        if (parts.some(p => new RegExp(`(^|[^a-z])${normalizeScriptText(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(forNames))) issue(`No escribas nombres de personas: ${name}. Usa [NOMBRE] solo en el saludo.`);
      }
      // Los mensajes nombran lo detectado para que la IA lo corrija en el siguiente intento.
      const names = unsupportedNames(text, evidence, allowedNames);
      if (names.length) issue(`Nombre no presente en la ficha: ${names.join(', ')}. Quítalo o usa una expresión genérica.`);
      // Número completo: "20" no vale porque aparezca dentro de "2020".
      for (const number of text.match(/\d+(?:[.,]\d+)*/g) ?? []) {
        const whole = new RegExp(`(^|[^\\d.,])${number.replace(/[.,]/g, '\\$&')}($|[^\\d]|[.,](?!\\d))`);
        // Las cifras del nombre de la empresa o de nuestros productos (p. ej. «Talleres 2000») no son datos inventados.
        if (!evidence.some(item => whole.test(item.text)) && !whole.test(allowedNames.join(' '))) issue(`Cifra no documentada: ${number}. Quítala.`);
      }
      if (/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text) || /https?:\/\//i.test(text)) issue('No insertar contactos ni URLs: usa variables.');
    }
    if (texts.some(text => /hip[oó]tesis|no hemos verificado|borrador|revisi[oó]n humana|pendiente de verificar|<[^>]+>/i.test(text))) issue('Hay frases internas o marcadores <...> en el texto para el cliente: reescríbelas.');
    const emailSteps = cadence.filter(s => s.canal === 'email');
    if (JSON.stringify(script.emails.map(e => e.dia)) !== JSON.stringify(emailSteps.map(s => s.dia))) issue('Emails distintos de los pasos de la cadencia.');
    const subjects = script.emails.map(e => normalizeScriptText(e.asunto).trim());
    if (new Set(subjects).size !== subjects.length) issue('Los asuntos deben ser distintos.');
    for (const [index, email] of script.emails.entries()) {
      if (!email.cuerpo.startsWith('Buenos días, [NOMBRE]:')) issue('Usa el saludo Buenos días, [NOMBRE]:');
      if (/\bBAJA\b|\[TELÉFONO\]|\[WEB\]|(?:^|\n)(?:Un saludo|Atentamente|Andrés Martínez)/i.test(email.cuerpo)) issue('Quita firma y pie: se añaden al enviar.');
      const words = email.cuerpo.trim().split(/\s+/).length;
      const [min, max] = [[65, 120], [55, 110], [35, 80], [15, 50]][index];
      if (words < min || words > max) issue(`Email ${index + 1}: ${words} palabras; debe tener entre ${min} y ${max} (incluido margen).`);
      const subjectWords = email.asunto.trim().split(/\s+/).length;
      if (subjectWords < 3 || subjectWords > 7 || /[!¡]|\b[A-ZÁÉÍÓÚÑ]{3,}\b/.test(email.asunto) || /oportunidad|mejore su/.test(normalizeScriptText(email.asunto))) issue(`Asunto del email ${index + 1}: usa de tres a siete palabras sin publicidad ni mayúsculas sostenidas.`);
    }
    const terms = companyEvidenceTerms(options.companyEvidence ?? evidence, options.companyName);
    if (terms.length && !terms.some(t => normalizeScriptText(script.emails[0].cuerpo).includes(t))) issue('Email uno: incluye un término concreto de la evidencia de empresa, además de su nombre.');
  });
}

/** Estructura que se enseña a la IA: las claves y la cadencia exactas, pero sin frases que pueda copiar. */
export function scriptSkeleton(example: GeneratedScript): Record<string, unknown> {
  return {
    producto_principal: example.producto_principal,
    llamada: {
      apertura: '<saludo en primera persona singular desde try! company, pidiendo hablar con el rol decisor>',
      motivo: '<por qué llamas a ESTA empresa, citando con naturalidad algo concreto de su actividad o señales de la ficha>',
      pregunta_clave: '<una pregunta abierta sobre el dolor más probable de la ficha>',
      propuesta_valor: '<cómo el producto ayuda en ese dolor: productividad, rentabilidad, menos riesgo o mejores decisiones>',
      objeciones: { precio: '<respuesta>', ya_tenemos_programa: '<respuesta>', no_es_momento: '<respuesta>', envieme_info: '<respuesta>' },
      cierre: '<propuesta concreta de una breve reunión o demostración>',
      mensaje_voz: '<mensaje de buzón breve con motivo y que volverás a llamar>',
    },
    emails: example.emails.map((email, i) => ({ dia: email.dia, asunto: '<asunto concreto de tres a siete palabras, distinto de los demás>', cuerpo: `<Buenos días, [NOMBRE]: y ${['primer contacto de setenta a ciento diez palabras', 'aporte de valor de sesenta a cien palabras', 'cierre de cuarenta a setenta palabras', 'recordatorio útil muy corto'][i]}, sin firma ni pie>` })),
    cadencia: example.cadencia,
    fuentes: example.fuentes,
    nota: '<nota interna para el comercial: qué verificar antes de usar el guion>',
  };
}

export function mockScript(company: string, product: string, research: Research, cadence: StandardStep[]): GeneratedScript {
  const detail = companyEvidenceTerms(research.sources, company)[0] ?? 'trabajo';
  const manual = sectorPlaybooks[detectSector({ name: company, sector: research.activity.text })];
  const activity = research.activity.status === 'verificado' ? research.activity.text.replace(/[.!?]+$/, '') : detail;
  const angle = (manual.angulos[product] ?? sectorPlaybooks.general.angulos[product] ?? 'Revisar los procesos del trabajo diario.').replace(/[.]$/, '');
  const shortName = company.split(/\s+/).slice(0, 3).join(' ');
  const bodies = [
    `Buenos días, [NOMBRE]:\n\nLa actividad de ${company} está vinculada a ${activity}. Le escribo desde try! company para conocer cómo trabajan en el día a día. ${manual.retos[0]} Con ${product} le propongo ${angle.charAt(0).toLowerCase() + angle.slice(1)}. Puedo revisar con usted qué pasos conviene conectar para reducir errores y tener más control del trabajo, partiendo de lo que ya utiliza su equipo. ¿Le encajaría una llamada breve para valorar juntos si tendría sentido en su empresa?`,
    `Buenos días, [NOMBRE]:\n\nPara valorar ${product}, le propongo partir de una situación de su actividad y recorrerla juntos, desde que llega la información hasta que alguien necesita consultarla. Por ejemplo: ${angle.charAt(0).toLowerCase() + angle.slice(1)}. Revisaría con usted qué datos hacen falta, quién los registra y cómo comprobarlos antes de continuar. Así podría ver el proceso con un ejemplo cercano a su trabajo diario. ¿Prefiere que prepare una demostración con un caso suyo?`,
    `Buenos días, [NOMBRE]:\n\nDejo abierta la conversación sobre ${product} por si más adelante quiere revisar cómo reúnen la información del trabajo diario. Puede responderme cuando le venga bien y lo valoraré con usted. ¿Hay otra persona más adecuada en su empresa con quien pueda hablar de este tema?`,
    `Buenos días, [NOMBRE]:\n\nSi le resulta útil, puedo preparar un ejemplo con un parte de trabajo y su pedido. ¿Qué proceso elegiría para verlo con ${product}?`,
  ];
  return {
    producto_principal: product,
    llamada: {
      apertura: `Buenos días, le llamo desde try! company. ¿Puedo hablar con la persona responsable de gestión de ${company}?`,
      motivo: `Quiero saber si ${product} podría ayudarle a reducir trabajo manual. ¿Es algo que le preocupa ahora mismo?`,
      pregunta_clave: manual.retos[0],
      propuesta_valor: `Con ${product} le propongo ${angle.charAt(0).toLowerCase() + angle.slice(1)}.`,
      objeciones: { precio: 'Primero quiero entender el problema antes de preparar una propuesta.', ya_tenemos_programa: 'Parto de lo que ya funciona. ¿Qué tarea queda todavía fuera del sistema?', no_es_momento: '¿Cuándo sería oportuno retomar la conversación?', envieme_info: '¿Qué proceso le interesa mejorar para enviar sólo información relevante?' },
      cierre: '¿Le encaja una conversación de diagnóstico para confirmar si puedo ayudarle?',
      mensaje_voz: 'Le llamo desde try! company para consultar cómo reúne los partes de trabajo. Volveré a llamarle en otro momento.',
    },
    emails: cadence.filter(s => s.canal === 'email').map((s, index) => ({ dia: s.dia, asunto: [`El trabajo en ${shortName}`, `Un ejemplo para ${shortName}`, `Persona de contacto en ${shortName}`, `El proceso de ${shortName}`][index], cuerpo: bodies[index] })),
    cadencia: cadence.map(step => ({ ...step, canal: step.canal as 'email' | 'llamada', accion: step.accion.replace(/\s*\((?:emails?\[\d+\]|llamada)\)/gi, '') })),
    fuentes: research.sources.map(source => source.id), nota: 'Propuesta estimada; confirmar las necesidades y el rol del decisor antes de usar.',
  };
}

/** Un borrador se reutiliza si es la última versión y ya sigue el marco de emails con saludo [NOMBRE]. */
export function isReusableDraft(script: { status: string; content: unknown }) {
  if (script.status !== 'BORRADOR') return false;
  const parsed = generatedScriptShape.safeParse(script.content);
  return parsed.success && parsed.data.emails.every(email => email.cuerpo.includes('[NOMBRE]'));
}

/** Contactos guardados con el nombre de la empresa o de una organización (p. ej. «Cooperativa Agrícola San Lorenzo») no son personas. */
export function isOrganizationName(name: string, companyName: string) {
  const plain = (value: string) => normalizeScriptText(value).replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const person = plain(name); const company = plain(companyName);
  if (!person) return true;
  if (company && (company.includes(person) || person.includes(company))) return true;
  return /\b(cooperativa|coop|sociedad|s ?l|s ?a|s ?c ?l|sat|ltda|sas|bodegas?|almazaras?|grupo|hermanos|hnos|industrias?|transportes?|suministros?|talleres?|construcciones|empresa|comercial|distribuciones|alimentacion|foods?)\b/.test(person);
}
