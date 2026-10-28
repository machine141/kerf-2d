/**
 * Living hinges (clean-room).
 *
 * Pattern: columns of straight slits across the strip, alternating
 *   A — m slits of length L with bridges G between them and at both edges;
 *   B — the same, shifted half a period, so its end slits run out to the edges
 *       ("open" edges, the classic most-flexible form) or stop G short ("closed").
 * Bending works by twisting the thin links (width w = D − kerf) between columns.
 * A link of length L twisted by φ has surface shear strain ≈ φ·min(w, t)/L, so
 * with an allowable strain γ each column can turn φ = γL/min(w,t). Over a bend of
 * radius R one column (pitch D) must turn D/R, hence the tightest radius
 *     R_min = D · min(w, t) / (L · γ).
 * γ values per material are estimates — the Test strips mode calibrates them.
 *
 * Wrap: the strip's length is the perimeter of the shape offset by half the
 * strip thickness (the neutral line, which neither stretches nor squashes).
 */
import ClipperLib from 'clipper-lib';
import { type Point, P, add, sub, mul, len, cross, dist } from '../geometry/vec';
import { prims, lengthOf } from '../geometry/entity';
import { offsetGeos, refit, booleanShapes } from '../geometry/boolean';
import { makeSource, offsetPaths, solidOf } from '../geometry/offset';
import { vertexCorner, cornerAny } from '../geometry/corner';
import { pieceToShape } from '../geometry/trim';
import type { Shape } from '../model/types';

// ---------------- materials & pattern maths ----------------
export interface HMat { id: string; name: string; gamma: number; freeK: number; wMin: number; note?: string; warn?: boolean }
/** gamma: allowable surface shear strain; freeK: plain (uncut) sheet bends to about freeK × t; wMin: thinnest link (mm). */
export const MATERIALS: HMat[] = [
  { id: 'ply', name: 'Birch plywood', gamma: 0.015, freeK: 80, wMin: 1.0 },
  { id: 'mdf', name: 'MDF', gamma: 0.008, freeK: 250, wMin: 1.5, note: 'MDF has short fibres, so it is weaker than plywood: use gentle curves and test first.' },
  { id: 'card', name: 'Card / greyboard', gamma: 0.03, freeK: 30, wMin: 1.0 },
  { id: 'acrylic', name: 'Acrylic (cast)', gamma: 0.005, freeK: 200, wMin: 1.5, warn: true, note: 'Acrylic is brittle: slits make it crack. Bending a plain strip with a strip heater is usually the better way.' },
];
export interface Pattern { D: number; m: number; G: number; open: boolean }
export const slitLen = (H: number, m: number, G: number) => (H - (m + 1) * G) / m;
export const linkW = (D: number, kerf: number) => Math.max(0.05, D - kerf);
export function minRadius(D: number, L: number, t: number, kerf: number, gamma: number): number {
  return D * Math.min(linkW(D, kerf), t) / (Math.max(L, 0.1) * gamma);
}
export const pitchRange = (t: number, kerf: number, mat: HMat) => { const lo = kerf + mat.wMin; return { lo, hi: Math.max(lo, Math.min(4 * t, 12)) }; };
/** Widest pitch that still bends to radius R with safety factor sf (null if even the finest pitch can't). */
export function bestPitch(R: number, L: number, t: number, kerf: number, mat: HMat, sf: number): number | null {
  const { lo, hi } = pitchRange(t, kerf, mat), Q = R * L * mat.gamma / sf;
  let D = (kerf + Math.sqrt(kerf * kerf + 4 * Q)) / 2;           // D(D−kerf) = Q while the link is thinner than t
  if (D - kerf > t) D = Q / t;                                     // D·t = Q once the link is wider than t
  D = Math.min(hi, Math.floor(D * 20 + 1e-9) / 20);
  return D + 1e-9 >= lo ? D : null;
}
export interface Rec { D: number; m: number; G: number; L: number; Rmin: number; ok: boolean; error?: string }
/** Recommend bridge, slits per column and pitch for a strip H tall that must bend to radius Rreq. */
export function recommend(H: number, t: number, kerf: number, mat: HMat, Rreq: number, sf = 1.5): Rec {
  let G = Math.round(Math.min(8, Math.max(1.5, 1.2 * t)) * 10) / 10;
  const Lmax = Math.max(20, 15 * t);
  let m = Math.max(1, Math.ceil((H - G) / (Lmax + G))), L = slitLen(H, m, G);
  if (L < 2 * G) { G = Math.max(1, Math.round(H / 5 * 10) / 10); m = 1; L = slitLen(H, 1, G); }
  if (L < 2 * G || L <= 0) return { D: pitchRange(t, kerf, mat).lo, m: 1, G, L: Math.max(0, L), Rmin: Infinity, ok: false, error: 'The strip is too narrow for hinge slits' };
  const D = bestPitch(Rreq, L, t, kerf, mat, sf), Dz = D ?? pitchRange(t, kerf, mat).lo;
  return { D: Dz, m, G, L, Rmin: minRadius(Dz, L, t, kerf, mat.gamma), ok: D != null };
}

