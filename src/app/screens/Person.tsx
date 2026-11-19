// One person: where the bond stands, what to do about it, and the few moments that mattered.
// A profile never lists every shared memory: the rest is rolled up into one row that opens the second
// view, the whole shared history, where the player also chooses up to three moments to keep in view.
import { Fragment, useState } from 'react';
import { STAGES, stageIndex, stageName, toNextStage } from '../../engine';
import { factsAbout, knowledgeOf } from '../../game/cards';
import { FactList } from '../components/Tools';
import { DescribeFields, describedOf } from '../components/Companions';
import type { Described } from '../../game/creation';
import { PARTY, canJoin } from '../../game/whereabouts';
import { FACTS_MAX, type Session } from '../../game/session';
import type { GameEvent, Person, Story } from '../../game/types';
import { m, t, tn } from '../../i18n';
import { useApp } from '../app';
import { href } from '../router';
import { StoryPage } from '../Shell';
import { T } from '../T';
import { Avatar, BondBar, Icon, Modal, who } from '../ui';
import './person.css';

// ---------- Shared with the People screen ----------

type BondEvent = GameEvent & { bond: NonNullable<GameEvent['bond']> };

/** The kind of a bond, as the data names it; drawn with t(KIND[p.kind]). */
export const KIND: Record<Person['kind'], string> = {
  friendship: m('friendship'), romance: m('romance'), mentorship: m('mentorship'), rivalry: m('rivalry'), kinship: m('kinship'),
};

export const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
/** "+8" or "−4", with a real minus sign. */
const signed = (n: number): string => `${n < 0 ? '−' : '+'}${Math.abs(n)}`;
const dayLabel = (day: number, today: number): string => (day === today ? t('today') : t('Day {n}', { n: day }));
/** The colour class of a person; someone with no colour of their own gets a neutral one. */
export const tone = (p: Pick<Person, 'hue'>): string => who(p) || 'who-none';
export const isHostile = (p: Pick<Person, 'attitude'>): boolean => /hostile/i.test(p.attitude);
/** A named individual: has a profile and a bond. Extras and crowds do not. */
export const isNamed = (p: Pick<Person, 'count' | 'tier'>): boolean => p.count === 1 && p.tier !== 'extra';

const when = (e: GameEvent): number => e.clock.day * 1440 + e.clock.minute;

/** A place as the protagonist would name it: "Harbour district, Port Varn". Null for a place they do not know. */
function placeLabel(story: Story, placeId: string): string | null {
  const place = story.world.places[placeId];
  if (!place || place.known === 'hidden') return null;
  const parent = place.parent ? story.world.places[place.parent] : undefined;
  return parent && parent.kind !== 'world' && parent.known !== 'hidden' ? `${place.name}, ${parent.name}` : place.name;
}

/** Where the protagonist last met someone, from the record of events. */
function lastSeen(story: Story, id: string): { place: string; day: number } | null {
  let best: GameEvent | null = null;
  for (const e of story.events) {
    if (!e.actors.includes(id) && !e.witnesses.includes(id)) continue;
    if (!best || when(e) >= when(best)) best = e;
  }
  const place = best ? story.world.places[best.placeId] : undefined;
  return best && place && place.known !== 'hidden' ? { place: place.name, day: best.clock.day } : null;
}

export interface Whereabouts {
  /** In the party or in the current scene: the player can talk to them now. */
  present: boolean;
  /** Somewhere the player knows and can go. */
  reachable: boolean;
  /** "Harbour district, Port Varn", or "last seen: Brinehold, Day 8". */
  text: string;
}

