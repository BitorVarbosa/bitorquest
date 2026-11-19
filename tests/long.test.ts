// The long playtest: three hundred turns through the real pipeline with the demo client.
//
// The fifty-turn playtest checks what a turn costs. This one checks what a LONG story does to the
// app (docs/PLAN.md, milestone 2): that what is sent, what is kept in memory and what is written to
// storage each turn all stay the same size however long the story gets; that every turn can be taken
// back exactly; and that a story rewound, exported or reopened is the same story.
//
// Run with: npm run playtest:long
import { describe, expect, it } from 'vitest';
import { PACKET_MAX_CHARS } from '../src/game/cards';
import { applyUndo } from '../src/game/patch';
import { fromFile, toFile, upgrade } from '../src/game/save';
import type { SceneArchive, Story } from '../src/game/types';
import { harness, type Harness } from './helpers';

const WANDER = ['guild_house', 'lantern_market', 'north_gate', 'lantern_market', 'guild_house', 'harbour', 'guild_house', 'lantern_market'];
const LINES = [
  'I look around and take stock of who is watching.',
  'I ask Mira what she makes of this.',
  'I try to bluff my way past with a straight face.',
  'I search the stalls for anything out of place.',
  'I keep my head down and listen in on the talk nearby.',
  'I tell Tobin to stay close.',
];
const json = (v: unknown) => JSON.stringify(v);
const kb = (v: unknown) => Math.round(json(v).length / 1024);
/** A value as text with the keys of every object in order, so that two values are the same text exactly when they hold the same data. */
function same(v: unknown): string {
  const sorted = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sorted);
    if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().filter((k) => (x as Record<string, unknown>)[k] !== undefined).map((k) => [k, sorted((x as Record<string, unknown>)[k])]));
    return x;
  };
  return JSON.stringify(sorted(v));
}
/** The story with every transcript back in it, for comparing two stories whatever happens to be in memory. */
function whole(story: Story, kept: Map<string, SceneArchive>): Story {
  const s = structuredClone(story);
  for (const sc of s.scenes) {
    const a = kept.get(`${s.id}/${sc.id}`);
    if (sc.stored && sc.turns.length === 0 && a) { sc.turns = structuredClone(a.turns); sc.packet = a.packet; if (a.asides) sc.asides = structuredClone(a.asides); }
    delete sc.stored; // bookkeeping about where the transcript lives, not part of the story
  }
  s.lastPlayed = 0;
  return s;
}

/** Play turns `from` to `to`. `each` is called after every turn; `first` right before every turn is sent (after any question to the narrator). */
async function play(h: Harness, from: number, to: number, each?: (turn: number) => void, first?: (turn: number) => void): Promise<void> {
  const s = h.session;
  for (let turn = from; turn <= to; turn++) {
    h.wait(40);
    if (turn % 41 === 20) await s.ask('What did you mean by that last part?');
    first?.(turn);
    if (turn % 7 === 6) await s.travel(WANDER[Math.floor(turn / 7) % WANDER.length]!);
    else await s.submit(LINES[turn % LINES.length]!);
    expect(s.blocker, `turn ${turn}`).toBeNull();
    each?.(turn);
  }
}

