// The connection Venice and NanoGPT share (src/game/llm/openai.ts): Claude's request in chat form, the
// body a service is sent, the streamed answer as it is read, structured answers held to their schema,
// and the errors as the player is told them. What is common is tested against both services' adapters;
// what is each service's own is in venice.test.ts and nanogpt.test.ts.
import { describe, expect, it, vi } from 'vitest';
import { nanoAdapter, nanoTransport } from '../src/game/llm/nanogpt';
import {
  THINKING_ROOM, WORDED_ROOM, chatBody, jsonIn, jsonShape, shapeInWords, structured, toChatMessages, visibleText,
  type Adapter, type ChatMessage, type ConnectionOptions,
} from '../src/game/llm/openai';
import { ownModelId, type ModelInfo, type Service } from '../src/game/llm/models';
import { pictureRequest } from '../src/game/llm/requests';
import {
  CharacterOut, ExpandOut, FrontsOut, GlossaryOut, PeopleOut, QuestionsOut, RulesOut, SeedsOut, SkeletonOut, StartOut,
} from '../src/game/llm/architect';
import { EpilogueOut, RefereeOut, RefereeOutGift, ScribeOut } from '../src/game/llm/schemas';
import { LlmError, type LlmRequest, type MessageParams, type MockHints, type SendOptions, type Transport } from '../src/game/llm/transport';
import { veniceAdapter, veniceTransport } from '../src/game/llm/venice';
import {
  choice, delta, fakeFetch, finish, json, model, realRequests, register, silentFetch, sse, streamed, usage, type Sent,
} from './fakeService';

/** What a service is sent, as far as these tests read it. */
interface Body {
  model: string;
  messages: ChatMessage[];
  max_tokens: number;
  stream: boolean;
  stream_options: unknown;
  response_format?: { type: string; json_schema?: { name: string; strict: boolean; schema: Record<string, unknown> } };
}
const bodyOf = (req: LlmRequest, m: ModelInfo, adapter: Adapter, opts: ConnectionOptions = { privateOnly: false }): Body =>
  chatBody(req, m, adapter, opts) as unknown as Body;
const sentBody = (s: Sent | undefined): Body => s?.body as unknown as Body;

type Message = MessageParams['messages'][number];
const textOf = (m: Message): string => (typeof m.content === 'string' ? m.content : m.content.map((b) => (b.type === 'text' ? b.text : '')).join(''));

// Models as the two services list them. All are private, so that Venice's "own models only" never stands in the way here.
const V = {
  judge: model('venice:test-judge', { structured: true, thinks: true, efforts: ['low', 'medium', 'high'], maxOutput: 16_384 }),
  writer: model('venice:test-writer', { label: 'Test Writer' }),
  always: model('venice:test-always-thinks', { structured: true, thinks: true, thinkingOff: null, efforts: ['low', 'high'] }),
  alwaysWorded: model('venice:test-always-thinks-worded', { thinks: true, thinkingOff: null }),
  small: model('venice:test-small', { thinks: true, thinkingOff: null, maxOutput: 1200 }),
  refusesSchema: model('venice:test-refuses-schema', { structured: true }),
  otherError: model('venice:test-other-error', { structured: true }),
};
const N = {
  judge: model('nanogpt:test/judge', { structured: true, thinks: true, efforts: ['none', 'low', 'medium', 'high'], category: 'Private/TEE' }),
  writer: model('nanogpt:test/writer', { label: 'Test Writer' }),
  always: model('nanogpt:test/always-thinks', { structured: true, thinks: true, thinkingOff: null, efforts: ['low', 'high'] }),
  alwaysWorded: model('nanogpt:test/always-thinks-worded', { thinks: true, thinkingOff: null }),
  small: model('nanogpt:test/small', { thinks: true, thinkingOff: null, maxOutput: 1200 }),
  refusesSchema: model('nanogpt:test/refuses-schema', { structured: true }),
  otherError: model('nanogpt:test/other-error', { structured: true }),
};
register(...Object.values(V), ...Object.values(N));

