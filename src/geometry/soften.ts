/**
 * Soften: rounds every corner of a shape to (about) radius r, keeping straight
 * sides straight and the size of the shape the same — the vector way (no
 * re-tracing, so nothing is lost to pixels).
 *
 * Closed outlines use morphological rounding on the true outline (Clipper):
 *  • outside (convex) corners: shrink by r, grow back by r ("opening");
 *  • inside (concave) corners: grow by r, shrink back by r ("closing");
 * then the result is rebuilt as a few smooth Bézier curves (fitcurve).
 * Open lines are smoothed along their length (ends stay put) and refitted.
 */
import ClipperLib from 'clipper-lib';
import { type Point, P, dist } from './vec';
import { flatten } from './entity';
import { fitPoints, fitRun } from './fitcurve';
import { add, sub, mul, len } from './vec';
import type { Shape } from '../model/types';

const L = ClipperLib, S = 10000;   // 0.1 µm
type IP = { X: number; Y: number }[];
const toI = (pts: Point[]): IP => pts.map(p => ({ X: Math.round(p.x * S), Y: Math.round(p.y * S) }));
const fromI = (q: IP): Point[] => q.map(v => P(v.X / S, v.Y / S));
const areaI = (q: IP) => Math.abs(L.Clipper.Area(q)) / (S * S);
function off(paths: IP[], d: number): IP[] {
  if (!paths.length) return [];
  const co = new L.ClipperOffset(2, 0.005 * S), out = new L.Paths();
  co.AddPaths(paths, L.JoinType.jtRound, L.EndType.etClosedPolygon); co.Execute(out, d * S); return out as IP[];
}

/** Is any changed piece bigger than rounding a corner would change? (area over 3r², or longer than 4.5r) */
function bigChange(pieces0: IP[], r: number): boolean {
  // break the hair-thin slivers along the edges that join the corner pieces up
  const pieces = off(off(pieces0, -0.08 * r), 0.08 * r);
  return pieces.some(q => { const A = areaI(q); if (A < 0.3 * r * r) return false; if (A > 3 * r * r) return true; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const v of q) { x0 = Math.min(x0, v.X); x1 = Math.max(x1, v.X); y0 = Math.min(y0, v.Y); y1 = Math.max(y1, v.Y); } return Math.hypot(x1 - x0, y1 - y0) / S > 4.5 * r; });
}
export type SoftenMode = 'both' | 'outer' | 'inner';
export interface SoftenResult { shape: Shape | null; note?: 'unchanged' | 'lost' | 'split' }
/** Can this shape be softened? (Circles and ellipses are already soft; text, dimensions and single lines are left alone.) */
export const softenable = (s: { type: string; pts?: Point[] }) => (s.type === 'poly' || s.type === 'spline') && (s.pts?.length ?? 0) > 2 || s.type === 'arc';

