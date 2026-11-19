// Filling in a sketched place the first time a story goes there.
import { describe, expect, it } from 'vitest';
import { Unusable } from '../src/game/builder';
import { applyExpansion, cleanExpansion } from '../src/game/expand';
import { estimateExpand, expandRequest, type ExpandOut } from '../src/game/llm/architect';
import { mockArchitect } from '../src/game/llm/mockArchitect';
import { LlmError, type LlmRequest } from '../src/game/llm/transport';
import { findMentions } from '../src/game/search';
import type { Story, World } from '../src/game/types';
import { checkWorld, neighbours } from '../src/game/world';
import { lanternCoast } from '../src/packs/lanternCoast';
import { BALANCED, builtHarness, demoTemplate, harness } from './helpers';

const text = (req: LlmRequest): string => req.params.messages.map((m) => (typeof m.content === 'string' ? m.content : m.content.map((b) => (b.type === 'text' ? b.text : '')).join(''))).join('\n');
const asked = (h: { requests: LlmRequest[] }) => h.requests.filter((r) => r.role === 'architect');
const notesOf = (story: Story): string[] => story.scenes.flatMap((sc) => sc.turns).flatMap((t) => t.beats).flatMap((b) => (b.type === 'notes' ? b.notes : [])).flatMap((n) => (n.kind === 'info' ? [n.text] : []));

/** What the demo builder would write for a place of this world. */
function answerFor(world: World, id: string): ExpandOut {
  const p = world.places[id]!;
  return mockArchitect({ step: 'expand', input: { source: { kind: 'description', text: '' }, premise: '', name: '', table: { style: 'adventure', powers: 'focus', companions: 0, romance: false, violence: 'moderate', leaveOut: '', language: 'en', narration: 'medium' } }, done: {}, place: { id, name: p.name, kind: p.kind, taken: [...Object.keys(world.places), ...Object.keys(world.people)] } }) as ExpandOut;
}

describe('what is a sketch', () => {
  it('every place on a built map but the starting one; the hand-made world has none', async () => {
    const t = await demoTemplate();
    const sketches = Object.values(t.world.places).filter((p) => p.sketch).map((p) => p.id).sort();
    expect(sketches).toEqual(['blackwood', 'far_market', 'garrow_keep', 'high_pits', 'kings_cut', 'mirefen', 'saints_rest', 'stonewater']);
    expect(t.world.places.ashford!.sketch).toBeUndefined();
    expect(Object.values(lanternCoast.places).some((p) => p.sketch)).toBe(false);
    expect(checkWorld(t.world)).toEqual([]);
  });
});

