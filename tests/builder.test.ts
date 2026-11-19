// Building a world: the seven steps, what happens when one of them goes wrong, and the promise that
// whatever comes back, the world that is kept passes the same check as a hand-made one.
import { describe, expect, it } from 'vitest';
import { check, type CharacterDraft } from '../src/engine';
import {
  BUILD_STEPS, BudgetReached, Unusable, WorldBuilder, assemble, cleanStep, estimateBuild, newDraft, templateOf,
  type BuildInput, type StepId, type WorldDraft,
} from '../src/game/builder';
import { STARTING_SILVER, proposalFrom, proposeCharacter, startSeed } from '../src/game/creation';
import type { CharacterOut } from '../src/game/llm/architect';
import { mockTransport } from '../src/game/llm/mock';
import { mockArchitect } from '../src/game/llm/mockArchitect';
import { LlmError, type LlmRequest, type Transport } from '../src/game/llm/transport';
import { BEGIN_TEXT, type Budget } from '../src/game/session';
import { newStory } from '../src/game/story';
import type { UsageEntry, World, WorldTemplate } from '../src/game/types';
import { checkWorld, countsOf, creationRules, fightStats, neighbours } from '../src/game/world';
import { worldFromFile, worldToFile } from '../src/game/worldFile';
import { BALANCED, harness, prefixText } from './helpers';

const INPUT: BuildInput = {
  source: { kind: 'description', text: 'A mining valley where the ore is running out and nobody will say so.' },
  premise: 'A clerk of the Miners’ Lodge who notices that the numbers do not add up.',
  name: 'Robin',
  table: { style: 'adventure', powers: 'focus', companions: 2, romance: true, violence: 'moderate', leaveOut: '', language: 'en', narration: 'medium' },
};
const input = (table: Partial<BuildInput['table']> = {}): BuildInput => ({ ...structuredClone(INPUT), table: { ...INPUT.table, ...table } });

type Step = StepId | 'questions' | 'character' | 'expand' | 'notes' | 'digest';

/** A builder on the demo client, with ways to make a step fail, answer badly, or be interrupted. */
function rig(opts: { cap?: number; input?: BuildInput; draft?: WorldDraft } = {}) {
  const t = 1_800_000_000_000;
  const inner = mockTransport({ now: () => t, streamDelay: 0 });
  const requests: LlmRequest[] = [];
  /** Answers to give in place of the demo builder's, by step, in order. */
  const answers: Partial<Record<Step, unknown[]>> = {};
  /** Errors to throw, by step, in order. */
  const errors: Partial<Record<Step, Error[]>> = {};
  /** Answers that come back cut off at the length limit, by step: how many times. */
  const cutOff: Partial<Record<Step, number>> = {};
  /** Run when a step's request is made, before it is answered. */
  const on: Partial<Record<Step, () => void>> = {};
  const transport: Transport = {
    simulated: true,
    async send(req, o) {
      const step = req.architect!.step;
      requests.push(structuredClone({ ...req, schema: undefined }) as LlmRequest);
      on[step]?.();
      const err = errors[step]?.shift();
      if (err) throw err;
      const res = await inner.send(req, o);
      if ((cutOff[step] ?? 0) > 0) { cutOff[step]! -= 1; return { ...res, parsed: null, stop: 'max_tokens' }; }
      const swap = answers[step];
      return swap?.length ? { ...res, parsed: swap.shift() } : res;
    },
  };
  const usage: UsageEntry[] = [];
  const state = { cap: opts.cap ?? 100 };
  const budget: Budget = { spentToday: () => usage.reduce((sum, u) => sum + u.cost, 0), cap: () => state.cap, record: (e) => { usage.push(e); } };
  const saves: WorldDraft[] = [];
  const deps = { transport, models: () => BALANCED, budget, save: (d: WorldDraft) => { saves.push(structuredClone(d)); }, now: () => t };
  const draft = opts.draft ?? newDraft('w1', opts.input ?? INPUT, t);
  const builder = new WorldBuilder(draft, deps);
  const stepsAsked = () => requests.map((r) => r.architect!.step);
  return { builder, draft, requests, answers, errors, cutOff, on, usage, saves, state, deps, stepsAsked };
}

const lastText = (req: LlmRequest): string => {
  const m = req.params.messages[req.params.messages.length - 1]!;
  return typeof m.content === 'string' ? m.content : m.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
};
const firstText = (req: LlmRequest): string => {
  const m = req.params.messages[0]!;
  return typeof m.content === 'string' ? m.content : m.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
};
const ORDER = BUILD_STEPS.map((s) => s.id);

