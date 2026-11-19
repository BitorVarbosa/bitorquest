// Worlds: the library. One card per world; the same cards are the picker when a new story is started.
// A world is a template: every story plays in its own copy of it.
import { useRef, useState, type CSSProperties } from 'react';
import { BUILD_STEPS, type WorldDraft } from '../../game/builder';
import { docRead } from '../../game/ingest';
import type { World, WorldTemplate } from '../../game/types';
import { countsOf } from '../../game/world';
import { m, t, tn } from '../../i18n';
import { useApp } from '../app';
import { downloadWorld, fileSize } from '../files';
import { go, href } from '../router';
import { DemoBanner, LibraryPage } from '../Shell';
import { Icon, Modal, money } from '../ui';
import './worlds.css';

const POWERS = { off: m('Off ((powers))'), focus: m('Focus'), extreme: m('Extreme'), gift: m('Gift') } as const;
const STYLES = { story: m('Story'), adventure: m('Adventure'), brutal: m('Brutal') } as const;

function sizeOf(world: World): string {
  const c = countsOf(world);
  return `${tn(c.regions, '{n} region', '{n} regions')} · ${tn(c.places, '{n} place', '{n} places')} · ${tn(c.people, '{n} person', '{n} people')}`;
}

/** Where a draft stands, in a few words. */
function standing(d: WorldDraft, building: boolean): string {
  const done = BUILD_STEPS.filter((s) => d.steps[s.id]).length;
  // A document comes first: nothing is built until it has been read.
  if (d.document && !docRead(d.document)) {
    const read = d.document.total - d.document.parts.length;
    const stopped = d.state === 'failed' && d.failed?.step === 'reading' ? ` · ${d.failed.kind === 'budget' ? t('today’s limit was reached') : t('the reading stopped')}` : '';
    return building ? t('Reading the document · part {n} of {total}', { n: Math.min(read + 1, d.document.total), total: d.document.total }) : read === 0 ? `${t('Document chosen · not read yet')}${stopped}` : `${t('Document · {read} of {total} parts read', { read, total: d.document.total })}${stopped}`;
  }
  if (d.state === 'review') return t('Built · waiting for you to read it through');
  if (building) return t('Building · step {n} of 7', { n: Math.min(done + 1, 7) });
  if (d.state === 'failed' && d.failed && d.failed.step !== 'questions') return t('Stopped at step {n} of 7 · {why}', { n: done + 1, why: d.failed.kind === 'budget' ? t('today’s limit was reached') : t('a step did not go through') });
  if (done > 0) return t('Paused after step {n} of 7', { n: done });
  if (d.document) return t('Document read · world not built yet');
  return d.usage.length > 0 ? t('Not built yet') : t('Not built yet · nothing spent');
}

