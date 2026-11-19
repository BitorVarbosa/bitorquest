// The base pack and making a character: the catalogue of traits, the ability library, what the
// rules apply by themselves, and the point-buy rules that say whether a character is allowed.
import { describe, expect, it } from 'vitest';
import {
  ABILITIES, ATTRIBUTES, PATHS, PLAIN_ANCESTRY, POWER_LEVELS, SKILLS, STARTING_TIER, TRAIT_LIST, abilitiesOf, allAbilities, ancestryCost,
  blankDraft, check, checkAncestry, maxEnergy, maxHp, repair, rest, sheetOf, testTarget, traitDef, traitInfo,
  type Ancestry, type CharacterDraft, type CreationRules, type Sheet,
} from '../src/engine';
import { glassRoadSeed } from '../src/packs/lanternCoast';

const MARSH: Ancestry = { id: 'marsh', name: 'Marsh-born', text: 'Raised in Greywater Marsh. Sees well in fog and at dusk.', advantages: ['Keen Senses'], disadvantages: [] };
const RULES: CreationRules = { level: 'champion', powers: 'focus', pathCap: 3, ancestries: [{ ...PLAIN_ANCESTRY }, MARSH] };

/** The courier of the character mockup, as he is made: 15 points, all spent. */
const aren = (over: Partial<CharacterDraft> = {}): CharacterDraft => ({
  name: 'Aren', line: 'a young courier of the Couriers’ Guild in Port Varn', ancestry: 'plain',
  attributes: { strength: 1, skill: 3, resistance: 2, armor: 1, firepower: 0 },
  paths: { air: 1, light: 1 },
  skills: ['Manipulation', 'Survival'],
  advantages: ['Quick Reflexes', 'Patron: Couriers’ Guild'],
  disadvantages: ['Code: the letter always arrives', 'Dependent: Lise, his sister', 'Hunted: the baron’s agents', 'Curious to a fault'],
  abilities: ['featherstep', 'glimmer'],
  ...over,
});
const sheet = (over: Partial<Sheet> = {}): Sheet => ({
  strength: 1, skill: 2, resistance: 2, armor: 1, firepower: 0, hp: 10, energy: 10, paths: {}, skills: [], advantages: [], disadvantages: [], abilities: [], ...over,
});
const texts = (d: CharacterDraft, rules = RULES) => check(d, rules).problems.map((p) => p.text);

describe('the catalogue of advantages and drawbacks', () => {
  it('is large enough to choose from, and every entry is complete', () => {
    const advantages = TRAIT_LIST.filter((t) => t.kind === 'advantage');
    const drawbacks = TRAIT_LIST.filter((t) => t.kind === 'disadvantage');
    expect(advantages.length).toBeGreaterThanOrEqual(18);
    expect(drawbacks.length).toBeGreaterThanOrEqual(18);
    expect(new Set(TRAIT_LIST.map((t) => t.name.toLowerCase())).size).toBe(TRAIT_LIST.length);
    for (const t of TRAIT_LIST) {
      expect([1, 2], t.name).toContain(t.points);
      expect(t.summary.length, t.name).toBeGreaterThan(10);
      expect(t.text.length, t.name).toBeGreaterThan(40);
      expect(t.summary, t.name).not.toMatch(/—/);
      if (t.how === 'rules') expect(t.effect, t.name).toBeTruthy(); else expect(t.effect, t.name).toBeNull();
      if (t.against) expect(traitDef(t.against), `${t.name} against ${t.against}`).toBeDefined();
    }
  });

  it('a trait that cannot be true together with another says so from both sides', () => {
    for (const t of TRAIT_LIST) if (t.against) expect(traitDef(t.against)!.against, t.name).toBe(t.name.toLowerCase());
  });

  it('finds a trait however it is written on a sheet, and what it costs', () => {
    expect(traitDef('Patron: Couriers’ Guild')?.name).toBe('Patron');
    expect(traitDef('  hunted : the baron’s agents')?.points).toBe(2);
    expect(traitDef('Curious to a fault')?.name).toBe('Curious');
    expect(traitDef('Honest to a Fault')?.name).toBe('Honest to a Fault');
    expect(traitDef('Codebreaker')).toBeUndefined();
    expect(traitInfo('Hunted: someone', 'disadvantage').points).toBe(2);
    expect(traitInfo('Nobody knows this one', 'advantage')).toMatchObject({ known: false, points: 1 });
    // Asked for as the wrong kind, it is not that kind's trait.
    expect(traitInfo('Hunted: someone', 'advantage').known).toBe(false);
  });

  it('every trait of the sample character is in it', () => {
    const s = glassRoadSeed().protagonist.sheet;
    for (const t of s.advantages) expect(traitDef(t)?.kind, t).toBe('advantage');
    for (const t of s.disadvantages) expect(traitDef(t)?.kind, t).toBe('disadvantage');
  });
});