describe('building a world', () => {
  it('takes seven steps, and the world that comes out passes every check', async () => {
    const r = rig();
    expect(r.builder.next).toBe('skeleton');
    await r.builder.build();
    expect(r.draft.state).toBe('review');
    expect(r.stepsAsked()).toEqual(ORDER);
    expect(r.builder.problems()).toEqual([]);
    const t = r.builder.accept()!;
    expect(checkWorld(t.world)).toEqual([]);
    expect(countsOf(t.world)).toEqual({ regions: 9, places: 10, people: 12 });
    // Every request was recorded, as the builder's, and the world knows what it cost.
    expect(r.usage).toHaveLength(7);
    expect(r.usage.every((u) => u.role === 'architect' && u.simulated)).toBe(true);
    expect(t.cost).toBeCloseTo(r.usage.reduce((sum, u) => sum + u.cost, 0), 10);
    expect(t.simulated).toBe(true);
    expect(t.opening).toMatchObject({ title: 'The Last Good Seam', chapter: 'Short Shifts', hour: 17 });
    expect(t.premise).toBe(INPUT.premise);
  });

  it('shows the player where they start, what is next to it, and nothing further', async () => {
    const r = rig();
    await r.builder.build();
    const w = r.builder.world()!;
    expect(w.startPlace).toBe('long_table');
    expect(w.places.long_table!.known).toBe('visited');
    expect(w.places.ashford!.known).toBe('visited');
    expect(w.places.market_square!.known).toBe('heard');
    // One journey from Ashford: heard of. Beyond that: not yet.
    for (const id of ['high_pits', 'stonewater', 'blackwood', 'garrow_keep']) expect(w.places[id]!.known, id).toBe('heard');
    for (const id of ['kings_cut', 'mirefen', 'saints_rest', 'far_market']) expect(w.places[id]!.known, id).toBe('hidden');
    // The roads out of the town can be taken from the room the story opens in.
    expect(neighbours(w, 'long_table').map((n) => n.id)).toEqual(expect.arrayContaining(['market_square', 'smiths_row', 'stonewater', 'garrow_keep']));
  });

  it('the model describes, and the numbers come from the rules', async () => {
    const r = rig();
    await r.builder.build();
    const w = r.builder.world()!;
    expect(w.people.dunmore!.fight).toEqual(fightStats('dangerous'));
    expect(w.people.ysolde!.fight).toEqual(fightStats('able', true));
    expect(w.people.sable!.fight!.fights).toBe(false);
    expect(w.people.company_guards).toMatchObject({ count: 4, tier: 'extra', fight: fightStats('able') });
    expect(w.rules).toEqual({ powers: 'focus', pathCap: 3, style: 'adventure', destinyPerChapter: 3, level: 'champion' });
    expect(creationRules(w).ancestries.map((a) => a.name)).toEqual(['Valefolk', 'Deepkin', 'Fenborn']);
    expect(w.fronts!.every((f) => f.stage === 0)).toBe(true);
    expect(w.seeds).toHaveLength(6);
    // Everyone the story starts beside has been met; nobody else has.
    expect(Object.values(w.people).filter((p) => p.inParty).map((p) => p.id)).toEqual(['wren', 'ysolde']);
    expect(Object.values(w.people).filter((p) => p.met).map((p) => p.id)).toEqual(['wren', 'ysolde']);
  });

  it('keeps to the table: no more companions than agreed, and no paths in a world without powers', async () => {
    const one = rig({ input: input({ companions: 1 }) });
    await one.builder.build();
    expect(Object.values(one.builder.world()!.people).filter((p) => p.inParty).map((p) => p.id)).toEqual(['wren']);
    const none = rig({ input: input({ companions: 0, powers: 'off', style: 'brutal' }) });
    none.answers.rules = [{ ...(mockArchitect({ step: 'rules', input: INPUT, done: {} }) as object), path_cap: 5 }];
    await none.builder.build();
    const w = none.builder.world()!;
    expect(Object.values(w.people).some((p) => p.inParty)).toBe(false);
    expect(w.rules).toMatchObject({ powers: 'off', pathCap: 0, style: 'brutal', destinyPerChapter: 0 });
  });

  it('is saved after every step, so nothing done is ever lost', async () => {
    const r = rig();
    await r.builder.build();
    for (let i = 0; i < ORDER.length; i++) {
      // Before step i+1 is asked for, a save holds exactly the steps before it.
      const before = r.saves.find((s) => s.state === 'building' && Object.keys(s.steps).length === i);
      expect(before, `a save with ${i} steps`).toBeTruthy();
      expect(Object.keys(before!.steps)).toEqual(ORDER.slice(0, i));
    }
    expect(r.saves[r.saves.length - 1]!.state).toBe('review');
    expect(Object.keys(r.saves[r.saves.length - 1]!.steps)).toEqual(ORDER);
  });

  it('tells the player what it will cost before anything is spent', () => {
    const sonnet = estimateBuild(BALANCED, false);
    const opus = estimateBuild({ ...BALANCED, architect: 'claude-opus-5-5' }, false);
    const haiku = estimateBuild({ ...BALANCED, architect: 'claude-haiku-5-5' }, false);
    expect(sonnet.low).toBeLessThan(sonnet.typical);
    expect(sonnet.typical).toBeLessThan(sonnet.high);
    expect(haiku.typical).toBeLessThan(sonnet.typical);
    expect(sonnet.typical).toBeLessThan(opus.typical);
    expect(estimateBuild(BALANCED, true).typical).toBeGreaterThan(sonnet.typical);
    expect(opus.typical).toBeGreaterThan(0.15);
    expect(opus.typical).toBeLessThan(0.6);
  });

  it('costs what the estimate said, give or take', async () => {
    const r = rig();
    await r.builder.build();
    const est = r.builder.estimate();
    expect(r.builder.spent).toBeGreaterThan(est.low * 0.5);
    expect(r.builder.spent).toBeLessThan(est.high);
  });
});

describe('the builder’s questions', () => {
  it('are asked once, and the answers go into what every step is told', async () => {
    const r = rig();
    await r.builder.ask();
    expect(r.draft.questions!.list.map((q) => q.id)).toEqual(['tone', 'stage', 'trouble']);
    expect(r.draft.questions!.list[0]!.options).toHaveLength(3);
    await r.builder.ask(); // already asked: nothing is sent
    expect(r.requests).toHaveLength(1);
    r.builder.answer('tone', 'Bleak');
    r.builder.answer('trouble', '  ');
    await r.builder.build();
    const brief = firstText(r.requests[1]!);
    expect(brief).toContain('WHAT THE PLAYER ANSWERED WHEN ASKED');
    expect(brief).toContain('- How dark should this world be? Bleak');
    expect(brief).not.toContain('What kind of trouble'); // left empty: the builder decides
    expect(r.usage).toHaveLength(8); // the questions were a request too
  });

  it('can be skipped, and then nothing about them is sent', async () => {
    const r = rig();
    await r.builder.ask();
    r.builder.answer('tone', 'Bleak');
    r.builder.skipQuestions();
    await r.builder.build();
    expect(firstText(r.requests[1]!)).not.toContain('WHAT THE PLAYER ANSWERED');
  });

  it('cannot be changed once building has begun: the brief is the same in every step', async () => {
    const r = rig();
    await r.builder.ask();
    r.builder.answer('tone', 'Hopeful');
    r.on.fronts = () => r.builder.pause();
    await r.builder.build();
    expect(r.draft.state).toBe('paused');
    r.builder.answer('tone', 'Bleak');
    r.builder.skipQuestions();
    await r.builder.ask();
    await r.builder.build();
    const briefs = new Set(r.requests.slice(1).map(firstText));
    expect(briefs.size).toBe(1);
    expect([...briefs][0]).toContain('Hopeful');
  });

  it('a failure while asking spends nothing and can be tried again or passed over', async () => {
    const r = rig();
    r.errors.questions = [new LlmError('offline', 'The request did not reach Anthropic.')];
    await r.builder.ask();
    expect(r.draft.failed).toMatchObject({ step: 'questions', kind: 'offline' });
    expect(r.draft.questions).toBeNull();
    expect(r.usage).toHaveLength(0);
    await r.builder.build(); // building without them is always possible
    expect(r.draft.state).toBe('review');
    expect(r.draft.failed).toBeUndefined();
  });
});

describe('one conversation that only grows', () => {
  it('each step repeats the one before it word for word and adds to the end', async () => {
    const r = rig();
    await r.builder.build();
    for (let i = 1; i < r.requests.length; i++) {
      const prev = r.requests[i - 1]!;
      const cur = r.requests[i]!;
      expect(cur.params.messages).toHaveLength(prev.params.messages.length + 2);
      expect(prefixText(cur, prev.params.messages.length)).toBe(prefixText(prev, prev.params.messages.length));
      // What is sent back as the earlier answer is the step as it was kept, after cleaning.
      const kept = cur.params.messages[cur.params.messages.length - 2]!;
      expect(kept.role).toBe('assistant');
      expect(JSON.parse(kept.content as string)).toEqual(r.draft.steps[ORDER[i - 1]!]);
    }
  });

  it('so later steps read the earlier ones from the cache', async () => {
    const r = rig();
    await r.builder.build();
    expect(r.usage[0]!.cacheRead).toBe(0);
    for (const u of r.usage.slice(1)) expect(u.cacheRead).toBeGreaterThan(0);
    const last = r.usage[r.usage.length - 1]!;
    expect(last.cacheRead).toBeGreaterThan(last.input + last.cacheWrite5m);
  });
});

