// A power of one's own, in a world of gifts: the pieces that character creation and the character
// sheet share. What the player wrote (the power's name and text, a move's name and line) is shown as
// written and never looked up in a dictionary; only the rules' own words are translated.
import type { ReactNode } from 'react';
import { GIFT_KINDS, GIFT_KINDS_MAX, GIFT_TEXT, fightEffect, type CombatEffect, type Gift, type GiftKind, type GiftMove } from '../../engine';
import { m, t, tn } from '../../i18n';
import { Icon } from '../ui';

/** The kinds of thing a power can do in a fight, as the player reads them. */
export const KIND_INFO: Record<GiftKind, { name: string; text: string }> = {
  damage: { name: m('Damage'), text: m('Hurts someone, with no defence roll.') },
  guard: { name: m('Guard'), text: m('Adds to your defence until your next turn.') },
  stagger: { name: m('Stagger'), text: m('Someone loses their next action. It takes tier 2.') },
  dazzle: { name: m('Dazzle'), text: m('Takes away from someone’s next attack.') },
  heal: { name: m('Heal'), text: m('Gives you hit points back.') },
  copy: { name: m('Copy'), text: m('Takes on the power of someone near you, until the scene ends. A test each time.') },
  steal: { name: m('Steal'), text: m('Takes someone’s power from them, and you hold it until the scene ends. A test each time.') },
};

/** What an effect does in a fight, in words, with the number the rules give it. */
export function fightLine(c: CombatEffect): string {
  switch (c.type) {
    case 'guard': return t('+{value} to your defence until your next turn', { value: c.value });
    case 'stagger': return t('the target loses its next action');
    case 'dazzle': return t('the target’s next attack is at −{value}', { value: c.value });
    case 'damage': return t('{value} damage that ignores defence', { value: c.value });
    case 'heal': return t('{value} hit points restored', { value: c.value });
    case 'seal': return tn(c.turns, 'the target cannot use a power on their next turn', 'the target cannot use a power for {n} turns');
  }
}

/**
 * The power itself, to read: its name and rank, where it came from (`source`, already in words; none
 * for a power by nature), what it is, its limit, and what it can do in a fight. `brief` holds what it
 * is to two lines, for a page with several powers.
 */
export function GiftCard({ gift, source, brief, children }: { gift: Gift; source?: string; brief?: boolean; children?: ReactNode }) {
  return (
    <article className="card gf-card">
      <div className="gf-h">
        <h3 className="card-n">{gift.name}</h3>
        <span className="tag">{t('Rank ((power))')} <b>{gift.rank}</b></span>
      </div>
      {source && <p className="gf-src">{source}</p>}
      <p className={`gf-d${brief ? ' gf-brief' : ''}`}>{gift.text}</p>
      {gift.limit && <p className="gf-f"><Icon name="warn" size={16} /><span>{t('Limit: {limit}', { limit: gift.limit })}</span></p>}
      <p className="gf-f"><Icon name="sword" size={16} /><span>{gift.kinds.length ? t('In a fight it can: {kinds}', { kinds: gift.kinds.map((k) => t(KIND_INFO[k].name).toLowerCase()).join(', ') }) : t('It does nothing in a fight by itself.')}</span></p>
      {children}
    </article>
  );
}

/** One move, to read: its name, tier and cost, the player's line, and what it does in a fight. */
export function MoveCard({ move, why, children }: { move: GiftMove; why?: string | null; children?: ReactNode }) {
  const effect = move.fight ? fightEffect(move.fight, move.tier) : undefined;
  return (
    <article className="card gf-card">
      <div className="gf-h">
        <h3 className="card-n">{move.name}</h3>
        <span className="tag">{t('Tier')} <b>{move.tier}</b></span>
        <span className="gf-c"><Icon name="bolt" size={14} fill />{t('{cost} energy', { cost: move.tier })}</span>
      </div>
      {move.text && <p className="gf-d">{move.text}</p>}
      {effect && <p className="gf-f"><Icon name="sword" size={16} /><span>{t('In a fight: {fight}', { fight: fightLine(effect) })}</span></p>}
      {why && <p className="gf-f"><Icon name="lock" size={16} /><span>{why}</span></p>}
      {children}
    </article>
  );
}

