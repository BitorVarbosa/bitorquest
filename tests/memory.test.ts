// Memory over a long story: chapters that end and are never rewritten, news that spreads by rule,
// and which memories a person has in mind when the narrator is told about them.
import { describe, expect, it } from 'vitest';
import { NEWS, PACKET_MAX_CHARS, buildPacket, knowledgeOf, memoriesFor, personCard, reachOf } from '../src/game/cards';
import { CHAPTER_RULE, CHAPTERS_SENT } from '../src/game/chapters';
import type { GameEvent, Story } from '../src/game/types';
import { harness, type Harness } from './helpers';

const PLACES = ['guild_house', 'lantern_market', 'north_gate'];
const ends = (story: string, ...facts: string[]) => `${story}\n===\n${facts.join('\n')}`;
const body = (req: { params: { messages: { content: unknown }[] } }) => JSON.stringify(req.params.messages);

/** Play until `scenes` more scenes have ended: every journey ends the scene it leaves. */
async function endScenes(h: Harness, scenes: number): Promise<void> {
  const s = h.session;
  for (let i = 0; i < scenes; i++) {
    if (s.scene.turns.length === 0) await s.submit('I look around.');
    const to = PLACES.find((p) => p !== s.scene.placeId)!;
    const before = s.story.scenes.length;
    await s.travel(to);
    expect(s.blocker).toBeNull();
    expect(s.story.scenes.length, 'the journey opened a new scene').toBe(before + 1);
  }
}

let serial = 0;
/** Something that happened, put straight into the story's memory. */
function remember(story: Story, over: Partial<GameEvent> & { text: string }): GameEvent {
  const e: GameEvent = {
    id: `t${++serial}`, sceneId: 's0', clock: { ...story.clock }, placeId: 'lantern_market', importance: 2, reach: 'secret',
    actors: [], witnesses: [], told: [], ...over,
  };
  story.events.push(e);
  return e;
}
const daysAgo = (story: Story, days: number, minute = 600) => ({ day: story.clock.day - days, minute });

