// The game speaks to the player in the story's language, and to the models in English.
import '../src/i18n/pt';
import { describe, expect, it } from 'vitest';
import { tl } from '../src/i18n';
import { newStory, sceneTitle } from '../src/game/story';
import type { Note, Story } from '../src/game/types';
import { glassRoadSeed } from '../src/packs/lanternCoast';
import { harness } from './helpers';

const ends = (story: string, ...facts: string[]) => `${story}\n===\n${facts.join('\n')}`;
const notesOf = (story: Story): Note[] => story.scenes.flatMap((sc) => sc.turns).flatMap((t) => t.beats).flatMap((b) => (b.type === 'notes' ? b.notes : []));
const company = (story: Story): string[] => notesOf(story).flatMap((n) => (n.kind === 'company' ? [n.text] : []));
const story = (language: 'en' | 'pt'): Story => {
  const s = newStory(glassRoadSeed(), 0);
  s.settings.language = language;
  return s;
};

/** The same few turns in a story of either language: a companion stays behind, a stranger refuses, the companion comes back, and the party is full. */
async function companyTurns(language: 'en' | 'pt') {
  const h = harness({ story: story(language) });
  const s = h.session;
  const engine: string[] = [];
  await s.submit('Tobin, stay here and keep out of sight.');
  engine.push(s.lastTurn!.engineNote);
  await s.submit('Captain Roth, come with me to the waystation.');
  engine.push(s.lastTurn!.engineNote);
  await s.submit('Tobin, come along now.');
  const turns = s.scene.turns.length;
  s.story.world.people.roth!.bond = 60;
  await s.submit('Captain Roth, come with me.');
  return { s, engine, notes: company(s.story), notice: s.notice, spent: s.scene.turns.length - turns };
}

describe('a story in Portuguese', () => {
  it('has its notes and notices in Portuguese, and tells the narrator in English', async () => {
    const pt = await companyTurns('pt');
    expect(pt.notes[0]).toBe('Tobin deixa o seu grupo e fica em Lantern Market');
    expect(pt.notes[2]).toBe('Tobin entra para o seu grupo');
    // The stages of a bond are words of the rules: in the story's language too.
    expect(pt.notes[1]).toBe(`Captain Roth viajaria com alguém com vínculo ${tl('pt', 'Trusted')}. O vínculo de vocês está em ${tl('pt', 'No bond yet')}.`);
    expect(pt.notes[1]).not.toContain('Trusted');
    expect(pt.notice).toBe('O seu grupo está cheio: 2 companheiros nesta mesa. Alguém teria que ficar para trás antes.');
    expect(pt.spent).toBe(0);
    // What the narrator was told is English, word for word as in an English story.
    expect(pt.engine[0]).toContain('company: at Aren');
    expect(pt.engine[0]).toContain('Tobin no longer travels with them and stays here for now');
    expect(pt.engine[1]).toContain('Captain Roth will not, yet: they would travel with someone they know as Trusted, and Aren is at No bond yet.');
    expect(pt.s.lastTurn!.engineNote.startsWith('ENGINE\n')).toBe(true);
  });

  it('keeps the same turns in English for an English story, as before', async () => {
    const en = await companyTurns('en');
    expect(en.notes).toEqual([
      'Tobin leaves your party and stays at Lantern Market',
      'Captain Roth would travel with someone they know as Trusted. You are at No bond yet.',
      'Tobin joins your party',
    ]);
    expect(en.notice).toBe('Your party is full: 2 companions at this table. Someone would have to stay behind first.');
    // The narrator is told the same in both.
    const pt = await companyTurns('pt');
    expect(pt.engine).toEqual(en.engine);
  });

  it('writes the memories and summaries the game makes in Portuguese, and the journey chosen on the map is the player’s line in Portuguese', async () => {
    const h = harness({ story: story('pt') });
    const s = h.session;
    s.story.world.people.mira!.bond = 28;
    h.narrator.push(ends('She does not answer.', 'bond: mira | betrayal | - | You sold her bow while she slept.'));
    await s.submit('I sell the bow.');
    expect(company(s.story).at(-1)).toBe('Mira guarda mágoa disso. Até você reparar, o vínculo cresce pela metade e não pode chegar ao próximo estágio');
    await s.travel('guild_house');
    // The journey: shown as what the player did, and what the narrator reads as the player's line.
    const journey = s.lastTurn!;
    expect(journey.input).toBe('Sigo para Guild House.');
    expect(journey.userText).toBe('Sigo para Guild House.');
    expect(journey.engineNote).toContain('travel: from Lantern Market to Guild House');
    // Mira walks out: a memory, a line of the scene's summary and a note, all in the story's language.
    expect(s.story.events.at(-1)).toMatchObject({ text: 'Mira não quis seguir adiante com você e ficou em Lantern Market.', importance: 3, actors: ['mira'] });
    expect(s.story.scenes.at(-2)!.summary).toContain('Mira deixou a sua companhia.');
    expect(company(s.story).at(-1)).toBe('Mira deixa o seu grupo: You sold her bow while she slept');
    expect(sceneTitle(s.story, s.scene)).toMatch(/^Cena \d+ · Guild House · /);
  });

  it('the same in an English story', async () => {
    const h = harness({ story: story('en') });
    const s = h.session;
    s.story.world.people.mira!.bond = 28;
    h.narrator.push(ends('She does not answer.', 'bond: mira | betrayal | - | You sold her bow while she slept.'));
    await s.submit('I sell the bow.');
    await s.travel('guild_house');
    expect(s.lastTurn!.input).toBe('I head for Guild House.');
    expect(s.story.events.at(-1)).toMatchObject({ text: 'Mira would go no further with you, and stayed at Lantern Market.' });
    expect(s.story.scenes.at(-2)!.summary).toContain('Mira left your company.');
    expect(company(s.story).at(-1)).toBe('Mira leaves your party: You sold her bow while she slept');
    expect(sceneTitle(s.story, s.scene)).toMatch(/^Scene \d+ · Guild House · /);
  });
});

describe('the models that write for the player are told the story’s language', () => {
  const said = (req: { params: { messages: { content: unknown }[] } }): string => JSON.stringify(req.params.messages);

  it('the referee and the scribe of a Portuguese story are asked for Portuguese, and those of an English story are asked nothing', async () => {
    for (const language of ['pt', 'en'] as const) {
      const h = harness({ story: story(language) });
      await h.session.submit('I look around the market.');
      await h.session.travel('guild_house');
      const referee = said(h.requests.find((r) => r.role === 'referee')!);
      const scribe = said(h.requests.find((r) => r.role === 'scribe')!);
      expect(referee.includes('LANGUAGE The player reads Brazilian Portuguese')).toBe(language === 'pt');
      expect(scribe.includes('LANGUAGE The story is told in Brazilian Portuguese')).toBe(language === 'pt');
    }
  });
});
