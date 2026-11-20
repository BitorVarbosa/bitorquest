// Choosing where each request goes: the model id says the service (models.ts), the router sends each
// request there and nowhere else (route.ts), a whole game can be put on one service from its live list
// (plans.ts, services.ts), and settings kept by the version that had only a NanoGPT narrator are
// brought forward (app.ts upgradeSettings).
import { afterEach, describe, expect, it, vi } from 'vitest';
import viteConfig from '../vite.config.ts?raw';
import { DEFAULT_SETTINGS, app, upgradeSettings, type AppSettings } from '../src/app/app';
import { modelsOf } from '../src/app/services';
import {
  MODELS, PRESETS, gameModelId, ownModelId, roleModels, serviceOf, servicesOf, type ModelInfo, type RoleModels,
} from '../src/game/llm/models';
import { NANO_BASE, nanoModelOf } from '../src/game/llm/nanogpt';
import { suggestPlan } from '../src/game/llm/plans';
import { byService } from '../src/game/llm/route';
import { EpilogueOut } from '../src/game/llm/schemas';
import { LlmError, type LlmRequest, type LlmResponse, type SendOptions, type Transport } from '../src/game/llm/transport';
import { VENICE_BASE } from '../src/game/llm/venice';
import { delta, fakeFetch, finish, json, model, realRequests, register, sse, type Sent } from './fakeService';

describe('a model id says its service', () => {
  it('bare for Claude, prefixed for the others, and the service’s own id behind the prefix', () => {
    expect(serviceOf('claude-sonnet-5-5')).toBe('anthropic');
    expect(serviceOf('venice:deepseek-v4-1-flash-1017-uncensored')).toBe('venice');
    expect(serviceOf('nanogpt:TEE/gemma4-31b')).toBe('nanogpt');
    expect(gameModelId('venice', 'deepseek-v4-flash')).toBe('venice:deepseek-v4-flash');
    expect(gameModelId('anthropic', 'claude-haiku-5-5')).toBe('claude-haiku-5-5');
    expect(ownModelId('nanogpt:TEE/gemma4-31b')).toBe('TEE/gemma4-31b');
    expect(ownModelId('venice:qwen-3-8-27b')).toBe('qwen-3-8-27b');
    expect(ownModelId('claude-opus-5-5')).toBe('claude-opus-5-5');
    // The same name at two services stays two models.
    expect(gameModelId('venice', 'gemma4-31b')).not.toBe(gameModelId('nanogpt', 'gemma4-31b'));
  });

  it('lists the services a choice of models sends anything to, with the builder and the eyes filled in', () => {
    expect(servicesOf(PRESETS.balanced)).toEqual(['anthropic']);
    const venice: RoleModels = { narrator: 'venice:a', referee: 'venice:b', scribe: 'venice:b' };
    expect(roleModels(venice)).toEqual({ ...venice, architect: 'venice:a', vision: 'venice:b' });
    expect(servicesOf(venice)).toEqual(['venice']);
    // The world builder follows the narrator unless chosen apart, and the eyes follow the scribe.
    expect(servicesOf({ ...PRESETS.balanced, narrator: 'nanogpt:x' })).toEqual(['anthropic', 'nanogpt']);
    expect(servicesOf({ ...venice, architect: 'claude-opus-5-5' })).toEqual(['anthropic', 'venice']);
    expect(servicesOf({ ...venice, vision: 'nanogpt:TEE/gemma4-31b' })).toEqual(['venice', 'nanogpt']);
  });
});

