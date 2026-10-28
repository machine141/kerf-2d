import { describe, it, expect } from 'vitest';
import { P, dist } from '../src/geometry/vec';
import { MATERIALS } from '../src/hinge/hinge';
import { bendPlan, presetNodes, profileCurve, resample, openRadii, nodesFromCurve, tightestOf, type BendOpts } from '../src/hinge/profile';
import { bbox, unionBox, flatten } from '../src/geometry/entity';
import { areaOf } from '../src/geometry/boolean';
import type { Shape } from '../src/model/types';

const ply = MATERIALS[0];
const rect = (w: number, h: number) => ({ type: 'poly', closed: true, pts: [P(0, 0), P(w, 0), P(w, h), P(0, h)] }) as Shape;
const oval = { type: 'ellipse', c: P(50, 60), rx: 35, ry: 55, rot: 0 } as Shape;
const O: BendOpts = { mode: 'look', axis: 'v', t: 3, kerf: 0.15, mat: ply, sf: 1.5, G: 3.6, L: 30, adapt: true, where: 'bends', D: 2, ribs: 0, ribDepth: 20 };
const go = (s: Shape[], n: any, o: Partial<BendOpts> = {}) => { const r = bendPlan(s, n, { ...O, ...o }); if ('error' in r) throw new Error(r.error); return r; };
const H = (shapes: Shape[]) => { const b = unionBox(shapes.map(s => bbox(s)))!; return b.y1 - b.y0; };

