# Licence of the game content

The **code** of Bitor Quest is licensed under the GNU Affero General Public License, version 3 or
later. Its text is in [LICENSE](LICENSE).

The **original game content** in this repository may also be used under the Creative Commons
Attribution-ShareAlike 4.0 International licence (CC BY-SA 4.0):
<https://creativecommons.org/licenses/by-sa/4.0/legalcode>

That content is:

- the Penta rules as they are worded here: the texts of abilities, traits, skills and of the rules
  notes (`src/engine`, `src/game/llm/prompts.ts`, and their translations in `src/i18n`);
- the sample world "The Lantern Coast" and its story "The Glass Road" (`src/packs`);
- the demo world "The Cinder Vale" (`src/game/llm/mockArchitect.ts`);
- the documents in `docs/` written for this project, and the interface texts.

Where such a text sits inside a source file, the file as a whole is code under the AGPL; the text in it
may be taken out and used under CC BY-SA 4.0 instead.

To attribute it, credit "Bitor Quest" with a link to the project, say that it is under CC BY-SA 4.0,
and say if you changed it.

## What is not ours to license

- **3D&T.** The Penta rules are mechanically descended from 3D&T by Marcelo Cassaro, who released
  that system's rules as open game content. Penta is written in our own words. No text, names,
  characters, illustrations or settings from the published 3D&T books are in this repository, and
  nothing here is licensed from, endorsed by or affiliated with their publisher.
- **Claude and Anthropic.** Bitor Quest talks to the Claude API with a key the player supplies. It is
  not affiliated with Anthropic. What Claude writes during play is governed by Anthropic's terms for
  the player's own account.
- **What you make.** The worlds you build, the documents you build them from, your characters and
  your stories are yours. Nothing in these licences claims them, and none of it ever leaves your
  device except in the requests your own key sends to the Claude API.
- **Third-party packages.** See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
