// The connection for the services that speak OpenAI's chat format: Venice and NanoGPT. Called straight
// from the browser with the player's own key for that service; nothing of ours sits in between.
//
// The game builds every request in Claude's shape (requests.ts, architect.ts, ingest.ts). This file
// turns one into a chat-completions request, streams the answer back, holds a structured answer to its
// zod schema, and reports usage. What differs between the services (address, extra parameters, how
// thinking is turned off, the exact charge, special errors) is in each service's adapter
// (venice.ts, nanogpt.ts).
import { z } from 'zod';
import { t } from '../../i18n';
import { SERVICE_NAME, modelInfo, ownModelId, type ModelInfo, type Service, type TokenUsage } from './models';
import { LlmError, type LlmErrorKind, type LlmRequest, type LlmResponse, type MessageParams, type SendOptions, type Transport } from './transport';

// ---------- The request ----------

export type TextPart = { type: 'text'; text: string };
export type ImagePart = { type: 'image_url'; image_url: { url: string } };
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string | (TextPart | ImagePart)[] }

type Block = { type: string; text?: string; source?: { type?: string; media_type?: string; data?: string } };
type AnyMessage = { role: string; content: string | Block[] };

function partsOf(content: string | Block[] | undefined): (TextPart | ImagePart)[] {
  if (typeof content === 'string') return content.trim() ? [{ type: 'text', text: content }] : [];
  const out: (TextPart | ImagePart)[] = [];
  for (const b of content ?? []) {
    if (b.type === 'text' && b.text?.trim()) out.push({ type: 'text', text: b.text });
    else if (b.type === 'image' && b.source?.type === 'base64' && b.source.data) {
      out.push({ type: 'image_url', image_url: { url: `data:${b.source.media_type ?? 'image/jpeg'};base64,${b.source.data}` } });
    }
  }
  return out;
}

const textOnly = (parts: (TextPart | ImagePart)[]): parts is TextPart[] => parts.every((p) => p.type === 'text');

/**
 * Claude's request as chat messages. The system blocks become one system message at the top. The
 * engine's notes, which sit between turns as system messages in Claude's request, are joined to the
 * player's line they follow: many open models accept a system message only at the very start, and the
 * order stays the same from one turn to the next, so a service that caches the start of a request can.
 */
export function toChatMessages(params: Pick<MessageParams, 'system' | 'messages'>, extraSystem = ''): ChatMessage[] {
  const out: { role: ChatMessage['role']; parts: (TextPart | ImagePart)[] }[] = [];
  const system = [partsOf(params.system as string | Block[] | undefined).map((p) => (p as TextPart).text).join('\n\n'), extraSystem].filter(Boolean).join('\n\n');
  if (system) out.push({ role: 'system', parts: [{ type: 'text', text: system }] });
  for (const m of params.messages as AnyMessage[]) {
    const parts = partsOf(m.content);
    if (!parts.length) continue;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else out.push({ role, parts });
  }
  return out.map(({ role, parts }) => ({
    role,
    content: textOnly(parts) ? parts.map((p) => p.text).join('\n\n') : parts,
  }));
}

const shapes = new WeakMap<z.ZodType, Record<string, unknown>>();

/**
 * The schema an answer must follow, as JSON Schema. zod writes every field as required and closes every
 * object, which is what services that hold answers to a schema ask for. Worked out once per schema.
 */
