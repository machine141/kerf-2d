/** Arc construction: through three points, and tangent from a direction. */
import { type Point, P, sub, add, mul, dot, cross, len, dist, normA, angOf, angIn, clean, cp } from './vec';
import { segsOf, segTangent } from './path';
import type { Shape } from '../model/types';

/** Arc from a to b passing through m. Returns null if the points are in a straight line. */
export function arc3(a: Point, b: Point, m: Point): Extract<Shape, { type: 'arc' }> | null {
  const d = 2 * (a.x * (m.y - b.y) + m.x * (b.y - a.y) + b.x * (a.y - m.y));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y, m2 = m.x * m.x + m.y * m.y, b2 = b.x * b.x + b.y * b.y;
  const c = cp(P((a2 * (m.y - b.y) + m2 * (b.y - a.y) + b2 * (a.y - m.y)) / d, (a2 * (b.x - m.x) + m2 * (a.x - b.x) + b2 * (m.x - a.x)) / d));
  const r = clean(dist(c, a)), aa = normA(angOf(c, a)), ab = normA(angOf(c, b)), am = angOf(c, m);
  return (angIn(am, aa, ab) ? { type: 'arc', c, r, a0: aa, a1: ab } : { type: 'arc', c, r, a0: ab, a1: aa }) as any;
}

/** Arc starting at s, leaving in unit direction `dir` (tangent), ending at e. Null if e is straight ahead. */
export function tangentArc(s: Point, dir: Point, e: Point): Extract<Shape, { type: 'arc' }> | null {
  const n = P(-dir.y, dir.x), d = sub(e, s), nd = dot(n, d);
  if (Math.abs(nd) < 1e-12) return null;
  const r = dot(d, d) / (2 * nd), c = cp(add(s, mul(n, r)));
  const as = normA(angOf(c, s)), ae = normA(angOf(c, e));
  return (r > 0 ? { type: 'arc', c, r: clean(Math.abs(r)), a0: as, a1: ae } : { type: 'arc', c, r: clean(Math.abs(r)), a0: ae, a1: as }) as any;
}

/**
 * If p is an end of an open shape, the direction a curve would continue in
 * smoothly from there (pointing away from the shape).
 */
export function endTangent(shapes: Shape[], p: Point, tol = 1e-6): Point | null {
  for (const e of shapes) {
    if (e.type === 'line') {
      if (dist(e.b, p) < tol) return unit(sub(e.b, e.a));
      if (dist(e.a, p) < tol) return unit(sub(e.a, e.b));
    } else if (e.type === 'arc') {
      const ccw = (a: number) => P(-Math.sin(a), Math.cos(a));
      if (dist(P(e.c.x + e.r * Math.cos(e.a1), e.c.y + e.r * Math.sin(e.a1)), p) < tol) return ccw(e.a1);
      if (dist(P(e.c.x + e.r * Math.cos(e.a0), e.c.y + e.r * Math.sin(e.a0)), p) < tol) return mul(ccw(e.a0), -1);
    } else if (e.type === 'poly' && !e.closed && e.pts.length >= 2) {
      const segs = segsOf(e), n = segs.length;
      if (dist(e.pts[e.pts.length - 1], p) < tol) return segTangent(segs[n - 1], 1);
      if (dist(e.pts[0], p) < tol) return mul(segTangent(segs[0], 0), -1);
    }
  }
  return null;
}
const unit = (v: Point) => { const L = len(v) || 1; return mul(v, 1 / L); };
export { cross };
