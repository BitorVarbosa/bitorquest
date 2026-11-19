// The turn pipeline, end to end, with scripted answers in place of Claude.
import { describe, expect, it } from 'vitest';
import { isUp } from '../src/engine';
import { PACKET_MAX_CHARS } from '../src/game/cards';
import { parseReply } from '../src/game/llm/parse';
import { LlmError } from '../src/game/llm/transport';
import { routeBetween } from '../src/game/story';
import { harness } from './helpers';

const reply = (story: string, ...flags: string[]) => `${story}\n===\n${flags.join('\n')}`;

describe('a turn', () => {
  it('asks the referee, rolls in code, and tells the narrator the result', async () => {
    const h = harness();
    await h.session.submit('I try to bluff my way past Captain Roth.');
    const roles = h.requests.map((r) => r.role);
    expect(roles).toEqual(['referee', 'narrator']);
    const turn = h.session.lastTurn!;
    const check = turn.beats.find((b) => b.type === 'check');
    expect(check && check.type === 'check' && check.result.skill).toBe('Manipulation');
    expect(h.session.story.rolls).toHaveLength(1);
    // The narrator was told the outcome in a system message, never asked to decide it.
    const narr = h.requests[1]!;
    const last = narr.params.messages[narr.params.messages.length - 1]!;
    expect(last.role).toBe('system');
    expect(String(last.content)).toMatch(/^ENGINE\n(new scene: .*\n)?check: .* -> (SUCCESS|FAILURE)/);
    // What the player typed travels only as a user message.
    const typed = narr.params.messages[narr.params.messages.length - 2]!;
    expect(typed.role).toBe('user');
    expect(JSON.stringify(typed.content)).toContain('bluff my way past');
    expect(JSON.stringify(narr.params.system)).not.toContain('bluff my way past');
  });

  it('applies what the narrator flags, with the engine setting the numbers', async () => {
    const h = harness();
    const s = h.session;
    h.narrator.push(reply(
      'Roth waves you on.\n\n@mira (low): "You could have sent me in. You did not."',
      'time: 10',
      'bond: mira | significant | +value | You did not use her as bait at the bridge.',
      'thread: seal | clue | Roth carries a copy of the seal.',
      'promise: Tell Mira the rest | tonight',
      'attitude: roth | Distracted | a cart broke its axle',
    ));
    await s.submit('I walk up to Roth openly and ask whether the bridge is closed.');
    const mira = s.story.world.people.mira!;
    expect(mira.bond).toBe(64); // significant (8) x 1.5 for touching what she values = 12, from 52
    expect(mira.pendingMoment).toBe('Close');
    const memory = s.story.events.find((e) => e.bond?.who === 'mira' && e.bond.delta === 12);
    expect(memory?.text).toBe('You did not use her as bait at the bridge.');
    expect(memory?.witnesses).toContain('tobin'); // those present saw it
    expect(s.story.threads.find((t) => t.id === 'seal')!.clues).toHaveLength(2);
    expect(s.story.commitments.some((c) => c.text === 'Tell Mira the rest')).toBe(true);
    expect(s.story.world.people.roth!.attitude).toBe('Distracted');
    const say = s.lastTurn!.beats.find((b) => b.type === 'say');
    expect(say && say.type === 'say' && say.who).toBe('mira');
  });

  it('ignores a narrator that tries to hand out numbers or impossible moves', async () => {
    const h = harness();
    const s = h.session;
    const before = { xp: s.story.protagonist.xp, hp: s.story.protagonist.sheet.hp, place: s.scene.placeId };
    h.referee.push({ kind: 'act', check: null, targets: [], mentions: [], recall: [], move_to: null, ability: null, minutes: 5, why_impossible: null });
    h.narrator.push(reply('You are suddenly rich.', 'xp: 500', 'hp: 99', 'bond: mira | godlike | - | You won.', 'move: brinehold', 'fight: lise'));
    await s.submit('I stand still and say nothing.');
    expect(s.story.protagonist.xp).toBe(before.xp);
    expect(s.story.protagonist.sheet.hp).toBe(before.hp);
    expect(s.scene.placeId).toBe(before.place); // Brinehold is not one journey away: the salt flats lie between
    expect(s.combat).toBeNull(); // lise is not here
    expect(s.story.world.people.mira!.bond).toBe(52);
  });

  it('answers without the narrator when the character cannot do it', async () => {
    const h = harness();
    h.referee.push({ kind: 'ability', check: null, targets: [], mentions: [], recall: [], move_to: null, ability: 'lantern_veil', minutes: 1, why_impossible: null });
    await h.session.submit('I fold the light around the letter with Lantern Veil.');
    expect(h.requests.map((r) => r.role)).toEqual(['referee']);
    expect(h.session.notice).toMatch(/have not learned Lantern Veil, and it needs more Focus than you have to try it/);
    expect(h.session.story.totals.turns).toBe(0);
  });

  it('fetches cards and memories for what the player reaches for', async () => {
    const h = harness();
    h.referee.push({ kind: 'talk', check: null, targets: ['mira'], mentions: ['Sela'], recall: ['Brinehold', 'seal'], move_to: null, ability: null, minutes: 5, why_impossible: null });
    await h.session.submit('I ask Mira what she remembers about the seal we found in Brinehold, and whether Sela could read it.');
    const note = h.session.lastTurn!.engineNote;
    expect(note).toContain('card [sela]');
    expect(note).toContain('memory Day 6, Brinehold: You found a copy of the baron’s seal');
  });
});

