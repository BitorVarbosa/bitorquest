// The game layer's data: a world, a story played in it, and what has happened so far.
// Plain JSON-serialisable data throughout. A story in memory is its present state plus the transcript
// of the scene being played and the one before it; the transcripts of older scenes are kept in storage
// (SceneArchive) and are read back only to rewind into them or to export the story.
import type { Ancestry, Art, AttackEvent, BondTier, Clock, Combat, CombatEvent, EffectKind, Found, Gift, PowerLevel, PowersMode, Sheet, TableStyle, TestResult, Worked } from '../engine';
import type { Undo } from './patch';

// ---------- World ----------

export type PlaceKind = 'world' | 'region' | 'settlement' | 'district' | 'site' | 'building' | 'room';

/** Places form a tree of any depth (world > region > settlement > district > building > room). */
export interface Place {
  id: string;
  name: string;
  kind: PlaceKind;
  parent: string | null;
  /** One line, for lists and indexes. */
  brief: string;
  /** Two to four lines for the narrator: what it is, what it is like right now. */
  card: string;
  /** Position on the map of its parent, 0 to 100 on each axis. */
  x: number;
  y: number;
  /** What the protagonist knows of it. Hidden places are not shown or sent anywhere. */
  known: 'visited' | 'heard' | 'hidden';
  aliases?: string[];
  /** One line is all there is of it so far: what is inside it is written the first time a story goes there. */
  sketch?: boolean;
}

export interface Route {
  a: string;
  b: string;
  minutes: number;
  /** Something on the way worth a line: "Watch checkpoint; gates close at nightfall". */
  note?: string;
}

export type BondKind = 'friendship' | 'romance' | 'mentorship' | 'rivalry' | 'kinship';

export interface FightStats {
  strength: number;
  skill: number;
  armor: number;
  firepower: number;
  /** Hit points of one member. */
  hp: number;
  ranged?: boolean;
  /** False: present in a fight but stays out of it. */
  fights: boolean;
}

/**
 * A power of a person's own, in a world of gifts: what it is, in words, and the one thing it does in
 * a fight. How much it does there follows from its tier, which the world builder's code sets from how
 * able the person is; no model writes it.
 */
export interface PersonPower {
  name: string;
  /** One line: what it is. */
  text: string;
  /** What it does in a fight. seal: the protagonist's powers stop for a turn. steal: the same, and if they beat the protagonist they take a power of theirs. */
  fight: 'damage' | 'guard' | 'stagger' | 'dazzle' | 'seal' | 'steal';
  /** 1 to 4: what it does in a fight. */
  tier: number;
  /** 1 to 4: how strong it is when someone else holds it (copied or taken). Set by code from how able they are; a power from before this was kept counts as 1. */
  rank?: number;
  /** A power that steals: held, what it takes comes back when the thief is beaten or dies; erased, it is gone for good. */
  keeps?: 'held' | 'erased';
  /** Taken from them for this scene by the protagonist (a steal): they cannot use it until the scene ends. */
  takenIn?: string;
}

/**
 * A discipline, in a world of gifts: a power that many people share and that is taught (Armament Haki,
 * a school of swordsmanship), written by the world. Whoever learns it holds it as a power of their own,
 * at rank 1 with its first move, and raises it with experience. One that is not taught can only awaken.
 */
export interface Discipline {
  id: string;
  name: string;
  /** What it is and what it covers: as a power's text. */
  text: string;
  limit: string;
  /** What it can do in a fight: one or two kinds. */
  kinds: EffectKind[];
  /** The move anyone who learns it is shown first, at tier 1. */
  move: { name: string; text: string; fight?: EffectKind };
  /** False when it cannot be taught: it awakens, if ever, in someone who has been brought down. */
  taught: boolean;
}

/**
 * An item of power, in a world of gifts: something that holds a power, written by the world and found
 * in the story (a fruit that gives a power to whoever eats it, a blade whose power is its holder's while
 * they hold it). As 3D&T's magic items: conquered for free, never invented in play.
 */
