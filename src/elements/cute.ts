/**
 * Cute ("kawaii") elements: chunky rounded outlines to CUT, with little faces to
 * ENGRAVE (blue) — eyes with a shine, small smiles, blush cheeks. One strong piece
 * for key rings; the face is drawn on, not cut out. All original to Kerf 2D.
 */
import { type Point, P } from '../geometry/vec';
import { autoHandles } from '../geometry/spline';
import { booleanShapes } from '../geometry/boolean';
import { affEnt, affMir, affRot } from '../geometry/affine';
import { makePolygon } from '../tools/draw';
import { roundCorners, offsetOutline } from '../hinge/hinge';
import type { Shape } from '../model/types';
import type { Element } from './elements';

// ---- outline helpers (cut) ----
const circle = (x: number, y: number, r: number) => ({ type: 'circle', c: P(x, y), r }) as Shape;
const ell = (x: number, y: number, rx: number, ry: number, deg = 0) => ({ type: 'ellipse', c: P(x, y), rx, ry, rot: deg * Math.PI / 180 }) as Shape;
const poly = (pts: number[][], closed = true) => ({ type: 'poly', closed, pts: pts.map(([x, y]) => P(x, y)) }) as Shape;
const path = (pts: number[][], bulge: number[]) => ({ type: 'poly', closed: true, pts: pts.map(([x, y]) => P(x, y)), bulge }) as Shape;
const T8 = Math.tan(Math.PI / 8);
const rr = (x0: number, y0: number, x1: number, y1: number, r0: number) => { const r = Math.min(r0, (x1 - x0) / 2 - 0.01, (y1 - y0) / 2 - 0.01); return path([[x0 + r, y0], [x1 - r, y0], [x1, y0 + r], [x1, y1 - r], [x1 - r, y1], [x0 + r, y1], [x0, y1 - r], [x0, y0 + r]], [0, T8, 0, T8, 0, T8, 0, T8]); };
function curve(pts: number[][], corners: number[] = []): Shape {
  const p = pts.map(([x, y]) => P(x, y)), h = autoHandles(p, true);
  for (const i of corners) h[i] = [p[i], p[i]];
  return { type: 'spline', pts: p, h, closed: true } as Shape;
}
/** polygon with every corner rounded to r (exact fillets) */
const soft = (pts: number[][], r: number) => roundCorners([poly(pts)], r) ?? poly(pts);
const bar = (x0: number, y0: number, x1: number, y1: number, w: number) => { const l = Math.hypot(x1 - x0, y1 - y0) || 1, nx = -(y1 - y0) / l * w / 2, ny = (x1 - x0) / l * w / 2; return poly([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]); };
const U = (...a: (Shape | Shape[])[]) => { const s = a.flat(); const r = booleanShapes('union', s); return 'error' in r ? s : r.shapes; };
const minus = (a: Shape, ...b: Shape[]) => { const r = booleanShapes('subtract', [a, ...b], 0); return 'error' in r ? [a] : r.shapes; };
const rot = (s: Shape, deg: number, cx = 0, cy = 0) => affEnt(s, affRot(P(cx, cy), deg * Math.PI / 180));
const mirror = (s: Shape) => affEnt(s, affMir(P(0, 0), P(0, 1)));

