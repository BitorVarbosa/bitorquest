// Settings: for the whole app (the key, models, spending, look, prices, data) and for the story that is open.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { estimateExpand } from '../../game/llm/architect';
import { CACHE_WRITE_1H, CACHE_WRITE_5M, MODELS, PRICES_AS_OF, SERVICE_NAME, modelInfo, roleModels, serviceOf } from '../../game/llm/models';
import { NARRATION_WORDS, PROSE } from '../../game/llm/prompts';
import { GIFT_RANK_MAX } from '../../engine';
import type { StorySettings, World } from '../../game/types';
import { useApp, type AppSettings } from '../app';
import { EndingChoice } from '../components/Ending';
import { downloadStory, fileSize } from '../files';
import { listOf, locale, m, t, tn } from '../../i18n';
import type { IconName } from '../icons';
import { href } from '../router';
import { LibraryPage } from '../Shell';
import { Icon, Modal, money } from '../ui';
import { LookSettings } from './LookSettings';
import { ModelsSection, ServiceKeys } from '../components/Services';
import './settings.css';

type Tab = 'app' | 'story';
interface SectionInfo { id: string; label: string; icon: IconName }

const APP_SECTIONS: SectionInfo[] = [
  { id: 'key', label: m('Services and keys'), icon: 'key' },
  { id: 'models', label: m('Models'), icon: 'spark' },
  { id: 'narration', label: m('Narration'), icon: 'story' },
  { id: 'spending', label: m('Spending'), icon: 'coins' },
  { id: 'look', label: m('Look'), icon: 'sun' },
  { id: 'prices', label: m('Prices'), icon: 'doc' },
  { id: 'data', label: m('Your data'), icon: 'download' },
  { id: 'about', label: m('About'), icon: 'info' },
];
const STORY_SECTIONS: SectionInfo[] = [
  { id: 'table', label: m('Table style'), icon: 'dice' },
  { id: 'telling', label: m('Storytelling'), icon: 'story' },
  { id: 'tone', label: m('Tone and content'), icon: 'heart' },
  { id: 'world', label: m('Set by the world'), icon: 'lock' },
];

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const longDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' });
const price = (n: number) => `$${n.toFixed(2)}`;

// ---------- Small controls ----------

export function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T | null; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>{o.label}</button>)}
    </div>
  );
}

export function Switch({ on, labelledBy, disabled = false, onChange }: { on: boolean; labelledBy: string; disabled?: boolean; onChange: (on: boolean) => void }) {
  return <button className="switch" type="button" role="switch" aria-checked={on} aria-labelledby={labelledBy} disabled={disabled} onClick={() => onChange(!on)} />;
}

/** A value that is shown and cannot be changed here. */
export function Fixed({ children }: { children: ReactNode }) {
  return <span className="fixed"><Icon name="lock" size={14} />{children}</span>;
}

function Section({ info, end, children }: { info: SectionInfo; end?: ReactNode; children: ReactNode }) {
  return (
    <section className="card" id={`set-${info.id}`} aria-labelledby={`set-h-${info.id}`}>
      <div className="card-h">
        <h2 className="card-n hd" id={`set-h-${info.id}`}><Icon name={info.icon} />{t(info.label)}</h2>
        {end}
      </div>
      {children}
    </section>
  );
}

/** A setting: its name and one line of help on the left, its control on the right (under them on a phone when `wrap`). */
export function Row({ label, labelId, htmlFor, help, wrap = false, join = false, children }: { label?: string; labelId?: string; htmlFor?: string; help?: ReactNode; wrap?: boolean; join?: boolean; children?: ReactNode }) {
  return (
    <div className={`set${wrap ? ' set-wrap' : ''}${join ? ' set-join' : ''}`}>
      <div className="set-l">
        {label && (htmlFor ? <label className="label" htmlFor={htmlFor}>{label}</label> : <span className="label" id={labelId}>{label}</span>)}
        {help && <span className="help">{help}</span>}
      </div>
      {children}
    </div>
  );
}

