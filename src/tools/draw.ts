/** Drawing tools: line, rectangle, circle/ellipse, arc, dimension. */
import { type Point, P, add, sub, dist, normA, angOf, clean, cp, fmt, DEG } from '../geometry/vec';
import { pointTool, type Tool } from '../editor/tool';
import type { Editor } from '../editor/editor';
import type { Shape } from '../model/types';
import { ICONS } from './icons';
import { arc3, tangentArc, endTangent } from '../geometry/arcs';
import { dimValue } from '../geometry/dims';
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

export const lineTool: Tool = pointTool({
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
  preview(ed, pts, cur, o) {
    const last = pts[pts.length - 1];
    o.ghost({ type: 'poly', closed: false, pts: [...pts, cur] } as Shape);
    o.label(`L ${fmt(dist(last, cur), 3)}  ∠ ${fmt(normA(angOf(last, cur)) / DEG, 2)}°`);
  },
});

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
