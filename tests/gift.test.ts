// The Gift mode: one power of a character's own. Its rules in the engine, making a character with
// one, and playing it.
import { describe, expect, it } from 'vitest';
import {
  GIFT_AT_START, GIFT_IN_PLAY, GIFT_RANK_MAX, PLAIN_ANCESTRY, XP_PER_LEVEL, abilityCost, blankDraft, canImprovise, canKeep, canRaiseGift, canUseAbility,
  check, cleanGift, commandOf, fightEffect, forgetMove, keepMove, libraryOf, moveRoom, powerOf, raiseGift, repair, sheetOf, traitsFor,
  fixedDice, makeRng, winChance,
  type CharacterDraft, type Combat, type CreationRules, type Gift, type NewCombatant, type Sheet, type Worked,
} from '../src/engine';
import { buildPacket, personCard, powerLine, protagonistCard } from '../src/game/cards';
import { proposalFrom, startSeed } from '../src/game/creation';
import { BUILD_STEPS, characterRequest, stepRequest, type BuildInput, type CharacterOut } from '../src/game/llm/architect';
import { mockArchitect } from '../src/game/llm/mockArchitect';
import type { LlmRequest } from '../src/game/llm/transport';
import { upgrade } from '../src/game/save';
import { newStory } from '../src/game/story';
import type { Story } from '../src/game/types';
import { POWER_TIER, checkWorld, creationRules, fightStats, personPower, powerEffect } from '../src/game/world';
import { BALANCED, builtHarness, demoTemplate, harness } from './helpers';

const RULES: CreationRules = { level: 'champion', powers: 'gift', pathCap: 0, ancestries: [{ ...PLAIN_ANCESTRY }] };

/** A rubber body: the power of the plan's example, as it could stand on a sheet in play. */
const rubber = (over: Partial<Gift> = {}): Gift => ({
  name: 'Rubber Body', text: 'A body of rubber: it stretches, bounces and shrugs off blunt blows.', limit: 'Cannot swim; blades cut as usual.',
  rank: 2, kinds: ['damage', 'guard'],
  moves: [
    { id: 'g1', name: 'Long Punch', tier: 1, text: 'A fist thrown from across the room.', fight: 'damage' },
    { id: 'g2', name: 'Balloon', tier: 2, text: 'Swell up and let blows bounce off.', fight: 'guard' },
  ],
  ...over,
});
const sheet = (over: Partial<Sheet> = {}): Sheet => ({
  strength: 2, skill: 3, resistance: 2, armor: 1, firepower: 0, hp: 10, energy: 10, paths: {}, skills: [], advantages: [], disadvantages: [], abilities: [],
  gift: rubber(), ...over,
});
const draft = (over: Partial<CharacterDraft> = {}): CharacterDraft => ({
  name: 'Mako', line: 'a deckhand who ate the wrong fruit', ancestry: 'plain',
  attributes: { strength: 2, skill: 3, resistance: 2, armor: 1, firepower: 0 },
  paths: {}, skills: [], advantages: [], disadvantages: [], abilities: [], gift: rubber(), ...over,
});
const texts = (d: CharacterDraft, rules = RULES) => check(d, rules).problems.map((p) => p.text);

describe('the rules of a gift', () => {
  it('every number of a fight effect comes from one table, by tier', () => {
    expect([1, 2, 3, 4].map((tier) => fightEffect('damage', tier))).toEqual([2, 4, 6, 8].map((value) => ({ type: 'damage', value, needsTarget: true })));
    expect([1, 2, 3, 4].map((tier) => fightEffect('heal', tier)!.type === 'heal' && (fightEffect('heal', tier) as { value: number }).value)).toEqual([3, 5, 8, 10]);
    expect([1, 2, 3, 4].map((tier) => (fightEffect('guard', tier) as { value: number }).value)).toEqual([2, 3, 4, 6]);
    expect([1, 2, 3, 4].map((tier) => (fightEffect('dazzle', tier) as { value: number }).value)).toEqual([2, 3, 4, 5]);
    // Making someone lose their action takes tier 2.
    expect(fightEffect('stagger', 1)).toBeUndefined();
    expect(fightEffect('stagger', 2)).toEqual({ type: 'stagger', needsTarget: true });
    // Only what is aimed at someone needs a target.
    expect(fightEffect('guard', 1)!.needsTarget).toBe(false);
    expect(fightEffect('heal', 1)!.needsTarget).toBe(false);
    expect(fightEffect('dazzle', 1)!.needsTarget).toBe(true);
    // A tier out of range is read as the nearest one.
    expect(fightEffect('damage', 99)).toEqual(fightEffect('damage', 4));
    expect(fightEffect('damage', 0)).toEqual(fightEffect('damage', 1));
  });

  it('a move is used like an ability: energy equal to its tier, and the player’s own words', () => {
    const s = sheet();
    const moves = commandOf(s, 'gift');
    expect(moves.map((m) => [m.id, m.tier, m.cost, m.own])).toEqual([['g1', 1, 1, true], ['g2', 2, 2, true]]);
    expect(moves[0]!.combat).toEqual({ type: 'damage', value: 2, needsTarget: true });
    expect(moves[1]!.combat).toEqual({ type: 'guard', value: 3, needsTarget: false });
    expect(abilityCost(moves[1]!, 'gift')).toBe(2);
    expect(canUseAbility(s, 'g2', 'gift')).toMatchObject({ ok: true, cost: 2 });
    expect(canUseAbility(sheet({ energy: 1 }), 'g2', 'gift')).toEqual({ ok: false, reason: 'energy' });
    expect(canUseAbility(s, 'g9', 'gift')).toEqual({ ok: false, reason: 'unknown' });
    expect(canUseAbility(sheet({ gift: undefined }), 'g1', 'gift')).toEqual({ ok: false, reason: 'no_gift' });
    // A move above the rank (a sheet edited by hand) is not used.
    expect(canUseAbility(sheet({ gift: rubber({ rank: 1 }) }), 'g2', 'gift')).toEqual({ ok: false, reason: 'rank' });
  });

  it('a world of gifts has no library, and no other world has gifts', () => {
    const s = sheet({ abilities: ['spark'], paths: { fire: 2 } });
    expect(libraryOf(s, 'gift')).toEqual([]);
    expect(canUseAbility(s, 'spark', 'gift')).toEqual({ ok: false, reason: 'unknown' });
    expect(powerOf(s, 'spark', 'gift')).toBeUndefined();
    expect(powerOf(s, 'g1', 'gift')?.name).toBe('Long Punch');
    // Elsewhere the moves are not there to be used, whatever the sheet holds.
    expect(commandOf(s, 'focus').map((a) => a.id)).toEqual(['spark']);
    expect(commandOf(s, 'off')).toEqual([]);
    expect(powerOf(s, 'g1', 'focus')).toBeUndefined();
    expect(traitsFor('advantage', 'gift').some((t) => t.only)).toBe(false); // no schools to buy
  });

  it('a new use reaches no further than the rank, costs one more than a move, and is a medium test', () => {
    const s = sheet();
    expect(canImprovise(s, null, 1, 'gift')).toEqual({ ok: true, cost: 2, difficulty: 'medium' });
    expect(canImprovise(s, null, 2, 'gift')).toEqual({ ok: true, cost: 3, difficulty: 'medium' });
    expect(canImprovise(s, null, 3, 'gift')).toEqual({ ok: false, reason: 'rank' });
    expect(canImprovise(sheet({ energy: 2 }), null, 2, 'gift')).toEqual({ ok: false, reason: 'energy' });
    expect(canImprovise(sheet({ gift: undefined }), null, 1, 'gift')).toEqual({ ok: false, reason: 'no_gift' });
    // A path means nothing here; and a world of paths still needs one.
    expect(canImprovise(s, 'fire', 1, 'gift')).toEqual({ ok: true, cost: 2, difficulty: 'medium' });
    expect(canImprovise(sheet({ paths: { fire: 2 } }), null, 1, 'focus')).toEqual({ ok: false, reason: 'not_learned' });
  });

  it('the rank is raised with experience, to 4 and no further', () => {
    const s = sheet();
    expect(canRaiseGift(s, XP_PER_LEVEL)).toBeNull();
    expect(canRaiseGift(s, XP_PER_LEVEL - 1)).toBe('xp');
    expect(canRaiseGift(sheet({ gift: undefined }), 99)).toBe('none');
    expect(raiseGift(s).gift!.rank).toBe(3);
    expect(s.gift!.rank).toBe(2); // a new sheet, not a changed one
    expect(canRaiseGift(sheet({ gift: rubber({ rank: GIFT_RANK_MAX }) }), 99)).toBe('max');
  });

  it('a use that worked is kept as a move: the name and line are the player’s, the tier and kind as rated', () => {
    const s = sheet();
    const worked: Worked = { text: 'I wrap my arm three times round the mast and swing across.', tier: 2, fight: 'damage' };
    expect(canKeep(s, worked, 'Sling', 2, 1, 1)).toBeNull();
    expect(canKeep(s, worked, '  ', 2, 1, 1)).toBe('name');
    expect(canKeep(s, worked, 'Sling', 2, 0, 1)).toBe('xp');
    expect(canKeep(s, worked, 'Sling', 3, 1, 1)).toBe('tier'); // never above what was rated
    expect(canKeep(sheet({ gift: undefined }), worked, 'Sling', 2, 1, 1)).toBe('no_gift');
    const kept = keepMove(s.gift!, worked, 'Sling', '', 2);
    expect(kept.moves.at(-1)).toEqual({ id: 'g3', name: 'Sling', tier: 2, text: worked.text, fight: 'damage' });
    // The tier may be lowered, and the line rewritten.
    expect(keepMove(s.gift!, worked, 'Sling', 'A swing on a stretched arm.', 1).moves.at(-1)).toMatchObject({ tier: 1, text: 'A swing on a stretched arm.' });
    // A kind the power does not have does nothing in a fight; nor does a stagger kept at tier 1.
    expect(keepMove(s.gift!, { ...worked, fight: 'heal' }, 'Patch', '', 2).moves.at(-1)!.fight).toBeUndefined();
    expect(keepMove(rubber({ kinds: ['stagger'] }), { ...worked, fight: 'stagger' }, 'Trip', '', 1).moves.at(-1)!.fight).toBeUndefined();
    // Two moves for each rank, and then one must go.
    const full = sheet({ gift: rubber({ moves: [1, 2, 3, 4].map((n) => ({ id: `g${n}`, name: `Move ${n}`, tier: 1, text: '' })) }) });
    expect(moveRoom(2)).toBe(4);
    expect(canKeep(full, worked, 'Sling', 2, 1, 1)).toBe('full');
    const fewer = forgetMove(full.gift!, 'g2');
    expect(fewer.moves.map((m) => m.id)).toEqual(['g1', 'g3', 'g4']);
    expect(keepMove(fewer, worked, 'Sling', '', 2).moves.at(-1)!.id).toBe('g2'); // the free id is given again
  });
});

