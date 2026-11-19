// Building a world: seven steps, each asked of the model, checked, repaired where it can be, and kept.
//
//   questions (optional) -> skeleton -> fronts -> rules -> glossary -> start -> people -> seeds -> review
//
// The draft is plain data, saved after every step, so a build survives the app being closed: opening
// the draft again goes on from the first step that is not done, and a step that was done is never
// paid for twice. Nothing the model writes is trusted as it arrives. Each answer goes through a
// cleaner that makes ids well formed and unique, drops anything that points at something that does
// not exist, brings numbers into range and joins up a map that came back in pieces; what it changed
// is noted. The world that comes out has passed the same check as a hand-made one.
//
// No React and no browser storage in here: the interface and the tests drive the same code.
import { PATHS, isEffectKind, type PowerLevel, traitDef, traitDetail, ancestryCost, type Ancestry } from '../engine';
import { m, t, tn } from '../i18n';
import { cleanDisciplines, cleanRelics } from './arts';
import { APPEARANCE_MAX, LOOK_MAX, clip } from './cards';
import { cleanMoney } from './money';
import { clipNotes, digestRequest, docRead, estimateReading, noteRequest, notesAreEnough, type DocState } from './ingest';
import {
  BUILD_STEPS, estimateBuild, questionsRequest, stepRequest,
  type BuildInput, type Question, type QuestionsOut, type StepId, type StepOut,
} from './llm/architect';
import { costOf } from './llm/models';
import type { ModelChoice } from './llm/requests';
import { LlmError, type LlmErrorKind, type LlmRequest, type LlmResponse, type Transport } from './llm/transport';
import type { Budget } from './session';
import type { Faction, Front, Person, Place, PlaceKind, Route, Seed, UsageEntry, World, WorldTemplate } from './types';
import { ACCENTS, DESTINY_BY_STYLE, HUES, MASTERY, checkWorld, fightStats, neighbours, personPower, teachesOf, type FighterLevel } from './world';

export type { BuildInput, Question, StepId } from './llm/architect';
export { BUILD_STEPS, estimateBuild } from './llm/architect';

/** A world being built. Everything needed to go on with it, as plain data. */
export interface WorldDraft {
  id: string;
  created: number;
  updated: number;
  input: BuildInput;
  /** The questions asked before building, and what was answered. Null until asked or skipped. */
  questions: { list: Question[]; answers: Record<string, string>; skipped: boolean } | null;
  /** The steps that are done, as they were kept (after cleaning). */
  steps: Partial<StepOut>;
  /** What the cleaner changed in each step, in words. */
  notes: Partial<Record<StepId, string[]>>;
  /** Every request made for this world, with what it cost. */
  usage: UsageEntry[];
  /** What each step has cost so far, in dollars, counting every time it was asked for. */
  costs: Partial<Record<StepId | 'questions' | 'reading', number>>;
  /** When the world comes from a document: what is left of it to read, and the notes taken so far. The text goes as it is read. */
  document?: DocState;
  /** Where the build stands. building: steps are being asked for. paused: stopped by the player. failed: a step did not go through. review: all seven are done. */
  state: 'input' | 'building' | 'paused' | 'failed' | 'review';
  failed?: { step: StepId | 'questions' | 'reading'; kind: LlmErrorKind | 'budget' | 'unusable'; message: string };
}

export function newDraft(id: string, input: BuildInput, now: number, document?: DocState): WorldDraft {
  const draft: WorldDraft = { id, created: now, updated: now, input: structuredClone(input), questions: null, steps: {}, notes: {}, usage: [], costs: {}, state: 'input' };
  if (document) {
    draft.document = structuredClone(document);
    // The builder's source is the notes, which do not exist yet.
    draft.input.source = { kind: 'document', text: document.digest ?? '', name: document.name };
  }
  return draft;
}

/**
 * A step's answer that cannot be repaired into something playable: the step is asked again. The message
 * is English, marked with m(): it is sent back to the model with the step asked again, and given to t()
 * where the player is shown it.
 */
export class Unusable extends Error {}

// ---------- Cleaning ----------

export const slug = (text: string): string => text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
export const clamp = (v: unknown, lo: number, hi: number, fallback = lo): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback);
export const word = (text: unknown, max: number, fallback = ''): string => (typeof text === 'string' && text.trim() ? clip(text, max) : fallback);

/** Hands out ids that are well formed and not yet taken; remembers which id each given one became. */
export class Ids {
  private taken: Set<string>;
  readonly became = new Map<string, string>();
  constructor(taken: Iterable<string> = []) { this.taken = new Set(taken); }
  take(given: string, name: string, prefix: string): string {
    let base = slug(given) || slug(name) || prefix;
    if (!/^[a-z0-9]/.test(base)) base = `${prefix}_${base}`;
    let id = base;
    for (let i = 2; this.taken.has(id); i++) id = `${base}_${i}`;
    this.taken.add(id);
    if (given && !this.became.has(given)) this.became.set(given, id);
    return id;
  }
  /** The clean id for an id the model gave, or undefined when it never named such a thing. */
  of(given: string): string | undefined { return this.became.get(given) ?? (this.taken.has(given) ? given : undefined); }
  all(): string[] { return [...this.taken]; }
}

type Cleaned<K extends StepId> = { data: StepOut[K]; notes: string[] };

