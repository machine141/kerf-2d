import { describe, it, expect } from 'vitest';
import { P } from '../src/geometry/vec';
import { affEnt, apA } from '../src/geometry/affine';
import { arrayTransforms, type ArrayOpts } from '../src/tools/array';
import type { Shape } from '../src/model/types';

const base: ArrayOpts = { type: 'grid', cols: 3, rows: 1, dx: 20, dy: 15, count: 6, angle: 360, rotate: true, scalePct: 0, sym: '1' };
const tri = { type: 'poly', closed: true, pts: [P(0, 0), P(10, 0), P(0, 5)] } as Shape;   // asymmetric: shows mirroring
const C = P(10 / 3, 5 / 3);

describe('array / pattern', () => {
  it('grid: 3 columns at 20 mm', () => {
    const T = arrayTransforms(base, C, C); expect(T.length).toBe(2);
    expect(T.map(A => apA(A, C).x - C.x)).toEqual([20, 40]);
  });
  it('grid 3 × 2 with 4-way symmetry fills all four quarters, mirrored', () => {
    const T = arrayTransforms({ ...base, rows: 2, sym: '4' }, C, C);
    expect(T.length).toBe(5 * 3 - 1);
    const left = T.find(A => Math.abs(apA(A, C).x - (C.x - 20)) < 1e-9 && Math.abs(apA(A, C).y - C.y) < 1e-9)!;
    const t: any = affEnt(tri, left); expect(t.pts[1].x).toBeCloseTo(2 * C.x - 10 - 20, 9);  // the long leg now points left
  });
  it('size change: each copy 10% smaller than the one before, about its own centre', () => {
    const T = arrayTransforms({ ...base, cols: 4, scalePct: -10 }, C, C);
    const len = (A: any) => { const s: any = affEnt(tri, A); return Math.hypot(s.pts[1].x - s.pts[0].x, s.pts[1].y - s.pts[0].y); };
    expect(T.map(len).map(v => +v.toFixed(9))).toEqual([9, 8.1, 7.29]);
    expect(apA(T[2], C).x).toBeCloseTo(C.x + 60, 9);
  });
  it('circular: 6 round a full turn = 5 copies, 60° apart; 2-way doubles them mirrored', () => {
    const c = P(50, 0), T = arrayTransforms({ ...base, type: 'circ' }, C, c);
    expect(T.length).toBe(5);
    const p1 = apA(T[0], C), ang = Math.atan2(p1.y - c.y, p1.x - c.x) - Math.atan2(C.y - c.y, C.x - c.x);
    expect(((ang * 180 / Math.PI) + 360) % 360).toBeCloseTo(60, 9);
    expect(arrayTransforms({ ...base, type: 'circ', sym: '2' }, C, c).length).toBe(10);
  });
});
