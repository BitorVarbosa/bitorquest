// The dice wait to be thrown: what stands on the table, in what order, and what the session keeps
// so that the screen can go on showing the story as it was until they have landed.
import { describe, expect, it } from 'vitest';
import { FLIPS, REST_MS, STAGGER_MS, THROW_MS, afterLanding, cardThrow, diceCards, faceRun, freshTable, hasDice, isTold, nextDice, type Table } from '../src/app/table';
import type { Beat } from '../src/game/types';
import { harness } from './helpers';

const reply = (story: string, ...flags: string[]) => `${story}\n===\n${flags.join('\n')}`;

describe('a throw', () => {
  it('changes face many times, quickly at first and slower as the die loses speed, and ends before the die comes to rest', () => {
    expect(FLIPS.length).toBeGreaterThanOrEqual(12);
    const gaps = FLIPS.slice(1).map((at, i) => at - FLIPS[i]!);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]!).toBeGreaterThanOrEqual(gaps[i - 1]!);
    expect(gaps[0]!).toBeLessThan(60);
    expect(FLIPS[FLIPS.length - 1]!).toBeLessThan(REST_MS);
    expect(REST_MS).toBeLessThan(THROW_MS);
  });

  it('never shows the same face twice in a row, and the last face before it lands is not the one it lands on', () => {
    let seed = 7;
    const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let face = 1; face <= 6; face++) {
      for (let round = 0; round < 50; round++) {
        const run = faceRun(face, random);
        expect(run).toHaveLength(FLIPS.length + 1);
        for (const f of run) expect(f >= 1 && f <= 6 && Number.isInteger(f)).toBe(true);
        for (let i = 1; i < run.length; i++) expect(run[i]).not.toBe(run[i - 1]);
        expect(run[run.length - 1]).not.toBe(face);
      }
    }
  });

  it('is safe with a random source that returns its extremes', () => {
    expect(faceRun(3, () => 0).every((f) => f >= 1 && f <= 6)).toBe(true);
    expect(faceRun(3, () => 0.999999).every((f) => f >= 1 && f <= 6)).toBe(true);
  });
});

describe('the table', () => {
  it('thrown one by one: only the next card is out, it waits for the player, and the one after it comes out when it has landed', () => {
    let table = freshTable(4, true);
    expect(cardThrow(table, 0)).toEqual({ state: 'ready', delay: 0 });
    expect(cardThrow(table, 1)).toBeNull();
    table = { ...table, go: 'one' };
    expect(cardThrow(table, 0)).toEqual({ state: 'rolling', delay: 0 });
    expect(cardThrow(table, 1)).toBeNull();
    table = afterLanding(table, 0);
    expect(table).toEqual({ n: 4, landed: 1, go: 'wait' });
    expect(cardThrow(table, 0)).toEqual({ state: 'still', delay: 0 });
    expect(cardThrow(table, 1)).toEqual({ state: 'ready', delay: 0 });
    expect(cardThrow(table, 2)).toBeNull();
  });

  it('thrown all at once: every card left is out, each leaving the hand a moment after the one before, and they stay in the air as the first ones land', () => {
    let table: Table = { ...freshTable(4, true), landed: 1, go: 'all' };
    expect(cardThrow(table, 0)).toEqual({ state: 'still', delay: 0 });
    expect(cardThrow(table, 1)).toEqual({ state: 'rolling', delay: 0 });
    expect(cardThrow(table, 3)).toEqual({ state: 'rolling', delay: 2 * STAGGER_MS });
    table = afterLanding(table, 1);
    expect(table).toEqual({ n: 4, landed: 2, go: 'all' });
    expect(cardThrow(table, 3)?.state).toBe('rolling');
    // Cards never land out of order, but a late report of an earlier one must not take the table back.
    expect(afterLanding({ n: 4, landed: 3, go: 'all' }, 1).landed).toBe(3);
  });

  it('with the setting off the app throws everything as soon as it is called for', () => {
    expect(freshTable(9, false)).toEqual({ n: 9, landed: 0, go: 'all' });
    expect(cardThrow(freshTable(9, false), 2)).toEqual({ state: 'rolling', delay: 2 * STAGGER_MS });
  });

  it('nothing is told ahead of the dice before it', () => {
    const table = { n: 1, landed: 1, go: 'wait' as const };
    expect(isTold(table, 0)).toBe(true);
    expect(isTold(table, 1)).toBe(true);
    expect(isTold(table, 2)).toBe(false);
  });
});

