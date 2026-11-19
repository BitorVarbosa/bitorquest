// Filling in a sketched place.
//
// A built world has one place written in full, where the story starts. Every other place on its map
// is a sketch: a name and a line. The first time a story goes to one, what is inside it is written,
// once, and kept in that story's world from then on. So the cost of a world follows the path the
// player takes, and nobody pays for a town they never visit.
//
// As with the builder, nothing that comes back is trusted: the answer is cleaned until the world it
// is added to still passes `checkWorld`, or it is refused and the place stays a sketch.
import { Ids, Unusable, clamp, word } from './builder';
import type { ExpandOut } from './llm/architect';
import { PATHS } from '../engine';
import type { Person, Place, PlaceKind, Route, Seed, World } from './types';
import { HUES, MASTERY, fightStats, personPower, teachesOf } from './world';

/** What a place gains when it is filled in: plain data, ready to be added to a world. */
export interface Expansion {
  placeId: string;
  /** The place's own card, in place of the one line it had. */
  card: string;
  places: Place[];
  routes: Route[];
  people: Person[];
  seeds: Seed[];
}

const INSIDE: PlaceKind[] = ['settlement', 'district', 'building', 'site', 'room'];
const BONDS = ['friendship', 'romance', 'mentorship', 'rivalry', 'kinship'] as const;
const FIGHTERS = ['no', 'weak', 'able', 'dangerous'] as const;

/**
 * Clean what the model wrote for a place against the world it goes into. Throws Unusable when there
 * is too little to be worth adding (fewer than two places inside).
 */
