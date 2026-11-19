// Powers that come and go, in a world of gifts: several powers on one sheet (the one by nature, and
// others gained in play), disciplines that are taught, items of power, seal, copy and steal, and a
// power taken by a thief. See docs/PLAN.md, section 14, "Powers that come and go".
import { describe, expect, it } from 'vitest';
import {
  MOVES_MAX, OWN_POWER, POWERS_MAX, canImprovise, canKeep, canRaiseGift, canUseAbility, cleanArts, fixedDice, moveKey, movesHeld, movesOf,
  powerById, powersOf, raiseGift, splitMoveKey, act, makeRng, startCombat, winChance,
  type Art, type Combat, type Gift, type NewCombatant, type Sheet,
} from '../src/engine';
import { buildPacket, personCard, powerLine, powerLines, relicsHere } from '../src/game/cards';
import type { LlmRequest } from '../src/game/llm/transport';
import { canAwakenDiscipline, canLearnDiscipline, cleanDisciplines, disciplineArt, disciplinesTaughtHere } from '../src/game/arts';
import { canEat, canGet, canSetAside, cleanRelics, takeRelic } from '../src/game/arts';
import { borrowedPower, canTakePower } from '../src/game/arts';
import { hasNatureHeld, powerToTake, robPower } from '../src/game/arts';
import { upgrade } from '../src/game/save';
import type { Story } from '../src/game/types';
import { checkWorld } from '../src/game/world';
import { personPower, powerEffect } from '../src/game/world';
import { sendAway } from '../src/game/whereabouts';
import { builtHarness, harness } from './helpers';

const asText = (req: LlmRequest): string => req.params.messages.map((m) => (typeof m.content === 'string' ? m.content : m.content.map((b) => (b.type === 'text' ? b.text : '')).join(''))).join('\n');
const rolls = (story: Story, face: number) => { story.rng = fixedDice(face); };
const REF = { check: null, targets: [] as string[], mentions: [], recall: [], move_to: null, held: null, ability: null, improvise: null, minutes: 1, why_impossible: null, ask: null, ask_options: [] };

const rubber = (over: Partial<Gift> = {}): Gift => ({
  name: 'Rubber Body', text: 'A body of rubber: it stretches, bounces and shrugs off blunt blows.', limit: 'Cannot swim.',
  rank: 2, kinds: ['damage', 'guard'],
  moves: [
    { id: 'g1', name: 'Long Punch', tier: 1, text: 'A fist thrown from across the room.', fight: 'damage' },
    { id: 'g2', name: 'Balloon', tier: 2, text: 'Swell up and let blows bounce off.', fight: 'guard' },
  ],
  ...over,
});
/** Armament Haki, as a discipline learned: its first move has the same id inside it as the rubber body's. */
const armament = (over: Partial<Gift> = {}): Art => ({
  id: 'armament', source: 'taught', from: 'armament',
  power: { name: 'Armament Haki', text: 'Will made armour: the body and what it holds harden like black iron.', limit: 'Tires the will.', rank: 1, kinds: ['guard', 'damage'],
    moves: [{ id: 'g1', name: 'Harden', tier: 1, text: 'Blacken an arm against a blow.', fight: 'guard' }], ...over },
});
const sheet = (over: Partial<Sheet> = {}): Sheet => ({
  strength: 2, skill: 3, resistance: 2, armor: 1, firepower: 0, hp: 10, energy: 10, paths: {}, skills: [], advantages: [], disadvantages: [], abilities: [],
  gift: rubber(), arts: [armament()], ...over,
});

describe('several powers on one sheet', () => {
  it('the power by nature comes first, as "own"; others follow by their own ids, those set aside left out', () => {
    const s = sheet({ arts: [armament(), { id: 'dial', source: 'item', from: 'impact_dial', aside: true, power: rubber({ name: 'Impact Dial', moves: [] }) }] });
    expect(powersOf(s).map((p) => p.id)).toEqual([OWN_POWER, 'armament']);
    expect(powerById(s, 'dial')).toBeUndefined();
    expect(powersOf({ arts: [armament()] }).map((p) => p.id)).toEqual(['armament']);
    // Four in use at most, however many a file says.
    const many = sheet({ arts: ['a', 'b', 'c', 'd'].map((id) => ({ ...armament(), id })) });
    expect(powersOf(many)).toHaveLength(POWERS_MAX);
  });

  it('two powers’ first moves are never confused: the moves of another power carry its id', () => {
    const s = sheet();
    expect(movesOf(s).map((m) => [m.id, m.of])).toEqual([['g1', 'own'], ['g2', 'own'], ['armament:g1', 'armament']]);
    expect(moveKey('own', 'g1')).toBe('g1');
    expect(splitMoveKey('armament:g1')).toEqual({ power: 'armament', move: 'g1' });
    expect(splitMoveKey('g2')).toEqual({ power: 'own', move: 'g2' });
    // A move is used against its own power's rank: Harden is tier 1 of a rank-1 discipline.
    expect(canUseAbility(s, 'armament:g1', 'gift')).toMatchObject({ ok: true, cost: 1 });
    const tooHigh = sheet({ arts: [armament({ moves: [{ id: 'g1', name: 'Black Fist', tier: 2, text: '', fight: 'damage' }] })] });
    expect(canUseAbility(tooHigh, 'armament:g1', 'gift')).toEqual({ ok: false, reason: 'rank' });
    // Someone with only a discipline has a power to use.
    expect(canUseAbility(sheet({ gift: undefined }), 'armament:g1', 'gift')).toMatchObject({ ok: true });
  });

  it('a new use is held to the rank of the power it belongs to', () => {
    const s = sheet();
    expect(canImprovise(s, null, 2, 'gift', 'own')).toMatchObject({ ok: true, cost: 3 });
    expect(canImprovise(s, null, 2, 'gift', 'armament')).toEqual({ ok: false, reason: 'rank' });
    // With none named, the one by nature; with none by nature, the first there is.
    expect(canImprovise(s, null, 2, 'gift')).toMatchObject({ ok: true });
    expect(canImprovise(sheet({ gift: undefined }), null, 1, 'gift')).toMatchObject({ ok: true, cost: 2 });
    expect(canImprovise(sheet({ gift: undefined, arts: [] }), null, 1, 'gift')).toEqual({ ok: false, reason: 'no_gift' });
  });

  it('a use is kept on its own power, eight moves at most in all, and nothing is kept from a borrowed one', () => {
    const s = sheet();
    expect(canKeep(s, { text: 'I harden my shins.', tier: 1, fight: 'guard', power: 'armament' }, 'Iron Shins', 1, 5, 1)).toBeNull();
    // A rank-1 discipline holds two; one more makes it full.
    const full = sheet({ arts: [armament({ moves: [{ id: 'g1', name: 'Harden', tier: 1, text: '' }, { id: 'g2', name: 'Shove', tier: 1, text: '' }] })] });
    expect(canKeep(full, { text: 'x', tier: 1, power: 'armament' }, 'X', 1, 5, 1)).toBe('full');
    // Eight moves of one's own on the sheet, whatever room each power has.
    const crowded = sheet({
      gift: rubber({ rank: 4, moves: Array.from({ length: 7 }, (_, i) => ({ id: `g${i + 1}`, name: `M${i}`, tier: 1, text: '' })) }),
      arts: [armament({ rank: 2 })],
    });
    expect(movesHeld(crowded)).toBe(MOVES_MAX);
    expect(canKeep(crowded, { text: 'x', tier: 1, power: 'armament' }, 'X', 1, 5, 1)).toBe('all');
    const borrowed = sheet({ arts: [{ id: 'borrowed', source: 'borrowed', from: 'kaito', until: 's2', power: rubber({ name: 'Heat Haze', moves: [] }) }] });
    expect(canKeep(borrowed, { text: 'x', tier: 1, power: 'borrowed' }, 'X', 1, 5, 1)).toBe('borrowed');
    // A borrowed power's move does not count among one's own.
    expect(movesHeld(sheet({ arts: [{ id: 'borrowed', source: 'borrowed', power: rubber() }] }))).toBe(2);
  });

  it('the rank of a discipline is raised like one’s own; an item’s power and a borrowed one are what they are', () => {
    const s = sheet();
    expect(canRaiseGift(s, 10, 'armament')).toBeNull();
    expect(raiseGift(s, 'armament').arts![0]!.power.rank).toBe(2);
    expect(raiseGift(s, 'armament').gift!.rank).toBe(2); // the other is untouched
    const item = sheet({ arts: [{ id: 'dial', source: 'item', from: 'impact_dial', power: rubber({ name: 'Impact Dial' }) }] });
    expect(canRaiseGift(item, 10, 'dial')).toBe('fixed');
    expect(canRaiseGift(s, 10, 'nothing')).toBe('none');
  });

  it('powers read from a file are held to the rules, each with where it came from', () => {
    expect(cleanArts([
      armament(),
      { ...armament(), id: 'armament' }, // the same id twice
      { ...armament(), id: 'own' }, // the id of the power by nature
      { ...armament(), id: 'Bad Id!' },
      { ...armament(), id: 'odd', source: 'found' }, // a source the game does not know
      { id: 'empty', source: 'taught', power: { name: '', text: '', rank: 0 } },
      { id: 'borrowed', source: 'borrowed', from: 'kaito', until: 's3', stolen: true, power: rubber() },
      { id: 'dial', source: 'item', until: 's3', stolen: true, aside: true, power: rubber({ rank: 9 }) },
    ])).toEqual([
      armament(),
      { id: 'borrowed', source: 'borrowed', from: 'kaito', until: 's3', stolen: true, power: rubber() },
      { id: 'dial', source: 'item', aside: true, power: rubber({ rank: 4 }) },
    ]);
    expect(cleanArts('nothing')).toBeUndefined();
    expect(cleanArts([])).toBeUndefined();
    // Through the loading of a story.
    const h = harness();
    const file = structuredClone(h.session.story) as Story;
    (file.protagonist.sheet as { arts?: unknown }).arts = [armament(), { id: 'x', source: 'nowhere', power: rubber() }];
    expect(upgrade(file).story.protagonist.sheet.arts).toEqual([armament()]);
  });
});

