// What every world must satisfy, built or hand-made.
import { describe, expect, it } from 'vitest';
import { checkWorld, countsOf, creationRules, fightStats, neighbours, wayBetween } from '../src/game/world';
import type { World } from '../src/game/types';
import { lanternCoast } from '../src/packs/lanternCoast';
import { harness } from './helpers';

const copy = (): World => structuredClone(lanternCoast);

describe('checking a world', () => {
  it('the hand-made sample world passes', () => {
    expect(checkWorld(lanternCoast)).toEqual([]);
    expect(countsOf(lanternCoast)).toMatchObject({ regions: 6 });
    expect(countsOf(lanternCoast).people).toBeGreaterThan(6);
  });

  it('says what a character of the world may be', () => {
    expect(creationRules(lanternCoast)).toMatchObject({ level: 'champion', powers: 'focus', pathCap: 3 });
    expect(creationRules(lanternCoast).ancestries[0]!.advantages).toEqual([]);
  });

  it('finds a route to nowhere, a place inside nothing, and a person who is nowhere', () => {
    const w = copy();
    w.routes.push({ a: 'lantern_market', b: 'atlantis', minutes: 10 });
    w.places.old_mill!.parent = 'the_moon';
    w.people.roth!.placeId = 'limbo';
    const found = checkWorld(w).join('\n');
    expect(found).toMatch(/a route joins "lantern_market" and "atlantis"/);
    expect(found).toMatch(/"old_mill" is inside "the_moon", which does not exist/);
    expect(found).toMatch(/Captain Roth is at "limbo", which does not exist/);
  });

  it('finds a start that cannot be left, and a known place that can never be reached', () => {
    const cut = copy();
    cut.routes = [];
    expect(checkWorld(cut).join('\n')).toMatch(/the starting place has no way out/);
    const island = copy();
    island.places.far_isle = { id: 'far_isle', name: 'Far Isle', kind: 'site', parent: 'lantern_coast', brief: 'An island', card: 'An island nobody can sail to.', x: 5, y: 5, known: 'heard' };
    expect(checkWorld(island)).toEqual(['"Far Isle" is known to the player but cannot be reached from the start']);
    // Hidden, it is nobody's problem yet.
    island.places.far_isle.known = 'hidden';
    expect(checkWorld(island)).toEqual([]);
  });

  it('finds two roots, a place inside itself, a doubled route and ids that are not well formed', () => {
    const w = copy();
    w.places.other_world = { id: 'other_world', name: 'Elsewhere', kind: 'world', parent: null, brief: 'x', card: 'x', x: 1, y: 1, known: 'hidden' };
    w.places.guild_house!.parent = 'common_room';
    w.routes.push({ a: 'guild_house', b: 'lantern_market', minutes: 15 });
    w.places['Bad Id'] = { id: 'Bad Id', name: 'Bad', kind: 'site', parent: 'port_varn', brief: 'x', card: 'x', x: 1, y: 1, known: 'hidden' };
    const found = checkWorld(w).join('\n');
    expect(found).toMatch(/exactly one outermost place; it has 2/);
    expect(found).toMatch(/is inside itself/);
    expect(found).toMatch(/two routes between/);
    expect(found).toMatch(/the place id "Bad Id" is not well formed/);
  });

  it('finds rules the engine does not know and an ancestry made of unknown traits', () => {
    const w = copy();
    w.rules.pathCap = 9;
    w.ancestries = [{ id: 'plain', name: 'Human', text: '', advantages: [], disadvantages: [] }, { id: 'sky', name: 'Skyborn', text: 'They fly.', advantages: ['Wings'], disadvantages: [] }];
    const found = checkWorld(w).join('\n');
    expect(found).toMatch(/limit on paths must be from 0 to 5/);
    expect(found).toMatch(/Skyborn: "Wings" is not an advantage the game knows/);
  });
});

describe('where one can go from a place', () => {
  const to = (w: World, id: string) => Object.fromEntries(neighbours(w, id).map((n) => [n.id, n.minutes]));

  it('a route that starts at the place itself', () => {
    expect(to(lanternCoast, 'lantern_market')).toMatchObject({ canal_bridge: 10, guild_house: 15, north_gate: 25, old_mill: 25 });
  });

  it('a road out of a town can be taken from anywhere inside the town', () => {
    // The roads to the salt flats, the Glass Road and Tessaly start at Port Varn; the market is in Port Varn.
    expect(to(lanternCoast, 'lantern_market')).toMatchObject({ salt_flats: 60 * 24, glass_road: 40, tessaly: 60 * 24 * 2 });
    // And from a room inside a building inside the town.
    expect(to(lanternCoast, 'hask_office')).toMatchObject({ salt_flats: 60 * 24, common_room: 1 });
    // But not Brinehold: that is beyond the flats.
    expect(to(lanternCoast, 'lantern_market').brinehold).toBeUndefined();
    expect(wayBetween(lanternCoast, 'lantern_market', 'brinehold')).toBeNull();
    expect(wayBetween(lanternCoast, 'salt_flats', 'brinehold')).toEqual({ minutes: 60 * 24 * 3 });
  });

  it('a street between two parts of a town is not a way for a place that is in neither', () => {
    // Guild House to the harbour is a street inside Port Varn: it does not take you there from the market.
    expect(to(lanternCoast, 'lantern_market').harbour).toBeUndefined();
    expect(to(lanternCoast, 'common_room').harbour).toBe(15); // the common room is in the Guild House, where that street starts
  });

  it('from a place as a whole one can step into what it holds, and never into what holds it', () => {
    const fromTown = to(lanternCoast, 'port_varn');
    expect(fromTown.lantern_market).toBe(10);
    expect(fromTown.salt_flats).toBe(60 * 24);
    expect(fromTown.lantern_coast).toBeUndefined();
    expect(to(lanternCoast, 'lantern_market').port_varn).toBeUndefined();
    expect(to(lanternCoast, 'nowhere_at_all')).toEqual({});
  });

  it('arriving somewhere makes the places one journey away heard of', async () => {
    const h = harness();
    const s = h.session;
    expect(s.story.world.places.beyond!.known).toBe('hidden');
    // Nobody holds the bridge in this telling, so the journeys are plain ones.
    for (const id of ['wardens', 'knifeman', 'cudgel', 'kessa']) s.story.world.people[id]!.placeId = 'nowhere';
    await s.travel('canal_bridge');
    await s.travel('waystation');
    expect(s.scene.placeId).toBe('waystation');
    expect(s.story.world.places.beyond!.known).toBe('heard');
    expect(s.story.world.places.greywater!.known).toBe('hidden'); // no road leads there from anywhere known
  });
});

describe('fight numbers from words', () => {
  it('rise with the word, and someone who fights at range has their strength in their aim', () => {
    expect(fightStats('no').fights).toBe(false);
    const levels = ['weak', 'able', 'dangerous'] as const;
    const power = levels.map((l) => { const f = fightStats(l); return f.strength + f.skill + f.armor + f.hp / 5; });
    expect(power[0]!).toBeLessThan(power[1]!);
    expect(power[1]!).toBeLessThan(power[2]!);
    expect(fightStats('able', true)).toMatchObject({ ranged: true, firepower: 2, fights: true });
    expect(fightStats('able', true).strength).toBeLessThan(fightStats('able').strength);
  });
});
