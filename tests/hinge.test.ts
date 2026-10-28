import { describe, it, expect } from 'vitest';
import { P, dist } from '../src/geometry/vec';
import { MATERIALS, recommend, minRadius, columnCuts, slitLen, wrapPlan, roundCorners, fillHinge, testStrips, bestPitch, type WrapOpts } from '../src/hinge/hinge';
import { lengthOf, flatten } from '../src/geometry/entity';
import type { Shape } from '../src/model/types';

const ply = MATERIALS[0];
const circle = (r: number) => ({ type: 'circle', c: P(0, 0), r }) as Shape;
const rect = (w: number, h: number) => ({ type: 'poly', closed: true, pts: [P(0, 0), P(w, 0), P(w, h), P(0, h)] }) as Shape;
const stadium = (L: number, r: number) => ({ type: 'poly', closed: true, pts: [P(0, 0), P(L, 0), P(L, 2 * r), P(0, 2 * r)], bulge: [0, 1, 0, 1] }) as Shape;
const base: WrapOpts = { H: 50, t: 3, kerf: 0.15, mat: ply, sf: 1.5, pattern: { D: 2, m: 2, G: 3.6, open: true }, adapt: true, where: 'bends', base: 'none', lid: 'none', tabs: 5, tabW: 10, lip: 5, clearance: 0.1, maxLen: 1000 };
const plan = (s: Shape, o: Partial<WrapOpts> = {}) => { const p = wrapPlan([s], { ...base, ...o }); if ('error' in p) throw new Error(p.error); return p; };

describe('living hinge maths', () => {
  it('recommended pitch bends to the radius with the safety factor', () => {
    for (const R of [15, 25, 50, 125]) {
      const r = recommend(50, 3, 0.15, ply, R); expect(r.ok).toBe(true);
      expect(minRadius(r.D, r.L, 3, 0.15, ply.gamma) * 1.5).toBeLessThanOrEqual(R + 1e-6);
    }
    // gentler curve → wider spacing → fewer cuts
    expect(recommend(50, 3, 0.15, ply, 125).D).toBeGreaterThan(recommend(50, 3, 0.15, ply, 15).D);
    expect(bestPitch(0.5, 40, 3, 0.15, ply, 1.5)).toBeNull();
  });
  it('column slits stay inside the strip with the right bridges', () => {
    const p = { D: 2, m: 2, G: 3, open: true }, H = 40, L = slitLen(H, 2, 3);
    const A = columnCuts(H, p, 'A'), B = columnCuts(H, p, 'B');
    expect(A.length).toBe(2); A.forEach(([a, b]) => { expect(b - a).toBeCloseTo(L, 9); expect(a).toBeGreaterThanOrEqual(3 - 1e-9); expect(b).toBeLessThanOrEqual(H - 3 + 1e-9); });
    expect(A[1][0] - A[0][1]).toBeCloseTo(3, 9);
    expect(B[0][0]).toBe(0); expect(B[B.length - 1][1]).toBe(H);                    // open ends
    for (let i = 1; i < B.length; i++) expect(B[i][0] - B[i - 1][1]).toBeCloseTo(3, 9); // bridges
    const Bc = columnCuts(H, { ...p, open: false }, 'B'); expect(Bc[0][0]).toBeCloseTo(3, 9);
  });
});

