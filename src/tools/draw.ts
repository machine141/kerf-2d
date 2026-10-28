/** Drawing tools: line, rectangle, circle/ellipse, arc, dimension. */
import { type Point, P, add, sub, dist, normA, angOf, clean, cp, fmt, DEG } from '../geometry/vec';
import { pointTool, type Tool, type Overlay } from '../editor/tool';
import type { Editor } from '../editor/editor';
import type { Shape } from '../model/types';
import { ICONS } from './icons';
import { arc3, tangentArc, endTangent } from '../geometry/arcs';
import { dimValue } from '../geometry/dims';
import { autoHandles } from '../geometry/spline';
import { hasBulge } from '../geometry/path';

const addShape = (ed: Editor, s: Shape) => { const e = ed.store.change(() => ed.store.add(s)); return e; };

export function makeRect(p: Point[], m: { shift: boolean; alt: boolean }, from: string): Shape {
  const fromC = (from === 'centre') !== !!m.alt; let dx = p[1].x - p[0].x, dy = p[1].y - p[0].y;
  if (m.shift) { const s = Math.max(Math.abs(dx), Math.abs(dy)); dx = (dx < 0 ? -1 : 1) * s; dy = (dy < 0 ? -1 : 1) * s; }
  const a = fromC ? sub(p[0], P(dx, dy)) : p[0], b = add(p[0], P(dx, dy));
  return { type: 'poly', closed: true, pts: [cp(a), cp(P(b.x, a.y)), cp(b), cp(P(a.x, b.y))] } as Shape;
}
export function makeCircle(p: Point[], m: { shift: boolean; alt: boolean }, from: string): Shape {
  if (from === 'centre') return { type: 'circle', c: p[0], r: clean(dist(p[0], p[1])) } as Shape;
  const fromC = !!m.alt; let dx = p[1].x - p[0].x, dy = p[1].y - p[0].y;
  if (m.shift) { const s = Math.max(Math.abs(dx), Math.abs(dy)); dx = (dx < 0 ? -1 : 1) * s; dy = (dy < 0 ? -1 : 1) * s; }
  const c = fromC ? p[0] : add(p[0], P(dx / 2, dy / 2)), rx = clean(Math.abs(fromC ? dx : dx / 2)), ry = clean(Math.abs(fromC ? dy : dy / 2));
  if (Math.abs(rx - ry) < 1e-9) return { type: 'circle', c: cp(c), r: rx } as Shape;
  return { type: 'ellipse', c: cp(c), rx, ry, rot: 0 } as Shape;
}
const zero = (s: Shape) => (s.type === 'circle' && s.r < 1e-9) || (s.type === 'ellipse' && Math.min(s.rx, s.ry) < 1e-9) || (s.type === 'poly' && dist(s.pts[0], s.pts[2]) < 1e-9);

/** A ring on the first point of a shape being drawn: come back to it to close the shape. */
export function startMarker(o: Overlay, p: Point) {
  o.custom((ctx, ed, C) => { const s = ed.w2s(p); ctx.strokeStyle = C['--ok']; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(s.x, s.y, 9, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); });
}
const lineBase = pointTool({
  id: 'line', label: 'Line', key: 'L', icon: ICONS.line, group: 1, need: 'open', constrain45: true,
  prompts: ['Locate start point', 'Locate next point · Shift = 45° steps · Enter, double-click or right-click to finish · C closes'],
  options: [
    { key: 'lineClose', label: 'Close shape (C)', type: 'button', run: ed => { if (ed.pts.length >= 3) { ed.state.close = true; ed.finish(); } } },
    { key: 'lineFinish', label: 'Finish (Enter)', type: 'button', run: ed => ed.finish() },
    { key: 'lineHint', label: 'Shift = 45° · Backspace removes the last point', type: 'hint' },
  ],
  make(ed, pts, closed) {
    if (pts.length === 2 && !closed) addShape(ed, { type: 'line', a: pts[0], b: pts[1] } as Shape);
    else addShape(ed, { type: 'poly', closed: !!closed && pts.length > 2, pts } as Shape);
  },
  keyExtra(ed, key) { if ((key === 'c' || key === 'C') && ed.pts.length >= 3) { ed.state.close = true; ed.finish(); return true; } return false; },
  intercept(ed, p) { if (ed.pts.length >= 3 && dist(p, ed.pts[0]) < 1e-9) { ed.state.close = true; ed.finish(); return true; } return false; },
  preview(ed, pts, cur, o) {
    const last = pts[pts.length - 1];
    if (pts.length >= 2) startMarker(o, pts[0]);
    o.ghost({ type: 'poly', closed: false, pts: [...pts, cur] } as Shape);
    o.label(`L ${fmt(dist(last, cur), 3)}  ∠ ${fmt(normA(angOf(last, cur)) / DEG, 2)}°`);
  },
});
export const lineTool: Tool = { ...lineBase, closes: true };

