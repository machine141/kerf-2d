/**
 * Text layout (clean-room): letters from a font become exact outlines
 * (straight lines and Bézier curves, exactly as the font draws them), laid out
 * in lines, or along any line / arc / circle / curve.
 *
 * Size is the height of the CAPITAL letters in mm (what you measure on a cut part).
 *
 * Along a path:
 *  • pos (0–1) is where the text's anchor sits along the path; the anchor is its
 *    start, centre or end (dragging snaps to the path's start / middle / end), or
 *    'fit' spreads the letters along the whole path;
 *  • side: letters sit above, on or below the line; flip puts them on the other
 *    side reading the other way (on a circle: the bottom text reads upright);
 *  • effects: A rainbow (letters turn with the curve), B stretch (letters bend
 *    with the curve), C skew (letters stay vertical, slanting with it),
 *    D stair step (letters stay upright, stepping along it).
 * Closed paths run clockwise so text on top of a circle reads the right way up.
 */
import { type Point, P, add, sub, mul, len, dist } from '../geometry/vec';
import { flatten, ext } from '../geometry/entity';
import { otFont } from './fonts';
import { GLYPHS, ADV } from './stroke';
import type { Shape, TextEnt } from '../model/types';

type Contour = { pts: Point[]; h: [Point, Point][]; closed: boolean; curved: boolean };
interface Glyph { adv: number; contours: Contour[]; key: any }
const glyphCache = new Map<string, Glyph | null>();

/** One letter at cap height 1, origin on the baseline at its left. */
function glyphOf(fontId: string, ch: string): Glyph | null {
  const k = fontId + '\u0000' + ch; if (glyphCache.has(k)) return glyphCache.get(k)!;
  let g: Glyph | null = null;
  if (fontId === 'kerf-line' || !otFont(fontId)) {
    const strokes = GLYPHS[ch.toUpperCase()] ?? (ch === ' ' ? [] : GLYPHS['?']);
    g = { adv: ADV / 6, key: ch, contours: strokes.map(s => { const pts = s.map(([x, y]) => P(x / 6, y / 6)); return { pts, h: pts.map(p => [p, p] as [Point, Point]), closed: false, curved: false }; }) };
  } else {
    const f = otFont(fontId), og = f.charToGlyph(ch);
    if (og && (og.index !== 0 || ch === ' ')) {
      const cap = capOf(f), s = 1 / cap, out: Contour[] = []; let cur: Contour | null = null;
      const p = (x: number, y: number) => P(x * s, y * s);
      for (const c of og.path.commands) {
        if (c.type === 'M') { if (cur) out.push(cur); const q = p(c.x, c.y); cur = { pts: [q], h: [[q, q]], closed: false, curved: false }; }
        else if (!cur) continue;
        else if (c.type === 'L') { const q = p(c.x, c.y); cur.pts.push(q); cur.h.push([q, q]); }
        else if (c.type === 'Q') { const a = cur.pts[cur.pts.length - 1], q = p(c.x1, c.y1), b = p(c.x, c.y); cur.h[cur.h.length - 1][1] = add(a, mul(sub(q, a), 2 / 3)); cur.pts.push(b); cur.h.push([add(b, mul(sub(q, b), 2 / 3)), b]); cur.curved = true; }
        else if (c.type === 'C') { const b = p(c.x, c.y); cur.h[cur.h.length - 1][1] = p(c.x1, c.y1); cur.pts.push(b); cur.h.push([p(c.x2, c.y2), b]); cur.curved = true; }
        else if (c.type === 'Z') {
          const n = cur.pts.length;
          if (n > 1 && dist(cur.pts[0], cur.pts[n - 1]) < 1e-9) { cur.h[0][0] = cur.h[n - 1][0]; cur.pts.pop(); cur.h.pop(); }
          cur.closed = true; out.push(cur); cur = null;
        }
      }
      if (cur) out.push(cur);
      g = { adv: og.advanceWidth * s, contours: out.filter(c => c.pts.length > 1), key: og };
    }
  }
  glyphCache.set(k, g); return g;
}
/** Capital height in font units, measured from the real "H" (some fonts report it wrongly). */
const capOf = (f: any): number => f.__cap ?? (f.__cap = (f.charToGlyph('H')?.getBoundingBox().y2 || f.tables?.os2?.sCapHeight || f.unitsPerEm * 0.7));

