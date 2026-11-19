// Dice, hit points and energy, game time, the character sheet, abilities. docs/PLAN.md 10.1 and 10.9.
import { describe, expect, it } from 'vitest';
import { ABILITIES, abilityById, canUseAbility } from '../src/engine/abilities';
import * as engine from '../src/engine/index';
import { d6, fixedDice, makeRng, nextFloat, pick, roll } from '../src/engine/rng';
import {
  POWER_LEVELS, SKILL_COST, XP_PER_LEVEL, XP_TO_LEARN, canRaiseAttribute, canRaisePath, pointsSpent, raiseAttribute, raisePath, rest,
  sceneExperience,
} from '../src/engine/sheet';
import { addMinutes, clockLabel, durationLabel, minutesBetween, slotOf } from '../src/engine/time';
import { ATTRIBUTES, PATHS, SKILLS, maxEnergy, maxHp, type Sheet } from '../src/engine/types';

function sheet(over: Partial<Sheet> = {}): Sheet {
  return {
    strength: 2, skill: 3, resistance: 2, armor: 1, firepower: 0, hp: 10, energy: 10,
    paths: {}, skills: [], advantages: [], disadvantages: [], abilities: [], ...over,
  };
}

// ---------- dice ----------

describe('the seeded generator', () => {
  it('gives the same rolls for the same seed', () => {
    const a = makeRng(123);
    const b = makeRng(123);
    const first = Array.from({ length: 50 }, () => d6(a));
    const second = Array.from({ length: 50 }, () => d6(b));
    expect(first).toEqual(second);
  });

  it('gives different rolls for different seeds', () => {
    const a = makeRng(1);
    const b = makeRng(2);
    const first = Array.from({ length: 50 }, () => d6(a));
    const second = Array.from({ length: 50 }, () => d6(b));
    expect(first).not.toEqual(second);
  });

  it('can be saved and resumed from its one number', () => {
    const a = makeRng(99);
    for (let i = 0; i < 10; i++) d6(a);
    const resumed = { state: a.state };
    expect(Array.from({ length: 20 }, () => d6(resumed))).toEqual(Array.from({ length: 20 }, () => d6(a)));
  });

  it('keeps its state a whole number from 0 to 2^32 - 1, whatever the seed', () => {
    for (const seed of [0, 1, -1, 2 ** 32, 2 ** 32 + 5, 3.7, -123456789]) {
      const rng = makeRng(seed);
      for (let i = 0; i < 20; i++) {
        expect(Number.isInteger(rng.state)).toBe(true);
        expect(rng.state).toBeGreaterThanOrEqual(0);
        expect(rng.state).toBeLessThan(2 ** 32);
        const x = nextFloat(rng);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(1);
      }
    }
  });

  it('rolls only 1 to 6, every face, about evenly', () => {
    const rng = makeRng(2024);
    const seen = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 12000; i++) {
      const face = d6(rng);
      expect(Number.isInteger(face) && face >= 1 && face <= 6).toBe(true);
      seen[face] = (seen[face] ?? 0) + 1;
    }
    expect(seen[0]).toBe(0);
    for (let face = 1; face <= 6; face++) {
      expect(seen[face]).toBeGreaterThan(1800);
      expect(seen[face]).toBeLessThan(2200);
    }
  });

  it('pick gives a whole number from 0 to n - 1, and reaches every one', () => {
    const rng = makeRng(5);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const x = pick(rng, 4);
      expect(Number.isInteger(x) && x >= 0 && x <= 3).toBe(true);
      seen.add(x);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
    expect(pick(rng, 1)).toBe(0);
  });

  it('roll with a seeded generator is the same die as d6', () => {
    const a = makeRng(77);
    const b = makeRng(77);
    expect(Array.from({ length: 30 }, () => roll(a))).toEqual(Array.from({ length: 30 }, () => d6(b)));
  });
});

describe('fixed dice', () => {
  it('returns the given faces in order, then repeats the last one', () => {
    const rng = fixedDice(3, 6, 1);
    expect([roll(rng), roll(rng), roll(rng), roll(rng), roll(rng)]).toEqual([3, 6, 1, 1, 1]);
  });

  it('a single face repeats for ever', () => {
    const rng = fixedDice(4);
    expect([roll(rng), roll(rng), roll(rng)]).toEqual([4, 4, 4]);
  });

  it('does not use up the array it was given', () => {
    const faces = [2, 5];
    const rng = fixedDice(...faces);
    roll(rng);
    roll(rng);
    expect(faces).toEqual([2, 5]);
  });

  it('shows the faces not yet rolled', () => {
    const rng = fixedDice(1, 2, 3);
    roll(rng);
    expect(rng.faces).toEqual([2, 3]);
  });
});