describe('several powers in play', () => {
  /** A story in a world of gifts, with the rubber body and Armament Haki on the sheet. */
  const twoPowers = async () => {
    const h = await builtHarness({ table: { powers: 'gift' } });
    const me = h.session.story.protagonist;
    me.sheet.gift = rubber();
    me.sheet.arts = [armament()];
    return h;
  };

  it('the referee is given each power on a line with its id, and the narrator a line for each', async () => {
    const h = await twoPowers();
    const s = h.session;
    await s.submit('I look around.');
    const referee = asText(h.requests.find((r) => r.role === 'referee')!);
    expect(referee).toContain('GIFT [own] Rubber Body, rank 2 of 4; in a fight: damage, guard.');
    expect(referee).toContain('GIFT [armament] Armament Haki (learned), rank 1 of 4; in a fight: guard, damage.');
    expect(referee).toContain('[g1] Long Punch (1 energy); [g2] Balloon (2 energy); [armament:g1] Harden (1 energy)');
    expect(powerLines(s.story)).toEqual([
      'POWER Rubber Body, rank 2 of 4. A body of rubber: it stretches, bounces and shrugs off blunt blows. Limit: Cannot swim.',
      'POWER Armament Haki (a discipline learned), rank 1 of 4. Will made armour: the body and what it holds harden like black iron. Limit: Tires the will.',
    ]);
    expect(powerLine(s.story, 'armament')).toBe(powerLines(s.story)[1]);
    expect(buildPacket(s.story, s.scene)).toContain('\nPOWER Armament Haki (a discipline learned), rank 1 of 4.');
  });

  it('a new use names its power: it is held to that power’s rank, and kept on it', async () => {
    const h = await twoPowers();
    const s = h.session;
    const me = () => s.story.protagonist;
    rolls(s.story, 1);
    me().xp = 5;
    // Beyond the discipline's rank: refused, though the rubber body could reach it.
    h.referee.push({ ...REF, kind: 'ability', ability: 'armament', improvise: { path: null, tier: 2, effect: 'damage' } });
    await s.submit('I harden my whole arm and smash the cart.');
    expect(s.notice).toBe('That is more than your power can do yet.');
    h.referee.push({ ...REF, kind: 'ability', ability: 'armament', improvise: { path: null, tier: 1, effect: 'guard' } });
    await s.submit('I harden my shins before I kick the post.');
    expect(me().worked).toEqual([{ text: 'I harden my shins before I kick the post.', tier: 1, fight: 'guard', power: 'armament' }]);
    expect(s.lastTurn!.engineNote).toContain('uses their own power (Armament Haki)');
    expect(s.keepWorked(0, 'Iron Shins', '', 1)).toBe(true);
    expect(me().sheet.arts![0]!.power.moves.map((m) => m.id)).toEqual(['g1', 'g2']);
    expect(me().sheet.gift!.moves).toHaveLength(2); // the rubber body is untouched
    // A kind the named power does not have counts as none; with no power named, the first that has it.
    h.referee.push({ ...REF, kind: 'ability', improvise: { path: null, tier: 1, effect: 'guard' } });
    await s.submit('I brace with my power.');
    expect(s.lastTurn!.engineNote).toContain('uses their own power (Rubber Body)');
  });

  it('forgetting, raising and the narrator’s word on each are per power; a rewind takes them all back', async () => {
    const h = await twoPowers();
    const s = h.session;
    const me = () => s.story.protagonist;
    await s.begin();
    me().xp = 20;
    const before = structuredClone(me().sheet);
    expect(s.forgetMove('armament:g1')).toBe(true);
    expect(me().sheet.arts![0]!.power.moves).toEqual([]);
    expect(me().sheet.gift!.moves).toHaveLength(2);
    expect(s.raiseGift('armament')).toBe(true);
    expect(s.raiseGift()).toBe(true);
    // Two powers changed: the narrator is told of both, not only of the last.
    expect(s.story.tellNext).toHaveLength(2);
    await s.submit('I look around.');
    const note = s.lastTurn!.engineNote;
    expect(note).toContain('power: Robin\'s Armament Haki has grown since the scene began. POWER Armament Haki (a discipline learned), rank 2 of 4.');
    expect(note).toContain('power: Robin\'s own power has grown since the scene began. POWER Rubber Body, rank 3 of 4.');
    expect(note).not.toMatch(/power:[a-z]+:/);
    expect(await s.rewindTo(1)).toBe(true);
    expect(me().sheet).toEqual(before);
  });

  it('in a fight both powers’ moves are at hand, each by its own id', async () => {
    const h = await twoPowers();
    const s = h.session;
    const guards = s.story.world.people.company_guards!;
    guards.placeId = 'market_square';
    guards.attitude = 'Hostile';
    await s.travel('market_square');
    rolls(s.story, 1);
    h.referee.push({ ...REF, kind: 'fight', targets: ['company_guards'] });
    await s.submit('I attack the guards.');
    const hero = Object.values((s.scene.combat as Combat).fighters).find((f) => f.isProtagonist)!;
    expect(hero.abilities).toEqual(['g1', 'g2', 'armament:g1']);
    expect(Object.keys(hero.own!)).toEqual(['g1', 'g2', 'armament:g1']);
    expect(hero.own!['armament:g1']!.name).toBe('Harden');
    const energy = hero.energy!;
    await s.combatAct({ type: 'ability', ability: 'armament:g1' });
    expect(s.lastTurn!.engineNote).toContain('Harden');
    expect(s.story.protagonist.sheet.energy).toBeLessThanOrEqual(energy - 1);
  });
});

