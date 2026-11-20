// Venice (src/game/llm/venice.ts): what it is sent besides the common body, its own models only, what it
// charges, its key check and its list of models, and a game played on it from end to end, every
// request on Venice and nothing anywhere else.
import { describe, expect, it } from 'vitest';
import { mockTransport } from '../src/game/llm/mock';
import { costOf, type ModelInfo } from '../src/game/llm/models';
import { THINKING_ROOM, chatBody, jsonShape } from '../src/game/llm/openai';
import { byService } from '../src/game/llm/route';
import { RefereeOut, type ScribeOut } from '../src/game/llm/schemas';
import { LlmError, type LlmRequest } from '../src/game/llm/transport';
import { checkVeniceKey, listVeniceModels, veniceAdapter, veniceModelOf, veniceTransport } from '../src/game/llm/venice';
import { Session } from '../src/game/session';
import { newStory } from '../src/game/story';
import type { UsageEntry } from '../src/game/types';
import { glassRoadSeed } from '../src/packs/lanternCoast';
import { choice, delta, fakeFetch, finish, json, model, realRequests, register, sse, streamed, usage, type Sent } from './fakeService';
import { memoryScenes } from './helpers';

const CHAT_URL = 'https://api.venice.ai/api/v1/chat/completions';

type Raw = Parameters<typeof veniceModelOf>[0];
/** An entry of Venice's list of models, as its API gives it. */
function raw(id: string, spec: Partial<NonNullable<Raw['model_spec']>> = {}, caps: NonNullable<NonNullable<Raw['model_spec']>['capabilities']> = {}): Raw {
  return {
    id,
    type: 'text',
    context_length: 131_072,
    model_spec: {
      name: id, description: '', privacy: 'private', offline: false, betaModel: false, uncensored: false, traits: [],
      availableContextTokens: 131_072, maxCompletionTokens: 16_384,
      pricing: { input: { usd: 0.3 }, output: { usd: 1.2 }, cache_input: { usd: 0.03 } },
      ...spec,
      capabilities: { supportsResponseSchema: false, supportsVision: false, supportsReasoning: false, supportsReasoningEffort: false, supportsE2EE: false, ...caps },
    },
  };
}

// Two of Venice's own models, read from its list as the game reads them: one that writes, one that judges.
const WRITER = veniceModelOf(raw('venice-uncensored-1-2', { name: 'Venice Uncensored 1.2', uncensored: true, traits: ['most_uncensored'] }))!;
const JUDGE = veniceModelOf(raw('deepseek-v4-flash', { name: 'DeepSeek V4 Flash', traits: ['default'] }, {
  supportsResponseSchema: true, supportsReasoning: true, supportsReasoningEffort: true, reasoningEffortOptions: ['low', 'medium', 'high'],
}))!;
// One Venice passes on to the company that runs it.
const ANONYMIZED = veniceModelOf(raw('gpt-5-mini', { name: 'GPT-5 Mini', privacy: 'anonymized' }, { supportsResponseSchema: true, supportsVision: true }))!;
// One that thinks but takes no effort setting, and one whose efforts include "none".
const PLAIN_THINKER = model('venice:test-plain-thinker', { thinks: true, efforts: [] });
const NONE_THINKER = model('venice:test-none-thinker', { thinks: true, efforts: ['none', 'low', 'high'] });
register(WRITER, JUDGE, ANONYMIZED, PLAIN_THINKER, NONE_THINKER);

const body = (req: LlmRequest, m: ModelInfo, privateOnly = true) => chatBody(req, m, veniceAdapter, { privateOnly });

const ACT: RefereeOut = {
  kind: 'act', check: null, targets: [], mentions: [], recall: [], move_to: null, held: null, ability: null, improvise: null, minutes: 5,
  why_impossible: null, ask: null, ask_options: [], trade: null, contest: null, toward_contest: false,
};
const SCRIBE: ScribeOut = {
  summary: 'You asked Mira what she made of the Watch, and she told you they are nervous about the gate.',
  story_so_far: 'You reached the canal bridge with Mira. The Watch is nervous about something that came through the gate.',
  events: [{ text: 'You asked Mira what she made of the Watch.', importance: 'small', reach: 'secret', actors: ['mira'], witnesses: ['mira'] }],
  attitudes: [], people: [], fronts: [], looks: [], chapter: null,
};
const NARRATION = 'Mira leans on the rail and watches the Watch. “They are nervous,” she says. “Something came through the gate last night.”';

