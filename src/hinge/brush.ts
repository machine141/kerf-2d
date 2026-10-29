/**
 * Hinge brush engine (clean-room). Pupils paint where a part should bend; this
 * turns the painted areas into living-hinge slits.
 *
 * Every way of marking (brush stroke, fold line, clicked area) gives:
 *  • a mask — the painted area, kept clear of every drawn line by the edge gap,
 *    only inside the part (inside at least one closed outline), minus areas that
 *    have priority over it (earlier paint wins; "Paint over" makes new paint win;
 *    a solid strip is left where two different patterns meet);
 *  • a direction — along the stroke, across the fold line, along the area's
 *    length, or round / out from a centre.
 * Slits are dashes laid along lines that run across the bend direction, rows
 * alternating by half a step (so they bend instead of falling apart), then
 * clipped to the mask. "Paint the way you want it to bend."
 */
import ClipperLib from 'clipper-lib';
import { type Point, P, add, sub, mul, len, dist } from '../geometry/vec';
import type { HingeMark, HingePattern } from '../model/types';

const L = ClipperLib, S = 1000;
type IP = { X: number; Y: number }[];
const toI = (pts: Point[]): IP => pts.map(p => ({ X: Math.round(p.x * S), Y: Math.round(p.y * S) }));
const fromI = (q: IP): Point[] => q.map(v => P(v.X / S, v.Y / S));

export interface PatternInfo { id: HingePattern; label: string; fill: string; edge: string; note: string }
/** Pastel, see-through colours: one per pattern. */
export const HINGE_PATTERNS: PatternInfo[] = [
  { id: 'straight', label: 'Straight', fill: '#8fb8ff', edge: '#4a7fd6', note: 'straight slits — bends one way, like rolling a tube' },
  { id: 'wavy', label: 'Wavy', fill: '#8fe0bf', edge: '#3fa27a', note: 'wavy slits — bends more smoothly, less likely to crack' },
  { id: 'rings', label: 'Circles', fill: '#ffaac4', edge: '#d65f86', note: 'circles round a centre — petals curl out' },
  { id: 'spokes', label: 'Spokes', fill: '#f4b0f0', edge: '#b85ab3', note: 'spokes out from a centre — curls round the centre' },
  { id: 'fold', label: 'Fold', fill: '#ffe680', edge: '#c9a400', note: 'a few tight rows — a crisp fold along a line' },
];
export const patternInfo = (id: HingePattern) => HINGE_PATTERNS.find(p => p.id === id) || HINGE_PATTERNS[0];

export interface BrushSettings { pitch: number; slit: number; bridge: number; edge: number }
export const BRUSH_DEFAULTS: BrushSettings = { pitch: 2.5, slit: 15, bridge: 3, edge: 3 };

/** What the painting is checked against: every drawn line (kept clear of) and the closed outlines (the part). */
export interface HingeEnv { lines: { pts: Point[]; closed: boolean }[] }

export interface HingeArea { index: number; pattern: HingePattern; mask: Point[][]; slits: Point[][]; arrow: { p: Point; d: Point } | null; centre?: Point }

// ---------------- clipper helpers ----------------
function offsetOpen(paths: Point[][], d: number, end: number): IP[] {
  const co = new L.ClipperOffset(2, 0.02 * S), out = new L.Paths();
  for (const p of paths) { const ip = toI(p.length === 1 ? [p[0], add(p[0], P(1e-3, 0))] : p); co.AddPath(ip, L.JoinType.jtRound, end); }
  co.Execute(out, d * S); return out as IP[];
}
function clip(ct: number, a: IP[], b: IP[]): IP[] {
  if (!a.length) return [];
  if (!b.length && ct === L.ClipType.ctDifference) return a;
  const c = new L.Clipper(), out = new L.Paths();
  c.AddPaths(a, L.PolyType.ptSubject, true); if (b.length) c.AddPaths(b, L.PolyType.ptClip, true);
  c.Execute(ct, out, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero); return out as IP[];
}
const union = (a: IP[]) => clip(L.ClipType.ctUnion, a, []);
function grow(a: IP[], d: number): IP[] { if (!a.length || d <= 0) return a; const co = new L.ClipperOffset(2, 0.02 * S), out = new L.Paths(); co.AddPaths(a, L.JoinType.jtRound, L.EndType.etClosedPolygon); co.Execute(out, d * S); return out as IP[]; }

