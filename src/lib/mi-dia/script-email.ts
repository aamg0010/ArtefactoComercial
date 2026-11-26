import { z } from 'zod';

export const safeId = z.string().trim().min(1).max(191).regex(/^[\w-]+$/);
export const scriptEmails = z.object({ emails: z.array(z.object({ dia: z.number().int().positive(), asunto: z.string(), cuerpo: z.string() })) });

export function defaultSignature(user?: { signatureName?: string | null; signatureTitle?: string | null } | null) {
  return { nombre: user?.signatureName ?? 'Andrés Martínez', cargo: user?.signatureTitle ?? 'Gerente' };
}
export function personalizeGreeting(body: string, recipient: string, contacts: { email: string | null; fullName: string }[]) {
  const name = contacts.find(c => c.email?.trim().toLowerCase() === recipient.trim().toLowerCase())?.fullName.trim().split(/\s+/)[0];
  return body.replace(/Buenos días,\s*\[NOMBRE\]:/g, name ? `Buenos días, ${name}:` : 'Buenos días:').replaceAll('[NOMBRE]', name ?? '');
}
/** Retira el pie y la firma de guiones antiguos antes de añadirlos una sola vez al enviar. */
export function emailBodyWithoutFooter(body: string) {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex(line => /^(?:try! company\s*[·(]|\[TELÉFONO\]|Un saludo[,.:]?\s*$|Atentamente[,.:]?\s*$|--\s*$|(?:Si prefiere|Para dejar de recibir|Le escribo porque|Responda|BAJA\b).*\bBAJA\b)/i.test(line.trim()));
  return (start < 0 ? body : lines.slice(0, start).join('\n')).trim();
}

export function taskEmail(task: { scriptEmailIndex: number | null; cadenceStep: { dayOffset: number } | null; script: { content: unknown } | null }) {
  const parsed = scriptEmails.safeParse(task.script?.content);
  if (!parsed.success) return undefined;
  return task.scriptEmailIndex !== null
    ? parsed.data.emails[task.scriptEmailIndex]
    : parsed.data.emails.find(email => email.dia === task.cadenceStep?.dayOffset);
}
