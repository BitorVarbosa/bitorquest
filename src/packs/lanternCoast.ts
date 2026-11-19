// The sample world and story for the prototype: The Lantern Coast, and "The Glass Road" picked up in
// the middle of things (chapter 2, day 12) so that there is a past for characters to remember.
// Hand-made. In the finished app a world like this is built by the Architect from the player's description.
import type { BondTier } from '../engine';
import type { StorySeed } from '../game/story';
import type { GameEvent, Person, Place, PlaceKind, World, WorldTemplate } from '../game/types';

function place(id: string, name: string, kind: PlaceKind, parent: string | null, x: number, y: number, known: Place['known'], brief: string, card: string, aliases: string[] = []): Place {
  return { id, name, kind, parent, x, y, known, brief, card, aliases };
}

function person(p: Partial<Person> & Pick<Person, 'id' | 'name' | 'role' | 'card' | 'placeId'>): Person {
  return {
    short: p.name.split(' ').slice(-1)[0] ?? p.name, hue: '', tier: 'recurring', count: 1, inParty: false, pinned: false, met: true,
    kind: 'friendship', bond: 0, attitude: 'Neutral', values: [], valuesKnown: [], grievance: null, pendingMoment: null,
    smallGains: { day: 0, points: 0 }, aliases: [], ...p,
  };
}

const places: Record<string, Place> = Object.fromEntries([
  place('lantern_coast', 'The Lantern Coast', 'world', null, 50, 50, 'visited', 'Canal cities and a road of glass across the salt flats',
    'A salt coast of canal cities joined by a road of fused glass.'),
  // Regions
  place('port_varn', 'Port Varn', 'settlement', 'lantern_coast', 30, 72, 'visited', 'Canal city · 7 places known',
    'A canal city of bridges, guild houses and lantern markets. The Couriers’ Guild has its house here.'),
  place('salt_flats', 'The Salt Flats', 'region', 'lantern_coast', 52, 44, 'visited', 'Crossed · out by the North Gate',
    'White, trackless ground between the coast and Brinehold. Days to cross; water is the whole question.'),
  place('brinehold', 'Brinehold', 'settlement', 'lantern_coast', 78, 24, 'visited', 'Visited · across the Salt Flats',
    'A salt-mining town on the far side of the flats, watched by the baron’s wardens.'),
  place('glass_road', 'The Glass Road', 'region', 'lantern_coast', 62, 80, 'heard', 'Heard of · running east',
    'A road of fused sand running east across the flats, made by an old working nobody can repeat.'),
  place('tessaly', 'Tessaly', 'settlement', 'lantern_coast', 22, 18, 'heard', 'Heard of · the baron’s seat, upriver',
    'The baron’s seat, upriver. Nobody has seen him in a month.'),
  place('greywater', 'Greywater Marsh', 'region', 'lantern_coast', 10, 50, 'hidden', 'Reed channels and stilt villages', 'Reed channels and stilt villages, home of the Marsh-born.'),
  // Port Varn
  place('lantern_market', 'Lantern Market', 'district', 'port_varn', 38, 50, 'visited', 'Night market beside the canal',
    'Paper lanterns over crowded stalls along the canal; at dusk the whole quarter smells of lamp oil and fried dough. The Canal Bridge and its Watch checkpoint are in plain view.', ['the market']),
  place('canal_bridge', 'Canal Bridge', 'district', 'port_varn', 62, 50, 'heard', 'Watch checkpoint',
    'A long stone bridge over the main canal, the only dry way east. The Watch checks papers at the near end; the gates close at nightfall. The far end is unlit.', ['the bridge']),
  place('north_gate', 'North Gate', 'district', 'port_varn', 38, 16, 'visited', 'The way out to the Salt Flats',
    'The city’s landward gate, where guides and water-sellers wait for people foolish enough to cross the flats.'),
  place('old_mill', 'Old Mill', 'building', 'port_varn', 10, 50, 'heard', 'Lens-maker’s workshop at the edge of town',
    'A windmill with no sails at the western edge of town, its upper floor a lens-maker’s workshop. Sela works late and sees nobody without an introduction.', ['the mill']),
  place('guild_house', 'Guild House', 'building', 'port_varn', 38, 74, 'visited', 'Couriers’ Guild · lodging and work',
    'The Couriers’ Guild house: a common room that never closes, a wall of pigeonholes, and Guildmaster Hask’s office up the back stairs.', ['the guild']),
  place('harbour', 'Harbour district', 'district', 'port_varn', 58, 92, 'heard', 'Where Lise keeps her shop',
    'Chandlers, net-makers and ferrymen. Lise’s shop is on the second quay, under a sign of three candles.', ['the harbour']),
  place('waystation', 'Glass Road Waystation', 'site', 'port_varn', 86, 50, 'heard', 'Where the sealed letter is bound',
    'The first stop on the Glass Road, just beyond the Canal Bridge: a walled yard, a lamp tower, and a factor who signs for letters.', ['the waystation']),
  place('beyond', 'Beyond the waystation', 'site', 'port_varn', 98, 50, 'hidden', 'Not discovered yet', 'The Glass Road runs on east into the dark.'),
  // Inside the Guild House: a fourth level, to show the map going deeper
  place('common_room', 'Common room', 'room', 'guild_house', 35, 60, 'visited', 'Never closes', 'Long tables, a banked fire, couriers asleep on their satchels.'),
  place('hask_office', 'Hask’s office', 'room', 'guild_house', 70, 30, 'visited', 'Up the back stairs', 'A small room of ledgers and sealed pouches. Hask keeps the door shut.'),
].map((p) => [p.id, p]));

