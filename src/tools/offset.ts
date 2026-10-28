/**
 * Contour / offset tool.
 *  • Click a shape → that shape (and anything joined to it end-to-end).
 *  • Click empty space inside an area → the enclosed boundary is traced (lines may cross).
 *  • Select several shapes first → contour around all of them together.
 *  • Text takes any open line drawn through its letters with it (one contour round the letters and along the line).
 *  • "One edge" mode → exact parallel copy of a single line/arc/circle.
 * Then move inside/outside to choose the side; the mouse wheel changes the distance.
 */
import { type Point, dist, clean, fmt } from '../geometry/vec';
import { prims, distPrim, bbox, type Prim } from '../geometry/entity';
import { offsetGeos, refit } from '../geometry/boolean';
import { makeSource, contour, connectedGroup, withSpines, offsetPrim, pointInSolid, type OffsetSource, type Side } from '../geometry/offset';
import { findRegion } from '../geometry/region';
import type { Tool } from '../editor/tool';
import type { Editor } from '../editor/editor';
import type { Entity, Shape } from '../model/types';
import { ICONS } from './icons';

interface OffState { spine?: boolean; srcPrims?: Prim[]; ids: Set<string>; shapes: Shape[]; source?: OffsetSource; edge?: Prim; region?: Shape; cache?: { key: string; res: Shape[] } }

export function offsetBegin(ed: Editor, shapes: Shape[], ids: string[], extra: Partial<OffState> = {}) {
  ed.state.off = { ids: new Set(ids), shapes, source: extra.edge ? undefined : makeSource(shapes), ...extra } as OffState;
  ed.changed('prompt');
}
function side(ed: Editor, cur: Point): Side | 'auto' {
  const o: OffState = ed.state.off, s = ed.opt.offSide;
  if (s !== 'auto') return s;
  if (o.edge) return 'auto';
  return o.source!.solid.length && pointInSolid(cur, o.source!.solid) ? 'in' : 'out';
}
function distance(ed: Editor, cur: Point) {
  const o: OffState = ed.state.off;
  if (!ed.opt.offFollow) return Math.max(0.001, +ed.opt.offD || 0);
  let d = Infinity; for (const s of o.shapes) for (const pr of prims(s)) d = Math.min(d, distPrim(cur, pr));
  const A = ed.doc.aids, st = (A.stepLock || A.gridLock) ? A.step : 0.01;
  ed.opt.offD = clean(Math.max(st, Math.round(d / st) * st)); return ed.opt.offD;
}
/** The exact lines/arcs the contour is taken from (for a traced area: the real shapes along its boundary). */
function sourcePrims(ed: Editor, o: OffState): Prim[] {
  if (o.srcPrims) return o.srcPrims;
  if (!o.region) return (o.srcPrims = o.shapes.flatMap(s => prims(s)));
  const b = bbox(o.region), pad = 1e-3, near: Prim[] = [];
  for (const e of ed.doc.ents) {
    if (!ed.store.visible(e) || e.type === 'dim') continue;
    const eb = bbox(e as Shape); if (eb.x1 < b.x0 - pad || eb.x0 > b.x1 + pad || eb.y1 < b.y0 - pad || eb.y0 > b.y1 + pad) continue;
    near.push(...prims(e as Shape));
  }
  return (o.srcPrims = near);
}
/** Shapes the tool would place for the cursor position (without ids). */
export function offsetResult(ed: Editor, cur: Point): Shape[] {
  const o: OffState = ed.state.off; if (!o) return [];
  const d = distance(ed, cur), n = Math.max(1, Math.round(+ed.opt.offCount) || 1), round = String(ed.opt.offRound) === '1', sd = side(ed, cur);
  if (o.edge) { const out: Shape[] = []; for (let k = 1; k <= n; k++) { const s = offsetPrim(o.edge, d * k, cur, sd); if (s) out.push(s); } return out; }
  const key = [d, n, round, sd].join('|'); if (o.cache?.key === key) return o.cache.res;
  const geos = offsetGeos(sourcePrims(ed, o), Array.from({ length: n }, (_, k) => d * (k + 1)));
  const res = contour(o.source!, d, sd === 'auto' ? 'out' : sd, round, n).map(pts => refit(pts, geos));
  o.cache = { key, res }; return res;
}
export function offsetCommit(ed: Editor, cur: Point): string[] {
  const res = offsetResult(ed, cur); if (!res.length) { ed.toast('Nothing to place at this distance'); return []; }
  const ids = ed.store.change(() => res.map(s => ed.store.add(structuredClone(s)).id));
  const spine = ed.state.off.spine; ed.state.off = null; ed.setSelection(ids);
  ed.toast(`Placed ${ids.length} contour${ids.length > 1 ? 's' : ''} at ${fmt(+ed.opt.offD, 3)} mm` + (spine ? ' · now delete the line through the text, or it will be cut too' : '')); ed.changed('prompt');
  return ids;
}
/** Pick a source at a click: an edge, a shape group, or an enclosed area. */
export function offsetPick(ed: Editor, raw: Point): boolean {
  const hit = ed.pick(raw, undefined, e => e.type !== 'dim');
  if (hit) {
    if (ed.opt.offMode === 'edge' && hit.e.type !== 'ellipse' && hit.e.type !== 'poly') { offsetBegin(ed, [hit.e as Shape], [hit.e.id], { edge: hit.pr }); return true; }
    if (ed.opt.offMode === 'edge' && hit.e.type === 'poly' && hit.pr.t === 'seg') { offsetBegin(ed, [{ type: 'line', a: hit.pr.a, b: hit.pr.b } as Shape], [hit.e.id], { edge: hit.pr }); return true; }
    const usable = ed.doc.ents.filter(ed.store.usable) as Entity[];
    const g0 = connectedGroup(hit.e, usable), group = withSpines(g0, usable);
    if (group.length > g0.length) ed.toast('The contour goes round the text and along the line through it');
    offsetBegin(ed, group as Shape[], group.map(g => g.id), { spine: group.length > g0.length }); return true;
  }
  const r = findRegion(raw, ed.doc.ents.filter(ed.store.visible) as Shape[]);
  if (!r.ok) { ed.toast(r.reason || 'No closed boundary here'); return false; }
  const region = { type: 'poly', closed: true, pts: r.pts } as Shape;
  offsetBegin(ed, [region], [], { region }); return true;
}

