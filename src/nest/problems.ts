/**
 * Cut lines that cross, touch or lie on top of each other inside one design.
 * The laser follows every line, so crossings cut the part into extra pieces and
 * lines drawn twice burn twice. Lines that simply join end to end are fine.
 */
import { type Point, P, dist } from '../geometry/vec';
import { flatten } from '../geometry/entity';
import type { Entity, Shape } from '../model/types';

export interface LineIssues { cross: Point[]; overlap: Point[]; ids: string[] }
interface Seg { a: Point; b: Point; e: number; x0: number; y0: number; x1: number; y1: number }

export function lineIssues(ents: Entity[], isCut: (e: Entity) => boolean, max = 40): LineIssues {
  const use = ents.filter(e => e.type !== 'text' && e.type !== 'dim' && isCut(e));
  const segs: Seg[] = [], ends: Point[][] = [];
  use.forEach((e, i) => {
    const f = flatten(e as Shape, 0.05), n = f.pts.length; if (n < 2) { ends.push([]); return; }
    ends.push(f.closed ? [] : [f.pts[0], f.pts[n - 1]]);
    const m = f.closed ? n : n - 1;
    for (let k = 0; k < m; k++) { const a = f.pts[k], b = f.pts[(k + 1) % n]; segs.push({ a, b, e: i, x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) }); }
  });
  const cross: Point[] = [], overlap: Point[] = [], bad = new Set<number>(), T = 0.02;
  const add = (list: Point[], p: Point, i: number, k: number) => { bad.add(i); bad.add(k); if (list.length < max && !list.some(q => dist(q, p) < 0.5)) list.push(p); };
  const atEnd = (i: number, p: Point) => ends[i].some(q => dist(q, p) < T);
  // sort by x for a quick sweep
  segs.sort((s, t) => s.x0 - t.x0);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    for (let j = i + 1; j < segs.length && segs[j].x0 <= s.x1 + T; j++) {
      const t = segs[j]; if (t.e === s.e || t.y0 > s.y1 + T || t.y1 < s.y0 - T) continue;
      const rx = s.b.x - s.a.x, ry = s.b.y - s.a.y, sx = t.b.x - t.a.x, sy = t.b.y - t.a.y, den = rx * sy - ry * sx;
      const Ls = Math.hypot(rx, ry), Lt = Math.hypot(sx, sy); if (Ls < 1e-9 || Lt < 1e-9) continue;
      if (Math.abs(den) < 1e-6 * Ls * Lt) {
        // parallel: on top of each other?
        const off = Math.abs((t.a.x - s.a.x) * ry - (t.a.y - s.a.y) * rx) / Ls; if (off > T) continue;
        const u0 = ((t.a.x - s.a.x) * rx + (t.a.y - s.a.y) * ry) / Ls, u1 = ((t.b.x - s.a.x) * rx + (t.b.y - s.a.y) * ry) / Ls;
        const lo = Math.max(0, Math.min(u0, u1)), hi = Math.min(Ls, Math.max(u0, u1));
        if (hi - lo > 0.2) { const m = (lo + hi) / 2 / Ls; add(overlap, P(s.a.x + rx * m, s.a.y + ry * m), s.e, t.e); }
        continue;
      }
      const qx = t.a.x - s.a.x, qy = t.a.y - s.a.y, u = (qx * sy - qy * sx) / den, v = (qx * ry - qy * rx) / den, eu = T / Ls, ev = T / Lt;
      if (u < -eu || u > 1 + eu || v < -ev || v > 1 + ev) continue;
      const p = P(s.a.x + rx * u, s.a.y + ry * u);
      // two lines joined end to end (a path made of pieces) are fine
      if (atEnd(s.e, p) && atEnd(t.e, p)) continue;
      add(cross, p, s.e, t.e);
    }
  }
  return { cross, overlap, ids: [...bad].map(i => use[i].id) };
}