const people: Record<string, Person> = Object.fromEntries([
  person({
    id: 'mira', name: 'Mira', short: 'Mira', role: 'Scout', hue: 'mira', tier: 'major', placeId: 'lantern_market', inParty: true, pinned: true,
    bond: 52, attitude: 'Trusts you', attitudeWhy: 'you told her the truth about the letter',
    values: ['loyalty', 'plain speaking', 'paying your debts'], valuesKnown: ['loyalty', 'plain speaking'],
    look: 'lean, sun-darkened, a scout’s green hood and a short bow',
    card: 'Dry, watchful, speaks in short sentences and notices exits. Left the City Watch two years ago and does not say why. Knows the salt flats better than the roads. Fights with a bow.',
    secret: 'She served under Captain Roth and left after he had her falsify a report. He would recognise her.',
    wish: 'To set right the report Captain Roth had her falsify, without being the one who answers for it.',
    fight: { strength: 1, skill: 3, armor: 1, firepower: 2, hp: 10, ranged: true, fights: true },
  }),
  person({
    id: 'tobin', name: 'Tobin', short: 'Tobin', role: 'Tinkerer’s apprentice', hue: 'tobin', placeId: 'lantern_market', inParty: true,
    bond: 9, attitude: 'Curious', values: ['cleverness', 'kindness'], valuesKnown: [],
    look: 'gangly, sixteen, soot-smudged cuffs and a satchel of tools',
    card: 'Sixteen, quick-talking, takes things apart to see how they work. Nervous around the Watch. Apprenticed to Sela of the Old Mill. Not a fighter.',
    wish: 'To finish the instrument his cracked lens belongs to, and be more than somebody’s apprentice.',
    fight: { strength: 0, skill: 2, armor: 0, firepower: 0, hp: 5, fights: false },
  }),
  person({
    id: 'roth', name: 'Captain Roth', short: 'Roth', role: 'City Watch', hue: 'roth', tier: 'major', placeId: 'lantern_market',
    attitude: 'Wary', attitudeWhy: 'suspects a courier carried the forged seal',
    look: 'heavy-set, grey stubble, the Watch’s blue coat and one grey glove',
    card: 'A heavy, patient officer who asks the same question twice. Not cruel; tired. Checks couriers at the bridge and carries a copy of the baron’s seal in his glove.',
    secret: 'He was given the copy by the baron’s household and told to find who is using others like it. He does not know the letter exists.',
    fight: { strength: 2, skill: 3, armor: 2, firepower: 0, hp: 15, fights: true },
  }),
  person({
    id: 'watchmen', name: 'Watchmen', short: 'Watchmen', role: 'City Watch', tier: 'extra', count: 2, placeId: 'lantern_market', met: false,
    attitude: 'Bored', card: 'Searching couriers’ bags at the bridge end, without enthusiasm.',
    fight: { strength: 1, skill: 2, armor: 1, firepower: 0, hp: 5, fights: true },
  }),
  person({
    id: 'lantern_seller', name: 'Lantern seller', short: 'Seller', role: 'Stranger', tier: 'extra', placeId: 'lantern_market', met: false,
    attitude: 'Stranger', card: 'An old woman with a stall of paper lanterns who has watched this bridge for forty years.',
  }),
  person({
    id: 'fry_cook', name: 'Fry cook', short: 'Cook', role: 'Stallholder', tier: 'extra', placeId: 'lantern_market', met: false,
    attitude: 'Busy', card: 'Sells fried dough by the bridge steps and hears everything.',
  }),
  person({
    id: 'crowd', name: 'Market crowd', short: 'Crowd', role: 'Townsfolk', tier: 'extra', count: 12, placeId: 'lantern_market', met: false,
    attitude: 'Indifferent', card: 'Shoppers, porters and children, thick enough to get lost in.',
  }),
  // At the Canal Bridge, waiting
  person({
    id: 'knifeman', name: 'Hooded knifeman', short: 'Knifeman', role: 'Kessa’s man', tier: 'extra', placeId: 'canal_bridge', met: false,
    attitude: 'Hostile', card: 'Fast, silent, already inside your reach. Fights with a knife.',
    fight: { strength: 1, skill: 2, armor: 0, firepower: 0, hp: 5, fights: true },
  }),
  person({
    id: 'cudgel', name: 'Man with a cudgel', short: 'Cudgel man', role: 'Kessa’s man', tier: 'extra', placeId: 'canal_bridge', met: false,
    attitude: 'Hostile', card: 'Slow and heavy. Circles wide to get behind people.',
    fight: { strength: 2, skill: 2, armor: 1, firepower: 0, hp: 8, fights: true },
  }),
  person({
    id: 'wardens', name: 'Wardens', short: 'Wardens', role: 'The baron’s wardens', tier: 'extra', count: 4, placeId: 'canal_bridge', met: false,
    attitude: 'Hostile', card: 'Grey-cloaked wardens holding the far end of the bridge with staves. They move together.',
    fight: { strength: 1, skill: 1, armor: 1, firepower: 0, hp: 4, fights: true },
  }),
  person({
    id: 'kessa', name: 'Warden Kessa', short: 'Kessa', role: 'The baron’s agent', tier: 'major', placeId: 'canal_bridge',
    attitude: 'Hostile', attitudeWhy: 'hunting you', grievance: 'You slipped her cordon at Brinehold.',
    look: 'tall, grey-cloaked, gloved, her hair pinned tight',
    card: 'Precise, courteous, relentless. Gives people one chance to hand things over. Watches from the far bank with her arms folded and does not fight.',
    secret: 'She believes the letter proves who is forging the seal, and she is not sure her own master is innocent.',
    fight: { strength: 2, skill: 4, armor: 2, firepower: 0, hp: 15, fights: false },
  }),
  // Elsewhere
  person({
    id: 'lise', name: 'Lise', short: 'Lise', role: 'Your sister, a chandler', hue: 'lise', tier: 'major', placeId: 'harbour', kind: 'kinship',
    bond: 86, attitude: 'Worried about you', values: ['family', 'keeping your word'], valuesKnown: ['family', 'keeping your word'],
    look: 'your height, your eyes, wax on her apron and a pencil behind one ear',
    card: 'Two years older, practical, sharp-tongued with you and nobody else. Keeps a candle shop on the second quay and your room above it.',
    teaches: ['spark', 'hearthwarm'], // a chandler's two tricks
  }),
  person({
    id: 'hask', name: 'Oren Hask', short: 'Hask', role: 'Guildmaster, Couriers’ Guild', hue: 'hask', tier: 'major', placeId: 'hask_office', kind: 'mentorship',
    bond: 44, attitude: 'Expects results', values: ['reliability', 'discretion'], valuesKnown: ['reliability', 'discretion'], aliases: ['Guildmaster Hask', 'the Guildmaster'],
    look: 'grey, thin, an old windcaller’s pin on a black coat',
    card: 'Grey, exact, sparing with praise. Gave you the letter and told you to ask no questions. A windcaller in his day, and still the best the Guild has.',
    teaches: ['featherstep', 'whisper', 'gale_push', 'windcallers_ear', 'long_step'],
    secret: 'He knows who sent the letter and is afraid of what happens if it is not delivered.',
    wish: 'To find out who in the Guild has been selling the couriers’ routes to the Ferrymen’s Company, without the Guild learning that he suspects it.',
  }),
  person({
    id: 'dace', name: 'Dace', short: 'Dace', role: 'Courier, Ferrymen’s Company', hue: 'dace', placeId: 'brinehold', kind: 'rivalry',
    bond: 22, attitude: 'Grudging respect', grievance: 'You took the Brinehold contract from under him.', values: ['winning fairly'], valuesKnown: [],
    look: 'your age, a Ferrymen’s red sash, boots too clean for the road',
    card: 'Your age, better dressed, always arrives first and says so. Works for the rival company.',
  }),
  person({
    id: 'sela', name: 'Sela of the Old Mill', short: 'Sela', role: 'Lens-maker, Tobin’s master', hue: 'sela', placeId: 'old_mill', met: false, aliases: ['Sela', 'Tobin’s master'],
    look: 'small, white-haired, a jeweller’s loupe on a chain',
    attitude: 'Unknown', card: 'A lens-maker who works late and sees nobody without an introduction. Tobin is in awe of her. She folds light as other people fold cloth.',
    teaches: ['glimmer', 'dusk_eyes', 'lantern_veil', 'false_image', 'cleanse', 'daybreak'],
    secret: 'The cracked lens was ground to read the hidden layer in a wax seal.',
  }),
].map((p) => [p.id, p]));

