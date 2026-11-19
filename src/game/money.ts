// Money: the coins of a world, what the protagonist carries of each, and what things cost.
//
// The world builder names a world's money and places each coin on a scale of words (a meal costs
// hundreds of it, a couple of it, a fraction of it). A price is a word too, chosen by the referee or the
// narrator: a drink, a meal, a night's room, a good weapon, a horse, a house. What those words mean in
// numbers is here and nowhere else: no model ever writes an amount the rules depend on (decision 33),
// except a sum the player typed themself ("I give her forty marks").
//
// A world may have several moneys (an empire's crowns and a guild's scrip, a city's coin and the
// desert's). They are separate purses, never added up for the player: a seller takes one of them, and
// changing one for another is a trade like any other, at the money changer's rate.
import { tl, type Lang } from '../i18n';
import type { Currency, Story, World, Worth } from './types';

export const WORTHS: readonly Worth[] = ['tiny', 'small', 'common', 'large', 'great'];
/** How many common coins one coin of each worth is. */
const WORTH_VALUE: Record<Worth, number> = { tiny: 0.01, small: 0.1, common: 1, large: 10, great: 100 };

/** The price words, cheapest first. */
export const PRICES = ['trivial', 'cheap', 'fair', 'costly', 'dear', 'fortune'] as const;
export type Price = (typeof PRICES)[number];
/** What each costs in common coins: a drink, a meal, a night's room and board, a good weapon, a horse, a house. */
const PRICE_VALUE: Record<Price, number> = { trivial: 1, cheap: 2, fair: 10, costly: 50, dear: 250, fortune: 2500 };
/** The scale as the referee and the narrator are told it. */
export const PRICE_WORDS = 'trivial (a drink, a tip), cheap (a meal, a ride across town), fair (a night’s room and board, a simple tool), costly (a good weapon, a fine coat), dear (a horse, a passage across the sea), fortune (a house, a ship)';
/** The scale of a coin's worth as the world builder is told it. */
export const WORTH_WORDS = 'tiny (a meal costs a few hundred of them, like yen), small (a meal costs a score of them, like coppers), common (a meal costs a couple, like silver), large (one buys a good weapon\'s worth of meals, like gold), great (one is a small fortune)';

/** In common coins, what a new character carries: Wealth and Poor change it, nothing else does. */
export const STARTING_MONEY = { usual: 30, wealthy: 300, poor: 5 } as const;
/** What a money changer keeps. */
export const EXCHANGE_CUT = 0.1;
/** What a thing fetches when sold, against what it costs to buy. */
export const SELLING = 0.5;
/** A haggle that works takes this much off a price (or puts it on what a thing fetches). */
export const HAGGLE = 0.3;
/** At most this many moneys in one world. */
export const MONEY_MAX = 3;

/** The money of a world kept before moneys had names: silver, in the story's language. */
export function silverOf(l: Lang): Currency {
  return { id: 'silver', name: tl(l, 'silver'), one: tl(l, 'silver'), text: '', worth: 'common' };
}

/** The moneys of a world, the common one first. A world that says nothing has silver; one with an empty list has none. */
export function currenciesOf(world: World, l: Lang = 'en'): Currency[] {
  return world.money ?? [silverOf(l)];
}

/** Whether the world has money at all. */
export const hasMoney = (world: World): boolean => (world.money ?? [null]).length > 0;

const storyLang = (story: Story): Lang => (story.settings.language === 'pt' ? 'pt' : 'en');

/** The moneys of a story's world. */
export const moneyOf = (story: Story): Currency[] => currenciesOf(story.world, storyLang(story));

/** One money of the story's world, by its id, its name, or its name for one coin. Null when there is no such money. */
export function currencyFor(story: Story, raw: string | null | undefined): Currency | null {
  const list = moneyOf(story);
  const key = (raw ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!key) return null;
  return list.find((c) => c.id === key) ?? list.find((c) => c.name.toLowerCase() === key || c.one.toLowerCase() === key) ?? null;
}

