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

const opts = (ed: Editor): ArrayOpts => ({ type: ed.opt.arrType, cols: +ed.opt.arrCols, rows: +ed.opt.arrRows, dx: +ed.opt.arrDx, dy: +ed.opt.arrDy, count: +ed.opt.arrCount, angle: +ed.opt.arrAngle, rotate: !!ed.opt.arrRotate, scalePct: +ed.opt.arrScale || 0, sym: ed.opt.arrSym });
const baseOf = (ed: Editor) => { const b = ed.selBox(); return b ? boxCentre(b) : P(0, 0); };
/** Live values: in grid mode with "set by cursor", spacing follows the cursor. */
function live(ed: Editor, cur: Point): { o: ArrayOpts; c: Point } {
  const o = opts(ed), base = baseOf(ed);
  if (o.type === 'grid' && ed.opt.arrFollow && ed.hover) {
    const d = sub(cur, base), st = Math.max(0.01, +ed.doc.aids.step || 1), r = (v: number) => +(Math.round(v / st) * st).toFixed(4);
    const before = `${ed.opt.arrDx}|${ed.opt.arrDy}`;
    if (Math.abs(r(d.x)) > 0) { o.dx = r(d.x); ed.opt.arrDx = o.dx; }
    if (o.rows > 1 && Math.abs(r(d.y)) > 0) { o.dy = r(d.y); ed.opt.arrDy = o.dy; }
    if (before !== `${ed.opt.arrDx}|${ed.opt.arrDy}`) queueMicrotask(() => ed.changed('opts'));
  }
  return { o, c: cur };
}
function place(ed: Editor, cur: Point) {
  const { o, c } = live(ed, cur), base = baseOf(ed), T = arrayTransforms(o, base, c);
  if (!T.length) { ed.toast('Nothing to repeat — raise the number of copies'); return; }
  const sel = ed.selected(), many = sel.length > 1;
  const ids = ed.store.change(() => {
    const made: string[] = [];
    for (const A of T) { const g = many ? 'g' + (ed.doc.seq++) : null; for (const e of sel) { const { id, ...rest } = affEnt(e as Shape, A) as any; const n = ed.store.add(rest as Shape, { layer: e.layer, color: e.color, w: e.w }); if (g) n.group = [g]; made.push(n.id); } }
    return made;
  });
  ed.toast(`Placed ${T.length} cop${T.length === 1 ? 'y' : 'ies'}${T.length >= MAX ? ' (limit reached)' : ''}`);
  ed.setSelection([...sel.map(e => e.id), ...ids]);
  ed.setTool('select');
}

export const arrayTool: Tool = {
  id: 'array', label: 'Array / pattern', key: 'P', icon: ICON, group: 4, draws: true, needsSelection: true,
  options: [
    { key: 'arrType', label: 'Pattern', type: 'seg', choices: [['grid', 'Grid'], ['circ', 'Circular']] },
    { key: 'arrCols', label: 'Columns', type: 'number', min: 1, max: 100, step: 1, show: ed => ed.opt.arrType === 'grid' },
    { key: 'arrRows', label: 'Rows', type: 'number', min: 1, max: 100, step: 1, show: ed => ed.opt.arrType === 'grid' },
    { key: 'arrDx', label: 'Spacing X', type: 'number', unit: 'mm', step: 1, show: ed => ed.opt.arrType === 'grid' },
    { key: 'arrDy', label: 'Y', type: 'number', unit: 'mm', step: 1, show: ed => ed.opt.arrType === 'grid' },
    { key: 'arrFollow', label: 'Set by cursor', type: 'check', show: ed => ed.opt.arrType === 'grid' },
    { key: 'arrCount', label: 'Copies', type: 'number', min: 2, max: 360, step: 1, show: ed => ed.opt.arrType === 'circ' },
    { key: 'arrAngle', label: 'Over °', type: 'number', step: 15, show: ed => ed.opt.arrType === 'circ' },
    { key: 'arrRotate', label: 'Turn copies', type: 'check', show: ed => ed.opt.arrType === 'circ' },
    { key: 'arrScale', label: 'Size change', type: 'number', min: -50, max: 50, step: 1, unit: '% each' },
    { key: 'arrSym', label: 'Symmetry', type: 'seg', choices: [['1', 'Off'], ['2', '2-way'], ['4', '4-way']] },
  ],
  prompt: ed => ed.opt.arrType === 'grid'
    ? (ed.opt.arrFollow ? 'Move to set the spacing (snaps to grid) · click or Enter to place · Esc to cancel' : 'Type columns, rows and spacing · click or Enter to place')
    : 'Move to the centre of the circle (snaps to centres) · click or Enter to place',
  down(ed, raw) { const s = ed.snapAt(raw); ed.snapRes = s; place(ed, s.p); },
  located(ed, p) { place(ed, p); },
  finish(ed) { place(ed, ed.cursorPoint()); },
  overlay(ed, o) {
    if (!ed.hover) return;
    const cur = ed.cursorPoint(), { o: ao, c } = live(ed, cur), base = baseOf(ed), T = arrayTransforms(ao, base, c), sel = ed.selected();
    if (sel.length * T.length > 4000) { o.label(`${T.length} copies — too many to preview`, cur); return; }
    for (const A of T) for (const e of sel) o.ghost(affEnt(e as Shape, A));
    if (ao.type === 'circ') o.custom((ctx, ed2, C) => { const s = ed2.w2s(c), b = ed2.w2s(base); ctx.strokeStyle = C['--accent']; ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]); ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, Math.PI * 2); ctx.stroke(); });
    const total = T.length + 1, sc = ao.scalePct ? ` · size ${ao.scalePct > 0 ? '+' : ''}${fmt(ao.scalePct, 1)}% each` : '';
    o.label(ao.type === 'grid' ? `${total} in grid · spacing ${fmt(ao.dx, 2)} × ${fmt(ao.dy, 2)} mm${sc}` : `${total} round · ${fmt(Math.abs(ao.angle - 360) < 1e-9 ? 360 / Math.max(2, ao.count) : ao.angle / Math.max(1, ao.count - 1), 2)}° apart${sc}`, cur);
  },
};
