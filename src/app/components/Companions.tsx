// How a companion looks and who they are, in the player's words: before a story begins, for those who
// start at the protagonist's side, and later on their profile. A picture can be put into words for the
// looks; the picture itself is never kept.
import { useState } from 'react';
import { APPEARANCE_MAX, CARD_MAX, LOOK_MAX } from '../../game/cards';
import { startingCompanions, type Described } from '../../game/creation';
import type { Person, WorldTemplate } from '../../game/types';
import { t, tn } from '../../i18n';
import { Avatar, Icon, who } from '../ui';
import { PictureButton } from './Picture';

/** What is said of someone now: the words a player starts from when describing them. */
export const describedOf = (p: Person): Described => ({ look: p.look ?? '', appearance: p.appearance ?? '', card: p.card });

/** The three parts of a description, with a picture for the looks. */
export function DescribeFields({ p, value, onChange, language, ledger }: { p: Person; value: Described; onChange: (d: Described) => void; language: 'en' | 'pt'; ledger?: string }) {
  const id = `ds-${p.id}`;
  return (
    <div className="stack describe">
      <div className="f">
        <label className="label" htmlFor={`${id}-look`}>{t('At a glance')}</label>
        <input className="input" id={`${id}-look`} type="text" maxLength={LOOK_MAX} autoComplete="off" value={value.look} onChange={(e) => onChange({ ...value, look: e.target.value })} placeholder={t('For example: grey fedora, gold watch')} />
        <p className="help">{t('A few words the narrator keeps to in every scene.')}</p>
      </div>
      <div className="f">
        <label className="label" htmlFor={`${id}-app`}>{t('How they look')}</label>
        <textarea className="input" id={`${id}-app`} rows={3} maxLength={APPEARANCE_MAX} value={value.appearance} onChange={(e) => onChange({ ...value, appearance: e.target.value })} />
        <div className="pic-row">
          <PictureButton who={`${p.name}, ${p.role}`} language={language} ledger={ledger}
            onWords={(look, appearance) => onChange({ ...value, look: look || value.look, appearance: appearance || value.appearance })} />
        </div>
        <p className="help">{t('A screenshot or any picture of how they should look is put into words here, once, and then forgotten: only the words are kept, and you can change them.')}</p>
      </div>
      <div className="f">
        <label className="label" htmlFor={`${id}-card`}>{t('Who they are')}</label>
        <textarea className="input" id={`${id}-card`} rows={3} maxLength={CARD_MAX} value={value.card} onChange={(e) => onChange({ ...value, card: e.target.value })} />
        <p className="help">{t('Their personality and how they talk: the narrator plays them from this.')}</p>
      </div>
    </div>
  );
}

/**
 * Before a story begins: the people who start it at the protagonist's side, one row each, opened to be
 * described. Nothing is required, and nothing is spent unless a picture is put into words.
 */
export function StartingCompanions({ template, value, onChange }: { template: WorldTemplate; value: Record<string, Described>; onChange: (next: Record<string, Described>) => void }) {
  const people = startingCompanions(template);
  const [open, setOpen] = useState<string | null>(null);
  if (!people.length) return null;
  const language = template.table.language === 'pt' ? 'pt' : 'en';
  return (
    <section className="sec">
      <div className="sec-h"><h2>{t('Who travels with you')}</h2><span className="t-xs t-2">{tn(people.length, '{n} companion', '{n} companions')}</span></div>
      <p className="help comp-intro">{t('They start the story at your side. If the world builder did not get them right, say how they look and who they are, in your own words or from a picture. This is optional.')}</p>
      <div className="card card-flush">
        {people.map((p) => {
          const d = value[p.id] ?? describedOf(p);
          const isOpen = open === p.id;
          return (
            <div key={p.id} className={`comp${isOpen ? ' is-open' : ''}`}>
              <button type="button" className={`row comp-h ${who(p)}`} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : p.id)}>
                <Avatar person={p} />
                <span className="grow"><span className="row-t">{p.name}</span><span className="row-s">{d.look.trim() || p.role}</span></span>
                <Icon name={isOpen ? 'up' : 'edit'} size={18} />
              </button>
              {isOpen && (
                <div className="comp-b">
                  <DescribeFields p={p} value={d} language={language} ledger={`world:${template.id}`} onChange={(next) => onChange({ ...value, [p.id]: next })} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