export const lanternCoast: World = {
  id: 'lantern_coast',
  name: 'The Lantern Coast',
  accent: '#2bb3a3',
  pitch: 'Canal cities and a road of glass across the salt flats. Couriers, forged seals, and a baron who is losing his grip.',
  core: `Tone: low fantasy, close to the ground. Travel, trust and small betrayals; no armies, no chosen ones. People are tired, proud, funny and frightened in ordinary proportions. Weather, distance and money matter.
The coast: canal cities joined by a road of fused glass. A baron upriver in Tessaly holds the coast together, but his seal is turning up on letters he never wrote, and nobody has seen him in a month.
Couriers: the Couriers' Guild carries sealed letters; a courier's word is worth more than coin, and "the letter always arrives" is both a boast and an oath. The rival Ferrymen's Company undercuts them where it can.
The paths: a few people can bend air, light, fire, water, earth or dark, if they found someone to teach them. It is a trade, uncommon and unshowy: a windcaller moves like a rumour, a lampwright folds light. Nobody throws lightning.
Names: Port Varn (the city), Lantern Market, Canal Bridge, North Gate, Old Mill, Guild House, Harbour district, the Glass Road and its waystation, the Salt Flats, Brinehold, Tessaly.
Law: the City Watch keeps the bridges and answers to the city. The baron's wardens in grey answer only to the baron and have no right to act inside Port Varn, which does not always stop them.`,
  names: 'Coast folk have one short given name, and guild and city families a family name after it: Mira, Tobin, Lise, Oren Hask. Officers go by rank and family name (Captain Roth, Warden Kessa). Country people are known by where they live: Sela of the Old Mill. Upriver, Tessaly names run longer and older: Aldric, Maudrey Vane.',
  places,
  routes: [
    { a: 'lantern_market', b: 'canal_bridge', minutes: 10, note: 'Watch checkpoint; the gates close at nightfall' },
    { a: 'canal_bridge', b: 'waystation', minutes: 30 },
    { a: 'lantern_market', b: 'guild_house', minutes: 15 },
    { a: 'lantern_market', b: 'north_gate', minutes: 25 },
    { a: 'lantern_market', b: 'old_mill', minutes: 25 },
    { a: 'guild_house', b: 'harbour', minutes: 15 },
    { a: 'guild_house', b: 'common_room', minutes: 1 },
    { a: 'common_room', b: 'hask_office', minutes: 1 },
    { a: 'waystation', b: 'beyond', minutes: 180 },
    { a: 'port_varn', b: 'salt_flats', minutes: 60 * 24 },
    { a: 'salt_flats', b: 'brinehold', minutes: 60 * 24 * 3 },
    { a: 'port_varn', b: 'glass_road', minutes: 40 },
    { a: 'port_varn', b: 'tessaly', minutes: 60 * 24 * 2 },
  ],
  people,
  factions: [
    { id: 'guild', name: 'Couriers’ Guild', standing: 'in good standing' },
    { id: 'watch', name: 'City Watch', standing: 'under suspicion' },
    { id: 'ferrymen', name: 'Ferrymen’s Company', standing: 'rivals' },
    { id: 'baron', name: 'The baron’s household', standing: 'hunted' },
  ],
  startPlace: 'lantern_market',
  rules: { powers: 'focus', pathCap: 3, style: 'adventure', destinyPerChapter: 3 },
  // The coast's money: the silver mark, and the copper that makes change for it.
  money: [
    { id: 'mark', name: 'silver marks', one: 'silver mark', text: 'The baron’s coin, taken all along the coast.', worth: 'common' },
    { id: 'copper', name: 'coppers', one: 'copper', text: 'Small change: ten to the mark.', worth: 'small', of: 'mark' },
  ],
  // What is in motion on the coast whether or not Aren looks. The first has already begun when the story is picked up.
  fronts: [
    {
      id: 'borrowed_seal', name: 'The borrowed seal', stage: 1, touches: ['tessaly', 'port_varn', 'brinehold'],
      goal: 'Someone in the baron’s household is ruling in his name with copies of his seal, and means to be rid of him before anyone asks where he is.',
      stages: [
        'Letters under a copied seal go out along the coast, and the baron is kept out of sight in Tessaly.',
        'The wardens are sent into Port Varn after the couriers who carried the wrong letters, with no right to be there.',
        'A proclamation under the copied seal strikes down the Couriers’ Guild’s charter on the coast road.',
        'The baron is declared dead of a fever, and his steward takes the seal openly.',
      ],
      news: [
        'Nobody has seen the baron in a month, and his seal is on letters he is said never to have written.',
        'The baron’s wardens in grey have been stopping couriers inside Port Varn, where they have no right to act.',
        'A proclamation under the baron’s seal has struck down the Couriers’ Guild’s charter on the coast road.',
        'The baron is dead of a fever, they say in Tessaly, and his steward has taken the seal.',
      ],
      fates: [{ stage: 4, who: 'kessa', then: 'moves', to: 'tessaly', why: 'recalled to Tessaly when the steward took the seal' }],
    },
    {
      id: 'ferrymen_push', name: 'The Ferrymen’s Company moves on the Guild’s contracts', stage: 0, touches: ['port_varn', 'salt_flats', 'brinehold'],
      goal: 'The Ferrymen’s Company means to take the Brinehold run and then the coast road from the Couriers’ Guild, by price first and by other means after.',
      stages: [
        'The Company cuts its prices on the Brinehold run below what the run costs to make.',
        'Guild couriers start losing letters on the road: a satchel cut, a mule lamed.',
        'The merchants of the Lantern Market move their contracts to the Company.',
        'The Guild House in Port Varn lets half its couriers go.',
      ],
      news: [
        'The Ferrymen’s Company has cut its prices on the Brinehold run.',
        'Two Guild couriers have lost their letters on the road, and the Guild is not saying how.',
        'Half the merchants of the Lantern Market have given their letters to the Ferrymen’s Company.',
        'The Couriers’ Guild in Port Varn has let half its couriers go.',
      ],
      fates: [{ stage: 3, who: 'dace', then: 'moves', to: 'lantern_market', why: 'posted to Port Varn when the Company took the Lantern Market’s letters' }],
    },
    {
      id: 'glass_failing', name: 'Something is wrong with the Glass Road', stage: 0, touches: ['glass_road', 'waystation'],
      goal: 'The fused glass of the road is failing from the waystation outward, and those who know why are keeping it quiet.',
      stages: [
        'Cracks open in the glass near the waystation; the keepers lay planks over them and say nothing.',
        'A wagon goes through the road a mile past the waystation.',
        'The waystation shuts its gate to travellers.',
      ],
      news: [
        null,
        'A wagon broke through the Glass Road a mile past the waystation, and the keepers have closed that stretch.',
        'The waystation on the Glass Road has shut its gate to travellers.',
      ],
    },
  ],
  // Situations waiting on the coast, for the narrator alone. Each says what comes of it if nobody steps in.
  seeds: [
    {
      id: 'three_candles', title: 'Three candles, two months behind', placeId: 'harbour',
      wants: 'Lise needs forty silver by the end of the month to keep the shop, and has told nobody.',
      obstacle: 'She would sooner lose the shop than ask her own family for money.',
      ifIgnored: 'The landlord lets the shop to a net-maker, and Lise takes work at the Ferrymen’s chandlery.',
      secret: 'The landlord was leaned on: someone wants the room above the shop searched and emptied.',
      news: 'The candle shop on the second quay has changed hands, and the chandler who kept it works for the Ferrymen’s Company now.',
    },
    {
      id: 'overdue_guide', title: 'A guide two days overdue', placeId: 'north_gate',
      wants: 'A water-seller at the North Gate wants someone to go out onto the flats after her brother, a guide two days overdue.',
      obstacle: 'The Watch has closed the gate book to anyone without a contract.',
      ifIgnored: 'She goes after him herself, alone.',
      secret: 'He was guiding men in grey who did not want to be seen on the coast road.',
      news: 'A water-seller from the North Gate walked out onto the salt flats after her brother, and neither has come back.',
    },
  ],
};

