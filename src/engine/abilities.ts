// Abilities: one library, and three ways of having powers.
//
//   Focus    Six paths, each rated 0 to 5. An ability needs Focus in its path at least equal to its
//            tier and costs energy equal to its tier. It must be known: a few at the start, the rest
//            found in the story (taught by someone, or worked out by trying) and then learned.
//   Extreme  No paths. Three schools, bought as advantages. Owning a school is knowing every ability
//            of its paths; each use has a fixed cost that rises steeply with the tier, and none may
//            cost more than five times the character's Skill. The limit is the energy pool.
//   Gift     No library at all: one power of the character's own, with a rank and a few moves. Its
//            rules are in gift.ts; this file answers for it wherever a mode is asked about.
//
// Effects are built from a few primitives the engine understands; everything else is left to the narration.
//
// The library is Penta's own. Each path is a domain of effects, not only a literal element:
//   Fire   energy and destruction        Earth  protection, endurance, matter
//   Water  healing, the body, change     Light  perception, illusion, cleansing
//   Air    movement, sound, the senses   Dark   shadow, fear, decay
// A world may rename the paths and the abilities; the numbers stay as they are here.
import { GIFT_RANK_MAX, OWN_POWER, movesOf, powerById, powersOf } from './gift';
import { PATHS, has, type Difficulty, type Path, type PowersMode, type Sheet } from './types';

export type CombatEffect =
  | { type: 'guard'; value: number } // + value to your defence until your next turn
  | { type: 'stagger' } // the target loses its next action
  | { type: 'dazzle'; value: number } // - value to the target's next attack
  | { type: 'damage'; value: number } // direct damage, ignores defence
  | { type: 'heal'; value: number }
  | { type: 'seal'; turns: number }; // the target's powers are stopped for that many of their turns (only someone else's power does this)

/** Something a character can use for energy: an ability of the library, or a move of their own gift. */
export interface Power {
  id: string;
  name: string;
  tier: number;
  /** Energy per use. */
  cost: number;
  text: string;
  /** What it does in a fight, if anything. */
  combat?: CombatEffect & { needsTarget: boolean };
  /**
   * Set for a move of a gift: its name and text are the player's own words (or a model's on their
   * behalf), in the story's language already. They are shown as written and never looked up in a
   * dictionary: a move called "Spark" must not turn into the library's Spark in another language.
   */
  own?: true;
  /** For a move: the id of the power it belongs to among the character's powers ("own", or an art's). */
  of?: string;
}

/** An ability of the library: it belongs to a path. */
export interface Ability extends Power {
  path: Path;
  own?: undefined;
}

/** Abilities of this tier or lower are common knowledge: a character may start with them. Higher ones must be found in the world. */
export const STARTING_TIER = 2;

type Fight = Ability['combat'];
const guard = (value: number): Fight => ({ type: 'guard', value, needsTarget: false });
const stagger: Fight = { type: 'stagger', needsTarget: true };
const dazzle = (value: number): Fight => ({ type: 'dazzle', value, needsTarget: true });
const damage = (value: number): Fight => ({ type: 'damage', value, needsTarget: true });
const heal = (value: number): Fight => ({ type: 'heal', value, needsTarget: false });

function ability(id: string, name: string, path: Path, tier: number, text: string, combat?: Fight): Ability {
  return { id, name, path, tier, cost: tier, text, ...(combat ? { combat } : {}) };
}

