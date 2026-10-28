/**
 * Eraser brush: drag a circle over the drawing to delete what it touches —
 * ideal for clearing the "flakes" left by tracing. By default only small
 * pieces are erased, so the main outline is safe. Wheel = brush size.
 */
import { type Point, dist, fmt } from '../geometry/vec';
import type { Tool } from '../editor/tool';
import type { Editor } from '../editor/editor';

const ICON = '<path d="M7 20h11"/><path d="M4.5 14.5l8-8a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L13 18H8.5z"/><path d="M8.5 10.5l5 5"/>';
const radiusMm = (ed: Editor) => (+ed.opt.eraseR || 15) / ed.view.k;

/** Ids of objects under a brush of radius r at p (optionally only small ones). */
export function underBrush(ed: Editor, p: Point, r: number, maxSize?: number): string[] {
  const out: string[] = [];
  for (const e of ed.doc.ents) {
    if (!ed.store.usable(e)) continue;
    const b = ed.bbox(e);
    if (b.x1 < p.x - r || b.x0 > p.x + r || b.y1 < p.y - r || b.y0 > p.y + r) continue;
    if (maxSize != null && Math.max(b.x1 - b.x0, b.y1 - b.y0) > maxSize) continue;
    if (ed.geomPrims(e).some(pr => pr.t === 'seg' ? segDist(p, pr.a, pr.b) <= r : Math.abs(dist(p, pr.c) - pr.r) <= r)) out.push(e.id);
  }
  return out;
}
function segDist(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
const sweep = (ed: Editor, p: Point) => {
  const S = ed.state, ids = underBrush(ed, p, radiusMm(ed), ed.opt.eraseSmall ? +ed.opt.eraseMax : undefined);
  for (const id of ids) S.erased.add(id);
};

export const eraserTool: Tool = {
  id: 'eraser', label: 'Eraser brush', key: 'X', icon: ICON, group: 3,
  options: [
    { key: 'eraseR', label: 'Brush', type: 'number', min: 2, max: 300, unit: 'px' },
    { key: 'eraseSmall', label: 'Only small pieces', type: 'check' },
    { key: 'eraseMax', label: 'up to', type: 'number', min: 0.1, unit: 'mm', show: ed => !!ed.opt.eraseSmall },
    { key: 'eraseHint', label: 'Drag to erase · wheel = brush size', type: 'hint' },
  ],
  prompt: ed => ed.opt.eraseSmall ? `Drag over flakes to erase pieces up to ${fmt(+ed.opt.eraseMax, 1)} mm · untick "Only small pieces" to erase anything` : 'Drag to erase anything the brush touches',
  cursor: () => 'none',
  down(ed, raw) { ed.state.erased = new Set<string>(); ed.state.erasing = true; sweep(ed, raw); },
  move(ed, raw) { if (ed.state.erasing) sweep(ed, raw); },
  up(ed) {
    const S = ed.state; S.erasing = false; const ids = [...(S.erased || [])]; S.erased = null;
    if (!ids.length) return;
    ed.store.change(() => ed.store.remove(ids)); ed.sel.clear(); ed.changed('sel');
    ed.toast(`Erased ${ids.length} piece${ids.length > 1 ? 's' : ''} · Ctrl+Z brings them back`);
  },
  wheel(ed, dir) { ed.opt.eraseR = Math.max(2, Math.min(300, Math.round((+ed.opt.eraseR || 15) * (dir > 0 ? 1.15 : 1 / 1.15)))); ed.changed('opts'); return true; },
  cancel(ed) { if (ed.state.erasing) { ed.state.erasing = false; ed.state.erased = null; return true; } return false; },
  overlay(ed, o) {
    if (ed.state.erased?.size) o.hide(ed.state.erased);
    if (!ed.hover) return;
    if (!ed.state.erasing) { const ids = underBrush(ed, ed.cur, radiusMm(ed), ed.opt.eraseSmall ? +ed.opt.eraseMax : undefined); if (ids.length) o.highlight(ids, 'source'); }
    o.custom((ctx, ed2, C) => { const s = ed2.w2s(ed2.cur); ctx.strokeStyle = C['--bad']; ctx.lineWidth = 1.5; ctx.setLineDash([]); ctx.beginPath(); ctx.arc(s.x, s.y, +ed2.opt.eraseR || 15, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = .08; ctx.fillStyle = C['--bad']; ctx.fill(); ctx.globalAlpha = 1; });
  },
};
