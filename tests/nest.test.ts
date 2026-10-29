import { describe, it, expect } from 'vitest';
import ClipperLib from 'clipper-lib';
import { P, type Point } from '../src/geometry/vec';
import { nestNow, placeTransform, type NestJob, toIP, rng } from '../src/nest/nest';
import { findParts, nestShape } from '../src/nest/parts';
import type { Entity } from '../src/model/types';

const L = ClipperLib;
const rect = (x: number, y: number, w: number, h: number): Point[] => [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)];
const circ = (c: Point, r: number, n = 48): Point[] => Array.from({ length: n }, (_, i) => P(c.x + r * Math.cos(i * 2 * Math.PI / n), c.y + r * Math.sin(i * 2 * Math.PI / n)));
const ent = (id: string, pts: Point[], extra: any = {}): Entity => ({ id, layer: 'L1', color: 'ink', w: 0.1, type: 'poly', closed: true, pts, ...extra } as any);
const ap = (A: any, p: Point) => P(A.a * p.x + A.b * p.y + A.e, A.c * p.x + A.d * p.y + A.f);

/** the real outlines where the layout puts them */
function placedOutlines(job: NestJob, res: ReturnType<typeof nestNow>) {
  return res.placed.map(pl => job.shapes[pl.shape].raw.map(q => q.map(p => ap(placeTransform(P(0, 0), pl.angle, pl.at), p))));
}
/** smallest distance between two placed parts (0 if they overlap) */
function minGap(a: Point[][], b: Point[][]): number {
  const c = new L.Clipper(), out = new L.Paths();
  c.AddPaths(a.map(toIP), L.PolyType.ptSubject, true); c.AddPaths(b.map(toIP), L.PolyType.ptClip, true);
  c.Execute(L.ClipType.ctIntersection, out, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero);
  if ((out as any[]).some(q => Math.abs(L.Clipper.Area(q)) > 1e3)) return 0;
  let best = Infinity;
  const segD = (p: Point, s: Point, e: Point) => { const dx = e.x - s.x, dy = e.y - s.y, L2 = dx * dx + dy * dy || 1e-12, t = Math.max(0, Math.min(1, ((p.x - s.x) * dx + (p.y - s.y) * dy) / L2)); return Math.hypot(s.x + dx * t - p.x, s.y + dy * t - p.y); };
  for (const pa of a) for (const pb of b) { for (const p of pa) for (let i = 0; i < pb.length; i++) best = Math.min(best, segD(p, pb[i], pb[(i + 1) % pb.length])); for (const p of pb) for (let i = 0; i < pa.length; i++) best = Math.min(best, segD(p, pa[i], pa[(i + 1) % pa.length])); }
  return best;
}
function checkLayout(job: NestJob, res: ReturnType<typeof nestNow>, gap: number) {
  const outs = placedOutlines(job, res);
  for (const o of outs) for (const q of o) for (const p of q) { expect(p.x).toBeGreaterThan(job.margin - 0.02); expect(p.y).toBeGreaterThan(job.margin - 0.02); expect(p.x).toBeLessThan(job.W - job.margin + 0.02); expect(p.y).toBeLessThan(job.H - job.margin + 0.02); }
  let worst = Infinity;
  for (let i = 0; i < outs.length; i++) for (let k = i + 1; k < outs.length; k++) worst = Math.min(worst, minGap(outs[i], outs[k]));
  if (outs.length > 1) expect(worst).toBeGreaterThan(gap - 0.05);
  return worst;
}
const shapeOf = (polys: Point[][], gap: number) => nestShape({ ids: [], polys }, gap);

