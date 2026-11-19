// The shape of what is sent to Claude, checked against the API's rules, and the reading of what comes back.
import { describe, expect, it } from 'vitest';
import { approxTokens } from '../src/game/cards';
import { PASSAGE_MIN_CHARS, firstPassageSoFar, parseReply, speechParts, splitSpeech, storyTextSoFar } from '../src/game/llm/parse';
import { groupBeats } from '../src/game/session';
import type { Beat } from '../src/game/types';
import type { LlmRequest } from '../src/game/llm/transport';
import { harness, type Harness } from './helpers';

async function play(h: Harness, turns: number) {
  const lines = ['I look around.', 'I ask Mira what she thinks.', 'I try to bluff my way past Captain Roth.', 'I search the stalls.'];
  for (let i = 0; i < turns; i++) await h.session.submit(lines[i % lines.length]!);
}

function breakpoints(req: LlmRequest): { where: string; ttl: string }[] {
  const out: { where: string; ttl: string }[] = [];
  const sys = req.params.system;
  if (Array.isArray(sys)) sys.forEach((b, i) => { if (b.cache_control) out.push({ where: `system[${i}]`, ttl: b.cache_control.ttl ?? '5m' }); });
  req.params.messages.forEach((m, i) => {
    if (typeof m.content === 'string') return;
    for (const b of m.content) if (b.type === 'text' && b.cache_control) out.push({ where: `messages[${i}]`, ttl: b.cache_control.ttl ?? '5m' });
  });
  return out;
}

describe('a narrator request', () => {
  it('follows the rules of the Messages API', async () => {
    const h = harness();
    await play(h, 4);
    await h.session.ask('What did you mean by that?'); // a question outside the story follows the same rules
    await h.session.ask('And one more?');
    await play(h, 1);
    for (const req of h.requests.filter((r) => r.role === 'narrator')) {
      const msgs = req.params.messages;
      expect(msgs[0]!.role).toBe('user'); // the first message is always from the user
      msgs.forEach((m, i) => {
        if (m.role !== 'system') return;
        expect(i).toBeGreaterThan(0); // a system message is never first
        expect(msgs[i - 1]!.role).toBe('user'); // it follows a user message
        expect(i === msgs.length - 1 || msgs[i + 1]!.role === 'assistant').toBe(true); // and is last, or followed by the reply
        expect(typeof m.content).toBe('string'); // text only
      });
      for (const m of msgs) if (m.role === 'assistant') expect(typeof m.content === 'string' && m.content.length > 0).toBe(true); // replies are replayed as plain text
      const marks = breakpoints(req);
      expect(marks.length).toBeLessThanOrEqual(4); // at most four cache breakpoints
      const firstShort = marks.findIndex((m) => m.ttl === '5m');
      const lastLong = marks.map((m) => m.ttl).lastIndexOf('1h');
      expect(firstShort === -1 || lastLong < firstShort).toBe(true); // longer-lived entries come first
      // Parameters the current models reject are never sent.
      const p = req.params as unknown as Record<string, unknown>;
      for (const banned of ['temperature', 'top_p', 'top_k', 'tools', 'tool_choice']) expect(p[banned]).toBeUndefined();
      expect(req.params.max_tokens).toBeLessThanOrEqual(4000);
    }
  });

  it('keeps its fixed part large enough to be cached and small enough to be cheap', async () => {
    const h = harness();
    await play(h, 1);
    const req = h.requests.find((r) => r.role === 'narrator')!;
    const sys = (req.params.system as { text: string }[]).map((b) => b.text).join('');
    const tokens = approxTokens(sys);
    expect(tokens).toBeGreaterThan(512); // below this the current models do not cache at all
    expect(tokens).toBeLessThan(2500);
  });

  it('turns thinking off the way each model accepts', async () => {
    const sonnet = harness();
    await play(sonnet, 1);
    expect(sonnet.requests.find((r) => r.role === 'narrator')!.params.thinking).toEqual({ type: 'between_tools' });
    expect(sonnet.requests.find((r) => r.role === 'referee')!.params.thinking).toEqual({ type: 'disabled' });
    const opus = harness({ models: { narrator: 'claude-opus-5-5', referee: 'claude-haiku-5-5', scribe: 'claude-haiku-5-5', effort: 'low' } });
    await play(opus, 1);
    const req = opus.requests.find((r) => r.role === 'narrator')!;
    expect(req.params.thinking).toBeUndefined(); // this model always thinks; only the effort is lowered
    expect(req.params.output_config?.effort).toBe('low');
  });
});