export function jsonShape(schema: z.ZodType): Record<string, unknown> {
  let shape = shapes.get(schema);
  if (!shape) {
    const { $schema: _drop, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
    void _drop;
    shape = rest;
    shapes.set(schema, shape);
  }
  return shape;
}

type Shape = { type?: string | string[]; anyOf?: Shape[]; properties?: Record<string, Shape>; items?: Shape; enum?: unknown[]; description?: string };

/** A shape as compact pseudo-TypeScript, each field's description as a comment above it: fewer tokens than JSON Schema, and as clear. */
function shapeText(s: Shape, pad = ''): string {
  if (s.anyOf) return s.anyOf.map((b) => shapeText(b, pad)).join(' | ');
  if (Array.isArray(s.enum)) return s.enum.map((v) => JSON.stringify(v)).join(' | ');
  return ([] as string[]).concat(s.type ?? 'any').map((type) => {
    if (type === 'array') {
      const it = s.items ?? {};
      const inner = shapeText(it, pad);
      return it.anyOf || (it.enum?.length ?? 0) > 1 || Array.isArray(it.type) ? `(${inner})[]` : `${inner}[]`;
    }
    if (type !== 'object') return type === 'integer' ? 'number' : type;
    const lines = Object.entries(s.properties ?? {}).map(([k, p]) =>
      `${p.description ? `${pad}  // ${String(p.description).replace(/\s+/g, ' ')}\n` : ''}${pad}  "${k}": ${shapeText(p, `${pad}  `)}`);
    return `{\n${lines.join(',\n')}\n${pad}}`;
  }).join(' | ');
}

/**
 * What every model is told about the answer's shape, in the instructions. A service that holds a model
 * to a schema does not show the model the descriptions of its fields, and they carry the game's rules
 * (what each kind of action means, when a field is left null), so the shape is always said in words;
 * it stays the same from call to call, so a service that caches the start of a request caches it too.
 */
export function shapeInWords(shape: Record<string, unknown>): string {
  return `ANSWER FORMAT. Answer with one JSON object, written compactly on one line, and nothing else: no words before or after it, no code fence. Every field below is required: use null where a field allows null and nothing applies, and [] for an empty list. Each comment says what to put in the field under it.\n${shapeText(shape as Shape)}`;
}

/**
 * Room added to an answer's limit. The game's requests give thinking room only where they expect it
 * (the narrator, the world builder); a judging role that runs on a model which cannot stop thinking
 * needs it too, or its thinking eats the answer. A model that is not held to the shape may also spend a
 * few more tokens on it than one that is.
 */
export const THINKING_ROOM = 2000;
export const WORDED_ROOM = 400;

/** How one service differs from the others. */
export interface Adapter {
  service: Exclude<Service, 'anthropic'>;
  /** The address of chat completions. */
  url: string;
  headers(key: string): Record<string, string>;
  /** Extra fields for the body: privacy, the service's own switches, how thinking is set. */
  extra(model: ModelInfo, think: { off: boolean; effort: string | null }, opts: ConnectionOptions, req: LlmRequest): Record<string, unknown>;
  /** Whether a model without structured outputs can still be put in JSON mode. */
  jsonMode(model: ModelInfo): boolean;
  /** The exact charge in dollars, when the service reports it: from the usage, which also carries the last chunk's "cost" when there is one. */
  cost?(usage: Record<string, unknown>): number | undefined;
  /** A service's own error codes, when they mean something the general rules would get wrong. */
  special?(status: number, code: string, message: string): LlmError | null;
  /** A model this connection must not send to, with these options (Venice's anonymized models when only its own are wanted). */
  refuse?(model: ModelInfo, opts: ConnectionOptions): LlmError | null;
}

export interface ConnectionOptions {
  /** NanoGPT: send only to providers that keep nothing (zero data retention). Venice: send only to its own, private models. */
  privateOnly: boolean;
}

/**
 * Models whose service turned down their schema in this session: from then on they are told the shape
 * in words only. Kept in memory, so a service that fixes its side is tried again on the next visit.
 */
const shapeRefused = new Set<string>();

/** The order of the reasoning efforts services know, from none to most. */
const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/**
 * The effort a model lists that is closest to the one wanted, the lower one on a tie (a model that has
 * no "medium" thinks at "low" rather than at its own default, which is often its highest). Null when it
 * lists none, or none it can be asked for.
 */
export function nearestEffort(wanted: string, listed: string[]): string | null {
  const at = EFFORTS.indexOf(wanted);
  const options = listed.filter((e) => e !== 'none' && EFFORTS.includes(e));
  if (at < 0 || !options.length) return null;
  return options.sort((a, b) => Math.abs(EFFORTS.indexOf(a) - at) - Math.abs(EFFORTS.indexOf(b) - at) || EFFORTS.indexOf(a) - EFFORTS.indexOf(b))[0]!;
}

/** Text added at the end of the last message, in its own paragraph. */
function appended(messages: ChatMessage[], text: string): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') return [...messages, { role: 'user', content: text }];
  const content = typeof last.content === 'string' ? `${last.content}\n\n${text}` : [...last.content, { type: 'text' as const, text }];
  return [...messages.slice(0, -1), { ...last, content }];
}

export function chatBody(req: LlmRequest, model: ModelInfo, adapter: Adapter, opts: ConnectionOptions): Record<string, unknown> {
  const p = req.params;
  const shape = req.schema ? jsonShape(req.schema) : null;
  // Held to the schema where the service can; told the shape in words always (see shapeInWords).
  const native = !!shape && model.structured === true && !shapeRefused.has(model.id);
  // Where the shape is said. A single question (the referee, the scribe) has it in the instructions,
  // which stay the same from call to call and so are read from the cache. A conversation that grows one
  // step at a time (building a world, each step with a shape of its own) has it after the newest step:
  // in the instructions it would change them at every step, and nothing before it could be cached.
  const conversation = (p.messages as AnyMessage[]).some((m) => m.role === 'assistant');
  const words = shape ? shapeInWords(shape) : '';
  const messages = conversation && words ? appended(toChatMessages(p), words) : toChatMessages(p, words);
  const thinking = p.thinking as { type?: string } | undefined;
  const effort = (p.output_config as { effort?: string } | undefined)?.effort ?? null;
  // A structured answer cut short is worth nothing. A model that can think may think anyway (it cannot
  // stop, or its service does not pass the switch on), and its thinking counts against the limit: room
  // for it, which costs nothing unless it is used. The judging roles (the referee, the scribe, a picture
  // read into words) were given no room by the game, which expects Claude's cheapest model with its
  // thinking off: on a model that cannot stop thinking they get it whatever they answer. Other free
  // text keeps its limit, which also keeps it short.
  const judging = req.role === 'referee' || req.role === 'scribe';
  const room = model.thinks && (shape || (judging && model.thinkingOff === null)) ? THINKING_ROOM : 0;
  const wanted = p.max_tokens + room + (shape && !native ? WORDED_ROOM : 0);
  const max = model.maxOutput ? Math.min(wanted, model.maxOutput) : wanted;
  return {
    model: ownModelId(model.id),
    messages,
    max_tokens: max,
    stream: true,
    // The usage arrives in the last chunk.
    stream_options: { include_usage: true },
    ...(native ? { response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: shape } } } : {}),
    ...(shape && !native && adapter.jsonMode(model) ? { response_format: { type: 'json_object' } } : {}),
    ...adapter.extra(model, { off: !!thinking && thinking.type !== 'enabled' && thinking.type !== 'adaptive', effort }, opts, req),
  };
}