/** What the protagonist carries of each money, by id. A story kept before purses has its silver as the first. */
export function purseOf(story: Story): Record<string, number> {
  const p = story.protagonist;
  if (p.purse) return { ...p.purse };
  const first = moneyOf(story)[0];
  return first ? { [first.id]: Math.max(0, Math.round(p.silver ?? 0)) } : {};
}

/** Set what the protagonist carries: whole numbers, never below nothing. `silver` follows the first money. */
export function setPurse(story: Story, purse: Record<string, number>): void {
  const clean: Record<string, number> = {};
  for (const [id, n] of Object.entries(purse)) clean[id] = Math.max(0, Math.round(Number.isFinite(n) ? n : 0));
  story.protagonist.purse = clean;
  const first = moneyOf(story)[0];
  story.protagonist.silver = first ? clean[first.id] ?? 0 : 0;
}

/** How much of one money the protagonist carries. */
export const amountOf = (story: Story, id: string): number => purseOf(story)[id] ?? 0;

/** Add to (or, with a negative amount, take from) one money. Never below nothing; returns what actually changed hands. */
export function addMoney(story: Story, id: string, amount: number): number {
  const purse = purseOf(story);
  const before = purse[id] ?? 0;
  const after = Math.max(0, before + Math.round(amount));
  purse[id] = after;
  setPurse(story, purse);
  return after - before;
}

/** What something at this price costs in this money: at least one coin. */
export function priceIn(price: Price, c: Pick<Currency, 'worth'>): number {
  return Math.max(1, Math.round(PRICE_VALUE[price] / WORTH_VALUE[c.worth]));
}

/** What a new character carries of a money, from an amount in common coins. */
export function startingIn(kind: keyof typeof STARTING_MONEY, c: Pick<Currency, 'worth'>): number {
  return Math.max(1, Math.round(STARTING_MONEY[kind] / WORTH_VALUE[c.worth]));
}

/** What an amount of one money comes to in another, after the money changer's cut. Coins of one money change at their worth, with no cut. */
export function exchanged(amount: number, from: Pick<Currency, 'worth' | 'id' | 'of'>, to: Pick<Currency, 'worth' | 'id' | 'of'>): number {
  const cut = sameMoney(from, to) ? 0 : EXCHANGE_CUT;
  return Math.floor((amount * WORTH_VALUE[from.worth] * (1 - cut)) / WORTH_VALUE[to.worth]);
}

/** Whether two are coins of one money (or the same money): they then pay for each other. */
export const sameMoney = (a: Pick<Currency, 'id' | 'of'>, b: Pick<Currency, 'id' | 'of'>): boolean => (a.of ?? a.id) === (b.of ?? b.id);

/** The coins that pay for something priced in this money: itself first, then the other coins of the same money, smallest first. */
function payersFor(story: Story, c: Currency): Currency[] {
  return [c, ...moneyOf(story).filter((x) => x.id !== c.id && sameMoney(x, c)).sort((a, b) => WORTH_VALUE[a.worth] - WORTH_VALUE[b.worth])];
}

/** How much of this money the protagonist could pay, counting other coins of the same money at their worth. */
export function payable(story: Story, c: Currency): number {
  const purse = purseOf(story);
  const value = payersFor(story, c).reduce((sum, x) => sum + (purse[x.id] ?? 0) * WORTH_VALUE[x.worth], 0);
  return Math.floor(value / WORTH_VALUE[c.worth] + 1e-9);
}

/**
 * Pay an amount of a money: from that money first, then from the other coins of the same money, as
 * change works (a galleon paid for something priced in sickles gives sickles back). Returns false, and
 * changes nothing, when it cannot be paid.
 */
