/**
 * Material test: a grid of small squares, each cut (or engraved) with a different speed and power,
 * so you can see which settings work on a new material. Speed changes across the grid, power down it.
 *
 * Until Kerf talks to the laser, the grid goes to LightBurn as a file: every square is on its own
 * LightBurn layer (its own colour), and a settings list says which speed and power each layer needs.
 * LightBurn has 30 layer colours, so a test has at most 30 squares.
 * The first square (back left) has its corner cut off, so you can tell which way round the test is.
 */
import { fmt, clean } from '../geometry/vec';
import { LB_PALETTE } from './palette';
import { runTime, lineTime, DEFAULT_MOTION, type Motion } from './sim';
import { P, type Point } from '../geometry/vec';

export type TestMode = 'cut' | 'score' | 'engrave';
export interface Range { from: number; to: number; n: number }
export interface TestSpec {
  mode: TestMode;
  /** speed across the grid (columns), power down the grid (rows) */
  speed: Range; power: Range;
  size: number; gap: number; passes: number;
  /** engraving: distance between lines, mm */
  interval: number;
  /** what is being tested, for the settings list and the new material */
  name: string; thickness: number;
}
export const MAX_SQUARES = LB_PALETTE.length;
export const DEFAULT_TEST: TestSpec = {
  mode: 'cut', speed: { from: 8, to: 20, n: 4 }, power: { from: 50, to: 80, n: 4 },
  size: 10, gap: 4, passes: 1, interval: 0.1, name: '', thickness: 3,
};
export const MODE_TEXT: Record<TestMode, string> = { cut: 'Cut through', score: 'Engrave lines', engrave: 'Engrave areas' };

/** n values from `from` to `to`, evenly spread and rounded to something you can type (whole numbers above 10, else 0.5). */
export function steps(r: Range): number[] {
  const n = Math.max(1, Math.round(r.n));
  if (n === 1) return [r.from];
  return Array.from({ length: n }, (_, i) => {
    const v = r.from + (r.to - r.from) * i / (n - 1);
    return Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 2) / 2;
  });
}
/** Fewer rows or columns until the grid has no more than 30 squares (LightBurn's layer colours). */
export function fitGrid(t: TestSpec): TestSpec {
  const o = structuredClone(t); o.speed.n = Math.max(1, Math.min(10, Math.round(o.speed.n))); o.power.n = Math.max(1, Math.min(10, Math.round(o.power.n)));
  while (o.speed.n * o.power.n > MAX_SQUARES) { if (o.speed.n >= o.power.n) o.speed.n--; else o.power.n--; }
  return o;
}

export interface Cell { i: number; j: number; layer: number; speed: number; power: number; x: number; y: number }
/** The squares, row by row from the back: x from the left, y from the back (mm). */
export function testCells(t: TestSpec): Cell[] {
  const sp = steps(t.speed), pw = steps(t.power), out: Cell[] = [];
  pw.forEach((power, j) => sp.forEach((speed, i) => out.push({ i, j, layer: out.length, speed, power, x: i * (t.size + t.gap), y: j * (t.size + t.gap) })));
  return out;
}
export const testSize = (t: TestSpec) => ({ w: steps(t.speed).length * (t.size + t.gap) - t.gap, h: steps(t.power).length * (t.size + t.gap) - t.gap });

/** The outline of one square (y from the back); the first has its back-left corner cut off. */
export function cellPts(t: TestSpec, c: Cell): Point[] {
  const s = t.size, x = c.x, y = c.y, k = c.layer === 0 ? Math.min(3, s / 3) : 0;
  return k ? [P(x + k, y), P(x + s, y), P(x + s, y + s), P(x, y + s), P(x, y + k), P(x + k, y)] : [P(x, y), P(x + s, y), P(x + s, y + s), P(x, y + s), P(x, y)];
}

