// Making a character: the choices, what they cost, and whether they are allowed.
//
// A character is bought with points. The starting power level of the world gives a number of points;
// drawbacks give some back, up to a limit; attributes, paths, skills, advantages and an ancestry spend
// them. This file is the one place that knows those rules. The character editor shows what `check`
// returns, and a character proposed by the world builder is passed through `repair`, so that nothing
// illegal reaches a story however it was made.
import { t } from '../i18n';
import { ABILITIES, STARTING_TIER } from './abilities';
import { GIFT_KINDS_MAX, GIFT_RANK_START, STAGGER_FROM_TIER, cleanGift, isGiftKind, type GiftLimits } from './gift';
import { POWER_LEVELS, SKILL_COST, type PowerLevel } from './sheet';
import { traitDef, traitDetail, traitInfo } from './traits';
import { ATTRIBUTES, PATHS, SKILLS, maxEnergy, maxHp, pathName, traitKey, type Attribute, type Gift, type Path, type PowersMode, type Sheet, type SkillName } from './types';

/**
 * What a gift may be when a story starts: no rank above 3, one move for each rank, and none above
 * the tier that is common knowledge for library abilities. Higher moves are worked out in play.
 */
export const GIFT_AT_START: GiftLimits = { rank: GIFT_RANK_START, moves: (rank) => rank, tier: (rank) => Math.min(rank, STARTING_TIER) };

/** A people of the world, as a package: what it costs and the traits it brings. */
export interface Ancestry {
  id: string;
  name: string;
  /** One or two lines: who they are and what marks them. */
  text: string;
  /** Traits everyone of this ancestry has, written as on a sheet. */
  advantages: string[];
  disadvantages: string[];
}

/** The ancestry every world has: no traits, no cost. A world gives it its own name ("Human", "Townsfolk"). */
export const PLAIN_ANCESTRY: Ancestry = { id: 'plain', name: 'Human', text: 'No special traits.', advantages: [], disadvantages: [] };

/** What a world allows at character creation. */
export interface CreationRules {
  level: PowerLevel;
  powers: PowersMode;
  /** No path may start higher than this. */
  pathCap: number;
  ancestries: Ancestry[];
}

/** A character being made: the choices only. Hit points, energy and totals follow from them. */
export interface CharacterDraft {
  name: string;
  /** How the narrator introduces them: "a young courier of the Couriers' Guild in Port Varn". */
  line: string;
  /** The id of one of the world's ancestries. */
  ancestry: string;
  attributes: Record<Attribute, number>;
  paths: Partial<Record<Path, number>>;
  skills: SkillName[];
  /** Advantages and drawbacks chosen, as written on a sheet. Those the ancestry brings are not listed here. */
  advantages: string[];
  disadvantages: string[];
  /** Ids of the abilities known at the start. */
  abilities: string[];
  /** In a world of gifts: the character's own power, or nothing for someone who has none. */
  gift?: Gift | null;
}

export type ProblemArea = 'who' | 'points' | 'attributes' | 'paths' | 'abilities' | 'gift' | 'skills' | 'advantages' | 'disadvantages' | 'ancestry';
export interface Problem {
  area: ProblemArea;
  text: string;
}

export interface CharacterCheck {
  /** Points to spend: the level's, plus what drawbacks give back. */
  budget: number;
  base: number;
  /** What the chosen drawbacks are worth, and how much of it counts (the level's limit). */
  drawbackPoints: number;
  drawbackLimit: number;
  fromDrawbacks: number;
  spent: number;
  left: number;
  parts: { attributes: number; paths: number; gift: number; skills: number; advantages: number; ancestry: number };
  hp: number;
  energy: number;
  /** How many abilities the character may start with, and how many are chosen. */
  abilityRoom: number;
  problems: Problem[];
  ok: boolean;
}

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const LEVEL_NAME: Record<PowerLevel, string> = { novice: 'Novice', seasoned: 'Seasoned', champion: 'Champion', legend: 'Legend' };
export const levelName = (level: PowerLevel): string => LEVEL_NAME[level];

/** What an ancestry costs: its advantages, less its drawbacks, and never less than nothing. */
export function ancestryCost(a: Ancestry): number {
  const plus = a.advantages.reduce((sum, t) => sum + traitInfo(t, 'advantage').points, 0);
  const minus = a.disadvantages.reduce((sum, t) => sum + traitInfo(t, 'disadvantage').points, 0);
  return Math.max(0, plus - minus);
}

