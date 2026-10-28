import { describe, it, expect } from 'vitest';
import { P, dist, normA, DEG, parseLength } from '../src/geometry/vec';
import { prims, distPrim, intersect } from '../src/geometry/entity';
import { affEnt, affScale, affRot, affMir } from '../src/geometry/affine';
import { makeSource, contour, connectedGroup, offsetPrim } from '../src/geometry/offset';
import { findRegion } from '../src/geometry/region';
import { trimShape } from '../src/geometry/trim';
import type { Shape } from '../src/model/types';

const line = (x1: number, y1: number, x2: number, y2: number) => ({ type: 'line', a: P(x1, y1), b: P(x2, y2) }) as Shape;
const rect = (x: number, y: number, w: number, h: number) => ({ type: 'poly', closed: true, pts: [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)] }) as Shape;
const circle = (x: number, y: number, r: number) => ({ type: 'circle', c: P(x, y), r }) as Shape;
/** worst |distance-to-source − d| over all result vertices */
const contourErr = (res: { x: number; y: number }[][], src: Shape[], d: number) => {
  const pr = src.flatMap(prims); let w = 0;
  for (const pts of res) for (const p of pts) { let m = Infinity; for (const q of pr) m = Math.min(m, distPrim(p, q)); w = Math.max(w, Math.abs(m - d)); }
  return w;
};
const bboxOf = (pts: { x: number; y: number }[]) => ({ w: Math.max(...pts.map(p => p.x)) - Math.min(...pts.map(p => p.x)), h: Math.max(...pts.map(p => p.y)) - Math.min(...pts.map(p => p.y)) });

describe('units', () => {
  it('parses lengths with units', () => {
    expect(parseLength('20')).toBe(20); expect(parseLength('2cm')).toBe(20); expect(parseLength('1in')).toBe(25.4); expect(parseLength('0.5 inch')).toBe(12.7); expect(parseLength('abc')).toBeNaN();
  });
});

describe('intersections', () => {
  it('line × circle is exact', () => {
    const pts = intersect(prims(line(-10, 0, 10, 0))[0], prims(circle(0, 0, 5))[0]);
    expect(pts.map(p => p.x).sort()).toEqual([-5, 5]);
  });
});

describe('affine', () => {
  it('squashing a circle gives an exact ellipse', () => {
    const e: any = affEnt(circle(0, 0, 15), affScale(P(0, 0), 1, 2 / 3));
    expect(e.type).toBe('ellipse'); expect(e.rx).toBeCloseTo(15, 12); expect(e.ry).toBeCloseTo(10, 12);
  });
  it('mirroring an arc keeps it exact and swaps direction', () => {
    const a: any = affEnt({ type: 'arc', c: P(170, 160), r: 50, a0: Math.PI / 2, a1: Math.PI } as Shape, affMir(P(145, 0), P(145, 1)));
    expect(a.c).toEqual(P(120, 160)); expect(a.r).toBe(50); expect(normA(a.a0)).toBeCloseTo(0, 12); expect(a.a1).toBeCloseTo(Math.PI / 2, 12);
  });
  it('rotation by 90° of a rectangle is exact', () => {
    const r: any = affEnt(rect(0, 0, 40, 20), affRot(P(0, 0), 90 * DEG));
    expect(r.pts[2]).toEqual(P(-20, 40));
  });
});

