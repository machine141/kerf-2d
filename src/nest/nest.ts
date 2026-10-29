/**
 * Nesting: fit many parts onto one sheet with little waste, using the parts' true outlines.
 *
 * Clean-room implementation of the standard no-fit-polygon (NFP) method:
 *  • every part's outline is grown by half the gap, so two grown outlines that
 *    just touch leave exactly the gap between the real parts;
 *  • for a part F about to be placed and a part A already placed, the positions p
 *    where F + p would overlap A are A ⊕ (−F) (a Minkowski sum, done by Clipper);
 *  • the positions that keep F on the sheet form a rectangle (inner-fit rectangle);
 *  • allowed positions = that rectangle minus every NFP; the corners of what is left
 *    are the tight positions, and the one that keeps the layout most compact wins.
 * Parts go biggest first; "try harder" re-runs with shuffled orders and keeps the best.
 */
import ClipperLib from 'clipper-lib';
import { type Point, P } from '../geometry/vec';
import { convexPieces, sumPieces } from './convex';

const L = ClipperLib, S = 1000;   // 1 µm
export type IP = { X: number; Y: number }[];
const toI = (pts: Point[]): IP => pts.map(p => ({ X: Math.round(p.x * S), Y: Math.round(p.y * S) }));
const fromI = (q: IP): Point[] => q.map(v => P(v.X / S, v.Y / S));

/** One kind of part, ready for nesting: its grown outline, centred on (0, 0). */
export interface NestShape {
  /** the outline grown by half the gap (holes filled), simplified, in µm */
  grown: IP[];
  /** the real outline (for drawing and the material figure), mm, centred */
  raw: Point[][];
  /** where the centre was in the drawing (the part's own coordinates) */
  centre: Point;
  /** real area, mm² */
  area: number;
  /** identical parts share NFPs */
  key: string;
}
export interface NestJob {
  shapes: NestShape[];
  /** how many of each (Infinity = as many as fit) */
  counts: number[];
  /** sheet size and margin from its edges, mm */
  W: number; H: number; margin: number;
  /** gap between parts, mm (the outlines are already grown by half of it) */
  gap: number;
  /** turns allowed, radians */
  angles: number[];
  /** things already on the sheet to keep clear of (grown outlines, µm, drawing coordinates) */
  fixed?: IP[];
}
export interface Placement { shape: number; angle: number; at: Point }
export interface NestResult {
  placed: Placement[];
  /** how many of each could not be placed (for counts that are finite) */
  missing: number[];
  /** real area of the placed parts ÷ usable sheet area */
  use: number;
  /** box round everything placed, mm [x0, y0, x1, y1] */
  box: [number, number, number, number] | null;
  score: number;
}

