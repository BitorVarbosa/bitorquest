// Two languages: English and Brazilian Portuguese.
//
// The English text is the source and the key. `t('Go to your stories')` gives the same words
// back in English and looks them up in the Portuguese dictionary otherwise; a text with no
// translation yet stays in English, so a missing entry is never a broken screen. A test
// (tests/i18n.test.ts) reads the source for every text marked this way and fails when one has no
// Portuguese, or when the two do not carry the same slots.
//
//   t('Day {n}', { n: 4 })                 the interface language
//   tn(n, 'one page', '{n} pages')         singular or plural, by n
//   m('Spending')                          marks a text kept in a list, to be given to t() where it is shown
//   tl(story.settings.language, '...')     a given language: what the game writes into a story is in the story's language
//   <T text="Costs <b>{price}</b>" />      (app/T.tsx) the same with bold parts and slots that hold elements
//
// One English word can be two Portuguese ones: "Close" is a stage of a bond (Próximo) and a button
// (Fechar). A text may therefore end with a note in double brackets saying which it is,
// `t('Close ((button))')`. The note is part of the key and is never shown: English gets "Close".
//
// What is never translated: names ("Bitor Quest", "Claude", "Penta"), what a world, a story or the
// narrator says, ids, and anything sent to a model.

export type Lang = 'en' | 'pt';
export type Vars = Record<string, string | number>;

let current: Lang = 'en';
const pt = new Map<string, string>();

/** The language the interface is in. */
export const lang = (): Lang => current;
export function setLang(l: Lang): void { current = l === 'pt' ? 'pt' : 'en'; }

/** Add Portuguese for English texts. Called once per dictionary file (src/i18n/pt). */
export function addWords(words: Record<string, string>): void {
  for (const [en, text] of Object.entries(words)) pt.set(en, text);
}
/** Whether the Portuguese dictionary has been loaded. */
export const hasWords = (): boolean => pt.size > 0;

const fill = (text: string, vars?: Vars): string => (vars ? text.replace(/\{(\w+)\}/g, (whole, k: string) => (k in vars ? String(vars[k]) : whole)) : text);

/** A text without the note that tells two meanings of the same words apart: "Close ((button))" is "Close". */
export const plain = (text: string): string => (text.endsWith('))') ? text.replace(/ \(\([^()]*\)\)$/, '') : text);

/** A text in a given language. */
export function tl(l: Lang, text: string, vars?: Vars): string {
  return fill(l === 'pt' ? pt.get(text) ?? plain(text) : plain(text), vars);
}
/** A text in the interface language. */
export function t(text: string, vars?: Vars): string { return tl(current, text, vars); }

/** One or many: "1 page", "3 pages". The count fills {n}. */
export function tn(n: number, one: string, many: string, vars?: Vars): string {
  return tl(current, n === 1 ? one : many, { n: num(n), ...vars });
}
/** The same, in a given language. */
export function tln(l: Lang, n: number, one: string, many: string, vars?: Vars): string {
  return tl(l, n === 1 ? one : many, { n, ...vars });
}

/** Marks a text for translation without translating it: for lists built before the language is known. Give the result to t() where it is shown. */
export const m = <S extends string>(text: S): S => text;

/** The locale for numbers and dates in the interface language. */
export const locale = (): string => (current === 'pt' ? 'pt-BR' : 'en-GB');
/** A whole number with separators: 18,990 or 18.990. */
export const num = (n: number): string => n.toLocaleString(current === 'pt' ? 'pt-BR' : 'en');

/** A list in words: "A, B and C" or "A, B e C". */
export function listOf(names: string[], l: Lang = current): string {
  const and = l === 'pt' ? 'e' : 'and';
  return names.length <= 1 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} ${and} ${names[names.length - 1]}`;
}
