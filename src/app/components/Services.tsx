// Settings: the services that can play the game and their keys, the model of each role, and the list
// a model is chosen from. A game can run wholly on Claude, Venice or NanoGPT, or on a mix, one role at
// a time; each request goes only to the service its model belongs to.
import { useEffect, useMemo, useRef, useState } from 'react';
import { MODELS, PRESETS, SERVICES, SERVICE_NAME, modelInfo, ownModelId, roleModels, serviceOf, type ModelInfo, type Preset, type RoleModels, type Service } from '../../game/llm/models';
import { LlmError } from '../../game/llm/transport';
import { listOf, m, num, t } from '../../i18n';
import { useApp, type AppSettings } from '../app';
import { Row, Seg, Switch } from '../screens/Settings';
import { SERVICE_INFO, modelsOf } from '../services';
import { T } from '../T';
import { Icon, Modal, money } from '../ui';

type Role = keyof RoleModels;

/** What each role does, and what its model must be able to do: answer in a fixed shape, or see pictures. */
const ROLES: { id: Role; label: string; does: string; needs: 'shape' | 'eyes' | null; turn: { read: number; written: number } }[] = [
  { id: 'narrator', label: m('Narrator'), does: m('Writes the story.'), needs: null, turn: { read: 10_000, written: 700 } },
  { id: 'referee', label: m('Referee'), does: m('Reads what you do and decides which rule applies.'), needs: 'shape', turn: { read: 3_000, written: 300 } },
  { id: 'scribe', label: m('Scribe'), does: m('Writes up each scene when it ends.'), needs: 'shape', turn: { read: 4_000, written: 700 } },
  { id: 'architect', label: m('World builder'), does: m('Builds worlds, places and characters.'), needs: 'shape', turn: { read: 8_000, written: 3_000 } },
  { id: 'vision', label: m('Pictures'), does: m('Puts a picture of a companion into words.'), needs: 'eyes', turn: { read: 1_100, written: 110 } },
];

const PRESET_NAMES: { id: Preset; label: string }[] = [{ id: 'budget', label: m('Budget') }, { id: 'balanced', label: m('Balanced') }, { id: 'premium', label: m('Premium') }];

/** Room the world builder needs in one answer: its largest step usually takes about 2,800 tokens, and is allowed up to three times that. */
const BUILD_ROOM = 6000;

const maskKey = (key: string) => (key.length >= 16 ? `${key.slice(0, 6)}${'•'.repeat(12)}${key.slice(-4)}` : '•'.repeat(16));

/** Whether a model can do what a role needs. Claude's models do everything. */
function fits(model: ModelInfo, needs: 'shape' | 'eyes' | null): boolean {
  if (serviceOf(model.id) === 'anthropic') return true;
  if (needs === 'eyes') return model.vision === true;
  return true;
}

/** Why a role's model may disappoint, in a few words, or null. */
function warningFor(model: ModelInfo, role: Role, needs: 'shape' | 'eyes' | null, venicePrivate: boolean): string | null {
  if (serviceOf(model.id) === 'anthropic') return null;
  // Not sent at all comes first: nothing else about the model matters then.
  if (serviceOf(model.id) === 'venice' && venicePrivate && model.privacy !== 'private') return t('Venice passes what is sent to this model on to another company, and “Venice’s own models only” is on: it will not be sent.');
  if (needs === 'eyes' && model.vision !== true) return t('This model cannot see pictures.');
  if (role === 'architect' && model.maxOutput && model.maxOutput < BUILD_ROOM) return t('This model writes at most {n} tokens in one answer; the larger steps of building a world may be cut off.', { n: num(model.maxOutput) });
  if (needs === 'shape' && model.structured !== true) return t('Its answers cannot be held to the shape the game needs, so it is asked in words; now and then an answer will not be usable.');
  return null;
}

// ---------- Services and keys ----------

