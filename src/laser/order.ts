/**
 * Cut order for laser jobs (clean-room).
 *
 *  1. Every visible shape in a laser colour becomes a path (text → its letter outlines).
 *  2. Whole shapes drawn twice (or a score line lying on a cut line) are removed.
 *  3. Open lines of the same colour that touch end to end (within 0.05 mm) are joined into one path.
 *  4. Order: engrave areas → engraved lines → cuts. Within cuts, anything inside a closed cut
 *     (holes, inner cut-outs) is cut before the outline around it, so parts never drop or shift
 *     before their holes are made. Within those rules, the nearest next path is chosen, closed
 *     shapes start at their nearest sharp corner and open lines start at their nearer end.
 */
import { type Point, P, dist } from '../geometry/vec';
import { expandText } from '../text/text';
import { modeOf, type Doc, type Shape, type ColorKey, type LaserMode, type Entity } from '../model/types';
import { type Seg, type Loop, shapeSegs, sampleSegs, reverseSegs, loopSegs, nearestOnLoop, turnAt, ellAt } from './segs';
import type { LaserKey } from './palette';

export type Phase = 'engrave' | 'score' | 'cut';
export const PHASES: Phase[] = ['engrave', 'score', 'cut'];
export const PHASE_LABEL: Record<Phase, string> = { engrave: 'Engrave area', score: 'Engrave line', cut: 'Cut' };

export interface LPath {
  /** stroke = follow the line; area = engrave (fill) the inside of the rings */
  kind: 'stroke' | 'area';
  key: LaserKey; phase: Phase; w: number;
  /** stroke: one subpath; area: one or more rings (even-odd) */
  rings: Seg[][];
  closed: boolean;
  loop?: Loop;
  /** source object ids (for showing / testing) */
  ids: string[];
  /** points along the path (0.02 mm chords), for containment and checks */
  pts: Point[];
  box: { x0: number; y0: number; x1: number; y1: number };
}

export interface OrderOptions {
  /** engrave paint-bucket fills (default no: they colour the drawing on screen) */
  fills?: boolean;
  /** where the laser head starts (default: top-left corner of the sheet) */
  start?: Point;
  joinTol?: number;
}
export interface OrderResult {
  paths: LPath[];
  /** the same paths in the order the objects were drawn (for comparison) */
  drawn: LPath[];
  travel: number; travelDrawn: number;
  joined: { from: number; to: number };
  removed: number;
  /** pairs where something inside a closed cut is cut after it (should be 0) */
  insideAfter: number;
  /** how many shapes have something cut inside them, and how many things are inside a cut */
  outlinesWithInside: number;
}

const phaseOf = (m: LaserMode): Phase | null => m === 'cut' ? 'cut' : m === 'score' ? 'score' : m === 'fill' ? 'engrave' : null;
const boxOf = (pts: Point[]) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of pts) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; } return { x0, y0, x1, y1 }; };
const startOf = (p: LPath) => p.rings[0][0].a, endOf = (p: LPath) => { const r = p.rings[0]; return r[r.length - 1].b; };

function mk(kind: LPath['kind'], key: LaserKey, phase: Phase, w: number, rings: Seg[][], closed: boolean, ids: string[], loop?: Loop): LPath {
  const pts = rings.flatMap(r => sampleSegs(r));
  return { kind, key, phase, w, rings, closed, loop, ids, pts, box: boxOf(pts) };
}

