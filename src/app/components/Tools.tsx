// What the player can do around the story itself: tell the newest turn again, keep a line as true or
// say it is wrong, follow something that takes several efforts, and close a story that has ended. Every
// button that spends says what it costs.
import { useState, type CSSProperties } from 'react';
import { factsAbout } from '../../game/cards';
import { modelInfo } from '../../game/llm/models';
import { FACTS_MAX, type Session } from '../../game/session';
import { currentScene } from '../../game/story';
import type { Fact, Person, Story, Turn } from '../../game/types';
import { t } from '../../i18n';
import { useApp } from '../app';
import { downloadBook } from '../files';
import { go } from '../router';
import { T } from '../T';
import { Avatar, Icon, Modal, money, who } from '../ui';

/** What telling a turn again is expected to cost: what its last telling cost. */
function takeCost(turn: Turn): number {
  const told = turn.usage.filter((u) => u.role === 'narrator');
  return told[told.length - 1]?.cost ?? 0;
}

/** A price as a button shows it: free in the demo, under a cent, or about so much. */
export function usePrice(): (dollars: number) => string {
  const a = useApp();
  return (dollars) => (a.usingDemo ? t('free in the demo') : dollars < 0.005 ? t('under a cent') : t('about {price}', { price: money(dollars, 2) }));
}

// ---------- Another take ----------

/**
 * Under the newest turn, once it has been read: tell it again (the same dice and results, a new
 * telling), and, once there are several tellings, go back to another of them.
 */
export function TakeBar({ session }: { session: Session }) {
  const price = usePrice();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const turn = session.lastTurn;
  if (!turn || !turn.prep) return null;
  const block = session.retakeBlock;
  const takes = turn.takes ?? [turn.reply];
  const at = Math.max(0, takes.indexOf(turn.reply));
  const canTake = block === null;
  const canSwitch = takes.length > 1 && (block === null || block === 'brutal');
  if (!canTake && !canSwitch) return null;
  const cost = price(takeCost(turn));
  const again = () => { setAsking(false); void session.anotherTake(note); setNote(''); };
  return (
    <div className="take-bar" role="group" aria-label={t('This telling')}>
      {canSwitch && (
        <span className="take-nav">
          <button type="button" className="ib" disabled={at === 0} onClick={() => void session.useTake(at - 1)} aria-label={t('The telling before')}><Icon name="left" size={18} /></button>
          <span className="take-n">{t('Telling {n} of {total}', { n: at + 1, total: takes.length })}</span>
          <button type="button" className="ib" disabled={at >= takes.length - 1} onClick={() => void session.useTake(at + 1)} aria-label={t('The telling after')}><Icon name="right" size={18} /></button>
        </span>
      )}
      {canTake && (
        <>
          <button type="button" className="btn btn-quiet btn-fit take-go" onClick={() => void session.anotherTake()} title={t('The same dice and results, told again')}>
            <Icon name="refresh" size={16} />{t('Another take')}<span className="take-p">· {cost}</span>
          </button>
          <button type="button" className="ib take-note" onClick={() => setAsking(true)} aria-label={t('Another take, with a note on how to tell it')} title={t('Another take, with a note on how to tell it')}><Icon name="edit" size={16} /></button>
        </>
      )}
      {asking && (
        <Modal title={t('Another take')} onClose={() => setAsking(false)} foot={
          <button type="button" className="btn btn-primary" onClick={again}><Icon name="refresh" size={18} />{t('Tell it again')}<span className="take-p">· {cost}</span></button>
        }>
          <p className="help">{t('The same dice and the same results, told again. What you write here is a word on how it is told, and changes no result.')}</p>
          <div className="f">
            <label className="label" htmlFor="take-note">{t('How should it be told?')} <span className="t-2">· {t('optional')}</span></label>
            <textarea className="input" id="take-note" rows={3} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('For example: shorter; Mira would not laugh here; more about the room')} />
          </div>
          <p className="help">{t('Every telling is kept: you can go back to the first one afterwards.')}</p>
        </Modal>
      )}
    </div>
  );
}

