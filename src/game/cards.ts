// Cards and the scene packet: the text the narrator is given about the world.
//
// The whole point of this file is that its output has a FIXED size. A story that is 2,000 turns old
// produces a packet the same size as one that is 20 turns old: every card has a budget, lists have a
// maximum length, and older material only ever arrives as a short summary.
import { ABILITIES, OWN_POWER, PATHS, POWERS_MAX, SCHOOLS, abilitiesOf, clockLabel, commandOf, maxEnergy, maxHp, powerById, powersOf, schoolsOf, stageName, storyTraits, type Ability, type Clock, type HeldPower } from '../engine';
import { CHAPTERS_SENT, chaptersForPacket } from './chapters';
import { hasMoney, purseWords } from './money';
import { RELICS_MAX, neighbours } from './world';
import type { Contest, Fact, Front, GameEvent, Person, Place, Relic, Seed, Story } from './types';

/** Roughly four characters per token for English prose. Used for budgets, never for billing. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Cut text to a budget at a word boundary. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return (at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.]+$/, '') + '…';
}

export const BUDGET = {
  place: 420,
  exits: 360,
  you: 700,
  /** The protagonist's own power, in a world of gifts, and each of the (at most three) others they hold. */
  power: 340,
  powerMore: 260,
  personParty: 460,
  personNamed: 300,
  personCrowd: 130,
  /** At most this many people get a card; the rest are listed by name. */
  peopleCards: 8,
  knowledgeLine: 110,
  threads: 4,
  thread: 200,
  due: 160,
  /** A finished chapter sent in full, one sent as a line, and the chapter being played so far. */
  chapterFull: 420,
  chapterLine: 130,
  chapterSoFar: 700,
  lastScenes: 2,
  lastScene: 340,
  /** A situation waiting at the place, something in motion that shows there, and a piece of news being talked about. */
  seed: 420,
  /** An item of power where the scene is, in a world of gifts: two at most. */
  relic: 320,
  front: 300,
  talk: 240,
  /** How someone looks at a glance (every scene), and in full (the scene they are first met in). */
  look: 100,
  appearance: 340,
  /** What the player kept as true about a person or a place, and about the story as a whole. */
  facts: 240,
  storyFacts: 400,
  /** What the protagonist carries, and their purse: each with a budget of its own, so that a long sheet never cuts them off. */
  carrying: 260,
  purse: 120,
  /** The final chapter of a story with an ending, and something under way that takes several efforts. */
  ending: 520,
  contest: 160,
} as const;

/** The longest a look, a full appearance, and who someone is (their card) are kept. */
export const LOOK_MAX = 90;
export const APPEARANCE_MAX = 320;
export const CARD_MAX = 340;

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export function parentChain(story: Story, placeId: string): Place[] {
  const out: Place[] = [];
  let p: Place | undefined = story.world.places[placeId];
  for (let i = 0; p && i < 12; i++) {
    out.unshift(p);
    p = p.parent ? story.world.places[p.parent] : undefined;
  }
  return out;
}

/** Where the protagonist can go from a place in one journey, nearest first: only places they know of. */
export function exitsFrom(story: Story, placeId: string): { place: Place; minutes: number; note?: string }[] {
  const out: { place: Place; minutes: number; note?: string }[] = [];
  for (const n of neighbours(story.world, placeId)) {
    const place = story.world.places[n.id];
    if (place && place.known !== 'hidden') out.push({ place, minutes: n.minutes, ...(n.note ? { note: n.note } : {}) });
  }
  return out.sort((a, b) => a.minutes - b.minutes || a.place.name.localeCompare(b.place.name));
}

/** Gone from the map: they left for good, they died, or they were beaten and are no longer about. */
export const isAway = (p: Person): boolean => !!p.away || p.placeId === 'nowhere';

/** Where someone is, for the narrator, when they are spoken of and are not in the scene. */
export function whereLine(story: Story, p: Person): string {
  if (p.away) return `${p.away.how === 'dead' ? 'Dead' : 'Gone'} since day ${p.away.day}: ${p.away.why}.`;
  if (p.placeId === 'nowhere') return 'No longer about.';
  if (p.inParty) return 'Travelling with you.';
  const place = story.world.places[p.placeId];
  return place ? `Now at ${place.name}.` : '';
}

