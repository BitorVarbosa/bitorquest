// Advantages, drawbacks and skills: what each one is, what it costs, and what it does in play.
//
// A trait is written on the sheet as a name ("Quick Reflexes"), or as a kind with its particulars
// after a colon ("Patron: Couriers' Guild"). A few are applied by the rules with a number, every
// time (see `has` in types.ts for where). Most are facts about the character with no number
// attached: the narrator is told them (they are on the YOU line of the scene packet) and lets them
// matter when the story touches them.
//
// The catalogue is Penta's own: the kinds are the common furniture of role-playing games, and every
// word here was written for this project. It is meant to grow.
import { traitKey, type PowersMode, type Sheet, type SkillName } from './types';

export type TraitKind = 'advantage' | 'disadvantage';

export interface TraitDef {
  /** The kind, as written before any colon: "Patron". */
  name: string;
  kind: TraitKind;
  /** Character points: what an advantage costs, or what a drawback gives back. */
  points: 1 | 2;
  /** Set when the trait needs particulars after a colon; says what to ask for: "which organisation". */
  detail?: string;
  /** One line: what it is. */
  summary: string;
  /** What it means in play, in two or three sentences. */
  text: string;
  /** rules: the engine applies it with a number. story: the narrator is told, and plays it. */
  how: 'rules' | 'story';
  /** For a rules trait, its effect in a few words: "+1 to initiative". */
  effect: string | null;
  /** The key of a trait that cannot be held together with this one. */
  against?: string;
  /** Set when the trait exists only in worlds with this kind of powers. */
  only?: 'extreme';
}

const adv = (name: string, points: 1 | 2, summary: string, text: string, more: Partial<TraitDef> = {}): TraitDef =>
  ({ name, kind: 'advantage', points, summary, text, how: 'story', effect: null, ...more });
const draw = (name: string, points: 1 | 2, summary: string, text: string, more: Partial<TraitDef> = {}): TraitDef =>
  ({ name, kind: 'disadvantage', points, summary, text, how: 'story', effect: null, ...more });

