// Reading the narrator's reply: story text, then a line with only "===", then facts for the engine.
// The reply is plain text (cheap to produce, natural to stream). Parsing is forgiving: a line the
// engine does not understand is ignored, never an error.
import { BOND_TIERS, type BondTier } from '../../engine';

export type StoryPart =
  | { type: 'narration'; text: string }
  | { type: 'say'; tag: string; manner: string | null; text: string; segs?: string[] };

export interface Flags {
  minutes: number | null;
  bonds: { who: string; tier: BondTier; value: 'touches' | 'offends' | null; text: string }[];
  attitudes: { who: string; attitude: string; why: string }[];
  threads: { id: string; op: 'next' | 'clue' | 'done'; text: string }[];
  newThreads: string[];
  promises: { text: string; due: string }[];
  met: string[];
  moveTo: string | null;
  fight: string[];
  /** People whose waiting moment played out in this reply. */
  moments: string[];
  /** Situations of the world that were settled for good in this reply. */
  seeds: string[];
  /** Items of power the protagonist took into their hands in this reply. */
  got: string[];
  /** Money that came to the protagonist, or went from them, outside the engine's trades: a price word, the money's id, and why. */
  paid: { price: string; money: string; why: string }[];
  spent: { price: string; money: string; why: string }[];
  /** Plain things the protagonist now carries, and things they no longer do (by name). */
  gained: { name: string; text: string }[];
  lost: string[];
  endScene: boolean;
  suggestions: string[];
}

export interface ParsedReply {
  parts: StoryPart[];
  flags: Flags;
}

const SEPARATOR = /^\s*={3,}\s*$/m;
const SAY = /^@\s*([^:(\n]{1,40}?)\s*(?:\(([^)\n]{0,60})\))?\s*:\s*([\s\S]+)$/;

export function emptyFlags(): Flags {
  return { minutes: null, bonds: [], attitudes: [], threads: [], newThreads: [], promises: [], met: [], moveTo: null, fight: [], moments: [], seeds: [], got: [], paid: [], spent: [], gained: [], lost: [], endScene: false, suggestions: [] };
}

/** A passage holds at least this much story text before the next one starts (and so before the first Continue). */
export const PASSAGE_MIN_CHARS = 220;

/** The story text received so far: everything before the separator. */
export function storyTextSoFar(partial: string): string {
  const m = SEPARATOR.exec(partial);
  return (m ? partial.slice(0, m.index) : partial).replace(/\n?=+\s*$/, '').trimEnd();
}

/**
 * A speech line may carry a gesture between its spoken parts:
 *   "You told me the thing you could afford to." A dry breath that is almost a laugh. "That's why I believe you."
 * This splits such a line into spoken words and gestures in turn, starting with spoken words (the
 * first entry is empty when the line opens with a gesture). A line with no quotation marks is all speech.
 */