/** One corner that softening changes: where it is (the old tip), and the piece of outline it takes off or adds. */
export interface SoftCorner { tip: Point; kind: 'out' | 'in'; c: Point; R: number; /** more than corner rounding: a thin part would go (or a narrow gap fill) */ big: boolean }
export interface SoftPlan { closed: boolean; orig: IP; main: IP | null; removed: IP[]; added: IP[]; corners: SoftCorner[]; lost: boolean; tol: number; open?: Shape | null; r: number }
/** Work out what softening would change, corner by corner (nothing is changed yet). */
export function planSoften(s: Shape, r: number, mode: SoftenMode = 'both'): SoftPlan | null {
  if (!softenable(s) || r <= 0) return null;
  const f = flatten(s, 0.005), tol = Math.min(0.04, Math.max(0.02, r / 25));
  if (!f.closed) { const o = softenOpen(f.pts, r, tol); return { closed: false, orig: [], main: null, removed: [], added: [], corners: [], lost: false, tol, open: o.shape, r }; }
  const ip = toI(f.pts); if (!L.Clipper.Orientation(ip)) ip.reverse();
  const a0 = areaI(ip);
  let res: IP[] = [ip];
  if (mode !== 'inner') res = off(off(res, -r), r);   // round the outside corners
  if (mode !== 'outer') res = off(off(res, r), -r);   // round the inside corners
  res = res.filter(q => q.length > 2 && L.Clipper.Orientation(q));
  if (!res.length) return { closed: true, orig: ip, main: null, removed: [], added: [], corners: [], lost: true, tol, r };
  res.sort((p, q) => areaI(q) - areaI(p));
  const main = res[0], mp = fromI(main), removed = diff([ip], [main]), added = diff([main], [ip]);
  // a part was lost (a thin stalk or ear shaved off, or a narrow gap filled in) if what changed is more than corner rounding
  const lost = res.length > 1 || areaI(main) < a0 * 0.5 || bigChange(removed, r) || bigChange(added, r);
  // the corners: the pieces that change, with the hair-thin slivers along the edges broken off
  const corners: SoftCorner[] = [], origPts = fromI(ip);
  const nearMain = (p: Point) => { let best = Infinity; for (let i = 0; i < mp.length; i++) { const a = mp[i], b = mp[(i + 1) % mp.length], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1e-12, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)); best = Math.min(best, Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y)); } return best; };
  for (const [kind, set] of [['out', removed], ['in', added]] as ['out' | 'in', IP[]][]) {
    for (const q of off(off(set, -0.04 * r), 0.04 * r)) {
      if (areaI(q) < 0.01 * r * r) continue;
      const pts = fromI(q); let cx = 0, cy = 0, ext = 0;
      for (const p of pts) { cx += p.x; cy += p.y; } const c = P(cx / pts.length, cy / pts.length);
      for (const p of pts) ext = Math.max(ext, dist(p, c));
      // the corner's real tip: the point of the old outline near this piece that is furthest from the new one
      let tip = c, far = -1; const reach = ext * 2 + r;
      for (const p of origPts) { if (dist(p, c) > reach) continue; const d = nearMain(p); if (d > far) { far = d; tip = p; } }
      let R = Math.max(ext, dist(tip, c));
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
      corners.push({ tip, kind, c, R: R * 1.25 + 0.1 * r + 0.05, big: areaI(q) > 3 * r * r || Math.hypot(x1 - x0, y1 - y0) > 4.5 * r });
    }
  }
  return { closed: true, orig: ip, main, removed, added, corners, lost, tol, r };
}
/** The softened outline with only the chosen corners rounded (all if `on` is missing). */
export function applyPlan(plan: SoftPlan, on?: boolean[]): Shape | null {
  if (!plan.closed) return plan.open ?? null;
  if (!plan.main) return null;
  let out: IP[];
  if (!on || on.every(Boolean)) out = [plan.main];
  else {
    const disc = (c: Point, R: number): IP => toI(Array.from({ length: 48 }, (_, i) => P(c.x + R * Math.cos(i * Math.PI / 24), c.y + R * Math.sin(i * Math.PI / 24))));
    const cut = plan.corners.filter((k, i) => on[i] && k.kind === 'out').map(k => disc(k.c, k.R)), fill = plan.corners.filter((k, i) => on[i] && k.kind === 'in').map(k => disc(k.c, k.R));
    out = [plan.orig];
    // grown a hair so no zero-width sliver of the old tip is left along the shared edges
    if (cut.length) out = diff(out, off(inter(plan.removed, cut), 0.01));
    if (fill.length) out = union([...out, ...off(inter(plan.added, fill), 0.01)]);
    out = out.filter(q => q.length > 2 && L.Clipper.Orientation(q)).sort((p, q) => areaI(q) - areaI(p)).slice(0, 1);
    if (!out.length) return null;
  }
  const fit = fitClean(fromI(out[0]), plan.tol);
  return { type: 'spline', pts: fit.pts, h: fit.h, closed: true } as Shape;
}
export function softenShape(s: Shape, r: number, mode: SoftenMode = 'both'): SoftenResult {
  const plan = planSoften(s, r, mode);
  if (!plan) return { shape: null, note: 'unchanged' };
  if (plan.closed && !plan.main) return { shape: null, note: 'lost' };
  return { shape: applyPlan(plan), note: plan.lost ? 'split' : undefined };
}
function diff(a: IP[], b: IP[]): IP[] { const c = new L.Clipper(), out = new L.Paths(); c.AddPaths(a, L.PolyType.ptSubject, true); c.AddPaths(b, L.PolyType.ptClip, true); c.Execute(L.ClipType.ctDifference, out, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero); return out as IP[]; }
function inter(a: IP[], b: IP[]): IP[] { if (!a.length || !b.length) return []; const c = new L.Clipper(), out = new L.Paths(); c.AddPaths(a, L.PolyType.ptSubject, true); c.AddPaths(b, L.PolyType.ptClip, true); c.Execute(L.ClipType.ctIntersection, out, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero); return out as IP[]; }
function union(a: IP[]): IP[] { const c = new L.Clipper(), out = new L.Paths(); c.AddPaths(a, L.PolyType.ptSubject, true); c.Execute(L.ClipType.ctUnion, out, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero); return out as IP[]; }