// ---- engraved details (blue) ----
const E = (s: Shape | Shape[]) => (Array.isArray(s) ? s : [s]).map(x => ({ ...x, color: 'blue' }) as Shape);
const arc = (x: number, y: number, r: number, a0: number, a1: number) => ({ type: 'arc', c: P(x, y), r, a0: a0 * Math.PI / 180, a1: a1 * Math.PI / 180 }) as Shape;
const line = (x0: number, y0: number, x1: number, y1: number) => ({ type: 'line', a: P(x0, y0), b: P(x1, y1) }) as Shape;
/** a pair of eyes with a shine, centred at (cx, cy), half-spacing dx, radius r */
const eyes = (cx: number, cy: number, dx: number, r: number) => E([circle(cx - dx, cy, r), circle(cx - dx + r * 0.38, cy + r * 0.38, r * 0.32), circle(cx + dx, cy, r), circle(cx + dx + r * 0.38, cy + r * 0.38, r * 0.32)]);
const smile = (cx: number, cy: number, r: number) => E(arc(cx, cy, r, 205, 335));
const wmouth = (cx: number, cy: number, r: number) => E([arc(cx - r, cy, r, 180, 360), arc(cx + r, cy, r, 180, 360)]);
const blush = (cx: number, cy: number, dx: number, s = 1) => E([ell(cx - dx, cy, 1.7 * s, 1 * s), ell(cx + dx, cy, 1.7 * s, 1 * s)]);
/** the standard happy face: eyes, mouth, cheeks (s = size) */
const face = (cx: number, cy: number, s = 1, mouth: 'smile' | 'w' | 'o' = 'smile') => [
  ...eyes(cx, cy, 4.4 * s, 1.7 * s),
  ...(mouth === 'w' ? wmouth(cx, cy - 2.4 * s, 0.9 * s) : mouth === 'o' ? E(ell(cx, cy - 2.6 * s, 0.9 * s, 1.1 * s)) : smile(cx, cy - 1.4 * s, 1.5 * s)),
  ...blush(cx, cy - 2.4 * s, 7 * s, s),
];
const ear = (pts: number[][], r = 2.2) => soft(pts, r);
const mirrored = (pts: number[][]) => pts.map(([x, y]) => [-x, y]);