describe('arriving at a sketched place', () => {
  it('fills it in before the scene there opens, once', async () => {
    const h = await builtHarness();
    const s = h.session;
    await s.begin();
    const before = Object.keys(s.story.world.places).length;
    await s.travel('stonewater');
    expect(s.blocker).toBeNull();
    expect(s.scene.placeId).toBe('stonewater');
    // The journey turn asked the referee, wrote up the scene that was left, filled the place in, and told the arrival.
    expect(h.requests.slice(1).map((r) => r.role)).toEqual(['referee', 'scribe', 'architect', 'narrator']);
    const w = s.story.world;
    const town = w.places.stonewater!;
    expect(town.sketch).toBeUndefined();
    expect(town.card).toContain('Stonewater as a traveller first sees it');
    expect(Object.keys(w.places).length).toBe(before + 5);
    expect(checkWorld(w)).toEqual([]);
    // What lies inside is shown by arriving: the parts of the town are heard of, the room inside the inn is not yet.
    expect(w.places.stonewater_square).toMatchObject({ parent: 'stonewater', known: 'heard', kind: 'district' });
    expect(w.places.stonewater_inn).toMatchObject({ parent: 'stonewater', known: 'heard' });
    expect(w.places.stonewater_back_room).toMatchObject({ parent: 'stonewater_inn', known: 'hidden' });
    // The scene's packet was built after the filling in: the new card, the ways into the town, and who is met on arrival.
    const packet = s.scene.packet;
    expect(packet).toContain('PLACE [stonewater] Stonewater');
    expect(packet).toContain('Stonewater as a traveller first sees it');
    expect(packet).toMatch(/WAYS OUT .*\[stonewater_square\] Stonewater Square 10 min/);
    expect(s.scene.cast).toContain('stonewater_keeper');
    expect(w.people.stonewater_keeper).toMatchObject({ met: true, placeId: 'stonewater' });
    expect(w.people.stonewater_keeper!.unknown).toBeUndefined();
    // Everyone else there is somebody the protagonist has never heard of.
    expect(w.people.stonewater_host).toMatchObject({ met: false, unknown: true, placeId: 'stonewater_inn', tier: 'major' });
    expect(w.people.stonewater_host!.secret).toBeTruthy();
    expect(w.people.stonewater_locals).toMatchObject({ count: 6, tier: 'extra' });
    expect(w.seeds!.some((x) => x.id === 'stonewater_left_behind' && x.placeId === 'stonewater_inn')).toBe(true);
    // The turn says what happened and what it cost.
    const turn = s.lastTurn!;
    expect(turn.usage.map((u) => u.role)).toEqual(['referee', 'scribe', 'architect', 'narrator']);
    expect(turn.cost).toBeCloseTo(turn.usage.reduce((sum, u) => sum + u.cost, 0), 10);
    expect(notesOf(s.story).join(' ')).toContain('Stonewater is now part of the world: 5 places and 4 people were written for it.');
    // Leaving and coming back asks for nothing.
    await s.travel('ashford');
    await s.travel('stonewater');
    expect(s.scene.placeId).toBe('stonewater');
    expect(asked(h)).toHaveLength(1);
  });

  it('tells the builder where the place lies, what is moving there, who is arriving and which names are taken', async () => {
    const h = await builtHarness();
    await h.session.begin();
    await h.session.submit('I ask Bram about the mill at Stonewater.');
    h.session.story.events.push({ id: 'e-test', sceneId: 's1', clock: { day: 1, minute: 0 }, placeId: 'long_table', text: 'Bram told you the mill at Stonewater burned last spring.', importance: 2, reach: 'local', actors: ['bram'], witnesses: [], told: [] });
    const req = expandRequest(h.session.story, 'stonewater', BALANCED);
    const said = text(req);
    expect(said).toContain('THE WORLD: The Cinder Vale');
    expect(said).toContain('[garrow_keep] Garrow Keep: The baron’s seat');
    expect(said).toContain('THE PLACE TO FILL IN: [stonewater] Stonewater, a settlement. A mill village downriver');
    expect(said).toMatch(/Ways from it: .*Ashford, 5 hours/);
    expect(said).toContain('- The baron’s levy: Baron Garrow means to raise a company of soldiers');
    expect(said).not.toContain('The failing seam'); // not in motion there
    expect(said).toContain('THE PROTAGONIST: Robin,');
    expect(said).toContain('- Bram told you the mill at Stonewater burned last spring.');
    expect(said).toMatch(/Names already used in this world .*Bram Tolliver/);
    expect(said).toContain('Write everything in English');
    expect(req.role).toBe('architect');
    expect(req.params.max_tokens).toBeGreaterThanOrEqual(3000); // room to finish: a cut-off answer is worth nothing
  });

  it('is filled in too when it is the narrator who lets the protagonist go there', async () => {
    const h = await builtHarness();
    const s = h.session;
    await s.begin();
    h.narrator.push('You take the river road before anyone can ask where you are going.\n===\ntime: 5\nmove: blackwood');
    await s.submit('I slip out and take the road west.');
    expect(s.scene.placeId).toBe('blackwood');
    expect(asked(h)).toHaveLength(1);
    expect(s.story.world.places.blackwood!.sketch).toBeUndefined();
    expect(s.story.world.places.blackwood_camp).toMatchObject({ name: 'Blackwood Camp', known: 'heard' });
    expect(s.scene.packet).toContain('Blackwood as a traveller first sees it');
    const turn = s.story.scenes[s.story.scenes.length - 2]!.turns.slice(-1)[0]!;
    expect(turn.usage.some((u) => u.role === 'architect')).toBe(true);
    expect(turn.cost).toBeCloseTo(turn.usage.reduce((sum, u) => sum + u.cost, 0), 10);
    expect(checkWorld(s.story.world)).toEqual([]);
  });

  it('from any part of a filled-in place every other part can be reached without leaving it', async () => {
    const h = await builtHarness();
    await h.session.travel('stonewater');
    const w = h.session.story.world;
    const parts = Object.values(w.places).filter((p) => p.parent === 'stonewater').map((p) => p.id);
    expect(parts).toHaveLength(4);
    for (const from of parts) {
      const got = new Set([from]);
      const queue = [from];
      while (queue.length) for (const n of neighbours(w, queue.pop()!)) if (parts.includes(n.id) && !got.has(n.id)) { got.add(n.id); queue.push(n.id); }
      expect([...got].sort(), `from ${from}`).toEqual([...parts].sort());
      // And the roads out of the town can be taken from there.
      expect(neighbours(w, from).map((n) => n.id)).toContain('ashford');
    }
  });
});