const SERVICES = [
  { name: 'Venice', service: 'venice' as Service, adapter: veniceAdapter, connect: veniceTransport, m: V, url: 'https://api.venice.ai/api/v1/chat/completions' },
  { name: 'NanoGPT', service: 'nanogpt' as Service, adapter: nanoAdapter, connect: nanoTransport, m: N, url: 'https://nano-gpt.com/api/v1/chat/completions' },
];

/** A referee's answer as a careful model would give it. */
const REFEREE: RefereeOut = {
  kind: 'talk',
  check: { attribute: 'skill', skill: 'Manipulation', difficulty: 'medium', label: 'bluff past Captain Roth', opposed_by: 'roth' },
  targets: ['roth'], mentions: ['the harbour master'], recall: [], move_to: null, held: null, ability: null, improvise: null, minutes: 5,
  why_impossible: null, ask: null, ask_options: [], trade: null, contest: null, toward_contest: false,
};
/** A scribe's answer for a short scene. */
const SCRIBE: ScribeOut = {
  summary: 'You watched the bridge and asked Mira about the Watch. She thinks they are nervous about something.',
  story_so_far: 'You reached the canal bridge with Mira. The Watch is on edge, and nobody will say why.',
  events: [{ text: 'You asked Mira what she made of the Watch.', importance: 'small', reach: 'secret', actors: ['mira'], witnesses: ['mira'] }],
  attitudes: [{ who: 'mira', attitude: 'warmer', why: 'you asked her opinion' }],
  people: [], fronts: [], looks: [], chapter: null,
};

/** Every object in a JSON Schema, nested ones included. */
type Node = { properties?: Record<string, Node>; required?: string[]; additionalProperties?: unknown; anyOf?: Node[]; items?: Node };
function objectsIn(n: Node, out: Node[] = []): Node[] {
  if (n.properties) {
    out.push(n);
    for (const p of Object.values(n.properties)) objectsIn(p, out);
  }
  for (const b of n.anyOf ?? []) objectsIn(b, out);
  if (n.items) objectsIn(n.items, out);
  return out;
}

describe('Claude’s request in chat form', () => {
  it('joins the system blocks into one system message, and each engine note to the player’s line before it', () => {
    const params = {
      system: [{ type: 'text', text: 'The contract.' }, { type: 'text', text: 'The world.', cache_control: { type: 'ephemeral', ttl: '1h' } }],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'The packet.', cache_control: { type: 'ephemeral' } }] },
        { role: 'user', content: [{ type: 'text', text: 'I look around.' }] },
        { role: 'system', content: 'result: nothing stirs.' },
        { role: 'assistant', content: 'The rain keeps falling.' },
        { role: 'user', content: [{ type: 'text', text: 'I wait.', cache_control: { type: 'ephemeral' } }] },
        { role: 'system', content: 'now: an hour later.' },
      ],
    } as unknown as Pick<MessageParams, 'system' | 'messages'>;
    expect(toChatMessages(params)).toEqual([
      { role: 'system', content: 'The contract.\n\nThe world.' },
      { role: 'user', content: 'The packet.\n\nI look around.\n\nresult: nothing stirs.' },
      { role: 'assistant', content: 'The rain keeps falling.' },
      { role: 'user', content: 'I wait.\n\nnow: an hour later.' },
    ]);
    // What a service is told besides goes at the end of the system message; a system given as one text works the same.
    expect(toChatMessages({ ...params, system: 'The rules.' }, 'ANSWER FORMAT.')[0]).toEqual({ role: 'system', content: 'The rules.\n\nANSWER FORMAT.' });
  });

  it('turns a real narrator request into one system message, then the player and the narrator in turn', async () => {
    const { narrator } = await realRequests(choice(V.writer, V.judge));
    const p = narrator.params;
    const msgs = toChatMessages(p);
    // The narrator's contract and the world, as Claude gets them, in one message at the top and nowhere else.
    const system = (p.system as { text: string }[]).map((b) => b.text);
    expect(system).toHaveLength(2);
    expect(msgs[0]).toEqual({ role: 'system', content: system.join('\n\n') });
    expect(msgs.slice(1).some((m) => m.role === 'system')).toBe(false);
    // The player first and last, the narrator between, never two of one in a row.
    const roles = msgs.slice(1).map((m) => m.role);
    expect(roles[0]).toBe('user');
    expect(roles[roles.length - 1]).toBe('user');
    roles.forEach((r, i) => { if (i > 0) expect(r).not.toBe(roles[i - 1]); });
    // Each engine note travels with the player's line it follows, in the same order; each reply is a message of its own.
    expect(p.messages.filter((m) => m.role === 'system').length).toBeGreaterThanOrEqual(2);
    p.messages.forEach((m, i) => {
      if (m.role === 'system') {
        const before = textOf(p.messages[i - 1]!);
        expect(msgs.some((c) => c.role === 'user' && (c.content as string).includes(`${before}\n\n${textOf(m)}`))).toBe(true);
      }
      if (m.role === 'assistant') expect(msgs).toContainEqual({ role: 'assistant', content: textOf(m) });
    });
    const now = p.messages.slice(-2).map(textOf);
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: now.join('\n\n') });
    expect(now[0]).toBe('I ask Mira what she makes of the Watch.');
  });

  it('sends a picture as a data address beside the words about it', () => {
    const req = pictureRequest({ data: 'iVBORw0KGgo=', mediaType: 'image/png' }, 'Mira', 'the scar is on her left cheek', 'en', choice(V.writer, V.judge), {} as MockHints);
    const msgs = toChatMessages(req.params);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({ role: 'system', content: req.params.system });
    expect(msgs[1]).toEqual({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
        { type: 'text', text: 'This picture shows Mira. The player adds: "the scar is on her left cheek"\nWrite both lines in English.' },
      ],
    });
  });
});

