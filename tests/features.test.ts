// The features added on 2026-11-19: money that moves, looks, things kept as true, efforts that add up,
// another take, letting time pass, and stories that end.
import { describe, expect, it } from 'vitest';
import { storyBook } from '../src/game/book';
import { APPEARANCE_MAX, CARD_MAX, LOOK_MAX, PACKET_MAX_CHARS, buildPacket, personCard, protagonistCard } from '../src/game/cards';
import { ENDING_CHAPTERS, finalComes } from '../src/game/chapters';
import { proposalFrom, startSeed, startingCompanions } from '../src/game/creation';
import { pictureWords } from '../src/game/llm/requests';
import type { CharacterOut } from '../src/game/llm/architect';
import { mockArchitect } from '../src/game/llm/mockArchitect';
import type { LlmRequest } from '../src/game/llm/transport';
import { amountOf, cleanMoney, currenciesOf, exchanged, pay, payable, priceIn, purseOf, purseWords } from '../src/game/money';
import { FACTS_MAX, WAIT } from '../src/game/session';
import { currentScene, newStory } from '../src/game/story';
import type { Note, Story } from '../src/game/types';
import { creationRules } from '../src/game/world';
import { glassRoadSeed } from '../src/packs/lanternCoast';
import { builtHarness, demoTemplate, harness } from './helpers';

const ends = (story: string, ...facts: string[]) => `${story}\n===\n${facts.join('\n')}`;
const REF = { check: null, targets: [] as string[], mentions: [], recall: [], move_to: null, held: null, ability: null, improvise: null, minutes: 5, why_impossible: null, ask: null, ask_options: [], trade: null, contest: null, toward_contest: false };
const trade = (t: Record<string, unknown>, over: Record<string, unknown> = {}) => ({ ...REF, kind: 'trade', ...over, trade: { what: 'a thing', price: null, amount: null, money: null, into: null, item: null, keeps: false, haggle: false, ...t } });
const notesOf = (story: Story): Note[] => story.scenes.flatMap((sc) => sc.turns).flatMap((t) => t.beats).flatMap((b) => (b.type === 'notes' ? b.notes : []));
const text = (req: LlmRequest): string => req.params.messages.map((m) => (typeof m.content === 'string' ? m.content : m.content.map((b) => (b.type === 'text' ? b.text : '')).join(''))).join('\n');
const SCRIBE = { summary: 'You were there.', story_so_far: '', events: [], attitudes: [], people: [], fronts: [], looks: [], chapter: null };

