// Chapters: when one ends, and what it leaves behind.
//
// A chapter ends by rule, at the end of a scene: when a main thread was finished in it, or when it has
// run about a session's worth of play. The rule is the game's, not the narrator's, so that the things
// that renew "once per chapter" (destiny points, the softened death test) renew at a pace the player
// can count on, and so that the story's summary never has to carry more than one chapter of drift.
//
// What a finished chapter leaves is written once and never rewritten: a summary of a few sentences and
// the same in one line. The narrator is sent the fixed summaries of earlier chapters and a short
// rolling one for the chapter being played. A story a hundred chapters long sends no more than one
// ten chapters long: the newest two in full, then one line each for a few more.
import { tl } from '../i18n';
import { clip } from './cards';
import type { Chapter, Scene, Story } from './types';

export const CHAPTER_RULE = {
  /** A chapter is never shorter than this many scenes, however quickly its goal is reached. */
  minScenes: 3,
  /** It ends at the first scene end after this many scenes... */
  maxScenes: 12,
  /** ...or after this many turns. */
  maxTurns: 90,
} as const;

const played = (sc: Scene) => sc.turns.length > 0 || (sc.stored?.turns ?? 0) > 0;

/** The scenes of the chapter being played that have ended with something in them, oldest first. */
export function chapterScenes(story: Story): Scene[] {
  return story.scenes.filter((sc) => sc.chapter === story.chapter.n && sc.ended && played(sc));
}

/** Whether the chapter ends with the scene that has just been closed. */
export function chapterEnds(story: Story): boolean {
  if (story.over) return false;
  const scenes = chapterScenes(story).length;
  if (scenes < CHAPTER_RULE.minScenes) return false;
  const turns = story.totals.turns - story.chapter.turnsBefore;
  return !!story.chapter.mainDone || scenes >= CHAPTER_RULE.maxScenes || turns >= CHAPTER_RULE.maxTurns;
}

const firstSentence = (text: string) => (/^.*?[.!?](?=\s|$)/.exec(text.trim())?.[0] ?? text.trim());

/**
 * End the chapter being played and begin the next. `written` is what the scribe wrote for it; any
 * part that is missing is made by code from the scene summaries, so a chapter always closes.
 * Destiny points are restored as the new chapter begins.
 */
export function closeChapter(story: Story, written: { summary?: string | null; gist?: string | null; next_title?: string | null } | null): { ended: Chapter; begins: Story['chapter'] } {
  const scenes = chapterScenes(story);
  // What code writes here is part of the story, in its language.
  const l = story.settings.language;
  const fromScenes = scenes.map((sc) => sc.summary ?? '').filter(Boolean).join(' ');
  const summary = clip(written?.summary?.trim() || fromScenes || tl(l, 'Chapter {n}.', { n: story.chapter.n }), 420);
  const ended: Chapter = {
    n: story.chapter.n,
    title: story.chapter.title,
    summary,
    gist: clip(written?.gist?.trim() || firstSentence(summary), 120),
    fromDay: story.chapter.fromDay,
    toDay: story.clock.day,
    turns: story.totals.turns - story.chapter.turnsBefore,
    scenes: scenes.length,
  };
  story.chapters.push(ended);
  story.chapter = {
    n: ended.n + 1,
    title: clip(written?.next_title?.trim().replace(/^["“]|["”.]$/g, '') || tl(l, 'Onward'), 48),
    turnsBefore: story.totals.turns,
    fromDay: story.clock.day,
  };
  // The new chapter has no "so far" yet: what came before is in the chapter summaries.
  story.summary = '';
  const me = story.protagonist;
  me.destiny = Math.max(me.destiny, me.destinyMax);
  return { ended, begins: story.chapter };
}

/** With an ending: about how many chapters a story (or a season of it) runs, its final one included. */
export const ENDING_CHAPTERS = { short: 3, medium: 6, long: 10 } as const;

/**
 * Whether the chapter that has just begun is the story's last. Only in a story with an ending: it has
 * run its length, or its main thread was finished in the chapter that just ended (and none is open) and
 * it has had two chapters at least. Asked right after `closeChapter`.
 */
export function finalComes(story: Story, mainWasDone: boolean): boolean {
  if (story.settings.ending !== 'ending' || story.chapter.final) return false;
  const done = story.chapters.length - (story.seasonFrom ?? 0);
  const length = ENDING_CHAPTERS[story.settings.length ?? 'medium'];
  const mainOpen = story.threads.some((t) => t.kind === 'main' && t.status === 'open');
  return done + 1 >= length || (mainWasDone && !mainOpen && done >= 2);
}

/** How many finished chapters are sent in full, and how many more as one line each. */
export const CHAPTERS_SENT = { full: 2, lines: 8 } as const;

/** The finished chapters as the narrator is sent them: the newest in full, older ones in a line, the oldest not at all. */
export function chaptersForPacket(story: Story, budget: { full: number; line: number }): string[] {
  const done = story.chapters;
  const out: string[] = [];
  const firstFull = Math.max(0, done.length - CHAPTERS_SENT.full);
  const firstLine = Math.max(0, firstFull - CHAPTERS_SENT.lines);
  for (let i = firstLine; i < done.length; i++) {
    const c = done[i]!;
    out.push(i >= firstFull ? `- Chapter ${c.n} "${c.title}": ${clip(c.summary, budget.full)}` : `- Chapter ${c.n}: ${clip(c.gist, budget.line)}`);
  }
  return out;
}