/** The list of sections: chips on a phone, a list beside the cards on a PC. It follows the page as it scrolls. */
function useSections(sections: SectionInfo[]): { current: string; jump: (id: string) => void; anchor: (el: HTMLElement | null) => void } {
  const [current, setCurrent] = useState(sections[0]?.id ?? '');
  const [page, setPage] = useState<Element | null>(null);
  const ids = sections.map((s) => s.id).join(' ');
  useEffect(() => {
    if (!page) return;
    const spy = () => {
      const top = page.getBoundingClientRect().top;
      let now = ids.split(' ')[0] ?? '';
      for (const id of ids.split(' ')) {
        const el = document.getElementById(`set-${id}`);
        if (el && el.getBoundingClientRect().top - top <= 96) now = id;
      }
      if (page.scrollTop > 0 && page.scrollTop + page.clientHeight >= page.scrollHeight - 2) now = ids.split(' ').pop() ?? now;
      setCurrent(now);
    };
    // "#/settings?at=look" opens the page at that section.
    const at = new URLSearchParams(location.hash.split('?')[1] ?? '').get('at');
    if (at && ids.split(' ').includes(at)) document.getElementById(`set-${at}`)?.scrollIntoView({ block: 'start' });
    spy();
    page.addEventListener('scroll', spy, { passive: true });
    return () => page.removeEventListener('scroll', spy);
  }, [page, ids]);
  const jump = (id: string) => {
    const calm = document.documentElement.dataset.motion === 'off'; // the Animations setting, which follows the device by default
    document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  };
  // The page that scrolls is found from any element inside it.
  const anchor = useCallback((el: HTMLElement | null) => setPage(el ? el.closest('.page') : null), []);
  return { current, jump, anchor };
}

function Contents({ sections, current, jump }: { sections: SectionInfo[]; current: string; jump: (id: string) => void }) {
  return (
    <nav className="toc only-desktop" aria-label={t('Sections')}>
      {sections.map((s) => <button key={s.id} type="button" aria-current={current === s.id ? 'true' : undefined} onClick={() => jump(s.id)}><Icon name={s.icon} size={18} />{t(s.label)}</button>)}
    </nav>
  );
}

function Jumps({ sections, jump }: { sections: SectionInfo[]; jump: (id: string) => void }) {
  return (
    <div className="chips jump only-phone" role="navigation" aria-label={t('Sections')}>
      {sections.map((s) => <button key={s.id} type="button" className="chip" onClick={() => jump(s.id)}><span>{t(s.label)}</span></button>)}
    </div>
  );
}

// ---------- The screen ----------

export function Settings({ tab }: { tab: string }) {
  const view: Tab = tab === 'story' ? 'story' : 'app';
  return (
    <LibraryPage page="settings" title={t('Settings')}>
      <div className="stg">
        <header className="page-h">
          <div>
            <h1 className="only-desktop">{t('Settings')}</h1>
            <p>{view === 'app' ? t('For the whole app · kept on this device') : t('For the story that is open')}</p>
          </div>
        </header>

        <div className="tabs" role="tablist" aria-label={t('Settings')}>
          <a role="tab" href={href('settings')} aria-selected={view === 'app'}>{t('App')}</a>
          <a role="tab" href={href('settings/story')} aria-selected={view === 'story'}>{t('This story')}</a>
        </div>

        {view === 'app' ? <AppSettingsTab /> : <StorySettingsTab />}
      </div>
    </LibraryPage>
  );
}

// ---------- App ----------

