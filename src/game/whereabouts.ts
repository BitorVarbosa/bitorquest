// People do not stay where the world was built with them.
//
// Until this file the people of a world never moved: a stage of something in motion could say "the
// surveyor is sent away" while her card still placed her at the inn, a companion could never be asked
// along or left behind, and a secret stayed with those who saw it for ever. The rules here change
// where people are and what they know, and none of them asks a model anything:
//
//   - Company. Someone who trusts the protagonist (the Trusted stage of the bond) comes along when
//     asked, if the party has room. A companion stays behind when told to, and walks out by
//     themselves when they hold a grievance and no longer count the protagonist a friend.
//   - Fates. The builder may write, for a stage of something in motion or for a situation, what
//     becomes of one person when it comes to pass: they move, leave, or die. It is applied when the
//     stage comes, unless that person is travelling with the protagonist by then.
//   - Situations left alone. A situation the protagonist walked away from comes to pass by itself
//     after some days: its news is told where it happened, and it is no longer offered to the narrator.
//   - Telling. Someone who saw a thing kept secret, and is no friend of the protagonist, tells the
//     people around them, a few at a time.
//
// What happens on stage is the scribe's to report (who left for good, who died), and the session
// applies it with `sendAway` and `moveTo` below.
import { roll, stageIndex, type Rng } from '../engine';
import { dropRelics, returnPowers } from './arts';
import { clip, hasSameTown, isAway } from './cards';
import type { Fate, GameEvent, LostPower, Person, Seed, Story } from './types';

const minutesOf = (c: { day: number; minute: number }): number => c.day * 1440 + c.minute;

// ---------- Where people are ----------

/**
 * Someone leaves the story's map for good, or dies. They are with nobody and nowhere from then on.
 * Returns the powers they had taken from the protagonist that came back with their death.
 */
export function sendAway(story: Story, p: Person, how: 'left' | 'dead', why: string): LostPower[] {
  // An item of power they carried: dying, they drop it where they were, free to take; leaving, they take it with them.
  if (how === 'dead' && story.world.places[p.placeId]) dropRelics(story, p.id, p.placeId);
  // A power they took from the protagonist comes back when they die; leaving, they take it with them.
  const back = how === 'dead' ? returnPowers(story, p.id) : [];
  p.inParty = false;
  p.placeId = 'nowhere';
  p.away = { how, why: clip(why.trim().replace(/[.\s]+$/, '') || (how === 'dead' ? 'they died' : 'they left'), 100), day: story.clock.day };
  p.pendingMoment = null;
  return back;
}

/** Someone goes to live or stay at another place on the map. False when that place does not exist or they are there already. */
export function movePerson(story: Story, p: Person, to: string | null | undefined): boolean {
  if (!to || !story.world.places[to] || to === p.placeId) return false;
  p.placeId = to;
  return true;
}

/**
 * What the builder wrote would become of someone comes to pass. It passes by anyone who is travelling
 * with the protagonist (they were not where it happened), and anyone already gone.
 */
export function applyFate(story: Story, fate: Fate): boolean {
  const p = story.world.people[fate.who];
  if (!p || p.inParty || isAway(p)) return false;
  if (fate.then === 'moves') return movePerson(story, p, fate.to);
  sendAway(story, p, fate.then === 'dies' ? 'dead' : 'left', fate.why);
  return true;
}

// ---------- Company ----------

export const PARTY = {
  /** The stage of the bond at which someone will travel with the protagonist: Trusted. */
  joinStage: 3,
  /** A companion who holds a grievance walks out when the bond is below this: no longer Friendly. */
  partBelow: 20,
} as const;

export type JoinAnswer =
  | { ok: true }
  | { ok: false; reason: 'not_one_person' | 'already' | 'none_allowed' | 'full' | 'grievance' | 'stage'; have: number };

/** Whether someone would travel with the protagonist if asked now. */
export function canJoin(story: Story, p: Person): JoinAnswer {
  const have = stageIndex(p.bond);
  if (p.count > 1 || p.tier === 'extra' || isAway(p)) return { ok: false, reason: 'not_one_person', have };
  if (p.inParty) return { ok: false, reason: 'already', have };
  const room = story.settings.companions;
  if (room <= 0) return { ok: false, reason: 'none_allowed', have };
  if (Object.values(story.world.people).filter((x) => x.inParty).length >= room) return { ok: false, reason: 'full', have };
  if (p.grievance) return { ok: false, reason: 'grievance', have };
  // Someone who has travelled with the protagonist before chose that company once already.
  if (have < PARTY.joinStage && !p.travelled) return { ok: false, reason: 'stage', have };
  return { ok: true };
}

