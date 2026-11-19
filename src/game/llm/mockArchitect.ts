// The demo world builder. It answers each building step with the same canned world, whatever was
// asked for, so that the whole path (questions, seven steps, review, a character, a first scene) can
// be tried and tested without a key. With a key, Claude builds the world the player described.
//
// What it does take from the request: the table (whether there are powers, how many companions) and,
// for a character, the world it is for. Its answers go through the same checks as Claude's.
import { POWER_LEVELS, abilitiesOf, type PowerLevel } from '../../engine';
import type { ArchitectHints, CharacterOut, ExpandOut, QuestionsOut, StepOut } from './architect';

const questions: QuestionsOut = {
  questions: [
    { id: 'tone', question: 'How dark should this world be?', options: ['Hopeful', 'Hard but fair', 'Bleak'] },
    { id: 'stage', question: 'How big is the stage?', options: ['One town and its valley', 'A whole country'] },
    { id: 'trouble', question: 'What kind of trouble do you like best?', options: ['Intrigue', 'Exploration', 'Danger'] },
  ],
};

const skeleton: StepOut['skeleton'] = {
  names: 'Vale folk carry a plain given name and a family name taken from a trade or a place: Hale, Marrow, Tolliver, Ashby. Miners are known by their pit as often as by their family (Cass of the Low Seam). The fenborn of Mirefen take one soft name and their mother’s after it: Ysa Wennasdaughter, Corl Brannasson. The charcoal burners go by what the camp calls them: Sooty, Long Tam.',
  name: 'The Cinder Vale',
  pitch: 'A mining valley where the ore is running out and everyone with power is pretending it is not. (The demo builder’s world: the same whatever you describe.)',
  colour: 'amber',
  regions: [
    { id: 'ashford', name: 'Ashford', kind: 'settlement', brief: 'A mining town at the fork of two rivers, loud and sooty and proud.', x: 48, y: 56 },
    { id: 'high_pits', name: 'The High Pits', kind: 'region', brief: 'Old workings above the town, half of them abandoned.', x: 40, y: 30 },
    { id: 'stonewater', name: 'Stonewater', kind: 'settlement', brief: 'A mill village downriver, where the Vale’s grain is ground.', x: 66, y: 70 },
    { id: 'kings_cut', name: 'The King’s Cut', kind: 'region', brief: 'The pass road north, cut through rock by a king nobody remembers.', x: 56, y: 12 },
    { id: 'blackwood', name: 'Blackwood', kind: 'region', brief: 'Charcoal forest: burners’ camps, smoke, and paths that move.', x: 22, y: 46 },
    { id: 'garrow_keep', name: 'Garrow Keep', kind: 'settlement', brief: 'The baron’s seat, on a rock above the east road.', x: 80, y: 38 },
    { id: 'mirefen', name: 'Mirefen', kind: 'region', brief: 'Low marsh south of the river, home to people the towns distrust.', x: 32, y: 82 },
    { id: 'saints_rest', name: 'Saint’s Rest', kind: 'settlement', brief: 'An abbey on a hill, older than the mines.', x: 12, y: 20 },
    { id: 'far_market', name: 'Far Market', kind: 'settlement', brief: 'The trade town beyond the fen, where Vale ore is sold.', x: 86, y: 88 },
  ],
  routes: [
    { a: 'ashford', b: 'high_pits', hours: 3, note: 'A steep cart road; company guards at the upper gate.' },
    { a: 'ashford', b: 'stonewater', hours: 5, note: null },
    { a: 'ashford', b: 'blackwood', hours: 4, note: 'The burners charge a toll in salt.' },
    { a: 'ashford', b: 'garrow_keep', hours: 8, note: 'The baron’s riders stop travellers on the east road.' },
    { a: 'high_pits', b: 'kings_cut', hours: 6, note: null },
    { a: 'garrow_keep', b: 'kings_cut', hours: 10, note: null },
    { a: 'blackwood', b: 'saints_rest', hours: 7, note: 'Easy to lose the path after dark.' },
    { a: 'stonewater', b: 'mirefen', hours: 6, note: null },
    { a: 'mirefen', b: 'far_market', hours: 14, note: 'By punt, with a fen guide.' },
    { a: 'stonewater', b: 'far_market', hours: 20, note: 'The long way round, on a made road.' },
  ],
  start: 'ashford',
};