/** Union the closed outlines, fill holes, grow by d, then simplify (never cutting in by more than tol). */
export function growOutline(polys: Point[][], d: number, tol = 0.15): IP[] {
  if (!polys.length) return [];
  const c = new L.Clipper(), u = new L.Paths();
  c.AddPaths(polys.filter(p => p.length > 2).map(toI), L.PolyType.ptSubject, true);
  c.Execute(L.ClipType.ctUnion, u, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero);
  const outers = (u as IP[]).filter(q => L.Clipper.Orientation(q));
  const co = new L.ClipperOffset(2, 0.05 * S), g = new L.Paths();
  co.AddPaths(outers, L.JoinType.jtRound, L.EndType.etClosedPolygon); co.Execute(g, (d + tol) * S);
  // remove points that hardly change the outline (the extra tol growth keeps it covering the part)
  return (g as IP[]).map(q => dp(q, tol * S)).filter(q => q.length > 2);
}
/** Douglas–Peucker on a closed integer ring. */
function dp(q: IP, eps: number): IP {
  if (q.length < 8) return q;
  // start from the two points furthest apart so the ring splits cleanly
  let i0 = 0, i1 = 0, best = -1;
  for (let i = 0; i < q.length; i++) { const d = (q[i].X - q[0].X) ** 2 + (q[i].Y - q[0].Y) ** 2; if (d > best) { best = d; i1 = i; } }
  const keep = new Uint8Array(q.length); keep[i0] = keep[i1] = 1;
  const run = (a: number, b: number) => {
    const stack: [number, number][] = [[a, b]];
    while (stack.length) {
      const [s, e] = stack.pop()!, n = (e - s + q.length) % q.length; if (n < 2) continue;
      const A = q[s], B = q[e], dx = B.X - A.X, dy = B.Y - A.Y, L2 = dx * dx + dy * dy || 1;
      let far = -1, fi = -1;
      for (let k = 1; k < n; k++) { const i = (s + k) % q.length, p = q[i], t = Math.max(0, Math.min(1, ((p.X - A.X) * dx + (p.Y - A.Y) * dy) / L2)), d = Math.hypot(A.X + dx * t - p.X, A.Y + dy * t - p.Y); if (d > far) { far = d; fi = i; } }
      if (far > eps) { keep[fi] = 1; stack.push([s, fi], [fi, e]); }
    }
  };
  run(i0, i1); run(i1, i0);
  return q.filter((_, i) => keep[i]);
}

const rot = (q: IP, a: number): IP => { if (!a) return q; const c = Math.cos(a), s = Math.sin(a); return q.map(v => ({ X: Math.round(v.X * c - v.Y * s), Y: Math.round(v.X * s + v.Y * c) })); };
const neg = (q: IP): IP => q.map(v => ({ X: -v.X, Y: -v.Y }));
const boxI = (qs: IP[]) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of qs) for (const v of q) { if (v.X < x0) x0 = v.X; if (v.X > x1) x1 = v.X; if (v.Y < y0) y0 = v.Y; if (v.Y > y1) y1 = v.Y; } return { x0, y0, x1, y1 }; };
const shift = (q: IP, dx: number, dy: number): IP => q.map(v => ({ X: v.X + dx, Y: v.Y + dy }));

/** Positions (of F's origin) where F would overlap the outline set A (both µm). */
function nfp(A: IP[], F: IP[]): IP[] {
  // fast: convex pieces (cached per outline set); Clipper's quad method if a shape can't be split
  const pa = piecesOf(A), pf = piecesOf(F);
  if (pa && pf) return sumPieces(pa, pf.map(neg));
  const out: IP[] = [];
  for (const f of F) { const m = L.Clipper.MinkowskiSum(neg(f), A, true) as IP[]; out.push(...m); }
  return out;
}
const pieceCache = new WeakMap<IP[], IP[] | null>();
function piecesOf(set: IP[]): IP[] | null {
  if (pieceCache.has(set)) return pieceCache.get(set)!;
  let out: IP[] | null = [];
  for (const q of set) { const p = convexPieces(q); if (!p) { out = null; break; } out.push(...p); }
  pieceCache.set(set, out); return out;
}
/** The no-fit polygon by Clipper's own (slower) method, for checking. */
export function nfpClipper(A: IP[], F: IP[]): IP[] { const out: IP[] = []; for (const f of F) out.push(...(L.Clipper.MinkowskiSum(neg(f), A, true) as IP[])); return out; }
export { nfp as nfpFast };

