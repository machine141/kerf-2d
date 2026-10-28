/**
 * Array (pattern) tool — like Fusion 360 / Tinkercad patterns, plus two extras:
 *  • Grid: columns × rows; spacing typed or set by moving the cursor (snaps to the grid).
 *  • Circular: copies round a centre (the cursor; it snaps to centres and points), full turn or a set angle.
 *  • Size change per copy (%): copies shrink (−) or grow (+) step by step, away from the original.
 *  • Symmetry: mirror the pattern to the other side (2-way) or into all four quarters (4-way),
 *    so patterns are symmetric left/right, top/bottom and diagonally.
 */
import { type Point, P, sub, fmt, DEG } from '../geometry/vec';
import { affEnt, affMove, affRot, affMir, affScale, apA, type Affine } from '../geometry/affine';
import { boxCentre } from '../geometry/entity';
import type { Tool } from '../editor/tool';
import type { Editor } from '../editor/editor';
import type { Shape } from '../model/types';

const ICON = '<rect x="3" y="3" width="6" height="6"/><rect x="15" y="3" width="6" height="6"/><rect x="3" y="15" width="6" height="6"/><rect x="15" y="15" width="6" height="6" stroke-dasharray="2 2"/>';
const MAX = 600;
/** A∘B: apply B first, then A. */
export const comp = (A: Affine, B: Affine): Affine => ({ a: A.a * B.a + A.b * B.c, b: A.a * B.b + A.b * B.d, c: A.c * B.a + A.d * B.c, d: A.c * B.b + A.d * B.d, e: A.a * B.e + A.b * B.f + A.e, f: A.c * B.e + A.d * B.f + A.f });

export interface ArrayOpts { type: 'grid' | 'circ'; cols: number; rows: number; dx: number; dy: number; count: number; angle: number; rotate: boolean; scalePct: number; sym: '1' | '2' | '4' }

/** Transforms for every copy (not the original) of a pattern around `base` (the selection centre); `c` = circular centre. */
export function arrayTransforms(o: ArrayOpts, base: Point, c: Point): Affine[] {
  const out: Affine[] = [], f = 1 + (o.scalePct || 0) / 100;
  const sized = (A: Affine, k: number) => { if (Math.abs(f - 1) < 1e-12 || k === 0) return A; const s = Math.pow(f, k), q = apA(A, base); return comp(affScale(q, s, s), A); };
  if (o.type === 'grid') {
    const nc = Math.max(1, Math.round(o.cols)), nr = Math.max(1, Math.round(o.rows));
    const iMin = o.sym !== '1' ? -(nc - 1) : 0, jMin = o.sym === '4' ? -(nr - 1) : 0;
    const mx = affMir(base, P(base.x, base.y + 1)), my = affMir(base, P(base.x + 1, base.y));
    for (let j = jMin; j < nr; j++) for (let i = iMin; i < nc; i++) {
      if (i === 0 && j === 0) continue;
      let A = sized(affMove(P(Math.abs(i) * o.dx, Math.abs(j) * o.dy)), Math.max(Math.abs(i), Math.abs(j)));
      if (i < 0) A = comp(mx, A);
      if (j < 0) A = comp(my, A);
      out.push(A);
      if (out.length >= MAX) return out;
    }
    return out;
  }
  const n = Math.max(2, Math.round(o.count)), full = Math.abs(Math.abs(o.angle) - 360) < 1e-9, step = (full ? o.angle / n : o.angle / (n - 1)) * DEG;
  const place = (k: number) => { const R = affRot(c, step * k); return o.rotate ? R : affMove(sub(apA(R, base), base)); };
  const axis = affMir(c, base);
  for (let k = 1; k < n; k++) {
    out.push(sized(place(k), k));
    if (o.sym !== '1') out.push(comp(axis, sized(place(k), k)));   // the other way round, mirrored
    if (out.length >= MAX) break;
  }
  return out;
}

const isGrid = (ed: Editor) => ed.opt.arrType !== 'circ';
/** Grid and circular keep their own settings for size change and symmetry. */
const opts = (ed: Editor): ArrayOpts => ({ type: isGrid(ed) ? 'grid' : 'circ', cols: +ed.opt.arrCols, rows: +ed.opt.arrRows, dx: +ed.opt.arrDx, dy: +ed.opt.arrDy, count: +ed.opt.arrCount, angle: +ed.opt.arrAngle, rotate: !!ed.opt.arrRotate,
  scalePct: +(isGrid(ed) ? ed.opt.gridScale : ed.opt.circScale) || 0, sym: isGrid(ed) ? ed.opt.gridSym : ed.opt.circSym });