const fronts: StepOut['fronts'] = {
  fronts: [
    {
      id: 'failing_seam', name: 'The failing seam',
      goal: 'The Ashford Company means to hide that the main seam is running out until its owners have sold their shares.',
      stages: [
        { what: 'The assay books are quietly rewritten and a surveyor who knows better is sent away.', news: 'The Ashford Company has dismissed its surveyor, and nobody at the Company Office will say why.' },
        { what: 'Shifts are cut without explanation and the Lodge calls a meeting the Company forbids.', news: 'The Ashford Company has cut the shifts at the pits again, and the Miners’ Lodge has called a meeting the Company forbade.' },
        { what: 'The owners sell to buyers from Far Market and leave by night.', news: 'The owners of the Ashford Company have sold out to buyers from Far Market and left Ashford in the night.' },
        { what: 'The pits close. Half of Ashford is out of work before the first snow.', news: 'The pits above Ashford have closed, and half the town is out of work.' },
      ],
      touches: ['ashford', 'high_pits', 'far_market'],
    },
    {
      id: 'barons_levy', name: 'The baron’s levy',
      goal: 'Baron Garrow means to raise a company of soldiers from the Vale before winter, by law if he can.',
      stages: [
        { what: 'Riders post the levy notice in every square: one grown child from each household.', news: 'Baron Garrow’s riders have posted a levy in every square of the Vale: one grown child from each household.' },
        { what: 'Families begin hiding their sons and daughters in Blackwood and the fen.', news: null },
        { what: 'The baron’s men search house by house, and take hostages where they find nobody.', news: 'The baron’s men are searching Ashford and Stonewater house by house, and taking hostages where the young have gone missing.' },
        { what: 'The Vale marches north through the King’s Cut to a war that is not its own.', news: 'The Vale’s levy has marched north through the King’s Cut.' },
      ],
      touches: ['garrow_keep', 'ashford', 'stonewater', 'blackwood'],
    },
    {
      id: 'deep_shaft', name: 'What the deep shaft woke',
      goal: 'Something in the oldest workings has noticed the people above it and is finding its way up.',
      stages: [
        { what: 'Lamps gutter in the lower galleries and a crew comes up refusing to say what it heard.', news: 'A crew came up from the lower galleries of the High Pits and will not go back down, or say what they heard there.' },
        { what: 'Animals will not go near the High Pits. A burner’s camp is found empty, the fires still warm.', news: 'A charcoal burners’ camp in Blackwood was found empty, with the fires still warm.' },
        { what: 'It reaches the surface on a night with no moon.', news: 'Something came up out of the High Pits in the night, and nobody who saw it agrees on what it was.' },
      ],
      touches: ['high_pits', 'blackwood'],
    },
  ],
};

const rules = (h: ArchitectHints): StepOut['rules'] => ({
  level: 'champion',
  path_cap: h.input.table.powers === 'focus' ? 3 : 0,
  common_folk: 'Valefolk',
  ancestries: [
    { id: 'deepkin', name: 'Deepkin', text: 'Families who have worked the pits for ten generations: short, pale, at home in the dark and uneasy under an open sky.', advantages: ['Keen Senses'], disadvantages: ['Outsider: from the deep workings'] },
    { id: 'fenborn', name: 'Fenborn', text: 'Marsh people from Mirefen: patient, hard to sicken, and trusted by nobody in the towns.', advantages: ['Tough'], disadvantages: ['Bad Name: for thieving, in the towns'] },
  ],
  // Where powers are personal, the Vale also has powers that are trained and shared: two taught, one that only awakens.
  disciplines: h.input.table.powers === 'gift' ? DISCIPLINES : [],
  // Two coins of one money, and the Company's own scrip, which only the Company takes.
  money: [
    { id: 'mark', name: 'silver marks', one: 'silver mark', text: 'The crown’s coin, taken everywhere in the Vale.', worth: 'common', of: null },
    { id: 'penny', name: 'copper pennies', one: 'copper penny', text: 'Small change: ten to the mark.', worth: 'small', of: 'mark' },
    { id: 'scrip', name: 'Company scrip', one: 'Company scrip', text: 'Paper the Ashford Company pays its miners in; only Company stores take it.', worth: 'common', of: null },
  ],
});

const DISCIPLINES: StepOut['rules']['disciplines'] = [
  { id: 'lamp_sense', name: 'Lamp-Sense', text: 'A deep miner’s trained sense: hear a footfall through stone, and feel a blow coming before it lands.', limit: 'It fails in a loud place.', kinds: ['guard', 'dazzle'], move: { name: 'Hear It Coming', text: 'Feel the next blow coming, and be elsewhere.', fight: 'guard' }, taught: true },
  { id: 'iron_will', name: 'Iron Will', text: 'Will made armour: skin, and what the hand holds, set as hard as cold iron.', limit: 'It tires the will, and sleep comes hard after.', kinds: ['guard', 'damage'], move: { name: 'Harden', text: 'Set an arm like iron against a blow.', fight: 'guard' }, taught: true },
  { id: 'deep_voice', name: 'The Deep Voice', text: 'A presence a few are born with: when it rises, the weak-willed fall silent, or faint.', limit: 'It rises only when its bearer is pushed past their limit.', kinds: ['dazzle', 'stagger'], move: { name: 'Weight of the Deep', text: 'Let it rise, and the timid look away.', fight: 'dazzle' }, taught: false },
];

const glossary: StepOut['glossary'] = {
  core: 'The Cinder Vale is a mining valley three days from anywhere, hard-working and plain-spoken. Ashford lives on the ore of the High Pits, which the Ashford Company owns and the Miners’ Lodge digs; the two need each other and say so as rarely as they can. Baron Garrow holds the Vale for a distant crown: his riders keep the roads and his court at Garrow Keep hears anything worse than a brawl. The abbey at Saint’s Rest keeps the records and the old stories. Blackwood belongs to the charcoal burners and Mirefen to the fenborn, and neither answers to the town. They swear by the lamp and the deep. Coin is the silver mark. Winter closes the pass, and whatever is not settled by first snow waits until spring. Tone: grounded, wry, a little uncanny at the edges.',
  factions: [
    { id: 'ashford_company', name: 'The Ashford Company', standing: 'unknown' },
    { id: 'miners_lodge', name: 'The Miners’ Lodge', standing: 'in good standing' },
    { id: 'barons_riders', name: 'The Baron’s Riders', standing: 'wary' },
    { id: 'abbey', name: 'The Abbey of Saint’s Rest', standing: 'unknown' },
  ],
};

