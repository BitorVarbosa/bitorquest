// Usage: what was spent, by this app's own count.
// Real charges and demo estimates are two separate ledgers and are never added together: real
// spending counts against the daily limit; demo rows estimate what the chosen models would have cost
// and were never charged. The page shows one ledger at a time and always says which.
import { useState, type CSSProperties } from 'react';
import { CACHE_WRITE_1H, CACHE_WRITE_5M, PRICES_AS_OF, SERVICES, SERVICE_NAME, cacheShare, modelInfo, serviceOf } from '../../game/llm/models';
import type { UsageEntry } from '../../game/types';
import { listOf, locale, m, num, t, tn } from '../../i18n';
import { useApp } from '../app';
import { dayKey } from '../db';
import { href } from '../router';
import { LibraryPage } from '../Shell';
import { T } from '../T';
import { Icon, money } from '../ui';
import './usage.css';

type Role = UsageEntry['role'];
const ROLES: { id: Role; label: string; does: string }[] = [
  { id: 'narrator', label: m('Narrator'), does: m('Writes the story') },
  { id: 'referee', label: m('Referee'), does: m('Decides which rule applies') },
  { id: 'scribe', label: m('Scribe'), does: m('Writes up each scene') },
  { id: 'architect', label: m('World builder'), does: m('Builds worlds and proposes characters') },
];
const DAYS = 14;

const part = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString(locale(), o);
const dayAndMonth = (d: Date) => part(d, { day: 'numeric', month: 'long' });
const weekday = (d: Date) => `${part(d, { weekday: 'long' })} ${dayAndMonth(d)}`;
/** A figure on a chart: two decimals, so fourteen of them fit side by side. The list under the chart has the exact amounts. */
const onChart = (n: number) => (n >= 0.005 ? `$${n.toFixed(2)}` : '<$0.01');
/** A small amount in a table: enough decimals to show it, and never a row of zeros for something that cost a little. */
const exact = (n: number) => (n > 0 && n < 0.0001 ? '<$0.0001' : money(n));
const count = (n: number) => num(n);
const pct = (share: number) => `${Math.round(share * 100)}%`;
const bar = (share: number) => ({ '--v': `${Math.max(0, Math.min(100, share * 100)).toFixed(2)}%` }) as CSSProperties;

/** What the cache saved: what was read from it at the cache price instead of the full price, less what it cost extra to put text there. */
function cacheSaving(rows: UsageEntry[]): number {
  let saved = 0;
  for (const u of rows) {
    const mi = modelInfo(u.model);
    saved += (u.cacheRead * (mi.input - mi.cacheRead) - u.cacheWrite5m * mi.input * (CACHE_WRITE_5M - 1) - u.cacheWrite1h * mi.input * (CACHE_WRITE_1H - 1)) / 1_000_000;
  }
  return saved;
}

