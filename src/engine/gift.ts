// A gift: one power of a character's own, in a world where powers are personal.
//
// The player says what the power is, in words. The rules know four things about it: a rank from 1 to
// 4 that caps how far any use can reach; up to two kinds of effect it can have in a fight; and a few
// signature moves, each a tier and at most one of those kinds. Every number comes from the table
// below. A model may place something on these scales (a tier, a kind); it never writes a number, and
// neither does the player.
//
//   A move                energy equal to its tier, no test of its own.
//   A new use             within the rank: one energy more, and a medium Skill test. It works once;
//                         a use that worked can be kept as a move, for a point of experience.
//   Beyond the rank       refused.
//
// A world of gifts has no paths, no library abilities and no schools.
//
// Several powers. A character has at most one power by nature (`sheet.gift`: their own, or one eaten
// from an item of power) and may gain others in play (`sheet.arts`): a discipline someone taught them,
// the power of an item they carry, someone's power borrowed for a scene. Each is a Gift, held by the
// rules above; four may be in use at once, and eight moves in all (a borrowed power's one aside). The
// power by nature is called "own"; the moves of the others are known by their power's id and their own,
// "armament:g1", so that two powers' first moves are never confused.
import type { CombatEffect, Power } from './abilities';
import { ART_SOURCES, EFFECT_KINDS, GIFT_KINDS, TAKING_KINDS, type Art, type EffectKind, type Gift, type GiftKind, type GiftMove, type Sheet, type TakingKind } from './types';

/** The highest rank a gift may have when a story starts, and the highest it can reach in play. */
export const GIFT_RANK_START = 3;
export const GIFT_RANK_MAX = 4;
/** How many kinds of fight effect one gift can produce. */
export const GIFT_KINDS_MAX = 2;
/** Moves a gift can hold for each rank: beyond that one must be forgotten before another is kept. */
export const GIFT_MOVES_PER_RANK = 2;
/** Uses that were worked out and wait to be kept: the oldest gives way to a new one. */
export const GIFT_WORKED_MAX = 3;
/** The longest each text may be, in characters. They are sent to a model every scene. */
export const GIFT_TEXT = { name: 40, text: 160, limit: 100, moveName: 40, moveText: 140 } as const;
/** Staggering someone takes at least this tier, from anyone. */
export const STAGGER_FROM_TIER = 2;

/** How much each kind does at tiers 1 to 4. They follow what the library's abilities do at those tiers. */
const VALUES: Record<Exclude<EffectKind, 'stagger'>, readonly [number, number, number, number]> = {
  damage: [2, 4, 6, 8],
  heal: [3, 5, 8, 10],
  guard: [2, 3, 4, 6],
  dazzle: [2, 3, 4, 5],
};

