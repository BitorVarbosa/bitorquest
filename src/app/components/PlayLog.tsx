// The story log: what the player did, the dice, what the narrator wrote, and what the rules recorded.
import type { CSSProperties, ReactNode } from 'react';
import type { AttackEvent, TestResult } from '../../engine';
import { speechParts } from '../../game/llm/parse';
import type { Asking, Session } from '../../game/session';
import type { Aside, Beat, Person, Story, Turn } from '../../game/types';
import { m, t } from '../../i18n';
import { DieFace, useThrow } from '../dice';
import { T } from '../T';
import { cardThrow, hasDice, isTold, type Table, type ThrowState } from '../table';
import { Avatar, Icon, Notes, who } from '../ui';

const OUTCOME: Record<TestResult['outcome'], { label: string; bad: boolean }> = {
  success: { label: m('Success'), bad: false },
  cost: { label: m('Success at a cost'), bad: false },
  forward: { label: m('Failed, with a way forward'), bad: true },
  fail: { label: m('Failed'), bad: true },
};
const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
/** The names of the attributes and of the difficulties, as the engine gives them, to be translated where they are drawn. */
const ATTRIBUTE_NAME: Record<string, string> = { strength: m('Strength'), skill: m('Skill'), resistance: m('Resistance'), armor: m('Armor'), firepower: m('Firepower') };
const DIFFICULTY_NAME: Record<string, string> = { easy: m('Easy'), medium: m('Medium'), hard: m('Hard') };
export const attributeName = (k: string): string => t(ATTRIBUTE_NAME[k] ?? cap(k));
const PATH_NAME: Record<string, string> = { fire: m('Fire'), water: m('Water'), air: m('Air'), earth: m('Earth'), light: m('Light'), dark: m('Dark') };
export const pathName = (k: string): string => t(PATH_NAME[k] ?? cap(k));
const CONDITION_WORD: Record<string, string> = { Unhurt: m('Unhurt'), Hurt: m('Hurt'), 'Badly hurt': m('Badly hurt'), Down: m('Down'), Fled: m('Fled') };
/** A condition as the engine words it ("Hurt", "3 of 4 standing"), in the interface language. */
export function condText(label: string): string {
  const group = /^(\d+) of (\d+) standing$/.exec(label);
  return group ? t('{n} of {max} standing', { n: group[1]!, max: group[2]! }) : t(CONDITION_WORD[label] ?? label);
}
/** An answer given outside the story, as paragraphs. */
const paragraphs = (text: string) => text.split(/\n+/).map((x) => x.trim()).filter(Boolean);

/** How the dice of one card stand, and what to do when they are thrown and when they have landed. */
export interface Throw { state: ThrowState; delay: number; animate: boolean; onThrow: () => void; onLanded: () => void }
/** Dice that lie as they fell: every card that is not part of a throw under way. */
const STILL: Throw = { state: 'still', delay: 0, animate: false, onThrow: () => {}, onLanded: () => {} };

/** A number that changes while the dice are in the air: each new value drops into place. */
const Tick = ({ n }: { n: number | string }): ReactNode => <span key={n} className="tick">{n}</span>;

/**
 * A test: the die, the numbers that would have succeeded, and what came of it. Until the die has
 * landed nothing of the outcome is on the card: the scale shows what is needed, and while the die is
 * in the air the scale and the caption follow the face it shows.
 */
