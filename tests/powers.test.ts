// Powers in play: using what is known, trying what is not, being taught, learning, and the Extreme mode.
import { describe, expect, it } from 'vitest';
import {
  ABILITIES, EXTREME_COST, XP_TO_LEARN, abilityCost, blankDraft, canAttempt, canImprovise, canLearn, canUseAbility, check, commandOf,
  fixedDice, learnDifficulty, repair, schoolsOf, teachingStage, traitsFor, type Sheet,
} from '../src/engine';
import { lessonsFrom, protagonistCard, teachableHere, withinReach } from '../src/game/cards';
import type { LlmRequest } from '../src/game/llm/transport';
import type { Story } from '../src/game/types';
import { checkWorld, creationRules, teachesOf } from '../src/game/world';
import { lanternCoast } from '../src/packs/lanternCoast';
import { builtHarness, demoTemplate, harness } from './helpers';

const text = (req: LlmRequest): string => req.params.messages.map((m) => (typeof m.content === 'string' ? m.content : m.content.map((b) => (b.type === 'text' ? b.text : '')).join(''))).join('\n');
/** The player's dice always come up with this face. */
const rolls = (story: Story, face: number) => { story.rng = fixedDice(face); };
const notesOf = (story: Story): string[] => story.scenes.flatMap((sc) => sc.turns).flatMap((t) => t.beats).flatMap((b) => (b.type === 'notes' ? b.notes : [])).flatMap((n) => (n.kind === 'info' ? [n.text] : []));
const REF = { check: null, targets: [], mentions: [], recall: [], move_to: null, held: null, ability: null, improvise: null, minutes: 1, why_impossible: null, ask: null, ask_options: [] };

const sheet = (over: Partial<Sheet> = {}): Sheet => ({
  strength: 1, skill: 3, resistance: 2, armor: 1, firepower: 0, hp: 10, energy: 10, paths: { air: 2, light: 1 }, skills: [], advantages: [], disadvantages: [],
  abilities: ['featherstep', 'gale_push', 'glimmer'], ...over,
});

