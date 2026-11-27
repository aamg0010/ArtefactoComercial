import { afterEach, expect, it, vi } from 'vitest';
import { displayCompanyName, hasLiveCompanyName, liveCompanyNames } from './live-names';

const company = (id = '1') => ({ id, name: `Empresa detectada · Constructoras Bajo Aragón · ChIJ${id}`, acceptanceStatus: 'PENDING', sourceIdentities: [{ source: 'google-places', sourceRef: `real-${id}` }] });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

it('usa la identidad real, deduplica y no modifica los datos recibidos', async () => {
  const rows = [company(), { ...company(), id: 'duplicate' }];
  const before = structuredClone(rows);
  const read = vi.fn().mockResolvedValue('Constructora real');
  const names = await liveCompanyNames(rows, { apiKey: 'fake', read });
  expect(read).toHaveBeenCalledTimes(1);
  expect(read.mock.calls[0][0]).toBe('real-1');
  expect(displayCompanyName(rows[0], names)).toBe('Constructora real');
  expect(hasLiveCompanyName(rows[0], names)).toBe(true);
  expect(rows).toEqual(before);
  const legacy = { ...company(), sourceIdentities: [] };
  await liveCompanyNames([legacy], { apiKey: 'fake', read });
  expect(read.mock.calls[1][0]).toBe('ChIJ1');
});

it('limita las consultas a 60 y la concurrencia a seis, aislando rechazos', async () => {
  let active = 0; let peak = 0;
  const read = vi.fn(async (id: string) => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    if (id === 'real-3') throw new Error('unavailable');
    return 'Nombre real';
  });
  const names = await liveCompanyNames(Array.from({ length: 90 }, (_, i) => company(String(i))), { apiKey: 'fake', read });
  expect(peak).toBe(6); expect(read).toHaveBeenCalledTimes(60);
  expect(names.size).toBe(59); expect(names.has('3')).toBe(false);
});

it('sin clave no consulta y los errores dejan el respaldo disponible', async () => {
  vi.stubEnv('GOOGLE_PLACES_API_KEY', '');
  const read = vi.fn().mockRejectedValue(new Error('offline'));
  expect((await liveCompanyNames([company()], { read })).size).toBe(0);
  expect(read).not.toHaveBeenCalled();
  expect((await liveCompanyNames([company()], { apiKey: 'fake', read })).size).toBe(0);
});

it('a los tres segundos aborta, conserva resultados y no inicia más consultas ni muta el resultado después', async () => {
  vi.useFakeTimers();
  let finish!: (name: string) => void;
  const read = vi.fn((id: string) => id === 'real-0' ? Promise.resolve('Disponible') : new Promise<string>(resolve => { finish = resolve; }));
  const result = liveCompanyNames(Array.from({ length: 70 }, (_, i) => company(String(i))), { apiKey: 'fake', read });
  await vi.advanceTimersByTimeAsync(3000);
  const names = await result;
  expect(names.size).toBe(1); expect(names.get('0')).toBe('Disponible');
  expect(read).toHaveBeenCalledTimes(7);
  expect(read.mock.calls[0]).toBeDefined();
  finish('Demasiado tarde'); await Promise.resolve();
  expect(names.size).toBe(1); expect(read).toHaveBeenCalledTimes(7);
});

it('muestra el perfil como respaldo y nunca un código ChIJ, incluso en nombres anómalos', () => {
  expect(displayCompanyName(company())).toBe('Pendiente de verificar · Constructoras Bajo Aragón');
  expect(displayCompanyName({ id: 'ok', name: 'Empresa confirmada', acceptanceStatus: 'ACCEPTED' }, new Map([['ok', 'Otro nombre']]))).toBe('Empresa confirmada');
  for (const name of ['ChIJabc', 'Empresa ChIJabc confirmada', 'Empresa detectada · Perfil ChIJxyz · ChIJabc']) {
    expect(displayCompanyName({ id: 'bad', name })).not.toContain('ChIJ');
  }
  expect(displayCompanyName(company(), new Map([['1', 'Nombre ChIJabc']]))).not.toContain('ChIJ');
});
