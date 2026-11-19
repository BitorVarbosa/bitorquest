// Combat, resolved entirely by code, round by round.
//
// Attack  = Strength (or Firepower) + Skill + a die.   A 6 on the die doubles Strength / Firepower.
// Defence = Armor + Skill + a die.                     A 6 on the die doubles Armor.
// Damage  = attack - defence, if positive.
//
// Many opponents: identical minor opponents fight as ONE group ("3 watchmen"): one turn, one roll,
// +1 to the attack per extra member (at most +2). Damage comes off a shared pool and members drop as
// it empties. A fight with ten opponents is therefore still three or four turns per round, which
// keeps the screen readable and the narration (and its cost) bounded.
import { t } from '../i18n';
import { roll, pick, type Rng } from './rng';
import { ABILITIES, type CombatEffect, type Power } from './abilities';
import type { TableStyle } from './types';

export type Side = 'you' | 'foe';
export type Condition = 'Unhurt' | 'Hurt' | 'Badly hurt' | 'Down' | 'Fled';

export interface Combatant {
  id: string;
  name: string;
  side: Side;
  isProtagonist?: boolean;
  /** False for someone who is present but does not fight (they take no turn and are not attacked). */
  fights: boolean;
  strength: number;
  skill: number;
  armor: number;
  firepower: number;
  /** Attacks with Firepower instead of Strength. */
  ranged?: boolean;
  /** +1 to initiative. */
  quick?: boolean;
  /** Hit points. For a group this is the shared pool: hpEach x members. */
  hp: number;
  hpMax: number;
  /** Members still standing: 1 for an individual. */
  count: number;
  countMax: number;
  hpEach: number;
  /** Energy for abilities (the protagonist). */
  energy?: number;
  abilities?: string[];
  /** What each of those abilities costs, when it is not the ability's own cost (the Extreme mode). */
  costs?: Record<string, number>;
  /** Abilities that are not in the library, by id: the moves of a gift. Looked up before the library. */
  own?: Record<string, Power>;
  /**
   * A power of their own that someone other than the protagonist brings to a fight (a world of
   * gifts): they use it together with their attack on their first turn and on every third after it.
   */
  power?: FighterPower;
  /** Turns this combatant has taken in the fight (a turn lost to a stagger is not one). */
  turns?: number;
  // Things that last until this combatant's next turn or next attack.
  guard: number;
  staggered: boolean;
  /** Lost their last turn to a stagger and has not acted since: they cannot be staggered again until they have. */
  shaken?: boolean;
  /** Their powers are sealed for this many more of their turns: the protagonist cannot use one, and someone else's does not fire. */
  sealed?: number;
  dazzled: number;
  fled: boolean;
}

/** A power someone brings to a fight: its name, and the one thing it does there. */
export interface FighterPower {
  name: string;
  effect: CombatEffect;
}
/** Someone with a power of their own uses it on their first turn, and then on every turn that is this many after it. */
export const POWER_EVERY = 3;

export interface NewCombatant {
  id: string;
  name: string;
  side: Side;
  isProtagonist?: boolean;
  fights?: boolean;
  strength: number;
  skill: number;
  armor: number;
  firepower?: number;
  ranged?: boolean;
  quick?: boolean;
  /** Hit points of one member. */
  hp: number;
  hpMax?: number;
  /** More than 1 makes this a group. */
  count?: number;
  energy?: number;
  abilities?: string[];
  costs?: Record<string, number>;
  own?: Record<string, Power>;
  power?: FighterPower;
}