describe('the router', () => {
  const answer = (req: LlmRequest, name: string): LlmResponse => ({
    text: name, parsed: null, usage: { input: 1, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, output: 1 }, model: req.params.model, stop: 'end_turn', refusal: null, simulated: false,
  });
  const fake = (name: string, calls: string[], opts: (SendOptions | undefined)[] = []): Transport => ({
    simulated: false,
    async send(req, o) {
      calls.push(`${name} ${req.role} ${req.params.model}`);
      opts.push(o);
      return answer(req, name);
    },
  });
  const request = (role: LlmRequest['role'], modelId: string) => ({ role, params: { model: modelId, max_tokens: 10, messages: [] } }) as unknown as LlmRequest;

  it('sends each request to the service its model belongs to, whatever the role', async () => {
    const calls: string[] = [];
    const opts: (SendOptions | undefined)[] = [];
    const tr = byService({ anthropic: fake('claude', calls, opts), venice: fake('venice', calls, opts), nanogpt: fake('nanogpt', calls, opts) });
    expect(tr.simulated).toBe(false);
    await tr.send(request('narrator', 'claude-sonnet-5-5'));
    await tr.send(request('referee', 'venice:deepseek-v4-flash'));
    await tr.send(request('scribe', 'nanogpt:TEE/gemma4-31b'));
    await tr.send(request('architect', 'venice:deepseek-v4-1-flash-1017-uncensored'));
    // The epilogue is the narrator's, with a shape: it goes where the narrator's model is, like any other request.
    await tr.send({ ...request('narrator', 'nanogpt:deepseek/deepseek-v4.1-flash'), schema: EpilogueOut });
    expect(calls).toEqual([
      'claude narrator claude-sonnet-5-5',
      'venice referee venice:deepseek-v4-flash',
      'nanogpt scribe nanogpt:TEE/gemma4-31b',
      'venice architect venice:deepseek-v4-1-flash-1017-uncensored',
      'nanogpt narrator nanogpt:deepseek/deepseek-v4.1-flash',
    ]);
    // What the session passes along (the player's Stop, the text as it arrives) reaches the service's connection.
    const stop = new AbortController();
    const onText = () => {};
    await tr.send(request('narrator', 'venice:x'), { signal: stop.signal, onText });
    expect(opts[opts.length - 1]?.signal).toBe(stop.signal);
    expect(opts[opts.length - 1]?.onText).toBe(onText);
  });

  it('sends nothing anywhere when the model’s service has no key, and says which key is missing', async () => {
    const calls: string[] = [];
    const veniceOnly = byService({ venice: fake('venice', calls) });
    for (const [modelId, service] of [['nanogpt:TEE/gemma4-31b', 'nanogpt'], ['claude-haiku-5-5', 'anthropic']] as const) {
      const e = await veniceOnly.send(request('referee', modelId)).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(LlmError);
      expect(e).toMatchObject({ kind: 'auth', service, status: null });
    }
    const claudeOnly = byService({ anthropic: fake('claude', calls) });
    await expect(claudeOnly.send(request('narrator', 'venice:deepseek-v4-flash'))).rejects.toMatchObject({ kind: 'auth', service: 'venice' });
    expect(calls).toEqual([]);
  });
});

// ---------- A whole game on one service ----------

const V = (id: string, more: Partial<ModelInfo> = {}) => model(`venice:${id}`, { maxOutput: 32_768, context: 160_000, ...more });
/** Venice's list, private and anonymized models side by side, as its API describes them. */
const VENICE_LIST: ModelInfo[] = [
  V('deepseek-v4-1-flash-1017-uncensored', { label: 'DeepSeek V4.1 Flash Uncensored', structured: true, thinks: true, efforts: ['low', 'medium', 'high'], input: 0.15, output: 0.6 }),
  V('deepseek-v4-flash', { label: 'DeepSeek V4 Flash', structured: true, thinks: true, efforts: ['low', 'medium', 'high'], input: 0.14, output: 0.56 }),
  V('qwen-3-8-27b', { label: 'Qwen 3.8 27B', vision: true, input: 0.2, output: 0.8 }),
  V('venice-uncensored-1-2', { label: 'Venice Uncensored 1.2', input: 0.2, output: 0.9 }),
  V('mistral-small-3-2-24b-instruct', { label: 'Mistral Small 3.2', structured: true, vision: true, input: 0.08, output: 0.3 }),
  // Cheaper and abler, but Venice passes what is sent to them on: never in a private plan.
  V('gpt-5-mini', { label: 'GPT-5 Mini', privacy: 'passed-on', structured: true, vision: true, input: 0.01, output: 0.04 }),
  V('claude-opus-5-5', { label: 'Claude Opus 5.5', privacy: 'passed-on', structured: true, vision: true, input: 6, output: 30 }),
];
const byId = (list: ModelInfo[], id: string): ModelInfo => {
  const m = list.find((x) => x.id === id);
  if (!m) throw new Error(`${id} is not in the list`);
  return m;
};

