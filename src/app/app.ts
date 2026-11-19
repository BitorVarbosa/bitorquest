// The app's state outside any one story: settings, the API key, the list of stories, what was spent.
// One object, `app`, that screens read through the useApp() hook.
import { useSyncExternalStore } from 'react';
import { clockLabel } from '../engine';
import { storyBook } from '../game/book';
import { BudgetReached, WorldBuilder, newDraft, type BuildInput, type WorldDraft } from '../game/builder';
import { proposeCharacter, startSeed, type CharacterProposal, type Described } from '../game/creation';
import { APPEARANCE_MAX, LOOK_MAX } from '../game/cards';
import type { DocState } from '../game/ingest';
import { anthropicTransport, checkKey } from '../game/llm/anthropic';
import { mockTransport } from '../game/llm/mock';
import { PRESETS, type Preset, type RoleModels } from '../game/llm/models';
import { costOf } from '../game/llm/models';
import { pictureRequest, pictureWords, type ModelChoice } from '../game/llm/requests';
import { LlmError, type Transport } from '../game/llm/transport';
import { SAVE_VERSION, SaveError, fromFile, toFile, upgrade } from '../game/save';
import { Session, type Budget, type SceneStore } from '../game/session';
import { currentScene, newStory } from '../game/story';
import type { SceneArchive, Story, StorySettings, UsageEntry, WorldTemplate } from '../game/types';
import { worldFromFile, worldToFile } from '../game/worldFile';
import { glassRoadSeed, lanternCoast, lanternCoastTemplate } from '../packs/lanternCoast';
import { hasWords, lang, setLang, t, type Lang } from '../i18n';
import { applyUpdate, install, promptInstall, startInstall } from './install';
import { BACKUP_PREFIX, db, dayKey, getKv, setKv, type SceneRow, type StoryRow, type UsageRow } from './db';
import {
  DEFAULT_LOOK, THEMES, activeTheme, chooseCustom, chooseTheme, cleanLook, deriveTheme, motionOn,
  type Backdrop, type CustomTheme, type Motion, type ThemeDef,
} from './themes';

export interface AppSettings {
  /** Where the API key is kept: in this browser's storage, or only until the tab closes. */
  keep: 'device' | 'session';
  language: 'en' | 'pt';
  /** Dollars per day. Play pauses when the day's real spending reaches it. */
  dailyCap: number;
  preset: Preset | 'custom';
  models: RoleModels;
  /** How hard the narrator thinks before writing. Higher costs more. */
  effort: 'low' | 'medium' | 'high';
  /** Show long replies passage by passage, with Continue. */
  paging: boolean;
  diceAnimation: boolean;
  /** The player throws the dice: a roll waits for them to press the die. Off: the app throws as soon as a roll is called for. */
  throwDice: boolean;
  /** The look: 'system' (follow the device), the id of a theme in themes.ts, or 'custom' (the player's own colours). */
  theme: string;
  /** The last dark theme chosen and the last light one. 'system' and the sun and moon button switch between them. */
  themeDark: string;
  themeLight: string;
  /** The player's own theme, as picked. themes.ts brings the colours into a readable range. */
  custom: CustomTheme;
  /** What moves behind the page: nothing, soft glows, or glows with rising sparks. */
  backdrop: Backdrop;
  /** Animations: on, off, or 'auto' (on unless the device asks for less motion). */
  motion: Motion;
  /** Use the demo narrator: canned text, nothing sent, nothing charged. */
  demo: boolean;
  /** The welcome screen has been completed. */
  onboarded: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  keep: 'device', language: 'en', dailyCap: 1, preset: 'balanced', models: PRESETS.balanced, effort: 'low',
  paging: true, diceAnimation: true, throwDice: true, ...DEFAULT_LOOK, demo: true, onboarded: false,
};

/**
 * Look commands for "&script=" (development and screenshots only): "theme:<id>", "light" (Paper),
 * "fx:<still|glow|embers>", "motion:<on|off>", and "custom:<bg>,<second or ->,<accent or ->[,light]" with
 * colours written without the "#", for example "custom:ff0000,00ff00,-,light".
 */
const LOOK_COMMANDS = new Set(['theme', 'light', 'fx', 'motion', 'custom']);
function devLook(st: AppSettings, cmd: string, arg: string): AppSettings {
  const hex = (v: string | undefined) => (v && /^[0-9a-f]{6}$/i.test(v) ? `#${v.toLowerCase()}` : null);
  if (cmd === 'custom') {
    const parts = arg.split(',');
    const custom: CustomTheme = { bg: hex(parts[0]) ?? st.custom.bg, bg2: hex(parts[1]), accent: hex(parts[2]), light: parts.includes('light') };
    return { ...st, ...chooseCustom(st, custom, false) };
  }
  const change = cmd === 'fx' ? { backdrop: arg } : cmd === 'motion' ? { motion: arg } : chooseTheme(st, cmd === 'light' ? 'paper' : arg, false);
  return { ...st, ...cleanLook({ ...st, ...change }) };
}

const SESSION_KEY = 'bq-key';
const LOOK_CACHE = 'bq-look';

/**
 * Put back the colours that were showing when the app was last closed. Called before anything is
 * drawn; the full theme is applied again once the settings have loaded. Colours only, nothing personal.
 */
export function restoreLook(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(LOOK_CACHE) ?? 'null') as { vars?: Record<string, string>; light?: boolean; fx?: boolean } | null;
    if (!saved?.vars) return;
    const root = document.documentElement;
    for (const [name, value] of Object.entries(saved.vars)) if (name.startsWith('--') && typeof value === 'string') root.style.setProperty(name, value);
    root.classList.toggle('theme-light', !!saved.light);
    if (saved.fx) root.dataset.fx = '1';
  } catch { /* nothing saved, or storage is unavailable */ }
}