export function makeCombatant(c: NewCombatant): Combatant {
  const count = Math.max(1, c.count ?? 1);
  const hpEach = Math.max(1, c.hpMax ?? c.hp);
  return {
    id: c.id, name: c.name, side: c.side, isProtagonist: c.isProtagonist, fights: c.fights ?? true,
    strength: c.strength, skill: c.skill, armor: c.armor, firepower: c.firepower ?? 0, ranged: c.ranged, quick: c.quick,
    hp: count > 1 ? hpEach * count : c.hp, hpMax: hpEach * count, count, countMax: count, hpEach,
    energy: c.energy, abilities: c.abilities, ...(c.costs ? { costs: c.costs } : {}), ...(c.own ? { own: c.own } : {}),
    // A group has no power of its own, and neither has the protagonist here: theirs are moves, chosen by the player.
    ...(c.power && count === 1 && !c.isProtagonist ? { power: c.power } : {}),
    guard: 0, staggered: false, dazzled: 0, fled: false,
  };
}

export type CombatAction =
  | { type: 'attack'; target: string }
  | { type: 'defend' }
  | { type: 'ability'; ability: string; target?: string }
  /**
   * An effect of the player's own invention. Whoever asks for it has already settled what it costs,
   * what it would do, and whether the test for it passed: here the energy is spent, and the effect
   * applied if it worked. The turn is spent either way.
   */
  | { type: 'effect'; name: string; cost: number; effect?: CombatEffect & { needsTarget: boolean }; target?: string; worked: boolean;
    /** With no effect: what it did, in words, settled by whoever asked for it (a power copied or taken). */
    note?: string }
  | { type: 'item'; item: string; heal: number }
  | { type: 'flee' };

export interface AttackEvent {
  type: 'attack';
  round: number;
  actor: string;
  target: string;
  attackDie: number;
  defenceDie: number;
  /** Strength or Firepower, doubled on a 6. */
  power: number;
  /** Set when the attack was made at range: `power` is then Firepower. */
  ranged?: boolean;
  attackSkill: number;
  groupBonus: number;
  penalty: number;
  attackTotal: number;
  /** Armor, doubled on a 6. */
  armor: number;
  defenceSkill: number;
  guard: number;
  defenceTotal: number;
  damage: number;
  critAttack: boolean;
  critDefence: boolean;
  hpBefore: number;
  hpAfter: number;
  targetCondition: Condition;
  membersLost: number;
  targetDown: boolean;
}

export type CombatEvent =
  | { type: 'initiative'; order: { id: string; die: number; total: number }[] }
  | { type: 'round'; round: number }
  | AttackEvent
  | { type: 'defend'; round: number; actor: string }
  /** `did` is the effect as it was applied: its `value` is what actually landed (damage less a raised guard, hit points actually restored). */
  | { type: 'ability'; round: number; actor: string; ability: string; target?: string; effect: string; did?: CombatEffect; energyLeft: number }
  /** An effect of the player's own invention (the 'effect' action): `effect` is empty and `did` absent when it did not work. */
  | { type: 'effect'; round: number; actor: string; name: string; target?: string; worked: boolean; effect: string; did?: CombatEffect; energyLeft: number }
  /** Someone other than the protagonist used the power they brought to the fight, just before their attack. */
  | { type: 'power'; round: number; actor: string; name: string; target?: string; effect: string; did: CombatEffect }
  | { type: 'item'; round: number; actor: string; item: string; healed: number; hpAfter: number }
  | { type: 'flee'; round: number; actor: string; die: number | null; success: boolean }
  | { type: 'skip'; round: number; actor: string }
  | { type: 'down'; round: number; who: string }
  | { type: 'end'; result: CombatResult };

export type CombatResult = 'won' | 'lost' | 'fled';

export interface Combat {
  round: number;
  /** Ids in turn order. */
  order: string[];
  /** Index into order of whoever acts next. */
  turn: number;
  fighters: Record<string, Combatant>;
  /** 'action': waiting for the player's choice. 'down': the protagonist is at 0 hit points and must choose. */
  awaiting: 'action' | 'down' | null;
  over: CombatResult | null;
}

export function condition(c: Combatant): Condition {
  if (c.fled) return 'Fled';
  if (c.hp <= 0) return 'Down';
  if (c.hp >= c.hpMax) return 'Unhurt';
  return c.hp * 2 > c.hpMax ? 'Hurt' : 'Badly hurt';
}