describe('what Venice is sent', () => {
  it('turns off Venice’s own system prompt and keys its cache by role, on every request', async () => {
    const { narrator, referee, scribe } = await realRequests(choice(WRITER, JUDGE));
    for (const req of [narrator, referee, scribe]) {
      const b = body(req, req === narrator ? WRITER : JUDGE);
      expect(b.venice_parameters).toMatchObject({ include_venice_system_prompt: false });
      expect(b.prompt_cache_key).toBe(`bq-${req.role}`);
      // Nothing of NanoGPT's.
      expect(b.provider).toBeUndefined();
    }
  });

  it('turns thinking off only for a model that can stop, and otherwise asks for the least effort the model lists', async () => {
    const off = { include_venice_system_prompt: false, disable_thinking: true, strip_thinking_response: true };
    // A model that lists "none": the referee and the scribe ask for no thinking, and get it.
    const stoppable = await realRequests(choice(WRITER, NONE_THINKER));
    for (const req of [stoppable.referee, stoppable.scribe]) {
      expect(req.params.thinking).toEqual({ type: 'disabled' });
      const b = body(req, NONE_THINKER);
      expect(b.reasoning_effort).toBe('none');
      expect(b).not.toHaveProperty('reasoning');
      expect(b.venice_parameters).toEqual(off);
    }
    // A model without "none" cannot be stopped (Venice says so): it thinks as little as it lists, and the
    // game knows it thinks (no thinking switch in the request, room for it in the limit).
    const { referee, scribe } = await realRequests(choice(WRITER, JUDGE));
    for (const req of [referee, scribe]) {
      expect(req.params.thinking).toBeUndefined();
      const b = body(req, JUDGE);
      expect(b.reasoning_effort).toBe('low');
      expect(b).not.toHaveProperty('reasoning');
      expect(b.venice_parameters).toEqual({ include_venice_system_prompt: false, strip_thinking_response: true });
    }
    // A model that does not think is told nothing about thinking.
    const plain = await realRequests(choice(WRITER, WRITER));
    for (const req of [plain.referee, plain.narrator]) {
      expect(body(req, WRITER)).not.toHaveProperty('reasoning');
      expect(body(req, WRITER)).not.toHaveProperty('reasoning_effort');
      expect(body(req, WRITER).venice_parameters).toEqual({ include_venice_system_prompt: false });
    }
    // A narrator asked to think hard: the effort, where the model takes it, and nothing turned off.
    const hard = await realRequests(choice(JUDGE, JUDGE, 'high'));
    expect(hard.narrator.params.thinking).toBeUndefined();
    expect(body(hard.narrator, JUDGE).reasoning_effort).toBe('high');
    expect(body(hard.narrator, JUDGE)).not.toHaveProperty('reasoning');
    expect(body(hard.narrator, JUDGE).venice_parameters).toEqual({ include_venice_system_prompt: false, strip_thinking_response: true });
    expect(body(hard.narrator, PLAIN_THINKER)).not.toHaveProperty('reasoning_effort');
    expect(body(hard.narrator, WRITER)).not.toHaveProperty('reasoning_effort');
    // At low effort the narrator thinks as little as the model allows: not at all where it can stop.
    const low = await realRequests(choice(JUDGE, JUDGE, 'low'));
    expect(body(low.narrator, JUDGE).reasoning_effort).toBe('low');
    const lowNone = await realRequests(choice(NONE_THINKER, NONE_THINKER, 'low'));
    expect(body(lowNone.narrator, NONE_THINKER).reasoning_effort).toBe('none');
  });

  it('holds the referee to its schema on a model that can be, and says the shape in words to one that cannot', async () => {
    const { referee } = await realRequests(choice(WRITER, JUDGE));
    expect(body(referee, JUDGE).response_format).toEqual({ type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: jsonShape(RefereeOut) } });
    expect(body(referee, WRITER).response_format).toBeUndefined();
  });
});

