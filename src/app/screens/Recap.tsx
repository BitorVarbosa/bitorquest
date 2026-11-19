// Recap: "Previously…". Where the story stands, to read before going back into it after a break.
// Everything on it is put together from what the story already keeps: the summaries of its chapters and
// scenes, the roll log, the record of events, the character sheet. It asks the narrator for nothing, so
// opening it sends nothing and costs nothing.
import { useState } from 'react';
import { stageIndex, stageName, type TestResult } from '../../engine';
import { newsFor, reachOf } from '../../game/cards';
import type { Session } from '../../game/session';
import { sceneTitle } from '../../game/story';
import type { Chapter, Note, Person, RollRecord, Scene, Story } from '../../game/types';
import { t, tn } from '../../i18n';
import { useApp } from '../app';
import { go, href } from '../router';
import { StoryPage } from '../Shell';
import { T } from '../T';
import { Avatar, BondBar, Die, Icon, Notes, who } from '../ui';
import './recap.css';

/** The newest finished chapters are told in full; the ones before them in a line each. */
const CHAPTERS_FULL = 2;
/** Lines of earlier chapters in view before "Show earlier chapters": a recap is for what came last. */
const CHAPTERS_LINES = 3;
/** People whose bond moved, in view before "Show more". */
const BONDS_PAGE = 5;
/** The last thing the narrator wrote is cut at about this many characters. */
const LAST_WORDS = 480;

type RolledTest = TestResult & { die: number };
interface Moved { person: Person; net: number; moments: number }

const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const days = (c: Chapter): string => (c.fromDay === c.toDay ? t('Day {n}', { n: c.fromDay }) : t('Days {from}–{to}', { from: c.fromDay, to: c.toDay }));

/** The rolls made in a scene. Its turns are numbered in `stored` once it has been put away, and are in `turns` until then. */
function rollsIn(story: Story, scene: Scene): RollRecord[] {
  const first = scene.turns[0];
  const final = scene.turns[scene.turns.length - 1];
  const span = scene.stored ? (scene.stored.turns > 0 ? { from: scene.stored.from, to: scene.stored.to } : null)
    : first && final ? { from: first.n, to: final.n } : null;
  return span ? story.rolls.filter((r) => r.n >= span.from && r.n <= span.to) : [];
}

const HARDER: Record<TestResult['difficulty'], number> = { easy: 0, medium: 1, hard: 2 };

/**
 * The one test that says most about a scene: one a destiny point was spent on, else the hardest, else the
 * last. Only tests where a die was rolled count; attacks are left to the roll log.
 */
function telling(rolls: RollRecord[]): RolledTest | null {
  const weight = (t: RolledTest): number => (t.rerolled !== undefined ? 3 : 0) + HARDER[t.difficulty];
  let best: RolledTest | null = null;
  for (const r of rolls) {
    const t = r.result;
    if (!('kind' in t) || t.die === null) continue;
    const rolled: RolledTest = { ...t, die: t.die };
    if (!best || weight(rolled) >= weight(best)) best = rolled;
  }
  return best;
}

/** How bonds moved in one scene, as the chips the story log uses: one for each person, with the stage the bond came to. */
function bondNotes(story: Story, scene: Scene): Note[] {
  const moves = new Map<string, { delta: number; before: number; after: number }>();
  for (const e of story.events) {
    if (!e.bond || e.sceneId !== scene.id) continue;
    const move = moves.get(e.bond.who) ?? { delta: 0, before: e.bond.after - e.bond.delta, after: e.bond.after };
    move.delta += e.bond.delta;
    move.after = e.bond.after;
    moves.set(e.bond.who, move);
  }
  return [...moves]
    .filter(([, m]) => m.delta !== 0)
    .map(([id, m]): Note => ({ kind: 'bond', who: id, delta: m.delta, after: m.after, stage: stageName(m.after), newStage: stageIndex(m.after) > stageIndex(m.before) }));
}

/**
 * The last paragraph of narration the player has read. Of the latest turn only the passages already
 * revealed count, so a recap never gives away what is still waiting behind Continue.
 */
function lastWords(session: Session): string {
  const scenes = session.story.scenes;
  const latest = session.lastTurn;
  for (let s = scenes.length - 1; s >= 0; s--) {
    const turns = scenes[s]!.turns;
    for (let t = turns.length - 1; t >= 0; t--) {
      const turn = turns[t]!;
      const upTo = turn === latest && session.shown < turn.groups.length ? turn.groups[session.shown] ?? turn.beats.length : turn.beats.length;
      for (let b = Math.min(upTo, turn.beats.length) - 1; b >= 0; b--) {
        const beat = turn.beats[b]!;
        if (beat.type === 'narration' && beat.text) return beat.text.length > LAST_WORDS ? `${beat.text.slice(0, LAST_WORDS - 3).replace(/\s+\S*$/, '')}…` : beat.text;
      }
    }
  }
  return '';
}

