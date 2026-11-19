// A play session: one story being played. This is the turn pipeline.
//
//   the player's input
//     -> REFEREE (cheap model): what kind of action is this, does it need a test, who and what is involved
//     -> ENGINE (code, free): validates, rolls, applies the rules, looks up cards and memories
//     -> NARRATOR (the player's chosen model): tells what happens, knowing the outcome it was handed
//     -> ENGINE again: applies what the narrator flagged (time, bonds, threads), records events
//   and at the end of a scene
//     -> SCRIBE (cheap model): turns the scene into a summary and event records
//
// No React and no browser storage in here: the interface and the headless playtest drive the same code.
import {
  ABILITIES, GIFT_TEXT, GIFT_WORKED_MAX, PATHS, STAGES, XP_TO_LEARN, abilityCost, act, addMinutes, applyBond, canAttempt, canImprovise, canLearn, canStagger, canUseAbility, clockLabel, commandOf, condition, conditionLabel, durationLabel,
  GIFT_IN_PLAY, XP_TO_AWAKEN, canKeep, canRaiseGift, cleanGift, forgetMove, keepMove, raiseGift,
  OWN_POWER, hasPower, isTakingKind, movePower, powerById, powersOf, splitMoveKey, withPower, type HeldPower, type TakingKind,
  fightEffect, isEffectKind, learnDifficulty, powerOf, stageIndex, teachingStage,
  fightsAtRange, isUp, makeCombatant, maxEnergy, maxHp, resolveDown, rest, runTest, sceneExperience, slotOf, startCombat, winChance,
  canRaiseAttribute, canRaisePath, raiseAttribute, raisePath, XP_PER_LEVEL,
  type Attribute, type BondTier, type Combat, type CombatAction, type CombatEffect, type CombatEvent, type Combatant, type DownChoice, type EffectKind, type GiftKind, type NewCombatant, type Path, type Power, type Rng,
} from '../engine';
import { listOf, m, tl, tln, type Lang } from '../i18n';
import { Unusable } from './builder';
import { describe, type Described } from './creation';
import { APPEARANCE_MAX, LOOK_MAX, asksIn, castOf, clip, exitsFrom, frontsAt, isAway, personCard, powerLine, relicsHere, teachableHere, whereLine, withinReach } from './cards';
import { BORROWED, XP_TO_LEARN_DISCIPLINE, borrowPower, hasNatureHeld, returnPowers, robPower, thiefIn, canAwakenDiscipline, canEat, canGet, canLearnDiscipline, canTakePower, disciplineArt, disciplineStage, disciplinesTaughtHere, dropRelics, eatRelic, giveBack, holdsDiscipline, powerFree, relicOf, setRelicAside, takeRelic, type CannotTakePower } from './arts';
import { chapterEnds, chapterScenes, closeChapter, finalComes } from './chapters';
import { applyExpansion, cleanExpansion } from './expand';
import { advanceFronts, frontOpen, setBack, stopFront } from './fronts';
import { PARTY, applyFate, canJoin, joinParty, lapseSeeds, leaveParty, movePerson, sendAway, tell, walkingOut } from './whereabouts';
import { expandRequest, type ExpandOut } from './llm/architect';
import { costOf } from './llm/models';
import { PASSAGE_MIN_CHARS, firstPassageSoFar, parseReply, storyTextSoFar, type Flags, type StoryPart } from './llm/parse';
import { SCENE_MAX_CHARS, asideRequest, epilogueRequest, narratorRequest, refereeRequest, scribeRequest, transcriptChars, type ModelChoice } from './llm/requests';
import type { EpilogueOut, RefereeOut, ScribeOut } from './llm/schemas';
import { LlmError, type LlmResponse, type MockHints, type Role, type Transport } from './llm/transport';
import { applyUndo, undoOf } from './patch';
import { findMentions, recall, recallLine, unknownNamedIn } from './search';
import { currentScene, fallbackSummary, nextId, putAwayScenes, routeBetween, sceneTitle, startScene } from './story';
import { HAGGLE, SELLING, addMoney, amountLabel, amountOf, currencyFor, exchanged, friendRate, hasMoney, isPrice, moneyOf, pay, payable, priceIn, type Price } from './money';
import { powerEffect } from './world';
import type { Beat, GameEvent, Item, Note, Person, Scene, SceneArchive, Story, StorySettings, Turn, UsageEntry } from './types';

export interface Budget {
  /** Dollars spent today, across every story. */
  spentToday(): number;
  /** The daily limit in dollars. */
  cap(): number;
  record(entry: UsageEntry, storyId: string): void;
}

/** Where the transcripts of finished scenes are kept, outside the story in memory. */
export interface SceneStore {
  /** Keep a finished scene's transcript. The store must take its own copy. */
  put(storyId: string, scene: SceneArchive): void;
  /** Read one back, to rewind into that scene. Null when it is not there. */
  get(storyId: string, sceneId: string): Promise<SceneArchive | null>;
  /** Forget the transcripts of scenes that no longer exist in the story (after a rewind). */
  drop(storyId: string, sceneIds: string[]): void;
}

export interface SessionDeps {
  transport: Transport;
  models: () => ModelChoice;
  budget: Budget;
  save: (story: Story) => void;
  now: () => number;
  /** Show long replies passage by passage, with Continue. */
  paging: () => boolean;
  /** When given, finished scenes are put away here and only the last two stay in memory. Without it everything stays in memory. */
  scenes?: SceneStore;
}

/** A point the story can be taken back to: the start of a scene. */
export interface RewindPoint {
  sceneId: string;
  /** The story is cut to just after this turn. */
  keep: number;
  /** How many turns that takes away. */
  drops: number;
}


export type Phase =
  | 'idle'
  | 'thinking' // the referee and the engine are working out what the action is
  | 'writing' // the narrator's reply is arriving
  | 'recording' // a scene just ended and the scribe is writing it up
  | 'mapping'; // the place being arrived at was only a sketch: what is inside it is being written

export type Blocker =
  | { kind: 'offline' | 'overloaded' | 'rate' | 'key' | 'credit' | 'error'; message: string; status: number | null; retryAfter: number | null }
  | { kind: 'refusal' }
  | { kind: 'budget'; spent: number; cap: number }
  /** The same story is open in another window: playing here would let one overwrite the other. */
  | { kind: 'elsewhere' };

/** The game could not tell what the player meant and asked. The next thing the player sends is the answer. */
export interface Asking {
  /** What the player typed first. */
  original: string;
  to: string | null;
  question: string;
  /** Two or three short answers offered as buttons. */
  options: string[];
  /** The question is whether to let this many minutes pass: the first answer lets them, the second gives the text back. */
  wait?: number;
}

type Special =
  | { type: 'combat'; action: CombatAction }
  | { type: 'down'; choice: DownChoice }
  /** The first scene of a new story: the narrator opens it, and nobody has typed anything. */
  | { type: 'begin' }
  /** The player said yes to letting this much time pass (see `WAIT`): no referee is asked again. */
  | { type: 'wait'; minutes: number };

/**
 * Letting time pass, as the player says it in the story ("we camp here until Tobin comes"). A rest of up
 * to `long` minutes simply happens. Anything longer is asked about first, by the game and for nothing,
 * and lasts `max` at most; the narrator ends it early when something the story set up comes sooner.
 */
export const WAIT = { long: 12 * 60, max: 14 * 1440 } as const;

/** At most this many things are kept as true about one person or place, and about the story as a whole; each this long at most. */
export const FACTS_MAX = { about: 4, story: 6, chars: 160 } as const;

/** What the log and the journal call the turn that opens a story (in English; a story is given it in its own language). */
export const BEGIN_TEXT = m('The story begins.');

interface Input {
  text: string;
  to: string | null;
  special?: Special;
  /** A question to the narrator, outside the story. */
  aside?: boolean;
  /** This text answers a question the game asked about an earlier one. */
  clarifies?: Asking;
  /** The place chosen on the map. A wish to leave, judged like any typed action: something in the scene may stand in the way. */
  travelTo?: string;
}

/** Everything decided before the narrator is asked. Kept until the reply arrives, so a retry never rolls again. */
interface Prepared {
  input: Input;
  userText: string;
  beats: Beat[];
  lines: string[];
  opening: boolean;
  hints: MockHints;
  usage: UsageEntry[];
  /** The engine took the protagonist to another place this turn: the route's time is the time that passed. */
  moved: boolean;
  /** Run after the reply has been applied (for example: mark a waiting moment as played). */
  after: (() => void)[];
  /** Sent to the narrator with this request only, after the engine's note, and never kept: the player's word on another take. */
  note?: string;
  /** The player let time pass: at most this many minutes, as the narrator reports it. */
  wait?: number;
}

const YOU = 'you';

/**
 * What the narrator is told when it opens a story. The player knows nothing yet, so the first passages
 * say, briefly and in this order, who the protagonist is, where they are, why they are there and why
 * the people at their side are with them, and then what just happened: only then is it the player's move.
 */
function openingLine(story: Story): string {
  const you = story.protagonist.name;
  const party = Object.values(story.world.people).filter((p) => p.inParty && !p.away).map((p) => p.name);
  const company = party.length ? ` why ${listOf(party, 'en')} ${party.length === 1 ? 'is' : 'are'} with ${you} and what they are to each other;` : '';
  return `story opening: this is the first scene of the story, and ${you} has not acted yet. The player knows nothing of this world or this moment yet, so begin with a brief introduction before anything happens, each part a short passage of its own: who ${you} is and the life they lead here (from YOU); where they are right now; why they are there today;${company} then what has just happened, from this: ${story.opening ?? 'the scene the packet describes.'} The whole introduction is a few plain sentences, no history lesson and no lists: the player should know where they are, who they are and what is going on as fast as possible. Bring in whoever the packet says is present, and stop at the first moment where what happens next is the player's choice.`;
}
/** What is said of someone now, as the parts the player can describe. */
const describedNow = (p: Person): Described => ({ look: p.look ?? '', appearance: p.appearance ?? '', card: p.card });
/** A line that begins with "//" or "((" is addressed to the narrator, not said in the story. */
const OUT_OF_STORY = /^(?:\/\/+|\(\()\s*([\s\S]*?)\s*(?:\)\))?$/;
const ODDS_BAND = { story: 0.9, adventure: 0.65, brutal: 0.4 } as const;
/** How far each tier of a power reaches, as the narrator is told it. The referee rates by the same scale (prompts.ts). */
const REACH = ['', 'a small trick within arm’s length, for moments', 'one person or one room, for a scene', 'several people or a building', 'a crowd, a street, or something that lasts'] as const;

export class Session {
  story: Story;
  phase: Phase = 'idle';
  /** Set while a turn is prepared: the time the player chose to let pass, in minutes, or 0. */
  private waitNow = 0;
  /**
   * The turn in flight: the player's line, what the rules decided (dice, blows; known before the
   * narrator writes), and the first passage of the telling once all of it has arrived. Text is never
   * shown while it is still being written: a passage appears whole, the first one as soon as it is
   * complete and the rest on Continue. An answer outside the story appears when it is finished.
   */
  live: { text: string; to: string | null; aside?: boolean; beats?: Beat[]; first?: StoryPart[]; /** The turn is in the story now; only its scene is still being written up. */ kept?: boolean } | null = null;
  blocker: Blocker | null = null;
  /** A one-line answer from the engine that needed no narrator: "You do not know that ability." */
  notice: string | null = null;
  /** The game asked what the player meant by their last text, and is waiting for the answer. Nothing has happened in the story yet. */
  asking: Asking | null = null;
  /** Text handed back to the input box after Stop or a declined turn. */
  returned: string | null = null;
  /** Passage groups of the latest turn that are on screen. */
  shown = Infinity;
  /** Today's spending passed 80% of the limit. */
  budgetWarning = false;
  /** The name of the place being filled in right now (phase 'mapping'). */
  filling: string | null = null;

  private deps: SessionDeps;
  private listeners = new Set<() => void>();
  private abort: AbortController | null = null;
  private prepared: Prepared | null = null;
  private failed: Input | null = null;
  private snapshot: string | null = null;
  private beforeJson: string | null = null;
  private beforeStory: Story | null = null;
  /** The story as the engine left it before the telling of the turn being told (see `keep`). */
  private told: string | null = null;
  /** Another take under way: the turn's earlier tellings and what they cost, and the story to go back to if it is given up. */
  private retaking: { takes: string[]; usage: UsageEntry[]; restore: string } | null = null;

  constructor(story: Story, deps: SessionDeps) {
    this.story = story;
    this.deps = deps;
  }

  // ---------- Reading the state ----------