export const rectTool: Tool = pointTool({
  id: 'rect', label: 'Rectangle', key: 'R', icon: ICONS.rect, group: 1, need: 2, drag: true,
  prompts: ['Locate first corner (or centre) · drag, or click twice', 'Locate opposite corner · Shift = square · Alt = from centre · type Rel W, H for an exact size'],
  options: [
    { key: 'rectFrom', label: 'Draw from', type: 'seg', choices: [['corner', 'Corner'], ['centre', 'Centre']] },
    { key: 'rectHint', label: 'Shift = square · Alt = swap corner/centre', type: 'hint' },
  ],
  make(ed, pts) { const s = makeRect(pts, ed.mods, ed.opt.rectFrom); if (zero(s)) return ed.toast('Zero-size rectangle ignored'); addShape(ed, s); },
  preview(ed, pts, cur, o) {
    const r = makeRect([pts[0], cur], ed.mods, ed.opt.rectFrom) as any; o.ghost(r);
    o.label(`${fmt(Math.abs(r.pts[2].x - r.pts[0].x), 3)} × ${fmt(Math.abs(r.pts[2].y - r.pts[0].y), 3)} mm`);
  },
});

export const circleTool: Tool = pointTool({
  id: 'circle', label: 'Circle / ellipse', key: 'C', icon: ICONS.circle, group: 1, need: 2, drag: true,
  prompts: ['Locate centre (or first corner of the box) · drag, or click twice', 'Locate a point on the circle · in Box mode Shift = perfect circle, Alt = from centre'],
  options: [
    { key: 'circFrom', label: 'Draw', type: 'seg', choices: [['centre', 'From centre'], ['box', 'In a box']] },
    { key: 'fixedR', label: 'Fixed radius', type: 'number', min: 0, placeholder: 'off', unit: 'mm', show: ed => ed.opt.circFrom === 'centre' },
    { key: 'circHint', label: 'Shift = perfect circle · Alt = from centre', type: 'hint', show: ed => ed.opt.circFrom === 'box' },
  ],
  intercept(ed, p) {
    const r = +ed.opt.fixedR;
    if (ed.opt.circFrom === 'centre' && r > 0 && !ed.pts.length) { addShape(ed, { type: 'circle', c: p, r } as Shape); ed.rel = p; return true; }
    return false;
  },
  make(ed, pts) { const s = makeCircle(pts, ed.mods, ed.opt.circFrom); if (zero(s)) return ed.toast('Zero-size circle ignored'); addShape(ed, s); },
  preview(ed, pts, cur, o) {
    const c = makeCircle([pts[0], cur], ed.mods, ed.opt.circFrom) as any; o.ghost(c);
    if (ed.opt.circFrom === 'centre') o.ghost({ type: 'line', a: pts[0], b: cur } as Shape);
    o.label(c.type === 'circle' ? `R ${fmt(c.r, 3)}  Ø ${fmt(c.r * 2, 3)}` : `${fmt(c.rx * 2, 3)} × ${fmt(c.ry * 2, 3)} ellipse`);
  },
});

