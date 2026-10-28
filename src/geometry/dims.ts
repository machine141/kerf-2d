/** Dimension geometry: extension lines, dimension line, arrows and label placement. */
import { type Point, P, add, sub, mul, dot, len, dist, rotP, DEG, fmt } from './vec';
import type { DimEnt, DimStyle } from '../model/types';

export interface DimGeom { lines: [Point, Point][]; val: number; text: { p: Point; ang: number; str: string; h: number } }

export function dimGeom(e: Pick<DimEnt, 'mode' | 'p1' | 'p2' | 'off' | 'text'>, D: DimStyle): DimGeom {
  let d1: Point, d2: Point, val: number;
  if (e.mode === 'h') { d1 = P(e.p1.x, e.off.y); d2 = P(e.p2.x, e.off.y); val = Math.abs(e.p2.x - e.p1.x); }
  else if (e.mode === 'v') { d1 = P(e.off.x, e.p1.y); d2 = P(e.off.x, e.p2.y); val = Math.abs(e.p2.y - e.p1.y); }
  else { const v = sub(e.p2, e.p1), L = len(v) || 1, u = mul(v, 1 / L), n = P(-u.y, u.x), o = dot(sub(e.off, e.p1), n); d1 = add(e.p1, mul(n, o)); d2 = add(e.p2, mul(n, o)); val = L; }
  const lines: [Point, Point][] = [];
  const ext = (p: Point, q: Point) => { const v = sub(q, p), L = len(v); if (L < 1e-9) return; const w = mul(v, 1 / L); lines.push([add(p, mul(w, Math.min(1, L))), add(q, mul(w, 1.5))]); };
  ext(e.p1, d1); ext(e.p2, d2);
  lines.push([d1, d2]);
  const dl = dist(d1, d2) || 1, w = mul(sub(d2, d1), 1 / dl), A = D.arrow, sp = 15 * DEG;
  for (const [tip, dir] of [[d1, w], [d2, mul(w, -1)]] as [Point, Point][]) {
    lines.push([tip, add(tip, mul(rotP(dir, P(0, 0), sp), A))], [tip, add(tip, mul(rotP(dir, P(0, 0), -sp), A))]);
  }
  let ang = Math.atan2(w.y, w.x); if (ang > Math.PI / 2 + 1e-9) ang -= Math.PI; if (ang <= -Math.PI / 2 + 1e-9) ang += Math.PI;
  const mid = mul(add(d1, d2), .5), nrm = P(-Math.sin(ang), Math.cos(ang));
  return { lines, val, text: { p: add(mid, mul(nrm, 1)), ang, str: e.text || fmt(val, D.dec), h: D.textH } };
}
