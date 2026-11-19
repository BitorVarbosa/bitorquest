// Codex: the fourth tab of the Journal. Everything the protagonist has discovered, in one index that
// can be searched: the people met, the places known, the powers of the world and the things carried.
// Every entry is a record the story already keeps. What only the narrator knows is never shown and
// never searched: a person's secret, the narrator's cards, hidden places, where someone hostile is now.
// A long story has hundreds of entries, so each kind shows a page of them and search narrows the rest.
import { useState, type ReactNode } from 'react';
import { stageName } from '../../engine';
import { factsAbout, parentChain } from '../../game/cards';
import type { Faction, Item, Person, Place, Story } from '../../game/types';
import type { IconName } from '../icons';
import { m, t, tn } from '../../i18n';
import { href } from '../router';
import { Avatar, Icon, who } from '../ui';
import { cap, isNamed, whereabouts } from './Person';
import './codex.css';

type Kind = 'people' | 'places' | 'powers' | 'things';
type Filter = 'all' | Kind;

/** A kind shows this many entries; "Show more" adds as many again. */
const PAGE = 20;
const FIRST_PAGE: Record<Kind, number> = { people: PAGE, places: PAGE, powers: PAGE, things: PAGE };

const KINDS: { id: Kind; label: string; none: string }[] = [
  { id: 'people', label: m('People'), none: m('You have not met anyone yet. People appear here once you have met them.') },
  { id: 'places', label: m('Places'), none: m('You know of no places yet.') },
  { id: 'powers', label: m('Powers'), none: m('No powers of this world are known to you yet.') },
  { id: 'things', label: m('Things'), none: m('You are carrying nothing.') },
];

/** The kinds of thing, in the order and with the icons of the inventory on the Character screen. */
const THING: Record<Item['kind'], { label: string; icon: IconName; order: number }> = {
  quest: { label: m('Quest item'), icon: 'flag', order: 0 },
  gear: { label: m('Gear'), icon: 'bag', order: 1 },
  consumable: { label: m('Consumable'), icon: 'flask', order: 2 },
  keepsake: { label: m('Keepsake'), icon: 'heart', order: 3 },
  relic: { label: m('Item of power'), icon: 'spark', order: 1 },
};

/** The kinds of place, as the story's data words them. */
const PLACE_KIND: Record<Place['kind'], string> = {
  world: m('World'), region: m('Region'), settlement: m('Settlement'), district: m('District'), site: m('Site'), building: m('Building'), room: m('Room'),
};

interface Entry {
  key: string;
  /** The words a search looks through: the ones the row shows, folded. */
  hay: string;
  row: () => ReactNode;
}

/** Lower case, without accents and with plain apostrophes, so "sao" finds "São" and "tobin's" finds "Tobin’s". */
const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[‘’]/g, "'").toLowerCase();
const hayOf = (...parts: (string | null | undefined)[]): string => fold(parts.filter(Boolean).join(' · '));

/** Someone the protagonist has met. Pinned people first, then the party, then by bond. */
function personEntry(story: Story, p: Person, here: string): Entry {
  const at = whereabouts(story, p, here);
  // Where they are, only when the protagonist can know it: with you, in the scene, somewhere known, or gone.
  const where = at.present ? (p.inParty ? t('In your party') : t('In this scene')) : at.reachable || p.placeId === 'nowhere' ? cap(at.text) : null;
  const stage = p.bond > 0 ? t(stageName(p.bond)) : null;
  return {
    key: p.id,
    hay: hayOf(p.name, p.short, ...p.aliases, p.role, stage, where),
    row: () => (
      <a key={p.id} className={`row cdx-r ${who(p)}`} href={href(`person/${encodeURIComponent(p.id)}`)}>
        <Avatar person={p} pinned={p.pinned} />
        <span className="grow">
          <span className="cdx-n">{p.name}{stage && <span className="tag">{stage}</span>}</span>
          <span className="row-s">{p.role}</span>
          {where && <span className="cdx-m">{where}</span>}
        </span>
        <Icon name="right" size={18} />
      </a>
    ),
  };
}