describe('disciplines: powers that are taught, or awaken', () => {
  it('what a world may hold: plain unique ids, words cut to length, one or two kinds, a first move that does something at tier 1', () => {
    const got = cleanDisciplines([
      { id: 'armament', name: 'Armament Haki', text: 'x'.repeat(300), limit: 'Tires the will.', kinds: ['guard', 'damage', 'heal'], move: { name: 'Harden', text: 'Blacken an arm.', fight: 'guard' }, taught: true },
      { id: 'armament', name: 'Twice', kinds: [], move: {}, taught: true },
      { id: 'Bad Id', name: 'Bad', kinds: [], move: {} },
      { id: 'own', name: 'Reserved', kinds: [], move: {} },
      { id: 'conqueror', name: 'Conqueror’s Haki', text: 'The will of a king.', limit: '', kinds: ['stagger'], move: { name: 'Glare', text: '', fight: 'stagger' }, taught: false },
      { id: 'observation', name: 'Observation Haki', text: 'Sense what is coming.', kinds: ['dazzle', 'nonsense'], move: { name: '', fight: 'heal' } },
    ]);
    expect(got.map((d) => d.id)).toEqual(['armament', 'conqueror', 'observation']);
    expect(got[0]!.text).toHaveLength(160);
    expect(got[0]!.kinds).toEqual(['guard', 'damage']);
    // A stagger takes tier 2, so a first move cannot stagger; a kind the discipline lacks is dropped.
    expect(got[1]).toMatchObject({ taught: false, move: { name: 'Glare' } });
    expect(got[1]!.move.fight).toBeUndefined();
    expect(got[2]).toMatchObject({ taught: true, kinds: ['dazzle'], move: { name: 'Observation Haki' } });
    expect(cleanDisciplines(Array.from({ length: 9 }, (_, i) => ({ id: `d${i}`, name: `D${i}`, kinds: [], move: {} })))).toHaveLength(4);
    // Learned, it is held at rank 1 with its first move.
    expect(disciplineArt(got[0]!)).toEqual({
      id: 'armament', source: 'taught', from: 'armament',
      power: { name: 'Armament Haki', text: 'x'.repeat(160), limit: 'Tires the will.', rank: 1, kinds: ['guard', 'damage'], moves: [{ id: 'g1', name: 'Harden', tier: 1, text: 'Blacken an arm.', fight: 'guard' }] },
    });
  });

  it('a world of gifts is built with them and people who practise them; the narrator is told; no other world has any', async () => {
    const h = await builtHarness({ table: { powers: 'gift' } });
    const w = h.session.story.world;
    expect(w.disciplines!.map((d) => [d.id, d.taught])).toEqual([['lamp_sense', true], ['iron_will', true], ['deep_voice', false]]);
    expect([w.people.bram!.trains, w.people.osk!.trains, w.people.dunmore!.trains]).toEqual(['iron_will', 'lamp_sense', 'deep_voice']);
    expect(checkWorld(w)).toEqual([]);
    await h.session.submit('I look around.');
    const narrator = h.requests.find((r) => r.role === 'narrator')!;
    const system = (narrator.params.system as { text: string }[]).map((b) => b.text).join('\n');
    expect(system).toContain('DISCIPLINES, powers that many people here share and practise. Lamp-Sense: A deep miner');
    expect(system).toContain('The Deep Voice (cannot be taught: it awakens, if ever)');
    expect(personCard(h.session.story, w.people.bram!)).toContain('Practises Iron Will and can teach it.');
    expect(personCard(h.session.story, w.people.dunmore!)).toContain('Practises The Deep Voice.');
    // What a world may not hold.
    const bad = structuredClone(w);
    bad.people.bram!.trains = 'nothing';
    bad.disciplines = [...bad.disciplines!, bad.disciplines![0]!];
    expect(checkWorld(bad)).toEqual(expect.arrayContaining(['the discipline "lamp_sense" is there twice', 'Bram Tolliver practises "nothing", which is not a discipline of this world']));
    bad.rules.powers = 'focus';
    expect(checkWorld(bad)).toContain('it has disciplines, and powers are not personal in it');
    const focus = await builtHarness({ table: { powers: 'focus' } });
    expect(focus.session.story.world.disciplines).toBeUndefined();
    expect(Object.values(focus.session.story.world.people).some((p) => p.trains)).toBe(false);
  });

  it('someone who practises one teaches it to a person they trust; it is then learned for ten experience, and a rewind takes it back', async () => {
    const h = await builtHarness({ table: { powers: 'gift' } });
    const s = h.session;
    const me = () => s.story.protagonist;
    const bram = s.story.world.people.bram!;
    expect(s.scene.cast).toContain('bram');
    await s.begin();
    // The referee is told who could teach what. Not yet: a mentor teaches it to someone Friendly.
    await s.submit('Bram, teach me Iron Will.');
    expect(asText(h.requests.filter((r) => r.role === 'referee').at(-1)!)).toContain('CAN BE TAUGHT HERE [iron_will] Iron Will by [bram]');
    expect(s.lastTurn!.engineNote).toContain('Bram Tolliver will not, yet');
    expect(me().found ?? []).toEqual([]);
    bram.bond = 25;
    await s.submit('Bram, teach me Iron Will.');
    expect(s.lastTurn!.engineNote).toContain('teach: Bram Tolliver agrees, and shows Robin the beginnings of Iron Will');
    expect(me().found).toEqual([{ id: 'iron_will', by: 'bram' }]);
    // Asked again (it is no longer offered, but a referee may still name it), it is answered without a turn.
    h.referee.push({ ...REF, kind: 'learn', ability: 'iron_will', targets: ['bram'] });
    await s.submit('Bram, teach me Iron Will.');
    expect(s.notice).toBe('You have already been shown Iron Will. Learn it on the Character screen.');
    expect(canLearnDiscipline(s.story, 'iron_will')).toBe('xp');
    me().xp = 12;
    const before = structuredClone({ sheet: me().sheet, found: me().found, xp: me().xp });
    expect(s.learnDiscipline('iron_will')).toBe(true);
    expect(s.learnDiscipline('iron_will')).toBe(false);
    expect(me().xp).toBe(2);
    expect(me().found).toEqual([]);
    expect(me().sheet.arts).toEqual([disciplineArt(s.story.world.disciplines!.find((d) => d.id === 'iron_will')!)]);
    expect(s.story.tellNext).toEqual([expect.stringContaining('power:iron_will: Robin has learned Iron Will since the scene began. POWER Iron Will (a discipline learned), rank 1 of 4.')]);
    // Held, it is no longer offered.
    expect(disciplinesTaughtHere(s.story, s.scene.placeId)).toEqual([]);
    await s.submit('I look around.');
    // Back to just after the turn before the learning: the learning is taken back with the turn after it.
    expect(await s.rewindTo(s.lastTurn!.n - 1)).toBe(true);
    expect({ sheet: me().sheet, found: me().found, xp: me().xp }).toEqual(before);
  });

  it('one that cannot be taught is refused by its practitioner, and awakens only after being brought down', async () => {
    const h = await builtHarness({ table: { powers: 'gift' } });
    const s = h.session;
    const me = () => s.story.protagonist;
    const dunmore = s.story.world.people.dunmore!;
    dunmore.placeId = s.scene.placeId;
    dunmore.bond = 90;
    s.scene.cast.push('dunmore');
    h.referee.push({ ...REF, kind: 'learn', ability: 'deep_voice', targets: ['dunmore'] });
    await s.submit('Sergeant, teach me the Deep Voice.');
    expect(s.lastTurn!.engineNote).toContain('It cannot be taught');
    expect(me().found ?? []).toEqual([]);
    me().xp = 10;
    expect(canAwakenDiscipline(s.story, 'deep_voice')).toBe('not_now');
    expect(canAwakenDiscipline(s.story, 'iron_will')).toBe('taught');
    expect(s.awakenDiscipline('deep_voice')).toBe(false);
    // Brought down in this scene: it can awaken now (or in the next scene, and not after).
    me().downIn = s.scene.id;
    expect(canAwakenDiscipline(s.story, 'deep_voice')).toBeNull();
    // With four powers held there is no room.
    me().sheet.arts = ['a', 'b', 'c', 'd'].map((id) => ({ ...armament(), id }));
    expect(canAwakenDiscipline(s.story, 'deep_voice')).toBe('room');
    me().sheet.arts = [];
    expect(s.awakenDiscipline('deep_voice')).toBe(true);
    expect(me().sheet.arts!.map((a) => [a.id, a.power.rank, a.power.moves[0]!.name])).toEqual([['deep_voice', 1, 'Weight of the Deep']]);
    expect(me().xp).toBe(0);
  });

  it('being brought down in a fight is remembered for that', async () => {
    const h = await builtHarness({ table: { powers: 'gift' } });
    const s = h.session;
    const guards = s.story.world.people.company_guards!;
    guards.placeId = 'market_square';
    guards.attitude = 'Hostile';
    await s.travel('market_square');
    s.story.protagonist.sheet.hp = 1;
    rolls(s.story, 1);
    h.referee.push({ ...REF, kind: 'fight', targets: ['company_guards'] });
    await s.submit('I attack the guards.');
    for (let i = 0; i < 12 && s.combat?.awaiting === 'action'; i++) await s.combatAct({ type: 'defend' });
    expect(s.combat?.awaiting).toBe('down');
    expect(s.story.protagonist.downIn).toBe(s.scene.id);
  });
});

