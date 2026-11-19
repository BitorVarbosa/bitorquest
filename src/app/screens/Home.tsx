// Home: the story to continue, then every other story.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Person, Story } from '../../game/types';
import { listOf, t, tn } from '../../i18n';
import { useApp, whereOf } from '../app';
import type { StoryRow } from '../db';
import { downloadBook, downloadStory, fileSize } from '../files';
import { go } from '../router';
import { DemoBanner, LibraryPage } from '../Shell';
import { T } from '../T';
import { Avatar, Icon, Modal, money } from '../ui';
import './home.css';

function ago(when: number): string {
  const d = Math.floor((Date.now() - when) / 86_400_000);
  if (d <= 0) return t('today');
  if (d === 1) return t('yesterday');
  if (d < 14) return t('{n} days ago', { n: d });
  return t('{n} weeks ago', { n: Math.round(d / 7) });
}

/** "<b>3</b> turns", with the count in bold. */
const turnsOf = (n: number) => (n === 1 ? <T text="<b>{n}</b> turn" vars={{ n }} /> : <T text="<b>{n}</b> turns" vars={{ n }} />);

/** The last thing the narrator wrote, as a reminder of where the story stands. */
function lastLine(story: Story): string {
  for (let s = story.scenes.length - 1; s >= 0; s--) {
    const turns = story.scenes[s]!.turns;
    for (let ti = turns.length - 1; ti >= 0; ti--) {
      const beats = turns[ti]!.beats.filter((b) => b.type === 'narration');
      const last = beats[beats.length - 1];
      if (last && last.type === 'narration') return last.text.length > 220 ? `${last.text.slice(0, 217).replace(/\s+\S*$/, '')}…` : last.text;
    }
  }
  return '';
}

function party(story: Story): Person[] {
  return Object.values(story.world.people).filter((p) => p.inParty);
}