export function isUp(c: Combatant): boolean {
  return c.fights && !c.fled && c.hp > 0;
}

/** "3 of 4 standing" for a group, the condition word for an individual. */
export function conditionLabel(c: Combatant): string {
  if (c.countMax > 1 && !c.fled && c.hp > 0) return `${c.count} of ${c.countMax} standing`;
  return condition(c);
}

/**
 * The same as conditionLabel, in the interface language, for the screen. conditionLabel stays English:
 * a style class is made from it and the narrator is told it.
 */
export function conditionText(c: Combatant): string {
  if (c.countMax > 1 && !c.fled && c.hp > 0) return t('{count} of {countMax} standing', { count: c.count, countMax: c.countMax });
  return t(condition(c));
}

function protagonist(combat: Combat): Combatant {
  const p = Object.values(combat.fighters).find((f) => f.isProtagonist);
  if (!p) throw new Error('combat has no protagonist');
  return p;
}

function living(combat: Combat, side: Side): Combatant[] {
  return Object.values(combat.fighters).filter((f) => f.side === side && isUp(f));
}

/** One attack. Changes the target's hit points and returns what happened. */
export function resolveAttack(round: number, attacker: Combatant, target: Combatant, rng: Rng): AttackEvent {
  const attackDie = roll(rng);
  const defenceDie = roll(rng);
  const basePower = attacker.ranged ? attacker.firepower : attacker.strength;
  const power = attackDie === 6 ? basePower * 2 : basePower;
  const groupBonus = Math.min(2, attacker.count - 1);
  const penalty = attacker.dazzled;
  const attackTotal = Math.max(0, power + attacker.skill + attackDie + groupBonus - penalty);
  const armor = defenceDie === 6 ? target.armor * 2 : target.armor;
  const defenceTotal = armor + target.skill + defenceDie + target.guard;
  const damage = Math.max(0, attackTotal - defenceTotal);
  attacker.dazzled = 0;

  const hpBefore = target.hp;
  const countBefore = target.count;
  target.hp = Math.max(0, target.hp - damage);
  target.count = target.hp <= 0 ? 0 : Math.ceil(target.hp / target.hpEach);
  return {
    type: 'attack', round, actor: attacker.id, target: target.id,
    attackDie, defenceDie, power, ...(attacker.ranged ? { ranged: true } : {}), attackSkill: attacker.skill, groupBonus, penalty, attackTotal,
    armor, defenceSkill: target.skill, guard: target.guard, defenceTotal, damage,
    critAttack: attackDie === 6, critDefence: defenceDie === 6,
    hpBefore, hpAfter: target.hp, targetCondition: condition(target),
    membersLost: countBefore - target.count, targetDown: target.hp <= 0,
  };
}

function initiative(combat: Combat, rng: Rng): CombatEvent {
  const rolls = Object.values(combat.fighters)
    .filter((f) => f.fights)
    .map((f) => {
      const die = roll(rng);
      return { id: f.id, die, total: f.skill + die + (f.quick ? 1 : 0), side: f.side, hero: !!f.isProtagonist };
    });
  // Highest first. Ties: the protagonist, then their side, then by id so the order is always the same.
  rolls.sort((a, b) => b.total - a.total || Number(b.hero) - Number(a.hero) || (a.side === b.side ? a.id.localeCompare(b.id) : a.side === 'you' ? -1 : 1));
  combat.order = rolls.map((r) => r.id);
  return { type: 'initiative', order: rolls.map(({ id, die, total }) => ({ id, die, total })) };
}

function finish(combat: Combat, result: CombatResult, events: CombatEvent[]): void {
  combat.over = result;
  combat.awaiting = null;
  events.push({ type: 'end', result });
}

function checkEnd(combat: Combat, events: CombatEvent[]): boolean {
  if (combat.over) return true;
  if (living(combat, 'foe').length === 0) { finish(combat, 'won', events); return true; }
  return false;
}

