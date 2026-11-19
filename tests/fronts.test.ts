// The world moves: things in motion advance by rule as the story goes, and become the talk of the towns.
import { describe, expect, it } from 'vitest';
import { fixedDice } from '../src/engine';
import { cleanStep, newDraft, type BuildInput } from '../src/game/builder';
import { PACKET_MAX_CHARS, frontLine, frontsFor, hasReached, knowledgeOf, newsFor, reachOf } from '../src/game/cards';
import { FRONT_RULE, advanceFronts, frontOpen, frontPlace, setBack, stopFront } from '../src/game/fronts';
import { mockArchitect } from '../src/game/llm/mockArchitect';
import type { LlmRequest } from '../src/game/llm/transport';
import { recall } from '../src/game/search';
import { newStory } from '../src/game/story';
import type { Story } from '../src/game/types';
import { checkWorld } from '../src/game/world';
import { glassRoadSeed, lanternCoast } from '../src/packs/lanternCoast';
import { builtHarness, harness } from './helpers';

const text = (req: LlmRequest): string => req.params.messages.map((m) => (typeof m.content === 'string' ? m.content : m.content.map((b) => (b.type === 'text' ? b.text : '')).join(''))).join('\n');
const front = (story: Story, id: string) => story.world.fronts!.find((f) => f.id === id)!;
const stages = (story: Story) => Object.fromEntries(story.world.fronts!.map((f) => [f.id, f.stage]));
const later = (story: Story, days: number, minutes = 0) => { story.clock = { day: story.clock.day + days, minute: story.clock.minute + minutes }; };
/** The world's dice always come up with this face. */
const worldRolls = (story: Story, face: number) => { story.worldDice = fixedDice(face); };

