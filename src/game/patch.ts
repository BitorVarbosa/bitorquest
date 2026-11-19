// Undo records: how to take a piece of plain data back to what it was.
//
// After every turn the story is compared with what it was before the turn, and the difference is kept
// with the turn, written backwards: applying it to the newer story gives the older one, exactly. That
// is what rewinding is made of. Nothing in the rules has to know about it: whatever a turn changed
// (a bond, the clock, hit points, a new scene, the dice), the comparison finds it.
//
// The record is small because it stores only what was there before: a number that changed is one
// number, and a list that grew is just its earlier length.

export type Undo =
  /** Put this value back, whole. */
  | { s: unknown }
  /** The key did not exist before: remove it. */
  | { d: 1 }
  /** Changes inside an object, by key. */
  | { o: Record<string, Undo> }
  /** Changes inside a list: by position, then `t` goes back on the end, then the list is cut to `n`. */
  | { a: Record<string, Undo>; n: number; t?: unknown[] };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * What it takes to turn `after` back into `before`, or null when they are the same. Both must be plain
 * data (what JSON can hold); a key whose value is undefined counts as absent, as it does in a saved file.
 * `before` must not be changed afterwards: the record keeps pieces of it.
 */
export function undoOf(before: unknown, after: unknown): Undo | null {
  if (before === after) return null;
  if (Array.isArray(before) && Array.isArray(after)) {
    const a: Record<string, Undo> = {};
    const common = Math.min(before.length, after.length);
    let changed = 0;
    for (let i = 0; i < common; i++) {
      const p = undoOf(before[i], after[i]);
      if (p) { a[i] = p; changed += 1; }
    }
    if (changed === 0 && before.length === after.length) return null;
    // A list with something taken out of its middle differs at every position after it: keeping the old list whole is smaller and simpler.
    if (changed > 2 && changed * 2 > common) return { s: before };
    return before.length > after.length ? { a, n: before.length, t: before.slice(after.length) } : { a, n: before.length };
  }
  if (isObject(before) && isObject(after)) {
    const o: Record<string, Undo> = {};
    let any = false;
    for (const k of Object.keys(before)) {
      if (before[k] === undefined) continue;
      if (after[k] === undefined) { o[k] = { s: before[k] }; any = true; continue; }
      const p = undoOf(before[k], after[k]);
      if (p) { o[k] = p; any = true; }
    }
    for (const k of Object.keys(after)) {
      if (after[k] !== undefined && before[k] === undefined) { o[k] = { d: 1 }; any = true; }
    }
    return any ? { o } : null;
  }
  return { s: before };
}

/** Take `value` back, in place where it is a list or an object. Returns the value as it was (a new one when it was replaced whole). */
export function applyUndo<T>(value: T, undo: Undo): T {
  if ('s' in undo) return structuredClone(undo.s) as T;
  if ('d' in undo) throw new Error('a removal belongs to a key, not to a value');
  if ('o' in undo) {
    if (!isObject(value)) throw new Error('the undo record does not fit: expected an object');
    const obj: Record<string, unknown> = value;
    for (const [k, p] of Object.entries(undo.o)) {
      if ('d' in p) delete obj[k];
      else obj[k] = applyUndo(obj[k], p);
    }
    return value;
  }
  if (!Array.isArray(value)) throw new Error('the undo record does not fit: expected a list');
  for (const [i, p] of Object.entries(undo.a)) {
    if (Number(i) >= value.length) throw new Error('the undo record does not fit: the list is shorter than it was');
    value[Number(i)] = applyUndo(value[Number(i)], p);
  }
  if (undo.t) value.push(...(structuredClone(undo.t) as unknown[]));
  value.length = undo.n;
  return value;
}