interface Item { x: number; adv: number; g: Glyph }
/** Lay out one line at cap height `size` mm with `spacing` mm extra between letters. */
export function layoutLine(fontId: string, str: string, size: number, spacing: number): { items: Item[]; width: number } {
  const f = fontId === 'kerf-line' ? null : otFont(fontId), items: Item[] = []; let x = 0, prev: Glyph | null = null;
  for (const ch of [...str]) {
    const g = glyphOf(fontId, ch); if (!g) { x += size * 0.35; prev = null; continue; }
    if (prev) { x += spacing; if (f && prev.key?.index != null && g.key?.index != null) x += f.getKerningValue(prev.key, g.key) / capOf(f) * size; }
    items.push({ x, adv: g.adv * size, g }); x += g.adv * size; prev = g;
  }
  return { items, width: x };
}

// ---------------- path helpers ----------------
interface PathRun { pts: Point[]; s: number[]; L: number; closed: boolean }
const area = (p: Point[]) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q.x * r.y - r.x * q.y; } return a / 2; };
/** The path as a polyline in reading direction (closed paths clockwise unless flipped). */
export function pathRun(geom: Shape, flip: boolean): PathRun {
  const f = flatten(geom, 0.01); let pts = f.pts.slice(); const closed = f.closed;
  if (closed && area(pts) > 0) pts.reverse();
  // flipping keeps the same starting point, so positions along it stay where they were (s ↔ L − s)
  if (flip) pts = closed ? [pts[0], ...pts.slice(1).reverse()] : pts.reverse();
  if (closed) pts.push(pts[0]);
  const s = [0]; for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + dist(pts[i - 1], pts[i]));
  return { pts, s, L: s[s.length - 1], closed };
}
/** Point and unit tangent at distance x along the run (wraps on closed paths, runs on straight past the ends of open ones). */
export function runAt(r: PathRun, x: number): { p: Point; t: Point } {
  if (r.closed) x = ((x % r.L) + r.L) % r.L;
  const n = r.pts.length, unit = (a: Point, b: Point) => { const d = sub(b, a), l = len(d) || 1; return mul(d, 1 / l); };
  if (x <= 0) { const t = unit(r.pts[0], r.pts[1]); return { p: add(r.pts[0], mul(t, x)), t }; }
  if (x >= r.L) { const t = unit(r.pts[n - 2], r.pts[n - 1]); return { p: add(r.pts[n - 1], mul(t, x - r.L)), t }; }
  let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (r.s[m] <= x) lo = m; else hi = m; }
  const a = r.pts[lo], b = r.pts[hi], sl = r.s[hi] - r.s[lo] || 1e-12, k = (x - r.s[lo]) / sl;
  return { p: add(a, mul(sub(b, a), k)), t: unit(a, b) };
}
/** Fraction (0–1) along the path's canonical direction of the point nearest p. */
export function nearestPos(geom: Shape, p: Point): number {
  const r = pathRun(geom, false); let best = 0, bd = Infinity;
  for (let i = 0; i < r.pts.length - 1; i++) {
    const a = r.pts[i], b = r.pts[i + 1], d = sub(b, a), L2 = d.x * d.x + d.y * d.y || 1e-12, t = Math.max(0, Math.min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / L2));
    const q = add(a, mul(d, t)), dd = dist(q, p); if (dd < bd) { bd = dd; best = (r.s[i] + t * (r.s[i + 1] - r.s[i])) / (r.L || 1); }
  }
  return best;
}

// ---------------- build outlines ----------------
const contourShape = (c: Contour, map: (q: Point) => Point): Shape => c.curved
  ? { type: 'spline', pts: c.pts.map(map), h: c.h.map(([a, b]) => [map(a), map(b)] as [Point, Point]), closed: c.closed } as Shape
  : { type: 'poly', pts: c.pts.map(map), closed: c.closed } as Shape;
