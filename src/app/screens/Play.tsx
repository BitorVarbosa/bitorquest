// The play screen: the story, the dice, the people with you.
// Phone: top bar (menu, the faces of the people here), one line of meters, the log, the dock. The story
// takes the room: like every screen of a story it has no bottom bar (the screens are in the menu), and
// only a fight adds a row, for its fighters.
// PC: rail | people | story | character, journal and ways out.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ATTRIBUTES, PATHS, SCHOOLS, abilityById, conditionLabel, isUp, maxEnergy, maxHp, schoolsOf, stageName, traitInfo, type Combat, type Combatant } from '../../engine';
import { castOf, exitsFrom } from '../../game/cards';
import { SERVICE_NAME } from '../../game/llm/models';
import { fightersForDisplay, type Blocker, type Session } from '../../game/session';
import { currentScene, sceneTitle } from '../../game/story';
import type { GameEvent, Person, Story, Turn } from '../../game/types';
import { m, t, tn } from '../../i18n';
import { useApp } from '../app';
import { Dock, NARRATOR, type Rolling } from '../components/PlayDock';
import { AsideView, AskCard, LiveTurn, TurnView, Waiting, attributeName, condClass, condText, pathName, type Pickable } from '../components/PlayLog';
import { EndCard, FactSheet, PassageBar, TakeBar, type Picked } from '../components/Tools';
import { href, useRoute } from '../router';
import { Nav, StoryMenu, TopBar, useShell } from '../Shell';
import { T } from '../T';
import { afterLanding, diceCards, freshTable, nextDice, type Table } from '../table';
import { Avatar, BondBar, Icon, Meter, Modal, money, who } from '../ui';

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
/** The table styles by their id, to be translated where they are drawn. */
const STYLE_NAME: Record<string, string> = { story: m('Story'), adventure: m('Adventure'), brutal: m('Brutal') };

/** How many faces the top bar of a phone shows for the people here; one more person than that and the last face gives way to a count. */
const FACES_MAX = 3;
/** Rows of a group shown in the people panel before "Show more". */
const PANEL_GROUP_MAX = 4;

/** How far below the top of the view the start of a new passage is placed. */
const TOP_GAP = 14;
/** How long a smooth scroll is given to arrive before the page position is read as the reader's own. */
const GLIDE_MS = 1200;
/** Keys that scroll a page: pressing one means the reader is moving it. */
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

/** Where an element sits inside the scrolling log, measured from the top of its content. Unlike a
 *  bounding box this ignores transforms, so an element that is still sliding in is measured where it will rest. */
function placeIn(el: HTMLElement, child: HTMLElement): number {
  let y = 0;
  let node: HTMLElement | null = child;
  while (node && node !== el) { y += node.offsetTop; node = node.offsetParent as HTMLElement | null; }
  return y;
}

/** What the view is held to: the start of the newest turn (or question), the line drawn by Continue, the dice of the newest turn, or the end. */
type Place = 'start' | 'mark' | 'dice' | 'end';
const STARTS = '[data-anchor]:not([data-mark])';
const last = (el: HTMLElement, selector: string): HTMLElement | undefined => {
  const all = el.querySelectorAll<HTMLElement>(selector);
  return all[all.length - 1];
};

/** The scroll position that shows a place: its element at the top of the view, or the end, within what can be scrolled.
 *  The element is looked up each time, because the turn in flight and the finished turn draw the same line with different elements. */
function topFor(el: HTMLElement, place: Place): number {
  const end = Math.max(0, el.scrollHeight - el.clientHeight);
  const at = place === 'end' ? undefined : (place === 'mark' ? last(el, '[data-mark]') : undefined) ?? last(el, STARTS);
  const start = at ? Math.max(0, Math.min(end, placeIn(el, at) - TOP_GAP)) : end;
  if (place !== 'dice') return start;
  // A turn with dice is read from its start, like any other, for as long as its dice fit under it. A
  // round against many is taller than the screen: then the card being thrown is kept in view, and once
  // the last one has landed it goes to the top, so that the telling has room under it.
  const within = (top: number) => Math.max(start, Math.min(end, top));
  const thrown = last(el, '[data-throw]');
  if (thrown) return within(Math.min(placeIn(el, thrown) - TOP_GAP, placeIn(el, thrown) + thrown.offsetHeight + TOP_GAP - el.clientHeight));
  const card = last(el, '[data-dice]');
  if (card && placeIn(el, card) + card.offsetHeight - start > el.clientHeight * 0.66) return within(placeIn(el, card) - TOP_GAP);
  return start;
}

/** The turn with this number, when it is the last of the scene being played or of the one before it. */
function turnNumbered(story: Story, n: number): Turn | null {
  for (const scene of story.scenes.slice(-2).reverse()) {
    const turn = scene.turns[scene.turns.length - 1];
    if (turn?.n === n) return turn;
  }
  return null;
}

/** Where the view is being held, the position it was last sent to, and until when it is still gliding there. */
interface Hold { place: Place; top: number; glidingUntil: number }

/** Bring the held place into view, with a glide when asked for and animations are on. Does nothing when the view is already there or on its way. */
function bring(el: HTMLElement, h: Hold, glide: boolean): void {
  const top = topFor(el, h.place);
  const now = performance.now();
  if (Math.abs(top - h.top) < 1 && (now < h.glidingUntil || Math.abs(el.scrollTop - top) < 1)) return;
  const smooth = glide && document.documentElement.dataset.motion !== 'off';
  h.top = top;
  h.glidingUntil = smooth ? now + GLIDE_MS : 0;
  el.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
}

function moments(story: Story, id: string): GameEvent[] {
  return story.events.filter((e) => e.bond?.who === id);
}

/** One line under the top bar: hit points, energy and destiny, each by its icon. A tap says what they are. */
function Vitals({ story, onOpen }: { story: Story; onOpen: () => void }) {
  const p = story.protagonist;
  const hp = { n: p.sheet.hp, max: maxHp(p.sheet) };
  const en = { n: p.sheet.energy, max: maxEnergy(p.sheet) };
  const share = (v: { n: number; max: number }) => ({ '--v': `${v.max > 0 ? Math.max(0, Math.min(100, (v.n / v.max) * 100)) : 0}%` }) as CSSProperties;
  return (
    <button
      type="button" className="vitals" onClick={onOpen} aria-haspopup="dialog"
      aria-label={t('{name}: {hp} of {hpMax} hit points, {en} of {enMax} energy, {destiny} destiny. What these are', { name: p.name, hp: hp.n, hpMax: hp.max, en: en.n, enMax: en.max, destiny: p.destiny })}
    >
      <span className="vt hp" style={share(hp)}><Icon name="heart" size={13} fill /><span className="track"><i /></span><span className="m-v"><b>{hp.n}</b>/{hp.max}</span></span>
      <span className="vt en" style={share(en)}><Icon name="bolt" size={13} fill /><span className="track"><i /></span><span className="m-v"><b>{en.n}</b>/{en.max}</span></span>
      <span className="vt vt-d"><Icon name="gem" size={13} fill /><span className="m-v"><b>{p.destiny}</b></span></span>
    </button>
  );
}

