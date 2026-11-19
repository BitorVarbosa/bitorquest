// Storage on the device (IndexedDB through Dexie). Nothing here ever leaves the browser.
//
// A story is kept in two places: its present state, with the last two scenes' transcripts, is one
// row of `stories`, written after every turn; the transcript of each older scene is one row of
// `scenes`, written once when the scene ends. So a turn writes about the same amount however long
// the story is.
import Dexie, { type Table } from 'dexie';
import type { WorldDraft } from '../game/builder';
import { upgrade } from '../game/save';
import type { SceneArchive, Story, UsageEntry, WorldTemplate } from '../game/types';

export interface UsageRow extends UsageEntry {
  id?: number;
  storyId: string;
  /** Local date, YYYY-MM-DD: the day the daily limit counts against. */
  day: string;
}

export interface StoryRow {
  id: string;
  title: string;
  world: string;
  accent: string;
  lastPlayed: number;
  turns: number;
  cost: number;
  /** Where the story stands, for the list: "Chapter 2 · Scene 4 · Lantern Market". */
  where: string;
  data: Story;
}

/** The transcript of one finished scene of one story. */
export interface SceneRow extends SceneArchive {
  storyId: string;
}

/** Where a story is kept as it was before its save format was upgraded (in the `kv` table). */
export const BACKUP_PREFIX = 'story-before-format-2:';

class Db extends Dexie {
  kv!: Table<{ key: string; value: unknown }, string>;
  stories!: Table<StoryRow, string>;
  usage!: Table<UsageRow, number>;
  scenes!: Table<SceneRow, [string, string]>;
  /** Worlds in the library: built once, never changed afterwards. */
  worlds!: Table<WorldTemplate, string>;
  /** Worlds still being built, written after every step. */
  drafts!: Table<WorldDraft, string>;
  constructor() {
    super('bitor-quest');
    this.version(1).stores({ kv: 'key', stories: 'id, lastPlayed', usage: '++id, day, storyId' });
    // Version 2: transcripts of finished scenes move out of the story into their own table (save format 2).
    this.version(2).stores({ kv: 'key', stories: 'id, lastPlayed', usage: '++id, day, storyId', scenes: '[storyId+sceneId], storyId' }).upgrade(async (tx) => {
      const stories = tx.table<StoryRow, string>('stories');
      const scenes = tx.table<SceneRow, [string, string]>('scenes');
      const kv = tx.table<{ key: string; value: unknown }, string>('kv');
      for (const row of await stories.toArray()) {
        // The story exactly as it was before this upgrade is kept aside, untouched, under
        // "story-before-format-2:<id>". Nothing reads it; it is there so that a story can be recovered
        // if the upgrade ever turns out to have got something wrong. It is removed when the story is deleted.
        await kv.put({ key: `${BACKUP_PREFIX}${row.id}`, value: row.data });
        try {
          const loaded = upgrade(row.data);
          await scenes.bulkPut(loaded.scenes.map((a) => ({ storyId: row.id, ...a })));
          await stories.put({ ...row, data: loaded.story });
        } catch {
          // Left exactly as it was. Opening it tries again and, if it still cannot be read, says why.
        }
      }
    });
    // Version 3: the worlds library and the worlds being built. Nothing existing changes.
    this.version(3).stores({ kv: 'key', stories: 'id, lastPlayed', usage: '++id, day, storyId', scenes: '[storyId+sceneId], storyId', worlds: 'id, built', drafts: 'id, updated' });
  }
}

export const db = new Db();

export function dayKey(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function getKv<T>(key: string, fallback: T): Promise<T> {
  const row = await db.kv.get(key);
  return row ? (row.value as T) : fallback;
}
export function setKv(key: string, value: unknown): Promise<string> {
  return db.kv.put({ key, value });
}
