// Tests: roll one die at or under a target. A 6 always fails. On a success the number rolled is the quality.
import { has, type Attribute, type Difficulty, type Sheet, type SkillName, type TableStyle } from './types';
import { roll, type Rng } from './rng';

export interface TestSpec {
  attribute: Attribute;
  /** The skill that applies, if any. The character may or may not have it. */
  skill?: SkillName | null;
  difficulty: Difficulty;
  /** Situational bonus or penalty, for example +1 for help from a companion. */
  modifier?: number;
  /** A short label for the roll log: "bluff past Captain Roth". */
  label?: string;
}

export type TestOutcome =
  | 'success' // it works
  | 'cost' // Story style: a failed roll becomes a success at a cost
  | 'forward' // Adventure style: a failure that still leaves a way forward
  | 'fail'; // it does not work

export interface TestResult {
  kind: 'test';
  attribute: Attribute;
  skill: SkillName | null;
  hasSkill: boolean;
  difficulty: Difficulty;
  /** Roll this or less. */
  target: number;
  /** The die that was rolled, or null when no roll was needed. */
  die: number | null;
  /** True when the roll itself succeeded (before the table style softens a failure). */
  passed: boolean;
  outcome: TestOutcome;
  /** On a pass: the number rolled, 1 to 5. Otherwise 0. */
  quality: number;
  /** Why there was no roll: an easy task for someone with the skill, or a target of 0 or less. */
  auto: 'success' | 'impossible' | null;
  label: string;
  /** Set when a destiny point bought a second roll: the die that was replaced. */
  rerolled?: number;
}

// How the target moves with difficulty.
//                         easy   medium  hard
// has the skill           no roll  +1     -2
// no skill applies         +1       0     -2
// skill applies, lacks it   0      -1     -3
const LADDER: Record<'skilled' | 'raw' | 'unskilled', Record<Difficulty, number | 'auto'>> = {
  skilled: { easy: 'auto', medium: 1, hard: -2 },
  raw: { easy: 1, medium: 0, hard: -2 },
  unskilled: { easy: 0, medium: -1, hard: -3 },
};

export function testTarget(sheet: Sheet, spec: TestSpec): { target: number; hasSkill: boolean; auto: 'success' | 'impossible' | null } {
  const hasSkill = !!spec.skill && sheet.skills.includes(spec.skill);
  const row = !spec.skill ? 'raw' : hasSkill ? 'skilled' : 'unskilled';
  const step = LADDER[row][spec.difficulty];
  if (step === 'auto') return { target: 6, hasSkill, auto: 'success' };
  // Two traits make a kind of test one point easier: Keen Senses for noticing, Iron Will for holding out.
  const trait = (spec.skill === 'Investigation' && has(sheet.advantages, 'keen senses') ? 1 : 0)
    + (spec.attribute === 'resistance' && has(sheet.advantages, 'iron will') ? 1 : 0);
  const target = sheet[spec.attribute] + step + trait + (spec.modifier ?? 0);
  return { target, hasSkill, auto: target <= 0 ? 'impossible' : null };
}

function soften(style: TableStyle): TestOutcome {
  return style === 'story' ? 'cost' : style === 'adventure' ? 'forward' : 'fail';
}

export function runTest(sheet: Sheet, spec: TestSpec, style: TableStyle, rng: Rng): TestResult {
  const { target, hasSkill, auto } = testTarget(sheet, spec);
  const base = {
    kind: 'test' as const,
    attribute: spec.attribute,
    skill: spec.skill ?? null,
    hasSkill,
    difficulty: spec.difficulty,
    target,
    label: spec.label ?? '',
  };
  if (auto === 'success') return { ...base, die: null, passed: true, outcome: 'success', quality: 3, auto };
  if (auto === 'impossible') return { ...base, die: null, passed: false, outcome: soften(style), quality: 0, auto };
  const die = roll(rng);
  const passed = die !== 6 && die <= target;
  return { ...base, die, passed, outcome: passed ? 'success' : soften(style), quality: passed ? die : 0, auto: null };
}

/** A destiny point buys one new roll of a test that was actually rolled. */
export function rerollTest(previous: TestResult, style: TableStyle, rng: Rng): TestResult {
  if (previous.die === null) return previous;
  const die = roll(rng);
  const passed = die !== 6 && die <= previous.target;
  return { ...previous, die, passed, outcome: passed ? 'success' : soften(style), quality: passed ? die : 0, rerolled: previous.die };
}
