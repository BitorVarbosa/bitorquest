// Every screen of the Slate mockups, in the order a player meets them.
// Shared by index.html (the viewer), contact.html (contact sheets) and the tools in ../_tools.
// states: [value for ?state=, label]. The first state is the screen's default.
window.SCREENS = [
  { group: 'Start', file: 'welcome', title: 'Welcome and key', note: 'First run: the API key, language, daily limit and narrator.',
    states: [['first', 'First run'], ['error', 'Key rejected'], ['valid', 'Key accepted']] },
  { group: 'Start', file: 'home', title: 'Your stories', note: 'The story to continue, then every other story.',
    states: [['list', 'Stories'], ['empty', 'No stories yet']] },

  { group: 'New story', file: 'worlds', title: 'Worlds', note: 'Reusable world templates; choosing one for a new story.',
    states: [['list', 'Manage'], ['pick', 'Choose for a new story'], ['empty', 'No worlds yet']] },
  { group: 'New story', file: 'world-new', title: 'World creation', note: 'Six steps from an idea to a finished world, with the cost shown first.',
    states: [['source', '1 Source'], ['premise', '2 Who you play'], ['table', '3 Table settings'], ['questions', '4 Questions'], ['building', '5 Building'], ['overview', '6 Overview']] },
  { group: 'New story', file: 'character-new', title: 'Character creation', note: 'A proposed sheet, then the point-buy editor.',
    states: [['proposed', 'Proposed'], ['edit', 'Editor'], ['over', 'Over budget']] },

  { group: 'Play', file: 'play', title: 'Play', note: 'The story, the dice, the people with you. The screen everything else follows.',
    states: [['continue', 'Reading'], ['input', 'Your turn'], ['people', 'People open']] },
  { group: 'Play', file: 'combat', title: 'Combat', note: 'A fight: action buttons, both dice, opponents by condition.',
    states: [['turn', 'Your turn'], ['resolve', 'Result'], ['down', 'At 0 hit points'], ['won', 'Fight over']] },
  { group: 'Play', file: 'system-states', title: 'When something is in the way', note: 'Waiting, offline, errors, refusals, limits.',
    states: [['thinking', 'Narrator writing'], ['offline', 'Offline'], ['error', 'Service error'], ['rate', 'Rate limit'], ['refusal', 'Declined'], ['budget', 'Limit reached'], ['key', 'Key stopped working']] },
  { group: 'Play', file: 'recap', title: 'Previously…', note: 'Shown when returning to a story, and at the end of a chapter.',
    states: [['return', 'Returning'], ['chapter', 'End of a chapter']] },

  { group: 'In the story', file: 'people', title: 'People', note: 'Everyone you know, by where they are and how close you are.',
    states: [['all', 'Everyone'], ['empty', 'Nobody yet']] },
  { group: 'In the story', file: 'person', title: 'A person: Mira', note: 'Where the bond stands, why, and what to do next.',
    states: [['profile', 'Profile'], ['history', 'Full history']] },
  { group: 'In the story', file: 'character', title: 'Character sheet', note: 'Attributes, abilities and what you carry.',
    states: [['sheet', 'Sheet'], ['abilities', 'Abilities'], ['inventory', 'Inventory']] },
  { group: 'In the story', file: 'advance', title: 'Spending experience', note: 'Raise an attribute or a path, learn an ability.',
    states: [['spend', 'Choose'], ['learn', 'Learning test'], ['done', 'Done']] },
  { group: 'In the story', file: 'journal', title: 'Journal', note: 'Open threads, the story so far, what you have discovered, every roll.',
    states: [['threads', 'Threads'], ['story', 'Story so far'], ['codex', 'Codex'], ['rolls', 'Rolls']] },
  { group: 'In the story', file: 'map', title: 'Map', note: 'What you have discovered, and travelling.',
    states: [['local', 'Port Varn'], ['travel', 'Travel'], ['region', 'The Lantern Coast']] },

  { group: 'App', file: 'settings', title: 'Settings', note: 'The key, models, spending limits, and the settings of one story.',
    states: [['app', 'App'], ['story', 'This story']] },
  { group: 'App', file: 'usage', title: 'Spending', note: 'What the key was charged: by day, by story, by role.',
    states: [['overview', 'Overview']] }
];
