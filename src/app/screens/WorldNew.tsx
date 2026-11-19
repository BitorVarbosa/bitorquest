// A new world, in six steps: where it comes from, who you play, how the table runs, the builder's
// questions, the building itself, and the overview. From docs/mockups/slate/world-new.html.
//
// Nothing is asked of Claude before the player has seen what it costs: the questions say their price
// on their button, and the build says its price on its own. The build runs in the app, not in this
// screen, so leaving the screen does not stop it, and a draft is saved after every step.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { POWER_LEVELS, levelName } from '../../engine';
import { BUILD_STEPS, estimateBuild, type BuildInput, type StepId, type WorldBuilder } from '../../game/builder';
import { docRead, estimateReading, type DocState } from '../../game/ingest';
import { modelInfo } from '../../game/llm/models';
import { countsOf } from '../../game/world';
import { m, num, t, tn } from '../../i18n';
import { useApp } from '../app';
import { ENDING_DEFAULT, EndingChoice } from '../components/Ending';
import { STARTS, rollStart } from '../starts';
import { DOC_ACCEPT, openDocument } from '../documents';
import type { IconName } from '../icons';
import { go, href } from '../router';
import { FlowPage } from '../Shell';
import { T } from '../T';
import { Icon, Modal, money } from '../ui';
import './world-new.css';

type Step = 'source' | 'premise' | 'table' | 'questions' | 'building' | 'overview';
const ORDER: Step[] = ['source', 'premise', 'table', 'questions', 'building', 'overview'];
const NAMES: Record<Step, string> = { source: m('Source'), premise: m('Premise'), table: m('Table'), questions: m('Questions'), building: m('Building'), overview: m('Overview') };
const FORM = new Set<string>(['source', 'premise', 'table', 'questions']);
/** How long the player's own words may be. They are read only while the world is built (from the cache after the first step), never on a turn of play. */
const DESCRIPTION_MAX = 12000;
const PREMISE_MAX = 4000;

const STYLES = {
  story: { name: m('Story'), text: m('Defeat is a setback, never the end. Destiny points are generous. A failed roll becomes a success at a cost.') },
  adventure: { name: m('Adventure'), text: m('A death test is softened once per chapter. A few destiny points per chapter. Failure leaves a way forward.') },
  brutal: { name: m('Brutal'), text: m('Death is permanent. No destiny points. No rewinding.') },
} as const;
const POWERS = {
  off: { name: m('Off ((powers))'), text: m('No powers. People get by on skill, gear and nerve.') },
  focus: { name: m('Focus'), text: m('Six paths, each rated 0 to 5. Abilities are taught by people who trust you, or worked out by trying, and then learned.') },
  extreme: { name: m('Extreme'), text: m('Three broad schools of power, taken as advantages. Whoever has one commands everything in it, for as long as their energy lasts.') },
  gift: { name: m('Gift'), text: m('One power of your own, in your words, with a rank. Signature moves cost energy; new uses are tried, and kept when they work.') },
} as const;
const VIOLENCE = { mild: m('Mild'), moderate: m('Moderate'), graphic: m('Graphic') } as const;
const VIOLENCE_SUM = { mild: m('mild violence'), moderate: m('moderate violence'), graphic: m('graphic violence') } as const;
const LENGTHS = { short: m('Short'), medium: m('Medium'), long: m('Long') } as const;
const LENGTHS_SUM = { short: m('short passages'), medium: m('medium passages'), long: m('long passages') } as const;

/** "about $0.12"; anything under a cent is said as that. */
const about = (n: number): string => (n < 0.01 ? t('less than $0.01') : t('about {price}', { price: money(n, 2) }));
const cut = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : s);
const upper = (s: string): string => s[0]!.toUpperCase() + s.slice(1);

function blankInput(language: 'en' | 'pt'): BuildInput {
  return {
    source: { kind: 'description', text: '' }, premise: '', name: '',
    table: { style: 'adventure', powers: 'focus', companions: 2, romance: true, violence: 'moderate', leaveOut: '', language, narration: 'medium' },
  };
}

/** What a finished step made, in a line. */
function madeBy(step: StepId, b: WorldBuilder): string {
  const s = b.draft.steps;
  switch (step) {
    case 'skeleton': return s.skeleton ? t('{places} on the map and the ways between them', { places: tn(s.skeleton.regions.length, '{n} place', '{n} places') }) : '';
    case 'fronts': return s.fronts ? t('{things} in motion, kept hidden', { things: tn(s.fronts.fronts.length, '{n} thing', '{n} things') }) : '';
    case 'rules': {
      if (!s.rules) return '';
      const powers = b.draft.input.table.powers;
      const head = t('{powers}, {level} characters', { powers: powers === 'off' ? t('No powers') : t(POWERS[powers].name), level: t(levelName(s.rules.level)) });
      return s.rules.ancestries.length ? `${head}, ${tn(s.rules.ancestries.length + 1, '{n} ancestry', '{n} ancestries')}` : head;
    }
    case 'glossary': return s.glossary ? t('What the narrator always knows, and {powers} of the world', { powers: tn(s.glossary.factions.length, '{n} power', '{n} powers') }) : '';
    case 'start': return s.start ? t('{places} in {where}', { places: tn(s.start.places.length, '{n} place', '{n} places'), where: s.skeleton?.regions.find((r) => r.id === s.skeleton?.start)?.name ?? t('the starting place') }) : '';
    case 'people': return s.people ? `${t('{people} with names and wants', { people: tn(s.people.people.length, '{n} person', '{n} people') })}${s.people.crowds.length ? `, ${tn(s.people.crowds.length, '{n} group', '{n} groups')}` : ''}` : '';
    case 'seeds': return s.seeds ? t('{situations} waiting, and how the story opens', { situations: tn(s.seeds.seeds.length, '{n} situation', '{n} situations') }) : '';
  }
}

