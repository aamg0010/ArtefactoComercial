import { describe, expect, it } from 'vitest';
import { calculateScore, defaultWeights } from './scoring';
import { mockResearch, researchSchema, type Evidence } from './schema';

const evidence: Evidence[] = [{ id: 'crm', url: 'urn:company:test', date: '2026-11-21T00:00:00.000Z', text: 'Empresa industrial · Industria · Bajo Aragón' }];
const report = () => mockResearch(evidence, 'Industria', ['Soporte técnico', 'Athenea'], 'Sin web');
describe('puntuación determinista', () => {
  it.each([[0, 'C'], [0.39, 'C'], [0.4, 'B'], [0.69, 'B'], [0.7, 'A'], [1, 'A']])('clasifica el factor %s como %s en los umbrales exactos', (value, priority) => {
    const data = report(); data.factors.sector.value = Number(value);
    const score = calculateScore(data, { comarca: null, hasContact: false }, { sector: 100, size: 0, intent: 0, contact: 0, proximity: 0, crossSell: 0 });
    expect(score.total).toBe(Math.round(Number(value) * 100)); expect(score.suggestedPriority).toBe(priority);
  });
  it('pondera los seis factores, normaliza los pesos y conserva el desglose', () => {
    const data = report();
    const input = { comarca: 'Bajo Aragón', hasContact: true };
    const score = calculateScore(data, input);
    expect(score.total).toBe(68); expect(score.breakdown).toHaveLength(6);
    const doubled = calculateScore(data, input, Object.fromEntries(Object.entries(defaultWeights).map(([key, value]) => [key, value * 2])) as typeof defaultWeights);
    expect(doubled.total).toBe(score.total);
    expect(doubled.breakdown.map(item => item.points)).toEqual(score.breakdown.map(item => item.points));
    expect(data.factors.sector.value).toBe(0.8);
  });
  it('favorece Bajo Aragón y comarcas vecinas sólo para soporte in situ', () => {
    expect(calculateScore(report(), { comarca: 'Matarraña', hasContact: true }).total).toBeGreaterThan(calculateScore(report(), { comarca: 'Lejana', hasContact: true }).total);
    const data = report(); data.recommendations = data.recommendations.filter(item => item.line !== 'Soporte técnico');
    expect(calculateScore(data, { comarca: 'Matarraña', hasContact: true }).total).toBe(calculateScore(data, { comarca: 'Lejana', hasContact: true }).total);
  });
  it('rechaza pesos negativos o todos nulos', () => {
    expect(() => calculateScore(report(), { comarca: null, hasContact: false }, { ...defaultWeights, sector: -1 })).toThrow();
    expect(() => calculateScore(report(), { comarca: null, hasContact: false }, { sector: 0, size: 0, intent: 0, contact: 0, proximity: 0, crossSell: 0 })).toThrow();
  });
  it('el factor contacto sin canal directo vale cero y lo explica', () => {
    const score = calculateScore(report(), { comarca: null, hasContact: false });
    expect(score.breakdown.find(item => item.factor === 'contact')).toMatchObject({ value: 0, points: 0, reason: 'Sin canal de contacto directo' });
    const withContact = calculateScore(report(), { comarca: null, hasContact: true });
    expect(withContact.breakdown.find(item => item.factor === 'contact')).toMatchObject({ value: 1, reason: 'Canal de contacto directo registrado' });
  });
});

describe('validación de evidencias', () => {
  const schema = researchSchema(evidence, ['Soporte técnico', 'Athenea']);
  it('acepta datos citados y estimaciones identificadas', () => { expect(schema.safeParse(report()).success).toBe(true); });
  it('rechaza una respuesta sin fuentes', () => { const data = report(); data.sources = []; expect(schema.safeParse(data).success).toBe(false); });
  it('rechaza un nombre de persona ausente de las fuentes incluso como estimado', () => {
    const data = { ...report(), decisionMakerRole: { text: 'Juan Inventado', status: 'estimado', sources: [] } };
    expect(schema.safeParse(data).success).toBe(false);
    const other = report(); other.pains.push({ text: 'Juan Inventado gestiona compras', status: 'estimado', sources: [] });
    expect(schema.safeParse(other).success).toBe(false);
  });
  it('rechaza cifras inventadas, citas falsas y hechos sin evidencia literal', () => {
    const data = report(); data.size = { text: '99999 empleados', status: 'estimado', sources: [] }; expect(schema.safeParse(data).success).toBe(false);
    data.size = { text: 'Industria', status: 'verificado', sources: ['inventada'] }; expect(schema.safeParse(data).success).toBe(false);
    data.size = { text: 'Tiene mucha plantilla', status: 'verificado', sources: ['crm'] }; expect(schema.safeParse(data).success).toBe(false);
  });
});
