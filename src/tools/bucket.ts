/**
 * Fill (paint bucket, Y): click inside any enclosed area to fill it with a soft colour.
 * The area is found from the lines around the click (they may cross or overlap);
 * outlines lying wholly inside it (a key ring's hole) are left clear.
 * On screen fills are see-through (Opacity, remembered); exports are solid colours.
 */
import type { Tool } from '../editor/tool';
import type { Editor } from '../editor/editor';
import { inRings } from '../editor/editor';
import { findRegion } from '../geometry/region';
import { flatten } from '../geometry/entity';
import { ext } from '../geometry/entity';
import { type Point } from '../geometry/vec';
import { PAINTS, type PaintKey, type Shape, type FillEnt, type Entity } from '../model/types';
import { ICONS } from './icons';

const area = (q: Point[]) => { let a = 0; for (let i = 0, j = q.length - 1; i < q.length; j = i++) a += (q[j].x + q[i].x) * (q[j].y - q[i].y); return Math.abs(a) / 2; };
const inPoly = (p: Point, r: Point[]) => inRings(p, [r]);

/** The lines a fill is bounded by: everything visible except fills, dimensions and hinge slits (text as its letters). */
function boundaryShapes(ed: Editor): Shape[] { return boundary(ed).shapes; }
/** The boundary shapes, and which drawing object each came from. */
function boundary(ed: Editor): { shapes: Shape[]; src: Entity[] } {
  const shapes: Shape[] = [], src: Entity[] = [];
  for (const e of ed.doc.ents) {
    if (!ed.store.visible(e) || e.type === 'dim' || e.type === 'fill' || e.gen === 'hinge') continue;
    for (const s of e.type === 'text' ? ext.textShapes(e) : [e as Shape]) { shapes.push(s); src.push(e); }
  }
  return { shapes, src };
}
/** The area to fill at a point: its outside edge, plus the closed outlines wholly inside it as holes. */
export function areaAt(shapes: Shape[], p: Point): { rings: Point[][]; reason?: string; outer?: number; holes?: number[] } | null {
  const r = findRegion(p, shapes);
  if (!r.ok || r.pts.length < 3) return { rings: [], reason: r.reason || 'Not inside a closed area' };
  const outer = r.pts, A = area(outer);
  const all = shapes.map((s, i) => ({ i, f: flatten(s, 0.05) })).filter(x => x.f.closed && x.f.pts.length > 2).map(x => ({ i: x.i, q: x.f.pts, a: area(x.f.pts) }));
  // the shape whose outline is this area's edge (if one is)
  const own = all.find(x => Math.abs(x.a - A) < Math.max(0.05, A * 0.005) && inPoly(p, x.q));
  const loops = all
    .filter(x => { if (x.a >= A * 0.999) return false; const step = Math.max(1, Math.floor(x.q.length / 24)); for (let i = 0; i < x.q.length; i += step) if (!inPoly(x.q[i], outer)) return false; return true; })
    // only the outermost of loops nested inside each other (an island inside a hole fills by its own click)
    .sort((a, b) => b.a - a.a);
  const holes: typeof loops = [];
  for (const x of loops) { if (holes.some(h => inPoly(x.q[0], h.q))) continue; if (inPoly(p, x.q)) continue; holes.push(x); }
  return { rings: [outer, ...holes.map(h => h.q)], outer: own?.i, holes: holes.map(h => h.i) };
}

function fillsAt(ed: Editor, p: Point): FillEnt[] { return ed.doc.ents.filter(e => e.type === 'fill' && ed.store.visible(e) && inRings(p, e.rings)) as FillEnt[]; }

