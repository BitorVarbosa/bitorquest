// Colour themes: every theme, and any colour a player can pick, must give readable text.
import { describe, expect, it } from 'vitest';
import {
  CONTRAST, DARK_MAX, DARK_MIN, DEFAULT_ACCENT, DEFAULT_LOOK, GLOW_ALPHA, GLOW_OVERLAP, LIGHT_MIN, THEMES,
  activeTheme, activeThemeId, chooseCustom, chooseTheme, cleanLook, contrast, customDef, deriveTheme, hexToLch, isHex, isLight,
  lchToHex, luminance, mix, motionOn, pageColour, parseHex, themeById, toggleTheme,
  type CustomTheme, type Derived, type Look, type ThemeDef,
} from '../src/app/themes';

// A copy of the persona hues (--p-mira, --p-tobin, --p-roth, --p-lise, --p-hask, --p-dace, --p-sela) from
// src/app/styles/slate.css: the dark set on :root, the light set on :root.theme-light. They do not change
// with the theme, so every theme has to keep its cards readable under them.
const PERSONA = {
  dark: ['#f590b9', '#b7a6f8', '#9fb1cb', '#f2b872', '#7fc8a9', '#f08a7e', '#8fc4f0'],
  light: ['#b01f57', '#5f41c2', '#4a5b74', '#9a5b06', '#1d7453', '#b5382b', '#1f6aa8'],
};

const ROLES = [
  '--c-chrome', '--c-pane', '--c-story', '--c-card', '--c-raised', '--c-track', '--c-line', '--c-line-strong',
  '--c-text', '--c-text-2', '--c-text-3', '--accent', '--c-accent-fill', '--c-on-accent', '--c-accent-text',
];

const LIGHT_IDS = ['paper', 'parchment', 'mist', 'blossom', 'dawn', 'meadow', 'sorbet'];

// Colours nobody should pick for a page, and that a player can.
const HOSTILE = ['#808080', '#ff0000', '#00ff00', '#ffffff', '#000000', '#ffff00', '#0000ff', '#ff00ff'];
const CLASHING: [string, string][] = [['#ff0000', '#00ff00'], ['#ffffff', '#000000'], ['#0000ff', '#ffff00'], ['#808080', '#ff00ff']];
const ACCENTS: (string | null)[] = [null, '#2bb3a3', '#ff0000', '#ffff00', '#000000', '#ffffff', '#808080', '#0000ff'];