function AppSettingsTab() {
  const a = useApp();
  const st = a.settings;
  const { current, jump, anchor } = useSections(APP_SECTIONS);
  const [ask, setAsk] = useState<'erase' | null>(null);
  const [note, setNote] = useState('');
  // How much room the app's data takes on this device, where the browser will say.
  const [room, setRoom] = useState<{ used: number; allowed: number; kept: boolean } | null>(null);
  useEffect(() => {
    let wanted = true;
    void a.storageUse().then((r) => { if (wanted) setRoom(r); });
    return () => { wanted = false; };
  }, [a, a.stories.length]);
  const [capText, setCapText] = useState<string | null>(null); // the limit while it is being typed
  const file = useRef<HTMLInputElement>(null);
  const sec = (id: string) => APP_SECTIONS.find((s) => s.id === id)!;

  // Spending: real charges only. Demo turns are estimates and never count against the limit.
  const spent = a.spentToday();
  const pct = st.dailyCap > 0 ? Math.min(100, Math.round((spent / st.dailyCap) * 100)) : 0;
  const commitCap = () => {
    if (capText === null) return;
    const n = Number(capText);
    if (Number.isFinite(n) && n > 0) a.setSettings({ dailyCap: Math.max(0.05, Math.min(1000, Math.round(n * 100) / 100)) });
    setCapText(null);
  };

  // Data
  const target = a.session ? { id: a.session.story.id, title: a.session.story.title } : a.stories[0] ? { id: a.stories[0].id, title: a.stories[0].title } : null;
  const exportIt = async () => {
    if (!target) return;
    const done = await downloadStory(target.id, target.title);
    setNote(done ? t('“{title}” was saved as a file.', { title: target.title }) : t('The story could not be put together for a file.'));
  };
  const importIt = async (f: File | undefined) => {
    if (!f) return;
    const got = await a.importStory(await f.text());
    setNote('id' in got ? t('Story imported. It is in your stories.') : got.problem);
  };
  // The other services' models in use, priced from their lists.
  const others = [...new Set(Object.values(roleModels(st.models)))].filter((id) => serviceOf(id) !== 'anthropic').map(modelInfo);
  const kept = [tn(a.stories.length, '{n} story', '{n} stories'), t('these settings'), ...(a.keyed.length && st.keep === 'device' ? [tn(a.keyed.length, 'your API key', 'your API keys')] : [])];

  return (
    <div className="split-l" ref={anchor}>
      <Contents sections={APP_SECTIONS} current={current} jump={jump} />

      <div className="set-col">
        <Jumps sections={APP_SECTIONS} jump={jump} />

        {/* The services and their keys */}
        <Section info={sec('key')}>
          <ServiceKeys />
        </Section>

        {/* The model of each role, at one service or several */}
        <Section info={sec('models')}>
          <ModelsSection />
        </Section>

        {/* Narration */}
        <Section info={sec('narration')}>
          <div className="sets">
            <Row label={t('Thinking effort')} help={t('How hard the narrator thinks before writing. Higher costs more.')} wrap>
              <Seg<AppSettings['effort']> label={t('Thinking effort')} value={st.effort} options={[{ id: 'low', label: t('Low') }, { id: 'medium', label: t('Medium') }, { id: 'high', label: t('High') }]} onChange={(effort) => a.setSettings({ effort })} />
            </Row>
            <Row label={t('Continue between passages')} labelId="set-sw-paging" help={t('Show a long reply one passage at a time, and wait for Continue.')}>
              <Switch on={st.paging} labelledBy="set-sw-paging" onChange={(paging) => a.setSettings({ paging })} />
            </Row>
            <Row label={t('Throw the dice yourself')} labelId="set-sw-throw" help={t('A roll waits for you to press the die, and nothing is told until it has landed. Off: dice are thrown for you the moment they are called for.')}>
              <Switch on={st.throwDice} labelledBy="set-sw-throw" onChange={(throwDice) => a.setSettings({ throwDice })} />
            </Row>
            <Row label={t('Dice animation')} labelId="set-sw-dice" help={t('Let the die leap and tumble before it lands. Off: it shows its face at once.')}>
              <Switch on={st.diceAnimation} labelledBy="set-sw-dice" onChange={(diceAnimation) => a.setSettings({ diceAnimation })} />
            </Row>
            <Row help={t('The length of a passage belongs to each story.')} wrap>
              <a className="link link-tap" href={href('settings/story')}>{t('This story’s settings')}<Icon name="right" size={14} strong /></a>
            </Row>
          </div>
        </Section>

        {/* Spending */}
        <Section info={sec('spending')} end={<a className="link link-tap" href={href('usage')}>{t('Open usage')}<Icon name="right" size={14} strong /></a>}>
          <div className="sets">
            <Row label={t('Daily limit')} htmlFor="set-cap" help={t('Play pauses when a day’s spending reaches it. A warning shows at 80%.')}>
              <input
                className="input num money" id="set-cap" type="text" inputMode="decimal" autoComplete="off"
                value={`$${capText ?? st.dailyCap.toFixed(2)}`}
                onChange={(e) => setCapText(e.target.value.replace(/[^0-9.]/g, ''))}
                onBlur={commitCap}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              />
            </Row>
            <div className="set set-join">
              <div className={`budget grow${spent >= st.dailyCap ? ' is-over' : ''}`}>
                <div className="between t-sm"><span className="t-2">{t('Charged today so far')}</span><span className="num"><b>{money(spent, 2)}</b> <span className="t-2">{t('of {limit}', { limit: money(st.dailyCap, 2) })}</span></span></div>
                <div className="track" role="img" aria-label={t('{pct}% of today’s limit used', { pct })}><i style={{ '--v': `${pct}%` } as CSSProperties} /></div>
                {a.usingDemo && <p className="help">{t('The demo narrator is on. Its turns are estimates, were never charged, and do not count against the limit.')}</p>}
              </div>
            </div>
          </div>
        </Section>

        {/* Look: themes, your own colours, the backdrop and animations (LookSettings.tsx) */}
        <Section info={sec('look')}>
          <div className="sets">
            <Row label={t('Language')} help={t('The language of the app. A story is told in the language chosen when its world was built.')} wrap>
              <div className="seg" role="group" aria-label={t('Language')}>
                <button type="button" aria-pressed={st.language === 'en'} onClick={() => a.setSettings({ language: 'en' })}>English</button>
                <button type="button" aria-pressed={st.language === 'pt'} onClick={() => a.setSettings({ language: 'pt' })}>Português</button>
              </div>
            </Row>
          </div>
          <LookSettings />
        </Section>

        {/* Prices */}
        <Section info={sec('prices')} end={<span className="t-sm t-2">{t('As of {date}', { date: longDate(PRICES_AS_OF) })}</span>}>
          <p className="help">{t('List prices, in US dollars for a million units of text. The app counts the cost of every turn with them. Claude’s are kept here; those of Venice and NanoGPT are read from their own lists when a model is chosen, and both also say what each call cost.')}</p>
          <table className="tbl prices">
            <thead><tr><th>{t('Model')}</th><th className="r">{t('Read')}</th><th className="r">{t('From cache')}</th><th className="r">{t('Written')}</th></tr></thead>
            <tbody>
              {[...Object.values(MODELS), ...others].map((x) => (
                <tr key={x.id}><td><b>{x.label}</b>{serviceOf(x.id) !== 'anthropic' && <span className="t-2"> · {SERVICE_NAME[serviceOf(x.id)]}</span>}</td><td className="r">{price(x.input)}</td><td className="r">{price(x.cacheRead)}</td><td className="r">{price(x.output)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="help prices-n">{t('At Claude, saving text to the cache costs {five} times the read price when it is kept for five minutes, and {hour} times when it is kept for an hour; reading it back costs the “from cache” price. The table cannot be edited yet.', { five: CACHE_WRITE_5M, hour: CACHE_WRITE_1H })}</p>
        </Section>

        {/* Your data */}
        <Section info={sec('data')}>
          <div className="sets">
            <Row label={t('Stored on this device')} help={t('{things}. Nothing is kept anywhere else.', { things: cap(listOf(kept)) })} />
            {room && (
              <Row
                label={t('Room used')}
                help={`${t('{used} of about {allowed} that this browser allows.', { used: fileSize(room.used), allowed: fileSize(room.allowed) })} ${room.kept
                  ? t('The browser has agreed to keep the app’s data until you erase it.')
                  : t('The browser may clear the app’s data if the device runs short of space: export the stories you care about.')}`}
              />
            )}
            <Row label={t('Export a story')} help={target ? t('Saves “{title}” as a file, to back it up or move it to another device. The API key is never in the file.', { title: target.title }) : t('There is no story to export yet.')} wrap>
              <button className="btn" type="button" disabled={!target} onClick={() => void exportIt()}><Icon name="download" size={18} />{t('Export')}</button>
            </Row>
            <Row label={t('Import a story')} help={t('Adds a story from a file that Bitor Quest exported.')} wrap>
              <button className="btn" type="button" onClick={() => file.current?.click()}><Icon name="upload" size={18} />{t('Import')}</button>
              <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => { void importIt(e.target.files?.[0]); e.target.value = ''; }} />
            </Row>
            {note && <div className="set set-join"><p className="help" role="status">{note}</p></div>}
            <Row label={t('Erase everything')} help={t('Erases every story, these settings and the keys from this device. It cannot be undone.')} wrap>
              <button className="btn btn-danger" type="button" onClick={() => setAsk('erase')}><Icon name="trash" size={18} />{t('Erase everything')}</button>
            </Row>
          </div>
        </Section>

        {/* About */}
        <Section info={sec('about')}>
          <div className="sets">
            {a.install.update && (
              <Row label={t('A new version is ready')} help={t('It was fetched in the background. Reloading switches to it; your stories are not touched.')} wrap>
                <button className="btn btn-primary" type="button" onClick={() => a.applyUpdate()}><Icon name="rewind" size={18} />{t('Reload to update')}</button>
              </Row>
            )}
            <Row
              label={a.install.standalone ? t('Installed on this device') : t('Install on this device')}
              help={a.install.standalone
                ? (a.install.offline ? t('Bitor Quest opens in a window of its own, and opens without a network connection. Playing still needs one.') : t('Bitor Quest opens in a window of its own.'))
                : a.install.can ? t('Puts Bitor Quest on your home screen or desktop, in a window of its own. Nothing is downloaded from anywhere but this site, and your stories stay where they are.')
                  : a.install.ios ? t('In Safari, tap the Share button, then “Add to Home Screen”.')
                    : (a.install.offline ? t('Your browser’s menu may offer “Install” or “Add to Home screen”. Either way, the app is kept on this device and opens without a network connection.') : t('Your browser’s menu may offer “Install” or “Add to Home screen”.'))}
              wrap
            >
              {a.install.can && <button className="btn" type="button" onClick={() => void a.askInstall()}><Icon name="download" size={18} />{t('Install')}</button>}
            </Row>
          </div>
          <dl className="kv about">
            <div><dt>{t('Version')}</dt><dd>{t('Bitor Quest 0.1, a prototype')}</dd></div>
            <div><dt>{t('Licence')}</dt><dd>{t('Open source, under AGPL-3.0-or-later')}</dd></div>
            <div><dt>{t('Rules')}</dt><dd>{t('Penta. Its rules descend from 3D&T by Marcelo Cassaro.')}</dd></div>
            <div><dt>{t('The services')}</dt><dd>{t('Bitor Quest is not affiliated with Anthropic, Venice or NanoGPT.')}</dd></div>
          </dl>
        </Section>
      </div>

      {ask === 'erase' && (
        <Modal title={t('Erase everything?')} onClose={() => setAsk(null)} foot={(
          <>
            <button className="btn" type="button" onClick={() => setAsk(null)}>{t('Cancel')}</button>
            <button className="btn btn-danger" type="button" onClick={() => { void a.eraseEverything(); }}><Icon name="trash" size={18} />{t('Erase everything')}</button>
          </>
        )}>
          <p className="t-2">{t('{things} will be erased from this device. This cannot be undone.', { things: cap(listOf([tn(a.stories.length, '{n} story', '{n} stories'), t('your settings'), t('the API keys')])) })}</p>
          {target && (
            <>
              <div className="alert alert-warn">
                <Icon name="warn" />
                <div><b>{t('Export first if you want to keep anything.')}</b><p>{t('An export is one file for one story. You can import it again later, here or on another device.')}</p></div>
              </div>
              <button className="btn modal-btn" type="button" onClick={() => void exportIt()}><Icon name="download" size={18} />{t('Export “{title}” first', { title: target.title })}</button>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

// ---------- This story ----------

const STYLES: Record<StorySettings['style'], { name: string; text: string }> = {
  story: { name: m('Story'), text: m('At 0 hit points you are defeated, never killed. A failed roll becomes a success at a cost.') },
  adventure: { name: m('Adventure'), text: m('At 0 hit points there is a death test, softened once per chapter. A failed roll leaves a way forward.') },
  brutal: { name: m('Brutal'), text: m('At 0 hit points there is a death test, and death ends the story. A failed roll fails.') },
};
const VIOLENCE: Record<StorySettings['violence'], string> = {
  mild: m('Kept light: a blow lands and changes something, without wounds in detail.'),
  moderate: m('It has weight and consequences, without lingering on gore.'),
  graphic: m('Described plainly, injuries included, when the story calls for it.'),
};
const POWERS: Record<World['rules']['powers'], string> = { off: m('No powers'), focus: m('Focus'), extreme: m('Extreme'), gift: m('Gift') };
const LENGTHS: { id: StorySettings['narration']; label: string }[] = [{ id: 'short', label: m('Short') }, { id: 'medium', label: m('Medium') }, { id: 'long', label: m('Long') }];
const STYLES_OF_PROSE: { id: StorySettings['prose']; label: string }[] = [{ id: 'plain', label: PROSE.plain.name }, { id: 'clear', label: PROSE.clear.name }, { id: 'literary', label: PROSE.literary.name }];

function StorySettingsTab() {
  const a = useApp();
  const s = a.session;
  const { current, jump, anchor } = useSections(STORY_SECTIONS);
  if (!s) {
    return (
      <section className="empty">
        <Icon name="story" size={40} />
        <h2>{t('No story is open')}</h2>
        <p>{t('These settings belong to one story. Open a story, then come back here.')}</p>
        <a className="btn btn-primary btn-fit" href={href('')}>{t('Go to your stories')}</a>
      </section>
    );
  }
  const story = s.story;
  const st = story.settings;
  const rules = story.world.rules;
  const party = Object.values(story.world.people).filter((p) => p.inParty).map((p) => p.name);
  const sketches = Object.values(story.world.places).filter((p) => p.sketch).length;
  const sec = (id: string) => STORY_SECTIONS.find((x) => x.id === id)!;
  const setLength = (narration: StorySettings['narration']) => {
    if (narration !== st.narration) s.updateSettings({ narration });
  };
  const setProse = (prose: StorySettings['prose']) => {
    if (prose !== st.prose) s.updateSettings({ prose });
  };

  return (
    <div className="split-l" ref={anchor}>
      <Contents sections={STORY_SECTIONS} current={current} jump={jump} />

      <div className="set-col">
        <div className="card which" style={{ '--a': story.world.accent } as CSSProperties}>
          <span className="st-swatch" aria-hidden="true" />
          <div className="grow">
            <div className="card-n">{story.title}</div>
            <div className="list"><span>{story.world.name}</span><span>{t('Chapter {n}', { n: story.chapter.n })}</span><span>{tn(story.totals.turns, '{n} turn', '{n} turns')}</span></div>
          </div>
          <a className="btn btn-fit" href={href('play')}><Icon name="play" size={14} fill />{t('Continue')}</a>
        </div>

        <Jumps sections={STORY_SECTIONS} jump={jump} />
        <p className="help">{t('These were chosen when the story began. For now only how it ends, the length of a passage, the writing style and whether places are filled in can be changed.')}</p>

        {/* Table style */}
        <Section info={sec('table')}>
          <div className="sets">
            <Row help={t(STYLES[st.style].text)}><Fixed>{t(STYLES[st.style].name)}</Fixed></Row>
            <div className="set">
              <div className="grow stack-s">
                <EndingChoice id="set-end" ending={st.ending ?? 'endless'} length={st.length ?? 'medium'} onChange={(patch) => s.updateSettings(patch)} />
                {story.chapter.final && st.ending === 'ending' && <p className="help"><Icon name="flag" size={14} /> {t('This is the final chapter: the story ends when it does.')}</p>}
                {story.season && story.season > 1 ? <p className="help">{t('Season {n}: its length is counted from where it began.', { n: story.season })}</p> : null}
              </div>
            </div>
          </div>
        </Section>

        {/* Storytelling */}
        <Section info={sec('telling')}>
          <div className="sets">
            <Row label={t('Length of a passage')} help={t('The narrator aims for {words} words a reply. Longer passages cost more.', { words: t(NARRATION_WORDS[st.narration].words) })} wrap>
              <Seg label={t('Length of a passage in this story')} value={st.narration} options={LENGTHS.map((o) => ({ ...o, label: t(o.label) }))} onChange={setLength} />
            </Row>
            <Row label={t('Writing style')} help={t(PROSE[st.prose ?? 'clear'].help)} wrap>
              <Seg label={t('Writing style in this story')} value={st.prose ?? 'clear'} options={STYLES_OF_PROSE.map((o) => ({ ...o, label: t(o.label) }))} onChange={setProse} />
            </Row>
            <div className="set set-join"><p className="help">{t('In every style the narrator must state plainly what happened and what you need to know to choose your next move, so you never have to guess. Changing the length or the style sends the narrator its instructions again once, at full price, on the next turn. After that turn they are read from the cache as before.')}</p></div>
            <Row label={t('Story language')} help={t('The language the narrator writes in.')}><Fixed>{st.language === 'pt' ? 'Português' : 'English'}</Fixed></Row>
            <Row label={t('Suggested actions')} help={t('A few things you could do next, offered after each reply.')}><Fixed>{st.suggestions ? t('On') : t('Off')}</Fixed></Row>
            <Row label={t('Companions')} help={party.length ? t('With {name} now: {names}.', { name: story.protagonist.name, names: listOf(party) }) : t('Nobody travels with {name} now.', { name: story.protagonist.name })}><Fixed>{st.companions}</Fixed></Row>
            {sketches > 0 && (
              <Row
                label={t('Fill in places on arrival')} labelId="set-fill"
                help={[
                  tn(sketches, '{n} place on the map is still one line.', '{n} places on the map are still one line each.'),
                  t('The first time you arrive at one, what is inside it is written and kept: its parts, its people, what is going on there.'),
                  t('Once for each place, {cost}.', { cost: a.usingDemo ? t('free in the demo') : t('about {price} with the models chosen now', { price: estimateExpand(a.models()) < 0.005 ? t('under a cent') : money(estimateExpand(a.models()), 2) }) }),
                  t('Switched off, the narrator makes do with the one line and nothing is kept.'),
                ].join(' ')}
              >
                <Switch on={st.fillPlaces !== false} labelledBy="set-fill" onChange={(on) => s.updateSettings({ fillPlaces: on })} />
              </Row>
            )}
          </div>
        </Section>

        {/* Tone and content */}
        <Section info={sec('tone')}>
          <div className="sets">
            <Row label={t('Romance')} help={st.romance ? t('Welcome when you invite it. Each person decides for themselves whether they return it. Never with minors.') : t('This story has no romance.')}><Fixed>{st.romance ? t('On') : t('Off')}</Fixed></Row>
            <Row label={t('Violence')} help={t(VIOLENCE[st.violence])}><Fixed>{t(cap(st.violence))}</Fixed></Row>
            <Row label={t('Leave out')} help={st.leaveOut.trim() ? t('The narrator steers around: {text}.', { text: st.leaveOut.trim() }) : t('Nothing is listed. The narrator steers around whatever is.')}><Fixed>{st.leaveOut.trim() ? t('Listed') : t('Nothing')}</Fixed></Row>
          </div>
        </Section>

        {/* Set by the world */}
        <Section info={sec('world')}>
          <div className="sets">
            <Row
              label={t('Powers')}
              help={rules.powers === 'off' ? t('There are no powers in this world.')
                : rules.powers === 'gift' ? t('A power here is one of your own, with a rank from 1 to {max}.', { max: GIFT_RANK_MAX })
                  : rules.powers === 'extreme' ? t('Powers here are schools, taken as advantages.')
                    : t('The paths are rated 0 to 5 and capped at {cap} in this world.', { cap: rules.pathCap })}
            ><Fixed>{t(POWERS[rules.powers])}</Fixed></Row>
            <Row label={t('Destiny points')} help={t('Spend one to get back on your feet when a fight brings you down.')}><Fixed>{t('{n} a chapter', { n: rules.destinyPerChapter })}</Fixed></Row>
            <Row help={t('These belong to {world}. They cannot change once a story has begun.', { world: story.world.name })} />
          </div>
        </Section>
      </div>
    </div>
  );
}