/** Flatten a contour (cap-1 units) to points, for effects that bend letters. */
function contourPts(c: Contour, size: number): Point[] {
  if (!c.curved) return c.pts.map(q => mul(q, size));
  const sp = { type: 'spline', pts: c.pts.map(q => mul(q, size)), h: c.h.map(([a, b]) => [mul(a, size), mul(b, size)]), closed: c.closed } as Shape;
  return flatten(sp, 0.01).pts;
}

const cache = new Map<string, Shape[]>();
/** The text's outlines, in drawing coordinates. */
export function textShapes(e: TextEnt | (Shape & { type: 'text' })): Shape[] {
  const t = e as TextEnt, key = JSON.stringify([t.text, t.font, t.size, t.spacing, t.lineSpacing, t.align, t.at, t.angle, t.mirror, t.path && { ...t.path, ref: undefined }]);
  const hit = cache.get(key); if (hit) return hit;
  const out = t.path ? onPath(t) : straight(t);
  if (cache.size > 300) cache.clear();
  cache.set(key, out); return out;
}
function straight(t: TextEnt): Shape[] {
  const out: Shape[] = [], lines = t.text.split('\n'), c = Math.cos(t.angle || 0), s = Math.sin(t.angle || 0), m = t.mirror ? -1 : 1;
  lines.forEach((ln, i) => {
    const L = layoutLine(t.font, ln, t.size, t.spacing), dx = t.align === 'center' ? -L.width / 2 : t.align === 'right' ? -L.width : 0, y0 = -i * t.size * (t.lineSpacing || 1.6);
    for (const it of L.items) for (const cn of it.g.contours) out.push(contourShape(cn, q => { const x = (q.x * t.size + it.x + dx) * m, y = q.y * t.size + y0; return P(t.at.x + x * c - y * s, t.at.y + x * s + y * c); }));
  });
  return out;
}
function onPath(t: TextEnt): Shape[] {
  const pp = t.path!, r = pathRun(pp.geom, pp.flip), str = t.text.replace(/\n/g, ' ');
  const L = layoutLine(t.font, str, t.size, t.spacing), n = L.items.length; if (!n || r.L < 1e-9) return [];
  const sA = (pp.flip ? 1 - pp.pos : pp.pos) * r.L;
  let s0 = pp.anchor === 'start' ? sA : pp.anchor === 'end' ? sA - L.width : sA - L.width / 2, extra = 0;
  if (pp.anchor === 'fit') { const room = r.closed ? r.L * 0.985 : r.L; extra = n > 1 ? (room - L.width) / (n - 1) : 0; s0 = r.closed ? sA - room / 2 : 0; }
  const shift = (pp.side === 'on' ? -t.size / 2 : pp.side === 'below' ? -t.size : 0) + (pp.lift || 0), out: Shape[] = [];
  const W = L.width + extra * (n - 1);
  L.items.forEach((it, i) => {
    let x0 = it.x + extra * i;
    if (t.mirror) x0 = W - (x0 + it.adv);                            // back to front: mirror the line of letters
    const gx = s0 + x0, mx = (q: Point) => t.mirror ? it.adv / t.size - q.x : q.x;   // letter mirrored in place
    if (pp.effect === 'rainbow' || pp.effect === 'stair' || !pp.effect) {
      const { p, t: T } = runAt(r, gx + it.adv / 2), N = P(-T.y, T.x), half = it.adv / 2;
      const map = pp.effect === 'stair'
        ? (q: Point) => add(add(p, mul(N, shift)), P(mx(q) * t.size - half, q.y * t.size))
        : (q: Point) => { const lx = mx(q) * t.size - half, ly = q.y * t.size + shift; return add(p, add(mul(T, lx), mul(N, ly))); };
      for (const cn of it.g.contours) out.push(contourShape(cn, map));
    } else {
      for (const cn of it.g.contours) {
        const pts = contourPts({ ...cn, pts: cn.pts.map(q => P(mx(q), q.y)), h: cn.h.map(([a, b]) => [P(mx(a), a.y), P(mx(b), b.y)]) }, t.size).map(q => {
          const { p, t: T } = runAt(r, gx + q.x), N = P(-T.y, T.x);
          return pp.effect === 'skew' ? add(add(p, mul(N, shift)), P(0, q.y)) : add(p, mul(N, q.y + shift));
        });
        out.push({ type: 'poly', pts, closed: cn.closed } as Shape);
      }
    }
  });
  return out;
}
/**
 * The line through the middle of the letters (half the capital height up), from
 * the first letter to the last — used to join spaced-out letters into one contour.
 * With `whole`, text on a closed shape gives the complete loop round it.
 */
