/**
 * Select tool: click / box selection, drag-move with snapping, marquee handles
 * (stretch, squash, rotate, flip, copy, move) and point editing ("Edit Mode").
 */
import { type Point, P, add, sub, mul, dot, dist, angOf, normA, polar, clean, cp, fmt, DEG, TAU } from '../geometry/vec';
import { ellPt, prims, boxCentre, type Box } from '../geometry/entity';
import { segsOf, segPoint } from '../geometry/path';
import { splineSegs, bez, mirrorHandle, splitSplineAt } from '../geometry/spline';
import { affEnt, affMove, affRot, affScale, type Affine } from '../geometry/affine';
import type { Tool, PointerInfo } from '../editor/tool';
import type { Editor } from '../editor/editor';
import type { Entity, Shape } from '../model/types';
import { ICONS } from './icons';
import { softMove, deleteNodeKeepShape } from '../geometry/fitcurve';
import { isText, flipText, slideText, textWheel, pathUnder, attachToPath, textOptions, applyOpt } from './text';
import { anchorPoint, textShapes } from '../text/text';
import type { TextEnt } from '../model/types';

export interface Handle { k: 'scale' | 'rot' | 'flipV' | 'flipH' | 'copy' | 'move'; fx?: number; fy?: number; x: number; y: number; b: Box }
export interface NodeHandle { k: 'v' | 'add' | 'c' | 'r' | 'rx' | 'ry' | 'a0' | 'a1' | 'p1' | 'p2' | 'off' | 'hin' | 'hout'; i?: number; p: Point; role?: 'start' | 'end' | 'mid' }

export function handles(ed: Editor): Handle[] {
  if (ed.tool.id !== 'select' || !ed.sel.size || ed.state.node) return [];
  const b = ed.selBox(); if (!b) return [];
  const A = ed.w2s(P(b.x0, b.y1)), B = ed.w2s(P(b.x1, b.y0)), mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, H: Handle[] = [];
  // text on a path: it is sized from the options and moved by sliding it along its line, so only the flip handles
  const one = ed.sel.size === 1 ? ed.selected()[0] : null;
  if (isText(one) && one.path) { H.push({ k: 'flipV', x: mx, y: A.y - 26, b }, { k: 'flipH', x: A.x - 26, y: my, b }); return H; }
  const wOK = b.x1 - b.x0 > 1e-9, hOK = b.y1 - b.y0 > 1e-9;
  const sx = (fx: number) => fx < 0 ? A.x : fx > 0 ? B.x : mx, sy = (fy: number) => fy > 0 ? A.y : fy < 0 ? B.y : my;
  for (const [fx, fy] of [[-1, 1], [1, 1], [1, -1], [-1, -1], [0, 1], [1, 0], [0, -1], [-1, 0]]) {
    if ((fx && !wOK) || (fy && !hOK)) continue; H.push({ k: 'scale', fx, fy, x: sx(fx), y: sy(fy), b });
  }
  H.push({ k: 'rot', x: B.x + 26, y: my, b }, { k: 'flipV', x: mx, y: A.y - 26, b }, { k: 'flipH', x: A.x - 26, y: my, b }, { k: 'copy', x: mx, y: B.y + 26, b }, { k: 'move', x: mx, y: my, b });
  return H;
}
/**
 * Smart alignment while dragging (like Figma / Fusion): the moving selection's
 * left, centre and right (and bottom, middle, top) line up with other shapes and
 * with the sheet when they come within a few pixels. Returns the adjusted move and guide lines.
 */
