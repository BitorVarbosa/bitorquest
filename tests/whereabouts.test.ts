// People do not stay where the world was built with them: company, grievances, fates, situations left alone, telling, personal quests.
import { describe, expect, it } from 'vitest';
import { fixedDice } from '../src/engine';
import { COMPANION_BOND, assemble, cleanStep, newDraft, type BuildInput } from '../src/game/builder';
import { asksIn, isAway, knowledgeOf, newsFor, personCard, whereLine } from '../src/game/cards';
import { proposalFrom, startSeed } from '../src/game/creation';
import type { CharacterOut } from '../src/game/llm/architect';
import { mockArchitect } from '../src/game/llm/mockArchitect';
import type { LlmRequest } from '../src/game/llm/transport';
import { newStory } from '../src/game/story';
import type { GameEvent, Note, Story } from '../src/game/types';
import { PARTY, SEED_RULE, TELL, applyFate, canJoin, joinParty, lapseSeeds, leaveParty, tell, walkingOut } from '../src/game/whereabouts';
import { checkWorld, creationRules } from '../src/game/world';
import { glassRoadSeed, lanternCoast, lanternCoastTemplate } from '../src/packs/lanternCoast';
import { builtHarness, harness } from './helpers';

const text = (req: LlmRequest): string => req.params.messages.map((m) => (typeof m.content === 'string' ? m.content : m.content.map((b) => (b.type === 'text' ? b.text : '')).join(''))).join('\n');
const ends = (story: string, ...facts: string[]) => `${story}\n===\n${facts.join('\n')}`;
const later = (story: Story, days: number) => { story.clock = { day: story.clock.day + days, minute: story.clock.minute }; };
const company = (story: Story): Extract<Note, { kind: 'company' }>[] =>
  story.scenes.flatMap((sc) => sc.turns).flatMap((t) => t.beats).flatMap((b) => (b.type === 'notes' ? b.notes : [])).flatMap((n) => (n.kind === 'company' ? [n] : []));
const SCRIBE = { summary: 'You were there.', story_so_far: '', events: [], attitudes: [], people: [], fronts: [], chapter: null };
const sample = (): Story => newStory(glassRoadSeed(), 0);
const secret = (story: Story, over: Partial<GameEvent>): GameEvent => {
  const e: GameEvent = { id: `x${story.events.length}`, sceneId: 's1', clock: { ...story.clock }, placeId: 'lantern_market', text: 'You paid the clerk to lose a page.', importance: 2, reach: 'secret', actors: [], witnesses: [], told: [], ...over };
  story.events.push(e);
  return e;
};

