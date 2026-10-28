/**
 * Fillet / chamfer tool.
 *  • Hover shows the nearest corner; click it (or click two lines).
 *  • Then set the size with the mouse wheel, by following the cursor, or by typing — live preview.
 *  • Click (or Enter) to apply. "All corners" rounds every corner of the selected shape.
 */
import { type Point, P, dist, fmt, clean } from '../geometry/vec';
import { cornerPath, cornerAll, cornerLines, pathCorner, linesCorner, sizeFromSetback, maxSize, type CornerMode } from '../geometry/corner';
import { pieceToShape } from '../geometry/trim';
import type { Tool, Overlay } from '../editor/tool';
import type { Editor } from '../editor/editor';
import type { Entity, Shape } from '../model/types';

type Target =
  | { kind: 'vertex'; id: string; i: number; V: Point; theta: number }
  | { kind: 'lines'; idA: string; clickA: Point; idB: string; clickB: Point; V: Point; theta: number };

const ICON = '<path d="M4 20V12a8 8 0 0 1 8-8h8"/><path d="M4 8V4h4" stroke-dasharray="2 2"/>';
const mode = (ed: Editor) => ed.opt.filletMode as CornerMode;

/** Nearest path corner to the cursor (within px), or a shared end of two lines. */
function hoverCorner(ed: Editor, raw: Point, px = 12): Target | null {
  const tol = px / ed.view.k; let best: { t: Target; d: number } | null = null;
  const lines = ed.doc.ents.filter(e => e.type === 'line' && ed.store.usable(e)) as Extract<Entity, { type: 'line' }>[];
  for (const e of ed.doc.ents) {
    if (!ed.store.usable(e) || e.type !== 'poly' || e.pts.length > 400) continue;
    e.pts.forEach((v, i) => { const d = dist(v, raw); if (d <= tol && (!best || d < best.d)) { const c = pathCorner(e, i); if (c) best = { t: { kind: 'vertex', id: e.id, i, V: v, theta: c.theta }, d }; } });
  }
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    const A = lines[i], B = lines[j];
    for (const pa of [A.a, A.b]) for (const pb of [B.a, B.b]) {
      if (dist(pa, pb) > 1e-6) continue; const d = dist(pa, raw); if (d > tol || (best && d >= best.d)) continue;
      const oa = pa === A.a ? A.b : A.a, ob = pb === B.a ? B.b : B.a, g = linesCorner(A, oa, B, ob);
      if (!('error' in g)) best = { t: { kind: 'lines', idA: A.id, clickA: oa, idB: B.id, clickB: ob, V: pa, theta: g.theta }, d };
    }
  }
  return best ? (best as { t: Target }).t : null;
}

function size(ed: Editor, t: Target) {
  if (!ed.opt.filletFollow) return Math.max(0.001, +ed.opt.filletR || 0);
  const s = sizeFromSetback(t.theta, dist(ed.cur, t.V), mode(ed)), A = ed.doc.aids, st = (A.gridLock || A.stepLock) ? A.step : 0.01;
  ed.opt.filletR = clean(Math.max(st, Math.round(s / st) * st)); return ed.opt.filletR;
}

/** Shapes produced for a target: { replace: [id, shape][], add: shape[] } or an error. */
export function cornerResult(ed: Editor, t: Target, sz: number): { replace: [string, Shape][]; add: Shape[] } | { error: string } {
  const m = mode(ed);
  if (t.kind === 'vertex') {
    const e = ed.store.byId(t.id) as any; if (!e) return { error: 'Shape not found' };
    const r = cornerPath(e, t.i, sz, m); if ('error' in r) return r;
    return { replace: [[t.id, pieceToShape(r.pts, r.bulge, r.closed)]], add: [] };
  }
  const A = ed.store.byId(t.idA) as any, B = ed.store.byId(t.idB) as any;
  const r = cornerLines(A, t.clickA, B, t.clickB, sz, m); if ('error' in r) return r;
  return { replace: [[t.idA, r.lineA], [t.idB, r.lineB]], add: [r.join] };
}
export function applyCorner(ed: Editor, t: Target, sz: number): boolean {
  const r = cornerResult(ed, t, sz); if ('error' in r) { ed.toast(r.error); return false; }
  const first = ed.store.byId(t.kind === 'vertex' ? t.id : t.idA)!;
  ed.store.change(() => { for (const [id, s] of r.replace) ed.store.replace(id, s); for (const s of r.add) ed.store.add(s, { layer: first.layer, color: first.color, w: first.w }); });
  return true;
}
/** Round/cut every corner of the selected paths. */
export function applyAllCorners(ed: Editor) {
  const paths = ed.selected().filter(e => e.type === 'poly') as any[];
  if (!paths.length) { ed.toast('Select a rectangle or path first, then press All corners'); return; }
  let done = 0, skipped = 0;
  ed.store.change(() => { for (const e of paths) { const r = cornerAll(e, +ed.opt.filletR, mode(ed)); done += r.done; skipped += r.skipped; ed.store.replace(e.id, pieceToShape(r.path.pts, r.path.bulge, r.path.closed)); } });
  ed.toast(`${mode(ed) === 'fillet' ? 'Rounded' : 'Chamfered'} ${done} corner${done === 1 ? '' : 's'}${skipped ? ` · ${skipped} too small for ${fmt(+ed.opt.filletR, 3)} mm` : ''}`);
}