export function splitSpeech(line: string): string[] {
  const s = line.trim();
  if (!/["“”]/.test(s)) return [s];
  const segs: string[] = [''];
  let spoken = false;
  let depth = 0;
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c !== '"' && c !== '“' && c !== '”') { buf += c; continue; }
    const prev = s[i - 1];
    const next = s[i + 1];
    const opens = c === '“' || (c === '"' && (prev === undefined || /[\s(\[—–-]/.test(prev)) && next !== undefined && !/\s/.test(next));
    if (!spoken) {
      if (opens) { segs.push(buf.trim()); buf = ''; spoken = true; depth = 0; } // a gesture ends, speech begins
      else buf += c; // a stray closing mark
    } else if (opens) { depth += 1; buf += c; } // a quotation inside the speech
    else if (depth > 0) { depth -= 1; buf += c; }
    else { segs.push(buf.trim()); buf = ''; spoken = false; } // speech ends
  }
  // What is left belongs to whichever kind was open; keep the alternation by padding with an empty entry.
  const even = segs.length % 2 === 0;
  if (buf.trim()) {
    if (spoken !== even) segs.push('');
    segs.push(buf.trim());
  }
  while (segs.length >= 2 && segs[0] === '' && segs[1] === '') segs.splice(0, 2);
  while (segs.length > 1 && segs[segs.length - 1] === '') segs.pop();
  return segs.length ? segs : [s];
}

/** The spoken words and gestures of a speech beat. Lines saved before gestures were recorded are split from their text. */
export function speechParts(text: string, segs?: string[]): { spoken: boolean; text: string }[] {
  const list = segs && segs.length ? segs : splitSpeech(/^["“]/.test(text) ? text : `"${text}`);
  return list.map((t, i) => ({ spoken: i % 2 === 0, text: t })).filter((x) => x.text);
}

export function parseStory(text: string): StoryPart[] {
  const parts: StoryPart[] = [];
  for (const raw of text.split(/\n\s*\n|\n(?=@)/)) {
    const para = raw.trim();
    if (!para) continue;
    const say = SAY.exec(para);
    if (say) {
      const whole = say[3]!.replace(/\s*\n\s*/g, ' ').trim();
      const line = whole.replace(/^[“"]\s*/, '').replace(/\s*[”"]$/, '');
      const segs = splitSpeech(whole);
      parts.push({ type: 'say', tag: say[1]!.trim(), manner: say[2]?.trim() || null, text: line, ...(segs.length > 1 ? { segs } : {}) });
    } else {
      parts.push({ type: 'narration', text: para.replace(/\s*\n\s*/g, ' ') });
    }
  }
  return parts;
}

/**
 * The first passage of a reply that is still arriving, as soon as it is whole: the paragraphs that
 * will be on screen before the first Continue. Null while its last paragraph may still be growing.
 *
 * The log shows a passage at once, never letter by letter, so the first one is held back until this
 * returns it. It is whole when a later paragraph has begun, or when the story text has ended (the
 * line of "===" has arrived). When replies are not shown passage by passage, the first passage is
 * the whole story.
 */
export function firstPassageSoFar(partial: string, paging: boolean): StoryPart[] | null {
  const ended = SEPARATOR.test(partial);
  const parts = parseStory(storyTextSoFar(partial));
  if (!paging) return ended && parts.length > 0 ? parts : null;
  const first: StoryPart[] = [];
  let size = 0;
  for (const p of parts) {
    if (size >= PASSAGE_MIN_CHARS) break;
    first.push(p);
    size += p.text.length;
  }
  return first.length > 0 && (ended || parts.length > first.length) ? first : null;
}

const split = (s: string) => s.split('|').map((x) => x.trim());

export function parseFlags(text: string): Flags {
  const f = emptyFlags();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const at = line.indexOf(':');
    if (at < 1) continue;
    const key = line.slice(0, at).trim().toLowerCase();
    const rest = line.slice(at + 1).trim();
    if (!rest) continue;
    const p = split(rest);
    switch (key) {
      case 'time': {
        const n = parseInt(rest, 10);
        if (Number.isFinite(n) && n >= 0) f.minutes = Math.min(n, 14 * 1440); // a wait the player agreed to can last two weeks; the engine holds every turn to its own limit
        break;
      }
      case 'bond': {
        const tier = (p[1] ?? '').toLowerCase().replace(/[\s-]+/g, '_') as BondTier;
        if (p[0] && BOND_TIERS.includes(tier)) {
          const v = (p[2] ?? '').toLowerCase();
          f.bonds.push({ who: p[0].toLowerCase(), tier, value: v.startsWith('+') ? 'touches' : v.startsWith('-v') ? 'offends' : null, text: p[3] ?? '' });
        }
        break;
      }
      case 'attitude':
        if (p[0] && p[1]) f.attitudes.push({ who: p[0].toLowerCase(), attitude: p[1], why: p[2] ?? '' });
        break;
      case 'thread': {
        const op = (p[1] ?? '').toLowerCase();
        if (p[0] && (op === 'next' || op === 'clue' || op === 'done')) f.threads.push({ id: p[0].toLowerCase(), op, text: p[2] ?? '' });
        break;
      }
      case 'new-thread':
        f.newThreads.push(rest);
        break;
      case 'promise':
        if (p[0]) f.promises.push({ text: p[0], due: p[1] ?? '' });
        break;
      case 'met':
        f.met.push(...rest.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
        break;
      case 'move':
        f.moveTo = rest.toLowerCase().replace(/^\[|\]$/g, '');
        break;
      case 'fight':
        f.fight = rest.split(',').map((x) => x.trim().toLowerCase().replace(/^\[|\]$/g, '')).filter(Boolean);
        break;
      case 'moment':
        f.moments.push(...rest.split(',').map((x) => x.trim().toLowerCase().replace(/^\[|\]$/g, '')).filter(Boolean));
        break;
      case 'settled':
        f.seeds.push(...rest.split(',').map((x) => x.trim().toLowerCase().replace(/^\[|\]$/g, '')).filter(Boolean));
        break;
      case 'got':
        f.got.push(...rest.split(',').map((x) => x.trim().toLowerCase().replace(/^\[|\]$/g, '')).filter(Boolean));
        break;
      case 'paid':
      case 'spent':
        if (p[0]) (key === 'paid' ? f.paid : f.spent).push({ price: p[0].toLowerCase(), money: (p[1] ?? '').toLowerCase().replace(/^\[|\]$/g, ''), why: p[2] ?? '' });
        break;
      case 'gained':
        if (p[0]) f.gained.push({ name: p[0], text: p[1] ?? '' });
        break;
      case 'lost':
        f.lost.push(...rest.split(',').map((x) => x.trim().replace(/^\[|\]$/g, '')).filter(Boolean));
        break;
      case 'end':
        if (rest.toLowerCase().startsWith('scene')) f.endScene = true;
        break;
      case 'suggest':
        f.suggestions = p.filter(Boolean).slice(0, 3);
        break;
      default:
        break;
    }
  }
  return f;
}

export function parseReply(reply: string): ParsedReply {
  const m = SEPARATOR.exec(reply);
  const story = m ? reply.slice(0, m.index) : reply;
  const facts = m ? reply.slice(m.index + m[0].length) : '';
  return { parts: parseStory(story), flags: parseFlags(facts) };
}