const LIST: Ability[] = [
  // ----- Fire: energy and destruction -----
  ability('spark', 'Spark', 'fire', 1, 'A spark from your fingers: it lights a wick, startles an animal, stings bare skin.', damage(2)),
  ability('hearthwarm', 'Hearthwarm', 'fire', 1, 'Hold a comfortable warmth around you and whoever stands close, for an hour.'),
  ability('firedart', 'Firedart', 'fire', 2, 'A dart of flame at someone within a stone’s throw.', damage(4)),
  ability('quench', 'Quench', 'fire', 2, 'Draw the heat out of a fire the size of a hearth until it dies, or out of metal until it can be held.'),
  ability('furnace_breath', 'Furnace Breath', 'fire', 3, 'A rush of fire in front of you that leaves scorched ground behind.', damage(6)),
  ability('wildfire', 'Wildfire', 'fire', 4, 'Set a blaze that spreads where you point it, through a room or along a wall, and burns until it is put out.', damage(8)),

  // ----- Water: healing, the body, change -----
  ability('mend', 'Mend', 'water', 1, 'Close a cut and ease a bruise, yours or someone’s you touch.', heal(3)),
  ability('clearwater', 'Clearwater', 'water', 1, 'Make a cupful of foul water, or a plate of doubtful food, safe.'),
  ability('second_wind', 'Second Wind', 'water', 2, 'Knit torn flesh and bring breath back to someone flagging.', heal(5)),
  ability('mistcloak', 'Mistcloak', 'water', 2, 'Raise a mist thick enough to hide a room or a stretch of road for a few minutes.', guard(3)),
  ability('knit_bone', 'Knit Bone', 'water', 3, 'Set and heal a wound that would otherwise take weeks.', heal(8)),
  ability('borrowed_face', 'Borrowed Face', 'water', 4, 'Wear the face and build of someone you have studied, for an hour.'),

  // ----- Air: movement, sound, the senses -----
  ability('featherstep', 'Featherstep', 'air', 1, 'Move without sound or weight for a moment.', guard(2)),
  ability('whisper', 'Whisper', 'air', 1, 'Send a few words to one person you can see, unheard by anyone else.'),
  ability('gale_push', 'Gale Push', 'air', 2, 'A blast of wind that shoves one opponent back or clears smoke, sand or arrows from the air.', stagger),
  ability('windcallers_ear', 'Windcaller’s Ear', 'air', 2, 'Hear a conversation carried on the wind.'),
  ability('long_step', 'Long Step', 'air', 3, 'Cross a gap, a street or a river’s narrows in one stride.'),
  ability('stormcall', 'Stormcall', 'air', 4, 'Call wind and rain over the place where you stand: it comes within the hour and stays a while.'),

  // ----- Earth: protection, endurance, matter -----
  ability('stoneskin', 'Stoneskin', 'earth', 1, 'Harden your skin against the next blows.', guard(2)),
  ability('sure_footing', 'Sure Footing', 'earth', 1, 'Keep your feet on ice, a ledge or a rolling deck as if on a floor.'),
  ability('hold_fast', 'Hold Fast', 'earth', 2, 'Root someone’s feet to the ground for a moment.', stagger),
  ability('stone_ward', 'Stone Ward', 'earth', 2, 'Raise a ridge of earth or stone to stand behind.', guard(4)),
  ability('shape_stone', 'Shape Stone', 'earth', 3, 'Soften stone or packed earth and work it by hand: a hole through a wall, a step, a seal.'),
  ability('unyielding', 'Unyielding', 'earth', 4, 'For a few minutes nothing moves you and little hurts you.', guard(6)),

  // ----- Light: perception, illusion, cleansing -----
  ability('glimmer', 'Glimmer', 'light', 1, 'A small light, or a flash that dazzles someone looking at it.', dazzle(2)),
  ability('dusk_eyes', 'Dusk Eyes', 'light', 1, 'See in the dark as at dusk, for an hour.'),
  ability('lantern_veil', 'Lantern Veil', 'light', 2, 'Fold the light around something small so that a passing glance slides over it.'),
  ability('false_image', 'False Image', 'light', 2, 'A silent image the size of a person, convincing at a glance.', dazzle(3)),
  ability('cleanse', 'Cleanse', 'light', 3, 'Burn a poison, a rot or a fever out of a body.', heal(6)),
  ability('daybreak', 'Daybreak', 'light', 4, 'A burst of light as bright as noon that blinds those facing it and shows what was hidden.', dazzle(5)),

  // ----- Dark: shadow, fear, decay -----
  ability('deepen_shadow', 'Deepen Shadow', 'dark', 1, 'Thicken the shadows where you stand, enough to be overlooked.', guard(2)),
  ability('chill', 'Chill', 'dark', 1, 'A touch of cold dread: one person’s hand is less sure for a moment.', dazzle(2)),
  ability('dread', 'Dread', 'dark', 2, 'Fear takes hold of one person, who loses the moment to it.', stagger),
  ability('rot', 'Rot', 'dark', 2, 'Age wood, rope, leather or iron under your hand until it gives.'),
  ability('wither', 'Wither', 'dark', 3, 'Strength drains out of someone you can see.', damage(6)),
  ability('hush', 'Hush', 'dark', 4, 'No sound leaves the room you stand in until you allow it.'),
];

export const ABILITIES: Record<string, Ability> = Object.fromEntries(LIST.map((a) => [a.id, a]));

export function abilityById(id: string): Ability | undefined {
  return ABILITIES[id];
}

/** The abilities of a path, lowest tier first. */
export function abilitiesOf(path: Path): Ability[] {
  return LIST.filter((a) => a.path === path).sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
}

/** Every ability, by path in the usual order, lowest tier first. */
export function allAbilities(): Ability[] {
  return PATHS.flatMap((p) => abilitiesOf(p));
}

/** The schools of the Extreme mode: the advantage that grants each, and the paths it covers. */
export const SCHOOLS = {
  white: { name: 'White School', paths: ['light'] as Path[], text: 'Light, sight, illusion and cleansing.' },
  black: { name: 'Black School', paths: ['dark'] as Path[], text: 'Shadow, silence, fear and decay.' },
  elemental: { name: 'Elemental School', paths: ['fire', 'water', 'air', 'earth'] as Path[], text: 'Fire, water, air and earth.' },
} as const;
export type SchoolId = keyof typeof SCHOOLS;
export const SCHOOL_IDS = Object.keys(SCHOOLS) as SchoolId[];