describe('pausing, leaving and coming back', () => {
  it('pause stops after the step in hand, and resuming asks only for what is left', async () => {
    const r = rig();
    r.on.fronts = () => { r.builder.pause(); expect(r.builder.pausing).toBe(true); };
    await r.builder.build();
    expect(r.draft.state).toBe('paused');
    expect(Object.keys(r.draft.steps)).toEqual(['skeleton', 'fronts']);
    expect(r.builder.busy).toBe(false);
    expect(r.builder.next).toBe('rules');
    const spent = r.builder.spent;
    delete r.on.fronts;
    await r.builder.build();
    expect(r.draft.state).toBe('review');
    expect(r.stepsAsked()).toEqual(ORDER); // seven requests in all: nothing was asked twice
    expect(r.builder.spent).toBeGreaterThan(spent);
  });

  it('pausing during the last step simply finishes the world', async () => {
    const r = rig();
    r.on.seeds = () => r.builder.pause();
    await r.builder.build();
    expect(r.draft.state).toBe('review');
  });

  it('a build cut off by closing the app goes on from the first step that was not finished', async () => {
    const first = rig();
    await first.builder.build();
    // The app was closed while the fourth step was being written: this is what storage held.
    const onDisk = first.saves.find((s) => s.state === 'building' && Object.keys(s.steps).length === 3)!;
    const again = rig({ draft: structuredClone(onDisk) });
    expect(again.draft.state).toBe('paused'); // nothing is running, and nothing is spent, until the player says so
    expect(again.builder.next).toBe('glossary');
    expect(again.builder.progress.map((p) => p.state)).toEqual(['done', 'done', 'done', 'waiting', 'waiting', 'waiting', 'waiting']);
    await again.builder.build();
    expect(again.draft.state).toBe('review');
    expect(again.stepsAsked()).toEqual(['glossary', 'start', 'people', 'seeds']);
    expect(again.builder.problems()).toEqual([]);
    // The cost of the world is everything spent on it, before and after the interruption.
    expect(again.draft.usage).toHaveLength(7);
    expect(templateOf(again.draft, 0).world).toEqual(first.builder.accept()!.world);
  });

  it('a second call while building does nothing', async () => {
    const r = rig();
    const a = r.builder.build();
    const b = r.builder.build();
    await Promise.all([a, b]);
    expect(r.stepsAsked()).toEqual(ORDER);
  });
});

describe('when a step goes wrong', () => {
  it('a failed request stops the build there; the steps before it are kept and not paid for again', async () => {
    const r = rig();
    r.errors.start = [new LlmError('overloaded', 'Anthropic’s service is busy or failed.', 529)];
    await r.builder.build();
    expect(r.draft.state).toBe('failed');
    expect(r.draft.failed).toMatchObject({ step: 'start', kind: 'overloaded' });
    expect(Object.keys(r.draft.steps)).toEqual(['skeleton', 'fronts', 'rules', 'glossary']);
    expect(r.builder.progress.find((p) => p.id === 'start')!.state).toBe('failed');
    expect(r.usage).toHaveLength(4);
    await r.builder.build();
    expect(r.draft.state).toBe('review');
    expect(r.draft.failed).toBeUndefined();
    expect(r.stepsAsked()).toEqual(['skeleton', 'fronts', 'rules', 'glossary', 'start', 'start', 'people', 'seeds']);
    expect(r.usage).toHaveLength(7);
  });

  it('an answer that cannot be used is asked for once more, saying why', async () => {
    const r = rig();
    const canned = mockArchitect({ step: 'skeleton', input: INPUT, done: {} }) as { regions: unknown[] };
    r.answers.skeleton = [{ ...canned, regions: canned.regions.slice(0, 2) }];
    await r.builder.build();
    expect(r.draft.state).toBe('review');
    expect(r.stepsAsked().slice(0, 3)).toEqual(['skeleton', 'skeleton', 'fronts']);
    expect(lastText(r.requests[0]!)).not.toContain('could not be used');
    expect(lastText(r.requests[1]!)).toContain('Your last answer to this step could not be used: The map came back with fewer than three places.');
    // The asking-again is said at the end only: everything before it is still the cached beginning.
    expect(prefixText(r.requests[1]!, 1)).toBe(prefixText(r.requests[0]!, 1));
    expect(r.usage).toHaveLength(8); // both answers were paid for, and the meter says so
    // And the next step's conversation holds the step once, as kept.
    expect(r.requests[2]!.params.messages).toHaveLength(4);
  });

  it('no answer at all counts the same', async () => {
    const r = rig();
    r.answers.people = [null];
    await r.builder.build();
    expect(r.draft.state).toBe('review');
    expect(lastText(r.requests[6]!)).toContain('could not be used');
  });

  it('an answer cut off at the length limit is asked for again, shorter', async () => {
    const r = rig();
    r.cutOff.people = 1;
    await r.builder.build();
    expect(r.draft.state).toBe('review');
    expect(lastText(r.requests[6]!)).toContain('The answer was cut off before it was finished. Use fewer words in each description.');
    expect(r.usage).toHaveLength(8); // the cut-off answer was paid for too
  });

  it('two unusable answers in a row stop the build, with the earlier steps kept', async () => {
    const r = rig();
    r.answers.glossary = [{ core: '', factions: [] }, { core: 'Too short.', factions: [] }];
    await r.builder.build();
    expect(r.draft.state).toBe('failed');
    expect(r.draft.failed).toMatchObject({ step: 'glossary', kind: 'unusable' });
    expect(Object.keys(r.draft.steps)).toEqual(['skeleton', 'fronts', 'rules']);
    expect(r.builder.accept()).toBeNull();
    await r.builder.build();
    expect(r.draft.state).toBe('review');
  });

  it('stops before spending when today’s limit is reached, and goes on when it is raised', async () => {
    const r = rig({ cap: 0 });
    await r.builder.build();
    expect(r.draft.failed).toMatchObject({ step: 'skeleton', kind: 'budget' });
    expect(r.requests).toHaveLength(0);
    r.state.cap = 100;
    r.on.rules = () => { r.state.cap = 0; }; // the limit is reached while the third step is written
    await r.builder.build();
    expect(r.draft.failed).toMatchObject({ step: 'glossary', kind: 'budget' });
    expect(Object.keys(r.draft.steps)).toEqual(['skeleton', 'fronts', 'rules']);
    expect(r.requests).toHaveLength(3);
    r.state.cap = 100;
    delete r.on.rules;
    await r.builder.build();
    expect(r.draft.state).toBe('review');
    expect(r.requests).toHaveLength(7);
  });

  it('building a step again rebuilds what came after it, and nothing before', async () => {
    const r = rig();
    await r.builder.build();
    const before = structuredClone(r.draft.steps);
    await r.builder.regenerate('people');
    expect(r.draft.state).toBe('review');
    expect(r.stepsAsked().slice(7)).toEqual(['people', 'seeds']);
    expect(r.draft.steps.start).toEqual(before.start);
    expect(r.builder.problems()).toEqual([]);
  });
});

// ---------- Whatever comes back ----------

type Over = Partial<Record<StepId, (canned: any) => any>>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Run the seven steps with some answers changed, the way the builder does, and put the world together. */
function built(over: Over = {}, using: BuildInput = INPUT): { world: World; draft: WorldDraft; notes: string[] } {
  const draft = newDraft('w', using, 0);
  const notes: string[] = [];
  for (const s of BUILD_STEPS) {
    let raw = mockArchitect({ step: s.id, input: using, done: draft.steps });
    if (over[s.id]) raw = over[s.id]!(structuredClone(raw));
    const kept = cleanStep(s.id, raw as never, draft.steps, using);
    (draft.steps as Record<string, unknown>)[s.id] = kept.data;
    notes.push(...kept.notes);
  }
  return { world: assemble(draft), draft, notes };
}