// ---------- hit points and energy ----------

describe('hit points and energy', () => {
  it.each([[1, 5], [2, 10], [3, 15], [4, 20], [5, 25]])('Resistance %i gives a maximum of %i for both', (resistance, max) => {
    expect(maxHp({ resistance })).toBe(max);
    expect(maxEnergy({ resistance })).toBe(max);
  });

  // 5 x 0 is 0, which would leave an ordinary person down before anything happens.
  // The engine gives at least 1 (types.ts says so). Listed as a question in the report.
  it('Resistance 0 gives 1, not 0', () => {
    expect(maxHp({ resistance: 0 })).toBe(1);
    expect(maxEnergy({ resistance: 0 })).toBe(1);
  });

  it('there are five attributes, six paths and eleven skills', () => {
    expect([...ATTRIBUTES]).toEqual(['strength', 'skill', 'resistance', 'armor', 'firepower']);
    expect(PATHS).toHaveLength(6);
    expect(SKILLS).toHaveLength(11);
    expect(new Set(SKILLS).size).toBe(11);
  });
});

// ---------- game time ----------

describe('the clock', () => {
  it('adds minutes within a day', () => {
    expect(addMinutes({ day: 3, minute: 600 }, 45)).toEqual({ day: 3, minute: 645 });
  });

  it('rolls over at midnight', () => {
    expect(addMinutes({ day: 3, minute: 1430 }, 9)).toEqual({ day: 3, minute: 1439 });
    expect(addMinutes({ day: 3, minute: 1430 }, 10)).toEqual({ day: 4, minute: 0 });
    expect(addMinutes({ day: 3, minute: 1430 }, 20)).toEqual({ day: 4, minute: 10 });
  });

  it('crosses several days at once', () => {
    expect(addMinutes({ day: 1, minute: 0 }, 3 * 1440 + 61)).toEqual({ day: 4, minute: 61 });
  });

  it('adding nothing changes nothing, and the clock given is not changed', () => {
    const clock = { day: 2, minute: 100 };
    expect(addMinutes(clock, 0)).toEqual({ day: 2, minute: 100 });
    addMinutes(clock, 500);
    expect(clock).toEqual({ day: 2, minute: 100 });
  });

  it('never runs backwards', () => {
    expect(addMinutes({ day: 2, minute: 100 }, -30)).toEqual({ day: 2, minute: 100 });
  });

  it('keeps whole minutes', () => {
    expect(addMinutes({ day: 1, minute: 0 }, 2.4)).toEqual({ day: 1, minute: 2 });
    expect(addMinutes({ day: 1, minute: 0 }, 2.6)).toEqual({ day: 1, minute: 3 });
  });

  it('keeps the minute between 0 and 1439 for any step', () => {
    let clock = { day: 1, minute: 0 };
    for (let i = 0; i < 400; i++) {
      const next = addMinutes(clock, 37 * (i % 50));
      expect(next.minute).toBeGreaterThanOrEqual(0);
      expect(next.minute).toBeLessThanOrEqual(1439);
      expect(minutesBetween(clock, next)).toBe(37 * (i % 50));
      clock = next;
    }
  });

  it('measures the minutes between two moments', () => {
    expect(minutesBetween({ day: 1, minute: 600 }, { day: 1, minute: 660 })).toBe(60);
    expect(minutesBetween({ day: 1, minute: 1400 }, { day: 2, minute: 20 })).toBe(60);
    expect(minutesBetween({ day: 1, minute: 0 }, { day: 3, minute: 0 })).toBe(2880);
    expect(minutesBetween({ day: 2, minute: 20 }, { day: 1, minute: 1400 })).toBe(-60);
    expect(minutesBetween({ day: 5, minute: 5 }, { day: 5, minute: 5 })).toBe(0);
  });

  // The specification does not give the hours of each part of the day; these follow the engine.
  it.each([
    [0, 'Night'], [299, 'Night'],
    [300, 'Dawn'], [419, 'Dawn'],
    [420, 'Morning'], [659, 'Morning'],
    [660, 'Midday'], [839, 'Midday'],
    [840, 'Afternoon'], [1049, 'Afternoon'],
    [1050, 'Dusk'], [1169, 'Dusk'],
    [1170, 'Evening'], [1319, 'Evening'],
    [1320, 'Night'], [1439, 'Night'],
  ] as const)('minute %i is %s', (minute, slot) => {
    expect(slotOf({ day: 1, minute })).toBe(slot);
  });

  it('labels the day and the part of the day', () => {
    expect(clockLabel({ day: 12, minute: 18 * 60 })).toBe('Day 12 · Dusk');
    expect(clockLabel({ day: 1, minute: 8 * 60 })).toBe('Day 1 · Morning');
  });

  it.each([
    [0, '0 minutes'],
    [1, '1 minute'],
    [10, '10 minutes'],
    [59, '59 minutes'],
    [60, '1 hour'],
    [120, '2 hours'],
    [600, '10 hours'],
    [1440, '1 day'],
    [2880, '2 days'],
  ])('%i minutes reads "%s"', (minutes, label) => {
    expect(durationLabel(minutes)).toBe(label);
  });
});

