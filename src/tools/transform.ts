/** Precise transform tools with repeats: move/copy, rotate, mirror. */
import { type Point, P, sub, dist, fmt, DEG, angOf, normA, cp } from '../geometry/vec';
import type { Editor } from '../editor/editor';
import { affEnt, affMove, affRot, affMir } from '../geometry/affine';
import { pointTool, type Tool } from '../editor/tool';
import type { Shape } from '../model/types';
import { ICONS } from './icons';

export const moveTool: Tool = pointTool({
  id: 'move', label: 'Move / copy', key: 'M', icon: ICONS.move, group: 4, need: 2, needsSelection: true,
  prompts: ['Locate base point', 'Locate destination (Rel entry gives an exact offset)'],
  options: [{ key: 'moveCopy', label: 'Leave original (copy)', type: 'check' }],
  make(ed, p) { ed.store.change(() => ed.transformSel(affMove(sub(p[1], p[0])), ed.opt.moveCopy ? 1 : 0)); },
  preview(ed, p, cur, o) {
    o.ghost({ type: 'line', a: p[0], b: cur } as Shape);
    const A = affMove(sub(cur, p[0])); for (const e of ed.selected()) o.ghost(affEnt(e as Shape, A));
    o.label(`Δ ${fmt(cur.x - p[0].x, 3)}, ${fmt(cur.y - p[0].y, 3)}`);
  },
});

const rotateBase = pointTool({
  id: 'rotate', label: 'Rotate / repeat', key: 'Q', icon: ICONS.rotate, group: 4, need: 1, needsSelection: true,
  prompts: ['Locate the centre of rotation'],
  options: [
    { key: 'rotAngle', label: 'Angle °', type: 'number', step: 1 },
    { key: 'rotCopies', label: 'Repeats', type: 'number', min: 0, step: 1 },
    { key: 'rotHint', label: '0 repeats = rotate in place', type: 'hint' },
  ],
  make(ed, p) {
    const n = Math.max(0, Math.round(+ed.opt.rotCopies)), t = +ed.opt.rotAngle * DEG;
    ed.store.change(() => { if (n === 0) ed.transformSel(affRot(p[0], t)); else for (let i = 1; i <= n; i++) ed.transformSel(affRot(p[0], t * i), 1, true); });
  },
});
export const rotateTool: Tool = {
  ...rotateBase,
  overlay(ed, o) {
    if (!ed.hover) return;
    const n = Math.max(1, Math.round(+ed.opt.rotCopies) || 1), t = +ed.opt.rotAngle * DEG, c = ed.cursorPoint();
    for (let i = 1; i <= n; i++) for (const e of ed.selected()) o.ghost(affEnt(e as Shape, affRot(c, t * i)));
  },
};

/**
 * Second axis point with angle steps: the axis turns in steps (15° by default, measured
 * from horizontal, so it lands on 0°, 15°, 30°, 45° …). Hold Shift to move freely.
 * A snap to a point on a shape (end, middle, centre …) is used exactly.
 */
export function mirrorAxisPoint(ed: Editor, p0: Point, q: Point): Point {
  const k = ed.snapRes?.k, objectSnap = k && !['grid', 'track', 'nearest'].includes(k);
  if (ed.mods.shift || objectSnap) return q;
  const st = Math.max(0.1, +ed.opt.mirStep || 15) * DEG, L = dist(p0, q); if (L < 1e-9) return q;
  const a = Math.round(angOf(p0, q) / st) * st;
  return cp(P(p0.x + L * Math.cos(a), p0.y + L * Math.sin(a)));
}
const axisLabel = (p0: Point, q: Point) => { let a = normA(angOf(p0, q)) / DEG; if (a >= 180 - 1e-9) a -= 180; return `Axis ${fmt(a, 1)}°`; };
const mirrorBase = pointTool({
  id: 'mirror', label: 'Mirror', key: 'I', icon: ICONS.mirror, group: 4, need: 2, needsSelection: true,
  prompts: ['Locate one point on the axis of reflection', 'Locate another point on the axis · the axis turns in steps · hold Shift to move freely'],
  options: [
    { key: 'mirKeep', label: 'Keep original (repeat)', type: 'check' },
    { key: 'mirStep', label: 'Angle step', type: 'number', min: 1, max: 90, step: 1, unit: '°' },
    { key: 'mirHint', label: 'Shift = free angle', type: 'hint' },
  ],
  make(ed, p) { if (dist(p[0], p[1]) < 1e-9) return ed.toast('Axis points must differ'); ed.store.change(() => ed.transformSel(affMir(p[0], p[1]), ed.opt.mirKeep ? 1 : 0)); },
  preview(ed, p, cur, o) {
    const q = mirrorAxisPoint(ed, p[0], cur);
    o.ghost({ type: 'line', a: p[0], b: q } as Shape);
    if (dist(p[0], q) > 1e-6) { const A = affMir(p[0], q); for (const e of ed.selected()) o.ghost(affEnt(e as Shape, A)); o.label(axisLabel(p[0], q), q); }
  },
});
export const mirrorTool: Tool = {
  ...mirrorBase,
  located(ed, p) { mirrorBase.located!(ed, ed.pts.length === 1 ? mirrorAxisPoint(ed, ed.pts[0], p) : p); },
};