describe('who will travel with the protagonist', () => {
  it('someone comes along at Trusted, if there is room, and not while they hold a grievance', () => {
    const story = sample();
    const { roth, dace, tobin, crowd } = story.world.people as Record<string, Story['world']['people'][string]>;
    // The table allows two companions, and Mira and Tobin are both there.
    expect(canJoin(story, roth!)).toEqual({ ok: false, reason: 'full', have: 0 });
    leaveParty(tobin!, 'lantern_market');
    expect(tobin).toMatchObject({ inParty: false, placeId: 'lantern_market', travelled: true });
    expect(canJoin(story, roth!)).toEqual({ ok: false, reason: 'stage', have: 0 });
    roth!.bond = 39;
    expect(canJoin(story, roth!)).toEqual({ ok: false, reason: 'stage', have: 2 });
    roth!.bond = 40;
    expect(PARTY.joinStage).toBe(3);
    expect(canJoin(story, roth!)).toEqual({ ok: true });
    // A grievance comes before the stage.
    dace!.bond = 70;
    expect(canJoin(story, dace!)).toEqual({ ok: false, reason: 'grievance', have: 4 });
    // A crowd is not someone who can come along, and neither is somebody who is gone.
    expect(canJoin(story, crowd!)).toMatchObject({ ok: false, reason: 'not_one_person' });
    // Someone who travelled with the protagonist before comes back, whatever the stage.
    expect(tobin!.bond).toBeLessThan(20);
    expect(canJoin(story, tobin!)).toEqual({ ok: true });
    joinParty(tobin!);
    expect(canJoin(story, tobin!)).toMatchObject({ ok: false, reason: 'already' });
    // A story played without companions has room for nobody.
    story.settings.companions = 0;
    expect(canJoin(story, roth!)).toMatchObject({ ok: false, reason: 'none_allowed' });
  });

  it('asked in the story: a stranger refuses and the narrator is told why, a companion stays behind at a word and comes back at another', async () => {
    const h = harness();
    const s = h.session;
    await s.submit('Tobin, stay here and keep out of sight.');
    expect(s.story.world.people.tobin).toMatchObject({ inParty: false, placeId: 'lantern_market', travelled: true });
    expect(s.lastTurn!.engineNote).toContain('company: at Aren');
    expect(s.lastTurn!.engineNote).toContain('Tobin no longer travels with them and stays here for now');
    expect(company(s.story).map((n) => n.text)).toEqual(['Tobin leaves your party and stays at Lantern Market']);

    await s.submit('Captain Roth, come with me to the waystation.');
    expect(s.story.world.people.roth!.inParty).toBe(false);
    expect(s.lastTurn!.engineNote).toContain('Captain Roth will not, yet: they would travel with someone they know as Trusted, and Aren is at No bond yet.');
    expect(company(s.story).at(-1)).toMatchObject({ who: 'roth', tone: 'plain', text: 'Captain Roth would travel with someone they know as Trusted. You are at No bond yet.' });

    await s.submit('Tobin, come along now.');
    expect(s.story.world.people.tobin!.inParty).toBe(true);
    expect(company(s.story).at(-1)).toMatchObject({ who: 'tobin', tone: 'good', text: 'Tobin joins your party' });

    // With the party full again nothing is asked of anyone: the player is told, and no turn is spent.
    const turns = s.scene.turns.length;
    s.story.world.people.roth!.bond = 60;
    await s.submit('Captain Roth, come with me.');
    expect(s.notice).toBe('Your party is full: 2 companions at this table. Someone would have to stay behind first.');
    expect(s.scene.turns.length).toBe(turns);
    // Going back in the story takes it all back.
    expect(await s.rewindTo(0)).toBe(true);
    expect(s.story.world.people.tobin).toMatchObject({ inParty: true });
    expect(s.story.world.people.tobin!.travelled).toBeUndefined();
  });

  it('a companion who was left behind is found where they were left, and no longer travels', async () => {
    const h = harness();
    const s = h.session;
    await s.submit('Tobin, wait here for us.');
    await s.travel('guild_house');
    expect(s.scene.cast).toContain('mira');
    expect(s.scene.cast).not.toContain('tobin');
    expect(s.story.world.people.tobin!.placeId).toBe('lantern_market');
    // Spoken of elsewhere, his card says where he is.
    await s.submit('I wonder aloud how Tobin is getting on.');
    expect(s.lastTurn!.engineNote).toContain('Now at Lantern Market.');
    await s.travel('lantern_market');
    expect(s.scene.cast).toContain('tobin');
    expect(s.scene.packet).not.toMatch(/\[tobin\][^\n]*in your party/);
  });
});

