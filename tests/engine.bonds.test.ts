// Bonds: docs/PLAN.md 10.7. A number from 0 to 100 per character; every 20 points is a stage.
import { describe, expect, it } from 'vitest';
import {
  BOND_TIERS, DAILY_SMALL_CAP, STAGES, applyBond, barSegments, stageIndex, stageName, toNextStage,
  type BondAct, type BondState, type BondTier,
} from '../src/engine/bonds';

function state(bond: number, over: Partial<BondState> = {}): BondState {
  return { bond, openGrievance: false, smallGainsToday: 0, ...over };
}
const GAINS: BondTier[] = ['small', 'meaningful', 'significant', 'major', 'defining'];
const LOSSES: BondTier[] = ['slight', 'broken_promise', 'betrayal'];

describe('stages', () => {
  it.each([
    [0, 'No bond yet'],
    [1, 'Acquaintance'],
    [19, 'Acquaintance'],
    [20, 'Friendly'],
    [39, 'Friendly'],
    [40, 'Trusted'],
    [59, 'Trusted'],
    [60, 'Close'],
    [79, 'Close'],
    [80, 'Devoted'],
    [99, 'Devoted'],
    [100, 'Devoted'],
  ] as const)('a bond of %i is "%s"', (bond, name) => {
    expect(stageName(bond)).toBe(name);
    expect(STAGES[stageIndex(bond)]).toBe(name);
  });

  it('has six names in order', () => {
    expect([...STAGES]).toEqual(['No bond yet', 'Acquaintance', 'Friendly', 'Trusted', 'Close', 'Devoted']);
  });

  it('the stage never goes down as the bond goes up, and every value from 0 to 100 has one', () => {
    let previous = 0;
    for (let bond = 0; bond <= 100; bond++) {
      const index = stageIndex(bond);
      expect(index).toBeGreaterThanOrEqual(previous);
      expect(index).toBeLessThanOrEqual(5);
      previous = index;
    }
    expect(previous).toBe(5);
  });

  it.each([
    [0, 1], // from no bond, a single point makes an acquaintance
    [1, 19],
    [19, 1],
    [20, 20],
    [39, 1],
    [40, 20],
    [59, 1],
    [60, 20],
    [79, 1],
    [80, 0],
    [100, 0],
  ])('from %i the next stage is %i away', (bond, away) => {
    expect(toNextStage(bond)).toBe(away);
  });

  it('toNextStage is exactly the distance to the next stage, for every bond', () => {
    for (let bond = 0; bond <= 100; bond++) {
      const away = toNextStage(bond);
      if (stageIndex(bond) === 5) {
        expect(away, `bond ${bond}`).toBe(0);
      } else {
        expect(away, `bond ${bond}`).toBeGreaterThan(0);
        expect(stageIndex(bond + away), `bond ${bond}`).toBe(stageIndex(bond) + 1);
        expect(stageIndex(bond + away - 1), `bond ${bond}`).toBe(stageIndex(bond));
      }
    }
  });

  it('fills the five segments of the bar', () => {
    expect(barSegments(0)).toEqual([0, 0, 0, 0, 0]);
    expect(barSegments(10)).toEqual([0.5, 0, 0, 0, 0]);
    expect(barSegments(20)).toEqual([1, 0, 0, 0, 0]);
    expect(barSegments(50)).toEqual([1, 1, 0.5, 0, 0]);
    expect(barSegments(79)).toEqual([1, 1, 1, 0.95, 0]);
    expect(barSegments(100)).toEqual([1, 1, 1, 1, 1]);
  });
});