export function CheckCard({ result, opposedBy, table = STILL }: { result: TestResult; opposedBy: Person | null; table?: Throw }) {
  const out = OUTCOME[result.outcome];
  const thrown = useThrow(result.die === null ? [] : [result.die], table.state, { animate: table.animate, delay: table.delay, onLanded: table.onLanded });
  const ready = table.state === 'ready';
  const settled = table.state === 'still';
  const face = thrown.shown[0] ?? null;
  const state = ready ? ' is-ready' : !settled ? ' is-rolling' : thrown.landed ? ` is-landed ${out.bad ? 'is-bad' : 'is-good'}` : '';
  const inRange = Math.max(0, Math.min(5, result.target)); // a 6 never succeeds
  const cols: CSSProperties = { gridTemplateColumns: inRange > 0 && inRange < 6 ? `repeat(${inRange},1fr) 2px repeat(${6 - inRange},1fr)` : 'repeat(6,1fr)' };
  return (
    <section className={`check${state}`} aria-label={t('Dice check result')} data-dice={result.die === null ? undefined : ''} data-throw={settled ? undefined : ''} onClick={ready ? table.onThrow : undefined}>
      <header className="check-h">
        <span className="check-k"><Icon name="dice" size={16} />{result.skill ? t('Skill test') : t('{attribute} test', { attribute: attributeName(result.attribute) })}</span>
        {settled
          ? <span className={`badge${out.bad ? ' badge-fail' : ''}`}><Icon name={out.bad ? 'x' : 'check'} size={14} strong />{t(out.label)}</span>
          : <span className={`badge ${ready ? 'badge-roll' : 'badge-wait'}`}><Icon name="dice" size={14} strong />{ready ? t('Your roll') : t('Rolling…')}</span>}
      </header>
      <p className="check-t"><b>{result.skill ? t(result.skill) : attributeName(result.attribute)}</b> {result.label && <span>({result.label})</span>} <span className="tag">{t(DIFFICULTY_NAME[result.difficulty] ?? cap(result.difficulty))}</span></p>
      {result.die === null ? (
        <p className="check-f">{result.auto === 'success' ? t('No roll needed: an easy task for someone with the skill.') : t('No roll: with these odds it was out of reach.')}</p>
      ) : (
        <div className="roll">
          <DieFace
            face={face} air={thrown.air} ask={ready} onPress={ready ? table.onThrow : undefined}
            label={ready ? t('Roll the die') : face === null || !settled ? t('The die is rolling') : t('You rolled {n}', { n: face })}
          />
          <div>
            <ol className="steps" style={cols} aria-hidden="true">
              {[1, 2, 3, 4, 5, 6].flatMap((n) => {
                const mark = settled ? (n === result.die ? (result.passed ? 'hit' : 'miss') : '') : n === face ? 'cur' : '';
                const cls = [n <= inRange ? 'in' : '', mark].filter(Boolean).join(' ');
                const cell = <li key={n} className={cls || undefined}>{n}</li>;
                return n === inRange && inRange < 6 ? [cell, <li key="lim" className="lim" />] : [cell];
              })}
            </ol>
            <p className="scale-cap">
              {face === null
                ? <T text="You need <b>{need}</b> or less" vars={{ need: inRange }} />
                : <T text="Needed {need} or less · rolled <b>{die}</b>" vars={{ need: inRange, die: settled ? face : <Tick n={face} /> }} />}
              {settled && result.die === 6 ? <>{' · '}{t('a 6 always fails')}</> : null}{settled && result.rerolled ? <>{' · '}{t('rerolled from {n}', { n: result.rerolled })}</> : null}
            </p>
          </div>
          <div className="stat q"><span>{t('Quality')}</span><b>{result.passed ? result.quality : '–'}</b></div>
        </div>
      )}
      {opposedBy && <p className={`check-f ${who(opposedBy)}`}>{t('Opposed by')} <Avatar person={opposedBy} size="s" /><b>{opposedBy.name}</b></p>}
      {!result.hasSkill && result.skill && <p className="check-f">{t('Without the {skill} skill.', { skill: t(result.skill) })}</p>}
    </section>
  );
}

/**
 * An attack: both dice, both sums, and the difference. The player's die is white, an opponent's is
 * dark; they are thrown together. While they are in the air the sums count along with the faces
 * they show; what the blow did is told only when both have landed. A 6 doubles Strength or Armor,
 * and that too is seen only then.
 */