describe('grievances', () => {
  it('a betrayal is held against the protagonist until an act that matters makes amends', async () => {
    const h = harness();
    const s = h.session;
    const mira = () => s.story.world.people.mira!;
    expect(mira()).toMatchObject({ bond: 52, grievance: null });
    h.narrator.push(ends('Her face goes still.', 'bond: mira | betrayal | - | You gave her name to Captain Roth.'));
    await s.submit('I tell Roth who she is.');
    expect(mira().bond).toBe(22);
    expect(mira().grievance).toBe('You gave her name to Captain Roth');
    expect(company(s.story).at(-1)!.text).toBe('Mira holds this against you. Until you make amends, the bond grows at half speed and cannot reach its next stage');
    // A kindness is halved while it is open, and does not settle it.
    h.narrator.push(ends('She takes the bread without a word.', 'bond: mira | meaningful | - | You shared your supper with her.'));
    await s.submit('I share my supper with Mira.');
    expect(mira()).toMatchObject({ bond: 23, grievance: 'You gave her name to Captain Roth' });
    // Standing up for her does, and counts in full.
    h.narrator.push(ends('She looks at you for a long moment.', 'bond: mira | significant | - | You took the blame for the report in front of Roth.'));
    await s.submit('I tell Roth the report was my doing.');
    expect(mira()).toMatchObject({ bond: 31, grievance: null });
    expect(company(s.story).at(-1)!.text).toBe('You made amends with Mira: what they held against you is settled');
  });

  it('a companion who holds a grievance and is no longer a friend walks out when the scene ends', async () => {
    const h = harness();
    const s = h.session;
    s.story.world.people.mira!.bond = 28;
    h.narrator.push(ends('She does not answer.', 'bond: mira | betrayal | - | You sold her bow while she slept.'));
    await s.submit('I sell the bow.');
    expect(walkingOut(s.story).map((p) => p.id)).toEqual(['mira']);
    await s.travel('guild_house');
    const mira = s.story.world.people.mira!;
    expect(mira).toMatchObject({ inParty: false, placeId: 'lantern_market', travelled: true, grievance: 'You sold her bow while she slept' });
    expect(s.scene.cast).not.toContain('mira');
    expect(s.story.scenes.at(-2)!.summary).toContain('Mira left your company.');
    expect(s.story.events.at(-1)).toMatchObject({ text: 'Mira would go no further with you, and stayed at Lantern Market.', importance: 3, actors: ['mira'] });
    // She does not come back for the asking, until amends are made.
    expect(canJoin(s.story, mira)).toMatchObject({ ok: false, reason: 'grievance' });
    // Tobin has no quarrel with anyone, whatever his bond.
    expect(s.story.world.people.tobin!.inParty).toBe(true);
  });
});

describe('people who leave, move or die', () => {
  it('the scribe says who left the place for good and who died, and they are no longer found there', async () => {
    const h = harness();
    const s = h.session;
    h.scribe.push({ ...SCRIBE, people: [
      { who: 'roth', change: 'moved', to: 'guild_house', why: 'went to question the Guildmaster' },
      { who: 'lantern_seller', change: 'died', to: null, why: 'knifed in the crowd' },
      { who: 'fry_cook', change: 'moved', to: 'no_such_place', why: 'packed up his stall' },
      { who: 'mira', change: 'left', to: null, why: 'a companion is never sent away by the scribe' },
      { who: 'kessa', change: 'died', to: null, why: 'she was not in the scene' },
    ] });
    await s.submit('I watch the market.');
    await s.travel('guild_house');
    const scribe = text(h.requests.find((r) => r.role === 'scribe')!);
    expect(scribe).toContain('[mira] Mira (travels with the protagonist)');
    expect(scribe).toContain('PLACES NEARBY');
    expect(scribe).toContain('[guild_house] Guild House');
    const people = s.story.world.people;
    expect(people.roth).toMatchObject({ placeId: 'guild_house' });
    expect(people.roth!.away).toBeUndefined();
    expect(people.lantern_seller).toMatchObject({ placeId: 'nowhere', away: { how: 'dead', why: 'knifed in the crowd', day: 12 } });
    expect(people.fry_cook).toMatchObject({ placeId: 'nowhere', away: { how: 'left', why: 'packed up his stall' } });
    expect(people.mira).toMatchObject({ inParty: true });
    expect(isAway(people.kessa!)).toBe(false);
    // Roth is where he went: the next scene there has him in it.
    expect(s.scene.cast).toContain('roth');
    expect(whereLine(s.story, people.lantern_seller!)).toBe('Dead since day 12: knifed in the crowd.');
    expect(whereLine(s.story, people.mira!)).toBe('Travelling with you.');
    await s.travel('lantern_market');
    expect(s.scene.cast).not.toContain('roth');
    expect(s.scene.cast).not.toContain('lantern_seller');
  });

  it('those beaten in a fight are gone, and it is said why', async () => {
    const h = harness();
    const s = h.session;
    await s.travel('canal_bridge');
    s.story.rng = fixedDice(1);
    for (const id of ['knifeman', 'cudgel']) { const f = s.story.world.people[id]!.fight!; f.hp = 1; f.armor = 0; f.skill = 0; }
    await s.submit('I attack the hooded knifeman.');
    for (let i = 0; i < 12 && s.combat; i++) {
      const foe = Object.values(s.combat.fighters).find((f) => f.side === 'foe' && f.hp > 0);
      if (!foe) break;
      await s.combatAct({ type: 'attack', target: foe.id });
    }
    expect(s.combat).toBeNull();
    expect(s.story.world.people.knifeman).toMatchObject({ placeId: 'nowhere', away: { how: 'left', why: 'beaten in a fight with you' } });
  });

  it('what the builder wrote would become of someone comes to pass with the stage, unless they travel with the protagonist by then', async () => {
    const { session: s } = await builtHarness();
    const story = s.story;
    const levy = story.world.fronts!.find((f) => f.id === 'barons_levy')!;
    expect(levy.fates).toEqual([{ stage: 3, who: 'garrick', then: 'moves', to: 'garrow_keep', why: 'taken to Garrow Keep as a hostage when the riders searched Smiths’ Row' }]);
    expect(story.world.fronts!.find((f) => f.id === 'failing_seam')!.fates).toEqual([{ stage: 3, who: 'sable', then: 'leaves', why: 'left Ashford by night when the owners sold out' }]);
    await s.begin();
    for (const f of story.world.fronts!) f.stage = 2;
    story.worldDice = fixedDice(1);
    later(story, 9);
    await s.travel('market_square');
    expect(story.world.fronts!.find((f) => f.id === 'barons_levy')!.stage).toBe(3);
    expect(story.world.people.garrick).toMatchObject({ placeId: 'garrow_keep' });
    expect(story.world.people.sable).toMatchObject({ placeId: 'nowhere', away: { how: 'left', why: 'left Ashford by night when the owners sold out' } });
    // By rule alone: a companion is passed by, and so is somebody already gone.
    const fresh = (await builtHarness()).session.story;
    joinParty(fresh.world.people.garrick!);
    expect(applyFate(fresh, levy.fates![0]!)).toBe(false);
    expect(fresh.world.people.garrick!.placeId).not.toBe('garrow_keep');
    expect(applyFate(fresh, { who: 'sable', then: 'dies', why: 'a fever' })).toBe(true);
    expect(applyFate(fresh, { who: 'sable', then: 'leaves', why: 'again' })).toBe(false);
    expect(applyFate(fresh, { who: 'pell', then: 'moves', to: 'nowhere_at_all', why: 'x' })).toBe(false);
    expect(applyFate(fresh, { who: 'nobody', then: 'dies', why: 'x' })).toBe(false);
  });
});

