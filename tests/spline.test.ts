import { describe, it, expect } from 'vitest';
import { P, dist } from '../src/geometry/vec';
import { autoHandles, flattenSpline, splineSegs, bez, splitSplineAt } from '../src/geometry/spline';
import { exportSVG } from '../src/io/svg';
import { exportDXF, importDXF } from '../src/io/dxf';
import { affEnt, affMove } from '../src/geometry/affine';
import { newDoc } from '../src/model/types';
import { makePolygon } from '../src/tools/draw';

const pts = [P(0, 0), P(20, 15), P(40, 0), P(20, -15)];
const s = { type: 'spline', pts, h: autoHandles(pts, true), closed: true } as any;

describe('splines', () => {
  it('pass through every point and are smooth at each point', () => {
    const f = flattenSpline(s, 0.001);
    for (const p of pts) expect(Math.min(...f.map(q => dist(p, q)))).toBeLessThan(1e-9);
    for (let i = 0; i < pts.length; i++) { const [a, b] = s.h[i], c = pts[i]; expect(Math.abs((a.x - c.x) * (b.y - c.y) - (a.y - c.y) * (b.x - c.x))).toBeLessThan(1e-9); }
  });
  it('adding a point keeps the exact shape', () => {
    const sp = { ...s, ...splitSplineAt(s, 1) }, before = splineSegs(s)[1], after = splineSegs(sp);
    expect(dist(bez(before, 0.25), bez(after[1], 0.5))).toBeLessThan(1e-9);
    expect(dist(bez(before, 0.75), bez(after[2], 0.5))).toBeLessThan(1e-9);
  });
  it('exports as true curves to SVG and as a fine polyline to DXF R12; moves exactly', () => {
    const doc = newDoc(); doc.ents.push({ ...s, id: 'a', layer: 'L1', color: 'ink', w: 0.1 });
    expect(exportSVG(doc)).toMatch(/<path d="M 0 \S+ C /);
    const back = importDXF(exportDXF(doc, { curveTol: 0.01 }));
    expect(back.length).toBe(1); expect(back[0].type).toBe('poly'); expect((back[0] as any).closed).toBe(true);
    const m: any = affEnt(s, affMove(P(5, 5))); expect(m.pts[1]).toEqual(P(25, 20)); expect(m.h[1][0].x).toBeCloseTo(s.h[1][0].x + 5, 12);
  });
});
describe('polygons', () => {
  it('hexagon across flats and corners', () => {
    const h: any = makePolygon(P(0, 0), P(10, 0), 6, 'flat', false, 50, 15);
    const ys = h.pts.map((p: any) => p.y), xs = h.pts.map((p: any) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(20, 9);                       // flat to flat = 20 across x
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(40 / Math.sqrt(3), 9);        // corner to corner
  });
  it('triangle and 5-point star', () => {
    expect((makePolygon(P(0, 0), P(0, 10), 3, 'corner', false, 50, 15) as any).pts.length).toBe(3);
    const st: any = makePolygon(P(0, 0), P(0, 10), 5, 'corner', true, 40, 15);
    expect(st.pts.length).toBe(10); expect(Math.hypot(st.pts[1].x, st.pts[1].y)).toBeCloseTo(4, 9);
  });
});