/** All laser paths of a drawing, in the order the objects were drawn (nothing joined or removed). */
export function laserPaths(doc: Doc, o: OrderOptions = {}): LPath[] {
  const visible = new Set(doc.layers.filter(l => l.visible).map(l => l.id)), out: LPath[] = [];
  for (const e of doc.ents as Entity[]) {
    if (!visible.has(e.layer) || e.type === 'dim') continue;
    if (e.type === 'fill') {
      if (!o.fills) continue;
      const rings = e.rings.filter(r => r.length >= 3).map(r => r.map((p, i) => ({ k: 'L', a: p, b: r[(i + 1) % r.length] }) as Seg));
      if (rings.length) out.push(mk('area', 'paint', 'engrave', e.w, rings, true, [e.id]));
      continue;
    }
    const ph = phaseOf(modeOf(doc, e.color)); if (!ph) continue;
    const parts = expandText([e as Shape]).map(s => shapeSegs(s)).filter(Boolean) as NonNullable<ReturnType<typeof shapeSegs>>[];
    if (ph === 'engrave') {
      // closed shapes (and all the letters of a text) are engraved as areas; open lines are engraved as lines
      const closed = parts.filter(p => p.closed), open = parts.filter(p => !p.closed);
      if (closed.length) out.push(mk('area', e.color, 'engrave', e.w, closed.map(p => p.segs), true, [e.id]));
      for (const p of open) out.push(mk('stroke', e.color, 'engrave', e.w, [p.segs], false, [e.id]));
    } else for (const p of parts) out.push(mk('stroke', e.color, ph, e.w, [p.segs], p.closed, [e.id], p.loop));
  }
  return out;
}

/** Join open lines of the same colour that meet end to end. */
export function joinPaths(paths: LPath[], tol = 0.05): { paths: LPath[]; from: number; to: number } {
  const open = paths.filter(p => p.kind === 'stroke' && !p.closed), rest = paths.filter(p => !open.includes(p));
  const cell = (q: Point) => `${Math.round(q.x / tol)},${Math.round(q.y / tol)}`, grid = new Map<string, number[]>();
  open.forEach((p, i) => { for (const q of [startOf(p), endOf(p)]) { const k = cell(q); (grid.get(k) || grid.set(k, []).get(k)!).push(i); } });
  const used = new Array(open.length).fill(false);
  const near = (q: Point, key: LaserKey, phase: Phase): { i: number; rev: boolean } | null => {
    const cx = Math.round(q.x / tol), cy = Math.round(q.y / tol); let best: { i: number; rev: boolean } | null = null, bd = tol;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const i of grid.get(`${cx + dx},${cy + dy}`) || []) {
      const p = open[i]; if (used[i] || p.key !== key || p.phase !== phase) continue;
      const d0 = dist(q, startOf(p)), d1 = dist(q, endOf(p));
      if (d0 <= bd) { bd = d0; best = { i, rev: false }; } if (d1 < bd) { bd = d1; best = { i, rev: true }; }
    }
    return best;
  };
  const link = (segs: Seg[], next: Seg[]) => { const e = segs[segs.length - 1].b, s = next[0].a; if (dist(e, s) > 1e-9) segs.push({ k: 'L', a: e, b: s }); segs.push(...next); };
  const joined: LPath[] = []; let from = 0, to = 0;
  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue; used[i] = true;
    const p = open[i], ids = [...p.ids]; let segs = [...p.rings[0]], n = 1;
    for (;;) { const m = near(segs[segs.length - 1].b, p.key, p.phase); if (!m) break; used[m.i] = true; n++; ids.push(...open[m.i].ids); link(segs, m.rev ? reverseSegs(open[m.i].rings[0]) : open[m.i].rings[0]); }
    for (;;) { const m = near(segs[0].a, p.key, p.phase); if (!m) break; used[m.i] = true; n++; ids.unshift(...open[m.i].ids); const t = m.rev ? [...open[m.i].rings[0]] : reverseSegs(open[m.i].rings[0]); link(t, segs); segs = t; }
    const closed = n > 1 && dist(segs[segs.length - 1].b, segs[0].a) <= tol;
    if (closed && dist(segs[segs.length - 1].b, segs[0].a) > 1e-9) segs.push({ k: 'L', a: segs[segs.length - 1].b, b: segs[0].a });
    if (n > 1) { from += n; to++; }
    joined.push(n === 1 ? p : mk('stroke', p.key, p.phase, p.w, [segs], closed, ids));
  }
  return { paths: [...rest, ...joined], from, to };
}

