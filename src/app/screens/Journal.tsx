// Journal: what is still open, the story so far, and every die the app has rolled.
import { useState } from 'react';
import { slotOf, stageName, type AttackEvent, type Clock, type TestResult } from '../../engine';
import { factsAbout, parentChain } from '../../game/cards';
import { FACTS_MAX, type RewindPoint, type Session } from '../../game/session';
import { AllFacts } from '../components/Tools';
import { downloadBook } from '../files';
import type { Commitment, Person, RollRecord, Scene, Story, Thread } from '../../game/types';
import { m, t, tn } from '../../i18n';
import { useApp } from '../app';
import type { IconName } from '../icons';
import { go, href } from '../router';
import { StoryPage } from '../Shell';
import { T } from '../T';
import { Avatar, BondBar, Die, Icon, Modal, money, who } from '../ui';
import { Codex } from './Codex';
import './journal.css';

type Tab = 'threads' | 'story' | 'codex' | 'rolls';

const TABS: { id: Tab; label: string; to: string }[] = [
  { id: 'threads', label: m('Threads'), to: 'journal' },
  { id: 'story', label: m('Story so far'), to: 'journal/story' },
  { id: 'codex', label: m('Codex'), to: 'journal/codex' },
  { id: 'rolls', label: m('Rolls'), to: 'journal/rolls' },
];

const KIND: Record<Thread['kind'], { label: string; icon: IconName | null; order: number }> = {
  main: { label: m('Main thread'), icon: 'target', order: 0 },
  mystery: { label: m('Mystery'), icon: 'search', order: 1 },
  personal: { label: m('Personal'), icon: 'heart', order: 2 },
  small: { label: m('Small'), icon: null, order: 3 },
};

const DIFFICULTY: Record<TestResult['difficulty'], string> = { easy: m('Easy'), medium: m('Medium'), hard: m('Hard') };

/** Finished chapters shown before "Show earlier chapters". */
const CHAPTERS_PAGE = 3;
/** Long lists (scenes, rolls) show this many entries, then a button for more. */
const PAGE = 30;

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const when = (c: Clock) => t('Day {day}, {slot}', { day: c.day, slot: t(slotOf(c)).toLowerCase() });

/** Every die behind a record: one for a test (two when a destiny point bought a second roll), two for an attack. */
function diceOf(r: RollRecord): number[] {
  const x = r.result;
  if ('kind' in x) return x.die === null ? [] : x.rerolled !== undefined ? [x.rerolled, x.die] : [x.die];
  return [x.attackDie, x.defenceDie];
}

export function Journal({ tab }: { tab: string }) {
  const a = useApp();
  const s = a.session;
  if (!s) return null;
  const story = s.story;
  const view: Tab = tab === 'story' || tab === 'codex' || tab === 'rolls' ? tab : 'threads';

  const open = story.threads.filter((th) => th.status === 'open');
  const due = story.commitments.filter((c) => !c.done);
  const dice = story.rolls.flatMap(diceOf);
  const average = dice.length ? (dice.reduce((sum, d) => sum + d, 0) / dice.length).toFixed(1) : null;
  const context = view === 'threads'
    ? `${tn(open.length, '{n} open thread', '{n} open threads')} · ${tn(due.length, '{n} commitment', '{n} commitments')}`
    : view === 'story'
      ? t('Chapter {n} · Scene {scene} · Day {day} · {turns}', { n: story.chapter.n, scene: s.scene.n, day: story.clock.day, turns: tn(story.totals.turns, '{n} turn played', '{n} turns played') })
      : view === 'codex' ? t('What {name} has discovered so far', { name: story.protagonist.name })
      : story.rolls.length ? `${tn(story.rolls.length, '{n} roll in this story', '{n} rolls in this story')}${average ? ` · ${t('average {average}', { average })}` : ''}` : t('No rolls in this story yet');

  // What this story has cost, real charges and demo estimates kept apart.
  let charged = 0;
  let estimated = 0;
  for (const u of a.usage) if (u.storyId === story.id) { if (u.simulated) estimated += u.cost; else charged += u.cost; }

  return (
    <StoryPage page="journal" title={t('Journal')}>
      <div className="jn">
        <header className="page-h">
          <div>
            <h1 className="only-desktop">{t('Journal')}</h1>
            <p>{context}</p>
          </div>
        </header>

        <div className="tabs" role="tablist" aria-label={t('Journal sections')}>
          {TABS.map((tab) => <a key={tab.id} role="tab" href={href(tab.to)} aria-selected={view === tab.id}>{t(tab.label)}</a>)}
        </div>

        {view === 'threads' && <Threads story={story} open={open} due={due} />}
        {view === 'story' && <StorySoFar session={s} story={story} now={s.scene} charged={charged} estimated={estimated} />}
        {view === 'codex' && <Codex story={story} />}
        {view === 'rolls' && <Rolls story={story} dice={dice} average={average} />}
      </div>
    </StoryPage>
  );
}

