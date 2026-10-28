/**
 * Paths with true arc segments. A polyline segment i (from pts[i] to pts[i+1])
 * may carry a "bulge" = tan(sweep / 4): 0 = straight, > 0 = anticlockwise arc,
 * < 0 = clockwise arc (the same convention as DXF). This keeps fillets, joined
 * shapes and rounded outlines exact instead of turning them into many lines.
 */
import { type Point, P, add, sub, mul, dist, len, normA, angOf, polar, clean, cp } from './vec';

export interface PathLike { pts: Point[]; closed: boolean; bulge?: number[] }

export type PSeg =
  | { kind: 'seg'; a: Point; b: Point; len: number }
  | { kind: 'arc'; a: Point; b: Point; len: number; c: Point; r: number; start: number; sweep: number };

export const hasBulge = (p: PathLike) => !!p.bulge && p.bulge.some(b => Math.abs(b) > 1e-12);
export const segCount = (p: PathLike) => p.closed ? p.pts.length : p.pts.length - 1;
export const bulgeAt = (p: PathLike, i: number) => p.bulge?.[i] ?? 0;

/** Geometry of a bulged segment from a to b. */
export function bulgeArc(a: Point, b: Point, bulge: number) {
  const sweep = 4 * Math.atan(bulge), d = sub(b, a), c0 = len(d);
  const r = c0 / (2 * Math.abs(Math.sin(sweep / 2)));
  const f = (1 - bulge * bulge) / (4 * bulge);
  const c = add(mul(add(a, b), .5), mul(P(-d.y, d.x), f));
  return { c, r, start: angOf(c, a), sweep };
}

export function segsOf(p: PathLike): PSeg[] {
  const n = segCount(p), out: PSeg[] = [];
  for (let i = 0; i < n; i++) {
    const a = p.pts[i], b = p.pts[(i + 1) % p.pts.length], bu = bulgeAt(p, i);
    if (Math.abs(bu) < 1e-12) out.push({ kind: 'seg', a, b, len: dist(a, b) });
    else { const g = bulgeArc(a, b, bu); out.push({ kind: 'arc', a, b, len: g.r * Math.abs(g.sweep), ...g }); }
  }
  return out;
}

/** Point at parameter t ∈ [0,1] along a segment. */
export function segPoint(s: PSeg, t: number): Point {
  if (s.kind === 'seg') return add(s.a, mul(sub(s.b, s.a), t));
  return polar(s.c, s.r, s.start + s.sweep * t);
}
/** Parameter of a point lying on the segment. */
export function segParam(s: PSeg, p: Point): number {
  if (s.kind === 'seg') { const d = sub(s.b, s.a), L = d.x * d.x + d.y * d.y; return L ? ((p.x - s.a.x) * d.x + (p.y - s.a.y) * d.y) / L : 0; }
  const a = angOf(s.c, p), diff = s.sweep > 0 ? normA(a - s.start) : normA(s.start - a);
  return diff / Math.abs(s.sweep);
}
/** Unit tangent direction (travel direction) at parameter t. */
export function segTangent(s: PSeg, t: number): Point {
  if (s.kind === 'seg') { const d = sub(s.b, s.a), L = len(d) || 1; return mul(d, 1 / L); }
  const a = s.start + s.sweep * t, sg = s.sweep > 0 ? 1 : -1;
  return P(-Math.sin(a) * sg, Math.cos(a) * sg);
}
/** Bulge of the piece of a segment between t0 and t1. */
export const pieceBulge = (s: PSeg, t0: number, t1: number) => s.kind === 'seg' ? 0 : Math.tan(s.sweep * (t1 - t0) / 4);

/** Exact primitive (for intersection maths) of a segment. */
export function segPrim(s: PSeg): { t: 'seg'; a: Point; b: Point } | { t: 'arc'; c: Point; r: number; a0: number; a1: number } {
  if (s.kind === 'seg') return { t: 'seg', a: s.a, b: s.b };
  const end = s.start + s.sweep;
  return s.sweep > 0 ? { t: 'arc', c: s.c, r: s.r, a0: normA(s.start), a1: normA(end) } : { t: 'arc', c: s.c, r: s.r, a0: normA(end), a1: normA(s.start) };
}

/** Flatten a path (expanding arc segments within tolerance). */
export function flattenPath(p: PathLike, tol: number): Point[] {
  if (!hasBulge(p)) return p.pts;
  const out: Point[] = [];
  for (const s of segsOf(p)) {
    out.push(s.a);
    if (s.kind === 'arc') { const st = 2 * Math.acos(Math.max(-1, 1 - tol / s.r)), n = Math.max(2, Math.ceil(Math.abs(s.sweep) / st)); for (let k = 1; k < n; k++) out.push(segPoint(s, k / n)); }
  }
  if (!p.closed) out.push(p.pts[p.pts.length - 1]);
  return out;
}

