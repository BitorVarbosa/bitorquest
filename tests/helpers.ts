// A headless session for tests: the real pipeline and request layout, the demo client, memory storage.
import { WorldBuilder, newDraft, type BuildInput } from '../src/game/builder';
import { proposalFrom, startSeed } from '../src/game/creation';
import type { CharacterOut } from '../src/game/llm/architect';
import { mockTransport } from '../src/game/llm/mock';
import { mockArchitect } from '../src/game/llm/mockArchitect';
import type { ModelChoice } from '../src/game/llm/requests';
import type { LlmRequest, LlmResponse, Transport } from '../src/game/llm/transport';
import { Session, type Budget, type SceneStore } from '../src/game/session';
import { newStory } from '../src/game/story';
import type { SceneArchive, Story, StorySettings, UsageEntry, WorldTemplate } from '../src/game/types';
import { creationRules } from '../src/game/world';
import { glassRoadSeed } from '../src/packs/lanternCoast';

export interface Harness {
  session: Session;
  requests: LlmRequest[];
  responses: LlmResponse[];
  usage: UsageEntry[];
  /** Replies the narrator will give next, in order, instead of the demo text. */
  narrator: string[];
  /** Errors to throw on the next narrator calls, in order. */
  narratorErrors: Error[];
  /** Make the next narrator call come back as a refusal. */
  refuse: { next: boolean };
  /** Answers the referee will give next, instead of the demo referee. */
  referee: unknown[];
  /** Answers the scribe will give next, instead of the demo scribe (null: the scribe gave nothing usable). */
  scribe: unknown[];
  /** Answers the world builder will give next (a place being filled in), instead of the demo builder's. */
  architect: unknown[];
  /** Errors to throw on the next world-builder calls, in order. */
  architectErrors: Error[];
  /** Move the fake clock forward (cache entries expire by this clock). */
  wait(seconds: number): void;
  clock(): number;
  /** The transcripts of finished scenes, as storage holds them: "<story id>/<scene id>". */
  kept: Map<string, SceneArchive>;
  /** The story as it was last handed to storage, and how often that happened. */
  saved: { story: Story | null; times: number };
}

/** Storage for scene transcripts, in memory. It takes and hands out copies, as real storage does. */
export function memoryScenes(kept = new Map<string, SceneArchive>()): SceneStore & { kept: Map<string, SceneArchive> } {
  return {
    kept,
    put: (id, a) => { kept.set(`${id}/${a.sceneId}`, structuredClone(a)); },
    get: async (id, sceneId) => { const a = kept.get(`${id}/${sceneId}`); return a ? structuredClone(a) : null; },
    drop: (id, ids) => { for (const s of ids) kept.delete(`${id}/${s}`); },
  };
}

export const BALANCED: ModelChoice = { narrator: 'claude-sonnet-5-5', referee: 'claude-haiku-5-5', scribe: 'claude-haiku-5-5', effort: 'low' };

