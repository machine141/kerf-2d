/**
 * Laser job simulation for the preview player and the time estimate (clean-room).
 *
 * The job is placed on the bed (bed coordinates: x from the left, y from the BACK, in mm),
 * then turned into a timeline of moves: laser-off travel, cut/score lines, engraved areas (scan rows).
 * Times use a simple motion model: straight runs accelerate to the set speed and slow for corners;
 * engraving rows add a turnaround at each end. It is an estimate; the machine's own acceleration
 * values (read at the machine later) make it closer.
 */
import { type Point, P, dist } from '../geometry/vec';
import type { LPath, Phase } from './order';
import { sampleSegs } from './segs';

export interface PhaseSet { speed: number; power: number; passes: number; air: boolean; on: boolean; interval?: number }
export type JobSettings = Record<Phase, PhaseSet>;
export interface Motion { rapid: number; accel: number; scanAccel: number }
export const DEFAULT_MOTION: Motion = { rapid: 300, accel: 3000, scanAccel: 8000 };

export type Step =
  | { k: 'travel'; pts: Point[]; t0: number; dur: number; len: number }
  | { k: 'line'; pts: Point[]; t0: number; dur: number; len: number; phase: Phase; key: string; pass: number }
  | { k: 'area'; rings: Point[][]; rows: number; y0: number; y1: number; t0: number; dur: number; len: number; phase: Phase; key: string; pass: number };

export interface Sim { steps: Step[]; total: number; cutLen: number; travelLen: number; cutTime: number; travelTime: number; engraveTime: number; start: Point; end: Point; box: { x0: number; y0: number; x1: number; y1: number } | null }

/** Time to move a straight distance d from rest to rest (accelerate, cruise at v, slow down). */
export function runTime(d: number, v: number, a: number): number {
  if (d <= 0 || v <= 0) return 0;
  const dAcc = v * v / a;          // distance to speed up and slow down again
  return d >= dAcc ? d / v + v / a : 2 * Math.sqrt(d / a);
}
/** Time along a polyline at speed v: the straight-line time plus a slow-down for every corner (sharper = longer). */
export function lineTime(pts: Point[], v: number, a: number): number {
  let L = 0, extra = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  for (let i = 1; i + 1 < pts.length; i++) {
    const ux = pts[i].x - pts[i - 1].x, uy = pts[i].y - pts[i - 1].y, wx = pts[i + 1].x - pts[i].x, wy = pts[i + 1].y - pts[i].y;
    const lu = Math.hypot(ux, uy), lw = Math.hypot(wx, wy); if (lu < 1e-9 || lw < 1e-9) continue;
    const turn = Math.acos(Math.max(-1, Math.min(1, (ux * wx + uy * wy) / (lu * lw))));
    if (turn > 0.05) extra += (turn / Math.PI) * v / a;      // a right angle costs half a full stop-and-go
  }
  return runTime(L, v, a) + extra;
}
const polyLen = (pts: Point[]) => { let L = 0; for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]); return L; };

/** Lengths of the scan rows across an area (even-odd), every `step` mm from top to bottom. */
export function scanRows(rings: Point[][], step: number): { y: number; len: number; x0: number; x1: number }[] {
  let y0 = Infinity, y1 = -Infinity; for (const r of rings) for (const p of r) { y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const out: { y: number; len: number; x0: number; x1: number }[] = [];
  for (let y = y0 + step / 2; y < y1; y += step) {
    const xs: number[] = [];
    for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a.y > y) !== (b.y > y)) xs.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y)); }
    xs.sort((p, q) => p - q); let len = 0; for (let i = 0; i + 1 < xs.length; i += 2) len += xs[i + 1] - xs[i];
    if (len > 0) out.push({ y, len, x0: xs[0], x1: xs[xs.length - 1] });
  }
  return out;
}