describe.each(SERVICES)('the body sent to $name', ({ adapter, m }) => {
  it('asks for a stream with its usage, of the model by the service’s own id', async () => {
    const { narrator } = await realRequests(choice(m.writer, m.judge));
    const body = bodyOf(narrator, m.writer, adapter);
    expect(body.model).toBe(ownModelId(m.writer.id));
    expect(body.model).not.toContain(':');
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.messages).toEqual(toChatMessages(narrator.params));
    // Story text has no shape, and the narrator gets exactly the room the game gave it.
    expect(body.response_format).toBeUndefined();
    expect(body.max_tokens).toBe(narrator.params.max_tokens);
  });

  it('holds a model with structured outputs to the schema, strictly, without the "$schema" key', async () => {
    const { referee, scribe } = await realRequests(choice(m.writer, m.judge));
    for (const [req, schema] of [[referee, RefereeOut], [scribe, ScribeOut]] as const) {
      const body = bodyOf(req, m.judge, adapter);
      expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: jsonShape(schema) } });
      const shape = body.response_format!.json_schema!.schema;
      expect(shape).not.toHaveProperty('$schema');
      // What strict mode asks of a schema: every object closed, every property required.
      const objects = objectsIn(shape as Node);
      expect(objects.length).toBeGreaterThan(3);
      for (const o of objects) {
        expect(o.additionalProperties).toBe(false);
        expect([...(o.required ?? [])].sort()).toEqual(Object.keys(o.properties!).sort());
      }
    }
  });

  it('still says the shape in words to a model held to it: the descriptions carry the game’s rules', async () => {
    const { referee } = await realRequests(choice(m.writer, m.judge));
    const system = bodyOf(referee, m.judge, adapter).messages[0]!;
    expect(system.role).toBe('system');
    expect((system.content as string).endsWith(shapeInWords(jsonShape(RefereeOut)))).toBe(true);
  });

  it('tells a model without structured outputs the shape in words, after the instructions, and gives it room for them', async () => {
    const { referee, scribe } = await realRequests(choice(m.writer, m.writer));
    for (const [req, schema] of [[referee, RefereeOut], [scribe, ScribeOut]] as const) {
      const body = bodyOf(req, m.writer, adapter);
      expect(body.response_format).toBeUndefined();
      const system = body.messages[0]!;
      expect(system.role).toBe('system');
      expect(system.content).toBe(`${req.params.system as string}\n\n${shapeInWords(jsonShape(schema))}`);
      // Every field is named in the words, with what goes in it: the descriptions carry the game's rules.
      for (const [field, s] of Object.entries(jsonShape(schema).properties as Record<string, { description?: string }>)) {
        expect(system.content).toContain(`"${field}"`);
        if (s.description) expect(system.content).toContain(s.description.replace(/\s+/g, ' '));
      }
      expect(body.max_tokens).toBe(req.params.max_tokens + WORDED_ROOM);
    }
  });

  it('gives a structured answer on a model that thinks room to think, within what the model can write', async () => {
    // The game asks a referee for 500 tokens and a scribe for 950. A model that thinks may think anyway,
    // and a structured answer cut short is worth nothing.
    for (const thinker of [m.always, m.judge]) {
      const { referee, scribe } = await realRequests(choice(m.writer, thinker));
      expect(referee.params.max_tokens).toBe(500);
      expect(bodyOf(referee, thinker, adapter).max_tokens).toBe(500 + THINKING_ROOM);
      expect(bodyOf(scribe, thinker, adapter).max_tokens).toBe(scribe.params.max_tokens + THINKING_ROOM);
    }
    // Told the shape in words as well: both rooms.
    const worded = await realRequests(choice(m.writer, m.alwaysWorded));
    expect(bodyOf(worded.referee, m.alwaysWorded, adapter).max_tokens).toBe(500 + THINKING_ROOM + WORDED_ROOM);
    // A model that does not think gets no room for thinking.
    const plain = await realRequests(choice(m.writer, m.writer));
    expect(bodyOf(plain.referee, m.writer, adapter).max_tokens).toBe(500 + WORDED_ROOM);
    // Never more than the model can write in one answer.
    const small = await realRequests(choice(m.writer, m.small));
    expect(bodyOf(small.referee, m.small, adapter).max_tokens).toBe(1200);
  });

  it('keeps the narrator’s limit as the game set it: its request already has room for thinking where the model needs it', async () => {
    for (const writer of [m.always, m.judge, m.writer]) {
      const { narrator } = await realRequests(choice(writer, m.judge));
      expect(bodyOf(narrator, writer, adapter).max_tokens).toBe(narrator.params.max_tokens);
    }
    // A model that cannot stop thinking was given the room by the game itself.
    const always = (await realRequests(choice(m.always, m.judge))).narrator.params.max_tokens;
    const can = (await realRequests(choice(m.judge, m.judge))).narrator.params.max_tokens;
    expect(always - can).toBe(2000);
  });

  // The request that reads a picture (requests.ts pictureRequest: role "scribe", no schema, max_tokens 300)
  // turns thinking off where the model can. On a model that cannot (thinks, thinkingOff null, as NanoGPT
  // lists a reasoning model without a "none" effort), 300 tokens in all would be spent thinking and nothing
  // would come back ("Nothing came back for that picture."): it is given room to think.
  it('gives a picture read by a model that cannot stop thinking room to think', () => {
    const req = pictureRequest({ data: 'iVBORw0KGgo=', mediaType: 'image/png' }, 'Mira', '', 'en', { ...choice(m.writer, m.judge), vision: m.always.id }, {} as MockHints);
    expect(req.params.max_tokens).toBe(300);
    expect(bodyOf(req, m.always, adapter).max_tokens).toBe(300 + THINKING_ROOM);
  });
});