const ARC_PROMPTS: Record<string, string[]> = {
  '3pt': ['Locate start point', 'Locate end point', 'Move to bend the arc, then click a point it passes through'],
  centre: ['Locate centre', 'Locate start point (sets the radius)', 'Locate end point (anticlockwise from start)'],
  tangent: ['Start at the end of a line or arc (snaps to its end)', 'Locate end point — the arc leaves the line smoothly'],
};
function arcFrom(ed: Editor, p: Point[]): Shape | null {
  const mode = ed.opt.arcMode;
  if (mode === 'centre') { const r = clean(dist(p[0], p[1])); return r < 1e-9 ? null : { type: 'arc', c: p[0], r, a0: normA(angOf(p[0], p[1])), a1: normA(angOf(p[0], p[2])) } as Shape; }
  if (mode === 'tangent') { const dir = ed.state.tanDir; return dir ? tangentArc(p[0], dir, p[1]) : null; }
  return arc3(p[0], p[1], p[2]);
}
export const arcTool: Tool = pointTool({
  id: 'arc', label: 'Arc', key: 'A', icon: ICONS.arc, group: 1,
  need: ed => ed.opt.arcMode === 'tangent' ? 2 : 3,
  prompts: ed => ARC_PROMPTS[ed.opt.arcMode] || ARC_PROMPTS['3pt'],
  options: [
    { key: 'arcMode', label: 'Arc', type: 'seg', choices: [['3pt', '3 points'], ['tangent', 'Tangent'], ['centre', 'Centre, start, end']] },
    { key: 'arcHint', label: 'Snaps to line ends — e.g. join two parallel lines with a 3-point arc', type: 'hint', show: ed => ed.opt.arcMode === '3pt' },
  ],
  intercept(ed, p) {
    if (ed.opt.arcMode !== 'tangent' || ed.pts.length) return false;
    const dir = endTangent(ed.doc.ents.filter(ed.store.visible) as Shape[], p);
    if (!dir) { ed.toast('Start a tangent arc on the end of a line, arc or open path'); return true; }
    ed.state.tanDir = dir; return false;
  },
  make(ed, p) { const a = arcFrom(ed, p); if (!a) return ed.toast('Those points are in a straight line — no arc'); addShape(ed, a); if (ed.opt.arcMode === 'tangent') ed.state.tanDir = null; },
  preview(ed, p, cur, o) {
    const mode = ed.opt.arcMode;
    if (mode === 'centre' && p.length === 1) { o.ghost({ type: 'line', a: p[0], b: cur } as Shape); o.label(`R ${fmt(dist(p[0], cur), 3)}`); return; }
    if (mode === '3pt' && p.length === 1) { o.ghost({ type: 'line', a: p[0], b: cur } as Shape); o.label(`chord ${fmt(dist(p[0], cur), 3)}`); return; }
    const a: any = arcFrom(ed, [...p, cur]);
    if (!a) { o.ghost({ type: 'line', a: p[p.length - 1], b: cur } as Shape); return; }
    o.ghost(a); o.label(`R ${fmt(a.r, 3)}  span ${fmt(normA(a.a1 - a.a0) / DEG, 2)}°`);
  },
});

const linearDim: Tool = pointTool({
  id: 'dim', label: 'Dimension', key: 'D', icon: ICONS.dim, group: 2, need: 3, constrain45: true,
  prompts: ['Locate first point to dimension', 'Locate second point', 'Locate the position of the dimension line'],
  make(ed, p) { addDim(ed, { type: 'dim', mode: ed.opt.dimMode, p1: p[0], p2: p[1], off: p[2] } as Shape); },
  preview(ed, p, cur, o) {
    if (p.length === 1) { o.ghost({ type: 'line', a: p[0], b: cur } as Shape); o.label(dimValue(dist(p[0], cur), ed.doc.dim)); }
    else o.ghost({ type: 'dim', mode: ed.opt.dimMode, p1: p[0], p2: p[1], off: cur } as Shape);
  },
});
const addDim = (ed: Editor, s: Shape) => addShape(ed, { ...s, color: ed.doc.dim.color } as Shape);
const radial = (ed: Editor) => ed.opt.dimMode === 'r' || ed.opt.dimMode === 'd';