// ---------- The answer ----------

/**
 * Some open models write their thinking into the text, between <think> tags. It is taken out; while a
 * tag may still be arriving, the text after its start is held back.
 */
export function visibleText(raw: string): string {
  let text = raw.replace(/<think>[\s\S]*?<\/think>\s*/g, '');
  const open = text.indexOf('<think>');
  if (open >= 0) text = text.slice(0, open);
  // A tag cut in half at the end of what has arrived so far.
  const tail = text.match(/<[/a-z]{0,6}$/);
  if (tail && '<think>'.startsWith(tail[0])) text = text.slice(0, -tail[0].length);
  return text.replace(/^\s+/, '');
}

/** The JSON object in an answer: the whole text, or what is inside a code fence, or the outermost braces. Undefined when there is none. */
export function jsonIn(text: string): unknown {
  const tries = [text.trim()];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) tries.push(fence[1].trim());
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a >= 0 && b > a) tries.push(text.slice(a, b + 1));
  for (const s of tries) {
    try { return JSON.parse(s); } catch { /* the next way */ }
  }
  return undefined;
}

const allowsNull = (s: Shape): boolean => s.type === 'null' || (Array.isArray(s.type) && s.type.includes('null')) || (s.anyOf ?? []).some(allowsNull);
const objectOf = (s: Shape): Shape | null => (s.properties ? s : (s.anyOf ?? []).find((x) => x.properties) ?? null);
const arrayOf = (s: Shape): Shape | null => (s.type === 'array' ? s : (s.anyOf ?? []).find((x) => x.type === 'array') ?? null);
const enumOf = (s: Shape): unknown[] | null => s.enum ?? (s.anyOf ?? []).find((x) => x.enum)?.enum ?? null;
const isNumber = (s: Shape): boolean => s.type === 'number' || s.type === 'integer' || (Array.isArray(s.type) && (s.type.includes('number') || s.type.includes('integer')));