/** Largest distance from any point of a to the polyline b (one way). */
function farFrom(a: Point[], b: Point[], lim: number): number {
  let worst = 0;
  for (const p of a) {
    let best = Infinity;
    for (let i = 0; i + 1 < b.length && best > 1e-9; i++) {
      const u = b[i], v = b[i + 1], dx = v.x - u.x, dy = v.y - u.y, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((p.x - u.x) * dx + (p.y - u.y) * dy) / L)) : 0;
      const d = Math.hypot(p.x - u.x - t * dx, p.y - u.y - t * dy); if (d < best) best = d;
    }
    if (b.length === 1) best = dist(p, b[0]);
    if (best > worst) { worst = best; if (worst > lim) return worst; }
  }
  return worst;
}
const STRENGTH: Record<Phase, number> = { engrave: 0, score: 1, cut: 2 };

/** Remove whole lines/shapes drawn twice (within tol), keeping the strongest (cut over score). */
export function removeDoubles(paths: LPath[], tol = 0.02): { paths: LPath[]; removed: number } {
  const strokes = paths.filter(p => p.kind === 'stroke'), gone = new Set<LPath>();
  const order = strokes.slice().sort((a, b) => STRENGTH[b.phase] - STRENGTH[a.phase]);
  for (let i = 0; i < order.length; i++) {
    const a = order[i]; if (gone.has(a)) continue;
    for (let j = i + 1; j < order.length; j++) {
      const b = order[j]; if (gone.has(b)) continue;
      if (Math.abs(a.box.x0 - b.box.x0) > tol || Math.abs(a.box.y0 - b.box.y0) > tol || Math.abs(a.box.x1 - b.box.x1) > tol || Math.abs(a.box.y1 - b.box.y1) > tol) continue;
      if (b.phase === 'engrave') continue;   // an engraved line under a cut is unusual but deliberate enough to keep
      if (farFrom(b.pts, a.pts, tol) <= tol && farFrom(a.pts, b.pts, tol) <= tol) gone.add(b);
    }
  }
  return { paths: paths.filter(p => !gone.has(p)), removed: gone.size };
}

function inPoly(p: Point, poly: Point[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c; }
  return c;
}
const areaOf = (b: LPath['box']) => (b.x1 - b.x0) * (b.y1 - b.y0);
/** Is path p inside closed path q? (its box inside q's box and most of its sample points inside q) */
export function isInside(p: LPath, q: LPath): boolean {
  if (p === q || !q.closed || q.kind !== 'stroke') return false;
  const e = 1e-6, b = p.box, c = q.box;
  if (b.x0 < c.x0 - e || b.y0 < c.y0 - e || b.x1 > c.x1 + e || b.y1 > c.y1 + e || areaOf(b) >= areaOf(c) - 1e-9) return false;
  const n = p.pts.length, picks = [0, Math.floor(n / 3), Math.floor(2 * n / 3), Math.floor(n / 2)].map(i => p.pts[Math.min(i, n - 1)]);
  return picks.filter(x => inPoly(x, q.pts)).length * 2 > picks.length;
}

/** Best way to start a path when the head is at `at`: its start point and the path rotated/reversed to begin there. */
function bestStart(p: LPath, at: Point): { d: number; rings: Seg[][]; end: Point } {
  if (p.kind === 'area') { const s = p.rings[0][0].a; return { d: dist(at, s), rings: p.rings, end: s }; }
  const segs = p.rings[0];
  if (!p.closed) {
    const s = segs[0].a, e = segs[segs.length - 1].b, ds = dist(at, s), de = dist(at, e);
    return de < ds - 1e-9 ? { d: de, rings: [reverseSegs(segs)], end: s } : { d: ds, rings: [segs], end: e };
  }
  if (p.loop) { const t = nearestOnLoop(p.loop, at), s = ellAt(p.loop, t); return { d: dist(at, s), rings: [loopSegs(p.loop, t)], end: s }; }
  // closed: start at a sharp corner (> 30°) if there is one, else at any vertex — the nearest
  const n = segs.length, corner = (i: number) => turnAt(segs[(i - 1 + n) % n], segs[i]) > Math.PI / 6;
  let cand = Array.from({ length: n }, (_, i) => i).filter(corner); if (!cand.length) cand = Array.from({ length: n }, (_, i) => i);
  let bi = cand[0], bd = Infinity; for (const i of cand) { const d = dist(at, segs[i].a); if (d < bd) { bd = d; bi = i; } }
  const r = [...segs.slice(bi), ...segs.slice(0, bi)]; return { d: bd, rings: [r], end: r[0].a };
}

