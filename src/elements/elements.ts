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

export interface Element { id: string; name: string; make: () => Shape[] }

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

export const ELEMENTS: Element[] = [
  { id: 'heart', name: 'Heart', make: () => [curve([[0, -18], [-12, -6], [-18, 6], [-14, 15], [-6, 16], [0, 10], [6, 16], [14, 15], [18, 6], [12, -6]], [0, 5])] },
  { id: 'star', name: 'Star', make: () => [makePolygon(P(0, 0), P(0, 20), 5, 'corner', true, 42, 0)] },
  { id: 'flower', name: 'Flower', make: () => union(circle(0, 0, 8), ...Array.from({ length: 6 }, (_, i) => circle(11 * Math.cos(i * Math.PI / 3 + Math.PI / 2), 11 * Math.sin(i * Math.PI / 3 + Math.PI / 2), 7.5))) },
  { id: 'daisy', name: 'Daisy', make: () => [...union(...Array.from({ length: 8 }, (_, i) => affEnt(path([[0, 3], [0, 20]], [0.55, 0.55]), affRot(P(0, 0), i * Math.PI / 4))), circle(0, 0, 7)), circle(0, 0, 4)] },
  { id: 'rainbow', name: 'Rainbow', make: () => [path([[-20, 0], [-8, 0], [8, 0], [20, 0]], [0, -1, 0, 1]), arc(0, 0, 16, 0, 180), arc(0, 0, 12, 0, 180)] },
  { id: 'cloud', name: 'Cloud', make: () => union(circle(-11, 0, 7), circle(-2, 6, 9.5), circle(9, 3, 8), circle(15, -2, 5.5), poly([[-15, -7], [17, -7], [17, -2], [-15, -2]])) },
  { id: 'bowtie', name: 'Bow tie', make: () => union(poly([[-19, 11], [-4, 4], [-4, -4], [-19, -11]]), poly([[19, 11], [4, 4], [4, -4], [19, -11]]), path([[-5, -6], [5, -6], [5, 6], [-5, 6]], [0, 0.15, 0, 0.15])) },
  { id: 'flame', name: 'Fire', make: () => [curve([[0, 22], [5, 12], [12, 5], [12, -7], [6, -15], [0, -17], [-6, -15], [-12, -7], [-11, 4], [-6, 9], [-6, 3], [-2, 8]], [0, 9])] },
  { id: 'bolt', name: 'Lightning', make: () => [poly([[4, 20], [-10, -2], [-1, -2], [-5, -20], [10, 4], [1, 4]])] },
  { id: 'leaf', name: 'Leaf', make: () => [path([[-18, 0], [18, 0]], [0.42, 0.42]), poly([[-18, 0], [-23, -4]], false)] },
  { id: 'moon', name: 'Moon', make: () => minus(circle(0, 0, 17), circle(8, 5, 14)) },
  { id: 'drop', name: 'Raindrop', make: () => [curve([[0, 20], [8, 4], [11, -6], [6, -14], [0, -16], [-6, -14], [-11, -6], [-8, 4]], [0])] },
  { id: 'paw', name: 'Paw', make: () => [curve([[0, -4], [7, -6], [11, -12], [7, -17], [0, -16], [-7, -17], [-11, -12], [-7, -6]]), circle(-12, 2, 4.5), circle(-5, 9, 4.8), circle(5, 9, 4.8), circle(12, 2, 4.5)] },
  { id: 'house', name: 'House', make: () => [poly([[-15, -16], [15, -16], [15, 4], [19, 4], [0, 19], [-19, 4], [-15, 4]]), poly([[-4, -16], [4, -16], [4, -4], [-4, -4]], false)] },
  { id: 'tree', name: 'Tree', make: () => [poly([[0, 20], [11, 8], [6, 8], [14, -3], [8, -3], [16, -13], [3, -13], [3, -20], [-3, -20], [-3, -13], [-16, -13], [-8, -3], [-14, -3], [-6, 8], [-11, 8]])] },
  { id: 'fish', name: 'Fish', make: () => [...union(curve([[-14, 0], [-4, 9], [8, 7], [14, 0], [8, -7], [-4, -9]], [0]), poly([[-12, 0], [-21, 9], [-19, 0], [-21, -9]])), circle(7, 2, 1.6)] },
  { id: 'butterfly', name: 'Butterfly', make: () => union(curve([[0, 2], [-8, 14], [-17, 15], [-18, 6], [-9, 1]]), curve([[0, -1], [-6, -2], [-13, -8], [-11, -14], [-3, -9]]), mirrorX(curve([[0, 2], [-8, 14], [-17, 15], [-18, 6], [-9, 1]])), mirrorX(curve([[0, -1], [-6, -2], [-13, -8], [-11, -14], [-3, -9]])), path([[-1.5, -12], [1.5, -12], [1.5, 12], [-1.5, 12]], [0, 1, 0, 1])) },
  { id: 'crown', name: 'Crown', make: () => [poly([[-18, -12], [18, -12], [18, -7], [20, 12], [10, 2], [0, 15], [-10, 2], [-20, 12], [-18, -7]])] },
  { id: 'note', name: 'Music note', make: () => union(curve([[-9, -18], [-2, -16], [1, -12], [-3, -9], [-10, -10], [-12, -14]]), poly([[-1.5, -13], [1.5, -13], [1.5, 18], [-1.5, 18]]), curve([[1.5, 18], [9, 12], [11, 4], [8, 8], [1.5, 11]], [0, 4], true)) },
  { id: 'apple', name: 'Apple', make: () => [curve([[0, 9], [8, 12], [15, 6], [15, -6], [8, -15], [0, -13], [-8, -15], [-15, -6], [-15, 6], [-8, 12]], [0, 5]), path([[1, 11], [9, 19]], [0.5, 0.5])] },
  { id: 'bubble', name: 'Speech bubble', make: () => union(path([[-16, -6], [16, -6], [20, -2], [20, 12], [16, 16], [-16, 16], [-20, 12], [-20, -2]], [0, Math.tan(Math.PI / 8), 0, Math.tan(Math.PI / 8), 0, Math.tan(Math.PI / 8), 0, Math.tan(Math.PI / 8)]), poly([[-10, -5], [-2, -5], [-14, -16]])) },
  { id: 'arrow', name: 'Arrow', make: () => [poly([[-20, -5], [4, -5], [4, -12], [20, 0], [4, 12], [4, 5], [-20, 5]])] },
  { id: 'gem', name: 'Gem', make: () => [poly([[-18, 6], [-10, 14], [10, 14], [18, 6], [0, -18]]), poly([[-18, 6], [18, 6]], false)] },
  { id: 'hexagon', name: 'Hexagon', make: () => [makePolygon(P(0, 0), P(20, 0), 6, 'corner', false, 50, 0)] },
];

/** An element's shapes scaled so the longest side is `size` mm, centred on `at`. */
export function placeElement(el: Element, size: number, at: Point): Shape[] {
  const raw = el.make().filter(Boolean);
  const b = unionBox(raw.map(s => bbox(s)))!, c = boxCentre(b), k = size / Math.max(1e-9, Math.max(b.x1 - b.x0, b.y1 - b.y0));
  const A = affScale(P(0, 0), k, k), M = affMove(P(at.x - c.x * k, at.y - c.y * k));
  return raw.map(s => { const t = affEnt(affEnt(s, A), M) as any; if (t.pts) t.pts = t.pts.map(cp); return t as Shape; });
}