export const TRAIT_LIST: TraitDef[] = [
  // ----- Advantages the rules apply -----
  adv('Quick Reflexes', 1, 'You react before most people do.',
    'When a fight starts, everyone rolls Skill plus a die to set the order of action. You add 1 to yours, so you act before your opponents more often.',
    { how: 'rules', effect: '+1 to initiative' }),
  adv('Tough', 1, 'You can take more punishment than your frame suggests.',
    'Your hit points are 3 higher than your Resistance alone would give.',
    { how: 'rules', effect: '+3 hit points', against: 'frail' }),
  adv('Deep Reserves', 1, 'You have more to draw on than most.',
    'Your energy is 3 higher than your Resistance alone would give, which is three more uses of a small ability before you must rest.',
    { how: 'rules', effect: '+3 energy' }),
  adv('Keen Senses', 1, 'Little escapes your eyes and ears.',
    'Tests of searching, noticing and listening (the Investigation skill) are rolled one point easier, whether or not you have the skill.',
    { how: 'rules', effect: '+1 to noticing' }),
  adv('Iron Will', 1, 'Fear, pain and pressure get less of a grip on you.',
    'Tests of Resistance (holding out, keeping your nerve, shrugging off poison or exhaustion) are rolled one point easier.',
    { how: 'rules', effect: '+1 to Resistance tests' }),
  adv('Fast Healer', 1, 'You are back on your feet sooner than you should be.',
    'An hour of rest gives you back 2 hit points and 2 energy where others get 1. A full night restores everything, as for anyone.',
    { how: 'rules', effect: 'Rest counts double' }),

  // ----- The schools: powers in the Extreme mode, and only there -----
  adv('White School', 2, 'Light, sight, illusion and cleansing are yours to command.',
    'You can use every ability of the Light path. Each use costs energy by its reach (1, 3, 6 or 10), and none may cost more than five times your Skill. You can also shape effects of your own within the school, on a Skill test.',
    { how: 'rules', effect: 'Every Light ability', only: 'extreme' }),
  adv('Black School', 2, 'Shadow, silence, fear and decay are yours to command.',
    'You can use every ability of the Dark path. Each use costs energy by its reach (1, 3, 6 or 10), and none may cost more than five times your Skill. You can also shape effects of your own within the school, on a Skill test.',
    { how: 'rules', effect: 'Every Dark ability', only: 'extreme' }),
  adv('Elemental School', 2, 'Fire, water, air and earth are yours to command.',
    'You can use every ability of the Fire, Water, Air and Earth paths. Each use costs energy by its reach (1, 3, 6 or 10), and none may cost more than five times your Skill. You can also shape effects of your own within the school, on a Skill test.',
    { how: 'rules', effect: 'Every Fire, Water, Air and Earth ability', only: 'extreme' }),

  // ----- Advantages the narrator plays -----
  adv('Patron', 1, 'An organisation stands behind you.',
    'It gives you work, a roof and now and then help, and it expects loyalty and results in return. Its name opens some doors and closes others.',
    { detail: 'Which organisation' }),
  adv('Ally', 1, 'Someone capable is on your side.',
    'Not a companion on the road, but a person of some weight who will help when you ask, within reason and at some cost to themselves. Ask too often and it wears thin.',
    { detail: 'Who' }),
  adv('Contacts', 1, 'You know people who hear things.',
    'In one walk of life (the docks, the court, the trade roads) there are people who will tell you what is being said, for a favour or a coin.',
    { detail: 'Among whom' }),
  adv('Wealth', 2, 'Money is not what stops you.',
    'You live comfortably. Ordinary costs (a room, a meal, a horse, a bribe of the usual size) are not obstacles; only the extraordinary needs thinking about.',
    { against: 'poor' }),
  adv('Good Name', 1, 'People have heard well of you.',
    'Where your name is known, strangers start out inclined to trust you. It is worth protecting, and it can be spent.',
    { detail: 'For what, and where', against: 'bad name' }),
  adv('Rank', 2, 'You hold a title or an office.',
    'Some people must listen to you, and some doors open because of what you are. It comes with duties and with people who want it for themselves.',
    { detail: 'What rank' }),
  adv('Mentor', 1, 'Someone wiser is teaching you.',
    'They give advice worth having and can teach you what they know, abilities included, when you can reach them. They have their own reasons.',
    { detail: 'Who' }),
  adv('Safe Haven', 1, 'There is one place where you are safe.',
    'A house, a ship, a cellar: somewhere you can rest, hide and leave things, and where the people will not give you up lightly.',
    { detail: 'Where' }),
  adv('Heirloom', 1, 'You carry something with a history.',
    'An object of note: well made, recognisable, perhaps more than it seems. It can be lost, stolen or claimed by someone else.',
    { detail: 'What it is' }),
  adv('Animal Companion', 1, 'An animal goes where you go.',
    'Trained, loyal and clever for its kind. It can scout, carry, warn and comfort. It does not fight your battles for you, and it can be hurt.',
    { detail: 'What animal' }),
  adv('Local Knowledge', 1, 'You know one place by heart.',
    'Its back ways, its customs, who matters and who owes whom. In that place you are rarely lost and seldom surprised.',
    { detail: 'Of where' }),
  adv('Striking Presence', 1, 'People notice you and remember you well.',
    'First impressions tend to go your way, and a room turns when you want it to. It makes going unnoticed harder.'),
  adv('Sharp Memory', 1, 'You forget very little.',
    'Faces, routes, the exact words someone used. When you reach back for something you saw or heard, the narrator gives it to you straight.'),
  adv('Gift for Tongues', 1, 'Languages come easily to you.',
    'You get by in a new tongue within days and pass for fluent within weeks, and you can usually make out the gist of a script you were never taught.'),

  // ----- Drawbacks the rules apply -----
  draw('Frail', 1, 'You break more easily than most.',
    'Your hit points are 3 lower than your Resistance alone would give (never less than 1).',
    { how: 'rules', effect: '−3 hit points', against: 'tough' }),

  // ----- Drawbacks the narrator plays -----
  draw('Code', 1, 'A rule you live by.',
    'People who know you count on it. You can always break it, and when you do it costs you: in trust, in standing, or in how you see yourself.',
    { detail: 'What rule' }),
  draw('Dependent', 1, 'Someone relies on you.',
    'They need your care or your money, and people who want to get at you can reach them. Their safety is a reason to hurry home, and a lever in the wrong hands.',
    { detail: 'Who' }),
  draw('Hunted', 2, 'Someone is looking for you.',
    'They turn up when it is least convenient, and others may be paid to say where you are. Staying long in one place, or being noticed, has a price.',
    { detail: 'By whom' }),
  draw('Curious', 1, 'You find it hard to leave a question alone.',
    'The story will put closed doors and half-heard things in your way. What you do about them stays your choice; the temptation is the drawback.'),
  draw('Debt', 1, 'You owe more than you can easily pay.',
    'The one you owe has a claim on your time or your purse and will press it, politely at first.',
    { detail: 'To whom' }),
  draw('Bad Name', 1, 'People have heard ill of you.',
    'Where your name is known, strangers start out wary, and some will not deal with you at all. Whether you earned it is another matter.',
    { detail: 'For what', against: 'good name' }),
  draw('Rival', 1, 'Someone wants what you want.',
    'About as able as you are, and after the same prize. Not an enemy to the death, but they will not pass up a chance to get ahead of you.',
    { detail: 'Who' }),
  draw('Secret', 1, 'There is something you cannot let be known.',
    'If it came out it would cost you dearly. Someone, somewhere, knows or could find out.',
    { detail: 'What it is' }),
  draw('Vow', 1, 'You have sworn to do something.',
    'It shapes where you can go and what you can agree to, and others may hold you to it. Giving it up should be a moment in the story, not a shrug.',
    { detail: 'To do what' }),
  draw('Fear', 1, 'One thing unmans you.',
    'Faced with it you hesitate, and others can see it. You may master it in the moment, but it is never easy and never free.',
    { detail: 'Of what' }),
  draw('Soft-hearted', 1, 'You find it hard to walk past suffering.',
    'A plea, a child, a wounded enemy: the story will put them in your way when you can least afford the time.'),
  draw('Hot-headed', 1, 'Your temper is quicker than your judgement.',
    'An insult or a threat pulls at you. Keeping your voice level when provoked is a choice you have to make each time.'),
  draw('Honest to a Fault', 1, 'Lying sits badly with you.',
    'You can do it, but people who know you can tell, and a bold lie to someone who trusts you costs you something.'),
  draw('Outsider', 1, 'You are plainly not from here.',
    'Your speech, your looks or your ways mark you. Some doors stay shut, prices are higher, and blame finds you first.',
    { detail: 'From where' }),
  draw('Poor', 1, 'Your means are thin.',
    'A room, a meal, a fare: ordinary costs are real obstacles, and you start with little. Money is a reason to take work you would rather refuse.',
    { against: 'wealth' }),
  draw('Wanted', 2, 'The law is after you.',
    'In some places your face or your name means arrest. Officials are a danger, and anyone who recognises you has something to sell.',
    { detail: 'By which law, and where' }),
  draw('Marked', 1, 'You are easy to describe.',
    'A scar, a height, a voice, a way of dressing you will not give up. People remember having seen you, and disguise is hard.',
    { detail: 'How' }),
  draw('Bound by Duty', 1, 'Your time is not all your own.',
    'Someone can call on you and expects to be obeyed: a lord, an order, a family. Refusing has consequences.',
    { detail: 'To whom' }),
  draw('Haunted', 1, 'Something in your past will not stay there.',
    'It returns in bad nights and at bad moments, and now and then in the flesh: a person, a place, a thing you did.',
    { detail: 'By what' }),
];