let n = 0;
function past(day: number, placeId: string, text: string, opts: Omit<Partial<GameEvent>, 'bond'> & { bond?: [string, number, number, BondTier] } = {}): GameEvent {
  const { bond, ...rest } = opts;
  return {
    id: `p${++n}`, sceneId: 'before', clock: { day, minute: 12 * 60 }, placeId, text, importance: 2, reach: 'secret', actors: [], witnesses: [], told: [],
    ...(bond ? { bond: { who: bond[0], delta: bond[1], after: bond[2], tier: bond[3] }, actors: [bond[0]] } : {}),
    ...rest,
  };
}

/** "The Glass Road", picked up at dusk on day 12 in the Lantern Market. */
export function glassRoadSeed(): StorySeed {
  n = 0;
  const events: GameEvent[] = [
    past(1, 'hask_office', 'Guildmaster Hask sent you to Brinehold to collect a sealed letter for the Glass Road waystation, no questions asked.', { actors: ['hask'], importance: 3 }),
    past(1, 'hask_office', 'Years of carrying for the Guild without losing a letter.', { bond: ['hask', 44, 44, 'major'], importance: 1 }),
    past(1, 'harbour', 'You grew up together above the candle shop.', { bond: ['lise', 86, 86, 'defining'], importance: 1 }),
    past(3, 'north_gate', 'You hired Mira as your guide at the North Gate and paid her fairly.', { bond: ['mira', 3, 3, 'meaningful'] }),
    past(3, 'salt_flats', 'You asked her name for the mule and remembered it.', { bond: ['mira', 1, 4, 'small'], importance: 1 }),
    past(4, 'salt_flats', 'She laughed at your terrible map.', { bond: ['mira', 1, 5, 'small'], importance: 1, kept: true }),
    past(4, 'salt_flats', 'You carried her water share when her shoulder gave out.', { bond: ['mira', 5, 10, 'meaningful'] }),
    past(4, 'salt_flats', 'You listened while she showed you how to read the flats.', { bond: ['mira', 4, 14, 'meaningful'] }),
    past(5, 'salt_flats', 'You took the second watch without being asked.', { bond: ['mira', 4, 18, 'meaningful'] }),
    past(5, 'salt_flats', 'You did not ask why she left the Watch.', { bond: ['mira', 3, 21, 'meaningful'] }),
    past(6, 'brinehold', 'You found a copy of the baron’s seal in Brinehold with the wax still soft.', { witnesses: ['mira'], importance: 3 }),
    past(6, 'brinehold', 'You told her what you were really carrying.', { bond: ['mira', 8, 29, 'significant'], importance: 3 }),
    past(6, 'brinehold', 'You took the Brinehold contract from under Dace.', { actors: ['dace'], importance: 2, reach: 'local' }),
    past(6, 'brinehold', 'Years of racing each other for the same contracts.', { bond: ['dace', 22, 22, 'major'], importance: 1 }),
    past(6, 'brinehold', 'You split the last of the dried apricots evenly.', { bond: ['mira', 3, 32, 'meaningful'], importance: 1 }),
    past(7, 'brinehold', 'You sold her spare bowstrings without asking.', { bond: ['mira', -4, 28, 'slight'] }),
    past(7, 'brinehold', 'You bought the bowstrings back at a loss and said so plainly.', { bond: ['mira', 5, 33, 'meaningful'] }),
    past(8, 'brinehold', 'You went back for her pack when the wardens closed the street.', { bond: ['mira', 4, 37, 'meaningful'] }),
    past(8, 'brinehold', 'You slipped Warden Kessa’s cordon at Brinehold.', { actors: ['kessa'], witnesses: ['mira'], importance: 3, reach: 'local' }),
    past(8, 'salt_flats', 'You let her set the pace out of Brinehold.', { bond: ['mira', 3, 40, 'meaningful'], importance: 1 }),
    past(9, 'salt_flats', 'You shared your rations on the salt flats.', { bond: ['mira', 8, 48, 'significant'], importance: 3 }),
    past(10, 'salt_flats', 'You stood the dawn watch so she could sleep.', { bond: ['mira', 3, 51, 'meaningful'] }),
    past(10, 'salt_flats', 'A windcaller on the flats taught you Gale Push.', { importance: 2 }),
    past(11, 'north_gate', 'You remembered how she takes her tea.', { bond: ['mira', 1, 52, 'small'], importance: 1 }),
    past(11, 'lantern_market', 'You paid for his broken lens.', { bond: ['tobin', 5, 5, 'meaningful'], witnesses: ['mira'] }),
    past(11, 'lantern_market', 'You let him explain how the lens was ground, all of it.', { bond: ['tobin', 3, 8, 'meaningful'], importance: 1 }),
    past(11, 'guild_house', 'You saved him a seat by the fire.', { bond: ['tobin', 1, 9, 'small'], importance: 1 }),
    past(11, 'lantern_market', 'The Watch began searching couriers at every bridge.', { reach: 'public', importance: 2 }),
  ];
  return {
    id: 'glass-road',
    title: 'The Glass Road',
    world: lanternCoast,
    protagonist: {
      name: 'Aren', line: 'a courier of the Couriers’ Guild of Port Varn', ancestry: 'Human', level: 'Champion',
      sheet: {
        strength: 1, skill: 3, resistance: 3, armor: 1, firepower: 0, hp: 12, energy: 9,
        paths: { air: 2, light: 1 }, skills: ['Manipulation', 'Survival'],
        advantages: ['Quick Reflexes', 'Patron: Couriers’ Guild'],
        disadvantages: ['Code: the letter always arrives', 'Dependent: Lise, your sister', 'Hunted: the baron’s agents', 'Curious to a fault'],
        abilities: ['featherstep', 'gale_push', 'glimmer'],
      },
      destiny: 2, destinyMax: 3, xp: 14, xpEarned: 35, silver: 34, purse: { mark: 34, copper: 12 },
      look: 'a courier’s oilskin satchel, salt-white boots, a sunburnt nose',
      items: [
        { id: 'letter', name: 'The sealed letter', kind: 'quest', text: 'Closed with the baron’s seal, or a copy of it. For the Glass Road waystation.', qty: 1 },
        { id: 'blade', name: 'Short blade', kind: 'gear', text: 'Your weapon in a fight.', qty: 1 },
        { id: 'satchel', name: 'Courier’s satchel', kind: 'gear', text: 'Holds the letter. Kept under the cloak.', qty: 1 },
        { id: 'cloak', name: 'Travelling cloak', kind: 'gear', text: 'Plain and weatherproof, with a deep hood.', qty: 1 },
        { id: 'token', name: 'Guild token', kind: 'gear', text: 'Opens any Guild house.', qty: 1 },
        { id: 'draught', name: 'Healing draught', kind: 'consumable', text: 'Restores 5 hit points.', qty: 2, heal: 5 },
        { id: 'lens', name: 'Tobin’s cracked lens', kind: 'keepsake', text: 'He has not said what it was for.', qty: 1 },
      ],
    },
    clock: { day: 12, minute: 18 * 60 + 10 },
    chapter: { n: 2, title: 'Borrowed Seals', fromDay: 8 },
    chapters: [
      {
        n: 1, title: 'The Sealed Letter', fromDay: 1, toDay: 8, turns: 78, scenes: 9,
        summary: 'Guildmaster Hask sent you across the salt flats to Brinehold to collect a sealed letter and carry it to the Glass Road waystation, no questions asked. You hired Mira, a scout, and in Brinehold told her what you were carrying. There you found a copy of the baron’s seal with the wax still soft, and slipped out through the cordon that Warden Kessa, the baron’s agent, drew around the town.',
        gist: 'You collected the sealed letter in Brinehold, found a copied seal there, and slipped Warden Kessa’s cordon.',
      },
    ],
    threads: [
      { id: 'letter', title: 'Deliver the sealed letter to the Glass Road waystation.', kind: 'main', status: 'open', next: 'Cross the bridge before the gates close.', clues: [], since: 1 },
      { id: 'seal', title: 'Who copied the baron’s seal?', kind: 'mystery', status: 'open', next: null, clues: [{ text: 'The wax on the Brinehold copy was still soft.', day: 6 }], since: 6 },
      { id: 'lens', title: 'What was Tobin’s lens for?', kind: 'small', status: 'open', next: 'His master, Sela of the Old Mill, would know.', clues: [], since: 11 },
      { id: 'brinehold', title: 'Collect the sealed letter in Brinehold.', kind: 'main', status: 'done', next: null, clues: [], since: 1, doneDay: 6 },
      { id: 'flats', title: 'Cross the salt flats back to Port Varn.', kind: 'small', status: 'done', next: null, clues: [], since: 8, doneDay: 11 },
    ],
    commitments: [
      { id: 'mill', text: 'Meet Tobin’s master at the Old Mill.', dueLabel: 'tonight', dueDay: 12, done: false },
      { id: 'report', text: 'Report to Guildmaster Hask.', dueLabel: 'within 3 days of delivery', dueDay: null, done: false },
    ],
    events,
    summary: 'You crossed the salt flats back to Port Varn with Mira, and a windcaller on the way taught you Gale Push. In the city the Watch is searching couriers at every bridge, and Tobin, a tinkerer’s apprentice, has joined you since you paid for his broken lens. You have promised to meet Tobin’s master at the Old Mill tonight; the waystation lies the other way, beyond the Canal Bridge.',
    settings: { style: 'adventure', narration: 'medium', prose: 'plain', romance: true, violence: 'moderate', leaveOut: '', language: 'en', companions: 2, suggestions: true },
    sceneNumber: 4,
    turnsBefore: 0,
    seed: 20261116,
  };
}