describe('situations left alone', () => {
  it('one the protagonist walked away from comes to pass after some days: its news is told there, and someone may be gone', async () => {
    const { session: s } = await builtHarness();
    const story = s.story;
    await s.begin();
    const seeds = story.world.seeds!;
    expect(seeds.find((x) => x.id === 'isras_charts')).toMatchObject({ news: expect.stringContaining('morning barge'), fate: { who: 'isra', then: 'moves', to: 'far_market' } });
    // In the town where they wait, nothing ends by itself however long it takes.
    later(story, 30);
    expect(lapseSeeds(story, 'market_square')).toEqual([]);
    // From another town, and after the days have passed: the first that has an outcome written for it.
    expect(SEED_RULE.days).toBe(4);
    const lapsed = lapseSeeds(story, 'stonewater');
    expect(lapsed.map((x) => x.seed.id)).toEqual(['true_pages']);
    expect(story.world.settled).toEqual(['true_pages']);
    // One a chapter.
    expect(lapseSeeds(story, 'stonewater')).toEqual([]);
    story.chapter.n += 1;
    expect(lapseSeeds(story, 'stonewater').map((x) => [x.seed.id, x.fated])).toEqual([['levy_list', true]]);
    expect(story.world.people.dunmore!.placeId).toBe('garrow_keep');
    // A situation with no outcome written for it never ends by itself.
    story.chapter.n += 1;
    expect(lapseSeeds(story, 'stonewater').map((x) => x.seed.id)).toEqual(['isras_charts']);
    story.chapter.n += 1;
    expect(lapseSeeds(story, 'stonewater')).toEqual([]);
    expect(seeds.filter((x) => !story.world.settled!.includes(x.id)).every((x) => !x.news && !x.fate)).toBe(true);
  });

  it('in play: the days are counted from when it was last in view, and the news waits for the protagonist where it happened', async () => {
    const h = await builtHarness();
    const s = h.session;
    const story = s.story;
    await s.begin();
    expect(story.seedsSeen).toMatchObject({ the_ledger: 1 });
    story.worldDice = fixedDice(6); // nothing in motion moves by the die
    for (const f of story.world.fronts!) f.stopped = true;
    // Out of town, three days on: not yet.
    for (const p of Object.values(story.world.places)) if (p.kind !== 'world') p.known = 'visited';
    later(story, 3);
    await s.travel('market_square');
    await s.travel('east_gate');
    await s.travel('garrow_keep');
    expect(story.world.settled ?? []).toEqual([]);
    later(story, 2);
    h.narrator.push(ends('You wait out the rain.', 'time: 30', 'end: scene'));
    await s.submit('I wait out the rain.');
    expect(story.world.settled).toEqual(['true_pages']);
    const news = story.events.find((e) => e.front === 'true_pages')!;
    expect(news).toMatchObject({ placeId: 'assay_house', reach: 'local', importance: 2 });
    // It is talk in Ashford, where it happened, and not at the Keep.
    later(story, 1);
    expect(newsFor(story, 'market_square').map((e) => e.id)).toContain(news.id);
    expect(newsFor(story, 'garrow_keep').map((e) => e.id)).not.toContain(news.id);
  });
});

