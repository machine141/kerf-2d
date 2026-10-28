/**
 * Bend to a profile (clean-room): living-hinge slits that let a flat part bend
 * along a side profile you draw — a leaf curling, a face sloping back, a wing
 * folding forward.
 *
 * Frame: the part's LENGTH axis u runs top→bottom (or left→right); v runs across.
 * The profile is a side view: for each point along the length, how far forward
 * (+z) or back (−z) that part of the wood sits. It is a smooth curve through
 * nodes (u, z) and is treated as the wood's neutral (middle) line.
 *
 * Two ways to read your drawing ("the chicken or the egg"):
 *  • 'look'   — your drawing is what you SEE from the front when it is bent.
 *               The flat piece must be longer: a point at height u is cut at
 *               s(u) = arc length of the profile from the top down to height u.
 *               (The profile must keep going down — it can't fold back.)
 *  • 'length' — your drawing IS the flat piece. The profile is scaled so its
 *               arc length equals the part's length; it can curl and fold over.
 * Slits run across the part (along v), only where the profile bends, spaced to
 * suit the local bend radius, kept G inside every edge and hole.
 */
import ClipperLib from 'clipper-lib';
import { type Point, P, add, sub, mul, len, dist, cross } from '../geometry/vec';
import { flatten, bbox, unionBox, lengthOf } from '../geometry/entity';
import { autoHandles, flattenSpline } from '../geometry/spline';
import { type HMat, type Column, minRadius, bestPitch, pitchRange } from './hinge';
import type { Shape } from '../model/types';

export interface PNode { u: number; z: number }
export type BendMode = 'look' | 'length';
export type Axis = 'v' | 'h';

// ---------------- profile curve ----------------
/** Smooth curve through the nodes, as a dense polyline of P(u, z). */
export function profileCurve(nodes: PNode[]): Point[] {
  const pts = nodes.map(n => P(n.u, n.z));
  if (pts.length < 2) return pts;
  if (pts.length === 2) return [pts[0], pts[1]];
  return flattenSpline({ pts, h: autoHandles(pts, false), closed: false }, 0.002);
}
/** Even spacing along the curve (h mm) with cumulative lengths. */
export function resample(poly: Point[], h = 0.25): { pts: Point[]; s: number[]; total: number } {
  const cum = [0]; for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + dist(poly[i - 1], poly[i]));
  const total = cum[cum.length - 1], n = Math.max(2, Math.ceil(total / h)), pts: Point[] = [], s: number[] = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const x = total * k / n; while (j < poly.length - 2 && cum[j + 1] < x) j++;
    const seg = cum[j + 1] - cum[j] || 1e-12, t = Math.min(1, Math.max(0, (x - cum[j]) / seg));
    pts.push(add(poly[j], mul(sub(poly[j + 1], poly[j]), t))); s.push(x);
  }
  return { pts, s, total };
}
/** Signed bend radius along an open curve (+ = bends one way, − = the other), turning over a w-mm window. */
export function openRadii(poly: Point[], h = 0.25, w = 3): { s: number[]; R: number[]; total: number } {
  // circle through three points w apart (start, middle, end of the window); profiles are smooth curves
  const r = resample(poly, h), n = r.pts.length, k = Math.max(1, Math.round(w / 2 / (r.total / (n - 1) || 1))), R: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - k), b = Math.min(n - 1, i + k), m = Math.round((a + b) / 2);
    if (b - a < 2) { R.push(Infinity); continue; }
    const A = r.pts[a], M = r.pts[m], C = r.pts[b], cr = cross(sub(M, A), sub(C, M));
    R.push(Math.abs(cr) < 1e-12 ? Infinity : dist(A, M) * dist(M, C) * dist(A, C) / (2 * cr));
  }
  return { s: r.s, R, total: r.total };
}

/** Does the curve keep moving along u (never turns back)? */
export function monotoneU(poly: Point[]): boolean { for (let i = 1; i < poly.length; i++) if (poly[i].x < poly[i - 1].x - 1e-9) return false; return true; }