describe('reading a reply', () => {
  it('splits story from facts and speech from narration', () => {
    const r = parseReply('Rain on the canal.\n\n@mira (low): "He\'s checking couriers."\n@Lantern seller: “Two coppers.”\n\nYou wait.\n===\ntime: 10\nbond: mira | significant | +value | You did not use her as bait.\nthread: seal | clue | Roth carries a copy.\nmove: canal_bridge\nsuggest: Cross now | Ask Mira | Wait');
    expect(r.parts.map((p) => p.type)).toEqual(['narration', 'say', 'say', 'narration']);
    expect(r.parts[1]).toMatchObject({ tag: 'mira', manner: 'low', text: "He's checking couriers." });
    expect(r.parts[2]).toMatchObject({ tag: 'Lantern seller', text: 'Two coppers.' });
    expect(r.flags.minutes).toBe(10);
    expect(r.flags.bonds[0]).toMatchObject({ who: 'mira', tier: 'significant', value: 'touches' });
    expect(r.flags.threads[0]).toMatchObject({ id: 'seal', op: 'clue' });
    expect(r.flags.moveTo).toBe('canal_bridge');
    expect(r.flags.suggestions).toEqual(['Cross now', 'Ask Mira', 'Wait']);
  });

  it('survives a reply with no facts, unknown facts, or nonsense', () => {
    expect(parseReply('Just a story.').flags.minutes).toBeNull();
    const odd = parseReply('Story.\n===\ntime: soon\nbond: mira | enormous | - | x\nwhatever: 12\nthread: | next |\n:::\nend: scene');
    expect(odd.flags.minutes).toBeNull();
    expect(odd.flags.bonds).toHaveLength(0);
    expect(odd.flags.threads).toHaveLength(0);
    expect(odd.flags.endScene).toBe(true);
    expect(parseReply('').parts).toHaveLength(0);
  });

  it('tells spoken words from a gesture inside a speech line', () => {
    const line = '"You told me the thing you could afford to. I\'d have done the same." A dry breath that is almost a laugh. "That\'s probably why I believe you."';
    expect(splitSpeech(line)).toEqual(["You told me the thing you could afford to. I'd have done the same.", 'A dry breath that is almost a laugh.', "That's probably why I believe you."]);
    expect(splitSpeech('“Fine.” He nods. “Go.”')).toEqual(['Fine.', 'He nods.', 'Go.']);
    expect(splitSpeech('He nods. "Fine."')).toEqual(['', 'He nods.', 'Fine.']); // opens with a gesture
    expect(splitSpeech('"Fine." He nods.')).toEqual(['Fine.', 'He nods.']);
    expect(splitSpeech('"Fine."')).toEqual(['Fine.']);
    expect(splitSpeech('Fine.')).toEqual(['Fine.']);
    expect(splitSpeech('"They call it "the Glass Road" for a reason."')).toEqual(['They call it "the Glass Road" for a reason.']); // a quotation inside speech
    expect(splitSpeech('"Wait—" She stops. "No."')).toEqual(['Wait—', 'She stops.', 'No.']);
    expect(splitSpeech('"Still talking')).toEqual(['Still talking']); // a line cut off while it arrives
    // The reply parser records the split only when there is a gesture.
    const r = parseReply('@roth: "I\'d have done the same." A dry breath. "That\'s why I believe you."\n@mira: "Fine."');
    expect(r.parts[0]).toMatchObject({ type: 'say', tag: 'roth', segs: ["I'd have done the same.", 'A dry breath.', "That's why I believe you."] });
    expect(r.parts[1]).not.toHaveProperty('segs');
    // Lines saved before gestures were recorded are split from their text.
    expect(speechParts('Fine." He nods. "Go.')).toEqual([{ spoken: true, text: 'Fine.' }, { spoken: false, text: 'He nods.' }, { spoken: true, text: 'Go.' }]);
    expect(speechParts("He's checking couriers.")).toEqual([{ spoken: true, text: "He's checking couriers." }]);
  });

  it('never shows the facts while the reply is still arriving', () => {
    expect(storyTextSoFar('You wait.\n\nMore.\n===\ntime: 1')).toBe('You wait.\n\nMore.');
    expect(storyTextSoFar('You wait.\n==')).toBe('You wait.');
    expect(storyTextSoFar('You wait.')).toBe('You wait.');
  });
});