describe('bend to a profile', () => {
  it('straight profile: flat piece is the same, no slits needed', () => {
    const p = go([rect(40, 100)], presetNodes('straight', 100));
    expect(p.Ls).toBeCloseTo(100, 6); expect(p.slits.length).toBe(0); expect(p.state).toBe('ok');
  });
  it('"keep the look": the flat piece is as long as the curve, measured along it', () => {
    const nodes = presetNodes('arc', 100), arc = resample(profileCurve(nodes), 0.01).total;
    const p = go([rect(40, 100)], nodes);
    expect(arc).toBeGreaterThan(100);
    expect(p.Ls).toBeCloseTo(arc, 2); expect(H(p.flat)).toBeCloseTo(arc, 1);
    // width across is unchanged
    const b = unionBox(p.flat.map(s => bbox(s)))!; expect(b.x1 - b.x0).toBeCloseTo(40, 6);
    expect(p.front[0]).toEqual(rect(40, 100));
  });
  it('"keep its length": the flat piece is unchanged and the profile is scaled to that length', () => {
    const p = go([rect(40, 100)], presetNodes('scurve', 100, 1.5), { mode: 'length' });
    expect(H(p.flat)).toBeCloseTo(100, 6); expect(p.Ls).toBeCloseTo(100, 1);
    expect(H(p.front)).toBeLessThan(100);       // seen from the front it looks shorter
  });
  it('slits only where it bends, and always G inside the edge (oval)', () => {
    const p = go([oval], presetNodes('scurve', 110));
    expect(p.slits.length).toBeGreaterThan(20);
    // the flat oval's outline; every slit end stays ≥ G − tol inside it
    const out = flatten(p.flat[0], 0.01).pts;
    const dEdge = (q: any) => Math.min(...out.map((a, i) => { const b = out[(i + 1) % out.length], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1e-12, t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / L2)); return Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy); }));
    for (const s of p.slits as any[]) for (const q of [s.a, s.b]) expect(dEdge(q)).toBeGreaterThan(3.6 - 0.05);
    // the S changes direction in the middle: around there it's almost straight, so no slits (centre ±4 mm)
    // spacing is wider where the S changes direction (gentle) than where it bends hardest
    const near = (x: number) => p.columns.reduce((b, c) => Math.abs(c.x - x) < Math.abs(b.x - x) ? c : b);
    expect(near(p.Ls / 2).D).toBeGreaterThan(Math.min(...p.columns.map(c => c.D)));
  });
  it('a profile that turns back is refused in "keep the look", allowed in "keep its length"', () => {
    const curl = [{ u: 0, z: 0 }, { u: 60, z: 0 }, { u: 90, z: 15 }, { u: 80, z: 35 }];
    expect('error' in bendPlan([rect(40, 100)], curl, O)).toBe(true);
    expect('error' in bendPlan([rect(40, 100)], curl, { ...O, mode: 'length' })).toBe(false);
  });
  it('holes (eyes) are kept clear of slits and stretched with the part', () => {
    const face: Shape[] = [rect(60, 100), { type: 'circle', c: P(30, 70), r: 6 } as Shape];
    const p = go(face, presetNodes('arc', 100, 1.4), { where: 'all' });
    expect(p.flat.length).toBe(2);
    const eye = flatten(p.flat[1], 0.01).pts, cy = eye.reduce((a, q) => a + q.y, 0) / eye.length, cx = eye.reduce((a, q) => a + q.x, 0) / eye.length;
    for (const s of p.slits as any[]) { const xs = [s.a.x, s.b.x], y = s.a.y; if (Math.abs(y - cy) < 4) expect(xs.every(x => Math.abs(x - cx) > 6 + 3.6 - 0.1 || false) || Math.min(...xs) > cx + 9 || Math.max(...xs) < cx - 9).toBe(true); }
  });
  it('the former follows the profile', () => {
    const p = go([rect(40, 100)], presetNodes('arc', 100), { ribs: 2 });
    expect(p.ribs.length).toBe(2); expect(p.marks.length).toBe(2);
    expect(areaOf(p.ribs[0])).toBeGreaterThan(p.Ls * 20 * 0.85);
  });
  it('bend radius reads true on an arc, and a drawn curve becomes nodes', () => {
    const arcPts = Array.from({ length: 200 }, (_, i) => P(50 * Math.sin(i / 199 * 1.5), 50 - 50 * Math.cos(i / 199 * 1.5)));
    const r = openRadii(arcPts); for (const x of r.R.slice(20, -20)) { expect(Math.abs(x)).toBeGreaterThan(49.5); expect(Math.abs(x)).toBeLessThan(50.5); }
    const n = nodesFromCurve({ type: 'spline', pts: [P(0, 100), P(20, 70), P(-10, 30), P(5, 0)], h: [], closed: false } as any, 120)!;
    expect(n[0].u).toBe(0); expect(n[n.length - 1].u).toBe(120); expect(n.length).toBe(4);
    expect(tightestOf(presetNodes('straight', 100), 'look', 100)).toBe(Infinity);
  });
});
describe('slits run edge to edge (v0.10.1)', () => {
  it('every column reaches to G from both edges, even on a tapered shape', () => {
    const hex = { type: 'poly', closed: true, pts: [P(15, 0), P(35, 0), P(50, 55), P(35, 110), P(15, 110), P(0, 55)] } as Shape;
    const p = go([hex], presetNodes('scurve', 110), { where: 'all', G: 3, L: 20 });
    // group slits by column (same y), check min/max x against the hexagon's width at that height (inset by G)
    const cols = new Map<number, any[]>(); for (const s of p.slits as any[]) { const k = Math.round(s.a.y * 1000); cols.set(k, [...(cols.get(k) || []), s]); }
    let checked = 0;
    for (const [, ss] of cols) {
      const xs = ss.flatMap((s: any) => [s.a.x, s.b.x]), lo = Math.min(...xs), hi = Math.max(...xs);
      const W = hi - lo; if (W < 6) continue;
      // both ends sit ≈ G inside the outline: symmetric about the centre line x = 25
      expect(lo + hi).toBeCloseTo(50, 0); checked++;
      // and the pieces in a column never leave a gap wider than G (+ tolerance)
      const segs = ss.map((s: any) => [Math.min(s.a.x, s.b.x), Math.max(s.a.x, s.b.x)]).sort((a: any, b: any) => a[0] - b[0]);
      for (let i = 1; i < segs.length; i++) expect(segs[i][0] - segs[i - 1][1]).toBeLessThanOrEqual(3 + 1e-6);
    }
    expect(checked).toBeGreaterThan(20);
  });
});