describe('making a gift legal', () => {
  it('leaves a legal gift as it is', () => {
    expect(cleanGift(rubber(), GIFT_IN_PLAY)).toEqual(rubber());
    expect(cleanGift(rubber(), GIFT_AT_START)).toEqual(rubber());
  });

  it('there is no gift in nothing, in a rank of 0, or in a power with no words', () => {
    expect(cleanGift(null)).toBeNull();
    expect(cleanGift('rubber')).toBeNull();
    expect(cleanGift({ ...rubber(), rank: 0 })).toBeNull();
    expect(cleanGift({ rank: 2, moves: [] })).toBeNull();
  });

  it('cuts texts to length, brings numbers into range, holds the kinds to two, and gives ids', () => {
    const wild = {
      name: 'x'.repeat(90), text: `  a   power \n of many   words ${'y'.repeat(300)}`, limit: 7, rank: 9, kinds: ['damage', 'nonsense', 'damage', 'heal', 'guard'],
      moves: [
        { name: 'Blast', tier: 9, text: 'z'.repeat(400), fight: 'damage' },
        { name: '', tier: 1, text: 'no name: dropped' },
        { name: 'Mend', tier: 1, fight: 'heal' },
        { name: 'Wall', tier: 2, fight: 'guard' }, // a third kind: the move stays, without it
        { id: 'spark', name: 'Flash', tier: 0, fight: 'dazzle' },
        'not a move',
      ],
    };
    const g = cleanGift(wild, GIFT_IN_PLAY)!;
    expect(g.name).toHaveLength(40);
    expect(g.text.startsWith('a power of many words')).toBe(true);
    expect(g.text.length).toBeLessThanOrEqual(160);
    expect(g.limit).toBe('');
    expect(g.rank).toBe(GIFT_RANK_MAX);
    expect(g.kinds).toEqual(['damage', 'heal']);
    expect(g.moves.map((m) => [m.id, m.name, m.tier, m.fight])).toEqual([['g1', 'Blast', 4, 'damage'], ['g2', 'Mend', 1, 'heal'], ['g3', 'Wall', 2, undefined], ['g4', 'Flash', 1, undefined]]);
    expect(g.moves[0]!.text.length).toBeLessThanOrEqual(140);
    // The kinds can also be read off the moves when none are named.
    expect(cleanGift({ ...rubber(), kinds: undefined })!.kinds).toEqual(['damage', 'guard']);
  });

  it('at the start of a story: rank 3 at most, a move for each rank, none above tier 2', () => {
    const g = cleanGift({ ...rubber(), rank: 4, moves: [1, 2, 3, 4, 5].map((n) => ({ name: `Move ${n}`, tier: n, fight: 'damage' })) }, GIFT_AT_START)!;
    expect(g.rank).toBe(3);
    expect(g.moves.map((m) => m.tier)).toEqual([1, 2, 2]);
    // In play there is room for two a rank, and a move may be as high as the rank.
    const later = cleanGift({ ...rubber(), rank: 4, moves: [1, 2, 3, 4, 5].map((n) => ({ name: `Move ${n}`, tier: n })) }, GIFT_IN_PLAY)!;
    expect(later.moves.map((m) => m.tier)).toEqual([1, 2, 3, 4, 4]);
  });

  it('a stagger below tier 2 is raised to it where the rank allows, and otherwise does nothing in a fight', () => {
    const trip = { name: 'Trip', tier: 1, fight: 'stagger' };
    expect(cleanGift({ ...rubber(), kinds: ['stagger'], moves: [trip] })!.moves[0]).toMatchObject({ tier: 2, fight: 'stagger' });
    const low = cleanGift({ ...rubber(), rank: 1, kinds: ['stagger'], moves: [trip] })!.moves[0]!;
    expect(low.tier).toBe(1);
    expect(low.fight).toBeUndefined();
  });
});

