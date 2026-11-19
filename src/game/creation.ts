// From a finished world to a story being played: a character for it, then the story itself.
//
// A character may be proposed by the model from the player's one-line premise. Whatever comes back is
// passed through the same rules as a hand-made one (engine/character.ts `repair`), so nothing illegal
// reaches a story: the proposal is a starting point the player edits, never something to be trusted.
import {
  ancestryOf, check, levelName, repair, sheetOf, traitDef,
  type CharacterDraft, type CreationRules, type Gift, type Path, type TableStyle,
} from '../engine';
import { t, tl } from '../i18n';
import { APPEARANCE_MAX, CARD_MAX, LOOK_MAX, clip } from './cards';
import { BudgetReached } from './builder';
import { STARTING_MONEY, currenciesOf, startingIn } from './money';
import { characterRequest, type CharacterOut } from './llm/architect';
import { costOf } from './llm/models';
import type { ModelChoice } from './llm/requests';
import type { Transport } from './llm/transport';
import type { Budget } from './session';
import type { StorySeed } from './story';
import type { Item, Person, StorySettings, UsageEntry, World, WorldTemplate } from './types';
import { DESTINY_BY_STYLE, creationRules } from './world';

export interface CharacterProposal {
  draft: CharacterDraft;
  /** What they own that matters: a name and a line each. No numbers. */
  carrying: { name: string; text: string }[];
  /** Why each part was chosen, for showing next to it. Null for a character the player made from nothing. */
  reasons: { attributes: string; paths: string; skills: string; traits: string } | null;
  /** What had to be changed to make the proposal fit the rules, in words. */
  changes: string[];
  /** How they look at a glance, and in full. The player may change both. */
  look: string;
  appearance: string;
}

const PATH_NAMES: readonly string[] = ['fire', 'water', 'air', 'earth', 'light', 'dark'];
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Turn the model's answer into a legal character for this world. `name` is the player's own, when they gave one: it wins. */
export function proposalFrom(out: CharacterOut, rules: CreationRules, name: string): CharacterProposal {
  const paths: Partial<Record<Path, number>> = {};
  for (const p of Array.isArray(out?.paths) ? out.paths : []) if (p && PATH_NAMES.includes(p.path)) paths[p.path] = Math.max(paths[p.path] ?? 0, num(p.level));
  const raw: CharacterDraft = {
    name: name.trim() || clip(typeof out?.name === 'string' ? out.name : '', 40),
    line: clip(typeof out?.line === 'string' ? out.line : '', 120),
    ancestry: typeof out?.ancestry === 'string' ? out.ancestry : '',
    attributes: { strength: num(out?.strength), skill: num(out?.skill), resistance: num(out?.resistance), armor: num(out?.armor), firepower: num(out?.firepower) },
    paths,
    skills: list(out?.skills) as CharacterDraft['skills'],
    advantages: list(out?.advantages).map((t) => clip(t, 60)),
    disadvantages: list(out?.disadvantages).map((t) => clip(t, 60)),
    abilities: list(out?.abilities),
    // Whatever was proposed as a power of their own goes to `repair` as it came: the rules cut it to what is allowed.
    ...(out?.gift && typeof out.gift === 'object' ? { gift: out.gift as unknown as Gift } : {}),
  };
  const { draft, changes } = repair(raw, rules);
  const seen = new Set<string>();
  const carrying = (Array.isArray(out?.carrying) ? out.carrying : [])
    .filter((c) => c && typeof c.name === 'string' && c.name.trim() && !seen.has(c.name.trim().toLowerCase()) && !!seen.add(c.name.trim().toLowerCase()))
    .slice(0, 5).map((c) => ({ name: clip(c.name, 40), text: clip(typeof c.text === 'string' ? c.text : '', 110) }));
  const r = out?.reasons;
  const reasons = r && typeof r === 'object'
    ? { attributes: clip(String(r.attributes ?? ''), 160), paths: clip(String(r.paths ?? ''), 160), skills: clip(String(r.skills ?? ''), 160), traits: clip(String(r.traits ?? ''), 160) }
    : null;
  const look = clip(typeof out?.look === 'string' ? out.look : '', LOOK_MAX);
  const appearance = clip(typeof out?.appearance === 'string' ? out.appearance : '', APPEARANCE_MAX);
  return { draft, carrying, reasons, changes, look, appearance };
}

