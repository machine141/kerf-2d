import { describe, it, expect } from 'vitest';
import { P, dist, type Point, DEG } from '../src/geometry/vec';
import { flatten } from '../src/geometry/entity';
import { newDoc, COLORS, type Doc } from '../src/model/types';
import { TEXT_DEFAULTS } from '../src/text/text';
import { cutOrder, laserPaths, insideAfterCount, type LPath } from '../src/laser/order';
import { exportLaserSVG } from '../src/laser/export';
import { LB_LAYER, LB_PALETTE, lbHex } from '../src/laser/palette';

let seq = 0;
const base = (color: any = 'red') => ({ id: 'e' + (++seq), layer: 'L1', color, w: 0.1 });
const poly = (pts: Point[], closed = true, color: any = 'red'): any => ({ ...base(color), type: 'poly', closed, pts });
const circle = (c: Point, r: number, color: any = 'red'): any => ({ ...base(color), type: 'circle', c, r });
const line = (a: Point, b: Point, color: any = 'red'): any => ({ ...base(color), type: 'line', a, b });
const rect = (x: number, y: number, w: number, h: number, color: any = 'red') => poly([P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)], true, color);
const star = (c: Point, R: number, r: number, color: any = 'red') => poly(Array.from({ length: 10 }, (_, i) => { const a = Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r : R; return P(c.x + q * Math.cos(a), c.y + q * Math.sin(a)); }), true, color);
const docOf = (ents: any[], w = 297, h = 210): Doc => { const d = newDoc(); d.ents = ents; d.page = { w, h, preset: 'custom' }; return d; };
/** a seeded shuffle, so the "drawing order" is messy but repeatable */
const shuffle = <T>(a: T[], seed = 7) => { const r = a.slice(); let s = seed; for (let i = r.length - 1; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [r[i], r[j]] = [r[j], r[i]]; } return r; };

/** 30 pupils' key rings on A4 (circles, stars, rounded tags), each with a hole and something engraved, drawn in a messy order. */
function classSheet() {
  const outlines: any[] = [], holes: any[] = [], marks: any[] = [];
  for (let i = 0; i < 30; i++) {
    const c = P(25 + (i % 6) * 48, 25 + Math.floor(i / 6) * 40), kind = i % 3;
    if (kind === 0) outlines.push(circle(c, 17));
    else if (kind === 1) outlines.push(star(c, 19, 9));
    else outlines.push({ ...base('red'), type: 'poly', closed: true, pts: [P(c.x - 18, c.y - 12), P(c.x + 18, c.y - 12), P(c.x + 18, c.y + 12), P(c.x - 18, c.y + 12)], bulge: [0, 0.3, 0, 0.3] });
    holes.push(circle(P(c.x, c.y + (kind === 1 ? 8 : 10)), 2.5));
    marks.push(i % 2 ? circle(P(c.x, c.y - 2), 3, 'blue') : rect(c.x - 3, c.y - 6, 6, 4, 'yellow'));
  }
  // worst case for a laser: every outline drawn first, then the holes, then the engraving
  return docOf([...shuffle(outlines), ...shuffle(holes, 11), ...shuffle(marks, 13)]);
}

describe('Laser colours (LightBurn layers)', () => {
  it('red, blue, black and green land on LightBurn layers 02, 01, 00, 03 with its exact colours', () => {
    expect(lbHex('red')).toBe('#FF0000'); expect(lbHex('blue')).toBe('#0000FF'); expect(lbHex('ink')).toBe('#000000'); expect(lbHex('green')).toBe('#00E000');
    expect([LB_LAYER.red, LB_LAYER.blue, LB_LAYER.ink, LB_LAYER.green]).toEqual([2, 1, 0, 3]);
  });
  it('every Kerf colour (and paint fills) gets its own LightBurn layer', () => {
    const keys = [...Object.keys(COLORS), 'paint'], layers = keys.map(k => (LB_LAYER as any)[k]);
    expect(new Set(layers).size).toBe(keys.length);
    expect(layers.every(n => n >= 0 && n < LB_PALETTE.length)).toBe(true);
  });
});

