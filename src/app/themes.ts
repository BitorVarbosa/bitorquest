// Colour themes: a list of presets, the player's own colours, and the maths that turns one or two
// background colours into every colour role the stylesheets use (the tokens in styles/slate.css).
//
// The rule that matters: text is readable by construction. Each derived colour is checked against the
// surfaces it can sit on, and its lightness is moved until the contrast is there (WCAG 2 ratios).
// Nothing here touches the page, so all of it can be tested (tests/themes.test.ts).

import { m } from '../i18n';

export interface ThemeDef {
  id: string;
  name: string;
  group: 'solid' | 'gradient';
  /** The page colour, as "#rrggbb". Whether the theme is dark or light follows from how light this is. */
  bg: string;
  /** A gradient runs from `bg` to this. */
  bg2?: string;
  /** The theme's own accent. Without one, the open story's colour is used. */
  accent?: string;
}

/** The player's own theme, as picked: any colours at all. `customDef` makes them usable. */
export interface CustomTheme {
  bg: string;
  bg2: string | null;
  accent: string | null;
  light: boolean;
}

export type Backdrop = 'still' | 'glow' | 'embers';
export type Motion = 'auto' | 'on' | 'off';

/** The part of the app's settings that decides how it looks. */
export interface Look {
  /** 'system' (follow the device), a theme id, or 'custom'. */
  theme: string;
  /** The last dark theme chosen, and the last light one: what 'system' switches between. */
  themeDark: string;
  themeLight: string;
  custom: CustomTheme;
  backdrop: Backdrop;
  motion: Motion;
}

export interface Derived {
  light: boolean;
  gradient: boolean;
  /** CSS custom properties to set on <html>. */
  vars: Record<string, string>;
}

/** The accent when no story is open and the theme has none of its own. */
export const DEFAULT_ACCENT = '#2bb3a3';

export const THEMES: ThemeDef[] = [
  { id: 'slate', name: m('Slate'), group: 'solid', bg: '#151920' },
  { id: 'midnight', name: m('Midnight'), group: 'solid', bg: '#0f1424' },
  { id: 'onyx', name: m('Onyx'), group: 'solid', bg: '#0a0a0c' },
  { id: 'ember', name: m('Ember'), group: 'solid', bg: '#1c1512', accent: '#e8a04c' },
  { id: 'moss', name: m('Moss'), group: 'solid', bg: '#121a15', accent: '#7fc68f' },
  { id: 'plum', name: m('Plum'), group: 'solid', bg: '#1a1422', accent: '#c59bf0' },
  { id: 'garnet', name: m('Garnet'), group: 'solid', bg: '#1f1215', accent: '#f08a8a' },
  { id: 'paper', name: m('Paper'), group: 'solid', bg: '#ffffff' },
  { id: 'parchment', name: m('Parchment'), group: 'solid', bg: '#f6efe0', accent: '#a8683a' },
  { id: 'mist', name: m('Mist'), group: 'solid', bg: '#eef2f6' },
  { id: 'blossom', name: m('Blossom'), group: 'solid', bg: '#fbeff2', accent: '#d2527c' },
  { id: 'dusk', name: m('Dusk'), group: 'gradient', bg: '#1b1836', bg2: '#3a1c2e' },
  { id: 'aurora', name: m('Aurora'), group: 'gradient', bg: '#0c2226', bg2: '#1f1a3a' },
  { id: 'lantern', name: m('Lantern'), group: 'gradient', bg: '#1d1410', bg2: '#3a2610', accent: '#e8a04c' },
  { id: 'abyss', name: m('Abyss'), group: 'gradient', bg: '#0a1024', bg2: '#0c2a2e' },
  { id: 'wildfire', name: m('Wildfire'), group: 'gradient', bg: '#2a0f12', bg2: '#33200c', accent: '#f0784a' },
  { id: 'nebula', name: m('Nebula'), group: 'gradient', bg: '#1a1030', bg2: '#0f2238' },
  { id: 'dawn', name: m('Dawn'), group: 'gradient', bg: '#fde8dc', bg2: '#e6eefb' },
  { id: 'meadow', name: m('Meadow'), group: 'gradient', bg: '#eaf5e4', bg2: '#e3f1f6' },
  { id: 'sorbet', name: m('Sorbet'), group: 'gradient', bg: '#fde4ee', bg2: '#fff3d6' },
];

