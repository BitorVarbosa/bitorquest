// A character for a new story in a world from the library.
//
// Four views: asking (propose one from a sentence, or start from nothing), waiting for the proposal,
// the proposal as a sheet with its reasons, and the editor. Everything the screen says about points
// and about what is not allowed comes from `check` in engine/character.ts: nothing is added up here.
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ATTRIBUTES, GIFT_AT_START, GIFT_RANK_MAX, GIFT_RANK_START, GIFT_TEXT, PATHS, POWER_LEVELS, SKILLS, SKILL_INFO, STARTING_TIER, abilitiesOf, ancestryCost, ancestryOf, blankDraft, check, fightEffect, has, nextMoveId, traitsFor,
  isEffectKind, levelName, sheetOf, traitDef, traitDetail, traitInfo,
  type Ability, type Ancestry, type Attribute, type CharacterCheck, type CharacterDraft, type CreationRules, type Gift, type GiftMove, type Path, type PowersMode, type ProblemArea, type Sheet,
  type SkillName, type TableStyle, type TraitDef, type TraitKind,
} from '../../engine';
import { GiftCard, GiftFields, KIND_INFO, MoveCard, fightLine, toggleKind } from '../components/Gift';
import { BudgetReached } from '../../game/builder';
import { STARTING_DRESSINGS, type CharacterProposal } from '../../game/creation';
import { APPEARANCE_MAX, LOOK_MAX } from '../../game/cards';
import { amountLabel, currenciesOf, startingIn } from '../../game/money';
import { ENDING_DEFAULT, EndingChoice } from '../components/Ending';
import { StartingCompanions } from '../components/Companions';
import type { Described } from '../../game/creation';
import { modelInfo } from '../../game/llm/models';
import type { WorldTemplate } from '../../game/types';
import { DESTINY_BY_STYLE, creationRules } from '../../game/world';
import { useApp } from '../app';
import { go, href } from '../router';
import { FlowPage } from '../Shell';
import { T, rich } from '../T';
import { Icon, Modal, Stepper, money } from '../ui';
import { m, t, tn } from '../../i18n';
import './character-new.css';

const ATTRIBUTE_INFO: Record<Attribute, { name: string; text: string }> = {
  strength: { name: m('Strength'), text: m('Close combat. Added to your attack.') },
  skill: { name: m('Skill'), text: m('Agility and wits. In attack, defence and most tests.') },
  resistance: { name: m('Resistance'), text: m('Stamina and will. Sets hit points and energy.') },
  armor: { name: m('Armor'), text: m('Turns blows aside. Added to your defence.') },
  firepower: { name: m('Firepower'), text: m('Ranged attacks, in place of Strength.') },
};
const PATH_INFO: Record<Path, { name: string; text: string }> = {
  fire: { name: m('Fire'), text: m('Flame, heat and fury.') },
  water: { name: m('Water'), text: m('Water, mist and mending.') },
  air: { name: m('Air'), text: m('Wind, sound and movement.') },
  earth: { name: m('Earth'), text: m('Stone, root and endurance.') },
  light: { name: m('Light'), text: m('Light, sight and illusion.') },
  dark: { name: m('Dark'), text: m('Shadow, silence and fear.') },
};
const STYLES: { id: TableStyle; name: string; text: string; n: number }[] = [
  { id: 'story', name: m('Story'), text: m('Defeat is a setback, never the end. {n} destiny points a chapter.'), n: DESTINY_BY_STYLE.story },
  { id: 'adventure', name: m('Adventure'), text: m('A death test is softened once a chapter. {n} destiny points a chapter.'), n: DESTINY_BY_STYLE.adventure },
  { id: 'brutal', name: m('Brutal'), text: m('Death is permanent. No destiny points, and no rewinding.'), n: 0 },
];
const ABILITY_BY_ID = new Map<string, Ability>(PATHS.flatMap((p) => abilitiesOf(p)).map((ab) => [ab.id, ab]));

const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const points = (n: number): string => tn(n, '{n} point', '{n} points');
/** The same with the number in bold. */
const pointsB = (n: number): ReactNode => rich(tn(n, '<b>{n}</b> point', '<b>{n}</b> points'));
const defName = (written: string): string => traitDef(written)?.name.toLowerCase() ?? '';
/** A trait as written on a sheet: only the part before the colon is the rules' own text; the detail is the player's. */
const traitName = (name: string): string => { const i = name.indexOf(': '); return i < 0 ? t(name) : `${t(name.slice(0, i))}: ${name.slice(i + 2)}`; };

type View = 'ask' | 'proposing' | 'proposed' | 'edit';
type Carried = { name: string; text: string };

export function CharacterNew({ worldId, auto }: { worldId: string; auto: string | null }) {
  const a = useApp();
  const template = a.template(worldId);
  if (!template) {
    return (
      <FlowPage title={t('Your character')} back="worlds" foot={<a className="btn btn-primary" href={href('worlds')}>{t('Back to your worlds')}</a>}>
        <section className="empty">
          <Icon name="globe" size={40} />
          <h2>{t('That world is not here')}</h2>
          <p>{t('A character is made for a world in your library, and this one is not in it. It may have been deleted, or the link is from another device.')}</p>
        </section>
      </FlowPage>
    );
  }
  return <Maker key={template.id} template={template} auto={auto} />;
}