export const filletTool: Tool = {
  id: 'fillet', label: 'Fillet / chamfer', key: 'E', icon: ICON, group: 3,
  options: [
    { key: 'filletMode', label: 'Corner', type: 'seg', choices: [['fillet', 'Fillet (round)'], ['chamfer', 'Chamfer (cut)']] },
    { key: 'filletR', label: 'Size', type: 'number', min: 0.01, unit: 'mm' },
    { key: 'filletFollow', label: 'Follow cursor', type: 'check' },
    { key: 'filletAll', label: 'All corners of selection', type: 'button', run: ed => applyAllCorners(ed) },
    { key: 'filletHint', label: 'Wheel ±0.5 · Shift+wheel ±0.1', type: 'hint' },
  ],
  prompt: ed => ed.state.target ? 'Wheel, cursor or typed size · click (or Enter) to apply · Esc to cancel'
    : ed.state.firstLine ? 'Click the second line' : 'Click a corner, or click two lines · "All corners" rounds the selected shape',
  down(ed, raw) {
    const S = ed.state;
    if (S.target) { if (applyCorner(ed, S.target, size(ed, S.target))) S.target = null; ed.changed('prompt'); return; }
    const c = hoverCorner(ed, raw); if (c) { S.target = c; S.firstLine = null; ed.changed('prompt'); return; }
    const hit = ed.pick(raw, 7, e => e.type === 'line');
    if (!hit) { ed.toast('Click a corner or a line'); return; }
    if (!S.firstLine) { S.firstLine = { id: hit.e.id, click: raw }; ed.changed('prompt'); return; }
    if (hit.e.id === S.firstLine.id) return;
    const A = ed.store.byId(S.firstLine.id) as any, g = linesCorner(A, S.firstLine.click, hit.e as any, raw);
    if ('error' in g) { ed.toast(g.error!); S.firstLine = null; ed.changed('prompt'); return; }
    S.target = { kind: 'lines', idA: A.id, clickA: S.firstLine.click, idB: hit.e.id, clickB: raw, V: g.X, theta: g.theta }; S.firstLine = null; ed.changed('prompt');
  },
  wheel(ed, dir, info) {
    if (!ed.state.target) return false;
    const st = info.shift ? 0.1 : 0.5; ed.opt.filletFollow = false;
    ed.opt.filletR = clean(Math.max(0.1, Math.round((+ed.opt.filletR + dir * st) * 1000) / 1000)); ed.changed('opts'); return true;
  },
  finish(ed) { const S = ed.state; if (S.target && applyCorner(ed, S.target, size(ed, S.target))) { S.target = null; ed.changed('prompt'); } },
  cancel(ed) { const S = ed.state; if (S.target || S.firstLine) { S.target = null; S.firstLine = null; ed.changed('prompt'); return true; } return false; },
  overlay(ed, o: Overlay) {
    const S = ed.state;
    if (S.firstLine) o.highlight([S.firstLine.id], 'source');
    const t: Target | null = S.target || (ed.hover ? hoverCorner(ed, ed.cur) : null);
    if (!t) return;
    if (!S.target) { o.custom((ctx, ed2, C) => { const s = ed2.w2s(t.V); ctx.strokeStyle = C['--snap']; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(s.x, s.y, 7, 0, Math.PI * 2); ctx.stroke(); }); o.label('Corner — click to select', t.V); return; }
    const sz = size(ed, t), r = cornerResult(ed, t, sz);
    if ('error' in r) { o.label(r.error, t.V); return; }
    o.hide(r.replace.map(x => x[0]));
    for (const [, s] of r.replace) o.ghost(s, 'selected');
    for (const s of r.add) o.ghost(s, 'selected');
    o.label(`${mode(ed) === 'fillet' ? 'R' : 'C'} ${fmt(sz, 3)} mm`, t.V);
  },
};
export { maxSize, P };