/**
 * How each bond moved in the chapter being played: the events that changed a bond, summed per person,
 * the largest change first. An event belongs to the chapter of its scene; one from before the story's
 * first scene has no scene, and is placed by its day.
 */
function bondsMoved(story: Story): Moved[] {
  const chapterOf = new Map(story.scenes.map((sc) => [sc.id, sc.chapter]));
  const sums = new Map<string, Moved>();
  for (const e of story.events) {
    if (!e.bond) continue;
    const chapter = chapterOf.get(e.sceneId);
    if (chapter === undefined ? e.clock.day < story.chapter.fromDay : chapter !== story.chapter.n) continue;
    const person = story.world.people[e.bond.who];
    if (!person) continue;
    const sum = sums.get(person.id) ?? { person, net: 0, moments: 0 };
    sum.net += e.bond.delta;
    sum.moments += 1;
    sums.set(person.id, sum);
  }
  return [...sums.values()].sort((x, y) => Math.abs(y.net) - Math.abs(x.net) || y.moments - x.moments || x.person.name.localeCompare(y.person.name));
}

/** A roll remembered: the die, what it was for, the number needed, how it came out. */
function Rolled({ test }: { test: RolledTest }) {
  const passed = test.outcome === 'success' || test.outcome === 'cost';
  const facts = [
    t('Needed {n} or less', { n: Math.min(5, test.target) }),
    test.rerolled !== undefined ? t('rolled {first}, then {last} with a destiny point', { first: test.rerolled, last: test.die }) : t('rolled {n}', { n: test.die }),
  ];
  if (test.die === 6 && test.target >= 6) facts.push(t('a 6 always fails'));
  if (test.outcome === 'forward') facts.push(t('it left a way forward'));
  return (
    <div className="rcp-roll">
      <Die face={test.die} small label={t('You rolled {n}', { n: test.die })} />
      <span className="rcp-roll-t"><b>{test.skill ? t(test.skill) : t(cap(test.attribute))}{test.label ? `: ${test.label}` : ''}</b>{facts.join(' · ')}</span>
      <span className={`badge${passed ? '' : ' badge-fail'}`}><Icon name={passed ? 'check' : 'x'} size={14} strong />{test.outcome === 'cost' ? t('Success at a cost') : passed ? t('Success') : t('Failed')}</span>
    </div>
  );
}

/** Someone whose bond moved: where the bond stands now, what the chapter added or took, and anything waiting. */
function BondCard({ moved }: { moved: Moved }) {
  const p = moved.person;
  const over = tn(moved.moments, 'over {n} moment', 'over {n} moments');
  return (
    <a className={`person rcp-p ${who(p)}${p.pendingMoment ? ' is-focus' : ''}`} href={href(`person/${encodeURIComponent(p.id)}`)}>
      <div className="person-top">
        <Avatar person={p} size="l" pinned={p.pinned} />
        <div className="person-id">
          <div className="person-name">{p.name}</div>
          <div className="person-role">{p.role}</div>
        </div>
        <div className="bond">
          {p.bond > 0
            ? <><div className="bond-l"><b>{t(stageName(p.bond))}</b><span><b>{p.bond}</b>/100</span></div><BondBar bond={p.bond} size="l" /></>
            : <small>{t('No bond now')}</small>}
        </div>
      </div>
      <p className="person-note">
        {moved.net === 0 ? t('No change in this chapter, {over}', { over })
          : <T text="<delta>{amount}</delta> in this chapter, {over}" vars={{ delta: (inner) => <b className={moved.net < 0 ? 'rcp-loss' : 'rcp-up'}>{inner}</b>, amount: `${moved.net < 0 ? '−' : '+'}${Math.abs(moved.net)}`, over }} />}
      </p>
      {p.pendingMoment && (
        <p className="moment"><Icon name="spark" size={16} fill /><span><b>{t('New stage: {stage}', { stage: p.pendingMoment })}</b>{t('{name} wants a moment with you. It plays when you spend time together.', { name: p.short })}</span></p>
      )}
      {p.grievance && (
        <p className="moment rcp-grief"><Icon name="warn" size={16} /><span><b>{t('Open grievance')}</b>{p.grievance}</span></p>
      )}
    </a>
  );
}