/** Slits of one column across a strip H tall: [y0, y1] pairs. */
export function columnCuts(H: number, p: Pattern, kind: 'A' | 'B'): [number, number][] {
  const L = slitLen(H, p.m, p.G), G = p.G, out: [number, number][] = [];
  if (L <= 0) return out;
  if (kind === 'A') { for (let k = 0; k < p.m; k++) { const y0 = G + k * (L + G); out.push([y0, y0 + L]); } return out; }
  const gaps = Array.from({ length: p.m }, (_, k) => G + L / 2 + k * (L + G));
  let y = p.open ? 0 : G;
  for (const c of gaps) { out.push([y, c - G / 2]); y = c + G / 2; }
  out.push([y, p.open ? H : H - G]);
  return out.filter(([a, b]) => b - a >= (p.open && (a <= 0 || b >= H) ? 0.5 : Math.max(1, G)));
}

// ---------------- curve helpers ----------------
const area = (pts: Point[]) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; } return a / 2; };
export interface Curve { pts: Point[]; s: number[]; total: number }
/** Closed polyline, anticlockwise, with cumulative lengths. */
export function curveOf(pts: Point[]): Curve {
  // drop points closer than 0.02 mm to the last one kept (Clipper's integer rounding leaves tiny zig-zags)
  const kept: Point[] = []; for (const p of pts) if (!kept.length || dist(kept[kept.length - 1], p) >= 0.02) kept.push(p);
  while (kept.length > 3 && dist(kept[0], kept[kept.length - 1]) < 0.02) kept.pop();
  const q = area(kept) < 0 ? kept.slice().reverse() : kept, s = [0];
  for (let i = 1; i <= q.length; i++) s.push(s[i - 1] + dist(q[i - 1], q[i % q.length]));
  return { pts: q, s, total: s[q.length] };
}
/** Point and unit tangent at arc length u (wraps round). */
export function at(c: Curve, u: number): { p: Point; t: Point } {
  u = ((u % c.total) + c.total) % c.total;
  let lo = 0, hi = c.pts.length; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c.s[m] <= u) lo = m; else hi = m; }
  const a = c.pts[lo], b = c.pts[(lo + 1) % c.pts.length], seg = c.s[lo + 1] - c.s[lo] || 1e-12, k = (u - c.s[lo]) / seg, d = sub(b, a), L = len(d) || 1;
  return { p: add(a, mul(d, k)), t: mul(d, 1 / L) };
}
/**
 * Signed bend radius every h mm (positive = round the shape, negative = hollow).
 * Each vertex's turn is spread over the half-segments either side of it, and
 * R = window length ÷ total turn inside the window — smooth on finely divided
 * curves, and a true sharp corner shows up as a very small radius.
 */