describe('what the rules apply by themselves', () => {
  it('Tough, Frail and Deep Reserves move hit points and energy', () => {
    expect(maxHp(sheet())).toBe(10);
    expect(maxEnergy(sheet())).toBe(10);
    expect(maxHp(sheet({ advantages: ['Tough'] }))).toBe(13);
    expect(maxEnergy(sheet({ advantages: ['Tough'] }))).toBe(10);
    expect(maxHp(sheet({ disadvantages: ['Frail'] }))).toBe(7);
    expect(maxHp(sheet({ resistance: 0, disadvantages: ['Frail'] }))).toBe(1); // never less than 1
    expect(maxEnergy(sheet({ advantages: ['Deep Reserves'] }))).toBe(13);
    expect(maxHp(sheet({ advantages: ['Deep Reserves'] }))).toBe(10);
    expect(maxHp({ resistance: 3 })).toBe(15); // a bare number of Resistance still works
  });

  it('Keen Senses makes noticing one point easier, with or without the skill, and nothing else', () => {
    const plain = sheet();
    const keen = sheet({ advantages: ['Keen Senses'] });
    const look = { attribute: 'skill', skill: 'Investigation', difficulty: 'medium' } as const;
    expect(testTarget(keen, look).target).toBe(testTarget(plain, look).target + 1);
    expect(testTarget(sheet({ advantages: ['Keen Senses'], skills: ['Investigation'] }), look).target).toBe(testTarget(sheet({ skills: ['Investigation'] }), look).target + 1);
    const climb = { attribute: 'skill', skill: 'Athletics', difficulty: 'medium' } as const;
    expect(testTarget(keen, climb).target).toBe(testTarget(plain, climb).target);
  });

  it('Iron Will makes tests of Resistance one point easier', () => {
    const hold = { attribute: 'resistance', skill: null, difficulty: 'hard' } as const;
    expect(testTarget(sheet({ advantages: ['Iron Will'] }), hold).target).toBe(testTarget(sheet(), hold).target + 1);
    const push = { attribute: 'strength', skill: null, difficulty: 'hard' } as const;
    expect(testTarget(sheet({ advantages: ['Iron Will'] }), push).target).toBe(testTarget(sheet(), push).target);
  });

  it('a Fast Healer gets twice as much from an hour of rest', () => {
    const hurt = { hp: 2, energy: 3 };
    expect(rest(sheet(hurt), 120)).toMatchObject({ hp: 4, energy: 5 });
    expect(rest(sheet({ ...hurt, advantages: ['Fast Healer'] }), 120)).toMatchObject({ hp: 6, energy: 7 });
    expect(rest(sheet({ ...hurt, advantages: ['Fast Healer'] }), 8 * 60)).toMatchObject({ hp: 10, energy: 10 });
  });
});