describe('whatever a step returns, the world that is kept is sound', () => {
  it('ids that are malformed, missing or used twice are made good, and what pointed at them still does', () => {
    const { world } = built({
      skeleton: (s) => {
        s.regions[0].id = 'Ashford Town!'; // the start
        s.regions[1].id = ''; // The High Pits
        s.regions[2].id = 'blackwood'; // Stonewater takes Blackwood's id
        s.start = 'Ashford Town!';
        for (const r of s.routes) { if (r.a === 'ashford') r.a = 'Ashford Town!'; if (r.b === 'high_pits') r.b = ''; }
        return s;
      },
      // Later steps were written against the cleaned ids, as they are in a real build.
      fronts: (f) => { for (const x of f.fronts) x.touches = x.touches.map((t: string) => (t === 'ashford' ? 'ashford_town' : t)); return f; },
      start: (st) => {
        for (const p of st.places) if (p.parent === 'ashford') p.parent = 'ashford_town';
        for (const r of st.routes) if (r.b === 'high_pits') r.b = 'the_high_pits';
        return st;
      },
    });
    expect(checkWorld(world)).toEqual([]);
    expect(world.places.ashford_town!.name).toBe('Ashford');
    expect(world.places.the_high_pits).toBeTruthy(); // named from its name when it had no id
    expect(world.places.blackwood!.name).toBe('Stonewater'); // first come, first served
    expect(world.places.blackwood_2!.name).toBe('Blackwood');
    expect(neighbours(world, 'ashford_town').map((n) => n.id)).toContain('blackwood');
  });

  it('a map that came back in pieces is joined up, and says so', () => {
    const { world, notes } = built({ skeleton: (s) => { s.routes = s.routes.filter((r: { a: string; b: string }) => ![r.a, r.b].includes('saints_rest') && ![r.a, r.b].includes('far_market')); return s; } });
    expect(checkWorld(world)).toEqual([]);
    expect(notes.join(' ')).toMatch(/Saint’s Rest could not be reached; a way to it from/);
    expect(notes.join(' ')).toMatch(/Far Market could not be reached/);
    const all = built({ skeleton: (s) => { s.routes = []; return s; } });
    expect(checkWorld(all.world)).toEqual([]);
    expect(all.world.routes.length).toBeGreaterThanOrEqual(8);
  });

  it('routes to nowhere, to themselves and given twice are dropped; lengths are brought into range', () => {
    const { world, notes } = built({
      skeleton: (s) => {
        s.routes.push({ a: 'ashford', b: 'atlantis', hours: 4, note: null }, { a: 'stonewater', b: 'stonewater', hours: 1, note: null }, { a: 'high_pits', b: 'ashford', hours: 99, note: null });
        s.routes[1].hours = -3;
        s.routes[2].hours = 1e9;
        return s;
      },
    });
    expect(checkWorld(world)).toEqual([]);
    expect(notes.join(' ')).toMatch(/Routes that led nowhere, or were given twice, were dropped/);
    const way = (a: string, b: string) => world.routes.find((r) => r.a === a && r.b === b)!.minutes;
    expect(way('ashford', 'stonewater')).toBe(30); // "-3 hours" becomes the shortest a road can be
    expect(way('ashford', 'blackwood')).toBe(60 * 24 * 30); // and no road is longer than a month
    expect(world.routes.filter((r) => r.a === 'ashford' && r.b === 'high_pits' || r.a === 'high_pits' && r.b === 'ashford')).toHaveLength(1);
  });

  it('a start that does not exist, and places off the map or on top of each other, are put right', () => {
    const { world, notes } = built({
      skeleton: (s) => { s.start = 'nowhere'; s.regions[3].x = 400; s.regions[3].y = Number.NaN; s.regions[5].x = s.regions[4].x; s.regions[5].y = s.regions[4].y; return s; },
    });
    expect(checkWorld(world)).toEqual([]);
    expect(notes.join(' ')).toMatch(/The starting place named did not exist/);
    const at = (id: string) => world.places[id]!;
    expect(Math.hypot(at('garrow_keep').x - at('blackwood').x, at('garrow_keep').y - at('blackwood').y)).toBeGreaterThan(6);
  });

  it('the starting area: places inside themselves, inside nothing, or out of reach', () => {
    const { world, notes } = built({
      start: (st) => {
        const by = (id: string) => st.places.find((p: { id: string }) => p.id === id);
        by('lodge_hall').parent = 'long_table'; // the hall inside its own room
        by('assay_house').parent = 'the_moon';
        by('east_gate').parent = 'east_gate';
        st.routes = st.routes.filter((r: { a: string; b: string }) => ![r.a, r.b].includes('river_stair') && ![r.a, r.b].includes('widow_hare'));
        st.start_place = 'cellar';
        return st;
      },
    });
    expect(checkWorld(world)).toEqual([]);
    expect(notes.join(' ')).toMatch(/River Stair could not be reached/);
    expect(notes.join(' ')).toMatch(/The place named for the first scene did not exist/);
    expect(world.places.assay_house!.parent).toBe('ashford');
    expect(world.places.east_gate!.parent).toBe('ashford');
  });

  it('a starting area with no ways at all is still one a story can leave', () => {
    const { world } = built({ start: (st) => { st.routes = []; return st; } });
    expect(checkWorld(world)).toEqual([]);
    expect(neighbours(world, world.startPlace).length).toBeGreaterThan(3);
  });

  it('a place in the starting area with the id of a place on the map gets its own', () => {
    const { world } = built({ start: (st) => { st.places[0].id = 'stonewater'; for (const r of st.routes) { if (r.a === 'market_square') r.a = 'stonewater'; if (r.b === 'market_square') r.b = 'stonewater'; } return st; } });
    expect(checkWorld(world)).toEqual([]);
    expect(world.places.stonewater!.name).toBe('Stonewater');
    expect(world.places.stonewater_2!.name).toBe('Market Square');
  });

  it('people who are nowhere are brought to where the story opens; ids shared with places are changed', () => {
    const { world, notes } = built({
      people: (p) => {
        p.people[0].place = 'limbo';
        p.people[1].place = '';
        p.people[2].id = 'market_square';
        p.people[3].id = p.people[4].id;
        p.crowds[0].place = 'nowhere';
        p.crowds[1].count = 5000;
        for (const x of p.people) x.travels_with_you = true;
        return p;
      },
    });
    expect(checkWorld(world)).toEqual([]);
    expect(notes.join(' ')).toMatch(/2 people were placed somewhere that does not exist/);
    expect(world.people.bram!.placeId).toBe('long_table');
    expect(world.people.market_square).toBeUndefined();
    expect(world.people.market_square_2!.name).toBe('Osk Marrow');
    expect(world.people.company_guards!.count).toBe(20);
    expect(Object.values(world.people).filter((x) => x.inParty)).toHaveLength(2); // the table said two
  });

  it('ancestries are made only of traits the game has, and never cost more than three', () => {
    const { world, notes } = built({
      rules: (r) => {
        r.level = 'demigod';
        r.path_cap = 40;
        r.ancestries = [
          { id: 'plain', name: 'Skyborn', text: 'They fly.', advantages: ['Wings', 'Keen Senses', 'Ally'], disadvantages: ['Glows in the dark'] },
          { id: 'rich', name: 'Highborn', text: 'Born to it.', advantages: ['Wealth', 'Rank: of the old houses', 'Tough'], disadvantages: [] },
          { id: 'x', name: '', text: 'No name.', advantages: [], disadvantages: [] },
        ];
        return r;
      },
    });
    expect(checkWorld(world)).toEqual([]);
    expect(notes.join(' ')).toMatch(/Skyborn: traits the game does not know were left out/);
    const [plain, sky, high] = world.ancestries!;
    expect(plain).toMatchObject({ id: 'plain', name: 'Valefolk', advantages: [] });
    expect(sky).toMatchObject({ id: 'plain_2', advantages: ['Keen Senses'], disadvantages: [] }); // "Ally" needs to say who
    expect(high!.advantages).toEqual(['Wealth']); // 2 + 2 + 1 was too dear
    expect(world.ancestries).toHaveLength(3);
    expect(world.rules).toMatchObject({ level: 'champion', pathCap: 5 });
  });

  it('fronts and seeds that point at nothing are mended or dropped', () => {
    const { world } = built({
      fronts: (f) => { f.fronts[0].touches = ['ashford', 'atlantis', 'ashford']; f.fronts[1].stages = ['Only one.']; f.fronts[2].name = ''; return f; },
      seeds: (s) => { s.seeds[0].place = 'atlantis'; s.seeds[1].title = ''; s.opening_hour = 77; s.main_thread = ''; return s; },
    });
    expect(checkWorld(world)).toEqual([]);
    expect(world.fronts).toHaveLength(1);
    expect(world.fronts![0]!.touches).toEqual(['ashford']);
    expect(world.seeds).toHaveLength(5);
    expect(world.seeds![0]!.placeId).toBe('long_table');
  });

  it('a world named like one of its places still has a root of its own', () => {
    const { world } = built({ skeleton: (s) => { s.name = 'Ashford'; return s; } });
    expect(checkWorld(world)).toEqual([]);
    expect(world.places.ashford!.kind).toBe('settlement');
    expect(world.places.ashford_world).toMatchObject({ kind: 'world', parent: null });
  });

  it('names in another script are kept, with ids the game can use', () => {
    const { world } = built({ skeleton: (s) => { s.name = 'Долина'; s.regions[1].id = 'Шахты'; s.regions[1].name = 'Верхние шахты'; for (const r of s.routes) { if (r.a === 'high_pits') r.a = 'Шахты'; if (r.b === 'high_pits') r.b = 'Шахты'; } return s; },
      fronts: (f) => { for (const x of f.fronts) x.touches = x.touches.filter((t: string) => t !== 'high_pits'); return f; },
      start: (st) => { st.routes = st.routes.filter((r: { b: string }) => r.b !== 'high_pits'); return st; } });
    expect(checkWorld(world)).toEqual([]);
    expect(world.name).toBe('Долина');
    expect(Object.values(world.places).some((p) => p.name === 'Верхние шахты')).toBe(true);
  });

  it('says so when there is too little to play in', () => {
    const none = { step: 'skeleton' as const, input: INPUT, done: {} };
    const sk = mockArchitect(none) as { regions: unknown[] };
    expect(() => cleanStep('skeleton', { ...sk, regions: [] } as never, {}, INPUT)).toThrow(Unusable);
    expect(() => cleanStep('skeleton', null as never, {}, INPUT)).toThrow(Unusable);
    expect(() => cleanStep('skeleton', 'a string' as never, {}, INPUT)).toThrow(Unusable);
    const { draft } = built();
    expect(() => cleanStep('glossary', { core: 'x', factions: [] }, draft.steps, INPUT)).toThrow(/came back empty/);
    expect(() => cleanStep('start', { places: [], routes: [], start_place: '' }, draft.steps, INPUT)).toThrow(/fewer than two places/);
    expect(() => cleanStep('people', { people: [], crowds: [] }, draft.steps, INPUT)).toThrow(/Fewer than three people/);
    // An empty list of fronts, ancestries or seeds is a thin world, not a broken one.
    expect(cleanStep('fronts', { fronts: [] }, draft.steps, INPUT).data.fronts).toEqual([]);
  });

  it('holds for four hundred answers damaged at random', () => {
    // A small generator with a fixed start, so a failure can be run again.
    let state = 20261116;
    const rnd = () => { state = (Math.imul(state ^ (state >>> 15), 2246822507) + 0x9e3779b9) | 0; return ((state >>> 0) % 100000) / 100000; };
    const pick = <T,>(list: T[]): T => list[Math.floor(rnd() * list.length)]!;
    const JUNK: (() => unknown)[] = [
      () => null, () => undefined, () => '', () => 'x'.repeat(4000), () => -1, () => 1e12, () => Number.NaN, () => [], () => ({}), () => true,
      () => 'ashford', () => 'long_table', () => 'Market Square', () => 'bram', () => '__proto__', () => '🙂', () => 0.5, () => [null, 3, 'x'],
    ];
    /** Change a few things somewhere inside a value. */
    const damage = (value: unknown, times: number): unknown => {
      for (let n = 0; n < times; n++) {
        let cur: any = value; // eslint-disable-line @typescript-eslint/no-explicit-any
        for (let depth = 0; depth < 6; depth++) {
          if (cur === null || typeof cur !== 'object') break;
          const keys = Array.isArray(cur) ? cur.map((_, i) => i) : Object.keys(cur);
          if (!keys.length) break;
          const k = pick(keys as (string | number)[]);
          const child = cur[k];
          const op = rnd();
          if (child !== null && typeof child === 'object' && op < 0.7) { cur = child; continue; }
          if (Array.isArray(cur) && op < 0.8) { cur.push(structuredClone(pick(cur))); break; } // the same thing twice
          if (Array.isArray(cur) && op < 0.85) { cur.splice(Number(k), 1); break; }
          if (!Array.isArray(cur) && op < 0.8) { delete cur[k]; break; }
          cur[k] = pick(JUNK)();
          break;
        }
      }
      return value;
    };
    let unusable = 0;
    let noted = 0;
    for (let run = 0; run < 400; run++) {
      const using = input({ companions: Math.floor(rnd() * 4), powers: pick(['off', 'focus', 'extreme'] as const), style: pick(['story', 'adventure', 'brutal'] as const) });
      const draft = newDraft(`fuzz${run}`, using, 0);
      for (const s of BUILD_STEPS) {
        const good = mockArchitect({ step: s.id, input: using, done: draft.steps });
        const bad = rnd() < 0.6 ? damage(structuredClone(good), 1 + Math.floor(rnd() * 6)) : good;
        let kept;
        try {
          kept = cleanStep(s.id, bad as never, draft.steps, using);
        } catch (err) {
          expect(err, `run ${run}, step ${s.id}`).toBeInstanceOf(Unusable);
          unusable += 1;
          kept = cleanStep(s.id, good as never, draft.steps, using); // the step is asked again, and this time the answer is good
        }
        (draft.steps as Record<string, unknown>)[s.id] = kept.data;
        noted += kept.notes.length;
      }
      const world = assemble(draft);
      expect(checkWorld(world), `run ${run}`).toEqual([]);
      // And it is plain data that a story can start from.
      const template = templateOf(draft, 0);
      expect(structuredClone(template).world).toEqual(world);
      if (run % 20 === 0) {
        const story = newStory(startSeed(template, { draft: { ...blank(world), name: 'Test' }, carrying: [] }, { id: `s${run}`, seed: run }), 0);
        expect(story.scenes[0]!.placeId).toBe(world.startPlace);
        expect(story.scenes[0]!.packet.length).toBeGreaterThan(200);
      }
    }
    // The damage was real: steps were refused and repaired, not passed through untouched.
    expect(unusable).toBeGreaterThan(5);
    expect(noted).toBeGreaterThan(50);
  });
});