/** Who an opponent goes for: usually the protagonist, sometimes a companion. */
function foeTarget(combat: Combat, rng: Rng): Combatant | undefined {
  const hero = protagonist(combat);
  const others = living(combat, 'you').filter((f) => !f.isProtagonist);
  if (!isUp(hero)) return others[0];
  if (others.length === 0 || roll(rng) <= 4) return hero;
  return others[pick(rng, others.length)];
}

/** Who a companion goes for: the opponent closest to going down. */
function allyTarget(combat: Combat): Combatant | undefined {
  return living(combat, 'foe').sort((a, b) => a.hp / a.hpMax - b.hp / b.hpMax || a.id.localeCompare(b.id))[0];
}

/** A badly hurt opponent with nobody left beside it may run. */
function losesNerve(c: Combatant, combat: Combat, rng: Rng): boolean {
  if (c.side !== 'foe') return false;
  const alone = living(combat, 'foe').length === 1;
  const broken = c.countMax > 1 ? c.count * 2 <= c.countMax : condition(c) === 'Badly hurt';
  return broken && alone && roll(rng) <= 3;
}

/** Whether a fighter has any power a seal would stop: abilities or moves, or a power of their own. */
export function hasPowers(c: Combatant): boolean {
  return (c.abilities ?? []).length > 0 || !!c.power;
}

/** Whether someone can be made to lose their next action now: not while they are already about to, nor before they have acted again after losing one. */
export function canStagger(target: Combatant): boolean {
  return !target.staggered && !target.shaken;
}

/**
 * Apply an effect of an ability, a move or an invented use. Returns what it did, in words for the
 * narrator and as the effect with the amount that actually landed.
 */
function applyEffect(user: Combatant, effect: CombatEffect, target: Combatant | undefined): { text: string; did: CombatEffect } {
  switch (effect.type) {
    case 'guard':
      user.guard = effect.value;
      return { text: user.isProtagonist ? `+${effect.value} to defence until your next turn` : `+${effect.value} to ${user.name}’s defence until their next turn`, did: effect };
    case 'heal': {
      const before = user.hp;
      user.hp = Math.min(user.hpMax, user.hp + effect.value);
      // What was actually given back: no more than was missing.
      return { text: `${user.hp - before} hit points restored`, did: { type: 'heal', value: user.hp - before } };
    }
    case 'stagger':
      if (target) target.staggered = true;
      return { text: `${target?.name ?? 'the target'} loses the next action`, did: effect };
    case 'seal':
      if (target) target.sealed = Math.max(target.sealed ?? 0, effect.turns);
      return {
        text: target?.isProtagonist
          ? `your powers are sealed: no power can be used ${effect.turns === 1 ? 'on your next turn' : `for your next ${effect.turns} turns`}`
          : `${target?.name ?? 'the target'} cannot use a power ${effect.turns === 1 ? 'on their next turn' : `for their next ${effect.turns} turns`}`,
        did: effect,
      };
    case 'dazzle':
      if (target) target.dazzled = effect.value;
      return { text: `${target?.name ?? 'the target'} attacks at -${effect.value} next`, did: effect };
    case 'damage': {
      // No defence roll: it lands. A guard that is up takes that much off it.
      const dealt = target ? Math.max(0, effect.value - target.guard) : 0;
      if (target) {
        target.hp = Math.max(0, target.hp - dealt);
        target.count = target.hp <= 0 ? 0 : Math.ceil(target.hp / target.hpEach);
      }
      return { text: `${dealt} damage to ${target?.name ?? 'the target'}`, did: { type: 'damage', value: dealt } };
    }
  }
}

