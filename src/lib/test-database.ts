/** Validate before creating a client or running a destructive integration hook. */
export function isSafeTestDatabase(testUrl?: string, workUrl?: string): boolean {
  if (!testUrl || testUrl === workUrl) return false;
  try {
    const test = new URL(testUrl);
    if (!['postgres:', 'postgresql:'].includes(test.protocol)) return false;
    if (!decodeURIComponent(test.pathname.slice(1)).endsWith('_test')) return false;
    if (workUrl) {
      const work = new URL(workUrl);
      if (test.hostname === work.hostname &&
          (test.port || '5432') === (work.port || '5432') &&
          test.pathname === work.pathname) return false;
    }
    return true;
  } catch {
    return false;
  }
}