export function Usage() {
  const a = useApp();
  const [pick, setPick] = useState<'real' | 'demo' | null>(null);
  const [open, setOpen] = useState(false); // the list of every day under the chart

  const real = a.usage.filter((u) => !u.simulated);
  const demo = a.usage.filter((u) => u.simulated);
  const both = real.length > 0 && demo.length > 0;
  const showing: 'real' | 'demo' = both && pick ? pick : real.length > 0 ? 'real' : 'demo';
  const isDemo = showing === 'demo';
  const rows = isDemo ? demo : real;
  
  // ----- today against the limit: real charges only -----
  const now = new Date();
  const todayKey = dayKey(now.getTime());
  const limit = a.settings.dailyCap;
  const spent = a.spentToday();
  const demoToday = demo.filter((u) => u.day === todayKey).reduce((sum, u) => sum + u.cost, 0);

  // ----- the ledger on screen -----
  const total = rows.reduce((sum, u) => sum + u.cost, 0);
  const first = rows.reduce((acc, u) => Math.min(acc, u.at), Infinity);
  const days = Array.from({ length: DAYS }, (_, i) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (DAYS - 1 - i));
    const key = dayKey(date.getTime());
    return { key, date, cost: rows.filter((u) => u.day === key).reduce((sum, u) => sum + u.cost, 0) };
  });
  const sum14 = days.reduce((sum, d) => sum + d.cost, 0);
  const top = days.reduce((best, d) => (d.cost > best.cost ? d : best), days[0]!);
  const topAt = days.indexOf(top);
  const idle = days.filter((d) => d.cost === 0).length;
  const from = days[0]!.date;
  const range = t('{from} to {to}', { from: from.getMonth() === now.getMonth() ? String(from.getDate()) : dayAndMonth(from), to: dayAndMonth(now) });

  const stories = [...new Set(rows.map((u) => u.storyId))].map((id) => {
    const mine = rows.filter((u) => u.storyId === id);
    // Spending on a world (building it, proposing characters for it) is kept under "world:<its id>".
    const worldId = id.startsWith('world:') ? id.slice(6) : null;
    const worldName = worldId ? a.worlds.find((w) => w.id === worldId)?.world.name ?? a.drafts.find((d) => d.id === worldId)?.steps.skeleton?.name ?? null : null;
    return {
      id,
      world: worldId !== null,
      title: worldId !== null ? (worldName ? t('Building “{name}”', { name: worldName }) : t('Building a world no longer on this device')) : a.stories.find((s) => s.id === id)?.title ?? t('A story no longer on this device'),
      turns: mine.filter((u) => u.role === 'narrator').length, // the narrator writes once a turn
      cost: mine.reduce((sum, u) => sum + u.cost, 0),
    };
  }).sort((x, y) => y.cost - x.cost);
  const roles = ROLES.map((r) => {
    const mine = rows.filter((u) => u.role === r.id);
    return { ...r, cost: mine.reduce((sum, u) => sum + u.cost, 0), models: [...new Set(mine.map((u) => modelInfo(u.model).label))] };
  }).sort((x, y) => y.cost - x.cost);
  const widest = Math.max(...stories.map((s) => s.cost), ...roles.map((r) => r.cost), 0);

  const narrated = rows.filter((u) => u.role === 'narrator');
  const share = cacheShare(narrated);
  const saved = cacheSaving(rows);

  // ----- the last turn of the open story -----
  const session = a.session;
  const turn = session?.lastTurn ?? null;
  const turnRows = ROLES.map((r) => {
    const mine = (turn?.usage ?? []).filter((u) => u.role === r.id);
    const add = (f: (u: UsageEntry) => number) => mine.reduce((sum, u) => sum + f(u), 0);
    const priced = (f: (u: UsageEntry, mi: ReturnType<typeof modelInfo>) => number) => mine.reduce((sum, u) => sum + f(u, modelInfo(u.model)), 0) / 1_000_000;
    return {
      ...r, calls: mine.length, cost: add((u) => u.cost), models: [...new Set(mine.map((u) => modelInfo(u.model).label))],
      parts: [
        { label: m('read from the cache'), n: add((u) => u.cacheRead), cost: priced((u, mi) => u.cacheRead * mi.cacheRead) },
        { label: m('newly read'), n: add((u) => u.input), cost: priced((u, mi) => u.input * mi.input) },
        { label: m('written to the cache'), n: add((u) => u.cacheWrite5m + u.cacheWrite1h), cost: priced((u, mi) => (u.cacheWrite5m * CACHE_WRITE_5M + u.cacheWrite1h * CACHE_WRITE_1H) * mi.input) },
        { label: m('output'), n: add((u) => u.output), cost: priced((u, mi) => u.output * mi.output) },
      ].filter((p) => p.n > 0),
    };
  }).filter((r) => r.calls > 0);
  const turnDemo = (turn?.usage ?? []).some((u) => u.simulated);
  const turnShare = cacheShare((turn?.usage ?? []).filter((u) => u.role === 'narrator'));

  // ----- whose bill it is: the services that charged for what is counted here, else those the game is set to use -----
  const charged = SERVICES.filter((s) => real.some((u) => serviceOf(u.model) === s));
  const billers = charged.length > 0 ? charged : a.servicesInUse;
  const claudeOnly = billers.every((s) => s === 'anthropic');
  const asOf = part(new Date(`${PRICES_AS_OF}T12:00:00`), { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <LibraryPage page="usage" title={t('Usage')}>
      <div className="usg">
        <header className="page-h">
          <div>
            <h1 className="only-desktop">{t('Usage')}</h1>
            <p>{a.usage.length === 0 ? t('What your key is charged, by this app’s own count') : isDemo ? t('Demo estimates: what the chosen models would have cost. Nothing was charged') : t('What your key was charged, by this app’s own count')}</p>
          </div>
        </header>

        {a.usage.length === 0 ? (
          <section className="empty">
            <Icon name="chart" size={40} />
            <h2>{t('Nothing to show yet')}</h2>
            <p>{t('Every turn you play is counted here: what it cost, which story it belonged to and where the cost went. Play a turn and come back.')}</p>
            <a className="btn btn-primary btn-fit" href={href('')}>{t('Go to your stories')}</a>
          </section>
        ) : (
          <>
            {isDemo && (
              <div className="alert alert-warn">
                <Icon name="info" />
                <div className="grow">
                  <b>{t('These are demo estimates')}</b>
                  <p>{both
                    ? t('This view shows only the turns played with the demo narrator. Nothing was sent to any service and nothing was charged for them: the figures estimate what the same turns would have cost with the models chosen.')
                    : t('Every turn so far was played with the demo narrator. Nothing was sent to any service and nothing was charged: the figures estimate what the same turns would have cost with the models chosen.')}</p>
                  {a.keyed.length === 0 && <a className="link link-tap" href={href('welcome')}>{t('Add your API key to play for real')}<Icon name="right" size={14} strong /></a>}
                </div>
              </div>
            )}

            {both && (
              <div className="seg ledger" role="group" aria-label={t('Which figures to show')}>
                <button type="button" aria-pressed={!isDemo} onClick={() => setPick('real')}>{t('Charged to your key')}</button>
                <button type="button" aria-pressed={isDemo} onClick={() => setPick('demo')}>{t('Demo estimates')}</button>
              </div>
            )}

            {/* Totals */}
            <section className="tiles" aria-label={t('Totals')}>
              <div className="card tile today">
                <div className="today-h">
                  <span className="tile-k">{t('Today · {day}', { day: weekday(now) })}</span>
                  <a className="link link-tap" href={href('settings')}>{t('Change the limit')}</a>
                </div>
                <p><b className="tile-v">{money(spent, 2)}</b> <span className="tile-s"><T text="charged, of your <b>{limit}</b> daily limit" vars={{ limit: money(limit, 2) }} /></span></p>
                <div className={`budget${spent >= limit ? ' is-over' : ''}`}>
                  <div className="track" role="img" aria-label={t('{pct} of today’s limit used', { pct: pct(limit > 0 ? Math.min(1, spent / limit) : 0) })}><i style={bar(limit > 0 ? spent / limit : 0)} /></div>
                  <div className="between tile-s"><span><T text="<b>{amount}</b> left today" vars={{ amount: money(Math.max(0, limit - spent), 2) }} /></span><span>{t('Play pauses at {limit}', { limit: money(limit, 2) })}</span></div>
                </div>
                {demoToday > 0 && <p className="tile-s today-n"><T text="Demo turns today: <b>{amount}</b> estimated. Never charged, and not counted against the limit." vars={{ amount: money(demoToday) }} /></p>}
              </div>
              <div className="card tile">
                <span className="tile-k">{isDemo ? t('Last {days} days · estimate', { days: DAYS }) : t('Last {days} days', { days: DAYS })}</span>
                <b className="tile-v">{money(sum14)}</b>
                <span className="tile-s">{range}</span>
                <span className="tile-s only-desktop">{t('{played} with play, {idle} without', { played: tn(DAYS - idle, '{n} day', '{n} days'), idle })}</span>
              </div>
              <div className="card tile">
                <span className="tile-k">{isDemo ? t('All time · estimate') : t('All time')}</span>
                <b className="tile-v">{money(total)}</b>
                <span className="tile-s">{t('since {date}', { date: part(new Date(first), { day: 'numeric', month: 'long', year: 'numeric' }) })}</span>
                <span className="tile-s only-desktop">{t('{stories}, {turns}', { stories: tn(stories.length, '{n} story', '{n} stories'), turns: tn(narrated.length, '{n} turn', '{n} turns') })}</span>
              </div>
            </section>

            {/* Each day. One series; today is gold and is also named. Heights are a share of the largest day. */}
            <section className="card" aria-labelledby="usg-h-days">
              <div className="card-h">
                <h2 className="card-t" id="usg-h-days">{t('Each day')}</h2>
                <span className="t-sm t-2">{isDemo ? t('{range} · estimates', { range }) : t('{range} · charged', { range })}</span>
              </div>
              <div className="vbars days" role="img" aria-label={[
                isDemo ? t('Dollars estimated on each of the last {days} days.', { days: DAYS }) : t('Dollars charged on each of the last {days} days.', { days: DAYS }),
                top.cost > 0 ? t('The largest day was {day} with {amount}.', { day: weekday(top.date), amount: money(top.cost) }) : '',
                t('Today is {amount} so far.', { amount: money(days[DAYS - 1]!.cost) }),
                tn(idle, '{n} day had none.', '{n} days had none.'),
              ].filter(Boolean).join(' ')}>
                {days.map((d, i) => {
                  const today = i === DAYS - 1;
                  // On a phone only today and the largest day carry their figure, and the largest only when it is clear of today's.
                  const key = d.cost > 0 && (today || (d === top && i <= DAYS - 4));
                  const name = today ? t('Today') : i === 0 || d.date.getDate() === 1 ? `${d.date.getDate()} ${part(d.date, { month: 'short' })}` : String(d.date.getDate());
                  return (
                    <div key={d.key} className={`${d.cost === 0 ? 'zero ' : ''}${i % 2 === 0 && !today ? 'alt ' : ''}${key ? 'key ' : ''}${today ? 'is-now' : ''}`}>
                      <i style={bar(top.cost > 0 ? d.cost / top.cost : 0)}>{d.cost > 0 && <b>{onChart(d.cost)}</b>}</i>
                      <span>{name}</span>
                    </div>
                  );
                })}
              </div>
              <div className="chart-f">
                <p className="help">
                  {top.cost > 0 ? <><T text="Largest: {day}{now}, <b>{amount}</b>." vars={{ day: weekday(top.date), now: topAt === DAYS - 1 ? ` ${t('(today)')}` : '', amount: money(top.cost) }} />{' '}</> : `${isDemo ? t('Nothing estimated in these {days} days.', { days: DAYS }) : t('Nothing charged in these {days} days.', { days: DAYS })} `}
                  {idle > 0 && top.cost > 0 && tn(idle, 'Nothing on {n} day.', 'Nothing on {n} days.')}
                </p>
                <button className="link link-tap" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? t('Hide the list') : t('Show every day')}<Icon name={open ? 'up' : 'down'} size={14} strong /></button>
              </div>
              {open && (
                <div>
                  <ol className="daylist">
                    {days.map((d, i) => (
                      <li key={d.key} className={`${d.cost === 0 ? 'zero' : ''}${i === DAYS - 1 ? ' is-now' : ''}`}>
                        <span>{i === DAYS - 1 ? t('Today') : `${part(d.date, { weekday: 'short' })} ${d.date.getDate()} ${part(d.date, { month: 'short' })}`}</span><b>{money(d.cost)}</b>
                      </li>
                    ))}
                  </ol>
                  <div className="u-sum"><span>{isDemo ? t('{days} days, estimated', { days: DAYS }) : t('{days} days', { days: DAYS })}</span><b>{money(sum14)}</b></div>
                </div>
              )}
            </section>

            {/* Where it went. Both charts share one scale: the largest bar on the screen. */}
            <div className="grid grid-2">
              <section className="card by" aria-labelledby="usg-h-story">
                <div className="card-h"><h2 className="card-t" id="usg-h-story">{t('By story')}</h2><span>{isDemo ? t('All time · estimate') : t('All time')}</span></div>
                <div className="hbars">
                  {stories.map((s) => (
                    <div key={s.id} className="hbar">
                      <span>{s.title}<small>{s.world ? t('The world and its characters') : s.turns > 0 ? t('{turns} · {cost} a turn', { turns: tn(s.turns, '{n} turn', '{n} turns'), cost: exact(s.cost / s.turns) }) : tn(s.turns, '{n} turn', '{n} turns')}</small></span><b>{money(s.cost)}</b>
                      <div className="track"><i style={bar(widest > 0 ? s.cost / widest : 0)} /></div>
                    </div>
                  ))}
                </div>
                <div className="u-sum"><span>{tn(stories.length, '{n} story', '{n} stories')}</span><b>{money(total)}</b></div>
              </section>

              <section className="card by" aria-labelledby="usg-h-role">
                <div className="card-h"><h2 className="card-t" id="usg-h-role">{t('By role')}</h2><span>{isDemo ? t('All time · estimate') : t('All time')}</span></div>
                <div className="hbars">
                  {roles.map((r) => (
                    <div key={r.id} className="hbar">
                      <span>{t(r.label)}<small>{t(r.does)}{r.models.length ? ` · ${listOf(r.models)}` : ''}</small></span><b>{money(r.cost)}</b>
                      <div className="track"><i style={bar(widest > 0 ? r.cost / widest : 0)} /></div>
                    </div>
                  ))}
                </div>
                <div className="u-sum"><span>{t('All roles')}</span><b>{money(total)}</b></div>
              </section>
            </div>

            <div className="grid grid-2">
              {/* Why the numbers are small */}
              <section className="card" aria-labelledby="usg-h-cheap">
                <div className="card-h"><h2 className="card-t" id="usg-h-cheap">{t('How it stays cheap')}</h2></div>
                <div className="cache">
                  <b className="tile-v">{pct(share)}</b>
                  <p className="tile-s">{t('of what the narrator read came from the cache')}</p>
                  <div className="track track-l" role="img" aria-label={t('{pct} from the cache', { pct: pct(share) })}><i style={bar(share)} /></div>
                  <p className="tile-s">
                    {t('Text read from the cache costs a fraction of the usual price.')}
                    {saved >= 0.0001 && <>{' '}{isDemo ? <T text="Over all the roles that would have saved about <b>{amount}</b>." vars={{ amount: money(saved) }} /> : <T text="Over all the roles that saved about <b>{amount}</b>." vars={{ amount: money(saved) }} />}</>}
                  </p>
                </div>
                <ul className="why">
                  <li><Icon name="story" /><span><b>{t('Only the current scene is sent.')}</b>{t('Earlier scenes travel as a short summary, not word for word.')}</span></li>
                  <li><Icon name="dice" /><span><b>{t('The app does the dice and the sums.')}</b>{t('Rolls, damage and bookkeeping are worked out on this device and cost nothing.')}</span></li>
                  <li><Icon name="journal" /><span><b>{t('Summaries are written once, when a scene ends.')}</b>{t('The scribe does it, and the referee and the scribe can run on a cheaper model than the narrator.')}</span></li>
                </ul>
              </section>

              {/* The only place where tokens are named */}
              <section className="card" aria-labelledby="usg-h-turn">
                <div className="card-h"><h2 className="card-t" id="usg-h-turn">{t('The last turn, in detail')}</h2>{turn && turnDemo && <span className="tag tag-gold">{t('Demo estimate')}</span>}</div>
                {session && turn && turnRows.length > 0 ? (
                  <>
                    <p className="tile-s">{session.story.title} · {t('turn {n}', { n: turn.n })}{turnDemo ? ` · ${t('demo narrator, nothing was charged')}` : ''}</p>
                    <table className="tbl turn">
                      <thead><tr><th>{t('Turn {n}', { n: turn.n })}</th><th className="r">{t('Tokens')}</th><th className="r">{t('Cost')}</th></tr></thead>
                      {turnRows.map((r) => (
                        <tbody key={r.id}>
                          <tr className="tot"><td>{t(r.label)}{r.calls > 1 ? `, ${t('{n} calls', { n: r.calls })}` : ''} · {listOf(r.models)}</td><td className="r">{count(r.parts.reduce((sum, p) => sum + p.n, 0))}</td><td className="r">{exact(r.cost)}</td></tr>
                          {r.parts.map((p) => <tr key={p.label} className="part"><td>{t(p.label)}</td><td className="r">{count(p.n)}</td><td className="r">{exact(p.cost)}</td></tr>)}
                        </tbody>
                      ))}
                    </table>
                    <div className="turn-meter">
                      <div className="track track-l" role="img" aria-label={t('{pct} of what the narrator read on this turn came from the cache', { pct: pct(turnShare) })}><i style={bar(turnShare)} /></div>
                      <p className="tile-s"><T text="On this turn <b>{pct}</b> of what the narrator read came from the cache." vars={{ pct: pct(turnShare) }} /></p>
                    </div>
                    <div className="u-sum"><span>{turnDemo ? t('Estimated cost of the turn') : t('Cost of the turn')}</span><b>{exact(turn.cost)}</b></div>
                    <p className="tile-s">{t('Shown as {amount} while you play.', { amount: money(turn.cost, 3) })}</p>
                  </>
                ) : (
                  <p className="tile-s">{session ? t('This story has no turn to show yet. Play one and it is broken down here.') : t('Open a story and play a turn: it is broken down here, part by part.')}</p>
                )}
              </section>
            </div>
          </>
        )}

        {/* The authoritative bill: each service keeps its own. Claude's turns are priced with the table in Settings; the others with their own lists, or the cost the service reported. */}
        <div className="alert">
          <Icon name="info" />
          <div className="grow">
            <b>{claudeOnly
              ? t('Anthropic’s console has the authoritative bill.')
              : billers.length === 1
                ? t('{service}’s own account page has the authoritative bill.', { service: SERVICE_NAME[billers[0]!] })
                : t('Each service’s own account page has the authoritative bill: {services}.', { services: listOf(billers.map((s) => SERVICE_NAME[s])) })}</b>
            <p>{claudeOnly
              ? t('These figures are this app’s own count, made with the price table in Settings (prices as of {date}). Small differences are possible.', { date: asOf })
              : t('These figures are this app’s own count, made with the prices each service lists, or with what the service said a call cost. Small differences are possible.')}</p>
            {billers.includes('anthropic') && <a className="link link-tap" href={href('settings')}>{t('Open the price table')}<Icon name="right" size={14} strong /></a>}
          </div>
        </div>
      </div>
    </LibraryPage>
  );
}
