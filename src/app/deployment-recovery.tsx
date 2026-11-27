'use client';
import { useEffect, useState } from 'react';
import { isDeploymentError, isMissingActionResponse, recordWorkingDeployment } from '@/lib/deployment-error';
import { ErrorMessage } from './error-message';

/** Some chunk/action failures bypass React boundaries and surface as rejected promises. */
export function DeploymentRecovery() {
  const [error, setError] = useState<Error>();
  useEffect(() => {
    // Next 14 can swallow a missing action's HTML response without throwing a client error.
    // Observe only action requests; normal navigation and business 404 Flight responses pass through.
    const originalFetch = window.fetch;
    const recoveryFetch: typeof fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      if (method.toUpperCase() === 'POST' && headers.has('Next-Action')) {
        if (isMissingActionResponse(response)) setError(new Error('Failed to find Server Action: older or newer deployment'));
        else if (response.status < 400 && (response.headers.has('x-action-redirect') || response.headers.get('content-type')?.startsWith('text/x-component'))) {
          try { recordWorkingDeployment(window.sessionStorage); } catch { /* Storage may be blocked. */ }
        }
      }
      return response;
    };
    window.fetch = recoveryFetch;
    const handleError = (event: ErrorEvent) => {
      const reason: unknown = event.error ?? event.message;
      if (isDeploymentError(reason)) setError(reason instanceof Error ? reason : new Error(String(reason)));
    };
    const handleRejection = (event: PromiseRejectionEvent) => { if (isDeploymentError(event.reason)) setError(event.reason instanceof Error ? event.reason : new Error(String(event.reason))); };
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);
    return () => {
      if (window.fetch === recoveryFetch) window.fetch = originalFetch;
      window.removeEventListener('error', handleError); window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);
  return error ? <div className="fixed inset-0 z-50 bg-white"><ErrorMessage error={error} reset={() => window.location.reload()}/></div> : null;
}
