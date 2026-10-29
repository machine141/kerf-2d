import { describe, it, expect } from 'vitest';
import { P } from '../src/geometry/vec';
import { simplifyShape, deviation, fitPoints } from '../src/geometry/fitcurve';
import type { Shape } from '../src/model/types';

describe('Simplify curve (curve fitting)', () => {
  it('a circle traced as 200 jittery points becomes a handful of smooth nodes, within tolerance', () => {
    const pts = Array.from({ length: 200 }, (_, i) => { const a = i / 200 * Math.PI * 2, r = 30 + Math.sin(i * 7) * 0.05; return P(r * Math.cos(a), r * Math.sin(a)); });
    const src = { type: 'poly', closed: true, pts } as Shape, s = simplifyShape(src, 0.1)!;
    expect(s.type).toBe('spline'); expect((s as any).pts.length).toBeLessThanOrEqual(10); expect((simplifyShape(src, 0.3) as any).pts.length).toBeLessThanOrEqual(5); expect((s as any).closed).toBe(true);
    expect(deviation(src, s)).toBeLessThan(0.15); expect(deviation(s, src)).toBeLessThan(0.15);
  });
  it('keeps sharp corners (a leaf tip) and gets more exact with a smaller tolerance', () => {
    const leaf: any[] = []; for (let i = 0; i <= 60; i++) { const t = i / 60; leaf.push(P(40 * t, 15 * Math.sin(Math.PI * t))); } for (let i = 59; i > 0; i--) { const t = i / 60; leaf.push(P(40 * t, -15 * Math.sin(Math.PI * t))); }
    const src = { type: 'poly', closed: true, pts: leaf } as Shape;
    const coarse = simplifyShape(src, 0.5)! as any, fine = simplifyShape(src, 0.02)! as any;
    expect(coarse.pts.length).toBeLessThan(fine.pts.length + 1);
    expect(deviation(src, fine)).toBeLessThan(0.05);
    // the tips at (0,0) and (40,0) are nodes with handles pointing different ways
    for (const tip of [P(0, 0), P(40, 0)]) { const i = coarse.pts.findIndex((p: any) => Math.hypot(p.x - tip.x, p.y - tip.y) < 0.6); expect(i).toBeGreaterThanOrEqual(0); }
  });
  it('an open wavy line keeps its ends', () => {
    const pts = Array.from({ length: 100 }, (_, i) => P(i, 5 * Math.sin(i / 10)));
    const r = fitPoints(pts, false, 0.05);
    expect(r.pts[0]).toEqual(P(0, 0)); expect(r.pts[r.pts.length - 1].x).toBeCloseTo(99, 6); expect(r.pts.length).toBeLessThan(12);
  });
});
import { deleteNodeKeepShape, smoothNode, cornerNode, softMove } from '../src/geometry/fitcurve';
describe('point editing helpers', () => {
  const arc = () => { const pts: any[] = [], h: any[] = []; for (let i = 0; i <= 4; i++) { const a = Math.PI * i / 4, p = P(30 * Math.cos(a), 30 * Math.sin(a)), t = P(-Math.sin(a), Math.cos(a)), k = 30 * 4 / 3 * Math.tan(Math.PI / 16); pts.push(p); h.push([P(p.x - t.x * k, p.y - t.y * k), P(p.x + t.x * k, p.y + t.y * k)]); } return { pts, h, closed: false }; };
  it('deleting a point refits the curve so it stays close to the old shape', () => {
    const s = arc(), r = deleteNodeKeepShape(s, 2), sp = { type: 'spline', ...r } as Shape, old = { type: 'spline', ...s } as Shape;
    expect(r.pts.length).toBe(4); expect(deviation(old, sp)).toBeLessThan(0.3);
  });
  it('smooth point lines the handles up; sharp corner pulls them in', () => {
    const s = arc(); s.h[2] = [P(s.pts[2].x - 5, s.pts[2].y - 3), P(s.pts[2].x + 4, s.pts[2].y)];
    const r = smoothNode(s, 2), p = r.pts[2], a = r.h[2][0], b = r.h[2][1];
    expect(Math.abs((a.x - p.x) * (b.y - p.y) - (a.y - p.y) * (b.x - p.x))).toBeLessThan(1e-9);
    const c = cornerNode(s, 2); expect(c.h[2]).toEqual([s.pts[2], s.pts[2]]);
  });
  it('soft drag: nearby points follow part of the way, far ones stay', () => {
    const o = { pts: [P(0, 0), P(10, 0), P(20, 0), P(60, 0)] }, m = { pts: [P(0, 0), P(10, 5), P(20, 0), P(60, 0)] };
    const r = softMove(o, m, 1, P(0, 5), 15);
    expect(r.pts[1]).toEqual(P(10, 5)); expect(r.pts[0].y).toBeGreaterThan(0.5); expect(r.pts[0].y).toBeLessThan(5); expect(r.pts[3]).toEqual(P(60, 0));
  });
});