describe('items of power', () => {
  const ctx = { places: new Set(['inn', 'yard']), people: new Set(['kaito']), seeds: new Map([['heist', 'yard']]), taken: new Set(['armament']) };
  const fruit = { id: 'flame_fruit', name: 'Flame-Flame Fruit', text: 'A swirled orange fruit.', use: 'eaten', major: true, power: { name: 'Flame Body', text: 'A body of fire.', limit: 'Water.', kinds: ['damage', 'guard', 'heal'], move: { name: 'Fire Fist', text: 'A fist of flame.', fight: 'damage' } }, place: null, holder: null, seed: 'heist' };

  it('what a world may hold: two at most, each with a power at rank 1 (2 for a great carried one) and one first move, lying somewhere or carried', () => {
    const got = cleanRelics([
      fruit,
      { ...fruit, id: 'flame_fruit' }, // twice
      { ...fruit, id: 'armament' }, // an id a discipline has
      { ...fruit, id: 'nowhere', seed: null }, // lies nowhere, carried by nobody
      { ...fruit, id: 'stranger', holder: 'ghost', seed: null }, // carried by someone who does not exist
      { ...fruit, id: 'dial', name: 'Impact Dial', use: 'carried', major: true, holder: 'kaito', seed: null },
      { ...fruit, id: 'third', place: 'inn', seed: null },
    ], ctx);
    expect(got.map((r) => r.id)).toEqual(['flame_fruit', 'dial']);
    // An eaten item's power starts at rank 1 whatever was asked; it lies where its situation is.
    expect(got[0]).toMatchObject({ use: 'eaten', placeId: 'yard', seed: 'heist', power: { rank: 1, kinds: ['damage', 'guard'], moves: [{ id: 'g1', name: 'Fire Fist', tier: 1, fight: 'damage' }] } });
    expect(got[1]).toMatchObject({ use: 'carried', holder: 'kaito', power: { rank: 2 } });
    expect(got[1]!.placeId).toBeUndefined();
  });

  it('a world of gifts is built with them; the narrator is told of one where the scene is, on the terms it can be had', async () => {
    const h = await builtHarness({ table: { powers: 'gift' } });
    const s = h.session;
    const w = s.story.world;
    expect(w.relics!.map((r) => [r.id, r.use, r.placeId ?? r.holder])).toEqual([['ember_fruit', 'eaten', 'long_table'], ['deep_lamp', 'carried', 'tam']]);
    expect(checkWorld(w)).toEqual([]);
    expect(relicsHere(s.story, s.scene).map((r) => r.id)).toEqual(['ember_fruit']);
    expect(buildPacket(s.story, s.scene)).toContain('ITEM OF POWER [ember_fruit] Ember Fruit. It lies here, bound up with [the_ledger]: it can be had once that is dealt with. A wrinkled red fruit');
    expect(buildPacket(s.story, s.scene)).toContain('bound up with [the_ledger]: it can be had once that is dealt with.');
    await s.submit('I look around.');
    const contract = (h.requests.find((r) => r.role === 'narrator')!.params.system as { text: string }[])[0]!.text;
    expect(contract).toContain('got: <item id>');
    // Nowhere else.
    const focus = await builtHarness({ table: { powers: 'focus' } });
    expect(focus.session.story.world.relics).toBeUndefined();
    await focus.session.submit('I look around.');
    expect((focus.requests.find((r) => r.role === 'narrator')!.params.system as { text: string }[])[0]!.text).not.toContain('got:');
    // What a world may not hold.
    const bad = structuredClone(w);
    bad.relics![1]!.holder = 'ghost';
    bad.relics![0]!.seed = 'nothing';
    expect(checkWorld(bad)).toEqual(expect.arrayContaining(['the item of power "deep_lamp" is carried by "ghost", who does not exist', 'the item of power "ember_fruit" belongs to "nothing", which is not a situation of this world']));
  });

  it('one that lies here is had only once its situation is dealt with; then it is eaten, in the story, and its power is one’s own', async () => {
    const h = await builtHarness({ table: { powers: 'gift' } });
    const s = h.session;
    const me = () => s.story.protagonist;
    delete me().sheet.gift;
    await s.begin();
    // Taken too soon: the narrator may say so, and the engine does not give it.
    await s.submit('I take the Ember Fruit from the shelf.');
    expect(s.lastTurn!.reply).toContain('got: ember_fruit');
    expect(me().items.some((i) => i.kind === 'relic')).toBe(false);
    expect(canGet(s.story, s.scene, 'ember_fruit')).toBe('not_settled');
    s.story.world.settled = ['the_ledger'];
    await s.submit('I take the Ember Fruit from the shelf.');
    expect(me().items.find((i) => i.kind === 'relic')).toMatchObject({ id: 'ember_fruit', name: 'Ember Fruit', relic: 'ember_fruit', qty: 1 });
    expect(s.story.world.relics![0]!.taken).toBe(true);
    expect(relicsHere(s.story, s.scene)).toEqual([]);
    expect(s.story.events.some((e) => e.text === 'You took Ember Fruit.')).toBe(true);
    // The referee is told it can be eaten; eating it is the same as the Eat button.
    const before = structuredClone({ sheet: me().sheet, items: me().items });
    await s.submit('I eat the Ember Fruit.');
    expect(asText(h.requests.filter((r) => r.role === 'referee').at(-1)!)).toContain('ITEMS OF POWER YOU CARRY [ember_fruit] Ember Fruit (eaten to gain its power)');
    expect(me().sheet.gift).toMatchObject({ name: 'Ember Body', rank: 1, kinds: ['damage', 'guard'] });
    expect(me().items.some((i) => i.kind === 'relic')).toBe(false);
    expect(s.lastTurn!.engineNote).toContain('eat: Robin eats Ember Fruit. Its power is their own from now on, for good. POWER Ember Body, rank 1 of 4.');
    // A rewind gives the fruit back, uneaten.
    expect(await s.rewindTo(s.lastTurn!.n - 1)).toBe(true);
    expect({ sheet: me().sheet, items: me().items }).toEqual(before);
    // One each: with a power of their own already, it is refused, and nothing happens.
    me().sheet.gift = rubber();
    expect(canEat(s.story, 'ember_fruit')).toBe('has_power');
    await s.submit('I eat the Ember Fruit.');
    expect(s.notice).toBe('You already have a power of your own: a second would not take.');
    expect(me().sheet.gift!.name).toBe('Rubber Body');
  });

  it('one that is carried is had from its carrier only when they are Close, or dropped when they are beaten; its power is held while it is carried', async () => {
    const h = await builtHarness({ table: { powers: 'gift' } });
    const s = h.session;
    const me = () => s.story.protagonist;
    const tam = s.story.world.people.tam!;
    tam.placeId = 'market_square';
    tam.attitude = 'Hostile';
    await s.travel('market_square');
    expect(relicsHere(s.story, s.scene).map((r) => r.id)).toEqual(['deep_lamp']);
    expect(buildPacket(s.story, s.scene)).toContain('Tam Reddy carries it, and would give it only to someone Close');
    expect(canGet(s.story, s.scene, 'deep_lamp')).toBe('not_close');
    tam.bond = 65;
    expect(canGet(s.story, s.scene, 'deep_lamp')).toBeNull();
    tam.bond = 0;
    // Beaten, he drops it where the fight was.
    tam.fight!.hp = 1;
    rolls(s.story, 1);
    h.referee.push({ ...REF, kind: 'fight', targets: ['tam'] });
    await s.submit('I attack Tam.');
    for (let i = 0; i < 6 && s.combat?.awaiting === 'action'; i++) await s.combatAct({ type: 'attack', target: 'tam' });
    expect(s.story.world.people.tam!.away?.how).toBe('left');
    expect(s.story.world.relics![1]).toMatchObject({ placeId: 'market_square' });
    expect(s.story.world.relics![1]!.holder).toBeUndefined();
    expect(s.lastTurn!.engineNote).toContain('drops The Deep Lamp');
    await s.submit('I pick up the deep lamp.');
    expect(me().items.find((i) => i.kind === 'relic')?.id).toBe('deep_lamp');
    expect(me().sheet.arts!.at(-1)).toMatchObject({ id: 'deep_lamp', source: 'item', from: 'deep_lamp', power: { name: 'Deep Lamp', rank: 1 } });
    expect(powerById(me().sheet, 'deep_lamp')).toBeDefined();
    expect(s.story.tellNext).toEqual([expect.stringContaining('power:deep_lamp: Robin has taken The Deep Lamp since the scene began.')]);
    // Set aside, its power is not in use; taken up again, it is.
    expect(s.setRelicAside('deep_lamp', true)).toBe(true);
    expect(powerById(me().sheet, 'deep_lamp')).toBeUndefined();
    expect(canEat(s.story, 'deep_lamp')).toBe('carried');
    expect(s.setRelicAside('deep_lamp', false)).toBe(true);
    expect(powerById(me().sheet, 'deep_lamp')).toBeDefined();
    // With four powers in use, it cannot be taken up until one is set aside.
    expect(s.setRelicAside('deep_lamp', true)).toBe(true);
    me().sheet.arts = [...me().sheet.arts!, ...['a', 'b', 'c'].map((id) => ({ ...armament(), id }))];
    expect(canSetAside(s.story, 'deep_lamp', false)).toBe('room');
    expect(s.setRelicAside('deep_lamp', false)).toBe(false);
  });

  it('someone carrying one who dies drops it where they were; one who leaves takes it away', async () => {
    const h = await builtHarness({ table: { powers: 'gift' } });
    const story = h.session.story;
    const tam = story.world.people.tam!;
    const where = tam.placeId;
    sendAway(story, tam, 'dead', 'killed in the night');
    expect(story.world.relics![1]).toMatchObject({ placeId: where });
    const g = await builtHarness({ table: { powers: 'gift' } });
    sendAway(g.session.story, g.session.story.world.people.tam!, 'left', 'gone downriver');
    expect(g.session.story.world.relics![1]!.holder).toBe('tam');
  });

  it('beaten while carrying one, the protagonist still has it, and the narrator is told so', async () => {
    const h = await builtHarness({ table: { powers: 'gift' } });
    const s = h.session;
    s.story.world.settled = ['the_ledger'];
    takeRelic(s.story, 'ember_fruit');
    const guards = s.story.world.people.company_guards!;
    guards.placeId = 'market_square';
    guards.attitude = 'Hostile';
    await s.travel('market_square');
    s.story.protagonist.sheet.hp = 1;
    rolls(s.story, 1);
    h.referee.push({ ...REF, kind: 'fight', targets: ['company_guards'] });
    await s.submit('I attack the guards.');
    for (let i = 0; i < 12 && s.combat?.awaiting === 'action'; i++) await s.combatAct({ type: 'defend' });
    expect(s.combat?.awaiting).toBe('down');
    s.story.settings.style = 'story';
    await s.chooseDown('test');
    expect(s.lastTurn!.engineNote).toContain('They still have Ember Fruit: whatever else is taken, that is not.');
  });
});

