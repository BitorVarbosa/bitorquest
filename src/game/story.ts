// Starting a story and moving between scenes. Pure functions over the story object.
import { addMinutes, clockLabel, makeRng, type Clock } from '../engine';
import { tl } from '../i18n';
import { buildPacket, castOf, parentChain, seedsFor } from './cards';
import { neighbours, wayBetween } from './world';
import type { Chapter, GameEvent, Protagonist, Scene, SceneArchive, Story, StorySettings, Thread, Commitment, World } from './types';

let counter = 0;
/** Short ids, unique within a story. Not random: a story replays identically from its seed. */
export function nextId(prefix: string, story?: Pick<Story, 'events' | 'scenes' | 'threads' | 'commitments'>): string {
  if (story) return `${prefix}${story.events.length + story.scenes.length + story.threads.length + story.commitments.length + 1}_${(counter++).toString(36)}`;
  return `${prefix}${(counter++).toString(36)}`;
}

export interface StorySeed {
  id: string;
  title: string;
  world: World;
  protagonist: Protagonist;
  clock: Clock;
  /** The chapter the story starts in, and the day that chapter began. */
  chapter: { n: number; title: string; fromDay: number };
  /** Chapters that ended before the story is picked up (a story can begin in the middle of things). */
  chapters: Chapter[];
  threads: Thread[];
  commitments: Commitment[];
  events: GameEvent[];
  /** The chapter being played so far, in a paragraph. */
  summary: string;
  settings: StorySettings;
  /** Scene number the story starts at (a story can begin in the middle of things). */
  sceneNumber: number;
  turnsBefore: number;
  seed: number;
  /** How the first scene opens, for the narrator (a story begun from a built world has one). */
  opening?: string;
}

/** A world is a template: a story works on its own copy, so playing never changes the template. */
export function newStory(seed: StorySeed, now: number): Story {
  const story: Story = {
    id: seed.id,
    title: seed.title,
    created: now,
    lastPlayed: now,
    world: structuredClone(seed.world),
    protagonist: structuredClone(seed.protagonist),
    clock: { ...seed.clock },
    chapter: { ...seed.chapter, turnsBefore: seed.turnsBefore },
    chapters: structuredClone(seed.chapters),
    scenes: [],
    events: structuredClone(seed.events),
    threads: structuredClone(seed.threads),
    commitments: structuredClone(seed.commitments),
    summary: seed.summary,
    settings: { ...seed.settings },
    rng: { state: makeRng(seed.seed).state },
    rolls: [],
    totals: { turns: seed.turnsBefore, cost: 0 },
    softenUsed: null,
    rewindFloor: seed.turnsBefore,
    ...(seed.opening?.trim() ? { opening: seed.opening.trim() } : {}),
    version: 3,
  };
  startScene(story, story.world.startPlace, seed.sceneNumber);
  return story;
}

export function currentScene(story: Story): Scene {
  const scene = story.scenes[story.scenes.length - 1];
  if (!scene) throw new Error('the story has no scene');
  return scene;
}

/** "Scene 4 · Lantern Market · evening", in the story's language. */
export function sceneTitle(story: Story, scene: Scene): string {
  const l = story.settings.language;
  const place = story.world.places[scene.placeId]?.name ?? '';
  return tl(l, 'Scene {n} · {place} · {time}', { n: scene.n, place, time: clockLabel(scene.started, l).split(' · ')[1] ?? '' });
}

/** Open a new scene at a place. Its packet is built here, once, and never changed afterwards. `openedBy` is the turn that took the protagonist there, when one did. */
export function startScene(story: Story, placeId: string, number?: number, openedBy?: number): Scene {
  const place = story.world.places[placeId];
  if (!place) throw new Error(`unknown place ${placeId}`);
  place.known = 'visited';
  // Being somewhere means knowing where it is: the places it sits inside are known too.
  for (const p of parentChain(story, placeId)) if (p.known === 'hidden') p.known = 'heard';
  // And standing somewhere shows where one can go from there: places one journey away are heard of from now on.
  for (const n of neighbours(story.world, placeId)) { const p = story.world.places[n.id]; if (p?.known === 'hidden') p.known = 'heard'; }
  // The party travels with the protagonist.
  for (const p of Object.values(story.world.people)) if (p.inParty) p.placeId = placeId;
  // The situations put in front of the narrator here are in view today: one left alone long enough comes to pass by itself.
  for (const s of seedsFor(story, placeId)) (story.seedsSeen ??= {})[s.id] = story.clock.day;
  const last = story.scenes[story.scenes.length - 1];
  const n = number ?? (last ? last.n + 1 : 1);
  const cast = castOf(story, placeId);
  for (const id of cast) {
    const p = story.world.people[id];
    if (p && p.count === 1 && p.tier !== 'extra') { p.met = true; delete p.unknown; }
  }
  const scene: Scene = {
    id: `s${n}`,
    n,
    chapter: story.chapter.n,
    placeId,
    started: { ...story.clock },
    cast,
    packet: '',
    turns: [],
    summary: null,
    ended: false,
    combat: null,
    stats: { testsPassed: 0, threadAdvanced: false, fightsWon: 0, inDanger: false },
    ...(openedBy !== undefined ? { openedBy } : {}),
  };
  scene.packet = buildPacket(story, scene);
  story.scenes.push(scene);
  return scene;
}

/** How many finished scenes keep their transcript in memory, besides the one being played. */
export const SCENES_IN_MEMORY = 1;

/**
 * Finished scenes go to storage: each is handed to `put` once, when it has ended, and after that only
 * the scene being played and the one before it keep their transcript in memory. The receiver must take
 * its own copy of what it is handed.
 */
export function putAwayScenes(story: Story, put: (scene: SceneArchive) => void): void {
  const scenes = story.scenes;
  scenes.forEach((sc, i) => {
    if (!sc.ended) return;
    if (!sc.stored) {
      put({ sceneId: sc.id, turns: sc.turns, ...(sc.asides?.length ? { asides: sc.asides } : {}), packet: sc.packet });
      sc.stored = {
        turns: sc.turns.length, from: sc.turns[0]?.n ?? 0, to: sc.turns[sc.turns.length - 1]?.n ?? 0,
        cost: sc.turns.reduce((sum, t) => sum + t.cost, 0) + (sc.asides ?? []).reduce((sum, a) => sum + a.cost, 0),
      };
    }
    if (i < scenes.length - 1 - SCENES_IN_MEMORY && (sc.turns.length > 0 || sc.packet)) {
      sc.turns = [];
      delete sc.asides;
      sc.packet = '';
    }
  });
}

/** One journey from a to b: how long it takes, or null when there is no way in one journey (see `neighbours` for what counts as a way). */
export function routeBetween(story: Story, a: string, b: string): { minutes: number; note?: string } | null {
  return wayBetween(story.world, a, b);
}

export function passTime(story: Story, minutes: number): void {
  story.clock = addMinutes(story.clock, minutes);
}

/** A summary made by code, used only if the scribe cannot be reached, so play never stops on it. In the story's language, as the scribe's would be. */
export function fallbackSummary(story: Story, scene: Scene): string {
  const l = story.settings.language;
  const place = story.world.places[scene.placeId]?.name ?? tl(l, 'somewhere');
  const did = scene.turns.map((t) => t.input).filter(Boolean).slice(0, 3).join('; ');
  const day = scene.started.day;
  return (did ? tl(l, 'At {place} on day {day}: {did}.', { place, day, did }) : tl(l, 'At {place} on day {day}.', { place, day })).slice(0, 300);
}
