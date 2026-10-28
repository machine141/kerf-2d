import { describe, it, expect } from 'vitest';
import { P, dist } from '../src/geometry/vec';
import { trimInfo } from '../src/geometry/trim';
import { prims, flatten } from '../src/geometry/entity';
import type { Shape } from '../src/model/types';

const longest = (s: Shape) => { const f = flatten(s, 0.01).pts; let m = 0; for (let i = 1; i < f.length; i++) m = Math.max(m, dist(f[i], f[i - 1])); return m; };
const vline = (x: number) => prims({ type: 'line', a: P(x, -10), b: P(x, 10) } as Shape);

describe('trim fixes (v0.9.1)', () => {
  it('trimming the far end of an opened path never joins it back to its start', () => {
    // an open path whose start sits exactly on a cutter (as after an earlier trim)
    const pts = Array.from({ length: 41 }, (_, i) => P(i * 5, Math.sin(i / 3) * 4));
    const e = { type: 'poly', closed: false, pts } as Shape;
    const cutters = [...vline(0), ...vline(150)];
    const r: any = trimInfo(e, P(180, Math.sin(36 / 3) * 4), cutters, 'whole');
    expect(r.keep.length).toBe(1);
    const k = r.keep[0]; expect(longest(k)).toBeLessThan(6);
    expect(dist(k.pts[k.pts.length - 1], P(150, Math.sin(30 / 3) * 4))).toBeLessThan(0.5);
  });
  it('segment by segment removes one side and keeps the rest as one path', () => {
    const sq = { type: 'poly', closed: true, pts: [P(0, 0), P(50, 0), P(50, 30), P(0, 30)] } as Shape;
    const r: any = trimInfo(sq, P(25, 0.1), [], 'segments');
    expect(r.keep.length).toBe(1);
    const k = r.keep[0]; expect(k.type).toBe('poly'); expect(k.closed).toBe(false); expect(k.pts.length).toBe(4);
    expect(flatten(r.removed[0]).pts.map((p: any) => [p.x, p.y])).toEqual([[0, 0], [50, 0]]);
  });
  it('segment by segment stops at crossings inside a segment', () => {
    const sq = { type: 'poly', closed: true, pts: [P(0, 0), P(50, 0), P(50, 30), P(0, 30)] } as Shape;
    const r: any = trimInfo(sq, P(25, 0), [...vline(20), ...vline(30)], 'segments');
    const rem = flatten(r.removed[0]).pts; expect(rem[0].x).toBeCloseTo(20, 9); expect(rem[rem.length - 1].x).toBeCloseTo(30, 9);
    expect(r.keep.length).toBe(1); expect(longest(r.keep[0])).toBeLessThanOrEqual(50 + 1e-9);
  });
});