const BY_KEY = new Map(TRAIT_LIST.map((t) => [t.name.toLowerCase(), t]));

/** The catalogue entry for a trait as written on a sheet, or undefined when there is none. */
export function traitDef(written: string): TraitDef | undefined {
  const head = traitKey(written);
  const exact = BY_KEY.get(head);
  if (exact) return exact;
  // "Curious to a fault" is the trait Curious with a flourish: the kind matches on whole words.
  for (const [key, def] of BY_KEY) if (head.startsWith(`${key} `)) return def;
  return undefined;
}

/** The catalogue for a world: every trait of a kind, less the ones that belong to another kind of powers. */
export function traitsFor(kind: TraitKind, powers: PowersMode): TraitDef[] {
  return TRAIT_LIST.filter((t) => t.kind === kind && (!t.only || t.only === powers));
}

/** The particulars written after the colon, or '' when there are none. */
export function traitDetail(written: string): string {
  const at = written.indexOf(':');
  return at < 0 ? '' : written.slice(at + 1).trim();
}

export interface TraitInfo {
  /** As written on the sheet. */
  written: string;
  summary: string;
  text: string;
  how: 'rules' | 'story';
  effect: string | null;
  /** Character points: its cost, or what it gives back. A trait with no entry counts as 1. */
  points: number;
  /** False when there is no entry for this trait and only the general case can be described. */
  known: boolean;
}

