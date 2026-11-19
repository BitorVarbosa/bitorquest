// Undo records: the difference between two versions of some plain data, written backwards.
import { describe, expect, it } from 'vitest';
import { applyUndo, undoOf, type Undo } from '../src/game/patch';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
/** Take `after` back with the record of what changed since `before`: it must come out exactly as `before`. */
function back(before: unknown, after: unknown): { undo: Undo | null; restored: unknown } {
  const kept = clone(before); // the record keeps pieces of what it was given
  const undo = undoOf(kept, after);
  const restored = undo ? applyUndo(clone(after), clone(undo)) : clone(after); // through JSON, as it is when read from storage
  return { undo, restored };
}

describe('an undo record', () => {
  it('is nothing when nothing changed', () => {
    const v = { a: 1, b: [1, { c: 'x' }], d: null };
    expect(undoOf(clone(v), clone(v))).toBeNull();
  });

  it('puts a changed number, word or flag back', () => {
    expect(back({ hp: 12, name: 'Aren', up: true }, { hp: 9, name: 'Aren', up: false }).restored).toEqual({ hp: 12, name: 'Aren', up: true });
    expect(back({ hp: 12 }, { hp: 9 }).undo).toEqual({ o: { hp: { s: 12 } } });
  });

  it('remembers a list that grew as nothing but its earlier length', () => {
    const before = { events: [{ id: 'e1' }, { id: 'e2' }] };
    const after = { events: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3', text: 'a long new event' }, { id: 'e4' }] };
    const { undo, restored } = back(before, after);
    expect(undo).toEqual({ o: { events: { a: {}, n: 2 } } });
    expect(restored).toEqual(before);
  });

  it('puts back what was taken off the end of a list, and what was taken out of its middle', () => {
    expect(back([1, 2, 3, 4], [1, 2]).restored).toEqual([1, 2, 3, 4]);
    expect(back([1, 2, 3, 4], []).restored).toEqual([1, 2, 3, 4]);
    expect(back(['a', 'b', 'c', 'd', 'e', 'f'], ['a', 'c', 'd', 'e', 'f']).restored).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(back([{ id: 1 }, { id: 2 }, { id: 3 }], [{ id: 1 }, { id: 3 }]).restored).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('removes a key that was added and returns one that was removed', () => {
    expect(back({ a: 1 }, { a: 1, b: { deep: true } }).restored).toEqual({ a: 1 });
    expect(back({ a: 1, b: { deep: true } }, { a: 1 }).restored).toEqual({ a: 1, b: { deep: true } });
  });

  it('treats a key set to undefined as absent, as a saved file does', () => {
    expect(undoOf({ a: 1 }, { a: 1, lead: undefined })).toBeNull();
    const { restored } = back({ a: 1, lead: [1] }, { a: 1, lead: undefined });
    expect(restored).toEqual({ a: 1, lead: [1] });
  });

  it('handles a value that changed kind: null, list, object, number', () => {
    const kinds: unknown[] = [null, 0, '', 'x', [], [1], {}, { a: 1 }, true];
    for (const a of kinds) for (const b of kinds) expect(back({ v: a }, { v: b }).restored, `${JSON.stringify(a)} -> ${JSON.stringify(b)}`).toEqual({ v: a });
  });

  it('changes deep inside are kept small', () => {
    const before = { world: { people: { mira: { bond: 52, attitude: 'Trusts you', values: ['honesty'] }, tobin: { bond: 9 } } }, clock: { day: 12, minute: 1090 } };
    const after = clone(before);
    after.world.people.mira.bond = 55;
    after.clock.minute = 1100;
    const { undo, restored } = back(before, after);
    expect(restored).toEqual(before);
    expect(JSON.stringify(undo).length).toBeLessThan(120);
  });

  it('can be applied in a chain, newest first, to walk back through many versions', () => {
    const versions: unknown[] = [{ n: 0, log: [], who: {} }];
    const undos: Undo[] = [];
    let seed = 7;
    const rnd = (k: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % k; };
    for (let i = 1; i <= 200; i++) {
      const v = clone(versions[versions.length - 1]) as { n: number; log: unknown[]; who: Record<string, unknown>; extra?: unknown };
      v.n = i;
      const what = rnd(6);
      if (what === 0) v.log.push({ id: i, text: `event ${i}`, tags: [rnd(5), rnd(5)] });
      else if (what === 1 && v.log.length) v.log.splice(rnd(v.log.length), 1);
      else if (what === 2) v.who[`p${rnd(8)}`] = { bond: rnd(100), mood: ['wary', 'warm', 'cold'][rnd(3)] };
      else if (what === 3) delete v.who[`p${rnd(8)}`];
      else if (what === 4) v.extra = rnd(2) ? { combat: { round: rnd(9), order: ['a', 'b', 'c'].slice(0, rnd(4)) } } : undefined;
      else if (v.log.length) (v.log[rnd(v.log.length)] as { text: string }).text += '!';
      const undo = undoOf(clone(versions[versions.length - 1]), v);
      undos.push(undo ?? { o: {} });
      versions.push(clone(v));
    }
    let now = clone(versions[versions.length - 1]);
    for (let i = versions.length - 1; i >= 1; i--) {
      now = applyUndo(now, clone(undos[i - 1]!));
      expect(now, `back to version ${i - 1}`).toEqual(versions[i - 1]);
    }
  });

  it('refuses to be applied to something it does not fit', () => {
    expect(() => applyUndo([1], { o: { a: { s: 1 } } })).toThrow();
    expect(() => applyUndo({ a: 1 }, { a: {}, n: 0 })).toThrow();
    expect(() => applyUndo([1], { a: { 5: { s: 1 } }, n: 1 })).toThrow();
  });
});