const start: StepOut['start'] = {
  places: [
    { id: 'market_square', name: 'Market Square', kind: 'district', parent: 'ashford', brief: 'The middle of town: stalls, the notice post, the pump.', card: 'Cobbles black with coal dust, a pump with a queue, a notice post everyone reads and nobody admits to reading. Busy from first light; gossip is sold here cheaper than bread.', x: 50, y: 52 },
    { id: 'lodge_hall', name: 'The Miners’ Lodge', kind: 'building', parent: 'ashford', brief: 'The Lodge’s hall, where the crews drink, vote and argue.', card: 'A long timber hall with lamp brackets worn bright by hands. Crews come here off shift to drink small beer and argue about pay. Strangers are welcome until they ask the wrong question.', x: 38, y: 46 },
    { id: 'long_table', name: 'The Long Table', kind: 'room', parent: 'lodge_hall', brief: 'The common room of the Lodge.', card: 'One table the length of the hall, scarred with initials. A fire at one end, the Lodge’s ledger chained to a desk at the other. Somebody is always halfway through a story.', x: 50, y: 60 },
    { id: 'company_office', name: 'Company Office', kind: 'building', parent: 'ashford', brief: 'Where the Ashford Company keeps its clerks and its strongroom.', card: 'Brick, three storeys, the only glazed windows in town. Clerks at high desks, a porter who knows everyone’s business, a strongroom door at the back that is never left unwatched.', x: 62, y: 44 },
    { id: 'assay_house', name: 'Assay House', kind: 'building', parent: 'ashford', brief: 'Where ore is weighed and its worth written down.', card: 'A squat stone building that smells of acid and hot metal. Scales under glass, shelves of numbered samples, and books that say what the seam is worth. Locked at night; the assayer keeps the key.', x: 70, y: 52 },
    { id: 'widow_hare', name: 'The Widow Hare', kind: 'building', parent: 'ashford', brief: 'The inn on the square: beds, stew, and news from the road.', card: 'Low beams, a good fire, stew that has been going since spring. Carters and company men drink on one side, lodge men on the other, and the widow keeps the peace with a ladle.', x: 54, y: 62 },
    { id: 'smiths_row', name: 'Smiths’ Row', kind: 'district', parent: 'ashford', brief: 'A street of forges on the way up to the pithead.', card: 'Hammering from dawn, sparks across the lane, water hissing in troughs. Picks, lamps and chain are made and mended here, and a blade too if nobody is asking.', x: 34, y: 30 },
    { id: 'pithead', name: 'The Pithead', kind: 'site', parent: 'ashford', brief: 'The winding gear and the mouth of the main shaft.', card: 'A great wheel turning against the sky, cages rattling up and down, tally men at the gate marking who goes under. The cart road to the High Pits starts here, behind a company guard post.', x: 26, y: 16 },
    { id: 'river_stair', name: 'River Stair', kind: 'site', parent: 'ashford', brief: 'Steps down to the barges, below the bridge.', card: 'Wet stone steps, mooring rings, ore barges riding low. Quiet after dark except for the water. Things change hands here that are not written in any book.', x: 64, y: 78 },
    { id: 'east_gate', name: 'East Gate', kind: 'site', parent: 'ashford', brief: 'The town gate on the road to Garrow Keep.', card: 'A gatehouse with the baron’s badge over the arch and two riders who are bored and miss nothing. The levy notice is nailed to the door.', x: 84, y: 48 },
  ],
  routes: [
    { a: 'market_square', b: 'lodge_hall', minutes: 5, note: null },
    { a: 'market_square', b: 'company_office', minutes: 5, note: null },
    { a: 'market_square', b: 'widow_hare', minutes: 2, note: null },
    { a: 'market_square', b: 'smiths_row', minutes: 8, note: null },
    { a: 'market_square', b: 'river_stair', minutes: 10, note: null },
    { a: 'market_square', b: 'east_gate', minutes: 12, note: null },
    { a: 'company_office', b: 'assay_house', minutes: 4, note: null },
    { a: 'smiths_row', b: 'pithead', minutes: 12, note: 'Uphill all the way.' },
    { a: 'lodge_hall', b: 'smiths_row', minutes: 6, note: null },
    { a: 'pithead', b: 'high_pits', minutes: 150, note: 'Past the company guard post.' },
  ],
  start_place: 'long_table',
};

type P = StepOut['people']['people'][number];
const person = (p: Omit<P, 'fights_at_range' | 'travels_with_you' | 'why' | 'secret' | 'craft' | 'wish' | 'power' | 'discipline' | 'look' | 'appearance'> & Partial<P>): P => ({ fights_at_range: false, travels_with_you: false, why: null, secret: null, craft: null, wish: null, power: null, discipline: null, look: LOOKS[p.id] ?? '', appearance: null, ...p });

/** How the demo world's people look at a glance. */
const LOOKS: Record<string, string> = {
  garrick: 'soot to the elbows, burn-scarred forearms, a blacksmith’s leather apron',
  dunmore: 'broad, grey-bearded, a foreman’s brass whistle on a cord',
  sable: 'small and neat, ink on her fingers, spectacles pushed up into her hair',
  osk: 'gaunt, hooded, a lantern that is never lit',
  tam: 'easy smile, cheap rings on every finger, a coat too good for him',
};

