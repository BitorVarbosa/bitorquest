// Retrieval by code: finding the people, places and memories a turn needs costs no model call.
import { clip, hasReached } from './cards';
import type { GameEvent, Person, Place, Story } from './types';

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const words = (s: string) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);

function mentioned(haystack: string, name: string): boolean {
  const n = norm(name).trim();
  if (n.length < 3) return false;
  const i = haystack.indexOf(n);
  if (i < 0) return false;
  const before = i === 0 ? ' ' : haystack[i - 1]!;
  const after = i + n.length >= haystack.length ? ' ' : haystack[i + n.length]!;
  return !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after);
}

/** People and known places named in a piece of text (or in the referee's list of mentions). */
export function findMentions(story: Story, text: string, extra: string[] = []): { people: Person[]; places: Place[] } {
  const hay = norm([text, ...extra].join(' \n '));
  // Someone the protagonist has never heard of cannot be asked after by name: a name typed by chance brings nobody's card.
  const people = Object.values(story.world.people).filter((p) => !p.unknown && [p.name, p.short, ...p.aliases].some((n) => mentioned(hay, n)));
  const places = Object.values(story.world.places).filter((p) => p.known !== 'hidden' && [p.name, ...(p.aliases ?? [])].some((n) => mentioned(hay, n)));
  return { people, places };
}

/** People the protagonist had never heard of who are named in a piece of the story: from now on they have. */
export function unknownNamedIn(story: Story, text: string): Person[] {
  const unknown = Object.values(story.world.people).filter((p) => p.unknown);
  if (!unknown.length) return [];
  const hay = norm(text);
  return unknown.filter((p) => mentioned(hay, p.name));
}

const STOP = new Set(['what', 'when', 'where', 'that', 'this', 'with', 'about', 'from', 'have', 'said', 'were', 'they', 'them', 'your', 'does', 'did', 'the', 'and', 'for', 'was', 'who', 'how', 'why', 'you', 'she', 'her', 'his', 'him']);

/** Memories that match what the player is reaching back for. Plain keyword scoring over the event log. */
export function recall(story: Story, query: string[], max = 3, skip: Set<string> = new Set()): GameEvent[] {
  const terms = new Set(query.flatMap(words).filter((w) => w.length >= 3 && !STOP.has(w)));
  if (terms.size === 0) return [];
  const scored: { event: GameEvent; score: number }[] = [];
  const here = story.scenes[story.scenes.length - 1]?.placeId ?? story.world.startPlace;
  for (const event of story.events) {
    if (skip.has(event.id)) continue;
    // News of the world is a memory only once it has reached where the protagonist is.
    if (event.front && !hasReached(story, event, here)) continue;
    const names = [...event.actors, ...event.witnesses].map((id) => story.world.people[id]?.name ?? '').join(' ');
    const place = story.world.places[event.placeId]?.name ?? '';
    const bag = new Set(words(`${event.text} ${names} ${place}`));
    let hits = 0;
    for (const t of terms) if (bag.has(t)) hits += 1;
    if (hits > 0) scored.push({ event, score: hits * 10 + event.importance * 2 + event.clock.day / 1000 });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, max).map((s) => s.event);
}

export function recallLine(story: Story, e: GameEvent): string {
  const place = story.world.places[e.placeId]?.name ?? '';
  return `Day ${e.clock.day}${place ? `, ${place}` : ''}: ${clip(e.text, 160)}`;
}
