// Saved stories: the format, bringing older saves up to date, and checking a file before it is trusted.
//
// Version history of the format:
//   1  The whole story, with every transcript, was one object, written out again after every turn.
//   2  The story holds its present state and the transcripts of its last two scenes. Transcripts of
//      older scenes are kept beside it (SceneArchive), written once when a scene ends. Every turn
//      carries an undo record, which is what makes rewinding possible; turns played under version 1
//      have none, so a story brought up from version 1 can be rewound only to where it was upgraded.
//   3  Chapters end and leave summaries (`chapters`); the chapter being played says when it began.
//      `summary` is now the chapter so far, not the whole story. A story brought up from an earlier
//      version keeps its summary as it is: its first chapter here simply has a longer "so far".
//
// A story file (export) is the story plus the transcripts kept beside it, so it is complete in itself.
// The API key is not part of a story and never appears in a file.
import { GIFT_IN_PLAY, cleanArts, cleanGift } from '../engine';
import { t } from '../i18n';
import { buildPacket } from './cards';
import { putAwayScenes } from './story';
import type { SceneArchive, Story } from './types';

export const SAVE_VERSION = 3;
export const FILE_FORMAT = 'bitor-quest-story';

export type SaveProblem =
  | 'not-a-story' // not a Bitor Quest story at all
  | 'newer' // written by a newer version of the app than this one
  | 'damaged'; // a story, but something in it is missing or does not fit

export class SaveError extends Error {
  problem: SaveProblem;
  constructor(problem: SaveProblem, detail: string) {
    super(detail);
    this.name = 'SaveError';
    this.problem = problem;
  }
}