export function Worlds({ pick }: { pick: boolean }) {
  const a = useApp();
  const [manageId, setManageId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [dropDraft, setDropDraft] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const manage = manageId ? a.worlds.find((w) => w.id === manageId) ?? null : null;
  const setManage = (id: string | null) => { setManageId(id); setRenaming(null); setConfirm(false); };
  const total = a.worlds.reduce((sum, w) => sum + w.cost, 0);
  const count = a.worlds.length + 1; // the sample world is always there
  const sampleStories = a.storiesIn(a.sample.id);
  const drop = dropDraft ? a.drafts.find((d) => d.id === dropDraft) ?? null : null;

  const importIt = async (f: File | undefined) => {
    if (!f) return;
    const got = a.importWorld(await f.text());
    setNote('id' in got ? t('World imported. It is in your worlds.') : got.problem);
  };
  const exportIt = (w: WorldTemplate) => {
    setNote(downloadWorld(w.id, w.world.name) ? t('“{name}” was saved as a file.', { name: w.world.name }) : t('The world could not be put together for a file.'));
  };
  const startSample = () => { a.createStory(); go('play'); };
  const sourceOf = (w: WorldTemplate) => (w.source.kind === 'document' ? <>{t('A document')}{w.source.name && <span className="t-2"> · {w.source.name}</span>}</> : w.source.kind === 'setting' ? <>{t('A setting you named')} <span className="t-2">· {w.source.text.slice(0, 60)}</span></> : w.source.kind === 'sample' ? t('Comes with the app') : t('Your description'));
  const andMore = (n: number) => (n > 1 ? ` ${t('and {n} more', { n: n - 1 })}` : '');

  return (
    <LibraryPage page="worlds" title={t('Worlds')}>
      <header className="page-h">
        <div>
          {pick ? <h1>{t('Choose a world')}</h1> : <h1 className="only-desktop">{t('Worlds')}</h1>}
          <p>{pick ? t('Where does the new story take place?') : `${tn(count, '{n} world', '{n} worlds')}${total > 0 ? ` · ${t('built for {price} in total', { price: money(total, 2) })}` : ''}`}</p>
        </div>
        {pick
          ? <div className="inline"><a className="btn btn-quiet btn-fit" href={href('')}>{t('Cancel')}</a></div>
          : (
            <div className="inline wl-acts">
              <a className="btn btn-primary btn-fit" href={href('world-new')}><Icon name="plus" size={18} />{t('New world')}</a>
              <button className="btn btn-quiet btn-fit" onClick={() => file.current?.click()}><Icon name="upload" size={18} />{t('Import')}</button>
            </div>
          )}
      </header>
      <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => { void importIt(e.target.files?.[0]); e.target.value = ''; }} />
      {!pick && <DemoBanner />}
      {note && <p className="t-2" role="status">{note}</p>}

      {/* Worlds still being built. One row each, so a dozen unfinished ones stay a short list. */}
      {a.drafts.length > 0 && (
        <section className="sec">
          <div className="sec-h"><h2>{t('Being built · {n}', { n: a.drafts.length })}</h2></div>
          <div className="card card-flush">
            {a.drafts.map((d) => {
              const spent = d.usage.reduce((sum, u) => sum + u.cost, 0);
              const building = a.isBuilding(d.id);
              return (
                <div key={d.id} className="row wl-draft">
                  <a className="wl-draft-main grow" href={href(`world-new/${d.id}`)}>
                    <span className={`wl-draft-mark${building ? ' is-busy' : ''}`} aria-hidden="true"><Icon name={d.state === 'review' ? 'check' : 'globe'} size={18} /></span>
                    <span className="grow">
                      <span className="row-t cut">{d.steps.skeleton?.name ?? (d.document ? t('From “{name}”', { name: d.document.name }) : d.input.source.text.trim().split('\n')[0]?.slice(0, 60) || t('A new world'))}</span>
                      <span className="row-s">{standing(d, building)}{spent > 0 ? ` · ${d.usage.every((u) => u.simulated) ? t('{price} estimated', { price: money(spent, 2) }) : t('{price} spent', { price: money(spent, 2) })}` : ''}</span>
                    </span>
                    <Icon name="right" size={18} className="t-2" />
                  </a>
                  <button className="ib" onClick={() => setDropDraft(d.id)} aria-label={t('Delete this unfinished world')}><Icon name="trash" size={18} /></button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="grid grid-2">
        {a.worlds.map((w) => {
          const stories = a.storiesIn(w.id);
          return (
            <article key={w.id} className="card wl-card" style={{ '--a': w.world.accent } as CSSProperties}>
              <div className="wl-card-h">
                <span className="wl-mark" aria-hidden="true"><Icon name="globe" size={22} /></span>
                <h2 className="grow">{w.world.name}</h2>
                {!pick && <button className="ib" onClick={() => setManage(w.id)} aria-label={t('More options for {name}', { name: w.world.name })}><Icon name="more" /></button>}
              </div>
              <p className="wl-pitch">{w.world.pitch}</p>
              <dl className="kv">
                {!pick && <div><dt>{t('Source')}</dt><dd>{sourceOf(w)}</dd></div>}
                <div><dt>{t('Powers')}</dt><dd>{t(POWERS[w.world.rules.powers])}</dd></div>
                <div><dt>{t('Usual style')}</dt><dd>{t(STYLES[w.world.rules.style])}</dd></div>
                {!pick && <div><dt>{t('Size')}</dt><dd>{sizeOf(w.world)}</dd></div>}
                <div><dt>{t('Stories')}</dt>{stories.length === 0 ? <dd className="t-2">{t('None yet')}</dd> : <dd>{stories.length} <span className="t-2">· {stories[0]!.title}{andMore(stories.length)}</span></dd>}</div>
                {!pick && <div><dt>{t('Built for')}</dt><dd className="num">{money(w.cost, 2)}{w.simulated && <span className="t-2"> · {t('by the demo builder, nothing charged')}</span>}</dd></div>}
              </dl>
              {pick
                ? <a className="btn btn-soft" href={href(`character-new/${w.id}`)}>{t('Start here')}<Icon name="arrow" size={18} /></a>
                : <a className="btn" href={href(`character-new/${w.id}`)}>{t('Start a story here')}</a>}
            </article>
          );
        })}

        {/* The hand-made world that comes with the app, and its one ready-made story. */}
        <article className="card wl-card" style={{ '--a': a.sample.world.accent } as CSSProperties}>
          <div className="wl-card-h">
            <span className="wl-mark" aria-hidden="true"><Icon name="globe" size={22} /></span>
            <h2 className="grow">{a.sample.world.name}</h2>
            <span className="tag">{t('Sample')}</span>
          </div>
          <p className="wl-pitch">{a.sample.world.pitch}</p>
          <dl className="kv">
            {!pick && <div><dt>{t('Source')}</dt><dd>{t('Comes with the app')}</dd></div>}
            <div><dt>{t('Powers')}</dt><dd>{t(POWERS[a.sample.world.rules.powers])}</dd></div>
            <div><dt>{t('Usual style')}</dt><dd>{t(STYLES[a.sample.world.rules.style])}</dd></div>
            {!pick && <div><dt>{t('Size')}</dt><dd>{sizeOf(a.sample.world)}</dd></div>}
            <div><dt>{t('Stories')}</dt>{sampleStories.length === 0 ? <dd className="t-2">{t('None yet')}</dd> : <dd>{sampleStories.length} <span className="t-2">· {sampleStories[0]!.title}{andMore(sampleStories.length)}</span></dd>}</div>
          </dl>
          <p className="t-sm t-2">{t('Two ways in. “{story}” is ready-made: you play Aren, a courier, from the twelfth day of his journey, among people who already know him. Or arrive as a stranger with a character of your own, on the first day.', { story: a.sample.story })}</p>
          <div className="stack-s wl-two">
            <button className={`btn${pick ? ' btn-soft' : ''}`} onClick={startSample}>{t('Start {story}', { story: a.sample.story })}{pick && <Icon name="arrow" size={18} />}</button>
            <a className="btn" href={href(`character-new/${a.sample.id}`)}>{t('Make your own character')}</a>
          </div>
        </article>

        <a className="card wl-new" href={href('world-new')}>
          <Icon name="plus" size={24} />
          {a.worlds.length === 0 ? t('Create your first world') : t('Create a new world')}
          <span>{t('Describe one in a few lines, or name a setting you already know')}</span>
        </a>
      </div>

      {!pick && <p className="wl-note"><Icon name="info" size={16} /><span>{t('A world is a template you can reuse. Each story plays in its own copy, so nothing that happens in a story changes the world it started from.')}</span></p>}

      {manage && (
        <Modal title={manage.world.name} onClose={() => setManage(null)}>
          <div className="card card-flush">
            {renaming === null ? (
              <button className="row" onClick={() => setRenaming(manage.world.name)}>
                <Icon name="edit" className="t-2" />
                <span className="grow"><span className="row-t">{t('Rename')}</span></span>
              </button>
            ) : (
              <form className="row rename" onSubmit={(e) => { e.preventDefault(); a.renameWorld(manage.id, renaming); setRenaming(null); }}>
                <Icon name="edit" className="t-2" />
                <input className="input grow" value={renaming} maxLength={48} autoFocus aria-label={t('The world’s name')} onChange={(e) => setRenaming(e.target.value)} />
                <button className="btn btn-primary btn-fit" type="submit" disabled={!renaming.trim()}>{t('Save')}</button>
                <button className="btn btn-fit" type="button" onClick={() => setRenaming(null)}>{t('Cancel')}</button>
              </form>
            )}
            <button className="row" onClick={() => exportIt(manage)}>
              <Icon name="download" className="t-2" />
              <span className="grow"><span className="row-t">{t('Export to a file')}</span><span className="row-s">{t('To back it up, move it or share it · {size}. Nothing about you is in the file.', { size: fileSize(new Blob([a.exportWorld(manage.id) ?? '']).size) })}</span></span>
            </button>
          </div>
          {!confirm
            ? <button className="btn btn-danger" style={{ flex: 'none' }} onClick={() => setConfirm(true)}><Icon name="trash" size={18} />{t('Delete this world')}</button>
            : (
              <div className="alert alert-err">
                <Icon name="warn" />
                <div className="stack-s grow">
                  <div><b>{t('Delete “{name}”?', { name: manage.world.name })}</b><p>{t('This cannot be undone. Export it first if you may want it back.')}</p></div>
                  <div className="inline">
                    <button className="btn btn-danger btn-fit" onClick={() => { a.removeWorld(manage.id); setManage(null); }}>{t('Delete')}</button>
                    <button className="btn btn-fit" onClick={() => setConfirm(false)}>{t('Keep it')}</button>
                  </div>
                </div>
              </div>
            )}
          <p className="t-sm t-2">{t('Deleting a world does not delete its stories. Each story keeps its own copy of the world and can still be played.')}</p>
        </Modal>
      )}

      {drop && (
        <Modal title={t('Delete this unfinished world?')} onClose={() => setDropDraft(null)}>
          <p>{drop.usage.length > 0
            ? (drop.usage.every((u) => u.simulated)
              ? t('What has been built so far is thrown away. The {price} it would have cost is not given back.', { price: money(drop.usage.reduce((sum, u) => sum + u.cost, 0), 2) })
              : t('What has been built so far is thrown away. The {price} already spent on it is not given back.', { price: money(drop.usage.reduce((sum, u) => sum + u.cost, 0), 2) }))
            : t('Nothing has been built or spent yet. What you typed is thrown away.')}</p>
          <div className="inline">
            <button className="btn btn-danger btn-fit" onClick={() => { a.removeDraft(drop.id); setDropDraft(null); }}>{t('Delete')}</button>
            <button className="btn btn-fit" onClick={() => setDropDraft(null)}>{t('Keep it')}</button>
          </div>
        </Modal>
      )}
    </LibraryPage>
  );
}