export function smartAlign(ed: Editor, sel: Box, others: Box[], d: Point): { d: Point; guides: [Point, Point][]; hit: boolean } {
  const tol = 7 / ed.view.k, B = { x0: sel.x0 + d.x, x1: sel.x1 + d.x, y0: sel.y0 + d.y, y1: sel.y1 + d.y };
  const xs = (b: Box) => [b.x0, (b.x0 + b.x1) / 2, b.x1], ys = (b: Box) => [b.y0, (b.y0 + b.y1) / 2, b.y1];
  let bx: { diff: number; v: number; o: Box } | null = null, by: { diff: number; v: number; o: Box } | null = null;
  for (const o of others) {
    for (const a of xs(B)) for (const v of xs(o)) { const df = v - a; if (Math.abs(df) <= tol && (!bx || Math.abs(df) < Math.abs(bx.diff))) bx = { diff: df, v, o }; }
    for (const a of ys(B)) for (const v of ys(o)) { const df = v - a; if (Math.abs(df) <= tol && (!by || Math.abs(df) < Math.abs(by.diff))) by = { diff: df, v, o }; }
  }
  const out = P(d.x + (bx?.diff || 0), d.y + (by?.diff || 0)), M = { x0: sel.x0 + out.x, x1: sel.x1 + out.x, y0: sel.y0 + out.y, y1: sel.y1 + out.y }, guides: [Point, Point][] = [];
  if (bx) guides.push([P(bx.v, Math.min(M.y0, bx.o.y0)), P(bx.v, Math.max(M.y1, bx.o.y1))]);
  if (by) guides.push([P(Math.min(M.x0, by.o.x0), by.v), P(Math.max(M.x1, by.o.x1), by.v)]);
  return { d: out, guides, hit: !!(bx || by) };
}
const WEAK_SNAPS = new Set<any>(['grid', 'step', 'radial', 'track', 'nearest', null, undefined]);
function startDrag(ed: Editor, from: Point, extra: Record<string, any> = {}) {
  const pg = ed.doc.page, others = ed.doc.ents.filter(e => !ed.sel.has(e.id) && ed.store.visible(e) && e.type !== 'dim').slice(0, 2000).map(e => ed.bbox(e));
  others.push({ x0: 0, y0: 0, x1: pg.w, y1: pg.h });
  return { from, to: from, moved: false, box: ed.selBox(), others, guides: [] as [Point, Point][], ...extra };
}
export const hitHandle = (ed: Editor, sp: Point) => handles(ed).find(h => Math.abs(h.x - sp.x) <= 8 && Math.abs(h.y - sp.y) <= 8) || null;

/** The transform a handle drag produces for the current cursor. */
export function handleTransform(ed: Editor, h: Handle, start: Point, cur: Point, mods: { shift: boolean; alt: boolean }): { A: Affine; label: string } {
  const b = h.b, c = boxCentre(b);
  if (h.k === 'rot') {
    let t = angOf(c, cur) - angOf(c, start); const R = ed.doc.aids.radial;
    if (mods.shift) t = Math.round(t / (15 * DEG)) * 15 * DEG; else if (R.on) t = Math.round(t / (R.step * DEG)) * R.step * DEG;
    return { A: affRot(c, t), label: `${fmt(normA(t + Math.PI) / DEG - 180, 2)}°` };
  }
  const fx = h.fx!, fy = h.fy!, anc = mods.alt ? c : P(fx > 0 ? b.x0 : b.x1, fy > 0 ? b.y0 : b.y1), hw = P(fx < 0 ? b.x0 : b.x1, fy > 0 ? b.y1 : b.y0);
  const p = ed.snapAt(cur, { exclude: ed.sel, drawing: true }).p;
  let sx = fx ? (p.x - anc.x) / ((hw.x - anc.x) || 1) : 1, sy = fy ? (p.y - anc.y) / ((hw.y - anc.y) || 1) : 1;
  if (mods.shift && fx && fy) { const s = Math.max(Math.abs(sx), Math.abs(sy)); sx = Math.sign(sx || 1) * s; sy = Math.sign(sy || 1) * s; }
  else if (mods.shift) { const s = fx ? sx : sy; sx = sy = s; }
  if (Math.abs(sx) < 1e-6) sx = 1e-6; if (Math.abs(sy) < 1e-6) sy = 1e-6;
  return { A: affScale(anc, sx, sy), label: `${fmt((b.x1 - b.x0) * Math.abs(sx), 3)} × ${fmt((b.y1 - b.y0) * Math.abs(sy), 3)} mm` };
}