export function radii(c: Curve, h = 0.5, win = 3): { u: number[]; R: number[] } {
  const n = c.pts.length, segL = (i: number) => c.s[i + 1] - c.s[i], spread = 1;
  const xs: number[] = [], Fs: number[] = []; let acc = 0;
  for (let i = 0; i < n; i++) {
    const a = c.pts[(i - 1 + n) % n], b = c.pts[i], d = c.pts[(i + 1) % n], u1 = sub(b, a), u2 = sub(d, b), th = Math.atan2(cross(u1, u2), u1.x * u2.x + u1.y * u2.y);
    const before = Math.min(segL((i - 1 + n) % n) / 2, spread), after = Math.min(segL(i) / 2, spread);
    xs.push(c.s[i] - before); Fs.push(acc); acc += th; xs.push(c.s[i] + after); Fs.push(acc);
  }
  const Ttot = acc, T = c.total;
  // F(x) for any x: piecewise linear through (xs, Fs), repeating every T with a rise of Ttot
  const Fat = (x: number): number => {
    const k = Math.floor((x - xs[0]) / T), xr = x - k * T;            // xr in [xs0, xs0 + T)
    let lo = 0, hi = xs.length; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= xr) lo = m; else hi = m; }
    const xa = xs[lo], fa = Fs[lo], xb = lo + 1 < xs.length ? xs[lo + 1] : xs[0] + T, fb = lo + 1 < xs.length ? Fs[lo + 1] : Fs[0] + Ttot;
    return k * Ttot + fa + (xb > xa ? Math.min(1, Math.max(0, (xr - xa) / (xb - xa))) : 0) * (fb - fa);
  };
  const lens = Array.from({ length: n }, (_, i) => segL(i)).sort((a, b) => a - b), med = lens[n >> 1];
  const w = Math.max(win, 2.5 * Math.min(med, 2 * spread)), N = Math.max(12, Math.ceil(T / h)), du = T / N, u: number[] = [], R: number[] = [];
  for (let j = 0; j < N; j++) { const x = j * du, turn = Fat(x + w / 2) - Fat(x - w / 2); u.push(x); R.push(Math.abs(turn) < 1e-9 ? Infinity : w / turn); }
  return { u, R };
}

// ---------------- exact offsets & rounding ----------------
const largest = (paths: Point[][]) => paths.slice().sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)))[0];
/** Exact (lines/arcs) offset of closed shapes' outer outline; d > 0 grows. */
export function offsetOutline(shapes: Shape[], d: number): Shape | null {
  const src = makeSource(shapes); if (!src.solid.length) return null;
  if (Math.abs(d) < 1e-9) { const o = largest(src.closed); return o ? { type: 'poly', closed: true, pts: o } as Shape : null; }
  const pts = largest(offsetPaths(src.solid, [], d, true)); if (!pts) return null;
  return refit(pts, offsetGeos(shapes.flatMap(s => prims(s)), [Math.abs(d)]));
}
/**
 * Round every corner with radius r. A closed path uses the exact fillet engine
 * (corners next to straight lines or arcs); anything else falls back to
 * offsetting in and out (rounds outside corners) then out and in (inside corners).
 */
export function roundCorners(shapes: Shape[], r: number): Shape | null {
  if (shapes.length === 1 && shapes[0].type === 'poly' && shapes[0].closed) {
    const p0 = shapes[0];
    let cur = { pts: p0.pts.slice(), bulge: p0.pts.map((_, k) => p0.bulge?.[k] || 0), closed: true };
    for (let i = cur.pts.length - 1; i >= 0; i--) { if (!vertexCorner(cur, i)) continue; const res = cornerAny(cur, i, r, 'fillet'); if (!('error' in res)) cur = res; }
    return pieceToShape(cur.pts, cur.bulge, true);
  }
  let s: Shape | null = offsetOutline(shapes, -r); if (!s) return null;
  s = offsetOutline([s], r); if (!s) return null;
  s = offsetOutline([s], r); if (!s) return null;
  return offsetOutline([s], -r);
}
/** The shape's outer outline as a dense closed polyline (anticlockwise). */
export function outlineOf(shapes: Shape[]): Point[] | null {
  const src = makeSource(shapes); if (!src.solid.length) return null;
  const o = largest(offsetPaths(src.solid, [], 0.0001, true)); return o ? curveOf(o).pts : null;
}

