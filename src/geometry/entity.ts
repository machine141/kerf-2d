/**
 * Geometry of drawing entities: flattening, primitive segments/arcs,
 * intersections, distances, key points and bounding boxes.
 * Pure functions — no UI, no document state. (Candidate for a Rust/WASM kernel.)
 */
import { type Point, P, add, sub, mul, dot, dist, normA, angOf, polar, angIn, TAU, EPS } from './vec';
import type { Entity, Shape, EllipseEnt } from '../model/types';
import { flattenPath, hasBulge, segsOf, segPrim, segPoint } from './path';
import { flattenSpline } from './spline';

/** Chord tolerance used when curves must become polylines (mm). */
export const geomSettings = { flatTol: 0.0005 };

export type Prim =
  | { t: 'seg'; a: Point; b: Point }
  | { t: 'arc'; c: Point; r: number; a0: number; a1: number; full?: false }
  | { t: 'arc'; c: Point; r: number; full: true; a0?: number; a1?: number };

export const ellPt = (e: { c: Point; rx: number; ry: number; rot: number }, t: number) => {
  const c = Math.cos(e.rot), s = Math.sin(e.rot), x = e.rx * Math.cos(t), y = e.ry * Math.sin(t);
  return P(e.c.x + x * c - y * s, e.c.y + x * s + y * c);
};
export function nSeg(r: number, span: number, tol = geomSettings.flatTol) {
  if (r < 1e-9) return 2;
  const st = 2 * Math.acos(Math.max(-1, 1 - tol / r));
  return Math.max(2, Math.ceil(span / st));
}

const flatCache = new WeakMap<object, { key: string; v: { pts: Point[]; closed: boolean } }>();
/** Flatten any shape to a point list (curves → chords within tolerance). */
export function flatten(e: Shape, tol = geomSettings.flatTol): { pts: Point[]; closed: boolean } {
  if (e.type === 'line') return { pts: [e.a, e.b], closed: false };
  if (e.type === 'poly') {
    if (!hasBulge(e)) return { pts: e.pts, closed: !!e.closed };
    const k2 = JSON.stringify([e.pts, e.bulge, e.closed, tol]), h2 = flatCache.get(e); if (h2 && h2.key === k2) return h2.v;
    const v2 = { pts: flattenPath(e, tol), closed: !!e.closed }; flatCache.set(e, { key: k2, v: v2 }); return v2;
  }
  if (e.type === 'spline') {
    const k3 = JSON.stringify([e.pts, e.h, e.closed, tol]), h3 = flatCache.get(e); if (h3 && h3.key === k3) return h3.v;
    const v3 = { pts: flattenSpline(e, Math.max(tol, 0.0005)), closed: !!e.closed }; flatCache.set(e, { key: k3, v: v3 }); return v3;
  }
  const key = JSON.stringify([e.type, (e as any).c, (e as any).r, (e as any).rx, (e as any).ry, (e as any).rot, (e as any).a0, (e as any).a1, tol]);
  const hit = flatCache.get(e); if (hit && hit.key === key) return hit.v;
  let v: { pts: Point[]; closed: boolean };
  if (e.type === 'circle') { const n = Math.max(32, nSeg(e.r, TAU, tol)); v = { pts: Array.from({ length: n }, (_, i) => polar(e.c, e.r, i * TAU / n)), closed: true }; }
  else if (e.type === 'ellipse') { const n = Math.max(64, Math.ceil(nSeg(Math.max(e.rx, e.ry), TAU, tol) * 1.6)); v = { pts: Array.from({ length: n }, (_, i) => ellPt(e, i * TAU / n)), closed: true }; }
  else if (e.type === 'arc') { const sp = normA(e.a1 - e.a0) || TAU, n = nSeg(e.r, sp, tol); v = { pts: Array.from({ length: n + 1 }, (_, i) => polar(e.c, e.r, e.a0 + sp * i / n)), closed: false }; }
  else v = { pts: [], closed: false };
  flatCache.set(e, { key, v }); return v;
}