describe('the ability library', () => {
  it('has a ladder of abilities in every path, at a cost equal to the tier', () => {
    expect(allAbilities().length).toBeGreaterThanOrEqual(36);
    expect(new Set(allAbilities().map((a) => a.name)).size).toBe(allAbilities().length);
    for (const path of PATHS) {
      const list = abilitiesOf(path);
      expect(list.length, path).toBeGreaterThanOrEqual(6);
      expect(list.filter((a) => a.tier <= STARTING_TIER).length, `${path}: abilities a character can start with`).toBeGreaterThanOrEqual(4);
      for (const tier of [1, 2, 3, 4]) expect(list.some((a) => a.tier === tier), `${path} tier ${tier}`).toBe(true);
      expect(list.some((a) => !a.combat), `${path}: something for outside a fight`).toBe(true);
      expect(list.some((a) => a.combat), `${path}: something for a fight`).toBe(true);
    }
    for (const a of allAbilities()) {
      expect(ABILITIES[a.id]).toBe(a);
      expect(a.cost, a.name).toBe(a.tier);
      expect(a.text.length, a.name).toBeGreaterThan(20);
    }
  });

  it('what an ability does in a fight grows with its tier', () => {
    for (const a of allAbilities()) {
      const c = a.combat;
      if (!c) continue;
      if (c.type === 'damage') expect(c.value, a.name).toBe(a.tier * 2);
      if (c.type === 'heal') expect(c.value, a.name).toBeGreaterThanOrEqual(a.tier * 2);
      if (c.type === 'guard' || c.type === 'dazzle') expect(c.value, a.name).toBeGreaterThanOrEqual(a.tier);
    }
  });

  it('still holds every ability the sample story uses', () => {
    for (const id of glassRoadSeed().protagonist.sheet.abilities) expect(ABILITIES[id], id).toBeDefined();
  });
});

