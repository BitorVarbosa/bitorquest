// The frame around every screen: the top bar and the navigation.
// Two navigations: inside a story (Story, People, Character, Journal, Map) and outside (Stories, Usage, Settings).
// On a PC both are a rail. On a phone the one outside is a bottom bar, and the one inside a story is the
// menu behind the top bar's menu button (StoryMenu), on every screen of the story, so the page has the room.
import { useEffect, useState, type ReactNode } from 'react';
import { clockLabel, slotOf } from '../engine';
import { SERVICE_NAME, modelInfo } from '../game/llm/models';
import { currentScene } from '../game/story';
import type { Story } from '../game/types';
import { listOf, m, t } from '../i18n';
import { app, useApp } from './app';
import type { IconName } from './icons';
import { href } from './router';
import { toggleTheme } from './themes';
import { Icon, Modal, money } from './ui';

export type ShellKind = 'story' | 'library' | 'flow' | 'bare';

const NAV: Record<'story' | 'library', { id: string; label: string; to: string; icon: IconName; desktopOnly?: boolean }[]> = {
  story: [
    { id: 'story', label: m('Story'), to: 'play', icon: 'story' },
    { id: 'people', label: m('People'), to: 'people', icon: 'people' },
    { id: 'character', label: m('Character'), to: 'character', icon: 'sheet' },
    { id: 'journal', label: m('Journal'), to: 'journal', icon: 'journal' },
    { id: 'map', label: m('Map'), to: 'map', icon: 'map' },
    { id: 'settings', label: m('Settings'), to: 'settings', icon: 'sliders', desktopOnly: true },
  ],
  library: [
    { id: 'stories', label: m('Stories'), to: '', icon: 'home' },
    { id: 'worlds', label: m('Worlds'), to: 'worlds', icon: 'globe' },
    { id: 'usage', label: m('Usage'), to: 'usage', icon: 'chart' },
    { id: 'settings', label: m('Settings'), to: 'settings', icon: 'sliders' },
  ],
};

/** Sets the shell kind on <body>, which the stylesheet uses to lay out the frame. */
export function useShell(kind: ShellKind): void {
  useEffect(() => {
    document.body.dataset.shell = kind;
  }, [kind]);
}

/** The sun and moon button: from the dark theme to the last light theme chosen, and back. */
function ThemeButton() {
  const a = useApp();
  return (
    <button className="ib ib-theme" onClick={() => a.setSettings(toggleTheme(a.settings, a.look.deviceLight))} aria-label={t('Switch between your dark theme and your light theme')}>
      <Icon name="sun" className="t-sun" /><Icon name="moon" className="t-moon" />
    </button>
  );
}

/**
 * The navigation inside a story on a phone: the screens of the story with the one you are on marked,
 * the settings, the theme, and the way back to the list of stories. The same on every screen of a story.
 */
export function StoryMenu({ page, onClose, dot, actions }: { page: string; onClose: () => void; dot?: string; /** Rows of the screen's own, under the screens: things to do rather than places to go. */ actions?: ReactNode }) {
  const a = useApp();
  return (
    <Modal title={t('Menu')} onClose={onClose}>
      <nav className="card card-flush" aria-label={t('Primary')}>
        {NAV.story.map((it) => (
          // Closing on a press: the screen you are on is a link to where you already are, which changes nothing by itself.
          <a key={it.id} className="row" href={href(it.to)} data-nav-item={it.id} aria-current={it.id === page ? 'page' : undefined} onClick={onClose}>
            <span className="tab-i"><Icon name={it.icon} size={22} />{dot === it.id && <span className="tab-dot" aria-label={t('Something changed')} />}</span>
            <span className="grow row-t">{t(it.label)}</span>
            <Icon name="right" size={16} className="t-3" />
          </a>
        ))}
      </nav>
      {actions && <div className="card card-flush">{actions}</div>}
      <div className="card card-flush">
        <button type="button" className="row" onClick={() => a.setSettings(toggleTheme(a.settings, a.look.deviceLight))}>
          <span className="tab-i"><Icon name="sun" size={22} className="t-sun" /><Icon name="moon" size={22} className="t-moon" /></span>
          <span className="grow row-t">{t('Dark or light theme')}</span>
        </button>
        <a className="row" href={href('')}>
          <span className="tab-i"><Icon name="home" size={22} /></span>
          <span className="grow row-t">{t('Back to your stories')}</span>
        </a>
      </div>
    </Modal>
  );
}

