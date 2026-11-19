// The Look section of Settings: the themes, the player's own colours, the backdrop and animations.
// Every theme is shown as a small preview painted with that theme's own colours, so what you tap is what you get.
import { useMemo, type CSSProperties } from 'react';
import { m, t } from '../../i18n';
import { useApp } from '../app';
import {
  DEFAULT_ACCENT, THEMES, activeThemeId, chooseCustom, chooseTheme, customDef, deriveTheme, hexToLch, lchToHex, themeById,
  type Backdrop, type CustomTheme, type Motion, type ThemeDef,
} from '../themes';
import { Icon } from '../ui';
import { Row, Seg, Switch } from './Settings';
import './look.css';

const GROUPS: { id: ThemeDef['group']; label: string }[] = [{ id: 'solid', label: m('Solid') }, { id: 'gradient', label: m('Gradient') }];

const BACKDROPS: { id: Backdrop; label: string; help: string }[] = [
  { id: 'still', label: m('Still'), help: m('Nothing moves behind the page.') },
  { id: 'glow', label: m('Glow'), help: m('Soft light in the theme’s colours drifts slowly behind the page.') },
  { id: 'embers', label: m('Embers'), help: m('The glow, with small sparks rising through it.') },
];
const MOTIONS: { id: Motion; label: string }[] = [{ id: 'auto', label: m('Auto') }, { id: 'on', label: m('On') }, { id: 'off', label: m('Off') }];

/** A second colour to start a gradient from: the same depth as the first, a step round the colour wheel. */
function secondFor(bg: string): string {
  const c = hexToLch(bg);
  return lchToHex({ l: c.l, c: Math.max(c.c, 0.08), h: (c.h + 60) % 360 });
}

/** One theme: a small picture of a page in its colours (the page, a card, two lines of text, the accent), and its name. */
function Tile({ name, vars, on, onPick }: { name: string; vars: Record<string, string>; on: boolean; onPick: () => void }) {
  return (
    <button type="button" className="look-tile" aria-pressed={on} onClick={onPick}>
      <span className="look-frame" aria-hidden="true">
        <span className="look-pv" style={vars as CSSProperties}>
          <span className="look-pv-card"><i /><i /><b /></span>
        </span>
        {on && <span className="look-on"><Icon name="check" size={12} strong /></span>}
      </span>
      <span className="look-name">{name}</span>
    </button>
  );
}