/** Put paths in cut order (see top of file). */
export function orderPaths(paths: LPath[], start: Point): LPath[] {
  const out: LPath[] = []; let at = start;
  for (const ph of PHASES) {
    const items = paths.filter(p => p.phase === ph); if (!items.length) continue;
    // inside-first: an item can't be chosen while anything inside it is still waiting
    const waiting = new Map<LPath, number>(), outer = new Map<LPath, LPath[]>();
    if (ph === 'cut') {
      const closed = items.filter(q => q.closed && q.kind === 'stroke');
      for (const p of items) { const os = closed.filter(q => isInside(p, q)); outer.set(p, os); for (const q of os) waiting.set(q, (waiting.get(q) || 0) + 1); }
    }
    const left = new Set(items);
    while (left.size) {
      let best: LPath | null = null, bs: ReturnType<typeof bestStart> | null = null;
      for (const p of left) { if ((waiting.get(p) || 0) > 0) continue; const s = bestStart(p, at); if (!bs || s.d < bs.d) { bs = s; best = p; } }
      if (!best || !bs) { best = left.values().next().value!; bs = bestStart(best, at); }   // (can't happen: containment has no cycles)
      left.delete(best); for (const q of outer.get(best) || []) waiting.set(q, (waiting.get(q) || 0) - 1);
      const placed = { ...best, rings: bs.rings }; out.push(placed);
      const r = placed.rings[placed.rings.length - 1]; at = placed.kind === 'area' ? bs.end : (placed.closed ? r[0].a : r[r.length - 1].b);
    }
  }
  return out;
}

/** Distance travelled with the laser off, from `start` through the paths in this order. */
export function travelOf(paths: LPath[], start: Point): number {
  let at = start, t = 0;
  for (const p of paths) { t += dist(at, startOf(p)); at = p.kind === 'area' ? startOf(p) : (p.closed ? startOf(p) : endOf(p)); }
  return t;
}

/** How many times something inside a closed cut is done after that cut (holes after outlines). */
export function insideAfterCount(paths: LPath[]): { bad: number; outlines: number } {
  let bad = 0; const withIn = new Set<LPath>();
  paths.forEach((q, j) => {
    if (q.phase !== 'cut' || !q.closed || q.kind !== 'stroke') return;
    paths.forEach((p, i) => { if (i === j || !isInside(p, q)) return; withIn.add(q); if (i > j) bad++; });
  });
  return { bad, outlines: withIn.size };
}

/** The whole job: paths joined, doubles removed, in cut order, with the numbers for the report. */
export function cutOrder(doc: Doc, o: OrderOptions = {}): OrderResult {
  const start = o.start ?? P(0, doc.page.h);
  const drawn = laserPaths(doc, o);
  // doubles first, so a line drawn twice isn't joined to itself as a there-and-back path
  const { paths: once, removed } = removeDoubles(drawn);
  const j = joinPaths(once, o.joinTol ?? 0.05);
  const paths = orderPaths(j.paths, start), chk = insideAfterCount(paths);
  return {
    paths, drawn, travel: travelOf(paths, start), travelDrawn: travelOf(drawn, start),
    joined: { from: j.from, to: j.to },
    removed, insideAfter: chk.bad, outlinesWithInside: chk.outlines,
  };
}

export type { ColorKey };