export function harness(opts: { cap?: number; paging?: boolean; models?: ModelChoice; story?: Story; kept?: Map<string, SceneArchive> } = {}): Harness {
  let t = 1_800_000_000_000;
  const now = () => t;
  const inner = mockTransport({ now, streamDelay: 0 });
  const requests: LlmRequest[] = [];
  const responses: LlmResponse[] = [];
  const narrator: string[] = [];
  const narratorErrors: Error[] = [];
  const refuse = { next: false };
  const referee: unknown[] = [];
  const scribe: unknown[] = [];
  const architect: unknown[] = [];
  const architectErrors: Error[] = [];
  const transport: Transport = {
    simulated: true,
    async send(req, o) {
      requests.push(structuredClone({ ...req, schema: undefined }) as LlmRequest);
      if (req.role === 'narrator' && narratorErrors.length) throw narratorErrors.shift()!;
      if (req.role === 'architect' && architectErrors.length) throw architectErrors.shift()!;
      let res = await inner.send(req, o);
      if (req.role === 'narrator' && refuse.next) { refuse.next = false; res = { ...res, text: '', stop: 'refusal', refusal: { category: null, explanation: null } }; }
      else if (req.role === 'narrator' && narrator.length) res = { ...res, text: narrator.shift()! };
      if (req.role === 'referee' && referee.length) res = { ...res, parsed: referee.shift() };
      if (req.role === 'scribe' && scribe.length) res = { ...res, parsed: scribe.shift() };
      if (req.role === 'architect' && architect.length) res = { ...res, parsed: architect.shift() };
      responses.push(res);
      return res;
    },
  };
  const usage: UsageEntry[] = [];
  const budget: Budget = {
    spentToday: () => usage.reduce((sum, u) => sum + u.cost, 0),
    cap: () => opts.cap ?? 100,
    record: (entry) => { usage.push(entry); },
  };
  const story = opts.story ?? newStory(glassRoadSeed(), now());
  const scenes = memoryScenes(opts.kept);
  const saved: Harness['saved'] = { story: null, times: 0 };
  const session = new Session(story, {
    transport, models: () => opts.models ?? BALANCED, budget, now, paging: () => opts.paging ?? false, scenes,
    save: (s) => { saved.story = structuredClone(s); saved.times += 1; },
  });
  return { session, requests, responses, usage, narrator, narratorErrors, refuse, referee, scribe, architect, architectErrors, wait: (s) => { t += s * 1000; }, clock: now, kept: scenes.kept, saved };
}

/** The text of a request up to (not including) message index `upTo`, as the cache sees it. */
export function prefixText(req: LlmRequest, upTo: number): string {
  const sys = Array.isArray(req.params.system) ? req.params.system.map((b) => b.text).join('\u0002') : (req.params.system ?? '');
  const msgs = req.params.messages.slice(0, upTo).map((m) => `${m.role}\u0001${typeof m.content === 'string' ? m.content : m.content.map((b) => (b.type === 'text' ? b.text : '')).join('')}`);
  return [sys, ...msgs].join('\u0002');
}

const DEMO_INPUT: BuildInput = {
  source: { kind: 'description', text: 'A mining valley where the ore is running out and nobody will say so.' },
  premise: 'A clerk of the Miners’ Lodge who notices that the numbers do not add up.',
  name: 'Robin',
  table: { style: 'adventure', powers: 'focus', companions: 0, romance: true, violence: 'moderate', leaveOut: '', language: 'en', narration: 'medium' },
};

/** The demo builder's world, built through the real builder, as it would be in the library. */
export async function demoTemplate(table: Partial<BuildInput['table']> = {}): Promise<WorldTemplate> {
  const input = { ...structuredClone(DEMO_INPUT), table: { ...DEMO_INPUT.table, ...table } };
  const builder = new WorldBuilder(newDraft('w1', input, 0), {
    transport: mockTransport({ now: () => 0, streamDelay: 0 }), models: () => BALANCED,
    budget: { spentToday: () => 0, cap: () => 100, record: () => {} }, save: () => {}, now: () => 0,
  });
  await builder.build();
  const template = builder.accept();
  if (!template) throw new Error('the demo world did not build');
  return template;
}

/** A new story in the demo builder's world, with the demo character, ready to be played headless. */
export async function builtHarness(opts: { cap?: number; settings?: Partial<StorySettings>; table?: Partial<BuildInput['table']>; template?: WorldTemplate } = {}): Promise<Harness & { template: WorldTemplate }> {
  const template = opts.template ?? (await demoTemplate(opts.table));
  const answer = mockArchitect({ step: 'character', input: DEMO_INPUT, done: {}, world: template.world }) as CharacterOut;
  const who = proposalFrom(answer, creationRules(template.world), 'Robin');
  const story = newStory(startSeed(template, who, { id: 'built', seed: 11, ...(opts.settings ? { settings: opts.settings } : {}) }), 1_800_000_000_000);
  return { ...harness({ story, ...(opts.cap !== undefined ? { cap: opts.cap } : {}) }), template };
}