export function ClashCard({ beat, table = STILL }: { beat: Extract<Beat, { type: 'attack' }>; table?: Throw }) {
  const e: AttackEvent = beat.event;
  const thrown = useThrow([e.attackDie, e.defenceDie], table.state, { animate: table.animate, delay: table.delay, onLanded: table.onLanded });
  const ready = table.state === 'ready';
  const settled = table.state === 'still';
  const attackFace = thrown.shown[0] ?? null;
  const defenceFace = thrown.shown[1] ?? null;
  const hit = e.damage > 0;
  // What each side brings before the dice. The engine records Strength and Armor already doubled when the die was a 6.
  const power = e.critAttack ? e.power / 2 : e.power;
  const armor = e.critDefence ? e.armor / 2 : e.armor;
  const die = (face: number | null): ReactNode => (face === null ? '?' : settled ? face : <Tick n={face} />);
  const total = (face: number | null, base: number, final: number): ReactNode => (settled ? final : face === null ? '?' : <Tick n={Math.max(0, base + face)} />);
  // An attack made at range is Firepower, not Strength.
  const yourVars = { power: settled && e.critAttack ? t('{n} doubled', { n: power }) : power, skill: e.attackSkill, die: die(attackFace) };
  const theirVars = { sum: `${(settled ? e.power : power) + e.attackSkill}${e.groupBonus ? ` + ${t('{n} for numbers', { n: e.groupBonus })}` : ''}`, die: die(attackFace) };
  const attackSum = beat.byYou
    ? <>{e.ranged ? <T text="Firepower {power} + Skill {skill} + die <b>{die}</b>" vars={yourVars} /> : <T text="Strength {power} + Skill {skill} + die <b>{die}</b>" vars={yourVars} />}{e.penalty ? ` − ${e.penalty}` : ''}</>
    : <>{e.ranged ? <T text="Firepower and Skill {sum} + die <b>{die}</b>" vars={theirVars} /> : <T text="Strength and Skill {sum} + die <b>{die}</b>" vars={theirVars} />}{e.penalty ? ` − ${t('{n} dazzled', { n: e.penalty })}` : ''}</>;
  const defenceSum = beat.onYou
    ? <><T text="Armor {armor} + Skill {skill} + die <b>{die}</b>" vars={{ armor: settled && e.critDefence ? t('{n} doubled', { n: armor }) : armor, skill: e.defenceSkill, die: die(defenceFace) }} />{e.guard ? ` + ${t('{n} guard', { n: e.guard })}` : ''}</>
    : <T text="Armor and Skill {sum} + die <b>{die}</b>" vars={{ sum: (settled ? e.armor : armor) + e.defenceSkill + e.guard, die: die(defenceFace) }} />;
  const condition = condText(e.targetCondition).toLowerCase();
  const press = ready ? table.onThrow : undefined;
  // The player's own die is the one that asks to be thrown: the attack die when they attack, the defence die when they are attacked.
  const mine = beat.onYou ? 'defence' : 'attack';
  const dieLabel = (kind: 'attack' | 'defence', face: number | null) => (ready ? t('Roll the dice') : face === null || !settled ? t('The die is rolling')
    : kind === 'attack' ? t('Attack die: {n}', { n: face }) : t('Defence die: {n}', { n: face }));
  return (
    <section className={`check clash${ready ? ' is-ready' : !settled ? ' is-rolling' : thrown.landed ? ` is-landed${!hit ? '' : beat.onYou ? ' is-bad' : beat.byYou ? ' is-good' : ''}` : ''}`} aria-label={t('Attack result')} data-dice="" data-throw={settled ? undefined : ''} onClick={press}>
      <header className="check-h">
        <span className="check-k"><Icon name="sword" size={16} />{t('Attack · round {n}', { n: e.round })}</span>
        {settled ? (
          <span className={`badge${beat.onYou ? (hit ? ' badge-fail' : '') : hit ? '' : ' badge-wait'}`}>
            {beat.byYou ? (hit ? <><Icon name="check" size={14} strong />{t('Hit · {n} damage', { n: e.damage })}</> : t('Missed')) : hit ? t('{n} damage', { n: e.damage }) : <><Icon name="shield" size={14} strong />{t('Blocked')}</>}
          </span>
        ) : (
          <span className={`badge ${ready ? 'badge-roll' : 'badge-wait'}`}><Icon name="dice" size={14} strong />{!ready ? t('Rolling…') : beat.onYou ? t('Roll to defend') : beat.byYou ? t('Roll to attack') : t('Your roll')}</span>
        )}
      </header>
      <p className="check-t"><b>{beat.byYou ? t('You attack') : beat.attacker}</b> <span>{beat.byYou ? beat.target : t('attacks you')}</span></p>
      <div className="vs">
        <div className="vs-row">
          <DieFace face={attackFace} foe={!beat.byYou} air={thrown.air} ask={ready && mine === 'attack'} onPress={press} label={dieLabel('attack', attackFace)} />
          <div><span className="vs-k">{beat.byYou ? t('Your attack') : t('Their attack')}</span><span className="vs-sum">{attackSum}</span></div>
          <div className="stat"><span>{t('Attack')}</span><b>{total(attackFace, power + e.attackSkill + e.groupBonus - e.penalty, e.attackTotal)}</b></div>
        </div>
        <div className="vs-row">
          <DieFace face={defenceFace} foe={!beat.onYou} air={thrown.air} ask={ready && mine === 'defence'} onPress={press} label={dieLabel('defence', defenceFace)} />
          <div><span className="vs-k">{beat.onYou ? t('Your defence') : t('Their defence')}</span><span className="vs-sum">{defenceSum}</span></div>
          <div className="stat"><span>{t('Defence')}</span><b>{total(defenceFace, armor + e.defenceSkill + e.guard, e.defenceTotal)}</b></div>
        </div>
      </div>
      <div className="clash-foot">
      {!settled && <p className="check-f clash-hint">{t('Attack minus defence is the damage.')}</p>}
      <p className="check-f clash-out">
        {beat.onYou && <Icon name="heart" size={14} fill />}
        {hit ? <>{e.attackTotal} − {e.defenceTotal} = <b>{t('{n} damage', { n: e.damage })}</b></> : <T text="{attack} against {defence}: <b>no damage</b>" vars={{ attack: e.attackTotal, defence: e.defenceTotal }} />}
        {' · '}
        {beat.onYou
          ? <T text="hit points {before} → <b>{after}</b>" vars={{ before: e.hpBefore, after: e.hpAfter }} />
          : <>{hit
            ? <T text="{target} is now <cond>{label}</cond>" vars={{ target: beat.target, label: condition, cond: (inner) => <b className={`cond ${condClass(e.targetCondition)}`}>{inner}</b> }} />
            : <T text="{target} is <cond>{label}</cond>" vars={{ target: beat.target, label: condition, cond: (inner) => <b className={`cond ${condClass(e.targetCondition)}`}>{inner}</b> }} />}{e.membersLost > 0 ? ` · ${t('{n} down', { n: e.membersLost })}` : ''}</>}
      </p>
      </div>
    </section>
  );
}