/** A drawing placed on the bed: the top-left of the box `box` (drawing coords, y up) goes to `at` (bed coords, y from the back). */
export function placement(box: { x0: number; y0: number; x1: number; y1: number }, at: Point) {
  return {
    toBed: (p: Point) => P(at.x + (p.x - box.x0), at.y + (box.y1 - p.y)),
    toDoc: (q: Point) => P(box.x0 + (q.x - at.x), box.y1 - (q.y - at.y)),
  };
}

/** Build the timeline for a drawing's laser paths (already in cut order) placed on the bed with these settings. */
export function simulate(ps: LPath[], B: (p: Point) => Point, set: JobSettings | ((p: LPath) => PhaseSet | undefined), start: Point, m: Motion = DEFAULT_MOTION): Sim {
  const setOf = typeof set === 'function' ? set : (p: LPath) => set[p.phase];
  const steps: Step[] = []; let t = 0, head = start, cutLen = 0, travelLen = 0, cutTime = 0, travelTime = 0, engraveTime = 0;
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity; const grow = (p: Point) => { bx0 = Math.min(bx0, p.x); by0 = Math.min(by0, p.y); bx1 = Math.max(bx1, p.x); by1 = Math.max(by1, p.y); };
  const travel = (to: Point) => { const d = dist(head, to); if (d < 1e-6) return; const dur = runTime(d, m.rapid, m.accel); steps.push({ k: 'travel', pts: [head, to], t0: t, dur, len: d }); t += dur; travelLen += d; travelTime += dur; head = to; };
  for (const p of ps) {
    const s0 = setOf(p); if (!s0 || !s0.on) continue;
    // a pass written out on its own (start somewhere different each pass) is done once
    const s = p.onePass ? { ...s0, passes: 1 } : s0;
    if (p.kind === 'area') {
      const rings = p.rings.map(r => sampleSegs(r, 0.05).map(B)), step = Math.max(0.02, s.interval ?? 0.1), rows = scanRows(rings, step);
      if (!rows.length) continue; rings.flat().forEach(grow);
      for (let pass = 0; pass < Math.max(1, s.passes); pass++) {
        travel(P(rows[0].x0, rows[0].y));
        // each row: across at engraving speed, with a turnaround at the end
        let dur = 0, len = 0; for (const r of rows) { dur += (r.x1 - r.x0) / s.speed + 2 * s.speed / m.scanAccel; len += r.len; }
        dur += (rows[rows.length - 1].y - rows[0].y) / m.rapid;
        steps.push({ k: 'area', rings, rows: rows.length, y0: rows[0].y, y1: rows[rows.length - 1].y, t0: t, dur, len, phase: p.phase, key: String(p.key), pass });
        t += dur; engraveTime += dur; cutLen += len; head = P(rows[rows.length - 1].x1, rows[rows.length - 1].y);
      }
      continue;
    }
    const pts = sampleSegs(p.rings[0], 0.05).map(B); if (pts.length < 2) continue; pts.forEach(grow);
    for (let pass = 0; pass < Math.max(1, s.passes); pass++) {
      travel(pts[0]);
      const dur = lineTime(pts, s.speed, m.accel), len = polyLen(pts);
      steps.push({ k: 'line', pts, t0: t, dur, len, phase: p.phase, key: String(p.key), pass });
      t += dur; cutLen += len; cutTime += dur; head = pts[pts.length - 1];
      if (p.closed) head = pts[pts.length - 1];
    }
  }
  return { steps, total: t, cutLen, travelLen, cutTime, travelTime, engraveTime, start, end: head, box: bx0 <= bx1 ? { x0: bx0, y0: by0, x1: bx1, y1: by1 } : null };
}

/** "12 min 30 s" style. */
export function fmtTime(s: number): string {
  if (!isFinite(s)) return '–';
  s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h} h ${m} min` : m ? `${m} min ${String(r).padStart(2, '0')} s` : `${r} s`;
}
/** Clock style for the player: 2:05 or 1:02:05. */
export function clock(s: number): string {
  s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