describe('money', () => {
  it('turns price words into amounts in each money, and coins of one money pay for each other with change', () => {
    const story = newStory(glassRoadSeed(), 0);
    const [mark, copper] = currenciesOf(story.world);
    expect(priceIn('cheap', mark!)).toBe(2);
    expect(priceIn('cheap', copper!)).toBe(20);
    expect(priceIn('trivial', { worth: 'great' })).toBe(1); // never less than a coin
    expect(purseWords(story)).toBe('34 silver marks, 12 coppers');
    // 40 marks asked: 34 marks and 60 coppers make 40; the coppers go first only after the marks.
    expect(payable(story, mark!)).toBe(35);
    expect(pay(story, mark!, 36)).toBe(false);
    expect(pay(story, mark!, 35)).toBe(true);
    expect(purseOf(story)).toEqual({ mark: 0, copper: 2 });
    // A copper's price paid with a mark gives change in coppers.
    story.protagonist.purse = { mark: 1, copper: 0 };
    expect(pay(story, copper!, 3)).toBe(true);
    expect(purseOf(story)).toEqual({ mark: 0, copper: 7 });
    expect(story.protagonist.silver).toBe(0);
    // Changing money: coins of one money at their worth, other moneys at a money changer's cut.
    expect(exchanged(10, mark!, copper!)).toBe(100);
    expect(exchanged(10, { id: 'crown', worth: 'large' }, { id: 'scrip', worth: 'common' })).toBe(90);
  });

  it('keeps what a world builder wrote within bounds', () => {
    const slug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const out = cleanMoney([{ id: 'g', name: 'galleons', one: 'galleon', text: 'Gold.', worth: 'large' }, { id: 'k', name: 'knuts', worth: 'nonsense', of: 'g' }, { name: '' }, { id: 'x', name: 'x', of: 'nowhere' }, { name: 'd' }], slug);
    expect(out.map((c) => [c.id, c.worth, c.of ?? null])).toEqual([['g', 'large', null], ['k', 'common', 'g'], ['x', 'common', null]]);
    expect(cleanMoney([], slug)).toEqual([]);
  });

  it('starts a character with the world’s first money, as Wealth or Poor say', async () => {
    const template = await demoTemplate();
    expect(template.world.money?.map((c) => c.id)).toEqual(['mark', 'penny', 'scrip']);
    const answer = mockArchitect({ step: 'character', input: { source: { kind: 'description', text: '' }, premise: 'a clerk', name: 'Robin', table: { style: 'adventure', powers: 'focus', companions: 0, romance: false, violence: 'moderate', leaveOut: '', language: 'en', narration: 'medium' } }, done: {}, world: template.world }) as CharacterOut;
    const who = proposalFrom(answer, creationRules(template.world), 'Robin');
    expect(who.look).toMatch(/coat/);
    const seed = startSeed(template, who, { id: 's', seed: 1 });
    expect(seed.protagonist.purse).toEqual({ mark: 30 });
    expect(seed.protagonist.look).toBe(who.look);
    // A world without money gives none.
    const poor = structuredClone(template);
    poor.world.money = [];
    expect(startSeed(poor, who, { id: 's', seed: 1 }).protagonist.purse).toEqual({});
  });

  it('buys at the rules’ price, refuses what cannot be paid, and a friend asks less', async () => {
    const h = harness();
    const s = h.session;
    h.referee.push(trade({ deal: 'buy', what: 'a good coat', price: 'costly', keeps: true }));
    await s.submit('I buy a good coat.');
    expect(s.notice).toBe('A good coat costs 50 silver marks. You have 35 silver marks.');
    expect(h.requests.filter((r) => r.role === 'narrator')).toHaveLength(0);
    h.referee.push(trade({ deal: 'buy', what: 'a lantern', price: 'fair', keeps: true }));
    await s.submit('I buy a lantern.');
    expect(amountOf(s.story, 'mark')).toBe(24);
    expect(s.story.protagonist.items.some((i) => i.name === 'a lantern')).toBe(true);
    const note = h.requests.filter((r) => r.role === 'narrator').at(-1)!;
    expect(text(note)).toContain('trade: Aren buys a lantern for 10 silver marks');
    // Mira is Trusted: a friend's price, four fifths.
    h.referee.push(trade({ deal: 'buy', what: 'her spare bowstring', price: 'fair', keeps: true }, { targets: ['mira'] }));
    await s.submit('I buy her spare bowstring.');
    expect(amountOf(s.story, 'mark')).toBe(16);
  });

  it('does not count everyday costs in the Story style, sells at half, gives and changes money', async () => {
    const h = harness();
    const s = h.session;
    s.story.settings.style = 'story';
    h.referee.push(trade({ deal: 'buy', what: 'a hot meal', price: 'cheap' }));
    await s.submit('I buy a hot meal.');
    expect(amountOf(s.story, 'mark')).toBe(34);
    h.referee.push(trade({ deal: 'sell', what: 'cloak', item: 'cloak', price: 'fair' }));
    await s.submit('I sell my cloak.');
    expect(amountOf(s.story, 'mark')).toBe(39);
    expect(s.story.protagonist.items.some((i) => i.id === 'cloak')).toBe(false);
    h.referee.push(trade({ deal: 'sell', what: 'the letter', item: 'letter', price: 'dear' }));
    await s.submit('I sell the letter.');
    expect(s.notice).toBe('The sealed letter is not something to sell.');
    h.referee.push(trade({ deal: 'give', what: 'for the lens', amount: 4 }, { targets: ['tobin'] }));
    await s.submit('I give Tobin four marks.');
    expect(amountOf(s.story, 'mark')).toBe(35);
    h.referee.push(trade({ deal: 'exchange', what: 'money', amount: 5, money: 'mark', into: 'copper' }));
    await s.submit('I change five marks into coppers.');
    expect(purseOf(s.story)).toEqual({ mark: 30, copper: 62 });
  });

  it('applies what the narrator reports, with the rules’ amounts, and a fortune only with something finished', async () => {
    const h = harness();
    const s = h.session;
    h.narrator.push(ends('Coins, a ring, and a lost key.', 'paid: fortune | mark | the bandits’ purses', 'gained: Brass key | Opens something.', 'lost: blade', 'time: 5'));
    await s.submit('I search the fallen.');
    expect(amountOf(s.story, 'mark')).toBe(34 + 250); // a fortune came down to a dear sum
    expect(s.story.protagonist.items.some((i) => i.name === 'Brass key')).toBe(true);
    expect(s.story.protagonist.items.some((i) => i.id === 'blade')).toBe(false);
    h.narrator.push(ends('A pickpocket.', 'spent: costly | mark | a cutpurse in the crowd'));
    await s.submit('I walk on.');
    expect(amountOf(s.story, 'mark')).toBe(234);
    expect(notesOf(s.story).some((n) => n.kind === 'info' && n.text === '−50 silver marks: a cutpurse in the crowd')).toBe(true);
  });

  it('puts the purse and what is carried on the YOU line, things that matter first, within budget', () => {
    const story = newStory(glassRoadSeed(), 0);
    for (let i = 0; i < 40; i++) story.protagonist.items.push({ id: `junk${i}`, name: `Bit of junk ${i}`, kind: 'gear', text: '', qty: 1 });
    const you = protagonistCard(story);
    expect(you).toContain('Carrying The sealed letter, Tobin’s cracked lens');
    expect(you).toMatch(/and \d+ more\./);
    expect(you).toContain('Purse 34 silver marks, 12 coppers.');
    story.world.money = [];
    expect(protagonistCard(story)).not.toContain('Purse');
  });
});