function takeTurnFor(combat: Combat, c: Combatant, rng: Rng, events: CombatEvent[]): void {
  c.guard = 0;
  if (c.staggered) {
    c.staggered = false;
    c.shaken = true;
    events.push({ type: 'skip', round: combat.round, actor: c.id });
    return;
  }
  c.shaken = false;
  if (losesNerve(c, combat, rng)) {
    c.fled = true;
    events.push({ type: 'flee', round: combat.round, actor: c.id, die: null, success: true });
    return;
  }
  const target = c.side === 'foe' ? foeTarget(combat, rng) : allyTarget(combat);
  if (!target) return;
  c.turns = (c.turns ?? 0) + 1;
  // A power of their own, on the first turn and every third after it, and then the attack as usual.
  // Sealed, it does not fire, and the count goes down.
  const sealedNow = (c.sealed ?? 0) > 0;
  if (sealedNow) c.sealed = (c.sealed ?? 0) - 1;
  if (c.power && !sealedNow && (c.turns - 1) % POWER_EVERY === 0) {
    const effect = c.power.effect;
    // A seal is aimed at the protagonist, the one whose powers it stops, when they are standing.
    const hero = Object.values(combat.fighters).find((f) => f.isProtagonist);
    const aim = effect.type === 'seal' && hero && isUp(hero) ? hero : target;
    // Someone who cannot be made to lose another action yet is not, and someone with no power to seal is not sealed: the power does nothing this time.
    if ((effect.type !== 'stagger' || canStagger(aim)) && (effect.type !== 'seal' || hasPowers(aim))) {
      const { text, did } = applyEffect(c, effect, aim);
      const aimed = effect.type !== 'guard' && effect.type !== 'heal';
      events.push({ type: 'power', round: combat.round, actor: c.id, name: c.power.name, ...(aimed ? { target: aim.id } : {}), effect: text, did });
      if (aim.hp <= 0) { events.push({ type: 'down', round: combat.round, who: aim.id }); return; }
      // Taking someone's next action from them, or their powers, is the whole of that turn: no blow
      // goes with it. (With one, a stagger cost the other side a third of their actions for nothing
      // given up, and a seal took twenty points off the weakest hero's chances; see the balance test.)
      if (effect.type === 'stagger' || effect.type === 'seal') return;
    }
  }
  const hit = resolveAttack(combat.round, c, target, rng);
  events.push(hit);
  if (hit.targetDown) events.push({ type: 'down', round: combat.round, who: target.id });
}

/** Run everyone's turns until it is the player's turn again, the protagonist drops, or the fight ends. */
function runUntilPlayer(combat: Combat, rng: Rng, events: CombatEvent[]): void {
  for (let guard = 0; guard < 500; guard++) {
    if (checkEnd(combat, events)) return;
    const hero = protagonist(combat);
    if (hero.hp <= 0) { combat.awaiting = 'down'; return; }
    if (combat.turn >= combat.order.length) {
      combat.turn = 0;
      combat.round += 1;
      events.push({ type: 'round', round: combat.round });
    }
    const id = combat.order[combat.turn];
    const c = id ? combat.fighters[id] : undefined;
    if (!c || !isUp(c)) { combat.turn += 1; continue; }
    if (c.isProtagonist) {
      c.guard = 0;
      if (c.staggered) {
        c.staggered = false;
        c.shaken = true;
        if ((c.sealed ?? 0) > 0) c.sealed = (c.sealed ?? 0) - 1;
        events.push({ type: 'skip', round: combat.round, actor: c.id });
        combat.turn += 1;
        continue;
      }
      c.shaken = false;
      combat.awaiting = 'action';
      return;
    }
    takeTurnFor(combat, c, rng, events);
    combat.turn += 1;
  }
  throw new Error('combat did not settle');
}

export function startCombat(fighters: NewCombatant[] | Combatant[], rng: Rng): { combat: Combat; events: CombatEvent[] } {
  const list = fighters.map((f) => ('guard' in f ? f : makeCombatant(f)));
  const combat: Combat = { round: 1, order: [], turn: 0, fighters: Object.fromEntries(list.map((f) => [f.id, f])), awaiting: null, over: null };
  const events: CombatEvent[] = [initiative(combat, rng), { type: 'round', round: 1 }];
  runUntilPlayer(combat, rng, events);
  return { combat, events };
}