describe.each(SERVICES)('the answer from $name', ({ connect, m, url }) => {
  const opts = { privateOnly: false };

  it('streams the story in pieces that add up to the whole, and reads the usage and the cache', async () => {
    const { narrator } = await realRequests(choice(m.writer, m.judge));
    const story = 'The rain keeps falling on the bridge.\n\nMira’s eyes narrow. “Não aqui,” she says, and looks at the Watch.';
    const seen: Sent[] = [];
    // Cut every 5 bytes: lines, JSON and the letters written in more than one byte all fall across reads.
    const tr = connect('key-123', opts, {
      fetch: fakeFetch(() => sse([...streamed(story), finish('stop'), usage({ prompt_tokens: 9000, completion_tokens: 120, prompt_tokens_details: { cached_tokens: 6000 } })], 5), seen),
    });
    const pieces: string[] = [];
    const res = await tr.send(narrator, { onText: (d) => pieces.push(d) });
    expect(res.text).toBe(story);
    expect(pieces.length).toBeGreaterThan(5);
    expect(pieces.join('')).toBe(story);
    // What came from the cache is counted apart from what was read fresh.
    expect(res.usage).toEqual({ input: 3000, cacheRead: 6000, cacheWrite5m: 0, cacheWrite1h: 0, output: 120 });
    // Recorded under the game's id for the model, which says the service.
    expect(res.model).toBe(m.writer.id);
    expect(res).toMatchObject({ stop: 'end_turn', refusal: null, simulated: false, parsed: null });
    // Sent once, to the service's own address, with the key as a bearer token, and to nowhere else.
    expect(seen.map((x) => `${x.method} ${x.url}`)).toEqual([`POST ${url}`]);
    expect(seen[0]!.headers.get('authorization')).toBe('Bearer key-123');
    expect(seen[0]!.headers.get('content-type')).toBe('application/json');
  });

  it('keeps a model’s written-out thinking off the page, even when its tags arrive in pieces', async () => {
    const { narrator } = await realRequests(choice(m.writer, m.judge));
    const tr = connect('k', opts, {
      fetch: fakeFetch(() => sse([
        delta('<thi'), delta('nk>Plan: Mira lies about the Watch.</th'), delta('ink>\n\nThe door '),
        delta('opens. <th'), delta('ink>more plans</think> '), delta('Mira waits.'), finish('stop'),
      ], 3)),
    });
    const pieces: string[] = [];
    const res = await tr.send(narrator, { onText: (d) => pieces.push(d) });
    expect(res.text).toBe('The door opens. Mira waits.');
    expect(pieces.join('')).toBe(res.text);
    for (const p of pieces) expect(p).not.toMatch(/<|think|Plan|plans/);
  });

  it('never shows a structured answer as it arrives, and reads it into the shape', async () => {
    const { referee } = await realRequests(choice(m.writer, m.judge));
    const tr = connect('k', opts, { fetch: fakeFetch(() => sse([...streamed(JSON.stringify(REFEREE), 23), finish('stop'), usage({ prompt_tokens: 1800, completion_tokens: 160 })])) });
    const onText = vi.fn();
    const res = await tr.send(referee, { onText });
    expect(onText).not.toHaveBeenCalled();
    expect(res.parsed).toEqual(REFEREE);
    expect(res.text).toBe(JSON.stringify(REFEREE));
    expect(res.usage).toEqual({ input: 1800, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, output: 160 });
  });

  it('says when an answer was cut off at its limit', async () => {
    const { narrator } = await realRequests(choice(m.writer, m.judge));
    const tr = connect('k', opts, { fetch: fakeFetch(() => sse([delta('The door opens and'), finish('length')])) });
    const res = await tr.send(narrator);
    expect(res.stop).toBe('max_tokens');
    expect(res.text).toBe('The door opens and');
  });

  it('reports a refusal, and gives no structured answer with it', async () => {
    const { referee } = await realRequests(choice(m.writer, m.judge));
    const refusal = (text: string) => ({ choices: [{ index: 0, delta: { refusal: text }, finish_reason: null }] });
    const said = await connect('k', opts, { fetch: fakeFetch(() => sse([refusal('I can’t help '), refusal('with that.'), finish('stop')])) }).send(referee);
    expect(said).toMatchObject({ stop: 'refusal', refusal: { category: null, explanation: 'I can’t help with that.' }, parsed: null });
    // A filter that stopped the answer is a refusal too, even when what came before it would parse.
    const filtered = await connect('k', opts, { fetch: fakeFetch(() => sse([...streamed(JSON.stringify(REFEREE), 40), finish('content_filter')])) }).send(referee);
    expect(filtered).toMatchObject({ stop: 'refusal', refusal: { category: null, explanation: null }, parsed: null });
  });

  it('works the usage out from the text when the service does not report it', async () => {
    const { narrator } = await realRequests(choice(m.writer, m.judge));
    const tr = connect('k', opts, { fetch: fakeFetch(() => sse([delta('x'.repeat(400)), finish('stop')])) });
    const res = await tr.send(narrator);
    expect(res.usage.output).toBe(100);
    expect(res.usage.cacheRead).toBe(0);
    // About a quarter of the characters sent.
    const sent = JSON.stringify(toChatMessages(narrator.params)).length;
    expect(res.usage.input).toBeGreaterThan(sent / 5);
    expect(res.usage.input).toBeLessThan(sent / 3);
  });
});