// ---------- The same coast, for a character of the player's own ----------
//
// "The Glass Road" is Aren's story: the people of the coast know him, one is his sister, two travel
// with him, and the baron's agent is already hunting him. None of that is true of a stranger. This is
// the coast as a newcomer finds it on the day they walk into the Lantern Market: the same places,
// people, powers and things in motion, with nobody knowing them yet and nothing begun.

/** What is different about a person when the protagonist is a stranger to them. */
const TO_A_STRANGER: Record<string, Partial<Person>> = {
  mira: { placeId: 'north_gate', attitude: 'Guarded' },
  tobin: { placeId: 'old_mill', attitude: 'Curious' },
  roth: { attitude: 'Watchful', attitudeWhy: 'checks every stranger who comes to the bridge' },
  kessa: { attitude: 'Cold' },
  knifeman: { attitude: 'Watchful' },
  cudgel: { attitude: 'Watchful' },
  wardens: { attitude: 'Watchful' },
  lise: {
    role: 'Chandler on the second quay', kind: 'friendship', attitude: 'Busy',
    card: 'Practical, sharp-tongued, generous once she has made up her mind about someone. Keeps a candle shop on the second quay under a sign of three candles, and lets the room above it.',
  },
  hask: {
    attitude: 'Short of couriers',
    card: 'Grey, exact, sparing with praise. Runs the Couriers’ Guild in Port Varn and is always short of couriers he can trust. A windcaller in his day, and still the best the Guild has.',
    secret: 'He is holding a sealed letter for the Glass Road waystation that he dares not give to anyone the baron’s people would know, and he knows who wrote it.',
  },
  dace: { attitude: 'Sizing you up' },
  sela: { secret: 'The cracked lens Tobin carries was ground to read the hidden layer in a wax seal.' },
};