/** In a world where powers are personal, five of the demo world's people have one of their own: among them one who seals, and a thief. */
const POWERS: Record<string, NonNullable<P['power']>> = {
  garrick: { name: 'Forge Hands', text: 'His hands glow like iron out of the fire, and burn what they close on.', fight: 'damage', keeps: null },
  dunmore: { name: 'Set Feet', text: 'Once he plants his feet, nothing moves him and little gets through.', fight: 'guard', keeps: null },
  sable: { name: 'Still Voice', text: 'A quiet word from her, and a person stops where they stand.', fight: 'stagger', keeps: null },
  osk: { name: 'Dead Air', text: 'Around him the strange goes quiet: powers gutter like lamps in bad air.', fight: 'seal', keeps: null },
  tam: { name: 'Light Fingers', text: 'What he touches he can take, even a gift, from someone too beaten to hold on to it.', fight: 'steal', keeps: 'held' },
};

/** In a world where powers are personal, three of them practise one of the Vale's disciplines. */
const TRAINS: Record<string, string> = { bram: 'iron_will', osk: 'lamp_sense', dunmore: 'deep_voice' };

const people = (h: ArchitectHints): StepOut['people'] => {
  const made = peopleOf(h);
  return h.input.table.powers === 'gift'
    ? { ...made, people: made.people.map((p) => ({ ...p, ...(POWERS[p.id] ? { power: POWERS[p.id]! } : {}), ...(TRAINS[p.id] ? { discipline: TRAINS[p.id]! } : {}) })) }
    : made;
};

