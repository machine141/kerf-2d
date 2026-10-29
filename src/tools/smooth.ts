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
import { softenShape, softenable, planSoften, applyPlan, type SoftenMode, type SoftPlan } from '../geometry/soften';

export const SMOOTH_ICON = '<path d="M2 19.5h3.5c5.5 0 7.5-15 13-15H22" stroke-width="3.2" stroke="currentColor"/>';
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

// ---------- pick shapes, choose corners, then soften ----------
interface Picks { ids: string[]; over: Record<string, { tip: Point; on: boolean }[]> }
const picks = (ed: Editor): Picks => (ed.state.sp ??= { ids: [], over: {} });
const planCache = new Map<string, SoftPlan | null>();
/** What softening would change on a shape, corner by corner (cached for this drawing version and roundness). */
function planOf(ed: Editor, id: string): SoftPlan | null {
  const key = [id, softR(ed), ed.opt.smCorners, ed.ver].join('|'); if (planCache.has(key)) return planCache.get(key)!;
  if (planCache.size > 200) planCache.clear();
  const e = ed.store.byId(id), p = e && softenable(e as any) ? planSoften(e as Shape, softR(ed), ed.opt.smCorners || 'both') : null;
  planCache.set(key, p); return p;
}
/** Which corners are on: every corner, except big changes (a thin part going) which start off; clicks override. */
function cornersOn(ed: Editor, id: string, plan: SoftPlan): boolean[] {
  const ov = picks(ed).over[id] || [], near = Math.max(1, softR(ed));
  return plan.corners.map(c => { const o = ov.find(x => dist(x.tip, c.tip) < near); return o ? o.on : !c.big; });
}
function previewOf(ed: Editor, id: string): Shape | null { const p = planOf(ed, id); if (!p) return null; const on = cornersOn(ed, id, p); return on.some(Boolean) || !p.closed ? applyPlan(p, on) : null; }
/** Soften the picked shapes (only the corners left on). One Undo. */
export function softenPicked(ed: Editor) {
  const pk = picks(ed); if (!pk.ids.length) { ed.toast('Click shapes to pick them first (Shift+click for more)'); return; }
  const done: [string, Shape][] = [];
  for (const id of pk.ids) { const sh = previewOf(ed, id); if (sh) done.push([id, sh]); }
  if (!done.length) { ed.toast('No corners are switched on'); return; }
  ed.store.change(() => done.forEach(([id, sh]) => ed.store.replace(id, sh)));
  ed.state.sp = { ids: [], over: {} }; ed.changed('prompt');
  ed.toast(`Softened ${done.length} shape${done.length > 1 ? 's' : ''} · one Undo puts ${done.length > 1 ? 'them' : 'it'} back`);
}
function setAllCorners(ed: Editor, on: boolean) {
  const pk = picks(ed);
  for (const id of pk.ids) { const p = planOf(ed, id); if (p) pk.over[id] = p.corners.map(c => ({ tip: c.tip, on })); }
  ed.changed('view');
}
/** The corner marker under a screen point. */
function markerAt(ed: Editor, sp: Point): { id: string; tip: Point } | null {
  for (const id of picks(ed).ids) { const p = planOf(ed, id); if (!p) continue; for (const c of p.corners) { const s = ed.w2s(c.tip); if (Math.hypot(s.x - sp.x, s.y - sp.y) <= 9) return { id, tip: c.tip }; } }
  return null;
}
/** Pick (or with Shift, add / remove) a shape and the rest of its group. */
function pickShape(ed: Editor, id: string, add: boolean) {
  const pk = picks(ed), members = [...ed.withGroups([id])].filter(x => { const e = ed.store.byId(x); return e && softenable(e as any); });
  if (!add) pk.ids = members;
  else if (pk.ids.includes(id)) pk.ids = pk.ids.filter(x => !members.includes(x));
  else pk.ids = [...new Set([...pk.ids, ...members])];
  ed.changed('prompt');
}
export function pickForSoften(ed: Editor, ids: string[]) { ed.state.sp = { ids: ids.filter(x => { const e = ed.store.byId(x); return e && softenable(e as any); }), over: {} }; }