/** What one use costs in the Extreme mode, by tier: fixed, and steep. */
export const EXTREME_COST = [0, 1, 3, 6, 10] as const;
/** In the Extreme mode no single use may cost more than this many times the character's Skill. */
export const EXTREME_SKILL_FACTOR = 5;

/** The schools a character owns (Extreme mode). */
export function schoolsOf(sheet: Pick<Sheet, 'advantages'>): SchoolId[] {
  return SCHOOL_IDS.filter((id) => has(sheet.advantages, SCHOOLS[id].name.toLowerCase()));
}
const schoolFor = (path: Path): SchoolId => SCHOOL_IDS.find((id) => SCHOOLS[id].paths.includes(path))!;

/** Energy for one use of an ability or a move, in a mode. */
export function abilityCost(ability: Pick<Power, 'tier' | 'cost'>, mode: PowersMode): number {
  return mode === 'extreme' ? EXTREME_COST[Math.max(1, Math.min(4, ability.tier))]! : ability.cost;
}

/** The library abilities a character has at their command: the ones learned (Focus), or everything of the schools they own (Extreme). None in any other world. */
export function libraryOf(sheet: Sheet, mode: PowersMode): Ability[] {
  if (mode === 'extreme') { const owned = schoolsOf(sheet); return LIST.filter((a) => owned.includes(schoolFor(a.path))); }
  if (mode === 'focus') return sheet.abilities.map((id) => ABILITIES[id]).filter((a): a is Ability => !!a);
  return [];
}

/** Everything a character can use for energy in a world of this mode: library abilities, or the moves of their gift. */
export function commandOf(sheet: Sheet, mode: PowersMode): Power[] {
  return mode === 'gift' ? movesOf(sheet) : libraryOf(sheet, mode);
}

/** One of those by its id, whether or not the character can use it now: a library ability, or in a world of gifts a move of theirs. */
export function powerOf(sheet: Pick<Sheet, 'gift' | 'arts'>, id: string, mode: PowersMode): Power | undefined {
  if (mode === 'gift') return movesOf(sheet).find((m) => m.id === id);
  return mode === 'off' ? undefined : ABILITIES[id];
}

export type CannotUse =
  | 'unknown' // no such ability
  | 'not_learned' // Focus: not among the ones learned. Extreme: its school is not owned
  | 'focus' // Focus: the path is not high enough
  | 'skill' // Extreme: it would cost more than five times Skill
  | 'rank' // Gift: it reaches further than the rank of the gift
  | 'no_gift' // Gift: the character has no power of their own
  | 'energy' // not enough energy left
  | 'no_powers'; // this world has none

/** Whether a character can use an ability right now, what it costs, and if not, why. */
export function canUseAbility(sheet: Sheet, id: string, mode: PowersMode = 'focus'): { ok: true; ability: Power; cost: number } | { ok: false; reason: CannotUse } {
  if (mode === 'gift') {
    // A move of one of the character's powers. The library does not exist here, whatever the id.
    if (powersOf(sheet).length === 0) return { ok: false, reason: 'no_gift' };
    const move = movesOf(sheet).find((m) => m.id === id);
    if (!move) return { ok: false, reason: 'unknown' };
    if (move.tier > (powerById(sheet, move.of ?? OWN_POWER)?.gift.rank ?? 0)) return { ok: false, reason: 'rank' };
    if (sheet.energy < move.cost) return { ok: false, reason: 'energy' };
    return { ok: true, ability: move, cost: move.cost };
  }
  const ability = ABILITIES[id];
  if (!ability) return { ok: false, reason: 'unknown' };
  if (mode === 'off') return { ok: false, reason: 'no_powers' };
  const cost = abilityCost(ability, mode);
  if (mode === 'extreme') {
    if (!schoolsOf(sheet).includes(schoolFor(ability.path))) return { ok: false, reason: 'not_learned' };
    if (cost > sheet.skill * EXTREME_SKILL_FACTOR) return { ok: false, reason: 'skill' };
  } else {
    if (!sheet.abilities.includes(id)) return { ok: false, reason: 'not_learned' };
    if ((sheet.paths[ability.path] ?? 0) < ability.tier) return { ok: false, reason: 'focus' };
  }
  if (sheet.energy < cost) return { ok: false, reason: 'energy' };
  return { ok: true, ability, cost };
}

// ---------- Beyond what is learned ----------

/** Trying something that is not learned costs this much more energy than using it would, and the energy is spent either way. */
export const ATTEMPT_EXTRA = 1;