describe('when a turn cannot go through', () => {
  it('a refusal leaves the story as it was and gives the action back', async () => {
    const h = harness();
    const s = h.session;
    const before = JSON.stringify({ ...s.story, rng: null, totals: { ...s.story.totals, cost: 0 } });
    h.refuse.next = true;
    await s.submit('I try to bluff my way past Captain Roth.');
    expect(s.blocker?.kind).toBe('refusal');
    s.dismiss();
    expect(s.blocker).toBeNull();
    expect(s.takeReturned()).toBe('I try to bluff my way past Captain Roth.');
    expect(JSON.stringify({ ...s.story, rng: null, totals: { ...s.story.totals, cost: 0 } })).toBe(before);
    expect(s.story.rolls).toHaveLength(0);
  });

  it('retrying after an error never rolls again', async () => {
    const h = harness();
    const s = h.session;
    h.narratorErrors.push(new LlmError('overloaded', 'busy', 529));
    await s.submit('I try to bluff my way past Captain Roth.');
    expect(s.blocker?.kind).toBe('overloaded');
    const rolled = s.story.rolls[0]!.result;
    const state = s.story.rng.state;
    await s.retry();
    expect(s.blocker).toBeNull();
    expect(s.story.rolls).toHaveLength(1);
    expect(s.story.rolls[0]!.result).toEqual(rolled);
    expect(s.story.rng.state).toBe(state);
    expect(h.requests.filter((r) => r.role === 'referee')).toHaveLength(1); // the referee was not asked twice
    expect(s.story.totals.turns).toBe(1);
  });

  it('a key that stops working is reported as such', async () => {
    const h = harness();
    h.narratorErrors.push(new LlmError('auth', 'no', 401));
    await h.session.submit('I look around.');
    expect(h.session.blocker?.kind).toBe('key');
  });

  it('the daily limit stops play before anything is sent', async () => {
    const h = harness({ cap: 0 });
    await h.session.submit('I look around.');
    expect(h.session.blocker?.kind).toBe('budget');
    expect(h.requests).toHaveLength(0);
  });
});

