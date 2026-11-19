// The Penta ruleset: shared types. Pure data, no browser APIs.
// Rules summary: docs/PLAN.md section 10. Numbers still open are listed in 10.9.

import { t } from '../i18n';

export const ATTRIBUTES =['strength', 'skill', 'resistance', 'armor', 'firepower'] as const;
export type Attribute = (typeof ATTRIBUTES)[number];

export const PATHS = ['fire', 'water', 'air', 'earth', 'light', 'dark'] as const;
export type Path = (typeof PATHS)[number];

/**
 * The name of a path as the player reads it: "Fire", "Light". (The two looks of the app, light and
 * dark, have a key of their own with a note: see src/i18n.ts.)
 */
export function pathName(path: Path): string {
  const name = path[0]!.toUpperCase() + path.slice(1);
  return t(name);
}

export const SKILLS = [
  'Animals', 'Arts', 'Athletics', 'Crime', 'Investigation', 'Languages',
  'Machines', 'Manipulation', 'Medicine', 'Science', 'Survival',
] as const;
export type SkillName = (typeof SKILLS)[number];

/** How a world has powers, if it has them. The one list of the modes: everything else is typed from it. */
export const POWERS_MODES = ['off', 'focus', 'extreme', 'gift'] as const;
export type PowersMode = (typeof POWERS_MODES)[number];

/** What a power can do in a fight, in kind. How much is the engine's to say: see gift.ts and abilities.ts. */
export const EFFECT_KINDS = ['damage', 'guard', 'stagger', 'dazzle', 'heal'] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];
/**
 * What a protagonist's own power can do to someone else's power, beside the fight effects: copy it, or
 * take it from them, for the rest of a scene. Neither is a fight effect with a number: see gift.ts.
 */
export const TAKING_KINDS = ['copy', 'steal'] as const;
export type TakingKind = (typeof TAKING_KINDS)[number];
/** The kinds a power of one's own may have: two of these. */
export const GIFT_KINDS = [...EFFECT_KINDS, ...TAKING_KINDS] as const;
export type GiftKind = (typeof GIFT_KINDS)[number];

/** A signature move of a gift: something the character has made their own and can do at will, for energy. */
export interface GiftMove {
  /** Given by the engine (g1, g2, ...): never an id of the ability library. */
  id: string;
  /** The player's words, or a model's on their behalf: shown as written, never translated. */
  name: string;
  /** 1 to 4: how far it reaches, and what it costs. Never above the gift's rank. */
  tier: number;
  text: string;
  /** What it does in a fight, if anything: one of the gift's kinds. The number follows from the tier. */
  fight?: EffectKind;
}

/**
 * A power of one's own, in a world where powers are personal (the Gift mode). What it is stands in
 * words; the rules know its rank, the kinds of effect it can have in a fight, and its moves.
 */
export interface Gift {
  name: string;
  /** What the power is and covers. Its everyday, always-on side is simply true in the story. */
  text: string;
  /** Its weakness or price, in words. May be empty. */
  limit: string;
  /** 1 to 4. No use of the power reaches further than this. */
  rank: number;
  /** The kinds of thing this power can do to others: fight effects, and for a power of one's own copying or taking another's. Two at most. */
  kinds: GiftKind[];
  moves: GiftMove[];
}

/** Where a power beyond the one a character has by nature came from. */
export const ART_SOURCES = ['taught', 'item', 'borrowed'] as const;
export type ArtSource = (typeof ART_SOURCES)[number];

/**
 * A power beyond the one a character has by nature, in a world of gifts: a discipline learned, the
 * power of an item carried, or someone's power borrowed for a scene. The power itself is a Gift, held
 * by the same rules; this records where it came from.
 */
export interface Art {
  /** Unique among a sheet's powers, and never "own": a discipline's id, an item's id, or "borrowed". */
  id: string;
  source: ArtSource;
  /** The discipline, the item, or the person it came from. */
  from?: string;
  /** A borrowed power: the id of the scene at whose end it goes back. */
  until?: string;
  /** A borrowed power that was taken: its owner cannot use it until it goes back. */
  stolen?: boolean;
  /** A carried item's power set aside: still held, not in use, and not counted among the powers. */
  aside?: boolean;
  power: Gift;
}

export type Difficulty = 'easy' | 'medium' | 'hard';
export type TableStyle = 'story' | 'adventure' | 'brutal';

/** What a character can do, in numbers. Attributes and paths run from 0 to 5. */
export interface Sheet {
  strength: number;
  skill: number;
  resistance: number;
  armor: number;
  firepower: number;
  /** Current hit points and energy. The maximum of each is 5 x Resistance (at least 1), moved by a few traits: see maxHp and maxEnergy. */
  hp: number;
  energy: number;
  paths: Partial<Record<Path, number>>;
  skills: SkillName[];
  advantages: string[];
  disadvantages: string[];
  /** Ids of known abilities (see abilities.ts). */
  abilities: string[];
  /** The character's own power, in a world of gifts: the one they have by nature (born with it, or eaten). Absent everywhere else, and for someone there who has none. */
  gift?: Gift;
  /** In a world of gifts: powers beyond that one, gained in play (gift.ts). */
  arts?: Art[];
}

/**
 * The kind of a trait as written on a sheet, in lower case: the part before any colon.
 * "Patron: Couriers' Guild" and "patron" are both "patron".
 */
export function traitKey(written: string): string {
  return written.split(':')[0]!.trim().toLowerCase();
}

/** Whether a list of traits, as written on a sheet, holds a given kind. "Curious to a fault" holds "curious". */
export function has(list: readonly string[] | undefined, kind: string): boolean {
  return !!list?.some((w) => { const k = traitKey(w); return k === kind || k.startsWith(`${kind} `); });
}

type Traits = Partial<Pick<Sheet, 'advantages' | 'disadvantages'>>;

/** Hit points at full health: 5 x Resistance, 3 more for the Tough, 3 fewer for the Frail, never less than 1. */
export function maxHp(sheet: Pick<Sheet, 'resistance'> & Traits): number {
  return Math.max(1, 5 * sheet.resistance + (has(sheet.advantages, 'tough') ? 3 : 0) - (has(sheet.disadvantages, 'frail') ? 3 : 0));
}

/** Energy when rested: 5 x Resistance, 3 more with Deep Reserves, never less than 1. */
export function maxEnergy(sheet: Pick<Sheet, 'resistance'> & Traits): number {
  return Math.max(1, 5 * sheet.resistance + (has(sheet.advantages, 'deep reserves') ? 3 : 0));
}

/** Whether someone attacks from a distance in a fight: when their Firepower is higher than their Strength. */
export function fightsAtRange(sheet: Pick<Sheet, 'strength' | 'firepower'>): boolean {
  return sheet.firepower > sheet.strength;
}

/** Game time: the day of the story and the minute of that day (0 to 1439). */
export interface Clock {
  day: number;
  minute: number;
}