describe('looks', () => {
  it('describes someone in full when first met, and in a few words after', () => {
    const story = newStory(glassRoadSeed(), 0);
    const roth = story.world.people.roth!;
    roth.appearance = 'A big man gone soft at the middle, with a grey glove he never takes off.';
    expect(personCard(story, roth, undefined, true)).toContain('Looks: A big man gone soft');
    expect(personCard(story, roth)).toContain('Looks: heavy-set, grey stubble');
    expect(protagonistCard(story)).toContain('Looks: a courier’s oilskin satchel');
  });

  it('changes how someone looks when the scribe reads a lasting change', async () => {
    const h = harness();
    const s = h.session;
    h.scribe.push({ ...SCRIBE, looks: [{ who: 'you', look: 'a fresh scar on the chin, salt-white boots', change: 'a cut on the chin that will scar' }, { who: 'kessa', look: 'x', change: 'y' }] });
    h.narrator.push(ends('A blade grazes your chin.', 'end: scene'));
    await s.submit('I duck.');
    expect(s.story.protagonist.look).toBe('a fresh scar on the chin, salt-white boots');
    expect(s.story.protagonist.appearance).toBe('A cut on the chin that will scar (since day 12).');
    expect(s.story.world.people.kessa!.look).toBe('tall, grey-cloaked, gloved, her hair pinned tight'); // not in the scene
  });
});