/** What is wrong with an ancestry a world defines, or nothing. Used when a world is built: its packages must be made of traits the game knows. */
export function checkAncestry(a: Ancestry): string[] {
  const out: string[] = [];
  if (!a.id.trim() || !a.name.trim()) out.push('an ancestry needs an id and a name');
  for (const t of a.advantages) { const d = traitDef(t); if (!d || d.kind !== 'advantage') out.push(`${a.name}: "${t}" is not an advantage the game knows`); }
  for (const t of a.disadvantages) { const d = traitDef(t); if (!d || d.kind !== 'disadvantage') out.push(`${a.name}: "${t}" is not a drawback the game knows`); }
  if (a.advantages.length + a.disadvantages.length > 4) out.push(`${a.name}: an ancestry brings at most four traits`);
  if (ancestryCost(a) > 3) out.push(`${a.name}: an ancestry costs at most 3 points`);
  return out;
}

export function ancestryOf(d: Pick<CharacterDraft, 'ancestry'>, rules: CreationRules): Ancestry {
  return rules.ancestries.find((a) => a.id === d.ancestry) ?? rules.ancestries[0] ?? PLAIN_ANCESTRY;
}

/** The sheet a draft makes, at full hit points and energy, with the traits its ancestry brings. */
export function sheetOf(d: CharacterDraft, rules: CreationRules): Sheet {
  const a = ancestryOf(d, rules);
  const merge = (own: string[], given: string[]) => [...given.filter((g) => !own.some((o) => traitKey(o) === traitKey(g))), ...own];
  const sheet: Sheet = {
    ...d.attributes,
    hp: 0, energy: 0,
    paths: Object.fromEntries(PATHS.filter((p) => (d.paths[p] ?? 0) > 0).map((p) => [p, d.paths[p]!])),
    skills: [...d.skills],
    advantages: merge(d.advantages, a.advantages),
    disadvantages: merge(d.disadvantages, a.disadvantages),
    abilities: [...d.abilities],
    ...(rules.powers === 'gift' && d.gift ? { gift: structuredClone(d.gift) } : {}),
  };
  sheet.hp = maxHp(sheet);
  sheet.energy = maxEnergy(sheet);
  return sheet;
}