// ---------------- presets (u, z as fractions of the length) ----------------
export const PRESETS: { id: string; name: string; n: [number, number][] }[] = [
  { id: 'straight', name: 'Straight', n: [[0, 0], [0.5, 0], [1, 0]] },
  { id: 'arc', name: 'Arc', n: [[0, 0], [0.5, 0.16], [1, 0]] },
  { id: 'scurve', name: 'S-curve', n: [[0, 0], [0.25, 0.1], [0.5, 0], [0.75, -0.1], [1, 0]] },
  { id: 'wave', name: 'Wave', n: [[0, 0], [1 / 6, 0.06], [1 / 3, 0], [0.5, -0.06], [2 / 3, 0], [5 / 6, 0.06], [1, 0]] },
  { id: 'lean', name: 'Slope back', n: [[0, -0.32], [0.35, -0.1], [0.7, -0.015], [1, 0]] },
  { id: 'tip', name: 'Tip folds forward', n: [[0, 0], [0.55, 0], [0.8, 0.05], [0.93, 0.17], [1, 0.32]] },
  { id: 'fish', name: 'Streamline', n: [[0, 0], [0.25, 0.11], [0.6, 0.13], [1, 0.02]] },
];
export const presetNodes = (id: string, Lu: number, depth = 1): PNode[] => (PRESETS.find(p => p.id === id) || PRESETS[0]).n.map(([u, z]) => ({ u: u * Lu, z: z * Lu * depth }));

/** Nodes from a curve the user drew (spline knots or path corners), measured along its own first→last direction. */
export function nodesFromCurve(s: Shape, Lu: number): PNode[] | null {
  let pts: Point[];
  if (s.type === 'spline') pts = s.pts.slice();
  else if (s.type === 'poly' && !s.closed) pts = s.pts.length > 2 ? s.pts.slice() : flatten(s, 0.05).pts;
  else if (s.type === 'arc' || s.type === 'line' || s.type === 'poly') pts = flatten(s, 0.05).pts;
  else return null;
  if (pts.length > 12) pts = pts.filter((_, i) => i % Math.ceil(pts.length / 10) === 0 || i === pts.length - 1);
  if (pts.length < 2) return null;
  const a = pts[0], b = pts[pts.length - 1], d = sub(b, a), L = len(d); if (L < 1e-6) return null;
  // take the downward/rightward end as the start so the profile reads top→bottom / left→right
  const flip = Math.abs(d.y) >= Math.abs(d.x) ? d.y > 0 : d.x < 0, q = flip ? pts.slice().reverse() : pts;
  const A = q[0], D = sub(q[q.length - 1], A), T = mul(D, 1 / L), N = P(T.y, -T.x), k = Lu / L;
  const out = q.map(p => ({ u: ((p.x - A.x) * T.x + (p.y - A.y) * T.y) * k, z: ((p.x - A.x) * N.x + (p.y - A.y) * N.y) * k }));
  out[0].u = 0; out[out.length - 1].u = Lu;
  return out;
}

// ---------------- the plan ----------------
export interface BendOpts {
  mode: BendMode; axis: Axis; t: number; kerf: number; mat: HMat; sf: number;
  G: number; L: number; adapt: boolean; where: 'bends' | 'all'; D: number;
  ribs: number; ribDepth: number;
}
export interface BendPlan {
  Lu: number; Ls: number; stretch: number; tightest: number;
  profile: Point[];                        // the curve actually used, P(u, z), arc length Ls
  flat: Shape[]; slits: Shape[]; slitState: Column['state'][]; columns: (Column & { Leff: number })[];
  front: Shape[];                          // what it looks like from the front once bent
  ribs: Shape[];                           // former(s), in side-view coordinates P(u, z) moved to start at 0
  marks: Shape[];                          // engrave guides on the flat piece (where the former goes)
  state: 'ok' | 'tight' | 'bad'; warnings: string[]; cutLen: number; frame: { ox: number; oy: number };
}