/** The player's action for this turn, then everyone else until the player is up again. */
export function act(combat: Combat, action: CombatAction, rng: Rng): CombatEvent[] {
  if (combat.over || combat.awaiting !== 'action') throw new Error('it is not the player’s turn');
  const events: CombatEvent[] = [];
  const hero = protagonist(combat);
  const round = combat.round;

  // An action that cannot be taken throws before anything changes, so the player can choose again.
  if (action.type === 'attack') {
    const target = combat.fighters[action.target];
    if (!target || target.side !== 'foe' || !isUp(target)) throw new Error('that target cannot be attacked');
    const hit = resolveAttack(round, hero, target, rng);
    events.push(hit);
    if (hit.targetDown) events.push({ type: 'down', round, who: target.id });
  } else if (action.type === 'defend') {
    hero.guard = 2;
    events.push({ type: 'defend', round, actor: hero.id });
  } else if (action.type === 'ability' || action.type === 'effect') {
    if ((hero.sealed ?? 0) > 0) throw new Error('your powers are sealed for now');
    // An ability of the library, a move of the character's own, or an effect invented on the spot.
    const ability = action.type === 'ability' ? hero.own?.[action.ability] ?? ABILITIES[action.ability] : undefined;
    const effect = action.type === 'ability' ? ability?.combat : action.effect;
    if (action.type === 'ability' && (!ability || !(hero.abilities ?? []).includes(ability.id))) throw new Error('that ability cannot be used in a fight');
    // An ability must do something here; an invented use with no effect of its own (a power copied or taken) is settled by the caller.
    if (action.type === 'ability' && !effect) throw new Error('that ability cannot be used in a fight');
    const cost = action.type === 'ability' ? hero.costs?.[ability!.id] ?? ability!.cost : action.cost;
    if ((hero.energy ?? 0) < cost) throw new Error('not enough energy');
    const target = action.target ? combat.fighters[action.target] : undefined;
    if (effect?.needsTarget && (!target || !isUp(target))) throw new Error('that ability needs a target');
    if (effect?.type === 'stagger' && target && !canStagger(target)) throw new Error('that target cannot lose another action so soon');
    hero.energy = (hero.energy ?? 0) - cost;
    if (action.type === 'ability') {
      const { text, did } = applyEffect(hero, effect!, target);
      events.push({ type: 'ability', round, actor: hero.id, ability: ability!.id, target: target?.id, effect: text, did, energyLeft: hero.energy });
    } else if (action.worked && effect) {
      const { text, did } = applyEffect(hero, effect, target);
      events.push({ type: 'effect', round, actor: hero.id, name: action.name, target: target?.id, worked: true, effect: text, did, energyLeft: hero.energy });
    } else if (action.worked) {
      events.push({ type: 'effect', round, actor: hero.id, name: action.name, target: target?.id, worked: true, effect: action.note ?? '', energyLeft: hero.energy });
    } else {
      events.push({ type: 'effect', round, actor: hero.id, name: action.name, target: target?.id, worked: false, effect: '', energyLeft: hero.energy });
    }
    if (target && target.hp <= 0) events.push({ type: 'down', round, who: target.id });
  } else if (action.type === 'item') {
    const before = hero.hp;
    hero.hp = Math.min(hero.hpMax, hero.hp + action.heal);
    events.push({ type: 'item', round, actor: hero.id, item: action.item, healed: hero.hp - before, hpAfter: hero.hp });
  } else {
    // Getting away: a die at or under Skill. A 6 always fails.
    const die = roll(rng);
    const success = die !== 6 && die <= hero.skill;
    events.push({ type: 'flee', round, actor: hero.id, die, success });
    if (success) { finish(combat, 'fled', events); return events; }
  }

  // A turn taken while sealed uses up one of the turns the seal lasts.
  if ((hero.sealed ?? 0) > 0) hero.sealed = (hero.sealed ?? 0) - 1;
  combat.awaiting = null;
  combat.turn += 1;
  runUntilPlayer(combat, rng, events);
  return events;
}