describe('a character with a gift', () => {
  it('the rank costs a point a level, and the gift goes onto the sheet', () => {
    const c = check(draft(), RULES);
    expect(c.problems).toEqual([]);
    expect(c.parts.gift).toBe(2);
    expect(c.spent).toBe(8 + 2);
    expect(c.left).toBe(0);
    expect(sheetOf(draft(), RULES).gift).toEqual(rubber());
    // Someone in such a world may have no power at all.
    const plain = check(draft({ gift: null }), RULES);
    expect(plain.ok).toBe(true);
    expect(plain.parts.gift).toBe(0);
    expect(sheetOf(draft({ gift: null }), RULES).gift).toBeUndefined();
    expect(blankDraft(RULES).gift).toBeUndefined();
  });

  it('says what is wrong with a gift, in words the player can act on', () => {
    expect(texts(draft({ gift: rubber({ name: ' ' }) }))).toContain('Give your power a name.');
    expect(texts(draft({ gift: rubber({ text: '' }) }))).toContain('Say what your power is.');
    expect(texts(draft({ gift: rubber({ rank: 4, moves: [] }) }))[0]).toMatch(/too many/);
    expect(texts(draft({ gift: rubber({ rank: 4, moves: [] }) }))).toContain('The rank of your power must be from 1 to 3 at the start.');
    expect(texts(draft({ gift: rubber({ kinds: ['damage', 'guard', 'heal'] }) }))).toContain('A power can do at most 2 kinds of thing in a fight.');
    const three = rubber({ moves: [...rubber().moves, { id: 'g3', name: 'Whip', tier: 1, text: '' }] });
    expect(texts(draft({ gift: three }))).toContain('You can start with 2 moves, one for each rank; 3 are written.');
    expect(texts(draft({ attributes: { strength: 1, skill: 3, resistance: 2, armor: 1, firepower: 0 }, gift: rubber({ rank: 3, moves: [{ id: 'g1', name: 'Gatling', tier: 3, text: '' }] }) })))
      .toContain('Gatling cannot start above tier 2: higher moves are worked out in the story.');
    expect(texts(draft({ gift: rubber({ moves: [{ id: 'g1', name: 'Gatling', tier: 3, text: '' }] }) }))).toContain('Gatling is tier 3; your power is rank 2.');
    expect(texts(draft({ gift: rubber({ moves: [{ id: 'g1', name: 'Patch', tier: 1, text: '', fight: 'heal' }] }) }))).toContain('Patch does something in a fight that is not among the kinds of your power.');
    expect(texts(draft({ gift: rubber({ kinds: ['stagger'], moves: [{ id: 'g1', name: 'Trip', tier: 1, text: '', fight: 'stagger' }] }) }))).toContain('Trip: making someone lose their action takes tier 2.');
    expect(texts(draft({ gift: rubber({ moves: [{ id: 'g1', name: ' ', tier: 1, text: '' }] }) }))).toContain('Give each move a name.');
  });

  it('paths and library abilities have no place in a world of gifts, and a gift none anywhere else', () => {
    expect(texts(draft({ gift: null, paths: { fire: 1 } }))).toContain('In this world a power is one of your own: paths stay at 0.');
    expect(texts(draft({ gift: null, abilities: ['spark'] }))).toContain('A character with no levels in a path starts with no abilities.');
    const focus: CreationRules = { ...RULES, powers: 'focus', pathCap: 3 };
    expect(texts(draft(), focus)).toContain('This world has no powers of one’s own.');
    expect(sheetOf(draft(), focus).gift).toBeUndefined();
  });

  it('a proposed gift is repaired to what a story may start with, and the changes are said', () => {
    const proposed = draft({
      paths: { fire: 2 },
      gift: { ...rubber(), rank: 4, moves: [1, 2, 3, 4].map((n) => ({ id: '', name: `Move ${n}`, tier: 3, text: '', fight: 'damage' as const })) },
    });
    const { draft: d, changes } = repair(proposed, RULES);
    expect(d.paths).toEqual({});
    expect(d.gift!.rank).toBeLessThanOrEqual(3);
    expect(d.gift!.moves.length).toBeLessThanOrEqual(d.gift!.rank);
    expect(d.gift!.moves.every((m) => m.tier <= 2 && /^g\d+$/.test(m.id))).toBe(true);
    expect(changes.join(' ')).toMatch(/Fire was removed/);
    expect(changes.join(' ')).toMatch(/rank of your power was lowered/);
    expect(changes.join(' ')).toMatch(/Moves beyond what a power of that rank starts with/);
    expect(changes.join(' ')).toMatch(/lowered to the tier a story can start with/);
    expect(check(d, RULES).ok).toBe(true);
  });

  it('too dear a character keeps the power and loses rank before attributes, down to rank 1', () => {
    const dear = draft({ attributes: { strength: 5, skill: 5, resistance: 5, armor: 0, firepower: 0 }, gift: rubber({ rank: 3 }) });
    const { draft: d, changes } = repair(dear, RULES);
    expect(check(d, RULES).ok).toBe(true);
    expect(d.gift!.rank).toBe(1);
    expect(d.gift!.moves).toHaveLength(1);
    expect(changes).toContain('The rank of your power was lowered to fit the points.');
  });

  it('a gift proposed for a world without them is taken away, and a nameless one is given a name', () => {
    const focus: CreationRules = { ...RULES, powers: 'focus', pathCap: 3 };
    const there = repair(draft(), focus);
    expect(there.draft.gift).toBeNull();
    expect(there.changes.join(' ')).toMatch(/power of your own was removed/);
    const nameless = repair(draft({ gift: rubber({ name: '' }) }), RULES);
    expect(nameless.draft.gift!.name).toBe('Unnamed power');
    expect(check(nameless.draft, RULES).ok).toBe(true);
    // Nothing usable: no gift, and the rest of the character stands.
    const none = repair(draft({ gift: { rank: 2 } as unknown as Gift }), RULES);
    expect(none.draft.gift).toBeNull();
    expect(check(none.draft, RULES).ok).toBe(true);
  });
});

const asText = (req: LlmRequest): string => req.params.messages.map((m) => (typeof m.content === 'string' ? m.content : m.content.map((b) => (b.type === 'text' ? b.text : '')).join(''))).join('\n');

describe('a gift proposed from the premise', () => {
  const input = { source: { kind: 'description' as const, text: '' }, premise: 'ate a fruit that made my body rubber', name: 'Mako', table: { style: 'adventure' as const, powers: 'gift' as const, companions: 0, romance: false, violence: 'moderate' as const, leaveOut: '', language: 'en' as const, narration: 'medium' as const } };

  it('the request asks for the power in a world of gifts, and only there', async () => {
    const template = await demoTemplate({ powers: 'gift' });
    const rules = creationRules(template.world);
    expect(rules).toMatchObject({ powers: 'gift', pathCap: 0 });
    const asked = asText(characterRequest(template.world, input, rules.level, BALANCED));
    expect(asked).toContain('Powers here are personal.');
    expect(asked).toContain('a rank from 1 to 3 that costs 1 point a level');
    expect(asked).toContain('a hardened body is armor');
    expect(asked).not.toContain('Elemental School'); // no schools to buy here
    expect(asked).not.toContain('- Abilities:');
    const focus = await demoTemplate();
    expect(asText(characterRequest(focus.world, input, 'champion', BALANCED))).not.toContain('Powers here are personal');
  });

  it('the demo builder’s proposal is a legal character with a power, and a story starts with it on the sheet', async () => {
    const template = await demoTemplate({ powers: 'gift' });
    const rules = creationRules(template.world);
    const answer = mockArchitect({ step: 'character', input, done: {}, world: template.world }) as CharacterOut;
    const p = proposalFrom(answer, rules, 'Mako');
    expect(p.changes).toEqual([]);
    expect(p.draft.gift).toMatchObject({ name: 'Stone Skin', rank: 2, kinds: ['guard', 'damage'] });
    expect(p.draft.gift!.moves.map((m) => [m.id, m.name, m.tier, m.fight])).toEqual([['g1', 'Brace', 1, 'guard'], ['g2', 'Hammer Fist', 2, 'damage']]);
    expect(p.reasons!.paths).toMatch(/power of your own/);
    const c = check(p.draft, rules);
    expect(c.problems).toEqual([]);
    expect(c.left).toBe(0);
    expect(c.parts.gift).toBe(2);
    const story = newStory(startSeed(template, p, { id: 'gifted', seed: 3 }), 0);
    expect(story.protagonist.sheet.gift).toEqual(p.draft.gift);
    expect(story.protagonist.sheet.paths).toEqual({});
    expect(commandOf(story.protagonist.sheet, 'gift').map((m) => m.name)).toEqual(['Brace', 'Hammer Fist']);
  });

  it('whatever comes back, what the player sees is allowed: a wild power is cut down, none is no power', async () => {
    const template = await demoTemplate({ powers: 'gift' });
    const rules = creationRules(template.world);
    const base = mockArchitect({ step: 'character', input, done: {}, world: template.world }) as CharacterOut;
    const wild = { ...base, paths: [{ path: 'fire', level: 4 }], abilities: ['wildfire'], gift: {
      name: 'Everything', text: 'x'.repeat(500), limit: 'none', rank: 9, kinds: ['damage', 'heal', 'stagger', 'guard'],
      moves: [{ name: 'Nova', text: 'Burn the city.', tier: 4, fight: 'damage' }, { name: 'Rise', text: '', tier: 3, fight: 'heal' }, { name: 'Freeze', text: '', tier: 1, fight: 'stagger' }, { name: 'Wall', text: '', tier: 1, fight: 'guard' }, { name: 'More', text: '', tier: 1, fight: 'none' }],
    } } as unknown as CharacterOut;
    const p = proposalFrom(wild, rules, 'Mako');
    const g = p.draft.gift!;
    expect(check(p.draft, rules).ok).toBe(true);
    expect(g.rank).toBeLessThanOrEqual(3);
    expect(g.kinds).toEqual(['damage', 'heal']);
    expect(g.moves.length).toBeLessThanOrEqual(g.rank);
    expect(g.moves.every((m) => m.tier <= Math.min(2, g.rank))).toBe(true);
    expect(g.text.length).toBeLessThanOrEqual(160);
    expect(p.draft.paths).toEqual({});
    expect(p.draft.abilities).toEqual([]);
    expect(p.changes.length).toBeGreaterThan(0);
    // No gift in the answer, or nothing usable at all: a legal character without a power.
    expect(proposalFrom({ ...base, gift: null }, rules, 'Mako').draft.gift ?? null).toBeNull();
    const empty = proposalFrom({} as CharacterOut, rules, 'Mako');
    expect(empty.draft.gift ?? null).toBeNull();
    // In a world of paths a proposed gift is dropped, and said to be.
    const focus = await demoTemplate();
    const there = proposalFrom(base, creationRules(focus.world), 'Mako');
    expect(there.draft.gift ?? null).toBeNull();
    expect(there.changes.join(' ')).toMatch(/power of your own was removed/);
  });
});

// ---------- Playing it ----------

