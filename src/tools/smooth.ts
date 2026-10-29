/**
 * Smooth brush. "Soften whole shape": point at a shape (or the selection) and
 * click to round all its corners. Brush: drag over curves and paths to iron out bumps and kinks (for
 * example after tracing a picture). "Sharpen" does the opposite on curves:
 * points under the brush become crisp corners. Each drag is one undo step.
 */
import { type Point, P, add, sub, mul, dist, TAU } from '../geometry/vec';
import { autoHandles } from '../geometry/spline';
import type { Tool } from '../editor/tool';
import type { Editor } from '../editor/editor';
import type { Shape } from '../model/types';
import { softenShape, softenable, type SoftenMode } from '../geometry/soften';

export const SMOOTH_ICON = '<path d="M3 17c3-6 5 2 8-3s4-6 7-2"/><circle cx="18" cy="7" r="3"/>';
const STRENGTH: Record<string, number> = { gentle: 0.2, medium: 0.45, strong: 0.75 };
const radius = (ed: Editor) => (+ed.opt.smR || 30) / ed.view.k;

/** One dab of the brush at p: changes the points of every path / curve within the brush. Returns true if anything moved. */
export function smoothDab(ed: Editor, p: Point, mode: 'smooth' | 'sharpen', strength: number, R: number): boolean {
  let changed = false;
  for (const e of ed.doc.ents) {
    if (!ed.store.usable(e) || (e.type !== 'poly' && e.type !== 'spline')) continue;
    const b = ed.bbox(e); if (p.x < b.x0 - R || p.x > b.x1 + R || p.y < b.y0 - R || p.y > b.y1 + R) continue;
    const n = e.pts.length, closed = e.closed, w = e.pts.map(q => { const d = dist(q, p); return d < R ? (1 - d / R) ** 1.5 : 0; });
    if (!w.some(x => x > 0)) continue;
    const nb = (i: number): [Point, Point] | null => { const a = closed ? e.pts[(i - 1 + n) % n] : e.pts[i - 1], c = closed ? e.pts[(i + 1) % n] : e.pts[i + 1]; return a && c ? [a, c] : null; };
    if (mode === 'smooth') {
      // move each point part of the way to the middle of its neighbours (ends of open paths stay put)
      const np = e.pts.map((q, i) => { const k = w[i] * strength, ab = nb(i); if (!k || !ab) return q; const m = mul(add(ab[0], ab[1]), 0.5); return add(q, mul(sub(m, q), k)); });
      if (e.type === 'spline') {
        const auto = autoHandles(np, closed, 1);
        e.h = e.h.map((h, i) => { const k = Math.min(1, w[i] * strength * 1.5), d = sub(np[i], e.pts[i]); if (!k) return [add(h[0], d), add(h[1], d)] as [Point, Point]; return [add(add(h[0], d), mul(sub(auto[i][0], add(h[0], d)), k)), add(add(h[1], d), mul(sub(auto[i][1], add(h[1], d)), k))] as [Point, Point]; });
      } else if (e.bulge) e.bulge = e.bulge.map((bg, i) => w[i] > 0 || w[(i + 1) % n] > 0 ? 0 : bg);
      e.pts = np; changed = true;
    } else if (e.type === 'spline') {
      // sharpen: pull the handles in to their point → a crisp corner
      e.h = e.h.map((h, i) => { const k = Math.min(1, w[i] * strength * 2); if (!k) return h; const q = e.pts[i]; return [add(h[0], mul(sub(q, h[0]), k)), add(h[1], mul(sub(q, h[1]), k))] as [Point, Point]; });
      changed = true;
    }
  }
  return changed;
}

