# Mockups

Static HTML mockups for Bitor Quest. There is no build step and nothing is loaded from the network. Nothing here calls the Claude API; every screen shows the same sample story (*The Glass Road*, with Aren, Mira and Tobin).

## Status

1. The play screen was drawn in six design directions (`play-screen/`), and **Slate** was chosen.
2. Slate was revised (a white die that rolls, speech bubbles outlined in the speaker's colour, bond from 0 to 100 in five stages, curated memories) and turned into a shared design system.
3. Every screen of the app is now drawn in Slate (`slate/`): 17 screens, 53 states, each at phone and PC size.

## Where to look first

| Open this | To |
|---|---|
| `slate/index.html` | Browse every screen and state, at phone and PC size side by side, in dark or light. On a phone it is a list that opens each screen full screen. |
| `slate/bitor-quest-screens.html` | The same viewer and all screens packed into one file, for sending to a phone. Built by `_tools/build-slate.mjs`. |
| `slate/shots/sheet-*.png` | Contact sheets: every state of every screen, by group, phone and PC. |

Inside a screen the buttons and links work: start at Welcome and walk through to the play screen, or use the navigation at the bottom (phone) or left (PC).

## The Slate folder

| Path | What it is |
|---|---|
| `slate/slate.css` | The design system: tokens (colour, type, space, shape), atoms, the app shell, components. One world accent colour re-tints the whole interface; dark and light themes. |
| `slate/slate.js` | The mockup runtime: icons, the top bar and navigation, states (`?state=`), choices, modals, the die. |
| `slate/play.css` | Layout of the play screen and its relatives (combat, system states). |
| `slate/screens.js` | The list of screens and their states, used by the viewer and the tools. |
| `slate/<screen>.html` | One file per screen; its states are selected with `?state=<name>`; `?theme=light` for the light theme. |
| `slate/index.html`, `slate/contact.html` | The viewer and the contact-sheet page. |

The screens, in the order a player meets them:

| Group | Screen (file) | States |
|---|---|---|
| Start | Welcome and key (`welcome`) | first, error, valid |
| | Your stories (`home`) | list, empty |
| New story | Worlds (`worlds`) | list, pick, empty |
| | World creation (`world-new`) | source, premise, table, questions, building, overview |
| | Character creation (`character-new`) | proposed, edit, over |
| Play | Play (`play`) | continue, input, people |
| | Combat (`combat`) | turn, resolve, down, won |
| | When something is in the way (`system-states`) | thinking, offline, error, rate, refusal, budget, key |
| | Previously… (`recap`) | return, chapter |
| In the story | People (`people`) | all, empty |
| | A person (`person`) | profile, history |
| | Character sheet (`character`) | sheet, abilities, inventory |
| | Spending experience (`advance`) | spend, learn, done |
| | Journal (`journal`) | threads, story, codex, rolls |
| | Map (`map`) | local, travel, region |
| App | Settings (`settings`) | app, story |
| | Spending (`usage`) | overview |

## The earlier exploration

| Path | What it is |
|---|---|
| `play-screen/index.html` | Side-by-side gallery of the six directions for the play screen. |
| `play-screen/<direction>.html` | One mockup per direction (`state=continue`, `input` or `people`). |
| `play-screen/all-directions.html` | All six packed into one file. Built by `_tools/build-standalone.mjs`. |

## Commands

Run from the project root. The tools need Node 22 or newer and an installed Edge or Chrome; they have no other dependencies.

```bash
node docs/mockups/_tools/shoot-slate.mjs          # render every Slate screen and state, check the layout, build contact sheets
```

```bash
node docs/mockups/_tools/shoot-slate.mjs --only people,person --tall   # just these screens; also in a tall window to see whole pages
```

```bash
node docs/mockups/_tools/build-slate.mjs          # rebuild slate/bitor-quest-screens.html
```

```bash
python -m http.server 4173 --directory docs/mockups   # serve the viewer at http://localhost:4173/slate/
```

`_tools/shoot.mjs` is the renderer underneath: it opens one mockup at real phone and PC viewport sizes and reports layout problems (horizontal overflow, text under 12px, tap targets under 40px, script errors, network requests). `_tools/shoot-all.mjs` re-renders the six play-screen directions.

## Conventions

- A phone layout below 700px wide (designed at 390 × 844) and a PC layout from 1100px (designed at 1440 × 900).
- On a phone every tappable thing is at least 44px tall. No text under 12px. The page never scrolls sideways.
- Every colour, size, space and radius is a token in `slate.css`. A screen's own CSS sits in a `<style>` block in that file and is built from tokens.
- System fonts, inline SVG icons from one sprite, no emoji, no external resources.
- A character has one colour (`.who-<name>`), used for the avatar, the name, the speech bubble outline and the bond bar.
- Dice are always shown as a die: white with black pips for the player, dark for an opponent.
- Hooks used by the tools on the play screen: `data-log` on the scrolling story, `data-pending` on beats not yet revealed, `data-continue` on the Continue control, `data-people-toggle` on anything that opens the People panel.