const systemOf = (req: LlmRequest): string => (Array.isArray(req.params.system) ? req.params.system.map((b) => b.text).join('\n') : req.params.system ?? '');
/** The player's dice always come up with this face. */
const rolls = (story: Story, face: number) => { story.rng = fixedDice(face); };
const notesOf = (story: Story): string[] => story.scenes.flatMap((sc) => sc.turns).flatMap((t) => t.beats).flatMap((b) => (b.type === 'notes' ? b.notes : [])).flatMap((n) => (n.kind === 'info' || n.kind === 'fight' ? [n.text] : []));
const REF = { check: null, targets: [] as string[], mentions: [], recall: [], move_to: null, held: null, ability: null, improvise: null, minutes: 1, why_impossible: null, ask: null, ask_options: [] };

/** A story in a world of gifts, with the rubber body on the sheet (or with no power at all). */
const gifted = async (gift: Gift | null = rubber()) => {
  const h = await builtHarness({ table: { powers: 'gift' } });
  const me = h.session.story.protagonist;
  if (gift) me.sheet.gift = gift; else delete me.sheet.gift;
  return h;
};
/** The same, standing in front of guards who mean harm. */
const facingGuards = async (gift: Gift | null = rubber()) => {
  const h = await gifted(gift);
  const guards = h.session.story.world.people.company_guards!;
  guards.placeId = 'market_square';
  guards.attitude = 'Hostile';
  await h.session.travel('market_square');
  expect(h.session.scene.cast).toContain('company_guards');
  return h;
};
const heroIn = (s: { scene: { combat?: Combat | null } }) => Object.values(s.scene.combat!.fighters).find((f) => f.isProtagonist)!;

describe('a gift in play, outside a fight', () => {
  it('the world is one of gifts: no paths, and the referee and the narrator are told the power', async () => {
    const h = await gifted();
    const s = h.session;
    expect(s.story.world.rules).toMatchObject({ powers: 'gift', pathCap: 0 });
    expect(checkWorld(s.story.world)).toEqual([]);
    h.referee.push({ ...REF, kind: 'ability', ability: 'g1' });
    await s.submit('I throw a Long Punch at the lamp bracket.');
    const referee = h.requests.find((r) => r.role === 'referee')!;
    expect(asText(referee)).toContain('ABILITIES [g1] Long Punch (1 energy); [g2] Balloon (2 energy)');
    expect(asText(referee)).toContain('GIFT [own] Rubber Body, rank 2 of 4; in a fight: damage, guard. A body of rubber');
    expect(asText(referee)).not.toContain('Cannot swim'); // the limit is the narrator's to play
    expect(asText(referee)).not.toMatch(/PATHS|SCHOOLS|NOT LEARNED/);
    expect(systemOf(referee)).toContain('each on a GIFT line with its id in brackets');
    expect(systemOf(referee)).not.toContain('NOT LEARNED');
    // Another world's referee is told nothing of gifts.
    const other = harness();
    await other.session.submit('I look around.');
    expect(systemOf(other.requests[0]!)).not.toContain('GIFT');
    expect(systemOf(other.requests[0]!)).toContain('NOT LEARNED');
    // The narrator: a line of its own in the packet, and how to treat it in the contract.
    expect(powerLine(s.story)).toBe('POWER Rubber Body, rank 2 of 4. A body of rubber: it stretches, bounces and shrugs off blunt blows. Limit: Cannot swim; blades cut as usual.');
    expect(buildPacket(s.story, s.scene)).toContain('\nPOWER Rubber Body, rank 2 of 4.');
    expect(protagonistCard(s.story)).not.toContain('Abilities');
    const narrator = h.requests.find((r) => r.role === 'narrator')!;
    expect(systemOf(narrator)).toContain('In this world a power is personal.');
    expect(systemOf(other.requests.find((r) => r.role === 'narrator')!)).not.toContain('a power is personal');
    expect(powerLine(other.session.story)).toBeNull();
  });

  it('a move costs its tier and is told in the player’s words within its reach, never as a result', async () => {
    const h = await gifted();
    const s = h.session;
    const me = s.story.protagonist;
    const energy = me.sheet.energy;
    h.referee.push({ ...REF, kind: 'ability', ability: 'g1' });
    await s.submit('I throw a Long Punch at the lamp bracket.');
    expect(me.sheet.energy).toBe(energy - 1);
    const note = s.lastTurn!.engineNote;
    expect(note).toContain('move: Robin uses Long Punch, a move of their own power');
    expect(note).toContain('"A fist thrown from across the room."');
    expect(note).toContain('Its reach is 1 of 4 (a small trick within arm’s length, for moments)');
    expect(note).not.toContain('works as described');
    expect(s.lastTurn!.beats.some((b) => b.type === 'check')).toBe(false);
    expect(notesOf(s.story)).toContain('Long Punch · 1 energy');
    // The referee may still ask for a test when something is at stake: it is rolled as for any action.
    h.referee.push({ ...REF, kind: 'ability', ability: 'g1', check: { attribute: 'skill', skill: 'Athletics', difficulty: 'medium', label: 'snatch the key', opposed_by: null } });
    await s.submit('I throw a Long Punch to snatch the key off the hook.');
    expect(s.lastTurn!.beats.find((b) => b.type === 'check')).toMatchObject({ result: { label: 'snatch the key' } });
    // An ability of some other world's library is nothing here.
    const energyNow = me.sheet.energy;
    h.referee.push({ ...REF, kind: 'ability', ability: 'spark' });
    await s.submit('I make a spark.');
    expect(me.sheet.energy).toBe(energyNow);
    expect(s.lastTurn!.engineNote).not.toMatch(/ability:|move:/);
    // And with no energy for a move, the engine says so and the turn is not played.
    const turns = s.story.totals.turns;
    me.sheet.energy = 0;
    h.referee.push({ ...REF, kind: 'ability', ability: 'g2' });
    await s.submit('I swell into a Balloon.');
    expect(s.notice).toBe('You do not have the energy for Balloon.');
    expect(s.story.totals.turns).toBe(turns);
  });

  it('a new use within the rank is a medium test at one energy more; one that worked is remembered', async () => {
    const h = await gifted();
    const s = h.session;
    const me = s.story.protagonist;
    rolls(s.story, 1);
    const energy = me.sheet.energy;
    h.referee.push({ ...REF, kind: 'ability', improvise: { path: null, tier: 2, effect: 'none' } });
    await s.submit('I stretch my arm across the gap and haul myself over.');
    expect(me.sheet.energy).toBe(energy - 3);
    expect(s.lastTurn!.engineNote).toContain('improvised: Robin uses their own power (Rubber Body) in a way that is new to them');
    expect(s.lastTurn!.engineNote).toContain('Its reach is 2 of 4 (one person or one room, for a scene)');
    expect(s.lastTurn!.beats.find((b) => b.type === 'check')).toMatchObject({ result: { difficulty: 'medium', passed: true, label: 'a new use of Rubber Body' } });
    expect(me.worked).toEqual([{ text: 'I stretch my arm across the gap and haul myself over.', tier: 2 }]);
    expect(notesOf(s.story)).toContain('A new use of your power (reach 2) · 3 energy');
    expect(notesOf(s.story).join(' | ')).toContain('You have worked out a new use of your power. Keep it as a move for 1 experience on the Character screen.');
    // The same words again are not noted twice; a kind the power has is kept with it, one it has not is dropped.
    h.referee.push({ ...REF, kind: 'ability', improvise: { path: null, tier: 2, effect: 'none' } });
    await s.submit('I stretch my arm across the gap and haul myself over.');
    expect(me.worked).toHaveLength(1);
    h.referee.push({ ...REF, kind: 'ability', improvise: { path: null, tier: 1, effect: 'guard' } });
    await s.submit('I let the falling crate bounce off my back.');
    h.referee.push({ ...REF, kind: 'ability', improvise: { path: null, tier: 1, effect: 'heal' } });
    await s.submit('I squeeze the bruise out of my arm.');
    expect(me.worked!.map((w) => [w.tier, w.fight])).toEqual([[2, undefined], [1, 'guard'], [1, undefined]]);
    // Three wait at most: the oldest gives way.
    me.sheet.energy = 10;
    h.referee.push({ ...REF, kind: 'ability', improvise: { path: null, tier: 1, effect: 'damage' } });
    await s.submit('I flick a pebble with a snapped finger.');
    expect(me.worked!.map((w) => w.tier)).toEqual([1, 1, 1]);
    expect(me.worked!.at(-1)).toMatchObject({ fight: 'damage' });
  });

  it('a use that fails is paid for and leaves nothing; one beyond the rank is refused and costs nothing', async () => {
    const h = await gifted();
    const s = h.session;
    const me = s.story.protagonist;
    rolls(s.story, 6);
    const energy = me.sheet.energy;
    h.referee.push({ ...REF, kind: 'ability', improvise: { path: null, tier: 1, effect: 'none' } });
    await s.submit('I stretch a finger through the keyhole.');
    expect(me.sheet.energy).toBe(energy - 2);
    expect(me.worked ?? []).toEqual([]);
    const turns = s.story.totals.turns;
    h.referee.push({ ...REF, kind: 'ability', improvise: { path: null, tier: 3, effect: 'none' } });
    await s.submit('I wrap my arms round the whole warehouse.');
    expect(s.notice).toBe('That is more than your power can do yet.');
    expect(me.sheet.energy).toBe(energy - 2);
    expect(s.story.totals.turns).toBe(turns);
  });

  it('someone with no power of their own has none to use, and the referee is told so', async () => {
    const h = await gifted(null);
    const s = h.session;
    expect(powerLine(s.story)).toBeNull();
    h.referee.push({ ...REF, kind: 'ability', improvise: { path: null, tier: 1, effect: 'none' } });
    await s.submit('I use my power to bend the bars.');
    expect(s.notice).toBe('You have no power of your own.');
    expect(asText(h.requests[0]!)).toContain('GIFT none: this character has no power of their own.');
    expect(asText(h.requests[0]!)).toContain('ABILITIES none');
    // The demo referee says the same without being scripted.
    await s.submit('I use my power to bend the bars.');
    expect(s.notice).toBe('You have no power of your own.');
  });

  it('the demo referee reads a move by its name and a new use of "my power"', async () => {
    const h = await gifted();
    const s = h.session;
    rolls(s.story, 1);
    await s.submit('I swell into a Balloon and roll down the stairs.');
    expect(s.lastTurn!.engineNote).toContain('move: Robin uses Balloon');
    await s.submit('I use my power to reach the far window across the yard.');
    expect(s.lastTurn!.engineNote).toContain('improvised: Robin uses their own power (Rubber Body)');
    expect(s.story.protagonist.worked).toHaveLength(1);
  });

  it('mending oneself with a power restores hit points outside a fight too, in any world with powers', async () => {
    const healer = rubber({ name: 'Second Skin', kinds: ['heal'], moves: [{ id: 'g1', name: 'Knit', tier: 1, text: 'Close a cut with a thought.', fight: 'heal' }] });
    const h = await gifted(healer);
    const s = h.session;
    const me = s.story.protagonist;
    me.sheet.hp -= 5;
    const hp = me.sheet.hp;
    h.referee.push({ ...REF, kind: 'ability', ability: 'g1' });
    await s.submit('I Knit the gash on my forearm.');
    expect(me.sheet.hp).toBe(hp + 3);
    expect(notesOf(s.story)).toContain('Knit · 1 energy · 3 hit points back');
    // Turned on someone else it is the narrator's to tell: their hit points are not kept between fights.
    h.referee.push({ ...REF, kind: 'ability', ability: 'g1', targets: ['bram'] });
    await s.submit('I Knit the cut on the hand of Bram.');
    expect(me.sheet.hp).toBe(hp + 3);
    // An invented mending works the same when it is told as working, and gives back no more than was missing.
    rolls(s.story, 1);
    h.referee.push({ ...REF, kind: 'ability', improvise: { path: null, tier: 1, effect: 'heal' } });
    await s.submit('I use my power to seal the rest of it.');
    expect(me.sheet.hp).toBe(hp + 5);
    // And an ability of the library in a world of paths.
    const f = harness();
    const aren = f.session.story.protagonist;
    aren.sheet.paths.water = 1;
    aren.sheet.abilities.push('mend');
    aren.sheet.hp -= 4;
    const before = aren.sheet.hp;
    f.referee.push({ ...REF, kind: 'ability', ability: 'mend' });
    await f.session.submit('I use Mend on my arm.');
    expect(aren.sheet.hp).toBe(before + 3);
  });
});