const baseOf = (ed: Editor) => { const b = ed.selBox(); return b ? boxCentre(b) : P(0, 0); };
/** Circular centre for a cursor position: the centre of a circle / arc / rounded corner under it (not one being copied), else the snapped point. */
function centreAt(ed: Editor, raw: Point, snapped: Point): { c: Point; onCircle: boolean } {
  const hit = ed.pick(raw, undefined, e => !ed.sel.has(e.id) && (e.type === 'circle' || e.type === 'arc' || e.type === 'poly'));
  if (hit && hit.pr.t === 'arc' && !(ed.snapRes?.k && !['nearest', 'grid', 'step', 'track', null].includes(ed.snapRes.k as any))) return { c: hit.pr.c, onCircle: true };
  return { c: snapped, onCircle: false };
}
/** The point that drives the pattern: locked by the first click, else the cursor. */
function driver(ed: Editor): { p: Point; onCircle: boolean } | null {
  if (ed.state.lock && ed.state.lock.type === ed.opt.arrType) return ed.state.lock;
  if (ed.state.lock) { ed.state.lock = null; ed.state.locked = false; queueMicrotask(() => ed.changed('prompt')); }
  if (!ed.hover) return null;
  const p = ed.cursorPoint();
  return isGrid(ed) ? { p, onCircle: false } : (() => { const r = centreAt(ed, ed.cur, p); return { p: r.c, onCircle: r.onCircle }; })();
}
/** Live values: in grid mode with "set by cursor", spacing follows the driver point. */
function live(ed: Editor, at: Point): { o: ArrayOpts; c: Point } {
  const o = opts(ed), base = baseOf(ed);
  if (o.type === 'grid' && ed.opt.arrFollow && !ed.state.locked) {
    const d = sub(at, base), st = Math.max(0.01, +ed.doc.aids.step || 1), r = (v: number) => +(Math.round(v / st) * st).toFixed(4);
    const before = `${ed.opt.arrDx}|${ed.opt.arrDy}`;
    if (Math.abs(r(d.x)) > 0) { o.dx = r(d.x); ed.opt.arrDx = o.dx; }
    if (o.rows > 1 && Math.abs(r(d.y)) > 0) { o.dy = r(d.y); ed.opt.arrDy = o.dy; }
    if (before !== `${ed.opt.arrDx}|${ed.opt.arrDy}`) queueMicrotask(() => ed.changed('opts'));
  }
  return { o, c: at };
}
function place(ed: Editor) {
  const dv = driver(ed); if (!dv) { ed.toast('Move onto the sheet, or click to set the pattern first'); return; }
  const { o, c } = live(ed, dv.p), base = baseOf(ed), T = arrayTransforms(o, base, c);
  if (!T.length) { ed.toast('Nothing to repeat — raise the number of copies'); return; }
  const sel = ed.selected(), many = sel.length > 1;
  const ids = ed.store.change(() => {
    const made: string[] = [];
    for (const A of T) { const g = many ? 'g' + (ed.doc.seq++) : null; for (const e of sel) { const { id, ...rest } = affEnt(e as Shape, A) as any; const n = ed.store.add(rest as Shape, { layer: e.layer, color: e.color, w: e.w }); if (g) n.group = [g]; made.push(n.id); } }
    return made;
  });
  ed.toast(`Placed ${T.length} cop${T.length === 1 ? 'y' : 'ies'}${T.length >= MAX ? ' (limit reached)' : ''}`);
  ed.state.lock = null; ed.state.locked = false;
  ed.setSelection([...sel.map(e => e.id), ...ids]);
  ed.setTool('select');
}
function lock(ed: Editor, p: Point, raw: Point) {
  const r = isGrid(ed) ? { c: p, onCircle: false } : centreAt(ed, raw, p);
  if (isGrid(ed)) live(ed, p);
  ed.state.lock = { p: r.c, onCircle: r.onCircle, type: ed.opt.arrType }; ed.state.locked = true; ed.changed('prompt'); ed.changed('opts');
}
const placeBtn = { key: 'arrPlace', label: 'Place (Enter)', type: 'button' as const, run: (ed: Editor) => place(ed) };

