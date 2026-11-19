// Tests (the roll-under kind): docs/PLAN.md 10.1, 10.2, 10.5, 10.9.
// Roll one die at or under the target. A 6 always fails. On a success the number rolled is the quality.
import { describe, expect, it } from 'vitest';
import { fixedDice } from '../src/engine/rng';
import { rerollTest, runTest, testTarget, type TestOutcome, type TestSpec } from '../src/engine/tests';
import { ATTRIBUTES, type Attribute, type Difficulty, type Sheet, type TableStyle } from '../src/engine/types';

function sheet(over: Partial<Sheet> = {}): Sheet {
  return {
    strength: 2, skill: 3, resistance: 2, armor: 1, firepower: 0, hp: 10, energy: 10,
    paths: {}, skills: [], advantages: [], disadvantages: [], abilities: [], ...over,
  };
}

const STYLES: TableStyle[] = ['story', 'adventure', 'brutal'];
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
const FAILURE_NAME: Record<TableStyle, TestOutcome> = { story: 'cost', adventure: 'forward', brutal: 'fail' };

// The ladder as the specification gives it. null = no roll needed.
type Row = 'skilled' | 'raw' | 'unskilled';
const STEP: Record<Row, Record<Difficulty, number | null>> = {
  skilled: { easy: null, medium: 1, hard: -2 },
  raw: { easy: 1, medium: 0, hard: -2 },
  unskilled: { easy: 0, medium: -1, hard: -3 },
};

function specFor(row: Row, attribute: Attribute, difficulty: Difficulty, modifier?: number): { sheet: Partial<Sheet>; spec: TestSpec } {
  const spec: TestSpec = { attribute, difficulty, skill: row === 'raw' ? null : 'Crime' };
  if (modifier !== undefined) spec.modifier = modifier;
  return { sheet: { skills: row === 'skilled' ? ['Crime'] : ['Medicine'] }, spec };
}

describe('the target', () => {
  it.each<[Row, Difficulty, number | 'auto']>([
    ['skilled', 'easy', 'auto'],
    ['skilled', 'medium', 4],
    ['skilled', 'hard', 1],
    ['raw', 'easy', 4],
    ['raw', 'medium', 3],
    ['raw', 'hard', 1],
    ['unskilled', 'easy', 3],
    ['unskilled', 'medium', 2],
    ['unskilled', 'hard', 0],
  ])('%s, %s, attribute 3 -> %s', (row, difficulty, expected) => {
    const made = specFor(row, 'skill', difficulty);
    const got = testTarget(sheet({ skill: 3, ...made.sheet }), made.spec);
    if (expected === 'auto') {
      expect(got.auto).toBe('success');
    } else {
      expect(got.target).toBe(expected);
      expect(got.auto).toBe(expected <= 0 ? 'impossible' : null);
    }
    expect(got.hasSkill).toBe(row === 'skilled');
  });

  it.each(ATTRIBUTES.map((a) => [a] as const))('uses the attribute that was asked for: %s', (attribute) => {
    const s = sheet({ strength: 1, skill: 2, resistance: 3, armor: 4, firepower: 5 });
    expect(testTarget(s, { attribute, difficulty: 'medium' }).target).toBe(s[attribute]);
  });

  it('adds a situational modifier', () => {
    expect(testTarget(sheet({ skill: 3 }), { attribute: 'skill', difficulty: 'medium', modifier: 1 }).target).toBe(4);
    expect(testTarget(sheet({ skill: 3 }), { attribute: 'skill', difficulty: 'medium', modifier: -2 }).target).toBe(1);
  });

  it('a modifier can make a test impossible or rescue one', () => {
    expect(testTarget(sheet({ skill: 1 }), { attribute: 'skill', difficulty: 'medium', modifier: -1 }).auto).toBe('impossible');
    expect(testTarget(sheet({ skill: 0 }), { attribute: 'skill', difficulty: 'medium', modifier: 1 }).auto).toBe(null);
  });

  it('a skill that is null, missing or undefined is the "no skill applies" row', () => {
    const s = sheet({ skill: 3, skills: ['Crime'] });
    expect(testTarget(s, { attribute: 'skill', difficulty: 'easy' }).target).toBe(4);
    expect(testTarget(s, { attribute: 'skill', difficulty: 'easy', skill: null }).target).toBe(4);
    expect(testTarget(s, { attribute: 'skill', difficulty: 'easy', skill: undefined }).target).toBe(4);
    expect(testTarget(s, { attribute: 'skill', difficulty: 'easy' }).hasSkill).toBe(false);
  });

  it('having a different skill does not help', () => {
    const s = sheet({ skill: 3, skills: ['Medicine', 'Arts'] });
    const got = testTarget(s, { attribute: 'skill', difficulty: 'medium', skill: 'Crime' });
    expect(got).toEqual({ target: 2, hasSkill: false, auto: null });
  });
});