/** A place the protagonist has visited or heard of, with what it is inside of. `inside` is whether it has known places of its own. */
function placeEntry(story: Story, p: Place, here: string, inside: boolean): Entry {
  const known = parentChain(story, p.id).slice(0, -1).reverse().filter((x) => x.known !== 'hidden');
  // Nearest first. The world itself is named only when nothing else holds the place.
  const within = known.filter((x) => x.kind !== 'world' || known.length === 1).map((x) => x.name);
  const kindName = t(PLACE_KIND[p.kind] ?? cap(p.kind));
  const what = within.length ? t('{kind} in {places}', { kind: kindName, places: within.join(', ') }) : kindName;
  const state = p.id === here ? t('You are here') : p.known === 'visited' ? t('Visited') : t('Heard of');
  // The map level that shows it. Asked for a place with nothing known inside it, the map opens the level
  // around that place with the place selected; a place with known places inside is found on its parent's level.
  const parent = p.parent ? story.world.places[p.parent] : undefined;
  const level = inside || !parent || parent.known === 'hidden' ? p.parent ?? p.id : p.id;
  // What the player kept as true about it.
  const kept = factsAbout(story, p.id, 4);
  return {
    key: p.id,
    hay: hayOf(p.name, ...(p.aliases ?? []), p.brief, what, state, ...kept.map((f) => f.text)),
    row: () => (
      <a key={p.id} className="row cdx-r" href={href(`map/${encodeURIComponent(level)}`)}>
        <span className="cdx-i" aria-hidden="true"><Icon name="pin" /></span>
        <span className="grow">
          <span className="cdx-n">{p.name}<span className={`tag${p.id === here ? ' tag-accent' : ''}`}>{state}</span></span>
          {p.brief && <span className="row-s">{p.brief}</span>}
          <span className="cdx-m">{what}</span>
          {kept.map((f) => <span key={f.id} className="cdx-m cdx-fact"><Icon name={f.fixed ? 'edit' : 'pin'} size={12} />{f.text}</span>)}
        </span>
        <Icon name="right" size={18} />
      </a>
    ),
  };
}

/** A power of the world, and how the protagonist stands with it. */
function powerEntry(f: Faction): Entry {
  return {
    key: f.id,
    hay: hayOf(f.name, f.standing),
    row: () => (
      <div key={f.id} className="row cdx-r">
        <span className="cdx-i" aria-hidden="true"><Icon name="flag" /></span>
        <span className="grow">
          <span className="cdx-n">{f.name}{f.standing && <span className="tag">{cap(f.standing)}</span>}</span>
        </span>
      </div>
    ),
  };
}

/** Something the protagonist carries. */
function thingEntry(item: Item): Entry {
  const kind = THING[item.kind];
  return {
    key: item.id,
    hay: hayOf(item.name, item.text, t(kind.label)),
    row: () => (
      <div key={item.id} className="row cdx-r">
        <span className="cdx-i" aria-hidden="true"><Icon name={kind.icon} /></span>
        <span className="grow">
          <span className="cdx-n">
            {item.name}{item.qty > 1 && <span className="num">× {item.qty}</span>}
            <span className={`tag${item.kind === 'quest' ? ' tag-gold' : ''}`}>{t(kind.label)}</span>
          </span>
          {item.text && <span className="row-s">{item.text}</span>}
        </span>
      </div>
    ),
  };
}

/** Every entry of the codex, by kind, in the order each kind is listed. */
function entriesOf(story: Story): Record<Kind, Entry[]> {
  const here = story.scenes[story.scenes.length - 1]?.placeId ?? '';
  const people = Object.values(story.world.people)
    .filter((p) => p.met && isNamed(p))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(b.inParty) - Number(a.inParty) || b.bond - a.bond || a.name.localeCompare(b.name));
  // Where the protagonist is comes first, then the places visited, then the ones only heard of.
  const rank = (p: Place): number => (p.id === here ? 0 : p.known === 'visited' ? 1 : 2);
  const places = Object.values(story.world.places)
    .filter((p) => p.known !== 'hidden')
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const holders = new Set(places.map((p) => p.parent));
  const things = story.protagonist.items
    .filter((i) => i.qty > 0)
    .map((item, i) => ({ item, i }))
    .sort((a, b) => THING[a.item.kind].order - THING[b.item.kind].order || a.i - b.i);
  return {
    people: people.map((p) => personEntry(story, p, here)),
    places: places.map((p) => placeEntry(story, p, here, holders.has(p.id))),
    powers: story.world.factions.map(powerEntry),
    things: things.map((x) => thingEntry(x.item)),
  };
}

