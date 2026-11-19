// One interface in front of Claude, with two implementations: the real client (anthropic.ts) and a
// demo client (mock.ts) that answers locally. Both receive exactly the same request object, so the
// demo client exercises the real request layout, including where the cache breakpoints sit.
import type Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import type { ArchitectHints } from './architect';
import type { TokenUsage } from './models';

export type Role = 'referee' | 'narrator' | 'scribe' | 'architect';
export type MessageParams = Anthropic.MessageCreateParamsNonStreaming;

/** Never sent anywhere. Lets the demo client write something that fits the turn. */
export interface MockHints {
  you: string;
  input: string;
  place: string;
  opening: boolean;
  outcome: 'success' | 'cost' | 'forward' | 'fail' | null;
  checkLabel: string | null;
  cast: { id: string; name: string; inParty: boolean; count: number; hostile: boolean }[];
  exits: { id: string; name: string }[];
  abilities: { id: string; name: string }[];
  /** Abilities the character has not learned but could attempt, and ones someone here could teach. */
  attemptable: { id: string; name: string }[];
  teachable: { id: string; name: string; by: string }[];
  /** In a world of gifts: the character's powers, each with its id, name and kinds of fight effect, or null when they have none. Absent in any other world. */
  gift?: { powers: { id: string; name: string; kinds: string[] }[] } | null;
  /** In a world of gifts: items of power the character carries that are eaten, and those where the scene is (which can be taken). */
  eatable?: { id: string; name: string }[];
  relics?: { id: string; name: string }[];
  threads: { id: string; title: string }[];
  /** Lines describing a round of a fight, when the turn is one. */
  fight: string[] | null;
  fightOver: 'won' | 'lost' | 'fled' | null;
  /** The id of a person whose waiting moment may play in this turn. */
  moment: string | null;
  /** The player is asking the narrator something outside the story. */
  aside: boolean;
  /** The player was asked what they meant, and this turn carries their answer. */
  clarified: boolean;
  movedTo: string | null;
  /** The first scene of a story is being opened: the demo narrator begins with a short introduction. */
  begin?: boolean;
  /** The player let time pass: at most this many minutes. The demo narrator tells the stretch. */
  wait?: number;
  /** A picture the player attached is being put into words: what they said it is. */
  picture?: { who: string; note: string };
  /** The epilogue of a story that has ended is being written. */
  epilogue?: boolean;
  /** Another take of a turn: how many tellings it has had. The demo narrator writes something else for each. */
  take?: number;
  /** What is under way that takes several efforts, by its label, or null. */
  contest?: string | null;
  /** What the character carries and the moneys of the world, for a trade. */
  carrying?: { id: string; name: string }[];
  money?: { id: string; name: string }[];
  /** The player tried to leave and something in the scene stood in the way: what it was. */
  held: string | null;
  turn: number;
}

export interface LlmRequest {
  role: Role;
  params: MessageParams;
  /** When set, the answer must be JSON of this shape. */
  schema?: z.ZodType;
  hints?: MockHints;
  /** For a world-building request: what the demo builder is told. Never sent anywhere. */
  architect?: ArchitectHints;
}

export interface LlmResponse {
  text: string;
  parsed: unknown | null;
  usage: TokenUsage;
  model: string;
  stop: string | null;
  refusal: { category: string | null; explanation: string | null } | null;
  /** True when the demo client answered: nothing was sent and nothing was charged. */
  simulated: boolean;
}

export interface SendOptions {
  /** Called with each piece of text as it arrives (the narrator streams). */
  onText?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface Transport {
  readonly simulated: boolean;
  send(req: LlmRequest, opts?: SendOptions): Promise<LlmResponse>;
}

export type LlmErrorKind =
  | 'auth' // the key was rejected
  | 'credit' // the key works but the account cannot be charged
  | 'rate' // too many requests for now
  | 'overloaded' // the service is busy (529) or failed (5xx)
  | 'offline' // the request never reached the service
  | 'bad_request' // the service rejected the request: a bug in the app or an unsupported model
  | 'aborted' // the player pressed Stop
  | 'other';

export class LlmError extends Error {
  kind: LlmErrorKind;
  status: number | null;
  /** Seconds the service asked us to wait, when it said. */
  retryAfter: number | null;
  constructor(kind: LlmErrorKind, message: string, status: number | null = null, retryAfter: number | null = null) {
    super(message);
    this.name = 'LlmError';
    this.kind = kind;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
