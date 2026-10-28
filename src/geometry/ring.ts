/**
 * "Add a ring" — the key-ring helper. Places a round tab on the edge of a
 * closed shape, joins it to the shape (exact union) and adds the hole.
 */
import { type Point, P, sub, add, mul, len, dist, cp, clean } from './vec';
import { prims, nearestOnPrim, flatten, keypoints, type Prim } from './entity';
import { pointInPoly } from './region';
import { booleanShapes } from './boolean';
import type { Shape } from '../model/types';

export interface RingOpts { outerD: number; holeD: number; overlap: number }
export interface RingPlace { B: Point; n: Point; C: Point }

const unit = (v: Point) => { const L = len(v) || 1; return mul(v, 1 / L); };
function tangentAt(pr: Prim, p: Point): Point { return pr.t === 'seg' ? unit(sub(pr.b, pr.a)) : unit(P(-(p.y - pr.c.y), p.x - pr.c.x)); }

/** Where the ring goes for a cursor position: nearest edge point B (snapping to key points within snapTol), outward normal n, ring centre C. */
export function ringPlace(shape: Shape, cursor: Point, o: RingOpts, snapTol = 0): RingPlace {
  const pr = prims(shape), poly = flatten(shape, 0.01).pts;
  let best = { d: Infinity, p: cursor, k: pr[0] };
  for (const k of pr) { const q = nearestOnPrim(cursor, k), d = dist(q, cursor); if (d < best.d) best = { d, p: q, k }; }
  let B = best.p;
  for (const kp of keypoints(shape)) if (kp.k !== 'centre' && dist(kp.p, B) <= snapTol) { B = kp.p; break; }
  const t = tangentAt(best.k, B); let n = P(-t.y, t.x);
  if (pointInPoly(add(B, mul(n, 0.05)), poly)) n = mul(n, -1);
  const R = o.outerD / 2, C = cp(add(B, mul(n, R - o.overlap)));
  return { B, n, C: P(clean(C.x), clean(C.y)) };
}

/** The shapes that replace `shape`: the joined outline(s) plus the hole circle. */
export function ringShapes(shape: Shape, C: Point, o: RingOpts): { shapes: Shape[] } | { error: string } {
  const R = o.outerD / 2, r = o.holeD / 2;
  if (!(R > 0) || !(r > 0)) return { error: 'Ring and hole sizes must be more than 0' };
  if (R - r < 1) return { error: `Ring wall would be ${+(R - r).toFixed(2)} mm — make the hole smaller or the ring bigger` };
  const u = booleanShapes('union', [shape, { type: 'circle', c: C, r: R } as Shape], 0);
  if ('error' in u) return u;
  return { shapes: [...u.shapes, { type: 'circle', c: C, r } as Shape] };
}