describe('Venice’s own models only', () => {
  it('never sends anything to a model Venice passes on, while “own models only” is on', async () => {
    const { narrator } = await realRequests(choice(WRITER, JUDGE));
    const req = { ...narrator, params: { ...narrator.params, model: ANONYMIZED.id } };
    const seen: Sent[] = [];
    const tr = veniceTransport('vk', { privateOnly: true }, { fetch: fakeFetch(() => sse([delta('Hello.')]), seen) });
    await expect(tr.send(req)).rejects.toMatchObject({ kind: 'bad_request', service: 'venice' });
    // A model the game knows nothing about any more is not trusted to be private either.
    await expect(tr.send({ ...narrator, params: { ...narrator.params, model: 'venice:some-model-from-before' } })).rejects.toMatchObject({ kind: 'bad_request', service: 'venice' });
    expect(seen).toHaveLength(0);
    // With it off, the player may choose such a model.
    const open = veniceTransport('vk', { privateOnly: false }, { fetch: fakeFetch(() => sse([delta('Hello.'), finish()]), seen) });
    expect((await open.send(req)).text).toBe('Hello.');
    expect(seen).toHaveLength(1);
  });

  it('explains a key made for private models only that is asked for another', async () => {
    const { narrator } = await realRequests(choice(WRITER, JUDGE));
    const tr = veniceTransport('vk', { privateOnly: false }, {
      fetch: fakeFetch(() => json({ error: 'This API key is restricted to private models only' }, 403)),
    });
    const e = await tr.send(narrator).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(LlmError);
    expect(e).toMatchObject({ kind: 'bad_request', status: 403, service: 'venice' });
    expect((e as LlmError).message).toContain('private models');
  });
});

describe('what Venice charges', () => {
  const answer = (beside: Record<string, unknown>) => fakeFetch(() => sse([delta('The door opens.'), finish(), usage({ prompt_tokens: 4000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 3000 } }, beside)]));

  it('takes the charge Venice reports beside the usage, in dollars', async () => {
    const { narrator } = await realRequests(choice(WRITER, JUDGE));
    const res = await veniceTransport('vk', { privateOnly: true }, { fetch: answer({ cost: { usd: 0.00123, diem: 0.00123 } }) }).send(narrator);
    expect(res.cost).toBe(0.00123);
    expect((await veniceTransport('vk', { privateOnly: true }, { fetch: answer({ cost: 0.002 }) }).send(narrator)).cost).toBe(0.002);
  });

  it('reports no charge when Venice does not say, and the cost is then worked out from the usage and the list price', async () => {
    const { narrator } = await realRequests(choice(WRITER, JUDGE));
    const res = await veniceTransport('vk', { privateOnly: true }, { fetch: answer({}) }).send(narrator);
    expect(res.cost).toBeUndefined();
    expect('cost' in res).toBe(false);
    expect(res.usage).toMatchObject({ input: 1000, cacheRead: 3000, output: 50 });
    expect(costOf(res.model, res.usage)).toBeCloseTo((1000 * 0.3 + 3000 * 0.03 + 50 * 1.2) / 1_000_000, 12);
  });
});

