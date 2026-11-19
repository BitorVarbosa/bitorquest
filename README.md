# Bitor Quest

A solo role-playing game narrated by Claude, played on your own API key. You are the protagonist; Claude gives voice to the world; a small tabletop ruleset called **Penta** decides what succeeds. The app is a static web page that runs on a PC or a phone, has no server of its own, and keeps your key and your stories on your device.

**How to play:** [docs/PLAYING.md](docs/PLAYING.md) · **Em português:** [docs/JOGAR.md](docs/JOGAR.md) · **Hosting it:** [docs/HOSTING.md](docs/HOSTING.md) · **Android:** [docs/ANDROID.md](docs/ANDROID.md)

**Status: prototype, ready to be tried.** The interface is in English and Brazilian Portuguese, and the app installs and opens offline. One hand-made world and story, the full turn pipeline, fights, bonds, a cost meter, saves that stay small, rewinding, and memory that holds over a long story (milestones 1 and 2 of [docs/PLAN.md](docs/PLAN.md)). You can also build a world of your own from a few lines of description, from a setting Claude already knows, or from a document of yours (a text, Markdown or PDF file), then make a character for it and start a story there (milestones 3 and 4). A world can have no powers, paths of learnable abilities, whole schools of power, or one power of your own for each hero, written in your words (for settings such as superheroes). In such a world powers also come and go: a hero can learn a discipline the world's people teach, eat or carry an item of power found in the story, and copy or steal someone's power for a scene, and others can seal a hero's power or take it. Only the starting area of a built world is written in full; every other place is filled in the first time your story goes there. The world goes on while you play: what is in motion moves, people leave and come back, word gets about, and those who come to trust you will travel with you.

## Run it

Needs Node 22 or newer.

```bash
npm install
```

```bash
npm run dev
```

Then open http://127.0.0.1:5173/. On the welcome screen either paste a Claude API key, or choose **Try it without a key**: a demo narrator answers with canned text, sends nothing and costs nothing, and the cost meter shows estimates of what Claude would have cost.

```bash
npm test
```

```bash
npm run playtest
```

`npm test` runs every test. `npm run playtest` plays fifty turns through the real pipeline with the demo narrator and prints what it measured (cost per turn, share of input read from the cache, size of the scene packet).

```bash
npm run build
```

writes the static site to `dist/`. It can be hosted anywhere that serves files.

```bash
npm run phone
```

builds the site and serves it to your local network on port 4173, so that a phone on the same Wi-Fi can play it at `http://<this PC's address>:4173/`. Installing it on the phone needs a secure address: [docs/ANDROID.md](docs/ANDROID.md) has the way to do that over USB before the site is published.

### Helpers for development

`&lang=pt` (with `?demo=1`) shows the interface in Portuguese.

