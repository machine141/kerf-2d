import { describe, it, expect } from 'vitest';
import { P, type Point } from '../src/geometry/vec';
import { softenShape } from '../src/geometry/soften';
import { flatten } from '../src/geometry/entity';
import type { Shape } from '../src/model/types';

const poly = (pts: Point[]) => ({ type: 'poly', closed: true, pts }) as Shape;
const near = (s: Shape, p: Point) => { const f = flatten(s, 0.005), q = f.closed ? [...f.pts, f.pts[0]] : f.pts; let best = Infinity; for (let i = 0; i < q.length - 1; i++) { const a = q[i], b = q[i + 1], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1e-12, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)); best = Math.min(best, Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y)); } return best; };
const box = (s: Shape) => { const f = flatten(s, 0.005).pts; return [Math.min(...f.map(p => p.x)), Math.min(...f.map(p => p.y)), Math.max(...f.map(p => p.x)), Math.max(...f.map(p => p.y))]; };

describe('Soften', () => {
  it('rounds the corners of a square to the radius; same size, straight sides stay, few nodes', () => {
    const r = softenShape(poly([P(0, 0), P(40, 0), P(40, 40), P(0, 40)]), 5);
    const s = r.shape!; expect(r.note).toBeUndefined();
    box(s).forEach((v, i) => expect(v).toBeCloseTo([0, 0, 40, 40][i], 1));
    expect(near(s, P(0, 0))).toBeCloseTo(5 * (Math.SQRT2 - 1), 1);    // a radius-5 corner
    expect(near(s, P(20, 0))).toBeLessThan(0.05);                       // the side is still there
    expect((s as any).pts.length).toBeLessThanOrEqual(12);
  });
  it('rounds inside corners too (an L shape), or only outside / only inside', () => {
    const L = poly([P(0, 0), P(40, 0), P(40, 10), P(10, 10), P(10, 40), P(0, 40)]);
    expect(near(softenShape(L, 3).shape!, P(10, 10))).toBeCloseTo(3 * (Math.SQRT2 - 1), 1);
    expect(near(softenShape(L, 3, 'outer').shape!, P(10, 10))).toBeLessThan(0.05);
    expect(near(softenShape(L, 3, 'inner').shape!, P(0, 0))).toBeLessThan(0.05);
  });
  it('warns when a part thinner than twice the radius would be lost', () => {
    const T = poly([P(0, 0), P(40, 0), P(40, 30), P(22, 30), P(22, 60), P(18, 60), P(18, 30), P(0, 30)]);   // 4 mm wide stalk
    expect(softenShape(T, 4).note).toBe('split');
    expect(softenShape(T, 1).note).toBeUndefined();
  });
  it('an open zig-zag line becomes a smooth wave with the same ends', () => {
    const z: Point[] = Array.from({ length: 11 }, (_, i) => P(i * 10, i % 2 ? 8 : 0));
    const s = softenShape({ type: 'poly', closed: false, pts: z } as Shape, 4).shape! as any;
    expect(s.pts[0]).toEqual(P(0, 0)); expect(s.pts[s.pts.length - 1].x).toBeCloseTo(100, 6);
    expect(near(s, P(50, 8))).toBeGreaterThan(1);   // the sharp peaks are rounded off
  });
});
describe('Soften: pointy shapes are fine', () => {
  it('a star gets round tips (not refused as "losing a part")', () => {
    const star: Point[] = []; for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 18 : 40; star.push(P(r * Math.cos(a), r * Math.sin(a))); }
    const r = softenShape(poly(star), 4.6); expect(r.note).toBeUndefined(); expect(r.shape).toBeTruthy();
  });
});
import { planSoften, applyPlan } from '../src/geometry/soften';
describe('Soften: choose the corners', () => {
  it('finds the 4 corners of a square, and rounds only the ones left on', () => {
    const sq = poly([P(0, 0), P(40, 0), P(40, 40), P(0, 40)]), plan = planSoften(sq, 5)!;
    expect(plan.corners.length).toBe(4);
    const iTL = plan.corners.findIndex(c => c.tip.x < 1 && c.tip.y > 39), on = plan.corners.map((_, i) => i !== iTL);
    const s = applyPlan(plan, on)!;
    expect(near(s, P(0, 40))).toBeLessThan(0.05);                        // the top-left corner stays sharp
    expect(near(s, P(40, 0))).toBeCloseTo(5 * (Math.SQRT2 - 1), 1);     // the others are rounded
    expect(near(s, P(20, 0))).toBeLessThan(0.05);
  });
  it('an L shape has 5 outside corners and 1 inside corner', () => {
    const plan = planSoften(poly([P(0, 0), P(40, 0), P(40, 10), P(10, 10), P(10, 40), P(0, 40)]), 3)!;
    expect(plan.corners.filter(c => c.kind === 'out').length).toBe(5); expect(plan.corners.filter(c => c.kind === 'in').length).toBe(1);
    const inner = plan.corners.findIndex(c => c.kind === 'in'), s = applyPlan(plan, plan.corners.map((_, i) => i === inner))!;
    expect(near(s, P(10, 10))).toBeCloseTo(3 * (Math.SQRT2 - 1), 1); expect(near(s, P(0, 0))).toBeLessThan(0.05);
  });
});
describe('Soften: a star with one point kept sharp', () => {
  it('the other points are fully rounded (no spikes left), the kept one stays sharp', () => {
    const star: Point[] = []; for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 18 : 40; star.push(P(rr * Math.cos(a), rr * Math.sin(a))); }
    const plan = planSoften(poly(star), 4)!, top = plan.corners.findIndex(c => Math.hypot(c.tip.x, c.tip.y - 40) < 0.5);
    expect(top).toBeGreaterThanOrEqual(0);
    for (const c of plan.corners) { const v = star.find(q => Math.hypot(q.x - c.tip.x, q.y - c.tip.y) < 0.5); expect(v).toBeTruthy(); }   // every dot sits on a real corner
    const s = applyPlan(plan, plan.corners.map((_, i) => i !== top))!;
    expect(near(s, P(0, 40))).toBeLessThan(0.05);
    for (let i = 2; i < 10; i += 2) { expect(near(s, star[i])).toBeGreaterThan(2); }   // other outer points rounded
    const b = box(s); expect(b[2]).toBeLessThan(40 * Math.cos(Math.PI / 10) - 1);   // nothing sticks out on the right
  });
});
