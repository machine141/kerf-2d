import { describe, it, expect } from 'vitest';
import { P, dist, type Point } from '../src/geometry/vec';
import { computeHinge, BRUSH_DEFAULTS, type HingeEnv } from '../src/hinge/brush';
import type { HingeMark } from '../src/model/types';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
const env: HingeEnv = { lines: [{ pts: rect(0, 0, 120, 60), closed: true }] };
const set = BRUSH_DEFAULTS;
const dir = (s: Point[]) => { const a = s[0], b = s[s.length - 1], l = dist(a, b) || 1; return P((b.x - a.x) / l, (b.y - a.y) / l); };
const allPts = (sl: Point[][]) => sl.flat();

describe('Hinge brush', () => {
  it('a stroke along the part gives slits across it, kept clear of the edges', () => {
    const marks: HingeMark[] = [{ kind: 'brush', pattern: 'straight', pts: [P(20, 30), P(100, 30)], r: 20 }];
    const [a] = computeHinge(marks, env, set, P(60, 30));
    expect(a.slits.length).toBeGreaterThan(40);
    for (const s of a.slits) expect(Math.abs(dir(s).x)).toBeLessThan(0.05);           // across the stroke (vertical)
    for (const p of allPts(a.slits)) { expect(p.y).toBeGreaterThan(set.edge - 0.01); expect(p.y).toBeLessThan(60 - set.edge + 0.01); }
    // rows a pitch apart
    const xs = [...new Set(a.slits.map(s => +s[0].x.toFixed(2)))].sort((p, q) => p - q);
    expect(xs[1] - xs[0]).toBeCloseTo(set.pitch, 1);
  });
  it('paint outside the part makes no slits', () => {
    const [a] = computeHinge([{ kind: 'brush', pattern: 'straight', pts: [P(-40, 30), P(-80, 30)], r: 10 }], env, set, P(0, 0)).concat([undefined as any]);
    expect(a).toBeUndefined();
  });
  it('a fold line across a corner: slits run along the line, only in the corner band', () => {
    const marks: HingeMark[] = [{ kind: 'fold', pattern: 'fold', a: P(0, 30), b: P(30, 60), w: 8 }];
    const [a] = computeHinge(marks, env, set, P(0, 0));
    expect(a.slits.length).toBeGreaterThan(3);
    for (const s of a.slits) { const d = dir(s); expect(Math.abs(Math.abs(d.x) - Math.SQRT1_2)).toBeLessThan(0.05); }
  });
  it('circles: slits are arcs round the centre', () => {
    const marks: HingeMark[] = [{ kind: 'brush', pattern: 'rings', pts: [P(60, 30)], r: 25, c: P(60, 30) }];
    const [a] = computeHinge(marks, env, set, P(60, 30));
    expect(a.slits.length).toBeGreaterThan(10);
    for (const s of a.slits) { const r0 = dist(s[0], P(60, 30)); for (const p of s) expect(Math.abs(dist(p, P(60, 30)) - r0)).toBeLessThan(0.05); }
  });
  it('overlaps: different colours give way (earlier wins, with a solid strip); Paint over makes the new one win', () => {
    const m1: HingeMark = { kind: 'brush', pattern: 'straight', pts: [P(20, 30), P(70, 30)], r: 20 };
    const m2: HingeMark = { kind: 'brush', pattern: 'wavy', pts: [P(50, 30), P(100, 30)], r: 20 };
    const [a, b] = computeHinge([m1, m2], env, set, P(0, 0));
    const maxX = Math.max(...allPts(a.slits).map(p => p.x));
    expect(maxX).toBeGreaterThan(85);                         // the first keeps all its area (stroke to 70 + radius 20)
    let gap = Infinity; for (const p of allPts(a.slits)) for (const q of allPts(b.slits)) gap = Math.min(gap, dist(p, q));
    expect(gap).toBeGreaterThan(set.bridge * 0.9);            // a solid strip between the two patterns
    const [c, d] = computeHinge([m1, { ...m2, over: true }], env, set, P(0, 0));
    let gap2 = Infinity; for (const p of allPts(c.slits)) for (const q of allPts(d.slits)) gap2 = Math.min(gap2, dist(p, q));
    expect(gap2).toBeGreaterThan(set.bridge * 0.9);
    expect(Math.min(...allPts(d.slits).map(p => p.x))).toBeLessThan(35);   // the new paint took the overlap
  });
  it('same colour over the same place does not cut twice', () => {
    const m1: HingeMark = { kind: 'brush', pattern: 'straight', pts: [P(20, 30), P(70, 30)], r: 20 };
    const res = computeHinge([m1, { ...m1 }], env, set, P(0, 0));
    expect(res.length).toBe(1);
  });
  it('the eraser takes paint away', () => {
    const m1: HingeMark = { kind: 'brush', pattern: 'straight', pts: [P(20, 30), P(100, 30)], r: 20 };
    const [a] = computeHinge([m1, { kind: 'erase', pts: [P(60, 0), P(60, 60)], r: 10 }], env, set, P(0, 0));
    expect(allPts(a.slits).some(p => p.x > 52 && p.x < 68)).toBe(false);
  });
  it('a clicked long area bends along its length', () => {
    const [a] = computeHinge([{ kind: 'area', pattern: 'straight', pts: rect(10, 20, 110, 40) }], { lines: [{ pts: rect(10, 20, 110, 40), closed: true }] }, set, P(0, 0));
    for (const s of a.slits) expect(Math.abs(dir(s).x)).toBeLessThan(0.05);   // slits across (vertical) → bends along x
  });
  it('wavy slits wiggle but stay between their neighbours', () => {
    const [a] = computeHinge([{ kind: 'brush', pattern: 'wavy', pts: [P(20, 30), P(100, 30)], r: 20 }], env, set, P(0, 0));
    const s = a.slits.find(x => x.length > 10)!; const xs = s.map(p => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(set.pitch * 0.3);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(set.pitch * 0.7);
  });
  it('holes stay clear: no slits inside the middle of a donut, by area click or by brush', () => {
    const circ = (r: number) => Array.from({ length: 90 }, (_, i) => P(60 + r * Math.cos(i * Math.PI / 45), 60 + r * Math.sin(i * Math.PI / 45)));
    const donut: HingeEnv = { lines: [{ pts: circ(45), closed: true }, { pts: circ(12), closed: true }] };
    const ring = (sl: Point[][]) => sl.flat().map(p => dist(p, P(60, 60)));
    const [a] = computeHinge([{ kind: 'area', pattern: 'rings', pts: circ(45), at: P(60, 90), c: P(60, 60) }], donut, set, P(60, 60));
    expect(Math.min(...ring(a.slits))).toBeGreaterThan(12 + set.edge - 0.1);
    const [b] = computeHinge([{ kind: 'brush', pattern: 'straight', pts: [P(20, 60), P(100, 60)], r: 20 }], donut, set, P(60, 60));
    expect(Math.min(...ring(b.slits))).toBeGreaterThan(12 + set.edge - 0.1);
    expect(b.slits.length).toBeGreaterThan(20);
  });
});
