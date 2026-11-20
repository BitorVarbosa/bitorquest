// What the review of the three services found and what was done about it: a key's spending limit is
// not an empty account, a request turned down for its content is a refusal, a key is never sent to a
// service it does not belong to, removing a key does not move the game to another service, a model
// that cannot stop thinking gets room and the least effort it lists, and a world being built keeps its
// instructions the same from step to step.
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, app, refuseOtherServicesKey } from '../src/app/app';
import { EpilogueOut } from '../src/game/llm/schemas';
import { chatBody, mended, nearestEffort, statusError, type ChatMessage } from '../src/game/llm/openai';
import { nanoAdapter } from '../src/game/llm/nanogpt';
import { checkVeniceKey, veniceAdapter, veniceModelOf, veniceTransport } from '../src/game/llm/venice';
import type { LlmRequest } from '../src/game/llm/transport';
import { fakeFetch, json, model, register } from './fakeService';

describe('a key that reached its spending limit', () => {
  it('is told apart from an account with no money, and keeps the time to wait when the service says it', () => {
    // NanoGPT's daily limit on a key: a code, and the time it resets in.
    const nano = statusError(nanoAdapter, 429, 'This key has reached its daily USD limit.', 'api_key_usd_limit', 3600);
    expect(nano).toMatchObject({ kind: 'credit', detail: 'limit', retryAfter: 3600, service: 'nanogpt' });
    // Venice's, with only its words to go by.
    const venice = statusError(veniceAdapter, 402, 'API key USD spend limit exceeded.', '', NaN);
    expect(venice).toMatchObject({ kind: 'credit', detail: 'limit', service: 'venice' });
    // An account with no money is still that.
    expect(statusError(veniceAdapter, 402, 'Insufficient balance', '', NaN)).toMatchObject({ kind: 'credit', detail: null });
  });
});

describe('a request turned down for what it asks', () => {
  it('comes back as a refusal, charged nothing, not as an error', async () => {
    const writer = model('venice:venice-uncensored-1-2', { structured: true });
    register(writer);
    const req = { role: 'narrator', params: { model: writer.id, max_tokens: 500, system: 'You narrate.', messages: [{ role: 'user', content: 'Go on.' }] } } as unknown as LlmRequest;
    const tr = veniceTransport('vk', { privateOnly: true }, { fetch: fakeFetch(() => json({ error: 'Content policy violation' }, 422)) });
    const res = await tr.send(req);
    expect(res).toMatchObject({ stop: 'refusal', text: '', cost: 0, parsed: null });
    expect(res.refusal).not.toBeNull();
  });
});

describe('a key pasted for the wrong service', () => {
  it('is never sent to that service', () => {
    expect(() => refuseOtherServicesKey('venice', 'sk-ant-api03-abc')).toThrow(/Claude/);
    expect(() => refuseOtherServicesKey('nanogpt', '  sk-ant-api03-abc')).toThrow();
    expect(() => refuseOtherServicesKey('anthropic', 'sk-nano-1234')).toThrow(/NanoGPT/);
    expect(() => refuseOtherServicesKey('nanogpt', 'VENICE_INFERENCE_KEY_x')).toThrow(/Venice/);
    // Its own service's key, or one that says nothing about whose it is, goes ahead.
    for (const [service, key] of [['anthropic', 'sk-ant-api03-abc'], ['venice', 'VENICE_INFERENCE_KEY_x'], ['nanogpt', 'sk-nano-1234'], ['nanogpt', '0b6a2c1e-0000-4000-8000-000000000000']] as const) {
      expect(() => refuseOtherServicesKey(service, key)).not.toThrow();
    }
    try { refuseOtherServicesKey('venice', 'sk-ant-x'); } catch (e) { expect(e).toMatchObject({ kind: 'auth', status: null, service: 'venice' }); }
  });
});

describe('removing a key that a part of the game uses', () => {
  const was = { settings: app.settings, apiKey: app.apiKey, veniceKey: app.veniceKey, nanoKey: app.nanoKey };
  afterEach(() => { Object.assign(app, was, { sandbox: false }); });

  it('lets the demo answer until the key comes back, and never moves that part to another service', async () => {
    // The sandbox: nothing is written to the device.
    Object.assign(app, { sandbox: true });
    const judge = model('venice:deepseek-v4-flash', { structured: true });
    register(judge);
    app.settings = { ...DEFAULT_SETTINGS, demo: false, preset: 'custom', models: { narrator: judge.id, referee: judge.id, scribe: judge.id } };
    Object.assign(app, { apiKey: 'sk-ant-on-device', veniceKey: 'vk' });
    await app.removeServiceKey('venice');
    // The models are as the player chose them, and the demo switch is as they left it.
    expect(app.settings.models.narrator).toBe(judge.id);
    expect(app.settings.demo).toBe(false);
    // The demo answers while the key is missing, and stops when it is back.
    expect(app.missingKeys).toEqual(['venice']);
    expect(app.usingDemo).toBe(true);
    app.veniceKey = 'vk-again';
    expect(app.usingDemo).toBe(false);
  });
});