describe('the dice of a turn', () => {
  it('counts attacks and tests that were rolled, and knows how many dice the next card holds', async () => {
    const h = harness();
    const s = h.session;
    await s.submit('I try to bluff my way past Captain Roth with a straight face.');
    const beats = s.lastTurn!.beats;
    expect(diceCards(beats)).toBe(1);
    expect(nextDice(beats, 0)).toBe(1);
    expect(nextDice(beats, 1)).toBe(0);
    const auto: Beat = { type: 'check', result: { ...(beats.find((b) => b.type === 'check') as Extract<Beat, { type: 'check' }>).result, die: null }, opposedBy: null };
    expect(hasDice(auto)).toBe(false);
    expect(diceCards([...beats, auto])).toBe(1);
  });

  it('an attack holds two', async () => {
    const h = harness();
    const s = h.session;
    await s.travel('canal_bridge');
    await s.submit('I draw my blade');
    const turn = s.lastTurn!;
    const attacks = turn.beats.filter((b) => b.type === 'attack');
    expect(attacks.length).toBeGreaterThan(0);
    expect(diceCards(turn.beats)).toBe(attacks.length);
    expect(nextDice(turn.beats, 0)).toBe(2);
  });
});

describe('the story as it stood before the latest turn', () => {
  it('is kept through the turn and after it, untouched by what the turn did', async () => {
    const h = harness();
    const s = h.session;
    expect(s.before).toBeNull();
    await s.travel('canal_bridge');
    await s.submit('I draw my blade');
    const hpThen = s.story.protagonist.sheet.hp;
    const turnsThen = s.story.totals.turns;
    let seenInFlight: number | null = null;
    const off = s.subscribe(() => { if (s.live?.beats?.some((b) => b.type === 'attack')) seenInFlight = s.before?.protagonist.sheet.hp ?? null; });
    const foe = Object.values(s.combat!.fighters).find((f) => f.side === 'foe' && f.hp > 0)!;
    await s.combatAct({ type: 'attack', target: foe.id });
    off();
    const before = s.before!;
    expect(before.totals.turns).toBe(turnsThen);
    expect(before.protagonist.sheet.hp).toBe(hpThen);
    expect(seenInFlight).toBe(hpThen);
    expect(s.story.totals.turns).toBe(turnsThen + 1);
    expect(s.lastTurn!.n).toBe(before.totals.turns + 1); // the turn whose dice the screen holds back
    expect(s.before).toBe(before); // read once, not on every look
  });

  it('a question to the narrator is not a turn and does not replace it', async () => {
    const h = harness();
    const s = h.session;
    await s.submit('I look around and take stock of who is watching the bridge.');
    const before = s.before;
    await s.ask('What is the Watch?');
    expect(s.before).toBe(before);
  });

  it('an action taken back leaves no turn to wait for', async () => {
    const h = harness();
    const s = h.session;
    await s.submit('I look around and take stock of who is watching the bridge.');
    h.narratorErrors.push(Object.assign(new Error('gone'), {}));
    await s.submit('I try to bluff my way past Captain Roth with a straight face.');
    // The turn did not go through; whatever its dice were, the story holds no such turn.
    expect(s.scene.turns.some((t) => t.n === (s.before?.totals.turns ?? 0) + 1)).toBe(false);
  });

  it('once a turn is part of the story it is no longer "in flight", even while its scene is being written up', async () => {
    const h = harness();
    const s = h.session;
    const first = s.scene;
    let both = 0;
    const off = s.subscribe(() => {
      const flight = s.arriving;
      if (flight && first.turns.some((t) => t.beats[0] === flight.beats[0])) both += 1; // the same action, as a turn of the scene and as the turn in flight
    });
    h.narrator.push(reply('You say your goodbyes and take the lane toward the Guild House.', 'time: 5', 'move: guild_house'));
    await s.submit('I look around and take stock of who is watching the bridge.');
    off();
    expect(first.ended).toBe(true);
    expect(both).toBe(0);
  });
});
