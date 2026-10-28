/**
 * Delete Part (trim): remove the piece of a shape between the two nearest
 * crossings/ends around the clicked point. Pure function — the caller supplies
 * the primitives of every other shape that can cut. Paths keep their true arcs.
 */
import { type Point, add, sub, mul, dot, dist, normA, angOf, cp, clean } from './vec';
import { prims, intersect, flatten, nearestOnPrim, type Prim } from './entity';
import { segsOf, segPrim, segParam, subPath, type PSeg, type PathLike } from './path';
import type { Shape } from '../model/types';

export type TrimMode = 'whole' | 'segments';

/** Break a path into separate lines and arcs. */
export function explodePath(p: PathLike): Shape[] {
  return segsOf(p).map(s => {
    if (s.kind === 'seg') return { type: 'line', a: s.a, b: s.b } as Shape;
    const pr = segPrim(s) as any; return { type: 'arc', c: cp(s.c), r: clean(s.r), a0: pr.a0, a1: pr.a1 } as Shape;
  });
}
/** A single path piece becomes a simple line/arc; otherwise a path. */
export function pieceToShape(pts: Point[], bulge: number[], closed = false): Shape {
  if (!closed && pts.length === 2) {
    if (Math.abs(bulge[0] || 0) < 1e-12) return { type: 'line', a: pts[0], b: pts[1] } as Shape;
    return explodePath({ pts, closed: false, bulge })[0];
  }
  const out: any = { type: 'poly', closed, pts };
  if (bulge.some(b => Math.abs(b) > 1e-12)) out.bulge = bulge;
  return out as Shape;
}

/** Extra "touch" cuts: ends of open shapes that land on (or within tol of) the trimmed shape. */
export interface Touch { pts: Point[]; tol: number }
export type TrimResult = { keep: Shape[]; removed: Shape[] } | { error: string };

/** Returns the replacement shapes (empty = shape fully removed), or null if the shape type cannot be trimmed.
 *  A closed shape with fewer than two crossings is left unchanged (returns [e]). */
export function trimShape(e: Shape, click: Point, cutters: Prim[], mode: TrimMode = 'whole', touch?: Touch): Shape[] | null {
  if (e.type === 'dim') return null;
  const r = trimInfo(e, click, cutters, mode, touch);
  return 'error' in r ? [e] : r.keep;
}

/** Merge near-identical sorted values. */
const uniq = (v: number[], tol = 1e-6) => { const s = v.slice().sort((a, b) => a - b), o: number[] = []; for (const x of s) if (!o.length || x - o[o.length - 1] > tol) o.push(x); return o; };
const touchesOn = (my: Prim[], touch?: Touch) => { const out: Point[] = []; if (!touch) return out; for (const p of touch.pts) for (const m of my) { const q = nearestOnPrim(p, m); if (dist(p, q) <= touch.tol) out.push(cp(q)); } return out; };

/** Trim with full detail: the pieces kept, the pieces removed (for preview), or why it can't be done. */
export function trimInfo(e: Shape, click: Point, cutters: Prim[], mode: TrimMode = 'whole', touch?: Touch): TrimResult {
  if (e.type === 'dim') return { error: 'Dimensions cannot be trimmed' };
  if (e.type === 'ellipse') e = { ...(e as any), type: 'poly', closed: true, pts: flatten(e).pts.map(cp) } as Shape;
  if (e.type === 'poly' && mode === 'segments') {
    const parts = explodePath(e);
    let bi = 0, bd = Infinity;
    parts.forEach((l, i) => { const d = Math.min(...prims(l).map(pr => dist(click, nearestOnPrim(click, pr)))); if (d < bd) { bd = d; bi = i; } });
    const others = cutters.concat(parts.filter((_, i) => i !== bi).flatMap(l => prims(l)));
    const r = trimInfo(parts[bi], click, others, 'whole', touch);
    if ('error' in r) return r;
    return { keep: parts.slice(0, bi).concat(r.keep, parts.slice(bi + 1)), removed: r.removed };
  }
  const cutsOf = (my: Prim[]) => { const out: Point[] = []; for (const m of my) for (const c of cutters) out.push(...intersect(m, c)); return out.concat(touchesOn(my, touch)); };
  if (e.type === 'line') {
    const cuts = cutsOf(prims(e)), d = sub(e.b, e.a), L = dot(d, d), tAt = (p: Point) => dot(sub(p, e.a), d) / L, tc = tAt(click);
    const ts = uniq(cuts.map(tAt).filter(t => t > 1e-9 && t < 1 - 1e-9), 1e-9);
    const lo = Math.max(0, ...ts.filter(t => t < tc)), hi = Math.min(1, ...ts.filter(t => t > tc));
    const at = (t: number) => cp(add(e.a, mul(d, t))), keep: Shape[] = [];
    if (lo > 0) keep.push({ type: 'line', a: e.a, b: at(lo) } as Shape);
    if (hi < 1) keep.push({ type: 'line', a: at(hi), b: e.b } as Shape);
    return { keep, removed: [{ type: 'line', a: lo > 0 ? at(lo) : e.a, b: hi < 1 ? at(hi) : e.b } as Shape] };
  }
  if (e.type === 'circle') {
    const cuts = cutsOf(prims(e)), ac = angOf(e.c, click);
    let as = uniq(cuts.map(p => normA(angOf(e.c, p))), 1e-9);
    if (as.length > 1 && as[as.length - 1] - as[0] > 2 * Math.PI - 1e-9) as = as.slice(1);
    if (as.length < 2) return { error: closedMsg(as.length) };
    const ds = as.map(a => ({ a, d: normA(a - ac) })).sort((x, y) => x.d - y.d);
    const first = ds[0].a, last = ds[ds.length - 1].a;
    return { keep: [{ type: 'arc', c: e.c, r: e.r, a0: first, a1: last } as Shape], removed: [{ type: 'arc', c: e.c, r: e.r, a0: last, a1: first } as Shape] };
  }
  if (e.type === 'arc') {
    const cuts = cutsOf(prims(e)), span = normA(e.a1 - e.a0), sAt = (p: Point) => normA(angOf(e.c, p) - e.a0), sc = sAt(click);
    const ss = uniq(cuts.map(sAt).filter(s => s > 1e-9 && s < span - 1e-9), 1e-9);
    const lo = Math.max(0, ...ss.filter(s => s < sc)), hi = Math.min(span, ...ss.filter(s => s > sc)), keep: Shape[] = [];
    if (lo > 1e-9) keep.push({ type: 'arc', c: e.c, r: e.r, a0: e.a0, a1: normA(e.a0 + lo) } as Shape);
    if (hi < span - 1e-9) keep.push({ type: 'arc', c: e.c, r: e.r, a0: normA(e.a0 + hi), a1: e.a1 } as Shape);
    return { keep, removed: [{ type: 'arc', c: e.c, r: e.r, a0: normA(e.a0 + lo), a1: normA(e.a0 + hi) } as Shape] };
  }
  if (e.type === 'poly') return trimPath(e, click, cutters, touch);
  return { error: 'This object cannot be trimmed' };
}
const closedMsg = (n: number) => n === 0
  ? 'Nothing crosses this closed shape, so there is nothing to trim back to. To remove it, select it and press Delete.'
  : 'Only one crossing on this closed shape — trimming needs two. Zoom in and check the shapes really cross.';