describe('things kept as true', () => {
  it('goes on the card of what it is about, is told to the narrator once, and is taken back by a rewind', async () => {
    const h = harness();
    const s = h.session;
    await s.submit('I look around.');
    expect(s.keepFact('mira', 'Mira has red hair', true)).toBeNull();
    expect(s.keepFact('', 'The baron has not been seen in a month')).toBeNull();
    expect(s.keepFact('nobody', 'x')).toBe('There is nobody and nowhere by that name in this story.');
    await s.submit('I wait.');
    const req = h.requests.filter((r) => r.role === 'narrator').at(-1)!;
    expect(text(req)).toContain('correction (about Mira): the player says the telling got something wrong. From now on this is true: Mira has red hair');
    const packet = buildPacket(s.story, currentScene(s.story));
    expect(packet).toContain('True of them: Mira has red hair.');
    expect(packet).toContain('FACTS kept by the player: The baron has not been seen in a month.');
    for (let i = 0; i < FACTS_MAX.about - 1; i++) expect(s.keepFact('mira', `Fact ${i}`)).toBeNull();
    expect(s.keepFact('mira', 'One too many')).toBe('4 things are kept as true about Mira already: let one go first.');
    s.dropFact(s.story.facts![0]!.id);
    expect(s.story.facts!.some((f) => f.text === 'Mira has red hair')).toBe(false);
  });

  it('tells the scribe what was corrected in the scene', async () => {
    const h = harness();
    const s = h.session;
    await s.submit('I look around.');
    s.keepFact('roth', 'Roth never drew his blade', true);
    h.narrator.push(ends('Night falls.', 'end: scene'));
    await s.submit('I wait for dark.');
    const scribe = h.requests.filter((r) => r.role === 'scribe').at(-1)!;
    expect(text(scribe)).toContain('CORRECTIONS the player made to the telling of this scene');
    expect(text(scribe)).toContain('- Roth never drew his blade');
  });

  it('keeps the packet within its size with every card full', () => {
    const story = newStory(glassRoadSeed(), 0);
    for (const p of Object.values(story.world.people)) { p.appearance = 'x'.repeat(400); p.look = 'y'.repeat(200); }
    for (const id of [...Object.keys(story.world.people), story.world.startPlace, '']) for (let i = 0; i < 4; i++) (story.facts ??= []).push({ id: `f${id}${i}`, about: id, text: 'z'.repeat(160), sceneId: 's1', day: 1 });
    story.contest = { label: 'q'.repeat(60), goal: 5, limit: 3, wins: 1, losses: 1, placeId: 'x', since: story.clock };
    story.chapter.final = true;
    const packet = buildPacket(story, { n: 1, placeId: 'lantern_market', cast: Object.keys(story.world.people) });
    expect(packet.length).toBeLessThanOrEqual(PACKET_MAX_CHARS);
  });
});

describe('efforts that add up', () => {
  const effort = { attribute: 'skill', skill: 'Athletics', difficulty: 'medium', label: 'keep up', opposed_by: null };
  it('begins with its first effort, counts each one, and is won or lost by rule', async () => {
    const h = harness();
    const s = h.session;
    s.story.rng = { state: 0, faces: [1, 1, 6, 1] } as Story['rng'];
    h.referee.push({ ...REF, kind: 'act', check: effort, contest: { label: 'lose the watch', length: 'short' } });
    await s.submit('I run for it.');
    expect(s.story.contest).toMatchObject({ label: 'lose the watch', goal: 3, limit: 3, wins: 1, losses: 0 });
    h.referee.push({ ...REF, kind: 'act', check: effort, toward_contest: true });
    await s.submit('I cut through the stalls.');
    h.referee.push({ ...REF, kind: 'act', check: effort, toward_contest: true });
    await s.submit('I vault the wall.');
    expect(s.story.contest).toMatchObject({ wins: 2, losses: 1 });
    h.referee.push({ ...REF, kind: 'act', check: effort, toward_contest: true });
    await s.submit('I duck into the crowd.');
    expect(s.story.contest).toBeNull();
    const req = h.requests.filter((r) => r.role === 'narrator').at(-1)!;
    expect(text(req)).toContain('contest won: lose the watch');
    expect(currentScene(s.story).stats.fightsWon).toBe(1);
  });

  it('can be given up between turns, and the narrator hears of it', async () => {
    const h = harness();
    const s = h.session;
    h.referee.push({ ...REF, kind: 'act', check: effort, contest: { label: 'search the archive', length: 'long' } });
    await s.submit('I start searching.');
    expect(s.story.contest?.goal).toBe(5);
    // Days cannot be let pass while it is under way.
    h.referee.push({ ...REF, kind: 'rest', minutes: 3 * 1440 });
    await s.submit('We wait here three days.');
    expect(s.notice).toBe('Not while search the archive is under way: see it through, or give it up first.');
    expect(s.asking).toBeNull();
    expect(s.giveUpContest()).toBe(true);
    expect(s.story.contest).toBeNull();
    await s.submit('I leave it.');
    expect(text(h.requests.filter((r) => r.role === 'narrator').at(-1)!)).toContain('contest given up');
  });
});

