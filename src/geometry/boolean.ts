/**
 * Shape booleans — union, subtract, intersect — for closed shapes.
 *
 * Clipper does the robust area maths on finely flattened outlines; then
 * "refit" maps every result edge back onto the exact source line or arc it
 * came from, snaps each corner to the exact intersection of its two source
 * curves, and rebuilds the outline as a path with true arcs (bulges). The
 * result is exact (no polyline approximation) whenever the inputs are lines,
 * arcs, circles and paths; ellipses stay finely flattened.
 */
import ClipperLib from 'clipper-lib';
import { type Point, P, sub, add, mul, dot, cross, len, dist, normA, angOf, angIn, clean, cp } from './vec';
import { flatten, prims, nearestOnPrim, type Prim } from './entity';
import { pieceToShape } from './trim';
import type { Shape } from '../model/types';

export type BoolOp = 'union' | 'subtract' | 'intersect';
const L = ClipperLib, SCALE = 1e5, FLAT = 0.0002;
type IntPath = { X: number; Y: number }[];
const toInt = (pts: Point[]): IntPath => { const ip = pts.map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) })); if (!L.Clipper.Orientation(ip)) ip.reverse(); return ip; };
const fromInt = (path: IntPath): Point[] => path.map(q => P(q.X / SCALE, q.Y / SCALE));

export const isClosedShape = (s: Shape) => s.type === 'circle' || s.type === 'ellipse' || (s.type === 'poly' && s.closed && s.pts.length > 2);

/** Signed area of a closed shape's outline (mm²), positive. */
export function areaOf(s: Shape): number {
  const f = flatten(s, 0.01).pts; let a = 0;
  for (let i = 0; i < f.length; i++) { const p = f[i], q = f[(i + 1) % f.length]; a += p.x * q.y - q.x * p.y; }
  return Math.abs(a / 2);
}

/**
 * Boolean of closed shapes. `base` (default: the largest) is the shape kept by
 * subtract/intersect; for union all shapes merge. Returns new shapes, or an error.
 */
export function booleanShapes(op: BoolOp, shapes: Shape[], base?: number): { shapes: Shape[] } | { error: string } {
  const closed = shapes.filter(isClosedShape);
  if (closed.length < 2) return { error: 'Select two or more closed shapes (rectangles, circles, closed paths)' };
  const bi = base ?? closed.reduce((bi, s, i) => areaOf(s) > areaOf(closed[bi]) ? i : bi, 0);
  const subj = closed[bi], others = closed.filter((_, i) => i !== bi);
  const ints = (s: Shape) => toInt(flatten(s, FLAT).pts);
  let sol: IntPath[];
  const run = (ct: number, a: IntPath[], b: IntPath[]) => {
    const c = new L.Clipper(), out = new L.Paths();
    c.AddPaths(a, L.PolyType.ptSubject, true); if (b.length) c.AddPaths(b, L.PolyType.ptClip, true);
    c.Execute(ct, out, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero); return out as IntPath[];
  };
  if (op === 'union') sol = run(L.ClipType.ctUnion, closed.map(ints), []);
  else if (op === 'subtract') sol = run(L.ClipType.ctDifference, [ints(subj)], others.map(ints));
  else { sol = [ints(subj)]; for (const o of others) sol = run(L.ClipType.ctIntersection, sol, [ints(o)]); }
  sol = sol.filter(p => p.length > 2 && Math.abs(L.Clipper.Area(p)) > 1e-6 * SCALE * SCALE);
  if (!sol.length) return { error: op === 'intersect' ? 'These shapes do not overlap' : 'Nothing is left' };
  const src = geosOf(closed.flatMap(s => prims(s)));
  return { shapes: sol.map(p => refit(fromInt(p), src)) };
}

// ---------- refit: polyline → exact lines and arcs ----------
export type Geo = { kind: 'line'; a: Point; d: Point } | { kind: 'circ'; c: Point; r: number };
const geo = (pr: Prim): Geo => pr.t === 'seg' ? { kind: 'line', a: pr.a, d: sub(pr.b, pr.a) } : { kind: 'circ', c: pr.c, r: pr.r };