describe('people talk', () => {
  it('what was kept secret is passed on by those who saw it and are no friends of the protagonist, to the people where they are', () => {
    const story = sample();
    const e = secret(story, { witnesses: ['roth', 'mira'] });
    // Roth is at the Lantern Market; so is nobody else with a name who is not a companion. Put two people beside him.
    story.world.people.dace!.placeId = 'lantern_market';
    story.world.people.hask!.placeId = 'lantern_market';
    story.world.people.kessa!.placeId = 'lantern_market';
    expect(tell(story, fixedDice(TELL.chance + 1))).toBe(0); // not this time
    expect(tell(story, fixedDice(TELL.chance))).toBe(2);
    // Two at a time, the story's major people first; never the companions, never a crowd.
    expect(e.told).toEqual(['hask', 'kessa']);
    expect(knowledgeOf(story, 'hask').find((k) => k.event === e)).toMatchObject({ how: 'told' });
    expect(personCard(story, story.world.people.hask!)).toContain('Was told: You paid the clerk to lose a page.');
    expect(tell(story, fixedDice(1))).toBe(1);
    expect(e.told).toEqual(['hask', 'kessa', 'dace']);
    expect(tell(story, fixedDice(1))).toBe(0); // everyone there knows
  });

  it('a friend keeps a secret unless they hold a grievance; trifles, old things and open news are not passed on; a secret reaches six people at most', () => {
    const story = sample();
    const people = story.world.people;
    for (const id of ['dace', 'hask', 'kessa', 'lise', 'sela']) people[id]!.placeId = 'lantern_market';
    people.roth!.bond = TELL.friend;
    const kept = secret(story, { witnesses: ['roth'] });
    expect(tell(story, fixedDice(1))).toBe(0);
    people.roth!.grievance = 'You lied to him.';
    expect(tell(story, fixedDice(1))).toBe(2);
    expect(kept.told).toHaveLength(2);
    // Not worth telling, not secret, or news of the world: none of these is passed on.
    const small = secret(story, { witnesses: ['roth'], importance: 1 });
    const open = secret(story, { witnesses: ['roth'], reach: 'local' });
    const world = secret(story, { witnesses: ['roth'], front: 'borrowed_seal' });
    // Too long ago.
    const old = secret(story, { witnesses: ['roth'], clock: { day: story.clock.day - TELL.days - 1, minute: 0 } });
    story.events.sort((a, b) => a.clock.day - b.clock.day);
    for (let i = 0; i < 6; i++) tell(story, fixedDice(1));
    expect([small, open, world, old].map((x) => x.told.length)).toEqual([0, 0, 0, 0]);
    // The cap.
    for (let i = 0; i < 12; i++) people[`extra${i}`] = { ...people.hask!, id: `extra${i}`, name: `Extra ${i}`, placeId: 'lantern_market' };
    for (let i = 0; i < 12; i++) tell(story, fixedDice(1));
    expect(kept.told).toHaveLength(TELL.max);
  });

  it('in play: the word gets about when a scene ends, by the world’s dice, and a rewind takes it back', async () => {
    const h = harness();
    const s = h.session;
    s.story.world.people.hask!.placeId = 'lantern_market';
    s.story.worldDice = fixedDice(1);
    h.scribe.push({ ...SCRIBE, events: [{ text: 'You slipped the Watch’s seal out of Roth’s glove.', importance: 'changed_something', reach: 'secret', actors: [], witnesses: ['roth'] }] });
    await s.submit('I lift the seal from his glove.');
    await s.travel('guild_house');
    const slipped = () => s.story.events.find((x) => x.text.startsWith('You slipped the Watch'))!;
    // Recorded as the scene ended; told at the end of the next one.
    expect(slipped().told).toEqual([]);
    await s.travel('lantern_market');
    expect(slipped().told).toEqual(['hask']);
    expect(await s.rewindTo(2)).toBe(true);
    expect(slipped().told).toEqual([]);
  });
});