describe('the rule that moves the world', () => {
  it('nothing moves before its days have passed, and then only if the die allows', async () => {
    const { session: s } = await builtHarness();
    const story = s.story;
    expect(stages(story)).toEqual({ failing_seam: 0, barons_levy: 0, deep_shaft: 0 });
    later(story, 2);
    expect(advanceFronts(story, fixedDice(1), false)).toEqual([]);
    later(story, 1); // three days: the first is due
    expect(advanceFronts(story, fixedDice(FRONT_RULE.chance + 1), false)).toEqual([]); // not today
    expect(advanceFronts(story, fixedDice(1), false)).toEqual([]); // and not again the same day, whatever the die
    later(story, 1);
    const moved = advanceFronts(story, fixedDice(FRONT_RULE.chance), false);
    expect(moved.map((m) => m.front.id)).toEqual(['failing_seam', 'barons_levy']); // the second came due today too
    expect(moved[0]).toMatchObject({ stage: 1, last: false, place: 'ashford', also: ['high_pits', 'far_market'], what: 'The assay books are quietly rewritten and a surveyor who knows better is sent away.' });
    expect(moved[0]!.news).toContain('dismissed its surveyor');
    expect(front(story, 'failing_seam')).toMatchObject({ stage: 1, movedIn: 1, since: story.clock });
  });

  it('they do not all come due on the same day', async () => {
    const { session: s } = await builtHarness();
    const due: string[][] = [];
    for (let day = 0; day < 6; day++) { later(s.story, 1); due.push(advanceFronts(s.story, fixedDice(1), false).map((m) => m.front.id)); }
    expect(due).toEqual([[], [], ['failing_seam'], ['barons_levy'], ['deep_shaft'], []]);
  });

  it('a front moves once a chapter, however many days go by', async () => {
    const { session: s } = await builtHarness();
    later(s.story, 3);
    expect(advanceFronts(s.story, fixedDice(1), false)).toHaveLength(1);
    later(s.story, 30); // a month on the road, in the same chapter
    expect(advanceFronts(s.story, fixedDice(1), false).map((m) => m.front.id)).toEqual(['barons_levy', 'deep_shaft']);
    later(s.story, 30);
    expect(advanceFronts(s.story, fixedDice(1), true)).toEqual([]); // not even when the chapter ends: each has moved in it
    s.story.chapter.n = 2;
    expect(advanceFronts(s.story, fixedDice(1), false)).toHaveLength(3);
    expect(stages(s.story)).toEqual({ failing_seam: 2, barons_levy: 2, deep_shaft: 2 });
  });

  it('when a chapter ends, what has not moved in it moves without a roll, if at least a day has passed', async () => {
    const { session: s } = await builtHarness();
    later(s.story, 0, 600); // ten hours: a chapter played in one evening leaves the world where it was
    expect(advanceFronts(s.story, fixedDice(6), true)).toEqual([]);
    later(s.story, 1);
    const moved = advanceFronts(s.story, fixedDice(6), true);
    expect(moved.map((m) => m.front.id)).toEqual(['failing_seam', 'barons_levy', 'deep_shaft']);
  });

  it('set back, stopped and finished fronts stay where they are', async () => {
    const { session: s } = await builtHarness();
    const story = s.story;
    setBack(story, front(story, 'failing_seam'));
    stopFront(front(story, 'barons_levy'));
    front(story, 'deep_shaft').stage = 3; // its last stage has come to pass
    expect(frontOpen(front(story, 'deep_shaft'))).toBe(false);
    later(story, 10);
    expect(advanceFronts(story, fixedDice(1), true)).toEqual([]);
    // The one that was set back goes on in the next chapter, once its days are up.
    story.chapter.n = 2;
    expect(advanceFronts(story, fixedDice(1), false).map((m) => m.front.id)).toEqual(['failing_seam']);
    expect(front(story, 'barons_levy')).toMatchObject({ stage: 0, stopped: true });
  });

  it('the last stage is marked as the end of it, and word starts from a town it touches', async () => {
    const { session: s } = await builtHarness();
    const story = s.story;
    front(story, 'deep_shaft').stage = 2;
    later(story, 6);
    const last = advanceFronts(story, fixedDice(1), false).find((m) => m.front.id === 'deep_shaft')!;
    expect(last).toMatchObject({ stage: 3, last: true });
    // It touches only open country: word starts where it happened.
    expect(frontPlace(story, front(story, 'deep_shaft'))).toBe('high_pits');
    expect(frontPlace(story, front(story, 'barons_levy'))).toBe('garrow_keep');
    // What touches several places is talked about from each of them: the levy is news in Ashford as soon as in the Keep.
    front(story, 'barons_levy').stage = 0;
    front(story, 'barons_levy').movedIn = undefined;
    front(story, 'barons_levy').since = undefined;
    story.chapter.n = 3;
    const levy = advanceFronts(story, fixedDice(1), false).find((m) => m.front.id === 'barons_levy')!;
    expect(levy.also).toEqual(['ashford', 'stonewater', 'blackwood']);
    expect(frontLine(front(story, 'deep_shaft'))).toBe('IN MOTION What the deep shaft woke. So far: It reaches the surface on a night with no moon. It has run its course.');
  });

  it('a world built before stages had news still moves, and nothing is said of it', async () => {
    const { session: s } = await builtHarness();
    for (const f of s.story.world.fronts!) delete f.news;
    later(s.story, 3);
    expect(advanceFronts(s.story, fixedDice(1), false)).toEqual([expect.objectContaining({ stage: 1, news: null })]);
  });
});