export function ServiceKeys() {
  const a = useApp();
  const st = a.settings;
  const [removing, setRemoving] = useState<Service | null>(null);
  const keyed = a.keyed;
  return (
    <div className="sets">
      {SERVICES.map((s) => <ServiceRow key={s} service={s} onRemove={() => setRemoving(s)} />)}
      {keyed.length > 0 && (
        <Row label={t('Where the keys are kept')} wrap
          help={st.keep === 'device' ? t('On this device only. Each key is sent only to its own service.') : t('For this session only: the keys are forgotten when you close the app.')}>
          <Seg<AppSettings['keep']> label={t('Where the keys are kept')} value={st.keep}
            options={[{ id: 'device', label: t('This device') }, { id: 'session', label: t('This session') }]}
            onChange={(keep) => void a.keepKeys(keep)} />
        </Row>
      )}
      <Row label={t('Demo narrator')} labelId="set-sw-demo"
        help={a.missingKeys.length && keyed.length
          ? t('On because there is no {services} key on this device: add it above, or choose other models below.', { services: listOf(a.missingKeys.map((x) => SERVICE_NAME[x])) })
          : keyed.length ? t('Canned story text instead of any service. Nothing is sent and nothing is charged.') : t('Canned story text instead of any service. Nothing is sent and nothing is charged. It stays on while there is no key.')}>
        <Switch on={a.usingDemo} labelledBy="set-sw-demo" disabled={keyed.length === 0 || a.missingKeys.length > 0} onChange={(on) => a.setSettings({ demo: on })} />
      </Row>
      {removing && (
        <Modal title={t('Remove the {service} key?', { service: SERVICE_NAME[removing] })} onClose={() => setRemoving(null)} foot={(
          <>
            <button className="btn" type="button" onClick={() => setRemoving(null)}>{t('Keep the key')}</button>
            <button className="btn btn-danger" type="button" onClick={() => { void a.removeServiceKey(removing); setRemoving(null); }}><Icon name="trash" size={18} />{t('Remove the key')}</button>
          </>
        )}>
          <p className="t-2">
            {a.servicesInUse.includes(removing)
              ? t('The key is erased from this device. Your stories and settings stay. Until you add a key again or choose other models, the demo narrator answers and nothing is charged: no part of the game is moved to another service on its own.')
              : t('The key is erased from this device. Nothing in the game uses it now.')}
          </p>
        </Modal>
      )}
    </div>
  );
}