/** The area a mark covers (before anything is taken away). */
export function markShape(m: HingeMark): IP[] {
  if (m.kind === 'brush' || m.kind === 'erase') return offsetOpen([m.pts], m.r, L.EndType.etOpenRound);
  if (m.kind === 'fold') return offsetOpen([[m.a, m.b]], m.w / 2, L.EndType.etOpenButt);
  const ip = toI(m.pts); if (!L.Clipper.Orientation(ip)) ip.reverse(); return [ip];
}

/**
 * Holes: closed outlines lying wholly inside another closed outline and touching
 * no other line (eyes, the middle of a donut) — paint over them makes no slits.
 */
function holesOf(lines: { pts: Point[]; closed: boolean }[]): IP[] {
  const box = (p: Point[]) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of p) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); } return { x0, y0, x1, y1 }; };
  const closed = lines.filter(l => l.closed && l.pts.length > 2), boxes = lines.map(l => box(l.pts)), ints = closed.map(l => toI(l.pts)), out: IP[] = [];
  const cross = (a: Point, b: Point, c: Point, d: Point) => { const o = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x); return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0; };
  closed.forEach((l, i) => {
    const bi = box(l.pts);
    const inside = closed.some((o, j) => j !== i && l.pts.every((q, k) => k % Math.max(1, Math.floor(l.pts.length / 8)) !== 0 || L.Clipper.PointInPolygon(toI([q])[0], ints[j]) === 1));
    if (!inside) return;
    const touches = lines.some((o, j) => {
      if (o === l) return false; const b = boxes[j]; if (b.x1 < bi.x0 || b.x0 > bi.x1 || b.y1 < bi.y0 || b.y0 > bi.y1) return false;
      // a closed outline that contains this one is fine as long as they don't cross
      const n = o.pts.length, m = l.pts.length;
      for (let a = 0; a < (o.closed ? n : n - 1); a++) for (let c = 0; c < m; c++) if (cross(o.pts[a], o.pts[(a + 1) % n], l.pts[c], l.pts[(c + 1) % m])) return true;
      return false;
    });
    if (!touches) out.push(ints[i]);
  });
  return out;
}
/** Keep only the pieces of a mask that are inside the part and not in a hole (each piece lies wholly on one side of every line). */
function insidePart(mask: IP[], closed: IP[], holes: IP[] = [], at?: Point): IP[] {
  const tree = new L.PolyTree(), c = new L.Clipper();
  c.AddPaths(mask, L.PolyType.ptSubject, true); c.Execute(L.ClipType.ctUnion, tree, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero);
  const out: IP[] = [];
  const visit = (node: any) => {
    for (const outer of node.Childs()) {
      const ct = outer.Contour() as IP, q = ct[0];
      const inside = at ? L.Clipper.PointInPolygon(toI([at])[0], ct) === 1 && !outer.Childs().some((h: any) => L.Clipper.PointInPolygon(toI([at])[0], h.Contour()) === 1)
        : closed.some(cp => L.Clipper.PointInPolygon(q, cp) !== 0) && !holes.some(h => L.Clipper.PointInPolygon(q, h) !== 0);
      if (inside) { out.push(ct); for (const hole of outer.Childs()) { out.push(hole.Contour()); visit(hole); } }
      else for (const hole of outer.Childs()) visit(hole);
    }
  };
  visit(tree); return out;
}