/** What the three on the line are, with what the character has of each, and the way to the full sheet. */
function VitalsSheet({ story, onClose }: { story: Story; onClose: () => void }) {
  const p = story.protagonist;
  return (
    <Modal title={p.name} onClose={onClose}>
      <div className="card card-flush">
        <div className="row hp">
          <span className="tab-i vt-i"><Icon name="heart" size={20} fill /></span>
          <span className="grow"><span className="row-t">{t('Hit points')}</span><span className="row-s">{t('The harm you can take. At 0 you go down.')}</span></span>
          <span className="row-end"><span className="m-v"><b>{p.sheet.hp}</b>/{maxHp(p.sheet)}</span></span>
        </div>
        <div className="row en">
          <span className="tab-i vt-i"><Icon name="bolt" size={20} fill /></span>
          <span className="grow"><span className="row-t">{t('Energy')}</span><span className="row-s">{t('What your abilities cost to use.')}</span></span>
          <span className="row-end"><span className="m-v"><b>{p.sheet.energy}</b>/{maxEnergy(p.sheet)}</span></span>
        </div>
        <div className="row">
          <span className="tab-i"><Icon name="gem" size={20} fill /></span>
          <span className="grow"><span className="row-t">{t('Destiny')}</span><span className="row-s">{t('A point gets you back up with 5 hit points when you go down. They come back with each new chapter.')}</span></span>
          <span className="row-end"><span className="m-v"><b>{p.destiny}</b>/{p.destinyMax}</span></span>
        </div>
      </div>
      <a className="btn" href={href('character')}><Icon name="sheet" size={18} />{t('Open the character sheet')}</a>
    </Modal>
  );
}

/** Who is here, folded into the top bar of a phone: up to three faces, or two and how many more. Opens the people panel. */
function Faces({ present, dot, onOpen }: { present: Person[]; dot: boolean; onOpen: () => void }) {
  if (present.length === 0) return null;
  // The party first, then the people with a name, then the extras and the crowds.
  const rank = (p: Person) => (p.inParty ? 0 : p.count === 1 && p.tier !== 'extra' ? 1 : 2);
  const order = [...present].sort((x, y) => rank(x) - rank(y));
  const shown = order.slice(0, order.length > FACES_MAX ? FACES_MAX - 1 : FACES_MAX);
  const rest = order.length - shown.length;
  return (
    <button type="button" className="faces" onClick={onOpen} aria-haspopup="dialog" aria-label={tn(present.length, '{n} person here. Open the people panel', '{n} people here. Open the people panel')}>
      <span className="av-stack">{shown.map((p) => <Avatar key={p.id} person={p} />)}</span>
      {rest > 0 && <span className="faces-n">+{rest}</span>}
      {dot && <span className="tab-dot" aria-label={t('Something changed')} />}
    </button>
  );
}

/** In a fight the strip shows the fighters in turn order. Groups are one entry with a count. */
/** A fighter's face: a known person keeps their colour; an unnamed one shows an initial, a group its number. */
function FighterFace({ f, story, large = false }: { f: Combatant; story: Story; large?: boolean }) {
  const person = story.world.people[f.id];
  if (f.isProtagonist) return <span className={`av av-you${large ? ' av-l' : ''}`} aria-hidden="true">{f.name.slice(0, 1)}</span>;
  if (person && person.count === 1 && person.tier !== 'extra') return <Avatar person={person} size={large ? 'l' : undefined} />;
  return <span className={`av av-anon${large ? ' av-l' : ''}`} aria-hidden="true">{f.countMax > 1 ? f.count : f.name.slice(0, 1)}</span>;
}

function FightStrip({ combat, story, onAll }: { combat: Combat; story: Story; onAll: () => void }) {
  const { yours, theirs } = fightersForDisplay(combat);
  const acting = combat.awaiting === 'action' ? 'you' : null;
  const place = (id: string) => combat.order.indexOf(id) + 1;
  const chip = (f: Combatant) => (
    <span key={f.id} className={`pc ${who(story.world.people[f.id])}${f.side === 'foe' ? ' pc-scene' : ''}${f.id === acting ? ' is-acting' : ''}`}>
      <span style={{ position: 'relative' }}>
        <FighterFace f={f} story={story} />
        {f.fights && place(f.id) > 0 && <span className="ord">{place(f.id)}</span>}
      </span>
      <span className="pc-n">{f.name}</span>
      <span className={`pc-m ${f.id === acting ? 'is-now' : `cond ${condClass(conditionLabel(f))}`}`}>{f.id === acting ? t('Your turn') : !f.fights ? t('Stays back') : condText(conditionLabel(f))}</span>
    </span>
  );
  return (
    <div className="strip" role="group" aria-label={t('The fight')}>
      <div className="strip-row">
        {yours.map(chip)}
        <span className="strip-sep" aria-hidden="true" />
        {theirs.map(chip)}
      </div>
      <button className="pc pc-all" onClick={onAll} aria-label={t('Open the fight panel')}>
        <span className="av av-all" aria-hidden="true"><Icon name="right" size={18} /></span>
        <span className="pc-n">{t('Round {n}', { n: combat.round })}</span>
        <span className="pc-m">{t('Details')}</span>
      </button>
    </div>
  );
}

