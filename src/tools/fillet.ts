/**
 * Fillet / chamfer tool.
 *  • Hover shows the nearest corner; click it (or click the two edges either side).
 *  • Corners next to arcs work too (a line running onto a "bump").
 *  • An existing fillet can be clicked again (or its two edges clicked) to change its size.
 *  • Then set the size with the mouse wheel, by following the cursor, or by typing — live preview.
 *  • Click (or Enter) to apply. "All corners" rounds every corner of the selected shape.
 */
import { type Point, P, dist, fmt, clean } from '../geometry/vec';
import { cornerAll, cornerLines, cornerAny, cornerArcPath, linesCorner, sizeFromSetback, maxSize, vertexCorner, unfillet, type CornerMode } from '../geometry/corner';
import { pieceToShape, explodePath } from '../geometry/trim';
import { segsOf, segPrim, arcBulge } from '../geometry/path';
import { nearestOnPrim, type Prim } from '../geometry/entity';
import type { Tool, Overlay } from '../editor/tool';
import type { Editor } from '../editor/editor';
import type { Entity, Shape } from '../model/types';

type Target =
  | { kind: 'vertex'; id: string; i: number; V: Point; theta: number }
  | { kind: 'refillet'; id: string; k: number; V: Point; theta: number; r0: number }
  | { kind: 'lines'; idA: string; clickA: Point; idB: string; clickB: Point; V: Point; theta: number; remove?: string; r0?: number }
  | { kind: 'pair'; idA: string; idB: string; V: Point; theta: number };

const ICON = '<path d="M4 20V12a8 8 0 0 1 8-8h8"/><path d="M4 8V4h4" stroke-dasharray="2 2"/>';
const mode = (ed: Editor) => ed.opt.filletMode as CornerMode;
type LineE = Extract<Entity, { type: 'line' }>; type ArcE = Extract<Entity, { type: 'arc' }>;
const arcEnds = (a: { c: Point; r: number; a0: number; a1: number }) => [P(a.c.x + a.r * Math.cos(a.a0), a.c.y + a.r * Math.sin(a.a0)), P(a.c.x + a.r * Math.cos(a.a1), a.c.y + a.r * Math.sin(a.a1))];
const T = 1e-6;

/** A separate arc that joins the near ends of two lines (an earlier two-line fillet). */
function filletArcBetween(ed: Editor, A: LineE, B: LineE): ArcE | null {
  for (const e of ed.doc.ents) {
    if (e.type !== 'arc' || !ed.store.usable(e)) continue;
    const [p0, p1] = arcEnds(e), onA = (p: Point) => dist(p, A.a) < T || dist(p, A.b) < T, onB = (p: Point) => dist(p, B.a) < T || dist(p, B.b) < T;
    if ((onA(p0) && onB(p1)) || (onA(p1) && onB(p0))) return e;
  }
  return null;
}
/** Two lines joined by a fillet arc → a target that replaces the arc with a new one. */
function linesTarget(A: LineE, clickA: Point, B: LineE, clickB: Point, arc?: ArcE | null): Target | { error: string } {
  const g = linesCorner(A, clickA, B, clickB); if ('error' in g) return { error: g.error! };
  return { kind: 'lines', idA: A.id, clickA, idB: B.id, clickB, V: g.X, theta: g.theta, remove: arc?.id, r0: arc?.r };
}
const farEnd = (l: LineE, near: Point) => dist(l.a, near) < dist(l.b, near) ? l.b : l.a;