describe('a gift growing between turns', () => {
  it('a use that worked is kept as a move for a point of experience, and is then used at will', async () => {
    const h = await gifted();
    const s = h.session;
    const me = () => s.story.protagonist;
    rolls(s.story, 1);
    me().xp = 3;
    h.referee.push({ ...REF, kind: 'ability', improvise: { path: null, tier: 2, effect: 'damage' } });
    await s.submit('I stretch my arm across the yard and knock the lantern off its hook.');
    expect(me().worked).toHaveLength(1);
    // It needs a name, and is never kept above what it was rated.
    expect(s.keepWorked(0, ' ', '', 2)).toBe(false);
    expect(s.keepWorked(0, 'Lantern Snap', '', 3)).toBe(false);
    expect(s.keepWorked(4, 'Lantern Snap', '', 2)).toBe(false);
    expect(s.keepWorked(0, 'Lantern Snap', 'A whip of the arm at something far off.', 2)).toBe(true);
    expect(me().xp).toBe(2);
    expect(me().worked).toEqual([]);
    expect(me().sheet.gift!.moves.at(-1)).toEqual({ id: 'g3', name: 'Lantern Snap', tier: 2, text: 'A whip of the arm at something far off.', fight: 'damage' });
    const energy = me().sheet.energy;
    h.referee.push({ ...REF, kind: 'ability', ability: 'g3' });
    await s.submit('I use Lantern Snap on the shutter.');
    expect(me().sheet.energy).toBe(energy - 2);
    expect(s.lastTurn!.engineNote).toContain('move: Robin uses Lantern Snap');
    expect(s.lastTurn!.beats.some((b) => b.type === 'check')).toBe(false);
    // The referee was given it by its id.
    expect(asText(h.requests.filter((r) => r.role === 'referee').at(-1)!)).toContain('[g3] Lantern Snap (2 energy)');
  });

  it('with no experience nothing is kept; with no room a move must be forgotten first; a use can be let go', async () => {
    const h = await gifted(rubber({ rank: 1, moves: [{ id: 'g1', name: 'Long Punch', tier: 1, text: '' }, { id: 'g2', name: 'Bounce', tier: 1, text: '' }] }));
    const s = h.session;
    const me = () => s.story.protagonist;
    me().worked = [{ text: 'I flatten myself under the door.', tier: 1 }, { text: 'I spring off the wall.', tier: 1 }];
    me().xp = 0;
    expect(s.keepWorked(0, 'Flat', '', 1)).toBe(false); // no experience
    me().xp = 2;
    expect(s.keepWorked(0, 'Flat', '', 1)).toBe(false); // a power of rank 1 holds two moves
    expect(s.forgetMove('g9')).toBe(false);
    expect(s.forgetMove('g2')).toBe(true);
    expect(me().sheet.gift!.moves.map((m) => m.id)).toEqual(['g1']);
    expect(me().xp).toBe(2); // nothing is given back
    expect(s.keepWorked(0, 'Flat', '', 1)).toBe(true);
    expect(me().sheet.gift!.moves.map((m) => [m.id, m.name, m.text])).toEqual([['g1', 'Long Punch', ''], ['g2', 'Flat', 'I flatten myself under the door.']]);
    expect(s.dropWorked(0)).toBe(true);
    expect(me().worked).toEqual([]);
    expect(s.dropWorked(0)).toBe(false);
  });

  it('the rank is raised with experience, and the narrator is told at the next turn, once', async () => {
    const h = await gifted();
    const s = h.session;
    const me = () => s.story.protagonist;
    await s.begin();
    me().xp = 25;
    expect(s.raiseGift()).toBe(true);
    expect(s.raiseGift()).toBe(true);
    expect(s.raiseGift()).toBe(false); // rank 4 is the highest there is
    expect(me().sheet.gift!.rank).toBe(4);
    expect(me().xp).toBe(5);
    expect(s.story.tellNext).toHaveLength(1);
    await s.submit('I look around.');
    expect(s.lastTurn!.engineNote).toContain('power: Robin’s own power has grown since the scene began. POWER Rubber Body, rank 4 of 4.'.replace('’', "'"));
    expect(s.story.tellNext).toBeUndefined();
    await s.submit('I wait.');
    expect(s.lastTurn!.engineNote).not.toContain('power:');
    // What is beyond the old rank is now within reach.
    rolls(s.story, 1);
    h.referee.push({ ...REF, kind: 'ability', improvise: { path: null, tier: 4, effect: 'none' } });
    await s.submit('I stretch from one end of the street to the other.');
    expect(s.notice).toBeNull();
    expect(me().worked!.at(-1)).toMatchObject({ tier: 4 });
  });

  it('someone with no power awakens one: ten experience, their own words held to length, rank 1 and no moves', async () => {
    const h = await gifted(null);
    const s = h.session;
    const me = () => s.story.protagonist;
    await s.begin();
    const written = { name: 'Glass Hands', text: 'Whatever I hold turns clear as glass, and as brittle, until I let go.', limit: 'It hurts to touch living things.', kinds: ['damage', 'dazzle'] as const };
    me().xp = 9;
    expect(s.awaken({ ...written, kinds: [...written.kinds] })).toBe(false); // not enough experience
    me().xp = 12;
    expect(s.awaken({ ...written, name: ' ', kinds: [] })).toBe(false); // it needs a name
    expect(s.awaken({ name: 'x'.repeat(90), text: written.text, limit: 'y'.repeat(300), kinds: ['damage', 'dazzle', 'heal'] })).toBe(true);
    expect(me().xp).toBe(2);
    const gift = me().sheet.gift!;
    expect(gift).toMatchObject({ rank: 1, kinds: ['damage', 'dazzle'], moves: [] });
    expect(gift.name).toHaveLength(40);
    expect(gift.limit).toHaveLength(100);
    expect(s.awaken({ ...written, kinds: [] })).toBe(false); // one power each
    // The scene's packet was written before: the narrator is told now, and the referee knows at once.
    rolls(s.story, 1);
    h.referee.push({ ...REF, kind: 'ability', improvise: { path: null, tier: 1, effect: 'dazzle' } });
    await s.submit('I use my power on the lamp glass until it throws the light in their eyes.');
    expect(s.lastTurn!.engineNote).toContain('has awakened a power of their own since the scene began. POWER ');
    expect(asText(h.requests.filter((r) => r.role === 'referee').at(-1)!)).toMatch(/GIFT \[own\] x+, rank 1 of 4; in a fight: damage, dazzle\./);
    expect(me().worked).toEqual([{ text: 'I use my power on the lamp glass until it throws the light in their eyes.', tier: 1, fight: 'dazzle' }]);
    // In a world without gifts there is nothing to awaken.
    const other = harness();
    other.session.story.protagonist.xp = 50;
    expect(other.session.awaken({ ...written, kinds: [] })).toBe(false);
    expect(other.session.raiseGift()).toBe(false);
  });

  it('a rewind takes back what was done to the power between turns, and the experience comes back', async () => {
    const h = await gifted();
    const s = h.session;
    const me = () => s.story.protagonist;
    await s.begin();
    me().xp = 20;
    me().worked = [{ text: 'I snap back like a sling.', tier: 1, fight: 'damage' }];
    const before = structuredClone({ gift: me().sheet.gift, worked: me().worked, xp: me().xp });
    expect(s.raiseGift()).toBe(true);
    expect(s.keepWorked(0, 'Sling', '', 1)).toBe(true);
    expect(s.forgetMove('g1')).toBe(true);
    expect(s.story.pendingUndo).toHaveLength(3);
    await s.submit('I look around.');
    expect(me().sheet.gift!.moves.map((m) => m.name)).toEqual(['Balloon', 'Sling']);
    expect(await s.rewindTo(1)).toBe(true);
    expect({ gift: me().sheet.gift, worked: me().worked, xp: me().xp }).toEqual(before);
    expect(s.story.tellNext).toBeUndefined();
    // Awakening is taken back the same way.
    const g = await gifted(null);
    await g.session.begin();
    g.session.story.protagonist.xp = 10;
    expect(g.session.awaken({ name: 'Glass Hands', text: 'Whatever I hold turns to glass.', limit: '', kinds: [] })).toBe(true);
    await g.session.submit('I look around.');
    expect(await g.session.rewindTo(1)).toBe(true);
    expect(g.session.story.protagonist.sheet.gift).toBeUndefined();
    expect(g.session.story.protagonist.xp).toBe(10);
  });

  it('nothing about the power is changed in the middle of a fight', async () => {
    const h = await facingGuards();
    const s = h.session;
    rolls(s.story, 1);
    h.referee.push({ ...REF, kind: 'fight', targets: ['company_guards'] });
    await s.submit('I attack the guards.');
    expect(s.combat?.awaiting).toBe('action');
    const me = s.story.protagonist;
    me.xp = 30;
    me.worked = [{ text: 'I snap back like a sling.', tier: 1 }];
    expect(s.raiseGift()).toBe(false);
    expect(s.keepWorked(0, 'Sling', '', 1)).toBe(false);
    expect(s.forgetMove('g1')).toBe(false);
    expect(s.dropWorked(0)).toBe(false);
  });

  it('a power read from a file is held to the rules like one a model proposed, and an old story has none', () => {
    const h = harness();
    const file = structuredClone(h.session.story) as Story;
    expect(upgrade(file).story.protagonist.sheet.gift).toBeUndefined();
    (file.protagonist.sheet as { gift?: unknown }).gift = { name: 'Everything', text: 'x'.repeat(900), limit: '', rank: 40, kinds: ['damage', 'heal', 'guard'], moves: [{ name: 'Nova', tier: 9, fight: 'damage' }] };
    const opened = upgrade(file).story.protagonist.sheet.gift!;
    expect(opened.rank).toBe(4);
    expect(opened.text).toHaveLength(160);
    expect(opened.kinds).toEqual(['damage', 'heal']);
    expect(opened.moves).toEqual([{ id: 'g1', name: 'Nova', tier: 4, text: '', fight: 'damage' }]);
    (file.protagonist.sheet as { gift?: unknown }).gift = 'not a power';
    expect(upgrade(file).story.protagonist.sheet.gift).toBeUndefined();
  });
});

