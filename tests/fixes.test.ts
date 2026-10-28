import { describe, it, expect } from 'vitest';
import { P } from '../src/geometry/vec';
import { prims } from '../src/geometry/entity';
import { trimShape, trimInfo } from '../src/geometry/trim';
import { arc3 } from '../src/geometry/arcs';
import { joinPieces } from '../src/geometry/path';
import type { Shape } from '../src/model/types';

const rect = (x: number, y: number, w: number, h: number) => ({ type: 'poly', closed: true, pts: [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)] }) as Shape;
const cut = (shapes: Shape[]) => shapes.flatMap(prims);
const arcEnds = (a: any) => [P(a.c.x + a.r * Math.cos(a.a0), a.c.y + a.r * Math.sin(a.a0)), P(a.c.x + a.r * Math.cos(a.a1), a.c.y + a.r * Math.sin(a.a1))];

describe('trim never deletes a closed shape whole', () => {
  // rectangular glasses: bridge arc touches each lens once
  const L = rect(0, 0, 40, 30), R = rect(60, 0, 40, 30), bridge = arc3(P(40, 20), P(60, 20), P(50, 25))!;
  it('one crossing → refused, shape kept', () => {
    const info = trimInfo(L, P(40, 10), cut([bridge, R]), 'whole', { pts: arcEnds(bridge), tol: 0.05 });
    expect('error' in info).toBe(true);
    expect(trimShape(L, P(40, 10), cut([bridge, R]))).toEqual([L]);
  });
  it('no crossings → refused (use Delete instead)', () => {
    expect('error' in trimInfo(rect(0, 0, 10, 10), P(5, 0), [])).toBe(true);
    expect('error' in trimInfo({ type: 'circle', c: P(0, 0), r: 5 } as Shape, P(5, 0), [])).toBe(true);
  });
  it('two bridge arcs (one stopping 0.02 mm short) trim the lens edge between them', () => {
    const top = arc3(P(40, 22), P(60, 22), P(50, 26))!, bot = arc3(P(40.02, 8), P(60, 8), P(50, 4))!;
    const touch = { pts: [...arcEnds(top), ...arcEnds(bot)], tol: 0.05 };
    const r: any = trimInfo(L, P(40, 15), cut([top, bot]), 'whole', touch);
    expect('error' in r).toBe(false);
    expect(r.keep.length).toBe(1); expect(r.keep[0].closed).toBe(false);
    const rm = r.removed[0]; // the removed piece runs from y=8 to y=22 on x=40
    expect(rm.type).toBe('line'); expect(Math.min(rm.a.y, rm.b.y)).toBeCloseTo(8, 9); expect(Math.max(rm.a.y, rm.b.y)).toBeCloseTo(22, 9);
    // without the touch tolerance the short arc is not a crossing → refused
    expect('error' in trimInfo(L, P(40, 15), cut([top, bot]), 'whole', { pts: arcEnds(top), tol: 0.05 })).toBe(true);
  });
  it('removed preview for a circle is the complement of what is kept', () => {
    const r: any = trimInfo({ type: 'circle', c: P(0, 0), r: 10 } as Shape, P(0, 10), cut([{ type: 'line', a: P(-20, 0), b: P(20, 0) } as Shape]));
    expect(r.keep[0].a0).toBeCloseTo(r.removed[0].a1, 12); expect(r.keep[0].a1).toBeCloseTo(r.removed[0].a0, 12);
  });
});

describe('Make Path closes tiny gaps', () => {
  const sides = (g: number) => [
    { pts: [P(0, 0), P(40, 0)], bulge: [0] }, { pts: [P(40, 0), P(40, 30)], bulge: [0] },
    { pts: [P(40, 30), P(0, 30)], bulge: [0] }, { pts: [P(0, 30), P(0, g)], bulge: [0] }];
  it('0.02 mm gap is closed with tolerance 0.05', () => {
    const rep = { gapsClosed: 0, maxGap: 0 }, j = joinPieces(sides(0.02), 0.05, rep);
    expect(j.length).toBe(1); expect(j[0].closed).toBe(true); expect(j[0].pts.length).toBe(4);
    expect(rep.gapsClosed).toBe(1); expect(rep.maxGap).toBeCloseTo(0.02, 9);
  });
  it('exact tolerance leaves it open', () => { const j = joinPieces(sides(0.02), 1e-6); expect(j[0].closed).toBe(false); });
  it('pieces in any order and direction', () => {
    const s = sides(0); const j = joinPieces([s[2], { pts: [P(40, 0), P(0, 0)], bulge: [0] }, s[3], s[1]], 0.05);
    expect(j.length).toBe(1); expect(j[0].closed).toBe(true);
  });
});