/** A story ready to be opened, and the scene transcripts that belong in storage beside it. */
export interface Loaded {
  story: Story;
  scenes: SceneArchive[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * The first thing wrong with a story, in words (the interface language: it is shown to the player), or
 * null when it can be opened. This is not a full description of the format: it checks what the app
 * reaches for without looking, so that a damaged or hand-edited file is refused with a reason instead
 * of breaking a screen later.
 */
export function checkStory(story: unknown): string | null {
  if (!isObject(story)) return t('it is not a story');
  const s = story as Partial<Story> & Record<string, unknown>;
  if (typeof s.id !== 'string' || !s.id) return t('it has no id');
  if (typeof s.title !== 'string') return t('it has no title');
  const world = s.world;
  if (!isObject(world) || !isObject(world.places) || !isObject(world.people) || !Array.isArray(world.routes)) return t('its world is missing or incomplete');
  if (!isObject(world.rules) || !Array.isArray(world.factions)) return t('its world has no rules');
  for (const [id, p] of Object.entries(world.places)) if (!isObject(p) || p.id !== id || typeof p.name !== 'string') return t('the place "{id}" is not complete', { id });
  for (const [id, p] of Object.entries(world.people)) {
    if (!isObject(p) || p.id !== id || typeof p.name !== 'string' || typeof p.placeId !== 'string' || !isNumber(p.bond) || !Array.isArray(p.aliases) || !Array.isArray(p.values)) return t('the person "{id}" is not complete', { id });
  }
  const me = s.protagonist;
  if (!isObject(me) || typeof me.name !== 'string' || !isObject(me.sheet) || !Array.isArray(me.items)) return t('its protagonist is missing or incomplete');
  const sheet = me.sheet as Record<string, unknown>;
  for (const k of ['strength', 'skill', 'resistance', 'armor', 'firepower', 'hp', 'energy']) if (!isNumber(sheet[k])) return t("the protagonist's {field} is not a number", { field: k });
  for (const k of ['skills', 'advantages', 'disadvantages', 'abilities']) if (!Array.isArray(sheet[k])) return t("the protagonist's {field} are missing", { field: k });
  if (!isObject(sheet.paths)) return t("the protagonist's paths are missing");
  if (!isObject(s.clock) || !isNumber(s.clock.day) || !isNumber(s.clock.minute)) return t('its clock is missing');
  if (!isObject(s.chapter) || !isNumber(s.chapter.n) || typeof s.chapter.title !== 'string' || !isNumber(s.chapter.turnsBefore) || !isNumber(s.chapter.fromDay)) return t('its chapter is missing or incomplete');
  if (!Array.isArray(s.chapters)) return t('its earlier chapters are missing');
  for (const c of s.chapters as unknown[]) if (!isObject(c) || !isNumber(c.n) || typeof c.summary !== 'string' || typeof c.gist !== 'string' || typeof c.title !== 'string') return t('one of its earlier chapters is not complete');
  if (!isObject(s.rng) || !isNumber(s.rng.state)) return t('its dice are missing');
  if (!isObject(s.totals) || !isNumber(s.totals.turns) || !isNumber(s.totals.cost)) return t('its totals are missing');
  if (!isObject(s.settings)) return t('its settings are missing');
  if (!isNumber(s.rewindFloor)) return t('it does not say how far back it can be taken');
  for (const k of ['events', 'threads', 'commitments', 'rolls'] as const) if (!Array.isArray(s[k])) return t('its {field} are missing', { field: k });
  if (typeof s.summary !== 'string') return t('its summary is missing');
  if (!Array.isArray(s.scenes) || s.scenes.length === 0) return t('it has no scenes');
  for (const sc of s.scenes as unknown[]) {
    if (!isObject(sc) || typeof sc.id !== 'string' || typeof sc.placeId !== 'string' || !Array.isArray(sc.turns) || !Array.isArray(sc.cast) || !isObject(sc.started) || !isObject(sc.stats)) return t('one of its scenes is not complete');
    for (const turn of sc.turns as unknown[]) if (!isObject(turn) || !isNumber(turn.n) || !Array.isArray(turn.beats) || !Array.isArray(turn.groups) || typeof turn.reply !== 'string') return t('a turn in scene {scene} is not complete', { scene: String(sc.id) });
  }
  const open = (s.scenes as Story['scenes'])[s.scenes.length - 1]!;
  if (!world.places[open.placeId]) return t('the place the story stands in is not in its world');
  if (open.ended) return t('its last scene is closed, so there is nowhere to go on from');
  try {
    // The surest check that the pieces fit: build what the narrator would be sent for the open scene.
    buildPacket(story as unknown as Story, open);
  } catch (err) {
    return t('its pieces do not fit together ({why})', { why: err instanceof Error ? err.message : t('unknown reason') });
  }
  return null;
}

function checkArchive(a: unknown): a is SceneArchive {
  return isObject(a) && typeof a.sceneId === 'string' && Array.isArray(a.turns) && typeof a.packet === 'string' && (a.asides === undefined || Array.isArray(a.asides));
}

/**
 * Bring a story written by this or any earlier version up to date and make it ready to open. The
 * value given is not changed. Transcripts that belong in storage are returned beside the story.
 * Throws SaveError when it cannot be opened.
 */
export function upgrade(raw: unknown): Loaded {
  // The messages are shown to the player as they are: in the interface language.
  if (!isObject(raw) || !isObject(raw.world) || !Array.isArray(raw.scenes)) throw new SaveError('not-a-story', t('This is not a Bitor Quest story.'));
  const version = isNumber(raw.version) ? raw.version : 1;
  if (version > SAVE_VERSION) throw new SaveError('newer', t('This story was saved by a newer version of the app (format {format}; this app reads up to {max}). Update the app to open it.', { format: version, max: SAVE_VERSION }));
  let story: Story;
  try {
    story = structuredClone(raw) as unknown as Story;
  } catch {
    throw new SaveError('damaged', t('This story cannot be read.'));
  }
  const scenes: SceneArchive[] = [];
  try {
    if (version < 2) {
      if (isObject(story.settings)) story.settings.prose ??= 'clear';
      // Turns played before undo records were kept cannot be taken back.
      story.rewindFloor = isObject(story.totals) && isNumber(story.totals.turns) ? story.totals.turns : 0;
      // A scene whose first turn was the journey there was opened by that turn.
      for (const sc of story.scenes) {
        const first = sc.turns?.[0];
        if (first && /(^|\n)travel:/.test(first.engineNote ?? '')) sc.openedBy = first.n;
      }
      (story as { version: number }).version = 2;
    }
    if (story.version < 3) {
      // The chapter being played began with the first scene that carries its number.
      const first = story.scenes.find((sc) => sc.chapter === story.chapter?.n);
      const firstTurn = first ? (first.stored && first.turns.length === 0 ? first.stored.from : first.turns?.[0]?.n) : undefined;
      if (isObject(story.chapter)) {
        const turns = isObject(story.totals) && isNumber(story.totals.turns) ? story.totals.turns : 0;
        story.chapter.turnsBefore = Math.max(0, Math.min(turns, (firstTurn ?? turns + 1) - 1));
        story.chapter.fromDay = first?.started?.day ?? (isObject(story.clock) && isNumber(story.clock.day) ? story.clock.day : 1);
      }
      story.chapters = [];
      (story as { version: number }).version = 3;
    }
    // A power of the protagonist's own is held to what the rules allow, wherever the file came from:
    // texts cut to length, the rank and the tiers in range, as for one a model proposed.
    const sheet = isObject(story.protagonist) ? (story.protagonist.sheet as unknown) : null;
    if (isObject(sheet) && sheet.gift !== undefined) {
      const gift = cleanGift(sheet.gift, GIFT_IN_PLAY);
      if (gift) sheet.gift = gift; else delete sheet.gift;
    }
    // So are the powers gained in play beyond it, each with where it came from.
    if (isObject(sheet) && sheet.arts !== undefined) {
      const arts = cleanArts(sheet.arts);
      if (arts) sheet.arts = arts; else delete sheet.arts;
    }
    const wrong = checkStory(story);
    if (wrong) throw new SaveError('damaged', t('This story cannot be opened: {reason}.', { reason: wrong }));
    // Whatever version it came from: finished scenes belong in storage, and only the last two stay in memory.
    putAwayScenes(story, (a) => scenes.push(structuredClone(a)));
  } catch (err) {
    if (err instanceof SaveError) throw err;
    throw new SaveError('damaged', t('This story cannot be opened: {reason}.', { reason: err instanceof Error ? err.message : t('it is damaged') }));
  }
  return { story, scenes };
}

/** A story as the text of a file: complete in itself, transcripts included. */
export function toFile(story: Story, scenes: SceneArchive[], now: number): string {
  return JSON.stringify({ format: FILE_FORMAT, version: SAVE_VERSION, exported: now, story, scenes });
}

/** Read a story file. Throws SaveError, with a message fit to show, when it is not one or cannot be opened. */
export function fromFile(text: string): Loaded {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    throw new SaveError('not-a-story', t('This file is not a Bitor Quest story: it cannot be read as one.'));
  }
  if (!isObject(file) || file.format !== FILE_FORMAT || !isObject(file.story)) throw new SaveError('not-a-story', t('This file is not a Bitor Quest story.'));
  if (isNumber(file.version) && file.version > SAVE_VERSION) throw new SaveError('newer', t('This file was written by a newer version of the app (format {format}; this app reads up to {max}). Update the app to open it.', { format: file.version, max: SAVE_VERSION }));
  const loaded = upgrade(file.story);
  const kept = Array.isArray(file.scenes) ? file.scenes : [];
  if (!kept.every(checkArchive)) throw new SaveError('damaged', t('This story cannot be opened: {reason}.', { reason: t('one of its earlier scenes is not complete') }));
  // Transcripts the file carried, then any the upgrade just put away (those are newer and win).
  const byId = new Map<string, SceneArchive>();
  for (const a of [...(kept as SceneArchive[]), ...loaded.scenes]) byId.set(a.sceneId, a);
  // Every scene the story says is in storage must have come with the file.
  for (const sc of loaded.story.scenes) {
    if (sc.stored && sc.stored.turns > 0 && sc.turns.length === 0 && !byId.has(sc.id)) throw new SaveError('damaged', t('This story cannot be opened: {reason}.', { reason: t('the transcript of scene {n} is missing from the file', { n: sc.n }) }));
  }
  return { story: loaded.story, scenes: [...byId.values()] };
}
