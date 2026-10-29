/** For checks and scripts: do any two parts come closer than `gap`? (each part's outline grown by just under half the gap) */
import ClipperLib from 'clipper-lib';
import type { Entity } from '../model/types';
import { findParts } from './parts';
import { growOutline } from './nest';

export function tooClose(ents: Entity[], gap: number, groupRoot: (e: Entity) => string | null): { pairs: number; parts: number } {
  const L: any = ClipperLib, parts = findParts(ents, groupRoot).map(p => growOutline(p.polys, gap / 2 - 0.05, 0));
  let pairs = 0;
  for (let i = 0; i < parts.length; i++) for (let k = i + 1; k < parts.length; k++) {
    const c = new L.Clipper(), out = new L.Paths(); c.AddPaths(parts[i], 0, true); c.AddPaths(parts[k], 1, true); c.Execute(0, out, 1, 1);
    if ((out as any[]).some(q => Math.abs(L.Clipper.Area(q)) > 100)) pairs++;
  }
  return { pairs, parts: parts.length };
}

/** Pairs of laid-out parts (real outlines, drawing coordinates) closer than `gap`. */
export function closePairs(outlines: { polys: { x: number; y: number }[][] }[], gap: number): [number, number][] {
  const L: any = ClipperLib, g = outlines.map(o => growOutline(o.polys, Math.max(0, gap / 2 - 0.05), 0));
  const box = g.map(qs => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of qs) for (const v of q) { x0 = Math.min(x0, v.X); x1 = Math.max(x1, v.X); y0 = Math.min(y0, v.Y); y1 = Math.max(y1, v.Y); } return [x0, y0, x1, y1]; });
  const out: [number, number][] = [];
  for (let i = 0; i < g.length; i++) for (let k = i + 1; k < g.length; k++) {
    const a = box[i], b = box[k]; if (a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]) continue;
    const c = new L.Clipper(), r = new L.Paths(); c.AddPaths(g[i], 0, true); c.AddPaths(g[k], 1, true); c.Execute(0, r, 1, 1);
    if ((r as any[]).some(q => Math.abs(L.Clipper.Area(q)) > 100)) out.push([i, k]);
  }
  return out;
}
