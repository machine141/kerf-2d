/**
 * Hinge brush: paint where a part should bend (the way it should bend), draw a
 * fold line across a corner, or click inside an area. Each pastel colour is a
 * slit pattern. "Make cuts" turns all the painted areas into slits at once.
 */
import { type Point, P, dist, fmt, TAU } from '../geometry/vec';
import { flatten } from '../geometry/entity';
import { findRegion } from '../geometry/region';
import type { Tool, OptionSpec } from '../editor/tool';
import type { Editor } from '../editor/editor';
import type { HingeMark, HingePattern, Shape } from '../model/types';
import { computeHinge, HINGE_PATTERNS, patternInfo, type HingeArea, type BrushSettings } from '../hinge/brush';

export const HB_ICON = '<path d="M4 20c3 0 5-2 5-5l9-9a2 2 0 0 0-3-3l-9 9c-3 0-5 2-5 5"/><path d="M12 15h2M10 18h2M15 12h2" />';

const settings = (ed: Editor): BrushSettings => ({ pitch: Math.max(0.5, +ed.opt.hbPitch || 2.5), slit: Math.max(1, +ed.opt.hbSlit || 15), bridge: Math.max(0.5, +ed.opt.hbBridge || 3), edge: Math.max(0, +ed.opt.hbEdge || 0) });
/** The drawing the paint is checked against (not the hinge slits themselves, not dimensions). */
function envOf(ed: Editor) {
  const lines: { pts: Point[]; closed: boolean }[] = [];
  for (const e of ed.doc.ents) {
    if (!ed.store.visible(e) || e.type === 'dim' || e.gen === 'hinge') continue;
    const parts = e.type === 'text' ? (flattenText(e)) : [flatten(e as Shape)];
    for (const f of parts) if (f.pts.length > 1) lines.push({ pts: f.pts, closed: f.closed });
  }
  return { lines };
}
import { ext } from '../geometry/entity';
const flattenText = (e: any) => ext.textShapes(e).map(s => flatten(s));
/**
 * Centre for circles / spokes: the one picked, or else the middle of the
 * biggest closed outline round `at` (the whole flower, the whole donut), or of the drawing.
 */
function defaultCentre(ed: Editor, at?: Point): Point {
  if (ed.opt.hbCentre && typeof ed.opt.hbCentre === 'object') return ed.opt.hbCentre;
  const lines = envOf(ed).lines.filter(l => l.closed && l.pts.length > 2);
  const box = (p: Point[]) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of p) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); } return { x0, y0, x1, y1 }; };
  const inPoly = (p: Point, poly: Point[]) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c; } return c; };
  let best: { x0: number; y0: number; x1: number; y1: number } | null = null, ba = -1;
  if (at) for (const l of lines) if (inPoly(at, l.pts)) { const b = box(l.pts), a = (b.x1 - b.x0) * (b.y1 - b.y0); if (a > ba) { ba = a; best = b; } }
  if (!best) { const all = lines.flatMap(l => l.pts); if (all.length) best = box(all); }
  return best ? P((best.x0 + best.x1) / 2, (best.y0 + best.y1) / 2) : P(ed.doc.page.w / 2, ed.doc.page.h / 2);
}
let cache: { key: string; res: HingeArea[] } | null = null;
/** The painted areas and their slits (cached until the drawing or the settings change). */
export function hingeAreas(ed: Editor): HingeArea[] {
  const marks = ed.doc.hinge || []; if (!marks.length) return [];
  const set = settings(ed), key = [ed.ver, JSON.stringify(set), JSON.stringify(marks).length, ed.doc.ents.length].join('|');
  if (cache?.key === key) return cache.res;
  const res = computeHinge(marks, envOf(ed), set, defaultCentre(ed, marks[0].kind === 'erase' ? undefined : (marks[0] as any).pts?.[0]));
  cache = { key, res }; return res;
}
const centred = (p: HingePattern) => p === 'rings' || p === 'spokes';

function addMark(ed: Editor, m: HingeMark) { ed.store.change(() => { (ed.doc.hinge ??= []).push(m); }); }

/** Turn every painted area into slits (replacing slits made before). One undo step. */
export function makeCuts(ed: Editor) {
  const areas = hingeAreas(ed), slits = areas.flatMap(a => a.slits);
  if (!areas.length) { ed.toast('Paint an area first (or click inside one) — then Make cuts'); return; }
  let total = 0; for (const s of slits) for (let i = 1; i < s.length; i++) total += dist(s[i - 1], s[i]);
  const g = 'g' + ed.doc.seq++;
  ed.store.change(() => {
    ed.store.remove(ed.doc.ents.filter(e => e.gen === 'hinge').map(e => e.id));
    for (const s of slits) { const e = ed.store.add(s.length === 2 ? { type: 'line', a: s[0], b: s[1] } as Shape : { type: 'poly', closed: false, pts: s } as Shape); e.gen = 'hinge'; e.group = [g]; }
  });
  ed.toast(`Made ${slits.length} slits in ${areas.length} area${areas.length > 1 ? 's' : ''} · ${fmt(total / 1000, 2)} m of cutting · paint more and Make cuts again to redo them`);
}

