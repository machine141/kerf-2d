import { describe, it, expect } from 'vitest';
import { P, dist } from '../src/geometry/vec';
import { booleanShapes } from '../src/geometry/boolean';
import { pathLength, segsOf } from '../src/geometry/path';
import type { Shape } from '../src/model/types';

const rect = (x: number, y: number, w: number, h: number) => ({ type: 'poly', closed: true, pts: [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)] }) as Shape;
const circle = (x: number, y: number, r: number) => ({ type: 'circle', c: P(x, y), r }) as Shape;
const ok = (r: any) => { if ('error' in r) throw new Error(r.error); return r.shapes as any[]; };

describe('booleans keep exact lines and arcs', () => {
  it('union of two circles = two true arcs meeting at exact points', () => {
    const [u] = ok(booleanShapes('union', [circle(0, 0, 10), circle(10, 0, 10)]));
    expect(u.type).toBe('poly'); expect(u.pts.length).toBe(2);
    const ys = u.pts.map((p: any) => p.y).sort(); expect(ys[0]).toBeCloseTo(-Math.sqrt(75), 9); expect(ys[1]).toBeCloseTo(Math.sqrt(75), 9);
    for (const p of u.pts) expect(p.x).toBeCloseTo(5, 9);
    // perimeter: two 240° arcs of r10
    expect(pathLength(u)).toBeCloseTo(2 * 10 * (4 * Math.PI / 3), 8);
  });
  it('subtract a circle from a rectangle edge (bite)', () => {
    const [s] = ok(booleanShapes('subtract', [rect(0, 0, 40, 20), circle(20, 20, 5)]));
    const segs = segsOf(s), arcs = segs.filter(g => g.kind === 'arc');
    expect(arcs.length).toBe(1); expect((arcs[0] as any).r).toBeCloseTo(5, 9);
    expect(pathLength(s)).toBeCloseTo(40 + 20 + 20 + 15 * 2 + Math.PI * 5, 8);
  });
  it('subtract a hole fully inside gives outer + hole', () => {
    const r = ok(booleanShapes('subtract', [rect(0, 0, 40, 20), circle(20, 10, 3)]));
    expect(r.length).toBe(2); const c = r.find(s => s.type === 'circle'); expect(c.r).toBeCloseTo(3, 9); expect(dist(c.c, P(20, 10))).toBeLessThan(1e-9);
  });
  it('intersect two rectangles is the exact overlap', () => {
    const [i] = ok(booleanShapes('intersect', [rect(0, 0, 40, 20), rect(30, 10, 40, 20)]));
    const xs = i.pts.map((p: any) => p.x).sort((a: number, b: number) => a - b), ys = i.pts.map((p: any) => p.y).sort((a: number, b: number) => a - b);
    expect(i.pts.length).toBe(4); expect(xs[0]).toBe(30); expect(xs[3]).toBe(40); expect(ys[0]).toBe(10); expect(ys[3]).toBe(20);
  });
  it('union of a rounded rectangle and a circle keeps both radii', () => {
    const rr = { type: 'poly', closed: true, pts: [P(5, 0), P(35, 0), P(40, 5), P(40, 15), P(35, 20), P(5, 20), P(0, 15), P(0, 5)], bulge: [0, Math.tan(Math.PI / 8), 0, Math.tan(Math.PI / 8), 0, Math.tan(Math.PI / 8), 0, Math.tan(Math.PI / 8)] } as Shape;
    const [u] = ok(booleanShapes('union', [rr, circle(40, 10, 6)]));
    const radii = segsOf(u).filter(g => g.kind === 'arc').map(g => +(g as any).r.toFixed(9)).sort();
    expect(radii).toEqual([5, 5, 5, 5, 6]);
  });
  it('no overlap → intersect reports it', () => { expect('error' in booleanShapes('intersect', [rect(0, 0, 10, 10), rect(20, 0, 10, 10)])).toBe(true); });
});

import { ringPlace, ringShapes } from '../src/geometry/ring';
describe('Add a ring', () => {
  const o = { outerD: 10, holeD: 5, overlap: 2 };
  it('snaps to the top midpoint and joins exactly', () => {
    const r = rect(0, 0, 40, 20), pl = ringPlace(r, P(20.3, 26), o, 1);
    expect(pl.B).toEqual(P(20, 20)); expect(pl.C).toEqual(P(20, 23));
    const res: any = ringShapes(r, pl.C, o); const [outline, hole] = res.shapes;
    expect(hole).toEqual({ type: 'circle', c: P(20, 23), r: 2.5 });
    expect(outline.pts.some((p: any) => p.x === 16 && p.y === 20)).toBe(true);
    expect(outline.pts.some((p: any) => p.x === 24 && p.y === 20)).toBe(true);
    expect(pathLength(outline)).toBeCloseTo(40 + 20 + 20 + 32 + 5 * (2 * Math.PI - 2 * Math.acos(3 / 5)), 8);
  });
  it('works on a circle (ring outward from the edge)', () => {
    const pl = ringPlace(circle(0, 0, 20), P(0, 30), o, 1);
    expect(pl.C.x).toBeCloseTo(0, 12); expect(pl.C.y).toBeCloseTo(23, 12);
  });
  it('refuses a too-thin wall', () => { expect('error' in ringShapes(rect(0, 0, 40, 20), P(20, 23), { outerD: 6, holeD: 5, overlap: 2 })).toBe(true); });
});