describe('the world moving, in play', () => {
  it('a stage comes to pass when a scene ends, becomes news, and the narrator is told what is now so', async () => {
    const h = await builtHarness();
    const s = h.session;
    await s.begin();
    worldRolls(s.story, 1);
    later(s.story, 3);
    const dice = s.story.rng.state;
    await s.travel('market_square');
    expect(s.scene.placeId).toBe('market_square');
    expect(stages(s.story)).toEqual({ failing_seam: 1, barons_levy: 0, deep_shaft: 0 });
    expect(s.story.rng.state).toBe(dice); // the world rolled its own dice, not the player's
    const news = s.story.events.filter((e) => e.front);
    expect(news).toEqual([expect.objectContaining({ front: 'failing_seam', reach: 'public', placeId: 'ashford', importance: 2, actors: [], witnesses: [] })]);
    expect(news[0]!.text).toBe('The Ashford Company has dismissed its surveyor, and nobody at the Company Office will say why.');
    // The scene that opens knows what has come to pass and what comes next.
    expect(s.scene.packet).toContain('IN MOTION The failing seam. So far: The assay books are quietly rewritten and a surveyor who knows better is sent away. Coming, if nobody stops it: Shifts are cut');
    // Word has not got round yet: it happened minutes ago.
    expect(s.scene.packet).not.toContain('TALK HERE');
    expect(newsFor(s.story, 'market_square')).toEqual([]);
    // Six hours later it is the talk of the town, and people there have heard it.
    later(s.story, 0, 7 * 60);
    await s.travel('widow_hare');
    expect(s.scene.packet).toContain('TALK HERE The Ashford Company has dismissed its surveyor');
    expect(knowledgeOf(s.story, 'hare').some((k) => k.how === 'heard' && k.event.front === 'failing_seam')).toBe(true);
    expect(s.scene.packet).toMatch(/\[hare\] The Widow Hare.*Has heard: The Ashford Company has dismissed its surveyor/s);
    // The player was told nothing by the game: no note on any turn says the world moved.
    const notes = s.story.scenes.flatMap((sc) => sc.turns).flatMap((t) => t.beats).flatMap((b) => (b.type === 'notes' ? b.notes : []));
    expect(notes.some((n) => n.kind === 'info' && /surveyor|seam/i.test(n.text))).toBe(false);
  });

  it('what happens out of sight moves the world and makes no news', async () => {
    const h = await builtHarness();
    const s = h.session;
    await s.begin();
    front(s.story, 'barons_levy').stage = 1; // the next stage is the families hiding their children: nobody is told
    worldRolls(s.story, 1);
    later(s.story, 4);
    await s.travel('market_square');
    expect(front(s.story, 'barons_levy').stage).toBe(2);
    expect(s.story.events.filter((e) => e.front === 'barons_levy')).toEqual([]);
    expect(s.scene.packet).toContain('So far: Families begin hiding their sons and daughters in Blackwood and the fen.');
  });

  it('word reaches other towns days later, and is nobody’s memory there before it does', async () => {
    const h = await builtHarness();
    const s = h.session;
    await s.begin();
    worldRolls(s.story, 1);
    later(s.story, 3);
    await s.travel('market_square');
    const news = s.story.events.find((e) => e.front === 'failing_seam')!;
    later(s.story, 1);
    expect(hasReached(s.story, news, 'market_square')).toBe(true);
    expect(hasReached(s.story, news, 'stonewater')).toBe(false);
    expect(hasReached(s.story, news, 'blackwood')).toBe(false);
    await s.travel('stonewater');
    expect(s.scene.packet).not.toContain('dismissed its surveyor');
    expect(recall(s.story, ['surveyor', 'dismissed'])).toEqual([]); // the protagonist left before the talk started... and it has not caught up
    later(s.story, 3);
    expect(hasReached(s.story, news, 'stonewater')).toBe(true);
    expect(hasReached(s.story, news, 'blackwood')).toBe(true); // open country is part of the country too
    expect(reachOf(s.story, 'blackwood')).toEqual({ town: null, wide: reachOf(s.story, 'ashford').wide });
    expect(newsFor(s.story, 'stonewater', 5).map((e) => e.front)).toContain('failing_seam');
    expect(recall(s.story, ['surveyor', 'dismissed']).map((e) => e.front)).toEqual(['failing_seam']);
    await s.travel('stonewater_square');
    expect(s.scene.packet).toContain('TALK HERE The Ashford Company has dismissed its surveyor, and nobody at the Company Office will say why. (word from Ashford)');
    // Old news stops being talked about.
    later(s.story, 12);
    expect(newsFor(s.story, 'stonewater')).toEqual([]);
  });

  it('the scribe is told what is in motion where the scene was played, and can say the protagonist held it back', async () => {
    const h = await builtHarness();
    const s = h.session;
    await s.begin();
    worldRolls(s.story, 1);
    later(s.story, 5);
    // The scribe names one that shows here, and one that does not: only the first can have been hindered from this table.
    h.scribe.push({ summary: 'You showed the Lodge the true pages.', story_so_far: '', events: [], attitudes: [], fronts: [{ id: 'failing_seam', change: 'set_back' }, { id: 'deep_shaft', change: 'stopped' }], chapter: null });
    await s.travel('market_square');
    const asked = text(h.requests.find((r) => r.role === 'scribe')!);
    expect(asked).toContain('IN MOTION HERE');
    expect(asked).toContain('- [failing_seam] The failing seam:');
    expect(asked).toContain('- [barons_levy] The baron’s levy:');
    expect(asked).not.toContain('deep_shaft');
    expect(front(s.story, 'failing_seam')).toMatchObject({ stage: 0, heldUntil: s.story.clock.day + FRONT_RULE.setBackDays, movedIn: 1 });
    expect(front(s.story, 'deep_shaft').stopped).toBeUndefined();
    expect(stages(s.story)).toEqual({ failing_seam: 0, barons_levy: 1, deep_shaft: 1 }); // the others went on
  });

  it('ending one for good stops it, and the narrator is told it goes no further', async () => {
    const h = await builtHarness();
    const s = h.session;
    await s.begin();
    front(s.story, 'failing_seam').stage = 1;
    h.scribe.push({ summary: 'You broke the Company’s hold.', story_so_far: '', events: [], attitudes: [], fronts: [{ id: 'failing_seam', change: 'stopped' }], chapter: null });
    later(s.story, 9);
    worldRolls(s.story, 1);
    await s.travel('market_square');
    expect(front(s.story, 'failing_seam')).toMatchObject({ stage: 1, stopped: true });
    expect(s.scene.packet).toContain('IN MOTION The failing seam. So far: The assay books are quietly rewritten and a surveyor who knows better is sent away. It was stopped, and goes no further.');
    // A scribe that says nothing of fronts at all (an older answer) changes nothing.
    h.scribe.push({ summary: 'x', story_so_far: '', events: [], attitudes: [], chapter: null });
    await s.travel('widow_hare');
    expect(front(s.story, 'failing_seam').stage).toBe(1);
  });

  it('rewinding takes the world back too, and it moves the same way again', async () => {
    const h = await builtHarness();
    const s = h.session;
    await s.begin();
    await s.submit('I read the ledger.');
    later(s.story, 6);
    await s.travel('market_square'); // the world's own dice decide here: whatever they say, they say it again
    await s.submit('I look around.');
    const after = { stages: stages(s.story), news: s.story.events.filter((e) => e.front).map((e) => e.text), dice: s.story.worldDice };
    expect(await s.rewindTo(2)).toBe(true);
    expect(stages(s.story)).toEqual({ failing_seam: 0, barons_levy: 0, deep_shaft: 0 });
    expect(s.story.events.some((e) => e.front)).toBe(false);
    expect(s.story.worldDice).toBeUndefined();
    later(s.story, 6);
    await s.travel('market_square');
    await s.submit('I look around.');
    expect({ stages: stages(s.story), news: s.story.events.filter((e) => e.front).map((e) => e.text), dice: s.story.worldDice }).toEqual(after);
  });

  it('over a long story fronts move once a chapter, never past their end, and the packet stays within its size', async () => {
    const h = await builtHarness();
    const s = h.session;
    await s.begin();
    const seen: { chapter: number; stages: Record<string, number> }[] = [];
    let biggest = 0;
    for (let i = 0; i < 52; i++) {
      later(s.story, 1);
      await s.submit('I ask what people are saying.');
      await s.travel(s.scene.placeId === 'market_square' ? 'widow_hare' : 'market_square');
      expect(s.blocker).toBeNull();
      biggest = Math.max(biggest, s.scene.packet.length);
      seen.push({ chapter: s.story.chapter.n, stages: stages(s.story) });
    }
    expect(s.story.chapter.n).toBeGreaterThanOrEqual(4);
    expect(biggest).toBeLessThanOrEqual(PACKET_MAX_CHARS);
    // Within any one chapter a front's stage goes up by one at most.
    for (const id of Object.keys(seen[0]!.stages)) {
      const byChapter = new Map<number, number[]>();
      for (const x of seen) byChapter.set(x.chapter, [...(byChapter.get(x.chapter) ?? []), x.stages[id]!]);
      for (const [n, list] of byChapter) expect(Math.max(...list) - Math.min(...list), `${id} in chapter ${n}`).toBeLessThanOrEqual(1);
    }
    // After four chapters and fifty days everything has run its course, and stays there.
    for (const f of s.story.world.fronts!) expect(f.stage, f.id).toBe(f.stages.length);
    expect(s.story.events.filter((e) => e.front).length).toBe(10); // eleven stages, one of them out of sight
    expect(s.scene.packet).toMatch(/IN MOTION .*It has run its course\./);
    expect(checkWorld(s.story.world)).toEqual([]);
  });
});

