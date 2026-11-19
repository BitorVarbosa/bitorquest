// Small shared pieces of the interface. Class names are the Slate design system's (styles/slate.css).
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { barSegments, stageName } from '../engine';
import type { Note, Person } from '../game/types';
import { t, tn } from '../i18n';
import { ICONS, type IconName } from './icons';
import { T } from './T';

export function Icon({ name, size = 20, fill = false, strong = false, className = '' }: { name: IconName; size?: number; fill?: boolean; strong?: boolean; className?: string }) {
  return (
    <svg
      className={`i${fill ? ' i-f' : ''}${strong ? ' i-s' : ''}${className ? ` ${className}` : ''}`}
      width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

/** The class that gives an element a person's colour (avatar, name, bubble outline, bond bar). */
export function who(p: Pick<Person, 'hue'> | null | undefined): string {
  return p?.hue ? `who-${p.hue}` : '';
}

export function Avatar({ person, you, size, pinned, className = '' }: { person?: Person | null; you?: string; size?: 's' | 'l' | 'xl'; pinned?: boolean; className?: string }) {
  const sz = size ? ` av-${size}` : '';
  if (you) return <span className={`av av-you${sz} ${className}`} aria-hidden="true">{you.slice(0, 1)}</span>;
  if (!person) return <span className={`av${sz} ${className}`} aria-hidden="true">?</span>;
  if (person.count > 1) return <span className={`av${sz} av-anon ${className}`} aria-hidden="true"><Icon name="people" size={size === 's' ? 12 : 18} /></span>;
  if (person.tier === 'extra') return <span className={`av${sz} av-anon ${className}`} aria-hidden="true"><Icon name="person" size={size === 's' ? 12 : 18} /></span>;
  return (
    <span className={`av${sz} ${who(person)} ${className}`} aria-hidden="true">
      {(person.short || person.name).slice(0, 1)}
      {pinned && <span className="fav"><Icon name="star" size={11} fill /></span>}
    </span>
  );
}

/** The bond bar: five segments of 20 points. Always shown next to the number and the stage name. */
export function BondBar({ bond, size, className = '' }: { bond: number; size?: 'l' | 'xl'; className?: string }) {
  return (
    <span className={`bb${size ? ` bb-${size}` : ''} ${className}`} role="img" aria-label={t('Bond {bond} of 100, {stage}', { bond, stage: t(stageName(bond)) })}>
      {barSegments(bond).map((f, i) => <i key={i} style={{ '--f': f } as CSSProperties} />)}
    </span>
  );
}

export { Die } from './dice';

export function Meter({ kind, label, value, max, large = false }: { kind: 'hp' | 'en'; label: string; value: number; max: number; large?: boolean }) {
  const v = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={kind} style={{ '--v': `${v}%` } as CSSProperties}>
      <div className="m-top">
        <span className="m-k"><Icon name={kind === 'hp' ? 'heart' : 'bolt'} size={12} fill />{label}</span>
        <span className="m-v"><b>{value}</b>/{max}</span>
      </div>
      <div className={`track${large ? ' track-l' : ''}`}><i /></div>
    </div>
  );
}

export function money(n: number, digits?: number): string {
  if (digits !== undefined) return `$${n.toFixed(digits)}`;
  if (n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3).replace(/0$/, '')}`;
  return `$${n.toFixed(2)}`;
}

/** The quiet chips that record what the rules did: bond changes, experience, time, threads. */
export function Notes({ notes, people }: { notes: Note[]; people: Record<string, Person> }) {
  return (
    <div className="notes">
      {notes.map((n, i) => {
        switch (n.kind) {
          case 'bond': {
            const p = people[n.who];
            const sign = n.delta > 0 ? '+' : '−';
            return (
              <span key={i} className={`note note-bond ${who(p)}${n.delta < 0 ? ' note-bad' : ''}`}>
                <Avatar person={p} size="s" />
                <span><T text="<b>{amount}</b> bond with {name}" vars={{ amount: `${sign}${Math.abs(n.delta)}`, name: p?.name ?? n.who }} /></span>
                <BondBar bond={n.after} />
                <span className="note-x">{n.newStage ? t('now') : ''} <b>{t(n.stage)}</b></span>
              </span>
            );
          }
          case 'moment': {
            const p = people[n.who];
            return <span key={i} className={`note note-moment ${who(p)}`}><Icon name="spark" size={14} fill />{n.played ? t('You shared a moment with {name}', { name: p?.name ?? n.who }) : t('{name} wants a moment with you', { name: p?.name ?? n.who })}</span>;
          }
          case 'xp': return <span key={i} className="note"><Icon name="spark" size={14} strong /><span><T text="<b>+{amount}</b> experience" vars={{ amount: n.amount }} /></span></span>;
          case 'chapter': return <span key={i} className="note note-chapter"><Icon name="flag" size={14} strong /><span><T text="Chapter {prev} ends · <b>Chapter {n}: {title}</b> begins · destiny restored" vars={{ prev: n.n - 1, n: n.n, title: n.title }} /></span></span>;
          case 'time': {
            // A wait of days is said in days, from a full day on.
            const hours = Math.round(n.minutes / 60);
            const days = Math.round(n.minutes / 1440);
            const span = n.minutes >= 1440 ? tn(days, '{n} day', '{n} days') : n.minutes >= 60 ? tn(hours, '{n} hour', '{n} hours') : tn(n.minutes, '{n} minute', '{n} minutes');
            const one = n.minutes >= 1440 ? days === 1 : n.minutes >= 60 ? hours === 1 : n.minutes === 1;
            return <span key={i} className="note"><Icon name="clock" size={14} strong /><span>{one ? t('{span} passes', { span }) : t('{span} pass', { span })}</span></span>;
          }
          case 'thread': return <span key={i} className="note"><Icon name="target" size={14} strong /><span><b>{n.text.split(':')[0]}{n.text.includes(':') ? ':' : ''}</b>{n.text.includes(':') ? n.text.slice(n.text.indexOf(':') + 1) : ''} <span className="t-3">· {n.title}</span></span></span>;
          case 'promise': return <span key={i} className="note"><Icon name="flag" size={14} strong /><span><b>{t('Promised:')}</b> {n.text}</span></span>;
          case 'fight': return <span key={i} className={`note${n.tone === 'bad' ? ' note-bad' : ''}`}><Icon name={n.tone === 'good' ? 'sword' : n.tone === 'bad' ? 'warn' : 'dice'} size={14} strong /><span>{n.text}</span></span>;
          case 'info': return <span key={i} className={`note${n.tone === 'warn' ? ' note-warn' : ''}`}><Icon name="info" size={14} strong /><span>{n.text}</span></span>;
          case 'company': {
            const p = people[n.who];
            return <span key={i} className={`note note-bond ${who(p)}${n.tone === 'bad' ? ' note-bad' : ''}`}><Avatar person={p} size="s" /><span>{n.text}</span></span>;
          }
        }
      })}
    </div>
  );
}

/** A number raised and lowered a step at a time, between `min` and `max`. */
export function Stepper({ label, value, max, min = 0, onChange }: { label: string; value: number; max: number; min?: number; onChange: (v: number) => void }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label={t('Lower {label}', { label })} disabled={value <= min} onClick={() => onChange(value - 1)}><Icon name="minus" size={18} /></button>
      <b>{value}</b>
      <button type="button" aria-label={t('Raise {label}', { label })} disabled={value >= max} onClick={() => onChange(value + 1)}><Icon name="plus" size={18} /></button>
    </div>
  );
}

/** A dialog: a bottom sheet on a phone, a centred dialog on a PC. */
export function Modal({ title, onClose, children, foot }: { title: string; onClose: () => void; children: ReactNode; foot?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // A dialog is drawn over the whole screen wherever it is opened from: a button deep in the story log
  // would otherwise hold it in its own small box.
  const host = typeof document === 'undefined' ? null : document.querySelector('.app');
  const dialog = (
    <>
      <div className="modal-scrim is-open" onClick={onClose} />
      <div className="modal is-open" role="dialog" aria-label={title}>
        <header className="modal-h"><h2>{title}</h2><button className="ib" onClick={onClose} aria-label={t('Close ((button))')}><Icon name="x" size={22} /></button></header>
        <div className="modal-b">{children}</div>
        {foot && <div className="modal-f">{foot}</div>}
      </div>
    </>
  );
  return host ? createPortal(dialog, host) : dialog;
}
