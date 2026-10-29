/**
 * Curve fitting (clean-room, after P. J. Schneider, "An Algorithm for
 * Automatically Fitting Digitized Curves", Graphics Gems, 1990): turns a line
 * made of many points into as few smooth Bézier curves as possible, staying
 * within a tolerance of the original. Sharp corners are found first and kept.
 */
import { type Point, P, add, sub, mul, dot, len, dist } from './vec';
import { flatten } from './entity';
import type { Shape } from '../model/types';

type Bez = [Point, Point, Point, Point];
const unit = (v: Point) => { const l = len(v) || 1; return P(v.x / l, v.y / l); };
const bez = (b: Bez, t: number) => { const u = 1 - t; return P(u * u * u * b[0].x + 3 * u * u * t * b[1].x + 3 * u * t * t * b[2].x + t * t * t * b[3].x, u * u * u * b[0].y + 3 * u * u * t * b[1].y + 3 * u * t * t * b[2].y + t * t * t * b[3].y); };
const bez1 = (b: Bez, t: number) => { const u = 1 - t; return add(add(mul(sub(b[1], b[0]), 3 * u * u), mul(sub(b[2], b[1]), 6 * u * t)), mul(sub(b[3], b[2]), 3 * t * t)); };
const bez2 = (b: Bez, t: number) => add(mul(add(sub(b[2], mul(b[1], 2)), b[0]), 6 * (1 - t)), mul(add(sub(b[3], mul(b[2], 2)), b[1]), 6 * t));

function chordParams(d: Point[], a: number, b: number): number[] {
  const u = [0]; for (let i = a + 1; i <= b; i++) u.push(u[u.length - 1] + dist(d[i], d[i - 1]));
  const L = u[u.length - 1] || 1; return u.map(x => x / L);
}
/** Least-squares Bézier through d[a..b] with the given end tangents. */
function generate(d: Point[], a: number, b: number, u: number[], t1: Point, t2: Point): Bez {
  const p0 = d[a], p3 = d[b]; let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < u.length; i++) {
    const t = u[i], s = 1 - t, b0 = s * s * s, b1 = 3 * s * s * t, b2 = 3 * s * t * t, b3 = t * t * t;
    const A1 = mul(t1, b1), A2 = mul(t2, b2);
    c00 += dot(A1, A1); c01 += dot(A1, A2); c11 += dot(A2, A2);
    const tmp = sub(d[a + i], add(mul(p0, b0 + b1), mul(p3, b2 + b3)));
    x0 += dot(A1, tmp); x1 += dot(A2, tmp);
  }
  const det = c00 * c11 - c01 * c01, seg = dist(p0, p3), eps = 1e-6 * seg;
  let al = det === 0 ? 0 : (x0 * c11 - x1 * c01) / det, ar = det === 0 ? 0 : (c00 * x1 - c01 * x0) / det;
  if (al < eps || ar < eps || al > seg * 3 || ar > seg * 3) { al = ar = seg / 3; }   // fall back to a gentle curve
  return [p0, add(p0, mul(t1, al)), add(p3, mul(t2, ar)), p3];
}
function maxError(d: Point[], a: number, b: number, bz: Bez, u: number[]): { err: number; at: number } {
  let err = 0, at = Math.floor((a + b) / 2);
  for (let i = 1; i < u.length - 1; i++) { const e = dist(bez(bz, u[i]), d[a + i]); if (e > err) { err = e; at = a + i; } }
  return { err, at };
}
function reparam(d: Point[], a: number, bz: Bez, u: number[]): number[] {
  return u.map((t, i) => {
    const q = bez(bz, t), q1 = bez1(bz, t), q2 = bez2(bz, t), df = sub(q, d[a + i]);
    const den = dot(q1, q1) + dot(df, q2); if (Math.abs(den) < 1e-12) return t;
    return Math.max(0, Math.min(1, t - dot(df, q1) / den));
  });
}
function fitPart(d: Point[], a: number, b: number, t1: Point, t2: Point, tol: number, out: Bez[], depth = 0) {
  if (b - a === 1) { const s = dist(d[a], d[b]) / 3; out.push([d[a], add(d[a], mul(t1, s)), add(d[b], mul(t2, s)), d[b]]); return; }
  let u = chordParams(d, a, b), bz = generate(d, a, b, u, t1, t2), { err, at } = maxError(d, a, b, bz, u);
  if (err <= tol) { out.push(bz); return; }
  if (err <= Math.max(tol * 25, 1)) for (let k = 0; k < 12; k++) {
    u = reparam(d, a, bz, u); bz = generate(d, a, b, u, t1, t2); const m = maxError(d, a, b, bz, u); err = m.err; at = m.at;
    if (err <= tol) { out.push(bz); return; }
  }
  if (depth > 40) { out.push(bz); return; }
  at = Math.max(a + 1, Math.min(b - 1, at));
  const tc = unit(sub(d[at - 1], d[at + 1]));
  fitPart(d, a, at, t1, tc, tol, out, depth + 1); fitPart(d, at, b, mul(tc, -1), t2, tol, out, depth + 1);
}

