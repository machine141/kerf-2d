/**
 * Elements library: simple, original outline designs made from exact geometry
 * (lines, true arcs, circles and smooth curves) — ready to cut, resize and turn
 * into key rings. All artwork here is drawn for Kerf 2D (no third-party images).
 */
import { type Point, P, cp } from '../geometry/vec';
import { autoHandles } from '../geometry/spline';
import { booleanShapes } from '../geometry/boolean';
import { affEnt, affScale, affMove, affMir, affRot } from '../geometry/affine';
import { bbox, unionBox, boxCentre } from '../geometry/entity';
import { makePolygon } from '../tools/draw';
import type { Shape } from '../model/types';
import { CUTE, REPLACED } from './cute';

export type ElementCat = 'Shapes' | 'Nature' | 'Animals' | 'Objects' | 'Food' | 'Seasonal';
export const ELEMENT_CATS: ElementCat[] = ['Shapes', 'Nature', 'Animals', 'Objects', 'Food', 'Seasonal'];
export interface Element { id: string; name: string; cat: ElementCat; make: () => Shape[] }

const circle = (x: number, y: number, r: number) => ({ type: 'circle', c: P(x, y), r }) as Shape;
const poly = (pts: [number, number][], closed = true) => ({ type: 'poly', closed, pts: pts.map(([x, y]) => P(x, y)) }) as Shape;
const path = (pts: [number, number][], bulge: number[], closed = true) => ({ type: 'poly', closed, pts: pts.map(([x, y]) => P(x, y)), bulge }) as Shape;
const arc = (x: number, y: number, r: number, a0: number, a1: number) => ({ type: 'arc', c: P(x, y), r, a0: a0 * Math.PI / 180, a1: a1 * Math.PI / 180 }) as Shape;
/** Closed smooth curve through points; listed indices become sharp corners. */
function curve(pts: [number, number][], corners: number[] = [], closed = true): Shape {
  const p = pts.map(([x, y]) => P(x, y)), h = autoHandles(p, closed);
  for (const i of corners) h[i] = [p[i], p[i]];
  return { type: 'spline', pts: p, h, closed } as Shape;
}
const union = (...s: Shape[]) => { const r = booleanShapes('union', s); return 'error' in r ? s : r.shapes; };
const minus = (a: Shape, ...b: Shape[]) => { const r = booleanShapes('subtract', [a, ...b], 0); return 'error' in r ? [a] : r.shapes; };
const mirrorX = (s: Shape) => affEnt(s, affMir(P(0, 0), P(0, 1)));
const rect = (x0: number, y0: number, x1: number, y1: number) => poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
const T8 = Math.tan(Math.PI / 8);
/** rounded rectangle (r = corner radius) */
const rr = (x0: number, y0: number, x1: number, y1: number, r0: number) => { const r = Math.min(r0, (x1 - x0) / 2 - 0.01, (y1 - y0) / 2 - 0.01); return path([[x0 + r, y0], [x1 - r, y0], [x1, y0 + r], [x1, y1 - r], [x1 - r, y1], [x0 + r, y1], [x0, y1 - r], [x0, y0 + r]], [0, T8, 0, T8, 0, T8, 0, T8]); };
const ell = (x: number, y: number, rx: number, ry: number, deg = 0) => ({ type: 'ellipse', c: P(x, y), rx, ry, rot: deg * Math.PI / 180 }) as Shape;
const rot = (s: Shape, deg: number, cx = 0, cy = 0) => affEnt(s, affRot(P(cx, cy), deg * Math.PI / 180));
/** a straight bar of width w from (x0,y0) to (x1,y1) */
const bar = (x0: number, y0: number, x1: number, y1: number, w: number) => { const l = Math.hypot(x1 - x0, y1 - y0) || 1, nx = -(y1 - y0) / l * w / 2, ny = (x1 - x0) / l * w / 2; return poly([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]); };
/** union of shapes / shape lists */
const U = (...a: (Shape | Shape[])[]) => union(...a.flat());
/** first shape minus the rest (always one base shape) */
const cut = (a: Shape | Shape[], ...b: Shape[]) => minus(Array.isArray(a) ? a[0] : a, ...b);
const open = (pts: [number, number][]) => poly(pts, false);