/** The two ends of the page: one colour for a solid theme, two for a gradient. */
function pageEnds(d: Derived): string[] {
  const ends = d.vars['--bg-app']!.match(/#[0-9a-f]{6}/g) ?? [];
  expect(ends.length).toBe(d.gradient ? 2 : 1);
  return ends;
}

function rgbaParts(v: string): { hex: string; alpha: number } {
  const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(v);
  expect(m, v).not.toBeNull();
  const hex = `#${[m![1], m![2], m![3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
  return { hex, alpha: Number(m![4]) };
}

/** The guarantees. `what` names the theme in a failure message. */
function expectReadable(d: Derived, what: string): void {
  const v = d.vars;
  for (const k of ROLES) expect(isHex(v[k]), `${what}: ${k} = ${v[k]}`).toBe(true);
  const ends = pageEnds(d);
  const surfaces = [v['--c-card']!, v['--c-raised']!, v['--c-story']!, v['--c-chrome']!, v['--c-pane']!, ...ends];
  // The page with the backdrop's glow at its strongest over it.
  for (const fx of ['--fx-1', '--fx-2']) {
    const g = rgbaParts(v[fx]!);
    expect(g.alpha).toBe(d.light ? GLOW_ALPHA.light : GLOW_ALPHA.dark);
    for (const end of ends) surfaces.push(mix(g.hex, end, Math.min(1, g.alpha * GLOW_OVERLAP)));
  }
  const least = (ink: string) => Math.min(...surfaces.map((s) => contrast(ink, s)));
  expect(least(v['--c-text']!), `${what}: text`).toBeGreaterThanOrEqual(CONTRAST.text);
  expect(least(v['--c-text-2']!), `${what}: secondary text`).toBeGreaterThanOrEqual(CONTRAST.quiet);
  expect(least(v['--c-text-3']!), `${what}: tertiary text`).toBeGreaterThanOrEqual(CONTRAST.quiet);
  expect(least(v['--c-accent-text']!), `${what}: accent text`).toBeGreaterThanOrEqual(CONTRAST.quiet);
  expect(contrast(v['--c-line-strong']!, v['--c-card']!), `${what}: control border`).toBeGreaterThanOrEqual(CONTRAST.control);
  expect(contrast(v['--c-on-accent']!, v['--c-accent-fill']!), `${what}: writing on a filled button`).toBeGreaterThanOrEqual(CONTRAST.quiet);
  // The accent tint, as slate.css mixes it (14% accent over the card), under body text and under accent text.
  const tint = mix(v['--accent']!, v['--c-card']!, 0.14);
  expect(contrast(v['--c-text']!, tint), `${what}: text on the accent tint`).toBeGreaterThanOrEqual(CONTRAST.text);
  expect(contrast(v['--c-accent-text']!, tint), `${what}: accent text on the accent tint`).toBeGreaterThanOrEqual(CONTRAST.quiet);
  for (const hue of PERSONA[d.light ? 'light' : 'dark']) {
    expect(contrast(hue, v['--c-card']!), `${what}: persona hue ${hue} on a card`).toBeGreaterThanOrEqual(4.5);
  }
  // Secondary text never fainter than tertiary, and body text never fainter than secondary.
  const page = luminance(v['--c-card']!);
  const away = (ink: string) => Math.abs(luminance(ink) - page);
  expect(away(v['--c-text']!)).toBeGreaterThanOrEqual(away(v['--c-text-2']!));
  expect(away(v['--c-text-2']!)).toBeGreaterThanOrEqual(away(v['--c-text-3']!));
}

describe('colour maths', () => {
  it('reads and writes hex colours', () => {
    expect(parseHex('#ffffff')).toEqual([1, 1, 1]);
    expect(parseHex('#000')).toEqual([0, 0, 0]);
    expect(parseHex('nonsense')).toEqual([0, 0, 0]);
    expect(isHex('#12abEF')).toBe(true);
    expect(isHex('#123')).toBe(false);
    expect(isHex(null)).toBe(false);
  });

  it('goes to OKLCH and back without drifting', () => {
    for (const hex of ['#151920', '#2bb3a3', '#ffffff', '#000000', '#ff0000', '#f6efe0', '#3a1c2e', '#808080']) {
      expect(lchToHex(hexToLch(hex))).toBe(hex);
    }
    expect(hexToLch('#ffffff').l).toBeCloseTo(1, 3);
    expect(hexToLch('#000000').l).toBeCloseTo(0, 3);
    expect(hexToLch('#808080').c).toBeLessThan(0.001);
  });

  it('keeps lightness and hue when a colour is too strong for the screen', () => {
    const hex = lchToHex({ l: 0.5, c: 0.4, h: 150 });
    const back = hexToLch(hex);
    expect(back.l).toBeCloseTo(0.5, 1);
    expect(Math.abs(back.h - 150)).toBeLessThan(4);
    expect(back.c).toBeLessThan(0.4);
  });

  it('measures contrast as WCAG does', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBe(1);
    expect(contrast('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5); // the well-known lightest grey that passes on white
    expect(contrast('#777777', '#ffffff')).toBeLessThan(4.5);
    expect(contrast('#161d27', '#ffffff')).toBe(contrast('#ffffff', '#161d27'));
  });

  it('mixes like CSS color-mix in sRGB', () => {
    expect(mix('#ffffff', '#000000', 0.5)).toBe('#808080');
    expect(mix('#2bb3a3', '#ffffff', 0.78)).toBe('#5ac4b7');
    expect(mix('#2bb3a3', '#000000', 0.64)).toBe('#1c7368');
  });
});

describe('the presets', () => {
  it('are about twenty, each with its own id and a short plain name', () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(18);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    expect(new Set(THEMES.map((t) => t.name)).size).toBe(THEMES.length);
    for (const t of THEMES) {
      expect(t.id).toMatch(/^[a-z]+$/);
      expect(t.name).toMatch(/^[A-Z][a-z]{2,9}$/);
      expect(t.group === 'gradient').toBe(!!t.bg2);
      expect(isHex(t.bg)).toBe(true);
    }
    expect(THEMES.some((t) => t.id === 'custom' || t.id === 'system')).toBe(false);
  });

  it('have solid and gradient themes, dark and light', () => {
    for (const group of ['solid', 'gradient'] as const) {
      for (const light of [false, true]) {
        expect(THEMES.filter((t) => t.group === group && isLight(t) === light).length).toBeGreaterThanOrEqual(3);
      }
    }
    expect(THEMES.filter(isLight).map((t) => t.id).sort()).toEqual([...LIGHT_IDS].sort());
  });

  it('are shown exactly as written: no page colour needs correcting', () => {
    for (const t of THEMES) {
      const d = deriveTheme(t, null);
      expect(d.light).toBe(isLight(t));
      expect(d.gradient).toBe(t.group === 'gradient');
      expect(pageEnds(d), t.id).toEqual(t.bg2 ? [t.bg, t.bg2] : [t.bg]);
      expect(d.vars['--bg-app']).toBe(t.bg2 ? `linear-gradient(160deg,${t.bg},${t.bg2})` : t.bg);
    }
  });

  it('are readable with the default accent and with any story colour', () => {
    for (const t of THEMES) {
      for (const accent of ACCENTS) expectReadable(deriveTheme(t, accent), `${t.id} with story colour ${accent}`);
    }
  });

  it('use their own accent when they have one, and the story colour otherwise', () => {
    const ember = themeById('ember')!;
    expect(deriveTheme(ember, '#2bb3a3').vars['--accent']).toBe(ember.accent);
    const slate = themeById('slate')!;
    expect(deriveTheme(slate, null).vars['--accent']).toBe(DEFAULT_ACCENT);
    expect(deriveTheme(slate, '#c59bf0').vars['--accent']).toBe('#c59bf0');
    expect(deriveTheme(slate, 'not a colour').vars['--accent']).toBe(DEFAULT_ACCENT);
  });

  it('Slate is the look the player approved', () => {
    // The dark tokens of src/app/styles/slate.css (:root), which Slate must reproduce to within a shade nobody can see.
    const approved: Record<string, string> = {
      '--c-chrome': '#0e1115', '--c-pane': '#11151a', '--c-story': '#151920', '--c-card': '#1b2029', '--c-raised': '#232a35',
      '--c-track': '#2c3541', '--c-line': '#272f3a', '--c-line-strong': '#66758a', '--c-text': '#e8ecf2', '--c-text-2': '#aab5c4',
      '--c-text-3': '#8b98aa', '--accent': '#2bb3a3', '--c-accent-fill': '#2bb3a3', '--c-on-accent': '#04211d', '--c-accent-text': '#5ac4b7',
    };
    expectClose(deriveTheme(themeById('slate')!, null), approved, 2);
  });

  it('Paper is the light look as it was', () => {
    // The light tokens of src/app/styles/slate.css (:root.theme-light).
    const approved: Record<string, string> = {
      '--c-chrome': '#f5f7fa', '--c-pane': '#f0f3f6', '--c-story': '#ffffff', '--c-card': '#ffffff', '--c-raised': '#eceff4',
      '--c-track': '#dde2e9', '--c-line': '#dce1e8', '--c-line-strong': '#7b8899', '--c-text': '#161d27', '--c-text-2': '#465263',
      '--c-text-3': '#5b687a', '--accent': '#2bb3a3', '--c-accent-fill': '#1c7368', '--c-on-accent': '#ffffff', '--c-accent-text': '#18645b',
    };
    expectClose(deriveTheme(themeById('paper')!, null), approved, 1);
  });
});

function expectClose(d: Derived, approved: Record<string, string>, steps: number): void {
  for (const [k, want] of Object.entries(approved)) {
    const a = parseHex(d.vars[k]!);
    const b = parseHex(want);
    const off = Math.max(...a.map((x, i) => Math.round(Math.abs(x - b[i]!) * 255)));
    expect(off, `${k}: ${d.vars[k]} against ${want}`).toBeLessThanOrEqual(steps);
  }
}

describe('a theme of the player’s own', () => {
  const own = (bg: string, light: boolean, bg2: string | null = null, accent: string | null = null): CustomTheme => ({ bg, bg2, accent, light });

  it('brings any picked colour into the dark range or the light range', () => {
    for (const bg of HOSTILE) {
      const dark = customDef(own(bg, false));
      expect(hexToLch(dark.bg).l, `${bg} as dark`).toBeLessThanOrEqual(DARK_MAX + 0.01);
      expect(hexToLch(dark.bg).l, `${bg} as dark`).toBeGreaterThanOrEqual(DARK_MIN - 0.01);
      expect(isLight(dark)).toBe(false);
      const light = customDef(own(bg, true));
      expect(hexToLch(light.bg).l, `${bg} as light`).toBeGreaterThanOrEqual(LIGHT_MIN - 0.01);
      expect(isLight(light)).toBe(true);
    }
  });

  it('keeps the hue of the colour that was picked', () => {
    for (const bg of ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#3366cc']) {
      const hue = hexToLch(bg).h;
      for (const light of [false, true]) {
        const got = hexToLch(pageColour(bg, light));
        const off = Math.abs(((got.h - hue + 540) % 360) - 180);
        expect(off, `${bg} ${light ? 'light' : 'dark'}`).toBeLessThan(8);
        expect(got.c).toBeGreaterThan(0.02); // still clearly that colour, not grey
        expect(got.c).toBeLessThan(0.1);     // and never garish
      }
    }
  });

  it('leaves a colour that is already in range alone', () => {
    expect(pageColour('#151920', false)).toBe('#151920');
    expect(pageColour('#f6efe0', true)).toBe('#f6efe0');
    expect(pageColour('#0a0a0c', false)).toBe('#0a0a0c');
    expect(pageColour('#FFFFFF', true)).toBe('#ffffff');
  });

  it('is readable whatever was picked: hostile solids', () => {
    for (const bg of HOSTILE) {
      for (const light of [false, true]) {
        for (const accent of ACCENTS) {
          expectReadable(deriveTheme(customDef(own(bg, light, null, accent)), null), `${bg} ${light ? 'light' : 'dark'} accent ${accent}`);
        }
      }
    }
  });

  it('is readable whatever was picked: clashing gradients', () => {
    for (const [a, b] of CLASHING) {
      for (const [bg, bg2] of [[a, b], [b, a]] as const) {
        for (const light of [false, true]) {
          for (const accent of ACCENTS) {
            const d = deriveTheme(customDef(own(bg, light, bg2, accent)), '#2bb3a3');
            expect(d.gradient).toBe(true);
            expect(d.light).toBe(light);
            expectReadable(d, `${bg} to ${bg2} ${light ? 'light' : 'dark'} accent ${accent}`);
          }
        }
      }
    }
  });

  it('is readable all the way round the colour wheel', () => {
    for (let h = 0; h < 360; h += 15) {
      for (const l of [0.2, 0.5, 0.8]) {
        const bg = lchToHex({ l, c: 0.3, h });
        const accent = lchToHex({ l: 1 - l, c: 0.3, h: (h + 180) % 360 });
        for (const light of [false, true]) {
          expectReadable(deriveTheme(customDef(own(bg, light, null, accent)), null), `wheel ${bg} ${light ? 'light' : 'dark'}`);
          expectReadable(deriveTheme(customDef(own(bg, light, accent, bg)), null), `wheel gradient ${bg} ${light ? 'light' : 'dark'}`);
        }
      }
    }
  });

  it('keeps cards and lines apart from the page, even on the darkest and the lightest page', () => {
    for (const [bg, light] of [['#000000', false], ['#ffffff', false], ['#ffffff', true], ['#000000', true]] as const) {
      const v = deriveTheme(customDef(own(bg, light)), null).vars;
      expect(v['--c-line'], `${bg} ${light}`).not.toBe(v['--c-card']);
      expect(v['--c-line']).not.toBe(v['--c-story']);
      expect(v['--c-raised']).not.toBe(v['--c-card']);
      expect(v['--c-track']).not.toBe(v['--c-card']);
      if (!light) expect(v['--c-card']).not.toBe(v['--c-story']);
    }
  });

  it('is readable even when a theme is handed a page colour that is out of range', () => {
    // Not a path the app takes (custom colours go through customDef), but deriveTheme must not depend on that.
    for (const bg of ['#808080', '#5a5a5a', '#b0b0b0', '#ff0000', '#00ff00', '#ffff00']) {
      const def: ThemeDef = { id: 'x', name: 'X', group: 'gradient', bg, bg2: '#00ffff' };
      expectReadable(deriveTheme(def, null), `raw ${bg}`);
    }
  });
});

describe('choosing a theme', () => {
  const look = (over: Partial<Look> = {}): Look => ({ ...DEFAULT_LOOK, ...over });

  it('starts on Slate, with Paper as the light theme, a glow, and motion left to the device', () => {
    expect(DEFAULT_LOOK).toMatchObject({ theme: 'slate', themeDark: 'slate', themeLight: 'paper', backdrop: 'glow', motion: 'auto' });
    expect(activeTheme(DEFAULT_LOOK, true).id).toBe('slate');
  });

  it('follows the device between the last dark and the last light theme', () => {
    const l = look({ theme: 'system', themeDark: 'dusk', themeLight: 'dawn' });
    expect(activeThemeId(l, false)).toBe('dusk');
    expect(activeThemeId(l, true)).toBe('dawn');
    expect(activeTheme(look({ theme: 'custom' }), false).id).toBe('custom');
    expect(activeTheme(look({ theme: 'gone' }), false).id).toBe('slate');
  });

  it('remembers a pick as the last dark or the last light theme', () => {
    expect(chooseTheme(look(), 'dusk', false)).toEqual({ theme: 'dusk', themeDark: 'dusk' });
    expect(chooseTheme(look(), 'dawn', false)).toEqual({ theme: 'dawn', themeLight: 'dawn' });
  });

  it('keeps following the device when the pick is of the kind showing, and stops when it is not', () => {
    const following = look({ theme: 'system' });
    expect(chooseTheme(following, 'dusk', false)).toEqual({ theme: 'system', themeDark: 'dusk' });
    expect(chooseTheme(following, 'dawn', false)).toEqual({ theme: 'dawn', themeLight: 'dawn' });
    expect(chooseTheme(following, 'dawn', true)).toEqual({ theme: 'system', themeLight: 'dawn' });
  });

  it('the sun and moon button goes to the last theme of the other kind', () => {
    expect(toggleTheme(look({ theme: 'dusk', themeDark: 'dusk', themeLight: 'dawn' }), false)).toEqual({ theme: 'dawn' });
    expect(toggleTheme(look({ theme: 'dawn', themeDark: 'dusk', themeLight: 'dawn' }), false)).toEqual({ theme: 'dusk' });
    expect(toggleTheme(look({ theme: 'system', themeDark: 'dusk', themeLight: 'dawn' }), true)).toEqual({ theme: 'dusk' });
  });

  it('editing your own theme shows it, and remembers it on the right side', () => {
    const dark: CustomTheme = { bg: '#223344', bg2: null, accent: null, light: false };
    expect(chooseCustom(look(), dark, false)).toEqual({ custom: dark, theme: 'custom', themeDark: 'custom', themeLight: 'paper' });
    const light: CustomTheme = { ...dark, light: true };
    // It was the dark theme; made light, it becomes the light theme and Slate is the dark one again.
    expect(chooseCustom(look({ theme: 'custom', themeDark: 'custom' }), light, false)).toEqual({ custom: light, theme: 'custom', themeDark: 'slate', themeLight: 'custom' });
  });

  it('translates settings from before there were themes', () => {
    expect(cleanLook({ theme: 'dark' })).toEqual(DEFAULT_LOOK);
    expect(cleanLook({ theme: 'light' })).toEqual({ ...DEFAULT_LOOK, theme: 'paper' });
    expect(cleanLook({ theme: 'system' })).toEqual({ ...DEFAULT_LOOK, theme: 'system' });
    expect(cleanLook({})).toEqual(DEFAULT_LOOK);
  });

  it('falls back to Slate for a theme it does not know, and to defaults for anything malformed', () => {
    expect(cleanLook({ theme: 'neon', themeDark: 'paper', themeLight: 'slate', custom: 'red', backdrop: 'rain', motion: 5 })).toEqual(DEFAULT_LOOK);
    expect(cleanLook({ theme: 42 }).theme).toBe('slate');
    expect(cleanLook({ custom: { bg: '#ABCDEF', bg2: 'blue', accent: '#123456', light: 'yes' } }).custom).toEqual({ bg: '#abcdef', bg2: null, accent: '#123456', light: false });
  });

  it('keeps good settings as they are', () => {
    const good: Look = { theme: 'system', themeDark: 'custom', themeLight: 'dawn', custom: { bg: '#102030', bg2: '#302010', accent: null, light: false }, backdrop: 'embers', motion: 'off' };
    expect(cleanLook(good)).toEqual(good);
    const dusk = cleanLook({ theme: 'dusk' });
    expect(dusk.theme).toBe('dusk');
    expect(dusk.themeDark).toBe('dusk'); // the theme in use is the one to come back to
    // "Your own" is remembered only on the side it is on.
    expect(cleanLook({ ...good, themeLight: 'custom' }).themeLight).toBe('paper');
  });

  it('lets things move unless the setting or the device says otherwise', () => {
    expect(motionOn('auto', false)).toBe(true);
    expect(motionOn('auto', true)).toBe(false);
    expect(motionOn('on', true)).toBe(true);
    expect(motionOn('off', false)).toBe(false);
  });
});
