/** Canvas renderer: sheet, grid, entities, tool overlay, snap marker and cursor. */
import { splineSegs } from '../geometry/spline';
import { type Point, P, TAU } from '../geometry/vec';
import type { Editor } from '../editor/editor';
import type { Overlay, GhostStyle } from '../editor/tool';
import { isoDx } from '../snap/grid';
import { COLORS, PAINTS, modeOf, sheetX, type Entity, type Shape } from '../model/types';
import { hasBulge, segsOf } from '../geometry/path';
import { keypoints , ext } from '../geometry/entity';
const isClosed = (e: Shape) => e.type === 'circle' || e.type === 'ellipse' || e.type === 'text' || ((e.type === 'poly' || e.type === 'spline') && e.closed);

const TOKENS = ['--desk', '--sheet', '--grid', '--grid-major', '--ink', '--sel', '--snap', '--muted', '--accent', '--shadow', '--node-start', '--node-end', '--node', '--source', ...Object.values(COLORS).map(c => c.tok)];
const SNAP_NAMES: Record<string, string> = { end: 'Endpoint', mid: 'Midpoint', centre: 'Centre', quad: 'Quadrant', inter: 'Intersection', nearest: 'Nearest', perp: 'Perpendicular', tangent: 'Tangent', close: 'Close shape' };

export class Renderer {
  colors: Record<string, string> = {};
  font = 'sans-serif';
  private queued = false;
  ctx: CanvasRenderingContext2D;
  constructor(public canvas: HTMLCanvasElement, public ed: Editor) {
    this.ctx = canvas.getContext('2d')!;
    this.readColors();
  }
  readColors() {
    const cs = getComputedStyle(document.documentElement);
    for (const t of TOKENS) this.colors[t] = cs.getPropertyValue(t).trim() || '#888';
    this.font = getComputedStyle(document.body).fontFamily || 'sans-serif';
  }
  resize() {
    const r = this.canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ed.setSize(r.width, r.height);
  }
  request() { if (this.queued) return; this.queued = true; requestAnimationFrame(() => { this.queued = false; this.draw(); }); }