/** Soften whole shapes: each one's corners rounded to `r` (thin parts that would be lost are left as they were). */
export function softenPreview(ed: Editor, ids: string[], r: number, mode: SoftenMode): { ids: string[]; shapes: Shape[]; kept: string[] } {
  const out = { ids: [] as string[], shapes: [] as Shape[], kept: [] as string[] };
  for (const id of ids) {
    const e = ed.store.byId(id); if (!e || !softenable(e as any)) continue;
    const res = softenShape(e as Shape, r, mode);
    if (!res.shape || res.note === 'split' || res.note === 'lost') { if (res.note) out.kept.push(id); continue; }
    out.ids.push(id); out.shapes.push(res.shape);
  }
  return out;
}
export function applySoften(ed: Editor, pv: { ids: string[]; shapes: Shape[]; kept: string[] }) {
  if (!pv.ids.length) { ed.toast(pv.kept.length ? 'A thin part would be lost — try a smaller roundness' : 'Nothing here can be softened (paths and curves only — circles are already round)'); return; }
  ed.store.change(() => pv.ids.forEach((id, k) => ed.store.replace(id, pv.shapes[k])));
  ed.toast(`Softened ${pv.ids.length} shape${pv.ids.length > 1 ? 's' : ''}` + (pv.kept.length ? ` · ${pv.kept.length} left as ${pv.kept.length > 1 ? 'they were' : 'it was'} (a thin part would be lost — try a smaller roundness)` : '') + ' · one Undo puts them back');
}
const softR = (ed: Editor) => Math.max(0.1, +ed.opt.smRound || 2);
/** The shapes a click on `e` softens: the whole selection if it is selected, else it (and its group). */
const targets = (ed: Editor, id: string) => ed.sel.has(id) ? [...ed.sel] : [...ed.withGroups([id])];