describe('checking a Venice key', () => {
  it('asks Venice for the key’s limits and balance, with the key as a bearer token, and reads the balance in dollars', async () => {
    const seen: Sent[] = [];
    const balance = await checkVeniceKey('vk-123', {
      fetch: fakeFetch(() => json({ data: { accessPermitted: true, apiTier: { id: 'paid', isCharged: true }, balances: { USD: 12.5, DIEM: 3 }, rateLimits: [] } }), seen),
    });
    expect(balance).toBe(12.5);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://api.venice.ai/api/v1/api_keys/rate_limits');
    expect(seen[0]!.method).toBe('GET');
    expect(seen[0]!.headers.get('authorization')).toBe('Bearer vk-123');
    // No balance in dollars: unknown, not zero.
    expect(await checkVeniceKey('vk', { fetch: fakeFetch(() => json({ data: { accessPermitted: true, balances: { DIEM: 3 } } })) })).toBeNull();
  });

  it('says when the account cannot be charged, or the key is not accepted', async () => {
    await expect(checkVeniceKey('vk', { fetch: fakeFetch(() => json({ data: { accessPermitted: false, balances: { USD: 0 } } })) }))
      .rejects.toMatchObject({ kind: 'credit', service: 'venice' });
    await expect(checkVeniceKey('vk', { fetch: fakeFetch(() => json({ error: 'Authentication failed' }, 401)) }))
      .rejects.toMatchObject({ kind: 'auth', status: 401, service: 'venice' });
    await expect(checkVeniceKey('vk', { fetch: fakeFetch(() => json({}, 429, { 'retry-after': '30' })) }))
      .rejects.toMatchObject({ kind: 'rate', retryAfter: 30, service: 'venice' });
    await expect(checkVeniceKey('vk', { fetch: (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch }))
      .rejects.toMatchObject({ kind: 'offline', service: 'venice' });
  });
});

describe('Venice’s list of models', () => {
  it('keeps a model as the game needs it: its id with the prefix, prices, privacy and what it can do', () => {
    expect(JUDGE).toEqual({
      id: 'venice:deepseek-v4-flash', label: 'DeepSeek V4 Flash', input: 0.3, output: 1.2, cacheRead: 0.03,
      // It thinks and lists no "none": it cannot be told not to think.
      thinkingOff: null, structured: true, vision: false, thinks: true, efforts: ['low', 'medium', 'high'],
      privacy: 'private', context: 131_072, maxOutput: 16_384, description: '', category: 'trait:default',
    });
    expect(ANONYMIZED).toMatchObject({ id: 'venice:gpt-5-mini', privacy: 'passed-on', vision: true, structured: true, thinks: false });
    expect(WRITER.category).toBe('Uncensored trait:most_uncensored');
    // Without a cache price, a cached token is priced as any other.
    expect(veniceModelOf(raw('x', { pricing: { input: { usd: 0.7 }, output: { usd: 2.8 } } }))?.cacheRead).toBe(0.7);
    // Efforts only where Venice takes them.
    expect(veniceModelOf(raw('y', {}, { supportsReasoning: true, reasoningEffortOptions: ['low', 'high'] }))?.efforts).toEqual([]);
    // Unknown privacy is not private.
    expect(veniceModelOf(raw('z', { privacy: undefined }))?.privacy).toBe('passed-on');
  });

  it('leaves out models that are offline, that need the text encrypted first, that have no price, or that do not write text', () => {
    expect(veniceModelOf(raw('off', { offline: true }))).toBeNull();
    expect(veniceModelOf(raw('e2ee', {}, { supportsE2EE: true }))).toBeNull();
    expect(veniceModelOf(raw('free', { pricing: {} }))).toBeNull();
    expect(veniceModelOf(raw('half', { pricing: { input: { usd: 1 } } }))).toBeNull();
    expect(veniceModelOf({ ...raw('pictures'), type: 'image' })).toBeNull();
    expect(veniceModelOf({ id: 'bare' })).toBeNull();
  });

  it('reads the public list without a key', async () => {
    const seen: Sent[] = [];
    const list = await listVeniceModels({
      fetch: fakeFetch(() => json({ object: 'list', type: 'text', data: [raw('a'), raw('off', { offline: true }), raw('e2ee', {}, { supportsE2EE: true }), raw('b', { privacy: 'anonymized' })] }), seen),
    });
    expect(list.map((m) => [m.id, m.privacy])).toEqual([['venice:a', 'private'], ['venice:b', 'passed-on']]);
    expect(seen[0]!.url).toBe('https://api.venice.ai/api/v1/models?type=text');
    expect(seen[0]!.headers.get('authorization')).toBeNull();
    await expect(listVeniceModels({ fetch: fakeFetch(() => json({}, 500)) })).rejects.toMatchObject({ kind: 'other', service: 'venice' });
    await expect(listVeniceModels({ fetch: (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch })).rejects.toMatchObject({ kind: 'offline', service: 'venice' });
  });
});

describe('a game on Venice', () => {
  it('sends a real referee request through Venice and reads the answer into the referee’s shape', async () => {
    const { referee } = await realRequests(choice(WRITER, JUDGE));
    // The demo referee's answer to this very request, as Venice would stream it back.
    const demo = await mockTransport({ streamDelay: 0 }).send(referee);
    expect(demo.parsed).not.toBeNull();
    const seen: Sent[] = [];
    const tr = veniceTransport('vk', { privateOnly: true }, {
      fetch: fakeFetch(() => sse([...streamed(demo.text, 17), finish('stop'), usage({ prompt_tokens: 2400, completion_tokens: 140, prompt_tokens_details: { cached_tokens: 1900 } }, { cost: { usd: 0.0002, diem: 0.0002 } })], 11), seen),
    });
    const res = await tr.send(referee);
    expect(res.parsed).toEqual(demo.parsed);
    expect(RefereeOut.safeParse(res.parsed).success).toBe(true);
    expect(res).toMatchObject({ model: 'venice:deepseek-v4-flash', stop: 'end_turn', refusal: null, cost: 0.0002, simulated: false });
    expect(res.usage).toEqual({ input: 500, cacheRead: 1900, cacheWrite5m: 0, cacheWrite1h: 0, output: 140 });
    // What went to Venice: its own id for the model, held to the referee's schema, the least thinking the model allows, the player's line.
    const sent = seen[0]!.body as Record<string, unknown> & { messages: { role: string; content: string }[] };
    expect(sent).toMatchObject({
      model: 'deepseek-v4-flash', max_tokens: 500 + THINKING_ROOM, stream: true, reasoning_effort: 'low', prompt_cache_key: 'bq-referee',
      response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: jsonShape(RefereeOut) } },
      venice_parameters: { include_venice_system_prompt: false },
    });
    expect(sent.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(sent.messages[1]!.content).toContain('THE PLAYER TYPED: "I ask Mira what she makes of the Watch."');
  });

  /** A session played with only a Venice key, the service played by `answer`. Every role is on Venice unless `models` says otherwise. */
  function veniceGame(answer: (sent: Sent) => Response, models = choice(WRITER, JUDGE)) {
    const seen: Sent[] = [];
    const venice = veniceTransport('vk-private', { privateOnly: true }, { fetch: fakeFetch(answer, seen) });
    const used: UsageEntry[] = [];
    const now = () => 1_800_000_000_000;
    const session = new Session(newStory(glassRoadSeed(), now()), {
      transport: byService({ venice }), models: () => models,
      budget: { spentToday: () => 0, cap: () => 100, record: (e) => { used.push(e); } },
      save: () => {}, now, paging: () => false, scenes: memoryScenes(),
    });
    return { session, seen, used };
  }
  const service = (sent: Sent): Response => {
    const role = sent.body?.prompt_cache_key;
    const text = role === 'bq-referee' ? JSON.stringify(ACT) : role === 'bq-scribe' ? JSON.stringify(SCRIBE) : NARRATION;
    return sse([...streamed(text, 40), finish('stop'), usage({ prompt_tokens: 2000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 1500 } }, { cost: { usd: 0.0004 } })]);
  };

  it('plays a turn and closes a scene with every request on Venice, and nothing sent anywhere else', async () => {
    const { session, seen, used } = veniceGame(service);
    await session.submit('I ask Mira what she makes of the Watch.');
    expect(session.blocker).toBeNull();
    expect(JSON.stringify(session.lastTurn)).toContain('Something came through the gate last night.');
    const first = session.scene;
    await session.travel('guild_house');
    expect(session.blocker).toBeNull();
    expect(first.ended).toBe(true);
    // The scene was written up by the scribe's answer from Venice, not by the fallback.
    expect(first.summary).toBe(SCRIBE.summary);
    expect(session.scene.placeId).toBe('guild_house');
    // Every request went to Venice, with the Venice key, for the role it was for.
    expect(seen.map((s) => s.url)).toEqual(Array(5).fill(CHAT_URL));
    expect(seen.map((s) => s.body?.prompt_cache_key)).toEqual(['bq-referee', 'bq-narrator', 'bq-referee', 'bq-scribe', 'bq-narrator']);
    expect(seen.every((s) => s.headers.get('authorization') === 'Bearer vk-private')).toBe(true);
    // Spending is recorded under Venice's models, at what Venice charged.
    expect(used.map((u) => `${u.role} ${u.model}`)).toEqual([
      `referee ${JUDGE.id}`, `narrator ${WRITER.id}`, `referee ${JUDGE.id}`, `scribe ${JUDGE.id}`, `narrator ${WRITER.id}`,
    ]);
    expect(used.every((u) => u.cost === 0.0004 && !u.simulated && u.cacheRead === 1500)).toBe(true);
  });

  it('stops the game with Venice named when Venice fails, and sends a role chosen elsewhere nowhere', async () => {
    // Venice has no balance left when the narrator is asked.
    const broke = veniceGame((sent) => (sent.body?.prompt_cache_key === 'bq-narrator' ? json({ error: { message: 'Insufficient USD or DIEM balance' } }, 402) : service(sent)));
    await broke.session.submit('I look around.');
    expect(broke.session.blocker).toMatchObject({ kind: 'credit', status: 402, service: 'venice' });
    // A narrator on NanoGPT with only a Venice key: the narrator's request is not sent to Venice instead.
    const mixed = veniceGame(service, { ...choice(WRITER, JUDGE), narrator: 'nanogpt:deepseek/deepseek-v4.1-flash' });
    await mixed.session.submit('I look around.');
    expect(mixed.session.blocker).toMatchObject({ kind: 'key', service: 'nanogpt' });
    expect(mixed.seen.map((s) => s.body?.prompt_cache_key)).toEqual(['bq-referee']);
  });
});
