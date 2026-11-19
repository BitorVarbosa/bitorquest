# Two languages

The interface is in English or Brazilian Portuguese. The English text in the source is the original
and the key; `src/i18n/pt/*.ts` holds the Portuguese for it. A text with no Portuguese yet is shown in
English, so nothing breaks while a translation is missing, and `tests/i18n.test.ts` fails until it is
there.

## Marking a text

```tsx
import { m, t, tn, tl, tln, lang, locale, num, listOf } from '../../i18n';   // the path depends on the file
import { T } from '../T';                                                    // src/app/T.tsx

<h1>{t('Where does the world come from?')}</h1>
<button aria-label={t('Hide the key')}>…</button>
<p>{t('Reading part {done} of {total}', { done, total })}</p>
<p>{tn(pages, '{n} page', '{n} pages')}</p>                                  // {n} is filled with the count
<p><T text="Reading it will cost <b>{price}</b>, once, with {model}." vars={{ price, model }} /></p>
<p><T text="It is <link>in the journal</link>." vars={{ link: (inner) => <a href={href('journal')}>{inner}</a> }} /></p>

const SECTIONS = [{ id: 'spending', label: m('Spending') }];                 // a list made before the language is known…
<span>{t(section.label)}</span>                                              // …is translated where it is shown
```

- `t(text, vars?)`: the interface language. The first argument is **one string literal**, exactly the
  English text, with `{name}` slots for anything that varies. No template strings with `${…}`, no
  `'a' + b`, no `cond ? 'x' : 'y'` inside the call: write `cond ? t('x') : t('y')`.
- `tn(n, one, many, vars?)`: singular or plural by `n`. Both texts carry `{n}`.
- `m(text)`: marks a text without translating it. Use it for texts in constants at the top of a file
  (lists of sections, labels, option names), and pass the stored text to `t()` where it is drawn.
  Calling `t()` at the top of a file would fix the language before the player has chosen one.
- `<T text="…" vars={…} />`: a text with bold parts (`<b>…</b>`) or with elements inside it. A slot may
  hold an element; a named tag (`<link>…</link>`) is given to a function in `vars` that wraps its inside.
  Use it instead of cutting a sentence into pieces around a `<b>`: word order differs between languages.
- `tl(language, text, vars?)` and `tln(language, n, one, many)`: a given language. The game layer uses
  these with the story's language (`story.settings.language`) for what it writes into a story: a
  Portuguese story has Portuguese notes whatever the interface is in.
- `lang()` is the interface language (`'en' | 'pt'`); `locale()` is for `toLocaleDateString` and the
  like; `num(n)` writes a whole number with separators; `listOf(names)` writes "A, B and C".
- Engine helpers that word things take a language as their last argument and are English without it:
  `clockLabel(clock, lang())`, `durationLabel(minutes, lang())`.

### The same words with two meanings

"Close" is a stage of a bond (Próximo) and what a button does (Fechar). When an English text needs
two different translations, add a note in double brackets at its end to one of them:
`t('Close ((button))')`. The note is part of the key, so the dictionary has both
`'Close': 'Próximo'` and `'Close ((button))': 'Fechar'`; it is never shown, and English gets "Close".
Texts that come from the engine as data (stage names, skills, abilities) keep the plain key; the
note goes on the other one.

### What is marked

Everything a player reads that the app wrote: text between tags, `aria-label`, `title`, `placeholder`,
`alt`, texts passed to components (`label="…"`, `help="…"`, `title="…"` of `Row`, `Modal`, `Section`
and so on), messages put in state (`setNote(t('World imported.'))`), messages of errors that reach the
screen.

Rules content that comes from the engine as data (the name and text of an ability or a trait, a skill,
a stage of a bond, a power level, a table style) is English in the engine and is translated where it
is drawn: `t(ability.name)`, `t(trait.text)`, `t(stageName(p.bond))`. Its Portuguese is in `pt/rules.ts`.

### What is not

- Names: Bitor Quest, Claude, Anthropic, Penta, 3D&T, the names of models, "API", "PDF".
- "English" and "Português" on a language switch: each is written in its own language.
- What a world, a story, a person or the narrator says: names of places and people, the story text,
  summaries, memories. They are data, in the story's language already.
- Anything sent to a model: prompts, the lines the engine gives the narrator (`lines.push(…)` in
  `session.ts`), schema descriptions. These stay English.
- Ids, CSS classes, keys of objects, file names, URLs, what only a developer sees (`console`, thrown
  programmer errors, the `?demo=1` helpers).

## The dictionaries