const blank = (world: World): CharacterDraft => ({
  name: '', line: '', ancestry: creationRules(world).ancestries[0]!.id,
  attributes: { strength: 0, skill: 0, resistance: 0, armor: 0, firepower: 0 }, paths: {}, skills: [], advantages: [], disadvantages: [], abilities: [],
});

// ---------- A character, and the first scene ----------

async function demoWorld(table: Partial<BuildInput['table']> = {}): Promise<{ template: WorldTemplate; r: ReturnType<typeof rig> }> {
  const r = rig({ input: input(table) });
  await r.builder.build();
  return { template: r.builder.accept()!, r };
}

describe('a character for the world', () => {
  it('is proposed from the premise, and fits the rules exactly', async () => {
    const { template, r } = await demoWorld();
    const { proposal, usage } = await proposeCharacter(template.world, { premise: INPUT.premise, name: 'Robin' }, r.deps);
    const rules = creationRules(template.world);
    const found = check(proposal.draft, rules);
    expect(found.problems).toEqual([]);
    expect(found.left).toBe(0); // every point spent
    expect(proposal.draft).toMatchObject({ name: 'Robin', ancestry: 'plain', paths: { earth: 1 } });
    expect(proposal.draft.abilities).toHaveLength(1);
    expect(proposal.carrying.length).toBeGreaterThanOrEqual(3);
    expect(proposal.reasons!.skills).toBeTruthy();
    expect(usage).toMatchObject({ role: 'architect', simulated: true });
    expect(r.usage[r.usage.length - 1]).toBe(usage);
    expect(r.requests[r.requests.length - 1]!.architect!.step).toBe('character');
  });

  it('in a world without powers has no paths', async () => {
    const { template, r } = await demoWorld({ powers: 'off' });
    const { proposal } = await proposeCharacter(template.world, { premise: 'A miner.', name: '' }, r.deps);
    expect(proposal.draft.paths).toEqual({});
    expect(proposal.draft.abilities).toEqual([]);
    expect(proposal.draft.name).toBe('Robin Hale'); // no name given: the proposal names them
    expect(check(proposal.draft, creationRules(template.world)).ok).toBe(true);
  });

  it('however wild the proposal, what the player is shown is legal, and says what was changed', async () => {
    const { template } = await demoWorld();
    const rules = creationRules(template.world);
    const wild = {
      name: 'Zed', line: 'the strongest there is', ancestry: 'dragon',
      strength: 9, skill: 5, resistance: 5, armor: -2, firepower: 2.6,
      paths: [{ path: 'fire', level: 5 }, { path: 'fire', level: 2 }, { path: 'void', level: 3 }],
      skills: ['Athletics', 'Athletics', 'Juggling', 'Crime'],
      advantages: ['Tough', 'Flight', 'Ally', 'Wealth', 'Good Name: for honesty, in Ashford'],
      disadvantages: ['Bad Name: for thieving, in Ashford', 'Curious', 'Curious', 'Hunted: by everyone', 'Wanted: for murder, in Garrow Keep', 'Frail'],
      abilities: ['fireball_of_doom', 'featherstep'],
      carrying: [{ name: 'Sword', text: 'Sharp.' }, { name: 'sword', text: 'Another.' }, { name: '', text: 'Nameless.' }, { name: 'Rope', text: 'x'.repeat(500) }],
      reasons: { attributes: 'Because.', paths: '', skills: '', traits: '' },
    } as unknown as CharacterOut;
    const p = proposalFrom(wild, rules, '');
    const found = check(p.draft, rules);
    expect(found.problems).toEqual([]);
    expect(found.left).toBeGreaterThanOrEqual(0);
    expect(p.draft.ancestry).toBe('plain');
    expect(p.draft.paths.fire ?? 0).toBeLessThanOrEqual(3);
    expect(p.draft.paths).not.toHaveProperty('void');
    expect(p.draft.abilities).toEqual([]);
    expect(p.draft.skills.every((s) => ['Athletics', 'Crime'].includes(s))).toBe(true);
    expect(p.changes.join(' ')).toMatch(/Strength was set to 5/);
    expect(p.changes.join(' ')).toMatch(/“Flight” was dropped/);
    expect(p.carrying.map((c) => c.name)).toEqual(['Sword', 'Rope']);
    expect(p.carrying[1]!.text.length).toBeLessThanOrEqual(110);
    // Nothing at all still gives a sheet to start from.
    const empty = proposalFrom({} as CharacterOut, rules, 'Ana');
    expect(empty.draft.name).toBe('Ana');
    expect(check(empty.draft, rules).ok).toBe(true);
  });

  it('is not asked for when today’s limit is reached', async () => {
    const { template, r } = await demoWorld();
    const sent = r.requests.length;
    r.state.cap = 0;
    await expect(proposeCharacter(template.world, { premise: 'x', name: '' }, r.deps)).rejects.toBeInstanceOf(BudgetReached);
    expect(r.requests).toHaveLength(sent);
  });
});