describe('the turn in flight', () => {
  it('shows the first passage once, whole, and nothing while it is being written', async () => {
    const h = harness({ paging: true });
    const s = h.session;
    const firsts: unknown[] = [];
    let drawsWhileWriting = 0;
    s.subscribe(() => {
      if (s.phase === 'writing') drawsWhileWriting += 1;
      const f = s.live?.first;
      if (f && firsts[firsts.length - 1] !== f) firsts.push(f);
    });
    await s.submit('I look around and take stock of who is watching.');
    const turn = s.lastTurn!;
    expect(turn.groups.length).toBeGreaterThan(1);
    // It appeared exactly once, and it is exactly what the finished turn shows before the first Continue.
    expect(firsts).toHaveLength(1);
    const shownFirst = turn.beats.slice(0, turn.groups[1]).filter((b) => b.type === 'narration' || b.type === 'say').map((b) => (b as { text: string }).text);
    expect((firsts[0] as { text: string }[]).map((p) => p.text)).toEqual(shownFirst);
    // The screen is not redrawn for every piece of text that arrives: once for the dice, once for the passage.
    expect(drawsWhileWriting).toBeLessThanOrEqual(3);
    expect(s.live).toBeNull();
    expect(s.unread).toBe(turn.groups.length - 1);
  });

  it('with passages turned off, the whole telling arrives at once when it is finished', async () => {
    const h = harness({ paging: false });
    const s = h.session;
    let first: { text: string }[] | undefined;
    s.subscribe(() => { if (s.live?.first) first = s.live.first; });
    await s.submit('I look around.');
    const told = s.lastTurn!.beats.filter((b) => b.type === 'narration' || b.type === 'say').map((b) => (b as { text: string }).text);
    expect(first?.map((p) => p.text)).toEqual(told);
    expect(s.unread).toBe(0);
  });

  it('an answer outside the story is not shown until it is finished', async () => {
    const h = harness();
    const s = h.session;
    const live: object[] = [];
    s.subscribe(() => { if (s.live) live.push({ ...s.live }); });
    await s.ask('What did you mean by that?');
    expect(live.length).toBeGreaterThan(0);
    for (const l of live) expect(Object.keys(l).sort()).toEqual(['aside', 'text', 'to']); // the question only: no text of the answer
    expect(s.scene.asides).toHaveLength(1);
    expect(s.scene.asides![0]!.answer.length).toBeGreaterThan(20);
  });
});

describe('scenes', () => {
  it('travel closes the scene, has the scribe write it up, and opens a new packet', async () => {
    const h = harness();
    const s = h.session;
    await s.submit('I look around.');
    const first = s.scene;
    await s.travel('guild_house');
    expect(first.ended).toBe(true);
    expect(first.summary).toBeTruthy();
    expect(s.scene.placeId).toBe('guild_house');
    expect(s.scene.n).toBe(first.n + 1);
    expect(h.requests.map((r) => r.role)).toEqual(['referee', 'narrator', 'referee', 'scribe', 'narrator']);
    // The leaving is the first line of the next scene, so the scribe is told how this one ended.
    expect(JSON.stringify(h.requests.find((r) => r.role === 'scribe')!.params.messages)).toContain('HOW THE SCENE ENDED You left for Guild House.');
    expect(s.scene.packet).toContain('LAST SCENES');
    expect(s.scene.packet).not.toContain('[hask]'); // he is in his office, one step away: not in this scene, so not in the packet
  });

  it('the packet holds only what the protagonist could know, within budget', async () => {
    const h = harness();
    const packet = h.session.scene.packet;
    expect(packet.length).toBeLessThanOrEqual(PACKET_MAX_CHARS);
    expect(packet).not.toContain('Greywater'); // a region not discovered
    expect(packet).not.toContain('Beyond the waystation');
    // Roth's card says what Roth knows. He was not in Brinehold.
    const roth = packet.split('\n').find((l) => l.startsWith('[roth]'))!;
    expect(roth).not.toContain('what you were really carrying');
    const mira = packet.split('\n').find((l) => l.startsWith('[mira]'))!;
    expect(mira).toContain('Knows:');
    // A crowd is one line.
    expect(packet).toContain('[crowd] Market crowd ×12');
  });

  it('a waiting moment comes when the player gives that person time, and only once', async () => {
    const h = harness();
    const s = h.session;
    const mira = () => s.story.world.people.mira!;
    h.narrator.push(reply('She noticed.', 'bond: mira | significant | +value | You did not use her as bait.'));
    await s.submit('I walk up to Roth openly.');
    expect(mira().pendingMoment).toBe('Close');
    // There is no button for it. Attention given to someone else does not bring it up.
    await s.submit('I ask Tobin what he saw.', 'tobin');
    expect(s.lastTurn!.engineNote).not.toContain('moment waiting');
    // Giving Mira time does: the narrator is told it may happen now, and reports that it did.
    h.narrator.push(reply('She tells you why she left the Watch.', 'time: 40\nmoment: mira'));
    await s.submit('I sit with Mira for a while, away from the others.', 'mira');
    expect(s.lastTurn!.engineNote).toContain('moment waiting: Mira');
    expect(mira().pendingMoment).toBeNull();
    expect(s.story.events.some((e) => e.text.includes('opened up to you'))).toBe(true);
    await s.submit('I ask Mira about the road ahead.', 'mira');
    expect(s.lastTurn!.engineNote).not.toContain('moment waiting');
  });

  it('a moment the narrator reports for someone with none waiting is ignored', async () => {
    const h = harness();
    const s = h.session;
    const before = s.story.events.length;
    h.narrator.push(reply('Nothing much.', 'moment: mira\nmoment: nobody'));
    await s.submit('I look around.');
    expect(s.story.events.length).toBe(before);
  });
});

