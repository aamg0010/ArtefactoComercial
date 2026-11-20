import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
describe('datos iniciales', () => {
  it('contiene exactamente 56 prospectos y cinco guiones', async () => {
    const prospects = JSON.parse(await readFile('data/prospectos.json', 'utf8')) as unknown[];
    const scripts = JSON.parse(await readFile('data/guiones.json', 'utf8')) as { guiones: unknown[] };
    expect(prospects).toHaveLength(56);
    expect(scripts.guiones).toHaveLength(5);
  });
});