function Maker({ template, auto }: { template: WorldTemplate; auto: string | null }) {
  const a = useApp();
  const rules = useMemo(() => creationRules(template.world), [template]);
  const [view, setView] = useState<View>(auto === 'empty' ? 'edit' : auto === 'propose' ? 'proposing' : 'ask');
  const [premise, setPremise] = useState(template.premise);
  const [name, setName] = useState(template.name ?? '');
  const [proposal, setProposal] = useState<CharacterProposal | null>(null);
  const [draft, setDraft] = useState<CharacterDraft | null>(auto === 'empty' ? blankDraft(rules) : null);
  const [carrying, setCarrying] = useState<Carried[]>([]);
  const [failure, setFailure] = useState<{ text: string; budget: boolean } | null>(null);
  const [title, setTitle] = useState(template.opening.title);
  const [style, setStyle] = useState<TableStyle>(template.world.rules.style);
  const [ending, setEnding] = useState({ ending: template.table.ending ?? ENDING_DEFAULT.ending, length: template.table.length ?? ENDING_DEFAULT.length });
  /** How the character looks: at a glance, and in full. Proposed with the sheet, or changed by the player. */
  const [look, setLook] = useState('');
  const [appearance, setAppearance] = useState('');
  /** The companions who start at the character's side, as the player described them (only those changed). */
  const [companions, setCompanions] = useState<Record<string, Described>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [adding, setAdding] = useState<TraitKind | null>(null);
  /** The trait just added that still needs its particulars: its field takes the cursor. */
  const [fresh, setFresh] = useState<string | null>(null);
  const [allChanges, setAllChanges] = useState(false);
  /** Only the answer to the latest request counts: an earlier one that arrives late is dropped. */
  const ticket = useRef(0);
  const asked = useRef(false);
  const page = useRef<HTMLDivElement>(null);

  const propose = async () => {
    const mine = ++ticket.current;
    setFailure(null);
    setView('proposing');
    try {
      const p = await a.proposeCharacter(template.id, { premise: premise.trim(), name: name.trim() });
      if (ticket.current !== mine) return;
      setProposal(p);
      setDraft(structuredClone(p.draft));
      setCarrying(p.carrying);
      setLook(p.look);
      setAppearance(p.appearance);
      setView('proposed');
    } catch (err) {
      if (ticket.current !== mine) return;
      const budget = err instanceof BudgetReached;
      setFailure({ budget, text: budget ? t('Today’s spending limit is reached, so nothing was sent.') : err instanceof Error && err.message ? err.message : t('The proposal did not come back.') });
      setView('ask');
    }
  };
  const startEmpty = () => {
    ticket.current += 1;
    setFailure(null);
    setProposal(null);
    setDraft({ ...blankDraft(rules), name: name.trim() });
    setCarrying([]);
    setView('edit');
  };

  useEffect(() => {
    if (auto !== 'propose' || asked.current) return;
    asked.current = true;
    void propose();
    // Asked once, when the screen opens with "?auto=propose".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A new view starts at its top.
  useEffect(() => { page.current?.closest('.page')?.scrollTo({ top: 0 }); }, [view]);

  const mi = modelInfo(a.models().architect ?? a.models().narrator);
  const estimate = (1500 * mi.input + (700 + (mi.thinkingOff ? 0 : 500)) * mi.output) / 1_000_000;
  const price = a.usingDemo ? t('free in the demo') : estimate < 0.005 ? t('under a cent') : t('about {price}', { price: money(estimate, 2) });
  const level = POWER_LEVELS[rules.level];
  const sub = template.world.name;

  // ---------- Asking, and waiting ----------

  if (view === 'ask' || view === 'proposing' || !draft) {
    const waiting = view === 'proposing';
    return (
      <FlowPage title={t('Your character')} sub={sub} back="worlds" className="cn" foot={
        <div className="cn-foot">
          {draft && !proposal
            ? <button className="btn" type="button" onClick={() => { ticket.current += 1; setFailure(null); setView('edit'); }}>{t('Back to my sheet')}</button>
            : <button className="btn" type="button" onClick={startEmpty}>{t('Start from an empty sheet')}</button>}
          <button className="btn btn-primary" type="button" disabled={waiting || !premise.trim()} onClick={() => void propose()}>
            {waiting ? t('Proposing…') : <>{t('Propose a character')}<span className="cn-price">· {price}</span></>}
          </button>
        </div>
      }>
        <div ref={page} className="cn-top" />
        <header className="page-h"><div>
          <h1>{t('Who do you play?')}</h1>
          <p>{t('A character for a new story in {world}.', { world: template.world.name })}</p>
        </div></header>

        {failure && (
          <div className="alert alert-err" role="alert">
            <Icon name="warn" />
            <div className="grow">
              <b>{t('No proposal this time')}</b>
              <p>{failure.text} {failure.budget ? t('Raise the limit in Settings, or build the character yourself, which costs nothing.') : t('Nothing was kept. You can try again, or build the character yourself.')}</p>
              {failure.budget && <a className="link link-tap" href={href('settings')}>{t('Open Settings')}<Icon name="right" size={14} strong /></a>}
            </div>
          </div>
        )}

        <div className="split stack-l">
          <div className="stack-l">
            {waiting ? (
              <div className="card cn-wait" role="status">
                <i className="cn-spin" aria-hidden="true" />
                <div><b>{t('Working out who this is')}</b><p>“{premise.trim()}”</p><p className="t-sm">{t('One request. It usually takes a few seconds.')}</p></div>
              </div>
            ) : (
              <>
                <div className="f">
                  <label className="label" htmlFor="cn-premise">{t('Your character, in a sentence')}</label>
                  <textarea className="input cn-auto" id="cn-premise" rows={3} value={premise} maxLength={600} onChange={(e) => setPremise(e.target.value)} />
                  <p className="help">{template.premise ? t('The world was built around this. Change it if you mean to play someone else here.') : t('Who they are and what they do. A sentence or two is enough.')}</p>
                </div>
                <div className="f">
                  <label className="label" htmlFor="cn-name">{t('Name')} <span className="t-2 cn-opt-label">{t('· optional')}</span></label>
                  <input className="input" id="cn-name" type="text" value={name} maxLength={40} autoComplete="off" onChange={(e) => setName(e.target.value)} />
                  <p className="help">{t('Leave it empty and the proposal names them. You can change it afterwards.')}</p>
                </div>
              </>
            )}
          </div>

          <aside className="card cn-side">
            <div className="card-h"><span className="card-t"><Icon name="info" size={16} />{t('Two ways to begin')}</span></div>
            <ul className="cn-points">
              <li><Icon name="spark" size={18} /><span><T text="<b>A proposal</b>The world builder reads your sentence and proposes a whole sheet, with its reasons. The rules check it before you see it, and you can change any of it. One request, {price}." vars={{ price }} /></span></li>
              <li><Icon name="edit" size={18} /><span><T text="<b>An empty sheet</b>You choose every part yourself. Nothing is sent and nothing is spent." /></span></li>
            </ul>
            <p className="cn-side-f">
              <T text="A {level} has <b>{points} points</b>, and drawbacks give back up to {back}." vars={{ level: t(levelName(rules.level)), points: level.points, back: level.disadvantages }} />{' '}
              {rules.powers === 'focus' ? t('This world has six paths; none may start above {cap}.', { cap: rules.pathCap })
                : rules.powers === 'extreme' ? t('Powers in this world are schools, taken as advantages for 2 points each.')
                  : rules.powers === 'gift' ? t('In this world a power is one of your own: say what it is in your sentence. Its rank costs 1 point a level and may not start above {cap}.', { cap: GIFT_RANK_START })
                    : t('This world has no powers.')}
            </p>
            {a.usingDemo && <p className="cn-side-f">{t('You are using the demo builder: it proposes the same character whatever you write.')}</p>}
          </aside>
        </div>
      </FlowPage>
    );
  }

  // ---------- The sheet: proposed, or being edited ----------

  const c = check(draft, rules);
  const sheet = sheetOf(draft, rules);
  const ancestry = ancestryOf(draft, rules);
  const editing = view === 'edit';
  const set = (fn: (d: CharacterDraft) => void) => { setProblem(null); setDraft((old) => { if (!old) return old; const next = structuredClone(old); fn(next); return next; }); };
  const over = c.left < 0;
  const blocked = c.problems[0]?.area === 'points' ? t('{n} over the budget', { n: -c.left }) : c.problems[0]?.text ? t(c.problems[0].text) : null;
  const pointsProblem = c.problems.find((p) => p.area === 'points')?.text;
  const issues = (area: ProblemArea): ReactNode => c.problems.filter((p) => p.area === area).map((p, i) => <p key={i} className="help t-err" role="alert">{t(p.text)}</p>);
  const shown = draft.name.trim() || t('Unnamed');
  const focus = rules.powers === 'focus';
  const pathsUp = PATHS.filter((k) => (draft.paths[k] ?? 0) > 0);
  const pathsDown = PATHS.filter((k) => (draft.paths[k] ?? 0) === 0);
  const known = draft.abilities.map((id) => ABILITY_BY_ID.get(id)).filter((ab): ab is Ability => !!ab);

  const setPath = (k: Path, v: number) => set((d) => {
    if (v > 0) d.paths[k] = v; else delete d.paths[k];
    // An ability needs its path: what can no longer be known is let go, as is anything beyond one for each level.
    const room = PATHS.reduce((sum, p) => sum + (d.paths[p] ?? 0), 0);
    d.abilities = d.abilities.filter((id) => { const ab = ABILITY_BY_ID.get(id); return !!ab && (d.paths[ab.path] ?? 0) >= ab.tier; }).slice(0, room);
  });
  const setGift = (fn: (g: Gift) => void) => set((d) => { if (d.gift) fn(d.gift); });
  const setAncestry = (id: string) => set((d) => {
    d.ancestry = id;
    // What the new ancestry brings is not also bought.
    const next = rules.ancestries.find((x) => x.id === id);
    const brought = new Set([...(next?.advantages ?? []), ...(next?.disadvantages ?? [])].filter((w) => !traitDef(w)?.detail).map(defName));
    d.advantages = d.advantages.filter((w) => !brought.has(defName(w)) || !!traitDef(w)?.detail);
    d.disadvantages = d.disadvantages.filter((w) => !brought.has(defName(w)) || !!traitDef(w)?.detail);
  });
  const toggleSkill = (sk: SkillName) => set((d) => { d.skills = d.skills.includes(sk) ? d.skills.filter((x) => x !== sk) : [...d.skills, sk]; });
  const toggleAbility = (id: string) => set((d) => { d.abilities = d.abilities.includes(id) ? d.abilities.filter((x) => x !== id) : [...d.abilities, id]; });
  const listOf = (d: CharacterDraft, kind: TraitKind) => (kind === 'advantage' ? d.advantages : d.disadvantages);
  const removeTrait = (kind: TraitKind, index: number) => set((d) => { listOf(d, kind).splice(index, 1); });
  const addTrait = (def: TraitDef) => {
    set((d) => { listOf(d, def.kind).push(def.name); });
    if (def.detail) { setFresh(`${def.kind}:${listOf(draft, def.kind).length}`); setAdding(null); }
  };
  const describeTrait = (kind: TraitKind, index: number, def: TraitDef, detail: string) => set((d) => { listOf(d, kind)[index] = detail.trim() ? `${def.name}: ${detail}` : def.name; });

  const begin = () => {
    // A hero of an earlier story in this world, whose story has ended, is remembered in this one.
    const legend = a.nextLegend?.worldId === template.id ? a.nextLegend.text : null;
    const got = a.startStory(template.id, { draft, carrying, look, appearance, companions }, { title: title.trim() || template.opening.title, settings: { style, ending: ending.ending, length: ending.length }, ...(legend ? { legends: [legend] } : {}) });
    if ('problem' in got) setProblem(got.problem); else { a.nextLegend = null; go('play'); }
  };
  const backToProposal = () => {
    if (!proposal) return;
    setDraft(structuredClone(proposal.draft));
    setCarrying(proposal.carrying);
    setProblem(null);
    setView('proposed');
  };

  const wealth = has(sheet.advantages, 'wealth') ? 'wealthy' : has(sheet.disadvantages, 'poor') ? 'poor' : 'usual';
  const coin = currenciesOf(template.world, template.table.language === 'pt' ? 'pt' : 'en')[0];
  const silver = coin ? amountLabel(startingIn(wealth, coin), coin) : t('no money (this world has none)');
  const dressings = STARTING_DRESSINGS[style];
  const changes = proposal?.changes ?? [];

  return (
    <FlowPage title={t('Your character')} sub={sub} back="worlds" className="cn" foot={
      <div className="cn-foot">
        <Budget c={c} className="cn-foot-budget only-phone" short />
        {/* Over the budget is already said by the bar that rides in the foot on a phone. */}
        {(blocked || problem) && <p className={`cn-foot-why t-err${!problem && over ? ' only-desktop' : ''}`} role="alert">{problem ? t(problem) : t('Not yet: {why}', { why: blocked ?? '' })}</p>}
        {editing
          ? proposal
            ? <button className="btn" type="button" onClick={backToProposal}>{t('Back to the proposal')}</button>
            : <button className="btn" type="button" onClick={() => { setName(draft.name); setView('ask'); }}>{t('Ask for a proposal')}</button>
          : <button className="btn" type="button" onClick={() => setView('edit')}><Icon name="edit" size={18} />{t('Edit')}</button>}
        <button className="btn btn-primary" type="button" disabled={!c.ok} onClick={begin}>{t('Begin the story')}<Icon name="arrow" size={18} /></button>
      </div>
    }>
      <div ref={page} className="cn-top" />
      <header className="page-h">
        <div className="cn-id">
          <span className="av av-xl av-you" aria-hidden="true">{shown.slice(0, 1).toUpperCase()}</span>
          <div className="grow">
            <h1>{shown}</h1>
            {draft.line.trim() && <p>{draft.line.trim().replace(/^./, (ch) => ch.toUpperCase())}</p>}
            <div className="inline cn-id-tags"><span className="tag">{t(ancestry.name)}</span><span className="tag">{t(levelName(rules.level))} · {points(level.points)}</span></div>
          </div>
        </div>
      </header>

      <div className="split stack-l">
        {/* ===== First block ===== */}
        <div className="cn-col-a">
          {!editing && proposal && (
            <div className="alert">
              <Icon name="spark" />
              <div><b>{t('Proposed from your premise')}</b><p>{t('“{premise}” Each part has its reason under it. Begin as {name} is, or edit anything first.', { premise: premise.trim(), name: shown })}</p></div>
            </div>
          )}
          {!editing && changes.length > 0 && (
            <div className="alert alert-warn">
              <Icon name="info" />
              <div className="grow">
                <b>{t('Adjusted to fit the rules')}</b>
                <p>{tn(changes.length, 'The proposal did not add up as it came, so the rules changed {n} thing:', 'The proposal did not add up as it came, so the rules changed {n} things:')}</p>
                <ul className="cn-changes">{(allChanges ? changes : changes.slice(0, 4)).map((ch, i) => <li key={i}>{t(ch)}</li>)}</ul>
                {changes.length > 4 && <button type="button" className="link link-tap" onClick={() => setAllChanges(!allChanges)}>{allChanges ? t('Show fewer') : t('Show all {n}', { n: changes.length })}</button>}
              </div>
            </div>
          )}
          {editing && over && (
            <div className="alert alert-err" role="alert">
              <Icon name="warn" />
              <div><b>{t('{n} over the budget', { n: -c.left })}</b><p>{pointsProblem ? t(pointsProblem) : null}</p></div>
            </div>
          )}

          {editing && (
            <section className="sec">
              <div className="sec-h"><h2>{t('Who')}</h2></div>
              <div className="card stack">
                <div className="f">
                  <label className="label" htmlFor="cn-who">{t('Name')}</label>
                  <input className={`input${draft.name.trim() ? '' : ' is-bad'}`} id="cn-who" type="text" value={draft.name} maxLength={40} autoComplete="off" onChange={(e) => set((d) => { d.name = e.target.value; })} />
                  {issues('who')}
                </div>
                <div className="f">
                  <label className="label" htmlFor="cn-line">{t('In one line')}</label>
                  <textarea className="input" id="cn-line" rows={2} value={draft.line} maxLength={120} onChange={(e) => set((d) => { d.line = e.target.value; })} />
                  <p className="help">{t('How the narrator introduces you to people who have not met you: “a young courier of the Couriers’ Guild”.')}</p>
                </div>
                <div className="f">
                  <label className="label" htmlFor="cn-look">{t('At a glance')} <span className="t-2 cn-opt-label">{t('· optional')}</span></label>
                  <input className="input" id="cn-look" type="text" value={look} maxLength={LOOK_MAX} autoComplete="off" onChange={(e) => setLook(e.target.value)} placeholder={t('For example: grey fedora, gold watch')} />
                  <p className="help">{t('The narrator keeps to this every scene.')}</p>
                </div>
                <div className="f">
                  <label className="label" htmlFor="cn-looks">{t('How you look')} <span className="t-2 cn-opt-label">{t('· optional')}</span></label>
                  <textarea className="input" id="cn-looks" rows={3} value={appearance} maxLength={APPEARANCE_MAX} onChange={(e) => setAppearance(e.target.value)} />
                  <p className="help">{t('Told in full in the first scene; after that the few words above stand in for it. Your personality is yours to play.')}</p>
                </div>
              </div>
            </section>
          )}
          {!editing && (look.trim() || appearance.trim()) && (
            <section className="sec">
              <div className="sec-h"><h2>{t('How you look')}</h2></div>
              <div className="card"><p className="looks">{appearance.trim() || look.trim()}</p></div>
            </section>
          )}

          <section className="sec">
            <div className="sec-h"><h2>{t('Attributes')}</h2><span className="t-xs t-2">{pointsB(c.parts.attributes)}{editing ? ` · ${t('1 a level')}` : ''}</span></div>
            {!editing && <Why text={proposal?.reasons?.attributes} />}
            <div className="card card-flush">
              {ATTRIBUTES.map((k) => (
                <div key={k} className="row cn-trait">
                  <div className="grow"><div className="row-t">{t(ATTRIBUTE_INFO[k].name)}</div><div className="row-s">{t(ATTRIBUTE_INFO[k].text)}</div></div>
                  {editing
                    ? <Stepper label={t(ATTRIBUTE_INFO[k].name)} value={draft.attributes[k]} max={5} onChange={(v) => set((d) => { d.attributes[k] = v; })} />
                    : <div className="row-end"><Pips value={draft.attributes[k]} /><b className={`cn-lv${draft.attributes[k] === 0 ? ' zero' : ''}`}>{draft.attributes[k]}</b></div>}
                </div>
              ))}
            </div>
            {issues('attributes')}
          </section>
        </div>

        {/* ===== Summary: follows every change ===== */}
        <Summary c={c} sheet={sheet} rules={rules} />

        {/* ===== Second block ===== */}
        <div className="cn-col-b">
          {editing && rules.ancestries.length > 1 && (
            <section className="sec">
              <div className="sec-h"><h2>{t('Ancestry')}</h2><span className="t-xs t-2">{pointsB(c.parts.ancestry)}</span></div>
              <div className="grid grid-2" role="group" aria-label={t('Ancestry')}>
                {rules.ancestries.map((x) => (
                  <button key={x.id} type="button" className={`choice${x.id === ancestry.id ? ' is-on' : ''}`} aria-pressed={x.id === ancestry.id} onClick={() => setAncestry(x.id)}>
                    <span className="dotmark" aria-hidden="true" />
                    <span className="grow">
                      <span className="choice-t cn-blk">{t(x.name)} <span className="tag cn-in-title">{pointsB(ancestryCost(x))}</span></span>
                      <span className="choice-d cn-blk">{t(x.text)}</span>
                      {brings(x) && <span className="choice-d cn-blk">{t('Brings: {list}', { list: brings(x) })}</span>}
                    </span>
                  </button>
                ))}
              </div>
              {issues('ancestry')}
            </section>
          )}
          {!editing && ancestry.advantages.length + ancestry.disadvantages.length > 0 && (
            <section className="sec">
              <div className="sec-h"><h2>{t('Ancestry')}</h2><span className="t-xs t-2">{pointsB(c.parts.ancestry)}</span></div>
              <div className="card card-flush">
                <div className="row cn-trait"><div className="grow"><div className="row-t">{t(ancestry.name)}</div><div className="row-s">{t(ancestry.text)}</div><div className="row-s">{t('Brings: {list}', { list: brings(ancestry) })}</div></div></div>
              </div>
            </section>
          )}

          {focus && (
            <section className="sec">
              <div className="sec-h"><h2>{editing ? t('Paths') : t('Paths and starting abilities')}</h2><span className="t-xs t-2">{pointsB(c.parts.paths)}{editing ? ` · ${t('1 a level, no higher than {cap}', { cap: rules.pathCap })}` : ''}</span></div>
              {!editing && <Why text={proposal?.reasons?.paths} />}
              <div className="card card-flush">
                {editing ? PATHS.map((k) => (
                  <div key={k} className="row cn-trait">
                    <div className="grow"><div className="row-t">{t(PATH_INFO[k].name)}</div><div className="row-s">{t(PATH_INFO[k].text)}</div></div>
                    <Stepper label={t(PATH_INFO[k].name)} value={draft.paths[k] ?? 0} max={rules.pathCap} onChange={(v) => setPath(k, v)} />
                  </div>
                )) : (
                  <>
                    {pathsUp.map((k) => (
                      <div key={k} className="row cn-trait">
                        <div className="grow"><div className="row-t">{t(PATH_INFO[k].name)}</div><div className="row-s">{t(PATH_INFO[k].text)}</div></div>
                        <div className="row-end"><Pips value={draft.paths[k] ?? 0} limit={rules.pathCap} /><b className="cn-lv">{draft.paths[k]}</b></div>
                      </div>
                    ))}
                    {pathsDown.length > 0 && (
                      <div className="row cn-trait is-zero">
                        <div className="grow"><div className="row-t">{pathsDown.map((k) => t(PATH_INFO[k].name)).join(', ')}</div><div className="row-s">{t('Left at 0. Paths can grow later, with experience.')}</div></div>
                        <div className="row-end"><Pips value={0} limit={rules.pathCap} /><b className="cn-lv zero">0</b></div>
                      </div>
                    )}
                  </>
                )}
              </div>
              {issues('paths')}
              {!editing && known.length > 0 && (
                <div className="grid grid-2">{known.map((ab) => <AbilityCard key={ab.id} ab={ab} />)}</div>
              )}
              {!editing && issues('abilities')}
            </section>
          )}

          {rules.powers === 'gift' && (
            <section className="sec">
              <div className="sec-h"><h2>{t('Your power')}</h2><span className="t-xs t-2">{pointsB(c.parts.gift)}{editing ? ` · ${t('1 a rank, no higher than {cap}', { cap: GIFT_RANK_START })}` : ''}</span></div>
              {!editing && <Why text={proposal?.reasons?.paths} />}
              {!draft.gift ? (
                <div className="card stack">
                  <p className="t-2">{t('No power of their own. That is allowed in this world, and one can awaken later in the story, for experience.')}</p>
                  {editing && <button type="button" className="btn btn-soft btn-fit" onClick={() => set((d) => { d.gift = { name: '', text: '', limit: '', rank: 1, kinds: [], moves: [] }; })}><Icon name="plus" size={18} />{t('Give them a power')}</button>}
                </div>
              ) : !editing ? (
                <>
                  <GiftCard gift={draft.gift} />
                  {draft.gift.moves.length > 0 && <div className="grid grid-2">{draft.gift.moves.map((mv) => <MoveCard key={mv.id} move={mv} />)}</div>}
                </>
              ) : (
                <GiftEditor gift={draft.gift} setGift={setGift} remove={() => set((d) => { d.gift = null; })} />
              )}
              {issues('gift')}
              {issues('paths')}
            </section>
          )}

          {focus && editing && (
            <section className="sec">
              <div className="sec-h"><h2>{t('Starting abilities')}</h2><span className="t-xs t-2"><T text="<b>{n}</b> of {room} chosen · one for each path level" vars={{ n: draft.abilities.length, room: c.abilityRoom }} /></span></div>
              {pathsUp.length === 0
                ? <p className="help">{t('Raise a path to choose a starting ability from it.')}</p>
                : (
                  <div className="grid grid-2">
                    {pathsUp.flatMap((k) => abilitiesOf(k).filter((ab) => ab.tier <= Math.min(draft.paths[k] ?? 0, STARTING_TIER))).map((ab) => {
                      const on = draft.abilities.includes(ab.id);
                      return <AbilityCard key={ab.id} ab={ab} pick={{ on, full: !on && draft.abilities.length >= c.abilityRoom, toggle: () => toggleAbility(ab.id) }} />;
                    })}
                  </div>
                )}
              {issues('abilities')}
              <p className="help">{t('Abilities of the first two tiers are common knowledge. Every other one has to be found in the story and then learned.')}</p>
            </section>
          )}

          <section className="sec">
            <div className="sec-h"><h2>{t('Skills')}</h2><span className="t-xs t-2">{pointsB(c.parts.skills)}{editing ? ` · ${t('2 each')}` : ''}</span></div>
            {!editing && <Why text={proposal?.reasons?.skills} />}
            {editing && (
              <div className="chips cn-chips" role="group" aria-label={t('Skills')}>
                {SKILLS.map((sk) => (
                  <button key={sk} type="button" className="chip cn-chip" aria-pressed={draft.skills.includes(sk)} title={t(SKILL_INFO[sk])} onClick={() => toggleSkill(sk)}>
                    <span><Icon name="check" size={14} strong />{t(sk)}</span>
                  </button>
                ))}
              </div>
            )}
            {draft.skills.length > 0 && (
              <div className="card card-flush">
                {draft.skills.map((sk) => (
                  <div key={sk} className="row cn-trait">
                    <div className="grow"><div className="row-t">{t(sk)}</div><div className="row-s">{t(SKILL_INFO[sk] ?? '')}</div></div>
                    <div className="row-end"><span className="tag">{pointsB(2)}</span></div>
                  </div>
                ))}
              </div>
            )}
            {!editing && draft.skills.length === 0 && <p className="help">{t('No skills. A test that needs one is harder without it.')}</p>}
            {issues('skills')}
            {editing && (
              <details className="cn-more">
                <summary className="link">{t('What each skill covers')}</summary>
                <dl className="cn-skills">{SKILLS.map((sk) => <div key={sk}><dt>{t(sk)}</dt><dd>{t(SKILL_INFO[sk])}</dd></div>)}</dl>
              </details>
            )}
            {editing && <p className="help">{t('With the right skill an easy test succeeds without a roll, a medium test is rolled at the attribute + 1 and a hard one at the attribute − 2.')}</p>}
          </section>

          {(['advantage', 'disadvantage'] as const).map((kind) => {
            const own = listOf(draft, kind);
            const given = kind === 'advantage' ? ancestry.advantages : ancestry.disadvantages;
            const adv = kind === 'advantage';
            const head = adv
              ? pointsB(c.parts.advantages)
              : editing ? <T text="<b>{n}</b> of {limit} points back" vars={{ n: c.fromDrawbacks, limit: c.drawbackLimit }} /> : <>{rich(tn(c.fromDrawbacks, 'Give back <b>{n}</b> point', 'Give back <b>{n}</b> points'))}{c.drawbackPoints >= c.drawbackLimit ? ` · ${t('the limit for {level}', { level: t(levelName(rules.level)) })}` : ''}</>;
            return (
              <section key={kind} className="sec">
                <div className="sec-h"><h2>{adv ? t('Advantages') : t('Drawbacks')}</h2><span className="t-xs t-2">{head}</span></div>
                {!editing && adv && <Why text={proposal?.reasons?.traits} />}
                {(own.length > 0 || given.length > 0) && (
                  <div className="card card-flush">
                    {given.map((w) => {
                      const info = traitInfo(w, kind);
                      return (
                        <div key={`g-${w}`} className="row cn-trait cn-given">
                          <div className="grow"><div className="row-t">{traitName(info.written)}</div><div className="row-s">{t(info.summary)}</div></div>
                          <div className="row-end"><span className="tag">{t(ancestry.name)}</span></div>
                        </div>
                      );
                    })}
                    {own.map((w, i) => {
                      const info = traitInfo(w, kind);
                      const def = traitDef(w);
                      const cost = adv ? <span className="tag">{pointsB(info.points)}</span> : <span className="tag tag-ok">+{info.points}</span>;
                      if (!editing) {
                        return (
                          <div key={i} className="row cn-trait">
                            <div className="grow"><div className="row-t">{traitName(info.written)}</div><div className="row-s">{t(info.summary)}</div></div>
                            <div className="row-end">{info.effect && <span className="tag tag-accent only-desktop">{t(info.effect)}</span>}{cost}</div>
                          </div>
                        );
                      }
                      const needs = def?.detail;
                      const id = `cn-${kind}-${i}`;
                      return (
                        <div key={i} className="cn-opt">
                          <button type="button" className="row cn-trait cn-opt-b" aria-pressed="true" aria-label={t('Remove {name}', { name: traitName(info.written) })} onClick={() => removeTrait(kind, i)}>
                            <span className="cn-box" aria-hidden="true"><Icon name="check" size={14} strong /></span>
                            <span className="grow"><span className="row-t">{needs ? t(def.name) : traitName(info.written)}</span><span className="row-s">{t(info.summary)}</span></span>
                            <span className="row-end">{cost}</span>
                          </button>
                          {needs && def && (
                            <div className="cn-detail">
                              <label className="label" htmlFor={id}>{t(needs)}</label>
                              <input
                                className={`input${traitDetail(w) ? '' : ' is-bad'}`} id={id} type="text" value={traitDetail(w)} maxLength={48} autoComplete="off"
                                autoFocus={fresh === `${kind}:${i}`} onBlur={() => setFresh(null)}
                                onChange={(e) => describeTrait(kind, i, def, e.target.value)}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {!editing && own.length === 0 && given.length === 0 && <p className="help">{adv ? t('None.') : t('None. Drawbacks give points back, and give the story something to use.')}</p>}
                {issues(adv ? 'advantages' : 'disadvantages')}
                {editing && (
                  <button type="button" className="btn cn-add" onClick={() => setAdding(kind)}><Icon name="plus" size={18} />{adv ? t('Add an advantage') : t('Add a drawback')}</button>
                )}
                {editing && !adv && c.drawbackPoints >= c.drawbackLimit && (
                  <p className="help">{t('A {level} gets back {limit} points at most. You are at the limit: one more drawback would add to the story, not to the budget.', { level: t(levelName(rules.level)), limit: c.drawbackLimit })}</p>
                )}
              </section>
            );
          })}

          <section className="sec">
            <div className="sec-h"><h2>{t('What you carry')}</h2></div>
            <div className="card card-flush">
              {carrying.map((it, i) => (
                <div key={`${it.name}-${i}`} className="row cn-trait">
                  <div className="grow"><div className="row-t">{it.name}</div>{it.text && <div className="row-s">{it.text}</div>}</div>
                  {editing && <button type="button" className="ib" aria-label={t('Leave {name} behind', { name: it.name })} onClick={() => setCarrying(carrying.filter((_, j) => j !== i))}><Icon name="x" size={18} /></button>}
                </div>
              ))}
              <div className="row cn-trait cn-given">
                <div className="grow">
                  <div className="row-t">{dressings === 0 ? silver : dressings === 1 ? t('{money} and a roll of bandages', { money: silver }) : t('{money} and {rolls} rolls of bandages', { money: silver, rolls: dressings })}</div>
                  <div className="row-s">
                    {t('Given by the rules when the story begins.')}{' '}{wealth !== 'usual' ? <>{wealth === 'wealthy' ? t('Wealth sets the money.') : t('Poor sets the money.')}{' '}</> : null}
                    {dressings > 0 ? t('Each roll of bandages restores 5 hit points.') : t('No bandages in the Brutal style.')}
                  </div>
                </div>
              </div>
            </div>
            {carrying.length === 0 && <p className="help">{t('Nothing else yet. What you pick up in the story is added to your inventory.')}</p>}
          </section>

          <StartingCompanions template={template} value={companions} onChange={setCompanions} />

          <section className="sec">
            <div className="sec-h"><h2>{t('This story')}</h2></div>
            <div className="card stack">
              <div className="f">
                <label className="label" htmlFor="cn-title">{t('Title')}</label>
                <input className="input" id="cn-title" type="text" value={title} maxLength={60} autoComplete="off" placeholder={template.opening.title || template.world.name} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="f">
                <span className="label" id="cn-style">{t('Table style')}</span>
                <div className="seg" role="group" aria-labelledby="cn-style">
                  {STYLES.map((s) => <button key={s.id} type="button" aria-pressed={style === s.id} onClick={() => setStyle(s.id)}>{t(s.name)}</button>)}
                </div>
                <p className="help">{(() => { const cur = STYLES.find((s) => s.id === style); return cur ? t(cur.text, { n: cur.n }) : null; })()}{style !== template.world.rules.style ? ` ${t('This world is usually played as {style}.', { style: t(STYLES.find((s) => s.id === template.world.rules.style)?.name ?? '') })}` : ''}</p>
              </div>
              <EndingChoice id="cn-end" ending={ending.ending} length={ending.length} onChange={(patch) => setEnding((cur) => ({ ...cur, ...patch }))} />
              {a.nextLegend?.worldId === template.id && <p className="help"><Icon name="flag" size={14} /> {t('Remembered in this world: {legend}', { legend: a.nextLegend.text })}</p>}
            </div>
          </section>
        </div>
      </div>

      {adding && (
        <TraitPicker
          powers={rules.powers} kind={adding} draft={draft} ancestry={ancestry} c={c} level={t(levelName(rules.level))}
          onAdd={addTrait} onRemove={(index) => removeTrait(adding, index)} onClose={() => setAdding(null)}
        />
      )}
    </FlowPage>
  );
}

/** What an ancestry brings, as a line: its traits as they are written on a sheet. */
function brings(x: Ancestry): string {
  return [...x.advantages, ...x.disadvantages].map(traitName).join(' · ');
}

/** Why a part of the proposal is as it is. */
function Why({ text }: { text?: string | null }) {
  if (!text?.trim()) return null;
  return <p className="cn-why"><Icon name="spark" size={14} /><span>{text}</span></p>;
}

/** A level from 0 to 5 as five blocks. Blocks above the world's limit are drawn hollow. */
function Pips({ value, limit = 5 }: { value: number; limit?: number }) {
  return (
    <span className="pips" role="img" aria-label={limit < 5 ? t('{value}, the limit is {limit}', { value, limit }) : t('{value} of 5', { value })}>
      {[0, 1, 2, 3, 4].map((i) => <i key={i} className={i < value ? 'on' : i >= limit ? 'above' : undefined} />)}
    </span>
  );
}

/**
 * A power of one's own, being written: what it is, its rank, and its moves. A new character has at
 * most one move for each rank and none above the tier a story can start with, so the list here is
 * never longer than three.
 */
function GiftEditor({ gift, setGift, remove }: { gift: Gift; setGift: (fn: (g: Gift) => void) => void; remove: () => void }) {
  const top = (rank: number) => Math.max(1, GIFT_AT_START.tier(rank));
  const room = GIFT_AT_START.moves(gift.rank);
  const setRank = (v: number) => setGift((g) => {
    g.rank = v;
    // What no longer fits the rank is let go: moves beyond one a rank, and tiers above it.
    g.moves = g.moves.slice(0, GIFT_AT_START.moves(v));
    for (const mv of g.moves) { mv.tier = Math.min(mv.tier, top(v)); if (mv.fight && !fightEffect(mv.fight, mv.tier)) delete mv.fight; }
  });
  const setMove = (id: string, fn: (mv: GiftMove) => void) => setGift((g) => { const mv = g.moves.find((x) => x.id === id); if (mv) fn(mv); });
  return (
    <>
      <div className="card stack">
        <GiftFields gift={gift} prefix="cn-gift" onChange={(patch) => setGift((g) => { Object.assign(g, patch); })} onToggleKind={(k) => setGift((g) => toggleKind(g, k))} />
        <div className="gf-row">
          <div className="grow">
            <span className="label">{t('Rank ((power))')}</span>
            <p className="help">{t('How far any use of it reaches: 1 arm’s length, 2 a room, 3 a building. It grows with experience, to {max}.', { max: GIFT_RANK_MAX })}</p>
          </div>
          <Stepper label={t('Rank ((power))')} value={gift.rank} min={1} max={GIFT_RANK_START} onChange={setRank} />
        </div>
      </div>

      <div className="sec-h"><h3>{t('Moves')}</h3><span className="t-xs t-2"><T text="<b>{n}</b> of {room} written · one for each rank" vars={{ n: gift.moves.length, room }} /></span></div>
      {gift.moves.map((mv, i) => (
        <div key={mv.id} className="card gf-edit">
          <div className="f">
            <label className="label" htmlFor={`cn-move-n-${mv.id}`}>{t('Move {n}', { n: i + 1 })}</label>
            <input className={`input${mv.name.trim() ? '' : ' is-bad'}`} id={`cn-move-n-${mv.id}`} type="text" value={mv.name} maxLength={GIFT_TEXT.moveName} autoComplete="off" placeholder={t('What you call it')} onChange={(e) => setMove(mv.id, (x) => { x.name = e.target.value; })} />
          </div>
          <div className="f">
            <label className="label" htmlFor={`cn-move-t-${mv.id}`}>{t('What you do')}</label>
            <textarea className="input gf-auto" id={`cn-move-t-${mv.id}`} rows={2} value={mv.text} maxLength={GIFT_TEXT.moveText} onChange={(e) => setMove(mv.id, (x) => { x.text = e.target.value; })} />
          </div>
          <div className="gf-row">
            <div className="grow">
              <span className="label">{t('Tier')}</span>
              <p className="help">{t('Its reach, and its cost: {cost} energy a use.', { cost: mv.tier })}</p>
            </div>
            <Stepper label={t('Tier of {name}', { name: mv.name.trim() || t('Move {n}', { n: i + 1 }) })} value={mv.tier} min={1} max={top(gift.rank)} onChange={(v) => setMove(mv.id, (x) => { x.tier = v; if (x.fight && !fightEffect(x.fight, v)) delete x.fight; })} />
          </div>
          <div className="f">
            <span className="label" id={`cn-move-f-${mv.id}`}>{t('In a fight')}</span>
            <div className="chips gf-chips" role="group" aria-labelledby={`cn-move-f-${mv.id}`}>
              <button type="button" className="chip" aria-pressed={!mv.fight} onClick={() => setMove(mv.id, (x) => { delete x.fight; })}><span>{t('Nothing')}</span></button>
              {/* A move does something in a fight: copying or taking a power is not one of those. */}
              {gift.kinds.filter(isEffectKind).map((k) => {
                const effect = fightEffect(k, mv.tier);
                return (
                  <button key={k} type="button" className="chip" aria-pressed={mv.fight === k} disabled={!effect} title={effect ? fightLine(effect) : t(KIND_INFO[k].text)} onClick={() => setMove(mv.id, (x) => { x.fight = k; })}>
                    <span>{t(KIND_INFO[k].name)}{effect && 'value' in effect ? ` ${effect.value}` : ''}</span>
                  </button>
                );
              })}
            </div>
            {mv.fight && fightEffect(mv.fight, mv.tier) && <p className="help">{cap(fightLine(fightEffect(mv.fight, mv.tier)!))}.</p>}
            {gift.kinds.length === 0 && <p className="help">{t('Choose above what the power can do in a fight, and a move can do one of those.')}</p>}
          </div>
          <button type="button" className="link link-tap" onClick={() => setGift((g) => { g.moves = g.moves.filter((x) => x.id !== mv.id); })}>{t('Remove this move')}</button>
        </div>
      ))}
      <div className="gf-acts">
        <button type="button" className="btn btn-soft btn-fit" disabled={gift.moves.length >= room} onClick={() => setGift((g) => { g.moves.push({ id: nextMoveId(g.moves), name: '', tier: 1, text: '' }); })}><Icon name="plus" size={18} />{t('Add a move')}</button>
        <button type="button" className="link link-tap" onClick={remove}>{t('Remove the power')}</button>
      </div>
      <p className="help">{t('A move is something you can always do, for energy. Anything else your power could do can be tried in the story, at a Skill test and one more energy; what works can be kept as a new move. Moves above tier {tier} are found that way.', { tier: STARTING_TIER })}</p>
    </>
  );
}

/** An ability: its name, path and tier, what it costs and what it does. With `pick` it can be ticked. */
function AbilityCard({ ab, pick }: { ab: Ability; pick?: { on: boolean; full: boolean; toggle: () => void } }) {
  const body = (
    <>
      <div className="cn-abil-h">
        {pick && <span className="cn-box" aria-hidden="true"><Icon name="check" size={14} strong /></span>}
        <h3 className="card-n">{t(ab.name)}</h3>
        <span className="tag">{t(PATH_INFO[ab.path].name)} <b>{ab.tier}</b></span>
        <span className="cn-abil-c"><Icon name="bolt" size={14} fill />{t('{cost} energy', { cost: ab.cost })}</span>
      </div>
      <p className="cn-abil-d">{t(ab.text)}</p>
    </>
  );
  if (!pick) return <article className="card cn-abil">{body}</article>;
  return <button type="button" className="card cn-abil cn-pick" aria-pressed={pick.on} disabled={pick.full} onClick={pick.toggle}>{body}</button>;
}

/** The points: spent of budget, as a bar. `short` is the one-line form that rides in the foot on a phone. */
function Budget({ c, className = '', short = false }: { c: CharacterCheck; className?: string; short?: boolean }) {
  const over = c.left < 0;
  const left = <span className={`num ${over ? 't-err' : 't-2'}`}>{over ? t('{n} over', { n: -c.left }) : t('{n} left', { n: c.left })}</span>;
  return (
    <div className={`budget${over ? ' is-over' : ''} ${className}`} style={{ '--v': `${Math.min(100, Math.round((100 * c.spent) / Math.max(1, c.budget)))}%` } as CSSProperties}>
      <div className="between">
        {short
          ? <span><T text="<num>{spent}</num> of {budget} points" vars={{ spent: c.spent, budget: c.budget, num: (inner) => <b className="num">{inner}</b> }} />{' '}<span className="t-2">{t('· {base} + {back} from drawbacks', { base: c.base, back: c.fromDrawbacks })}</span></span>
          : <span><T text="<lv>{spent}</lv> of {budget} spent" vars={{ spent: c.spent, budget: c.budget, lv: (inner) => <b className="cn-lv">{inner}</b> }} /></span>}
        {left}
      </div>
      <div className="track"><i /></div>
    </div>
  );
}

/** A fight number written as a sum; the die still to be rolled is the white die with a question mark. */
function Sum({ label, parts }: { label: string; parts: [string, number][] }) {
  return (
    <div className="cn-calc">
      <span>{t(label)}</span>
      <div className="cn-sum">
        {parts.map(([k, v]) => (
          <Fragment key={k}><span className="stat"><span>{t(k)}</span><b>{v}</b></span><span className="cn-op" aria-hidden="true">+</span></Fragment>
        ))}
        <span className="die die-s cn-die" role="img" aria-label={t('plus one die')}>?</span>
      </div>
    </div>
  );
}

function Summary({ c, sheet, rules }: { c: CharacterCheck; sheet: Sheet; rules: CreationRules }) {
  const quick = has(sheet.advantages, 'quick reflexes');
  const extras = [
    has(sheet.advantages, 'tough') ? t('{trait} adds 3 hit points', { trait: t(traitDef('tough')?.name ?? 'Tough') }) : '',
    has(sheet.disadvantages, 'frail') ? t('{trait} takes 3 hit points away', { trait: t(traitDef('frail')?.name ?? 'Frail') }) : '',
    has(sheet.advantages, 'deep reserves') ? t('{trait} adds 3 energy', { trait: t(traitDef('deep reserves')?.name ?? 'Deep Reserves') }) : '',
  ].filter(Boolean);
  return (
    <aside className="card cn-sumry" aria-label={t('Summary')}>
      <div className="only-desktop">
        <div className="cn-sumry-b">
          <h2 className="card-t">{t('Points')}</h2>
          <Budget c={c} />
          <p className="help">{t('{base} for a {level} + {back} from drawbacks', { base: c.base, level: t(levelName(rules.level)), back: c.fromDrawbacks })}</p>
          <ul className="cn-tally">
            <li className="between"><span className="t-2">{t('Attributes')}</span><b className="num">{c.parts.attributes}</b></li>
            {rules.powers === 'focus' && <li className="between"><span className="t-2">{t('Paths')}</span><b className="num">{c.parts.paths}</b></li>}
            {rules.powers === 'gift' && <li className="between"><span className="t-2">{t('Your power')}</span><b className="num">{c.parts.gift}</b></li>}
            <li className="between"><span className="t-2">{t('Skills')}</span><b className="num">{c.parts.skills}</b></li>
            <li className="between"><span className="t-2">{t('Advantages')}</span><b className="num">{c.parts.advantages}</b></li>
            {rules.ancestries.length > 1 && <li className="between"><span className="t-2">{t('Ancestry')}</span><b className="num">{c.parts.ancestry}</b></li>}
          </ul>
        </div>
      </div>
      <div className="stack">
        <h2 className="card-t">{t('With these numbers')}</h2>
        <div className="meters">
          <div className="cn-vital hp" style={{ '--v': '100%' } as CSSProperties}>
            <div className="m-top"><span className="m-k"><Icon name="heart" size={14} fill />{t('Hit points')}</span><span className="m-v"><b>{c.hp}</b></span></div>
            <div className="track"><i /></div>
          </div>
          <div className="cn-vital en" style={{ '--v': '100%' } as CSSProperties}>
            <div className="m-top"><span className="m-k"><Icon name="bolt" size={14} fill />{t('Energy')}</span><span className="m-v"><b>{c.energy}</b></span></div>
            <div className="track"><i /></div>
          </div>
        </div>
        <p className={`help${sheet.resistance === 0 ? ' t-err' : ''}`}>
          {sheet.resistance === 0 ? t('With Resistance 0 a single blow ends a fight, and there is no energy for abilities.') : t('Each is 5 × Resistance {n}.', { n: sheet.resistance })}
          {extras.length ? ` ${extras.join('; ')}.` : ''}
        </p>
        <div className="cn-calcs">
          <Sum label={m('Attack')} parts={[[m('Strength'), sheet.strength], [m('Skill'), sheet.skill]]} />
          {sheet.firepower > 0 && <Sum label={m('At range')} parts={[[m('Firepower'), sheet.firepower], [m('Skill'), sheet.skill]]} />}
          <Sum label={m('Defence')} parts={[[m('Armor'), sheet.armor], [m('Skill'), sheet.skill]]} />
          <Sum label={m('Initiative')} parts={quick ? [[m('Skill'), sheet.skill], [m('Reflexes'), 1]] : [[m('Skill'), sheet.skill]]} />
        </div>
        <p className="help">{t('A 6 on the die doubles Strength when you attack and Armor when you defend.')}{sheet.firepower > 0 ? ` ${t('You attack at range when Firepower is higher than Strength, and the 6 then doubles Firepower.')}` : ''}</p>
      </div>
    </aside>
  );
}

/**
 * Every advantage, or every drawback, to choose from. The catalogue is long, so it opens over the
 * page: what changes a number first, then what the narrator plays. A trait that needs particulars
 * (whose patron, which fear) can be taken more than once; it is added and its field opens in the sheet.
 */
function TraitPicker({ kind, powers, draft, ancestry, c, level, onAdd, onRemove, onClose }: {
  kind: TraitKind; powers: PowersMode; draft: CharacterDraft; ancestry: Ancestry; c: CharacterCheck; level: string;
  onAdd: (def: TraitDef) => void; onRemove: (index: number) => void; onClose: () => void;
}) {
  const adv = kind === 'advantage';
  const own = adv ? draft.advantages : draft.disadvantages;
  const given = new Set([...ancestry.advantages, ...ancestry.disadvantages].filter((w) => !traitDef(w)?.detail).map(defName));
  const held = new Set([...draft.advantages, ...draft.disadvantages, ...ancestry.advantages, ...ancestry.disadvantages].map(defName));
  const hl = (inner: ReactNode) => <b className="cn-b">{inner}</b>;
  const groups: { title: string; note: string; list: TraitDef[] }[] = [
    { title: m('Schools of power'), note: m('Powers in this world. Each is every ability of its paths.'), list: traitsFor(kind, powers).filter((d) => !!d.only) },
    { title: m('Changes a number'), note: m('Applied by the rules, every time.'), list: traitsFor(kind, powers).filter((d) => !d.only && d.how === 'rules') },
    { title: m('Played by the narrator'), note: m('A fact about you that the story uses.'), list: traitsFor(kind, powers).filter((d) => d.how === 'story') },
  ].filter((g) => g.list.length > 0);
  return (
    <Modal title={adv ? t('Add an advantage') : t('Add a drawback')} onClose={onClose} foot={<button type="button" className="btn btn-primary" onClick={onClose}>{t('Done')}</button>}>
      <p className="t-sm t-2">
        {adv
          ? c.left < 0
            ? rich(tn(-c.left, 'You are <hl>{n}</hl> point over your {budget}.', 'You are <hl>{n}</hl> points over your {budget}.', { budget: c.budget }), { hl })
            : rich(tn(c.left, 'You have <hl>{n}</hl> point left of {budget}.', 'You have <hl>{n}</hl> points left of {budget}.', { budget: c.budget }), { hl })
          : <T text="A {level} gets back {limit} points at most; you have <hl>{n}</hl>. More drawbacks than that add to the story, not to the budget." vars={{ level, limit: c.drawbackLimit, n: c.fromDrawbacks, hl }} />}
      </p>
      {groups.map((g) => (
        <section key={g.title} className="sec">
          <div className="sec-h"><h3>{t(g.title)}</h3><span className="t-xs t-2">{t(g.note)}</span></div>
          <div className="card card-flush">
            {g.list.map((def) => {
              const key = def.name.toLowerCase();
              const index = def.detail ? -1 : own.findIndex((w) => defName(w) === key);
              const fromAncestry = given.has(key);
              const clash = def.against && held.has(def.against) ? traitDef(def.against)?.name ?? def.against : null;
              const count = def.detail ? own.filter((w) => defName(w) === key).length : 0;
              const on = index >= 0;
              return (
                <button
                  key={def.name} type="button" className="row cn-trait cn-opt-b" aria-pressed={on} disabled={fromAncestry || (!!clash && !on)}
                  onClick={() => (on ? onRemove(index) : onAdd(def))}
                >
                  <span className="cn-box" aria-hidden="true"><Icon name={def.detail ? 'plus' : 'check'} size={14} strong /></span>
                  <span className="grow">
                    <span className="row-t">{t(def.name)}{def.detail ? <span className="cn-detail-k"> · {t(def.detail).toLowerCase()}</span> : null}</span>
                    <span className="row-s">{fromAncestry ? t('Comes with being {name}.', { name: t(ancestry.name) }) : clash ? t('Cannot be true together with {clash}.', { clash: t(clash) }) : t(def.summary)}</span>
                    {def.effect && !fromAncestry && !clash && <span className="row-s t-accent">{t(def.effect)}</span>}
                    {count > 0 && <span className="row-s">{count === 1 ? t('Taken once. Take it again for someone or something else.') : t('Taken {n} times. Take it again for someone or something else.', { n: count })}</span>}
                  </span>
                  <span className="row-end">{adv ? <span className="tag">{pointsB(def.points)}</span> : <span className="tag tag-ok">+{def.points}</span>}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </Modal>
  );
}