/** Nearest corner or existing fillet to the cursor (within px). */
function hoverCorner(ed: Editor, raw: Point, px = 12): Target | null {
  const tol = px / ed.view.k; let best = null as { t: Target; d: number } | null;
  const bd = () => best ? best.d : Infinity;
  const take = (t: Target, d: number) => { if (d <= tol && (!best || d < best.d)) best = { t, d }; };
  const ents = ed.doc.ents.filter(e => ed.store.usable(e));
  const lines = ents.filter(e => e.type === 'line') as LineE[], arcs = ents.filter(e => e.type === 'arc') as ArcE[];
  for (const e of ents) {
    if (e.type !== 'poly' || e.pts.length > 400) continue;
    e.pts.forEach((v, i) => { const d = dist(v, raw); if (d <= tol) { const c = vertexCorner(e, i); if (c) take({ kind: 'vertex', id: e.id, i, V: v, theta: c.theta }, d); } });
    segsOf(e).forEach((s, k) => {
      if (s.kind !== 'arc') return;
      const d = dist(raw, nearestOnPrim(raw, segPrim(s) as Prim)) + 0.5 * tol; if (d > tol) return;
      const u = unfillet(e, k); if (!u) return; const c = vertexCorner(u.path, u.i); if (!c) return;
      take({ kind: 'refillet', id: e.id, k, V: u.path.pts[u.i], theta: c.theta, r0: u.r }, d);
    });
  }
  // separate lines (and arcs) that share an end
  const opens = [...lines, ...arcs] as (LineE | ArcE)[];
  const ends = (e: LineE | ArcE) => e.type === 'line' ? [e.a, e.b] : arcEnds(e);
  for (let i = 0; i < opens.length; i++) for (let j = i + 1; j < opens.length; j++) {
    const A = opens[i], B = opens[j];
    for (const pa of ends(A)) for (const pb of ends(B)) {
      if (dist(pa, pb) > T) continue; const d = dist(pa, raw); if (d > tol || d >= bd()) continue;
      if (A.type === 'line' && B.type === 'line') { const t = linesTarget(A, farEnd(A, pa), B, farEnd(B, pb)); if (!('error' in t)) take(t, d); }
      else { const pc = pairPath(A, B, pa); if (pc) { const c = vertexCorner(pc, 1); if (c) take({ kind: 'pair', idA: A.id, idB: B.id, V: pa, theta: c.theta }, d); } }
    }
  }
  // an earlier two-line fillet arc: hover the arc to change it
  for (const a of arcs) {
    const d = dist(raw, nearestOnPrim(raw, { t: 'arc', c: a.c, r: a.r, a0: a.a0, a1: a.a1 })) + 0.5 * tol; if (d > tol || d >= bd()) continue;
    const [p0, p1] = arcEnds(a), A = lines.find(l => dist(l.a, p0) < T || dist(l.b, p0) < T), B = lines.find(l => l !== A && (dist(l.a, p1) < T || dist(l.b, p1) < T));
    if (!A || !B) continue;
    const t = linesTarget(A, farEnd(A, p0), B, farEnd(B, p1), a); if (!('error' in t)) take(t, d);
  }
  return best ? (best as { t: Target }).t : null;
}

/** Two separate pieces (line/arc) meeting at V as a 3-point path: far end of A → V → far end of B. */
function pairPath(A: LineE | ArcE, B: LineE | ArcE, V: Point) {
  const piece = (e: LineE | ArcE): { far: Point; b: number } => {
    if (e.type === 'line') return { far: dist(e.a, V) < T ? e.b : e.a, b: 0 };
    const [p0, p1] = arcEnds(e), b = arcBulge(e.a0, e.a1);
    return dist(p1, V) < T ? { far: p0, b } : { far: p1, b: -b };  // bulge for travel far → V
  };
  const a = piece(A), b = piece(B);
  return { pts: [a.far, V, b.far], bulge: [a.b, -b.b], closed: false };
}

function size(ed: Editor, t: Target) {
  if (!ed.opt.filletFollow) return Math.max(0.001, +ed.opt.filletR || 0);
  const s = sizeFromSetback(t.theta, dist(ed.cur, t.V), mode(ed)), A = ed.doc.aids, st = (A.gridLock || A.stepLock) ? A.step : 0.01;
  ed.opt.filletR = clean(Math.max(st, Math.round(s / st) * st)); return ed.opt.filletR;
}