export const smoothTool: Tool = {
  id: 'smooth', label: 'Smooth / soften', key: 'U', icon: SMOOTH_ICON, group: 3,
  options: [
    { key: 'smMode', label: 'Brush', type: 'seg', choices: [['shape', 'Soften whole shape'], ['smooth', 'Smooth'], ['sharpen', 'Sharpen corners']] },
    { key: 'smRound', label: 'Roundness', type: 'number', min: 0.2, step: 0.5, unit: 'mm', show: ed => ed.opt.smMode === 'shape' },
    { key: 'smCorners', label: 'Corners', type: 'seg', choices: [['both', 'All'], ['outer', 'Outside'], ['inner', 'Inside']], show: ed => ed.opt.smMode === 'shape' },
    { key: 'smStrength', label: 'Strength', type: 'seg', choices: [['gentle', 'Gentle'], ['medium', 'Medium'], ['strong', 'Strong']], show: ed => ed.opt.smMode !== 'shape' },
    { key: 'smR', label: 'Brush size', type: 'number', min: 4, max: 300, step: 2, unit: 'px', show: ed => ed.opt.smMode !== 'shape' },
    { key: 'smHint', label: 'Point at a shape to see it softened, click to do it (a selected shape: all the selection) · wheel = roundness', type: 'hint', show: ed => ed.opt.smMode === 'shape' },
    { key: 'smHint2', label: 'Drag over bumpy curves or paths · wheel = brush size · each drag is one Undo', type: 'hint', show: ed => ed.opt.smMode !== 'shape' },
  ],
  prompt: ed => ed.opt.smMode === 'shape' ? 'Point at a shape: see its corners rounded · click to soften it (or the whole selection) · wheel changes the roundness'
    : ed.opt.smMode === 'sharpen' ? 'Drag over points of a curve to make them crisp corners' : 'Drag over bumps and kinks to smooth them out (traced outlines, wobbly curves)',
  down(ed, raw) {
    if (ed.opt.smMode === 'shape') {
      const hit = ed.pick(raw, undefined, e => softenable(e as any))?.e; if (!hit) { ed.toast('Click a path or curve to soften it'); return; }
      applySoften(ed, softenPreview(ed, targets(ed, hit.id), softR(ed), ed.opt.smCorners || 'both')); ed.state.smPrev = null; return;
    }
    ed.state.sm = { last: raw, pushed: false }; dab(ed, raw);
  },
  move(ed, raw) {
    if (ed.opt.smMode === 'shape') {
      const hit = ed.pick(raw, undefined, e => softenable(e as any))?.e, key = hit ? hit.id + '|' + softR(ed) + '|' + ed.opt.smCorners + '|' + ed.ver : '';
      if (key !== ed.state.smPrevKey) { ed.state.smPrevKey = key; ed.state.smPrev = hit ? softenPreview(ed, targets(ed, hit.id), softR(ed), ed.opt.smCorners || 'both') : null; }
      return;
    }
    const s = ed.state.sm; if (!s) return; if (dist(s.last, raw) < radius(ed) / 4) return; s.last = raw; dab(ed, raw);
  },
  up(ed) { const s = ed.state.sm; ed.state.sm = null; if (!s?.pushed) return; if (!s.any) { ed.store.discardCheckpoint(); return; } ed.store.emit(); },
  cancel(ed) { if (ed.state.sm) { ed.state.sm = null; return true; } return false; },
  deactivate(ed) { ed.state.smPrev = null; ed.state.smPrevKey = ''; },
  wheel(ed, dir) {
    if (ed.opt.smMode === 'shape') { const v = softR(ed); ed.opt.smRound = +Math.max(0.2, Math.min(50, v * (dir > 0 ? 1.15 : 1 / 1.15))).toFixed(1); ed.changed('opts'); ed.state.smPrevKey = ''; ed.tool.move?.(ed, ed.cur, { sp: ed.w2s(ed.cur), shift: false, alt: false, ctrl: false }); return true; }
    ed.opt.smR = Math.max(4, Math.min(300, Math.round((+ed.opt.smR || 30) * (dir > 0 ? 1.15 : 1 / 1.15)))); ed.changed('opts'); return true;
  },
  overlay(ed, o) {
    if (ed.opt.smMode === 'shape') {
      const pv = ed.state.smPrev as ReturnType<typeof softenPreview> | null; if (!pv || !ed.hover) return;
      o.hide(pv.ids); for (const s of pv.shapes) o.ghost(s, 'selected'); o.highlight(pv.kept, 'source');
      o.label(pv.ids.length ? `Roundness ${softR(ed)} mm · click to soften${pv.kept.length ? ` · ${pv.kept.length} would lose a thin part (left as it is)` : ''}` : 'A thin part would be lost — roll the wheel for less roundness', ed.cur);
      return;
    }
    if (!ed.hover) return;
    o.custom((ctx, ed2, C) => { const s = ed2.w2s(ed2.cur), r = +ed2.opt.smR || 30; ctx.strokeStyle = C['--accent']; ctx.lineWidth = 1.5; ctx.setLineDash(ed2.opt.smMode === 'sharpen' ? [3, 3] : []); ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = .08; ctx.fillStyle = C['--accent']; ctx.fill(); ctx.globalAlpha = 1; });
    // show the points that the brush can reach
    o.custom((ctx, ed2, C) => {
      const R = radius(ed2); ctx.fillStyle = C['--accent'];
      for (const e of ed2.doc.ents) { if ((e.type !== 'poly' && e.type !== 'spline') || !ed2.store.usable(e)) continue; for (const q of e.pts) if (dist(q, ed2.cur) < R * 1.6) { const s = ed2.w2s(q); ctx.fillRect(s.x - 2, s.y - 2, 4, 4); } }
    });
  },
};
function dab(ed: Editor, p: Point) {
  const s = ed.state.sm, mode = ed.opt.smMode === 'sharpen' ? 'sharpen' : 'smooth', k = STRENGTH[ed.opt.smStrength] ?? 0.45;
  if (!s.pushed) { ed.store.checkpoint(); s.pushed = true; }
  if (smoothDab(ed, p, mode, k, radius(ed))) s.any = true;
  ed.changed('view');
}
export { P };