describe('gains and losses by tier', () => {
  it.each<[BondTier, number]>([
    ['small', 1],
    ['meaningful', 3],
    ['significant', 8],
    ['major', 15],
    ['defining', 25],
    ['slight', -3],
    ['broken_promise', -12],
    ['betrayal', -30],
  ])('%s is worth %i', (tier, delta) => {
    const r = applyBond(state(50), { tier });
    expect(r).toMatchObject({ delta, before: 50, after: 50 + delta, held: null });
  });

  it('knows exactly these tiers', () => {
    expect([...BOND_TIERS].sort()).toEqual([...GAINS, ...LOSSES].sort());
  });

  it('every gain sits inside the range the rules give for its tier, and every loss too', () => {
    const range: Record<BondTier, [number, number]> = {
      small: [1, 1], meaningful: [3, 5], significant: [8, 12], major: [15, 20], defining: [25, 30],
      slight: [-5, -2], broken_promise: [-15, -10], betrayal: [-40, -25],
    };
    for (const tier of BOND_TIERS) {
      const { delta } = applyBond(state(50), { tier });
      expect(delta, tier).toBeGreaterThanOrEqual(range[tier][0]);
      expect(delta, tier).toBeLessThanOrEqual(range[tier][1]);
    }
  });

  it('a loss costs more than the matching gain', () => {
    const worth = (tier: BondTier) => Math.abs(applyBond(state(50), { tier }).delta);
    expect(worth('slight')).toBeGreaterThan(worth('small'));
    expect(worth('broken_promise')).toBeGreaterThan(worth('significant'));
    expect(worth('betrayal')).toBeGreaterThan(worth('defining'));
  });

  it('does not change the state it was given', () => {
    const s = state(50, { smallGainsToday: 2 });
    applyBond(s, { tier: 'meaningful' });
    expect(s).toEqual({ bond: 50, openGrievance: false, smallGainsToday: 2 });
  });
});

describe('values', () => {
  it('an act that touches a value counts for half as much again: significant is 12', () => {
    expect(applyBond(state(40), { tier: 'significant', touchesValue: true }).delta).toBe(12);
  });

  // 1.5, 4.5, 22.5 and 37.5 are not whole numbers; the engine rounds half up. Major and Defining then
  // land above the ranges in the tier table (23 > 20, 38 > 30). Listed as a question in the report.
  it.each<[BondTier, number]>([
    ['small', 2],
    ['meaningful', 5],
    ['significant', 12],
    ['major', 23],
    ['defining', 38],
  ])('%s with a value is %i', (tier, delta) => {
    expect(applyBond(state(10), { tier, touchesValue: true }).delta).toBe(delta);
  });

  it('a wrong that touches a value costs half as much again too', () => {
    expect(applyBond(state(60), { tier: 'broken_promise', touchesValue: true }).delta).toBe(-18);
    expect(applyBond(state(60), { tier: 'betrayal', touchesValue: true }).delta).toBe(-45);
    const slight = applyBond(state(60), { tier: 'slight', touchesValue: true }).delta;
    expect(slight).toBeLessThan(-3);
    expect(slight).toBeGreaterThanOrEqual(-5);
  });

  it.each(GAINS)('an act that offends a value loses bond even if it was meant kindly (%s)', (tier) => {
    const r = applyBond(state(50), { tier, offendsValue: true });
    expect(r.delta).toBeLessThan(0);
    expect(r.delta).toBe(-3);
    expect(r.newStage).toBe(false);
  });

  it('an offending small act does not use up the daily allowance', () => {
    expect(applyBond(state(50, { smallGainsToday: 2 }), { tier: 'small', offendsValue: true }).smallGainsToday).toBe(2);
  });

  it('offending a value does not make a wrong any cheaper', () => {
    expect(applyBond(state(50), { tier: 'betrayal', offendsValue: true }).delta).toBe(-30);
  });
});

describe('limits', () => {
  it('never goes below 0', () => {
    expect(applyBond(state(10), { tier: 'betrayal' })).toMatchObject({ before: 10, after: 0, delta: -10, stageAfter: 'No bond yet' });
    expect(applyBond(state(0), { tier: 'slight' })).toMatchObject({ after: 0, delta: 0 });
    expect(applyBond(state(3), { tier: 'slight' })).toMatchObject({ after: 0, delta: -3 });
  });

  it('never goes above 100', () => {
    expect(applyBond(state(95), { tier: 'defining' })).toMatchObject({ before: 95, after: 100, delta: 5, stageAfter: 'Devoted' });
    expect(applyBond(state(100), { tier: 'major' })).toMatchObject({ after: 100, delta: 0, newStage: false });
    expect(applyBond(state(99), { tier: 'small' })).toMatchObject({ after: 100, delta: 1, newStage: false });
  });

  it('stays within 0 to 100 and reports the real change, for every bond, tier and flag', () => {
    for (let bond = 0; bond <= 100; bond++) {
      for (const tier of BOND_TIERS) {
        for (const touchesValue of [false, true]) {
          for (const offendsValue of [false, true]) {
            for (const openGrievance of [false, true]) {
              const r = applyBond(state(bond, { openGrievance }), { tier, touchesValue, offendsValue });
              const where = `${bond} ${tier} value:${touchesValue} offends:${offendsValue} grievance:${openGrievance}`;
              expect(r.after, where).toBeGreaterThanOrEqual(0);
              expect(r.after, where).toBeLessThanOrEqual(100);
              expect(Number.isInteger(r.after), where).toBe(true);
              expect(r.before, where).toBe(bond);
              expect(r.delta, where).toBe(r.after - r.before);
              expect(r.stageBefore, where).toBe(stageName(bond));
              expect(r.stageAfter, where).toBe(stageName(r.after));
              expect(r.newStage, where).toBe(stageIndex(r.after) > stageIndex(bond));
              const isGain = GAINS.includes(tier) && !offendsValue;
              if (isGain) expect(r.delta, where).toBeGreaterThanOrEqual(0);
              else expect(r.delta, where).toBeLessThanOrEqual(0);
            }
          }
        }
      }
    }
  });
});