const peopleOf = (h: ArchitectHints): StepOut['people'] => ({
  people: [
    person({ id: 'bram', wish: 'To get his brother’s name put back on the Lodge roll, struck off after the cave-in everyone blames him for.', name: 'Bram Tolliver', short: 'Bram', role: 'Crew boss, Miners’ Lodge', tier: 'major', place: 'long_table', card: 'Broad, slow-spoken, the man the Lodge listens to. Talks in mining terms about everything. Wants the crews paid and nobody buried.', secret: 'He has seen the true assay figures and is afraid of what the Lodge will do if he tells it.', attitude: 'Friendly', why: 'You have never lied to him', values: ['the crews', 'plain dealing', 'his word'], bond: 'mentorship', fighter: 'able', travels_with_you: false }),
    person({ id: 'wren', wish: 'To see what is at the bottom of the deep shaft with her own eyes, and come back up to draw it.', name: 'Wren Ashby', short: 'Wren', role: 'Lamp-maker’s apprentice', tier: 'recurring', place: 'long_table', card: 'Seventeen, quick, always mending something. Asks too many questions and writes the answers down. Wants to see what is past the King’s Cut.', attitude: 'Admiring', why: 'You treat her as grown', values: ['curiosity', 'being trusted'], bond: 'friendship', fighter: 'weak', fights_at_range: true, travels_with_you: h.input.table.companions > 0 , craft: { path: 'light', mastery: 'dabbler' }}),
    person({ id: 'osk', name: 'Osk Marrow', short: 'Osk', role: 'Deepkin tally man', tier: 'recurring', place: 'pithead', card: 'Pale, patient, counts everything twice. Speaks softly and is never wrong about who went under. Wants his people left alone.', secret: 'He heard something answer when he tapped the lower gallery wall.', attitude: 'Neutral', values: ['his kin', 'accuracy'], bond: 'mentorship', fighter: 'weak' , craft: { path: 'earth', mastery: 'master' }}),
    person({ id: 'sable', name: 'Mistress Sable Hale', short: 'Sable', role: 'Agent of the Ashford Company', tier: 'major', place: 'company_office', card: 'Beautifully dressed, never raises her voice, remembers every favour. Speaks as if reading terms. Wants the Company’s secret kept until spring.', secret: 'She has already sold her own shares.', attitude: 'Courteous', why: 'She has not decided whether you are useful', values: ['leverage', 'discretion', 'winning'], bond: 'rivalry', fighter: 'no' }),
    person({ id: 'pell', name: 'Pell Corrin', short: 'Pell', role: 'Assayer', tier: 'recurring', place: 'assay_house', card: 'Thin, ink-stained, flinches at loud noises. Explains too much when nervous. Wants to be told he had no choice.', secret: 'He rewrote the assay books on Sable Hale’s orders and kept the true pages.', attitude: 'Nervous', values: ['his craft', 'being safe'], bond: 'friendship', fighter: 'no' }),
    person({ id: 'hare', name: 'The Widow Hare', short: 'Hare', role: 'Innkeeper', tier: 'recurring', place: 'widow_hare', card: 'Sixty, sharp-eyed, calls everyone “love” and means it about half the time. Hears everything said in her house. Wants a quiet winter.', attitude: 'Warm', values: ['her house', 'fair payment'], bond: 'kinship', fighter: 'weak' }),
    person({ id: 'dunmore', name: 'Sergeant Dunmore', short: 'Dunmore', role: 'Sergeant of the Baron’s Riders', tier: 'major', place: 'east_gate', card: 'Grey moustache, tired manners, does his duty and dislikes it. Speaks in short sentences. Wants the levy raised without bloodshed.', secret: 'His own daughter is on the levy list, and he has left her name off.', attitude: 'Wary', why: 'You are Lodge, near enough', values: ['order', 'his daughter', 'the law'], bond: 'rivalry', fighter: 'dangerous' }),
    person({ id: 'ysolde', wish: 'To buy back the barge her father lost to the Company, the one she pilots for wages now.', name: 'Ysolde Fenn', short: 'Ysolde', role: 'Fenborn barge pilot', tier: 'recurring', place: 'river_stair', card: 'Lean, sunburnt, laughs at her own jokes. Speaks in river sayings. Will carry anything for the right price and a straight answer.', attitude: 'Amused', values: ['freedom', 'a fair bargain'], bond: h.input.table.romance ? 'romance' : 'friendship', fighter: 'able', fights_at_range: true, travels_with_you: h.input.table.companions > 1 }),
    person({ id: 'garrick', name: 'Garrick Stone', short: 'Garrick', role: 'Master smith', tier: 'recurring', place: 'smiths_row', card: 'Huge forearms, a soft voice, a temper he keeps on a short chain. Makes the Lodge’s picks and, lately, pike heads for someone.', secret: 'The pike heads are for families who mean to resist the levy.', attitude: 'Gruff', values: ['good work', 'his street'], bond: 'friendship', fighter: 'able' , craft: { path: 'fire', mastery: 'adept' }}),
    person({ id: 'aldous', name: 'Brother Aldous', short: 'Aldous', role: 'Archivist of Saint’s Rest', tier: 'recurring', place: 'market_square', card: 'A round, cheerful monk in town to buy lamp oil, who knows the old stories about the deep shaft and tells them as jokes. Wants to copy the Lodge’s oldest ledger.', attitude: 'Friendly', values: ['records', 'old stories'], bond: 'mentorship', fighter: 'no' }),
    person({ id: 'tam', name: 'Tam Reddy', short: 'Tam', role: 'Carter and smuggler', tier: 'recurring', place: 'widow_hare', card: 'Easy smile, cheap rings, owes money in three towns. Talks fast and changes the subject faster. Wants one big job and out.', attitude: 'Over-friendly', why: 'He wants something', values: ['a quick profit'], bond: 'rivalry', fighter: 'weak' }),
    person({ id: 'isra', wish: 'To stand in front of the Lodge with her charts and be believed, once, before she leaves the Vale for good.', name: 'Isra Vane', short: 'Isra', role: 'Surveyor, dismissed by the Company', tier: 'major', place: 'widow_hare', card: 'Precise, angry, drinking slowly in the corner with a roll of charts she will not put down. Wants someone to believe her.', secret: 'Her charts show the seam ends within the year, and where the deep shaft really leads.', attitude: 'Guarded', values: ['the truth', 'her work'], bond: 'friendship', fighter: 'weak' }),
  ],
  crowds: [
    { id: 'lodge_crews', name: 'Lodge crews', place: 'long_table', count: 8, card: 'Miners off shift: tired, loud, loyal to one another.', attitude: 'Easy', fighter: 'weak' },
    { id: 'company_guards', name: 'Company guards', place: 'pithead', count: 4, card: 'Hired men in company grey, with cudgels and orders.', attitude: 'Suspicious', fighter: 'able' },
    { id: 'gate_riders', name: 'Baron’s riders', place: 'east_gate', count: 3, card: 'Mailed riders with the baron’s badge, bored and watchful.', attitude: 'Cold', fighter: 'able' },
    { id: 'market_folk', name: 'Market folk', place: 'market_square', count: 12, card: 'Stallholders, carriers and people with baskets.', attitude: 'Busy', fighter: 'no' },
  ],
});

type S = StepOut['seeds']['seeds'][number];
const seed = (x: Omit<S, 'news' | 'becomes'> & Partial<S>): S => ({ news: null, becomes: null, ...x });

