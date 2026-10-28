/**
 * Finger-jointed box generator (clean-room).
 *
 * Each panel starts as its outer rectangle. Along every joined edge the band
 * one material-thickness deep is split into an odd number of equal segments;
 * a "tab" edge keeps the even segments, a "slot" edge keeps the odd ones, so the
 * two panels meeting at that edge interlock exactly. Panels are ranked
 * (front/back > sides > bottom/top) and the higher rank always gets the tabs,
 * which makes every 3-way corner belong to exactly one panel.
 *
 * Kerf: every part outline is offset outwards by (kerf − clearance)/2 so the
 * laser's burn-away is put back — tabs come out full size and slots exact.
 */
import ClipperLib from 'clipper-lib';
import { type Point, P } from '../geometry/vec';
import type { Shape } from '../model/types';

const L = ClipperLib, SC = 1e5;
export type EdgeKind = 'tab' | 'slot' | 'plain';
export interface BoxOpts {
  w: number; d: number; h: number;
  /** sizes given are inside (true) or outside (false) */
  inside: boolean;
  t: number;
  /** target finger width; the real width is adjusted so each edge has an odd whole number of fingers */
  finger: number;
  kerf: number;
  /** extra gap per joint for an easier fit (0 = press fit) */
  clearance: number;
  lid: boolean;
  layout: 'net' | 'rows';
  gap: number;
  /** sheet width for the 'rows' layout */
  sheetW?: number;
}
export interface BoxPart { name: string; pts: Point[]; w: number; h: number }

/** Odd number of fingers closest to the target width (at least 3). */
export function fingerCount(len: number, target: number): number {
  let n = Math.max(3, Math.round(len / Math.max(0.5, target)));
  if (n % 2 === 0) n += (len / n > target ? 1 : -1);
  return Math.max(3, n);
}
const rectI = (x0: number, y0: number, x1: number, y1: number) => [{ X: Math.round(x0 * SC), Y: Math.round(y0 * SC) }, { X: Math.round(x1 * SC), Y: Math.round(y0 * SC) }, { X: Math.round(x1 * SC), Y: Math.round(y1 * SC) }, { X: Math.round(x0 * SC), Y: Math.round(y1 * SC) }];

/** One panel w × h with edge kinds [bottom, right, top, left] and finger counts per edge. */
export function panel(w: number, h: number, t: number, kinds: [EdgeKind, EdgeKind, EdgeKind, EdgeKind], n: [number, number, number, number], offset: number): Point[] {
  const cut: { X: number; Y: number }[][] = [];
  const edge = (k: number) => {
    const kind = kinds[k]; if (kind === 'plain') return;
    const len = k % 2 === 0 ? w : h, m = n[k], s = len / m;
    for (let i = 0; i < m; i++) {
      const keep = kind === 'tab' ? i % 2 === 0 : i % 2 === 1; if (keep) continue;
      const a = i * s, b = (i + 1) * s;
      if (k === 0) cut.push(rectI(a, -1, b, t));             // bottom band
      else if (k === 2) cut.push(rectI(a, h - t, b, h + 1)); // top band
      else if (k === 3) cut.push(rectI(-1, a, t, b));        // left band
      else cut.push(rectI(w - t, a, w + 1, b));              // right band
    }
  };
  for (let k = 0; k < 4; k++) edge(k);
  const c = new L.Clipper(), sol = new L.Paths();
  c.AddPath(rectI(0, 0, w, h), L.PolyType.ptSubject, true); if (cut.length) c.AddPaths(cut, L.PolyType.ptClip, true);
  c.Execute(L.ClipType.ctDifference, sol, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero);
  let path = (sol as any[]).sort((a, b) => Math.abs(L.Clipper.Area(b)) - Math.abs(L.Clipper.Area(a)))[0];
  if (Math.abs(offset) > 1e-9) {
    const co = new L.ClipperOffset(8, 0.25), out = new L.Paths();
    co.AddPath(path, L.JoinType.jtMiter, L.EndType.etClosedPolygon); co.Execute(out, offset * SC);
    path = (out as any[]).sort((a, b) => Math.abs(L.Clipper.Area(b)) - Math.abs(L.Clipper.Area(a)))[0] || path;
  }
  // tidy: back to mm, drop collinear points
  const pts: Point[] = path.map((q: any) => P(Math.round(q.X / SC * 1e4) / 1e4, Math.round(q.Y / SC * 1e4) / 1e4));
  return pts.filter((p, i) => { const a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length]; return Math.abs((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x)) > 1e-9; });
}