export function whereabouts(story: Story, p: Person, here: string): Whereabouts {
  if (p.inParty) return { present: true, reachable: true, text: t('with you') };
  if (p.placeId === here) return { present: true, reachable: true, text: t('here') };
  if (p.away) {
    const vars = { day: dayLabel(p.away.day, story.clock.day).toLowerCase(), why: p.away.why };
    return { present: false, reachable: false, text: p.away.how === 'dead' ? t('died {day}: {why}', vars) : t('gone {day}: {why}', vars) };
  }
  if (p.placeId === 'nowhere') return { present: false, reachable: false, text: t('no longer around') };
  const label = placeLabel(story, p.placeId);
  // Where someone hostile is right now is for the story to reveal, not this screen: only where they were last met.
  if (label && !isHostile(p)) return { present: false, reachable: true, text: label };
  const seen = lastSeen(story, p.id);
  return { present: false, reachable: false, text: seen ? t('last seen: {place}, {day}', { place: seen.place, day: dayLabel(seen.day, story.clock.day) }) : t('whereabouts unknown') };
}

/** Every event that changed the bond with one person, oldest first. */
function bondEventsOf(story: Story, id: string): BondEvent[] {
  return story.events
    .map((e, i) => ({ e, i }))
    .filter((x): x is { e: BondEvent; i: number } => x.e.bond?.who === id)
    .sort((a, b) => when(a.e) - when(b.e) || a.i - b.i)
    .map((x) => x.e);
}

/** The three largest changes, up or down; among equals, the newest. Takes events oldest first. */
function mattered(events: BondEvent[]): BondEvent[] {
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => Math.abs(b.e.bond.delta) - Math.abs(a.e.bond.delta) || b.i - a.i)
    .slice(0, 3)
    .map((x) => x.e);
}

const historyHref = (id: string): string => href(`person/${encodeURIComponent(id)}?view=history`);

// ---------- The profile ----------