describe('Nesting engine', () => {
  it('30 key rings fit on an A4 sheet, none touching, all inside the margin', () => {
    const gap = 2, ring = shapeOf([circ(P(0, 0), 15)], gap);
    const job: NestJob = { shapes: [ring], counts: [30], W: 297, H: 210, margin: 5, gap, angles: [0] };
    const res = nestNow(job);
    expect(res.placed.length).toBe(30); expect(res.missing[0]).toBe(0);
    const g = checkLayout(job, res, gap); expect(g).toBeLessThan(gap + 0.6);   // packed close, not just spread out
  });
  it('fill the sheet: squares 20 mm, gap 2, margin 5 on 100 × 100 → 4 × 4', () => {
    const gap = 2, sq = shapeOf([rect(0, 0, 20, 20)], gap);
    const job: NestJob = { shapes: [sq], counts: [Infinity], W: 100, H: 100, margin: 5, gap, angles: [0] };
    const res = nestNow(job);
    // room = 90 mm: 4 squares + 3 gaps = 86 ≤ 90; 5 would need 108
    expect(res.placed.length).toBe(16);
    checkLayout(job, res, gap);
  });
  it('turning lets long parts fit', () => {
    const gap = 2, bar = shapeOf([rect(0, 0, 80, 10)], gap);
    const job: NestJob = { shapes: [bar], counts: [6], W: 60, H: 100, margin: 2, gap, angles: [0] };
    expect(nestNow(job).placed.length).toBe(0);
    const job2 = { ...job, angles: [0, Math.PI / 2] }, res = nestNow(job2);
    expect(res.placed.length).toBe(4);   // 4 × 10 + 3 × 2 = 46 ≤ 56 across, 80 ≤ 96 up; a 5th would need 58
    checkLayout(job2, res, gap);
  });
  it('L shapes interlock (true shape, not boxes)', () => {
    const gap = 1, Lsh = shapeOf([[P(0, 0), P(40, 0), P(40, 10), P(10, 10), P(10, 40), P(0, 40)]], gap);
    const job: NestJob = { shapes: [Lsh], counts: [Infinity], W: 100, H: 100, margin: 0, gap, angles: [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2] };
    const res = nestNow(job);
    // boxes alone would only fit 2 × 2 = 4
    expect(res.placed.length).toBeGreaterThan(5);
    checkLayout(job, res, gap);
  });
  it('keeps clear of things already on the sheet', () => {
    const gap = 2, sq = shapeOf([rect(0, 0, 20, 20)], gap);
    const block = rect(0, 0, 60, 100);
    const fixed = (ClipperLib as any) && (() => { const co = new L.ClipperOffset(2, 25), out = new L.Paths(); co.AddPath(toIP(block), L.JoinType.jtRound, L.EndType.etClosedPolygon); co.Execute(out, gap / 2 * 1000); return out; })();
    const job: NestJob = { shapes: [sq], counts: [Infinity], W: 100, H: 100, margin: 0, gap, angles: [0], fixed };
    const res = nestNow(job);
    expect(res.placed.length).toBe(4);   // the 38 mm strip right of the block: one column of 4
    for (const o of placedOutlines(job, res)) for (const q of o) for (const p of q) expect(p.x).toBeGreaterThan(60 + gap - 0.05);
  });
  it('mixed parts: biggest first, every part placed when there is room; try-harder never worse than its run', () => {
    const gap = 2, a = shapeOf([rect(0, 0, 50, 30)], gap), b = shapeOf([circ(P(0, 0), 12)], gap), c = shapeOf([[P(0, 0), P(30, 0), P(15, 26)]], gap);
    const job: NestJob = { shapes: [a, b, c], counts: [3, 6, 6], W: 200, H: 150, margin: 5, gap, angles: [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2] };
    const res = nestNow(job); expect(res.placed.length).toBe(15); checkLayout(job, res, gap);
    expect(res.placed[0].shape).toBe(0);
    const r2 = nestNow(job, rng(7)); expect(r2.placed.length).toBe(15); checkLayout(job, r2, gap);
  });
  it('a part bigger than the sheet is reported missing', () => {
    const big = shapeOf([rect(0, 0, 400, 50)], 2);
    const res = nestNow({ shapes: [big], counts: [2], W: 297, H: 210, margin: 5, gap: 2, angles: [0, Math.PI / 2] });
    expect(res.placed.length).toBe(0); expect(res.missing[0]).toBe(2);
  });
  it('a part exactly as wide as the room still fits', () => {
    const p = shapeOf([rect(0, 0, 90, 20)], 2);
    const res = nestNow({ shapes: [p], counts: [1], W: 100, H: 100, margin: 5, gap: 2, angles: [0] });
    expect(res.placed.length).toBe(1);
  });
});

describe('Nesting: finding the parts', () => {
  it('a key ring outline and its hole are one part; a separate square is another', () => {
    const ents = [ent('a', circ(P(50, 50), 20)), ent('h', circ(P(50, 65), 3)), ent('s', rect(100, 0, 20, 20))];
    const parts = findParts(ents, () => null);
    expect(parts.length).toBe(2);
    expect(parts.find(p => p.ids.includes('a'))!.ids.sort()).toEqual(['a', 'h']);
  });
  it('overlapping shapes (a ring joined on, not welded) go together; groups go together', () => {
    const ents = [ent('body', rect(0, 0, 40, 40)), ent('ring', circ(P(20, 45), 8)), ent('g1', rect(100, 0, 10, 10), { group: ['G'] }), ent('g2', rect(130, 0, 10, 10), { group: ['G'] })];
    const parts = findParts(ents, e => e.group?.length ? e.group[e.group.length - 1] : null);
    expect(parts.length).toBe(2);
    expect(parts.find(p => p.ids.includes('g1'))!.ids.sort()).toEqual(['g1', 'g2']);
  });
  it('the part outline keeps the real size; identical parts share a key', () => {
    const a = nestShape({ ids: [], polys: [rect(0, 0, 30, 20)] }, 2), b = nestShape({ ids: [], polys: [rect(100, 100, 30, 20)] }, 2);
    expect(a.area).toBeCloseTo(600, 0); expect(a.key).toBe(b.key);
    expect(a.centre.x).toBeCloseTo(15, 3); expect(b.centre.x).toBeCloseTo(115, 3);
  });
});