function Brand() {
  return (
    <a className="brand" href={href('')}>
      <span className="logo" aria-hidden="true"><Icon name="spark" size={16} fill /></span><span>Bitor Quest</span>
    </a>
  );
}

const slotIcon = (slot: string): IconName => (slot === 'Night' || slot === 'Evening' ? 'moon' : slot === 'Dusk' || slot === 'Dawn' ? 'dusk' : 'sun');

/** The top bar. Inside a story it shows the story, where and when you are, and what the last turn cost. */
export function TopBar({ kind, title, sub, back, cost = false, as, onMenu, menuDot = false, end }: {
  kind: 'story' | 'library' | 'flow'; title: string; sub?: string; back?: string; cost?: boolean;
  /** The story as the screen shows it, when that is not the story as it stands: while dice wait to be thrown, where and when you are stay as they were. */
  as?: Story;
  /** Inside a story: the menu button opens the menu (StoryMenu) instead of leaving for the list of stories. */
  onMenu?: () => void;
  /** A dot on the menu button: something waits behind it. */
  menuDot?: boolean;
  /** Something of the screen's own at the end of the bar, before the cost. */
  end?: ReactNode;
}) {
  const a = useApp();
  const s = a.session;
  if (kind === 'story' && s) {
    const story = as ?? s.story;
    const scene = currentScene(story);
    const place = story.world.places[scene.placeId]?.name ?? '';
    const slot = slotOf(story.clock);
    const day = t('Day {n}', { n: story.clock.day });
    const last = s.lastTurn?.cost ?? 0;
    const demo = a.usingDemo;
    return (
      <div className="bar">
        {back
          ? <a className="ib menu" href={href(back)} aria-label={t('Back')}><Icon name="left" size={22} /></a>
          : onMenu
            ? <button type="button" className="ib menu" onClick={onMenu} aria-haspopup="dialog" aria-label={t('Menu')}><Icon name="menu" size={22} />{menuDot && <span className="tab-dot" aria-label={t('Something changed')} />}</button>
            : <a className="ib menu" href={href('')} aria-label={t('Menu: back to your stories')}><Icon name="menu" size={22} /></a>}
        <Brand />
        <div className="bar-mid">
          <div className="titles">
            <h1 className="story-title"><span className="world" aria-hidden="true" /><span className="only-phone">{title}</span><span className="only-desktop">{story.title}</span></h1>
            <p className="sub sub-place">{sub ? <span>{sub}</span> : <><Icon name={slotIcon(slot)} size={14} strong /><span>{place} · {t(slot)} · {day}</span></>}</p>
            <p className="sub sub-chapter">{t('Chapter {n} · “{title}” · Scene {scene}', { n: story.chapter.n, title: story.chapter.title, scene: scene.n })}</p>
          </div>
          <p className="place"><Icon name="pin" size={16} />{place} <span className="dot" aria-hidden="true">·</span> <Icon name={slotIcon(slot)} size={16} />{t(slot)} <span className="dot" aria-hidden="true">·</span> {day}</p>
        </div>
        <div className="bar-end">
          {end}
          {cost && <div className="cost-chip" title={demo ? t('Demo narrator: an estimate, nothing was charged') : t('Cost of the last turn')}><span className="cost-k">{demo ? t('Demo') : t('Turn')}</span>{money(last, 3)}</div>}
          <dl className="cost" aria-label={t('Cost meter')}>
            <div><dt>{demo ? t('Last turn (est.)') : t('Last turn')}</dt><dd>{money(last, 3)}</dd></div>
            <div><dt>{t('Session')}</dt><dd>{money(s.story.totals.cost - a.costAtOpen, 2)}</dd></div>
            <div><dt>{t('Narrator')}</dt><dd>{demo ? t('Demo') : modelInfo(a.settings.models.narrator).label}</dd></div>
          </dl>
          <ThemeButton />
        </div>
      </div>
    );
  }
  if (kind === 'flow') {
    return (
      <div className="bar">
        <a className="ib" href={href(back ?? '')} aria-label={t('Close ((button))')}><Icon name="x" size={22} /></a>
        <div className="bar-mid"><div className="titles"><h1 className="story-title"><span>{title}</span></h1>{sub && <p className="sub"><span>{sub}</span></p>}</div></div>
        <div className="bar-end"><ThemeButton /></div>
      </div>
    );
  }
  return (
    <div className="bar">
      {back ? <a className="ib menu" href={href(back)} aria-label={t('Back')}><Icon name="left" size={22} /></a> : <span className="logo only-phone" aria-hidden="true"><Icon name="spark" size={16} fill /></span>}
      <Brand />
      <div className="bar-mid"><div className="titles"><h1 className="story-title"><span>{title}</span></h1>{sub && <p className="sub"><span>{sub}</span></p>}</div></div>
      <div className="bar-end"><ThemeButton /></div>
    </div>
  );
}

