import { normalizeText } from '../normalization';

/** Base legal (RGPD art. 6) por la que se puede tratar el dato de un contacto, explicada para el equipo. */
export const legalBasisInfo = {
  LEGITIMATE_INTEREST: { label: 'Interés legítimo', help: 'Contacto profesional de empresa (cargo, email o teléfono corporativo) para ofrecer productos B2B. Es lo habitual en prospección, siempre con opción de BAJA.' },
  CONSENT: { label: 'Consentimiento', help: 'La persona nos ha dado permiso expreso (formulario, feria, tarjeta con autorización…). Apunta cómo y cuándo lo dio.' },
  CONTRACT: { label: 'Cliente / contrato', help: 'Ya hay relación contractual o precontractual (es cliente o nos ha pedido presupuesto).' },
  PENDING: { label: 'Por determinar', help: 'Aún no sabemos con qué base podemos escribirle. Revísalo antes de enviarle emails.' },
} as const;
export type LegalBasisKey = keyof typeof legalBasisInfo;

export const consentLabels = { NOT_REQUIRED: 'No hace falta', PENDING: 'Pendiente', GRANTED: 'Dado', WITHDRAWN: 'Retirado' } as const;

export const sourceLabels: Record<string, string> = {
  'google-places': 'Google Maps', openstreetmap: 'OpenStreetMap', einforma: 'eInforma', rues: 'RUES (cámaras de comercio)', csv: 'Importación CSV', mock: 'Simulada (pruebas)',
};
/** Enlace legible a la fuente; el identificador interno (p. ej. el place_id de Google) no se muestra. */
export function sourceLink(source: string, ref: string, url?: string | null) {
  if (url) return url;
  if (source === 'google-places' && /^[\w-]{10,}$/.test(ref)) return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(ref)}`;
  return null;
}

const digits = (value?: string | null) => (value ?? '').replace(/\D/g, '').replace(/^(34|57)(?=\d{9,10}$)/, '');
/** Un contacto es el mismo si coincide el email, el teléfono o el nombre dentro de la misma empresa. */
export function sameContact(a: { fullName: string; email?: string | null; phone?: string | null }, b: { fullName: string; email?: string | null; phone?: string | null }) {
  if (a.email?.trim() && b.email?.trim() && a.email.trim().toLowerCase() === b.email.trim().toLowerCase()) return true;
  if (digits(a.phone).length >= 7 && digits(a.phone) === digits(b.phone)) return true;
  return normalizeText(a.fullName) === normalizeText(b.fullName);
}