describe('starting a story in a built world', () => {
  const robin = async (template: WorldTemplate, r: ReturnType<typeof rig>) => (await proposeCharacter(template.world, { premise: INPUT.premise, name: 'Robin' }, r.deps)).proposal;

  it('begins on day one, in chapter one, with the world’s opening and a full sheet', async () => {
    const { template, r } = await demoWorld();
    const story = newStory(startSeed(template, await robin(template, r), { id: 's1', seed: 7 }), 0);
    expect(story).toMatchObject({ title: 'The Last Good Seam', clock: { day: 1, minute: 17 * 60 }, chapter: { n: 1, title: 'Short Shifts' }, totals: { turns: 0 } });
    expect(story.threads).toEqual([expect.objectContaining({ id: 'main', kind: 'main', status: 'open', title: template.opening.thread })]);
    const me = story.protagonist;
    expect(me).toMatchObject({ name: 'Robin', ancestry: 'Valefolk', level: 'Champion', destiny: 3, destinyMax: 3, xp: 0, silver: STARTING_SILVER.usual });
    expect(me.sheet.hp).toBe(me.sheet.resistance * 5);
    expect(me.items.map((i) => i.name)).toEqual(['Work knife', 'Tin lamp', 'Notebook', 'Bandages and salve']);
    expect(me.items[3]).toMatchObject({ qty: 1, heal: 5 });
    expect(story.scenes[0]).toMatchObject({ n: 1, placeId: 'long_table' });
    expect(story.scenes[0]!.cast).toEqual(expect.arrayContaining(['wren', 'ysolde', 'bram', 'lodge_crews']));
    expect(story.opening).toBe(template.opening.line);
    // The world in the library is a template: the story has its own copy.
    expect(story.world).not.toBe(template.world);
    expect(template.world.people.bram!.met).toBe(false);
    expect(story.world.people.bram!.met).toBe(true);
  });

  it('takes the table style chosen for this story, and its companions', async () => {
    const { template, r } = await demoWorld();
    const who = await robin(template, r);
    const gentle = newStory(startSeed(template, who, { id: 's2', seed: 1, title: '  A Quiet Winter ', settings: { style: 'story', companions: 0 } }), 0);
    expect(gentle.title).toBe('A Quiet Winter');
    expect(gentle.world.rules).toMatchObject({ style: 'story', destinyPerChapter: 5, powers: 'focus' });
    expect(gentle.protagonist.destiny).toBe(5);
    expect(gentle.protagonist.items.find((i) => i.heal)!.qty).toBe(2);
    expect(Object.values(gentle.world.people).some((p) => p.inParty)).toBe(false);
    const hard = newStory(startSeed(template, who, { id: 's3', seed: 1, settings: { style: 'brutal' } }), 0);
    expect(hard.protagonist.destiny).toBe(0);
    expect(hard.protagonist.items.some((i) => i.heal)).toBe(false);
    expect(template.world.rules.style).toBe('adventure');
  });

  it('gives the wealthy more silver and the poor less', async () => {
    const { template } = await demoWorld();
    const base = { ...blank(template.world), name: 'Ana' };
    const rich = startSeed(template, { draft: { ...base, advantages: ['Wealth'] }, carrying: [] }, { id: 'a', seed: 1 });
    const poor = startSeed(template, { draft: { ...base, disadvantages: ['Poor'] }, carrying: [] }, { id: 'b', seed: 1 });
    expect(rich.protagonist.silver).toBe(STARTING_SILVER.wealthy);
    expect(poor.protagonist.silver).toBe(STARTING_SILVER.poor);
  });

  it('refuses a character that does not fit the rules', async () => {
    const { template } = await demoWorld();
    const draft = { ...blank(template.world), name: 'Ana', attributes: { strength: 5, skill: 5, resistance: 5, armor: 5, firepower: 5 } };
    expect(() => startSeed(template, { draft, carrying: [] }, { id: 'x', seed: 1 })).toThrow(/cannot start a story: You have spent 25 of 10 points/);
    expect(() => startSeed(template, { draft: blank(template.world), carrying: [] }, { id: 'x', seed: 1 })).toThrow(/Give your character a name/);
  });

  it('the first scene is told before the player types anything', async () => {
    const { template, r } = await demoWorld();
    const h = harness({ story: newStory(startSeed(template, await robin(template, r), { id: 's4', seed: 3 }), 1_800_000_000_000) });
    const s = h.session;
    expect(s.canBegin).toBe(true);
    await s.begin();
    expect(s.blocker).toBeNull();
    expect(h.requests.map((q) => q.role)).toEqual(['narrator']); // nothing for the referee to read: nobody acted
    const turn = s.lastTurn!;
    expect(turn).toMatchObject({ n: 1, input: BEGIN_TEXT, userText: '(The story begins.)' });
    expect(turn.beats.some((b) => b.type === 'action')).toBe(false);
    expect(turn.beats.some((b) => b.type === 'narration')).toBe(true);
    expect(turn.engineNote).toContain('story opening: this is the first scene of the story');
    expect(turn.engineNote).toContain('Bram Tolliver has just set the Lodge’s ledger down in front of you');
    expect(s.canBegin).toBe(false);
    await s.begin(); // once only
    expect(s.story.totals.turns).toBe(1);
    await s.submit('I turn the ledger round and read the last page.');
    expect(s.story.totals.turns).toBe(2);
    expect(s.scene.turns[1]!.beats[0]).toMatchObject({ type: 'action' });
  });

  it('an opening that fails leaves the story ready to be begun again', async () => {
    const { template, r } = await demoWorld();
    const h = harness({ story: newStory(startSeed(template, await robin(template, r), { id: 's5', seed: 3 }), 1_800_000_000_000) });
    h.narratorErrors.push(new LlmError('offline', 'The request did not reach Anthropic.'));
    await h.session.begin();
    expect(h.session.blocker).toMatchObject({ kind: 'offline' });
    expect(h.session.story.totals.turns).toBe(0);
    await h.session.retry();
    expect(h.session.story.totals.turns).toBe(1);
    expect(h.session.lastTurn!.input).toBe(BEGIN_TEXT);
  });

  it('the narrator is told what is waiting here and what is in motion, and nobody else is', async () => {
    const { template, r } = await demoWorld();
    const h = harness({ story: newStory(startSeed(template, await robin(template, r), { id: 's6', seed: 3 }), 1_800_000_000_000) });
    const s = h.session;
    const packet = s.scene.packet;
    // The ledger is at the Long Table, where the story opens.
    expect(packet).toContain('SITUATION [the_ledger] The oldest ledger. Brother Aldous wants a week with the Lodge’s first ledger');
    expect(packet).toContain('Not what it seems: The ledger records the last time the deep shaft was sealed');
    expect(packet.match(/^SITUATION /gm)).toHaveLength(1);
    // Two things in motion touch Ashford; the third is up at the pits.
    expect(packet.match(/^IN MOTION /gm)).toHaveLength(2);
    expect(packet).toContain('IN MOTION The failing seam. Coming, if nobody stops it: The assay books are quietly rewritten');
    expect(packet).not.toContain('What the deep shaft woke');
    // Once the narrator reports a situation settled, it is not sent again.
    h.narrator.push('Aldous closes the ledger and thanks you.\n===\ntime: 20\nsettled: the_ledger');
    await s.submit('I let Brother Aldous copy the ledger here, under my eye.');
    expect(s.story.world.settled).toEqual(['the_ledger']);
    await s.travel('market_square');
    expect(s.scene.placeId).toBe('market_square');
    expect(s.scene.packet).not.toContain('the_ledger');
    // The square has nothing planted in it: the nearest situation a journey away is named, with where it is.
    expect(s.scene.packet).toMatch(/^SITUATION \[isras_charts\] The surveyor’s charts \(at The Widow Hare\)/m);
  });

  it('can be played on from there: across the town and out to a place that is still a sketch', async () => {
    const { template, r } = await demoWorld({ companions: 0 });
    const h = harness({ story: newStory(startSeed(template, await robin(template, r), { id: 's7', seed: 5 }), 1_800_000_000_000) });
    const s = h.session;
    await s.begin();
    await s.submit('I ask Bram what he makes of the numbers.');
    await s.travel('smiths_row');
    expect(s.scene.placeId).toBe('smiths_row');
    await s.travel('pithead');
    expect(s.scene.placeId).toBe('pithead');
    await s.travel('high_pits');
    expect(s.blocker).toBeNull();
    // The company guards at the pithead may hold the way: either the story moved, or it said why not.
    if (s.scene.placeId === 'high_pits') {
      expect(s.scene.packet).toContain('PLACE [high_pits] The High Pits');
      expect(s.story.world.places.kings_cut!.known).toBe('heard'); // one journey further on, now that you stand here
      expect(s.scene.packet).toContain('IN MOTION What the deep shaft woke');
    }
    expect(s.story.clock.day).toBeGreaterThanOrEqual(1);
    expect(checkWorld(s.story.world)).toEqual([]);
    expect(h.saved.story!.id).toBe('s7');
  });
});

