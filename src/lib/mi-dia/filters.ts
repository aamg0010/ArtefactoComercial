import { z } from 'zod';
import { madridDate, taskDate } from '../dates';

export const taskTypeLabels = { CALL: 'Llamada', EMAIL: 'Email', FOLLOW_UP: 'Seguimiento' };
export const filtersSchema = z.object({
  buscar: z.string().trim().max(200).catch(''),
  tipo: z.enum(['', 'CALL', 'EMAIL', 'FOLLOW_UP']).catch(''),
  prioridad: z.enum(['', 'A', 'B', 'C', 'NONE']).catch(''),
  pais: z.enum(['', 'ES', 'CO']).catch(''),
  producto: z.string().trim().max(200).catch(''),
  mostrar: z.enum(['', 'overdue', 'today', 'upcoming', 'undated']).catch(''),
  orden: z.enum(['date', 'priority', 'company']).catch('date'),
});
export type DayFilters = z.infer<typeof filtersSchema>;
type FilterTask = {
  id: string; title: string; type: string; dueAt: Date | null;
  company: { name: string; priority: string | null; country: string; city: string | null; region: string | null; opportunities?: { product: { line: string } }[] };
  script: { content: unknown } | null;
};
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
export function productLines(task: FilterTask): string[] {
  const content = task.script?.content;
  const line = content && typeof content === 'object' && 'producto_principal' in content ? content.producto_principal : null;
  return typeof line === 'string' && line.trim() ? [line] : task.company.opportunities?.map(item => item.product.line) ?? [];
}
export function validDay(value: unknown): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isFinite(parsed.getTime()) && taskDate(parsed) === value) return value;
  }
  return madridDate();
}
export function filterTasks<T extends FilterTask>(tasks: readonly T[], filters: DayFilters, day: string): T[] {
  const end = new Date(`${day}T00:00:00.000Z`); end.setUTCDate(end.getUTCDate() + 7);
  const last = taskDate(end)!;
  const rank = (task: T) => ({ A: 0, B: 1, C: 2 }[task.company.priority ?? ''] ?? 3);
  const companyOrder = (a: T, b: T) => a.company.name.localeCompare(b.company.name, 'es', { sensitivity: 'base' });
  const dateOrder = (a: T, b: T) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity);
  return tasks.filter(task => {
    const date = taskDate(task.dueAt);
    return (!filters.buscar || normalize([task.company.name, task.title, task.company.city, task.company.region].filter(Boolean).join(' ')).includes(normalize(filters.buscar)))
      && (!filters.tipo || task.type === filters.tipo)
      && (!filters.prioridad || (filters.prioridad === 'NONE' ? !task.company.priority : task.company.priority === filters.prioridad))
      && (!filters.pais || task.company.country === filters.pais)
      && (!filters.producto || productLines(task).includes(filters.producto))
      && (!filters.mostrar || (filters.mostrar === 'undated' ? !date : filters.mostrar === 'today' ? date === day : filters.mostrar === 'overdue' ? Boolean(date && date < day) : Boolean(date && date > day && date <= last)));
  }).sort((a, b) => (filters.orden === 'priority' ? rank(a) - rank(b) || dateOrder(a, b) : filters.orden === 'company' ? companyOrder(a, b) || dateOrder(a, b) : dateOrder(a, b)) || companyOrder(a, b) || a.id.localeCompare(b.id));
}
