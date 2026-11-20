// Whole turns played through the connection to Venice and to NanoGPT: every role (referee, narrator,
// scribe) goes through openai.ts to a stand-in service that answers what the demo client would have,
// in that service's format. A model held to the schema answers clean JSON; a model told the shape in
// words answers it in a code fence, with words around it and without the fields that would be null.
import { describe, expect, it } from 'vitest';
import { mockTransport } from '../src/game/llm/mock';
import { registerModel, type ModelInfo } from '../src/game/llm/models';
import { nanoTransport } from '../src/game/llm/nanogpt';
import type { ModelChoice } from '../src/game/llm/requests';
import type { LlmRequest, LlmResponse, Transport } from '../src/game/llm/transport';
import { veniceTransport } from '../src/game/llm/venice';
import { Session, type Budget } from '../src/game/session';
import { newStory } from '../src/game/story';
import type { UsageEntry } from '../src/game/types';
import { glassRoadSeed } from '../src/packs/lanternCoast';
import { fakeFetch, finish, sse, streamed, usage, type Sent } from './fakeService';
import { memoryScenes } from './helpers';

const model = (id: string, extra: Partial<ModelInfo>): ModelInfo => ({
  id, label: id, input: 0.3, output: 1.2, cacheRead: 0.01, thinkingOff: { type: 'disabled' },
  structured: true, vision: true, thinks: true, efforts: ['none', 'low', 'medium', 'high'], privacy: 'private',
  context: 1_000_000, maxOutput: 131_072, ...extra,
});

/** An answer with every null left out, as a careless model writes it: the game mends that. */
function withoutNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withoutNulls);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, withoutNulls(x)]));
  return v;
}

interface Played { session: Session; sent: Sent[]; usage: UsageEntry[]; answers: { req: LlmRequest; res: LlmResponse }[] }

/** A story played on one service: what the demo client would answer, sent back the way that service would. */
function play(connect: (f: typeof fetch) => Transport, models: ModelChoice, worded: boolean, beside: Record<string, unknown>): Played {
  let t = 1_800_000_000_000;
  const now = () => t;
  const mock = mockTransport({ now, streamDelay: 0 });
  const sent: Sent[] = [];
  const answers: Played['answers'] = [];
  const transport: Transport = {
    simulated: false,
    async send(req, opts) {
      const canned = await mock.send(req, {});
      const content = !req.schema ? canned.text
        : worded ? `Here is the answer.\n\`\`\`json\n${JSON.stringify(withoutNulls(canned.parsed))}\n\`\`\`\nI hope it helps.`
          : JSON.stringify(canned.parsed);
      const service = connect(fakeFetch(() => sse([...streamed(content, 37), finish('stop'), usage({ prompt_tokens: 1200, completion_tokens: 150, prompt_tokens_details: { cached_tokens: 800 } }, beside)], 11), sent));
      const res = await service.send(req, opts);
      answers.push({ req, res });
      t += 30_000;
      return res;
    },
  };
  const log: UsageEntry[] = [];
  const budget: Budget = { spentToday: () => log.reduce((s, u) => s + u.cost, 0), cap: () => 100, record: (e) => { log.push(e); } };
  const session = new Session(newStory(glassRoadSeed(), now()), { transport, models: () => models, budget, now, paging: () => false, scenes: memoryScenes(), save: () => {} });
  return { session, sent, usage: log, answers };
}

async function aFewTurns(p: Played): Promise<void> {
  await p.session.submit('I look around and take stock of who is watching the bridge.');
  expect(p.session.blocker).toBeNull();
  await p.session.submit('I ask Mira what she makes of the Watch.');
  expect(p.session.blocker).toBeNull();
  // Leaving ends the scene: the scribe writes it up.
  await p.session.travel('guild_house');
  expect(p.session.blocker).toBeNull();
}