function cleanSkeleton(raw: StepOut['skeleton']): Cleaned<'skeleton'> {
  const notes: string[] = [];
  const ids = new Ids();
  const regions = (raw.regions ?? []).filter((r) => typeof r?.name === 'string' && r.name.trim()).slice(0, 15).map((r) => ({
    id: ids.take(String(r.id ?? ''), r.name, 'place'), name: word(r.name, 40), kind: r.kind === 'settlement' ? 'settlement' as const : 'region' as const,
    brief: word(r.brief, 140, word(r.name, 40)), x: clamp(r.x, 4, 96, 50), y: clamp(r.y, 4, 96, 50),
  }));
  if (regions.length < 3) throw new Unusable(m('The map came back with fewer than three places.'));
  // Two places drawn on top of each other are moved apart.
  for (let i = 0; i < regions.length; i++) {
    for (let j = 0; j < i; j++) {
      if (Math.hypot(regions[i]!.x - regions[j]!.x, regions[i]!.y - regions[j]!.y) < 7) { regions[i]!.x = clamp(regions[i]!.x + 9, 4, 96); regions[i]!.y = clamp(regions[i]!.y + 7, 4, 96); }
    }
  }
  const has = new Set(regions.map((r) => r.id));
  const seen = new Set<string>();
  const routes: StepOut['skeleton']['routes'] = [];
  for (const r of raw.routes ?? []) {
    const a = ids.of(String(r?.a ?? ''));
    const b = ids.of(String(r?.b ?? ''));
    const key = [a, b].sort().join('|');
    if (!a || !b || a === b || !has.has(a) || !has.has(b) || seen.has(key)) continue;
    seen.add(key);
    routes.push({ a, b, hours: clamp(r.hours, 0.5, 24 * 30, 8), note: r.note ? word(r.note, 100) || null : null });
  }
  // The notes are shown on the review screen, in the interface language.
  if (routes.length !== (raw.routes ?? []).length) notes.push(t('Routes that led nowhere, or were given twice, were dropped.'));
  let start = ids.of(String(raw.start ?? ''));
  if (!start || !has.has(start)) { start = (regions.find((r) => r.kind === 'settlement') ?? regions[0]!).id; notes.push(t('The starting place named did not exist; the first settlement was taken.')); }
  // The map must be in one piece: anything cut off is joined to the nearest place that is not.
  const joined = new Set([start]);
  const grow = () => { for (let grew = true; grew;) { grew = false; for (const r of routes) { if (joined.has(r.a) !== joined.has(r.b)) { joined.add(r.a); joined.add(r.b); grew = true; } } } };
  grow();
  for (const lost of regions.filter((r) => !joined.has(r.id))) {
    if (joined.has(lost.id)) continue;
    const near = regions.filter((r) => joined.has(r.id)).sort((p, q) => Math.hypot(p.x - lost.x, p.y - lost.y) - Math.hypot(q.x - lost.x, q.y - lost.y))[0]!;
    routes.push({ a: near.id, b: lost.id, hours: Math.max(4, Math.round(Math.hypot(near.x - lost.x, near.y - lost.y) / 2)), note: null });
    notes.push(t('{place} could not be reached; a way to it from {from} was added.', { place: lost.name, from: near.name }));
    grow();
  }
  const colour = raw.colour in ACCENTS ? raw.colour : 'slate';
  // How people are named: kept first, as it was asked for, so that every later step reads it before it names anyone.
  return { data: { names: word(raw.names, 900), name: word(raw.name, 48, 'An Unnamed World'), pitch: word(raw.pitch, 220, 'A world waiting to be explored.'), colour, regions, routes, start }, notes };
}

/** One stage of something in motion, however it was given: as an object, or (by an earlier build) as a bare sentence. */
function stageOf(s: unknown): { what: string; news: string | null } {
  if (typeof s === 'string') return { what: word(s, 160), news: null };
  const o = (s ?? {}) as { what?: unknown; news?: unknown };
  const news = word(o.news, 200);
  return { what: word(o.what, 160), news: news.length >= 8 ? news : null };
}

function cleanFronts(raw: StepOut['fronts'], sk: StepOut['skeleton']): Cleaned<'fronts'> {
  const places = new Set(sk.regions.map((r) => r.id));
  const ids = new Ids();
  const fronts = (raw.fronts ?? []).slice(0, 5).map((f) => ({
    id: ids.take(String(f?.id ?? ''), String(f?.name ?? ''), 'front'), name: word(f?.name, 48), goal: word(f?.goal, 180),
    stages: (Array.isArray(f?.stages) ? f.stages : []).map(stageOf).filter((s) => s.what).slice(0, 5),
    touches: [...new Set((f?.touches ?? []).map(String).filter((t) => places.has(t)))],
  })).filter((f) => f.name && f.stages.length >= 2);
  const notes = fronts.length !== (raw.fronts ?? []).length ? [t('Something in motion that had no name or fewer than two stages was dropped.')] : [];
  return { data: { fronts }, notes };
}

function cleanRules(raw: StepOut['rules'], input: BuildInput): Cleaned<'rules'> {
  const notes: string[] = [];
  const level: PowerLevel = (['novice', 'seasoned', 'champion', 'legend'] as const).includes(raw.level) ? raw.level : 'champion';
  const path_cap = input.table.powers === 'focus' ? Math.round(clamp(raw.path_cap, 1, 5, 3)) : 0;
  const ids = new Ids(['plain']);
  const ancestries: StepOut['rules']['ancestries'] = [];
  for (const a of (raw.ancestries ?? []).slice(0, 3)) {
    if (!a?.name?.trim()) continue;
    const keep = (list: unknown, kind: 'advantage' | 'disadvantage') => (Array.isArray(list) ? list : []).map(String).filter((t) => {
      const d = traitDef(t);
      // A school of power is bought by a character, not born into.
      return !!d && d.kind === kind && !d.only && (!d.detail || !!traitDetail(t));
    }).slice(0, 3);
    const made: Ancestry = { id: '', name: word(a.name, 30), text: word(a.text, 200), advantages: keep(a.advantages, 'advantage'), disadvantages: keep(a.disadvantages, 'disadvantage') };
    if (made.advantages.length + made.disadvantages.length !== (a.advantages?.length ?? 0) + (a.disadvantages?.length ?? 0)) notes.push(t('{name}: traits the game does not know were left out.', { name: made.name }));
    while (made.advantages.length + made.disadvantages.length > 4) made.disadvantages.length ? made.disadvantages.pop() : made.advantages.pop();
    while (ancestryCost(made) > 3) made.advantages.pop();
    ancestries.push({ ...made, id: ids.take(String(a.id ?? ''), made.name, 'folk') });
  }
  // Disciplines, only where powers are personal: kept as the world will hold them, in the step's own shape.
  const disciplines = input.table.powers === 'gift' ? cleanDisciplines(raw.disciplines).map((d) => ({ ...d, move: { name: d.move.name, text: d.move.text, fight: d.move.fight ?? 'none' as const } })) : [];
  // The money of the world: cleaned, at most three. A builder that said nothing gives the world plain silver; an empty list is a world without money.
  const money = Array.isArray(raw.money) ? cleanMoney(raw.money, slug) : null;
  return { data: { level, path_cap, common_folk: word(raw.common_folk, 30, 'Human'), ancestries, disciplines, money: (money ?? []).map((c) => ({ ...c, of: c.of ?? null })) }, notes };
}