describe('the rules of powers', () => {
  it('in a world of paths an ability must be learned, within Focus, and paid for', () => {
    const s = sheet();
    expect(canUseAbility(s, 'gale_push')).toMatchObject({ ok: true, cost: 2 });
    expect(canUseAbility(s, 'whisper')).toEqual({ ok: false, reason: 'not_learned' });
    expect(canUseAbility(sheet({ paths: { air: 1 } }), 'gale_push')).toEqual({ ok: false, reason: 'focus' });
    expect(canUseAbility(sheet({ energy: 1 }), 'gale_push')).toEqual({ ok: false, reason: 'energy' });
    expect(canUseAbility(s, 'nonsense')).toEqual({ ok: false, reason: 'unknown' });
    expect(canUseAbility(s, 'gale_push', 'off')).toEqual({ ok: false, reason: 'no_powers' });
    expect(commandOf(s, 'focus').map((a) => a.id)).toEqual(['featherstep', 'gale_push', 'glimmer']);
    expect(commandOf(s, 'off')).toEqual([]);
  });

  it('what is not learned can be attempted when the path is high enough: harder, and one energy dearer', () => {
    const s = sheet();
    expect(canAttempt(s, 'whisper')).toMatchObject({ ok: true, cost: 2, difficulty: 'hard' }); // air 1, within air 2
    expect(canAttempt(s, 'windcallers_ear')).toMatchObject({ ok: true, cost: 3 });
    expect(canAttempt(s, 'long_step')).toEqual({ ok: false, reason: 'focus' }); // air 3
    expect(canAttempt(s, 'spark')).toEqual({ ok: false, reason: 'focus' }); // no fire at all
    expect(canAttempt(sheet({ energy: 1 }), 'whisper')).toEqual({ ok: false, reason: 'energy' });
  });

  it('an effect of one’s own is allowed within a path one has, and is always a test', () => {
    const s = sheet();
    expect(canImprovise(s, 'air', 2, 'focus')).toEqual({ ok: true, cost: 3, difficulty: 'hard' });
    expect(canImprovise(s, 'air', 3, 'focus')).toEqual({ ok: false, reason: 'focus' });
    expect(canImprovise(s, 'fire', 1, 'focus')).toEqual({ ok: false, reason: 'focus' });
    expect(canImprovise(s, 'air', 1, 'off')).toEqual({ ok: false, reason: 'no_powers' });
    expect(canImprovise(s, 'air', 99, 'focus')).toEqual({ ok: false, reason: 'focus' }); // a reach beyond 4 is read as 4
  });

  it('in the Extreme mode a school is every ability of its paths, at a cost that climbs, and never more than five times Skill', () => {
    const s = sheet({ paths: {}, abilities: [], advantages: ['Elemental School'], energy: 15 });
    expect(schoolsOf(s)).toEqual(['elemental']);
    expect(commandOf(s, 'extreme')).toHaveLength(24);
    expect([1, 2, 3, 4].map((tier) => abilityCost({ tier, cost: tier }, 'extreme'))).toEqual([1, 3, 6, 10]);
    expect(EXTREME_COST.slice(1)).toEqual([1, 3, 6, 10]);
    expect(canUseAbility(s, 'firedart', 'extreme')).toMatchObject({ ok: true, cost: 3 });
    expect(canUseAbility(s, 'wildfire', 'extreme')).toMatchObject({ ok: true, cost: 10 });
    expect(canUseAbility(s, 'glimmer', 'extreme')).toEqual({ ok: false, reason: 'not_learned' }); // the White School is not theirs
    expect(canUseAbility(sheet({ paths: {}, abilities: [], advantages: ['Elemental School'], skill: 1, energy: 15 }), 'furnace_breath', 'extreme')).toEqual({ ok: false, reason: 'skill' }); // 6 is more than 5 × 1
    expect(canUseAbility(sheet({ paths: {}, abilities: [], advantages: ['Elemental School'], energy: 5 }), 'wildfire', 'extreme')).toEqual({ ok: false, reason: 'energy' });
    expect(canImprovise(s, 'water', 2, 'extreme')).toEqual({ ok: true, cost: 3, difficulty: 'medium' });
    expect(canImprovise(s, 'dark', 1, 'extreme')).toEqual({ ok: false, reason: 'not_learned' });
    const all = sheet({ paths: {}, abilities: [], advantages: ['White School', 'Black School', 'Elemental School'] });
    expect(commandOf(all, 'extreme')).toHaveLength(36);
  });

  it('someone teaches an ability to a person they know well enough: the higher the tier, the better; a mentor a stage sooner', () => {
    expect([1, 2, 3, 4].map((t) => teachingStage(t, false))).toEqual([1, 2, 3, 4]);
    expect([1, 2, 3, 4].map((t) => teachingStage(t, true))).toEqual([0, 1, 2, 3]);
  });

  it('learning needs the ability to be found, Focus for it, and a point of experience', () => {
    const s = sheet();
    const found = [{ id: 'whisper', by: 'hask' }, { id: 'long_step' }];
    expect(canLearn(s, found, 'whisper', 1, XP_TO_LEARN)).toBeNull();
    expect(canLearn(s, found, 'whisper', 0, XP_TO_LEARN)).toBe('xp');
    expect(canLearn(s, found, 'long_step', 5, XP_TO_LEARN)).toBe('focus');
    expect(canLearn(s, found, 'dusk_eyes', 5, XP_TO_LEARN)).toBe('not_found');
    expect(canLearn(s, found, 'glimmer', 5, XP_TO_LEARN)).toBe('known');
    expect(learnDifficulty(found[0]!)).toBe('easy'); // someone showed how
    expect(learnDifficulty(found[1]!)).toBe('medium'); // worked out alone
  });

  it('the schools are advantages of worlds that have them, and of no other', async () => {
    expect(traitsFor('advantage', 'focus').some((t) => t.only)).toBe(false);
    expect(traitsFor('advantage', 'extreme').filter((t) => t.only).map((t) => t.name)).toEqual(['White School', 'Black School', 'Elemental School']);
    const focus = creationRules(lanternCoast);
    const draft = { ...blankDraft(focus), name: 'Ana', advantages: ['White School'] };
    expect(check(draft, focus).problems.map((p) => p.text)).toEqual(['White School exists only in worlds where powers are schools.']);
    expect(repair(draft, focus).draft.advantages).toEqual([]);
    const extreme = creationRules((await demoTemplate({ powers: 'extreme' })).world);
    expect(extreme).toMatchObject({ powers: 'extreme', pathCap: 0 });
    expect(check({ ...draft, advantages: ['White School', 'Elemental School'] }, extreme)).toMatchObject({ ok: true, parts: { advantages: 4 } });
    expect(check({ ...draft, advantages: [], paths: { fire: 1 } }, extreme).problems.map((p) => p.text)).toContain('In this world powers are schools, bought as advantages: paths stay at 0.');
  });

  it('who practises a path can teach it, as far as they have come', () => {
    expect(teachesOf({ path: 'earth', mastery: 'dabbler' }, 'focus')).toEqual(['stoneskin', 'sure_footing']);
    expect(teachesOf({ path: 'earth', mastery: 'adept' }, 'focus')).toHaveLength(4);
    expect(teachesOf({ path: 'earth', mastery: 'master' }, 'focus')).toHaveLength(6);
    expect(teachesOf({ path: 'earth', mastery: 'master' }, 'off')).toEqual([]);
    expect(teachesOf({ path: 'earth', mastery: 'master' }, 'extreme')).toEqual([]);
    expect(teachesOf(null, 'focus')).toEqual([]);
    const w = structuredClone(lanternCoast);
    w.people.sela!.teaches = ['glimmer', 'summon_dragon'];
    expect(checkWorld(w)).toEqual(['Sela of the Old Mill teaches "summon_dragon", which is not an ability the game knows']);
  });
});