const S = 1e5, toI = (p: Point[]) => p.map(q => ({ X: Math.round(q.x * S), Y: Math.round(q.y * S) })), fromI = (p: any[]) => p.map(q => P(q.X / S, q.Y / S));
function dp(p: Point[], tol: number): Point[] {
  if (p.length < 3) return p;
  const keep = new Uint8Array(p.length); keep[0] = keep[p.length - 1] = 1; const st: [number, number][] = [[0, p.length - 1]];
  while (st.length) { const [a, b] = st.pop()!; const A = p[a], B = p[b], d = sub(B, A), L = len(d) || 1e-12; let m = -1, md = tol;
    for (let i = a + 1; i < b; i++) { const e = Math.abs(cross(d, sub(p[i], A))) / L; if (e > md) { md = e; m = i; } } if (m > 0) { keep[m] = 1; st.push([a, m], [m, b]); } }
  return p.filter((_, i) => keep[i]);
}

export function bendPlan(shapes: Shape[], nodes: PNode[], o: BendOpts): BendPlan | { error: string } {
  const parts = shapes.filter(s => s.type !== 'dim'); if (!parts.length) return { error: 'Select the shape to bend' };
  const B = unionBox(parts.map(s => bbox(s)))!;
  // world ↔ (u along the length, v across)
  const vert = o.axis === 'v', Lu = vert ? B.y1 - B.y0 : B.x1 - B.x0;
  if (Lu < 1) return { error: 'The shape is too small to bend' };
  const toUV = (p: Point) => vert ? P(B.y1 - p.y, p.x) : P(p.x - B.x0, p.y);
  const fromUV = (u: number, v: number) => vert ? P(v, B.y1 - u) : P(B.x0 + u, v);
  // the profile curve, in mm
  let prof = profileCurve(nodes);   // nodes are kept in order along the curve by the editor
  if (prof.length < 2) return { error: 'The profile needs at least two points' };
  if (o.mode === 'look' && !monotoneU(prof)) return { error: 'This profile turns back on itself — choose "Keep its length" to curl or fold over' };
  let rs = resample(prof, 0.25);
  if (o.mode === 'length') { const k = Lu / rs.total, a = prof[0]; prof = prof.map(p => add(a, mul(sub(p, a), k))); rs = resample(prof, 0.25); }
  const Ls = rs.total;
  // s(u) for 'look': arc length at the point where the profile reaches height u
  const sOfU = (u: number): number => {
    if (o.mode === 'length') return u;
    const p = rs.pts; if (u <= p[0].x) return 0; if (u >= p[p.length - 1].x) return Ls;
    let lo = 0, hi = p.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m].x <= u) lo = m; else hi = m; }
    const du = p[hi].x - p[lo].x; return rs.s[lo] + (du > 1e-12 ? (u - p[lo].x) / du : 0) * (rs.s[hi] - rs.s[lo]);
  };
  // profile point at arc length s (for the front view in 'length' mode)
  const profAt = (s: number): Point => { const i = Math.min(rs.pts.length - 1, Math.max(0, Math.round(s / (Ls / (rs.pts.length - 1))))); return rs.pts[i]; };

  // ---------- flat piece: every shape re-mapped u → s ----------
  const flat: Shape[] = [], front: Shape[] = [], closedUV: Point[][] = [];
  for (const s of parts) {
    const f = flatten(s, 0.02), uv = f.pts.map(toUV), sv = uv.map(q => P(sOfU(q.x), q.y));
    const back = (q: Point) => fromUV(q.x, q.y);
    flat.push({ type: 'poly', closed: f.closed, pts: dp(sv, 0.004).map(back) } as Shape);
    if (f.closed) closedUV.push(sv);
    if (o.mode === 'length') front.push({ type: 'poly', closed: f.closed, pts: dp(uv.map(q => P(profAt(q.x).x, q.y)), 0.01).map(back) } as Shape);
    else front.push(structuredClone(s));
  }
  if (!closedUV.length) return { error: 'Select a closed shape (the part to bend)' };

  // ---------- where it bends ----------
  const rad = openRadii(prof, 0.25, 3), n = rad.s.length, du = Ls / (n - 1);
  const Rat = (s: number, w: number) => { const i0 = Math.max(0, Math.floor((s - w) / du)), i1 = Math.min(n - 1, Math.ceil((s + w) / du)); let m = Infinity; for (let i = i0; i <= i1; i++) m = Math.min(m, Math.abs(rad.R[i])); return m; };
  let tightest = Infinity; for (const r of rad.R) tightest = Math.min(tightest, Math.abs(r));
  const { lo: Dlo, hi: Dhi } = pitchRange(o.t, o.kerf, o.mat), freeR = o.mat.freeK * o.t;
  const need: boolean[] = rad.R.map(r => o.where === 'all' || Math.abs(r) < freeR);
  if (o.where === 'bends') { const pad = Math.max(6, 2 * Dhi), k = Math.ceil(pad / du), src = need.slice(); src.forEach((b, i) => { if (b) for (let j = Math.max(0, i - k); j <= Math.min(n - 1, i + k); j++) need[j] = true; }); }

  // ---------- the region slits may use: the flat piece inset by G (holes grow by G) ----------
  const c = new ClipperLib.Clipper(); c.AddPaths(closedUV.map(toI), ClipperLib.PolyType.ptSubject, true);
  const solid = new ClipperLib.Paths(); c.Execute(ClipperLib.ClipType.ctUnion, solid, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
  const co = new ClipperLib.ClipperOffset(2, 0.0005 * S); co.AddPaths(solid, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const ins = new ClipperLib.Paths(); co.Execute(ins, -o.G * S); const inset: Point[][] = (ins as any[]).map(fromI);
  const vs = inset.flat().map(q => q.y), v0 = vs.length ? Math.min(...vs) : 0;
  const Pd = o.L + o.G;
  const cutsAt = (s: number, kind: 'A' | 'B'): [number, number][] => {
    const hits: number[] = [];
    for (const pl of inset) for (let i = 0; i < pl.length; i++) { const a = pl[i], b = pl[(i + 1) % pl.length]; if ((a.x <= s) !== (b.x <= s)) hits.push(a.y + (s - a.x) / (b.x - a.x) * (b.y - a.y)); }
    hits.sort((a, b) => a - b); const out: [number, number][] = [], off = kind === 'B' ? Pd / 2 : 0;
    for (let i = 0; i + 1 < hits.length; i += 2) {
      const ia = hits[i], ib = hits[i + 1];
      for (let c0 = v0 - Pd + off; c0 < ib; c0 += Pd) { const a = Math.max(ia, c0), b = Math.min(ib, c0 + o.L); if (b - a >= Math.max(2 * o.G, 1)) out.push([a, b]); }
    }
    return out;
  };

  // ---------- columns ----------
  const columns: (Column & { Leff: number })[] = [], slits: Shape[] = [], slitState: Column['state'][] = [];
  let x = Math.max(o.G, 2), run = 0, cut = 0;
  while (x <= Ls - Math.max(o.G, 2)) {
    const i = Math.min(n - 1, Math.round(x / du));
    if (!need[i]) { x += 0.5; run = 0; continue; }
    const R = Rat(x, Math.max(Dhi, 2));
    let D = o.adapt ? (bestPitch(R, o.L, o.t, o.kerf, o.mat, o.sf) ?? Dlo) : o.D;
    if (o.adapt) D = Math.min(Math.max(D, Dlo), Dhi);
    const kind: 'A' | 'B' = run % 2 ? 'B' : 'A', cs = cutsAt(x, kind);
    const Leff = cs.length ? Math.max(...cs.map(([a, b]) => b - a)) : 0;
    const Rmin = minRadius(D, Math.max(Leff, 0.1), o.t, o.kerf, o.mat.gamma);
    const state: Column['state'] = !cs.length ? (R < freeR ? 'bad' : 'ok') : Rmin * o.sf <= R ? 'ok' : Rmin <= R ? 'tight' : 'bad';
    columns.push({ x, D, kind, R, Rmin, state, Leff });
    for (const [a, b] of cs) { slits.push({ type: 'line', a: fromUV(x, a), b: fromUV(x, b) } as Shape); slitState.push(state); cut += b - a; }
    run++; x += D;
  }

  // ---------- former (rib): a stand cut to the profile, the part glues onto its edge ----------
  const ribs: Shape[] = [], marks: Shape[] = [];
  if (o.ribs > 0) {
    const r = resample(prof, 0.5), back: Point[] = [], outer: Point[] = [];
    for (let i = 0; i < r.pts.length; i++) {
      const a = r.pts[Math.max(0, i - 1)], b = r.pts[Math.min(r.pts.length - 1, i + 1)], d = sub(b, a), L = len(d) || 1, nrm = P(-d.y / L, d.x / L); // +z side
      back.push(add(r.pts[i], mul(nrm, -o.t / 2))); outer.push(add(r.pts[i], mul(nrm, -o.t / 2 - o.ribDepth)));
    }
    const ring = back.concat(outer.reverse()), cc = new ClipperLib.Clipper(), sol = new ClipperLib.Paths();
    cc.AddPath(toI(ring), ClipperLib.PolyType.ptSubject, true); cc.Execute(ClipperLib.ClipType.ctUnion, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    const best = (sol as any[]).sort((a, b) => Math.abs(ClipperLib.Clipper.Area(b)) - Math.abs(ClipperLib.Clipper.Area(a)))[0];
    if (best) { const pts = dp(fromI(best), 0.01), m = Math.min(...pts.map(q => q.x)), mz = Math.min(...pts.map(q => q.y)); for (let k = 0; k < o.ribs; k++) ribs.push({ type: 'poly', closed: true, pts: pts.map(q => P(q.x - m, q.y - mz)) } as Shape); }
    // engrave where each former meets the flat piece (centre line, or thirds for two)
    const vs2 = closedUV.flat().map(q => q.y), vlo = Math.min(...vs2), vhi = Math.max(...vs2);
    const at = o.ribs === 1 ? [(vlo + vhi) / 2] : [vlo + (vhi - vlo) / 3, vlo + 2 * (vhi - vlo) / 3];
    for (const v of at) marks.push({ type: 'line', a: fromUV(0, v), b: fromUV(Ls, v) } as Shape);
  }

  // ---------- verdict ----------
  const warnings: string[] = [];
  const Rcap = minRadius(Dlo, o.L, o.t, o.kerf, o.mat.gamma);
  if (tightest < Rcap) warnings.push(`The tightest bend (R ${tightest.toFixed(1)} mm) is sharper than this wood can manage (about R ${Math.ceil(Rcap)} mm) — soften it`);
  const narrow = columns.filter(c => c.Leff > 0 && c.Leff < o.L * 0.5 && c.state !== 'ok').length;
  if (narrow) warnings.push('Narrow parts (near the tips) have short slits, so they bend less — give them a gentler curve');
  if (o.mat.warn) warnings.unshift(o.mat.note!);
  if (o.mode === 'look' && Ls > Lu * 1.6) warnings.push(`The flat piece is ${(Ls / Lu * 100 - 100).toFixed(0)}% longer than your drawing — a very deep profile`);
  const state: BendPlan['state'] = columns.some(c => c.state === 'bad') || tightest < Rcap ? 'bad' : columns.some(c => c.state === 'tight') ? 'tight' : 'ok';
  let cutLen = cut; for (const s of flat) cutLen += lengthOf(s); for (const s of ribs) cutLen += lengthOf(s);
  return { Lu, Ls, stretch: Ls / Lu, tightest, profile: prof, flat, slits, slitState, columns, front, ribs, marks, state, warnings, cutLen, frame: { ox: B.x0, oy: B.y0 } };
}

/** Tightest radius allowed while dragging (finest spacing, no safety margin). */
export const hardLimit = (L: number, t: number, kerf: number, mat: HMat) => minRadius(pitchRange(t, kerf, mat).lo, L, t, kerf, mat.gamma);
/** Tightest bend of a node set (for the drag limit). */
export function tightestOf(nodes: PNode[], mode: BendMode, Lu: number): number {
  let prof = profileCurve(nodes);
  if (mode === 'length') { const r = resample(prof, 0.5), k = Lu / (r.total || 1), a = prof[0]; prof = prof.map(p => add(a, mul(sub(p, a), k))); }
  const r = openRadii(prof, 0.25, 3); let m = Infinity; for (const x of r.R) m = Math.min(m, Math.abs(x)); return m;
}