describe('chapters', () => {
  it('a chapter ends by rule after about a session of play, and the next begins with destiny restored', async () => {
    const h = harness();
    const s = h.session;
    const first = { ...s.story.chapter };
    s.story.protagonist.destiny = 0;
    await endScenes(h, CHAPTER_RULE.maxScenes - 1);
    expect(s.story.chapter.n).toBe(first.n);
    expect(s.story.chapters).toHaveLength(1); // only the one the story began with
    await endScenes(h, 1);
    // The twelfth scene ended the chapter.
    expect(s.story.chapter.n).toBe(first.n + 1);
    expect(s.story.chapter.title).toBe('The Road On');
    expect(s.story.chapter.turnsBefore).toBe(s.story.totals.turns - 1); // the journey that opened the new scene is the new chapter's first turn
    expect(s.story.chapters).toHaveLength(2);
    const done = s.story.chapters[1]!;
    expect(done).toMatchObject({ n: first.n, title: first.title, scenes: CHAPTER_RULE.maxScenes, fromDay: first.fromDay });
    expect(done.turns).toBeGreaterThanOrEqual(CHAPTER_RULE.maxScenes);
    expect(done.summary.length).toBeGreaterThan(20);
    expect(done.gist.length).toBeGreaterThan(10);
    expect(s.story.protagonist.destiny).toBe(s.story.protagonist.destinyMax);
    // The scribe was asked to write the chapter up in the same call that wrote up its last scene: no extra request.
    const scribes = h.requests.filter((r) => r.role === 'scribe');
    expect(scribes).toHaveLength(CHAPTER_RULE.maxScenes);
    expect(scribes.filter((r) => body(r).includes('THIS SCENE ENDS CHAPTER'))).toHaveLength(1);
    expect(body(scribes[scribes.length - 1]!)).toContain(`THIS SCENE ENDS CHAPTER ${first.n}`);
    // The player is told on the turn they are looking at: the journey that left the chapter's last scene.
    const closing = s.story.scenes[s.story.scenes.length - 2]!;
    const journey = s.lastTurn!;
    expect(journey.beats.flatMap((b) => (b.type === 'notes' ? b.notes : []))).toContainEqual({ kind: 'chapter', n: first.n + 1, title: 'The Road On' });
    // The note comes before the telling, with what the rules decided, so it is on screen from the start.
    expect(journey.beats.findIndex((b) => b.type === 'notes')).toBeLessThan(journey.beats.findIndex((b) => b.type === 'narration'));
    // Scenes carry the number of the chapter they were played in.
    expect(closing.chapter).toBe(first.n);
    expect(s.scene.chapter).toBe(first.n + 1);
  });

  it('a main thread finished turns the chapter at the end of that scene, but never before it is three scenes long', async () => {
    const h = harness();
    const s = h.session;
    const n = s.story.chapter.n;
    h.narrator.push(ends('The letter changes hands, and it is done.', 'time: 5', 'thread: letter | done'));
    await s.submit('I hand the letter over.');
    expect(s.story.chapter.mainDone).toBe(true);
    await endScenes(h, 2);
    expect(s.story.chapter.n).toBe(n); // two scenes: too short to be a chapter
    await endScenes(h, 1);
    expect(s.story.chapter.n).toBe(n + 1);
    expect(s.story.chapter.mainDone).toBeUndefined();
    expect(s.story.chapters[s.story.chapters.length - 1]!.scenes).toBe(CHAPTER_RULE.minScenes);
  });

  it('closes even when the scribe gives nothing: the summary is then made from the scene summaries', async () => {
    const h = harness();
    const s = h.session;
    await endScenes(h, CHAPTER_RULE.maxScenes - 1);
    h.scribe.push(null);
    await endScenes(h, 1);
    const done = s.story.chapters[s.story.chapters.length - 1]!;
    expect(done.summary.length).toBeGreaterThan(20);
    expect(done.gist.length).toBeGreaterThan(5);
    expect(s.story.chapter.title).toBe('Onward');
  });

  it('what a finished chapter left is never rewritten, and the narrator is sent it as it was written', async () => {
    const h = harness();
    const s = h.session;
    await endScenes(h, CHAPTER_RULE.maxScenes);
    const written = JSON.stringify(s.story.chapters);
    // The first scene of the new chapter: earlier chapters in the packet, and no "so far" yet.
    expect(s.scene.packet).toContain('EARLIER CHAPTERS');
    expect(s.scene.packet).toContain(`- Chapter ${s.story.chapters[0]!.n} "${s.story.chapters[0]!.title}": ${s.story.chapters[0]!.summary.slice(0, 60)}`);
    expect(s.scene.packet).toContain(s.story.chapters[1]!.summary.slice(0, 60));
    expect(s.scene.packet).not.toContain('THIS CHAPTER SO FAR');
    expect(s.story.summary).toBe('');
    await endScenes(h, 3);
    expect(JSON.stringify(s.story.chapters)).toBe(written);
    expect(s.scene.packet).toContain('THIS CHAPTER SO FAR');
    // Rewinding across the chapter's end brings the old chapter back as the one being played.
    const before = s.story.chapter.n;
    const point = s.rewindPoints().find((p) => s.story.scenes.find((sc) => sc.id === p.sceneId)!.chapter === before - 1)!;
    expect(await s.rewindTo(point.keep)).toBe(true);
    expect(s.story.chapter.n).toBe(before - 1);
    expect(s.story.chapters).toHaveLength(1);
  });

  it('a story a hundred chapters long sends no more about its past than one ten chapters long', () => {
    const h = harness();
    const story = h.session.story;
    const packetWith = (count: number): string => {
      const s = structuredClone(story);
      s.chapters = Array.from({ length: count }, (_, i) => ({
        n: i + 1, title: `Chapter title number ${i + 1}`, fromDay: i * 3 + 1, toDay: i * 3 + 3, turns: 80, scenes: 12,
        summary: `Summary of chapter ${i + 1}. ${'You went on and things happened that mattered a great deal. '.repeat(12)}`,
        gist: `Gist of chapter ${i + 1}: ${'it was long and eventful '.repeat(8)}`,
      }));
      s.chapter = { n: count + 1, title: 'Now', turnsBefore: 0, fromDay: count * 3 + 1 };
      s.summary = 'So far. '.repeat(200);
      // The packet as a new scene would build it.
      return buildPacket(s, s.scenes[s.scenes.length - 1]!);
    };
    const ten = packetWith(10);
    const hundred = packetWith(100);
    // The same number of lines about the past; the only difference is that the numbers have another digit.
    expect(hundred.split('\n').length).toBe(ten.split('\n').length);
    expect(hundred.length - ten.length).toBeLessThan(40);
    expect(hundred.length).toBeLessThanOrEqual(PACKET_MAX_CHARS);
    // The newest are sent in full, a few more as a line each, the rest not at all.
    expect(hundred).toContain('Summary of chapter 100.');
    expect(hundred).toContain('Summary of chapter 99.');
    expect(hundred).not.toContain('Summary of chapter 98.');
    expect(hundred).toContain('Gist of chapter 98:');
    expect(hundred).toContain(`Gist of chapter ${100 - CHAPTERS_SENT.full - CHAPTERS_SENT.lines + 1}:`);
    expect(hundred).not.toContain(`Gist of chapter ${100 - CHAPTERS_SENT.full - CHAPTERS_SENT.lines}:`);
  });
});

