import { expect, it } from 'vitest';
import { companyInScope, taskInScope } from './engine';

// En producción las empresas de la carga inicial son del administrador del seed, pero sus tareas son de cada comercial.
it('una empresa de otro propietario es mía si tengo tareas asignadas en ella', () => {
  const me = { userId: 'yo', role: 'ADMIN' };
  expect(companyInScope({ ownerId: 'admin-seed', tasks: [{ assigneeId: 'yo' }] }, me)).toBe(true);
  expect(companyInScope({ ownerId: 'admin-seed', tasks: [{ assigneeId: 'otro' }] }, me)).toBe(false);
  expect(companyInScope({ ownerId: 'admin-seed' }, me)).toBe(false);
  expect(companyInScope({ ownerId: null }, me)).toBe(true);
  expect(companyInScope({ ownerId: 'admin-seed' }, { ...me, team: true })).toBe(true);
  // Todos los usuarios (CEO o comercial) pueden ver todo el equipo.
  expect(companyInScope({ ownerId: 'admin-seed' }, { userId: 'yo', role: 'SALES', team: true })).toBe(true);
  expect(taskInScope({ assigneeId: 'otro' }, me)).toBe(false);
  expect(taskInScope({ assigneeId: null }, me)).toBe(true);
});