// ---------- What the screens lean on ----------

describe('changing what was asked for, before anything is built', () => {
  it('a new description drops questions that were about the old one; a change to the table keeps them', async () => {
    const r = rig();
    await r.builder.ask();
    r.builder.answer('tone', 'Bleak');
    expect(r.builder.setInput(input({ companions: 0, style: 'brutal' }))).toBe(true);
    expect(r.draft.questions!.answers.tone).toBe('Bleak'); // the table changed, the world did not
    expect(r.draft.input.table).toMatchObject({ companions: 0, style: 'brutal' });
    const other = { ...input(), source: { kind: 'description' as const, text: 'An archipelago of lighthouse keepers.' } };
    expect(r.builder.setInput(other)).toBe(true);
    expect(r.draft.questions).toBeNull();
    await r.builder.ask(); // asked again, about the new description
    expect(r.stepsAsked()).toEqual(['questions', 'questions']);
    expect(firstText(r.requests[1]!)).toContain('An archipelago of lighthouse keepers.');
  });

  it('is refused once a step is built: every later step was written from the first brief', async () => {
    const r = rig();
    r.on.fronts = () => r.builder.pause();
    await r.builder.build();
    expect(r.builder.started).toBe(true);
    expect(r.builder.setInput({ ...input(), premise: 'Someone else entirely.' })).toBe(false);
    expect(r.draft.input.premise).toBe(INPUT.premise);
  });

  it('questions skipped without being asked can still be asked; asked ones are not asked twice', async () => {
    const r = rig();
    r.builder.skipQuestions();
    expect(r.draft.questions).toMatchObject({ list: [], skipped: true });
    await r.builder.ask();
    expect(r.draft.questions!.list).toHaveLength(3);
    expect(r.draft.questions!.skipped).toBe(false);
    r.builder.skipQuestions();
    await r.builder.ask();
    expect(r.requests).toHaveLength(1);
  });

  it('asking to pause twice, or from inside a listener, is harmless', async () => {
    const r = rig();
    const off = r.builder.subscribe(() => { if (r.builder.busy) r.builder.pause(); });
    await r.builder.build();
    off();
    expect(r.draft.state).toBe('paused');
    expect(Object.keys(r.draft.steps)).toEqual(['skeleton']);
  });
});