/** Circle, arc or curved path segment under the cursor: its centre, radius and the nearest point on it. */
export function pickRound(ed: Editor, raw: Point): { c: Point; r: number; id: string } | null {
  const hit = ed.pick(raw, Math.max(10, +ed.opt.pickPx || 14), e => e.type === 'circle' || e.type === 'arc' || (e.type === 'poly' && hasBulge(e)));
  if (!hit) return null;
  if (hit.pr.t === 'arc') return { c: hit.pr.c, r: hit.pr.r, id: hit.e.id };
  return null;
}
/** Dimension tool: aligned / horizontal / vertical between points, or radius / diameter of a circle or arc. */
export const dimTool: Tool = {
  ...linearDim,
  options: [{ key: 'dimMode', label: 'Type', type: 'seg', choices: [['a', 'Aligned'], ['h', 'Horizontal'], ['v', 'Vertical'], ['r', 'Radius'], ['d', 'Diameter']] }],
  prompt: ed => !radial(ed) ? linearDim.prompt(ed) : ed.state.round ? 'Move to place the label · click to place · Esc to cancel' : `Click a circle, arc or rounded corner to show its ${ed.opt.dimMode === 'd' ? 'diameter' : 'radius'}`,
  activate(ed) { ed.state.round = null; },
  down(ed, raw, info) {
    if (!radial(ed)) return linearDim.down!(ed, raw, info);
    if (!ed.state.round) { const r = pickRound(ed, raw); if (!r) { ed.toast('Click on a circle, an arc or a rounded corner'); return; } ed.state.round = r; ed.changed('prompt'); return; }
    placeRound(ed, ed.snapAt(raw).p);
  },
  up(ed, raw, info) { if (!radial(ed)) linearDim.up!(ed, raw, info); },
  located(ed, p) { if (!radial(ed)) return linearDim.located!(ed, p); if (ed.state.round) placeRound(ed, p); },
  cancel(ed) { if (ed.state.round) { ed.state.round = null; ed.changed('prompt'); return true; } return linearDim.cancel!(ed); },
  overlay(ed, o) {
    if (!radial(ed)) return linearDim.overlay!(ed, o);
    const R = ed.state.round;
    if (!R) { const h = ed.hover && pickRound(ed, ed.cur); if (h) { o.highlight([h.id], 'source'); o.label(`${ed.opt.dimMode === 'd' ? 'Ø' : 'R'}${dimValue(ed.opt.dimMode === 'd' ? 2 * h.r : h.r, ed.doc.dim)}`); } return; }
    o.ghost(roundDim(ed, R, ed.cursorPoint()));
  },
};
const roundDim = (ed: Editor, R: { c: Point; r: number }, at: Point) => ({ type: 'dim', mode: ed.opt.dimMode, p1: R.c, p2: P(R.c.x + R.r, R.c.y), off: at }) as Shape;
function placeRound(ed: Editor, at: Point) { addDim(ed, roundDim(ed, ed.state.round, at)); ed.state.round = null; ed.changed('prompt'); }

// ---------- polygon / star ----------
/** Regular polygon (or star) from its centre and a point giving size and turn. */
export function makePolygon(c: Point, q: Point, sides: number, measure: 'corner' | 'flat', star: boolean, innerPct: number, stepDeg: number): Shape {
  const n = Math.max(3, Math.min(64, Math.round(sides))), d = dist(c, q);
  let a = angOf(c, q); if (stepDeg > 0) a = Math.round(a / (stepDeg * DEG)) * stepDeg * DEG;
  const R = measure === 'flat' && !star ? d / Math.cos(Math.PI / n) : d, a0 = measure === 'flat' && !star ? a + Math.PI / n : a;
  const pts: Point[] = [];
  if (!star) for (let i = 0; i < n; i++) pts.push(cp(P(c.x + R * Math.cos(a0 + i * 2 * Math.PI / n), c.y + R * Math.sin(a0 + i * 2 * Math.PI / n))));
  else { const r2 = R * Math.max(5, Math.min(95, innerPct)) / 100; for (let i = 0; i < 2 * n; i++) { const rr = i % 2 ? r2 : R, t = a + i * Math.PI / n; pts.push(cp(P(c.x + rr * Math.cos(t), c.y + rr * Math.sin(t)))); } }
  return { type: 'poly', closed: true, pts } as Shape;
}
const polyArgs = (ed: Editor, c: Point, q: Point) => makePolygon(c, q, +ed.opt.polySides, ed.opt.polyMeasure, !!ed.opt.polyStar, +ed.opt.polyInner, ed.mods.shift ? 0 : 15);
export const polygonTool: Tool = pointTool({
  id: 'polygon', label: 'Polygon / star', key: 'N', group: 1, need: 2,
  icon: '<path d="M12 3l8.5 6.2-3.3 10H6.8L3.5 9.2z"/>',
  prompts: ['Locate the centre', 'Locate a corner (or the middle of a side) · turns in 15° steps · Shift = free · type Rel for an exact size'],
  options: [
    { key: 'polySides', label: 'Sides', type: 'number', min: 3, max: 64, step: 1 },
    { key: 'polyMeasure', label: 'Size to', type: 'seg', choices: [['corner', 'Corner'], ['flat', 'Flat side']], show: ed => !ed.opt.polyStar },
    { key: 'polyStar', label: 'Star', type: 'check' },
    { key: 'polyInner', label: 'Inner', type: 'number', min: 5, max: 95, step: 5, unit: '%', show: ed => !!ed.opt.polyStar },
  ],
  make(ed, p) { if (dist(p[0], p[1]) < 1e-9) return; addShape(ed, polyArgs(ed, p[0], p[1])); },
  preview(ed, p, cur, o) {
    if (dist(p[0], cur) < 1e-9) return;
    const s = polyArgs(ed, p[0], cur); o.ghost(s);
    const d = dist(p[0], cur), n = Math.max(3, Math.round(+ed.opt.polySides));
    const flat = ed.opt.polyMeasure === 'flat' && !ed.opt.polyStar, Rc = flat ? d / Math.cos(Math.PI / n) : d, Rf = flat ? d : d * Math.cos(Math.PI / n);
    o.label(ed.opt.polyStar ? `${n}-point star · R ${fmt(d, 2)} mm` : `${n} sides · side ${fmt(2 * Rc * Math.sin(Math.PI / n), 2)} · across corners ${fmt(2 * Rc, 2)} · across flats ${fmt(2 * Rf, 2)} mm`);
  },
});

