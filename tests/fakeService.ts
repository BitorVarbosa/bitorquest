// A stand-in for the services that speak OpenAI's chat format (Venice, NanoGPT), for the tests of their
// connections: a fetch that keeps what was sent and answers the way the service would, streamed answers
// cut at awkward places, models as the services list them, and real requests built by the game.
import { RefereeOut, ScribeOut } from '../src/game/llm/schemas';
import { registerModel, type ModelInfo } from '../src/game/llm/models';
import type { ModelChoice } from '../src/game/llm/requests';
import type { LlmRequest } from '../src/game/llm/transport';
import { harness } from './helpers';

/** One request as the service received it. */
export interface Sent {
  url: string;
  method: string;
  headers: Headers;
  /** The body, read as JSON; null when there was none. */
  body: Record<string, unknown> | null;
}

/** A streamed answer in the chat-completions format, handed over `cut` bytes at a time, so that lines, JSON, tags and letters fall across reads. */
export function sse(chunks: object[], cut = 7): Response {
  const text = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  const bytes = new TextEncoder().encode(text);
  let at = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (at >= bytes.length) { ctrl.close(); return; }
      ctrl.enqueue(bytes.slice(at, at + cut));
      at += cut;
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** Pieces of a streamed answer. */
export const delta = (content: string) => ({ choices: [{ index: 0, delta: { content }, finish_reason: null }] });
export const finish = (reason = 'stop') => ({ choices: [{ index: 0, delta: {}, finish_reason: reason }] });
/** The last chunk: the usage, and anything the service puts beside it (Venice's charge). */
export const usage = (u: Record<string, unknown>, beside: Record<string, unknown> = {}) => ({ choices: [], usage: u, ...beside });
/** A text sent as a stream, in pieces of `size` characters. */
export const streamed = (text: string, size = 9): object[] => Array.from({ length: Math.ceil(text.length / size) }, (_, i) => delta(text.slice(i * size, (i + 1) * size)));

/** An answer that is not a stream: an error, a balance, a list of models. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

const abortError = () => new DOMException('This operation was aborted', 'AbortError');

const sentOf = (input: RequestInfo | URL, init: RequestInit): Sent => ({
  url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
  method: init.method ?? 'GET',
  headers: new Headers(init.headers),
  body: typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
});

/**
 * A fetch that keeps what is sent to it and answers with `answer`. Like the browser's, it does not start
 * when its signal has already fired, and a body still being read fails when the signal fires.
 */
export function fakeFetch(answer: (sent: Sent, n: number) => Response | Promise<Response>, seen: Sent[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const signal = init.signal ?? null;
    if (signal?.aborted) throw abortError();
    const sent = sentOf(input, init);
    seen.push(sent);
    const res = await answer(sent, seen.length - 1);
    return signal && res.body ? stoppable(res, signal) : res;
  }) as typeof fetch;
}

/** A fetch that never answers: it waits until its signal fires, then fails as the browser's does. */
export function silentFetch(seen: Sent[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    seen.push(sentOf(input, init));
    return new Promise<Response>((_, reject) => {
      if (init.signal?.aborted) { reject(abortError()); return; }
      init.signal?.addEventListener('abort', () => reject(abortError()), { once: true });
    });
  }) as typeof fetch;
}

/** The body of a response, failing with an AbortError when the signal fires, as a real fetch's body does. */
function stoppable(res: Response, signal: AbortSignal): Response {
  const reader = res.body!.getReader();
  const body = new ReadableStream<Uint8Array>({
    start(ctrl) {
      signal.addEventListener('abort', () => {
        try { ctrl.error(abortError()); } catch { /* already finished */ }
        void reader.cancel().catch(() => {});
      }, { once: true });
    },
    async pull(ctrl) {
      try {
        const { done, value } = await reader.read();
        if (done) ctrl.close();
        else ctrl.enqueue(value);
      } catch { /* stopped */ }
    },
  });
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

// ---------- Models ----------

/** A model as the game keeps one from a service's list. */
export function model(id: string, more: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id, label: id, input: 0.5, output: 2, cacheRead: 0.05, thinkingOff: { type: 'disabled' },
    structured: false, vision: false, thinks: false, efforts: [], privacy: 'private',
    context: 128_000, maxOutput: null, description: '', category: '', ...more,
  };
}

/** Register models, so that the game and the connection find what each can do. */
export function register(...models: ModelInfo[]): void {
  for (const m of models) registerModel(m);
}

/** A choice of models for every role, as the session takes it. */
export const choice = (narrator: ModelInfo, judge: ModelInfo, effort: ModelChoice['effort'] = 'low'): ModelChoice => ({ narrator: narrator.id, referee: judge.id, scribe: judge.id, effort });

// ---------- Real requests ----------

export interface Requests {
  /** The narrator's after two turns of a scene: the packet, a turn with its engine note and reply, and the newest line with its note. */
  narrator: LlmRequest;
  /** The referee's for "I ask Mira what she makes of the Watch.", with its schema. */
  referee: LlmRequest;
  /** The scribe's for the scene ended by a journey, with its schema. */
  scribe: LlmRequest;
}

const built = new Map<string, Promise<Requests>>();

/**
 * Requests exactly as the game builds them for these models, played with the demo client in the sample
 * story. The harness keeps requests without their schema (a schema cannot be copied): it is put back.
 */
export function realRequests(models: ModelChoice): Promise<Requests> {
  const key = JSON.stringify(models);
  let got = built.get(key);
  if (!got) {
    got = (async () => {
      const h = harness({ models });
      await h.session.submit('I look around.');
      await h.session.submit('I ask Mira what she makes of the Watch.');
      const narrator = h.requests.filter((r) => r.role === 'narrator').pop();
      const referee = h.requests.filter((r) => r.role === 'referee').pop();
      await h.session.travel('guild_house');
      const scribe = h.requests.filter((r) => r.role === 'scribe').pop();
      if (!narrator || !referee || !scribe) throw new Error('the harness did not make every kind of request');
      return { narrator, referee: { ...referee, schema: RefereeOut }, scribe: { ...scribe, schema: ScribeOut } };
    })();
    built.set(key, got);
  }
  // Each test gets its own copy, schemas included.
  return got.then((r) => ({
    narrator: structuredClone(r.narrator),
    referee: { ...structuredClone({ ...r.referee, schema: undefined }), schema: RefereeOut },
    scribe: { ...structuredClone({ ...r.scribe, schema: undefined }), schema: ScribeOut },
  }));
}