const seeds: StepOut['seeds'] = {
  story_title: 'The Last Good Seam',
  chapter_title: 'Short Shifts',
  main_thread: 'Find out why the Company cut the shifts, before the Lodge decides for itself.',
  opening_hour: 17,
  opening: 'You are at the Long Table in the Miners’ Lodge at the end of a short shift, the third this week. Bram Tolliver has just set the Lodge’s ledger down in front of you and asked what you make of the numbers.',
  seeds: [
    seed({ id: 'true_pages', news: 'There was a fire in a stove at the Assay House in the night; only papers were lost, the Company says.', title: 'The true pages', place: 'assay_house', wants: 'Pell Corrin wants to be rid of the real assay pages without being the one who betrayed the Company.', obstacle: 'Sable Hale has him watched, and he trusts nobody.', if_ignored: 'He burns them, and the only proof is gone.', secret: 'He kept them because he means to sell them.' }),
    seed({ id: 'levy_list', news: 'Sergeant Dunmore has been relieved at the east gate of Ashford, and a younger officer has the baron’s riders now.', becomes: { who: 'dunmore', then: 'moves', to: 'garrow_keep', why: 'relieved of his post and recalled to Garrow Keep' }, title: 'A name left off', place: 'east_gate', wants: 'Sergeant Dunmore wants the levy raised quietly and his daughter never to appear on it.', obstacle: 'A rider under him has noticed the gap in the list.', if_ignored: 'The rider reports it, and Dunmore is replaced by someone worse.', secret: 'His daughter wants to go.' }),
    seed({ id: 'pike_heads', title: 'Forty pike heads', place: 'smiths_row', wants: 'Garrick Stone needs forty pike heads carried out of town before the gate search on market day.', obstacle: 'Tam Reddy knows, and is deciding who will pay more for it.', if_ignored: 'The riders find them, and the Row burns.', secret: 'Half the families who ordered them have already lost their nerve.' }),
    seed({ id: 'the_tapping', title: 'The tapping', place: 'pithead', wants: 'Osk Marrow wants someone to go down to the lower gallery with him and hear what he heard.', obstacle: 'The Company has closed that gallery and posted guards.', if_ignored: 'A crew is sent down anyway, and does not come back up whole.', secret: 'The tapping repeats the Lodge’s own signal code, a beat late.' }),
    seed({ id: 'isras_charts', news: 'The surveyor the Company dismissed left Ashford on the morning barge, with her charts under her arm.', becomes: { who: 'isra', then: 'moves', to: 'far_market', why: 'left on the morning barge for Far Market' }, title: 'The surveyor’s charts', place: 'widow_hare', wants: 'Isra Vane wants her charts in front of the Lodge before she is run out of town.', obstacle: 'Nobody in the Lodge will listen to a Company surveyor.', if_ignored: 'She leaves on the next barge and takes the charts to Far Market’s buyers.', secret: 'One chart shows a second, untouched seam, under abbey land.' }),
    seed({ id: 'the_ledger', title: 'The oldest ledger', place: 'long_table', wants: 'Brother Aldous wants a week with the Lodge’s first ledger, to copy it.', obstacle: 'The Lodge has never let it leave the hall.', if_ignored: 'He copies what he can by lamplight and misses the page that matters.', secret: 'The ledger records the last time the deep shaft was sealed, and why.' }),
  ],
  fates: [
    { front: 'failing_seam', stage: 3, who: 'sable', then: 'leaves', to: null, why: 'left Ashford by night when the owners sold out' },
    { front: 'barons_levy', stage: 3, who: 'garrick', then: 'moves', to: 'garrow_keep', why: 'taken to Garrow Keep as a hostage when the riders searched Smiths’ Row' },
  ],
  relics: [],
};

/** Where powers are personal, the Vale has two items of power: a fruit bound up with the oldest ledger, and a lamp a smuggler carries. */
const RELICS: StepOut['seeds']['relics'] = [
  {
    id: 'ember_fruit', name: 'Ember Fruit', text: 'A wrinkled red fruit, warm to the touch, said to grow only where a seam has burned.', use: 'eaten', major: false,
    power: { name: 'Ember Body', text: 'The body runs hot as a forge: hands that glow, breath that scorches.', limit: 'Water steals the heat, and the strength with it.', kinds: ['damage', 'guard'], move: { name: 'Ember Palm', text: 'A palm that burns what it strikes.', fight: 'damage' } },
    place: 'long_table', holder: null, seed: 'the_ledger',
  },
  {
    id: 'deep_lamp', name: 'The Deep Lamp', text: 'An old miner’s lamp that has never needed oil.', use: 'carried', major: false,
    power: { name: 'Deep Lamp', text: 'Its light shows what is hidden, and dazzles whoever it is turned on.', limit: 'It shows the one who holds it as plainly as anyone.', kinds: ['dazzle'], move: { name: 'Flare', text: 'Turn the lamp full on someone.', fight: 'dazzle' } },
    place: null, holder: 'tam', seed: null,
  },
];

