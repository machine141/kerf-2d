/**
 * Smooth brush: drag over curves and paths to iron out bumps and kinks (for
 * example after tracing a picture). "Sharpen" does the opposite on curves:
 * points under the brush become crisp corners. Each drag is one undo step.
 */
import { type Point, P, add, sub, mul, dist, TAU } from '../geometry/vec';
import { autoHandles } from '../geometry/spline';
import type { Tool } from '../editor/tool';
import type { Editor } from '../editor/editor';

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

export const smoothTool: Tool = {
  id: 'smooth', label: 'Smooth brush', key: 'U', icon: SMOOTH_ICON, group: 3,
  options: [
    { key: 'smMode', label: 'Brush', type: 'seg', choices: [['smooth', 'Smooth'], ['sharpen', 'Sharpen corners']] },
    { key: 'smStrength', label: 'Strength', type: 'seg', choices: [['gentle', 'Gentle'], ['medium', 'Medium'], ['strong', 'Strong']] },
    { key: 'smR', label: 'Brush size', type: 'number', min: 4, max: 300, step: 2, unit: 'px' },
    { key: 'smHint', label: 'Drag over bumpy curves or paths · wheel = brush size · each drag is one Undo', type: 'hint' },
  ],
  prompt: ed => ed.opt.smMode === 'sharpen' ? 'Drag over points of a curve to make them crisp corners' : 'Drag over bumps and kinks to smooth them out (traced outlines, wobbly curves)',
  down(ed, raw) { ed.state.sm = { last: raw, pushed: false }; dab(ed, raw); },
  move(ed, raw) { const s = ed.state.sm; if (!s) return; if (dist(s.last, raw) < radius(ed) / 4) return; s.last = raw; dab(ed, raw); },
  up(ed) { const s = ed.state.sm; ed.state.sm = null; if (!s?.pushed) return; if (!s.any) { ed.store.discardCheckpoint(); return; } ed.store.emit(); },
  cancel(ed) { if (ed.state.sm) { ed.state.sm = null; return true; } return false; },
  wheel(ed, dir) { ed.opt.smR = Math.max(4, Math.min(300, Math.round((+ed.opt.smR || 30) * (dir > 0 ? 1.15 : 1 / 1.15)))); ed.changed('opts'); return true; },
  overlay(ed, o) {
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
