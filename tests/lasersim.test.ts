import { describe, it, expect } from 'vitest';
import { P } from '../src/geometry/vec';
import { newDoc, type Doc } from '../src/model/types';
import { cutOrder } from '../src/laser/order';
import { runTime, lineTime, scanRows, simulate, placement, fmtTime, clock, DEFAULT_MOTION } from '../src/laser/sim';
import { fitsBed, cornerPt, defaultState, MATERIALS } from '../src/laser/machine';

let seq = 0;
const base = (color: any = 'red') => ({ id: 'e' + (++seq), layer: 'L1', color, w: 0.1 });
const sq = (x: number, y: number, w: number, color: any = 'red') => ({ ...base(color), type: 'poly', closed: true, pts: [P(x, y), P(x + w, y), P(x + w, y + w), P(x, y + w)] });
const docOf = (ents: any[]): Doc => { const d = newDoc(); d.ents = ents; return d; };
const set = () => structuredClone(MATERIALS.custom.s);

describe('Motion model', () => {
  it('a long straight run is distance ÷ speed plus the time to speed up and slow down', () => {
    expect(runTime(100, 10, 3000)).toBeCloseTo(10 + 10 / 3000, 9);
  });
  it('a short run that never reaches full speed: 2√(d/a)', () => {
    expect(runTime(1, 300, 3000)).toBeCloseTo(2 * Math.sqrt(1 / 3000), 9);
  });
  it('corners cost time: a square is slower than a straight line of the same length', () => {
    const line = [P(0, 0), P(400, 0)], square = [P(0, 0), P(100, 0), P(100, 100), P(0, 100), P(0, 0)];
    expect(lineTime(square, 100, 3000)).toBeGreaterThan(lineTime(line, 100, 3000));
  });
  it('scan rows across a 10 × 4 mm rectangle at 0.1 mm: 40 rows of 10 mm', () => {
    const rows = scanRows([[P(0, 0), P(10, 0), P(10, 4), P(0, 4)]], 0.1);
    expect(rows.length).toBe(40); expect(rows.every(r => Math.abs(r.len - 10) < 1e-9)).toBe(true);
  });
  it('a hole in an engraved area is skipped', () => {
    const rows = scanRows([[P(0, 0), P(10, 0), P(10, 10), P(0, 10)], [P(3, 3), P(7, 3), P(7, 7), P(3, 7)]], 1);
    expect(rows.find(r => r.y > 4 && r.y < 6)!.len).toBeCloseTo(6, 9);
  });
});

describe('Simulating a job on the bed', () => {
  const doc = docOf([sq(0, 0, 40), sq(15, 15, 10)]);
  const box = { x0: 0, y0: 0, x1: 40, y1: 40 }, pl = placement(box, P(100, 50));
  it('placement: the job’s top-left goes where asked; the drawing’s y-up becomes "from the back"', () => {
    expect(pl.toBed(P(0, 40))).toEqual(P(100, 50)); expect(pl.toBed(P(40, 0))).toEqual(P(140, 90));
    expect(pl.toDoc(P(140, 90))).toEqual(P(40, 0));
  });
  it('cut lengths add up; the hole is cut first; total = cutting + moves', () => {
    const paths = cutOrder(doc, { start: pl.toDoc(P(600, 0)) }).paths;
    const s = simulate(paths, pl.toBed, set(), P(600, 0));
    expect(s.cutLen).toBeCloseTo(160 + 40, 1);
    const lines = s.steps.filter(x => x.k === 'line') as any[]; expect(lines[0].len).toBeCloseTo(40, 1);
    expect(s.total).toBeCloseTo(s.cutTime + s.travelTime + s.engraveTime, 6);
    expect(s.box).toEqual({ x0: 100, y0: 50, x1: 140, y1: 90 });
  });
  it('2 passes doubles the cutting; switching cut off leaves nothing to do', () => {
    const paths = cutOrder(doc).paths, a = set(), b = set(); b.cut.passes = 2;
    const one = simulate(paths, pl.toBed, a, P(0, 0)), two = simulate(paths, pl.toBed, b, P(0, 0));
    expect(two.cutLen).toBeCloseTo(2 * one.cutLen, 6); expect(two.cutTime).toBeCloseTo(2 * one.cutTime, 6);
    const off = set(); off.cut.on = false; expect(simulate(paths, pl.toBed, off, P(0, 0)).steps.length).toBe(0);
  });
  it('slower cutting takes longer, about in proportion', () => {
    const paths = cutOrder(doc).paths, fast = set(), slow = set(); slow.cut.speed = fast.cut.speed / 2;
    const a = simulate(paths, pl.toBed, fast, P(0, 0)), b = simulate(paths, pl.toBed, slow, P(0, 0));
    expect(b.cutTime / a.cutTime).toBeGreaterThan(1.9); expect(b.cutTime / a.cutTime).toBeLessThan(2.1);
  });
  it('an engraved area is timed by its rows', () => {
    const d = docOf([sq(0, 0, 10, 'yellow')]), paths = cutOrder(d).paths, st = set();
    const s = simulate(paths, placement({ x0: 0, y0: 0, x1: 10, y1: 10 }, P(0, 0)).toBed, st, P(0, 0));
    const rows = 100, expected = rows * (10 / st.engrave.speed + 2 * st.engrave.speed / DEFAULT_MOTION.scanAccel);
    expect(s.engraveTime).toBeGreaterThan(expected); expect(s.engraveTime).toBeLessThan(expected * 1.1);
  });
});

describe('The bed', () => {
  const m = defaultState().machine;
  it('fits, or says plainly which way it goes over', () => {
    expect(fitsBed(m, { x0: 0, y0: 0, x1: 600, y1: 400 })).toBeNull();
    expect(fitsBed(m, { x0: 450, y0: 10, x1: 724, y1: 204 })).toBe('This would go 124 mm past the right-hand side.');
    expect(fitsBed(m, { x0: -5, y0: 390, x1: 50, y1: 420 })).toBe('This would go 5 mm past the left-hand side and 20 mm past the front.');
  });
  it('parking corners in bed coordinates', () => {
    expect(cornerPt(m, 'back-left')).toEqual(P(0, 0)); expect(cornerPt(m, 'back-right')).toEqual(P(600, 0)); expect(cornerPt(m, 'front-right')).toEqual(P(600, 400));
  });
  it('times read nicely', () => {
    expect(fmtTime(45)).toBe('45 s'); expect(fmtTime(750)).toBe('12 min 30 s'); expect(fmtTime(3725)).toBe('1 h 2 min');
    expect(clock(125)).toBe('2:05'); expect(clock(3725)).toBe('1:02:05');
  });
});