One file for each part of the app, `src/i18n/pt/<part>.ts`:

```ts
export default {
  'Go to your stories': 'Ir para as suas histórias',
  'Reading part {done} of {total}': 'Lendo a parte {done} de {total}',
} satisfies Record<string, string>;
```

The key is the English text, character for character (mind the typographic apostrophe `’`, the
ellipsis `…` and the middle dot `·`). The Portuguese keeps the same `{slots}` and the same tags, and
the same space at either end if the English has one. The same English text may stand in two files as
long as it says the same thing in both.

| File | Covers |
|---|---|
| `welcome.ts` | `app/screens/Welcome.tsx` |
| `play.ts` | `app/screens/Play.tsx`, `app/components/*` |
| `shell.ts` | `app/ui.tsx`, `app/Shell.tsx`, `app/Root.tsx`, `app/app.ts`, `app/documents.ts`, `app/pdf.ts`, `app/files.ts` |
| `home.ts` | `app/screens/Home.tsx` |
| `worlds.ts` | `app/screens/Worlds.tsx`, `app/screens/WorldNew.tsx` |
| `character.ts` | `app/screens/CharacterNew.tsx`, `app/screens/Character.tsx` |
| `settings.ts` | `app/screens/Settings.tsx`, `app/screens/LookSettings.tsx`, `app/screens/Usage.tsx`, `app/themes.ts` |
| `journal.ts` | `app/screens/MapScreen.tsx`, `app/screens/Journal.tsx`, `app/screens/Recap.tsx`, `app/screens/Codex.tsx` |
| `people.ts` | `app/screens/People.tsx`, `app/screens/Person.tsx` |
| `game.ts` | `game/**` (what the game writes for the player) |
| `rules.ts` | `engine/**` (abilities, traits, skills, stages, levels, and what the rules say when a sheet is wrong) |
| `engine.ts` | the clock: parts of the day, lengths of time |

## How the Portuguese is written

Brazilian Portuguese, the way a well-made app speaks: plain, warm, direct. "Você", never "tu" or
"o usuário". Sentence case, as in the English. No exclamation marks the English does not have. Keep it
as short as the English where you can: a label that grows by half will not fit its button. Translate
the meaning, not the words.

### Words that must be the same everywhere

| English | Portuguese |
|---|---|
| story, scene, chapter, turn | história, cena, capítulo, turno |
| world, place, map | mundo, lugar, mapa |
| character, protagonist, sheet | personagem, protagonista, ficha |
| narrator, referee, scribe | narrador, árbitro, escriba |
| world builder | construtor de mundos |
| demo narrator, demo | narrador de demonstração, demonstração |
| key (API key) | chave (chave de API) |
| cost, spending, daily limit | custo, gastos, limite diário |
| Settings, Usage, Stories, Worlds, People, Character, Journal, Map | Configurações, Uso, Histórias, Mundos, Pessoas, Personagem, Diário, Mapa |
| bond | vínculo |
| No bond yet, Acquaintance, Friendly, Trusted, Close, Devoted | Sem vínculo ainda, Conhecido, Amigável, De confiança, Próximo, Devotado |
| party, companion | grupo, companheiro |
| grievance, to make amends | mágoa, reparar |
| moment (with a person) | momento |
| attitude | atitude |
| Strength, Skill, Resistance, Armor, Firepower (the five attributes) | Força, Habilidade, Resistência, Armadura, Poder de Fogo |
| skill, skills (Athletics, Crime…) | perícia, perícias |
| ability, abilities (what a path teaches) | técnica, técnicas |
| path, Focus, school, Extreme | caminho, Foco, escola, Extremo |
| fire, water, air, earth, light, dark (paths) | fogo, água, ar, terra, luz, trevas |
| advantage, drawback (disadvantage) | vantagem, desvantagem |
| ancestry | ancestralidade |
| hit points, energy, destiny, experience | pontos de vida, energia, destino, experiência |
| test (check), roll, die/dice | teste, rolagem, dado/dados |
| easy, medium, hard | fácil, médio, difícil |
| fight, attack, defend, flee | luta, atacar, defender, fugir |
| thread (of the story), clue, promise | trama, pista, promessa |
| recap | resumo |
| table style: Story, Adventure, Brutal | estilo de mesa: História, Aventura, Brutal |
| powers: Off, Focus, Extreme | poderes: Sem poderes, Foco, Extremo |
| to rewind, to go back in the story | voltar na história |
| export, import, erase | exportar, importar, apagar |
| situation, what is in motion | situação, o que está em movimento |
| device | aparelho |
