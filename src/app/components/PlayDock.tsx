// The dock under the story: the dice while they wait to be thrown, Continue while there is more to
// read, otherwise the input. In a fight it holds the actions of a turn instead.
import { useEffect, useRef, useState } from 'react';
import { conditionLabel, isUp, type Combat, type Combatant, type Power, abilityById, abilityCost, commandOf, powersOf } from '../../engine';
import { fightersForDisplay, type Session } from '../../game/session';
import type { Person, Story } from '../../game/types';
import { t } from '../../i18n';
import { T } from '../T';
import { Avatar, Icon, Modal, who } from '../ui';
import { fightLine } from './Gift';
import { ContestBar } from './Tools';
import { condClass, condText } from './PlayLog';

function Stop({ session }: { session: Session }) {
  return <button className="stop" onClick={() => session.stop()}><i aria-hidden="true" />{t('Stop')}</button>;
}

/** The value of "To" that means: not said in the story at all, but asked of the narrator. */
export const NARRATOR = '@narrator';

/** Who a line is for: someone present, nobody in particular, or (outside the story) the narrator. */
function ToButton({ story, present, to, onOpen }: { story: Story; present: Person[]; to: string | null; onOpen: () => void }) {
  const out = to === NARRATOR;
  const person = to && !out ? story.world.people[to] ?? null : null;
  const anyone = present.some((p) => p.count === 1);
  const label = out ? t('the narrator, outside the story') : person?.name ?? (anyone ? t('everyone here') : t('no one in particular'));
  return (
    // type="button": inside the form a plain button would send whatever is typed.
    <button type="button" className={`to ${out ? 'to-out' : who(person)}`} onClick={onOpen} aria-label={t('Speaking to {label}. Change who you speak to', { label })}>
      <span className="to-k">{t('To:')}</span>
      {out ? <><Icon name="quill" size={16} /><b>{t('Narrator')}</b></> : person ? <><Avatar person={person} size="s" /><b>{person.short || person.name}</b></> : <b>{anyone ? t('Everyone') : t('No one')}</b>}
      <Icon name="down" size={14} strong />
    </button>
  );
}

function ToSheet({ present, to, pick, onClose }: { present: Person[]; to: string | null; pick: (id: string | null) => void; onClose: () => void }) {
  const named = present.filter((p) => p.count === 1);
  return (
    <Modal title={t('Who is this for?')} onClose={onClose}>
      <p className="t-caps">{t('In the story')}</p>
      <div className="card card-flush">
        <button type="button" className="row" onClick={() => pick(null)}>
          <span className="av av-anon" aria-hidden="true"><Icon name="people" size={18} /></span>
          <span className="grow"><span className="row-t">{named.length ? t('Everyone here') : t('No one in particular')}</span><span className="row-s">{named.length ? t('Said or done in front of whoever is present') : t('There is nobody here to speak to')}</span></span>
          {!to && <Icon name="check" className="t-accent" />}
        </button>
        {named.map((p) => (
          <button type="button" key={p.id} className={`row ${who(p)}`} onClick={() => pick(p.id)}>
            <Avatar person={p} />
            <span className="grow"><span className="row-t">{p.name}</span><span className="row-s">{p.role}{p.inParty ? ` · ${t('in your party')}` : ''}</span></span>
            {to === p.id && <Icon name="check" className="t-accent" />}
          </button>
        ))}
      </div>
      <p className="t-caps">{t('Out of the story')}</p>
      <div className="card card-flush">
        <button type="button" className="row row-out" onClick={() => pick(NARRATOR)}>
          <span className="av av-out" aria-hidden="true"><Icon name="quill" size={18} /></span>
          <span className="grow">
            <span className="row-t">{t('The narrator')}</span>
            <span className="row-s">{t('Ask what a passage meant, how a rule works, or how to use the app. Nobody in the story hears it and nothing happens.')}</span>
          </span>
          {to === NARRATOR && <Icon name="check" className="t-gold" />}
        </button>
      </div>
      <p className="help"><T text="A line that starts with <b>//</b> always goes to the narrator, wherever this is set." /></p>
    </Modal>
  );
}