describe('another take', () => {
  it('tells the newest turn again with the same results, keeps both tellings, and can go back', async () => {
    const h = harness();
    const s = h.session;
    s.story.rng = { state: 0, faces: [2] } as Story['rng'];
    h.referee.push({ ...REF, kind: 'act', check: { attribute: 'skill', skill: 'Manipulation', difficulty: 'medium', label: 'bluff', opposed_by: 'roth' } });
    h.narrator.push(ends('First telling.', 'bond: mira | small | - | You kept your nerve.'));
    await s.submit('I bluff Roth.');
    const first = structuredClone(s.story);
    const bond = s.story.world.people.mira!.bond;
    const narrators = h.requests.filter((r) => r.role === 'narrator').length;
    expect(s.retakeBlock).toBeNull();
    h.narrator.push(ends('Second telling.', 'bond: mira | meaningful | - | You kept your nerve.'));
    await s.anotherTake('shorter');
    expect(h.requests.filter((r) => r.role === 'narrator')).toHaveLength(narrators + 1);
    expect(h.requests.filter((r) => r.role === 'referee')).toHaveLength(1); // the referee is not asked again
    const turn = s.lastTurn!;
    expect(turn.reply).toContain('Second telling.');
    expect(turn.takes).toHaveLength(2);
    expect(turn.beats.find((b) => b.type === 'check')).toEqual(first.scenes.at(-1)!.turns.at(-1)!.beats.find((b) => b.type === 'check'));
    expect(s.story.totals.turns).toBe(first.totals.turns);
    expect(s.story.world.people.mira!.bond).toBeGreaterThan(bond); // the second telling's bond applies, not both
    expect(text(h.requests.at(-1)!)).toContain('"shorter"');
    expect(turn.engineNote).not.toContain('retake'); // the note is never kept
    await s.useTake(0);
    expect(s.lastTurn!.reply).toContain('First telling.');
    expect(s.story.world.people.mira!.bond).toBe(bond);
    expect(s.story.totals.cost).toBeCloseTo(first.totals.cost + (s.lastTurn!.cost - first.scenes.at(-1)!.turns.at(-1)!.cost), 10);
    // Rewinding still takes the turn back whole.
    await s.rewindTo(first.totals.turns - 1);
    expect(s.story.world.people.mira!.bond).toBe(first.world.people.mira!.bond - 1);
  });

  it('is not offered once something changed between turns, and only once a scene under Brutal', async () => {
    const h = harness();
    const s = h.session;
    await s.submit('I look around.');
    s.keepFact('', 'It is raining');
    expect(s.retakeBlock).toBe('changed');
    await s.submit('I wait.');
    s.story.settings.style = 'brutal';
    await s.anotherTake();
    expect(s.retakeBlock).toBe('brutal');
  });

  it('gives the old telling back when the new one fails and is given up', async () => {
    const h = harness();
    const s = h.session;
    h.narrator.push(ends('The only telling.'));
    await s.submit('I look around.');
    const before = JSON.stringify(s.story);
    h.refuse.next = true;
    await s.anotherTake();
    expect(s.blocker).toEqual({ kind: 'refusal' });
    s.dismiss();
    expect(JSON.stringify(s.story)).toBe(before);
    expect(s.takeReturned()).toBeNull();
  });
});