// ---------------- the slits ----------------
interface Row { pts: Point[]; u0: number; odd: boolean; P: number; D: number }
/** Cumulative lengths of a polyline. */
const cum = (pts: Point[]) => { const s = [0]; for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + dist(pts[i - 1], pts[i])); return s; };
function sub_(pts: Point[], s: number[], a: number, b: number): Point[] {
  const at = (u: number) => { let i = 1; while (i < s.length - 1 && s[i] < u) i++; const k = (u - s[i - 1]) / ((s[i] - s[i - 1]) || 1); return add(pts[i - 1], mul(sub(pts[i], pts[i - 1]), Math.max(0, Math.min(1, k)))); };
  const out = [at(a)]; for (let i = 0; i < pts.length; i++) if (s[i] > a && s[i] < b) out.push(pts[i]); out.push(at(b)); return out;
}
/** Dashes along a row (in the row's own coordinate u), alternating rows shifted by half a step. */
function dashes(r: Row, wavy: number): Point[][] {
  const s = cum(r.pts), Lr = s[s.length - 1], out: Point[][] = [], ph = r.odd ? r.P / 2 : 0;
  let k = Math.floor((r.u0 - ph) / r.P) - 1;
  for (; ; k++) {
    const a = k * r.P + ph - r.u0, b = a + r.D; if (a > Lr) break; if (b < 0) continue;
    let seg = sub_(r.pts, s, Math.max(0, a), Math.min(Lr, b));
    if (wavy > 0) {   // a wave across the slit: 2 waves per slit
      const ss = cum(seg), T = ss[ss.length - 1], n = Math.max(8, Math.ceil(T / 0.4)), lam = r.D / 2, res: Point[] = [];
      for (let i = 0; i <= n; i++) {
        const u = T * i / n, q = sub_(seg, ss, u, u)[0], j = Math.min(seg.length - 2, Math.max(0, ss.findIndex(x => x >= u) - 1)), t = sub(seg[j + 1], seg[j]), tl = len(t) || 1;
        res.push(add(q, mul(P(-t.y / tl, t.x / tl), wavy * Math.sin(2 * Math.PI * (Math.max(0, a) + u - a) / lam))));
      }
      seg = res;
    }
    out.push(seg);
  }
  return out;
}
const centroid = (paths: Point[][]) => { let x = 0, y = 0, n = 0; for (const p of paths) for (const q of p) { x += q.x; y += q.y; n++; } return n ? P(x / n, y / n) : P(0, 0); };

