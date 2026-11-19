// People: everyone the protagonist knows, grouped by where they are right now. One line per person and
// no memories: this screen is for finding someone and choosing whom to spend time with. The memories
// are on the profile.
import { useState, type CSSProperties } from 'react';
import { STAGES, stageName } from '../../engine';
import type { Session } from '../../game/session';
import type { Person } from '../../game/types';
import { m, t, tn } from '../../i18n';
import { useApp } from '../app';
import { href } from '../router';
import { StoryPage } from '../Shell';
import { Avatar, BondBar, Icon, Modal } from '../ui';
import { KIND, cap, isHostile, isNamed, tone, whereabouts } from './Person';
import './people.css';

type Filter = 'all' | 'party' | 'pinned' | 'here' | 'elsewhere';
type GroupId = 'party' | 'here' | 'elsewhere' | 'heard' | 'gone';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: m('All') }, { id: 'party', label: m('Party') }, { id: 'pinned', label: m('Pinned') }, { id: 'here', label: m('Here') }, { id: 'elsewhere', label: m('Elsewhere') },
];
/** A group shows this many rows; the rest wait behind "Show N more". */
const GROUP_MAX = 6;

/** Where someone is relative to the protagonist, or null for people this screen leaves out. */
function groupOf(p: Person, here: string): GroupId | null {
  // Gone from the story: still listed when the protagonist knew them by name, for what was shared.
  if (p.placeId === 'nowhere') return p.met && p.count === 1 && p.tier !== 'extra' ? 'gone' : null;
  if (p.inParty) return 'party';
  if (p.placeId === here) return 'here';
  if (p.unknown) return null; // somebody the protagonist has never heard of
  if (p.tier === 'extra') return null; // unnamed extras somewhere else are nobody the protagonist knows
  return p.met ? 'elsewhere' : 'heard';
}

const rank = (p: Person): number => (p.tier === 'major' ? 0 : p.tier === 'recurring' ? 1 : 2);
/** Pinned people first, then by bond; people before crowds. */
const order = (a: Person, b: Person): number =>
  Number(b.pinned) - Number(a.pinned) || b.bond - a.bond || rank(a) - rank(b) || a.count - b.count || a.name.localeCompare(b.name);

function Card({ session, p, group }: { session: Session; p: Person; group: GroupId }) {
  const story = session.story;
  const named = isNamed(p);
  const present = group === 'party' || group === 'here';

  // One line: why they feel as they do, what they do in a fight (party), where they are (when not here).
  const facts: string[] = [];
  if (named && p.attitudeWhy && group !== 'heard') facts.push(p.attitudeWhy);
  if (group === 'party' && p.fight) facts.push(p.fight.fights ? t('fights beside you') : t('stays out of fights'));
  if (!present) facts.push(whereabouts(story, p, session.scene.placeId).text);
  const note = cap(facts.join(' · '));

  const body = (
    <>
      <div className="person-top">
        <Avatar person={p} size="l" pinned={named && p.pinned} />
        <div className="person-id">
          <div className="person-name">
            {p.name}
            {p.count > 1 && <span className="t-2 num">× {p.count}</span>}
            {named && p.pinned && <span className="pinned"><Icon name="star" size={12} fill />{t('Pinned')}</span>}
          </div>
          <div className="person-role">{named && p.kind !== 'friendship' && <><span className="ppl-kind">{cap(t(KIND[p.kind]))}</span> · </>}{p.role}</div>
        </div>
        <div className="bond">
          {!named ? (
            <span className="mood">{p.attitude}</span>
          ) : p.bond > 0 ? (
            <>
              <div className="bond-l"><b>{t(stageName(p.bond))}</b><span><b>{p.bond}</b>/100</span></div>
              <BondBar bond={p.bond} size="l" />
              <span className={`mood${isHostile(p) ? ' ppl-grief' : ''}`}>{p.attitude}</span>
            </>
          ) : group === 'heard' ? (
            <small>{t('Not met yet')}</small>
          ) : (
            <>
              <span className={`mood${isHostile(p) ? ' ppl-grief' : ''}`}>{p.attitude}</span>
              <small>{t('No bond yet')}</small>
            </>
          )}
        </div>
      </div>
      {note && <p className="person-note">{note}</p>}
      {named && p.grievance && (
        <p className="moment ppl-grief"><Icon name="warn" size={16} /><span><b>{t('Open grievance')}</b>{p.grievance}</span></p>
      )}
    </>
  );

  return (
    <article className={`person ${tone(p)}${p.pendingMoment ? ' is-focus' : ''}`}>
      {named ? <a className="ppl-link" href={href(`person/${encodeURIComponent(p.id)}`)}>{body}</a> : <div className="ppl-link">{body}</div>}
      {named && p.pendingMoment && (
        <div className="person-detail">
          <p className="moment">
            <Icon name="spark" size={16} fill />
            <span><b>{t('New stage: {stage}', { stage: t(p.pendingMoment) })}</b>{present
              ? t('{name} wants a moment with you. Give them some quiet time in the story and it will come.', { name: p.short })
              : t('{name} wants a moment with you. It comes when you are together again and give them some quiet time.', { name: p.short })}</span>
          </p>
        </div>
      )}
    </article>
  );
}

function BondsHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title={t('How bonds work')} onClose={onClose}>
      <p className="t-2">{t('A bond runs from 0 to 100. It measures trust and shared history: in practice, how far someone would go for you. Every 20 points is a stage.')}</p>
      <ul className="ppl-stages">
        {STAGES.slice(1).map((name, i) => (
          <li key={name}>
            <span className="bb bb-l" aria-hidden="true">{[0, 1, 2, 3, 4].map((k) => <i key={k} style={{ '--f': k <= i ? 1 : 0 } as CSSProperties} />)}</span>
            <b>{t(name)}</b>
            <span className="num">{i === 0 ? 1 : i * 20}–{i === 4 ? 100 : i * 20 + 19}</span>
          </li>
        ))}
      </ul>
      <div className="card stack-s">
        <p><b>{t('Most of a bond comes from a few acts that mattered.')}</b> <span className="t-2">{t('Small courtesies add a little and are capped each day.')}</span></p>
        <p><b>{t('What someone values counts for more.')}</b> <span className="t-2">{t('Half as much again when you act on it. Going against it costs bond, even if you meant well.')}</span></p>
        <p><b>{t('A new stage brings a moment.')}</b> <span className="t-2">{t('A scene with that person, played when you spend time together.')}</span></p>
        <p><b>{t('Someone you are Trusted by will travel with you.')}</b> <span className="t-2">{t('Ask them in the story, if your party has room. A companion stays behind when you tell them to, and comes back when asked.')}</span></p>
        <p><b>{t('Someone you are Close to may ask for your help.')}</b> <span className="t-2">{t('With something of their own, in the moment that stage brings. It becomes a thread in your journal.')}</span></p>
        <p><b>{t('A grievance holds a bond back.')}</b> <span className="t-2">{t('A betrayal or a broken promise is held against you: gains are halved and the next stage is out of reach, until you do something for them that matters. A companion who holds one and is no longer Friendly leaves.')}</span></p>
        <p><b>{t('Attitude is separate.')}</b> <span className="t-2">{t('It is how someone feels about you right now, and it can change within a scene.')}</span></p>
        <p><b>{t('There is no negative bond.')}</b> <span className="t-2">{t('An enemy has no bond and a hostile attitude.')}</span></p>
      </div>
    </Modal>
  );
}

