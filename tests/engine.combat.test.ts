// Combat: docs/PLAN.md 10.1, 10.5, 10.9.
// Attack  = Strength (or Firepower) + Skill + a die.  A 6 on the die doubles Strength / Firepower.
// Defence = Armor + Skill + a die.                    A 6 on the die doubles Armor.
// Damage  = attack - defence, if positive.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/engine/abilities';
import {
  act, canStagger, condition, conditionLabel, isUp, makeCombatant, resolveAttack, resolveDown, startCombat, winChance,
  type AttackEvent, type Combat, type CombatAction, type CombatEvent, type CombatResult, type Combatant, type NewCombatant,
} from '../src/engine/combat';
import { fixedDice, makeRng, pick, type Rng } from '../src/engine/rng';
import type { TableStyle } from '../src/engine/types';

// ---------- helpers ----------

function hero(over: Partial<NewCombatant> = {}): NewCombatant {
  return { id: 'hero', name: 'Hero', side: 'you', isProtagonist: true, strength: 2, skill: 2, armor: 1, hp: 10, ...over };
}
function ally(over: Partial<NewCombatant> = {}): NewCombatant {
  return { id: 'ally', name: 'Mira', side: 'you', strength: 2, skill: 2, armor: 1, hp: 8, ...over };
}
function bandit(over: Partial<NewCombatant> = {}): NewCombatant {
  return { id: 'foe', name: 'Bandit', side: 'foe', strength: 2, skill: 1, armor: 0, hp: 6, ...over };
}
/** Hits hard enough to drop a hero who has 3 hit points left. */
function brute(over: Partial<NewCombatant> = {}): NewCombatant {
  return bandit({ id: 'brute', name: 'Brute', strength: 4, skill: 2, ...over });
}
function fighter(combat: Combat, id: string): Combatant {
  const f = combat.fighters[id];
  if (!f) throw new Error(`no fighter called ${id}`);
  return f;
}
function attacks(events: CombatEvent[]): AttackEvent[] {
  return events.filter((e): e is AttackEvent => e.type === 'attack');
}
function kinds(events: CombatEvent[]): string[] {
  return events.map((e) => e.type);
}
function nth<T>(list: T[], i: number): T {
  const x = list[i];
  if (x === undefined) throw new Error(`nothing at ${i}`);
  return x;
}
function actors(events: CombatEvent[]): string[] {
  const out: string[] = [];
  for (const e of events) if ('actor' in e) out.push(e.actor);
  return out;
}
/** The given dice, then a 99 that no test should ever reach. */
function dice(...faces: number[]) {
  return fixedDice(...faces, 99);
}
function allUsed(rng: { faces: number[] }): void {
  expect(rng.faces).toEqual([99]);
}
/** One attack that deals exactly `damage`: both dice are 1 and the attacker's Skill makes up the difference. */
function hitFor(target: Combatant, damage: number): AttackEvent {
  const skill = damage + target.armor + target.skill + target.guard;
  const attacker = makeCombatant({ id: 'x', name: 'X', side: 'you', strength: 0, skill, armor: 0, hp: 1 });
  const event = resolveAttack(1, attacker, target, fixedDice(1, 1));
  if (event.damage !== damage) throw new Error(`hitFor meant ${damage} damage and did ${event.damage}`);
  return event;
}
function must(ok: boolean, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

// ---------- one attack ----------

describe('one attack', () => {
  const attacker = (over: Partial<NewCombatant> = {}) => makeCombatant({ id: 'a', name: 'A', side: 'you', strength: 2, skill: 2, armor: 0, hp: 10, ...over });
  const defender = (over: Partial<NewCombatant> = {}) => makeCombatant({ id: 'd', name: 'D', side: 'foe', strength: 0, skill: 1, armor: 1, hp: 10, ...over });

  it('attack = Strength + Skill + die, defence = Armor + Skill + die, damage = the difference', () => {
    const a = attacker();
    const d = defender();
    const e = resolveAttack(3, a, d, fixedDice(4, 2));
    expect(e).toEqual({
      type: 'attack', round: 3, actor: 'a', target: 'd',
      attackDie: 4, defenceDie: 2, power: 2, attackSkill: 2, groupBonus: 0, penalty: 0, attackTotal: 8,
      armor: 1, defenceSkill: 1, guard: 0, defenceTotal: 4, damage: 4,
      critAttack: false, critDefence: false, hpBefore: 10, hpAfter: 6, targetCondition: 'Hurt', membersLost: 0, targetDown: false,
    });
    expect(d.hp).toBe(6);
    expect(a.hp).toBe(10);
  });

  it('rolls the attack die first, then the defence die', () => {
    const rng = fixedDice(5, 2, 1);
    const e = resolveAttack(1, attacker(), defender(), rng);
    expect(e.attackDie).toBe(5);
    expect(e.defenceDie).toBe(2);
    expect(rng.faces).toEqual([1]);
  });

  it('attack equal to defence does no damage', () => {
    const d = defender();
    const e = resolveAttack(1, attacker(), d, fixedDice(2, 4)); // 2+2+2 = 6 against 1+1+4 = 6
    expect(e).toMatchObject({ attackTotal: 6, defenceTotal: 6, damage: 0, hpAfter: 10, targetDown: false, targetCondition: 'Unhurt' });
    expect(d.hp).toBe(10);
  });

  it('attack one above defence does 1 damage', () => {
    const e = resolveAttack(1, attacker(), defender(), fixedDice(3, 4)); // 7 against 6
    expect(e).toMatchObject({ attackTotal: 7, defenceTotal: 6, damage: 1, hpAfter: 9 });
  });

  it('a defence higher than the attack does no damage and never heals', () => {
    const d = defender({ hp: 4, hpMax: 10 });
    const e = resolveAttack(1, attacker(), d, fixedDice(1, 5)); // 5 against 7
    expect(e).toMatchObject({ attackTotal: 5, defenceTotal: 7, damage: 0, hpBefore: 4, hpAfter: 4 });
    expect(d.hp).toBe(4);
  });

  it('a 6 on the attack die doubles Strength', () => {
    const e = resolveAttack(1, attacker(), defender(), fixedDice(6, 1)); // 2x2 + 2 + 6 = 12 against 1+1+1 = 3
    expect(e).toMatchObject({ power: 4, attackTotal: 12, defenceTotal: 3, damage: 9, critAttack: true, critDefence: false });
  });

  it('a 5 on the attack die does not', () => {
    const e = resolveAttack(1, attacker(), defender(), fixedDice(5, 1));
    expect(e).toMatchObject({ power: 2, attackTotal: 9, critAttack: false });
  });

  it('doubling a Strength of 0 is still 0', () => {
    const e = resolveAttack(1, attacker({ strength: 0 }), defender(), fixedDice(6, 1));
    expect(e).toMatchObject({ power: 0, attackTotal: 8, critAttack: true });
  });

  it('a ranged attacker uses Firepower, and a 6 doubles Firepower', () => {
    const shooter = () => attacker({ strength: 1, firepower: 3, ranged: true });
    expect(resolveAttack(1, shooter(), defender(), fixedDice(2, 1))).toMatchObject({ power: 3, attackTotal: 7 });
    expect(resolveAttack(1, shooter(), defender(), fixedDice(6, 1))).toMatchObject({ power: 6, attackTotal: 14 });
  });

  it('a melee attacker ignores Firepower', () => {
    const e = resolveAttack(1, attacker({ firepower: 5 }), defender(), fixedDice(6, 1));
    expect(e).toMatchObject({ power: 4, attackTotal: 12 });
  });

  it('a 6 on the defence die doubles Armor', () => {
    const d = defender({ armor: 2 });
    const e = resolveAttack(1, attacker(), d, fixedDice(5, 6)); // 9 against 2x2 + 1 + 6 = 11
    expect(e).toMatchObject({ armor: 4, defenceTotal: 11, damage: 0, critDefence: true, critAttack: false });
  });

  it('a 5 on the defence die does not', () => {
    const e = resolveAttack(1, attacker(), defender({ armor: 2 }), fixedDice(5, 5));
    expect(e).toMatchObject({ armor: 2, defenceTotal: 8, damage: 1, critDefence: false });
  });

  it('two sixes double both', () => {
    const e = resolveAttack(1, attacker(), defender(), fixedDice(6, 6)); // 12 against 2+1+6 = 9
    expect(e).toMatchObject({ attackTotal: 12, defenceTotal: 9, damage: 3, critAttack: true, critDefence: true });
  });

  it('the attacker does not use Armor and the defender does not use Strength', () => {
    const e = resolveAttack(1, attacker({ armor: 5 }), defender({ strength: 5, firepower: 5 }), fixedDice(4, 2));
    expect(e).toMatchObject({ attackTotal: 8, defenceTotal: 4 });
  });

  it('a guard adds to the defence and is not used up by the attack', () => {
    const d = defender();
    d.guard = 2;
    const e = resolveAttack(1, attacker(), d, fixedDice(4, 2)); // 8 against 4 + 2
    expect(e).toMatchObject({ guard: 2, defenceTotal: 6, damage: 2 });
    expect(d.guard).toBe(2);
  });

  it('a dazzled attacker loses that much from the next attack only', () => {
    const a = attacker();
    a.dazzled = 2;
    const d = defender();
    expect(resolveAttack(1, a, d, fixedDice(4, 2))).toMatchObject({ penalty: 2, attackTotal: 6, damage: 2 });
    expect(a.dazzled).toBe(0);
    expect(resolveAttack(1, a, d, fixedDice(4, 2))).toMatchObject({ penalty: 0, attackTotal: 8, damage: 4 });
  });

  it('an attack total never drops below 0', () => {
    const a = attacker({ strength: 0, skill: 0 });
    a.dazzled = 5;
    const e = resolveAttack(1, a, defender(), fixedDice(1, 1));
    expect(e.attackTotal).toBe(0);
    expect(e.damage).toBe(0);
  });

  it('hit points stop at 0 and the target is down', () => {
    const d = defender({ hp: 3, hpMax: 10 });
    const e = resolveAttack(1, attacker(), d, fixedDice(6, 1)); // 9 damage into 3 hit points
    expect(e).toMatchObject({ damage: 9, hpBefore: 3, hpAfter: 0, targetDown: true, targetCondition: 'Down', membersLost: 1 });
    expect(d.hp).toBe(0);
    expect(d.count).toBe(0);
    expect(isUp(d)).toBe(false);
  });

  it('damage equal to the hit points left drops the target', () => {
    const d = defender({ hp: 4, hpMax: 10 });
    const e = resolveAttack(1, attacker(), d, fixedDice(4, 2)); // exactly 4
    expect(e).toMatchObject({ damage: 4, hpAfter: 0, targetDown: true });
  });

  it('one hit point left is still standing', () => {
    const d = defender({ hp: 5, hpMax: 10 });
    const e = resolveAttack(1, attacker(), d, fixedDice(4, 2));
    expect(e).toMatchObject({ damage: 4, hpAfter: 1, targetDown: false, targetCondition: 'Badly hurt' });
    expect(isUp(d)).toBe(true);
  });
});

// ---------- groups ----------

describe('a group of identical minor opponents', () => {
  const watch = (count: number, over: Partial<NewCombatant> = {}) =>
    makeCombatant({ id: 'watch', name: 'Watchmen', side: 'foe', strength: 1, skill: 1, armor: 0, hp: 4, count, ...over });
  const target = () => makeCombatant({ id: 't', name: 'T', side: 'you', strength: 0, skill: 0, armor: 0, hp: 50 });

  it('shares one pool of hit points: members x hit points each', () => {
    expect(watch(3)).toMatchObject({ hp: 12, hpMax: 12, count: 3, countMax: 3, hpEach: 4 });
  });

  it.each([[1, 0], [2, 1], [3, 2], [4, 2], [10, 2]])('%i members attack at +%i (one per extra member, at most +2)', (count, bonus) => {
    const e = resolveAttack(1, watch(count), target(), fixedDice(3, 1));
    expect(e.groupBonus).toBe(bonus);
    expect(e.attackTotal).toBe(1 + 1 + 3 + bonus);
  });

  it('the bonus follows the members still standing', () => {
    const group = watch(3);
    hitFor(group, 5); // 12 -> 7: two standing
    expect(group.count).toBe(2);
    expect(resolveAttack(1, group, target(), fixedDice(3, 1)).groupBonus).toBe(1);
    hitFor(group, 4); // 7 -> 3: one standing
    expect(group.count).toBe(1);
    expect(resolveAttack(1, group, target(), fixedDice(3, 1)).groupBonus).toBe(0);
  });

  it('members drop as the pool empties', () => {
    const group = watch(3);
    expect(hitFor(group, 3)).toMatchObject({ hpBefore: 12, hpAfter: 9, membersLost: 0, targetDown: false });
    expect(group.count).toBe(3);
    expect(hitFor(group, 1)).toMatchObject({ hpAfter: 8, membersLost: 1, targetDown: false }); // exactly one member's worth gone
    expect(group.count).toBe(2);
    expect(hitFor(group, 7)).toMatchObject({ hpAfter: 1, membersLost: 1, targetDown: false });
    expect(group.count).toBe(1);
    expect(hitFor(group, 1)).toMatchObject({ hpAfter: 0, membersLost: 1, targetDown: true });
    expect(group.count).toBe(0);
    expect(isUp(group)).toBe(false);
  });

  it('one big hit can drop several members at once', () => {
    const group = watch(4);
    expect(hitFor(group, 9)).toMatchObject({ hpBefore: 16, hpAfter: 7, membersLost: 2 });
    expect(group.count).toBe(2);
  });

  it('a hit bigger than the pool drops everyone and stops at 0', () => {
    const group = watch(3);
    expect(hitFor(group, 40)).toMatchObject({ hpAfter: 0, membersLost: 3, targetDown: true, targetCondition: 'Down' });
    expect(group.count).toBe(0);
  });

  it('says how many are standing', () => {
    const group = watch(3);
    expect(conditionLabel(group)).toBe('3 of 3 standing');
    hitFor(group, 5);
    expect(conditionLabel(group)).toBe('2 of 3 standing');
    hitFor(group, 40);
    expect(conditionLabel(group)).toBe('Down');
  });

  it('a group of one is an ordinary opponent', () => {
    const one = watch(1);
    expect(one).toMatchObject({ hp: 4, hpMax: 4, count: 1, countMax: 1 });
    expect(conditionLabel(one)).toBe('Unhurt');
    expect(resolveAttack(1, one, target(), fixedDice(3, 1)).groupBonus).toBe(0);
    expect(hitFor(one, 3)).toMatchObject({ hpAfter: 1, membersLost: 0 });
    expect(hitFor(one, 1)).toMatchObject({ hpAfter: 0, membersLost: 1, targetDown: true });
  });
});

// ---------- building and describing combatants ----------

describe('making a combatant', () => {
  it('fills in the defaults', () => {
    const c = makeCombatant({ id: 'c', name: 'C', side: 'foe', strength: 1, skill: 2, armor: 3, hp: 7 });
    expect(c).toMatchObject({
      fights: true, firepower: 0, hp: 7, hpMax: 7, count: 1, countMax: 1, hpEach: 7,
      guard: 0, staggered: false, dazzled: 0, fled: false,
    });
  });

  it('keeps current hit points below the maximum for an individual', () => {
    expect(makeCombatant(hero({ hp: 4, hpMax: 10 }))).toMatchObject({ hp: 4, hpMax: 10, count: 1 });
  });

  it('treats a count of 0 or less as one', () => {
    expect(makeCombatant(bandit({ count: 0 }))).toMatchObject({ count: 1, countMax: 1, hp: 6, hpMax: 6 });
  });

  it('a non-fighter is not up', () => {
    expect(isUp(makeCombatant(bandit({ fights: false })))).toBe(false);
  });
});

describe('condition words', () => {
  const at = (hp: number) => {
    const c = makeCombatant(hero({ hp, hpMax: 10 }));
    return condition(c);
  };
  it('reads Unhurt, Hurt, Badly hurt and Down from the hit points', () => {
    expect(at(10)).toBe('Unhurt');
    expect(at(9)).toBe('Hurt');
    expect(at(6)).toBe('Hurt');
    expect(at(5)).toBe('Badly hurt');
    expect(at(1)).toBe('Badly hurt');
    expect(at(0)).toBe('Down');
  });
  it('reads Fled for someone who ran, whatever their hit points', () => {
    const c = makeCombatant(bandit());
    c.fled = true;
    expect(condition(c)).toBe('Fled');
    expect(conditionLabel(c)).toBe('Fled');
    expect(isUp(c)).toBe(false);
  });
});

// ---------- initiative ----------

describe('initiative', () => {
  it('is Skill plus a die, highest first', () => {
    const rng = dice(6, 1);
    const { combat, events } = startCombat([hero(), bandit()], rng);
    expect(nth(events, 0)).toEqual({ type: 'initiative', order: [{ id: 'hero', die: 6, total: 8 }, { id: 'foe', die: 1, total: 2 }] });
    expect(nth(events, 1)).toEqual({ type: 'round', round: 1 });
    expect(combat).toMatchObject({ round: 1, order: ['hero', 'foe'], turn: 0, awaiting: 'action', over: null });
    allUsed(rng);
  });

  it('rolls one die per fighter, in the order they were given', () => {
    const rng = dice(5, 1, 3, 3);
    const { combat, events } = startCombat([bandit(), hero()], rng);
    expect(nth(events, 0)).toEqual({ type: 'initiative', order: [{ id: 'foe', die: 5, total: 6 }, { id: 'hero', die: 1, total: 3 }] });
    expect(combat.order).toEqual(['foe', 'hero']);
    allUsed(rng);
  });

  it('gives +1 to someone quick', () => {
    const slow = startCombat([hero({ skill: 2 }), bandit({ skill: 2 })], dice(3, 3));
    expect(slow.combat.order).toEqual(['hero', 'foe']); // a tie goes to the protagonist
    const quick = startCombat([hero({ skill: 2 }), bandit({ skill: 2, quick: true })], dice(3, 3, 1, 6));
    expect(nth(quick.events, 0)).toMatchObject({ order: [{ id: 'foe', die: 3, total: 6 }, { id: 'hero', die: 3, total: 5 }] });
    expect(quick.combat.order).toEqual(['foe', 'hero']);
  });

  it('quick helps the protagonist too', () => {
    const { combat } = startCombat([hero({ skill: 2, quick: true }), bandit({ skill: 3 })], dice(3, 3));
    expect(combat.order).toEqual(['hero', 'foe']); // 6 against 6, and the tie goes to the protagonist
  });

  it('breaks ties: the protagonist, then their side, then by id', () => {
    const rng = dice(3, 3, 3, 3);
    const { combat } = startCombat([bandit({ id: 'b', skill: 2 }), ally({ id: 'c' }), hero(), bandit({ id: 'a', skill: 2 })], rng);
    expect(combat.order).toEqual(['hero', 'c', 'a', 'b']);
    allUsed(rng);
  });

  it('leaves out people who are present but do not fight', () => {
    const rng = dice(6, 1);
    const { combat, events } = startCombat([
      hero(), ally({ id: 'child', fights: false }), bandit(), bandit({ id: 'hostage', fights: false }),
    ], rng);
    expect(combat.order).toEqual(['hero', 'foe']);
    expect(nth(events, 0)).toMatchObject({ order: [{ id: 'hero' }, { id: 'foe' }] });
    allUsed(rng);
  });

  it('accepts combatants that were already made, and plays on those objects', () => {
    const h = makeCombatant(hero());
    const f = makeCombatant(bandit());
    const rng = dice(6, 1, 5, 1);
    const { combat } = startCombat([h, f], rng);
    act(combat, { type: 'attack', target: 'foe' }, rng);
    expect(combat.fighters['foe']).toBe(f);
    expect(f.hp).toBe(0);
  });
});

// ---------- a fight, turn by turn ----------

describe('a fight', () => {
  it('the player strikes first and wins when the last opponent drops', () => {
    const rng = dice(6, 1, 5, 1);
    const { combat } = startCombat([hero(), bandit()], rng);
    const events = act(combat, { type: 'attack', target: 'foe' }, rng); // 2+2+5 = 9 against 0+1+1 = 2
    expect(kinds(events)).toEqual(['attack', 'down', 'end']);
    expect(nth(events, 0)).toMatchObject({ actor: 'hero', target: 'foe', round: 1, attackTotal: 9, defenceTotal: 2, damage: 7, hpBefore: 6, hpAfter: 0, targetDown: true });
    expect(nth(events, 1)).toEqual({ type: 'down', round: 1, who: 'foe' });
    expect(nth(events, 2)).toEqual({ type: 'end', result: 'won' });
    expect(combat.over).toBe('won');
    expect(combat.awaiting).toBe(null);
    allUsed(rng);
  });

  it('refuses any action once it is over', () => {
    const rng = dice(6, 1, 5, 1);
    const { combat } = startCombat([hero(), bandit()], rng);
    act(combat, { type: 'attack', target: 'foe' }, rng);
    expect(() => act(combat, { type: 'defend' }, rng)).toThrow();
    expect(() => resolveDown(combat, 'destiny', { resistance: 2, style: 'adventure', softenAvailable: true }, rng)).toThrow();
  });

  it('an opponent with the higher initiative attacks before the player chooses', () => {
    const rng = dice(1, 6, 3, 3);
    const { combat, events } = startCombat([hero(), bandit()], rng);
    expect(kinds(events)).toEqual(['initiative', 'round', 'attack']);
    // 2+1+3 = 6 against 1+2+3 = 6: nothing.
    expect(nth(events, 2)).toMatchObject({ actor: 'foe', target: 'hero', round: 1, attackTotal: 6, defenceTotal: 6, damage: 0, hpAfter: 10 });
    expect(combat).toMatchObject({ order: ['foe', 'hero'], turn: 1, awaiting: 'action', over: null });
    allUsed(rng);
  });

  it('a new round starts when everyone has acted', () => {
    const rng = dice(6, 1, 2, 3, 3, 3, 4, 1);
    const { combat } = startCombat([hero(), bandit()], rng);
    const first = act(combat, { type: 'attack', target: 'foe' }, rng); // 6 against 4: 2 damage; then 6 against 6
    expect(kinds(first)).toEqual(['attack', 'attack', 'round']);
    expect(nth(first, 2)).toEqual({ type: 'round', round: 2 });
    expect(attacks(first).map((e) => e.round)).toEqual([1, 1]);
    expect(combat.round).toBe(2);
    const second = act(combat, { type: 'attack', target: 'foe' }, rng); // 8 against 2: down
    expect(attacks(second).map((e) => e.round)).toEqual([2]);
    expect(combat.over).toBe('won');
    allUsed(rng);
  });

  it('defending adds 2 to the defence until the player\'s next turn', () => {
    const rng = dice(6, 1, 3, 3, 3, 3);
    const { combat } = startCombat([hero(), bandit()], rng);
    const events = act(combat, { type: 'defend' }, rng);
    expect(kinds(events)).toEqual(['defend', 'attack', 'round']);
    expect(nth(events, 0)).toEqual({ type: 'defend', round: 1, actor: 'hero' });
    expect(nth(events, 1)).toMatchObject({ actor: 'foe', guard: 2, attackTotal: 6, defenceTotal: 8, damage: 0 });
    expect(fighter(combat, 'hero').guard).toBe(0); // gone now that it is the player's turn again
    const next = act(combat, { type: 'item', item: 'Water', heal: 0 }, rng);
    expect(attacks(next)[0]).toMatchObject({ guard: 0, defenceTotal: 6 });
    allUsed(rng);
  });

  it('goes on until every opponent is down', () => {
    const rng = dice(6, 1, 1, 6, 1, 1, 1, 6, 1);
    const { combat } = startCombat([hero({ strength: 5, skill: 5 }), bandit({ id: 'a' }), bandit({ id: 'b' })], rng);
    const first = act(combat, { type: 'attack', target: 'a' }, rng);
    expect(kinds(first)).toEqual(['attack', 'down', 'attack', 'round']);
    expect(actors(first)).toEqual(['hero', 'b']); // a is down and takes no turn
    expect(combat.over).toBe(null);
    const second = act(combat, { type: 'attack', target: 'b' }, rng);
    expect(kinds(second)).toEqual(['attack', 'down', 'end']);
    expect(combat.over).toBe('won');
    allUsed(rng);
  });

  it('an opponent dropped before its turn never acts', () => {
    const rng = dice(6, 5, 1, 1, 3, 3, 1, 1, 1);
    const { combat } = startCombat([hero(), ally(), bandit({ id: 'a' }), bandit({ id: 'b', hp: 3, hpMax: 6 })], rng);
    expect(combat.order).toEqual(['hero', 'ally', 'a', 'b']);
    const events = act(combat, { type: 'defend' }, rng);
    // The companion goes for the opponent closest to dropping (b) and drops it; a attacks the hero; b is skipped.
    expect(kinds(events)).toEqual(['defend', 'attack', 'down', 'attack', 'round']);
    expect(nth(events, 1)).toMatchObject({ actor: 'ally', target: 'b', damage: 3, targetDown: true });
    expect(nth(events, 3)).toMatchObject({ actor: 'a', target: 'hero', guard: 2, damage: 0 });
    expect(actors(events)).not.toContain('b');
    allUsed(rng);
  });

  it('a companion attacks under the engine\'s control, and ties go by id', () => {
    const rng = dice(6, 5, 1, 1, 3, 3, 1, 1, 1, 1, 1, 1);
    const { combat } = startCombat([hero(), ally(), bandit({ id: 'b' }), bandit({ id: 'a' })], rng);
    const events = act(combat, { type: 'defend' }, rng);
    expect(nth(events, 1)).toMatchObject({ actor: 'ally', target: 'a' });
    // One turn each: the companion, then the two opponents.
    expect(actors(events)).toEqual(['hero', 'ally', 'a', 'b']);
  });
});

// ---------- who an opponent goes for ----------

describe('who an opponent attacks', () => {
  it('the protagonist on 1 to 4 when a companion is there', () => {
    const rng = dice(1, 1, 6, 4, 4, 1);
    const { combat, events } = startCombat([hero(), ally(), bandit()], rng);
    expect(combat.order).toEqual(['foe', 'hero', 'ally']);
    expect(attacks(events)[0]).toMatchObject({ actor: 'foe', target: 'hero', damage: 3 });
    allUsed(rng);
  });

  it('the companion on 5 or 6', () => {
    const rng = dice(1, 1, 6, 5, 4, 1);
    const { combat, events } = startCombat([hero(), ally(), bandit()], rng);
    expect(attacks(events)[0]).toMatchObject({ actor: 'foe', target: 'ally', damage: 3 });
    expect(fighter(combat, 'ally').hp).toBe(5);
    expect(fighter(combat, 'hero').hp).toBe(10);
    allUsed(rng);
  });

  it('always the protagonist when the companion is down, and the companion takes no turn', () => {
    const rng = dice(1, 1, 6, 3, 3, 3, 3);
    const { combat, events } = startCombat([hero(), ally({ hp: 0, hpMax: 8 }), bandit()], rng);
    expect(attacks(events)[0]).toMatchObject({ actor: 'foe', target: 'hero' });
    const next = act(combat, { type: 'defend' }, rng);
    expect(actors(next)).toEqual(['hero', 'foe']);
    expect(attacks(next)[0]).toMatchObject({ target: 'hero' });
    allUsed(rng);
  });

  it('never someone who is not fighting', () => {
    const rng = dice(1, 6, 3, 3);
    const { events } = startCombat([hero(), ally({ id: 'child', fights: false }), bandit()], rng);
    expect(attacks(events)[0]).toMatchObject({ actor: 'foe', target: 'hero' });
    allUsed(rng);
  });
});

// ---------- the protagonist at 0 hit points ----------

describe('the protagonist at 0 hit points', () => {
  function downed(heroOver: Partial<NewCombatant> = {}): Combat {
    // The brute wins initiative and hits for 4+2+5 = 11 against 1+2+1 = 4.
    const { combat } = startCombat([hero({ hp: 3, hpMax: 10, ...heroOver }), brute()], fixedDice(1, 6, 5, 1));
    return combat;
  }

  it('pauses the fight for a choice', () => {
    const rng = dice(1, 6, 5, 1);
    const { combat, events } = startCombat([hero({ hp: 3, hpMax: 10 }), brute()], rng);
    expect(kinds(events)).toEqual(['initiative', 'round', 'attack', 'down']);
    expect(nth(events, 2)).toMatchObject({ actor: 'brute', target: 'hero', damage: 7, hpAfter: 0, targetDown: true });
    expect(nth(events, 3)).toEqual({ type: 'down', round: 1, who: 'hero' });
    expect(combat.awaiting).toBe('down');
    expect(combat.over).toBe(null);
    expect(fighter(combat, 'hero').hp).toBe(0);
    expect(() => act(combat, { type: 'defend' }, rng)).toThrow();
    allUsed(rng);
  });

  it('a destiny point: back up with 5 hit points and the fight goes on', () => {
    const combat = downed();
    const r = resolveDown(combat, 'destiny', { resistance: 2, style: 'adventure', softenAvailable: true }, dice());
    expect(r).toMatchObject({ outcome: 'back_up', die: null, softened: false });
    expect(r.events).toEqual([]);
    const h = fighter(combat, 'hero');
    expect(h.hp).toBe(5);
    expect(isUp(h)).toBe(true);
    expect(combat.awaiting).toBe('action');
    expect(combat.over).toBe(null);
  });

  it('after getting back up the protagonist is one fighter again and attacks without a penalty', () => {
    const combat = downed();
    resolveDown(combat, 'destiny', { resistance: 2, style: 'adventure', softenAvailable: true }, dice());
    expect(fighter(combat, 'hero').count).toBe(1);
    const events = act(combat, { type: 'attack', target: 'brute' }, dice(4, 4, 1, 6));
    // 2+2+4 = 8 against 0+2+4 = 6.
    expect(nth(events, 0)).toMatchObject({ actor: 'hero', groupBonus: 0, attackTotal: 8, defenceTotal: 6, damage: 2 });
  });

  it('never gets up with more than the maximum', () => {
    const combat = downed({ hp: 3, hpMax: 3 });
    resolveDown(combat, 'destiny', { resistance: 1, style: 'adventure', softenAvailable: true }, dice());
    expect(fighter(combat, 'hero').hp).toBe(3);
  });

  it('can be dropped again and choose again', () => {
    const combat = downed();
    resolveDown(combat, 'destiny', { resistance: 2, style: 'adventure', softenAvailable: true }, dice());
    // The hero defends (1+2+1+2 = 6); the brute rolls a 6: 8+2+6 = 16. 10 damage into 5 hit points.
    const events = act(combat, { type: 'defend' }, dice(6, 1));
    expect(kinds(events)).toEqual(['defend', 'round', 'attack', 'down']);
    expect(combat.awaiting).toBe('down');
    const r = resolveDown(combat, 'test', { resistance: 2, style: 'brutal', softenAvailable: false }, dice(2));
    expect(r.outcome).toBe('defeated');
    expect(combat.over).toBe('lost');
  });

  // style, Resistance, soften still available, die -> outcome, softened, die reported
  it.each<[TableStyle, number, boolean, number, 'defeated' | 'dead', boolean, number | null]>([
    ['story', 2, false, 6, 'defeated', false, null], // never fatal, never rolled
    ['story', 0, false, 6, 'defeated', false, null],
    ['adventure', 2, true, 1, 'defeated', false, 1],
    ['adventure', 2, true, 2, 'defeated', false, 2], // a die equal to Resistance passes
    ['adventure', 2, true, 3, 'defeated', true, 3], // failed, softened this once
    ['adventure', 2, false, 3, 'dead', false, 3], // failed, already softened this chapter
    ['adventure', 2, false, 2, 'defeated', false, 2],
    ['adventure', 6, true, 6, 'defeated', true, 6], // a 6 always fails
    ['adventure', 6, false, 6, 'dead', false, 6],
    ['brutal', 2, true, 3, 'dead', false, 3], // nothing softens it
    ['brutal', 2, false, 3, 'dead', false, 3],
    ['brutal', 2, false, 2, 'defeated', false, 2],
    ['brutal', 5, false, 5, 'defeated', false, 5],
    ['brutal', 6, false, 6, 'dead', false, 6],
    ['brutal', 0, false, 1, 'dead', false, 1],
  ])('the death test: %s, Resistance %i, soften %s, die %i -> %s', (style, resistance, softenAvailable, die, outcome, softened, reported) => {
    const combat = downed();
    const rng = fixedDice(die, 99);
    const r = resolveDown(combat, 'test', { resistance, style, softenAvailable }, rng);
    expect(r.outcome).toBe(outcome);
    expect(r.softened).toBe(softened);
    expect(r.die).toBe(reported);
    expect(r.events).toEqual([{ type: 'end', result: 'lost' }]);
    expect(combat.over).toBe('lost');
    expect(combat.awaiting).toBe(null);
    expect(rng.faces).toEqual(reported === null ? [die, 99] : [99]);
    // The choice is made once.
    expect(() => resolveDown(combat, 'test', { resistance, style, softenAvailable }, rng)).toThrow();
    expect(() => act(combat, { type: 'defend' }, rng)).toThrow();
  });

  it('cannot be resolved when nobody is down', () => {
    const { combat } = startCombat([hero(), bandit()], dice(6, 1));
    expect(() => resolveDown(combat, 'test', { resistance: 2, style: 'adventure', softenAvailable: true }, dice(1))).toThrow();
    expect(combat.awaiting).toBe('action');
  });

  describe('while a companion is still up', () => {
    function start() {
      const rng = dice(1, 3, 6, 2, 5, 1, 3, 3);
      const started = startCombat([hero({ hp: 3, hpMax: 10 }), ally(), brute()], rng);
      return { ...started, rng };
    }

    it('the fight still pauses at once, before the companion acts', () => {
      const { combat, events } = start();
      expect(combat.order).toEqual(['brute', 'ally', 'hero']);
      expect(kinds(events)).toEqual(['initiative', 'round', 'attack', 'down']);
      expect(actors(events)).toEqual(['brute']);
      expect(combat.awaiting).toBe('down');
      expect(isUp(fighter(combat, 'ally'))).toBe(true);
    });

    it('with a destiny point play resumes with whoever was next', () => {
      const { combat, rng } = start();
      const r = resolveDown(combat, 'destiny', { resistance: 2, style: 'adventure', softenAvailable: true }, rng);
      expect(r.outcome).toBe('back_up');
      expect(kinds(r.events)).toEqual(['attack']);
      expect(nth(r.events, 0)).toMatchObject({ actor: 'ally', target: 'brute', attackTotal: 7, defenceTotal: 5, damage: 2 });
      expect(combat.awaiting).toBe('action');
      expect(fighter(combat, 'hero').hp).toBe(5);
      allUsed(rng);
    });

    it('the death test ends the fight as lost', () => {
      const { combat } = start();
      const r = resolveDown(combat, 'test', { resistance: 2, style: 'brutal', softenAvailable: false }, fixedDice(5));
      expect(r.outcome).toBe('dead');
      expect(combat.over).toBe('lost');
      expect(fighter(combat, 'ally').hp).toBe(8);
    });
  });
});

// ---------- abilities in a fight ----------

describe('abilities in a fight', () => {
  it('a staggered opponent loses its next action, and only that one', () => {
    const rng = dice(6, 1, 3, 3);
    const { combat } = startCombat([hero({ energy: 5, abilities: ['gale_push'] }), bandit()], rng);
    const events = act(combat, { type: 'ability', ability: 'gale_push', target: 'foe' }, rng);
    expect(kinds(events)).toEqual(['ability', 'skip', 'round']);
    expect(nth(events, 0)).toMatchObject({ type: 'ability', round: 1, actor: 'hero', ability: 'gale_push', target: 'foe', energyLeft: 3 });
    expect(nth(events, 1)).toEqual({ type: 'skip', round: 1, actor: 'foe' });
    expect(fighter(combat, 'foe').staggered).toBe(false);
    expect(fighter(combat, 'hero').energy).toBe(3);
    const next = act(combat, { type: 'defend' }, rng);
    expect(kinds(next)).toEqual(['defend', 'attack', 'round']);
    allUsed(rng);
  });

  it('a staggered group loses its one turn', () => {
    const rng = dice(6, 1);
    const { combat } = startCombat([hero({ energy: 2, abilities: ['gale_push'] }), bandit({ id: 'watch', count: 3, hp: 4 })], rng);
    const events = act(combat, { type: 'ability', ability: 'gale_push', target: 'watch' }, rng);
    expect(kinds(events)).toEqual(['ability', 'skip', 'round']);
    allUsed(rng);
  });

  it('nobody loses two actions running: a second stagger is refused until they have acted', () => {
    const rng = dice(6, 1, 3, 3);
    const { combat } = startCombat([hero({ energy: 9, abilities: ['gale_push'] }), bandit()], rng);
    act(combat, { type: 'ability', ability: 'gale_push', target: 'foe' }, rng);
    expect(fighter(combat, 'foe').shaken).toBe(true);
    expect(canStagger(fighter(combat, 'foe'))).toBe(false);
    const before = structuredClone(combat);
    expect(() => act(combat, { type: 'ability', ability: 'gale_push', target: 'foe' }, rng)).toThrow(/so soon/);
    expect(combat).toEqual(before); // nothing spent: the player chooses again
    // Once they have acted, they can be thrown off again.
    expect(kinds(act(combat, { type: 'defend' }, rng))).toEqual(['defend', 'attack', 'round']);
    expect(canStagger(fighter(combat, 'foe'))).toBe(true);
    expect(kinds(act(combat, { type: 'ability', ability: 'gale_push', target: 'foe' }, rng))).toEqual(['ability', 'skip', 'round']);
    expect(fighter(combat, 'hero').energy).toBe(5);
    allUsed(rng);
  });

  describe('a move of one’s own, and an effect invented on the spot', () => {
    const own = { g1: { id: 'g1', name: 'Long Punch', tier: 2, cost: 2, text: '', own: true as const, combat: { type: 'damage' as const, value: 4, needsTarget: true } } };
    const burst = { type: 'effect' as const, name: 'a burst of heat', cost: 3, effect: { type: 'damage' as const, value: 4, needsTarget: true }, target: 'foe' };

    it('a move is used like an ability, from the definitions the fighter carries', () => {
      const rng = dice(6, 1, 3, 3);
      const { combat } = startCombat([hero({ energy: 3, abilities: ['g1'], own }), bandit({ hp: 9 })], rng);
      const events = act(combat, { type: 'ability', ability: 'g1', target: 'foe' }, rng);
      expect(kinds(events)).toEqual(['ability', 'attack', 'round']);
      expect(nth(events, 0)).toMatchObject({ type: 'ability', ability: 'g1', effect: '4 damage to Bandit', did: { type: 'damage', value: 4 }, energyLeft: 1 });
      expect(fighter(combat, 'foe').hp).toBe(5);
      // A move that is not among the fighter’s own is refused like any unknown ability.
      expect(() => act(combat, { type: 'ability', ability: 'g2', target: 'foe' }, rng)).toThrow();
      allUsed(rng);
    });

    it('a raised guard takes that much off damage that skips the defence roll', () => {
      const rng = dice(6, 1, 3, 3);
      const { combat } = startCombat([hero({ energy: 3, abilities: ['g1'], own }), bandit({ hp: 9 })], rng);
      fighter(combat, 'foe').guard = 3;
      const events = act(combat, { type: 'ability', ability: 'g1', target: 'foe' }, rng);
      expect(nth(events, 0)).toMatchObject({ effect: '1 damage to Bandit', did: { type: 'damage', value: 1 } });
      expect(fighter(combat, 'foe').hp).toBe(8);
    });

    it('an invented effect spends its energy and the turn whether or not it worked', () => {
      const rng = dice(6, 1, 3, 3, 3, 3);
      const { combat } = startCombat([hero({ energy: 6 }), bandit({ hp: 9 })], rng);
      const worked = act(combat, { ...burst, worked: true }, rng);
      expect(kinds(worked)).toEqual(['effect', 'attack', 'round']);
      expect(nth(worked, 0)).toMatchObject({ type: 'effect', name: 'a burst of heat', target: 'foe', worked: true, effect: '4 damage to Bandit', did: { type: 'damage', value: 4 }, energyLeft: 3 });
      expect(fighter(combat, 'foe').hp).toBe(5);
      const failed = act(combat, { ...burst, worked: false }, rng);
      expect(kinds(failed)).toEqual(['effect', 'attack', 'round']);
      expect(nth(failed, 0)).toMatchObject({ type: 'effect', worked: false, effect: '', energyLeft: 0 });
      expect(fighter(combat, 'foe').hp).toBe(5);
      // With no energy for it, it is refused and nothing changes.
      const before = structuredClone(combat);
      expect(() => act(combat, { ...burst, worked: true }, rng)).toThrow(/energy/);
      expect(combat).toEqual(before);
      allUsed(rng);
    });

    it('an invented heal restores no more than was missing, and says how much', () => {
      const rng = dice(6, 1, 3, 3);
      const { combat } = startCombat([hero({ energy: 6, hp: 8, hpMax: 10 }), bandit()], rng);
      const events = act(combat, { type: 'effect', name: 'knit', cost: 2, effect: { type: 'heal', value: 5, needsTarget: false }, worked: true }, rng);
      expect(nth(events, 0)).toMatchObject({ type: 'effect', worked: true, did: { type: 'heal', value: 2 } });
      expect(fighter(combat, 'hero').hp).toBe(10);
    });

    it('the odds count the hardest-hitting power the protagonist has energy for', () => {
      const tough = bandit({ strength: 3, skill: 3, armor: 2, hp: 15 });
      const plain = winChance([hero({ skill: 3 }), tough], makeRng(5), 600);
      const armed = winChance([hero({ skill: 3, energy: 10, abilities: ['g1'], own }), tough], makeRng(5), 600);
      expect(armed).toBeGreaterThan(plain + 0.2);
      // With no energy for it, the fight is judged as if it were not there.
      expect(winChance([hero({ skill: 3, energy: 1, abilities: ['g1'], own }), tough], makeRng(5), 600)).toBe(plain);
    });
  });

  describe('someone who brings a power of their own to the fight', () => {
    const burn: NewCombatant['power'] = { name: 'Forge Hands', effect: { type: 'damage', value: 2 } };

    it('uses it together with their attack on their first turn and on every third after it', () => {
      // Hero first (6 against 1), then defends every round: the bandit's blows all fall short, and only the power lands.
      const rng = dice(6, 1, 1, 6, 1, 6, 1, 6, 1, 6, 1, 6);
      const { combat } = startCombat([hero({ hp: 20 }), bandit({ power: burn })], rng);
      const seen: string[][] = [];
      for (let i = 0; i < 5; i++) seen.push(kinds(act(combat, { type: 'defend' }, rng)).filter((k) => k === 'power' || k === 'attack'));
      expect(seen).toEqual([['power', 'attack'], ['attack'], ['attack'], ['power', 'attack'], ['attack']]);
      expect(fighter(combat, 'foe').turns).toBe(5);
      // Two points each time, less the guard that was up: nothing at all, here, since defending raises it by 2.
      expect(fighter(combat, 'hero').hp).toBe(20);
      allUsed(rng);
    });

    it('damage from it skips the defence roll, a raised guard takes off it, and it can bring the protagonist down', () => {
      const rng = dice(6, 1, 1, 6);
      const { combat } = startCombat([hero({ hp: 9 }), bandit({ power: { name: 'Forge Hands', effect: { type: 'damage', value: 4 } } })], rng);
      const events = act(combat, { type: 'attack', target: 'foe' }, dice(1, 6));
      const power = events.find((e) => e.type === 'power')!;
      expect(power).toMatchObject({ type: 'power', actor: 'foe', name: 'Forge Hands', target: 'hero', effect: '4 damage to Hero', did: { type: 'damage', value: 4 } });
      expect(fighter(combat, 'hero').hp).toBeLessThanOrEqual(5);
      // A hero on their last legs is brought down by it, and the attack that would have followed is not made.
      const low = startCombat([hero({ hp: 3, hpMax: 10 }), bandit({ power: { name: 'Forge Hands', effect: { type: 'damage', value: 4 } } })], dice(6, 1));
      const end = act(low.combat, { type: 'attack', target: 'foe' }, dice(1, 6));
      expect(kinds(end)).toEqual(['attack', 'power', 'down']);
      expect(low.combat.awaiting).toBe('down');
    });

    it('a guard of their own lasts the round, a dazzle spoils the next attack, and a stagger costs an action but not two running', () => {
      const guarded = startCombat([hero(), bandit({ power: { name: 'Set Feet', effect: { type: 'guard', value: 3 } } })], dice(6, 1));
      act(guarded.combat, { type: 'defend' }, dice(1, 6));
      expect(fighter(guarded.combat, 'foe').guard).toBe(3);
      // 2 + 2 + 3 against 0 + 1 + 3, with the guard of 3 on top: nothing gets through.
      expect(attacks(act(guarded.combat, { type: 'attack', target: 'foe' }, dice(3, 3, 1, 6)))[0]).toMatchObject({ guard: 3, damage: 0 });

      const dazzled = startCombat([hero(), bandit({ power: { name: 'Glare', effect: { type: 'dazzle', value: 2 } } })], dice(6, 1));
      act(dazzled.combat, { type: 'defend' }, dice(1, 6));
      expect(fighter(dazzled.combat, 'hero').dazzled).toBe(2);
      expect(attacks(act(dazzled.combat, { type: 'attack', target: 'foe' }, dice(3, 3, 1, 6)))[0]).toMatchObject({ actor: 'hero', penalty: 2 });

      const held = startCombat([hero({ hp: 30 }), bandit({ hp: 30, power: { name: 'Still Voice', effect: { type: 'stagger' } } })], dice(6, 1));
      const skipped = (events: CombatEvent[]) => events.filter((e) => e.type === 'skip' && e.actor === 'hero').length;
      // The first turn of the bandit takes the hero's next action; the hero then acts again before it can be taken a second time.
      const first = act(held.combat, { type: 'defend' }, dice(1, 6));
      expect(kinds(first)).toContain('power');
      expect(skipped(first)).toBe(1);
      // Taking an action is the whole of that turn: the one blow in these events is from the bandit's second turn.
      expect(attacks(first).map((a) => [a.actor, a.round])).toEqual([['foe', 2]]);
      let lost = 1;
      for (let i = 0; i < 6; i++) lost += skipped(act(held.combat, { type: 'defend' }, dice(1, 6, 1, 6, 1, 6)));
      // Eleven turns of the bandit by now: one after each of the seven actions here, and one more each time the
      // hero was held. Its power came on turns 1, 4, 7 and 10, and each of those took one action and no more.
      expect(fighter(held.combat, 'foe').turns).toBe(11);
      expect(lost).toBe(4);

      // Two who can do it: the second finds the hero already held, and its power does nothing that turn.
      const pair = startCombat([hero({ hp: 30 }), bandit({ id: 'a', hp: 30, power: { name: 'Still Voice', effect: { type: 'stagger' } } }), bandit({ id: 'b', hp: 30, power: { name: 'Cold Hand', effect: { type: 'stagger' } } })], dice(6, 1, 1));
      const both = act(pair.combat, { type: 'defend' }, dice(1, 6, 1, 6, 1, 6, 1, 6));
      expect(both.filter((e) => e.type === 'power').map((e) => e.actor)).toEqual(['a']);
      expect(skipped(both)).toBe(1);
      expect(pair.combat.awaiting).toBe('action'); // the hero acts again before anyone can hold them a second time
    });

    it('a group has no power, and neither has the protagonist: theirs are moves', () => {
      const { combat } = startCombat([hero({ power: burn }), bandit({ id: 'watch', count: 3, hp: 4, power: burn })], dice(6, 1));
      expect(fighter(combat, 'hero').power).toBeUndefined();
      expect(fighter(combat, 'watch').power).toBeUndefined();
      expect(kinds(act(combat, { type: 'defend' }, dice(1, 6)))).not.toContain('power');
    });

    it('a companion uses theirs on an opponent, and the odds of a fight count it either way', () => {
      const rng = dice(6, 3, 1, 3, 3, 1, 6);
      const { combat } = startCombat([hero(), ally({ power: burn }), bandit({ hp: 12 })], rng);
      const events = act(combat, { type: 'defend' }, rng);
      expect(events.find((e) => e.type === 'power')).toMatchObject({ actor: 'ally', target: 'foe', effect: '2 damage to Bandit' });
      const foe = bandit({ strength: 3, skill: 3, armor: 2, hp: 15 });
      const plain = winChance([hero({ skill: 3 }), foe], makeRng(9), 800);
      const worse = winChance([hero({ skill: 3 }), { ...foe, power: { name: 'Forge Hands', effect: { type: 'damage', value: 4 } } }], makeRng(9), 800);
      expect(worse).toBeLessThan(plain);
      const helped = winChance([hero({ skill: 3 }), ally({ power: burn }), foe], makeRng(9), 800);
      expect(helped).toBeGreaterThan(winChance([hero({ skill: 3 }), ally(), foe], makeRng(9), 800));
    });
  });

  it('a dazzled opponent attacks at -2 once', () => {
    const rng = dice(6, 1, 4, 1, 4, 1);
    const { combat } = startCombat([hero({ energy: 1, abilities: ['glimmer'] }), bandit()], rng);
    const events = act(combat, { type: 'ability', ability: 'glimmer', target: 'foe' }, rng);
    expect(kinds(events)).toEqual(['ability', 'attack', 'round']);
    expect(nth(events, 0)).toMatchObject({ ability: 'glimmer', target: 'foe', energyLeft: 0 });
    // 2+1+4 - 2 = 5 against 1+2+1 = 4.
    expect(nth(events, 1)).toMatchObject({ actor: 'foe', penalty: 2, attackTotal: 5, defenceTotal: 4, damage: 1 });
    expect(fighter(combat, 'foe').dazzled).toBe(0);
    const next = act(combat, { type: 'item', item: 'Water', heal: 0 }, rng);
    expect(attacks(next)[0]).toMatchObject({ penalty: 0, attackTotal: 7, damage: 3 });
    allUsed(rng);
  });

  it('Featherstep guards until the next turn and costs 1 energy', () => {
    const rng = dice(6, 1, 3, 3);
    const { combat } = startCombat([hero({ energy: 2, abilities: ['featherstep'] }), bandit()], rng);
    const events = act(combat, { type: 'ability', ability: 'featherstep' }, rng);
    expect(kinds(events)).toEqual(['ability', 'attack', 'round']);
    expect(nth(events, 0)).toMatchObject({ ability: 'featherstep', energyLeft: 1 });
    expect(nth(events, 1)).toMatchObject({ guard: 2, defenceTotal: 8, damage: 0 });
    expect(fighter(combat, 'hero').guard).toBe(0);
    allUsed(rng);
  });

  it('energy exactly equal to the cost is enough', () => {
    const rng = dice(6, 1);
    const { combat } = startCombat([hero({ energy: 2, abilities: ['gale_push'] }), bandit()], rng);
    const events = act(combat, { type: 'ability', ability: 'gale_push', target: 'foe' }, rng);
    expect(nth(events, 0)).toMatchObject({ energyLeft: 0 });
  });

  describe('an ability that cannot be used is refused and the turn is not lost', () => {
    const cases: [string, Partial<NewCombatant>, CombatAction][] = [
      ['not enough energy', { energy: 1, abilities: ['gale_push'] }, { type: 'ability', ability: 'gale_push', target: 'foe' }],
      ['no energy at all', { abilities: ['glimmer'] }, { type: 'ability', ability: 'glimmer', target: 'foe' }],
      ['an ability that does not exist', { energy: 9, abilities: ['fireball'] }, { type: 'ability', ability: 'fireball', target: 'foe' }],
      ['an ability the character has not learned', { energy: 9, abilities: [] }, { type: 'ability', ability: 'glimmer', target: 'foe' }],
      ['an ability with no effect in a fight', { energy: 9, abilities: ['windcallers_ear'] }, { type: 'ability', ability: 'windcallers_ear' }],
      ['no target for an ability that needs one', { energy: 9, abilities: ['gale_push'] }, { type: 'ability', ability: 'gale_push' }],
      ['a target that is not in the fight', { energy: 9, abilities: ['gale_push'] }, { type: 'ability', ability: 'gale_push', target: 'nobody' }],
      ['a target that is already down', { energy: 9, abilities: ['gale_push'] }, { type: 'ability', ability: 'gale_push', target: 'corpse' }],
    ];
    it.each(cases)('%s', (_name, heroOver, action) => {
      const rng = dice(6, 1, 1, 3, 3);
      const { combat } = startCombat([hero(heroOver), bandit(), bandit({ id: 'corpse', hp: 0, hpMax: 6 })], rng);
      const before = structuredClone(combat);
      expect(() => act(combat, action, rng)).toThrow();
      expect(combat).toEqual(before); // nothing spent, nothing changed, still the player's turn
      expect(combat.awaiting).toBe('action');
      // The player can choose something else.
      const events = act(combat, { type: 'defend' }, rng);
      expect(kinds(events)).toEqual(['defend', 'attack', 'round']);
    });
  });

  describe('primitives the sample abilities do not use yet', () => {
    beforeAll(() => {
      ABILITIES['test_bolt'] = { id: 'test_bolt', name: 'Bolt', path: 'fire', tier: 1, cost: 1, text: '', combat: { type: 'damage', value: 5, needsTarget: true } };
      ABILITIES['test_mend'] = { id: 'test_mend', name: 'Mend', path: 'water', tier: 1, cost: 1, text: '', combat: { type: 'heal', value: 4, needsTarget: false } };
    });
    afterAll(() => {
      delete ABILITIES['test_bolt'];
      delete ABILITIES['test_mend'];
    });

    it('direct damage ignores defence and rolls nothing', () => {
      const rng = dice(6, 1, 3, 3);
      const { combat } = startCombat([hero({ energy: 3, abilities: ['test_bolt'] }), bandit({ armor: 5, skill: 5, hp: 12 })], rng);
      const events = act(combat, { type: 'ability', ability: 'test_bolt', target: 'foe' }, rng);
      expect(kinds(events)).toEqual(['ability', 'attack', 'round']);
      expect(nth(events, 0)).toMatchObject({ ability: 'test_bolt', target: 'foe', energyLeft: 2 });
      expect(fighter(combat, 'foe').hp).toBe(7);
      allUsed(rng);
    });

    it('direct damage that empties the hit points drops the target and can end the fight', () => {
      const rng = dice(6, 1);
      const { combat } = startCombat([hero({ energy: 3, abilities: ['test_bolt'] }), bandit({ hp: 5 })], rng);
      const events = act(combat, { type: 'ability', ability: 'test_bolt', target: 'foe' }, rng);
      expect(kinds(events)).toEqual(['ability', 'down', 'end']);
      expect(fighter(combat, 'foe')).toMatchObject({ hp: 0, count: 0 });
      expect(combat.over).toBe('won');
      allUsed(rng);
    });

    it('direct damage takes members out of a group', () => {
      const rng = dice(6, 1, 3, 3);
      const { combat } = startCombat([hero({ energy: 3, abilities: ['test_bolt'] }), bandit({ id: 'watch', strength: 1, count: 3, hp: 4 })], rng);
      const events = act(combat, { type: 'ability', ability: 'test_bolt', target: 'watch' }, rng);
      expect(fighter(combat, 'watch')).toMatchObject({ hp: 7, count: 2 });
      expect(attacks(events)[0]).toMatchObject({ actor: 'watch', groupBonus: 1 });
      allUsed(rng);
    });

    it('healing restores hit points up to the maximum', () => {
      const rng = dice(6, 1, 3, 3, 3, 3);
      const { combat } = startCombat([hero({ hp: 4, hpMax: 10, energy: 3, abilities: ['test_mend'] }), bandit()], rng);
      act(combat, { type: 'ability', ability: 'test_mend' }, rng);
      expect(fighter(combat, 'hero').hp).toBe(8);
      act(combat, { type: 'ability', ability: 'test_mend' }, rng);
      expect(fighter(combat, 'hero').hp).toBe(10);
      expect(fighter(combat, 'hero').energy).toBe(1);
      allUsed(rng);
    });
  });
});

// ---------- other actions ----------

describe('attacking', () => {
  it.each([
    ['someone who is not in the fight', 'nobody'],
    ['a companion', 'ally'],
    ['yourself', 'hero'],
    ['an opponent who is already down', 'corpse'],
    ['someone who is present but not fighting', 'hostage'],
  ])('refuses %s and leaves the turn with the player', (_name, target) => {
    const rng = dice(6, 1, 1, 1, 1, 3, 3);
    const { combat } = startCombat([
      hero(), ally(), bandit(), bandit({ id: 'corpse', hp: 0, hpMax: 6 }), bandit({ id: 'hostage', fights: false }),
    ], rng);
    const before = structuredClone(combat);
    expect(() => act(combat, { type: 'attack', target }, rng)).toThrow();
    expect(combat).toEqual(before);
    expect(combat.awaiting).toBe('action');
    expect(() => act(combat, { type: 'attack', target: 'foe' }, rng)).not.toThrow();
  });
});

describe('using an item', () => {
  it('restores hit points and takes the turn', () => {
    const rng = dice(6, 1, 3, 3);
    const { combat } = startCombat([hero({ hp: 4, hpMax: 10 }), bandit()], rng);
    const events = act(combat, { type: 'item', item: 'Salve', heal: 3 }, rng);
    expect(kinds(events)).toEqual(['item', 'attack', 'round']);
    expect(nth(events, 0)).toEqual({ type: 'item', round: 1, actor: 'hero', item: 'Salve', healed: 3, hpAfter: 7 });
    allUsed(rng);
  });

  it('never heals above the maximum, and reports what was really restored', () => {
    const rng = dice(6, 1, 3, 3);
    const { combat } = startCombat([hero({ hp: 8, hpMax: 10 }), bandit()], rng);
    const events = act(combat, { type: 'item', item: 'Salve', heal: 5 }, rng);
    expect(nth(events, 0)).toMatchObject({ healed: 2, hpAfter: 10 });
    expect(fighter(combat, 'hero').hp).toBe(10);
  });
});

describe('fleeing', () => {
  it('succeeds on a die at or under Skill and ends the fight', () => {
    const rng = dice(6, 1, 2);
    const { combat } = startCombat([hero({ skill: 2 }), bandit()], rng);
    const events = act(combat, { type: 'flee' }, rng);
    expect(events).toEqual([{ type: 'flee', round: 1, actor: 'hero', die: 2, success: true }, { type: 'end', result: 'fled' }]);
    expect(combat.over).toBe('fled');
    expect(combat.awaiting).toBe(null);
    expect(() => act(combat, { type: 'flee' }, rng)).toThrow();
    allUsed(rng);
  });

  it('fails one above Skill, and the opponents get their turn', () => {
    const rng = dice(6, 1, 3, 3, 3);
    const { combat } = startCombat([hero({ skill: 2 }), bandit()], rng);
    const events = act(combat, { type: 'flee' }, rng);
    expect(kinds(events)).toEqual(['flee', 'attack', 'round']);
    expect(nth(events, 0)).toEqual({ type: 'flee', round: 1, actor: 'hero', die: 3, success: false });
    expect(combat.over).toBe(null);
    expect(combat.awaiting).toBe('action');
    allUsed(rng);
  });

  it('a 6 fails even with a Skill of 6', () => {
    const rng = dice(6, 1, 6, 3, 3);
    const { combat } = startCombat([hero({ skill: 6 }), bandit()], rng);
    const events = act(combat, { type: 'flee' }, rng);
    expect(nth(events, 0)).toMatchObject({ die: 6, success: false });
    expect(combat.over).toBe(null);
  });

  it('is impossible with a Skill of 0', () => {
    const rng = dice(6, 1, 1, 3, 3);
    const { combat } = startCombat([hero({ skill: 0 }), bandit()], rng);
    const events = act(combat, { type: 'flee' }, rng);
    expect(nth(events, 0)).toMatchObject({ die: 1, success: false });
  });

  it('takes the companions along: the fight is over for everyone', () => {
    const rng = dice(6, 1, 1, 1);
    const { combat } = startCombat([hero(), ally(), bandit()], rng);
    const events = act(combat, { type: 'flee' }, rng);
    expect(kinds(events)).toEqual(['flee', 'end']);
    expect(combat.over).toBe('fled');
    allUsed(rng);
  });
});

// The specification says nothing about opponents running away. The engine lets a badly hurt opponent
// (or a group at half its members or fewer) with nobody left beside it run on a die of 1 to 3.
describe('an opponent losing its nerve (an engine choice)', () => {
  it('badly hurt and alone: runs on a 3, and the fight is won', () => {
    const rng = dice(6, 1, 3, 2, 3);
    const { combat } = startCombat([hero(), bandit()], rng);
    const events = act(combat, { type: 'attack', target: 'foe' }, rng); // 7 against 3: 6 -> 2 hit points
    expect(kinds(events)).toEqual(['attack', 'flee', 'end']);
    expect(nth(events, 1)).toEqual({ type: 'flee', round: 1, actor: 'foe', die: null, success: true });
    expect(nth(events, 2)).toEqual({ type: 'end', result: 'won' });
    expect(condition(fighter(combat, 'foe'))).toBe('Fled');
    expect(combat.over).toBe('won');
    allUsed(rng);
  });

  it('badly hurt and alone: stays on a 4 and attacks', () => {
    const rng = dice(6, 1, 3, 2, 4, 3, 3);
    const { combat } = startCombat([hero(), bandit()], rng);
    const events = act(combat, { type: 'attack', target: 'foe' }, rng);
    expect(kinds(events)).toEqual(['attack', 'attack', 'round']);
    expect(actors(events)).toEqual(['hero', 'foe']);
    allUsed(rng);
  });

  it('exactly half its hit points counts as badly hurt', () => {
    const rng = dice(6, 1, 3, 3, 1);
    const { combat } = startCombat([hero(), bandit()], rng);
    const events = act(combat, { type: 'attack', target: 'foe' }, rng); // 7 against 4: 6 -> 3
    expect(fighter(combat, 'foe').hp).toBe(3);
    expect(kinds(events)).toEqual(['attack', 'flee', 'end']);
    allUsed(rng);
  });

  it('hurt but not badly: no roll, it attacks', () => {
    const rng = dice(6, 1, 2, 3, 3, 3);
    const { combat } = startCombat([hero(), bandit()], rng);
    const events = act(combat, { type: 'attack', target: 'foe' }, rng); // 6 against 4: 6 -> 4
    expect(fighter(combat, 'foe').hp).toBe(4);
    expect(kinds(events)).toEqual(['attack', 'attack', 'round']);
    allUsed(rng);
  });

  it('badly hurt with a friend still standing: no roll, it attacks', () => {
    const rng = dice(6, 1, 1, 3, 2, 3, 3, 3, 3);
    const { combat } = startCombat([hero(), bandit({ id: 'a' }), bandit({ id: 'b' })], rng);
    const events = act(combat, { type: 'attack', target: 'a' }, rng);
    expect(fighter(combat, 'a').hp).toBe(2);
    expect(kinds(events)).toEqual(['attack', 'attack', 'attack', 'round']);
    expect(actors(events)).toEqual(['hero', 'a', 'b']);
    allUsed(rng);
  });

  it('someone who ran takes no further part', () => {
    const rng = dice(6, 1, 1, 5, 1, 1, 1, 3, 2, 1);
    const { combat } = startCombat([hero(), bandit({ id: 'a' }), bandit({ id: 'b' })], rng);
    act(combat, { type: 'attack', target: 'a' }, rng); // a is down; b attacks: 4 against 4
    expect(isUp(fighter(combat, 'a'))).toBe(false);
    const events = act(combat, { type: 'attack', target: 'b' }, rng); // 7 against 3: b at 2, alone, runs on a 1
    expect(kinds(events)).toEqual(['attack', 'flee', 'end']);
    expect(combat.over).toBe('won');
    expect(fighter(combat, 'b')).toMatchObject({ fled: true, hp: 2 });
    expect(() => act(combat, { type: 'attack', target: 'b' }, rng)).toThrow();
  });
});

// ---------- a whole fight against a group ----------

describe('a fight against three watchmen', () => {
  const strong = () => hero({ strength: 3, skill: 3, armor: 2, hp: 15 });
  const watch = (over: Partial<NewCombatant> = {}) => bandit({ id: 'watch', name: 'Watchmen', strength: 1, skill: 1, armor: 0, hp: 4, count: 3, ...over });

  it('the group takes one turn at +2 while all three stand', () => {
    const rng = dice(1, 6, 3, 3);
    const { combat, events } = startCombat([strong(), watch()], rng);
    expect(combat.order).toEqual(['watch', 'hero']);
    expect(attacks(events)).toHaveLength(1);
    expect(attacks(events)[0]).toMatchObject({ actor: 'watch', groupBonus: 2, attackTotal: 7, defenceTotal: 8, damage: 0 });
    allUsed(rng);
  });

  it('plays out: one turn a round, a smaller bonus as members drop, down when the pool is empty', () => {
    const rng = dice(6, 1, 2, 1, 3, 3, 1, 1, 4, 3, 3, 1, 1);
    const { combat } = startCombat([strong(), watch()], rng);
    const w = fighter(combat, 'watch');
    expect(w).toMatchObject({ hp: 12, hpMax: 12, count: 3 });

    const r1 = act(combat, { type: 'attack', target: 'watch' }, rng); // 8 against 2: 12 -> 6
    expect(nth(r1, 0)).toMatchObject({ damage: 6, hpBefore: 12, hpAfter: 6, membersLost: 1, targetDown: false });
    expect(conditionLabel(w)).toBe('2 of 3 standing');
    expect(attacks(r1).filter((e) => e.actor === 'watch')).toHaveLength(1);
    expect(nth(r1, 1)).toMatchObject({ actor: 'watch', groupBonus: 1, attackTotal: 6, damage: 0 });
    expect(kinds(r1)).toEqual(['attack', 'attack', 'round']);

    const r2 = act(combat, { type: 'attack', target: 'watch' }, rng); // 7 against 2: 6 -> 1
    expect(nth(r2, 0)).toMatchObject({ damage: 5, hpAfter: 1, membersLost: 1 });
    expect(conditionLabel(w)).toBe('1 of 3 standing');
    // The last one rolls for its nerve (a 4: it stays) and attacks with no bonus.
    expect(nth(r2, 1)).toMatchObject({ actor: 'watch', groupBonus: 0, attackTotal: 5, damage: 0 });

    const r3 = act(combat, { type: 'attack', target: 'watch' }, rng);
    expect(kinds(r3)).toEqual(['attack', 'down', 'end']);
    expect(nth(r3, 0)).toMatchObject({ hpAfter: 0, membersLost: 1, targetDown: true });
    expect(w).toMatchObject({ hp: 0, count: 0 });
    expect(conditionLabel(w)).toBe('Down');
    expect(combat.over).toBe('won');
    allUsed(rng);
  });

  it('a group down to half its members may run', () => {
    const rng = dice(6, 1, 2, 1, 2);
    const { combat } = startCombat([strong(), watch({ count: 2 })], rng);
    const events = act(combat, { type: 'attack', target: 'watch' }, rng); // 8 -> 2: one of two standing
    expect(kinds(events)).toEqual(['attack', 'flee', 'end']);
    expect(conditionLabel(fighter(combat, 'watch'))).toBe('Fled');
    expect(combat.over).toBe('won');
    allUsed(rng);
  });

  it('a group and a single opponent each take one turn', () => {
    const rng = dice(6, 1, 1, 3, 3, 3, 3);
    const { combat } = startCombat([strong(), watch(), bandit({ id: 'captain' })], rng);
    expect(combat.order).toEqual(['hero', 'captain', 'watch']);
    const events = act(combat, { type: 'defend' }, rng);
    expect(actors(events)).toEqual(['hero', 'captain', 'watch']);
    // The guard from defending holds against every attack until the player's next turn.
    expect(attacks(events).map((e) => e.guard)).toEqual([2, 2]);
    expect(attacks(events).map((e) => e.groupBonus)).toEqual([0, 2]);
    allUsed(rng);
  });
});

// ---------- the simulator ----------

describe('winChance', () => {
  const fair = () => [hero(), bandit({ strength: 2, skill: 2, armor: 1, hp: 10 })];

  it('is 1 when the opponent cannot do anything', () => {
    const p = winChance([hero({ strength: 5, skill: 5, armor: 5, hp: 25 }), bandit({ strength: 0, skill: 0, armor: 0, hp: 1 })], makeRng(1), 100);
    expect(p).toBe(1);
  });

  it('is 0 when the player cannot do anything', () => {
    const p = winChance([hero({ strength: 0, skill: 0, armor: 0, hp: 1 }), bandit({ strength: 5, skill: 5, armor: 5, hp: 25 })], makeRng(1), 100);
    expect(p).toBe(0);
  });

  it('is a number from 0 to 1, and somewhere in between for an even fight', () => {
    const p = winChance(fair(), makeRng(7));
    expect(p).toBeGreaterThan(0.2);
    expect(p).toBeLessThan(0.9);
  });

  it('gives the same answer for the same seed', () => {
    expect(winChance(fair(), makeRng(42), 200)).toBe(winChance(fair(), makeRng(42), 200));
  });

  it('does not change the fighters it was given', () => {
    const list = fair();
    const before = structuredClone(list);
    winChance(list, makeRng(3), 50);
    expect(list).toEqual(before);
  });

  it('is higher for a stronger player side', () => {
    const base = winChance(fair(), makeRng(11), 600);
    const stronger = winChance([hero({ strength: 3, skill: 3, armor: 2, hp: 15 }), nth(fair(), 1)], makeRng(11), 600);
    const weaker = winChance([hero({ strength: 1, skill: 1, armor: 0, hp: 5 }), nth(fair(), 1)], makeRng(11), 600);
    expect(stronger).toBeGreaterThan(base + 0.1);
    expect(base).toBeGreaterThan(weaker + 0.1);
  });

  it('is higher with a companion and lower against more opponents', () => {
    const base = winChance(fair(), makeRng(5), 600);
    const withAlly = winChance([...fair(), ally()], makeRng(5), 600);
    const outnumbered = winChance([...fair(), bandit({ id: 'second', strength: 2, skill: 2, armor: 1, hp: 10 })], makeRng(5), 600);
    expect(withAlly).toBeGreaterThan(base + 0.1);
    expect(base).toBeGreaterThan(outnumbered + 0.1);
  });

  it('is lower against a bigger group of the same opponents', () => {
    const one = winChance([hero(), bandit({ count: 1 })], makeRng(9), 600);
    const four = winChance([hero(), bandit({ count: 4 })], makeRng(9), 600);
    expect(one).toBeGreaterThan(four + 0.1);
  });
});

// ---------- whole fights with a seeded generator ----------

describe('several hundred whole fights', () => {
  const STYLES: TableStyle[] = ['story', 'adventure', 'brutal'];
  const KNOWN = ['featherstep', 'gale_push', 'glimmer'];

  function randomParty(rng: Rng): NewCombatant[] {
    const between = (lo: number, hi: number) => lo + pick(rng, hi - lo + 1);
    const oneIn = (n: number) => pick(rng, n) === 0;
    const heroMax = 5 * between(1, 5);
    const party: NewCombatant[] = [{
      id: 'hero', name: 'Hero', side: 'you', isProtagonist: true,
      strength: between(0, 5), skill: between(1, 5), armor: between(0, 5), firepower: between(0, 5),
      ranged: oneIn(4), quick: oneIn(3), hp: between(1, heroMax), hpMax: heroMax,
      energy: between(0, heroMax), abilities: [...KNOWN],
    }];
    const companions = between(0, 2);
    for (let i = 0; i < companions; i++) {
      const max = between(1, 15);
      party.push({
        id: `ally${i}`, name: `Ally ${i}`, side: 'you', strength: between(0, 4), skill: between(0, 4), armor: between(0, 3),
        firepower: between(0, 3), ranged: oneIn(4), quick: oneIn(4), hp: between(1, max), hpMax: max,
      });
    }
    const foes = between(1, 3);
    for (let i = 0; i < foes; i++) {
      party.push({
        id: `foe${i}`, name: `Foe ${i}`, side: 'foe', strength: between(0, 4), skill: between(0, 4), armor: between(0, 3),
        firepower: between(0, 3), ranged: oneIn(4), quick: oneIn(4), hp: between(1, 8), count: between(1, 5),
      });
    }
    if (oneIn(4)) party.push({ id: 'bystander', name: 'Bystander', side: oneIn(2) ? 'you' : 'foe', fights: false, strength: 0, skill: 0, armor: 0, hp: 3 });
    return party;
  }

  interface Tally {
    results: Record<CombatResult, number>;
    destiny: number;
    membersLost: number;
    foesFled: number;
    skips: number;
    longest: number;
  }

  /** Plays one fight to the end and checks every invariant after every step. Throws with the seed on a violation. */
  function playOut(seed: number, policy: 'attack' | 'mixed', tally: Tally): void {
    const rng = makeRng(seed);
    const party = randomParty(rng);
    const tag = `seed ${seed} (${policy})`;
    const gone = new Set<string>(); // down or fled
    const log: CombatEvent[] = [];
    let rounds = 0; // the first event after initiative announces round 1

    const { combat, events } = startCombat(party, rng);
    const heroOf = () => fighter(combat, 'hero');
    const bystanderHp = combat.fighters['bystander']?.hp;

    const checkState = (where: string): void => {
      for (const f of Object.values(combat.fighters)) {
        const at = `${tag}, ${where}: ${f.id}`;
        must(Number.isInteger(f.hp) && f.hp >= 0 && f.hp <= f.hpMax, `${at} has ${f.hp} of ${f.hpMax} hit points`);
        const members = f.hp <= 0 ? 0 : Math.ceil(f.hp / f.hpEach);
        must(f.count === members, `${at} counts ${f.count} members with a pool of ${f.hp} at ${f.hpEach} each`);
        must(f.count <= f.countMax, `${at} has more members than it started with`);
        must(f.hpMax === f.hpEach * f.countMax, `${at} maximum changed`);
        must(f.energy === undefined || f.energy >= 0, `${at} has negative energy`);
        must(f.guard >= 0 && f.dazzled >= 0, `${at} has a negative guard or dazzle`);
        if (!f.fights) must(f.hp === bystanderHp && !f.fled, `${at} was touched although not fighting`);
        must(!combat.order.includes(f.id) === !f.fights, `${at} is wrongly in or out of the turn order`);
      }
      must(combat.turn >= 0 && combat.turn <= combat.order.length, `${tag}, ${where}: turn index ${combat.turn}`);
      if (combat.over) {
        must(combat.awaiting === null, `${tag}, ${where}: over but still awaiting ${combat.awaiting}`);
      } else if (combat.awaiting === 'action') {
        must(isUp(heroOf()), `${tag}, ${where}: asked a protagonist who is not up for an action`);
        must(combat.order[combat.turn] === 'hero', `${tag}, ${where}: awaiting the player on someone else's turn`);
      } else {
        must(combat.awaiting === 'down', `${tag}, ${where}: not over and awaiting nothing`);
        must(heroOf().hp === 0, `${tag}, ${where}: awaiting the down choice with hit points left`);
      }
    };

    const scan = (list: CombatEvent[], where: string): void => {
      for (const e of list) {
        const at = `${tag}, ${where}, ${e.type}`;
        must(!log.some((x) => x.type === 'end'), `${at}: an event after the end`);
        log.push(e);
        if (e.type === 'round') {
          must(e.round === rounds + 1, `${at}: round ${e.round} after round ${rounds}`);
          rounds = e.round;
          continue;
        }
        if (e.type === 'initiative' || e.type === 'end') continue;
        if (e.type === 'down') {
          gone.add(e.who);
          continue;
        }
        must(e.round === rounds, `${at}: stamped round ${e.round} during round ${rounds}`);
        must(!gone.has(e.actor), `${at}: ${e.actor} acted while down or fled`);
        must(fighter(combat, e.actor).fights, `${at}: ${e.actor} acted without fighting`);
        if (e.type === 'attack') {
          const a = fighter(combat, e.actor);
          const t = fighter(combat, e.target);
          must(!gone.has(e.target), `${at}: ${e.target} was attacked while down or fled`);
          must(t.fights && a.side !== t.side, `${at}: ${e.actor} attacked ${e.target}`);
          must(e.attackDie >= 1 && e.attackDie <= 6 && e.defenceDie >= 1 && e.defenceDie <= 6, `${at}: dice out of range`);
          const base = a.ranged ? a.firepower : a.strength;
          must(e.critAttack === (e.attackDie === 6) && e.power === (e.critAttack ? 2 * base : base), `${at}: attack power ${e.power}`);
          must(e.critDefence === (e.defenceDie === 6) && e.armor === (e.critDefence ? 2 * t.armor : t.armor), `${at}: armor ${e.armor}`);
          must(e.groupBonus >= 0 && e.groupBonus <= 2, `${at}: group bonus ${e.groupBonus}`);
          must(e.attackTotal === Math.max(0, e.power + a.skill + e.attackDie + e.groupBonus - e.penalty), `${at}: attack total ${e.attackTotal}`);
          must(e.defenceTotal === e.armor + t.skill + e.defenceDie + e.guard, `${at}: defence total ${e.defenceTotal}`);
          must(e.damage === Math.max(0, e.attackTotal - e.defenceTotal), `${at}: damage ${e.damage}`);
          must(e.hpAfter === Math.max(0, e.hpBefore - e.damage), `${at}: hit points ${e.hpBefore} -> ${e.hpAfter}`);
          must(e.targetDown === (e.hpAfter === 0), `${at}: targetDown`);
          tally.membersLost += t.countMax > 1 ? e.membersLost : 0;
          if (e.targetDown) gone.add(e.target);
        } else if (e.type === 'flee') {
          if (e.success) gone.add(e.actor);
          if (e.success && e.actor !== 'hero') tally.foesFled += 1;
        } else if (e.type === 'skip') {
          tally.skips += 1;
        }
      }
    };

    scan(events, 'start');
    checkState('start');

    let destinyLeft = 2;
    let steps = 0;
    while (!combat.over) {
      steps += 1;
      must(steps <= 3000, `${tag}: the fight did not end`);
      const where = `step ${steps}`;
      if (combat.awaiting === 'down') {
        if (destinyLeft > 0 && pick(rng, 2) === 0) {
          destinyLeft -= 1;
          tally.destiny += 1;
          const r = resolveDown(combat, 'destiny', { resistance: 2, style: 'adventure', softenAvailable: true }, rng);
          must(r.outcome === 'back_up' && r.die === null, `${tag}, ${where}: destiny gave ${r.outcome}`);
          gone.delete('hero');
          scan(r.events, where);
        } else {
          const style = nth(STYLES, pick(rng, 3));
          const resistance = pick(rng, 6);
          const softenAvailable = pick(rng, 2) === 0;
          const r = resolveDown(combat, 'test', { resistance, style, softenAvailable }, rng);
          scan(r.events, where);
          must(r.outcome !== 'back_up', `${tag}, ${where}: the death test put the protagonist back up`);
          if (style === 'story') must(r.outcome === 'defeated' && r.die === null, `${tag}, ${where}: story style gave ${r.outcome}`);
          else {
            must(r.die !== null && r.die >= 1 && r.die <= 6, `${tag}, ${where}: death test die ${r.die}`);
            const passed = r.die !== 6 && r.die <= resistance;
            const softened = !passed && style === 'adventure' && softenAvailable;
            must(r.softened === softened, `${tag}, ${where}: softened ${r.softened}`);
            must(r.outcome === (passed || softened ? 'defeated' : 'dead'), `${tag}, ${where}: ${style} death test gave ${r.outcome}`);
          }
          must(combat.over === 'lost', `${tag}, ${where}: the death test did not end the fight`);
        }
      } else {
        const foes = Object.values(combat.fighters).filter((f) => f.side === 'foe' && isUp(f));
        const target = foes[pick(rng, foes.length)];
        must(target !== undefined, `${tag}, ${where}: no opponent is up but the fight goes on`);
        const attack: CombatAction = { type: 'attack', target: target.id };
        let action: CombatAction = attack;
        const n = pick(rng, 100);
        if (steps > 150) action = { type: 'flee' }; // a stalemate: nobody can hurt anybody
        else if (policy === 'mixed') {
          if (n < 55) action = attack;
          else if (n < 65) action = { type: 'defend' };
          else if (n < 73) action = { type: 'item', item: 'Salve', heal: 1 + pick(rng, 6) };
          else if (n < 92) {
            const energy = heroOf().energy ?? 0;
            // What there is energy for; and nobody is made to lose an action twice running, so that is not tried.
            const usable = KNOWN.filter((id) => (ABILITIES[id]?.cost ?? 99) <= energy && (ABILITIES[id]?.combat?.type !== 'stagger' || canStagger(target)));
            const id = usable[pick(rng, usable.length)];
            if (id) action = { type: 'ability', ability: id, target: target.id };
          } else action = { type: 'flee' };
        }
        scan(act(combat, action, rng), where);
      }
      checkState(where);
    }

    // How it ended.
    const last = log[log.length - 1];
    must(last !== undefined && last.type === 'end' && last.result === combat.over, `${tag}: the last event is not the end`);
    must(log.filter((e) => e.type === 'end').length === 1, `${tag}: more than one end`);
    const foesUp = Object.values(combat.fighters).filter((f) => f.side === 'foe' && isUp(f)).length;
    if (combat.over === 'won') must(foesUp === 0 && heroOf().hp > 0, `${tag}: won with ${foesUp} opponents up`);
    if (combat.over === 'lost') must(heroOf().hp === 0 && foesUp > 0, `${tag}: lost with the protagonist standing or no opponent left`);
    if (combat.over === 'fled') {
      const flee = log[log.length - 2];
      must(flee !== undefined && flee.type === 'flee' && flee.actor === 'hero' && flee.success, `${tag}: fled without a successful flee`);
      must(flee.die !== null && flee.die !== 6 && flee.die <= heroOf().skill, `${tag}: fled on a die of ${flee.die}`);
    }
    expect(() => act(combat, { type: 'defend' }, rng)).toThrow();
    tally.results[combat.over] += 1;
    tally.longest = Math.max(tally.longest, steps);
  }

  const newTally = (): Tally => ({ results: { won: 0, lost: 0, fled: 0 }, destiny: 0, membersLost: 0, foesFled: 0, skips: 0, longest: 0 });

  it('400 fights with a player who tries everything: each ends, and every invariant holds at every step', () => {
    const tally = newTally();
    for (let seed = 1; seed <= 400; seed++) playOut(seed, 'mixed', tally);
    // The run must actually have exercised the interesting paths.
    expect(tally.results.won).toBeGreaterThan(20);
    expect(tally.results.lost).toBeGreaterThan(20);
    expect(tally.results.fled).toBeGreaterThan(20);
    expect(tally.destiny).toBeGreaterThan(20);
    expect(tally.membersLost).toBeGreaterThan(50);
    expect(tally.foesFled).toBeGreaterThan(5);
    expect(tally.skips).toBeGreaterThan(20);
  });

  it('300 fights with a player who only attacks', () => {
    const tally = newTally();
    for (let seed = 1001; seed <= 1300; seed++) playOut(seed, 'attack', tally);
    expect(tally.results.won).toBeGreaterThan(50);
    expect(tally.results.lost).toBeGreaterThan(20);
    expect(tally.membersLost).toBeGreaterThan(50);
  });

  it('winChance is always a number from 0 to 1, and never drops when the protagonist gets much stronger', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const party = randomParty(makeRng(seed));
      const p = winChance(party, makeRng(seed), 150);
      expect(Number.isFinite(p), `seed ${seed}`).toBe(true);
      expect(p, `seed ${seed}`).toBeGreaterThanOrEqual(0);
      expect(p, `seed ${seed}`).toBeLessThanOrEqual(1);
      const boosted = party.map((f) => f.isProtagonist
        ? { ...f, strength: f.strength + 3, firepower: (f.firepower ?? 0) + 3, skill: f.skill + 3, armor: f.armor + 3, hp: 2 * (f.hpMax ?? f.hp), hpMax: 2 * (f.hpMax ?? f.hp) }
        : f);
      const q = winChance(boosted, makeRng(seed), 150);
      expect(q, `seed ${seed}: ${p} -> ${q}`).toBeGreaterThanOrEqual(p - 0.05);
      if (p > 0.05 && p < 0.8) expect(q, `seed ${seed}: ${p} -> ${q}`).toBeGreaterThan(p);
    }
  });
});
