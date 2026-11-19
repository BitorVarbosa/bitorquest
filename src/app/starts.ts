// A start for an empty page: a few worlds to begin from, and a roll that puts one together from four
// parts. Each fills the description box for the player to change; nothing is sent until they build.
// The texts are the interface's, so they are translated like any other.
import { m, t } from '../i18n';

/** Worlds to begin from, each a few lines, as a player might have written them. */
export const STARTS: { name: string; text: string }[] = [
  { name: m('Lantern village'), text: m('A cosy village of bakers, beekeepers and lantern-makers at the edge of an old forest.\nThe festival of lights is in a week, and the lanterns have started going out by themselves.\nWarm and small: friendship, neighbours, a little magic, and a mystery that is not quite frightening.') },
  { name: m('Neon debt'), text: m('A rain-soaked megacity where every citizen carries their debt as a number on their wrist.\nThree corporations own the towers; the streets below belong to whoever is still awake.\nHeists, betrayals and loyalty bought by the hour.') },
  { name: m('Last frontier'), text: m('A frontier planet at the end of the trade lanes, half-terraformed and forgotten by the colony company.\nSettlers, prospectors and a buried alien structure that hums at night.\nSurvival, found family, and the question of who the planet really belongs to.') },
  { name: m('Drowned kingdom'), text: m('A kingdom sinking into the sea, one coastal town a year.\nThe court pretends nothing is wrong; the fisherfolk speak to something under the water.\nIntrigue, old bargains and a choice about what is worth saving.') },
  { name: m('Academy of storms'), text: m('A school for weather-callers on a cliff above the sea, where students learn to bend wind and rain.\nRivalries, exams, a forbidden library, and a teacher who vanished last winter.\nComing of age, friendship and romance, with real danger at the edges.') },
  { name: m('Ash road'), text: m('A land after the fall of an empire of sorcerers: ruins, ash and hungry warlords.\nCaravans cross it carrying water, rumours and the few books that survived.\nGrim and hard: every meal and every ally has to be earned.') },
  { name: m('Ghost harbour'), text: m('A 1920s harbour city of jazz clubs, smugglers and fog, where the dead do not always stay gone.\nThe police take bribes, the mediums take money, and somebody is collecting souls.\nNoir mystery with a supernatural edge.') },
  { name: m('Sky caravans'), text: m('A world of floating islands crossed by airship caravans.\nGuilds of navigators guard the charts; sky pirates guard the gaps between them.\nAdventure, trade and wonder, with a storm on the horizon nobody can explain.') },
];

const SETTINGS = [
  m('A mountain kingdom of stone bridges and long winters.'),
  m('A trading city built on stilts over a warm lagoon.'),
  m('A space station at the edge of known space, where three species share the air.'),
  m('A small town in the 1980s, with a closed factory and a lot of woods.'),
  m('A desert of glass dunes crossed by sand-ships.'),
  m('A forest where the trees remember everyone who has walked under them.'),
  m('An empire of clockwork and steam, at the height of its power.'),
  m('An archipelago of fishing villages and whispering reefs.'),
  m('A city ruled by rival families of magicians.'),
  m('A frozen research outpost, cut off for the winter.'),
];
const PLACES = [
  m('The story starts in a crowded inn where everyone is waiting out a storm.'),
  m('The story starts at a funeral that half the town did not want to attend.'),
  m('The story starts on the first day of a new job nobody else wanted.'),
  m('The story starts in a market on the busiest day of the year.'),
  m('The story starts on a ship that has just lost its captain.'),
  m('The story starts at a wedding between two families who hate each other.'),
  m('The story starts at the gates, as the city closes them for the night.'),
  m('The story starts in a ruin that someone has been living in.'),
];
const TROUBLES = [
  m('Someone important has disappeared, and the people looking for them are not friendly.'),
  m('A debt is due, and it was not taken out in money.'),
  m('Something old has woken up under the ground.'),
  m('A letter arrives that should not exist.'),
  m('The harvest has failed, and everyone blames someone different.'),
  m('A stranger arrives claiming to be the rightful heir.'),
  m('Two powers are about to go to war over something small.'),
  m('People are forgetting things, one memory at a time.'),
];
const TWISTS = [
  m('Nothing is quite what the rulers say it is.'),
  m('The villain believes, with good reason, that they are saving everyone.'),
  m('Magic is real, but it is paid for with something people would rather keep.'),
  m('The oldest legend about this place turns out to be a warning.'),
  m('The protagonist is in the middle of it whether they like it or not.'),
  m('The kindest person in town is hiding the worst secret.'),
  m('The map everyone uses is wrong, on purpose.'),
  m('Somebody already tried to fix this once, and failed.'),
];

const pick = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)]!;

/** A world put together from four parts, in the interface language: where, how it starts, the trouble, and a twist. */
export function rollStart(): string {
  return [pick(SETTINGS), `${t(pick(PLACES))} ${t(pick(TROUBLES))}`, pick(TWISTS)].map((x, i) => (i === 1 ? x : t(x))).join('\n');
}