/**
 * Cut out the part of a path between arc-length positions s0 and s1
 * (s1 may exceed the total length on a closed path, wrapping round).
 * Returns points + bulges of the piece.
 */
export function subPath(p: PathLike, s0: number, s1: number, exact?: (s: number) => Point | undefined): { pts: Point[]; bulge: number[] } {
  const segs = segsOf(p), total = segs.reduce((a, s) => a + s.len, 0);
  const pts: Point[] = [], bulge: number[] = [];
  const at = (s: number) => exact?.(s) ?? null;
  let base = 0;
  for (let lap = 0; lap < (p.closed ? 2 : 1); lap++) {
    for (const s of segs) {
      const a0 = base, a1 = base + s.len; base = a1;
      const lo = Math.max(s0, a0), hi = Math.min(s1, a1);
      if (hi - lo <= 1e-9 || s.len < 1e-12) continue;
      const t0 = (lo - a0) / s.len, t1 = (hi - a0) / s.len;
      if (!pts.length) pts.push(at(lo % (total || 1)) || cp(segPoint(s, t0)));
      pts.push(at(hi % (total || 1)) || (t1 >= 1 - 1e-12 ? s.b : cp(segPoint(s, t1))));
      bulge.push(pieceBulge(s, t0, t1));
    }
  }
  return { pts, bulge };
}

/** Total length of a path. */
export const pathLength = (p: PathLike) => segsOf(p).reduce((a, s) => a + s.len, 0);

/** Reverse a path's direction (bulges change sign and order). */
export function reversePath(pts: Point[], bulge: number[]): { pts: Point[]; bulge: number[] } {
  return { pts: pts.slice().reverse(), bulge: bulge.slice().reverse().map(b => -b) };
}

/** Bulge for an arc entity running anticlockwise from a0 to a1. */
export const arcBulge = (a0: number, a1: number) => Math.tan(normA(a1 - a0) / 4);
export { clean, polar, dist };

export interface Piece { pts: Point[]; bulge: number[] }
/** Result of joining: paths, how many small gaps were closed, and the largest one. */
export interface JoinReport { gapsClosed: number; maxGap: number }
/**
 * Join open pieces that meet end-to-end into continuous paths (bulges follow direction).
 * Ends closer than `tol` count as touching — the gap is closed by moving the
 * joining end onto its neighbour. At each step the nearest available end is used.
 */
export function joinPieces(pieces: Piece[], tol = 1e-6, report?: JoinReport): (Piece & { closed: boolean })[] {
  const rem = pieces.map(p => ({ pts: p.pts.slice(), bulge: p.bulge.slice() })), out: (Piece & { closed: boolean })[] = [];
  const rev = (p: Piece) => reversePath(p.pts, p.bulge);
  const note = (d: number) => { if (report && d > 1e-6) { report.gapsClosed++; report.maxGap = Math.max(report.maxGap, d); } };
  while (rem.length) {
    let ch = rem.shift()!, grown = true;
    while (grown) {
      grown = false;
      const s = ch.pts[0], e = ch.pts[ch.pts.length - 1];
      let best: { i: number; d: number; next: Piece; prepend: boolean } | null = null;
      const consider = (i: number, d: number, next: () => Piece, prepend: boolean) => { if (d < tol && (!best || d < best.d)) best = { i, d, next: next(), prepend }; };
      rem.forEach((q, i) => {
        const qs = q.pts[0], qe = q.pts[q.pts.length - 1];
        consider(i, dist(e, qs), () => q, false); consider(i, dist(e, qe), () => rev(q), false);
        consider(i, dist(s, qe), () => q, true); consider(i, dist(s, qs), () => rev(q), true);
      });
      if (!best) break;
      const b = best as { i: number; d: number; next: Piece; prepend: boolean };
      note(b.d);
      ch = b.prepend ? { pts: b.next.pts.slice(0, -1).concat(ch.pts), bulge: b.next.bulge.concat(ch.bulge) } : { pts: ch.pts.concat(b.next.pts.slice(1)), bulge: ch.bulge.concat(b.next.bulge) };
      rem.splice(b.i, 1); grown = true;
    }
    const gap = dist(ch.pts[0], ch.pts[ch.pts.length - 1]);
    const closed = ch.pts.length > 2 && gap < tol;
    if (closed) { note(gap); ch.pts.pop(); }
    out.push({ ...ch, closed });
  }
  return out;
}