/** A nesting run that places one part per step, so the page can stay responsive. */
export class Nester {
  private job: NestJob; private rotCache = new Map<string, IP[]>(); private freeCache = new Map<string, { free: IP[]; upTo: number }>(); private nfpCache: Map<string, IP[]>;
  private order: number[]; private i = 0; placed: Placement[] = []; private placedI: { s: number; a: number; at: { X: number; Y: number } }[] = [];
  private bb: { x0: number; y0: number; x1: number; y1: number } | null = null; private fails = new Set<string>();
  missing: number[]; done = false;
  /** the parts that did not fit, in order (for the next sheet) */
  left: number[] = [];
  constructor(job: NestJob, order: number[], nfpCache = new Map<string, IP[]>()) {
    this.job = job; this.order = order; this.nfpCache = nfpCache; this.missing = job.counts.map(() => 0);
  }
  private shape(s: number, a: number) { const k = s + '|' + a; let r = this.rotCache.get(k); if (!r) { r = this.job.shapes[s].grown.map(q => rot(q, a)); this.rotCache.set(k, r); } return r; }
  private rawCache = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();
  /** box round the real (not grown) outline at this turn, µm */
  private rawBox(s: number, a: number) { const k = s + '|' + a; let r = this.rawCache.get(k); if (!r) { r = boxI(this.job.shapes[s].raw.map(q => rot(toI(q), a))); this.rawCache.set(k, r); } return r; }
  private nfpOf(sA: number, aA: number, sB: number, aB: number) {
    // only the turn between the two parts matters: work it out with A unturned, then turn the answer
    const rel = ((aB - aA) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI), A = this.job.shapes[sA].key, B = this.job.shapes[sB].key;
    const k0 = A + '|' + B + '|' + rel.toFixed(5), k = k0 + '@' + aA.toFixed(5);
    let r = this.nfpCache.get(k); if (r) return r;
    let base = this.nfpCache.get(k0); if (!base) { base = nfp(this.shape(sA, 0), this.shape(sB, rel)); this.nfpCache.set(k0, base); }
    r = Math.abs(aA) < 1e-12 ? base : base.map(q => rot(q, aA)); this.nfpCache.set(k, r); return r;
  }
  /** Place the next part; false when finished. */
  step(): boolean {
    if (this.done) return false;
    if (this.i >= this.order.length) { this.done = true; return false; }
    const s = this.order[this.i++], j = this.job;
    // a part of a kind that has already failed at every angle will fail again
    if (this.fails.has(j.shapes[s].key)) { this.missing[s]++; this.left.push(s); return true; }
    let best: { a: number; X: number; Y: number; score: number } | null = null;
    for (const a of j.angles) {
      const F = this.shape(s, a), fb = boxI(F), rb = this.rawBox(s, a);
      // the inner-fit rectangle: where F's origin may go so the real part keeps the margin
      const rx0 = j.margin * S - rb.x0, rx1 = (j.W - j.margin) * S - rb.x1, ry0 = j.margin * S - rb.y0, ry1 = (j.H - j.margin) * S - rb.y1;
      if (rx1 < rx0 - 1 || ry1 < ry0 - 1) continue;
      // a part exactly as wide as the room leaves a zero-width rectangle: give it 1 µm so it still counts
      const rx1b = Math.max(rx1, rx0 + 2), ry1b = Math.max(ry1, ry0 + 2);
      const rect: IP = [{ X: Math.round(rx0), Y: Math.round(ry0) }, { X: Math.round(rx1b), Y: Math.round(ry0) }, { X: Math.round(rx1b), Y: Math.round(ry1b) }, { X: Math.round(rx0), Y: Math.round(ry1b) }];
      // the free room for this part at this turn, kept from step to step: only the newest parts are cut out of it
      const fk = s + '|' + a; let fr = this.freeCache.get(fk);
      if (!fr) {
        const c = new L.Clipper(), out = new L.Paths(); c.AddPath(rect, L.PolyType.ptSubject, true);
        if (j.fixed?.length) for (const q of nfp(j.fixed, F)) c.AddPath(q, L.PolyType.ptClip, true);
        c.Execute(L.ClipType.ctDifference, out, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero);
        fr = { free: out as IP[], upTo: 0 }; this.freeCache.set(fk, fr);
      }
      if (fr.upTo < this.placedI.length && fr.free.length) {
        const c = new L.Clipper(), out = new L.Paths(); c.AddPaths(fr.free, L.PolyType.ptSubject, true);
        for (let n = fr.upTo; n < this.placedI.length; n++) { const p = this.placedI[n]; for (const q of this.nfpOf(p.s, p.a, s, a)) c.AddPath(shift(q, p.at.X, p.at.Y), L.PolyType.ptClip, true); }
        c.Execute(L.ClipType.ctDifference, out, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero);
        fr.free = out as IP[];
      }
      fr.upTo = this.placedI.length;
      const free = fr.free;
      const cands: IP = ([] as IP).concat(...(free as IP[]));
      for (const v of cands) {
        const x0 = v.X + fb.x0, x1 = v.X + fb.x1, y0 = v.Y + fb.y0, y1 = v.Y + fb.y1;
        const B = this.bb ? { x0: Math.min(this.bb.x0, x0), x1: Math.max(this.bb.x1, x1), y0: Math.min(this.bb.y0, y0), y1: Math.max(this.bb.y1, y1) } : { x0, x1, y0, y1 };
        // keep the layout narrow (fills from the left, leaving a clean strip on the right), then low; then top-left
        const score = (B.x1 - B.x0) * 2 + (B.y1 - B.y0) + (v.X * 1e-3 - v.Y * 1e-4) * 1e-3;
        if (!best || score < best.score) best = { a, X: v.X, Y: v.Y, score };
      }
    }
    if (!best) { this.missing[s]++; this.left.push(s); this.fails.add(j.shapes[s].key); return true; }
    const F = this.shape(s, best.a), fb = boxI(F), x0 = best.X + fb.x0, x1 = best.X + fb.x1, y0 = best.Y + fb.y0, y1 = best.Y + fb.y1;
    this.bb = this.bb ? { x0: Math.min(this.bb.x0, x0), x1: Math.max(this.bb.x1, x1), y0: Math.min(this.bb.y0, y0), y1: Math.max(this.bb.y1, y1) } : { x0, x1, y0, y1 };
    this.placedI.push({ s, a: best.a, at: { X: best.X, Y: best.Y } });
    this.placed.push({ shape: s, angle: best.a, at: P(best.X / S, best.Y / S) });
    return true;
  }
  /** how far through, 0..1 */
  get progress() { return this.order.length ? this.i / this.order.length : 1; }
  result(): NestResult {
    const j = this.job, usable = Math.max(1e-9, (j.W - 2 * j.margin) * (j.H - 2 * j.margin));
    const area = this.placed.reduce((t, p) => t + j.shapes[p.shape].area, 0);
    const box: NestResult['box'] = this.bb ? [this.bb.x0 / S + j.gap / 2, this.bb.y0 / S + j.gap / 2, this.bb.x1 / S - j.gap / 2, this.bb.y1 / S - j.gap / 2] : null;
    const missing = this.missing.map((m, i) => j.counts[i] === Infinity ? 0 : m);
    // better = more parts placed, then a smaller box round them
    const score = -this.placed.length * 1e9 + (box ? ((box[2] - box[0]) * 2 + (box[3] - box[1])) : 0);
    return { placed: this.placed.slice(), missing, use: area / usable, box, score };
  }
}