describe('a model that cannot stop thinking', () => {
  const raw = (efforts: string[]) => ({
    id: 'glm-5-3-flash-uncensored', type: 'text',
    model_spec: {
      name: 'GLM 5.3 Flash Uncensored', privacy: 'private', availableContextTokens: 1_000_000, maxCompletionTokens: 131_072,
      pricing: { input: { usd: 0.165 }, output: { usd: 0.55 } },
      capabilities: { supportsResponseSchema: true, supportsReasoning: true, supportsReasoningEffort: true, reasoningEffortOptions: efforts },
    },
  });

  it('is known as one when Venice lists no "none" for it, so the game gives its answers room to think', () => {
    expect(veniceModelOf(raw(['low', 'high', 'max']))!.thinkingOff).toBeNull();
    expect(veniceModelOf(raw(['none', 'low', 'high']))!.thinkingOff).toEqual({ type: 'disabled' });
  });

  it('is asked for the effort nearest to the one wanted, the lower on a tie', () => {
    expect(nearestEffort('medium', ['low', 'high'])).toBe('low');
    expect(nearestEffort('high', ['low', 'medium', 'max'])).toBe('medium');
    expect(nearestEffort('minimal', ['low', 'high', 'max'])).toBe('low');
    expect(nearestEffort('low', ['none'])).toBeNull();
    expect(nearestEffort('low', [])).toBeNull();
  });
});

describe('a structured answer with an empty list written as null', () => {
  it('is mended to an empty list, while a field that may be null stays null', () => {
    const shape = { type: 'object', properties: { targets: { type: 'array', items: { type: 'string' } }, ask: { type: ['string', 'null'] } } };
    expect(mended({ targets: null, ask: null }, shape)).toEqual({ targets: [], ask: null });
  });
});

describe('where the shape of an answer is said', () => {
  const m = model('venice:deepseek-v4-flash', { structured: true });
  register(m);
  const contentOf = (x: ChatMessage) => (typeof x.content === 'string' ? x.content : x.content.map((p) => ('text' in p ? p.text : '')).join(' '));

  it('is in the instructions for a single question, which then stay the same from call to call', () => {
    const req = { role: 'narrator', schema: EpilogueOut, params: { model: m.id, max_tokens: 900, system: 'SYSTEM', messages: [{ role: 'user', content: 'The story.' }] } } as unknown as LlmRequest;
    const messages = chatBody(req, m, veniceAdapter, { privateOnly: true }).messages as ChatMessage[];
    expect(contentOf(messages[0]!)).toContain('ANSWER FORMAT');
    expect(contentOf(messages[messages.length - 1]!)).toBe('The story.');
  });

  it('is after the newest step of a world being built, so that the instructions and the steps before it stay as they were', () => {
    const req = {
      role: 'architect', schema: EpilogueOut,
      params: { model: m.id, max_tokens: 900, system: 'SYSTEM', messages: [{ role: 'user', content: 'The brief.' }, { role: 'assistant', content: '{"a":1}' }, { role: 'user', content: 'Step two.' }] },
    } as unknown as LlmRequest;
    const messages = chatBody(req, m, veniceAdapter, { privateOnly: true }).messages as ChatMessage[];
    expect(messages[0]).toEqual({ role: 'system', content: 'SYSTEM' });
    expect(messages[1]).toEqual({ role: 'user', content: 'The brief.' });
    expect(contentOf(messages[3]!)).toMatch(/^Step two\.\n\nANSWER FORMAT/);
  });
});

describe('a Venice balance', () => {
  const balance = (balances: Record<string, number>) => checkVeniceKey('vk', { fetch: fakeFetch(() => json({ data: { accessPermitted: true, balances } })) });

  it('counts what can pay in dollars, and shows no dollar figure when only DIEM is left', async () => {
    expect(await balance({ USD: 2.5 })).toBe(2.5);
    expect(await balance({ USD: 0, BUNDLED_CREDITS: 5 })).toBe(5);
    expect(await balance({ USD: 0, DIEM: 3 })).toBeNull();
    expect(await balance({ USD: 0 })).toBe(0);
  });
});
