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

/** Distance from p to a polyline (closed or open). */
function distTo(p: Point, q: Point[], closed: boolean): number {
  let m = Infinity; const n = q.length;
  for (let i = 0; i + 1 < n + (closed ? 1 : 0); i++) {
    const a = q[i], b = q[(i + 1) % n], dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0, d = Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
    if (d < m) m = d;
  }
  return m;
}
/** Which boundary shapes make up an area's outside edge: those that the edge runs along (for an outline made of several pieces). */
export function edgeShapes(shapes: Shape[], outer: Point[], tol = 0.05): number[] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of outer) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const out: number[] = [];
  shapes.forEach((s, i) => {
    const f = flatten(s, 0.02); if (f.pts.length < 2) return;
    if (f.pts.every(p => p.x < x0 - tol) || f.pts.every(p => p.x > x1 + tol) || f.pts.every(p => p.y < y0 - tol) || f.pts.every(p => p.y > y1 + tol)) return;
    // the edge runs along this shape if several of the edge's points lie on it
    let hits = 0; for (const p of outer) if (distTo(p, f.pts, f.closed) <= tol && ++hits >= 2) { out.push(i); return; }
  });
  return out;
}

function fillsAt(ed: Editor, p: Point): FillEnt[] { return ed.doc.ents.filter(e => e.type === 'fill' && ed.store.visible(e) && inRings(p, e.rings)) as FillEnt[]; }

/** The objects a fill belongs to: what its outside edge is made of, plus its holes and anything lying wholly inside those pieces (a ring's hole, an engraved name). */
function fillMembers(bd: { shapes: Shape[]; src: Entity[] }, rings: Point[][], owner: Entity | undefined, holes: Entity[]) {
  const edge = [...new Set([...(owner ? [owner] : []), ...edgeShapes(bd.shapes, rings[0]).map(i => bd.src[i])])];
  const outlines = edge.map(e => flatten(e as Shape, 0.05)).filter(f => f.closed && f.pts.length > 2).map(f => f.pts);
  const inside = bd.shapes.map((sh, i) => ({ sh, e: bd.src[i] })).filter(({ sh, e }) => {
    if (edge.includes(e)) return false; const f = flatten(sh, 0.05); if (f.pts.length < 2) return false;
    const step = Math.max(1, Math.floor(f.pts.length / 24)); for (let k = 0; k < f.pts.length; k += step) if (!outlines.some(o => inPoly(f.pts[k], o))) return false; return true;
  }).map(x => x.e);
  return { edge, extra: [...new Set([...holes, ...inside])].filter(e => !edge.includes(e)) };
}
/** Drawings saved before fills were grouped with their shapes: group each loose fill now. Returns how many. */
export function regroupFills(ed: Editor): number {
  const loose = ed.doc.ents.filter(e => e.type === 'fill' && !e.group?.length) as FillEnt[]; if (!loose.length) return 0;
  const bd = boundary(ed); let n = 0;
  for (const f of loose) { const { edge, extra } = fillMembers(bd, f.rings, undefined, []); if (joinFill(ed, f, edge, extra)) n++; }
  return n;
}

/**
 * Group a new fill with the objects it fills, so they move, turn and copy together.
 * If they already share one outer group, the fill joins it; otherwise one new group wraps
 * them (whole existing groups stay whole inside it). Holes that are loose join too.
 */
export function joinFill(ed: Editor, f: Entity, edge: Entity[], holes: Entity[]): boolean {
  if (!edge.length) return false;
  const roots = new Set(edge.map(e => ed.groupRoot(e) || '#' + e.id));
  if (roots.size === 1 && edge[0].group?.length) {
    f.group = edge[0].group.slice();
    const r = ed.groupRoot(edge[0])!; for (const h of holes) if (!h.group?.length) h.group = [r];
    return true;
  }
  const g = 'g' + (ed.doc.seq++), members = new Set<Entity>();
  for (const e of ed.doc.ents) { const r = ed.groupRoot(e); if (e !== f && ((r && roots.has(r)) || roots.has('#' + e.id))) members.add(e); }
  for (const h of holes) if (!h.group?.length) members.add(h);
  for (const e of members) e.group = [...(e.group || []), g];
  f.group = [g];
  return true;
}

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
    // the objects the fill belongs to: whatever its outside edge is made of (one shape, or several pieces), and its holes
    const owner = a.outer !== undefined ? bd.src[a.outer] : undefined;
    const { edge, extra } = fillMembers(bd, a.rings, owner, (a.holes || []).map(i => bd.src[i]));
    let joined = false;
    ed.store.change(() => {
      const f = ed.store.add({ type: 'fill', rings: a.rings.map(r => r.map(p => ({ x: +p.x.toFixed(5), y: +p.y.toFixed(5) }))), paint } as Shape, { color: 'ink', w: 0.1, layer: (owner || edge[0])?.layer });
      joined = joinFill(ed, f, edge, extra);
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
