'use client';
import React, { useEffect, useState } from 'react';
import { claimDeploymentReload, isDeploymentError } from '@/lib/deployment-error';

export function ErrorMessage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [reloading, setReloading] = useState(false);
  useEffect(() => {
    if (!isDeploymentError(error)) return;
    try {
      if (claimDeploymentReload(window.sessionStorage)) {
        setReloading(true);
        // Let the update notice paint before navigating away.
        const timer = window.setTimeout(() => window.location.reload(), 150);
        return () => window.clearTimeout(timer);
      }
    } catch { /* Storage may be unavailable; keep the manual retry. */ }
  }, [error]);
  return <main className="mx-auto max-w-3xl space-y-4 p-5">
    {reloading ? <p role="status">La aplicación se ha actualizado. Recargando…</p> : <>
      <h1>No se pudo completar la operación</h1>
      <p role="alert">Ha ocurrido un problema. Puedes volver a intentarlo.</p>
      <button onClick={reset}>Reintentar</button>
      {error.digest && <p>Referencia para soporte: {error.digest}</p>}
    </>}
  </main>;
}
