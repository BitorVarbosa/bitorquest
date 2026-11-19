// Models and prices. Model identifiers and prices are data, not code: when Anthropic changes them,
// this table changes (and later the player can edit it in Settings).
import type { UsageEntry } from '../types';

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
   */
  thinkingOff: { type: 'disabled' } | { type: 'between_tools' } | null;
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
}
export const PRESETS: Record<Preset, RoleModels> = {
  budget: { narrator: 'claude-haiku-5-5', referee: 'claude-haiku-5-5', scribe: 'claude-haiku-5-5' },
  balanced: { narrator: 'claude-sonnet-5-5', referee: 'claude-haiku-5-5', scribe: 'claude-haiku-5-5' },
  premium: { narrator: 'claude-opus-5-5', referee: 'claude-haiku-5-5', scribe: 'claude-haiku-5-5' },
};

export function modelInfo(id: string): ModelInfo {
  // An unknown model (one that appeared after this table was written) is priced like Sonnet until the table is updated.
  return MODELS[id] ?? { id, label: id, input: 2, output: 10, cacheRead: 0.1, thinkingOff: null };
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
