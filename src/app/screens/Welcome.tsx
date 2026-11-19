// Welcome: what the app is, and the key. Shown on first run and from Settings ("Replace").
import { useEffect, useRef, useState } from 'react';
import { PRESETS, modelInfo, type Preset } from '../../game/llm/models';
import { LlmError } from '../../game/llm/transport';
import { listOf, m, t } from '../../i18n';
import { useApp, type AppSettings } from '../app';
import { go } from '../router';
import { useShell } from '../Shell';
import { T } from '../T';
import { Icon } from '../ui';
import './welcome.css';

const PRESET_INFO: { id: Preset; title: string; text: string; cost: string }[] = [
  { id: 'budget', title: m('Budget'), text: m('Fast and very cheap. Simpler prose.'), cost: m('well under a cent a turn') },
  { id: 'balanced', title: m('Balanced'), text: m('Good storytelling at a few hundred turns per dollar.'), cost: m('under a cent a turn') },
  { id: 'premium', title: m('Premium'), text: m('The richest narration, at about twice the price.'), cost: m('about a cent a turn') },
];

export function Welcome() {
  useShell('bare');
  const a = useApp();
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<'idle' | 'checking' | 'error' | 'valid'>('idle');
  const [message, setMessage] = useState('');
  const [ids, setIds] = useState<string[]>([]); // what the accepted key may use; empty when Anthropic did not say
  const [keep, setKeep] = useState<AppSettings['keep']>(a.settings.keep);
  const [cap, setCap] = useState(a.settings.dailyCap.toFixed(2));
  const [preset, setPreset] = useState<Preset>(a.settings.preset === 'custom' ? 'balanced' : a.settings.preset);

  const common = (): Partial<AppSettings> => ({
    onboarded: true, preset, dailyCap: Math.max(0.05, Math.min(1000, Number(cap.replace(/[^0-9.]/g, '')) || 1)),
  });

  // What the accepted key means for the narrator chosen now: the choice can still change after the check.
  const wanted = Object.values(PRESETS[preset]).filter((id, i, all) => all.indexOf(id) === i);
  const missing = wanted.filter((id) => ids.length > 0 && !ids.includes(id));
  const accepted = missing.length
    ? t('Key accepted, but it cannot use {models}. Choose another narrator above.', { models: listOf(missing.map((id) => modelInfo(id).label)) })
    : t('Key accepted. It will use {models}.', { models: listOf(wanted.map((id) => modelInfo(id).label)) });

  // The answer shows where the player is looking. An accepted key puts the way in under their hand, so
  // that Enter goes on. A refused one is told at the field it is about, which on a phone is a screen
  // above the button that was pressed.
  const keyRow = useRef<HTMLDivElement>(null);
  const done = useRef<HTMLDivElement>(null);
  const enterBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (status === 'valid') {
      enterBtn.current?.focus({ preventScroll: true });
      done.current?.scrollIntoView({ block: 'nearest' });
    }
    if (status === 'error') keyRow.current?.scrollIntoView({ block: 'center' });
  }, [status]);

  const check = async () => {
    if (!key.trim()) { setStatus('error'); setMessage(t('Paste your API key first.')); return; }
    setStatus('checking');
    try {
      setIds(await a.useKey(key, keep));
      a.setSettings(common());
      setStatus('valid');
    } catch (err) {
      const e = err instanceof LlmError ? err : null;
      setStatus('error');
      setMessage(
        e?.kind === 'auth' ? t('That key was not accepted. Check that you copied all of it and that the key is still active.')
          : e?.kind === 'offline' ? t('Could not reach Anthropic. Check your connection and try again.')
          : e?.kind === 'rate' ? t('Anthropic is asking us to slow down. Try again in a moment.')
          : e?.status ? t('The key could not be checked (error {status}). Try again.', { status: e.status }) : t('The key could not be checked. Try again.'),
      );
    }
  };

  // The limit and the narrator may have been changed after the key was accepted.
  const enter = () => {
    a.setSettings(common());
    go('');
  };

  // Where the key is kept is decided when it is stored, so changing it means storing it again.
  const keepIn = (where: AppSettings['keep']) => {
    setKeep(where);
    if (status === 'valid' && where !== keep) setStatus('idle');
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
              <h1>{t('A role-playing game narrated by Claude, played on your own key.')}</h1>
              <ul className="points">
                <li><Icon name="key" /><span><b>{t('You use your own Claude API key.')}</b>{t('You pay Anthropic for what you play and nothing else. The app is free and open source.')}</span></li>
                <li><Icon name="lock" /><span><b>{t('Everything stays on this device.')}</b>{t('Your key and your stories are stored here. The only place anything is sent is Anthropic’s API.')}</span></li>
                <li><Icon name="coins" /><span><b>{t('You always see the cost.')}</b>{t('Every turn shows what it cost, and play stops at the limit you set.')}</span></li>
              </ul>
            </div>

            <form className="card setup" onSubmit={(e) => { e.preventDefault(); void check(); }}>
              <div className="f">
                <label className="label" htmlFor="key">{t('Your Claude API key')}</label>
                <div ref={keyRow} className={`input-row key${status === 'error' ? ' is-bad' : status === 'valid' ? ' is-good' : ''}`}>
                  <input className="input mono" id="key" type={show ? 'text' : 'password'} value={key} placeholder={a.apiKey ? t('A key is saved. Paste a new one to replace it') : 'sk-ant-…'}
                    autoComplete="off" spellCheck={false} onChange={(e) => { setKey(e.target.value); if (status !== 'checking') setStatus('idle'); }} />
                  <button className="ib" type="button" aria-label={show ? t('Hide the key') : t('Show the key')} onClick={() => setShow(!show)}><Icon name={show ? 'eye-off' : 'eye'} /></button>
                </div>
                {status === 'error' && <p className="help t-err" role="alert">{message}</p>}
                <details className="how">
                  <summary>{t('Where do I get a key?')}<Icon name="down" size={14} strong className="chev" /></summary>
                  <ol>
                    <li><T text="Open the Claude Console at <b>platform.claude.com</b> and sign in. It is separate from a claude.ai subscription." /></li>
                    <li>{t('Add credit, then create an API key just for this app.')}</li>
                    <li>{t('Set a monthly spend limit on that key, so a mistake can never cost more than you chose.')}</li>
                  </ol>
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

              <div className="f">
                <span className="label">{t('Narrator')}</span>
                <div className="stack-s" role="group" aria-label={t('Narrator')}>
                  {PRESET_INFO.map((p) => (
                    <button key={p.id} type="button" className={`choice${preset === p.id ? ' is-on' : ''}`} aria-pressed={preset === p.id} onClick={() => setPreset(p.id)}>
                      <span className="dotmark" aria-hidden="true" />
                      <span className="grow">
                        <span className="choice-t">{t(p.title)} · {modelInfo(PRESETS[p.id].narrator).label} {p.id === 'balanced' && <span className="tag tag-accent">{t('Recommended')}</span>}</span>
                        <span className="choice-d" style={{ display: 'block' }}>{t(p.text)}</span>
                      </span>
                      <span className="choice-m">{t(p.cost)}</span>
                    </button>
                  ))}
                </div>
                <p className="help">{t('Estimates. The real cost of each turn is shown as you play.')}</p>
              </div>

              <div className="stack-s">
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
                {status !== 'valid' && <p className="small" style={{ textAlign: 'center' }}>{t('Checking the key asks Anthropic which models it can use. That costs nothing.')}</p>}
                {status !== 'valid' && <button type="button" className="btn btn-quiet" onClick={demo}>{t('Try it without a key (demo narrator)')}</button>}
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