export function cleanExpansion(raw: ExpandOut, world: World, placeId: string): Expansion {
  const host = world.places[placeId];
  if (!host) throw new Error(`unknown place ${placeId}`);
  try {
    // Ids must be new to the whole world: a place and a person may not share one either.
    const ids = new Ids([...Object.keys(world.places), ...Object.keys(world.people)]);
    const given = (Array.isArray(raw?.places) ? raw.places : []).filter((p) => typeof p?.name === 'string' && p.name.trim()).slice(0, 8);
    if (given.length < 2) throw new Unusable('Fewer than two places came back.');
    const made = given.map((p) => ({
      id: ids.take(String(p.id ?? ''), p.name, 'place'), name: word(p.name, 40),
      // A town holds districts, not other towns.
      kind: (INSIDE.includes(p.kind) && !(p.kind === 'settlement' && host.kind !== 'region') ? p.kind : host.kind === 'region' && p.kind === 'settlement' ? 'settlement' : 'site') as PlaceKind,
      parent: String(p.parent ?? ''), brief: word(p.brief, 120, word(p.name, 40)), card: word(p.card, 420, word(p.brief, 420, word(p.name, 40))),
      x: clamp(p.x, 4, 96, 50), y: clamp(p.y, 4, 96, 50),
    }));
    const inside = new Set(made.map((p) => p.id));
    // Each new place is inside the place being filled in, or inside another new one, and never inside itself.
    for (const p of made) {
      const parent = p.parent === placeId ? placeId : ids.of(p.parent);
      p.parent = parent && parent !== p.id && inside.has(parent) ? parent : placeId;
    }
    for (const p of made) {
      let up = p.parent;
      for (let i = 0; inside.has(up) && i < 20; i++) {
        if (up === p.id) { p.parent = placeId; break; }
        up = made.find((x) => x.id === up)!.parent;
      }
    }
    // Two places drawn on top of each other are moved apart.
    for (let i = 0; i < made.length; i++) {
      for (let j = 0; j < i; j++) {
        if (made[i]!.parent === made[j]!.parent && Math.hypot(made[i]!.x - made[j]!.x, made[i]!.y - made[j]!.y) < 7) { made[i]!.x = clamp(made[i]!.x + 9, 4, 96); made[i]!.y = clamp(made[i]!.y + 7, 4, 96); }
      }
    }

    const seen = new Set<string>();
    const routes: Route[] = [];
    for (const r of Array.isArray(raw.routes) ? raw.routes : []) {
      const a = ids.of(String(r?.a ?? ''));
      const b = ids.of(String(r?.b ?? ''));
      const key = [a, b].sort().join('|');
      // Only ways between the new places: the roads to the rest of the world are on the map already.
      if (!a || !b || a === b || !inside.has(a) || !inside.has(b) || seen.has(key)) continue;
      seen.add(key);
      const note = r.note ? word(r.note, 100) : '';
      routes.push({ a, b, minutes: Math.round(clamp(r.minutes, 1, 600, 10)), ...(note ? { note } : {}) });
    }
    // Places that share a parent must be joined to one another. One can always step from a place into
    // what it holds, but never back out into it: a district with no street to the next is a dead end
    // that can only be left by leaving town.
    const groups = new Map<string, typeof made>();
    for (const p of made) groups.set(p.parent, [...(groups.get(p.parent) ?? []), p]);
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const set = new Map(group.map((p) => [p.id, p.id]));
      const find = (id: string): string => { let cur = id; while (set.get(cur) !== cur) cur = set.get(cur)!; return cur; };
      for (const r of routes) if (set.has(r.a) && set.has(r.b)) set.set(find(r.a), find(r.b));
      for (;;) {
        const first = find(group[0]!.id);
        const apart = group.filter((p) => find(p.id) !== first);
        if (!apart.length) break;
        const joined = group.filter((p) => find(p.id) === first);
        // The nearest pair across the gap.
        let best: { a: string; b: string; d: number } | null = null;
        for (const p of joined) for (const q of apart) { const d = Math.hypot(p.x - q.x, p.y - q.y); if (!best || d < best.d) best = { a: p.id, b: q.id, d }; }
        routes.push({ a: best!.a, b: best!.b, minutes: Math.max(3, Math.round(best!.d / 2)) });
        set.set(find(best!.b), first);
      }
    }

    const at = (id: unknown): string => (id === placeId ? placeId : ids.of(String(id ?? '')) ?? '');
    const where = (id: unknown): string => { const got = at(id); return got === placeId || inside.has(got) ? got : placeId; };
    const hueAt = Object.values(world.people).filter((p) => p.count === 1 && p.tier !== 'extra').length;
    const people: Person[] = [];
    (Array.isArray(raw.people) ? raw.people : []).filter((p) => typeof p?.name === 'string' && p.name.trim()).slice(0, 6).forEach((p, i) => {
      const secret = p.secret ? word(p.secret, 260) : '';
      people.push({
        id: ids.take(String(p.id ?? ''), p.name, 'person'), name: word(p.name, 40), short: word(p.short, 16, p.name.trim().split(/\s+/).slice(-1)[0]!.slice(0, 16)),
        role: word(p.role, 60, 'Someone of this place'), hue: HUES[(hueAt + i) % HUES.length]!, tier: p.tier === 'major' ? 'major' : 'recurring', count: 1,
        card: word(p.card, 340, word(p.role, 340, word(p.name, 40))), ...(secret ? { secret } : {}),
        ...(word(p.look, 90) ? { look: word(p.look, 90) } : {}),
        placeId: where(p.place), inParty: false, pinned: false, met: false, unknown: true,
        kind: BONDS.includes(p.bond) ? p.bond : 'friendship', bond: 0, attitude: word(p.attitude, 24, 'Neutral'),
        values: (Array.isArray(p.values) ? p.values : []).map((v) => word(v, 28)).filter(Boolean).slice(0, 4), valuesKnown: [],
        grievance: null, pendingMoment: null, smallGains: { day: 0, points: 0 },
        fight: fightStats(FIGHTERS.includes(p.fighter) ? p.fighter : 'no', !!p.fights_at_range), aliases: [],
        ...(p.craft && (PATHS as readonly string[]).includes(p.craft.path) && p.craft.mastery in MASTERY && teachesOf(p.craft, world.rules.powers).length ? { teaches: teachesOf(p.craft, world.rules.powers) } : {}),
        // A power of their own, in a world of gifts: its tier is the code's to set, from how able they are.
        ...(world.rules.powers === 'gift' && personPower(p.power, FIGHTERS.includes(p.fighter) ? p.fighter : 'no') ? { power: personPower(p.power, FIGHTERS.includes(p.fighter) ? p.fighter : 'no')! } : {}),
        // A discipline of the world they practise, when the world has it.
        ...(world.rules.powers === 'gift' && typeof p.discipline === 'string' && (world.disciplines ?? []).some((d) => d.id === p.discipline) ? { trains: p.discipline } : {}),
      });
    });
    for (const c of (Array.isArray(raw.crowds) ? raw.crowds : []).filter((x) => typeof x?.name === 'string' && x.name.trim()).slice(0, 3)) {
      const level = FIGHTERS.includes(c.fighter) ? c.fighter : 'no';
      people.push({
        id: ids.take(String(c.id ?? ''), c.name, 'crowd'), name: word(c.name, 40), short: word(c.name, 40).split(/\s+/).slice(-1)[0]!, role: 'Of this place', hue: '', tier: 'extra',
        count: Math.round(clamp(c.count, 2, 20, 4)), card: word(c.card, 160, word(c.name, 40)), placeId: where(c.place), inParty: false, pinned: false, met: false,
        kind: 'friendship', bond: 0, attitude: word(c.attitude, 24, 'Indifferent'), values: [], valuesKnown: [], grievance: null, pendingMoment: null, smallGains: { day: 0, points: 0 },
        ...(level !== 'no' ? { fight: fightStats(level) } : {}), aliases: [],
      });
    }

    const seedIds = new Ids((world.seeds ?? []).map((s) => s.id));
    const seeds: Seed[] = (Array.isArray(raw.seeds) ? raw.seeds : []).filter((s) => typeof s?.title === 'string' && s.title.trim()).slice(0, 2).map((s) => ({
      id: seedIds.take(String(s.id ?? ''), s.title, 'seed'), title: word(s.title, 60), placeId: where(s.place),
      wants: word(s.wants, 200), obstacle: word(s.obstacle, 160), ifIgnored: word(s.if_ignored, 160), secret: word(s.secret, 200),
    }));

    return {
      placeId, card: word(raw.card, 420).length >= 20 ? word(raw.card, 420) : host.card,
      // New places are not known to the protagonist yet: arriving shows them, as arriving anywhere shows what lies next to it.
      places: made.map((p) => ({ ...p, known: 'hidden' as const })), routes, people, seeds,
    };
  } catch (err) {
    if (err instanceof Unusable) throw err;
    throw new Unusable('The answer was not in the shape that was asked for.');
  }
}

/**
 * Add a filled-in place to a world. Does nothing when the place is no longer a sketch, so it is safe
 * to apply the same expansion to two copies of a world, or twice to one.
 */
export function applyExpansion(world: World, x: Expansion): void {
  const host = world.places[x.placeId];
  if (!host?.sketch) return;
  host.card = x.card;
  delete host.sketch;
  for (const p of x.places) world.places[p.id] = structuredClone(p);
  world.routes.push(...structuredClone(x.routes));
  for (const p of x.people) world.people[p.id] = structuredClone(p);
  if (x.seeds.length) (world.seeds ??= []).push(...structuredClone(x.seeds));
}