describe('contour / offset', () => {
  it('circle R20 → R25 outside, R15 inside', () => {
    const src = makeSource([circle(0, 0, 20)]);
    const out = contour(src, 5, 'out', true), inn = contour(src, 5, 'in', true);
    expect(out.length).toBe(1); expect(inn.length).toBe(1);
    expect(contourErr(out, [circle(0, 0, 20)], 5)).toBeLessThan(0.002);
    expect(contourErr(inn, [circle(0, 0, 20)], 5)).toBeLessThan(0.002);
  });
  it('rectangle: round keeps every point 5 mm away; sharp is exactly 50×30', () => {
    const r = rect(0, 0, 40, 20), src = makeSource([r]);
    expect(contourErr(contour(src, 5, 'out', true), [r], 5)).toBeLessThan(0.002);
    const sharp = contour(src, 5, 'out', false); expect(sharp[0].length).toBe(4); expect(bboxOf(sharp[0])).toEqual({ w: 50, h: 30 });
  });
  it('glasses: two lenses + bridge make one outline 4 mm away', () => {
    const parts = [circle(100, 140, 22), circle(156, 140, 22), { type: 'arc', c: P(128, 130), r: Math.hypot(9, 14), a0: Math.atan2(14, 9), a1: Math.atan2(14, -9) } as Shape];
    const res = contour(makeSource(parts), 4, 'out', true);
    expect(res.length).toBe(1); expect(contourErr(res, parts, 4)).toBeLessThan(0.002);
  });
  it('separate touching lines are chained into one shape', () => {
    const ls = [line(0, 0, 30, 0), line(30, 0, 30, 20), line(30, 20, 0, 20), line(0, 20, 0, 0)];
    const g = connectedGroup(ls[0], ls); expect(g.length).toBe(4);
    const res = contour(makeSource(g), 3, 'out', false); expect(res.length).toBe(1); expect(bboxOf(res[0])).toEqual({ w: 36, h: 26 });
  });
  it('single edge offset is an exact parallel line', () => {
    const l = line(400, 100, 460, 120), r: any = offsetPrim(prims(l)[0], 7, P(420, 140));
    expect(distPrim(r.a, prims(l)[0])).toBeCloseTo(7, 9); expect(dist(r.a, r.b)).toBeCloseTo(dist(P(400, 100), P(460, 120)), 9);
  });
});

describe('boundary finding (Closed contour)', () => {
  it('finds the centre square of a # made of crossing lines', () => {
    const hash = [line(0, 10, 30, 10), line(0, 20, 30, 20), line(10, 0, 10, 30), line(20, 0, 20, 30)];
    const r = findRegion(P(15, 15), hash);
    expect(r.ok).toBe(true); expect(r.area).toBeCloseTo(100, 9); expect(bboxOf(r.pts)).toEqual({ w: 10, h: 10 });
  });
  it('reports a gap in an open U shape', () => {
    const u = [line(0, 0, 30, 0), line(30, 0, 30, 20), line(0, 0, 0, 20)];
    const r = findRegion(P(15, 10), u); expect(r.ok).toBe(false); expect(r.reason).toMatch(/gap|boundary/i);
  });
  it('skips an island to find the surrounding boundary', () => {
    const shapes = [rect(0, 0, 100, 60), circle(70, 30, 10)];
    const r = findRegion(P(30, 30), shapes); expect(r.ok).toBe(true); expect(r.area).toBeCloseTo(6000, 6);
  });
  it('region inside a circle crossed by a line', () => {
    const shapes = [circle(0, 0, 20), line(-30, 0, 30, 0)];
    const r = findRegion(P(0, 10), shapes); expect(r.ok).toBe(true); expect(r.area).toBeCloseTo(Math.PI * 400 / 2, 0);
  });
});

describe('trim (Delete Part)', () => {
  const cut = (shapes: Shape[]) => shapes.flatMap(prims);
  it('line trims back to the intersection', () => {
    const r: any = trimShape(line(20, 20, 100, 20), P(85, 20), cut([line(60, 0, 60, 40)]));
    expect(r.length).toBe(1); expect(r[0].a).toEqual(P(20, 20)); expect(r[0].b).toEqual(P(60, 20));
  });
  it('circle becomes the remaining arc', () => {
    const r: any = trimShape(circle(60, 260, 15), P(60, 275), cut([line(30, 260, 90, 260)]));
    expect(r[0].type).toBe('arc'); expect(normA(r[0].a1 - r[0].a0)).toBeCloseTo(Math.PI, 12);
  });
  it('rectangle corner: whole path vs segment mode', () => {
    const r = rect(0, 0, 40, 20), diag = line(30, -5, 45, 10);
    const whole: any = trimShape(r, P(40, 0), cut([diag]), 'whole');
    expect(whole.length).toBe(1); expect(whole[0].type).toBe('poly'); expect(whole[0].closed).toBe(false);
    const segs: any = trimShape(r, P(38, 0), cut([diag]), 'segments');
    // only the bit of the bottom side between the crossing and the corner goes; the rest stays one path
    expect(segs.length).toBe(1); expect(segs[0].type).toBe('poly'); expect(segs[0].closed).toBe(false);
    const ends = [segs[0].pts[0], segs[0].pts[segs[0].pts.length - 1]].map((p: any) => [+p.x.toFixed(6), +p.y.toFixed(6)]).sort();
    expect(ends).toEqual([[35, 0], [40, 0]]);
  });
});
