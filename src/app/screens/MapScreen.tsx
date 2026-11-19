// Map: what the protagonist knows of the world, one level at a time.
// Places form a tree of any depth, so the level control is a path ("The Lantern Coast > Port Varn >
// Guild House"), not a pair of tabs: each step jumps to that level, Up goes one level out, and a place
// with known places inside it offers "Look inside". The drawing is made from the data: positions,
// routes, and names placed on whichever side of a node has room.
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { durationLabel, slotOf } from '../../engine';
import { parentChain } from '../../game/cards';
import { estimateExpand } from '../../game/llm/architect';
import type { Session } from '../../game/session';
import { routeBetween } from '../../game/story';
import { neighbours } from '../../game/world';
import type { Commitment, Place, Story } from '../../game/types';
import { lang, m, t, tn } from '../../i18n';
import { useApp } from '../app';
import { go } from '../router';
import { StoryPage } from '../Shell';
import { T } from '../T';
import { Icon, money } from '../ui';
import './map.css';

// ---------- Reading the world ----------

interface Leg { place: Place; minutes: number; note?: string }

const isKnown = (p: Place | undefined): p is Place => !!p && p.known !== 'hidden';

function shortTime(minutes: number): string {
  if (minutes < 60) return t('{n} min', { n: minutes });
  return durationLabel(minutes, lang());
}

/** The quickest way between two places along routes the protagonist knows of, or null when there is none. */
function knownWay(story: Story, from: string, to: string): Leg[] | null {
  const places = story.world.places;
  if (!isKnown(places[from]) || !isKnown(places[to])) return null;
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, { from: string; minutes: number; note?: string }>();
  const done = new Set<string>();
  for (;;) {
    let cur: string | null = null;
    for (const [id, d] of dist) if (!done.has(id) && (cur === null || d < (dist.get(cur) ?? Infinity))) cur = id;
    if (cur === null) return null;
    if (cur === to) break;
    done.add(cur);
    const base = dist.get(cur) ?? 0;
    for (const r of neighbours(story.world, cur)) {
      const next = r.id;
      if (done.has(next) || !isKnown(places[next])) continue;
      if (base + r.minutes < (dist.get(next) ?? Infinity)) { dist.set(next, base + r.minutes); prev.set(next, { from: cur, minutes: r.minutes, note: r.note }); }
    }
  }
  const legs: Leg[] = [];
  for (let id = to; id !== from;) {
    const step = prev.get(id);
    const place = places[id];
    if (!step || !place) return null;
    legs.unshift({ place, minutes: step.minutes, note: step.note });
    id = step.from;
  }
  return legs;
}

/** The known place a sentence names ("Meet Tobin's master at the Old Mill"), by its longest name or alias. */
function placeNamedIn(story: Story, text: string): Place | null {
  const t = text.toLowerCase();
  let best: Place | null = null;
  let len = 0;
  for (const p of Object.values(story.world.places)) {
    if (p.known === 'hidden') continue;
    for (const name of [p.name, ...(p.aliases ?? [])]) {
      const n = name.toLowerCase();
      if (n.length > len && t.includes(n)) { best = p; len = n.length; }
    }
  }
  return best;
}

function dueLine(c: Commitment, today: number): string {
  if (c.dueDay !== null && c.dueDay < today) return t('Overdue since day {day}', { day: c.dueDay });
  return t('Due {when}', { when: c.dueLabel });
}

// ---------- Drawing ----------

interface Rect { x: number; y: number; w: number; h: number }
interface Dot { id: string; x: number; y: number; r: number; kind: 'here' | 'visited' | 'heard' | 'unknown'; inside: boolean; name: string }
interface Tag { id: string; lines: string[]; sub: string | null; anchor: 'start' | 'middle' | 'end'; x: number; box: Rect }
interface Line { a: Dot; b: Dot; dash: boolean }
interface Layout { tags: Tag[]; numbered: string[] }

const FONT = 12; // SVG text is drawn one drawing unit to one pixel, so this is its size on screen
const LINE_H = 15;
const SUB = m('You are here');
const R_NUMBERED = 9;

let pen: CanvasRenderingContext2D | null | undefined;
function textWidth(text: string, bold: boolean): number {
  if (pen === undefined) {
    try { pen = document.createElement('canvas').getContext('2d'); } catch { pen = null; }
  }
  if (!pen) return text.length * (bold ? 6.9 : 6.4);
  pen.font = `${bold ? 600 : 400} ${FONT}px ${getComputedStyle(document.body).fontFamily || 'sans-serif'}`;
  return pen.measureText(text).width;
}