function cleanGlossary(raw: StepOut['glossary']): Cleaned<'glossary'> {
  const core = word(raw.core, 1500);
  if (core.length < 60) throw new Unusable(m('The description of the world for the narrator came back empty.'));
  const ids = new Ids();
  const factions = (raw.factions ?? []).filter((f) => f?.name?.trim()).slice(0, 6).map((f) => ({ id: ids.take(String(f.id ?? ''), f.name, 'power'), name: word(f.name, 48), standing: word(f.standing, 40, 'unknown') }));
  return { data: { core, factions }, notes: [] };
}

const INNER: PlaceKind[] = ['settlement', 'district', 'building', 'site', 'room'];

function cleanStart(raw: StepOut['start'], sk: StepOut['skeleton']): Cleaned<'start'> {
  const notes: string[] = [];
  const outer = new Set(sk.regions.map((r) => r.id));
  const ids = new Ids(outer);
  const given = (raw.places ?? []).filter((p) => typeof p?.name === 'string' && p.name.trim()).slice(0, 14);
  if (given.length < 2) throw new Unusable(m('The starting area came back with fewer than two places.'));
  const places = given.map((p) => ({
    id: ids.take(String(p.id ?? ''), p.name, 'place'), name: word(p.name, 40), kind: (INNER.includes(p.kind) ? p.kind : 'site') as StepOut['start']['places'][number]['kind'],
    parent: String(p.parent ?? ''), brief: word(p.brief, 120, word(p.name, 40)), card: word(p.card, 420, word(p.brief, 420, word(p.name, 40))),
    x: clamp(p.x, 4, 96, 50), y: clamp(p.y, 4, 96, 50),
  }));
  const inner = new Set(places.map((p) => p.id));
  // Each place is inside the starting place or inside another of these places, and never, however far up, inside itself.
  for (const p of places) {
    const parent = p.parent === sk.start ? sk.start : ids.of(p.parent);
    p.parent = parent && parent !== p.id && (inner.has(parent) || parent === sk.start) ? parent : sk.start;
  }
  for (const p of places) {
    let up = p.parent;
    for (let i = 0; inner.has(up) && i < 20; i++) {
      if (up === p.id) { p.parent = sk.start; notes.push(t('{name} was inside itself; it was put directly in the starting place.', { name: p.name })); break; }
      up = places.find((x) => x.id === up)!.parent;
    }
  }
  let start_place = ids.of(String(raw.start_place ?? ''));
  if (!start_place || !inner.has(start_place)) { start_place = (places.find((p) => p.kind !== 'settlement') ?? places[0]!).id; notes.push(t('The place named for the first scene did not exist; another was taken.')); }
  const seen = new Set<string>();
  const routes: StepOut['start']['routes'] = [];
  for (const r of raw.routes ?? []) {
    const a = ids.of(String(r?.a ?? ''));
    const b = ids.of(String(r?.b ?? ''));
    const key = [a, b].sort().join('|');
    // A way must touch the starting area; ways between two places of the wider map belong to the map.
    if (!a || !b || a === b || seen.has(key) || (!inner.has(a) && !inner.has(b))) continue;
    seen.add(key);
    routes.push({ a, b, minutes: Math.round(clamp(r.minutes, 1, 60 * 24 * 30, 15)), note: r.note ? word(r.note, 100) || null : null });
  }
  // Everything here must be reachable from where the first scene opens, by the same rule the game travels
  // by, and without leaving the starting area: a street one can only get to by going out of town and
  // coming back in is not joined up.
  const probe: World = {
    id: 'probe', name: 'probe', accent: '', pitch: '', core: 'probe', people: {}, factions: [], startPlace: start_place,
    rules: { powers: 'off', pathCap: 0, style: 'adventure', destinyPerChapter: 0 },
    places: Object.fromEntries([
      ['root_', { id: 'root_', name: 'root', kind: 'world' as PlaceKind, parent: null, brief: '', card: 'root', x: 50, y: 50, known: 'visited' as const }],
      ...sk.regions.map((r) => [r.id, { id: r.id, name: r.name, kind: r.kind as PlaceKind, parent: 'root_', brief: r.brief, card: r.brief, x: r.x, y: r.y, known: 'heard' as const }]),
      ...places.map((p) => [p.id, { id: p.id, name: p.name, kind: p.kind as PlaceKind, parent: p.parent, brief: p.brief, card: p.card, x: p.x, y: p.y, known: 'heard' as const }]),
    ]),
    routes: [...sk.routes.map((r) => ({ a: r.a, b: r.b, minutes: Math.round(r.hours * 60) })), ...routes.map((r) => ({ a: r.a, b: r.b, minutes: r.minutes }))],
  };
  const reached = () => {
    const got = new Set([start_place!]);
    const queue = [start_place!];
    while (queue.length) for (const n of neighbours(probe, queue.pop()!)) if (!got.has(n.id)) { got.add(n.id); if (inner.has(n.id)) queue.push(n.id); }
    return got;
  };
  // A place counts as reached when it, or something inside it, is: the building the first scene opens in is not a place to travel to.
  const within = (id: string, got: Set<string>): boolean => got.has(id) || places.some((q) => q.parent === id && within(q.id, got));
  for (const p of places) {
    const got = reached();
    if (within(p.id, got)) continue;
    // Join it to the nearest place of the same parent that can be reached, or to where the first scene opens.
    const near = places.filter((q) => got.has(q.id) && q.parent === p.parent).sort((u, v) => Math.hypot(u.x - p.x, u.y - p.y) - Math.hypot(v.x - p.x, v.y - p.y))[0] ?? places.find((q) => q.id === start_place)!;
    const minutes = Math.max(3, Math.round(Math.hypot(near.x - p.x, near.y - p.y) / 2));
    routes.push({ a: near.id, b: p.id, minutes, note: null });
    probe.routes.push({ a: near.id, b: p.id, minutes });
    notes.push(t('{place} could not be reached; a way to it from {from} was added.', { place: p.name, from: near.name }));
  }
  return { data: { places, routes, start_place }, notes };
}

const BONDS = ['friendship', 'romance', 'mentorship', 'rivalry', 'kinship'] as const;
const FIGHTERS = ['no', 'weak', 'able', 'dangerous'] as const;

/** A person's power as the step keeps it: the words cut to length and the kind one the game knows, or nothing. */
function keptPower(raw: unknown, level: FighterLevel): StepOut['people']['people'][number]['power'] {
  const p = personPower(raw, level);
  return p ? { name: p.name, text: p.text, fight: p.fight, keeps: p.keeps ?? null } : null;
}