/** Intersections of the infinite line / full circle carrying two primitives. */
export function meet(A: Geo, B: Geo): Point[] {
  if (A.kind === 'line' && B.kind === 'line') {
    const den = cross(A.d, B.d); if (Math.abs(den) < 1e-14) return [];
    return [add(A.a, mul(A.d, cross(sub(B.a, A.a), B.d) / den))];
  }
  if (A.kind === 'circ' && B.kind === 'line') return meet(B, A);
  if (A.kind === 'line' && B.kind === 'circ') {
    const dd = dot(A.d, A.d), f = sub(A.a, B.c), b = 2 * dot(f, A.d), c = dot(f, f) - B.r * B.r, disc = b * b - 4 * dd * c;
    if (disc < -1e-9) return []; const s = Math.sqrt(Math.max(0, disc));
    return [add(A.a, mul(A.d, (-b - s) / (2 * dd))), add(A.a, mul(A.d, (-b + s) / (2 * dd)))];
  }
  const a = A as Extract<Geo, { kind: 'circ' }>, b = B as Extract<Geo, { kind: 'circ' }>, d = dist(a.c, b.c);
  if (d < 1e-12) return [];
  const x = (d * d + a.r * a.r - b.r * b.r) / (2 * d), h2 = a.r * a.r - x * x; if (h2 < -1e-9) return [];
  const u = mul(sub(b.c, a.c), 1 / d), m = add(a.c, mul(u, x)), h = Math.sqrt(Math.max(0, h2));
  return [add(m, mul(P(-u.y, u.x), h)), add(m, mul(P(u.y, -u.x), h))];
}

/** Infinite lines / full circles carrying a set of primitives (duplicates removed). */
export function geosOf(src: Prim[]): Geo[] { return uniqGeos(src.map(geo)); }
/**
 * Every curve a contour at the given distances can run along: lines parallel
 * to each source line (both sides), circles concentric with each arc (both
 * sides), round-corner circles about each end/vertex, and square end caps.
 */
export function offsetGeos(src: Prim[], ds: number[]): Geo[] {
  const out: Geo[] = [];
  for (const pr of src) for (const d0 of ds) {
    const d = Math.abs(d0);
    if (pr.t === 'seg') {
      const u = sub(pr.b, pr.a), L = len(u); if (L < 1e-12) continue;
      const t = mul(u, 1 / L), n = P(-t.y, t.x);
      out.push({ kind: 'line', a: add(pr.a, mul(n, d)), d: u }, { kind: 'line', a: sub(pr.a, mul(n, d)), d: u });
      out.push({ kind: 'circ', c: pr.a, r: d }, { kind: 'circ', c: pr.b, r: d });
      out.push({ kind: 'line', a: sub(pr.a, mul(t, d)), d: n }, { kind: 'line', a: add(pr.b, mul(t, d)), d: n });
    } else {
      out.push({ kind: 'circ', c: pr.c, r: pr.r + d }); if (pr.r - d > 1e-9) out.push({ kind: 'circ', c: pr.c, r: pr.r - d });
      if (!pr.full) for (const a of [pr.a0!, pr.a1!]) out.push({ kind: 'circ', c: P(pr.c.x + pr.r * Math.cos(a), pr.c.y + pr.r * Math.sin(a)), r: d });
    }
  }
  return uniqGeos(out);
}
function uniqGeos(gs: Geo[]): Geo[] {
  const seen = new Set<string>(), out: Geo[] = [], r = (v: number) => Math.round(v * 1e6);
  for (const g of gs) {
    let k: string;
    if (g.kind === 'circ') k = `c${r(g.c.x)},${r(g.c.y)},${r(g.r)}`;
    else { const L = len(g.d); let ux = g.d.x / L, uy = g.d.y / L; if (ux < -1e-12 || (Math.abs(ux) <= 1e-12 && uy < 0)) { ux = -ux; uy = -uy; } k = `l${r(ux)},${r(uy)},${r(cross(P(ux, uy), g.a))}`; }
    if (!seen.has(k)) { seen.add(k); out.push(g); }
  }
  return out;
}
const geoDist = (p: Point, g: Geo) => g.kind === 'line' ? Math.abs(cross(sub(p, g.a), g.d)) / (len(g.d) || 1) : Math.abs(dist(p, g.c) - g.r);

/**
 * Rebuild a closed polyline (from Clipper) as exact lines and arcs: each edge
 * is matched to a candidate line/circle it lies on, runs of edges on the same
 * curve merge into one segment, and corners snap to exact intersections.
 */
