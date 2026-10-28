/**
 * Placing text on paths (where a click lands, sliding with snaps), and turning
 * text into ordinary shapes (outlines, or welded into one cut-out).
 */
import ClipperLib from 'clipper-lib';
import { type Point, P, dist } from '../geometry/vec';
import { flatten } from '../geometry/entity';
import { pathRun, runAt, nearestPos, textShapes } from './text';
import type { Shape, TextEnt, TextPath } from '../model/types';

/** Shapes text can follow: anything with a length except text and dimensions. */
export const canCarryText = (e: { type: string }) => e.type !== 'text' && e.type !== 'dim';

/** Centre of a shape's flattened outline box. */
function centreOf(geom: Shape): Point {
  const f = flatten(geom, 0.05).pts; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of f) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  return P((x0 + x1) / 2, (y0 + y1) / 2);
}

/**
 * Where new text goes when you click on a path at `p`:
 *  • on a closed shape, clicking below its middle puts the text underneath,
 *    reading upright the right way round (like the bottom of a badge), and on
 *    the outside like text along the top;
 *  • on an open line, the text always reads left to right.
 */
export function placeOnPath(geom: Shape, p: Point, side: TextPath['side'] = 'above'): { pos: number; flip: boolean; side: TextPath['side'] } {
  const pos = nearestPos(geom, p), r = pathRun(geom, false);
  if (r.closed) {
    const below = p.y < centreOf(geom).y;
    return { pos, flip: below, side: below ? (side === 'above' ? 'below' : side === 'below' ? 'above' : 'on') : side };
  }
  const { t } = runAt(r, pos * r.L);
  return { pos, flip: t.x < -1e-9, side };
}

export interface SnapPoint { pos: number; anchor: TextPath['anchor']; p: Point; label: string }
/** Positions text likes to snap to: start, middle and end of a line; top, bottom, left and right of a closed shape. */
export function snapPoints(geom: Shape, flip: boolean): SnapPoint[] {
  const r = pathRun(geom, false), at = (pos: number) => runAt(r, pos * r.L).p;
  if (!r.closed) return [
    { pos: 0, anchor: flip ? 'end' : 'start', p: at(0), label: 'start' },
    { pos: 0.5, anchor: 'center', p: at(0.5), label: 'middle' },
    { pos: 1, anchor: flip ? 'start' : 'end', p: at(1), label: 'end' },
  ];
  // the extreme point along each direction, refined between the flattened points (parabola through the best three)
  const n = r.pts.length - 1, ext = (f: (q: Point) => number): number => {
    let i = 0; for (let k = 1; k < n; k++) if (f(r.pts[k]) > f(r.pts[i])) i = k;
    const a = (i - 1 + n) % n, c = (i + 1) % n, s0 = r.s[i] - (r.s[i] - (i ? r.s[a] : r.s[n - 1] - r.L)), s1 = r.s[i], s2 = r.s[i] + ((c ? r.s[c] : r.L) - r.s[i]);
    const y0 = f(r.pts[a]), y1 = f(r.pts[i]), y2 = f(r.pts[c]), den = (s1 - s0) * (y1 - y2) - (s1 - s2) * (y1 - y0);
    const s = Math.abs(den) < 1e-15 ? s1 : s1 - 0.5 * ((s1 - s0) ** 2 * (y1 - y2) - (s1 - s2) ** 2 * (y1 - y0)) / den;
    return (((s % r.L) + r.L) % r.L) / r.L;
  };
  return ([[(q: Point) => q.y, 'top'], [(q: Point) => -q.y, 'bottom'], [(q: Point) => -q.x, 'left'], [(q: Point) => q.x, 'right']] as [(q: Point) => number, string][])
    .map(([f, label]) => { const pos = ext(f); return { pos, anchor: 'center' as const, p: at(pos), label }; });
}

/** Slide path text to the point nearest `p`, snapping within `tol` mm. Returns what changed. */
export function slideTo(t: TextEnt, p: Point, tol: number): { pos: number; anchor: TextPath['anchor']; snap: SnapPoint | null } {
  const pp = t.path!, pos = nearestPos(pp.geom, p), r = pathRun(pp.geom, false), here = runAt(r, pos * r.L).p;
  let best: SnapPoint | null = null, bd = tol;
  for (const s of snapPoints(pp.geom, pp.flip)) { const d = dist(s.p, here); if (d <= bd) { bd = d; best = s; } }
  if (pp.anchor === 'fit') return { pos: best ? best.pos : pos, anchor: 'fit', snap: best };
  if (best) return { pos: best.pos, anchor: best.anchor, snap: best };
  return { pos, anchor: 'center', snap: null };
}

/** The letters as separate outlines (each letter's holes stay separate shapes, as they cut). */
export const outlinesOf = (t: TextEnt): Shape[] => textShapes(t);

const L = ClipperLib, SCALE = 1e5;
/**
 * Weld: letters that touch or overlap join into one outline (holes inside
 * letters, like the middle of an O, stay holes). Single-line letters are kept as lines.
 */
export function weldShapes(shapes: Shape[]): Shape[] {
  const closed = shapes.filter(s => (s as any).closed), open = shapes.filter(s => !(s as any).closed);
  if (!closed.length) return open;
  const paths = closed.map(s => flatten(s, 0.005).pts.map(q => ({ X: Math.round(q.x * SCALE), Y: Math.round(q.y * SCALE) })));
  const c = new L.Clipper(), out = new L.Paths();
  c.AddPaths(paths, L.PolyType.ptSubject, true);
  c.Execute(L.ClipType.ctUnion, out, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero);
  const res: Shape[] = (out as { X: number; Y: number }[][])
    .filter(q => q.length > 2 && Math.abs(L.Clipper.Area(q)) > 1e-4 * SCALE * SCALE)
    .map(q => ({ type: 'poly', closed: true, pts: q.map(v => P(v.X / SCALE, v.Y / SCALE)) }) as Shape);
  return [...res, ...open];
}
