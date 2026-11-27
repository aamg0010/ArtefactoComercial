export function isDeploymentError(error: unknown): boolean {
  const message = typeof error === 'string' ? error : error instanceof Error ? `${error.name}: ${error.message}` : '';
  return /failed to find server action|failed to (?:fetch|load).*?(?:chunk|dynamically imported module)|loading (?:css )?chunk .*failed|chunkloaderror|older or newer deployment|server action.*(?:not found|was not found|unrecognized)/i.test(message);
}

const reloadKey = 'try-comercial:deployment-reloaded';

export function claimDeploymentReload(storage: Pick<Storage, 'getItem' | 'setItem'>): boolean {
  try {
    if (storage.getItem(reloadKey)) return false;
    storage.setItem(reloadKey, '1');
    return true;
  } catch { return false; }
}

/** Re-arm only after a later action works; never on mount/reload, which could loop. */
export function recordWorkingDeployment(storage: Pick<Storage, 'removeItem'>) {
  try { storage.removeItem(reloadKey); } catch { /* Manual retry remains available. */ }
}

/** Next 14 may answer an unknown action with HTML (even HTTP 200) instead of Flight. */
export function isMissingActionResponse(response: Pick<Response, 'status' | 'headers'>) {
  const type = response.headers.get('content-type') ?? '';
  return !response.headers.has('x-action-redirect') && !type.startsWith('text/x-component') &&
    (response.status === 404 || response.status === 200 && type.startsWith('text/html'));
}