  private path(e: Shape) { this.ctx.beginPath(); this.trace(e); }
  /** Add a shape's outline to the current canvas path (text adds every letter). */
  private trace(e: Shape) {
    const ctx = this.ctx, ed = this.ed, k = ed.view.k;
    if (e.type === 'text') { for (const s of ext.textShapes(e)) this.trace(s); return; }
    if (e.type === 'line') { const A = ed.w2s(e.a), B = ed.w2s(e.b); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); }
    else if (e.type === 'poly' && hasBulge(e)) {
      const s0 = ed.w2s(e.pts[0]); ctx.moveTo(s0.x, s0.y);
      for (const s of segsOf(e)) {
        if (s.kind === 'seg') { const b = ed.w2s(s.b); ctx.lineTo(b.x, b.y); }
        else { const c = ed.w2s(s.c); ctx.arc(c.x, c.y, s.r * k, -s.start, -(s.start + s.sweep), s.sweep > 0); }
      }
      if (e.closed) ctx.closePath();
    }
    else if (e.type === 'poly') { e.pts.forEach((p, i) => { const s = ed.w2s(p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }); if (e.closed) ctx.closePath(); }
    else if (e.type === 'circle') { const c = ed.w2s(e.c); ctx.arc(c.x, c.y, e.r * k, 0, TAU); }
    else if (e.type === 'spline') { const segs = splineSegs(e); if (segs.length) { const a = ed.w2s(segs[0][0]); ctx.moveTo(a.x, a.y); for (const b of segs) { const p1 = ed.w2s(b[1]), p2 = ed.w2s(b[2]), p3 = ed.w2s(b[3]); ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y); } if (e.closed) ctx.closePath(); } }
    else if (e.type === 'ellipse') { const c = ed.w2s(e.c); ctx.ellipse(c.x, c.y, e.rx * k, e.ry * k, -e.rot, 0, TAU); }
    else if (e.type === 'arc') { const c = ed.w2s(e.c); ctx.arc(c.x, c.y, e.r * k, -e.a0, -e.a1, true); }
  }
  stroke(e: Shape, color: string, lw: number, dash?: number[]) {
    const ctx = this.ctx, ed = this.ed; ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.setLineDash(dash || []);
    if (e.type === 'dim') {
      const g = ed.dimGeom(e as any); ctx.beginPath();
      for (const [a, b] of g.lines) { const A = ed.w2s(a), B = ed.w2s(b); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); } ctx.stroke();
      const tp = ed.w2s(g.text.p); ctx.save(); ctx.translate(tp.x, tp.y); ctx.rotate(-g.text.ang); ctx.fillStyle = color;
      ctx.font = `${Math.max(7, g.text.h * ed.view.k)}px ${this.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillText(g.text.str, 0, 0); ctx.restore(); return;
    }
    this.path(e); ctx.stroke();
  }
  label(txt: string, at: Point, color?: string) {
    const ctx = this.ctx, s = this.ed.w2s(at); ctx.font = `12px ${this.font}`; const tw = ctx.measureText(txt).width;
    ctx.fillStyle = this.colors['--sheet']; ctx.globalAlpha = .92; ctx.fillRect(s.x + 14, s.y + 10, tw + 10, 18); ctx.globalAlpha = 1;
    ctx.fillStyle = color || this.colors['--accent']; ctx.textAlign = 'left'; ctx.fillText(txt, s.x + 19, s.y + 23);
  }

  draw() {
    const ed = this.ed, ctx = this.ctx, C = this.colors, { w, h } = ed.doc.page, k = ed.view.k, A = ed.doc.aids, W = ed.view.W, H = ed.view.H;
    // collect overlay from the active tool
    const ghosts: { s: Shape; style: GhostStyle }[] = [], hidden = new Set<string>(), hi = new Map<string, string>(), labels: { t: string; at: Point }[] = [], customs: ((c: CanvasRenderingContext2D, e: Editor, col: Record<string, string>) => void)[] = [];
    const o: Overlay = {
      ghost: (s, style = 'preview') => ghosts.push({ s, style }), hide: ids => { for (const i of ids) hidden.add(i); },
      highlight: (ids, style = 'selected') => { for (const i of ids) hi.set(i, style); }, label: (t, at) => labels.push({ t, at: at || ed.cursorPoint() }), custom: fn => customs.push(fn),
    };
    ed.tool.overlay?.(ed, o);

    ctx.setLineDash([]); ctx.fillStyle = C['--desk']; ctx.fillRect(0, 0, W, H);
    const nSheets = Math.max(1, ed.doc.sheets || 1);
    for (let sk = 0; sk < nSheets; sk++) {
      const sx = sheetX(ed.doc, sk), tl = ed.w2s(P(sx, h));
      ctx.save(); ctx.shadowColor = C['--shadow']; ctx.shadowBlur = 14; ctx.shadowOffsetY = 2; ctx.fillStyle = C['--sheet']; ctx.fillRect(tl.x, tl.y, w * k, h * k); ctx.restore();
      if (A.grid.show) { ctx.save(); ctx.beginPath(); ctx.rect(tl.x, tl.y, w * k, h * k); ctx.clip(); drawGrid(ctx, ed, sx, w, h, k, C); ctx.restore(); }
      if (nSheets > 1) { ctx.save(); ctx.fillStyle = C['--muted'] || '#666'; ctx.font = '600 12px system-ui, sans-serif'; ctx.textBaseline = 'bottom'; ctx.fillText(`Sheet ${sk + 1}`, tl.x, tl.y - 4); ctx.restore(); }
    }
    // tools that keep something painted on the sheet (Hinge brush areas) draw it under the drawing
    for (const t of Object.values(ed.tools)) t.underlay?.(ctx, ed, C);
    const or = ed.w2s(P(0, 0)); ctx.strokeStyle = C['--accent']; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(or.x, or.y); ctx.lineTo(or.x + 18, or.y); ctx.moveTo(or.x, or.y); ctx.lineTo(or.x, or.y - 18); ctx.stroke();

    // paint-bucket fills first, see-through, so every line stays on top
    const alpha = Math.max(0.05, Math.min(1, (+ed.opt.fillOpacity || 45) / 100));
    for (const e of ed.doc.ents as Entity[]) {
      if (e.type !== 'fill' || !ed.store.visible(e) || hidden.has(e.id)) continue;
      ctx.beginPath(); for (const r of e.rings) r.forEach((p, i) => { const s = ed.w2s(p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }), ctx.closePath();
      ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = PAINTS[e.paint]?.hex || '#ddd'; ctx.fill('evenodd'); ctx.restore();
      if (hi.get(e.id)) { ctx.save(); ctx.setLineDash([6, 3]); ctx.lineWidth = 2; ctx.strokeStyle = C['--sel']; ctx.stroke(); ctx.restore(); }
    }
    for (const e of ed.doc.ents as Entity[]) {
      if (!ed.store.visible(e) || hidden.has(e.id) || e.type === 'fill') continue;
      const base = C[COLORS[e.color]?.tok] || COLORS[e.color]?.hex || C['--ink'], mode = modeOf(ed.doc, e.color);
      const st = hi.get(e.id), col = st === 'selected' ? C['--sel'] : st === 'source' ? C['--source'] : base;
      // "Engrave area" colours show their area lightly filled; "Don't cut" colours are drawn faint
      if (mode === 'fill' && e.type !== 'dim' && isClosed(e as Shape)) { this.path(e as Shape); ctx.save(); ctx.globalAlpha = .22; ctx.fillStyle = base; ctx.fill('evenodd'); ctx.restore(); }
      if (mode === 'off' && !st && e.type !== 'dim') { ctx.save(); ctx.globalAlpha = .4; this.stroke(e as Shape, col, 1, [2, 3]); ctx.restore(); continue; }
      // selected text: a thin solid line in the selection colour (dashes make small letters hard to read)
      if (st && e.type === 'text') this.stroke(e as Shape, col, Math.max(1.1, e.w * k), undefined);
      else this.stroke(e as Shape, col, Math.max(1.1, e.w * k) + (st ? 1 : 0), st ? [6, 3] : undefined);
    }
    for (const g of ghosts) g.style === 'remove' ? (ctx.globalAlpha = .28, this.stroke(g.s, C['--bad'], 10), ctx.globalAlpha = 1, this.stroke(g.s, C['--sheet'], 2, [4, 4])) : this.stroke(g.s, g.style === 'selected' ? C['--sel'] : g.style === 'source' ? C['--source'] : C['--accent'], g.style === 'selected' ? 1.5 : 1.3, g.style === 'selected' ? undefined : [5, 4]);
    // open ends (gaps) of selected lines/arcs/open paths
    if (ed.sel.size) { ctx.setLineDash([]); ctx.strokeStyle = C['--bad']; ctx.lineWidth = 2; for (const p of ed.openEndsOfSel()) { const s = ed.w2s(p); ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, TAU); ctx.stroke(); } }
    for (const fn of customs) { ctx.save(); fn(ctx, ed, C); ctx.restore(); }
    for (const l of labels) this.label(l.t, l.at);

    // snap points of shapes under the cursor (so centres and N/E/S/W points are easy to find)
    const drawingNow = ed.tool.draws || ed.state.drag || ed.state.hdrag || ed.state.ndrag;
    if (ed.hover && drawingNow && ed.doc.aids.attach.on) {
      ctx.setLineDash([]); ctx.lineWidth = 1; ctx.strokeStyle = C['--muted']; ctx.globalAlpha = .75;
      for (const e of ed.nearEntities(ed.cur)) for (const kp of keypoints(e as Shape)) {
        const s = ed.w2s(kp.p); ctx.beginPath();
        if (kp.k === 'centre') { ctx.arc(s.x, s.y, 3.5, 0, TAU); ctx.moveTo(s.x - 6, s.y); ctx.lineTo(s.x + 6, s.y); ctx.moveTo(s.x, s.y - 6); ctx.lineTo(s.x, s.y + 6); }
        else if (kp.k === 'quad') { ctx.moveTo(s.x, s.y - 4); ctx.lineTo(s.x + 4, s.y); ctx.lineTo(s.x, s.y + 4); ctx.lineTo(s.x - 4, s.y); ctx.closePath(); }
        else if (kp.k === 'mid') { ctx.moveTo(s.x, s.y - 4); ctx.lineTo(s.x + 4, s.y + 3); ctx.lineTo(s.x - 4, s.y + 3); ctx.closePath(); }
        else ctx.rect(s.x - 3, s.y - 3, 6, 6);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // alignment guides
    if (ed.hover && ed.snapRes?.guides) {
      ctx.setLineDash([4, 4]); ctx.strokeStyle = C['--snap']; ctx.lineWidth = 1;
      for (const g of ed.snapRes.guides) { const a = ed.w2s(g.from), b = ed.w2s(g.to); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(a.x - 3, a.y - 3); ctx.lineTo(a.x + 3, a.y + 3); ctx.moveTo(a.x + 3, a.y - 3); ctx.lineTo(a.x - 3, a.y + 3); ctx.stroke(); ctx.setLineDash([4, 4]); }
      ctx.setLineDash([]);
    }
    // snap marker
    const cur = ed.cursorPoint(), sp = ed.w2s(cur), sk = ed.snapRes?.k;
    if (sk && SNAP_NAMES[sk]) {
      ctx.strokeStyle = C['--snap']; ctx.lineWidth = 2; ctx.setLineDash([]); ctx.beginPath(); const r = 6;
      if (sk === 'end') ctx.rect(sp.x - r, sp.y - r, 2 * r, 2 * r);
      else if (sk === 'mid') { ctx.moveTo(sp.x, sp.y - r); ctx.lineTo(sp.x + r, sp.y + r); ctx.lineTo(sp.x - r, sp.y + r); ctx.closePath(); }
      else if (sk === 'centre') ctx.arc(sp.x, sp.y, r, 0, TAU);
      else if (sk === 'close') { ctx.strokeStyle = C['--ok']; ctx.lineWidth = 2.5; ctx.arc(sp.x, sp.y, r + 3, 0, TAU); ctx.moveTo(sp.x + 3.5, sp.y); ctx.arc(sp.x, sp.y, 3.5, 0, TAU); }
      else if (sk === 'quad') { ctx.moveTo(sp.x, sp.y - r); ctx.lineTo(sp.x + r, sp.y); ctx.lineTo(sp.x, sp.y + r); ctx.lineTo(sp.x - r, sp.y); ctx.closePath(); }
      else if (sk === 'perp') { ctx.moveTo(sp.x - r, sp.y + r); ctx.lineTo(sp.x + r, sp.y + r); ctx.moveTo(sp.x - r + 2, sp.y + r); ctx.lineTo(sp.x - r + 2, sp.y - r); }
      else if (sk === 'tangent') { ctx.arc(sp.x, sp.y, r - 1, 0, TAU); ctx.moveTo(sp.x - r - 3, sp.y - r + 1); ctx.lineTo(sp.x + r + 3, sp.y - r + 1); }
      else if (sk === 'nearest') { ctx.moveTo(sp.x - r, sp.y - r); ctx.lineTo(sp.x + r, sp.y + r); ctx.lineTo(sp.x - r, sp.y + r); ctx.lineTo(sp.x + r, sp.y - r); ctx.closePath(); }
      else { ctx.moveTo(sp.x - r, sp.y - r); ctx.lineTo(sp.x + r, sp.y + r); ctx.moveTo(sp.x + r, sp.y - r); ctx.lineTo(sp.x - r, sp.y + r); }
      ctx.stroke(); ctx.font = `11px ${this.font}`; ctx.fillStyle = C['--snap']; ctx.textAlign = 'left'; ctx.fillText(SNAP_NAMES[sk], sp.x + 10, sp.y - 10);
    }
    if (ed.hover && ed.tool.id !== 'select') {
      ctx.setLineDash([]); ctx.strokeStyle = C['--muted']; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(sp.x - 14, sp.y + .5); ctx.lineTo(sp.x + 14, sp.y + .5); ctx.moveTo(sp.x + .5, sp.y - 14); ctx.lineTo(sp.x + .5, sp.y + 14); ctx.stroke();
      if (A.attach.on && ed.tool.draws) { const b = A.attach.box; ctx.strokeRect(sp.x - b / 2 + .5, sp.y - b / 2 + .5, b, b); }
    }
  }
}

/**
 * The background grid on one sheet (already clipped to the sheet). Lines (or dots) every `spacing` mm,
 * with every fifth one darker; spacing doubles while the marks would be closer than about 6 px.
 */
function drawGrid(ctx: CanvasRenderingContext2D, ed: Editor, sx: number, w: number, h: number, k: number, C: Record<string, string>) {
  const G = ed.doc.aids.grid, st = G.style || 'lines';
  let g = G.spacing; while (g * k < (st === 'dots' || st === 'isodots' ? 8 : 6)) g *= 2;
  // only the part of the sheet that is on screen
  const a = ed.s2w(P(0, ed.view.H)), b = ed.s2w(P(ed.view.W, 0));
  const x0 = Math.max(sx, a.x), x1 = Math.min(sx + w, b.x), y0 = Math.max(0, a.y), y1 = Math.min(h, b.y);
  if (x1 < x0 || y1 < y0) return;
  const major = (n: number) => Math.round(n) % 5 === 0;
  const line = (p: Point, q: Point, maj: boolean) => { const u = ed.w2s(p), v = ed.w2s(q); ctx.strokeStyle = maj ? C['--grid-major'] : C['--grid']; ctx.beginPath(); ctx.moveTo(u.x, u.y); ctx.lineTo(v.x, v.y); ctx.stroke(); };
  const dot = (p: Point, maj: boolean) => { const u = ed.w2s(p), r = maj ? 1.6 : 1.1; ctx.fillStyle = maj ? C['--grid-major'] : C['--grid']; ctx.fillRect(u.x - r, u.y - r, r * 2, r * 2); };
  ctx.lineWidth = 1;
  if (st === 'lines' || st === 'dots') {
    const i0 = Math.ceil((x0 - sx) / g - 1e-9), i1 = Math.floor((x1 - sx) / g + 1e-9), j0 = Math.ceil(y0 / g - 1e-9), j1 = Math.floor(y1 / g + 1e-9);
    if (st === 'lines') {
      for (let i = i0; i <= i1; i++) { const s = ed.w2s(P(sx + i * g, 0)), X = Math.round(s.x) + .5; ctx.strokeStyle = major(i) ? C['--grid-major'] : C['--grid']; ctx.beginPath(); ctx.moveTo(X, ed.w2s(P(0, h)).y); ctx.lineTo(X, ed.w2s(P(0, 0)).y); ctx.stroke(); }
      for (let j = j0; j <= j1; j++) { const s = ed.w2s(P(0, j * g)), Y = Math.round(s.y) + .5; ctx.strokeStyle = major(j) ? C['--grid-major'] : C['--grid']; ctx.beginPath(); ctx.moveTo(ed.w2s(P(sx, 0)).x, Y); ctx.lineTo(ed.w2s(P(sx + w, 0)).x, Y); ctx.stroke(); }
    } else for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) dot(P(sx + i * g, j * g), major(i) && major(j));
    return;
  }
  if (st === 'iso' || st === 'isodots') {
    // the same points the grid lock uses: measured from the drawing's origin, upright columns isoDx apart
    const dx = isoDx(g), i0 = Math.floor(x0 / dx) - 1, i1 = Math.ceil(x1 / dx) + 1;
    if (st === 'isodots') {
      for (let i = i0; i <= i1; i++) { const off = (((i % 2) + 2) % 2) * g / 2; for (let j = Math.floor((y0 - off) / g); j <= Math.ceil((y1 - off) / g); j++) dot(P(i * dx, j * g + off), major(i) && major(j)); }
      return;
    }
    for (let i = i0; i <= i1; i++) line(P(i * dx, y0), P(i * dx, y1), major(i));
    // lines at +30° and −30°: y = ±x/√3 + n·g
    const t = 1 / Math.sqrt(3);
    for (const sgn of [1, -1]) {
      const c0 = Math.min(y0 - sgn * t * x0, y0 - sgn * t * x1), c1 = Math.max(y1 - sgn * t * x0, y1 - sgn * t * x1);
      for (let n = Math.floor(c0 / g); n <= Math.ceil(c1 / g); n++) { const c = n * g; line(P(x0, sgn * t * x0 + c), P(x1, sgn * t * x1 + c), major(n)); }
    }
    return;
  }
  // circles: rings every g from the middle of the sheet, spokes every few degrees
  const c = P(sx + w / 2, h / 2), cs = ed.w2s(c), R = Math.hypot(w, h) / 2, sp = Math.max(1, G.spokes || 15);
  for (let n = 1; n * g <= R; n++) { ctx.strokeStyle = major(n) ? C['--grid-major'] : C['--grid']; ctx.beginPath(); ctx.arc(cs.x, cs.y, n * g * k, 0, Math.PI * 2); ctx.stroke(); }
  for (let d = 0, n = 0; d < 360 - 1e-9; d += sp, n++) { const r = d * Math.PI / 180; line(c, P(c.x + R * Math.cos(r), c.y + R * Math.sin(r)), d % 90 === 0); }
}