export const DEFAULT_CUSTOM: CustomTheme = { bg: '#20283c', bg2: null, accent: null, light: false };

export const DEFAULT_LOOK: Look = {
  theme: 'slate', themeDark: 'slate', themeLight: 'paper', custom: DEFAULT_CUSTOM, backdrop: 'glow', motion: 'auto',
};

// ---------- Colour maths: hex, sRGB, OKLab / OKLCH, and WCAG contrast ----------

/** Red, green, blue from 0 to 1, as written in a hex colour (gamma-encoded sRGB). */
export type Rgb = readonly [number, number, number];
/** OKLCH: lightness 0 to 1, chroma from 0 (grey) up, hue in degrees. */
export interface Lch { l: number; c: number; h: number }

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const toLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function isHex(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
}

/** "#rrggbb" (or "#rgb") to red, green, blue. Anything else is black. */
export function parseHex(hex: string): Rgb {
  const hit = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!hit) return [0, 0, 0];
  const s = hit[1]!.length === 3 ? hit[1]!.replace(/./g, '$&$&') : hit[1]!;
  return [parseInt(s.slice(0, 2), 16) / 255, parseInt(s.slice(2, 4), 16) / 255, parseInt(s.slice(4, 6), 16) / 255];
}

export function toHex(rgb: Rgb): string {
  return `#${rgb.map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('')}`;
}

function linearToLch(r: number, g: number, b: number): Lch {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * mm - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

function lchToLinear({ l, c, h }: Lch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l3 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m3 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s3 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ];
}

export function hexToLch(hex: string): Lch {
  const [r, g, b] = parseHex(hex);
  return linearToLch(toLinear(r), toLinear(g), toLinear(b));
}

const inGamut = (rgb: readonly number[]): boolean => rgb.every((v) => v >= -0.0005 && v <= 1.0005);

/** OKLCH to a hex colour. A colour the screen cannot show keeps its lightness and hue and loses chroma until it can. */
export function lchToHex(lch: Lch): string {
  const l = clamp(lch.l, 0, 1);
  let rgb = lchToLinear({ ...lch, l });
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = lch.c;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(lchToLinear({ l, c: mid, h: lch.h }))) lo = mid; else hi = mid;
    }
    rgb = lchToLinear({ l, c: lo, h: lch.h });
  }
  return toHex([toGamma(clamp(rgb[0], 0, 1)), toGamma(clamp(rgb[1], 0, 1)), toGamma(clamp(rgb[2], 0, 1))]);
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG contrast ratio of two colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `share` of `a` over `b`, channel by channel: what CSS color-mix(in srgb, a share, b) gives. */
export function mix(a: string, b: string, share: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  return toHex([y[0] + (x[0] - y[0]) * share, y[1] + (x[1] - y[1]) * share, y[2] + (x[2] - y[2]) * share]);
}

// ---------- From colours to tokens ----------

/** A background lighter than this (OKLCH lightness) makes a light theme. */
const LIGHT_FROM = 0.6;
/**
 * Where a page colour may sit (OKLCH lightness). Dark pages run from DARK_MIN, which the eye reads as black
 * and still leaves room for bars a shade darker, up to DARK_MAX. Light pages run from LIGHT_MIN up to white.
 */
export const DARK_MIN = 0.13;
export const DARK_MAX = 0.3;
export const LIGHT_MIN = 0.9;
/** How strong a page colour may be. Beyond this a page tires the eye and colours on it stop reading. */
const DARK_CHROMA = 0.09;
const LIGHT_CHROMA = 0.055;
/** The cool grey of Slate, used to tint a page that has no colour of its own (white). */
const HOUSE_HUE = 257;

/**
 * How see-through the backdrop's glows are at their centre, and how much more they can add up to where
 * two of them overlap. The glows are kept apart (styles/motion.css), so they only ever meet at their faint edges.
 */