export function People() {
  const a = useApp();
  const session = a.session;
  const [term, setTerm] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<GroupId[]>([]);
  const [help, setHelp] = useState(false);
  if (!session) return null;

  const story = session.story;
  const here = session.scene.placeId;
  const hereName = story.world.places[here]?.name;
  const everyone = Object.values(story.world.people)
    .map((p) => ({ p, group: groupOf(p, here) }))
    .filter((x): x is { p: Person; group: GroupId } => x.group !== null);

  const q = term.trim().toLowerCase();
  const shown = everyone.filter(({ p, group }) => {
    const inFilter = filter === 'all' || (filter === 'party' && group === 'party') || (filter === 'pinned' && p.pinned)
      || (filter === 'here' && (group === 'party' || group === 'here')) || (filter === 'elsewhere' && group === 'elsewhere');
    return inFilter && (!q || [p.name, p.short, p.role, ...p.aliases].some((s) => s.toLowerCase().includes(q)));
  });
  const groups: { id: GroupId; title: string }[] = [
    { id: 'party', title: t('With you') },
    { id: 'here', title: hereName ? t('In this scene · {place}', { place: hereName }) : t('In this scene') },
    { id: 'elsewhere', title: t('Elsewhere') },
    { id: 'heard', title: t('Heard of') },
    { id: 'gone', title: t('No longer around') },
  ];
  const named = everyone.filter((x) => isNamed(x.p)).length;
  const party = everyone.filter((x) => x.group === 'party').length;
  const toggle = (id: GroupId) => setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));

  return (
    <StoryPage page="people" title={t('People')}>
      <div className="ppl">
        <header className="page-h">
          <div>
            <h1 className="only-desktop">{t('People')}</h1>
            <p>{everyone.length === 0 ? t('Nobody yet') : t('{people} · {party} with you', { people: tn(named, '{n} person', '{n} people'), party })}</p>
          </div>
          <div className="inline">
            <button className="btn btn-quiet btn-fit" onClick={() => setHelp(true)}><Icon name="info" size={18} />{t('How bonds work')}</button>
          </div>
        </header>

        {everyone.length === 0 ? (
          <section className="empty">
            <Icon name="people" size={40} />
            <h2>{t('You have not met anyone yet')}</h2>
            <p>{t('Everyone you meet in the story appears here: companions, friends, family, rivals. You will see how well you know each of them, and why.')}</p>
            <a className="btn btn-primary btn-lg btn-fit" href={href('play')}>{t('Back to the story')}</a>
          </section>
        ) : (
          <>
            <div className="ppl-find">
              <div className="input-row">
                <span className="ppl-find-i" aria-hidden="true"><Icon name="search" size={20} /></span>
                <input className="input" type="text" inputMode="search" placeholder={t('Search by name or role')} aria-label={t('Search people')} autoComplete="off" value={term} onChange={(e) => setTerm(e.target.value)} />
              </div>
              <div className="chips" role="group" aria-label={t('Show')}>
                {FILTERS.map((f) => (
                  <button key={f.id} className="chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}><span>{t(f.label)}</span></button>
                ))}
              </div>
            </div>

            <div className="stack-l">
              {groups.map((g) => {
                const rows = shown.filter((x) => x.group === g.id).map((x) => x.p).sort(order);
                if (rows.length === 0) return null;
                const all = open.includes(g.id);
                const visible = all ? rows : rows.slice(0, GROUP_MAX);
                return (
                  <section key={g.id} className="sec">
                    <h2 className="grp"><span>{g.title}</span><span>{rows.length}</span></h2>
                    <div className="grid grid-2">
                      {visible.map((p) => <Card key={p.id} session={session} p={p} group={g.id} />)}
                    </div>
                    {rows.length > GROUP_MAX && (
                      <button className="btn btn-quiet btn-fit grp-more" onClick={() => toggle(g.id)} aria-expanded={all}>
                        {all ? t('Show fewer') : t('Show {n} more', { n: rows.length - GROUP_MAX })}<Icon name={all ? 'up' : 'down'} size={16} />
                      </button>
                    )}
                  </section>
                );
              })}
              {shown.length === 0 && (
                <div className="stack">
                  <p className="t-2">{t('Nobody matches. Try another name, or show everyone.')}</p>
                  <button className="btn btn-fit ppl-reset" onClick={() => { setTerm(''); setFilter('all'); }}>{t('Show everyone')}</button>
                </div>
              )}
            </div>
          </>
        )}

        {help && <BondsHelp onClose={() => setHelp(false)} />}
      </div>
    </StoryPage>
  );
}
