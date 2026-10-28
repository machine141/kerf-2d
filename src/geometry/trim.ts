/**
 * Delete Part (trim): remove the piece of a shape between the two nearest
 * crossings/ends around the clicked point. Pure function — the caller supplies
 * the primitives of every other shape that can cut.
 */
import { type Point, add, sub, mul, dot, dist, normA, angOf, cp } from './vec';
import { prims, intersect, flatten, type Prim } from './entity';
import type { Shape } from '../model/types';

export type TrimMode = 'whole' | 'segments';

/** Returns the replacement shapes (empty = shape fully removed), or null if the shape type cannot be trimmed. */
export function trimShape(e: Shape, click: Point, cutters: Prim[], mode: TrimMode = 'whole'): Shape[] | null {
  if (e.type === 'dim') return null;
  if (e.type === 'ellipse') e = { ...(e as any), type: 'poly', closed: true, pts: flatten(e).pts.map(cp) } as Shape;
  if (e.type === 'poly' && mode === 'segments') {
    // explode into lines, trim only the clicked segment
    const lines = prims(e).map(s => ({ type: 'line', a: (s as any).a, b: (s as any).b } as Shape));
    let bi = 0, bd = Infinity; lines.forEach((l, i) => { const d = segDist(click, (l as any).a, (l as any).b); if (d < bd) { bd = d; bi = i; } });
    const others = cutters.concat(lines.filter((_, i) => i !== bi).flatMap(l => prims(l)));
    const r = trimShape(lines[bi], click, others) || [];
    return lines.slice(0, bi).concat(r, lines.slice(bi + 1));
  }
  const cutsOf = (my: Prim[]) => { const out: Point[] = []; for (const m of my) for (const c of cutters) out.push(...intersect(m, c)); return out; };
  if (e.type === 'line') {
    const cuts = cutsOf(prims(e)), d = sub(e.b, e.a), L = dot(d, d), tAt = (p: Point) => dot(sub(p, e.a), d) / L, tc = tAt(click);
    const ts = cuts.map(tAt).filter(t => t > 1e-9 && t < 1 - 1e-9);
    const lo = Math.max(0, ...ts.filter(t => t < tc)), hi = Math.min(1, ...ts.filter(t => t > tc));
    const at = (t: number) => cp(add(e.a, mul(d, t))), out: Shape[] = [];
    if (lo > 0) out.push({ type: 'line', a: e.a, b: at(lo) } as Shape);
    if (hi < 1) out.push({ type: 'line', a: at(hi), b: e.b } as Shape);
    return out;
  }
  if (e.type === 'circle') {
    const cuts = cutsOf(prims(e)), ac = angOf(e.c, click), as = [...new Set(cuts.map(p => normA(angOf(e.c, p)).toFixed(12)))].map(Number);
    if (as.length < 2) return [];
    const ds = as.map(a => ({ a, d: normA(a - ac) })).sort((x, y) => x.d - y.d);
    return [{ type: 'arc', c: e.c, r: e.r, a0: ds[0].a, a1: ds[ds.length - 1].a } as Shape];
  }
  if (e.type === 'arc') {
    const cuts = cutsOf(prims(e)), span = normA(e.a1 - e.a0), sAt = (p: Point) => normA(angOf(e.c, p) - e.a0), sc = sAt(click);
    const ss = cuts.map(sAt).filter(s => s > 1e-9 && s < span - 1e-9);
    const lo = Math.max(0, ...ss.filter(s => s < sc)), hi = Math.min(span, ...ss.filter(s => s > sc)), out: Shape[] = [];
    if (lo > 1e-9) out.push({ type: 'arc', c: e.c, r: e.r, a0: e.a0, a1: normA(e.a0 + lo) } as Shape);
    if (hi < span - 1e-9) out.push({ type: 'arc', c: e.c, r: e.r, a0: normA(e.a0 + hi), a1: e.a1 } as Shape);
    return out;
  }
  if (e.type === 'poly') return trimPath(e, click, cutters).map(pts => pts.length === 2 ? { type: 'line', a: pts[0], b: pts[1] } as Shape : { type: 'poly', closed: false, pts } as Shape);
  return null;
}