describe('the sample world moves too', () => {
  it('has things in motion, one of them already begun when the story is picked up', () => {
    expect(checkWorld(lanternCoast)).toEqual([]);
    const story = newStory(glassRoadSeed(), 0);
    expect(story.world.fronts!.map((f) => [f.id, f.stage, f.stages.length, f.news!.length])).toEqual([['borrowed_seal', 1, 4, 4], ['ferrymen_push', 0, 4, 4], ['glass_failing', 0, 3, 3]]);
    expect(frontsFor(story, 'lantern_market').map((f) => f.id)).toEqual(['borrowed_seal', 'ferrymen_push']);
    expect(story.scenes[0]!.packet).toContain('IN MOTION The borrowed seal. So far: Letters under a copied seal go out along the coast');
    expect(story.scenes[0]!.packet.length).toBeLessThanOrEqual(PACKET_MAX_CHARS);
  });

  it('and its news is talked about in Port Varn', async () => {
    const h = harness();
    const s = h.session;
    for (const id of ['wardens', 'knifeman', 'cudgel', 'kessa']) s.story.world.people[id]!.placeId = 'nowhere';
    await s.submit('I look around the market.');
    worldRolls(s.story, 1);
    later(s.story, 3);
    await s.travel('guild_house');
    expect(front(s.story, 'borrowed_seal').stage).toBe(2);
    later(s.story, 0, 8 * 60);
    await s.travel('lantern_market');
    expect(s.scene.packet).toContain('TALK HERE The baron’s wardens in grey have been stopping couriers inside Port Varn');
  });
});