describe('structured answers', () => {
  const text = (v: unknown) => JSON.stringify(v);
  const without = <T extends object>(v: T, ...keys: (keyof T)[]): Partial<T> => {
    const out: Partial<T> = { ...v };
    for (const k of keys) delete out[k];
    return out;
  };

  it('reads plain JSON, JSON in a code fence, and JSON with words around it', () => {
    expect(structured(text(REFEREE), RefereeOut)).toEqual(REFEREE);
    expect(structured(`\`\`\`json\n${JSON.stringify(REFEREE, null, 2)}\n\`\`\``, RefereeOut)).toEqual(REFEREE);
    expect(structured(`\`\`\`\n${text(SCRIBE)}\n\`\`\``, ScribeOut)).toEqual(SCRIBE);
    expect(structured(`Here is the classification you asked for:\n${text(REFEREE)}\nI hope this helps.`, RefereeOut)).toEqual(REFEREE);
    expect(jsonIn('no JSON here')).toBeUndefined();
  });

  it('fills a missing field that may be null with null, and a missing list with an empty one', () => {
    expect(structured(text(without(REFEREE, 'held', 'why_impossible', 'trade', 'contest', 'improvise')), RefereeOut)).toEqual(REFEREE);
    expect(structured(text(without(REFEREE, 'targets', 'mentions', 'recall', 'ask_options')), RefereeOut))
      .toEqual({ ...REFEREE, targets: [], mentions: [] });
    // Inside a nested object too.
    expect(structured(text({ ...REFEREE, check: without(REFEREE.check!, 'skill', 'opposed_by') }), RefereeOut))
      .toEqual({ ...REFEREE, check: { ...REFEREE.check!, skill: null, opposed_by: null } });
    expect(structured(text(without(SCRIBE, 'people', 'fronts', 'looks', 'chapter')), ScribeOut)).toEqual(SCRIBE);
  });

  it('mends an enum word written in the wrong case, and a number written as text', () => {
    const sloppy = { ...REFEREE, kind: 'Talk', check: { ...REFEREE.check!, attribute: 'Skill', skill: 'manipulation', difficulty: 'MEDIUM' }, minutes: '5' };
    expect(structured(text(sloppy), RefereeOut)).toEqual(REFEREE);
    const events = [{ ...SCRIBE.events[0]!, importance: 'Small', reach: ' Secret ' }];
    expect(structured(text({ ...SCRIBE, events }), ScribeOut)).toEqual(SCRIBE);
  });

  it('gives nothing for an answer that cannot be used', () => {
    expect(structured(text({ ...REFEREE, kind: 'dance' }), RefereeOut)).toBeNull(); // not one of the kinds
    expect(structured(text(without(REFEREE, 'minutes')), RefereeOut)).toBeNull(); // a required number, missing
    expect(structured(text({ ...REFEREE, toward_contest: 'maybe' }), RefereeOut)).toBeNull();
    expect(structured(text(REFEREE).slice(0, 80), RefereeOut)).toBeNull(); // cut off
    expect(structured('I would call this a conversation with Captain Roth.', RefereeOut)).toBeNull();
    expect(structured(text({ ...SCRIBE, events: [{ text: 'Something happened.' }] }), ScribeOut)).toBeNull();
  });

  it.each(SERVICES)('mends what a model told the shape in words sends back through $name', async ({ connect, m }) => {
    const { referee } = await realRequests(choice(m.writer, m.writer));
    const answer = `Sure! Here is the JSON:\n\`\`\`json\n${text({ ...without(REFEREE, 'held', 'trade', 'ask_options'), kind: 'TALK' })}\n\`\`\``;
    const res = await connect('k', { privateOnly: false }, { fetch: fakeFetch(() => sse([...streamed(answer, 31), finish('stop')])) }).send(referee);
    expect(res.parsed).toEqual(REFEREE);
    const bad = await connect('k', { privateOnly: false }, { fetch: fakeFetch(() => sse([delta('{"kind": "talk", "minutes": '), finish('length')])) }).send(referee);
    expect(bad.parsed).toBeNull();
    expect(bad.stop).toBe('max_tokens');
  });
});