export const CUTE: Element[] = [
  // ---------- animals ----------
  { id: 'kitty', name: 'Kitty', cat: 'Animals', make: () => [...U(ell(0, -3, 17, 13.5), ear([[-15, 2], [-12, 17], [-3, 9]]), ear(mirrored([[-15, 2], [-12, 17], [-3, 9]]))),
    ...E([soft([[-12.5, 6.5], [-11.3, 13], [-6.5, 9.5]], 1), soft(mirrored([[-12.5, 6.5], [-11.3, 13], [-6.5, 9.5]]), 1)]),
    ...face(0, -3, 1.3, 'w'), ...E([line(-11, -6, -15.2, -5.2), line(-11, -8, -14.8, -9), line(11, -6, 15.2, -5.2), line(11, -8, 14.8, -9)])] },
  { id: 'bunny', name: 'Bunny', cat: 'Animals', make: () => [...U(circle(0, -7, 13), ell(-5.5, 11, 4.3, 10.5, 8), ell(5.5, 11, 4.3, 10.5, -8)),
    ...E([ell(-5.5, 11, 2, 7, 8), ell(5.5, 11, 2, 7, -8)]), ...face(0, -8, 1.15, 'w')] },
  { id: 'bear', name: 'Bear', cat: 'Animals', make: () => [...U(circle(0, -3, 15), circle(-11, 9, 5.5), circle(11, 9, 5.5)),
    ...E([circle(-11, 9, 3), circle(11, 9, 3), ell(0, -8, 5.5, 4), ell(0, -6.3, 2, 1.3)]), ...eyes(0, -1, 6, 1.9), ...smile(0, -9.4, 1.4), ...blush(0, -6, 10.5)] },
  { id: 'panda', name: 'Panda', cat: 'Animals', make: () => [...U(circle(0, -3, 15), circle(-11, 9, 5.5), circle(11, 9, 5.5)),
    ...E([circle(-11, 9, 3), circle(11, 9, 3), ell(-6, -1.5, 4, 3, 30), ell(6, -1.5, 4, 3, -30), ell(0, -7, 2, 1.3)]), ...eyes(0, -1.2, 6, 1.5), ...wmouth(0, -9, 1), ...blush(0, -7, 10.5)] },
  { id: 'frog', name: 'Frog', cat: 'Animals', make: () => [...U(ell(0, -4, 18, 12), circle(-9, 7, 6.5), circle(9, 7, 6.5)),
    ...eyes(0, 7, 9, 2.8), ...E(arc(0, 0, 9, 220, 320)), ...blush(0, -6.5, 12, 1.2)] },
  { id: 'chick', name: 'Chick', cat: 'Animals', make: () => [...U(circle(0, -2, 15), ell(-1.6, 14, 1.8, 3.8, 22), ell(1.6, 14, 1.8, 3.8, -22)),
    ...E([ell(-11.2, -6.5, 2.2, 3.8, -20), ell(11.2, -6.5, 2.2, 3.8, 20), poly([[-1.8, -2], [1.8, -2], [0, -4.4]])]), ...eyes(0, 1, 5, 1.8), ...blush(0, -3.5, 7.4, 0.85)] },
  { id: 'piggy', name: 'Piggy', cat: 'Animals', make: () => [...U(ell(0, -2, 17, 13.5), ear([[-15, 4], [-13, 15.5], [-6, 10]], 2), ear(mirrored([[-15, 4], [-13, 15.5], [-6, 10]]), 2)),
    ...E([ell(0, -5.5, 5, 3.6), ell(-1.7, -5.5, 0.8, 1.3), ell(1.7, -5.5, 0.8, 1.3)]), ...eyes(0, 1.5, 6.5, 1.8), ...blush(0, -6, 11.5)] },
  { id: 'fox', name: 'Fox', cat: 'Animals', make: () => [...U(curve([[0, -16], [-9, -11], [-16, -1], [-17, 6], [-12, 10], [-5, 7], [0, 8], [5, 7], [12, 10], [17, 6], [16, -1], [9, -11]], [0]),
    ear([[-17, 4], [-15, 18], [-6, 8]], 1.8), ear(mirrored([[-17, 4], [-15, 18], [-6, 8]]), 1.8)),
    ...E([soft([[-14.5, 8], [-13.4, 14.5], [-8.5, 9]], 0.8), soft(mirrored([[-14.5, 8], [-13.4, 14.5], [-8.5, 9]]), 0.8), ell(0, -10.5, 1.7, 1.1)]), ...eyes(0, 0, 6, 1.8), ...wmouth(0, -12.4, 0.9), ...blush(0, -4.5, 10)] },
  { id: 'penguin', name: 'Penguin', cat: 'Animals', make: () => [...U(ell(0, -1, 13, 18), ell(-12.5, -3, 3, 8, -18), ell(12.5, -3, 3, 8, 18), ell(-5, -18.5, 4.2, 2), ell(5, -18.5, 4.2, 2)),
    ...E([ell(0, -5, 9, 12), poly([[-1.8, 4.6], [1.8, 4.6], [0, 2.4]])]), ...eyes(0, 7.5, 4.5, 1.7), ...blush(0, 3.8, 8, 0.9)] },
  { id: 'owlet', name: 'Owl', cat: 'Animals', make: () => [...U(ell(0, -2, 14, 17), ear([[-13, 8], [-12, 18.5], [-5, 13]], 1.6), ear(mirrored([[-13, 8], [-12, 18.5], [-5, 13]]), 1.6)),
    ...E([circle(-5.5, 4, 4.6), circle(5.5, 4, 4.6), poly([[-1.6, 0.4], [1.6, 0.4], [0, -2.6]]), arc(-4, -8, 2.2, 200, 340), arc(0, -10.5, 2.2, 200, 340), arc(4, -8, 2.2, 200, 340)]), ...eyes(0, 4, 5.5, 2)] },
  { id: 'whale2', name: 'Whale', cat: 'Animals', make: () => [...U(curve([[-12, -9], [-17, -2], [-15, 6], [-6, 11], [6, 10], [14, 4], [17, -3], [12, -9]]), soft([[-13, 0], [-24, 9], [-21.5, -3]], 1.6)),
    ...E([poly([[2, 11], [2, 15], [-1, 17.5]], false), line(2, 15, 5, 17.5)]), ...eyes(9, 1.5, 0, 1.7).slice(0, 2), ...smile(10.5, -2.5, 1.8), ...E(ell(13.5, -1.5, 1.5, 0.9))] },
  { id: 'octopus', name: 'Octopus', cat: 'Animals', make: () => [...U(circle(0, 5, 13), rr(-13, -9, 13, 5, 0.5), circle(-9.75, -9, 3.25), circle(-3.25, -9, 3.25), circle(3.25, -9, 3.25), circle(9.75, -9, 3.25)), ...face(0, 3, 1.2)] },
  { id: 'snail', name: 'Snail', cat: 'Animals', make: () => [...U(circle(4, 5, 11), rr(-19, -10, 15, -5, 2.5), circle(-15, -4, 5), bar(-16.5, 0, -18.5, 8, 1.4), circle(-18.5, 8, 1.6), bar(-13, 0, -12, 8, 1.4), circle(-12, 8, 1.6)),
    ...E([arc(4, 5, 7.5, 0, 180), arc(5.5, 5, 6, 180, 360), arc(4, 5, 4.5, 0, 180), arc(5.5, 5, 3, 180, 360)]), ...eyes(-15.5, -3, 0, 1.3).slice(0, 2), ...smile(-16, -5.6, 1.3)] },
  { id: 'ladybird', name: 'Ladybird', cat: 'Animals', make: () => [...U(circle(0, -3, 14), circle(0, 11, 6.5)),
    ...E([line(0, 4.6, 0, -17), circle(-6, -1, 2.3), circle(6, -1, 2.3), circle(-5, -9.5, 2), circle(5, -9.5, 2), circle(-10, -5.5, 1.4), circle(10, -5.5, 1.4)]), ...eyes(0, 12, 2.6, 1.05), ...smile(0, 10.3, 1)] },
  { id: 'bee', name: 'Bee', cat: 'Animals', make: () => [...U(ell(0, -4, 16, 11), circle(3, 9, 5.5), circle(10, 7.5, 4.5), soft([[15.5, -3], [20.5, -4.5], [15.5, -6.5]], 0.7), bar(-9, 5, -12, 12, 1.4), circle(-12, 12, 1.8), bar(-5, 6, -5, 13, 1.4), circle(-5, 13, 1.8)),
    ...E([circle(3, 9, 3.2), circle(10, 7.5, 2.4), line(4, 3, 4, -14.3), line(9, 2.5, 9, -12.8), line(13.5, 1.4, 13.5, -9.6)]), ...face(-6, -4, 0.85)] },
  { id: 'turtle2', name: 'Turtle', cat: 'Animals', make: () => [...U(path([[13, -6], [-13, -6], [0, -6]], [1, 0, 0]), rr(-16, -10, 16, -5, 2.5), circle(17, -3, 5.5), circle(-9, -11, 3.2), circle(9, -11, 3.2)),
    ...E([makePolygon(P(0, 1), P(4.5, 1), 6, 'corner', false, 50, 0), line(-4.5, 1, -11, 1), line(4.5, 1, 11, 1), line(-2.25, 4.9, -5, 10), line(2.25, 4.9, 5, 10)]), ...eyes(18.5, -2, 0, 1.2).slice(0, 2), ...smile(18.5, -4.6, 1.3)] },
  { id: 'puppy', name: 'Puppy', cat: 'Animals', make: () => [...U(circle(0, -2, 14), ell(-13, -2, 4.5, 9, -15), ell(13, -2, 4.5, 9, 15)),
    ...E([ell(0, -7, 5, 3.8), ell(0, -5, 2, 1.3)]), ...eyes(0, 1, 5.5, 1.9), ...smile(0, -8.6, 1.3), ...blush(0, -5, 9)] },
  { id: 'fish2', name: 'Fish', cat: 'Animals', make: () => [...U(ell(-1, 0, 14, 10), soft([[10, 0], [20, 8], [20, -8]], 2)),
    ...E([arc(1, 0, 4, 300, 60), arc(5, 0, 4, 300, 60)]), ...eyes(-7, 2, 0, 2).slice(0, 2), ...smile(-9, -3, 1.6), ...E(ell(-4.5, -3, 1.5, 0.9))] },
  // ---------- food ----------
  { id: 'strawberry', name: 'Strawberry', cat: 'Food', make: () => [...U(curve([[0, -17], [-8, -11], [-13, -1], [-12, 7], [-6, 10], [0, 9], [6, 10], [12, 7], [13, -1], [8, -11]]), ell(-5, 11, 5, 2.4, 20), ell(5, 11, 5, 2.4, -20), ell(0, 12, 2.4, 4.4)),
    ...E([ell(-8, -6, 0.5, 0.9), ell(8, -6, 0.5, 0.9), ell(-3, -11, 0.5, 0.9), ell(3, -11, 0.5, 0.9), ell(0, -7, 0.5, 0.9), ell(-10, 3, 0.5, 0.9), ell(10, 3, 0.5, 0.9)]), ...face(0, 1, 1.05)] },
  { id: 'avocado', name: 'Avocado', cat: 'Food', make: () => { const pts = [[0, -17], [-10, -12], [-13, -2], [-9, 8], [-5, 15], [0, 17], [5, 15], [9, 8], [13, -2], [10, -12]];
    return [curve(pts), ...E([curve(pts.map(([x, y]) => [x * 0.8, y * 0.82 - 0.3])), circle(0, -7, 5.5)]), ...eyes(0, 4.5, 4, 1.4), ...smile(0, 2, 1.2), ...blush(0, 2, 6.5, 0.8)]; } },
  { id: 'toast', name: 'Toast', cat: 'Food', make: () => { const t = U(rr(-14, -16, 14, 6, 3), circle(-8, 6, 7), circle(8, 6, 7)), inner = offsetOutline(t, -2.5);
    return [...t, ...(inner ? E(inner) : []), ...face(0, -4, 1.2, 'w')]; } },
  { id: 'donut', name: 'Donut', cat: 'Food', make: () => [circle(0, 0, 17), circle(0, 0, 5.5),
    ...E([curve(Array.from({ length: 16 }, (_, i) => { const a = i * Math.PI / 8, r = i % 2 ? 13.2 : 14.8; return [r * Math.cos(a), r * Math.sin(a)]; })), circle(0, 0, 7.5)]),
    ...E(Array.from({ length: 9 }, (_, i) => { const a = i * 2 * Math.PI / 9 + 0.3, r = 10.5, d = 1.4, t = a + 1.1; return line(r * Math.cos(a) - d * Math.cos(t), r * Math.sin(a) - d * Math.sin(t), r * Math.cos(a) + d * Math.cos(t), r * Math.sin(a) + d * Math.sin(t)); }))] },
  { id: 'onigiri', name: 'Rice ball', cat: 'Food', make: () => [soft([[-17, -13], [17, -13], [0, 16]], 6), ...E(rr(-6.5, -13, 6.5, -4, 1)), ...face(0, 0.5, 1.05)] },
  { id: 'melon', name: 'Watermelon', cat: 'Food', make: () => [path([[-18, 6], [0, 6], [18, 6]], [0, 0, -1]), ...E([arc(0, 6, 15, 180, 360), ell(-9, -3, 0.6, 1.1, 20), ell(9, -3, 0.6, 1.1, -20), ell(-4, -8, 0.6, 1.1), ell(4, -8, 0.6, 1.1)]), ...face(0, 1, 0.95)] },
  { id: 'icecream2', name: 'Ice cream', cat: 'Food', make: () => [...U(circle(0, 7, 11), rr(-12, -1, 12, 4, 2), soft([[-9, -1], [9, -1], [0, -21]], 1.5)),
    ...E([line(-5.2, -5, 3, -13.5), line(5.2, -5, -3, -13.5), line(-1, -1.2, 5.6, -8.5), line(1, -1.2, -5.6, -8.5)]), ...face(0, 8, 1)] },
  { id: 'cupcake2', name: 'Cupcake', cat: 'Food', make: () => [...U(soft([[-11, -2], [11, -2], [8, -18], [-8, -18]], 1.5), circle(-7, 1, 5.5), circle(7, 1, 5.5), circle(0, 4, 7.5), circle(0, 15, 2.8)),
    ...E([line(-4, -3, -3.4, -17), line(4, -3, 3.4, -17), line(0, -3, 0, -17)]), ...eyes(0, 3, 4.2, 1.5), ...smile(0, 1, 1.3), ...blush(0, 0.6, 6.6, 0.8)] },
  { id: 'apple2', name: 'Apple', cat: 'Food', make: () => [curve([[0, 9], [8, 12], [15, 6], [15, -6], [8, -15], [0, -13], [-8, -15], [-15, -6], [-15, 6], [-8, 12]], [0, 5]), path([[1, 11], [9, 19]], [0.5, 0.5]), ...face(0, -1, 1.2)] },
  // ---------- happy faces ----------
  { id: 'cloud2', name: 'Happy cloud', cat: 'Nature', make: () => [...U(circle(-11, 0, 7), circle(-2, 6, 9.5), circle(9, 3, 8), circle(15, -2, 5.5), rr(-17, -7, 19, -1, 2)), ...face(1, -1, 1)] },
  { id: 'sun2', name: 'Happy sun', cat: 'Nature', make: () => [...U(circle(0, 0, 12), ...Array.from({ length: 8 }, (_, i) => rot(ell(0, 15.5, 2.5, 3.8), i * 45))), ...face(0, 0, 1.2)] },
  { id: 'star2', name: 'Happy star', cat: 'Shapes', make: () => [roundCorners([makePolygon(P(0, 0), P(0, 20), 5, 'corner', true, 48, 0)], 2.2) ?? makePolygon(P(0, 0), P(0, 20), 5, 'corner', true, 48, 0), ...face(0, -1, 0.95)] },
  { id: 'heart2', name: 'Happy heart', cat: 'Shapes', make: () => [curve([[0, -18], [-12, -6], [-18, 6], [-14, 15], [-6, 16], [0, 10], [6, 16], [14, 15], [18, 6], [12, -6]], [0, 5]), ...face(0, 2, 1.15)] },
  { id: 'ghost2', name: 'Ghost', cat: 'Seasonal', make: () => [curve([[-12, -14], [-13, 4], [-8, 13], [0, 16], [8, 13], [13, 4], [12, -14], [8, -10], [4, -15], [0, -11], [-4, -15], [-8, -10]], [0, 6]), ...face(0, 3, 1.05, 'o')] },
  { id: 'pumpkin2', name: 'Pumpkin', cat: 'Seasonal', make: () => [...U(ell(-8, 0, 9.5, 12), ell(8, 0, 9.5, 12), ell(0, 0, 10, 13), rot(rr(-2, 10, 2, 18, 1), -12, 0, 12), ell(5, 15, 4, 1.8, 20)),
    ...E([arc(-5, 0, 11, 120, 240), arc(5, 0, 11, -60, 60)]), ...face(0, 0, 1.1, 'w')] },
  { id: 'moon2', name: 'Sleepy moon', cat: 'Nature', make: () => [...minus(circle(0, 0, 17), circle(8, 5, 14)), ...E([arc(-11, 2.5, 2.6, 200, 340), arc(-9.5, -4, 1.9, 205, 335), ell(-13.6, -2.6, 1.8, 1.1)])] },
  { id: 'cactus2', name: 'Cactus', cat: 'Nature', make: () => [...U(rr(-5, -18, 5, 18, 5), rr(-13, -4, 0, 0, 2), rr(-13, -4, -8, 9, 2.5), rr(0, 1, 13, 5, 2), rr(8, 1, 13, 12, 2.5), soft([[-8, -30], [8, -30], [10, -18], [-10, -18]], 1.5)), ...eyes(0, 7, 2.8, 1.35), ...smile(0, 5, 1.2), ...blush(0, 4.6, 3.7, 0.65)] },
  { id: 'mushroom2', name: 'Mushroom', cat: 'Nature', make: () => [...U(path([[18, 4], [-18, 4], [0, 4]], [0.7, 0, 0]), rr(-6, -18, 6, 6, 3.5)), ...E([circle(-8, 9, 2.5), circle(3, 12, 3), circle(10.5, 7.5, 2)]), ...eyes(0, -7, 3, 1.3), ...smile(0, -9, 1.1), ...blush(0, -9.5, 4.2, 0.6)] },
  { id: 'drop2', name: 'Raindrop', cat: 'Nature', make: () => [curve([[0, 20], [8, 4], [11, -6], [6, -14], [0, -16], [-6, -14], [-11, -6], [-8, 4]], [0]), ...face(0, -5, 1.05)] },
];
/** Plain designs these replace in the library */
export const REPLACED = ['cat', 'owl', 'whale', 'turtle', 'fish', 'apple', 'icecream', 'cupcake', 'pumpkin', 'ghost', 'cloud', 'moon', 'drop', 'cactus', 'mushroom'];
