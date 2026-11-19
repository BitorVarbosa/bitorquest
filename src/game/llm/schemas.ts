// The shapes the cheap model must answer in. The same Zod schemas constrain Claude's output
// (structured outputs) and validate it on arrival.
import { z } from 'zod';
import { ATTRIBUTES, EFFECT_KINDS, PATHS, SKILLS, TAKING_KINDS, type PowersMode } from '../../engine';
import { PRICES, PRICE_WORDS } from '../money';

/**
 * The referee reads the player's input and says what kind of action it is. It never sees a die. The
 * shape is the same in every world but for one list: in a world of gifts an invented use may also copy
 * or take someone's power (see `refereeOutFor`).
 */
const refereeShape = (effects: readonly [string, ...string[]], words: string) => z.object({
  kind: z.enum(['talk', 'act', 'move', 'fight', 'ability', 'learn', 'invite', 'part', 'rest', 'trade', 'impossible', 'question', 'unclear'])
    .describe('invite: asking someone present to travel with the character from now on. part: telling a companion to stay behind or go their own way. talk: speaking with someone. act: doing something. move: going to another place. fight: attacking someone. ability: using a named ability. rest: resting or waiting. trade: buying, selling, paying, giving money or a thing carried, or changing money. impossible: the character cannot do this at all. question: the text is addressed to the narrator or the game, not to anyone in the story. unclear: the text could mean two different things and guessing wrong would matter.'),
  check: z.object({
    attribute: z.enum(ATTRIBUTES),
    skill: z.enum(SKILLS).nullable().describe('The skill that applies, whether or not the character has it; null when none does.'),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    label: z.string().describe('Three to six words for the roll log, such as "bluff past Captain Roth".'),
    opposed_by: z.string().nullable().describe('Id of the person resisting, or null.'),
  }).nullable().describe('A test only when the outcome is uncertain AND failure would be interesting. Ordinary talk and safe actions need none.'),
  targets: z.array(z.string()).describe('Ids of the people spoken to or acted on, from the list given.'),
  mentions: z.array(z.string()).describe('Names of people, places or things mentioned that are NOT in the lists given.'),
  recall: z.array(z.string()).describe('Keywords to search memory with, when the player reaches back to something earlier. Otherwise empty.'),
  move_to: z.string().nullable().describe('Id of the place they are trying to go to, from the ways out, or null.'),
  held: z.string().nullable().describe('Only when kind is move: what stands in the way of simply walking out, in a few words. Null when the character is free to go.'),
  ability: z.string().nullable().describe('Id of the ability used, attempted or asked to be taught, from the lists given, or null.'),
  improvise: z.object({
    path: z.enum(PATHS).nullable().describe('The path it belongs to. Null when the character’s power is one of their own (GIFT) and not a path.'),
    tier: z.number().describe('1 to 4, by reach.'),
    effect: z.enum(effects).describe(`What it would do in a fight: damage (it hurts someone), guard (it shields the character), stagger (someone loses their next action), dazzle (it spoils someone’s next attack), heal (it mends the character)${words}, or none.`),
  }).nullable().describe('Only when kind is ability and the effect is the player’s own invention, on none of the lists: the path it belongs to, how far it reaches, and what it would do in a fight. Otherwise null.'),
  minutes: z.number().describe('Roughly how long this takes in the story, in minutes. A rest or wait of days (camping until someone comes, waiting out a storm) is as long as it would likely last, two weeks at most.'),
  why_impossible: z.string().nullable().describe('One short sentence to the player, only when kind is impossible.'),
  ask: z.string().nullable().describe('Only when kind is unclear: one short question to the player that settles what they meant. Otherwise null.'),
  ask_options: z.array(z.string()).describe('Only when kind is unclear: two or three short answers the player could give, a few words each. Otherwise empty.'),
  trade: z.object({
    deal: z.enum(['buy', 'sell', 'give', 'exchange']).describe('buy: paying for something or a service. sell: selling something carried. give: handing over money or something carried, as a gift, a payment owed or a bribe. exchange: changing one money for another.'),
    what: z.string().describe('What is bought, sold or given, in a few words; for money given, what it is for.'),
    price: z.enum(PRICES).nullable().describe(`For buy and sell: what it would usually cost here, on this scale: ${PRICE_WORDS}. Null otherwise.`),
    amount: z.number().nullable().describe('Only when the player names an exact sum of money to give or exchange. Otherwise null.'),
    money: z.string().nullable().describe('The id of the money used, from PURSE; null for the first one.'),
    into: z.string().nullable().describe('Only for exchange: the id of the money wanted.'),
    item: z.string().nullable().describe('For sell, or give when what is given is something carried: its id from CARRYING. Otherwise null.'),
    keeps: z.boolean().describe('For buy: true when what is bought is a thing to carry away; false for a meal, a room, a fare or a service.'),
    haggle: z.boolean().describe('True when the player bargains over the price. A haggle needs a check (skill, Manipulation, medium, opposed by the seller).'),
  }).nullable().describe('Only when kind is trade. Otherwise null.'),
  contest: z.object({
    label: z.string().describe('A few words for the track, in the player’s language: "lose the watch in the market".'),
    length: z.enum(['short', 'long']).describe('short: three successes win it (a chase, a quick search, a climb). long: five (an investigation, a heist, winning over a crowd, a debate).'),
  }).nullable().describe('Only when this action starts something that takes several efforts to win and can be lost along the way. Each effort is a check, so give one. Null when no CONTEST line is given and nothing of the kind starts, and always null while a contest is on.'),
  toward_contest: z.boolean().describe('True when a CONTEST line is given and this action is an effort in it (give its check). False otherwise.'),
});
export const RefereeOut = refereeShape([...EFFECT_KINDS, 'none'], '');
/** The same in a world of gifts: an invented use may also copy someone's power, or take it from them, for the scene. */
export const RefereeOutGift = refereeShape([...EFFECT_KINDS, ...TAKING_KINDS, 'none'], ', copy (it takes on the power of someone present, for a while), steal (it takes someone’s power from them, for a while)');
export type RefereeOut = z.infer<typeof RefereeOut>;