describe('Cut order: the class sheet', () => {
  const r = cutOrder(classSheet());
  it('every hole is cut before the outline around it (30 key rings, 0 mistakes)', () => {
    expect(r.outlinesWithInside).toBe(30);
    expect(r.insideAfter).toBe(0);
    // the drawing order alone would get all of them wrong
    expect(insideAfterCount(r.drawn).bad).toBeGreaterThanOrEqual(30);
  });
  it('engraving comes before scoring, scoring before cutting', () => {
    const rank = { engrave: 0, score: 1, cut: 2 } as const, ph = r.paths.map(p => rank[p.phase]);
    expect(ph.every((v, i) => i === 0 || ph[i - 1] <= v)).toBe(true);
    expect(r.paths.filter(p => p.phase === 'engrave').length).toBe(15);
    expect(r.paths.filter(p => p.phase === 'score').length).toBe(15);
    expect(r.paths.filter(p => p.phase === 'cut').length).toBe(60);
  });
  it('travel with the laser off is at least 30 % shorter than in drawing order', () => {
    expect(r.travel).toBeLessThan(0.7 * r.travelDrawn);
  });
  it('nothing is lost: same paths in, same paths out', () => {
    expect(r.paths.length).toBe(r.drawn.length);
    expect(new Set(r.paths.flatMap(p => p.ids)).size).toBe(90);
  });
});

describe('Cut order: rules', () => {
  it('nested cut-outs are cut from the inside out (hole → piece → window → frame)', () => {
    const frame = rect(0, 0, 100, 100), window = rect(20, 20, 60, 60), piece = rect(30, 30, 40, 40), hole = circle(P(50, 50), 5);
    const r = cutOrder(docOf([frame, window, piece, hole]));
    expect(r.paths.map(p => p.ids[0])).toEqual([hole.id, piece.id, window.id, frame.id]);
    expect(r.insideAfter).toBe(0);
  });
  it('an open cut line inside a shape (a slit) is cut before the shape', () => {
    const body = rect(0, 0, 60, 40), slit = line(P(10, 20), P(50, 20));
    const r = cutOrder(docOf([body, slit]));
    expect(r.paths[0].ids[0]).toBe(slit.id); expect(r.insideAfter).toBe(0);
  });
  it('a square drawn as 4 loose lines (some backwards, small gaps) becomes one closed path; its hole goes first', () => {
    const sq = [line(P(0, 0), P(50, 0)), line(P(50, 50), P(50.03, 0)), line(P(50, 50), P(0, 50)), line(P(0, 0.02), P(0, 50))], hole = circle(P(25, 25), 4);
    const r = cutOrder(docOf([...sq, hole]));
    expect(r.paths.length).toBe(2); expect(r.joined).toEqual({ from: 4, to: 1 });
    const out = r.paths[1]; expect(out.closed).toBe(true); expect(out.ids.length).toBe(4);
    expect(r.paths[0].ids[0]).toBe(hole.id); expect(r.insideAfter).toBe(0);
  });
  it('different colours are never joined', () => {
    const r = cutOrder(docOf([line(P(0, 0), P(10, 0), 'red'), line(P(10, 0), P(20, 0), 'magenta')]));
    expect(r.paths.length).toBe(2);
  });
  it('shapes drawn twice are cut once; a score line on a cut line is dropped; a line drawn twice is not cut there-and-back', () => {
    const a = rect(0, 0, 30, 30), b = rect(0, 0, 30, 30), c = circle(P(80, 80), 10), s = circle(P(80, 80), 10, 'blue'), l1 = line(P(0, 100), P(50, 100)), l2 = line(P(50, 100.01), P(0, 100));
    const r = cutOrder(docOf([a, b, c, s, l1, l2]));
    expect(r.removed).toBe(3);
    expect(r.paths.length).toBe(3); expect(r.paths.every(p => p.phase === 'cut')).toBe(true);
  });
  it('closed shapes start at a corner near the head; open lines start at the nearer end', () => {
    const r = cutOrder(docOf([rect(100, 100, 40, 20), line(P(200, 150), P(160, 150))]), { start: P(0, 0) });
    expect(r.paths[0].rings[0][0].a).toEqual(P(100, 100));
    // after the rectangle (ends where it began, 100,100) the line's nearer end is 160,150
    expect(r.paths[1].rings[0][0].a).toEqual(P(160, 150));
  });
  it('a circle starts at its point nearest the head', () => {
    const r = cutOrder(docOf([circle(P(50, 50), 10)]), { start: P(50, 0) });
    const s = r.paths[0].rings[0][0].a; expect(s.x).toBeCloseTo(50, 6); expect(s.y).toBeCloseTo(40, 6);
  });
  it('hidden layers, "don’t cut" colours and dimensions are left out', () => {
    const d = docOf([rect(0, 0, 10, 10), { ...rect(20, 0, 10, 10), layer: 'L2' }, rect(40, 0, 10, 10, 'grey'),
      { ...base('grey'), type: 'dim', mode: 'h', p1: P(0, 0), p2: P(10, 0), off: P(5, -5) }]);
    d.layers.push({ id: 'L2', name: 'Hidden', visible: false, active: false } as any); d.modes = { grey: 'off' };
    expect(laserPaths(d).length).toBe(1);
  });
  it('text in an engrave-area colour is one area (letters with their holes); text set to score is its letter outlines', () => {
    const t = (color: any) => ({ ...base(color), type: 'text', text: 'BOB', ...TEXT_DEFAULTS, size: 10, at: P(10, 10), angle: 0 });
    const area = laserPaths(docOf([t('yellow')])); expect(area.length).toBe(1); expect(area[0].kind).toBe('area'); expect(area[0].rings.length).toBeGreaterThanOrEqual(5);
    const lines = laserPaths(docOf([t('blue')])); expect(lines.length).toBeGreaterThanOrEqual(5); expect(lines.every(p => p.phase === 'score')).toBe(true);
  });
  it('paint-bucket fills are only engraved when asked', () => {
    const f = { ...base('ink'), type: 'fill', rings: [[P(0, 0), P(10, 0), P(10, 10), P(0, 10)]], paint: 'pink' };
    expect(laserPaths(docOf([f])).length).toBe(0);
    const p = laserPaths(docOf([f]), { fills: true }); expect(p.length).toBe(1); expect(p[0].key).toBe('paint');
  });
});