export interface ProposeDeps {
  transport: Transport;
  models: () => ModelChoice;
  budget: Budget;
  now: () => number;
}

/**
 * Ask for a character that fits the premise. One small request. Throws BudgetReached when today's
 * limit is reached, and the transport's error when the request does not go through: the caller then
 * offers an empty sheet, which costs nothing.
 */
export async function proposeCharacter(
  world: World, who: { premise: string; name: string }, deps: ProposeDeps, ledger = `world:${world.id}`,
): Promise<{ proposal: CharacterProposal; usage: UsageEntry }> {
  const { budget } = deps;
  if (budget.spentToday() >= budget.cap()) throw new BudgetReached();
  const rules = creationRules(world);
  const res = await deps.transport.send(characterRequest(world, who, rules.level, deps.models()));
  const usage: UsageEntry = { at: deps.now(), role: 'architect', model: res.model, ...res.usage, cost: costOf(res.model, res.usage), simulated: res.simulated };
  budget.record(usage, ledger);
  // No usable answer is not an error: the player gets an empty sheet with their name on it.
  const proposal = res.parsed
    ? proposalFrom(res.parsed as CharacterOut, rules, who.name)
    : { draft: { ...repair({ name: who.name, line: '', ancestry: '', attributes: { strength: 0, skill: 0, resistance: 0, armor: 0, firepower: 0 }, paths: {}, skills: [], advantages: [], disadvantages: [], abilities: [] }, rules).draft }, carrying: [], reasons: null, changes: [t('The world builder gave no usable character; this sheet is empty.')], look: '', appearance: '' };
  return { proposal, usage };
}

// ---------- Starting the story ----------

/** Common coins a new character has. Wealth and Poor change it; nothing else does. What that is in the world's own money is money.ts's. */
export const STARTING_SILVER = STARTING_MONEY;
/** Bandages a new character carries, by table style. Each restores 5 hit points. */
export const STARTING_DRESSINGS: Record<TableStyle, number> = { story: 2, adventure: 1, brutal: 0 };

const slug = (text: string): string => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);

export interface StartOptions {
  /** The new story's id (the app makes sure it is free). */
  id: string;
  /** Where the dice start. */
  seed: number;
  /** A title other than the one the world suggests. */
  title?: string;
  /** Settings changed for this story. The table style may differ from the world's usual one; powers may not. */
  settings?: Partial<StorySettings>;
  /** How earlier heroes of this world are remembered in it: one line each, from the end of their stories. */
  legends?: string[];
}

/**
 * Everything a new story starts from: day 1, chapter 1, the world's opening thread, a full sheet.
 * Throws when the character does not pass the rules of the world: a story never starts with an
 * illegal sheet.
 */
/** A companion as the player described them before the story began: each part replaces the world builder's when it is not empty. */
export interface Described { look: string; appearance: string; card: string }

/** Put the player's words on a person: how they look at a glance, in full, and who they are. Empty words leave a part as it was. */
export function describe(p: Person, d: Partial<Described>): void {
  if (d.look?.trim()) p.look = clip(d.look.trim(), LOOK_MAX);
  if (d.appearance?.trim()) p.appearance = clip(d.appearance.trim(), APPEARANCE_MAX);
  if (d.card?.trim()) p.card = clip(d.card.trim(), CARD_MAX);
}

/** Who starts a story in this world at the protagonist's side: as many as the table allows, in the world's order. */
export function startingCompanions(template: WorldTemplate): Person[] {
  return Object.values(template.world.people).filter((p) => p.inParty).slice(0, template.table.companions);
}