// ---------- Threads ----------

function ThreadCard({ thread, today }: { thread: Thread; today: number }) {
  const kind = KIND[thread.kind];
  const clues = [...thread.clues].reverse();
  return (
    <article className={`card thr${thread.kind === 'main' ? ' thr-main' : ''}`}>
      <div className="thr-k">
        <span className={`tag${thread.kind === 'main' ? ' tag-accent' : ''}`}>{kind.icon && <Icon name={kind.icon} size={12} strong />}{t(kind.label)}</span>
        <span>{t('Since day {day}', { day: thread.since })}</span>
      </div>
      <h3>{thread.title}</h3>
      {clues.length > 0 && (
        <div>
          <h4 className="mem-k">{t('Clues · {n}', { n: clues.length })}</h4>
          <ul className="mem">
            {clues.map((c, i) => <li key={i}><span>{c.text}</span><span className="mem-x">{c.day === today ? t('today') : t('Day {n}', { n: c.day })}</span></li>)}
          </ul>
        </div>
      )}
      <p className={`thr-next${thread.next ? '' : ' is-open'}`}>
        <Icon name="arrow" size={16} strong />
        <span>{thread.next ? <T text="<b>Next:</b> {text}" vars={{ text: thread.next }} /> : t('No clear next step yet.')}</span>
      </p>
    </article>
  );
}

/** "Due tonight", or, once its day has passed, how long it has been owed. */
function dueLine(c: Commitment, today: number): string {
  if (c.dueDay !== null && c.dueDay < today) return t('Overdue since day {day}', { day: c.dueDay });
  return t('Due {when}', { when: c.dueLabel });
}