/** The kinds a power has, to choose: two at most. */
export function KindChips({ kinds, onToggle }: { kinds: GiftKind[]; onToggle: (kind: GiftKind) => void }) {
  const full = kinds.length >= GIFT_KINDS_MAX;
  return (
    <div className="f">
      <span className="label" id="gf-kinds">{t('What it can do in a fight')} <span className="t-2 gf-opt">{t('· up to {n}', { n: GIFT_KINDS_MAX })}</span></span>
      <div className="chips gf-chips" role="group" aria-labelledby="gf-kinds">
        {GIFT_KINDS.map((k) => {
          const on = kinds.includes(k);
          return <button key={k} type="button" className="chip" aria-pressed={on} disabled={!on && full} title={t(KIND_INFO[k].text)} onClick={() => onToggle(k)}><span>{t(KIND_INFO[k].name)}</span></button>;
        })}
      </div>
      {kinds.length > 0
        ? <ul className="gf-kinds">{kinds.map((k) => <li key={k}><b>{t(KIND_INFO[k].name)}</b> {t(KIND_INFO[k].text)}</li>)}</ul>
        : <p className="help">{t('Leave them all off for a power that is no use in a fight. A blow or a hide that is always there belongs in your attributes.')}</p>}
    </div>
  );
}

/** What a power is, in the player's words: its name, what it covers, its limit, and its kinds. `prefix` keeps the ids apart when two forms are on a page. */
export function GiftFields({ gift, prefix, onChange, onToggleKind }: {
  gift: Pick<Gift, 'name' | 'text' | 'limit' | 'kinds'>; prefix: string;
  onChange: (patch: Partial<Pick<Gift, 'name' | 'text' | 'limit'>>) => void; onToggleKind: (kind: GiftKind) => void;
}) {
  return (
    <>
      <div className="f">
        <label className="label" htmlFor={`${prefix}-name`}>{t('What it is called')}</label>
        <input className={`input${gift.name.trim() ? '' : ' is-bad'}`} id={`${prefix}-name`} type="text" value={gift.name} maxLength={GIFT_TEXT.name} autoComplete="off" onChange={(e) => onChange({ name: e.target.value })} />
      </div>
      <div className="f">
        <label className="label" htmlFor={`${prefix}-text`}>{t('What it is')}</label>
        <textarea className={`input gf-auto${gift.text.trim() ? '' : ' is-bad'}`} id={`${prefix}-text`} rows={3} value={gift.text} maxLength={GIFT_TEXT.text} onChange={(e) => onChange({ text: e.target.value })} />
        <p className="help">{t('What the power is and what it covers, in a sentence or two. What it does all the time is simply true in the story.')}</p>
      </div>
      <div className="f">
        <label className="label" htmlFor={`${prefix}-limit`}>{t('Its limit')} <span className="t-2 gf-opt">{t('· optional')}</span></label>
        <textarea className="input gf-auto" id={`${prefix}-limit`} rows={2} value={gift.limit} maxLength={GIFT_TEXT.limit} onChange={(e) => onChange({ limit: e.target.value })} />
        <p className="help">{t('A weakness, or what it costs you. The narrator makes it matter.')}</p>
      </div>
      <KindChips kinds={gift.kinds} onToggle={onToggleKind} />
    </>
  );
}

/** A power with one kind switched on or off. Two at most; a kind switched off is taken from the moves that used it. */
export function toggleKind<G extends Pick<Gift, 'kinds'> & { moves?: GiftMove[] }>(gift: G, kind: GiftKind): void {
  if (gift.kinds.includes(kind)) {
    gift.kinds = gift.kinds.filter((k) => k !== kind);
    for (const mv of gift.moves ?? []) if (mv.fight === kind) delete mv.fight;
  } else if (gift.kinds.length < GIFT_KINDS_MAX) {
    gift.kinds = [...gift.kinds, kind];
  }
}
