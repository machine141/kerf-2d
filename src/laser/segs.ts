/**
 * A laser path as a list of exact segments: straight lines, circular/elliptical arcs and
 * cubic curves. Paths can be reversed and (when closed) started at any vertex, which the
 * cut-order engine uses; the SVG writer turns them back into exact path data.
 */
import { type Point, P, add, sub, mul, dist, normA, polar, clean, fmt, TAU } from '../geometry/vec';
import { ellPt } from '../geometry/entity';
import { segsOf } from '../geometry/path';
import { splineSegs } from '../geometry/spline';
import type { Shape } from '../model/types';

export type Seg =
  | { k: 'L'; a: Point; b: Point }
  /** arc of an ellipse (a circle when rx = ry): param angle t0, swept by `sweep` (+ = anticlockwise) */
  | { k: 'A'; a: Point; b: Point; c: Point; rx: number; ry: number; rot: number; t0: number; sweep: number }
  | { k: 'C'; a: Point; c1: Point; c2: Point; b: Point };

/** A whole loop of a circle or ellipse (so its start can be put anywhere on it). */
export interface Loop { c: Point; rx: number; ry: number; rot: number }

export const ellAt = (l: Loop, t: number) => ellPt({ c: l.c, rx: l.rx, ry: l.ry, rot: l.rot }, t);

/** Arc segment(s), split so none sweeps more than half a turn. */
export function arcSegs(l: Loop, t0: number, sweep: number): Seg[] {
  const n = Math.abs(sweep) > Math.PI + 1e-9 ? 2 : 1, out: Seg[] = [];
  for (let i = 0; i < n; i++) { const s = t0 + sweep * i / n, sw = sweep / n; out.push({ k: 'A', a: ellAt(l, s), b: ellAt(l, s + sw), c: l.c, rx: l.rx, ry: l.ry, rot: l.rot, t0: s, sweep: sw }); }
  return out;
}
/** A full loop starting at parameter t (two halves, anticlockwise). */
export const loopSegs = (l: Loop, t = 0): Seg[] => arcSegs(l, t, TAU);

export function reverseSeg(s: Seg): Seg {
  if (s.k === 'L') return { k: 'L', a: s.b, b: s.a };
  if (s.k === 'C') return { k: 'C', a: s.b, c1: s.c2, c2: s.c1, b: s.a };
  return { ...s, a: s.b, b: s.a, t0: s.t0 + s.sweep, sweep: -s.sweep };
}
export const reverseSegs = (ss: Seg[]) => ss.slice().reverse().map(reverseSeg);

/** Exact segments of a drawing shape, in its own direction; null for things that aren't cut. */
export function shapeSegs(e: Shape): { segs: Seg[]; closed: boolean; loop?: Loop } | null {
  switch (e.type) {
    case 'line': return dist(e.a, e.b) < 1e-9 ? null : { segs: [{ k: 'L', a: e.a, b: e.b }], closed: false };
    case 'circle': { const l = { c: e.c, rx: e.r, ry: e.r, rot: 0 }; return { segs: loopSegs(l), closed: true, loop: l }; }
    case 'ellipse': { const l = { c: e.c, rx: e.rx, ry: e.ry, rot: e.rot }; return { segs: loopSegs(l), closed: true, loop: l }; }
    case 'arc': { const l = { c: e.c, rx: e.r, ry: e.r, rot: 0 }; return { segs: arcSegs(l, e.a0, normA(e.a1 - e.a0) || TAU), closed: false }; }
    case 'poly': {
      if (e.pts.length < 2) return null;
      const segs: Seg[] = [];
      for (const s of segsOf(e)) {
        if (s.kind === 'seg') { if (s.len > 1e-12) segs.push({ k: 'L', a: s.a, b: s.b }); }
        else segs.push(...arcSegs({ c: s.c, rx: s.r, ry: s.r, rot: 0 }, s.start, s.sweep));
      }
      return segs.length ? { segs, closed: !!e.closed } : null;
    }
    case 'spline': {
      const bs = splineSegs(e); if (!bs.length) return null;
      return { segs: bs.map(b => ({ k: 'C', a: b[0], c1: b[1], c2: b[2], b: b[3] }) as Seg), closed: !!e.closed };
    }
    default: return null;
  }
}