describe('seal, and the new powers of people', () => {
  it('a person’s power may seal or steal; its rank comes from how able they are; a thief holds what it takes or erases it', () => {
    expect(personPower({ name: 'Seastone Grip', text: '', fight: 'seal' }, 'able')).toEqual({ name: 'Seastone Grip', text: '', fight: 'seal', tier: 1, rank: 2 });
    expect(personPower({ name: 'Dark Hand', text: '', fight: 'steal', keeps: 'erased' }, 'dangerous')).toEqual({ name: 'Dark Hand', text: '', fight: 'steal', tier: 1, rank: 3, keeps: 'erased' });
    expect(personPower({ name: 'Dark Hand', text: '', fight: 'steal' }, 'weak')).toMatchObject({ rank: 1, keeps: 'held' });
    expect(personPower({ name: 'Forge Hands', text: '', fight: 'damage', keeps: 'erased' }, 'able')!.keeps).toBeUndefined();
    // In a fight both stop the protagonist's powers for a turn; the taking comes only if the thief wins.
    expect(powerEffect({ name: 'x', text: '', fight: 'seal', tier: 1 })).toEqual({ type: 'seal', turns: 1 });
    expect(powerEffect({ name: 'x', text: '', fight: 'steal', tier: 1 })).toEqual({ type: 'seal', turns: 1 });
  });

  const strike = { g1: { id: 'g1', name: 'Strike', tier: 2, cost: 2, text: '', own: true as const, combat: { type: 'damage' as const, value: 4, needsTarget: true } } };
  const hero = (over: Partial<NewCombatant> = {}): NewCombatant => ({ id: 'you', name: 'Hero', side: 'you', isProtagonist: true, strength: 2, skill: 2, armor: 1, hp: 10, energy: 10, abilities: ['g1'], own: strike, ...over });
  const sealer = (over: Partial<NewCombatant> = {}): NewCombatant => ({ id: 'osk', name: 'Osk', side: 'foe', strength: 1, skill: 4, armor: 1, hp: 30, quick: true, power: { name: 'Dead Air', effect: { type: 'seal', turns: 1 } }, ...over });

  it('in a fight a seal takes the place of the attack, and the protagonist’s powers are refused on their next turn, which is not lost', () => {
    // The sealer is quicker: their first turn comes before the protagonist's.
    const { combat, events } = startCombat([hero({ skill: 0 }), sealer()], fixedDice(3));
    const power = events.find((e) => e.type === 'power');
    expect(power).toMatchObject({ type: 'power', actor: 'osk', name: 'Dead Air', target: 'you', did: { type: 'seal', turns: 1 } });
    expect(events.some((e) => e.type === 'attack' && e.actor === 'osk')).toBe(false); // no blow with it
    const me = combat.fighters.you!;
    expect(me.sealed).toBe(1);
    expect(combat.awaiting).toBe('action');
    // A power is refused, and nothing has happened: the same choice can be made again.
    expect(() => act(combat, { type: 'ability', ability: 'g1', target: 'osk' }, fixedDice(3))).toThrow('your powers are sealed for now');
    expect(() => act(combat, { type: 'effect', name: 'x', cost: 1, effect: { type: 'damage', value: 2, needsTarget: true }, target: 'osk', worked: true }, fixedDice(3))).toThrow('your powers are sealed for now');
    expect(me.energy).toBe(10);
    // Any other action is a turn, and uses the seal up.
    act(combat, { type: 'attack', target: 'osk' }, fixedDice(3));
    expect(me.sealed ?? 0).toBe(0);
    if (combat.awaiting === 'action') expect(() => act(combat, { type: 'ability', ability: 'g1', target: 'osk' }, fixedDice(3))).not.toThrow();
  });

  it('someone with no power to seal is not sealed: the sealer attacks instead; and a sealed person’s own power does not fire', () => {
    const plain = hero({ abilities: [], own: undefined, skill: 0 });
    const { combat, events } = startCombat([plain, sealer()], fixedDice(3));
    expect(events.some((e) => e.type === 'power')).toBe(false);
    expect(events.some((e) => e.type === 'attack' && e.actor === 'osk')).toBe(true);
    expect(combat.fighters.you!.sealed ?? 0).toBe(0);
    // Sealed themselves, their power waits, and the seal is used up. (The protagonist is quicker here.)
    const second = startCombat([hero({ skill: 9 }), sealer({ quick: false, skill: 0 })], fixedDice(3));
    second.combat.fighters.osk!.sealed = 1;
    const after = act(second.combat, { type: 'defend' }, fixedDice(3));
    expect(after.some((e) => e.type === 'power')).toBe(false);
    expect(second.combat.fighters.osk!.sealed).toBe(0);
  });

  it('the encounter tuner plays a sealed protagonist with a blade, and does not stop on a refusal', () => {
    const odds = winChance([hero(), sealer({ hp: 12 })], makeRng(3), 300);
    expect(odds).toBeGreaterThan(0);
    expect(odds).toBeLessThan(1);
  });

  it('in a story: someone who seals uses it on the protagonist, the screen and the narrator are told, and a move is refused without a turn', async () => {
    const h = await builtHarness({ table: { powers: 'gift' } });
    const s = h.session;
    const me = s.story.protagonist;
    me.sheet.gift = rubber();
    const osk = s.story.world.people.osk!;
    expect(osk.power).toMatchObject({ name: 'Dead Air', fight: 'seal', rank: 1 });
    osk.placeId = 'market_square';
    osk.attitude = 'Hostile';
    osk.fight!.skill = 6; // quicker than the protagonist: the seal comes first
    me.sheet.skill = 0;
    await s.travel('market_square');
    rolls(s.story, 3);
    h.referee.push({ ...REF, kind: 'fight', targets: ['osk'] });
    await s.submit('I attack Osk.');
    // The seal came first, and the protagonist's attack used up the turn it lasted.
    const hero = Object.values(s.scene.combat!.fighters).find((f) => f.isProtagonist)!;
    expect(s.lastTurn!.engineNote).toContain('your powers are sealed: no power can be used on your next turn');
    expect(hero.sealed ?? 0).toBe(0);
    // Sealed again: a move is refused, and no model is asked for anything.
    hero.sealed = 1;
    const asked = h.requests.length;
    await s.combatAct({ type: 'ability', ability: 'g1', target: 'osk' });
    expect(s.notice).toBe('Your powers are sealed for now.');
    expect(h.requests.length).toBe(asked);
    // A new use typed now is refused the same way, before any die is rolled.
    h.referee.push({ ...REF, kind: 'ability', ability: 'own', improvise: { path: null, tier: 1, effect: 'damage' }, targets: ['osk'] });
    const rolled = s.story.rolls.length;
    await s.submit('I stretch and punch Osk from across the square.');
    expect(s.notice).toBe('Your powers are sealed: no power can be used on this turn.');
    expect(s.story.rolls.length).toBe(rolled);
  });
});