/**
 * The small slips a model makes when it is not held to the schema, mended where the meaning is plain:
 * a missing field that may be null becomes null, a missing list (or one written as null) becomes empty, an enum word in the
 * wrong case takes the schema's case, a number written as text becomes a number. Anything else is left
 * for the schema to reject.
 */
export function mended(value: unknown, shape: Shape): unknown {
  // An empty list written as null.
  if (value === null && arrayOf(shape) && !allowsNull(shape)) return [];
  if (value === null || value === undefined) return value;
  const words = enumOf(shape);
  if (typeof value === 'string' && words && !words.includes(value)) {
    const same = words.find((w) => typeof w === 'string' && w.toLowerCase() === value.trim().toLowerCase());
    return same ?? value;
  }
  if (typeof value === 'string' && isNumber(shape) && value.trim() && Number.isFinite(Number(value))) return Number(value);
  const arr = arrayOf(shape);
  if (Array.isArray(value)) return arr?.items ? value.map((v) => mended(v, arr.items!)) : value;
  const obj = objectOf(shape);
  if (obj?.properties && typeof value === 'object') {
    const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    for (const [k, s] of Object.entries(obj.properties)) {
      if (!(k in out) || out[k] === undefined) {
        if (allowsNull(s)) out[k] = null;
        else if (arrayOf(s)) out[k] = [];
        continue;
      }
      out[k] = mended(out[k], s);
    }
    return out;
  }
  return value;
}

/** The structured answer, checked against its schema; null when it cannot be used. */
export function structured(text: string, schema: z.ZodType): unknown {
  const raw = jsonIn(text);
  if (raw === undefined) return null;
  const r = schema.safeParse(mended(raw, jsonShape(schema) as Shape));
  return r.success ? r.data : null;
}

interface Chunk {
  choices?: { delta?: { content?: string | null; refusal?: string | null }; finish_reason?: string | null }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number } | null;
    cache_read_input_tokens?: number;
  } & Record<string, unknown>;
  /** Venice puts the charge beside the usage, in the last chunk. */
  cost?: unknown;
  error?: { message?: string; code?: string | number; type?: string; status?: number };
}

const approxTokens = (chars: number) => Math.ceil(chars / 4);

function error(adapter: Adapter, kind: LlmErrorKind, message: string, status: number | null = null, retryAfter: number | null = null): LlmError {
  return new LlmError(kind, message, status, retryAfter, adapter.service);
}

/** A key that reached the spending limit set for it: the account may well have money, and the limit may reset by itself. */
export const spendLimit = (code: string, message: string): boolean => /spend_?limit|usd_limit|monthly_usd|spend(ing)?\s+limit/i.test(`${code} ${message}`);

/** A request turned down for what it asked: the same to the game as a model that declined to write it. */
export const contentPolicy = (status: number, code: string, message: string): boolean =>
  status === 422 || /content.?policy|moderation|flagged/i.test(`${code} ${message}`);

