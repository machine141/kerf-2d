import { describe, it, expect } from 'vitest';
import { measure, cutRange, startAt, cornersOf, passStarts, tabPieces, testPiecePaths, applyExtras, subSeg, segLen } from '../src/laser/extras';
import { cutOrder } from '../src/laser/order';
import { loopSegs, type Seg } from '../src/laser/segs';
import { P } from '../src/geometry/vec';
import { newDoc } from '../src/model/types';

const rect = (x: number, y: number, w: number, h: number): Seg[] => [
  { k: 'L', a: P(x, y), b: P(x + w, y) }, { k: 'L', a: P(x + w, y), b: P(x + w, y + h) }, { k: 'L', a: P(x + w, y + h), b: P(x, y + h) }, { k: 'L', a: P(x, y + h), b: P(x, y) }];
const lenOf = (ss: Seg[]) => measure(ss).L;

describe('cutting extras: measuring and cutting paths', () => {
  it('measures lines, circles and curves', () => {
    expect(lenOf(rect(0, 0, 40, 20))).toBeCloseTo(120, 9);
    expect(lenOf(loopSegs({ c: P(0, 0), rx: 10, ry: 10, rot: 0 }))).toBeCloseTo(2 * Math.PI * 10, 3);
    const c: Seg = { k: 'C', a: P(0, 0), c1: P(10, 0), c2: P(20, 0), b: P(30, 0) };
    expect(segLen(c)).toBeCloseTo(30, 3);
    const h = subSeg(c, 0.25, 0.75); expect(h.a.x).toBeCloseTo(7.5, 6); expect(h.b.x).toBeCloseTo(22.5, 6);
  });
  it('cuts a piece out of a path and restarts a loop anywhere, keeping its length', () => {
    const r = rect(0, 0, 40, 20), piece = cutRange(r, 30, 70);
    expect(lenOf(piece)).toBeCloseTo(40, 9); expect(piece[0].a).toEqual(P(30, 0)); expect(piece[piece.length - 1].b).toEqual(P(30, 20));
    const s = startAt(r, 50); expect(lenOf(s)).toBeCloseTo(120, 9); expect(s[0].a).toEqual(P(40, 10)); expect(s[s.length - 1].b).toEqual(P(40, 10));
    const circ = loopSegs({ c: P(0, 0), rx: 5, ry: 5, rot: 0 }), cs = startAt(circ, lenOf(circ) / 4);
    expect(lenOf(cs)).toBeCloseTo(lenOf(circ), 4); expect(cs[0].a.x).toBeCloseTo(0, 6); expect(cs[0].a.y).toBeCloseTo(5, 6);
  });
});

describe('start somewhere different each pass', () => {
  it('a rectangle: each pass starts at a different corner', () => {
    expect(cornersOf(rect(0, 0, 40, 20))).toEqual([0, 40, 60, 100]);
    const st = passStarts(rect(0, 0, 40, 20), 2); expect(st).toEqual([0, 60]);       // the opposite corner
    expect(new Set(passStarts(rect(0, 0, 40, 20), 4)).size).toBe(4);
  });
  it('a circle: starts spread evenly round it', () => {
    const c = loopSegs({ c: P(0, 0), rx: 10, ry: 10, rot: 0 }), L = lenOf(c), st = passStarts(c, 3);
    expect(st[1]).toBeCloseTo(L / 3, 6); expect(st[2]).toBeCloseTo(2 * L / 3, 6);
  });
});

describe('tabs', () => {
  it('leaves n gaps of the given width, and the cut still starts at the corner', () => {
    const r = rect(0, 0, 40, 20), ps = tabPieces(r, 2, 1)!;
    const cut = ps.reduce((a, p) => a + lenOf(p), 0); expect(cut).toBeCloseTo(120 - 2, 9);
    expect(ps[0][0].a).toEqual(P(0, 0)); expect(ps[ps.length - 1][ps[ps.length - 1].length - 1].b).toEqual(P(0, 0));
    // gaps centred at 30 and 90 mm round: (30, 0) on the bottom and (30, 20) on the top
    expect(ps[0][ps[0].length - 1].b).toEqual(P(29.5, 0)); expect(ps[1][0].a).toEqual(P(30.5, 0));
  });
  it('small shapes are left whole', () => { expect(tabPieces(rect(0, 0, 2, 2), 4, 1)).toBeNull(); });
});

describe('applied to a job', () => {
  const doc = () => {
    const d = newDoc(); d.page = { w: 100, h: 60 } as any;
    d.ents = [{ id: 'a', type: 'poly', closed: true, pts: [P(10, 10), P(50, 10), P(50, 40), P(10, 40)], layer: 'L1', color: 'red', w: 0.1 } as any, { id: 'h', type: 'circle', c: P(30, 25), r: 5, layer: 'L1', color: 'red', w: 0.1 } as any];
    return d;
  };
  it('tabs go on the outline only, never on the hole; the hole is still cut first', () => {
    const ps = applyExtras(cutOrder(doc()).paths, { tabs: { n: 2, w: 1 } });
    expect(ps[0].ids).toEqual(['h']); expect(ps[0].closed).toBe(true);
    expect(ps.filter(p => p.tabbed).length).toBe(3); expect(ps.slice(1).every(p => p.tabbed)).toBe(true);
  });
  it('passes written one by one with different starts', () => {
    const ps = applyExtras(cutOrder(doc()).paths, { spreadStarts: true, passesOf: () => 2 });
    expect(ps.length).toBe(4); expect(ps.every(p => p.onePass)).toBe(true);
    expect(ps[2].rings[0][0].a).not.toEqual(ps[3].rings[0][0].a);
  });
  it('the test piece is cut before anything else, hole first, with the job\'s cut colour', () => {
    const ps = applyExtras(cutOrder(doc()).paths, { test: { at: P(60, 40), key: 'ink' } });
    expect(ps[0].test && ps[1].test).toBe(true); expect(ps[0].ids).toEqual(['test-hole']);
    expect(ps[1].box.x0).toBeCloseTo(60, 9); expect(ps[1].box.y1).toBeCloseTo(40, 9); expect(ps[1].box.x1 - ps[1].box.x0).toBeCloseTo(10, 9);
    expect(testPiecePaths(P(0, 0), 'red')[0].key).toBe('red');
  });
});