export const offsetTool: Tool = {
  id: 'offset', label: 'Contour / offset', key: 'O', icon: ICONS.offset, group: 3,
  options: [
    { key: 'offMode', label: 'Apply to', type: 'seg', choices: [['shape', 'Whole shape'], ['edge', 'One edge']] },
    { key: 'offSide', label: 'Side', type: 'seg', choices: [['auto', 'Cursor'], ['out', 'Outside'], ['in', 'Inside'], ['both', 'Both']] },
    { key: 'offD', label: 'Distance', type: 'number', min: 0.01, unit: 'mm' },
    { key: 'offRound', label: 'Corners', type: 'seg', choices: [['1', 'Round'], ['0', 'Sharp']] },
    { key: 'offCount', label: 'Contours', type: 'number', min: 1, max: 50, step: 1 },
    { key: 'offFollow', label: 'Follow cursor', type: 'check' },
    { key: 'offHint', label: 'Wheel ±1 · Shift+wheel ±0.1', type: 'hint' },
  ],
  prompt: ed => ed.state.off ? 'Move inside or outside to choose the side · mouse wheel changes the distance · click to place'
    : 'Click a shape, or click inside an enclosed area (or select shapes first)',
  activate(ed) {
    const s0 = ed.selected().filter(e => e.type !== 'dim'); if (!s0.length) return;
    // selected text also takes any line drawn through its letters (so a key ring can be one piece)
    const sel = s0.some(e => e.type === 'text') ? withSpines(s0, ed.doc.ents.filter(ed.store.usable) as Entity[]) : s0;
    if (sel.length > s0.length) ed.toast('The contour goes round the text and along the line through it');
    offsetBegin(ed, sel as Shape[], sel.map(e => e.id), { spine: sel.length > s0.length });
  },
  down(ed, raw) { if (ed.state.off) offsetCommit(ed, raw); else offsetPick(ed, raw); },
  wheel(ed, dir, info) {
    if (!ed.state.off) return false;
    const step = info.shift ? 0.1 : 1; ed.opt.offFollow = false;
    ed.opt.offD = clean(Math.max(0.1, Math.round((+ed.opt.offD + dir * step) * 1000) / 1000)); ed.changed('opts'); return true;
  },
  cancel(ed) { if (ed.state.off) { ed.state.off = null; ed.changed('prompt'); return true; } return false; },
  overlay(ed, o) {
    const st: OffState = ed.state.off; if (!st) return;
    o.highlight(st.ids, 'source'); if (st.region) o.ghost(st.region, 'source');
    if (!ed.hover) return;
    for (const s of offsetResult(ed, ed.cur)) o.ghost(s);
    const sd = st.edge ? '' : ({ in: ' · inside', out: ' · outside', both: ' · both sides' } as any)[side(ed, ed.cur)] || '';
    o.label(`offset ${fmt(+ed.opt.offD, 3)} mm${sd}${+ed.opt.offCount > 1 ? ' × ' + ed.opt.offCount : ''}`, ed.cur);
  },
};
export { dist };