/** Everyone at a place, in the order the interface and the narrator see them: party first, then named people, then crowds. */
export function castOf(story: Story, placeId: string): string[] {
  const people = Object.values(story.world.people);
  const rank = (p: Person) => (p.tier === 'major' ? 0 : p.tier === 'recurring' ? 1 : 2);
  const party = people.filter((p) => p.inParty).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.bond - a.bond || a.name.localeCompare(b.name));
  const here = people
    .filter((p) => !p.inParty && p.placeId === placeId)
    .sort((a, b) => rank(a) - rank(b) || b.bond - a.bond || a.name.localeCompare(b.name));
  return [...party, ...here].map((p) => p.id);
}

/** How a person comes to know of something: they were there, they were told, or it is talk they have heard. */
export type Knowing = 'there' | 'told' | 'heard';
export interface Known { event: GameEvent; how: Knowing }

/**
 * How long news takes to get about, in minutes of story time. What an event's reach means:
 *   secret  only those who were there, or were told, ever know.
 *   local   after a while it is talk in the settlement where it happened.
 *   public  the same, and later it is known across the region (or the whole known world, where there are no regions).
 * Nothing is written down when news spreads: what a person has heard is worked out, when it is asked
 * for, from where they are and how long ago the thing happened.
 */
export const NEWS = { local: 6 * 60, publicNear: 6 * 60, publicFar: 3 * 1440 } as const;

const minutesOf = (c: Clock) => c.day * 1440 + c.minute;

/**
 * The settlement a place lies in, and the country around it. The country is the whole map: a world is
 * one country's worth of places, and public news crosses all of it in a few days, the open land
 * between towns included.
 */
export function reachOf(story: Story, placeId: string): { town: string | null; wide: string | null } {
  const chain = parentChain(story, placeId);
  let town: string | null = null;
  for (const p of chain) if (p.kind === 'settlement') town = p.id;
  return { town, wide: chain[0]?.id ?? null };
}

type Scope = { town: string | null; wide: string | null };

/** Whether talk of an event has got from where it happened to somewhere else, `age` minutes later. A secret never does. */
function talkReaches(event: GameEvent, at: Scope, home: Scope, samePlace: boolean, age: number): boolean {
  if (event.reach === 'secret' || age < 0) return false;
  const sameTown = at.town !== null ? at.town === home.town : samePlace;
  const sameCountry = at.wide !== null && at.wide === home.wide;
  return event.reach === 'local'
    ? sameTown && age >= NEWS.local
    : (sameTown && age >= NEWS.publicNear) || (sameCountry && age >= NEWS.publicFar);
}

/** Whether what happened is being talked about at a place by now. Something that happened in several places is talked about from each of them. */
export function hasReached(story: Story, event: GameEvent, placeId: string, now: Clock = story.clock): boolean {
  const home = reachOf(story, placeId);
  const age = minutesOf(now) - minutesOf(event.clock);
  return [event.placeId, ...(event.also ?? [])].some((from) => talkReaches(event, reachOf(story, from), home, from === placeId, age));
}

/** News of the world is talked about for this many days; after that it is simply how things are. */
export const TALK_DAYS = 10;

/**
 * The talk of a place: news of the world moving (not of what the protagonist did) that has reached
 * it and is still fresh, newest first. This is what anyone there might bring up.
 */
export function newsFor(story: Story, placeId: string, max = 2, now: Clock = story.clock): GameEvent[] {
  const t = minutesOf(now);
  return story.events
    .filter((e) => e.front && t - minutesOf(e.clock) <= TALK_DAYS * 1440 && hasReached(story, e, placeId, now))
    .sort((a, b) => minutesOf(b.clock) - minutesOf(a.clock))
    .slice(0, max);
}

/**
 * What a character knows of what has happened: the events they took part in or saw, the ones they
 * were told about, and what has reached them as talk (never a secret). Most important first.
 */
export function knowledgeOf(story: Story, personId: string, now: Clock = story.clock): Known[] {
  const out: Known[] = [];
  const person = story.world.people[personId];
  const seen = new Map<string, { town: string | null; wide: string | null }>();
  const scope = (placeId: string) => {
    let s = seen.get(placeId);
    if (!s) { s = reachOf(story, placeId); seen.set(placeId, s); }
    return s;
  };
  const home = person ? scope(person.placeId) : null;
  const t = minutesOf(now);
  for (const event of story.events) {
    if (event.actors.includes(personId) || event.witnesses.includes(personId)) { out.push({ event, how: 'there' }); continue; }
    if (event.told.includes(personId)) { out.push({ event, how: 'told' }); continue; }
    if (!person || !home) continue;
    const age = t - minutesOf(event.clock);
    if ([event.placeId, ...(event.also ?? [])].some((from) => talkReaches(event, scope(from), home, from === person.placeId, age))) out.push({ event, how: 'heard' });
  }
  return out.sort((a, b) => b.event.importance - a.event.importance || minutesOf(b.event.clock) - minutesOf(a.event.clock));
}