type Result = { replace: [string, Shape][]; add: Shape[]; remove: string[] };
/** Shapes produced for a target, or an error. */
export function cornerResult(ed: Editor, t: Target, sz: number): Result | { error: string } {
  const m = mode(ed);
  if (t.kind === 'vertex' || t.kind === 'refillet') {
    const e = ed.store.byId(t.id) as any; if (!e) return { error: 'Shape not found' };
    let src = e, i = t.kind === 'vertex' ? t.i : 0;
    if (t.kind === 'refillet') { const u = unfillet(e, t.k); if (!u) return { error: 'This is not a fillet between two straight edges' }; src = u.path; i = u.i; }
    const r = cornerAny(src, i, sz, m); if ('error' in r) return r;
    return { replace: [[t.id, pieceToShape(r.pts, r.bulge, r.closed)]], add: [], remove: [] };
  }
  if (t.kind === 'pair') {
    if (m === 'chamfer') return { error: 'Chamfer needs two straight edges — use Fillet next to curves' };
    const A = ed.store.byId(t.idA) as any, B = ed.store.byId(t.idB) as any; if (!A || !B) return { error: 'Shape not found' };
    const r = cornerArcPath(pairPath(A, B, t.V), 1, sz); if ('error' in r) return r;
    const parts = explodePath(r);
    return { replace: [[t.idA, parts[0]], [t.idB, parts[parts.length - 1]]], add: parts.slice(1, -1), remove: [] };
  }
  const A = ed.store.byId(t.idA) as any, B = ed.store.byId(t.idB) as any;
  const r = cornerLines(A, t.clickA, B, t.clickB, sz, m); if ('error' in r) return r;
  return { replace: [[t.idA, r.lineA], [t.idB, r.lineB]], add: [r.join], remove: t.remove ? [t.remove] : [] };
}
export function applyCorner(ed: Editor, t: Target, sz: number): boolean {
  const r = cornerResult(ed, t, sz); if ('error' in r) { ed.toast(r.error); return false; }
  const first = ed.store.byId(t.kind === 'lines' || t.kind === 'pair' ? t.idA : t.id)!;
  ed.store.change(() => {
    for (const [id, s] of r.replace) ed.store.replace(id, s);
    if (r.remove.length) ed.store.remove(r.remove);
    for (const s of r.add) { const n = ed.store.add(s, { layer: first.layer, color: first.color, w: first.w }); if (first.group?.length) n.group = first.group.slice(); }
  });
  return true;
}
/** Round/cut every corner of the selected paths. */
export function applyAllCorners(ed: Editor) {
  const paths = ed.selected().filter(e => e.type === 'poly') as any[];
  if (!paths.length) { ed.toast('Select a rectangle or path first, then press All corners'); return; }
  let done = 0, skipped = 0;
  ed.store.change(() => { for (const e of paths) { const r = cornerAll(e, +ed.opt.filletR, mode(ed)); done += r.done; skipped += r.skipped; ed.store.replace(e.id, pieceToShape(r.path.pts, r.path.bulge, r.path.closed)); } });
  ed.toast(`${mode(ed) === 'fillet' ? 'Rounded' : 'Chamfered'} ${done} corner${done === 1 ? '' : 's'}${skipped ? ` · ${skipped} too small for ${fmt(+ed.opt.filletR, 3)} mm` : ''}`);
}

/** Second edge clicked: work out the corner between the two picked edges. */
function twoEdges(ed: Editor, first: { id: string; click: Point; seg: number }, second: { id: string; click: Point; seg: number }): Target | { error: string } {
  const A = ed.store.byId(first.id) as any, B = ed.store.byId(second.id) as any;
  if (A.type === 'poly' && A.id === B.id) {
    const n = segsOf(A).length, a = first.seg, b = second.seg, adj = (x: number, y: number) => (x + 1) % n === y && (A.closed || x + 1 < n);
    if (adj(a, b) || adj(b, a)) { const i = adj(a, b) ? b : a, c = vertexCorner(A, i); return c ? { kind: 'vertex', id: A.id, i, V: A.pts[i], theta: c.theta } : { error: 'These edges already meet smoothly' }; }
    for (const [x, y] of [[a, b], [b, a]]) {
      const k = (x + 1) % n;
      if ((k + 1) % n === y && (A.closed || x + 2 < n)) { const u = unfillet(A, k); if (u) { const c = vertexCorner(u.path, u.i)!; return { kind: 'refillet', id: A.id, k, V: u.path.pts[u.i], theta: c.theta, r0: u.r }; } }
    }
    return { error: 'Click two edges either side of one corner (or of one fillet)' };
  }
  if (A.type === 'line' && B.type === 'line') return linesTarget(A, first.click, B, second.click, filletArcBetween(ed, A, B));
  if ((A.type === 'line' || A.type === 'arc') && (B.type === 'line' || B.type === 'arc')) {
    const ea = A.type === 'line' ? [A.a, A.b] : arcEnds(A), eb = B.type === 'line' ? [B.a, B.b] : arcEnds(B);
    for (const pa of ea) for (const pb of eb) if (dist(pa, pb) < T) { const c = vertexCorner(pairPath(A, B, pa), 1); if (c) return { kind: 'pair', idA: A.id, idB: B.id, V: pa, theta: c.theta }; }
    return { error: 'A line and an arc must touch end to end to be filleted' };
  }
  return { error: 'Click two lines, or two edges of the same shape next to the corner' };
}
function pickEdge(ed: Editor, raw: Point): { id: string; click: Point; seg: number } | null {
  const hit = ed.pick(raw, undefined, e => e.type === 'line' || e.type === 'arc' || e.type === 'poly'); if (!hit) return null;
  let seg = 0;
  if (hit.e.type === 'poly') { let bd = Infinity; segsOf(hit.e).forEach((s, k) => { const d = dist(raw, nearestOnPrim(raw, segPrim(s) as Prim)); if (d < bd) { bd = d; seg = k; } }); }
  return { id: hit.e.id, click: raw, seg };
}
function select(ed: Editor, t: Target) {
  const S = ed.state; S.target = t; S.firstLine = null;
  const r0 = t.kind === 'refillet' ? t.r0 : t.kind === 'lines' ? t.r0 : undefined;
  if (r0 && !ed.opt.filletFollow) { ed.opt.filletR = clean(Math.round(r0 * 1000) / 1000); ed.changed('opts'); }
  ed.changed('prompt');
}

