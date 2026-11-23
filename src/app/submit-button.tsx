'use client';
import type { ButtonHTMLAttributes } from 'react';
import { useFormStatus } from 'react-dom';

/**
 * Botón de envío que avisa mientras el servidor trabaja: se desactiva (evita dobles clics)
 * y muestra un texto y, si se indica, un aviso de que puede tardar.
 */
export function SubmitButton({ children, pendingText = 'Procesando…', notice, disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { pendingText?: string; notice?: string }) {
  const { pending, data } = useFormStatus();
  // En formularios con varios botones, solo el pulsado muestra el aviso.
  const mine = pending && (!props.name || data?.get(props.name) === props.value);
  return <>
    <button {...props} type="submit" disabled={disabled || pending} aria-busy={mine}>{mine ? pendingText : children}</button>
    {mine && notice && <p role="status" aria-live="polite" className="mt-2 w-full basis-full rounded-lg bg-try-50 px-3 py-2 text-sm text-try-800">{notice}</p>}
  </>;
}