function Profile({ session, p }: { session: Session; p: Person }) {
  const story = session.story;
  /** The player's words on how they look and who they are, while being written. */
  const [describing, setDescribing] = useState<Described | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const today = story.clock.day;
  const where = whereabouts(story, p, session.scene.placeId);
  const named = isNamed(p);
  const known = p.met || where.present;
  const events = bondEventsOf(story, p.id);
  const top = mattered(events);
  const rest = events.length - top.length;
  const third = top[top.length - 1];
  const restSmaller = !!third && events.every((e) => top.includes(e) || Math.abs(e.bond.delta) < Math.abs(third.bond.delta));
  const kept = events.filter((e) => e.kept);
  // The most important things first; the same sentence recorded twice (an hour together, twice in a day) is shown once.
  const knows = knowledgeOf(story, p.id)
    .filter((k, i, all) => k.event.importance >= 2 && all.findIndex((x) => x.event.text === k.event.text) === i)
    .slice(0, 4);
  const stage = stageIndex(p.bond);
  const toNext = toNextStage(p.bond);
  const room = 3 - kept.length;
  // What they asked of the protagonist, once they asked.
  const quest = p.quest ? story.threads.find((th) => th.id === p.quest) : undefined;
  // Whether they would come along if asked: said plainly, so that nobody has to guess what the bond is for.
  const join = named && where.present && !p.inParty ? canJoin(story, p) : null;
  const name = p.short;
  const joinStage = t(STAGES[PARTY.joinStage]);
  const company = p.inParty ? t('{name} travels with you. To part ways, tell them to stay behind, in the story.', { name })
    : !join ? null
      : join.ok ? t('{name} would travel with you. Ask them, in the story.', { name })
        : join.reason === 'stage' ? (p.bond > 0
          ? t('{name} would travel with someone they know as {stage}: {n} more.', { name, stage: joinStage, n: PARTY.joinStage * 20 - 20 - p.bond })
          : t('{name} would travel with someone they know as {stage}.', { name, stage: joinStage }))
          : join.reason === 'full' ? t('Your party is full. Someone would have to stay behind before {name} could come along.', { name })
            : null;

  return (
    <StoryPage page="people" title={t('Profile')} back="people">
      <div className={`pf ${tone(p)}`}>
        <p className="pf-crumb only-desktop"><a className="link" href={href('people')}><Icon name="left" size={14} strong />{t('People')}</a></p>

        <header className="pf-head">
          <Avatar person={p} size="xl" />
          <div className="grow">
            <h1>{p.name}{p.count > 1 && <span className="t-2 num"> × {p.count}</span>}</h1>
            <p>{p.role}</p>
            <div className="inline">
              {named && (p.bond > 0 || p.kind !== 'friendship') && <span className="tag">{cap(t(KIND[p.kind]))}</span>}
              {p.inParty ? <span className="tag">{t('In your party')}</span> : where.present && <span className="tag">{t('In this scene')}</span>}
            </div>
          </div>
          {named && (
            <button className="btn btn-fit pf-pin" aria-pressed={p.pinned} onClick={() => session.togglePin(p.id)} title={t('Pinned people come first in their group on the People screen')}>
              <Icon name="star" size={16} fill={p.pinned} />{p.pinned ? t('Pinned') : t('Pin')}
            </button>
          )}
        </header>

        <div className="split stack pf-cols">
          {/* Main column: where it stands, what to do, why */}
          <div className="stack">
            {named && known ? (
              <section className="card pf-bond" aria-label={t('Your bond with {name}', { name: p.name })}>
                <div className="pf-bond-top">
                  <p className="pf-bond-n"><b className="num">{p.bond}</b>{' '}{t('of 100')}</p>
                  <p className="pf-bond-s">{t(stageName(p.bond))}</p>
                  <p className="pf-bond-next">
                    {toNext === 0 ? t('The highest stage') : t('{n} to {stage}', { n: toNext, stage: t(STAGES[stage + 1] ?? '') })}
                    {toNext > 0 && p.grievance ? ` · ${t('held back by a grievance')}` : ''}
                  </p>
                </div>
                <BondBar bond={p.bond} size="xl" />
                <ol className="pf-stages" aria-hidden="true">
                  {STAGES.slice(1).map((s, i) => <li key={s} className={i + 1 < stage ? 'was' : i + 1 === stage ? 'on' : undefined}>{t(s)}</li>)}
                </ol>
                <div className="pf-att">
                  <span className="pf-att-k">{t('Attitude')}</span>
                  <span className={`mood${isHostile(p) ? ' pf-grief' : ''}`}>{p.attitude}</span>
                  {p.attitudeWhy && <span>{p.attitudeWhy}</span>}
                </div>
              </section>
            ) : known ? (
              <section className="card pf-att is-alone" aria-label={t('Attitude')}>
                <span className="pf-att-k">{t('Attitude')}</span>
                <span className={`mood${isHostile(p) ? ' pf-grief' : ''}`}>{p.attitude}</span>
                {p.attitudeWhy && <span>{p.attitudeWhy}</span>}
              </section>
            ) : (
              <div className="alert">
                <Icon name="info" />
                <div><b>{t('Not met yet')}</b><p>{t('You have heard of {name}, and that is all so far. A bond starts when you meet.', { name })}</p></div>
              </div>
            )}

            <section className="pf-next" aria-label={t('What to do next')}>
              {p.pendingMoment && (
                <p className="moment">
                  <Icon name="spark" size={16} fill />
                  <span><b>{t('New stage: {stage}', { stage: t(p.pendingMoment) })}</b>{where.present
                    ? t('{name} wants a moment with you. Give them some quiet time in the story and it will come.', { name })
                    : t('{name} wants a moment with you. It comes when you are together again and give them some quiet time.', { name })}</span>
                </p>
              )}
              {p.grievance && (
                <p className="moment pf-grief">
                  <Icon name="warn" size={16} />
                  <span><b>{t('Open grievance')}</b>{p.grievance}{/[.!?]$/.test(p.grievance) ? '' : '.'} {t('Until you make amends, gains are halved and the next stage is out of reach. Something that matters to {name}, done for them, settles it.', { name })}</span>
                </p>
              )}
              {quest && (
                <p className="moment">
                  <Icon name="target" size={16} />
                  <span><b>{quest.status === 'done' ? t('What they asked of you, done') : t('They asked for your help')}</b>{quest.title.replace(/^[^:]{1,20}:\s*/, '')} {quest.status === 'done' ? '' : <a className="link" href={href('journal')}>{t('In the journal')}</a>}</span>
                </p>
              )}
              {where.present ? (
                <>
                  <div className="acts">
                    <a className="btn btn-primary" href={href(`play?to=${encodeURIComponent(p.id)}`)}><Icon name="chat" size={18} />{t('Talk')}</a>
                  </div>
                  {p.count === 1 && <p className="help">{t('A bond grows from what you do in the story. To have time alone with {name}, say so there, in your own words.', { name })}</p>}
                  {company && <p className="help">{company}</p>}
                </>
              ) : (
                <div className="alert pf-away">
                  <Icon name="pin" />
                  <div>
                    <b>{t('{name} is not here', { name })}</b>
                    <p>{cap(where.text)}.{where.reachable && <> {known ? t('Go there to talk or to spend time together.') : t('Go there to meet {name}.', { name })}</>}</p>
                  </div>
                  {where.reachable && <a className="btn btn-fit" href={href('map')}><Icon name="map" size={16} />{t('Map')}</a>}
                </div>
              )}
            </section>

            {named && known && (
              <section className="card">
                <header className="card-h"><h2 className="card-t">{t('Moments that mattered')}</h2></header>
                {events.length === 0 ? (
                  <p className="t-2">{t('Nothing has moved this bond yet.')}</p>
                ) : (
                  <>
                    <ul className="mem">
                      {top.map((e) => (
                        <li key={e.id}><span>{e.text}</span><span className="mem-x"><b className={e.bond.delta < 0 ? 'loss' : undefined}>{signed(e.bond.delta)}</b> · {dayLabel(e.clock.day, today)}</span></li>
                      ))}
                    </ul>
                    <a className="mem-more" href={historyHref(p.id)}>
                      <span>{rest > 0 ? t('and {moments}', { moments: restSmaller ? tn(rest, '{n} smaller moment', '{n} smaller moments') : tn(rest, '{n} other moment', '{n} other moments') }) : t('The full history')}</span>
                      <span className="mem-all">{rest > 0 ? t('See all') : t('Open')}<Icon name="right" size={14} strong /></span>
                    </a>
                    <div className="pf-kept">
                      <h3 className="mem-k"><span className="pinned"><Icon name="star" size={12} fill />{t('Kept by you')}</span><span>{t('{n} of 3', { n: kept.length })}</span></h3>
                      {kept.length > 0 && (
                        <ul className="mem">
                          {kept.map((e) => (
                            <li key={e.id}><span>{e.text}</span><span className="mem-x"><b className={e.bond.delta < 0 ? 'loss' : undefined}>{signed(e.bond.delta)}</b> · {dayLabel(e.clock.day, today)}</span></li>
                          ))}
                        </ul>
                      )}
                      <a className="mem-more" href={historyHref(p.id)}>
                        <span>{room <= 0 ? t('Three kept, the most a profile shows') : kept.length === 0 ? t('Keep up to three moments in view here') : room === 1 ? t('Room for one more') : t('Room for two more')}</span>
                        <span className="mem-all">{room <= 0 ? t('Change') : t('Choose')}<Icon name="right" size={14} strong /></span>
                      </a>
                    </div>
                  </>
                )}
              </section>
            )}
          </div>

          {/* Side column: what is known */}
          <div className="stack">
            {named && known && (p.look || p.appearance || p.card || p.inParty) && (
              <section className="card">
                <header className="card-h">
                  <h2 className="card-t">{t('Who {name} is', { name })}</h2>
                  {p.met && <button type="button" className="ib" disabled={session.busy} onClick={() => { setProblem(null); setDescribing(describedOf(p)); }} aria-label={t('Describe {name} in your own words', { name })} title={t('Describe {name} in your own words', { name })}><Icon name="edit" size={18} /></button>}
                </header>
                {(p.appearance || p.look) && <p className="looks"><span className="looks-k">{t('Appearance')}</span>{p.met && p.appearance ? p.appearance : p.look}</p>}
                {p.card && <p className="looks"><span className="looks-k">{t('Personality')}</span>{p.card}</p>}
                <p className="help">{p.met ? t('As the narrator plays them. The pencil puts them in your own words, or describes their looks from a picture.') : t('As the narrator plays them. What they look like now changes when the story changes it for good.')}</p>
              </section>
            )}
            {describing && (
              <Modal title={t('Who {name} is', { name })} onClose={() => setDescribing(null)} foot={
                <button type="button" className="btn btn-primary" onClick={() => { const why = session.describePerson(p.id, describing); if (why) setProblem(why); else setDescribing(null); }}><Icon name="check" size={18} />{t('Keep these words')}</button>
              }>
                <p className="help">{t('The narrator plays {name} from these words from your next action on. Nothing is spent unless you put a picture into words.', { name })}</p>
                <DescribeFields p={p} value={describing} onChange={setDescribing} language={story.settings.language === 'pt' ? 'pt' : 'en'} ledger={story.id} />
                {problem && <p className="help t-err" role="alert">{problem}</p>}
              </Modal>
            )}
            {named && known && (
              <section className="card">
                <header className="card-h"><h2 className="card-t">{t('Kept as true')}</h2><span className="t-xs t-2">{t('{n} of {max}', { n: factsAbout(story, p.id, 99).length, max: FACTS_MAX.about })}</span></header>
                <FactList session={session} story={story} about={p.id} empty={t('Nothing yet. Press a line of the story about {name} to keep it as true, or to say it is wrong.', { name })} />
              </section>
            )}
            {named && p.values.length > 0 && (
              <section className="card">
                <header className="card-h"><h2 className="card-t">{t('What {name} values', { name })}</h2><span className="t-xs t-2">{t('{known} of {total} known', { known: p.valuesKnown.length, total: p.values.length })}</span></header>
                <div className="inline">
                  {p.valuesKnown.map((v) => <span key={v} className="tag"><b>{cap(v)}</b></span>)}
                  {p.values.length > p.valuesKnown.length && <span className="tag pf-unk">{t('Not discovered yet')}</span>}
                </div>
                <p className="help">{t('What you do for one of these counts for half as much again. Going against one costs bond, even if you meant well.')}</p>
              </section>
            )}

            {knows.length > 0 && (
              <section className="card">
                <header className="card-h"><h2 className="card-t">{t('What {name} knows about you', { name })}</h2></header>
                <ul className="mem">
                  {knows.map((k) => (
                    <li key={k.event.id}><span>{k.event.text}</span><span className="mem-x">{k.how === 'told' ? t('was told · ') : k.how === 'heard' ? t('has heard · ') : ''}{dayLabel(k.event.clock.day, today)}</span></li>
                  ))}
                </ul>
                <p className="help">{t('As far as you can tell.')}</p>
              </section>
            )}
          </div>
        </div>
      </div>
    </StoryPage>
  );
}