export function refit(pts: Point[], geos: Geo[], eps = 0.002): Shape {
  const n = pts.length;
  const edge: number[] = new Array(n).fill(-1);
  const boxes = geos.map(g => g.kind === 'circ' ? [g.c.x - g.r, g.c.y - g.r, g.c.x + g.r, g.c.y + g.r] : null);
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], m = mul(add(a, b), 0.5);
    const fits = (k: number) => geoDist(a, geos[k]) <= eps && geoDist(b, geos[k]) <= eps && geoDist(m, geos[k]) <= eps;
    const prev = i ? edge[i - 1] : -1;
    if (prev >= 0 && fits(prev)) { edge[i] = prev; continue; }
    const x0 = Math.min(a.x, b.x) - eps, x1 = Math.max(a.x, b.x) + eps, y0 = Math.min(a.y, b.y) - eps, y1 = Math.max(a.y, b.y) + eps;
    let bestK = -1, bestE = Infinity;
    for (let k = 0; k < geos.length; k++) {
      const bx = boxes[k]; if (bx && (bx[0] > x1 || bx[2] < x0 || bx[1] > y1 || bx[3] < y0)) continue;
      if (!fits(k)) continue;
      const e = geoDist(a, geos[k]) + geoDist(b, geos[k]) + geoDist(m, geos[k]); if (e < bestE) { bestE = e; bestK = k; }
    }
    edge[i] = bestK;
  }
  if (edge.every(k => k === edge[0]) && edge[0] >= 0) {
    const g = geos[edge[0]];
    if (g.kind === 'circ') return { type: 'circle', c: cp(g.c), r: clean(g.r) } as Shape;
  }
  // rotate so a run starts at index 0
  let start = 0; for (let i = 0; i < n; i++) if (edge[i] !== edge[(i - 1 + n) % n] || edge[i] < 0) { start = i; break; }
  const E = edge.slice(start).concat(edge.slice(0, start)), V = pts.slice(start).concat(pts.slice(0, start));
  // runs of edges on the same curve (unmatched edges stay as their own straight runs)
  const runs: { k: number; i0: number; i1: number }[] = [];
  for (let i = 0; i < n; i++) {
    const last = runs[runs.length - 1];
    if (last && E[i] >= 0 && E[i] === last.k) last.i1 = i + 1; else runs.push({ k: E[i], i0: i, i1: i + 1 });
  }
  // exact corners: where run j-1 meets run j
  const corner = (j: number): Point => {
    const r = runs[j], p = V[r.i0], A = runs[(j - 1 + runs.length) % runs.length].k, B = r.k;
    if (A < 0 || B < 0 || A === B) return p;
    const lenA = Math.max(0.02, dist(V[runs[(j - 1 + runs.length) % runs.length].i0], p)), lenB = Math.max(0.02, dist(V[r.i1 % n], p));
    let best: Point | null = null, bd = Math.min(0.5, 2 * Math.max(lenA, lenB));
    for (const q of meet(geos[A], geos[B])) { const d = dist(q, p); if (d < bd) { bd = d; best = q; } }
    return best ? cp(P(clean(best.x), clean(best.y))) : p;
  };
  const J = runs.map((_, j) => corner(j));
  const outPts: Point[] = [], bulge: number[] = [];
  runs.forEach((r, j) => {
    const a = J[j], b = J[(j + 1) % runs.length], g = r.k >= 0 ? geos[r.k] : null;
    outPts.push(a);
    if (!g || g.kind === 'line') { bulge.push(0); return; }
    const a0 = angOf(g.c, a), a1 = angOf(g.c, b), ccw = normA(a1 - a0);
    let sweep: number;
    if (r.i1 - r.i0 >= 2) { const mid = V[Math.floor((r.i0 + r.i1) / 2)]; sweep = angIn(angOf(g.c, mid), normA(a0), normA(a1)) ? ccw : ccw - 2 * Math.PI; }
    else { const mid = mul(add(V[r.i0], V[r.i1 % n]), 0.5), turn = cross(sub(V[r.i1 % n], V[r.i0]), sub(g.c, mid)); sweep = turn >= 0 ? ccw : ccw - 2 * Math.PI; if (Math.abs(sweep) > Math.PI) sweep = ccw <= Math.PI ? ccw : ccw - 2 * Math.PI; }
    bulge.push(Math.abs(sweep) < 1e-12 ? 0 : Math.tan(sweep / 4));
  });
  // drop zero-length segments
  for (let i = outPts.length - 1; i >= 0 && outPts.length > 2; i--) {
    const nx = (i + 1) % outPts.length; if (dist(outPts[i], outPts[nx]) < 1e-9) { outPts.splice(i, 1); bulge.splice(i, 1); }
  }
  return pieceToShape(outPts, bulge, true);
}
export { len };