export interface Relic {
  id: string;
  name: string;
  /** What it looks like, and what it is said to be: one line. */
  text: string;
  /** eaten: its power becomes the eater's own, for good. carried: its power is its holder's while they hold it. */
  use: 'eaten' | 'carried';
  /** The power it holds, at rank 1 (a great carried item: 2), with one move. */
  power: Gift;
  /** Where it lies, when nobody carries it. */
  placeId?: string;
  /** The named person who carries it. */
  holder?: string;
  /** The situation it belongs to: lying in the world, it can be taken once that situation is settled. */
  seed?: string;
  /** The protagonist has it, or ate it: it is no longer in the world. */
  taken?: boolean;
}

export interface Person {
  id: string;
  name: string;
  /** For narrow places on screen: "Roth". */
  short: string;
  role: string;
  /** One of the persona colours in the stylesheet ("mira", "tobin"...), or "" for neutral. */
  hue: string;
  /** extra: exists for a scene. recurring: has a card and a bond. major: also goals and secrets. */
  tier: 'extra' | 'recurring' | 'major';
  /** Unnamed people of one kind are ONE entry with a count: "Watchmen", 3. */
  count: number;
  /** Who they are and how they talk. One to three lines for the narrator. */
  card: string;
  /** Known only to the narrator, sent only when this person is in the scene. */
  secret?: string;
  placeId: string;
  inParty: boolean;
  pinned: boolean;
  /** The protagonist has met them (otherwise only heard of). */
  met: boolean;
  /** The protagonist has never heard of them: they are listed nowhere until they are met or named in the story. */
  unknown?: boolean;
  /** Ids of the abilities this person practises and could teach, to someone they know well enough. */
  teaches?: string[];
  /** In a world of gifts: the id of a discipline of the world that this person practises, and can teach if it is taught. */
  trains?: string;
  /** They have travelled with the protagonist before: asked again, they come whatever the stage of the bond (unless they hold a grievance). */
  travelled?: boolean;
  /** Off the map for good: they left, or they are dead. `placeId` is then "nowhere". */
  away?: { how: 'left' | 'dead'; why: string; day: number };
  /** Something of their own that they want and cannot manage alone. It is asked of the protagonist when the bond becomes Close, and becomes a personal thread. */
  wish?: string;
  /** The id of the thread their wish became, once they asked. */
  quest?: string;
  kind: BondKind;
  bond: number;
  /** How they feel about the protagonist right now, in a word or two, and why. */
  attitude: string;
  attitudeWhy?: string;
  values: string[];
  /** The values the protagonist has discovered. */
  valuesKnown: string[];
  /** An open grievance: gains are halved and the next stage is out of reach until it is settled. */
  grievance: string | null;
  /** A stage was reached and its scene has not been played yet. */
  pendingMoment: string | null;
  /** Small and meaningful bond points gained on `day`, for the daily limit. */
  smallGains: { day: number; points: number };
  fight?: FightStats;
  /** In a world of gifts: this person's own power, when they have one that matters in a fight. Never for a group. */
  power?: PersonPower;
  aliases: string[];
  /**
   * How they look at a glance, in a few words ("grey fedora, charcoal suit, gold watch"): on their card
   * every time they are in a scene. `card` is then who they are and how they talk (their personality).
   * A person kept before this was kept has neither, and their card says what it says.
   */
  look?: string;
  /** How they look in full, a few sentences: sent the first time the protagonist meets them, then `look` stands in for it. */
  appearance?: string;
}

/** How much one coin of a currency is worth: tiny (a meal costs hundreds), small, common (a meal costs a couple), large, great. */
export type Worth = 'tiny' | 'small' | 'common' | 'large' | 'great';

/** A money of the world. Its worth is a word the builder chose; what that means in numbers is the code's (money.ts). */
export interface Currency {
  id: string;
  /** How an amount of it is written: "silver marks". */
  name: string;
  /** One of it: "silver mark". */
  one: string;
  /** One line: what it is and who takes it. */
  text: string;
  worth: Worth;
  /**
   * Set when this is a coin of the same money as another of the world's (a knut of the galleon): its id.
   * Coins of one money pay for each other at their worth, as change would; separate moneys do not.
   */
  of?: string;
}