describe('a personal quest', () => {
  it('opens in the moment that waits when the bond becomes Close: the narrator is told what they ask, and it becomes a thread of theirs', async () => {
    const h = harness();
    const s = h.session;
    const mira = () => s.story.world.people.mira!;
    expect(mira().wish).toContain('the report Captain Roth had her falsify');
    expect(asksIn(mira())).toBe(false);
    h.narrator.push(ends('She nods, once.', 'bond: mira | significant | - | You kept her name out of it when Roth asked.'));
    await s.submit('I tell Roth I travel alone.');
    expect(mira()).toMatchObject({ bond: 60, pendingMoment: 'Close' });
    expect(asksIn(mira())).toBe(true);
    // The next scene's card says what she will ask.
    await s.travel('guild_house');
    expect(s.scene.packet).toContain('A moment is waiting since the bond became Close. In it they ask for help with something of their own: To set right the report');
    h.narrator.push(ends('Mira sits down across from you and, for once, starts talking.', 'time: 30', 'moment: mira'));
    await s.submit('I sit with Mira by the fire and ask how she is.', 'mira');
    expect(s.lastTurn!.engineNote).toContain('In it Mira asks Aren for help with something of their own: To set right the report Captain Roth had her falsify');
    const thread = s.story.threads.at(-1)!;
    expect(thread).toMatchObject({ kind: 'personal', status: 'open', title: 'Mira: To set right the report Captain Roth had her falsify, without being the one who answers for it.' });
    expect(mira()).toMatchObject({ pendingMoment: null, quest: thread.id });
    // Asked once: a later moment is only a moment.
    mira().pendingMoment = 'Devoted';
    expect(asksIn(mira())).toBe(false);
    // The thread is hers in the packet of the next scene.
    await s.travel('lantern_market');
    expect(s.scene.packet).toContain(`[${thread.id}] Mira: To set right the report`);
  });

  it('someone with nothing of their own to ask has an ordinary moment', async () => {
    const h = harness();
    const s = h.session;
    delete s.story.world.people.mira!.wish;
    const threads = s.story.threads.length;
    h.narrator.push(ends('She nods, once.', 'bond: mira | significant | - | You kept her name out of it.'));
    await s.submit('I tell Roth I travel alone.');
    h.narrator.push(ends('Mira talks, for once.', 'time: 30', 'moment: mira'));
    await s.submit('I sit with Mira and ask how she is.', 'mira');
    expect(s.story.world.people.mira).toMatchObject({ pendingMoment: null });
    expect(s.story.threads.length).toBe(threads);
  });
});