function PersonCard({ story, p, open, onToggle, onTalk }: { story: Story; p: Person; open: boolean; onToggle: () => void; onTalk: () => void }) {
  const all = moments(story, p.id);
  const top = [...all].sort((a, b) => Math.abs(b.bond!.delta) - Math.abs(a.bond!.delta) || b.clock.day - a.clock.day).slice(0, 2);
  const rest = all.length - top.length;
  const named = p.count === 1 && p.tier !== 'extra';
  return (
    <article className={`person ${who(p)}${p.inParty ? ' is-focus' : ''}${open ? ' is-open' : ''}`}>
      <div className="person-top">
        <span style={{ position: 'relative' }}><Avatar person={p} size="l" pinned={p.pinned} />{p.count > 1 && <span className="pc-count">{p.count}</span>}</span>
        {named ? (
          <a className="person-id" href={href(`person/${p.id}`)} title={t('Open {name}’s profile', { name: p.name })}>
            <div className="person-name">{p.name} {p.pinned && <span className="pinned"><Icon name="star" size={12} fill />{t('Pinned')}</span>}</div>
            <div className="person-role">{p.role}</div>
          </a>
        ) : (
          <div className="person-id"><div className="person-name">{p.name}{p.count > 1 ? ` ×${p.count}` : ''}</div><div className="person-role">{p.role}</div></div>
        )}
        <div className="bond">
          {p.bond > 0 ? (
            <>
              <div className="bond-l"><b>{t(stageName(p.bond))}</b><span><b>{p.bond}</b>/100</span></div>
              <BondBar bond={p.bond} size="l" />
              <span className="mood">{p.attitude}</span>
            </>
          ) : (
            <><span className="mood">{p.attitude}</span>{named && <small>{t('No bond yet')}</small>}</>
          )}
        </div>
        {!p.inParty && named && <button className="btn talk-sm" onClick={onTalk}>{t('Talk')}</button>}
      </div>
      {!p.inParty && (p.attitudeWhy || p.count > 1 || !named) && <p className="person-note">{p.attitudeWhy ? `${cap(p.attitudeWhy)}.` : p.card}</p>}
      {p.inParty && (
        <div className="person-detail">
          {p.pendingMoment && <p className="moment"><Icon name="spark" size={16} fill /><span><T text="<b>New stage: {stage}</b>{name} wants a moment with you. Give them some quiet time in the story and it will come." vars={{ stage: t(p.pendingMoment), name: p.name }} /></span></p>}
          {top.length > 0 && (
            <>
              <h4 className="mem-k">{t('Moments that mattered')}</h4>
              <ul className="mem">
                {top.map((e) => <li key={e.id}><span>{e.text}</span><span className="mem-x"><b className={e.bond!.delta < 0 ? 'loss' : ''}>{e.bond!.delta > 0 ? '+' : '−'}{Math.abs(e.bond!.delta)}</b> · {e.clock.day === story.clock.day ? t('today') : t('Day {n}', { n: e.clock.day })}</span></li>)}
              </ul>
              {rest > 0 && <a className="mem-more" href={href(`person/${p.id}?view=history`)}><span>{tn(rest, 'and {n} smaller moment', 'and {n} smaller moments')}</span><span className="mem-all">{t('See all')}<Icon name="right" size={14} strong /></span></a>}
            </>
          )}
          <p className="vals">{p.valuesKnown.length ? <T text="Values {list}" vars={{ list: <>{p.valuesKnown.map((v, i) => <span key={v}>{i > 0 ? (i === p.valuesKnown.length - 1 ? ` ${t('and')} ` : ', ') : ''}<b>{v}</b></span>)}</> }} /> : t('Values not known yet')}</p>
          <div className="acts">
            <button className="btn btn-primary" onClick={onTalk}><Icon name="chat" size={18} />{t('Talk')}</button>
            <a className="btn" href={href(`person/${p.id}`)}>{t('Profile')}<Icon name="right" size={16} /></a>
          </div>
        </div>
      )}
      {named && (
        <div className="person-foot">
          <button className="link foot-talk" onClick={onTalk}><Icon name="chat" size={16} />{t('Talk')}</button>
          {p.inParty
            ? <button className="link" onClick={onToggle} aria-expanded={open}>{open ? t('Less') : t('More')}<Icon name="down" size={14} strong className="chev" /></button>
            : <a className="link" href={href(`person/${p.id}`)}>{t('Profile')}<Icon name="right" size={14} strong /></a>}
        </div>
      )}
    </article>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode[] }) {
  const [all, setAll] = useState(false);
  const rows = all ? children : children.slice(0, PANEL_GROUP_MAX);
  return (
    <>
      <h3 className="grp"><span>{title}</span><span>{count}</span></h3>
      {rows}
      {children.length > PANEL_GROUP_MAX && (
        <button className="btn btn-quiet grp-more" onClick={() => setAll(!all)}>{all ? t('Show fewer') : t('Show {n} more', { n: children.length - PANEL_GROUP_MAX })}</button>
      )}
    </>
  );
}

function FightPanel({ combat, story }: { combat: Combat; story: Story }) {
  const { yours, theirs } = fightersForDisplay(combat);
  const acting = combat.awaiting === 'action';
  const row = (f: Combatant) => {
    const label = conditionLabel(f);
    const level = !isUp(f) ? 3 : f.hp >= f.hpMax ? 0 : f.hp * 2 > f.hpMax ? 1 : 2;
    return (
      <article key={f.id} className={`person ${who(story.world.people[f.id])}${f.isProtagonist && acting ? ' is-acting' : ''}`}>
        <div className="person-top">
          <span style={{ position: 'relative' }}>
            <FighterFace f={f} story={story} large />
            {f.fights && combat.order.includes(f.id) && <span className="ord">{combat.order.indexOf(f.id) + 1}</span>}
          </span>
          <div className="person-id">
            <div className="person-name">{f.name}{f.countMax > 1 ? ` ×${f.countMax}` : ''} {f.isProtagonist && <span className="you">{t('You')}</span>}</div>
            <div className="person-role">{f.isProtagonist ? t('{hp}/{max} hit points', { hp: story.protagonist.sheet.hp, max: maxHp(story.protagonist.sheet) }) : !f.fights ? t('Stays out of the fight') : f.side === 'you' ? t('Fights beside you') : t('Against you')}</div>
          </div>
          <div className="bond">
            <span className={`cond ${condClass(label)}`}>{f.isProtagonist && acting ? t('Your turn') : condText(label)}</span>
            {f.fights && <span className={`pips lv lv-${Math.min(level, 2)}`} aria-hidden="true">{[0, 1, 2].map((i) => <i key={i} className={level < 3 && i < 3 - level ? 'on' : ''} />)}</span>}
          </div>
        </div>
      </article>
    );
  };
  return (
    <>
      <ol className="order" aria-label={t('Order of action')}>
        {combat.order.map((id, i) => <li key={id} className={id === 'you' && acting ? 'is-now' : ''}>{i + 1} {combat.fighters[id]?.name ?? id}</li>)}
      </ol>
      <h3 className="grp"><span>{t('Your side')}</span><span>{t('{n} fighting', { n: yours.filter(isUp).length })}</span></h3>
      {yours.map(row)}
      <h3 className="grp"><span>{t('Against you')}</span><span>{t('{n} standing', { n: theirs.filter(isUp).length })}</span></h3>
      {theirs.map(row)}
    </>
  );
}

