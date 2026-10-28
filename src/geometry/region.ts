/**
 * Boundary finding: given a point and a set of shapes, trace the smallest closed
 * region that encloses the point — even when the boundary is made of lines that
 * cross or overlap rather than meeting end to end. Used by Closed contour,
 * boundary fill and "click inside an area" tools.
 *
 * Method: flatten shapes to segments, split every segment at its crossings,
 * build a planar graph, cast a ray from the click to find the nearest boundary
 * edge, then walk the face keeping it on the left (always taking the next edge
 * clockwise). A face that winds clockwise is the outside of the drawing, which
 * means the boundary has a gap.
 */
import { type Point, P, dist, normA, cp } from './vec';
import { flatten } from './entity';
import type { Shape } from '../model/types';

export interface RegionResult { ok: boolean; pts: Point[]; reason?: string; area?: number }
interface Seg { a: Point; b: Point }

function segInter(p: Seg, q: Seg): number[] | null {
  const rx = p.b.x - p.a.x, ry = p.b.y - p.a.y, sx = q.b.x - q.a.x, sy = q.b.y - q.a.y, den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-14) return null;
  const qx = q.a.x - p.a.x, qy = q.a.y - p.a.y, t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return [Math.min(1, Math.max(0, t)), Math.min(1, Math.max(0, u))];
}

export function findRegion(click: Point, shapes: Shape[], tolMerge = 1e-6): RegionResult {
  // 1. segments
  const segs: Seg[] = [];
  for (const e of shapes) {
    if (e.type === 'dim') continue; const f = flatten(e), n = f.pts.length;
    for (let i = 0; i < n - 1; i++) segs.push({ a: f.pts[i], b: f.pts[i + 1] });
    if (f.closed && n > 2) segs.push({ a: f.pts[n - 1], b: f.pts[0] });
  }
  if (!segs.length) return { ok: false, pts: [], reason: 'Nothing to trace' };
  // 2. split at crossings (spatial hash)
  let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
  for (const s of segs) { X0 = Math.min(X0, s.a.x, s.b.x); X1 = Math.max(X1, s.a.x, s.b.x); Y0 = Math.min(Y0, s.a.y, s.b.y); Y1 = Math.max(Y1, s.a.y, s.b.y); }
  const cell = Math.max((X1 - X0), (Y1 - Y0), 1) / Math.max(8, Math.sqrt(segs.length) * 2);
  const grid = new Map<string, number[]>();
  segs.forEach((s, i) => {
    const gx0 = Math.floor((Math.min(s.a.x, s.b.x) - X0) / cell), gx1 = Math.floor((Math.max(s.a.x, s.b.x) - X0) / cell);
    const gy0 = Math.floor((Math.min(s.a.y, s.b.y) - Y0) / cell), gy1 = Math.floor((Math.max(s.a.y, s.b.y) - Y0) / cell);
    for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) { const k = gx + ',' + gy; let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(i); }
  });
  const cuts: number[][] = segs.map(() => [0, 1]);
  const done = new Set<number>();
  for (const ids of grid.values()) for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = ids[i], b = ids[j], key = a < b ? a * 1e7 + b : b * 1e7 + a; if (done.has(key)) continue; done.add(key);
    const r = segInter(segs[a], segs[b]); if (r) { cuts[a].push(r[0]); cuts[b].push(r[1]); }
  }
  // 3. planar graph (nodes merged on a fine grid)
  const nodeId = new Map<string, number>(), nodes: Point[] = [];
  const nid = (p: Point) => { const k = Math.round(p.x / tolMerge) + ',' + Math.round(p.y / tolMerge); let i = nodeId.get(k); if (i === undefined) { i = nodes.length; nodes.push(p); nodeId.set(k, i); } return i; };
  const adj: Map<number, Set<number>> = new Map();
  const link = (u: number, v: number) => { if (u === v) return; (adj.get(u) || adj.set(u, new Set()).get(u)!).add(v); (adj.get(v) || adj.set(v, new Set()).get(v)!).add(u); };
  segs.forEach((s, i) => {
    const ts = [...new Set(cuts[i].map(t => +t.toFixed(12)))].sort((x, y) => x - y);
    let prev = nid(s.a);
    for (let k = 1; k < ts.length; k++) { const p = cp(P(s.a.x + (s.b.x - s.a.x) * ts[k], s.a.y + (s.b.y - s.a.y) * ts[k])); const cur = k === ts.length - 1 ? nid(s.b) : nid(p); link(prev, cur); prev = cur; }
  });
  // 4. ray cast to +x: candidate boundary edges, nearest first
  const cy = click.y + 1.37e-7, hits: { u: number; v: number; x: number }[] = [];
  for (const [u, vs] of adj) for (const v of vs) {
    if (u > v) continue; const A = nodes[u], B = nodes[v];
    if ((A.y > cy) === (B.y > cy)) continue;
    const x = A.x + (cy - A.y) * (B.x - A.x) / (B.y - A.y);
    if (x <= click.x) continue;
    hits.push(A.y < B.y ? { u, v, x } : { u: v, v: u, x });
  }
  if (!hits.length) return { ok: false, pts: [], reason: 'Not inside a closed boundary' };
  hits.sort((p, q) => p.x - q.x);
  // 5. walk the face with the click on the left (next edge clockwise from the way we came)
  const ang = (a: number, b: number) => Math.atan2(nodes[b].y - nodes[a].y, nodes[b].x - nodes[a].x);
  const walk = (h: { u: number; v: number }): RegionResult => {
    const loop: number[] = [h.u]; let u = h.u, v = h.v, guard = 0; const limit = nodes.length * 4 + 10;
    while (guard++ < limit) {
      loop.push(v);
      const back = ang(v, u); let nxt = -1, bestTurn = Infinity;
      for (const w of adj.get(v)!) { if (w === u && adj.get(v)!.size > 1) continue; const turn = normA(back - ang(v, w)); const t = turn < 1e-12 ? 2 * Math.PI : turn; if (t < bestTurn) { bestTurn = t; nxt = w; } }
      if (nxt < 0) nxt = u;
      u = v; v = nxt;
      if (u === h.u && v === h.v) break;
    }
    if (guard >= limit) return { ok: false, pts: [], reason: 'Boundary could not be traced' };
    loop.pop();
    const ids = loop.slice(); let changed = true;
    while (changed && ids.length > 2) { changed = false; for (let i = 0; i < ids.length; i++) { const a = ids[(i - 1 + ids.length) % ids.length], c = ids[(i + 1) % ids.length]; if (a === c) { ids.splice(i, 1); ids.splice(i % ids.length, 1); changed = true; break; } } }
    const pts = ids.map(i => nodes[i]);
    let area = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; area += p.x * q.y - q.x * p.y; } area /= 2;
    return { ok: pts.length >= 3 && area > 1e-9 && pointInPoly(click, pts), pts, area };
  };
  const tried = new Set<string>();
  for (const h of hits.slice(0, 200)) {
    const key = h.u + '>' + h.v; if (tried.has(key)) continue;
    const r = walk(h); if (r.ok) return r;
    // mark every edge of this (island or open) loop as tried so we move further out
    for (let i = 0; i < r.pts.length; i++) tried.add(h.u + '>' + h.v);
  }
  return { ok: false, pts: [], reason: 'Not a closed boundary — there may be a small gap' };
}

function pointInPoly(p: Point, pts: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export { dist };