// ---------- Keep this, and That's wrong ----------

/** A passage the player has picked in the log: its text and, for a spoken line, who spoke it. */
export interface Picked { n: number; i: number; text: string; who: string | null }

/** Under a picked passage: keep it as true, or say it is wrong. */
export function PassageBar({ onKeep, onWrong }: { onKeep: () => void; onWrong: () => void }) {
  return (
    <div className="pick-bar" role="group" aria-label={t('This passage')}>
      <button type="button" className="btn btn-fit" onClick={onKeep}><Icon name="pin" size={16} />{t('Keep this')}</button>
      <button type="button" className="btn btn-fit" onClick={onWrong}><Icon name="edit" size={16} />{t('That’s wrong')}</button>
    </div>
  );
}

/** Who and what a fact can be about, here: the story, the place, and the named people of the scene. */
function aboutChoices(story: Story): { id: string; label: string; person?: Person }[] {
  const scene = currentScene(story);
  const place = story.world.places[scene.placeId];
  const people = scene.cast.map((id) => story.world.people[id]).filter((p): p is Person => !!p && p.count === 1 && p.tier !== 'extra');
  return [
    { id: '', label: t('The story') },
    ...(place ? [{ id: place.id, label: place.name }] : []),
    ...people.map((p) => ({ id: p.id, label: p.short || p.name, person: p })),
  ];
}

/** A first guess at what a passage is about: who spoke it, else the first person of the scene it names, else the story. */
function guessAbout(story: Story, picked: Picked): string {
  if (picked.who && story.world.people[picked.who]) return picked.who;
  const text = picked.text.toLowerCase();
  const named = aboutChoices(story).find((c) => c.person && (text.includes(c.person.name.toLowerCase()) || text.includes((c.person.short || '').toLowerCase())));
  return named?.id ?? '';
}

/** Keep a passage as true, or correct it. The words are the player's to change. */
export function FactSheet({ session, picked, mode, onClose }: { session: Session; picked: Picked; mode: 'keep' | 'wrong'; onClose: () => void }) {
  const story = session.story;
  const [about, setAbout] = useState(() => guessAbout(story, picked));
  const [text, setText] = useState(mode === 'keep' ? picked.text.slice(0, FACTS_MAX.chars) : '');
  const [problem, setProblem] = useState<string | null>(null);
  const choices = aboutChoices(story);
  const save = () => {
    const why = session.keepFact(about, text, mode === 'wrong');
    if (why) setProblem(why); else onClose();
  };
  return (
    <Modal title={mode === 'keep' ? t('Keep this as true') : t('What is wrong?')} onClose={onClose} foot={
      <button type="button" className="btn btn-primary" disabled={!text.trim()} onClick={save}><Icon name={mode === 'keep' ? 'pin' : 'check'} size={18} />{mode === 'keep' ? t('Keep it') : t('Correct it')}</button>
    }>
      <p className="fact-intro">
        <Icon name="info" size={16} />
        <span>{mode === 'keep'
          ? t('Over a long story the narrator sees what happened long ago only as a short summary, so small details can drift: a name, a promise, the colour of a coat. What you keep here is given to the narrator whenever it applies, so it stays true for the rest of the story.')
          : t('When the story gets something wrong, such as a name, who was there or how someone looks, say what is true. It is kept like anything you keep as true, and the narrator goes on from your version.')}</span>
      </p>
      {mode === 'wrong' && <blockquote className="fact-quote">{picked.text}</blockquote>}
      <div className="f">
        <label className="label" htmlFor="fact-text">{mode === 'keep' ? t('What stays true') : t('What is true instead')}</label>
        <textarea className="input" id="fact-text" rows={3} maxLength={FACTS_MAX.chars} value={text} onChange={(e) => { setText(e.target.value); setProblem(null); }}
          placeholder={mode === 'keep' ? t('A line of the story, in as few words as it needs') : t('For example: Mira’s hair is red, not black')} />
        <p className="help">{t('{n} characters at most. Keep only what matters: each one is sent whenever it applies.', { n: FACTS_MAX.chars })}</p>
      </div>
      <div className="f">
        <span className="label" id="fact-about">{t('About')}</span>
        <div className="chips chips-wrap" role="group" aria-labelledby="fact-about">
          {choices.map((c) => (
            <button key={c.id || 'story'} type="button" className={`chip${c.person ? ` ${who(c.person)}` : ''}`} aria-pressed={about === c.id} onClick={() => setAbout(c.id)}>
              <span>{c.person ? <Avatar person={c.person} size="s" /> : <Icon name={c.id ? 'pin' : 'story'} size={14} />}{c.label}</span>
            </button>
          ))}
        </div>
        <p className="help">{about === '' ? t('Sent with every scene of the story.') : t('Sent whenever {name} is in the scene.', { name: choices.find((c) => c.id === about)?.label ?? '' })}</p>
      </div>
      {mode === 'wrong' && <p className="help">{t('The narrator is told at your next action and goes on from it without mentioning the mistake, and the record of this scene follows your correction.')}</p>}
      {problem && <p className="help t-err" role="alert">{problem}</p>}
    </Modal>
  );
}