describe('trying what is not learned', () => {
  it('a success works this once and shows how it is done; the energy is spent either way', async () => {
    const h = harness();
    const s = h.session;
    const me = s.story.protagonist;
    rolls(s.story, 1);
    const energy = me.sheet.energy;
    h.referee.push({ ...REF, kind: 'ability', ability: 'whisper' });
    await s.submit('I send a whisper to Mira across the market.');
    expect(me.sheet.energy).toBe(energy - 2); // tier 1, and one more for not knowing it
    expect(me.found).toEqual([{ id: 'whisper' }]);
    expect(me.sheet.abilities).not.toContain('whisper');
    const turn = s.lastTurn!;
    expect(turn.beats.find((b) => b.type === 'check')).toMatchObject({ result: { attribute: 'skill', difficulty: 'hard', target: 1, die: 1, passed: true, label: 'attempt Whisper' } });
    expect(turn.engineNote).toContain('attempt: Aren tries Whisper, which they have never learned');
    expect(turn.engineNote).toContain('check: attempt Whisper (skill, hard) -> SUCCESS');
    expect(notesOf(s.story).join(' | ')).toContain('You have worked out how Whisper is done. Learn it for 1 experience on the Character screen.');
    // A failure: the effort is spent, and nothing is found.
    rolls(s.story, 5);
    h.referee.push({ ...REF, kind: 'ability', ability: 'windcallers_ear' });
    await s.submit('I listen on the wind for what the Watch is saying.');
    expect(me.sheet.energy).toBe(energy - 2 - 3);
    expect(me.found).toEqual([{ id: 'whisper' }]);
    expect(s.lastTurn!.engineNote).toMatch(/check: attempt Windcaller’s Ear \(skill, hard\) -> FAILURE/);
  });

  it('the referee’s own test is not rolled on top of the attempt', async () => {
    const h = harness();
    rolls(h.session.story, 1);
    h.referee.push({ ...REF, kind: 'ability', ability: 'whisper', check: { attribute: 'skill', skill: 'Manipulation', difficulty: 'medium', label: 'something else', opposed_by: null } });
    await h.session.submit('I whisper to Mira.');
    expect(h.session.lastTurn!.beats.filter((b) => b.type === 'check')).toHaveLength(1);
  });

  it('an effect of the player’s own invention costs energy, is a hard test, and leaves nothing to learn', async () => {
    const h = harness();
    const s = h.session;
    const me = s.story.protagonist;
    rolls(s.story, 1);
    const energy = me.sheet.energy;
    h.referee.push({ ...REF, kind: 'ability', improvise: { path: 'air', tier: 2 } });
    await s.submit('I shape the air into a cushion under the falling crate.');
    expect(me.sheet.energy).toBe(energy - 3);
    expect(me.found ?? []).toEqual([]);
    expect(s.lastTurn!.engineNote).toContain('improvised: Aren shapes air into an effect of their own');
    expect(s.lastTurn!.engineNote).toContain('Its reach is 2 of 4 (one person or one room, for a scene)');
    expect(s.lastTurn!.beats.find((b) => b.type === 'check')).toMatchObject({ result: { difficulty: 'hard', label: 'shape air' } });
    // Beyond the path, or a path they do not have: the engine says no, and nothing is spent.
    h.referee.push({ ...REF, kind: 'ability', improvise: { path: 'air', tier: 3 } });
    await s.submit('I call a wind to scatter the whole Watch.');
    expect(s.notice).toBe('That is more than your air can do yet.');
    h.referee.push({ ...REF, kind: 'ability', improvise: { path: 'fire', tier: 1 } });
    await s.submit('I light the lamp with a thought.');
    expect(s.notice).toBe('That is more than your fire can do yet.');
    expect(me.sheet.energy).toBe(energy - 3);
    expect(s.story.totals.turns).toBe(1);
  });

  it('the referee is told what is within reach, what the paths are, and the demo referee reads an attempt', async () => {
    const h = harness();
    expect(withinReach(h.session.story).map((a) => a.id)).toEqual(['whisper', 'dusk_eyes', 'windcallers_ear']);
    await h.session.submit('I try Dusk Eyes to see into the alley.');
    const asked = text(h.requests[0]!);
    expect(asked).toContain('ABILITIES [featherstep] Featherstep (1 energy); [gale_push] Gale Push (2 energy); [glimmer] Glimmer (1 energy)');
    expect(asked).toContain('NOT LEARNED [whisper] Whisper (air 1); [dusk_eyes] Dusk Eyes (light 1); [windcallers_ear] Windcaller’s Ear (air 2)');
    expect(asked).toContain('PATHS air 2, light 1');
    expect(asked).not.toContain('CAN BE TAUGHT HERE'); // nobody in the market teaches
    expect(h.session.lastTurn!.engineNote).toContain('attempt: Aren tries Dusk Eyes');
  });
});