describe('the roll', () => {
  const medium: TestSpec = { attribute: 'skill', difficulty: 'medium' }; // target = skill

  it('passes when the die equals the target, and the die is the quality', () => {
    const r = runTest(sheet({ skill: 3 }), medium, 'adventure', fixedDice(3));
    expect(r).toMatchObject({ kind: 'test', target: 3, die: 3, passed: true, outcome: 'success', quality: 3, auto: null });
  });

  it('fails one above the target', () => {
    const r = runTest(sheet({ skill: 3 }), medium, 'brutal', fixedDice(4));
    expect(r).toMatchObject({ target: 3, die: 4, passed: false, outcome: 'fail', quality: 0 });
  });

  it('passes under the target with a lower quality', () => {
    const r = runTest(sheet({ skill: 3 }), medium, 'brutal', fixedDice(1));
    expect(r).toMatchObject({ die: 1, passed: true, quality: 1 });
  });

  it('with a target of 1 only a 1 passes', () => {
    expect(runTest(sheet({ skill: 1 }), medium, 'brutal', fixedDice(1)).passed).toBe(true);
    expect(runTest(sheet({ skill: 1 }), medium, 'brutal', fixedDice(2)).passed).toBe(false);
  });

  it('a 6 fails with a target of exactly 6', () => {
    const s = sheet({ skill: 5, skills: ['Crime'] });
    const spec: TestSpec = { attribute: 'skill', difficulty: 'medium', skill: 'Crime' };
    const r = runTest(s, spec, 'brutal', fixedDice(6));
    expect(r.target).toBe(6);
    expect(r).toMatchObject({ die: 6, passed: false, outcome: 'fail', quality: 0 });
  });

  it('a 6 fails with a target above 6, and a 5 still passes with quality 5', () => {
    const s = sheet({ skill: 5, skills: ['Crime'] });
    const spec: TestSpec = { attribute: 'skill', difficulty: 'medium', skill: 'Crime', modifier: 3 };
    expect(runTest(s, spec, 'brutal', fixedDice(6))).toMatchObject({ target: 9, die: 6, passed: false, quality: 0 });
    expect(runTest(s, spec, 'brutal', fixedDice(5))).toMatchObject({ target: 9, die: 5, passed: true, quality: 5 });
  });

  it('rolls exactly one die', () => {
    const rng = fixedDice(2, 5, 4);
    runTest(sheet({ skill: 3 }), medium, 'adventure', rng);
    expect(rng.faces).toEqual([5, 4]);
  });

  it('carries the label, the attribute, the skill and the difficulty into the result', () => {
    const r = runTest(sheet({ skills: ['Crime'] }), { attribute: 'skill', skill: 'Crime', difficulty: 'hard', label: 'pick the lock' }, 'adventure', fixedDice(1));
    expect(r).toMatchObject({ attribute: 'skill', skill: 'Crime', hasSkill: true, difficulty: 'hard', label: 'pick the lock', target: 1 });
    const bare = runTest(sheet(), { attribute: 'strength', difficulty: 'medium' }, 'adventure', fixedDice(1));
    expect(bare.skill).toBe(null);
    expect(bare.label).toBe('');
  });
});

