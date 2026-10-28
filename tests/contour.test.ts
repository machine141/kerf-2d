import { describe, it, expect } from 'vitest';
import { P } from '../src/geometry/vec';
import { prims } from '../src/geometry/entity';
import { makeSource, contour, type Side } from '../src/geometry/offset';
import { offsetGeos, refit } from '../src/geometry/boolean';
import { trimInfo } from '../src/geometry/trim';
import { segsOf, pathLength } from '../src/geometry/path';
import type { Shape } from '../src/model/types';

const rect = (x: number, y: number, w: number, h: number) => ({ type: 'poly', closed: true, pts: [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)] }) as Shape;
const B = Math.tan(Math.PI / 8);
const rrect = { type: 'poly', closed: true, pts: [P(5, 0), P(35, 0), P(40, 5), P(40, 15), P(35, 20), P(5, 20), P(0, 15), P(0, 5)], bulge: [0, B, 0, B, 0, B, 0, B] } as Shape;
const exact = (shapes: Shape[], d: number, side: Side, round = true) => {
  const geos = offsetGeos(shapes.flatMap(s => prims(s)), [d]);
  return contour(makeSource(shapes), d, side, round).map(p => refit(p, geos)) as any[];
};

describe('contours are exact lines and arcs, not thousands of segments', () => {
  it('rectangle outside, round corners: 4 lines + 4 R3 arcs', () => {
    const [c] = exact([rect(0, 0, 40, 20)], 3, 'out');
    const segs = segsOf(c); expect(segs.length).toBe(8);
    expect(segs.filter(s => s.kind === 'arc').every(s => Math.abs((s as any).r - 3) < 1e-9)).toBe(true);
    expect(pathLength(c)).toBeCloseTo(120 + 2 * Math.PI * 3, 9);
  });
  it('rectangle outside, sharp corners: exact 46 × 26 rectangle', () => {
    const [c] = exact([rect(0, 0, 40, 20)], 3, 'out', false);
    expect(c.pts.length).toBe(4); expect(c.pts.map((p: any) => p.x).sort((a: number, b: number) => a - b)).toEqual([-3, -3, 43, 43]);
  });
  it('rounded rectangle inside by 2: R3 corners, perimeter 80 + 6π', () => {
    const [c] = exact([rrect], 2, 'in');
    const segs = segsOf(c); expect(segs.length).toBe(8);
    expect(segs.filter(s => s.kind === 'arc').map(s => +(s as any).r.toFixed(9))).toEqual([3, 3, 3, 3]);
    expect(pathLength(c)).toBeCloseTo(80 + 6 * Math.PI, 9);
  });
  it('circle contour is a circle', () => {
    const [c] = exact([{ type: 'circle', c: P(10, 10), r: 8 } as Shape], 2, 'out');
    expect(c).toEqual({ type: 'circle', c: P(10, 10), r: 10 });
  });
  it('trimming a curved part of a contour removes the whole curve between the crossings', () => {
    const [c] = exact([rrect], 2, 'in');               // corner arc centred (35,5) r3
    const cut = prims({ type: 'line', a: P(36, -5), b: P(36, 25) } as Shape);
    const r: any = trimInfo(c, P(37.9, 4), cut);
    expect('error' in r).toBe(false);
    const rm = r.removed[0], segs = segsOf(rm);           // the removed piece: rest of that arc, the right side and the next arc, from x=36 to x=36
    expect(segs.length).toBe(3); expect(segs[0].kind).toBe('arc'); expect(segs[2].kind).toBe('arc');
  });
});
