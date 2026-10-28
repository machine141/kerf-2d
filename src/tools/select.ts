/**
 * Select tool: click / box selection, drag-move with snapping, marquee handles
 * (stretch, squash, rotate, flip, copy, move) and point editing ("Edit Mode").
 */
import { type Point, P, add, sub, mul, dot, dist, angOf, normA, polar, clean, cp, fmt, DEG, TAU } from '../geometry/vec';
import { ellPt, prims, boxCentre, type Box } from '../geometry/entity';
import { affEnt, affMove, affRot, affScale, type Affine } from '../geometry/affine';
import type { Tool, PointerInfo } from '../editor/tool';
import type { Editor } from '../editor/editor';
import type { Entity, Shape } from '../model/types';
import { ICONS } from './icons';

export interface Handle { k: 'scale' | 'rot' | 'flipV' | 'flipH' | 'copy' | 'move'; fx?: number; fy?: number; x: number; y: number; b: Box }
export interface NodeHandle { k: 'v' | 'add' | 'c' | 'r' | 'rx' | 'ry' | 'a0' | 'a1' | 'p1' | 'p2' | 'off'; i?: number; p: Point; role?: 'start' | 'end' | 'mid' }

export function handles(ed: Editor): Handle[] {
  if (ed.tool.id !== 'select' || !ed.sel.size || ed.state.node) return [];
  const b = ed.selBox(); if (!b) return [];
  const A = ed.w2s(P(b.x0, b.y1)), B = ed.w2s(P(b.x1, b.y0)), mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, H: Handle[] = [];
  const wOK = b.x1 - b.x0 > 1e-9, hOK = b.y1 - b.y0 > 1e-9;
  const sx = (fx: number) => fx < 0 ? A.x : fx > 0 ? B.x : mx, sy = (fy: number) => fy > 0 ? A.y : fy < 0 ? B.y : my;
  for (const [fx, fy] of [[-1, 1], [1, 1], [1, -1], [-1, -1], [0, 1], [1, 0], [0, -1], [-1, 0]]) {
    if ((fx && !wOK) || (fy && !hOK)) continue; H.push({ k: 'scale', fx, fy, x: sx(fx), y: sy(fy), b });
  }
  H.push({ k: 'rot', x: B.x + 26, y: my, b }, { k: 'flipV', x: mx, y: A.y - 26, b }, { k: 'flipH', x: A.x - 26, y: my, b }, { k: 'copy', x: mx, y: B.y + 26, b }, { k: 'move', x: mx, y: my, b });
  return H;
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
    if (e.pts.length <= 400) prims(e).forEach((s, i) => s.t === 'seg' && H.push({ k: 'add', i, p: mul(add(s.a, s.b), .5) }));
  }
  else if (e.type === 'circle') H.push({ k: 'c', p: e.c }, { k: 'r', p: polar(e.c, e.r, 0) });
  else if (e.type === 'ellipse') H.push({ k: 'c', p: e.c }, { k: 'rx', p: ellPt(e, 0) }, { k: 'ry', p: ellPt(e, Math.PI / 2) });
  else if (e.type === 'arc') H.push({ k: 'c', p: e.c }, { k: 'a0', p: polar(e.c, e.r, e.a0), role: 'start' }, { k: 'a1', p: polar(e.c, e.r, e.a1), role: 'end' }, { k: 'r', p: polar(e.c, e.r, e.a0 + normA(e.a1 - e.a0) / 2) });
  else if (e.type === 'dim') H.push({ k: 'p1', p: e.p1 }, { k: 'p2', p: e.p2 }, { k: 'off', p: ed.dimGeom(e as any).text.p });
  return H;
}
export function nodeApply(e: Entity | Shape, h: NodeHandle, p: Point): Shape {
  const n: any = structuredClone(e); p = cp(p);
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
  prompt: ed => ed.state.node ? 'Editing points · drag a node (snaps apply) · click + to add a node · Delete removes the selected node · Esc to finish'
    : 'Click or drag a box to select · drag handles to stretch, rotate or flip · double-click a shape to edit its points',
  down(ed, raw, info) {
    const S = ed.state;
    if (S.node) {
      const e = ed.store.byId(S.node.id) as Entity | undefined, h = hitNode(ed, info.sp);
      if (h && e) {
        if (h.k === 'add' && e.type === 'poly') { ed.store.checkpoint(); e.pts.splice(h.i! + 1, 0, cp(h.p)); S.ndrag = { h: { k: 'v', i: h.i! + 1, p: h.p }, id: e.id, preview: null, pushed: true }; S.node.sel = h.i! + 1; }
        else { S.ndrag = { h, id: e.id, preview: null }; if (h.k === 'v') S.node.sel = h.i; }
        return;
      }
      const hit2 = ed.pick(raw); if (hit2 && hit2.e.id === S.node.id) { S.node.sel = null; return; }
      S.node = null; ed.changed('prompt');
    }
    const hd = hitHandle(ed, info.sp);
    if (hd) {
      if (hd.k === 'flipH' || hd.k === 'flipV') { ed.flipSel(hd.k === 'flipH' ? 'h' : 'v'); return; }
      if (hd.k === 'move' || hd.k === 'copy') {
        if (hd.k === 'copy') { S.copySrc = [...ed.sel]; ed.store.checkpoint(); ed.transformSel(affMove(P(0, 0)), 1); ed.store.emit(); }
        const s = ed.snapAt(raw, { exclude: ed.sel, drawing: true }); S.drag = { from: s.p, to: s.p, moved: false, copy: hd.k === 'copy' }; return;
      }
      S.hdrag = { h: hd, start: raw, tx: null }; return;
    }
    const hit = ed.pick(raw)?.e;
    if (hit && ed.sel.has(hit.id) && !info.shift) { const s = ed.snapAt(raw, { exclude: ed.sel, drawing: true }); S.drag = { from: s.p, to: s.p, moved: false }; return; }
    if (hit) {
      if (info.shift) { ed.sel.has(hit.id) ? ed.sel.delete(hit.id) : ed.sel.add(hit.id); ed.changed('sel'); }
      else ed.setSelection([hit.id]);
      const s = ed.snapAt(raw, { exclude: ed.sel, drawing: true }); S.drag = { from: s.p, to: s.p, moved: false }; return;
    }
    if (!info.shift && ed.sel.size) ed.setSelection([]);
    S.box = { a: raw, b: raw };
  },
  move(ed, raw, info) {
    const S = ed.state;
    if (S.box) { S.box.b = raw; ed.snapRes = null; }
    else if (S.ndrag) { const e = ed.store.byId(S.ndrag.id)!; ed.snapRes = ed.snapAt(raw, { exclude: new Set([e.id]), drawing: true }); S.ndrag.preview = nodeApply(e, S.ndrag.h, ed.snapRes.p); }
    else if (S.hdrag) { ed.snapRes = S.hdrag.h.k === 'rot' ? null : ed.snapAt(raw, { exclude: ed.sel, drawing: true }); S.hdrag.tx = handleTransform(ed, S.hdrag.h, S.hdrag.start, raw, info); }
    else if (S.drag) { ed.snapRes = ed.snapAt(raw, { exclude: ed.sel, drawing: true }); S.drag.to = ed.snapRes.p; if (dist(S.drag.to, S.drag.from) > 1e-9) S.drag.moved = true; }
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
      S.box = null; ed.changed('sel'); return;
    }
    if (S.drag) {
      const d = S.drag; S.drag = null;
      if (d.moved) { if (!d.copy) ed.store.checkpoint(); ed.transformSel(affMove(sub(d.to, d.from))); ed.rel = d.to; ed.store.emit(); }
      else if (d.copy) { ed.store.remove(ed.sel); ed.store.discardCheckpoint(); ed.store.emit(); ed.setSelection(S.copySrc || []); ed.toast('Drag the copy handle to place a copy'); }
      S.copySrc = null;
    }
  },
  dblclick(ed, raw) { const hit = ed.pick(raw)?.e; if (hit) enterNodeEdit(ed, hit); },
  onKey(ed, key) {
    const S = ed.state;
    if (key === 'Enter' && ed.sel.size === 1 && !S.node) { enterNodeEdit(ed, ed.selected()[0]); return true; }
    if ((key === 'Delete' || key === 'Backspace') && S.node && S.node.sel != null) {
      const e = ed.store.byId(S.node.id);
      if (e && e.type === 'poly') { const min = e.closed ? 3 : 2; if (e.pts.length <= min) { ed.toast(`A path needs at least ${min} points`); return true; } ed.store.change(() => e.pts.splice(S.node.sel, 1)); S.node.sel = null; return true; }
    }
    return false;
  },
  cancel(ed) { if (ed.state.node) { ed.state.node = null; ed.state.ndrag = null; ed.changed('prompt'); return true; } return false; },
  cursor(ed, sp) {
    const S = ed.state; if (S.drag || S.hdrag || S.ndrag || S.box) return 'default';
    const h: any = S.node ? hitNode(ed, sp) : hitHandle(ed, sp);
    if (!h) return 'default';
    if (h.k === 'rot') return 'grab';
    if (h.k === 'scale') return h.fx * h.fy > 0 ? 'nesw-resize' : h.fx * h.fy < 0 ? 'nwse-resize' : h.fx ? 'ew-resize' : 'ns-resize';
    return 'pointer';
  },
  overlay(ed, o) {
    const S = ed.state;
    if (S.drag?.moved) { o.hide(ed.sel); const A = affMove(sub(S.drag.to, S.drag.from)); for (const e of ed.selected()) o.ghost(affEnt(e as Shape, A), 'selected'); o.label(`Δ ${fmt(S.drag.to.x - S.drag.from.x, 3)}, ${fmt(S.drag.to.y - S.drag.from.y, 3)}`, S.drag.to); return; }
    if (S.hdrag?.tx) { o.hide(ed.sel); for (const e of ed.selected()) o.ghost(affEnt(e as Shape, S.hdrag.tx.A), 'selected'); o.label(S.hdrag.tx.label, ed.cur); return; }
    if (S.ndrag?.preview) { o.hide([S.ndrag.id]); o.ghost(S.ndrag.preview, 'selected'); }
    if (S.box) o.custom((ctx, ed2, C) => {
      const a = ed2.w2s(S.box.a), b = ed2.w2s(S.box.b), crossing = S.box.b.x < S.box.a.x;
      ctx.setLineDash(crossing ? [5, 4] : []); ctx.strokeStyle = C['--accent']; ctx.lineWidth = 1; ctx.globalAlpha = .12; ctx.fillStyle = C['--accent']; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.globalAlpha = 1; ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.setLineDash([]);
    });
    o.highlight(ed.sel, 'selected');
    if (S.node) {
      const e = ed.store.byId(S.node.id); if (!e) return; const ee = S.ndrag?.preview || e;
      o.custom((ctx, ed2, C) => {
        for (const h of nodeHandles(ed2, ee)) {
          const s = ed2.w2s(h.p); ctx.lineWidth = 1.5; ctx.beginPath();
          if (h.k === 'add') { ctx.strokeStyle = C['--muted']; ctx.moveTo(s.x - 4, s.y); ctx.lineTo(s.x + 4, s.y); ctx.moveTo(s.x, s.y - 4); ctx.lineTo(s.x, s.y + 4); ctx.stroke(); continue; }
          const col = h.role === 'start' ? C['--node-start'] : h.role === 'end' ? C['--node-end'] : (h.k === 'v' ? C['--node'] : C['--accent']);
          ctx.fillStyle = (S.node.sel === h.i && h.k === 'v') ? col : C['--sheet']; ctx.strokeStyle = col;
          if (['v', 'a0', 'a1', 'p1', 'p2'].includes(h.k)) ctx.arc(s.x, s.y, 5, 0, TAU);
          else if (h.k === 'c') ctx.rect(s.x - 5, s.y - 5, 10, 10);
          else { ctx.moveTo(s.x, s.y - 6); ctx.lineTo(s.x + 6, s.y); ctx.lineTo(s.x, s.y + 6); ctx.lineTo(s.x - 6, s.y); ctx.closePath(); }
          ctx.fill(); ctx.stroke();
        }
      });
      return;
    }
    const H = handles(ed); if (!H.length) return;
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