/** Break a shape into exact primitives: segments and circular arcs. */
export function prims(e: Shape): Prim[] {
  switch (e.type) {
    case 'line': return [{ t: 'seg', a: e.a, b: e.b }];
    case 'poly': if (hasBulge(e)) return segsOf(e).map(segPrim) as Prim[];
    // falls through
    case 'spline':
    case 'ellipse': {
      const f = flatten(e), r: Prim[] = [], n = f.pts.length;
      for (let i = 0; i < n - 1; i++) r.push({ t: 'seg', a: f.pts[i], b: f.pts[i + 1] });
      if (f.closed && n > 2) r.push({ t: 'seg', a: f.pts[n - 1], b: f.pts[0] });
      return r;
    }
    case 'circle': return [{ t: 'arc', c: e.c, r: e.r, full: true }];
    case 'arc': return [{ t: 'arc', c: e.c, r: e.r, a0: e.a0, a1: e.a1 }];
    default: return [];
  }
}

export const onArc = (pr: Extract<Prim, { t: 'arc' }>, p: Point) => pr.full || angIn(angOf(pr.c, p), pr.a0!, pr.a1!);

function interSS(a: Point, b: Point, c: Point, d: Point): Point[] {
  const r = sub(b, a), s = sub(d, c), den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-12) return [];
  const q = sub(c, a), t = (q.x * s.y - q.y * s.x) / den, u = (q.x * r.y - q.y * r.x) / den;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return [];
  return [add(a, mul(r, t))];
}
function interSA(a: Point, b: Point, pr: Extract<Prim, { t: 'arc' }>): Point[] {
  const d = sub(b, a), f = sub(a, pr.c), A = dot(d, d), B = 2 * dot(f, d), C = dot(f, f) - pr.r * pr.r;
  let disc = B * B - 4 * A * C; if (disc < -1e-12) return []; disc = Math.max(0, disc);
  const sq = Math.sqrt(disc), ts = disc === 0 ? [-B / (2 * A)] : [(-B - sq) / (2 * A), (-B + sq) / (2 * A)];
  return ts.filter(t => t >= -EPS && t <= 1 + EPS).map(t => add(a, mul(d, t))).filter(p => onArc(pr, p));
}
function interAA(p: Extract<Prim, { t: 'arc' }>, q: Extract<Prim, { t: 'arc' }>): Point[] {
  const d = dist(p.c, q.c); if (d < 1e-12 || d > p.r + q.r + EPS || d < Math.abs(p.r - q.r) - EPS) return [];
  const a = (p.r * p.r - q.r * q.r + d * d) / (2 * d), h = Math.sqrt(Math.max(0, p.r * p.r - a * a));
  const m = add(p.c, mul(sub(q.c, p.c), a / d)), o = P(-(q.c.y - p.c.y) * h / d, (q.c.x - p.c.x) * h / d);
  const pts = h < 1e-12 ? [m] : [add(m, o), sub(m, o)];
  return pts.filter(x => onArc(p, x) && onArc(q, x));
}
export function intersect(p: Prim, q: Prim): Point[] {
  if (p.t === 'seg' && q.t === 'seg') return interSS(p.a, p.b, q.a, q.b);
  if (p.t === 'seg') return interSA(p.a, p.b, q as any);
  if (q.t === 'seg') return interSA(q.a, q.b, p as any);
  return interAA(p as any, q as any);
}
/** Closest point on a primitive to p. */
export function nearestOnPrim(p: Point, pr: Prim): Point {
  if (pr.t === 'seg') { const d = sub(pr.b, pr.a), L = dot(d, d); let t = L ? dot(sub(p, pr.a), d) / L : 0; t = Math.max(0, Math.min(1, t)); return add(pr.a, mul(d, t)); }
  if (dist(p, pr.c) > 1e-12 && onArc(pr, p)) return polar(pr.c, pr.r, angOf(pr.c, p));
  const s = polar(pr.c, pr.r, pr.a0!), e = polar(pr.c, pr.r, pr.a1!); return dist(p, s) < dist(p, e) ? s : e;
}
export const distPrim = (p: Point, pr: Prim) => dist(p, nearestOnPrim(p, pr));