function Composer({ session, present, to, setTo }: { session: Session; present: Person[]; to: string | null; setTo: (id: string | null) => void }) {
  const story = session.story;
  const [text, setText] = useState('');
  const [picking, setPicking] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const out = to === NARRATOR;
  const asking = session.asking;
  // Text handed back after Stop or a declined turn returns to the box.
  useEffect(() => {
    const back = session.takeReturned();
    if (back) { setText(back); input.current?.focus(); }
  });
  const send = (value: string) => {
    const line = value.trim();
    if (!line || session.busy) return;
    setText('');
    if (out) void session.ask(line);
    else void session.submit(line, to);
  };
  // Under the game's question: its suggested answers. Otherwise the narrator's suggested actions. None while asking the narrator.
  const chips = out ? [] : asking ? asking.options : story.settings.suggestions ? session.lastTurn?.suggestions ?? [] : [];
  const hint = out ? t('Your question…') : asking ? t('Your answer…') : t('What do you do?');
  return (
    <div className={`compose${out ? ' is-out' : ''}`}>
      {!out && <ContestBar session={session} />}
      {out && (
        <div className="out-bar">
          <Icon name="quill" size={16} />
          <span><T text="<b>Out of the story.</b> Nobody hears this." /></span>
          <button type="button" className="link" onClick={() => { setTo(null); input.current?.focus(); }}>{t('Back to the story')}</button>
        </div>
      )}
      {chips.length > 0 && (
        <div className={`sugg${asking ? ' sugg-ans' : ''}`} role="group" aria-label={asking ? t('Answers') : t('Suggested actions')}>
          {chips.map((s, i) => <button type="button" key={i} className="sg" onClick={() => send(s)}><span>{s}</span></button>)}
        </div>
      )}
      <form className={`field${out ? ' is-out' : ''}`} onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <ToButton story={story} present={present} to={to} onOpen={() => setPicking(true)} />
        <input ref={input} type="text" value={text} onChange={(e) => { setText(e.target.value); session.clearNotice(); }} placeholder={hint} aria-label={hint} autoComplete="off" />
        <button className="send" type="submit" aria-label={out ? t('Ask') : t('Send')} disabled={!text.trim()}><Icon name="send" /></button>
      </form>
      {/* Outside the form, so that choosing here can never send what is typed. */}
      {picking && <ToSheet present={present} to={to} pick={(id) => { setTo(id); setPicking(false); window.setTimeout(() => input.current?.focus(), 0); }} onClose={() => setPicking(false)} />}
    </div>
  );
}

function targetLabel(f: Combatant): string {
  return f.countMax > 1 ? `${f.name} ×${f.count}` : f.name;
}