describe('when it cannot be filled in', () => {
  it('a failed request does not stop the journey: the place stays a sketch and the next arrival tries again', async () => {
    const h = await builtHarness();
    const s = h.session;
    h.architectErrors.push(new LlmError('overloaded', 'Anthropic’s service is busy or failed.', 529));
    await s.travel('stonewater');
    expect(s.blocker).toBeNull();
    expect(s.scene.placeId).toBe('stonewater');
    expect(s.story.world.places.stonewater!.sketch).toBe(true);
    expect(s.scene.packet).toContain('PLACE [stonewater] Stonewater (in The Cinder Vale). A mill village downriver');
    expect(notesOf(s.story).join(' ')).toContain('Stonewater is still a sketch: it could not be filled in this time.');
    expect(s.lastTurn!.usage.some((u) => u.role === 'architect')).toBe(false); // nothing came back, nothing was charged
    await s.travel('ashford');
    await s.travel('stonewater');
    expect(s.story.world.places.stonewater!.sketch).toBeUndefined();
    expect(asked(h)).toHaveLength(2);
  });

  it('an answer with too little in it is refused, and what it cost is on the meter', async () => {
    const h = await builtHarness();
    const s = h.session;
    h.architect.push({ card: 'A town.', places: [{ id: 'one', name: 'One', kind: 'site', parent: 'stonewater', brief: 'x', card: 'x', x: 1, y: 1 }], routes: [], people: [], crowds: [], seeds: [] });
    await s.travel('stonewater');
    expect(s.scene.placeId).toBe('stonewater');
    expect(s.story.world.places.stonewater!.sketch).toBe(true);
    expect(s.story.world.places.one).toBeUndefined();
    expect(s.lastTurn!.usage.some((u) => u.role === 'architect')).toBe(true);
    expect(checkWorld(s.story.world)).toEqual([]);
  });

  it('is not asked for once today’s limit is reached, or when the story has it switched off', async () => {
    // The limit is passed by the referee's call, in the middle of the journey turn.
    const tight = await builtHarness({ cap: 1e-9 });
    await tight.session.travel('stonewater');
    expect(tight.session.scene.placeId).toBe('stonewater');
    expect(asked(tight)).toHaveLength(0);
    expect(tight.session.story.world.places.stonewater!.sketch).toBe(true);
    expect(notesOf(tight.session.story).join(' ')).not.toContain('sketch');

    const off = await builtHarness({ settings: { fillPlaces: false } });
    await off.session.travel('stonewater');
    expect(asked(off)).toHaveLength(0);
    expect(off.session.story.world.places.stonewater!.sketch).toBe(true);
    off.session.updateSettings({ fillPlaces: true });
    await off.session.travel('ashford');
    await off.session.travel('stonewater');
    expect(asked(off)).toHaveLength(1);
  });

  it('never touches a world that has no sketches', async () => {
    const h = harness();
    for (const id of ['wardens', 'knifeman', 'cudgel', 'kessa']) h.session.story.world.people[id]!.placeId = 'nowhere';
    await h.session.travel('canal_bridge');
    expect(h.session.scene.placeId).toBe('canal_bridge');
    expect(asked(h)).toHaveLength(0);
  });
});