export function pay(story: Story, c: Currency, amount: number): boolean {
  if (amount <= 0) return true;
  if (payable(story, c) < amount) return false;
  const purse = purseOf(story);
  const unit = WORTH_VALUE[c.worth];
  let owed = amount * unit; // in common coins
  for (const x of payersFor(story, c)) {
    if (owed <= 1e-9) break;
    const w = WORTH_VALUE[x.worth];
    const take = Math.min(purse[x.id] ?? 0, Math.ceil(owed / w - 1e-9));
    purse[x.id] = (purse[x.id] ?? 0) - take;
    owed -= take * w;
  }
  // Paid over, with a larger coin: the change comes back in the money of the price, and what is less than one of it in the smallest coin.
  if (owed < -1e-9) {
    let back = -owed;
    for (const x of payersFor(story, c).sort((a, b) => WORTH_VALUE[b.worth] - WORTH_VALUE[a.worth])) {
      const w = WORTH_VALUE[x.worth];
      if (w > back + 1e-9) continue;
      const n = Math.floor(back / w + 1e-9);
      purse[x.id] = (purse[x.id] ?? 0) + n;
      back -= n * w;
    }
  }
  setPurse(story, purse);
  return true;
}

/** A price after a friend's goodwill: a friend of the protagonist's asks less, a close one much less. */
export function friendRate(bond: number): number {
  return bond >= 60 ? 0.6 : bond >= 20 ? 0.8 : 1;
}

/** An amount in words: "34 silver marks", "1 silver mark". */
export function amountLabel(n: number, c: Pick<Currency, 'name' | 'one'>): string {
  return `${n} ${n === 1 ? c.one : c.name}`;
}

/** The purse in words, for the narrator and the screens: "34 silver marks, 2 gold crowns", or "nothing". Only moneys held, but always the first. */
export function purseWords(story: Story, l: Lang = 'en'): string {
  const purse = purseOf(story);
  const list = moneyOf(story);
  const held = list.filter((c, i) => (purse[c.id] ?? 0) > 0 || i === 0).map((c) => amountLabel(purse[c.id] ?? 0, c));
  return held.length ? held.join(', ') : tl(l, 'nothing');
}

/** Whether a word is one of the price words. */
export const isPrice = (v: unknown): v is Price => typeof v === 'string' && (PRICES as readonly string[]).includes(v);
/** Whether a word is one of the worth words. */
export const isWorth = (v: unknown): v is Worth => typeof v === 'string' && (WORTHS as readonly string[]).includes(v);

/**
 * The moneys a world builder wrote, cleaned: names and lines cut to length, ids well formed and unique,
 * a worth the game knows (common when it said none), at most three. An empty list is kept: the world
 * has no money.
 */
export function cleanMoney(raw: unknown, slug: (s: string) => string): Currency[] {
  if (!Array.isArray(raw)) return [];
  const out: Currency[] = [];
  const taken = new Set<string>();
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const r = m as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name.replace(/\s+/g, ' ').trim().slice(0, 32) : '';
    if (!name) continue;
    const one = typeof r.one === 'string' && r.one.trim() ? r.one.replace(/\s+/g, ' ').trim().slice(0, 32) : name;
    let id = slug(typeof r.id === 'string' && r.id.trim() ? r.id : name) || 'coin';
    while (taken.has(id)) id = `${id}_2`;
    taken.add(id);
    const text = typeof r.text === 'string' ? r.text.replace(/\s+/g, ' ').trim().slice(0, 140) : '';
    const of = typeof r.of === 'string' && r.of.trim() ? slug(r.of) : '';
    out.push({ id, name, one, text, worth: isWorth(r.worth) ? r.worth : 'common', ...(of ? { of } : {}) });
    if (out.length >= MONEY_MAX) break;
  }
  // A coin "of" another must name one that is kept, and not itself; coins of one money share the first one's id.
  for (const c of out) {
    const other = out.find((x) => x.id === c.of && x.id !== c.id);
    if (!other) delete c.of; else if (other.of) c.of = other.of;
  }
  return out;
}