/** Grow a simple polygon by d with sharp corners (kerf compensation for straight-edged parts). */
export function growPoly(pts: Point[], d: number): Point[] {
  if (Math.abs(d) < 1e-9) return pts;
  const S = 1e5, co = new ClipperLib.ClipperOffset(8, 0.25), out = new ClipperLib.Paths();
  co.AddPath(pts.map(p => ({ X: Math.round(p.x * S), Y: Math.round(p.y * S) })), ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon); co.Execute(out, d * S);
  const best = (out as any[]).sort((a, b) => Math.abs(ClipperLib.Clipper.Area(b)) - Math.abs(ClipperLib.Clipper.Area(a)))[0];
  return best ? best.map((q: any) => P(Math.round(q.X / S * 1e4) / 1e4, Math.round(q.Y / S * 1e4) / 1e4)) : pts;
}

// ---------------- wrap a shape ----------------
/** plain: just the shape · shelf: bigger plate + the shape glued on · tabs: tabs on the strip into slots in a bigger plate ·
 *  through: tabs on the shape itself poke out through slots (or notches) in the strip */
export type Joint = 'none' | 'plain' | 'shelf' | 'tabs' | 'through';
export interface WrapOpts {
  H: number; t: number; kerf: number; mat: HMat; sf: number;
  pattern: Pattern; adapt: boolean; where: 'bends' | 'all';
  base: Joint; lid: Joint; tabs: number; tabW: number; lip: number; clearance: number;
  /** 'through' joint: gap between the strip's edge and the plate (0 = open notches at the edge, else closed slots) */
  raise?: number;
  /** longest strip piece that fits the bed */
  maxLen: number;
}
export interface Column { x: number; D: number; kind: 'A' | 'B'; R: number; Rmin: number; state: 'ok' | 'tight' | 'bad' }
export interface Part { name: string; cut: Shape[]; mark?: Shape[]; slits?: Shape[]; slitState?: Column['state'][] }
export interface WrapPlan {
  total: number; tightest: number; hollow: boolean; seam: number;
  corners: Point[]; columns: Column[]; tabs: number[]; splits: number[];
  slitCount: number; cutLen: number; parts: Part[]; warnings: string[];
  state: 'ok' | 'tight' | 'bad'; Drange: [number, number];
}
/** Radius the strip needs at strip position x (smallest |R| within ±w). */
function needR(rad: { u: number[]; R: number[] }, total: number, u: number, w: number): number {
  const n = rad.u.length, du = total / n, i0 = Math.round((u - w) / du), i1 = Math.round((u + w) / du); let m = Infinity;
  for (let i = i0; i <= i1; i++) { const r = rad.R[((i % n) + n) % n]; if (r > 0 && r < m) m = r; else if (r < 0 && -r < m) m = -r; }
  return m;
}
const seg = (a: Point, b: Point) => ({ type: 'line', a, b }) as Shape;
const polyS = (pts: Point[]) => ({ type: 'poly', closed: true, pts }) as Shape;