export function Nav({ kind, page, dot }: { kind: 'story' | 'library'; page: string; dot?: string }) {
  return (
    <nav className="nav" aria-label={t('Primary')}>
      {NAV[kind].map((it) => (
        <a key={it.id} className={`tab${it.desktopOnly ? ' tab-set' : ''}`} href={href(it.to)} data-nav-item={it.id} aria-current={it.id === page ? 'page' : undefined}>
          <span className="tab-i"><Icon name={it.icon} size={22} />{dot === it.id && <span className="tab-dot" aria-label={t('Something changed')} />}</span>{t(it.label)}
        </a>
      ))}
    </nav>
  );
}

/** A screen inside a story: top bar, navigation (the rail on a PC, the menu on a phone), and a scrolling page. */
export function StoryPage({ page, title, back, children, wide }: { page: string; title: string; back?: string; children: ReactNode; wide?: 'narrow' | 'mid' }) {
  useShell('story');
  const [menu, setMenu] = useState(false);
  const waiting = Object.values(app.session?.story.world.people ?? {}).some((p) => p.pendingMoment);
  const dot = waiting && page !== 'people' ? 'people' : undefined;
  return (
    <div className="app in-story">
      <header className="top"><TopBar kind="story" title={title} back={back} onMenu={() => setMenu(true)} menuDot={!!dot} /></header>
      <Nav kind="story" page={page} dot={dot} />
      <main className="page"><div className={`page-col${wide ? ` ${wide}` : ''}`}>{children}</div></main>
      {menu && <StoryMenu page={page} onClose={() => setMenu(false)} dot={dot} />}
    </div>
  );
}

/** A screen outside any story. */
export function LibraryPage({ page, title, back, children, wide }: { page: string; title: string; back?: string; children: ReactNode; wide?: 'narrow' | 'mid' }) {
  useShell('library');
  return (
    <div className="app">
      <header className="top"><TopBar kind="library" title={title} back={back} /></header>
      <Nav kind="library" page={page} />
      <main className="page"><div className={`page-col${wide ? ` ${wide}` : ''}`}>{children}</div></main>
    </div>
  );
}

/**
 * A guided flow (a new world, a new character): a top bar with a way out, a scrolling page, and a foot
 * that holds the buttons which move the flow on, always in reach. No navigation.
 */
export function FlowPage({ title, sub, back, foot, children, className }: { title: string; sub?: string; back?: string; foot: ReactNode; children: ReactNode; className?: string }) {
  useShell('flow');
  return (
    <div className="app">
      <header className="top"><TopBar kind="flow" title={title} sub={sub} back={back} /></header>
      <main className="page"><div className={`page-col${className ? ` ${className}` : ''}`}>{children}</div></main>
      <div className="flow-foot">{foot}</div>
    </div>
  );
}

/** The demo narrator is in use: say so plainly wherever money or story quality could be misread. */
export function DemoBanner() {
  const a = useApp();
  if (!a.usingDemo) return null;
  // With no key at all, playing for real starts with one. With a key, what keeps the demo on is in
  // Settings: a role set to a service there is no key for, or the demo chosen there.
  const missing = a.missingKeys;
  return (
    <div className="alert alert-warn">
      <Icon name="info" />
      <div>
        <b>{t('Demo narrator')}</b>
        <p>{t('The story text is canned and nothing is sent or charged. Costs shown are estimates of what the chosen models would have cost.')}</p>
        {a.keyed.length === 0
          ? <a className="link link-tap" href={href('welcome')}>{t('Add your API key to play for real')}<Icon name="right" size={14} strong /></a>
          : (
            <a className="link link-tap" href={href('settings')}>
              {missing.length > 0
                ? t('Add a key for {services} in Settings, or choose other models', { services: listOf(missing.map((s) => SERVICE_NAME[s])) })
                : t('Turn the demo narrator off in Settings to play for real')}
              <Icon name="right" size={14} strong />
            </a>
          )}
      </div>
    </div>
  );
}

export { clockLabel };