describe('the first passage of a reply that is still arriving', () => {
  const long = (n: number, word: string) => Array.from({ length: n }, () => word).join(' ');
  const A = `You cross the square. ${long(14, 'lantern')}.`; // well under a passage
  const B = `The gate is shut. ${long(14, 'shutter')}.`; // A and B together make one
  const C = 'A third paragraph, for the next passage.';
  const texts = (parts: { text: string }[] | null) => parts?.map((p) => p.text) ?? null;

  it('is held back while its last paragraph may still be growing', () => {
    expect(A.length).toBeLessThan(PASSAGE_MIN_CHARS);
    expect(A.length + B.length).toBeGreaterThanOrEqual(PASSAGE_MIN_CHARS);
    expect(firstPassageSoFar('', true)).toBeNull();
    expect(firstPassageSoFar(A.slice(0, 40), true)).toBeNull();
    expect(firstPassageSoFar(A, true)).toBeNull();
    expect(firstPassageSoFar(`${A}\n\n${B.slice(0, 50)}`, true)).toBeNull();
    expect(firstPassageSoFar(`${A}\n\n${B}`, true)).toBeNull(); // long enough, but B may not be finished
    expect(firstPassageSoFar(`${A}\n\n${B}\n\n`, true)).toBeNull();
  });

  it('is given whole as soon as a later paragraph begins', () => {
    expect(texts(firstPassageSoFar(`${A}\n\n${B}\n\nA`, true))).toEqual([A, B]);
    expect(texts(firstPassageSoFar(`${A}\n\n${B}\n\n${C}\n\nAnd more`, true))).toEqual([A, B]);
    // A line of speech starts a paragraph of its own after a single line break.
    expect(texts(firstPassageSoFar(`${A}\n\n${B}\n@mira: "Wait`, true))).toEqual([A, B]);
  });

  it('a reply shorter than a passage is given when the story text ends', () => {
    expect(firstPassageSoFar('You nod.\n\nShe nods back.', true)).toBeNull();
    expect(firstPassageSoFar('You nod.\n\nShe nods back.\n==', true)).toBeNull();
    expect(texts(firstPassageSoFar('You nod.\n\nShe nods back.\n===', true))).toEqual(['You nod.', 'She nods back.']);
    expect(texts(firstPassageSoFar('You nod.\n\nShe nods back.\n===\ntime: 1', true))).toEqual(['You nod.', 'She nods back.']);
    expect(firstPassageSoFar('===\ntime: 1', true)).toBeNull(); // no story text at all
  });

  it('is the whole story when replies are not shown passage by passage', () => {
    expect(firstPassageSoFar(`${A}\n\n${B}\n\n${C}`, false)).toBeNull();
    expect(texts(firstPassageSoFar(`${A}\n\n${B}\n\n${C}\n===\ntime: 5`, false))).toEqual([A, B, C]);
  });

  it('is, at every moment of the stream, either nothing or exactly what the finished turn shows first', () => {
    const reply = `${A}\n\n@mira (low): "He is checking couriers." A glance at the gate. "Go."\n\n${B}\n\n${C}\n\n@Lantern seller: "Two coppers."\n===\ntime: 5\nsuggest: Go | Wait | Look`;
    const parsed = parseReply(reply);
    const beats: Beat[] = [
      { type: 'action', text: 'I look.', to: null },
      ...parsed.parts.map((p): Beat => (p.type === 'say' ? { type: 'say', who: '', name: p.tag, manner: p.manner, text: p.text } : { type: 'narration', text: p.text })),
    ];
    const groups = groupBeats(beats, true);
    expect(groups.length).toBeGreaterThan(1);
    const shownFirst = beats.slice(1, groups[1]).map((b) => (b.type === 'narration' || b.type === 'say' ? b.text : ''));
    let given = 0;
    for (let n = 0; n <= reply.length; n++) {
      const first = firstPassageSoFar(reply.slice(0, n), true);
      if (!first) { expect(given, `at ${n}`).toBe(0); continue; } // once given it never goes away
      given += 1;
      expect(texts(first), `at ${n}`).toEqual(shownFirst);
    }
    expect(given).toBeGreaterThan(0);
    // And it was given well before the reply was complete.
    expect(firstPassageSoFar(reply.slice(0, reply.indexOf(C) + 1), true)).not.toBeNull();
  });
});

describe('the writing style', () => {
  it('is part of the fixed instructions, and only of those', async () => {
    const text = async (prose: 'plain' | 'clear' | 'literary') => {
      const h = harness();
      h.session.updateSettings({ prose });
      await play(h, 1);
      const req = h.requests.find((r) => r.role === 'narrator')!;
      return (req.params.system as { text: string }[]).map((b) => b.text);
    };
    const plain = await text('plain');
    const clear = await text('clear');
    const literary = await text('literary');
    expect(plain[0]).toContain('no metaphors');
    expect(clear[0]).toContain('Prefer the plain word');
    expect(literary[0]).toContain('novelist');
    for (const sys of [plain, clear, literary]) expect(sys[0]).toContain('must never have to guess what happened');
    expect(plain[1]).toBe(clear[1]); // the world is not touched
  });

  it('a story saved before the setting existed gets the default', async () => {
    const h = harness();
    delete (h.session.story.settings as { prose?: string }).prose;
    await play(h, 1);
    const req = h.requests.find((r) => r.role === 'narrator')!;
    expect((req.params.system as { text: string }[])[0]!.text).toContain('Prefer the plain word');
  });
});

describe('structured outputs', () => {
  it('the referee and scribe schemas convert to the format the API takes', async () => {
    const { zodOutputFormat } = await import('@anthropic-ai/sdk/helpers/zod');
    const { RefereeOut, RefereeOutGift, ScribeOut } = await import('../src/game/llm/schemas');
    for (const schema of [RefereeOut, RefereeOutGift, ScribeOut]) {
      const format = zodOutputFormat(schema) as unknown as { type: string; schema: { type: string; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean } };
      expect(format.type).toBe('json_schema');
      expect(format.schema.type).toBe('object');
      expect(Object.keys(format.schema.properties).length).toBeGreaterThan(3);
      // Structured outputs need every property required and no extra properties.
      expect(format.schema.additionalProperties).toBe(false);
      expect((format.schema.required ?? []).sort()).toEqual(Object.keys(format.schema.properties).sort());
    }
  });
});