/** Even spacing along a polyline (closed: back to the start). */
function resample(pts: Point[], closed: boolean, step: number): Point[] {
  const p = closed ? [...pts, pts[0]] : pts, out = [p[0]]; let carry = 0;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i], L = dist(a, b); let s = step - carry;
    while (s < L) { out.push(add(a, mul(sub(b, a), s / L))); s += step; }
    carry = L - (s - step);
  }
  if (!closed && dist(out[out.length - 1], p[p.length - 1]) > 1e-9) out.push(p[p.length - 1]);
  if (closed && dist(out[out.length - 1], out[0]) < step * 0.5) out.pop();
  return out;
}
/** Indices of sharp corners: where the direction turns by more than cornerDeg over a short window. */
function corners(d: Point[], closed: boolean, win: number, cornerDeg: number): number[] {
  const n = d.length, turn: number[] = new Array(n).fill(0), k = Math.max(1, win);
  for (let i = 0; i < n; i++) {
    if (!closed && (i < k || i >= n - k)) continue;
    const a = d[(i - k + n) % n], b = d[i], c = d[(i + k) % n], u = unit(sub(b, a)), v = unit(sub(c, b));
    turn[i] = Math.acos(Math.max(-1, Math.min(1, dot(u, v)))) * 180 / Math.PI;
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (turn[i] < cornerDeg) continue;
    let peak = true; for (let j = -k; j <= k; j++) { const q = closed ? (i + j + n) % n : i + j; if (q < 0 || q >= n || q === i) continue; if (turn[q] > turn[i] || (turn[q] === turn[i] && q < i)) { peak = false; break; } }
    if (peak) out.push(i);
  }
  return out;
}

export interface FitResult { pts: Point[]; h: [Point, Point][]; closed: boolean }
/**
 * Fit smooth curves to a point list. `tol` = how far (mm) the new line may stray
 * from the old one; larger = fewer nodes. Corners sharper than `cornerDeg` stay sharp.
 */
