/**
 * Which objects belong together as one part when nesting.
 *  • a group is one part;
 *  • shapes that overlap or sit inside another (a key ring's hole, its engraving,
 *    a ring joined on but not welded) go with it;
 *  • anything else is a part on its own.
 * Each part gets its true outline (holes filled) for the nesting engine.
 */
import ClipperLib from 'clipper-lib';
import { type Point, P } from '../geometry/vec';
import { flatten } from '../geometry/entity';
import { textShapes } from '../text/text';
import type { Entity, Shape } from '../model/types';
import { growOutline, type NestShape, toIP, fromIP, type IP } from './nest';

const L = ClipperLib;
export interface Part { ids: string[]; polys: Point[][] }

/** The outline pieces of one object: closed shapes as they are, open lines as thin strips, text as its letters. */
export function outlineOf(e: Entity | Shape, tol = 0.1): Point[][] {
  if (e.type === 'dim') return [];
  if (e.type === 'text') return textShapes(e as any).flatMap(s => outlineOf(s, tol));
  const f = flatten(e as Shape, tol);
  if (f.pts.length < 2) return [];
  if (f.closed && f.pts.length > 2) return [f.pts];
  // an open line: a thin strip, so it still takes up room
  const co = new L.ClipperOffset(2, 25), out = new L.Paths();
  co.AddPath(toIP(f.pts), L.JoinType.jtRound, L.EndType.etOpenRound); co.Execute(out, 0.25 * 1000);
  return (out as IP[]).map(fromIP);
}

/** Split objects into parts (groups, and shapes touching or inside each other). */
export function findParts(ents: Entity[], groupRoot: (e: Entity) => string | null): Part[] {
  const units: { ids: string[]; polys: Point[][]; filled: IP[]; box: number[] }[] = [];
  const byGroup = new Map<string, number>();
  for (const e of ents) {
    if (e.type === 'dim') continue;
    const polys = outlineOf(e); if (!polys.length) continue;
    const g = groupRoot(e);
    if (g && byGroup.has(g)) { const u = units[byGroup.get(g)!]; u.ids.push(e.id); u.polys.push(...polys); continue; }
    if (g) byGroup.set(g, units.length);
    units.push({ ids: [e.id], polys, filled: [], box: [] });
  }
  for (const u of units) {
    u.filled = growOutline(u.polys, 0, 0);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of u.polys) for (const q of p) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
    u.box = [x0, y0, x1, y1];
  }
  // join units whose filled outlines overlap (inside counts as overlapping)
  const parent = units.map((_, i) => i), find = (i: number): number => parent[i] === i ? i : (parent[i] = find(parent[i]));
  for (let i = 0; i < units.length; i++) for (let k = i + 1; k < units.length; k++) {
    const a = units[i].box, b = units[k].box;
    if (a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]) continue;
    if (find(i) === find(k)) continue;
    const c = new L.Clipper(), out = new L.Paths();
    c.AddPaths(units[i].filled, L.PolyType.ptSubject, true); c.AddPaths(units[k].filled, L.PolyType.ptClip, true);
    c.Execute(L.ClipType.ctIntersection, out, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero);
    if ((out as IP[]).some(q => Math.abs(L.Clipper.Area(q)) > 1)) parent[find(k)] = find(i);
  }
  const parts = new Map<number, Part>();
  units.forEach((u, i) => { const r = find(i); const p = parts.get(r); if (p) { p.ids.push(...u.ids); p.polys.push(...u.polys); } else parts.set(r, { ids: [...u.ids], polys: [...u.polys] }); });
  return [...parts.values()];
}

/** A part made ready for the nesting engine (outline grown by half the gap and centred). */
export function nestShape(part: Part, gap: number): NestShape {
  const filled = growOutline(part.polys, 0, 0);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of filled) for (const v of q) { x0 = Math.min(x0, v.X); x1 = Math.max(x1, v.X); y0 = Math.min(y0, v.Y); y1 = Math.max(y1, v.Y); }
  const centre = P((x0 + x1) / 2000, (y0 + y1) / 2000), cx = Math.round(centre.x * 1000), cy = Math.round(centre.y * 1000);
  const raw = filled.map(q => fromIP(q.map(v => ({ X: v.X - cx, Y: v.Y - cy }))));
  const area = filled.reduce((t, q) => t + Math.abs(L.Clipper.Area(q)), 0) / 1e6;
  const grown = growOutline(raw, gap / 2);
  // identical parts (same outline in the same turn) share their sums
  const key = raw.map(q => q.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')).join('|') + '#' + gap;
  return { grown, raw, centre, area, key: hash(key) };
}
function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + ':' + s.length; }