function cleanPeople(raw: StepOut['people'], sk: StepOut['skeleton'], st: StepOut['start'], input: BuildInput, ru?: StepOut['rules']): Cleaned<'people'> {
  // The disciplines someone may practise: those the rules step wrote (none outside a world of gifts).
  const disciplines = new Set((ru?.disciplines ?? []).map((d) => d.id));
  const notes: string[] = [];
  const places = new Set([...sk.regions.map((r) => r.id), ...st.places.map((p) => p.id)]);
  const ids = new Ids(places);
  let beside = 0;
  let strayed = 0;
  const people = (raw.people ?? []).filter((p) => typeof p?.name === 'string' && p.name.trim()).slice(0, 20).map((p) => {
    const where = String(p.place ?? '');
    if (!places.has(where)) strayed += 1;
    const withYou = !!p.travels_with_you && beside < input.table.companions;
    if (withYou) beside += 1;
    return {
      id: ids.take(String(p.id ?? ''), p.name, 'person'), name: word(p.name, 40), short: word(p.short, 16, p.name.trim().split(/\s+/).slice(-1)[0]!.slice(0, 16)),
      role: word(p.role, 60, 'Someone of this place'), tier: p.tier === 'major' ? 'major' as const : 'recurring' as const,
      place: places.has(where) ? where : st.start_place,
      card: word(p.card, 340, word(p.role, 340, word(p.name, 40))), secret: p.secret ? word(p.secret, 260) || null : null,
      look: word(p.look, LOOK_MAX), appearance: p.appearance ? word(p.appearance, APPEARANCE_MAX) || null : null,
      wish: p.wish ? word(p.wish, 160) || null : null,
      attitude: word(p.attitude, 24, 'Neutral'), why: p.why ? word(p.why, 80) || null : null,
      values: (Array.isArray(p.values) ? p.values : []).map((v) => word(v, 28)).filter(Boolean).slice(0, 4),
      bond: BONDS.includes(p.bond) ? p.bond : 'friendship' as const,
      fighter: FIGHTERS.includes(p.fighter) ? p.fighter : 'no' as const, fights_at_range: !!p.fights_at_range, travels_with_you: withYou,
      // Who practises a path, kept only in a world of paths and only when both words are ones the game knows.
      craft: input.table.powers === 'focus' && p.craft && (PATHS as readonly string[]).includes(p.craft.path) && p.craft.mastery in MASTERY ? { path: p.craft.path, mastery: p.craft.mastery } : null,
      // A power of their own, kept only in a world of gifts and only when it has a name and does one of the things a fight knows.
      power: input.table.powers === 'gift' ? keptPower(p.power, FIGHTERS.includes(p.fighter) ? p.fighter : 'no') : null,
      discipline: input.table.powers === 'gift' && typeof p.discipline === 'string' && disciplines.has(p.discipline) ? p.discipline : null,
    };
  });
  if (people.length < 3) throw new Unusable(m('Fewer than three people came back.'));
  if (strayed) notes.push(tn(strayed, '{n} person was placed somewhere that does not exist, and moved to where the story opens.', '{n} people were placed somewhere that does not exist, and moved to where the story opens.'));
  const crowds = (raw.crowds ?? []).filter((c) => typeof c?.name === 'string' && c.name.trim()).slice(0, 6).map((c) => ({
    id: ids.take(String(c.id ?? ''), c.name, 'crowd'), name: word(c.name, 40), place: places.has(String(c.place)) ? String(c.place) : st.start_place,
    count: Math.round(clamp(c.count, 2, 20, 4)), card: word(c.card, 160, word(c.name, 40)), attitude: word(c.attitude, 24, 'Indifferent'),
    fighter: FIGHTERS.includes(c.fighter) ? c.fighter : 'no' as const,
  }));
  return { data: { people, crowds }, notes };
}

const THENS = ['moves', 'leaves', 'dies'] as const;

function cleanSeeds(raw: StepOut['seeds'], sk: StepOut['skeleton'], st: StepOut['start'], input: BuildInput, fr: StepOut['fronts'] | undefined, pe: StepOut['people'] | undefined, dr?: StepOut['rules']): Cleaned<'seeds'> {
  const places = new Set([...sk.regions.map((r) => r.id), ...st.places.map((p) => p.id)]);
  // What becomes of someone: only a named person (a crowd has no fate), and a move only to a place that exists and is not where they are.
  const named = new Map((pe?.people ?? []).filter((p) => !p.travels_with_you).map((p) => [p.id, p]));
  let dropped = 0;
  const fateOf = (f: { who?: unknown; then?: unknown; to?: unknown; why?: unknown } | null | undefined) => {
    if (!f) return null;
    const who = named.get(String(f.who ?? ''));
    const then = THENS.find((t) => t === f.then);
    const to = then === 'moves' && places.has(String(f.to ?? '')) ? String(f.to) : null;
    if (!who || !then || (then === 'moves' && (!to || to === who.place))) { dropped += 1; return null; }
    return { who: who.id, then, to, why: word(f.why, 90, then === 'dies' ? 'they died' : then === 'moves' ? 'they moved on' : 'they left') };
  };
  const ids = new Ids();
  const seeds = (raw.seeds ?? []).filter((s) => typeof s?.title === 'string' && s.title.trim()).slice(0, 8).map((s) => {
    const news = word(s.news, 200);
    return {
      id: ids.take(String(s.id ?? ''), s.title, 'seed'), title: word(s.title, 60), place: places.has(String(s.place)) ? String(s.place) : st.start_place,
      wants: word(s.wants, 200), obstacle: word(s.obstacle, 160), if_ignored: word(s.if_ignored, 160), secret: word(s.secret, 200),
      news: news.length >= 8 ? news : null, becomes: fateOf(s.becomes),
    };
  });
  // A stage that takes someone away: the thing in motion and the stage must exist, and nobody is taken away twice.
  const stages = new Map((fr?.fronts ?? []).map((f) => [f.id, f.stages.length]));
  const taken = new Set(seeds.map((s) => s.becomes?.who).filter(Boolean));
  const fates = (Array.isArray(raw.fates) ? raw.fates : []).slice(0, 6).flatMap((f) => {
    const fate = fateOf(f);
    if (!fate) return [];
    const front = String(f?.front ?? '');
    const stage = Math.round(Number(f?.stage));
    if (!stages.has(front) || !(stage >= 1 && stage <= stages.get(front)!) || taken.has(fate.who)) { dropped += 1; return []; }
    taken.add(fate.who);
    return [{ front, stage, ...fate }];
  }).slice(0, 4);
  // Items of power, only where powers are personal: each lying with a situation or carried by a named person.
  const relics = input.table.powers === 'gift'
    ? cleanRelics(raw.relics, {
      places, people: new Set(named.keys()), seeds: new Map(seeds.map((x) => [x.id, x.place])),
      taken: new Set([...(dr?.disciplines ?? []).map((d) => d.id), ...seeds.map((x) => x.id), ...named.keys(), ...places]),
    }).map((r) => ({
      id: r.id, name: r.name, text: r.text, use: r.use, major: r.power.rank > 1, place: r.placeId ?? null, holder: r.holder ?? null, seed: r.seed ?? null,
      power: { name: r.power.name, text: r.power.text, limit: r.power.limit, kinds: r.power.kinds.filter(isEffectKind), move: { name: r.power.moves[0]?.name ?? '', text: r.power.moves[0]?.text ?? '', fight: r.power.moves[0]?.fight ?? 'none' as const } },
    }))
    : [];
  return {
    data: {
      story_title: word(raw.story_title, 60, sk.name), chapter_title: word(raw.chapter_title, 48, 'Arrival'),
      main_thread: word(raw.main_thread, 160, clip(`Find your way as ${input.premise.trim().replace(/\.$/, '')}.`, 160)),
      opening: word(raw.opening, 300), opening_hour: Math.round(clamp(raw.opening_hour, 0, 23, 9)), seeds, fates, relics,
    },
    notes: dropped ? [tn(dropped, '{n} thing said to become of people pointed at someone or somewhere that does not exist, and was left out.', '{n} things said to become of people pointed at someone or somewhere that does not exist, and were left out.')] : [],
  };
}