/**
 * Something the player kept as true: a line of the story they pinned ("Keep this"), or a correction of
 * something the narrator got wrong ("That's wrong"). It goes on the card of what it is about whenever
 * that is in a scene, and the narrator keeps to it.
 */
export interface Fact {
  id: string;
  /** A person's id, a place's id, or "" for the story as a whole. */
  about: string;
  text: string;
  /** The scene it was kept in, and the story's day. */
  sceneId: string;
  day: number;
  /** A correction of the telling, not a line of it. */
  fixed?: boolean;
}

/**
 * Something that takes several efforts to win and can be lost along the way: a chase, a search, a heist,
 * a debate. Each effort is a test; enough successes win it, too many failures lose it. Only one at a time.
 */
export interface Contest {
  label: string;
  /** Successes needed, and failures allowed before it is lost. */
  goal: number;
  limit: number;
  wins: number;
  losses: number;
  /** Where and when it began. */
  placeId: string;
  since: Clock;
}

export interface Faction {
  id: string;
  name: string;
  standing: string;
}

export interface World {
  id: string;
  name: string;
  /** The single colour that tints the interface for stories in this world. */
  accent: string;
  pitch: string;
  /** Tone, glossary, factions, how the paths work here. Sent as the second system block, rarely changed. */
  core: string;
  /**
   * How people here are named, with example names: read by everyone who names someone new (the
   * builder, the narrator, filling in a place). Names follow the world, not the language the story is
   * told in. A world built before this was kept has none.
   */
  names?: string;
  places: Record<string, Place>;
  routes: Route[];
  people: Record<string, Person>;
  factions: Faction[];
  startPlace: string;
  rules: {
    powers: PowersMode; pathCap: number; style: TableStyle; destinyPerChapter: number;
    /** How many points a character starts with. A world that does not say is played by Champions. */
    level?: PowerLevel;
  };
  /** The peoples a character of this world can belong to. The first is the common one, with no traits. A world with none has only that. */
  ancestries?: Ancestry[];
  /** In a world of gifts: the powers that are taught here, or awaken (four at most). */
  disciplines?: Discipline[];
  /** In a world of gifts: the items of power waiting to be found (two at most). */
  relics?: Relic[];
  /** What is in motion in the world whether or not the protagonist looks. Never shown to the player. */
  fronts?: Front[];
  /** Situations waiting near where the story starts. Never shown to the player; one becomes a thread when the story takes it up. */
  seeds?: Seed[];
  /** Ids of the situations that were settled for good in this story: they are no longer put in front of the narrator. */
  settled?: string[];
  /**
   * The money of this world, the common one first (a new character starts with it). Absent in a world
   * kept before money had names: it then has one, silver. Empty: there is no money in this world.
   */
  money?: Currency[];
  /** How heroes of earlier stories in this world are remembered in it, one line each (three at most). */
  legends?: string[];
}

/** What becomes of one person when something comes to pass without the protagonist: written when the world is built, applied by rule. */
export interface Fate {
  who: string;
  /** moves: they go to stay at `to`. leaves: they are gone from the map. dies: they are dead. */
  then: 'moves' | 'leaves' | 'dies';
  to?: string;
  /** Why, in a few words, as it would be said of them afterwards: "sent away by the wardens". */
  why: string;
}