/** Rows of slits for one mark, before clipping to its mask. */
function rowsFor(m: Exclude<HingeMark, { kind: 'erase' }>, mask: Point[][], set: BrushSettings, centre: Point): { rows: Row[]; arrow: { p: Point; d: Point } | null } {
  const pitch = set.pitch * (m.pattern === 'fold' ? 0.6 : 1), Pd = set.slit + set.bridge, rows: Row[] = [];
  const all = mask.flat(); if (!all.length) return { rows, arrow: null };
  let rmin = Infinity, rmax = 0; for (const q of all) { const d = dist(q, centre); rmin = Math.min(rmin, d); rmax = Math.max(rmax, d); }
  if (m.pattern === 'rings' || m.pattern === 'spokes') {
    // is the centre inside the mask? then rings start from it
    const inside = mask.some(p => L.Clipper.PointInPolygon(toI([centre])[0], toI(p)) !== 0); if (inside) rmin = 0;
    if (m.pattern === 'rings') {
      for (let k = Math.max(1, Math.floor(rmin / pitch)); k * pitch <= rmax + pitch; k++) {
        const r = k * pitch, n = Math.max(24, Math.ceil(2 * Math.PI * r / 0.5)), pts = Array.from({ length: n + 1 }, (_, i) => add(centre, P(r * Math.cos(2 * Math.PI * i / n), r * Math.sin(2 * Math.PI * i / n))));
        const nd = Math.max(1, Math.round(2 * Math.PI * r / Pd)), Pr = 2 * Math.PI * r / nd;
        rows.push({ pts, u0: 0, odd: k % 2 === 1, P: Pr, D: Math.max(0.5, Pr - set.bridge) });
      }
      const c = centroid(mask); return { rows, arrow: { p: c, d: unit(sub(c, centre)) } };
    }
    const rm = Math.max(pitch * 2, (rmin + rmax) / 2), step = pitch / rm, n = Math.max(3, Math.round(2 * Math.PI / step));
    for (let k = 0; k < n; k++) { const a = 2 * Math.PI * k / n, d = P(Math.cos(a), Math.sin(a)); rows.push({ pts: [add(centre, mul(d, Math.max(0, rmin - 1))), add(centre, mul(d, rmax + 1))], u0: Math.max(0, rmin - 1), odd: k % 2 === 1, P: Pd, D: set.slit }); }
    const c = centroid(mask), rd = unit(sub(c, centre)); return { rows, arrow: { p: c, d: P(-rd.y, rd.x) } };
  }
  if (m.kind === 'fold') {
    const d = unit(sub(m.b, m.a)), n = P(-d.y, d.x), K = Math.ceil((m.w / 2) / pitch) + 1, ext = m.w + 2, Lab = dist(m.a, m.b);
    for (let k = -K; k <= K; k++) rows.push({ pts: [add(add(m.a, mul(d, -ext)), mul(n, k * pitch)), add(add(m.a, mul(d, Lab + ext)), mul(n, k * pitch))], u0: -ext, odd: (k & 1) === 1, P: Pd, D: set.slit });
    return { rows, arrow: { p: mul(add(m.a, m.b), 0.5), d: n } };
  }
  if (m.kind === 'brush' && m.pts.length > 1) {
    const st = smooth(m.pts), s = cum(st), T = s[s.length - 1];
    if (T >= pitch) {
      const R = m.r + 1;
      // rows run on past both ends of the stroke (into the round ends of the brush), straight on
      const t0 = unit(sub(sub_(st, s, Math.min(T, 1), 0)[0], st[0])), t1 = unit(sub(st[st.length - 1], sub_(st, s, Math.max(0, T - 1), 0)[0]));
      for (let k = -Math.ceil(m.r / pitch); k * pitch <= T + m.r; k++) {
        const u = k * pitch;
        if (u < 0 || u > T) {
          const t = u < 0 ? t0 : t1, p = u < 0 ? add(st[0], mul(t0, u)) : add(st[st.length - 1], mul(t1, u - T)), n = P(-t.y, t.x);
          rows.push({ pts: [add(p, mul(n, -R)), add(p, mul(n, R))], u0: -R, odd: (k & 1) === 1, P: Pd, D: set.slit }); continue;
        }
        const p = sub_(st, s, u, u)[0], a = sub_(st, s, Math.max(0, u - 1), Math.max(0, u - 1))[0], b = sub_(st, s, Math.min(T, u + 1), Math.min(T, u + 1))[0];
        const t = unit(sub(b, a)), n = P(-t.y, t.x);
        // keep rows from crossing on the inside of a tight turn
        const pa = sub_(st, s, Math.max(0, u - m.r), Math.max(0, u - m.r))[0], pb = sub_(st, s, Math.min(T, u + m.r), Math.min(T, u + m.r))[0];
        const rc = circleR(pa, p, pb), side = Math.sign((pb.x - pa.x) * (p.y - pa.y) - (pb.y - pa.y) * (p.x - pa.x));   // + : centre of the turn on the right (−n side)
        let Rp = R, Rn = R; if (isFinite(rc)) { if (side > 0) Rn = Math.min(R, rc * 0.9); else Rp = Math.min(R, rc * 0.9); }
        rows.push({ pts: [add(p, mul(n, -Rn)), add(p, mul(n, Rp))], u0: -Rn, odd: (k & 1) === 1, P: Pd, D: set.slit });
      }
      const mid = sub_(st, s, T / 2, T / 2)[0], a = sub_(st, s, Math.max(0, T / 2 - 1), 0)[0], b = sub_(st, s, Math.min(T, T / 2 + 1), 0)[0];
      return { rows, arrow: { p: mid, d: unit(sub(b, a)) } };
    }
  }
  // clicked area (or a dot): rows across the area's long direction, so it bends along its length
  const c = centroid(mask); let sxx = 0, syy = 0, sxy = 0;
  for (const q of all) { const dx = q.x - c.x, dy = q.y - c.y; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), e1 = P(Math.cos(ang), Math.sin(ang)), e2 = P(-e1.y, e1.x);
  let lo = Infinity, hi = -Infinity, lo2 = Infinity, hi2 = -Infinity;
  for (const q of all) { const d = sub(q, c), a = d.x * e1.x + d.y * e1.y, b = d.x * e2.x + d.y * e2.y; lo = Math.min(lo, a); hi = Math.max(hi, a); lo2 = Math.min(lo2, b); hi2 = Math.max(hi2, b); }
  for (let k = Math.floor(lo / pitch); k * pitch <= hi; k++) rows.push({ pts: [add(c, add(mul(e1, k * pitch), mul(e2, lo2 - 1))), add(c, add(mul(e1, k * pitch), mul(e2, hi2 + 1)))], u0: lo2 - 1, odd: (k & 1) === 1, P: Pd, D: set.slit });
  return { rows, arrow: { p: c, d: e1 } };
}
const unit = (v: Point) => { const l = len(v) || 1; return P(v.x / l, v.y / l); };
function circleR(a: Point, b: Point, c: Point): number {
  const A = dist(b, c), B = dist(a, c), C = dist(a, b), s2 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  return s2 < 1e-9 ? Infinity : (A * B * C) / (2 * s2);
}
/** Even out a hand-drawn stroke: resample every 1 mm, then average neighbours. */
export function smooth(pts: Point[]): Point[] {
  const s = cum(pts), T = s[s.length - 1]; if (T < 1e-6) return pts.slice();
  const n = Math.max(2, Math.ceil(T)), rs = Array.from({ length: n + 1 }, (_, i) => sub_(pts, s, T * i / n, T * i / n)[0]);
  const w = 3; return rs.map((_, i) => { if (i === 0 || i === rs.length - 1) return rs[i]; let x = 0, y = 0, c = 0; for (let j = Math.max(0, i - w); j <= Math.min(rs.length - 1, i + w); j++) { x += rs[j].x; y += rs[j].y; c++; } return P(x / c, y / c); });
}