/** What the map says of a place before the protagonist has been anywhere. */
const BRIEF_FOR_A_STRANGER: Record<string, string> = {
  port_varn: 'Canal city',
  salt_flats: 'Out by the North Gate',
  brinehold: 'Across the Salt Flats',
  glass_road: 'Running east',
  tessaly: 'The baron’s seat, upriver',
  harbour: 'Chandlers, net-makers and ferrymen',
  waystation: 'First stop on the Glass Road',
};

/** The Lantern Coast as a world to start a story of one's own in: day 1, a stranger, nothing begun. */
export function lanternCoastTemplate(): WorldTemplate {
  const world = structuredClone(lanternCoast);
  for (const p of Object.values(world.people)) {
    Object.assign(p, { bond: 0, inParty: false, pinned: false, met: false, valuesKnown: [], grievance: null, pendingMoment: null, attitude: p.tier === 'extra' ? p.attitude : 'Neutral' });
    delete p.attitudeWhy;
    Object.assign(p, TO_A_STRANGER[p.id] ?? {});
  }
  for (const place of Object.values(world.places)) {
    if (place.known === 'visited' && place.kind !== 'world') place.known = 'heard';
    const brief = BRIEF_FOR_A_STRANGER[place.id];
    if (brief) place.brief = brief;
  }
  world.places[world.startPlace]!.known = 'visited';
  for (const f of world.fronts ?? []) { f.stage = 0; delete f.since; delete f.movedIn; }
  for (const f of world.factions) f.standing = 'unknown to them';
  return {
    id: world.id,
    world,
    source: { kind: 'sample', text: '' },
    premise: 'A newcomer to Port Varn, looking for work on the coast.',
    table: { narration: 'medium', prose: 'plain', romance: true, violence: 'moderate', leaveOut: '', language: 'en', companions: 2, suggestions: true },
    opening: {
      title: 'A Stranger on the Coast',
      chapter: 'Port Varn',
      thread: 'Find your feet in Port Varn: the Couriers’ Guild is always short of people it can trust.',
      line: 'You have just come into the Lantern Market of Port Varn at dusk, with what you carry and little else. The Watch is checking papers at the Canal Bridge, and a boy with a Guild token on his cap is working the crowd, looking for anyone who will carry a letter tonight.',
      hour: 18,
    },
    built: 0, cost: 0, simulated: false, version: 1,
  };
}
