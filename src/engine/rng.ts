// Dice. A small seedable generator (mulberry32) so that every roll can be replayed in tests
// and saved with a story: the whole state is one number.
// Dice are always rolled here, by code. No model ever produces a roll.

export interface Rng {
  state: number;
}

export function makeRng(seed: number): Rng {
  return { state: seed >>> 0 };
}

/** A float in [0, 1). Advances the generator. */
export function nextFloat(rng: Rng): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0;
  let t = rng.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** One six-sided die: 1 to 6. */
export function d6(rng: Rng): number {
  return 1 + Math.floor(nextFloat(rng) * 6);
}

/** An integer from 0 to n - 1. */
export function pick(rng: Rng, n: number): number {
  return Math.floor(nextFloat(rng) * n);
}

/** A generator that returns the given dice in order, then repeats the last one. For tests. */
export function fixedDice(...faces: number[]): Rng & { faces: number[] } {
  return { state: 0, faces: [...faces] };
}

/** d6 that honours fixedDice. Every engine function rolls through this. */
export function roll(rng: Rng): number {
  const fixed = (rng as Partial<{ faces: number[] }>).faces;
  if (fixed) {
    const face = fixed.length > 1 ? fixed.shift() : fixed[0];
    return face ?? 1;
  }
  return d6(rng);
}