/** Open line: slide every point towards the average of the line within ±r of it (ends fixed), then refit. */
function softenOpen(pts: Point[], r: number, tol: number): SoftenResult {
  const step = Math.max(0.05, Math.min(0.25, r / 8)), d: Point[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], l = dist(a, b), n = Math.ceil(l / step);
    for (let k = 1; k <= n; k++) d.push(P(a.x + (b.x - a.x) * k / n, a.y + (b.y - a.y) * k / n));
  }
  if (d.length < 5) return { shape: null, note: 'unchanged' };
  const k = Math.max(1, Math.round(r / step)), n = d.length;
  let cur = d;
  for (let pass = 0; pass < 3; pass++) {
    const pre = [P(0, 0)]; for (const q of cur) pre.push(P(pre[pre.length - 1].x + q.x, pre[pre.length - 1].y + q.y));
    cur = cur.map((q, i) => { const w = Math.min(k, i, n - 1 - i); if (w < 1) return q; const a = pre[i - w], b = pre[i + w + 1]; return P((b.x - a.x) / (2 * w + 1), (b.y - a.y) / (2 * w + 1)); });
  }
  const fit = fitPoints(cur, false, tol, 170);
  return { shape: { type: 'spline', pts: fit.pts, h: fit.h, closed: false } as Shape };
}

/**
 * Rebuild a softened outline cleanly: its straight parts (runs of points in a
 * line, 2 mm or longer) stay exactly straight, and each rounded part between
 * them becomes one or two Béziers that leave and join the straight parts smoothly.
 */
function fitClean(pts: Point[], tol: number): { pts: Point[]; h: [Point, Point][] } {
  const n = pts.length, dir = (i: number) => sub(pts[(i + 1) % n], pts[i]);
  const ang = (a: Point, b: Point) => Math.abs(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y));
  // straight runs: consecutive edges in (nearly) the same direction
  const runs: { a: number; b: number }[] = []; let i = 0;
  while (i < n) {
    let j = i, L0 = len(dir(i)); const d0 = dir(i);
    while (j + 1 < n && ang(d0, dir(j + 1)) < 0.004) { j++; L0 += len(dir(j)); }
    if (L0 >= 2) runs.push({ a: i, b: (j + 1) % n });
    i = j + 1;
  }
  if (!runs.length) { const f = fitPoints(pts, true, tol, 60); return { pts: f.pts, h: f.h }; }
  const segs: [Point, Point, Point, Point][] = [];
  runs.forEach((r, k) => {
    const A = pts[r.a], B = pts[r.b], t = sub(B, A);
    segs.push([A, add(A, mul(t, 1 / 3)), sub(B, mul(t, 1 / 3)), B]);
    const nx = runs[(k + 1) % runs.length];
    if (nx.a === r.b) return;                                  // two straight sides meet at a corner
    const sec: Point[] = []; for (let q = r.b; ; q = (q + 1) % n) { sec.push(pts[q]); if (q === nx.a) break; }
    // denser points for the fitting
    const dense: Point[] = [sec[0]]; for (let q = 1; q < sec.length; q++) { const a = sec[q - 1], b = sec[q], m = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.1)); for (let k2 = 1; k2 <= m; k2++) dense.push(P(a.x + (b.x - a.x) * k2 / m, a.y + (b.y - a.y) * k2 / m)); }
    segs.push(...fitRun(dense, t, mul(sub(pts[(nx.a + 1) % n], pts[nx.a]), -1), tol));
  });
  const out: Point[] = [], h: [Point, Point][] = [];
  segs.forEach((sg, k) => { if (k === 0) { out.push(sg[0]); h.push([sg[0], sg[1]]); } else h[h.length - 1][1] = sg[1]; out.push(sg[3]); h.push([sg[2], sg[3]]); });
  const last = h.pop()!; out.pop(); h[0][0] = last[0];
  return { pts: out, h };
}