/** What stands in the way of a turn: one card saying what happened, what it means, and what to do. */
function BlockerCard({ blocker, session }: { blocker: Blocker; session: Session }) {
  const a = useApp();
  const [details, setDetails] = useState(false);
  if (blocker.kind === 'budget') {
    const next = Math.max(blocker.cap * 2, blocker.cap + 1);
    return (
      <div className="alert alert-warn sys sys-warn" role="alert">
        <Icon name="coins" />
        <div className="sys-b">
          <p className="sys-t">{t('Today’s spending limit is reached')}</p>
          <div className="sys-meter"><span><T text="<b>{spent}</b> of {cap} spent today" vars={{ spent: money(blocker.spent, 2), cap: money(blocker.cap, 2) }} /></span><div className="track track-l gold" style={{ '--v': '100%' } as CSSProperties}><i /></div></div>
          <p>{t('Play is paused until tomorrow, or until you raise the limit.')}</p>
          <ul className="sys-facts"><li><Icon name="check" size={14} strong />{t('Story saved')}</li><li><Icon name="check" size={14} strong />{t('Nothing more is charged')}</li></ul>
          <div className="sys-acts">
            <button className="btn btn-primary" onClick={() => { a.setSettings({ dailyCap: next }); session.recheckBudget(); void session.retry(); }}>{t('Raise today’s limit to {amount}', { amount: money(next, 2) })}</button>
            <a className="btn" href={href('usage')}>{t('Open usage')}</a>
          </div>
        </div>
      </div>
    );
  }
  if (blocker.kind === 'elsewhere') {
    return (
      <div className="alert alert-warn sys sys-warn" role="alert">
        <Icon name="copy" />
        <div className="sys-b">
          <p className="sys-t">{t('This story is open in another window')}</p>
          <p>{t('Playing it in two windows at once would let each save over the other’s turns, so it can be played in one at a time. Go on there, or close it there and take it here.')}</p>
          <ul className="sys-facts"><li><Icon name="check" size={14} strong />{t('Nothing lost')}</li><li><Icon name="check" size={14} strong />{t('What was played there is kept')}</li></ul>
          <div className="sys-acts">
            <button className="btn btn-primary" onClick={() => void a.reclaimStory()}><Icon name="refresh" size={18} />{t('Try again')}</button>
            <a className="btn" href={href('')}>{t('Your stories')}</a>
          </div>
        </div>
      </div>
    );
  }
  if (blocker.kind === 'refusal') {
    return (
      <div className="alert sys" role="alert">
        <Icon name="info" />
        <div className="sys-b">
          <p className="sys-t">{t('The narrator declined this turn')}</p>
          <p>{t('It would not write what comes next. This happens now and then, sometimes for no clear reason. Rephrase your action, or take the story another way.')}</p>
          <ul className="sys-facts"><li><Icon name="check" size={14} strong />{t('Story unchanged')}</li><li className="paid"><Icon name="coins" size={14} />{t('The attempt was charged')}</li></ul>
          <div className="sys-acts"><button className="btn btn-primary" onClick={() => session.dismiss()}><Icon name="edit" size={18} />{t('Rephrase')}</button></div>
        </div>
      </div>
    );
  }
  // Told about the service that failed and its key: the roles of a turn may be played on different
  // services, and the player must know whose key, account or outage it is.
  const where = blocker.service ?? 'anthropic';
  const service = SERVICE_NAME[where];
  const text: Record<typeof blocker.kind, { title: string; body: string; icon: 'offline' | 'warn' | 'clock' | 'key' }> = {
    offline: { title: t('No connection'), body: t('The request did not reach {service}. Your story is saved on this device; the journal, people and character can still be read.', { service }), icon: 'offline' },
    overloaded: {
      // Any part of a turn may be the one that did not answer, on any service: the service is named, not the narrator.
      title: where === 'anthropic' ? t('The narrator did not answer') : t('{service} did not answer', { service }),
      body: blocker.status ? t('{service}’s service is busy right now (error {status}). It usually clears within a minute.', { service, status: blocker.status }) : t('{service}’s service is busy right now. It usually clears within a minute.', { service }),
      icon: 'warn',
    },
    rate: {
      title: t('Too many requests for now'),
      body: blocker.retryAfter ? t('{service} is asking us to slow down; try again in about {n} seconds. This passes by itself.', { service, n: Math.ceil(blocker.retryAfter) }) : t('{service} is asking us to slow down. This passes by itself.', { service }),
      icon: 'clock',
    },
    key: { title: t('The {service} key stopped working', { service }), body: t('{service} did not accept the key. It may have been revoked or replaced. Your story is safe.', { service }), icon: 'key' },
    // A key that reached the spending limit set for it is not an empty account: the limit is raised at
    // the service, or resets by itself.
    credit: blocker.detail === 'limit'
      ? {
        title: t('The {service} key reached its spending limit', { service }),
        body: t('The limit you set for this key at {service} was reached. Raise it there, or wait for it to reset. Your story is safe.', { service }),
        icon: 'key',
      }
      : {
        title: t('The {service} account cannot be charged', { service }),
        body: where === 'anthropic' ? t('Add credit in the Claude Console, then try again. Your story is safe.') : t('Add balance at {service}, then try again. Your story is safe.', { service }),
        icon: 'key',
      },
    // A request Claude turns down is most likely the app's fault. Another service's model may simply not
    // take what it was asked (a shape, a size): its own reason is in the details, and another model may do.
    // A request the game itself did not send says why, in its own words.
    error: blocker.detail === 'not-sent'
      ? { title: t('Not sent'), body: blocker.message, icon: 'warn' }
      : {
        title: t('Something went wrong'),
        body: where === 'anthropic' ? t('The request was not accepted. This is likely a fault in the app, not something you did.') : t('{service} did not accept the request. Show the details to see why; another model may work.', { service }),
        icon: 'warn',
      },
  };
  const info = text[blocker.kind];
  const needsKey = blocker.kind === 'key' || blocker.kind === 'credit';
  // Settings is where a key is replaced, and where another model is chosen.
  const toSettings = needsKey || (blocker.kind === 'error' && where !== 'anthropic');
  return (
    <div className={`alert sys ${needsKey || blocker.kind === 'error' ? 'alert-err sys-err' : 'alert-warn sys-warn'}`} role="alert">
      <Icon name={info.icon} />
      <div className="sys-b">
        <p className="sys-t">{info.title}</p>
        <p>{info.body}</p>
        <ul className="sys-facts"><li><Icon name="check" size={14} strong />{t('Nothing lost')}</li><li><Icon name="check" size={14} strong />{t('Dice already rolled are kept')}</li></ul>
        <div className="sys-acts">
          <button className="btn btn-primary" onClick={() => void session.retry()}><Icon name="refresh" size={18} />{t('Try again')}</button>
          {toSettings && <a className="btn" href={href('settings')}>{t('Open settings')}</a>}
          <button className="btn" onClick={() => session.dismiss()}>{t('Take the action back')}</button>
          {blocker.message && <button className="btn btn-quiet" onClick={() => setDetails(!details)}>{details ? t('Hide details') : t('Show details')}</button>}
        </div>
        {details && <p className="sys-more">{blocker.message}{blocker.status ? ` (${t('status {n}', { n: blocker.status })})` : ''}</p>}
      </div>
    </div>
  );
}