/** Points along a segment list (chords within about tol mm), first point included. */
export function sampleSegs(ss: Seg[], tol = 0.02): Point[] {
  if (!ss.length) return [];
  const out: Point[] = [ss[0].a];
  for (const s of ss) {
    if (s.k === 'L') { out.push(s.b); continue; }
    if (s.k === 'A') {
      const r = Math.max(s.rx, s.ry), step = r > tol ? 2 * Math.acos(Math.max(-1, 1 - tol / r)) : Math.PI, n = Math.max(1, Math.ceil(Math.abs(s.sweep) / step));
      const l = { c: s.c, rx: s.rx, ry: s.ry, rot: s.rot };
      for (let i = 1; i <= n; i++) out.push(i === n ? s.b : ellAt(l, s.t0 + s.sweep * i / n));
      continue;
    }
    const L = dist(s.a, s.c1) + dist(s.c1, s.c2) + dist(s.c2, s.b), n = Math.max(4, Math.ceil(Math.sqrt(L / tol)));
    for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t; out.push(i === n ? s.b : P(u * u * u * s.a.x + 3 * u * u * t * s.c1.x + 3 * u * t * t * s.c2.x + t * t * t * s.b.x, u * u * u * s.a.y + 3 * u * u * t * s.c1.y + 3 * u * t * t * s.c2.y + t * t * t * s.b.y)); }
  }
  return out;
}

/** Direction of travel at the start (t = 0) or end (t = 1) of a segment. */
export function segDir(s: Seg, end: boolean): Point {
  let d: Point;
  if (s.k === 'L') d = sub(s.b, s.a);
  else if (s.k === 'C') { d = end ? sub(s.b, s.c2) : sub(s.c1, s.a); if (Math.hypot(d.x, d.y) < 1e-12) d = sub(s.b, s.a); }
  else {
    const t = s.t0 + (end ? s.sweep : 0), sg = Math.sign(s.sweep) || 1, cr = Math.cos(s.rot), sr = Math.sin(s.rot);
    const dx = -s.rx * Math.sin(t) * sg, dy = s.ry * Math.cos(t) * sg; d = P(dx * cr - dy * sr, dx * sr + dy * cr);
  }
  const L = Math.hypot(d.x, d.y) || 1; return mul(d, 1 / L);
}
/** Turning angle (radians, 0 = smooth) where segment a ends and b begins. */
export function turnAt(a: Seg, b: Seg): number {
  const u = segDir(a, true), v = segDir(b, false);
  return Math.acos(Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y)));
}

const nf = (v: number) => fmt(clean(v), 6);
/** SVG path data for one subpath. Y is flipped (SVG y runs down): Y(y) = h − y. */
export function segsD(ss: Seg[], closed: boolean, h: number): string {
  if (!ss.length) return '';
  const Y = (y: number) => nf(h - y), out = [`M ${nf(ss[0].a.x)} ${Y(ss[0].a.y)}`];
  for (const s of ss) {
    if (s.k === 'L') out.push(`L ${nf(s.b.x)} ${Y(s.b.y)}`);
    else if (s.k === 'C') out.push(`C ${nf(s.c1.x)} ${Y(s.c1.y)} ${nf(s.c2.x)} ${Y(s.c2.y)} ${nf(s.b.x)} ${Y(s.b.y)}`);
    // anticlockwise in drawing coordinates is clockwise once y is flipped → sweep-flag 0
    else out.push(`A ${nf(s.rx)} ${nf(s.ry)} ${nf(-s.rot * 180 / Math.PI)} ${Math.abs(s.sweep) > Math.PI ? 1 : 0} ${s.sweep > 0 ? 0 : 1} ${nf(s.b.x)} ${Y(s.b.y)}`);
  }
  return out.join(' ') + (closed ? ' Z' : '');
}

/** Nearest point of a loop to p: its parameter (searched, then refined). */
export function nearestOnLoop(l: Loop, p: Point): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < 72; i++) { const t = i * TAU / 72, d = dist(ellAt(l, t), p); if (d < bd) { bd = d; best = t; } }
  for (let step = TAU / 144; step > 1e-7; step /= 2) for (const t of [best - step, best + step]) { const d = dist(ellAt(l, t), p); if (d < bd) { bd = d; best = t; } }
  return normA(best);
}

export { add, polar };