describe('people with a power of their own', () => {
  it('a word from the builder becomes a power with a tier the code sets, only for people who fight', () => {
    // Its rank, which is what it is worth when someone else holds it, comes from how able they are too.
    expect(personPower({ name: 'Forge Hands', text: 'His hands glow like iron.', fight: 'damage' }, 'able')).toEqual({ name: 'Forge Hands', text: 'His hands glow like iron.', fight: 'damage', tier: 1, rank: 2 });
    expect(personPower({ name: 'x'.repeat(90), text: `a   line ${'y'.repeat(300)}`, fight: 'guard', tier: 4 }, 'dangerous')).toMatchObject({ fight: 'guard', tier: POWER_TIER.dangerous });
    expect(personPower({ name: 'x'.repeat(90), text: 'y'.repeat(300), fight: 'guard' }, 'dangerous')!.name).toHaveLength(40);
    expect(personPower({ name: 'x', text: 'y'.repeat(300), fight: 'guard' }, 'dangerous')!.text).toHaveLength(100);
    // Taking an action from someone is beyond a weak fighter: theirs only spoils an attack.
    expect(personPower({ name: 'Cold Hand', text: '', fight: 'stagger' }, 'weak')!.fight).toBe('dazzle');
    expect(personPower({ name: 'Cold Hand', text: '', fight: 'stagger' }, 'able')!.fight).toBe('stagger');
    // No name, nothing it does in a fight, or someone who does not fight: no power is kept.
    expect(personPower({ name: ' ', text: 'something', fight: 'damage' }, 'able')).toBeUndefined();
    expect(personPower({ name: 'Green Thumb', text: 'Plants lean toward her.', fight: 'none' }, 'able')).toBeUndefined();
    expect(personPower({ name: 'Green Thumb', text: '', fight: 'heal' }, 'able')).toBeUndefined();
    expect(personPower({ name: 'Still Voice', text: '', fight: 'stagger' }, 'no')).toBeUndefined();
    expect(personPower(null, 'able')).toBeUndefined();
    // What it does in a fight follows from the tier, by the same table as a move.
    expect(powerEffect({ name: 'Forge Hands', text: '', fight: 'damage', tier: 1 })).toEqual(fightEffect('damage', 1));
    expect(powerEffect({ name: 'Still Voice', text: '', fight: 'stagger', tier: 1 })).toEqual({ type: 'stagger' });
  });

  it('a world of gifts is built with them, a world of paths is not, and the narrator is told on their card', async () => {
    const gifts = await demoTemplate({ powers: 'gift' });
    expect(checkWorld(gifts.world)).toEqual([]);
    expect(gifts.world.people.garrick!.power).toEqual({ name: 'Forge Hands', text: 'His hands glow like iron out of the fire, and burn what they close on.', fight: 'damage', tier: 1, rank: 2 });
    expect(gifts.world.people.dunmore!.power).toMatchObject({ name: 'Set Feet', fight: 'guard', tier: 1, rank: 3 });
    expect(gifts.world.people.sable!.power).toBeUndefined(); // she does not fight
    expect(Object.values(gifts.world.people).filter((p) => p.power).map((p) => p.id).sort()).toEqual(['dunmore', 'garrick', 'osk', 'tam']);
    expect(gifts.world.people.garrick!.teaches).toBeUndefined(); // nobody teaches a path here
    const focus = await demoTemplate();
    expect(Object.values(focus.world.people).some((p) => p.power)).toBe(false);
    const story = newStory(startSeed(gifts, proposalFrom({} as CharacterOut, creationRules(gifts.world), 'Mako'), { id: 'cards', seed: 1 }), 0);
    const card = personCard(story, story.world.people.garrick!);
    expect(card).toContain('Power: Forge Hands (His hands glow like iron out of the fire, and burn what they close on.).');
    expect(card.indexOf('Power: Forge Hands')).toBeLessThan(card.indexOf('Huge forearms')); // before the description: a long one never costs it
    // The builder is asked for them here, and nowhere else.
    const req = (powers: 'gift' | 'focus') => {
      const input: BuildInput = { source: { kind: 'description', text: 'A harbour town.' }, premise: 'a diver', name: '', table: { style: 'adventure', powers, companions: 0, romance: false, violence: 'moderate', leaveOut: '', language: 'en', narration: 'medium' } };
      // The steps before this one, as the demo builder makes them: the request re-reads them.
      const done: Record<string, unknown> = {};
      for (const s of BUILD_STEPS) { if (s.id === 'people') break; done[s.id] = mockArchitect({ step: s.id, input, done }); }
      return stepRequest('people', input, [], done, BALANCED);
    };
    expect(asText(req('gift'))).toContain('Powers here are personal: give a power of their own');
    expect(asText(req('focus'))).not.toContain('Powers here are personal');
  });

  it('what a world may not hold: a power where powers are not personal, a group with one, a kind the game does not know', async () => {
    const gifts = await demoTemplate({ powers: 'gift' });
    const w = structuredClone(gifts.world);
    w.people.company_guards!.power = { name: 'Many Hands', text: '', fight: 'damage', tier: 1 };
    (w.people.garrick!.power as { fight: string }).fight = 'heal';
    w.people.dunmore!.power!.tier = 9;
    expect(checkWorld(w)).toEqual([
      'the power of Sergeant Dunmore has a tier outside 1 to 4',
      'the power of Garrick Stone does nothing the game knows in a fight',
      'Company guards are a group, and a group has no power of its own',
    ].sort((a, b) => checkWorld(w).indexOf(a) - checkWorld(w).indexOf(b)));
    const focus = await demoTemplate();
    const f = structuredClone(focus.world);
    f.people.garrick!.power = { name: 'Forge Hands', text: '', fight: 'damage', tier: 1 };
    expect(checkWorld(f)).toEqual(['Garrick Stone has a power of their own in a world that has none']);
  });

  it('someone met in a place that is filled in later can have one too', async () => {
    const h = await gifted();
    const s = h.session;
    await s.begin();
    await s.travel('stonewater');
    expect(s.blocker).toBeNull();
    const w = s.story.world;
    expect(checkWorld(w)).toEqual([]);
    expect(w.people.stonewater_host!.power).toEqual({ name: 'Long Memory', text: 'Looks at a person and knows what they last lied about.', fight: 'dazzle', tier: 1, rank: 2 });
    expect(w.people.stonewater_keeper!.power).toBeUndefined();
    expect(asText(h.requests.find((r) => r.role === 'architect')!)).toContain('Powers in this world are personal');
    // In a world of paths the same place is filled in with nobody like that.
    const f = await builtHarness();
    await f.session.begin();
    await f.session.travel('stonewater');
    expect(Object.values(f.session.story.world.people).some((p) => p.power)).toBe(false);
    expect(asText(f.requests.find((r) => r.role === 'architect')!)).not.toContain('Powers in this world are personal');
  });

  it('in a fight they use it with their attack on their first turn, and the player and the narrator are told', async () => {
    const h = await gifted();
    const s = h.session;
    const me = s.story.protagonist;
    const garrick = s.story.world.people.garrick!;
    garrick.placeId = 'market_square';
    garrick.attitude = 'Hostile';
    await s.travel('market_square');
    expect(s.scene.cast).toContain('garrick');
    rolls(s.story, 1);
    const hp = me.sheet.hp;
    h.referee.push({ ...REF, kind: 'fight', targets: ['garrick'] });
    await s.submit('I attack Garrick.');
    const c = s.scene.combat!;
    expect(c, 'the fight began').toBeTruthy();
    expect(c.fighters.garrick!.power).toMatchObject({ name: 'Forge Hands', effect: { type: 'damage', value: 2 } });
    expect(c.fighters.garrick!.turns).toBe(1);
    expect(me.sheet.hp).toBeLessThanOrEqual(hp - 2);
    expect(s.lastTurn!.engineNote).toContain('Garrick uses a power of their own, Forge Hands (His hands glow like iron out of the fire, and burn what they close on.): 2 damage to Robin.');
    expect(notesOf(s.story)).toContain('Garrick · Forge Hands · 2 damage to Robin');
    // The odds the fight was tuned by counted it: they are no better than against the same man without it.
    const withIt = s.scene.odds!;
    const g = await gifted();
    const plain = g.session.story.world.people.garrick!;
    plain.placeId = 'market_square';
    plain.attitude = 'Hostile';
    delete plain.power;
    await g.session.travel('market_square');
    rolls(g.session.story, 1);
    g.referee.push({ ...REF, kind: 'fight', targets: ['garrick'] });
    await g.session.submit('I attack Garrick.');
    expect(g.session.lastTurn!.engineNote).not.toContain('a power of their own');
    expect(withIt).toBeLessThanOrEqual(g.session.scene.odds!);
  });

  it('a power is held to what the simulation bears: it shows in a fight without deciding it', () => {
    // Three Champions who use a tier-2 damaging move of their own, against an able and a dangerous opponent.
    const strike = { g1: { id: 'g1', name: 'Strike', tier: 2, cost: 2, text: '', own: true as const, combat: { type: 'damage' as const, value: 4, needsTarget: true } } };
    const heroes: [string, NewCombatant][] = [
      ['the demo hero', { id: 'you', name: 'Hero', side: 'you', isProtagonist: true, strength: 2, skill: 2, armor: 1, hp: 10, energy: 10, abilities: ['g1'], own: strike }],
      ['the sample hero', { id: 'you', name: 'Hero', side: 'you', isProtagonist: true, strength: 1, skill: 3, armor: 1, hp: 15, energy: 15, abilities: ['g1'], own: strike }],
      ['a sturdy hero', { id: 'you', name: 'Hero', side: 'you', isProtagonist: true, strength: 3, skill: 3, armor: 2, hp: 15, energy: 15, abilities: ['g1'], own: strike }],
    ];
    const foe = (level: 'able' | 'dangerous', fight?: 'damage' | 'guard' | 'stagger' | 'dazzle' | 'seal' | 'steal'): NewCombatant => {
      const f = fightStats(level);
      const power = fight ? personPower({ name: 'Theirs', text: '', fight }, level)! : undefined;
      return { id: 'foe', name: 'Foe', side: 'foe', strength: f.strength, skill: f.skill, armor: f.armor, hp: f.hp, ...(power ? { power: { name: power.name, effect: powerEffect(power) } } : {}) };
    };
    for (const level of ['able', 'dangerous'] as const) {
      for (const [who, hero] of heroes) {
        const plain = winChance([hero, foe(level)], makeRng(7), 2500);
        for (const fight of ['damage', 'guard', 'stagger', 'dazzle', 'seal', 'steal'] as const) {
          const odds = winChance([hero, foe(level, fight)], makeRng(7), 2500);
          // A guard blunts the very move this hero keeps using, which a player would not keep doing: it is given more room.
          expect(plain - odds, `${fight} of ${level} against ${who}`).toBeLessThanOrEqual(fight === 'guard' ? 0.27 : 0.16);
          // Taking an action, or the hero's powers, costs them their own blow that turn, so it can favour the hero a little; nothing else does.
          expect(odds - plain, `${fight} of ${level} against ${who}`).toBeLessThanOrEqual(fight === 'stagger' || fight === 'seal' || fight === 'steal' ? 0.1 : 0.02);
        }
      }
    }
  });
});