/** Something moving in the world: a war, a plague, a plot. It advances by stages. */
export interface Front {
  id: string;
  name: string;
  goal: string;
  /** What happens, in order, if nobody stops it. For the narrator alone. */
  stages: string[];
  /** For each stage, what people would see or hear of it when it comes to pass, or null when it happens out of sight. A world built before stages had this has none: its fronts still move, and nothing is said of them. */
  news?: (string | null)[];
  /** How many stages have come to pass. */
  stage: number;
  /** The places where its effects show. */
  touches: string[];
  /** The moment its wait for the next stage is counted from (when it last moved; the start of the story before that). */
  since?: Clock;
  /** The chapter in which it last moved, or was set back: a front moves once a chapter. */
  movedIn?: number;
  /** The protagonist set it back: it does not move before this day. */
  heldUntil?: number;
  /** The protagonist ended it: no further stage comes to pass. */
  stopped?: boolean;
  /** What becomes of people as its stages come to pass: `stage` counts from 1. */
  fates?: (Fate & { stage: number })[];
}

/** A situation waiting to be found: who wants what, what stands in the way, what happens if nobody steps in. */
export interface Seed {
  id: string;
  title: string;
  placeId: string;
  wants: string;
  obstacle: string;
  ifIgnored: string;
  secret: string;
  /** As written by the first build that had situations; `World.settled` holds this now. Still read, never written. */
  over?: boolean;
  /** What people there say once it has come to pass with nobody stepping in. A situation with neither this nor a fate never ends by itself. */
  news?: string;
  /** What becomes of someone when it comes to pass with nobody stepping in. */
  fate?: Fate;
}

/** A world in the library: built once, never changed afterwards. Starting a story copies it. */
export interface WorldTemplate {
  id: string;
  world: World;
  /** Where it came from, in the player's words. */
  source: { kind: 'description' | 'setting' | 'document' | 'sample'; text: string; /** For a document: the file's name. Its text is not kept. */ name?: string };
  /** Who the player meant to play when it was built. Detail was spent around this. */
  premise: string;
  /** The name they gave that character, when they gave one. */
  name?: string;
  /** What the table agreed on when it was built; the defaults for stories started in it. */
  table: Omit<StorySettings, 'style'>;
  /** How its first story opens: a title, the first chapter's title, the thread it starts with, and a line for the narrator. */
  opening: { title: string; chapter: string; thread: string; line: string; /** The hour of the day the first scene opens, 0 to 23. */ hour: number };
  built: number;
  /** What it cost to build, in dollars, and whether that was the demo builder's estimate. */
  cost: number;
  simulated: boolean;
  version: 1;
}

// ---------- Memory ----------

/** Something that happened. What a character knows is the set of events they saw or were told about. */
export interface GameEvent {
  id: string;
  sceneId: string;
  clock: Clock;
  placeId: string;
  /** One sentence, written to the protagonist: "You did not use her as bait at the bridge." */
  text: string;
  /** 1 small, 2 notable, 3 it changed something. */
  importance: 1 | 2 | 3;
  /** secret: only those listed know. local: spreads through the place. public: spreads through the region. */
  reach: 'secret' | 'local' | 'public';
  actors: string[];
  witnesses: string[];
  /** People who were told about it later. */
  told: string[];
  /** Set when this event changed a bond: every bond change has a memory behind it. */
  bond?: { who: string; delta: number; after: number; tier: BondTier };
  /** The player chose to keep this memory in view on the person's profile. */
  kept?: boolean;
  /** Set when this is news of the world moving (a front's stage coming to pass), not something the protagonist did or saw: the front's id. */
  front?: string;
  /** Other places where it happened as well: talk of it starts from each of them, not only from `placeId`. */
  also?: string[];
}

export interface Thread {
  id: string;
  title: string;
  kind: 'main' | 'mystery' | 'personal' | 'small';
  status: 'open' | 'done';
  next: string | null;
  clues: { text: string; day: number }[];
  since: number;
  doneDay?: number;
}

export interface Commitment {
  id: string;
  text: string;
  /** "tonight", "within 3 days of delivery" */
  dueLabel: string;
  dueDay: number | null;
  done: boolean;
}

export interface Item {
  id: string;
  name: string;
  kind: 'quest' | 'gear' | 'consumable' | 'keepsake' | 'relic';
  text: string;
  qty: number;
  /** Hit points restored when used. */
  heal?: number;
  /** An item of power: the id of the world's relic it is (the item's own id is the same). */
  relic?: string;
}

