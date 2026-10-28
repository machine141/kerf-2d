/**
 * Fillet (rounded) and chamfer (cut) corners.
 *  • On a path vertex: the path keeps a true arc (bulge) or a straight cut.
 *  • Between two separate lines: lines are trimmed/extended to the tangent
 *    points and a new arc (or chamfer line) joins them — like 2D Design's Fillet.
 */
import { type Point, P, add, sub, mul, dot, cross, len, dist, normA, angOf, cp, clean } from './vec';
import { segCount, bulgeAt, type PathLike } from './path';
import type { Shape } from '../model/types';

export type CornerMode = 'fillet' | 'chamfer';
export interface CornerInfo { V: Point; u1: Point; u2: Point; L1: number; L2: number; theta: number }
const unit = (v: Point) => { const L = len(v) || 1; return mul(v, 1 / L); };

/** Distance along each edge from the corner for a given size. */
export const setback = (theta: number, size: number, mode: CornerMode) => mode === 'fillet' ? size / Math.tan(theta / 2) : size;
/** Largest size that fits a corner. */
export const maxSize = (c: CornerInfo, mode: CornerMode) => { const L = Math.min(c.L1, c.L2); return mode === 'fillet' ? L * Math.tan(c.theta / 2) : L; };
/** Size implied by a setback distance (for "follow cursor"). */
export const sizeFromSetback = (theta: number, t: number, mode: CornerMode) => mode === 'fillet' ? t * Math.tan(theta / 2) : t;

/** Corner geometry at path vertex i (null if not a sharp corner between two straight segments). */
export function pathCorner(p: PathLike, i: number): CornerInfo | null {
  const n = p.pts.length, nseg = segCount(p);
  if (!p.closed && (i === 0 || i === n - 1)) return null;
  const ip = (i - 1 + n) % n, inx = (i + 1) % n;
  if (Math.abs(bulgeAt(p, (i - 1 + nseg) % nseg)) > 1e-12 || Math.abs(bulgeAt(p, i % nseg)) > 1e-12) return null;
  const V = p.pts[i], P0 = p.pts[ip], N = p.pts[inx];
  const L1 = dist(P0, V), L2 = dist(N, V); if (L1 < 1e-9 || L2 < 1e-9) return null;
  const u1 = unit(sub(P0, V)), u2 = unit(sub(N, V)), theta = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2))));
  if (theta < 1e-6 || Math.PI - theta < 1e-6) return null;
  return { V, u1, u2, L1, L2, theta };
}

/** Fillet/chamfer one path vertex. Returns the new path or an error message. */
export function cornerPath(p: PathLike, i: number, size: number, mode: CornerMode): { pts: Point[]; bulge: number[]; closed: boolean } | { error: string } {
  const c = pathCorner(p, i); if (!c) return { error: 'Not a corner between two straight edges' };
  const t = setback(c.theta, size, mode);
  if (size <= 0) return { error: 'Size must be more than 0' };
  if (t > Math.min(c.L1, c.L2) + 1e-9) return { error: `Too large for this corner (max ${+maxSize(c, mode).toFixed(3)} mm)` };
  const T1 = cp(add(c.V, mul(c.u1, t))), T2 = cp(add(c.V, mul(c.u2, t)));
  const n = p.pts.length, P0 = p.pts[(i - 1 + n) % n], N = p.pts[(i + 1) % n];
  const turn = cross(sub(c.V, P0), sub(N, c.V)) > 0 ? 1 : -1;
  const b = mode === 'fillet' ? turn * Math.tan((Math.PI - c.theta) / 4) : 0;
  const pts = p.pts.slice(), bulge = Array.from({ length: segCount(p) }, (_, k) => bulgeAt(p, k));
  pts.splice(i, 1, T1, T2); bulge.splice(i, 0, b);
  return dedupe(pts, bulge, p.closed);
}
/** Fillet/chamfer every eligible corner of a path. */
export function cornerAll(p: PathLike, size: number, mode: CornerMode): { path: { pts: Point[]; bulge: number[]; closed: boolean }; done: number; skipped: number } {
  let cur = { pts: p.pts.slice(), bulge: Array.from({ length: segCount(p) }, (_, k) => bulgeAt(p, k)), closed: p.closed }, done = 0, skipped = 0;
  for (let i = p.pts.length - 1; i >= 0; i--) {
    if (!pathCorner(cur, i)) continue;
    const r = cornerPath(cur, i, size, mode);
    if ('error' in r) skipped++; else { cur = r; done++; }
  }
  return { path: cur, done, skipped };
}
function dedupe(pts: Point[], bulge: number[], closed: boolean) {
  for (let k = pts.length - 1; k > 0; k--) if (dist(pts[k], pts[k - 1]) < 1e-9) { pts.splice(k, 1); bulge.splice(k - 1, 1); }
  if (closed && pts.length > 1 && dist(pts[0], pts[pts.length - 1]) < 1e-9) { pts.pop(); bulge.splice(bulge.length - 1, 1); }
  return { pts, bulge: bulge.slice(0, closed ? pts.length : pts.length - 1), closed };
}