  get scene(): Scene { return currentScene(this.story); }
  get combat(): Combat | null { const c = this.scene.combat; return c && !c.over ? c : null; }
  get busy(): boolean { return this.phase !== 'idle'; }
  get lastTurn(): Turn | null { const t = this.scene.turns; return t[t.length - 1] ?? null; }
  /** Passages of the latest turn not shown yet. While there are some, the input is replaced by Continue. */
  get unread(): number { const t = this.lastTurn; return t ? Math.max(0, t.groups.length - this.shown) : 0; }
  get simulated(): boolean { return this.deps.transport.simulated; }
  /**
   * The story as it stood when the latest turn began. The rules settle a turn, dice included, before
   * the player has thrown its dice; until they have, the screen goes on showing this: the meters, the
   * fight and the people as they were. Null before the first turn of a sitting and after going back.
   */
  get before(): Story | null {
    if (!this.beforeJson) return null;
    return (this.beforeStory ??= JSON.parse(this.beforeJson) as Story);
  }
  /**
   * The turn in flight, in the shape of a finished one: the action, what the rules decided, and the
   * first passage once it has arrived. The log draws it exactly as it will draw the finished turn, with
   * the same number, so nothing on screen is redrawn (and no die rolls twice) when the reply completes.
   * Null for a question to the narrator, which is not a turn, and once the turn is part of the story
   * (while its scene is written up), so that it is never drawn twice.
   */
  get arriving(): Pick<Turn, 'n' | 'beats' | 'groups'> | null {
    const l = this.live;
    if (!l || l.aside || l.kept) return null;
    const beats: Beat[] = l.beats ? [...l.beats] : [{ type: 'action', text: l.text, to: l.to }];
    if (l.first) beats.push(...this.storyBeats(l.first));
    return { n: this.story.totals.turns + 1, beats, groups: [0] };
  }
  /** The narrator's paragraphs as the log shows them: narration, and speech with the speaker looked up. */
  private storyBeats(parts: StoryPart[]): Beat[] {
    return parts.map((part): Beat => {
      if (part.type !== 'say') return { type: 'narration', text: part.text };
      const person = this.person(part.tag.toLowerCase());
      return { type: 'say', who: person?.id ?? '', name: person?.name ?? part.tag, manner: part.manner, text: part.text, ...(part.segs ? { segs: part.segs } : {}) };
    });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  private emit(): void { for (const fn of this.listeners) fn(); }
  private get rng(): Rng { return this.story.rng; }
  /**
   * The story's language. What the game writes for the player into the story (notes, notices, memories,
   * the player's action when a button or the map chose it) is written in it with `tl(this.lang, …)`.
   * What is sent to a model (`lines`, `told`, hints) stays English.
   */
  private get lang(): Lang { return this.story.settings.language === 'pt' ? 'pt' : 'en'; }
  /** A word of the rules (an ability, a stage of a bond, a path) in the story's language. */
  private rule(word: string): string { return tl(this.lang, word); }
  private person(id: string): Person | undefined { return this.story.world.people[id]; }
  private name(id: string): string { return id === YOU ? this.story.protagonist.name : (this.person(id)?.name ?? id); }

  // ---------- What the player can do ----------

  /** Free text: say or do anything. A line that starts with "//" or "((" is a question to the narrator instead. */
  submit(text: string, to: string | null = null): Promise<void> {
    const t = text.trim();
    if (!t) return Promise.resolve();
    const out = OUT_OF_STORY.exec(t);
    if (out) return out[1] ? this.ask(out[1]) : Promise.resolve();
    const asking = this.asking;
    // Asked whether to let days pass: yes goes ahead without asking the referee again, no gives the text back.
    if (asking?.wait && t === asking.options[0]) return this.run({ text: t, to: asking.to ?? to, clarifies: asking, special: { type: 'wait', minutes: asking.wait } });
    if (asking?.wait && t === asking.options[1]) { this.dropQuestion(); return Promise.resolve(); }
    return this.run(asking ? { text: t, to: asking.to ?? to, clarifies: asking } : { text: t, to });
  }

  /**
   * Ask the narrator something outside the story: what a passage meant, how a rule works, how to use
   * the app. Nobody in the story hears it, no time passes, and nothing is rolled.
   */
  ask(text: string): Promise<void> {
    const t = text.trim();
    if (!t) return Promise.resolve();
    return this.run({ text: t, to: null, aside: true });
  }

  /** Decide not to answer the game's question: the first text goes back to the input box, unsent. */
  dropQuestion(): void {
    if (!this.asking || this.busy) return;
    this.returned = this.asking.original;
    this.asking = null;
    this.emit();
  }

  /** A new story with an opening waiting: the first scene can be told before the player types anything. */
  get canBegin(): boolean {
    return !!this.story.opening && this.story.totals.turns === 0 && this.scene.turns.length === 0 && !this.story.over;
  }

  /** Open the story: the narrator sets the first scene from the world's opening, and stops where the first choice is the player's. */
  begin(): Promise<void> {
    if (!this.canBegin) return Promise.resolve();
    return this.run({ text: tl(this.lang, BEGIN_TEXT), to: null, special: { type: 'begin' } });
  }

  /**
   * Travel chosen on the map. It is the player saying "I leave for that place" and nothing more: what
   * is going on in the scene decides whether they can simply walk out, exactly as for typed text. They
   * may arrive, be stopped, have to get away first, or be told it cannot be done.
   */
  travel(to: string): Promise<void> {
    const place = this.story.world.places[to];
    // Only along a known route: asking to go where you already are, or somewhere out of reach, is not a turn.
    if (!place || !routeBetween(this.story, this.scene.placeId, to)) return Promise.resolve();
    // Shown as the player's action, and read by the referee and the narrator as what the player said: in the story's language.
    return this.run({ text: tl(this.lang, 'I head for {place}.', { place: place.name }), to: null, travelTo: to });
  }

  combatAct(action: CombatAction): Promise<void> {
    const c = this.combat;
    if (!c || c.awaiting !== 'action') return Promise.resolve();
    return this.run({ text: this.combatText(action, c), to: null, special: { type: 'combat', action } });
  }

  chooseDown(choice: DownChoice): Promise<void> {
    const c = this.combat;
    if (!c || c.awaiting !== 'down') return Promise.resolve();
    if (choice === 'destiny' && this.story.protagonist.destiny < 1) return Promise.resolve();
    return this.run({ text: choice === 'destiny' ? tl(this.lang, 'I am not done. I get back up.') : tl(this.lang, 'I let go and trust to luck.'), to: null, special: { type: 'down', choice } });
  }

  /** Show the next passage of the latest reply. */
  continueReading(): void {
    if (this.unread > 0) { this.shown += 1; this.emit(); }
  }
  showAll(): void { this.shown = Infinity; this.emit(); }

  stop(): void { this.abort?.abort(); }

  /** Try the failed turn again. Dice already rolled are kept: retrying never rolls again. */
  retry(): Promise<void> {
    if (this.blocker?.kind === 'elsewhere') return Promise.resolve(); // not for this window to lift
    const prepared = this.prepared;
    const failed = this.failed;
    this.blocker = null;
    if (prepared) return this.narrate(prepared);
    if (failed) { this.rollback(); return this.run(failed); }
    this.emit();
    return Promise.resolve();
  }

  /** Give up on the failed or declined turn: the story goes back to where it was and the text returns to the input box. */
  dismiss(): void {
    if (this.blocker?.kind === 'elsewhere') return;
    const input = this.prepared?.input ?? this.failed;
    const take = !!this.retaking;
    this.rollback();
    this.blocker = null;
    this.returned = input && typedByPlayer(input) && !take ? input.text : null;
    if (input?.clarifies) this.asking = input.clarifies;
    this.emit();
  }
  takeReturned(): string | null { const t = this.returned; this.returned = null; return t; }
  /** The story is being played in another window. Nothing can be sent or changed here until this window has it to itself. */
  holdElsewhere(): void {
    if (this.busy) this.stop();
    this.blocker = { kind: 'elsewhere' };
    this.emit();
  }
  clearNotice(): void { if (this.notice) { this.notice = null; this.emit(); } }
  recheckBudget(): void {
    if (this.blocker?.kind === 'budget' && this.deps.budget.spentToday() < this.deps.budget.cap()) { this.blocker = null; this.emit(); }
  }

  togglePin(who: string): void {
    const p = this.person(who);
    if (!p) return;
    p.pinned = !p.pinned;
    this.persist();
  }
  /** Keep a memory in view on a person's profile (at most three per person). */
  toggleKept(eventId: string): void {
    const e = this.story.events.find((x) => x.id === eventId);
    if (!e) return;
    const who = e.bond?.who;
    const kept = this.story.events.filter((x) => x.kept && x.bond?.who === who).length;
    if (!e.kept && kept >= 3) return;
    e.kept = !e.kept;
    this.persist();
  }
  useItem(itemId: string): void {
    const p = this.story.protagonist;
    const item = p.items.find((i) => i.id === itemId);
    if (!item || !item.heal || item.qty < 1 || this.combat) return;
    this.between(() => {
      p.sheet.hp = Math.min(maxHp(p.sheet), p.sheet.hp + item.heal!);
      item.qty -= 1;
      if (item.qty === 0) p.items = p.items.filter((i) => i !== item);
    });
  }

  /**
   * Something the player does between turns that changes the story (experience spent, an ability
   * learned, an item used). It is not a turn, so no turn's record would cover it, and a rewind would
   * leave it standing: experience given back with the raise kept. So what it changed is written down
   * backwards here, in `story.pendingUndo`. The next turn's record puts that list back when the turn
   * is undone, and rewinding then takes these changes back too, newest first.
   */
  private between<T>(change: () => T): T {
    const before = JSON.parse(JSON.stringify(this.story)) as Story;
    const result = change();
    const undo = undoOf(before, this.story);
    if (undo) (this.story.pendingUndo ??= []).push(undo);
    this.persist();
    return result;
  }

  /**
   * Learn an ability that was found (shown by someone, or worked out by trying): a point of
   * experience and a Skill test, easy when someone showed how, medium otherwise. On a failure the
   * experience is spent and the ability stays found. Returns the roll, or null when it cannot be tried.
   */
  learn(id: string): ReturnType<typeof runTest> | null {
    const story = this.story;
    const p = story.protagonist;
    const found = p.found ?? [];
    const ability = ABILITIES[id];
    const entry = found.find((f) => f.id === id);
    if (this.busy || this.combat || story.over || !ability || !entry || canLearn(p.sheet, found, id, p.xp, XP_TO_LEARN)) return null;
    return this.between(() => {
      p.xp -= XP_TO_LEARN;
      // A plain roll: no table style softens it, because nothing in the story hangs on it.
      const label = tl(this.lang, 'learn {ability}', { ability: this.rule(ability.name) });
      const result = runTest(p.sheet, { attribute: 'skill', skill: null, difficulty: learnDifficulty(entry), label }, 'brutal', this.rng);
      story.rolls.push({ n: story.totals.turns, clock: { ...story.clock }, placeId: this.scene.placeId, result, label, who: '', byYou: true });
      if (result.passed) {
        p.sheet.abilities.push(id);
        p.found = found.filter((f) => f.id !== id);
      }
      return result;
    });
  }
  /** Spend 10 experience to raise an attribute by one (to 5 at most). Returns false when it cannot be done. */
  raiseAttribute(attribute: Attribute): boolean {
    const p = this.story.protagonist;
    if (this.busy || this.combat || canRaiseAttribute(p.sheet, attribute, p.xp)) return false;
    this.between(() => {
      p.sheet = raiseAttribute(p.sheet, attribute);
      p.xp -= XP_PER_LEVEL;
    });
    return true;
  }
  /** Spend 10 experience to raise a path by one, up to the story's cap. */
  raisePath(path: Path): boolean {
    const p = this.story.protagonist;
    if (this.busy || this.combat || canRaisePath(p.sheet, path, p.xp, this.story.world.rules.pathCap)) return false;
    this.between(() => {
      p.sheet = raisePath(p.sheet, path);
      p.xp -= XP_PER_LEVEL;
    });
    return true;
  }
  // ---------- A power of one's own, between turns (a world of gifts) ----------

  /** Whether a change to the protagonist's own power can be made now: only in a world of gifts, and never in the middle of a turn or a fight. */
  private get giftOpen(): boolean {
    return this.story.world.rules.powers === 'gift' && !this.busy && !this.combat && !this.story.over;
  }

  /**
   * The scene's packet was written before a power changed: the narrator is told at the next turn, once.
   * One line for each power that changed, the newest for each; a power that is gone is said to be gone.
   */
  private tellPower(lead: string, id: string = OWN_POWER, gone = false): void {
    const tag = `power:${id}:`;
    const line = gone ? null : powerLine(this.story, id);
    const said = gone ? `${tag} ${lead} Leave its POWER line of the packet out from now on.` : line ? `${tag} ${lead} ${line} Take this for its POWER line of the packet from now on.` : null;
    if (said) this.story.tellNext = [...(this.story.tellNext ?? []).filter((l) => !l.startsWith(tag)), said];
  }

  /** Spend 10 experience to raise the rank of one of the protagonist's powers by one (to 4 at most): the one by nature, or a discipline. */
  raiseGift(id: string = OWN_POWER): boolean {
    const p = this.story.protagonist;
    if (!this.giftOpen || canRaiseGift(p.sheet, p.xp, id)) return false;
    const name = powerById(p.sheet, id)?.gift.name ?? '';
    this.between(() => {
      p.sheet = raiseGift(p.sheet, id);
      p.xp -= XP_PER_LEVEL;
      this.tellPower(id === OWN_POWER ? `${p.name}'s own power has grown since the scene began.` : `${p.name}'s ${name} has grown since the scene began.`, id);
    });
    return true;
  }

  /**
   * Keep a new use of a power that worked as a move, for a point of experience. `index` is its place
   * among those waiting; it is kept on the power it was a use of. The name and the line are the
   * player's; the tier is the one it was rated at, or lower; what it does in a fight follows from how
   * it was rated. Returns false when it cannot be kept.
   */
  keepWorked(index: number, name: string, text: string, tier: number): boolean {
    const p = this.story.protagonist;
    const worked = p.worked?.[index];
    const held = worked ? powerById(p.sheet, worked.power ?? OWN_POWER) : undefined;
    if (!this.giftOpen || !worked || !held || canKeep(p.sheet, worked, name, tier, p.xp, XP_TO_LEARN)) return false;
    this.between(() => {
      p.sheet = withPower(p.sheet, held.id, keepMove(held.gift, worked, name, text, tier));
      p.xp -= XP_TO_LEARN;
      p.worked = (p.worked ?? []).filter((_, i) => i !== index);
    });
    return true;
  }

  /** Let a worked-out use go without keeping it. */
  dropWorked(index: number): boolean {
    const p = this.story.protagonist;
    if (!this.giftOpen || !p.worked?.[index]) return false;
    this.between(() => { p.worked = (p.worked ?? []).filter((_, i) => i !== index); });
    return true;
  }

  /** Forget a move (by its id on the sheet), to make room for another. Nothing is given back. */
  forgetMove(id: string): boolean {
    const p = this.story.protagonist;
    const { power, move } = splitMoveKey(id);
    const held = powerById(p.sheet, power);
    if (!this.giftOpen || !held || held.art?.source === 'borrowed' || !held.gift.moves.some((mv) => mv.id === move)) return false;
    this.between(() => { p.sheet = withPower(p.sheet, held.id, forgetMove(held.gift, move)); });
    return true;
  }

  /**
   * Someone with no power of their own awakens one: ten experience, and the player writes what it is.
   * It starts at rank 1 with no moves; those are worked out in play. No model is asked: the words are
   * the player's, and the rules hold them to length. Returns false when it cannot be done.
   */
  awaken(written: { name: string; text: string; limit: string; kinds: GiftKind[] }): boolean {
    const p = this.story.protagonist;
    if (!this.giftOpen || p.sheet.gift || hasNatureHeld(this.story) || p.xp < XP_TO_AWAKEN) return false;
    const gift = cleanGift({ ...written, rank: 1, moves: [] }, GIFT_IN_PLAY);
    if (!gift || !gift.name || !gift.text) return false;
    this.between(() => {
      p.sheet.gift = gift;
      p.xp -= XP_TO_AWAKEN;
      this.tellPower(`${p.name} has awakened a power of their own since the scene began.`, OWN_POWER);
    });
    return true;
  }

  /**
   * Learn a discipline someone showed: ten experience, and it is held at rank 1 with its first move.
   * No test: the teaching was the hard part. Returns false when it cannot be done.
   */
  learnDiscipline(id: string): boolean {
    const story = this.story;
    const p = story.protagonist;
    const d = (story.world.disciplines ?? []).find((x) => x.id === id);
    if (!this.giftOpen || !d || canLearnDiscipline(story, id)) return false;
    this.between(() => {
      p.sheet.arts = [...(p.sheet.arts ?? []), disciplineArt(d)];
      p.xp -= XP_TO_LEARN_DISCIPLINE;
      p.found = (p.found ?? []).filter((f) => f.id !== id);
      this.tellPower(`${p.name} has learned ${d.name} since the scene began.`, d.id);
    });
    return true;
  }

  /**
   * A discipline that is not taught awakens: ten experience, only in the scene in which the
   * protagonist was brought down in a fight or in the next. Returns false when it cannot be done.
   */
  awakenDiscipline(id: string): boolean {
    const story = this.story;
    const p = story.protagonist;
    const d = (story.world.disciplines ?? []).find((x) => x.id === id);
    if (!this.giftOpen || !d || canAwakenDiscipline(story, id)) return false;
    this.between(() => {
      p.sheet.arts = [...(p.sheet.arts ?? []), disciplineArt(d)];
      p.xp -= XP_TO_LEARN_DISCIPLINE;
      this.tellPower(`${d.name} has awakened in ${p.name} since the scene began, after they were brought down.`, d.id);
    });
    return true;
  }

  /**
   * Eat an item of power, between turns: its power becomes the protagonist's own, for good, at rank 1.
   * Refused when they already have a power of their own (one each). Returns false when it cannot be done.
   */
  eatRelic(itemId: string): boolean {
    const story = this.story;
    const p = story.protagonist;
    const item = p.items.find((i) => i.id === itemId);
    if (!this.giftOpen || !item || canEat(story, itemId)) return false;
    this.between(() => {
      eatRelic(story, itemId);
      this.tellPower(`${p.name} has eaten ${item.name} since the scene began, and its power is their own now.`, OWN_POWER);
    });
    return true;
  }

  /** Set the power of a carried item of power aside (to make room for another), or take it up again. */
  setRelicAside(itemId: string, aside: boolean): boolean {
    const story = this.story;
    const p = story.protagonist;
    const item = p.items.find((i) => i.id === itemId);
    const relic = relicOf(story, item);
    if (!this.giftOpen || !item || !relic) return false;
    return this.between(() => {
      if (!setRelicAside(story, itemId, aside)) return false;
      this.tellPower(aside ? `${p.name} has put ${item.name} away since the scene began, and does not use its power.` : `${p.name} has taken up ${item.name} again since the scene began.`, relic.id, aside);
      return true;
    });
  }

  /** Change a setting of this story. Settings that are part of the narrator's instructions apply from the next turn. */
  updateSettings(patch: Partial<StorySettings>): void {
    Object.assign(this.story.settings, patch);
    // A story that no longer builds to an ending has no final chapter.
    if (patch.ending === 'endless') this.story.chapter.final = false;
    this.persist();
  }
  private persist(): void { this.deps.save(this.story); this.emit(); }

  // ---------- The turn ----------

  private async run(input: Input): Promise<void> {
    if (this.busy || this.blocker || this.story.over) return;
    this.notice = null;
    const { budget } = this.deps;
    if (budget.spentToday() >= budget.cap()) {
      this.failed = input;
      this.blocker = { kind: 'budget', spent: budget.spentToday(), cap: budget.cap() };
      this.emit();
      return;
    }
    this.snapshot = JSON.stringify(this.story);
    if (!input.aside) { this.beforeJson = this.snapshot; this.beforeStory = null; }
    this.failed = input;
    this.prepared = null;
    if (!input.aside) { this.shown = Infinity; this.asking = null; }
    this.live = { text: input.clarifies?.original ?? input.text, to: input.to, aside: input.aside, ...(input.special?.type === 'begin' ? { beats: [] } : {}) };
    this.phase = input.aside ? 'writing' : 'thinking';
    this.abort = new AbortController();
    this.emit();
    try {
      if (input.aside) { await this.answerAside(input, []); return; }
      const prepared = await this.prepare(input);
      if (!prepared) { this.settle(); return; } // the engine answered by itself, or asked what was meant
      if ('aside' in prepared) { await this.answerAside(input, prepared.usage); return; } // the referee read it as a question to the narrator
      this.prepared = prepared;
      await this.narrate(prepared);
    } catch (err) {
      this.fail(err);
    }
  }

  private settle(): void {
    this.phase = 'idle';
    this.live = null;
    this.abort = null;
    this.prepared = null;
    this.failed = null;
    this.snapshot = null;
    this.told = null;
    this.retaking = null;
    this.deps.save(this.story);
    this.emit();
  }

  private rollback(): void {
    // Everything goes back, the dice included: taking an action back and sending it again meets the
    // same roll. A roll the player did not like cannot be had again by starting over.
    // Another take given up leaves the turn as it was, with the telling it had.
    if (this.retaking) this.story = JSON.parse(this.retaking.restore) as Story;
    else if (this.snapshot) this.story = JSON.parse(this.snapshot) as Story;
    this.retaking = null;
    this.told = null;
    this.snapshot = null;
    this.prepared = null;
    this.failed = null;
    this.live = null;
    this.phase = 'idle';
    this.abort = null;
  }

  private fail(err: unknown): void {
    const e = err instanceof LlmError ? err : new LlmError('other', err instanceof Error ? err.message : String(err));
    this.phase = 'idle';
    this.abort = null;
    if (e.kind === 'aborted') {
      const input = this.failed;
      const take = !!this.retaking;
      this.rollback();
      this.returned = input && typedByPlayer(input) && !take ? input.text : null;
      if (input?.clarifies) this.asking = input.clarifies; // the question still stands
      this.emit();
      return;
    }
    const kind = e.kind === 'auth' ? 'key' : e.kind === 'bad_request' || e.kind === 'other' ? 'error' : e.kind;
    this.blocker = { kind, message: e.message, status: e.status, retryAfter: e.retryAfter };
    if (this.live) this.live.first = undefined;
    this.emit();
  }

  private async call(role: Role, send: () => Promise<LlmResponse>, into: UsageEntry[]): Promise<LlmResponse> {
    const res = await send();
    const entry: UsageEntry = {
      at: this.deps.now(), role, model: res.model, ...res.usage, cost: costOf(res.model, res.usage), simulated: res.simulated,
    };
    into.push(entry);
    this.deps.budget.record(entry, this.story.id);
    this.story.totals.cost += entry.cost;
    const { budget } = this.deps;
    if (budget.spentToday() >= budget.cap() * 0.8) this.budgetWarning = true;
    return res;
  }

  private hints(input: Input, scene: Scene): MockHints {
    const cast = castOf(this.story, scene.placeId).map((id) => this.person(id)).filter((p): p is Person => !!p);
    return {
      you: this.story.protagonist.name,
      input: input.text,
      place: this.story.world.places[scene.placeId]?.name ?? '',
      opening: scene.turns.length === 0,
      outcome: null,
      checkLabel: null,
      cast: cast.map((p) => ({ id: p.id, name: p.name, inParty: p.inParty, count: p.count, hostile: /hostile/i.test(p.attitude) })),
      exits: exitsFrom(this.story, scene.placeId).map((e) => ({ id: e.place.id, name: e.place.name })),
      abilities: commandOf(this.story.protagonist.sheet, this.story.world.rules.powers).map((a) => ({ id: a.id, name: a.name })),
      attemptable: withinReach(this.story).map((a) => ({ id: a.id, name: a.name })),
      teachable: [
        ...teachableHere(this.story, scene.placeId).map((t) => ({ id: t.ability.id, name: t.ability.name, by: t.teacher.id })),
        ...disciplinesTaughtHere(this.story, scene.placeId).map((t) => ({ id: t.discipline.id, name: t.discipline.name, by: t.teacher.id })),
      ],
      ...(this.story.world.rules.powers === 'gift' ? {
        gift: hasPower(this.story.protagonist.sheet) ? { powers: powersOf(this.story.protagonist.sheet).map((x) => ({ id: x.id, name: x.gift.name, kinds: [...x.gift.kinds] })) } : null,
        eatable: this.story.protagonist.items.filter((i) => i.kind === 'relic' && relicOf(this.story, i)?.use === 'eaten').map((i) => ({ id: i.id, name: i.name })),
        relics: relicsHere(this.story, scene).map((r) => ({ id: r.id, name: r.name })),
      } : {}),
      threads: this.story.threads.filter((t) => t.status === 'open').map((t) => ({ id: t.id, title: t.title })),
      contest: this.story.contest?.label ?? null,
      carrying: this.story.protagonist.items.map((i) => ({ id: i.id, name: i.name })),
      money: hasMoney(this.story.world) ? moneyOf(this.story).map((c) => ({ id: c.id, name: c.name })) : [],
      fight: null, fightOver: null, moment: null, movedTo: null, held: null, aside: !!input.aside, clarified: !!input.clarifies,
      turn: this.story.totals.turns,
    };
  }

  /** Referee and engine. Returns null when no narration is needed, and { aside } when the text turned out to be a question to the narrator. */
  private async prepare(input: Input): Promise<Prepared | { aside: true; usage: UsageEntry[] } | null> {
    const story = this.story;
    const startedIn = this.scene;
    let scene = startedIn;
    const usage: UsageEntry[] = [];
    const asked = input.clarifies ?? null;
    // When the game asked what was meant, the log shows the first text with the answer under it.
    const sp = input.special;
    // The turn that opens a story has no action of the player's in it.
    const beats: Beat[] = sp?.type === 'begin' ? [] : [asked ? { type: 'action', text: asked.original, to: input.to, clarified: input.text } : { type: 'action', text: input.text, to: input.to }];
    const lines: string[] = [];
    const after: (() => void)[] = [];
    const toName = input.to ? this.person(input.to)?.name : null;
    const hints = this.hints(input, scene);

    this.waitNow = 0;
    if (sp?.type === 'wait') {
      const block = this.waitBlock();
      if (block) { this.notice = block; return null; }
      this.waitFor(sp.minutes, scene, lines, hints);
    } else if (sp?.type === 'begin') {
      lines.push(openingLine(story));
      hints.begin = true;
    } else if (sp) {
      // An action the rules refuse is not a turn: the player is told why and nothing is narrated.
      if (!this.fightRound(sp, scene, beats, lines, hints)) return null;
    } else {
      // Free text, or a place chosen on the map. In a fight it is read as the nearest fight action;
      // otherwise the referee classifies it.
      this.phase = 'thinking';
      const res = await this.call('referee', () => this.deps.transport.send(refereeRequest(story, scene, input.text, input.to, this.deps.models(), hints, asked, input.travelTo ?? null), { signal: this.abort?.signal }), usage);
      let r = (res.parsed ?? null) as RefereeOut | null;
      // A place chosen on the map is never a question and never unclear: the referee's part is to say
      // whether the way is free. (With no answer from the referee, the narrator is left to judge it.)
      if (r && input.travelTo && r.kind !== 'impossible') r = { ...r, kind: 'move', move_to: input.travelTo };
      if (r) {
        if (r.kind === 'question' && !asked) return { aside: true, usage };
        if (this.combat) {
          // What the character cannot do at all is said so, and the round is not spent on it.
          if (r.kind === 'impossible') { this.notice = r.why_impossible || tl(this.lang, 'That is not something you can do here.'); return null; }
          const action = this.fightActionFrom(r, input.text, scene, beats);
          if (!action || !this.fightRound({ type: 'combat', action }, scene, beats, lines, hints)) return null;
        } else {
          const done = await this.applyReferee(r, input, scene, beats, lines, hints, usage);
          if (done === 'answered') return null;
          if (done) scene = done;
        }
      }
    }

    const opening = scene.turns.length === 0;
    // What changed between turns that the scene's packet does not say: told now, once. A scene that
    // opens with this turn has a packet written after the change, and needs no telling.
    // A power's line carries the power's id so that a newer one replaces it; the narrator is not shown the id.
    if (story.tellNext?.length) { if (!opening) lines.unshift(...story.tellNext.map((l) => l.replace(/^power:[a-z0-9_]+: /, 'power: '))); delete story.tellNext; }
    if (opening && !lines.some((l) => l.startsWith('travel:'))) lines.unshift('new scene: set the place and who is there in two or three sentences before anything else.');
    hints.opening = opening;
    const s = story.protagonist.sheet;
    lines.push(`now: ${clockLabel(story.clock).replace(' · ', ', ')}. ${story.protagonist.name}: hit points ${s.hp}/${maxHp(s)}, energy ${s.energy}/${maxEnergy(s)}.`);
    // What the narrator is shown as the player's line. Fixed once sent: it is replayed on every later turn of the scene.
    let userText = sp?.type === 'begin' ? '(The story begins.)' : toName ? `(to ${toName}) ${input.text}` : input.text;
    if (asked) {
      userText = `${toName ? `(to ${toName}) ` : ''}${asked.original} [The game asked: "${asked.question}" The player answered: ${input.text}]`;
      lines.unshift('clarified: the game asked the player what they meant, and the answer in brackets settles it. Where the answer and the first text differ, follow the answer.');
    }
    return { input, userText, beats, lines, opening, hints, usage, moved: scene !== startedIn, after, ...(this.waitNow ? { wait: this.waitNow } : {}) };
  }

  /** Why time cannot be let pass now, by the rules alone, or null. In the story's language. */
  private waitBlock(): string | null {
    const l = this.lang;
    if (this.combat) return tl(l, 'Not in the middle of a fight.');
    if (this.story.contest) return tl(l, 'Not while {label} is under way: see it through, or give it up first.', { label: this.story.contest.label });
    return null;
  }

  /**
   * Let time pass, once the player has said yes: the narrator tells the stretch and says how long it
   * really took, ending it early when something the story set up comes first. What is hidden from the
   * protagonist moves by rule as the days pass (see `applyFlags`).
   */
  private waitFor(minutes: number, scene: Scene, lines: string[], hints: MockHints): void {
    const story = this.story;
    const place = story.world.places[scene.placeId];
    const most = Math.max(WAIT.long, Math.min(WAIT.max, Math.round(minutes)));
    this.waitNow = most;
    hints.wait = most;
    lines.push(`wait: the player chose to let time pass at ${place?.name ?? 'this place'}, as their action says: up to ${durationLabel(most)} from ${clockLabel(story.clock).replace(' · ', ', ')}. Tell the stretch in a few sentences, as one passage. If anything the story has set up comes sooner (an arrival, a deadline, an attack or a visit that was announced, a promise falling due), the wait ends when it comes: tell it arriving and stop there. Otherwise end on the day the wait is over, where the next choice is the player's. Give the time that really passed in "time:".`);
  }

  // ---------- Powers ----------

  /** A power as the player reads its name: a move's is their own words; an ability's is the rules', in the story's language. */
  private powerName(pw: Pick<Power, 'name' | 'own'>): string {
    return pw.own ? pw.name : this.rule(pw.name);
  }

  /** Something the protagonist can use, by id: a library ability, or in a world of gifts one of their moves. */
  private heroPower(id: string): Power | undefined {
    const mode = this.story.world.rules.powers;
    // In a world of gifts there is no library: an id that is not a move (a power's own id, say) is nothing.
    return powerOf(this.story.protagonist.sheet, id, mode) ?? (mode === 'gift' ? undefined : ABILITIES[id]);
  }

  /** What the player is told when a power cannot be used. `name` is already in the story's language. */
  private cannotUse(reason: string, name: string): string {
    const mode = this.story.world.rules.powers;
    return reason === 'energy' ? tl(this.lang, 'You do not have the energy for {name}.', { name })
      : reason === 'focus' ? tl(this.lang, '{name} needs more Focus than you have.', { name })
        : reason === 'skill' ? tl(this.lang, '{name} is beyond you for now: it would cost more than five times your Skill.', { name })
          : reason === 'rank' ? tl(this.lang, 'That is more than your power can do yet.')
            : reason === 'no_gift' ? tl(this.lang, 'You have no power of your own.')
              : reason === 'no_powers' ? tl(this.lang, 'There are no such powers in this world.')
                : mode === 'extreme' ? tl(this.lang, '{name} belongs to a school you do not have.', { name })
                  : mode === 'gift' ? tl(this.lang, 'That is not one of your moves.')
                    : tl(this.lang, 'You do not know {name}.', { name });
  }

  /** The same for an effect of the player's own invention. `path` is null in a world of gifts. */
  private cannotImprovise(reason: string, path: Path | null): string {
    if (!path) return this.cannotUse(reason, tl(this.lang, 'a new use of your power'));
    const pathWord = this.rule(path);
    return reason === 'focus' ? tl(this.lang, 'That is more than your {path} can do yet.', { path: pathWord })
      : reason === 'not_learned' ? tl(this.lang, 'You have no command of {path}.', { path: pathWord })
        : this.cannotUse(reason, tl(this.lang, 'An effect of {path}', { path: pathWord }));
  }

  /**
   * How the referee rated an effect of the player's own: its path (none in a world of gifts), its
   * reach, and the kind of thing it would do in a fight. In a world of gifts, also the power it is a
   * use of: the one the referee named (its id, given in `ability`), else the first that has that kind
   * of effect, else the first. A kind that power does not have counts as none, and so does a missing one.
   */
  private readImprovise(im: NonNullable<RefereeOut['improvise']>, named?: string | null): { path: Path | null; tier: number; kind: EffectKind | undefined; power: HeldPower | null; taking: TakingKind | undefined } {
    const mode = this.story.world.rules.powers;
    const tier = Math.max(1, Math.min(4, Math.round(im.tier) || 1));
    const raw = (im as { effect?: unknown }).effect;
    let kind = isEffectKind(raw) ? raw : undefined;
    // In a world of gifts a use may copy someone's power or take it: only a power that has that kind can.
    let taking = mode === 'gift' && isTakingKind(raw) ? raw : undefined;
    let power: HeldPower | null = null;
    if (mode === 'gift') {
      const all = powersOf(this.story.protagonist.sheet);
      const wanted = kind ?? taking;
      power = (named ? all.find((x) => x.id === named) : undefined) ?? (wanted ? all.find((x) => x.gift.kinds.includes(wanted)) : undefined) ?? all[0] ?? null;
      if (kind && !power?.gift.kinds.includes(kind)) kind = undefined;
      if (taking && !power?.gift.kinds.includes(taking)) taking = undefined;
    }
    return { path: mode !== 'gift' && im.path && PATHS.includes(im.path) ? im.path : null, tier, kind, power, taking };
  }

  /** What the player is told when a copy or a theft has nobody to be aimed at, or no room. */
  private cannotTake(reason: CannotTakePower, taking: TakingKind): string {
    return reason === 'room' ? tl(this.lang, 'You hold four powers already: there is no room to take on another.')
      : taking === 'copy' ? tl(this.lang, 'There is nobody here with a power to copy.') : tl(this.lang, 'There is nobody here with a power to take.');
  }

  /**
   * Whom a damaging power turned on someone starts a fight with: the one it was turned on, when they
   * are here and can fight, and with them everyone hostile in the place. Null when nobody it was
   * turned on can fight: then it is a thing done in the story, and no fight.
   */
  private foesFor(scene: Scene, targets: string[]): { struck: Person; foes: Person[] } | null {
    const here = scene.cast.map((id) => this.person(id)).filter((x): x is Person => !!x && !x.inParty && !!x.fight?.fights);
    const named = new Set(targets);
    const struck = here.find((x) => named.has(x.id));
    return struck ? { struck, foes: here.filter((x) => named.has(x.id) || /hostile/i.test(x.attitude)) } : null;
  }

  /**
   * Start a fight and take the protagonist's first action in it. Returns true when the action was
   * taken. False when no fight began, when the protagonist was brought down before they could act, or
   * when the action was refused (`notice` then says why).
   */
  private strikeFirst(scene: Scene, foes: Person[], action: () => CombatAction | null, beats: Beat[], lines: string[], hints: MockHints): boolean {
    this.startFight(scene, foes.map((f) => f.id));
    const c = scene.combat;
    if (!c || c.awaiting !== 'action') return false;
    const first = action();
    return !!first && this.fightRound({ type: 'combat', action: first }, scene, beats, lines, hints);
  }

  /** Hit points a healing power gives back to the protagonist outside a fight: no more than were missing. */
  private mend(value: number): number {
    const s = this.story.protagonist.sheet;
    const before = s.hp;
    s.hp = Math.min(maxHp(s), s.hp + Math.max(0, value));
    return s.hp - before;
  }

  /**
   * A new use of the protagonist's gift that worked: remembered, so that it can be kept as a move. At
   * most three wait at a time, and the oldest gives way. False when these very words are waiting already.
   */
  private noteWorked(text: string, tier: number, fight: EffectKind | undefined, power: HeldPower): boolean {
    const p = this.story.protagonist;
    // Nothing is kept from a power that is only borrowed.
    if (power.art?.source === 'borrowed') return false;
    const line = clip(text, GIFT_TEXT.moveText);
    const list = (p.worked ??= []);
    if (!line || list.some((w) => w.text === line)) return false;
    list.push({ text: line, tier, ...(fight ? { fight } : {}), ...(power.id !== OWN_POWER ? { power: power.id } : {}) });
    while (list.length > GIFT_WORKED_MAX) list.shift();
    return true;
  }

  /**
   * An effect of the player's own invention, typed in the middle of a fight (or opening one): the
   * energy and the Skill test of the world's mode, then what its reach does in a fight if the test
   * passed. Returns the action to take; 'plain' when it would do nothing in a fight and the text is
   * to be read as an ordinary action; null when it is refused, with `notice` saying why and no die rolled.
   *
   * The test is a plain roll: no table style softens it, because the fight applies an effect or does
   * not, and a failure told as "a success at a cost" would be told wrong.
   */
  private inventedAction(r: RefereeOut, text: string, c: Combat, target: Combatant | undefined, scene: Scene, beats: Beat[]): CombatAction | 'plain' | null {
    const story = this.story;
    const p = story.protagonist;
    const mode = story.world.rules.powers;
    if (!r.improvise || mode === 'off') return 'plain';
    const { path, tier, kind, power, taking } = this.readImprovise(r.improvise, r.ability);
    if (taking && power) return this.takeInFight(taking, tier, power, c, target, scene, beats);
    if (mode !== 'gift' && !path) return 'plain';
    const effect = kind ? fightEffect(kind, tier) : undefined;
    if (!effect) return 'plain';
    const hero = c.fighters[YOU];
    // Sealed by someone's power: refused before any die is rolled, and it is not a turn.
    if ((hero?.sealed ?? 0) > 0) { this.notice = tl(this.lang, 'Your powers are sealed: no power can be used on this turn.'); return null; }
    // In a fight the fighter holds the energy: the sheet's is brought up to date when the round is over.
    const can = canImprovise({ ...p.sheet, energy: hero?.energy ?? p.sheet.energy }, path, tier, mode, power?.id);
    if (!can.ok) { this.notice = this.cannotImprovise(can.reason, path); return null; }
    if (effect.needsTarget && (!target || !isUp(target))) { this.notice = tl(this.lang, 'There is nobody to turn that on.'); return null; }
    if (effect.type === 'stagger' && target && !canStagger(target)) { this.notice = tl(this.lang, '{name} cannot be made to lose another action so soon.', { name: target.name }); return null; }

    const gift = mode === 'gift' ? power?.gift : undefined;
    const pathWord = path ? this.rule(path) : '';
    const label = gift ? tl(this.lang, 'a new use of {power}', { power: gift.name }) : tl(this.lang, 'shape {path}', { path: pathWord });
    const result = runTest(p.sheet, { attribute: 'skill', skill: null, difficulty: can.difficulty, label }, 'brutal', this.rng);
    beats.push({ type: 'check', result, opposedBy: null });
    story.rolls.push({ n: story.totals.turns + 1, clock: { ...story.clock }, placeId: scene.placeId, result, label, who: '', byYou: true });
    const notes: Note[] = [{ kind: 'info', text: gift
      ? tl(this.lang, 'A new use of your power (reach {tier}) · {cost} energy', { tier, cost: can.cost })
      : tl(this.lang, 'An effect of your own ({path}, reach {tier}) · {cost} energy', { path: pathWord, tier, cost: can.cost }) }];
    if (power && result.passed && this.noteWorked(text, tier, kind, power)) {
      notes.push({ kind: 'info', text: tl(this.lang, 'You have worked out a new use of your power. Keep it as a move for {xp} experience on the Character screen.', { xp: XP_TO_LEARN }) });
    }
    beats.push({ type: 'notes', notes });
    return {
      type: 'effect', name: gift ? `a new use of their own power (${gift.name})` : `an effect of ${path} of their own making`,
      cost: can.cost, effect, ...(effect.needsTarget && target ? { target: target.id } : {}), worked: result.passed,
    };
  }

  /**
   * Copying someone's power, or taking it from them, in the middle of a fight: the energy, a plain Skill
   * roll, and when it passes the borrowed power is held at once (its move is at hand from the next turn)
   * and a taken one is gone from its owner for the rest of the fight. The turn is spent either way.
   */
  private takeInFight(taking: TakingKind, tier: number, power: HeldPower, c: Combat, target: Combatant | undefined, scene: Scene, beats: Beat[]): CombatAction | null {
    const story = this.story;
    const p = story.protagonist;
    const hero = c.fighters[YOU];
    if ((hero?.sealed ?? 0) > 0) { this.notice = tl(this.lang, 'Your powers are sealed: no power can be used on this turn.'); return null; }
    const who = canTakePower(story, scene, target ? [target.id] : []);
    if (!who.ok) { this.notice = this.cannotTake(who.reason, taking); return null; }
    const can = canImprovise({ ...p.sheet, energy: hero?.energy ?? p.sheet.energy }, null, tier, 'gift', power.id);
    if (!can.ok) { this.notice = this.cannotImprovise(can.reason, null); return null; }
    const person = who.person;
    const theirs = person.power!.name;
    const label = (taking === 'copy' ? tl(this.lang, 'copy {power}', { power: theirs }) : tl(this.lang, 'take {power}', { power: theirs }));
    const result = runTest(p.sheet, { attribute: 'skill', skill: null, difficulty: can.difficulty, label }, 'brutal', this.rng);
    beats.push({ type: 'check', result, opposedBy: null });
    story.rolls.push({ n: story.totals.turns + 1, clock: { ...story.clock }, placeId: scene.placeId, result, label, who: '', byYou: true });
    const notes: Note[] = [{ kind: 'info', text: tl(this.lang, '{power} of {name}, reach {tier} · {cost} energy', { power: theirs, name: person.name, tier, cost: can.cost }) }];
    let note = '';
    if (result.passed) {
      const art = borrowPower(story, scene.id, person, tier, taking === 'steal');
      if (hero) {
        // The borrowed move replaces any borrowed before it.
        const move = movePower(art.power.moves[0]!, BORROWED);
        const kept = (hero.abilities ?? []).filter((id) => !id.startsWith(`${BORROWED}:`));
        hero.abilities = [...kept, move.id];
        hero.own = { ...Object.fromEntries(Object.entries(hero.own ?? {}).filter(([id]) => !id.startsWith(`${BORROWED}:`))), [move.id]: move };
        hero.costs = { ...(hero.costs ?? {}), [move.id]: move.cost };
      }
      const theirFighter = c.fighters[person.id];
      if (taking === 'steal' && theirFighter) delete theirFighter.power;
      note = `${p.name} ${taking === 'copy' ? 'copies' : 'takes'} the power of ${person.name}, ${art.power.name}, and holds it until the scene ends`;
      notes.push({ kind: 'info', text: taking === 'copy'
        ? tl(this.lang, 'You copied {power} from {name}, until the scene ends.', { power: art.power.name, name: person.name })
        : tl(this.lang, 'You took {power} from {name}, until the scene ends.', { power: art.power.name, name: person.name }) });
    }
    beats.push({ type: 'notes', notes });
    return {
      type: 'effect', name: `${taking === 'copy' ? 'copying' : 'taking'} a power with their own (${power.gift.name})`, cost: can.cost,
      ...(c.fighters[person.id] ? { target: person.id } : {}), worked: result.passed, ...(note ? { note } : {}),
    };
  }

  /** Apply the referee's reading of a free-text action. Returns the scene to narrate in, or 'answered' when no narration is needed. */
  private async applyReferee(r: RefereeOut, input: Input, scene: Scene, beats: Beat[], lines: string[], hints: MockHints, usage: UsageEntry[]): Promise<Scene | 'answered' | null> {
    const story = this.story;
    const p = story.protagonist;
    if (r.kind === 'impossible') {
      this.notice = r.why_impossible || tl(this.lang, 'That is not something you can do here.');
      return 'answered';
    }
    // The referee could not tell what was meant: ask, once, before anything happens. An answer is never questioned again.
    if (r.kind === 'unclear' && r.ask?.trim() && !input.clarifies) {
      this.asking = {
        original: input.text, to: input.to, question: clip(r.ask.trim(), 220),
        options: (r.ask_options ?? []).map((o) => clip(o.trim(), 48)).filter(Boolean).slice(0, 3),
      };
      return 'answered';
    }
    // A wait of more than half a day is the player's to confirm first, and the game asks for nothing. An
    // answer is never questioned again: then the time passes as the narrator tells it.
    if (r.kind === 'rest' && Math.round(r.minutes) > WAIT.long) {
      const block = this.waitBlock();
      if (block) { this.notice = block; return 'answered'; }
      const minutes = Math.min(WAIT.max, Math.round(r.minutes));
      if (!input.clarifies) {
        const l = this.lang;
        this.asking = {
          original: input.text, to: input.to,
          question: tl(l, 'That could mean {time} here. Let the time pass? Whatever the story has set to happen meanwhile still happens, and the wait ends early if it comes sooner.', { time: durationLabel(minutes, l) }),
          options: [tl(l, 'Let the time pass'), tl(l, 'Not yet')],
          wait: minutes,
        };
        return 'answered';
      }
      this.waitFor(minutes, scene, lines, hints);
      return null;
    }
    const mode = story.world.rules.powers;
    // Set when the powers below already rolled the turn's test: the referee's own is then not rolled as well.
    let rolled = false;
    const cannot = (reason: string, name: string): string => this.cannotUse(reason, name);
    // A world of gifts: eating an item of power the protagonist carries, in the story. The same as the Eat button.
    const eating = mode === 'gift' && r.kind === 'ability' && r.ability ? p.items.find((i) => i.id === r.ability && i.kind === 'relic') : undefined;
    if (eating && canEat(story, eating.id) === 'has_power') {
      this.notice = tl(this.lang, 'You already have a power of your own: a second would not take.');
      return 'answered';
    }
    if (eating && !canEat(story, eating.id) && eatRelic(story, eating.id)) {
      lines.push(`eat: ${p.name} eats ${eating.name}. Its power is their own from now on, for good. ${powerLine(story, OWN_POWER)} Show it taking hold; it can be used from the next turn.`);
      // (Later turns of this scene have this line in their transcript; the next scene's packet has the power.)
      beats.push({ type: 'notes', notes: [{ kind: 'info', text: tl(this.lang, 'You ate {item}. {power} is your own power now, at rank 1.', { item: eating.name, power: p.sheet.gift!.name }) }] });
    }
    // An ability of the library or, in a world of gifts, a move of the character's own.
    const known = r.ability ? powerOf(p.sheet, r.ability, mode) : undefined;
    if (r.kind === 'ability' && known) {
      const can = canUseAbility(p.sheet, known.id, mode);
      const ability = this.powerName(known);
      if (can.ok) {
        // Turned on someone who can fight, a power that does damage starts the fight and is the first thing done in it.
        const opens = known.combat?.type === 'damage' ? this.foesFor(scene, r.targets) : null;
        if (opens && this.strikeFirst(scene, opens.foes, () => ({ type: 'ability', ability: known.id, target: opens.struck.id }), beats, lines, hints)) return null;
        // (A fight that began with the character brought down before they could act: the power was never used.)
        if (!scene.combat) {
          p.sheet.energy -= can.cost;
          // Mending oneself is real outside a fight too. Mending someone else is the narrator's to tell: their hit points are not kept between fights.
          const healed = known.combat?.type === 'heal' && r.targets.length === 0 ? this.mend(known.combat.value) : null;
          lines.push(known.own
            // A move is the player's own words: the narrator is given them with the reach they may have, never as a result.
            ? `move: ${p.name} uses ${known.name}, a move of their own power that they have made their own: "${known.text || known.name}". Its reach is ${known.tier} of 4 (${REACH[known.tier] ?? REACH[1]}): it does that, within that reach and no further. If a check follows, the check decides whatever was uncertain.`
            : `ability: ${p.name} uses ${known.name} (${known.text}) It works as described.`);
          if (healed !== null) lines.push(`${p.name} is mended by it.`);
          beats.push({ type: 'notes', notes: [{ kind: 'info', text: healed !== null
            ? tl(this.lang, '{ability} · {cost} energy · {n} hit points back', { ability, cost: can.cost, n: healed })
            : tl(this.lang, '{ability} · {cost} energy', { ability, cost: can.cost }) }] });
        }
      } else if (can.reason === 'not_learned' && mode === 'focus') {
        // Not learned, but within reach: an attempt. Harder, dearer, and the energy is spent either way.
        const attempt = canAttempt(p.sheet, known.id);
        if (!attempt.ok) { this.notice = attempt.reason === 'focus' ? tl(this.lang, 'You have not learned {ability}, and it needs more Focus than you have to try it.', { ability }) : cannot(attempt.reason, ability); return 'answered'; }
        p.sheet.energy -= attempt.cost;
        lines.push(`attempt: ${p.name} tries ${known.name}, which they have never learned (${known.text}) The check below says whether it works. If it does, it works as described; if not, the effort is spent and it fizzles or goes a little wrong.`);
        // The label goes to the narrator in English; the roll is shown with it in the story's language.
        const result = this.rollCheck({ attribute: 'skill', skill: null, difficulty: attempt.difficulty, label: `attempt ${known.name}`, opposed_by: null }, scene, beats, lines, hints, tl(this.lang, 'attempt {ability}', { ability }));
        rolled = true;
        const notes: Note[] = [{ kind: 'info', text: tl(this.lang, '{ability}, not learned · {cost} energy', { ability, cost: attempt.cost }) }];
        if (result.passed && !(p.found ?? []).some((f) => f.id === known.id)) {
          (p.found ??= []).push({ id: known.id });
          notes.push({ kind: 'info', text: tl(this.lang, 'You have worked out how {ability} is done. Learn it for {xp} experience on the Character screen.', { ability, xp: XP_TO_LEARN }) });
        }
        beats.push({ type: 'notes', notes });
      } else {
        this.notice = cannot(can.reason, ability);
        return 'answered';
      }
    } else if (r.kind === 'ability' && r.improvise && mode === 'gift' && this.readImprovise(r.improvise, r.ability).taking) {
      // Copying someone's power, or taking it from them, until the scene ends: the energy and a Skill test.
      const { tier, power, taking } = this.readImprovise(r.improvise, r.ability);
      const who = canTakePower(story, scene, r.targets);
      if (!who.ok) { this.notice = this.cannotTake(who.reason, taking!); return 'answered'; }
      const can = canImprovise(p.sheet, null, tier, mode, power!.id);
      if (!can.ok) { this.notice = this.cannotImprovise(can.reason, null); return 'answered'; }
      p.sheet.energy -= can.cost;
      const person = who.person;
      const theirs = person.power!.name;
      lines.push(`${taking}: ${p.name} uses their own power (${power!.gift.name}) to ${taking === 'copy' ? 'take on' : 'take away'} the power of ${person.name}, ${theirs}, as the player described. The check below says whether it works.`);
      const result = this.rollCheck({ attribute: 'skill', skill: null, difficulty: can.difficulty, label: `${taking} ${theirs}`, opposed_by: null }, scene, beats, lines, hints, (taking === 'copy' ? tl(this.lang, 'copy {power}', { power: theirs }) : tl(this.lang, 'take {power}', { power: theirs })));
      rolled = true;
      const notes: Note[] = [{ kind: 'info', text: tl(this.lang, '{power} of {name}, reach {tier} · {cost} energy', { power: theirs, name: person.name, tier, cost: can.cost }) }];
      // It is held when it is told as working (a success, or a success at a cost).
      if (result.outcome === 'success' || result.outcome === 'cost') {
        const art = borrowPower(story, scene.id, person, tier, taking === 'steal');
        lines.push(`${taking === 'copy' ? 'copied' : 'taken'}: ${p.name} holds ${person.name}'s ${art.power.name} until this scene ends, reaching ${art.power.rank} of 4 (${art.power.text})${taking === 'steal' ? `, and ${person.name} cannot use it meanwhile` : ''}.`);
        notes.push({ kind: 'info', text: taking === 'copy'
          ? tl(this.lang, 'You copied {power} from {name}, until the scene ends.', { power: art.power.name, name: person.name })
          : tl(this.lang, 'You took {power} from {name}, until the scene ends.', { power: art.power.name, name: person.name }) });
      }
      beats.push({ type: 'notes', notes });
    } else if (r.kind === 'ability' && r.improvise && (mode === 'gift' || (!!r.improvise.path && PATHS.includes(r.improvise.path)))) {
      // An effect of the player's own, within a path or school they have, or within their own power: always a test, never free.
      const { path, tier, kind, power } = this.readImprovise(r.improvise, r.ability);
      const gift = mode === 'gift' ? power?.gift : undefined;
      const can = canImprovise(p.sheet, path, tier, mode, power?.id);
      if (!can.ok) { this.notice = this.cannotImprovise(can.reason, path); return 'answered'; }
      // A damaging effect turned on someone who can fight starts the fight, and is the first thing done in it.
      const opens = kind === 'damage' ? this.foesFor(scene, r.targets) : null;
      if (opens && this.strikeFirst(scene, opens.foes, () => {
        const made = this.inventedAction(r, input.text, scene.combat!, scene.combat!.fighters[opens.struck.id], scene, beats);
        return made === 'plain' ? null : made;
      }, beats, lines, hints)) return null;
      if (scene.combat) return this.notice ? 'answered' : null;
      p.sheet.energy -= can.cost;
      lines.push(gift
        ? `improvised: ${p.name} uses their own power (${gift.name}) in a way that is new to them, as the player described. Its reach is ${tier} of 4 (${REACH[tier]}): keep it within that. The check below says whether it works.`
        : `improvised: ${p.name} shapes ${path} into an effect of their own, as the player described. Its reach is ${tier} of 4 (${REACH[tier]}): keep it within that. The check below says whether it works.`);
      const pathWord = path ? this.rule(path) : '';
      // The label goes to the narrator in English; the roll is shown with it in the story's language.
      const result = gift
        ? this.rollCheck({ attribute: 'skill', skill: null, difficulty: can.difficulty, label: `a new use of ${gift.name}`, opposed_by: null }, scene, beats, lines, hints, tl(this.lang, 'a new use of {power}', { power: gift.name }))
        : this.rollCheck({ attribute: 'skill', skill: null, difficulty: can.difficulty, label: `shape ${path}`, opposed_by: null }, scene, beats, lines, hints, tl(this.lang, 'shape {path}', { path: pathWord }));
      rolled = true;
      const notes: Note[] = [{ kind: 'info', text: gift
        ? tl(this.lang, 'A new use of your power (reach {tier}) · {cost} energy', { tier, cost: can.cost })
        : tl(this.lang, 'An effect of your own ({path}, reach {tier}) · {cost} energy', { path: pathWord, tier, cost: can.cost }) }];
      // It mends the character when it is told as working (a success, or a success at a cost) and was not meant for someone else.
      if (kind === 'heal' && r.targets.length === 0 && (result.outcome === 'success' || result.outcome === 'cost')) {
        const fx = fightEffect('heal', tier);
        const healed = fx?.type === 'heal' ? this.mend(fx.value) : 0;
        if (healed > 0) { lines.push(`${p.name} is mended by it.`); notes.push({ kind: 'info', text: tln(this.lang, healed, '{n} hit point back', '{n} hit points back') }); }
      }
      // In a world of gifts a use that truly worked is remembered, and can be kept as a move.
      if (power && result.passed && this.noteWorked(input.text, tier, kind, power)) {
        notes.push({ kind: 'info', text: tl(this.lang, 'You have worked out a new use of your power. Keep it as a move for {xp} experience on the Character screen.', { xp: XP_TO_LEARN }) });
      }
      beats.push({ type: 'notes', notes });
    }
    // Asking someone to teach an ability. Whether they will is a matter of how well they know the protagonist.
    if (r.kind === 'learn' && known && mode === 'focus') {
      const teacher = teachableHere(story, scene.placeId, 99).find((t) => t.ability.id === known.id)?.teacher;
      const ability = this.rule(known.name);
      if (p.sheet.abilities.includes(known.id)) { this.notice = tl(this.lang, 'You already know {ability}.', { ability }); return 'answered'; }
      if ((p.found ?? []).some((f) => f.id === known.id)) { this.notice = tl(this.lang, 'You have already been shown {ability}. Learn it on the Character screen.', { ability }); return 'answered'; }
      if (teacher) {
        const need = teachingStage(known.tier, teacher.kind === 'mentorship');
        const have = stageIndex(teacher.bond);
        if (have < need) {
          lines.push(`teach: ${p.name} asks ${teacher.name} to teach ${known.name}. ${teacher.name} will not, yet: it is taught to someone they know better than this (they would to someone ${STAGES[need]}; ${p.name} is at ${STAGES[have]}). Play the refusal in their own voice, and leave the door open.`);
          beats.push({ type: 'notes', notes: [{ kind: 'info', text: tl(this.lang, '{teacher} teaches {ability} to someone they know as {need}. You are at {have}.', { teacher: teacher.name, ability, need: this.rule(STAGES[need] ?? ''), have: this.rule(STAGES[have] ?? '') }) }] });
        } else {
          (p.found ??= []).push({ id: known.id, by: teacher.id });
          lines.push(`teach: ${teacher.name} agrees, and shows ${p.name} ${known.name} (${known.text}) It takes about an hour. ${p.name} has now seen how it is done and has not mastered it: do not have them use it in this reply.`);
          beats.push({ type: 'notes', notes: [{ kind: 'info', text: tl(this.lang, '{teacher} showed you {ability}. Learn it for {xp} experience on the Character screen.', { teacher: teacher.name, ability, xp: XP_TO_LEARN }) }] });
        }
      }
      // With nobody here who teaches it, the asking is plain talk: the narrator answers in the story.
    }
    // A world of gifts: asking someone to teach a discipline they practise. Whether they will is a matter of the bond.
    if (r.kind === 'learn' && mode === 'gift' && r.ability) {
      const d = (story.world.disciplines ?? []).find((x) => x.id === r.ability);
      const teacher = d ? castOf(story, scene.placeId).map((id) => this.person(id)).find((x): x is Person => !!x && !x.away && x.trains === d.id) : undefined;
      if (d && holdsDiscipline(p.sheet, d.id)) { this.notice = tl(this.lang, 'You already have {power}.', { power: d.name }); return 'answered'; }
      if (d && (p.found ?? []).some((f) => f.id === d.id)) { this.notice = tl(this.lang, 'You have already been shown {power}. Learn it on the Character screen.', { power: d.name }); return 'answered'; }
      if (d && teacher && !d.taught) {
        lines.push(`teach: ${p.name} asks ${teacher.name} to teach ${d.name}. It cannot be taught: someone has it in them or does not, and it awakens, if ever, when they are pushed past their limit. Let ${teacher.name} say so in their own voice.`);
        beats.push({ type: 'notes', notes: [{ kind: 'info', text: tl(this.lang, '{power} cannot be taught. It may awaken in you after you have been brought down in a fight.', { power: d.name }) }] });
      } else if (d && teacher) {
        const need = disciplineStage(teacher);
        const have = stageIndex(teacher.bond);
        if (have < need) {
          lines.push(`teach: ${p.name} asks ${teacher.name} to teach ${d.name}. ${teacher.name} will not, yet: it is taught to someone they know better than this (they would to someone ${STAGES[need]}; ${p.name} is at ${STAGES[have]}). Play the refusal in their own voice, and leave the door open.`);
          beats.push({ type: 'notes', notes: [{ kind: 'info', text: tl(this.lang, '{teacher} teaches {power} to someone they know as {need}. You are at {have}.', { teacher: teacher.name, power: d.name, need: this.rule(STAGES[need] ?? ''), have: this.rule(STAGES[have] ?? '') }) }] });
        } else {
          (p.found ??= []).push({ id: d.id, by: teacher.id });
          lines.push(`teach: ${teacher.name} agrees, and shows ${p.name} the beginnings of ${d.name} (${d.text}) and a first technique, ${d.move.name}. It takes hours. ${p.name} has seen how it is done and has not mastered it: do not have them use it in this reply.`);
          beats.push({ type: 'notes', notes: [{ kind: 'info', text: tl(this.lang, '{teacher} showed you {power}. Learn it for {xp} experience on the Character screen.', { teacher: teacher.name, power: d.name, xp: XP_TO_LEARN_DISCIPLINE }) }] });
        }
      }
      // With nobody here who practises it, the asking is plain talk.
    }
    // Asking someone to come along, or a companion to stay behind. Whether they come is a matter of the bond.
    if (r.kind === 'invite' || r.kind === 'part') {
      const asked = [...r.targets, ...(input.to ? [input.to] : [])].map((id) => this.person(id)).filter((x): x is Person => !!x && scene.cast.includes(x.id));
      const who = r.kind === 'part' ? asked.find((x) => x.inParty) : asked.find((x) => !x.inParty) ?? asked[0];
      if (who && r.kind === 'invite') {
        const can = canJoin(story, who);
        if (can.ok) {
          joinParty(who);
          lines.push(`company: ${p.name} asks ${who.name} to come along, and ${who.name} agrees: they travel with ${p.name} from now on. Play the yes in their own voice.`);
          beats.push({ type: 'notes', notes: [{ kind: 'company', who: who.id, text: tl(this.lang, '{name} joins your party', { name: who.name }), tone: 'good' }] });
        } else if (can.reason === 'already') {
          this.notice = tl(this.lang, '{name} already travels with you.', { name: who.name });
          return 'answered';
        } else if (can.reason === 'none_allowed') {
          this.notice = tl(this.lang, 'This story is played without companions: nobody travels with you. It is a setting of the story.');
          return 'answered';
        } else if (can.reason === 'full') {
          const room = tln(this.lang, story.settings.companions, 'one companion', '{n} companions');
          this.notice = tl(this.lang, 'Your party is full: {room} at this table. Someone would have to stay behind first.', { room });
          return 'answered';
        } else if (can.reason === 'grievance') {
          lines.push(`company: ${p.name} asks ${who.name} to come along. ${who.name} will not: they hold something against ${p.name} (${who.grievance}). Play the refusal in their own voice; amends would have to come first.`);
          beats.push({ type: 'notes', notes: [{ kind: 'company', who: who.id, text: tl(this.lang, '{name} will not travel with you while they hold this against you: {grievance}', { name: who.name, grievance: who.grievance ?? '' }), tone: 'bad' }] });
        } else if (can.reason === 'stage') {
          lines.push(`company: ${p.name} asks ${who.name} to come along. ${who.name} will not, yet: they would travel with someone they know as ${STAGES[PARTY.joinStage]}, and ${p.name} is at ${STAGES[can.have]}. Play the refusal in their own voice, and leave the door open.`);
          beats.push({ type: 'notes', notes: [{ kind: 'company', who: who.id, text: tl(this.lang, '{name} would travel with someone they know as {need}. You are at {have}.', { name: who.name, need: this.rule(STAGES[PARTY.joinStage] ?? ''), have: this.rule(STAGES[can.have] ?? '') }), tone: 'plain' }] });
        }
        // A crowd or a passer-by cannot come along: the asking is plain talk.
      } else if (who) {
        leaveParty(who, scene.placeId);
        lines.push(`company: at ${p.name}'s word, ${who.name} no longer travels with them and stays here for now. Play how ${who.name} takes it.`);
        beats.push({ type: 'notes', notes: [{ kind: 'company', who: who.id, text: tl(this.lang, '{name} leaves your party and stays at {place}', { name: who.name, place: story.world.places[scene.placeId]?.name ?? tl(this.lang, 'this place') }), tone: 'plain' }] });
      }
    }
    // Buying, selling, giving, changing money: the referee said what and at what price word; the rules set the amount and move it.
    if (r.kind === 'trade') {
      const done = this.trade(r, input, scene, beats, lines, hints);
      if (done === 'answered') return 'answered';
      if (done === 'rolled') rolled = true;
    }
    let check = rolled ? null : r.check;
    // An effort in something that takes several (a chase, a search, a debate), or the first effort of a new one.
    if (check && !scene.combat) {
      const begins = (r as { contest?: { label?: unknown; length?: unknown } | null }).contest;
      const toward = (r as { toward_contest?: unknown }).toward_contest === true;
      if (!story.contest && begins && typeof begins.label === 'string' && begins.label.trim()) {
        story.contest = newContest(story, clip(begins.label.trim(), 60), begins.length === 'long' ? 'long' : 'short', scene.placeId);
        lines.push(`contest begins: ${story.contest.label}. It takes ${story.contest.goal} efforts that go ${p.name}'s way, and is lost after ${story.contest.limit} that do not. This is the first.`);
        this.contestStep(this.rollCheck(check, scene, beats, lines, hints), scene, beats, lines);
        check = null;
      } else if (story.contest && toward) {
        this.contestStep(this.rollCheck(check, scene, beats, lines, hints), scene, beats, lines);
        check = null;
      }
    }
    if (r.kind === 'move' && r.move_to && routeBetween(story, scene.placeId, r.move_to)) {
      const dest = story.world.places[r.move_to];
      const held = clip((r.held ?? '').trim().replace(/[.\s]+$/, ''), 160);
      // Nothing stands in the way: they go.
      if (!held) return this.moveTo(r.move_to, scene, beats, lines, hints, usage);
      // Something does. Wanting to leave is not leaving: it takes a successful attempt, or the scene letting go.
      if (check) {
        const result = this.rollCheck(check, scene, beats, lines, hints);
        check = null;
        if (result.passed) {
          lines.push(`got away: ${p.name} was not free to leave (${held}) and gets away all the same. Before the arrival, tell in one or two sentences how.`);
          return this.moveTo(r.move_to, scene, beats, lines, hints, usage, `You got away and left for ${dest?.name ?? 'another place'}. What stood in the way: ${held}.`);
        }
        lines.push(`leaving: ${p.name} tries to leave for ${dest?.name ?? 'another place'} and does not get away: ${held}. They are still here. Tell what the failed attempt brings.`);
      } else {
        lines.push(`leaving: ${p.name} wants to leave for ${dest?.name ?? 'another place'} and is not free to walk out: ${held}. They stay unless what holds them gives way. Tell what happens when they try. If it ends with them let go, add "move: ${r.move_to}" to the facts.`);
      }
      hints.held = held;
    }
    if (r.kind === 'fight') {
      // Whoever was attacked, plus everyone hostile who is here and able to fight: nobody stands by while a friend is hit.
      const here = scene.cast.map((id) => this.person(id)).filter((x): x is Person => !!x && !x.inParty && !!x.fight?.fights);
      const named = new Set(r.targets);
      const foes = here.filter((x) => named.has(x.id) || /hostile/i.test(x.attitude));
      if (foes.length) {
        this.startFight(scene, foes.map((f) => f.id));
        const c = scene.combat;
        if (c && c.awaiting === 'action') {
          const target = Object.values(c.fighters).find((f) => f.side === 'foe' && isUp(f));
          if (target) this.fightRound({ type: 'combat', action: { type: 'attack', target: target.id } }, scene, beats, lines, hints);
          return null;
        }
      }
    }
    if (r.kind === 'rest') {
      const minutes = Math.max(10, Math.min(600, Math.round(r.minutes) || 60));
      this.pass(minutes);
      p.sheet = rest(p.sheet, minutes);
      lines.push(`rest: ${durationLabel(minutes)} pass.`);
    }
    if (check) this.rollCheck(check, scene, beats, lines, hints);
    // Someone with a moment waiting is being given time or attention: tell the narrator it may happen now.
    if (r.kind === 'talk' || r.kind === 'act' || r.kind === 'rest') {
      const sought = new Set([...r.targets, ...(input.to ? [input.to] : [])]);
      const waiting = scene.cast.map((id) => this.person(id)).find((x) => !!x && !!x.pendingMoment && sought.has(x.id));
      if (waiting) {
        lines.push(`moment waiting: ${waiting.name} has wanted a quiet moment with ${p.name} since the bond between them became ${waiting.pendingMoment}. ${asksIn(waiting) ? ` In it ${waiting.name} asks ${p.name} for help with something of their own: ${clip(waiting.wish!, 140)}` : ''} If this is a private and unhurried enough time, let it happen now and add "moment: ${waiting.id}" to the facts. If it is not, leave it for later.`);
        hints.moment = waiting.id;
      }
    }
    // Cards for anyone or anything named that is not already in the packet, and memories the player reached for.
    const found = findMentions(story, input.clarifies ? `${input.clarifies.original} ${input.text}` : input.text, r.mentions);
    const inScene = new Set(scene.cast);
    for (const person of found.people.filter((x) => !inScene.has(x.id)).slice(0, 2)) lines.push(`card ${personCard(story, person)} ${whereLine(story, person)}`.trim());
    for (const place of found.places.filter((x) => x.id !== scene.placeId).slice(0, 2)) lines.push(`place [${place.id}] ${place.name}: ${clip(place.card, 220)}`);
    if (r.recall.length) for (const e of recall(story, r.recall, 3)) lines.push(`memory ${recallLine(story, e)}`);
    return null;
  }

  /**
   * Roll a test the referee asked for: the die is shown, the roll is logged, and the narrator is told the outcome.
   * `shown` is the label the player sees, when the engine wrote it in the story's language; the narrator is told `check.label`.
   */
  private rollCheck(check: NonNullable<RefereeOut['check']>, scene: Scene, beats: Beat[], lines: string[], hints: MockHints, shown: string = check.label): ReturnType<typeof runTest> {
    const story = this.story;
    const result = runTest(story.protagonist.sheet, { attribute: check.attribute, skill: check.skill, difficulty: check.difficulty, label: shown }, story.settings.style, this.rng);
    const opposed = check.opposed_by && this.person(check.opposed_by) ? check.opposed_by : null;
    beats.push({ type: 'check', result, opposedBy: opposed });
    story.rolls.push({ n: story.totals.turns + 1, clock: { ...story.clock }, placeId: scene.placeId, result, label: shown, who: '', byYou: true });
    if (result.passed) scene.stats.testsPassed += 1;
    if (check.difficulty === 'hard' || opposed) scene.stats.inDanger = true;
    const word = { success: 'SUCCESS', cost: 'SUCCESS AT A COST', forward: 'FAILURE WITH A WAY FORWARD', fail: 'FAILURE' }[result.outcome];
    lines.push(`check: ${check.label} (${check.skill ?? check.attribute}, ${check.difficulty}${opposed ? `, against ${this.name(opposed)}` : ''}) -> ${word}${result.passed ? `, quality ${result.quality} of 5` : ''}.`);
    hints.outcome = result.outcome;
    hints.checkLabel = check.label;
    return result;
  }

  // ---------- Money and things ----------

  /**
   * A trade. The referee said what is traded and what such a thing usually costs, in a word; the rules
   * set the amount, check the purse and move the money. Returns 'answered' when it cannot be done (the
   * player is told why, and nothing is narrated), 'rolled' when it used the turn's test (a haggle), and
   * null otherwise. In a world without money, buying and selling are plain narration.
   */
  private trade(r: RefereeOut, input: Input, scene: Scene, beats: Beat[], lines: string[], hints: MockHints): 'answered' | 'rolled' | null {
    const story = this.story;
    const p = story.protagonist;
    const l = this.lang;
    const t = (r as { trade?: TradeOut | null }).trade;
    if (!t) return null;
    const giving = t.deal === 'give' && !!t.item;
    if (!hasMoney(story.world) && !giving) return null;
    // Whom the trade is with: someone spoken to, or acted on, who is here.
    const other = [...(input.to ? [input.to] : []), ...r.targets].map((id) => this.person(id)).find((x): x is Person => !!x && scene.cast.includes(x.id));
    const otherName = other?.name ?? null;
    const what = clip((t.what || '').trim() || tl(l, 'it'), 60);
    const money = currencyFor(story, t.money) ?? moneyOf(story)[0]!;
    const notes: Note[] = [];
    const done = (rolled: boolean): 'rolled' | null => { if (notes.length) beats.push({ type: 'notes', notes }); return rolled ? 'rolled' : null; };
    // A haggle is a test: the referee's, or a plain one of talking someone round.
    const haggle = (label: string): boolean => {
      const check = r.check ?? { attribute: 'skill' as const, skill: 'Manipulation' as const, difficulty: 'medium' as const, label, opposed_by: other?.count === 1 ? other.id : null };
      const result = this.rollCheck(check, scene, beats, lines, hints, r.check ? check.label : tl(l, 'haggle over {what}', { what }));
      return result.outcome === 'success' || result.outcome === 'cost';
    };
    const findItem = (key: string | null) => {
      const k = (key ?? '').trim().toLowerCase();
      return k ? p.items.find((i) => i.id === k) ?? p.items.find((i) => i.name.toLowerCase() === k) ?? p.items.find((i) => i.name.toLowerCase().includes(k)) : undefined;
    };

    if (t.deal === 'buy') {
      const word: Price = isPrice(t.price) ? t.price : 'cheap';
      // Under the Story style everyday costs are not counted: the character simply pays.
      if (story.settings.style === 'story' && (word === 'trivial' || word === 'cheap')) {
        if (t.keeps) this.addItem(what, '');
        lines.push(`trade: ${p.name} pays for ${what}${otherName ? ` (${otherName})` : ''}. Everyday costs are not counted in this story.`);
        notes.push({ kind: 'info', text: tl(l, '{what}: everyday costs are not counted in this story.', { what }) });
        return done(false);
      }
      // A friend asks less, and a close friend much less.
      const rate = other && other.count === 1 ? friendRate(other.bond) : 1;
      let price = Math.max(1, Math.round(priceIn(word, money) * rate));
      let rolled = false;
      let haggled = false;
      if (t.haggle) {
        rolled = true;
        if (!haggle(`haggle over ${what}`)) {
          lines.push(`trade: ${otherName ?? 'The seller'} will not come down from ${amountLabel(price, money)} for ${what}, and nothing is bought yet. ${p.name} carries ${amountLabel(amountOf(story, money.id), money)}.`);
          notes.push({ kind: 'info', text: tl(l, 'No better price for {what}: it is still {price}.', { what, price: amountLabel(price, money) }) });
          return done(true);
        }
        price = Math.max(1, Math.round(price * (1 - HAGGLE)));
        haggled = true;
      }
      const have = payable(story, money);
      if (have < price) {
        if (!rolled) { this.notice = tl(l, '{what} costs {price}. You have {have}.', { what: cap(what), price: amountLabel(price, money), have: amountLabel(have, money) }); return 'answered'; }
        lines.push(`trade: even at that price ${p.name} cannot pay ${amountLabel(price, money)} for ${what}: they carry ${amountLabel(have, money)}. Nothing is bought.`);
        notes.push({ kind: 'info', text: tl(l, '{what} costs {price}. You have {have}.', { what: cap(what), price: amountLabel(price, money), have: amountLabel(have, money) }) });
        return done(true);
      }
      pay(story, money, price);
      if (t.keeps) this.addItem(what, '');
      lines.push(`trade: ${p.name} buys ${what}${otherName ? ` from ${otherName}` : ''} for ${amountLabel(price, money)}${haggled ? ', after haggling' : rate < 1 ? ', a friend’s price' : ''}, and has ${amountLabel(have - price, money)} left. The money has changed hands: tell it.`);
      notes.push({ kind: 'info', text: tl(l, 'Bought {what} · {price}', { what, price: amountLabel(price, money) }) });
      return done(rolled);
    }

    if (t.deal === 'sell') {
      const item = findItem(t.item ?? t.what);
      if (!item) { this.notice = tl(l, 'You do not carry that.'); return 'answered'; }
      if (item.kind === 'relic' || item.kind === 'quest') { this.notice = tl(l, '{item} is not something to sell.', { item: item.name }); return 'answered'; }
      const word: Price = isPrice(t.price) ? t.price : 'cheap';
      const full = priceIn(word, money);
      // What a thing fetches is a part of its price; a friend pays more, never more than it is worth.
      const rate = other && other.count === 1 ? friendRate(other.bond) : 1;
      let value = Math.max(1, Math.min(full, Math.round((full * SELLING) / rate)));
      let rolled = false;
      if (t.haggle) {
        rolled = true;
        if (!haggle(`haggle over ${item.name}`)) {
          lines.push(`trade: ${otherName ?? 'The buyer'} will give no more than ${amountLabel(value, money)} for ${item.name}, and nothing is sold yet.`);
          notes.push({ kind: 'info', text: tl(l, 'No better offer for {what}: {price}.', { what: item.name, price: amountLabel(value, money) }) });
          return done(true);
        }
        value = Math.min(full, Math.round(value * (1 + HAGGLE)));
      }
      this.dropItem(item);
      addMoney(story, money.id, value);
      lines.push(`trade: ${p.name} sells ${item.name}${otherName ? ` to ${otherName}` : ''} for ${amountLabel(value, money)}, and now has ${amountLabel(amountOf(story, money.id), money)}. The money has changed hands: tell it.`);
      notes.push({ kind: 'info', text: tl(l, 'Sold {what} · {price}', { what: item.name, price: amountLabel(value, money) }) });
      return done(rolled);
    }

    if (t.deal === 'give') {
      if (t.item) {
        const item = findItem(t.item);
        if (!item) { this.notice = tl(l, 'You do not carry that.'); return 'answered'; }
        // An item of power is not handed over in passing: its power would go with it.
        if (item.kind === 'relic') { this.notice = tl(l, '{item} is not something to give away.', { item: item.name }); return 'answered'; }
        this.dropItem(item);
        lines.push(`give: ${p.name} gives ${item.name}${otherName ? ` to ${otherName}` : ''}. Whether it matters to them is yours to tell (with a bond line if it does).`);
        notes.push({ kind: 'info', text: otherName ? tl(l, 'You gave {item} to {name}.', { item: item.name, name: otherName }) : tl(l, 'You gave {item} away.', { item: item.name }) });
        return done(false);
      }
      const have = payable(story, money);
      const named = typeof t.amount === 'number' && Number.isFinite(t.amount) && t.amount > 0 ? Math.round(t.amount) : null;
      const amount = named ?? priceIn(isPrice(t.price) ? t.price : 'cheap', money);
      if (amount > have) { this.notice = tl(l, 'You have only {have}.', { have: amountLabel(have, money) }); return 'answered'; }
      pay(story, money, amount);
      lines.push(`give: ${p.name} gives ${amountLabel(amount, money)}${otherName ? ` to ${otherName}` : ''} (${what}), and has ${amountLabel(have - amount, money)} left. The money has changed hands. Whether it matters to them is yours to tell (with a bond line if it does).`);
      notes.push({ kind: 'info', text: otherName ? tl(l, 'You gave {name} {amount}.', { name: otherName, amount: amountLabel(amount, money) }) : tl(l, 'You paid {amount}.', { amount: amountLabel(amount, money) }) });
      return done(false);
    }

    // Changing one money for another, at the money changer's rate.
    const into = currencyFor(story, t.into);
    if (!into || into.id === money.id) { this.notice = tl(l, 'There is no other money here to change it into.'); return 'answered'; }
    const have = amountOf(story, money.id);
    const amount = typeof t.amount === 'number' && t.amount > 0 ? Math.min(Math.round(t.amount), have) : have;
    const got = exchanged(amount, money, into);
    if (amount <= 0 || got < 1) { this.notice = tl(l, 'That is too little to change: you have {have}.', { have: amountLabel(have, money) }); return 'answered'; }
    addMoney(story, money.id, -amount);
    addMoney(story, into.id, got);
    lines.push(`trade: ${p.name} changes ${amountLabel(amount, money)} into ${amountLabel(got, into)}${otherName ? ` with ${otherName}` : ''}, the changer keeping a tenth. The money has changed hands: tell it.`);
    notes.push({ kind: 'info', text: tl(l, 'Changed {from} into {to}', { from: amountLabel(amount, money), to: amountLabel(got, into) }) });
    return done(false);
  }

  /** Put a plain thing in the protagonist's bag (another of the same adds to the count). Null when the bag holds as much as it can. */
  private addItem(name: string, text: string): Item | null {
    const p = this.story.protagonist;
    const n = clip(name.trim(), 40);
    if (!n) return null;
    const same = p.items.find((i) => i.kind === 'gear' && i.name.toLowerCase() === n.toLowerCase());
    if (same) { same.qty += 1; return same; }
    if (p.items.length >= ITEMS_MAX) return null;
    const base = n.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'thing';
    let id = base;
    for (let i = 2; p.items.some((x) => x.id === id); i++) id = `${base}_${i}`;
    const item: Item = { id, name: n, kind: 'gear', text: clip(text.trim(), 110), qty: 1 };
    p.items.push(item);
    return item;
  }

  /** Take one of a thing out of the bag. */
  private dropItem(item: Item): void {
    const p = this.story.protagonist;
    item.qty -= 1;
    if (item.qty <= 0) p.items = p.items.filter((i) => i !== item);
  }

  // ---------- Efforts that add up ----------

  /** Count one effort in the contest under way, and say so; it ends when it is won or lost. */
  private contestStep(result: ReturnType<typeof runTest>, scene: Scene, beats: Beat[], lines: string[]): void {
    const story = this.story;
    const c = story.contest;
    if (!c) return;
    const l = this.lang;
    const went = result.outcome === 'success' || result.outcome === 'cost';
    if (went) c.wins += 1; else c.losses += 1;
    const notes: Note[] = [];
    if (c.wins >= c.goal) {
      lines.push(`contest won: ${c.label}. This effort decided it: tell how it ends in ${story.protagonist.name}'s favour.`);
      notes.push({ kind: 'info', text: tl(l, '{label}: won', { label: c.label }) });
      // As worthy as a fight won, for experience.
      scene.stats.fightsWon += 1;
      story.contest = null;
    } else if (c.losses >= c.limit) {
      lines.push(`contest lost: ${c.label}. This effort decided it: tell how it slips away; what was at stake is lost, or will cost dearly.`);
      notes.push({ kind: 'info', text: tl(l, '{label}: lost', { label: c.label }), tone: 'warn' });
      story.contest = null;
    } else {
      lines.push(`contest: ${c.label}, ${c.wins} of ${c.goal} won and ${c.losses} of ${c.limit} lost. Tell this effort as a step of it, not its end.`);
      notes.push({ kind: 'info', text: tl(l, '{label}: {wins} of {goal} won, {losses} of {limit} lost', { label: c.label, wins: c.wins, goal: c.goal, losses: c.losses, limit: c.limit }) });
    }
    scene.stats.inDanger = true;
    beats.push({ type: 'notes', notes });
  }

  /** Give up the contest under way, between turns: it is lost, and the narrator hears of it at the next turn. */
  giveUpContest(): boolean {
    const story = this.story;
    const c = story.contest;
    if (!c || this.busy || this.combat || story.over) return false;
    this.between(() => {
      story.contest = null;
      story.tellNext = [...(story.tellNext ?? []), `contest given up: ${story.protagonist.name} has given up on ${c.label} since the last turn. It is lost.`];
    });
    return true;
  }

  // ---------- What the player keeps as true ----------

  /**
   * Keep something as true: a line of the story the player pinned ("Keep this"), or their correction of
   * something the narrator got wrong ("That's wrong", `fixed`). `about` is a person's id, a place's id,
   * or "" for the story as a whole. It goes on that card from now on, and the narrator is told at the
   * next turn. Kept between turns, so a rewind takes it back. Returns null when it was kept, else why not.
   */
  keepFact(about: string, text: string, fixed = false): string | null {
    const story = this.story;
    const l = this.lang;
    const words = clip(text.trim(), FACTS_MAX.chars);
    if (this.busy) return tl(l, 'Wait for the turn to finish.');
    if (!words) return tl(l, 'Write what is true first.');
    const person = about ? this.person(about) : undefined;
    const place = about ? story.world.places[about] : undefined;
    if (about && !person && !place) return tl(l, 'There is nobody and nowhere by that name in this story.');
    const max = about ? FACTS_MAX.about : FACTS_MAX.story;
    if ((story.facts ?? []).filter((f) => f.about === about).length >= max) {
      const what = person?.name ?? place?.name ?? tl(l, 'the story');
      return tl(l, '{n} things are kept as true about {what} already: let one go first.', { n: max, what });
    }
    this.between(() => {
      const facts = (story.facts ??= []);
      let id = `f${facts.length + 1}`;
      for (let i = 2; facts.some((f) => f.id === id); i++) id = `f${facts.length + i}`;
      facts.push({ id, about, text: words, sceneId: this.scene.id, day: story.clock.day, ...(fixed ? { fixed: true } : {}) });
      const whom = person ? ` (about ${person.name})` : place ? ` (about ${place.name})` : '';
      story.tellNext = [...(story.tellNext ?? []), fixed
        ? `correction${whom}: the player says the telling got something wrong. From now on this is true: ${words} Go on from it without mentioning the mistake.`
        : `kept${whom}: the player keeps this as true from now on: ${words}`];
    });
    return null;
  }

  /**
   * The player's own words on how someone looks and who they are, between turns: on their card from
   * now on, and told to the narrator at the next action. Empty words leave a part as it was.
   */
  describePerson(id: string, d: Described): string | null {
    const l = this.lang;
    if (this.busy) return tl(l, 'Wait for the turn to finish.');
    const p = this.person(id);
    if (!p) return tl(l, 'There is nobody by that name in this story.');
    const was = describedNow(p);
    const changed = (['look', 'appearance', 'card'] as const).filter((k) => d[k].trim() && d[k].trim() !== was[k].trim());
    if (!changed.length) return null;
    this.between(() => {
      describe(p, d);
      const looks = changed.includes('look') || changed.includes('appearance') ? ` Looks: ${p.appearance || p.look}` : '';
      const who = changed.includes('card') ? ` Who they are: ${p.card}` : '';
      this.story.tellNext = [...(this.story.tellNext ?? []), `described (${p.name}): the player put how they see ${p.name} into their own words; keep to it from now on.${looks}${who}`];
    });
    return null;
  }

  /** Let go of something the player kept as true. */
  dropFact(id: string): void {
    if (this.busy || !(this.story.facts ?? []).some((f) => f.id === id)) return;
    this.between(() => { this.story.facts = (this.story.facts ?? []).filter((f) => f.id !== id); });
  }

  // ---------- The end of a story ----------

  /** The story has ended (its final chapter, or a death under Brutal) and what became of everyone has not been written yet. */
  get canWriteEpilogue(): boolean { return !!this.story.over && !this.story.epilogue && !this.busy; }

  /** Write the epilogue: one request to the narrator, once. Never written by itself: the player asks, and the button says what it costs. */
  async writeEpilogue(): Promise<void> {
    if (!this.canWriteEpilogue) return;
    const story = this.story;
    const { budget } = this.deps;
    if (budget.spentToday() >= budget.cap()) {
      this.blocker = { kind: 'budget', spent: budget.spentToday(), cap: budget.cap() };
      this.emit();
      return;
    }
    this.notice = null;
    this.phase = 'writing';
    this.abort = new AbortController();
    this.emit();
    try {
      const usage: UsageEntry[] = [];
      const hints = { ...this.hints({ text: '', to: null }, this.scene), epilogue: true };
      const res = await this.call('narrator', () => this.deps.transport.send(epilogueRequest(story, this.deps.models(), hints), { signal: this.abort?.signal }), usage);
      const out = (res.parsed ?? null) as EpilogueOut | null;
      if (res.refusal || !out?.epilogue?.trim()) {
        this.notice = tl(this.lang, 'The epilogue could not be written this time. Try again.');
      } else {
        story.epilogue = { text: keepParagraphs(out.epilogue, 2600), legend: clip(out.legend ?? '', 200), at: this.deps.now(), cost: usage.reduce((sum, u) => sum + u.cost, 0) };
        story.lastPlayed = this.deps.now();
      }
    } catch (err) {
      const e = err instanceof LlmError ? err : null;
      this.notice = e?.kind === 'aborted' ? null : tl(this.lang, 'The epilogue could not be written this time. Try again.');
    }
    this.phase = 'idle';
    this.abort = null;
    this.persist();
  }

  /**
   * Take a story that has ended on into a new season: the same hero, the same world, and a new count of
   * chapters toward the next ending. Kept between turns, so a rewind takes it back.
   */
  newSeason(): boolean {
    const story = this.story;
    if (story.over !== 'ended' || this.busy) return false;
    this.between(() => {
      delete story.over;
      story.season = (story.season ?? 1) + 1;
      story.seasonFrom = story.chapters.length;
      story.chapter.final = false;
      story.tellNext = [...(story.tellNext ?? []), `new season: the story came to an ending and goes on now, some while after. ${story.epilogue ? `How it ended: ${clip(story.epilogue.legend || story.epilogue.text, 300)}` : ''} Open what comes next from there.`];
    });
    return true;
  }

  // ---------- Moving and scenes ----------

  private pass(minutes: number): void {
    this.story.clock = addMinutes(this.story.clock, minutes);
  }

  /** Leave for another place: the old scene is closed and written up, a new one opens. */
  private async moveTo(to: string, scene: Scene, beats: Beat[], lines: string[], hints: MockHints, usage: UsageEntry[], ending?: string): Promise<Scene> {
    const story = this.story;
    const from = story.world.places[scene.placeId];
    const dest = story.world.places[to];
    const route = routeBetween(story, scene.placeId, to);
    if (!dest || !route) return scene;
    // The leaving is not in the scene's transcript (it is the first line of the next one), so the scribe is told.
    const closing = await this.closeScene(scene, usage, ending ?? `You left for ${dest.name}.`);
    // What the scene that was left came to is shown on this turn, the journey: its own last turn is no longer on screen.
    if (closing.length) beats.push({ type: 'notes', notes: closing });
    this.pass(route.minutes);
    // A place that was only a line on the map is written before the scene in it opens.
    const filled: Note[] = [];
    await this.fillIn(to, usage, filled);
    if (filled.length) beats.push({ type: 'notes', notes: filled });
    const next = startScene(story, to, undefined, story.totals.turns + 1);
    lines.push(`travel: from ${from?.name ?? 'the last place'} to ${dest.name}, ${durationLabel(route.minutes)}${route.note ? ` (${route.note})` : ''}. A new scene opens on arrival: set the place and who is there in two or three sentences, then go on.`);
    hints.movedTo = dest.name;
    hints.place = dest.name;
    const cast = castOf(story, to).map((id) => this.person(id)).filter((p): p is Person => !!p);
    hints.cast = cast.map((p) => ({ id: p.id, name: p.name, inParty: p.inParty, count: p.count, hostile: /hostile/i.test(p.attitude) }));
    hints.exits = exitsFrom(story, to).map((e) => ({ id: e.place.id, name: e.place.name }));
    return next;
  }

  /**
   * Fill in a sketched place the first time the story arrives there: one request, once. What comes
   * back is cleaned and added to this story's world. Never throws and never stops the journey: when
   * it cannot be done (the request fails, the answer is unusable, today's limit is reached, or the
   * story has it switched off) the place stays a sketch, the narrator makes do with its one line as
   * before, and the next arrival tries again.
   *
   * The world growing is not something that happened in the story. So the copy of the story that this
   * turn is measured against grows too: taking the turn back, or rewinding past it, leaves the place
   * as it was written, and it is never written (or paid for) a second time.
   */
  private async fillIn(placeId: string, usage: UsageEntry[], notes: Note[]): Promise<void> {
    const story = this.story;
    const place = story.world.places[placeId];
    if (!place?.sketch || story.settings.fillPlaces === false) return;
    const { budget } = this.deps;
    if (budget.spentToday() >= budget.cap()) return;
    const before = this.phase;
    this.phase = 'mapping';
    this.filling = place.name;
    this.emit();
    try {
      const res = await this.call('architect', () => this.deps.transport.send(expandRequest(story, placeId, this.deps.models())), usage);
      if (res.stop === 'max_tokens' || !res.parsed) throw new Unusable('No usable answer came back.');
      const x = cleanExpansion(res.parsed as ExpandOut, story.world, placeId);
      applyExpansion(story.world, x);
      // Every copy a turn is measured against grows with it: the one before the turn, and the one before its telling.
      for (const key of ['snapshot', 'told'] as const) {
        const copy = this[key];
        if (!copy) continue;
        const was = JSON.parse(copy) as Story;
        applyExpansion(was.world, x);
        this[key] = JSON.stringify(was);
      }
      const named = x.people.filter((p) => p.count === 1).length;
      const people = tln(this.lang, named, '{n} person', '{n} people');
      notes.push({ kind: 'info', text: tl(this.lang, '{place} is now part of the world: {places} places and {people} were written for it. It stays as written from now on.', { place: place.name, places: x.places.length, people }) });
    } catch {
      notes.push({ kind: 'info', text: tl(this.lang, '{place} is still a sketch: it could not be filled in this time. The next time you arrive here it is tried again.', { place: place.name }) });
    }
    this.phase = before;
    this.filling = null;
  }

  /**
   * End a scene: experience by rule, then the scribe turns it into records. Never throws: play must not
   * stop here. Returns what the rules did as the scene closed (experience earned, a chapter ending), for
   * the caller to show on the turn the player is looking at: the turn that ended the scene, or the
   * journey that left it.
   */
  private async closeScene(scene: Scene, usage: UsageEntry[], ending: string | null = null): Promise<Note[]> {
    const notes: Note[] = [];
    if (scene.ended) return notes;
    const story = this.story;
    scene.ended = true;
    scene.combat = null;
    // A power copied or taken for the scene goes back, and one that was taken is its owner's again.
    const lent = (story.protagonist.sheet.arts ?? []).find((a) => a.id === BORROWED);
    const owner = giveBack(story);
    if (lent) notes.push({ kind: 'info', text: owner ? tl(this.lang, '{power} goes back to {name}.', { power: lent.power.name, name: owner.name }) : tl(this.lang, '{power} has left you.', { power: lent.power.name }) });
    const xp = sceneExperience(scene.stats);
    if (xp > 0) {
      story.protagonist.xp += xp;
      story.protagonist.xpEarned += xp;
      notes.push({ kind: 'xp', amount: xp });
    }
    if (scene.turns.length === 0) { scene.summary = null; return notes; }
    // Does the chapter end here? Decided by rule, before the scribe is asked, so that the one call can write the chapter up too.
    const lastOfChapter = chapterEnds(story);
    const earlier = lastOfChapter ? chapterScenes(story).filter((sc) => sc !== scene).map((sc) => sc.summary ?? '').filter(Boolean) : null;
    const before = this.phase;
    this.phase = 'recording';
    this.emit();
    let out: ScribeOut | null = null;
    try {
      const hints = this.hints({ text: '', to: null }, scene);
      const res = await this.call('scribe', () => this.deps.transport.send(scribeRequest(story, scene, this.deps.models(), hints, ending, earlier)), usage);
      out = (res.parsed ?? null) as ScribeOut | null;
    } catch {
      out = null; // the scribe could not be reached: fall back to a summary made by code
    }
    scene.summary = clip(out?.summary || fallbackSummary(story, scene), 340);
    // The world moves on, before the chapter (if it ends here) is closed: a front moves once a chapter.
    this.moveWorld(scene, out, lastOfChapter);
    if (lastOfChapter) {
      // The chapter is written up once, here, and never again. The next one begins with destiny restored.
      const wasFinal = !!story.chapter.final && story.settings.ending === 'ending';
      const mainWasDone = !!story.chapter.mainDone;
      const { begins } = closeChapter(story, out?.chapter ?? null);
      // Something that takes several efforts and was not decided lapses with the chapter.
      story.contest = null;
      if (wasFinal) {
        // A story with an ending ends with its final chapter. What became of everyone is written when the player asks.
        story.over = 'ended';
        notes.push({ kind: 'info', text: tl(this.lang, 'The story has come to its end.') });
      } else {
        notes.push({ kind: 'chapter', n: begins.n, title: begins.title });
        if (finalComes(story, mainWasDone)) {
          story.chapter.final = true;
          notes.push({ kind: 'info', text: tl(this.lang, 'This is the final chapter: the story builds to its end.') });
        }
      }
    } else {
      const soFar = out?.story_so_far?.trim();
      story.summary = clip(soFar || `${story.summary} ${scene.summary}`.trim(), 700);
    }
    const known = new Set(Object.keys(story.world.people));
    const weight = { small: 1, notable: 2, changed_something: 3 } as const;
    for (const e of (out?.events ?? []).slice(0, 4)) {
      this.record(scene, {
        text: clip(e.text, 200), importance: weight[e.importance], reach: e.reach,
        actors: e.actors.filter((id) => known.has(id)), witnesses: e.witnesses.filter((id) => known.has(id)),
      });
    }
    for (const a of out?.attitudes ?? []) {
      const p = this.person(a.who);
      if (p && a.attitude) { p.attitude = clip(a.attitude, 28); p.attitudeWhy = clip(a.why, 80); }
    }
    // How someone looks, changed for good in the scene (a scar, a lost hat): the look is replaced, and the change heads the full description.
    for (const x of (out?.looks ?? []).slice(0, 3)) {
      const who = x.who === 'you' ? story.protagonist : this.person(x.who);
      if (!who || !x.look?.trim() || (x.who !== 'you' && !scene.cast.includes(x.who))) continue;
      who.look = clip(x.look, LOOK_MAX);
      if (x.change?.trim()) who.appearance = clip(`${cap(x.change.trim().replace(/[.\s]+$/, ''))} (since day ${story.clock.day}).${who.appearance ? ` ${who.appearance}` : ''}`, APPEARANCE_MAX);
    }
    // Who left this place to stay elsewhere, and who died, as the scribe read it in the scene. Only people who were in it, and never a companion.
    for (const c of (out?.people ?? []).slice(0, 4)) {
      const p = this.person(c.who);
      if (!p || !scene.cast.includes(p.id) || p.inParty || isAway(p)) continue;
      if (c.change === 'moved') {
        // To a place that is not on the map they are simply gone.
        if (c.to && story.world.places[c.to]) movePerson(story, p, c.to); else sendAway(story, p, 'left', c.why);
      } else {
        for (const l of sendAway(story, p, c.change === 'died' ? 'dead' : 'left', c.why)) {
          notes.push({ kind: 'info', text: tl(this.lang, '{power} is yours again: {name}, who held it, is dead.', { power: l.power.name, name: p.name }) });
          this.tellPower(`${story.protagonist.name}'s ${l.power.name} came back to them when ${p.name} died.`, l.nature ? OWN_POWER : l.art!.id);
        }
      }
    }
    // A companion who holds a grievance and no longer counts the protagonist a friend goes no further.
    for (const p of walkingOut(story)) {
      leaveParty(p, scene.placeId);
      // A memory and a line of the summary: the story's own words, in its language (the narrator reads them as story).
      const place = story.world.places[scene.placeId]?.name ?? tl(this.lang, 'the place you left');
      this.record(scene, { text: tl(this.lang, '{name} would go no further with you, and stayed at {place}.', { name: p.name, place }), importance: 3, reach: 'secret', actors: [p.id], witnesses: [] });
      const left = tl(this.lang, '{name} left your company.', { name: p.name });
      scene.summary = clip(`${scene.summary} ${left}`, 380);
      notes.push({ kind: 'company', who: p.id, text: tl(this.lang, '{name} leaves your party: {grievance}', { name: p.name, grievance: p.grievance ?? '' }), tone: 'bad' });
    }
    this.phase = before;
    return notes;
  }

  /**
   * What is in motion in the world moves when a scene ends (the rule is in fronts.ts). First whatever
   * the protagonist did to it in the scene that just ended, as the scribe read it; then the clock.
   * A stage that people would see or hear of becomes news, which spreads by the hearsay rule. The
   * player is told nothing here: they hear of it in the story, when word reaches where they are.
   */
  private moveWorld(scene: Scene, out: ScribeOut | null, chapterEnds: boolean): void {
    const story = this.story;
    // The world's own dice, apart from the player's: seeded once, kept with the story.
    const dice = (story.worldDice ??= { state: (story.rng.state ^ 0x51ed270b) >>> 0 });
    // A situation the protagonist walked away from comes to pass by itself, and what people say of it is news where it happened.
    for (const { seed } of lapseSeeds(story, scene.placeId)) {
      if (!seed.news?.trim()) continue;
      story.events.push({
        id: nextId('e', story), sceneId: scene.id, clock: { ...story.clock }, placeId: seed.placeId, text: clip(seed.news, 220),
        importance: 2, reach: 'local', actors: [], witnesses: [], told: [], front: seed.id,
      });
    }
    // People talk: what was kept secret is passed on by those who are no friends of the protagonist.
    tell(story, dice);
    if (!story.world.fronts?.length) return;
    // Only something that shows where the scene was played can have been hindered in it.
    const here = frontsAt(story, scene.placeId);
    for (const c of out?.fronts ?? []) {
      const f = here.find((x) => x.id === c.id);
      if (!f || !frontOpen(f)) continue;
      if (c.change === 'stopped') stopFront(f); else setBack(story, f);
    }
    for (const m of advanceFronts(story, dice, chapterEnds)) {
      // What the stage does to people, as the world's builder wrote it.
      for (const fate of m.front.fates ?? []) if (fate.stage === m.stage) applyFate(story, fate);
      if (!m.news) continue;
      story.events.push({
        id: nextId('e', story), sceneId: scene.id, clock: { ...story.clock }, placeId: m.place, text: clip(m.news, 220),
        importance: m.last ? 3 : 2, reach: 'public', actors: [], witnesses: [], told: [], front: m.front.id, ...(m.also.length ? { also: m.also } : {}),
      });
    }
  }

  private record(scene: Scene, e: Pick<GameEvent, 'text' | 'importance' | 'reach' | 'actors' | 'witnesses'> & { bond?: GameEvent['bond'] }): GameEvent {
    const event: GameEvent = { id: nextId('e', this.story), sceneId: scene.id, clock: { ...this.story.clock }, placeId: scene.placeId, told: [], ...e };
    this.story.events.push(event);
    return event;
  }

  // ---------- Bonds ----------

  private bond(who: string, tier: BondTier, value: 'touches' | 'offends' | null, text: string, notes: Note[], scene: Scene): void {
    const p = this.person(who);
    if (!p || p.count > 1) return;
    const day = this.story.clock.day;
    const small = p.smallGains.day === day ? p.smallGains.points : 0;
    // An act that matters, done for someone who holds a grievance, is the amends: the grievance is settled, and the act counts in full.
    const settles = !!p.grievance && value !== 'offends' && (tier === 'significant' || tier === 'major' || tier === 'defining');
    if (settles) {
      p.grievance = null;
      notes.push({ kind: 'company', who, text: tl(this.lang, 'You made amends with {name}: what they held against you is settled', { name: p.name }), tone: 'good' });
    }
    const change = applyBond({ bond: p.bond, openGrievance: !!p.grievance, smallGainsToday: small }, { tier, touchesValue: value === 'touches', offendsValue: value === 'offends' });
    p.smallGains = { day, points: change.smallGainsToday };
    if (change.delta === 0) return;
    p.bond = change.after;
    // A serious wrong is held against the protagonist until amends are made: gains are halved and the next stage is out of reach.
    if ((tier === 'betrayal' || tier === 'broken_promise') && change.delta < 0 && !p.grievance) {
      p.grievance = clip((text || tl(this.lang, 'a wrong you did them')).replace(/[.\s]+$/, ''), 120);
      notes.push({ kind: 'company', who, text: tl(this.lang, '{name} holds this against you. Until you make amends, the bond grows at half speed and cannot reach its next stage', { name: p.name }), tone: 'bad' });
    }
    // Every change has a memory behind it. Those present saw it.
    const witnesses = scene.cast.filter((id) => id !== who && (this.person(id)?.count ?? 2) === 1 && this.person(id)?.tier !== 'extra');
    this.record(scene, {
      text: clip(text || tl(this.lang, 'Something passed between you and {name}.', { name: p.name }), 200), importance: Math.abs(change.delta) >= 8 ? 3 : Math.abs(change.delta) >= 3 ? 2 : 1,
      reach: 'secret', actors: [who], witnesses, bond: { who, delta: change.delta, after: change.after, tier },
    });
    notes.push({ kind: 'bond', who, delta: change.delta, after: change.after, stage: change.stageAfter, newStage: change.newStage });
    if (change.newStage) {
      p.pendingMoment = change.stageAfter;
      notes.push({ kind: 'moment', who });
    }
  }

  // ---------- Fights ----------

  private fighterOf(p: Person): NewCombatant | null {
    const f = p.fight;
    if (!f) return null;
    return {
      id: p.id, name: p.count > 1 ? p.name : p.short || p.name, side: p.inParty ? 'you' : 'foe', fights: f.fights,
      strength: f.strength, skill: f.skill, armor: f.armor, firepower: f.firepower, ranged: f.ranged, hp: f.hp, count: p.count,
      // A power of their own, in a world of gifts: used with their attack on some of their turns.
      ...(p.power && p.count === 1 && this.story.world.rules.powers === 'gift' && powerFree(p, this.scene.id) ? { power: { name: p.power.name, effect: powerEffect(p.power) } } : {}),
    };
  }

  private startFight(scene: Scene, foeIds: string[]): void {
    const story = this.story;
    const p = story.protagonist;
    const s = p.sheet;
    const mode = story.world.rules.powers;
    const command = commandOf(s, mode);
    const moves = command.filter((a) => a.own);
    const hero: NewCombatant = {
      id: YOU, name: p.name, side: 'you', isProtagonist: true, strength: s.strength, skill: s.skill, armor: s.armor, firepower: s.firepower,
      // Whoever is better at range fights at range.
      ...(fightsAtRange(s) ? { ranged: true } : {}),
      hp: s.hp, hpMax: maxHp(s), quick: s.advantages.includes('Quick Reflexes'), energy: s.energy,
      abilities: command.map((a) => a.id),
      costs: Object.fromEntries(command.map((a) => [a.id, abilityCost(a, mode)])),
      // The moves of a gift are not in the library: the fighter carries what each one is.
      ...(moves.length ? { own: Object.fromEntries(moves.map((a) => [a.id, a])) } : {}),
    };
    const allies = Object.values(story.world.people).filter((x) => x.inParty).map((x) => this.fighterOf(x)).filter((x): x is NewCombatant => !!x);
    const foes = foeIds.map((id) => this.person(id)).filter((x): x is Person => !!x).map((x) => this.fighterOf(x)).filter((x): x is NewCombatant => !!x);
    if (foes.length === 0) return;
    // Tune the fight to the table style before anyone describes it: play it a few hundred times in
    // code (no tokens), and if the player's side wins too rarely, thin the opposition.
    const band = ODDS_BAND[story.settings.style];
    const probe: Rng = { state: (this.rng.state ^ 0x9e3779b9) >>> 0 };
    let odds = winChance([hero, ...allies, ...foes], probe, 240);
    for (let i = 0; i < 4 && odds < band; i++) {
      const group = [...foes].sort((a, b) => (b.count ?? 1) - (a.count ?? 1))[0];
      // A group is thinned, but never to a "group" of one; after that the opposition is made less hardy.
      if (group && (group.count ?? 1) > 2) group.count = (group.count ?? 1) - 1;
      else { const tough = [...foes].sort((a, b) => b.hp - a.hp)[0]; if (tough) tough.hp = Math.max(1, tough.hp - 2); }
      odds = winChance([hero, ...allies, ...foes], probe, 240);
    }
    const { combat, events } = startCombat([hero, ...allies, ...foes].map(makeCombatant), this.rng);
    scene.combat = combat;
    scene.fightLead = events;
    scene.odds = odds;
    scene.stats.inDanger = true;
  }

  /** The player's action when a fight button chose it: shown as what they did, and read by the narrator as what they said. In the story's language. */
  private combatText(action: CombatAction, c: Combat): string {
    const l = this.lang;
    const target = 'target' in action && action.target ? c.fighters[action.target]?.name ?? tl(l, 'them') : '';
    switch (action.type) {
      case 'attack': return tl(l, 'I attack {target}.', { target: article(target, l) });
      case 'defend': return tl(l, 'I keep my guard up and watch for an opening.');
      case 'ability': {
        const known = this.heroPower(action.ability);
        const ability = known ? this.powerName(known) : tl(l, 'an ability');
        return target ? tl(l, 'I use {ability} on {target}.', { ability, target: article(target, l) }) : tl(l, 'I use {ability}.', { ability });
      }
      // Never a button: an invented effect is always typed, and what was typed is shown.
      case 'effect': return tl(l, 'I try something of my own.');
      case 'item': return tl(l, 'I use {item}.', { item: action.item });
      case 'flee': return tl(l, 'I try to get away.');
    }
  }

  /**
   * What typed text does in a fight, from the referee's reading of it: the nearest fight action.
   * Null when it was a power that cannot be used now: `notice` says why and the round is not spent.
   */
  private fightActionFrom(r: RefereeOut, text: string, scene: Scene, beats: Beat[]): CombatAction | null {
    const c = this.combat!;
    const foes = Object.values(c.fighters).filter((f) => f.side === 'foe' && isUp(f));
    const named = r.targets.map((id) => c.fighters[id]).find((f) => f && f.side === 'foe' && isUp(f));
    const target = named ?? foes[0];
    if (r.kind === 'ability' && r.ability && this.heroPower(r.ability)?.combat) return { type: 'ability', ability: r.ability, target: target?.id };
    // An effect of the player's own: it does what its reach does in a fight, for energy and a test.
    if (r.kind === 'ability' && r.improvise) {
      const made = this.inventedAction(r, text, c, target, scene, beats);
      if (made !== 'plain') return made;
    }
    if (/\b(flee|run|escape|get away|retreat)\b/i.test(text) || r.kind === 'move') return { type: 'flee' };
    if (r.kind === 'fight' && target) return { type: 'attack', target: target.id };
    if (/\b(attack|strike|stab|cut|hit|shoot)\b/i.test(text) && target) return { type: 'attack', target: target.id };
    return { type: 'defend' };
  }

  /**
   * One player action in a fight, and everything that follows until the player is up again.
   * Returns false when the rules refused the action: nothing happened, the player has been told why
   * (`notice`), and there is no round to narrate.
   */
  private fightRound(sp: Extract<Special, { type: 'combat' | 'down' }>, scene: Scene, beats: Beat[], lines: string[], hints: MockHints): boolean {
    const story = this.story;
    const p = story.protagonist;
    const c = scene.combat;
    if (!c) return false;
    const lead = scene.fightLead;
    let events: CombatEvent[] = lead ?? [];
    scene.fightLead = undefined;
    const fightNotes: Note[] = [];
    try {
      if (sp.type === 'combat') {
        const a = sp.action;
        if (a.type === 'item') {
          const item = p.items.find((i) => i.id === a.item || i.name === a.item);
          if (item && item.qty > 0) { item.qty -= 1; if (item.qty === 0) p.items = p.items.filter((i) => i !== item); }
        }
        events = [...events, ...act(c, a, this.rng)];
      } else {
        if (sp.choice === 'destiny') p.destiny -= 1;
        const softenAvailable = story.softenUsed !== story.chapter.n;
        const out = resolveDown(c, sp.choice, { resistance: p.sheet.resistance, style: story.settings.style, softenAvailable }, this.rng);
        if (out.softened) story.softenUsed = story.chapter.n;
        events = [...events, ...out.events];
        if (out.outcome === 'back_up') { lines.push(`${p.name} spends a destiny point and gets back up, hurt but standing.`); fightNotes.push({ kind: 'fight', text: tl(this.lang, 'Destiny point spent: back up with 5 hit points'), tone: 'good' }); }
        if (out.outcome === 'defeated') {
          // What holds a power is the engine's to take or leave: nobody takes it in the telling.
          const kept = p.items.filter((i) => i.kind === 'relic').map((i) => i.name);
          lines.push(`${p.name} is defeated but alive${out.softened ? ' (the death test failed and was softened, as the Adventure style allows once per chapter)' : ''}: they come to later, captured, robbed or left for dead.${kept.length ? ` They still have ${kept.join(' and ')}: whatever else is taken, that is not.` : ''} Tell how it ends here; the next scene picks up afterwards.`);
        }
        if (out.outcome === 'dead') { lines.push(`${p.name} dies here. Tell the end of the story with dignity.`); story.over = 'dead'; }
        if (out.die !== null) fightNotes.push({ kind: 'fight', text: tl(this.lang, 'Death test: rolled {die} against Resistance {resistance}', { die: out.die, resistance: p.sheet.resistance }), tone: out.outcome === 'dead' ? 'bad' : 'plain' });
      }
    } catch (err) {
      // The rules' own reason, in the story's language where the rules have it in words.
      this.notice = err instanceof Error ? cap(this.rule(err.message)) + '.' : tl(this.lang, 'That cannot be done right now.');
      // What happened before the player's first turn has not been told yet: it waits for an action that is taken.
      scene.fightLead = lead;
      return false;
    }

    const told: string[] = [];
    for (const ev of events) this.tellFight(ev, c, beats, fightNotes, told);
    const hero = c.fighters[YOU];
    if (hero) { p.sheet.hp = Math.max(0, hero.hp); p.sheet.energy = hero.energy ?? p.sheet.energy; }

    if (c.over) {
      const foes = Object.values(c.fighters).filter((f) => f.side === 'foe');
      if (c.over === 'won') {
        scene.stats.fightsWon += 1;
        for (const f of foes) {
          const person = this.person(f.id);
          if (!person) continue;
          // What they carried that holds a power is dropped where the fight was, free to take.
          for (const r of dropRelics(story, person.id, scene.placeId)) told.push(`${f.name} drops ${r.name} (an ITEM OF POWER: ${r.text}); it lies here now, free for ${p.name} to take.`);
          // A power they took from the protagonist comes back, beaten or fled.
          for (const l of returnPowers(story, person.id)) {
            told.push(`${l.power.name}, the power ${f.name} took from ${p.name}, comes back to ${p.name}: it is theirs again.`);
            fightNotes.push({ kind: 'fight', text: tl(this.lang, '{power} is yours again.', { power: l.power.name }), tone: 'good' });
            this.tellPower(`${p.name}'s ${l.power.name} came back to them in this scene.`, l.nature ? OWN_POWER : l.art!.id);
          }
          sendAway(story, person, 'left', tl(this.lang, 'beaten in a fight with you'));
        }
        const names = foes.length ? listOf(foes.map((f) => f.name), this.lang) : tl(this.lang, 'them');
        this.record(scene, { text: tl(this.lang, 'You fought {names} and won.', { names }), importance: 3, reach: 'local', actors: foes.map((f) => f.id), witnesses: scene.cast.filter((id) => this.person(id)?.inParty) });
      } else if (c.over === 'lost' && !story.over) {
        p.sheet.hp = 1;
        // Beaten by someone whose power steals: they take a power of the protagonist's.
        const thief = thiefIn(story, c, scene.id);
        const taken = thief ? robPower(story, thief) : null;
        if (thief && taken) {
          told.push(taken.erased
            ? `As ${p.name} lies beaten, ${thief.name} tears out their power, ${taken.power.name}, and destroys it: it is gone for good. Show it.`
            : `As ${p.name} lies beaten, ${thief.name} takes their power, ${taken.power.name}, for their own: ${p.name} no longer has it. It is ${thief.name}'s to hold until ${thief.name} is beaten or dies. Show it.`);
          fightNotes.push({ kind: 'fight', text: taken.erased
            ? tl(this.lang, '{name} destroyed {power}: it is gone for good.', { name: thief.name, power: taken.power.name })
            : tl(this.lang, '{name} took {power} from you. Beat them, or outlive them, and it comes back.', { name: thief.name, power: taken.power.name }), tone: 'bad' });
          if (taken.thread) fightNotes.push({ kind: 'thread', title: story.threads.find((t) => t.id === taken.thread)!.title, text: tl(this.lang, 'New') });
          this.record(scene, { text: taken.erased ? tl(this.lang, '{name} destroyed your power, {power}.', { name: thief.name, power: taken.power.name }) : tl(this.lang, '{name} took your power, {power}.', { name: thief.name, power: taken.power.name }), importance: 3, reach: 'local', actors: [thief.id], witnesses: scene.cast.filter((id) => this.person(id)?.inParty) });
        }
        this.pass(120);
      }
      scene.cast = scene.cast.filter((id) => this.person(id)?.placeId !== 'nowhere');
      told.push(c.over === 'won' ? 'The fight is over: the opponents are down or gone.' : c.over === 'fled' ? `${p.name} got away; the fight is over.` : 'The fight is over.');
      hints.fightOver = c.over;
    } else if (c.awaiting === 'down') {
      // Remembered: a discipline that is not taught can awaken in this scene or the next.
      p.downIn = scene.id;
      told.push(`${p.name} is down at 0 hit points. Describe the fall and stop there: the player now chooses what happens.`);
    }
    if (fightNotes.length) beats.push({ type: 'notes', notes: fightNotes });
    lines.push(`fight, round ${c.round}: ${told.join(' ')}`);
    lines.push('Tell this round in two to four sentences, whatever the number of fighters. No numbers.');
    hints.fight = told;
    return true;
  }

  private tellFight(ev: CombatEvent, c: Combat, beats: Beat[], notes: Note[], told: string[]): void {
    const story = this.story;
    const nm = (id: string) => (id === YOU ? story.protagonist.name : c.fighters[id]?.name ?? id);
    const state = (id: string) => { const f = c.fighters[id]; return f ? conditionLabel(f).toLowerCase() : ''; };
    // The same, in the story's language, for the notes the player reads. The engine words it in English.
    const l = this.lang;
    const shown = (id: string) => {
      const f = c.fighters[id];
      if (!f || l === 'en') return state(id);
      const label = conditionLabel(f);
      return (label === condition(f) ? tl(l, label) : tl(l, '{count} of {countMax} standing', { count: f.count, countMax: f.countMax })).toLowerCase();
    };
    const plural = (id: string) => (c.fighters[id]?.countMax ?? 1) > 1;
    switch (ev.type) {
      case 'attack': {
        const byYou = ev.actor === YOU;
        const onYou = ev.target === YOU;
        const hit = ev.damage > 0;
        const crit = ev.critAttack ? ' with a telling blow' : ev.critDefence ? ', turned aside cleanly' : '';
        const many = (c.fighters[ev.actor]?.countMax ?? 1) > 1;
        const targets = (c.fighters[ev.target]?.countMax ?? 1) > 1;
        told.push(`${nm(ev.actor)} ${many ? 'attack' : 'attacks'} ${nm(ev.target)}: ${hit ? `${many ? 'hit' : 'hits'}${crit}; ${nm(ev.target)} ${targets ? `are now ${state(ev.target)}` : `is now ${ev.targetCondition.toLowerCase()}`}` : `${many ? 'miss' : 'misses'}${crit}`}.`);
        if (byYou || onYou) {
          beats.push({ type: 'attack', event: ev, attacker: nm(ev.actor), target: nm(ev.target), byYou, onYou });
          story.rolls.push({ n: story.totals.turns + 1, clock: { ...story.clock }, placeId: this.scene.placeId, result: ev, label: byYou ? `attack on ${nm(ev.target)}` : `defence against ${nm(ev.actor)}`, who: nm(ev.actor), byYou });
        } else {
          // The notes are the player's, in the story's language; `told` above is the narrator's, in English.
          const vars = { who: nm(ev.actor), target: nm(ev.target), state: shown(ev.target) };
          const text = hit ? (many ? tl(l, '{who} hit {target} · {state}', vars) : tl(l, '{who} hits {target} · {state}', vars))
            : many ? tl(l, '{who} miss {target}', vars) : tl(l, '{who} misses {target}', vars);
          notes.push({ kind: 'fight', text, tone: c.fighters[ev.actor]?.side === 'you' ? 'good' : 'bad' });
        }
        break;
      }
      case 'defend': told.push(`${nm(ev.actor)} holds back and guards.`); break;
      case 'ability': {
        const a = this.heroPower(ev.ability);
        // A move is the player's own: the narrator is given its words with what it did.
        told.push(`${nm(ev.actor)} uses ${a?.name ?? ev.ability}${a?.own && a.text ? `, a move of their own power ("${a.text}")` : ''}: ${ev.effect}.`);
        notes.push({ kind: 'fight', text: `${a ? this.powerName(a) : ev.ability} · ${this.effectWords(ev, a?.combat, c)}`, tone: 'good' });
        break;
      }
      case 'power': {
        // Someone's own power, used just before their attack: the narrator is given what it is, the player what it did.
        const theirs = this.person(ev.actor)?.power;
        told.push(`${nm(ev.actor)} uses a power of their own, ${ev.name}${theirs?.text ? ` (${theirs.text})` : ''}: ${ev.effect}.`);
        notes.push({ kind: 'fight', text: `${nm(ev.actor)} · ${ev.name} · ${this.effectWords(ev, undefined, c, nm(ev.actor))}`, tone: c.fighters[ev.actor]?.side === 'you' ? 'good' : 'bad' });
        break;
      }
      case 'effect': {
        // An effect of the player's own invention: the test was rolled before the round, and this is what came of it.
        told.push(`${nm(ev.actor)} tries ${ev.name}, as the player described. ${ev.worked ? `It works: ${ev.effect}.` : 'It does not come off, and the moment is lost.'}`);
        // A use with no fight effect of its own (a power copied or taken) was told to the player when it was settled.
        if (ev.worked && ev.did) notes.push({ kind: 'fight', text: this.effectWords(ev, undefined, c), tone: 'good' });
        else if (!ev.worked) notes.push({ kind: 'fight', text: tl(l, 'It does not come off: the moment is lost'), tone: 'bad' });
        break;
      }
      case 'item': told.push(`${nm(ev.actor)} uses ${ev.item}.`); notes.push({ kind: 'fight', text: tl(l, '{item} · {n} hit points back', { item: cap(ev.item), n: ev.healed }), tone: 'good' }); break;
      case 'flee': {
        const many = plural(ev.actor);
        const who = nm(ev.actor);
        told.push(ev.success ? `${nm(ev.actor)} ${many ? 'break away and run' : 'breaks away and runs'}.` : `${nm(ev.actor)} tries to get away and cannot.`);
        const text = ev.success ? (ev.actor === YOU ? tl(l, '{who} got away', { who }) : many ? tl(l, '{who} run', { who }) : tl(l, '{who} runs', { who }))
          : ev.die ? tl(l, '{who} could not get away (rolled {die})', { who, die: ev.die }) : tl(l, '{who} could not get away', { who });
        notes.push({ kind: 'fight', text, tone: ev.actor === YOU ? (ev.success ? 'good' : 'bad') : 'good' });
        break;
      }
      case 'skip': told.push(`${nm(ev.actor)} ${plural(ev.actor) ? 'are off balance and lose' : 'is off balance and loses'} the moment.`); notes.push({ kind: 'fight', text: plural(ev.actor) ? tl(l, '{who} lose the action', { who: nm(ev.actor) }) : tl(l, '{who} loses the action', { who: nm(ev.actor) }), tone: 'plain' }); break;
      case 'down': if (ev.who !== YOU) { told.push(`${nm(ev.who)} ${plural(ev.who) ? 'are' : 'is'} down.`); notes.push({ kind: 'fight', text: plural(ev.who) ? tl(l, '{who} are down', { who: nm(ev.who) }) : tl(l, '{who} is down', { who: nm(ev.who) }), tone: c.fighters[ev.who]?.side === 'foe' ? 'good' : 'bad' }); } break;
      case 'initiative': told.push(`Order of action: ${ev.order.map((o) => nm(o.id)).join(', ')}.`); break;
      case 'round': case 'end': break;
    }
  }

  /**
   * What an ability, a move or an invented effect did in a fight, for the player's note. The engine
   * words it in English (the narrator is told that); another language words it again from the effect
   * as it was applied, or from the ability's own for a fight saved before that was recorded.
   */
  private effectWords(ev: { effect: string; did?: CombatEffect; target?: string }, fallback: CombatEffect | undefined, c: Combat, /** Whose it was, when not the protagonist's. */ by?: string): string {
    const l = this.lang;
    const effect = ev.did ?? fallback;
    if (l === 'en' || !effect) return ev.effect;
    const target = ev.target ? c.fighters[ev.target]?.name : undefined;
    switch (effect.type) {
      case 'guard': return by ? tl(l, '+{value} to {name}’s defence until their next turn', { value: effect.value, name: by }) : tl(l, '+{value} to defence until your next turn', { value: effect.value });
      case 'heal': return tl(l, '{value} hit points restored', { value: effect.value });
      case 'stagger': return target ? tl(l, '{target} loses the next action', { target }) : ev.effect;
      case 'dazzle': return target ? tl(l, '{target} attacks at -{value} next', { target, value: effect.value }) : ev.effect;
      case 'damage': return target ? tl(l, '{value} damage to {target}', { target, value: effect.value }) : ev.effect;
      case 'seal': return ev.target === YOU
        ? tln(l, effect.turns, 'You cannot use a power on your next turn', 'You cannot use a power for your next {n} turns')
        : target ? tln(l, effect.turns, '{target} cannot use a power on their next turn', '{target} cannot use a power for their next {n} turns', { target }) : ev.effect;
    }
  }

  // ---------- The narrator ----------

  private async narrate(prepared: Prepared): Promise<void> {
    const story = this.story;
    const scene = this.scene;
    this.blocker = null;
    this.phase = 'writing';
    if (!this.abort) this.abort = new AbortController();
    if (!this.live) this.live = { text: prepared.input.clarifies?.original ?? prepared.input.text, to: prepared.input.to };
    // The dice were rolled before the narrator was asked: show them at once, ahead of the telling.
    this.live.beats = prepared.beats;
    this.emit();
    try {
      const engineNote = ['ENGINE', ...prepared.lines].join('\n');
      // Another take may carry the player's note on the telling: sent with this request only, never kept in the transcript.
      const sent = prepared.note ? `${engineNote}\n${prepared.note}` : engineNote;
      const req = narratorRequest(story, scene, { userText: prepared.userText, engineNote: sent, opening: prepared.opening }, this.deps.models(), prepared.hints);
      let received = '';
      const res = await this.call('narrator', () => this.deps.transport.send(req, {
        signal: this.abort?.signal,
        onText: (delta) => {
          received += delta;
          // The first passage goes on screen once, whole, the moment its last paragraph is complete.
          // What arrives after it is not shown: it waits for Continue.
          if (!this.live || this.live.first) return;
          const first = firstPassageSoFar(received, this.deps.paging());
          if (first) { this.live.first = first; this.emit(); }
        },
      }), prepared.usage);

      if (res.refusal) {
        // The model declined. The turn never becomes part of the story; the action goes back to the player.
        this.phase = 'idle';
        this.abort = null;
        this.blocker = { kind: 'refusal' };
        if (this.live) this.live.first = undefined;
        this.emit();
        return;
      }
      await this.keep(prepared, res.text.trim(), engineNote);
    } catch (err) {
      this.fail(err);
    }
  }

  /**
   * The narrator's reply becomes part of the story: its facts are applied, the turn is recorded, and the
   * scene ends if the story moved on. Also how another take, or an earlier one chosen again, is kept.
   */
  private async keep(prepared: Prepared, reply: string, engineNote: string): Promise<void> {
    const story = this.story;
    const scene = this.scene;
    {
      const parsed = parseReply(reply);
      const beats = [...prepared.beats, ...this.storyBeats(parsed.parts)];
      // The story as the engine left it, before the telling: another take starts again from here.
      const told = JSON.stringify(story);
      this.told = told;
      // Someone the protagonist had never heard of was named in the telling: now they have.
      for (const p of unknownNamedIn(story, parsed.parts.map((part) => part.text).join(' '))) delete p.unknown;
      const notes: Note[] = [];
      const follow = this.applyFlags(parsed.flags, prepared, scene, notes);
      if (notes.length) beats.push({ type: 'notes', notes });
      for (const fn of prepared.after) fn();

      story.totals.turns += 1;
      story.lastPlayed = this.deps.now();
      // Another take: every telling is kept on the turn, and what each cost is the turn's.
      const again = this.retaking;
      const usage = again ? [...again.usage, ...prepared.usage] : prepared.usage;
      const turn: Turn = {
        n: story.totals.turns, input: prepared.input.clarifies?.original ?? prepared.input.text, to: prepared.input.to, clock: { ...story.clock },
        beats, groups: groupBeats(beats, this.deps.paging()), userText: prepared.userText, engineNote, reply,
        usage, cost: usage.reduce((sum, u) => sum + u.cost, 0), suggestions: parsed.flags.suggestions,
        prep: { engine: prepared.beats.length, opening: prepared.opening, moved: prepared.moved, ...(prepared.wait ? { wait: prepared.wait } : {}) },
        ...(again ? { takes: again.takes.includes(reply) ? again.takes : [...again.takes, reply] } : {}),
      };
      scene.turns.push(turn);
      if (this.live) this.live.kept = true;
      this.shown = this.deps.paging() ? 1 : Infinity;

      // A scene ends when the story moves on, pauses, or its transcript has grown past its limit.
      const tooLong = transcriptChars(scene) > SCENE_MAX_CHARS;
      if (!this.combat && !story.over && (follow.moveTo || follow.endScene || tooLong)) {
        const extra: UsageEntry[] = [];
        const closing = await this.closeScene(scene, extra);
        if (closing.length) {
          const tail = turn.beats[turn.beats.length - 1];
          if (tail?.type === 'notes') tail.notes.push(...closing);
          else turn.beats.push({ type: 'notes', notes: closing });
        }
        turn.usage.push(...extra);
        turn.cost += extra.reduce((sum, u) => sum + u.cost, 0);
        if (follow.moveTo) {
          const route = routeBetween(story, scene.placeId, follow.moveTo);
          if (route) this.pass(route.minutes);
          // The narrator let them go to a place that is only a sketch: it is written before the scene there opens.
          const filled: Note[] = [];
          await this.fillIn(follow.moveTo, turn.usage, filled);
          if (filled.length) {
            const tail = turn.beats[turn.beats.length - 1];
            if (tail?.type === 'notes') tail.notes.push(...filled);
            else turn.beats.push({ type: 'notes', notes: filled });
            turn.cost = turn.usage.reduce((sum, u) => sum + u.cost, 0);
          }
        }
        startScene(story, follow.moveTo ?? scene.placeId);
      }
      // What the turn changed, written backwards and kept with it: rewinding is made of these.
      // Changes made between turns before this one are cleared here, so that this record puts them
      // back when the turn is undone (see `between`).
      delete story.pendingUndo;
      turn.undo = this.snapshot ? undoOf(JSON.parse(this.snapshot), story) : undefined;
      // And what the telling changed, for another take: taking it off gives the story as the engine left it.
      turn.flagsUndo = undoOf(JSON.parse(this.told ?? told), story);
      this.putAway();
      this.settle();
    }
  }

  // ---------- Another take ----------

  /**
   * Why the newest turn cannot be told again right now, or null when it can. Only the newest turn of the
   * scene being played, while nothing has changed since it (between turns), and never under the Brutal
   * style more than once a scene.
   */
  get retakeBlock(): 'busy' | 'none' | 'old' | 'changed' | 'brutal' | null {
    const story = this.story;
    if (this.busy || this.blocker || story.over) return 'busy';
    const turn = this.lastTurn;
    if (!turn) return 'none';
    if (!turn.prep || turn.flagsUndo === undefined || !turn.undo || turn.n !== story.totals.turns) return 'old';
    if (story.pendingUndo?.length) return 'changed';
    if (story.settings.style === 'brutal' && this.scene.turns.some((t) => t !== turn && (t.takes?.length ?? 0) > 1)) return 'brutal';
    if (story.settings.style === 'brutal' && (turn.takes?.length ?? 0) > 1) return 'brutal';
    return null;
  }

  /** The story as it stood before the newest turn (for its new record), and as the engine left it before the telling. */
  private beforeTelling(turn: Turn): { before: Story; told: Story } | null {
    try {
      const before = applyUndo(structuredClone(this.story), turn.undo!);
      const told = turn.flagsUndo ? applyUndo(structuredClone(this.story), turn.flagsUndo) : structuredClone(this.story);
      return { before, told };
    } catch {
      return null;
    }
  }

  /** What another take of a turn needs: the same action, the same results, the same telling instructions. */
  private preparedFrom(turn: Turn, note: string): Prepared {
    const input: Input = { text: turn.input, to: turn.to };
    const prep = turn.prep!;
    const beats = turn.beats.slice(0, prep.engine);
    const hints = { ...this.hints(input, this.scene), opening: prep.opening, take: (turn.takes?.length ?? 1) };
    const check = beats.find((b): b is Extract<Beat, { type: 'check' }> => b.type === 'check');
    if (check) { hints.outcome = check.result.outcome; hints.checkLabel = check.result.label; }
    return {
      input, userText: turn.userText, beats, lines: turn.engineNote.split('\n').slice(1), opening: prep.opening, hints, usage: [], moved: prep.moved, after: [], ...(prep.wait ? { wait: prep.wait } : {}),
      ...(note.trim() ? { note: `retake: the player asked for this turn to be told again. Their note on the telling, about how it is told and never about what succeeds: "${clip(note.trim(), 200)}"` } : { note: 'retake: the player asked for this turn to be told again, differently: the same results, told afresh.' }),
    };
  }

  /**
   * Tell the newest turn again: the same action, the same dice, the same results, a new telling. One
   * request to the narrator, which reads the scene from the cache as the turn did. Every telling is kept
   * on the turn, and the player may go back to one with `useTake`. `note` is the player's word on how it
   * should be told ("shorter", "Mira wouldn't laugh here"); it is sent once and not kept.
   */
  async anotherTake(note = ''): Promise<void> {
    if (this.retakeBlock) return;
    const { budget } = this.deps;
    if (budget.spentToday() >= budget.cap()) {
      this.blocker = { kind: 'budget', spent: budget.spentToday(), cap: budget.cap() };
      this.emit();
      return;
    }
    const turn = this.lastTurn!;
    const states = this.beforeTelling(turn);
    if (!states) return;
    this.startTake(turn, states);
    const prepared = this.preparedFrom(turn, note);
    this.prepared = prepared;
    this.failed = prepared.input;
    await this.narrate(prepared);
  }

  /** Go back to another telling of the newest turn that was already received: nothing is asked of the narrator. */
  async useTake(index: number): Promise<void> {
    const turn = this.lastTurn;
    const reply = turn?.takes?.[index];
    if (!turn || reply === undefined || reply === turn.reply) return;
    if (this.retakeBlock && this.retakeBlock !== 'brutal') return;
    const states = this.beforeTelling(turn);
    if (!states) return;
    this.startTake(turn, states);
    const prepared = this.preparedFrom(turn, '');
    try {
      this.phase = 'writing';
      this.emit();
      await this.keep(prepared, reply, turn.engineNote);
    } catch (err) {
      this.fail(err);
    }
  }

  /** The story goes back to how the engine left it before the telling; the turn's tellings and costs wait to be kept with the new one. */
  private startTake(turn: Turn, states: { before: Story; told: Story }): void {
    this.retaking = { takes: turn.takes ?? [turn.reply], usage: turn.usage, restore: JSON.stringify(this.story) };
    this.story = states.told;
    this.snapshot = JSON.stringify(states.before);
    this.told = null;
    this.prepared = null;
    this.failed = null;
    this.notice = null;
    this.beforeJson = null;
    this.beforeStory = null;
    this.live = { text: turn.input, to: turn.to, beats: turn.beats.slice(0, turn.prep!.engine) };
    this.abort = new AbortController();
  }

  // ---------- Finished scenes, and going back ----------

  /**
   * Finished scenes go to storage, and only the scene being played and the one before it keep their
   * transcript in memory. This runs after a turn's undo record is made, never in the middle of a turn:
   * putting a transcript away is housekeeping, not something the story did, and must not appear in a record.
   */
  private putAway(): void {
    const store = this.deps.scenes;
    if (store) putAwayScenes(this.story, (scene) => store.put(this.story.id, scene));
  }

  /** Rewinding is offered in the Story and Adventure styles. Under Brutal, what happened stays. */
  get canRewind(): boolean { return this.story.settings.style !== 'brutal'; }

  /** The points the story can be taken back to: the start of each scene, newest first. */
  rewindPoints(): RewindPoint[] {
    const story = this.story;
    const out: RewindPoint[] = [];
    if (!this.canRewind) return out;
    for (let i = story.scenes.length - 1; i >= 0; i--) {
      const sc = story.scenes[i]!;
      // The turn that brought the protagonist here is the scene's first and is kept: going back to the
      // start of a scene means standing in it, not standing where one was before setting out.
      const first = sc.stored && sc.turns.length === 0 ? sc.stored.from : sc.turns[0]?.n ?? story.totals.turns + 1;
      const keep = sc.openedBy ?? first - 1;
      if (keep < story.rewindFloor) break;
      if (keep < story.totals.turns) out.push({ sceneId: sc.id, keep, drops: story.totals.turns - keep });
    }
    return out;
  }

  /**
   * Take the story back to just after turn `keep`: bonds, hit points, the clock, what is carried, what
   * people know and the dice are all as they were then, and the turns after it are gone. The caller is
   * expected to have kept a copy of the story first (the app does), so nothing is lost. Costs nothing:
   * no request is made. Returns false, leaving the story untouched, when it cannot be done.
   */
  async rewindTo(keep: number): Promise<boolean> {
    if (this.busy || this.blocker || !this.canRewind) return false;
    if (keep < this.story.rewindFloor || keep >= this.story.totals.turns) return false;
    const story = structuredClone(this.story);
    const gone: string[] = [];
    // A turn's record can reach into its own scene and into the one before it (which it may have closed),
    // so both must have their transcripts back before it is applied.
    const load = async (sc: Scene | undefined): Promise<boolean> => {
      if (!sc || !sc.stored || sc.turns.length > 0 || sc.stored.turns === 0) return true;
      const kept = await this.deps.scenes?.get(story.id, sc.id);
      if (!kept) return false;
      sc.turns = kept.turns;
      sc.asides = kept.asides;
      sc.packet = kept.packet;
      return true;
    };
    // What was changed between turns since the newest turn is taken back first, newest change first;
    // and again after each turn is undone, since undoing a turn brings back the changes made before it.
    const drain = () => {
      const list = story.pendingUndo ?? [];
      for (let i = list.length - 1; i >= 0; i--) applyUndo(story, list[i]!);
      delete story.pendingUndo;
    };
    try {
      while (story.totals.turns > keep) {
        drain();
        const n = story.scenes.length;
        if (!(await load(story.scenes[n - 1])) || !(await load(story.scenes[n - 2]))) return false;
        const open = story.scenes[n - 1]!;
        // The newest turn is the last one of the newest scene that has any: a scene opened between turns is still empty.
        const holder = open.turns.length > 0 ? open : story.scenes[n - 2];
        const last = holder?.turns[holder.turns.length - 1];
        if (!last || last.n <= keep) break;
        if (!last.undo) return false; // saved before undo records existed
        const before = story.scenes.map((s) => s.id);
        const turns = story.totals.turns;
        applyUndo(story, last.undo);
        if (story.totals.turns >= turns) return false; // a record that takes nothing back: stop, do not go round again
        // A scene the record opened again is being played, not "in storage": its transcript is the one
        // in memory now, and must not be read back over it.
        for (const sc of story.scenes) if (!sc.ended) delete sc.stored;
        const after = new Set(story.scenes.map((s) => s.id));
        gone.push(...before.filter((id) => !after.has(id)));
      }
      drain();
    } catch {
      return false; // a record that does not fit the story: leave everything as it is
    }
    if (story.totals.turns !== keep) return false;
    const scene = currentScene(story);
    // The scene being played again is open: it is no longer "in storage", and questions asked after the cut are gone with it.
    delete scene.stored;
    if (scene.asides) scene.asides = scene.asides.filter((a) => a.after <= scene.turns.length);
    if (!(await load(story.scenes[story.scenes.length - 2]))) return false;
    this.deps.scenes?.drop(story.id, [...new Set([...gone, scene.id])]);
    story.lastPlayed = this.deps.now();
    this.story = story;
    this.beforeJson = null;
    this.beforeStory = null;
    this.shown = Infinity;
    this.asking = null;
    this.notice = null;
    this.returned = null;
    this.persist();
    return true;
  }

  /**
   * Answer a question the player put to the narrator outside the story. The request reads the scene
   * from the cache and adds nothing to it; the answer is kept beside the scene, never inside its
   * transcript, so the story and what later turns cost are exactly as if nothing had been asked.
   */
  private async answerAside(input: Input, usage: UsageEntry[]): Promise<void> {
    const story = this.story;
    const scene = this.scene;
    this.blocker = null;
    this.phase = 'writing';
    if (!this.abort) this.abort = new AbortController();
    this.live = { text: input.text, to: null, aside: true };
    this.emit();
    const hints: MockHints = { ...this.hints(input, scene), aside: true };
    const req = asideRequest(story, scene, input.text, this.deps.models(), hints);
    // The answer is short and has no passages: it is shown when it is finished, all at once. It is
    // still asked for as a stream, so that Stop can cut it off.
    const res = await this.call('narrator', () => this.deps.transport.send(req, { signal: this.abort?.signal, onText: () => {} }), usage);
    if (res.refusal) {
      this.phase = 'idle';
      this.abort = null;
      this.blocker = { kind: 'refusal' };
      this.emit();
      return;
    }
    const answer = asideAnswer(res.text, this.lang);
    (scene.asides ??= []).push({ after: scene.turns.length, question: input.text, answer, at: this.deps.now(), usage, cost: usage.reduce((sum, u) => sum + u.cost, 0) });
    story.lastPlayed = this.deps.now();
    this.settle();
  }

  /** Apply what the narrator reported. The narrator names what happened; the engine decides the numbers. */
  private applyFlags(f: Flags, prepared: Prepared, scene: Scene, notes: Note[]): { moveTo: string | null; endScene: boolean } {
    const story = this.story;
    const inFight = !!prepared.hints.fight;
    // A journey takes the time its route takes, which was counted when the engine moved the protagonist.
    // A wait lasts what the narrator says it took, up to what the player agreed to (all of it when it says nothing).
    const wait = prepared.wait ?? 0;
    const minutes = prepared.moved ? 0 : Math.min(f.minutes ?? (wait || (inFight ? 1 : 5)), wait || 12 * 60);
    if (minutes > 0) { this.pass(minutes); if (minutes >= 10 && !inFight) notes.push({ kind: 'time', minutes }); }
    if (wait) {
      const p = story.protagonist;
      p.sheet = rest(p.sheet, minutes);
      // The days go by for the world too: a long stay moves it on once more than the end of the scene does.
      if (minutes >= 3 * 1440) this.moveWorld(scene, null, false);
    }

    for (const b of f.bonds) this.bond(b.who, b.tier, b.value, b.text, notes, scene);
    // A situation of the world that was settled is not put in front of the narrator again.
    // (Kept as a list beside the situations, which are never changed: a place filled in later adds situations of its own, and going back in the story must not lose them.)
    for (const id of f.seeds) {
      if (story.world.seeds?.some((s) => s.id === id) && !story.world.settled?.includes(id)) (story.world.settled ??= []).push(id);
    }
    // An item of power taken into the protagonist's hands: only on the terms the world set (lying here
    // once its situation is settled, which may have happened in this very reply, or given by someone Close).
    for (const id of f.got) {
      if (canGet(story, scene, id)) continue;
      const item = takeRelic(story, id);
      const relic = relicOf(story, item ?? undefined);
      if (!item || !relic) continue;
      this.record(scene, { text: tl(this.lang, 'You took {item}.', { item: item.name }), importance: 3, reach: 'local', actors: [], witnesses: scene.cast.filter((x) => this.person(x)?.count === 1) });
      notes.push({ kind: 'info', text: relic.use === 'eaten'
        ? tl(this.lang, 'You have {item}. Eat it, in the story or on the Character screen, and its power is yours for good.', { item: item.name })
        : tl(this.lang, 'You have {item}. Its power, {power}, is yours while you carry it.', { item: item.name, power: relic.power.name }) });
      // The packet of this scene does not have the power: the narrator is told at the next turn.
      if (relic.use === 'carried') this.tellPower(`${story.protagonist.name} has taken ${item.name} since the scene began.`, relic.id);
    }
    // A waiting moment played out: it is recorded as a memory, and no longer waits.
    for (const id of f.moments) {
      const p = this.person(id);
      if (!p?.pendingMoment || !scene.cast.includes(id)) continue;
      const stage = p.pendingMoment;
      // The moment in which they ask for help with what they want: it becomes a thread of the story, theirs.
      if (asksIn(p)) {
        const thread = { id: nextId('t', story), title: clip(`${p.short || p.name}: ${p.wish!.trim()}`, 120), kind: 'personal' as const, status: 'open' as const, next: null, clues: [], since: story.clock.day };
        story.threads.push(thread);
        p.quest = thread.id;
        notes.push({ kind: 'thread', title: thread.title, text: tl(this.lang, 'New') });
      }
      p.pendingMoment = null;
      this.record(scene, { text: tl(this.lang, '{name} opened up to you when your bond reached {stage}.', { name: p.name, stage: this.rule(stage) }), importance: 2, reach: 'secret', actors: [p.id], witnesses: [] });
      notes.push({ kind: 'moment', who: p.id, played: true });
    }
    for (const a of f.attitudes) {
      const p = this.person(a.who);
      if (p) { p.attitude = clip(a.attitude, 28); p.attitudeWhy = a.why ? clip(a.why, 80) : p.attitudeWhy; }
    }
    // A thread's note is "<word>: <the narrator's words>", or the word alone: the screen sets what is before the first colon in bold.
    for (const t of f.threads) {
      const thread = story.threads.find((x) => x.id === t.id);
      if (!thread) continue;
      if (t.op === 'next' && t.text) { thread.next = clip(t.text, 140); scene.stats.threadAdvanced = true; notes.push({ kind: 'thread', title: thread.title, text: tl(this.lang, 'Next: {text}', { text: thread.next }) }); }
      if (t.op === 'clue' && t.text) { thread.clues.push({ text: clip(t.text, 140), day: story.clock.day }); scene.stats.threadAdvanced = true; notes.push({ kind: 'thread', title: thread.title, text: tl(this.lang, 'Clue: {text}', { text: clip(t.text, 140) }) }); }
      if (t.op === 'done') {
        thread.status = 'done'; thread.doneDay = story.clock.day; thread.next = null; scene.stats.threadAdvanced = true;
        notes.push({ kind: 'thread', title: thread.title, text: tl(this.lang, 'Done ((thread))') });
        // A main thread finished is where a chapter turns: it ends with this scene (or once it is long enough to be one).
        if (thread.kind === 'main') story.chapter.mainDone = true;
      }
    }
    for (const title of f.newThreads.slice(0, 2)) {
      story.threads.push({ id: nextId('t', story), title: clip(title, 120), kind: 'small', status: 'open', next: null, clues: [], since: story.clock.day });
      notes.push({ kind: 'thread', title: clip(title, 120), text: tl(this.lang, 'New') });
    }
    for (const pr of f.promises.slice(0, 2)) {
      story.commitments.push({ id: nextId('c', story), text: clip(pr.text, 120), dueLabel: clip(pr.due || tl(this.lang, 'when you can'), 40), dueDay: null, done: false });
      notes.push({ kind: 'promise', text: clip(pr.text, 120) });
    }
    for (const id of f.met) { const p = this.person(id); if (p) p.met = true; }

    // Money and things that changed hands in the story, outside the engine's trades. The narrator names
    // a price word; the rules set the amount. A fortune comes only with something finished in the same reply.
    const l = this.lang;
    if (hasMoney(story.world)) {
      const finished = f.threads.some((t) => t.op === 'done');
      const everyday = (w: Price) => story.settings.style === 'story' && (w === 'trivial' || w === 'cheap');
      for (const x of f.paid.slice(0, 2)) {
        const c = currencyFor(story, x.money) ?? moneyOf(story)[0];
        if (!c || !isPrice(x.price)) continue;
        const n = addMoney(story, c.id, priceIn(x.price === 'fortune' && !finished ? 'dear' : x.price, c));
        notes.push({ kind: 'info', text: x.why.trim() ? tl(l, '+{amount}: {why}', { amount: amountLabel(n, c), why: clip(x.why.trim(), 80) }) : tl(l, '+{amount}', { amount: amountLabel(n, c) }) });
      }
      for (const x of f.spent.slice(0, 2)) {
        const c = currencyFor(story, x.money) ?? moneyOf(story)[0];
        if (!c || !isPrice(x.price) || everyday(x.price)) continue;
        const n = Math.min(payable(story, c), priceIn(x.price, c));
        pay(story, c, n);
        if (n > 0) notes.push({ kind: 'info', text: x.why.trim() ? tl(l, '−{amount}: {why}', { amount: amountLabel(n, c), why: clip(x.why.trim(), 80) }) : tl(l, '−{amount}', { amount: amountLabel(n, c) }) });
      }
    }
    for (const g of f.gained.slice(0, 2)) {
      const item = this.addItem(g.name, g.text);
      if (item) notes.push({ kind: 'info', text: tl(l, 'You now carry {item}.', { item: item.name }) });
    }
    for (const name of f.lost.slice(0, 2)) {
      const k = name.trim().toLowerCase();
      const item = story.protagonist.items.find((i) => i.id === k || i.name.toLowerCase() === k) ?? story.protagonist.items.find((i) => k.length > 2 && i.name.toLowerCase().includes(k));
      // An item of power leaves only by the rules of powers, never by a line of the telling.
      if (!item || item.kind === 'relic') continue;
      this.dropItem(item);
      notes.push({ kind: 'info', text: tl(l, 'You no longer have {item}.', { item: item.name }) });
    }

    if (!inFight && f.fight.length) {
      const foes = f.fight.map((id) => this.person(id)).filter((x): x is Person => !!x && !x.inParty && !!x.fight?.fights && scene.cast.includes(x.id));
      if (foes.length) {
        this.startFight(scene, foes.map((x) => x.id));
        notes.push({ kind: 'fight', text: tl(this.lang, 'A fight begins'), tone: 'bad' });
      }
    }
    const moveTo = f.moveTo && routeBetween(story, scene.placeId, f.moveTo) ? f.moveTo : null;
    // Days passing are a break between scenes.
    return { moveTo, endScene: f.endScene || (wait > 0 && minutes >= 1440) };
  }
}

// ---------- Helpers ----------

/** The most different things the protagonist can carry. */
export const ITEMS_MAX = 60;

/** A trade as the referee describes it. */
type TradeOut = NonNullable<RefereeOut['trade']>;

/** How many efforts win a contest, and how many lost ones lose it, by its length and the table style. */
export const CONTEST = { short: 3, long: 5, losses: { story: 4, adventure: 3, brutal: 3 } } as const;

/** A new contest, begun now at a place. */
export function newContest(story: Story, label: string, length: 'short' | 'long', placeId: string): NonNullable<Story['contest']> {
  return { label, goal: CONTEST[length], limit: CONTEST.losses[story.settings.style], wins: 0, losses: 0, placeId, since: { ...story.clock } };
}

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
/** Text cut to a length with its paragraphs kept (clip makes one line of everything). */
function keepParagraphs(text: string, max: number): string {
  const paras = text.split(/\n\s*\n/).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out: string[] = [];
  let used = 0;
  for (const para of paras) {
    if (used + para.length > max) { if (!out.length) out.push(clip(para, max)); break; }
    out.push(para);
    used += para.length + 2;
  }
  return out.join('\n\n');
}
/** Text the player typed themself goes back to the input box when a turn is stopped; a button's or the map's wording does not. */
const typedByPlayer = (input: Input) => !input.special && !input.travelTo;
/** Only the words of an answer given outside the story: no facts and no speaker tags, whatever came back. */
function asideAnswer(text: string, l: Lang): string {
  const words = storyTextSoFar(text).split('\n').map((line) => line.replace(/^@[^:\n]{1,40}:\s*/, '')).join('\n').trim();
  return words || tl(l, 'The narrator had nothing to add.');
}
/** "the knifeman", "Captain Roth". Only English gets an article: in Portuguese it would have to agree with a gender the game does not know, so the name stands alone. */
const article = (name: string, l: Lang) => (l === 'pt' || (/^[A-Z]/.test(name) && !/^(Hooded|Man|Woman|Watch)/.test(name)) ? name : `the ${name.toLowerCase()}`);

/**
 * How a turn's beats are revealed. The action, any dice, and the first passage come at once; after
 * that each passage waits for Continue. Short neighbours are shown together so Continue is never
 * pressed for a single line. Notes arrive with the last passage.
 */
export function groupBeats(beats: Beat[], paging: boolean): number[] {
  if (!paging) return [0];
  const groups = [0];
  let seenStory = false;
  let size = 0;
  beats.forEach((b, i) => {
    if (b.type !== 'narration' && b.type !== 'say') return;
    const len = b.text.length;
    if (seenStory && size >= PASSAGE_MIN_CHARS) { groups.push(i); size = 0; }
    seenStory = true;
    size += len;
  });
  return groups;
}

/** Which combatants to show first when there are many: whoever is up, the hurt before the unhurt. */
export function fightersForDisplay(c: Combat): { yours: Combatant[]; theirs: Combatant[] } {
  const all = Object.values(c.fighters);
  const order = (a: Combatant, b: Combatant) => Number(isUp(b)) - Number(isUp(a)) || a.hp / a.hpMax - b.hp / b.hpMax || a.name.localeCompare(b.name);
  return {
    yours: all.filter((f) => f.side === 'you').sort((a, b) => Number(!!b.isProtagonist) - Number(!!a.isProtagonist) || a.name.localeCompare(b.name)),
    theirs: all.filter((f) => f.side === 'foe').sort(order),
  };
}

export { condition, conditionLabel, slotOf, sceneTitle };
