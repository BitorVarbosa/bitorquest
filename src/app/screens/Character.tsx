// The character sheet: who the protagonist is and what they can do, in three tabs (Sheet, Abilities,
// Inventory). Experience is spent in a dialog; the engine decides what can be raised and what it costs.
import { Fragment, useState, type ReactNode } from 'react';
import {
  ATTRIBUTES, EXTREME_SKILL_FACTOR, GIFT_RANK_MAX, GIFT_TEXT, PATHS, SCHOOLS, SKILLS, SKILL_INFO, XP_PER_LEVEL, XP_TO_AWAKEN, XP_TO_LEARN, abilityById, abilityCost, canKeep, canLearn, canRaiseAttribute, canRaiseGift, canRaisePath,
  canUseAbility, fightEffect, learnDifficulty, libraryOf, maxEnergy, maxHp, moveRoom, schoolsOf, testTarget, traitInfo,
  MOVES_MAX, OWN_POWER, POWERS_MAX, moveKey, movesHeld, powerById, powersOf,
  type Ability, type Attribute, type GiftKind, type Found, type HeldPower, type Path, type RaiseBlocked, type Sheet, type SkillName, type TestResult, type TraitKind, type Worked,
} from '../../engine';
import { XP_TO_LEARN_DISCIPLINE, canAwakenDiscipline, canEat, canLearnDiscipline, canSetAside, hasNatureHeld, holdsDiscipline, relicOf } from '../../game/arts';
import type { Session } from '../../game/session';
import { hasMoney, moneyOf, purseOf } from '../../game/money';
import type { Item, Story } from '../../game/types';
import { useApp } from '../app';
import { GiftCard, GiftFields, MoveCard, fightLine, toggleKind } from '../components/Gift';
import type { IconName } from '../icons';
import { href } from '../router';
import { StoryPage } from '../Shell';
import { T } from '../T';
import { Avatar, Die, Icon, Meter, Modal, Stepper } from '../ui';
import { m, t, tn } from '../../i18n';
import './character.css';