describe.each(SERVICES)('errors from $name', ({ service, connect, m }) => {
  const opts = { privateOnly: false };
  const failing = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    connect('k', opts, { fetch: fakeFetch(() => (typeof body === 'string' ? new Response(body, { status, headers }) : json(body, status, headers))) });
  async function errorOf(tr: Transport, opt: SendOptions = {}, req?: LlmRequest): Promise<LlmError> {
    const r = req ?? (await realRequests(choice(m.writer, m.judge))).narrator;
    try {
      await tr.send(r, opt);
    } catch (e) {
      if (e instanceof LlmError) return e;
      throw e;
    }
    throw new Error('the request did not fail');
  }

  it.each([
    ['a key the service does not know', 401, { error: { message: 'Invalid API key', code: 'invalid_api_key' } }, {}, { kind: 'auth', status: 401 }],
    ['an account with nothing left', 402, { error: { message: 'Insufficient balance', code: 'insufficient_balance' } }, {}, { kind: 'credit', status: 402 }],
    ['a key that may not do that', 403, { error: { message: 'Forbidden' } }, {}, { kind: 'auth', status: 403 }],
    ['too many requests, with how long to wait', 429, { error: { message: 'Rate limit exceeded' } }, { 'retry-after': '12' }, { kind: 'rate', status: 429, retryAfter: 12 }],
    ['too many requests, without', 429, { error: { message: 'Rate limit exceeded' } }, {}, { kind: 'rate', status: 429, retryAfter: null }],
    ['a failure on the service’s side', 500, { error: { message: 'Internal server error' } }, {}, { kind: 'overloaded', status: 500 }],
    ['a busy service, answering in plain text', 503, 'Service Unavailable', {}, { kind: 'overloaded', status: 503 }],
    ['a request the service turns down, in its own words', 400, { error: { message: 'Unknown model: test-writer' } }, {}, { kind: 'bad_request', status: 400, message: 'Unknown model: test-writer' }],
    ['a request turned down with the words alone', 400, { error: 'Context length exceeded' }, {}, { kind: 'bad_request', status: 400, message: 'Context length exceeded' }],
    ['a key at its spending limit', 403, { error: { message: 'Monthly limit reached', code: 'spend_limit_exceeded' } }, {}, { kind: 'credit', status: 403 }],
  ] as const)('%s (%i)', async (_what, status, body, headers, want) => {
    const e = await errorOf(failing(status, body, headers));
    expect(e).toMatchObject({ ...want, service });
    expect(e.retryAfter).toBe('retryAfter' in want ? want.retryAfter : null);
  });

  it('reads an error sent in the middle of the stream', async () => {
    const pieces: string[] = [];
    const e = await errorOf(connect('k', opts, { fetch: fakeFetch(() => sse([delta('The door '), { error: { message: 'upstream died', status: 502 } }, delta('opens.')])) }), { onText: (d) => pieces.push(d) });
    expect(e).toMatchObject({ kind: 'overloaded', status: 502, service });
    expect(pieces.join('')).toBe('The door ');
  });

  it('says the request did not reach the service when the network fails', async () => {
    const e = await errorOf(connect('k', opts, { fetch: (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch }));
    expect(e).toMatchObject({ kind: 'offline', status: null, service });
  });

  it('stops when the player stops it: before it is sent, and while the answer arrives', async () => {
    const seen: Sent[] = [];
    const before = new AbortController();
    before.abort();
    const tr = connect('k', opts, { fetch: fakeFetch(() => sse([...streamed('The door opens slowly, and the rain comes in with Captain Roth.', 4), finish('stop')]), seen) });
    expect(await errorOf(tr, { signal: before.signal })).toMatchObject({ kind: 'aborted', service });
    expect(seen).toHaveLength(0);
    // Stopped after the first piece: nothing more is read or shown.
    const during = new AbortController();
    const pieces: string[] = [];
    const e = await errorOf(tr, { signal: during.signal, onText: (d) => { pieces.push(d); during.abort(); } });
    expect(e).toMatchObject({ kind: 'aborted', service });
    expect(pieces).toEqual(['The ']);
  });

  it('gives up on a service that goes quiet, as busy, not as stopped by the player', async () => {
    const { narrator } = await realRequests(choice(m.writer, m.judge));
    const architect: LlmRequest = { ...narrator, role: 'architect' };
    vi.useFakeTimers();
    try {
      const story = connect('k', opts, { fetch: silentFetch() }).send(narrator).catch((e: unknown) => e);
      const building = connect('k', opts, { fetch: silentFetch() }).send(architect).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(await story).toMatchObject({ kind: 'overloaded', service });
      // Building a world thinks longest: it is given five minutes.
      let settled = false;
      void building.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(1000);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(180_000);
      expect(await building).toMatchObject({ kind: 'overloaded', service });
    } finally {
      vi.useRealTimers();
    }
  });

  it('tells a model the shape in words when its service turns the schema down, at once and from then on', async () => {
    const { referee } = await realRequests(choice(m.writer, m.refusesSchema));
    const seen: Sent[] = [];
    const tr = connect('k', opts, {
      fetch: fakeFetch((sent) => (sent.body?.response_format
        ? json({ error: { message: 'response_format json_schema is not supported for this model' } }, 400)
        : sse([...streamed(JSON.stringify(REFEREE), 25), finish('stop')])), seen),
    });
    const res = await tr.send(referee);
    expect(res.parsed).toEqual(REFEREE);
    expect(seen).toHaveLength(2);
    expect(sentBody(seen[0]).response_format?.type).toBe('json_schema');
    expect(sentBody(seen[1]).response_format).toBeUndefined();
    expect(sentBody(seen[1]).max_tokens).toBe(500 + WORDED_ROOM);
    // The next request of that model is not held to the schema again.
    await tr.send(referee);
    expect(seen).toHaveLength(3);
    expect(sentBody(seen[2]).response_format).toBeUndefined();
  });

  it('does not ask again when a request is turned down for anything else', async () => {
    const { referee } = await realRequests(choice(m.writer, m.otherError));
    const seen: Sent[] = [];
    const tr = connect('k', opts, { fetch: fakeFetch(() => json({ error: { message: 'Too many messages in the conversation' } }, 400), seen) });
    expect(await errorOf(tr, {}, referee)).toMatchObject({ kind: 'bad_request', message: 'Too many messages in the conversation', service });
    expect(seen).toHaveLength(1);
  });
});

describe('every shape the game asks for', () => {
  const SHAPES = {
    RefereeOut, RefereeOutGift, ScribeOut, EpilogueOut, QuestionsOut, SkeletonOut, FrontsOut, RulesOut, GlossaryOut, StartOut, PeopleOut, SeedsOut, CharacterOut, ExpandOut,
  };

  it.each(Object.entries(SHAPES))('%s can be held to strictly by a service, and said in words to a model', (_name, schema) => {
    const shape = jsonShape(schema);
    expect(shape).not.toHaveProperty('$schema');
    // Written out in full, with nothing to look up elsewhere.
    expect(JSON.stringify(shape)).not.toMatch(/"\$ref"|"\$defs"/);
    for (const o of objectsIn(shape as Node)) {
      expect(o.additionalProperties).toBe(false);
      expect([...(o.required ?? [])].sort()).toEqual(Object.keys(o.properties!).sort());
    }
    const words = shapeInWords(shape);
    for (const field of Object.keys(shape.properties as object)) expect(words).toContain(`"${field}"`);
  });
});

describe('the text shown while thinking is written out', () => {
  it('holds back only what may be the start of a thinking tag', () => {
    expect(visibleText('Before <think>still thinking')).toBe('Before ');
    expect(visibleText('Before <thi')).toBe('Before ');
    expect(visibleText('<think>a plan</think>\n\nAfter.')).toBe('After.');
    expect(visibleText('A <b>bold</b> move, 3 < 4.')).toBe('A <b>bold</b> move, 3 < 4.');
  });
});