export function Recap() {
  const a = useApp();
  const session = a.session;
  const [early, setEarly] = useState(false);
  const [everyBond, setEveryBond] = useState(false);
  if (!session) return null;
  const story = session.story;
  const me = story.protagonist;

  // The story so far: the chapters in the order they happened, the old ones in a line each.
  const full = story.chapters.slice(-CHAPTERS_FULL);
  const lines = story.chapters.slice(0, story.chapters.length - full.length);
  const linesShown = early ? lines : lines.slice(-CHAPTERS_LINES);
  const turnsNow = story.totals.turns - story.chapter.turnsBefore;

  // Last time: the latest scene that has been written up, and the scene being played, which has not.
  const written = story.scenes.filter((sc) => sc.ended && sc.summary);
  const last = written[written.length - 1];
  const rolls = last ? rollsIn(story, last) : [];
  const test = telling(rolls);
  const others = rolls.length - (test ? 1 : 0);
  const closer = last ? bondNotes(story, last) : [];
  const now = story.scenes[story.scenes.length - 1];
  const playing = now && !now.ended ? now : null;
  const words = lastWords(session);

  // What you earned, and what is still open.
  const moved = bondsMoved(story);
  const bonds = everyBond ? moved : moved.slice(0, BONDS_PAGE);
  const open = story.threads.filter((th) => th.status === 'open').length;
  const due = story.commitments.filter((c) => !c.done).length;
  const onward = story.over ? t('See how it ended') : t('Continue the story');

  // Meanwhile, elsewhere: news of the world that has reached where the protagonist is. Only what is
  // being said there: what has not arrived yet, and what happened out of sight, is not shown.
  const here = now?.placeId ?? story.world.startPlace;
  const town = reachOf(story, here).town;
  const news = newsFor(story, here, 4).map((e) => {
    const origins = [e.placeId, ...(e.also ?? [])];
    const near = origins.find((id) => (town !== null ? reachOf(story, id).town === town : id === here));
    return { id: e.id, text: e.text, near: !!near, place: story.world.places[near ?? e.placeId]?.name ?? '' };
  });

  return (
    <StoryPage page="recap" title={t('Previously…')}>
      <div className="rcp">
        <header className="page-h">
          <div>
            <h1 className="only-desktop">{t('Previously…')}</h1>
            <p>{t('Where “{title}” stands. Put together from what is already saved, so opening it costs nothing.', { title: story.title })}</p>
          </div>
          <div className="inline rcp-go">
            <button className="btn btn-primary btn-fit" onClick={() => go('play')}>{onward}<Icon name="arrow" size={18} /></button>
          </div>
        </header>

        <div className="split rcp-cols">
          {/* The story, to read */}
          <div className="rcp-main">
            <section className="sec">
              <div className="sec-h"><h2>{t('The story so far')}</h2><span className="t-xs t-2">{t('Chapter {n} · Day {day}', { n: story.chapter.n, day: story.clock.day })}</span></div>
              <div className="rcp-tale">
                {lines.length > 0 && (
                  <div className="rcp-early">
                    {lines.length > linesShown.length && (
                      <button className="btn btn-quiet rcp-more" onClick={() => setEarly(true)}><Icon name="up" size={18} />{t('Show {chapters}', { chapters: tn(lines.length - linesShown.length, '{n} earlier chapter', '{n} earlier chapters') })}</button>
                    )}
                    <ol className="rcp-lines">
                      {linesShown.map((c) => <li key={c.n}><span className="t-caps">{t('Chapter {n} · {title}', { n: c.n, title: c.title })}</span><p>{c.gist || c.summary}</p></li>)}
                    </ol>
                  </div>
                )}
                {full.map((c) => (
                  <article key={c.n} className="rcp-ch">
                    <header className="rcp-ch-h"><h3 className="t-caps">{t('Chapter {n} · {title}', { n: c.n, title: c.title })}</h3><span>{days(c)} · {tn(c.turns, '{n} turn', '{n} turns')}</span></header>
                    <p className="t-story">{c.summary}</p>
                  </article>
                ))}
                <article className="rcp-ch">
                  <header className="rcp-ch-h">
                    <h3 className="t-caps">{t('Chapter {n} · {title}', { n: story.chapter.n, title: story.chapter.title })}</h3>
                    <span>{t('{state} · since day {day} · {turns}', { state: story.over ? t('The last chapter') : t('In progress'), day: story.chapter.fromDay, turns: tn(turnsNow, '{n} turn', '{n} turns') })}</span>
                  </header>
                  {story.summary
                    ? <p className="t-story">{story.summary}</p>
                    : <p className="rcp-quiet">{story.chapters.length ? t('This chapter has only just begun. Nothing of it has been written up yet.') : t('Nothing has been written up yet. The chapter so far is rewritten each time a scene ends.')}</p>}
                </article>
              </div>
              <a className="link link-tap rcp-link" href={href('journal/story')}>{t('The whole story, scene by scene, in the journal')}<Icon name="right" size={14} strong /></a>
            </section>

            <section className="sec">
              <div className="sec-h"><h2>{t('Last time')}</h2>{last && <span className="t-xs t-2">{sceneTitle(story, last)}</span>}</div>
              <div className="rcp-tale">
                {last
                  ? <p className="t-story">{last.summary}</p>
                  : <p className="rcp-quiet">{t('No scene has finished yet. A scene is written up when it ends, and the latest one is told here.')}</p>}
                {test && <Rolled test={test} />}
                {others > 0 && (
                  <a className="link link-tap rcp-link" href={href('journal/rolls')}>
                    {t('{rolls} in that scene, in the roll log', { rolls: test ? tn(others, 'One more roll', '{n} more rolls') : tn(others, '{n} roll', '{n} rolls') })}<Icon name="right" size={14} strong />
                  </a>
                )}
                {closer.length > 0 && <Notes notes={closer} people={story.world.people} />}
                {playing && (
                  <div className="rcp-stop">
                    <span className="t-caps">{t('Where you stopped')}</span>
                    <p className="rcp-stop-k">{sceneTitle(story, playing)} · {playing.turns.length ? tn(playing.turns.length, '{n} turn so far, not written up yet', '{n} turns so far, not written up yet') : t('nothing played here yet')}</p>
                    {words && <p className="t-story">{words}</p>}
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* The facts, to check */}
          <aside className="rcp-side">
            <section className="sec">
              <div className="sec-h"><h2>{t('What you earned')}</h2></div>
              <div className="card card-flush">
                <a className="row" href={href('character')}>
                  <Icon name="spark" className="rcp-i" />
                  <span className="grow">
                    <span className="row-t">{t('Experience')}</span>
                    <span className="row-s">{me.xp > 0 ? (story.world.rules.powers === 'gift' ? t('Waiting to be spent on attributes and your power') : t('Waiting to be spent on attributes and paths')) : t('None waiting to be spent')}{me.xpEarned > 0 ? ` · ${t('{n} earned in the whole story', { n: me.xpEarned })}` : ''}</span>
                  </span>
                  <span className="row-end rcp-gain">{me.xp}</span>
                  <Icon name="right" size={18} className="t-3" />
                </a>
                <div className="row">
                  <Icon name="gem" className="rcp-i" />
                  <span className="grow">
                    <span className="row-t">{t('Destiny points')}</span>
                    <span className="row-s">{t('Left for this chapter. They come back when the next one begins.')}</span>
                  </span>
                  <span className="row-end rcp-gain">{t('{n} of {max}', { n: me.destiny, max: me.destinyMax })}</span>
                </div>
              </div>
            </section>

            <section className="sec">
              <div className="sec-h"><h2>{t('Bonds in this chapter')}</h2>{moved.length > 0 && <span className="t-xs t-2">{moved.length}</span>}</div>
              {moved.length > 0
                ? <div className="rcp-bonds">{bonds.map((m) => <BondCard key={m.person.id} moved={m} />)}</div>
                : <p className="card rcp-quiet">{t('No bond has moved in this chapter yet.')}</p>}
              {moved.length > bonds.length && (
                <button className="btn btn-quiet rcp-more" onClick={() => setEveryBond(true)}><Icon name="down" size={18} />{t('Show {count} more', { count: moved.length - bonds.length })}</button>
              )}
            </section>

            {news.length > 0 && (
              <section className="sec">
                <div className="sec-h"><h2>{t('Meanwhile, elsewhere')}</h2></div>
                <div className="card">
                  <ul className="rcp-news">
                    {news.map((n) => (
                      <li key={n.id}>
                        <div className="inline"><span className={`tag${n.near ? '' : ' tag-gold'}`}>{n.near ? t('News') : t('Rumour')}</span><span className="t-xs t-2">{n.place}</span></div>
                        <p>{n.text}</p>
                      </li>
                    ))}
                  </ul>
                  <p className="rcp-also">{t('The world keeps moving while you play. This is what is being said where you are; word from far away takes days to arrive, and may have changed on the road.')}</p>
                </div>
              </section>
            )}

            <div className="card card-flush">
              <a className="row" href={href('journal')}>
                <Icon name="journal" className="rcp-i" />
                <span className="grow">
                  <span className="row-t">{t('Still open, in the journal')}</span>
                  <span className="row-s">{open + due > 0 ? `${tn(open, '{n} open thread', '{n} open threads')} · ${tn(due, '{n} commitment', '{n} commitments')}` : t('Nothing is open right now')}</span>
                </span>
                <Icon name="right" size={18} className="t-3" />
              </a>
            </div>
          </aside>
        </div>

        {/* On a phone the way back into the story stays in reach, in a bar above the navigation */}
        <div className="rcp-foot">
          <button className="btn btn-primary btn-lg" onClick={() => go('play')}>{onward}<Icon name="arrow" size={18} /></button>
        </div>
      </div>
    </StoryPage>
  );
}