export function condClass(c: string): string {
  const s = c.toLowerCase();
  if (s.startsWith('unhurt') || s.includes('standing')) return 'cond-0';
  if (s === 'hurt') return 'cond-1';
  if (s.startsWith('badly')) return 'cond-2';
  return 'cond-3';
}

/** A spoken line. Words said aloud are in quotation marks; a gesture between them is set apart in a quieter colour. */
function Say({ person, name, manner, text, segs, fresh, onPick, picked = false }: { person: Person | null; name: string; manner: string | null; text: string; segs?: string[]; fresh?: number; onPick?: () => void; picked?: boolean }) {
  return (
    <article className={`say ${who(person)}${fresh !== undefined ? ' is-fresh' : ''}${onPick ? ' is-pick' : ''}${picked ? ' is-picked' : ''}`} style={fresh !== undefined ? ({ '--i': fresh } as CSSProperties) : undefined} onClick={onPick ? pickOnly(onPick) : undefined}>
      <header className="say-h">{person && <Avatar person={person} size="s" />}<b className="say-n">{name}</b>{manner && <span className="say-m">{manner}</span>}</header>
      <p>
        {speechParts(text, segs).map((part, i) => (part.spoken
          ? <span key={i}>{i > 0 ? ' ' : ''}“{part.text}”</span>
          : <span key={i} className="say-g">{i > 0 ? ' ' : ''}{part.text}</span>))}
      </p>
    </article>
  );
}

