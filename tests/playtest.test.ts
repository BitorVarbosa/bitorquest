// The headless playtest: fifty turns through the real pipeline with the demo client, checking the
// properties the whole design rests on (docs/PLAN.md section 7 and milestone 1):
//   - the scene packet never exceeds its budget, however long the story gets;
//   - a narrator request only ever grows at the end within a scene (so the cache keeps hitting);
//   - most of what the narrator reads comes from the cache;
//   - a turn costs about what the plan estimated;
//   - a character still knows, three scenes later, what happened in front of them.
//
// Run with: npm run playtest
import { describe, expect, it } from 'vitest';
import { PACKET_MAX_CHARS, approxTokens } from '../src/game/cards';
import { cacheShare } from '../src/game/llm/models';
import { harness, prefixText } from './helpers';

const WANDER = ['guild_house', 'lantern_market', 'north_gate', 'lantern_market', 'guild_house', 'harbour', 'guild_house', 'lantern_market'];
const LINES = [
  'I look around and take stock of who is watching.',
  'I ask Mira what she makes of this.',
  'I try to bluff my way past with a straight face.',
  'I search the stalls for anything out of place.',
  'I keep my head down and listen in on the talk nearby.',
  'I tell Tobin to stay close.',
];

describe('fifty turns', () => {
  it('stays within its budgets and keeps the cache warm', async () => {
    const h = harness();
    const s = h.session;
    let hop = 0;
    for (let turn = 0; turn < 50; turn++) {
      h.wait(40); // the player reads and types for 40 seconds
      if (turn % 7 === 6) await s.travel(WANDER[hop++ % WANDER.length]!);
      else if (turn === 10) await s.submit('I sit with Mira for a while, away from the others.', 'mira');
      else if (turn === 19 || turn === 33) { await s.ask('What did you mean by that last part?'); await s.submit(LINES[turn % LINES.length]!); }
      else await s.submit(LINES[turn % LINES.length]!);
      expect(s.blocker, `turn ${turn}`).toBeNull();
      expect(s.phase).toBe('idle');
    }
    const story = s.story;
    expect(story.totals.turns).toBe(50);

    // 1. Every packet is within budget, including the latest one after a long story.
    // (The packets of scenes that have been put away are read from where they are kept.)
    const packetOf = (sc: (typeof story.scenes)[number]) => sc.packet || h.kept.get(`${story.id}/${sc.id}`)!.packet;
    for (const scene of story.scenes) {
      expect(packetOf(scene).length).toBeGreaterThan(0);
      expect(packetOf(scene).length).toBeLessThanOrEqual(PACKET_MAX_CHARS);
    }
    const packets = story.scenes.map((sc) => approxTokens(packetOf(sc)));
    const firstPacket = packets[0]!;
    const lastPacket = packets[packets.length - 1]!;
    expect(lastPacket).toBeLessThan(firstPacket * 1.6); // it does not creep upward with the length of the story

    // 2. Within a scene, each narrator request begins with the whole of the one before it. Questions to
    //    the narrator (two were asked above) are left out of the comparison and must not disturb it: the
    //    story turn after a question still begins with the whole of the story turn before it.
    const isAside = (r: (typeof h.requests)[number]) => {
      const tail = r.params.messages[r.params.messages.length - 1]!;
      return tail.role === 'system' && typeof tail.content === 'string' && tail.content.startsWith('ASIDE');
    };
    expect(h.requests.filter((r) => r.role === 'narrator' && isAside(r))).toHaveLength(2);
    const narr = h.requests.filter((r) => r.role === 'narrator' && !isAside(r));
    let appendOnly = 0;
    for (let i = 1; i < narr.length; i++) {
      const prev = narr[i - 1]!;
      const cur = narr[i]!;
      const sameScene = prefixText(cur, 1) === prefixText(prev, 1);
      if (!sameScene) continue;
      // Everything the previous request sent (all its messages) must reappear unchanged.
      expect(prefixText(cur, prev.params.messages.length).startsWith(prefixText(prev, prev.params.messages.length))).toBe(true);
      appendOnly += 1;
    }
    expect(appendOnly).toBeGreaterThan(25);

    // 3. The system blocks (contract + world) never changed across the whole session.
    const sys = new Set(narr.map((r) => prefixText(r, 0)));
    expect(sys.size).toBe(1);

    // 4. Cache: most of what the narrator read was a cache read.
    const narratorUsage = h.usage.filter((u) => u.role === 'narrator');
    const share = cacheShare(narratorUsage);
    expect(share).toBeGreaterThan(0.6);

    // 5. Cost per turn, all roles included, on the balanced preset. The plan estimated about $0.007.
    const total = h.usage.reduce((sum, u) => sum + u.cost, 0);
    const perTurn = total / 50;
    expect(perTurn).toBeLessThan(0.012);

    // 6. The largest narrator request stays bounded: nowhere near "send the whole story".
    const biggest = Math.max(...narratorUsage.map((u) => u.input + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h));
    expect(biggest).toBeLessThan(12_000);

    console.log(JSON.stringify({
      turns: 50, scenes: story.scenes.length, perTurnUSD: Number(perTurn.toFixed(5)), totalUSD: Number(total.toFixed(4)),
      narratorCacheShare: Number(share.toFixed(3)), packetTokens: { first: firstPacket, last: lastPacket, max: Math.max(...packets) },
      biggestNarratorRequestTokens: biggest,
      byRole: Object.fromEntries(['narrator', 'referee', 'scribe'].map((r) => [r, Number(h.usage.filter((u) => u.role === r).reduce((a, u) => a + u.cost, 0).toFixed(4))])),
    }));
  });

  it('a pause longer than five minutes costs one cold turn, not the whole story', async () => {
    const h = harness();
    const s = h.session;
    for (let i = 0; i < 4; i++) { h.wait(30); await s.submit(LINES[i]!); }
    const warm = h.usage.filter((u) => u.role === 'narrator').slice(-1)[0]!;
    h.wait(20 * 60); // the player goes to make dinner
    await s.submit(LINES[4]!);
    const cold = h.usage.filter((u) => u.role === 'narrator').slice(-1)[0]!;
    h.wait(30);
    await s.submit(LINES[5]!);
    const again = h.usage.filter((u) => u.role === 'narrator').slice(-1)[0]!;
    // The scene is re-written to the cache once; the one-hour system entry is still read.
    expect(cold.cacheRead).toBeGreaterThan(0);
    expect(cold.cacheWrite5m).toBeGreaterThan(warm.cacheWrite5m);
    expect(cold.cost).toBeLessThan(0.03);
    // And the turn after that is warm again.
    expect(again.cost).toBeLessThan(cold.cost);
    expect(again.cacheRead).toBeGreaterThan(cold.cacheRead);
  });

  it('a character recalls what happened in front of them three scenes earlier', async () => {
    const h = harness();
    const s = h.session;
    // Scene 4 (the story starts there): something happens in front of Mira and is recorded as an event.
    h.narrator.push('She noticed, and says nothing about it.\n===\nbond: mira | significant | +value | You did not use her as bait.');
    await s.submit('I walk up to Captain Roth openly.');
    const event = s.story.events.find((e) => e.sceneId === s.story.scenes[0]!.id && e.bond?.who === 'mira');
    expect(event).toBeDefined();
    const firstScene = s.scene.n;
    // Three scenes later...
    for (const to of ['guild_house', 'lantern_market', 'north_gate']) { await s.travel(to); await s.submit('I look around.'); }
    expect(s.scene.n).toBe(firstScene + 3);
    // ...the packet the narrator gets says Mira knows it, although that scene's transcript is long gone.
    const narr = h.requests.filter((r) => r.role === 'narrator');
    const last = narr[narr.length - 1]!;
    const packet = prefixText(last, 1);
    expect(packet).toContain(event!.text.slice(0, 40));
    // And nothing of the old transcript is in the request.
    expect(prefixText(last, last.params.messages.length)).not.toContain('She noticed, and says nothing');
  });
});