describe('making a character', () => {
  it('the courier of the mockup costs exactly what a Champion has', () => {
    const c = check(aren(), RULES);
    expect(c.problems).toEqual([]);
    expect(c.ok).toBe(true);
    expect(c).toMatchObject({ base: 10, drawbackPoints: 5, drawbackLimit: 5, fromDrawbacks: 5, budget: 15, spent: 15, left: 0, hp: 10, energy: 10, abilityRoom: 2 });
    expect(c.parts).toEqual({ attributes: 7, paths: 2, gift: 0, skills: 4, advantages: 2, ancestry: 0 });
    const s = sheetOf(aren(), RULES);
    expect(s).toMatchObject({ strength: 1, skill: 3, resistance: 2, hp: 10, energy: 10, paths: { air: 1, light: 1 }, abilities: ['featherstep', 'glimmer'] });
  });

  it('one point too many is said as the mockup says it', () => {
    const over = aren({ attributes: { strength: 2, skill: 3, resistance: 2, armor: 1, firepower: 0 } });
    const c = check(over, RULES);
    expect(c.ok).toBe(false);
    expect(c.left).toBe(-1);
    expect(c.problems[0]).toEqual({
      area: 'points',
      text: 'You have spent 16 of 15 points: 1 too many. Lower an attribute, a path, a skill or an advantage. Drawbacks already give back 5, the most a Champion can get, so they cannot cover it.',
    });
    // With room left for drawbacks, the advice is different.
    const few = aren({ attributes: over.attributes, disadvantages: ['Curious'] });
    expect(texts(few)[0]).toMatch(/of 11 points: 5 too many\..*Or take a drawback\.$/);
  });

  it('drawbacks beyond the limit of the level give nothing more back', () => {
    const many = aren({ disadvantages: [...aren().disadvantages, 'Poor', 'Wanted: in Tessaly, by the baron’s court'] });
    const c = check(many, RULES);
    expect(c.drawbackPoints).toBe(8);
    expect(c.fromDrawbacks).toBe(5);
    expect(c.budget).toBe(15);
    expect(c.ok).toBe(true); // allowed: it is the player's choice to be worse off for nothing
  });

  it('the points of each level are the ones the plan gives', () => {
    for (const [level, n] of [['novice', 5], ['seasoned', 7], ['champion', 10], ['legend', 12]] as const) {
      expect(check(blankDraft({ ...RULES, level }), { ...RULES, level }).base).toBe(n);
      expect(POWER_LEVELS[level].points).toBe(n);
    }
  });

  it('says what is wrong, one thing at a time, in words the player can act on', () => {
    expect(texts(aren({ name: ' ' }))).toEqual(['Give your character a name.']);
    expect(texts(aren({ attributes: { strength: 6, skill: 0, resistance: 0, armor: 0, firepower: 0 } }))).toContain('Strength must be a whole number from 0 to 5.');
    expect(texts(aren({ paths: { air: 4 }, abilities: [], attributes: { strength: 1, skill: 1, resistance: 2, armor: 1, firepower: 0 } }))).toContain('Air cannot start higher than 3 in this world.');
    expect(texts(aren(), { ...RULES, powers: 'off' })).toContain('This world has no powers: paths stay at 0.');
    expect(texts(aren({ skills: ['Manipulation', 'Manipulation'] }))).toContain('Manipulation is listed twice.');
    expect(texts(aren({ advantages: ['Quick Reflexes', 'Flight'] }))).toContain('“Flight” is not an advantage the game knows.');
    expect(texts(aren({ advantages: ['Quick Reflexes', 'Patron'] }))).toContain('Patron needs to say more: which organisation.');
    expect(texts(aren({ advantages: ['Quick Reflexes', 'Quick Reflexes'] }))).toContain('Quick Reflexes is listed twice.');
    expect(texts(aren({ disadvantages: ['Hunted: the baron’s agents', 'Quick Reflexes'] }))).toContain('“Quick Reflexes” is not a drawback the game knows.');
    expect(texts(aren({ advantages: ['Wealth'], disadvantages: [...aren().disadvantages.slice(0, 3), 'Poor'] }))).toContain('Wealth and Poor cannot both be true.');
    expect(texts(aren({ advantages: ['Tough'], disadvantages: [...aren().disadvantages.slice(0, 3), 'Frail'] }))).toContain('Tough and Frail cannot both be true.');
    expect(texts(aren({ ancestry: 'elf' }))).toContain('Choose an ancestry of this world.');
  });

  it('the same kind of trait can be held twice when it is about different things', () => {
    const two = aren({ advantages: ['Ally: Sela of the Old Mill', 'Ally: Guildmaster Hask'], attributes: { strength: 1, skill: 3, resistance: 2, armor: 1, firepower: 0 } });
    expect(check(two, RULES).problems).toEqual([]);
    expect(texts(aren({ advantages: ['Ally: Sela', 'Ally: sela'] }))).toContain('Ally is listed twice.');
  });

  it('abilities at the start: one for each level in a path, within reach, and common knowledge', () => {
    expect(check(aren({ abilities: ['featherstep'] }), RULES).ok).toBe(true); // fewer is fine
    expect(texts(aren({ abilities: ['featherstep', 'glimmer', 'whisper'] }))).toContain('You can start with 2 abilities, one for each level in a path; 3 are chosen.');
    expect(texts(aren({ abilities: ['featherstep', 'gale_push'] }))).toContain('Gale Push needs Air 2; you have Air 1.');
    expect(texts(aren({ abilities: ['featherstep', 'spark'] }))).toContain('Spark needs Fire 1; you have Fire 0.');
    const strong = aren({ paths: { air: 3 }, abilities: ['long_step'], attributes: { strength: 1, skill: 2, resistance: 2, armor: 1, firepower: 0 } });
    expect(texts(strong)).toContain('Long Step is not common knowledge: it has to be found in the story.');
    expect(texts(aren({ abilities: ['featherstep', 'no_such'] }))).toContain('“no_such” is not an ability the game knows.');
    expect(texts(aren({ paths: {}, abilities: ['featherstep'] }))).toContain('A character with no levels in a path starts with no abilities.');
  });

  it('an ancestry is a package: it costs what its traits cost, and brings them', () => {
    expect(ancestryCost(PLAIN_ANCESTRY)).toBe(0);
    expect(ancestryCost(MARSH)).toBe(1);
    expect(ancestryCost({ ...MARSH, disadvantages: ['Outsider: the marsh'] })).toBe(0);
    expect(ancestryCost({ ...MARSH, advantages: [], disadvantages: ['Outsider: the marsh'] })).toBe(0); // never pays you to choose it
    const marsh = aren({ ancestry: 'marsh', advantages: ['Quick Reflexes'] }); // Patron given up to pay for it
    const c = check(marsh, RULES);
    expect(c.parts).toMatchObject({ advantages: 1, ancestry: 1 });
    expect(c.ok).toBe(true);
    expect(sheetOf(marsh, RULES).advantages).toEqual(['Keen Senses', 'Quick Reflexes']);
    // What the ancestry brings cannot be bought again.
    expect(texts(aren({ ancestry: 'marsh', advantages: ['Keen Senses'] }))).toContain('Keen Senses already comes with being Marsh-born.');
    // A world's ancestries must be made of traits the game knows, and stay modest.
    expect(checkAncestry(MARSH)).toEqual([]);
    expect(checkAncestry({ ...MARSH, advantages: ['Wings'] })).toEqual(['Marsh-born: "Wings" is not an advantage the game knows']);
    expect(checkAncestry({ ...MARSH, advantages: ['Wealth', 'Rank: lord'] })[0]).toMatch(/costs at most 3 points/);
  });
});