const UNKNOWN: Record<TraitKind, Pick<TraitInfo, 'summary' | 'text' | 'how' | 'effect'>> = {
  advantage: {
    summary: 'Something that works in your favour.',
    text: 'The game has no fixed rule for this one. The narrator is told about it and lets it help when the story touches it.',
    how: 'story', effect: null,
  },
  disadvantage: {
    summary: 'Something that works against you.',
    text: 'The game has no fixed rule for this one. The narrator is told about it and lets it complicate things when the story touches it.',
    how: 'story', effect: null,
  },
};

/** What a trait on the sheet is and does. Never fails: a trait without an entry gets the general description. */
export function traitInfo(written: string, kind: TraitKind): TraitInfo {
  const name = written.trim();
  const def = traitDef(name);
  if (def && def.kind === kind) return { written: name, summary: def.summary, text: def.text, how: def.how, effect: def.effect, points: def.points, known: true };
  return { written: name, ...UNKNOWN[kind], points: 1, known: false };
}

/** The traits the narrator must be told about: the ones the rules do not already apply by themselves. */
export function storyTraits(sheet: Pick<Sheet, 'advantages' | 'disadvantages'>): { advantages: string[]; drawbacks: string[] } {
  return {
    advantages: sheet.advantages.filter((t) => traitInfo(t, 'advantage').how === 'story'),
    drawbacks: sheet.disadvantages.filter((t) => traitInfo(t, 'disadvantage').how === 'story'),
  };
}

/** What each skill covers, in one line. */
export const SKILL_INFO: Record<SkillName, string> = {
  Animals: 'Handling, riding, calming and reading animals.',
  Arts: 'Performing, making and judging music, images, stories and craftwork.',
  Athletics: 'Running, climbing, jumping, swimming and keeping your balance.',
  Crime: 'Moving unseen, locks, sleight of hand and the ways of the underworld.',
  Investigation: 'Searching, noticing, questioning and piecing clues together.',
  Languages: 'Speaking, reading and deciphering tongues and scripts.',
  Machines: 'Building, repairing, driving and disabling devices and vehicles.',
  Manipulation: 'Persuading, bluffing, bargaining, charming and intimidating.',
  Medicine: 'Treating wounds and illness; knowing bodies, cures and poisons.',
  Science: 'Knowledge of the natural world, numbers and scholarly lore.',
  Survival: 'Finding the way, food and shelter in the wild; tracking and reading the weather.',
};