const nf = (v: number) => fmt(clean(v), 4);
const pad = (n: number) => String(n).padStart(2, '0');
/** The file for LightBurn: one square per layer colour, done square by square (back row first). */
export function testSVG(t: TestSpec): string {
  const { w, h } = testSize(t), cells = testCells(t);
  const out = [`<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${nf(w)}mm" height="${nf(h)}mm" viewBox="0 0 ${nf(w)} ${nf(h)}">`,
    `<!-- Kerf 2D material test${t.name ? ' · ' + esc(t.name) : ''} · ${MODE_TEXT[t.mode]} · each square is on its own LightBurn layer: set each layer's speed and power from the settings list · the square with the cut-off corner is the first (back left) -->`,
    `<g id="kerf-material-test" fill="none" stroke-linejoin="round">`];
  for (const c of cells) {
    const hx = LB_PALETTE[c.layer], d = 'M' + cellPts(t, c).map(p => `${nf(p.x)} ${nf(p.y)}`).join(' L') + ' Z';
    out.push(t.mode === 'engrave'
      ? `<path id="test-${pad(c.layer)}" d="${d}" fill="${hx}" stroke="${hx}" stroke-width="0.1"><title>Layer ${pad(c.layer)}: ${c.speed} mm/s, ${c.power} %</title></path>`
      : `<path id="test-${pad(c.layer)}" d="${d}" stroke="${hx}" stroke-width="0.1"><title>Layer ${pad(c.layer)}: ${c.speed} mm/s, ${c.power} %</title></path>`);
  }
  out.push(`</g>`, `</svg>`);
  return out.join('\n');
}
const esc = (s: string) => String(s).replace(/[&<>"-]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '-': '‐' } as any)[c]);

/** The settings list to type into LightBurn, one line per layer. */
export function testList(t: TestSpec): string {
  const cells = testCells(t), { w, h } = testSize(t);
  return [`Kerf 2D material test${t.name ? ': ' + (t.thickness ? t.thickness + ' mm ' : '') + t.name : ''}`,
    `${MODE_TEXT[t.mode]} · ${t.passes} pass${t.passes > 1 ? 'es' : ''}${t.mode === 'engrave' ? ` · line interval ${t.interval} mm` : ''} · ${cells.length} squares of ${t.size} mm · ${Math.round(w)} × ${Math.round(h)} mm`,
    `Speed changes across (left to right), power changes going towards the front. The square with the cut-off corner is layer 00, at the back left.`,
    `In LightBurn: File → Import the test file, then set each layer like this:`, '',
    ...cells.map(c => `Layer ${pad(c.layer)}  (row ${c.j + 1}, square ${c.i + 1})   speed ${c.speed} mm/s   power ${c.power} %`)].join('\n');
}

/** Rough time for the whole test (seconds). */
export function testTime(t: TestSpec, m: Motion = DEFAULT_MOTION): number {
  let total = 0, at = P(0, 0);
  for (const c of testCells(t)) {
    const pts = cellPts(t, c);
    total += runTime(Math.hypot(pts[0].x - at.x, pts[0].y - at.y), m.rapid, m.accel);
    if (t.mode === 'engrave') { const rows = Math.max(1, Math.floor(t.size / Math.max(0.02, t.interval))); total += t.passes * rows * (t.size / c.speed + 2 * c.speed / m.scanAccel); }
    else total += t.passes * lineTime(pts, c.speed, m.accel);
    at = pts[pts.length - 1];
  }
  return total;
}

/** The smallest difference between two squares' values that still reads as different (whole numbers from 10 up, else halves). */
export const minGap = (r: Range) => Math.max(r.from, r.to) >= 10 ? 1 : 0.5;
/**
 * Is this range usable? From must be lower than To, and far enough apart that every square gets its own value
 * (4 squares from 50 to 52 would repeat numbers). A short message if not, null if it's fine.
 */
export function rangeProblem(r: Range): string | null {
  const n = Math.max(1, Math.round(r.n));
  if (n === 1) return null;
  if (r.from >= r.to) return 'From must be lower than To.';
  const v = steps(r); if (new Set(v).size < v.length) return `Too close for ${n} squares: at least ${+((n - 1) * minGap(r)).toFixed(1)} apart, or fewer squares.`;
  return null;
}
