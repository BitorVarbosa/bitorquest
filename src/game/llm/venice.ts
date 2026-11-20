// Venice: an OpenAI-style API whose own models keep nothing of what is sent to them. Called from the
// browser with the player's own Venice key (openai.ts does the calling).
//
// Venice lists every model as "private" (it runs the model and keeps nothing) or "anonymized" (it
// passes the text on to the company that runs the model, without saying who sent it). With "Venice's
// own models only" on, the game offers and sends to private models only. A key created at Venice with
// "private models only" refuses the others itself. Its E2EE models need the text encrypted on the
// device first, which the game does not do: they are left out.
import { gameModelId, type ModelInfo } from './models';
import { LlmError, type Transport } from './transport';
import { t } from '../../i18n';
import { nearestEffort, openaiTransport, type Adapter, type ConnectionOptions, type Deps } from './openai';

export const VENICE_BASE = 'https://api.venice.ai/api/v1';

export const veniceAdapter: Adapter = {
  service: 'venice',
  url: `${VENICE_BASE}/chat/completions`,
  headers: (key) => ({ 'content-type': 'application/json', authorization: `Bearer ${key}` }),
  extra(model, think, _opts, req) {
    const efforts = model.efforts ?? [];
    const out: Record<string, unknown> = {
      // Venice adds a system prompt of its own to every request unless told not to; the game's instructions stand alone.
      venice_parameters: { include_venice_system_prompt: false },
      // Venice caches the start of a request by itself; the same key for the same role sends it to a server that has it warm.
      prompt_cache_key: `bq-${req.role}`,
    };
    if (model.thinks) {
      if (think.off && efforts.includes('none')) {
        // Only a model that lists "none" can be stopped: the others think whatever is sent (Venice says so).
        out.reasoning_effort = 'none';
        // And Venice's older switches, which it still honours: no thinking, and none left in the text.
        out.venice_parameters = { include_venice_system_prompt: false, disable_thinking: true, strip_thinking_response: true };
      } else {
        // A model that cannot stop thinks as little as it lists: the effort asked for, or the nearest it has.
        const effort = nearestEffort(think.off ? 'minimal' : think.effort ?? 'low', efforts);
        if (effort) out.reasoning_effort = effort;
        out.venice_parameters = { include_venice_system_prompt: false, strip_thinking_response: true };
      }
    }
    return out;
  },
  // Every Venice model that is offered can be held to a schema or is told the shape in words; JSON mode is not needed.
  jsonMode: () => false,
  // Venice reports what each call cost, beside the usage in the last chunk, in dollars and in its own DIEM.
  cost(usage) {
    const c = usage.cost as { usd?: unknown } | number | undefined;
    const usd = typeof c === 'object' && c ? Number(c.usd) : typeof c === 'number' ? c : NaN;
    return Number.isFinite(usd) ? usd : undefined;
  },
  // "Venice's own models only": an anonymized model is never sent to, whatever was chosen earlier.
  refuse(model, opts) {
    if (!opts.privateOnly || model.privacy === 'private') return null;
    return new LlmError('bad_request', t('{model} is not one of Venice’s own models: Venice passes what is sent to it on to another company, and “Venice’s own models only” is on. Choose a private model, or turn that off.', { model: model.label }), null, null, 'venice', 'not-sent');
  },
  special(status, code, message) {
    // A model only Venice Pro accounts may use: a choice of model to make again, not a key that stopped working.
    if (/PRO_ONLY/i.test(code) || /\bpro\b.*\b(only|subscription|plan)\b/i.test(message)) {
      return new LlmError('bad_request', t('Only Venice Pro accounts may use this model. Choose another model in Settings.'), status, null, 'venice');
    }
    // A key made "private models only" asked for another model.
    if (status === 403 && /privacy|private/i.test(`${code} ${message}`)) {
      return new LlmError('bad_request', t('This Venice key accepts only private models. Choose a private model, or another key.'), status, null, 'venice');
    }
    return null;
  },
};

export function veniceTransport(key: string, opts: ConnectionOptions, deps: Deps = {}): Transport {
  return openaiTransport(veniceAdapter, key, opts, deps);
}

// ---------- The key and the list of models ----------