describe('a filled-in place is part of the world, not something that happened in the story', () => {
  it('rewinding to before the journey keeps it as written, and going there again costs nothing more', async () => {
    const h = await builtHarness();
    const s = h.session;
    await s.begin();
    await s.submit('I look through the ledger.');
    await s.travel('stonewater');
    await s.submit('I look around the town.');
    const written = structuredClone(s.story.world.places.stonewater_inn);
    const point = s.rewindPoints().find((p) => p.sceneId === 's1')!;
    expect(await s.rewindTo(point.keep)).toBe(true);
    expect(s.scene.placeId).toBe('long_table');
    const w = s.story.world;
    // The town is still written; what the protagonist knows of it is as it was before they went.
    expect(w.places.stonewater!.sketch).toBeUndefined();
    expect(w.places.stonewater!.known).toBe('heard');
    expect(w.places.stonewater_inn).toEqual({ ...written, known: 'hidden' });
    expect(w.people.stonewater_keeper).toMatchObject({ met: false, unknown: true });
    expect(w.seeds!.some((x) => x.id === 'stonewater_left_behind')).toBe(true);
    expect(checkWorld(w)).toEqual([]);
    await s.travel('stonewater');
    expect(s.scene.placeId).toBe('stonewater');
    expect(asked(h)).toHaveLength(1);
    expect(s.story.world.places.stonewater_inn).toEqual(written);
    expect(s.story.world.people.stonewater_keeper).toMatchObject({ met: true });
  });

  it('a journey turn that is given up keeps what was written, so it is not paid for twice', async () => {
    const h = await builtHarness();
    const s = h.session;
    h.narratorErrors.push(new LlmError('offline', 'The request did not reach Anthropic.'));
    await s.travel('stonewater');
    expect(s.blocker).toMatchObject({ kind: 'offline' });
    s.dismiss(); // the story goes back to before the journey
    expect(s.scene.placeId).toBe('long_table');
    expect(s.story.totals.turns).toBe(0);
    expect(s.story.world.places.stonewater!.sketch).toBeUndefined();
    expect(s.story.world.places.stonewater_square!.known).toBe('hidden');
    await s.travel('stonewater');
    expect(s.scene.placeId).toBe('stonewater');
    expect(asked(h)).toHaveLength(1);
  });

  it('situations settled earlier, and situations a place brought later, both survive going back', async () => {
    const h = await builtHarness();
    const s = h.session;
    await s.begin();
    h.narrator.push('Aldous closes the ledger and thanks you.\n===\ntime: 20\nsettled: the_ledger');
    await s.submit('I let Brother Aldous copy the ledger under my eye.');
    expect(s.story.world.settled).toEqual(['the_ledger']);
    expect(s.story.world.seeds!.find((x) => x.id === 'the_ledger')!.over).toBeUndefined(); // the situation itself is never changed
    await s.travel('stonewater');
    expect(s.story.world.seeds).toHaveLength(7);
    // Back to before the ledger was settled: it is open again, and Stonewater's situation is still there.
    expect(await s.rewindTo(1)).toBe(true);
    expect(s.story.world.settled ?? []).toEqual([]);
    expect(s.story.world.seeds).toHaveLength(7);
    expect(s.scene.packet).toContain('SITUATION [the_ledger]');
  });

  it('a story saved by the build that marked situations themselves still leaves them out', async () => {
    const h = await builtHarness();
    h.session.story.world.seeds!.find((x) => x.id === 'the_ledger')!.over = true;
    await h.session.travel('market_square');
    await h.session.travel('lodge_hall');
    expect(h.session.story.scenes.every((sc) => !sc.packet.includes('the_ledger') || sc.id === 's1')).toBe(true);
  });
});

