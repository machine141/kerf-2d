import { describe, it, expect } from 'vitest';
import { steps, fitGrid, testCells, testSize, testSVG, testList, testTime, cellPts, DEFAULT_TEST, MAX_SQUARES } from '../src/laser/mattest';
import { LB_PALETTE } from '../src/laser/palette';

describe('material test grid', () => {
  it('spreads values evenly and rounds them to typeable numbers', () => {
    expect(steps({ from: 8, to: 20, n: 4 })).toEqual([8, 12, 16, 20]);
    expect(steps({ from: 50, to: 80, n: 3 })).toEqual([50, 65, 80]);
    expect(steps({ from: 2, to: 5, n: 4 })).toEqual([2, 3, 4, 5]);
    expect(steps({ from: 1, to: 2, n: 3 })).toEqual([1, 1.5, 2]);
    expect(steps({ from: 30, to: 30, n: 1 })).toEqual([30]);
  });
  it('never has more squares than LightBurn has layer colours', () => {
    const t = fitGrid({ ...DEFAULT_TEST, speed: { from: 5, to: 50, n: 10 }, power: { from: 10, to: 90, n: 10 } });
    expect(t.speed.n * t.power.n).toBeLessThanOrEqual(MAX_SQUARES);
    expect(testCells(t).length).toBe(t.speed.n * t.power.n);
  });
  it('speed goes across, power goes towards the front, one layer colour each', () => {
    const t = DEFAULT_TEST, c = testCells(t);
    expect(c.length).toBe(16);
    expect(c[1].speed).toBeGreaterThan(c[0].speed); expect(c[1].power).toBe(c[0].power); expect(c[1].x).toBeGreaterThan(c[0].x);
    expect(c[4].power).toBeGreaterThan(c[0].power); expect(c[4].y).toBeGreaterThan(c[0].y); expect(c[4].speed).toBe(c[0].speed);
    const svg = testSVG(t);
    expect(new Set([...svg.matchAll(/stroke="(#[0-9A-F]{6})"/g)].map(m => m[1])).size).toBe(16);
    expect(svg).toContain(`stroke="${LB_PALETTE[0]}"`); expect(/<!--(.*?)-->/s.exec(svg)![1]).not.toContain('--');   // a valid XML comment
    const { w, h } = testSize(t); expect(w).toBe(4 * 10 + 3 * 4); expect(h).toBe(52);
  });
  it('the first square has a corner cut off so you can tell which way round it is', () => {
    const c = testCells(DEFAULT_TEST);
    expect(cellPts(DEFAULT_TEST, c[0]).length).toBe(6); expect(cellPts(DEFAULT_TEST, c[1]).length).toBe(5);
  });
  it('engraving test writes filled squares; the list names every layer', () => {
    const t = { ...DEFAULT_TEST, mode: 'engrave' as const };
    expect(testSVG(t)).toContain('fill="#');
    const l = testList(t); expect(l).toContain('Layer 00'); expect(l).toContain('Layer 15'); expect(l.split('\n').filter(x => x.startsWith('Layer')).length).toBe(16);
  });
  it('slower squares take longer; the estimate is in a sensible range', () => {
    const fast = testTime({ ...DEFAULT_TEST, speed: { from: 20, to: 20, n: 4 } }), slow = testTime({ ...DEFAULT_TEST, speed: { from: 5, to: 5, n: 4 } });
    expect(slow).toBeGreaterThan(fast * 3);
    expect(fast).toBeGreaterThan(16 * 40 / 20); expect(fast).toBeLessThan(16 * 40 / 20 * 2 + 20);
  });
});

import { rangeProblem } from '../src/laser/mattest';
describe('material test: ranges that make sense', () => {
  it('From must be lower than To', () => {
    expect(rangeProblem({ from: 20, to: 8, n: 4 })).toMatch(/lower/);
    expect(rangeProblem({ from: 20, to: 20, n: 4 })).toMatch(/lower/);
    expect(rangeProblem({ from: 20, to: 20, n: 1 })).toBeNull();
  });
  it('every square must get its own value', () => {
    expect(rangeProblem({ from: 50, to: 52, n: 4 })).toMatch(/Too close for 4/);
    expect(rangeProblem({ from: 50, to: 53, n: 4 })).toBeNull();
    expect(rangeProblem({ from: 2, to: 3, n: 3 })).toBeNull();      // 2, 2.5, 3
    expect(rangeProblem({ from: 2, to: 2.5, n: 3 })).toMatch(/Too close/);
  });
});