describe('a question to the narrator', () => {
  it('is answered outside the story and changes nothing in it', async () => {
    const h = harness();
    const s = h.session;
    await s.submit('I look around.');
    await s.submit('I ask Mira what she thinks.');
    const scene = s.scene;
    const clock = JSON.stringify(s.story.clock);
    const turns = s.story.totals.turns;
    const events = s.story.events.length;
    h.wait(30);
    await s.ask('What did you mean by that last sentence?');
    expect(s.phase).toBe('idle');
    expect(scene.turns.length).toBe(2);
    expect(scene.asides).toHaveLength(1);
    expect(scene.asides![0]!.after).toBe(2);
    expect(scene.asides![0]!.answer.length).toBeGreaterThan(20);
    expect(JSON.stringify(s.story.clock)).toBe(clock);
    expect(s.story.totals.turns).toBe(turns);
    expect(s.story.events.length).toBe(events);

    // The request: the scene as it was sent, then the question, then how to answer it.
    const req = h.requests[h.requests.length - 1]!;
    expect(req.role).toBe('narrator');
    const msgs = req.params.messages;
    const tail = msgs[msgs.length - 1]!;
    expect(tail.role).toBe('system');
    expect(tail.content as string).toMatch(/^ASIDE/);
    expect(JSON.stringify(msgs[msgs.length - 2])).toContain('Out of the story, to the narrator');
    // It reads the scene from the cache and writes nothing new.
    const cost = scene.asides![0]!.usage[0]!;
    expect(cost.cacheRead).toBeGreaterThan(1000);
    expect(cost.cacheWrite5m + cost.cacheWrite1h).toBe(0);
    expect(cost.input).toBeLessThan(700); // the last reply, the question and the short note: nothing else is paid at full price
    expect(tail.content as string).not.toContain('NOTES ON THE RULES'); // "what did you mean" needs no rulebook
    await s.ask('How does a roll work?');
    expect(h.requests[h.requests.length - 1]!.params.messages.slice(-1)[0]!.content as string).toContain('NOTES ON THE RULES');
    expect(scene.asides).toHaveLength(2);
    // No referee was needed: the player said who they were talking to.
    expect(h.requests.filter((r) => r.role === 'referee')).toHaveLength(2);

    // The next turn of the story never sees the question, and finds the cache as the last turn left it.
    await s.submit('I search the stalls.');
    const next = h.requests.filter((r) => r.role === 'narrator').pop()!;
    expect(JSON.stringify(next.params.messages)).not.toContain('Out of the story');
    expect(next.params.messages).toHaveLength(1 + 3 * 2 + 2);
    const usage = s.lastTurn!.usage.find((u) => u.role === 'narrator')!;
    expect(usage.cacheRead).toBeGreaterThan(1000);
  });

  it('a follow-up question sees the answer before it; a later turn starts fresh', async () => {
    const h = harness();
    const s = h.session;
    await s.submit('I look around.');
    await s.ask('What did you mean?');
    await s.ask('And the other part?');
    const req = h.requests[h.requests.length - 1]!;
    const text = JSON.stringify(req.params.messages);
    expect(text).toContain('What did you mean?');
    expect(text).toContain(s.scene.asides![0]!.answer.slice(0, 30));
    await s.submit('I wait a moment.');
    await s.ask('One more thing?');
    expect(JSON.stringify(h.requests[h.requests.length - 1]!.params.messages)).not.toContain('What did you mean?');
  });

  it('a line that starts with // or (( is never said in the story', async () => {
    const h = harness();
    const s = h.session;
    await s.submit('// how do rolls work?');
    await s.submit('((can I use Glimmer here?))');
    expect(s.scene.turns).toHaveLength(0);
    expect(s.scene.asides!.map((a) => a.question)).toEqual(['how do rolls work?', 'can I use Glimmer here?']);
    expect(h.requests.filter((r) => r.role === 'referee')).toHaveLength(0);
  });

  it('words plainly meant for the narrator are caught even when sent into the story', async () => {
    const h = harness();
    const s = h.session;
    await s.submit('What do you mean with "she weighs a shot"?', 'mira');
    expect(s.scene.turns).toHaveLength(0);
    expect(s.scene.asides).toHaveLength(1);
    // The referee's reading is paid for as part of the answer.
    expect(s.scene.asides![0]!.usage.map((u) => u.role)).toEqual(['referee', 'narrator']);
  });

  it('a failed answer can be tried again or taken back', async () => {
    const h = harness();
    const s = h.session;
    h.narratorErrors.push(new LlmError('overloaded', 'busy', 529));
    await s.ask('What is a destiny point?');
    expect(s.blocker?.kind).toBe('overloaded');
    await s.retry();
    expect(s.blocker).toBeNull();
    expect(s.scene.asides).toHaveLength(1);
    h.narratorErrors.push(new LlmError('overloaded', 'busy', 529));
    await s.ask('And energy?');
    s.dismiss();
    expect(s.returned).toBe('And energy?');
    expect(s.scene.asides).toHaveLength(1);
  });
});