// ---------- spline (smooth curve) ----------
const splineOf = (pts: Point[], closed: boolean): Shape => ({ type: 'spline', pts: pts.map(cp), h: autoHandles(pts, closed).map(([a, b]) => [cp(a), cp(b)]), closed } as Shape);
const splineBase = pointTool({
  id: 'spline', label: 'Spline (smooth curve)', key: 'B', group: 1, need: 'open',
  icon: '<path d="M3 18c3-9 6-12 9-7s6 4 9-6"/><circle cx="3" cy="18" r="1.3"/><circle cx="12" cy="11" r="1.3"/><circle cx="21" cy="5" r="1.3"/>',
  prompts: ['Click the first point of the curve', 'Click more points · come back to the first point to close it · Enter, double-click or right-click to finish'],
  options: [
    { key: 'splClose', label: 'Close curve (C)', type: 'button', run: ed => { if (ed.pts.length >= 3) { ed.state.close = true; ed.finish(); } } },
    { key: 'splFinish', label: 'Finish (Enter)', type: 'button', run: ed => ed.finish() },
    { key: 'splHint', label: 'Double-click the curve afterwards to drag points and handles (Alt = sharp corner)', type: 'hint' },
  ],
  make(ed, pts, closed) { addShape(ed, splineOf(pts, !!closed && pts.length > 2)); },
  keyExtra(ed, key) { if ((key === 'c' || key === 'C') && ed.pts.length >= 3) { ed.state.close = true; ed.finish(); return true; } return false; },
  intercept(ed, p) { if (ed.pts.length >= 3 && dist(p, ed.pts[0]) < 1e-9) { ed.state.close = true; ed.finish(); return true; } return false; },
  preview(ed, pts, cur, o) {
    if (pts.length >= 2) startMarker(o, pts[0]);
    const closing = ed.snapRes?.k === 'close';
    o.ghost(splineOf(closing ? pts : [...pts, cur], closing && pts.length > 2));
  },
});
export const splineTool: Tool = { ...splineBase, closes: true };

// ---------- spiral ----------
/**
 * Spiral from a centre outwards, as exact-ish cubic Béziers (one per 45°, built
 * from the curve's own tangents, so it is smooth and accurate).
 *  • Even: Archimedean — the gap between coils is the same all the way (tight or loose coil).
 *  • Growing: logarithmic — each coil wider than the last (shell / flower look).
 */