describe('letting time pass', () => {
  it('asks before letting days pass, for nothing, and gives the text back on Not yet', async () => {
    const h = harness();
    const s = h.session;
    const day = s.story.clock.day;
    h.referee.push({ ...REF, kind: 'rest', minutes: 3 * 1440 });
    await s.submit('We camp here until Tobin comes back.');
    expect(s.asking?.wait).toBe(3 * 1440);
    expect(s.asking?.question).toContain('3 days');
    expect(s.asking?.options).toEqual(['Let the time pass', 'Not yet']);
    expect(h.requests.filter((r) => r.role === 'narrator')).toHaveLength(0);
    expect(s.story.clock.day).toBe(day);
    await s.submit('Not yet');
    expect(s.asking).toBeNull();
    expect(s.takeReturned()).toBe('We camp here until Tobin comes back.');
    expect(h.requests.filter((r) => r.role === 'referee')).toHaveLength(1);
  });

  it('on yes, tells the stretch without asking the referee again, rests, and ends the scene', async () => {
    const h = harness();
    const s = h.session;
    s.story.protagonist.sheet.hp = 3;
    const day = s.story.clock.day;
    const scenes = s.story.scenes.length;
    h.referee.push({ ...REF, kind: 'rest', minutes: 3 * 1440 });
    await s.submit('We camp here until Tobin comes back.');
    const referees = h.requests.filter((r) => r.role === 'referee').length;
    h.narrator.push(ends('Three quiet days, and then Tobin.', 'time: 4320'));
    await s.submit('Let the time pass');
    expect(h.requests.filter((r) => r.role === 'referee')).toHaveLength(referees);
    const told = text(h.requests.filter((r) => r.role === 'narrator').at(-1)!);
    expect(told).toContain('wait: the player chose to let time pass');
    expect(told).toContain('the wait ends when it comes');
    expect(s.story.clock.day).toBe(day + 3);
    expect(s.story.protagonist.sheet.hp).toBe(15);
    expect(s.story.scenes.length).toBe(scenes + 1); // days passing are a break between scenes
  });

  it('ends early when the narrator says something came sooner, and never runs past what was agreed', async () => {
    const h = harness();
    const s = h.session;
    const start = s.story.clock;
    h.referee.push({ ...REF, kind: 'rest', minutes: 7 * 1440 });
    await s.submit('We wait a week for the ship.');
    h.narrator.push(ends('On the second day the dragon comes.', 'time: 2880'));
    await s.submit('Let the time pass');
    expect(s.story.clock.day).toBe(start.day + 2);
    // A narrator reporting more than was agreed is held to it.
    h.referee.push({ ...REF, kind: 'rest', minutes: 2 * 1440 });
    await s.submit('We stay two more days.');
    const before = s.story.clock;
    h.narrator.push(ends('A long, long time.', 'time: 99999'));
    await s.submit('Let the time pass');
    expect((s.story.clock.day - before.day) * 1440 + s.story.clock.minute - before.minute).toBe(2 * 1440);
  });

  it('lets a short rest simply happen, holds a wait to two weeks, and asks only once', async () => {
    const h = harness();
    const s = h.session;
    h.referee.push({ ...REF, kind: 'rest', minutes: 480 });
    await s.submit('I sleep until morning.');
    expect(s.asking).toBeNull();
    expect(h.requests.filter((r) => r.role === 'narrator')).toHaveLength(1);
    h.referee.push({ ...REF, kind: 'rest', minutes: 90 * 1440 });
    await s.submit('I wait here all winter.');
    expect(s.asking?.wait).toBe(WAIT.max);
    // An answer of the player's own is never questioned again.
    h.referee.push({ ...REF, kind: 'rest', minutes: 5 * 1440 });
    await s.submit('Five days, no more.');
    expect(s.asking).toBeNull();
    expect(text(h.requests.filter((r) => r.role === 'narrator').at(-1)!)).toContain('up to 5 days');
  });
});

