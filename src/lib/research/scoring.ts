import { z } from 'zod';
import type { Research } from './schema';
import { normalizeText } from '../normalization';

export const defaultWeights = { sector: 25, size: 15, intent: 20, contact: 15, proximity: 15, crossSell: 10 };
export type Weights = typeof defaultWeights;
const weightSchema = z.object({ sector: z.number().nonnegative(), size: z.number().nonnegative(), intent: z.number().nonnegative(), contact: z.number().nonnegative(), proximity: z.number().nonnegative(), crossSell: z.number().nonnegative() }).refine(value => Object.values(value).reduce((a, b) => a + b, 0) > 0, 'Los pesos deben sumar más de cero');
export function calculateScore(research: Research, company: { comarca: string | null; hasContact: boolean }, inputWeights: Weights = defaultWeights) {
  const weights = weightSchema.parse(inputWeights);
  const nearby = ['bajo aragon', 'bajo aragon caspe', 'matarrana', 'bajo martin', 'andorra sierra de arcos', 'cuencas mineras', 'maestrazgo'].includes(normalizeText(company.comarca ?? ''));
  const onsite = research.recommendations.some(item => item.line === 'Soporte técnico');
  const factors = {
    sector: research.factors.sector.value, size: research.factors.size.value, intent: research.factors.intent.value,
    contact: company.hasContact ? 1 : 0, proximity: onsite ? nearby ? 1 : 0.2 : 0.5,
    crossSell: research.recommendations.length > 1 ? 1 : 0,
  };
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  const breakdown = Object.entries(factors).map(([key, value]) => {
    const factor = key as keyof Weights;
    z.number().min(0).max(1).parse(value);
    const reason = factor === 'contact' ? 'Canal de contacto registrado' : factor === 'proximity' ? onsite ? 'Proximidad para soporte in situ' : 'Servicio remoto: factor neutro' : factor === 'crossSell' ? 'Número de líneas recomendadas' : research.factors[factor].reason.text;
    return { factor, value, weight: weights[factor], points: Math.round(value * weights[factor] / sum * 10000) / 100, reason };
  });
  const total = Math.round(breakdown.reduce((a, item) => a + item.points, 0));
  return { total, suggestedPriority: total >= 70 ? 'A' : total >= 40 ? 'B' : 'C', breakdown };
}