// ---- reading the exported SVG back (exact arcs, ellipses and curves) to check the geometry ----
function arcCentre(p0: Point, p1: Point, rx: number, ry: number, phi: number, fa: number, fs: number) {
  const c = Math.cos(phi), s = Math.sin(phi), dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2;
  const x1 = c * dx + s * dy, y1 = -s * dx + c * dy, lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1, den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const k = (fa === fs ? -1 : 1) * Math.sqrt(Math.max(0, num / den)), cx1 = k * rx * y1 / ry, cy1 = -k * ry * x1 / rx;
  const cx = c * cx1 - s * cy1 + (p0.x + p1.x) / 2, cy = s * cx1 + c * cy1 + (p0.y + p1.y) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry); let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI; if (fs && dt < 0) dt += 2 * Math.PI;
  return (t: number) => { const a = t1 + dt * t; return P(cx + rx * Math.cos(a) * c - ry * Math.sin(a) * s, cy + rx * Math.cos(a) * s + ry * Math.sin(a) * c); };
}
/** Sample an SVG path's d (absolute M L C A Z) into points, in drawing coordinates (y up). */
function sampleD(d: string, H: number): Point[][] {
  const tk = d.match(/[MLCAZ]|-?[\d.]+(?:e-?\d+)?/g)!, out: Point[][] = []; let i = 0, cur = P(0, 0), cmd = '', path: Point[] = [], st = cur;
  const n = () => parseFloat(tk[i++]), pt = () => { const x = n(), y = n(); return P(x, y); };
  while (i < tk.length) {
    if (/[A-Z]/.test(tk[i])) cmd = tk[i++];
    if (cmd === 'M') { if (path.length) out.push(path); cur = st = pt(); path = [cur]; cmd = 'L'; }
    else if (cmd === 'L') { cur = pt(); path.push(cur); }
    else if (cmd === 'C') { const a = cur, b = pt(), c = pt(), e = pt(); for (let k = 1; k <= 256; k++) { const t = k / 256, u = 1 - t; path.push(P(u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * e.x, u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * e.y)); } cur = e; }
    else if (cmd === 'A') { const rx = n(), ry = n(), rot = n() * DEG, fa = n(), fs = n(), e = pt(), f = arcCentre(cur, e, rx, ry, rot, fa, fs); for (let k = 1; k <= 512; k++) path.push(f(k / 512)); cur = e; }
    else if (cmd === 'Z') { path.push(st); cur = st; }
  }
  if (path.length) out.push(path);
  return out.map(p => p.map(q => P(q.x, H - q.y)));
}
const segDist = (p: Point, a: Point, b: Point) => { const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0; return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); };
const toPoly = (pts: Point[], q: Point, closed: boolean) => { let m = Infinity; const n = pts.length; for (let i = 0; i + 1 < n + (closed ? 1 : 0); i++) m = Math.min(m, segDist(q, pts[i], pts[(i + 1) % n])); return m; };