describe('companions, as the player describes them', () => {
  it('puts the player’s words on the companions who start the story, and leaves the rest as built', async () => {
    const template = await demoTemplate({ companions: 2 });
    const beside = startingCompanions(template);
    expect(beside.length).toBeGreaterThan(0);
    const first = beside[0]!;
    const answer = mockArchitect({ step: 'character', input: { source: { kind: 'description', text: '' }, premise: 'a clerk', name: 'Robin', table: { style: 'adventure', powers: 'focus', companions: 2, romance: false, violence: 'moderate', leaveOut: '', language: 'en', narration: 'medium' } }, done: {}, world: template.world }) as CharacterOut;
    const who = proposalFrom(answer, creationRules(template.world), 'Robin');
    const card = first.card;
    const seed = startSeed(template, { ...who, companions: { [first.id]: { look: 'grey fedora, gold watch', appearance: 'A'.repeat(900), card: '' }, nobody: { look: 'x', appearance: 'x', card: 'x' } } }, { id: 's', seed: 1 });
    const p = seed.world.people[first.id]!;
    expect(p.look).toBe('grey fedora, gold watch');
    expect(p.appearance!.length).toBeLessThanOrEqual(APPEARANCE_MAX);
    expect(p.card).toBe(card); // left empty: as the world builder wrote it
    expect(seed.world.people.nobody).toBeUndefined();
    expect(template.world.people[first.id]!.look).not.toBe('grey fedora, gold watch'); // the world in the library is not changed
  });

  it('can be described on their profile between turns, and the narrator is told once', async () => {
    const h = harness();
    const s = h.session;
    await s.submit('I look around the market.');
    expect(s.describePerson('mira', { look: 'red scarf, ink on her fingers', appearance: '', card: 'Dry, quick, loyal to a fault. Says less than she knows.' })).toBeNull();
    const mira = s.story.world.people.mira!;
    expect(mira.look).toBe('red scarf, ink on her fingers');
    expect(mira.card).toBe('Dry, quick, loyal to a fault. Says less than she knows.');
    expect(mira.card.length).toBeLessThanOrEqual(CARD_MAX);
    await s.submit('I look around.');
    const told = text(h.requests.filter((r) => r.role === 'narrator').at(-1)!);
    expect(told).toContain('described (Mira)');
    expect(told).toContain('Who they are: Dry, quick');
    await s.submit('I wait a moment.');
    expect(text(h.requests.filter((r) => r.role === 'narrator').at(-1)!).match(/described \(Mira\)/g)?.length ?? 0).toBe(1);
    expect(s.describePerson('nobody', { look: 'x', appearance: '', card: '' })).toBe('There is nobody by that name in this story.');
  });

  it('turns the two lines of a picture’s answer into a look and a description, never cut mid-word', () => {
    expect(pictureWords('Wide-brimmed fedora, charcoal suit\nA tall man in his forties. He wears a charcoal suit.', LOOK_MAX, APPEARANCE_MAX))
      .toEqual({ look: 'Wide-brimmed fedora, charcoal suit', appearance: 'A tall man in his forties. He wears a charcoal suit.' });
    const long = pictureWords(`At a glance: a fedora\nDescription: ${'He looks expensive. '.repeat(40)}`, LOOK_MAX, APPEARANCE_MAX);
    expect(long.look).toBe('a fedora');
    expect(long.appearance.length).toBeLessThanOrEqual(APPEARANCE_MAX);
    expect(long.appearance.endsWith('expensive.')).toBe(true);
    expect(long.appearance).not.toContain('…');
    expect(pictureWords('A tall man; a fedora. Quick eyes.', LOOK_MAX, APPEARANCE_MAX).look).toBe('A tall man');
  });
});