/** Check a draft against the rules of its world. Everything the editor shows about points and problems comes from here. */
export function check(d: CharacterDraft, rules: CreationRules): CharacterCheck {
  const problems: Problem[] = [];
  const level = POWER_LEVELS[rules.level];
  const a = ancestryOf(d, rules);

  // ----- who -----
  if (!d.name.trim()) problems.push({ area: 'who', text: t('Give your character a name.') });

  // ----- attributes -----
  let attributes = 0;
  for (const k of ATTRIBUTES) {
    const v = d.attributes[k];
    if (!Number.isInteger(v) || v < 0 || v > 5) problems.push({ area: 'attributes', text: t('{name} must be a whole number from 0 to 5.', { name: t(cap(k)) }) });
    attributes += Math.max(0, v || 0);
  }

  // ----- paths and abilities -----
  let paths = 0;
  for (const k of PATHS) {
    const v = d.paths[k] ?? 0;
    if (!Number.isInteger(v) || v < 0) problems.push({ area: 'paths', text: t('{name} must be a whole number.', { name: pathName(k) }) });
    else if (rules.powers === 'off' && v > 0) problems.push({ area: 'paths', text: t('This world has no powers: paths stay at 0.') });
    else if (rules.powers === 'extreme' && v > 0) problems.push({ area: 'paths', text: t('In this world powers are schools, bought as advantages: paths stay at 0.') });
    else if (rules.powers === 'gift' && v > 0) problems.push({ area: 'paths', text: t('In this world a power is one of your own: paths stay at 0.') });
    else if (v > rules.pathCap) problems.push({ area: 'paths', text: t('{name} cannot start higher than {cap} in this world.', { name: pathName(k), cap: rules.pathCap }) });
    paths += Math.max(0, v || 0);
  }

  // ----- a power of one's own -----
  let gift = 0;
  if (d.gift) {
    const g = d.gift;
    if (rules.powers !== 'gift') problems.push({ area: 'gift', text: t('This world has no powers of one’s own.') });
    else {
      const lim = GIFT_AT_START;
      if (!g.name.trim()) problems.push({ area: 'gift', text: t('Give your power a name.') });
      if (!g.text.trim()) problems.push({ area: 'gift', text: t('Say what your power is.') });
      const rankOk = Number.isInteger(g.rank) && g.rank >= 1 && g.rank <= lim.rank;
      if (!rankOk) problems.push({ area: 'gift', text: t('The rank of your power must be from 1 to {max} at the start.', { max: lim.rank }) });
      const rank = rankOk ? g.rank : 0;
      if (g.kinds.length > GIFT_KINDS_MAX || g.kinds.some((k) => !isGiftKind(k)) || new Set(g.kinds).size !== g.kinds.length) {
        problems.push({ area: 'gift', text: t('A power can do at most {n} kinds of thing in a fight.', { n: GIFT_KINDS_MAX }) });
      }
      const room = lim.moves(rank);
      if (g.moves.length > room) {
        problems.push({ area: 'gift', text: room === 1
          ? t('You can start with {room} move, one for each rank; {chosen} are written.', { room, chosen: g.moves.length })
          : t('You can start with {room} moves, one for each rank; {chosen} are written.', { room, chosen: g.moves.length }) });
      }
      const top = lim.tier(rank);
      const ids = new Set<string>();
      for (const mv of g.moves) {
        const name = mv.name.trim();
        if (!name) { problems.push({ area: 'gift', text: t('Give each move a name.') }); continue; }
        if (!mv.id || ids.has(mv.id)) problems.push({ area: 'gift', text: t('{name} is listed twice.', { name }) });
        ids.add(mv.id);
        if (!Number.isInteger(mv.tier) || mv.tier < 1 || mv.tier > 4) problems.push({ area: 'gift', text: t('{name}: the tier must be from 1 to 4.', { name }) });
        else if (mv.tier > rank) problems.push({ area: 'gift', text: t('{name} is tier {tier}; your power is rank {rank}.', { name, tier: mv.tier, rank }) });
        else if (mv.tier > top) problems.push({ area: 'gift', text: t('{name} cannot start above tier {max}: higher moves are worked out in the story.', { name, max: top }) });
        if (mv.fight && !g.kinds.includes(mv.fight)) problems.push({ area: 'gift', text: t('{name} does something in a fight that is not among the kinds of your power.', { name }) });
        else if (mv.fight === 'stagger' && mv.tier < STAGGER_FROM_TIER) problems.push({ area: 'gift', text: t('{name}: making someone lose their action takes tier {tier}.', { name, tier: STAGGER_FROM_TIER }) });
      }
      gift = Math.max(0, g.rank || 0);
    }
  }
  const abilityRoom = rules.powers === 'focus' ? paths : 0;
  const known = new Set<string>();
  for (const id of d.abilities) {
    const ab = ABILITIES[id];
    if (!ab) { problems.push({ area: 'abilities', text: t('“{id}” is not an ability the game knows.', { id }) }); continue; }
    if (known.has(id)) { problems.push({ area: 'abilities', text: t('{name} is listed twice.', { name: t(ab.name) }) }); continue; }
    known.add(id);
    const focus = d.paths[ab.path] ?? 0;
    if (focus < ab.tier) problems.push({ area: 'abilities', text: t('{name} needs {path} {tier}; you have {path} {focus}.', { name: t(ab.name), path: pathName(ab.path), tier: ab.tier, focus }) });
    else if (ab.tier > STARTING_TIER) problems.push({ area: 'abilities', text: t('{name} is not common knowledge: it has to be found in the story.', { name: t(ab.name) }) });
  }
  if (d.abilities.length > abilityRoom) {
    problems.push({
      area: 'abilities',
      text: abilityRoom === 0
        ? t('A character with no levels in a path starts with no abilities.')
        : abilityRoom === 1
          ? t('You can start with {room} ability, one for each level in a path; {chosen} are chosen.', { room: abilityRoom, chosen: d.abilities.length })
          : t('You can start with {room} abilities, one for each level in a path; {chosen} are chosen.', { room: abilityRoom, chosen: d.abilities.length }),
    });
  }

  // ----- skills -----
  const skillSet = new Set<string>();
  for (const sk of d.skills) {
    if (!(SKILLS as readonly string[]).includes(sk)) problems.push({ area: 'skills', text: t('“{name}” is not a skill.', { name: sk }) });
    else if (skillSet.has(sk)) problems.push({ area: 'skills', text: t('{name} is listed twice.', { name: t(sk) }) });
    skillSet.add(sk);
  }
  const skills = skillSet.size * SKILL_COST;

  // ----- advantages and drawbacks -----
  const held = new Map<string, string>(); // kind -> as written, across both lists and the ancestry
  for (const w of [...a.advantages, ...a.disadvantages]) held.set(traitDef(w)?.name.toLowerCase() ?? traitKey(w), w);
  const tally = (list: string[], kind: 'advantage' | 'disadvantage', area: ProblemArea): number => {
    let points = 0;
    for (const w of list) {
      const def = traitDef(w);
      if (!def || def.kind !== kind) { problems.push({ area, text: kind === 'advantage' ? t('“{name}” is not an advantage the game knows.', { name: w }) : t('“{name}” is not a drawback the game knows.', { name: w }) }); continue; }
      if (def.only && def.only !== rules.powers) { problems.push({ area, text: t('{name} exists only in worlds where powers are schools.', { name: t(def.name) }) }); continue; }
      const key = def.name.toLowerCase();
      // A trait that takes particulars can be held more than once, for different ones ("Ally: Sela", "Ally: Hask").
      const slot = def.detail ? `${key}: ${traitDetail(w).toLowerCase()}` : key;
      if (held.has(slot)) { problems.push({ area, text: a.advantages.concat(a.disadvantages).includes(held.get(slot)!) ? t('{name} already comes with being {ancestry}.', { name: t(def.name), ancestry: a.name }) : t('{name} is listed twice.', { name: t(def.name) }) }); continue; }
      held.set(slot, w);
      if (def.detail && !traitDetail(w)) problems.push({ area, text: t('{name} needs to say more: {detail}.', { name: t(def.name), detail: t(def.detail).toLowerCase() }) });
      points += def.points;
    }
    return points;
  };
  const advantages = tally(d.advantages, 'advantage', 'advantages');
  const drawbackPoints = tally(d.disadvantages, 'disadvantage', 'disadvantages');
  for (const w of [...d.advantages, ...d.disadvantages, ...a.advantages, ...a.disadvantages]) {
    const def = traitDef(w);
    if (def?.against && def.kind === 'advantage' && [...held.keys()].some((k) => k === def.against || k.startsWith(`${def.against}:`))) {
      const other = traitDef(def.against);
      problems.push({ area: 'advantages', text: t('{name} and {other} cannot both be true.', { name: t(def.name), other: t(other?.name ?? def.against) }) });
    }
  }

  // ----- ancestry -----
  const known_ = rules.ancestries.some((x) => x.id === d.ancestry);
  if (!known_ && rules.ancestries.length > 0) problems.push({ area: 'ancestry', text: t('Choose an ancestry of this world.') });
  const ancestry = ancestryCost(a);

  // ----- the sum -----
  const fromDrawbacks = Math.min(drawbackPoints, level.disadvantages);
  const budget = level.points + fromDrawbacks;
  const spent = attributes + paths + gift + skills + advantages + ancestry;
  if (spent > budget) {
    const over = spent - budget;
    const atLimit = drawbackPoints >= level.disadvantages;
    problems.unshift({
      area: 'points',
      text: (rules.powers === 'gift'
        ? t('You have spent {spent} of {budget} points: {over} too many. Lower an attribute, the rank of your power, a skill or an advantage.', { spent, budget, over })
        : t('You have spent {spent} of {budget} points: {over} too many. Lower an attribute, a path, a skill or an advantage.', { spent, budget, over }))
        + (atLimit ? t(' Drawbacks already give back {back}, the most a {level} can get, so they cannot cover it.', { back: level.disadvantages, level: t(LEVEL_NAME[rules.level]) }) : t(' Or take a drawback.')),
    });
  }
  const sheet = sheetOf(d, rules);
  return {
    budget, base: level.points, drawbackPoints, drawbackLimit: level.disadvantages, fromDrawbacks, spent, left: budget - spent,
    parts: { attributes, paths, gift, skills, advantages, ancestry },
    hp: maxHp(sheet), energy: maxEnergy(sheet), abilityRoom, problems, ok: problems.length === 0,
  };
}