describe('people nobody has told the protagonist about', () => {
  it('cannot be asked after by a name typed by chance, until the story has named them', async () => {
    const h = await builtHarness();
    const s = h.session;
    await s.travel('stonewater');
    const host = s.story.world.people.stonewater_host!;
    expect(host.unknown).toBe(true);
    expect(findMentions(s.story, `Where is ${host.name}?`).people).toEqual([]);
    h.narrator.push(`The keeper jerks a thumb up the street. “You want ${host.name}, at the Arms.”\n===\ntime: 5`);
    await s.submit('I ask the keeper where a traveller can sleep.');
    expect(host.unknown).toBeUndefined();
    expect(host.met).toBe(false); // heard of now, not met
    expect(findMentions(s.story, `Where is ${host.name}?`).people.map((p) => p.id)).toEqual(['stonewater_host']);
  });

  it('are met by walking in on them', async () => {
    const h = await builtHarness();
    const s = h.session;
    await s.travel('stonewater');
    await s.travel('stonewater_inn');
    expect(s.scene.placeId).toBe('stonewater_inn');
    expect(s.story.world.people.stonewater_host).toMatchObject({ met: true });
    expect(s.story.world.people.stonewater_host!.unknown).toBeUndefined();
    expect(s.scene.packet).toContain('SITUATION [stonewater_left_behind] What was left behind');
    // From the inn the room behind it is one step away.
    expect(s.story.world.places.stonewater_back_room!.known).toBe('heard');
  });
});