export const smoothTool: Tool = {
  id: 'smooth', label: 'Smooth / soften', key: 'U', icon: SMOOTH_ICON, group: 3,
  options: [
    { key: 'smMode', label: 'Brush', type: 'seg', choices: [['shape', 'Soften shapes'], ['smooth', 'Smooth'], ['sharpen', 'Sharpen corners']] },
    { key: 'smRound', label: 'Roundness', type: 'number', min: 0.2, step: 0.5, unit: 'mm', show: ed => ed.opt.smMode === 'shape' },
    { key: 'smCorners', label: 'Corners', type: 'seg', choices: [['both', 'All'], ['outer', 'Outside'], ['inner', 'Inside']], show: ed => ed.opt.smMode === 'shape' },
    { key: 'smAll', label: 'All corners on', type: 'button', run: ed => setAllCorners(ed, true), show: ed => ed.opt.smMode === 'shape' && !!ed.state.sp?.ids?.length },
    { key: 'smNone', label: 'All corners off', type: 'button', run: ed => setAllCorners(ed, false), show: ed => ed.opt.smMode === 'shape' && !!ed.state.sp?.ids?.length },
    { key: 'smGo', label: 'Soften (Enter)', type: 'button', run: softenPicked, show: ed => ed.opt.smMode === 'shape' && !!ed.state.sp?.ids?.length },
    { key: 'smStrength', label: 'Strength', type: 'seg', choices: [['gentle', 'Gentle'], ['medium', 'Medium'], ['strong', 'Strong']], show: ed => ed.opt.smMode !== 'shape' },
    { key: 'smR', label: 'Brush size', type: 'number', min: 4, max: 300, step: 2, unit: 'px', show: ed => ed.opt.smMode !== 'shape' },
    { key: 'smHint', label: 'Click a shape to pick it · Shift+click to add more · click a dot to switch that corner on/off · wheel = roundness', type: 'hint', show: ed => ed.opt.smMode === 'shape' },
    { key: 'smHint2', label: 'Drag over bumpy curves or paths · wheel = brush size · each drag is one Undo', type: 'hint', show: ed => ed.opt.smMode !== 'shape' },
  ],
  prompt: ed => ed.opt.smMode === 'shape'
    ? (ed.state.sp?.ids?.length ? `${ed.state.sp.ids.length} picked · orange dots are rounded, grey stay sharp — click a dot to switch it · Shift+click shapes to add or remove · Enter to soften · Esc to clear` : 'Click a shape to pick it (Shift+click or drag a box for more) — you choose its corners before anything changes')
    : ed.opt.smMode === 'sharpen' ? 'Drag over points of a curve to make them crisp corners' : 'Drag over bumps and kinks to smooth them out (traced outlines, wobbly curves)',
  down(ed, raw, info) {
    if (ed.opt.smMode === 'shape') {
      const m = markerAt(ed, info.sp);
      if (m) {   // switch one corner on / off
        const pk = picks(ed), p = planOf(ed, m.id)!, on = cornersOn(ed, m.id, p), i = p.corners.findIndex(c => c.tip === m.tip);
        const list = (pk.over[m.id] ??= []), ex = list.find(x => dist(x.tip, m.tip) < 1e-6);
        if (ex) ex.on = !on[i]; else list.push({ tip: m.tip, on: !on[i] });
        ed.changed('view'); return;
      }
      const hit = ed.pick(raw, undefined, e => softenable(e as any))?.e;
      if (hit) { pickShape(ed, hit.id, info.shift); ed.changed('tool'); return; }
      if (!info.shift) { ed.state.sp = { ids: [], over: {} }; ed.changed('tool'); }
      ed.state.smBox = { a: raw, b: raw }; return;
    }
    ed.state.sm = { last: raw, pushed: false }; dab(ed, raw);
  },
  move(ed, raw) {
    if (ed.opt.smMode === 'shape') { if (ed.state.smBox) ed.state.smBox.b = raw; else ed.state.smHover = ed.pick(raw, undefined, e => softenable(e as any))?.e.id ?? null; return; }
    const s = ed.state.sm; if (!s) return; if (dist(s.last, raw) < radius(ed) / 4) return; s.last = raw; dab(ed, raw);
  },
  up(ed) {
    if (ed.state.smBox) {   // a box picks every shape wholly inside it
      const { a, b } = ed.state.smBox; ed.state.smBox = null;
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      if (x1 - x0 < 1e-6 && y1 - y0 < 1e-6) return;
      const pk = picks(ed);
      for (const e of ed.doc.ents) { if (!ed.store.usable(e) || !softenable(e as any)) continue; const q = ed.bbox(e); if (q.x0 >= x0 && q.x1 <= x1 && q.y0 >= y0 && q.y1 <= y1 && !pk.ids.includes(e.id)) pk.ids.push(e.id); }
      ed.changed('tool'); return;
    }
    const s = ed.state.sm; ed.state.sm = null; if (!s?.pushed) return; if (!s.any) { ed.store.discardCheckpoint(); return; } ed.store.emit();
  },
  onKey(ed, key) { if (key === 'Enter' && ed.opt.smMode === 'shape' && ed.state.sp?.ids?.length) { softenPicked(ed); ed.changed('tool'); return true; } return false; },
  cancel(ed) {
    if (ed.state.sm) { ed.state.sm = null; return true; }
    if (ed.state.sp?.ids?.length) { ed.state.sp = { ids: [], over: {} }; ed.changed('tool'); return true; }
    return false;
  },
  activate(ed) { if (ed.opt.smMode === 'shape' && !ed.state.sp?.ids?.length && ed.sel.size) pickForSoften(ed, [...ed.sel]); },
  deactivate(ed) { ed.state.sp = null; ed.state.smHover = null; },
  wheel(ed, dir) {
    if (ed.opt.smMode === 'shape') { const v = softR(ed); ed.opt.smRound = +Math.max(0.2, Math.min(50, v * (dir > 0 ? 1.15 : 1 / 1.15))).toFixed(1); ed.changed('opts'); ed.state.smMsg = { t: `Roundness ${ed.opt.smRound} mm`, until: Date.now() + 1200 }; return true; }
    ed.opt.smR = Math.max(4, Math.min(300, Math.round((+ed.opt.smR || 30) * (dir > 0 ? 1.15 : 1 / 1.15)))); ed.changed('opts'); return true;
  },
  overlay(ed, o) {
    if (ed.opt.smMode === 'shape') {
      const pk = picks(ed);
      // picked shapes: the softened outline (red), and a dot on every corner
      o.hide(pk.ids);
      for (const id of pk.ids) { const sh = previewOf(ed, id); const e = ed.store.byId(id); if (sh) o.ghost(sh, 'selected'); else if (e) o.ghost(e as Shape, 'selected'); }
      o.custom((ctx, ed2, C) => {
        for (const id of pk.ids) {
          const p = planOf(ed2, id); if (!p) continue; const on = cornersOn(ed2, id, p);
          p.corners.forEach((c, i) => {
            const s = ed2.w2s(c.tip); ctx.beginPath(); ctx.arc(s.x, s.y, on[i] ? 5.5 : 5, 0, TAU); ctx.lineWidth = 2;
            if (on[i]) { ctx.fillStyle = c.big ? '#e03131' : '#f08c00'; ctx.strokeStyle = '#fff'; ctx.fill(); ctx.stroke(); }
            else { ctx.fillStyle = C['--sheet']; ctx.strokeStyle = c.big ? '#e03131' : '#868e96'; ctx.fill(); ctx.stroke(); if (c.big) { ctx.fillStyle = '#e03131'; ctx.font = 'bold 9px system-ui'; ctx.fillText('!', s.x - 1.5, s.y + 3.5); } }
          });
        }
        const bx = ed2.state.smBox; if (bx) { const a = ed2.w2s(bx.a), b = ed2.w2s(bx.b); ctx.setLineDash([5, 4]); ctx.strokeStyle = C['--accent']; ctx.lineWidth = 1; ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.setLineDash([]); }
      });
      // hovering a shape that isn't picked: show what softening would look like
      const hv = ed.state.smHover; if (hv && !pk.ids.includes(hv) && ed.hover) { const sh = previewOf(ed, hv); o.highlight([hv], 'source'); if (sh) o.ghost(sh, 'preview'); o.label(pk.ids.length ? 'Shift+click to add it' : 'Click to pick it', ed.cur); }
      const msg = ed.state.smMsg; if (msg && Date.now() < msg.until) o.label(msg.t, ed.cur);
      return;
    }
    if (!ed.hover) return;
    o.custom((ctx, ed2, C) => { const s = ed2.w2s(ed2.cur), r = +ed2.opt.smR || 30; ctx.strokeStyle = C['--accent']; ctx.lineWidth = 1.5; ctx.setLineDash(ed2.opt.smMode === 'sharpen' ? [3, 3] : []); ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = .08; ctx.fillStyle = C['--accent']; ctx.fill(); ctx.globalAlpha = 1; });
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