/** What stands to the right of a kind's heading: where the same things are shown in full. */
function Beside({ kind }: { kind: Kind }) {
  if (kind === 'people') return <a className="link link-tap" href={href('people')}>{t('Everyone you know')}<Icon name="right" size={14} strong /></a>;
  if (kind === 'places') return <a className="link link-tap" href={href('map')}>{t('On the map')}<Icon name="right" size={14} strong /></a>;
  if (kind === 'things') return <a className="link link-tap" href={href('character/inventory')}>{t('What you carry')}<Icon name="right" size={14} strong /></a>;
  return <span className="t-xs t-2">{t('How you stand with each')}</span>;
}

export function Codex({ story }: { story: Story }) {
  const [term, setTerm] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [limits, setLimits] = useState(FIRST_PAGE);

  const all = entriesOf(story);
  const asked = term.trim();
  const words = fold(asked).split(/\s+/).filter(Boolean);
  const matches = (e: Entry): boolean => words.every((w) => e.hay.includes(w));
  const found: Record<Kind, Entry[]> = words.length
    ? { people: all.people.filter(matches), places: all.places.filter(matches), powers: all.powers.filter(matches), things: all.things.filter(matches) }
    : all;
  const total = KINDS.reduce((n, k) => n + found[k.id].length, 0);
  const sections = KINDS.filter((k) => (filter === 'all' || filter === k.id) && found[k.id].length > 0);
  const chosen = KINDS.find((k) => k.id === filter);

  // A new search or another kind starts again from the first page.
  const search = (text: string) => { setTerm(text); setLimits(FIRST_PAGE); };
  const pick = (f: Filter) => { setFilter(f); setLimits(FIRST_PAGE); };

  return (
    <div className="cdx">
      <div className="cdx-bar">
        <div className="input-row">
          <span className="cdx-find-i" aria-hidden="true"><Icon name="search" /></span>
          <input
            className="input" type="text" inputMode="search" enterKeyHint="search" placeholder={t('Search the codex')} aria-label={t('Search the codex')}
            autoComplete="off" value={term} onChange={(e) => search(e.target.value)}
          />
          {term && <button className="ib" onClick={() => search('')} aria-label={t('Clear the search')}><Icon name="x" size={18} /></button>}
        </div>
        <div className="chips" role="group" aria-label={t('Kind of entry')}>
          <button className="chip" aria-pressed={filter === 'all'} onClick={() => pick('all')}><span>{t('All')}<b>{total}</b></span></button>
          {KINDS.map((k) => (
            <button key={k.id} className="chip" aria-pressed={filter === k.id} onClick={() => pick(k.id)}><span>{t(k.label)}<b>{found[k.id].length}</b></span></button>
          ))}
        </div>
      </div>

      {sections.map((k) => {
        const rows = found[k.id];
        const limit = limits[k.id];
        return (
          <section key={k.id} className="sec" aria-label={t(k.label)}>
            <div className="sec-h"><h2>{t(k.label)}</h2><Beside kind={k.id} /></div>
            <div className="card card-flush cdx-list">{rows.slice(0, limit).map((e) => e.row())}</div>
            {rows.length > limit && (
              <button className="btn btn-quiet cdx-more" onClick={() => setLimits({ ...limits, [k.id]: limit + PAGE })}>
                <Icon name="down" size={18} />{t('Show more {kind} ({count})', { kind: t(k.label).toLowerCase(), count: rows.length - limit })}
              </button>
            )}
          </section>
        );
      })}

      {sections.length === 0 && (
        <div className="stack cdx-none" role="status">
          <p className="t-2">
            {!words.length ? (chosen ? t(chosen.none) : t('Nothing has been discovered yet.'))
              : !chosen || total === 0 ? t('Nothing in the codex matches “{asked}”. A search looks at names and at the words on each entry.', { asked })
              : t('No {kind} match “{asked}”. The other kinds have {matches}.', { kind: t(chosen.label).toLowerCase(), asked, matches: tn(total, '{n} match', '{n} matches') })}
          </p>
          <div className="inline">
            {chosen && (!words.length || total > 0) && <button className="btn btn-fit" onClick={() => pick('all')}>{t('Show all kinds')}</button>}
            {words.length > 0 && <button className="btn btn-fit" onClick={() => search('')}>{t('Clear the search')}</button>}
          </div>
        </div>
      )}
    </div>
  );
}