export const GLOW_ALPHA = { dark: 0.11, light: 0.09 } as const;
export const GLOW_OVERLAP = 1.15;

/**
 * Colours fixed in styles/slate.css (they change with dark and light only, not with the theme) that are
 * used as text on cards: the persona hues (--p-*) and --c-gold, --c-ok, --c-err. A theme keeps its cards
 * dark or light enough for every one of them to stay readable. Keep in step with slate.css.
 */
export const FIXED_INKS = {
  dark: ['#f590b9', '#b7a6f8', '#9fb1cb', '#f2b872', '#7fc8a9', '#f08a7e', '#8fc4f0', '#efc253', '#5ec97a', '#ff8f80'],
  light: ['#b01f57', '#5f41c2', '#4a5b74', '#9a5b06', '#1d7453', '#b5382b', '#1f6aa8', '#8a6100', '#15703b', '#b3261e'],
} as const;

/** The least contrast each kind of thing must have. */
export const CONTRAST = { text: 7, quiet: 4.5, control: 3 } as const;

/** Brings any colour into the range a page can use: its hue kept, its chroma capped, its lightness clamped. */
export function pageColour(hex: string, light: boolean): string {
  const c = hexToLch(hex);
  const l = light ? clamp(c.l, LIGHT_MIN, 1) : clamp(c.l, DARK_MIN, DARK_MAX);
  const chroma = Math.min(c.c, light ? LIGHT_CHROMA : DARK_CHROMA);
  // A colour already in range is returned as it was, so a preset is shown exactly as written.
  if (Math.abs(l - c.l) < 0.004 && Math.abs(chroma - c.c) < 0.002) return toHex(parseHex(hex));
  return lchToHex({ l, c: chroma, h: c.h });
}

/** The player's own colours as a theme. Whatever was picked, the page ends up dark enough or light enough to read on. */
export function customDef(c: CustomTheme): ThemeDef {
  return {
    id: 'custom', name: m('Your own'), group: c.bg2 ? 'gradient' : 'solid',
    bg: pageColour(c.bg, c.light),
    ...(c.bg2 ? { bg2: pageColour(c.bg2, c.light) } : {}),
    ...(c.accent ? { accent: c.accent } : {}),
  };
}

export function isLight(def: ThemeDef): boolean {
  return hexToLch(def.bg).l >= LIGHT_FROM;
}

/** Halfway between two colours, measured the way the eye does (OKLab). */
function midpoint(a: Lch, b: Lch): Lch {
  const rad = Math.PI / 180;
  const x = (a.c * Math.cos(a.h * rad) + b.c * Math.cos(b.h * rad)) / 2;
  const y = (a.c * Math.sin(a.h * rad) + b.c * Math.sin(b.h * rad)) / 2;
  return { l: (a.l + b.l) / 2, c: Math.hypot(x, y), h: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360 };
}

/**
 * Moves a colour's lightness, a step at a time, until it has `target` contrast against every surface.
 * `dir` is +1 for lighter, -1 for darker. Returns null when even white or black cannot reach it.
 */
function fit(start: Lch, surfaces: readonly string[], target: number, dir: 1 | -1): string | null {
  const ok = (hex: string) => surfaces.every((s) => contrast(hex, s) >= target);
  for (let l = clamp(start.l, 0, 1); l >= 0 && l <= 1; l += dir * 0.01) {
    const hex = lchToHex({ ...start, l });
    if (ok(hex)) return hex;
  }
  const end = dir > 0 ? '#ffffff' : '#000000';
  return ok(end) ? end : null;
}

/** The darker (dir -1) or lighter (dir +1) of two colours. */
const further = (a: string, b: string, dir: 1 | -1): string => ((luminance(a) - luminance(b)) * dir >= 0 ? a : b);