/** A question the player put to the narrator outside the story, and the answer. Never part of the story. */
export function AsideView({ aside, you, fresh = false }: { aside: Aside; you: string; /** It has just been answered: the answer arrives the way a passage does. */ fresh?: boolean }) {
  return (
    <>
      <article className="out-q" aria-label={t('Your question to the narrator')} data-anchor>
        <header className="out-h"><Icon name="quill" size={14} />{t('{you} asked the narrator', { you })}<span className="out-tag">{t('Out of the story')}</span></header>
        <p>{aside.question}</p>
      </article>
      <article className="out-a" aria-label={t('The narrator answers, outside the story')}>
        <header className="out-h"><Icon name="quill" size={14} />{t('The narrator')}</header>
        {paragraphs(aside.answer).map((para, i) => <p key={i} className={fresh ? 'is-fresh' : undefined} style={fresh ? ({ '--i': i } as CSSProperties) : undefined}>{para}</p>)}
      </article>
    </>
  );
}

/** The game could not tell what the player meant. Nothing has happened yet: it asks, and waits. */
export function AskCard({ asking, you, onDrop }: { asking: Asking; you: string; onDrop: () => void }) {
  return (
    <>
      <article className="act is-unsent" aria-label={t('Your action, not sent yet')} data-anchor>
        <header className="act-h">{you} <span className="you">{t('You')}</span></header>
        <p>{asking.original}</p>
        <p className="act-f"><Icon name="clock" size={14} />{t('Not sent yet · waiting for your answer')}</p>
      </article>
      <section className="out-a ask is-live" role="status" aria-label={t('The narrator asks what you mean')}>
        <header className="out-h"><Icon name="help" size={14} />{t('Before anything happens, the narrator asks')}</header>
        <p className="ask-q">{asking.question}</p>
        <p className="ask-f"><T text="Pick an answer below or type your own. <drop>Never mind, give my text back</drop>" vars={{ drop: (inner) => <button type="button" className="link" onClick={onDrop}>{inner}</button> }} /></p>
      </section>
    </>
  );
}

/** A press on a passage picks it, unless the reader was selecting text in it. */
const pickOnly = (fn: () => void) => () => { if (!window.getSelection()?.toString()) fn(); };

/** Passages of a turn the player may pick, to keep as true or to correct: which one is picked, what picking does, and what shows under the picked one. */
export interface Pickable { at: number | null; on: (i: number, text: string, who: string | null) => void; bar: ReactNode }

/** The dice of a turn that are still being thrown: where that stands, and what the cards call when they are thrown and when they land. */
export interface TurnTable { table: Table; animate: boolean; onThrow: () => void; onLanded: (at: number) => void }

