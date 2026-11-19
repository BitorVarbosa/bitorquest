// A world as a file: to back it up, move it to another device, or give it to someone.
//
// A file from somewhere else is not trusted. It is read, its shape is checked, and the world in it
// must pass the same check as every other world before it is put in the library.
import { t } from '../i18n';
import { SaveError } from './save';
import type { StorySettings, World, WorldTemplate } from './types';
import { checkWorld } from './world';

export const WORLD_FILE_FORMAT = 'bitor-quest-world';
export const WORLD_FILE_VERSION = 1;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number, fallback = ''): string => (typeof v === 'string' ? v.slice(0, max) : fallback);
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

/** The world as the text of a file. Nothing about the player is in it: no key, no stories, no spending. */
export function worldToFile(template: WorldTemplate, now: number): string {
  return JSON.stringify({ format: WORLD_FILE_FORMAT, version: WORLD_FILE_VERSION, exported: now, world: template });
}

/** Read a world file. Throws SaveError, with the reason in words (the interface language: the player is shown it), when it cannot be used. */
export function worldFromFile(file: string): WorldTemplate {
  let raw: unknown;
  try { raw = JSON.parse(file); } catch { throw new SaveError('not-a-story', t('That file is not a Bitor Quest world.')); }
  if (!isObject(raw) || raw.format !== WORLD_FILE_FORMAT) {
    throw new SaveError('not-a-story', isObject(raw) && raw.format === 'bitor-quest-story' ? t('That file is a story, not a world. Import it from the Stories screen.') : t('That file is not a Bitor Quest world.'));
  }
  if (typeof raw.version !== 'number' || raw.version > WORLD_FILE_VERSION) throw new SaveError('newer', t('That world was made by a newer version of Bitor Quest. Update the app to open it.'));
  const tpl = raw.world;
  if (!isObject(tpl) || !isObject(tpl.world)) throw new SaveError('damaged', t('That world file is incomplete.'));
  const w = tpl.world as Record<string, unknown>;
  if (!isObject(w.places) || !isObject(w.people) || !Array.isArray(w.routes) || !isObject(w.rules) || typeof w.name !== 'string' || typeof w.core !== 'string' || typeof w.startPlace !== 'string') {
    throw new SaveError('damaged', t('That world file is incomplete.'));
  }
  for (const [id, p] of Object.entries(w.places)) if (!isObject(p) || typeof p.name !== 'string' || typeof p.card !== 'string' || typeof p.id !== 'string') throw new SaveError('damaged', t('That world cannot be used: {problem}.', { problem: t('the place "{id}" is not complete', { id }) }));
  for (const [id, p] of Object.entries(w.people)) {
    if (!isObject(p) || typeof p.name !== 'string' || typeof p.placeId !== 'string' || typeof p.bond !== 'number' || typeof p.count !== 'number' || !Array.isArray(p.values) || !Array.isArray(p.aliases)) throw new SaveError('damaged', t('That world cannot be used: {problem}.', { problem: t('the person "{id}" is not complete', { id }) }));
  }
  for (const k of ['factions', 'ancestries', 'fronts', 'seeds'] as const) if (w[k] !== undefined && !Array.isArray(w[k])) throw new SaveError('damaged', t('That world file is incomplete.'));
  if (!Array.isArray(w.factions)) w.factions = [];
  if (typeof w.accent !== 'string' || !/^#[0-9a-f]{6}$/i.test(w.accent)) w.accent = '#8a97a8'; // a colour is drawn straight into styles: only a plain one is taken
  if (typeof w.pitch !== 'string') w.pitch = '';
  let found: string[];
  try { found = checkWorld(w as unknown as World); } catch { throw new SaveError('damaged', t('That world file is incomplete.')); }
  if (found.length) throw new SaveError('damaged', t('That world cannot be used: {problem}.', { problem: found[0] ?? '' }));

  const table = isObject(tpl.table) ? tpl.table : {};
  const opening = isObject(tpl.opening) ? tpl.opening : {};
  const source = isObject(tpl.source) ? tpl.source : {};
  const settings: Omit<StorySettings, 'style'> = {
    narration: oneOf(table.narration, ['short', 'medium', 'long'] as const, 'medium'),
    prose: oneOf(table.prose, ['plain', 'clear', 'literary'] as const, 'plain'),
    romance: table.romance === true,
    violence: oneOf(table.violence, ['mild', 'moderate', 'graphic'] as const, 'moderate'),
    leaveOut: text(table.leaveOut, 200),
    language: oneOf(table.language, ['en', 'pt'] as const, 'en'),
    companions: typeof table.companions === 'number' ? Math.max(0, Math.min(3, Math.round(table.companions))) : 2,
    suggestions: table.suggestions !== false,
  };
  const hour = typeof opening.hour === 'number' && Number.isFinite(opening.hour) ? Math.max(0, Math.min(23, Math.round(opening.hour))) : 9;
  return {
    id: text(tpl.id, 60) || 'world',
    world: w as unknown as World,
    source: { kind: oneOf(source.kind, ['description', 'setting', 'document', 'sample'] as const, 'description'), text: text(source.text, 12000), ...(text(source.name, 120) ? { name: text(source.name, 120) } : {}) },
    premise: text(tpl.premise, 4000),
    ...(text(tpl.name, 40).trim() ? { name: text(tpl.name, 40).trim() } : {}),
    table: settings,
    opening: { title: text(opening.title, 60), chapter: text(opening.chapter, 48), thread: text(opening.thread, 160), line: text(opening.line, 300), hour },
    built: typeof tpl.built === 'number' ? tpl.built : 0,
    cost: typeof tpl.cost === 'number' && tpl.cost >= 0 ? tpl.cost : 0,
    simulated: tpl.simulated === true,
    version: 1,
  };
}