describe('when the game cannot tell what the player means', () => {
  it('asks before anything happens, and the answer settles it', async () => {
    const h = harness();
    const s = h.session;
    const clock = JSON.stringify(s.story.clock);
    await s.submit('I pull Mira aside.');
    expect(s.asking?.question).toMatch(/private word/);
    expect(s.asking?.options).toEqual(['A private word', 'Speak here']);
    expect(s.scene.turns).toHaveLength(0);
    expect(h.requests.filter((r) => r.role === 'narrator')).toHaveLength(0);
    expect(JSON.stringify(s.story.clock)).toBe(clock);

    await s.submit('A private word');
    expect(s.asking).toBeNull();
    expect(s.scene.turns).toHaveLength(1);
    const turn = s.lastTurn!;
    expect(turn.beats[0]).toMatchObject({ type: 'action', text: 'I pull Mira aside.', clarified: 'A private word' });
    expect(turn.userText).toContain('I pull Mira aside.');
    expect(turn.userText).toContain('The player answered: A private word');
    expect(turn.engineNote).toContain('clarified:');
    const referee = h.requests.filter((r) => r.role === 'referee').pop()!;
    expect(JSON.stringify(referee.params.messages)).toContain('THE PLAYER ANSWERED');
  });

  it('never asks twice in a row', async () => {
    const h = harness();
    const s = h.session;
    const unclear = { kind: 'unclear', check: null, targets: [], mentions: [], recall: [], move_to: null, ability: null, minutes: 0, why_impossible: null, ask: 'Which one?', ask_options: ['This', 'That'] };
    h.referee.push(unclear, unclear);
    await s.submit('I do the thing.');
    expect(s.asking).not.toBeNull();
    await s.submit('That');
    expect(s.asking).toBeNull();
    expect(s.scene.turns).toHaveLength(1);
  });

  it('the question can be dropped, which gives the text back', async () => {
    const h = harness();
    const s = h.session;
    await s.submit('I take Mira aside.');
    expect(s.asking).not.toBeNull();
    s.dropQuestion();
    expect(s.asking).toBeNull();
    expect(s.takeReturned()).toBe('I take Mira aside.');
    expect(s.scene.turns).toHaveLength(0);
  });

  it('a question to the narrator can be asked while the game waits for an answer', async () => {
    const h = harness();
    const s = h.session;
    await s.submit('I pull Mira aside.');
    await s.ask('What would a private word change?');
    expect(s.asking).not.toBeNull();
    expect(s.scene.asides).toHaveLength(1);
  });
});