describe('a plan for a whole game on one service', () => {
  it('puts every role of a private Venice game on Venice’s own models, held to a schema where the answer has a shape', () => {
    const plan = suggestPlan('venice', VENICE_LIST, true)!;
    expect(plan.models).toEqual({
      narrator: 'venice:deepseek-v4-1-flash-1017-uncensored', architect: 'venice:deepseek-v4-1-flash-1017-uncensored',
      referee: 'venice:deepseek-v4-flash', scribe: 'venice:deepseek-v4-flash',
      // Neither of those reads pictures: the eyes are the first model preferred for them that does.
      vision: 'venice:qwen-3-8-27b',
    });
    for (const id of Object.values(plan.models)) expect(byId(VENICE_LIST, id).privacy).toBe('private');
    for (const role of ['referee', 'scribe', 'architect'] as const) expect(byId(VENICE_LIST, plan.models[role]).structured).toBe(true);
    // Nothing of this game is sent to any other service.
    expect(servicesOf(plan.models)).toEqual(['venice']);
    // The models it uses, once each, to be remembered with their prices.
    expect(plan.infos.map((m) => m.id).sort()).toEqual(['venice:deepseek-v4-1-flash-1017-uncensored', 'venice:deepseek-v4-flash', 'venice:qwen-3-8-27b']);
    expect(plan.infos.every((m) => m.privacy === 'private')).toBe(true);
  });

  it('may use a model Venice passes on only when the player has not asked for its own models only', () => {
    const anonymized = VENICE_LIST.filter((m) => m.privacy === 'passed-on');
    expect(suggestPlan('venice', anonymized, true)).toBeNull();
    const plan = suggestPlan('venice', anonymized, false)!;
    // The cheapest that can do the work.
    expect(plan.models.referee).toBe('venice:gpt-5-mini');
    expect(servicesOf(plan.models)).toEqual(['venice']);
  });

  it('falls back on a rule when the preferred models are not on the list: the cheapest that can do the work', () => {
    const list = [
      V('dear', { structured: true, input: 1, output: 4 }),
      V('cheap', { structured: true, input: 0.1, output: 0.4 }),
      // Cheaper still, but each falls short: answers too short for a referee, too little to read, no shape at all.
      V('short-answers', { structured: true, input: 0.01, output: 0.01, maxOutput: 1024 }),
      V('short-memory', { structured: true, input: 0.01, output: 0.01, context: 16_000 }),
      V('shapeless', { input: 0.01, output: 0.01 }),
    ];
    const plan = suggestPlan('venice', list, true)!;
    expect(plan.models).toMatchObject({ narrator: 'venice:cheap', referee: 'venice:cheap', scribe: 'venice:cheap', architect: 'venice:cheap' });
    // No model reads pictures: the eyes are the scribe's, and no other model is kept for them.
    expect(plan.models.vision).toBe('venice:cheap');
    expect(plan.infos.map((m) => m.id)).toEqual(['venice:cheap']);
  });

  it('lets the narrator write on a model without structured outputs when none that has them can write enough', () => {
    const list = [V('judge', { structured: true, maxOutput: 4096 }), V('writer', { maxOutput: 32_768 })];
    const plan = suggestPlan('venice', list, true)!;
    expect(plan.models).toMatchObject({ narrator: 'venice:writer', architect: 'venice:writer', referee: 'venice:judge', scribe: 'venice:judge' });
  });

  it('makes no plan when no model can be held to a schema', () => {
    expect(suggestPlan('venice', VENICE_LIST.map((m) => ({ ...m, structured: false })), true)).toBeNull();
    expect(suggestPlan('venice', [], false)).toBeNull();
    expect(suggestPlan('nanogpt', [model('nanogpt:a'), model('nanogpt:b', { thinks: true })], false)).toBeNull();
  });

  it('puts every role of a private NanoGPT game on its Private/TEE models', () => {
    const entry = (id: string, more: Partial<Parameters<typeof nanoModelOf>[0]> = {}) => nanoModelOf({
      id, name: id, category: 'Uncensored', context_length: 131_072, max_output_tokens: 16_384,
      architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: 0.3, completion: 1.2 }, ...more,
    })!;
    const list = [
      entry('TEE/deepseek-v4.1-flash', { category: 'Private/TEE', capabilities: { reasoning: true, structured_output: true }, reasoning_efforts: ['none', 'low', 'high'] }),
      entry('TEE/gemma4-31b', { category: 'Private/TEE', capabilities: { structured_output: true, vision: true }, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } }),
      entry('TEE/qwen3.8-27b', { category: 'Private/TEE', capabilities: { structured_output: true } }),
      // Cheaper, structured, reads pictures, and passed on to whoever runs it.
      entry('deepseek/deepseek-v4.1-flash', { capabilities: { reasoning: true, structured_output: true, vision: true }, pricing: { prompt: 0.05, completion: 0.2 } }),
      entry('google/gemma-4-26b-a4b-it', { capabilities: { structured_output: true, vision: true }, pricing: { prompt: 0.02, completion: 0.08 } }),
    ];
    const plan = suggestPlan('nanogpt', list, true)!;
    expect(plan.models).toEqual({
      narrator: 'nanogpt:TEE/deepseek-v4.1-flash', architect: 'nanogpt:TEE/deepseek-v4.1-flash',
      referee: 'nanogpt:TEE/gemma4-31b', scribe: 'nanogpt:TEE/gemma4-31b',
      // The judge reads pictures: it is the eyes too.
      vision: 'nanogpt:TEE/gemma4-31b',
    });
    for (const id of Object.values(plan.models)) expect(byId(list, id)).toMatchObject({ privacy: 'private', category: 'Private/TEE' });
    expect(servicesOf(plan.models)).toEqual(['nanogpt']);
    // Without "private only", the preferred open models: the dated DeepSeek when it is listed…
    const dated = entry('deepseek/deepseek-v4.1-flash-1017', { capabilities: { reasoning: true, structured_output: true, vision: true }, pricing: { prompt: 0.1, completion: 0.6 } });
    expect(suggestPlan('nanogpt', [...list, dated], false)!.models).toMatchObject({ narrator: 'nanogpt:deepseek/deepseek-v4.1-flash-1017', referee: 'nanogpt:deepseek/deepseek-v4.1-flash-1017' });
    // …and a model offered for testing only after every steady one that fits.
    const beta = entry('deepseek/deepseek-v4.1-flash', { description: 'A rate-limited beta, intended for testing rather than production use.', capabilities: { reasoning: true, structured_output: true, vision: true } });
    const open = suggestPlan('nanogpt', [...list.filter((m) => m.id !== beta.id), beta], false)!.models;
    expect(open.referee).toBe('nanogpt:google/gemma-4-26b-a4b-it');
    expect(Object.values(open)).not.toContain(beta.id);
  });

  it('gives the eyes to a model that reads pictures whenever the list has one', () => {
    for (const privateOnly of [true, false]) {
      const plan = suggestPlan('venice', VENICE_LIST, privateOnly)!;
      expect(byId(VENICE_LIST, plan.models.vision).vision).toBe(true);
    }
    // The narrator's own model, when it reads pictures.
    const seeing = VENICE_LIST.map((m) => (m.id === 'venice:deepseek-v4-1-flash-1017-uncensored' ? { ...m, vision: true } : m));
    expect(suggestPlan('venice', seeing, true)!.models.vision).toBe('venice:deepseek-v4-1-flash-1017-uncensored');
  });
});

