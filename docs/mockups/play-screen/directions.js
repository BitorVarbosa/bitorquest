// Shared by index.html (gallery), contact.html (contact sheets) and the standalone build.
// One entry per design direction for the play screen.
window.DIRECTIONS = [
  {
    slug: 'candlelit-codex',
    name: 'Candlelit Codex',
    tagline: 'Dark, warm, bookish',
    summary: 'Reading an adventure novel by candlelight: continuous serif prose on deep warm browns with old-gold accents.',
    bestFor: 'Long reading sessions at night; fantasy and romance told like a novel.',
    weakness: 'Its warmth is in the typography, not the people: companions are initials and small pips. Dark only, and less natural for science fiction.',
  },
  {
    slug: 'paper-ink',
    name: 'Paper & Ink',
    tagline: 'Light, typographic',
    summary: 'A well-set paperback: warm paper, ink text, hairline rules and a single accent colour.',
    bestFor: 'Daylight reading; the calmest, most legible page, with mechanics shown like tidy rulebook tables.',
    weakness: 'The quietest for social play: companions are names and pips, with no faces or colour of their own.',
  },
  {
    slug: 'slate',
    name: 'Slate',
    tagline: 'Neutral, modern, adaptive',
    summary: 'A clean product interface with dark and light themes whose accent colour comes from the world being played.',
    bestFor: 'A dependable shell for any genre that re-colours itself per world and already has dark and light themes.',
    weakness: 'Looks like a well-made general app rather than a story world; the top area takes a fifth of a phone screen.',
    themes: ['dark', 'light'],
  },
  {
    slug: 'companion',
    name: 'Companion',
    tagline: 'Messaging style, character-first',
    summary: 'A warm conversation with your party: avatars, bubbles, bond hearts and a contact list of the people you care about.',
    bestFor: 'Playing for the company: party, bonds and favourites are always in view and one tap away.',
    weakness: 'About a third of a phone screen is chrome and speech bubbles cost height, so less story fits per screen. Light theme only so far.',
  },
  {
    slug: 'stagelight',
    name: 'Stagelight',
    tagline: 'Visual novel, cinematic',
    summary: 'A stage with the characters on it and a dialogue box that presents the current beat, with choices as buttons.',
    bestFor: 'Character-driven and romance stories: the cast on a lit stage, a spotlight on whoever speaks.',
    weakness: 'The stage takes a quarter of a phone screen, and every scene and character needs art that the app would have to produce for any genre.',
  },
  {
    slug: 'arcade-hud',
    name: 'Arcade HUD',
    tagline: 'Game-forward, tactical',
    summary: 'A heads-up display that shows the machinery: segmented bars, dice readouts and tagged system lines.',
    bestFor: 'Players who enjoy the machinery: dice, gauges, costs and bonds shown as instruments.',
    weakness: 'Dense and cool: chrome takes about half a phone screen while typing, and it is the least warm for romance or slice of life.',
  },
];
