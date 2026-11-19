// Two languages: every text marked for translation has its Portuguese, and the two carry the same slots.
import { describe, expect, it } from 'vitest';
import { ABILITIES, ATTRIBUTES, PATHS, POWER_LEVELS, SCHOOLS, SKILLS, SKILL_INFO, STAGES, TRAIT_LIST, levelName, pathName, stageText, traitInfo, type PowerLevel } from '../src/engine';
import { listOf, m, plain, setLang, t, tl, tln, tn } from '../src/i18n';
import { PARTS } from '../src/i18n/pt';

/** Every source file of the app and the game as text, by its path under src/. Not the dictionaries, and not the two files that define the marks (their comments show examples). */
const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob('../src/**/*.{ts,tsx}', { query: '?raw', eager: true, import: 'default' }) as Record<string, string>)
    .map(([path, code]) => [path.replace('../src/', ''), code] as const)
    .filter(([path]) => !path.startsWith('i18n/pt/') && path !== 'i18n.ts' && path !== 'app/T.tsx'),
);

const LITERAL = String.raw`'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|` + '`((?:[^`\\\\$]|\\\\.)*)`';
const unescape = (s: string): string => s.replace(/\\(u[0-9a-fA-F]{4}|n|.)/g, (_, c: string) => (c === 'n' ? '\n' : c.startsWith('u') ? String.fromCharCode(parseInt(c.slice(1), 16)) : c));
const literalAt = (text: string, from: number): { value: string; end: number } | null => {
  const re = new RegExp(`\\s*(?:${LITERAL})`, 'y');
  re.lastIndex = from;
  const hit = re.exec(text);
  return hit ? { value: unescape(hit[1] ?? hit[2] ?? hit[3] ?? ''), end: re.lastIndex } : null;
};