function ServiceRow({ service, onRemove }: { service: Service; onRemove: () => void }) {
  const a = useApp();
  const st = a.settings;
  const info = SERVICE_INFO[service];
  const key = a.keyOf(service);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const id = `key-${service}`;
  useEffect(() => {
    if (key && service !== 'anthropic') void a.refreshBalance(service);
  }, [a, key, service]);

  // A Claude key's state: which of the game's models it can use, as Anthropic said when it was checked.
  const usable = service === 'anthropic' ? Object.values(MODELS).filter((x) => a.available.includes(x.id)).map((x) => x.label) : [];
  const claudeWanted = Object.values(roleModels(st.models)).filter((x) => serviceOf(x) === 'anthropic');
  const missing = service === 'anthropic' && a.available.length > 0 ? [...new Set(claudeWanted)].filter((x) => !a.available.includes(x)).map((x) => modelInfo(x).label) : [];
  const balance = a.balance[service];

  const save = async () => {
    if (!text.trim()) return;
    setChecking(true);
    setProblem('');
    try {
      if (service === 'anthropic') await a.useKey(text, st.keep);
      else await a.useServiceKey(service, text);
      setText('');
      setEditing(false);
    } catch (err) {
      const e = err instanceof LlmError ? err : null;
      setProblem(e?.kind === 'offline' ? t('Could not reach {service}. Check your connection and try again.', { service: info.name })
        : e?.message ?? t('The key could not be checked.'));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="set svc">
      <div className="set-l set-key">
        <span className="label svc-n">{info.name}{a.servicesInUse.includes(service) && (key ? <span className="tag tag-accent">{t('In use')}</span> : <span className="tag">{t('In use · no key')}</span>)}</span>
        <span className="help">{t(info.line)}</span>
        {key && !editing && (
          <>
            <div className="keybox" role="img" aria-label={t('Your {service} key, hidden. It ends in {end}.', { service: info.name, end: key.slice(-4) })}>
              <Icon name="lock" size={18} />
              <span className="mono" aria-hidden="true">{maskKey(key)}</span>
            </div>
            <p className="state">
              {service === 'anthropic'
                ? (a.available.length > 0
                  ? <><b><Icon name="check" size={14} strong />{t('Accepted by Anthropic')}</b><span>{usable.length ? t('It can use {models}.', { models: listOf(usable) }) : t('It can use none of the models in the price table.')}</span></>
                  : <span>{t('Saved. It has not been checked from this device.')}</span>)
                : (typeof balance === 'number'
                  ? <><b><Icon name="check" size={14} strong />{t('Accepted by {service}', { service: info.name })}</b><span>{t('Balance: {amount}.', { amount: money(balance, 2) })}</span></>
                  : balance === null
                    ? <b><Icon name="check" size={14} strong />{t('Accepted by {service}', { service: info.name })}</b>
                    : <span>{t('Saved. It has not been checked from this device.')}</span>)}
            </p>
            {missing.length > 0 && <p className="help t-err">{t('This key cannot use {models}. Choose another preset.', { models: listOf(missing) })}</p>}
          </>
        )}
        {(!key || editing) && (
          <>
            <div className="svc-key">
              <input ref={field} className="input mono" id={id} type="password" autoComplete="off" spellCheck={false} value={text}
                placeholder={key ? t('A key is saved. Paste a new one to replace it') : info.placeholder}
                aria-label={t('Your {service} API key', { service: info.name })}
                onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save(); }} />
              <button className="btn btn-primary" type="button" disabled={!text.trim() || checking} onClick={() => void save()}>{checking ? t('Checking…') : t('Check and save')}</button>
            </div>
            {problem && <p className="help t-err" role="alert">{problem}</p>}
            <details className="how">
              <summary>{t('Where do I get a key?')}<Icon name="down" size={14} strong className="chev" /></summary>
              <ol>{info.steps.map((step) => <li key={step}><T text={step} /></li>)}</ol>
            </details>
            <span className="help">{t(info.check)}</span>
          </>
        )}
        {key && service === 'venice' && (
          <Row label={t('Venice’s own models only')} labelId="set-sw-vpriv" join
            help={t('Private models: Venice runs them and keeps nothing. The others are “anonymized”: Venice passes the text on to the company that runs them. With this on, the game neither offers nor sends to them.')}>
            <Switch on={st.venicePrivate} labelledBy="set-sw-vpriv" onChange={(venicePrivate) => a.setSettings({ venicePrivate })} />
          </Row>
        )}
        {key && service === 'nanogpt' && (
          <Row label={t('Private providers only')} labelId="set-sw-npriv" join
            help={t('Send the story only to providers that promise to keep nothing of it. Some models have no such provider and will not answer.')}>
            <Switch on={st.nanoPrivate} labelledBy="set-sw-npriv" onChange={(nanoPrivate) => a.setSettings({ nanoPrivate })} />
          </Row>
        )}
        {key && service === 'nanogpt' && (
          <span className="help">{t('The game asks NanoGPT not to blank out names or other personal details in what it sends, so that the story arrives whole.')}</span>
        )}
        {key && (
          <div className="btns svc-acts">
            {editing
              ? <button className="btn" type="button" onClick={() => { setEditing(false); setText(''); setProblem(''); }}>{t('Cancel')}</button>
              : <button className="btn" type="button" onClick={() => { setEditing(true); setTimeout(() => field.current?.focus(), 0); }}><Icon name="refresh" size={18} />{t('Replace')}</button>}
            <button className="btn btn-danger" type="button" onClick={onRemove}><Icon name="trash" size={18} />{t('Remove')}</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- The model of each role ----------

export function ModelsSection() {
  const a = useApp();
  const st = a.settings;
  const models = roleModels(st.models);
  const inUse = a.servicesInUse;
  const whole: Service | null = inUse.length === 1 ? inUse[0]! : null;
  const [busy, setBusy] = useState<Service | null>(null);
  const [problem, setProblem] = useState('');
  const [picking, setPicking] = useState<Role | null>(null);

  const playOn = async (service: Service) => {
    if (service === whole) return;
    setProblem('');
    if (!a.keyOf(service)) { setProblem(t('Add a {service} key above first.', { service: SERVICE_NAME[service] })); return; }
    setBusy(service);
    try {
      await a.useService(service);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : t('The list of models could not be read.'));
    } finally {
      setBusy(null);
    }
  };

  // Claude reading what another service wrote: the case the player must know about.
  const narratorAt = serviceOf(models.narrator);
  const claudeReads = narratorAt !== 'anthropic' && (serviceOf(models.referee) === 'anthropic' || serviceOf(models.scribe) === 'anthropic');
  const infos = Object.values(models).map(modelInfo);
  const allPrivate = infos.every((x) => serviceOf(x.id) !== 'anthropic' && x.privacy === 'private');
  // A model its service hands on to the company that runs it: that company sees what is sent to it too.
  const passedOn = infos.some((x) => serviceOf(x.id) !== 'anthropic' && x.privacy !== 'private');

  return (
    <div className="sets">
      <Row label={t('Who plays the game')} wrap
        help={busy ? t('Choosing a model for each part from {service}’s list…', { service: SERVICE_NAME[busy] })
          : whole ? t('Every part of the game is played on {service}. You can still change any part below.', { service: SERVICE_NAME[whole] })
            : t('A mix: each part of the game is played on the service of its model, below.')}>
        <Seg<Service> label={t('Who plays the game')} value={whole} options={SERVICES.map((s) => ({ id: s, label: SERVICE_NAME[s] }))} onChange={(s) => void playOn(s)} />
      </Row>
      {problem && <p className="help t-err" role="alert">{problem}</p>}
      {whole === 'anthropic' && (
        <Row label={t('Preset')} help={presetHelp(st.preset)} wrap>
          <Seg label={t('Preset')} value={st.preset === 'custom' ? null : st.preset} options={PRESET_NAMES.map((p) => ({ ...p, label: t(p.label) }))} onChange={(preset) => a.setSettings({ preset })} />
        </Row>
      )}
      {ROLES.map((r) => {
        const info = modelInfo(models[r.id]);
        const service = serviceOf(info.id);
        const warn = !a.keyOf(service)
          ? t('There is no {service} key on this device: add it above, or choose another model.', { service: SERVICE_NAME[service] })
          : warningFor(info, r.id, r.needs, st.venicePrivate);
        return (
          <div key={r.id} className="set set-wrap role">
            <div className="set-l">
              <span className="label">{t(r.label)}</span>
              <span className="help">{t(r.does)}</span>
              {warn && <span className="help t-warn">{warn}</span>}
            </div>
            <button className="btn role-pick" type="button" onClick={() => setPicking(r.id)} aria-label={whole ? t('Change the model of {role}: now {model}', { role: t(r.label), model: info.label }) : t('Change the model of {role}: now {model}, on {service}', { role: t(r.label), model: info.label, service: SERVICE_NAME[service] })}>
              <span className="role-m">{info.label}</span>
              {!whole && <span className="role-s">{SERVICE_NAME[service]}</span>}
              <Icon name="right" size={16} />
            </button>
          </div>
        );
      })}
      {claudeReads && (
        <p className="help t-warn">{t('{service} writes the story, but Claude still judges your actions or keeps the records, so it reads every scene: Anthropic’s usage policy applies to all of it.', { service: SERVICE_NAME[narratorAt] })}</p>
      )}
      <Row help={<>
        {allPrivate
          ? t('What you play goes only to {services}, to models that keep nothing.', { services: listOf(inUse.map((s) => SERVICE_NAME[s])) })
          : passedOn
            ? t('What you play is sent to {services}. Some of these models are run by other companies, which see what is sent to them too.', { services: listOf(inUse.map((s) => SERVICE_NAME[s])) })
            : t('What you play is sent to {services}, and nowhere else.', { services: listOf(inUse.map((s) => SERVICE_NAME[s])) })}
        {' '}
        {a.usingDemo ? t('While the demo narrator is on, none of these models is called: costs are estimated as if they were.') : t('A change applies from the next turn.')}
      </>} />
      {picking && (
        <ModelPicker role={picking} current={models[picking]} onClose={() => setPicking(null)}
          onPick={(model) => { a.chooseModel(picking, model); setPicking(null); }} />
      )}
    </div>
  );
}

function presetHelp(preset: Preset | 'custom'): string {
  if (preset === 'custom') return t('A mix of your own.');
  const set = PRESETS[preset];
  const narrator = modelInfo(set.narrator).label;
  const rest = [...new Set([set.referee, set.scribe])].map((id) => modelInfo(id).label);
  const line = rest.length === 1 && rest[0] === narrator ? t('{model} for every role.', { model: narrator }) : t('{narrator} writes the story; {rest} does the rest.', { narrator, rest: listOf(rest) });
  return preset === 'balanced' ? t('Recommended. {line}', { line }) : line;
}

// ---------- Choosing a model ----------

type Filter = 'all' | 'private' | 'uncensored' | 'roleplay';
const FILTER_LABEL: Record<Filter, string> = { all: m('All'), private: m('Private'), uncensored: m('Uncensored'), roleplay: m('Role-play') };
const FILTERS: Record<Service, Filter[]> = { anthropic: ['all'], venice: ['private', 'uncensored', 'all'], nanogpt: ['uncensored', 'roleplay', 'private', 'all'] };
/** The kinds offered for a service: with only Venice's own models wanted, every model listed is private, so that kind would say nothing. */
const filtersFor = (s: Service, venicePrivate: boolean): Filter[] => (s === 'venice' && venicePrivate ? ['all', 'uncensored'] : FILTERS[s]);

function matches(model: ModelInfo, filter: Filter): boolean {
  const c = model.category ?? '';
  if (filter === 'private') return model.privacy === 'private';
  if (filter === 'uncensored') return /uncensored/i.test(c) || /uncensored|abliterat|derestrict|heretic/i.test(model.id);
  if (filter === 'roleplay') return /roleplay|storytelling/i.test(c);
  return true;
}

/** How many models the list shows at once: past that, the search narrows it. */
const SHOWN = 40;

function ModelPicker({ role, current, onClose, onPick }: { role: Role; current: string; onClose: () => void; onPick: (m: ModelInfo) => void }) {
  const a = useApp();
  const st = a.settings;
  const r = ROLES.find((x) => x.id === role)!;
  const keyed = a.keyed;
  const [service, setService] = useState<Service>(keyed.includes(serviceOf(current)) ? serviceOf(current) : keyed[0] ?? 'anthropic');
  const [lists, setLists] = useState<Partial<Record<Service, ModelInfo[]>>>({});
  const [failed, setFailed] = useState<Partial<Record<Service, string>>>({});
  // The kind that shows the model in use, so that it can be seen and found; otherwise the first kind.
  const opening = (s: Service): Filter => {
    const kinds = filtersFor(s, st.venicePrivate);
    const now = serviceOf(current) === s ? modelInfo(current) : null;
    return (now && kinds.find((k) => matches(now, k))) ?? kinds[0]!;
  };
  const [filter, setFilter] = useState<Filter>(() => opening(service));
  const [query, setQuery] = useState('');
  const [tries, setTries] = useState(0);

  // Each service's list is read the first time its tab is shown.
  const list = lists[service];
  useEffect(() => {
    let wanted = true;
    setFailed((x) => ({ ...x, [service]: undefined }));
    void modelsOf(service)
      .then((got) => { if (wanted) setLists((x) => ({ ...x, [service]: got })); })
      .catch((err: unknown) => { if (wanted) setFailed((x) => ({ ...x, [service]: err instanceof LlmError ? err.message : t('The list of models could not be read.') })); });
    return () => { wanted = false; };
  }, [service, tries]);

  const switchTo = (s: Service) => { setService(s); setFilter(opening(s)); setQuery(''); };

  // Venice's own models only: the others are not offered at all.
  const pool = useMemo(() => (list ?? []).filter((x) => fits(x, r.needs) && !(serviceOf(x.id) === 'venice' && st.venicePrivate && x.privacy !== 'private')), [list, r.needs, st.venicePrivate]);
  const kinds = filtersFor(service, st.venicePrivate);
  const counts = useMemo(() => Object.fromEntries(kinds.map((f) => [f, pool.filter((x) => matches(x, f)).length])) as Record<Filter, number>, [pool, service, st.venicePrivate]);
  const found = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return pool
      // The service's own id, not the game's: "gpt" must not find every model of NanoGPT.
      .filter((x) => matches(x, filter) && words.every((w) => `${x.label} ${ownModelId(x.id)} ${x.description ?? ''}`.toLowerCase().includes(w)))
      // The model in use first; then, for a role that answers in a fixed shape, the models that can be held to it.
      .sort((x, y) => Number(y.id === current) - Number(x.id === current)
        || (r.needs === 'shape' ? Number(y.structured !== false) - Number(x.structured !== false) : 0));
  }, [pool, filter, query, r.needs, current]);
  // What a call usually costs here. The narrator's request is mostly read from the cache after the first
  // turn of a scene, at the cache price; the other roles' requests change every time.
  const perCall = (x: ModelInfo) => {
    const read = r.id === 'narrator' ? r.turn.read * (0.2 * x.input + 0.8 * x.cacheRead) : r.turn.read * x.input;
    return (read + r.turn.written * x.output) / 1_000_000;
  };

  return (
    <Modal title={t('The model of {role}', { role: t(r.label) })} onClose={onClose}>
      <div className="pick">
        {keyed.length === 0 && <p className="help">{t('Add a key above first: a model can be chosen only at a service you have a key for.')}</p>}
        {keyed.length > 1 && (
          <Seg<Service> label={t('Service')} value={service} options={keyed.map((s) => ({ id: s, label: SERVICE_NAME[s] }))} onChange={switchTo} />
        )}
        {service !== 'anthropic' && (
          <>
            <div className="input-row">
              <span className="pick-find-i" aria-hidden="true"><Icon name="search" size={18} /></span>
              <input className="input" type="text" inputMode="search" autoComplete="off" value={query} placeholder={t('Search by name')} aria-label={t('Search by name')} onChange={(e) => setQuery(e.target.value)} />
              {query && <button className="ib" type="button" onClick={() => setQuery('')} aria-label={t('Clear the search')}><Icon name="x" size={18} /></button>}
            </div>
            <div className="chips chips-wrap" role="group" aria-label={t('Kind of model')}>
              {kinds.map((f) => (
                <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  <span>{t(FILTER_LABEL[f])}{list ? ` · ${num(counts[f] ?? 0)}` : ''}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {r.needs === 'eyes' && service !== 'anthropic' && <p className="help">{t('Only models that can see pictures are listed.')}</p>}
        {service === 'venice' && st.venicePrivate && <p className="help">{t('Only Venice’s own models are listed: “Venice’s own models only” is on.')}</p>}
        {keyed.length === 0 ? null
          : failed[service] ? (
            <div className="pick-fail">
              <p className="help t-err" role="alert">{failed[service]}</p>
              <button className="btn" type="button" onClick={() => setTries((n) => n + 1)}><Icon name="refresh" size={18} />{t('Try again')}</button>
            </div>
          )
          : !list ? <p className="help">{t('Reading {service}’s list of models…', { service: SERVICE_NAME[service] })}</p>
            : found.length === 0 ? <p className="help">{t('No model matches.')}</p>
              : (
                <>
                  <ul className="pick-list">
                    {found.slice(0, SHOWN).map((x) => {
                      const tags = [
                        x.privacy === 'private' ? t('Keeps nothing') : x.privacy === 'passed-on' ? t('Passed on to the company that runs it') : null,
                        matches(x, 'uncensored') && serviceOf(x.id) !== 'anthropic' ? t('Uncensored') : null,
                        r.needs === 'shape' && x.structured === false ? t('Asked for the shape in words') : null,
                        x.thinks && x.thinkingOff === null ? t('Always thinks first') : null,
                      ].filter(Boolean);
                      return (
                        <li key={x.id}>
                          <button type="button" className="pick-item" aria-current={x.id === current ? 'true' : undefined} onClick={() => onPick(x)}>
                            <span className="pick-n">{x.label}{x.id === current && <Icon name="check" size={16} strong />}</span>
                            {x.description && <span className="pick-d">{x.description}</span>}
                            {tags.length > 0 && <span className="pick-t">{tags.join(' · ')}</span>}
                            <span className="pick-p">
                              {t('{input} in, {output} out, per million tokens.', { input: money(x.input, 2), output: money(x.output, 2) })}
                              {' '}
                              {perCall(x) < 0.001 ? t('Under $0.001 a call here.') : t('About {price} a call here.', { price: money(perCall(x), 3) })}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {found.length > SHOWN && <p className="help">{t('Showing {shown} of {n}. Search to narrow the list.', { shown: SHOWN, n: num(found.length) })}</p>}
                </>
              )}
        {service !== 'anthropic' && <p className="help">{t('Prices are the service’s own, read now from its list. Usage shows what each call really cost.')}</p>}
      </div>
    </Modal>
  );
}