/**
 * All painted areas → masks and slits. `centreOf` gives the default centre for
 * circles / spokes when a mark has none.
 */
export function computeHinge(marks: HingeMark[], env: HingeEnv, set: BrushSettings, defaultCentre: Point): HingeArea[] {
  const shapes = marks.map(markShape);
  // later eraser strokes take paint away
  const eff = marks.map((m, i) => m.kind === 'erase' ? [] : clip(L.ClipType.ctDifference, shapes[i], union(marks.flatMap((e, j) => j > i && e.kind === 'erase' ? shapes[j] : []))));
  const prio = (i: number) => (marks[i] as any).over ? 1e9 + i : -i;
  const lines = env.lines.filter(l => l.pts.length > 1);
  const buffer = lines.length ? union([...offsetOpen(lines.filter(l => !l.closed).map(l => l.pts), set.edge, L.EndType.etOpenRound), ...offsetOpenClosed(lines.filter(l => l.closed).map(l => l.pts), set.edge)]) : [];
  const closed = lines.filter(l => l.closed && l.pts.length > 2).map(l => toI(l.pts)), holes = holesOf(lines);
  const out: HingeArea[] = [];
  marks.forEach((m, i) => {
    if (m.kind === 'erase' || !eff[i].length) return;
    const block: IP[] = [];
    marks.forEach((o, j) => { if (j === i || o.kind === 'erase' || prio(j) < prio(i) || !eff[j].length) return; block.push(...(o.pattern === m.pattern ? eff[j] : grow(eff[j], Math.max(1, set.bridge)))); });
    let mask = clip(L.ClipType.ctDifference, clip(L.ClipType.ctDifference, eff[i], union(block)), buffer);
    if (m.kind === 'area') { const kept = m.at ? insidePart(mask, closed, [], m.at) : []; mask = kept.length ? kept : insidePart(mask, closed, holes); }
    else mask = insidePart(mask, closed, holes);
    mask = mask.filter(p => p.length > 2 && Math.abs(L.Clipper.Area(p)) > 0.5 * S * S);
    if (!mask.length) return;
    const pm = mask.map(fromI), centre = m.c ?? defaultCentre;
    const { rows, arrow } = rowsFor(m, pm, set, centre);
    const wavy = m.pattern === 'wavy' ? set.pitch * 0.28 : 0;
    const raw = rows.flatMap(r => dashes(r, wavy));
    const slits = clipOpen(raw, mask).filter(p => { let l = 0; for (let k = 1; k < p.length; k++) l += dist(p[k - 1], p[k]); return l >= Math.max(1.5, set.slit * 0.2); });
    out.push({ index: i, pattern: m.pattern, mask: pm, slits, arrow, centre: m.pattern === 'rings' || m.pattern === 'spokes' ? centre : undefined });
  });
  return out;
}
function offsetOpenClosed(paths: Point[][], d: number): IP[] {
  if (!paths.length) return [];
  const co = new L.ClipperOffset(2, 0.02 * S), out = new L.Paths();
  for (const p of paths) co.AddPath(toI(p), L.JoinType.jtRound, L.EndType.etClosedLine);
  co.Execute(out, d * S); return out as IP[];
}
/** Open polylines clipped to the inside of closed areas. */
function clipOpen(lines: Point[][], area: IP[]): Point[][] {
  if (!lines.length || !area.length) return [];
  const c = new L.Clipper(), tree = new L.PolyTree();
  c.AddPaths(lines.map(toI), L.PolyType.ptSubject, false); c.AddPaths(area, L.PolyType.ptClip, true);
  c.Execute(L.ClipType.ctIntersection, tree, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero);
  return (L.Clipper.OpenPathsFromPolyTree(tree) as IP[]).filter(p => p.length > 1).map(fromI);
}