/** What stands between a call's brackets, given where its opening bracket ends. Texts in quotes are stepped over, so a bracket inside one does not count. */
function callBody(code: string, from: number): string {
  let depth = 1;
  let i = from;
  const quoted = new RegExp(LITERAL, 'y');
  while (i < code.length && depth > 0) {
    const ch = code[i]!;
    if (ch === "'" || ch === '"' || ch === '`') {
      quoted.lastIndex = i;
      const hit = quoted.exec(code);
      if (hit) { i = quoted.lastIndex; continue; }
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    i += 1;
  }
  return code.slice(from, Math.max(from, i - 1));
}

/** The texts a source file marks for translation: t('…'), m('…'), tn(n, '…', '…'), tl(l, '…'), tln(l, n, '…', '…'), <T text="…">. */
export function marked(code: string): string[] {
  const out: string[] = [];
  // t('…') and m('…'): the text comes first.
  for (const hit of code.matchAll(/(?<![\w.$])(?:t|m)\(/g)) {
    const lit = literalAt(code, hit.index + hit[0].length);
    if (lit) out.push(lit.value);
  }
  // tl(language, '…'): the text comes second. tn(n, '…', '…') and tln(l, n, '…', '…'): two texts after the count.
  for (const hit of code.matchAll(/(?<![\w.$])(tl|tn|tln)\(/g)) {
    const want = hit[1] === 'tl' ? 1 : 2;
    const window = callBody(code, hit.index + hit[0].length);
    const found = [...window.matchAll(new RegExp(LITERAL, 'g'))].slice(0, want);
    for (const f of found) out.push(unescape(f[1] ?? f[2] ?? f[3] ?? ''));
  }
  // <T text="…" /> and <T text={'…'} />.
  for (const hit of code.matchAll(/<T\s+text=\{?/g)) {
    const lit = literalAt(code, hit.index + hit[0].length);
    if (lit) out.push(lit.value);
  }
  return out.filter((s) => s.trim().length > 0);
}

const slots = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]!).sort();
const tags = (s: string): string[] => [...s.matchAll(/<\/?(\w+)>/g)].map((x) => x[0]).sort();

const ALL: Record<string, string> = {};
for (const words of Object.values(PARTS)) Object.assign(ALL, words);

describe('the reader of marked texts', () => {
  it('finds each kind of mark, and leaves alone what only looks like one', () => {
    const code = `
      const a = t('Plain text');
      const b = t("With a ’ and a \\"quote\\"", { n });
      const c = tn(count(x, y), 'one page', '{n} pages');
      const d = tl(story.settings.language, 'In the story’s language', { who });
      const e = tln(lang, n, 'one day', '{n} days');
      const f = [{ label: m('Spending') }];
      <T text="Costs <b>{price}</b>" vars={{ price }} />
      <T text={'Curly too'} />
      const skipped = t(dynamic); list.at('no'); split('x'); format('y'); element.t('z');
      const g = tl(l, slotOf(clock)); // "not a text of this call"
      const h = 'nor this';
    `;
    expect(marked(code)).toEqual([
      'Plain text', 'With a ’ and a "quote"', 'Spending',
      'one page', '{n} pages', 'In the story’s language', 'one day', '{n} days',
      'Costs <b>{price}</b>', 'Curly too',
    ]);
  });
});

describe('Portuguese', () => {
  it('every text marked for translation has its Portuguese', () => {
    const missing: string[] = [];
    expect(Object.keys(SOURCES).length).toBeGreaterThan(40);
    for (const [file, code] of Object.entries(SOURCES)) {
      for (const text of new Set(marked(code))) if (!(text in ALL)) missing.push(`${file}: ${text}`);
    }
    expect(missing).toEqual([]);
  });

  it('a translation carries the same slots and the same bold parts as its English', () => {
    const wrong: string[] = [];
    for (const [en, pt] of Object.entries(ALL)) {
      if (slots(en).join() !== slots(pt).join()) wrong.push(`slots differ: ${en}`);
      if (tags(en).join() !== tags(pt).join()) wrong.push(`tags differ: ${en}`);
      if (!pt.trim()) wrong.push(`empty: ${en}`);
      // The same spacing at the ends, so that texts set side by side still join up.
      if (/^\s/.test(en) !== /^\s/.test(pt) || /\s$/.test(en) !== /\s$/.test(pt)) wrong.push(`spaces at the ends differ: ${en}`);
    }
    expect(wrong).toEqual([]);
  });

  it('a text that stands in two files says the same thing in both', () => {
    const seen = new Map<string, { part: string; pt: string }>();
    const clash: string[] = [];
    for (const [part, words] of Object.entries(PARTS)) {
      for (const [en, pt] of Object.entries(words)) {
        const was = seen.get(en);
        if (was && was.pt !== pt) clash.push(`${en} → “${was.pt}” (${was.part}) and “${pt}” (${part})`);
        seen.set(en, { part, pt });
      }
    }
    expect(clash).toEqual([]);
  });

  it('the rules a player reads are in Portuguese too: every ability, skill and stage of a bond', () => {
    const missing: string[] = [];
    for (const a of Object.values(ABILITIES)) { if (!(a.name in ALL)) missing.push(`ability name: ${a.name}`); if (!(a.text in ALL)) missing.push(`ability text: ${a.name}`); }
    for (const s of SKILLS) if (!(s in ALL)) missing.push(`skill: ${s}`);
    for (const s of STAGES) if (!(s in ALL)) missing.push(`stage: ${s}`);
    for (const d of TRAIT_LIST) {
      for (const [what, text] of [['name', d.name], ['summary', d.summary], ['text', d.text], ['effect', d.effect], ['detail', d.detail]] as const) {
        if (text && !(text in ALL)) missing.push(`trait ${what}: ${d.name}`);
      }
    }
    for (const kind of ['advantage', 'disadvantage'] as const) {
      const unknown = traitInfo('A trait nobody wrote', kind);
      for (const text of [unknown.summary, unknown.text]) if (!(text in ALL)) missing.push(`unknown ${kind}: ${text}`);
    }
    for (const s of Object.values(SCHOOLS)) { if (!(s.name in ALL)) missing.push(`school name: ${s.name}`); if (!(s.text in ALL)) missing.push(`school text: ${s.name}`); }
    for (const sk of SKILLS) if (!(SKILL_INFO[sk] in ALL)) missing.push(`skill text: ${sk}`);
    for (const a of ATTRIBUTES) for (const w of [a, a[0]!.toUpperCase() + a.slice(1)]) if (!(w in ALL)) missing.push(`attribute: ${w}`);
    setLang('pt');
    for (const p of PATHS) { if (!(p in ALL)) missing.push(`path: ${p}`); if (pathName(p) === p[0]!.toUpperCase() + p.slice(1)) missing.push(`path name: ${p}`); }
    for (const s of STAGES) if (stageText(s) === s && s !== 'Devoted') missing.push(`stage text: ${s}`);
    setLang('en');
    for (const l of Object.keys(POWER_LEVELS) as PowerLevel[]) if (!(levelName(l) in ALL)) missing.push(`power level: ${l}`);
    for (const w of ['Story', 'Adventure', 'Brutal', 'easy', 'medium', 'hard', 'Unhurt', 'Hurt', 'Badly hurt', 'Down', 'Fled']) if (!(w in ALL)) missing.push(`word: ${w}`);
    // What a fight says when it refuses an action: thrown by the engine as plain errors, and worded for the player from the message.
    for (const w of ['that ability cannot be used in a fight', 'not enough energy', 'that ability needs a target', 'that target cannot be attacked', 'that target cannot lose another action so soon', 'your powers are sealed for now']) {
      if (!(w in ALL)) missing.push(`fight refusal: ${w}`);
    }
    expect(missing).toEqual([]);
  });
});

describe('the functions', () => {
  it('give English back in English, Portuguese in Portuguese, and English for what has no Portuguese yet', () => {
    setLang('en');
    expect(t('Narrator')).toBe('Narrator');
    expect(t('Key accepted. It will use {models}.', { models: 'Haiku 5.5' })).toBe('Key accepted. It will use Haiku 5.5.');
    setLang('pt');
    expect(t('Narrator')).toBe('Narrador');
    expect(t('Key accepted. It will use {models}.', { models: 'Haiku 5.5' })).toBe('Chave aceita. Ela vai usar Haiku 5.5.');
    expect(t('A text nobody has translated {x}', { x: 1 })).toBe('A text nobody has translated 1');
    expect(m('Narrator')).toBe('Narrator');
    // A given language, whatever the interface is in.
    expect(tl('en', 'Narrator')).toBe('Narrator');
    setLang('en');
    expect(tl('pt', 'Narrator')).toBe('Narrador');
    expect(listOf(['A', 'B', 'C'])).toBe('A, B and C');
    expect(listOf(['A', 'B', 'C'], 'pt')).toBe('A, B e C');
    expect(listOf(['A'])).toBe('A');
    // One or many, with the count in its slot; a slot nobody filled is left as it is.
    expect(tn(1, '{n} thing', '{n} things')).toBe('1 thing');
    expect(tn(3, '{n} thing', '{n} things')).toBe('3 things');
    expect(tln('en', 2, 'one day', '{n} days')).toBe('2 days');
    expect(t('Left {alone}')).toBe('Left {alone}');
    // A note in double brackets tells two meanings apart; it is never shown.
    expect(plain('Close ((button))')).toBe('Close');
    expect(plain('Costs (about) $1')).toBe('Costs (about) $1');
    expect(t('Something new ((a note))')).toBe('Something new');
    expect(tl('pt', 'Something new ((a note))')).toBe('Something new');
  });
});