export function wrapPlan(shapes: Shape[], o: WrapOpts): WrapPlan | { error: string } {
  const outline = outlineOf(shapes); if (!outline) return { error: 'Select a closed shape to wrap' };
  const t = o.t, warnings: string[] = [];
  const midPts = largest(offsetPaths(solidOf([outline]), [], t / 2, true)); if (!midPts) return { error: 'Could not follow that shape' };
  const mid = curveOf(midPts), total = mid.total, rad = radii(mid);
  const L = slitLen(o.H, o.pattern.m, o.pattern.G);
  if (L <= 0.5) return { error: 'The strip is too narrow for these slits: lower the slits per column or the gap' };
  const { lo: Dlo, hi: Dhi } = pitchRange(t, o.kerf, o.mat), freeR = o.mat.freeK * t;
  // tightest bend and sharp corners (bends tighter than the finest pitch can manage)
  let tightest = Infinity, hollow = false; const corners: Point[] = [];
  const Rcap = minRadius(Dlo, L, t, o.kerf, o.mat.gamma);
  rad.R.forEach((r, i) => { const a = Math.abs(r); if (a < tightest) tightest = a; if (r < 0 && a < freeR) hollow = true;
    if (a < Rcap * o.sf) { const p = at(mid, rad.u[i]).p; if (!corners.some(c => dist(c, p) < 4 * t)) corners.push(p); } });
  // seam at the flattest place
  let seam = 0, best = -1; rad.R.forEach((r, i) => { const a = Math.min(Math.abs(r), 1e6); if (a > best) { best = a; seam = rad.u[i]; } });
  const flatAt = (x: number) => needR(rad, total, seam + x, 2);
  // tabs: evenly spaced, each nudged to the flattest spot nearby
  const tabs: number[] = [];
  const tabbed = (j: Joint) => j === 'tabs' || j === 'through';
  if ((tabbed(o.base) || tabbed(o.lid)) && o.tabs > 0) {
    // the flattest spots, kept well spread out round the shape and away from the strip's ends
    const n = Math.round(o.tabs), sep = total / (n * 1.6), edge = o.tabW / 2 + 4, cand: { x: number; r: number }[] = [];
    for (let x = edge; x <= total - edge; x += 1) cand.push({ x, r: flatAt(x) });
    cand.sort((a, b) => b.r - a.r);
    const cdist = (a: number, b: number) => { const d = Math.abs(a - b) % total; return Math.min(d, total - d); };
    for (const c of cand) { if (tabs.length >= n) break; if (tabs.every(x => cdist(x, c.x) >= sep)) tabs.push(c.x); }
    tabs.sort((a, b) => a - b);
  }
  // split into pieces that fit the bed
  const splits: number[] = [];
  // each join goes at the flattest place that still keeps every piece short enough
  const maxLen = Math.max(50, o.maxLen), pieces0 = Math.ceil(total / maxLen);
  if (pieces0 > 1) {
    let cur = 0;
    while (total - cur > maxLen) {
      const left = Math.ceil((total - cur) / maxLen), lo = Math.max(cur + 0.5 * maxLen, total - (left - 1) * maxLen), hi = cur + maxLen - 1;
      let bx = hi, br = -1;
      for (let x = lo; x <= hi; x += 1) { if (tabs.some(tx => Math.abs(x - tx) < o.tabW / 2 + 6)) continue; const r = flatAt(x); if (r > br + 1e-6) { br = r; bx = x; } }
      splits.push(bx); cur = bx;
    }
  }
  const pieces = splits.length + 1;
  if (pieces > 1) warnings.push(`The strip is ${total.toFixed(0)} mm long, so it is cut in ${pieces} pieces that fit the bed — glue a thin backing strip across each join`);
  // where hinge columns are needed
  const n = rad.u.length, du = total / n, need: boolean[] = new Array(n).fill(o.where === 'all');
  if (o.where === 'bends') { const pad = Math.max(8, 3 * Dhi), k = Math.ceil(pad / du); rad.R.forEach((r, i) => { if (Math.abs(r) < freeR) for (let j = -k; j <= k; j++) need[((i + j) % n + n) % n] = true; }); }
  const needed = (x: number) => need[((Math.round((seam + x) / du) % n) + n) % n];
  const blocked = (x: number, D: number) => tabs.some(tx => Math.abs(x - tx) < o.tabW / 2 + Math.max(D, o.pattern.G)) || splits.some(sx => Math.abs(x - sx) < Math.max(D, 2)) ;
  const columns: Column[] = []; const endM = Math.max(o.pattern.G, 3);
  let x = endM, run = 0, Dmin = Infinity, Dmax = 0;
  while (x <= total - endM) {
    if (!needed(x)) { x += 0.5; run = 0; continue; }
    const R = needR(rad, total, seam + x, Math.max(Dhi, 2));
    let D = o.adapt ? (bestPitch(R, L, t, o.kerf, o.mat, o.sf) ?? Dlo) : o.pattern.D;
    D = Math.min(Math.max(D, o.adapt ? Dlo : 0.2), o.adapt ? Dhi : 1e9);
    if (blocked(x, D)) { x += 0.5; run = 0; continue; }
    const Rmin = minRadius(D, L, t, o.kerf, o.mat.gamma);
    columns.push({ x, D, kind: run % 2 ? 'B' : 'A', R, Rmin, state: Rmin * o.sf <= R ? 'ok' : Rmin <= R ? 'tight' : 'bad' });
    Dmin = Math.min(Dmin, D); Dmax = Math.max(Dmax, D); run++; x += D;
  }
  // tabs and joins leave short unslit stretches: on a curve these come out slightly flat (sagitta of the stretch)
  const Dn = columns.length ? columns.reduce((a, c) => a + c.D, 0) / columns.length : Dlo;
  const zones = [...tabs.map(x => ({ x, len: o.tabW + 2 * Math.max(Dn, o.pattern.G), k: 'tab' })), ...splits.map(x => ({ x, len: 2 * Math.max(Dn, 2), k: 'join' }))];
  const flats = zones.map(z => ({ ...z, sag: z.len * z.len / (8 * Math.max(1e-6, needR(rad, total, seam + z.x, z.len / 2))) })).filter(z => z.sag > 0.3);
  if (flats.length) warnings.push(`${flats.length} ${flats.every(f => f.k === 'tab') ? 'tab' : flats.every(f => f.k === 'join') ? 'join' : 'tab/join'} spot${flats.length > 1 ? 's sit' : ' sits'} on a curve and will look slightly flat (up to ${Math.max(...flats.map(f => f.sag)).toFixed(1)} mm) — try fewer or narrower tabs`);
  if (hollow) warnings.push('Part of the shape curves inwards: the strip has to be glued or clamped into that hollow');
  if (corners.length) warnings.unshift(`${corners.length} corner${corners.length > 1 ? 's are' : ' is'} too sharp to wrap — round ${corners.length > 1 ? 'them' : 'it'} first`);
  if (o.mat.warn) warnings.unshift(o.mat.note!);
  const state: WrapPlan['state'] = corners.length || columns.some(c => c.state === 'bad') ? 'bad' : columns.some(c => c.state === 'tight') ? 'tight' : 'ok';

  // ---------- parts ----------
  const parts: Part[] = [], kw = o.kerf / 2, edges = [0, ...splits, total];
  let slitCount = 0, cutLen = 0;
  const addLen = (s: Shape[]) => { for (const e of s) cutLen += lengthOf(e); };
  for (let i = 0; i < edges.length - 1; i++) {
    const x0 = edges[i], x1 = edges[i + 1], w = x1 - x0, outline: Point[] = [P(0, 0)];
    const tb = o.base === 'tabs' ? tabs.filter(tx => tx > x0 && tx < x1).sort((a, b) => a - b) : [];
    for (const tx of tb) { const a = tx - x0 - o.tabW / 2, b = tx - x0 + o.tabW / 2; outline.push(P(a, 0), P(a, -t), P(b, -t), P(b, 0)); }
    outline.push(P(w, 0), P(w, o.H));
    const tt = o.lid === 'tabs' ? tabs.filter(tx => tx > x0 && tx < x1).sort((a, b) => b - a) : [];
    for (const tx of tt) { const a = tx - x0 + o.tabW / 2, b = tx - x0 - o.tabW / 2; outline.push(P(a, o.H), P(a, o.H + t), P(b, o.H + t), P(b, o.H)); }
    outline.push(P(0, o.H));
    // 'through' joints: the shape's tabs pass through the strip — open notches at the edge, or closed slots raised off it
    const raise = Math.max(0, o.raise ?? t), holes: Shape[] = [], sw = (o.tabW + o.clearance - o.kerf) / 2, sh = (o.clearance - o.kerf) / 2;
    const notch = (pts: Point[], tx: number, edge: 'bottom' | 'top') => {
      const a = tx - x0 - (o.tabW + o.clearance) / 2, b = tx - x0 + (o.tabW + o.clearance) / 2, d = t + o.clearance;
      // walk the outline and splice the notch into the right edge
      if (edge === 'bottom') { const i = pts.findIndex((q, k) => k > 0 && q.y === 0 && q.x > a) ; pts.splice(i < 0 ? pts.length : i, 0, P(a, 0), P(a, d), P(b, d), P(b, 0)); }
      else { const i = pts.findIndex(q => q.y === o.H && q.x < b); pts.splice(i < 0 ? pts.length : i, 0, P(b, o.H), P(b, o.H - d), P(a, o.H - d), P(a, o.H)); }
    };
    for (const [j, edge] of [[o.base, 'bottom'], [o.lid, 'top']] as const) {
      if (j !== 'through') continue;
      for (const tx of tabs.filter(q => q > x0 && q < x1)) {
        if (raise < 0.01) { notch(outline, tx, edge); continue; }
        const xc = tx - x0, y0 = edge === 'bottom' ? raise : o.H - raise - t, y1 = y0 + t;
        holes.push(polyS([P(xc - sw, y0 - sh), P(xc + sw, y0 - sh), P(xc + sw, y1 + sh), P(xc - sw, y1 + sh)]));
      }
    }
    const grown = growPoly(outline, kw), slits: Shape[] = [], slitState: Column['state'][] = [];
    for (const h of holes) cutLen += lengthOf(h);
    for (const c of columns) if (c.x > x0 && c.x < x1) for (const [y0, y1] of columnCuts(o.H, o.pattern, c.kind)) { slits.push(seg(P(c.x - x0, y0), P(c.x - x0, y1))); slitState.push(c.state); }
    slitCount += slits.length; addLen(slits);
    for (let j = 0; j < grown.length; j++) cutLen += dist(grown[j], grown[(j + 1) % grown.length]);
    parts.push({ name: edges.length > 2 ? `Strip ${i + 1} of ${edges.length - 1}` : 'Strip', cut: [polyS(grown), ...holes], slits, slitState });
  }
  // base / lid plates
  const plate = (kind: Joint, name: string): Part | null => {
    if (kind === 'none') return null;
    const cut: Shape[] = [], mark: Shape[] = [];
    if (kind === 'plain') { const s = offsetOutline(shapes, kw); if (s) cut.push(s); }
    else if (kind === 'through') {
      // the shape itself, with tabs reaching out through the strip (flush with its outside face)
      const s = offsetOutline(shapes, kw), tabsP: Shape[] = [];
      for (const tx of tabs) {
        const w2 = (o.tabW + o.kerf) / 2, A = at(mid, seam + tx - w2), B = at(mid, seam + tx + w2), NA = P(A.t.y, -A.t.x), NB = P(B.t.y, -B.t.x);   // outward normals (the curve runs anticlockwise)
        tabsP.push(polyS([add(A.p, mul(NA, -t / 2 - 2)), add(B.p, mul(NB, -t / 2 - 2)), add(B.p, mul(NB, t / 2 + kw)), add(A.p, mul(NA, t / 2 + kw))]));
      }
      if (s) { const u = tabsP.length ? booleanShapes('union', [s, ...tabsP]) : { shapes: [s] }; cut.push(...('error' in u ? [s, ...tabsP] : u.shapes)); }
    } else {
      const big = offsetOutline(shapes, t + o.lip + kw); if (big) cut.push(big);
      if (kind === 'tabs') for (const tx of tabs) {
        const { p, t: T } = at(mid, seam + tx), N = P(-T.y, T.x), R = flatAt(tx), sag = isFinite(R) ? o.tabW * o.tabW / (8 * R) : 0;
        const a = (o.tabW + o.clearance - o.kerf) / 2, b = (t + o.clearance + sag - o.kerf) / 2;
        cut.push(polyS([add(add(p, mul(T, -a)), mul(N, -b)), add(add(p, mul(T, a)), mul(N, -b)), add(add(p, mul(T, a)), mul(N, b)), add(add(p, mul(T, -a)), mul(N, b))]));
      }
      // engraved guide: where the strip's inside face sits, and where the strip starts
      const g = offsetOutline(shapes, 0); if (g) mark.push(g);
    }
    const s0 = at(mid, seam), N0 = P(s0.t.y, -s0.t.x);   // outward
    // start mark: across the strip's place on the plate (on a plain plate, just inside its edge)
    mark.push(kind === 'plain' || kind === 'through' ? seg(add(s0.p, mul(N0, -t / 2 - 5)), add(s0.p, mul(N0, -t / 2 - 0.5))) : seg(add(s0.p, mul(N0, -t / 2)), add(s0.p, mul(N0, t / 2 + Math.max(o.lip, 2) * 0.8))));
    for (const e of cut) cutLen += lengthOf(e);
    return { name, cut, mark };
  };
  const pb = plate(o.base, o.base === 'tabs' ? 'Base (with slots)' : o.base === 'through' ? 'Base (with tabs)' : 'Base'); if (pb) parts.push(pb);
  if (o.base === 'shelf') { const s = offsetOutline(shapes, kw); if (s) { parts.push({ name: 'Shelf (glue on the base)', cut: [s] }); cutLen += lengthOf(s); } }
  const pl = plate(o.lid, o.lid === 'through' ? 'Lid (with tabs)' : 'Lid'); if (pl) parts.push(pl);
  if (o.lid === 'shelf') { const s = offsetOutline(shapes, kw); if (s) { parts.push({ name: 'Lid shelf (glue under the lid)', cut: [s] }); cutLen += lengthOf(s); } }
  return { total, tightest, hollow, seam, corners, columns, tabs, splits, slitCount, cutLen, parts, warnings, state, Drange: columns.length ? [Dmin, Dmax] : [0, 0] };
}

