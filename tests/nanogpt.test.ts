// NanoGPT (src/game/llm/nanogpt.ts): what it is sent besides the common body, how thinking and private
// providers are asked for, what it charges, its own errors, its key check and its list of models, and a
// game played on it from end to end. The common connection is tested in openai.test.ts.
import { describe, expect, it } from 'vitest';
import { costOf, type ModelInfo } from '../src/game/llm/models';
import { checkNanoKey, listNanoModels, nanoAdapter, nanoModelOf, nanoTransport } from '../src/game/llm/nanogpt';
import { chatBody, jsonShape, type ChatMessage } from '../src/game/llm/openai';
import { byService } from '../src/game/llm/route';
import { type RefereeOut, ScribeOut } from '../src/game/llm/schemas';
import { LlmError, type LlmRequest } from '../src/game/llm/transport';
import { Session } from '../src/game/session';
import { newStory } from '../src/game/story';
import type { UsageEntry } from '../src/game/types';
import { glassRoadSeed } from '../src/packs/lanternCoast';
import { choice, delta, fakeFetch, finish, json, realRequests, register, sse, streamed, usage, type Sent } from './fakeService';
import { memoryScenes } from './helpers';

const CHAT_URL = 'https://nano-gpt.com/api/v1/chat/completions';

type Raw = Parameters<typeof nanoModelOf>[0];
/** An entry of NanoGPT's detailed list of models, as its API gives it. */
const raw = (id: string, more: Partial<Raw> = {}): Raw => ({
  id, name: id, description: '', category: 'Uncensored', context_length: 131_072, max_output_tokens: 16_384,
  architecture: { input_modalities: ['text'], output_modalities: ['text'] },
  capabilities: { reasoning: false, structured_output: false, vision: false },
  pricing: { prompt: 0.2, completion: 0.8 }, reasoning_efforts: [], available: true, ...more,
});

// Models read from NanoGPT's list as the game reads them.
const TEE = nanoModelOf(raw('TEE/gemma4-31b', {
  name: 'Gemma 4 31B (TEE)', category: 'Private/TEE', max_output_tokens: 8192,
  architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
  capabilities: { structured_output: true }, pricing: { prompt: 0.25, completion: 0.9, cacheReadInputPer1kTokens: 0.0000625 },
}))!;
const TEE_WRITER = nanoModelOf(raw('TEE/glm-5.3-flash', { name: 'GLM 5.3 Flash (TEE)', category: 'Private/TEE', capabilities: { reasoning: true }, reasoning_efforts: ['none', 'low', 'medium', 'high'] }))!;
// A model that thinks and can be told not to, and one that always thinks.
const THINKER = nanoModelOf(raw('deepseek/deepseek-v4.1-flash', { capabilities: { reasoning: true, structured_output: true }, reasoning_efforts: ['none', 'low', 'medium', 'high'] }))!;
const ALWAYS = nanoModelOf(raw('z-ai/glm-5.3-thinking', { capabilities: { reasoning: true, structured_output: true }, reasoning_efforts: ['low', 'high'] }))!;
const PLAIN = nanoModelOf(raw('sao10k/l3.3-euryale-70b', { name: 'Euryale 70B', category: 'Roleplay/storytelling models' }))!;
register(TEE, TEE_WRITER, THINKER, ALWAYS, PLAIN);

const body = (req: LlmRequest, m: ModelInfo, privateOnly = false) => chatBody(req, m, nanoAdapter, { privateOnly });

const ACT: RefereeOut = {
  kind: 'act', check: null, targets: [], mentions: [], recall: [], move_to: null, held: null, ability: null, improvise: null, minutes: 5,
  why_impossible: null, ask: null, ask_options: [], trade: null, contest: null, toward_contest: false,
};
const SCRIBE: ScribeOut = {
  summary: 'You looked around the canal bridge and asked Mira about the Watch; she thinks they are afraid of something.',
  story_so_far: 'You reached the canal bridge with Mira. The Watch is afraid of something, and nobody will say what.',
  events: [], attitudes: [], people: [], fronts: [], looks: [], chapter: null,
};