export function WorldNew({ id, step }: { id: string | null; step: string | null }) {
  const a = useApp();
  const builder = id ? a.builderFor(id) : null;
  const draft = builder?.draft ?? null;
  const [input, setInput] = useState<BuildInput>(() => (draft ? structuredClone(draft.input) : blankInput(a.settings.language)));
  const [other, setOther] = useState<Record<string, boolean>>({});
  const [spoilers, setSpoilers] = useState(false);
  const [again, setAgain] = useState<StepId | null>(null);
  // A document chosen in this visit: its text was taken out of the file on this device and waits here until the draft takes it.
  const [picked, setPicked] = useState<DocState | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [docNote, setDocNote] = useState<{ problem?: string; repeated?: number } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const doc: DocState | null = picked ?? draft?.document ?? null;

  // Where the flow stands. Once anything is built, or being built, the first four steps are behind us.
  // Reading a document and asking the questions both come before the build, and stay on the questions step.
  const early = (s: string | null | undefined) => s === 'questions' || s === 'reading';
  const underWay = !!builder && (builder.started || draft!.state === 'building' || draft!.state === 'paused' || (builder.busy && !early(builder.current)) || (draft!.state === 'failed' && !early(draft!.failed?.step)));
  const canGoBack = !!builder && !builder.started && !builder.busy;
  const at: Step = !builder ? 'source'
    : draft!.state === 'review' && !builder.busy ? 'overview'
      : underWay && !(canGoBack && step && FORM.has(step)) ? 'building'
        : step && FORM.has(step) ? (step as Step)
          : !draft!.document && !draft!.input.source.text.trim() ? 'source' : !draft!.input.premise.trim() ? 'premise' : draft!.questions || draft!.document ? 'questions' : 'table';
  const n = ORDER.indexOf(at) + 1;

  // Each step starts at the top of the page.
  useEffect(() => { document.querySelector('.page')?.scrollTo(0, 0); }, [at]);

  // A draft that is no longer there: it was accepted (the world has its id) or deleted.
  useEffect(() => {
    if (id && !builder) go(a.worlds.some((w) => w.id === id) ? `character-new/${id}` : 'worlds', true);
  }, [a.worlds, builder, id]);
  if (id && !builder) return null;

  const set = (patch: Partial<BuildInput>) => setInput((cur) => ({ ...cur, ...patch }));
  const setTable = (patch: Partial<BuildInput['table']>) => setInput((cur) => ({ ...cur, table: { ...cur.table, ...patch } }));

  /** Keep what was typed, and move to another of the first four steps. The first Continue makes the draft. */
  const move = (to: Step) => {
    const fromDoc = input.source.kind === 'document' ? doc : null;
    if (!builder) { const made = a.startDraft(input, undefined, fromDoc ?? undefined); setPicked(null); go(`world-new/${made.draft.id}?step=${to}`, true); return; }
    builder.setInput(input);
    // Another file was chosen since the draft was made: the draft takes it, and any notes from the old one go.
    if (picked && input.source.kind === 'document') { builder.setDocument(picked); setPicked(null); }
    go(`world-new/${builder.draft.id}?step=${to}`);
  };
  const choose = async (f: File | undefined) => {
    if (!f) return;
    setDocNote(null);
    setOpening(t('Opening {name}…', { name: f.name }));
    const got = await openDocument(f, (done, of) => setOpening(t('Taking the text out of {name}: page {done} of {total}', { name: f.name, done, total: of })));
    setOpening(null);
    if ('problem' in got) { setDocNote({ problem: got.problem }); return; }
    setPicked(got.doc);
    setDocNote({ repeated: got.repeated });
    set({ source: { kind: 'document', text: '', name: got.doc.name } });
  };
  const build = () => {
    if (!builder) return;
    builder.setInput(input);
    void builder.build();
    go(`world-new/${builder.draft.id}`, true);
  };

  const est = builder ? builder.estimate() : null;
  const models = a.models();
  const model = modelInfo(models.architect ?? models.narrator).label;
  const spent = builder?.spent ?? 0;
  const demo = a.usingDemo;
  const lines = input.source.text.trim().split('\n').filter((l) => l.trim()).length;
  const sourceOk = input.source.kind === 'document' ? !!doc && !opening : input.source.text.trim().length >= (input.source.kind === 'setting' ? 2 : 12);
  const scribe = modelInfo(models.scribe).label;
  const premiseOk = input.premise.trim().length >= 8;

  const summary = (
    <dl className="kv">
      <div><dt>{t('Source')}</dt><dd>{input.source.kind === 'document' ? t('A document: {name}', { name: doc?.name ?? input.source.name ?? '' }) : input.source.kind === 'setting' ? t('A setting you named: {text}', { text: cut(input.source.text.trim(), 60) }) : t('Your description, {lines}', { lines: tn(lines, '{n} line', '{n} lines') })}</dd></div>
      <div><dt>{t('You play')}</dt><dd>{cut(input.premise.trim(), 90) || '—'}</dd></div>
      <div><dt>{t('Table style')}</dt><dd>{t(STYLES[input.table.style].name)}</dd></div>
      <div><dt>{t('Powers')}</dt><dd>{t(POWERS[input.table.powers].name)}</dd></div>
      <div><dt>{t('Tone')}</dt><dd>{input.table.romance ? t('Romance on') : t('Romance off')} · {t(VIOLENCE_SUM[input.table.violence])}</dd></div>
      <div><dt>{t('Told in')}</dt><dd>{input.table.language === 'pt' ? 'Português' : 'English'} · {t(LENGTHS_SUM[input.table.narration])}</dd></div>
      <div><dt>{t('Companions')}</dt><dd>{input.table.companions === 0 ? t('None') : t('Up to {n}', { n: input.table.companions })}</dd></div>
    </dl>
  );
  const priceNote = demo
    ? <T text="With the demo builder <b>nothing is charged</b>, and the world is the same canned one whatever you describe. With your own key, Claude builds the world you asked for." />
    : null;

  // ---------- The foot: the buttons that move the flow on ----------
  let foot: ReactNode;
  if (at === 'source') {
    foot = <><a className="btn" href={href('worlds')}>{t('Cancel')}</a><button className="btn btn-primary" disabled={!sourceOk} onClick={() => move('premise')}>{t('Continue')}<Icon name="arrow" size={18} /></button></>;
  } else if (at === 'premise') {
    foot = <><button className="btn" onClick={() => move('source')}>{t('Back')}</button><button className="btn btn-primary" disabled={!premiseOk} onClick={() => move('table')}>{t('Continue')}<Icon name="arrow" size={18} /></button></>;
  } else if (at === 'table') {
    foot = <><button className="btn" onClick={() => move('premise')}>{t('Back')}</button><button className="btn btn-primary" onClick={() => move('questions')}>{t('Continue')}<Icon name="arrow" size={18} /></button></>;
  } else if (at === 'questions') {
    foot = <><button className="btn" disabled={builder?.busy} onClick={() => move('table')}>{t('Back')}</button><button className="btn btn-primary" disabled={!builder || builder.busy || builder.unread || !sourceOk || !premiseOk} onClick={build}>{t('Build the world')}{est ? ` · ${demo ? t('free in the demo') : about(est.typical)}` : ''}</button></>;
  } else if (at === 'building' && builder) {
    const stopped = !builder.busy;
    foot = (
      <>
        {canGoBack && <button className="btn" onClick={() => go(`world-new/${builder.draft.id}?step=questions`)}>{t('Back')}</button>}
        {stopped
          ? <button className="btn" onClick={() => void builder.build()}><Icon name="play" size={14} fill />{draft?.state === 'failed' ? t('Try again') : t('Resume')}</button>
          : <button className="btn" disabled={builder.pausing} onClick={() => builder.pause()}>{builder.pausing ? t('Pausing…') : t('Pause')}</button>}
        <button className="btn btn-primary" disabled>{t('Review the world')}</button>
      </>
    );
  } else {
    const ready = !!builder && builder.problems().length === 0;
    foot = (
      <>
        <a className="btn" href={href('worlds')}>{t('Save for later')}</a>
        <button className="btn btn-primary" disabled={!ready} onClick={() => { const w = a.acceptWorld(builder!.draft.id); if (w) go(`character-new/${w.id}`); }}>{t('Accept and create the character')}</button>
      </>
    );
  }

  return (
    <FlowPage title={t('New world')} sub={t('Step {n} of 6', { n })} back="worlds" foot={foot} className="wn">
      <div className="flow-steps" role="img" aria-label={t('Step {n} of 6: {name}', { n, name: t(NAMES[at]).toLowerCase() })}>
        {ORDER.map((s, i) => <i key={s} className={i < n ? 'on' : undefined} />)}<span>{t(NAMES[at])}</span>
      </div>

      {/* ============ 1. Source ============ */}
      {at === 'source' && (
        <section className="wn-step">
          <header className="page-h"><div>
            <h1>{t('Where does the world come from?')}</h1>
            <p>{t('Choose one. Nothing is spent until you agree to the price in step 4.')}</p>
          </div></header>
          <div className="split stack-l">
            <div className="stack-l">
              <div className="stack-s" role="group" aria-label={t('Where the world comes from')}>
                <Choice on={input.source.kind === 'description'} onClick={() => set({ source: { kind: 'description', text: input.source.kind === 'description' ? input.source.text : '' } })} title={t('Describe it')} text={t('In your own words, as much as you like.')} />
                <Choice on={input.source.kind === 'setting'} onClick={() => set({ source: { kind: 'setting', text: input.source.kind === 'setting' ? input.source.text : '' } })} title={t('A setting you already know')} text={t('A book, game, film or show Claude knows.')} />
                <Choice on={input.source.kind === 'document'} onClick={() => set({ source: { kind: 'document', text: '', ...(doc ? { name: doc.name } : {}) } })} title={t('A document')} text={t('Your own notes or a setting book: a text, Markdown or PDF file.')} />
              </div>
              <input ref={file} type="file" accept={DOC_ACCEPT} hidden onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ''; }} />
              {input.source.kind === 'document' ? (
                <div className="stack">
                  {doc ? (
                    <div className="wn-file">
                      <span className="wn-file-i" aria-hidden="true"><Icon name="doc" size={22} /></span>
                      <div className="grow">
                        <p className="wn-file-n cut">{doc.name}</p>
                        <p className="wn-file-s"><span>{doc.pages ? `${tn(doc.pages, '{n} page', '{n} pages')} · ` : ''}{t('{words} words', { words: num(doc.words) })}</span><span className="wn-found"><Icon name="check" size={14} strong className="t-ok" />{t('text found')}</span></p>
                      </div>
                      {!builder?.started && <button type="button" className="btn btn-fit" onClick={() => file.current?.click()}>{t('Choose another')}</button>}
                    </div>
                  ) : (
                    <button type="button" className="btn wn-pick" disabled={!!opening} onClick={() => file.current?.click()}><Icon name="upload" size={18} />{opening ?? t('Choose a file')}</button>
                  )}
                  {opening && doc && <p className="help" role="status">{opening}</p>}
                  {docNote?.problem && <div className="alert alert-err" role="alert"><Icon name="warn" /><div><b>{t('That file cannot be used')}</b><p>{docNote.problem}</p></div></div>}
                  {doc && !docRead(doc) && (
                    <p className="wn-price"><Icon name="coins" size={18} /><span>{demo
                      ? t('With the demo, reading it costs nothing: the demo reader does not really read, and the world built is the same as always.')
                      : <T text="Reading it will cost <b>{price}</b>, once, with {scribe}. Building the world from the notes then costs {more} more." vars={{ price: about(estimateReading(doc, models)), scribe, more: about(estimateBuild(models, false, undefined, input.table.powers).typical) }} />}</span></p>
                  )}
                  {draft?.document && !picked && (draft.document.digest !== null || draft.document.notes.length > 0) && <p className="help">{draft.document.digest !== null ? t('This document has been read. Choosing another file, or another kind of source, drops the notes taken from it: reading again would cost again.') : t('This document has been read in part. Choosing another file, or another kind of source, drops the notes taken from it: reading again would cost again.')}</p>}
                  {doc && doc.leftOut > 0 && <p className="help">{t('This document is longer than the app reads in one go: the last {thousands} thousand characters are left out.', { thousands: num(Math.round(doc.leftOut / 1000)) })}</p>}
                  <p className="help">{t('The text is taken out of the file on this device.')} {docNote?.repeated ? t('What repeats from page to page (running heads, page numbers, a buyer’s stamp) was left out in {places} places, and so is every e-mail address.', { places: num(docNote.repeated) }) : t('What repeats on every page, such as running heads and a buyer’s stamp, is left out, and so is every e-mail address.')} {t('It is read once, and only the notes made from it are kept, not the document.')}</p>
                </div>
              ) : input.source.kind === 'description' ? (
                <div className="f">
                  <label className="label" htmlFor="wn-desc">{t('Your description')}</label>
                  {/* An empty page: a few worlds to begin from, or one rolled from four parts. Nothing is spent. */}
                  {!input.source.text.trim() && (
                    <div className="seeds">
                      <div className="seeds-row" role="group" aria-label={t('Start from')}>
                        <button type="button" className="chip" onClick={() => set({ source: { kind: 'description', text: rollStart() } })}><span><Icon name="dice" size={14} />{t('Roll one')}</span></button>
                        {STARTS.map((s0) => <button key={s0.name} type="button" className="chip" onClick={() => set({ source: { kind: 'description', text: t(s0.text) } })}><span>{t(s0.name)}</span></button>)}
                      </div>
                      <p className="help">{t('Or begin from one of these and make it yours: they only fill the box.')}</p>
                    </div>
                  )}
                  <textarea className="input wn-auto" id="wn-desc" rows={8} maxLength={DESCRIPTION_MAX} value={input.source.text} onChange={(e) => set({ source: { kind: 'description', text: e.target.value } })}
                    placeholder={t('What the place is like, who holds power, what people want.\nWhat makes it different.\nWhat kind of stories it is for.')} />
                  <p className="help">{t('A few lines are enough, and you can write as much as you like. Say what makes the world different and what kind of stories it is for.')}</p>
                  {input.source.text.trim() && <button type="button" className="link link-tap" onClick={() => set({ source: { kind: 'description', text: rollStart() } })}><Icon name="dice" size={14} />{t('Roll another')}</button>}
                </div>
              ) : (
                <div className="f">
                  <label className="label" htmlFor="wn-known">{t('Name a book series, game, film or show Claude would know')}</label>
                  <input className="input" id="wn-known" type="text" maxLength={200} placeholder={t('The name of the setting')} autoComplete="off" value={input.source.text} onChange={(e) => set({ source: { kind: 'setting', text: e.target.value } })} />
                  <p className="help">{t('Claude builds from what it already knows of the setting. Say which era or version you mean if it matters; the world builder can also ask.')}</p>
                </div>
              )}
            </div>
            <aside className="card wn-side">
              <div className="card-h"><span className="card-t"><Icon name="info" size={16} />{t('How it works')}</span></div>
              <ol className="wn-how">
                <li><b>{t('You say what you want')}</b>{t('The world, who you play in it, and how the table runs.')}</li>
                <li><b>{t('The world builder can ask a few questions')}</b>{t('Then it shows the price. Nothing is spent before you agree.')}</li>
                <li><b>{t('It builds the world')}</b>{t('Step by step, in about a minute. You read it through before you accept it.')}</li>
              </ol>
              <p className="wn-aside-f">{priceNote ?? <T text="With {model}, a world costs <b>{price}</b> to build, once. Every story you start in it afterwards reuses it." vars={{ model, price: about(estimateBuild(models, false, undefined, input.table.powers).typical) }} />}</p>
            </aside>
          </div>
        </section>
      )}

      {/* ============ 2. Premise ============ */}
      {at === 'premise' && (
        <section className="wn-step">
          <header className="page-h"><div>
            <h1>{t('Who do you play?')}</h1>
            <p>{t('One or two sentences. You build the character itself after the world.')}</p>
          </div></header>
          <div className="split stack-l">
            <div className="stack-l">
              <div className="f">
                <label className="label" htmlFor="wn-prem">{t('Your character, in a sentence')}</label>
                <textarea className="input wn-auto" id="wn-prem" rows={3} maxLength={PREMISE_MAX} value={input.premise} onChange={(e) => set({ premise: e.target.value })} placeholder={t('Who they are, what they do, and what has just landed in their lap.')} />
                <p className="help">{t('This decides where detail is spent. The places, people and trouble closest to your character are built first and in most depth.')}</p>
              </div>
              <div className="f">
                <label className="label" htmlFor="wn-name">{t('Name')} <span className="t-2" style={{ fontWeight: 400 }}>· {t('optional')}</span></label>
                <input className="input" id="wn-name" type="text" maxLength={40} autoComplete="off" value={input.name} onChange={(e) => set({ name: e.target.value })} />
                <p className="help">{t('Leave it empty and a name that fits the world is suggested when you create the character.')}</p>
              </div>
            </div>
            <aside className="card wn-side">
              <div className="card-h"><span className="card-t"><Icon name="info" size={16} />{t('What your answer changes')}</span></div>
              <ul className="wn-points">
                <Point icon="pin" title={t('Where the story starts')}>{t('The place your character belongs to is the one built in full.')}</Point>
                <Point icon="people" title={t('Who you meet first')}>{t('The people around that life get names, wants and secrets.')}</Point>
                <Point icon="flag" title={t('What trouble is nearby')}>{t('Situations are planted around what your character does.')}</Point>
              </ul>
              <p className="wn-aside-f">{t('The rest of the world stays a sketch until a story goes there, so you never pay for places you do not visit.')}</p>
            </aside>
          </div>
        </section>
      )}

      {/* ============ 3. Table ============ */}
      {at === 'table' && (
        <section className="wn-step">
          <header className="page-h"><div>
            <h1>{t('How do you want to play?')}</h1>
            <p>{t('What a table agrees on before the first session. Each story can change these later, except powers.')}</p>
          </div></header>
          <div className="grid grid-2 wn-cols">
            <div>
              <div className="card wn-set">
                <div className="card-h"><span className="card-t"><Icon name="dice" size={16} />{t('Table style')}</span></div>
                <div className="stack-s" role="group" aria-label={t('Table style')}>
                  {(['story', 'adventure', 'brutal'] as const).map((k) => <Choice key={k} on={input.table.style === k} onClick={() => setTable({ style: k })} title={t(STYLES[k].name)} text={t(STYLES[k].text)} />)}
                </div>
              </div>
              <div className="card wn-set">
                <div className="card-h"><span className="card-t"><Icon name="spark" size={16} />{t('Powers')}</span><span className="tag">{t('Fixed once the world is built')}</span></div>
                <div className="f">
                  {/* Four ways of having powers: side by side where there is room, two rows of two on a phone. */}
                  <div className="wn-pow" role="group" aria-label={t('Powers')}>
                    {(['off', 'focus', 'extreme', 'gift'] as const).map((k) => (
                      <button key={k} type="button" aria-pressed={input.table.powers === k} onClick={() => setTable({ powers: k })}>{t(POWERS[k].name)}</button>
                    ))}
                  </div>
                  <p className="help">{t(POWERS[input.table.powers].text)}</p>
                </div>
              </div>
              <div className="card wn-set">
                <div className="card-h"><span className="card-t"><Icon name="flag" size={16} />{t('How stories end')}</span></div>
                <EndingChoice id="wn-end" ending={input.table.ending ?? ENDING_DEFAULT.ending} length={input.table.length ?? ENDING_DEFAULT.length} onChange={(patch) => setTable(patch)} />
                <p className="help">{t('The default for stories in this world. Each story can choose otherwise when it begins, and change it later.')}</p>
              </div>
              <div className="card wn-set">
                <div className="card-h"><span className="card-t"><Icon name="people" size={16} />{t('Companions')}</span></div>
                <div className="wn-opt">
                  <div className="grow"><span className="label" id="wn-l-comp">{t('Travelling with you')}</span><p className="help">{t('How many people can be in your party at once, from 0 to 3.')}</p></div>
                  <span className="stepper" role="group" aria-labelledby="wn-l-comp">
                    <button type="button" disabled={input.table.companions <= 0} onClick={() => setTable({ companions: input.table.companions - 1 })} aria-label={t('One fewer')}><Icon name="minus" size={18} /></button>
                    <b>{input.table.companions}</b>
                    <button type="button" disabled={input.table.companions >= 3} onClick={() => setTable({ companions: input.table.companions + 1 })} aria-label={t('One more')}><Icon name="plus" size={18} /></button>
                  </span>
                </div>
              </div>
            </div>
            <div>
              <div className="card wn-set">
                <div className="card-h"><span className="card-t"><Icon name="heart" size={16} />{t('Tone and content')}</span></div>
                <div className="wn-opt">
                  <div className="grow"><span className="label" id="wn-l-rom">{t('Romance')}</span><p className="help">{t('Characters decide for themselves whether they return it. Never with minors.')}</p></div>
                  <button type="button" className="switch" role="switch" aria-checked={input.table.romance} aria-labelledby="wn-l-rom" onClick={() => setTable({ romance: !input.table.romance })} />
                </div>
                <div className="f">
                  <span className="label">{t('Violence')}</span>
                  <div className="seg" role="group" aria-label={t('Violence')}>
                    {(['mild', 'moderate', 'graphic'] as const).map((k) => <button key={k} type="button" aria-pressed={input.table.violence === k} onClick={() => setTable({ violence: k })}>{t(VIOLENCE[k])}</button>)}
                  </div>
                </div>
                <div className="f">
                  <label className="label" htmlFor="wn-leave">{t('Leave out')}</label>
                  <input className="input" id="wn-leave" type="text" maxLength={200} placeholder={t('For example: spiders, harm to animals')} autoComplete="off" value={input.table.leaveOut} onChange={(e) => setTable({ leaveOut: e.target.value })} />
                  <p className="help">{t('Anything the story should never include, in your own words.')}</p>
                </div>
              </div>
              <div className="card wn-set">
                <div className="card-h"><span className="card-t"><Icon name="story" size={16} />{t('Narration')}</span></div>
                <div className="f">
                  <span className="label">{t('Story language')}</span>
                  <div className="seg" role="group" aria-label={t('Story language')}>
                    <button type="button" aria-pressed={input.table.language === 'en'} onClick={() => setTable({ language: 'en' })}>English</button>
                    <button type="button" aria-pressed={input.table.language === 'pt'} onClick={() => setTable({ language: 'pt' })}>Português</button>
                  </div>
                  <p className="help">{t('The world is written in this language too.')}</p>
                </div>
                <div className="f">
                  <span className="label">{t('Narration length')}</span>
                  <div className="seg" role="group" aria-label={t('Narration length')}>
                    {(['short', 'medium', 'long'] as const).map((k) => <button key={k} type="button" aria-pressed={input.table.narration === k} onClick={() => setTable({ narration: k })}>{t(LENGTHS[k])}</button>)}
                  </div>
                  <p className="help">{t('Longer passages cost more per turn.')}</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ============ 4. Questions ============ */}
      {at === 'questions' && builder && draft && (
        <section className="wn-step">
          <header className="page-h"><div>
            <h1>{builder.unread ? t('First, your document is read') : t('A few questions before I build it')}</h1>
            <p>{builder.unread ? t('Once, before anything is asked or built. The world is then built from the notes taken from it.') : draft.document ? t('The world builder asks at most five, about what your document leaves open. You can skip them.') : t('The world builder asks at most five, about what your description leaves open. You can skip them.')}</p>
          </div></header>
          <div className="split stack-l">
            <div className="stack">
              {draft.document && <Reading builder={builder} demo={demo} scribe={scribe} />}
              {builder.unread ? null : builder.current === 'questions' ? (
                <div className="card wn-wait" role="status"><i className="wn-spin" aria-hidden="true" /><span>{t('Reading what you wrote and thinking of questions…')}</span></div>
              ) : draft.failed?.step === 'questions' ? (
                <div className="alert alert-err" role="alert">
                  <Icon name="warn" />
                  <div className="stack-s grow">
                    <div><b>{t('The questions could not be asked')}</b><p>{draft.failed.message} {t('Nothing was spent.')}</p></div>
                    <div className="inline">
                      <button className="btn btn-fit" onClick={() => { builder.setInput(input); void builder.ask(); }}>{t('Try again')}</button>
                      <button className="btn btn-quiet btn-fit" onClick={() => builder.skipQuestions()}>{t('Build without them')}</button>
                    </div>
                  </div>
                </div>
              ) : !draft.questions ? (
                <div className="card stack">
                  <p>{t('The questions are about things that would change what is built: how common something is, what someone is like, how dangerous the roads are. Each comes with suggested answers.')}</p>
                  <div className="inline">
                    <button className="btn btn-primary btn-fit" onClick={() => { builder.setInput(input); void builder.ask(); }}>{t('Ask me')}{demo ? '' : ` · ${about(builder.estimateQuestions())}`}</button>
                    <button className="btn btn-fit" onClick={() => { builder.setInput(input); builder.skipQuestions(); }}>{t('Skip the questions')}</button>
                  </div>
                  <p className="t-sm t-2">{demo ? t('The demo builder asks the same three questions every time, and nothing is charged.') : t('Asking is a small request of its own. Skipped, the world builder decides these things itself.')}</p>
                </div>
              ) : draft.questions.skipped ? (
                <div className="alert">
                  <Icon name="info" />
                  <div className="grow">
                    <b>{t('Questions skipped')}</b>
                    <p>{draft.questions.list.length === 0 ? t('The world builder will decide the open points itself, in keeping with your description.') : draft.questions.list.length === 1 ? t('The world builder will decide this one thing itself, in keeping with your description.') : t('The world builder will decide these {n} things itself, in keeping with your description.', { n: draft.questions.list.length })}</p>
                    {draft.questions.list.length > 0
                      ? <button type="button" className="link link-tap" onClick={() => builder.skipQuestions(false)}>{t('Answer them after all')}</button>
                      : <button type="button" className="link link-tap" onClick={() => { builder.setInput(input); void builder.ask(); }}>{t('Ask me after all')}{demo ? '' : ` · ${about(builder.estimateQuestions())}`}</button>}
                  </div>
                </div>
              ) : draft.questions.list.length === 0 ? (
                <div className="alert alert-ok"><Icon name="ok-circle" /><div><b>{t('Nothing to ask')}</b><p>{t('Your description settles what matters. The world can be built as it stands.')}</p></div></div>
              ) : (
                <>
                  {draft.questions.list.map((q, i) => {
                    const answer = draft.questions!.answers[q.id] ?? '';
                    const typed = other[q.id] ?? (!!answer && !q.options.includes(answer));
                    return (
                      <div key={q.id} className="card wn-q">
                        <p className="wn-q-k">{t('Question {n} of {total}', { n: i + 1, total: draft.questions!.list.length })}</p>
                        <h2>{q.question}</h2>
                        <div className="chips wn-wrap" role="group" aria-label={q.question}>
                          {q.options.map((o) => (
                            <button key={o} type="button" className="chip" aria-pressed={!typed && answer === o} onClick={() => { setOther((cur) => ({ ...cur, [q.id]: false })); builder.answer(q.id, !typed && answer === o ? '' : o); }}><span>{o}</span></button>
                          ))}
                          <button type="button" className="chip" aria-pressed={typed} onClick={() => { setOther((cur) => ({ ...cur, [q.id]: !typed })); builder.answer(q.id, ''); }}><span><Icon name="edit" size={14} />{t('Something else…')}</span></button>
                        </div>
                        {typed && <input className="input" type="text" maxLength={160} autoFocus aria-label={t('Your own answer to: {question}', { question: q.question })} placeholder={t('In your own words')} value={answer} onChange={(e) => builder.answer(q.id, e.target.value)} />}
                      </div>
                    );
                  })}
                  <div className="inline">
                    <button type="button" className="link link-tap" onClick={() => builder.skipQuestions()}>{t('Skip the questions')}</button>
                    <span className="t-sm t-2">{t('A question left unanswered is decided by the world builder.')}</span>
                  </div>
                </>
              )}
            </div>
            <aside className="card wn-side">
              <div className="card-h"><span className="card-t"><Icon name="doc" size={16} />{t('What will be built')}</span></div>
              {summary}
              <p className="wn-aside-f">
                {demo
                  ? priceNote
                  : est && <><T text="<b>{price}</b> to build with {model}, somewhere between {low} and {high}." vars={{ price: upper(about(est.typical)), model, low: money(est.low, 2), high: money(est.high, 2) }} />{' '}{spent > 0 ? t('{spent} has gone on the questions.', { spent: money(spent, 3) }) : t('Nothing has been spent yet.')} {t('The button below is where you agree to it.')}</>}
              </p>
            </aside>
          </div>
        </section>
      )}

      {/* ============ 5. Building ============ */}
      {at === 'building' && builder && draft && est && (() => {
        const prog = builder.progress;
        const done = prog.filter((p) => p.state === 'done').length;
        const next = builder.next;
        const nextAt = prog.findIndex((p) => p.id === next);
        const failed = draft.state === 'failed' ? draft.failed : undefined;
        return (
          <section className="wn-step">
            <header className="page-h"><div>
              <h1>{t('Building your world')}</h1>
              <p>{t('About a minute, in seven steps.')}</p>
            </div></header>
            <div className="split stack-l">
              <div className="stack">
                {failed && (
                  <div className="alert alert-err" role="alert">
                    <Icon name="warn" />
                    <div className="stack-s grow">
                      <div>
                        <b>{failed.kind === 'budget' ? t('Today’s spending limit is reached') : failed.kind === 'unusable' ? t('This step came back unusable twice') : failed.kind === 'auth' ? t('The API key was not accepted') : failed.kind === 'offline' ? t('You seem to be offline') : t('This step did not go through')}</b>
                        <p>{failed.message} {done === 0 ? t('Nothing has been built yet.') : done === 1 ? t('The step already built is kept, and you are not charged for it again.') : t('The {n} steps already built are kept, and you are not charged for them again.', { n: done })}</p>
                      </div>
                      <div className="inline">
                        <button className="btn btn-fit" onClick={() => void builder.build()}><Icon name="refresh" size={18} />{t('Try this step again')}</button>
                        {failed.kind === 'budget' && <a className="btn btn-quiet btn-fit" href={href('settings')}>{t('Change the limit')}</a>}
                        {failed.kind === 'auth' && <a className="btn btn-quiet btn-fit" href={href('welcome')}>{t('Check the key')}</a>}
                      </div>
                    </div>
                  </div>
                )}
                <div className="card stack">
                  <div className="budget">
                    <p className="wn-run-h">
                      <span><b>{t('Step {n} of 7', { n: Math.min(done + 1, 7) })}</b>{next ? ` · ${t(BUILD_STEPS[nextAt]?.title ?? '').toLowerCase()}` : ''}</span>
                      <span className="num"><b>{money(spent, 2)}</b> {demo ? t('so far, not charged') : t('so far')} · {t('estimate {low} to {high}', { low: money(est.low, 2), high: money(est.high, 2) })}</span>
                    </p>
                    <div className="track" role="img" aria-label={t('{done} of 7 steps done', { done })}><i style={{ '--v': `${Math.round((done / 7) * 100)}%` } as CSSProperties} /></div>
                  </div>
                  <ol className="prog">
                    {prog.map((p) => {
                      const here = p.id === next;
                      const cls = p.state === 'done' ? 'done' : here ? 'now' : 'todo';
                      return (
                        <li key={p.id} className={cls}>
                          <span className={`mark${here && !builder.busy && !failed ? ' wn-held' : ''}`} aria-hidden="true">
                            {p.state === 'done' ? <Icon name="check" size={14} strong /> : here && builder.busy ? <i className="wn-spin" /> : here && failed ? <Icon name="warn" size={14} strong /> : null}
                          </span>
                          <span className="grow">
                            <span className="wn-prog-t">{here ? <b>{t(p.title)}</b> : t(p.title)}</span>
                            {p.state === 'done' && <span className="row-s">{madeBy(p.id, builder)}</span>}
                            {here && <span className="row-s">{builder.pausing ? t('Finishing this step, then pausing…') : builder.busy ? t('Writing now…') : failed ? t('Stopped here.') : t('Paused. Nothing more is spent until you resume.')}</span>}
                          </span>
                          {p.cost > 0 && <span className="wn-step-cost">{p.cost < 0.005 ? t('under $0.01') : money(p.cost, 2)}</span>}
                        </li>
                      );
                    })}
                  </ol>
                </div>
                <div className="alert">
                  <Icon name="info" />
                  <div><b>{t('You can leave this screen.')}</b><p>{t('Progress is saved after every step, and the build goes on while the app is open. If the app closes, the world waits under Worlds, paused, and nothing more is spent until you resume it.')}</p></div>
                </div>
              </div>
              <aside className="card wn-side">
                <div className="card-h"><span className="card-t"><Icon name="doc" size={16} />{t('What you asked for')}</span></div>
                {summary}
                {draft.questions && !draft.questions.skipped && Object.values(draft.questions.answers).some((v) => v.trim()) && (
                  <dl className="kv"><div><dt>{t('Answers')}</dt><dd>{draft.questions.list.map((q) => draft.questions!.answers[q.id]?.trim()).filter(Boolean).join(' · ')}</dd></div></dl>
                )}
                <p className="wn-aside-f">{t('If a step fails it is tried again by itself. You are not charged twice for the steps already done.')}</p>
              </aside>
            </div>
          </section>
        );
      })()}

      {/* ============ 6. Overview ============ */}
      {at === 'overview' && builder && draft && (() => {
        const world = builder.world();
        const problems = builder.problems();
        if (!world) return <div className="alert alert-err"><Icon name="warn" /><div><b>{t('The world could not be put together')}</b><p>{problems[0]}</p></div></div>;
        const sk = draft.steps.skeleton!;
        const counts = countsOf(world);
        const startRegion = sk.regions.find((r) => r.id === sk.start);
        const notes = BUILD_STEPS.flatMap((s) => draft.notes[s.id] ?? []);
        const secrets = Object.values(world.people).filter((p) => p.secret).length;
        const level = world.rules.level ?? 'champion';
        const acts = (from: StepId) => (
          <span className="wn-sec-acts"><button type="button" className="link link-tap" onClick={() => setAgain(from)}><Icon name="refresh" size={16} />{t('Build again')}</button></span>
        );
        return (
          <section className="wn-step">
            <header className="page-h"><div>
              <h1>{t('Your world is ready')}</h1>
              <p>{t('Read it through before you accept it. Any part can be built again.')}</p>
            </div></header>
            {problems.length > 0 && <div className="alert alert-err" role="alert"><Icon name="warn" /><div><b>{t('This world cannot be accepted yet')}</b><p>{problems.join('. ')}. {t('Build the part again.')}</p></div></div>}
            <div className="split stack-l">
              <div className="stack-l">
                <section className="sec">
                  <div className="sec-h"><h2>{t('The world')}</h2>{acts('skeleton')}</div>
                  <div className="card stack">
                    <div className="f">
                      <label className="label" htmlFor="wn-wname">{t('Name')}</label>
                      <div className="wn-name-row">
                        <span className="wn-wmark" style={{ '--a': world.accent } as CSSProperties} aria-hidden="true"><Icon name="globe" size={22} /></span>
                        <input className="input" id="wn-wname" type="text" maxLength={48} autoComplete="off" defaultValue={sk.name} key={sk.name} onBlur={(e) => builder.rename(e.target.value)} />
                      </div>
                    </div>
                    <p className="wn-pitch">{world.pitch}</p>
                    <p className="t-sm t-2">{tn(counts.regions, '{n} region', '{n} regions')} · {tn(counts.places, '{n} place', '{n} places')} · {tn(counts.people, '{n} person', '{n} people')}</p>
                  </div>
                </section>

                <section className="sec">
                  <div className="sec-h"><h2>{t('Regions · {n}', { n: sk.regions.length })}</h2>{acts('skeleton')}</div>
                  <ul className="card card-flush wn-regions">
                    {[...sk.regions].sort((x, y) => Number(y.id === sk.start) - Number(x.id === sk.start)).map((r) => (
                      <li key={r.id}>
                        <p className="wn-reg-n">{r.name}{r.id === sk.start && <span className="tag tag-accent"><Icon name="pin" size={12} />{t('The story starts here')}</span>}</p>
                        <p className="wn-reg-d">{r.brief}</p>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="sec">
                  <div className="sec-h"><h2>{t('Starting place')}</h2>{acts('start')}</div>
                  <div className="card stack-s">
                    <p className="card-n">{startRegion?.name}</p>
                    <p className="t-2">{t('The one place built in full: where the first sessions are played, and the people your character meets first. Everywhere else is a sketch until a story goes there.')}</p>
                    <div className="inline">{draft.steps.start!.places.map((p) => <span key={p.id} className="tag">{p.name}</span>)}</div>
                  </div>
                </section>

                <section className="sec">
                  <div className="sec-h"><h2>{t('People · {n}', { n: counts.people })}</h2>{acts('people')}</div>
                  <div className="card stack-s">
                    <p className="t-2">{t('The people around your character’s life. What they want and what they hide is for the story to show you.')}</p>
                    <div className="inline">{Object.values(world.people).filter((p) => p.count === 1).map((p) => <span key={p.id} className="tag" title={p.role}>{p.name}</span>)}</div>
                  </div>
                </section>
              </div>

              <div className="stack-l">
                <section className="sec">
                  <div className="sec-h"><h2>{t('Rules')}</h2>{acts('rules')}</div>
                  <div className="card">
                    <dl className="kv">
                      <div><dt>{t('Powers')}</dt><dd><b>{t(POWERS[world.rules.powers].name)}</b><span className="t-2">{world.rules.powers === 'focus' ? t('Six paths; none may start above {cap}. Abilities are found in the story and then learned.', { cap: world.rules.pathCap }) : t(POWERS[world.rules.powers].text)}</span></dd></div>
                      <div><dt>{t('Power level')}</dt><dd><b>{t(levelName(level))}</b><span className="t-2">{t('{points} points to build a character', { points: POWER_LEVELS[level].points })}</span></dd></div>
                      <div><dt>{t('Table style')}</dt><dd><b>{t(STYLES[world.rules.style].name)}</b></dd></div>
                      <div><dt>{t('Ancestries')}</dt><dd>{(world.ancestries ?? []).map((x) => x.name).join(', ')}</dd></div>
                    </dl>
                  </div>
                </section>

                <section className="sec">
                  <div className="sec-h"><h2>{t('Hidden from you')}</h2>{acts('fronts')}</div>
                  <div className="card stack">
                    <ul className="wn-counts">
                      <li><b>{world.fronts?.length ?? 0}</b>{t('things moving the world')}</li>
                      <li><b>{world.seeds?.length ?? 0}</b>{t('situations waiting to be found')}</li>
                      <li><b>{secrets}</b>{t('secrets people keep')}</li>
                    </ul>
                    {!spoilers ? (
                      <>
                        <p className="t-sm t-2">{t('The world builder keeps these to itself so that the story can surprise you. You can look, but you cannot unsee them.')}</p>
                        <button type="button" className="btn" style={{ flex: 'none' }} onClick={() => setSpoilers(true)}><Icon name="eye" size={18} />{t('Show spoilers')}</button>
                      </>
                    ) : (
                      <>
                        <ul className="wn-fronts">
                          {(world.fronts ?? []).map((f) => (
                            <li key={f.id}>“{f.name}”
                              <span className="wn-front-c"><span className="clock" role="img" aria-label={t('{stage} of {total}', { stage: f.stage, total: f.stages.length })}>{f.stages.map((_, i) => <i key={i} className={i < f.stage ? 'on' : undefined} />)}</span>{t('{stage} of {total}', { stage: f.stage, total: f.stages.length })}</span>
                            </li>
                          ))}
                        </ul>
                        <p className="t-sm t-2">{t('Only the names are shown. What each is driving toward, the situations and the secrets are still closed.')}</p>
                        <button type="button" className="btn" style={{ flex: 'none' }} onClick={() => setSpoilers(false)}><Icon name="eye-off" size={18} />{t('Hide again')}</button>
                      </>
                    )}
                  </div>
                </section>

                {notes.length > 0 && (
                  <section className="sec">
                    <div className="sec-h"><h2>{t('Put right by the checks · {n}', { n: notes.length })}</h2></div>
                    <div className="card stack-s">
                      <p className="t-sm t-2">{t('What the world builder wrote is checked before it is kept. These were mended:')}</p>
                      <ul className="wn-notes">{notes.slice(0, 8).map((line, i) => <li key={i}>{line}</li>)}</ul>
                      {notes.length > 8 && <p className="t-sm t-2">{t('And {n} more of the same kind.', { n: notes.length - 8 })}</p>}
                    </div>
                  </section>
                )}

                <section className="sec">
                  <div className="sec-h"><h2>{t('Cost')}</h2></div>
                  <div className="card stack-s">
                    <p className="wn-total"><b>{money(spent, 2)}</b>{demo || draft.usage.every((u) => u.simulated) ? t('is what this would have cost') : t('to build this world')}</p>
                    <p className="t-sm t-2">{draft.usage.every((u) => u.simulated) ? `${t('Built by the demo builder: nothing was charged.')} ` : ''}{t('Building a part again costs more, and you see the price first.')}</p>
                  </div>
                </section>

                <div className="alert">
                  <Icon name="lock" />
                  <div><b>{t('An accepted world never changes.')}</b><p>{t('Each story works on its own copy, so you can start as many stories here as you like and none of them touches the world.')}</p></div>
                </div>
              </div>
            </div>
          </section>
        );
      })()}

      {again && builder && (() => {
        const from = BUILD_STEPS.findIndex((s) => s.id === again);
        const redo = BUILD_STEPS.slice(from);
        const price = builder.estimate(again);
        return (
          <Modal title={t('Build “{step}” again?', { step: t(redo[0]!.title) })} onClose={() => setAgain(null)}>
            <p>{redo.length > 1
              ? <T text="The steps after it were written knowing what it said, so they are built again too: {steps}. What is there now is replaced." vars={{ steps: redo.slice(1).map((s) => t(s.title).toLowerCase()).join(', ') }} />
              : t('What is there now is replaced. Nothing else changes.')}</p>
            {from > 0 && <p className="t-2">{t('Kept as they are: {steps}.', { steps: BUILD_STEPS.slice(0, from).map((s) => t(s.title).toLowerCase()).join(', ') })}</p>}
            <p className="t-2">{demo ? t('The demo builder writes the same thing again, and nothing is charged.') : t('This costs {price}, somewhere between {low} and {high}.', { price: about(price.typical), low: money(price.low, 2), high: money(price.high, 2) })}</p>
            <div className="inline">
              <button className="btn btn-primary btn-fit" onClick={() => { setAgain(null); setSpoilers(false); void builder.regenerate(again); }}>{t('Build again')}{demo ? '' : ` · ${about(price.typical)}`}</button>
              <button className="btn btn-fit" onClick={() => setAgain(null)}>{t('Keep it')}</button>
            </div>
          </Modal>
        );
      })()}
    </FlowPage>
  );
}

/** The document a world is to be built from: reading it (with its price on the button), and afterwards the notes that were taken. */
function Reading({ builder, demo, scribe }: { builder: WorldBuilder; demo: boolean; scribe: string }) {
  const [open, setOpen] = useState(false);
  const draft = builder.draft;
  const doc = draft.document!;
  const done = doc.total - doc.parts.length;
  const reading = builder.current === 'reading';
  const failed = draft.failed?.step === 'reading' ? draft.failed : null;
  const spent = draft.costs.reading ?? 0;
  if (docRead(doc)) {
    return (
      <div className="alert alert-ok">
        <Icon name="ok-circle" />
        <div className="grow stack-s">
          <div><b>{t('“{name}” has been read', { name: doc.name })}</b><p>{spent > 0 && !demo ? t('The world is built from the notes taken from it, which cost {cost}. The document itself is no longer kept.', { cost: money(spent, 2) }) : t('The world is built from the notes taken from it. The document itself is no longer kept.')}</p></div>
          <button type="button" className="link link-tap" onClick={() => setOpen(!open)}><Icon name={open ? 'up' : 'down'} size={14} strong />{open ? t('Hide the notes') : t('See the notes')}</button>
          {open && <p className="wn-notes-text">{doc.digest}</p>}
        </div>
      </div>
    );
  }
  return (
    <div className="card stack">
      <div className="wn-file">
        <span className="wn-file-i" aria-hidden="true"><Icon name="doc" size={22} /></span>
        <div className="grow"><p className="wn-file-n cut">{doc.name}</p><p className="wn-file-s">{doc.pages ? `${tn(doc.pages, '{n} page', '{n} pages')} · ` : ''}{t('{words} words', { words: num(doc.words) })}</p></div>
      </div>
      {failed && (
        <div className="alert alert-err" role="alert">
          <Icon name="warn" />
          <div><b>{failed.kind === 'budget' ? t('Today’s spending limit is reached') : t('The reading stopped')}</b><p>{failed.message} {done === 0 ? t('Nothing has been read yet.') : done === 1 ? t('The part already read is kept, and not read again.') : t('The {n} parts already read are kept, and not read again.', { n: done })}</p></div>
        </div>
      )}
      <div className="budget">
        <p className="wn-run-h">
          <span><b>{reading ? t('Reading part {n} of {total}', { n: Math.min(done + 1, doc.total), total: doc.total }) : done === 0 ? tn(doc.total, '{n} part to read', '{n} parts to read') : done >= doc.total ? t('All parts read; the notes are not brought together yet') : t('{done} of {total} parts read', { done, total: doc.total })}</b></span>
          {spent > 0 && <span className="num"><b>{money(spent, 2)}</b> {demo ? t('so far, not charged') : t('so far')}</span>}
        </p>
        <div className="track" role="img" aria-label={t('{done} of {total} parts read', { done, total: doc.total })}><i style={{ '--v': `${Math.round((done / doc.total) * 100)}%` } as CSSProperties} /></div>
      </div>
      <p className="t-2">{t('{scribe} reads it and takes notes from each part. Reading can be paused, and a part that has been read is never read, or paid for, again.', { scribe })}</p>
      <div className="inline">
        {reading
          ? <button type="button" className="btn btn-fit" disabled={builder.pausing} onClick={() => builder.pause()}>{builder.pausing ? t('Pausing…') : t('Pause')}</button>
          : <button type="button" className="btn btn-primary btn-fit" onClick={() => void builder.read()}>{failed ? t('Try again') : done === 0 ? t('Read the document') : t('Read the rest')}{demo ? ` · ${t('free in the demo')}` : ` · ${about(builder.estimateReading())}`}</button>}
        {failed?.kind === 'budget' && <a className="btn btn-quiet btn-fit" href={href('settings')}>{t('Change the limit')}</a>}
      </div>
    </div>
  );
}

function Choice({ on = false, off = false, onClick, title, text, tag }: { on?: boolean; off?: boolean; onClick?: () => void; title: string; text: string; tag?: string }) {
  return (
    <button type="button" className={`choice${on ? ' is-on' : ''}${off ? ' wn-off' : ''}`} aria-pressed={on} disabled={off} onClick={onClick}>
      <span className="dotmark" aria-hidden="true" />
      <span className="grow"><span className="choice-t">{title}{tag && <span className="tag wn-tag">{tag}</span>}</span><span className="choice-d wn-blk">{text}</span></span>
    </button>
  );
}

function Point({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return <li><Icon name={icon} size={18} /><span><b>{title}</b>{children}</span></li>;
}