describe('three hundred turns', () => {
  it('a long story costs no more to send, to hold or to save than a short one', async () => {
    const h = harness();
    const s = h.session;
    const start = s.story.totals.turns;
    const sizes: { turn: number; memoryKB: number; savedKB: number; scenes: number; inMemory: number }[] = [];
    const saves: number[] = [];
    await play(h, 1, 300, (turn) => {
      saves.push(json(h.saved.story).length);
      if (turn % 50 === 0) {
        sizes.push({ turn, memoryKB: kb(s.story), savedKB: kb(h.saved.story), scenes: s.story.scenes.length, inMemory: s.story.scenes.filter((sc) => sc.turns.length > 0).length });
      }
    });
    const story = s.story;
    expect(story.totals.turns).toBe(start + 300);

    // 1. What is sent: every scene packet within its budget, the three-hundredth as the first.
    const packets = story.scenes.map((sc) => sc.packet || h.kept.get(`${story.id}/${sc.id}`)!.packet);
    for (const p of packets) { expect(p.length).toBeGreaterThan(0); expect(p.length).toBeLessThanOrEqual(PACKET_MAX_CHARS); }
    const narrator = h.usage.filter((u) => u.role === 'narrator');
    const sent = (u: (typeof narrator)[number]) => u.input + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h;
    const early = Math.max(...narrator.slice(0, 60).map(sent));
    const late = Math.max(...narrator.slice(-60).map(sent));
    expect(late).toBeLessThan(early * 1.5);

    // 2. What is held in memory: the open scene and the one before it, however many there have been.
    expect(story.scenes.length).toBeGreaterThan(30);
    expect(story.scenes.filter((sc) => sc.turns.length > 0 || sc.packet).length).toBeLessThanOrEqual(2);
    for (const sc of story.scenes.slice(0, -2)) { expect(sc.stored, sc.id).toBeDefined(); expect(sc.turns).toHaveLength(0); }

    // 3. What is written each turn: it does not grow with the number of turns played. The transcripts
    //    are the part that used to grow (about 3.5 KB a turn); events and rolls still add a little.
    const first50 = Math.max(...saves.slice(0, 50));
    const last50 = Math.max(...saves.slice(-50));
    const perTurn = (last50 - first50) / 250;
    expect(perTurn).toBeLessThan(600); // bytes of growth per turn played, down from about 3,500
    expect(last50).toBeLessThan(400 * 1024);

    // 4. Every finished scene is in storage, exactly once, with all of its turns.
    const ended = story.scenes.filter((sc) => sc.ended);
    expect(h.kept.size).toBe(ended.length);
    let turnsKept = 0;
    for (const sc of ended) {
      const a = h.kept.get(`${story.id}/${sc.id}`)!;
      expect(a.turns).toHaveLength(sc.stored!.turns);
      turnsKept += a.turns.length;
    }
    expect(turnsKept + s.scene.turns.length).toBe(300);

    console.log(json({
      turns: 300, scenes: story.scenes.length, sizes, saveBytes: { first50, last50, growthPerTurn: Math.round(perTurn) },
      eventsKB: kb(story.events), rollsKB: kb(story.rolls), worldKB: kb(story.world), events: story.events.length,
      largestRequestTokens: { first60turns: early, last60turns: late },
    }));
  }, 120_000);

  it('every turn can be taken back exactly', async () => {
    const h = harness();
    const s = h.session;
    let before = '';
    let largest = 0;
    let total = 0;
    await play(h, 1, 120, (turn) => {
      const last = s.lastTurn ?? s.story.scenes[s.story.scenes.length - 2]!.turns.slice(-1)[0]!;
      expect(last.undo, `turn ${turn} has an undo record`).toBeDefined();
      // Apply the record to the story as it stands: it must give the story as it stood right before the turn.
      const now = whole(s.story, h.kept);
      const back = last.undo ? applyUndo(structuredClone(now), JSON.parse(json(last.undo))) : now;
      for (const sc of back.scenes) delete sc.stored; // bookkeeping, see `whole`
      back.lastPlayed = 0;
      expect(same(back) === before, `undoing turn ${turn} gives the story as it was before it`).toBe(true);
      const size = json(last.undo ?? null).length;
      largest = Math.max(largest, size);
      total += size;
    }, () => { before = same(whole(s.story, h.kept)); });
    // The run was long enough to end a chapter, so taking a chapter's end back is among the turns checked.
    expect(s.story.chapters.length).toBeGreaterThan(1);
    // The records are small: far smaller than the transcript of the turn they undo.
    expect(total / 120).toBeLessThan(2500);
    console.log(json({ undoRecordBytes: { average: Math.round(total / 120), largest } }));
  }, 120_000);

  it('rewinding to the start of an earlier scene gives back the story as it was then, and it plays on the same', async () => {
    const h = harness();
    const s = h.session;
    // Remember the story after every turn.
    const after = new Map<number, string>();
    after.set(s.story.totals.turns, json(whole(s.story, h.kept)));
    await play(h, 1, 150, () => { after.set(s.story.totals.turns, json(whole(s.story, h.kept))); });

    const points = s.rewindPoints();
    expect(points.length).toBeGreaterThan(15);
    expect(points[0]!.keep).toBeLessThan(s.story.totals.turns);
    // Go a long way back: far enough that the scenes on the way are no longer in memory.
    const target = points[12]!;
    const scenesBefore = s.story.scenes.length;
    expect(await s.rewindTo(target.keep)).toBe(true);
    expect(s.story.totals.turns).toBe(target.keep);
    expect(s.story.scenes.length).toBeLessThan(scenesBefore);
    expect(s.scene.id).toBe(target.sceneId);
    expect(s.scene.ended).toBe(false);
    // Bonds, the clock, hit points, what is carried, the dice, the events: all as they were then.
    // (Questions to the narrator asked later in that same scene are gone with the turns after the cut.)
    expect(same(whole(s.story, h.kept))).toBe(asOf(after.get(target.keep)!, s.story));
    // Storage no longer holds the scenes that were cut off.
    const ids = new Set(s.story.scenes.map((sc) => `${s.story.id}/${sc.id}`));
    for (const key of h.kept.keys()) expect(ids.has(key), key).toBe(true);
    expect(h.saved.story!.totals.turns).toBe(target.keep);

    // The same actions from here meet the same dice: the story is replayed, not re-rolled.
    const rollsThen = (JSON.parse(after.get(target.keep + 10)!) as Story).rolls;
    const first = target.keep - s.story.rewindFloor + 1;
    await play(h, first, first + 9);
    expect(s.story.totals.turns).toBe(target.keep + 10);
    expect(json(s.story.rolls.map((r) => r.result))).toBe(json(rollsThen.map((r) => r.result)));
    expect(s.story.rng.state).toBe((JSON.parse(after.get(target.keep + 10)!) as Story).rng.state);
  }, 120_000);

  it('rewinding can go all the way back to where the story began', async () => {
    const h = harness();
    const s = h.session;
    const start = json(whole(s.story, h.kept));
    const floor = s.story.rewindFloor;
    await play(h, 1, 60);
    const points = s.rewindPoints();
    // The oldest point is the story's first scene, which no turn opened: going back to it leaves it with no turns at all.
    const oldest = points[points.length - 1]!;
    expect(oldest.keep).toBe(floor);
    expect(oldest.drops).toBe(60);
    expect(await s.rewindTo(oldest.keep)).toBe(true);
    expect(s.story.totals.turns).toBe(floor);
    expect(s.story.scenes).toHaveLength(1);
    expect(s.scene.turns).toHaveLength(0);
    expect(s.scene.ended).toBe(false);
    expect(s.scene.stored).toBeUndefined();
    expect(same(whole(s.story, h.kept))).toBe(asOf(start, s.story));
    expect(h.kept.size).toBe(0); // nothing of the abandoned scenes is left in storage
    expect(s.rewindPoints()).toHaveLength(0);
    // And it plays again from the first turn, meeting the same dice as the first time.
    await play(h, 1, 12);
    expect(s.story.totals.turns).toBe(floor + 12);
  }, 60_000);

  it('every point that is offered can be rewound to, whatever kind of scene it is', async () => {
    // Scenes are opened by journeys (their first turn is the journey) and, between turns, by the narrator
    // ending a scene or moving the story on. Each kind is tried, from a fresh copy of the same story.
    const h = harness();
    const s = h.session;
    const ends = (story: string, ...facts: string[]) => `${story}\n===\n${facts.join('\n')}`;
    for (let turn = 1; turn <= 40; turn++) {
      if (turn % 9 === 4) h.narrator.push(ends('Night falls, and the day is done.', 'time: 30', 'end: scene'));
      if (turn % 9 === 8) h.narrator.push(ends('You walk on, and the Guild House takes you in.', 'time: 5', `move: ${s.scene.placeId === 'guild_house' ? 'lantern_market' : 'guild_house'}`));
      if (turn % 7 === 6) await s.travel(WANDER[Math.floor(turn / 7) % WANDER.length]!);
      else await s.submit(LINES[turn % LINES.length]!);
      expect(s.blocker, `turn ${turn}`).toBeNull();
    }
    const points = s.rewindPoints();
    const kinds = new Set(points.map((p) => (s.story.scenes.find((sc) => sc.id === p.sceneId)!.openedBy === undefined ? 'between turns' : 'by a journey')));
    expect([...kinds].sort()).toEqual(['between turns', 'by a journey']);
    const story = json(s.story);
    const kept = new Map([...h.kept.entries()].map(([k, a]) => [k, structuredClone(a)]));
    for (const point of points) {
      const again = harness({ story: JSON.parse(story) as Story, kept: new Map([...kept.entries()].map(([k, a]) => [k, structuredClone(a)])) });
      expect(await again.session.rewindTo(point.keep), `to ${point.sceneId}`).toBe(true);
      expect(again.session.story.totals.turns).toBe(point.keep);
      expect(again.session.scene.id).toBe(point.sceneId);
      expect(again.session.scene.ended).toBe(false);
      // The scene is as it was at its start: holding its opening journey, or nothing yet.
      const opened = again.session.scene.openedBy;
      expect(again.session.scene.turns.map((t) => t.n)).toEqual(opened === undefined ? [] : [opened]);
      await again.session.submit('I look around.');
      expect(again.session.story.totals.turns, `plays on from ${point.sceneId}`).toBe(point.keep + 1);
    }
  }, 120_000);

  it('rewinding is refused where it cannot be done, and leaves the story alone', async () => {
    const h = harness();
    const s = h.session;
    await play(h, 1, 20);
    const was = json(s.story);
    expect(await s.rewindTo(s.story.totals.turns)).toBe(false); // nothing to take back
    expect(await s.rewindTo(s.story.rewindFloor - 1)).toBe(false); // before the story began
    expect(await s.rewindTo(99_999)).toBe(false);
    expect(json(s.story)).toBe(was);
    // A transcript missing from storage: refused, nothing changed.
    const far = s.rewindPoints().slice(-1)[0]!;
    const lost = [...h.kept.keys()][0]!;
    const copy = h.kept.get(lost)!;
    h.kept.delete(lost);
    expect(await s.rewindTo(far.keep)).toBe(false);
    expect(json(s.story)).toBe(was);
    h.kept.set(lost, copy);
    // Under the Brutal style what happened stays.
    s.updateSettings({ style: 'brutal' });
    expect(s.canRewind).toBe(false);
    expect(s.rewindPoints()).toHaveLength(0);
    expect(await s.rewindTo(far.keep)).toBe(false);
  }, 60_000);

  it('a story exported and read back is the same story, and can still be rewound and played', async () => {
    const h = harness();
    const s = h.session;
    await play(h, 1, 90);
    const kept = [...h.kept.entries()].filter(([k]) => k.startsWith(`${s.story.id}/`)).map(([, a]) => a);
    const text = toFile(s.story, kept, 0);
    expect(text).not.toMatch(/sk-ant|apiKey|api_key/i);
    const read = fromFile(text);
    expect(same(read.story)).toBe(same(s.story));
    expect(read.scenes).toHaveLength(kept.length);

    // Open it as a new session over its own storage, rewind it, and play on.
    const store = new Map<string, SceneArchive>(read.scenes.map((a) => [`${read.story.id}/${a.sceneId}`, a]));
    const h2 = harness({ story: read.story, kept: store });
    const far = h2.session.rewindPoints()[6]!;
    expect(await h2.session.rewindTo(far.keep)).toBe(true);
    await h2.session.submit('I look around.');
    expect(h2.session.story.totals.turns).toBe(far.keep + 1);
    // The story it was read from is untouched.
    expect(s.story.totals.turns).toBe(s.story.rewindFloor + 90);
  }, 60_000);

  it('a story saved by the first version of the format is brought up to date when opened', async () => {
    // A version 1 save: the whole story in one object, every transcript in it, no undo records.
    const h = harness();
    await play(h, 1, 40);
    const v1 = whole(h.session.story, h.kept) as unknown as Record<string, unknown> & Story;
    for (const sc of v1.scenes) { delete sc.openedBy; for (const t of sc.turns) delete t.undo; }
    delete (v1 as { rewindFloor?: number }).rewindFloor;
    delete (v1 as { chapters?: unknown }).chapters;
    (v1 as { chapter: unknown }).chapter = { n: v1.chapter.n, title: v1.chapter.title };
    for (const sc of v1.scenes) sc.chapter = v1.chapter.n; // one chapter for the whole story, as it was then
    (v1 as { version: number }).version = 1;
    delete (v1.settings as { prose?: string }).prose;
    const original = json(v1);

    const { story, scenes } = upgrade(v1);
    expect(json(v1)).toBe(original); // what was given is not changed
    expect(story.version).toBe(3);
    expect(story.settings.prose).toBe('clear');
    // It had no chapter records: the chapter it is in is taken to have begun with its first scene.
    expect(story.chapters).toEqual([]);
    expect(story.chapter.turnsBefore).toBe(0);
    expect(story.chapter.fromDay).toBe(story.scenes[0]!.started.day);
    expect(story.rewindFloor).toBe(story.totals.turns); // old turns have no undo records: no going back into them
    expect(scenes).toHaveLength(story.scenes.filter((sc) => sc.ended).length);
    expect(story.scenes.filter((sc) => sc.turns.length > 0).length).toBeLessThanOrEqual(2);
    expect(scenes.reduce((n, a) => n + a.turns.length, 0) + story.scenes[story.scenes.length - 1]!.turns.length).toBe(40);
    // Scenes reached by a journey are recognised as opened by it.
    expect(story.scenes.filter((sc) => sc.openedBy !== undefined).length).toBeGreaterThan(3);

    // It plays on, and what is played from now on can be taken back.
    const store = new Map<string, SceneArchive>(scenes.map((a) => [`${story.id}/${a.sceneId}`, a]));
    const h2 = harness({ story, kept: store });
    expect(h2.session.rewindPoints()).toHaveLength(0);
    await play(h2, 41, 60);
    const points = h2.session.rewindPoints();
    expect(points.length).toBeGreaterThan(0);
    expect(Math.min(...points.map((p) => p.keep))).toBeGreaterThanOrEqual(story.rewindFloor);
    expect(await h2.session.rewindTo(points[points.length - 1]!.keep)).toBe(true);
  }, 60_000);
  it('a story saved by the second version of the format gets its chapter records', async () => {
    // Version 2 already kept transcripts apart and had undo records; it had no chapters that end.
    const h = harness();
    await play(h, 1, 30);
    const v2 = structuredClone(h.session.story) as unknown as Record<string, unknown> & Story;
    delete (v2 as { chapters?: unknown }).chapters;
    (v2 as { chapter: unknown }).chapter = { n: v2.chapter.n, title: v2.chapter.title };
    (v2 as { version: number }).version = 2;
    const { story, scenes } = upgrade(v2);
    expect(story.version).toBe(3);
    expect(scenes).toHaveLength(0); // its transcripts were already put away
    expect(story.chapters).toEqual([]);
    expect(story.chapter).toMatchObject({ n: v2.chapter.n, title: v2.chapter.title, turnsBefore: 0 });
    expect(story.rewindFloor).toBe(h.session.story.rewindFloor); // what could be rewound still can
    // It opens over the storage it already had, plays on, ends a chapter, and can still be taken back.
    const h2 = harness({ story, kept: new Map([...h.kept.entries()].map(([k, a]) => [k, structuredClone(a)])) });
    await play(h2, 31, 110);
    expect(h2.session.story.chapters.length).toBeGreaterThan(0);
    const far = h2.session.rewindPoints().slice(-1)[0]!;
    expect(far.keep).toBe(story.rewindFloor);
    expect(await h2.session.rewindTo(far.keep)).toBe(true);
    expect(h2.session.story.chapters).toEqual([]);
  }, 60_000);
});

/**
 * The story as it was at an earlier moment, adjusted for the two things a rewind deliberately does not
 * bring back: questions to the narrator asked later in the scene that is open again are compared as
 * they are now (they are dropped when they fall after the cut), and the time the story was last played.
 */
function asOf(then: string, now: Story): string {
  const was = JSON.parse(then) as Story;
  const open = was.scenes[was.scenes.length - 1]!;
  const sceneNow = now.scenes[was.scenes.length - 1];
  if (sceneNow?.asides) open.asides = structuredClone(sceneNow.asides); else delete open.asides;
  for (const sc of was.scenes) delete sc.stored;
  was.lastPlayed = 0;
  return same(was);
}