// ---------- the character sheet ----------

describe('creating a character', () => {
  it('starting power levels: 5, 7, 10 and 12 points; disadvantages give back at most 3, 4, 5 and 6', () => {
    expect(POWER_LEVELS).toEqual({
      novice: { points: 5, disadvantages: 3 },
      seasoned: { points: 7, disadvantages: 4 },
      champion: { points: 10, disadvantages: 5 },
      legend: { points: 12, disadvantages: 6 },
    });
  });

  it('an attribute or a path level costs 1, a skill costs 2, an advantage its own cost', () => {
    const cost = (name: string) => (name === 'Quick Reflexes' ? 2 : 1);
    expect(SKILL_COST).toBe(2);
    expect(pointsSpent(sheet({ strength: 0, skill: 0, resistance: 0, armor: 0, firepower: 0 }), cost)).toBe(0);
    expect(pointsSpent(sheet({ strength: 1, skill: 2, resistance: 3, armor: 4, firepower: 5 }), cost)).toBe(15);
    expect(pointsSpent(sheet({ strength: 0, skill: 0, resistance: 0, armor: 0, firepower: 0, paths: { air: 2, light: 1 } }), cost)).toBe(3);
    expect(pointsSpent(sheet({ strength: 0, skill: 0, resistance: 0, armor: 0, firepower: 0, skills: ['Crime', 'Arts'] }), cost)).toBe(4);
    expect(pointsSpent(sheet({ strength: 0, skill: 0, resistance: 0, armor: 0, firepower: 0, advantages: ['Quick Reflexes', 'Keen Eye'] }), cost)).toBe(3);
  });

  it('adds everything up', () => {
    const s = sheet({
      strength: 1, skill: 2, resistance: 1, armor: 0, firepower: 0, paths: { air: 1 }, skills: ['Crime'],
      advantages: ['Quick Reflexes'], disadvantages: ['Curious'],
    });
    expect(pointsSpent(s, () => 1)).toBe(4 + 1 + 2 + 1);
  });
});

