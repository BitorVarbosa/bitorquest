// Powers that come and go, in a world of gifts: what the world writes about them, and the rules for
// gaining them that need the world to answer (the sheet's own rules are in engine/gift.ts).
//
//   Disciplines   Powers many people share, written by the world. Someone who practises one teaches it
//                 to a protagonist they trust (Trusted, or Friendly for a mentor); learning it then
//                 costs 10 experience and gives it at rank 1, with its first move. One that is not
//                 taught awakens instead, for the same, and only in the scene in which the protagonist
//                 was brought down in a fight or in the next.
//   Items of power  Things that hold a power, written by the world (3D&T's magic items): a fruit whose
//                 power becomes the eater's own, for good; a blade or a device whose power is its
//                 holder's while they hold it. Found in the story, for nothing: the narrator reports
//                 that the protagonist took one (`got:`), and the engine accepts it only when it is free
//                 to take (lying here once its situation is settled, or given by someone Close).
import {
  GIFT_KINDS_MAX, GIFT_TEXT, POWERS_MAX, XP_PER_LEVEL, cleanGift, fightEffect, isEffectKind, isUp, powerRoom, powersOf, stageIndex, teachingStage,
  type Art, type Combat, type EffectKind, type Gift, type HeldPower, type Sheet,
} from '../engine';
import { tl } from '../i18n';
import { castOf, parentChain } from './cards';
import { DISCIPLINES_MAX, RELICS_MAX } from './world';
import { nextId } from './story';
import type { Discipline, Item, LostPower, Person, PersonPower, Relic, Scene, Story } from './types';

export { DISCIPLINES_MAX, RELICS_MAX };

/** Learning a discipline that was shown, or awakening one that is not taught, costs what raising a rank does. */
export const XP_TO_LEARN_DISCIPLINE = XP_PER_LEVEL;
/** A discipline is taught as an ability of this tier would be: to someone Trusted, or Friendly for a mentor. */
export const DISCIPLINE_TEACHING_TIER = 3;