export type DownChoice = 'destiny' | 'test';
export type DownOutcome = 'back_up' | 'defeated' | 'dead';

/**
 * The protagonist is at 0 hit points.
 *  - 'destiny': spend a destiny point, get up with 5 hit points, the fight goes on. (The caller checks and spends the point.)
 *  - 'test': the death test, one die at or under Resistance (a 6 fails). The fight ends for the protagonist either way.
 *      Story style: never death; always 'defeated' (a setback).
 *      Adventure: death on a failed test, softened to 'defeated' if `softenAvailable` (once per chapter).
 *      Brutal: death on a failed test.
 */
export function resolveDown(
  combat: Combat, choice: DownChoice, opts: { resistance: number; style: TableStyle; softenAvailable: boolean }, rng: Rng,
): { outcome: DownOutcome; die: number | null; softened: boolean; events: CombatEvent[] } {
  if (combat.awaiting !== 'down') throw new Error('nobody is down');
  const events: CombatEvent[] = [];
  const hero = protagonist(combat);
  if (choice === 'destiny') {
    hero.hp = Math.min(hero.hpMax, 5);
    // Dropping to 0 set the member count to 0; standing again makes it 1 (otherwise the next attack is at -1).
    hero.count = Math.ceil(hero.hp / hero.hpEach);
    combat.awaiting = null;
    // The protagonist keeps their place in the order; play resumes with whoever is next.
    combat.turn += 0;
    runUntilPlayer(combat, rng, events);
    return { outcome: 'back_up', die: null, softened: false, events };
  }
  if (opts.style === 'story') {
    finish(combat, 'lost', events);
    return { outcome: 'defeated', die: null, softened: false, events };
  }
  const die = roll(rng);
  const passed = die !== 6 && die <= opts.resistance;
  finish(combat, 'lost', events);
  if (passed) return { outcome: 'defeated', die, softened: false, events };
  if (opts.style === 'adventure' && opts.softenAvailable) return { outcome: 'defeated', die, softened: true, events };
  return { outcome: 'dead', die, softened: false, events };
}

/** The hardest-hitting power the protagonist can pay for right now, if they have one that does damage. */
function bestStrike(hero: Combatant): { id: string; value: number } | null {
  if ((hero.sealed ?? 0) > 0) return null;
  let best: { id: string; value: number; cost: number } | null = null;
  for (const id of hero.abilities ?? []) {
    const ability = hero.own?.[id] ?? ABILITIES[id];
    const effect = ability?.combat;
    if (!ability || effect?.type !== 'damage') continue;
    const cost = hero.costs?.[id] ?? ability.cost;
    if ((hero.energy ?? 0) < cost) continue;
    if (!best || effect.value > best.value || (effect.value === best.value && cost < best.cost)) best = { id, value: effect.value, cost };
  }
  return best;
}

/**
 * How likely the player's side is to win, found by playing the fight many times with a plain policy:
 * go for the opponent closest to going down, with the hardest-hitting power there is energy for, and
 * with a plain attack when there is none. No destiny points. Milliseconds, no tokens. Used to tune an
 * encounter to the table style before the narrator describes anything. (Counting the protagonist's
 * powers matters: a fight judged as if they only swung a blade is thinned far more than it needs.)
 */
export function winChance(fighters: NewCombatant[], rng: Rng, runs = 400): number {
  let wins = 0;
  for (let i = 0; i < runs; i++) {
    const { combat } = startCombat(fighters.map(makeCombatant), rng);
    for (let turns = 0; turns < 200 && !combat.over; turns++) {
      if (combat.awaiting === 'down') { combat.over = 'lost'; break; }
      const target = allyTarget(combat);
      if (!target) break;
      const strike = bestStrike(protagonist(combat));
      act(combat, strike ? { type: 'ability', ability: strike.id, target: target.id } : { type: 'attack', target: target.id }, rng);
    }
    if (combat.over === 'won') wins += 1;
  }
  return wins / runs;
}