describe('each service’s models', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('gives Claude’s own table, and reads the others’ lists once, sorted by name; a failure is not kept', async () => {
    expect((await modelsOf('anthropic')).map((m) => m.id).sort()).toEqual(Object.keys(MODELS).sort());
    const urls: string[] = [];
    const venice = (id: string, name: string) => ({ id, type: 'text', model_spec: { name, privacy: 'private', pricing: { input: { usd: 0.2 }, output: { usd: 0.8 } }, capabilities: {} } });
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      return urls.length === 1 ? json({}, 503) : json({ data: [venice('zeta', 'Zeta'), venice('alpha', 'Alpha')] });
    });
    await expect(modelsOf('venice')).rejects.toMatchObject({ kind: 'other', status: 503, service: 'venice' });
    const list = await modelsOf('venice');
    expect(list.map((m) => [m.id, m.label])).toEqual([['venice:alpha', 'Alpha'], ['venice:zeta', 'Zeta']]);
    expect(await modelsOf('venice')).toBe(list);
    expect(urls).toEqual(['https://api.venice.ai/api/v1/models?type=text', 'https://api.venice.ai/api/v1/models?type=text']);
  });
});

// ---------- The connections the app makes ----------

describe('the connections the app makes', () => {
  // There is one app per page: each test sets what it needs on it, and it is put back after.
  const was = { settings: app.settings, apiKey: app.apiKey, veniceKey: app.veniceKey, nanoKey: app.nanoKey };
  afterEach(() => {
    Object.assign(app, was);
    vi.unstubAllGlobals();
  });
  const judge = model('venice:deepseek-v4-flash', { label: 'DeepSeek V4 Flash', structured: true, thinks: true, efforts: ['low', 'medium', 'high'] });
  const writer = model('venice:venice-uncensored-1-2', { label: 'Venice Uncensored 1.2' });
  const passedOn = model('venice:gpt-5-mini', { label: 'GPT-5 Mini', privacy: 'passed-on', structured: true });
  const tee = model('nanogpt:TEE/gemma4-31b', { label: 'Gemma 4 31B (TEE)', structured: true, vision: true, category: 'Private/TEE' });
  register(judge, writer, passedOn, tee);
  const onVenice: RoleModels = { narrator: writer.id, referee: judge.id, scribe: judge.id };
  const fine = () => sse([delta('Fine.'), finish('stop')]);

  it('with every role on Venice, sends everything to Venice and nothing to Claude, though a Claude key is on the device', async () => {
    app.settings = { ...DEFAULT_SETTINGS, demo: false, preset: 'custom', models: onVenice, venicePrivate: true };
    Object.assign(app, { apiKey: 'sk-ant-on-device', veniceKey: 'vk-on-device', nanoKey: 'nano-on-device' });
    expect(app.servicesInUse).toEqual(['venice']);
    expect(app.missingKeys).toEqual([]);
    expect(app.usingDemo).toBe(false);
    const seen: Sent[] = [];
    vi.stubGlobal('fetch', fakeFetch(fine, seen));
    const tr = app.transport();
    expect(tr.simulated).toBe(false);
    const { narrator, referee, scribe } = await realRequests(app.models());
    for (const req of [referee, narrator, scribe]) await tr.send(req);
    expect(seen.map((s) => s.url)).toEqual(Array(3).fill('https://api.venice.ai/api/v1/chat/completions'));
    expect(seen.every((s) => s.headers.get('authorization') === 'Bearer vk-on-device')).toBe(true);
    expect(seen.every((s) => ![...s.headers.values()].some((v) => /sk-ant-on-device|nano-on-device/.test(v)))).toBe(true);
    // A model Venice passes on, chosen while "own models only" was off, is not sent to while it is on.
    const elsewhere = { ...narrator, params: { ...narrator.params, model: passedOn.id } };
    app.settings = { ...app.settings, models: { ...onVenice, narrator: passedOn.id } };
    await expect(app.transport().send(elsewhere)).rejects.toMatchObject({ kind: 'bad_request', service: 'venice' });
    expect(seen).toHaveLength(3);
    app.settings = { ...app.settings, venicePrivate: false };
    await app.transport().send(elsewhere);
    expect(seen).toHaveLength(4);
  });

  it('with Claude’s preset, as at the beginning, sends everything to Claude, though other keys are on the device', async () => {
    app.settings = { ...DEFAULT_SETTINGS, demo: false, preset: 'balanced', models: PRESETS.balanced };
    Object.assign(app, { apiKey: 'sk-ant-claude-only', veniceKey: 'vk-unused', nanoKey: 'nano-unused' });
    expect(app.servicesInUse).toEqual(['anthropic']);
    expect(app.usingDemo).toBe(false);
    const seen: Sent[] = [];
    // Claude says no to the key: enough to see where the requests went, and that nothing was sent twice.
    vi.stubGlobal('fetch', fakeFetch(() => json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401), seen));
    const tr = app.transport();
    const { narrator, referee } = await realRequests(app.models());
    await expect(tr.send(referee)).rejects.toMatchObject({ kind: 'auth', service: 'anthropic' });
    await expect(tr.send(narrator)).rejects.toMatchObject({ kind: 'auth', service: 'anthropic' });
    expect(seen).toHaveLength(2);
    expect(seen.map((s) => new URL(s.url).origin)).toEqual(['https://api.anthropic.com', 'https://api.anthropic.com']);
    // The Claude key goes with them (this version of Anthropic's library sends it as a bearer token), and no other key does.
    const key = (s: Sent) => s.headers.get('x-api-key') ?? s.headers.get('authorization')?.replace(/^Bearer /, '');
    expect(seen.map(key)).toEqual(['sk-ant-claude-only', 'sk-ant-claude-only']);
    expect(seen.every((s) => ![...s.headers.values()].some((v) => /vk-unused|nano-unused/.test(v)))).toBe(true);
  });

  it('asks NanoGPT for providers that keep nothing exactly when the player turned that on', async () => {
    app.settings = { ...DEFAULT_SETTINGS, demo: false, preset: 'custom', models: { narrator: tee.id, referee: tee.id, scribe: tee.id }, nanoPrivate: true };
    Object.assign(app, { apiKey: null, veniceKey: null, nanoKey: 'nano-key' });
    const seen: Sent[] = [];
    vi.stubGlobal('fetch', fakeFetch(fine, seen));
    const { referee } = await realRequests(app.models());
    await app.transport().send(referee);
    app.settings = { ...app.settings, nanoPrivate: false };
    await app.transport().send(referee);
    expect(seen.map((s) => s.url)).toEqual(Array(2).fill('https://nano-gpt.com/api/v1/chat/completions'));
    expect(seen.map((s) => s.body?.provider ?? null)).toEqual([{ zdr: true }, null]);
  });

  it('plays with the demo narrator, sending nothing, while a key the chosen models need is missing', async () => {
    app.settings = { ...DEFAULT_SETTINGS, demo: false, preset: 'custom', models: { ...onVenice, narrator: tee.id } };
    Object.assign(app, { apiKey: 'sk-ant', veniceKey: 'vk', nanoKey: null });
    expect(app.servicesInUse).toEqual(['venice', 'nanogpt']);
    expect(app.missingKeys).toEqual(['nanogpt']);
    expect(app.usingDemo).toBe(true);
    const seen: Sent[] = [];
    vi.stubGlobal('fetch', fakeFetch(fine, seen));
    const tr = app.transport();
    expect(tr.simulated).toBe(true);
    const { referee } = await realRequests(app.models());
    expect((await tr.send(referee)).simulated).toBe(true);
    expect(seen).toHaveLength(0);
  });
});

