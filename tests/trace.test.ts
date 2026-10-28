import { describe, it, expect } from 'vitest';
import { traceMask, trace, loopArea, otsu, type Img } from '../src/trace/trace';

const maskFrom = (rows: string[]) => { const h = rows.length, w = rows[0].length, m = new Uint8Array(w * h); rows.forEach((r, y) => [...r].forEach((c, x) => { m[y * w + x] = c === '#' ? 1 : 0; })); return { m, w, h }; };
const imgFrom = (w: number, h: number, f: (x: number, y: number) => number): Img => {
  const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = f(x, y), i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; } return { w, h, data: d };
};
const base = { mode: 'silhouette', threshold: 'auto', invert: false, flatten: false, fillHoles: false, colours: 2, merge: false, clean: 0, smooth: 0, speckPx: 1, tolPx: 0.3 } as const;

describe('tracing', () => {
  it('square with a hole → outer loop + hole loop with exact areas', () => {
    const { m, w, h } = maskFrom(['.....', '.###.', '.#.#.', '.###.', '.....']);
    const loops = traceMask(m, w, h); expect(loops.length).toBe(2);
    expect(loops.map(l => Math.abs(loopArea(l))).sort()).toEqual([1, 9]);
  });
  it('pixels touching only at a corner stay separate', () => {
    const { m, w, h } = maskFrom(['....', '.#..', '..#.', '....']);
    expect(traceMask(m, w, h).length).toBe(2);
  });
  it('dark disc on white: one smooth outline of the right size; specks ignored', () => {
    const img = imgFrom(120, 120, (x, y) => (Math.hypot(x - 60, y - 60) < 40 ? 20 : 240) + ((x * 7 + y * 13) % 97 === 0 ? -200 : 0));
    const r = trace(img, { ...base, speckPx: 20, smooth: 2, tolPx: 0.5 });
    expect(r.loops.length).toBe(1);
    expect(Math.abs(r.loops[0].area)).toBeGreaterThan(Math.PI * 39 * 39); expect(Math.abs(r.loops[0].area)).toBeLessThan(Math.PI * 41 * 41);
    expect(r.loops[0].pts.length).toBeLessThan(120);           // simplified, not a pixel staircase
  });
  it('graduated background: levelling keeps the shape and drops the gradient', () => {
    const img = imgFrom(160, 100, (x, y) => (x > 50 && x < 110 && y > 30 && y < 70 ? 40 : 250 - x * 1.2));
    const plain = trace(img, base), level = trace(img, { ...base, flatten: true });
    expect(level.loops.length).toBe(1);
    const a = Math.abs(level.loops[0].area); expect(a).toBeGreaterThan(55 * 35); expect(a).toBeLessThan(65 * 45);
    expect(plain.loops.length === 1 && Math.abs(Math.abs(plain.loops[0].area) - a) < 50).toBe(false); // without levelling the gradient leaks in
  });
  it('colours mode finds the background and traces the other colours; erasing removes pixels', () => {
    const img = imgFrom(100, 60, (x, y) => (x > 10 && x < 40 && y > 10 && y < 50 ? 0 : x > 60 && x < 90 && y > 10 && y < 50 ? 128 : 255));
    const r = trace(img, { ...base, mode: 'colours', colours: 3 });
    expect(r.palette.length).toBe(3); expect(r.loops.length).toBe(2);
    const erase = new Uint8Array(100 * 60); for (let y = 0; y < 60; y++) for (let x = 55; x < 100; x++) erase[y * 100 + x] = 1;
    expect(trace(img, { ...base, mode: 'colours', colours: 3, erase }).loops.length).toBe(1);
  });
  it('Otsu splits two levels', () => { const g = new Float32Array([10, 10, 10, 200, 200, 200]); const t = otsu(g); expect(t).toBeGreaterThan(10); expect(t).toBeLessThan(200); });
});
describe('colours on a graduated background', () => {
  it('levelling stops the gradient being traced as a colour region', () => {
    const d = new Uint8ClampedArray(160 * 100 * 4);
    for (let y = 0; y < 100; y++) for (let x = 0; x < 160; x++) { const i = (y * 160 + x) * 4, inR = x > 50 && x < 110 && y > 30 && y < 70, v = 250 - x * 0.8; d[i] = inR ? 200 : v; d[i + 1] = inR ? 30 : v; d[i + 2] = inR ? 30 : v; d[i + 3] = 255; }
    const r = trace({ w: 160, h: 100, data: d }, { ...base, mode: 'colours', colours: 2, flatten: true });
    expect(r.loops.length).toBe(1); expect(Math.abs(r.loops[0].area)).toBeGreaterThan(55 * 35);
  });
});
import { whyEmpty } from '../src/trace/trace';
describe('explains an empty trace', () => {
  const img = (() => { const d = new Uint8ClampedArray(60 * 60 * 4); for (let i = 0; i < 3600; i++) { const x = i % 60, y = (i / 60) | 0, v = Math.hypot(x - 30, y - 30) < 15 ? 20 : 240; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; } return { w: 60, h: 60, data: d }; })();
  it('specks too big', () => { const o = { ...base, speckPx: 1e6 }; expect(whyEmpty(trace(img, o), o)).toMatch(/smaller than "Ignore specks"/); });
  it('threshold too low', () => { const o = { ...base, threshold: 5 }; expect(whyEmpty(trace(img, o), o)).toMatch(/Nothing is darker/); });
  it('all colours dropped', () => { const o = { ...base, mode: 'colours' as const, keep: [false, false] }; expect(whyEmpty(trace(img, o), o)).toMatch(/All colours are dropped/); });
  it('nothing to explain when outlines exist', () => { expect(whyEmpty(trace(img, base), base)).toBeNull(); });
});
import { traceNetwork, mergeSpecks } from '../src/trace/trace';
describe('colour outlines as one network', () => {
  it('two touching colour squares: the shared edge is traced once', () => {
    const w = 8, h = 6, L = new Uint8Array(w * h).fill(255);
    for (let y = 1; y < 5; y++) for (let x = 1; x < 7; x++) L[y * w + x] = x < 4 ? 0 : 1;
    const { chains, closed } = traceNetwork(L, w, h);
    expect(chains.length).toBe(3); expect(closed.every(c => !c)).toBe(true);
    const len = chains.reduce((a, c) => a + c.length - 1, 0);
    expect(len).toBe(2 * (6 + 4) + 4);               // outer perimeter + shared edge once (not twice)
  });
  it('small colour specks are merged into their surroundings', () => {
    const w = 10, h = 10, L = new Uint8Array(w * h).fill(0); L[55] = 1; L[22] = 2;
    mergeSpecks(L, w, h, 4); expect([...L].every(v => v === 0)).toBe(true);
  });
  it('fill brush closes a gap; erase removes', () => {
    const img = { w: 40, h: 20, data: new Uint8ClampedArray(40 * 20 * 4).fill(255) };
    for (let y = 5; y < 15; y++) for (let x = 5; x < 35; x++) { if (x >= 18 && x < 22) continue; const i = (y * 40 + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 0; }
    expect(trace(img, base).loops.length).toBe(2);           // two blocks with a gap
    const ed = new Uint8Array(800); for (let y = 5; y < 15; y++) for (let x = 18; x < 22; x++) ed[y * 40 + x] = 2;
    expect(trace(img, { ...base, erase: ed }).loops.length).toBe(1); // filled → one shape
  });
});
