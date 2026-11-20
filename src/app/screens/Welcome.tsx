// Welcome: what the app is, the service that plays the game, and its key. Shown on first run, and to add
// a key while the demo narrator plays.
import { useEffect, useRef, useState } from 'react';
import { PRESETS, SERVICES, modelInfo, roleModels, serviceOf, type Preset, type Service } from '../../game/llm/models';
import { LlmError } from '../../game/llm/transport';
import { listOf, m, t } from '../../i18n';
import { useApp, type AppSettings } from '../app';
import { go } from '../router';
import { SERVICE_INFO } from '../services';
import { useShell } from '../Shell';
import { T } from '../T';
import { Icon, money } from '../ui';
import { Switch } from './Settings';
import './welcome.css';

const PRESET_INFO: { id: Preset; title: string; text: string; cost: string }[] = [
  { id: 'budget', title: m('Budget'), text: m('Fast and very cheap. Simpler prose.'), cost: m('well under a cent a turn') },
  { id: 'balanced', title: m('Balanced'), text: m('Good storytelling at a few hundred turns per dollar.'), cost: m('under a cent a turn') },
  { id: 'premium', title: m('Premium'), text: m('The richest narration, at about twice the price.'), cost: m('about a cent a turn') },
];

export function Welcome() {
  useShell('bare');
  const a = useApp();
  // A player who comes back finds the service their game is played on; a newcomer starts at Claude.
  const [service, setService] = useState<Service>(() => (a.settings.onboarded && a.servicesInUse.length === 1 ? a.servicesInUse[0]! : 'anthropic'));
  // What was pasted for each service, so that a key meant for one is never sent to another.
  const [keys, setKeys] = useState<Record<Service, string>>({ anthropic: '', venice: '', nanogpt: '' });
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<'idle' | 'checking' | 'error' | 'valid'>('idle');
  const [message, setMessage] = useState('');
  // What failed: the key, or (the key was accepted) choosing a model for every part of the game.
  const [failed, setFailed] = useState<'key' | 'models'>('key');
  const [ids, setIds] = useState<string[]>([]); // what the accepted Claude key may use; empty when Anthropic did not say
  const [keep, setKeep] = useState<AppSettings['keep']>(a.settings.keep);
  const [cap, setCap] = useState(a.settings.dailyCap.toFixed(2));
  const [preset, setPreset] = useState<Preset>(a.settings.preset === 'custom' ? 'balanced' : a.settings.preset);
  // A player whose game already runs wholly on a service, coming back to give it a new key: the models
  // they chose stay as they are, unless they pick a preset here.
  const [presetPicked, setPresetPicked] = useState(false);
  const stays = (s: Service) => a.settings.onboarded && a.servicesInUse.length === 1 && a.servicesInUse[0] === s
    // With "Venice's own models only" on, a model Venice passes on is not kept: the game chooses again.
    && !(s === 'venice' && a.settings.venicePrivate && Object.values(roleModels(a.settings.models)).some((id) => modelInfo(id).privacy !== 'private'));
  // A returning Claude player's own mix stays unless they pick a preset here: then what is said is about that mix.
  const keepsMix = service === 'anthropic' && !presetPicked && stays('anthropic') && a.settings.preset === 'custom';
  const info = SERVICE_INFO[service];
  const claude = service === 'anthropic';
  const key = keys[service];

  // Claude's preset only when Claude plays: on Venice or NanoGPT it would put Claude's models back.
  const common = (): Partial<AppSettings> => ({
    onboarded: true, ...(claude && !keepsMix ? { preset } : {}), dailyCap: Math.max(0.05, Math.min(1000, Number(cap.replace(/[^0-9.]/g, '')) || 1)),
  });

  // What the accepted key means. Claude: for the narrator chosen now, since the choice can still change
  // after the check. Venice and NanoGPT: the model the game chose to tell the story, and the balance.
  const wanted = (keepsMix ? Object.values(roleModels(a.settings.models)).filter((id) => serviceOf(id) === 'anthropic') : Object.values(PRESETS[preset]))
    .filter((id, i, all) => all.indexOf(id) === i);
  const missing = claude ? wanted.filter((id) => ids.length > 0 && !ids.includes(id)) : [];
  const balance = a.balance[service];
  const accepted = !claude
    ? <>{t('Key accepted. {model} will tell the story.', { model: modelInfo(a.settings.models.narrator).label })}{typeof balance === 'number' && <>{' '}{t('Balance: {amount}.', { amount: money(balance, 2) })}</>}</>
    : missing.length
      ? t('Key accepted, but it cannot use {models}. Choose another narrator above.', { models: listOf(missing.map((id) => modelInfo(id).label)) })
      : t('Key accepted. It will use {models}.', { models: listOf(wanted.map((id) => modelInfo(id).label)) });
  const keyBad = status === 'error' && failed === 'key';
  const modelsFailed = status === 'error' && failed === 'models';

  // The answer shows where the player is looking. An accepted key puts the way in under their hand, so
  // that Enter goes on. A refused one is told at the field it is about, which on a phone is a screen
  // above the button that was pressed. A key accepted for a game no model could be found for is told
  // at the button: the key is not what is wrong.
  const keyRow = useRef<HTMLDivElement>(null);
  const problem = useRef<HTMLDivElement>(null);
  const done = useRef<HTMLDivElement>(null);
  const enterBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (status === 'valid') {
      enterBtn.current?.focus({ preventScroll: true });
      done.current?.scrollIntoView({ block: 'nearest' });
    }
    if (status === 'error') (failed === 'models' ? problem : keyRow).current?.scrollIntoView({ block: 'center' });
  }, [status, failed]);

  const fail = (at: 'key' | 'models', text: string) => {
    setFailed(at);
    setStatus('error');
    setMessage(text);
  };

  const check = async () => {
    if (!key.trim()) { fail('key', t('Paste your API key first.')); return; }
    setStatus('checking');
    try {
      if (service === 'anthropic') {
        setIds(await a.useKey(key, keep));
        a.setSettings({ ...common(), demo: false });
      } else {
        await a.useServiceKey(service, key, keep);
        // The key is good and kept from here on. What is left is a model for every part of the game, from the service's list.
        try {
          if (!stays(service)) await a.useService(service);
        } catch (err) {
          fail('models', err instanceof Error ? err.message : t('The list of models could not be read.'));
          return;
        }
        a.setSettings({ ...common(), demo: false });
      }
      setStatus('valid');
    } catch (err) {
      const e = err instanceof LlmError ? err : null;
      fail('key',
        e?.kind === 'auth' && !e.status && e.message ? e.message
          : e?.kind === 'auth' ? t('That key was not accepted. Check that you copied all of it and that the key is still active.')
          : e?.kind === 'offline' ? t('Could not reach {service}. Check your connection and try again.', { service: info.name })
          : e?.kind === 'rate' ? t('{service} is asking us to slow down. Try again in a moment.', { service: info.name })
          : e?.kind === 'credit' ? t('The {service} account has no balance left. Add some, then try again.', { service: info.name })
          : e?.status ? t('The key could not be checked (error {status}). Try again.', { status: e.status }) : t('The key could not be checked. Try again.'),
      );
    }
  };

  // The limit and Claude's narrator may have been changed after the key was accepted.
  const enter = () => {
    a.setSettings(common());
    go('');
  };

  // Another service: what was said about the last one's key no longer holds.
  const choose = (s: Service) => {
    if (s === service) return;
    setService(s);
    setStatus('idle');
    setMessage('');
  };

  // Where the key is kept is decided when it is stored, so changing it means storing it again.
  const keepIn = (where: AppSettings['keep']) => {
    setKeep(where);
    if (status === 'valid' && where !== keep) setStatus('idle');
  };

  // The models are chosen from what this allows when the key is checked, so changing it means choosing again.
  const privateOnly = service === 'venice' ? a.settings.venicePrivate : a.settings.nanoPrivate;
  const setPrivate = (on: boolean) => {
    a.setSettings(service === 'venice' ? { venicePrivate: on } : { nanoPrivate: on });
    if (status === 'valid') setStatus('idle');
  };

  const demo = () => {
    a.setSettings({ ...common(), demo: true });
    go('');
  };

  return (
    <div className="app">
      <main className="page">
        <div className="page-col">
          <div className="hello">
            <div className="intro stack-l">
              <div className="mark">
                <span className="logo" aria-hidden="true"><Icon name="spark" size={20} fill /></span>Bitor Quest
                {/* The one control that must be readable in both languages: each choice is written in its own. */}
                <div className="seg hello-lang" role="group" aria-label="Language · Idioma">
                  <button type="button" aria-pressed={a.settings.language === 'en'} onClick={() => a.setSettings({ language: 'en' })}>English</button>
                  <button type="button" aria-pressed={a.settings.language === 'pt'} onClick={() => a.setSettings({ language: 'pt' })}>Português</button>
                </div>
              </div>
              <h1>{t('A role-playing game narrated by AI, played on your own key.')}</h1>
              <ul className="points">
                <li><Icon name="key" /><span><b>{t('You use your own key: Claude, Venice or NanoGPT.')}</b>{t('You pay that service for what you play and nothing else. The app is free and open source.')}</span></li>
                <li><Icon name="lock" /><span><b>{t('Everything stays on this device.')}</b>{t('Your keys and your stories are stored here. Anything sent goes only to the services you choose.')}</span></li>
                <li><Icon name="coins" /><span><b>{t('You always see the cost.')}</b>{t('Every turn shows what it cost, and play stops at the limit you set.')}</span></li>
              </ul>
            </div>

            <form className="card setup" onSubmit={(e) => { e.preventDefault(); void check(); }}>
              <div className="f">
                <span className="label">{t('Service')}</span>
                {/* Not while a key is being checked: its answer belongs to the service it was checked with. */}
                <div className="stack-s" role="group" aria-label={t('Service')}>
                  {SERVICES.map((s) => (
                    <button key={s} type="button" className={`choice${service === s ? ' is-on' : ''}`} aria-pressed={service === s} disabled={status === 'checking'} onClick={() => choose(s)}>
                      <span className="dotmark" aria-hidden="true" />
                      <span className="grow">
                        <span className="choice-t">{SERVICE_INFO[s].name} {s === 'anthropic' && <span className="tag tag-accent">{t('Recommended')}</span>}</span>
                        <span className="choice-d" style={{ display: 'block' }}>{t(SERVICE_INFO[s].line)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="f">
                <label className="label" htmlFor="key">{t('Your {service} API key', { service: info.name })}</label>
                <div ref={keyRow} className={`input-row key${keyBad ? ' is-bad' : status === 'valid' || modelsFailed ? ' is-good' : ''}`}>
                  <input className="input mono" id="key" type={show ? 'text' : 'password'} value={key} placeholder={a.keyOf(service) ? t('A key is saved. Paste a new one to replace it') : info.placeholder}
                    autoComplete="off" spellCheck={false} onChange={(e) => { setKeys({ ...keys, [service]: e.target.value }); if (status !== 'checking') setStatus('idle'); }} />
                  <button className="ib" type="button" aria-label={show ? t('Hide the key') : t('Show the key')} onClick={() => setShow(!show)}><Icon name={show ? 'eye-off' : 'eye'} /></button>
                </div>
                {keyBad && <p className="help t-err" role="alert">{message}</p>}
                <details className="how">
                  <summary>{t('Where do I get a key?')}<Icon name="down" size={14} strong className="chev" /></summary>
                  <ol>{info.steps.map((step) => <li key={step}><T text={step} /></li>)}</ol>
                </details>
              </div>

              <div className="pair">
                <div className="f">
                  <span className="label">{t('Keep the key')}</span>
                  <div className="seg" role="group" aria-label={t('Keep the key')}>
                    <button type="button" aria-pressed={keep === 'device'} onClick={() => keepIn('device')}>{t('On this device')}</button>
                    <button type="button" aria-pressed={keep === 'session'} onClick={() => keepIn('session')}>{t('This session only')}</button>
                  </div>
                </div>
                <div className="f">
                  <label className="label" htmlFor="cap">{t('Daily spending limit')}</label>
                  <input className="input num" id="cap" type="text" inputMode="decimal" value={`$${cap}`} onChange={(e) => setCap(e.target.value.replace(/[^0-9.]/g, ''))} />
                </div>
              </div>
              <p className="help" style={{ marginTop: 'calc(-1 * var(--sp-3))' }}>{t('Play pauses when a day’s spending reaches the limit. You can change it any time.')}</p>

              {claude ? (
                <div className="f">
                  <span className="label">{t('Narrator')}</span>
                  <div className="stack-s" role="group" aria-label={t('Narrator')}>
                    {PRESET_INFO.map((p) => (
                      <button key={p.id} type="button" className={`choice${!keepsMix && preset === p.id ? ' is-on' : ''}`} aria-pressed={!keepsMix && preset === p.id} onClick={() => { setPreset(p.id); setPresetPicked(true); }}>
                        <span className="dotmark" aria-hidden="true" />
                        <span className="grow">
                          <span className="choice-t">{t(p.title)} · {modelInfo(PRESETS[p.id].narrator).label} {p.id === 'balanced' && <span className="tag tag-accent">{t('Recommended')}</span>}</span>
                          <span className="choice-d" style={{ display: 'block' }}>{t(p.text)}</span>
                        </span>
                        <span className="choice-m">{t(p.cost)}</span>
                      </button>
                    ))}
                  </div>
                  {keepsMix && <p className="help">{t('Your own choice of models stays as it is. Pick a preset here to replace it.')}</p>}
                  <p className="help">{t('Estimates. The real cost of each turn is shown as you play.')}</p>
                </div>
              ) : (
                <div className="f">
                  <div className="hello-sw">
                    <div className="grow">
                      <span className="label" id="hello-private">{service === 'venice' ? t('Venice’s own models only') : t('Private providers only')}</span>
                      <span className="help">
                        {service === 'venice'
                          ? t('Private models: Venice runs them and keeps nothing. The others are “anonymized”: Venice passes the text on to the company that runs them. With this on, the game neither offers nor sends to them.')
                          : t('Send the story only to providers that promise to keep nothing of it. Fewer models qualify.')}
                      </span>
                    </div>
                    <Switch on={privateOnly} labelledBy="hello-private" disabled={status === 'checking'} onChange={setPrivate} />
                  </div>
                  <p className="help">{t('The game chooses a model for each part of the game from {service}’s list. You can change any of them in Settings.', { service: info.name })}</p>
                </div>
              )}

              <div className="stack-s">
                {modelsFailed && (
                  <div ref={problem} role="alert">
                    <p className="help t-err">{message}</p>
                    <p className="help">{t('The key was accepted and is saved.')}</p>
                  </div>
                )}
                {status !== 'valid' && <button type="submit" className="btn btn-primary btn-lg" disabled={status === 'checking'}>{status === 'checking' ? t('Checking the key…') : t('Check the key')}</button>}
                {/* Accepted: not the same button with new words. The result and the way in stand together, in the
                    colour of a success, where the button that was pressed stood. */}
                {status === 'valid' && (
                  <div ref={done} className={`key-done${missing.length ? ' is-warn' : ''}`}>
                    <p className="key-done-t" role="status">
                      <span className="key-done-i" aria-hidden="true"><Icon name={missing.length ? 'warn' : 'check'} size={14} strong /></span>
                      <span>{accepted}</span>
                    </p>
                    <button ref={enterBtn} type="button" className="btn btn-ok btn-lg" onClick={enter}>{t('Go to your stories')}<Icon name="arrow" size={18} /></button>
                  </div>
                )}
                {status !== 'valid' && <p className="small" style={{ textAlign: 'center' }}>{t(info.check)}</p>}
                {status !== 'valid' && <button type="button" className="btn btn-quiet" onClick={demo}>{t('Try it without a key (demo narrator)')}</button>}
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
