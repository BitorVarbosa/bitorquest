// The real client: calls the Claude API straight from the browser with the player's own key.
// There is no server of ours in between; the key never leaves the device except to api.anthropic.com.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { t } from '../../i18n';
import type { TokenUsage } from './models';
import { LlmError, type LlmRequest, type LlmResponse, type SendOptions, type Transport } from './transport';

function usageOf(u: Anthropic.Usage): TokenUsage {
  const created = u.cache_creation_input_tokens ?? 0;
  const h1 = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const m5 = u.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, created - h1);
  return { input: u.input_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite5m: m5, cacheWrite1h: h1, output: u.output_tokens };
}

function textOf(message: Anthropic.Message): string {
  let out = '';
  for (const block of message.content) if (block.type === 'text') out += block.text;
  return out;
}

function refusalOf(message: Anthropic.Message): LlmResponse['refusal'] {
  if (message.stop_reason !== 'refusal') return null;
  const d = message.stop_details as { category?: string | null; explanation?: string | null } | null | undefined;
  return { category: d?.category ?? null, explanation: d?.explanation ?? null };
}

/** Turn the SDK's typed errors into the few cases the interface distinguishes. The messages are shown to the player: in the interface language. */
export function toLlmError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return new LlmError('aborted', t('Stopped.'));
  if (err instanceof Anthropic.APIConnectionError) return new LlmError('offline', t('The request did not reach Anthropic.'));
  if (err instanceof Anthropic.AuthenticationError) return new LlmError('auth', t('The API key was not accepted.'), 401);
  if (err instanceof Anthropic.PermissionDeniedError) return new LlmError('auth', t('This API key is not allowed to do that.'), 403);
  if (err instanceof Anthropic.RateLimitError) {
    const wait = Number(err.headers?.get?.('retry-after'));
    return new LlmError('rate', t('Too many requests for now.'), 429, Number.isFinite(wait) && wait > 0 ? wait : null);
  }
  // An account that cannot be charged: HTTP 402, error type "billing_error".
  if (err instanceof Anthropic.APIError && (err.status === 402 || err.type === 'billing_error')) return new LlmError('credit', t('The account behind this key cannot be charged.'), 402);
  // The service's own words, as it sent them.
  if (err instanceof Anthropic.BadRequestError) return new LlmError('bad_request', err.message, 400);
  if (err instanceof Anthropic.InternalServerError) return new LlmError('overloaded', t('Anthropic’s service is busy or failed.'), err.status);
  if (err instanceof Anthropic.APIError) return new LlmError('other', err.message, typeof err.status === 'number' ? err.status : null);
  return new LlmError('other', err instanceof Error ? err.message : String(err));
}

export function makeClient(apiKey: string): Anthropic {
  return new Anthropic({
    apiKey,
    // Required for use in a browser. The flag exists because a key shipped inside a public site would be
    // exposed to every visitor; here the key is typed in by its owner and stays on their device.
    dangerouslyAllowBrowser: true,
    // One retry at most: a turn must never quietly cost three times what the meter shows.
    maxRetries: 1,
    timeout: 120_000,
  });
}

/** Check a key without spending anything: listing models costs no tokens. Returns the model ids the key can use. */
export async function checkKey(apiKey: string): Promise<string[]> {
  const client = makeClient(apiKey);
  try {
    const ids: string[] = [];
    for await (const m of client.models.list({ limit: 100 })) ids.push(m.id);
    return ids;
  } catch (err) {
    throw toLlmError(err);
  }
}

export function anthropicTransport(apiKey: string): Transport {
  const client = makeClient(apiKey);
  return {
    simulated: false,
    async send(req: LlmRequest, opts: SendOptions = {}): Promise<LlmResponse> {
      try {
        if (req.schema) {
          // Structured output: the answer is constrained to the schema and validated on arrival.
          const message = await client.messages.parse(
            { ...req.params, output_config: { ...req.params.output_config, format: zodOutputFormat(req.schema) } },
            // A step of world building writes a few thousand tokens in one answer: give it longer than a turn gets.
            { signal: opts.signal, ...(req.role === 'architect' ? { timeout: 300_000 } : {}) },
          );
          return {
            text: textOf(message), parsed: message.parsed_output ?? null, usage: usageOf(message.usage),
            model: message.model, stop: message.stop_reason, refusal: refusalOf(message), simulated: false,
          };
        }
        const stream = client.messages.stream(req.params, { signal: opts.signal });
        if (opts.onText) stream.on('text', opts.onText);
        const message = await stream.finalMessage();
        return {
          text: textOf(message), parsed: null, usage: usageOf(message.usage),
          model: message.model, stop: message.stop_reason, refusal: refusalOf(message), simulated: false,
        };
      } catch (err) {
        throw toLlmError(err);
      }
    },
  };
}