export function nodeHandles(ed: Editor, e: Entity | Shape): NodeHandle[] {
  const H: NodeHandle[] = [];
  if (e.type === 'line') H.push({ k: 'v', i: 0, p: e.a, role: 'start' }, { k: 'v', i: 1, p: e.b, role: 'end' });
  else if (e.type === 'poly') {
    e.pts.forEach((p, i) => H.push({ k: 'v', i, p, role: i === 0 ? 'start' : (i === e.pts.length - 1 && !e.closed) ? 'end' : 'mid' }));
    if (e.pts.length <= 400) segsOf(e).forEach((s, i) => s.kind === 'seg' && H.push({ k: 'add', i, p: segPoint(s, .5) }));
  }
  else if (e.type === 'spline') {
    const n = e.pts.length;
    e.pts.forEach((p, i) => {
      if (e.closed || i > 0) H.push({ k: 'hin', i, p: e.h[i][0] });
      if (e.closed || i < n - 1) H.push({ k: 'hout', i, p: e.h[i][1] });
      H.push({ k: 'v', i, p, role: i === 0 ? 'start' : (i === n - 1 && !e.closed) ? 'end' : 'mid' });
    });
    splineSegs(e).forEach((b, i) => H.push({ k: 'add', i, p: bez(b, .5) }));
  }
  else if (e.type === 'circle') H.push({ k: 'c', p: e.c }, { k: 'r', p: polar(e.c, e.r, 0) });
  else if (e.type === 'ellipse') H.push({ k: 'c', p: e.c }, { k: 'rx', p: ellPt(e, 0) }, { k: 'ry', p: ellPt(e, Math.PI / 2) });
  else if (e.type === 'arc') H.push({ k: 'c', p: e.c }, { k: 'a0', p: polar(e.c, e.r, e.a0), role: 'start' }, { k: 'a1', p: polar(e.c, e.r, e.a1), role: 'end' }, { k: 'r', p: polar(e.c, e.r, e.a0 + normA(e.a1 - e.a0) / 2) });
  else if (e.type === 'dim') H.push({ k: 'p1', p: e.p1 }, { k: 'p2', p: e.p2 }, { k: 'off', p: e.mode === 'r' || e.mode === 'd' ? e.off : ed.dimGeom(e as any).text.p });
  return H;
}
export function nodeApply(e: Entity | Shape, h: NodeHandle, p: Point, mods?: { alt: boolean }): Shape {
  const n: any = structuredClone(e); p = cp(p);
  if (e.type === 'spline') {
    const i = h.i!;
    if (h.k === 'v') { const d = sub(p, e.pts[i]); n.pts[i] = p; n.h[i] = [add(e.h[i][0], d), add(e.h[i][1], d)]; }
    else if (h.k === 'hin') { n.h[i][0] = p; if (!mods?.alt) n.h[i][1] = mirrorHandle(e.pts[i], p, e.h[i][1]); }
    else if (h.k === 'hout') { n.h[i][1] = p; if (!mods?.alt) n.h[i][0] = mirrorHandle(e.pts[i], p, e.h[i][0]); }
    return n;
  }
  if (e.type === 'line') n[h.i ? 'b' : 'a'] = p;
  else if (e.type === 'poly') n.pts[h.i!] = p;
  else if (h.k === 'c') return affEnt(e as Shape, affMove(sub(p, (e as any).c)));
  else if (e.type === 'circle' && h.k === 'r') n.r = clean(dist(e.c, p));
  else if (e.type === 'ellipse') { const u = P(Math.cos(e.rot), Math.sin(e.rot)), v = P(-u.y, u.x), d = sub(p, e.c); if (h.k === 'rx') n.rx = clean(Math.max(1e-6, Math.abs(dot(d, u)))); else n.ry = clean(Math.max(1e-6, Math.abs(dot(d, v)))); }
  else if (e.type === 'arc') { if (h.k === 'a0') n.a0 = normA(angOf(e.c, p)); else if (h.k === 'a1') n.a1 = normA(angOf(e.c, p)); else if (h.k === 'r') n.r = clean(dist(e.c, p)); }
  else if (e.type === 'dim') n[h.k] = p;
  return n;
}
function hitNode(ed: Editor, sp: Point): NodeHandle | null {
  const e = ed.state.node && ed.store.byId(ed.state.node.id); if (!e) return null;
  let best: { h: NodeHandle; d: number } | null = null;
  for (const h of nodeHandles(ed, e)) { const s = ed.w2s(h.p), d = Math.hypot(s.x - sp.x, s.y - sp.y); if (d <= (h.k === 'add' ? 6 : 8) && (!best || d < best.d || (best.h.k === 'add' && h.k !== 'add'))) best = { h, d }; }
  return best?.h || null;
}
export function enterNodeEdit(ed: Editor, e: Entity) { ed.setSelection([e.id]); ed.state.node = { id: e.id, sel: null }; ed.changed('prompt'); }