/** The parts to place, biggest first (copies of one part together). "Fill" kinds get as many as could fit by area. */
export function nestOrder(job: NestJob, rnd?: () => number): number[] {
  const usable = (job.W - 2 * job.margin) * (job.H - 2 * job.margin);
  const kinds = job.shapes.map((s, i) => i);
  const grownArea = (i: number) => job.shapes[i].grown.reduce((t, q) => t + Math.abs(L.Clipper.Area(q)), 0) / (S * S);
  if (rnd) {
    // a shuffle that mostly keeps big parts early
    const w = kinds.map(i => grownArea(i) * (0.6 + rnd() * 0.8)); kinds.sort((a, b) => w[b] - w[a]);
  } else kinds.sort((a, b) => grownArea(b) - grownArea(a));
  const out: number[] = [];
  for (const k of kinds) { const n = job.counts[k] === Infinity ? Math.min(2000, Math.floor(usable / Math.max(1e-6, grownArea(k))) + 1) : job.counts[k]; for (let c = 0; c < n; c++) out.push(k); }
  if (rnd && out.length > 2) for (let t = 0; t < out.length / 4; t++) { const i = Math.floor(rnd() * (out.length - 1)); if (out[i] !== out[i + 1]) [out[i], out[i + 1]] = [out[i + 1], out[i]]; }
  return out;
}