describe('copying and taking someone’s power, for a scene', () => {
  it('what is held: the lower of the use’s reach and their rank, their kind of fight effect, and the power itself as its one move', () => {
    expect(borrowedPower({ name: 'Forge Hands', text: 'Glowing hands.', fight: 'damage', tier: 1, rank: 2 }, 4)).toEqual({
      name: 'Forge Hands', text: 'Glowing hands.', limit: '', rank: 2, kinds: ['damage'], moves: [{ id: 'g1', name: 'Forge Hands', tier: 2, text: 'Glowing hands.', fight: 'damage' }],
    });
    expect(borrowedPower({ name: 'Forge Hands', text: '', fight: 'damage', tier: 1, rank: 3 }, 1).rank).toBe(1);
    // A seal or a theft does nothing for the protagonist in a fight; a power kept before ranks existed counts as rank 1.
    expect(borrowedPower({ name: 'Dead Air', text: '', fight: 'seal', tier: 1 }, 3)).toMatchObject({ rank: 1, kinds: [], moves: [{ name: 'Dead Air', tier: 1 }] });
    expect(borrowedPower({ name: 'Cold Hand', text: '', fight: 'stagger', tier: 1, rank: 1 }, 1).moves[0]!.fight).toBeUndefined();
  });

  /** A story in a world of gifts with a hero whose power copies, and Garrick, who has Forge Hands, in the scene. */
  const copier = async (kind: 'copy' | 'steal' = 'copy') => {
    const h = await builtHarness({ table: { powers: 'gift' } });
    const s = h.session;
    s.story.protagonist.sheet.gift = rubber({ kinds: ['damage', kind], rank: 3 });
    const garrick = s.story.world.people.garrick!;
    garrick.placeId = s.scene.placeId;
    s.scene.cast.push('garrick');
    await s.begin();
    return h;
  };

  it('copied outside a fight: a Skill test, then their power is held until the scene ends, and goes back then', async () => {
    const h = await copier();
    const s = h.session;
    const me = () => s.story.protagonist;
    rolls(s.story, 1);
    const energy = me().sheet.energy;
    // The referee is told who has a power.
    await s.submit('With my power I copy Garrick and his hands, from across everything.');
    expect(asText(h.requests.filter((r) => r.role === 'referee').at(-1)!)).toContain('[garrick] Garrick Stone (gruff, has a power: Forge Hands)');
    expect(me().sheet.energy).toBe(energy - 3); // a reach of 2, and one more for a new use
    expect(me().sheet.arts).toEqual([{ id: 'borrowed', source: 'borrowed', from: 'garrick', until: s.scene.id, power: expect.objectContaining({ name: 'Forge Hands', rank: 2 }) }]);
    expect(movesOf(me().sheet).map((m) => m.id)).toContain('borrowed:g1');
    expect(s.lastTurn!.engineNote).toContain('copied: Robin holds Garrick Stone\'s Forge Hands until this scene ends, reaching 2 of 4');
    expect(me().worked ?? []).toEqual([]); // nothing is kept from it
    expect(s.story.world.people.garrick!.power!.takenIn).toBeUndefined(); // a copy leaves them theirs
    // The referee sees it as a power held for now.
    await s.submit('I look around.');
    expect(asText(h.requests.filter((r) => r.role === 'referee').at(-1)!)).toContain('GIFT [borrowed] Forge Hands (borrowed for this scene), rank 2 of 4; in a fight: damage.');
    // The scene ends: it goes back.
    await s.travel('market_square');
    expect(me().sheet.arts).toBeUndefined();
    expect(s.lastTurn!.beats.some((b) => b.type === 'notes' && b.notes.some((n) => n.kind === 'info' && n.text === 'Forge Hands goes back to Garrick Stone.'))).toBe(true);
  });

  it('taken: they cannot use it in a fight in that scene, and it is theirs again when the scene ends; a rewind takes the theft back', async () => {
    const h = await copier('steal');
    const s = h.session;
    const me = () => s.story.protagonist;
    rolls(s.story, 1);
    const before = structuredClone({ sheet: me().sheet, garrick: s.story.world.people.garrick! });
    await s.submit('I steal his power, Garrick\'s, with my power.');
    expect(me().sheet.arts![0]).toMatchObject({ id: 'borrowed', from: 'garrick', stolen: true });
    expect(s.story.world.people.garrick!.power!.takenIn).toBe(s.scene.id);
    expect(s.lastTurn!.engineNote).toContain('and Garrick Stone cannot use it meanwhile');
    // A second theft from the same person: their power is not theirs to take now.
    expect(canTakePower(s.story, s.scene, ['garrick'])).toEqual({ ok: false, reason: 'nobody' });
    expect(await s.rewindTo(s.lastTurn!.n - 1)).toBe(true);
    expect({ sheet: me().sheet, garrick: s.story.world.people.garrick! }).toEqual(before);
  });

  it('refused with nobody to aim it at, or four powers held; nothing is spent', async () => {
    const h = await copier();
    const s = h.session;
    const me = () => s.story.protagonist;
    s.scene.cast = s.scene.cast.filter((id) => id !== 'garrick');
    const energy = me().sheet.energy;
    await s.submit('With my power I copy whatever power is here.');
    expect(s.notice).toBe('There is nobody here with a power to copy.');
    s.scene.cast.push('garrick');
    me().sheet.arts = ['a', 'b', 'c'].map((id) => ({ ...armament(), id }));
    await s.submit('With my power I copy Garrick.');
    expect(s.notice).toBe('You hold four powers already: there is no room to take on another.');
    expect(me().sheet.energy).toBe(energy);
  });

  it('in a fight: a plain roll, and the borrowed move is at hand at once; one taken from an opponent is gone from them for the fight', async () => {
    const h = await copier('steal');
    const s = h.session;
    const garrick = s.story.world.people.garrick!;
    garrick.attitude = 'Hostile';
    garrick.fight!.hp = 40;
    rolls(s.story, 1);
    h.referee.push({ ...REF, kind: 'fight', targets: ['garrick'] });
    await s.submit('I attack Garrick.');
    expect(s.combat?.awaiting).toBe('action');
    const fighters = () => s.scene.combat!.fighters;
    expect(fighters().garrick!.power).toBeDefined();
    h.referee.push({ ...REF, kind: 'ability', ability: 'own', improvise: { path: null, tier: 3, effect: 'steal' }, targets: ['garrick'] });
    await s.submit('I tear his power out of him.');
    const hero = Object.values(fighters()).find((f) => f.isProtagonist)!;
    expect(fighters().garrick!.power).toBeUndefined();
    expect(hero.abilities).toContain('borrowed:g1');
    expect(hero.own!['borrowed:g1']).toMatchObject({ name: 'Forge Hands', tier: 2, combat: { type: 'damage', value: 4 } });
    // A rank of 2 at most, his: held at 2 whatever the reach of the theft.
    expect(s.story.protagonist.sheet.arts![0]!.power.rank).toBe(2);
    if (s.combat?.awaiting === 'action') {
      await s.combatAct({ type: 'ability', ability: 'borrowed:g1', target: 'garrick' });
      expect(s.lastTurn!.engineNote).toContain('Forge Hands');
    }
  });
});

