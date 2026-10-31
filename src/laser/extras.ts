/**
 * Cutting extras, applied to the job after it is put in cut order (so the preview, the time and the
 * LightBurn file all show the same thing):
 *  • Test piece first: a small square with a hole, cut before anything else, beside the job, with the
 *    job's own cut colour (same LightBurn layer, same settings). If it doesn't drop out cleanly, stop the job.
 *  • Start somewhere different each pass: with 2 or more passes, each pass of a closed cut starts at
 *    another corner (or further round a curve), so the start/stop mark and its heat aren't in one place.
 *    The passes are written out one by one, so LightBurn's own Passes must be 1 for those layers.
 *  • Tabs: small uncut bridges on each part's outline (not on holes), so parts stay in the sheet.
 */
import { type Point, P, dist } from '../geometry/vec';
import { type Seg, ellAt, sampleSegs, turnAt, arcSegs } from './segs';
import { isInside, type LPath } from './order';
import type { LaserKey } from './palette';

// ---------------------------------------------------------------- lengths and cutting segments
const lerp = (a: Point, b: Point, t: number) => P(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
/** length of one segment (arcs and curves measured along short chords) */
export function segLen(s: Seg): number {
  if (s.k === 'L') return dist(s.a, s.b);
  if (s.k === 'A' && Math.abs(s.rx - s.ry) < 1e-9) return s.rx * Math.abs(s.sweep);
  // ellipse arcs and curves: add up many short chords (plenty for tab and start positions)
  const n = 256; let L = 0, prev = s.a;
  for (let i = 1; i <= n; i++) { const q = subSeg(s, 0, i / n).b; L += dist(prev, q); prev = q; }
  return L;
}
/** the part of a segment between fractions u0 and u1 of the way along it (by parameter; exact for lines and circles) */
export function subSeg(s: Seg, u0: number, u1: number): Seg {
  if (s.k === 'L') return { k: 'L', a: lerp(s.a, s.b, u0), b: lerp(s.a, s.b, u1) };
  if (s.k === 'A') { const l = { c: s.c, rx: s.rx, ry: s.ry, rot: s.rot }, t0 = s.t0 + s.sweep * u0, sw = s.sweep * (u1 - u0); return { ...s, a: ellAt(l, t0), b: ellAt(l, t0 + sw), t0, sweep: sw }; }
  // cubic: de Casteljau twice
  const split = (a: Point, c1: Point, c2: Point, b: Point, t: number) => {
    const p01 = lerp(a, c1, t), p12 = lerp(c1, c2, t), p23 = lerp(c2, b, t), p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t), m = lerp(p012, p123, t);
    return { left: [a, p01, p012, m], right: [m, p123, p23, b] };
  };
  const r = split(s.a, s.c1, s.c2, s.b, u0).right, t = u0 < 1 ? (u1 - u0) / (1 - u0) : 0, l = split(r[0], r[1], r[2], r[3], t).left;
  return { k: 'C', a: l[0], c1: l[1], c2: l[2], b: l[3] };
}
/** total length, and the length at the start of each segment */
export function measure(ss: Seg[]): { L: number; at: number[]; lens: number[] } {
  const lens = ss.map(segLen), at: number[] = []; let L = 0; for (const l of lens) { at.push(L); L += l; } return { L, at, lens };
}
/** the piece of a path from distance d0 to d1 along it (0 ≤ d0 < d1 ≤ L) */
export function cutRange(ss: Seg[], d0: number, d1: number, m = measure(ss)): Seg[] {
  const out: Seg[] = [];
  ss.forEach((s, i) => {
    const a = m.at[i], b = a + m.lens[i]; if (b <= d0 + 1e-9 || a >= d1 - 1e-9 || m.lens[i] < 1e-12) return;
    const u0 = Math.max(0, (d0 - a) / m.lens[i]), u1 = Math.min(1, (d1 - a) / m.lens[i]);
    out.push(u0 <= 1e-9 && u1 >= 1 - 1e-9 ? s : subSeg(s, u0, u1));
  });
  return out;
}
/** a closed path started at distance d instead (same shape, same direction) */
export function startAt(ss: Seg[], d: number, m = measure(ss)): Seg[] {
  d = ((d % m.L) + m.L) % m.L; if (d < 1e-6 || m.L - d < 1e-6) return ss;
  return [...cutRange(ss, d, m.L, m), ...cutRange(ss, 0, d, m)];
}
/** distances along a closed path where it has a corner (turns by more than ~30°) */
export function cornersOf(ss: Seg[], m = measure(ss)): number[] {
  const out: number[] = [];
  ss.forEach((s, i) => { const prev = ss[(i - 1 + ss.length) % ss.length]; if (turnAt(prev, s) > 0.5) out.push(m.at[i]); });
  return out;
}