/** One turn. `shown` is how many passage groups are on screen; the rest wait for Continue. */
export function TurnView({ turn, story, shown, table, latest = false, freshFirst = false, arriving = false, pick }: {
  /** A finished turn, or the one in flight in the same shape (Session.arriving). */
  turn: Pick<Turn, 'beats' | 'groups'>; story: Story; shown: number; latest?: boolean;
  /** The dice of this turn are still being thrown. Absent: they lie as they fell. */
  table?: TurnTable;
  /** The turn came in while this screen was open: its first passage arrives the way a passage does after Continue. */
  freshFirst?: boolean;
  /** The turn is in flight: the action has just been sent and settles into place. */
  arriving?: boolean;
  /** Its passages can be picked (Keep this, That's wrong). */
  pick?: Pickable;
}) {
  const people = story.world.people;
  const limit = shown >= turn.groups.length ? turn.beats.length : (turn.groups[shown] ?? turn.beats.length);
  const all = limit >= turn.beats.length;
  // After Continue, a thin line marks where the new passage starts, and the new passage arrives beat by beat.
  // Only on the turn being read, and only from the second passage on: the first one was already read as it was written.
  const fromGroup = latest && shown >= 2 && shown <= turn.groups.length ? turn.groups[shown - 1] : undefined;
  const mark = fromGroup !== undefined && fromGroup > 0 ? fromGroup : -1;
  const firstEnd = turn.groups[1] ?? turn.beats.length;
  let order = 0;
  let orderFirst = 0;
  let dice = 0;
  return (
    <>
      {turn.beats.map((b, i) => {
        // Nothing is shown ahead of the dice: a card waits for the throw before it, and the telling for them all.
        const at = hasDice(b) ? dice++ : -1;
        const stands = table && at >= 0 ? cardThrow(table.table, at) : null;
        if (table && (at >= 0 ? !stands : b.type !== 'action' && !isTold(table.table, dice))) return null;
        const thrown: Throw | undefined = table && stands ? { ...stands, animate: table.animate, onThrow: table.onThrow, onLanded: () => table.onLanded(at) } : undefined;
        // Story text waits for its turn; notes about what the rules did arrive with the last passage.
        if (i >= limit && (b.type === 'narration' || b.type === 'say')) return null;
        if (b.type === 'notes' && !all && i > (turn.groups[1] ?? 0)) return null;
        const told = b.type === 'narration' || b.type === 'say' || b.type === 'notes';
        const fresh = mark >= 0 && i >= mark ? order++ : freshFirst && told && i < firstEnd ? orderFirst++ : undefined;
        const line = i === mark ? <div key="mark" className="newmark" role="separator" aria-label={t('New from here')} data-mark data-anchor /> : null;
        const freshStyle = fresh !== undefined ? ({ '--i': fresh } as CSSProperties) : undefined;
        switch (b.type) {
          case 'action':
            return (
              <article key={i} className={`act${arriving ? ' pop' : ''}`} aria-label={t('Your action')} data-anchor>
                <header className="act-h">{story.protagonist.name} <span className="you">{t('You')}</span>{b.to && people[b.to] && <span className="t-2" style={{ fontWeight: 400 }}>{t('to {name}', { name: people[b.to]!.name })}</span>}</header>
                <p>{b.text}</p>
                {b.clarified && <p className="act-f"><Icon name="help" size={14} /><T text="Asked what you meant · <b>{what}</b>" vars={{ what: b.clarified }} /></p>}
              </article>
            );
          case 'check': return <CheckCard key={i} result={b.result} opposedBy={b.opposedBy ? people[b.opposedBy] ?? null : null} table={thrown} />;
          case 'attack': return <ClashCard key={i} beat={b} table={thrown} />;
          case 'narration': return [line, <p key={i} className={`narr${fresh !== undefined ? ' is-fresh' : ''}${pick ? ' is-pick' : ''}${pick?.at === i ? ' is-picked' : ''}`} style={freshStyle} onClick={pick ? pickOnly(() => pick.on(i, b.text, null)) : undefined}>{b.text}</p>, pick?.at === i ? <div key={`bar-${i}`}>{pick.bar}</div> : null];
          case 'say': return [line, <Say key={i} person={b.who ? people[b.who] ?? null : null} name={b.name} manner={b.manner} text={b.text} segs={b.segs} fresh={fresh} picked={pick?.at === i} onPick={pick ? () => pick.on(i, `${b.name}: “${b.text}”`, b.who || null) : undefined} />, pick?.at === i ? <div key={`bar-${i}`}>{pick.bar}</div> : null];
          case 'notes': return <div key={i} className={fresh !== undefined ? 'is-fresh' : undefined} style={freshStyle}><Notes notes={b.notes} people={people} /></div>;
          case 'scene': return <h2 key={i} className="scene">{b.title}</h2>;
        }
      })}
    </>
  );
}