/** The actions of a turn in a fight. However many opponents there are, this stays the same height. */
function FightDock({ session, combat }: { session: Session; combat: Combat }) {
  const story = session.story;
  const p = story.protagonist;
  const foes = fightersForDisplay(combat).theirs;
  const up = foes.filter(isUp);
  const [picked, setPicked] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'ability' | 'item' | 'targets' | null>(null);
  const [text, setText] = useState('');
  const target = up.find((f) => f.id === picked) ?? up[0] ?? null;
  const hero = Object.values(combat.fighters).find((f) => f.isProtagonist);
  const energy = hero?.energy ?? p.sheet.energy;
  const sealed = hero?.sealed ?? 0;
  // Everything the fighter can use that does something in a fight, cheapest first, at what it costs in
  // this world: what the fight holds (a power borrowed during it included), not what the sheet says.
  // In a world of gifts, power by power, in the order the character holds them.
  const mode = session.story.world.rules.powers;
  const command: Power[] = hero?.abilities ? hero.abilities.map((id) => hero.own?.[id] ?? abilityById(id)).filter((x): x is Power => !!x) : commandOf(p.sheet, mode);
  const order = powersOf(p.sheet).map((x) => x.id);
  const rankOf = (x: Power) => (x.of ? Math.max(0, order.indexOf(x.of)) : 0);
  const abilities = command.filter((x) => !!x.combat).sort((x, y) => rankOf(x) - rankOf(y) || abilityCost(x, mode) - abilityCost(y, mode));
  const groups = new Set(abilities.map((x) => x.of ?? '')).size > 1;
  const powerName = (id: string | undefined) => (id ? powersOf(p.sheet).find((x) => x.id === id)?.gift.name : undefined) ?? '';
  const items = p.items.filter((i) => i.kind === 'consumable' && i.heal && i.qty > 0);
  const busy = session.busy;
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    row.current?.querySelector('.is-on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [target?.id]);

  return (
    <div className="compose">
      <div className="tgt">
        <span className="tgt-k">{t('Target')}</span>
        <div className={`tgt-row${up.length > 2 ? ' is-many' : ''}`} ref={row} role="group" aria-label={t('Target')}>
          {up.map((f) => (
            <button key={f.id} className={`tg-b${f.id === target?.id ? ' is-on' : ''}`} aria-pressed={f.id === target?.id} onClick={() => setPicked(f.id)}>
              <span className="av av-s av-anon" aria-hidden="true">{f.countMax > 1 ? f.count : f.name.slice(0, 1)}</span>
              <span className="tg-x"><b>{targetLabel(f)}</b><span className={`cond ${condClass(conditionLabel(f))}`}>{condText(conditionLabel(f))}</span></span>
              <Icon name="target" size={16} />
            </button>
          ))}
        </div>
        {up.length > 3 && <button className="tg-all" onClick={() => setSheet('targets')}>{t('All {n}', { n: up.length })}</button>}
      </div>
      <div className="cmds">
        <div className="cmd-row">
          <button className="btn btn-primary" disabled={busy || !target} onClick={() => target && void session.combatAct({ type: 'attack', target: target.id })}>
            <Icon name="sword" size={18} />{t('Attack')} <span className="cmd-n">{hero?.ranged ? t('· at range') : t('· short blade')}</span>
          </button>
          <button className="btn" disabled={busy} onClick={() => void session.combatAct({ type: 'defend' })}><Icon name="shield" size={18} />{t('Defend')}</button>
        </div>
        <div className="cmd-row">
          {/* Sealed by someone's power: no power can be used until the seal has passed. */}
          {sealed > 0
            ? <button className="btn" disabled><Icon name="lock" size={18} />{t('Sealed')}</button>
            : <button className="btn" disabled={busy || abilities.length === 0} onClick={() => setSheet('ability')}><Icon name="spark" size={18} />{t('Ability')}</button>}
          <button className="btn" disabled={busy || items.length === 0} onClick={() => setSheet('item')}><Icon name="flask" size={18} />{t('Item')}</button>
          <button className="btn" disabled={busy} onClick={() => void session.combatAct({ type: 'flee' })}><Icon name="arrow" size={18} />{t('Get away')}</button>
        </div>
      </div>
      <form className="field is-plain" onSubmit={(e) => { e.preventDefault(); const line = text.trim(); if (line && !busy) { setText(''); void session.submit(line, null); } }}>
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Describe something else, or // to ask')} aria-label={t('Or describe something else. A line that starts with two slashes asks the narrator')} autoComplete="off" />
        <button className="send" type="submit" aria-label={t('Send')} disabled={!text.trim()}><Icon name="send" /></button>
      </form>

      {sheet === 'ability' && (
        <Modal title={t('Abilities · {n} energy', { n: energy })} onClose={() => setSheet(null)}>
          <div className="card card-flush pick">
            {abilities.map((ab, i) => {
              const needs = ab!.combat!.needsTarget;
              const cost = hero?.costs?.[ab!.id] ?? abilityCost(ab!, mode);
              const cannot = energy < cost || (needs && !target);
              // A move of one's own power is the player's words: shown as written, never looked up.
              const words = ab!.own ? ab!.text : t(ab!.text);
              const does = fightLine(ab!.combat!);
              // With moves of several powers, a small header names each power (its name is shown as written).
              const head = groups && (i === 0 || abilities[i - 1]!.of !== ab.of) ? <div className="pick-h" key={`h-${ab.of ?? ''}`}>{powerName(ab.of)}</div> : null;
              return [head,
                <button key={ab!.id} className="row" disabled={cannot} onClick={() => { setSheet(null); void session.combatAct({ type: 'ability', ability: ab!.id, target: needs ? target?.id : undefined }); }}>
                  <span className="grow">
                    <span className="row-t">{ab!.own ? ab!.name : t(ab!.name)}</span>
                    {words && <span className="row-s">{words}</span>}
                    {/* What it does here, in the rules' own words: a player's line for a move need not say. */}
                    <span className="row-s">{does[0]!.toUpperCase() + does.slice(1)}.{needs && target ? ` ${t('On {target}.', { target: targetLabel(target) })}` : ''}{energy < cost ? ` ${t('Not enough energy.')}` : ''}</span>
                  </span>
                  <span className="row-end"><Icon name="bolt" size={14} fill />{cost}</span>
                </button>,
              ];
            })}
          </div>
        </Modal>
      )}
      {sheet === 'item' && (
        <Modal title={t('Use an item')} onClose={() => setSheet(null)}>
          <div className="card card-flush pick">
            {items.map((it) => (
              <button key={it.id} className="row" onClick={() => { setSheet(null); void session.combatAct({ type: 'item', item: it.id, heal: it.heal ?? 0 }); }}>
                <span className="grow"><span className="row-t">{it.name}</span><span className="row-s">{it.text} {t('Using it takes your turn.')}</span></span>
                <span className="row-end">×{it.qty}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {sheet === 'targets' && (
        <Modal title={t('Opponents · {n} standing', { n: up.length })} onClose={() => setSheet(null)}>
          <div className="card card-flush pick">
            {foes.map((f) => (
              <button key={f.id} className="row" disabled={!isUp(f)} onClick={() => { setPicked(f.id); setSheet(null); }}>
                <span className="av av-anon" aria-hidden="true">{f.countMax > 1 ? f.count : f.name.slice(0, 1)}</span>
                <span className="grow"><span className="row-t">{targetLabel(f)}</span><span className={`row-s cond ${condClass(conditionLabel(f))}`}>{condText(conditionLabel(f))}</span></span>
                {f.id === target?.id && <Icon name="target" className="t-accent" />}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Dice waiting to be thrown: how many are on the next card, how many cards are left, and whether a throw is in the air. */
export interface Rolling { dice: number; left: number; flying: boolean; one: () => void; all: () => void }

export function Dock({ session, present, to, setTo, roll = null }: { session: Session; present: Person[]; to: string | null; setTo: (id: string | null) => void; roll?: Rolling | null }) {
  const combat = session.combat;
  const story = session.story;
  let body;
  if (roll) {
    // Before anything else: nothing is read or done while the dice of the last action lie unthrown.
    body = (
      <div className="go-row">
        <button className="go go-roll" data-roll disabled={roll.flying} onClick={roll.one}>
          <Icon name="dice" />
          <span>{roll.flying ? t('Rolling…') : roll.dice > 1 ? t('Roll the dice') : t('Roll the die')}</span>
          <kbd aria-hidden="true">{t('Space')}</kbd>
        </button>
        {roll.left > 1 && !roll.flying && <button className="go-all" data-roll-all onClick={roll.all} aria-label={t('Roll all {n} at once', { n: roll.left })}>{t('All {n}', { n: roll.left })}</button>}
      </div>
    );
  } else if (story.over) {
    body = <div className="field is-off is-plain"><input type="text" disabled placeholder={t('This story has ended.')} aria-label={t('The story has ended')} /></div>;
  } else if (session.busy) {
    body = (
      <div className="field is-off is-plain">
        <input type="text" disabled placeholder={session.phase === 'writing' ? t('The narrator is writing…') : session.phase === 'recording' ? t('Writing up the last scene…') : session.phase === 'mapping' ? (session.filling ? t('Writing {place} into the world…', { place: session.filling }) : t('Writing this place into the world…')) : t('Working out what happens…')} aria-label={t('Waiting')} />
        {session.phase === 'writing' && <Stop session={session} />}
      </div>
    );
  } else if (session.blocker) {
    const why = session.blocker.kind === 'budget' ? t('Paused: today’s limit is reached') : session.blocker.kind === 'refusal' ? t('Rephrase your action above') : t('Try again to send your action');
    body = <div className="field is-off is-plain"><input type="text" disabled placeholder={why} aria-label={why} /></div>;
  } else if (session.unread > 0) {
    body = (
      <button className="go" data-continue onClick={() => session.continueReading()}>
        <span>{t('Continue')}</span>
        <span className="go-n"><T text="<b>{n}</b> more" vars={{ n: session.unread }} /></span>
        <Icon name="arrow" className="go-i" />
        <kbd aria-hidden="true">{t('Space')}</kbd>
      </button>
    );
  } else if (combat?.awaiting === 'down') {
    body = <div className="field is-off is-plain"><input type="text" disabled placeholder={t('Choose what happens, above')} aria-label={t('Choose what happens')} /></div>;
  } else if (combat) {
    body = <FightDock session={session} combat={combat} />;
  } else {
    body = <Composer session={session} present={present} to={to} setTo={setTo} />;
  }
  return <div className="dock"><div className="dock-in">{body}</div></div>;
}