describe('no roll needed', () => {
  it.each(STYLES)('an easy task with the matching skill succeeds without a roll (%s)', (style) => {
    const rng = fixedDice(6, 6);
    const r = runTest(sheet({ skill: 0, skills: ['Crime'] }), { attribute: 'skill', skill: 'Crime', difficulty: 'easy' }, style, rng);
    expect(r).toMatchObject({ die: null, passed: true, outcome: 'success', auto: 'success', hasSkill: true });
    expect(r.quality).toBeGreaterThanOrEqual(1);
    expect(r.quality).toBeLessThanOrEqual(5);
    expect(rng.faces).toEqual([6, 6]);
  });

  it('a target of exactly 0 is impossible, without a roll', () => {
    const rng = fixedDice(1, 1);
    const r = runTest(sheet({ skill: 0 }), { attribute: 'skill', difficulty: 'medium' }, 'brutal', rng);
    expect(r).toMatchObject({ target: 0, die: null, passed: false, outcome: 'fail', quality: 0, auto: 'impossible' });
    expect(rng.faces).toEqual([1, 1]);
  });

  it('a negative target is impossible, without a roll', () => {
    const rng = fixedDice(1, 1);
    const r = runTest(sheet({ skill: 1 }), { attribute: 'skill', skill: 'Crime', difficulty: 'hard' }, 'brutal', rng);
    expect(r).toMatchObject({ target: -2, die: null, passed: false, quality: 0, auto: 'impossible' });
    expect(rng.faces).toEqual([1, 1]);
  });

  // The specification does not say what an impossible test is called in the softer styles.
  // The engine names it like any other failure. Listed as a question in the report.
  it.each(STYLES)('an impossible test is named like any other failure (%s)', (style) => {
    const r = runTest(sheet({ skill: 0 }), { attribute: 'skill', difficulty: 'hard' }, style, fixedDice(1));
    expect(r.passed).toBe(false);
    expect(r.outcome).toBe(FAILURE_NAME[style]);
  });
});

describe('table styles', () => {
  it.each(STYLES)('a failed roll is named by the table style (%s)', (style) => {
    const r = runTest(sheet({ skill: 3 }), { attribute: 'skill', difficulty: 'medium' }, style, fixedDice(5));
    expect(r.passed).toBe(false);
    expect(r.outcome).toBe(FAILURE_NAME[style]);
    expect(r.quality).toBe(0);
  });

  it.each(STYLES)('a 6 is a failure in every style (%s)', (style) => {
    const r = runTest(sheet({ skill: 5 }), { attribute: 'skill', difficulty: 'easy' }, style, fixedDice(6));
    expect(r.target).toBe(6);
    expect(r.passed).toBe(false);
    expect(r.outcome).toBe(FAILURE_NAME[style]);
  });

  it.each(STYLES)('a success is a success in every style (%s)', (style) => {
    const r = runTest(sheet({ skill: 3 }), { attribute: 'skill', difficulty: 'medium' }, style, fixedDice(2));
    expect(r).toMatchObject({ passed: true, outcome: 'success', quality: 2 });
  });
});