// What each attribute and path is for, by the rules (engine/combat.ts, engine/types.ts).
const ATTRIBUTE_INFO: Record<Attribute, { name: string; text: string }> = {
  strength: { name: m('Strength'), text: m('Close combat. Added to your attack.') },
  skill: { name: m('Skill'), text: m('Agility and wits. In attack, defence and initiative.') },
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
const ITEM_GROUPS: { kind: Item['kind']; label: string; icon: IconName }[] = [
  { kind: 'relic', label: m('Items of power'), icon: 'spark' },
  { kind: 'quest', label: m('Quest'), icon: 'flag' },
  { kind: 'gear', label: m('Gear'), icon: 'bag' },
  { kind: 'consumable', label: m('Consumables'), icon: 'flask' },
  { kind: 'keepsake', label: m('Keepsakes'), icon: 'heart' },
];
const TABS = [{ id: 'sheet', label: m('Sheet') }, { id: 'abilities', label: m('Abilities') }, { id: 'inventory', label: m('Inventory') }] as const;
type TabId = (typeof TABS)[number]['id'];

const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
/** A trait as written on a sheet: only the part before the colon is the rules' own text; the detail is the player's. */
const traitName = (name: string): string => { const i = name.indexOf(': '); return i < 0 ? t(name) : `${t(name.slice(0, i))}: ${name.slice(i + 2)}`; };

/** The paths the character has first, then the rest in the usual order. */
const pathsInOrder = (s: Sheet): Path[] => [...PATHS].sort((a, b) => (s.paths[b] ?? 0) - (s.paths[a] ?? 0));

/** Where one of the protagonist's powers came from, in words; nothing for the one by nature. Names are shown as written. */
function sourceLine(story: Story, x: HeldPower): string {
  const a = x.art;
  if (!a) return '';
  if (a.source === 'taught') return t('A discipline you learned');
  if (a.source === 'item') {
    const item = story.protagonist.items.find((i) => i.id === a.from);
    return item ? t('From {item}, while you carry it', { item: item.name }) : t('From an item you carry');
  }
  const who = (a.from ? story.world.people[a.from]?.name : undefined) ?? t('someone');
  return a.stolen ? t('Taken from {name} until the scene ends', { name: who }) : t('Copied from {name} until the scene ends', { name: who });
}

/** A level from 0 to 5 as five blocks. Blocks above the story's limit are drawn hollow. */
function Pips({ value, limit = 5 }: { value: number; limit?: number }) {
  return (
    <span className="pips" role="img" aria-label={limit < 5 ? t('{value}, the limit is {limit}', { value, limit }) : t('{value} of 5', { value })}>
      {[0, 1, 2, 3, 4].map((i) => <i key={i} className={i < value ? 'on' : i >= limit ? 'above' : undefined} />)}
    </span>
  );
}

function Trait({ name, text, value, limit, dim }: { name: string; text: string; value: number; limit?: number; dim?: boolean }) {
  return (
    <div className={`row chr-trait${dim ? ' is-zero' : ''}`}>
      <div className="grow"><div className="row-t">{name}</div><div className="row-s">{text}</div></div>
      <div className="row-end"><Pips value={value} limit={limit} /><b className={`chr-lv${value === 0 ? ' zero' : ''}`}>{value}</b></div>
    </div>
  );
}

/** A fight number written as a sum; the die still to be rolled is the white die with a question mark. */
function Sum({ label, parts }: { label: string; parts: [string, number][] }) {
  return (
    <div className="chr-calc">
      <span>{t(label)}</span>
      <div className="chr-sum">
        {parts.map(([k, v]) => (
          <Fragment key={k}><span className="stat"><span>{t(k)}</span><b>{v}</b></span><span className="chr-op" aria-hidden="true">+</span></Fragment>
        ))}
        <span className="die die-s chr-die" role="img" aria-label={t('plus one die')}>?</span>
      </div>
    </div>
  );
}

/** Skills: the name and, under it, what the skill covers. */
function SkillRows({ names }: { names: SkillName[] }) {
  return (
    <div className="card card-flush">
      {names.map((n) => (
        <div key={n} className="row chr-trait"><div className="grow"><div className="row-t">{t(n)}</div><div className="row-s">{t(SKILL_INFO[n])}</div></div></div>
      ))}
    </div>
  );
}

/**
 * Advantages or drawbacks. Each row says in one line what the trait is; pressing it opens what it
 * does in play and who applies it: the rules, with a number, or the narrator, in the story.
 */
function TraitRows({ names, kind }: { names: string[]; kind: TraitKind }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="card card-flush">
      {names.map((n, i) => {
        const info = traitInfo(n, kind);
        const isOpen = open === n;
        const id = `chr-tr-${kind}-${i}`;
        return (
          <div key={n} className={`chr-tr${isOpen ? ' is-open' : ''}`}>
            <button className="row chr-trait" aria-expanded={isOpen} aria-controls={id} onClick={() => setOpen(isOpen ? null : n)}>
              <span className="grow">
                <span className="row-t">{traitName(info.written)}</span>
                <span className="row-s">{t(info.summary)}</span>
              </span>
              <span className="row-end">
                {info.effect && <span className="tag tag-accent">{t(info.effect)}</span>}
                <Icon name="down" size={18} className="chev" />
              </span>
            </button>
            {isOpen && (
              <div className="chr-tr-b" id={id}>
                <p>{t(info.text)}</p>
                <p className="chr-tr-how">
                  <Icon name={info.how === 'rules' ? 'dice' : 'quill'} size={16} />
                  <span>{info.how === 'rules'
                    ? t('Applied by the rules, every time. There is nothing for you to remember.')
                    : t('No number is attached. The narrator knows this about you and lets it matter when the story touches it.')}</span>
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SheetTab({ session }: { session: Session }) {
  const story = session.story;
  const s = story.protagonist.sheet;
  const rules = story.world.rules;
  const quick = s.advantages.includes('Quick Reflexes');
  const paths = pathsInOrder(s);
  const powers = powersOf(s);
  // A world of gifts has no paths, and neither has a world without powers.
  const showPaths = rules.powers === 'focus' || rules.powers === 'extreme' || paths.some((k) => (s.paths[k] ?? 0) > 0);
  return (
    <div className="split stack-l">
      <div className="stack-l">
        <section className="sec">
          <div className="sec-h"><h2>{t('Attributes')}</h2><span className="t-xs t-2">{t('Each from 0 to 5')}</span></div>
          <div className="card card-flush">
            {ATTRIBUTES.map((k) => <Trait key={k} name={t(ATTRIBUTE_INFO[k].name)} text={t(ATTRIBUTE_INFO[k].text)} value={s[k]} />)}
          </div>
        </section>

        {showPaths && (
          <section className="sec">
            <div className="sec-h"><h2>{t('Paths')}</h2><span className="t-xs t-2">{rules.pathCap < 5 ? t('No higher than {cap} in this story', { cap: rules.pathCap }) : t('Each from 0 to 5')}</span></div>
            <div className="card card-flush">
              {paths.map((k) => <Trait key={k} name={t(PATH_INFO[k].name)} text={t(PATH_INFO[k].text)} value={s.paths[k] ?? 0} limit={rules.pathCap} dim={(s.paths[k] ?? 0) === 0} />)}
            </div>
          </section>
        )}

        {rules.powers === 'gift' && powers.length > 0 && (
          <section className="sec">
            <div className="sec-h"><h2>{powers.length > 1 ? t('Your powers') : t('Your power')}</h2><span className="t-xs t-2">{t('Rank from 1 to {max}', { max: GIFT_RANK_MAX })}</span></div>
            <div className="card card-flush">
              {/* The names and the texts are the player's own words, or the world's: shown as written. */}
              {powers.map((x) => <Trait key={x.id} name={x.gift.name} text={[sourceLine(story, x), x.gift.text].filter(Boolean).join(' · ')} value={x.gift.rank} limit={GIFT_RANK_MAX} />)}
            </div>
          </section>
        )}

        <section className="sec">
          <div className="sec-h"><h2>{t('Skills')}</h2><span className="t-xs t-2">{t('{n} of {total}', { n: s.skills.length, total: SKILLS.length })}</span></div>
          {s.skills.length > 0 ? <SkillRows names={s.skills} /> : <p className="t-2">{t('No skills yet.')}</p>}
          <p className="help">{t('With the right skill an easy test succeeds without a roll, a medium test is rolled at the attribute + 1 and a hard one at the attribute − 2.')}</p>
        </section>
      </div>

      <div className="stack-l">
        <section className="sec">
          <div className="sec-h"><h2>{t('In a fight')}</h2></div>
          <div className="card stack">
            <div className="chr-calcs">
              <Sum label={m('Attack')} parts={[[m('Strength'), s.strength], [m('Skill'), s.skill]]} />
              {s.firepower > 0 && <Sum label={m('At range')} parts={[[m('Firepower'), s.firepower], [m('Skill'), s.skill]]} />}
              <Sum label={m('Defence')} parts={[[m('Armor'), s.armor], [m('Skill'), s.skill]]} />
              <Sum label={m('Initiative')} parts={quick ? [[m('Skill'), s.skill], [m('Reflexes'), 1]] : [[m('Skill'), s.skill]]} />
            </div>
            <p className="help">{t('Damage is the attack total minus the defence total. A 6 on the die doubles Strength when you attack and Armor when you defend.')}{s.firepower > 0 ? ` ${t('You attack at range when Firepower is higher than Strength, and the 6 then doubles Firepower.')}` : ''}</p>
          </div>
        </section>

        {s.advantages.length > 0 && (
          <section className="sec">
            <div className="sec-h"><h2>{t('Advantages')}</h2><span className="t-xs t-2">{t('Press one to see what it does')}</span></div>
            <TraitRows names={s.advantages} kind="advantage" />
          </section>
        )}

        {s.disadvantages.length > 0 && (
          <section className="sec">
            <div className="sec-h"><h2>{t('Disadvantages')}</h2><span className="t-xs t-2">{t('Press one to see what it does')}</span></div>
            <TraitRows names={s.disadvantages} kind="disadvantage" />
          </section>
        )}
      </div>
    </div>
  );
}

/** What an ability does in a fight, from the effect the engine applies. */
function inFight(a: Ability): string | null {
  return a.combat ? fightLine(a.combat) : null;
}

/** One ability as a card: what it is, what a use costs here, what it does in a fight, and anything that stands in the way. */
function AbilityCard({ ab, cost, why, children }: { ab: Ability; cost: number; why?: string | null; children?: ReactNode }) {
  const fight = inFight(ab);
  return (
    <article className="card chr-abil">
      <div className="chr-abil-h">
        <h3 className="card-n">{t(ab.name)}</h3>
        <span className="tag">{t(PATH_INFO[ab.path].name)} <b>{ab.tier}</b></span>
        <span className="chr-abil-c"><Icon name="bolt" size={14} fill />{t('{cost} energy', { cost })}</span>
      </div>
      <p className="chr-abil-d">{t(ab.text)}</p>
      {fight && <p className="chr-abil-f"><Icon name="sword" size={16} /><span>{t('In a fight: {fight}', { fight })}</span></p>}
      {why && <p className="chr-abil-f"><Icon name="lock" size={16} /><span>{why}</span></p>}
      {children}
    </article>
  );
}

/**
 * A new use of the power that worked once, waiting to be kept as a move. The player names it and may
 * rewrite its line; the tier is the one it was rated at, or lower; what it does in a fight follows.
 */
function WorkedCard({ session, index, worked, many }: { session: Session; index: number; worked: Worked; /** The character holds more than one power: say which this was a use of. */ many: boolean }) {
  const me = session.story.protagonist;
  const held = powerById(me.sheet, worked.power ?? OWN_POWER);
  const gift = held?.gift;
  const top = Math.max(1, Math.min(worked.tier, gift?.rank ?? 1));
  const [name, setName] = useState('');
  const [text, setText] = useState(worked.text);
  const [tier, setTier] = useState(top);
  const locked = session.busy || !!session.combat;
  const blocked = canKeep(me.sheet, worked, name, tier, me.xp, XP_TO_LEARN);
  const effect = gift && worked.fight && gift.kinds.includes(worked.fight) ? fightEffect(worked.fight, tier) : undefined;
  const id = `chr-worked-${index}`;
  // The power it was a use of is no longer held (an item set aside, say): it can only be let go, or wait.
  if (!gift) {
    return (
      <article className="card gf-edit">
        <div className="gf-card"><p className="gf-d">“{worked.text}”</p></div>
        <div className="gf-acts">
          <button type="button" className="link link-tap" disabled={locked} onClick={() => session.dropWorked(index)}>{t('Let it go')}</button>
          <span className="t-sm t-2">{t('The power it was a use of is not in use now.')}</span>
        </div>
      </article>
    );
  }
  return (
    <article className="card gf-edit">
      <div className="gf-card">
        {/* The power's name is the player's own words, or the world's: shown as written. */}
        {many && <p className="gf-src">{t('A use of {power}', { power: gift.name })}</p>}
        <p className="gf-d">“{worked.text}”</p>
        <p className="gf-f"><Icon name="sword" size={16} /><span>{effect ? t('In a fight: {fight}', { fight: fightLine(effect) }) : t('It does nothing in a fight by itself.')}</span></p>
      </div>
      <div className="f">
        <label className="label" htmlFor={`${id}-n`}>{t('Name it')}</label>
        <input className="input" id={`${id}-n`} type="text" value={name} maxLength={GIFT_TEXT.moveName} autoComplete="off" onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="f">
        <label className="label" htmlFor={`${id}-t`}>{t('What you do')}</label>
        <textarea className="input gf-auto" id={`${id}-t`} rows={2} value={text} maxLength={GIFT_TEXT.moveText} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="gf-row">
        <div className="grow">
          <span className="label">{t('Tier')}</span>
          <p className="help">{top > 1 ? t('It reached {top}. Kept lower it does less, and costs less: {cost} energy a use.', { top, cost: tier }) : t('Its reach, and its cost: {cost} energy a use.', { cost: tier })}</p>
        </div>
        <Stepper label={t('Tier')} value={tier} min={1} max={top} onChange={setTier} />
      </div>
      <div className="gf-acts">
        <button type="button" className="btn btn-soft btn-fit" disabled={!!blocked || locked} onClick={() => session.keepWorked(index, name, text, tier)}>{t('Keep · {n} experience', { n: XP_TO_LEARN })}</button>
        <button type="button" className="link link-tap" disabled={locked} onClick={() => session.dropWorked(index)}>{t('Let it go')}</button>
        <span className="t-sm t-2">
          {blocked === 'full' ? t('No room: a power of rank {rank} holds {n} moves. Forget one, or raise the rank.', { rank: gift.rank, n: moveRoom(gift.rank) })
            : blocked === 'all' ? t('No room: your powers hold {n} moves in all. Forget one first.', { n: MOVES_MAX })
            : blocked === 'borrowed' ? t('Nothing is kept from a power that is only borrowed.')
            : blocked === 'xp' ? t('No experience to spend yet.')
              : blocked === 'name' ? t('Give it a name to keep it.')
                : t('It becomes a move: yours to use at will, with no test.')}
        </span>
      </div>
    </article>
  );
}

/** Writing a power for someone who has none: what it is, its limit, and what it can do in a fight. */
function AwakenDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  const me = session.story.protagonist;
  const [gift, setGift] = useState<{ name: string; text: string; limit: string; kinds: GiftKind[] }>({ name: '', text: '', limit: '', kinds: [] });
  const locked = session.busy || !!session.combat;
  const ready = !!gift.name.trim() && !!gift.text.trim() && me.xp >= XP_TO_AWAKEN && !locked;
  const awaken = () => { if (session.awaken(gift)) onClose(); };
  return (
    <Modal
      title={t('Awaken a power')} onClose={onClose}
      foot={<><button className="btn" onClick={onClose}>{t('Not now')}</button><button className="btn btn-primary" disabled={!ready} onClick={awaken}>{t('Awaken · {n} experience', { n: XP_TO_AWAKEN })}</button></>}
    >
      <p className="t-2">{t('Say what it is, in your own words. It starts at rank 1, a small trick at arm’s length, with no moves: try things with it in the story, and keep what works.')}</p>
      <div className="stack">
        <GiftFields gift={gift} prefix="chr-awaken" onChange={(patch) => setGift((g) => ({ ...g, ...patch }))} onToggleKind={(k) => setGift((g) => { const next = { ...g, kinds: [...g.kinds] }; toggleKind(next, k); return next; })} />
      </div>
    </Modal>
  );
}

/**
 * A world of gifts: the character's powers (the one by nature, and any gained in play), the moves they
 * have made their own in each, and the new uses that worked and wait to be kept. Never more than four
 * powers in use, eight moves of one's own and three uses waiting, by the rules.
 */
/**
 * The disciplines of a world of gifts that the protagonist could gain now or later: those someone
 * showed them, to learn; and those that cannot be taught, which awaken only after being brought down.
 * Nothing when the world has none, or when every one is held.
 */
function Disciplines({ session }: { session: Session }) {
  const story = session.story;
  const me = story.protagonist;
  const locked = session.busy || !!session.combat;
  const shown = (story.world.disciplines ?? []).filter((d) => d.taught && (me.found ?? []).some((f) => f.id === d.id) && !holdsDiscipline(me.sheet, d.id));
  const latent = (story.world.disciplines ?? []).filter((d) => !d.taught && !holdsDiscipline(me.sheet, d.id));
  if (!shown.length && !latent.length) return null;
  const why = (reason: string | null): string | null => reason === 'room' ? t('You hold {n} powers already: there is no room for another.', { n: POWERS_MAX })
    : reason === 'xp' ? t('Needs {cost} experience. You have {xp}.', { cost: XP_TO_LEARN_DISCIPLINE, xp: me.xp }) : null;
  return (
    <section className="sec">
      <div className="sec-h"><h2>{t('Disciplines')}</h2><span className="t-xs t-2">{t('Powers many people here share')}</span></div>
      <div className="grid grid-2">
        {shown.map((d) => {
          const stop = canLearnDiscipline(story, d.id);
          const by = (me.found ?? []).find((f) => f.id === d.id)?.by;
          const teacher = by ? story.world.people[by]?.name : undefined;
          return (
            // The discipline's name and words are the world's: shown as written.
            <GiftCard key={d.id} gift={{ name: d.name, text: d.text, limit: d.limit, rank: 1, kinds: d.kinds, moves: [] }} source={teacher ? t('Shown to you by {name}', { name: teacher }) : undefined}>
              <div className="gf-acts">
                <button type="button" className="btn btn-soft btn-fit" disabled={!!stop || locked} onClick={() => session.learnDiscipline(d.id)}>{t('Learn · {n} experience', { n: XP_TO_LEARN_DISCIPLINE })}</button>
                <span className="t-sm t-2">{why(stop) ?? t('You hold it at rank 1, with its first move: {move}.', { move: d.move.name })}</span>
              </div>
            </GiftCard>
          );
        })}
        {latent.map((d) => {
          const stop = canAwakenDiscipline(story, d.id);
          return (
            <GiftCard key={d.id} gift={{ name: d.name, text: d.text, limit: d.limit, rank: 1, kinds: d.kinds, moves: [] }} source={t('It cannot be taught')}>
              <div className="gf-acts">
                {stop === 'not_now'
                  ? <span className="t-sm t-2">{t('It may awaken in you in a scene where you have been brought down in a fight, or in the one after.')}</span>
                  : <>
                    <button type="button" className="btn btn-soft btn-fit" disabled={!!stop || locked} onClick={() => session.awakenDiscipline(d.id)}>{t('Awaken · {n} experience', { n: XP_TO_LEARN_DISCIPLINE })}</button>
                    <span className="t-sm t-2">{why(stop) ?? t('You were brought down, and something in you answered. It can awaken now, or in the next scene.')}</span>
                  </>}
              </div>
            </GiftCard>
          );
        })}
      </div>
    </section>
  );
}

/** Powers someone took from the protagonist: whose they are, and what brings them back. */
function TakenFromYou({ session }: { session: Session }) {
  const story = session.story;
  const lost = story.protagonist.lost ?? [];
  if (!lost.length) return null;
  return (
    <section className="sec">
      <div className="sec-h"><h2>{t('Taken from you')}</h2></div>
      <div className="grid grid-2">
        {lost.map((l) => (
          // The power's name and words are the player's own, or the world's: shown as written.
          <GiftCard key={`${l.by}:${l.power.name}`} gift={l.power} brief source={t('Held by {name}. Beat them, or outlive them, and it comes back.', { name: story.world.people[l.by]?.name ?? t('someone') })} />
        ))}
      </div>
    </section>
  );
}

function GiftTab({ session }: { session: Session }) {
  const story = session.story;
  const me = story.protagonist;
  const s = me.sheet;
  const powers = powersOf(s);
  const locked = session.busy || !!session.combat;
  const [awakening, setAwakening] = useState(false);
  /** The move whose Forget was pressed once: a second press does it. */
  const [forgetting, setForgetting] = useState<string | null>(null);
  const dialog = awakening && <AwakenDialog session={session} onClose={() => setAwakening(false)} />;

  if (powers.length === 0 && hasNatureHeld(story)) {
    return (
      <>
        <TakenFromYou session={session} />
        <Disciplines session={session} />
      </>
    );
  }
  if (powers.length === 0) {
    return (
      <>
        <section className="empty">
          <Icon name="spark" size={40} />
          <h2>{t('No power of your own')}</h2>
          <p>{t('In this world a power is personal, and your character has none. One can awaken: it costs {xp} experience, you say what it is, and it starts small.', { xp: XP_TO_AWAKEN })}</p>
          <button type="button" className="btn btn-primary btn-fit" disabled={locked || me.xp < XP_TO_AWAKEN} onClick={() => setAwakening(true)}>{t('Awaken a power · {n} experience', { n: XP_TO_AWAKEN })}</button>
          {me.xp < XP_TO_AWAKEN && <p className="t-sm t-2">{t('You have {xp} experience to spend.', { xp: me.xp })}</p>}
        </section>
        <Disciplines session={session} />
        {dialog}
      </>
    );
  }

  const many = powers.length > 1;
  const first = powers[0]!;
  const worked = me.worked ?? [];
  const why = (key: string, tier: number): string | null => {
    const can = canUseAbility(s, key, 'gift');
    return can.ok ? null : can.reason === 'energy' ? t('Needs {cost} energy · you have {energy}', { cost: tier, energy: s.energy }) : null;
  };
  /** One power's moves, with Forget on each (nothing is forgotten from a borrowed power: it goes back whole). */
  const movesOf = (x: HeldPower) => {
    const moves = [...x.gift.moves].sort((a, b) => a.tier - b.tier);
    const borrowed = x.art?.source === 'borrowed';
    if (moves.length === 0) return <p className="t-2">{many ? t('No moves yet.') : t('No moves yet. Try something your power could do, in the story: when it works, it can be kept here.')}</p>;
    return (
      <div className="grid grid-3">
        {moves.map((mv) => {
          const key = moveKey(x.id, mv.id);
          return (
            <MoveCard key={key} move={mv} why={why(key, mv.tier)}>
              {!borrowed && (
                <div className="gf-acts">
                  {forgetting === key
                    ? <>
                      <button type="button" className="btn btn-fit" disabled={locked} onClick={() => { session.forgetMove(key); setForgetting(null); }}>{t('Forget it for good')}</button>
                      <button type="button" className="link link-tap" onClick={() => setForgetting(null)}>{t('Keep it')}</button>
                    </>
                    : <button type="button" className="link link-tap" disabled={locked} onClick={() => setForgetting(key)}>{t('Forget')}</button>}
                </div>
              )}
            </MoveCard>
          );
        })}
      </div>
    );
  };

  return (
    <>
      {many ? (
        <section className="sec">
          <div className="sec-h"><h2>{t('Your powers · {n} of {max}', { n: powers.length, max: POWERS_MAX })}</h2><span className="t-xs t-2">{t('{xp} experience to spend', { xp: me.xp })}</span></div>
          <p className="help">{t('No use of a power reaches further than its rank. Your own power and the disciplines you learn grow with experience, {cost} a level, to {max}. Moves: {n} of {all} in all.', { cost: XP_PER_LEVEL, max: GIFT_RANK_MAX, n: movesHeld(s), all: MOVES_MAX })}</p>
        </section>
      ) : (
        <section className="sec">
          <div className="sec-h"><h2>{t('Your power')}</h2><span className="t-xs t-2">{t('{xp} experience to spend', { xp: me.xp })}</span></div>
          <GiftCard gift={first.gift} source={sourceLine(story, first)} />
          <p className="help">{first.gift.rank < GIFT_RANK_MAX
            ? t('No use of it reaches further than its rank. Raise the rank with experience, {cost} a level, to {max}.', { cost: XP_PER_LEVEL, max: GIFT_RANK_MAX })
            : t('At rank {max} it reaches as far as a power can.', { max: GIFT_RANK_MAX })}</p>
        </section>
      )}

      {worked.length > 0 && (
        <section className="sec">
          <div className="sec-h"><h2>{t('Worked out · {n}', { n: worked.length })}</h2></div>
          <p className="help">{t('New uses of your power that worked once. Keep one as a move, or let it go. Three wait at most: a fourth takes the place of the oldest.')}</p>
          <div className="grid grid-2">
            {worked.map((w, i) => <WorkedCard key={`${w.power ?? ''}:${w.text}`} session={session} index={i} worked={w} many={many} />)}
          </div>
        </section>
      )}

      {powers.map((x) => {
        const room = moveRoom(x.gift.rank);
        return (
          <section className="sec" key={x.id}>
            {many && <GiftCard gift={x.gift} source={sourceLine(story, x)} brief />}
            <div className="sec-h">
              {/* The power's name is the player's own words, or the world's: shown as written. */}
              {/* A borrowed power keeps no moves of its own: it has no room to count. */}
              {many ? <h3>{x.art?.source === 'borrowed' ? t('Moves of {power} · borrowed', { power: x.gift.name }) : t('Moves of {power} · {n} of {room}', { power: x.gift.name, n: x.gift.moves.length, room })}</h3> : <h2>{t('Moves · {n} of {room}', { n: x.gift.moves.length, room })}</h2>}
              {!many && <span className="t-xs t-2">{t('Each use costs energy')}</span>}
            </div>
            {movesOf(x)}
          </section>
        );
      })}

      <TakenFromYou session={session} />
      <Disciplines session={session} />

      {!s.gift && !hasNatureHeld(story) && (
        <section className="sec">
          <div className="sec-h"><h2>{t('No power of your own')}</h2></div>
          <p className="help">{t('Besides these, a power of your own can awaken: it costs {xp} experience, you say what it is, and it starts small.', { xp: XP_TO_AWAKEN })}</p>
          <button type="button" className="btn btn-fit" disabled={locked || me.xp < XP_TO_AWAKEN} onClick={() => setAwakening(true)}>{t('Awaken a power · {n} experience', { n: XP_TO_AWAKEN })}</button>
        </section>
      )}

      <p className="help chr-how">{many
        ? t('A move is yours to use at will, for energy equal to its tier. Anything else one of your powers could do can be tried in the story: it costs one energy more and is a Skill test, and it reaches no further than that power’s rank. What works is kept as a new move of that power, for {xp} experience. Each power holds two moves for each rank, and all of them together {all}.', { xp: XP_TO_LEARN, all: MOVES_MAX })
        : t('A move is yours to use at will, for energy equal to its tier. Anything else your power could do can be tried in the story: it costs one energy more and is a Skill test, and it reaches no further than the rank. What works is kept here as a new move, for {xp} experience. A power of rank {rank} holds {room} moves.', { xp: XP_TO_LEARN, rank: first.gift.rank, room: moveRoom(first.gift.rank) })}</p>
      {dialog}
    </>
  );
}

function AbilitiesTab({ session }: { session: Session }) {
  const story = session.story;
  const me = story.protagonist;
  const s = me.sheet;
  const mode = story.world.rules.powers;
  // The roll of the last attempt to learn, shown on the card it was for until another is tried.
  const [tried, setTried] = useState<{ id: string; result: TestResult } | null>(null);
  const [path, setPath] = useState<Path | null>(null);

  if (mode === 'off') {
    return (
      <section className="empty">
        <Icon name="spark" size={40} />
        <h2>{t('No powers in this world')}</h2>
        <p>{t('People here get by on skill, gear and nerve. What your character can do is on the sheet.')}</p>
      </section>
    );
  }
  if (mode === 'gift') return <GiftTab session={session} />;

  const command = libraryOf(s, mode);
  const why = (ab: Ability): string | null => {
    const can = canUseAbility(s, ab.id, mode);
    if (can.ok) return null;
    return can.reason === 'focus' ? t('Needs {path} {tier} · you have {path} {have}', { path: t(PATH_INFO[ab.path].name), tier: ab.tier, have: s.paths[ab.path] ?? 0 })
      : can.reason === 'energy' ? t('Needs {cost} energy · you have {energy}', { cost: abilityCost(ab, mode), energy: s.energy })
        : can.reason === 'skill' ? t('Costs {cost}: more than five times your Skill of {skill}', { cost: abilityCost(ab, mode), skill: s.skill })
          : null;
  };

  // ----- The Extreme mode: whole schools, shown one path at a time -----
  if (mode === 'extreme') {
    const schools = schoolsOf(s);
    if (schools.length === 0) {
      return (
        <section className="empty">
          <Icon name="spark" size={40} />
          <h2>{t('No school of power')}</h2>
          <p>{t('In this world powers are schools: the White, the Black and the Elemental. Your character has none of them.')}</p>
        </section>
      );
    }
    const paths = schools.flatMap((id) => SCHOOLS[id].paths);
    const shown = path && paths.includes(path) ? path : paths[0]!;
    const list = command.filter((ab) => ab.path === shown);
    return (
      <section className="sec">
        <div className="sec-h"><h2>{t('Yours to command · {n}', { n: command.length })}</h2><span className="t-xs t-2">{schools.map((id) => t(SCHOOLS[id].name)).join(' · ')}</span></div>
        <p className="help">{t('A use costs 1, 3, 6 or 10 energy by its reach, and never more than five times your Skill ({max}). You can also shape effects of your own within a school: say what you do, and it is a Skill test at the same cost.', { max: s.skill * EXTREME_SKILL_FACTOR })}</p>
        {paths.length > 1 && (
          <div className="chips" role="group" aria-label={t('Path')}>
            {paths.map((k) => <button key={k} type="button" className="chip" aria-pressed={k === shown} onClick={() => setPath(k)}><span>{t(PATH_INFO[k].name)}</span></button>)}
          </div>
        )}
        <div className="grid grid-3">
          {list.map((ab) => <AbilityCard key={ab.id} ab={ab} cost={abilityCost(ab, mode)} why={why(ab)} />)}
        </div>
      </section>
    );
  }

  // ----- Paths: what is known, and what has been found and is waiting to be learned -----
  const found = (me.found ?? []).map((f) => ({ f, ab: abilityById(f.id) })).filter((x): x is { f: Found; ab: Ability } => !!x.ab);
  const learn = (id: string) => {
    const result = session.learn(id);
    if (result) setTried({ id, result });
  };
  return (
    <>
      {found.length > 0 && (
        <section className="sec">
          <div className="sec-h"><h2>{t('Found, not learned · {n}', { n: found.length })}</h2><span className="t-xs t-2">{t('{xp} experience to spend', { xp: me.xp })}</span></div>
          <div className="grid grid-3">
            {found.map(({ f, ab }) => {
              const blocked = canLearn(s, me.found ?? [], ab.id, me.xp, XP_TO_LEARN);
              const target = testTarget(s, { attribute: 'skill', skill: null, difficulty: learnDifficulty(f) }).target;
              const teacher = f.by ? story.world.people[f.by]?.name : null;
              const last = tried?.id === ab.id ? tried.result : null;
              return (
                <AbilityCard key={ab.id} ab={ab} cost={ab.cost}>
                  <p className="chr-abil-f"><Icon name={teacher ? 'person' : 'spark'} size={16} /><span>{teacher ? t('Shown to you by {name}.', { name: teacher }) : t('Worked out by trying it.')}</span></p>
                  {last && (
                    <p className="chr-learn-r" role="status"><Die face={last.die ?? 1} small /><span><T text="You rolled <b>{die}</b>, needing {target} or less. Not this time: the experience is spent, and you can try again." vars={{ die: last.die ?? '', target: last.target }} /></span></p>
                  )}
                  <div className="chr-learn">
                    <button type="button" className="btn btn-soft btn-fit" disabled={!!blocked || session.busy || !!session.combat} onClick={() => learn(ab.id)}>{t('Learn · {n} experience', { n: XP_TO_LEARN })}</button>
                    <span className="t-sm t-2">
                      {blocked === 'focus' ? t('Needs {path} {tier}; you have {path} {have}. Raise the path first.', { path: t(PATH_INFO[ab.path].name), tier: ab.tier, have: s.paths[ab.path] ?? 0 })
                        : blocked === 'xp' ? t('No experience to spend yet.')
                          : f.by ? t('A Skill test: {n} or less on a die.', { n: Math.min(5, target) }) : t('A Skill test: {n} or less on a die (harder, with nobody to show you).', { n: Math.min(5, target) })}
                    </span>
                  </div>
                </AbilityCard>
              );
            })}
          </div>
        </section>
      )}
      {tried?.result.passed && !found.some((x) => x.ab.id === tried.id) && (
        <div className="alert alert-ok" role="status"><Icon name="ok-circle" /><div><b>{t('{name} learned', { name: t(abilityById(tried.id)?.name ?? '') })}</b><p>{t('You rolled {die}, needing {target} or less. It is yours to use from now on.', { die: tried.result.die ?? '', target: tried.result.target })}</p></div></div>
      )}
      {command.length === 0 && found.length === 0 ? (
        <section className="empty">
          <Icon name="spark" size={40} />
          <h2>{t('No abilities yet')}</h2>
          <p>{t('Abilities are found in the story and then learned here. Ask someone who practises a path to teach you, or try something your paths could do: if it works, you have found it.')}</p>
        </section>
      ) : command.length > 0 && (
        <section className="sec">
          <div className="sec-h"><h2>{t('Known · {n}', { n: command.length })}</h2><span className="t-xs t-2">{t('Each use costs energy')}</span></div>
          <div className="grid grid-3">
            {command.map((ab) => <AbilityCard key={ab.id} ab={ab} cost={abilityCost(ab, mode)} why={why(ab)} />)}
          </div>
        </section>
      )}
      <p className="help chr-how">{t('More abilities are found in the story: someone who practises a path will teach what they know to a person they trust enough (the more it can do, the better they must know you), and anything your paths could do can be tried without having learned it, at a harder test and one more energy. What is found is learned here, for {xp} experience and a Skill test.', { xp: XP_TO_LEARN })}</p>
    </>
  );
}

function ItemRow({ item, action }: { item: Item; action?: ReactNode }) {
  return (
    <div className="row">
      <div className="grow">
        <div className="row-t"><b>{item.name}</b>{item.qty > 1 && <span className="t-2 num"> × {item.qty}</span>}</div>
        {item.text && <div className="row-s">{item.text}</div>}
      </div>
      {action && <div className="row-end">{action}</div>}
    </div>
  );
}

/**
 * What can be done with an item of power: eat it (its power becomes your own, for good), or set a
 * carried one's power aside and take it up again. With why, when it cannot be done now.
 */
function RelicAction({ session, item }: { session: Session; item: Item }) {
  const story = session.story;
  const relic = relicOf(story, item);
  const locked = session.busy || !!session.combat;
  if (!relic) return null;
  if (relic.use === 'eaten') {
    const stop = canEat(story, item.id);
    return (
      <span className="chr-relic">
        <button className="btn btn-fit" disabled={!!stop || locked} onClick={() => session.eatRelic(item.id)} aria-label={t('Eat {name}', { name: item.name })}>{t('Eat')}</button>
        {stop === 'has_power' && <span className="t-xs t-2">{t('You have a power of your own already: a second would not take.')}</span>}
      </span>
    );
  }
  const aside = (story.protagonist.sheet.arts ?? []).some((a) => a.source === 'item' && a.from === item.id && a.aside);
  const stop = canSetAside(story, item.id, !aside);
  return (
    <span className="chr-relic">
      <button className="btn btn-fit" disabled={!!stop || locked} onClick={() => session.setRelicAside(item.id, !aside)}>{aside ? t('Take up') : t('Set aside')}</button>
      {aside && stop === 'room' && <span className="t-xs t-2">{t('Four powers are in use: set one aside first.')}</span>}
    </span>
  );
}

function InventoryTab({ session, onUse }: { session: Session; onUse: (id: string) => void }) {
  const story = session.story;
  const me = story.protagonist;
  const purse = purseOf(story);
  const locked = session.busy || !!session.combat;
  const group = (g: (typeof ITEM_GROUPS)[number]) => {
    const items = me.items.filter((i) => i.kind === g.kind && i.qty > 0);
    if (items.length === 0) return null;
    return (
      <section key={g.kind} className="sec">
        <div className="sec-h">
          <h2 className="chr-inv-h"><Icon name={g.icon} size={16} />{t(g.label)}</h2>
          {items.length > 1 && <span className="t-xs t-2">{tn(items.length, '{n} thing', '{n} things')}</span>}
        </div>
        <div className="card card-flush">
          {g.kind === 'relic' && <p className="help chr-relic-h">{t('Things that hold a power. One you eat gives its power to you for good; one you carry lends you its power while you hold it.')}</p>}
          {items.map((item) => (
            <ItemRow
              key={item.id} item={item}
              action={item.kind === 'relic' ? <RelicAction session={session} item={item} />
                : item.kind === 'quest' ? <span className="tag tag-gold">{t('Quest item')}</span>
                : item.kind === 'consumable' && item.heal ? <button className="btn btn-fit" disabled={locked} onClick={() => onUse(item.id)} aria-label={t('Use {name}', { name: item.name })}>{t('Use')}</button>
                : undefined}
            />
          ))}
        </div>
      </section>
    );
  };
  return (
    <div className="grid grid-2 chr-inv">
      <div className="stack-l">
        {ITEM_GROUPS.slice(0, 3).map(group)}
        {me.items.length === 0 && <p className="t-2">{t('You are carrying nothing.')}</p>}
      </div>
      <div className="stack-l">
        {ITEM_GROUPS.slice(3).map(group)}
        <section className="sec">
          <div className="sec-h"><h2 className="chr-inv-h"><Icon name="coins" size={16} />{t('Purse')}</h2></div>
          <div className="card card-flush">
            {/* One line a money of the world: the first always, the others when you carry some. */}
            {hasMoney(story.world) ? moneyOf(story).map((c, i) => {
              const n = purse[c.id] ?? 0;
              if (i > 0 && n === 0) return null;
              return (
                <div key={c.id} className="row chr-plain purse-row">
                  <div className="grow"><div className="row-t"><b>{c.name}</b></div>{c.text && <div className="row-s">{c.text}</div>}</div>
                  <div className="row-end"><b className="chr-lv chr-purse">{n}</b></div>
                </div>
              );
            }) : (
              <div className="row chr-plain"><div className="grow"><div className="row-s">{t('There is no money in this world: people trade in goods, work and favours.')}</div></div></div>
            )}
          </div>
          {hasMoney(story.world) && <p className="help">{t('Prices are set by the rules from what a thing usually costs; a friend asks less, and haggling can bring it down. Say in the story what you buy, sell or give.')}</p>}
        </section>
        {locked && me.items.some((i) => i.kind === 'consumable' && i.heal) && (
          <p className="help">{session.combat ? t('In a fight, use items from the story screen.') : t('Wait for the turn to finish before using an item.')}</p>
        )}
      </div>
    </div>
  );
}

function UseDialog({ session, item, onClose }: { session: Session; item: Item; onClose: () => void }) {
  const s = session.story.protagonist.sheet;
  const max = maxHp(s);
  const heal = item.heal ?? 0;
  const after = Math.min(max, s.hp + heal);
  const gain = after - s.hp;
  const locked = session.busy || !!session.combat;
  const use = () => { session.useItem(item.id); onClose(); };
  return (
    <Modal
      title={t('Use {name}', { name: item.name })} onClose={onClose}
      foot={<><button className="btn" onClick={onClose}>{t('Not now')}</button><button className="btn btn-primary" disabled={locked || gain === 0} onClick={use}>{t('Use it')}</button></>}
    >
      <p className="t-2">
        {tn(heal, 'Restores {n} hit point, up to your maximum. You are at {hp} of {max}', 'Restores {n} hit points, up to your maximum. You are at {hp} of {max}', { hp: s.hp, max })}
        {gain === 0 ? t(', so it would do nothing now.') : gain < heal ? t(', so this one restores {gain}.', { gain }) : '.'}
      </p>
      <div className="chr-vital"><Meter kind="hp" label={t('Hit points afterwards')} value={after} max={max} /></div>
      {gain > 0 && <p className="chr-after"><Icon name="flask" size={16} />{item.qty - 1 === 0 ? t('None left afterwards') : t('{n} left afterwards', { n: item.qty - 1 })}</p>}
    </Modal>
  );
}

function RaiseRow({ name, text, value, limit, top = 5, xp, blocked, locked, onRaise }: {
  name: string; text: string; value: number; limit?: number; /** The highest level there is: 5, or 4 for the rank of a power. */ top?: number;
  xp: number; blocked: RaiseBlocked | null; locked: boolean; onRaise: () => void;
}) {
  const atTop = blocked === 'max' || blocked === 'cap';
  const why = blocked === 'max' ? (top === 5 ? t('At 5, the highest level.') : t('At {n}, the highest there is.', { n: top }))
    : blocked === 'cap' ? t('At {limit}, the limit in this story.', { limit: limit ?? 5 })
    : blocked === 'xp' ? t('Needs {cost} experience. You have {xp}.', { cost: XP_PER_LEVEL, xp })
    : text;
  return (
    <div className={`row chr-trait${atTop ? ' is-zero' : ''}`}>
      <div className="grow">
        <div className="row-t">{name} {atTop ? <span className="chr-chg"><b>{value}</b></span> : <span className="chr-chg">{value} → <b>{value + 1}</b></span>}</div>
        <div className="row-s">{why}</div>
      </div>
      <div className="row-end">
        <span className="only-desktop"><Pips value={value} limit={limit} /></span>
        <button className="btn btn-fit" disabled={!!blocked || locked} onClick={onRaise} aria-label={t('Raise {name} to {level} for {cost} experience', { name, level: value + 1, cost: XP_PER_LEVEL })}>
          {t('Raise')}<span className="chr-cost"><Icon name="spark" size={12} strong />{XP_PER_LEVEL}</span>
        </button>
      </div>
    </div>
  );
}

function SpendDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  const story = session.story;
  const me = story.protagonist;
  const s = me.sheet;
  const rules = story.world.rules;
  const [done, setDone] = useState<string | null>(null);
  const locked = session.combat ? t('Experience cannot be spent during a fight.') : session.busy ? t('Wait for the turn to finish.') : null;
  // The order is fixed when the dialog opens, so a row never moves under the finger after a raise.
  const [paths] = useState(() => pathsInOrder(s));
  const showPaths = rules.powers === 'focus' || rules.powers === 'extreme' || paths.some((k) => (s.paths[k] ?? 0) > 0);
  // The powers whose rank experience can raise: the one by nature, and disciplines learned.
  const raisable = powersOf(s).filter((x) => !x.art || x.art.source === 'taught');
  return (
    <Modal title={t('Spend experience')} onClose={onClose} foot={<button className="btn" onClick={onClose}>{t('Done')}</button>}>
      <p className="t-2">{rules.powers === 'gift'
        ? <T text="<hl>{xp}</hl> experience to spend. Raising an attribute, or the rank of your power, by one level costs {cost}." vars={{ xp: me.xp, cost: XP_PER_LEVEL, hl: (inner) => <b className="chr-xp">{inner}</b> }} />
        : <T text="<hl>{xp}</hl> experience to spend. Raising an attribute or a path by one level costs {cost}." vars={{ xp: me.xp, cost: XP_PER_LEVEL, hl: (inner) => <b className="chr-xp">{inner}</b> }} />}</p>
      {locked && <div className="alert alert-warn"><Icon name="info" /><div><b>{t('Not right now')}</b><p>{locked}</p></div></div>}
      {done && !locked && <div className="alert alert-ok" role="status"><Icon name="ok-circle" /><div><b>{done}</b><p>{t('{xp} experience left.', { xp: me.xp })}</p></div></div>}

      <section className="sec">
        <div className="sec-h"><h3>{t('Attributes')}</h3><span className="t-xs t-2">{t('Each from 0 to 5')}</span></div>
        <div className="card card-flush">
          {ATTRIBUTES.map((k) => (
            <RaiseRow
              key={k} name={t(ATTRIBUTE_INFO[k].name)} text={t(ATTRIBUTE_INFO[k].text)} value={s[k]} xp={me.xp} blocked={canRaiseAttribute(s, k, me.xp)} locked={!!locked}
              onRaise={() => { if (session.raiseAttribute(k)) setDone(t('{name} is now {n}', { name: t(ATTRIBUTE_INFO[k].name), n: s[k] + 1 })); }}
            />
          ))}
        </div>
      </section>

      {rules.powers === 'gift' && raisable.length > 0 && (
        <section className="sec">
          <div className="sec-h"><h3>{raisable.length > 1 ? t('Your powers') : t('Your power')}</h3><span className="t-xs t-2">{t('Rank from 1 to {max}', { max: GIFT_RANK_MAX })}</span></div>
          <div className="card card-flush">
            {raisable.map((x) => {
              const gift = x.gift;
              const stop = canRaiseGift(s, me.xp, x.id);
              return (
                <RaiseRow
                  key={x.id} name={gift.name} text={t('How far any use of it reaches. Each rank also has room for two more moves.')} value={gift.rank} limit={GIFT_RANK_MAX} top={GIFT_RANK_MAX} xp={me.xp}
                  blocked={stop === 'none' || stop === 'fixed' ? null : stop} locked={!!locked}
                  onRaise={() => { if (session.raiseGift(x.id)) setDone(t('{name} is now rank {n}', { name: gift.name, n: gift.rank + 1 })); }}
                />
              );
            })}
          </div>
          <p className="help">{t('The power of an item you carry, and one borrowed from someone, are what they are: they cannot be raised.')}</p>
        </section>
      )}

      {showPaths && (
        <section className="sec">
          <div className="sec-h"><h3>{t('Paths')}</h3><span className="t-xs t-2">{rules.pathCap < 5 ? t('No higher than {cap} in this story', { cap: rules.pathCap }) : t('Each from 0 to 5')}</span></div>
          <div className="card card-flush">
            {paths.map((k) => (
              <RaiseRow
                key={k} name={t(PATH_INFO[k].name)} text={t(PATH_INFO[k].text)} value={s.paths[k] ?? 0} limit={rules.pathCap} xp={me.xp}
                blocked={canRaisePath(s, k, me.xp, rules.pathCap)} locked={!!locked}
                onRaise={() => { if (session.raisePath(k)) setDone(t('{name} is now {n}', { name: t(PATH_INFO[k].name), n: (s.paths[k] ?? 0) + 1 })); }}
              />
            ))}
          </div>
        </section>
      )}
    </Modal>
  );
}

export function Character({ tab }: { tab: string }) {
  const a = useApp();
  const session = a.session;
  const [spend, setSpend] = useState(false);
  const [using, setUsing] = useState<string | null>(null);
  if (!session) return null;

  const me = session.story.protagonist;
  const s = me.sheet;
  const current: TabId = tab === 'abilities' || tab === 'inventory' ? tab : 'sheet';
  const item = using ? me.items.find((i) => i.id === using) : undefined;
  const gems = Math.min(me.destinyMax, 8);

  return (
    <StoryPage page="character" title={t('Character')}>
      <div className="chr">
        <header className="page-h">
          <div className="chr-id">
            <Avatar you={me.name} size="xl" />
            <div>
              <h1>{me.name}</h1>
              <p>{cap(me.line)}</p>
              {(me.appearance || me.look) && <p className="looks t-2">{me.appearance || me.look}</p>}
              <div className="inline chr-id-tags">
                {me.ancestry && <span className="tag">{t(me.ancestry)}</span>}
                {me.level && <span className="tag">{t(me.level)}</span>}
              </div>
            </div>
          </div>
        </header>

        {/* How they are right now: shown on every tab */}
        <section className="card chr-vit" aria-label={t('Condition')}>
          <div className="chr-vital"><Meter kind="hp" label={t('Hit points')} value={s.hp} max={maxHp(s)} /></div>
          <div className="chr-vital"><Meter kind="en" label={t('Energy')} value={s.energy} max={maxEnergy(s)} /></div>
          <div>
            <div className="chr-vit-k">{t('Destiny')}</div>
            <div className="chr-vit-v">
              <span className="gems" role="img" aria-label={t('{n} of {max} destiny points left', { n: me.destiny, max: me.destinyMax })}>
                {Array.from({ length: gems }, (_, i) => <Icon key={i} name="gem" size={16} fill={i < me.destiny} className={i < me.destiny ? '' : 'spent'} />)}
              </span>
              <span><T text="<b>{n}</b> of {max} left" vars={{ n: me.destiny, max: me.destinyMax }} /></span>
            </div>
          </div>
          <div>
            <div className="chr-vit-k">{t('Experience')}</div>
            <div className="chr-vit-v"><span><T text="<b>{xp}</b> to spend" vars={{ xp: me.xp }} /></span></div>
          </div>
          <button className="btn btn-soft btn-fit" onClick={() => setSpend(true)}>{t('Spend experience')}<Icon name="arrow" size={18} /></button>
        </section>

        <div className="tabs" role="tablist" aria-label={t('Character')}>
          {TABS.map((tb) => (
            <a key={tb.id} role="tab" aria-selected={current === tb.id} href={href(tb.id === 'sheet' ? 'character' : `character/${tb.id}`)}>{t(tb.label)}</a>
          ))}
        </div>

        {current === 'sheet' && <SheetTab session={session} />}
        {current === 'abilities' && <AbilitiesTab session={session} />}
        {current === 'inventory' && <InventoryTab session={session} onUse={setUsing} />}

        {spend && <SpendDialog session={session} onClose={() => setSpend(false)} />}
        {item && <UseDialog session={session} item={item} onClose={() => setUsing(null)} />}
      </div>
    </StoryPage>
  );
}