export interface Protagonist {
  name: string;
  line: string;
  ancestry: string;
  level: string;
  sheet: Sheet;
  destiny: number;
  destinyMax: number;
  xp: number;
  xpEarned: number;
  items: Item[];
  /** The amount of the world's first money. Kept in step with `purse`, which says the rest; a story kept before purses has only this. */
  silver: number;
  /** What they carry of each money of the world, by its id. Read it with `purseOf` (money.ts). */
  purse?: Record<string, number>;
  /** How they look at a glance, and in full: as for a person. The player plays their personality. */
  look?: string;
  appearance?: string;
  /** Abilities the protagonist has a source for and has not learned yet: shown by someone, or worked out by trying. */
  found?: Found[];
  /** In a world of gifts: new uses of their own power that worked once and can be kept as moves. The newest last; three at most. */
  worked?: Worked[];
  /** The id of the last scene in which they were brought down in a fight: a discipline that is not taught can awaken in it, or in the next. */
  downIn?: string;
  /** Powers of theirs that someone took from them, and who holds each until it comes back. */
  lost?: LostPower[];
}

/**
 * A power of the protagonist's that someone took (a thief who beat them). It comes back, whole, when
 * the thief is beaten or flees in a fight the protagonist wins, or dies; unless it was erased.
 */
export interface LostPower {
  /** The power as it was: rank, kinds and moves are kept. */
  power: Gift;
  /** It was theirs by nature: its place stays theirs, and no other power by nature can be had meanwhile. */
  nature: boolean;
  /** For a power that was not theirs by nature: where it had come from, to put it back as it was. */
  art?: Omit<Art, 'power'>;
  /** The person who holds it. */
  by: string;
  /** held: it comes back. erased: it is gone for good (and is not kept here). */
  keeps: 'held';
  /** The thread opened to take it back, closed when it comes back. */
  thread?: string;
}

// ---------- The story log ----------

export type Note =
  /** A chapter ended and the next began. */
  | { kind: 'chapter'; n: number; title: string }
  | { kind: 'bond'; who: string; delta: number; after: number; stage: string; newStage: boolean }
  /** A person wants a moment with you; `played` when it has just happened. */
  | { kind: 'moment'; who: string; played?: boolean }
  | { kind: 'xp'; amount: number }
  | { kind: 'time'; minutes: number }
  | { kind: 'thread'; title: string; text: string }
  | { kind: 'promise'; text: string }
  | { kind: 'fight'; text: string; tone: 'bad' | 'good' | 'plain' }
  | { kind: 'info'; text: string; tone?: 'warn' }
  /** Someone joined the party, left it, or is gone from the story. */
  | { kind: 'company'; who: string; text: string; tone: 'good' | 'bad' | 'plain' };

/** One thing shown in the story log. A turn is a list of beats; "Continue" reveals them group by group. */
export type Beat =
  | { type: 'scene'; title: string }
  | { type: 'action'; text: string; to: string | null; /** The answer the player gave when the game asked what they meant. */ clarified?: string }
  | { type: 'narration'; text: string }
  /** `segs`, when present, splits the line into spoken words and gestures in turn, starting with spoken words. */
  | { type: 'say'; who: string; name: string; manner: string | null; text: string; segs?: string[] }
  | { type: 'check'; result: TestResult; opposedBy: string | null }
  | { type: 'attack'; event: AttackEvent; attacker: string; target: string; byYou: boolean; onYou: boolean }
  | { type: 'notes'; notes: Note[] };

export interface UsageEntry {
  at: number;
  role: 'referee' | 'narrator' | 'scribe' | 'architect';
  model: string;
  /** Input tokens billed at the full price. */
  input: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  output: number;
  /** US dollars, by the app's own price table. */
  cost: number;
  /** True when the demo narrator produced this: the numbers are estimates and nothing was charged. */
  simulated: boolean;
}