/** Scripted turns for "?demo=1&play=N" (development and screenshots only). */
const DEV_SCRIPT = [
  'say:I look around and take stock of who is watching the bridge.',
  'say:I ask Mira what she makes of the Watch.',
  'say:I try to bluff my way past Captain Roth with a straight face.',
  'say:I sit with Mira for a while, away from the others.',
  'say:I search the stalls for anything out of place.',
  'go:guild_house',
  'say:I ask around the common room for news.',
  'go:lantern_market',
  'say:I listen in on the talk by the fry stall.',
];

/** Where a story stands, in a line: "Chapter 2, “Borrowed Seals” · Scene 4 · Lantern Market, dusk". Worded when it is drawn, so that it follows the language of the interface. */
export function whereOf(story: Story): string {
  const scene = currentScene(story);
  return t('Chapter {n}, “{title}” · Scene {scene} · {place}, {time}', {
    n: story.chapter.n, title: story.chapter.title, scene: scene.n, place: story.world.places[scene.placeId]?.name ?? '',
    time: clockLabel(story.clock, lang()).split(' · ')[1]?.toLowerCase() ?? '',
  });
}

function rowOf(story: Story): StoryRow {
  return {
    id: story.id, title: story.title, world: story.world.name, accent: story.world.accent, lastPlayed: story.lastPlayed,
    turns: story.totals.turns, cost: story.totals.cost, where: whereOf(story), data: story,
  };
}

class App {
  ready = false;
  settings: AppSettings = DEFAULT_SETTINGS;
  apiKey: string | null = null;
  /** Model ids the key can use, as reported by the API when the key was last checked. */
  available: string[] = [];
  stories: StoryRow[] = [];
  /** The worlds library, newest first, and the worlds still being built. */
  worlds: WorldTemplate[] = [];
  drafts: WorldDraft[] = [];
  usage: UsageRow[] = [];
  session: Session | null = null;
  /** What the open story had cost when it was opened, to show "this session". */
  costAtOpen = 0;

