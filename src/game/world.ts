// What every world must satisfy, however it was made, and the numbers code gives to what a world
// describes in words.
//
// A world built by the model and a world written by hand pass the same check before a story may
// start in them. The model never writes a number the rules depend on: it says a person is "able" in
// a fight, and the numbers for "able" are here.
import { ABILITIES, EFFECT_KINDS, GIFT_KINDS_MAX, PATHS, PLAIN_ANCESTRY, POWERS_MODES, abilitiesOf, checkAncestry, fightEffect, type CombatEffect, type CreationRules, type Path, type TableStyle } from '../engine';
import type { FightStats, PersonPower, World } from './types';

/** At most this many disciplines, and items of power, in a world of gifts. */
export const DISCIPLINES_MAX = 4;
export const RELICS_MAX = 2;

/** The colours a world can be tinted with, by name. The model picks a name; the colour is ours. */
export const ACCENTS = {
  teal: '#2bb3a3', amber: '#d9a441', rose: '#d96a8a', violet: '#8f7ae6', green: '#5fb36a', blue: '#4f9be0', red: '#d9634f', slate: '#8a97a8',
} as const;
export type AccentName = keyof typeof ACCENTS;

/** The colours people are told apart by on screen, given out in turn to named people. */
export const HUES = ['mira', 'tobin', 'roth', 'lise', 'hask', 'dace', 'sela'] as const;

/** How able someone is in a fight, in words. */
export type FighterLevel = 'no' | 'weak' | 'able' | 'dangerous';

/** The numbers behind those words. Tuned against a Champion: an able fighter is an even match, a dangerous one is not. */
const FIGHTERS: Record<FighterLevel, Omit<FightStats, 'ranged' | 'fights'>> = {
  no: { strength: 0, skill: 1, armor: 0, firepower: 0, hp: 5 },
  weak: { strength: 1, skill: 2, armor: 0, firepower: 0, hp: 5 },
  able: { strength: 2, skill: 2, armor: 1, firepower: 0, hp: 10 },
  dangerous: { strength: 3, skill: 3, armor: 2, firepower: 0, hp: 15 },
};

/** Fight numbers for a person described in words. Someone who fights at range has their strength in their aim. */
export function fightStats(level: FighterLevel, ranged = false): FightStats {
  const f = FIGHTERS[level];
  return ranged
    ? { ...f, strength: Math.max(0, f.strength - 1), firepower: Math.max(1, f.strength), ranged: true, fights: level !== 'no' }
    : { ...f, fights: level !== 'no' };
}

/**
 * The tier of a person's own power, from how able they are in a fight (a world of gifts). The power
 * comes on top of their attack, on their first turn and every third after it, so it is held low: at
 * tier 1 it costs a Champion who uses their own moves up to about fifteen points of their chance in
 * a fight; at tier 2 a dangerous opponent's took twenty-six from the weakest of them, and the
 * encounter tuner answered by halving that opponent's hit points (tests/gift.test.ts plays it out).
 * What makes someone dangerous is their numbers; their power is what makes them themselves.
 */
export const POWER_TIER: Record<FighterLevel, number> = { no: 0, weak: 1, able: 1, dangerous: 1 };
/**
 * How strong a person's power is when someone else holds it (copied or taken): its rank, set by code
 * from how able they are in a fight. It is not what they do with it in a fight: that is held to tier 1.
 */
export const POWER_RANK: Record<FighterLevel, number> = { no: 1, weak: 1, able: 2, dangerous: 3 };
export const POWER_KINDS = ['damage', 'guard', 'stagger', 'dazzle', 'seal', 'steal'] as const;

/**
 * A person's power as the world keeps it, from what the builder said of it: a name, a line, and one
 * of six things it does in a fight. Nothing when it has no name, does none of the six, or belongs
 * to someone who does not fight. Making someone lose an action is beyond a weak fighter: theirs only
 * spoils an attack. A power that steals says whether it holds what it takes or erases it.
 */
