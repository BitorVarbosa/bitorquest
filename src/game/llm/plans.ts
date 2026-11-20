// A whole game on one service: a model for every role, chosen from that service's live list. The lists
// change (models come and go), so each role names the models it prefers and falls back on a rule; the
// player can change any role afterwards.
import { ownModelId, roleModels, type ModelInfo, type RoleModels, type Service } from './models';

export interface Plan {
  models: Required<RoleModels>;
  /** The models the plan uses, to be remembered with their prices. */
  infos: ModelInfo[];
}

/** What each role is offered first, by the service's own id. */
const PREFER: Record<Exclude<Service, 'anthropic'>, Record<'open' | 'private', Record<'writer' | 'judge' | 'eyes', string[]>>> = {
  venice: {
    // Venice's own default, an uncensored DeepSeek it runs itself, writes well and caches cheaply.
    private: {
      writer: ['deepseek-v4-1-flash-1017-uncensored', 'deepseek-v4-1-flash-uncensored', 'deepseek-v4-1-flash-1017', 'venice-uncensored-1-2'],
      judge: ['deepseek-v4-flash', 'deepseek-v4-flash-0731', 'mistral-small-3-2-24b-instruct', 'qwen3-235b-a22b-instruct-2507'],
      eyes: ['deepseek-v4-1-flash-1017-uncensored', 'qwen-3-8-27b', 'mistral-small-3-2-24b-instruct'],
    },
    open: {
      writer: ['deepseek-v4-1-flash-1017-uncensored', 'deepseek-v4-1-flash-uncensored', 'venice-uncensored-1-2'],
      judge: ['deepseek-v4-flash', 'deepseek-v4-flash-0731', 'mistral-small-3-2-24b-instruct'],
      eyes: ['deepseek-v4-1-flash-1017-uncensored', 'qwen-3-8-27b'],
    },
  },
  nanogpt: {
    // Its TEE models run in sealed hardware.
    private: {
      writer: ['TEE/deepseek-v4.1-flash', 'TEE/glm-5.3-flash', 'TEE/qwen3.8-27b'],
      judge: ['TEE/gemma4-31b', 'TEE/deepseek-v4.1-flash', 'TEE/glm-5.3-flash'],
      eyes: ['TEE/gemma4-31b', 'TEE/deepseek-v4.1-flash'],
    },
    open: {
      // The dated DeepSeek, not its undated twin, which NanoGPT runs as a rate-limited beta for testing.
      writer: ['deepseek/deepseek-v4.1-flash-1017', 'z-ai/glm-5.3-flash-uncensored', 'deepseek/deepseek-v4.1-flash'],
      judge: ['deepseek/deepseek-v4.1-flash-1017', 'google/gemma-4-26b-a4b-it', 'deepseek/deepseek-v4.1-flash'],
      eyes: ['deepseek/deepseek-v4.1-flash-1017', 'google/gemma-4-26b-a4b-it'],
    },
  },
};

/** A model fit for a role that answers in a fixed shape and may write a few thousand tokens. */
const roomy = (m: ModelInfo, out: number) => (m.maxOutput ?? Infinity) >= out && (m.context ?? Infinity) >= 32_000;
/** A model its service offers for trying out, not for playing on: a beta, a preview, an experiment. */
const unsteady = (m: ModelInfo) => /\b(beta|preview|experimental|for testing|testing rather than)\b/i.test(`${m.description ?? ''} ${m.category ?? ''}`);
/** What a call usually costs: much is read, little is written. */
const price = (m: ModelInfo) => m.input * 8 + m.output;

/**
 * A plan for the whole game on one service, or null when its list has no model that can do the work.
 * `privateOnly`: only models the service marks as keeping nothing.
 */
export function suggestPlan(service: Exclude<Service, 'anthropic'>, list: ModelInfo[], privateOnly: boolean): Plan | null {
  const pool = list.filter((m) => !privateOnly || m.privacy === 'private');
  const prefs = PREFER[service][privateOnly ? 'private' : 'open'];
  // A steady model before one offered for trying out, whatever the preferences: among the steady ones,
  // the preferred first, then the cheapest that fits; only when none is steady, the same among the rest.
  const pick = (names: string[], fits: (m: ModelInfo) => boolean): ModelInfo | null => {
    for (const steady of [true, false]) {
      const ok = (x: ModelInfo) => fits(x) && (!steady || !unsteady(x));
      for (const name of names) {
        const m = pool.find((x) => ownModelId(x.id) === name && ok(x));
        if (m) return m;
      }
      const cheapest = [...pool].filter(ok).sort((a, b) => price(a) - price(b))[0];
      if (cheapest) return cheapest;
    }
    return null;
  };
  // The narrator also writes the epilogue and builds worlds, in a fixed shape: it is held to it where it can be.
  const writer = pick(prefs.writer, (m) => roomy(m, 8000) && m.structured === true) ?? pick(prefs.writer, (m) => roomy(m, 8000));
  const judge = pick(prefs.judge, (m) => roomy(m, 2000) && m.structured === true);
  if (!writer || !judge) return null;
  const eyes = writer.vision ? writer : judge.vision ? judge : pick(prefs.eyes, (m) => m.vision === true);
  const models = roleModels({ narrator: writer.id, referee: judge.id, scribe: judge.id, architect: writer.id, vision: (eyes ?? judge).id });
  const infos = [writer, judge, ...(eyes ? [eyes] : [])].filter((m, i, all) => all.findIndex((x) => x.id === m.id) === i);
  return { models, infos };
}
