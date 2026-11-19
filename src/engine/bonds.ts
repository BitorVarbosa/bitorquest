// Bonds: how much trust and shared history exist between a character and the protagonist, 0 to 100.
// Every 20 points is a stage. Attitude (how they feel right now) and kind (friendship, romance...) are
// separate and live on the character; this file only does the arithmetic. docs/PLAN.md section 10.7.

import { t } from '../i18n';

export const STAGES =['No bond yet', 'Acquaintance', 'Friendly', 'Trusted', 'Close', 'Devoted'] as const;
export type Stage = (typeof STAGES)[number];

/** The name of a stage as the player reads it. ("Close" is also what a button does; that one has a key of its own with a note: see src/i18n.ts.) */
export function stageText(stage: Stage): string {
  return t(stage);
}

/** 0 for no bond, then 1 to 5 for the five stages of 20 points each. */
export function stageIndex(bond: number): number {
  if (bond <= 0) return 0;
  return Math.min(5, 1 + Math.floor(bond / 20));
}
export function stageName(bond: number): Stage {
  return STAGES[stageIndex(bond)] ?? 'No bond yet';
}
/** Points still needed for the next stage, or 0 at Devoted. */
export function toNextStage(bond: number): number {
  if (bond >= 80) return 0;
  if (bond <= 0) return 1; // from "No bond yet" the next stage, Acquaintance, starts at 1
  return (Math.floor(bond / 20) + 1) * 20 - bond;
}
/** How full each of the five 20-point segments of the bond bar is, 0 to 1. */
export function barSegments(bond: number): number[] {
  return [0, 1, 2, 3, 4].map((k) => Math.max(0, Math.min(1, (bond - 20 * k) / 20)));
}

/** How much an act mattered. The narrator or the scribe names the tier; the engine sets the number. */
export type BondTier = 'small' | 'meaningful' | 'significant' | 'major' | 'defining' | 'slight' | 'broken_promise' | 'betrayal';

const BASE: Record<BondTier, number> = {
  small: 1, // a courtesy, a shared joke, remembering a detail
  meaningful: 3, // a real favor, a thoughtful gift, an evening together
  significant: 8, // keeping a hard promise, standing up for them, trusting them when it was risky
  major: 15, // facing danger for them, sharing a secret, choosing them over a gain
  defining: 25, // saving their life, a great sacrifice
  slight: -3,
  broken_promise: -12, // a broken promise or a lie found out
  betrayal: -30,
};
export const BOND_TIERS = Object.keys(BASE) as BondTier[];

/** Small and Meaningful gains with one character add up to at most this much per game day. */
export const DAILY_SMALL_CAP = 6;

export interface BondAct {
  tier: BondTier;
  /** The act touched something this character values: it counts for half as much again. */
  touchesValue?: boolean;
  /** The act went against something they value: it costs bond even if it was meant kindly. */
  offendsValue?: boolean;
}

export interface BondState {
  bond: number;
  /** A serious wrong not yet dealt with: gains are halved and the next stage is out of reach. */
  openGrievance: boolean;
  /** Small and Meaningful points already gained today. */
  smallGainsToday: number;
}

export interface BondChange {
  delta: number;
  before: number;
  after: number;
  stageBefore: Stage;
  stageAfter: Stage;
  /** A stage was reached: a moment with this character is now waiting. */
  newStage: boolean;
  /** The daily limit on small gains or an open grievance held the number back. */
  held: 'daily' | 'grievance' | null;
  smallGainsToday: number;
}

export function applyBond(state: BondState, act: BondAct): BondChange {
  const before = state.bond;
  let delta = BASE[act.tier];
  let held: BondChange['held'] = null;
  let smallGainsToday = state.smallGainsToday;

  if (act.offendsValue && delta > 0) delta = BASE.slight;
  if (delta > 0) {
    if (act.touchesValue) delta = Math.round(delta * 1.5);
    if (state.openGrievance) { delta = Math.max(1, Math.floor(delta / 2)); held = 'grievance'; }
    if (act.tier === 'small' || act.tier === 'meaningful') {
      const room = Math.max(0, DAILY_SMALL_CAP - smallGainsToday);
      if (delta > room) { delta = room; held = 'daily'; }
    }
  } else if (act.touchesValue) {
    // A wrong that touches what they care about hurts more.
    delta = Math.round(delta * 1.5);
  }

  let after = Math.max(0, Math.min(100, before + delta));
  if (state.openGrievance && delta > 0) {
    // The next stage stays out of reach until the grievance is settled.
    // From 0 ("No bond yet") the next stage is Acquaintance at 1, so the bond stays at 0.
    const ceiling = before >= 80 ? 100 : before <= 0 ? 0 : (Math.floor(before / 20) + 1) * 20 - 1;
    if (after > ceiling) { after = Math.max(before, ceiling); held = 'grievance'; }
  }
  // Only points really gained use up the day's allowance (not ones lost to the 100 limit or a grievance).
  if (delta > 0 && (act.tier === 'small' || act.tier === 'meaningful')) smallGainsToday += after - before;
  return {
    delta: after - before, before, after,
    stageBefore: stageName(before), stageAfter: stageName(after),
    newStage: stageIndex(after) > stageIndex(before),
    held, smallGainsToday,
  };
}