/** Corner formed by two separate lines (their infinite extensions), using click points to choose which parts to keep. */
export function linesCorner(A: { a: Point; b: Point }, clickA: Point, B: { a: Point; b: Point }, clickB: Point) {
  const dA = unit(sub(A.b, A.a)), dB = unit(sub(B.b, B.a)), den = cross(dA, dB);
  if (Math.abs(den) < 1e-12) return { error: 'The lines are parallel — no corner' } as const;
  const tX = cross(sub(B.a, A.a), dB) / den, X = add(A.a, mul(dA, tX));
  const side = (d: Point, click: Point, l: { a: Point; b: Point }) => {
    let s = dot(sub(click, X), d); if (Math.abs(s) < 1e-9) s = dot(sub(dist(l.a, X) > dist(l.b, X) ? l.a : l.b, X), d);
    const u = s >= 0 ? d : mul(d, -1), far = dot(sub(l.a, X), u) > dot(sub(l.b, X), u) ? l.a : l.b;
    return { u, far, L: dot(sub(far, X), u) };
  };
  const a = side(dA, clickA, A), b = side(dB, clickB, B);
  const theta = Math.acos(Math.max(-1, Math.min(1, dot(a.u, b.u))));
  if (theta < 1e-6 || Math.PI - theta < 1e-6) return { error: 'The lines are in line — no corner' } as const;
  return { X, a, b, theta, info: { V: X, u1: a.u, u2: b.u, L1: a.L, L2: b.L, theta } as CornerInfo };
}
/** Fillet/chamfer two lines: new versions of both lines plus the joining arc or line. */
export function cornerLines(A: { a: Point; b: Point }, clickA: Point, B: { a: Point; b: Point }, clickB: Point, size: number, mode: CornerMode): { lineA: Shape; lineB: Shape; join: Shape } | { error: string } {
  const g = linesCorner(A, clickA, B, clickB); if ('error' in g) return { error: g.error! };
  const t = setback(g.theta, size, mode);
  if (size <= 0) return { error: 'Size must be more than 0' };
  if (t > Math.min(g.a.L, g.b.L) + 1e-9) return { error: `Too large for these lines (max ${+maxSize(g.info, mode).toFixed(3)} mm)` };
  const T1 = cp(add(g.X, mul(g.a.u, t))), T2 = cp(add(g.X, mul(g.b.u, t)));
  const lineA = { type: 'line', a: g.a.far, b: T1 } as Shape, lineB = { type: 'line', a: g.b.far, b: T2 } as Shape;
  if (mode === 'chamfer') return { lineA, lineB, join: { type: 'line', a: T1, b: T2 } as Shape };
  const bis = unit(add(g.a.u, g.b.u)), c = cp(add(g.X, mul(bis, size / Math.sin(g.theta / 2))));
  let a0 = normA(angOf(c, T1)), a1 = normA(angOf(c, T2)); if (normA(a1 - a0) > Math.PI) [a0, a1] = [a1, a0];
  return { lineA, lineB, join: { type: 'arc', c, r: clean(size), a0, a1 } as Shape };
}
export { P };