describe('whatever comes back for a place, the world stays sound', () => {
  it('ids that clash with the world, parents that do not exist, and people placed nowhere', async () => {
    const t = await demoTemplate();
    const w = structuredClone(t.world);
    const raw = answerFor(w, 'stonewater');
    raw.places[0]!.id = 'ashford'; // an id the map already uses
    raw.places[1]!.id = 'bram'; // an id a person already uses
    raw.places[2]!.parent = 'the_moon';
    raw.places[3]!.parent = raw.places[3]!.id; // inside itself
    raw.places[4]!.parent = 'ashford'; // inside a place that is not being filled in
    raw.routes = [{ a: 'ashford', b: 'stonewater_gate', minutes: 5, note: null }, { a: 'stonewater_gate', b: 'atlantis', minutes: 5, note: null }];
    raw.people[0]!.id = 'sable';
    raw.people[1]!.place = 'limbo';
    raw.people[2]!.place = 'market_square'; // a real place, but not here
    raw.seeds[0]!.id = 'the_ledger';
    raw.seeds[0]!.place = 'nowhere';
    const x = cleanExpansion(raw, w, 'stonewater');
    applyExpansion(w, x);
    expect(checkWorld(w)).toEqual([]);
    expect(w.places.ashford!.name).toBe('Ashford');
    expect(w.people.bram!.name).toBe('Bram Tolliver');
    expect(w.people.sable!.name).toBe('Mistress Sable Hale');
    expect(x.places.every((p) => p.parent === 'stonewater' || x.places.some((q) => q.id === p.parent))).toBe(true);
    expect(x.people.every((p) => p.placeId === 'stonewater' || x.places.some((q) => q.id === p.placeId))).toBe(true);
    expect(w.seeds!.filter((s) => s.id === 'the_ledger')).toHaveLength(1);
    expect(x.seeds[0]).toMatchObject({ id: 'the_ledger_2', placeId: 'stonewater' });
    // With no usable ways given, the parts of the town were joined to one another.
    const parts = x.places.filter((p) => p.parent === 'stonewater').map((p) => p.id);
    const got = new Set([parts[0]!]);
    const queue = [parts[0]!];
    while (queue.length) for (const n of neighbours(w, queue.pop()!)) if (parts.includes(n.id) && !got.has(n.id)) { got.add(n.id); queue.push(n.id); }
    expect(got.size).toBe(parts.length);
  });

  it('a town holds districts, not towns; a region may hold a village', async () => {
    const t = await demoTemplate();
    const town = answerFor(t.world, 'stonewater');
    town.places[0]!.kind = 'settlement';
    expect(cleanExpansion(town, t.world, 'stonewater').places[0]!.kind).toBe('site');
    const wild = answerFor(t.world, 'blackwood');
    wild.places[0]!.kind = 'settlement';
    expect(cleanExpansion(wild, t.world, 'blackwood').places[0]!.kind).toBe('settlement');
  });

  it('adding the same thing twice, or to a place already written, changes nothing', async () => {
    const t = await demoTemplate();
    const w = structuredClone(t.world);
    const x = cleanExpansion(answerFor(w, 'stonewater'), w, 'stonewater');
    applyExpansion(w, x);
    const once = structuredClone(w);
    applyExpansion(w, x);
    expect(w).toEqual(once);
    expect(() => cleanExpansion({ card: '', places: [], routes: [], people: [], crowds: [], seeds: [] }, w, 'blackwood')).toThrow(Unusable);
    expect(() => cleanExpansion(null as never, w, 'blackwood')).toThrow(Unusable);
  });

  it('holds for three hundred answers damaged at random', async () => {
    const t = await demoTemplate();
    let state = 20261117;
    const rnd = () => { state = (Math.imul(state ^ (state >>> 15), 2246822507) + 0x9e3779b9) | 0; return ((state >>> 0) % 100000) / 100000; };
    const pick = <T,>(list: T[]): T => list[Math.floor(rnd() * list.length)]!;
    const JUNK: (() => unknown)[] = [
      () => null, () => undefined, () => '', () => 'x'.repeat(3000), () => -1, () => 1e12, () => Number.NaN, () => [], () => ({}), () => true,
      () => 'ashford', () => 'stonewater', () => 'long_table', () => 'bram', () => '__proto__', () => 'Bram Tolliver', () => [null, 3, 'x'],
    ];
    const damage = (value: unknown, times: number): unknown => {
      for (let n = 0; n < times; n++) {
        let cur: any = value; // eslint-disable-line @typescript-eslint/no-explicit-any
        for (let depth = 0; depth < 5; depth++) {
          if (cur === null || typeof cur !== 'object') break;
          const keys = Array.isArray(cur) ? cur.map((_, i) => i) : Object.keys(cur);
          if (!keys.length) break;
          const k = pick(keys as (string | number)[]);
          const child = cur[k];
          const op = rnd();
          if (child !== null && typeof child === 'object' && op < 0.7) { cur = child; continue; }
          if (Array.isArray(cur) && op < 0.8) { cur.push(structuredClone(pick(cur))); break; }
          if (Array.isArray(cur) && op < 0.85) { cur.splice(Number(k), 1); break; }
          if (!Array.isArray(cur) && op < 0.8) { delete cur[k]; break; }
          cur[k] = pick(JUNK)();
          break;
        }
      }
      return value;
    };
    const sketches = Object.values(t.world.places).filter((p) => p.sketch).map((p) => p.id);
    let refused = 0;
    let filled = 0;
    for (let run = 0; run < 300; run++) {
      const w = structuredClone(t.world);
      // Two or three places are filled in one after another, so that later ones meet the ids of earlier ones.
      for (const id of [pick(sketches), pick(sketches), pick(sketches)]) {
        if (!w.places[id]!.sketch) continue;
        const bad = damage(answerFor(w, id), 1 + Math.floor(rnd() * 7));
        try {
          applyExpansion(w, cleanExpansion(bad as ExpandOut, w, id));
          filled += 1;
        } catch (err) {
          expect(err, `run ${run}`).toBeInstanceOf(Unusable);
          refused += 1;
        }
        // Whether it was added or refused, the world is one a story can be played in. Arriving makes the new places known.
        for (const p of Object.values(w.places)) if (p.parent === id) p.known = 'heard';
        expect(checkWorld(w), `run ${run}, ${id}`).toEqual([]);
        expect(structuredClone(w)).toEqual(w);
      }
    }
    expect(filled).toBeGreaterThan(400);
    expect(refused).toBeGreaterThan(3);
  });
});

describe('what it costs', () => {
  it('is a few turns’ worth, and follows the model', () => {
    const sonnet = estimateExpand(BALANCED);
    const opus = estimateExpand({ ...BALANCED, architect: 'claude-opus-5-5' });
    const haiku = estimateExpand({ ...BALANCED, architect: 'claude-haiku-5-5' });
    expect(haiku).toBeLessThan(sonnet);
    expect(sonnet).toBeLessThan(opus);
    expect(sonnet).toBeGreaterThan(0.005);
    expect(sonnet).toBeLessThan(0.05);
  });

  it('the demo arrival costs about what the estimate says', async () => {
    const h = await builtHarness();
    await h.session.travel('stonewater');
    const cost = h.session.lastTurn!.usage.find((u) => u.role === 'architect')!.cost;
    expect(cost).toBeGreaterThan(estimateExpand(BALANCED) * 0.4);
    expect(cost).toBeLessThan(estimateExpand(BALANCED) * 1.6);
  });
});