const whole = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0);
const tierOf = (v: unknown): number => Math.max(1, Math.min(4, whole(v) || 1));
const cut = (v: unknown, max: number): string => (typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim().slice(0, max).trim();
export const isEffectKind = (v: unknown): v is EffectKind => (EFFECT_KINDS as readonly unknown[]).includes(v);
export const isGiftKind = (v: unknown): v is GiftKind => (GIFT_KINDS as readonly unknown[]).includes(v);
export const isTakingKind = (v: unknown): v is TakingKind => (TAKING_KINDS as readonly unknown[]).includes(v);

/** What a kind of effect does in a fight at a tier, or undefined when it does nothing there (a stagger below tier 2). */
export function fightEffect(kind: EffectKind, tier: number): (CombatEffect & { needsTarget: boolean }) | undefined {
  const t = tierOf(tier);
  if (kind === 'stagger') return t >= STAGGER_FROM_TIER ? { type: 'stagger', needsTarget: true } : undefined;
  const value = VALUES[kind][t - 1]!;
  switch (kind) {
    case 'damage': return { type: 'damage', value, needsTarget: true };
    case 'dazzle': return { type: 'dazzle', value, needsTarget: true };
    case 'guard': return { type: 'guard', value, needsTarget: false };
    case 'heal': return { type: 'heal', value, needsTarget: false };
  }
}

/** The id of the power a character has by nature, among their powers. */
export const OWN_POWER = 'own';
/** How many powers can be in use at once, and how many moves of one's own a sheet holds in all. */
export const POWERS_MAX = 4;
export const MOVES_MAX = 8;
/** At most this many powers beyond the one by nature are kept on a sheet, those set aside included. */
const ARTS_KEPT = 6;

/** A power a character holds: its id among their powers ("own", or an art's), the power, and where it came from when it is not theirs by nature. */
export interface HeldPower {
  id: string;
  gift: Gift;
  art?: Art;
}

type Powers = Pick<Sheet, 'gift' | 'arts'>;

/** Every power a character can use now: the one by nature first, then the others in the order they came; those set aside are left out. */
export function powersOf(sheet: Powers): HeldPower[] {
  const out: HeldPower[] = sheet.gift ? [{ id: OWN_POWER, gift: sheet.gift }] : [];
  for (const art of sheet.arts ?? []) if (!art.aside) out.push({ id: art.id, gift: art.power, art });
  return out.slice(0, POWERS_MAX);
}

/** One of those, by its id. */
export function powerById(sheet: Powers, id: string): HeldPower | undefined {
  return powersOf(sheet).find((p) => p.id === id);
}

/** Whether a character has any power in use. */
export function hasPower(sheet: Powers): boolean {
  return powersOf(sheet).length > 0;
}

/** The id a move is known by on the sheet: its own for the power by nature, its power's and its own for any other. */
export function moveKey(power: string, move: string): string {
  return power === OWN_POWER ? move : `${power}:${move}`;
}

/** The power and the move a move's id on the sheet stands for. */
export function splitMoveKey(key: string): { power: string; move: string } {
  const at = key.lastIndexOf(':');
  return at < 0 ? { power: OWN_POWER, move: key } : { power: key.slice(0, at), move: key.slice(at + 1) };
}

/** A move as something that can be used: what the screens, the fight and the referee's list are given. */
export function movePower(move: GiftMove, power: string = OWN_POWER): Power {
  const combat = move.fight ? fightEffect(move.fight, move.tier) : undefined;
  return { id: moveKey(power, move.id), name: move.name, tier: move.tier, cost: move.tier, text: move.text, own: true, of: power, ...(combat ? { combat } : {}) };
}

/** The moves of every power a character can use, power by power, lowest tier first within each. */
export function movesOf(sheet: Powers): Power[] {
  return powersOf(sheet).flatMap((p) => p.gift.moves.map((m) => movePower(m, p.id)).sort((a, b) => a.tier - b.tier));
}

/** Moves of one's own on a sheet, in all powers that are not borrowed: they hold MOVES_MAX at most. */
export function movesHeld(sheet: Powers): number {
  return powersOf(sheet).filter((p) => p.art?.source !== 'borrowed').reduce((n, p) => n + p.gift.moves.length, 0);
}

/** How many more powers a sheet has room for now. */
export function powerRoom(sheet: Powers): number {
  return Math.max(0, POWERS_MAX - powersOf(sheet).length);
}

/** How many moves a gift of a rank can hold in play. */
export function moveRoom(rank: number): number {
  return Math.max(0, rank) * GIFT_MOVES_PER_RANK;
}

/** What a gift may be at a given moment: at the start of a story it is held tighter than in play. */
export interface GiftLimits {
  /** The highest rank. */
  rank: number;
  /** How many moves a gift of a rank may have. */
  moves: (rank: number) => number;
  /** The highest tier a move of a gift of a rank may have. */
  tier: (rank: number) => number;
}

export const GIFT_IN_PLAY: GiftLimits = { rank: GIFT_RANK_MAX, moves: moveRoom, tier: (rank) => rank };

/** The next free id for a move: g1, g2, ... */
export function nextMoveId(moves: readonly Pick<GiftMove, 'id'>[]): string {
  const taken = new Set(moves.map((m) => m.id));
  for (let n = 1; ; n++) if (!taken.has(`g${n}`)) return `g${n}`;
}

/**
 * Make a legal gift out of whatever was handed in (a model's proposal, a saved story, a form), with
 * as little change as possible, or null when there is no gift in it. Texts are cut to length, the
 * rank and the tiers brought into range, the kinds held to two, a move's fight effect dropped when it
 * is not one of the gift's kinds, moves beyond the room dropped, and ids given where they are missing.
 */
export function cleanGift(raw: unknown, limits: GiftLimits = GIFT_IN_PLAY): Gift | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const rank = Math.max(0, Math.min(limits.rank, whole(r.rank)));
  const name = cut(r.name, GIFT_TEXT.name);
  const text = cut(r.text, GIFT_TEXT.text);
  if (rank < 1 || (!name && !text)) return null;
  const top = Math.max(1, Math.min(rank, limits.tier(rank)));
  const rawMoves = (Array.isArray(r.moves) ? r.moves : []).filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null);

  // The kinds: those named, then those the moves use, two at most.
  const kinds: GiftKind[] = [];
  for (const k of [...(Array.isArray(r.kinds) ? r.kinds : []), ...rawMoves.map((m) => m.fight)]) {
    if (isGiftKind(k) && !kinds.includes(k) && kinds.length < GIFT_KINDS_MAX) kinds.push(k);
  }

  const moves: GiftMove[] = [];
  for (const m of rawMoves) {
    if (moves.length >= limits.moves(rank)) break;
    const moveName = cut(m.name, GIFT_TEXT.moveName);
    if (!moveName) continue;
    let tier = Math.min(top, tierOf(m.tier));
    let fight = isEffectKind(m.fight) && kinds.includes(m.fight) ? m.fight : undefined;
    // A stagger takes tier 2: raised to it where the gift allows, otherwise the move does nothing in a fight.
    if (fight === 'stagger' && tier < STAGGER_FROM_TIER) { if (top >= STAGGER_FROM_TIER) tier = STAGGER_FROM_TIER; else fight = undefined; }
    const id = typeof m.id === 'string' && /^g\d+$/.test(m.id) && !moves.some((x) => x.id === m.id) ? m.id : '';
    moves.push({ id, name: moveName, tier, text: cut(m.text, GIFT_TEXT.moveText), ...(fight ? { fight } : {}) });
  }
  for (const m of moves) if (!m.id) m.id = nextMoveId(moves);
  return { name, text, limit: cut(r.limit, GIFT_TEXT.limit), rank, kinds, moves };
}