/** What a failed call means, in the player's terms. The general rules first defer to the service's own codes. */
export function statusError(adapter: Adapter, status: number, message: string, code: string, wait = NaN): LlmError {
  const special = adapter.special?.(status, code, message);
  if (special) return special;
  const service = SERVICE_NAME[adapter.service];
  if (spendLimit(code, message)) {
    return new LlmError('credit', t('The {service} key has reached the spending limit set for it.', { service }), status, Number.isFinite(wait) && wait > 0 ? wait : null, adapter.service, 'limit');
  }
  if (status === 401 || /invalid.?api.?key|unauthori[sz]ed/i.test(code)) return error(adapter, 'auth', t('{service} did not accept the key.', { service }), status);
  if (status === 402 || /balance|credit|insufficient|payment/i.test(code)) return error(adapter, 'credit', t('The {service} account has no balance left.', { service }), status);
  if (status === 403) return error(adapter, 'auth', t('This {service} key is not allowed to do that.', { service }), status);
  if (status === 429) return error(adapter, 'rate', t('Too many requests for now.'), status, Number.isFinite(wait) && wait > 0 ? wait : null);
  if (status >= 500) return error(adapter, 'overloaded', t('{service}’s service is busy or failed.', { service }), status);
  // The service's own words, as it sent them.
  if (status >= 400 && status < 500) return error(adapter, 'bad_request', message || t('{service} rejected the request.', { service }), status);
  return error(adapter, 'other', message || t('{service} rejected the request.', { service }), status || null);
}

/** A failed answer's words and code, whichever of the services' shapes it comes in. */
async function failure(res: Response): Promise<{ message: string; code: string }> {
  let message = '';
  let code = '';
  try {
    const body = (await res.json()) as { error?: { message?: string; code?: string | number; type?: string } | string; message?: string; code?: string };
    if (typeof body.error === 'string') { message = body.error; code = String(body.code ?? ''); }
    else { message = body.error?.message ?? body.message ?? ''; code = String(body.error?.code ?? body.error?.type ?? body.code ?? ''); }
  } catch { /* not JSON */ }
  return { message, code };
}

/** How long a request may go without a word from the service before it is given up: building a world thinks longest. */
const QUIET_MS = { architect: 300_000, other: 120_000 };

export interface Deps {
  fetch?: typeof fetch;
}

/**
 * The connection to one service, for every role. The model of each request is looked up in the
 * registry (models.ts) for what it can do: hold answers to a schema, think, read pictures.
 */