export function joinParty(p: Person): void {
  p.inParty = true;
  p.met = true;
  delete p.unknown;
}

/** A companion stops travelling with the protagonist and stays where they are. */
export function leaveParty(p: Person, placeId: string): void {
  p.inParty = false;
  p.travelled = true;
  p.placeId = placeId;
}

/** Companions who will not go on: they hold a grievance, and the bond has fallen below Friendly. */
export function walkingOut(story: Story): Person[] {
  return Object.values(story.world.people).filter((p) => p.inParty && !!p.grievance && p.bond < PARTY.partBelow);
}

// ---------- Situations left alone ----------

export const SEED_RULE = {
  /** A situation comes to pass by itself when the protagonist has been away from it for this many days. */
  days: 4,
} as const;

/**
 * A situation nobody stepped into comes to pass. At most one a chapter, and never one in the town
 * where the protagonist is: there it is the narrator's to play. Only situations the builder wrote an
 * outcome for (news, or what becomes of someone) can end this way; the others wait.
 */
export function lapseSeeds(story: Story, placeId: string): { seed: Seed; fated: boolean }[] {
  if (story.seedLapsedIn === story.chapter.n) return [];
  const settled = new Set(story.world.settled ?? []);
  const start = story.scenes[0]?.started.day ?? story.clock.day;
  for (const s of story.world.seeds ?? []) {
    if (s.over || settled.has(s.id) || (!s.news?.trim() && !s.fate) || !story.world.places[s.placeId]) continue;
    if (hasSameTown(story, s.placeId, placeId)) continue;
    if (story.clock.day - (story.seedsSeen?.[s.id] ?? start) < SEED_RULE.days) continue;
    (story.world.settled ??= []).push(s.id);
    story.seedLapsedIn = story.chapter.n;
    return [{ seed: s, fated: s.fate ? applyFate(story, s.fate) : false }];
  }
  return [];
}

// ---------- Telling ----------

export const TELL = {
  /** Only what happened in the last so many days is still passed on. */
  days: 10,
  /** A secret reaches at most this many people by being told. */
  max: 6,
  /** One who knows tells this many of the people around them at a time. */
  listeners: 2,
  /** Someone at this bond or above keeps the protagonist's secrets (unless they hold a grievance). */
  friend: 20,
  /** Each time the world moves, a secret is passed on when a die shows this or less. */
  chance: 2,
} as const;

/**
 * People talk. Something kept secret that mattered is told by those who saw it to the people where
 * they are, unless they are a friend of the protagonist. Called when a scene ends, with the world's
 * dice. Returns how many people were told.
 */
export function tell(story: Story, dice: Rng): number {
  const people = story.world.people;
  const now = minutesOf(story.clock);
  const about = (p: Person | undefined): p is Person => !!p && p.count === 1 && p.tier !== 'extra' && !p.inParty && !isAway(p);
  const rank = (p: Person) => (p.tier === 'major' ? 0 : 1);
  let told = 0;
  // Newest first, and no further back than talk lasts.
  for (let i = story.events.length - 1; i >= 0; i--) {
    const e: GameEvent = story.events[i]!;
    if (now - minutesOf(e.clock) > TELL.days * 1440) break;
    if (e.reach !== 'secret' || e.importance < 2 || e.front || e.told.length >= TELL.max) continue;
    const tellers = [...new Set([...e.actors, ...e.witnesses])].map((id) => people[id]).filter(about).filter((p) => p.bond < TELL.friend || !!p.grievance);
    if (!tellers.length) continue;
    if (roll(dice) > TELL.chance) continue;
    const know = new Set([...e.actors, ...e.witnesses, ...e.told]);
    for (const teller of tellers) {
      const listeners = Object.values(people)
        .filter((p) => about(p) && p.placeId === teller.placeId && !know.has(p.id))
        .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))
        .slice(0, TELL.listeners);
      for (const l of listeners) {
        if (e.told.length >= TELL.max) break;
        e.told.push(l.id);
        know.add(l.id);
        told += 1;
      }
    }
  }
  return told;
}