describe('what a world costs, step by step', () => {
  it('each step knows its own cost, a step asked twice counts both, and the parts add up to the whole', async () => {
    const r = rig();
    await r.builder.ask();
    r.cutOff.people = 1;
    await r.builder.build();
    const parts = Object.values(r.draft.costs).reduce((sum, c) => sum + (c ?? 0), 0);
    expect(parts).toBeCloseTo(r.builder.spent, 10);
    expect(Object.keys(r.draft.costs).sort()).toEqual(['fronts', 'glossary', 'people', 'questions', 'rules', 'seeds', 'skeleton', 'start']);
    expect(r.builder.progress.find((p) => p.id === 'people')!.cost).toBeGreaterThan(r.builder.progress.find((p) => p.id === 'start')!.cost * 1.5);
    expect(r.builder.progress.every((p) => p.cost > 0 && p.state === 'done')).toBe(true);
  });

  it('building again from a later step is priced lower than building it all', () => {
    const r = rig();
    const all = r.builder.estimate().typical;
    expect(r.builder.estimate('skeleton').typical).toBeCloseTo(all, 10);
    const from = (id: StepId) => r.builder.estimate(id).typical;
    expect(from('fronts')).toBeLessThan(all);
    expect(from('people')).toBeLessThan(from('start'));
    expect(from('seeds')).toBeLessThan(from('people'));
    expect(from('seeds')).toBeGreaterThan(0);
    expect(r.builder.estimateQuestions()).toBeGreaterThan(0);
    expect(r.builder.estimateQuestions()).toBeLessThan(all / 5);
  });

  it('a finished world can be given another name without building anything', async () => {
    const r = rig();
    await r.builder.build();
    r.builder.rename('  The Black Vale  ');
    r.builder.rename('');
    const t = r.builder.accept()!;
    expect(t.world.name).toBe('The Black Vale');
    expect(Object.values(t.world.places).find((p) => p.parent === null)!.name).toBe('The Black Vale');
    expect(t.world.id).toBe('w1'); // the world keeps the id it was built under, whatever it is called
    expect(checkWorld(t.world)).toEqual([]);
    expect(r.requests).toHaveLength(7);
  });
});

describe('a world as a file', () => {
  it('comes back exactly as it went out', async () => {
    const { template } = await demoWorld();
    const back = worldFromFile(worldToFile(template, 123));
    expect(back).toEqual(template);
    expect(checkWorld(back.world)).toEqual([]);
  });

  it('says what is wrong with a file that is not a world', async () => {
    const { template } = await demoWorld();
    const file = (change: (f: any) => void) => { const f = JSON.parse(worldToFile(template, 0)); change(f); return JSON.stringify(f); }; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(() => worldFromFile('not json at all')).toThrow('That file is not a Bitor Quest world.');
    expect(() => worldFromFile('{"format":"bitor-quest-story","version":3}')).toThrow(/is a story, not a world/);
    expect(() => worldFromFile(file((f) => { f.version = 99; }))).toThrow(/newer version/);
    expect(() => worldFromFile(file((f) => { delete f.world.world.places; }))).toThrow('That world file is incomplete.');
    expect(() => worldFromFile(file((f) => { f.world.world.routes.push({ a: 'ashford', b: 'atlantis', minutes: 5 }); }))).toThrow(/That world cannot be used: a route joins "ashford" and "atlantis"/);
    expect(() => worldFromFile(file((f) => { f.world.world.people.bram = { id: 'bram', name: 'Bram' }; }))).toThrow(/the person "bram" is not complete/);
    expect(() => worldFromFile(file((f) => { f.world.world.places.ashford = 'a town'; }))).toThrow(/the place "ashford" is not complete/);
    expect(() => worldFromFile(file((f) => { f.world.world.startPlace = 'nowhere'; }))).toThrow(/the starting place does not exist/);
    expect(() => worldFromFile(file((f) => { f.world.world.fronts = 'none'; }))).toThrow('That world file is incomplete.');
  });

  it('takes nothing from a file on trust that is drawn or played without looking', async () => {
    const { template } = await demoWorld();
    const f = JSON.parse(worldToFile(template, 0));
    f.world.world.accent = 'red;background:url(https://example.com/x)';
    f.world.table = { companions: 40, narration: 'endless', language: 'xx', romance: 'yes' };
    f.world.opening = { hour: 99, title: 'T'.repeat(500) };
    f.world.cost = -5;
    f.world.source = { kind: 'weird', text: 5 };
    const back = worldFromFile(JSON.stringify(f));
    expect(back.world.accent).toBe('#8a97a8');
    expect(back.table).toEqual({ narration: 'medium', prose: 'plain', romance: false, violence: 'moderate', leaveOut: '', language: 'en', companions: 3, suggestions: true });
    expect(back.opening).toMatchObject({ hour: 23, chapter: '', thread: '', line: '' });
    expect(back.opening.title).toHaveLength(60);
    expect(back.cost).toBe(0);
    expect(back.source).toEqual({ kind: 'description', text: '' });
    // And a story can still be started in it.
    const story = newStory(startSeed(back, { draft: { ...blank(back.world), name: 'Ana' }, carrying: [] }, { id: 'imp', seed: 1 }), 0);
    expect(story.title).toBe('T'.repeat(60));
    expect(story.chapter.title).toBe('Chapter One');
    expect(story.threads).toEqual([]);
    expect(story.opening).toBeUndefined();
  });
});