/** A long name goes on two lines, split at the space nearest its middle. */
function wrapName(name: string, bold: boolean, max: number): string[] {
  if (textWidth(name, bold) <= max || !name.includes(' ')) return [name];
  const words = name.split(' ');
  let best: string[] = [name];
  let score = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const wide = Math.max(textWidth(a, bold), textWidth(b, bold));
    if (wide < score) { score = wide; best = [a, b]; }
  }
  return best;
}

const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const gapBetween = (a: Rect, b: Rect) => Math.hypot(Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w)), Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h)));
const boxOf = (d: Dot, pad: number): Rect => ({ x: d.x - d.r - pad, y: d.y - d.r - pad, w: 2 * (d.r + pad), h: 2 * (d.r + pad) });

/** Does the segment from p to q pass through the rectangle? (Liang–Barsky clipping.) */
function crosses(p: Dot, q: Dot, r: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const edges: [number, number][] = [[-dx, p.x - r.x], [dx, r.x + r.w - p.x], [-dy, p.y - r.y], [dy, r.y + r.h - p.y]];
  for (const [den, num] of edges) {
    if (den === 0) { if (num < 0) return false; continue; }
    const t = num / den;
    if (den < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t1 - t0 > 0.02;
}

/**
 * Put each name beside its node. A dozen positions are tried (beside, above, below, the corners);
 * each is scored for running off the drawing, covering a node or another name, lying across a route,
 * and for how much air is left around it. A few passes let earlier names move out of the way of later
 * ones. Returns the names and how badly each still collides with something.
 */
function placeTags(dots: Dot[], lines: Line[], W: number, H: number, unnamed: Set<string>): { tags: Tag[]; clash: Map<string, number> } {
  const frame: Rect = { x: 3, y: 3, w: W - 6, h: H - 6 };
  const crowd = (d: Dot) => dots.filter((o) => o !== d && Math.hypot(o.x - d.x, o.y - d.y) < 80).length;
  const sized = dots
    .filter((d) => d.kind !== 'unknown' && !unnamed.has(d.id))
    .map((d) => {
      const bold = d.kind === 'here';
      const text = wrapName(d.name, bold, Math.min(112, W * 0.34));
      const sub = d.kind === 'here' ? t(SUB) : null;
      const w = Math.ceil(Math.max(...text.map((l) => textWidth(l, bold)), sub ? textWidth(sub, false) : 0));
      return { d, text, sub, w, h: (text.length + (sub ? 1 : 0)) * LINE_H, crowd: crowd(d) };
    })
    .sort((p, q) => Number(q.d.kind === 'here') - Number(p.d.kind === 'here') || q.crowd - p.crowd); // the hardest to place go first
  const chosen = new Map<string, Tag>();

  const options = (s: (typeof sized)[number]): Tag[] => {
    const { d, w, h } = s;
    const keep = d.r + (d.kind === 'here' || d.inside ? 5 : 3); // room for the halo, the ring that says "more inside", or the ring of a selected place
    const g = 6;
    const k = keep * 0.71 + 3;
    const make = (anchor: Tag['anchor'], left: number, top: number): Tag => ({
      id: d.id, lines: s.text, sub: s.sub, anchor, x: anchor === 'start' ? left : anchor === 'end' ? left + w : left + w / 2, box: { x: left, y: top, w, h },
    });
    const inFrame = (left: number) => Math.max(frame.x, Math.min(frame.x + frame.w - w, left)); // above or below, a name slides sideways to stay on the drawing
    const below = d.y + keep + g - 2;
    const above = d.y - keep - g - h + 2;
    return [
      make('start', d.x + keep + g, d.y - h / 2),
      make('end', d.x - keep - g - w, d.y - h / 2),
      make('middle', inFrame(d.x - w / 2), below),
      make('middle', inFrame(d.x - w / 2), above),
      make('start', d.x + k, d.y + k),
      make('end', d.x - k - w, d.y + k),
      make('start', d.x + k, d.y - k - h),
      make('end', d.x - k - w, d.y - k - h),
      make('middle', inFrame(d.x - w * 0.2), below),
      make('middle', inFrame(d.x - w * 0.8), below),
      make('middle', inFrame(d.x - w * 0.2), above),
      make('middle', inFrame(d.x - w * 0.8), above),
    ];
  };

  /** How much of a name lies off the drawing, on a node, or on another name. */
  const collision = (t: Tag): number => {
    const b = t.box;
    let bad = 12 * (Math.max(0, frame.x - b.x) + Math.max(0, b.x + b.w - frame.x - frame.w) + Math.max(0, frame.y - b.y) + Math.max(0, b.y + b.h - frame.y - frame.h));
    for (const d of dots) if (d.id !== t.id) bad += overlap(b, boxOf(d, 1)) * 2;
    for (const [id, other] of chosen) if (id !== t.id) bad += overlap(b, other.box);
    return bad;
  };

  const score = (t: Tag, order: number): number => {
    const b = t.box;
    let cost = order;
    const out = Math.max(0, frame.x - b.x) + Math.max(0, b.x + b.w - frame.x - frame.w) + Math.max(0, frame.y - b.y) + Math.max(0, b.y + b.h - frame.y - frame.h);
    if (out > 0) cost += 2000 + out * 100;
    let room = Math.min(b.x - frame.x, frame.x + frame.w - b.x - b.w, b.y - frame.y, frame.y + frame.h - b.y - b.h) + 6;
    for (const d of dots) {
      if (d.id === t.id) continue;
      const nb = boxOf(d, 3);
      const o = overlap(b, nb);
      if (o > 0) cost += 800 + o * 4;
      room = Math.min(room, gapBetween(b, nb));
    }
    for (const [id, other] of chosen) {
      if (id === t.id) continue;
      const o = overlap(b, other.box);
      if (o > 0) cost += 600 + o * 4;
      room = Math.min(room, gapBetween(b, other.box));
    }
    // A name may lie across a route if it has to (it is drawn with an outline), but not for free.
    const fat: Rect = { x: b.x - 2, y: b.y - 1, w: b.w + 4, h: b.h + 2 };
    for (const l of lines) if (crosses(l.a, l.b, fat)) cost += 70;
    return cost - Math.min(Math.max(room, 0), 12) * 2; // a little air is worth having; more than that is not
  };

  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    for (const s of sized) {
      const tries = options(s);
      let pick = tries[0];
      let cost = Infinity;
      for (let i = 0; i < tries.length; i++) {
        const t = tries[i]!;
        const c = score(t, i < 4 ? i : 6 + i); // beside, above or below before the corners
        if (c < cost) { cost = c; pick = t; }
      }
      if (!pick) continue;
      const before = chosen.get(s.d.id);
      if (!before || before.box.x !== pick.box.x || before.box.y !== pick.box.y) moved = true;
      chosen.set(s.d.id, pick);
    }
    if (!moved) break;
  }
  const tags = [...chosen.values()];
  return { tags, clash: new Map(tags.map((t) => [t.id, collision(t)])) };
}

/**
 * The whole drawing. When a level is so crowded that a name would still sit on a node or on another
 * name, that place gives up its name on the drawing: its node carries a number instead, and the list
 * under the map says which place the number is. The place the protagonist is in always keeps its name.
 */
function layOut(dots: Dot[], lines: Line[], W: number, H: number): Layout {
  const numbered = new Set<string>();
  const sizeOf = (d: Dot): Dot => (numbered.has(d.id) ? { ...d, r: R_NUMBERED } : d);
  for (let round = 0; ; round++) {
    const now = dots.map(sizeOf);
    const byId = new Map(now.map((d) => [d.id, d]));
    const drawn = lines.map((l) => ({ ...l, a: byId.get(l.a.id) ?? l.a, b: byId.get(l.b.id) ?? l.b }));
    const { tags, clash } = placeTags(now, drawn, W, H, numbered);
    const worst = tags
      .filter((t) => (clash.get(t.id) ?? 0) > 14 && byId.get(t.id)?.kind !== 'here')
      .sort((p, q) => (clash.get(q.id) ?? 0) - (clash.get(p.id) ?? 0))[0];
    if (!worst || round >= dots.length) return { tags, numbered: [...numbered] };
    numbered.add(worst.id);
  }
}

/** The width of an element in pixels, kept up to date. The element is handed over through the returned ref callback. */
function useWidth(): [(el: HTMLElement | null) => void, number] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.clientWidth));
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [el]);
  return [setEl, width];
}