describe('the built site', () => {
  it('may connect to the services the game calls and to no other place', () => {
    const allowed = /connect-src ([^"]+)"/.exec(viteConfig)?.[1]?.trim().split(/\s+/) ?? [];
    expect([...allowed].sort()).toEqual(['https://api.anthropic.com', new URL(VENICE_BASE).origin, new URL(NANO_BASE).origin].sort());
  });
});

// ---------- Settings from the version with a NanoGPT narrator ----------

describe('settings kept by an earlier version', () => {
  const kept: AppSettings = { ...DEFAULT_SETTINGS, demo: false, onboarded: true, dailyCap: 2, preset: 'balanced', models: PRESETS.balanced };
  const legacyModels = [
    { id: 'GLM-4.6-Derestricted-v5', name: 'GLM 4.6 Derestricted v5', description: 'Uncensored GLM.', category: 'Uncensored', input: 0.4, output: 1.5, cacheRead: 0.2, context: 131_072, maxOutput: null, thinks: true, canStopThinking: true },
    { id: 'TEE/gemma4-31b', name: 'Gemma 4 31B (TEE)', category: 'Private/TEE', input: 0.25, output: 0.9, cacheRead: 0.25, thinks: false, canStopThinking: false },
    { id: 'thinker', input: 1, output: 2, cacheRead: 1, thinks: true, canStopThinking: false },
  ];

  it('turns a NanoGPT narrator into the narrator’s model, with its price remembered and the old fields gone', () => {
    const up = upgradeSettings({ ...kept, nanoNarrator: 'GLM-4.6-Derestricted-v5', nanoModels: legacyModels });
    expect(up).not.toHaveProperty('nanoNarrator');
    expect(up).not.toHaveProperty('nanoModels');
    // Only the narration moved: world building stays on the Claude model it used.
    expect(up.models).toEqual({ ...PRESETS.balanced, architect: PRESETS.balanced.narrator, narrator: 'nanogpt:GLM-4.6-Derestricted-v5' });
    expect(up.preset).toBe('custom');
    expect(up.providerModels).toEqual([
      {
        id: 'nanogpt:GLM-4.6-Derestricted-v5', label: 'GLM 4.6 Derestricted v5', input: 0.4, output: 1.5, cacheRead: 0.2,
        thinkingOff: { type: 'disabled' }, structured: false, vision: false, thinks: true, efforts: ['none'],
        privacy: 'passed-on', context: 131_072, maxOutput: null, description: 'Uncensored GLM.', category: 'Uncensored',
      },
      {
        id: 'nanogpt:TEE/gemma4-31b', label: 'Gemma 4 31B (TEE)', input: 0.25, output: 0.9, cacheRead: 0.25,
        thinkingOff: { type: 'disabled' }, structured: false, vision: false, thinks: false, efforts: [],
        privacy: 'private', context: null, maxOutput: null, description: '', category: 'Private/TEE',
      },
      {
        id: 'nanogpt:thinker', label: 'thinker', input: 1, output: 2, cacheRead: 1,
        thinkingOff: null, structured: false, vision: false, thinks: true, efforts: [],
        privacy: 'passed-on', context: null, maxOutput: null, description: '', category: '',
      },
    ]);
    // Everything else as it was.
    const { models: _m, preset: _p, providerModels: _pm, ...rest } = up;
    const { models: _km, preset: _kp, providerModels: _kpm, ...keptRest } = kept;
    expect(rest).toEqual(keptRest);
    // The game now sends the narrator's writing to NanoGPT and the rest to Claude, as before.
    expect(servicesOf(up.models!)).toEqual(['anthropic', 'nanogpt']);
    // Read again, it stays as it is.
    expect(upgradeSettings(up)).toEqual(up);
  });

  it('keeps models already remembered, and drops the old fields when no narrator was chosen there', () => {
    const remembered = model('nanogpt:TEE/gemma4-31b', { label: 'Gemma, as listed now', structured: true });
    const up = upgradeSettings({ ...kept, providerModels: [remembered], nanoNarrator: null, nanoModels: legacyModels });
    expect(up.providerModels!.map((m) => m.id)).toEqual(['nanogpt:TEE/gemma4-31b', 'nanogpt:GLM-4.6-Derestricted-v5', 'nanogpt:thinker']);
    expect(up.providerModels![0]).toEqual(remembered);
    expect(up.models).toEqual(PRESETS.balanced);
    expect(up.preset).toBe('balanced');
    expect(upgradeSettings({ ...kept, nanoNarrator: null, nanoModels: [] })).toEqual(kept);
  });

  it('leaves settings of this version as they are', () => {
    const now: AppSettings = {
      ...kept, preset: 'custom', venicePrivate: true, nanoPrivate: true,
      models: { narrator: 'venice:deepseek-v4-1-flash-1017-uncensored', referee: 'venice:deepseek-v4-flash', scribe: 'venice:deepseek-v4-flash' },
      providerModels: [model('venice:deepseek-v4-flash', { structured: true })],
    };
    expect(upgradeSettings(now)).toEqual(now);
    expect(upgradeSettings({})).toEqual({});
  });
});