// What the referee answers when the player sets out for a place.
const leave = (to: string | null, over: Record<string, unknown> = {}) => ({
  kind: 'move', check: null, targets: [], mentions: [], recall: [], move_to: to, held: null, ability: null, minutes: 10,
  why_impossible: null, ask: null, ask_options: [], ...over,
});
// An easy task for someone with the skill needs no roll and works; Firepower 0 without the skill on a hard task is out of reach.
const SURE = { attribute: 'skill', skill: 'Manipulation', difficulty: 'easy', label: 'talk your way out', opposed_by: null };
const HOPELESS = { attribute: 'firepower', skill: 'Machines', difficulty: 'hard', label: 'shoot the lock off', opposed_by: null };
const minutesBetween = (a: { day: number; minute: number }, b: { day: number; minute: number }) => (b.day - a.day) * 1440 + b.minute - a.minute;

describe('travel', () => {
  it('only goes along a known route: to where you already are, or out of reach, is not a turn', async () => {
    const h = harness();
    const s = h.session;
    const here = s.scene.placeId;
    await s.travel(here);
    await s.travel('nowhere_at_all');
    expect(h.requests).toHaveLength(0);
    expect(s.scene.turns).toHaveLength(0);
    await s.travel('guild_house');
    expect(s.scene.placeId).toBe('guild_house');
    expect(s.lastTurn!.reply).toContain('Guild House opens around you');
  });

  it('a place chosen on the map is the player asking to leave: the referee judges it, and is told it came from the map', async () => {
    const h = harness();
    const s = h.session;
    await s.travel('guild_house');
    const referee = h.requests.find((r) => r.role === 'referee')!;
    const asked = JSON.stringify(referee.params.messages);
    expect(asked).toContain('THE PLAYER CHOSE ON THE MAP TO LEAVE FOR [guild_house]');
    expect(asked).not.toContain('THE PLAYER TYPED');
    expect(h.requests.map((r) => r.role)).toEqual(['referee', 'narrator']);
    expect(s.scene.placeId).toBe('guild_house');
    expect(s.lastTurn!.engineNote).toContain('travel:');
  });

  it('when something holds the character, wanting to leave is not leaving', async () => {
    const h = harness();
    const s = h.session;
    const here = s.scene.placeId;
    h.referee.push(leave('guild_house', { held: 'Captain Roth is still questioning you and stands in the doorway.' }));
    await s.travel('guild_house');
    expect(s.scene.placeId).toBe(here);
    expect(s.scene.turns).toHaveLength(1);
    const note = s.lastTurn!.engineNote;
    expect(note).toContain('leaving:');
    expect(note).toContain('Captain Roth is still questioning you and stands in the doorway');
    expect(note).toContain('"move: guild_house"');
    expect(note).not.toContain('travel:');
    expect(h.requests.some((r) => r.role === 'scribe')).toBe(false);
  });

  it('the scene can let them go: the narrator reports it and the engine takes them there', async () => {
    const h = harness();
    const s = h.session;
    const first = s.scene;
    h.referee.push(leave('guild_house', { held: 'Roth has not finished with you' }));
    h.narrator.push(reply('Roth looks at you for a long moment, then steps aside.', 'time: 2', 'move: guild_house'));
    await s.travel('guild_house');
    expect(first.turns).toHaveLength(1);
    expect(first.turns[0]!.reply).toContain('steps aside');
    expect(first.ended).toBe(true);
    expect(s.scene.placeId).toBe('guild_house');
    expect(s.scene.turns).toHaveLength(0);
  });

  it('getting away takes an attempt that succeeds, and the scribe is told how the scene ended', async () => {
    const h = harness();
    const s = h.session;
    await s.submit('I look around.');
    const first = s.scene;
    h.referee.push(leave('guild_house', { held: 'two watchmen have you by the arms', check: SURE }));
    await s.travel('guild_house');
    expect(first.ended).toBe(true);
    expect(s.scene.placeId).toBe('guild_house');
    const turn = s.lastTurn!;
    expect(turn.beats.find((b) => b.type === 'check')).toMatchObject({ result: { passed: true } });
    expect(turn.engineNote).toContain('got away:');
    expect(turn.engineNote).toContain('travel:');
    const scribe = h.requests.filter((r) => r.role === 'scribe').pop()!;
    expect(JSON.stringify(scribe.params.messages)).toContain('HOW THE SCENE ENDED You got away and left for');
    // The roll counted in the scene it was made in.
    expect(first.stats.testsPassed).toBe(1);
  });

  it('an attempt that fails leaves them where they were', async () => {
    const h = harness();
    const s = h.session;
    const here = s.scene.placeId;
    h.referee.push(leave('guild_house', { held: 'the cell door is barred from outside', check: HOPELESS }));
    await s.travel('guild_house');
    expect(s.scene.placeId).toBe(here);
    const turn = s.lastTurn!;
    expect(turn.beats.find((b) => b.type === 'check')).toMatchObject({ result: { passed: false } });
    expect(turn.engineNote).toContain('does not get away');
    expect(turn.engineNote).not.toContain('travel:');
  });

  it('when there is no way out at all the game says so, and nothing is narrated', async () => {
    const h = harness();
    const s = h.session;
    const here = s.scene.placeId;
    h.referee.push(leave(null, { kind: 'impossible', why_impossible: 'You are locked in a cell. The door will not open for wanting it.' }));
    await s.travel('guild_house');
    expect(s.notice).toMatch(/locked in a cell/);
    expect(s.scene.placeId).toBe(here);
    expect(s.scene.turns).toHaveLength(0);
    expect(h.requests.map((r) => r.role)).toEqual(['referee']);
  });

  it('a place chosen on the map is never taken for a question, and the game never asks what was meant', async () => {
    for (const kind of ['unclear', 'question', 'talk']) {
      const h = harness();
      const s = h.session;
      h.referee.push(leave(null, { kind, ask: 'Where to?', ask_options: ['Here', 'There'] }));
      await s.travel('guild_house');
      expect(s.asking, kind).toBeNull();
      expect(s.scene.asides ?? [], kind).toHaveLength(0);
      expect(s.scene.placeId, kind).toBe('guild_house');
    }
  });

  it('typed travel is held by the same rule', async () => {
    const h = harness();
    const s = h.session;
    const here = s.scene.placeId;
    h.referee.push(leave('guild_house', { held: 'Roth blocks the way' }));
    await s.submit('I walk out and go to the Guild House.');
    expect(s.scene.placeId).toBe(here);
    expect(s.lastTurn!.engineNote).toContain('leaving:');
  });

  it('a journey takes the time its route takes, whatever the narrator reports', async () => {
    const h = harness();
    const s = h.session;
    const route = routeBetween(s.story, s.scene.placeId, 'guild_house')!;
    const before = { ...s.story.clock };
    h.narrator.push(reply('You arrive.', 'time: 45'));
    await s.submit('I walk to the Guild House.');
    expect(s.scene.placeId).toBe('guild_house');
    expect(minutesBetween(before, s.story.clock)).toBe(route.minutes);
  });

  it('nobody walks away from people who mean them harm (the demo referee)', async () => {
    const h = harness();
    const s = h.session;
    const back = s.scene.placeId;
    await s.travel('canal_bridge'); // wardens and a knifeman are waiting there
    expect(s.scene.placeId).toBe('canal_bridge');
    await s.travel(back);
    const turn = s.lastTurn!;
    const roll = turn.beats.find((b) => b.type === 'check');
    expect(roll).toBeDefined();
    const passed = roll!.type === 'check' && roll!.result.passed;
    expect(s.scene.placeId).toBe(passed ? back : 'canal_bridge');
    expect(turn.engineNote).toContain(passed ? 'got away:' : 'does not get away');
  });

  it('in a fight, heading for another place is an attempt to get away: the fight is not forgotten', async () => {
    const h = harness();
    const s = h.session;
    const back = s.scene.placeId;
    await s.travel('canal_bridge');
    await s.submit('I attack the knifeman.');
    expect(s.combat).toBeTruthy();
    const scenes = s.story.scenes.length;
    await s.travel(back);
    expect(s.story.scenes).toHaveLength(scenes);
    expect(s.scene.placeId).toBe('canal_bridge');
    expect(s.lastTurn!.engineNote).toMatch(/fight, round/);
    expect(s.lastTurn!.engineNote).toMatch(/get away|got away|breaks away/);
  });

  it('stopping a journey gives nothing back to the input box: the player typed nothing', async () => {
    const h = harness();
    const s = h.session;
    h.narratorErrors.push(new LlmError('aborted', 'Stopped.'));
    await s.travel('guild_house');
    expect(s.takeReturned()).toBeNull();
    expect(s.blocker).toBeNull();
  });
});