describe('what the builder writes for all this', () => {
  const INPUT: BuildInput = {
    source: { kind: 'description', text: 'A mining valley.' }, premise: 'A tally clerk of the Lodge.', name: '',
    table: { style: 'adventure', powers: 'focus', companions: 1, romance: false, violence: 'moderate', leaveOut: '', language: 'en', narration: 'medium' },
  };
  const built = () => {
    const draft = newDraft('w1', INPUT, 0);
    const done: Record<string, unknown> = {};
    for (const step of ['skeleton', 'fronts', 'rules', 'glossary', 'start', 'people'] as const) {
      done[step] = cleanStep(step, mockArchitect({ step, input: INPUT, done: done as never }) as never, done as never, INPUT).data;
    }
    return { draft, done };
  };

  it('the demo world has wishes, outcomes and fates, and passes the checks', async () => {
    const { session: s } = await builtHarness();
    const w = s.story.world;
    expect(checkWorld(w)).toEqual([]);
    expect(Object.values(w.people).filter((p) => p.wish).map((p) => p.id).sort()).toEqual(['bram', 'isra', 'wren', 'ysolde']);
    expect(w.seeds!.filter((x) => x.news).map((x) => x.id)).toEqual(['true_pages', 'levy_list', 'isras_charts']);
    // Whoever starts at the protagonist's side is trusted from the first day.
    const withCompany = (await builtHarness({ table: { companions: 2 } })).session.story.world;
    expect(checkWorld(withCompany)).toEqual([]);
    const beside = Object.values(withCompany.people).filter((p) => p.inParty);
    expect(beside.length).toBeGreaterThan(0);
    for (const p of beside) expect(p.bond).toBe(COMPANION_BOND);
  });

  it('fates that point at nobody, nowhere, a stage that is not there, or a companion are left out, and it is said', () => {
    const { draft, done } = built();
    const raw = mockArchitect({ step: 'seeds', input: INPUT, done: done as never }) as { seeds: Record<string, unknown>[]; fates: unknown[] };
    const beside = (done.people as { people: { id: string; travels_with_you: boolean }[] }).people.find((p) => p.travels_with_you)!;
    raw.fates = [
      { front: 'failing_seam', stage: 3, who: 'sable', then: 'leaves', to: null, why: 'left by night' },
      { front: 'failing_seam', stage: 9, who: 'pell', then: 'leaves', to: null, why: 'a stage it does not have' },
      { front: 'no_such_front', stage: 1, who: 'pell', then: 'leaves', to: null, why: 'x' },
      { front: 'barons_levy', stage: 1, who: 'nobody', then: 'dies', to: null, why: 'x' },
      { front: 'barons_levy', stage: 1, who: 'garrick', then: 'moves', to: 'no_such_place', why: 'x' },
      { front: 'barons_levy', stage: 1, who: 'garrick', then: 'vanishes', to: null, why: 'x' },
      { front: 'barons_levy', stage: 2, who: beside.id, then: 'dies', to: null, why: 'a companion has no fate' },
      { front: 'barons_levy', stage: 2, who: 'sable', then: 'dies', to: null, why: 'nobody is taken away twice' },
      { front: 'barons_levy', stage: 2, who: 'lodge_crews', then: 'leaves', to: null, why: 'a crowd has no fate' },
    ];
    raw.seeds[0]!.becomes = { who: 'pell', then: 'moves', to: 'assay_house', why: 'he is there already' };
    raw.seeds[0]!.news = 'ok';
    const cleaned = cleanStep('seeds', raw as never, done as never, INPUT);
    expect(cleaned.data.fates).toEqual([{ front: 'failing_seam', stage: 3, who: 'sable', then: 'leaves', to: null, why: 'left by night' }]);
    expect(cleaned.data.seeds[0]).toMatchObject({ becomes: null, news: null });
    expect(cleaned.notes[0]).toContain('were left out');
    draft.steps = Object.assign({}, done, { seeds: cleaned.data }) as never;
    const world = assemble(draft);
    expect(checkWorld(world)).toEqual([]);
    expect(world.fronts!.flatMap((f) => f.fates ?? [])).toEqual([{ stage: 3, who: 'sable', then: 'leaves', why: 'left by night' }]);
  });

  it('a draft built before any of this still makes a world', () => {
    const { draft, done } = built();
    const raw = mockArchitect({ step: 'seeds', input: INPUT, done: done as never }) as { seeds: Record<string, unknown>[]; fates?: unknown[] };
    delete raw.fates;
    for (const x of raw.seeds) { delete x.news; delete x.becomes; }
    const old = cleanStep('seeds', raw as never, done as never, INPUT).data as { fates?: unknown };
    delete old.fates;
    draft.steps = Object.assign({}, done, { seeds: old }) as never;
    const world = assemble(draft);
    expect(checkWorld(world)).toEqual([]);
    expect(world.fronts!.every((f) => !f.fates)).toBe(true);
    expect(world.seeds!.every((x) => !x.news && !x.fate)).toBe(true);
  });

  it('the world checks catch a fate that points nowhere', async () => {
    const { session: s } = await builtHarness();
    const w = structuredClone(s.story.world);
    w.fronts![0]!.fates = [{ stage: 7, who: 'ghost', then: 'moves', to: 'atlantis', why: 'x' }];
    w.seeds![0]!.fate = { who: 'ghost', then: 'leaves', why: 'x' };
    const problems = checkWorld(w);
    expect(problems.some((p) => p.includes('at stage 7, which it does not have'))).toBe(true);
    expect(problems.some((p) => p.includes('says what becomes of "ghost", who does not exist'))).toBe(true);
    expect(problems.some((p) => p.includes('moves "ghost" to a place that does not exist'))).toBe(true);
  });
});