/** An empty draft for a world: an ordinary person, nothing chosen. */
export function blankDraft(rules: CreationRules): CharacterDraft {
  return {
    name: '', line: '', ancestry: (rules.ancestries[0] ?? PLAIN_ANCESTRY).id,
    attributes: { strength: 0, skill: 0, resistance: 0, armor: 0, firepower: 0 },
    paths: {}, skills: [], advantages: [], disadvantages: [], abilities: [],
  };
}

/**
 * Make a draft legal with as little change as possible. A character proposed by the world builder goes
 * through this before the player sees it: unknown things are dropped, numbers are brought into range,
 * abilities that cannot be had are removed, and if it still costs too much it is trimmed, most
 * expensive luxuries first, until it fits. Returns the legal draft and what was changed, in words.
 */
export function repair(input: CharacterDraft, rules: CreationRules): { draft: CharacterDraft; changes: string[] } {
  const changes: string[] = [];
  const d: CharacterDraft = structuredClone(input);
  const clamp = (v: unknown, hi: number) => Math.max(0, Math.min(hi, Number.isFinite(v) ? Math.round(v as number) : 0));

  if (!rules.ancestries.some((x) => x.id === d.ancestry)) d.ancestry = (rules.ancestries[0] ?? PLAIN_ANCESTRY).id;
  for (const k of ATTRIBUTES) {
    const v = clamp(d.attributes[k], 5);
    if (v !== d.attributes[k]) changes.push(t('{name} was set to {value}.', { name: t(cap(k)), value: v }));
    d.attributes[k] = v;
  }
  const pathTop = rules.powers === 'off' || rules.powers === 'gift' ? 0 : rules.pathCap;
  for (const k of PATHS) {
    const was = d.paths[k] ?? 0;
    const v = clamp(was, pathTop);
    if (v !== was) {
      changes.push(rules.powers === 'off' ? t('{name} was removed: this world has no powers.', { name: pathName(k) })
        : rules.powers === 'gift' ? t('{name} was removed: in this world a power is one of your own.', { name: pathName(k) })
          : t('{name} was lowered to {value}, the most this world allows at the start.', { name: pathName(k), value: v }));
    }
    if (v > 0) d.paths[k] = v; else delete d.paths[k];
  }

  // A power of one's own: only in a world of gifts, and within what a story may start with.
  if (d.gift) {
    if (rules.powers !== 'gift') {
      d.gift = null;
      changes.push(t('The power of your own was removed: this world has none of that kind.'));
    } else {
      const raw = d.gift as unknown as { rank?: unknown; moves?: unknown };
      const asked = { rank: Number.isFinite(raw.rank) ? Math.round(raw.rank as number) : 0, moves: Array.isArray(raw.moves) ? raw.moves : [] };
      const g = cleanGift(d.gift, GIFT_AT_START);
      if (!g) changes.push(t('The power that was proposed could not be used and was left out.'));
      else {
        if (!g.name) g.name = t('Unnamed power');
        if (!g.text) g.text = g.name;
        if (asked.rank > g.rank) changes.push(t('The rank of your power was lowered to {value}, the most a story starts with.', { value: g.rank }));
        if (asked.moves.length > g.moves.length) changes.push(t('Moves beyond what a power of that rank starts with were left out.'));
        const lowered = g.moves.some((mv, i) => { const was = (asked.moves[i] as { tier?: unknown } | null)?.tier; return typeof was === 'number' && was > mv.tier; });
        if (lowered) changes.push(t('Moves were lowered to the tier a story can start with.'));
      }
      d.gift = g;
    }
  }
  const skills = [...new Set(d.skills)].filter((s): s is SkillName => (SKILLS as readonly string[]).includes(s));
  if (skills.length !== d.skills.length) changes.push(t('Skills the game does not know, or listed twice, were dropped.'));
  d.skills = skills;

  const a = ancestryOf(d, rules);
  const given = new Set([...a.advantages, ...a.disadvantages].map((w) => traitDef(w)?.name.toLowerCase() ?? traitKey(w)));
  const clean = (list: string[], kind: 'advantage' | 'disadvantage'): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const w of list) {
      const def = traitDef(w);
      if (!def || def.kind !== kind) { changes.push(kind === 'advantage' ? t('“{name}” was dropped: the game has no such advantage.', { name: w }) : t('“{name}” was dropped: the game has no such drawback.', { name: w })); continue; }
      if (def.only && def.only !== rules.powers) { changes.push(t('{name} was dropped: this world has no schools of power.', { name: t(def.name) })); continue; }
      const key = def.name.toLowerCase();
      const slot = def.detail ? `${key}: ${traitDetail(w).toLowerCase()}` : key;
      if (seen.has(slot) || given.has(key)) continue;
      if (def.detail && !traitDetail(w)) { changes.push(t('{name} was dropped: it did not say {detail}.', { name: t(def.name), detail: t(def.detail).toLowerCase() })); continue; }
      seen.add(slot);
      out.push(w.trim());
    }
    return out;
  };
  d.advantages = clean(d.advantages, 'advantage');
  d.disadvantages = clean(d.disadvantages, 'disadvantage');
  // Of two traits that cannot both be true, the advantage goes.
  const keys = () => new Set([...d.advantages, ...d.disadvantages, ...a.advantages, ...a.disadvantages].map((w) => traitDef(w)?.name.toLowerCase() ?? ''));
  d.advantages = d.advantages.filter((w) => {
    const def = traitDef(w)!;
    if (def.against && keys().has(def.against)) { changes.push(t('{name} was dropped: it cannot be true together with {other}.', { name: t(def.name), other: t(traitDef(def.against)?.name ?? def.against) })); return false; }
    return true;
  });

  // Abilities: known to the game, common knowledge, within the character's Focus, and no more than there is room for.
  const room = rules.powers === 'focus' ? PATHS.reduce((sum, k) => sum + (d.paths[k] ?? 0), 0) : 0;
  const abilities = [...new Set(d.abilities)].filter((id) => {
    const ab = ABILITIES[id];
    return !!ab && ab.tier <= STARTING_TIER && (d.paths[ab.path] ?? 0) >= ab.tier;
  }).slice(0, room);
  if (abilities.length !== d.abilities.length) changes.push(t('Abilities that cannot be known at the start were removed.'));
  d.abilities = abilities;

  // Still too dear? Trim, least essential first: advantages, then skills, then paths, then the highest attribute.
  for (let guard = 0; guard < 60; guard++) {
    const c = check(d, rules);
    if (c.left >= 0) break;
    if (d.advantages.length > 0) {
      const dearest = [...d.advantages].sort((x, y) => traitInfo(y, 'advantage').points - traitInfo(x, 'advantage').points)[0]!;
      d.advantages = d.advantages.filter((w) => w !== dearest);
      changes.push(t('{name} was dropped to fit the points.', { name: t(dearest) }));
    } else if (d.skills.length > 1) {
      changes.push(t('{name} was dropped to fit the points.', { name: t(d.skills.pop()!) }));
    } else if (PATHS.some((k) => (d.paths[k] ?? 0) > 0)) {
      const top = [...PATHS].sort((x, y) => (d.paths[y] ?? 0) - (d.paths[x] ?? 0))[0]!;
      d.paths[top] = (d.paths[top] ?? 0) - 1;
      if (!d.paths[top]) delete d.paths[top];
      d.abilities = d.abilities.filter((id) => (d.paths[ABILITIES[id]!.path] ?? 0) >= ABILITIES[id]!.tier).slice(0, PATHS.reduce((sum, k) => sum + (d.paths[k] ?? 0), 0));
      changes.push(t('{name} was lowered to fit the points.', { name: pathName(top) }));
    } else if (d.gift && d.gift.rank > 1) {
      // The power itself is what the player asked for: it is lowered, never taken away.
      d.gift = cleanGift({ ...d.gift, rank: d.gift.rank - 1 }, GIFT_AT_START);
      changes.push(t('The rank of your power was lowered to fit the points.'));
    } else {
      const top = [...ATTRIBUTES].sort((x, y) => d.attributes[y] - d.attributes[x])[0]!;
      if (d.attributes[top] === 0) break;
      d.attributes[top] -= 1;
      changes.push(t('{name} was lowered to fit the points.', { name: t(cap(top)) }));
    }
  }
  if (!d.name.trim()) d.name = input.name.trim();
  return { draft: d, changes };
}