describe('repairing a character someone else proposed', () => {
  it('leaves a legal character alone', () => {
    const { draft, changes } = repair(aren(), RULES);
    expect(changes).toEqual([]);
    expect(draft).toEqual(aren());
  });

  it('drops what the game does not know and brings numbers into range, saying what it changed', () => {
    const messy = aren({
      attributes: { strength: 9, skill: 3, resistance: -2, armor: 1.4 as number, firepower: Number.NaN },
      paths: { air: 5, dark: 1 },
      skills: ['Manipulation', 'Swordplay' as never, 'Manipulation'],
      advantages: ['Quick Reflexes', 'Flight', 'Patron', 'Tough'],
      disadvantages: ['Curious', 'Frail', 'Doomed'],
      abilities: ['featherstep', 'stormcall', 'dread', 'nonsense'],
      ancestry: 'dragon',
    });
    const { draft, changes } = repair(messy, RULES);
    const c = check(draft, RULES);
    expect(c.problems).toEqual([]);
    expect(draft.ancestry).toBe('plain');
    expect(draft.attributes.strength).toBeLessThanOrEqual(5);
    expect(draft.attributes.resistance).toBe(0);
    expect(draft.attributes.firepower).toBe(0);
    expect(draft.paths.air ?? 0).toBeLessThanOrEqual(3);
    expect(draft.skills).not.toContain('Swordplay');
    expect(draft.advantages).not.toContain('Flight');
    expect(draft.advantages).not.toContain('Patron'); // it did not say which
    expect(draft.advantages.includes('Tough') && draft.disadvantages.includes('Frail')).toBe(false);
    expect(draft.disadvantages).not.toContain('Doomed');
    expect(draft.abilities).not.toContain('stormcall');
    expect(draft.abilities).not.toContain('nonsense');
    expect(changes.join(' ')).toMatch(/“Flight” was dropped/);
    expect(changes.join(' ')).toMatch(/fit the points/);
  });

  it('whatever it is handed, what comes out is allowed', () => {
    let seed = 99;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const pick = <T,>(list: readonly T[]) => list[rnd(list.length)]!;
    const names = TRAIT_LIST.map((t) => (t.detail && rnd(4) > 0 ? `${t.name}: something` : t.name));
    for (let i = 0; i < 300; i++) {
      const rules: CreationRules = { level: pick(['novice', 'seasoned', 'champion', 'legend'] as const), powers: pick(['off', 'focus'] as const), pathCap: 1 + rnd(4), ancestries: rnd(3) ? RULES.ancestries : [] };
      const draft: CharacterDraft = {
        name: 'X', line: '', ancestry: pick(['plain', 'marsh', 'other']),
        attributes: Object.fromEntries(ATTRIBUTES.map((k) => [k, rnd(8) - 1])) as CharacterDraft['attributes'],
        paths: Object.fromEntries(PATHS.filter(() => rnd(2)).map((k) => [k, rnd(6)])),
        skills: Array.from({ length: rnd(5) }, () => pick(SKILLS)),
        advantages: Array.from({ length: rnd(6) }, () => pick([...names, 'Made Up'])),
        disadvantages: Array.from({ length: rnd(7) }, () => pick([...names, 'Made Up'])),
        abilities: Array.from({ length: rnd(5) }, () => pick([...Object.keys(ABILITIES), 'made_up'])),
      };
      const fixed = repair(draft, rules).draft;
      expect(check(fixed, rules).problems, JSON.stringify({ rules: { ...rules, ancestries: rules.ancestries.length }, draft })).toEqual([]);
      // Repairing twice changes nothing more.
      expect(repair(fixed, rules).changes).toEqual([]);
    }
  });
});