const OPTIONS: OptionSpec[] = [
  { key: 'hbMode', label: 'Mark by', type: 'seg', choices: [['paint', 'Painting'], ['fold', 'Fold line'], ['area', 'Clicking an area'], ['erase', 'Eraser']] },
  { key: 'hbPattern', label: 'Pattern', type: 'swatch', choices: HINGE_PATTERNS.map(p => [p.id, p.label, p.fill, p.edge] as [string, string, string, string]) },
  { key: 'hbR', label: 'Brush', type: 'number', min: 1, step: 1, unit: 'mm', show: ed => ed.opt.hbMode !== 'area' },
  { key: 'hbOver', label: 'Paint over', type: 'check' },
  { key: 'hbPick', label: 'Pick centre', type: 'button', run: ed => { ed.state.pickCentre = true; ed.toast('Click where the centre should be'); ed.changed('prompt'); }, show: ed => centred(ed.opt.hbPattern) },
  { key: 'hbPitch', label: 'Spacing', type: 'number', min: 0.5, step: 0.5, unit: 'mm' },
  { key: 'hbSlit', label: 'Slit', type: 'number', min: 1, step: 1, unit: 'mm' },
  { key: 'hbBridge', label: 'Bridge', type: 'number', min: 0.5, step: 0.5, unit: 'mm' },
  { key: 'hbEdge', label: 'Edge gap', type: 'number', min: 0, step: 0.5, unit: 'mm' },
  { key: 'hbPreview', label: 'Show slits', type: 'check' },
  { key: 'hbMake', label: 'Make cuts', type: 'button', run: makeCuts },
  { key: 'hbClear', label: 'Clear paint', type: 'button', run: ed => { if (!(ed.doc.hinge || []).length) return; ed.store.change(() => { ed.doc.hinge = []; }); ed.toast('Paint cleared (the slits already made stay — undo to bring the paint back)'); } },
];

const brushPx = (ed: Editor) => Math.max(1, +ed.opt.hbR || 12) * ed.view.k;