export const arrayTool: Tool = {
  id: 'array', label: 'Array / pattern', key: 'P', icon: ICON, group: 4, draws: true, needsSelection: true,
  options: [
    { key: 'arrType', label: 'Pattern', type: 'seg', choices: [['grid', 'Grid'], ['circ', 'Circular']] },
    { key: 'arrCols', label: 'Columns', type: 'number', min: 1, max: 100, step: 1, show: isGrid },
    { key: 'arrRows', label: 'Rows', type: 'number', min: 1, max: 100, step: 1, show: isGrid },
    { key: 'arrDx', label: 'Spacing X', type: 'number', unit: 'mm', step: 1, show: isGrid },
    { key: 'arrDy', label: 'Y', type: 'number', unit: 'mm', step: 1, show: isGrid },
    { key: 'arrFollow', label: 'Set by cursor', type: 'check', show: isGrid },
    { key: 'gridScale', label: 'Size change', type: 'number', min: -50, max: 50, step: 1, unit: '% each', show: isGrid },
    { key: 'gridSym', label: 'Symmetry', type: 'seg', choices: [['1', 'Off'], ['2', '2-way'], ['4', '4-way']], show: isGrid },
    { key: 'arrCount', label: 'Copies', type: 'number', min: 2, max: 360, step: 1, show: ed => !isGrid(ed) },
    { key: 'arrAngle', label: 'Over °', type: 'number', step: 15, show: ed => !isGrid(ed) },
    { key: 'arrRotate', label: 'Turn copies', type: 'check', show: ed => !isGrid(ed) },
    { key: 'circScale', label: 'Size change', type: 'number', min: -50, max: 50, step: 1, unit: '% each', show: ed => !isGrid(ed) },
    { key: 'circSym', label: 'Both ways', type: 'seg', choices: [['1', 'Off'], ['2', 'On']], show: ed => !isGrid(ed) },
    placeBtn,
  ],
  prompt: ed => {
    if (ed.state.locked) return 'Pattern set — change the numbers above (the preview stays) · click or Enter to place · Esc to change the position';
    return isGrid(ed)
      ? (ed.opt.arrFollow ? 'Move to set the spacing, click to fix it — or press Enter to place now' : 'Type columns, rows and spacing · click or Enter to place')
      : 'Point at a circle to go round its centre, or at any point · click to fix the centre — or Enter to place now';
  },
  activate(ed) { ed.state.lock = null; ed.state.locked = false; },
  down(ed, raw) {
    if (ed.state.locked) { place(ed); return; }
    const s = ed.snapAt(raw); ed.snapRes = s; lock(ed, s.p, raw);
  },
  located(ed, p) { if (ed.state.locked) place(ed); else lock(ed, p, ed.cur); },
  finish(ed) { place(ed); },
  cancel(ed) { if (ed.state.locked) { ed.state.lock = null; ed.state.locked = false; ed.changed('prompt'); return true; } return false; },
  overlay(ed, o) {
    const dv = driver(ed); if (!dv) return;
    const { o: ao, c } = live(ed, dv.p), base = baseOf(ed), T = arrayTransforms(ao, base, c), sel = ed.selected(), at = ed.hover ? ed.cursorPoint() : c;
    if (sel.length * T.length > 4000) { o.label(`${T.length} copies — too many to preview`, at); return; }
    for (const A of T) for (const e of sel) o.ghost(affEnt(e as Shape, A));
    if (ao.type === 'circ') o.custom((ctx, ed2, C) => { const s = ed2.w2s(c), b = ed2.w2s(base); ctx.strokeStyle = C['--accent']; ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]); ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, Math.PI * 2); ctx.moveTo(s.x - 7, s.y); ctx.lineTo(s.x + 7, s.y); ctx.moveTo(s.x, s.y - 7); ctx.lineTo(s.x, s.y + 7); ctx.stroke(); });
    const total = T.length + 1, sc = ao.scalePct ? ` · size ${ao.scalePct > 0 ? '+' : ''}${fmt(ao.scalePct, 1)}% each` : '', lk = ed.state.locked ? ' · set' : '';
    o.label(ao.type === 'grid' ? `${total} in grid · spacing ${fmt(ao.dx, 2)} × ${fmt(ao.dy, 2)} mm${sc}${lk}` : `${total} round${dv.onCircle ? ' the circle centre' : ''} · ${fmt(Math.abs(ao.angle - 360) < 1e-9 ? 360 / Math.max(2, ao.count) : ao.angle / Math.max(1, ao.count - 1), 2)}° apart${sc}${lk}`, at);
  },
};