/**
 * The few memories that go on a person's card: what they would have in mind now. Not simply the most
 * important ones ever (in a long story those are the same three for ever), and not simply the newest
 * (a trifle from this morning does not push out the day you saved their life). Each memory is weighed:
 *   - how they know it: being there counts most, hearsay least, and only notable hearsay counts at all;
 *   - how much it mattered, and how long ago it was, with a floor so that what mattered most never fades away;
 *   - whether it was something done to or for this person, and more so if it hurt;
 *   - whether the player chose to keep it in view on the person's profile;
 *   - whether it bears on the scene: it happened in this place, or involved someone else who is here.
 * At most one of them is hearsay.
 */
export function memoriesFor(story: Story, p: Person, scene?: { placeId: string; cast: string[] }, max = p.inParty ? 3 : 2): Known[] {
  const now = minutesOf(story.clock);
  const here = new Set(scene?.cast ?? []);
  here.delete(p.id);
  const weigh = (k: Known): number => {
    const e = k.event;
    if (k.how === 'heard' && e.importance < 2) return 0;
    const how = k.how === 'there' ? 1 : k.how === 'told' ? 0.8 : 0.4;
    const mattered = e.importance === 3 ? 3 : e.importance === 2 ? 1.8 : 1;
    const days = Math.max(0, now - minutesOf(e.clock)) / 1440;
    const fresh = 0.35 + 0.65 / (1 + days / 4);
    const theirs = e.bond?.who === p.id ? (e.bond.delta < 0 ? 1.8 : 1.4) : 1;
    const kept = e.kept ? 1.5 : 1;
    const place = scene && e.placeId === scene.placeId ? 1.15 : 1;
    const company = [...e.actors, ...e.witnesses].some((id) => here.has(id)) ? 1.15 : 1;
    return how * mattered * fresh * theirs * kept * place * company;
  };
  const ranked = knowledgeOf(story, p.id)
    .map((k) => ({ k, score: weigh(k) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || minutesOf(b.k.event.clock) - minutesOf(a.k.event.clock));
  const chosen: Known[] = [];
  const texts = new Set<string>();
  let hearsay = 0;
  for (const { k } of ranked) {
    if (chosen.length >= max) break;
    if (texts.has(k.event.text)) continue; // the same sentence recorded twice says nothing new
    if (k.how === 'heard' && hearsay >= 1) continue;
    if (k.how === 'heard') hearsay += 1;
    texts.add(k.event.text);
    chosen.push(k);
  }
  return chosen;
}

const KNOWS: Record<Knowing, string> = { there: 'Knows', told: 'Was told', heard: 'Has heard' };

/** Whether the moment that is waiting with someone is the one in which they ask for help with what they want: the bond has become Close, and they have not asked before. */
export const asksIn = (p: Person): boolean => !!p.pendingMoment && p.bond >= 60 && !!p.wish?.trim() && !p.quest;

export function bondLine(p: Person): string {
  if (p.bond <= 0) return `no bond; ${p.attitude.toLowerCase()}`;
  return `${p.kind}, ${stageName(p.bond)} (${p.bond}/100); ${p.attitude.toLowerCase()}`;
}

/** What the player kept as true about someone or something ("" for the story as a whole), newest first. */
export function factsAbout(story: Story, about: string, max = 3): Fact[] {
  return (story.facts ?? []).filter((f) => f.about === about).slice(-max).reverse();
}

/** Those facts as one line for a card, with a budget of its own. Empty when there are none. */
function factsLine(story: Story, about: string, lead: string, budget: number, max = 3): string {
  const facts = factsAbout(story, about, max);
  return facts.length ? clip(`${lead} ${facts.map((f) => f.text.replace(/[.\s]+$/, '')).join('; ')}.`, budget) : '';
}

/** How someone looks, for a card: in full when `full` and there is a full description, else at a glance. Empty when nothing is said. */
export function looksLine(who: { look?: string; appearance?: string }, full: boolean): string {
  const text = full && who.appearance?.trim() ? clip(who.appearance, BUDGET.appearance) : who.look?.trim() ? clip(who.look, BUDGET.look) : '';
  return text ? `Looks: ${text.replace(/[.\s]+$/, '')}.` : '';
}

/**
 * A person as the narrator is told of them. `scene` is where they are about to be met, when that is
 * known: it helps choose what they have in mind. `full`: they are being met for the first time, and
 * their full appearance is told; after that a few words stand in for it.
 */
export function personCard(story: Story, p: Person, scene?: { placeId: string; cast: string[] }, full = false): string {
  if (p.count > 1) return clip(`[${p.id}] ${p.name} ×${p.count} — ${p.role}. ${p.card}`, BUDGET.personCrowd);
  // Companions and the story's major people have more to them (goals, a secret): they get the larger card.
  const budget = p.inParty || p.tier === 'major' ? BUDGET.personParty : BUDGET.personNamed;
  const head = `[${p.id}] ${p.name} — ${p.role}${p.inParty ? ', in your party' : ''}. ${cap(bondLine(p))}${p.attitudeWhy ? ` (${p.attitudeWhy})` : ''}.`;
  const parts = [head];
  if (p.values.length) parts.push(`Values ${p.values.join(', ')}.`);
  if (p.grievance) parts.push(`Open grievance: ${p.grievance}`);
  if (p.pendingMoment) parts.push(`A moment is waiting since the bond became ${p.pendingMoment}.${asksIn(p) ? ` In it they ask for help with something of their own: ${clip(p.wish!, 140)}` : ''}`);
  // A power of their own, in a world of gifts: said before the description, so that a long description never costs the narrator the power.
  if (p.power && story.world.rules.powers === 'gift') parts.push(`Power: ${p.power.name}${p.power.text ? ` (${clip(p.power.text, 90)})` : ''}.`);
  // A discipline they practise (its words are in the world's description): said before the description, for the same reason.
  const trains = p.trains && story.world.rules.powers === 'gift' ? (story.world.disciplines ?? []).find((d) => d.id === p.trains) : undefined;
  if (trains) parts.push(`Practises ${trains.name}${trains.taught ? ' and can teach it' : ''}.`);
  parts.push(p.card);
  // Someone who practises a path can teach it, to a person they know well enough: the narrator should know they have it.
  const lessons = lessonsFrom(story, p);
  if (lessons.length) parts.push(`Can teach ${lessons.slice(0, 3).map((a) => a.name).join(', ')}${lessons.length > 3 ? ` and ${lessons.length - 3} more` : ''}.`);
  if (p.secret) parts.push(`Secret: ${p.secret}`);
  // What the person has in mind is added after the description has been cut to its budget, each
  // memory with a budget of its own: a long description must never cost the person their memories.
  const known = memoriesFor(story, p, scene).map((k) => `${KNOWS[k.how]}: ${clip(k.event.text, BUDGET.knowledgeLine)} (day ${k.event.clock.day})`);
  // How they look, and what the player kept as true about them, each with a budget of its own for the same reason.
  return [clip(parts.join(' '), budget), looksLine(p, full), factsLine(story, p.id, 'True of them:', BUDGET.facts), ...known].filter(Boolean).join(' ');
}

/** What the protagonist carries, for the narrator: things that matter to the story first, the rest after, and a count of what does not fit. */
function carryingLine(story: Story): string {
  const order = { quest: 0, relic: 1, keepsake: 2, gear: 3, consumable: 4 } as const;
  const items = [...story.protagonist.items].sort((a, b) => order[a.kind] - order[b.kind]);
  if (!items.length) return '';
  const names: string[] = [];
  let used = 'Carrying '.length;
  for (const [i, it] of items.entries()) {
    const name = it.qty > 1 ? `${it.name} ×${it.qty}` : it.name;
    const left = items.length - i - 1;
    if (used + name.length + 2 + (left ? 14 : 0) > BUDGET.carrying) { names.push(`and ${items.length - i} more`); break; }
    names.push(name);
    used += name.length + 2;
  }
  return `Carrying ${names.join(', ')}.`;
}

/**
 * The protagonist as the narrator is told of them. `full`: the story's first scene, in which their full
 * appearance is told; after that a few words stand in for it. What they carry and their purse each have
 * a budget of their own, after the sheet.
 */
export function protagonistCard(story: Story, full = false): string {
  const p = story.protagonist;
  const s = p.sheet;
  const paths = PATHS.filter((k) => (s.paths[k] ?? 0) > 0).map((k) => `${cap(k)} ${s.paths[k]}`).join(' ');
  // In the Extreme mode the character commands whole schools: naming every ability would cost a hundred tokens a scene for nothing.
  // In a world of gifts the power has a line of its own (powerLine), and its moves are told when they are used.
  const mode = story.world.rules.powers;
  const abilities = mode === 'focus' ? commandOf(s, mode).map((a) => a.name).join(', ') : '';
  const schools = mode === 'extreme' ? schoolsOf(s).map((id) => SCHOOLS[id].name).join(', ') : '';
  // Traits the rules do not apply by themselves reach the narrator here; without this line they would do nothing.
  const traits = storyTraits(s);
  const sheet = clip(
    `YOU ${p.name}, ${p.line}. Strength ${s.strength} Skill ${s.skill} Resistance ${s.resistance} Armor ${s.armor} Firepower ${s.firepower}. ` +
      `Hit points ${s.hp}/${maxHp(s)}, energy ${s.energy}/${maxEnergy(s)}, destiny ${p.destiny}.` +
      (paths ? ` Paths ${paths}.` : '') + (abilities ? ` Abilities ${abilities}.` : '') + (schools ? ` Powers: ${schools} (broad and showy; the engine says what each use costs).` : '') +
      (s.skills.length ? ` Skills ${s.skills.join(', ')}.` : '') +
      (traits.advantages.length ? ` Advantages ${traits.advantages.join('; ')}.` : '') +
      (traits.drawbacks.length ? ` Drawbacks ${traits.drawbacks.join('; ')}.` : ''),
    BUDGET.you,
  );
  // The purse, in the world's own money. A world without money says so once, in the narrator's contract.
  const purse = hasMoney(story.world) ? clip(`Purse ${purseWords(story)}.`, BUDGET.purse) : '';
  return [sheet, looksLine(p, full), carryingLine(story), purse].filter(Boolean).join(' ');
}

/** Where a power the protagonist holds came from, for the narrator. */
function powerOrigin(story: Story, held: HeldPower): string {
  const a = held.art;
  if (!a) return '';
  if (a.source === 'taught') return ' (a discipline learned)';
  if (a.source === 'item') {
    const item = story.protagonist.items.find((i) => i.id === a.from);
    return ` (from ${item ? item.name : 'an item'} they carry, while they hold it)`;
  }
  const who = a.from ? story.world.people[a.from] : undefined;
  return ` (${a.stolen ? 'taken from' : 'copied from'} ${who ? who.name : 'someone'} until this scene ends)`;
}

/**
 * One of the protagonist's powers, in a world of gifts: what it is, in the player's words (or the
 * world's), and how far it goes. A line of its own with a budget of its own, so that a long sheet never
 * cuts it short. Null when they hold no such power. How the narrator is to treat it is in the contract
 * (prompts.ts).
 */
export function powerLine(story: Story, id: string = OWN_POWER): string | null {
  if (story.world.rules.powers !== 'gift') return null;
  const held = powerById(story.protagonist.sheet, id);
  if (!held) return null;
  const g = held.gift;
  return clip(`POWER ${g.name}${powerOrigin(story, held)}, rank ${g.rank} of 4. ${g.text}${g.limit ? ` Limit: ${g.limit}` : ''}`, held.art ? BUDGET.powerMore : BUDGET.power);
}

/** Every power the protagonist holds, a line each: the one by nature first. Empty outside a world of gifts. */
export function powerLines(story: Story): string[] {
  if (story.world.rules.powers !== 'gift') return [];
  return powersOf(story.protagonist.sheet).map((p) => powerLine(story, p.id)).filter((l): l is string => !!l);
}

/**
 * The items of power where a scene is, in a world of gifts: lying at the scene's place or a place it is
 * inside, or carried by someone in it. Those the protagonist has are no longer in the world.
 */
export function relicsHere(story: Story, scene: { placeId: string; cast: string[] }): Relic[] {
  if (story.world.rules.powers !== 'gift') return [];
  const chain = new Set(parentChain(story, scene.placeId).map((p) => p.id));
  return (story.world.relics ?? []).filter((r) => !r.taken && (r.holder ? scene.cast.includes(r.holder) : !!r.placeId && chain.has(r.placeId))).slice(0, RELICS_MAX);
}

/** An item of power, for the narrator alone: what it is, what its power is, and on what terms it can be had. */
export function relicLine(story: Story, r: Relic): string {
  const holder = r.holder ? story.world.people[r.holder] : undefined;
  const gives = r.use === 'eaten' ? `Whoever eats it gains, for good, ${r.power.name}: ${r.power.text}` : `Whoever holds it can use ${r.power.name}: ${r.power.text}`;
  const terms = holder ? `${holder.name} carries it, and would give it only to someone Close; beaten, they would drop it.`
    : r.seed && !(story.world.settled ?? []).includes(r.seed) ? `It lies here, bound up with [${r.seed}]: it can be had once that is dealt with.`
      : 'It lies here, to be found.';
  // The terms first: a long description must never cost the narrator the terms.
  return `ITEM OF POWER [${r.id}] ${r.name}. ${terms} ${r.text} ${gives}${r.power.limit ? ` Limit: ${r.power.limit}` : ''}`;
}

/** Whether two places are in the same town (or are the same place, out in the open). */
export function hasSameTown(story: Story, a: string, b: string): boolean {
  const ta = reachOf(story, a).town;
  return ta !== null ? ta === reachOf(story, b).town : a === b;
}

/** What a person could teach the protagonist: the abilities they practise that the protagonist has neither learned nor been shown. Only in a world of paths. */
export function lessonsFrom(story: Story, p: Person): Ability[] {
  if (story.world.rules.powers !== 'focus' || !p.teaches?.length) return [];
  const me = story.protagonist;
  const have = new Set([...me.sheet.abilities, ...(me.found ?? []).map((f) => f.id)]);
  return p.teaches.filter((id) => !have.has(id)).map((id) => ABILITIES[id]).filter((a): a is Ability => !!a);
}

/** Everything someone in a place could teach the protagonist, with who teaches it. */
export function teachableHere(story: Story, placeId: string, max = 8): { ability: Ability; teacher: Person }[] {
  const out: { ability: Ability; teacher: Person }[] = [];
  const seen = new Set<string>();
  for (const id of castOf(story, placeId)) {
    const teacher = story.world.people[id];
    if (!teacher) continue;
    for (const ability of lessonsFrom(story, teacher)) if (!seen.has(ability.id)) { seen.add(ability.id); out.push({ ability, teacher }); }
  }
  return out.slice(0, max);
}

/** Abilities the protagonist has not learned but has the Focus to attempt, lowest tier first. Only in a world of paths. */
export function withinReach(story: Story, max = 12): Ability[] {
  if (story.world.rules.powers !== 'focus') return [];
  const s = story.protagonist.sheet;
  return PATHS.flatMap((k) => abilitiesOf(k).filter((a) => a.tier <= (s.paths[k] ?? 0) && !s.abilities.includes(a.id))).sort((a, b) => a.tier - b.tier).slice(0, max);
}

/** How many situations, things in motion and pieces of news one packet carries. */
export const WORLD_SENT = { seeds: 2, fronts: 2, talk: 2 };

/** The situations to put in front of the narrator at a place: those planted there or inside it, else the nearest known one a journey away. Settled ones are left out. */
export function seedsFor(story: Story, placeId: string): Seed[] {
  const settled = new Set(story.world.settled ?? []);
  const open = (story.world.seeds ?? []).filter((s) => !s.over && !settled.has(s.id) && story.world.places[s.placeId]);
  if (!open.length) return [];
  const inside = (id: string): boolean => { for (let cur: string | null = id, i = 0; cur && i < 20; cur = story.world.places[cur]?.parent ?? null, i++) if (cur === placeId) return true; return false; };
  const here = open.filter((s) => inside(s.placeId));
  if (here.length) return here.slice(0, WORLD_SENT.seeds);
  const near = new Map(exitsFrom(story, placeId).map((e) => [e.place.id, e.minutes]));
  return open.filter((s) => near.has(s.placeId)).sort((a, b) => near.get(a.placeId)! - near.get(b.placeId)!).slice(0, 1);
}

/** Everything in motion that shows at a place: fronts that touch it or a place it lies inside. One that was stopped before anything came of it is left out. */
export function frontsAt(story: Story, placeId: string): Front[] {
  const chain = new Set(parentChain(story, placeId).map((p) => p.id));
  return (story.world.fronts ?? []).filter((f) => f.stages.length > 0 && !(f.stopped && f.stage === 0) && f.touches.some((t) => chain.has(t)));
}

/** The ones the narrator is told about there: those still going first, then the ones that have run their course. */
export function frontsFor(story: Story, placeId: string): Front[] {
  const going = (f: Front) => !f.stopped && f.stage < f.stages.length;
  return frontsAt(story, placeId).sort((a, b) => Number(going(b)) - Number(going(a))).slice(0, WORLD_SENT.fronts);
}

/** One front as the narrator is told of it: what has come to pass, and what comes next if nobody stops it. */
export function frontLine(f: Front): string {
  const soFar = f.stage > 0 ? `So far: ${f.stages[f.stage - 1]} ` : '';
  const next = f.stopped ? 'It was stopped, and goes no further.' : f.stage >= f.stages.length ? 'It has run its course.' : `Coming, if nobody stops it: ${f.stages[f.stage]}`;
  return `IN MOTION ${f.name}. ${soFar}${next}`;
}

/** The first message of a scene's conversation. Built once when the scene starts and never changed. */
export function buildPacket(story: Story, scene: { n: number; placeId: string; cast: string[] }): string {
  const w = story.world;
  const place = w.places[scene.placeId];
  if (!place) throw new Error(`unknown place ${scene.placeId}`);
  const chain = parentChain(story, scene.placeId);
  const within = chain.slice(0, -1).reverse().map((p) => p.name).join(', ');
  const lines: string[] = [];

  lines.push('SCENE PACKET (written by the game, not by the player)');
  lines.push(`STORY ${story.title} · chapter ${story.chapter.n} "${story.chapter.title}" · scene ${scene.n}`);
  lines.push(`WHEN ${clockLabel(story.clock).replace(' · ', ', ')}`);
  const placeFacts = factsLine(story, place.id, 'True of this place:', BUDGET.facts);
  lines.push(`PLACE [${place.id}] ${place.name}${within ? ` (in ${within})` : ''}. ${clip(place.card, BUDGET.place)}${placeFacts ? ` ${placeFacts}` : ''}`);

  const exits = exitsFrom(story, scene.placeId).map((e) => `[${e.place.id}] ${e.place.name} ${e.minutes} min${e.note ? ` (${e.note})` : ''}`);
  if (exits.length) lines.push(`WAYS OUT ${clip(exits.join(' · '), BUDGET.exits)}`);

  // The first scene of the story tells how the protagonist looks in full; later ones in a few words.
  lines.push(protagonistCard(story, scene.n === 1));
  lines.push(...powerLines(story));

  const cast = scene.cast.map((id) => w.people[id]).filter((p): p is Person => !!p);
  if (cast.length) {
    lines.push('PEOPLE HERE');
    // Someone met for the first time is described in full; after that a few words stand in for it.
    for (const p of cast.slice(0, BUDGET.peopleCards)) lines.push(personCard(story, p, scene, !p.met || scene.n === 1));
    const rest = cast.slice(BUDGET.peopleCards);
    if (rest.length) lines.push(`ALSO HERE ${rest.map((p) => `[${p.id}] ${p.name}${p.count > 1 ? ` ×${p.count}` : ''}`).join(', ')}`);
  } else {
    lines.push('PEOPLE HERE nobody else');
  }

  const open = story.threads.filter((t) => t.status === 'open');
  const order = { main: 0, mystery: 1, personal: 2, small: 3 } as const;
  open.sort((a, b) => order[a.kind] - order[b.kind]);
  if (open.length) {
    lines.push('THREADS');
    for (const t of open.slice(0, BUDGET.threads)) {
      const clues = t.clues.slice(-2).map((c) => c.text).join(' ');
      lines.push(clip(`[${t.id}] ${t.title}${t.next ? ` Next: ${t.next}` : ''}${clues ? ` Clues: ${clues}` : ''}`, BUDGET.thread));
    }
  }
  const due = story.commitments.filter((c) => !c.done);
  for (const c of due.slice(0, 2)) lines.push(clip(`DUE ${c.dueLabel}: ${c.text}`, BUDGET.due));
  // What the player kept as true about the story as a whole.
  const kept = factsLine(story, '', 'FACTS kept by the player:', BUDGET.storyFacts, 4);
  if (kept) lines.push(kept);
  // Something under way that takes several efforts, as it stood when the scene began.
  if (story.contest) lines.push(clip(contestLine(story.contest), BUDGET.contest));
  // The final chapter of a story with an ending: what it should come to.
  if (story.chapter.final) lines.push(clip(endingLine(story), BUDGET.ending));

  // What the world has waiting here, for the narrator alone: situations planted at this place (or, when
  // there is none, the nearest one a journey away), and what is in motion that shows here.
  for (const s of seedsFor(story, scene.placeId)) {
    const where = s.placeId === scene.placeId ? '' : ` (at ${w.places[s.placeId]?.name ?? s.placeId})`;
    lines.push(clip(`SITUATION [${s.id}] ${s.title}${where}. ${s.wants} In the way: ${s.obstacle} If left alone: ${s.ifIgnored} Not what it seems: ${s.secret}`, BUDGET.seed));
  }
  for (const f of frontsFor(story, scene.placeId)) lines.push(clip(frontLine(f), BUDGET.front));
  // Items of power where the scene is, for the narrator alone: what each is, what it gives, and on what terms it can be had.
  for (const r of relicsHere(story, scene)) lines.push(clip(relicLine(story, r), BUDGET.relic));
  // What people here are saying of the world: news that has reached this place. Anyone may bring it up.
  for (const e of newsFor(story, scene.placeId, WORLD_SENT.talk)) {
    const origin = [e.placeId, ...(e.also ?? [])].some((from) => hasSameTown(story, from, scene.placeId)) ? '' : ` (word from ${w.places[e.placeId]?.name ?? 'elsewhere'})`;
    lines.push(clip(`TALK HERE ${e.text}${origin}`, BUDGET.talk));
  }

  // The story so far: earlier chapters as they were written when they ended (never rewritten, so they
  // cannot drift), then the chapter being played, which the scribe updates at each scene end.
  const earlier = chaptersForPacket(story, { full: BUDGET.chapterFull, line: BUDGET.chapterLine });
  if (earlier.length) lines.push('EARLIER CHAPTERS', ...earlier);
  if (story.summary) lines.push(`THIS CHAPTER SO FAR ${clip(story.summary, BUDGET.chapterSoFar)}`);
  const last = story.scenes.filter((s) => s.ended && s.summary).slice(-BUDGET.lastScenes);
  if (last.length) {
    lines.push('LAST SCENES');
    for (const s of last) lines.push(`- ${clip(s.summary ?? '', BUDGET.lastScene)}`);
  }
  return lines.join('\n');
}

/** Something under way that takes several efforts, for the narrator: how far it has got. */
export function contestLine(c: Contest): string {
  return `UNDER WAY ${c.label}: ${c.wins} of ${c.goal} efforts have gone the protagonist's way, ${c.losses} of ${c.limit} against them. It is won at ${c.goal} and lost at ${c.limit}; the engine counts, and says when it is decided.`;
}

/**
 * The final chapter of a story with an ending, for the narrator: what the story was about, what is
 * still coming, and that it should now be brought to a close. Nothing here ends the story: the chapter
 * ends by its own rule, and the story with it.
 */
export function endingLine(story: Story): string {
  const main = story.threads.filter((t) => t.status === 'open' && (t.kind === 'main' || t.kind === 'personal')).slice(0, 2).map((t) => t.title);
  const coming = (story.world.fronts ?? []).filter((f) => !f.stopped && f.stage > 0 && f.stage < f.stages.length).slice(0, 2).map((f) => `${f.name} (${f.stages[f.stage]})`);
  return `ENDING This is the story's final chapter. Bring it toward its close: let the open questions come to a head and be answered by what ${story.protagonist.name} does, and give the people who matter their last moments.${main.length ? ` Still open: ${main.join('; ')}.` : ''}${coming.length ? ` Still coming: ${coming.join('; ')}.` : ''} Never end it for the player: the last choices are theirs.`;
}

/** The largest a packet can get, in characters: the sum of every budget above. Checked by the playtest. */
export const PACKET_MAX_CHARS =
  200 + 120 + BUDGET.place + BUDGET.facts + 2 + 160 + BUDGET.exits + BUDGET.you + BUDGET.appearance + 9 + BUDGET.carrying + 1 + BUDGET.purse + 1 + BUDGET.power + 1 + (POWERS_MAX - 1) * (BUDGET.powerMore + 1) +
  BUDGET.peopleCards * (BUDGET.personParty + BUDGET.appearance + 9 + BUDGET.facts + 2 + 3 * (BUDGET.knowledgeLine + 28)) + 400 +
  BUDGET.storyFacts + 1 + BUDGET.contest + 1 + BUDGET.ending + 1 +
  BUDGET.threads * BUDGET.thread + 2 * BUDGET.due +
  WORLD_SENT.seeds * (BUDGET.seed + 1) + WORLD_SENT.fronts * (BUDGET.front + 1) + WORLD_SENT.talk * (BUDGET.talk + 1) + RELICS_MAX * (BUDGET.relic + 1) +
  20 + CHAPTERS_SENT.full * (BUDGET.chapterFull + 70) + CHAPTERS_SENT.lines * (BUDGET.chapterLine + 16) + BUDGET.chapterSoFar + 30 +
  40 + BUDGET.lastScenes * (BUDGET.lastScene + 4);