/** What the player kept as true about someone, somewhere or the story, with a way to let each go. */
export function FactList({ session, story, about, empty }: { session: Session | null; story: Story; about: string; empty?: string }) {
  const facts: Fact[] = factsAbout(story, about, 99);
  if (!facts.length) return empty ? <p className="help">{empty}</p> : null;
  return (
    <ul className="fact-list">
      {facts.map((f) => (
        <li key={f.id}>
          <Icon name={f.fixed ? 'edit' : 'pin'} size={14} />
          <span className="grow">{f.text}<small>{f.fixed ? t('Corrected on day {n}', { n: f.day }) : t('Kept on day {n}', { n: f.day })}</small></span>
          {session && <button type="button" className="ib" onClick={() => session.dropFact(f.id)} aria-label={t('Let this go')}><Icon name="x" size={16} /></button>}
        </li>
      ))}
    </ul>
  );
}

/** Everything the player kept as true in a story, grouped by what it is about, each with a way to let it go. */
export function AllFacts({ session, story }: { session: Session | null; story: Story }) {
  const facts = story.facts ?? [];
  if (!facts.length) return <p className="help">{t('Nothing yet. Press a line of the story to keep it as true, or to say it is wrong.')}</p>;
  const groups = [...new Set(facts.map((f) => f.about))].sort((x, y) => (x === '' ? -1 : y === '' ? 1 : 0));
  const label = (about: string) => (about === '' ? t('The story') : story.world.people[about]?.name ?? story.world.places[about]?.name ?? about);
  return (
    <div className="stack-s">
      {groups.map((about) => (
        <div key={about || 'story'}>
          <p className="t-caps">{label(about)}</p>
          <FactList session={session} story={story} about={about} />
        </div>
      ))}
    </div>
  );
}

// ---------- Efforts that add up ----------