describe('every combination against the rules as written', () => {
  it('attribute 0-5 x ladder row x difficulty x modifier x die x style', () => {
    let checked = 0;
    for (const row of ['skilled', 'raw', 'unskilled'] as const) {
      for (const difficulty of DIFFICULTIES) {
        for (let attribute = 0; attribute <= 5; attribute++) {
          for (const modifier of [-2, -1, 0, 1, 2]) {
            for (let die = 1; die <= 6; die++) {
              for (const style of STYLES) {
                const made = specFor(row, 'strength', difficulty, modifier);
                const rng = fixedDice(die, 0);
                const r = runTest(sheet({ strength: attribute, ...made.sheet }), made.spec, style, rng);
                const where = `${row}/${difficulty}/attr ${attribute}/mod ${modifier}/die ${die}/${style}`;
                const step = STEP[row][difficulty];
                if (step === null) {
                  expect(r.die, where).toBe(null);
                  expect(r.passed, where).toBe(true);
                  expect(r.outcome, where).toBe('success');
                  expect(rng.faces, where).toEqual([die, 0]);
                } else {
                  const target = attribute + step + modifier;
                  expect(r.target, where).toBe(target);
                  if (target <= 0) {
                    expect(r.die, where).toBe(null);
                    expect(r.passed, where).toBe(false);
                    expect(r.auto, where).toBe('impossible');
                    expect(r.quality, where).toBe(0);
                    expect(rng.faces, where).toEqual([die, 0]);
                  } else {
                    const pass = die !== 6 && die <= target;
                    expect(r.die, where).toBe(die);
                    expect(r.passed, where).toBe(pass);
                    expect(r.quality, where).toBe(pass ? die : 0);
                    expect(r.outcome, where).toBe(pass ? 'success' : FAILURE_NAME[style]);
                    expect(r.auto, where).toBe(null);
                    expect(rng.faces, where).toEqual([0]);
                  }
                }
                checked += 1;
              }
            }
          }
        }
      }
    }
    expect(checked).toBe(3 * 3 * 6 * 5 * 6 * 3);
  });
});

describe('a destiny point buys a new roll', () => {
  const spec: TestSpec = { attribute: 'skill', difficulty: 'medium' };

  it('replaces the die, keeps the target and remembers the die it replaced', () => {
    const first = runTest(sheet({ skill: 3 }), spec, 'adventure', fixedDice(5));
    expect(first.passed).toBe(false);
    const second = rerollTest(first, 'adventure', fixedDice(3));
    expect(second).toMatchObject({ target: 3, die: 3, passed: true, outcome: 'success', quality: 3, rerolled: 5 });
    // The first result is left as it was.
    expect(first).toMatchObject({ die: 5, passed: false, outcome: 'forward' });
    expect(first.rerolled).toBeUndefined();
  });

  it('can fail again, named by the table style', () => {
    const first = runTest(sheet({ skill: 3 }), spec, 'story', fixedDice(4));
    const second = rerollTest(first, 'story', fixedDice(4));
    expect(second).toMatchObject({ die: 4, passed: false, outcome: 'cost', quality: 0, rerolled: 4 });
  });

  it('a 6 still always fails on the new roll', () => {
    const s = sheet({ skill: 5 });
    const first = runTest(s, { attribute: 'skill', difficulty: 'easy' }, 'brutal', fixedDice(6));
    expect(first.target).toBe(6);
    const second = rerollTest(first, 'brutal', fixedDice(6));
    expect(second).toMatchObject({ die: 6, passed: false, outcome: 'fail' });
  });

  it('can turn a success into a failure (the new roll stands)', () => {
    const first = runTest(sheet({ skill: 3 }), spec, 'brutal', fixedDice(1));
    const second = rerollTest(first, 'brutal', fixedDice(5));
    expect(second).toMatchObject({ passed: false, quality: 0, rerolled: 1 });
  });

  it('does nothing to a test that was never rolled', () => {
    const auto = runTest(sheet({ skills: ['Crime'] }), { attribute: 'skill', skill: 'Crime', difficulty: 'easy' }, 'adventure', fixedDice(1));
    const impossible = runTest(sheet({ skill: 0 }), spec, 'adventure', fixedDice(1));
    const rng = fixedDice(2, 2);
    expect(rerollTest(auto, 'adventure', rng)).toEqual(auto);
    expect(rerollTest(impossible, 'adventure', rng)).toEqual(impossible);
    expect(rng.faces).toEqual([2, 2]);
  });
});