describe('experience', () => {
  it('10 experience buys one level; learning a found ability costs 1', () => {
    expect(XP_PER_LEVEL).toBe(10);
    expect(XP_TO_LEARN).toBe(1);
  });

  it('an attribute can be raised with 10 experience, not with 9, and never past 5', () => {
    expect(canRaiseAttribute(sheet({ skill: 3 }), 'skill', 10)).toBe(null);
    expect(canRaiseAttribute(sheet({ skill: 3 }), 'skill', 9)).toBe('xp');
    expect(canRaiseAttribute(sheet({ skill: 4 }), 'skill', 10)).toBe(null);
    expect(canRaiseAttribute(sheet({ skill: 5 }), 'skill', 100)).toBe('max');
    expect(canRaiseAttribute(sheet({ skill: 0 }), 'skill', 10)).toBe(null);
  });

  it('a path can be raised up to the story cap and never past 5', () => {
    expect(canRaisePath(sheet(), 'air', 10, 3)).toBe(null); // from nothing
    expect(canRaisePath(sheet({ paths: { air: 2 } }), 'air', 10, 3)).toBe(null);
    expect(canRaisePath(sheet({ paths: { air: 3 } }), 'air', 10, 3)).toBe('cap');
    expect(canRaisePath(sheet({ paths: { air: 2 } }), 'air', 9, 3)).toBe('xp');
    expect(canRaisePath(sheet({ paths: { air: 5 } }), 'air', 100, 5)).toBe('max');
    expect(canRaisePath(sheet({ paths: { air: 4 } }), 'air', 10, 5)).toBe(null);
    expect(canRaisePath(sheet(), 'air', 100, 0)).toBe('cap'); // powers are off in this story
  });

  it('raising an attribute adds one and leaves the old sheet alone', () => {
    const before = sheet({ strength: 2 });
    const after = raiseAttribute(before, 'strength');
    expect(after.strength).toBe(3);
    expect(before.strength).toBe(2);
    expect(after.hp).toBe(before.hp);
    expect(after.energy).toBe(before.energy);
  });

  it('raising Resistance raises both maximums by 5 and the current values with them', () => {
    const hurt = sheet({ resistance: 2, hp: 4, energy: 7 });
    const after = raiseAttribute(hurt, 'resistance');
    expect(after.resistance).toBe(3);
    expect(maxHp(after)).toBe(15);
    expect(after.hp).toBe(9);
    expect(after.energy).toBe(12);
  });

  it('raising a path adds one, from nothing too, and leaves the other paths alone', () => {
    const before = sheet({ paths: { air: 2, light: 1 } });
    expect(raisePath(before, 'air').paths).toEqual({ air: 3, light: 1 });
    expect(raisePath(before, 'fire').paths).toEqual({ air: 2, light: 1, fire: 1 });
    expect(before.paths).toEqual({ air: 2, light: 1 });
  });

  // The sections of the specification under test do not give the experience rule; these follow the engine.
  it('a scene is worth 0 to 2 experience by rule', () => {
    expect(sceneExperience({ testsPassed: 0, threadAdvanced: false, fightsWon: 0, inDanger: false })).toBe(0);
    expect(sceneExperience({ testsPassed: 1, threadAdvanced: false, fightsWon: 0, inDanger: false })).toBe(1);
    expect(sceneExperience({ testsPassed: 0, threadAdvanced: true, fightsWon: 0, inDanger: false })).toBe(1);
    expect(sceneExperience({ testsPassed: 0, threadAdvanced: false, fightsWon: 1, inDanger: true })).toBe(1);
    expect(sceneExperience({ testsPassed: 2, threadAdvanced: true, fightsWon: 3, inDanger: true })).toBe(2);
    expect(sceneExperience({ testsPassed: 1, threadAdvanced: false, fightsWon: 0, inDanger: true })).toBe(2);
    expect(sceneExperience({ testsPassed: 0, threadAdvanced: false, fightsWon: 0, inDanger: true })).toBe(0);
  });
});