describe('being taught', () => {
  const withHask = () => {
    const h = harness();
    h.session.story.world.people.hask!.placeId = 'lantern_market';
    return h;
  };

  it('someone who knows the protagonist well enough shows them an ability; it is found, not yet learned', async () => {
    const h = withHask();
    const s = h.session;
    const me = s.story.protagonist;
    expect(lessonsFrom(s.story, s.story.world.people.hask!).map((a) => a.id)).toEqual(['whisper', 'windcallers_ear', 'long_step']); // not the two Aren already knows
    expect(teachableHere(s.story, 'lantern_market').map((t) => `${t.ability.id}<${t.teacher.id}`)).toEqual(['whisper<hask', 'windcallers_ear<hask', 'long_step<hask']);
    h.referee.push({ ...REF, kind: 'learn', ability: 'long_step', targets: ['hask'], minutes: 60 });
    await s.submit('I ask the Guildmaster to teach me the Long Step.');
    // Hask is a mentor and trusts Aren: a tier three ability needs Friendly from a mentor.
    expect(me.found).toEqual([{ id: 'long_step', by: 'hask' }]);
    expect(me.sheet.abilities).not.toContain('long_step');
    expect(s.lastTurn!.engineNote).toContain('teach: Oren Hask agrees, and shows Aren Long Step');
    expect(notesOf(s.story).join(' | ')).toContain('Oren Hask showed you Long Step. Learn it for 1 experience on the Character screen.');
    // The scene's packet and the referee both knew he could teach.
    expect(s.scene.packet).not.toContain('Can teach'); // the packet was built before he walked in
    expect(text(h.requests[0]!)).toContain('CAN BE TAUGHT HERE [whisper] Whisper by [hask]; [windcallers_ear] Windcaller’s Ear by [hask]; [long_step] Long Step by [hask]');
    // Asking again, or for something already known, is answered by the engine.
    h.referee.push({ ...REF, kind: 'learn', ability: 'long_step', targets: ['hask'] });
    await s.submit('Teach me the Long Step.');
    expect(s.notice).toBe('You have already been shown Long Step. Learn it on the Character screen.');
    h.referee.push({ ...REF, kind: 'learn', ability: 'gale_push', targets: ['hask'] });
    await s.submit('Teach me Gale Push.');
    expect(s.notice).toBe('You already know Gale Push.');
  });

  it('someone who barely knows the protagonist says not yet, and the turn says what it would take', async () => {
    const h = harness();
    const s = h.session;
    s.story.world.people.sela!.placeId = 'lantern_market';
    h.referee.push({ ...REF, kind: 'learn', ability: 'dusk_eyes', targets: ['sela'] });
    await s.submit('I ask Sela to teach me to see in the dark.');
    expect(s.story.protagonist.found ?? []).toEqual([]);
    expect(s.lastTurn!.engineNote).toContain('teach: Aren asks Sela of the Old Mill to teach Dusk Eyes. Sela of the Old Mill will not, yet');
    expect(notesOf(s.story).join(' | ')).toContain('Sela of the Old Mill teaches Dusk Eyes to someone they know as Acquaintance. You are at No bond yet.');
    // Once they are acquainted, the first lesson is given; the fourth tier still waits.
    s.story.world.people.sela!.bond = 5;
    h.referee.push({ ...REF, kind: 'learn', ability: 'dusk_eyes', targets: ['sela'] });
    await s.submit('I ask Sela again.');
    expect(s.story.protagonist.found).toEqual([{ id: 'dusk_eyes', by: 'sela' }]);
    h.referee.push({ ...REF, kind: 'learn', ability: 'daybreak', targets: ['sela'] });
    await s.submit('And Daybreak?');
    expect(s.story.protagonist.found).toHaveLength(1);
    expect(notesOf(s.story).join(' | ')).toContain('teaches Daybreak to someone they know as Close');
  });

  it('with nobody here who teaches it, asking is plain talk', async () => {
    const h = harness();
    h.referee.push({ ...REF, kind: 'learn', ability: 'whisper', targets: ['mira'] });
    await h.session.submit('I ask Mira to teach me to whisper on the wind.');
    expect(h.session.story.totals.turns).toBe(1);
    expect(h.session.lastTurn!.engineNote).not.toContain('teach:');
    expect(h.session.story.protagonist.found ?? []).toEqual([]);
  });

  it('a teacher’s card tells the narrator what they could teach, and the demo referee reads the asking', async () => {
    const h = withHask();
    const s = h.session;
    await s.travel('guild_house');
    s.story.world.people.hask!.placeId = 'guild_house';
    await s.travel('lantern_market');
    await s.travel('guild_house');
    expect(s.scene.packet).toMatch(/\[hask\] Oren Hask.*Can teach Whisper, Windcaller’s Ear, Long Step\./s);
    await s.submit('I ask Hask to teach me Whisper.');
    expect(s.story.protagonist.found).toEqual([{ id: 'whisper', by: 'hask' }]);
  });
});