export const hingeBrushTool: Tool = {
  id: 'hbrush', label: 'Hinge brush', key: 'H', icon: HB_ICON, group: 3,
  options: OPTIONS,
  prompt: ed => ed.state.pickCentre ? 'Click where the centre of the circles / spokes should be'
    : ed.opt.hbMode === 'fold' ? (ed.state.foldA ? 'Click the other end of the fold line' : 'Click one end of the fold line (across a corner or flap)')
    : ed.opt.hbMode === 'area' ? 'Click inside an area to fill it with the pattern'
    : ed.opt.hbMode === 'erase' ? 'Drag over paint to rub it out · wheel changes the size'
    : 'Paint the way you want it to bend · wheel changes the brush size · then Make cuts',
  down(ed, raw) {
    if (ed.state.pickCentre) { ed.opt.hbCentre = ed.snapAt(raw).p; ed.state.pickCentre = false; ed.toast('Centre set'); ed.changed('prompt'); return; }
    const pattern = ed.opt.hbPattern as HingePattern, over = !!ed.opt.hbOver, c = centred(pattern) ? defaultCentre(ed, raw) : undefined, mode = ed.opt.hbMode;
    if (mode === 'fold') {
      const p = ed.snapAt(raw).p;
      if (!ed.state.foldA) { ed.state.foldA = p; ed.changed('prompt'); return; }
      const a = ed.state.foldA; ed.state.foldA = null; ed.changed('prompt');
      if (dist(a, p) < 1) return;
      addMark(ed, { kind: 'fold', pattern, a, b: p, w: Math.max(2, 2 * (+ed.opt.hbR || 12)), over, c }); return;
    }
    if (mode === 'area') {
      const shapes = ed.doc.ents.filter(e => ed.store.visible(e) && e.type !== 'dim' && e.gen !== 'hinge').flatMap(e => e.type === 'text' ? ext.textShapes(e) : [e as Shape]);
      const r = findRegion(raw, shapes);
      if (!r.ok) { ed.toast(r.reason || 'Click inside a closed area'); return; }
      addMark(ed, { kind: 'area', pattern, pts: r.pts, at: raw, over, c }); return;
    }
    ed.state.stroke = [raw];
  },
  move(ed, raw) {
    const st: Point[] | undefined = ed.state.stroke; if (!st) return;
    if (dist(st[st.length - 1], raw) > Math.max(0.3, (+ed.opt.hbR || 12) / 8)) st.push(raw);
  },
  up(ed, raw) {
    const st: Point[] | undefined = ed.state.stroke; if (!st) return; ed.state.stroke = null;
    if (dist(st[st.length - 1], raw) > 1e-6) st.push(raw);
    const r = Math.max(1, +ed.opt.hbR || 12), pattern = ed.opt.hbPattern as HingePattern;
    if (ed.opt.hbMode === 'erase') addMark(ed, { kind: 'erase', pts: st, r });
    else addMark(ed, { kind: 'brush', pattern, pts: st, r, over: !!ed.opt.hbOver, c: centred(pattern) ? defaultCentre(ed, st[0]) : undefined });
  },
  wheel(ed, dir) { ed.opt.hbR = Math.max(1, Math.min(200, +((+ed.opt.hbR || 12) * (dir > 0 ? 1.15 : 1 / 1.15)).toFixed(1))); ed.changed('opts'); return true; },
  cancel(ed) { if (ed.state.stroke || ed.state.foldA || ed.state.pickCentre) { ed.state.stroke = null; ed.state.foldA = null; ed.state.pickCentre = false; ed.changed('prompt'); return true; } return false; },
  /** the painted areas, light and see-through, always visible */
  underlay(ctx, ed) {
    const areas = hingeAreas(ed); if (!areas.length) return;
    const active = ed.tool.id === 'hbrush';
    ctx.save(); ctx.globalAlpha = active ? 0.42 : 0.25;
    for (const a of areas) {
      ctx.beginPath(); for (const poly of a.mask) poly.forEach((p, i) => { const s = ed.w2s(p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
      ctx.fillStyle = patternInfo(a.pattern).fill; ctx.fill('evenodd');
    }
    ctx.restore();
  },
  overlay(ed, o) {
    const pat = patternInfo(ed.opt.hbPattern);
    o.custom((ctx, ed2) => {
      const areas = hingeAreas(ed2);
      // faint preview of the slits
      if (ed2.opt.hbPreview) {
        ctx.save(); ctx.lineWidth = 1; ctx.globalAlpha = 0.8;
        for (const a of areas) { ctx.strokeStyle = patternInfo(a.pattern).edge; ctx.beginPath(); for (const s of a.slits) s.forEach((p, i) => { const q = ed2.w2s(p); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.stroke(); }
        ctx.restore();
      }
      // bend-direction arrows and centres
      for (const a of areas) {
        if (a.arrow) arrow2(ctx, ed2.w2s(a.arrow.p), P(a.arrow.d.x, -a.arrow.d.y), patternInfo(a.pattern).edge);
        if (a.centre) target(ctx, ed2.w2s(a.centre), patternInfo(a.pattern).edge);
      }
      if (centred(ed2.opt.hbPattern) && ed2.hover) target(ctx, ed2.w2s(defaultCentre(ed2, ed2.cur)), pat.edge);
      // the stroke being painted, the fold line being drawn, the brush
      const st: Point[] | undefined = ed2.state.stroke, erase = ed2.opt.hbMode === 'erase', R = brushPx(ed2);
      if (st && st.length) {
        ctx.save(); ctx.globalAlpha = erase ? 0.25 : 0.45; ctx.strokeStyle = erase ? '#999' : pat.fill; ctx.lineWidth = 2 * R; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); [...st, ed2.cur].forEach((p, i) => { const q = ed2.w2s(p); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.stroke(); ctx.restore();
      }
      if (ed2.opt.hbMode === 'fold' && ed2.state.foldA) {
        const a = ed2.w2s(ed2.state.foldA), b = ed2.w2s(ed2.snapRes?.p ?? ed2.cur);
        ctx.save(); ctx.globalAlpha = 0.45; ctx.strokeStyle = pat.fill; ctx.lineWidth = 2 * R; ctx.lineCap = 'butt'; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.globalAlpha = 1; ctx.strokeStyle = pat.edge; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore();
      }
      if (ed2.hover && (ed2.opt.hbMode === 'paint' || erase)) {
        const c = ed2.w2s(ed2.cur); ctx.save(); ctx.strokeStyle = erase ? '#888' : pat.edge; ctx.lineWidth = 1.5; ctx.setLineDash(erase ? [4, 3] : []); ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, TAU); ctx.stroke(); ctx.restore();
      }
    });
    if (ed.opt.hbMode === 'area' && ed.hover) o.label('Click inside an area', ed.cur);
  },
};
function arrow2(ctx: CanvasRenderingContext2D, p: Point, d: Point, col: string) {
  const L = 16, h = 6, a = P(p.x - d.x * L, p.y - d.y * L), b = P(p.x + d.x * L, p.y + d.y * L), n = P(-d.y, d.x);
  ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  for (const [t, s] of [[b, 1], [a, -1]] as [Point, number][]) { ctx.moveTo(t.x - d.x * h * s + n.x * h * 0.6, t.y - d.y * h * s + n.y * h * 0.6); ctx.lineTo(t.x, t.y); ctx.lineTo(t.x - d.x * h * s - n.x * h * 0.6, t.y - d.y * h * s - n.y * h * 0.6); }
  ctx.stroke(); ctx.restore();
}
function target(ctx: CanvasRenderingContext2D, p: Point, col: string) {
  ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.setLineDash([]); ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, TAU); ctx.moveTo(p.x - 11, p.y); ctx.lineTo(p.x + 11, p.y); ctx.moveTo(p.x, p.y - 11); ctx.lineTo(p.x, p.y + 11); ctx.stroke(); ctx.restore();
}
