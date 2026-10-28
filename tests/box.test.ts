import { describe, it, expect } from 'vitest';
import { P } from '../src/geometry/vec';
import { boxParts, boxLayout, fingerCount, type BoxOpts } from '../src/box/box';

const inside = (pts: { x: number; y: number }[], p: { x: number; y: number }) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c; } return c; };
const base: BoxOpts = { w: 100, d: 60, h: 50, inside: false, t: 3, finger: 10, kerf: 0, clearance: 0, lid: true, layout: 'net', gap: 5 };
const get = (o: BoxOpts, n: string) => boxParts(o).find(p => p.name === n)!;

describe('finger-jointed box', () => {
  it('odd finger counts', () => { expect(fingerCount(100, 10) % 2).toBe(1); expect(fingerCount(20, 10)).toBe(3); });
  it('front and bottom interlock: every finger position belongs to exactly one of them', () => {
    const F = get(base, 'Front'), B = get(base, 'Bottom'), n = fingerCount(100, 10), s = 100 / n;
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * s, f = inside(F.pts, P(x, 1.5)), b = inside(B.pts, P(x, 1.5));
      expect(f !== b).toBe(true);
    }
  });
  it('front and side interlock up the corner edge', () => {
    const F = get(base, 'Front'), Lf = get(base, 'Left'), n = fingerCount(50, 10), s = 50 / n;
    for (let i = 0; i < n; i++) { const y = (i + 0.5) * s; expect(inside(F.pts, P(1.5, y)) !== inside(Lf.pts, P(base.d - 1.5, y))).toBe(true); }
  });
  it('each 3-way corner cube belongs to exactly one panel', () => {
    const F = get(base, 'Front'), Lf = get(base, 'Left'), B = get(base, 'Bottom');
    const owners = [inside(F.pts, P(1.5, 1.5)), inside(Lf.pts, P(base.d - 1.5, 1.5)), inside(B.pts, P(1.5, 1.5))].filter(Boolean).length;
    expect(owners).toBe(1);
  });
  it('inside sizes add the material; kerf makes parts bigger by the kerf', () => {
    const F = get({ ...base, inside: true }, 'Front'); expect(F.w).toBe(106); expect(F.h).toBe(56);
    const k = get({ ...base, kerf: 0.2 }, 'Front'), xs = k.pts.map(p => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(100.2, 6);
  });
  it('open box has 5 parts with plain top edges; layout gives named closed paths', () => {
    expect(boxParts({ ...base, lid: false }).length).toBe(5);
    const lay = boxLayout(base); expect(lay.map(p => p.name)).toEqual(['Bottom', 'Front', 'Back', 'Left', 'Right', 'Top']);
    expect(lay.every(p => (p.shape as any).closed)).toBe(true);
  });
});
describe('box layout', () => {
  for (const layout of ['net', 'rows'] as const) it(`${layout}: parts never overlap and keep the gap`, () => {
    const lay = boxLayout({ ...base, layout, kerf: 0.15 }), bb = lay.map(p => { const xs = (p.shape as any).pts.map((q: any) => q.x), ys = (p.shape as any).pts.map((q: any) => q.y); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; });
    for (let i = 0; i < bb.length; i++) for (let j = i + 1; j < bb.length; j++) {
      const a = bb[i], b = bb[j], gx = Math.max(b.x0 - a.x1, a.x0 - b.x1), gy = Math.max(b.y0 - a.y1, a.y0 - b.y1);
      expect(Math.max(gx, gy)).toBeGreaterThan(4);
    }
  });
});