describe('a fight', () => {
  it('treats identical opponents as one group and always ends', async () => {
    const h = harness();
    const s = h.session;
    await s.travel('canal_bridge');
    await s.submit('I attack the knifeman.');
    const c = s.combat ?? s.scene.combat;
    expect(c).toBeTruthy();
    const wardens = c!.fighters.wardens!;
    expect(wardens.countMax).toBeGreaterThan(1); // four wardens are one fighter
    expect(Object.values(c!.fighters).filter((f) => f.side === 'foe').length).toBe(3);
    expect(c!.fighters.kessa).toBeUndefined(); // she watches and does not fight
    for (let i = 0; i < 60 && s.combat; i++) {
      if (s.combat.awaiting === 'down') { await s.chooseDown(s.story.protagonist.destiny > 0 ? 'destiny' : 'test'); continue; }
      const target = Object.values(s.combat.fighters).find((f) => f.side === 'foe' && isUp(f));
      if (!target) break;
      await s.combatAct({ type: 'attack', target: target.id });
      // One narrator call per round, however many are fighting.
      expect(parseReply(s.lastTurn!.reply).parts.length).toBeLessThan(8);
    }
    expect(s.combat).toBeNull();
    const hp = s.story.protagonist.sheet.hp;
    expect(hp).toBeGreaterThanOrEqual(0);
    expect(hp).toBeLessThanOrEqual(15);
  });

  it('a hero whose Firepower is higher than their Strength fights at range', async () => {
    const h = harness();
    const s = h.session;
    s.story.protagonist.sheet.firepower = 4; // Strength is 1
    await s.travel('canal_bridge');
    await s.submit('I attack the knifeman.');
    const hero = Object.values(s.scene.combat!.fighters).find((f) => f.isProtagonist)!;
    expect(hero.ranged).toBe(true);
    const mine = s.lastTurn!.beats.find((b) => b.type === 'attack' && b.byYou);
    expect(mine && mine.type === 'attack' && mine.event.ranged).toBe(true);
    expect(mine && mine.type === 'attack' && [4, 8]).toContain(mine && mine.type === 'attack' ? mine.event.power : -1);

    // With Strength at least as high, nothing changes: the blade it is.
    const g = harness();
    await g.session.travel('canal_bridge');
    await g.session.submit('I attack the knifeman.');
    expect(Object.values(g.session.scene.combat!.fighters).find((f) => f.isProtagonist)!.ranged).toBeUndefined();
  });

  it('an action the rules refuse is not a turn: the player is told why and no model is asked to tell it', async () => {
    const h = harness();
    const s = h.session;
    await s.travel('canal_bridge');
    await s.submit('I attack the knifeman.');
    expect(s.combat?.awaiting).toBe('action');
    const hero = Object.values(s.combat!.fighters).find((f) => f.isProtagonist)!;
    const foe = Object.values(s.combat!.fighters).find((f) => f.side === 'foe' && isUp(f))!;
    hero.energy = 0;
    const turns = s.story.totals.turns;
    const round = s.combat!.round;
    const asked = h.requests.length;
    await s.combatAct({ type: 'ability', ability: 'gale_push', target: foe.id });
    expect(s.notice).toMatch(/energy/i);
    expect(h.requests.length).toBe(asked); // a button asks no referee, and nothing happened to narrate
    expect(s.story.totals.turns).toBe(turns);
    expect(s.combat!.round).toBe(round);
    expect(s.combat!.awaiting).toBe('action');

    // Typed, and judged impossible by the referee: said so, and the round is not spent defending.
    h.referee.push({ kind: 'impossible', check: null, targets: [], mentions: [], recall: [], move_to: null, held: null, ability: null, improvise: null, minutes: 1, why_impossible: 'You cannot fly.', ask: null, ask_options: [] });
    await s.submit('I fly away over the rooftops.');
    expect(s.notice).toBe('You cannot fly.');
    expect(h.requests.slice(asked).map((r) => r.role)).toEqual(['referee']);
    expect(s.story.totals.turns).toBe(turns);
    expect(s.combat!.awaiting).toBe('action');
  });
});
