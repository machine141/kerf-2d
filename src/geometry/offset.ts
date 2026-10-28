/**
 * Contour / offset engine built on Clipper (Angus Johnson, Boost licence).
 * Closed shapes are unioned into a solid region and offset; open lines are
 * offset as bands with round or square ends. Results are closed polylines
 * whose vertices lie on the true offset curve (within ARC_TOL).
 */
import ClipperLib from 'clipper-lib';
import { type Point, P, add, sub, mul, dist, len, cross, polar, clean, cp } from './vec';
import { flatten, endsOf, ext, type Prim } from './entity';
import type { Shape } from '../model/types';

export const offsetSettings = { arcTol: 0.0005, scale: 1e5 };
const L = ClipperLib;
type IntPath = { X: number; Y: number }[];
const toInt = (pts: Point[]): IntPath => pts.map(p => ({ X: Math.round(p.x * offsetSettings.scale), Y: Math.round(p.y * offsetSettings.scale) }));
const fromInt = (path: IntPath): Point[] => path.map(q => P(clean(q.X / offsetSettings.scale), clean(q.Y / offsetSettings.scale)));

/** Join open point lists that touch end-to-end into chains; closed chains are reported as such. */
export function chainPieces(pieces: Point[][], tol = 1e-6): { pts: Point[]; closed: boolean }[] {
  const rem = pieces.map(p => p.slice()), out: { pts: Point[]; closed: boolean }[] = [];
  while (rem.length) {
    let ch = rem.shift()!, grown = true;
    while (grown) {
      grown = false;
      for (let i = 0; i < rem.length; i++) {
        const q = rem[i], s = ch[0], e = ch[ch.length - 1], qs = q[0], qe = q[q.length - 1];
        if (dist(e, qs) < tol) ch = ch.concat(q.slice(1));
        else if (dist(e, qe) < tol) ch = ch.concat(q.slice().reverse().slice(1));
        else if (dist(s, qe) < tol) ch = q.concat(ch.slice(1));
        else if (dist(s, qs) < tol) ch = q.slice().reverse().concat(ch.slice(1));
        else continue;
        rem.splice(i, 1); grown = true; break;
      }
    }
    const closed = ch.length > 2 && dist(ch[0], ch[ch.length - 1]) < tol; if (closed) ch.pop();
    out.push({ pts: ch, closed });
  }
  return out;
}

/** Open shapes connected end-to-end with `start` (transitively). Closed shapes return just themselves. */
export function connectedGroup<T extends Shape>(start: T, all: T[]): T[] {
  if (!endsOf(start)) return [start];
  const group = [start], seen = new Set([start]); let grew = true;
  while (grew) {
    grew = false; const gEnds = group.flatMap(g => endsOf(g) || []);
    for (const x of all) {
      if (seen.has(x)) continue; const e = endsOf(x); if (!e) continue;
      if (e.some(p => gEnds.some(q => dist(p, q) < 1e-6))) { group.push(x); seen.add(x); grew = true; }
    }
  }
  return group;
}

/**
 * Text plus any open lines/curves drawn through its letters (a "spine" for a
 * key ring, so one contour goes round every letter and along the line between
 * them). Starts from `group` and adds what crosses it, from `all`.
 */
export function withSpines<T extends Shape>(group: T[], all: T[]): T[] {
  const out = [...group], has = new Set(out);
  const isOpen = (e: Shape) => e.type === 'line' || e.type === 'arc' || ((e.type === 'poly' || e.type === 'spline') && !e.closed);
  const crosses = (text: Shape, line: Shape) => {
    const solid = makeSource([text]).solid; if (!solid.length) return false;
    const f = flatten(line).pts;
    for (let i = 0; i < f.length; i++) {
      if (pointInSolid(f[i], solid)) return true;
      const b = f[i + 1]; if (!b) break;
      const n = Math.min(200, Math.ceil(dist(f[i], b) / 0.5));
      for (let k = 1; k < n; k++) if (pointInSolid({ x: f[i].x + (b.x - f[i].x) * k / n, y: f[i].y + (b.y - f[i].y) * k / n }, solid)) return true;
    }
    return false;
  };
  for (let pass = 0; pass < 3; pass++) {
    let grew = false;
    for (const x of all) {
      if (has.has(x)) continue;
      const hit = x.type === 'text' ? out.some(g => isOpen(g) && crosses(x, g)) : isOpen(x) ? out.some(g => g.type === 'text' && crosses(g, x)) : false;
      if (hit) { out.push(x); has.add(x); grew = true; }
    }
    if (!grew) break;
  }
  return out;
}