/** Clean one step's answer against the steps before it. Throws Unusable when there is not enough to play in. */
export function cleanStep<K extends StepId>(step: K, raw: StepOut[K], done: Partial<StepOut>, input: BuildInput): Cleaned<K> {
  const need = <S extends StepId>(s: S): StepOut[S] => { const d = done[s]; if (!d) throw new Error(`step ${step} needs ${s} first`); return d; };
  const run = (): Cleaned<StepId> => {
    switch (step as StepId) {
      case 'skeleton': return cleanSkeleton(raw as StepOut['skeleton']);
      case 'fronts': return cleanFronts(raw as StepOut['fronts'], need('skeleton'));
      case 'rules': return cleanRules(raw as StepOut['rules'], input);
      case 'glossary': return cleanGlossary(raw as StepOut['glossary']);
      case 'start': return cleanStart(raw as StepOut['start'], need('skeleton'));
      case 'people': return cleanPeople(raw as StepOut['people'], need('skeleton'), need('start'), input, done.rules);
      case 'seeds': return cleanSeeds(raw as StepOut['seeds'], need('skeleton'), need('start'), input, done.fronts, done.people, done.rules);
    }
  };
  try {
    return run() as Cleaned<K>;
  } catch (err) {
    if (err instanceof Unusable) throw err;
    // An answer so far from the shape asked for that cleaning it broke: treat it as unusable, not as a fault of the app.
    throw new Unusable(m('The answer was not in the shape that was asked for.'));
  }
}

// ---------- Putting the world together ----------