/** Rough laser time (s): cutting at `speed` mm/s plus ~0.15 s for each separate cut, all × passes. */
export const laserTime = (cutLen: number, paths: number, speed: number, passes: number) => (cutLen / Math.max(0.1, speed) + paths * 0.15) * Math.max(1, passes);

// ---------------- hinge inside a shape ----------------
/** Slits filling a closed shape, keeping G clear of its edge. angle = slit direction (0 = vertical slits, bends left–right). */
export function fillHinge(shapes: Shape[], p: Pattern, L: number, vertical: boolean): Shape[] {
  const src = makeSource(shapes); if (!src.solid.length || L <= 0) return [];
  const inset = offsetPaths(src.solid, [], -p.G, true); if (!inset.length) return [];
  const rot = (q: Point) => vertical ? q : P(-q.y, q.x), unrot = (q: Point) => vertical ? q : P(q.y, -q.x);
  const polys = inset.map(pl => pl.map(rot));
  const xs = polys.flat().map(q => q.x), ys = polys.flat().map(q => q.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), Pd = L + p.G, out: Shape[] = [];
  let k = 0;
  for (let x = x0 + p.D / 2; x < x1; x += p.D, k++) {
    // inside intervals of the inset region along this vertical line (even–odd)
    const hits: number[] = [];
    for (const pl of polys) for (let i = 0; i < pl.length; i++) { const a = pl[i], b = pl[(i + 1) % pl.length]; if ((a.x <= x) !== (b.x <= x)) hits.push(a.y + (x - a.x) / (b.x - a.x) * (b.y - a.y)); }
    hits.sort((a, b) => a - b);
    const off = k % 2 ? Pd / 2 : 0;
    for (let i = 0; i + 1 < hits.length; i += 2) {
      const ia = hits[i], ib = hits[i + 1];
      for (let c = y0 - Pd + off; c < y1 + Pd; c += Pd) {
        const a = Math.max(ia, c), b = Math.min(ib, c + L);
        if (b - a >= Math.max(2 * p.G, 1)) out.push(seg(unrot(P(x, a)), unrot(P(x, b))));
      }
    }
  }
  return out;
}