describe('what NanoGPT is sent', () => {
  it('goes to NanoGPT’s address with the key as a bearer token, asking it not to blank out names', async () => {
    const { narrator } = await realRequests(choice(PLAIN, TEE));
    const seen: Sent[] = [];
    await nanoTransport('nano-key', { privateOnly: false }, { fetch: fakeFetch(() => sse([delta('Hi.'), finish()]), seen) }).send(narrator);
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([`POST ${CHAT_URL}`]);
    expect(seen[0]!.headers.get('authorization')).toBe('Bearer nano-key');
    expect(seen[0]!.headers.get('redaction')).toBe('false');
    // Nothing of Venice's.
    expect(seen[0]!.body).not.toHaveProperty('venice_parameters');
    expect(seen[0]!.body).not.toHaveProperty('prompt_cache_key');
  });

  it('turns thinking off with the effort "none" where the model has it, and never asks for the thinking back', async () => {
    const { referee, scribe } = await realRequests(choice(PLAIN, THINKER));
    for (const req of [referee, scribe]) {
      expect(req.params.thinking).toEqual({ type: 'disabled' });
      expect(body(req, THINKER)).toMatchObject({ reasoning_effort: 'none', reasoning: { exclude: true } });
    }
    // A model that always thinks: as little as it takes, since the referee asks for low effort.
    const always = await realRequests(choice(PLAIN, ALWAYS));
    expect(always.referee.params.thinking).toBeUndefined();
    expect(body(always.referee, ALWAYS)).toMatchObject({ reasoning_effort: 'low', reasoning: { exclude: true } });
    // A narrator asked to think hard, where the model takes that effort; and where it does not.
    const hard = await realRequests(choice(THINKER, THINKER, 'medium'));
    expect(body(hard.narrator, THINKER)).toMatchObject({ reasoning_effort: 'medium', reasoning: { exclude: true } });
    // A model without "medium" thinks at the nearest effort it lists, the lower on a tie, not at its own default.
    expect(body(hard.narrator, ALWAYS)).toMatchObject({ reasoning_effort: 'low' });
    expect(body(hard.narrator, ALWAYS).reasoning).toEqual({ exclude: true });
    // A model that does not think is told nothing about thinking.
    const plain = await realRequests(choice(PLAIN, PLAIN));
    for (const req of [plain.referee, plain.narrator]) {
      expect(body(req, PLAIN)).not.toHaveProperty('reasoning_effort');
      expect(body(req, PLAIN)).not.toHaveProperty('reasoning');
    }
  });

  it('asks for providers that keep nothing only when “Private providers only” is on', async () => {
    const { narrator, referee } = await realRequests(choice(TEE_WRITER, TEE));
    for (const req of [narrator, referee]) {
      expect(body(req, req === narrator ? TEE_WRITER : TEE, true).provider).toEqual({ zdr: true });
      expect(body(req, req === narrator ? TEE_WRITER : TEE, false)).not.toHaveProperty('provider');
    }
  });

  it('holds the scribe to its schema on a model that can be, and says the shape in words to one that cannot', async () => {
    const { scribe } = await realRequests(choice(PLAIN, TEE));
    expect(body(scribe, TEE).response_format).toEqual({ type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: jsonShape(ScribeOut) } });
    expect(body(scribe, PLAIN)).not.toHaveProperty('response_format');
    // JSON mode is never asked for: the shape in words does its work.
    expect(nanoAdapter.jsonMode(PLAIN)).toBe(false);
  });
});

describe('what NanoGPT charges', () => {
  const answer = (u: Record<string, unknown>) => fakeFetch(() => sse([delta('The door opens.'), finish(), usage({ prompt_tokens: 9000, completion_tokens: 120, prompt_tokens_details: { cached_tokens: 6000 }, ...u })]));
  const charge = async (u: Record<string, unknown>) => {
    const { narrator } = await realRequests(choice(PLAIN, TEE));
    return nanoTransport('k', { privateOnly: false }, { fetch: answer(u) }).send(narrator);
  };

  it('takes the exact charge NanoGPT reports in dollars', async () => {
    expect((await charge({ cost: 0.0042 })).cost).toBe(0.0042);
    expect((await charge({ cost: '0.0042' })).cost).toBe(0.0042);
    expect((await charge({ estimated_cost: 0.003 })).cost).toBe(0.003);
    expect((await charge({ cost: 0.0042, currency: 'usd' })).cost).toBe(0.0042);
  });

  it('works the cost out from the usage when the charge is not given in dollars', async () => {
    const nano = await charge({ cost: 12, currency: 'XNO' });
    expect(nano.cost).toBeUndefined();
    const none = await charge({});
    expect('cost' in none).toBe(false);
    expect(none.usage).toEqual({ input: 3000, cacheRead: 6000, cacheWrite5m: 0, cacheWrite1h: 0, output: 120 });
    expect(none.model).toBe('nanogpt:sao10k/l3.3-euryale-70b');
    expect(costOf(none.model, none.usage)).toBeCloseTo((3000 * 0.2 + 6000 * 0.2 + 120 * 0.8) / 1_000_000, 12);
  });
});