// ---------- The screen ----------

export function MapScreen({ level }: { level: string | null }) {
  const a = useApp();
  return a.session ? <MapView s={a.session} level={level} /> : null;
}

function MapView({ s, level }: { s: Session; level: string | null }) {
  const a = useApp();
  const [picked, setPicked] = useState<{ view: string; id: string | null } | null>(null);
  const [figure, W] = useWidth();
  const pathRow = useRef<HTMLDivElement>(null);
  const [cut, setCut] = useState(false); // the start of the path has scrolled out of view
  const card = useRef<HTMLElement>(null);
  // The place under the pointer (or the row with keyboard focus). It answers on the drawing and in the list at once.
  const [hover, setHover] = useState<string | null>(null);
  const over = (id: string) => ({
    onPointerEnter: (e: { pointerType: string }) => { if (e.pointerType !== 'touch') setHover(id); }, // a finger has no hover: a tap would leave it stuck
    onPointerLeave: () => setHover((h) => (h === id ? null : h)),
  });
  const focus_ = (id: string) => ({ onFocus: () => setHover(id), onBlur: () => setHover((h) => (h === id ? null : h)) });

  const story = s.story;
  const places = story.world.places;
  const routes = story.world.routes;
  const here = s.scene.placeId;
  const hereChain = parentChain(story, here);
  const knownInside = (id: string) => Object.values(places).filter((p) => p.parent === id && p.known !== 'hidden');

  // Which level is on screen: the one asked for, or the one that holds the place the protagonist is in.
  // A place with nothing known inside it is shown on its parent's map, already selected.
  let viewId = hereChain[hereChain.length - 2]?.id ?? here;
  let focus: string | null = null;
  const asked = level ? places[level] : undefined;
  if (isKnown(asked)) {
    if (knownInside(asked.id).length > 0) viewId = asked.id;
    else if (asked.parent && places[asked.parent]) { viewId = asked.parent; focus = asked.id; }
  }
  const selectedId = picked && picked.view === viewId ? picked.id : focus;

  // The path keeps its last step, the level on screen, in view.
  useLayoutEffect(() => {
    const el = pathRow.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
    setCut(el.scrollLeft > 2);
  }, [viewId, W]);
  // A card opened from far down the list is brought into view.
  useLayoutEffect(() => {
    if (selectedId) card.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, viewId]);

  const view = places[viewId];
  const today = story.clock.day;
  const hereName = places[here]?.name ?? t('here');
  const chain = parentChain(story, viewId);
  const up = view?.parent && places[view.parent] ? view.parent : null;
  const kids = Object.values(places).filter((p) => p.parent === viewId);
  const known = kids.filter((p) => p.known !== 'hidden');
  // A hidden place is hinted at only when a route leads to it from somewhere known.
  const neighbour = (p: Place): Place | undefined => {
    for (const r of routes) {
      const other = r.a === p.id ? r.b : r.b === p.id ? r.a : null;
      if (other && isKnown(places[other])) return places[other];
    }
    return undefined;
  };
  const unknown = kids.filter((p) => p.known === 'hidden' && neighbour(p));
  const hereNode = known.find((p) => hereChain.some((c) => c.id === p.id)) ?? null;
  const direct = (id: string) => (id === here ? null : routeBetween(story, here, id));
  const due = story.commitments.filter((c) => !c.done && c.dueDay !== null && c.dueDay <= today);
  const dueAt = (p: Place) => due.find((c) => placeNamedIn(story, c.text)?.id === p.id);
  const mainThread = story.threads.find((th) => th.status === 'open' && th.kind === 'main');
  const mainPlace = mainThread ? placeNamedIn(story, mainThread.title) : null;

  const rows = [...known].sort((x, y) => {
    if (x.id === hereNode?.id) return -1;
    if (y.id === hereNode?.id) return 1;
    const dx = direct(x.id)?.minutes ?? Infinity;
    const dy = direct(y.id)?.minutes ?? Infinity;
    return dx - dy || x.name.localeCompare(y.name);
  });

  const selected = selectedId && selectedId !== hereNode?.id ? known.find((p) => p.id === selectedId) ?? null : null;
  const select = (id: string) => {
    if (id === hereNode?.id) { if (knownInside(id).length > 0) go(`map/${id}`); return; }
    setPicked({ view: viewId, id });
  };
  const close = () => setPicked({ view: viewId, id: null });

  // ----- the drawing, in pixels -----
  // The places keep their positions relative to each other and are spread over the drawing, so a level
  // with a handful of places is not a knot in one corner. Two or three places get a smaller drawing,
  // and a crowded level a taller one.
  const drawn = [...known, ...unknown];
  const few = drawn.length <= 3;
  const H = few
    ? Math.round(Math.max(190, Math.min(240, W * 0.6)))
    : Math.round(Math.min(W * 1.6, Math.max(250, Math.min(440, W * 0.8), (drawn.length * 9000) / Math.max(W, 1))));
  const padX = few ? Math.max(44, W * 0.2) : 32;
  const padY = few ? Math.max(44, H * 0.27) : 32;
  const spread = (values: number[]) => {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    return hi - lo < 8 ? { lo: (lo + hi) / 2 - 50, hi: (lo + hi) / 2 + 50 } : { lo, hi }; // nearly in line: keep them in the middle
  };
  const sx = spread(drawn.map((p) => p.x));
  const sy = spread(drawn.map((p) => p.y));
  const at = (p: Place) => ({
    x: Math.round(padX + ((p.x - sx.lo) / (sx.hi - sx.lo)) * (W - 2 * padX)),
    y: Math.round(padY + ((p.y - sy.lo) / (sy.hi - sy.lo)) * (H - 2 * padY)),
  });
  const base: Dot[] = [
    ...known.map((p): Dot => ({
      id: p.id, ...at(p), name: p.name, inside: knownInside(p.id).length > 0,
      kind: p.id === hereNode?.id ? 'here' : p.known === 'visited' ? 'visited' : 'heard', r: p.id === hereNode?.id ? 6.5 : 6,
    })),
    ...unknown.map((p): Dot => ({ id: p.id, ...at(p), name: '', inside: false, kind: 'unknown', r: 9 })),
  ];
  const baseLines: Line[] = [];
  for (const r of routes) {
    const p = base.find((d) => d.id === r.a);
    const q = base.find((d) => d.id === r.b);
    if (p && q) baseLines.push({ a: p, b: q, dash: p.kind === 'unknown' || q.kind === 'unknown' });
  }
  // Placing the names is the only costly step, so it is redone only when the drawing itself changes.
  const signature = JSON.stringify([lang(), W, H, base, baseLines.map((l) => [l.a.id, l.b.id])]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layout = useMemo(() => (W > 0 ? layOut(base, baseLines, W, H) : { tags: [], numbered: [] }), [signature]);

  if (!view) return null;

  // Places that gave up their name on the drawing are numbered in the order of the list.
  const numberOf = new Map<string, number>();
  for (const p of rows) if (layout.numbered.includes(p.id)) numberOf.set(p.id, numberOf.size + 1);
  const dots = base.map((d): Dot => (numberOf.has(d.id) ? { ...d, r: R_NUMBERED } : d));
  const dotOf = (id: string) => dots.find((d) => d.id === id);
  const lines = baseLines.map((l) => ({ ...l, a: dotOf(l.a.id) ?? l.a, b: dotOf(l.b.id) ?? l.b }));
  const reach = (d: Dot) => Math.max(13, Math.min(22, ...dots.filter((o) => o !== d).map((o) => Math.hypot(o.x - d.x, o.y - d.y) / 2)));
  const hereDot = hereNode ? dotOf(hereNode.id) : undefined;
  const selDot = selected ? dotOf(selected.id) : undefined;
  const selRoute = selected ? direct(selected.id) : null;
  // Under the pointer: the node, and the way there when it is one step away.
  const hovDot = hover && hover !== selected?.id ? dotOf(hover) : undefined;
  const hovRoute = hovDot && hovDot.kind !== 'unknown' && hovDot.kind !== 'here' ? direct(hovDot.id) : null;
  const opens = (d: Dot) => d.kind !== 'unknown' && (d.kind !== 'here' || d.inside); // pressing it does something
  const tip = (d: Dot) => {
    if (d.kind === 'unknown') { const p = places[d.id]; const n = p ? neighbour(p) : undefined; return n ? t('Undiscovered. Somewhere beyond {name}', { name: n.name }) : t('Undiscovered'); }
    if (d.kind === 'here') return d.inside ? t('{name}. You are here. Press to look inside', { name: d.name }) : t('{name}. You are here', { name: d.name });
    const route = direct(d.id);
    return route ? t('{name}. {time} from {place}', { name: d.name, time: shortTime(route.minutes), place: hereName }) : t('{name}. Not one step from {place}', { name: d.name, place: hereName });
  };
  const describe = [
    t('Schematic map of {name}.', { name: view.name }),
    hereNode ? (hereNode.id === here ? t('You are at {name}.', { name: hereNode.name }) : t('You are in {name}, at {place}.', { name: hereNode.name, place: hereName })) : t('You are at {place}, which is not on this map.', { place: hereName }),
    known.length ? t('Places: {list}.', { list: known.map((p) => (p.known === 'visited' ? t('{name} (visited)', { name: p.name }) : t('{name} (heard of)', { name: p.name }))).join(', ') }) : '',
    unknown.length ? tn(unknown.length, '{n} undiscovered place.', '{n} undiscovered places.') : '',
  ].filter(Boolean).join(' ');

  // ----- the journey to the selected place -----
  // When there is no direct route: the way the protagonist knows of, from where they stand or, failing
  // that, from the place on this map that holds them ("from Port Varn it is four days").
  const way = selected && !selRoute ? knownWay(story, here, selected.id) : null;
  const wayFromNode = selected && !selRoute && !way && hereNode && hereNode.id !== here ? knownWay(story, hereNode.id, selected.id) : null;
  const legs = way ?? wayFromNode;
  const legsFrom = way ? hereName : hereNode?.name ?? hereName;
  const firstStop = way && way.length > 1 ? way[0]?.place : undefined;
  const status = (p: Place) => {
    const visited = p.known === 'visited';
    const word = visited ? t('Visited') : t('Heard of, not visited yet');
    const brief = p.brief.toLowerCase();
    // some descriptions already say it
    return brief.startsWith(visited ? 'visited' : 'heard of') || brief.startsWith(word.split(',')[0]!.toLowerCase()) ? p.brief : `${word} · ${p.brief}`;
  };
  const stuck = s.combat ? t('You cannot leave in the middle of a fight.') : s.busy ? t('Wait for the narrator to finish this turn.') : story.over ? t('This story has ended.') : s.blocker?.kind === 'elsewhere' ? t('This story is open in another window.') : s.blocker ? t('The last turn did not go through. Sort that out in the story first.') : null;
  const travel = (id: string) => {
    void s.travel(id);
    go('play');
  };
  const slot = t(slotOf(story.clock)).toLowerCase();
  const markOf = (p: Place, isHere: boolean) => {
    const n = numberOf.get(p.id);
    const state = isHere ? t('You are here') : p.known === 'visited' ? t('Visited') : t('Heard of');
    return n
      ? <i className={`nd nd-num${p.known === 'visited' ? ' nd-seen' : ''}`} role="img" aria-label={t('{state}. Number {n} on the map', { state, n })}>{n}</i>
      : <i className={`nd${isHere ? ' nd-here' : p.known === 'visited' ? ' nd-seen' : ''}`} role="img" aria-label={state} />;
  };

  return (
    <StoryPage page="map" title={t('Map')}>
      <div className="mapx">
        <header className="page-h">
          <div>
            <h1 className="only-desktop">{t('Map')}</h1>
            <p>{view.name} · {tn(known.length, '{n} place known', '{n} places known')}{unknown.length > 0 ? ` · ${t('{n} undiscovered', { n: unknown.length })}` : ''}</p>
          </div>
        </header>

        <nav className="path" aria-label={t('Map level')}>
          <button className="btn path-up" disabled={!up} onClick={() => up && go(`map/${up}`)} aria-label={up ? t('Up one level, to {name}', { name: places[up]?.name ?? '' }) : t('Up one level: this is the top level')}>
            <Icon name="up" size={18} />{t('Up')}
          </button>
          <div className={`path-row${cut ? ' is-cut' : ''}`} ref={pathRow} onScroll={(e) => setCut(e.currentTarget.scrollLeft > 2)}>
            {chain.map((p, i) => (
              <Fragment key={p.id}>
                {i > 0 && <Icon name="right" size={14} strong />}
                <button onClick={() => go(`map/${p.id}`)} aria-current={i === chain.length - 1 ? 'true' : undefined}>{p.name}</button>
              </Fragment>
            ))}
          </div>
        </nav>

        {!hereNode && (
          <p className="where">
            <Icon name="pin" size={16} />
            <span>{viewId === here ? <T text="You are at <b>{place}</b>. These are the places inside it." vars={{ place: hereName }} /> : <T text="You are at <b>{place}</b>, which is not on this map." vars={{ place: hereName }} />}</span>
            {viewId !== here && <button className="link link-tap" onClick={() => go('map')}>{t('Show where you are')}</button>}
          </p>
        )}

        {known.length === 0 ? (
          <section className="empty">
            <Icon name="map" size={40} />
            <h2>{t('Nothing known here yet')}</h2>
            <p>{t('You know of no places inside {name}. They appear on the map as you visit them or hear of them.', { name: view.name })}</p>
          </section>
        ) : (
          <div className="split mp">
            {/* ===== The drawing ===== */}
            <section className="card card-flush" aria-label={t('Map')}>
              <figure ref={figure} style={{ minHeight: W > 0 ? undefined : 250 }}>
                {W > 0 && (
                  <svg className="map" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={describe}>
                    <g className="map-l">
                      {lines.map((l, i) => <path key={i} className={l.dash ? 'dash' : undefined} d={`M${l.a.x} ${l.a.y}L${l.b.x} ${l.b.y}`} />)}
                    </g>
                    {selRoute && hereDot && selDot && <g className="map-go"><path d={`M${hereDot.x} ${hereDot.y}L${selDot.x} ${selDot.y}`} /></g>}
                    {hovRoute && hereDot && hovDot && <g className="map-go map-go-hov"><path d={`M${hereDot.x} ${hereDot.y}L${hovDot.x} ${hovDot.y}`} /></g>}
                    <g className="map-n">
                      {hovDot && <circle className="hov" cx={hovDot.x} cy={hovDot.y} r={hovDot.r + (hovDot.inside || hovDot.kind === 'here' ? 8.5 : 5.5)} />}
                      {dots.map((d) => {
                        const up = d.id === hover ? ' is-hov' : '';
                        return d.kind === 'unknown'
                          ? <circle key={d.id} className={`unk${up}`} cx={d.x} cy={d.y} r={d.r} />
                          : d.kind === 'here'
                            ? <Fragment key={d.id}><circle className="halo" cx={d.x} cy={d.y} r={11.5} /><circle className={`here${up}`} cx={d.x} cy={d.y} r={d.r} /></Fragment>
                            : <Fragment key={d.id}>{d.inside && <circle className="ring" cx={d.x} cy={d.y} r={d.r + 4} />}<circle className={`${d.kind === 'visited' ? 'seen' : ''}${up}`} cx={d.x} cy={d.y} r={d.r} /></Fragment>;
                      })}
                      {selDot && <circle className="sel" cx={selDot.x} cy={selDot.y} r={selDot.r + (selDot.inside ? 7.5 : 4.5)} />}
                    </g>
                    <g aria-hidden="true">
                      {dots.map((d) => {
                        const n = numberOf.get(d.id);
                        if (d.kind === 'unknown') return <text key={d.id} className="t-q t-in" x={d.x} y={d.y + 4} textAnchor="middle">?</text>;
                        return n ? <text key={d.id} className={`t-in${d.kind === 'visited' ? ' t-on' : ''}`} x={d.x} y={d.y + 4} textAnchor="middle">{n}</text> : null;
                      })}
                      {layout.tags.map((tag) => (
                        <text key={tag.id} textAnchor={tag.anchor} className={`${tag.sub ? 't-b' : tag.id === selected?.id ? 'dest' : ''}${tag.id === hover ? ' is-hov' : ''}`}>
                          {tag.lines.map((l, i) => <tspan key={i} x={tag.x} y={tag.box.y + 11 + i * LINE_H}>{l}</tspan>)}
                          {tag.sub && <tspan className="t-a" x={tag.x} y={tag.box.y + 11 + tag.lines.length * LINE_H}>{tag.sub}</tspan>}
                        </text>
                      ))}
                    </g>
                    <g aria-hidden="true">
                      {dots.map((d) => (
                        <circle key={d.id} className={opens(d) ? 'hit' : 'hit hit-none'} cx={d.x} cy={d.y} r={reach(d)} onClick={opens(d) ? () => select(d.id) : undefined} {...over(d.id)}>
                          <title>{tip(d)}</title>
                        </circle>
                      ))}
                    </g>
                  </svg>
                )}
              </figure>
              <ul className="lg" aria-label={t('Legend')}>
                {hereNode && <li><i className="nd nd-here" aria-hidden="true" />{t('You are here')}</li>}
                <li><i className="nd nd-seen" aria-hidden="true" />{t('Visited')}</li>
                <li><i className="nd" aria-hidden="true" />{t('Heard of')}</li>
                {unknown.length > 0 && <li><i className="nd nd-unk" aria-hidden="true" />{t('Undiscovered')}</li>}
                {dots.some((d) => d.inside && d.kind !== 'here') && <li><i className="nd nd-in" aria-hidden="true" />{t('More inside')}</li>}
                {numberOf.size > 0 && <li><i className="nd nd-num" aria-hidden="true">1</i>{t('Named in the list')}</li>}
                <li className="lg-n only-desktop">{t('Not to scale')}</li>
              </ul>
            </section>

            {/* ===== Beside the map: the places, or the journey ===== */}
            <div>
              {selected ? (
                <section className="card trav" ref={card} aria-label={selRoute ? t('Travel to {name}', { name: selected.name }) : selected.name}>
                  <div>
                    <p className="card-t"><Icon name="compass" size={16} />{selRoute ? t('Travel to') : t('On the map')}</p>
                    <h2 className="card-n">{selected.name}</h2>
                    <p className="t-sm t-2">{status(selected)}</p>
                  </div>

                  {selRoute ? (
                    <>
                      <p className="trav-t"><Icon name="clock" size={18} /><span><T text="<b>About {time}</b> from {place}" vars={{ time: durationLabel(selRoute.minutes, lang()), place: hereName }} /></span></p>
                      <ol className="tl route">
                        <li className="big"><b>{hereName}</b><span className="tl-k">{t('You are here · it is {slot}', { slot })}</span></li>
                        <li>
                          <b>{selected.name}</b><span className="tl-k">{shortTime(selRoute.minutes)}</span>
                          {selRoute.note && <p className="way"><Icon name="info" size={14} />{selRoute.note}</p>}
                        </li>
                      </ol>
                    </>
                  ) : (
                    <>
                      <p className="alert"><Icon name="info" /><span><b>{t('Not reachable in one step')}</b><span className="t-2">{t('There is no direct route from {from} to {to}. Travel goes one route at a time.', { from: hereName, to: selected.name })}</span></span></p>
                      {legs ? (
                        <>
                          <p className="trav-t"><Icon name="clock" size={18} /><span>{way
                            ? <T text="The way you know of: <b>about {time}</b>" vars={{ time: durationLabel(legs.reduce((sum, l) => sum + l.minutes, 0), lang()) }} />
                            : <T text="The way you know of, from {from}: <b>about {time}</b>" vars={{ from: legsFrom, time: durationLabel(legs.reduce((sum, l) => sum + l.minutes, 0), lang()) }} />}</span></p>
                          <ol className="tl route">
                            <li className="big"><b>{legsFrom}</b><span className="tl-k">{way ? t('You are here') : t('You are in it, at {place}', { place: hereName })}</span></li>
                            {legs.map((l, i) => (
                              <li key={l.place.id}>
                                <b>{l.place.name}</b><span className="tl-k">{i > 0 ? t('{time} more', { time: shortTime(l.minutes) }) : shortTime(l.minutes)}</span>
                                {l.note && <p className="way"><Icon name="info" size={14} />{l.note}</p>}
                              </li>
                            ))}
                          </ol>
                        </>
                      ) : <p className="help">{t('You know of no route that leads there.')}</p>}
                    </>
                  )}

                  {selRoute && due.map((c) => {
                    const named = placeNamedIn(story, c.text);
                    return (
                      <div key={c.id} className="due">
                        <div className="due-k"><Icon name="clock" size={14} strong />{dueLine(c, today)}</div>
                        <p>{c.text}</p>
                        {named && <p className="due-n">{named.id === selected.id ? t('This journey takes you there.') : t('That is at {place}, not at {other}.', { place: named.name, other: selected.name })}</p>}
                      </div>
                    );
                  })}
                  {selRoute && stuck && <p className="help">{stuck}</p>}
                  {selected.sketch && (
                    <p className="way map-sketch">
                      <Icon name="info" size={14} />
                      {story.settings.fillPlaces === false
                        ? t('A sketch so far: one line on the map. Filling places in is switched off for this story, so the narrator will make do with that.')
                        : t('A sketch so far: one line on the map. What is inside it is written the first time you arrive, once ({cost}).', { cost: a.usingDemo ? t('free in the demo') : estimateExpand(a.models()) < 0.005 ? t('under a cent') : t('about {price}', { price: money(estimateExpand(a.models()), 2) }) })}
                    </p>
                  )}

                  <div className="acts">
                    {selRoute && <button className="btn btn-primary" disabled={!!stuck} onClick={() => travel(selected.id)}>{t('Travel there')}<Icon name="arrow" size={18} /></button>}
                    {firstStop && firstStop.parent === viewId && <button className="btn btn-soft" onClick={() => select(firstStop.id)}>{t('First, {name}', { name: firstStop.name })}</button>}
                    {knownInside(selected.id).length > 0 && <button className="btn" onClick={() => go(`map/${selected.id}`)}><Icon name="search" size={18} />{t('Look inside')}</button>}
                    <button className="btn" onClick={close}>{selRoute ? t('Not now') : t('Back to the list')}</button>
                  </div>
                </section>
              ) : (
                <section className="sec">
                  <div className="sec-h"><h2>{t('Places')}</h2><span className="t-xs t-2">{rows.some((p) => direct(p.id)) ? t('Travel times from {place}', { place: hereName }) : t('None is one step from {place}', { place: hereName })}</span></div>
                  <div className="card card-flush pl">
                    {rows.map((p) => {
                      const isHere = p.id === hereNode?.id;
                      const route = direct(p.id);
                      const inside = knownInside(p.id).length;
                      const owed = dueAt(p);
                      const text = (
                        <span className="grow">
                          <span className="row-t">{p.name}</span>
                          <span className="row-s">
                            {owed && <><span className="t-gold">{dueLine(owed, today)}</span> · </>}
                            {!owed && mainPlace?.id === p.id && <><span className="t-accent">{t('Main thread')}</span> · </>}
                            {p.brief}
                          </span>
                          {isHere && p.id !== here && <span className="row-s">{t('You are at {place}', { place: hereName })}</span>}
                        </span>
                      );
                      return (
                        <div key={p.id} className={`pl-item${hover === p.id ? ' is-hov' : ''}`} {...over(p.id)}>
                          {isHere
                            ? <div className="row">{markOf(p, true)}{text}<span className="tag tag-accent">{t('You are here')}</span></div>
                            : (
                              <button className="row" onClick={() => select(p.id)} {...focus_(p.id)}>
                                {markOf(p, false)}{text}
                                <span className="row-end">{route ? shortTime(route.minutes) : ''}<Icon name="right" size={18} /></span>
                              </button>
                            )}
                          {inside > 0 && (
                            <button className="pl-in" onClick={() => go(`map/${p.id}`)}>
                              <Icon name="search" size={16} strong /><span className="grow">{t('Look inside')} <span className="pl-in-n">· {tn(inside, '{n} place known', '{n} places known')}</span></span><Icon name="right" size={16} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {unknown.map((p) => (
                      <div key={p.id} className={`pl-item${hover === p.id ? ' is-hov' : ''}`} {...over(p.id)}>
                        <div className="row pl-unk">
                          <i className="nd nd-unk" aria-hidden="true" />
                          <span className="grow"><span className="row-t">{t('Undiscovered')}</span><span className="row-s">{t('Somewhere beyond {name}', { name: neighbour(p)?.name ?? '' })}</span></span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        )}
      </div>
    </StoryPage>
  );
}