/** The world a finished draft describes. Throws when a step is missing. */
export function assemble(draft: WorldDraft): World {
  const s = draft.steps;
  const { skeleton: sk, fronts: fr, rules: ru, glossary: gl, start: st, people: pe, seeds: se } = s;
  if (!sk || !fr || !ru || !gl || !st || !pe || !se) throw new Error('the world is not finished');
  const table = draft.input.table;
  const taken = new Set([...sk.regions.map((r) => r.id), ...st.places.map((p) => p.id), ...pe.people.map((p) => p.id), ...pe.crowds.map((c) => c.id)]);
  let root = slug(sk.name) || 'world';
  while (taken.has(root)) root = `${root}_world`;

  // What the protagonist knows of at the start: where they are, the rest of the starting area, and the places one journey from it.
  const nextToStart = new Set(sk.routes.flatMap((r) => (r.a === sk.start ? [r.b] : r.b === sk.start ? [r.a] : [])));
  for (const r of st.routes) for (const end of [r.a, r.b]) if (sk.regions.some((x) => x.id === end)) nextToStart.add(end);
  const places: Record<string, Place> = {
    [root]: { id: root, name: sk.name, kind: 'world', parent: null, brief: sk.pitch, card: sk.pitch, x: 50, y: 50, known: 'visited' },
  };
  for (const r of sk.regions) {
    // Every place on the map but the starting one is a sketch: one line, until a story goes there.
    places[r.id] = { id: r.id, name: r.name, kind: r.kind, parent: root, brief: r.brief, card: r.brief, x: r.x, y: r.y, known: r.id === sk.start ? 'visited' : nextToStart.has(r.id) ? 'heard' : 'hidden', ...(r.id === sk.start ? {} : { sketch: true }) };
  }
  for (const p of st.places) {
    places[p.id] = { id: p.id, name: p.name, kind: p.kind, parent: p.parent, brief: p.brief, card: p.card, x: p.x, y: p.y, known: p.id === st.start_place ? 'visited' : 'heard' };
  }
  const routes: Route[] = [
    ...sk.routes.map((r) => ({ a: r.a, b: r.b, minutes: Math.round(r.hours * 60), ...(r.note ? { note: r.note } : {}) })),
    ...st.routes.map((r) => ({ a: r.a, b: r.b, minutes: r.minutes, ...(r.note ? { note: r.note } : {}) })),
  ];

  // The disciplines of a world of gifts (a draft kept by an earlier build has none).
  const disciplines = table.powers === 'gift' ? cleanDisciplines(ru.disciplines ?? []) : [];
  const people: Record<string, Person> = {};
  pe.people.forEach((p, i) => {
    people[p.id] = {
      id: p.id, name: p.name, short: p.short, role: p.role, hue: HUES[i % HUES.length]!, tier: p.tier, count: 1, card: p.card,
      ...(p.secret ? { secret: p.secret } : {}),
      // How they look (a draft kept by an earlier build says nothing of it).
      ...(p.look?.trim() ? { look: p.look.trim() } : {}), ...(p.appearance?.trim() ? { appearance: p.appearance.trim() } : {}),
      placeId: p.travels_with_you ? st.start_place : p.place, inParty: p.travels_with_you, pinned: false, met: p.travels_with_you,
      // Someone who starts at the protagonist's side is already trusted: that is the stage at which people travel together.
      kind: p.bond, bond: p.travels_with_you ? COMPANION_BOND : 0, attitude: p.attitude, ...(p.why ? { attitudeWhy: p.why } : {}),
      ...(p.wish ? { wish: p.wish } : {}),
      values: p.values, valuesKnown: [], grievance: null, pendingMoment: null, smallGains: { day: 0, points: 0 },
      fight: fightStats(p.fighter, p.fights_at_range), aliases: [],
      ...(teachesOf(p.craft, table.powers).length ? { teaches: teachesOf(p.craft, table.powers) } : {}),
      // The tier of a person's power is the code's to set, from how able they are in a fight.
      ...(table.powers === 'gift' && personPower(p.power, p.fighter) ? { power: personPower(p.power, p.fighter)! } : {}),
      // A discipline they practise (a draft kept by an earlier build has none).
      ...(table.powers === 'gift' && p.discipline && disciplines.some((d) => d.id === p.discipline) ? { trains: p.discipline } : {}),
    };
  });
  for (const c of pe.crowds) {
    people[c.id] = {
      id: c.id, name: c.name, short: c.name.split(/\s+/).slice(-1)[0]!, role: 'Of this place', hue: '', tier: 'extra', count: c.count, card: c.card,
      placeId: c.place, inParty: false, pinned: false, met: false, kind: 'friendship', bond: 0, attitude: c.attitude,
      values: [], valuesKnown: [], grievance: null, pendingMoment: null, smallGains: { day: 0, points: 0 },
      ...(c.fighter !== 'no' ? { fight: fightStats(c.fighter) } : {}), aliases: [],
    };
  }
  const ancestries: Ancestry[] = [{ id: 'plain', name: ru.common_folk, text: 'No special traits.', advantages: [], disadvantages: [] }, ...ru.ancestries];
  // A draft kept by an earlier build has its stages as bare sentences: they still make a front, with nothing said of it.
  const fronts: Front[] = fr.fronts.map((f) => {
    const stages = (f.stages as unknown[]).map(stageOf);
    // What its stages do to people (a draft kept by an earlier build says nothing of that).
    const fates = (se.fates ?? []).filter((x) => x.front === f.id && people[x.who]).map((x) => ({ stage: x.stage, ...fateFrom(x) }));
    return { id: f.id, name: f.name, goal: f.goal, stages: stages.map((s) => s.what), news: stages.map((s) => s.news), stage: 0, touches: f.touches, ...(fates.length ? { fates } : {}) };
  });
  const seeds: Seed[] = se.seeds.map((x) => ({
    id: x.id, title: x.title, placeId: x.place, wants: x.wants, obstacle: x.obstacle, ifIgnored: x.if_ignored, secret: x.secret,
    ...(x.news ? { news: x.news } : {}), ...(x.becomes && people[x.becomes.who] ? { fate: fateFrom(x.becomes) } : {}),
  }));
  const factions: Faction[] = gl.factions;
  // Items of power, where powers are personal (a draft kept by an earlier build has none).
  const relics = table.powers === 'gift' ? cleanRelics(se.relics ?? [], {
    places: new Set(Object.keys(places)), people: new Set(Object.keys(people).filter((id) => people[id]!.count === 1)),
    seeds: new Map(seeds.map((x) => [x.id, x.placeId])), taken: new Set(disciplines.map((d) => d.id)),
  }) : [];
  return {
    id: draft.id, name: sk.name, accent: ACCENTS[sk.colour] ?? ACCENTS.slate, pitch: sk.pitch, core: gl.core,
    // How people are named (a draft kept by an earlier build has nothing said of it).
    ...(sk.names?.trim() ? { names: sk.names.trim() } : {}),
    places, routes, people, factions, startPlace: st.start_place,
    rules: { powers: table.powers, pathCap: ru.path_cap, style: table.style, destinyPerChapter: DESTINY_BY_STYLE[table.style], level: ru.level },
    ancestries, fronts, seeds, ...(disciplines.length ? { disciplines } : {}), ...(relics.length ? { relics } : {}),
    // The money of the world (a draft kept by an earlier build says nothing of it, and the world has silver).
    ...(Array.isArray(ru.money) ? { money: cleanMoney(ru.money, slug) } : {}),
  };
}

/** The bond a person who starts the story at the protagonist's side begins with: the first point of Trusted. */
export const COMPANION_BOND = 40;

type Fate = NonNullable<Seed['fate']>;
const fateFrom = (x: { who: string; then: Fate['then']; to: string | null; why: string }): Fate => ({ who: x.who, then: x.then, ...(x.to ? { to: x.to } : {}), why: x.why });

/** The finished world as it goes into the library. */
export function templateOf(draft: WorldDraft, now: number): WorldTemplate {
  const world = assemble(draft);
  const se = draft.steps.seeds!;
  const { style: _style, powers: _powers, companions, ...rest } = draft.input.table;
  return {
    id: draft.id, world, premise: draft.input.premise,
    // Of a document only the name is kept: the notes did their work when the world was built.
    source: draft.input.source.kind === 'document'
      ? { kind: 'document', text: '', ...(draft.input.source.name ? { name: draft.input.source.name } : {}) }
      : { kind: draft.input.source.kind, text: draft.input.source.text },
    ...(draft.input.name.trim() ? { name: draft.input.name.trim().slice(0, 40) } : {}),
    table: { ...rest, prose: 'plain', companions, suggestions: true },
    opening: { title: se.story_title, chapter: se.chapter_title, thread: se.main_thread, line: se.opening, hour: se.opening_hour },
    built: now, cost: draft.usage.reduce((sum, u) => sum + u.cost, 0), simulated: draft.usage.length > 0 && draft.usage.every((u) => u.simulated), version: 1,
  };
}

// ---------- Running the build ----------

export interface BuilderDeps {
  transport: Transport;
  models: () => ModelChoice;
  budget: Budget;
  /** Called after every change worth keeping: a step done, a question answered, a failure. */
  save: (draft: WorldDraft) => void;
  now: () => number;
}

export class WorldBuilder {
  draft: WorldDraft;
  /** The step being asked for right now, if any. */
  current: StepId | 'questions' | 'reading' | null = null;
  private deps: BuilderDeps;
  private listeners = new Set<() => void>();
  private pauseAsked = false;