describe('reaching a stage', () => {
  it('19 -> 20 reaches Friendly', () => {
    expect(applyBond(state(19), { tier: 'small' })).toMatchObject({ after: 20, stageBefore: 'Acquaintance', stageAfter: 'Friendly', newStage: true });
  });

  it('18 -> 19 does not', () => {
    expect(applyBond(state(18), { tier: 'small' })).toMatchObject({ after: 19, stageAfter: 'Acquaintance', newStage: false });
  });

  it('79 -> 80 reaches Devoted', () => {
    expect(applyBond(state(79), { tier: 'small' })).toMatchObject({ after: 80, stageBefore: 'Close', stageAfter: 'Devoted', newStage: true });
  });

  it('78 -> 79 does not', () => {
    expect(applyBond(state(78), { tier: 'small' })).toMatchObject({ after: 79, stageAfter: 'Close', newStage: false });
  });

  it('the first point makes an acquaintance', () => {
    expect(applyBond(state(0), { tier: 'small' })).toMatchObject({ after: 1, stageBefore: 'No bond yet', stageAfter: 'Acquaintance', newStage: true });
  });

  it('a big act can pass over a stage; it still reports the stage it landed in', () => {
    expect(applyBond(state(15), { tier: 'defining' })).toMatchObject({ after: 40, stageAfter: 'Trusted', newStage: true });
  });

  it('nothing new at 100', () => {
    expect(applyBond(state(100), { tier: 'defining' })).toMatchObject({ after: 100, newStage: false });
  });

  it('dropping to a lower stage is not a new stage', () => {
    expect(applyBond(state(20), { tier: 'slight' })).toMatchObject({ after: 17, stageBefore: 'Friendly', stageAfter: 'Acquaintance', newStage: false });
    expect(applyBond(state(80), { tier: 'betrayal' })).toMatchObject({ after: 50, stageAfter: 'Trusted', newStage: false });
  });
});