describe('learning what was found', () => {
  it('costs a point of experience and a Skill test: easy when someone showed how', async () => {
    const h = harness();
    const s = h.session;
    const me = s.story.protagonist;
    me.found = [{ id: 'whisper', by: 'hask' }, { id: 'dusk_eyes' }, { id: 'long_step', by: 'hask' }];
    const xp = me.xp;
    rolls(s.story, 5); // above Skill 3 + 1: not this time
    expect(s.learn('whisper')).toMatchObject({ passed: false, target: 4, die: 5, difficulty: 'easy' });
    expect(me.xp).toBe(xp - 1);
    expect(me.found.map((f) => f.id)).toContain('whisper'); // still found: it can be tried again
    rolls(s.story, 4);
    expect(s.learn('whisper')).toMatchObject({ passed: true });
    expect(me.sheet.abilities).toContain('whisper');
    expect(me.found.map((f) => f.id)).toEqual(['dusk_eyes', 'long_step']);
    expect(me.xp).toBe(xp - 2);
    expect(s.story.rolls.slice(-2).map((r) => r.label)).toEqual(['learn Whisper', 'learn Whisper']);
    // Worked out alone, it is a medium test: at Skill, not Skill + 1.
    expect(s.learn('dusk_eyes')).toMatchObject({ passed: false, target: 3, difficulty: 'medium' });
    // Not enough Focus, not found, no experience, or in a fight: it cannot be tried, and nothing is spent.
    const before = me.xp;
    expect(s.learn('long_step')).toBeNull(); // Air 3, and Aren has Air 2
    expect(s.learn('daybreak')).toBeNull();
    me.xp = 0;
    expect(s.learn('dusk_eyes')).toBeNull();
    expect(me.xp).toBe(0);
    expect(before).toBe(xp - 3);
    // Once learned it is used like any other.
    me.xp = 5;
    h.referee.push({ ...REF, kind: 'ability', ability: 'whisper' });
    await s.submit('I whisper to Mira.');
    expect(s.lastTurn!.engineNote).toContain('ability: Aren uses Whisper');
  });
});