export function startSeed(template: WorldTemplate, character: Pick<CharacterProposal, 'draft' | 'carrying'> & { look?: string; appearance?: string; companions?: Record<string, Described> }, opts: StartOptions): StorySeed {
  const rules = creationRules(template.world);
  const found = check(character.draft, rules);
  // Shown to the player who pressed Start, in the interface language.
  if (!found.ok) throw new Error(t('the character cannot start a story: {problem}', { problem: found.problems[0]?.text ?? t('it does not fit the rules') }));
  const settings: StorySettings = { style: template.world.rules.style, ...template.table, ...opts.settings };
  // What is written into the story is in the story's language.
  const l = settings.language;
  // The story plays in its own copy of the world, with the table style chosen for this story.
  const world = structuredClone(template.world);
  world.rules.style = settings.style;
  world.rules.destinyPerChapter = DESTINY_BY_STYLE[settings.style];
  // Nobody more than the table allows starts at the protagonist's side.
  let beside = 0;
  for (const p of Object.values(world.people)) if (p.inParty && ++beside > settings.companions) { p.inParty = false; p.met = false; }
  // How the player said the companions look and who they are, where they said it.
  for (const [id, d] of Object.entries(character.companions ?? {})) { const p = world.people[id]; if (p?.inParty) describe(p, d); }
  // Earlier heroes of this world, as it remembers them.
  if (opts.legends?.length) world.legends = [...(world.legends ?? []), ...opts.legends.map((x) => clip(x, 200))].slice(-3);

  const sheet = sheetOf(character.draft, rules);
  const has = (key: string) => [...sheet.advantages, ...sheet.disadvantages].some((t) => traitDef(t)?.name.toLowerCase() === key);
  const taken = new Set<string>();
  const items: Item[] = character.carrying.slice(0, 5).map((c, i) => {
    let id = slug(c.name) || `thing_${i + 1}`;
    while (taken.has(id)) id = `${id}_${i + 1}`;
    taken.add(id);
    return { id, name: c.name, kind: 'gear', text: c.text, qty: 1 };
  });
  const dressings = STARTING_DRESSINGS[settings.style];
  if (dressings > 0) items.push({ id: 'dressing', name: tl(l, 'Bandages and salve'), kind: 'consumable', text: tl(l, 'Restores 5 hit points.'), qty: dressings, heal: 5 });
  // Money: the world's common money, as much as Wealth or Poor say. A world without money gives none.
  const first = currenciesOf(world, l)[0];
  const wealth = has('wealth') ? 'wealthy' : has('poor') ? 'poor' : 'usual';
  const coins = first ? startingIn(wealth, first) : 0;
  const destiny = world.rules.destinyPerChapter;
  const hour = Math.max(0, Math.min(23, Math.round(template.opening.hour ?? 9)));
  return {
    id: opts.id,
    title: (opts.title ?? template.opening.title).trim() || template.world.name,
    world,
    protagonist: {
      name: character.draft.name.trim(), line: character.draft.line.trim() || tl(l, 'someone of {world}', { world: template.world.name }),
      ancestry: ancestryOf(character.draft, rules).name, level: levelName(rules.level), sheet,
      destiny, destinyMax: destiny, xp: 0, xpEarned: 0, items,
      silver: coins, purse: first ? { [first.id]: coins } : {},
      ...(character.look?.trim() ? { look: clip(character.look, LOOK_MAX) } : {}),
      ...(character.appearance?.trim() ? { appearance: clip(character.appearance, APPEARANCE_MAX) } : {}),
    },
    clock: { day: 1, minute: hour * 60 },
    chapter: { n: 1, title: template.opening.chapter.trim() || tl(l, 'Chapter One'), fromDay: 1 },
    chapters: [],
    threads: template.opening.thread.trim() ? [{ id: 'main', title: template.opening.thread.trim(), kind: 'main', status: 'open', next: null, clues: [], since: 1 }] : [],
    commitments: [],
    events: [],
    summary: '',
    settings,
    sceneNumber: 1,
    turnsBefore: 0,
    seed: opts.seed,
    ...(template.opening.line.trim() ? { opening: template.opening.line.trim() } : {}),
  };
}