/** At 0 hit points the player chooses. Which options exist depends on the table style. */
function Fate({ session }: { session: Session }) {
  const story = session.story;
  const p = story.protagonist;
  const style = story.settings.style;
  const softened = style === 'adventure' && story.softenUsed !== story.chapter.n;
  return (
    <section className="card fate" aria-label={t('You are down')}>
      <div className="fate-h">
        <Icon name="heart" fill />
        <div><p className="fate-t">{t('{name} is down', { name: p.name })}</p><p className="fate-s">{t('0 hit points. This story is played in the {style} style, so you choose what happens next.', { style: t(STYLE_NAME[style] ?? cap(style)) })}</p></div>
      </div>
      <button className="choice" disabled={p.destiny < 1} onClick={() => void session.chooseDown('destiny')}>
        <span className="dotmark" aria-hidden="true" />
        <span className="grow"><span className="choice-t">{t('Spend a destiny point')}</span><span className="choice-d" style={{ display: 'block' }}>{p.destiny < 1 ? t('You have none left this chapter.') : t('You get back up with 5 hit points and the fight goes on. You have {have}; this leaves {left}.', { have: p.destiny, left: p.destiny - 1 })}</span></span>
        <span className="choice-m">{Array.from({ length: p.destiny }, (_, i) => <Icon key={i} name="gem" size={14} fill />)}</span>
      </button>
      <button className="choice" onClick={() => void session.chooseDown('test')}>
        <span className="dotmark" aria-hidden="true" />
        <span className="grow">
          <span className="choice-t">{style === 'story' ? t('Take the fall') : t('Take the death test')}</span>
          <span className="choice-d" style={{ display: 'block' }}>
            {style === 'story' ? t('The fight ends for you. You come to later: captured, robbed or delayed, never dead.')
              : style === 'adventure' ? t('One roll against Resistance decides how bad it is, and the fight ends for you.')
              : t('One roll against Resistance. If it fails, the story ends here.')}
          </span>
          {style === 'adventure' && <span className={`tag ${softened ? 'tag-ok' : 'tag-err'}`}>{softened ? t('Softened once per chapter · not used yet: at worst you wake up captured') : t('The softening was already used this chapter: a failed roll is death')}</span>}
        </span>
        <span className="choice-m"><Icon name="dice" size={18} /></span>
      </button>
    </section>
  );
}

function ContextPane({ story }: { story: Story }) {
  const p = story.protagonist;
  const s = p.sheet;
  const scene = story.scenes[story.scenes.length - 1]!;
  const open = story.threads.filter((th) => th.status === 'open');
  const due = story.commitments.find((c) => !c.done);
  const exits = exitsFrom(story, scene.placeId);
  return (
    <aside className="ctx" aria-label={t('Character, journal and ways out')}>
      <section className="card">
        <header className="card-h">
          <h2 className="card-t"><Icon name="sheet" size={16} />{t('Character')}</h2>
          <a className="link" href={href('character')}>{t('Sheet')}<Icon name="right" size={14} strong /></a>
        </header>
        <div className="char-id">
          <Avatar you={p.name} />
          <div><div className="char-n">{p.name}</div><div className="char-s">{t(p.level)} · {p.ancestry}</div></div>
          <dl className="char-x">
            <div><dt>{t('Destiny')}</dt><dd>{Array.from({ length: p.destiny }, (_, i) => <Icon key={i} name="gem" size={12} fill />)}<span>{p.destiny}</span></dd></div>
            <div><dt>{t('Experience')}</dt><dd>{p.xp}</dd></div>
          </dl>
        </div>
        <div className="meters">
          <Meter kind="hp" label={t('Hit points')} value={s.hp} max={maxHp(s)} />
          <Meter kind="en" label={t('Energy')} value={s.energy} max={maxEnergy(s)} />
        </div>
        <dl className="stats" aria-label={t('Attributes')}>
          {ATTRIBUTES.map((k) => <div key={k}><dt>{attributeName(k)}</dt><dd className={s[k] === 0 ? 'zero' : ''}>{s[k]}</dd></div>)}
        </dl>
        <dl className="facts">
          {PATHS.some((k) => (s.paths[k] ?? 0) > 0) && <div><dt>{t('Paths')}</dt><dd>{PATHS.filter((k) => (s.paths[k] ?? 0) > 0).map((k) => <span key={k} className="tag">{pathName(k)} <b>{s.paths[k]}</b></span>)}</dd></div>}
          {story.world.rules.powers === 'gift'
            // A power of one's own and its moves: the player's words, shown as written.
            ? s.gift && <div><dt>{t('Power')}</dt><dd><span className="tag"><b>{s.gift.name}</b> {s.gift.rank}</span>{s.gift.moves.map((mv) => <span key={mv.id} className="tag">{mv.name} {mv.tier}</span>)}</dd></div>
            : story.world.rules.powers === 'extreme'
            ? schoolsOf(s).length > 0 && <div><dt>{t('Schools')}</dt><dd>{schoolsOf(s).map((id) => <span key={id} className="tag"><b>{t(SCHOOLS[id].name)}</b></span>)}</dd></div>
            : s.abilities.length > 0 && <div><dt>{t('Abilities')}</dt><dd>{s.abilities.map((id) => abilityById(id)).filter((x) => !!x).map((ab) => <span key={ab.id} className="tag"><b>{t(ab.name)}</b> {pathName(ab.path)} {ab.tier}</span>)}</dd></div>}
          {s.advantages.length > 0 && <div><dt>{t('Advantages')}</dt><dd className="list">{s.advantages.map((x) => <span key={x} title={t(traitInfo(x, 'advantage').summary)}>{t(x)}</span>)}</dd></div>}
          {s.skills.length > 0 && <div><dt>{t('Skills')}</dt><dd className="list">{s.skills.map((x) => <span key={x}>{t(x)}</span>)}</dd></div>}
        </dl>
      </section>

      <section className="card">
        <header className="card-h">
          <h2 className="card-t"><Icon name="journal" size={16} />{t('Journal · Threads')}</h2>
          <a className="link" href={href('journal')}>{t('Open')}<Icon name="right" size={14} strong /></a>
        </header>
        <ul className="threads">
          {open.slice(0, 2).map((th) => (
            <li key={th.id}>
              <p className="th-t">{th.title}</p>
              {th.next ? <p className="th-m"><b>{t('Next:')}</b> {th.next}</p> : th.clues.length > 0 ? <p className="th-m"><b>{t('Clue:')}</b> {th.clues[th.clues.length - 1]!.text}</p> : null}
            </li>
          ))}
        </ul>
        {due && <div className="due"><div className="due-k"><Icon name="clock" size={14} strong />{t('Commitment · due {when}', { when: due.dueLabel })}</div><p>{due.text}</p></div>}
      </section>

      <section className="card">
        <header className="card-h">
          <h2 className="card-t"><Icon name="map" size={16} />{t('Ways out')}</h2>
          <a className="link" href={href('map')}>{t('Map')}<Icon name="right" size={14} strong /></a>
        </header>
        <ul className="threads">
          {exits.slice(0, 5).map((e) => (
            <li key={e.place.id} className={e.place.known === 'visited' ? 'done' : ''}>
              <p className="th-t">{e.place.name} <span className="t-2" style={{ fontWeight: 400 }}>{t('· {n} min', { n: e.minutes })}</span></p>
              {e.note && <p className="th-m">{e.note}</p>}
            </li>
          ))}
          {exits.length === 0 && <li><p className="th-m">{t('Nowhere to go from here in one step.')}</p></li>}
        </ul>
      </section>
    </aside>
  );
}