describe('NanoGPT’s own errors', () => {
  it('explains a model with no provider that keeps nothing, while “Private providers only” is on', async () => {
    const { narrator } = await realRequests(choice(PLAIN, TEE));
    for (const code of ['zdr_provider_required', 'zero_data_retention']) {
      const tr = nanoTransport('k', { privateOnly: true }, { fetch: fakeFetch(() => json({ error: { message: 'No ZDR provider is available for this model', code } }, 400)) });
      const e = await tr.send(narrator).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(LlmError);
      expect(e).toMatchObject({ kind: 'bad_request', status: 400, service: 'nanogpt' });
      expect((e as LlmError).message).toContain('Private providers only');
    }
  });
});

describe('checking a NanoGPT key', () => {
  it('asks NanoGPT for the balance with the key, and reads it in dollars', async () => {
    const seen: Sent[] = [];
    expect(await checkNanoKey('nano-123', { fetch: fakeFetch(() => json({ usd_balance: '4.25', nano_balance: '1.2' }), seen) })).toBe(4.25);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://nano-gpt.com/api/check-balance');
    expect(seen[0]!.method).toBe('POST');
    expect(seen[0]!.headers.get('x-api-key')).toBe('nano-123');
    expect(await checkNanoKey('k', { fetch: fakeFetch(() => json({ balance: 7 })) })).toBe(7);
    expect(await checkNanoKey('k', { fetch: fakeFetch(() => json({})) })).toBeNull();
  });

  it('says when the key is not accepted, or the check could not be made', async () => {
    await expect(checkNanoKey('k', { fetch: fakeFetch(() => json({ error: { message: 'Malformed API key.', code: 'malformed_api_key' } }, 401)) }))
      .rejects.toMatchObject({ kind: 'auth', status: 401, service: 'nanogpt' });
    await expect(checkNanoKey('k', { fetch: fakeFetch(() => json({}, 429, { 'retry-after': '5' })) })).rejects.toMatchObject({ kind: 'rate', retryAfter: 5, service: 'nanogpt' });
    await expect(checkNanoKey('k', { fetch: fakeFetch(() => json({}, 500)) })).rejects.toMatchObject({ kind: 'other', status: 500, service: 'nanogpt' });
    await expect(checkNanoKey('k', { fetch: (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch })).rejects.toMatchObject({ kind: 'offline', service: 'nanogpt' });
  });
});

describe('NanoGPT’s list of models', () => {
  it('keeps a model as the game needs it: its id with the prefix, prices per million, privacy and what it can do', () => {
    expect(TEE).toMatchObject({
      id: 'nanogpt:TEE/gemma4-31b', label: 'Gemma 4 31B (TEE)', input: 0.25, output: 0.9,
      thinkingOff: { type: 'disabled' }, structured: true, vision: true, thinks: false, efforts: [],
      privacy: 'private', context: 131_072, maxOutput: 8192, category: 'Private/TEE',
    });
    // The list gives the cache price per thousand tokens.
    expect(TEE.cacheRead).toBeCloseTo(0.0625, 10);
    // Without one, a cached token is priced as any other.
    expect(PLAIN.cacheRead).toBe(0.2);
    // Only the Private/TEE models keep nothing.
    expect([THINKER, ALWAYS, PLAIN].map((m) => m.privacy)).toEqual(['passed-on', 'passed-on', 'passed-on']);
    expect(PLAIN.category).toBe('Roleplay/storytelling models');
    // A model that thinks can be told not to only when it takes the effort "none".
    expect(THINKER).toMatchObject({ thinks: true, thinkingOff: { type: 'disabled' }, efforts: ['none', 'low', 'medium', 'high'] });
    expect(ALWAYS).toMatchObject({ thinks: true, thinkingOff: null });
    expect(nanoModelOf(raw('eyes', { capabilities: { vision: true } }))?.vision).toBe(true);
    expect(nanoModelOf({ id: 'bare', pricing: { prompt: 0.1, completion: 0.2 } })).toMatchObject({ id: 'nanogpt:bare', label: 'bare', privacy: 'passed-on', context: null, maxOutput: null });
  });

  it('leaves out models that are not available, that do not write text, or that have no price', () => {
    expect(nanoModelOf(raw('gone', { available: false }))).toBeNull();
    expect(nanoModelOf(raw('painter', { architecture: { input_modalities: ['text'], output_modalities: ['image'] } }))).toBeNull();
    expect(nanoModelOf(raw('both', { architecture: { input_modalities: ['text'], output_modalities: ['text', 'image'] } }))).toBeNull();
    expect(nanoModelOf(raw('listener', { architecture: { input_modalities: ['audio'], output_modalities: ['text'] } }))).toBeNull();
    expect(nanoModelOf(raw('free', { pricing: undefined }))).toBeNull();
    expect(nanoModelOf(raw('half', { pricing: { prompt: 1 } }))).toBeNull();
  });

  it('reads the public list without a key', async () => {
    const seen: Sent[] = [];
    const list = await listNanoModels({ fetch: fakeFetch(() => json({ object: 'list', data: [raw('a'), raw('gone', { available: false }), raw('TEE/b', { category: 'Private/TEE' })] }), seen) });
    expect(list.map((m) => [m.id, m.privacy])).toEqual([['nanogpt:a', 'passed-on'], ['nanogpt:TEE/b', 'private']]);
    expect(seen[0]!.url).toBe('https://nano-gpt.com/api/v1/models?detailed=true');
    expect(seen[0]!.headers.get('authorization')).toBeNull();
    expect(seen[0]!.headers.get('x-api-key')).toBeNull();
    await expect(listNanoModels({ fetch: fakeFetch(() => json({}, 503)) })).rejects.toMatchObject({ kind: 'other', service: 'nanogpt' });
  });
});

describe('a game on NanoGPT', () => {
  it('sends a real scribe request through NanoGPT and reads the answer into the scribe’s shape', async () => {
    const { scribe } = await realRequests(choice(TEE_WRITER, TEE));
    const seen: Sent[] = [];
    const tr = nanoTransport('k', { privateOnly: true }, {
      fetch: fakeFetch(() => sse([...streamed(JSON.stringify(SCRIBE), 29), finish('stop'), usage({ prompt_tokens: 3100, completion_tokens: 210, cost: 0.0011 })], 13), seen),
    });
    const res = await tr.send(scribe);
    expect(res.parsed).toEqual(SCRIBE);
    expect(res).toMatchObject({ model: TEE.id, cost: 0.0011, stop: 'end_turn' });
    expect(seen[0]!.body).toMatchObject({ model: 'TEE/gemma4-31b', provider: { zdr: true }, response_format: { type: 'json_schema' } });
  });

  it('plays a turn and closes a scene with every request on NanoGPT, private providers only', async () => {
    const seen: Sent[] = [];
    const roleOf = (sent: Sent) => {
      const system = String((sent.body?.messages as ChatMessage[] | undefined)?.[0]?.content ?? '');
      return system.startsWith('You are the referee') ? 'referee' : system.startsWith('You keep the records') ? 'scribe' : 'narrator';
    };
    const nanogpt = nanoTransport('nano-key', { privateOnly: true }, {
      fetch: fakeFetch((sent) => {
        const role = roleOf(sent);
        const text = role === 'referee' ? JSON.stringify(ACT) : role === 'scribe' ? JSON.stringify(SCRIBE) : 'Mira shrugs. “The Watch is afraid,” she says.';
        return sse([...streamed(text, 30), finish('stop'), usage({ prompt_tokens: 1000, completion_tokens: 80, cost: 0.0003 })]);
      }, seen),
    });
    const used: UsageEntry[] = [];
    const now = () => 1_800_000_000_000;
    const session = new Session(newStory(glassRoadSeed(), now()), {
      transport: byService({ nanogpt }), models: () => choice(TEE_WRITER, TEE),
      budget: { spentToday: () => 0, cap: () => 100, record: (e) => { used.push(e); } },
      save: () => {}, now, paging: () => false, scenes: memoryScenes(),
    });
    await session.submit('I look around.');
    const first = session.scene;
    await session.travel('guild_house');
    expect(session.blocker).toBeNull();
    expect(first.summary).toBe(SCRIBE.summary);
    expect(seen.map(roleOf)).toEqual(['referee', 'narrator', 'referee', 'scribe', 'narrator']);
    expect(seen.every((s) => s.url === CHAT_URL && s.headers.get('authorization') === 'Bearer nano-key')).toBe(true);
    expect(seen.every((s) => JSON.stringify(s.body?.provider) === '{"zdr":true}')).toBe(true);
    expect(used.map((u) => u.model)).toEqual([TEE.id, TEE_WRITER.id, TEE.id, TEE.id, TEE_WRITER.id]);
    expect(used.every((u) => u.cost === 0.0003)).toBe(true);
  });
});
