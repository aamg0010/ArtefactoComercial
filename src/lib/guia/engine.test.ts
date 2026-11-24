import { describe, expect, it } from 'vitest';
import { buildGuide, closedCycle, GROUPS, REMINDER_TITLE, STALLED_DAYS, type GuideCompany, type GuideTask } from './engine';

const now = new Date('2026-11-23T23:30:00Z'); // 24 de noviembre en Madrid
const scope = { userId: 'sales-legible', role: 'SALES' };
const company = (extra: Partial<GuideCompany> = {}): GuideCompany => ({ id: 'empresa-legible', name: 'Empresa', ownerId: null, acceptanceStatus: 'ACCEPTED', pipelineStage: 'CONTACTING', createdAt: new Date('2026-11-01'), tasks: [], activities: [], emailReplies: [], cadences: [], researchReports: [], scripts: [], suppressions: [], ...extra });
const task = (extra: Partial<GuideTask> = {}): GuideTask => ({ id: 'tarea-legible', title: 'Llamar', type: 'CALL', status: 'PENDING', assigneeId: null, dueAt: new Date('2026-11-24'), completedAt: null, result: null, companyCadenceId: null, cadenceStep: null, ...extra });
const items = (c: GuideCompany, group: string) => buildGuide([c], scope, now).groups.find(g => g.id === group)!.items;
const closed = () => company({ cadences: [{ id: 'ciclo', status: 'ACTIVE' }], tasks: [task({ type: 'EMAIL', status: 'COMPLETED', companyCadenceId: 'ciclo', cadenceStep: { dayOffset: 15, action: 'Email de cierre de ciclo' }, completedAt: new Date('2026-11-23T12:00Z'), result: 'No contesta' })] });

describe('motor puro de la guía diaria', () => {
  it('devuelve los nueve grupos por prioridad y cuenta los importantes', () => {
    const result = buildGuide([company()], scope, now);
    expect(result.groups.map(g => g.id)).toEqual(GROUPS.map(g => g[0]));
    expect(result.important).toBe(1); // sin próximo paso
    expect(result.groups.find(g => g.id === 'prepare')!.count).toBe(1);
  });
  it('usa el día de Madrid y fechas de tarea sin conversión de zona', () => {
    const c = company({ tasks: [task()] });
    expect(buildGuide([c], scope, new Date('2026-11-23T22:59:59Z')).groups.find(g => g.id === 'tomorrow')!.count).toBe(1);
    expect(buildGuide([c], scope, now).day).toBe('2026-11-24');
    expect(items(c, 'today')).toHaveLength(1);
    expect(buildGuide([c], scope, new Date('2026-03-28T23:30Z')).day).toBe('2026-03-29');
    expect(buildGuide([c], scope, new Date('2026-10-24T22:30Z')).day).toBe('2026-10-25');
  });
  it('muestra respuestas NEW también sin empresa; HANDLED cuenta como respuesta al ciclo', () => {
    const c = closed();
    c.emailReplies = [{ id: 'respuesta', status: 'NEW', subject: 'Re: Hola', receivedAt: now }];
    expect(items(c, 'replies')).toHaveLength(1);
    expect(items(c, 'closed')).toHaveLength(0);
    c.emailReplies[0].status = 'HANDLED';
    expect(items(c, 'replies')).toHaveLength(0);
    expect(closedCycle(c, 'ciclo')).toBeNull();
    expect(buildGuide([], scope, now, undefined, [{ id: 'sin-vincular', subject: 'Respuesta' }]).important).toBe(1);
  });
  it('rotula Día N, días de retraso, vista previa y orden estable', () => {
    const c = company({ tasks: [task({ id: 'vencida', dueAt: new Date('2026-11-20') }), task({ id: 'dia6', cadenceStep: { dayOffset: 6, action: 'Email de seguimiento 1' } }), task({ id: 'dia15', cadenceStep: { dayOffset: 15, action: 'Email de cierre de ciclo; si no responde' } }), task({ id: 'mañana', dueAt: new Date('2026-11-25') })] });
    expect(items(c, 'overdue')[0].reason).toBe('Vencida hace 4 días');
    expect(items(c, 'today').map(t => t.title)).toEqual(['Día 15 · Email de cierre de ciclo', 'Día 6 · Email de seguimiento 1']);
    expect(items(c, 'tomorrow')).toHaveLength(1);
  });
  it('comprueba propietario y asignación; todo el equipo es exclusivo de ADMIN', () => {
    const c = company({ ownerId: 'otro', tasks: [task({ assigneeId: 'otro' })] });
    expect(items(c, 'today')).toHaveLength(0);
    expect(buildGuide([c], { ...scope, team: true }, now).important).toBe(0);
    expect(buildGuide([c], { ...scope, role: 'ADMIN', team: true }, now).groups.find(g => g.id === 'today')!.count).toBe(1);
    c.ownerId = null;
    expect(items(c, 'today')).toHaveLength(0);
    expect(items(c, 'next')).toHaveLength(0); // una tarea de otro comercial también es próximo paso
    c.tasks[0].assigneeId = null;
    expect(items(c, 'today')).toHaveLength(1);
  });
  it('aplica exactamente el umbral de paradas y considera actividad y tareas completadas', () => {
    expect(STALLED_DAYS).toBe(14);
    const c = company({ createdAt: new Date('2026-11-10') });
    expect(items(c, 'stalled')).toHaveLength(1);
    c.activities = [{ createdAt: new Date('2026-11-11'), result: null }];
    expect(items(c, 'stalled')).toHaveLength(0);
    c.activities = []; c.tasks = [task({ status: 'COMPLETED', completedAt: new Date('2026-11-23') })];
    expect(items(c, 'stalled')).toHaveLength(0);
  });
  it('detecta día 15 cerrado y excluye positivos, pausas, bajas y etapas terminales', () => {
    expect(items(closed(), 'closed')).toHaveLength(1);
    for (const result of ['Interesado', 'Contactado', 'Reunión agendada']) {
      const c = closed(); c.activities = [{ result, createdAt: now }];
      expect(items(c, 'closed')).toHaveLength(0);
      c.activities = []; c.tasks[0].result = result;
      expect(items(c, 'closed')).toHaveLength(0);
    }
    for (const extra of [{ pipelineStage: 'WON' }, { pipelineStage: 'LOST' }, { suppressions: [{ id: 'baja' }] }, { acceptanceStatus: 'DISCARDED' }, { cadences: [{ id: 'ciclo', status: 'PAUSED' }] }]) expect(items({ ...closed(), ...extra }, 'closed')).toHaveLength(0);
  });
  it('separa recordatorios vencidos de las vencidas normales', () => {
    const c = company({ tasks: [task({ title: REMINDER_TITLE, companyCadenceId: 'ciclo', dueAt: new Date('2026-11-23') })] });
    expect(items(c, 'reminders')).toHaveLength(1);
    expect(items(c, 'overdue')).toHaveLength(0);
  });
  it('cuenta preparación por empresa sin listas largas ni doble cómputo', () => {
    const cs = [company(), company({ id: 'b', researchReports: [{ id: 'r' }] }), company({ id: 'c', researchReports: [{ id: 'r' }], scripts: [{ status: 'BORRADOR' }] })];
    const g = buildGuide(cs, scope, now);
    expect(g.preparation).toEqual({ research: 1, script: 1, approval: 1 });
    expect(g.groups.at(-1)).toMatchObject({ count: 3, items: [] });
  });
});
