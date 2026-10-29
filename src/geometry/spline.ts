/**
 * Splines: smooth curves through points, stored as cubic Bézier segments.
 * Each anchor has an "in" and an "out" handle (absolute positions). Drawing
 * makes smooth handles automatically (Catmull-Rom); editing moves anchors and
 * handles like Fusion 360 / Onshape / Inkscape.
 */
import { type Point, P, add, sub, mul, len, dist } from './vec';

export interface SplineLike { pts: Point[]; h: [Point, Point][]; closed: boolean }

/** Smooth handles through the anchors (Catmull-Rom, tension 1/3 of the neighbour spacing). */
export function autoHandles(pts: Point[], closed: boolean, tension = 1): [Point, Point][] {
  const n = pts.length, k = tension / 6;
  return pts.map((p, i) => {
    let prev = pts[i - 1], next = pts[i + 1];
    if (closed) { prev = pts[(i - 1 + n) % n]; next = pts[(i + 1) % n]; }
    if (!prev && !next) return [p, p];
    if (!prev) { const t = mul(sub(next, p), 1 / 3); return [p, add(p, t)]; }
    if (!next) { const t = mul(sub(p, prev), 1 / 3); return [sub(p, t), p]; }
    const T = sub(next, prev), din = dist(p, prev), dout = dist(p, next), L = len(T) || 1;
    // scale each side by its own neighbour distance so uneven spacing stays smooth
    const u = mul(T, 1 / L);
    return [sub(p, mul(u, din * k * 2)), add(p, mul(u, dout * k * 2))];
  });
}

/**
 * Smooth curve through traced points: round where the outline flows, sharp where
 * it turns more than `cornerDeg` (corners of letters, points of a leaf stay crisp).
 */
export function fitSpline(pts: Point[], closed: boolean, cornerDeg = 55): { pts: Point[]; h: [Point, Point][] } {
  const n = pts.length, h = autoHandles(pts, closed, 1);
  for (let i = 0; i < n; i++) {
    const a = closed ? pts[(i - 1 + n) % n] : pts[i - 1], b = closed ? pts[(i + 1) % n] : pts[i + 1]; if (!a || !b) continue;
    const u = sub(pts[i], a), v = sub(b, pts[i]), lu = len(u), lv = len(v); if (lu < 1e-9 || lv < 1e-9) continue;
    const turn = Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / (lu * lv)))) * 180 / Math.PI;
    if (turn > cornerDeg) h[i] = [pts[i], pts[i]];
  }
  return { pts, h };
}

/** Bézier segments as [p0, c1, c2, p3]. */
export function splineSegs(s: SplineLike): [Point, Point, Point, Point][] {
  const n = s.pts.length, out: [Point, Point, Point, Point][] = [], m = s.closed ? n : n - 1;
  for (let i = 0; i < m; i++) { const j = (i + 1) % n; out.push([s.pts[i], s.h[i][1], s.h[j][0], s.pts[j]]); }
  return out;
}
export const bez = (b: [Point, Point, Point, Point], t: number): Point => {
  const u = 1 - t, a = u * u * u, c = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
  return P(a * b[0].x + c * b[1].x + d * b[2].x + e * b[3].x, a * b[0].y + c * b[1].y + d * b[2].y + e * b[3].y);
};
/** Distance of the control points from the chord (flatness test). */
function flatEnough(b: [Point, Point, Point, Point], tol: number) {
  const d = sub(b[3], b[0]), L = len(d);
  const off = (p: Point) => L < 1e-12 ? dist(p, b[0]) : Math.abs((p.x - b[0].x) * d.y - (p.y - b[0].y) * d.x) / L;
  return Math.max(off(b[1]), off(b[2])) <= tol;
}
function split(b: [Point, Point, Point, Point]): [[Point, Point, Point, Point], [Point, Point, Point, Point]] {
  const m = (a: Point, c: Point) => mul(add(a, c), .5);
  const ab = m(b[0], b[1]), bc = m(b[1], b[2]), cd = m(b[2], b[3]), abc = m(ab, bc), bcd = m(bc, cd), mid = m(abc, bcd);
  return [[b[0], ab, abc, mid], [mid, bcd, cd, b[3]]];
}
/** Points along the spline within `tol` of the true curve. */
export function flattenSpline(s: SplineLike, tol = 0.002): Point[] {
  const out: Point[] = [];
  const rec = (b: [Point, Point, Point, Point], depth: number) => { if (depth > 14 || flatEnough(b, tol)) { out.push(b[3]); return; } const [l, r] = split(b); rec(l, depth + 1); rec(r, depth + 1); };
  const segs = splineSegs(s);
  if (!segs.length) return s.pts.slice();
  out.push(segs[0][0]);
  for (const b of segs) rec(b, 0);
  if (s.closed) out.pop();
  return out;
}
/** Mirror a handle through its anchor, keeping the other handle's own length (smooth node). */
export function mirrorHandle(anchor: Point, moved: Point, other: Point): Point {
  const v = sub(anchor, moved), L = len(v), keep = dist(anchor, other);
  return L < 1e-12 ? other : add(anchor, mul(v, keep / L));
}

/** Insert an anchor in the middle of segment i, keeping the curve's shape exactly. */
export function splitSplineAt(s: SplineLike, i: number): { pts: Point[]; h: [Point, Point][] } {
  const segs = splineSegs(s), b = segs[i], [l, r] = split(b), n = s.pts.length, j = (i + 1) % n;
  const pts = s.pts.slice(), h = s.h.map(x => [x[0], x[1]] as [Point, Point]);
  h[i][1] = l[1]; h[j][0] = r[2];
  pts.splice(i + 1, 0, l[3]); h.splice(i + 1, 0, [l[2], r[1]]);
  return { pts, h };
}