export const bucketTool: Tool = {
  id: 'bucket', label: 'Fill (paint bucket)', key: 'Y', icon: ICONS.bucket, group: 3,
  options: [
    { key: 'paint', label: 'Colour', type: 'swatch', choices: (Object.keys(PAINTS) as PaintKey[]).map(k => [k, PAINTS[k].label, PAINTS[k].hex, PAINTS[k].hex] as [string, string, string, string]) },
    { key: 'fillOpacity', label: 'See-through on screen', type: 'number', min: 5, max: 100, step: 5, unit: '%' },
    { key: 'bucketHint', label: 'Click inside an area · click a filled area to change its colour · Alt+click removes a fill · exports as solid colour (SVG)', type: 'hint' },
  ],
  prompt: () => 'Click inside an enclosed area to fill it · Alt+click removes a fill',
  cursor: () => 'cell',
  onOpt(ed, key) { if (key === 'fillOpacity') { try { localStorage.setItem('kerf.fillOpacity', String(ed.opt.fillOpacity)); } catch { /* private window */ } } },
  move(ed, raw) {
    // what a click would fill, re-traced only when the pointer leaves the last area
    const pv = ed.state.bkPrev as { rings: Point[][]; ver: number } | null;
    if (pv && pv.ver === ed.ver && pv.rings.length && inRings(raw, pv.rings)) return;
    const a = areaAt(boundaryShapes(ed), raw);
    ed.state.bkPrev = a && a.rings.length ? { rings: a.rings, ver: ed.ver } : null;
  },
  down(ed, raw, info) {
    const here = fillsAt(ed, raw);
    if (info.alt) {
      const top = here[here.length - 1]; if (!top) { ed.toast('No fill here to remove'); return; }
      ed.store.change(() => ed.store.remove([top.id])); ed.toast('Fill removed'); return;
    }
    const bd = boundary(ed), a = areaAt(bd.shapes, raw), paint = (ed.opt.paint || 'pink') as PaintKey;
    if (!a || !a.rings.length) { ed.toast((a?.reason || 'Not inside a closed area') + ' — close any gaps in the outline first'); return; }
    // the same area already filled: change its colour instead of stacking another fill
    const A0 = area(a.rings[0]), same = here.find(f => Math.abs(area(f.rings[0]) - A0) < Math.max(0.5, A0 * 0.01) && f.rings.length === a.rings.length);
    if (same) { if (same.paint === paint) { ed.toast('Already filled with ' + PAINTS[paint].label); return; } ed.store.change(() => { same.paint = paint; }); ed.toast('Fill changed to ' + PAINTS[paint].label); return; }
    // keep the fill with the shape it fills (and that shape's holes), so they move together
    const owner = a.outer !== undefined ? bd.src[a.outer] : undefined, holeEnts = (a.holes || []).map(i => bd.src[i]).filter(e => e.type !== 'text');
    let joined = false;
    ed.store.change(() => {
      const f = ed.store.add({ type: 'fill', rings: a.rings.map(r => r.map(p => ({ x: +p.x.toFixed(5), y: +p.y.toFixed(5) }))), paint } as Shape, { color: 'ink', w: 0.1, layer: owner?.layer });
      if (owner?.group?.length) { f.group = owner.group.slice(); joined = true; }
      else if (owner) { const g = 'g' + (ed.doc.seq++); f.group = [g]; owner.group = [g]; for (const h of holeEnts) if (!h.group?.length) h.group = [g]; joined = true; }
    });
    ed.toast(`Filled with ${PAINTS[paint].label}${a.rings.length > 1 ? ` (${a.rings.length - 1} hole${a.rings.length > 2 ? 's' : ''} left clear)` : ''}${joined ? ' · grouped with its shape so they move together' : ''}`);
    ed.state.bkPrev = null;
  },
  overlay(ed, o) {
    const pv = ed.state.bkPrev as { rings: Point[][] } | null; if (!pv || !ed.hover) return;
    const hex = PAINTS[(ed.opt.paint || 'pink') as PaintKey]?.hex || '#ddd';
    o.custom((ctx, e, C) => {
      ctx.beginPath(); for (const r of pv.rings) r.forEach((p, i) => { const s = e.w2s(p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }), ctx.closePath();
      ctx.globalAlpha = 0.3; ctx.fillStyle = hex; ctx.fill('evenodd'); ctx.globalAlpha = 1; ctx.setLineDash([5, 4]); ctx.strokeStyle = C['--accent']; ctx.lineWidth = 1.3; ctx.stroke();
    });
  },
  cancel(ed) { if (ed.state.bkPrev) { ed.state.bkPrev = null; return true; } return false; },
};