describe('who has heard what', () => {
  const who = (story: Story, id: string, e: GameEvent) => knowledgeOf(story, id).find((k) => k.event === e)?.how ?? null;

  it('knows where a place lies', () => {
    const story = harness().session.story;
    expect(reachOf(story, 'common_room')).toEqual({ town: 'port_varn', wide: 'lantern_coast' });
    expect(reachOf(story, 'brinehold')).toEqual({ town: 'brinehold', wide: 'lantern_coast' });
    expect(reachOf(story, 'salt_flats')).toEqual({ town: null, wide: 'lantern_coast' }); // open land is part of the country too
    expect(reachOf(story, 'nowhere')).toEqual({ town: null, wide: null });
  });

  it('a secret is known only to those who were there or were told, however long ago it was', () => {
    const story = harness().session.story;
    const secret = remember(story, { text: 'You opened the sealed letter.', importance: 3, reach: 'secret', witnesses: ['mira'], clock: daysAgo(story, 30) });
    expect(who(story, 'mira', secret)).toBe('there');
    for (const id of Object.keys(story.world.people)) if (id !== 'mira') expect(who(story, id, secret), id).toBeNull();
    secret.told.push('hask');
    expect(who(story, 'hask', secret)).toBe('told');
    expect(who(story, 'roth', secret)).toBeNull();
  });

  it('something local becomes talk in its own town after a while, and nowhere else', () => {
    const story = harness().session.story;
    const now = story.clock.day * 1440 + story.clock.minute;
    const at = (minutesAgo: number) => { const t = now - minutesAgo; return { day: Math.floor(t / 1440), minute: t % 1440 }; };
    const fresh = remember(story, { text: 'You knocked over the fry stall.', reach: 'local', placeId: 'lantern_market', clock: at(NEWS.local - 1) });
    const stale = remember(story, { text: 'You won a fight at the North Gate.', reach: 'local', placeId: 'north_gate', clock: at(NEWS.local) });
    // Captain Roth is in Port Varn; Dace is in Brinehold.
    expect(who(story, 'roth', fresh)).toBeNull(); // not yet
    expect(who(story, 'roth', stale)).toBe('heard');
    expect(who(story, 'hask', stale)).toBe('heard'); // elsewhere in the same town
    expect(who(story, 'dace', stale)).toBeNull(); // another town: local talk does not travel
    // Someone who was there knows it, and is not said to have merely heard.
    stale.witnesses.push('roth');
    expect(who(story, 'roth', stale)).toBe('there');
  });

  it('something public reaches the rest of the country, days later', () => {
    const story = harness().session.story;
    const now = story.clock.day * 1440 + story.clock.minute;
    const at = (minutesAgo: number) => { const t = now - minutesAgo; return { day: Math.floor(t / 1440), minute: t % 1440 }; };
    const news = remember(story, { text: 'The Canal Bridge was closed to couriers.', reach: 'public', placeId: 'canal_bridge', clock: at(NEWS.publicNear) });
    expect(who(story, 'roth', news)).toBe('heard');
    expect(who(story, 'dace', news)).toBeNull(); // Brinehold has not heard yet
    news.clock = at(NEWS.publicFar);
    expect(who(story, 'dace', news)).toBe('heard');
  });

  it('is said to the narrator as hearsay, and only when it is worth repeating', () => {
    const story = harness().session.story;
    const roth = story.world.people.roth!;
    const before = personCard(story, roth);
    remember(story, { text: 'You bought a paper lantern.', importance: 1, reach: 'local', clock: daysAgo(story, 1) });
    expect(personCard(story, roth)).toBe(before); // a trifle is not talk of the town
    remember(story, { text: 'You pulled a child out of the canal.', importance: 3, reach: 'local', clock: daysAgo(story, 1) });
    expect(personCard(story, roth)).toContain('Has heard: You pulled a child out of the canal.');
  });
});