  /** A development run ("?demo=1"): everything stays in memory and nothing is written to this device. */
  private sandbox = false;
  private version = 0;
  private listeners = new Set<() => void>();
  private unsubSession: (() => void) | null = null;
  private real: { key: string; transport: Transport } | null = null;
  private demo: Transport | null = null;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };
  snapshot = (): number => this.version;
  bump(): void {
    this.version += 1;
    for (const fn of this.listeners) fn();
  }

  /** The app as something installed: see install.ts. */
  readonly install = install;
  askInstall(): Promise<boolean> { return promptInstall(() => this.bump()); }
  applyUpdate(): void { applyUpdate(); }

  async init(): Promise<void> {
    startInstall(() => this.bump());
    try {
      if (navigator.storage?.persist) void navigator.storage.persist();
      const kept = await getKv<Partial<AppSettings>>('settings', {});
      // On a first run the interface takes the device's language, where that is Portuguese.
      const first: Partial<AppSettings> = kept.language ? {} : { language: /^pt\b/i.test(navigator.language ?? '') ? 'pt' : 'en' };
      this.settings = { ...DEFAULT_SETTINGS, ...first, ...kept };
      await this.useLanguage(this.settings.language);
      // Settings saved by an earlier version: 'dark' becomes Slate, 'light' becomes Paper, an unknown theme falls back to Slate.
      this.settings = { ...this.settings, ...cleanLook(this.settings) };
      const stored = this.settings.keep === 'device' ? await getKv<string | null>('apiKey', null) : sessionStorage.getItem(SESSION_KEY);
      this.apiKey = stored || null;
      this.available = await getKv<string[]>('models', []);
      this.stories = (await db.stories.toArray()).sort((a, b) => b.lastPlayed - a.lastPlayed);
      this.worlds = (await db.worlds.toArray()).sort((a, b) => b.built - a.built);
      this.drafts = (await db.drafts.toArray()).sort((a, b) => b.updated - a.updated);
      this.usage = await db.usage.toArray();
    } catch {
      // Storage is unavailable (private window, blocked): the app still runs, without saving.
    }
    // For development and screenshots: "?demo=1" skips the welcome screen, uses the demo narrator and
    // opens a fresh copy of the sample story. It is a sandbox: nothing it does is saved, so the
    // stories, settings and key kept on this device are exactly as they were when the page is closed.
    const dev = new URLSearchParams(location.search);
    if (dev.has('demo')) {
      this.sandbox = true;
      this.settings = { ...this.settings, onboarded: true, demo: true };
      // "&lang=pt" shows the interface in Portuguese ("&lang=en" in English), whatever the device is set to.
      if (dev.get('lang') === 'pt' || dev.get('lang') === 'en') { this.settings.language = dev.get('lang') as Lang; await this.useLanguage(this.settings.language); }
      else if (this.settings.language !== 'en') { this.settings.language = 'en'; await this.useLanguage('en'); }
      if (dev.has('play') || dev.has('world')) this.demo = mockTransport({ streamDelay: 0 });
      this.stories = [];
      this.worlds = [];
      this.drafts = [];
      this.usage = [];
      if (dev.has('world')) await this.devWorld(dev);
      if (!dev.has('world') || dev.has('play')) this.createStory();
      // "&play=6" plays that many scripted turns first, so screens have something to show.
      const turns = Math.min(40, Number(dev.get('play')) || 0);
      const s = this.session;
      // "&script=go:canal_bridge|say:I draw my blade|atk|def" runs those steps after the scripted turns.
      const steps = [...Array.from({ length: turns }, (_, i) => DEV_SCRIPT[i % DEV_SCRIPT.length]!), ...(dev.get('script') ?? '').split('|').filter(Boolean)];
      for (const step of steps) {
        if (!s) break;
        const [cmd = '', arg = ''] = step.includes(':') ? [step.slice(0, step.indexOf(':')), step.slice(step.indexOf(':') + 1)] : [step, ''];
        const foe = s.combat ? Object.values(s.combat.fighters).find((f) => f.side === 'foe' && f.fights && !f.fled && f.hp > 0) : undefined;
        if (cmd === 'ask') await s.ask(arg);
        else if (cmd === 'go') await s.travel(arg);
        else if (cmd === 'say') await s.submit(arg);
        else if (cmd === 'atk' && foe) await s.combatAct({ type: 'attack', target: foe.id });
        else if (cmd === 'def') await s.combatAct({ type: 'defend' });
        else if (cmd === 'flee') await s.combatAct({ type: 'flee' });
        else if (cmd === 'down') await s.chooseDown(arg === 'test' ? 'test' : 'destiny');
        else if (cmd === 'hp') { s.story.protagonist.sheet.hp = Number(arg) || 1; }
        // "days:3" lets three days pass; "luck:1" makes the world's own dice always come up 1 (so that what is in motion moves when it is due).
        else if (cmd === 'days') { s.story.clock = { ...s.story.clock, day: s.story.clock.day + (Number(arg) || 1) }; continue; }
        else if (cmd === 'luck') { s.story.worldDice = { state: 0, faces: [Number(arg) || 1] } as Story['worldDice']; continue; }
        else if (cmd === 'fail') (this.transport() as ReturnType<typeof mockTransport>).options.failNext = new LlmError(arg === 'rate' ? 'rate' : arg === 'offline' ? 'offline' : arg === 'key' ? 'auth' : 'overloaded', 'Simulated for a screenshot.', arg === 'rate' ? 429 : arg === 'key' ? 401 : arg === 'offline' ? null : 529, arg === 'rate' ? 20 : null);
        else if (cmd === 'cap') this.settings = { ...this.settings, dailyCap: Number(arg) || 0 };
        else if (LOOK_COMMANDS.has(cmd)) { this.settings = devLook(this.settings, cmd, arg); continue; }
        if (cmd !== 'keep') s.showAll();
        if (cmd === 'keep' && s.lastTurn) s.shown = 1;
      }
      if (import.meta.env.DEV) (window as unknown as { bq: App }).bq = this;
    }
    this.applyTheme();
    this.ready = true;
    this.bump();
  }

  // ---------- Settings and key ----------

  /**
   * Put the interface in a language. The Portuguese words are a file of their own, fetched the first
   * time they are needed: for a Portuguese interface, and for what the game writes into a Portuguese story.
   */
  async useLanguage(l: Lang): Promise<void> {
    if (!hasWords()) await import('../i18n/pt').catch(() => { /* the interface stays in English */ });
    setLang(l);
    if (typeof document !== 'undefined') document.documentElement.lang = l === 'pt' ? 'pt-BR' : 'en';
    this.bump();
  }

  setSettings(patch: Partial<AppSettings>): void {
    if (patch.language && patch.language !== this.settings.language) void this.useLanguage(patch.language);
    this.settings = { ...this.settings, ...patch };
    if (patch.preset && patch.preset !== 'custom') this.settings.models = PRESETS[patch.preset];
    if (!this.sandbox) void setKv('settings', this.settings).catch(() => {});
    this.applyTheme();
    this.bump();
  }

  /** The look that is showing, for the screens that draw from it (the backdrop, the Look settings, the sun and moon button). */
  look: { theme: ThemeDef; light: boolean; gradient: boolean; motion: boolean; deviceLight: boolean; deviceCalm: boolean } =
    { theme: THEMES[0]!, light: false, gradient: false, motion: true, deviceLight: false, deviceCalm: false };
  private lookKey = '';
  private watchingDevice = false;

  /**
   * Writes the look to <html>:
   * - the theme's colours as CSS variables (the colour roles of slate.css, --bg-app for the page, --fx-1 and --fx-2 for the backdrop);
   * - class "theme-light" on a light theme, which switches the colours that stay in slate.css;
   * - data-motion="on" or "off": the one switch every animation and transition is gated by;
   * - data-fx="1" when the page shows through the bars and panes (a gradient theme, or a backdrop that is not still).
   * A theme's own accent wins; otherwise the open story's colour is used. Call it again whenever a story opens or closes.
   */
  applyTheme(): void {
    const root = document.documentElement;
    const st = this.settings;
    const device = (query: string) => !!window.matchMedia?.(query).matches;
    if (!this.watchingDevice && window.matchMedia) {
      // The device going dark or light, or starting or ceasing to ask for less motion, changes the look at once.
      this.watchingDevice = true;
      for (const query of ['(prefers-color-scheme: light)', '(prefers-reduced-motion: reduce)']) {
        window.matchMedia(query).addEventListener?.('change', () => { this.applyTheme(); this.bump(); });
      }
    }
    const deviceLight = device('(prefers-color-scheme: light)');
    const deviceCalm = device('(prefers-reduced-motion: reduce)');
    const accent = this.session?.story.world.accent ?? null;
    const key = JSON.stringify([st.theme, st.themeDark, st.themeLight, st.custom, st.backdrop, st.motion, accent, deviceLight, deviceCalm]);
    if (key === this.lookKey) return;
    this.lookKey = key;
    const theme = activeTheme(st, deviceLight);
    const derived = deriveTheme(theme, accent);
    for (const [name, value] of Object.entries(derived.vars)) root.style.setProperty(name, value);
    root.classList.toggle('theme-light', derived.light);
    const motion = motionOn(st.motion, deviceCalm);
    root.dataset.motion = motion ? 'on' : 'off';
    if (derived.gradient || st.backdrop !== 'still') root.dataset.fx = '1';
    else delete root.dataset.fx;
    this.look = { theme, light: derived.light, gradient: derived.gradient, motion, deviceLight, deviceCalm };
    // Remember the look where it can be read at once on the next start (settings load a moment later),
    // so a light or coloured theme does not open with a flash of the default dark one.
    if (!this.sandbox) {
      try { localStorage.setItem(LOOK_CACHE, JSON.stringify({ vars: derived.vars, light: derived.light, fx: root.dataset.fx === '1' })); } catch { /* storage is unavailable: the look still applies, a little later */ }
    }
  }

  /** Check a key with Anthropic (free: it lists models) and keep it. Throws an LlmError when the key is rejected. */
  async useKey(key: string, keep: AppSettings['keep']): Promise<string[]> {
    const ids = await checkKey(key.trim());
    this.apiKey = key.trim();
    this.available = ids;
    this.real = null;
    if (!this.sandbox) {
      sessionStorage.removeItem(SESSION_KEY);
      await db.kv.delete('apiKey').catch(() => {});
      if (keep === 'device') await setKv('apiKey', this.apiKey).catch(() => {});
      else sessionStorage.setItem(SESSION_KEY, this.apiKey);
      void setKv('models', ids).catch(() => {});
    }
    this.setSettings({ keep, demo: false });
    return ids;
  }

  async removeKey(): Promise<void> {
    this.apiKey = null;
    this.real = null;
    if (!this.sandbox) {
      sessionStorage.removeItem(SESSION_KEY);
      await db.kv.delete('apiKey').catch(() => {});
    }
    this.setSettings({ demo: true });
  }

  /** True when turns are answered by the demo narrator: either chosen, or there is no key. */
  get usingDemo(): boolean { return this.settings.demo || !this.apiKey; }

  transport(): Transport {
    if (this.usingDemo || !this.apiKey) {
      this.demo ??= mockTransport({ streamDelay: 16 });
      return this.demo;
    }
    if (this.real?.key !== this.apiKey) this.real = { key: this.apiKey, transport: anthropicTransport(this.apiKey) };
    return this.real.transport;
  }

  models(): ModelChoice {
    return { ...this.settings.models, effort: this.settings.effort };
  }

  // ---------- Spending ----------

  /** Real dollars charged today. Demo turns are estimates and never count against the limit. */
  spentToday(): number {
    const today = dayKey(Date.now());
    let sum = 0;
    for (const u of this.usage) if (u.day === today && !u.simulated) sum += u.cost;
    return sum;
  }

  private budget: Budget = {
    spentToday: () => this.spentToday(),
    cap: () => this.settings.dailyCap,
    record: (entry: UsageEntry, storyId: string) => {
      const row: UsageRow = { ...entry, storyId, day: dayKey(entry.at) };
      this.usage.push(row);
      if (!this.sandbox) void db.usage.add(row).catch(() => {});
    },
  };

  // ---------- Stories ----------

  private attach(story: Story, claim = true): Session {
    this.unsubSession?.();
    const session = new Session(story, {
      // Looked up on every call, so a change of key, model or mode in Settings applies to the next turn.
      transport: { get simulated() { return app.transport().simulated; }, send: (req, o) => app.transport().send(req, o) },
      models: () => this.models(),
      budget: this.budget,
      save: (s) => this.saveStory(s),
      now: () => Date.now(),
      paging: () => this.settings.paging,
      scenes: this.sceneStore,
    });
    this.session = session;
    this.costAtOpen = story.totals.cost;
    this.unsubSession = session.subscribe(() => this.bump());
    this.applyTheme(); // the story's colour is the accent, unless the theme has its own
    if (claim) void this.claim(session);
    return session;
  }

  // One window per story. Two windows playing the same story would each save over the other's turns.
  // A window holds a lock (kept by the browser, released when the window closes) for the story it has
  // open; a second window that opens the same story is told so and cannot play it until the first lets go.

  private releaseStory: (() => void) | null = null;
  private letGo(): void {
    const release = this.releaseStory;
    this.releaseStory = null;
    release?.();
  }

  /** Take the story for this window, or hold the session if another window has it. */
  private async claim(session: Session): Promise<void> {
    this.letGo();
    if (this.sandbox || typeof navigator === 'undefined' || !navigator.locks) return;
    const id = session.story.id;
    const got = await new Promise<boolean>((answer) => {
      void navigator.locks.request(`bitor-quest:story:${id}`, { ifAvailable: true }, (lock) => {
        if (!lock) { answer(false); return undefined; }
        return new Promise<void>((release) => { this.releaseStory = release; answer(true); });
      }).catch(() => answer(true)); // locks are not usable here: carry on without the guard
    });
    if (this.session !== session) {
      // The story was closed, or another one opened, while the browser was answering.
      if (got && this.session?.story.id !== id) this.letGo();
      return;
    }
    if (!got) { session.holdElsewhere(); return; }
    // This window has the story. If another window played it since this one last read storage, what
    // is in memory here is old: read it again, so that nothing played there is saved over.
    try {
      const row = await db.stories.get(id);
      if (row && this.session === session && !session.busy && row.data.lastPlayed > session.story.lastPlayed && row.data.version === SAVE_VERSION) {
        this.stories = [row, ...this.stories.filter((s) => s.id !== id)];
        this.attach(structuredClone(row.data), false); // this window already holds the story: no need to ask again
        this.bump();
      }
    } catch { /* storage could not be read: what is in memory is the best there is */ }
  }

  /** "Try again" on a story that was open in another window: take it if it is free now. */
  async reclaimStory(): Promise<void> {
    const session = this.session;
    if (session?.blocker?.kind !== 'elsewhere') return;
    const id = session.story.id;
    this.closeStory();
    try {
      // Whatever the other window played is in storage: start from that.
      const row = await db.stories.get(id);
      if (row) this.stories = [row, ...this.stories.filter((s) => s.id !== id)];
    } catch { /* fall back to what the list has */ }
    this.openStory(id);
  }

  // Saving. A story is written as its present state (one row, after every turn) and the transcripts of
  // its finished scenes (one row each, once). Both go out together, in one transaction, so storage
  // never holds a story that points at a transcript that was not written.

  /** Set when the last attempt to save did not go through. Shown on every screen until a save succeeds. */
  saveProblem: string | null = null;
  /** Why the last story that was asked for could not be opened or read. */
  openProblem: string | null = null;
  /** A sandbox run keeps scene transcripts here: "<story id>/<scene id>". */
  private memoryScenes = new Map<string, SceneArchive>();
  /** Transcripts handed over by the session since the last save, and scenes to forget. */
  private pendingScenes: SceneRow[] = [];
  private pendingDrops: [string, string][] = [];

  private sceneStore: SceneStore = {
    put: (storyId, scene) => {
      const copy = structuredClone(scene);
      if (this.sandbox) this.memoryScenes.set(`${storyId}/${scene.sceneId}`, copy);
      else this.pendingScenes.push({ storyId, ...copy });
    },
    get: async (storyId, sceneId) => {
      if (this.sandbox) return structuredClone(this.memoryScenes.get(`${storyId}/${sceneId}`) ?? null);
      // Something handed over and not written yet is the newest there is.
      const waiting = [...this.pendingScenes].reverse().find((r) => r.storyId === storyId && r.sceneId === sceneId);
      const row = waiting ?? (await db.scenes.get([storyId, sceneId]));
      if (!row) return null;
      const { storyId: _story, ...scene } = row;
      return structuredClone(scene);
    },
    drop: (storyId, sceneIds) => {
      if (this.sandbox) { for (const id of sceneIds) this.memoryScenes.delete(`${storyId}/${id}`); return; }
      const gone = new Set(sceneIds);
      this.pendingScenes = this.pendingScenes.filter((r) => !(r.storyId === storyId && gone.has(r.sceneId)));
      this.pendingDrops.push(...sceneIds.map((id): [string, string] => [storyId, id]));
    },
  };

  /** Every scene transcript kept for a story. */
  private async scenesOf(storyId: string): Promise<SceneArchive[]> {
    if (this.sandbox) {
      return [...this.memoryScenes.entries()].filter(([k]) => k.startsWith(`${storyId}/`)).map(([, a]) => structuredClone(a));
    }
    await this.writing;
    const rows = await db.scenes.where('storyId').equals(storyId).toArray();
    return rows.map(({ storyId: _story, ...scene }) => scene);
  }

  /** Saves happen one after another, in the order they were asked for. */
  private writing: Promise<void> = Promise.resolve();

  private saveStory(story: Story): void {
    // A copy, taken now: what is written is the story as it stands at this moment, whatever happens next.
    const row = rowOf(structuredClone(story));
    this.stories = [row, ...this.stories.filter((s) => s.id !== row.id)];
    if (this.sandbox) return;
    const scenes = this.pendingScenes;
    const drops = this.pendingDrops;
    this.pendingScenes = [];
    this.pendingDrops = [];
    this.writing = this.writing.then(() => db.transaction('rw', db.stories, db.scenes, async () => {
      if (drops.length) await db.scenes.bulkDelete(drops);
      if (scenes.length) await db.scenes.bulkPut(scenes);
      await db.stories.put(row);
    })).then(
      () => { if (this.saveProblem) { this.saveProblem = null; this.bump(); } },
      (err: unknown) => {
        // Nothing is thrown away: what could not be written is tried again with the next save.
        this.pendingScenes = [...scenes, ...this.pendingScenes];
        this.pendingDrops = [...drops, ...this.pendingDrops];
        const full = err instanceof Error && /quota/i.test(`${err.name} ${err.message}`);
        this.saveProblem = full
          ? t('This device has no room left to save the story. Free some space, or export the story to a file so it is not lost.')
          : t('The story could not be saved on this device. Keep this page open and export the story to a file so it is not lost.');
        this.bump();
      },
    );
  }

  private freeId(base: string): string {
    const taken = new Set(this.stories.map((s) => s.id));
    const stem = base.replace(/-\d+$/, '');
    let id = base;
    for (let i = 2; taken.has(id); i++) id = `${stem}-${i}`;
    return id;
  }

  // ---------- Worlds ----------

  /** The hand-made world that comes with the app. It is shown in the library and holds one ready-made story. */
  readonly sample = { id: lanternCoast.id, world: lanternCoast, story: 'The Glass Road' };

  /** The builders at work, by the id of their draft. A build goes on when its screen is left, for as long as the app is open. */
  private builders = new Map<string, WorldBuilder>();
  /** Drafts that were deleted: a build still finishing its step must not bring one back. */
  private goneDrafts = new Set<string>();

  private newId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`;
  }

  private saveDraft(draft: WorldDraft): void {
    if (this.goneDrafts.has(draft.id)) return;
    const copy = structuredClone(draft);
    this.drafts = [copy, ...this.drafts.filter((d) => d.id !== copy.id)];
    if (!this.sandbox) void db.drafts.put(copy).catch(() => {});
    this.bump();
  }

  private builderOf(draft: WorldDraft): WorldBuilder {
    const builder = new WorldBuilder(draft, {
      transport: { get simulated() { return app.transport().simulated; }, send: (req, o) => app.transport().send(req, o) },
      models: () => this.models(),
      budget: this.budget,
      save: (d) => this.saveDraft(d),
      now: () => Date.now(),
    });
    builder.subscribe(() => this.bump());
    this.builders.set(draft.id, builder);
    return builder;
  }

  /** Begin a new world from what the player has said so far. Nothing is asked of Claude yet. */
  startDraft(input: BuildInput, id = this.newId('w'), document?: DocState): WorldBuilder {
    const draft = newDraft(id, input, Date.now(), document);
    this.saveDraft(draft);
    return this.builderOf(draft);
  }

  /** The builder for a world in progress, or null when there is no such draft. */
  builderFor(id: string): WorldBuilder | null {
    const running = this.builders.get(id);
    if (running) return running;
    const stored = this.drafts.find((d) => d.id === id);
    return stored ? this.builderOf(structuredClone(stored)) : null;
  }

  /** True while a step of that world is being asked for. */
  isBuilding(id: string): boolean { return !!this.builders.get(id)?.busy; }

  removeDraft(id: string): void {
    this.goneDrafts.add(id);
    this.builders.delete(id);
    this.drafts = this.drafts.filter((d) => d.id !== id);
    if (!this.sandbox) void db.drafts.delete(id).catch(() => {});
    this.bump();
  }

  private putWorld(template: WorldTemplate): void {
    const copy = structuredClone(template);
    this.worlds = [copy, ...this.worlds.filter((w) => w.id !== copy.id)];
    if (!this.sandbox) void db.worlds.put(copy).catch(() => {});
  }

  /** Accept a finished draft: it becomes a world in the library and stops being a draft. Null when it is not ready. */
  acceptWorld(draftId: string): WorldTemplate | null {
    const template = this.builderFor(draftId)?.accept() ?? null;
    if (!template) return null;
    this.putWorld(template);
    this.removeDraft(draftId);
    return template;
  }

  renameWorld(id: string, name: string): void {
    const world = this.worlds.find((w) => w.id === id);
    const clean = name.trim().slice(0, 48);
    if (!world || !clean || clean === world.world.name) return;
    const next = structuredClone(world);
    // The outermost place carries the world's name too.
    for (const p of Object.values(next.world.places)) if (p.parent === null && p.name === next.world.name) p.name = clean;
    next.world.name = clean;
    this.putWorld(next);
    this.bump();
  }

  removeWorld(id: string): void {
    this.worlds = this.worlds.filter((w) => w.id !== id);
    if (!this.sandbox) void db.worlds.delete(id).catch(() => {});
    this.bump();
  }

  /** A world as the text of a file. */
  exportWorld(id: string): string | null {
    const world = this.worlds.find((w) => w.id === id);
    return world ? worldToFile(world, Date.now()) : null;
  }

  /** Read a world file into the library. Returns the new world's id, or the reason it could not be read. */
  importWorld(text: string): { id: string } | { problem: string } {
    try {
      const template = worldFromFile(text);
      template.id = this.newId('w');
      template.world.id = template.id;
      this.putWorld(template);
      this.bump();
      return { id: template.id };
    } catch (err) {
      return { problem: err instanceof SaveError ? err.message : t('That file could not be read.') };
    }
  }

  /** A world a story can be started in: one from the library, or the sample world as a newcomer finds it. */
  template(worldId: string): WorldTemplate | undefined {
    if (worldId === this.sample.id) return (this.sampleTemplate ??= lanternCoastTemplate());
    return this.worlds.find((w) => w.id === worldId);
  }
  private sampleTemplate: WorldTemplate | null = null;

  /** The stories that were started in a world. */
  storiesIn(worldId: string): StoryRow[] {
    return this.stories.filter((s) => s.data.world.id === worldId);
  }

  /** Ask for a character that fits the premise (one small request). Throws when it cannot be asked for. */
  async proposeCharacter(worldId: string, who: { premise: string; name: string }): Promise<CharacterProposal> {
    const template = this.template(worldId);
    if (!template) throw new Error(t('That world is not in the library.'));
    const { proposal } = await proposeCharacter(template.world, who, {
      transport: { get simulated() { return app.transport().simulated; }, send: (req, o) => app.transport().send(req, o) },
      models: () => this.models(), budget: this.budget, now: () => Date.now(),
    }, `world:${worldId}`);
    this.bump();
    return proposal;
  }

  /**
   * Start a story in a world with a character, and have the narrator open its first scene. Returns
   * the session, or the reason the story could not be started.
   */
  startStory(worldId: string, character: Pick<CharacterProposal, 'draft' | 'carrying'> & { look?: string; appearance?: string; companions?: Record<string, Described> }, opts: { title?: string; settings?: Partial<StorySettings>; legends?: string[] } = {}): Session | { problem: string } {
    const template = this.template(worldId);
    if (!template) return { problem: t('That world is not in the library.') };
    try {
      const title = (opts.title ?? template.opening.title).trim() || template.world.name;
      const stem = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'story';
      const seed = startSeed(template, character, { id: this.freeId(stem), seed: (Date.now() % 2_000_000_000) + 1, title, ...(opts.settings ? { settings: opts.settings } : {}), ...(opts.legends?.length ? { legends: opts.legends } : {}) });
      const story = newStory(seed, Date.now());
      this.saveStory(story);
      const session = this.attach(story);
      void session.begin();
      this.bump();
      return session;
    } catch (err) {
      return { problem: err instanceof Error ? err.message : t('The story could not be started.') };
    }
  }

  /**
   * For development and screenshots: "?demo=1&world=…" puts a demo world on the screen without clicking
   * through the builder. "world=ok" a finished world in the library; "world=review" built and waiting to
   * be accepted; "world=3" paused after three steps; "world=0" nothing built yet; "world=fail" a step
   * that failed. "&ask=1" asks the questions first. "&hero=1" (with world=ok) also starts a story in it.
   * The draft, and the world it becomes, have the id "w-demo".
   */
  private async devWorld(dev: URLSearchParams): Promise<void> {
    const want = dev.get('world') ?? 'ok';
    const builder = this.startDraft({
      source: { kind: 'description', text: 'A mining valley where the ore is running out and nobody will say so.\nA company that owns the pits, a lodge that digs them, and a baron who wants soldiers.\nKeep it close to the ground: work, debt, loyalty. Something old under the hill.' },
      premise: 'A clerk of the Miners’ Lodge who notices that the numbers do not add up.',
      name: 'Robin',
      table: { style: 'adventure', powers: dev.get('powers') === 'off' ? 'off' : dev.get('powers') === 'extreme' ? 'extreme' : dev.get('powers') === 'gift' ? 'gift' : 'focus', companions: 2, romance: true, violence: 'moderate', leaveOut: '', language: 'en', narration: 'medium' },
    }, 'w-demo');
    if (dev.has('ask')) await builder.ask();
    const steps = want === 'ok' || want === 'review' ? 7 : want === 'fail' ? 2 : Math.max(0, Math.min(7, Number(want) || 0));
    if (steps > 0) {
      const off = builder.subscribe(() => { if (steps < 7 && builder.busy && Object.keys(builder.draft.steps).length >= steps - 1) builder.pause(); });
      await builder.build();
      off();
    }
    if (want === 'fail') {
      (this.transport() as ReturnType<typeof mockTransport>).options.failNext = new LlmError('overloaded', 'Anthropic’s service is busy or failed.', 529);
      await builder.build();
    }
    if (want !== 'ok') return;
    const world = this.acceptWorld('w-demo');
    if (!world || !dev.has('hero')) return;
    const proposal = await this.proposeCharacter(world.id, { premise: world.premise, name: 'Robin' });
    const session = this.startStory(world.id, proposal);
    if (session instanceof Session) {
      await new Promise((r) => setTimeout(r, 0));
      while (session.busy) await new Promise((r) => setTimeout(r, 10));
      session.showAll();
    }
  }

  /** Start "The Glass Road" in the sample world, picked up on its twelfth day. */
  createStory(): Session {
    const seed = glassRoadSeed();
    const id = this.freeId(seed.id);
    const story = newStory({ ...seed, id, seed: (Date.now() % 2_000_000_000) + 1 }, Date.now());
    if (id !== seed.id) story.title = `${seed.title} (${id.split('-').pop()})`;
    this.saveStory(story);
    const session = this.attach(story);
    this.bump();
    return session;
  }

  openStory(id: string): Session | null {
    if (this.session?.story.id === id) return this.session;
    const row = this.stories.find((s) => s.id === id);
    if (!row) return null;
    this.openProblem = null;
    let story: Story;
    if (row.data.version === SAVE_VERSION) story = structuredClone(row.data);
    else {
      // A story the storage upgrade could not bring up to date is tried once more here, and refused with the reason.
      try {
        const loaded = upgrade(row.data);
        for (const a of loaded.scenes) this.sceneStore.put(id, a);
        story = loaded.story;
        this.saveStory(story);
      } catch (err) {
        this.openProblem = err instanceof Error ? err.message : t('This story cannot be opened.');
        this.bump();
        return null;
      }
    }
    const session = this.attach(story);
    this.bump();
    return session;
  }

  closeStory(): void {
    this.unsubSession?.();
    this.unsubSession = null;
    this.letGo();
    this.session = null;
    this.applyTheme();
    this.bump();
  }

  async removeStory(id: string): Promise<void> {
    if (this.session?.story.id === id) this.closeStory();
    this.stories = this.stories.filter((s) => s.id !== id);
    for (const key of [...this.memoryScenes.keys()]) if (key.startsWith(`${id}/`)) this.memoryScenes.delete(key);
    this.pendingScenes = this.pendingScenes.filter((r) => r.storyId !== id);
    if (!this.sandbox) {
      await this.writing;
      await db.transaction('rw', db.stories, db.scenes, db.kv, async () => {
        await db.scenes.where('storyId').equals(id).delete();
        await db.stories.delete(id);
        await db.kv.delete(`${BACKUP_PREFIX}${id}`);
      }).catch(() => {});
    }
    this.bump();
  }

  /** The story as it stands now: the open session's, or the one in the list. */
  private storyNow(id: string): Story | null {
    return this.session?.story.id === id ? this.session.story : this.stories.find((s) => s.id === id)?.data ?? null;
  }

  renameStory(id: string, title: string): void {
    const name = title.trim().slice(0, 80);
    const story = this.storyNow(id);
    if (!story || !name || name === story.title) return;
    story.title = name;
    this.saveStory(story);
    this.bump();
  }

  /** A second copy of a story, to play another way from the same point. Returns its id. */
  async duplicateStory(id: string, title?: string): Promise<string | null> {
    const source = this.storyNow(id);
    if (!source) return null;
    try {
      const scenes = await this.scenesOf(id);
      const copy = structuredClone(source);
      copy.id = this.freeId(id);
      copy.title = (title ?? t('{title} (copy)', { title: source.title })).slice(0, 80);
      copy.created = Date.now();
      for (const a of scenes) this.sceneStore.put(copy.id, a);
      this.saveStory(copy);
      // Keep the list in the order of play: the copy is not "the last one played".
      const row = this.stories.find((s) => s.id === id);
      if (row) this.stories = [row, ...this.stories.filter((s) => s.id !== id)];
      this.bump();
      return copy.id;
    } catch {
      return null;
    }
  }

  /**
   * Take the open story back to just after turn `keep` (see Session.rewindTo). The story as it is
   * now is kept first, as a separate copy in the list, so nothing is lost. Returns the copy's title,
   * or null when the story could not be taken back (it is then exactly as it was, and no copy is left behind).
   */
  async rewindStory(keep: number): Promise<string | null> {
    const session = this.session;
    if (!session || !session.canRewind) return null;
    const story = session.story;
    const title = t('{title} (before rewinding, turn {n})', { title: story.title, n: story.totals.turns }).slice(0, 80);
    const copyId = await this.duplicateStory(story.id, title);
    if (!copyId) return null;
    if (!(await session.rewindTo(keep))) {
      await this.removeStory(copyId);
      return null;
    }
    this.costAtOpen = Math.min(this.costAtOpen, session.story.totals.cost);
    this.bump();
    return title;
  }

  /** A story as a book: one HTML file, told from its first scene to its last (see game/book.ts). Null when it could not be put together. */
  async bookOf(id: string): Promise<string | null> {
    const story = this.storyNow(id);
    if (!story) return null;
    try {
      return storyBook(story, await this.scenesOf(id));
    } catch {
      return null;
    }
  }

  /**
   * Put a picture the player attached into words: one small request on the cheapest model, once. The
   * picture is sent and then forgotten: it is never kept on the device or anywhere else, only the words
   * that come back are. Throws BudgetReached at the daily limit, and the transport's error otherwise.
   */
  /** A picture of a companion put into words, once, on the cheapest model: how they look at a glance, and in full. The picture is not kept. */
  async describePicture(picture: { data: string; mediaType: 'image/jpeg' }, who: string, note: string, language: 'en' | 'pt', ledger = 'pictures'): Promise<{ look: string; appearance: string }> {
    if (this.budget.spentToday() >= this.budget.cap()) throw new BudgetReached();
    const models = this.models();
    const hints = { you: '', input: note, place: '', opening: false, outcome: null, checkLabel: null, cast: [], exits: [], abilities: [], attemptable: [], teachable: [], threads: [], fight: null, fightOver: null, moment: null, aside: false, clarified: false, movedTo: null, held: null, turn: 0, picture: { who, note } };
    const res = await this.transport().send(pictureRequest(picture, who, note, language, models, hints));
    this.budget.record({ at: Date.now(), role: 'scribe', model: res.model, ...res.usage, cost: costOf(res.model, res.usage), simulated: res.simulated }, ledger);
    this.bump();
    const words = pictureWords(res.text, LOOK_MAX, APPEARANCE_MAX);
    if (res.refusal || !words.appearance) throw new Error(t('Nothing came back for that picture.'));
    return words;
  }

  /** The legend of a hero whose story ended, waiting to be remembered in the next story begun in the same world. */
  nextLegend: { worldId: string; text: string } | null = null;

  /** A story as the text of a file, complete in itself. The API key is not part of a story and is never written to an export. */
  async exportStory(id: string): Promise<string | null> {
    const story = this.storyNow(id);
    if (!story) return null;
    try {
      return toFile(story, await this.scenesOf(id), Date.now());
    } catch {
      return null;
    }
  }

  /** How much room everything this app keeps on the device takes, and how much the browser allows, in bytes. Null where the browser will not say. */
  async storageUse(): Promise<{ used: number; allowed: number; kept: boolean } | null> {
    try {
      if (!navigator.storage?.estimate) return null;
      const e = await navigator.storage.estimate();
      const kept = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      return typeof e.usage === 'number' && typeof e.quota === 'number' ? { used: e.usage, allowed: e.quota, kept } : null;
    } catch {
      return null;
    }
  }

  /** How much a story takes up, in bytes: what an export of it would weigh. */
  async storyBytes(id: string): Promise<number | null> {
    const text = await this.exportStory(id);
    return text === null ? null : new Blob([text]).size;
  }

  /** Read a story file into the list. Returns the new story's id, or the reason it could not be read. */
  async importStory(text: string): Promise<{ id: string } | { problem: string }> {
    try {
      const { story, scenes } = fromFile(text);
      story.id = this.freeId(story.id);
      for (const a of scenes) this.sceneStore.put(story.id, a);
      this.saveStory(story);
      this.bump();
      return { id: story.id };
    } catch (err) {
      return { problem: err instanceof SaveError ? err.message : t('That file could not be read.') };
    }
  }

  async eraseEverything(): Promise<void> {
    this.closeStory();
    if (!this.sandbox) {
      await db.delete().catch(() => {});
      try { localStorage.removeItem(LOOK_CACHE); } catch { /* storage is unavailable */ }
    }
    sessionStorage.removeItem(SESSION_KEY);
    location.reload();
  }
}

export const app = new App();

/** Re-renders the calling component whenever the app or the open session changes. */
export function useApp(): App {
  useSyncExternalStore(app.subscribe, app.snapshot);
  return app;
}