/** Check a key without spending anything: Venice's own way, which reports the balance. Returns it in dollars, when Venice says. */
export async function checkVeniceKey(key: string, deps: Deps = {}): Promise<number | null> {
  const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let res: Response;
  try {
    res = await doFetch(`${VENICE_BASE}/api_keys/rate_limits`, { headers: { authorization: `Bearer ${key}` } });
  } catch {
    throw new LlmError('offline', t('The request did not reach {service}.', { service: 'Venice' }), null, null, 'venice');
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new LlmError('auth', t('{service} did not accept the key.', { service: 'Venice' }), res.status, null, 'venice');
    if (res.status === 429) throw new LlmError('rate', t('Too many requests for now.'), res.status, Number(res.headers.get('retry-after')) || null, 'venice');
    throw new LlmError('other', t('The key could not be checked (error {status}). Try again.', { status: res.status }), res.status, null, 'venice');
  }
  try {
    const body = (await res.json()) as { data?: { accessPermitted?: boolean; balances?: Record<string, unknown> } };
    const b = body.data?.balances ?? {};
    if (body.data?.accessPermitted === false) throw new LlmError('credit', t('This Venice key may not be used right now: check its limits and its balance at Venice.'), 402, null, 'venice');
    // What can pay, in dollars: the balance and any bundled credits. DIEM is Venice's own daily allowance,
    // not dollars: with only DIEM left there is no dollar figure to show.
    const usd = Number(b.USD ?? b.usd ?? 0) + Number(b.BUNDLED_CREDITS ?? 0);
    const diem = Number(b.DIEM ?? 0);
    if (Number.isFinite(usd) && usd > 0) return usd;
    return Number.isFinite(diem) && diem > 0 ? null : Number.isFinite(usd) ? usd : null;
  } catch (err) {
    if (err instanceof LlmError) throw err;
    return null;
  }
}

interface RawModel {
  id: string;
  type?: string;
  context_length?: number;
  model_spec?: {
    name?: string;
    description?: string;
    privacy?: string;
    offline?: boolean;
    betaModel?: boolean;
    uncensored?: boolean;
    traits?: string[];
    availableContextTokens?: number;
    maxCompletionTokens?: number;
    pricing?: { input?: { usd?: number }; output?: { usd?: number }; cache_input?: { usd?: number } };
    capabilities?: {
      supportsResponseSchema?: boolean;
      supportsVision?: boolean;
      supportsReasoning?: boolean;
      supportsReasoningEffort?: boolean;
      reasoningEffortOptions?: string[];
      supportsE2EE?: boolean;
    };
  };
}

/** One entry of Venice's list as the game keeps it, or null for a model the game cannot use (offline, E2EE, no price). */
export function veniceModelOf(m: RawModel): ModelInfo | null {
  const spec = m.model_spec;
  if (!spec || spec.offline) return null;
  if (m.type && m.type !== 'text') return null;
  const c = spec.capabilities ?? {};
  if (c.supportsE2EE) return null;
  const input = spec.pricing?.input?.usd;
  const output = spec.pricing?.output?.usd;
  if (typeof input !== 'number' || typeof output !== 'number') return null;
  const thinks = !!c.supportsReasoning;
  const traits = spec.traits ?? [];
  return {
    id: gameModelId('venice', m.id),
    label: spec.name || m.id,
    input,
    output,
    cacheRead: typeof spec.pricing?.cache_input?.usd === 'number' ? spec.pricing.cache_input.usd : input,
    // Only a model that lists the effort "none" can be told not to think; the others always think, and the
    // game gives them room for it.
    thinkingOff: !thinks || (c.reasoningEffortOptions ?? []).includes('none') ? { type: 'disabled' } : null,
    structured: !!c.supportsResponseSchema,
    vision: !!c.supportsVision,
    thinks,
    efforts: c.supportsReasoningEffort ? c.reasoningEffortOptions ?? [] : [],
    privacy: spec.privacy === 'private' ? 'private' : 'passed-on',
    context: spec.availableContextTokens ?? m.context_length ?? null,
    maxOutput: spec.maxCompletionTokens ?? null,
    description: spec.description ?? '',
    category: [spec.uncensored ? 'Uncensored' : '', ...traits.map((x) => `trait:${x}`), spec.betaModel ? 'beta' : ''].filter(Boolean).join(' '),
  };
}

/** The text models, with their prices. The list is public: no key is needed to read it. */
export async function listVeniceModels(deps: Deps = {}): Promise<ModelInfo[]> {
  const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let res: Response;
  try {
    res = await doFetch(`${VENICE_BASE}/models?type=text`);
  } catch {
    throw new LlmError('offline', t('The request did not reach {service}.', { service: 'Venice' }), null, null, 'venice');
  }
  if (!res.ok) throw new LlmError('other', t('The list of models could not be read.'), res.status, null, 'venice');
  const body = (await res.json()) as { data?: RawModel[] };
  return (body.data ?? []).map(veniceModelOf).filter((m): m is ModelInfo => !!m);
}
