'use client';
export function CopyButton({ subject, body }: { subject: string; body: string }) { return <button type="button" onClick={() => navigator.clipboard.writeText(`Asunto: ${subject}\n\n${body}`)}>Copiar</button>; }