export interface OffsetSource { closed: Point[][]; open: Point[][]; solid: IntPath[] }
export function makeSource(shapes: Shape[]): OffsetSource {
  const closed: Point[][] = [], pieces: Point[][] = [];
  for (const e of shapes.flatMap(x => x.type === 'text' ? ext.textShapes(x) : [x])) { if (e.type === 'dim') continue; const f = flatten(e); if (f.pts.length < 2) continue; (f.closed ? closed : pieces).push(f.pts); }
  const open: Point[][] = [];
  for (const c of chainPieces(pieces)) (c.closed ? closed : open).push(c.pts);
  return { closed, open, solid: closed.length ? solidOf(closed) : [] };
}
export function solidOf(closed: Point[][]): IntPath[] {
  const c = new L.Clipper(), paths = closed.map(p => { const ip = toInt(p); if (!L.Clipper.Orientation(ip)) ip.reverse(); return ip; });
  c.AddPaths(paths, L.PolyType.ptSubject, true); const sol = new L.Paths();
  c.Execute(L.ClipType.ctUnion, sol, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero); return sol;
}
/** Offset a solid region (and open bands) by d (negative = inwards). */
export function offsetPaths(solid: IntPath[], open: Point[][], d: number, round: boolean): Point[][] {
  const co = new L.ClipperOffset(round ? 2 : 4, offsetSettings.arcTol * offsetSettings.scale), jt = round ? L.JoinType.jtRound : L.JoinType.jtMiter;
  if (solid.length) co.AddPaths(solid, jt, L.EndType.etClosedPolygon);
  if (d > 0 && open.length) co.AddPaths(open.map(toInt), jt, round ? L.EndType.etOpenRound : L.EndType.etOpenSquare);
  const out = new L.Paths(); co.Execute(out, d * offsetSettings.scale);
  return out.filter((p: IntPath) => p.length > 2).map(fromInt);
}
export function pointInSolid(p: Point, solid: IntPath[]): boolean {
  const q = { X: Math.round(p.x * offsetSettings.scale), Y: Math.round(p.y * offsetSettings.scale) }; let w = 0;
  for (const path of solid) if (L.Clipper.PointInPolygon(q, path) !== 0) w += L.Clipper.Orientation(path) ? 1 : -1;
  return w > 0;
}

export type Side = 'out' | 'in' | 'both';
/** Whole-shape contour: `count` contours at d, 2d, … on the given side. */
export function contour(src: OffsetSource, d: number, side: Side, round: boolean, count = 1): Point[][] {
  const out: Point[][] = [];
  for (let k = 1; k <= Math.max(1, count); k++) {
    const dk = d * k;
    if (side === 'out' || side === 'both') out.push(...offsetPaths(src.solid, src.open, dk, round));
    if ((side === 'in' || side === 'both') && src.solid.length) out.push(...offsetPaths(src.solid, [], -dk, round));
  }
  return out;
}

/** Exact parallel copy of a single line or arc/circle, on the side of `towards` (or forced side). */
export function offsetPrim(pr: Prim, d: number, towards: Point, side: 'auto' | Side = 'auto'): Shape | null {
  if (pr.t === 'seg') {
    const u = sub(pr.b, pr.a), Lu = len(u) || 1, n = P(-u.y / Lu, u.x / Lu);
    const sgn = side === 'in' ? -1 : side === 'out' ? 1 : (cross(u, sub(towards, pr.a)) >= 0 ? 1 : -1);
    return { type: 'line', a: cp(add(pr.a, mul(n, d * sgn))), b: cp(add(pr.b, mul(n, d * sgn))) } as Shape;
  }
  const outside = side === 'out' || (side !== 'in' && dist(towards, pr.c) > pr.r), r = pr.r + (outside ? d : -d);
  if (r <= 1e-9) return null;
  return pr.full ? { type: 'circle', c: pr.c, r: clean(r) } as Shape : { type: 'arc', c: pr.c, r: clean(r), a0: pr.a0!, a1: pr.a1! } as Shape;
}
export { polar };
