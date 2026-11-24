import { z } from 'zod';

export const safeId = z.string().trim().min(1).max(191).regex(/^[\w-]+$/);
export const scriptEmails = z.object({ emails: z.array(z.object({ dia: z.number().int().positive(), asunto: z.string(), cuerpo: z.string() })) });

export function taskEmail(task: { scriptEmailIndex: number | null; cadenceStep: { dayOffset: number } | null; script: { content: unknown } | null }) {
  const parsed = scriptEmails.safeParse(task.script?.content);
  if (!parsed.success) return undefined;
  return task.scriptEmailIndex !== null
    ? parsed.data.emails[task.scriptEmailIndex]
    : parsed.data.emails.find(email => email.dia === task.cadenceStep?.dayOffset);
}
