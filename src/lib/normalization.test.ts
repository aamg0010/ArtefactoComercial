import { describe, expect, it } from 'vitest';
import { normalizeDomain, normalizeText } from './normalization';
describe('normalización para deduplicación', () => { it('elimina acentos y puntuación', () => expect(normalizeText('  Café, S.L. ')).toBe('cafe s l')); it('obtiene el dominio sin www', () => expect(normalizeDomain('https://www.try.company/contacto')).toBe('try.company')); it('devuelve null ante URL inválida', () => expect(normalizeDomain('no es una URL')).toBeNull()); });
