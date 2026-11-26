import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { generateJson, llmConfiguration } from './index';

function setup() {
  const create = vi.fn().mockResolvedValue({});
  return { create, context: { db: { aiRun: { create } } as unknown as PrismaClient, purpose: 'test', companyId: 'company-test', mockResponse: { ok: true } } };
}
const input = { system: 'Sólo JSON', prompt: 'Información privada que no debe registrarse', schema: z.object({ ok: z.boolean() }) };
it('sin clave usa mock determinista y no hace red', async () => {
  const { context, create } = setup(); const fetcher = vi.fn();
  expect(llmConfiguration({ LLM_PROVIDER: 'anthropic' }).simulated).toBe(true);
  expect(llmConfiguration({ LLM_PROVIDER: 'openai' }).provider).toBe('mock');
  const result = await generateJson(input, { ...context, env: { LLM_PROVIDER: 'openai' }, fetcher });
  expect(result).toEqual({ ok: true }); expect(fetcher).not.toHaveBeenCalled();
  expect(create.mock.calls[0][0].data).toMatchObject({ provider: 'mock', success: true });
});
it.each(['anthropic', 'openai'])('%s usa su API oficial, valida JSON y registra tokens sin secretos', async provider => {
  const { context, create } = setup();
  const payload = provider === 'anthropic' ? { content: [{ type: 'text', text: '{"ok":true}' }], usage: { input_tokens: 5, output_tokens: 3 } } : { output: [{ content: [{ type: 'output_text', text: '{"ok":true}' }] }], usage: { input_tokens: 5, output_tokens: 3 } };
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)));
  await generateJson(input, { ...context, env: { LLM_PROVIDER: provider, LLM_MODEL: 'configured-model', ANTHROPIC_API_KEY: 'test-key', OPENAI_API_KEY: 'test-key' }, fetcher });
  expect(fetcher.mock.calls[0][0]).toBe(provider === 'anthropic' ? 'https://api.anthropic.com/v1/messages' : 'https://api.openai.com/v1/responses');
  expect(create.mock.calls[0][0].data).toMatchObject({ provider, model: 'configured-model', inputTokens: 5, outputTokens: 3, success: true });
  expect(JSON.stringify(create.mock.calls)).not.toContain('test-key'); expect(JSON.stringify(create.mock.calls)).not.toContain(input.prompt);
});
it('hace dos reintentos con espera y registra un error saneado', async () => {
  const { context, create } = setup(); const pause = vi.fn().mockResolvedValue(undefined);
  const fetcher = vi.fn().mockRejectedValue(new Error('secreto y datos privados'));
  await expect(generateJson(input, { ...context, env: { LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key' }, fetcher, pause })).rejects.toThrow('PROVIDER_ERROR');
  expect(fetcher).toHaveBeenCalledTimes(3); expect(pause.mock.calls).toEqual([[1000], [2000]]);
  expect(create.mock.calls[0][0].data).toMatchObject({ success: false, error: 'PROVIDER_ERROR' });
  expect(JSON.stringify(create.mock.calls)).not.toContain('secreto');
});
it('rechaza una respuesta mock que no cumple el schema', async () => {
  const { context, create } = setup();
  await expect(generateJson(input, { ...context, env: { LLM_PROVIDER: 'mock' }, mockResponse: { ok: 'incorrecto' } })).rejects.toThrow('VALIDATION_ERROR');
  expect(create.mock.calls[0][0].data.success).toBe(false);
});

it.each(['{"ok":true}', '  ```json\n{"ok":true}\n```  '])('script usa Anthropic y acepta JSON con o sin bloque', async answer => {
  const { context, create } = setup();
  const env = { LLM_PROVIDER: 'openai', LLM_MODEL: 'general-model', OPENAI_API_KEY: 'test', SCRIPT_LLM_PROVIDER: 'anthropic', SCRIPT_LLM_MODEL: 'sonnet-configured', ANTHROPIC_API_KEY: 'test' };
  expect(llmConfiguration(env, 'research')).toMatchObject({ provider: 'openai', model: 'general-model' });
  const fetcher = vi.fn().mockResolvedValue(Response.json({ model: 'sonnet-real', content: [{ type: 'text', text: answer }] }));
  await generateJson(input, { ...context, purpose: 'script', env, fetcher });
  expect(fetcher.mock.calls[0][0]).toContain('anthropic.com');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ model: 'sonnet-configured', max_tokens: 8000 });
  expect(create.mock.calls[0][0].data).toMatchObject({ provider: 'anthropic', model: 'sonnet-real', success: true });
});
it('sin clave de Anthropic vuelve al general con clave y deja constancia sin usar mock', async () => {
  const { context, create } = setup();
  const fetcher = vi.fn().mockResolvedValue(Response.json({ model: 'general-real', output: [{ content: [{ type: 'output_text', text: '{"ok":true}' }] }] }));
  await generateJson(input, { ...context, purpose: 'script', env: { LLM_PROVIDER: 'openai', LLM_MODEL: 'general', SCRIPT_LLM_PROVIDER: 'anthropic', SCRIPT_LLM_MODEL: 'sonnet', OPENAI_API_KEY: 'test' }, fetcher });
  expect(fetcher.mock.calls[0][0]).toContain('openai.com');
  expect(JSON.parse(fetcher.mock.calls[0][1].body).model).toBe('general');
  expect(create.mock.calls[0][0].data).toMatchObject({ provider: 'openai', model: 'general-real', success: true, error: 'SCRIPT_ANTHROPIC_KEY_MISSING_FALLBACK_GENERAL' });
});