function character(h: ArchitectHints): CharacterOut {
  const w = h.world;
  const level: PowerLevel = w?.rules.level ?? 'champion';
  const focus = w?.rules.powers === 'focus' && (w?.rules.pathCap ?? 0) >= 1;
  const extreme = w?.rules.powers === 'extreme';
  const gift = w?.rules.powers === 'gift';
  const drawbacks = ['Curious', 'Debt: to an old friend'];
  // Points: the level's, plus two drawbacks; one skill, one advantage (a school of power where the world has them), a first step on a path or two ranks of a power of their own, the rest in attributes.
  let left = POWER_LEVELS[level].points + drawbacks.length - 2 - (extreme ? 2 : 1) - (focus ? 1 : 0) - (gift ? 2 : 0);
  const a = { skill: 0, resistance: 0, strength: 0, armor: 0 };
  const order = ['skill', 'resistance', 'strength', 'skill', 'armor', 'resistance', 'strength', 'skill'] as const;
  for (let i = 0; left > 0 && i < 40; i++) { const k = order[i % order.length]!; if (a[k] < 5) { a[k] += 1; left -= 1; } }
  const town = w ? Object.values(w.places).find((p) => p.kind === 'settlement' && p.known !== 'hidden')?.name ?? w.name : 'home';
  const ability = abilitiesOf('earth').find((x) => x.tier === 1);
  return {
    name: h.input.name.trim() || 'Robin Hale',
    line: `someone who knows ${town} well and cannot leave a question alone`,
    look: 'travel-worn coat, ink-stained fingers, a sharp, watchful face',
    appearance: 'Wiry and quick, in a travel-worn coat with too many pockets; dark hair tied back, ink on the fingers, and the habit of looking at a door before walking through it.',
    ancestry: w?.ancestries?.[0]?.id ?? 'plain',
    strength: a.strength, skill: a.skill, resistance: a.resistance, armor: a.armor, firepower: 0,
    paths: focus ? [{ path: 'earth', level: 1 }] : [],
    skills: ['Investigation'],
    advantages: [extreme ? 'Elemental School' : `Local Knowledge: ${town}`],
    disadvantages: drawbacks,
    abilities: focus && ability ? [ability.id] : [],
    gift: gift ? {
      name: 'Stone Skin', text: 'Your skin turns to living stone when you will it: hard to hurt, heavy, and slow to tire.',
      limit: 'You sink in water, and the stone cracks under sudden cold.', rank: 2, kinds: ['guard', 'damage'],
      moves: [
        { name: 'Brace', text: 'Harden all over and let the blow break on you.', tier: 1, fight: 'guard' },
        { name: 'Hammer Fist', text: 'A fist of stone, swung with your whole weight.', tier: 2, fight: 'damage' },
      ],
    } : null,
    carrying: [
      { name: 'Work knife', text: 'Your weapon in a fight, if it comes to that.' },
      { name: 'Tin lamp', text: 'Burns four hours on a fill.' },
      { name: 'Notebook', text: 'Half full of things other people said.' },
    ],
    reasons: {
      attributes: 'Skill first, because the premise is someone who gets by on wits; enough Resistance to take a blow.',
      paths: focus ? 'One step on the earth path: a small, practical power.' : extreme ? 'The Elemental School: fire, water, air and earth, for as long as the energy lasts.'
        : gift ? 'A power of your own at rank 2: enough to matter in a fight, with room to grow. One move to take a blow, one to give it.' : 'This world has no powers.',
      skills: 'Investigation, for the questions.',
      traits: 'Knows the town; cannot leave things alone; owes someone. (The demo builder proposes the same character for every premise.)',
    },
  };
}

const FIRST = ['Hesk', 'Mara', 'Odo', 'Tilda', 'Corwin', 'Ness', 'Pike', 'Rowan', 'Edda', 'Jory', 'Sib', 'Wat'];
const LAST = ['Carrow', 'Dunn', 'Fallow', 'Graye', 'Holt', 'Kettle', 'Lark', 'Moss', 'Penny', 'Quill', 'Rudge', 'Thorn'];