export function textSpines(t: TextEnt, whole = false): { pts: Point[]; closed: boolean }[] {
  if (!t.path) {
    const c = Math.cos(t.angle || 0), s = Math.sin(t.angle || 0), m = t.mirror ? -1 : 1, out: { pts: Point[]; closed: boolean }[] = [];
    t.text.split('\n').forEach((ln, i) => {
      const L = layoutLine(t.font, ln, t.size, t.spacing); if (!L.items.length) return;
      const dx = t.align === 'center' ? -L.width / 2 : t.align === 'right' ? -L.width : 0, y = -i * t.size * (t.lineSpacing || 1.6) + t.size / 2;
      const a = L.items[0].x + L.items[0].adv * 0.25, b = L.items[L.items.length - 1].x + L.items[L.items.length - 1].adv * 0.75;
      out.push({ closed: false, pts: [a, b].map(x0 => { const x = (x0 + dx) * m; return P(t.at.x + x * c - y * s, t.at.y + x * s + y * c); }) });
    });
    return out;
  }
  const pp = t.path, r = pathRun(pp.geom, pp.flip), str = t.text.replace(/\n/g, ' '), L = layoutLine(t.font, str, t.size, t.spacing), n = L.items.length;
  if (!n || r.L < 1e-9) return [];
  const sA = (pp.flip ? 1 - pp.pos : pp.pos) * r.L;
  let s0 = pp.anchor === 'start' ? sA : pp.anchor === 'end' ? sA - L.width : sA - L.width / 2, extra = 0;
  if (pp.anchor === 'fit') { const room = r.closed ? r.L * 0.985 : r.L; extra = n > 1 ? (room - L.width) / (n - 1) : 0; s0 = r.closed ? sA - room / 2 : 0; }
  const up = (pp.side === 'on' ? -t.size / 2 : pp.side === 'below' ? -t.size : 0) + (pp.lift || 0) + t.size / 2;
  const vertical = pp.effect === 'skew' || pp.effect === 'stair';
  const at = (x: number) => { const { p, t: T } = runAt(r, x); return vertical ? add(p, add(mul(P(-T.y, T.x), up - t.size / 2), P(0, t.size / 2))) : add(p, mul(P(-T.y, T.x), up)); };
  if (whole && r.closed) { const k = Math.max(24, Math.ceil(r.L / 1)); return [{ closed: true, pts: Array.from({ length: k }, (_, i) => at(i * r.L / k)) }]; }
  const W = L.width + extra * (n - 1), a = s0 + L.items[0].adv * 0.25, b = s0 + W - L.items[n - 1].adv * 0.25, k = Math.max(2, Math.ceil((b - a) / 1));
  return [{ closed: false, pts: Array.from({ length: k + 1 }, (_, i) => at(a + (b - a) * i / k)) }];
}
/** Where the text's anchor sits on its path (for the drag handle). */
export function anchorPoint(t: TextEnt): Point | null {
  if (!t.path) return null;
  const r = pathRun(t.path.geom, false), s = (t.path.anchor === 'fit' ? 0.5 : t.path.pos) * r.L;
  return runAt(r, s).p;
}
/** Text objects swapped for their letter outlines (same layer, colour and width) — for exports and cutting. */
export function expandText<T extends { type: string }>(ents: T[]): T[] {
  return ents.flatMap(e => e.type !== 'text' ? [e] : textShapes(e as any).map(s => ({ ...s, id: (e as any).id, layer: (e as any).layer, color: (e as any).color, w: (e as any).w }) as any));
}
/** A new text object's settings. */
export const TEXT_DEFAULTS = { font: 'arimo', size: 10, spacing: 0, lineSpacing: 1.6, align: 'left' as const };

// register with the geometry core so drawing, picking, snapping and exports see the letters
ext.textShapes = textShapes as any;