describe('no farming: small and meaningful gains are capped at 6 a day', () => {
  it('the cap is 6', () => {
    expect(DAILY_SMALL_CAP).toBe(6);
  });

  it('six courtesies count, the seventh does not', () => {
    let s = state(30);
    for (let i = 1; i <= 6; i++) {
      const r = applyBond(s, { tier: 'small' });
      expect(r).toMatchObject({ delta: 1, held: null, smallGainsToday: i });
      s = { ...s, bond: r.after, smallGainsToday: r.smallGainsToday };
    }
    const seventh = applyBond(s, { tier: 'small' });
    expect(seventh).toMatchObject({ delta: 0, after: 36, held: 'daily', smallGainsToday: 6 });
  });

  it('two meaningful acts fill the day, the third is worth nothing', () => {
    const first = applyBond(state(30), { tier: 'meaningful' });
    expect(first).toMatchObject({ delta: 3, smallGainsToday: 3, held: null });
    const second = applyBond(state(33, { smallGainsToday: 3 }), { tier: 'meaningful' });
    expect(second).toMatchObject({ delta: 3, smallGainsToday: 6, held: null });
    const third = applyBond(state(36, { smallGainsToday: 6 }), { tier: 'meaningful' });
    expect(third).toMatchObject({ delta: 0, after: 36, smallGainsToday: 6, held: 'daily' });
  });

  it('a gain is cut to what is left of the day', () => {
    const r = applyBond(state(30, { smallGainsToday: 5 }), { tier: 'meaningful' });
    expect(r).toMatchObject({ delta: 1, after: 31, smallGainsToday: 6, held: 'daily' });
  });

  it('a gain that lands exactly on the cap is not held', () => {
    const r = applyBond(state(30, { smallGainsToday: 3 }), { tier: 'meaningful' });
    expect(r).toMatchObject({ delta: 3, smallGainsToday: 6, held: null });
  });

  it('the half-as-much-again for a value counts against the cap', () => {
    const first = applyBond(state(30), { tier: 'meaningful', touchesValue: true });
    expect(first).toMatchObject({ delta: 5, smallGainsToday: 5 });
    const second = applyBond(state(35, { smallGainsToday: 5 }), { tier: 'meaningful', touchesValue: true });
    expect(second).toMatchObject({ delta: 1, smallGainsToday: 6, held: 'daily' });
  });

  it.each<BondTier>(['significant', 'major', 'defining'])('%s is not capped and does not use the allowance', (tier) => {
    const full = applyBond(state(30, { smallGainsToday: 6 }), { tier });
    const fresh = applyBond(state(30), { tier });
    expect(full.delta).toBe(fresh.delta);
    expect(full.held).toBe(null);
    expect(full.smallGainsToday).toBe(6);
    expect(fresh.smallGainsToday).toBe(0);
  });

  it.each(LOSSES)('%s is not softened by a full day', (tier) => {
    const full = applyBond(state(60, { smallGainsToday: 6 }), { tier });
    expect(full.delta).toBe(applyBond(state(60), { tier }).delta);
    expect(full.smallGainsToday).toBe(6);
  });

  it('only points really gained use up the allowance', () => {
    // Already at 100: nothing gained, nothing used.
    expect(applyBond(state(100, { smallGainsToday: 2 }), { tier: 'meaningful' })).toMatchObject({ delta: 0, smallGainsToday: 2 });
    // One point of room under 100: one gained, one used.
    expect(applyBond(state(99, { smallGainsToday: 2 }), { tier: 'meaningful' })).toMatchObject({ delta: 1, smallGainsToday: 3 });
    // Held back by an open grievance at the top of a stage: nothing gained, nothing used.
    expect(applyBond(state(39, { smallGainsToday: 2, openGrievance: true }), { tier: 'meaningful' })).toMatchObject({ delta: 0, smallGainsToday: 2 });
    // A grievance leaves room for one of the two points.
    expect(applyBond(state(38, { smallGainsToday: 2, openGrievance: true }), { tier: 'meaningful', touchesValue: true }))
      .toMatchObject({ delta: 1, after: 39, smallGainsToday: 3 });
  });

  it('the allowance used always equals the small and meaningful points gained, and never passes 6', () => {
    for (let bond = 0; bond <= 100; bond++) {
      for (const tier of BOND_TIERS) {
        for (const flags of [{}, { touchesValue: true }, { offendsValue: true }]) {
          for (const openGrievance of [false, true]) {
            for (let used = 0; used <= DAILY_SMALL_CAP; used++) {
              const r = applyBond(state(bond, { openGrievance, smallGainsToday: used }), { tier, ...flags });
              const counts = (tier === 'small' || tier === 'meaningful') && r.delta > 0;
              const where = `${bond} ${tier} ${JSON.stringify(flags)} grievance:${openGrievance} used:${used}`;
              expect(r.smallGainsToday, where).toBe(used + (counts ? r.delta : 0));
              expect(r.smallGainsToday, where).toBeLessThanOrEqual(DAILY_SMALL_CAP);
            }
          }
        }
      }
    }
  });

  it('a new day starts the count again', () => {
    expect(applyBond(state(36, { smallGainsToday: 0 }), { tier: 'meaningful' })).toMatchObject({ delta: 3, smallGainsToday: 3 });
  });

  it('no mix of small and meaningful acts in one day is ever worth more than 6', () => {
    const acts: BondAct[] = [
      { tier: 'small' }, { tier: 'meaningful' }, { tier: 'small', touchesValue: true }, { tier: 'meaningful', touchesValue: true },
    ];
    // Every sequence of five acts drawn from the four kinds.
    for (let code = 0; code < 4 ** 5; code++) {
      let s = state(10);
      let n = code;
      for (let i = 0; i < 5; i++) {
        const actNow = acts[n % 4];
        n = Math.floor(n / 4);
        if (!actNow) throw new Error('unreachable');
        const r = applyBond(s, actNow);
        expect(r.delta).toBeGreaterThanOrEqual(0);
        s = { ...s, bond: r.after, smallGainsToday: r.smallGainsToday };
      }
      expect(s.bond - 10, `sequence ${code}`).toBeLessThanOrEqual(6);
      expect(s.smallGainsToday, `sequence ${code}`).toBe(s.bond - 10);
    }
  });
});