export function Home() {
  const a = useApp();
  const [manageId, setManageId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [bytes, setBytes] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const [first, ...rest] = a.stories;
  const total = a.stories.reduce((sum, s) => sum + s.cost, 0);
  // The story being managed, looked up each time so that a new name shows at once.
  const manage = manageId ? a.stories.find((s) => s.id === manageId) ?? null : null;
  const setManage = (row: StoryRow | null) => { setManageId(row?.id ?? null); setConfirm(false); setRenaming(null); setBytes(null); };

  // How much the story takes up is worked out when its options are opened.
  useEffect(() => {
    if (!manageId) return;
    let wanted = true;
    void a.storyBytes(manageId).then((n) => { if (wanted) setBytes(n); });
    return () => { wanted = false; };
  }, [a, manageId]);

  const open = (id: string, to = 'play') => {
    if (a.openStory(id)) go(to);
    else setNote(a.openProblem ?? t('That story could not be opened.'));
  };
  // A new story starts by choosing where it takes place.
  const start = () => go('worlds?pick=1');
  const startSample = () => { a.createStory(); go('play'); };
  const exportIt = async (row: StoryRow) => {
    const done = await downloadStory(row.id, row.title);
    setNote(done ? t('“{title}” was saved as a file.', { title: row.title }) : t('The story could not be put together for a file.'));
  };
  const importIt = async (f: File | undefined) => {
    if (!f) return;
    const got = await a.importStory(await f.text());
    setNote('id' in got ? t('Story imported. It is in your stories.') : got.problem);
  };
  const duplicate = async (row: StoryRow) => {
    const id = await a.duplicateStory(row.id);
    setManage(null);
    setNote(id ? t('A copy of “{title}” is in your stories.', { title: row.title }) : t('The story could not be copied.'));
  };
  const rename = (row: StoryRow) => {
    if (renaming !== null) a.renameStory(row.id, renaming);
    setRenaming(null);
  };

  return (
    <LibraryPage page="stories" title={t('Stories')}>
      <header className="page-h">
        <div>
          <h1>{t('Your stories')}</h1>
          <p>{a.stories.length === 0 ? t('Nothing here yet') : (a.usingDemo
            ? t('{stories} · {cost} estimated in total', { stories: tn(a.stories.length, '{n} story', '{n} stories'), cost: money(total, 2) })
            : t('{stories} · {cost} spent in total', { stories: tn(a.stories.length, '{n} story', '{n} stories'), cost: money(total, 2) }))}</p>
        </div>
        {a.stories.length > 0 && (
          <div className="inline">
            <button className="btn btn-quiet btn-fit" onClick={() => file.current?.click()}><Icon name="upload" size={18} />{t('Import')}</button>
            <button className="btn btn-primary btn-fit" onClick={start}><Icon name="plus" size={18} />{t('New story')}</button>
          </div>
        )}
      </header>
      <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => { void importIt(e.target.files?.[0]); e.target.value = ''; }} />
      <DemoBanner />
      {(note || a.openProblem) && <p className="t-2" role="status">{note || a.openProblem}</p>}

      {first && (
        <section className="sec">
          <div className="sec-h"><h2>{t('Continue')}</h2></div>
          <article className="card hero" style={{ '--a': first.accent } as CSSProperties}>
            <div className="hero-main stack">
              <div>
                <div className="hero-k"><span className="swatch" aria-hidden="true" /><span className="t-caps">{first.world}</span></div>
                <h2>{first.title}</h2>
                <p className="t-2">{whereOf(first.data)}</p>
              </div>
              {lastLine(first.data) && <p className="t-story last">{lastLine(first.data)}</p>}
              <div className="facts-row">
                <span>
                  <span className="av-stack" style={{ '--under': 'var(--c-card)' } as CSSProperties}>{party(first.data).slice(0, 3).map((p) => <Avatar key={p.id} person={p} size="s" />)}</span>
                  {first.data.protagonist.name}{party(first.data).length ? t(', with {party}', { party: listOf(party(first.data).map((p) => p.name)) }) : ''}
                </span>
                <span><Icon name="clock" size={14} /><T text="Played <b>{when}</b>" vars={{ when: ago(first.lastPlayed) }} /></span>
                <span>{turnsOf(first.turns)}</span>
                <span><T text="<b>{cost}</b> so far" vars={{ cost: money(first.cost, 2) }} /></span>
              </div>
            </div>
            <div className="hero-go">
              <button className="btn btn-primary btn-lg" onClick={() => open(first.id)}><Icon name="play" size={16} fill />{t('Continue')}</button>
              <button className="btn" onClick={() => open(first.id, 'recap')}>{t('Previously…')}</button>
              <button className="btn btn-quiet" onClick={() => setManage(first)} aria-label={t('More options for {title}', { title: first.title })}><Icon name="more" />{t('More')}</button>
            </div>
          </article>
        </section>
      )}

      {a.stories.length > 0 && (
        <section className="sec">
          <div className="sec-h"><h2>{t('All stories')}</h2><span className="t-xs t-2">{t('Sorted by last played')}</span></div>
          <div className="grid grid-3">
            {rest.map((s) => (
              <article key={s.id} className="card tale" style={{ '--a': s.accent } as CSSProperties}>
                <div className="tale-h">
                  <div className="grow">
                    <div className="hero-k"><span className="swatch" aria-hidden="true" /><span className="t-caps">{s.world}</span></div>
                    <h3>{s.title}</h3>
                  </div>
                  <button className="ib" onClick={() => setManage(s)} aria-label={t('More options for {title}', { title: s.title })}><Icon name="more" /></button>
                </div>
                <p className="t-sm t-2">{whereOf(s.data)}</p>
                <div className="facts-row"><span>{ago(s.lastPlayed)}</span><span>{turnsOf(s.turns)}</span><span><b>{money(s.cost, 2)}</b></span></div>
                <button className="btn" onClick={() => open(s.id)}>{t('Continue')}</button>
              </article>
            ))}
            <button className="card new" onClick={start}>
              <Icon name="plus" size={24} />
              {t('Start a new story')}
              <span className="t-sm t-2" style={{ fontWeight: 400 }}>{t('In a world of your own, or the sample world')}</span>
            </button>
          </div>
        </section>
      )}

      {a.stories.length === 0 && (
        <section className="empty">
          <Icon name="story" size={40} />
          <h2>{t('No stories yet')}</h2>
          <p>{t('Build a world of your own and a character to play in it, or try the sample story first: “The Glass Road”, in which you play Aren, a courier with a sealed letter people are willing to kill for.')}</p>
          <button className="btn btn-primary btn-lg btn-fit" onClick={start}><Icon name="plus" size={18} />{t('Start a new story')}</button>
          <button className="btn btn-fit" onClick={startSample}><Icon name="play" size={14} fill />{t('Play the sample story')}</button>
          <button className="btn btn-quiet btn-fit" onClick={() => file.current?.click()}><Icon name="upload" size={18} />{t('Import a story file')}</button>
        </section>
      )}

      {manage && (
        <Modal title={manage.title} onClose={() => setManage(null)}>
          <div className="card card-flush">
            {renaming === null ? (
              <button className="row" onClick={() => setRenaming(manage.title)}>
                <Icon name="edit" className="t-2" />
                <span className="grow"><span className="row-t">{t('Rename')}</span></span>
              </button>
            ) : (
              <form className="row rename" onSubmit={(e) => { e.preventDefault(); rename(manage); }}>
                <Icon name="edit" className="t-2" />
                <input className="input grow" value={renaming} maxLength={80} autoFocus aria-label={t('The story\'s name')} onChange={(e) => setRenaming(e.target.value)} />
                <button className="btn btn-primary btn-fit" type="submit" disabled={!renaming.trim()}>{t('Save')}</button>
                <button className="btn btn-fit" type="button" onClick={() => setRenaming(null)}>{t('Cancel')}</button>
              </form>
            )}
            <button className="row" onClick={() => void duplicate(manage)}>
              <Icon name="copy" className="t-2" />
              <span className="grow"><span className="row-t">{t('Duplicate')}</span><span className="row-s">{t('Play another way from this point. The copy is a story of its own.')}</span></span>
            </button>
            {manage.data.settings.style === 'brutal' ? (
              <div className="row is-off">
                <Icon name="rewind" className="t-2" />
                <span className="grow"><span className="row-t">{t('Rewind to an earlier scene')}</span><span className="row-s">{t('Not in this story: it is played in the Brutal style, where what happened stays.')}</span></span>
              </div>
            ) : (
              <button className="row" onClick={() => open(manage.id, 'journal/story')}>
                <Icon name="rewind" className="t-2" />
                <span className="grow"><span className="row-t">{t('Rewind to an earlier scene')}</span><span className="row-s">{tn(manage.turns, '{n} turn played. Choose the scene in the journal; the turns after it are kept as a copy.', '{n} turns played. Choose the scene in the journal; the turns after it are kept as a copy.')}</span></span>
                <Icon name="right" size={18} className="t-2" />
              </button>
            )}
            <button className="row" onClick={() => void downloadBook(manage.id, manage.title)}>
              <Icon name="journal" className="t-2" />
              <span className="grow"><span className="row-t">{t('Read it as a book')}</span><span className="row-s">{t('The whole story as one page to read or print, saved as a file.')}</span></span>
            </button>
            <button className="row" onClick={() => void exportIt(manage)}>
              <Icon name="download" className="t-2" />
              <span className="grow"><span className="row-t">{t('Export to a file')}</span><span className="row-s">{t('To back it up or move it to another device{size}. Your API key is never in the file.', { size: bytes !== null ? ` · ${fileSize(bytes)}` : '' })}</span></span>
            </button>
          </div>
          {!confirm
            ? <button className="btn btn-danger" style={{ flex: 'none' }} onClick={() => setConfirm(true)}><Icon name="trash" size={18} />{t('Delete this story')}</button>
            : (
              <div className="alert alert-err">
                <Icon name="warn" />
                <div className="stack-s grow">
                  <div><b>{t('Delete “{title}”?', { title: manage.title })}</b><p>{t('This cannot be undone. Export it first if you may want it back.')}</p></div>
                  <div className="inline">
                    <button className="btn btn-danger btn-fit" onClick={() => { void a.removeStory(manage.id); setManage(null); }}>{t('Delete')}</button>
                    <button className="btn btn-fit" onClick={() => setConfirm(false)}>{t('Keep it')}</button>
                  </div>
                </div>
              </div>
            )}
        </Modal>
      )}
    </LibraryPage>
  );
}