function Threads({ story, open, due }: { story: Story; open: Thread[]; due: Commitment[] }) {
  const today = story.clock.day;
  const threads = [...open].sort((x, y) => KIND[x.kind].order - KIND[y.kind].order || x.since - y.since);
  const done = story.threads.filter((th) => th.status === 'done').sort((x, y) => (y.doneDay ?? 0) - (x.doneDay ?? 0));
  const waiting: Person[] = Object.values(story.world.people).filter((p) => p.pendingMoment);
  const pressing = (c: Commitment) => c.dueDay !== null && c.dueDay <= today;
  const promises = [...due].sort((x, y) => Number(pressing(y)) - Number(pressing(x)));

  return (
    <div className="split jr">
      <div className="jc">
        <section className="sec">
          <div className="sec-h"><h2>{t('Open threads')}</h2><span className="t-xs t-2">{threads.length}</span></div>
          {threads.length > 0
            ? <div className="stack">{threads.map((th) => <ThreadCard key={th.id} thread={th} today={today} />)}</div>
            : <p className="card t-2">{t('Nothing is open right now. New threads appear here as the story raises them.')}</p>}
        </section>
      </div>

      <div className="jc">
        {waiting.length > 0 && (
          <section className="sec">
            <div className="sec-h"><h2>{t('Personal')}</h2><span className="t-xs t-2">{waiting.length}</span></div>
            <div className="stack-s">
              {waiting.map((p) => (
                <a key={p.id} className={`pt ${who(p)}`} href={href(`person/${p.id}`)}>
                  <Avatar person={p} size="l" pinned={p.pinned} />
                  <span className="grow">
                    <span className="pt-t">{t('{name} wants a moment with you', { name: p.name })}</span>
                    <span className="pt-s">{t('New stage: {stage}. It plays when you spend time together.', { stage: p.pendingMoment ?? '' })}</span>
                    <span className="pt-b"><BondBar bond={p.bond} size="l" /><span><b>{p.bond}</b>/100 · <b>{t(stageName(p.bond))}</b></span></span>
                  </span>
                  <Icon name="right" />
                </a>
              ))}
            </div>
          </section>
        )}

        <section className="sec">
          <div className="sec-h"><h2>{t('Commitments')}</h2><span className="t-xs t-2">{promises.length}</span></div>
          {promises.length > 0 ? (
            <div className="card cms">
              {promises.map((c) => pressing(c) ? (
                <div key={c.id} className="due">
                  <div className="due-k"><Icon name="clock" size={14} strong />{dueLine(c, today)}</div>
                  <p>{c.text}</p>
                </div>
              ) : (
                <div key={c.id} className="cm">
                  <div className="cm-k"><Icon name="calendar" size={14} strong />{dueLine(c, today)}</div>
                  <p>{c.text}</p>
                </div>
              ))}
            </div>
          ) : <p className="card t-2">{t('You have promised nothing that is still owed.')}</p>}
        </section>

        {done.length > 0 && (
          <details className="card card-flush fold">
            <summary><Icon name="check" size={18} strong />{t('Completed threads')} <span className="t-2 num">{done.length}</span><Icon name="down" size={18} className="chev" /></summary>
            <ul className="threads">
              {done.map((th) => <li key={th.id} className="done"><p className="th-t">{th.title}</p>{th.doneDay !== undefined && <p className="th-m">{t('Day {n}', { n: th.doneDay })}</p>}</li>)}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

// ---------- Story so far ----------

function StorySoFar({ session, story, now, charged, estimated }: { session: Session; story: Story; now: Scene; charged: number; estimated: number }) {
  const a = useApp();
  const [limit, setLimit] = useState(PAGE);
  // Going back. A scene can be returned to when every turn since its start can be undone.
  const [asking, setAsking] = useState<{ scene: Scene; point: RewindPoint } | null>(null);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [booking, setBooking] = useState(false);
  const points = new Map(session.rewindPoints().map((p) => [p.sceneId, p]));
  const busy = session.busy || !!session.blocker;
  const back = (scene: Scene) => {
    const point = points.get(scene.id);
    if (!point) return null;
    return (
      <button className="link rw" disabled={busy} onClick={() => { setFailed(false); setAsking({ scene, point }); }}>
        <Icon name="rewind" size={14} strong />{t('Rewind to here')}
      </button>
    );
  };
  const rewind = async () => {
    if (!asking) return;
    setWorking(true);
    const kept = await a.rewindStory(asking.point.keep);
    setWorking(false);
    if (kept) { setAsking(null); go('play'); } else setFailed(true);
  };
  const place = (id: string) => story.world.places[id]?.name ?? t('Somewhere');
  const ended = story.scenes.filter((sc) => sc.ended && sc.summary).reverse();
  // The chapter being played lists its scenes; finished chapters, newest first, show their summary and fold their scenes away.
  const inChapter = ended.filter((sc) => sc.chapter === story.chapter.n);
  const finished = [...story.chapters].reverse();
  const [chaptersShown, setChaptersShown] = useState(CHAPTERS_PAGE);
  const [unfolded, setUnfolded] = useState<number | null>(null);
  const sceneRow = (sc: Scene) => (
    <li key={sc.id}>
      <div className="tl-k"><span>{t('Scene {n} · {place} · {when}', { n: sc.n, place: place(sc.placeId), when: when(sc.started) })}</span></div>
      <p className="t-story">{sc.summary}</p>
      {back(sc)}
    </li>
  );
  const chain = parentChain(story, now.placeId);
  const within = chain[chain.length - 2];

  return (
    <div className="split jr">
      <div className="jc">
        <section className="sec">
          <div className="sec-h"><h2>{t('This chapter so far')}</h2><span className="t-xs t-2">{t('Chapter {n} · {title}', { n: story.chapter.n, title: story.chapter.title })}</span></div>
          {story.summary
            ? <p className="t-story lead">{story.summary}</p>
            : <p className="card t-2">{story.chapters.length ? t('The chapter has only just begun. What came before is in the chapters below.') : t('Nothing has been written up yet. The chapter so far is rewritten each time a scene ends.')}</p>}
        </section>

        <section className="sec">
          <div className="sec-h"><h2>{t('Chapters')}</h2><span className="t-xs t-2">{t('{chapters} · {scenes} · newest first', { chapters: tn(story.chapters.length, '{n} finished chapter', '{n} finished chapters'), scenes: tn(ended.length, '{n} finished scene', '{n} finished scenes') })}</span></div>
          <div className="stack">
            {/* The chapter being played: its scenes, newest first, a page at a time. */}
            <article className="card ch">
              <div>
                <div className="ch-h"><span className="t-caps">{t('Chapter {n}', { n: story.chapter.n })}</span><span className="tag tag-accent">{t('In progress')}</span></div>
                <h3>{story.chapter.title}</h3>
                <p className="ch-facts">{t('Since day {day} · {turns}', { day: story.chapter.fromDay, turns: tn(story.totals.turns - story.chapter.turnsBefore, '{n} turn', '{n} turns') })}</p>
              </div>
              <ol className="tl sc-list">
                <li className="big">
                  <div className="tl-k"><span>{t('Scene {n} · {place} · {when}', { n: now.n, place: place(now.placeId), when: when(now.started) })}</span><span className="tag tag-accent">{t('Now')}</span></div>
                  <p className="sc-now">{t('Being played · {turns} so far. It is written up when the scene ends.', { turns: tn(now.turns.length, '{n} turn', '{n} turns') })}</p>
                  {back(now)}
                </li>
                {inChapter.slice(0, limit).map(sceneRow)}
              </ol>
              {inChapter.length === 0 && <p className="sc-none">{t('No scene of this chapter has finished yet. A scene ends when you leave a place or the story moves on, and its summary appears here.')}</p>}
              {inChapter.length > limit && <button className="btn btn-quiet more" onClick={() => setLimit(limit + PAGE)}><Icon name="down" size={18} />{t('Show earlier scenes ({count})', { count: inChapter.length - limit })}</button>}
            </article>

            {/* Finished chapters: what each one came to, as it was written when it ended. Their scenes stay folded away. */}
            {finished.slice(0, chaptersShown).map((c) => {
              const scenes = ended.filter((sc) => sc.chapter === c.n);
              const open = unfolded === c.n;
              return (
                <article key={c.n} className="card ch">
                  <div>
                    <div className="ch-h"><span className="t-caps">{t('Chapter {n}', { n: c.n })}</span></div>
                    <h3>{c.title}</h3>
                    <p className="ch-facts">{c.fromDay === c.toDay ? t('Day {n}', { n: c.fromDay }) : t('Days {from}–{to}', { from: c.fromDay, to: c.toDay })} · {tn(c.turns, '{n} turn', '{n} turns')}{c.scenes ? ` · ${tn(c.scenes, '{n} scene', '{n} scenes')}` : ''}</p>
                  </div>
                  <p className="t-story">{c.summary}</p>
                  {scenes.length > 0 && (
                    <>
                      <button className="link ch-fold" aria-expanded={open} onClick={() => setUnfolded(open ? null : c.n)}>
                        {open ? t('Hide its scenes') : t('Show its {scenes}', { scenes: tn(scenes.length, '{n} scene', '{n} scenes') })}<Icon name="down" size={14} strong className={open ? 'chev is-up' : 'chev'} />
                      </button>
                      {open && <ol className="tl sc-list">{scenes.map(sceneRow)}</ol>}
                    </>
                  )}
                </article>
              );
            })}
            {finished.length > chaptersShown && <button className="btn btn-quiet more" onClick={() => setChaptersShown(chaptersShown + CHAPTERS_PAGE)}><Icon name="down" size={18} />{t('Show earlier chapters ({count})', { count: finished.length - chaptersShown })}</button>}
          </div>
        </section>
      </div>

      <div className="jc">
        <section className="sec">
          <div className="sec-h"><h2>{t('Where it stands')}</h2></div>
          <div className="card">
            <dl className="kv stands">
              <div><dt>{t('Now')}</dt><dd>{t('Chapter {n} · Scene {scene}', { n: story.chapter.n, scene: now.n })}</dd></div>
              <div><dt>{t('Where')}</dt><dd>{place(now.placeId)}{within ? `, ${within.name}` : ''}</dd></div>
              <div><dt>{t('When')}</dt><dd>{when(story.clock)}</dd></div>
              <div><dt>{t('Played')}</dt><dd className="num">{tn(story.totals.turns, '{n} turn', '{n} turns')}</dd></div>
              <div>
                <dt>{t('Cost')}</dt>
                <dd className="num">
                  <span>{t('{price} charged so far', { price: money(charged) })}</span>
                  {estimated > 0 && <span className="t-2">{t('Demo narrator: {price} estimated, never charged', { price: money(estimated) })}</span>}
                </dd>
              </div>
            </dl>
            <div className="stands-read">
              <a className="btn btn-soft" href={href('recap')}><Icon name="story" size={18} />{t('Read “Previously…”')}</a>
              <button type="button" className="btn btn-soft" disabled={booking} onClick={() => { setBooking(true); void downloadBook(story.id, story.title).finally(() => setBooking(false)); }}><Icon name="journal" size={18} />{t('Read it as a book')}</button>
            </div>
            <p className="help">{t('The whole story as one page to read or print, saved as a file: chapters, scenes and every line, without the game around it.')}</p>
          </div>
        </section>

        <section className="sec">
          <div className="sec-h"><h2>{t('Kept as true')}</h2><span className="t-xs t-2">{t('About the story · {n} of {max}', { n: factsAbout(story, '', 99).length, max: FACTS_MAX.story })}</span></div>
          <div className="card">
            <AllFacts session={session} story={story} />
            <p className="help">{t('Each goes to the narrator whenever what it is about is in the scene. Let go of what no longer matters: fewer is cheaper.')}</p>
          </div>
        </section>

        <section className="sec">
          <div className="sec-h"><h2>{t('Going back')}</h2></div>
          {!session.canRewind ? (
            <div className="alert"><Icon name="lock" /><div><b>{t('No rewinding in this story')}</b><p>{t('It is played in the Brutal style: what happened stays.')}</p></div></div>
          ) : (
            <div className="alert">
              <Icon name="rewind" />
              <div>
                <b>{t('Rewinding is allowed in this story')}</b>
                <p>
                  {points.size > 0
                    ? t('You can go back to the start of any scene marked “Rewind to here”. The turns after it are kept as a separate copy.')
                    : t('You can go back to the start of a scene once a turn has been played in it. The turns after it are kept as a separate copy.')}
                  {story.rewindFloor > 0 && story.scenes.some((sc) => sc.ended && !points.has(sc.id)) && ` ${t('Scenes from before this story could be rewound have no such mark.')}`}
                </p>
              </div>
            </div>
          )}
        </section>
      </div>

      {asking && (
        <Modal
          title={t('Rewind to the start of this scene?')} onClose={() => { if (!working) setAsking(null); }}
          foot={<><button className="btn" disabled={working} onClick={() => setAsking(null)}>{t('Cancel')}</button><button className="btn btn-primary" disabled={working} onClick={() => void rewind()}><Icon name="rewind" size={18} />{working ? t('Rewinding…') : t('Rewind')}</button></>}
        >
          <p className="rw-where">{t('Scene {n} · {place} · {when}', { n: asking.scene.n, place: place(asking.scene.placeId), when: when(asking.scene.started) })}</p>
          <p className="t-2">
            {t('The story goes back to the first turn of the scene, {turns} ago.', { turns: tn(asking.point.drops, '{n} turn', '{n} turns') })}{' '}
            {t('Bonds, experience, the clock, the dice and what you carry return to what they were then.')}
          </p>
          <div className="alert alert-ok">
            <Icon name="ok-circle" />
            <div><b>{t('Nothing is lost')}</b><p>{t('The story as it is now, with every turn after that point, is kept as a separate copy in your stories. Rewinding costs nothing.')}</p></div>
          </div>
          {failed && <div className="alert alert-err" role="alert"><Icon name="warn" /><div><b>{t('The story could not be taken back')}</b><p>{t('Nothing was changed. An earlier scene may be missing from this device’s storage.')}</p></div></div>}
        </Modal>
      )}
    </div>
  );
}

// ---------- Rolls ----------

const OUTCOME: Record<TestResult['outcome'], { text: string; ok: boolean; icon: IconName }> = {
  success: { text: m('Success'), ok: true, icon: 'check' },
  cost: { text: m('Success at a cost'), ok: true, icon: 'check' },
  forward: { text: m('Failed'), ok: false, icon: 'x' },
  fail: { text: m('Failed'), ok: false, icon: 'x' },
};

function TestRow({ result }: { result: TestResult }) {
  const o = OUTCOME[result.outcome];
  const what = result.skill ? t(result.skill) : t(cap(result.attribute));
  const facts: string[] = [t(DIFFICULTY[result.difficulty])];
  if (result.skill && !result.hasSkill) facts.push(t('without the {skill} skill', { skill: t(result.skill) }));
  const more: string[] = [];
  if (result.die === 6 && result.target >= 6) more.push(t('a 6 always fails'));
  if (result.rerolled !== undefined) more.push(t('rolled {n} first, then rolled again with a destiny point', { n: result.rerolled }));
  if (result.passed && result.die !== null) more.push(t('quality {n}', { n: result.quality }));
  if (result.outcome === 'forward') more.push(t('it left a way forward'));
  return (
    <li className="rl">
      <span className="rl-d">
        {result.rerolled !== undefined && <><span className="was"><Die face={result.rerolled} small label={t('You rolled {n} first', { n: result.rerolled })} /></span><Icon name="right" size={12} strong /></>}
        {result.die !== null
          ? <Die face={result.die} small label={t('You rolled {n}', { n: result.die })} />
          : <span className="rl-auto" role="img" aria-label={t('No die was rolled')}><Icon name="minus" size={18} /></span>}
      </span>
      <span className="rl-t"><b>{what}</b>{result.label ? ` · ${result.label}` : ''}</span>
      <span className={`badge${o.ok ? '' : ' badge-fail'}`}><Icon name={o.icon} size={14} strong />{t(o.text)}</span>
      <span className="rl-m">
        {facts.join(' · ')} ·{' '}
        {result.auto === 'success' ? t('no roll needed: easy for someone with the skill')
          : result.auto === 'impossible' ? t('no roll: out of reach')
          : <T text="needed <b>{n} or less</b>" vars={{ n: Math.min(5, result.target) }} />}
        {more.map((note) => ` · ${note}`)}
      </span>
    </li>
  );
}

/** "1 + 3 + 4": the parts of a total, leaving out bonuses that were zero. */
function sum(parts: number[], minus = 0): string {
  return parts.filter((n, i) => i < 3 || n !== 0).join(' + ') + (minus ? ` − ${minus}` : '');
}

function AttackRow({ event, record }: { event: AttackEvent; record: RollRecord }) {
  const hit = event.damage > 0;
  const mine = record.byYou;
  const attack = sum([event.power, event.attackSkill, event.attackDie, event.groupBonus], event.penalty);
  const defence = sum([event.armor, event.defenceSkill, event.defenceDie, event.guard]);
  const more: string[] = [];
  if (event.critAttack) more.push(t('the attacker’s 6 doubled the blow'));
  if (event.critDefence) more.push(t('the defender’s 6 doubled the armor'));
  const badge = mine
    ? hit ? { cls: '', icon: 'sword' as const, text: t('Hit') } : { cls: ' badge-wait', icon: 'x' as const, text: t('Missed') }
    : hit ? { cls: ' badge-fail', icon: 'heart' as const, text: t('Hurt') } : { cls: '', icon: 'shield' as const, text: t('Blocked') };
  return (
    <li className="rl rl-2">
      <span className="rl-d">
        <Die face={event.attackDie} small foe={!mine} label={mine ? t('You rolled {n} to attack', { n: event.attackDie }) : t('{who} rolled {n} to attack', { who: record.who, n: event.attackDie })} />
        <Die face={event.defenceDie} small foe={mine} label={mine ? t('The opponent rolled {n} to defend', { n: event.defenceDie }) : t('You rolled {n} to defend', { n: event.defenceDie })} />
      </span>
      <span className="rl-t"><b>{mine ? t('Attack') : t('Defence')}</b>{record.label ? ` · ${record.label.replace(/^(attack|defence) /, '')}` : ''}</span>
      <span className={`badge${badge.cls}`}><Icon name={badge.icon} size={14} strong />{badge.text}</span>
      <span className="rl-m">
        {mine
          ? <T text="Your attack {attack} = <b>{total}</b> against a defence of {defence}" vars={{ attack, total: event.attackTotal, defence: event.defenceTotal }} />
          : <T text="{who}’s attack of {attack} against your defence {defence} = <b>{total}</b>" vars={{ who: record.who, attack: event.attackTotal, defence, total: event.defenceTotal }} />}
        {' · '}{hit ? (mine ? <T text="<b>{n}</b> damage" vars={{ n: event.damage }} /> : <T text="<b>{n}</b> damage to you" vars={{ n: event.damage }} />) : t('no damage')}
        {more.map((note) => ` · ${note}`)}
      </span>
    </li>
  );
}

const FACES = [m('Ones'), m('Twos'), m('Threes'), m('Fours'), m('Fives'), m('Sixes')];

function Rolls({ story, dice, average }: { story: Story; dice: number[]; average: string | null }) {
  const [limit, setLimit] = useState(PAGE);
  const all = story.rolls;
  if (all.length === 0) {
    return (
      <section className="empty">
        <Icon name="dice" size={40} />
        <h2>{t('No rolls yet')}</h2>
        <p>{t('When something you try could fail, or a fight breaks out, the app rolls a die and records it here. Dice are rolled by the app, never by the narrator.')}</p>
        <a className="btn btn-primary btn-fit" href={href('play')}>{t('Back to the story')}</a>
      </section>
    );
  }

  // Newest first, in runs of the same day and place.
  const shown = all.slice(Math.max(0, all.length - limit)).reverse();
  const groups: { day: number; placeId: string; rolls: RollRecord[] }[] = [];
  for (const r of shown) {
    const last = groups[groups.length - 1];
    if (last && last.day === r.clock.day && last.placeId === r.placeId) last.rolls.push(r);
    else groups.push({ day: r.clock.day, placeId: r.placeId, rolls: [r] });
  }
  const counts = [1, 2, 3, 4, 5, 6].map((f) => dice.filter((d) => d === f).length);
  const rerolls = all.filter((r) => 'kind' in r.result && r.result.rerolled !== undefined).length;
  const earlier = all.length - shown.length;

  return (
    <div className="split jr">
      <div className="jc">
        <p className="alert"><Icon name="dice" /><span><b>{t('Dice are rolled by the app, never by the narrator.')}</b><span className="t-2">{t('A white die is yours. A dark die is an opponent’s.')}</span></span></p>

        {groups.map((g, i) => (
          <section key={i} className="sec">
            <h3 className="grp"><span>{g.day === story.clock.day ? t('Today · Day {n}', { n: g.day }) : t('Day {n}', { n: g.day })}</span><span>{story.world.places[g.placeId]?.name ?? ''}</span></h3>
            <ol className="card card-flush">
              {g.rolls.map((r, k) => 'kind' in r.result
                ? <TestRow key={k} result={r.result} />
                : <AttackRow key={k} event={r.result} record={r} />)}
            </ol>
          </section>
        ))}

        {earlier > 0 && <button className="btn btn-quiet more" onClick={() => setLimit(limit + PAGE)}><Icon name="down" size={18} />{t('Show earlier rolls ({count})', { count: earlier })}</button>}
      </div>

      <div className="jc">
        <section className="sec">
          <div className="sec-h"><h2>{t('All rolls')}</h2></div>
          <div className="card">
            <dl className="stats" aria-label={t('Totals')}>
              <div><dt>{t('Rolls')}</dt><dd>{all.length}</dd></div>
              <div><dt>{t('Dice')}</dt><dd>{dice.length}</dd></div>
              <div><dt>{t('Average')}</dt><dd>{average ?? '–'}</dd></div>
            </dl>
            <ul className="faces" aria-label={t('How often each face came up')}>
              {counts.map((n, i) => (
                <li key={i}>
                  <span className="die die-s" data-face={i + 1} role="img" aria-label={t(FACES[i] ?? '')}><i /><i /><i /><i /><i /><i /><i /><i /><i /></span>
                  <span><b>{n}</b>×</span>
                </li>
              ))}
            </ul>
            <p className="help faces-n">
              {t('A fair die averages 3.5. A test rolls one die; an attack rolls two, yours and the opponent’s.')}
              {rerolls > 0 && ` ${tn(rerolls, '{n} roll was taken again with a destiny point.', '{n} rolls were taken again with a destiny point.')}`}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