describe('rest', () => {
  it('a night restores everything', () => {
    const tired = sheet({ resistance: 3, hp: 1, energy: 0 });
    expect(rest(tired, 8 * 60)).toMatchObject({ hp: 15, energy: 15 });
    expect(rest(tired, 6 * 60)).toMatchObject({ hp: 15, energy: 15 });
    expect(tired).toMatchObject({ hp: 1, energy: 0 });
  });

  it('a short rest restores one of each per full hour, never above the maximum', () => {
    const tired = sheet({ resistance: 2, hp: 3, energy: 9 });
    expect(rest(tired, 59)).toMatchObject({ hp: 3, energy: 9 });
    expect(rest(tired, 60)).toMatchObject({ hp: 4, energy: 10 });
    expect(rest(tired, 179)).toMatchObject({ hp: 5, energy: 10 });
    expect(rest(tired, 5 * 60 + 59)).toMatchObject({ hp: 8, energy: 10 });
    expect(rest(tired, 0)).toMatchObject({ hp: 3, energy: 9 });
  });

  it('never leaves more than 5 x Resistance', () => {
    for (let resistance = 1; resistance <= 5; resistance++) {
      for (const minutes of [0, 30, 60, 200, 359, 360, 1000]) {
        const after = rest(sheet({ resistance, hp: 1, energy: 1 }), minutes);
        expect(after.hp).toBeLessThanOrEqual(5 * resistance);
        expect(after.energy).toBeLessThanOrEqual(5 * resistance);
        expect(after.hp).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

// ---------- abilities ----------

describe('abilities', () => {
  it('each costs energy equal to its tier and is filed under its own id', () => {
    const ids = Object.keys(ABILITIES);
    expect(ids.length).toBeGreaterThanOrEqual(5);
    for (const id of ids) {
      const a = ABILITIES[id];
      if (!a) throw new Error('unreachable');
      expect(a.id).toBe(id);
      expect(a.cost, id).toBe(a.tier);
      expect(a.tier, id).toBeGreaterThanOrEqual(1);
      expect(a.tier, id).toBeLessThanOrEqual(5);
      expect(PATHS, id).toContain(a.path);
      expect(a.name.length, id).toBeGreaterThan(0);
      if (a.combat && (a.combat.type === 'stagger' || a.combat.type === 'dazzle' || a.combat.type === 'damage')) {
        expect(a.combat.needsTarget, id).toBe(true);
      }
    }
  });

  it('can be looked up by id', () => {
    expect(abilityById('gale_push')?.name).toBe('Gale Push');
    expect(abilityById('nothing')).toBeUndefined();
  });

  const windy = (over: Partial<Sheet> = {}) => sheet({ paths: { air: 2 }, abilities: ['gale_push', 'featherstep'], energy: 5, ...over });

  it('can be used with enough Focus in its path and enough energy', () => {
    const r = canUseAbility(windy(), 'gale_push');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ability.id).toBe('gale_push');
  });

  it('needs Focus in its path at least equal to its tier', () => {
    expect(canUseAbility(windy({ paths: { air: 1 } }), 'gale_push')).toEqual({ ok: false, reason: 'focus' });
    expect(canUseAbility(windy({ paths: { air: 1 } }), 'featherstep').ok).toBe(true);
    expect(canUseAbility(windy({ paths: {} }), 'featherstep')).toEqual({ ok: false, reason: 'focus' });
    expect(canUseAbility(windy({ paths: { light: 5 } }), 'gale_push')).toEqual({ ok: false, reason: 'focus' }); // the wrong path
    expect(canUseAbility(windy({ paths: { air: 5 } }), 'gale_push').ok).toBe(true);
  });

  it('needs energy at least equal to its cost', () => {
    expect(canUseAbility(windy({ energy: 1 }), 'gale_push')).toEqual({ ok: false, reason: 'energy' });
    expect(canUseAbility(windy({ energy: 2 }), 'gale_push').ok).toBe(true);
    expect(canUseAbility(windy({ energy: 0 }), 'featherstep')).toEqual({ ok: false, reason: 'energy' });
    expect(canUseAbility(windy({ energy: 1 }), 'featherstep').ok).toBe(true);
  });

  it('must exist and must have been learned', () => {
    expect(canUseAbility(windy(), 'fireball')).toEqual({ ok: false, reason: 'unknown' });
    expect(canUseAbility(windy({ paths: { light: 5 } }), 'glimmer')).toEqual({ ok: false, reason: 'not_learned' });
  });

  it('gives the first reason that applies: unknown, not learned, Focus, energy', () => {
    const nothing = sheet({ energy: 0 });
    expect(canUseAbility(nothing, 'fireball')).toEqual({ ok: false, reason: 'unknown' });
    expect(canUseAbility(nothing, 'gale_push')).toEqual({ ok: false, reason: 'not_learned' });
    expect(canUseAbility(sheet({ energy: 0, abilities: ['gale_push'] }), 'gale_push')).toEqual({ ok: false, reason: 'focus' });
    expect(canUseAbility(sheet({ energy: 0, abilities: ['gale_push'], paths: { air: 2 } }), 'gale_push')).toEqual({ ok: false, reason: 'energy' });
  });
});

// ---------- the public surface ----------

describe('the engine index', () => {
  it('exports everything other code is written against', () => {
    const names = [
      'ATTRIBUTES', 'PATHS', 'SKILLS', 'maxHp', 'maxEnergy',
      'makeRng', 'nextFloat', 'd6', 'pick', 'fixedDice', 'roll',
      'testTarget', 'runTest', 'rerollTest',
      'ABILITIES', 'abilityById', 'canUseAbility',
      'makeCombatant', 'condition', 'isUp', 'conditionLabel', 'resolveAttack', 'startCombat', 'act', 'resolveDown', 'winChance',
      'STAGES', 'stageIndex', 'stageName', 'toNextStage', 'barSegments', 'BOND_TIERS', 'DAILY_SMALL_CAP', 'applyBond',
      'addMinutes', 'slotOf', 'clockLabel', 'minutesBetween', 'durationLabel',
      'POWER_LEVELS', 'SKILL_COST', 'pointsSpent', 'XP_PER_LEVEL', 'XP_TO_LEARN', 'canRaiseAttribute', 'canRaisePath', 'raiseAttribute',
      'raisePath', 'rest', 'sceneExperience',
    ];
    for (const name of names) expect(engine, name).toHaveProperty(name);
  });
});