export const selectTool: Tool = {
  id: 'select', label: 'Select', key: 'V', icon: ICONS.select, group: 0,
  // while text is selected, its settings show in the option bar and change it straight away
  get options() { return textOptions(true); },
  onOpt: applyOpt,
  prompt: ed => ed.state.node ? 'Editing points · drag a node (snaps apply) · click + to add a node · Delete removes the selected node · Esc to finish'
    : 'Click or drag a box to select · drag handles to stretch, rotate or flip · double-click a shape to edit its points',
  down(ed, raw, info) {
    const S = ed.state;
    if (S.node) {
      const e = ed.store.byId(S.node.id) as Entity | undefined, h = hitNode(ed, info.sp);
      if (h && e) {
        if (h.k === 'add' && e.type === 'spline') { ed.store.checkpoint(); const ns = splitSplineAt(e, h.i!); e.pts = ns.pts; e.h = ns.h; S.ndrag = { h: { k: 'v', i: h.i! + 1, p: h.p }, id: e.id, preview: null, pushed: true }; S.node.sel = h.i! + 1; }
        else if (h.k === 'add' && e.type === 'poly') { ed.store.checkpoint(); e.pts.splice(h.i! + 1, 0, cp(h.p)); if (e.bulge) e.bulge.splice(h.i! + 1, 0, 0); S.ndrag = { h: { k: 'v', i: h.i! + 1, p: h.p }, id: e.id, preview: null, pushed: true }; S.node.sel = h.i! + 1; }
        else { S.ndrag = { h, id: e.id, preview: null }; if (h.k === 'v') { S.node.sel = h.i; ed.changed('prompt'); } }
        return;
      }
      const hit2 = ed.pick(raw); if (hit2 && hit2.e.id === S.node.id) { S.node.sel = null; ed.changed('prompt'); return; }
      S.node = null; ed.changed('prompt');
    }
    const hd = hitHandle(ed, info.sp);
    if (hd) {
      if (hd.k === 'flipH' || hd.k === 'flipV') {
        const one = ed.sel.size === 1 ? ed.selected()[0] : null;
        if (isText(one)) { flipText(ed, one, hd.k === 'flipH' ? 'h' : 'v'); return; }
        ed.flipSel(hd.k === 'flipH' ? 'h' : 'v'); return;
      }
      if (hd.k === 'move' || hd.k === 'copy') {
        if (hd.k === 'copy') { S.copySrc = [...ed.sel]; ed.store.checkpoint(); ed.transformSel(affMove(P(0, 0)), 1); ed.store.emit(); }
        const s = ed.snapAt(raw, { exclude: ed.sel, drawing: true }); S.drag = startDrag(ed, s.p, { copy: hd.k === 'copy' }); return;
      }
      S.hdrag = { h: hd, start: raw, tx: null }; return;
    }
    const hit = ed.pick(raw)?.e;
    // text on a path: press and drag slides it along the line
    if (isText(hit) && hit.path && !info.shift && !(ed.sel.has(hit.id) && ed.sel.size > 1)) {
      ed.setSelection(ed.withGroups([hit.id])); if (ed.sel.size === 1) { S.slide = { id: hit.id, sp: info.sp, moved: false, snap: null }; return; }
    }
    if (hit && ed.sel.has(hit.id) && !info.shift) { const s = ed.snapAt(raw, { exclude: ed.sel, drawing: true }); S.drag = startDrag(ed, s.p); return; }
    if (hit) {
      const members = ed.withGroups([hit.id]);
      if (info.shift) { const on = ed.sel.has(hit.id); for (const id of members) on ? ed.sel.delete(id) : ed.sel.add(id); ed.changed('sel'); }
      else ed.setSelection(members);
      const s = ed.snapAt(raw, { exclude: ed.sel, drawing: true }); S.drag = startDrag(ed, s.p); return;
    }
    if (!info.shift && ed.sel.size) ed.setSelection([]);
    S.box = { a: raw, b: raw };
  },
  move(ed, raw, info) {
    const S = ed.state;
    if (S.slide) {
      const t = ed.store.byId(S.slide.id) as TextEnt | undefined; if (!t?.path) return;
      if (!S.slide.moved) { if (Math.hypot(info.sp.x - S.slide.sp.x, info.sp.y - S.slide.sp.y) <= 3) return; ed.store.checkpoint(); S.slide.moved = true; }
      S.slide.snap = slideText(ed, t, raw); ed.snapRes = null; return;
    }
    if (S.box) { S.box.b = raw; ed.snapRes = null; }
    else if (S.ndrag) {
      const e = ed.store.byId(S.ndrag.id)!; ed.snapRes = ed.snapAt(raw, { exclude: new Set([e.id]), drawing: true }); S.ndrag.preview = nodeApply(e, S.ndrag.h, ed.snapRes.p, ed.mods);
      // soft drag: neighbouring points follow, fading with distance
      if (ed.opt.softDrag && S.ndrag.h.k === 'v' && (e.type === 'poly' || e.type === 'spline')) S.ndrag.preview = softMove(e as any, S.ndrag.preview as any, S.ndrag.h.i!, sub(ed.snapRes.p, (e as any).pts[S.ndrag.h.i!]), Math.max(1, +ed.opt.softR || 20));
    }
    else if (S.hdrag) { ed.snapRes = S.hdrag.h.k === 'rot' ? null : ed.snapAt(raw, { exclude: ed.sel, drawing: true }); S.hdrag.tx = handleTransform(ed, S.hdrag.h, S.hdrag.start, raw, info); }
    else if (S.drag) {
      ed.snapRes = ed.snapAt(raw, { exclude: ed.sel, drawing: true }); let d = sub(ed.snapRes.p, S.drag.from); S.drag.guides = [];
      if (S.drag.box && WEAK_SNAPS.has(ed.snapRes.k as any) && !info.alt) { const g = smartAlign(ed, S.drag.box, S.drag.others, d); d = g.d; S.drag.guides = g.guides; if (g.hit) ed.snapRes = { ...ed.snapRes, k: null }; }
      S.drag.to = add(S.drag.from, d); if (dist(S.drag.to, S.drag.from) > 1e-9) S.drag.moved = true;
      // a single piece of straight text dragged over a line, arc or circle: let go to put it on it
      const one = ed.sel.size === 1 ? ed.selected()[0] : null;
      S.drag.dropOn = isText(one) && !one.path && S.drag.moved ? pathUnder(ed, raw, ed.sel)?.id ?? null : null;
      if (S.drag.dropOn) S.drag.dropAt = raw;
    }
  },
  up(ed) {
    const S = ed.state;
    if (S.ndrag) { const nd = S.ndrag; S.ndrag = null; if (nd.preview) { if (!nd.pushed) ed.store.checkpoint(); ed.store.replace(nd.id, nd.preview); } ed.store.emit(); return; }
    if (S.hdrag) { const hd = S.hdrag; S.hdrag = null; if (hd.tx) ed.store.change(() => ed.transformSel(hd.tx.A)); return; }
    if (S.box) {
      const { a, b } = S.box, crossing = b.x < a.x, x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      if (x1 - x0 > 1e-6 || y1 - y0 > 1e-6) for (const e of ed.doc.ents) {
        if (!ed.store.usable(e)) continue; const q = ed.bbox(e);
        const inside = q.x0 >= x0 && q.x1 <= x1 && q.y0 >= y0 && q.y1 <= y1, over = q.x1 >= x0 && q.x0 <= x1 && q.y1 >= y0 && q.y0 <= y1;
        if (inside || (crossing && over)) ed.sel.add(e.id);
      }
      ed.sel = ed.withGroups(ed.sel); S.box = null; ed.changed('sel'); return;
    }
    if (S.slide) { const sl = S.slide; S.slide = null; if (sl.moved) ed.store.emit(); return; }
    if (S.drag) {
      const d = S.drag; S.drag = null;
      const tgt = d.dropOn && ed.store.byId(d.dropOn), one = ed.selected()[0];
      if (tgt && isText(one)) { ed.store.checkpoint(); attachToPath(one, tgt, d.dropAt, { side: ed.opt.txtSide, effect: ed.opt.txtEffect }); ed.store.emit(); ed.toast('Text is on the line — drag it along; the ↕ handle puts it on the other side'); return; }
      if (d.moved) { if (!d.copy) ed.store.checkpoint(); ed.transformSel(affMove(sub(d.to, d.from))); ed.rel = d.to; ed.store.emit(); }
      else if (d.copy) { ed.store.remove(ed.sel); ed.store.discardCheckpoint(); ed.store.emit(); ed.setSelection(S.copySrc || []); ed.toast('Drag the copy handle to place a copy'); }
      S.copySrc = null;
    }
  },
  dblclick(ed, raw) { const hit = ed.pick(raw)?.e; if (isText(hit)) { ed.setSelection([hit.id]); ed.textEditor?.(hit.id, false); return; } if (hit) enterNodeEdit(ed, hit); },
  wheel: (ed, dir, info) => !ed.state.node && textWheel(ed, dir, info),
  onKey(ed, key) {
    const S = ed.state;
    if (key === 'Enter' && ed.sel.size === 1 && !S.node) { const e = ed.selected()[0]; if (isText(e)) ed.textEditor?.(e.id, false); else enterNodeEdit(ed, e); return true; }
    if ((key === 'Delete' || key === 'Backspace') && S.node && S.node.sel != null) {
      const e = ed.store.byId(S.node.id);
      if (e && e.type === 'spline') { const min = e.closed ? 3 : 2; if (e.pts.length <= min) { ed.toast(`A curve needs at least ${min} points`); return true; } const i = S.node.sel; ed.store.change(() => { const r = deleteNodeKeepShape(e, i); e.pts = r.pts; e.h = r.h; }); S.node.sel = null; ed.changed('prompt'); return true; }
      if (e && e.type === 'poly') { const min = e.closed ? 3 : 2; if (e.pts.length <= min) { ed.toast(`A path needs at least ${min} points`); return true; } const i = S.node.sel; ed.store.change(() => { e.pts.splice(i, 1); if (e.bulge) { e.bulge.splice(i, 1); if (i > 0) e.bulge[i - 1] = 0; else if (e.closed) e.bulge[e.bulge.length - 1] = 0; } }); S.node.sel = null; return true; }
    }
    return false;
  },
  cancel(ed) { if (ed.state.node) { ed.state.node = null; ed.state.ndrag = null; ed.changed('prompt'); return true; } return false; },
  cursor(ed, sp) {
    const S = ed.state; if (S.slide) return 'grabbing'; if (S.drag || S.hdrag || S.ndrag || S.box) return 'default';
    const h: any = S.node ? hitNode(ed, sp) : hitHandle(ed, sp);
    if (!h) { const t = !S.node && ed.pick(ed.s2w(sp))?.e; return isText(t) && t.path ? 'grab' : 'default'; }
    if (h.k === 'rot') return 'grab';
    if (h.k === 'scale') return h.fx * h.fy > 0 ? 'nesw-resize' : h.fx * h.fy < 0 ? 'nwse-resize' : h.fx ? 'ew-resize' : 'ns-resize';
    return 'pointer';
  },
  overlay(ed, o) {
    const S = ed.state;
    if (S.drag?.dropOn) {
      const one = ed.selected()[0] as TextEnt, tgt = ed.store.byId(S.drag.dropOn)!, t: TextEnt = structuredClone(one);
      attachToPath(t, tgt, S.drag.dropAt, { side: ed.opt.txtSide, effect: ed.opt.txtEffect });
      o.hide(ed.sel); o.highlight([tgt.id], 'source'); for (const s of textShapes(t)) o.ghost(s, 'selected'); o.label('Let go to put the text on this line', ed.cur); return;
    }
    if (S.slide?.moved) o.label(S.slide.snap ? 'Snapped to the ' + S.slide.snap : 'Drag along the line', ed.cur);
    else if (ed.state.textMsg && Date.now() < ed.state.textMsg.until) o.label(ed.state.textMsg.msg, ed.cur);
    if (S.drag?.moved) {
      o.hide(ed.sel); const A = affMove(sub(S.drag.to, S.drag.from)); for (const e of ed.selected()) o.ghost(affEnt(e as Shape, A), 'selected');
      const G: [Point, Point][] = S.drag.guides || [];
      if (G.length) o.custom((ctx, ed2, C) => { ctx.strokeStyle = C['--sel']; ctx.lineWidth = 1; ctx.setLineDash([]); for (const [a, b] of G) { const p = ed2.w2s(a), q = ed2.w2s(b); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); for (const r of [p, q]) { ctx.beginPath(); ctx.moveTo(r.x - 3, r.y - 3); ctx.lineTo(r.x + 3, r.y + 3); ctx.moveTo(r.x + 3, r.y - 3); ctx.lineTo(r.x - 3, r.y + 3); ctx.stroke(); } } });
      o.label(`Δ ${fmt(S.drag.to.x - S.drag.from.x, 3)}, ${fmt(S.drag.to.y - S.drag.from.y, 3)}`, S.drag.to); return; }
    if (S.hdrag?.tx) { o.hide(ed.sel); for (const e of ed.selected()) o.ghost(affEnt(e as Shape, S.hdrag.tx.A), 'selected'); o.label(S.hdrag.tx.label, ed.cur); return; }
    if (S.ndrag?.preview) { o.hide([S.ndrag.id]); o.ghost(S.ndrag.preview, 'selected'); }
    if (ed.opt.softDrag && S.node) { const R = Math.max(1, +ed.opt.softR || 20), c = S.ndrag?.h?.k === 'v' ? (ed.store.byId(S.ndrag.id) as any)?.pts?.[S.ndrag.h.i] : null; if (c) o.custom((ctx, ed2, C) => { const s = ed2.w2s(c); ctx.strokeStyle = C['--accent']; ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(s.x, s.y, R * ed2.view.k, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }); }
    // Simplify preview (from the Properties panel): the new curve and its few nodes
    const sp = ed.state.simp as { ids: string[]; shapes: Shape[] } | null;
    if (sp) { o.hide(sp.ids); for (const s of sp.shapes) o.ghost(s, 'selected'); o.custom((ctx, ed2, C) => { ctx.fillStyle = C['--sheet']; ctx.strokeStyle = C['--accent']; ctx.lineWidth = 1.5; for (const s of sp.shapes as any[]) for (const q of s.pts) { const p = ed2.w2s(q); ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, TAU); ctx.fill(); ctx.stroke(); } }); return; }
    if (S.box) o.custom((ctx, ed2, C) => {
      const a = ed2.w2s(S.box.a), b = ed2.w2s(S.box.b), crossing = S.box.b.x < S.box.a.x;
      ctx.setLineDash(crossing ? [5, 4] : []); ctx.strokeStyle = C['--accent']; ctx.lineWidth = 1; ctx.globalAlpha = .12; ctx.fillStyle = C['--accent']; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.globalAlpha = 1; ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.setLineDash([]);
    });
    o.highlight(ed.sel, 'selected');
    if (S.node) {
      const e = ed.store.byId(S.node.id); if (!e) return; const ee = S.ndrag?.preview || e;
      o.custom((ctx, ed2, C) => {
        if (ee.type === 'spline') { ctx.strokeStyle = C['--muted']; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.beginPath(); ee.pts.forEach((p: Point, i: number) => { const a = ed2.w2s(p); for (const q of ee.h[i]) { const b = ed2.w2s(q); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); } }); ctx.stroke(); }
        for (const h of nodeHandles(ed2, ee)) {
          const s = ed2.w2s(h.p); ctx.lineWidth = 1.5; ctx.beginPath();
          if (h.k === 'add') { ctx.strokeStyle = C['--muted']; ctx.moveTo(s.x - 4, s.y); ctx.lineTo(s.x + 4, s.y); ctx.moveTo(s.x, s.y - 4); ctx.lineTo(s.x, s.y + 4); ctx.stroke(); continue; }
          const col = h.role === 'start' ? C['--node-start'] : h.role === 'end' ? C['--node-end'] : (h.k === 'v' ? C['--node'] : C['--accent']);
          ctx.fillStyle = (S.node.sel === h.i && h.k === 'v') ? col : C['--sheet']; ctx.strokeStyle = col;
          if (h.k === 'hin' || h.k === 'hout') { ctx.fillStyle = C['--accent']; ctx.rect(s.x - 3.5, s.y - 3.5, 7, 7); ctx.fill(); continue; }
          if (['v', 'a0', 'a1', 'p1', 'p2'].includes(h.k)) ctx.arc(s.x, s.y, 5, 0, TAU);
          else if (h.k === 'c') ctx.rect(s.x - 5, s.y - 5, 10, 10);
          else { ctx.moveTo(s.x, s.y - 6); ctx.lineTo(s.x + 6, s.y); ctx.lineTo(s.x, s.y + 6); ctx.lineTo(s.x - 6, s.y); ctx.closePath(); }
          ctx.fill(); ctx.stroke();
        }
      });
      return;
    }
    const H = handles(ed); if (!H.length) return;
    const one = ed.sel.size === 1 ? ed.selected()[0] : null, ap = isText(one) && one.path ? anchorPoint(one) : null;
    if (ap) o.custom((ctx, ed2, C) => { const s = ed2.w2s(ap); ctx.fillStyle = C['--accent']; ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, TAU); ctx.fill(); });
    o.custom((ctx, ed2, C) => {
      const b = H[0].b, A = ed2.w2s(P(b.x0, b.y1)), B = ed2.w2s(P(b.x1, b.y0));
      ctx.setLineDash([4, 3]); ctx.strokeStyle = C['--accent']; ctx.lineWidth = 1; ctx.strokeRect(A.x - .5, A.y - .5, B.x - A.x + 1, B.y - A.y + 1); ctx.setLineDash([]);
      for (const hd of H) {
        ctx.fillStyle = C['--sheet']; ctx.strokeStyle = C['--accent']; ctx.lineWidth = 1.5; ctx.beginPath();
        if (hd.k === 'scale') ctx.rect(hd.x - 4.5, hd.y - 4.5, 9, 9);
        else if (hd.k === 'rot') ctx.arc(hd.x, hd.y, 6, 0, TAU);
        else if (hd.k === 'flipV' || hd.k === 'flipH') { ctx.moveTo(hd.x, hd.y - 7); ctx.lineTo(hd.x + 7, hd.y); ctx.lineTo(hd.x, hd.y + 7); ctx.lineTo(hd.x - 7, hd.y); ctx.closePath(); }
        else if (hd.k === 'copy') { ctx.rect(hd.x - 6, hd.y - 3, 8, 8); ctx.rect(hd.x - 2, hd.y - 6, 8, 8); }
        else ctx.rect(hd.x - 6, hd.y - 6, 12, 12);
        ctx.fill(); ctx.stroke();
        if (hd.k === 'rot') { ctx.beginPath(); ctx.arc(hd.x, hd.y, 2, 0, TAU); ctx.fillStyle = C['--accent']; ctx.fill(); }
        if (hd.k === 'move') { ctx.beginPath(); ctx.moveTo(hd.x - 3, hd.y); ctx.lineTo(hd.x + 3, hd.y); ctx.moveTo(hd.x, hd.y - 3); ctx.lineTo(hd.x, hd.y + 3); ctx.stroke(); }
      }
    });
  },
};
export type { PointerInfo };