function build(light: boolean, endA: Lch, endB: Lch | null, accentIn: string): Record<string, string> | null {
  const base = endB ? midpoint(endA, endB) : endA;
  // Dark surfaces step up from the page and text is light; light surfaces step down and text is dark.
  const dir: 1 | -1 = light ? -1 : 1;
  const h = light && base.c < 0.004 ? HOUSE_HUE : base.h;
  const cb = base.c;
  /** Chroma of a surface: for a quiet page a multiple of the page's own, for a strong one a small step more. */
  const tone = (k: number) => (cb < 0.015 ? cb * k : cb + (k - 1) * 0.015);
  const at = (l: number, c: number) => lchToHex({ l: clamp(l, 0, 1), c: Math.max(0, c), h });

  const a = lchToHex(endA);
  const b = endB ? lchToHex(endB) : null;
  const story = lchToHex(base);
  // The steps of lightness and chroma below were measured from the tokens the player approved: the dark set
  // of slate.css for Slate and its light set for Paper. So those two themes come out as they always were,
  // and every other theme is the same recipe from a different starting colour.
  let chrome: string, pane: string, card: string, raised: string, track: string, line: string;
  let strong0: Lch, text0: Lch, text20: Lch, text30: Lch;
  if (light) {
    chrome = at(base.l - 0.025, cb + 0.005);
    pane = at(base.l - 0.037, cb + 0.005);
    // Cards on a light page are near white whatever the page, so the fixed colours written on them keep their contrast.
    card = at(Math.max(base.l + 0.035, 0.965), cb * 0.5);
    raised = at(base.l - 0.049, cb + 0.007);
    track = at(base.l - 0.089, cb + 0.011);
    line = at(base.l - 0.092, cb + 0.011);
    strong0 = { l: 0.622, c: 0.03, h };
    text0 = { l: 0.229, c: 0.022, h };
    text20 = { l: 0.435, c: 0.032, h };
    text30 = { l: 0.513, c: 0.033, h };
  } else {
    chrome = at(base.l - 0.036, tone(0.67));
    pane = at(base.l - 0.018, tone(0.8));
    card = at(base.l + 0.031, tone(1.27));
    raised = at(base.l + 0.071, tone(1.53));
    track = at(base.l + 0.114, tone(1.67));
    line = at(base.l + 0.09, tone(1.53));
    strong0 = { l: 0.558, c: Math.min(cb * 2.47, 0.05), h };
    text0 = { l: 0.942, c: Math.min(cb * 0.6, 0.02), h };
    text20 = { l: 0.769, c: Math.min(cb * 1.67, 0.035), h };
    text30 = { l: 0.675, c: Math.min(cb * 2.07, 0.04), h };
  }

  // The fixed colours of slate.css must stay readable on a card. If they are not, the page itself has to move.
  if (!FIXED_INKS[light ? 'light' : 'dark'].every((ink) => contrast(ink, card) >= CONTRAST.quiet)) return null;

  // The accent: its hue and chroma kept, its lightness held where it shows against this kind of page.
  const acc = hexToLch(accentIn);
  const accent = lchToHex({ ...acc, l: light ? clamp(acc.l, 0.4, 0.78) : clamp(acc.l, 0.5, 0.88) });
  const tint = mix(accent, card, 0.14); // --c-accent-tint, as slate.css mixes it

  // The backdrop's glows: the accent, and for a gradient a brighter cousin of its second colour.
  const glow1 = accent;
  const glow2 = endB ? lchToHex({ l: light ? 0.74 : 0.66, c: light ? 0.12 : 0.15, h: endB.h }) : accent;
  const alpha = light ? GLOW_ALPHA.light : GLOW_ALPHA.dark;
  const lit = [a, ...(b ? [b] : [])].flatMap((page) => [glow1, glow2].map((g) => mix(g, page, Math.min(1, alpha * GLOW_OVERLAP))));

  // Everything text can sit on: bars, panes, the page (both ends of a gradient, with and without a glow), cards and chips.
  // The accent tint (a chosen option, the player's own bubble) carries every kind of text but the faintest.
  const surfaces = [chrome, pane, story, card, raised, a, ...(b ? [b] : []), ...lit];
  const tinted = [...surfaces, tint];
  const text = fit(text0, tinted, CONTRAST.text, dir);
  let text2 = fit(text20, tinted, CONTRAST.quiet, dir);
  const text3 = fit(text30, surfaces, CONTRAST.quiet, dir);
  const strong = fit(strong0, [card, story], CONTRAST.control, dir);
  const accentText = fit(hexToLch(light ? mix(accent, '#000000', 0.56) : mix(accent, '#ffffff', 0.78)), tinted, CONTRAST.quiet, dir);
  if (!text || !text2 || !text3 || !strong || !accentText) return null;
  text2 = further(text2, text3, dir); // secondary text is never fainter than tertiary text

  // A filled button: the accent, with dark or white writing on it, whichever reads. The fill moves if neither does.
  let fill = hexToLch(light ? mix(accent, '#000000', 0.64) : accent);
  const ink = lchToHex({ l: 0.225, c: Math.min(0.036, acc.c * 0.32), h: acc.h });
  const [first, second] = light ? ['#ffffff', ink] : [ink, '#ffffff'];
  let onAccent = '';
  for (let i = 0; i < 60 && !onAccent; i++) {
    const f = lchToHex(fill);
    if (contrast(first, f) >= CONTRAST.quiet) onAccent = first;
    else if (contrast(second, f) >= CONTRAST.quiet) onAccent = second;
    else fill = { ...fill, l: clamp(fill.l + dir * 0.02, 0, 1) }; // dark themes lighten the fill, light themes darken it
  }
  if (!onAccent) return null;

  return {
    '--bg-app': b ? `linear-gradient(160deg,${a},${b})` : a,
    '--c-chrome': chrome, '--c-pane': pane, '--c-story': story, '--c-card': card, '--c-raised': raised,
    '--c-track': track, '--c-line': line, '--c-line-strong': strong,
    '--c-text': text, '--c-text-2': text2, '--c-text-3': text3,
    '--accent': accent, '--c-accent-fill': lchToHex(fill), '--c-on-accent': onAccent, '--c-accent-text': accentText,
    '--fx-1': rgba(glow1, alpha), '--fx-2': rgba(glow2, alpha),
  };
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${alpha})`;
}

/**
 * Every colour token for a theme. `storyAccent` is the open story's colour, used when the theme has no
 * accent of its own. Any input gives a readable result: a page colour out of range is brought into it
 * first, and if a guarantee still cannot be met the page is made darker (or lighter) until it can.
 */
export function deriveTheme(def: ThemeDef, storyAccent: string | null): Derived {
  const light = isLight(def);
  const accent = [def.accent, storyAccent, DEFAULT_ACCENT].find(isHex) ?? DEFAULT_ACCENT;
  const endA = hexToLch(pageColour(def.bg, light));
  const endB = def.bg2 && isHex(def.bg2) ? hexToLch(pageColour(def.bg2, light)) : null;
  const move = (c: Lch, by: number): Lch => ({ ...c, l: clamp(c.l + (light ? by : -by), 0, 1) });
  for (let by = 0; by <= 0.4; by += 0.02) {
    const vars = build(light, move(endA, by), endB ? move(endB, by) : null, accent);
    if (vars) return { light, gradient: !!endB, vars };
  }
  // Not reachable: a black or a white page always passes. Kept so the function is total.
  const plain = build(light, { l: light ? 1 : 0, c: 0, h: 0 }, null, DEFAULT_ACCENT);
  return { light, gradient: false, vars: plain ?? {} };
}

// ---------- Choosing a theme ----------

export function themeById(id: string): ThemeDef | undefined {
  return THEMES.find((t) => t.id === id);
}

/** Whether a stored theme id ('custom' included) is a light theme. */
function lightId(id: string, custom: CustomTheme): boolean {
  if (id === 'custom') return custom.light;
  const def = themeById(id);
  return def ? isLight(def) : false;
}

/** The theme that is showing: the chosen one, or with 'system' the last dark or last light one, by the device. */
export function activeThemeId(look: Look, deviceLight: boolean): string {
  return look.theme === 'system' ? (deviceLight ? look.themeLight : look.themeDark) : look.theme;
}

export function activeTheme(look: Look, deviceLight: boolean): ThemeDef {
  const id = activeThemeId(look, deviceLight);
  return id === 'custom' ? customDef(look.custom) : themeById(id) ?? THEMES[0]!;
}

/**
 * The settings to change when the player picks a theme. The pick is remembered as their last dark or last
 * light theme. While the app follows the device, picking a theme of the kind the device is showing keeps
 * following it; picking the other kind stops following, so the pick always shows.
 */
export function chooseTheme(look: Look, id: string, deviceLight: boolean): Partial<Look> {
  const light = lightId(id, look.custom);
  const slot: Partial<Look> = light ? { themeLight: id } : { themeDark: id };
  return { ...slot, theme: look.theme === 'system' && light === deviceLight ? 'system' : id };
}

/** The settings to change when the player edits their own theme: it is saved, and it becomes the theme showing. */
export function chooseCustom(look: Look, custom: CustomTheme, deviceLight: boolean): Partial<Look> {
  const next: Look = { ...look, custom };
  // "Your own" changed sides: it can no longer be remembered as the theme of the side it left.
  if (custom.light && next.themeDark === 'custom') next.themeDark = DEFAULT_LOOK.themeDark;
  if (!custom.light && next.themeLight === 'custom') next.themeLight = DEFAULT_LOOK.themeLight;
  return { custom, themeDark: next.themeDark, themeLight: next.themeLight, ...chooseTheme(next, 'custom', deviceLight) };
}

/** The sun and moon button: from a dark theme to the last light one, and back. */
export function toggleTheme(look: Look, deviceLight: boolean): Partial<Look> {
  const showingLight = lightId(activeThemeId(look, deviceLight), look.custom);
  return { theme: showingLight ? look.themeDark : look.themeLight };
}

/**
 * Stored settings made safe to use: old values are translated ('dark' is Slate, 'light' is Paper), unknown
 * theme ids fall back to Slate, and anything missing or malformed takes its default.
 */
export function cleanLook(raw: { [K in keyof Look]?: unknown }): Look {
  const c = (raw.custom && typeof raw.custom === 'object' ? raw.custom : {}) as { [K in keyof CustomTheme]?: unknown };
  const custom: CustomTheme = {
    bg: isHex(c.bg) ? c.bg.toLowerCase() : DEFAULT_CUSTOM.bg,
    bg2: isHex(c.bg2) ? c.bg2.toLowerCase() : null,
    accent: isHex(c.accent) ? c.accent.toLowerCase() : null,
    light: c.light === true,
  };
  const known = (v: unknown): v is string => typeof v === 'string' && (v === 'custom' || !!themeById(v));
  const old = raw.theme === 'dark' ? 'slate' : raw.theme === 'light' ? 'paper' : raw.theme;
  const theme = old === 'system' || known(old) ? old : DEFAULT_LOOK.theme;
  let themeDark = known(raw.themeDark) && !lightId(raw.themeDark, custom) ? raw.themeDark : DEFAULT_LOOK.themeDark;
  let themeLight = known(raw.themeLight) && lightId(raw.themeLight, custom) ? raw.themeLight : DEFAULT_LOOK.themeLight;
  // Settings from before there were themes remember nothing: the theme in use is the one to remember.
  if (theme !== 'system') {
    if (lightId(theme, custom)) { if (!known(raw.themeLight)) themeLight = theme; } else if (!known(raw.themeDark)) themeDark = theme;
  }
  return {
    theme, themeDark, themeLight, custom,
    backdrop: raw.backdrop === 'still' || raw.backdrop === 'glow' || raw.backdrop === 'embers' ? raw.backdrop : DEFAULT_LOOK.backdrop,
    motion: raw.motion === 'auto' || raw.motion === 'on' || raw.motion === 'off' ? raw.motion : DEFAULT_LOOK.motion,
  };
}

/** Whether things may move: the setting, or with 'auto' the device's wish. */
export function motionOn(motion: Motion, deviceReduces: boolean): boolean {
  return motion === 'on' || (motion === 'auto' && !deviceReduces);
}
