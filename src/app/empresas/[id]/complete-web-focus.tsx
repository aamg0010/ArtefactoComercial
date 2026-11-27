'use client';
import { useEffect } from 'react';

/** Server Action redirects do not consistently scroll to their hash in Next 14. */
export function CompletionFocus() {
  useEffect(() => { document.getElementById('datos-completados')?.scrollIntoView({ block: 'start' }); }, []);
  return null;
}