/**
 * Under the turn in flight: what is being waited for. Once the first passage is on screen it shrinks
 * to the shape of the "more below" cue and sits where that cue will be, so nothing moves when the
 * reply is complete.
 */
export function Waiting({ phase, first, place }: { phase: string; first: boolean; place?: string | null }) {
  if (first) {
    return (
      <div className="more-cue is-wait" role="status" aria-label={t('The narrator is still writing the rest')}>
        <span className="dots" aria-hidden="true"><i /><i /><i /></span>
      </div>
    );
  }
  return (
    <div className="writing" role="status">
      <span className="dots" aria-hidden="true"><i /><i /><i /></span>
      <div>
        <p className="writing-t">{phase === 'mapping' ? (place ? t('Writing {place} into the world…', { place }) : t('Writing this place into the world…')) : phase === 'recording' ? t('Writing up the last scene…') : phase === 'thinking' ? t('Working out what happens…') : t('The narrator is writing…')}</p>
        {phase === 'writing' && <p className="writing-s">{t('Stop gives your action back to change it. What was already written is still charged.')}</p>}
        {phase === 'mapping' && <p className="writing-s">{t('Until now it was one line on the map. This happens once, the first time you arrive.')}</p>}
      </div>
    </div>
  );
}

/**
 * What is in flight when it is not an ordinary turn (that one is drawn by TurnView, from
 * Session.arriving): a question to the narrator, or an action that did not go through.
 */
export function LiveTurn({ story, live, held }: { story: Story; live: NonNullable<Session['live']>; held: 'waiting' | 'declined' | null }) {
  if (live.aside) {
    // A question to the narrator, outside the story: shown apart from the story from the first moment.
    // The answer is not shown while it is being written; it arrives whole when it is finished.
    return (
      <>
        <article className={`out-q pop${held ? ' is-unsent' : ''}`} aria-label={t('Your question to the narrator')} data-anchor>
          <header className="out-h"><Icon name="quill" size={14} />{t('{you} asked the narrator', { you: story.protagonist.name })}<span className="out-tag">{t('Out of the story')}</span></header>
          <p>{live.text}</p>
          {held && <p className="act-f"><Icon name={held === 'declined' ? 'x-circle' : 'clock'} size={14} />{held === 'declined' ? t('Not answered') : t('Not sent yet · kept until it can go out')}</p>}
        </article>
        {!held && (
          <article className="out-a is-live" aria-label={t('The narrator answers, outside the story')} aria-busy="true">
            <header className="out-h"><Icon name="quill" size={14} />{t('The narrator')}</header>
            <p className="out-wait"><span className="dots" aria-hidden="true"><i /><i /><i /></span>{t('Answering…')}</p>
          </article>
        )}
      </>
    );
  }
  if (!held) return null;
  // The turn did not go through: the action stays in view, marked as not part of the story yet.
  return (
    <article className="act is-unsent" aria-label={t('Your action, not sent')} data-anchor>
      <header className="act-h">{story.protagonist.name} <span className="you">{t('You')}</span></header>
      <p>{live.text}</p>
      <p className="act-f"><Icon name={held === 'declined' ? 'x-circle' : 'clock'} size={14} />{held === 'declined' ? t('Not sent · not part of the story') : t('Not sent yet · kept until it can go out')}</p>
    </article>
  );
}