const BASE: Element[] = [
  { id: 'heart', name: 'Heart', cat: 'Shapes', make: () => [curve([[0, -18], [-12, -6], [-18, 6], [-14, 15], [-6, 16], [0, 10], [6, 16], [14, 15], [18, 6], [12, -6]], [0, 5])] },
  { id: 'star', name: 'Star', cat: 'Shapes', make: () => [makePolygon(P(0, 0), P(0, 20), 5, 'corner', true, 42, 0)] },
  { id: 'flower', name: 'Flower', cat: 'Nature', make: () => union(circle(0, 0, 8), ...Array.from({ length: 6 }, (_, i) => circle(11 * Math.cos(i * Math.PI / 3 + Math.PI / 2), 11 * Math.sin(i * Math.PI / 3 + Math.PI / 2), 7.5))) },
  { id: 'daisy', name: 'Daisy', cat: 'Nature', make: () => [...union(...Array.from({ length: 8 }, (_, i) => affEnt(path([[0, 3], [0, 20]], [0.55, 0.55]), affRot(P(0, 0), i * Math.PI / 4))), circle(0, 0, 7)), circle(0, 0, 4)] },
  { id: 'rainbow', name: 'Rainbow', cat: 'Nature', make: () => [path([[-20, 0], [-8, 0], [8, 0], [20, 0]], [0, -1, 0, 1]), arc(0, 0, 16, 0, 180), arc(0, 0, 12, 0, 180)] },
  { id: 'cloud', name: 'Cloud', cat: 'Nature', make: () => union(circle(-11, 0, 7), circle(-2, 6, 9.5), circle(9, 3, 8), circle(15, -2, 5.5), poly([[-15, -7], [17, -7], [17, -2], [-15, -2]])) },
  { id: 'bowtie', name: 'Bow tie', cat: 'Objects', make: () => union(poly([[-19, 11], [-4, 4], [-4, -4], [-19, -11]]), poly([[19, 11], [4, 4], [4, -4], [19, -11]]), path([[-5, -6], [5, -6], [5, 6], [-5, 6]], [0, 0.15, 0, 0.15])) },
  { id: 'flame', name: 'Fire', cat: 'Nature', make: () => [curve([[0, 22], [5, 12], [12, 5], [12, -7], [6, -15], [0, -17], [-6, -15], [-12, -7], [-11, 4], [-6, 9], [-6, 3], [-2, 8]], [0, 9])] },
  { id: 'bolt', name: 'Lightning', cat: 'Shapes', make: () => [poly([[4, 20], [-10, -2], [-1, -2], [-5, -20], [10, 4], [1, 4]])] },
  { id: 'leaf', name: 'Leaf', cat: 'Nature', make: () => [path([[-18, 0], [18, 0]], [0.42, 0.42]), poly([[-18, 0], [-23, -4]], false)] },
  { id: 'moon', name: 'Moon', cat: 'Nature', make: () => minus(circle(0, 0, 17), circle(8, 5, 14)) },
  { id: 'drop', name: 'Raindrop', cat: 'Nature', make: () => [curve([[0, 20], [8, 4], [11, -6], [6, -14], [0, -16], [-6, -14], [-11, -6], [-8, 4]], [0])] },
  { id: 'paw', name: 'Paw', cat: 'Animals', make: () => [curve([[0, -4], [7, -6], [11, -12], [7, -17], [0, -16], [-7, -17], [-11, -12], [-7, -6]]), circle(-12, 2, 4.5), circle(-5, 9, 4.8), circle(5, 9, 4.8), circle(12, 2, 4.5)] },
  { id: 'house', name: 'House', cat: 'Objects', make: () => [poly([[-15, -16], [15, -16], [15, 4], [19, 4], [0, 19], [-19, 4], [-15, 4]]), poly([[-4, -16], [4, -16], [4, -4], [-4, -4]], false)] },
  { id: 'tree', name: 'Tree', cat: 'Nature', make: () => [poly([[0, 20], [11, 8], [6, 8], [14, -3], [8, -3], [16, -13], [3, -13], [3, -20], [-3, -20], [-3, -13], [-16, -13], [-8, -3], [-14, -3], [-6, 8], [-11, 8]])] },
  { id: 'fish', name: 'Fish', cat: 'Animals', make: () => [...union(curve([[-14, 0], [-4, 9], [8, 7], [14, 0], [8, -7], [-4, -9]], [0]), poly([[-12, 0], [-21, 9], [-19, 0], [-21, -9]])), circle(7, 2, 1.6)] },
  { id: 'butterfly', name: 'Butterfly', cat: 'Animals', make: () => union(curve([[0, 2], [-8, 14], [-17, 15], [-18, 6], [-9, 1]]), curve([[0, -1], [-6, -2], [-13, -8], [-11, -14], [-3, -9]]), mirrorX(curve([[0, 2], [-8, 14], [-17, 15], [-18, 6], [-9, 1]])), mirrorX(curve([[0, -1], [-6, -2], [-13, -8], [-11, -14], [-3, -9]])), path([[-1.5, -12], [1.5, -12], [1.5, 12], [-1.5, 12]], [0, 1, 0, 1])) },
  { id: 'crown', name: 'Crown', cat: 'Objects', make: () => [poly([[-18, -12], [18, -12], [18, -7], [20, 12], [10, 2], [0, 15], [-10, 2], [-20, 12], [-18, -7]])] },
  { id: 'note', name: 'Music note', cat: 'Objects', make: () => union(curve([[-9, -18], [-2, -16], [1, -12], [-3, -9], [-10, -10], [-12, -14]]), poly([[-1.5, -13], [1.5, -13], [1.5, 18], [-1.5, 18]]), curve([[1.5, 18], [9, 12], [11, 4], [8, 8], [1.5, 11]], [0, 4], true)) },
  { id: 'apple', name: 'Apple', cat: 'Food', make: () => [curve([[0, 9], [8, 12], [15, 6], [15, -6], [8, -15], [0, -13], [-8, -15], [-15, -6], [-15, 6], [-8, 12]], [0, 5]), path([[1, 11], [9, 19]], [0.5, 0.5])] },
  { id: 'bubble', name: 'Speech bubble', cat: 'Shapes', make: () => union(path([[-16, -6], [16, -6], [20, -2], [20, 12], [16, 16], [-16, 16], [-20, 12], [-20, -2]], [0, Math.tan(Math.PI / 8), 0, Math.tan(Math.PI / 8), 0, Math.tan(Math.PI / 8), 0, Math.tan(Math.PI / 8)]), poly([[-10, -5], [-2, -5], [-14, -16]])) },
  { id: 'arrow', name: 'Arrow', cat: 'Shapes', make: () => [poly([[-20, -5], [4, -5], [4, -12], [20, 0], [4, 12], [4, 5], [-20, 5]])] },
  { id: 'gem', name: 'Gem', cat: 'Shapes', make: () => [poly([[-18, 6], [-10, 14], [10, 14], [18, 6], [0, -18]]), poly([[-18, 6], [18, 6]], false)] },
  { id: 'hexagon', name: 'Hexagon', cat: 'Shapes', make: () => [makePolygon(P(0, 0), P(20, 0), 6, 'corner', false, 50, 0)] },
  // ---- v0.8.2 additions ----
  { id: 'tag', name: 'Tag blank', cat: 'Shapes', make: () => [rr(-20, -10, 20, 10, 4), circle(-14, 0, 2.5)] },
  { id: 'roundtag', name: 'Round blank', cat: 'Shapes', make: () => [circle(0, 0, 20), circle(0, 14, 2.5)] },
  { id: 'shield', name: 'Shield', cat: 'Shapes', make: () => [curve([[0, -20], [-10, -12], [-15, 0], [-15, 15], [-7, 16], [0, 19], [7, 16], [15, 15], [15, 0], [10, -12]], [0, 3, 5, 7])] },
  { id: 'puzzle', name: 'Puzzle piece', cat: 'Shapes', make: () => cut(U(rect(-12, -12, 12, 12), circle(0, 15, 4.5), circle(15, 0, 4.5)), circle(-9, 0, 4.5), circle(0, -9, 4.5)) },
  { id: 'sun', name: 'Sun', cat: 'Nature', make: () => U(circle(0, 0, 10), ...Array.from({ length: 12 }, (_, i) => rot(poly([[-2.6, 9], [2.6, 9], [0, 19]]), i * 30))) },
  { id: 'clover', name: 'Clover', cat: 'Nature', make: () => U(...[45, 135, 225, 315].map(a => U(circle(-3.8, 10.5, 4.4), circle(3.8, 10.5, 4.4), poly([[-7.9, 8.8], [7.9, 8.8], [0, 0.5]])).map(s => rot(s, a))), circle(0, 0, 2.6), bar(0, 0, 5, -19, 2.4)) },
  { id: 'tulip', name: 'Tulip', cat: 'Nature', make: () => U(curve([[0, 2], [-7, 4], [-9, 12], [-8, 20], [-4, 15], [0, 20], [4, 15], [8, 20], [9, 12], [7, 4]], [3, 4, 5, 6, 7]), bar(0, 3, 0, -20, 2), ell(-5, -10, 6.5, 2.3, -45)) },
  { id: 'cactus', name: 'Cactus', cat: 'Nature', make: () => U(rr(-4, -18, 4, 18, 4), rr(-12, -4, 0, 0, 2), rr(-12, -4, -7, 10, 2.5), rr(0, 1, 12, 5, 2), rr(7, 1, 12, 13, 2.5), poly([[-7, -30], [7, -30], [9, -18], [-9, -18]]), rect(-10, -18, 10, -15)) },
  { id: 'mushroom', name: 'Mushroom', cat: 'Nature', make: () => [...U(path([[18, 4], [-18, 4], [0, 4]], [0.7, 0, 0]), rr(-5, -18, 5, 6, 3)), circle(-8, 9, 2.5), circle(3, 12, 3), circle(10, 7.5, 2)] },
  { id: 'mountain', name: 'Mountains', cat: 'Nature', make: () => [poly([[-20, -12], [20, -12], [12, 4], [8, 0], [-2, 15], [-11, 1], [-14, 5]]), open([[2, 9], [0, 6.5], [-2, 9.5], [-4, 6.5], [-5.86, 9]])] },
  { id: 'cat', name: 'Cat', cat: 'Animals', make: () => [...U(ell(0, -2, 16, 13), poly([[-15, 2], [-12, 17], [-3, 10]]), poly([[15, 2], [12, 17], [3, 10]])), ell(-6, 0, 2, 3), ell(6, 0, 2, 3), poly([[-1.8, -5], [1.8, -5], [0, -7.2]])] },
  { id: 'owl', name: 'Owl', cat: 'Animals', make: () => [...U(ell(0, -3, 13, 16), poly([[-12, 5], [-11, 17], [-4, 10]]), poly([[12, 5], [11, 17], [4, 10]])), circle(-5.5, 4, 4.5), circle(5.5, 4, 4.5), poly([[-1.6, -1], [1.6, -1], [0, -4.5]])] },
  { id: 'whale', name: 'Whale', cat: 'Animals', make: () => [...U(curve([[-15, 0], [-8, 7], [4, 9], [13, 5], [16, -2], [9, -8], [-4, -8], [-12, -4]]), poly([[-14, -1], [-23, 8], [-19, 0], [-23, -6]])), circle(9, 1.5, 1.3)] },
  { id: 'bird', name: 'Bird', cat: 'Animals', make: () => [...U(ell(-1, 0, 13, 8, 10), circle(10, 7, 6), poly([[15, 9], [21, 7], [15, 5]]), poly([[-12, -1], [-21, -7], [-19, -1], [-21, 4]])), circle(11.5, 8.5, 1.1)] },
  { id: 'turtle', name: 'Turtle', cat: 'Animals', make: () => [...U(ell(0, 0, 12, 9), circle(15, 0, 4), ell(-8, -8, 3, 3.8, 30), ell(8, -8, 3, 3.8, -30), ell(-8, 8, 3, 3.8, -30), ell(8, 8, 3, 3.8, 30), poly([[-11, -1.5], [-17, 0], [-11, 1.5]])), makePolygon(P(0, 0), P(4.5, 0), 6, 'corner', false, 50, 0)] },
  { id: 'bone', name: 'Dog bone', cat: 'Animals', make: () => U(rect(-12, -3.5, 12, 3.5), circle(-13, 4, 4.5), circle(-13, -4, 4.5), circle(13, 4, 4.5), circle(13, -4, 4.5)) },
  { id: 'anchor', name: 'Anchor', cat: 'Objects', make: () => [...U(circle(0, 15, 4.5), rect(-1.6, -15, 1.6, 12), rr(-8, 5, 8, 8.2, 1.5), cut(circle(0, -1, 16), circle(0, -1, 13), rect(-20, -1, 20, 30)), poly([[-18, -1], [-11, -1], [-14.5, 4]]), poly([[18, -1], [11, -1], [14.5, 4]])), circle(0, 15, 2.3)] },
  { id: 'umbrella', name: 'Umbrella', cat: 'Objects', make: () => U(cut(path([[18, 0], [-18, 0], [0, 0]], [1, 0, 0]), circle(-12, -2, 6.2), circle(0, -2, 6.2), circle(12, -2, 6.2)), rect(-1.2, -16, 1.2, 1), cut(circle(-4, -16, 5.2), circle(-4, -16, 2.8), rect(-12, -16, 4, 0)), rect(-0.8, 17, 0.8, 21)) },
  { id: 'key', name: 'Key', cat: 'Objects', make: () => [...U(circle(-12, 0, 8), rect(-5, -2, 20, 2), rect(12, -7, 15, -2), rect(17, -5.5, 20, -2)), circle(-12, 0, 4)] },
  { id: 'padlock', name: 'Padlock', cat: 'Objects', make: () => [...U(rr(-12, -16, 12, 4, 3), cut(circle(0, 4, 9), circle(0, 4, 5.5), rect(-12, -10, 12, 4)), rect(-9, 0, -5.5, 4.5), rect(5.5, 0, 9, 4.5)), ...U(circle(0, -4, 2.6), poly([[-1.4, -5], [1.4, -5], [2.2, -11], [-2.2, -11]]))] },
  { id: 'bulb', name: 'Light bulb', cat: 'Objects', make: () => [...U(circle(0, 6, 12), poly([[-6.5, -3.5], [6.5, -3.5], [5, -10], [-5, -10]]), rr(-5, -17, 5, -9.5, 1.5)), open([[-3, -3.5], [-3, 4], [-1, 7], [1, 4], [3, 7], [3, -3.5]])] },
  { id: 'trophy', name: 'Trophy', cat: 'Objects', make: () => U(path([[-11, 18], [0, 18], [11, 18]], [0, 0, -0.9]), cut(circle(-11, 13, 5), circle(-11, 13, 3), rect(-11, 5, 0, 20)), cut(circle(11, 13, 5), circle(11, 13, 3), rect(0, 5, 11, 20)), rect(-1.6, -6, 1.6, 10), rr(-8, -12, 8, -5.5, 1.5), rect(-10, -14, 10, -11.5)) },
  { id: 'rocket', name: 'Rocket', cat: 'Objects', make: () => [...U(curve([[0, 22], [6, 12], [7, -6], [4, -12], [-4, -12], [-7, -6], [-6, 12]], [0, 3, 4]), poly([[6, -1], [12, -11], [12, -16], [5, -10]]), poly([[-6, -1], [-12, -11], [-12, -16], [-5, -10]]), poly([[-3, -11], [3, -11], [0, -19]])), circle(0, 6, 3.2)] },
  { id: 'plane', name: 'Plane', cat: 'Objects', make: () => [path([[0, 20], [2, 16], [2, 5], [19, -2], [19, -5], [2, -1], [1.5, -12], [7, -17], [7, -19], [0, -16], [-7, -19], [-7, -17], [-1.5, -12], [-2, -1], [-19, -5], [-19, -2], [-2, 5], [-2, 16]], [0.25, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.25])] },
  { id: 'boat', name: 'Sailboat', cat: 'Objects', make: () => U(poly([[-18, -8], [18, -8], [12, -16], [-12, -16]]), rect(-0.8, -8.5, 0.8, 19), poly([[0.8, 17], [14, -5], [0.8, -5]]), poly([[-0.8, 13], [-0.8, -5], [-12, -5]])) },
  { id: 'car', name: 'Car', cat: 'Objects', make: () => [...U(path([[-20, -4], [20, -4], [20, 3], [16, 5.5], [8, 6.5], [3, 13], [-9, 13], [-14, 6.5], [-20, 5]], [0, 0, 0, 0, 0, 0, 0, 0, 0]), circle(-11, -5, 4.5), circle(11, -5, 4.5)), poly([[-8, 7.5], [-1, 7.5], [-1, 11], [-7, 11]]), poly([[1, 7.5], [6.5, 7.5], [2.5, 11], [1, 11]]), circle(-11, -5, 1.6), circle(11, -5, 1.6)] },
  { id: 'balloon', name: 'Balloon', cat: 'Objects', make: () => [...U(curve([[0, -12], [-8, -6], [-12, 4], [-9, 14], [0, 18], [9, 14], [12, 4], [8, -6]]), poly([[0, -11], [-2.6, -15.5], [2.6, -15.5]])), curve([[0, -15.5], [-2, -18.5], [1.5, -21.5], [-1, -25]], [], false)] },
  { id: 'bell', name: 'Bell', cat: 'Seasonal', make: () => [...U(curve([[0, 16], [6, 14], [9, 8], [10, -2], [15, -10], [-15, -10], [-10, -2], [-9, 8], [-6, 14]], [4, 5]), circle(0, -12, 3.5), circle(0, 17, 3.2)), circle(0, 17, 1.5)] },
  { id: 'controller', name: 'Game pad', cat: 'Objects', make: () => [curve([[-18, -10], [-20, 0], [-15, 8], [-7, 8], [0, 7], [7, 8], [15, 8], [20, 0], [18, -10], [12, -11], [7, -5], [0, -5], [-7, -5], [-12, -11]]), ...U(rect(-13.5, 0, -6.5, 2.4), rect(-11.2, -2.3, -8.8, 4.7)), circle(9, 4.2, 1.5), circle(12.5, 0.7, 1.5), circle(9, -2.8, 1.5), circle(5.5, 0.7, 1.5)] },
  { id: 'pencil', name: 'Pencil', cat: 'Objects', make: () => [path([[-20, -3.5], [10, -3.5], [18, 0], [10, 3.5], [-20, 3.5]], [0, 0, 0, 0, 0.6]), open([[10, -3.5], [10, 3.5]]), open([[-15, -3.5], [-15, 3.5]]), open([[15, -1.1], [15, 1.1]])] },
  { id: 'icecream', name: 'Ice cream', cat: 'Food', make: () => [...U(poly([[-9, 0], [9, 0], [0, -22]]), circle(-5, 4, 6.5), circle(5, 4, 6.5), circle(0, 11, 7)), open([[-6, -3], [4.5, -11.5]]), open([[6, -3], [-4.5, -11.5]])] },
  { id: 'cupcake', name: 'Cupcake', cat: 'Food', make: () => [...U(poly([[-11, -2], [11, -2], [8, -18], [-8, -18]]), circle(-8, 1, 5), circle(8, 1, 5), circle(-3.5, 5, 6), circle(3.5, 5, 6), circle(0, 9.5, 5), circle(0, 16, 3)), open([[-4, -2.5], [-3.5, -17.5]]), open([[0, -2.5], [0, -17.5]]), open([[4, -2.5], [3.5, -17.5]])] },
  { id: 'pear', name: 'Pear', cat: 'Food', make: () => [...U(curve([[0, -16], [9, -13], [11, -4], [6, 3], [4, 11], [0, 14], [-4, 11], [-6, 3], [-11, -4], [-9, -13]]), bar(0, 13, 2, 20, 1.6), ell(5.5, 17, 4, 1.8, 25)), circle(-3.5, -8, 1.2)] },
  { id: 'pumpkin', name: 'Pumpkin', cat: 'Seasonal', make: () => [...U(ell(-8, 0, 9, 12), ell(8, 0, 9, 12), ell(0, 0, 9, 13), rot(rr(-2, 10, 2, 18, 1), -12, 0, 12)), poly([[-9, 2], [-3, 2], [-6, 6.5]]), poly([[3, 2], [9, 2], [6, 6.5]]), poly([[-10, -4], [10, -4], [7, -9], [4, -6], [0, -9.5], [-4, -6], [-7, -9]])] },
  { id: 'ghost', name: 'Ghost', cat: 'Seasonal', make: () => [curve([[-12, -14], [-12, 4], [-8, 13], [0, 16], [8, 13], [12, 4], [12, -14], [8, -10], [4, -15], [0, -11], [-4, -15], [-8, -10]], [0, 6]), ell(-4.5, 4, 2, 3), ell(4.5, 4, 2, 3), ell(0, -3, 2.2, 2.6)] },
  { id: 'snowflake', name: 'Snowflake', cat: 'Seasonal', make: () => U(circle(0, 0, 3), ...Array.from({ length: 6 }, (_, i) => [bar(0, 0, 0, 19, 2.2), bar(0, 10, 5, 15, 1.8), bar(0, 10, -5, 15, 1.8), bar(0, 4.5, 3.2, 7.7, 1.6), bar(0, 4.5, -3.2, 7.7, 1.6)].map(s => rot(s, i * 60))).flat()) },
  { id: 'snowman', name: 'Snowman', cat: 'Seasonal', make: () => [...U(circle(0, -10, 10), circle(0, 4.5, 7.5), circle(0, 15, 5.5), rect(-6.5, 19, 6.5, 20.5), rect(-4, 20, 4, 26)), circle(-2, 16, 0.9), circle(2, 16, 0.9), circle(0, 6.5, 1.1), circle(0, 2.5, 1.1), circle(0, -6, 1.3), circle(0, -11, 1.3)] },
  { id: 'bauble', name: 'Bauble', cat: 'Seasonal', make: () => [...U(circle(0, -3, 16), rect(-4, 11, 4, 17), circle(0, 19.5, 3.2)), circle(0, 19.5, 1.6), makePolygon(P(0, -3), P(0, 6), 5, 'corner', true, 42, 0)] },
  { id: 'gift', name: 'Gift', cat: 'Seasonal', make: () => [...U(rect(-13, -16, 13, 4), rect(-15, 3.5, 15, 9), ell(-5.5, 12.5, 6, 3.5, 25), ell(5.5, 12.5, 6, 3.5, -25)), open([[0, -16], [0, 9]])] },
];

/** The library: the cute set first, then the plain designs it doesn't replace. */
export const ELEMENTS: Element[] = [...CUTE, ...BASE.filter(e => !REPLACED.includes(e.id))];

/** An element's shapes scaled so the longest side is `size` mm, centred on `at`. */
export function placeElement(el: Element, size: number, at: Point): Shape[] {
  const raw = el.make().filter(Boolean);
  const b = unionBox(raw.map(s => bbox(s)))!, c = boxCentre(b), k = size / Math.max(1e-9, Math.max(b.x1 - b.x0, b.y1 - b.y0));
  const A = affScale(P(0, 0), k, k), M = affMove(P(at.x - c.x * k, at.y - c.y * k));
  return raw.map(s => { const t = affEnt(affEnt(s, A), M) as any; if (t.pts) t.pts = t.pts.map(cp); return t as Shape; });
}