// ---------- The full shared history ----------

function History({ session, p }: { session: Session; p: Person }) {
  const story = session.story;
  const today = story.clock.day;
  const events = bondEventsOf(story, p.id);
  const top = mattered(events);
  const total = events.reduce((n, e) => n + e.bond.delta, 0);
  const topSum = top.reduce((n, e) => n + e.bond.delta, 0);
  const rest = events.length - top.length;
  // The events are the record. Only when they add up to the bond is the sum stated.
  const adds = events.length > 0 && total === p.bond;
  const kept = events.filter((e) => e.kept).length;
  const first = events[0];

  // Newest day first; within a day, newest first. Each day carries where the bond stood before and after.
  const days: { day: number; from: number; to: number; events: BondEvent[] }[] = [];
  for (const e of events) {
    let d = days[days.length - 1];
    if (!d || d.day !== e.clock.day) { d = { day: e.clock.day, from: e.bond.after - e.bond.delta, to: e.bond.after, events: [] }; days.push(d); }
    d.to = e.bond.after;
    d.events.unshift(e);
  }
  days.reverse();

  const step = (e: BondEvent): number => stageIndex(e.bond.after) - stageIndex(e.bond.after - e.bond.delta);
  const lastRise = [...events].reverse().find((e) => step(e) > 0);

  return (
    <StoryPage page="people" title={t('History with {name}', { name: p.short })} back={`person/${encodeURIComponent(p.id)}`}>
      <div className={`pf ${tone(p)}`}>
        <p className="pf-crumb"><a className="link link-tap" href={href(`person/${encodeURIComponent(p.id)}`)}><Icon name="left" size={14} strong />{t('{name}’s profile', { name: p.short })}</a></p>

        <header className="page-h only-desktop">
          <div>
            <h1>{t('Your history with {name}', { name: p.name })}</h1>
            <p>{t('Everything that moved the bond, newest first')}</p>
          </div>
        </header>

        <div className="split-l stack">
          {/* The running total */}
          <aside className="stack pf-side">
            <section className="card pf-sum" aria-label={t('How the bond adds up')}>
              <div className="pf-sum-who">
                <Avatar person={p} size="l" />
                <div className="grow">
                  <div className="bond-l"><b>{t(stageName(p.bond))}</b><span><b>{p.bond}</b>/100</span></div>
                  <div className="t-sm t-2">{first ? t('{moments} since {day}', { moments: tn(events.length, '{n} moment', '{n} moments'), day: dayLabel(first.clock.day, today) }) : t('No moments yet')}</div>
                </div>
              </div>
              <BondBar bond={p.bond} size="xl" />
              {adds && rest > 0 && (
                <div className="pf-eq" role="group" aria-label={t('{bond} is {top} from {topMoments} that mattered most and {other} from {restMoments}', { bond: p.bond, top: topSum, topMoments: tn(top.length, '{n} moment', '{n} moments'), other: total - topSum, restMoments: tn(rest, '{n} other', '{n} others') })}>
                  <div><b>{p.bond}</b>{t('bond now')}</div>
                  <span className="pf-eq-op" aria-hidden="true">=</span>
                  <div className="part"><b>{topSum}</b>{t('the three that mattered most')}</div>
                  <span className="pf-eq-op" aria-hidden="true">{total - topSum < 0 ? '−' : '+'}</span>
                  <div className="part"><b>{Math.abs(total - topSum)}</b>{tn(rest, '{n} other moment', '{n} other moments')}</div>
                </div>
              )}
              {adds && rest === 0 && (
                <div className="pf-eq is-one" role="group" aria-label={t('{bond} is the sum of {moments}', { bond: p.bond, moments: tn(events.length, '{n} moment', '{n} moments') })}>
                  <div><b>{p.bond}</b>{t('bond now')}</div>
                  <span className="pf-eq-op" aria-hidden="true">=</span>
                  <div className="part"><b>{total}</b>{events.length === 1 ? t('one moment') : t('the sum of {n} moments', { n: events.length })}</div>
                </div>
              )}
              {!adds && events.length > 0 && <p className="help">{t('These {moments} do not account for the whole bond, so no sum is shown.', { moments: tn(events.length, '{n} moment', '{n} moments') })}</p>}
            </section>
            {events.length > 0 && (
              <ul className="pf-legend">
                <li><span className="dot full" aria-hidden="true" />{t('Mattered most')}</li>
                {rest > 0 && <li><span className="dot" aria-hidden="true" />{t('Others')}</li>}
                <li><Icon name="star" size={15} fill /><span>{kept >= 3 ? <T text="Kept on the profile · <b>{kept}</b> of 3 · remove one to keep another" vars={{ kept }} /> : <T text="Kept on the profile · <b>{kept}</b> of 3" vars={{ kept }} />}</span></li>
              </ul>
            )}
          </aside>

          {/* Every moment, by day */}
          <div className="stack-l">
            {events.length === 0 ? (
              <section className="empty">
                <Icon name="heart" size={40} />
                <h2>{t('Nothing has moved this bond yet')}</h2>
                <p>{t('Every time something you do changes how {name} stands with you, it is recorded here with what it was worth.', { name: p.short })}</p>
              </section>
            ) : (
              <section className="card">
                <ol className="tl pf-hl">
                  {days.map((d) => (
                    <Fragment key={d.day}>
                      <li className="day"><span>{t('Day {n}', { n: d.day })}{d.day === today ? ` · ${t('today')}` : ''}</span><span className="num">{d.from} → {d.to}</span></li>
                      {d.events.map((e) => {
                        const moved = step(e);
                        const lost = e.bond.delta < 0;
                        const full = !e.kept && kept >= 3;
                        return (
                          <Fragment key={e.id}>
                            {moved !== 0 && (
                              <li className="mark">
                                <span className={`note ${moved > 0 ? 'note-moment' : 'note-bad'}`}>
                                  <Icon name={moved > 0 ? 'spark' : 'warn'} size={14} fill={moved > 0} />
                                  {moved > 0
                                    ? <span>{e === lastRise && p.pendingMoment === stageName(e.bond.after)
                                      ? <T text="<b>{stage}</b> reached · the moment is waiting" vars={{ stage: t(stageName(e.bond.after)) }} />
                                      : <T text="<b>{stage}</b> reached" vars={{ stage: t(stageName(e.bond.after)) }} />}</span>
                                    : <span><T text="Back to <b>{stage}</b>" vars={{ stage: t(stageName(e.bond.after)) }} /></span>}
                                </span>
                              </li>
                            )}
                            <li className={`${top.includes(e) ? 'big' : ''}${lost ? ' lost' : ''}`}>
                              <p className="ev-t">{e.text}{lost && <> <span className="tag tag-err">{t('Loss')}</span></>}</p>
                              <span className="mem-x"><b className={lost ? 'loss' : undefined}>{signed(e.bond.delta)}</b></span>
                              <button
                                className="ib pf-keep" aria-pressed={!!e.kept} disabled={full} onClick={() => session.toggleKept(e.id)}
                                aria-label={e.kept ? t('Kept on the profile. Press to stop keeping it') : full ? t('Three moments are kept already') : t('Keep this moment on the profile')}
                              >
                                <Icon name="star" size={18} />
                              </button>
                            </li>
                          </Fragment>
                        );
                      })}
                    </Fragment>
                  ))}
                </ol>
              </section>
            )}
          </div>
        </div>
      </div>
    </StoryPage>
  );
}

export function PersonProfile({ id, view }: { id: string; view: 'profile' | 'history' }) {
  const a = useApp();
  const session = a.session;
  const p = session?.story.world.people[id];
  if (!session || !p) {
    return (
      <StoryPage page="people" title={t('Profile')} back="people">
        <div className="pf">
          <section className="empty">
            <Icon name="person" size={40} />
            <h2>{t('Nobody by that name')}</h2>
            <p>{t('This person is not part of the story, or not any more.')}</p>
            <a className="btn btn-primary btn-lg btn-fit" href={href('people')}>{t('Everyone you know')}</a>
          </section>
        </div>
      </StoryPage>
    );
  }
  return view === 'history' && isNamed(p) ? <History session={session} p={p} /> : <Profile session={session} p={p} />;
}