export interface Turn {
  n: number;
  input: string;
  to: string | null;
  clock: Clock;
  beats: Beat[];
  /** How the beats are grouped for "Continue": indexes where a new group starts. */
  groups: number[];
  /** The player's line as sent to the narrator. */
  userText: string;
  /** What the engine told the narrator this turn (results, cards, recalled memories). */
  engineNote: string;
  /** The narrator's reply, exactly as received. Replayed as plain text; never edited afterwards. */
  reply: string;
  usage: UsageEntry[];
  cost: number;
  suggestions: string[];
  /** Every telling of this turn, in order, once the player has asked for another take: each reply exactly as received. The one kept is the one equal to `reply`. */
  takes?: string[];
  /**
   * What another take needs to tell the turn again with the same results: how many of the beats are the
   * engine's (the action, the dice), whether it opened its scene, and whether the engine moved the
   * protagonist. Absent on turns played before takes existed: they cannot be told again.
   */
  prep?: { engine: number; opening: boolean; moved: boolean; wait?: number };
  /** What applying the narrator's facts changed, written backwards: taking it off gives the story as the engine left it before the telling. */
  flagsUndo?: Undo | null;
  /**
   * Everything this turn changed in the story, written backwards: applied to the story as it is after
   * the turn, it gives the story as it was before it. Null when nothing can be said to have changed;
   * absent on turns saved before the game kept these (such turns cannot be rewound).
   */
  undo?: Undo | null;
}

/**
 * A question the player put to the narrator outside the story, and its answer. It is shown in the
 * log but is never part of what the narrator is sent on later turns, so it cannot change the story
 * and does not disturb the cached beginning of the scene's requests.
 */
export interface Aside {
  /** How many turns the scene had when it was asked: it is shown after that turn. */
  after: number;
  question: string;
  answer: string;
  at: number;
  usage: UsageEntry[];
  cost: number;
}

export interface SceneStats {
  testsPassed: number;
  threadAdvanced: boolean;
  fightsWon: number;
  inDanger: boolean;
}

/** Continuous play in one place with a stable cast. The unit of context: only the current scene is sent. */
export interface Scene {
  id: string;
  n: number;
  chapter: number;
  placeId: string;
  started: Clock;
  /** Everyone present when the scene started (people ids), party first. */
  cast: string[];
  /** The scene packet: the first message of the conversation, frozen when the scene starts. */
  packet: string;
  turns: Turn[];
  /** Questions put to the narrator outside the story during this scene. */
  asides?: Aside[];
  /** Written by the scribe when the scene ends. */
  summary: string | null;
  ended: boolean;
  combat: Combat | null;
  /** What happened in a fight before the player's first turn (opponents who were quicker). Told with the first round. */
  fightLead?: CombatEvent[];
  /** The player side's chance of winning the current fight, found by simulation when it began. */
  odds?: number | null;
  stats: SceneStats;
  /** The number of the turn that opened this scene by taking the protagonist here (a journey). Absent when the scene was opened between turns. */
  openedBy?: number;
  /**
   * Set once the scene has ended and its transcript is in storage: how many turns it held, their
   * numbers, and what they cost. From then on `turns`, `asides` and `packet` may be empty in memory.
   */
  stored?: { turns: number; from: number; to: number; cost: number };
}

/** The transcript of a finished scene, as it is kept in storage. */
export interface SceneArchive {
  sceneId: string;
  turns: Turn[];
  asides?: Aside[];
  packet: string;
}

export interface RollRecord {
  n: number;
  clock: Clock;
  placeId: string;
  result: TestResult | AttackEvent;
  label: string;
  /** The attacker's name for an attack; "" for a test. */
  who: string;
  byYou: boolean;
}

/** A chapter that has ended. Written once, when it ends, and never changed afterwards. */
export interface Chapter {
  n: number;
  title: string;
  /** What happened in it, in a few sentences, addressed to the player as "you". */
  summary: string;
  /** The same in one line, for when the chapter is many chapters back. */
  gist: string;
  fromDay: number;
  toDay: number;
  /** Turns and scenes played in it. */
  turns: number;
  scenes: number;
}