  constructor(draft: WorldDraft, deps: BuilderDeps) {
    this.draft = draft;
    this.deps = deps;
    // A draft that was building when the app closed is simply waiting to be resumed.
    if (draft.state === 'building') draft.state = 'paused';
    draft.costs ??= {};
  }

  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(): void { for (const fn of this.listeners) fn(); }
  private keep(): void { this.draft.updated = this.deps.now(); this.deps.save(this.draft); this.emit(); }

  get busy(): boolean { return this.current !== null; }
  get pausing(): boolean { return this.pauseAsked && this.busy; }
  get simulated(): boolean { return this.deps.transport.simulated; }
  /** What has been spent on this world so far, in dollars. */
  get spent(): number { return this.draft.usage.reduce((sum, u) => sum + u.cost, 0); }
  /** The steps, each marked done, in progress or waiting. */
  get progress(): { id: StepId; title: string; state: 'done' | 'now' | 'failed' | 'waiting'; cost: number }[] {
    return BUILD_STEPS.map((s) => ({
      id: s.id, title: s.title,
      state: this.draft.steps[s.id] ? 'done' : this.current === s.id ? 'now' : this.draft.failed?.step === s.id ? 'failed' : 'waiting',
      cost: this.draft.costs[s.id] ?? 0,
    }));
  }
  get next(): StepId | null { return BUILD_STEPS.find((s) => !this.draft.steps[s.id])?.id ?? null; }
  /** True once anything has been built: from then on what was asked for cannot change. */
  get started(): boolean { return Object.keys(this.draft.steps).length > 0; }
  /** What building costs from here: everything, or only `from` and the steps after it. */
  estimate(from?: StepId): { low: number; typical: number; high: number } { return estimateBuild(this.deps.models(), false, from, this.draft.input.table.powers); }
  /** What asking the questions costs. */
  estimateQuestions(): number { return estimateBuild(this.deps.models(), true).typical - estimateBuild(this.deps.models(), false).typical; }

  /**
   * Change what was asked for. Only before anything is built. Questions already asked were about the
   * old description: when the world or the premise changes they are dropped, to be asked again.
   */
  setInput(input: BuildInput): boolean {
    if (this.busy || this.started) return false;
    const was = this.draft.input;
    const doc = this.draft.document;
    // A world that comes from a document keeps it as its source whatever the form says: the notes belong to the builder, not to the form.
    const next = structuredClone(input);
    if (doc && input.source.kind === 'document') next.source = { kind: 'document', text: doc.digest ?? '', name: doc.name };
    else delete this.draft.document;
    const same = was.source.kind === next.source.kind && was.source.text.trim() === next.source.text.trim() && was.source.name === next.source.name && was.premise.trim() === input.premise.trim();
    this.draft.input = next;
    if (!same) { this.draft.questions = null; delete this.draft.failed; if (this.draft.state === 'failed') this.draft.state = 'input'; }
    this.keep();
    return true;
  }

  /** Give the finished world another name. The one change that needs no rebuilding. */
  rename(name: string): void {
    const sk = this.draft.steps.skeleton;
    const clean = name.trim().slice(0, 48);
    if (!sk || !clean || this.busy || clean === sk.name) return;
    sk.name = clean;
    this.keep();
  }

  /** The questions answered so far, as the brief carries them. */
  private answers(): { question: string; answer: string }[] {
    const q = this.draft.questions;
    if (!q || q.skipped) return [];
    return q.list.filter((x) => q.answers[x.id]?.trim()).map((x) => ({ question: x.question, answer: q.answers[x.id]!.trim() }));
  }

  private async call(req: LlmRequest, step: StepId | 'questions' | 'reading'): Promise<LlmResponse> {
    const { budget } = this.deps;
    if (budget.spentToday() >= budget.cap()) throw new BudgetReached();
    const res = await this.deps.transport.send(req);
    const entry: UsageEntry = { at: this.deps.now(), role: 'architect', model: res.model, ...res.usage, cost: costOf(res.model, res.usage), simulated: res.simulated };
    this.draft.usage.push(entry);
    this.draft.costs[step] = (this.draft.costs[step] ?? 0) + entry.cost;
    budget.record(entry, `world:${this.draft.id}`);
    return res;
  }

  /** Put another document in place of the one chosen (or choose one for the first time). Only before anything is built: notes already taken are dropped. */
  setDocument(document: DocState): boolean {
    if (this.busy || this.started) return false;
    this.draft.document = structuredClone(document);
    this.draft.input.source = { kind: 'document', text: document.digest ?? '', name: document.name };
    this.draft.questions = null;
    delete this.draft.failed;
    if (this.draft.state === 'failed') this.draft.state = 'input';
    this.keep();
    return true;
  }

  /** True when the world comes from a document that has not been read to the end. Nothing can be asked or built until it has. */
  get unread(): boolean { return this.draft.input.source.kind === 'document' && !docRead(this.draft.document); }
  /** What reading the rest of the document costs. */
  estimateReading(): number { return this.draft.document ? estimateReading(this.draft.document, this.deps.models()) : 0; }

  /**
   * Read the document: notes from each part that is left, saved after every part, then the notes
   * brought together into the description the builder works from. A part that was read is never read
   * (or paid for) again: after a pause, a failure or the app closing, reading goes on from the next.
   * The text of a part is dropped as soon as its notes are taken.
   */
  async read(): Promise<void> {
    const doc = this.draft.document;
    if (this.busy || !doc || docRead(doc)) return;
    this.pauseAsked = false;
    delete this.draft.failed;
    if (this.draft.state === 'failed') this.draft.state = 'input';
    this.current = 'reading';
    this.emit();
    const read = { premise: this.draft.input.premise, language: this.draft.input.table.language };
    try {
      while (doc.parts.length > 0) {
        const res = await this.call(noteRequest(doc, doc.parts[0]!, doc.total - doc.parts.length, read, this.deps.models()), 'reading');
        const note = clipNotes(res.text, 2600);
        if (note.length < 20) throw new Unusable(m('No notes came back for this part of the document.'));
        doc.notes.push(note);
        doc.parts.shift();
        this.keep();
        if (this.pauseAsked && doc.parts.length > 0) { this.pauseAsked = false; this.current = null; this.keep(); return; }
      }
      // A short document's notes go to the builder as they are; a long one's are brought together first.
      let digest = doc.notes.join('\n\n');
      if (!notesAreEnough(doc.notes)) {
        const res = await this.call(digestRequest(doc, read, this.deps.models()), 'reading');
        digest = res.text.trim();
        if (digest.length < 200) throw new Unusable(m('The notes could not be brought together.'));
      }
      doc.digest = clipNotes(digest, 12_000);
      doc.notes = [];
      this.draft.input.source = { kind: 'document', text: doc.digest, name: doc.name };
    } catch (err) {
      this.fail('reading', err);
    }
    this.current = null;
    this.pauseAsked = false;
    this.keep();
  }

