// NanoGPT: one OpenAI-style API in front of hundreds of models, open and closed, uncensored ones among
// them. Called from the browser with the player's own NanoGPT key (openai.ts does the calling).
//
// NanoGPT passes most requests on to the company that runs the model. Its "Private/TEE" models run in
// sealed hardware; "Private providers only" asks it to use only providers that keep nothing.
import { gameModelId, type ModelInfo } from './models';
import { LlmError } from './transport';
import { t } from '../../i18n';
import { nearestEffort, openaiTransport, type Adapter, type ConnectionOptions, type Deps } from './openai';
import type { Transport } from './transport';

export const NANO_BASE = 'https://nano-gpt.com/api';

export const nanoAdapter: Adapter = {
  service: 'nanogpt',
  url: `${NANO_BASE}/v1/chat/completions`,
  // NanoGPT can blank out what looks like personal details before the model sees it (an account setting);
  // in a story that would take names out of the scene, so the game asks it not to.
  headers: (key) => ({ 'content-type': 'application/json', authorization: `Bearer ${key}`, redaction: 'false' }),
  extra(model, think, opts) {
    const efforts = model.efforts ?? [];
    const out: Record<string, unknown> = {};
    if (model.thinks) {
      if (think.off && efforts.includes('none')) out.reasoning_effort = 'none';
      else {
        // A model that cannot stop thinks as little as it lists: the effort asked for, or the nearest it has.
        const effort = nearestEffort(think.off ? 'minimal' : think.effort ?? 'low', efforts);
        if (effort) out.reasoning_effort = effort;
      }
      // Its thinking is never shown, so it is not sent back either.
      out.reasoning = { exclude: true };
    }
    if (opts.privateOnly) out.provider = { zdr: true };
    return out;
  },
  jsonMode: () => false,
  // The exact charge, when NanoGPT gives it in dollars (it may give it in its own currency, Nano, instead).
  cost(usage) {
    const currency = typeof usage.currency === 'string' ? usage.currency.toUpperCase() : 'USD';
    if (currency !== 'USD') return undefined;
    const c = usage.cost ?? usage.estimated_cost;
    return typeof c === 'number' ? c : typeof c === 'string' && c.trim() ? Number(c) : undefined;
  },
  special(status, code) {
    if (code === 'zdr_provider_required' || code === 'zero_data_retention') {
      return new LlmError('bad_request', t('No provider of this NanoGPT model promises to keep nothing. Choose another model, or turn off “Private providers only”.'), status, null, 'nanogpt');
    }
    return null;
  },
};

export function nanoTransport(key: string, opts: ConnectionOptions, deps: Deps = {}): Transport {
  return openaiTransport(nanoAdapter, key, opts, deps);
}

// ---------- The key and the list of models ----------

/** Check a key without spending anything: it asks for the account's balance. Returns the balance in dollars, when the service says. */
export async function checkNanoKey(key: string, deps: Deps = {}): Promise<number | null> {
  const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let res: Response;
  try {
    res = await doFetch(`${NANO_BASE}/check-balance`, { method: 'POST', headers: { 'x-api-key': key } });
  } catch {
    throw new LlmError('offline', t('The request did not reach {service}.', { service: 'NanoGPT' }), null, null, 'nanogpt');
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new LlmError('auth', t('{service} did not accept the key.', { service: 'NanoGPT' }), res.status, null, 'nanogpt');
    if (res.status === 429) throw new LlmError('rate', t('Too many requests for now.'), res.status, Number(res.headers.get('retry-after')) || null, 'nanogpt');
    throw new LlmError('other', t('The key could not be checked (error {status}). Try again.', { status: res.status }), res.status, null, 'nanogpt');
  }
  try {
    const body = (await res.json()) as { usd_balance?: string | number; balance?: string | number };
    const usd = Number(body.usd_balance ?? body.balance);
    return Number.isFinite(usd) ? usd : null;
  } catch {
    return null;
  }
}

interface RawModel {
  id: string;
  name?: string;
  description?: string;
  category?: string;
  context_length?: number | null;
  max_output_tokens?: number | null;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  capabilities?: { reasoning?: boolean; structured_output?: boolean; vision?: boolean };
  reasoning_efforts?: string[];
  pricing?: { prompt?: number; completion?: number; cacheReadInputPer1kTokens?: number };
  available?: boolean;
}

/** One entry of NanoGPT's list as the game keeps it, or null for a model that does not write text or has no price. */
export function nanoModelOf(m: RawModel): ModelInfo | null {
  const out = m.architecture?.output_modalities;
  const inp = m.architecture?.input_modalities;
  if (m.available === false) return null;
  if (out && !(out.length === 1 && out[0] === 'text')) return null;
  if (inp && !inp.includes('text')) return null;
  const p = m.pricing;
  if (!p || typeof p.prompt !== 'number' || typeof p.completion !== 'number') return null;
  const thinks = !!m.capabilities?.reasoning;
  const efforts = m.reasoning_efforts ?? [];
  return {
    id: gameModelId('nanogpt', m.id),
    label: m.name || m.id,
    input: p.prompt,
    output: p.completion,
    // The list gives the cache price per thousand tokens.
    cacheRead: typeof p.cacheReadInputPer1kTokens === 'number' ? p.cacheReadInputPer1kTokens * 1000 : p.prompt,
    thinkingOff: !thinks || efforts.includes('none') ? { type: 'disabled' } : null,
    structured: !!m.capabilities?.structured_output,
    vision: !!m.capabilities?.vision || !!inp?.includes('image'),
    thinks,
    efforts,
    privacy: m.category === 'Private/TEE' ? 'private' : 'passed-on',
    context: m.context_length ?? null,
    maxOutput: m.max_output_tokens ?? null,
    description: m.description ?? '',
    category: m.category ?? '',
  };
}

/** The models that write text, with their prices. The list is public: no key is needed to read it. */
export async function listNanoModels(deps: Deps = {}): Promise<ModelInfo[]> {
  const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let res: Response;
  try {
    res = await doFetch(`${NANO_BASE}/v1/models?detailed=true`);
  } catch {
    throw new LlmError('offline', t('The request did not reach {service}.', { service: 'NanoGPT' }), null, null, 'nanogpt');
  }
  if (!res.ok) throw new LlmError('other', t('The list of models could not be read.'), res.status, null, 'nanogpt');
  const body = (await res.json()) as { data?: RawModel[] };
  return (body.data ?? []).map(nanoModelOf).filter((m): m is ModelInfo => !!m);
}