describe('a gift in a fight', () => {
  it('a damaging move turned on someone who can fight opens the fight, and is the first thing done in it', async () => {
    const h = await facingGuards();
    const s = h.session;
    const me = s.story.protagonist;
    rolls(s.story, 1);
    const energy = me.sheet.energy;
    h.referee.push({ ...REF, kind: 'ability', ability: 'g1', targets: ['company_guards'] });
    await s.submit('I throw a Long Punch at the nearest guard.');
    const c = s.scene.combat!;
    expect(c, 'the fight began').toBeTruthy();
    const guards = c.fighters.company_guards!;
    expect(guards.hp).toBe(guards.hpMax - 2);
    expect(me.sheet.energy).toBe(energy - 1);
    expect(heroIn(s).abilities).toEqual(['g1', 'g2']);
    expect(heroIn(s).own!.g1!.name).toBe('Long Punch');
    expect(s.lastTurn!.engineNote).toContain('uses Long Punch, a move of their own power ("A fist thrown from across the room."): 2 damage to');
    expect(notesOf(s.story)).toContain(`Long Punch · 2 damage to ${guards.name}`);
    // Turned on nobody who can fight, it is a thing done in the story, and no fight.
    const g = await gifted();
    g.referee.push({ ...REF, kind: 'ability', ability: 'g1' });
    await g.session.submit('I throw a Long Punch at the lamp bracket.');
    expect(g.session.scene.combat).toBeFalsy();
  });

  it('a damaging new use turned on someone who can fight opens the fight too, with its test rolled first', async () => {
    const h = await facingGuards();
    const s = h.session;
    const me = s.story.protagonist;
    rolls(s.story, 1);
    const energy = me.sheet.energy;
    h.referee.push({ ...REF, kind: 'ability', improvise: { path: null, tier: 2, effect: 'damage' }, targets: ['company_guards'] });
    await s.submit('I use my power to whip an arm at the sergeant.');
    const c = s.scene.combat!;
    expect(c, 'the fight began').toBeTruthy();
    expect(c.fighters.company_guards!.hp).toBe(c.fighters.company_guards!.hpMax - 4);
    expect(me.sheet.energy).toBe(energy - 3);
    expect(s.lastTurn!.beats.find((b) => b.type === 'check')).toMatchObject({ result: { difficulty: 'medium', passed: true } });
    expect(s.lastTurn!.engineNote).toContain('fight, round');
    expect(me.worked).toHaveLength(1);
    // The same use on nobody who can fight stays a thing done in the story.
    const g = await gifted();
    rolls(g.session.story, 1);
    g.referee.push({ ...REF, kind: 'ability', improvise: { path: null, tier: 2, effect: 'damage' } });
    await g.session.submit('I use my power to slam the cellar door off its hinges.');
    expect(g.session.scene.combat).toBeFalsy();
    expect(g.session.lastTurn!.engineNote).toContain('improvised: Robin uses their own power');
  });

  it('a move is used from the fight controls, and one that cannot be paid for is refused without a narrator', async () => {
    const h = await facingGuards();
    const s = h.session;
    rolls(s.story, 1);
    h.referee.push({ ...REF, kind: 'fight', targets: ['company_guards'] });
    await s.submit('I attack the guards.');
    expect(s.combat?.awaiting).toBe('action');
    const energy = heroIn(s).energy!;
    await s.combatAct({ type: 'ability', ability: 'g2' });
    expect(heroIn(s).energy).toBe(energy - 2);
    expect(notesOf(s.story)).toContain('Balloon · +3 to defence until your next turn');
    heroIn(s).energy = 0;
    const asked = h.requests.length;
    await s.combatAct({ type: 'ability', ability: 'g1', target: 'company_guards' });
    expect(s.notice).toMatch(/energy/i);
    expect(h.requests.length).toBe(asked);
  });

  it('a new use typed in a fight: the energy, a plain Skill roll, and the effect of its reach when it passes', async () => {
    const h = await facingGuards();
    const s = h.session;
    const me = s.story.protagonist;
    rolls(s.story, 1);
    h.referee.push({ ...REF, kind: 'fight', targets: ['company_guards'] });
    await s.submit('I attack the guards.');
    expect(s.combat?.awaiting).toBe('action');
    const guards = () => s.scene.combat!.fighters.company_guards!;
    const hp = guards().hp;
    const energy = heroIn(s).energy!;
    h.referee.push({ ...REF, kind: 'ability', improvise: { path: null, tier: 2, effect: 'damage' }, targets: ['company_guards'] });
    await s.submit('I use my power to whip an arm round and slam two of them together.');
    expect(guards().hp).toBe(hp - 4);
    expect(me.sheet.energy).toBe(energy - 3);
    const check = s.lastTurn!.beats.find((b) => b.type === 'check');
    expect(check).toMatchObject({ result: { difficulty: 'medium', passed: true, label: 'a new use of Rubber Body' } });
    expect(s.lastTurn!.engineNote).toContain('tries a new use of their own power (Rubber Body), as the player described. It works: 4 damage to');
    expect(me.worked).toEqual([{ text: 'I use my power to whip an arm round and slam two of them together.', tier: 2, fight: 'damage' }]);
    // A failed roll: the energy and the turn are spent, and nothing lands. Told as a failure whatever the table style.
    rolls(s.story, 6);
    expect(s.combat?.awaiting).toBe('action');
    const hp2 = guards().hp;
    const energy2 = heroIn(s).energy!;
    h.referee.push({ ...REF, kind: 'ability', improvise: { path: null, tier: 1, effect: 'damage' }, targets: ['company_guards'] });
    await s.submit('I use my power to snap a fist at the sergeant.');
    expect(guards().hp).toBe(hp2);
    expect(me.sheet.energy).toBe(energy2 - 2);
    expect(s.lastTurn!.engineNote).toContain('It does not come off, and the moment is lost.');
    expect(s.lastTurn!.engineNote).not.toMatch(/SUCCESS AT A COST|WAY FORWARD/);
    expect(notesOf(s.story)).toContain('It does not come off: the moment is lost');
    expect(me.worked).toHaveLength(1);
  });

  it('in a fight, what is beyond the rank is refused and costs nothing; what would do nothing there is an ordinary action', async () => {
    const h = await facingGuards();
    const s = h.session;
    rolls(s.story, 1);
    h.referee.push({ ...REF, kind: 'fight', targets: ['company_guards'] });
    await s.submit('I attack the guards.');
    expect(s.combat?.awaiting).toBe('action');
    const round = s.scene.combat!.round;
    const energy = heroIn(s).energy!;
    const asked = h.requests.length;
    const turns = s.story.totals.turns;
    h.referee.push({ ...REF, kind: 'ability', improvise: { path: null, tier: 3, effect: 'damage' }, targets: ['company_guards'] });
    await s.submit('I use my power to flatten the whole square.');
    expect(s.notice).toBe('That is more than your power can do yet.');
    expect(h.requests.slice(asked).map((r) => r.role)).toEqual(['referee']); // no narrator: nothing happened
    expect(s.scene.combat!.round).toBe(round);
    expect(heroIn(s).energy).toBe(energy);
    expect(s.story.totals.turns).toBe(turns);
    // The referee is asked to rate by force while a fight is on.
    expect(asText(h.requests.at(-1)!)).toContain('A FIGHT IS ON. Rate the tier of an invented effect by force');
    // A kind the power does not have, or none: no energy, no test, and the text is read as an ordinary fight action.
    h.referee.push({ ...REF, kind: 'ability', improvise: { path: null, tier: 1, effect: 'heal' } });
    await s.submit('I use my power to shake off the bruises.');
    expect(heroIn(s).energy).toBe(energy);
    expect(s.lastTurn!.beats.some((b) => b.type === 'check')).toBe(false);
    expect(s.lastTurn!.engineNote).toContain('holds back and guards');
  });

  it('an effect of one’s own counts in a fight in a world of paths too, at that world’s cost and difficulty, and is not kept', async () => {
    const h = harness();
    const s = h.session;
    const me = s.story.protagonist;
    rolls(s.story, 1);
    await s.travel('canal_bridge');
    await s.submit('I attack the knifeman.');
    expect(s.combat?.awaiting).toBe('action');
    const foe = Object.values(s.scene.combat!.fighters).find((f) => f.side === 'foe' && f.hp > 0)!;
    const hp = foe.hp;
    const energy = heroIn(s).energy!;
    h.referee.push({ ...REF, kind: 'ability', improvise: { path: 'air', tier: 1, effect: 'damage' }, targets: [foe.id] });
    await s.submit('I shape the air into a fist and drive it into his chest.');
    expect(s.lastTurn!.beats.find((b) => b.type === 'check')).toMatchObject({ result: { difficulty: 'hard', passed: true, label: 'shape air' } });
    // Two points from the effect itself; a companion may have added a blow of their own in the same round.
    expect(s.scene.combat!.fighters[foe.id]!.hp).toBeLessThanOrEqual(hp - 2);
    expect(me.sheet.energy).toBe(energy - 2);
    expect(me.worked).toBeUndefined();
    expect(s.lastTurn!.engineNote).toContain('tries an effect of air of their own making, as the player described. It works: 2 damage to');
    // A path they have no level in: refused, as it is outside a fight, and the round is not spent.
    const asked = h.requests.length;
    h.referee.push({ ...REF, kind: 'ability', improvise: { path: 'fire', tier: 1, effect: 'damage' }, targets: [foe.id] });
    await s.submit('I set his coat alight with a thought.');
    expect(s.notice).toBe('That is more than your fire can do yet.');
    expect(h.requests.slice(asked).map((r) => r.role)).toEqual(['referee']);
  });
});