  private fail(step: StepId | 'questions' | 'reading', err: unknown): void {
    // Shown in the wizard, in the interface language. A transport's error was worded when it was made.
    if (err instanceof BudgetReached) this.draft.failed = { step, kind: 'budget', message: t('Today’s spending limit is reached. Raise it, or go on tomorrow: what is built so far is kept.') };
    else if (err instanceof Unusable) this.draft.failed = { step, kind: 'unusable', message: t(err.message) };
    else if (err instanceof LlmError) this.draft.failed = { step, kind: err.kind, message: err.message };
    else this.draft.failed = { step, kind: 'other', message: err instanceof Error ? err.message : String(err) };
    this.draft.state = 'failed';
  }

  /** Ask the builder's questions (at most five). Does nothing if they were already asked, or once building has begun. Skipping them unasked leaves them askable. */
  async ask(): Promise<void> {
    const had = this.draft.questions;
    if (this.busy || this.started || this.unread || (had && (had.list.length > 0 || !had.skipped))) return;
    this.current = 'questions';
    delete this.draft.failed;
    this.emit();
    try {
      const res = await this.call(questionsRequest(this.draft.input, this.deps.models()), 'questions');
      const out = (res.parsed ?? { questions: [] }) as QuestionsOut;
      const ids = new Ids();
      const list = (out.questions ?? []).filter((q) => typeof q?.question === 'string' && q.question.trim()).slice(0, 5).map((q) => ({
        id: ids.take(String(q.id ?? ''), q.question, 'q'), question: word(q.question, 160),
        options: (Array.isArray(q.options) ? q.options : []).map((o) => word(o, 80)).filter(Boolean).slice(0, 4),
      }));
      this.draft.questions = { list, answers: {}, skipped: false };
      if (this.draft.state === 'failed') this.draft.state = 'input';
    } catch (err) {
      this.fail('questions', err);
    }
    this.current = null;
    this.keep();
  }

  answer(id: string, text: string): void {
    const q = this.draft.questions;
    if (!q || this.busy || Object.keys(this.draft.steps).length > 0) return; // the brief is fixed once building starts
    q.answers[id] = text;
    q.skipped = false;
    this.keep();
  }

  /** Let the builder decide for itself. The questions can still be answered until building starts. */
  skipQuestions(skip = true): void {
    if (this.busy || Object.keys(this.draft.steps).length > 0) return;
    this.draft.questions = { list: this.draft.questions?.list ?? [], answers: this.draft.questions?.answers ?? {}, skipped: skip };
    this.keep();
  }

  /** Stop after the step now being asked for. Nothing more is spent until build() is called again. */
  pause(): void {
    if (!this.busy || this.pauseAsked) return;
    this.pauseAsked = true;
    this.emit();
  }

  /**
   * Build every step that is not done, in order, saving after each. Returns when the world is ready
   * for review, when the player paused, or when a step did not go through (the steps before it are
   * kept; calling build() again takes it up from that step).
   */
  async build(): Promise<void> {
    // A world that comes from a document is built from its notes: there is nothing to build from until it is read.
    if (this.busy || this.unread) return;
    this.pauseAsked = false;
    delete this.draft.failed;
    this.draft.state = 'building';
    for (let step = this.next; step; step = this.next) {
      this.current = step;
      this.keep();
      try {
        await this.runStep(step);
      } catch (err) {
        this.fail(step, err);
        this.current = null;
        this.keep();
        return;
      }
      this.current = null;
      if (this.pauseAsked && this.next) { this.draft.state = 'paused'; this.pauseAsked = false; this.keep(); return; }
    }
    this.current = null;
    this.pauseAsked = false;
    this.draft.state = 'review';
    this.keep();
  }

  /** Ask for one step, clean the answer and keep it. An answer that cannot be used is asked for once more, saying why. */
  private async runStep<K extends StepId>(step: K): Promise<void> {
    let again: string | null = null;
    for (let attempt = 0; ; attempt++) {
      const res = await this.call(stepRequest(step, this.draft.input, this.answers(), this.draft.steps, this.deps.models(), again), step);
      try {
        if (res.stop === 'max_tokens') throw new Unusable(m('The answer was cut off before it was finished. Use fewer words in each description.'));
        if (!res.parsed) throw new Unusable(m('No answer came back in the shape that was asked for.'));
        const { data, notes } = cleanStep(step, res.parsed as StepOut[K], this.draft.steps, this.draft.input);
        (this.draft.steps as Record<StepId, unknown>)[step] = data;
        if (notes.length) this.draft.notes[step] = notes; else delete this.draft.notes[step];
        return;
      } catch (err) {
        if (!(err instanceof Unusable) || attempt >= 1) throw err;
        again = err.message;
      }
    }
  }

  /**
   * Build a step again, and with it every step after it (they were written knowing the old one).
   * The steps before it are kept and not paid for again.
   */
  async regenerate(from: StepId): Promise<void> {
    if (this.busy) return;
    let drop = false;
    for (const s of BUILD_STEPS) {
      if (s.id === from) drop = true;
      if (drop) { delete this.draft.steps[s.id]; delete this.draft.notes[s.id]; }
    }
    if (this.draft.state === 'review') this.draft.state = 'paused';
    await this.build();
  }

  /** The world as built so far, when every step is done; otherwise null. */
  world(): World | null {
    try { return this.next ? null : assemble(this.draft); } catch { return null; }
  }

  /** Anything still wrong with the finished world. The cleaners are meant to leave nothing; this is the proof, checked before a world is accepted. */
  problems(): string[] {
    const w = this.world();
    return w ? checkWorld(w) : [t('The world is not finished.')];
  }

  /** The finished world, for the library. Null while steps are missing or the world does not pass the check. */
  accept(): WorldTemplate | null {
    if (this.busy || this.next || this.problems().length) return null;
    return templateOf(this.draft, this.deps.now());
  }
}

/** Today's spending limit is reached: nothing is sent. */
export class BudgetReached extends Error {}