/** A use of a power that worked once and can be kept as a move: what was tried, and how the referee rated it. */
export interface Worked {
  /** What the player typed when they did it. */
  text: string;
  tier: number;
  fight?: EffectKind;
  /** The power it was a use of: "own" when absent. */
  power?: string;
}

/** 'full': the power holds no more moves at its rank. 'all': the sheet holds MOVES_MAX. 'borrowed': nothing is kept from a borrowed power. */
export type CannotKeep = 'no_gift' | 'full' | 'all' | 'borrowed' | 'xp' | 'name' | 'tier';

/** Whether a worked-out use can be kept as a move now, with this name and at this tier (its own, or lower). */
export function canKeep(sheet: Powers, worked: Worked, name: string, tier: number, xp: number, cost: number): CannotKeep | null {
  const held = powerById(sheet, worked.power ?? OWN_POWER);
  if (!held) return 'no_gift';
  const gift = held.gift;
  if (held.art?.source === 'borrowed') return 'borrowed';
  if (gift.moves.length >= moveRoom(gift.rank)) return 'full';
  if (movesHeld(sheet) >= MOVES_MAX) return 'all';
  if (!name.trim()) return 'name';
  if (!Number.isInteger(tier) || tier < 1 || tier > Math.min(worked.tier, gift.rank)) return 'tier';
  return xp < cost ? 'xp' : null;
}

/** A sheet with one of its powers replaced: the power by nature, or an art. */
export function withPower(sheet: Sheet, id: string, gift: Gift): Sheet {
  if (id === OWN_POWER) return { ...sheet, gift };
  return { ...sheet, arts: (sheet.arts ?? []).map((a) => (a.id === id ? { ...a, power: gift } : a)) };
}

/**
 * Make a legal list of powers beyond the one by nature out of whatever was handed in (a saved story),
 * or undefined when none is left: each power cleaned as a gift is, ids that are plain and unique and
 * never "own", a known source, and no more than a sheet keeps.
 */
export function cleanArts(raw: unknown): Art[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Art[] = [];
  for (const r of raw) {
    if (typeof r !== 'object' || r === null || out.length >= ARTS_KEPT) continue;
    const a = r as Record<string, unknown>;
    const id = typeof a.id === 'string' ? a.id.trim() : '';
    const source = ART_SOURCES.find((s) => s === a.source);
    const power = cleanGift(a.power, GIFT_IN_PLAY);
    if (!/^[a-z0-9_]{1,40}$/.test(id) || id === OWN_POWER || out.some((x) => x.id === id) || !source || !power) continue;
    const word = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 60) : undefined);
    const from = word(a.from);
    const until = word(a.until);
    out.push({
      id, source, ...(from ? { from } : {}), ...(until && source === 'borrowed' ? { until } : {}),
      ...(a.stolen === true && source === 'borrowed' ? { stolen: true } : {}), ...(a.aside === true && source === 'item' ? { aside: true } : {}),
      power,
    });
  }
  return out.length ? out : undefined;
}

/** The gift with a worked-out use kept as a move. The name and the line are the player's; the tier and the kind are as rated (the tier may be lowered). */
export function keepMove(gift: Gift, worked: Worked, name: string, text: string, tier: number): Gift {
  const t = Math.max(1, Math.min(gift.rank, worked.tier, tierOf(tier)));
  const fight = worked.fight && gift.kinds.includes(worked.fight) && fightEffect(worked.fight, t) ? worked.fight : undefined;
  const move: GiftMove = {
    id: nextMoveId(gift.moves), name: cut(name, GIFT_TEXT.moveName), tier: t,
    text: cut(text, GIFT_TEXT.moveText) || cut(worked.text, GIFT_TEXT.moveText), ...(fight ? { fight } : {}),
  };
  return { ...gift, moves: [...gift.moves, move] };
}

/** The gift without one of its moves. */
export function forgetMove(gift: Gift, id: string): Gift {
  return { ...gift, moves: gift.moves.filter((m) => m.id !== id) };
}
