/**
 * Contour / offset engine built on Clipper (Angus Johnson, Boost licence).
 * Closed shapes are unioned into a solid region and offset; open lines are
 * offset as bands with round or square ends. Results are closed polylines
 * whose vertices lie on the true offset curve (within ARC_TOL).
 */
import ClipperLib from 'clipper-lib';
import { type Point, P, add, sub, mul, dist, len, cross, polar, clean, cp } from './vec';
import { flatten, endsOf, ext, type Prim } from './entity';
import type { Shape, TextEnt } from '../model/types';
import { textSpines } from '../text/text';

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
export const isOpenShape = (e: Shape) => e.type === 'line' || e.type === 'arc' || ((e.type === 'poly' || e.type === 'spline') && !e.closed);
/** Does the line / outline of `line` run through any letter of `text`? */
export function crossesText(text: Shape, line: Shape): boolean {
  if (line.type === 'text' || line.type === 'dim') return false;
  const solid = makeSource([text]).solid; if (!solid.length) return false;
  const f = flatten(line).pts, closed = flatten(line).closed, n0 = f.length;
  for (let i = 0; i < n0; i++) {
    if (pointInSolid(f[i], solid)) return true;
    const b = f[i + 1] ?? (closed ? f[0] : null); if (!b) break;
    const n = Math.min(200, Math.ceil(dist(f[i], b) / 0.5));
    for (let k = 1; k < n; k++) if (pointInSolid({ x: f[i].x + (b.x - f[i].x) * k / n, y: f[i].y + (b.y - f[i].y) * k / n }, solid)) return true;
  }
  return false;
}
/**
 * Text plus any lines, curves or outlines drawn through its letters ("spines":
 * one contour then goes round every letter and along the line). Starts from
 * `group` and adds what crosses it, from `all`.
 */
export function withSpines<T extends Shape>(group: T[], all: T[]): T[] {
  const out = [...group], has = new Set(out);
  for (let pass = 0; pass < 3; pass++) {
    let grew = false;
    for (const x of all) {
      if (has.has(x) || x.type === 'dim') continue;
      const hit = x.type === 'text' ? out.some(g => g.type !== 'text' && crossesText(x, g)) : out.some(g => g.type === 'text' && crossesText(g, x));
      if (hit) { out.push(x); has.add(x); grew = true; }
    }
    if (!grew) break;
  }
  return out;
}
/** The shapes in a contour group that act as spines: non-text shapes running through text. */
export function spinesOf<T extends Shape>(shapes: T[]): Set<T> {
  const texts = shapes.filter(s => s.type === 'text');
  return new Set(shapes.filter(s => s.type !== 'text' && s.type !== 'dim' && texts.some(t => crossesText(t, s))));
}

/**
 * closed → solid region; open → bands; loops → closed outlines used as lines
 * (a circle through a ring of letters: contours on both sides of it);
 * letters → the letters' own outlines (so holes inside letters can be left out of a joined contour).
 */
export interface OffsetSource { closed: Point[][]; open: Point[][]; loops: Point[][]; solid: IntPath[]; letters?: IntPath[]; joins?: { pts: Point[]; closed: boolean; w: number }[] }
export interface SourceOpts {
  /** shapes used as lines through text (closed ones become loops, not solid areas) */
  spines?: Set<Shape>;
  /** join spaced-out letters: a line through the middle of each text's letters (all round a shared closed path) */
  join?: boolean;
}
export function makeSource(shapes: Shape[], o: SourceOpts = {}): OffsetSource {
  const closed: Point[][] = [], pieces: Point[][] = [], loops: Point[][] = [], letterPaths: Point[][] = [], joins: { pts: Point[]; closed: boolean; w: number }[] = [];
  for (const x of shapes) {
    if (x.type === 'dim') continue;
    if (x.type === 'text') { for (const e of ext.textShapes(x)) { const f = flatten(e); if (f.pts.length < 2) continue; if (f.closed) { closed.push(f.pts); letterPaths.push(f.pts); } else pieces.push(f.pts); } continue; }
    const f = flatten(x); if (f.pts.length < 2) continue;
    if (f.closed && o.spines?.has(x)) loops.push(f.pts); else (f.closed ? closed : pieces).push(f.pts);
  }
  if (o.join) {
    const texts = shapes.filter(s => s.type === 'text') as unknown as TextEnt[], byPath = new Map<string, number>();
    for (const t of texts) if (t.path) { const k = JSON.stringify(t.path.geom); byPath.set(k, (byPath.get(k) || 0) + 1); }
    for (const t of texts) {
      const whole = !!t.path && (byPath.get(JSON.stringify(t.path.geom)) || 0) > 1;
      // a band 60% of the capital height wide along the middle of the letters: the contour hugs the letter tops and bridges the gaps
      for (const sp of textSpines(t, whole)) joins.push({ ...sp, w: t.size * 0.3 });
    }
  }
  const open: Point[][] = [];
  for (const c of chainPieces(pieces)) (c.closed ? closed : open).push(c.pts);
  return { closed, open, loops, solid: closed.length ? solidOf(closed) : [], letters: letterPaths.length ? solidOf(letterPaths) : undefined, joins: joins.length ? joins : undefined };
}
export function solidOf(closed: Point[][]): IntPath[] {
  const c = new L.Clipper(), paths = closed.map(p => { const ip = toInt(p); if (!L.Clipper.Orientation(ip)) ip.reverse(); return ip; });
  c.AddPaths(paths, L.PolyType.ptSubject, true); const sol = new L.Paths();
  c.Execute(L.ClipType.ctUnion, sol, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero); return sol;
}
/** Offset a solid region (and open bands) by d (negative = inwards). */
export function offsetPaths(solid: IntPath[], open: Point[][], d: number, round: boolean, loops: Point[][] = []): Point[][] {
  const co = new L.ClipperOffset(round ? 2 : 4, offsetSettings.arcTol * offsetSettings.scale), jt = round ? L.JoinType.jtRound : L.JoinType.jtMiter;
  if (solid.length) co.AddPaths(solid, jt, L.EndType.etClosedPolygon);
  if (d > 0 && open.length) co.AddPaths(open.map(toInt), jt, round ? L.EndType.etOpenRound : L.EndType.etOpenSquare);
  if (d > 0 && loops.length) co.AddPaths(loops.map(toInt), jt, L.EndType.etClosedLine);
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
    if (side === 'out' || side === 'both') {
      let res = offsetPaths(src.solid, src.open, dk, round, src.loops);
      if (src.joins) {
        const extra = src.joins.flatMap(j => offsetPaths([], j.closed ? [] : [j.pts], dk + j.w, true, j.closed ? [j.pts] : []));
        const c = new L.Clipper(), sol = new L.Paths(), ip = (p: Point[]) => toInt(p);
        c.AddPaths(res.map(ip), L.PolyType.ptSubject, true); c.AddPaths(extra.map(ip), L.PolyType.ptSubject, true);
        c.Execute(L.ClipType.ctUnion, sol, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero);
        res = (sol as IntPath[]).filter(p => p.length > 2).map(fromInt);
      }
      // joined text: leave out the little loops inside letters (the middles of o, e, a…) — the piece is one outline
      if (src.letters && (src.open.length || src.loops.length || src.joins)) {
        const outers = src.letters.filter(p => L.Clipper.Orientation(p));
        res = res.filter(pts => { const ip = toInt(pts); if (L.Clipper.Orientation(ip)) return true; return !outers.some(op => L.Clipper.PointInPolygon(ip[0], op) !== 0); });
      }
      out.push(...res);
    }
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
