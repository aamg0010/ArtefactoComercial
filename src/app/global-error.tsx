'use client';
import { ErrorMessage } from './error-message';
export default function GlobalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="es"><body><ErrorMessage {...props}/></body></html>;
}