// ---------------- test strips ----------------
/** A few strips at different pitches to calibrate a material; strip i has i+1 small marker holes. */
export function testStrips(t: number, kerf: number, mat: HMat, H = 30, len = 90): { D: number; part: Part }[] {
  const G = Math.round(Math.max(1.5, 1.2 * t) * 10) / 10, { lo, hi } = pitchRange(t, kerf, mat), Ds = [lo, lo + (hi - lo) / 3, lo + 2 * (hi - lo) / 3, hi].map(d => Math.round(d * 10) / 10);
  const p: Pattern = { D: 0, m: 1, G, open: true };
  return Ds.map((D, i) => {
    const slits: Shape[] = []; let k = 0;
    for (let x = 18; x <= len - 8; x += D, k++) for (const [a, b] of columnCuts(H, { ...p, D }, k % 2 ? 'B' : 'A')) slits.push(seg(P(x, a), P(x, b)));
    const holes: Shape[] = Array.from({ length: i + 1 }, (_, j) => ({ type: 'circle', c: P(5 + (j % 2) * 5, 7 + Math.floor(j / 2) * 8), r: 1.2 - kerf / 2 }) as Shape);
    return { D, part: { name: `Test ${i + 1}: spacing ${D} mm`, cut: [polyS(growPoly([P(0, 0), P(len, 0), P(len, H), P(0, H)], kerf / 2)), ...holes], slits } };
  });
}
