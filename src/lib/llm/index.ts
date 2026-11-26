import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { setTimeout as wait } from 'node:timers/promises';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { TrygestionClient, trygestionConfiguration } from '../trygestion/client';

type Environment = Record<string, string | undefined>;
export function llmConfiguration(env: Environment = process.env, purpose?: string) {
  const general = env.LLM_PROVIDER || 'mock';
  let requested = purpose === 'script' ? env.SCRIPT_LLM_PROVIDER || general : general;
  let fallback: string | undefined;
  if (purpose === 'script' && requested === 'anthropic' && !env.ANTHROPIC_API_KEY?.trim()) {
    requested = general;
    fallback = 'SCRIPT_ANTHROPIC_KEY_MISSING_FALLBACK_GENERAL';
  }
  if (!['mock', 'anthropic', 'openai', 'trygestion'].includes(requested)) throw new Error('LLM_PROVIDER inválido.');
  const key = requested === 'trygestion' ? (trygestionConfiguration(env).enabled ? env.TRYGESTION_TOKEN : undefined) : requested === 'anthropic' ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY;
  const provider = requested === 'mock' || !key?.trim() ? 'mock' : requested;
  return { provider, key: provider === 'mock' ? undefined : key,
    model: provider === 'mock' ? 'deterministic-v1' : (!fallback && purpose === 'script' ? env.SCRIPT_LLM_MODEL : undefined) || env.LLM_MODEL || (provider === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-4.1-mini'),
    fallback,
    simulated: provider === 'mock' };
}

type Context = {
  db: PrismaClient; companyId: string; purpose: string; mockResponse: unknown;
  env?: Environment; fetcher?: typeof fetch; pause?: (ms: number) => Promise<unknown>;
};
const usageSchema = z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() });
const anthropicSchema = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })), usage: usageSchema.optional() });
const openaiSchema = z.object({ output: z.array(z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() })), usage: usageSchema.optional() });

/** Single JSON interface; domain-specific mock data and audit metadata are bound separately. */
export async function generateJson<Schema extends z.ZodTypeAny>(input: { system: string; prompt: string; schema: Schema }, context: Context): Promise<z.output<Schema>> {
  const configuration = llmConfiguration(context.env, context.purpose);
  const started = Date.now();
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let success = false;
  let errorCode = 'PROVIDER_ERROR';
  // Si un intento no pasa la validación, el siguiente recibe la lista de fallos para corregirlos (sin reenviar datos sensibles).
  let feedback = '';
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        let raw: unknown = context.mockResponse;
        if (configuration.provider === 'trygestion') {
          const result = await new TrygestionClient({ env: context.env, fetcher: context.fetcher }).generarIA({ system: input.system, prompt: input.prompt + feedback, schema: zodToJsonSchema(input.schema, { effectStrategy: 'input', $refStrategy: 'none' }), maxTokens: 4000 });
          configuration.model = result.model;
          inputTokens = (inputTokens ?? 0) + (result.usage?.input_tokens ?? result.usage?.prompt_tokens ?? 0);
          outputTokens = (outputTokens ?? 0) + (result.usage?.output_tokens ?? result.usage?.completion_tokens ?? 0);
          raw = result.json;
        } else if (!configuration.simulated) {
          const anthropic = configuration.provider === 'anthropic';
          const response = await (context.fetcher ?? fetch)(anthropic ? 'https://api.anthropic.com/v1/messages' : 'https://api.openai.com/v1/responses', {
            method: 'POST', signal: AbortSignal.timeout(60_000),
            headers: anthropic ? { 'content-type': 'application/json', 'x-api-key': configuration.key!, 'anthropic-version': '2023-06-01' } : { 'content-type': 'application/json', Authorization: `Bearer ${configuration.key}` },
            body: JSON.stringify(anthropic ? {
              model: configuration.model, max_tokens: 8000, system: input.system,
              messages: [{ role: 'user', content: input.prompt + feedback }],
            } : { model: configuration.model, instructions: input.system, input: input.prompt + feedback, text: { format: { type: 'json_object' } }, max_output_tokens: 6000 }),
          });
          if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP_${response.status}`); }
          const payload: unknown = await response.json();
          const parsed = anthropic ? anthropicSchema.parse(payload) : openaiSchema.parse(payload);
          inputTokens = (inputTokens ?? 0) + (parsed.usage?.input_tokens ?? 0);
          outputTokens = (outputTokens ?? 0) + (parsed.usage?.output_tokens ?? 0);
          const text = 'content' in parsed ? parsed.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('') : parsed.output.flatMap(item => item.content ?? []).filter(block => block.type === 'output_text').map(block => block.text ?? '').join('');
          const actualModel = (payload as { model?: unknown }).model;
          if (typeof actualModel === 'string') configuration.model = actualModel;
          raw = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, ''));
        }
        const result = input.schema.parse(raw);
        success = true;
        return result;
      } catch (error) {
        // Never persist provider bodies, prompts, credentials or Zod input values.
        if (error instanceof z.ZodError) feedback = `\n\nTu respuesta anterior no pasó la validación. Corrige estos puntos y devuelve el JSON completo:\n- ${[...new Set(error.issues.map(issue => `${issue.path.join('.') || 'general'}: ${issue.message}`))].slice(0, 20).join('\n- ')}`;
        errorCode = error instanceof z.ZodError ? 'VALIDATION_ERROR' : error instanceof SyntaxError ? 'INVALID_JSON' : 'PROVIDER_ERROR';
        if (configuration.simulated || attempt === 2) throw new Error(errorCode);
        await (context.pause ?? wait)(1000 * (attempt + 1));
      }
    }
    throw new Error('PROVIDER_ERROR');
  } finally {
    await context.db.aiRun.create({ data: {
      provider: configuration.provider, model: configuration.model, purpose: context.purpose,
      companyId: context.companyId, durationMs: Date.now() - started, inputTokens, outputTokens,
      success, error: success ? configuration.fallback ?? null : [configuration.fallback, errorCode].filter(Boolean).join(':'),
    } });
  }
}
