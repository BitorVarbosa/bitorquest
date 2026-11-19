// Advantages, drawbacks and skills in words, and the line that tells the narrator about them.
import { describe, expect, it } from 'vitest';
import { SKILLS, SKILL_INFO, storyTraits, traitInfo } from '../src/engine';
import { BUDGET, protagonistCard } from '../src/game/cards';
import { glassRoadSeed } from '../src/packs/lanternCoast';
import { harness } from './helpers';

describe('advantages and drawbacks', () => {
  it('a trait is described by its kind, with or without particulars after a colon', () => {
    const patron = traitInfo('Patron: Couriers\u2019 Guild', 'advantage');
    expect(patron).toMatchObject({ written: 'Patron: Couriers\u2019 Guild', known: true, how: 'story', effect: null });
    expect(traitInfo('Curious to a fault', 'disadvantage')).toMatchObject({ known: true, how: 'story' });
    expect(traitInfo('  code: never open the letter ', 'disadvantage')).toMatchObject({ written: 'code: never open the letter', known: true });
    // "Codebreaker" is not a Code: a kind matches whole words only.
    expect(traitInfo('Codebreaker', 'advantage').known).toBe(false);
  });

  it('a trait the rules apply says so, with its effect', () => {
    expect(traitInfo('Quick Reflexes', 'advantage')).toMatchObject({ how: 'rules', effect: '+1 to initiative', known: true });
  });

  it('a trait without an entry still gets an honest description', () => {
    const good = traitInfo('Lucky', 'advantage');
    const bad = traitInfo('Bad Reputation: smuggler', 'disadvantage');
    expect(good).toMatchObject({ known: false, how: 'story' });
    expect(bad).toMatchObject({ known: false, how: 'story' });
    expect(good.summary).not.toBe(bad.summary);
    expect(good.text).toMatch(/no fixed rule/);
  });

  it('every trait of the sample character has an entry of its own', () => {
    const sheet = glassRoadSeed().protagonist.sheet;
    for (const t of sheet.advantages) expect(traitInfo(t, 'advantage').known, t).toBe(true);
    for (const t of sheet.disadvantages) expect(traitInfo(t, 'disadvantage').known, t).toBe(true);
  });

  it('every skill says what it covers', () => {
    for (const skill of SKILLS) expect(SKILL_INFO[skill].length, skill).toBeGreaterThan(20);
  });
});

describe('what the narrator is told about the character', () => {
  it('includes the traits that only the narrator can play, and leaves out the ones the rules apply', () => {
    const h = harness();
    const packet = h.session.scene.packet;
    expect(packet).toContain('Advantages Patron: Couriers\u2019 Guild.');
    expect(packet).toContain('Drawbacks Code: the letter always arrives; Dependent: Lise, your sister; Hunted: the baron\u2019s agents; Curious to a fault.');
    expect(packet).not.toContain('Quick Reflexes');
    expect(storyTraits(h.session.story.protagonist.sheet).advantages).toEqual(['Patron: Couriers\u2019 Guild']);
  });

  it('still fits its budget, with everything the character carries', () => {
    const h = harness();
    const card = protagonistCard(h.session.story);
    expect(card.length).toBeLessThanOrEqual(BUDGET.you);
    expect(card).toContain('Tobin\u2019s cracked lens');
    expect(card.endsWith('.')).toBe(true); // not cut short
  });

  it('the narrator is told how to use them without playing the character', async () => {
    const h = harness();
    await h.session.submit('I look around.');
    const narrator = h.requests.find((r) => r.role === 'narrator')!;
    const contract = (narrator.params.system as { text: string }[])[0]!.text;
    expect(contract).toContain('The traits on the YOU line');
    expect(contract).toContain('never a choice you make for the player');
  });
});
