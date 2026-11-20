export function normalizeText(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ').trim(); }
export function normalizeDomain(value?: string | null) { if (!value) return null; try { return new URL(value.includes('://') ? value : `https://${value}`).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; } }