/** A layout over several sheets: each sheet takes what the one before could not fit. */
export interface MultiResult { sheets: NestResult[]; placed: number; missing: number[]; score: number }
/** Nest onto as many sheets as needed (up to maxSheets); parts too big for a sheet are reported missing. */
export class MultiNester {
  private job: NestJob; private cache: Map<string, IP[]>; private maxSheets: number;
  private cur: Nester; private done: NestResult[] = []; finished = false;
  constructor(job: NestJob, order: number[], cache = new Map<string, IP[]>(), maxSheets = 20) {
    this.job = job; this.cache = cache; this.maxSheets = maxSheets; this.cur = new Nester(job, order, cache);
  }
  step(): boolean {
    if (this.finished) return false;
    if (this.cur.step()) return true;
    const r = this.cur.result(); this.done.push(r);
    const left = this.cur.left;
    // next sheet: only if something is left and the last sheet managed to take something (else they never fit)
    if (!left.length || !r.placed.length || this.done.length >= this.maxSheets) { this.finished = true; return false; }
    // things already on the sheet only matter on the first one
    this.cur = new Nester({ ...this.job, fixed: undefined }, left, this.cache);
    return true;
  }
  get sheet() { return this.done.length; }
  get progress() { const total = this.job.counts.reduce((a, b) => a + (b === Infinity ? 0 : b), 0) || 1; return Math.min(1, (this.done.reduce((t, r) => t + r.placed.length, 0) + this.cur.placed.length) / total); }
  result(): MultiResult {
    const sheets = this.finished ? this.done.slice() : [...this.done, this.cur.result()];
    const last = sheets[sheets.length - 1];
    const missing = this.job.counts.map(() => 0); if (this.finished && last) last.missing.forEach((m, i) => missing[i] = this.job.counts[i] === Infinity ? 0 : m);
    // with nothing placed on the last sheet, what it reports missing never fits anywhere
    const used = sheets.filter(r => r.placed.length), placed = used.reduce((t, r) => t + r.placed.length, 0);
    const lb = used[used.length - 1]?.box, score = -placed * 1e9 + used.length * 1e6 + (lb ? (lb[2] - lb[0]) * 2 + (lb[3] - lb[1]) : 0);
    return { sheets: used, placed, missing, score };
  }
}

/** Run a whole nesting at once (tests, small jobs). */
export function nestNow(job: NestJob, rnd?: () => number, cache?: Map<string, IP[]>): NestResult {
  const n = new Nester(job, nestOrder(job, rnd), cache); while (n.step()); return n.result();
}

/** Where a part's own coordinates go: turn by angle about its centre, then move the centre to `at`. */
export function placeTransform(centre: Point, angle: number, at: Point) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { a: c, b: -s, c: s, d: c, e: at.x - (c * centre.x - s * centre.y), f: at.y - (s * centre.x + c * centre.y) };
}
/** Several sheets at once (tests). */
export function nestSheets(job: NestJob, rnd?: () => number, maxSheets = 20): MultiResult {
  const n = new MultiNester(job, nestOrder(job, rnd), new Map(), maxSheets); while (n.step()); return n.result();
}
export const fromIP = fromI;
export const toIP = toI;
/** A seeded random number generator (repeatable "try harder" runs). */
export function rng(seed: number) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