describe('Export for laser: the SVG file', () => {
  const shapes: any[] = [
    circle(P(40, 40), 20), { ...base(), type: 'ellipse', c: P(120, 50), rx: 30, ry: 12, rot: 25 * DEG },
    { ...base(), type: 'arc', c: P(200, 50), r: 15, a0: 10 * DEG, a1: 250 * DEG },
    { ...base(), type: 'poly', closed: true, pts: [P(20, 120), P(80, 120), P(80, 160), P(20, 160)], bulge: [0.4, 0, -0.25, 0] },
    { ...base(), type: 'spline', closed: false, pts: [P(120, 120), P(160, 170), P(200, 120)], h: [[P(110, 110), P(130, 140)], [P(140, 170), P(180, 170)], [P(190, 140), P(210, 110)]] },
  ];
  const doc = docOf(shapes), x = exportLaserSVG(doc);
  it('every shape comes back within 0.01 mm of the drawing (true arcs, ellipses and curves; started anywhere, any direction)', () => {
    const ds = [...x.svg.matchAll(/<path id="step-\d+" d="([^"]+)"/g)].map(m => m[1]);
    expect(ds.length).toBe(shapes.length);
    for (const s of shapes) {
      const f = flatten(s, 0.0005), back = ds.map(d => sampleD(d, doc.page.h)[0]);
      // find the exported path that matches this shape, then check both ways
      const errs = back.map(b => Math.max(...b.map(q => toPoly(f.pts, q, f.closed)), ...f.pts.filter((_, i) => i % 5 === 0).map(q => toPoly(b, q, false))));
      expect(Math.min(...errs), s.type).toBeLessThan(0.01);
    }
  });
  it('colours are LightBurn’s exact layer colours; no sheet outline (LightBurn would put it on a cutting layer)', () => {
    expect([...x.svg.matchAll(/stroke="(#[0-9A-F]{6})"/g)].map(m => m[1]).every(c => c === '#FF0000')).toBe(true);
    expect(x.svg).not.toMatch(/<rect/); expect(x.svg).not.toMatch(/#F36926/i);
  });
  it('the legend says which LightBurn layer each colour went to and what it does', () => {
    const y = exportLaserSVG(classSheet());
    expect(y.legend.map(l => [l.label, l.layer, l.does])).toEqual([['Blue', '01', 'Engrave line'], ['Red', '02', 'Cut'], ['Yellow', '04', 'Engrave area']]);
    expect(y.counts).toEqual({ engrave: 15, score: 15, cut: 60 });
  });
  it('steps are numbered in cut order in the file', () => {
    const ids = [...x.svg.matchAll(/id="step-(\d+)"/g)].map(m => +m[1]);
    expect(ids).toEqual(ids.map((_, i) => i + 1));
  });
});

export type { LPath };
void dist;