function segDist(p: Point, a: Point, b: Point) { const d = sub(b, a), L = dot(d, d); let t = L ? dot(sub(p, a), d) / L : 0; t = Math.max(0, Math.min(1, t)); return dist(p, add(a, mul(d, t))); }

/** Trim a polyline path as a whole between the two nearest cuts around the click. */
function trimPath(e: Extract<Shape, { type: 'poly' }>, raw: Point, cutters: Prim[]): Point[][] {
  const segs = prims(e) as Extract<Prim, { t: 'seg' }>[], n = segs.length, cum = [0];
  for (const s of segs) cum.push(cum[cum.length - 1] + dist(s.a, s.b));
  const total = cum[n], at = (i: number, t: number) => cum[i] + t * (cum[i + 1] - cum[i]);
  let bi = 0, bd = Infinity, bt = 0;
  segs.forEach((s, i) => { const d = sub(s.b, s.a), L = dot(d, d), t = L ? Math.max(0, Math.min(1, dot(sub(raw, s.a), d) / L)) : 0, q = dist(raw, add(s.a, mul(d, t))); if (q < bd) { bd = q; bi = i; bt = t; } });
  const sc = at(bi, bt), cutS: { s: number; p: Point }[] = [];
  segs.forEach((s, i) => {
    const x0 = Math.min(s.a.x, s.b.x) - 1e-6, x1 = Math.max(s.a.x, s.b.x) + 1e-6, y0 = Math.min(s.a.y, s.b.y) - 1e-6, y1 = Math.max(s.a.y, s.b.y) + 1e-6, d = sub(s.b, s.a), L = dot(d, d);
    for (const pr of cutters) {
      if (pr.t === 'seg' && (Math.max(pr.a.x, pr.b.x) < x0 || Math.min(pr.a.x, pr.b.x) > x1 || Math.max(pr.a.y, pr.b.y) < y0 || Math.min(pr.a.y, pr.b.y) > y1)) continue;
      for (const p of intersect(s, pr)) { const t = L ? dot(sub(p, s.a), d) / L : 0; cutS.push({ s: at(i, t), p: cp(p) }); }
    }
  });
  const pointAt = (s: number): Point => { if (s <= 0) return segs[0].a; if (s >= total) return segs[n - 1].b; let i = 0; while (i < n - 1 && cum[i + 1] < s) i++; const t = (s - cum[i]) / ((cum[i + 1] - cum[i]) || 1); return add(segs[i].a, mul(sub(segs[i].b, segs[i].a), t)); };
  const findP = (s: number) => cutS.find(c => Math.abs(c.s - s) < 1e-9)?.p || cp(pointAt(s));
  const piece = (s0: number, s1: number) => { const pts = [findP(s0)]; for (let i = 0; i <= n; i++) { const c = cum[i]; if (c > s0 + 1e-9 && c < s1 - 1e-9) pts.push(i < n ? segs[i].a : segs[n - 1].b); } pts.push(findP(s1)); return pts; };
  if (!e.closed) {
    const ss = cutS.map(c => c.s).filter(s => s > 1e-9 && s < total - 1e-9);
    const lo = Math.max(0, ...ss.filter(s => s < sc)), hi = Math.min(total, ...ss.filter(s => s > sc)), keep: Point[][] = [];
    if (lo > 1e-9) keep.push(piece(0, lo)); if (hi < total - 1e-9) keep.push(piece(hi, total)); return keep;
  }
  const ss = [...new Set(cutS.map(c => +(((c.s % total) + total) % total).toFixed(10)))];
  if (ss.length < 2) return [];
  const below = ss.filter(s => s < sc), above = ss.filter(s => s > sc);
  const lo = below.length ? Math.max(...below) : Math.max(...ss), hi = above.length ? Math.min(...above) : Math.min(...ss);
  const pts = [findP(hi)], walk: { s: number; p: Point }[] = [];
  for (let i = 0; i < n; i++) walk.push({ s: cum[i], p: segs[i].a });
  const to = lo > hi ? lo : lo + total;
  for (const w of walk.concat(walk.map(w => ({ s: w.s + total, p: w.p })))) if (w.s > hi + 1e-9 && w.s < to - 1e-9) pts.push(w.p);
  pts.push(findP(lo)); return [pts];
}