export function personPower(raw: unknown, level: FighterLevel): PersonPower | undefined {
  if (typeof raw !== 'object' || raw === null || level === 'no') return undefined;
  const r = raw as Record<string, unknown>;
  const cut = (v: unknown, max: number) => (typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  const name = cut(r.name, 40);
  const kind = POWER_KINDS.find((k) => k === r.fight);
  if (!name || !kind) return undefined;
  return {
    name, text: cut(r.text, 100), fight: kind === 'stagger' && level === 'weak' ? 'dazzle' : kind, tier: POWER_TIER[level], rank: POWER_RANK[level],
    ...(kind === 'steal' ? { keeps: r.keeps === 'erased' ? 'erased' as const : 'held' as const } : {}),
  };
}

/** How many of the protagonist's turns a person's seal (or the grip of a thief) stops their powers for. */
export const SEAL_TURNS = 1;

/** What a person's power does when they use it in a fight. A thief's grip seals, as a seal does: the taking comes if they win. */
export function powerEffect(power: PersonPower): CombatEffect {
  if (power.fight === 'seal' || power.fight === 'steal') return { type: 'seal', turns: SEAL_TURNS };
  if (power.fight === 'stagger') return { type: 'stagger' };
  const effect = fightEffect(power.fight, power.tier);
  // The four kinds a person can have all do something at every tier but a stagger, handled above.
  return effect ?? { type: 'dazzle', value: 2 };
}

/** How far someone has come in the path they practise, in words, and the highest tier they can teach. */
export const MASTERY = { dabbler: 1, adept: 2, master: 4 } as const;
export type Mastery = keyof typeof MASTERY;

/** The abilities a person can teach, from the path they practise and how far they have come. Only a world of paths has teachers. */
export function teachesOf(craft: { path: Path; mastery: Mastery } | null | undefined, powers: World['rules']['powers']): string[] {
  if (powers !== 'focus' || !craft || !(PATHS as readonly string[]).includes(craft.path)) return [];
  const top = MASTERY[craft.mastery] ?? 1;
  return abilitiesOf(craft.path).filter((a) => a.tier <= top).map((a) => a.id);
}

/** Destiny points a chapter, by table style: generous, a few, none. */
export const DESTINY_BY_STYLE: Record<TableStyle, number> = { story: 5, adventure: 3, brutal: 0 };

/** What a world allows at character creation. */
export function creationRules(world: World): CreationRules {
  const ancestries = world.ancestries?.length ? world.ancestries : [PLAIN_ANCESTRY];
  return { level: world.rules.level ?? 'champion', powers: world.rules.powers, pathCap: world.rules.pathCap, ancestries };
}

export function countsOf(world: World): { regions: number; places: number; people: number } {
  const places = Object.values(world.places);
  const regions = places.filter((p) => p.kind === 'region' || (p.kind === 'settlement' && places.find((x) => x.id === p.parent)?.kind === 'world')).length;
  const people = Object.values(world.people).filter((p) => p.count === 1 && p.tier !== 'extra').length;
  return { regions, places: places.filter((p) => p.kind !== 'world').length - regions, people };
}

/** Stepping from a place into one of the places inside it takes this long when no route says otherwise. */
export const STEP_INSIDE_MINUTES = 10;

/**
 * Where one can go from a place in one journey, and how long it takes. Three kinds of way:
 *   - a route that starts at the place itself;
 *   - a route that starts at a place it lies inside: the road from the city to the salt flats can be
 *     taken from the market, because the market is in the city;
 *   - a step into one of the places it holds: from the city as a whole into one of its districts.
 * Hidden places are included; callers leave them out of what the player is shown.
 */
export function neighbours(world: World, id: string): { id: string; minutes: number; note?: string }[] {
  const places = world.places;
  const here = places[id];
  if (!here) return [];
  const chain: string[] = []; // the place, then what it is inside, outward
  for (let cur: string | null = id, i = 0; cur && places[cur] && i < 20; cur = places[cur]!.parent, i++) chain.push(cur);
  const holds = new Set(chain);
  const best = new Map<string, { id: string; minutes: number; note?: string }>();
  const offer = (to: string, minutes: number, note?: string) => {
    if (to === id || holds.has(to) || !places[to]) return;
    const had = best.get(to);
    if (!had || minutes < had.minutes) best.set(to, { id: to, minutes, ...(note ? { note } : {}) });
  };
  for (const r of world.routes) {
    const from = holds.has(r.a) ? r.a : holds.has(r.b) ? r.b : null;
    if (!from) continue;
    const to = from === r.a ? r.b : r.a;
    if (holds.has(to)) continue; // a route between two places this one is inside leads nowhere new
    // A route from a place this one is inside, to somewhere else inside that same place, is a route between its parts: only the direct ones count.
    if (from !== id) {
      let up: string | null = places[to]?.parent ?? null;
      let within = false;
      for (let i = 0; up && i < 20; up = places[up]?.parent ?? null, i++) if (up === from) { within = true; break; }
      if (within) continue;
    }
    offer(to, r.minutes, r.note);
  }
  for (const p of Object.values(places)) if (p.parent === id) offer(p.id, STEP_INSIDE_MINUTES);
  return [...best.values()];
}

/** One journey from a to b: how long, or null when there is no way in one journey. */
export function wayBetween(world: World, a: string, b: string): { minutes: number; note?: string } | null {
  const n = neighbours(world, a).find((x) => x.id === b);
  return n ? { minutes: n.minutes, ...(n.note ? { note: n.note } : {}) } : null;
}

const ID = /^[a-z0-9][a-z0-9_]*$/;

/**
 * Everything wrong with a world, in words, or an empty list when a story can start in it. It checks
 * what the game reaches for without looking: that ids are well formed and match their keys, that
 * every place hangs from the one root, that routes join places that exist, that the starting place
 * can be left, that everyone is somewhere, and that the rules are ones the engine knows.
 */
export function checkWorld(world: World): string[] {
  const out: string[] = [];
  const places = world.places;
  const ids = Object.keys(places);
  if (!world.id || !world.name.trim()) out.push('the world has no name');
  if (!world.core.trim()) out.push('the world has no description for the narrator');
  if (ids.length === 0) return [...out, 'the world has no places'];

  const roots = ids.filter((id) => places[id]!.parent === null);
  if (roots.length !== 1) out.push(`the world must have exactly one outermost place; it has ${roots.length}`);
  for (const id of ids) {
    const p = places[id]!;
    if (p.id !== id) out.push(`the place "${id}" is filed under the wrong id`);
    if (!ID.test(id)) out.push(`the place id "${id}" is not well formed`);
    if (!p.name.trim()) out.push(`the place "${id}" has no name`);
    if (!p.card.trim()) out.push(`the place "${id}" has no description`);
    if (p.parent !== null && !places[p.parent]) out.push(`the place "${id}" is inside "${p.parent}", which does not exist`);
    if (!(p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100)) out.push(`the place "${id}" is off the map`);
    // No place may be inside itself, however far up.
    let up = p.parent;
    for (let i = 0; up !== null && i < 20; i++) {
      if (up === id) { out.push(`the place "${id}" is inside itself`); break; }
      up = places[up]?.parent ?? null;
    }
  }

  const seen = new Set<string>();
  for (const r of world.routes) {
    if (!places[r.a] || !places[r.b]) { out.push(`a route joins "${r.a}" and "${r.b}", and one of them does not exist`); continue; }
    if (r.a === r.b) out.push(`a route leads from "${r.a}" to itself`);
    const key = [r.a, r.b].sort().join('|');
    if (seen.has(key)) out.push(`there are two routes between "${r.a}" and "${r.b}"`);
    seen.add(key);
    if (!(r.minutes > 0 && r.minutes <= 60 * 24 * 60)) out.push(`the route between "${r.a}" and "${r.b}" has no sensible length`);
  }

  const start = places[world.startPlace];
  if (!start) out.push('the starting place does not exist');
  else {
    if (start.known === 'hidden') out.push('the starting place is hidden from the player');
    if (neighbours(world, start.id).length === 0) out.push('the starting place has no way out');
    // Every place the player knows of must be reachable from the start: a place on the map that can never be reached is a broken promise.
    const reach = new Set([start.id]);
    const queue = [start.id];
    while (queue.length) {
      for (const n of neighbours(world, queue.pop()!)) if (!reach.has(n.id)) { reach.add(n.id); queue.push(n.id); }
    }
    // A place counts as reachable if it, or a place inside it, can be reached (a region is reached through its towns).
    const inside = (id: string): boolean => reach.has(id) || ids.some((c) => places[c]!.parent === id && inside(c));
    for (const id of ids) if (places[id]!.kind !== 'world' && places[id]!.known !== 'hidden' && !inside(id)) out.push(`"${places[id]!.name}" is known to the player but cannot be reached from the start`);
  }

  for (const [id, p] of Object.entries(world.people)) {
    if (p.id !== id) out.push(`the person "${id}" is filed under the wrong id`);
    if (!ID.test(id)) out.push(`the person id "${id}" is not well formed`);
    if (places[id]) out.push(`"${id}" is the id of both a place and a person`);
    if (!p.name.trim()) out.push(`the person "${id}" has no name`);
    if (!places[p.placeId] && p.placeId !== 'nowhere') out.push(`${p.name} is at "${p.placeId}", which does not exist`);
    if (!(p.count >= 1)) out.push(`${p.name} has no number`);
    if (p.bond < 0 || p.bond > 100) out.push(`${p.name} has a bond outside 0 to 100`);
    for (const id of p.teaches ?? []) if (!ABILITIES[id]) out.push(`${p.name} teaches "${id}", which is not an ability the game knows`);
    if (p.power) {
      if (world.rules.powers !== 'gift') out.push(`${p.name} has a power of their own in a world that has none`);
      if (p.count > 1) out.push(`${p.name} are a group, and a group has no power of its own`);
      if (typeof p.power.name !== 'string' || !p.power.name.trim()) out.push(`the power of ${p.name} has no name`);
      if (!(POWER_KINDS as readonly string[]).includes(p.power.fight)) out.push(`the power of ${p.name} does nothing the game knows in a fight`);
      if (!(Number.isInteger(p.power.tier) && p.power.tier >= 1 && p.power.tier <= 4)) out.push(`the power of ${p.name} has a tier outside 1 to 4`);
    }
  }

  // Disciplines: only where powers are personal, four at most, each legal, and only those practised.
  const disciplines = world.disciplines ?? [];
  if (disciplines.length && world.rules.powers !== 'gift') out.push('it has disciplines, and powers are not personal in it');
  if (disciplines.length > DISCIPLINES_MAX) out.push(`it has ${disciplines.length} disciplines, more than ${DISCIPLINES_MAX}`);
  const disciplineIds = new Set<string>();
  for (const d of disciplines) {
    if (disciplineIds.has(d.id)) out.push(`the discipline "${d.id}" is there twice`);
    disciplineIds.add(d.id);
    if (!ID.test(d.id)) out.push(`the discipline id "${d.id}" is not well formed`);
    if (!d.name.trim()) out.push(`the discipline "${d.id}" has no name`);
    if (d.kinds.length > GIFT_KINDS_MAX || d.kinds.some((k) => !(EFFECT_KINDS as readonly string[]).includes(k))) out.push(`the discipline "${d.id}" can do things in a fight the game does not allow`);
  }
  for (const p of Object.values(world.people)) {
    if (p.trains && !disciplineIds.has(p.trains)) out.push(`${p.name} practises "${p.trains}", which is not a discipline of this world`);
  }
  // Items of power: likewise only where powers are personal, two at most, each somewhere or with someone until it is taken.
  const relics = world.relics ?? [];
  if (relics.length && world.rules.powers !== 'gift') out.push('it has items of power, and powers are not personal in it');
  if (relics.length > RELICS_MAX) out.push(`it has ${relics.length} items of power, more than ${RELICS_MAX}`);
  const relicIds = new Set<string>();
  for (const r of relics) {
    if (relicIds.has(r.id) || disciplineIds.has(r.id)) out.push(`the item of power "${r.id}" has an id already used`);
    relicIds.add(r.id);
    if (!r.name.trim()) out.push(`the item of power "${r.id}" has no name`);
    if (r.use !== 'eaten' && r.use !== 'carried') out.push(`the item of power "${r.id}" is neither eaten nor carried`);
    if (!(r.power.rank >= 1 && r.power.rank <= 2) || r.power.kinds.length > GIFT_KINDS_MAX) out.push(`the power of the item "${r.id}" is more than an item holds`);
    if (r.taken) continue;
    if (r.holder && !world.people[r.holder]) out.push(`the item of power "${r.id}" is carried by "${r.holder}", who does not exist`);
    if (!r.holder && (!r.placeId || !places[r.placeId])) out.push(`the item of power "${r.id}" is nowhere`);
    if (r.seed && !(world.seeds ?? []).some((x) => x.id === r.seed)) out.push(`the item of power "${r.id}" belongs to "${r.seed}", which is not a situation of this world`);
  }

  const rules = world.rules;
  if (!(POWERS_MODES as readonly string[]).includes(rules.powers)) out.push('the world does not say whether it has powers');
  if (!(rules.pathCap >= 0 && rules.pathCap <= 5)) out.push('the limit on paths must be from 0 to 5');
  if (!['story', 'adventure', 'brutal'].includes(rules.style)) out.push('the world has no table style');
  if (!(rules.destinyPerChapter >= 0 && rules.destinyPerChapter <= 9)) out.push('destiny points per chapter must be from 0 to 9');
  const ancestryIds = new Set<string>();
  for (const a of world.ancestries ?? []) {
    out.push(...checkAncestry(a));
    if (ancestryIds.has(a.id)) out.push(`there are two ancestries with the id "${a.id}"`);
    ancestryIds.add(a.id);
  }
  // What becomes of someone must point at a person, and a move at a place.
  const fate = (f: { who: string; then: string; to?: string }, of: string): void => {
    if (!world.people[f.who]) out.push(`${of} says what becomes of "${f.who}", who does not exist`);
    if (!['moves', 'leaves', 'dies'].includes(f.then)) out.push(`${of} says something becomes of "${f.who}" that the game does not know`);
    if (f.then === 'moves' && (!f.to || !places[f.to])) out.push(`${of} moves "${f.who}" to a place that does not exist`);
  };
  for (const f of world.fronts ?? []) {
    if (f.stages.length < 2) out.push(`"${f.name}" needs at least two stages`);
    for (const t of f.touches) if (!places[t]) out.push(`"${f.name}" touches "${t}", which does not exist`);
    for (const x of f.fates ?? []) {
      if (!(x.stage >= 1 && x.stage <= f.stages.length)) out.push(`"${f.name}" says what becomes of someone at stage ${x.stage}, which it does not have`);
      fate(x, `"${f.name}"`);
    }
  }
  for (const s of world.seeds ?? []) {
    if (!places[s.placeId]) out.push(`the seed "${s.title}" is at "${s.placeId}", which does not exist`);
    if (s.fate) fate(s.fate, `the seed "${s.title}"`);
  }
  return out;
}