export const filletTool: Tool = {
  id: 'fillet', label: 'Fillet / chamfer', key: 'E', icon: ICON, group: 3,
  options: [
    { key: 'filletMode', label: 'Corner', type: 'seg', choices: [['fillet', 'Fillet (round)'], ['chamfer', 'Chamfer (cut)']] },
    { key: 'filletR', label: 'Size', type: 'number', min: 0.01, unit: 'mm' },
    { key: 'filletFollow', label: 'Follow cursor', type: 'check' },
    { key: 'filletAll', label: 'All corners of selection', type: 'button', run: ed => applyAllCorners(ed) },
    { key: 'filletHint', label: 'Wheel ±0.5 · Shift+wheel ±0.1 · click a fillet again to resize it', type: 'hint' },
  ],
  prompt: ed => ed.state.target ? 'Wheel, cursor or typed size · click (or Enter) to apply · Esc to cancel'
    : ed.state.firstLine ? 'Click the second edge' : 'Click a corner or an existing fillet, or click the two edges either side',
  down(ed, raw) {
    const S = ed.state;
    if (S.target) { if (applyCorner(ed, S.target, size(ed, S.target))) S.target = null; ed.changed('prompt'); return; }
    const c = hoverCorner(ed, raw); if (c) { select(ed, c); return; }
    const hit = pickEdge(ed, raw);
    if (!hit) { ed.toast('Click a corner, a fillet, or an edge'); return; }
    if (!S.firstLine) { S.firstLine = hit; ed.changed('prompt'); return; }
    if (hit.id === S.firstLine.id && hit.seg === S.firstLine.seg) return;
    const t = twoEdges(ed, S.firstLine, hit);
    if ('error' in t) { ed.toast(t.error); S.firstLine = null; ed.changed('prompt'); return; }
    select(ed, t);
  },
  wheel(ed, dir, info) {
    if (!ed.state.target) return false;
    const st = info.shift ? 0.1 : 0.5; ed.opt.filletFollow = false;
    ed.opt.filletR = clean(Math.max(0.1, Math.round((+ed.opt.filletR + dir * st) * 1000) / 1000)); ed.changed('opts'); return true;
  },
  finish(ed) { const S = ed.state; if (S.target && applyCorner(ed, S.target, size(ed, S.target))) { S.target = null; ed.changed('prompt'); } },
  cancel(ed) { const S = ed.state; if (S.target || S.firstLine) { S.target = null; S.firstLine = null; ed.changed('prompt'); return true; } return false; },
  overlay(ed, o: Overlay) {
    const S = ed.state;
    if (S.firstLine) o.highlight([S.firstLine.id], 'source');
    const t: Target | null = S.target || (ed.hover ? hoverCorner(ed, ed.cur) : null);
    if (!t) return;
    if (!S.target) {
      o.custom((ctx, ed2, C) => { const s = ed2.w2s(t.V); ctx.strokeStyle = C['--snap']; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(s.x, s.y, 7, 0, Math.PI * 2); ctx.stroke(); });
      const r0 = t.kind === 'refillet' || t.kind === 'lines' ? t.r0 : undefined;
      o.label(r0 ? `Fillet R ${fmt(r0, 2)} — click to change it` : 'Corner — click to select', t.V); return;
    }
    const sz = size(ed, t), r = cornerResult(ed, t, sz);
    if ('error' in r) { o.label(r.error, t.V); return; }
    o.hide(r.replace.map(x => x[0]).concat(r.remove));
    for (const [, s] of r.replace) o.ghost(s, 'selected');
    for (const s of r.add) o.ghost(s, 'selected');
    o.label(`${mode(ed) === 'fillet' ? 'R' : 'C'} ${fmt(sz, 3)} mm`, t.V);
  },
};
export { maxSize, P };
