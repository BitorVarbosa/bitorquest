// Character arithmetic: point costs at creation, experience, rest.
import { GIFT_RANK_MAX, OWN_POWER, powerById, withPower } from './gift';
import { ATTRIBUTES, PATHS, has, maxEnergy, maxHp, type Attribute, type Path, type Sheet } from './types';

export const POWER_LEVELS = {
  novice: { points: 5, disadvantages: 3 },
  seasoned: { points: 7, disadvantages: 4 },
  champion: { points: 10, disadvantages: 5 },
  legend: { points: 12, disadvantages: 6 },
} as const;
export type PowerLevel = keyof typeof POWER_LEVELS;

/** Points an attribute, a path or a skill costs at creation. Advantages carry their own cost. */
export const SKILL_COST = 2;

export function pointsSpent(sheet: Sheet, advantageCost: (name: string) => number): number {
  const attributes = ATTRIBUTES.reduce((sum, a) => sum + sheet[a], 0);
  const paths = PATHS.reduce((sum, p) => sum + (sheet.paths[p] ?? 0), 0);
  const skills = sheet.skills.length * SKILL_COST;
  const advantages = sheet.advantages.reduce((sum, name) => sum + advantageCost(name), 0);
  // The rank of a gift costs a point a level, as a path does.
  return attributes + paths + (sheet.gift?.rank ?? 0) + skills + advantages;
}

/** Experience: 10 raises an attribute or a path by one; learning a found ability costs 1. */
export const XP_PER_LEVEL = 10;
export const XP_TO_LEARN = 1;

export type RaiseBlocked = 'max' | 'cap' | 'xp';

export function canRaiseAttribute(sheet: Sheet, attribute: Attribute, xp: number): RaiseBlocked | null {
  if (sheet[attribute] >= 5) return 'max';
  return xp < XP_PER_LEVEL ? 'xp' : null;
}

export function canRaisePath(sheet: Sheet, path: Path, xp: number, storyCap: number): RaiseBlocked | null {
  const level = sheet.paths[path] ?? 0;
  if (level >= 5) return 'max';
  if (level >= storyCap) return 'cap';
  return xp < XP_PER_LEVEL ? 'xp' : null;
}

/** Raising Resistance raises the maximum for hit points and energy; the current values rise with it. */
export function raiseAttribute(sheet: Sheet, attribute: Attribute): Sheet {
  const next = { ...sheet, [attribute]: sheet[attribute] + 1 };
  if (attribute === 'resistance') {
    next.hp = sheet.hp + (maxHp(next) - maxHp(sheet));
    next.energy = sheet.energy + (maxEnergy(next) - maxEnergy(sheet));
  }
  return next;
}

export function raisePath(sheet: Sheet, path: Path): Sheet {
  return { ...sheet, paths: { ...sheet.paths, [path]: (sheet.paths[path] ?? 0) + 1 } };
}

/**
 * Raising the rank of a power costs what a path does: the power by nature, or a discipline learned.
 * 'none' when there is no such power to raise; 'fixed' for an item's power or a borrowed one, which
 * are what they are.
 */
export function canRaiseGift(sheet: Sheet, xp: number, id: string = OWN_POWER): RaiseBlocked | 'none' | 'fixed' | null {
  const held = powerById(sheet, id);
  if (!held) return 'none';
  if (held.art && held.art.source !== 'taught') return 'fixed';
  if (held.gift.rank >= GIFT_RANK_MAX) return 'max';
  return xp < XP_PER_LEVEL ? 'xp' : null;
}

export function raiseGift(sheet: Sheet, id: string = OWN_POWER): Sheet {
  const held = powerById(sheet, id);
  return held ? withPower(sheet, id, { ...held.gift, rank: held.gift.rank + 1 }) : sheet;
}

/** What it costs a character with no gift to awaken one, in a world of gifts: it starts at rank 1 with no moves. */
export const XP_TO_AWAKEN = XP_PER_LEVEL;

/** A night's rest restores everything; a short rest restores a point of each per hour, two for a Fast Healer. */
export function rest(sheet: Sheet, minutes: number): Sheet {
  if (minutes >= 6 * 60) return { ...sheet, hp: maxHp(sheet), energy: maxEnergy(sheet) };
  const gain = Math.floor(minutes / 60) * (has(sheet.advantages, 'fast healer') ? 2 : 1);
  return { ...sheet, hp: Math.min(maxHp(sheet), sheet.hp + gain), energy: Math.min(maxEnergy(sheet), sheet.energy + gain) };
}

/** Experience is awarded by rule at the end of a scene. The narrator cannot hand it out. */
export function sceneExperience(scene: { testsPassed: number; threadAdvanced: boolean; fightsWon: number; inDanger: boolean }): number {
  let xp = 0;
  if (scene.testsPassed > 0 || scene.threadAdvanced) xp += 1; // something was attempted and it moved the story
  if (scene.fightsWon > 0) xp += 1; // a worthy opponent was beaten
  if (scene.inDanger && scene.fightsWon === 0 && scene.testsPassed > 0) xp += 1; // danger survived without a fight
  return Math.min(3, xp);
}