describe('wrap a shape', () => {
  it('strip length is the perimeter along the middle of the wood', () => {
    const w = plan(circle(50)); expect(w.total).toBeCloseTo(2 * Math.PI * 51.5, 1);
    expect(w.corners.length).toBe(0); expect(w.state).toBe('ok');
    const strip = w.parts[0].cut[0] as any, xs = strip.pts.map((p: any) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(w.total + 0.15, 2);   // + kerf
  });
  it('sharp corners are found, and rounding them fixes it with the right perimeter', () => {
    const w = plan(rect(100, 50)); expect(w.corners.length).toBe(4); expect(w.state).toBe('bad');
    const r = roundCorners([rect(100, 50)], 10)!; expect(lengthOf(r)).toBeCloseTo(300 - 80 + 2 * Math.PI * 10, 2);
    const w2 = plan(r); expect(w2.corners.length).toBe(0); expect(w2.total).toBeCloseTo(300 - 80 + 2 * Math.PI * 11.5, 1);
  });
  it('only bends get slits; straight stretches stay solid', () => {
    const w = plan(stadium(200, 30), { where: 'bends' });
    // straight sides run from x=0..200 on the shape; seam sits on a straight bit, so check by curvature
    expect(w.columns.length).toBeGreaterThan(20);
    const all = plan(stadium(200, 30), { where: 'all' });
    expect(all.columns.length).toBeGreaterThan(w.columns.length + 20); expect(all.columns.some(c => c.R > 1000)).toBe(true);
    const flat = (p: typeof w) => p.columns.filter(c => c.R > 1000).length;
    expect(flat(w)).toBeLessThan(10);    // only the short run-out past each bend
    expect(flat(all)).toBeGreaterThan(25);
  });
  it('tabs line up with slots sitting t/2 outside the shape', () => {
    const w = plan(circle(60), { base: 'tabs', tabs: 4 });
    const plate = w.parts.find(p => p.name.startsWith('Base'))!;
    const slots = plate.cut.filter(s => s.type === 'poly' && (s as any).pts.length === 4);
    expect(slots.length).toBe(4);
    for (const s of slots as any[]) { const c = P(s.pts.reduce((a: number, p: any) => a + p.x, 0) / 4, s.pts.reduce((a: number, p: any) => a + p.y, 0) / 4); expect(dist(c, P(0, 0))).toBeCloseTo(61.5, 2); }
    // strip has 4 tabs (4 extra rectangles → 16 extra vertices)
    expect((w.parts[0].cut[0] as any).pts.length).toBe(4 + 16);
    // no slit column inside a tab zone
    for (const tx of w.tabs) expect(w.columns.every(c => Math.abs(c.x - tx) >= 5)).toBe(true);
  });
  it('long strips are split into pieces that fit the bed', () => {
    const w = plan(circle(100), { maxLen: 280 });
    const strips = w.parts.filter(p => p.name.startsWith('Strip'));
    expect(strips.length).toBe(Math.ceil(2 * Math.PI * 101.5 / 280));
    const sum = strips.reduce((a, p) => { const xs = (p.cut[0] as any).pts.map((q: any) => q.x); return a + Math.max(...xs) - Math.min(...xs) - 0.15; }, 0);
    expect(sum).toBeCloseTo(w.total, 1);
  });
  it('shelf joint gives a bigger base plus the shelf', () => {
    const w = plan(circle(40), { base: 'shelf' });
    const b = w.parts.find(p => p.name === 'Base')!, sh = w.parts.find(p => p.name.startsWith('Shelf'))!;
    expect(lengthOf(b.cut[0])).toBeCloseTo(2 * Math.PI * (40 + 3 + 5 + 0.075), 2);
    expect(lengthOf(sh.cut[0])).toBeCloseTo(2 * Math.PI * 40.075, 2);
  });
});

describe('hinge inside a shape and test strips', () => {
  it('slits stay at least G inside the shape', () => {
    const s = fillHinge([rect(80, 60)], { D: 2, m: 1, G: 3, open: false }, 20, true);
    expect(s.length).toBeGreaterThan(40);
    for (const l of s as any[]) for (const p of [l.a, l.b]) { expect(p.x).toBeGreaterThanOrEqual(3 - 1e-6); expect(p.x).toBeLessThanOrEqual(77 + 1e-6); expect(p.y).toBeGreaterThanOrEqual(3 - 1e-3); expect(p.y).toBeLessThanOrEqual(57 + 1e-3); }
    const h = fillHinge([circle(30)], { D: 2, m: 1, G: 3, open: false }, 15, false);
    for (const l of h as any[]) for (const p of [l.a, l.b]) expect(dist(p, P(0, 0))).toBeLessThanOrEqual(27 + 1e-3);
  });
  it('test strips get increasing spacing and marker holes', () => {
    const ts = testStrips(3, 0.15, ply); expect(ts.length).toBe(4);
    for (let i = 1; i < 4; i++) expect(ts[i].D).toBeGreaterThan(ts[i - 1].D);
    ts.forEach((x, i) => expect(x.part.cut.filter(s => s.type === 'circle').length).toBe(i + 1));
    void flatten;
  });
});
import { radii, curveOf } from '../src/hinge/hinge';
describe('bend radius measurement', () => {
  it('reads a circle\'s radius evenly all the way round, and finds sharp corners', () => {
    const f = flatten(circle(125)).pts, r = radii(curveOf(f));
    for (const x of r.R) expect(x).toBeGreaterThan(125 * 0.98), expect(x).toBeLessThan(125 * 1.02);
    const sq = radii(curveOf([P(0, 0), P(50, 0), P(50, 50), P(0, 50)]));
    expect(sq.R.filter(x => isFinite(x) && x < 5).length).toBeGreaterThan(0);
    expect(sq.R.filter(x => !isFinite(x)).length).toBeGreaterThan(sq.R.length * 0.8);
  });
});
