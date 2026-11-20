// Models and prices. Model identifiers and prices are data, not code: when Anthropic changes them,
// this table changes (and later the player can edit it in Settings).
//
// Three services can answer: Claude (Anthropic), Venice and NanoGPT. A model's id says which: Claude's
// ids are bare ("claude-sonnet-5-5"); the others carry their service's prefix ("venice:…",
// "nanogpt:…"), so that the same name at two services never collides, every usage record says where it
// was spent, and a request goes to the service its model belongs to (route.ts).
import type { UsageEntry } from '../types';

export type Service = 'anthropic' | 'venice' | 'nanogpt';
export const SERVICES: readonly Service[] = ['anthropic', 'venice', 'nanogpt'];
/** The services' own names. Brand names: never translated. */
export const SERVICE_NAME: Record<Service, string> = { anthropic: 'Claude', venice: 'Venice', nanogpt: 'NanoGPT' };

const PREFIX: Record<Exclude<Service, 'anthropic'>, string> = { venice: 'venice:', nanogpt: 'nanogpt:' };

/** The service a model id belongs to. */
export function serviceOf(id: string): Service {
  if (id.startsWith(PREFIX.venice)) return 'venice';
  if (id.startsWith(PREFIX.nanogpt)) return 'nanogpt';
  return 'anthropic';
}

/** A service's own model id as the game writes it ("venice:" plus Venice's id). */
export function gameModelId(service: Service, own: string): string {
  return service === 'anthropic' ? own : `${PREFIX[service]}${own}`;
}

/** The id the service itself knows the model by. */
export function ownModelId(id: string): string {
  const s = serviceOf(id);
  return s === 'anthropic' ? id : id.slice(PREFIX[s].length);
}

export interface ModelInfo {
  id: string;
  label: string;
  /** US dollars per million tokens. */
  input: number;
  output: number;
  cacheRead: number;
  /**
   * How this model is told not to think before answering, or null when it always thinks.
   * Sonnet 5.5 rejects {type:"disabled"} and takes {type:"between_tools"} instead; Opus 5.5 cannot turn thinking off.
   * A model of another service that does not think, or can be told not to, has {type:"disabled"}: the
   * requests are built the same way for every service, and its connection turns this into its own setting.
   */
  thinkingOff: { type: 'disabled' } | { type: 'between_tools' } | null;
  // What follows is known for the models of the other services, from their own lists. Claude's models do all of it.
  /** The service can hold its answers to a shape (a JSON schema). Without it, the shape is asked for in words and checked on arrival. */
  structured?: boolean;
  /** It reads pictures. */
  vision?: boolean;
  /** It thinks before answering. */
  thinks?: boolean;
  /** The reasoning efforts its service accepts for it ("none", "low", "medium", "high"…), when it says. */
  efforts?: string[];
  /**
   * Who sees what is sent to it. 'private': its service runs it and keeps nothing (Venice's own models,
   * NanoGPT's TEE models). 'passed-on': its service hands the text to another company that runs it
   * (Venice's "anonymized" models, most of NanoGPT's). Unknown when not said.
   */
  privacy?: 'private' | 'passed-on';
  /** Tokens it can read, and the most it can write in one answer, when its service says. */
  context?: number | null;
  maxOutput?: number | null;
  /** The service's own words about it, and its grouping ("Uncensored", "Roleplay"…). */
  description?: string;
  category?: string;
}

export const PRICES_AS_OF = '2026-11-03';

export const MODELS: Record<string, ModelInfo> = {
  'claude-haiku-5-5': { id: 'claude-haiku-5-5', label: 'Haiku 5.5', input: 0.1, output: 0.5, cacheRead: 0.01, thinkingOff: { type: 'disabled' } },
  'claude-sonnet-5-5': { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', input: 2, output: 10, cacheRead: 0.1, thinkingOff: { type: 'between_tools' } },
  'claude-opus-5-5': { id: 'claude-opus-5-5', label: 'Opus 5.5', input: 4, output: 20, cacheRead: 0.2, thinkingOff: null },
};

/** Writing to the cache costs more than plain input: 1.25 times for a 5-minute entry, 2 times for a 1-hour entry. */
export const CACHE_WRITE_5M = 1.25;
export const CACHE_WRITE_1H = 2;

export type Preset = 'budget' | 'balanced' | 'premium';
export interface RoleModels {
  narrator: string;
  referee: string;
  scribe: string;
  /** The model that builds worlds and places and reads documents' notes into one. The narrator's when not set. */
  architect?: string;
  /** The model that reads a picture. The scribe's when not set (every Claude model reads pictures). */
  vision?: string;
}
export const PRESETS: Record<Preset, RoleModels> = {
  budget: { narrator: 'claude-haiku-5-5', referee: 'claude-haiku-5-5', scribe: 'claude-haiku-5-5' },
  balanced: { narrator: 'claude-sonnet-5-5', referee: 'claude-haiku-5-5', scribe: 'claude-haiku-5-5' },
  premium: { narrator: 'claude-opus-5-5', referee: 'claude-haiku-5-5', scribe: 'claude-haiku-5-5' },
};

/**
 * Models of the other services, known only at run time: their prices and abilities come from that
 * service's own list when the player chooses one, and are kept with the settings so that usage
 * records keep their names and prices.
 */
const EXTRA: Record<string, ModelInfo> = {};

export function registerModel(info: ModelInfo): void {
  EXTRA[info.id] = info;
}

/** A model the game knows: Claude's table, or one registered from another service's list. Null when unknown. */
export function knownModel(id: string): ModelInfo | null {
  return MODELS[id] ?? EXTRA[id] ?? null;
}

export function modelInfo(id: string): ModelInfo {
  // An unknown model (one that appeared after this table was written) is priced like Sonnet until the table is updated.
  return knownModel(id) ?? { id, label: id, input: 2, output: 10, cacheRead: 0.1, thinkingOff: null };
}

/** The models in use for each role, with the defaults filled in: the architect is the narrator's, the eyes the scribe's. */
export function roleModels(m: RoleModels): Required<RoleModels> {
  return { ...m, architect: m.architect ?? m.narrator, vision: m.vision ?? m.scribe };
}

/** The services a set of role models sends anything to. */
export function servicesOf(m: RoleModels): Service[] {
  const all = Object.values(roleModels(m)).map(serviceOf);
  return SERVICES.filter((s) => all.includes(s));
}

export interface TokenUsage {
  input: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  output: number;
}

export function costOf(model: string, u: TokenUsage): number {
  const m = modelInfo(model);
  return (
    (u.input * m.input + u.cacheRead * m.cacheRead + u.cacheWrite5m * m.input * CACHE_WRITE_5M + u.cacheWrite1h * m.input * CACHE_WRITE_1H + u.output * m.output) / 1_000_000
  );
}

/** Share of everything the model read that came from the cache. */
export function cacheShare(entries: Pick<UsageEntry, 'input' | 'cacheRead' | 'cacheWrite5m' | 'cacheWrite1h'>[]): number {
  let read = 0;
  let all = 0;
  for (const e of entries) {
    read += e.cacheRead;
    all += e.cacheRead + e.input + e.cacheWrite5m + e.cacheWrite1h;
  }
  return all === 0 ? 0 : read / all;
}