describe('the sample world for a character of one’s own', () => {
  it('is the same coast with nobody knowing the newcomer and nothing begun', () => {
    const before = JSON.stringify(lanternCoast);
    const t = lanternCoastTemplate();
    expect(JSON.stringify(lanternCoast)).toBe(before); // the story of Aren is left as it was
    expect(checkWorld(t.world)).toEqual([]);
    const people = Object.values(t.world.people);
    expect(people.filter((p) => p.inParty || p.bond !== 0 || p.met || p.grievance || p.pinned || p.valuesKnown.length)).toEqual([]);
    expect(t.world.people.lise).toMatchObject({ role: 'Chandler on the second quay', kind: 'friendship' });
    expect(t.world.people.lise!.card).not.toMatch(/\byou(r)?\b/i);
    expect(t.world.people.hask!.card).not.toContain('Gave you the letter');
    expect(t.world.people.mira).toMatchObject({ placeId: 'north_gate', attitude: 'Guarded', wish: expect.any(String) });
    // Nobody is waiting on the bridge to kill a stranger.
    expect(people.filter((p) => /hostile/i.test(p.attitude))).toEqual([]);
    expect(t.world.fronts!.map((f) => f.stage)).toEqual([0, 0, 0]);
    expect(Object.values(t.world.places).filter((p) => p.known === 'visited').map((p) => p.id).sort()).toEqual(['lantern_coast', 'lantern_market']);
    expect(t.world.places.harbour!.brief).not.toContain('Lise');
    expect(t).toMatchObject({ source: { kind: 'sample' }, opening: { hour: 18, title: 'A Stranger on the Coast' } });
  });

  it('a story can be started in it with a character made by its rules, and played', async () => {
    const t = lanternCoastTemplate();
    const answer = mockArchitect({ step: 'character', input: { source: { kind: 'description', text: '' }, premise: 'A ferryman’s daughter who wants off the water.', name: 'Ines', table: { style: 'adventure', powers: 'focus', companions: 2, romance: true, violence: 'moderate', leaveOut: '', language: 'en', narration: 'medium' } }, done: {}, world: t.world }) as CharacterOut;
    const who = proposalFrom(answer, creationRules(t.world), 'Ines');
    const story = newStory(startSeed(t, who, { id: 'own', seed: 5 }), 0);
    expect(story).toMatchObject({ title: 'A Stranger on the Coast', clock: { day: 1, minute: 18 * 60 }, chapter: { n: 1, title: 'Port Varn' } });
    expect(story.protagonist.name).toBe('Ines');
    expect(story.threads.map((x) => x.kind)).toEqual(['main']);
    expect(story.events).toEqual([]);
    const h = harness({ story });
    await h.session.begin();
    expect(h.session.scene.placeId).toBe('lantern_market');
    expect(h.session.scene.cast).toContain('roth');
    expect(h.session.scene.cast).not.toContain('mira');
    // A stranger has to earn the company the ready-made story starts with.
    await h.session.travel('north_gate');
    expect(h.session.scene.cast).toContain('mira');
    await h.session.submit('Mira, come with me across the flats.');
    expect(h.session.story.world.people.mira!.inParty).toBe(false);
    expect(company(h.session.story).at(-1)!.text).toBe('Mira would travel with someone they know as Trusted. You are at No bond yet.');
  });
});