/** Trim a path as a whole between the two nearest cuts around the click. */
function trimPath(e: PathLike, click: Point, cutters: Prim[], touch?: Touch): TrimResult {
  const segs = segsOf(e), cum = [0];
  for (const s of segs) cum.push(cum[cum.length - 1] + s.len);
  const total = cum[segs.length];
  // where along the path the click is
  let bi = 0, bd = Infinity, bt = 0;
  segs.forEach((s, i) => { const pr = segPrim(s) as Prim, q = nearestOnPrim(click, pr), d = dist(click, q); if (d < bd) { bd = d; bi = i; bt = clamp01(segParam(s, q)); } });
  const sc = cum[bi] + bt * segs[bi].len;
  // every cut along the path, as arc-length positions
  const cuts: { s: number; p: Point }[] = [];
  segs.forEach((s, i) => {
    const pr = segPrim(s) as Prim, box = segBox(s);
    for (const c of cutters) {
      if (c.t === 'seg' && (Math.max(c.a.x, c.b.x) < box.x0 || Math.min(c.a.x, c.b.x) > box.x1 || Math.max(c.a.y, c.b.y) < box.y0 || Math.min(c.a.y, c.b.y) > box.y1)) continue;
      for (const p of intersect(pr, c)) cuts.push({ s: cum[i] + clamp01(segParam(s, p)) * s.len, p: cp(p) });
    }
    for (const p of touchesOn([pr], touch)) cuts.push({ s: cum[i] + clamp01(segParam(s, p)) * s.len, p });
  });
  const exact = (s: number) => cuts.find(c => Math.abs(c.s - s) < 1e-6)?.p;
  if (!e.closed) {
    const ss = uniq(cuts.map(c => c.s).filter(s => s > 1e-7 && s < total - 1e-7));
    const lo = Math.max(0, ...ss.filter(s => s < sc)), hi = Math.min(total, ...ss.filter(s => s > sc)), keep: Shape[] = [];
    if (lo > 1e-7) { const p = subPath(e, 0, lo, exact); keep.push(pieceToShape(p.pts, p.bulge)); }
    if (hi < total - 1e-7) { const p = subPath(e, hi, total, exact); keep.push(pieceToShape(p.pts, p.bulge)); }
    const r = subPath(e, lo, hi, exact);
    return { keep, removed: r.pts.length > 1 ? [pieceToShape(r.pts, r.bulge)] : [] };
  }
  let ss = uniq(cuts.map(c => ((c.s % total) + total) % total));
  if (ss.length > 1 && ss[ss.length - 1] - ss[0] > total - 1e-6) ss = ss.slice(1);
  if (ss.length < 2) return { error: closedMsg(ss.length) };
  const below = ss.filter(s => s < sc), above = ss.filter(s => s > sc);
  const lo = below.length ? Math.max(...below) : Math.max(...ss), hi = above.length ? Math.min(...above) : Math.min(...ss);
  const ex = (s: number) => exact(s) ?? exact(s - total) ?? exact(s + total);
  const p = subPath(e, hi, lo > hi ? lo : lo + total, ex);
  const r = subPath(e, lo, lo < hi ? hi : hi + total, ex);
  return { keep: [pieceToShape(p.pts, p.bulge)], removed: [pieceToShape(r.pts, r.bulge)] };
}
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
function segBox(s: PSeg) {
  if (s.kind === 'seg') return { x0: Math.min(s.a.x, s.b.x) - 1e-6, x1: Math.max(s.a.x, s.b.x) + 1e-6, y0: Math.min(s.a.y, s.b.y) - 1e-6, y1: Math.max(s.a.y, s.b.y) + 1e-6 };
  return { x0: s.c.x - s.r - 1e-6, x1: s.c.x + s.r + 1e-6, y0: s.c.y - s.r - 1e-6, y1: s.c.y + s.r + 1e-6 };
}
