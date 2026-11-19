// Names belong to the world, not to the language the story is told in. A Portuguese table playing a
// setting the model knows must not get pirates named like farmhands from the Brazilian countryside.
import { describe, expect, it } from 'vitest';
import { BUILD_STEPS, assemble, cleanStep, newDraft, type BuildInput, type WorldDraft } from '../src/game/builder';
import { SkeletonOut, briefOf, characterRequest, expandRequest, languageRule, stepRequest } from '../src/game/llm/architect';
import { mockArchitect } from '../src/game/llm/mockArchitect';
import { narratorContract, worldCore } from '../src/game/llm/prompts';
import type { LlmRequest } from '../src/game/llm/transport';
import { checkWorld } from '../src/game/world';
import { worldFromFile, worldToFile } from '../src/game/worldFile';
import { BALANCED, builtHarness, demoTemplate } from './helpers';

const SETTING: BuildInput = {
  source: { kind: 'setting', text: 'One Piece' },
  premise: 'Uma jovem navegadora que sonha em desenhar o mapa do mundo.',
  name: '',
  table: { style: 'adventure', powers: 'gift', companions: 2, romance: false, violence: 'moderate', leaveOut: '', language: 'pt', narration: 'medium' },
};

const text = (req: LlmRequest): string => req.params.messages.map((m) => (typeof m.content === 'string' ? m.content : m.content.map((b) => (b.type === 'text' ? b.text : '')).join(''))).join('\n');

/** Every step of the demo builder, cleaned as a real build keeps it. */
function buildAll(input: BuildInput): WorldDraft {
  const draft = newDraft('w', input, 0);
  for (const s of BUILD_STEPS) {
    const kept = cleanStep(s.id, mockArchitect({ step: s.id, input, done: draft.steps }) as never, draft.steps, input);
    (draft.steps as Record<string, unknown>)[s.id] = kept.data;
  }
  return draft;
}

describe('names follow the world', () => {
  it('the brief says so in either language, and a known setting keeps the names its readers know', () => {
    const pt = briefOf(SETTING, []);
    expect(pt).toContain('Write everything in Brazilian Portuguese');
    expect(pt).toContain('proper names of people, families and places are not');
    expect(pt).toContain("a name sounds Brazilian only where the world's own people");
    expect(pt).toContain('keeps its own names and terms as its Brazilian readers know them');
    const en = briefOf({ ...SETTING, table: { ...SETTING.table, language: 'en' } }, []);
    expect(en).toContain('Write everything in English');
    expect(en).toContain('a name sounds English only where');
    expect(en).not.toContain('Brazilian');
  });

  it('step 1 settles how people are named before it names anything', () => {
    // Structured answers are written in the order of the schema.
    expect(Object.keys(SkeletonOut.shape)[0]).toBe('names');
    expect(text(stepRequest('skeleton', SETTING, [], {}, BALANCED))).toContain('First say how the people of this world are named');
  });

  it('every later step reads it, and the people step is told to follow it', () => {
    const draft = buildAll(SETTING);
    expect(draft.steps.skeleton!.names).toContain('Hale, Marrow');
    for (const s of ['fronts', 'rules', 'glossary', 'start', 'people', 'seeds'] as const) {
      expect(text(stepRequest(s, SETTING, [], draft.steps, BALANCED))).toContain('Vale folk carry a plain given name');
    }
    expect(text(stepRequest('people', SETTING, [], draft.steps, BALANCED))).toContain('Name each one the way step 1 says the people of their place are named');
  });

  it('the world keeps it; a draft kept by an earlier build has none and is still sound', () => {
    const draft = buildAll(SETTING);
    const world = assemble(draft);
    expect(world.names).toBe(draft.steps.skeleton!.names);
    expect(checkWorld(world)).toEqual([]);
    const old = buildAll(SETTING);
    delete (old.steps.skeleton as { names?: string }).names;
    const before = assemble(old);
    expect(before.names).toBeUndefined();
    expect(checkWorld(before)).toEqual([]);
  });

  it('the narrator is told how names are made, and that even a passer-by is named that way', async () => {
    const { session } = await builtHarness({ settings: { language: 'pt' } });
    const story = session.story;
    expect(story.world.names).toBeTruthy();
    expect(worldCore(story)).toContain(`NAMES ${story.world.names}`);
    expect(narratorContract(story)).toContain('Anyone you do give a name, even in passing, is named the way this world names its people (NAMES, under THE WORLD), never the way the language you write in would');
    // A world without a guide still gets the rule, and its world block is exactly as it was: its cache entry is not lost.
    const old = structuredClone(story);
    delete old.world.names;
    expect(worldCore(old)).toBe(worldCore(story).replace(`\nNAMES ${story.world.names}`, ''));
    expect(narratorContract(old)).toContain('is named the way this world names its people, never the way');
  });

  it('filling in a place names its people the same way', async () => {
    const { session } = await builtHarness({ settings: { language: 'pt' } });
    const said = text(expandRequest(session.story, 'stonewater', BALANCED));
    expect(said).toContain(`HOW PEOPLE ARE NAMED IN THIS WORLD: ${session.story.world.names}`);
    expect(said).toContain('Name the people as HOW PEOPLE ARE NAMED says the people of this place are named');
    expect(said).toContain(languageRule('pt'));
  });

  it('a character the player left unnamed is named that way too', async () => {
    const t = await demoTemplate();
    const unnamed = text(characterRequest(t.world, { premise: 'A clerk of the Lodge.', name: '' }, 'champion', BALANCED));
    expect(unnamed).toContain(`How people are named here: ${t.world.names}`);
    expect(unnamed).toContain('They have no name yet: give them one the way this world names its people');
    expect(text(characterRequest(t.world, { premise: 'A clerk of the Lodge.', name: 'Robin' }, 'champion', BALANCED))).not.toContain('They have no name yet');
  });

  it('goes with the world into a file and back', async () => {
    const t = await demoTemplate();
    expect(worldFromFile(worldToFile(t, 0)).world.names).toBe(t.world.names);
  });
});