Adding `?demo=1` to the address skips the welcome screen, uses the demo narrator and opens a fresh copy of the sample story. It is a sandbox: nothing done in it is saved, so the stories, settings and key on the device are untouched. `&play=9` plays nine scripted turns first, and `&script=go:canal_bridge|say:I attack the knifeman|atk` runs steps of your own (`say:`, `ask:` for a question to the narrator, `go:`, `atk`, `def`, `flee`, `down:destiny`, `fail:overloaded`, `theme:dusk`, `fx:embers`, `motion:off`, and for the world moving: `days:3` to let three days pass and `luck:1` to make the world's own dice come up 1). The address after the `#` picks the screen: `#/play`, `#/people`, `#/person/mira`, `#/character`, `#/journal`, `#/map`, `#/settings`, `#/usage`, `#/worlds`.

`&world=…` puts a demo world on the screen without clicking through the builder; the world has the id `w-demo`. `&world=ok` is a finished world in the library (`#/worlds`, `#/character-new/w-demo`); `&world=review` is built and waiting to be accepted, `&world=3` is paused after three steps, `&world=0` has nothing built, and `&world=fail` has a step that failed (all at `#/world-new/w-demo`). `&ask=1` asks the builder's questions first, `&powers=off` builds a world without powers, `&powers=extreme` one where powers are schools and `&powers=gift` one where each hero has a power of their own, and `&hero=1` (with `world=ok`) also starts a story in it.

```bash
node docs/mockups/_tools/shoot.mjs "http://127.0.0.1:5173/?demo=1&play=9#/people" shots --prefix people --shots phone:all,desktop:all --wait 3500
```

renders a screen of the running app at phone and PC size and reports layout problems. `--click "<selector>"` presses something first, `--hover "<selector>"` moves the mouse onto something (use a PC shot: a phone has no hover), and `--eval "<js>"` runs a line of script in the page.

`npm run playtest:long` plays three hundred turns and checks what a long story does to the app: that what is sent, held in memory and saved each turn does not grow, that every turn can be taken back exactly, and that a story rewound, exported or brought up from an older save format is still the same story.

`go:` is the same as pressing "Travel there" on the map: the character asks to leave, and the scene decides. With the demo narrator, nobody walks away from hostile people without a test, so `go:canal_bridge|go:lantern_market` shows one.

## How a turn works

```
what you type
  -> REFEREE   a cheap model reads it: what kind of action, does it need a test, who is involved
  -> ENGINE    code, no cost: rolls the dice, applies the rules, looks up people, places and memories
  -> NARRATOR  the model you chose tells what happens, knowing the result it was handed
  -> ENGINE    applies what the narrator reported (time, bonds, threads) and records it
at the end of a scene
  -> SCRIBE    a cheap model turns the scene into a summary and event records
```

Dice are always rolled by code and shown. The narrator never rolls and cannot change a result.

Two things can happen instead of a turn:

- **A question to the narrator.** Choose "The narrator" under "To", or start a line with `//`. It is answered outside the story: nothing is said or done by your character, no time passes, nothing is rolled. Use it to ask what a passage meant, how a rule works, or how to use the app.
- **The game asks you.** When the referee cannot tell which of two things you meant, and guessing wrong would matter, it asks before anything happens and offers two or three answers.

## Why a turn stays cheap

The cost of a turn must not grow with the length of the story. Three things make that true:

- **Only the current scene is sent.** Each request carries a fixed-size "scene packet" (the place, the people present and what each of them has in mind, your sheet, open threads, the earlier chapters in a few lines and the chapter so far in a paragraph) plus the transcript of the current scene. Older scenes arrive only as summaries.
- **The request only grows at the end**, so Anthropic's prompt cache re-reads almost all of it at a fraction of the price. The fixed instructions and the world are cached for an hour, the scene for five minutes.
- **Everything that is not prose goes to code or to the cheapest model.** Rules, dice, time, distances and "who knows what" are code. Classifying an action and writing up a scene use Haiku.

The playtest checks all three on every run.

## How a long story is remembered

- **Events.** At the end of a scene the scribe records what happened as short events: who was there, and whether it is a secret, local talk, or public news. Every change of a bond is an event too.
- **What a person knows.** Someone knows an event if they were there or were told. Local talk reaches the rest of its town six hours later; public news reaches the rest of the country in three days; a secret reaches nobody. This is worked out by code when a person's card is written, and hearsay is marked as such for the narrator.
- **What a person has in mind.** Only two or three memories go on a card: the ones that weigh most now, counting how much they mattered, how long ago they were, whether they were about that person, and whether they bear on the scene.
- **Chapters.** A chapter ends by rule (a main thread finished, or about a session of play). What it came to is written once and never rewritten, so the summary of a long story cannot drift. Destiny points are restored when a chapter begins.
- **Going back.** Every turn keeps a small record of what it changed. Any scene can be rewound to from the Journal; the story as it was is kept as a separate copy first.

## Layout

| Path | What it is |
|---|---|
| `src/engine/` | The Penta rules: dice, tests, combat, bonds, time, character arithmetic. Pure TypeScript, no browser APIs. |
| `src/game/` | World and memory model, cards and the scene packet, retrieval, the turn pipeline (`session.ts`), and the Claude layer (`llm/`): request builders, the real client, the demo client, prices. |
| `src/packs/` | The sample world, The Lantern Coast, and the story "The Glass Road". |
| `src/app/` | The interface (React): screens, the Slate design system (`styles/`), storage on the device, installing and offline use (`install.ts`). |
| `src/i18n.ts`, `src/i18n/` | Two languages. English is the source; `src/i18n/pt/` holds the Brazilian Portuguese. How texts are marked, and the glossary: `src/i18n/README.md`. |
| `public/` | The web app manifest and the icons. |
| `tests/` | Rules tests, pipeline tests, request-shape tests, memory tests, the fifty-turn playtest and the three-hundred-turn one. |
| `docs/PLAN.md` | The plan: goals, architecture, token strategy, ruleset, roadmap, decisions. |
| `docs/mockups/` | The design mockups for every screen, and the tools in `_tools/`: screenshots of the running app (`shoot.mjs`), the check that the built site opens offline (`offline.mjs`), the third-party notices (`notices.py`). |
| `docs/PLAYING.md`, `docs/JOGAR.md` | How to play, in English and in Portuguese. |
| `docs/HOSTING.md`, `docs/ANDROID.md` | Publishing a build; the app on Android. |

`src/engine` and `src/game` run without a browser, which is what lets the tests and the playtest drive the same code as the app.

## Your key and your data

- The key is stored in this browser (or only until the tab closes, your choice) and is sent only to `api.anthropic.com`. It is never written to a story export or a log.
- Stories are stored in the browser's IndexedDB. Export a story to a file from the Stories screen to back it up or move it to another device. A browser may clear this storage when a device runs short of space, unless it has agreed to keep it (Settings, Your data, says which): export the stories you care about.
- A story can be open in one window at a time. A second window is told so, and can take the story over once the first is closed.
- A document you build a world from is opened on your device. What repeats on every page (running heads, page numbers, a shop's stamp with the buyer's name) and every e-mail address are taken out before any of it is sent, it is read once, and only the notes made from it are kept.
- The app loads nothing from third parties: no analytics, no fonts, no scripts. The built page carries a content policy that lets it talk to `api.anthropic.com` and to nothing else.
- Installed (Settings, About, Install, or your browser's menu), it opens in a window of its own and without a network connection. Talking to Claude still needs one.
- Set a spend limit on the key itself in the Claude Console as well as the daily limit in the app.

## Credits and licence

The Penta rules are written in our own words and are mechanically descended from 3D&T by Marcelo Cassaro, who released that system's rules as open game content. No text, names, characters or settings from the published books are used. Bitor Quest is not affiliated with Anthropic or with the publisher of 3D&T.

The code is under the GNU Affero General Public License, version 3 or later ([LICENSE](LICENSE)). The original game content (the Penta rules as worded here, the sample world, the documents) may also be used under CC BY-SA 4.0 ([LICENSE-CONTENT.md](LICENSE-CONTENT.md)). The packages the built site contains, and their licences, are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). What you make with the app (worlds, characters, stories) is yours.