export function fitPoints(src: Point[], closed: boolean, tol: number, cornerDeg = 60): FitResult {
  const step = Math.max(0.05, Math.min(tol, 0.5)), d = resample(src, closed, step), n = d.length;
  if (n < 3) return { pts: d, h: d.map(p => [p, p] as [Point, Point]), closed };
  const win = Math.max(2, Math.round(Math.max(tol * 6, 2) / step));
  let cs = corners(d, closed, win, cornerDeg);
  // iron out wobbles smaller than the tolerance before fitting (corners are left exactly where they are)
  { const k = Math.max(1, Math.round(tol / step)), pinned = new Set<number>(); for (const c of cs) for (let j = -k; j <= k; j++) pinned.add(closed ? (c + j + n) % n : c + j);
    const sm = d.map((q, i) => { if (pinned.has(i) || (!closed && (i < k || i >= n - k))) return q; let x = 0, y = 0; for (let j = -k; j <= k; j++) { const r = d[(i + j + n) % n]; x += r.x; y += r.y; } return P(x / (2 * k + 1), y / (2 * k + 1)); });
    for (let i = 0; i < n; i++) d[i] = sm[i]; }
  const segs: Bez[] = [], tanAt = (i: number, dir: 1 | -1) => {   // tangent leaving i going forward (1) or backward (-1), from a few samples
    const j = closed ? (i + dir * Math.min(win, 3) + n) % n : Math.max(0, Math.min(n - 1, i + dir * Math.min(win, 3)));
    return unit(sub(d[j], d[i]));
  };
  const run = (a: number, b: number, data: Point[]) => {   // fit data[a..b] (indices into data)
    const t1 = unit(sub(data[Math.min(b, a + Math.min(3, b - a))], data[a])), t2 = unit(sub(data[Math.max(a, b - Math.min(3, b - a))], data[b]));
    fitPart(data, a, b, t1, t2, tol, segs);
  };
  if (!closed) {
    const cuts = [0, ...cs, n - 1];
    for (let i = 0; i < cuts.length - 1; i++) if (cuts[i + 1] > cuts[i]) run(cuts[i], cuts[i + 1], d);
  } else if (cs.length) {
    // closed with corners: go round from corner to corner
    const rot = [...d.slice(cs[0]), ...d.slice(0, cs[0] + 1)], m = rot.length, cuts = [...cs.map(c => (c - cs[0] + n) % n), m - 1].sort((a, b) => a - b);
    for (let i = 0; i < cuts.length - 1; i++) if (cuts[i + 1] > cuts[i]) run(cuts[i], cuts[i + 1], rot);
  } else {
    // closed and smooth all round: start anywhere, with the same tangent at both ends
    const data = [...d, d[0]], t = unit(sub(d[1], d[n - 1]));
    fitPart(data, 0, n, t, mul(t, -1), tol, segs);
  }
  void tanAt;
  // segments → nodes with in/out handles
  const pts: Point[] = [], h: [Point, Point][] = [];
  segs.forEach((s, i) => { if (i === 0) { pts.push(s[0]); h.push([s[0], s[1]]); } else h[h.length - 1][1] = s[1]; pts.push(s[3]); h.push([s[2], s[3]]); });
  if (closed && pts.length > 1) { const last = h.pop()!; pts.pop(); h[0][0] = last[0]; }
  return reduceNodes({ pts, h, closed }, tol * 0.5);
}
/** Remove smooth nodes that the curves either side can do without (staying within tol of the current line). */
function reduceNodes(s: { pts: Point[]; h: [Point, Point][]; closed: boolean }, tol: number): { pts: Point[]; h: [Point, Point][]; closed: boolean } {
  let cur = s;
  for (let pass = 0; pass < 3; pass++) {
    let removed = false;
    for (let i = cur.closed ? 0 : 1; i < cur.pts.length - (cur.closed ? 0 : 1) && cur.pts.length > (cur.closed ? 3 : 2); i++) {
      const p = cur.pts[i], [a, b] = cur.h[i], u = sub(p, a), v = sub(b, p);
      if (len(u) < 1e-9 || len(v) < 1e-9 || Math.abs(u.x * v.y - u.y * v.x) > 0.02 * len(u) * len(v)) continue;   // a corner: keep
      const n = cur.pts.length, pi = (i - 1 + n) % n, ni = (i + 1) % n;
      const B1: Bez = [cur.pts[pi], cur.h[pi][1], cur.h[i][0], cur.pts[i]], B2: Bez = [cur.pts[i], cur.h[i][1], cur.h[ni][0], cur.pts[ni]];
      const data = [...Array.from({ length: 16 }, (_, k) => bez(B1, k / 16)), ...Array.from({ length: 17 }, (_, k) => bez(B2, k / 16))];
      const t1 = len(sub(cur.h[pi][1], cur.pts[pi])) > 1e-9 ? sub(cur.h[pi][1], cur.pts[pi]) : sub(data[1], data[0]);
      const t2 = len(sub(cur.h[ni][0], cur.pts[ni])) > 1e-9 ? sub(cur.h[ni][0], cur.pts[ni]) : sub(data[data.length - 2], data[data.length - 1]);
      const nb = fitOne(data, t1, t2);
      let worst = 0; for (const q of data) { let best = Infinity; for (let k = 0; k <= 240; k++) best = Math.min(best, dist(q, bez(nb, k / 240))); worst = Math.max(worst, best); }
      if (worst > tol) continue;
      const h = cur.h.map(x => [x[0], x[1]] as [Point, Point]); h[pi][1] = nb[1]; h[ni][0] = nb[2];
      cur = { pts: cur.pts.filter((_, k) => k !== i), h: h.filter((_, k) => k !== i), closed: cur.closed }; removed = true; i--;
    }
    if (!removed) break;
  }
  return cur;
}

/** A path or curve rebuilt with as few smooth nodes as it needs (within tol mm). */
export function simplifyShape(s: Shape, tol: number, cornerDeg = 60): Shape | null {
  if (s.type !== 'poly' && s.type !== 'spline') return null;
  const f = flatten(s, Math.min(0.01, tol / 10)); if (f.pts.length < 3) return null;
  const r = fitPoints(f.pts, f.closed, tol, cornerDeg);
  if (r.pts.length < 2) return null;
  return { type: 'spline', pts: r.pts, h: r.h, closed: f.closed } as Shape;
}
/** Largest distance from any point of `a` to the line `b` (sampled), mm. */
export function deviation(a: Shape, b: Shape): number {
  const pa = flatten(a, 0.01).pts, pb = flatten(b, 0.01), q = pb.closed ? [...pb.pts, pb.pts[0]] : pb.pts; let worst = 0;
  for (let i = 0; i < pa.length; i += Math.max(1, Math.floor(pa.length / 400))) {
    const p = pa[i]; let best = Infinity;
    for (let j = 0; j < q.length - 1; j++) { const A = q[j], B = q[j + 1], D = sub(B, A), L2 = dot(D, D) || 1e-12, t = Math.max(0, Math.min(1, dot(sub(p, A), D) / L2)); best = Math.min(best, dist(p, add(A, mul(D, t)))); }
    worst = Math.max(worst, best);
  }
  return worst;
}

