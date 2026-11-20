# Plan — Bitor Quest

Version 0.20 · 2026-11-19 · status: decisions settled (section 15); screens approved; milestones 1 to 4 built (section 14): the play loop, played twice by the project owner with a real key; saves, rewinding and memory over a long story; the world builder, worlds library and character creation, with places filled in on arrival; and depth: a world that moves by itself, powers in play, a document as the source of a world, company, grievances, people who move and talk, situations that end by themselves, personal quests. Milestone 5 (release) is prepared short of publishing: the app installs and opens offline, the interface is in English and Brazilian Portuguese, the guides, licence files and notices are written (section 14, "Milestone 5 as prepared"). Since then the dice wait to be thrown by the player, and a fourth way of having powers, Gift, gives each hero one power of their own (section 14, "After milestone 5"), and in a Gift world powers can now come and go: several on one sheet, disciplines that are taught, items of power, seal, copy and steal (section 14, "Powers that come and go"). Nothing since milestone 1 has been seen against the live API, nothing has been tried on a real phone, and nothing is published

Bitor Quest (the name for now) is an open-source, non-profit app in which the player brings their own Claude API key and plays a solo tabletop-style RPG with Claude as game master. Its ruleset is called Penta. This plan reviews the original idea critically, proposes an architecture built around token cost, and records the decisions taken (section 15).

Every cost figure here is an **estimate** from list prices and assumed sizes. Nothing has been measured yet; measuring is the first job of the prototype.

---

## 1. Summary

The player opens the app, picks or creates a world, creates a character, and plays through chat. Claude narrates; the app remembers the world, tracks what each character knows, and resolves outcomes with a simple tabletop ruleset. The player pays only for their own API usage, so the design goal above all others is that **the cost of a turn must not grow with the length of the story or the size of the world**.

The plan in eleven decisions:

1. **One web app, no server.** An installable web app (PWA) that runs on PC and Android from one codebase and calls the Claude API directly from the device with the player's key.
2. **Code is the referee, Claude is the storyteller.** Dice, arithmetic, inventory, time, distances, knowledge lookups and rule validation are plain code and cost zero tokens. Claude is used only where language and judgment are needed.
3. **Bounded context per turn.** Each request carries a fixed-size "scene packet" assembled by code from a structured store, plus the transcript of the current scene only. Old scenes are compressed into records and summaries.
4. **Three model roles.** A cheap model adjudicates and takes notes; the player's chosen model narrates; a strong model is used rarely, to build the world and extend it.
5. **The world is a graph that grows on demand**, not a 2D table generated up front. Detail is generated where the story goes and stored forever once generated.
6. **Character knowledge is derived, not written.** Every notable event is a record with witnesses. What a character knows is the set of events they saw or were told about.
7. **An original ruleset, mechanically descended from 3D&T.** The author released the rules as open content years ago, but not the setting or the books' text, and the publisher's current license excludes apps. So the repository carries our own text and names, with credit to the source (section 4).
8. **Difficulty is an explicit "table style".** Dice are always real and visible. Help for the player comes from rules the player can see, never from hidden fudging.
9. **Worlds are reskins over a fixed, tested mechanics library.** Claude names and flavors things; it does not invent mechanics per world.
10. **A token meter and spending caps exist from the first prototype.**
11. **Characters come first.** Bonds, party members, favorites and time spent with characters are a core system, visible on the main screen from the first prototype (10.7).

Section 3 goes through the original proposal point by point. Section 15 records the decisions taken.

---

## 2. Goals and non-goals

Goals, as I understand them:

- Play any kind of story as the protagonist: brutal dungeon crawl, power fantasy, quiet romance in a favorite setting, exploration of an unknown world.
- The world persists and reacts: it remembers what the player did, and characters know only what they should know.
- Characters matter. Friendship, romance, companions and socializing are central, and the player can always spend more time with the characters they like most.
- A light tabletop ruleset decides uncertain outcomes and gives the character a progression curve that cannot be skipped.
- Worlds are reusable templates; each story changes only its own copy.
- Token spending is deliberate. The app never re-reads the whole world to answer one input.
- Free, open source, runs on PC and Android, nothing to pay except the player's own API usage.

Non-goals for version 1:

- Multiplayer, accounts, cloud sync, a hosted backend.
- Image generation (Claude does not generate images; the map is drawn by code).
- Sharing worlds between users (legal questions when a world comes from a copyrighted book).
- Support for other AI providers.

---

## 3. Review of the original proposal

| Your idea | Verdict | Why | What I propose |
|---|---|---|---|
| Player's own API key, free and open source | Keep | It is what makes a non-profit app viable. | Add onboarding for getting a key, a spend cap, and a live cost meter (7.5, 12). |
| PC and Android versions | Simplify | Two native apps double the work for no gain in a text game. | One installable web app; wrap it for the Play Store later if wanted (5). |
| Use 3D&T as the system | Keep the mechanics, drop the text and name | The author released the rules as open content, but the books' text and the setting are reserved, and the publisher's 2026 open license excludes apps. | The same rules in our own words and names, credited to the source (4, 10). |
| Focus in six schools, capped at 5 | Keep, with corrections | In the source, the god-like spells need Focus 6 to 10, often in several paths; and 73 of 184 spells need only Focus 1, so Focus alone gates little. | Keep 0–5, write our own tiered ability list, and add a knowledge gate: abilities must be found and learned in the world (10.3). |
| Choice between "Focus" and "Extreme" | Keep | Both exist in the source and give different feels. | Add a third option, "no powers", for grounded settings (10.3). |
| Roll for everything, or cheat in the player's favor | Neither | Rolling for everything is tedious; secret cheating by an AI narrator removes all stakes, and AI narrators already lean toward letting the player win. | Roll only when the outcome is uncertain and both results are interesting. Real dice, rolled by code. Help comes from visible rules chosen as a "table style" (10.5). |
| Claude rewrites the reference lists (spells, items, templates) for each world | Change | Costly in output tokens, and mechanics written by a model per world will be unbalanced and untested. | A fixed mechanics library; per world, Claude generates names, flavor and a selection (10.8). |
| World from a PDF or a text description | Keep, extend | Sending PDF pages to the model is the most expensive way to read a book. | Extract text on the device and digest it with the cheapest model; add a third path, "a universe Claude already knows" (8.7). |
| Map as 2D tables with terrain, climate and distance to everything | Change | Tokens scale with area, most of which is never visited; models are poor at consistent grids; all-pairs distance is quadratic. | A hierarchy of places connected by routes; distances computed by code; detail generated when approached (8.1, 8.2). |
| "What is moving this world right now?" | Keep | It is what makes a world feel alive. | Formalize as a few "fronts" with clocks that advance by code as time passes (8.3). |
| Pre-written important characters and quests | Change | Fixed plots get bypassed or feel like rails; unused ones are wasted tokens. | A small cast and "quest seeds" (situations with stakes, not scripts), expanded when the player engages (8.4). |
| Claude may ask questions during world creation | Keep | Cheap and avoids regenerating a wrong world. | At most two short rounds, each question with suggested answers and a "surprise me" option (8.6). |
| Suggested character sheet the player can tweak | Keep | | One call to propose; the editor and its validation are code (11). |
| "Continue" button to break up long text | Keep | | Claude returns the passage split into beats; the app reveals them one by one. Pressing Continue never calls the API (11). |
| A folder of files per story that Claude reads selectively | Change | Letting the model browse files costs a round trip and tokens per lookup. | A structured store on the device; code picks what goes into each request. Export to readable files stays possible (9, 12). |
| A memory per character | Change | Per-character prose memories need a model call to update each one and drift apart. | One event log with witnesses; each character's knowledge is a query (9.2). |
| Order: plan, mockups of all screens, prototype | Keep | | Inside the prototype, build the play loop on a tiny hand-made world first, before the world builder (14). |

---

## 4. Licensing — read this first

What I found:

- The core rulebook attached is *Manual 3D&T Alpha, Edição Revisada* (Jambô, 2015 printing). It and *Manual do Defensor* (Jambô, 2016) carry "todos os direitos reservados" notices. *Manual da Magia* is an unofficial fan supplement; *Manual dos Monstros* is a fan bestiary that says its free electronic distribution was authorized by the system's creator. Free to download is not the same as free to reuse.
- In June 2026 Jambô published an official [Licença Aberta](https://jamboeditora.com.br/licenca-aberta/) (version 1.0, updated 24/06/2026). As I read a summary of it: it covers the *Tormenta20* and *3DeT Victory* lines, permits static, printed or text-based works, and **does not permit publication in apps, websites or online game platforms** (clause 2.2.1), apart from fillable character sheets. It grants no translation or adaptation rights and requires labeling AI-generated content. 3D&T Alpha is not named in it.
- **"Not covered by the license" does not mean "free to use".** Copyright protects a book by default, and a license is the publisher granting permission for specific uses. Alpha being absent from Jambô's open license means that license grants nothing for it, so the book's own notice applies: reproduction in whole or in part needs the publisher's written authorization.
- **The author did release the rules of the older edition.** The *Manual dos Monstros* reproduces an undated public message (it mentions Orkut, so mid-2000s) from Marcelo Cassaro, the system's author. He says he never forbade anyone from publishing or working with 3D&T, and then: "autorizo a liberação de suas regras (mas não personagens e ambientações)" as Open Game content, naming *3D&T, Defensores de Tóquio 3ª Edição*. That is the generation of rules the Focus system comes from. The statement is informal: no license text, no date, nothing about the name, the art or later editions, and it predates both Alpha and Jambô's 2026 license.
- Independently of any permission, Brazilian copyright law (Lei 9.610/98, art. 8) lists rules for games among the things not protected as such; what is protected is the text, the names, the setting and the art.
- **Taken together:** using the rules is well supported, by the author's statement and by the law. Nothing gives us the books' text (Alpha's in particular), the Tormenta setting and its names (Arton, the named spells and characters), the art, or the 3D&T / 3DeT marks.

What I recommend:

1. **Clean-room ruleset.** Implement the mechanics in code and describe them in our own words, in English and Portuguese. Generic terms (Strength, Skill, hit points) are fine. Nothing setting-specific, no copied descriptions, and our own ability list rather than the books' spell lists. The author's statement supports using the rules; it does not hand us any book's wording, and a modified, bilingual ruleset needs its own text anyway.
2. **Our own names** for the ruleset and the app. Do not put "3D&T", "3DeT", "Defensores de Tóquio" or "Claude" in either name. Credit the origin plainly in the documentation: based on the 3D&T rules by Marcelo Cassaro, which he released as Open Game content.
3. **Write to Jambô, and to the author if reachable.** Describe the project (free, open source, non-commercial, player's own key), cite the Open Game statement, and ask them to confirm it still stands for a free app. They have just built a licensing process, and the system has a long tradition of fan-made material (two of the four books here are fan works). A yes settles the question; without one, points 1 and 2 keep us on the supported side.
4. **Repository hygiene.** The PDFs, their text extracts and my working digests live in `docs/rulebooks/`, which is already in `.gitignore`. Two of the PDFs are watermarked with a purchaser's name and e-mail on every page (one is yours, one is another person's), which is a second reason they must never be committed.
5. **Books supplied by players.** They are processed on the device and sent only to the player's own API account. A world built from a copyrighted novel is for that player's use; version 1 should not offer public sharing of worlds.

This is my reading as an engineer, not legal advice. Point 3 is the cheap way to remove the doubt.

---

## 5. Platform and stack

### Recommendation: one installable web app (PWA), built so it can be wrapped later

| Option | PC | Android | Effort | Notes |
|---|---|---|---|---|
| **Web app (PWA)** | Yes | Yes | One codebase | Free static hosting, instant updates, installable to the home screen. iOS comes for free. |
| PWA + Capacitor wrapper | via PWA | Play Store APK | Small extra | Adds native key storage and a store listing. Can be added later without rewriting. |
| Tauri 2 | Native | Native | Medium | Small binaries and real file access, but a Rust and Android toolchain for every contributor. |
| Flutter / React Native / Kotlin | Yes | Yes | High | No official Claude SDK for Dart; the official TypeScript SDK does not support React Native. |

Why the web app works for this project:

- **Direct API calls from the browser are supported.** The Claude API accepts cross-origin requests when the request opts in, and the official TypeScript SDK supports browsers behind an explicit flag (`dangerouslyAllowBrowser`). The flag is named that way because a key embedded in a public site would be exposed; a key typed in by its owner and kept on their device is the case it is meant for.
- **Zero running cost.** The app is static files on GitHub Pages or Cloudflare Pages. No server means nothing to pay for and no player data on our side.
- **One codebase, one language** (TypeScript), which matters for an open-source project that wants contributors.

What the web app costs us, and the answer to each:

| Risk | Mitigation |
|---|---|
| The API key sits in browser storage, readable by malicious scripts or extensions | No third-party scripts at all; strict content security policy allowing network access only to `api.anthropic.com`; optional passphrase encryption of the stored key; "session only" option; onboarding tells the player to create a dedicated key with a spend limit. |
| The browser may evict stored data | Request persistent storage; one-tap export of a story to a file; a reminder to back up after long sessions. |
| Android suspends the page when the player switches apps | World creation runs as small resumable steps with saved progress, never one long request. |
| No Play Store presence | Installable from the browser today; wrap with Capacitor if a store listing is wanted. |

### Stack

- TypeScript, React, Vite with the PWA plugin.
- Official `@anthropic-ai/sdk` for all Claude calls, with streaming and structured outputs.
- Storage: IndexedDB through Dexie, with the active story's world model held in memory and indexed there. A long campaign is a few megabytes, so in-memory indexes are fast and easy to test. (I considered SQLite compiled to WebAssembly; it adds a worker, a WASM binary and single-tab constraints that this data size does not justify. Storage sits behind an interface, so this can change.)
- MiniSearch for text search over memories. No embeddings: they would need a second provider or a large on-device model, and structured lookup by entity does the job better here.
- pdf.js for extracting text from documents on the device.
- Zod schemas shared between the engine and the structured outputs requested from Claude.
- Vitest for unit tests; a mock Claude client with recorded responses so contributors can run and test the app without spending credits.

---

## 6. Architecture

### The roles

| Role | What it is | Job |
|---|---|---|
| **Engine** | Code | Dice, rules, character math, combat, time, travel, inventory, clocks, knowledge queries, context assembly, validation. Zero tokens. |
| **Referee** | Cheap model, tiny context | Reads the player's input and says what kind of action it is, whether a check is needed and how hard, who is involved, and what the app should look up. It never sees dice. |
| **Narrator** | The player's chosen model | Writes the story text for the turn, knowing the outcome the Engine produced. |
| **Scribe** | Cheap model | At the end of each scene, turns the transcript into event records, updates to characters and places, and a short summary. |
| **Architect** | Strong model, used rarely | Builds a world template and expands places, characters and quests when the story reaches them. |
| **Ingestor** | Cheap model | Digests a document supplied by the player into world notes. |

### One turn

```
player input
   │
   ▼
REFEREE (cheap)   → { kind, feasible?, check: {attribute, skill, difficulty}, targets,
   │                  names mentioned, things to recall, time cost, risk }
   ▼
ENGINE (code)     → validates against the sheet and the world state
   │                rolls dice, applies rules, updates hit points / time / position
   │                looks up cards for anyone or anything mentioned (0 tokens)
   ▼
NARRATOR (main)   → story text in short beats (streamed) + a few flags
   │                (time passed, scene ended?, new named things)
   ▼
APP               → shows beats one at a time, dice results, updated panels
```

Why two calls instead of one:

- The Referee decides the check without knowing the roll, and the Narrator cannot change a result it was handed. An AI narrator asked to do both tends to skip checks or soften results.
- The Referee's output tells the code what to fetch, so retrieval costs no model round trips. Giving the Narrator "lookup" tools instead would mean a second full request each time it used one.
- The Referee runs on the cheapest model with about 2,500 tokens of context, so it costs a small fraction of a cent and about a second.
- Many inputs never reach the Narrator: an action the character cannot take ("I cast a spell I do not know") is refused by the Engine with a one-line message, and questions like "what do I know about the baron?" are answered from the journal.
- Leaving a place is a request, not a teleport. Whether the player typed "I go to the Guild House" or chose it on the map, the Referee says whether the character can simply walk out. If nothing stands in the way, the Engine moves them and the Narrator tells the arrival. If something does (they are being questioned, guarded, chased, locked in), they stay: the Narrator tells what happens when they try, and may let them go; when they could get away by an attempt that might fail, a test decides it; when there is no way out at all, the Engine says so in one line and nothing is narrated. In a fight, heading for another place is an attempt to flee. The map itself knows none of this and does not need to.
- The Referee is also where the game asks instead of guessing. When what was typed could mean two different things and a wrong guess would matter, it returns a short question with two or three answers, and nothing happens in the story until the player has answered. It asks once: the answer is never questioned again. And when the text is plainly meant for the narrator and not for anyone in the story, it is answered outside the story (section 11).

### Scenes

A **scene** is continuous play in one place with a stable cast. It is the unit of context:

- Inside a scene, the request only ever grows at the end (append-only), which is what makes prompt caching effective (7.2).
- A scene ends when the player moves somewhere else, time skips, or the transcript passes a size limit. The Scribe then processes it once, and the next scene starts with a fresh packet and a short summary of the last.
- The source books define a "scene" as their unit of time for temporary effects, so the rules and the context management share one concept.

### Combat

Combat is resolved entirely by the Engine, round by round. The player chooses actions with buttons or text; enemies follow simple behavior scripts. The Narrator describes each round in two to four sentences from the Engine's log. A "fast combat" option resolves several rounds before narrating, which is much cheaper for minor fights.

---

## 7. Token strategy

### 7.1 Where the money goes

Prices per million tokens (reference snapshot of 3 November 2026):

| Model | Input | Output | Cached input read | Role here |
|---|---|---|---|---|
| Haiku 5.5 | $0.10 | $0.50 | about $0.01 | Referee, Scribe, Ingestor; budget Narrator |
| Sonnet 5.5 | $2 | $10 | $0.10 | Narrator, balanced |
| Opus 5.5 | $4 | $20 | $0.20 | Narrator, premium; Architect |
| Fable 5.2 | $8 | $40 | $0.20 | Narrator, luxury |

Haiku 5.5 costs five times more on prompts over 100,000 tokens, so its inputs are kept below that. Writing to the cache costs 1.25 times the input price for a 5-minute entry and 2 times for a 1-hour entry.

Three consequences drive the design:

- **Output is five times the price of input**, and with caching it becomes most of the bill. Narration length and the model's thinking effort are the biggest cost controls the player has.
- **Cached input is 10 to 40 times cheaper than fresh input.** Everything stable must sit at the front of the request, byte for byte identical between turns.
- **Haiku 5.5 is 20 to 40 times cheaper than the narrating models.** Every job that is not prose for the player goes there.

### 7.2 Layout of a Narrator request

Caching matches on the exact beginning of the request, so content is ordered from most stable to least:

```
system[0]     GM contract, rules ladder, style, output format   ~2–3k tok   same for the whole story     cache 1 h
system[1]     World core: tone, glossary, factions, fronts      ~1–1.5k     changes rarely               cache 1 h
messages[0]   Story header + scene packet                       ~1–2k       fixed for the scene          cache 5 min
messages[1…]  Scene transcript, append-only                     0–6k        grows ~450 tok per turn      cache 5 min
                user:      what the player typed
                system:    Engine results + cards fetched this turn
                assistant: the narration (text only)
```

- The **scene packet** is built by code: a card for the place, cards for the characters present, the protagonist's sheet in a few lines, active quests, the story so far in about 300 tokens. Every card has a fixed token budget.
- Engine results go in as system-role messages inside the conversation. The current models accept these without breaking the cache, and the player cannot forge them by typing text that looks like a dice result.
- The app stores and replays narration as plain text only. The current models bind their hidden reasoning to an unedited history and reject edited ones; keeping each scene append-only and starting a new conversation at scene boundaries stays clear of that rule.
- If the player pauses longer than five minutes, a 5-minute cache entry expires. There are two remedies: a one-hour entry, written at twice the input price, or a zero-output "keep-alive" request sent while the app is open, billed as a cache read only. The keep-alive cannot be combined with every request shape, so the prototype will measure which remedy is cheaper for real play patterns. Either way, a cache miss on a bounded context costs a few cents at most, which is the point of bounding it.

### 7.3 Techniques, ranked by expected impact

1. **Bound the context.** Scene-scoped transcript plus fixed-budget cards. Cost per turn stays flat whether the story is 20 turns old or 2,000.
2. **Prompt caching with a stable prefix**, as laid out above, with a standing test that the cache hit rate stays high.
3. **Control output.** Narration length is a player setting (short, medium, long) with numeric targets in the prompt. The Narrator runs at low thinking effort. Opening scenes get a larger allowance than ordinary turns.
4. **Send jobs to the cheapest model that can do them.** Referee, Scribe and Ingestor on Haiku.
5. **Retrieval by code.** Place, cast, quests and knowledge come from structured lookups; names in the player's input are matched against an alias index; older material is found by text search driven by the Referee's hints. No model call is spent on finding things.
6. **Summarize once, at scene end**, into records and a summary, with summaries rolled up by chapter. Nothing is re-summarized every turn.
7. **Generate the world lazily** (8.2) and never regenerate what exists.
8. **Reskin instead of regenerating mechanics** (10.8).
9. **Digest documents locally and cheaply** (8.7).
10. **No tool-use loops on the play path.** Each loop iteration is another full request.
11. **Pagination on the device.** "Continue" reveals text already received. The reply is still requested as a stream, but it is never typed out on screen: the first passage is shown, whole, the moment its last paragraph is complete (well before the reply ends), and the rest waits for Continue.
12. **Compact formats.** Cards are terse `key: value` lines, not verbose JSON; identifiers are short.
13. **Questions to the narrator ride on the cache and leave no trace.** A question outside the story (section 11) is sent as the scene exactly as the last turn sent it, then the question. Its cache marker sits where the last turn left its entry, so the whole scene is read at the cache price and nothing new is written; only the last reply, the question and a short note are paid at full price. The exchange is kept beside the scene, never inside its transcript, so the next story turn finds the cache untouched and no later turn pays for it. The notes on the rules and the app (several hundred tokens) are added only when the question looks like it is about them. A question typed with "To: The narrator" also skips the Referee. Measured with the demo narrator (estimates): a "what did you mean?" costs about $0.002, two thirds of a story turn, and a question about the rules about $0.003, the same as a turn.

Things I looked at and would not use: the API's server-side conversation memory and automatic compaction (ours is domain-aware and cheaper), the Batch API (half price but asynchronous, so useless for play), and native PDF input (cost).

### 7.4 Estimates

Per turn, steady state inside a scene, assuming 9,000 cached tokens, 450 new input tokens and 450 output tokens (about 230 words of narration, the flags, and light thinking), plus the Referee and the Scribe's share:

| Narrator model | Per turn | Turns per US$1 | Per hour at 40 turns |
|---|---|---|---|
| Haiku 5.5 | ~$0.0006 | ~1,600 | ~$0.03 |
| Sonnet 5.5 | ~$0.007 | ~150 | ~$0.27 |
| Opus 5.5 | ~$0.013 | ~75 | ~$0.53 |
| Fable 5.2 | ~$0.025 | ~40 | ~$1.00 |

For comparison, re-sending a 100,000-token history and world dump without caching would cost about $0.20 per turn on Sonnet 5.5 and $0.40 on Opus 5.5, roughly thirty times more. With caching but no bounding, it is cheap only while the cache is warm: one five-minute pause re-bills the whole context ($0.25 on Sonnet), and the context keeps growing.

One-time costs:

| Operation | Estimate |
|---|---|
| Creating a world, character and opening scene | $0.15–0.40 with Sonnet or Opus as Architect; a few cents if the bulk steps run on Haiku |
| Digesting a 300-page novel (about 150,000 tokens of text) | about $0.02 on Haiku in chunks, plus one synthesis call (~$0.05 on Sonnet) |
| The same book sent as PDF pages | on the order of 450,000–900,000 tokens per pass: about $1–2 on Sonnet, $2–4 on Opus |

### 7.5 Budget controls in the app

- A meter showing the cost of the last turn, the session and the story, computed from the usage numbers every API response returns and a price table shipped with the app (editable, since prices change).
- A spending cap per day and per story: a warning at 80%, a hard stop at 100%.
- A cost preview and confirmation before world creation and document digestion.
- A hard output limit on every call, and no automatic retries beyond a small fixed number.
- The model list is read from the API at runtime, so new models appear without an app update.

---

## 8. World model and world creation

### 8.1 Places are a graph, not a grid

A world is a tree of places with routes between them:

```
world → region → settlement or site → district or building → room
```

- Each place has a short card (what it is, terrain, climate, culture, mood), a one-line brief for indexes, and optional deeper lore that is only read on request. Children inherit climate and culture from their parent unless they override it, so nothing is repeated.
- **Routes** connect places and carry distance, travel time by mode, terrain and danger. The distance between any two places is a shortest-path calculation in code.
- Each world chooses which levels matter. For a galaxy-spanning setting the levels are sector, planet, site; a whole planet is one node unless the story lands there. For a single-continent setting they are country, city, district. This answers the question of scale: the map is as deep as the story needs in each branch, instead of one table at one resolution.
- Places also get rough coordinates relative to their parent, so the app can draw a schematic map showing only what the protagonist has discovered.

### 8.2 Level of detail

At creation the Architect produces:

- the whole world as 8 to 15 regions with one line each;
- the starting region in settlements and sites;
- the starting place in full.

Everything else is a named stub. When the protagonist heads toward a stub or asks about it, the Architect expands it, consistent with its parent and neighbors, and the result is stored permanently. The cost of the world follows the path the player takes. One of the source books gives human game masters the same advice: start with one village and fill in details only when needed.

**As built (milestone 3).** A stub is filled in when the story *arrives* there, not when it is asked about: asking after a town one never visits should not cost a town. "Stored permanently" turned out to need care, because a story can be rewound: see section 14, "Sketched places".

### 8.3 What is moving the world: fronts and clocks

Each world has three to five **fronts**: a war, a festival, a plague, an empire's return. A front has a goal, an ordered list of stages, and a **clock**. The Engine advances clocks as game time passes, with a die roll for uncertainty. When a clock fills a stage, the consequence becomes a world event with a scope (who would hear of it and how fast). The Narrator is told about a front only when its effects would be visible where the protagonist is.

The world therefore moves while the player is busy elsewhere, and it costs nothing until it becomes visible. At chapter boundaries a cheap call turns the stages that advanced into concrete news and rumors.

The source system also assumes campaigns end: heroes grow over about twenty adventures and face a final threat. Each story gets a central question and a final threat tied to a front, so a story can finish with an ending and continue as a new season if the player wants.

**As built (milestone 4).** Fronts move by rule, one stage a chapter, and not by the calendar alone; a stage becomes news only when it has a public face; no call is made for any of it. A front reaching its last stage does not yet end a story. See section 14, "The world moves".

### 8.4 Cast and quest seeds

- **Characters come in three tiers.** Extras exist only inside a scene. Recurring characters have a card and a relationship line with the protagonist. Major characters also have goals, secrets and sometimes their own clock. A character is promoted when the story keeps coming back to them.
- **Quest seeds, not quests.** A seed is a situation: who wants what, what stands in the way, what happens if nobody intervenes, and one secret. Five to eight seeds near the starting point are generated at creation, each under 100 tokens. A seed becomes a tracked quest when the player engages with it. Your Quidditch cheating scandal is a seed attached to "joins the team".

### 8.5 Rules profile of a world

Each world carries a small profile that configures the ruleset for its genre: starting power level, whether powers exist and in which mode, which ancestries and advantages are available, renamed attributes and resources, and which optional subsystems are on. The source's own book of optional rules does this for eight sample settings (a music-industry drama plays "combat" as concerts with the attributes renamed; a cyberpunk setting adds a corruption track), which is good evidence the approach works across genres.

### 8.6 The creation pipeline

1. **Source.** The player describes a world, names a universe Claude already knows, or attaches a document.
2. **Protagonist premise.** One or two sentences on who they play. This sets where detail is spent.
3. **Table settings.** Difficulty style, powers mode, tone and content preferences, language, narration length.
4. **Questions.** The Architect may ask up to five questions over at most two rounds, each with suggested answers.
5. **Skeleton.** Regions, fronts, rules profile, naming glossary. The player sees an overview and can accept, edit or regenerate parts.
6. **Starting area.** Places, cast, quest seeds.
7. **Character.** A proposed sheet, then the editor.
8. **Opening scene.**

Each step is a separate request with saved progress, so creation survives an app switch on a phone and a failed step can be retried alone.

**As built (milestone 3).** Stages 5 and 6 are one run of seven requests, in this order: the map; what moves the world; the rules for this world; what the narrator must always know; the starting area; the people; how it begins. The player reviews the world once, at the end, as the mockup shows; the half-way approval this list implied is gone, because a player who must approve a map before seeing who lives on it is approving nothing they can judge. Building one step again rebuilds the steps after it too, since they were written knowing the old one. The questions are one round, not two. See section 14, "Milestone 3 so far".

### 8.7 Sources for a world

- **A universe Claude knows.** For well-known settings, naming the work is enough and costs almost nothing. The Architect builds from what it knows and asks about ambiguities (which era, which continuity).
- **A document.** The app extracts the text on the device, takes out what repeats from page to page (and every e-mail address), cuts it into parts, and has the cheapest model take short notes from each part, weighted by the protagonist premise. The notes are brought together into one description, and the Architect works from that, never from the raw book. Text, Markdown and PDF files; a scanned PDF without a text layer is turned away. (As built: section 14, "Milestone 4 so far", Documents.)
- **A description.** Used as written, completed by the Architect.

### 8.8 Templates and stories

A world template is immutable once accepted. Starting a story copies it into the story's own data; from then on only the story changes. Places expanded during a story can optionally be saved back to the template as canon for future stories; that is a later feature.

---

## 9. Memory and knowledge

### 9.1 What is stored

| Record | Content |
|---|---|
| **Entity** | A place, character, faction, item, creature or piece of lore: name, aliases, short card, one-line brief, optional deep text, hidden truth, whether the protagonist has discovered it. |
| **Link** | Typed relation between entities: route, member of, located in, owns, ally, rival. |
| **Event** | Something that happened: when, where, a one or two sentence summary, importance, how public it is. |
| **Participation** | Who acted, who was affected, who witnessed, who was told later. |
| **Relationship** | A character's attitude and trust toward the protagonist, with a one-line reason. |
| **Commitment** | A promise, debt or appointment with a due time. |
| **Clock** | Progress of a front or a character's plan. |
| **Thread** | A quest or open question: status, stage, next step. |
| **Summary** | Per scene, per chapter, and one for the whole story. |
| **Turn** | The player's input, the narration, the Engine's log, the token usage. |

### 9.2 What each character knows

An example. The protagonist steals the baron's seal at night, and only the maid Mira sees it. That is an event with Mira as witness, marked secret. Two days later Mira reports it to Captain Roth: a second event, which records Roth as told about the first. When the protagonist next meets Roth, the code assembling Roth's card finds the theft among the things Roth knows about the protagonist and adds one line: "Knows you stole the baron's seal (told by Mira)." The baron's card says nothing, and the Narrator is told the baron does not know who did it.

- Knowledge is a query: the events a character witnessed or was told about, plus what is common knowledge in their place and faction.
- **News spreads by rule.** Public events become known across a place, then a region, after delays set by their scope. Versions that travel far are flagged as rumor, so the Narrator may distort them.
- **Secrets** are events or facts with an explicit list of who knows.
- Only the handful of entries most relevant to the present moment enter a character's card: recent, important, or matching what is being talked about.
- Nothing has to be rewritten per character when something happens. The Scribe writes one event; everyone's knowledge follows.

### 9.3 What goes into a request

Always: the place card, cards for characters present, the protagonist's sheet summary, active threads, commitments now due, the story summary and the last two scene summaries.

On demand: cards for anyone or anything the player names (matched by alias in code), and up to a few snippets found by text search when the Referee says the player is reaching back ("what did the hermit say about the ruins?").

Never: the full transcript of earlier scenes, the full world, other characters' private knowledge.

### 9.4 The Scribe's job at scene end

From the scene transcript, in one cheap call: the events with their participants and witnesses; new characters, places and items worth keeping; relationship changes; promises made; quest progress; a three-sentence summary; and any contradiction with established facts. The Engine validates what it can (an item with a mechanical bonus cannot simply appear; experience is awarded by rule).

The player sees the same data as a journal and a codex limited to what the protagonist has discovered, and can rewind to an earlier turn, because every turn is stored with the state changes it caused.

---

## 10. The ruleset

The ruleset is called **Penta**, for its five attributes.

### 10.1 What we keep from the source mechanics

- **Five attributes from 0 to 5**: Strength, Skill, Resistance, Armor, Firepower. Zero is an ordinary person. A world can rename them.
- **Hit points and energy points** are each five times Resistance.
- **Tests**: roll one six-sided die at or under the attribute plus a modifier; a 6 always fails.
- **Combat**: attack is Strength or Firepower plus Skill plus a die; defense is Armor plus Skill plus a die; damage is the difference. A 6 on the die doubles Strength, Firepower or Armor.
- **Point-buy characters**: 5, 7, 10 or 12 points by starting power level, spent on attributes, advantages and skills, with extra points from disadvantages up to a limit.
- **Eleven broad skills**, a modest list of advantages and disadvantages, and ancestries as packages.
- **No weapon tables.** A sword, a rifle or a fire breath is flavor on Strength or Firepower. This is what makes the system fit any genre, and it suits a narrator model well.
- **Experience**: 10 experience points buy one character point; experience can also be spent in the moment for an automatic success, a critical hit or a quick recovery.
- **Power scales** in steps of ten, for giants, mecha and gods.

### 10.2 Adjustments for solo, digital play

| Problem in the source | Adjustment |
|---|---|
| Skill does almost everything: attack, defense, initiative and most tests | Let tests use any attribute (an option in the source's own supplement), and have the Referee choose the attribute by what the action is. |
| Pass/fail only | Use the die value on a success as its quality (also a source option), so the Narrator can describe degrees. |
| Enemy strength is defined relative to a party of several heroes | Calibrate encounters for one protagonist by simulation (10.6). |
| A lone hero drops fast: 10 hit points and swingy damage | Defeat is not death by default; the table style sets what defeat means (10.5). |
| Non-combat play is thin | Extended tests (a number of successes before three failures) for chases, investigations and projects; bonds, party and time with characters as a core system (10.7). |

### 10.3 Powers: off, Focus, Extreme, or Gift

A world chooses one of four modes. (Three were planned; Gift was added after milestone 5 and is described at the end of this section.)

**Focus.** Six paths, each rated 0 to 5 and bought like an attribute: Fire, Water, Air, Earth, Light, Dark. Each path is a domain of effects, not only a literal element, and a world renames them:

| Path | Domain | Example reskin in a mecha setting |
|---|---|---|
| Fire | Energy, destruction | Ordnance |
| Water | Healing, body, change | Nanorepair |
| Air | Movement, sound, senses | Thrusters and sensors |
| Earth | Protection, endurance, matter | Plating |
| Light | Perception, illusion, purification | Optics and decoys |
| Dark | Shadow, fear, decay, curses | Electronic warfare |

- Every ability has a tier from 1 to 5 and requires that much Focus in one or more paths. Casting costs energy equal to the tier.
- **Three gates stop a character from simply buying godhood**, which answers your concern about progression:
  1. *Focus.* The story's starting cap on any path (default 3) and the experience cost of raising it.
  2. *Knowledge.* A character starts knowing a few common abilities. Every other ability must be found in the world (a teacher, a book, a technique witnessed), then learned with a test and an experience point. High-tier abilities are rare; who can teach them is a fact of the world.
  3. *Mythic abilities* such as resurrection or a wish need two or three paths at high levels plus a condition set by the story. They are never available at creation.
- **Improvised effects.** The player may describe an effect that is not on their list. The Referee rates its tier from a fixed table; if it is within the character's Focus, the Engine runs a hard test at extra energy cost. A success can be learned permanently for an experience point. This keeps free-text creativity inside the rules.

On the cap of 5: in the *Manual da Magia*, 73 of 184 spells need only Focus 1, and the 22 most powerful need Focus 6 to 10, often in several paths. Since we are writing our own ability list anyway, I recommend designing it for 0 to 5 as you proposed, with the mythic tier gated by multiple paths and story conditions rather than by numbers above 5.

**Extreme.** No Focus. Three broad schools bought as advantages for 2 points each: White (Light), Black (Dark), Elemental (the other four). A character can use any known ability of a school they own if they can pay for it. Costs are fixed and rise steeply with power, and no single use may cost more than five times the character's Skill. The limit is the energy pool, which suits power fantasy.

**Off.** For grounded settings. Progression comes from attributes, skills, advantages, gear and relationships.

Each ability in the library carries both a Focus requirement and an Extreme cost, so one library serves both modes.

**As built (milestone 4).** Abilities are found by being taught or by trying them, then learned for a point of experience and a Skill test. An improvised effect that is not in the library works once and leaves nothing to learn. In the Extreme mode a school is everything in it, with no learning step. Mythic abilities, books and scrolls that teach, and buying a school with experience are not built. See section 14, "Powers in play".

**Gift** (added after milestone 5). For settings where a power is personal: a devil fruit, a quirk. The three modes above all draw on one library of thirty-six abilities in six elemental paths, and a power the player describes in their own words fits none of them: Focus forced it into the elements, Extreme made its owner buy a whole school, and without powers it was dropped as an advantage the game did not know. In a Gift world there are no paths, no library and no schools. A character may have one power of their own:

- **What it is stands in words**: a name, what it covers, and its limit. What it does all the time is simply true in the story, and the narrator plays it. Nothing in those words is a rule.
- **What the rules know** is a rank from 1 to 4, which caps how far any use reaches (the same four reaches as an improvised effect); two kinds of thing it can do in a fight, out of five (damage, guard, stagger, dazzle, heal); and a few signature moves, each a tier and at most one of those kinds. How much a kind does at a tier is one table in code.
- **Three ways of using it.** A move costs energy equal to its tier and needs no test of its own. Anything else the power could do is tried: one energy more, a medium Skill test, never beyond the rank. Beyond the rank it is refused.
- **It grows in play.** The rank is raised with experience. A new use that worked can be kept as a move for a point of experience: this is where the plan's "a success can be learned permanently" finally holds, because here there is something to keep that no model made up (decision 73).
- **Other people have them too**: one simple power for a named person, used in a fight with their attack.

**Powers that come and go** (added after Gift). A hero may hold up to four powers: their own (or one eaten from an item of power), disciplines the world has and people teach, the power of an item they carry, and someone else's power copied or taken for a scene. People's powers can seal the hero's for a turn, or take one if the hero loses a fight to them. See section 14, "After milestone 5: powers that come and go".

The numbers are in 10.9 and how it was built is in section 14, "After milestone 5: Gift".

### 10.4 Progression

- Experience is awarded by rule at the end of scenes and chapters: surviving, reaching goals, defeating worthy opponents, playing to the character's nature. The Engine computes it; the Narrator cannot hand it out.
- Raising an attribute or a Focus costs 10 experience per level up to 5. Advantages cost 10 per point.
- Learning an ability costs 1 experience point and needs a source in the world.
- A setting switches between flat costs (faster, for power fantasy) and rising costs (slower).

### 10.5 Challenge: table styles

Dice are always real, rolled by code, and visible in a roll log. What changes is the set of rules around them.

| | **Story** (cozy, power fantasy) | **Adventure** (default) | **Brutal** |
|---|---|---|---|
| Defeat at 0 hit points | A setback: captured, robbed, delayed | A death test, softened once per chapter | Death test as written; death is permanent |
| Destiny points (reroll, recover, edit a detail) | Several per scene | A few per chapter | None |
| Encounters tuned to a win chance of | 90% or more | 65–85% | 40–70% |
| Failure on a test | Success at a cost | Failure with a way forward | Failure |
| Rolls requested | Only at dramatic moments | When uncertain and interesting | More often |
| Rewind a turn | Free | Free | Disabled |

- **Destiny points** come from the source's supplement, where a point buys a reroll, a full recovery or a small edit to the scene. They are the honest version of the game master cheating for the player: the help exists, the player sees it and chooses when to use it.
- The source's own game-master chapter describes both habits, rolling behind a screen to protect the story and rolling in the open for tension. The styles above make that an explicit choice.
- Individual settings (lethality, enemy strength, roll frequency, hints) can be adjusted separately.

### 10.6 Encounters calibrated by simulation

Before a fight starts, the Engine simulates it a few thousand times with the actual sheets, which takes milliseconds and no tokens. If the win chance is outside the band for the table style, the Engine adjusts the opposition (numbers, a stat, an escape route) before the Narrator describes anything. The same simulator is a development tool for balancing the ability library.

### 10.7 Social play: bonds, party and time with characters

Romance, friendship, companions and socializing are core to the app, not an add-on. The player should always be able to spend more time with the characters they like most.

#### What a bond is

**Bond** is a number from 0 to 100, kept per character. It measures how much trust and shared history exist between that character and the protagonist: in practice, how much the character would do for them. Two other things sit beside it and are deliberately separate:

- **Attitude** is how the character feels about the protagonist right now, as a word or two with a reason: wary, grateful, furious. It can change within a scene. Bond cannot swing that fast.
- **Kind** is what sort of relationship this is. Friendship is the default; romance, mentorship, rivalry and kinship are the others. Kind changes which scenes come up and how the stages are worded, not the arithmetic.

There is no negative bond. An enemy is a character with no bond, a hostile attitude and open grievances.

#### Stages

Every 20 points is a stage, and each stage changes what the character will do.

| Bond | Stage | The character will |
|---|---|---|
| 0 | No bond yet | Treat the protagonist as a stranger |
| 1–19 | Acquaintance | Remember them, talk freely, help for a price |
| 20–39 | Friendly | Do favors, pass on what they hear, join for a single task |
| 40–59 | Trusted | Join the party, talk about their past, warn of danger |
| 60–79 | Close | Open a personal quest, help in tests once per scene, confide secrets |
| 80–100 | Devoted | Take serious risks, act as one with the protagonist in a crisis, resist being turned |

Reaching a stage queues **a moment** with that character: a scene in which they open up, ask something, or mark the change. It comes about in the story, when the player gives that character time and attention somewhere quiet: the narrator is told the moment is waiting, lets it happen when the scene allows, and reports that it did. There is no button for it. Every stage therefore becomes a piece of story, and the player is drawn back to the characters they are growing close to.

#### Gaining and losing bond

The size of a change follows how much the act mattered. The Scribe, or the Narrator's flags for the current turn, names the act and its tier; the Engine sets the number.

| Tier | Examples | Bond |
|---|---|---|
| Small | A courtesy, a shared joke, remembering a detail | +1 |
| Meaningful | A real favor, a thoughtful gift, an evening together | +3 to +5 |
| Significant | Keeping a hard promise, standing up for them, trusting them when it was risky | +8 to +12 |
| Major | Facing danger for them, sharing a secret, choosing them over a gain | +15 to +20 |
| Defining | Saving their life, a great sacrifice | +25 to +30 |

Losses cost more than the matching gain: a slight −2 to −5, a broken promise or a lie found out −10 to −15, a betrayal −25 to −40.

Rules that keep the number honest:

- **Values.** Each character has two or three things they care about, such as loyalty, honesty, courage or cleverness. An act that touches one counts for half as much again, and an act that offends one loses bond even if it was meant kindly. The same lie can please one companion and trouble another. Values are discovered through play and then shown on the profile.
- **No farming.** Small and Meaningful gains with one character are capped per game day, and repeating the same gesture is worth less each time. Most of a bond comes from a few acts that mattered.
- **Grievances.** A serious wrong leaves an open grievance. Until it is dealt with through an apology, amends or a hard conversation, gains are halved and the next stage is out of reach. A repaired grievance can leave the bond stronger than before.
- **Every change has a memory.** No bond changes without an event record behind it, so the profile can always say why.
- **No decay in version 1.** Time apart does not erode a bond. A table setting can add gentle decay later.

#### Around the bond

- **Party.** Companions travel with the protagonist, act in combat as allies under Engine control, comment during scenes and have goals of their own. Party size is a table setting.
- **Favorites.** The player can pin characters. Pinned characters get more screen time, and the app offers ways to reach them: visit, send word, invite along.
- **Time together.** Time alone with a character (a meal, a walk, training, a festival) is something the player asks for in their own words, in the story. It is worth a Meaningful gain when it mattered to that person, and it is where waiting moments play and personal stories unfold. The first prototype had a "Spend time together" button; it was removed after the first playtest because a button could not say what it was about to do, and the player read it differently from what happened.
- **Speaking to one person.** On the play screen the player can direct what they say to one character present.
- **Romance** is a kind of bond, opt-in per story through the tone settings. The player signals interest; whether a character returns it depends on that character, because the Architect decides who is open to it. Not everyone falls for the protagonist. It is never available with characters who are minors, and it stays within the content rules in section 12.
- **Reputation** per faction and **commitments** with due dates give social play consequences that the world remembers.

#### Memories on a character's profile

A long story produces hundreds of shared memories, so the profile does not list them all.

- **Moments that mattered.** The three with the largest effect on the bond, each with what it was worth and when. Stage moments are always among them.
- **The rest rolled up** into one line, such as "and 14 smaller moments", which opens the full history grouped by chapter.
- **Pinned by the player.** Up to three memories the player wants to keep in view.
- **Merged over time.** At the end of each chapter the Scribe folds small memories with one character into a single line ("you often shared the night watch").

These come straight from the event log (9.2), so they are always consistent with what happened.

Cost: the Narrator receives the same short set for a character in the scene (stage, attitude, kind, values, the one-line summary, the moments that mattered and any open grievance), about 60 tokens. A pinned character who is absent adds nothing to a request until the player reaches for them.

For stories with little fighting:

- **Extended tests** structure heists, investigations, journeys, crafting and performances.
- **Renamed conflict.** A debate, a concert or a cooking contest can run on the combat rules with attributes renamed for the occasion, as the source's supplement demonstrates.

### 10.8 Content packs and reskinning

The app ships a **base pack**, written by us:

- attributes, the test ladder and the combat procedure (in code);
- about 30 advantages and 20 disadvantages to start, each with a cost and an effect the Engine understands;
- 11 skills with specializations;
- ancestry building blocks;
- about 60 abilities across the six paths and five tiers, each built from **effect primitives** the Engine implements: damage, heal, strengthen or weaken, barrier, condition with a resistance test, summon, movement, sense, conceal, transform, and "narrative" for effects with no numbers;
- items as consumables, enhancements and narrative gear;
- creature templates by threat level with a vocabulary of special abilities;
- character archetypes and common non-player templates;
- a small sample fantasy world for the prototype.

A **world pack**, generated at world creation, is a thin layer over it:

- the rules profile (8.5);
- a rename-and-describe map: base item → this world's name and one line of flavor;
- which base items exist in this world;
- a few world-specific ancestries and signature abilities composed from the primitives, each checked by code against a cost formula.

Claude writes names and flavor, a few thousand tokens per world, and the mechanics stay tested. More entries are added on demand, for example when the protagonist finds a teacher.

### 10.9 Numbers the mockups assume

The screens needed concrete numbers that sections 10.1 to 10.4 had left open. These are what the mockups show. They are working assumptions, to be confirmed or changed before the Engine is written:

- **Starting power levels**: Novice 5 points, Seasoned 7, Champion 10, Legend 12. Disadvantages give back at most 3, 4, 5 and 6 points.
- **Costs at creation**: an attribute or a path level costs 1 point; a skill costs 2; advantages cost 1 or 2; an ancestry costs 0 or more.
- **Tests with the matching skill**: Easy succeeds without a roll; Medium is the attribute plus 1; Hard is the attribute minus 2. Without the skill the mockups show Medium as the attribute minus 1. The number rolled on a success is its quality.
- **Initiative**: Skill plus a die, plus 1 with the Quick Reflexes advantage.
- **Destiny points** under the Adventure style: 3 per chapter, restored when a chapter begins.
- **Learning a found ability**: 1 experience and a Skill test; on a failure the experience is spent and the ability stays found.
- **At 0 hit points** under the Adventure style: the player chooses between spending a destiny point (back up with 5 hit points) and the death test.
- **A chapter** ends at a scene end once a main thread was finished in it, or after 12 scenes or 90 turns; never before 3 scenes.
- **News**: local talk reaches its settlement after 6 hours; public news reaches its settlement after 6 hours and the rest of the country after 3 days.
- **Advantages and drawbacks**: twenty of each, costing or giving back 1 or 2 points. Six advantages and one drawback change a number by themselves (Quick Reflexes, Tough, Deep Reserves, Keen Senses, Iron Will, Fast Healer; Frail); the rest are played by the narrator. An ancestry is a package of at most four of them and costs at most 3 points.
- **Abilities**: thirty-six, six to a path, in tiers 1 to 4; using one costs energy equal to its tier. A new character may know one for each level in a path, of tier 2 at most; the others have to be found in the story.
- **How able someone is in a fight**, in the words the world builder uses, and the numbers the rules give them (Strength, Skill, Armor, hit points): weak 1, 2, 0, 5; able 2, 2, 1, 10; dangerous 3, 3, 2, 15. Someone who fights at range has that Strength as Firepower, and one less Strength.
- **What a new character carries**: 30 silver (300 with Wealth, 5 with Poor); what the proposal lists, as plain gear; and bandages that restore 5 hit points: two in the Story style, one in Adventure, none in Brutal.
- **Destiny points a chapter**, by table style: 5, 3, 0.
- **Powers in play, Focus**: using a learned ability costs energy equal to its tier. Trying one that is not learned, with the path high enough, costs one energy more and is a hard Skill test; a success finds it. An effect of the player's own costs its reach plus one and is a hard Skill test. Someone teaches an ability of tier 1, 2, 3 or 4 to a person they know as Acquaintance, Friendly, Trusted or Close; a mentor, one stage sooner. Learning costs 1 experience and a Skill test: easy if someone showed how, medium if it was worked out alone. A dabbler can teach tier 1, an adept up to tier 2, a master everything.
- **Powers in play, Extreme**: a school costs 2 points and is every ability of its paths. A use costs 1, 3, 6 or 10 energy by tier, and never more than five times Skill. An effect of the player's own costs the same and is a medium Skill test.
- **Powers in play, Gift**: the rank costs 1 point a level, 3 at most at the start and 4 in play; raising it costs 10 experience. A new character has at most one move for each rank, none above tier 2; in play a power holds two moves for each rank. A move costs energy equal to its tier. A new use costs its reach plus one and is a medium Skill test; one that worked is kept as a move for 1 experience, at the tier it was rated or lower, and three wait at most. A power has two of the five kinds of fight effect. By tier 1 to 4: damage 2, 4, 6, 8 (no defence roll; a raised guard takes off it); heal 3, 5, 8, 10; guard +2, +3, +4, +6; dazzle 2, 3, 4, 5; a stagger takes tier 2. Awakening a power in play costs 10 experience and starts at rank 1 with no moves.
- **A power of someone else's** (Gift worlds): one kind out of damage, guard, stagger, dazzle, seal and steal, at tier 1 whatever the person's strength in a fight; a weak fighter's cannot stagger. It is used on their first turn and on every third after it, together with their attack, except that a stagger, a seal or a steal is the whole of that turn. A seal (and a thief's grip) stops the protagonist's powers for their next turn. Its rank, which counts only when someone else holds it, is 1, 2 or 3 for a weak, able or dangerous fighter. Groups have none.
- **Powers that come and go** (Gift worlds):
  - **Limits.** Four powers in use at most, and eight moves of one's own in all (a borrowed power's one aside).
  - **A discipline.** It is taught as a tier-3 ability would be (Trusted, or Friendly for a mentor) and learned for 10 experience, at rank 1 with its first move. One that is not taught awakens for 10, only in the scene in which the hero was brought down in a fight or in the next.
  - **Items of power.** Up to two in a world. One that is eaten gives its power for good, at rank 1; one that is carried gives it while held, at rank 1 or 2. Someone carrying one gives it to a person they count Close.
  - **A copy or a steal** is a new use: its reach plus one in energy, and a medium test. It holds the power until the scene ends, at the lower of the reach and the person's rank.
- **In a fight, in every mode**: nobody is made to lose an action twice running. The protagonist attacks with Firepower when it is higher than their Strength. An effect of the player's own, typed during a fight, costs what it does outside one and is a plain Skill roll (no table style softens it); if it passes it does what its reach does in a fight, by the table above. The encounter tuner plays the protagonist with the hardest-hitting power they have energy for.
- **The world moving**: a front moves one stage a chapter. Inside a chapter it is due 3 days after it last moved (4 and 5 days for the second and third front, so that they do not move together) and then moves on a die of 4 or less, else waits a day; at a chapter's end what has not moved in it moves without a roll, if a day has passed. Set back by the protagonist, it waits 3 days and that chapter. Its news is talked about for 10 days.
- **Filling in a place**: one request the first time a story arrives, about 2,200 tokens read and 1,300 written: by list price about $0.045 with Opus 5.5, $0.02 with Sonnet 5.5, under a tenth of a cent with Haiku 5.5. About three to five turns' worth, once for each place visited.
- **Building a world**: seven requests and about 7,000 tokens written. By list price that is about $0.31 with Opus 5.5, $0.12 with Sonnet 5.5 and under one cent with Haiku 5.5, shown to the player as a range (70% to 140% of it) before anything is spent. A proposed character is one more request of about a cent.

### 10.10 Engine scope for version 1

In: character creation and validation, tests with difficulty ladder and quality, skills, combat with initiative, dodge, criticals and a few maneuvers, conditions, energy and abilities through primitives, death tests, rest and recovery, experience, destiny points, extended tests, travel and time, clocks, simple money, party companions, bonds.

Later: power scales and mecha, mass combat, item crafting, the long tail of advantages, alternative dice systems.

---

## 11. Player experience and screens

### Flow

Open the app → enter a key (first run) → Continue a story or start a new one → choose a world or create one → creation steps (8.6) → character → play.

During play, long passages arrive as beats. While unread beats remain, the input box is replaced by a Continue button; pressing it shows the next beat already on the device.

### Screen inventory for the mockups

All of these are drawn, for phone and PC, in `docs/mockups/slate/`. Open `docs/mockups/slate/index.html` to browse them; `docs/mockups/README.md` lists every file and state.

1. **Welcome and key setup**: enter the key, choose language, set a spending cap, pick a model preset.
2. **Home**: story cards (last played, turns, cost so far), Continue, New story.
3. **World picker**: saved world templates, Create new.
4. **World creation**: source (describe, known universe, document) → protagonist premise → table settings → questions from the Architect → progress with running cost → world overview with accept, edit, regenerate.
5. **Character creation**: proposed sheet, point-buy editor (attributes, ancestry, advantages, disadvantages, skills, paths and abilities), live validation.
6. **Play**: story log, input or Continue, suggested actions (optional), dice results, status strip (hit points, energy, place, time), characters present and party with bond levels, a way to speak to one person, cost meter.
7. **Play panels**: people (bonds, favorites, shared memories), party, character sheet, inventory, journal and quests, codex (places and lore discovered), map, roll log.
8. **Combat**: action buttons, opponents described by condition rather than numbers, round log.
9. **Advancement**: spend experience, learn an ability.
10. **Chapter recap**: "previously", shown when returning to a story.
11. **Story management**: rename, duplicate, export, import, delete, rewind.
12. **Settings**: key, models per role, narration length, thinking effort, budgets, language, theme, data.
13. **Usage**: spending by story, by day, by role.
14. **States**: offline, API error, rate limit, refusal, budget reached.

Layouts: on a phone, panels are bottom sheets and tabs; on a PC, the log sits in the center with panels docked at the sides.

### Rules for crowded screens

Three places where the mockups showed a comfortable case and the real app must handle any number:

- **Map levels are a path, not tabs.** Places form a tree of any depth, so the level control is a row showing the chain from the top level to the one in view ("The Lantern Coast › Port Varn › Guild House"), with an Up button in front and "Look inside" on places that contain others. The row scrolls sideways and keeps the current level in view. It works the same at two levels or six.
- **The people strip is one row, always.** Party members always show. People in the scene fill the next five places; the rest wait behind a "+N" entry and the "All" button, which opens the full panel. Unnamed people of one kind are a single entry with a count ("Watchmen ×2", "Market crowd ×12"), on screen and in what is sent to the narrator, where a crowd costs one short line instead of twelve cards. In the panel a group of more than four rows shows four and "Show N more".
- **A fight stays the same size however many are fighting.** Identical minor opponents fight as one group: one turn, one roll with a small bonus for numbers, a shared pool of hit points, members dropping as it empties. The target row shows the opponents still standing, scrolls sideways past two, and has an "All N" list behind it past three. Each round is told in two to four sentences whatever the number of fighters, so the cost of a round does not grow with the crowd either.

### After the first playtest

The project owner played the prototype with a real key and reported seven problems. What changed, and the rule behind each change:

- **The player must never have to guess what happened.** The narrator had written "the way she weighs a shot before loosing, and decides to put down less than she is carrying", meaning only that a companion was holding something back. Each story now has a **writing style**: Plain, Clear (the default) or Literary. In every style the narrator's instructions say that whatever the player needs in order to decide what to do next is stated literally, and that a figure of speech is followed by the plain fact.
- **Asking the narrator, out of the story.** "To" in the input now ends with **The narrator**. What is sent that way is never said or done in the story: no time passes, nothing is rolled, nobody hears it. It is for "what did you mean?", for a rule, for how to use the app. A line that starts with `//` does the same from anywhere, and the Referee routes obvious questions there even when they were typed into the story. The question and its answer are shown in the log in gold with a dashed outline, so they cannot be mistaken for the story. What it costs is in 7.3.
- **The game asks when it is unsure** (section 6, "One turn"). The question is shown before anything happens, with two or three answers to tap; the player's first text waits, unsent, and can be taken back.
- **No "Spend time together" button** (10.7).
- **Where the new text starts.** Continue draws a thin line above the passage it reveals, brings that line to the top of the view with a smooth scroll, and lets the new passage arrive beat by beat. The view is held to the start of the newest thing (that line, or the player's last action), never thrown to the end of a long passage.
- **Continue is hard to miss.** A light sweeps across the button, its arrow nudges forward, and a ring breathes out from it. A small cue also sits under the last line read, where the eyes are.
- **A gesture inside a spoken line** ("I'd have done the same." A dry breath, almost a laugh. "That's why I believe you.") is set apart from the spoken words: serif, italic, quieter, with a trace of the speaker's colour.
- **Motion everywhere, with one switch.** Buttons, sheets, pages, dice, meters and the story log all move; Settings has Animations: Auto, On or Off, and Auto follows the device's reduced-motion setting. Nothing that moves delays reading.
- **Colour themes.** About twenty, solid and gradient, dark and light, plus one of the player's own from any colours. Every theme is derived from one or two colours by code that keeps text contrast above fixed thresholds, which is checked by tests for every preset and for hostile custom colours. A theme may carry its own accent; otherwise the story's colour is used. Optional moving backdrops (a slow glow, drifting embers) sit behind the app.

### After the second playtest

Five more reports from the project owner, and what changed:

- **The view follows what has just appeared, and no further.** The first results of an action (the dice, the first passage) arrived below the fold, because the log was scrolled to its end before they existed; the die rolled unseen. Now the view glides along as they arrive, exactly as it does after Continue: only as far as it takes to show the new text, and never past the point where the player's action reaches the top. A turn that fits on screen is shown with the text before it still in sight; a longer one starts at the top and runs on below. No empty space is made to do this (a first version put the action at the top with blank room under it, and the owner rejected it as too much movement). Once the reader scrolls by hand, the view is theirs until the next thing begins.
- **Text arrives in whole passages, never letter by letter.** The first passage after an action used to be typed out as the narrator wrote it, which kept the view moving line by line, while every later passage arrived at once on Continue. Now the first passage is held back until its last paragraph is complete and then arrives the same way: at once, fading in, with one glide of the view. So a turn changes the screen three times (the action, the dice, the passage) and no more. An answer to a question outside the story arrives whole as well. The turn in flight is drawn by the same code and as the same elements as the finished turn, so nothing is redrawn, and no die rolls twice, when the reply completes.
- **Travel is the character asking to leave** (section 6, "One turn"). Pressing "Travel there" in the middle of an interrogation used to end the scene with no word and no consequence. The same hole existed for typed travel; both now go through the same judgement. The scribe is also told how a scene ended when the leaving is not in its transcript, so that walking out on someone can be remembered.
- **Every trait says what it does.** On the character sheet each skill shows what it covers, and each advantage and disadvantage shows one line and opens to say what it does in play and who applies it: the rules, with a number, or the narrator, in the story. Writing these showed that most of the sample character's traits did nothing at all: they were never sent to the narrator. They are now on the YOU line of the scene packet (the ones the rules already apply are left out), with one sentence in the narrator's instructions: a drawback is pressure from the world or a temptation, never a choice made for the player.
- **Places on the map answer to the pointer.** The node grows inside a soft ring, its name brightens, the way there from where the character stands is traced, and its row in the list lights up; pointing at a row does the same to the drawing, which is how a numbered node is found on a crowded map. A finger has no hover, so on a phone nothing sticks.
- **Instructions are not written around one example.** The help under "Writing style", and the narrator's instruction behind it, had been worded around the single passage that prompted them ("what people are holding back"). Both now state the general rule: what happened, and what the player needs to know to choose a next move, is said plainly.

Language: interface in English and Brazilian Portuguese from the start. The story language is chosen per story.

---

## 12. Data, security, privacy and content

- **Everything stays on the device.** Stories, worlds and settings are in the browser's storage. The only network destination is the Claude API. No analytics.
- **Saves.** A story is kept as its present state (with the transcripts of its last two scenes), written after every turn, and the transcript of each older scene, written once when the scene ends; both go to storage together, in one transaction. So a turn writes about the same amount however long the story is, and only two scenes are ever held in memory. Every turn carries a small record of what it changed, written backwards, which is what rewinding is made of. For export and import a story is one file, complete in itself; this is also how a story moves between PC and phone. The format carries a version number: a story from an older version is brought up to date when the app first opens it, and a file from a newer version, or one that is damaged, is refused with the reason. A save that does not go through is said on every screen, with a button to export the story.
- **Key handling.** As in section 5. The key is never written to exports or logs.
- **Content.** The app inherits Anthropic's usage policies and cannot loosen them. At story creation the player sets tone preferences (violence level, how romance is handled) to steer the Narrator. The current models can decline a request with an explicit refusal result; the app shows a neutral message and lets the player rephrase, and never tries to work around a refusal.
- **Rate limits.** New API accounts have low limits. Creation steps run one after another with backoff. Cached input does not count against the input limit on most models.
- **Model changes.** Model identifiers and prices live in a configuration file, not in code.

---

## 13. Code structure and testing

```
packages/
  engine/    rules, dice with a seedable generator, characters, combat, abilities,
             clocks, travel, encounter simulator — pure TypeScript, no browser APIs
  game/      world model, event log, knowledge queries, retrieval, card rendering,
             context assembly, pipelines (turn, scene end, world creation, ingestion),
             Claude client wrapper (roles, schemas, streaming, usage accounting, budgets)
  app/       React interface, storage adapter, platform services (key storage, files)
  packs/     base pack (EN and PT) and the sample world
  tools/     headless simulator, playtest harness, cost reports
```

`engine` and `game` run without a browser, which allows:

- **Unit tests** for every rule, with fixed dice.
- **Balance simulations** from the command line.
- **Headless playtests**: a script plays a story with a cheap model standing in for the player, records token usage, and checks invariants: packet size within budget, cache hit rate above a threshold, no narration contradicting an Engine result, a character correctly recalling an event from earlier scenes.
- **A mock Claude client** with recorded responses for interface work and automated tests, so contributors spend nothing.

---

## 14. Roadmap

| Milestone | Content | Done when |
|---|---|---|
| **0. Plan and mockups** | This document; the play screen in several design directions; then every screen in the chosen direction, for phone and PC. All drawn: 17 screens, 53 states | You approve both |
| **1. Play loop** | Engine core; hand-made sample world with a companion; Referee → Engine → Narrator; Scribe; bonds on the play screen; cost meter; mock client. **Built** (see "Milestone 1 as built" below) | Fifty turns playable; cost per turn and cache hit rate measured against section 7; a character recalls an event from three scenes back |
| **2. Memory and saves** | Saves that do not grow with the story, rewind, story management, export and import that can be trusted (**built**, see "Milestone 2 so far"). Then memory that holds up over a long story: chapters with summaries that are never rewritten, who was told what, which memories reach a person's card; the codex; the recap | Over 300 headless turns: what is sent, held in memory and written per turn does not grow; every turn can be taken back exactly; a story rewound, exported or upgraded is the same story (**met**). And: a character recalls the right thing thirty scenes later, and does not know what nobody told them (to do) |
| **3. Worlds and characters** | The rules for making a character; the world builder; a character proposed from the premise; a story begun in a built world; the worlds library, the new-world screen and the character screen; sketched places filled in when a story first goes there (**built**, see "Milestone 3 as built") | Whatever the model returns, the world that is kept passes the same check as the hand-made one, and a build that is paused, cut off, refused or stopped by the daily limit goes on without paying twice for a step (**met**, with the demo builder). And: a world is created end to end at phone size, including an interrupted and resumed run, and a story is begun in it (**met** in a real browser with real storage and the demo builder; not yet on a real phone or with a real key). And: a place that is filled in stays as written through rewinds and failed turns, and is never paid for twice (**met**) |
| **4. Depth** | What the first three milestones left: (a) the world moves: what is in motion advances, becomes news and can be held back (**built**, see "Milestone 4 so far"); (b) powers in play: abilities attempted, taught and learned, effects of the player's own, the Extreme mode (**built**); (c) a document as the source of a world (**built**); (d) company (joining, parting, grievances), people who move, leave and tell each other things, situations that end by themselves, personal quests, a character of your own in the sample world (**built**). (The map, the table styles, the combat interface and the encounter simulator, once listed here, were built in milestone 1.) | For the code: over a long story the world moves once a chapter, never past its end, the same way again after a rewind, and what is sent stays within its size (**met** for (a)); every way of using a power is decided by the rules, costs what the rules say, and is taken back whole by a rewind (**met** for (b)). For the player: three contrasting stories (brutal, power fantasy, cozy) played with a real key |
| **5. Release** | Install flow, both languages, documentation, license review, optional Android wrapper (**prepared**, see "Milestone 5 as prepared": everything short of publishing) | Public repository and hosted build (the project owner's to do) |

Milestone 1 is deliberately the riskiest part first. If the play loop is not fun and cheap on a hand-made world, the world builder does not matter.

### After milestone 5: the owner's first look at the nine

The project owner tried the nine on 2026-11-19 and asked for eight changes, all built the same day. Decisions 97 to 102; 89 and 93 are replaced.

- **The pencil of Another take did nothing.** Its dialog was drawn inside the small bar under the turn, which holds anything placed in it, so it opened as a box of a few pixels. Every dialog is now drawn over the whole screen, wherever it is opened from (`ui.tsx`, `Modal`), which also mends the Give up dialog of an effort under way.
- **Time off is gone** (decision 97). The owner's reasons: a screen of its own adds edge cases (farming experience, pressing it in the middle of a fight or of a scene that matters), and the player should simply say what they do. Now a wait is said in the story. The referee reads it as a rest with how long it would likely take, days if it is days, and "impossible" while the character is in danger, held or chased. Up to half a day simply passes, as before. Anything longer is asked about first, by the game and for nothing ("That could mean 3 days here. Let the time pass?", with Let the time pass and Not yet); the yes goes ahead without asking the referee again, and an answer typed by the player is never questioned again. The narrator is told it may take up to that long and must end the wait when something the story set up comes sooner (an arrival, a deadline, an attack announced, a promise falling due), and says in `time:` how long it really took; the engine holds it to what was agreed (all of it when the narrator says nothing). The protagonist recovers for the time that passed, a stay of three days or more moves the world on once more, and a day or more ends the scene. No pay, training or living costs by rule: the story tells what happens. A fight or an effort under way refuses it in one line. Two weeks at most.
- **The two ways to read the story** in the journal are buttons in the accent colour, side by side.
- **Keep this as true explains itself**: a few lines at the top of the sheet say why it exists (over a long story the narrator sees old events only as a summary, so details drift) and what keeping does. The sheet for a correction says what it is for too.
- **A description as long as the player likes** (decision 102): the world's up to 12,000 characters (about 2,000 words), who you play up to 4,000, in world files as well. They are read only while the world is built, from the cache after the first step, and never on a turn.
- **Pictures are for companions only** (decision 98). The world's description and who you play no longer take a picture, and neither does the hero's own appearance. When a story begins, a new **Who travels with you** part of the character screen lists the companions who start at the hero's side; each opens to its look, its appearance and who they are, with Describe from a picture. A companion's profile has a pencil that opens the same fields during the story (decision 99): kept between turns (a rewind takes it back) and told to the narrator once. The picture's answer is two lines, a look and a description, cut at the end of a sentence or a word, never with an ellipsis (it was cut at 420 characters with one before). The caption is now optional: the game already knows who it is.
- **Plain by default** (decision 101) for new worlds and stories, and for a world file that does not say.
- **Openings that orient** (decision 100). A story's first scene begins with a short introduction, each part a short passage: who the protagonist is and the life they lead there, where they are, why they are there today, why the companions are with them, and then what just happened; only then is it the player's move. The builder's opening line is now three sentences, the first of them what brought the protagonist there.

**Tested**: 836 in all (`tests/features.test.ts` has 29): a wait asked about for nothing, given back on Not yet, told on yes without the referee, rested, ending the scene; a wait ended early by the narrator and held to what was agreed; a short rest that simply happens, a wait held to two weeks, an answer never questioned again; a wait refused while an effort is under way; companions described before a story begins, with the world in the library unchanged; a companion described on the profile and told once; a picture's two lines; the opening's introduction.

**Checked** in the demo at 412 by 687: the note dialog of Another take; a wait of three days asked about and told; the journal's two buttons; the Keep this sheet; the story menu without Time off; the new-world description without a picture; Who travels with you, closed and opened, with a picture made smaller and put into words; a story begun with a companion described; a profile's pencil.

**Not checked: the live models.** Whether the referee gives a fair number of days for "until someone comes", whether the narrator ends a wait early when the story set something up, how Haiku answers a picture in two lines, and how the real opening reads.

### After milestone 5: money, looks, and the shape of a story

Nine things asked for by the project owner on 2026-11-19, after a review in which each was argued for or against: pictures as references, money that moves (with several moneys), another take, keeping a line as true or correcting it, efforts that add up, time off that respects what the story set up, stories that end, the story as a book, and a start for an empty page. The owner's rule for all of them: fewer tokens, and a memory that holds over a long story. Decisions 86 to 96.

**Money that moves** (`src/game/money.ts`, `session.ts`, `cards.ts`, `llm/prompts.ts`, `llm/schemas.ts`).
- **What was wrong.** A purse existed (30 silver, 300 with Wealth, 5 with Poor) but nothing in play changed it, the narrator was never told it, and it was "silver" in every world. Things carried were the same: used up, never gained. The sample world's own situation (Lise needs forty silver) could not be paid.
- **The world's money.** The rules step of the builder names up to three moneys, each placed on a scale of worth (tiny, small, common, large, great: a meal costs hundreds, a score, a couple, a fraction, a sliver). A coin can be "of" another (a copper of the mark, a knut of the galleon): coins of one money pay for each other as change would; separate moneys (a guild's scrip) do not, and are changed at a money changer's tenth. An empty list is a world without money. A world built before this has silver.
- **Prices are words.** The referee classifies a purchase, sale, gift or exchange as kind `trade` and puts a price word on it (trivial, cheap, fair, costly, dear, fortune). The rules turn it into an amount in that money: 1, 2, 10, 50, 250 and 2,500 common coins. A friend asks four fifths, a close one three fifths. A haggle is a test: a success takes three tenths off, a failure means no sale yet. What cannot be paid is refused in one line and no model is asked. A thing sells for half. In the Story style a trivial or cheap cost is not counted.
- **The narrator reports the rest** in its facts: `paid:` and `spent:` with a price word, for money that changes hands outside a trade (wages, loot, a toll, a thief), and `gained:` and `lost:` for things. A fortune is paid only in a reply that finishes a thread; otherwise it counts as dear. Two of each a reply at most. An item of power is never lost by a line of the telling.
- **What it costs.** The purse and what is carried are on the YOU line, each with a budget of its own, quest things first and "and N more" past the budget: about 25 tokens. The contract grew by about 150 tokens, and stays under the 2,500 the test allows.

**Looks, and pictures as references** (`types.ts`, `cards.ts`, `builder.ts`, `expand.ts`, `creation.ts`, `components/Picture.tsx`, `llm/requests.ts`).
- **Appearance and personality are kept apart.** A person's card stays who they are and how they talk; `look` is a few words (90 characters) and `appearance` a few sentences (320). The narrator gets the full appearance the first time the protagonist meets someone, and in the story's first scene for the protagonist; after that only the look, with a budget of its own so that it never cuts the personality short. The scribe may change a look at a scene's end when the transcript shows a lasting change (a scar, a lost hat); the change heads the full description with its day. Personality is never rewritten by a model.
- **Pictures are references, never kept** (the owner's rule). On the new-world screen (the description, and who you play) and the character screen, a picture is made smaller on the device (768 pixels on its longest side, about 800 tokens), captioned by the player, and read once by the scribe's model. The words come back into the field, where the player can change them; the picture is forgotten. The builder only ever reads text, so building a step again, or resuming a paused build, needs no picture. The caption wins where the two disagree, a real person is never identified, and text in a picture is part of the picture.
- **The builder** writes a look for everyone named, and an appearance for those at the protagonist's side or described by the player, keeping to the player's words. The character proposal writes both for the protagonist.

**Another take** (`session.ts`, `components/Tools.tsx`).
- The newest turn can be told again: the same action, the same dice, the same results, a new telling, at the price of one narrator request that reads the scene from the cache. The referee is not asked again. The player may add a note on how it should be told; it is sent once and never kept in the transcript.
- **How.** Each turn keeps what the narrator's facts changed, written backwards (`flagsUndo`), and how many of its beats were the engine's (`prep`). Another take takes the facts off, asks the narrator, and keeps the new telling as the turn. Every telling is kept on the turn (`takes`), and going back to an earlier one asks for nothing. If a new take fails and is given up, the turn is as it was.
- **When.** Only the newest turn of the scene being played, and only while nothing has changed between turns since; a take that ends the scene ends it. Under the Brutal style, once a scene. The daily cap on small bond gains limits fishing for a better one.

**Keep this, and That's wrong** (`session.ts`, `cards.ts`, `components/Tools.tsx`, `PlayLog.tsx`).
- Pressing a passage in the log offers both. What is kept is a fact about the story, the place, or someone in the scene, in the player's words (160 characters at most; four about one person or place, six about the story). It goes on that card from then on with a budget of its own, and the narrator is told at the next action, once. A correction is the same, and the scribe is also told what was corrected in the scene, so its records follow the correction and not the telling.
- They are kept between turns, so a rewind takes them back. They are listed, and can be let go, on the person's profile, in the codex for places, and in the journal.

**Efforts that add up** (`session.ts`, `types.ts`, `components/Tools.tsx`). The extended tests of 10.2, in scope since the plan and never built. When an action starts something that takes several efforts and can be lost along the way (a chase, a search, a heist, a debate), the referee names it and gives its first check. Three successes win a short one and five a long one; three failures lose it (four in the Story style). Each later effort is a check marked by the referee as part of it. The narrator is told how far it has got and when it is decided; a contest won counts as a fight won for experience. One at a time, shown as a track above the input with Give up. It lapses at a chapter's end and blocks time off.

**Time off** (`session.ts`, `llm/requests.ts`, `components/Tools.tsx`).
- One, three, seven or fourteen days at once: rest, work for pay (a Skill test; half a fair price a day, half that on a failure), train (a point of experience every two days, three a chapter), or look into an open thread (a test; on a success the narrator gives a real clue). Board and bed cost a cheap price a day except in the Story style.
- **What the story set up comes first** (the owner's condition). One small request on the referee's model reads the scene, the threads, the promises and the last scenes, and says free, until (something announced comes after so many days: the stay ends then, and the narrator opens with it), or not now (in danger, held, chased). What the protagonist does not know is not sent: hidden things in motion move by rule while the days pass, as they would anyway, and their news reaches the place.
- The scene is written up, the days pass by rule, and a new scene opens on the morning after, told in one passage. A fight, a contest under way, or a story not yet begun refuse it without a request.

**Stories that end** (`chapters.ts`, `session.ts`, `cards.ts`, `components/Ending.tsx`, `components/Tools.tsx`).
- When a world is built and when a story begins, the player chooses: with an ending (short, medium or long: about 3, 6 or 10 chapters) or going on. A story kept before this goes on. The setting can be changed in the story's settings.
- The final chapter begins when the story has run its length, or when its main thread was finished and two chapters have passed. Its packet carries an ENDING line: what is still open and what is still coming, and that the last choices are the player's. When the final chapter ends by its own rule, the story ends.
- The epilogue is written when the player asks, once, by the narrator's model (about a cent with Sonnet): what became of the hero and the people who mattered, from the chapters, bonds, threads and what moved in the world, and one line to remember the hero by. Then: read it as a book; go on as a new season (the length counted again); or begin a new hero in the same world, where the old one's line is remembered in the world's description.

**The story as a book** (`src/game/book.ts`). One HTML file, made on the device from the story and its kept scenes: a cover, each chapter with its scenes, the player's actions set apart, spoken lines with their speaker, dice as a quiet line (hidden in print), and the epilogue. It prints well. From the journal, the stories list, and the end of a story.

**A start for the empty page** (`src/app/starts.ts`). Under an empty description: eight worlds to begin from and Roll one, which puts a world together from four parts (where, how it starts, the trouble, a twist). They fill the box and nothing else; nothing is sent until the player builds.

**Tested** (`tests/features.test.ts`, 23 tests; 830 in all): prices in each money, change between coins of one money, a changer's cut; the builder's money cleaned; a new character's purse; buying, refused, at a friend's price, haggled, sold, given, changed; the narrator's paid, spent, gained and lost, a fortune held to dear; the YOU line with forty things; looks in full and in brief, and changed by the scribe; facts kept, capped, told once, sent to the scribe, taken back; the packet within its size with every card full; a contest begun, counted, won, given up; another take with the same dice and no new referee, going back to the first telling, the turn rewound whole, refused after a change and under Brutal, given back after a refusal; time off by rule, refused with someone hostile, ended early by what was announced; the final chapter by length and by the main thread, the end, the epilogue, a new season; the book.

**Checked** in the app with the demo narrator, at 412 by 687: a purchase and a chase with its track; Another take and Telling 2 of 2; a correction sheet; the time off sheet; the end card with an epilogue; the purse with two moneys; a profile with appearance, personality and kept facts; the new-world screen with its starting points and the picture button; the character screen with looks, and a picture made smaller from 1200 by 900 to 768 by 576 and put into words.

**Not checked: the live models.** Whether the referee classifies trades and contests well at low effort, whether the narrator keeps to prices and reports paid and gained sensibly, how good a picture's words are on Haiku, whether the time-off judge refuses only when the story set something up, and what a real epilogue reads like.

**Not built, and why.** Buying things the rules know (bandages and draughts with a number) is left out: what is bought is plain gear (decision 38). No bond change for giving money by itself: the narrator says whether it mattered. Places filled in during a story are still not saved back to the world for the new hero. A picture cannot be added to someone met in play: a picture is a reference for describing, and the owner chose to keep it to creation. No EPUB: one HTML file opens anywhere and prints to PDF.

### After milestone 5: Gift, a power of one's own

Asked for by the project owner: superhero settings were awkward. A player who writes "I ate a fruit that made my body rubber" in the premise had nowhere to put it, in a fight or out of one.

**What was asked, and what was built instead.** The proposal was a fourth mode, "Lore", in which the only requirement for a power is that what happens in the story makes sense. Read against the code, the trouble was worse than described: a world of paths forced the power into six elements, a world of schools made the rubber man buy fire as well, and with powers off the advantage was dropped as one the game did not know; and in any mode an effect of the player's own, typed in a fight, was silently read as Attack or Defend. But Lore as stated mends only the half outside a fight: fights are settled in code with numbers, a power with none does nothing there (or the narrator decides the fight, and the Brutal style means nothing); "it makes sense" has no judge who can say no; and nothing is spent, so there is no reason not to use the power every turn. What was right in it is kept: what a power does *all the time* is plain story fact, free, and the narrator's to play. Everything with something at stake stays the engine's. The mode is called Gift (decisions 72 to 78; the rules in 10.3 and 10.9).

Before building, the design was handed to a reviewer told to attack it, which read the code and played a few thousand fights. What it found changed the plan and is marked "from the review" below.

**The power on the sheet** (`src/engine/gift.ts`, `types.ts`, `character.ts`, `sheet.ts`).

- **Words, and four things the rules know.** A name, what it covers and its limit, cut to 40, 160 and 100 characters because they are sent to a model every scene. A rank from 1 to 4. Two kinds of fight effect out of five. Moves, each a tier and at most one of the power's kinds. One table says what a kind does at a tier; no model and no player writes a number.
- **Two kinds, not five** (from the review). One number that bought damage, healing, a guard, a dazzle and a stagger was a power with no shape, and a low-effort referee is lenient. The kinds are held in code: a move, a new use, or a use kept later can only do what the power's two kinds allow.
- **A legal gift from anything** (`cleanGift`). A model's proposal, a hand-edited save and the awakening form go through the same function: texts cut, numbers clamped, extra kinds and moves dropped, ids given. At the start of a story it is held tighter (rank 3, one move a rank, none above tier 2, like library abilities); in play a power holds two moves a rank.
- **One shape for what can be used.** `commandOf` now returns a `Power`, which an ability of the library and a move both are, with a mark on what is the player's own words. The compiler then listed every place that had assumed a library ability with a path.

**Making a character** (`src/game/llm/architect.ts`, `creation.ts`, `screens/CharacterNew.tsx`, `components/Gift.tsx`).

- **No new request.** The character proposal that already runs returns the power too; the request says that what a power does all the time in a fight belongs in the attributes (a hardened body is Armor, a blast is Firepower). `repair` cuts it to what is allowed and says what it changed; too dear a character loses rank before attributes, and never the power itself.
- **The editor** shows it as a section in place of Paths: the three texts, the rank, five chips of which two can be on, and one card for each move. On a phone the list is never longer than three.

**Playing it** (`src/game/session.ts`, `llm/prompts.ts`, `llm/requests.ts`, `llm/schemas.ts`, `cards.ts`).

- **The referee** is told the power in one line (its rank, its kinds, what it is; not its limit, which is the narrator's) and has the paragraph on powers of its instructions replaced by one for gifts. Its instructions are not cached, so a paragraph for this mode costs the other modes nothing; adding a sentence to the old paragraph would have left it saying that an effect of one's own must belong to "a path or school" (from the review).
- **The narrator** gets the power on a line of its own in the packet, with a budget of its own, and one more sentence in its contract for a Gift story. A move is given as the player's words with the reach of its tier, never as "it works as described" (from the review): the words are the player's, and a move that cost one energy and settled anything it said would be a button for winning.
- **A new use** is the old "effect of the player's own" with the path taken out: the referee rates its reach and the kind of thing it would do in a fight, the engine refuses what is beyond the rank, takes the energy, and rolls. One that truly passed is remembered (three at most), to be kept as a move.
- **The packet is written once a scene**, so a power that awakens or grows between turns is told to the narrator at the next turn, once (`Story.tellNext`).

**Fights** (`src/engine/combat.ts`, `session.ts`), for worlds of paths and schools as well:

- **A refused action no longer costs a request** (from the review; it predates this work). The engine refused a fight action, the player was told why, and the narrator was then asked to tell a round in which nothing had happened. It is not a turn now, and what happened before the player's first turn is kept for the action that is taken.
- **An invented effect counts.** Typed in a fight, it costs what it costs outside one, a Skill test is rolled, and if it passes it does what its reach does in a fight. The test is a plain roll (from the review): the usual softening would tell a failure as "a success at a cost" in the Story style while the fight applied nothing. The energy is the fighter's during a fight, so it is spent there.
- **A power opens a fight.** A damaging ability or move turned on someone who can fight starts the fight and is the first thing done in it. Before, the energy was spent, the narrator told the blow, and the fight began with the opponent unhurt.
- **Mending works outside a fight.** A healing ability used on oneself restores hit points; before, it cost energy and restored nothing.
- **Nobody loses two actions running.** A stagger could be repeated every turn, which with one companion took a fight from 72% to 94% (from the review).
- **Damage that skips the defence roll is reduced by a raised guard**, so that Defend answers a power, on either side.
- **The encounter tuner plays the protagonist's powers** (from the review). It judged every fight as if the protagonist only swung a blade: against a dangerous opponent it believed about 30% where a hero with a tier-2 damaging move wins over 90%, and thinned the opponent for nothing. It now uses the hardest-hitting power there is energy for.
- **Firepower counts for the protagonist.** They attack at range when it is higher than their Strength. Before, a hero with Firepower 4 and Strength 0 attacked with 0.

**Growing** (`session.ts`, `screens/Character.tsx`). Raising the rank, keeping a use that worked (the player names it and may rewrite its line; the tier may be lowered), forgetting a move, and awakening a power for someone who has none (ten experience, the player's own words, rank 1 and no moves; no model is asked). Each is recorded so that rewinding takes it back.

**Other people's powers** (`world.ts`, `builder.ts`, `expand.ts`, `combat.ts`). The reviewer advised leaving these out; the project owner asked for them, so they were built in a shape the numbers bear. The first design, a warned blow every third turn, hardly ever fired: fights last two to four rounds. Built instead: a named person may have one power, a name, a line and one of four kinds, which they use with their attack on their first turn and on every third after it. Its tier is set by code. Simulation then set two things (decision 76): the tier is 1 for everyone, and a stagger takes the place of the attack that turn. The power is on the person's card before their description, so that a long description never costs the narrator the power.

**Tested** (`tests/gift.test.ts`, 46 tests, and additions to `engine.combat.test.ts` and `session.test.ts`; 763 in all): the rules by themselves; a legal gift from a wild one; a proposal, a wild proposal and none; moves, new uses, refusals, a hero with no power; keeping, forgetting, raising, awakening, and a rewind across each; a file with a damaged power; in a fight a move, a new use that passes and one that fails, a refusal that asks no model, a power that opens the fight, and the same for a world of paths; people's powers from the builder, in a place filled in later, in a fight, and what a world may not hold; and a balance check that plays three Champions against an able and a dangerous opponent with each kind of power, which fails if a power takes more than sixteen points off their chances (twenty-seven for a guard, which blunts the very move the simulated hero keeps using).

**Checked** in the app with the demo narrator, in the sandbox: a proposal with a power and its editor; a move; a new use that failed and one that worked; keeping it under a name; raising the rank; a fight against someone with a power, with a move used from the Ability sheet; and awakening. At 412 by 687 pixels, in English and Portuguese: the four options on the new-world screen (two rows of two: "Sem poderes" does not fit a quarter of a phone), the editor with three moves, the Abilities tab with eight moves and three uses waiting, and the Ability sheet with eight moves.

**Not checked: the live model.** The referee runs at low effort with thinking off, and nothing here shows how it reads the paragraph for gifts: whether its reach and kind ratings feel right, and whether it answers "impossible" too readily. Nor how a real proposal reads against a real premise. This needs a session with a key.

**Not built, and why** (a fruit with Haki beside it, and powers that copy or erase another's, came afterwards: see "Powers that come and go" below): a gift beside paths in one world (a fruit and a learnable Haki), which would need both sets of rules on one sheet; new kinds of fight effect, for powers that copy or erase another's; powers for groups, and other people's powers outside Gift worlds; a person's power on the People screen; keeping invented effects in worlds of paths and schools, where decision 50 stands.

**Known gaps.** A power's tier in a fight reads the referee's reach as force, which they are not: the referee is asked to rate by force while a fight is on, and outside one a storm over a street and a stone-breaking punch are still rated by how far they reach. Someone else's dazzle does nothing to a hero who only uses moves. The demo hero, with Skill 2, works out a new use one time in three.

### After milestone 5: powers that come and go

Asked for by the project owner, for a One Piece story: a Devil Fruit and Haki on one hero, a fruit found in the story, and powers that can be sealed, copied and stolen. Gift had given each hero one power and left all of that out. The design was talked through first (Haki as a second gift was turned down: it is shared, taught and known by name, which a power in the player's own words is not), then planned, then handed to a reviewer told to attack it, which read the code and played 20,000 fights for each case. What it found is marked "from the review" below. Decisions 79 to 85.

**Several powers on one sheet** (`src/engine/gift.ts`, `types.ts`).
- **Where they are kept.** The power by nature stays where it was (`sheet.gift`). Up to three more, gained in play, sit beside it in a wrapper that records where each came from: a discipline, an item carried, a power borrowed for the scene (`sheet.arts`). Old saves and `cleanGift` were left as they were.
- **Limits.** Four powers in use at most, and eight moves of one's own in all. Twelve were planned, but twelve rows do not fit a phone (from the review).
- **Ids.** The moves of a power beyond the first are known by its id and their own ("armament:g1"). Two powers' first moves had clashed in a fight (from the review).
- **A new use names its power.** The referee puts that power's id in `ability`, so the shape every world shares did not change. A use that worked is kept on that power.
- **What the models are told.** Each power has a line for the referee and one for the narrator. When powers change between turns, the narrator is told of each one; before, a second change overwrote the first (from the review).
- **Only in play.** At the same points, a fruit at rank 2 with Haki at rank 1 does no better than one power at rank 3 (from the review). The owner also wanted trained powers unlocked with experience.

**Disciplines** (`src/game/arts.ts`, `builder.ts`): powers many people share, written by the world.
- **What the world writes**, in the rules step: four at most, each with a name, what it is, its limit, one or two kinds, a first move, and whether it is taught. That step is allowed 450 more tokens in a Gift world, since it would have been cut off (from the review).
- **Who has one.** A person may practise one (`Person.trains`). This is kept apart from the library's `teaches`, which the world check holds to abilities.
- **Being taught** follows the paths' flow at tier 3: the teacher must count you Trusted, or Friendly for a mentor. Learning then costs 10 experience, with no test, and gives rank 1 and the first move.
- **One that is not taught** (Conqueror's Haki) awakens for the same 10 experience, only in the scene in which the protagonist was brought down in a fight, or the next. Otherwise it would have been the easiest power in the game to get (from the review).
- **The narrator** has the disciplines in its world description (cached), and a practitioner's card says what they practise.

**Items of power** (`arts.ts`, `cards.ts`, `parse.ts`). These come from 3D&T's magic items, which are conquered for nothing, bought, or made (`docs/rulebooks/digests/core_2_magic_items_gm.md`, section 5). The owner's answer was that a Devil Fruit found in the story should be free: a permanent item.
- **What the builder writes**, in the seeds step: up to two items. An eaten one's power becomes the eater's own, for good, at rank 1. A carried one's power is its holder's while they hold it, at rank 1 or 2.
- **How one is taken.** The game had never handed anything out in play. Now the narrator reports `got: <item id>`, a fact line like `settled:`. The engine accepts it only when the item is free:
  - lying where the scene is, once its situation is settled. Without this, "I search the room and take the fruit" worked on the first turn (from the review).
  - or given by someone Close.
- **Dropped.** A carrier who is beaten drops it where the fight was; one who dies drops it where they were.
- **Eating** is one engine function, reached by typing it or by the Eat button. The referee is given the items that are eaten. One fruit each.
- **Carried.** A carried item's power is set aside when four are already in use.
- **Losing a fight** no longer tells the narrator the protagonist is robbed of what they still hold.

**Seal** (`combat.ts`, `world.ts`): a new kind for a person's power, such as seastone or an eraser of powers.
- **What it does.** On the turns they use it, it takes the place of their attack, and the protagonist cannot use a power on their next turn. The attempt is refused, is not a turn, and no model is asked; the fight controls say "Sealed".
- **Why in place of the attack.** On top of the attack it took 21 points off the weakest hero's chances. In place of it, it is worth 0 to 8 points to the hero, as a stagger is (from the review, and measured again at 4,000 fights a case).
- **Not for heroes.** A hero cannot choose seal: sealing an opponent's power was never better than striking (from the review).
- **Outside a fight** a seal does nothing mechanical.

**Copy and steal** (`arts.ts`, `session.ts`): new kinds for a hero's own power.
- **People's powers get a rank**, from how able they are in a fight (1, 2, 3). It counts only when someone else holds the power; in its owner's hands it still acts at tier 1 (decision 76).
- **A copy** is aimed at someone in the scene who has a power, and is a new use: the energy and a test, a plain roll in a fight. It gives a borrowed power until the scene ends:
  - at the lower of the use's reach and their rank;
  - with their kind, and one move, the power itself;
  - one at a time; nothing is kept from it, and it cannot be raised.
- **A steal** is the same, and the person cannot use theirs until the scene ends.
- **In a fight** the borrowed move is at hand at once; the fighter's moves had been fixed when the fight began (from the review). The Ability sheet lists what the fight holds.
- **The referee** is told who in the scene has a power.
- **No permanent steal by the hero.** A free rank-3 power for every dangerous opponent beaten would have been the best way to grow in the game (from the review).

**Robbed** (`arts.ts`, `whereabouts.ts`): a person's power may steal, and the builder says whether it holds what it takes or erases it.
- **In a fight** it works as a seal.
- **If the protagonist loses the fight** while such a thief is standing, the thief takes their power by nature. With none, they take the highest-ranked discipline; never an item's power, nor a borrowed one.
- **Held.** The power is recorded with the thief, and a thread opens to take it back. No other power by nature can be had meanwhile: a robbed hero could have eaten a second fruit (from the review).
- **It comes back**, whole, when the thief goes down or flees in a fight the protagonist wins, or dies, wherever that is recorded. The thread closes by itself.
- **Why there is no "only on the thief's death" mode.** Beaten opponents leave the map as "left", so such a mode would almost never have fired (from the review). The owner's Hunter x Hunter case is held, and comes back on a death too.
- **Erased**, it is gone, and another power may come. In the Story style nothing is lost for good, so an erasure is held instead.
- **The risk.** Without their power, the three test heroes beat a dangerous thief 4, 12 and 74 times in a hundred, and an able one 71, 95 and 100. The weaker heroes need companions, growth or a discipline to win it back.

**Tested** in `tests/arts.test.ts` (36 tests), and in the balance check of `tests/gift.test.ts`, widened to seal and steal; 799 tests in all:
- powers on one sheet: their ids, ranks, moves and limits, and a file with damaged powers;
- disciplines: built, taught, refused, learned, awakened after being brought down, and rewound;
- items of power: built, refused until free, taken, eaten in the story, carried, set aside, dropped by a beaten or dead carrier, and kept through a defeat;
- a seal in the engine, against the encounter tuner, and in a story;
- copy and steal: outside a fight and in one, given back at the scene's end, refused, and rewound;
- a theft: the thread, the return after a won fight and on a death, erasure and the Story style, and a rewind across it.

An older test in `tests/whereabouts.test.ts` had checked nothing: its word boundaries had been turned into backspace characters. With them put back, it still passes.

**Token cost.** No new request.
- **Building a Gift world** writes about 700 more output tokens, once (disciplines and items). Every build reads about 200 more tokens of schema.
- **The referee, in a Gift world,** reads more each turn:
  - about 40 to 65 tokens for each power beyond the first;
  - about 60 more of instructions;
  - 15 for each item to be eaten, and 8 for each person present with a power.

  With four powers that is about 300 tokens a turn, a few hundredths of a cent on Haiku.
- **The narrator** reads a line for each power (about 75 tokens each) and one for an item of power where the scene is (about 80). The `got:` line is in the cached contract.
- **Other worlds** pay only for the builder's schemas.

**Checked** in the app with the demo narrator, in the sandbox:
- a discipline taught by Bram once he was Friendly, then learned from the Character screen;
- an item of power refused while its situation was open, then taken once it was settled;
- eating refused for a hero with a power of their own, with the reason shown;
- a fight against someone who seals: the player is told, and the Ability button reads "Sealed" while it lasts;
- the Ability sheet with moves of three powers, each group under its power's name;
- a copy typed in the middle of a fight, with the borrowed move at hand at once.

At 412 by 687 pixels, in English and Portuguese, with no sideways overflow and no console errors:
- the crowded Abilities tab: four powers, eight moves, three uses waiting, and the disciplines on offer. It is long, about six screens, mostly the three forms for uses waiting, as before this work.
- the Items of power group;
- a power held by a thief;
- the seven kind chips, in two rows.

A borrowed power's moves had been counted against a room it does not have; it now says "borrowed".

**Not checked: the live model.**
- Does the builder write sensible disciplines and items for a setting it knows?
- Does a low-effort referee pick the right power among four, name the target of a copy or a steal, and recognise eating?
- Does the narrator report `got:` only when the story gives the item?

**Not built, and why:**
- a permanent steal by the hero (see above);
- a seal for the hero, and a seal outside fights: the referee sees too little of the story to keep one;
- disciplines at character creation;
- items of power outside Gift worlds, crafted or bought items, and items found in play beyond the two the world writes;
- a thief using a stolen power against the hero;
- immunity of the Logia kind (only Haki harms them), and sea water as a rule.

### After milestone 5: the player throws the dice

Asked for by the project owner after trying the app: the dice should wait for the player, and the throw should look like one.

**What was asked, and what was built instead of the obvious.** The obvious reading is "do not roll until the player clicks". That was turned down. The number a die shows comes from the story's own dice, which is what makes an action taken back and sent again meet the same roll; a click cannot and must not change it. And a turn that waited for the click before asking the narrator would add the narrator's whole delay *after* the click. So the rules settle the turn as before, the narrator is asked at once, and what the player has not thrown is simply **not shown**: the click is when they get to see it. The telling is usually ready by the time the die has landed, so the throw costs no waiting at all.

**What that makes necessary** (`src/app/table.ts`, `Session.before`, `screens/Play.tsx`).

- **Nothing may give the result away.** The story already holds what the dice did: hit points lost, an opponent down, a scene left. Until the dice of the turn have landed, the play screen draws the story *as it stood when the turn began*: the meters, the fight, the people present, the place and the hour in the top bar, the side panels. The session keeps that earlier state for this. Found by looking for it: the top bar named the next place while the die that got the character there still showed a question mark.
- **One card at a time.** A card with dice waits to be thrown; the cards after it, and the telling, are not on screen until it has landed. A test is one die; an attack is two, the player's and the opponent's, thrown together.
- **Many cards.** A round against five is six throws. The Roll button in the dock stays in the same place for all of them (and Space throws), and beside it "All 4" throws what is left of the round at once, a fifth of a second apart. A round taller than the screen keeps the card being thrown in view, and puts the last one at the top when it lands, so that the telling has room under it.
- **Where it can be pressed.** The die, the card, the button in the dock (a thumb's reach on a phone), Space.
- **Leaving the table throws the dice.** Going to another screen and coming back finds them as they fell. The roll was always in the journal.
- **A turn that failed after its dice** (the narrator could not be reached) keeps its dice, as before; when it goes through, they are thrown then.
- **A setting**, on by default: "Throw the dice yourself". Off, the app throws everything as soon as it is called for. "Dice animation" is separate: without it (or with animations off) a die that is pressed simply shows its face.

**The throw** (`src/app/dice.tsx`, `styles/slate.css`). A second and a half. The die crouches, leaps three times, each leap lower than the last, turning two full turns on the way, squashed a little each time it meets the table, with its shadow staying on the table under it. It shows about fifteen faces on the way, every few hundredths of a second at first and slower as it loses speed, never the same face twice in a row, and the face it lands on appears at the third landing. An opponent's die spins the other way. While a die waits it hops in place with a ring spreading from it.

**The numbers beside the dice move with them.** On a test, the scale of one to six follows the face the die shows, and the caption counts with it. On an attack, the die in each sum and both totals count along. What a 6 does (Strength or Armor doubled) is seen only when it has landed, like the rest of the outcome. The outcome keeps its place on the card while it is unseen, so nothing jumps when it appears.

**Found on the way.** A turn that ended its scene was drawn twice, once as a turn of the scene and once as the turn in flight, for as long as the scribe took to write the scene up. It predates this work and is fixed (`Session.arriving`), with a test.

**Checked** in the app with the demo narrator: a test, a round of four blows thrown one by one, by Space, and all at once; the setting off; animations off; a failed turn and its retry; leaving and returning; a turn that moves to another place; English and Portuguese at 360 pixels, desktop, a light theme. Not checked on a real phone.

### After milestone 5: the key screen says the key was accepted

Reported by the project owner from a phone: after the key was checked, "Go to your stories" stood where "Check the key and continue" had been, the same shape and the same colour, and nothing else on screen had changed. The words that said the key was accepted were under the key field, a screen above.

- **The result is where the button was.** A panel in the colour of a success holds the words and the way in; it rises into place, the button springs out and then lets a ring go every few seconds. The button is one bright green in every theme: on a light theme the green that text uses is as dark as the accent, and a theme's accent can itself be a green, so colour is never the only thing that changed.
- **A refused key is told at the field.** The message was a screen above the button that had been pressed; the field and its message are now brought into view.
- **Choices made after the check count.** The narrator and the limit are saved again on the way in, the words about which models the key will use follow the narrator chosen, and choosing where to keep the key after it was accepted asks for the check again, since that is when it is stored. Before, all three were dropped without a word, and the last one could leave a key on the device that was meant for the session only.
- **A key that cannot use the chosen narrator** warns in gold and the button stops calling; choosing another narrator, right above, turns it green.
- Seen on the way and fixed: at phone width the recommended narrator's mark sat on a line of its own, and on a wide window "This session only" broke onto two lines.

**The first button no longer promises what it does not do.** It read "Check the key and continue", yet a second press was needed; it now reads "Check the key". The alternative, going straight on when nothing is wrong and stopping only for the warning, was put to the owner and turned down: the second step is where the player learns which models the key can use.

### Milestone 5 as prepared

The row said: "Install flow, both languages, documentation, license review, optional Android wrapper", done when there is a "public repository and hosted build". Everything short of publishing is built. Publishing is the project owner's to do, and nothing was published, committed or sent.

**What was wrong with the row.** "Both languages" was one line for the largest piece of work in it: every text of twenty-five files of interface, of the rules content, and of what the game itself writes for the player. And it hid a question the plan had never asked: *whose* language? Three different answers turned out to be right at once (below).

**Installing** (`public/manifest.webmanifest`, the icons, `serviceWorker()` in `vite.config.ts`, `src/app/install.ts`).

- The site can be installed from the browser, and Settings, About, has an **Install** row that shows the browser's own dialog where the browser offers one, says how on an iPhone, and says so once the app is installed.
- A service worker keeps the app's own files on the device, so it opens with no network. It is written when the site is built, because only then are the files' names known. The page and what it needs at once are kept at installation; the PDF reader (over a megabyte) the first time it is used; the page itself is fetched fresh when there is a network, so that a new version is noticed. A request to the Claude API is never touched.
- A new version is fetched in the background and announced in Settings ("A new version is ready"), not sprung on a player in the middle of a scene.
- **Checked by taking the server away.** `docs/mockups/_tools/offline.mjs` serves the built site, opens it in a headless browser, stops the server and loads the page again. The first version failed that test: the page came back and its script did not. The preview server answers with `Vary: Origin`, the page asks for its script with an Origin header that the worker's own fetch had not sent, and a kept file matched strictly was never found again. Kept files are now found by address alone. Nothing but a real reload with the server gone would have shown it.
- The browser pane inside the development tool refuses to register service workers at all, so this check runs in headless Edge or Chrome.

**Two languages** (`src/i18n.ts`, `src/app/T.tsx`, `src/i18n/pt/`, `src/i18n/README.md`).

- **How.** The English text in the source is the original and the key: `t('Go to your stories')`. Portuguese is looked up in dictionaries, one file for each part of the app, about 2,500 texts in all. A text with no Portuguese is shown in English, so a missing entry is never a broken screen, and a test reads the whole source for marked texts and fails while one has no Portuguese, or carries different slots, or says two different things in two files. Keys by name ("welcome.title") were considered and turned down: they double every text, hide what a screen says from whoever reads its code, and make a missing translation show as a code.
- **One word, two meanings.** "Close" is a stage of a bond (Próximo) and what a button does (Fechar); "Off" is a switch and a world without powers; "Dark" is a look and a path. A text may end with a note in double brackets, `t('Close ((button))')`, which is part of the key and never shown. This came up within minutes of the work starting, from three sides at once.
- **Whose language.** (1) The interface is in the language of the app: a setting, and on a first run the device's language. (2) What the game writes into a story (notes, notices, memories it records itself, the words of a journey chosen on the map) is in the *story's* language, and stays so: a Portuguese story keeps Portuguese notes whatever the interface is switched to. (3) Everything sent to a model stays English, the lines the rules give the narrator included, with one exception found while checking the screens: the referee and the scribe had never been told the story's language, so the label of a roll, a question to the player, a scene's summary and the memories people keep could have come back in English in a Portuguese story. Both are now told, in one line, for Portuguese stories only.
- **The rules too.** The thirty-six abilities, the traits, the skills, the stages of a bond and what the rules say when a sheet is wrong are in Portuguese. The engine keeps its English: it is what models are sent and what saved stories hold. The screens look the words up where they draw them.
- **The dictionaries are a file of their own** (181 kB, 62 kB compressed), fetched when the app starts and kept for offline use with the rest.
- **How it was done.** The marking and translating of the screens was handed to nine helpers working at once, one for each part, each with the same written conventions and glossary (`src/i18n/README.md`) and one finished screen as the example. The check for missing and clashing texts was written first, so that their work could be judged by a machine before it was judged by eye. Then every screen was drawn in Portuguese at the width of a small phone and looked at.
- **What the narrow phone showed.** Portuguese runs a fifth to a third longer. Three layouts that had always fitted English by luck broke: a card whose row of buttons pushed it wider than the screen, a form whose price line would not wrap, a header. Each was a grid with no stated width; they have one now. Labels that had grown too long were shortened in the Portuguese, not the layout.

**Not in Portuguese, and why:**

- **The sample world and its story.** "The Glass Road" is written in English: a translation of it is a piece of writing, not of interface, and a world of one's own can be built in Portuguese today. The guide says so.
- **The demo narrator.** Its canned text is English, and its stand-in for the referee recognises English words only. A demo in Portuguese shows a Portuguese interface around an English story.
- **Words a builder falls back on** when a model leaves a field empty ("Of this place"), and this plan.

**Documents.** `docs/PLAYING.md` and `docs/JOGAR.md` (how to play, in each language), `docs/HOSTING.md` (building, what a host must do, how a new version reaches players), `docs/ANDROID.md`, and the README.

**Licences.** Decision 9 said the files would be added before the first public commit; they are here, and the decision can still be changed before that commit.

- `LICENSE`: the GNU Affero General Public License, version 3, as published.
- `LICENSE-CONTENT.md`: the game content (the rules as worded here, the sample world, the documents) may also be used under CC BY-SA 4.0; what a player makes is the player's.
- `THIRD-PARTY-NOTICES.md`, written by `docs/mockups/_tools/notices.py` from the build's own source maps, so that it names what is shipped and not what is merely installed: eleven packages, all under MIT, Apache-2.0 or the Unlicense, all compatible with the AGPL. Four of them (a telemetry interface, a webhook verifier and two small helpers) come in with Anthropic's library and are never called; the page's content policy would stop them reaching anything in any case.
- Still open, as before: the e-mail to Jambô (decision 2). Nothing in the repository depends on the answer, but publishing should wait for it or go ahead knowingly.

**Android.** The installed web app *is* the Android app: an icon, a window of its own, offline. A package for the Play Store (a Trusted Web Activity) is described in `docs/ANDROID.md` with what it would take and what would have to be decided, and is not built: it needs a final address, a signing key and a store account, all of which belong to a person.

**Publishing.** `.github/workflows/pages.yml` builds, tests and publishes to GitHub Pages on a push to `main`. It does nothing until a repository exists. The project is still not a git repository: commits are made when the project owner asks for them.

**What is left, and whose it is:**

| What | Whose |
|---|---|
| A session with a real key: a world built by Claude, a chapter played to its end, one story in Portuguese | The project owner |
| A real phone: installing, playing, the keyboard, storage | The project owner |
| Reading the Portuguese as a native speaker | The project owner |
| The e-mail to Jambô | The project owner |
| Creating the repository, the first commit, publishing | The project owner |

### Milestone 4 so far

**What was wrong with the row.**

1. *Half of it was already built.* The map, the table styles, the combat interface and the encounter simulator came with milestone 1, because the play loop could not be judged without them. The row had not been touched since.
2. *Its test is the player's to pass, and two of its three stories cannot be played yet.* "Three contrasting stories (brutal, power fantasy, cozy)" needs a real key and a person. And a power fantasy needs the Extreme mode, which does not exist; worse, no ability can be learned in play at all. The character screen says "every other ability has to be found in the story and then learned", and nothing in the game can teach one.
3. *It did not list what had been pushed into it.* Collected from the earlier milestones: fronts that advance; the "meanwhile, elsewhere" of the recap; people telling each other things off stage; a document as the source of a world; the Extreme mode; a character of one's own in the sample world; changing a built world by hand.

So the milestone is staged, each stage useful by itself: **(a) the world moves**, **(b) powers in play**, **(c) documents**, **(d) the rest**. The world comes first because every built world already carries the data for it and, until now, misled the narrator with it: a line saying "Coming: …" that never came. It also costs no request, which is the first thing this app is for.

**The world moves** (`src/game/fronts.ts`, `moveWorld` in `src/game/session.ts`). What section 8.3 said, and what had to change:

- **"The Engine advances clocks as game time passes."** Time alone is the wrong measure. A week on the road would burn through a plot before the player heard of it; a chapter played in one town over two days would see nothing move. The rule is now: **every front moves one stage a chapter**. During the chapter if enough days have gone by since it last moved (a die decides which day), otherwise when the chapter ends, provided a day has passed. The world changes at the speed of the story. Three fronts do not move on the same day: each is due a day after the one before.
- **"When a clock fills a stage, the consequence becomes a world event."** The stages were written for the narrator alone ("the assay books are quietly rewritten"). Made into news as they stood, every townsperson would know a secret within six hours. Each stage now has two faces: what happens, for the narrator, and what people would see or hear of it, which may be nothing. Only the second becomes news. The builder writes both; a world built before this still moves, and nothing is said of it.
- **Where news starts.** The first version started it in the first town a front touches, so word of the baron's wardens stopping couriers *inside Port Varn* began in Tessaly, two days away. Found by the test for the sample world. News now starts in every place the front touches at once, and reaches the rest of the country by the hearsay rule of milestone 2.
- **"The country."** That rule treated open land between towns as a country of its own, so public news from the Salt Flats never reached Port Varn. The country is now the whole map.
- **"At chapter boundaries a cheap call turns the stages into concrete news."** No call. The news was written when the world was built.
- **Nothing said how the player could matter.** A plot that runs to its end whatever the protagonist does is a countdown, not a world. The scribe, who is asked at every scene end anyway, is now told what is in motion where the scene was played and may answer that the protagonist set one back or ended it. Set back, a front waits three days and does not move again that chapter. Ended, it goes no further, and the narrator is told so. Only something that shows where the scene was played can be touched from there.
- **The world rolls its own dice**, kept with the story apart from the player's: the world moving never changes a roll of theirs, and after a rewind it moves the same way again.
- **The player is told nothing by the game.** No note says "the world moved". The narrator is told what has come to pass where it shows ("So far: …"), people who would have heard carry it as hearsay, and a new packet line, "TALK HERE", gives the narrator the news that has reached the place, for anyone to bring up. The recap's "Meanwhile, elsewhere" (from the mockup) lists that same talk: news where it is local, rumour where it has come from elsewhere. What has not arrived yet, and what happened out of sight, is not shown. A memory the player reaches for is likewise not news that has yet to reach them.
- **The sample world has three things in motion now**, from the mockup's overview: the borrowed seal (already begun when the story is picked up), the Ferrymen's Company, and the Glass Road. This also gives the open mystery of the sample story, "who copied the baron's seal?", an answer for the narrator to work toward instead of one to invent.

Tested: the rule by itself (due dates, the die, once a chapter, the chapter's end, set back, stopped, finished); in play (news, hearsay on people's cards, the talk of the place, word reaching another town days later); the scribe holding a front back; a rewind; and fifty-two scenes over four chapters, in which every front moved at most once a chapter, ran its course and stayed there, with the packet inside its size throughout. Measured in the sample story with the demo narrator: the first scene packet is about 1,265 tokens (it was 1,130: two things in motion), and a turn still costs about $0.0036.

**Known gaps of this stage:**

- **The world's text and the world's people can disagree.** A stage may say the surveyor was sent away while her card still places her at the inn. The narrator has both and must smooth it over. *(Settled in stage (d): see "People who move, leave and come along".)*
- **A situation's "if left alone" never comes to pass by itself**, for the same reason: it usually says what a named person does. *(Settled in stage (d).)*
- **A front reaching its end does not end the story.** Its last stage is marked as the one that matters most, and that is all.
- **Whether the scribe judges "set back" and "ended" well** is unknown until it is seen with a real key.

**Powers in play** (`src/engine/abilities.ts`, `applyReferee` and `learn` in `src/game/session.ts`). Until now a character could use the abilities chosen at creation and nothing else, ever. What section 10.3 said, and what was built:

- **Using what is known** is unchanged: the referee names the ability, the rules check it and take the energy, the narrator is told it works.
- **Trying what is not learned.** Any ability of the library can be attempted when the path is high enough for it. It costs one energy more, spent either way, and is a hard Skill test. If it works, the character has worked out how it is done: the ability is *found*. This is the plan's "improvised effect", for the case where the effect is one the library already has.
- **An effect of the player's own**, on no list: the referee says which path it belongs to and how far it reaches, from 1 to 4, on a fixed scale. Allowed within a path the character has; a hard Skill test; the reach plus one in energy. It works once and leaves nothing to learn. The plan said a success "can be learned permanently"; it is not, because there would be nothing to keep but an ability whose rules a model had made up.
- **Being taught.** Who can teach is a fact of the world: the builder says of a few people which path they practise and how far they have come, in words, and the rules turn that into the abilities they can teach. Whether they will is a matter of the bond: the more an ability can do, the better they must know the protagonist, and a mentor teaches a stage sooner. A refusal is played by the narrator and the turn says what it would take. The plan had left open what makes a teacher willing; tying it to the bond means powers grow out of the time spent with people, which is what this game is for.
- **Learning** what was found, on the Character screen: one experience and a Skill test, easy when someone showed how, medium when it was worked out alone. A failure spends the experience and the ability stays found. It needs the Focus the ability needs.
- **The Extreme mode.** The plan had a school grant the use of "any known ability" in it. Built that way it would be the Focus mode with other prices and the same lessons to sit through, which is not a power fantasy. So a school is everything in it: no finding, no learning. What limits it is the price, which climbs steeply (1, 3, 6, 10) and may never pass five times Skill, and the energy pool. The schools are advantages that exist only in such a world; the character screen and the proposal offer them there and nowhere else. In a fight every ability of the school that does something there can be used.
- **The narrator is not sent the library.** A character who commands a school is described to the narrator as that, in a dozen words, not as thirty abilities. The referee, which is the cheap model and needs the names to recognise them, gets the lists: what is at the character's command, what is within reach and not learned, and what someone here could teach. That costs about two thousandths of a cent a turn.

**A hole in rewinding, found on the way.** Experience spent between turns (raising an attribute, and now learning) was not part of any turn, so no turn's record covered it. Rewinding gave the experience back and left the raise standing. Such changes are now written down as they happen, and the next turn's record carries them, so a rewind takes them back too, with the dice as they were: the same choice meets the same roll.

Tested: the rules by themselves; attempts, effects, lessons and refusals in play; learning, failing to, and what stops it; the Extreme mode in a story and in a fight; the rewind; teachers in built worlds. In the sample world the Guildmaster, the lens-maker and the protagonist's sister now have something to teach.

**Not built in this stage:** a school or an advantage bought later with experience; abilities learned from a book or by watching; mythic abilities; people using abilities themselves; a world renaming the paths.

**Documents** (`src/game/ingest.ts`, `read` in `src/game/builder.ts`, `src/app/documents.ts`, `src/app/pdf.ts`). A world can now be built from a text, Markdown or PDF file. What section 8.7 and the mockup said, and what was built:

- **"Splits it into chapters."** Chapters cannot be found reliably in text taken out of a file: a PDF's outline is often missing, and a heading looks like any other line. The text is cut into parts of about 36,000 characters (some nine thousand tokens), each ending where a paragraph ends. A chapter cut in two loses nothing, because notes are taken from each part and then brought together.
- **"The Ingestor pulls out places, factions, characters, rules of the world and tone."** Built as the reader: the cheapest model (the scribe's), told who the player wants to play, writes at most 300 words of notes for each part under five heads. The notes are plain text, not data. The builder rewrites everything it is given anyway, so a schema here would cost output tokens and a cleaner and buy nothing.
- **"The Architect then works from those notes, never from the raw book."** Kept, and it is what makes a book affordable. A 117-page book is about 110,000 tokens. Given whole to the builder it would be read seven times at the builder's price, and paid for again in full whenever a build was paused longer than the cache lasts. Read once by the cheap model it costs between one and two cents, and the build that follows costs what any build costs. The notes of all the parts are brought together into one description of at most 1,400 words; a short document's notes are already under that and go to the builder as they are, with no request made.
- **The mockup's price was twenty times too high and its flow had a hole.** It said "$0.38 to read it" and showed the file card and nothing else. Reading sixteen parts is sixteen requests and about a minute: it needed a step of its own, with progress, a pause, a failure that keeps what was read, and its price on the button. It now stands at the head of step 4, before the questions; nothing can be asked or built until the document is read, because the questions are about what the document leaves open.
- **"Scanned PDFs without a text layer fall back to sending pages, with the cost shown first."** Not built, and dropped from the plan. Two hundred page images are megabytes sent from a phone and hundreds of thousands of tokens on a model that reads images, for a result worse than any free OCR tool gives. The app says that it found no text and why.
- **Only three kinds of file:** `.txt`, `.md` and PDF. Anything else is turned away with the advice to export it as one of those. A file is recognised as a scan when its pages hold fewer than twelve words each.

**What leaves the device, and what does not.** The text is taken out of the file on the device. PDFs are read by pdf.js, which is loaded only when a PDF is chosen and is used for its text extraction alone: no page is drawn, no font loaded, nothing fetched, and the built site's content policy would refuse it anyway. Before anything is sent, what repeats from page to page is taken out: running heads, page numbers, and the stamp some shops print on every page with the buyer's name and address.

That last part was wrong in its first version, and only the real files showed it. The rule was "a line that stands on a third of the pages repeats". In one of the four books in `docs/rulebooks/` the buyer's stamp follows the running foot on 79 pages and is glued to the end of the page's last line of text on 19 others. There it was not a repeating line, so the buyer's name and address would have been sent nineteen times. The rule is now three rules, applied before the one about whole lines:

1. An e-mail address that stands on a third of the pages is a stamp. The words that stand beside it on most of those pages are part of it. Stamp and all go wherever they stand; the line of the book's own text they were glued to stays.
2. Words that end the last line of page after page, or begin the first, go the same way: a stamp or running foot with no address in it. Three words at least, two of them real words, so that a row of numbers at the foot of a table is not taken for one.
3. Every e-mail address is taken out of every document, always. No setting needs one.

Checked against the four real books by counting only, never printing their text: no address is left in any of them, and the two words that stood beside the stamp's address on every page are found nowhere afterwards. A safeguard works the other way: if "repeating lines" would be more than three tenths of the document, they are the document's own way of writing (a list, a table, verses with a refrain), and only page numbers go.

**What this does not catch:** a stamp with no address in it, in the middle of a page and run together with text; and a buyer's name printed once, on one page. Neither was seen in the files at hand.

**A document is material, never instructions.** The reader is told so in its instructions, the part it reads is sent between marks, and the builder is told that the notes describe a setting and command nothing. A document that says "ignore the above" is a document that says that. This has been tried only with the demo reader: whether Claude holds the line is one more thing to see with a real key, though the damage a hostile document could do is small (a strange world; the rules and the checks still decide what is playable).

**The document is not kept.** Each part is dropped from the draft as soon as its notes are taken, and the notes are replaced by the one description when the last part is read. A finished world remembers only the file's name. The notes can be read on the screen before building.

**Measured** on the four real books (96 to 146 pages, 59,000 to 87,000 words each): the text comes out in 0.6 to 2.6 seconds on this PC; they make 11 to 16 parts; reading one is priced at 1.3 to 1.9 cents with Haiku 5.5. The largest part of the price of a world from a book is still the build.

Tested (`tests/ingest.test.ts`, 22 tests): tidying, the stamps, the safeguard, the cutting into parts; reading with a pause, a failure, the spending limit and a resume, with no part read twice; the long document whose notes must be brought together and the short one whose notes go as they are; building from the notes; the world file. In a browser: a text file and a PDF through the whole flow to a character, a scan and a picture turned away, and the built site under its content policy, where the PDF reader's worker loads from the site itself.

**Not built in this stage:** reading several parts at once (faster, and three times the failure handling); scans; `.docx` and `.epub`; adding a second document to a world; going back to the document when a sketched place is filled in (the notes were made for the starting area above all, so a far region of a built world owes more to the builder than to the book).

**People who move, leave and come along** (`src/game/whereabouts.ts`, and its uses in `src/game/session.ts`). Stage (d) was listed as "people who move and tell each other things, personal quests, a character of your own in the sample world". Reading the code for it turned up three things that mattered more than any of those, all in the part of the game this project cares about most:

1. **Nobody could join or leave the party.** Section 10.7 says a Trusted character joins the party. In play, who travelled with the protagonist was fixed when the story began, for ever.
2. **Grievances did not exist.** The rules halved gains for "an open grievance" and the profile screen showed one, but nothing in play ever opened or settled one. Only the two the sample story starts with were ever seen.
3. **A companion in a built world started at "No bond yet".** Someone at the protagonist's side from the first scene was, by the numbers, a stranger.

So this stage is mostly company, and the list above came after it. What was built, none of it by asking a model anything:

- **Asking someone along.** The referee recognises it ("invite"), and the rules answer: someone comes at the Trusted stage, if the party has room and they hold no grievance. A refusal is played by the narrator, who is told why, and the turn says what it would take ("Captain Roth would travel with someone they know as Trusted. You are at No bond yet."). A full party, or a story played without companions, is said at once and costs no turn. The profile of someone present says the same before the player asks, so that nobody has to guess what the bond is for.
- **Parting.** A companion stays behind at a word ("part") and is found where they were left. Someone who has travelled with the protagonist before comes back when asked, whatever the stage: they chose that company once. Without this, telling the sample story's young apprentice to wait outside would have lost him for good.
- **Grievances.** A betrayal or a broken promise is now held against the protagonist, in the words of what was done. It is settled by an act for that person that matters (Significant or more), which then counts in full, as the plan's "a repaired grievance can leave the bond stronger" wanted. No new signal from the narrator was needed: the acts it already names carry both.
- **Walking out.** A companion who holds a grievance and whose bond has fallen below Friendly goes no further when the scene ends. They stay where the scene was, the scene's record says so, and they will not come back for the asking until amends are made. A low bond alone never does this: the sample's apprentice travels at 9 points and has no quarrel with anyone.
- **Starting companions are Trusted.** Whoever a built world puts at the protagonist's side begins at 40.
- **Who left, and who died.** The scribe, asked at every scene end anyway, now also says who left the place for good, who went to stay somewhere else (by the id of a place nearby), and who died. The rules apply it: only to people who were in the scene, never to a companion. A person who is gone keeps their profile, with the day and the reason, under "No longer around"; spoken of later, their card tells the narrator they are gone or dead, or where they now are. Those beaten in a fight were already removed without a word; now it is said why.
- **Fates.** The disagreement noted under "The world moves" (a stage says the surveyor was sent away, her card still has her at the inn) is settled where the words are written: the builder, in its last step, may say what becomes of a named person when a stage comes to pass, or when a situation ends with nobody stepping in. The rules apply it when the time comes, and it passes by anyone who is travelling with the protagonist by then. Checked like everything else: a fate for nobody, to nowhere, at a stage that is not there, for a crowd or for a starting companion is dropped and the review says so.
- **Situations left alone.** The plan's seeds had an "if left alone" that never happened. Now one does, when the protagonist has been out of the town it waits in for four days: what people would say of it becomes local news there, it is no longer offered to the narrator, and its fate (if any) falls. At most one a chapter, never in the town where the protagonist is (there it is the narrator's to play), and only for a situation the builder wrote an outcome for; the others wait as before.
- **Telling.** `told`, the list of people who were told of an event later, existed since milestone 2 and was never written to. Now someone who saw a thing that was kept secret and mattered, and who is no friend of the protagonist (bond under 20, or holding a grievance), tells the named people where they are: two at a time, when the world's die allows, six at most for any one secret, and nothing older than ten days. A friend keeps a secret. The effect shows on cards: a third person "was told" what the protagonist did.
- **Personal quests.** The plan's Close stage "opens a personal quest". The builder now gives three or four people a wish: something of their own they want and cannot manage alone. When the bond becomes Close the waiting moment is the one in which they ask; the narrator is told what they ask, and when the moment has played it becomes a thread of theirs in the journal and on their profile. Someone with no wish has an ordinary moment. The wish is never shown before it is asked.
- **A character of your own on the Lantern Coast.** "The Glass Road" is Aren's story: his sister, his two companions, an agent already hunting him. A stranger cannot be dropped into that. So the pack now also gives the coast as a newcomer finds it: the same places, people, powers and things in motion, with nobody knowing them, nobody hostile on sight, nothing begun, and an opening of its own. The Worlds screen offers both ways in. The ready-made story is untouched.
- **The sample world gained two situations**, both away from where the story is picked up, each with the news it leaves behind if nobody steps in, and fates for two of its people. Three of its people have wishes; Mira is eight points from asking hers.

**What this costs.** Nothing per turn. The referee's instructions grew by about seventy words (paid at the cheap model's price, about one thousandth of a cent a turn) and the scribe's answer has one more list, empty almost always. The builder's last two steps write about three hundred tokens more, once a world. In the fifty-turn playtest a turn costs $0.0037, as before to the fourth decimal.

Tested (`tests/whereabouts.test.ts`, 21 tests): each rule by itself; asking, refusing, parting and coming back in play, and a rewind taking it all back; a grievance opened, halving, and settled; a companion walking out; the scribe's word on who left and died, with the cases it must not apply; fates with a stage, and the people they pass by; a situation ending by itself, by rule and in play; telling, by rule and in play; the personal quest from the bond to the thread; what the builder's cleaner keeps and drops; the newcomer's coast, started and played.

**Not built, and why:**

- **"Join for a single task"** (the Friendly stage). It needs the game to know when a task is over. A Friendly person helps in the scene they are in; that is the narrator's to play.
- **People who travel by themselves from day to day.** A person moves when something moves them: a stage, a situation, the scribe's word. Nobody has a daily round, and a model is never asked where anybody is.
- **Whether the scribe reports departures and deaths well** is unknown until it is seen with a real key. A wrong "died" would be a loss the player cannot undo except by rewinding; the schema says "almost always empty" and "plainly shows", and only people who were in the scene can be touched.
- **A front's end still does not end the story**, a school or an advantage still cannot be bought with experience, a built world still cannot be edited by hand, and places filled in during a story are still not saved back to the world for the next story. None is needed to play; each is a week of its own.

### Milestone 3 as built

**What was wrong with the row.** Three things, found before writing any of it.

1. *It left out what a character is made of.* "Character editor" assumed the rules it edits. They were not there: the sheet had six abilities and a handful of traits written for the sample hero, with no costs. A world builder that proposes a character has nothing to propose from, and an editor has nothing to check against. So the base pack came first: the full list of advantages and drawbacks with what each costs and does, thirty-six abilities, and the arithmetic of buying a character (`src/engine/traits.ts`, `abilities.ts`, `character.ts`).
2. *Its test could be passed by a broken world.* "A world is created end to end on a phone" is true of a world whose starting town has no way out, or whose guildmaster stands in a place that does not exist. Nothing in the test asked whether the result could be played. The test now starts from the other end: there is one check that every world must pass (`checkWorld` in `src/game/world.ts`), the hand-made world passes it, and a built world is not kept unless it does.
3. *It said nothing about money.* Building is the one place where the app spends several requests in a row without the player typing anything. The test now also asks that the price is shown first, that no step is ever paid for twice, and that the daily limit stops a build as it stops a turn.

**How a world is built** (`src/game/builder.ts`, `src/game/llm/architect.ts`):

- **Seven small steps, each checked before it is kept.** The map, what moves the world, the rules, what the narrator must always know, the starting area, the people, how it begins. Each is its own request with an answer of a fixed shape. The draft is saved after every step.
- **The model writes words; the rules write numbers.** The builder says a sergeant is "dangerous" and a crowd is "weak"; the numbers for those words are one table in the code, tuned against a starting character. It names ancestries as lists of traits from the game's own catalogue; what an ancestry costs is added up by the same code that prices a character. It is never asked for a hit point or a difficulty, so it cannot get one wrong, and a world built by a cheap model plays by the same numbers as one built by an expensive one.
- **Nothing that comes back is trusted.** Every answer passes through a cleaner that makes ids well formed and unique, drops whatever points at something that does not exist, brings numbers into range, breaks circles (a hall inside its own back room), joins up a map or a town that came back in pieces, keeps companions to the number the table agreed, and moves people who were put nowhere to where the story opens. What it changed is noted, for the review screen. When there is too little left to play in (two places, no description, nobody at all), the step is asked for once more with the reason; a second failure stops the build there with everything before it kept.
- **The test of that**: four hundred runs in which the seven answers are damaged at random (fields removed, ids doubled, references swapped, numbers replaced with nonsense, lists emptied). Every world that comes out passes the check, and a story can be started in it. Thirteen named cases cover the damage most likely from a real model.
- **One conversation that only grows.** Each step is sent the brief and every earlier step as it was kept (after cleaning, so later steps build on the mended version), then its own instruction. Later steps therefore read the earlier ones from the prompt cache. This saves less than it sounds: the first steps are shorter than the smallest piece the service will cache, so only the last two or three benefit, and what a build costs is mostly what it writes. The price shown to the player does not count on the saving.
- **Pausing, leaving, failing.** Pause stops after the step in hand. A draft that was building when the app closed opens as paused: nothing runs, and nothing is spent, until the player says so; it then goes on from the first unfinished step (tested by building from what storage held half-way: four requests, not seven, and the same world). A failed request stops the build at that step and is retried alone. The daily limit is checked before every step.
- **The questions** are one request before building starts: at most five, each with suggested answers; they can be answered, left blank or skipped, and they are fixed once building begins, because they are part of the cached beginning of every step.

**A character** (`src/game/creation.ts`). One small request proposes a sheet from the player's sentence, with a reason for each part, as the mockup shows. Whatever comes back goes through the rules: unknown traits and abilities dropped, numbers brought into range, and if it costs too much it is trimmed until it fits, with each change said in words. A proposal that is all nonsense still yields a legal empty sheet. Asking for one is optional: an empty sheet costs nothing. A story cannot be started with a sheet the rules refuse.

**The story begins by itself.** A story started in a built world has an opening: where the protagonist is and what is just happening. The first turn is the narrator telling it, before the player has typed anything; no referee is asked, since nobody has acted. If it fails, the story stays ready to be begun again. The clock starts at the hour the builder gave, in chapter one, with the opening task as the main thread.

**What the narrator is told about the world it cannot see.** Two new kinds of line in the scene packet, for the narrator alone: the situations planted at the place (at most two; when there is none, the nearest one a journey away, with where it is), each with who wants what, what is in the way, what happens if it is left alone and what is not as it seems; and what is in motion that shows there (at most two). The narrator reports a situation as settled, and it is not sent again. A world without them, such as the sample, sends exactly what it sent before.

**Found on the way.**

- The check that "every place the player knows of can be reached" was weaker than it read. A street with no way to it counted as reachable, because one can leave town, come back, arrive at the town as a whole and step into any part of it. True, and useless to a player standing in the square. The builder's own check now stays inside the starting area.
- A step's length limit was set at 1.7 times its usual size. A long answer cut off at the limit is worth nothing and is paid for in full, so the limit is now three times the usual size (room that is not used costs nothing), and a cut-off answer is asked for again with "use fewer words".

**The screens** (`src/app/screens/Worlds.tsx`, `WorldNew.tsx`, `CharacterNew.tsx`), from the approved mockups:

- **"New story" starts by choosing a world.** The worlds library is a fourth tab outside a story. A card for each world, a row for each world still being built (so a dozen unfinished ones stay a short list), and the sample world as a card of its own with its one ready-made story. A world can be renamed, exported to a file, imported from one and deleted; a file from elsewhere must pass the same check as a built world, and nothing in it is drawn or played on trust.
- **Six steps to a world**, as drawn: where it comes from, who you play, how the table runs, the builder's questions, the building, the overview. The draft exists from the first Continue and is saved at every step, so what was typed survives the app being closed.
- **No request without its price on the button.** The mockup had the questions arrive by themselves; asking them is a request, so it is now a button that says what it costs, next to "Skip the questions". The build says its price on its own button, and building a part again shows its price before it is agreed to. With the demo builder each of them says that nothing is charged.
- **The build belongs to the app, not to the screen.** Leaving the screen does not stop it; the library shows it at work. Closing the app does stop it: it opens again paused, and says nothing more is spent until it is resumed.
- **The overview** shows what the player may see (the map's places, the starting area, the people's names, the rules) and counts what they may not (things in motion, situations, secrets), with the mockup's "Show spoilers" opening only the names of what is in motion. What the checks mended is listed. Any part can be built again; the dialog says which later parts are rebuilt with it and what it costs.
- **The character screen** offers a proposal (one small request, priced on its button) or an empty sheet (free). Everything it shows about points and problems comes from the same code that decides whether a story may start, so the screen and the rules cannot disagree. The long lists (twenty advantages, twenty drawbacks) show what is chosen and keep the rest behind "Add".
- **Shown as "later", not hidden:** a document as the source, and the Extreme powers mode.

**Tried in a real browser, with real storage and the demo builder:** a world described, its questions asked and one answered, built, paused, left, found again in the library, resumed, read through, accepted, and a story begun in it (driven by clicks at phone size). And the interruption the milestone asks for: the page was reloaded in the middle of the third step. It came back showing two steps done and paused; three seconds later nothing had moved and nothing more had been asked for; Resume finished it, with seven requests in all, none of them twice.

**Sketched places** (`src/game/expand.ts`, `fillIn` in `src/game/session.ts`). Every place on a built map but the starting one is a sketch: a name and a line.

- **Filled in on arrival, once.** The first time the story arrives at a sketch, one request writes what is inside it: what it is like to arrive, four to six places with the ways between them, a few named people, a group or two, one or two situations. It happens inside the journey turn, after the scene that was left is written up and before the scene there opens, so the first scene in the new place already has its people and its ways. The request is told the world in brief, where the place lies, what is in motion there, who is arriving, what the story has already said about the place, and which names are taken.
- **Cleaned like everything else.** Ids new to the whole world, parents inside the place, no place inside itself, people and situations moved to the place when they were put nowhere, numbers from the rules. The parts of a place are joined to one another: from a place one can always step into what it holds but never back out into it, so a district with no street to the next would be a dead end that could only be left by leaving town. Three hundred randomly damaged answers, two or three to a world: the world passes the check every time.
- **It never stops the journey.** If the request fails, the answer is unusable, today's limit is reached or the story has it switched off, the protagonist arrives all the same, the narrator makes do with the one line as before, the turn says so, and the next arrival tries again.
- **It is part of the world, not something that happened in the story.** This is the part the plan had not thought through. Taking a turn back and rewinding work by comparing the story before and after a turn. Left alone, that would count a filled-in town as something the journey turn did: rewinding past the journey would un-write the town, and going there again would write a different one and charge for it again. So when a place is filled in, the copy of the story that the turn is measured against grows with it. What goes back on a rewind is what the protagonist knows (the new places are hidden again, the new people unmet); what was written stays, and is never asked for twice. The same holds when a journey turn is given up after the narrator fails.
- **One thing had to move for that.** A situation used to be marked as settled on the situation itself. Rewinding a list cuts it back to the length it had, which would have cut off situations a place brought later. Settled situations are now a list of their own beside the situations, which are never changed.
- **People nobody has told the protagonist about.** People written for a filled-in place are unknown until they are met or the narrator names them: they are in no list, and typing their name by chance brings nobody's card. (The people of the starting area all count as heard of: the protagonist lives there.)
- **Said before it is spent.** The map says of a sketch that it will be filled in on arrival, once, and about what that costs. Each story has a switch for it. The turn that does it shows what it cost.

**Not built, and left for later:**

1. **A filled-in place is kept by the story it was filled in for.** Another story in the same world writes its own. Saving places back to the world for future stories is the "later feature" of section 8.8.
2. **Changing a built world by hand** in the review (the mockup's Edit buttons). For now the name can be changed and any part built again. Edits will go through the same cleaner and the same check as the builder's answers, so a hand edit cannot break a world either.
3. **How long an arrival takes.** A journey to a sketch now waits for up to four requests in a row (referee, scribe, builder, narrator). With the demo that is instant; with Claude it may be twenty seconds or more, and has not been timed.

**Left for milestone 4, and shown as such in the new-world screen:** a document as the source of a world; the Extreme powers mode (the rules engine has only Focus; a world built as Extreme today would have no usable powers, so it will not be offered); fronts advancing with time (they are sent to the narrator at their first stage and do not move).

**Not seen against the live API:** anything the builder writes. The shapes, the checks and the money are tested; whether Claude's worlds are good ones to play in is not, and neither is how long a step takes on a phone.

### Milestone 2 so far

**Why the goal changed.** The plan's test for this milestone was "a 300-turn headless playtest stays within the packet budget". That was already true before any work: the packet has a fixed size by construction, and milestone 1 measured it. What a long story really strains is somewhere else, and the first measurement showed it: the save grew by about 3.5 KB with every turn (1 MB at 300 turns, 92% of it old transcripts), and the whole of it was written out again, and copied once more for safety, on every single turn. The goal now names the things that can actually go wrong (see the roadmap row above).

What is built:

- **Saves that stay small** (section 12). Measured over 300 turns with the demo narrator: the story written each turn is 134 KB at turn 300 instead of 1,045 KB, and grows by about 0.25 KB a turn instead of 3.5 KB; two scenes are held in memory instead of forty-four. What still grows is the list of past rolls and events, slowly.
- **Undo records.** After each turn the story is compared with what it was before, and the difference is kept with the turn, written backwards (`src/game/patch.ts`). Nothing in the rules has to know: whatever a turn changed, the comparison finds it. A record is about 450 bytes. The long playtest takes every one of 120 turns back and checks the result against the story as it stood, byte for byte.
- **Rewinding**, as drawn in the journal mockup: to the start of any scene. The journey that brought the character there is kept, so "the start of the scene" means standing in it. The story as it was is kept first as a separate copy, so nothing is lost, and no request is made, so it costs nothing. Not offered under the Brutal style. A story saved before undo records existed can be rewound only to where it was upgraded.
- **The dice go back too.** After a rewind the same actions meet the same rolls: a story is replayed, not re-rolled. The same now holds for taking back an action with Stop, which before this let a player stop on a bad roll and roll again.
- **Story management** on the stories screen: rename, duplicate ("play another way from this point"), rewind, export with its size, delete.
- **Files that can be trusted.** An export holds the whole story. On import, a file that is not a story, is from a newer version, or is damaged is refused with the reason; the check ends by building what the narrator would be sent, so pieces that do not fit are caught before anything is stored.
- **Upgrade of existing saves**, tried in a real browser on a database made the way the first build made it: a 45-turn story came through with every turn, and took a new turn afterwards. Each story is also kept aside exactly as it was before the upgrade (in the `kv` table, under `story-before-format-2:<id>`), so it can be recovered if the upgrade ever proves to have got something wrong; the copy goes when the story is deleted.

Found on the way: the first version of rewinding looped for ever when taken back to a scene with no turns left in it (the story's first scene). The 300-turn test had only rewound to scenes in the middle of the story. It is fixed, and the test now rewinds to every point that is offered, of every kind.

**Memory over a long story** (the second half of the milestone), as built:

- **Chapters end by rule, and what they leave is never rewritten** (`src/game/chapters.ts`). A chapter ends at the end of a scene when a main thread was finished in it, or after twelve scenes or ninety turns, and never before it is three scenes long. The scribe writes it up in the same call that writes up its last scene, so a chapter costs no extra request: a summary of a few sentences, the same in one line, and a title for the chapter that begins. Destiny points are restored and the softened death test renews. The narrator is sent the two newest finished chapters in full, the eight before those as one line each, and a short "this chapter so far" that the scribe updates at scene ends. So the part of the summary that is rewritten never carries more than one chapter, and a story a hundred chapters long sends no more about its past than one ten chapters long (tested).
- **News spreads by rule** (`knowledgeOf` in `src/game/cards.ts`). A secret is known only to those who were there or were told. Something local is talk in its own settlement six hours later, and nowhere else. Something public is known in its settlement after six hours and across the country after three days. Nothing is written down when news spreads: what a person has heard is worked out from where they are and how long ago it happened. It reaches the narrator marked "Has heard", with the instruction that hearsay is second-hand and may be partly wrong.
- **Which memories a person has in mind** (`memoriesFor`). Two or three reach a card, weighed by how the person knows it (being there, being told, hearsay), how much it mattered, how long ago it was (with a floor, so that what mattered most never fades out), whether it was done to or for them (a slight counts for more than a kindness), whether the player chose to keep it on their profile, and whether it bears on the scene (this place, these people). At most one is hearsay, and only when it is worth repeating. The memories are added after the person's description has been cut to its budget: before, a long description cost a person their memories.
- **One window per story.** A window holds a lock for the story it has open. A second window that opens the same story is told so and cannot change it; when the first is closed, "Try again" takes the story with everything played there. Tried in a real browser with two copies of the app. Settings also says how much room the app's data takes and whether the browser has agreed to keep it.

Measured after all of this (demo narrator): a turn still costs about $0.0035; the first scene packet is about 1,130 tokens (it was 1,030: a chapter summary, hearsay, and room for major people's secrets).

- **The codex**, a fourth tab of the journal: the people met, the places known, the powers of the world and the things carried, with search, filters by kind, and a page of twenty per kind so that a world of hundreds stays usable. Nothing the protagonist has not discovered is shown or searched: no secrets, no hidden places, not where a hostile person is. The mockup's lore entries ("Copies of the baron's seal") are left out: there is no data behind them until worlds carry lore (milestone 3).
- **The recap**, "Previously…", opened from the stories screen and from the journal: the finished chapters, the chapter so far, the last scene with its most telling roll, where the player stopped, and what was earned (experience, destiny, how bonds moved in the chapter). It is put together from what is saved, so opening it makes no request. Not built from the mockup: the end-of-chapter page with "meanwhile, elsewhere", which needs the world to act on its own (milestone 4).

With that, everything this milestone set out to do is built. What remains is to see it against the live API.

Noticed, for milestone 3: the People screen lists every named person not yet met as "heard of". That is true of the sample world, but a world with people the protagonist has never heard of will need a flag for it, as places have; until then the codex lists only people who have been met.

Not built, and deliberately left for later: characters telling each other things off stage (the "told" list on an event is still written by nothing), which belongs with the world's fronts and clocks in milestone 4.

### Milestone 1 as built

What exists (run it with `npm run dev`; see the README at the project root):

- **Engine** (`src/engine`): tests, combat with grouped opponents, bonds, time, experience, the encounter simulator. 350 unit tests.
- **Game layer** (`src/game`): the world and memory model, the scene packet with fixed budgets, retrieval by name and keyword, the turn pipeline, the three request builders, the real Claude client, and a demo client that answers locally and simulates the prompt cache on the real request layout.
- **Sample world** (`src/packs`): The Lantern Coast and "The Glass Road", picked up on day 12 so that characters have a past to remember.
- **App** (`src/app`): welcome and key, stories, play (with fights and every blocked-turn state), people, a person's profile and history, character sheet, journal, map, settings, usage.

What the fifty-turn playtest measured, with the **demo narrator** (estimated token counts, replies about as long as real ones, Balanced preset):

| Measure | Result | Plan's estimate (7.4) |
|---|---|---|
| Cost per turn, all roles | about $0.003 | about $0.007 |
| Share of the narrator's input read from the cache | 87% | not stated |
| Scene packet | about 1,000 tokens, the same at turn 1 and turn 50 | 1,000 to 2,000 |
| Largest narrator request | about 4,200 tokens | about 9,500 |
| A pause of more than five minutes | one cold turn of about a cent, then warm again | "a few cents at most" |

After the changes that followed the first playtest (longer instructions for the narrator, and two questions to the narrator among the fifty turns) the same run measures about $0.0035 a turn, 89% of the narrator's input from the cache, and a largest request of about 4,900 tokens. The changes after the second playtest (a Referee call for every journey, the traits in the packet) leave it at about $0.0035 a turn, 89% and about 5,000 tokens.

These are not live figures. The estimate in 7.4 assumed a larger fixed prompt and longer scenes than the prototype has; the first real session will show which is closer. **Not yet done for milestone 1:** a session against the live API (needs a key), the blind comparison of narrator models (decision 3), and measuring whether a one-hour cache entry or a keep-alive is cheaper for real pauses (7.2).

Differences from this plan, all deliberate:

- One package with folders (`src/engine`, `src/game`, `src/packs`, `src/app`) instead of the `packages/` workspace in section 13. The boundaries are the same (engine and game import nothing from the browser); splitting into packages can wait until there is a reason.
- Memory search is a small keyword scorer in `src/game/search.ts`, not MiniSearch. It can be swapped behind the same function.
- The narrator answers in plain text with a short block of `key: value` facts after a `===` line, not in JSON: it is cheaper to produce and natural to stream. The referee and the scribe use structured outputs.
- Not in the prototype: world creation, character creation, document reading, the Portuguese interface, installing as an app (PWA), learning new abilities, the codex.

---

## 15. Decisions

Settled with the project owner on 15 and 16 November 2026.

| # | Decision | Outcome |
|---|---|---|
| 1 | Platform | Installable web app first; wrapper later if wanted. |
| 2 | Licensing route | The rules in our own words under our own name, credited to 3D&T and its author, plus an e-mail to Jambô asking them to confirm the author's Open Game statement covers a free app. |
| 3 | Narrator model | Player-selectable with three presets (Haiku 5.5, Sonnet 5.5, Opus 5.5). Sonnet 5.5 is the shipped default, to be confirmed by a blind comparison in milestone 1. |
| 4 | Focus range | 0 to 5, with our own tiered ability list and mythic abilities gated by multiple paths and story conditions. |
| 5 | Dice honesty | No hidden fudging; table styles and destiny points instead. |
| 6 | World map model | Graph of places with lazy detail, schematic map drawn by code. |
| 7 | Stack | TypeScript, React, Vite, IndexedDB. |
| 8 | Languages at launch | English and Brazilian Portuguese. |
| 9 | Code license | AGPL-3.0-or-later for code, CC BY-SA 4.0 for original game content. The recommendation was an either/or with MIT; it is settled toward AGPL because that keeps derivatives of a non-profit project open. It can still change before the first public commit. |
| 10 | Names | App: **Bitor Quest**, for now. Ruleset: **Penta**. |
| 11 | Social play | A core system present from the first prototype: bonds, party, favorites, moments with characters (10.7). Romance, friendship and companions are essential to the app. |
| 12 | Design direction | **Slate**, chosen from six explored directions (`docs/mockups/play-screen/`). Requested changes are applied: dice checks show a white die with black pips that rolls, and speech bubbles are outlined in the speaker's colour. Colour schemes for different kinds of story come later, as alternative sets of design tokens. The working mockups live in `docs/mockups/slate/`. |
| 13 | Images | None for now. Characters are shown as initials in their own colour. If images are added later, the options are built-in avatars, the player's own pictures, an image service with the player's key, or a generator on the player's PC. |
| 14 | Bond | A number from 0 to 100 in five stages, with gains sized by how much an act mattered, and a curated list of memories on each profile (10.7). |

| 15 | Screens | All 17 screens are drawn in Slate for phone and PC (`docs/mockups/slate/`), on one shared design system (`slate.css`, `slate.js`). Fights show both dice and describe opponents by condition; every interruption (offline, errors, refusals, limits) says what happened, what it cost and what to do next. |

Open after the mockups: the numbers in 10.9 are assumptions to confirm; colour schemes for other kinds of story are not drawn; the Portuguese interface is not drawn.

| 16 | Crowded screens | Map levels as a path; a one-row people strip with crowds as single entries; grouped opponents in fights (section 11, "Rules for crowded screens"). |

| 17 | Writing style | Plain, Clear or Literary per story; Clear by default. In every style, what the player needs to decide is stated literally (section 11). |
| 18 | Out of the story | The player can speak to the narrator outside the story ("To: The narrator", or a line starting with `//`). Such a question is read from the cache, is never added to the scene, and changes nothing in the story. |
| 19 | Asking instead of guessing | When the Referee cannot tell what the player means and it matters, the game asks once, before anything happens. No action buttons whose effect the player cannot predict: "Spend time together" is removed, and time with a character is asked for in the story. |
| 20 | Motion | The app is animated throughout, behind one setting that follows the device by default. |
| 21 | Themes | Many colour themes, solid and gradient, and a custom one; all derived by code with guaranteed text contrast. Themes per kind of story (a world suggesting its own) remain for later. |

| 22 | Leaving a place | Travel, typed or chosen on the map, is the character asking to leave. The Referee judges whether they are free to go; the map never decides (section 6). |
| 23 | Traits | Every advantage, disadvantage and skill says on the sheet what it does. Traits without a number are sent to the narrator, who plays them; none is decoration. The full catalogue comes with character creation. |
| 24 | Reading position | Text arrives in whole passages, the first one as soon as it is complete and the rest on Continue; it is never typed out. The view moves once for each thing that appears, only as far as it takes to show it and at most until its start is at the top. No empty space is added, and the view never moves under a reader who has scrolled. |

| 25 | Saves | The story's present state and the transcripts of finished scenes are stored apart, so a turn writes the same amount at turn 3,000 as at turn 3. The format is versioned; older saves are upgraded when first opened. |
| 26 | Rewinding | To the start of any scene, keeping a copy of the story as it was, at no cost. Not under the Brutal style. Built on a record of what each turn changed, not on copies of the whole story. |
| 27 | Dice and going back | Going back never re-rolls: after a rewind, or after taking an action back with Stop, the same action meets the same roll. |

| 28 | Chapters | They end by rule, not by the narrator's say: a main thread finished, or about a session of play. Each leaves a summary that is never rewritten, and only the chapter being played has a summary that is. |
| 29 | What people know | Being there, being told, or hearsay. Hearsay spreads by rule from an event's reach, place and age, is never a secret, and is marked as second-hand for the narrator. |
| 30 | What people have in mind | A person's card carries the two or three memories that weigh most now, not the most important ever nor the newest. Memories are never cut to make room for a description. |
| 31 | One window per story | The same story cannot be played in two windows at once. |

| 32 | One check for every world | A world is kept only if it passes the check the hand-made world passes: one root, every route between places that exist, a start that can be left, everyone somewhere, rules the engine knows. The world builder's answers are cleaned until they do, or the step is asked again. |
| 33 | Words from the model, numbers from the rules | The world builder describes (a person is "dangerous", an ancestry has these traits) and code gives the numbers. No model is asked for a number the rules depend on. |
| 34 | Paying for a world | The price is shown as a range before anything is spent; progress is saved after each of seven steps; a step that is done is never paid for again; a build can be paused; the daily limit applies. |
| 35 | One review, at the end | The player reads the whole world once and may have any step built again, which rebuilds the steps after it. No approval half-way. |
| 36 | A proposed character is a suggestion | It is made legal by the rules before the player sees it, with every change said in words, and the player edits from there. A story never starts with a sheet the rules refuse. |
| 37 | A story opens itself | The narrator tells the first scene before the player types. What is waiting in the world, and what is moving in it, are told to the narrator alone, place by place. |
| 38 | What a new character owns | By rule, not by the model: silver by Wealth or Poor, bandages by table style (10.9). The proposal adds only plain things with no numbers. |
| 39 | A price on every button that spends | Asking the builder's questions, building, building a part again and proposing a character are each a button that says what it costs. Nothing is asked of Claude as a side effect of opening a screen. |
| 40 | A build outlives its screen, not the app | A build goes on when its screen is left. When the app closes it stops, and waits paused: it never resumes by itself. |
| 41 | The sample world | It is in the worlds library as a card of its own, with its one ready-made story. Making a new character in it comes later. |
| 42 | Sketches | Every place on a built map but the starting one is one line until a story arrives there; then it is written once, inside the journey turn, and kept. Arriving, not asking, is what fills a place in. It never stops the journey. |
| 43 | The world grows outside the story's time | What is written for a place survives rewinds and turns that are given up: only what the protagonist knows of it goes back. Nothing is written or paid for twice. |
| 44 | Unknown people | Someone the protagonist has never heard of is listed nowhere and cannot be asked after by name, until they are met or named in the story. |
| 45 | The world moves once a chapter | What is in motion advances one stage a chapter, by rule and a die, not by the calendar alone and not by a model. No request is made for it. |
| 46 | News | A stage becomes news only if people would see or hear of it. It starts wherever the thing shows, spreads by the hearsay rule, and reaches the player through the story. The game itself announces nothing; the recap lists only what is being said where the protagonist is. |
| 47 | The protagonist can hold the world back | The scribe says when a scene set something in motion back or ended it; the rule does the rest. |
| 48 | The world's dice | Rolled apart from the player's and kept with the story: the world moving never changes a roll of the player's. |
| 49 | Finding abilities | An ability is found by being taught or by trying it and succeeding, then learned for a point of experience and a Skill test. Who teaches is a fact of the world; whether they will depends on the bond. |
| 50 | Effects of the player's own | Allowed within a path or school the character has, always a test and never free, on a fixed scale of reach. They work once: nothing a model made up becomes a rule. |
| 51 | The Extreme mode | A school is every ability of its paths, with no learning. The limits are a price that climbs steeply and may not pass five times Skill, and the energy pool. |
| 52 | Between turns | What the player changes between turns (experience spent, an ability learned, an item used) is taken back by a rewind like anything else, dice included. |
| 53 | A document is read once, by the cheapest model | Notes of at most 300 words a part, brought together into one description of at most 1,400 words. The builder works from that and never sees the document. Reading is a priced step of its own, paused and resumed like a build, and no part is read twice. |
| 54 | A document is material, never instructions | The reader and the builder are both told so, and the document is sent between marks. Nothing written in it changes what is asked of a model. |
| 55 | What leaves the device from a document | Its text, without what repeats from page to page (running heads, page numbers, a buyer's stamp wherever it stands) and without any e-mail address. The file itself never leaves, and the text is not kept once the notes are taken. |
| 56 | Kinds of file | Text, Markdown, and PDF with a text layer. Scans are turned away with the reason. PDFs are read by pdf.js 6.5.438 (Apache-2.0), fetched only when a PDF is chosen; its optional drawing package is installed by npm and never loaded. |
| 57 | Company | Someone travels with the protagonist from the Trusted stage, when asked in the story, if the party has room and they hold no grievance. A companion stays behind at a word, and one who has travelled before comes back when asked. Whoever starts at the protagonist's side starts Trusted. |
| 58 | Grievances | A betrayal or a broken promise is held against the protagonist until they do something for that person that matters. A companion who holds one and is no longer Friendly leaves at the end of the scene. |
| 59 | Who is where | People move when something moves them: a stage of what is in motion, a situation ending, or the scribe reading in a scene that they left or died. No model is asked where anybody is. Someone gone keeps their profile and the reason. |
| 60 | Fates | What becomes of a named person without the protagonist is written when the world is built and applied by rule; it passes by anyone travelling with the protagonist. |
| 61 | Situations left alone | End by themselves after four days out of the protagonist's sight, one a chapter at most, never in the town where the protagonist is, and only when the builder wrote what comes of them. |
| 62 | Telling | A secret that mattered is passed on by those who saw it and are no friends of the protagonist, a few people at a time, six at most. A friend keeps it. |
| 63 | Personal quests | A person's wish is asked of the protagonist in the moment the Close stage brings, and becomes a thread of theirs. It is never shown before. |
| 64 | Two ways into the sample world | The ready-made story with Aren, or the same coast on its first day for a character of the player's own, as a stranger. |
| 65 | Installed and offline | The site installs from the browser. A worker written at build time keeps the app's files on the device; it never touches a request to the Claude API. A new version is announced, not sprung. |
| 66 | Two languages | English is the source and the key; Portuguese is looked up. A marked text with no Portuguese fails a test and is shown in English meanwhile. A note in double brackets tells apart two meanings of the same words. |
| 67 | Whose language | The interface: the app's setting. What the game writes into a story: the story's language, for good. What is sent to a model: English, except that the referee and the scribe of a Portuguese story word what the player reads in Portuguese. |
| 68 | Not translated | The sample world and its story, and the demo narrator. |
| 69 | Licence files | AGPL-3.0-or-later for the code, CC BY-SA 4.0 also for the game content, and notices generated from what the build contains. Still changeable before the first public commit (decision 9). |
| 70 | Android | The installed web app is the Android app. A store package is described and not built. |
| 71 | The player throws the dice | The rules settle a turn and the narrator is asked at once; what the player has not thrown is not shown, and the screen stays as it was until the dice have landed. One card at a time, "All" for a crowded round, a setting to let the app throw. The number is never the click's to change. |
| 72 | A fourth powers mode, Gift | For worlds where a power is personal. One power for each character, written in words, with a rank, two kinds of fight effect and a few moves. A "Lore" mode in which the narrator alone judged what a power can do was considered and turned down: it would have left fights untouched, set no price, and had no judge able to say no. |
| 73 | Decision 50, in a Gift world | Reversed there, and only there. An invented use that worked can be kept as a move. What is kept from a model is a place on two fixed scales it already judges (a reach from 1 to 4, one of the power's two kinds); the name and the words are the player's; every number is the engine's. In worlds of paths and schools decision 50 stands. |
| 74 | Decision 33, read for Gift | Unchanged: no model is asked for a number the rules depend on. A model may place something on a fixed scale (a tier, a kind, how able someone is in a fight), and the engine owns what the scale means. A person's power has its tier set by code. |
| 75 | A player's words are never a result | The name and text of a power and of a move are the player's (or a model's on their behalf). The narrator is given a move's words with the reach it may have, never "it works as described", and is told that a power settles no test, fight or person's will by itself. They are shown as written and never passed through the dictionary. |
| 76 | Other people's powers | One simple power for a named person in a Gift world, used with their attack on their first turn and every third after it. Held to tier 1 by simulation: at tier 2 a dangerous opponent's took twenty-six points off the weakest Champion's chances. A stagger is the whole of that turn, or it cost the other side a third of their actions for nothing. |
| 77 | Fights, in every mode | Changed with Gift, for worlds of paths and schools as well: an effect of the player's own counts in a fight; a refused action is not a turn and asks no model for anything; nobody loses two actions running; a power that mends does so outside a fight too; a damaging power turned on someone who can fight opens the fight; the encounter tuner credits the protagonist's damaging powers; the protagonist uses Firepower when it is the higher. |
| 78 | No new save format for Gift | Every new field is optional, and a power read from a file is held to the rules like one a model proposed. An older copy of the app would read a Gift story as one of paths; the installed app updates itself, so this is accepted. |
| 79 | Several powers on one sheet, in Gift worlds | One power by nature and up to three more gained in play, kept in a wrapper that says where each came from. Four in use at most and eight moves in all. Extra powers come only in play: at the same points two powers do no better than one, and trained powers are unlocked with experience. |
| 80 | Disciplines | Powers the world writes and people teach: taught as a tier-3 ability would be, learned for 10 experience. One that cannot be taught awakens only in the scene in which the hero was brought down, or the next. |
| 81 | Items of power, from 3D&T's magic items | Eaten (the power is the eater's own, for good) or carried (the holder's while held). Found for nothing: the narrator reports `got:`, and the engine accepts it only when the item is free to take. The narrator reports a story fact; the item and its power are the world's. |
| 82 | Seal is for opponents only | It takes the place of their attack, as a stagger does: on top of it, it took 21 points off the weakest hero's chances. For the hero it was never better than striking, so it is not offered. |
| 83 | The hero's copy and steal last one scene | At the lower of the use's reach and the person's rank, one at a time, nothing kept. A permanent steal was turned down: it would have been the best way to grow in the game. |
| 84 | Robbed | A thief who beats the hero takes their power by nature (or best discipline). Held, it comes back when the thief is beaten, flees from a lost fight, or dies; erased, it is gone, except in the Story style. The narrator tells it; when it is taken and when it returns is the engine's, from what the world wrote, so that no model grants or removes a rule and the player is never without an appeal. |
| 85 | People's powers have a rank | 1, 2 or 3 for a weak, able or dangerous fighter, set by code, and used only when someone else holds the power. In their own hands it acts at tier 1, as decision 76 set. |

| 86 | Money | Named by the world (up to three moneys, each on a scale of worth; coins of one money pay for each other, separate moneys are changed at a tenth). Prices are words the referee or the narrator chooses; the amounts are the rules'. The purse and what is carried are on the YOU line. |
| 87 | What the narrator may move | Money outside a trade (`paid:`, `spent:`, with a price word) and plain things (`gained:`, `lost:`), two of each a reply. A fortune only with a thread finished. Never an item of power. |
| 88 | Looks | Appearance is kept apart from personality: in full when someone is first met, a few words after. The scribe may change a look for a lasting change; personality is never rewritten by a model. |
| 89 | Pictures are references | Read once into words on the cheapest model and forgotten; never kept, never shown. Where they are offered: replaced by 98. |
| 90 | Another take | The newest turn, told again with the same dice and results; every telling kept and any can be chosen again for free. Not after a change between turns; once a scene under Brutal. A note on the telling is sent once and never kept. |
| 91 | Kept as true | The player's words, on the card of what they are about, each with a budget; four about one person or place, six about the story. A correction is also told to the scribe for the scene. Taken back by a rewind. |
| 92 | Efforts that add up | Three or five successes before three failures (four in the Story style). The referee names the effort and marks each step; the engine counts and decides. One at a time; it lapses with the chapter. |
| 93 | Time off | Removed: replaced by 97. |
| 94 | Endings | Chosen per story (and as a world's default): about 3, 6 or 10 chapters, the last one marked for the narrator. The epilogue is written when asked, once. Then a new season, or a new hero in the same world who hears the old one's legend. A story kept before this goes on. |
| 95 | The book | One HTML file made on the device, no request. |
| 96 | A start for the empty page | Eight worlds and a roll of four parts, in the interface's language; they only fill the box. |
| 97 | Letting time pass | Said in the story, never a screen of its own. Half a day at most simply passes; longer is asked about first by the game, for nothing, up to two weeks. The narrator ends it early when what the story set up comes sooner and says how long it took; the engine holds it to what was agreed. Recovery for the time passed; three days or more move the world on once more; a day or more ends the scene. Not in a fight or during an effort under way. |
| 98 | Pictures only for companions | Offered for the companions who start a story (when it begins) and on a companion's profile. Not for the world, who you play, or the hero. The answer is a look and a description, cut at a sentence or a word. |
| 99 | Companions in the player's words | Look, appearance and who they are, before a story begins and on the profile later; between turns, told to the narrator once. Empty words leave a part as the builder wrote it. |
| 100 | Openings that orient | The first scene opens with a brief introduction (who, where, why today, why the companions are there, what just happened) before the player's first move. |
| 101 | Plain prose by default | For new worlds and stories; a story kept before keeps its own. |
| 102 | Long descriptions | 12,000 characters for a world's description, 4,000 for who you play; read only while building. |
| 103 | Three services | Claude, Venice or NanoGPT, chosen per role (narrator, referee, scribe, world builder, pictures); a model's id names its service and each request goes only there. Claude's path is unchanged. The others share one OpenAI-style client: answers held to the schema where the model allows it, the shape always also said in words (the field descriptions carry the rules), mended and checked on arrival. Venice's own models only, by default, enforced in the client; NanoGPT's zero-retention providers on request. When another service narrates and Claude still judges or records, the player is told Claude reads every scene. |

Next step: the project owner's. A session with a real key, on a real phone if possible, with these to look at: one world built by Claude from a description and one from a document; a session long enough to end a chapter (twelve scenes), to see what the scribe makes of a chapter, how the narrator uses hearsay, whether the scribe reports who left and who died sensibly, and whether it judges "set back" and "ended" well; a companion asked along, refused, and later accepted; one story in Portuguese, to read the referee's and the scribe's words; the Referee's judgement of who is free to leave; and one Gift world with a hero from a premise such as "ate a fruit that made my body rubber", a dozen turns and a fight, to see whether the proposed power reads like the premise and how the Referee rates new uses of it; and one One Piece world built from the setting, to see whether the builder writes sensible Haki and a fruit, whether the Referee picks the right power among several, and whether the Narrator reports an item taken only when the story gives it. And for what was added on 2026-11-19: a few purchases, a haggle and a sale in a world with two moneys, to see whether the referee picks the right price word and money; a chase or a search played to its end; Another take on a turn that went wrong; a correction kept and then a scene end, to read what the scribe records; time off asked for when the story has announced something, and when it has not; a picture put into words on Haiku; and a short story with an ending played to its epilogue. Then the e-mail to Jambô, the first commit, and publishing.

---

## Appendix A — Sources

- Jambô Editora, [Licença Aberta](https://jamboeditora.com.br/licenca-aberta/), version 1.0, 24/06/2026; coverage at [JogaD20](https://jogaod20.com/2026/06/27/licenca-aberta-jambo-editora/).
- Marcelo Cassaro's Open Game statement, as reproduced near the end of *Manual dos Monstros* (`docs/rulebooks/text/manual_dos_monstros.txt`, lines 2959–2974).
- Browser access to the Claude API: [Simon Willison's note on CORS support](https://simonwillison.net/2024/Aug/23/anthropic-dangerous-direct-browser-access); the [official TypeScript SDK README](https://github.com/anthropics/anthropic-sdk-typescript) (browser support is opt-in; React Native is not supported).
- Model prices, caching rules and API behavior: Claude API reference snapshot dated 3 November 2026. Re-check before release.
- Rules facts: the four books in `docs/rulebooks/`.

## Appendix B — What is in `docs/rulebooks/` (not committed)

| Path | Content |
|---|---|
| `*.pdf` | The four source books as supplied. |
| `text/*.txt` | Plain-text extracts of each book. |
| `digests/core_1_characters_combat.md` | Core book: creation, attributes, 52 advantages, 28 disadvantages, 39 ancestries, 11 skills, full combat procedure, checklist of rules an engine must implement. |
| `digests/core_2_magic_items_gm.md` | Core book: magic rules, 187 spells, magic items, power scales, game-master chapter, experience rules. |
| `digests/manual_do_defensor.md` | About 97 optional rules by chapter, and eight sample settings showing how the system is reskinned per genre. |
| `digests/manual_da_magia.md`, `manual_da_magia_spells.md` | Focus and Extreme magic rules; 184 spells with requirements in both systems; counts of spells per Focus level. |
| `digests/manual_dos_monstros.md` | Bestiary: stat-block format, 335 creature entries, stat ranges by threat tier, a vocabulary of recurring special abilities. |

The digests are working notes in English made for design and for building the base pack. They paraphrase the books and are for internal reference only.