describe('the opening of a story', () => {
  it('asks for a brief introduction first: who, where, why, and why the companions are there', async () => {
    const h = await builtHarness({ table: { companions: 2 } });
    const s = h.session;
    await s.begin();
    const told = text(h.requests.filter((r) => r.role === 'narrator').at(-1)!);
    expect(told).toContain('begin with a brief introduction before anything happens');
    expect(told).toContain(`who ${s.story.protagonist.name} is`);
    const party = Object.values(s.story.world.people).filter((p) => p.inParty);
    if (party.length) expect(told).toContain(`why ${party[0]!.name}`);
    expect(s.lastTurn!.reply).toContain(`You are ${s.story.protagonist.name}.`);
  });
});

describe('stories that end', () => {
  it('has its final chapter come when it has run its length, or its main thread is done', () => {
    const story = newStory(glassRoadSeed(), 0);
    expect(finalComes(story, false)).toBe(false); // a story kept before endings goes on
    story.settings.ending = 'ending';
    story.settings.length = 'short';
    // The sample story is in its second chapter, with one behind it.
    expect(finalComes(story, false)).toBe(ENDING_CHAPTERS.short <= story.chapters.length + 1);
    story.chapters.push({ ...story.chapters[0]!, n: 2 });
    expect(finalComes(story, false)).toBe(true);
  });

  it('ends when its final chapter ends, writes the epilogue when asked, and can go on as a new season', async () => {
    const h = harness();
    const s = h.session;
    s.story.settings.ending = 'ending';
    s.story.chapter.final = true;
    s.story.chapter.mainDone = true;
    // Three scenes make a chapter at least.
    for (let i = 0; i < 3; i++) { h.narrator.push(ends('A while passes.', 'end: scene')); await s.submit('I wait.'); }
    expect(s.story.over).toBe('ended');
    expect(s.canWriteEpilogue).toBe(true);
    await s.writeEpilogue();
    expect(s.story.epilogue?.legend).toBe('Aren, who saw it through.');
    expect(s.story.epilogue?.text).toContain('\n\n');
    expect(s.canWriteEpilogue).toBe(false);
    expect(s.newSeason()).toBe(true);
    expect(s.story).toMatchObject({ season: 2, seasonFrom: s.story.chapters.length });
    expect(s.story.over).toBeUndefined();
  });

  it('carries a final-chapter line in the packet', async () => {
    const h = await builtHarness({ settings: { ending: 'ending', length: 'short' } });
    h.session.story.chapter.final = true;
    expect(buildPacket(h.session.story, currentScene(h.session.story))).toContain('ENDING This is the story\'s final chapter.');
  });
});

describe('the story as a book', () => {
  it('tells every scene in order, kept ones included, with the epilogue and none of the machinery', async () => {
    const h = harness();
    const s = h.session;
    h.narrator.push(ends('The market <closes> early tonight.', 'end: scene'));
    await s.submit('I watch the stalls close.');
    h.narrator.push(ends('@mira: "We should go."'));
    await s.submit('I ask Mira what she thinks.');
    s.story.epilogue = { text: 'You kept the letter.\n\nMira stayed.', legend: 'Aren, who carried it.', at: 0, cost: 0 };
    const kept = [...h.kept.values()];
    const html = storyBook(s.story, kept, { now: 0 });
    expect(html).toContain('<h1>The Glass Road</h1>');
    expect(html).toContain('Chapter 2</span>Borrowed Seals');
    expect(html).toContain('The market &lt;closes&gt; early tonight.');
    expect(html).toContain('<b>Mira</b> “We should go.”');
    expect(html).toContain('<p class="act">I ask Mira what she thinks.</p>');
    expect(html).toContain('<p class="legend">Aren, who carried it.</p>');
    expect(html.indexOf('The market')).toBeLessThan(html.indexOf('We should go'));
    expect(html).not.toContain('ENGINE');
    expect(html).not.toContain('===');
  });
});