/** Something under way that takes several efforts: how far it has got, and a way to give it up. */
export function ContestBar({ session }: { session: Session }) {
  const c = session.story.contest;
  const [giving, setGiving] = useState(false);
  if (!c) return null;
  return (
    <div className="contest" role="status" aria-label={t('{label}: {wins} of {goal} won, {losses} of {limit} lost', { label: c.label, wins: c.wins, goal: c.goal, losses: c.losses, limit: c.limit })}>
      <Icon name="flag" size={16} />
      <span className="contest-l">{c.label}</span>
      <span className="contest-pips" aria-hidden="true">
        {Array.from({ length: c.goal }, (_, i) => <i key={`w${i}`} className={i < c.wins ? 'on' : ''} />)}
        <b>·</b>
        {Array.from({ length: c.limit }, (_, i) => <i key={`l${i}`} className={`x${i < c.losses ? ' on' : ''}`} />)}
      </span>
      <button type="button" className="link" disabled={session.busy} onClick={() => setGiving(true)}>{t('Give up')}</button>
      {giving && (
        <Modal title={t('Give up {label}?', { label: c.label })} onClose={() => setGiving(false)} foot={
          <button type="button" className="btn btn-primary" onClick={() => { session.giveUpContest(); setGiving(false); }}>{t('Give it up')}</button>
        }>
          <p>{t('It counts as lost. The narrator hears of it at your next action.')}</p>
        </Modal>
      )}
    </div>
  );
}

// ---------- The end of a story ----------

/** What writing the epilogue is expected to cost with the narrator's model: what it reads and what it writes. */
function epilogueCost(model: string): number {
  const m = modelInfo(model);
  return (2600 * m.input + (650 + (m.thinkingOff ? 0 : 500)) * m.output) / 1_000_000;
}

/** A story that has ended: its epilogue (written when asked), and what can come after. */
export function EndCard({ session }: { session: Session }) {
  const a = useApp();
  const price = usePrice();
  const story = session.story;
  const [saving, setSaving] = useState(false);
  const dead = story.over === 'dead';
  const ep = story.epilogue;
  const worldId = story.world.id;
  const canBegin = !!a.template(worldId);
  const book = async () => { setSaving(true); await downloadBook(story.id, story.title); setSaving(false); };
  const newHero = () => {
    if (ep?.legend) a.nextLegend = { worldId, text: ep.legend };
    go(`character-new/${worldId}`);
  };
  return (
    <section className="card end-card" aria-label={t('The end of the story')} style={{ '--i': 0 } as CSSProperties}>
      <header className="end-h">
        <Icon name="flag" size={22} />
        <div><p className="end-t">{dead ? t('{name} did not survive', { name: story.protagonist.name }) : t('The story has come to its end')}</p>
          <p className="end-s">{dead ? t('The whole story stays in your journal.') : story.season && story.season > 1 ? t('The end of season {n}.', { n: story.season }) : t('Its final chapter is over.')}</p></div>
      </header>
      {ep ? (
        <div className="end-ep">
          {ep.text.split(/\n\s*\n/).map((para, i) => <p key={i} className="narr">{para}</p>)}
          {ep.legend && <p className="end-legend">{ep.legend}</p>}
        </div>
      ) : (
        <button type="button" className="btn btn-primary" disabled={session.busy} onClick={() => void session.writeEpilogue()}>
          <Icon name="quill" size={18} />{session.busy ? t('Writing the epilogue…') : <>{t('Write the epilogue')}<span className="take-p">· {price(epilogueCost(a.models().narrator))}</span></>}
        </button>
      )}
      {!ep && <p className="help">{t('What became of you and of everyone who mattered, written once from what the story recorded.')}</p>}
      <div className="end-acts">
        <button type="button" className="btn" disabled={saving} onClick={() => void book()}><Icon name="journal" size={18} />{t('Read it as a book')}</button>
        {!dead && <button type="button" className="btn" disabled={session.busy} onClick={() => session.newSeason()}><Icon name="play" size={16} fill />{t('Go on: a new season')}</button>}
        {canBegin && <button type="button" className="btn" onClick={newHero}><Icon name="person" size={18} />{t('A new hero in this world')}</button>}
      </div>
      {!dead && <p className="help"><T text="<b>A new season</b> goes on with the same hero some time later, toward another ending. <b>A new hero</b> starts a new story in this world, where {name} is remembered." vars={{ name: story.protagonist.name }} /></p>}
    </section>
  );
}