export function Play() {
  useShell('story');
  const a = useApp();
  const route = useRoute();
  const s = a.session!;
  // What was already in the story when this screen opened is simply there. What comes in afterwards
  // arrives: its dice are thrown and its first passage fades in, once, when it first appears.
  const opened = useRef({ at: Date.now(), turns: s.story.totals.turns });
  // After going back in the story, what is played again arrives again.
  if (s.story.totals.turns < opened.current.turns) opened.current.turns = s.story.totals.turns;

  // ----- The dice of the latest turn -----
  // The rules settle a turn the moment it is sent, so the story already holds what its dice did. Until
  // the player has thrown them the screen shows none of it: the meters, the fight and the people stay
  // as they were when the turn began (Session.before), and the log stops at the card that waits.
  const held = s.blocker ? (s.blocker.kind === 'refusal' ? 'declined' as const : 'waiting' as const) : null;
  const flight = held ? null : s.arriving;
  const before = s.before;
  const pendN = before && before.totals.turns >= opened.current.turns ? before.totals.turns + 1 : -1;
  // The turn whose dice may still be unthrown: in flight, or finished while they waited (it may have closed its scene).
  const pending = pendN < 0 ? null : turnNumbered(s.story, pendN) ?? (flight?.n === pendN ? flight : null);
  const diceCount = pendN < 0 ? 0 : pending ? diceCards(pending.beats) : s.live && !s.live.aside ? diceCards(s.live.beats ?? []) : 0;
  const [thrown, setThrown] = useState<Table>(() => freshTable(-1, true));
  const table = thrown.n === pendN ? thrown : freshTable(pendN, a.settings.throwDice);
  const holding = diceCount > 0 && table.landed < diceCount;
  const rollable = holding && !!pending;
  const throwOne = () => { if (rollable && table.go === 'wait') setThrown({ ...table, go: 'one' }); };
  const throwAll = () => { if (rollable && table.go === 'wait') setThrown({ ...table, go: 'all' }); };
  const onLanded = (at: number) => setThrown((was) => afterLanding(was.n === pendN ? was : table, at));
  const rolling: Rolling | null = rollable && pending
    ? { dice: nextDice(pending.beats, table.landed), left: diceCount - table.landed, flying: table.go !== 'wait', one: throwOne, all: throwAll }
    : null;

  const story = holding && before ? before : s.story;
  const scene = currentScene(story);
  const combat = scene.combat && !scene.combat.over ? scene.combat : null;
  const [panel, setPanel] = useState(route.query.get('panel') === '1');
  const [expanded, setExpanded] = useState<string | null>(null);
  /** A sheet of the phone layout that is open: the menu, or what the meters are. */
  const [sheet, setSheet] = useState<'menu' | 'vitals' | null>(null);
  /** A passage picked in the log (to keep as true, or to correct), and the sheet open for it. */
  const [picked, setPicked] = useState<Picked | null>(null);
  const [fact, setFact] = useState<'keep' | 'wrong' | null>(null);
  const [to, setTo] = useState<string | null>(route.query.get('to'));
  const log = useRef<HTMLDivElement>(null);
  /** Where the view is being held, until the reader scrolls by hand. */
  const hold = useRef<Hold | null>(null);

  const present = castOf(story, scene.placeId).map((id) => story.world.people[id]).filter((p): p is Person => !!p);
  // "To" is a person who is here, nobody in particular, or the narrator (a question outside the story).
  const toValid = to === NARRATOR ? NARRATOR : to && present.some((p) => p.id === to && p.count === 1) ? to : null;
  const party = present.filter((p) => p.inParty);
  const others = present.filter((p) => !p.inParty);
  const waiting = present.some((p) => p.pendingMoment);

  // The stylesheet lays the screen out from two attributes on <body>. They are set before the screen is
  // measured for scrolling (the effects below), so the box at the bottom already has its new height then.
  useLayoutEffect(() => {
    document.body.dataset.mode = rollable || s.unread > 0 ? 'continue' : 'input';
    document.body.dataset.people = panel ? 'open' : '';
    return () => { delete document.body.dataset.mode; delete document.body.dataset.people; };
  }, [s.unread, panel, rollable]);

  // Keep the place to read from in view. The view moves only as far as it takes to show what has just
  // appeared, and never further than bringing the start of it to the top: the player's action when a
  // turn begins, the line that marks a new passage after Continue. So a short passage shows up at the
  // bottom with the text before it still in sight, and one longer than the screen starts at the top
  // and runs on below, to be scrolled at the reader's own pace. No empty space is ever made to do this.
  // Something that needs an answer (an error, a choice, a question from the game) is always brought into view.
  const liveOn = !!s.live;
  const urgent = !!s.blocker || !!s.notice || !!s.asking || (combat?.awaiting === 'down' && !s.busy && s.unread === 0) || !!story.over;
  const seen = useRef({ shown: s.shown, first: true, live: false, urgent: false, scenes: story.scenes.length });
  // Whether the first passage of the turn in flight has been on screen: the "more below" cue then takes
  // the place of the waiting dots that were already there, instead of making an entrance of its own.
  const shownLive = useRef(false);
  if (s.live?.first) shownLive.current = true;
  else if (s.phase === 'thinking') shownLive.current = false;
  // The turn in flight is drawn in the list of turns, under the number it will keep, by the same code
  // that draws a finished turn. So when the reply is complete nothing is drawn again: the action, the
  // dice and the first passage stay the very same elements, and a fade under way is not cut short.
  // While dice wait, the turn they belong to is drawn after the scene as it stood before it.
  const arriving = holding ? null : flight;
  const turns = holding ? (pending ? [...scene.turns, pending] : scene.turns) : flight ? [...scene.turns, flight] : scene.turns;
  useLayoutEffect(() => {
    const el = log.current;
    if (!el) return;
    const was = seen.current;
    const continued = s.shown !== Infinity && s.shown > was.shown;
    seen.current = { shown: s.shown, first: false, live: liveOn, urgent, scenes: story.scenes.length };
    const began = was.first || (liveOn && !was.live) || continued || (urgent && !was.urgent) || story.scenes.length !== was.scenes;
    if (!began) return;
    const anchor = last(el, '[data-anchor]');
    const place: Place = urgent || !anchor ? 'end' : anchor.hasAttribute('data-mark') ? 'mark' : 'start';
    hold.current = { place, top: -1, glidingUntil: 0 };
    bring(el, hold.current, !was.first); // on arriving at the screen the view is simply there; after that it glides
  }, [liveOn, s.shown, urgent, story.scenes.length]);

  // While the reader has not scrolled by hand, the view follows what arrives: the dice, each new line
  // of the passage being written, until the start of the turn has reached the top. It is checked each
  // time the screen is drawn again (every piece of text that arrives draws it), and also when the log
  // changes size for any other reason: the box at the bottom changing height, the window being resized.
  // As soon as the reader scrolls (wheel, finger, keys, the scrollbar) the view is theirs until the
  // next thing begins.
  useLayoutEffect(() => {
    const el = log.current;
    if (el && hold.current) bring(el, hold.current, true);
  });
  // Dice that wait are something that needs an answer: each card is brought into view as its turn
  // comes, even if the reader had scrolled away, and the view stays with the dice until they have landed.
  const diceStep = diceCount > 0 ? `${pendN}:${table.landed}:${table.go}` : '';
  useLayoutEffect(() => {
    const el = log.current;
    if (!el || !diceStep) return;
    if (!hold.current) hold.current = { place: 'dice', top: -1, glidingUntil: 0 };
    else if (hold.current.place === 'start') hold.current.place = 'dice';
    bring(el, hold.current, true);
  }, [diceStep]);
  useEffect(() => {
    const el = log.current;
    const col = el?.querySelector<HTMLElement>('.col');
    if (!el || !col) return;
    const follow = () => { if (hold.current) bring(el, hold.current, true); };
    const release = () => {
      const h = hold.current;
      hold.current = null;
      // A glide that is still under way would go on moving the page under the reader's hand: stop it where it is.
      if (h && performance.now() < h.glidingUntil) el.scrollTo({ top: el.scrollTop, behavior: 'auto' });
    };
    const onKey = (e: KeyboardEvent) => { if (SCROLL_KEYS.has(e.key)) release(); };
    const onDown = (e: PointerEvent) => { if (e.target === el) release(); }; // a press on the log itself is a press on its scrollbar
    const onScroll = () => {
      // Anything else that moved the page (a screen reader, a browser's own shortcut): once no glide is under way, a position that is not ours is the reader's.
      const h = hold.current;
      if (h && performance.now() >= h.glidingUntil && Math.abs(el.scrollTop - h.top) > 2) release();
    };
    const watch = new ResizeObserver(follow);
    watch.observe(el);
    watch.observe(col);
    el.addEventListener('wheel', release, { passive: true });
    el.addEventListener('touchmove', release, { passive: true });
    el.addEventListener('keydown', onKey);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      watch.disconnect();
      el.removeEventListener('wheel', release);
      el.removeEventListener('touchmove', release);
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('scroll', onScroll);
    };
  }, []);

  // Space continues reading, as long as the player is not typing. Escape closes the panel, or steps back into the story.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.key === 'Escape') { if (panel) setPanel(false); else if (to === NARRATOR && !document.querySelector('.modal.is-open')) setTo(null); }
      if (e.key !== ' ' || target?.closest?.('button,input,textarea,a')) return;
      // Space throws the dice that wait; only when none do does it continue reading.
      if (rollRef.current) { e.preventDefault(); rollRef.current(); }
      else if (s.unread > 0 && !holdingRef.current) { e.preventDefault(); s.continueReading(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s, panel, to]);

  // The key handler above is set up once; it reads what it needs about the dice from here.
  const rollRef = useRef<(() => void) | null>(null);
  const holdingRef = useRef(false);
  rollRef.current = rolling && !rolling.flying ? throwOne : null;
  holdingRef.current = holding;

  const talkTo = (p: Person) => {
    if (p.count === 1) setTo(p.id);
    setPanel(false);
    window.setTimeout(() => (document.querySelector('.field input') as HTMLInputElement | null)?.focus(), 0);
  };

  // The log shows the current scene, and the end of the one before it so a new scene never opens on an empty page.
  const previous = story.scenes[story.scenes.length - 2];
  const tail = scene.turns.length === 0 && previous ? previous.turns[previous.turns.length - 1] : undefined;
  const you = story.protagonist.name;
  // Questions to the narrator are shown where they were asked: after the turn that came before them.
  const asidesAfter = (n: number) => (scene.asides ?? []).filter((x) => x.after === n).map((x) => <AsideView key={`aside-${x.at}`} aside={x} you={you} fresh={x.at > opened.current.at} />);
  // Passages of finished turns can be picked, to keep as true or to correct, while nothing is under way.
  const still = !s.busy && !holding && !s.blocker;
  const pickIn = (n: number): Pickable | undefined => (still ? {
    at: picked?.n === n ? picked.i : null,
    on: (i, text, whom) => setPicked(picked?.n === n && picked.i === i ? null : { n, i, text, who: whom }),
    bar: <PassageBar onKeep={() => setFact('keep')} onWrong={() => setFact('wrong')} />,
  } : undefined);
  // Under the newest turn, once it is read: tell it again, or go back to another telling.
  const takes = still && s.unread === 0 && !story.over && !!s.lastTurn;

  return (
    <div className="app in-story app-play">
      <header className="top">
        <TopBar
          kind="story" title={story.title} cost as={story} onMenu={() => setSheet('menu')} menuDot={waiting && !!combat}
          end={combat ? undefined : <Faces present={present} dot={waiting && !panel} onOpen={() => setPanel(true)} />}
        />
        <Vitals story={story} onOpen={() => setSheet('vitals')} />
        {/* The people here are faces in the top bar. A fight keeps its row: the order of turns and who is hurt are read every round. */}
        {combat && <FightStrip combat={combat} story={story} onAll={() => setPanel(true)} />}
      </header>

      <Nav kind="story" page="story" dot={waiting && !panel ? 'people' : undefined} />

      <button className="scrim" type="button" onClick={() => setPanel(false)} tabIndex={-1} aria-hidden="true" />
      <aside className="people" aria-label={combat ? t('The fight') : t('People')}>
        <header className="people-h">
          <h2>{combat ? t('The fight') : t('People')}</h2>
          <span className="people-n">{combat ? `${t('Round {n}', { n: combat.round })}${combat.awaiting === 'action' ? ` · ${t('your turn')}` : ''}` : t('{n} here', { n: present.length })}</span>
          <button className="ib close" onClick={() => setPanel(false)} aria-label={t('Close the panel')}><Icon name="x" size={22} /></button>
        </header>
        <div className="people-b">
          {combat ? <FightPanel combat={combat} story={story} /> : (
            <>
              {party.length > 0 && (
                <Group title={t('Your party')} count={party.length}>
                  {party.map((p) => <PersonCard key={p.id} story={story} p={p} open={expanded === p.id} onToggle={() => setExpanded(expanded === p.id ? null : p.id)} onTalk={() => talkTo(p)} />)}
                </Group>
              )}
              {others.length > 0 && (
                <Group title={t('Also in the scene')} count={others.length}>
                  {others.map((p) => <PersonCard key={p.id} story={story} p={p} open={false} onToggle={() => {}} onTalk={() => talkTo(p)} />)}
                </Group>
              )}
              {present.length === 0 && <p className="t-2" style={{ padding: 'var(--sp-3) var(--sp-1)' }}>{t('Nobody else is here.')}</p>}
              <a className="btn btn-quiet" href={href('people')}>{t('Everyone you know')}<Icon name="right" size={16} /></a>
            </>
          )}
        </div>
      </aside>

      <main className="story">
        <div className="log" data-log ref={log} role="log" aria-label={t('Story')}>
          <div className="col">
            {tail && previous && (
              <>
                <h2 className="scene">{sceneTitle(story, previous)}</h2>
                <TurnView turn={tail} story={story} shown={Infinity} pick={pickIn(tail.n)} />
              </>
            )}
            <h2 className="scene">{sceneTitle(story, scene)}</h2>
            {s.canBegin && !s.live && !s.blocker && (
              <div className="card begin">
                <div><b>{t('Chapter {n}', { n: story.chapter.n })} · {story.chapter.title}</b><p className="t-2">{t('The first scene has not been told yet.')}</p></div>
                <button type="button" className="btn btn-primary btn-fit" onClick={() => void s.begin()}><Icon name="play" size={14} fill />{t('Begin the story')}</button>
              </div>
            )}
            {scene.turns.length === 0 && !s.live && !s.asking && !s.canBegin && !holding && (
              <p className="t-2">{story.totals.turns === 0 ? t('The story picks up here. Say what you do, or look around first.') : t('A new scene. Say what you do.')} {t('To ask the narrator something without saying it in the story, choose “The narrator” under “To”.')}</p>
            )}
            {asidesAfter(0)}
            {turns.map((turn, i) => {
              const inFlight = turn === flight;
              const isNew = turn.n > opened.current.turns;
              const reading = !inFlight && turn.n === s.lastTurn?.n; // the turn Continue applies to
              return [
                <TurnView
                  key={turn.n} turn={turn} story={story} shown={reading ? s.shown : Infinity} latest={reading}
                  arriving={inFlight} freshFirst={isNew}
                  table={turn.n === pendN && diceCount > 0 ? { table, animate: a.settings.diceAnimation, onThrow: throwOne, onLanded } : undefined}
                  pick={inFlight || turn === pending ? undefined : pickIn(turn.n)}
                />,
                ...(reading && takes ? [<TakeBar key={`take-${turn.n}`} session={s} />] : []),
                ...(inFlight || turn === pending ? [] : asidesAfter(i + 1)),
              ];
            })}
            {s.unread > 0 && !s.busy && !holding && (
              <button type="button" className={`more-cue${shownLive.current ? ' is-now' : ''}`} onClick={() => s.continueReading()} aria-label={t('Continue reading')}>
                <Icon name="down" size={18} strong />
              </button>
            )}
            {arriving && <Waiting phase={s.phase} first={!!s.live?.first} place={s.filling} />}
            {/* The opening of a story is not an action of the player's: when it is held, the notice below says so by itself. */}
            {s.live && !flight && !(s.live.beats?.length === 0 && !s.live.aside) && <LiveTurn story={story} live={s.live} held={held} />}
            {s.asking && !s.live && <AskCard asking={s.asking} you={you} onDrop={() => s.dropQuestion()} />}
            {s.budgetWarning && !s.blocker && !a.usingDemo && (
              <div className="notes"><span className="note note-warn"><Icon name="coins" size={14} /><span><T text="<b>80%</b> of today’s limit used · {spent} of {cap}" vars={{ spent: money(a.spentToday(), 2), cap: money(a.settings.dailyCap, 2) }} /></span></span></div>
            )}
            {s.notice && <div className="alert notice" role="status"><Icon name="info" /><div><b>{t('The engine says')}</b><p>{s.notice}</p></div></div>}
            {s.blocker && <BlockerCard blocker={s.blocker} session={s} />}
            {combat?.awaiting === 'down' && !s.busy && s.unread === 0 && <Fate session={s} />}
            {story.over && s.unread === 0 && <EndCard session={s} />}
          </div>
        </div>
        <Dock session={s} present={present} to={toValid} setTo={setTo} roll={rolling} />
      </main>

      <ContextPane story={story} />

      {sheet === 'menu' && (
        <StoryMenu page="story" onClose={() => setSheet(null)} dot={waiting ? 'people' : undefined} />
      )}
      {sheet === 'vitals' && <VitalsSheet story={story} onClose={() => setSheet(null)} />}
      {fact && picked && <FactSheet session={s} picked={picked} mode={fact} onClose={() => { setFact(null); setPicked(null); }} />}
    </div>
  );
}