export type SnapKind = 'end' | 'mid' | 'centre' | 'quad' | 'inter' | 'nearest' | 'perp' | 'tangent';
export function keypoints(e: Shape): { p: Point; k: SnapKind }[] {
  const k: { p: Point; k: SnapKind }[] = [];
  if (e.type === 'line') k.push({ p: e.a, k: 'end' }, { p: e.b, k: 'end' }, { p: mul(add(e.a, e.b), .5), k: 'mid' });
  else if (e.type === 'poly') {
    if (e.pts.length <= 64) { e.pts.forEach(p => k.push({ p, k: 'end' })); for (const s of segsOf(e)) { k.push({ p: segPoint(s, .5), k: 'mid' }); if (s.kind === 'arc') k.push({ p: s.c, k: 'centre' }); } }
    else if (!e.closed) k.push({ p: e.pts[0], k: 'end' }, { p: e.pts[e.pts.length - 1], k: 'end' });
  }
  else if (e.type === 'circle') { k.push({ p: e.c, k: 'centre' }); for (let i = 0; i < 4; i++) k.push({ p: polar(e.c, e.r, i * Math.PI / 2), k: 'quad' }); }
  else if (e.type === 'spline') { if (e.pts.length <= 64) e.pts.forEach(p => k.push({ p, k: 'end' })); }
  else if (e.type === 'ellipse') { k.push({ p: e.c, k: 'centre' }); for (let i = 0; i < 4; i++) k.push({ p: ellPt(e, i * Math.PI / 2), k: 'quad' }); }
  else if (e.type === 'arc') {
    k.push({ p: polar(e.c, e.r, e.a0), k: 'end' }, { p: polar(e.c, e.r, e.a1), k: 'end' }, { p: polar(e.c, e.r, e.a0 + normA(e.a1 - e.a0) / 2), k: 'mid' }, { p: e.c, k: 'centre' });
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; if (angIn(a, e.a0, e.a1)) k.push({ p: polar(e.c, e.r, a), k: 'quad' }); }
  }
  return k;
}

export interface Box { x0: number; y0: number; x1: number; y1: number }
export function bbox(e: Shape, dimLines?: (e: Shape) => { lines: [Point, Point][]; text: { p: Point } }): Box {
  if (e.type === 'circle') return { x0: e.c.x - e.r, y0: e.c.y - e.r, x1: e.c.x + e.r, y1: e.c.y + e.r };
  if (e.type === 'ellipse') { const c = Math.cos(e.rot), s = Math.sin(e.rot), hx = Math.hypot(e.rx * c, e.ry * s), hy = Math.hypot(e.rx * s, e.ry * c); return { x0: e.c.x - hx, y0: e.c.y - hy, x1: e.c.x + hx, y1: e.c.y + hy }; }
  let pts: Point[] = [];
  if (e.type === 'line') pts = [e.a, e.b];
  else if (e.type === 'poly') {
    if (!hasBulge(e)) pts = e.pts;
    else for (const sg of segsOf(e)) {
      pts.push(sg.a, sg.b);
      if (sg.kind === 'arc') { const pr = segPrim(sg) as { a0: number; a1: number }; for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; if (angIn(a, pr.a0, pr.a1)) pts.push(polar(sg.c, sg.r, a)); } }
    }
  }
  else if (e.type === 'spline') pts = flatten(e, 0.01).pts;
  else if (e.type === 'arc') { pts = [polar(e.c, e.r, e.a0), polar(e.c, e.r, e.a1)]; for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; if (angIn(a, e.a0, e.a1)) pts.push(polar(e.c, e.r, a)); } }
  else if (e.type === 'dim') { if (dimLines) { const g = dimLines(e); g.lines.forEach(l => pts.push(l[0], l[1])); pts.push(g.text.p); } else pts = [e.p1, e.p2, e.off]; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  return { x0, y0, x1, y1 };
}
export function unionBox(boxes: Box[]): Box | null {
  let b: Box | null = null;
  for (const q of boxes) b = b ? { x0: Math.min(b.x0, q.x0), y0: Math.min(b.y0, q.y0), x1: Math.max(b.x1, q.x1), y1: Math.max(b.y1, q.y1) } : { ...q };
  return b;
}
export const boxCentre = (b: Box) => P((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);

/** Start and end points of an open shape (for chaining). */
export function endsOf(e: Shape): [Point, Point] | null {
  if (e.type === 'line') return [e.a, e.b];
  if (e.type === 'arc') return [polar(e.c, e.r, e.a0), polar(e.c, e.r, e.a1)];
  if ((e.type === 'poly' || e.type === 'spline') && !e.closed) return [e.pts[0], e.pts[e.pts.length - 1]];
  return null;
}

/** Length along a shape (perimeter for closed shapes). */
export function lengthOf(e: Shape): number {
  if (e.type === 'circle') return TAU * e.r;
  if (e.type === 'arc') return e.r * (normA(e.a1 - e.a0) || TAU);
  if (e.type === 'dim') return 0;
  if (e.type === 'poly') return segsOf(e).reduce((s, g) => s + g.len, 0);
  return prims(e).reduce((s, p) => s + (p.t === 'seg' ? dist(p.a, p.b) : 0), 0);
}

export type { EllipseEnt, Entity };