/** The referee's answer shape for a world of this mode. */
export function refereeOutFor(mode: PowersMode): typeof RefereeOut {
  return (mode === 'gift' ? RefereeOutGift : RefereeOut) as typeof RefereeOut;
}

/** The scribe turns a finished scene into records. */
export const ScribeOut = z.object({
  summary: z.string().describe('The scene in at most three sentences, past tense, addressed to the player as "you".'),
  story_so_far: z.string().describe('The chapter so far in at most 100 words, updated to include this scene. Keep names, promises and unanswered questions; drop colour.'),
  events: z.array(z.object({
    text: z.string().describe('One sentence, past tense, starting with "You" where the protagonist acted.'),
    importance: z.enum(['small', 'notable', 'changed_something']),
    reach: z.enum(['secret', 'local', 'public']).describe('secret: only those present know. local: it will be talked about here. public: news that travels.'),
    actors: z.array(z.string()).describe('Ids of the people who acted, other than the protagonist.'),
    witnesses: z.array(z.string()).describe('Ids of the people who saw or heard it.'),
  })).describe('At most four things worth remembering that are NOT in the list of events already recorded.'),
  attitudes: z.array(z.object({
    who: z.string(),
    attitude: z.string().describe('One or two words.'),
    why: z.string().describe('A few words.'),
  })).describe('Only people whose feeling toward the protagonist changed in this scene.'),
  people: z.array(z.object({
    who: z.string(),
    change: z.enum(['moved', 'left', 'died']).describe('moved: they went to stay at another place, given in "to". left: they are gone for good, to nowhere the protagonist can follow for now. died: they are dead.'),
    to: z.string().nullable().describe('Only for moved: the id of the place, from PLACES NEARBY. Otherwise null.'),
    why: z.string().describe('A few words, as it would be said of them later: "went home to the mill", "killed by the wardens".'),
  })).describe('Almost always empty. Only for people listed under PEOPLE, and only when the transcript plainly shows them dying or leaving this place to stay somewhere else. Someone who steps out, goes to bed or will be back is not listed, and nobody who is travelling with the protagonist is.'),
  fronts: z.array(z.object({
    id: z.string(),
    change: z.enum(['set_back', 'stopped']).describe('set_back: what the protagonist did in this scene plainly hindered it. stopped: it ended it for good.'),
  })).describe('Almost always empty. Only for something listed under IN MOTION in the request, and only when the transcript shows the protagonist doing it.'),
  looks: z.array(z.object({
    who: z.string().describe('A person id, or "you" for the protagonist.'),
    look: z.string().describe('How they look at a glance now, in at most twelve words.'),
    change: z.string().describe('What changed, a few words: "a scar across the left cheek", "lost the fedora".'),
  })).describe('Almost always empty. Only when the transcript shows a lasting change to how someone looks (a wound that will scar, new clothes, a haircut, something lost or put on for good). Under LOOKS in the request is how they looked before.'),
  chapter: z.object({
    summary: z.string().describe('The whole chapter in at most 70 words, past tense, addressed to the player as "you": what was done, what changed, what was promised or broken. It will never be rewritten.'),
    gist: z.string().describe('The chapter in one line of at most 18 words.'),
    next_title: z.string().describe('Two to four words to title the chapter that begins now, from what is still open. No quotation marks.'),
  }).nullable().describe('Null, unless the request says that this scene ends a chapter.'),
});
export type ScribeOut = z.infer<typeof ScribeOut>;


/** The end of a story with an ending: what became of everyone. */
export const EpilogueOut = z.object({
  epilogue: z.string().describe('The epilogue, 180 to 320 words, second person, past tense for what happened and present for how things stand: what became of the protagonist, of the people who mattered most to them, and of the places and troubles of the story. Plain prose, short paragraphs separated by a blank line, no headings.'),
  legend: z.string().describe('One line, at most 25 words, as the people of this world would remember the protagonist years from now. Third person, by name.'),
});
export type EpilogueOut = z.infer<typeof EpilogueOut>;