export interface StorySettings {
  style: TableStyle;
  narration: 'short' | 'medium' | 'long';
  /** How plain or how literary the narrator's prose is. */
  prose: 'plain' | 'clear' | 'literary';
  romance: boolean;
  violence: 'mild' | 'moderate' | 'graphic';
  leaveOut: string;
  language: 'en' | 'pt';
  companions: number;
  suggestions: boolean;
  /** Write what is inside a sketched place the first time the story goes there (one request, once). On unless set to false. */
  fillPlaces?: boolean;
  /** ending: the story builds to a final chapter and an epilogue. endless (and a story kept before this): it goes on for as long as it is played. */
  ending?: 'ending' | 'endless';
  /** With an ending: about how many chapters before the final one. */
  length?: 'short' | 'medium' | 'long';
}

export interface Story {
  id: string;
  title: string;
  created: number;
  lastPlayed: number;
  world: World;
  protagonist: Protagonist;
  clock: Clock;
  /** The chapter being played. It ends by rule (chapters.ts), at the end of a scene. */
  chapter: {
    n: number;
    title: string;
    /** How many turns the story had when the chapter began. */
    turnsBefore: number;
    fromDay: number;
    /** A main thread was finished in this chapter: it ends at the next scene end. */
    mainDone?: boolean;
    /** This is the story's final chapter: when it ends, the story ends. */
    final?: boolean;
  };
  /** The chapters that have ended, oldest first. */
  chapters: Chapter[];
  scenes: Scene[];
  events: GameEvent[];
  threads: Thread[];
  commitments: Commitment[];
  /** The chapter being played so far, in a paragraph, rewritten by the scribe at scene ends. Earlier chapters have their own summaries, which are never rewritten. */
  summary: string;
  settings: StorySettings;
  rng: { state: number };
  rolls: RollRecord[];
  totals: { turns: number; cost: number };
  /** The chapter in which the softened death test was last used. */
  softenUsed: number | null;
  /** Set when the story has ended: a death under the Brutal style, or its final chapter came to an end. */
  over?: 'dead' | 'ended';
  /** Written once, when a story with an ending has ended: what became of everyone, and one line to remember the hero by. */
  epilogue?: { text: string; legend: string; at: number; cost: number };
  /** Which season of the story this is: a story that ended and was taken on again is in its second. */
  season?: number;
  /** How many chapters had ended when this season began: its length is counted from there. */
  seasonFrom?: number;
  /** What the player kept as true (see Fact). */
  facts?: Fact[];
  /** Something that takes several efforts, under way (see Contest). */
  contest?: Contest | null;
  /** How the first scene opens, for the narrator. A story that has it and no turns yet can be begun without typing anything. */
  opening?: string;
  /**
   * What was changed between turns since the last one (experience spent, an ability learned, an item
   * used), written backwards, oldest first. A turn's own record puts this list back when the turn is
   * undone, so rewinding takes these changes back as well; see Session.between.
   */
  pendingUndo?: Undo[];
  /**
   * What the narrator must be told at the next turn, because it changed between turns and the packet
   * of the scene being played was written before it did: a power of the protagonist's own that has
   * awakened or grown. Each is a line for the engine's note; they are sent once and then dropped.
   */
  tellNext?: string[];
  /** The dice the world rolls for itself (when things in motion move). Apart from the player's, so that the world moving never changes a roll of theirs. */
  worldDice?: { state: number };
  /** For each situation of the world, the day it was last put in front of the narrator. One left alone long enough comes to pass by itself. */
  seedsSeen?: Record<string, number>;
  /** The chapter in which a situation last came to pass by itself: at most one a chapter does. */
  seedLapsedIn?: number;
  /** The story cannot be taken back further than to just after this turn: where it began, or where the game started keeping undo records for it. */
  rewindFloor: number;
  /** The save format. See save.ts for what changed between versions. */
  version: 3;
}