describe('what is done between turns is taken back by a rewind', () => {
  it('experience spent on an attribute or an ability comes back, the raise goes, and the dice are as they were', async () => {
    const h = await builtHarness();
    const s = h.session;
    const me = () => s.story.protagonist;
    me().xp = 12;
    me().found = [{ id: 'sure_footing', by: 'osk' }];
    await s.begin();
    const after1 = { skill: me().sheet.skill, xp: me().xp, abilities: [...me().sheet.abilities], found: structuredClone(me().found), dice: s.story.rng.state, hp: me().sheet.hp };
    // Between turns: raise Skill, then learn (whatever the die says).
    expect(s.raiseAttribute('skill')).toBe(true);
    const learned = s.learn('sure_footing')!;
    expect(me().xp).toBe(1);
    expect(s.story.pendingUndo).toHaveLength(2);
    await s.submit('I look through the ledger.');
    expect(s.story.pendingUndo).toBeUndefined(); // the turn's record carries them now
    // And once more after the newest turn, with nothing played since.
    me().sheet.hp -= 4;
    const dressing = me().items.find((i) => i.heal)!;
    s.useItem(dressing.id);
    expect(me().items.some((i) => i.heal)).toBe(false);
    expect(await s.rewindTo(1)).toBe(true);
    expect({ skill: me().sheet.skill, xp: me().xp, abilities: me().sheet.abilities, found: me().found, dice: s.story.rng.state })
      .toEqual({ skill: after1.skill, xp: 12, abilities: after1.abilities, found: after1.found, dice: after1.dice });
    expect(me().items.find((i) => i.heal)!.qty).toBe(1);
    expect(s.story.pendingUndo).toBeUndefined();
    // The same choices meet the same die.
    expect(s.raiseAttribute('skill')).toBe(true);
    expect(s.learn('sure_footing')).toEqual(learned);
  });

  it('a change made with no turn after it is taken back by rewinding the turn before it', async () => {
    const h = await builtHarness();
    const s = h.session;
    s.story.protagonist.xp = 10;
    await s.begin();
    await s.submit('I read the ledger.');
    const skill = s.story.protagonist.sheet.skill;
    s.raiseAttribute('skill');
    expect(s.story.protagonist.sheet.skill).toBe(skill + 1);
    expect(await s.rewindTo(1)).toBe(true);
    expect(s.story.protagonist).toMatchObject({ xp: 10, sheet: { skill } });
  });
});

