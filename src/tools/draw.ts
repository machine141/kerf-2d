/** Drawing tools: line, rectangle, circle/ellipse, arc, dimension. */
import { type Point, P, add, sub, dist, normA, angOf, clean, cp, fmt, DEG } from '../geometry/vec';
import { pointTool, type Tool } from '../editor/tool';
import type { Editor } from '../editor/editor';
import type { Shape } from '../model/types';
import { ICONS } from './icons';

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

export const arcTool: Tool = pointTool({
  id: 'arc', label: 'Arc · centre, start, end', key: 'A', icon: ICONS.arc, group: 1, need: 3,
  prompts: ['Locate centre', 'Locate start point (sets the radius)', 'Locate end point (anticlockwise from start)'],
  make(ed, p) { const r = clean(dist(p[0], p[1])); if (r < 1e-9) return; addShape(ed, { type: 'arc', c: p[0], r, a0: normA(angOf(p[0], p[1])), a1: normA(angOf(p[0], p[2])) } as Shape); },
  preview(ed, p, cur, o) {
    if (p.length === 1) { o.ghost({ type: 'line', a: p[0], b: cur } as Shape); o.label(`R ${fmt(dist(p[0], cur), 3)}`); return; }
    const r = dist(p[0], p[1]); o.ghost({ type: 'arc', c: p[0], r, a0: angOf(p[0], p[1]), a1: angOf(p[0], cur) } as Shape);
    o.label(`span ${fmt(normA(angOf(p[0], cur) - angOf(p[0], p[1])) / DEG, 2)}°`);
  },
});

export const dimTool: Tool = pointTool({
  id: 'dim', label: 'Dimension', key: 'D', icon: ICONS.dim, group: 2, need: 3, constrain45: true,
  prompts: ['Locate first point to dimension', 'Locate second point', 'Locate the position of the dimension line'],
  options: [{ key: 'dimMode', label: 'Type', type: 'select', choices: [['a', 'Aligned'], ['h', 'Horizontal'], ['v', 'Vertical']] }],
  make(ed, p) { addShape(ed, { type: 'dim', mode: ed.opt.dimMode, p1: p[0], p2: p[1], off: p[2] } as Shape); },
  preview(ed, p, cur, o) {
    if (p.length === 1) { o.ghost({ type: 'line', a: p[0], b: cur } as Shape); o.label(`${fmt(dist(p[0], cur), ed.doc.dim.dec)} mm`); }
    else o.ghost({ type: 'dim', mode: ed.opt.dimMode, p1: p[0], p2: p[1], off: cur } as Shape);
  },
});