/** A canned inside for any place: the same shape every time, named after the place so that two places differ. */
function expand(h: ArchitectHints): ExpandOut {
  const place = h.place ?? { id: 'place', name: 'This place', kind: 'region', taken: [] };
  const name = place.name.replace(/^The /, '');
  const town = place.kind === 'settlement';
  const taken = new Set(place.taken);
  // Ids and names that depend on the place, so that filling in a second place does not repeat the first.
  let n = 0;
  for (const ch of place.id) n = (n * 31 + ch.charCodeAt(0)) % 9973;
  const who = (i: number) => `${FIRST[(n + i * 5) % FIRST.length]!} ${LAST[(n + i * 7) % LAST.length]!}`;
  const pid = (stem: string) => { const id = `${place.id}_${stem}`; return taken.has(id) ? `${id}_x` : id; };
  const a = pid(town ? 'square' : 'camp');
  const b = pid(town ? 'inn' : 'ford');
  const c = pid(town ? 'gate' : 'lookout');
  const d = pid(town ? 'yard' : 'ruin');
  const back = pid('back_room');
  const people = [0, 1, 2, 3].map((i) => who(i));
  return {
    card: `${place.name} as a traveller first sees it: ${town ? 'roofs, smoke and one street that everything else hangs from' : 'open ground, a track, and signs that people pass through more than they stay'}. Strangers are noticed here. (The demo builder’s version: every place it fills in has the same shape.)`,
    places: [
      { id: a, name: town ? `${name} Square` : `${name} Camp`, kind: 'district', parent: place.id, brief: town ? 'The middle of the place, where people meet.' : 'Where travellers stop for the night.', card: town ? 'A square of packed earth with a well, a few stalls and a bench that is never empty. News arrives here first and leaves here changed.' : 'A ring of old fire pits and a lean-to. Whoever is here tonight will share a fire and a guarded word.', x: 48, y: 50 },
      { id: b, name: town ? `The ${name} Arms` : `${name} Ford`, kind: town ? 'building' : 'site', parent: place.id, brief: town ? 'The inn: beds, beer and talk.' : 'Where the track crosses the water.', card: town ? 'A low, warm room with a fire and a landlord who has heard every story twice. Travellers sleep upstairs; locals drink below.' : 'Stepping stones and a rope across cold, quick water. Easy by day; a bad place to be caught at dusk.', x: 62, y: 38 },
      { id: c, name: town ? 'The Road Gate' : 'The Lookout', kind: 'site', parent: place.id, brief: town ? 'Where the road comes in.' : 'High ground with a long view.', card: town ? 'A gate that is shut at dark and a keeper who wants to know your business, mostly out of boredom.' : 'A bare rise from which the whole of the country around can be seen, and anyone on it can be seen in turn.', x: 24, y: 64 },
      { id: d, name: town ? 'The Carters’ Yard' : 'The Old Ruin', kind: 'site', parent: place.id, brief: town ? 'Wagons, mules and people for hire.' : 'Walls without a roof, older than anyone’s grandfather.', card: town ? 'A muddy yard of wagons and feed. Anything that moves in or out of the place passes through here, and somebody always knows where it went.' : 'Broken walls and a cellar stair choked with bramble. People avoid it without quite saying why.', x: 74, y: 70 },
      { id: back, name: town ? 'The Back Room' : 'The Cellar', kind: 'room', parent: town ? b : d, brief: 'Out of sight and out of earshot.', card: 'A small room with one door and no window, where things are said that are not meant to be heard.', x: 50, y: 50 },
    ],
    routes: [
      { a, b, minutes: 4, note: null },
      { a, b: c, minutes: 6, note: null },
      { a: b, b: d, minutes: 5, note: null },
    ],
    people: [
      { id: pid('keeper'), name: people[0]!, short: people[0]!.split(' ')[0]!, role: town ? 'Gate keeper' : 'Ferryman of the ford', tier: 'recurring', place: place.id, card: 'Weathered, unhurried, asks one question more than is polite. Wants an easy day and a little news to trade.', look: 'sun-browned, a wide hat, a staff worn smooth', secret: null, attitude: 'Curious', values: ['news', 'a quiet life'], bond: 'friendship', fighter: 'weak', fights_at_range: false, craft: null, power: null, discipline: null },
      { id: pid('host'), name: people[1]!, short: people[1]!.split(' ')[0]!, role: town ? 'Landlord of the inn' : 'Keeper of the camp fire', tier: 'major', place: b, card: 'Broad, cheerful, remembers everyone who ever owed them money. Talks freely about everything except last winter.', look: 'broad, flour on the apron, a ring of keys at the belt', secret: 'Last winter they hid someone the baron’s riders were looking for, and that someone left something behind.', attitude: 'Welcoming', values: ['paying guests', 'loyalty'], bond: 'friendship', fighter: 'able', fights_at_range: false, craft: null, power: h.input.table.powers === 'gift' ? { name: 'Long Memory', text: 'Looks at a person and knows what they last lied about.', fight: 'dazzle', keeps: null } : null, discipline: null },
      { id: pid('carter'), name: people[2]!, short: people[2]!.split(' ')[0]!, role: town ? 'Carter for hire' : 'Trapper', tier: 'recurring', place: d, card: 'Lean and restless, always about to leave. Knows the roads better than the people who made them, and sells what they know.', look: 'lean, road dust, a bow across the back', secret: null, attitude: 'Wary', values: ['coin', 'the open road'], bond: 'rivalry', fighter: 'able', fights_at_range: true, craft: null, power: null, discipline: null },
      { id: pid('elder'), name: people[3]!, short: people[3]!.split(' ')[0]!, role: town ? 'Speaker for the place' : 'Hermit', tier: 'recurring', place: a, card: 'Old, sharp, speaks for the place because nobody else will. Wants strangers gone by morning and is too polite to say so twice.', look: 'white-haired, straight-backed, a heavy shawl', secret: null, attitude: 'Cool', values: ['the old ways', 'peace'], bond: 'mentorship', fighter: 'no', fights_at_range: false, craft: { path: 'earth', mastery: 'adept' }, power: null, discipline: h.input.table.powers === 'gift' ? 'iron_will' : null },
    ],
    crowds: [
      { id: pid('locals'), name: town ? `${name} folk` : 'Travellers', place: a, count: 6, card: town ? 'People about their day, with one eye on the stranger.' : 'Carriers and wanderers sharing a fire.', attitude: 'Watchful', fighter: 'no' },
    ],
    seeds: [
      { id: pid('left_behind'), title: 'What was left behind', place: b, wants: `${people[1]} wants something that was left in their keeping gone before anyone asks about it.`, obstacle: 'They do not know what it is worth, or who will come for it.', if_ignored: 'Someone comes for it, and is not gentle.', secret: 'It was left on purpose, for whoever asked the right question.' },
    ],
  };
}

/** The demo reader does not read: it says how each part begins, so that the path can be tried and the notes can be told apart. */
function notes(h: ArchitectHints): string {
  const words = (h.part ?? '').split(/\s+/).filter(Boolean);
  return `TONE AND NAMES: The demo reader takes no real notes. This part is ${words.length} words long and begins: “${words.slice(0, 24).join(' ')}”. With your own key, Claude notes the places, people, powers and trouble it finds here.`;
}

function digest(h: ArchitectHints): string {
  const words = (h.part ?? '').split(/\s+/).filter(Boolean);
  return `PLACES: (The demo reader’s description. It does not understand the document; the demo builder then builds the same world as always.)\nTONE AND NAMES: ${words.slice(0, 220).join(' ')}`;
}

/** The demo builder's answer to a building request. */
export function mockArchitect(h: ArchitectHints): unknown {
  switch (h.step) {
    case 'questions': return structuredClone(questions);
    case 'skeleton': return structuredClone(skeleton);
    case 'fronts': return structuredClone(fronts);
    case 'rules': return rules(h);
    case 'glossary': return structuredClone(glossary);
    case 'start': return structuredClone(start);
    case 'people': return people(h);
    case 'seeds': return { ...structuredClone(seeds), relics: h.input.table.powers === 'gift' ? structuredClone(RELICS) : [] };
    case 'character': return character(h);
    case 'expand': return expand(h);
    case 'notes': return notes(h);
    case 'digest': return digest(h);
  }
}
