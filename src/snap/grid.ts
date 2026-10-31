/**
 * Background grids: squares, dots, isometric (lines or dots) and polar (rings and spokes).
 * The drawing of each grid and the grid lock use the same points, so a locked point always lands on a mark you can see.
 */
import { P, type Point } from '../geometry/vec';
import { SHEET_GAP } from '../model/types';

export type GridStyle = 'lines' | 'dots' | 'iso' | 'isodots' | 'polar';
export const GRID_STYLES: { k: GridStyle; label: string; note: string }[] = [
  { k: 'lines', label: 'Squares', note: 'Graph paper' },
  { k: 'dots', label: 'Dots', note: 'Square dot grid, lighter on the eye' },
  { k: 'iso', label: 'Isometric', note: 'Lines at 30° and upright, for isometric drawings' },
  { k: 'isodots', label: 'Isometric dots', note: 'Isometric dot paper' },
  { k: 'polar', label: 'Circles', note: 'Rings and spokes from the middle of the page, for round and repeating designs' },
];
export interface GridSpec { show: boolean; spacing: number; style?: GridStyle; /** polar: degrees between spokes */ spokes?: number }

const R3 = Math.sqrt(3);
/** Isometric: the distance between upright lines for a grid whose points are `s` apart along every line. */
export const isoDx = (s: number) => s * R3 / 2;
/** The isometric grid point in column i, row j (odd columns are half a step higher). */
export const isoPt = (s: number, i: number, j: number) => P(i * isoDx(s), j * s + (((i % 2) + 2) % 2) * s / 2);

/** The middle of the sheet a point is on (polar grids are centred on each sheet). */
export function sheetCentre(p: Point, page: { w: number; h: number }): Point {
  const pitch = page.w + SHEET_GAP, k = Math.max(0, Math.round((p.x - page.w / 2) / pitch));
  return P(k * pitch + page.w / 2, page.h / 2);
}

/** The nearest grid point to p, for the grid lock. */
export function gridSnap(p: Point, g: GridSpec, page?: { w: number; h: number }): Point {
  const s = g.spacing, st = g.style || 'lines';
  if (st === 'iso' || st === 'isodots') {
    const i0 = Math.round(p.x / isoDx(s)); let best = p, bd = Infinity;
    for (let i = i0 - 1; i <= i0 + 1; i++) {
      const off = (((i % 2) + 2) % 2) * s / 2, j = Math.round((p.y - off) / s), q = isoPt(s, i, j), d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }
  if (st === 'polar' && page) {
    const c = sheetCentre(p, page), dx = p.x - c.x, dy = p.y - c.y, r = Math.round(Math.hypot(dx, dy) / s) * s;
    if (r === 0) return c;
    const a = (g.spokes || 15) * Math.PI / 180, t = Math.round(Math.atan2(dy, dx) / a) * a;
    return P(c.x + r * Math.cos(t), c.y + r * Math.sin(t));
  }
  return P(Math.round(p.x / s) * s, Math.round(p.y / s) * s);
}