/**
 * Focus mode: an ability of the library that is not learned can still be attempted when the path is
 * high enough for it. It is a hard Skill test and costs one energy more. A success works this once,
 * and the character has worked out how it is done: the ability is found, and can be learned.
 */
export function canAttempt(sheet: Sheet, id: string): { ok: true; ability: Ability; cost: number; difficulty: Difficulty } | { ok: false; reason: CannotUse } {
  const ability = ABILITIES[id];
  if (!ability) return { ok: false, reason: 'unknown' };
  if ((sheet.paths[ability.path] ?? 0) < ability.tier) return { ok: false, reason: 'focus' };
  const cost = ability.cost + ATTEMPT_EXTRA;
  if (sheet.energy < cost) return { ok: false, reason: 'energy' };
  return { ok: true, ability, cost, difficulty: 'hard' };
}

/**
 * An effect of the player's own invention, on none of the lists: allowed within a path the character
 * has (Focus: path at least the tier; Extreme: the school that covers it). Always a Skill test: hard
 * in the Focus mode, where it also costs one energy more than an ability of that tier; medium in the
 * Extreme mode, at that mode's cost. It works once and leaves nothing to learn.
 *
 * In a world of gifts there is no path: the effect must lie within one of the character's powers (the
 * referee judges that, and names which) and reach no further than that power's rank. A medium Skill
 * test, at one energy more than a move of that tier. There, a use that worked can be kept as a move
 * (gift.ts). `power` is the id of the power it belongs to; with none, the one by nature, or the first.
 */
export function canImprovise(sheet: Sheet, path: Path | null, tier: number, mode: PowersMode, power?: string): { ok: true; cost: number; difficulty: Difficulty } | { ok: false; reason: CannotUse } {
  if (mode === 'off') return { ok: false, reason: 'no_powers' };
  const t = Math.max(1, Math.min(4, Math.round(tier) || 1));
  if (mode === 'gift') {
    const held = (power ? powerById(sheet, power) : undefined) ?? powersOf(sheet)[0];
    if (!held) return { ok: false, reason: 'no_gift' };
    if (t > Math.min(held.gift.rank, GIFT_RANK_MAX)) return { ok: false, reason: 'rank' };
    const cost = t + ATTEMPT_EXTRA;
    return sheet.energy < cost ? { ok: false, reason: 'energy' } : { ok: true, cost, difficulty: 'medium' };
  }
  // In a world of paths or schools an effect of one's own belongs to one of them.
  if (!path) return { ok: false, reason: 'not_learned' };
  if (mode === 'extreme') {
    if (!schoolsOf(sheet).includes(schoolFor(path))) return { ok: false, reason: 'not_learned' };
    const cost = EXTREME_COST[t]!;
    if (cost > sheet.skill * EXTREME_SKILL_FACTOR) return { ok: false, reason: 'skill' };
    return sheet.energy < cost ? { ok: false, reason: 'energy' } : { ok: true, cost, difficulty: 'medium' };
  }
  if ((sheet.paths[path] ?? 0) < t) return { ok: false, reason: 'focus' };
  const cost = t + ATTEMPT_EXTRA;
  return sheet.energy < cost ? { ok: false, reason: 'energy' } : { ok: true, cost, difficulty: 'hard' };
}

// ---------- Being taught, and learning ----------

/** An ability the character has a source for and has not learned yet. `by` is who showed it; absent when it was worked out alone. */
export interface Found {
  id: string;
  by?: string;
}

/**
 * How well someone must know the character before they will teach an ability of a tier, as a bond
 * stage (1 Acquaintance, 2 Friendly, 3 Trusted, 4 Close): the tier itself. A mentor teaches one
 * stage sooner. Nobody teaches a stranger anything but a mentor's first lesson.
 */
export function teachingStage(tier: number, mentor: boolean): number {
  return Math.max(0, Math.max(1, Math.min(4, tier)) - (mentor ? 1 : 0));
}

export type CannotLearn = 'unknown' | 'not_found' | 'known' | 'focus' | 'xp';

/** Whether a found ability can be learned now: it takes Focus in its path at least its tier, and a point of experience. */
export function canLearn(sheet: Sheet, found: Found[], id: string, xp: number, cost: number): CannotLearn | null {
  const ability = ABILITIES[id];
  if (!ability) return 'unknown';
  if (sheet.abilities.includes(id)) return 'known';
  if (!found.some((f) => f.id === id)) return 'not_found';
  if ((sheet.paths[ability.path] ?? 0) < ability.tier) return 'focus';
  return xp < cost ? 'xp' : null;
}

/** Learning is a Skill test: easy when someone showed how, medium when it was worked out alone. */
export function learnDifficulty(found: Found): Difficulty {
  return found.by ? 'easy' : 'medium';
}
