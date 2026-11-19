// The table: whose turn it is to throw, and how a throw is timed.
//
// The rules settle a turn the moment it is sent, dice included: the numbers come from the story's own
// dice, which is why taking an action back and sending it again meets the same roll. What the player
// has not seen yet is simply not shown. Each card that holds dice waits to be thrown, in order, and
// what follows it in the turn (the next blow, the telling) waits for it to come to rest.
import type { Beat } from '../game/types';

/** How the dice of a card stand: lying as they fell, waiting to be thrown, or being thrown. */
export type ThrowState = 'still' | 'ready' | 'rolling';

/** How long a throw lasts, in milliseconds. */
export const THROW_MS = 1500;
/** When the die meets the table for the third and last time, and shows the face it was always going to show. */
export const REST_MS = 1170;
/** How far apart dice that are thrown together leave the hand. */
export const STAGGER_MS = 200;

/** When the faces change during a throw: every few hundredths of a second at first, then slower, the way a die loses speed. */
export const FLIPS: readonly number[] = (() => {
  const out: number[] = [];
  for (let at = 80, step = 38; at < REST_MS - 110; at += step, step *= 1.1) out.push(Math.round(at));
  return out;
})();

const anyBut = (avoid: number[], random: () => number): number => {
  const free = [1, 2, 3, 4, 5, 6].filter((f) => !avoid.includes(f));
  return free[Math.min(free.length - 1, Math.floor(random() * free.length))] ?? 1;
};

/**
 * The faces a die shows on its way to `face`: one as it leaves the hand and one for each change after.
 * No face comes twice in a row and the last is not the one it lands on, so that every change can be seen.
 * This is for show only: what the die lands on was rolled by the rules, from the story's dice.
 */
export function faceRun(face: number, random: () => number = Math.random): number[] {
  const out: number[] = [];
  for (let i = 0; i <= FLIPS.length; i++) out.push(anyBut(i === FLIPS.length ? [out[i - 1] ?? 0, face] : [out[i - 1] ?? 0], random));
  return out;
}

/** Where the dice of one turn stand. */
export interface Table {
  /** The number of the turn. */
  n: number;
  /** How many of its cards with dice have come to rest. */
  landed: number;
  /** 'wait': the next card waits for the player. 'one': it is in the air. 'all': every card left is being thrown, one after another. */
  go: 'wait' | 'one' | 'all';
}

/** A card with dice on it: an attack (two dice) or a test that was rolled (some tests need no roll). */
export const hasDice = (b: Beat): boolean => b.type === 'attack' || (b.type === 'check' && b.result.die !== null);
export const diceCards = (beats: readonly Beat[]): number => beats.filter(hasDice).length;

/** How many dice the next card to be thrown holds: one for a test, two for an attack, none when nothing is left. */
export function nextDice(beats: readonly Beat[], landed: number): number {
  const next = beats.filter(hasDice)[landed];
  return !next ? 0 : next.type === 'attack' ? 2 : 1;
}

/** The table of a turn nobody has touched yet: the player throws (`own`), or the app throws everything at once. */
export const freshTable = (n: number, own: boolean): Table => ({ n, landed: 0, go: own ? 'wait' : 'all' });

/**
 * How the card at `at` stands (counting only cards with dice), and how long it waits before it leaves
 * the hand. Null: it is not on the table yet, because a throw before it has not landed.
 */
export function cardThrow(table: Table, at: number): { state: ThrowState; delay: number } | null {
  if (at < table.landed) return { state: 'still', delay: 0 };
  if (table.go === 'all') return { state: 'rolling', delay: (at - table.landed) * STAGGER_MS };
  if (at > table.landed) return null;
  return { state: table.go === 'wait' ? 'ready' : 'rolling', delay: 0 };
}

/** Whether something that holds no dice is on screen yet: nothing is told ahead of the dice that come before it. */
export const isTold = (table: Table, diceBefore: number): boolean => diceBefore <= table.landed;

/** The table once the card at `at` has come to rest. Thrown one by one, the next card waits for the player again. */
export function afterLanding(table: Table, at: number): Table {
  return { n: table.n, landed: Math.max(table.landed, at + 1), go: table.go === 'all' ? 'all' : 'wait' };
}
