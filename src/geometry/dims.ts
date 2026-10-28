/** Dimension geometry: extension lines, dimension line, arrows and label placement. */
import { type Point, P, add, sub, mul, dot, len, dist, rotP, DEG, fmt } from './vec';
import type { DimEnt, DimStyle } from '../model/types';

export interface DimGeom { lines: [Point, Point][]; val: number; text: { p: Point; ang: number; str: string; h: number } }

/** A length as the dimension style shows it: "20 mm", "0.787 in" or plain "20". */
export function dimValue(v: number, D: Pick<DimStyle, 'dec' | 'unit'>): string {
  if (D.unit === 'in') return `${fmt(v / 25.4, D.dec + 1)} in`;
  return D.unit === 'none' ? fmt(v, D.dec) : `${fmt(v, D.dec)} mm`;
}

export function dimGeom(e: Pick<DimEnt, 'mode' | 'p1' | 'p2' | 'off' | 'text'>, D: DimStyle): DimGeom {
  if (e.mode === 'r' || e.mode === 'd') return radialGeom(e, D);
  let d1: Point, d2: Point, val: number;
  if (e.mode === 'h') { d1 = P(e.p1.x, e.off.y); d2 = P(e.p2.x, e.off.y); val = Math.abs(e.p2.x - e.p1.x); }
  else if (e.mode === 'v') { d1 = P(e.off.x, e.p1.y); d2 = P(e.off.x, e.p2.y); val = Math.abs(e.p2.y - e.p1.y); }
  else { const v = sub(e.p2, e.p1), L = len(v) || 1, u = mul(v, 1 / L), n = P(-u.y, u.x), o = dot(sub(e.off, e.p1), n); d1 = add(e.p1, mul(n, o)); d2 = add(e.p2, mul(n, o)); val = L; }
  const lines: [Point, Point][] = [];
  const ext = (p: Point, q: Point) => { const v = sub(q, p), L = len(v); if (L < 1e-9) return; const w = mul(v, 1 / L); lines.push([add(p, mul(w, Math.min(1, L))), add(q, mul(w, 1.5))]); };
  ext(e.p1, d1); ext(e.p2, d2);
  lines.push([d1, d2]);
  const dl = dist(d1, d2) || 1, w = mul(sub(d2, d1), 1 / dl);
  arrow(lines, d1, w, D.arrow); arrow(lines, d2, mul(w, -1), D.arrow);
  let ang = Math.atan2(w.y, w.x); if (ang > Math.PI / 2 + 1e-9) ang -= Math.PI; if (ang <= -Math.PI / 2 + 1e-9) ang += Math.PI;
  const mid = mul(add(d1, d2), .5), nrm = P(-Math.sin(ang), Math.cos(ang));
  return { lines, val, text: { p: add(mid, mul(nrm, 1)), ang, str: e.text || dimValue(val, D), h: D.textH } };
}

/** Arrowhead with its tip at `tip`, opening towards `dir`. */
function arrow(lines: [Point, Point][], tip: Point, dir: Point, A: number) {
  const sp = 15 * DEG;
  lines.push([tip, add(tip, mul(rotP(dir, P(0, 0), sp), A))], [tip, add(tip, mul(rotP(dir, P(0, 0), -sp), A))]);
}

/**
 * Radius / diameter: a leader through the centre towards the label, arrows on
 * the circle, a small centre mark, and a horizontal shelf under the label
 * ("R10 mm" or "Ø20 mm"), like Onshape and Fusion 360.
 */
function radialGeom(e: Pick<DimEnt, 'mode' | 'p1' | 'p2' | 'off' | 'text'>, D: DimStyle): DimGeom {
  const c = e.p1, r = dist(e.p1, e.p2), dia = e.mode === 'd', A = D.arrow;
  let v = sub(e.off, c); if (len(v) < 1e-9) v = P(1, 1);
  const u = mul(v, 1 / len(v)), far = dist(e.off, c), T1 = add(c, mul(u, r)), T2 = sub(c, mul(u, r)), outside = far > r + 1e-9;
  const lines: [Point, Point][] = [];
  lines.push([dia ? T2 : c, outside ? e.off : T1]);
  arrow(lines, T1, outside ? u : mul(u, -1), A);
  if (dia) arrow(lines, T2, u, A);
  const m = Math.min(A, r * 0.3); lines.push([P(c.x - m, c.y), P(c.x + m, c.y)], [P(c.x, c.y - m), P(c.x, c.y + m)]);
  const val = dia ? 2 * r : r, str = e.text || `${dia ? 'Ø' : 'R'}${dimValue(val, D)}`;
  const w = str.length * D.textH * 0.6 + 1, sg = u.x >= 0 ? 1 : -1;
  lines.push([e.off, P(e.off.x + sg * w, e.off.y)]);
  return { lines, val, text: { p: P(e.off.x + sg * w / 2, e.off.y + 0.8), ang: 0, str, h: D.textH } };
}