export function openaiTransport(adapter: Adapter, key: string, opts: ConnectionOptions, deps: Deps = {}): Transport {
  const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const service = SERVICE_NAME[adapter.service];

  async function once(req: LlmRequest, model: ModelInfo, send: SendOptions): Promise<LlmResponse> {
    const body = chatBody(req, model, adapter, opts);
    // The player's Stop, and a time limit on silence, both end the request; only the first is "stopped".
    const ctrl = new AbortController();
    let quiet = false;
    const limit = req.role === 'architect' ? QUIET_MS.architect : QUIET_MS.other;
    let timer = setTimeout(() => { quiet = true; ctrl.abort(); }, limit);
    const heard = () => { clearTimeout(timer); timer = setTimeout(() => { quiet = true; ctrl.abort(); }, limit); };
    const stop = () => ctrl.abort();
    if (send.signal?.aborted) ctrl.abort();
    send.signal?.addEventListener('abort', stop, { once: true });
    const failed = (err: unknown): LlmError => {
      if (err instanceof LlmError) return err;
      if (quiet) {
        // A schema a service cannot take may hang rather than be refused (Venice says so): from now on this
        // model is told the shape in words only, so that trying again does not hang again.
        if ('response_format' in body) shapeRefused.add(model.id);
        return error(adapter, 'overloaded', t('{service} took too long to answer.', { service }));
      }
      if (ctrl.signal.aborted) return error(adapter, 'aborted', t('Stopped.'));
      return error(adapter, 'offline', t('The request did not reach {service}.', { service }));
    };

    try {
      let res: Response;
      try {
        res = await doFetch(adapter.url, { method: 'POST', headers: adapter.headers(key), body: JSON.stringify(body), signal: ctrl.signal });
      } catch (err) {
        throw failed(err);
      }
      if (!res.ok) {
        const { message, code } = await failure(res);
        // Turned down for what was asked (a content policy): to the game that is a model declining to
        // write it, which the player can take back and say another way. Nothing was charged.
        if (contentPolicy(res.status, code, message) && !spendLimit(code, message)) {
          return {
            text: '', parsed: null, usage: { input: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, output: 0 }, model: model.id,
            stop: 'refusal', refusal: { category: code || null, explanation: message || null }, simulated: false, cost: 0,
          };
        }
        const e = statusError(adapter, res.status, message, code, Number(res.headers.get('retry-after')));
        // The service gave up on a request held to a schema: as with silence, the schema may be what it could not take.
        if ((res.status === 504 || /timeout/i.test(code)) && 'response_format' in body) shapeRefused.add(model.id);
        // The service turned down the schema itself: told in words instead, now and for the rest of the session.
        if (res.status === 400 && 'response_format' in body && !shapeRefused.has(model.id) && /schema|response.?format|json|structured/i.test(`${code} ${message}`)) {
          shapeRefused.add(model.id);
          (e as LlmError & { retryWorded?: boolean }).retryWorded = true;
        }
        throw e;
      }
      if (!res.body) throw error(adapter, 'other', t('{service} sent an empty answer.', { service }));

      let raw = '';
      let refusal = '';
      let shown = 0;
      let finish: string | null = null;
      let usage: Chunk['usage'] | null = null;
      let charged: unknown;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      const take = (line: string) => {
        if (!line.startsWith('data:')) return;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') return;
        let chunk: Chunk;
        try { chunk = JSON.parse(data) as Chunk; } catch { return; }
        if (chunk.error) {
          const code = String(chunk.error.code ?? chunk.error.type ?? '');
          if ((chunk.error.status === 504 || /timeout/i.test(code)) && 'response_format' in body) shapeRefused.add(model.id);
          throw statusError(adapter, chunk.error.status ?? 500, chunk.error.message ?? '', code);
        }
        if (chunk.usage) usage = chunk.usage;
        if (chunk.cost !== undefined) charged = chunk.cost;
        const choice = chunk.choices?.[0];
        if (choice?.finish_reason) finish = choice.finish_reason;
        if (choice?.delta?.refusal) refusal += choice.delta.refusal;
        const delta = choice?.delta?.content;
        if (delta) {
          raw += delta;
          // A structured answer is not shown as it arrives; story text is.
          if (send.onText && !req.schema) {
            const visible = visibleText(raw);
            if (visible.length > shown) {
              send.onText(visible.slice(shown));
              shown = visible.length;
            }
          }
        }
      };
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          heard();
          pending += decoder.decode(value, { stream: true });
          const lines = pending.split(/\r?\n/);
          pending = lines.pop() ?? '';
          for (const line of lines) take(line);
        }
        if (pending) take(pending);
      } catch (err) {
        throw failed(err);
      }

      const text = visibleText(raw);
      const u = usage as Chunk['usage'] | null;
      const sent = JSON.stringify(body.messages).length;
      const cached = u?.cache_read_input_tokens ?? u?.prompt_tokens_details?.cached_tokens ?? 0;
      const tokens: TokenUsage = {
        input: Math.max(0, (u?.prompt_tokens ?? approxTokens(sent)) - cached),
        cacheRead: cached,
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        output: u?.completion_tokens ?? approxTokens(raw.length),
      };
      const cost = adapter.cost?.({ ...(u ?? {}), ...(charged !== undefined ? { cost: charged } : {}) });
      const refused = !!refusal || finish === 'content_filter';
      return {
        text,
        parsed: req.schema && !refused ? structured(text, req.schema) : null,
        usage: tokens,
        model: model.id,
        stop: refused ? 'refusal' : finish === 'length' ? 'max_tokens' : 'end_turn',
        refusal: refused ? { category: null, explanation: refusal || null } : null,
        simulated: false,
        ...(typeof cost === 'number' && Number.isFinite(cost) ? { cost } : {}),
      };
    } finally {
      clearTimeout(timer);
      send.signal?.removeEventListener('abort', stop);
    }
  }

  return {
    simulated: false,
    async send(req: LlmRequest, send: SendOptions = {}): Promise<LlmResponse> {
      const model = modelInfo(req.params.model);
      const refused = adapter.refuse?.(model, opts);
      if (refused) throw refused;
      try {
        return await once(req, model, send);
      } catch (err) {
        // Once, and only when the service turned down the schema: a 400 costs nothing.
        if ((err as { retryWorded?: boolean }).retryWorded) return once(req, model, send);
        throw err;
      }
    },
  };
}