describe('the Extreme mode, in play', () => {
  const extreme = async () => {
    const h = await builtHarness({ table: { powers: 'extreme' } });
    return h;
  };

  it('a character commands a whole school, pays by reach, and the narrator is not sent the list', async () => {
    const h = await extreme();
    const s = h.session;
    const me = s.story.protagonist;
    expect(s.story.world.rules).toMatchObject({ powers: 'extreme', pathCap: 0 });
    expect(me.sheet.advantages).toContain('Elemental School');
    expect(me.sheet.paths).toEqual({});
    expect(commandOf(me.sheet, 'extreme')).toHaveLength(24);
    expect(protagonistCard(s.story)).toContain('Powers: Elemental School (broad and showy; the engine says what each use costs).');
    expect(protagonistCard(s.story)).not.toContain('Abilities');
    const energy = me.sheet.energy;
    h.referee.push({ ...REF, kind: 'ability', ability: 'firedart' });
    await s.submit('I throw a dart of flame at the lamp bracket.');
    expect(me.sheet.energy).toBe(energy - 3);
    expect(s.lastTurn!.engineNote).toContain('ability: Robin uses Firedart');
    expect(s.lastTurn!.beats.some((b) => b.type === 'check')).toBe(false); // a known ability is not a test
    const asked = text(h.requests[0]!);
    expect(asked).toContain('[firedart] Firedart (3 energy)');
    expect(asked).toContain('[wildfire] Wildfire (10 energy)');
    expect(asked).toContain('SCHOOLS Elemental School (fire, water, air, earth)');
    expect(asked).not.toContain('NOT LEARNED');
    // Another school's ability: no.
    h.referee.push({ ...REF, kind: 'ability', ability: 'glimmer' });
    await s.submit('I make a light.');
    expect(s.notice).toBe('Glimmer belongs to a school you do not have.');
  });

  it('an effect of one’s own is a medium test at the mode’s cost, and learning is not part of this mode', async () => {
    const h = await extreme();
    const s = h.session;
    rolls(s.story, 1);
    const energy = s.story.protagonist.sheet.energy;
    h.referee.push({ ...REF, kind: 'ability', improvise: { path: 'water', tier: 2 } });
    await s.submit('I shape the water in the trough into a hand that holds the door shut.');
    expect(s.story.protagonist.sheet.energy).toBe(energy - 3);
    expect(s.lastTurn!.beats.find((b) => b.type === 'check')).toMatchObject({ result: { difficulty: 'medium', passed: true } });
    h.referee.push({ ...REF, kind: 'learn', ability: 'spark', targets: ['bram'] });
    await s.submit('I ask Bram to teach me.');
    expect(s.story.protagonist.found ?? []).toEqual([]);
    expect(withinReach(s.story)).toEqual([]);
    expect(teachableHere(s.story, s.scene.placeId)).toEqual([]);
  });

  it('in a fight every ability of the school with an effect there can be used, at the mode’s cost', async () => {
    const h = await extreme();
    const s = h.session;
    const guards = s.story.world.people.company_guards!;
    guards.placeId = 'market_square';
    guards.attitude = 'Hostile';
    await s.travel('market_square');
    expect(s.scene.cast).toContain('company_guards');
    h.referee.push({ ...REF, kind: 'fight', targets: ['company_guards'] });
    await s.submit('I attack the guards.');
    const c = s.scene.combat!;
    expect(c, 'the fight began').toBeTruthy();
    const hero = Object.values(c.fighters).find((f) => f.isProtagonist)!;
    expect(hero.abilities).toContain('firedart');
    expect(hero.abilities).toHaveLength(24);
    expect(hero.costs!.firedart).toBe(3);
    expect(hero.costs!.wildfire).toBe(10);
    if (s.combat?.awaiting === 'action') {
      const energy = hero.energy!;
      await s.combatAct({ type: 'ability', ability: 'firedart', target: Object.values(c.fighters).find((f) => f.side === 'foe')!.id });
      const after = Object.values(s.scene.combat!.fighters).find((f) => f.isProtagonist)!;
      expect(after.energy).toBe(energy - 3);
    }
  });
});

describe('teachers in built worlds', () => {
  it('a word from the builder becomes the abilities someone can teach, in a world of paths only', async () => {
    const focus = await demoTemplate();
    expect(focus.world.people.osk!.teaches).toEqual(ABILITIES.stoneskin && ['stoneskin', 'sure_footing', 'hold_fast', 'stone_ward', 'shape_stone', 'unyielding']);
    expect(focus.world.people.osk!.kind).toBe('mentorship');
    expect(focus.world.people.wren!.teaches).toEqual(['dusk_eyes', 'glimmer']);
    expect(focus.world.people.bram!.teaches).toBeUndefined();
    expect(checkWorld(focus.world)).toEqual([]);
    const off = await demoTemplate({ powers: 'off' });
    expect(Object.values(off.world.people).some((p) => p.teaches)).toBe(false);
  });

  it('the demo hero can be taught by the tally man and learn it', async () => {
    const h = await builtHarness();
    const s = h.session;
    s.story.world.people.osk!.placeId = 'long_table';
    s.story.protagonist.xp = 3;
    rolls(s.story, 1);
    await s.submit('I ask Osk to teach me Sure Footing.');
    expect(s.story.protagonist.found).toEqual([{ id: 'sure_footing', by: 'osk' }]); // a mentor gives the first lesson to anyone
    expect(s.learn('sure_footing')).toMatchObject({ passed: true });
    expect(s.story.protagonist.sheet.abilities).toEqual(['stoneskin', 'sure_footing']);
  });
});