describe('a story played wholly on Venice, its models held to the schema', () => {
  const writer = model('venice:deepseek-v4-1-flash-1017-uncensored', {});
  const judge = model('venice:deepseek-v4-flash', { vision: false });
  registerModel(writer);
  registerModel(judge);
  const models: ModelChoice = { narrator: writer.id, referee: judge.id, scribe: judge.id, architect: writer.id, vision: writer.id, effort: 'low' };

  it('plays turns and a scene change, with every structured answer used, priced at what Venice says it cost', async () => {
    const p = play((f) => veniceTransport('venice-key', { privateOnly: true }, { fetch: f }), models, false, { cost: { usd: 0.0005, diem: 0.0005 } });
    await aFewTurns(p);
    const story = p.session.story;
    expect(story.totals.turns).toBeGreaterThanOrEqual(2);
    // Every role went through the service, and every structured answer was usable.
    const roles = new Set(p.answers.map((a) => a.req.role));
    expect([...roles].sort()).toEqual(['narrator', 'referee', 'scribe']);
    for (const a of p.answers.filter((x) => x.req.schema)) expect(a.res.parsed).not.toBeNull();
    // The scene was written up from the scribe's answer: its events were kept.
    expect(story.events.length).toBeGreaterThan(0);
    // Recorded under Venice's models, at the charge Venice reported, with the cached part apart.
    expect(p.usage.every((u) => u.model.startsWith('venice:'))).toBe(true);
    expect(p.usage.every((u) => u.cost === 0.0005)).toBe(true);
    expect(p.usage.every((u) => u.input === 400 && u.cacheRead === 800)).toBe(true);
  });

  it('sends Venice only what it accepts: its own model ids, no system prompt of its own, a strict schema for the judging roles', async () => {
    const p = play((f) => veniceTransport('venice-key', { privateOnly: true }, { fetch: f }), models, false, {});
    await aFewTurns(p);
    expect(p.sent.length).toBeGreaterThan(0);
    for (const s of p.sent) {
      expect(s.url).toBe('https://api.venice.ai/api/v1/chat/completions');
      expect(s.headers.get('authorization')).toBe('Bearer venice-key');
      const body = s.body!;
      expect(String(body.model)).not.toMatch(/^venice:/);
      expect(body.venice_parameters).toMatchObject({ include_venice_system_prompt: false });
      // Venice's body is strict: only fields it knows.
      const allowed = ['model', 'messages', 'max_tokens', 'stream', 'stream_options', 'response_format', 'reasoning', 'reasoning_effort', 'prompt_cache_key', 'venice_parameters'];
      expect(Object.keys(body).filter((k) => !allowed.includes(k))).toEqual([]);
    }
    const judged = p.sent.filter((s) => String(s.body!.prompt_cache_key).match(/referee|scribe/));
    expect(judged.length).toBeGreaterThan(0);
    for (const s of judged) expect(s.body!.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true } });
    for (const s of p.sent.filter((x) => x.body!.prompt_cache_key === 'bq-narrator')) expect(s.body!.response_format).toBeUndefined();
  });
});

describe('a story played wholly on NanoGPT, its models told the shape in words', () => {
  const writer = model('nanogpt:z-ai/glm-5.3-flash-uncensored', { structured: false, efforts: ['low', 'high'], thinkingOff: null, privacy: 'passed-on' });
  const judge = model('nanogpt:TEE/gemma4-31b', { structured: false, thinks: false, efforts: [] });
  registerModel(writer);
  registerModel(judge);
  const models: ModelChoice = { narrator: writer.id, referee: judge.id, scribe: judge.id, architect: writer.id, vision: judge.id, effort: 'low' };

  it('still plays: answers with words around them and nulls left out are mended and used', async () => {
    const p = play((f) => nanoTransport('nano-key', { privateOnly: true }, { fetch: f }), models, true, {});
    await aFewTurns(p);
    for (const a of p.answers.filter((x) => x.req.schema)) expect(a.res.parsed).not.toBeNull();
    expect(p.session.story.events.length).toBeGreaterThan(0);
    // No exact charge from the stand-in: priced from the list.
    expect(p.usage.every((u) => u.model.startsWith('nanogpt:') && u.cost > 0)).toBe(true);
    for (const s of p.sent) {
      expect(s.url).toBe('https://nano-gpt.com/api/v1/chat/completions');
      expect(s.body!.provider).toEqual({ zdr: true });
      expect(s.body!.response_format).toBeUndefined();
      expect(s.headers.get('redaction')).toBe('false');
    }
    // The shape went in words, in the instructions.
    const referee = p.sent.find((s) => JSON.stringify(s.body!.messages).includes('ANSWER FORMAT'));
    expect(referee).toBeDefined();
  });
});
