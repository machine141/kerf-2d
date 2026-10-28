import { describe, it, expect } from 'vitest';
import { P, dist } from '../src/geometry/vec';
import { cornerArcPath, cornerAll, unfillet, cornerPath, vertexCorner } from '../src/geometry/corner';
import { segsOf, pathLength } from '../src/geometry/path';

describe('fillets next to arcs and re-filleting', () => {
  // road (0,0)→(10,0), bump of R10 over the top to (30,0), road on to (40,0)
  const road = { pts: [P(0, 0), P(10, 0), P(30, 0), P(40, 0)], bulge: [0, -1, 0], closed: false };
  it('line running onto an arc: fillet is tangent to both', () => {
    expect(vertexCorner(road, 1)?.curved).toBe(true);
    const r: any = cornerArcPath(road, 1, 2);
    expect('error' in r).toBe(false);
    const segs = segsOf(r), f: any = segs[1];
    expect(f.kind).toBe('arc'); expect(f.r).toBeCloseTo(2, 9);
    const cx = 20 - Math.sqrt(140);
    expect(f.c.x).toBeCloseTo(cx, 9); expect(f.c.y).toBeCloseTo(2, 9);
    expect(r.pts[1].x).toBeCloseTo(cx, 9); expect(r.pts[1].y).toBeCloseTo(0, 12);
    expect(dist(r.pts[2], P(20, 0))).toBeCloseTo(10, 9);              // second tangent point lies on the bump
    expect(dist(f.c, P(20, 0))).toBeCloseTo(12, 9);                  // fillet circle touches the bump from outside
    const bump: any = segs[2]; expect(bump.kind).toBe('arc'); expect(bump.r).toBeCloseTo(10, 9);
  });
  it('an existing fillet can be changed to a new size', () => {
    const rect = { pts: [P(0, 0), P(40, 0), P(40, 20), P(0, 20)], closed: true };
    const f5 = cornerAll(rect, 5, 'fillet').path, k = segsOf(f5).findIndex(s => s.kind === 'arc');
    const u = unfillet(f5, k)!; expect(u.r).toBeCloseTo(5, 9);
    const f8: any = cornerPath(u.path, u.i, 8, 'fillet');
    const loss = (r: number) => 2 * r - Math.PI * r / 2;
    expect(pathLength(f8)).toBeCloseTo(120 - 3 * loss(5) - loss(8), 9);
    expect(f8.pts.length).toBe(8);
  });
  it('too large is refused', () => { expect('error' in cornerArcPath(road, 1, 30)).toBe(true); });
});