/** All parts of the box, each in its own local frame (0,0)–(w,h), before layout. */
export function boxParts(o: BoxOpts): BoxPart[] {
  const t = o.t, W = o.inside ? o.w + 2 * t : o.w, D = o.inside ? o.d + 2 * t : o.d, H = o.inside ? o.h + (o.lid ? 2 : 1) * t : o.h;
  const nW = fingerCount(W, o.finger), nD = fingerCount(D, o.finger), nH = fingerCount(H, o.finger), off = (o.kerf - o.clearance) / 2;
  const top: EdgeKind = o.lid ? 'tab' : 'plain';
  const parts: BoxPart[] = [
    { name: 'Bottom', w: W, h: D, pts: panel(W, D, t, ['slot', 'slot', 'slot', 'slot'], [nW, nD, nW, nD], off) },
    { name: 'Front', w: W, h: H, pts: panel(W, H, t, ['tab', 'tab', top, 'tab'], [nW, nH, nW, nH], off) },
    { name: 'Back', w: W, h: H, pts: panel(W, H, t, ['tab', 'tab', top, 'tab'], [nW, nH, nW, nH], off) },
    { name: 'Left', w: D, h: H, pts: panel(D, H, t, ['tab', 'slot', top, 'slot'], [nD, nH, nD, nH], off) },
    { name: 'Right', w: D, h: H, pts: panel(D, H, t, ['tab', 'slot', top, 'slot'], [nD, nH, nD, nH], off) },
  ];
  if (o.lid) parts.push({ name: 'Top', w: W, h: D, pts: panel(W, D, t, ['slot', 'slot', 'slot', 'slot'], [nW, nD, nW, nD], off) });
  return parts;
}

/** Lay the parts out flat (as a cross-shaped net, or in rows) with a gap; returns closed paths with names. */
export function boxLayout(o: BoxOpts): { name: string; shape: Shape }[] {
  const P0 = boxParts(o), g = o.gap, by = (n: string) => P0.find(p => p.name === n)!;
  const B = by('Bottom'), Hh = by('Front').h, W = B.w, D = B.h;
  const out: { name: string; pts: Point[] }[] = [];
  const put = (p: BoxPart, f: (q: Point) => Point) => out.push({ name: p.name, pts: p.pts.map(f) });
  if (o.layout === 'net') {
    put(B, q => q);
    put(by('Front'), q => P(q.x, -g - q.y));                       // below, bottom edge facing up
    put(by('Back'), q => P(q.x, D + g + q.y));                     // above
    put(by('Left'), q => P(-g - q.y, q.x));                        // left, bottom edge facing right
    put(by('Right'), q => P(W + g + q.y, D - q.x));                // right, bottom edge facing left
    if (o.lid) put(by('Top'), q => P(W + g + Hh + g + q.x, q.y));  // beyond the right side
  } else {
    // shelf packing: lie each part on its long side, tallest first, rows as wide as the sheet
    const maxW = Math.max(100, o.sheetW || 600); let x = 0, y = 0, row = 0;
    const flat = P0.map(p => p.h > p.w && p.h <= maxW ? { p, w: p.h, h: p.w, f: (q: Point) => P(q.y, p.w - q.x) } : { p, w: p.w, h: p.h, f: (q: Point) => q });
    flat.sort((a, b) => b.h - a.h || b.w - a.w);
    for (const it of flat) { if (x > 0 && x + it.w > maxW) { x = 0; y += row + g; row = 0; } const x0 = x, y0 = y; put(it.p, q => { const r = it.f(q); return P(x0 + r.x, y0 + r.y); }); x += it.w + g; row = Math.max(row, it.h); }
  }
  return out.map(p => ({ name: p.name, shape: { type: 'poly', closed: true, pts: p.pts } as Shape }));
}