// ---------------------------------------------------------------- the three extras
export interface Extras {
  /** settings for each colour: how many passes (for spreading the starts) */
  passesOf?: (p: LPath) => number;
  spreadStarts?: boolean;
  tabs?: { n: number; w: number } | null;
  test?: { at: Point; key: LaserKey; size?: number } | null;
}

/**
 * Where each pass starts on a closed path of length L: spread evenly round it, moved to the nearest corner
 * when there is one (a start/stop mark on a corner hardly shows). Pass 1 keeps the start the cut order chose.
 */
export function passStarts(ss: Seg[], passes: number): number[] {
  const m = measure(ss), cs = cornersOf(ss, m), out = [0];
  for (let k = 1; k < passes; k++) {
    const want = m.L * k / passes;
    if (cs.length > 1) {
      const free = cs.filter(c => !out.some(o => Math.abs(o - c) < 1e-6)), pool = free.length ? free : cs;
      out.push(pool.reduce((b, c) => Math.abs(c - want) < Math.abs(b - want) ? c : b, pool[0]));
    } else out.push(want);
  }
  return out;
}

const withRing = (p: LPath, ring: Seg[], closed: boolean, extra: Partial<LPath> = {}): LPath => ({ ...p, rings: [ring], closed, ...extra });

/**
 * Tabs: an outline cut as open pieces with n gaps w mm wide, spread evenly round it (centred at 1/2n, 3/2n … of the way round).
 * The laser still starts at the chosen corner and goes all the way round, jumping each gap. Small shapes are left whole.
 */
export function tabPieces(ss: Seg[], n: number, w: number): Seg[][] | null {
  const m = measure(ss); if (n < 1 || w <= 0 || m.L < n * w * 4) return null;
  const step = m.L / n, cuts: [number, number][] = []; let from = 0;
  for (let i = 0; i < n; i++) { const g = step * (i + 0.5); cuts.push([from, g - w / 2]); from = g + w / 2; }
  cuts.push([from, m.L]);
  return cuts.filter(([a, b]) => b - a > 1e-6).map(([a, b]) => cutRange(ss, a, b, m));
}

/** The small test square with a round hole, as two cut paths (hole first). `at` = top-left in drawing coordinates (y up). */
export function testPiecePaths(at: Point, key: LaserKey, size = 10): LPath[] {
  const s = size, x = at.x, y = at.y - s, hole = s * 0.35;
  const sq: Seg[] = [{ k: 'L', a: P(x, y + s), b: P(x + s, y + s) }, { k: 'L', a: P(x + s, y + s), b: P(x + s, y) }, { k: 'L', a: P(x + s, y), b: P(x, y) }, { k: 'L', a: P(x, y), b: P(x, y + s) }];
  const c = P(x + s / 2, y + s / 2), loop = { c, rx: hole / 2, ry: hole / 2, rot: 0 };
  const mk = (ring: Seg[], ids: string[], lp?: typeof loop): LPath => { const pts = sampleSegs(ring); return { kind: 'stroke', key, phase: 'cut', w: 0.1, rings: [ring], closed: true, loop: lp, ids, pts, box: { x0: Math.min(...pts.map(q => q.x)), y0: Math.min(...pts.map(q => q.y)), x1: Math.max(...pts.map(q => q.x)), y1: Math.max(...pts.map(q => q.y)) }, test: true }; };
  return [mk(arcSegs(loop, Math.PI, Math.PI * 2), ['test-hole'], loop), mk(sq, ['test-square'])];
}

/** Apply the extras to paths already in cut order. */
export function applyExtras(paths: LPath[], o: Extras): LPath[] {
  let out: LPath[] = [];
  const outlines = paths.filter(p => p.phase === 'cut' && p.kind === 'stroke' && p.closed);
  for (const p of paths) {
    const isOutline = p.phase === 'cut' && p.kind === 'stroke' && p.closed && !outlines.some(q => q !== p && isInside(p, q));
    if (o.tabs && isOutline) { const ps = tabPieces(p.rings[0], o.tabs.n, o.tabs.w); if (ps) { for (const r of ps) out.push(withRing(p, r, false, { tabbed: true })); continue; } }
    const n = o.passesOf?.(p) ?? 1;
    if (o.spreadStarts && n > 1 && p.kind === 'stroke' && p.closed && p.phase !== 'engrave') {
      const m = measure(p.rings[0]);
      for (const d of passStarts(p.rings[0], n)) out.push(withRing(p, startAt(p.rings[0], d, m), true, { onePass: true }));
      continue;
    }
    out.push(p);
  }
  if (o.test) out = [...testPiecePaths(o.test.at, o.test.key, o.test.size), ...out];
  return out;
}
