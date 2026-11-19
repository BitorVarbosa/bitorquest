// The world moves.
//
// A world has a few things in motion (fronts): a plot, a levy, something waking under the hill. Each
// is a short list of stages that come to pass, in order, if nobody stops it. This file is the rule
// that moves them. No model is asked: the stages were written when the world was built, and what
// decides when the next one comes is the story's own clock and a die.
//
// The rule, in one line: every front moves one stage a chapter. During the chapter if enough days
// have gone by (a die decides which day), otherwise when the chapter ends. So the world changes at
// the speed of the story: a week on the road does not burn through a plot, and a chapter spent in
// one town still ends with the world a little further on.
//
// The protagonist can hold a front back or end it: the scribe says so when a scene plainly did, and
// the rule does the rest. A stage that people would see or hear of becomes news, which spreads by the
// same hearsay rule as everything else (cards.ts).
import { roll, type Clock, type Rng } from '../engine';
import type { Front, Story } from './types';

export const FRONT_RULE = {
  /** Days that must pass since a front last moved before it can move again inside a chapter. Each front adds 0, 1 or 2 by its position, so that they do not all move on the same day. */
  days: 3,
  stagger: 3,
  /** When it is due, it moves on a die of this or less (of 6); otherwise it waits another day. */
  chance: 4,
  /** At the end of a chapter a front that has not moved in it moves without a roll, if at least this many days have passed. */
  daysAtChapterEnd: 1,
  /** A front the protagonist set back does not move for this many days, nor again in that chapter. */
  setBackDays: 3,
} as const;

const minutesOf = (c: Clock): number => c.day * 1440 + c.minute;

/** Still going: not stopped, and with a stage left to come. */
export const frontOpen = (f: Front): boolean => !f.stopped && f.stage < f.stages.length;

/** A stage that has just come to pass. */
export interface FrontMove {
  front: Front;
  /** Which stage came to pass, counting from 1. */
  stage: number;
  what: string;
  /** What people would see or hear of it, or null when it happened out of sight. */
  news: string | null;
  /** Where the news starts from: a town it touches if there is one, and then every other place it touches. */
  place: string;
  also: string[];
  /** It was the front's last stage: what it was driving toward has happened. */
  last: boolean;
}

/** Where word of a front starts: the first town it touches, or failing that the first place. */
export function frontPlace(story: Story, f: Front): string {
  const places = story.world.places;
  const known = f.touches.filter((id) => places[id]);
  return known.find((id) => places[id]!.kind === 'settlement') ?? known[0] ?? story.world.startPlace;
}

/**
 * Move the world on. Called when a scene ends, with `chapterEnds` true when that scene also ends the
 * chapter (and before the chapter number changes). Returns the stages that came to pass, already
 * applied to the fronts. Uses the world's own dice, so the player's rolls are untouched by it.
 */
export function advanceFronts(story: Story, dice: Rng, chapterEnds: boolean): FrontMove[] {
  const out: FrontMove[] = [];
  const now = story.clock;
  const t = minutesOf(now);
  const start = story.scenes[0]?.started ?? now;
  (story.world.fronts ?? []).forEach((f, i) => {
    if (!frontOpen(f)) return;
    if (f.movedIn === story.chapter.n) return; // one stage a chapter
    if (f.heldUntil !== undefined && now.day < f.heldUntil) return;
    const since = f.since ?? start;
    const waited = t - minutesOf(since);
    let moves = false;
    if (waited >= (FRONT_RULE.days + (i % FRONT_RULE.stagger)) * 1440) {
      moves = roll(dice) <= FRONT_RULE.chance;
      // Not today: it is due again tomorrow.
      if (!moves) f.since = { day: since.day + 1, minute: since.minute };
    }
    if (!moves && chapterEnds && waited >= FRONT_RULE.daysAtChapterEnd * 1440) moves = true;
    if (!moves) return;
    const what = f.stages[f.stage]!;
    const news = f.news?.[f.stage]?.trim() || null;
    f.stage += 1;
    f.since = { ...now };
    f.movedIn = story.chapter.n;
    const place = frontPlace(story, f);
    out.push({ front: f, stage: f.stage, what, news, place, also: f.touches.filter((id) => id !== place && story.world.places[id]), last: f.stage >= f.stages.length });
  });
  return out;
}

/** The protagonist hindered a front in a scene: it does not move for a few days, nor again in this chapter. */
export function setBack(story: Story, f: Front): void {
  if (!frontOpen(f)) return;
  f.heldUntil = story.clock.day + FRONT_RULE.setBackDays;
  f.movedIn = story.chapter.n;
}

/** The protagonist ended a front for good: no further stage comes to pass. */
export function stopFront(f: Front): void {
  if (frontOpen(f)) f.stopped = true;
}