describe('the builder writes what people would hear', () => {
  const INPUT: BuildInput = { source: { kind: 'description', text: 'x' }, premise: 'y', name: '', table: { style: 'adventure', powers: 'focus', companions: 0, romance: false, violence: 'moderate', leaveOut: '', language: 'en', narration: 'medium' } };
  it('a stage keeps its news, a too-short one is dropped, and a bare sentence is still a stage', () => {
    const draft = newDraft('w', INPUT, 0);
    const sk = cleanStep('skeleton', mockArchitect({ step: 'skeleton', input: INPUT, done: {} }) as never, {}, INPUT).data;
    draft.steps.skeleton = sk;
    const raw = mockArchitect({ step: 'fronts', input: INPUT, done: draft.steps }) as { fronts: { stages: unknown[] }[] };
    raw.fronts[0]!.stages[0] = { what: 'Something happens quietly.', news: 'no' };
    raw.fronts[0]!.stages[1] = 'A bare sentence, as an earlier build wrote them.';
    raw.fronts[0]!.stages[2] = { what: '', news: 'News of nothing.' };
    const kept = cleanStep('fronts', raw as never, draft.steps, INPUT).data;
    expect(kept.fronts[0]!.stages).toEqual([
      { what: 'Something happens quietly.', news: null },
      { what: 'A bare sentence, as an earlier build wrote them.', news: null },
      { what: 'The pits close. Half of Ashford is out of work before the first snow.', news: 'The pits above Ashford have closed, and half the town is out of work.' },
    ]);
  });
});