const cut = (v: unknown, max: number): string => (typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim().slice(0, max).trim();

/**
 * The disciplines a world may hold, out of whatever was handed in (the builder's answer, a file): ids
 * that are plain and unique, the words cut to length, one or two kinds the game knows, a first move
 * whose kind is one of them and does something at tier 1. Four at most. Ids already taken by other
 * things in the world (people, places) are passed in `taken` and are not reused.
 */
export function cleanDisciplines(raw: unknown, taken: ReadonlySet<string> = new Set()): Discipline[] {
  if (!Array.isArray(raw)) return [];
  const out: Discipline[] = [];
  for (const r of raw) {
    if (typeof r !== 'object' || r === null || out.length >= DISCIPLINES_MAX) continue;
    const d = r as Record<string, unknown>;
    const name = cut(d.name, GIFT_TEXT.name);
    const id = cut(d.id, 40).toLowerCase();
    if (!name || !/^[a-z0-9_]+$/.test(id) || id === 'own' || id === 'borrowed' || taken.has(id) || out.some((x) => x.id === id)) continue;
    const kinds = (Array.isArray(d.kinds) ? d.kinds : []).filter(isEffectKind).filter((k, i, all) => all.indexOf(k) === i).slice(0, GIFT_KINDS_MAX);
    const m = (typeof d.move === 'object' && d.move !== null ? d.move : {}) as Record<string, unknown>;
    const fight = isEffectKind(m.fight) && kinds.includes(m.fight) && fightEffect(m.fight, 1) ? m.fight : undefined;
    out.push({
      id, name, text: cut(d.text, GIFT_TEXT.text), limit: cut(d.limit, GIFT_TEXT.limit), kinds,
      move: { name: cut(m.name, GIFT_TEXT.moveName) || name, text: cut(m.text, GIFT_TEXT.moveText), ...(fight ? { fight } : {}) },
      taught: d.taught !== false,
    });
  }
  return out;
}

/** A discipline as the power its learner holds: rank 1, its first move, and where it came from. */
export function disciplineArt(d: Discipline): Art {
  const fight: EffectKind | undefined = d.move.fight && d.kinds.includes(d.move.fight) && fightEffect(d.move.fight, 1) ? d.move.fight : undefined;
  return {
    id: d.id, source: 'taught', from: d.id,
    power: { name: d.name, text: d.text, limit: d.limit, rank: 1, kinds: [...d.kinds], moves: [{ id: 'g1', name: d.move.name, tier: 1, text: d.move.text, ...(fight ? { fight } : {}) }] },
  };
}

/** Whether the protagonist holds a discipline, in use or not. */
export function holdsDiscipline(sheet: Pick<Sheet, 'arts'>, id: string): boolean {
  return (sheet.arts ?? []).some((a) => a.source === 'taught' && a.from === id);
}

/** Whether someone is in the protagonist's company or the scene and could teach: not away, and practising a discipline that is taught. */
function teacherOf(story: Story, p: Person | undefined): Discipline | undefined {
  if (!p || p.away || !p.trains || story.world.rules.powers !== 'gift') return undefined;
  const d = (story.world.disciplines ?? []).find((x) => x.id === p.trains);
  return d?.taught ? d : undefined;
}

/** What a person could teach the protagonist: the discipline they practise, when it is taught and the protagonist neither holds it nor has been shown it. */
export function disciplineFrom(story: Story, p: Person): Discipline | undefined {
  const d = teacherOf(story, p);
  const me = story.protagonist;
  if (!d || holdsDiscipline(me.sheet, d.id) || (me.found ?? []).some((f) => f.id === d.id)) return undefined;
  return d;
}

/** Every discipline someone at a place could teach the protagonist, with who teaches it. */
export function disciplinesTaughtHere(story: Story, placeId: string): { discipline: Discipline; teacher: Person }[] {
  const out: { discipline: Discipline; teacher: Person }[] = [];
  for (const id of castOf(story, placeId)) {
    const teacher = story.world.people[id];
    const discipline = teacher ? disciplineFrom(story, teacher) : undefined;
    if (teacher && discipline && !out.some((x) => x.discipline.id === discipline.id)) out.push({ discipline, teacher });
  }
  return out;
}

/** How well a person must know the protagonist before they will teach a discipline, as a bond stage index. */
export function disciplineStage(teacher: Person): number {
  return teachingStage(DISCIPLINE_TEACHING_TIER, teacher.kind === 'mentorship');
}

export type CannotGain = 'unknown' | 'not_shown' | 'taught' | 'held' | 'room' | 'not_now' | 'xp';

/** Whether a discipline that was shown can be learned now: 10 experience and room for another power. */
export function canLearnDiscipline(story: Story, id: string): CannotGain | null {
  const me = story.protagonist;
  const d = (story.world.disciplines ?? []).find((x) => x.id === id);
  if (!d || story.world.rules.powers !== 'gift') return 'unknown';
  if (holdsDiscipline(me.sheet, id)) return 'held';
  if (!(me.found ?? []).some((f) => f.id === id)) return 'not_shown';
  if (powerRoom(me.sheet) < 1) return 'room';
  return me.xp < XP_TO_LEARN_DISCIPLINE ? 'xp' : null;
}

/**
 * Whether a discipline that is not taught can awaken now: only in the scene in which the protagonist
 * was brought down in a fight, or in the next one, for 10 experience and room for another power.
 */
export function canAwakenDiscipline(story: Story, id: string): CannotGain | null {
  const me = story.protagonist;
  const d = (story.world.disciplines ?? []).find((x) => x.id === id);
  if (!d || story.world.rules.powers !== 'gift') return 'unknown';
  if (d.taught) return 'taught';
  if (holdsDiscipline(me.sheet, id)) return 'held';
  if (powerRoom(me.sheet) < 1) return 'room';
  const recent = story.scenes.slice(-2).map((s) => s.id);
  if (!me.downIn || !recent.includes(me.downIn)) return 'not_now';
  return me.xp < XP_TO_LEARN_DISCIPLINE ? 'xp' : null;
}

// ---------- Items of power ----------

/** The bond stage at which someone gives the protagonist an item of power they carry: Close. */
export const RELIC_GIVEN_AT = 4;

/**
 * The power an item holds, made legal: the words cut to length, one or two kinds, rank 1 (2 for a great
 * item that is carried), and one move at tier 1 whose kind is one of the power's. Null when it has no words.
 */
export function relicPower(raw: unknown, use: Relic['use'], major: boolean): Gift | null {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const rank = use === 'carried' && major ? 2 : 1;
  const m = (typeof r.move === 'object' && r.move !== null ? r.move : Array.isArray(r.moves) ? r.moves[0] : undefined) as Record<string, unknown> | undefined;
  const move = m && typeof m.name === 'string' && m.name.trim() ? [{ ...m, tier: 1 }] : [];
  // An item does something in a fight, or nothing: copying or taking a power belongs to people.
  const kinds = (Array.isArray(r.kinds) ? r.kinds : []).filter(isEffectKind);
  return cleanGift({ ...r, kinds, rank, moves: move }, { rank, moves: () => 1, tier: () => 1 });
}

/**
 * The items of power a world may hold, out of the builder's answer: two at most, each with a power and a
 * place. `ctx` says what exists: places, named people, the situations with where each lies, and ids
 * already taken (disciplines). An item that lies nowhere and is carried by nobody is placed where its
 * situation is, or left out.
 */
export function cleanRelics(raw: unknown, ctx: { places: ReadonlySet<string>; people: ReadonlySet<string>; seeds: ReadonlyMap<string, string>; taken: ReadonlySet<string> }): Relic[] {
  if (!Array.isArray(raw)) return [];
  const out: Relic[] = [];
  for (const r of raw) {
    if (typeof r !== 'object' || r === null || out.length >= RELICS_MAX) continue;
    const x = r as Record<string, unknown>;
    const name = cut(x.name, GIFT_TEXT.name);
    const id = cut(x.id, 40).toLowerCase();
    if (!name || !/^[a-z0-9_]+$/.test(id) || id === 'own' || id === 'borrowed' || ctx.taken.has(id) || out.some((o) => o.id === id)) continue;
    const use: Relic['use'] = x.use === 'carried' ? 'carried' : 'eaten';
    const power = relicPower(x.power, use, x.major === true);
    if (!power) continue;
    const holder = typeof x.holder === 'string' && ctx.people.has(x.holder) ? x.holder : undefined;
    const seed = typeof x.seed === 'string' && ctx.seeds.has(x.seed) ? x.seed : undefined;
    const place = typeof x.place === 'string' && ctx.places.has(x.place) ? x.place : seed ? ctx.seeds.get(seed) : undefined;
    if (!holder && !place) continue;
    out.push({ id, name, text: cut(x.text, GIFT_TEXT.text), use, power, ...(holder ? { holder } : { placeId: place! }), ...(!holder && seed ? { seed } : {}) });
  }
  return out;
}

export type CannotGet = 'unknown' | 'taken' | 'not_here' | 'not_settled' | 'not_close';

/**
 * Whether the protagonist can take an item of power in this scene: one lying where the scene is (at its
 * place or inside it) once the situation it belongs to is settled; or one carried by someone in the
 * scene who is Close to them, and gives it.
 */
export function canGet(story: Story, scene: Pick<Scene, 'placeId' | 'cast'>, id: string): CannotGet | null {
  const relic = (story.world.relics ?? []).find((r) => r.id === id);
  if (!relic || story.world.rules.powers !== 'gift') return 'unknown';
  if (relic.taken) return 'taken';
  if (relic.holder) {
    const p = story.world.people[relic.holder];
    if (!p || !scene.cast.includes(p.id)) return 'not_here';
    return stageIndex(p.bond) >= RELIC_GIVEN_AT ? null : 'not_close';
  }
  if (!relic.placeId || !parentChain(story, scene.placeId).some((x) => x.id === relic.placeId)) return 'not_here';
  return relic.seed && !(story.world.settled ?? []).includes(relic.seed) ? 'not_settled' : null;
}

/**
 * The protagonist takes an item of power: it leaves the world and goes among their things. A carried
 * one's power is theirs at once (set aside when they hold four powers already); an eaten one waits to
 * be eaten. Returns the item, or null when there is no such item to take.
 */
export function takeRelic(story: Story, id: string): Item | null {
  const relic = (story.world.relics ?? []).find((r) => r.id === id);
  if (!relic || relic.taken) return null;
  const me = story.protagonist;
  relic.taken = true;
  delete relic.holder;
  delete relic.placeId;
  delete relic.seed;
  const itemId = me.items.some((i) => i.id === relic.id) ? `${relic.id}_relic` : relic.id;
  const item: Item = { id: itemId, name: relic.name, kind: 'relic', text: relic.text, qty: 1, relic: relic.id };
  me.items.push(item);
  if (relic.use === 'carried' && !(me.sheet.arts ?? []).some((a) => a.id === relic.id)) {
    const room = powerRoom(me.sheet) > 0;
    me.sheet.arts = [...(me.sheet.arts ?? []), { id: relic.id, source: 'item', from: itemId, ...(room ? {} : { aside: true }), power: structuredClone(relic.power) }];
  }
  return item;
}

/** The world's item of power an item among the protagonist's things is, if it is one. */
export function relicOf(story: Story, item: Item | undefined): Relic | undefined {
  return item?.kind === 'relic' && item.relic ? (story.world.relics ?? []).find((r) => r.id === item.relic) : undefined;
}

/** 'carried': it is not eaten, it is carried. 'has_power': the protagonist already has a power by nature (one fruit each). */
export type CannotEat = 'unknown' | 'carried' | 'has_power';

/** Whether the protagonist can eat an item of power they have. */
export function canEat(story: Story, itemId: string): CannotEat | null {
  const me = story.protagonist;
  const relic = relicOf(story, me.items.find((i) => i.id === itemId));
  if (!relic || story.world.rules.powers !== 'gift') return 'unknown';
  if (relic.use !== 'eaten') return 'carried';
  return me.sheet.gift || hasNatureHeld(story) ? 'has_power' : null;
}

/** Whether a power the protagonist had by nature is held by someone else: it is still theirs, and nothing takes its place. */
export function hasNatureHeld(story: Story): boolean {
  return (story.protagonist.lost ?? []).some((l) => l.nature);
}

/** Eat an item of power: its power becomes the protagonist's own, for good, at rank 1. Returns it, or null when it cannot be eaten. */
export function eatRelic(story: Story, itemId: string): Gift | null {
  const me = story.protagonist;
  const item = me.items.find((i) => i.id === itemId);
  const relic = relicOf(story, item);
  if (!item || !relic || canEat(story, itemId)) return null;
  me.sheet.gift = structuredClone(relic.power);
  me.items = me.items.filter((i) => i !== item);
  return me.sheet.gift;
}

/** 'aside' / 'in_use': it already is. 'room': four powers are in use, and one must be set aside first. */
export type CannotTakeUp = 'unknown' | 'in_use' | 'aside' | 'room';

/** Whether the power of a carried item can be set aside, or taken up again. */
export function canSetAside(story: Story, itemId: string, aside: boolean): CannotTakeUp | null {
  const me = story.protagonist;
  const art = (me.sheet.arts ?? []).find((a) => a.source === 'item' && a.from === itemId);
  if (!art) return 'unknown';
  if (aside) return art.aside ? 'aside' : null;
  if (!art.aside) return 'in_use';
  return powerRoom(me.sheet) < 1 ? 'room' : null;
}

/** Set the power of a carried item aside, or take it up again. Returns false when that cannot be done. */
export function setRelicAside(story: Story, itemId: string, aside: boolean): boolean {
  if (canSetAside(story, itemId, aside)) return false;
  const me = story.protagonist;
  me.sheet.arts = (me.sheet.arts ?? []).map((a) => {
    if (a.source !== 'item' || a.from !== itemId) return a;
    const { aside: _was, ...rest } = a;
    return aside ? { ...rest, aside: true } : rest;
  });
  return true;
}

/** What someone carried drops where they are when they are beaten or die: it lies there, free to take. */
export function dropRelics(story: Story, personId: string, placeId: string): Relic[] {
  const dropped = (story.world.relics ?? []).filter((r) => !r.taken && r.holder === personId);
  for (const r of dropped) {
    delete r.holder;
    delete r.seed;
    r.placeId = placeId;
  }
  return dropped;
}

// ---------- Copying and taking someone's power, for a scene ----------

/** The id of a borrowed power among the protagonist's: there is one at a time. */
export const BORROWED = 'borrowed';

/**
 * A person's power as the protagonist holds it when they copy or take it: at the lower of the use's
 * tier and the person's rank, with the one thing it does in a fight (a seal or a theft does nothing
 * for the protagonist), and one move, the power itself.
 */
export function borrowedPower(power: PersonPower, tier: number): Gift {
  const rank = Math.max(1, Math.min(4, Math.round(tier) || 1, power.rank ?? 1));
  const kind = isEffectKind(power.fight) ? power.fight : undefined;
  const fight = kind && fightEffect(kind, rank) ? kind : undefined;
  return { name: power.name, text: power.text, limit: '', rank, kinds: kind ? [kind] : [], moves: [{ id: 'g1', name: power.name, tier: rank, text: power.text, ...(fight ? { fight } : {}) }] };
}

/** Whether a person's power can be used by them in this scene: not taken from them by the protagonist in it. */
export function powerFree(p: Person, sceneId: string): boolean {
  return !!p.power && p.power.takenIn !== sceneId;
}

/** The people in a scene whose power the protagonist could copy or take: named, here, and with a power still theirs in it. */
export function powersHere(story: Story, scene: Pick<Scene, 'id' | 'cast'>): Person[] {
  if (story.world.rules.powers !== 'gift') return [];
  return scene.cast.map((id) => story.world.people[id]).filter((p): p is Person => !!p && !p.away && p.count === 1 && powerFree(p, scene.id));
}

export type CannotTakePower = 'nobody' | 'room';

/**
 * Whose power a copy or a theft would be aimed at in a scene: the first of `targets` who has one, or
 * else, when only one person here has a power, them. Refused when nobody fits, or when the protagonist
 * holds four powers already (a power borrowed before does not count: it would give way).
 */
export function canTakePower(story: Story, scene: Pick<Scene, 'id' | 'cast'>, targets: string[]): { ok: true; person: Person } | { ok: false; reason: CannotTakePower } {
  const here = powersHere(story, scene);
  const person = targets.map((id) => here.find((p) => p.id === id)).find((p): p is Person => !!p) ?? (here.length === 1 ? here[0] : undefined);
  if (!person) return { ok: false, reason: 'nobody' };
  const sheet = story.protagonist.sheet;
  const inUse = powersOf(sheet).filter((x) => x.id !== BORROWED).length;
  return inUse >= POWERS_MAX ? { ok: false, reason: 'room' } : { ok: true, person };
}

/**
 * The protagonist copies someone's power, or takes it from them, until the scene ends: it is held as
 * a borrowed power (a power borrowed before goes back first). Taken, the person cannot use it until then.
 */
export function borrowPower(story: Story, sceneId: string, person: Person, tier: number, steal: boolean): Art {
  giveBack(story);
  const art: Art = { id: BORROWED, source: 'borrowed', from: person.id, until: sceneId, ...(steal ? { stolen: true } : {}), power: borrowedPower(person.power!, tier) };
  const me = story.protagonist;
  me.sheet.arts = [...(me.sheet.arts ?? []).filter((a) => a.id !== BORROWED), art];
  if (steal) person.power!.takenIn = sceneId;
  return art;
}

/** A borrowed power goes back: the protagonist no longer holds it, and one that was taken is its owner's again. Returns the owner, or null when nothing was borrowed. */
export function giveBack(story: Story): Person | null {
  const me = story.protagonist;
  const art = (me.sheet.arts ?? []).find((a) => a.id === BORROWED);
  if (!art) return null;
  me.sheet.arts = (me.sheet.arts ?? []).filter((a) => a !== art);
  if (!me.sheet.arts.length) delete me.sheet.arts;
  const owner = art.from ? story.world.people[art.from] : undefined;
  if (owner?.power?.takenIn) delete owner.power.takenIn;
  return owner ?? null;
}

// ---------- A power taken from the protagonist ----------

/**
 * Who would take the protagonist's power if they lost this fight now: an opponent still standing whose
 * power steals, and is still theirs in this scene (not taken from them in turn).
 */
export function thiefIn(story: Story, combat: Combat, sceneId: string): Person | undefined {
  if (story.world.rules.powers !== 'gift') return undefined;
  for (const f of Object.values(combat.fighters)) {
    if (f.side !== 'foe' || !isUp(f) || f.count > 1) continue;
    const p = story.world.people[f.id];
    if (p?.power?.fight === 'steal' && powerFree(p, sceneId)) return p;
  }
  return undefined;
}

/** What a thief takes: the protagonist's power by nature; with none, the highest-ranked discipline they learned. Never an item's power, nor one borrowed. */
export function powerToTake(sheet: Pick<Sheet, 'gift' | 'arts'>): HeldPower | undefined {
  const own = powersOf(sheet).find((x) => !x.art);
  if (own) return own;
  return powersOf(sheet).filter((x) => x.art?.source === 'taught').sort((a, b) => b.gift.rank - a.gift.rank)[0];
}

/**
 * A thief who beat the protagonist takes a power of theirs. One that holds what it takes keeps it until
 * it is beaten, flees from a fight the protagonist wins, or dies: the power is recorded as theirs and a
 * thread is opened to take it back. One that erases destroys it, except in the Story style, where
 * nothing is lost for good and it is held instead. Returns what was taken, or null when there was nothing.
 */
export function robPower(story: Story, thief: Person): { power: Gift; erased: boolean; thread?: string } | null {
  const me = story.protagonist;
  const held = powerToTake(me.sheet);
  if (!held || !thief.power) return null;
  const erased = thief.power.keeps === 'erased' && story.settings.style !== 'story';
  if (held.art) me.sheet.arts = (me.sheet.arts ?? []).filter((a) => a !== held.art);
  else delete me.sheet.gift;
  if (me.sheet.arts && !me.sheet.arts.length) delete me.sheet.arts;
  if (erased) return { power: held.gift, erased };
  // The thread is the story's, in its language; the names are shown as written.
  const title = tl(story.settings.language, 'Take back {power} from {name}', { power: held.gift.name, name: thief.name });
  const thread = { id: nextId('t', story), title: cut(title, 120), kind: 'personal' as const, status: 'open' as const, next: null, clues: [], since: story.clock.day };
  story.threads.push(thread);
  const { power: _p, ...art } = held.art ?? { power: held.gift };
  (me.lost ??= []).push({ power: held.gift, nature: !held.art, ...(held.art ? { art: art as Omit<Art, 'power'> } : {}), by: thief.id, keeps: 'held', thread: thread.id });
  return { power: held.gift, erased, thread: thread.id };
}

/**
 * Whatever a person took from the protagonist comes back, whole, when they are beaten, flee from a
 * fight the protagonist wins, or die: the power returns to its place and the thread to take it back is
 * done. Returns the powers that came back.
 */
export function returnPowers(story: Story, personId: string): LostPower[] {
  const me = story.protagonist;
  const back = (me.lost ?? []).filter((l) => l.by === personId);
  if (!back.length) return [];
  me.lost = (me.lost ?? []).filter((l) => l.by !== personId);
  if (!me.lost.length) delete me.lost;
  for (const l of back) {
    if (l.nature) me.sheet.gift = l.power;
    else if (l.art) me.sheet.arts = [...(me.sheet.arts ?? []).filter((a) => a.id !== l.art!.id), { ...l.art, power: l.power }];
    const thread = story.threads.find((t) => t.id === l.thread);
    if (thread && thread.status === 'open') { thread.status = 'done'; thread.doneDay = story.clock.day; }
  }
  return back;
}