export function LookSettings() {
  const a = useApp();
  const st = a.settings;
  const own = st.custom;
  const { deviceLight, deviceCalm } = a.look;
  const storyAccent = a.session?.story.world.accent ?? null;
  const showing = activeThemeId(st, deviceLight);
  const following = st.theme === 'system';

  // Every preview is painted with the colours that theme would really have, with the open story's colour where the theme has no accent.
  const previews = useMemo(() => THEMES.map((def) => ({ def, vars: deriveTheme(def, storyAccent).vars })), [storyAccent]);
  const ownVars = useMemo(() => deriveTheme(customDef(own), storyAccent).vars, [own, storyAccent]);

  const pick = (id: string) => a.setSettings(chooseTheme(st, id, deviceLight));
  const setOwn = (change: Partial<CustomTheme>) => a.setSettings(chooseCustom(st, { ...own, ...change }, deviceLight));
  const nameOf = (id: string) => (id === 'custom' ? t('your own') : t(themeById(id)?.name ?? 'Slate'));

  const backdrop = BACKDROPS.find((b) => b.id === st.backdrop) ?? BACKDROPS[0]!;
  const motionHelp = st.motion === 'on' ? t('Always on, even if your device is set to reduce motion.')
    : st.motion === 'off' ? t('Nothing moves: pages and buttons change at once, dice do not roll, and the backdrop stands still.')
    : deviceCalm ? t('Your device is set to reduce motion, so animations are off.')
    : t('On, unless your phone or computer is set to reduce motion.');

  return (
    <div className="look">
      {GROUPS.map((g) => (
        <div key={g.id} className="look-grp" role="group" aria-label={t('{group} themes', { group: t(g.label) })}>
          <h3 className="look-h">{t(g.label)}</h3>
          <div className="look-grid">
            {previews.filter((p) => p.def.group === g.id).map((p) => (
              <Tile key={p.def.id} name={t(p.def.name)} vars={p.vars} on={showing === p.def.id} onPick={() => pick(p.def.id)} />
            ))}
          </div>
        </div>
      ))}

      <div className="look-grp" role="group" aria-label={t('Your own theme')}>
        <h3 className="look-h">{t('Your own')}</h3>
        <div className="look-own">
          <Tile name={t('Your own')} vars={ownVars} on={showing === 'custom'} onPick={() => pick('custom')} />
          <p className="help">{t('Pick any colour: it keeps its tint and is made dark or light enough for text to stay easy to read.')}</p>
        </div>
        <div className="sets">
          <Row label={t('Background')} htmlFor="look-bg">
            <input className="look-color" id="look-bg" type="color" value={own.bg} onChange={(e) => setOwn({ bg: e.target.value })} />
          </Row>
          <Row label={t('Blend into a second colour')} labelId="look-sw-bg2" help={t('Turns the background into a gradient.')}>
            {own.bg2 && <input className="look-color" type="color" aria-label={t('Second colour')} value={own.bg2} onChange={(e) => setOwn({ bg2: e.target.value })} />}
            <Switch on={!!own.bg2} labelledBy="look-sw-bg2" onChange={(on) => setOwn({ bg2: on ? secondFor(own.bg) : null })} />
          </Row>
          <Row label={t('Use each story’s colour')} labelId="look-sw-accent" help={t('For buttons, links and highlights. Turn it off to pick one colour for every story.')}>
            {own.accent && <input className="look-color" type="color" aria-label={t('Accent colour')} value={own.accent} onChange={(e) => setOwn({ accent: e.target.value })} />}
            <Switch on={!own.accent} labelledBy="look-sw-accent" onChange={(on) => setOwn({ accent: on ? null : storyAccent ?? DEFAULT_ACCENT })} />
          </Row>
          <Row label={t('Dark or light')} help={own.light ? t('A light page with dark text.') : t('A dark page with light text.')} wrap>
            <Seg label={t('Dark or light')} value={own.light ? 'light' : 'dark'} options={[{ id: 'dark', label: t('Dark ((page))') }, { id: 'light', label: t('Light ((page))') }]} onChange={(v) => setOwn({ light: v === 'light' })} />
          </Row>
        </div>
      </div>

      <div className="sets look-more">
        <Row label={t('Follow the device')} labelId="look-sw-device" help={t('Switches with your phone or computer between the last dark theme you picked ({dark}) and the last light one ({light}).', { dark: nameOf(st.themeDark), light: nameOf(st.themeLight) })}>
          <Switch on={following} labelledBy="look-sw-device" onChange={(on) => a.setSettings({ theme: on ? 'system' : showing })} />
        </Row>
        <Row label={t('Backdrop')} help={`${t(backdrop.help)}${st.backdrop !== 'still' && !a.look.motion ? ` ${t('Animations are off, so it stands still.')}` : ''}`} wrap>
          <Seg<Backdrop> label={t('Backdrop')} value={st.backdrop} options={BACKDROPS.map((b) => ({ ...b, label: t(b.label) }))} onChange={(v) => a.setSettings({ backdrop: v })} />
        </Row>
        <Row label={t('Animations')} help={motionHelp} wrap>
          <Seg<Motion> label={t('Animations')} value={st.motion} options={MOTIONS.map((o) => ({ ...o, label: t(o.label) }))} onChange={(v) => a.setSettings({ motion: v })} />
        </Row>
      </div>
    </div>
  );
}