describe('a power taken by a thief', () => {
  /** A story in a world of gifts, the rubber body on the sheet, facing Tam (Light Fingers: he steals, and holds what he takes). */
  const facingTam = async (style: 'story' | 'adventure' = 'story') => {
    const h = await builtHarness({ table: { powers: 'gift' }, settings: { style } });
    const s = h.session;
    s.story.settings.style = style;
    s.story.protagonist.sheet.gift = rubber();
    const tam = s.story.world.people.tam!;
    expect(tam.power).toMatchObject({ name: 'Light Fingers', fight: 'steal', keeps: 'held' });
    tam.placeId = 'market_square';
    tam.attitude = 'Hostile';
    await s.travel('market_square');
    return h;
  };
  /** Lose a fight to Tam: he is made strong, the protagonist weak, and they defend until they are down. */
  const loseTo = async (h: Awaited<ReturnType<typeof facingTam>>) => {
    const s = h.session;
    const tam = s.story.world.people.tam!;
    tam.fight!.strength = 9;
    tam.fight!.hp = 40;
    s.story.protagonist.sheet.hp = 1;
    rolls(s.story, 3);
    h.referee.push({ ...REF, kind: 'fight', targets: ['tam'] });
    await s.submit('I attack Tam.');
    for (let i = 0; i < 12 && s.combat?.awaiting === 'action'; i++) await s.combatAct({ type: 'defend' });
    expect(s.combat?.awaiting).toBe('down');
    await s.chooseDown('test');
  };

  it('beaten by him, the protagonist loses their power to him: a thread opens to take it back, and no other power by nature can be had meanwhile', async () => {
    const h = await facingTam();
    const s = h.session;
    const me = () => s.story.protagonist;
    await loseTo(h);
    expect(me().sheet.gift).toBeUndefined();
    expect(me().lost).toEqual([{ power: rubber(), nature: true, by: 'tam', keeps: 'held', thread: expect.any(String) }]);
    const thread = s.story.threads.find((t) => t.id === me().lost![0]!.thread)!;
    expect(thread).toMatchObject({ title: 'Take back Rubber Body from Tam Reddy', kind: 'personal', status: 'open' });
    expect(s.lastTurn!.engineNote).toContain('Tam Reddy takes their power, Rubber Body, for their own');
    expect(s.story.events.some((e) => e.text === 'Tam Reddy took your power, Rubber Body.')).toBe(true);
    // Meanwhile: no fruit, and no awakening of another power by nature.
    expect(hasNatureHeld(s.story)).toBe(true);
    s.story.world.settled = ['the_ledger'];
    takeRelic(s.story, 'ember_fruit');
    expect(canEat(s.story, 'ember_fruit')).toBe('has_power');
    me().xp = 10;
    expect(s.awaken({ name: 'Glass Hands', text: 'Whatever I hold turns to glass.', limit: '', kinds: [] })).toBe(false);
  });

  it('it comes back, whole, when he is beaten in a fight the protagonist wins, and the thread is done', async () => {
    const h = await facingTam();
    const s = h.session;
    const me = () => s.story.protagonist;
    await loseTo(h);
    const thread = me().lost![0]!.thread!;
    // Later: he is found again, and beaten.
    const tam = s.story.world.people.tam!;
    tam.fight!.strength = 0;
    tam.fight!.hp = 1;
    me().sheet.hp = 10;
    rolls(s.story, 1);
    h.referee.push({ ...REF, kind: 'fight', targets: ['tam'] });
    await s.submit('I attack Tam again.');
    for (let i = 0; i < 6 && s.combat?.awaiting === 'action'; i++) await s.combatAct({ type: 'attack', target: 'tam' });
    expect(tam.away?.how).toBe('left');
    expect(me().sheet.gift).toEqual(rubber());
    expect(me().lost).toBeUndefined();
    expect(s.story.threads.find((t) => t.id === thread)).toMatchObject({ status: 'done' });
    expect(s.lastTurn!.engineNote).toContain('Rubber Body, the power Tam took from Robin, comes back to Robin');
  });

  it('it comes back when he dies, wherever that happens; a rewind takes the theft back', async () => {
    const h = await facingTam();
    const s = h.session;
    const me = () => s.story.protagonist;
    const before = structuredClone(me().sheet);
    await loseTo(h);
    expect(await s.rewindTo(s.lastTurn!.n - 1)).toBe(true);
    // (Rewound to before the losing blow: the power is theirs again, and Tam took nothing.)
    expect(me().sheet.gift).toEqual(before.gift);
    expect(me().lost).toBeUndefined();
    const g = await facingTam();
    await loseTo(g);
    const story = g.session.story;
    expect(sendAway(story, story.world.people.tam!, 'dead', 'knifed in a tavern brawl')).toHaveLength(1);
    expect(story.protagonist.sheet.gift).toEqual(rubber());
    expect(story.protagonist.lost).toBeUndefined();
  });

  it('a thief who erases destroys it for good, but in the Story style nothing is lost for good: there it is held', async () => {
    const h = await facingTam('adventure');
    h.session.story.world.people.tam!.power!.keeps = 'erased';
    const story = h.session.story;
    const taken = robPower(story, story.world.people.tam!);
    expect(taken).toMatchObject({ erased: true, power: { name: 'Rubber Body' } });
    expect(story.protagonist.sheet.gift).toBeUndefined();
    expect(story.protagonist.lost).toBeUndefined();
    // Nothing of theirs by nature is held, so another may come: awakened, or eaten.
    expect(hasNatureHeld(story)).toBe(false);
    const g = await facingTam('story');
    g.session.story.world.people.tam!.power!.keeps = 'erased';
    expect(robPower(g.session.story, g.session.story.world.people.tam!)).toMatchObject({ erased: false });
    expect(g.session.story.protagonist.lost).toHaveLength(1);
  });

  it('with no power by nature, the highest-ranked discipline is taken; an item’s power and a borrowed one never are', () => {
    expect(powerToTake({ gift: rubber() })!.id).toBe('own');
    const arts: Art[] = [
      { id: 'dial', source: 'item', from: 'dial', power: rubber({ name: 'Dial', rank: 2 }) },
      { ...armament(), id: 'low' },
      { ...armament({ rank: 3 }), id: 'high' },
      { id: 'borrowed', source: 'borrowed', from: 'kaito', power: rubber({ rank: 4 }) },
    ];
    expect(powerToTake({ arts })!.id).toBe('high');
    expect(powerToTake({ arts: [arts[0]!, arts[3]!] })).toBeUndefined();
  });
});