describe('an open grievance', () => {
  const grieved = (bond: number, over: Partial<BondState> = {}) => state(bond, { openGrievance: true, ...over });

  it.each<[BondTier, boolean, number]>([
    ['significant', false, 4],
    ['significant', true, 6],
    ['major', false, 7],
    ['defining', false, 12],
    ['meaningful', false, 1],
  ])('halves a gain: %s (value: %s) is worth %i', (tier, touchesValue, delta) => {
    // 41 leaves room for every one of these inside the Trusted stage.
    const r = applyBond(grieved(41), { tier, touchesValue });
    expect(r).toMatchObject({ delta, after: 41 + delta, held: 'grievance', newStage: false });
  });

  // Half of 1 is not a whole number. The engine keeps a small gain at 1. Listed as a question in the report.
  it('a small gain stays 1', () => {
    expect(applyBond(grieved(41), { tier: 'small' })).toMatchObject({ delta: 1, held: 'grievance' });
  });

  it('never gives more than the same act without a grievance, and never more than half rounded up', () => {
    for (const tier of GAINS) {
      for (const touchesValue of [false, true]) {
        const open = applyBond(grieved(41), { tier, touchesValue }).delta;
        const settled = applyBond(state(41), { tier, touchesValue }).delta;
        expect(open, tier).toBeLessThanOrEqual(Math.ceil(settled / 2));
        expect(open, tier).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the next stage out of reach: the bond stops one short', () => {
    const r = applyBond(grieved(38), { tier: 'significant' }); // 38 + 4 would be 42
    expect(r).toMatchObject({ before: 38, after: 39, delta: 1, stageAfter: 'Friendly', newStage: false, held: 'grievance' });
  });

  it('at the top of a stage nothing more is gained', () => {
    for (const top of [19, 39, 59, 79]) {
      for (const tier of GAINS) {
        const r = applyBond(grieved(top), { tier });
        expect(r, `${top} ${tier}`).toMatchObject({ after: top, delta: 0, newStage: false, held: 'grievance' });
      }
    }
  });

  it('a stranger with a grievance stays a stranger', () => {
    for (const tier of GAINS) {
      const r = applyBond(grieved(0), { tier, touchesValue: true });
      expect(r, tier).toMatchObject({ after: 0, delta: 0, stageAfter: 'No bond yet', newStage: false, held: 'grievance' });
    }
  });

  it('can still grow inside the current stage', () => {
    expect(applyBond(grieved(20), { tier: 'defining' })).toMatchObject({ after: 32, newStage: false });
    expect(applyBond(grieved(1), { tier: 'major' })).toMatchObject({ after: 8, newStage: false });
  });

  it('at Devoted there is no next stage to hold back: the bond can reach 100', () => {
    expect(applyBond(grieved(80), { tier: 'defining' })).toMatchObject({ after: 92, delta: 12 });
    expect(applyBond(grieved(95), { tier: 'defining' })).toMatchObject({ after: 100, delta: 5 });
  });

  it('never reaches a new stage, from any bond, with any gain', () => {
    for (let bond = 0; bond <= 100; bond++) {
      for (const tier of GAINS) {
        for (const touchesValue of [false, true]) {
          const r = applyBond(grieved(bond), { tier, touchesValue });
          expect(r.newStage, `${bond} ${tier}`).toBe(false);
          expect(r.stageAfter, `${bond} ${tier}`).toBe(r.stageBefore);
          expect(r.delta, `${bond} ${tier}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it.each(LOSSES)('does not halve a loss (%s)', (tier) => {
    expect(applyBond(grieved(60), { tier }).delta).toBe(applyBond(state(60), { tier }).delta);
  });

  it('halves before the daily cap is applied', () => {
    const r = applyBond(grieved(41, { smallGainsToday: 0 }), { tier: 'meaningful', touchesValue: true }); // 5 -> 2
    expect(r).toMatchObject({ delta: 2, smallGainsToday: 2 });
    const capped = applyBond(grieved(41, { smallGainsToday: 6 }), { tier: 'meaningful' });
    expect(capped).toMatchObject({ delta: 0, held: 'daily' });
  });
});