export function makeSpiral(c: Point, outer: Point, turns: number, innerR: number, kind: 'even' | 'grow', ccw: boolean, stepDeg: number): Shape | null {
  const R = dist(c, outer), T = Math.max(0.25, Math.min(50, turns)), r0 = Math.max(0, Math.min(innerR, R * 0.95));
  if (R < 1e-6) return null;
  let a1 = angOf(c, outer); if (stepDeg > 0) a1 = Math.round(a1 / (stepDeg * DEG)) * stepDeg * DEG;
  const span = T * 2 * Math.PI, s = ccw ? 1 : -1, a0 = a1 - s * span;
  const rAt = (u: number) => kind === 'grow' ? Math.max(r0, R * 0.02) * Math.pow(R / Math.max(r0, R * 0.02), u) : r0 + (R - r0) * u;   // u: 0 → 1 from inside out
  const drdu = (u: number) => kind === 'grow' ? rAt(u) * Math.log(R / Math.max(r0, R * 0.02)) : (R - r0);
  const pt = (u: number) => { const a = a0 + s * span * u, r = rAt(u); return P(c.x + r * Math.cos(a), c.y + r * Math.sin(a)); };
  const der = (u: number) => { const a = a0 + s * span * u, r = rAt(u), dr = drdu(u), da = s * span; return P(dr * Math.cos(a) - r * da * Math.sin(a), dr * Math.sin(a) + r * da * Math.cos(a)); };
  const n = Math.max(2, Math.ceil(T * 8)), pts: Point[] = [], h: [Point, Point][] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, p = pt(u), d = der(u), k = 1 / (3 * n);
    pts.push(cp(p)); h.push([cp(P(p.x - d.x * k, p.y - d.y * k)), cp(P(p.x + d.x * k, p.y + d.y * k))]);
  }
  h[0][0] = pts[0]; h[n][1] = pts[n];
  return { type: 'spline', pts, h, closed: false } as Shape;
}
/** The two clicks in order: centre then outer end, or (Start from: Outer end) the outer end first, then the centre. */
const fromEnd = (ed: Editor) => ed.opt.spFrom === 'end';
const spiralArgs = (ed: Editor, a: Point, b: Point) => fromEnd(ed)
  ? makeSpiral(b, a, +ed.opt.spTurns, +ed.opt.spInner, ed.opt.spKind, ed.opt.spDir === 'ccw', 0)
  : makeSpiral(a, b, +ed.opt.spTurns, +ed.opt.spInner, ed.opt.spKind, ed.opt.spDir === 'ccw', ed.mods.shift ? 0 : 15);
const spiralBase = pointTool({
  id: 'spiral', label: 'Spiral', key: 'J', group: 1, need: 2,
  icon: '<path d="M12 12a1.5 1.5 0 0 1 3 0 3 3 0 0 1-6 0 4.5 4.5 0 0 1 9 0 6 6 0 0 1-12 0 7.5 7.5 0 0 1 15 0"/>',
  prompts: ed => fromEnd(ed) ? ['Locate the outer end (snap to another spiral’s end to join them)', 'Locate the centre · wheel = turns'] : ['Locate the centre of the spiral', 'Locate the outer end (sets the size and where it finishes) · wheel = turns · Shift = free angle'],
  options: [
    { key: 'spFrom', label: 'Start from', type: 'seg', choices: [['centre', 'Centre'], ['end', 'Outer end']] },
    { key: 'spKind', label: 'Coils', type: 'seg', choices: [['even', 'Even'], ['grow', 'Growing']] },
    { key: 'spTurns', label: 'Turns', type: 'number', min: 0.25, max: 50, step: 0.5 },
    { key: 'spInner', label: 'Inner radius', type: 'number', min: 0, step: 1, unit: 'mm' },
    { key: 'spDir', label: 'Direction', type: 'seg', choices: [['ccw', '↺'], ['cw', '↻']] },
  ],
  make(ed, p) { const s = spiralArgs(ed, p[0], p[1]); if (s) addShape(ed, s); },
  preview(ed, p, cur, o) {
    const s = spiralArgs(ed, p[0], cur); if (!s) return; o.ghost(s);
    const R = dist(p[0], cur), r0 = Math.min(+ed.opt.spInner || 0, R * 0.95), T = +ed.opt.spTurns;
    if (fromEnd(ed)) o.custom((ctx, ed2, C) => { const q = ed2.w2s(p[0]); ctx.strokeStyle = C['--ok']; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(q.x, q.y, 6, 0, Math.PI * 2); ctx.stroke(); });
    o.label(ed.opt.spKind === 'even' ? `R ${fmt(R, 2)} · ${fmt(T, 2)} turns · gap ${fmt((R - r0) / Math.max(0.25, T), 2)} mm` : `R ${fmt(R, 2)} · ${fmt(T, 2)} turns · each coil ×${fmt(Math.pow(R / Math.max(r0, R * 0.02), 1 / Math.max(0.25, T)), 2)}`);
  },
});
export const spiralTool: Tool = {
  ...spiralBase,
  /** after the centre is placed, the wheel changes the number of turns (Shift = quarter turns) */
  wheel(ed, dir, info) { if (ed.pts.length !== 1) return false; ed.opt.spTurns = Math.max(0.25, Math.min(50, Math.round((+ed.opt.spTurns + dir * (info.shift ? 0.25 : 0.5)) * 4) / 4)); ed.changed('opts'); return true; },
};