describe('what a person has in mind', () => {
  const texts = (story: Story, id: string, scene?: { placeId: string; cast: string[] }) => memoriesFor(story, story.world.people[id]!, scene).map((k) => k.event.text);

  it('what mattered most is still there long afterwards, beside what happened today', () => {
    const story = harness().session.story;
    story.events = [];
    remember(story, { text: 'You took an arrow meant for her.', importance: 3, witnesses: ['mira'], clock: daysAgo(story, 60), bond: { who: 'mira', delta: 12, after: 40, tier: 'defining' } });
    for (let d = 59; d >= 2; d--) remember(story, { text: `You shared a meal on day ${d}.`, importance: 1, witnesses: ['mira'], clock: daysAgo(story, d) });
    remember(story, { text: 'You argued about the route this morning.', importance: 2, witnesses: ['mira'], clock: daysAgo(story, 0, 300) });
    const mind = texts(story, 'mira');
    expect(mind).toHaveLength(3);
    expect(mind).toContain('You took an arrow meant for her.');
    expect(mind).toContain('You argued about the route this morning.');
    // The third is the freshest trifle, not one from weeks ago.
    expect(mind).toContain('You shared a meal on day 2.');
  });

  it('a trifle from this morning does not push out the day that changed everything', () => {
    const story = harness().session.story;
    story.events = [];
    remember(story, { text: 'You stood between him and the wardens.', importance: 3, witnesses: ['tobin'], clock: daysAgo(story, 40) });
    for (let i = 0; i < 6; i++) remember(story, { text: `You passed him the salt, ${i}.`, importance: 1, witnesses: ['tobin'], clock: daysAgo(story, 0, 100 + i) });
    expect(texts(story, 'tobin')).toContain('You stood between him and the wardens.');
  });

  it('a slight is remembered longer than a kindness of the same size', () => {
    const story = harness().session.story;
    story.events = [];
    remember(story, { text: 'You sold her spare bowstrings without asking.', importance: 1, witnesses: ['mira'], clock: daysAgo(story, 9), bond: { who: 'mira', delta: -4, after: 28, tier: 'slight' } });
    remember(story, { text: 'You carried her pack up the hill.', importance: 1, witnesses: ['mira'], clock: daysAgo(story, 9), bond: { who: 'mira', delta: 3, after: 31, tier: 'meaningful' } });
    remember(story, { text: 'You bought bread.', importance: 1, witnesses: ['mira'], clock: daysAgo(story, 9) });
    expect(texts(story, 'mira')[0]).toBe('You sold her spare bowstrings without asking.');
    expect(texts(story, 'mira')[1]).toBe('You carried her pack up the hill.');
  });

  it('a memory the player chose to keep on a profile counts for more', () => {
    const story = harness().session.story;
    story.events = [];
    const plain = remember(story, { text: 'You remembered how she takes her tea.', importance: 1, witnesses: ['mira'], clock: daysAgo(story, 20) });
    for (let i = 0; i < 4; i++) remember(story, { text: `You walked a while together, ${i}.`, importance: 1, witnesses: ['mira'], clock: daysAgo(story, 19 - i) });
    expect(texts(story, 'mira')).not.toContain(plain.text);
    plain.kept = true;
    expect(texts(story, 'mira')).toContain(plain.text);
  });

  it('what bears on the scene comes to mind: this place, these people', () => {
    const story = harness().session.story;
    story.events = [];
    remember(story, { text: 'You lied to him at the North Gate.', importance: 2, placeId: 'north_gate', witnesses: ['roth'], clock: daysAgo(story, 10) });
    remember(story, { text: 'You paid his toll at the Canal Bridge.', importance: 2, placeId: 'canal_bridge', witnesses: ['roth'], clock: daysAgo(story, 10) });
    remember(story, { text: 'You vouched for Tobin to him.', importance: 2, placeId: 'old_mill', witnesses: ['roth', 'tobin'], clock: daysAgo(story, 10) });
    const anywhere = texts(story, 'roth');
    expect(anywhere).toHaveLength(2);
    expect(texts(story, 'roth', { placeId: 'north_gate', cast: ['roth'] })[0]).toBe('You lied to him at the North Gate.');
    expect(texts(story, 'roth', { placeId: 'harbour', cast: ['roth', 'tobin'] })[0]).toBe('You vouched for Tobin to him.');
  });

  it('at most one thing on a card is hearsay, and the same sentence is never there twice', () => {
    const story = harness().session.story;
    story.events = [];
    for (let i = 0; i < 5; i++) remember(story, { text: `Public news number ${i}.`, importance: 3, reach: 'public', clock: daysAgo(story, 1) });
    remember(story, { text: 'You spent an hour with her.', importance: 2, witnesses: ['mira'], clock: daysAgo(story, 1) });
    remember(story, { text: 'You spent an hour with her.', importance: 2, witnesses: ['mira'], clock: daysAgo(story, 2) });
    const mind = memoriesFor(story, story.world.people.mira!);
    expect(mind.filter((k) => k.how === 'heard')).toHaveLength(1);
    expect(mind.filter((k) => k.event.text === 'You spent an hour with her.')).toHaveLength(1);
  });

  it('thirty scenes on, a companion still has in mind what happened in front of her, and nobody who was not there knows of it', async () => {
    const h = harness();
    const s = h.session;
    // Scene one: something defining happens between you and Mira. Those who are there see it; it is never made public.
    h.narrator.push(ends('She saw it, and says nothing.', 'bond: mira | defining | +value | You gave up the safe road to go back for her.'));
    await s.submit('I go back for Mira.');
    const event = s.story.events.find((e) => e.bond?.who === 'mira' && e.text.startsWith('You gave up the safe road'))!;
    expect(event.reach).toBe('secret');
    const there = new Set(['mira', ...event.witnesses]);
    expect(there.has('tobin')).toBe(true); // he travels with you: he saw it
    expect(there.has('hask')).toBe(false); // the Guildmaster was in his office
    await endScenes(h, 30);
    expect(s.story.chapters.length).toBeGreaterThan(2);
    // Mira is in the party, so she is in the packet of the scene being played: the memory is on her card.
    expect(s.scene.cast).toContain('mira');
    expect(s.scene.packet).toContain('You gave up the safe road to go back for her.');
    // Nobody who was not there has it, on any card, by any road: thirty scenes and days later it has not become talk.
    const absent = Object.values(s.story.world.people).filter((p) => !there.has(p.id));
    expect(absent.length).toBeGreaterThan(3);
    for (const p of absent) {
      expect(knowledgeOf(s.story, p.id).some((k) => k.event === event), p.id).toBe(false);
      expect(personCard(s.story, p), p.id).not.toContain('safe road');
    }
    // And the transcript it happened in is long gone from what is sent.
    const narrator = h.requests.filter((r) => r.role === 'narrator');
    expect(body(narrator[narrator.length - 1]!)).not.toContain('She saw it, and says nothing.');
  }, 60_000);
});