// ---------------- node editing helpers (Edit points) ----------------
type Spl = { pts: Point[]; h: [Point, Point][]; closed: boolean };
/** One Bézier through points, leaving and arriving along the given directions (least squares). */
export function fitOne(points: Point[], t1: Point, t2: Point): [Point, Point, Point, Point] {
  const u = chordParams(points, 0, points.length - 1); let bz = generate(points, 0, points.length - 1, u, unit(t1), unit(t2)), uu = u;
  for (let k = 0; k < 8; k++) { uu = reparam(points, 0, bz, uu); bz = generate(points, 0, points.length - 1, uu, unit(t1), unit(t2)); }
  return bz;
}
/** Delete node i of a curve, refitting the two curves either side as one so the shape stays as close as it can. */
export function deleteNodeKeepShape(s: Spl, i: number): Spl {
  const n = s.pts.length, prev = s.closed ? (i - 1 + n) % n : i - 1, next = s.closed ? (i + 1) % n : i + 1;
  if (prev < 0 || next >= n) {   // an end of an open curve: just drop it
    const pts = s.pts.filter((_, k) => k !== i), h = s.h.filter((_, k) => k !== i).map(x => [x[0], x[1]] as [Point, Point]);
    if (i === 0) h[0] = [pts[0], h[0][1]]; else h[h.length - 1] = [h[h.length - 1][0], pts[pts.length - 1]];
    return { pts, h, closed: s.closed };
  }
  const sample = (a: number, b: number) => { const B: Bez = [s.pts[a], s.h[a][1], s.h[b][0], s.pts[b]]; return Array.from({ length: 24 }, (_, k) => bez(B, k / 24)); };
  const pts = [...sample(prev, i), ...sample(i, next), s.pts[next]];
  let t1 = sub(s.h[prev][1], s.pts[prev]); if (len(t1) < 1e-9) t1 = sub(pts[1], pts[0]);
  let t2 = sub(s.h[next][0], s.pts[next]); if (len(t2) < 1e-9) t2 = sub(pts[pts.length - 2], pts[pts.length - 1]);
  const b = fitOne(pts, t1, t2), h = s.h.map(x => [x[0], x[1]] as [Point, Point]);
  h[prev][1] = b[1]; h[next][0] = b[2];
  return { pts: s.pts.filter((_, k) => k !== i), h: h.filter((_, k) => k !== i), closed: s.closed };
}
/** Make node i smooth: its two handles in a straight line through it (keeping their lengths). */
export function smoothNode(s: Spl, i: number): Spl {
  const n = s.pts.length, p = s.pts[i], h = s.h.map(x => [x[0], x[1]] as [Point, Point]);
  const prev = s.closed ? s.pts[(i - 1 + n) % n] : s.pts[i - 1], next = s.closed ? s.pts[(i + 1) % n] : s.pts[i + 1];
  let lin = dist(h[i][0], p), lout = dist(h[i][1], p);
  let dir = sub(h[i][1], h[i][0]); if (len(dir) < 1e-9) dir = sub(next ?? p, prev ?? p);
  if (len(dir) < 1e-9) return s; dir = unit(dir);
  if (lin < 1e-9) lin = prev ? dist(prev, p) / 3 : 0; if (lout < 1e-9) lout = next ? dist(next, p) / 3 : 0;
  h[i] = [sub(p, mul(dir, lin)), add(p, mul(dir, lout))];
  return { ...s, h };
}
/** Make node i a sharp corner (handles pulled in to the point). */
export function cornerNode(s: Spl, i: number): Spl { const h = s.h.map(x => [x[0], x[1]] as [Point, Point]); h[i] = [s.pts[i], s.pts[i]]; return { ...s, h }; }
/**
 * Soft drag: when node i moves by `d`, nearby nodes (within R mm of it) follow
 * part of the way, fading out with distance — reshapes a whole side smoothly.
 */
export function softMove<T extends { pts: Point[]; h?: [Point, Point][] }>(orig: T, moved: T, i: number, d: Point, R: number): T {
  const out: any = structuredClone(moved), c = orig.pts[i];
  orig.pts.forEach((q, k) => {
    if (k === i) return; const r = dist(q, c); if (r >= R) return;
    const w = 0.5 + 0.5 * Math.cos(Math.PI * r / R), dd = mul(d, w);
    out.pts[k] = add(q, dd); if (orig.h && out.h) out.h[k] = [add(orig.h[k][0], dd), add(orig.h[k][1], dd)];
  });
  return out;
}
/** Fit Bézier curves to one run of points with fixed end directions (t1 leaving the start, t2 arriving back from the end). */
export function fitRun(d: Point[], t1: Point, t2: Point, tol: number): [Point, Point, Point, Point][] {
  const out: Bez[] = []; if (d.length < 2) return out; fitPart(d, 0, d.length - 1, unit(t1), unit(t2), tol, out); return out;
}
