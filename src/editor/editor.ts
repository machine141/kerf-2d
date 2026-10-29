/**
 * Editor: owns the document store, selection, view, the active tool and all
 * input routing. It has no DOM dependencies, so it runs headless in tests.
 */
import { type Point, P, add, sub, angOf, len, DEG, cp, normA, dist, fmt } from '../geometry/vec';
import { prims, flatten, bbox as shapeBox, unionBox, boxCentre, type Box, type Prim } from '../geometry/entity';
import { affEnt, affMove, affScale, type Affine } from '../geometry/affine';
import { dimGeom } from '../geometry/dims';
import { joinPieces, arcBulge, type Piece } from '../geometry/path';
import { explodePath, pieceToShape } from '../geometry/trim';
import { booleanShapes, isClosedShape, areaOf, type BoolOp } from '../geometry/boolean';
import { snapPoint, type SnapResult } from '../snap/snap';
import { DocStore } from '../model/document';
import type { Entity, Shape } from '../model/types';
import type { Tool, PointerInfo } from './tool';

export type CoordMode = 'abs' | 'rel' | 'pol';
export type ChangeKind = 'doc' | 'sel' | 'tool' | 'prompt' | 'view' | 'aids' | 'opts';

export const DEFAULT_OPTS: Record<string, any> = {
  rectFrom: 'corner', circFrom: 'centre', arcMode: '3pt', filletMode: 'fillet', filletR: 5, filletFollow: false, fixedR: '', dimMode: 'a', rotAngle: 60, rotCopies: 5, moveCopy: false, mirKeep: false, polySides: 6, polyMeasure: 'corner', polyStar: false, polyInner: 50, splineClosed: false, spFrom: 'centre', spKind: 'even', spTurns: 4, spInner: 0, spDir: 'ccw', mirStep: 15, arrType: 'grid', arrCols: 4, arrRows: 1, arrDx: 20, arrDy: 20, arrFollow: true, arrCount: 6, arrAngle: 360, arrRotate: true, gridScale: 0, gridSym: '1', gridClose: true, gridFill: true, circScale: 0, circSym: '1', circClose: true, circFill: true,
  offMode: 'shape', offSide: 'auto', offD: 5, offRound: '1', offCount: 1, offFollow: false, offJoin: true, trimMode: 'whole', joinTol: 0.05, pickPx: 14, eraseR: 15, eraseSmall: true, eraseMax: 5, ringD: 10, ringHole: 5, ringOverlap: 2, lockAspect: false,
  txtFont: 'arimo', txtSize: 10, txtSpacing: 0, txtAlign: 'left', txtEffect: 'rainbow', txtSide: 'above', txtFit: false,
  hbMode: 'area', hbPattern: 'straight', hbR: 12, hbOver: false, hbPitch: 2.5, hbSlit: 15, hbBridge: 3, hbEdge: 3, hbPreview: true, hbAngle: '', hbFollow: false,
};

export class Editor {
  store = new DocStore();
  view = { k: 2, ox: 0, oy: 0, W: 800, H: 600 };
  sel = new Set<string>();
  tools: Record<string, Tool> = {};
  tool!: Tool;
  pts: Point[] = [];
  cur = P(0, 0);
  snapRes: SnapResult | null = null;
  rel = P(0, 0);
  mods = { shift: false, alt: false, ctrl: false };
  cmode: CoordMode = 'abs';
  hover = false;
  /** recently touched snap points (for alignment guides) */
  track: Point[] = [];
  opt: Record<string, any> = { ...DEFAULT_OPTS };
  /** scratch space for the active tool */
  state: Record<string, any> = {};
  /** goes up every time the drawing changes (for caches) */
  ver = 0;
  /** Opens the on-canvas text box for a text object (set by the UI; absent in tests). */
  textEditor: ((id: string, isNew: boolean) => void) | null = null;
  private listeners = new Map<string, Set<(k: ChangeKind) => void>>();
  private pan: { sp: Point; ox: number; oy: number } | null = null;

  constructor(tools: Tool[]) {
    for (const t of tools) this.tools[t.id] = t;
    this.tool = tools[0];
    this.store.on(() => {
      // the hinge slits made from painted areas were all deleted: the paint goes with them
      const d = this.doc; if (d.hingeMade && !d.ents.some(e => e.gen === 'hinge')) { d.hinge = []; d.hingeMade = false; this.state.hbSel = null; }
      this.ver++; for (const id of [...this.sel]) if (!this.store.byId(id)) this.sel.delete(id); this.syncTextPaths(); this.changed('doc'); });
  }

  // ---- events ----
  on(fn: (k: ChangeKind) => void) { const s = this.listeners.get('*') || new Set(); s.add(fn); this.listeners.set('*', s); return () => s.delete(fn); }
  changed(k: ChangeKind) { for (const f of this.listeners.get('*') || []) f(k); }
  toast(msg: string) { for (const f of this.listeners.get('toast') || []) (f as any)(msg); }
  onToast(fn: (m: string) => void) { const s = this.listeners.get('toast') || new Set(); s.add(fn as any); this.listeners.set('toast', s); }

  // ---- document helpers ----
  get doc() { return this.store.doc; }
  dimGeom(e: Extract<Entity, { type: 'dim' }>) { return dimGeom(e, this.doc.dim); }
  /** Primitives including dimension lines (used for picking and trimming against). */
  /** Text on a path follows that path: copy its current shape in (or let go if the path was deleted). */
  syncTextPaths() {
    for (const t of this.doc.ents) {
      if (t.type !== 'text' || !t.path?.ref) continue;
      const p = this.store.byId(t.path.ref);
      if (!p || p.type === 'text' || p.type === 'dim') { delete t.path.ref; continue; }
      const { id, layer, color, w, group, ...g } = p as any; void id; void layer; void color; void w; void group;
      if (JSON.stringify(g) !== JSON.stringify(t.path.geom)) t.path.geom = structuredClone(g);
    }
  }
  geomPrims(e: Entity | Shape): Prim[] { return e.type === 'dim' ? dimGeom(e as any, this.doc.dim).lines.map(([a, b]) => ({ t: 'seg', a, b }) as Prim) : prims(e as Shape); }
  bbox(e: Entity | Shape): Box { return shapeBox(e as Shape, (x: any) => dimGeom(x, this.doc.dim)); }
  selected(): Entity[] { return [...this.sel].map(id => this.store.byId(id)).filter(Boolean) as Entity[]; }
  selBox(): Box | null { return unionBox(this.selected().map(e => this.bbox(e))); }
  setSelection(ids: Iterable<string>) { this.sel = new Set(ids); this.changed('sel'); }

  /** Nearest object within tolPx screen pixels (default: the "Click reach" setting). */
  pick(raw: Point, tolPx?: number, filter?: (e: Entity) => boolean): { e: Entity; d: number; pr: Prim } | null {
    const tol = (tolPx ?? (+this.opt.pickPx || 14)) / this.view.k; let best: { e: Entity; d: number; pr: Prim } | null = null;
    const ents = this.doc.ents;
    for (let i = ents.length - 1; i >= 0; i--) {
      const e = ents[i]; if (!this.store.usable(e) || (filter && !filter(e))) continue;
      const b = this.bbox(e); if (raw.x < b.x0 - tol || raw.x > b.x1 + tol || raw.y < b.y0 - tol || raw.y > b.y1 + tol) continue;
      // text: a click anywhere over the word picks it (not just on a letter's edge)
      if (e.type === 'text' && raw.x >= b.x0 && raw.x <= b.x1 && raw.y >= b.y0 && raw.y <= b.y1 && (!best || best.d > tol * 0.5)) best = { e, d: tol * 0.5, pr: { t: 'seg', a: raw, b: raw } };
      for (const pr of this.geomPrims(e)) {
        const q = pr.t === 'seg' ? segDist(raw, pr.a, pr.b) : arcDist(raw, pr);
        if (q <= tol && (!best || q < best.d - 1e-9)) best = { e, d: q, pr };
      }
    }
    return best;
  }

  snapAt(raw: Point, o: { exclude?: Set<string>; drawing?: boolean } = {}): SnapResult {
    // closing a shape: the first point of the line / spline being drawn pulls the cursor in
    if (this.tool.closes && this.pts.length >= 2 && dist(raw, this.pts[0]) <= Math.max(14, +this.opt.pickPx || 14) / this.view.k) return { p: this.pts[0], k: 'close' };
    return snapPoint(raw, {
      ents: this.doc.ents, visible: this.store.visible, aids: this.doc.aids, k: this.view.k,
      last: this.pts[this.pts.length - 1], constrain45: this.mods.shift && !!this.tool.constrain45,
      drawing: o.drawing ?? !!this.tool.draws, exclude: o.exclude, track: this.track,
    });
  }
  /** Current cursor position after snapping (what a click would locate). */
  cursorPoint() { return this.snapRes ? this.snapRes.p : this.cur; }

  // ---- tools ----
  setTool(id: string) {
    const t = this.tools[id]; if (!t) return false;
    if (t.needsSelection && !this.sel.size) { this.toast(`Select objects first, then choose ${t.label.toLowerCase()}`); return false; }
    this.tool.deactivate?.(this);
    this.tool = t; this.pts = []; this.state = {}; this.track = [];
    t.activate?.(this);
    this.changed('tool'); return true;
  }
  locate(p: Point) {
    p = cp(p);
    if (this.tool.located) this.tool.located(this, p);
  }
  typedPoint(mode: CoordMode, a: number, b: number): Point {
    if (mode === 'abs') return P(a, b);
    if (mode === 'rel') return add(this.rel, P(a, b));
    return add(this.rel, P(a * Math.cos(b * DEG), a * Math.sin(b * DEG)));
  }
  typed(mode: CoordMode, a: number, b: number): boolean {
    if (!this.tool.draws) { this.toast('Choose a drawing tool, then type coordinates'); return false; }
    const p = this.typedPoint(mode, a, b); this.cur = p; this.snapRes = { p, k: null }; this.locate(p); return true;
  }
  /** Remember snap points the cursor has touched, for alignment guides (most recent first, max 3). */
  acquire() {
    const s = this.snapRes; if (!s || !s.k || !['end', 'mid', 'centre', 'quad', 'inter', 'tangent', 'perp'].includes(s.k)) return;
    if (this.track.some(t => Math.abs(t.x - s.p.x) < 1e-9 && Math.abs(t.y - s.p.y) < 1e-9)) return;
    this.track.unshift(s.p); if (this.track.length > 3) this.track.pop();
  }
  /** Entities whose outline passes within px of the point (for showing their snap points on hover). */
  nearEntities(raw: Point, px = 14, max = 6): Entity[] {
    const tol = px / this.view.k, out: { e: Entity; d: number }[] = [];
    for (const e of this.doc.ents) {
      if (!this.store.visible(e) || e.type === 'dim') continue;
      const b = this.bbox(e); if (raw.x < b.x0 - tol || raw.x > b.x1 + tol || raw.y < b.y0 - tol || raw.y > b.y1 + tol) continue;
      let d = Infinity; for (const pr of this.geomPrims(e)) d = Math.min(d, pr.t === 'seg' ? segDist(raw, pr.a, pr.b) : arcDist(raw, pr));
      if (d <= tol) out.push({ e, d });
    }
    return out.sort((a, b) => a.d - b.d).slice(0, max).map(x => x.e);
  }
  finish() { this.tool.finish?.(this); }
  cancel() {
    this.track = [];
    if (this.tool.cancel?.(this)) return;
    if (this.tool.id !== 'select') { this.setTool('select'); return; }
    if (this.sel.size) { this.sel.clear(); this.changed('sel'); }
  }

  // ---- input (world coordinates + screen point) ----
  pointerDown(raw: Point, button: number, info: PointerInfo, spaceHeld = false) {
    this.mods = { shift: info.shift, alt: info.alt, ctrl: info.ctrl }; this.cur = raw;
    if (button === 1 || (button === 0 && spaceHeld)) { this.pan = { sp: info.sp, ox: this.view.ox, oy: this.view.oy }; return; }
    if (button === 2) { if (this.tool.rightClick?.(this)) { this.changed('view'); return; } this.tool.finish && this.pts.length ? this.tool.finish(this) : this.cancel(); return; }
    if (button === 0) this.tool.down?.(this, raw, info);
    this.changed('view');
  }
  pointerMove(raw: Point, info: PointerInfo) {
    this.mods = { shift: info.shift, alt: info.alt, ctrl: info.ctrl }; this.cur = raw; this.hover = true;
    if (this.pan) { this.view.ox = this.pan.ox - (info.sp.x - this.pan.sp.x) / this.view.k; this.view.oy = this.pan.oy + (info.sp.y - this.pan.sp.y) / this.view.k; this.changed('view'); return; }
    this.snapRes = this.tool.draws ? this.snapAt(raw) : null;
    this.tool.move?.(this, raw, info);
    this.acquire();
    this.changed('view');
  }
  pointerUp(raw: Point, info: PointerInfo) {
    this.mods = { shift: info.shift, alt: info.alt, ctrl: info.ctrl };
    if (this.pan) { this.pan = null; return; }
    this.tool.up?.(this, raw, info);
    this.changed('view');
  }
  dblclick(raw: Point, info: PointerInfo) { this.tool.dblclick?.(this, raw, info); }
  /** returns true if consumed by the tool; otherwise caller zooms/pans */
  wheelTool(dir: 1 | -1, info: PointerInfo) { return !!this.tool.wheel?.(this, dir, info); }

  // ---- operations on the selection ----
  /** copies=0 transforms in place; 1 adds a transformed copy. Returns ids made. */
  transformSel(A: Affine, copies = 0, keepSel = false): string[] {
    const made: string[] = [], groupMap = new Map<string, string>();
    for (const e of this.selected()) {
      const n = affEnt(e as Shape, A);
      if (copies) {
        const { id, ...rest } = n as any;
        if (rest.group) rest.group = rest.group.map((g: string) => groupMap.get(g) || (groupMap.set(g, 'g' + (this.doc.seq++)), groupMap.get(g)));
        made.push(this.store.add(rest as Shape, { layer: e.layer, color: e.color, w: e.w }).id);
      }
      else this.store.replace(e.id, n);
    }
    if (copies && !keepSel) this.sel = new Set(made);
    return made;
  }
  deleteSel() { if (!this.sel.size) return; this.store.change(() => this.store.remove(this.sel)); this.sel.clear(); this.changed('sel'); }
  flipSel(axis: 'h' | 'v') { const b = this.selBox(); if (!b) return; const c = boxCentre(b); this.store.change(() => this.transformSel(axis === 'h' ? affScale(c, -1, 1) : affScale(c, 1, -1))); }
  moveSel(d: Point, copy = false) { this.store.change(() => this.transformSel(affMove(d), copy ? 1 : 0)); }
  /** Explode: ungroups one level if the selection is grouped, otherwise breaks paths into lines and arcs. */
  explodeSel() {
    const sel = this.selected(); if (!sel.length) return;
    if (sel.some(e => e.group?.length)) { this.ungroupSel(); return; }
    const out: string[] = [];
    this.store.change(() => { for (const e of sel) if (e.type === 'poly') out.push(...this.store.splice(e.id, explodePath(e)).map(x => x.id)); else if (e.type === 'spline') { const f = flatten(e as Shape, 0.01); out.push(...this.store.splice(e.id, [{ type: 'poly', closed: f.closed, pts: f.pts.map(cp) } as Shape]).map(x => x.id)); } else out.push(e.id); });
    this.sel = new Set(out); this.changed('sel');
  }
  /** Outermost group id of an entity. */
  groupRoot(e: Entity) { return e.group?.length ? e.group[e.group.length - 1] : null; }
  /** Expand ids so that whole outer groups are included. */
  withGroups(ids: Iterable<string>): Set<string> {
    const out = new Set(ids), roots = new Set<string>();
    for (const id of out) { const e = this.store.byId(id); const r = e && this.groupRoot(e); if (r) roots.add(r); }
    if (roots.size) for (const e of this.doc.ents) { const r = this.groupRoot(e); if (r && roots.has(r)) out.add(e.id); }
    return out;
  }
  groupSel() {
    const sel = this.selected(); if (sel.length < 2) { this.toast('Select two or more objects to group'); return; }
    const g = 'g' + (this.doc.seq++);
    this.store.change(() => { for (const e of sel) e.group = [...(e.group || []), g]; });
    this.toast(`Grouped ${sel.length} objects`);
  }
  ungroupSel() {
    const sel = this.selected().filter(e => e.group?.length); if (!sel.length) { this.toast('Nothing grouped in the selection'); return; }
    this.store.change(() => { for (const e of sel) { e.group = e.group!.slice(0, -1); if (!e.group.length) delete e.group; } });
    this.toast('Ungrouped one level');
  }
  /** After Make Path: keep showing open ends while that result stays selected. */
  endsFlag = '';
  /** Lines, arcs and open paths in the selection as path pieces. */
  private piecesOf(sel: Entity[]): Piece[] {
    return sel.map(e => e.type === 'line' ? { pts: [e.a, e.b], bulge: [0] }
      : e.type === 'arc' ? { pts: [P(e.c.x + e.r * Math.cos(e.a0), e.c.y + e.r * Math.sin(e.a0)), P(e.c.x + e.r * Math.cos(e.a1), e.c.y + e.r * Math.sin(e.a1))], bulge: [arcBulge(e.a0, e.a1)] }
      : { pts: (e as any).pts.slice(), bulge: (e as any).bulge?.slice(0, (e as any).pts.length - 1) || (e as any).pts.slice(1).map(() => 0) });
  }
  /** Ends of selected open shapes that don't meet another selected end (within the join tolerance) — i.e. gaps. */
  openEndsOfSel(): Point[] {
    const sel = this.selected().filter(e => e.type === 'line' || e.type === 'arc' || (e.type === 'poly' && !e.closed));
    if (!sel.length || sel.length > 400 || (sel.length < 2 && this.endsFlag !== [...this.sel].join())) return [];
    const ends: { p: Point; i: number }[] = [];
    this.piecesOf(sel).forEach((pc, i) => { ends.push({ p: pc.pts[0], i }, { p: pc.pts[pc.pts.length - 1], i }); });
    const tol = Math.max(1e-6, +this.opt.joinTol || 0);
    return ends.filter((a, ai) => !ends.some((b, bi) => bi !== ai && dist(a.p, b.p) < tol)).map(x => x.p);
  }
  /** Make Path: join selected lines, arcs and open paths that touch end-to-end into single paths (true arcs kept). */
  makePathSel() {
    const sel = this.selected().filter(e => e.type === 'line' || e.type === 'arc' || (e.type === 'poly' && !e.closed));
    if (sel.length < 1) { this.toast('Select lines, arcs or open paths that meet end to end'); return; }
    const tol = Math.max(1e-6, +this.opt.joinTol || 0), rep = { gapsClosed: 0, maxGap: 0 };
    const joined = joinPieces(this.piecesOf(sel), tol, rep), first = sel[0], made: string[] = [];
    if (joined.length === sel.length && !rep.gapsClosed && !joined.some(j => j.closed)) {
      this.toast(this.gapReport(joined, tol) || 'Nothing to join — these pieces do not meet end to end'); return;
    }
    this.store.change(() => {
      const idx = this.doc.ents.indexOf(first);
      this.store.remove(sel.map(e => e.id));
      for (const j of joined) {
        const s = pieceToShape(j.pts.map(p => ({ x: p.x, y: p.y })), j.closed ? j.bulge : j.bulge.slice(0, j.pts.length - 1), j.closed);
        const ent = this.store.add(s, { layer: first.layer, color: first.color, w: first.w });
        this.doc.ents.splice(this.doc.ents.indexOf(ent), 1); this.doc.ents.splice(Math.min(idx + made.length, this.doc.ents.length), 0, ent);
        made.push(ent.id);
      }
    });
    this.sel = new Set(made); this.endsFlag = made.join(); this.changed('sel');
    const closed = joined.filter(j => j.closed).length, open = joined.length - closed;
    let msg = `Made ${joined.length} path${joined.length > 1 ? 's' : ''}${closed ? ` (${closed} closed)` : ''} from ${sel.length} pieces`;
    if (rep.gapsClosed) msg += ` · closed ${rep.gapsClosed} tiny gap${rep.gapsClosed > 1 ? 's' : ''} (largest ${fmt(rep.maxGap, 3)} mm)`;
    if (open) msg += ' · ' + (this.gapReport(joined, tol) || `${open} still open — open ends are marked red`);
    this.toast(msg);
  }
  /** Describe the smallest remaining gap between open ends (bigger than the tolerance). */
  private gapReport(paths: { pts: Point[]; closed: boolean }[], tol: number): string {
    const ends = paths.filter(p => !p.closed).flatMap((p, i) => [{ p: p.pts[0], i }, { p: p.pts[p.pts.length - 1], i }]);
    let best = Infinity;
    for (let a = 0; a < ends.length; a++) for (let b = a + 1; b < ends.length; b++) { const d = dist(ends[a].p, ends[b].p); if (d >= tol && d < best) best = d; }
    if (!isFinite(best)) return '';
    return `smallest gap ${fmt(best, 3)} mm is bigger than the ${fmt(tol, 3)} mm "close gaps" setting — open ends are marked red`;
  }
  /** Union / subtract / intersect the selected closed shapes. Subtract and intersect keep the largest shape. */
  booleanSel(op: BoolOp) {
    const sel = this.selected(), closed = sel.filter(e => isClosedShape(e as Shape));
    const r = booleanShapes(op, closed as Shape[]);
    if ('error' in r) { this.toast(r.error); return; }
    const base = closed.reduce((b, e) => areaOf(e as Shape) > areaOf(b as Shape) ? e : b, closed[0]);
    const made = this.replaceWith(closed, r.shapes, base);
    const name = { union: 'Joined', subtract: 'Subtracted', intersect: 'Intersected' }[op];
    this.toast(`${name} ${closed.length} shapes → ${made.length} outline${made.length > 1 ? 's (grouped)' : ''}${sel.length > closed.length ? ` · ${sel.length - closed.length} open shape(s) ignored` : ''}`);
  }
  /** Replace entities with new shapes (attributes and group from `like`); several results are grouped. Returns new ids. */
  replaceWith(old: Entity[], shapes: Shape[], like: Entity): string[] {
    const made: string[] = [];
    this.store.change(() => {
      const idx = this.doc.ents.indexOf(like);
      this.store.remove(old.map(e => e.id));
      const g = shapes.length > 1 ? 'g' + (this.doc.seq++) : null;
      for (const sh of shapes) {
        const ent = this.store.add(sh, { layer: like.layer, color: like.color, w: like.w });
        const grp = [...(like.group || []), ...(g ? [g] : [])]; if (grp.length) ent.group = grp;
        this.doc.ents.splice(this.doc.ents.indexOf(ent), 1); this.doc.ents.splice(Math.min(Math.max(0, idx) + made.length, this.doc.ents.length), 0, ent);
        made.push(ent.id);
      }
    });
    this.sel = new Set(made); this.changed('sel');
    return made;
  }
  /**
   * Tidy: remove zero-size and duplicate objects, and join lines/arcs/open paths
   * that meet (or nearly meet, within "close gaps") into paths. Works on the
   * selection, or the whole drawing when nothing is selected.
   */
  tidySel() {
    const scope = (this.sel.size ? this.selected() : this.doc.ents.filter(this.store.usable)).filter(e => e.type !== 'dim');
    const tiny = scope.filter(e => (e.type === 'line' && dist(e.a, e.b) < 1e-6) || ((e.type === 'circle' || e.type === 'arc') && e.r < 1e-6) || (e.type === 'poly' && e.pts.length < 2));
    const seen = new Map<string, Entity>(), dup: Entity[] = [];
    for (const e of scope) { if (tiny.includes(e)) continue; const k = shapeKey(e as Shape); if (seen.has(k)) dup.push(e); else seen.set(k, e); }
    const gone = new Set([...tiny, ...dup].map(e => e.id));
    const open = scope.filter(e => !gone.has(e.id) && (e.type === 'line' || e.type === 'arc' || (e.type === 'poly' && !e.closed)));
    const tol = Math.max(1e-6, +this.opt.joinTol || 0), rep = { gapsClosed: 0, maxGap: 0 };
    const byKey = new Map<string, Entity[]>(); for (const e of open) { const k = `${e.layer}|${e.color}|${(e.group || []).join('/')}`; byKey.set(k, [...(byKey.get(k) || []), e]); }
    let joinedFrom = 0, joinedInto = 0, closedN = 0;
    this.store.change(() => {
      if (gone.size) this.store.remove([...gone]);
      for (const grp of byKey.values()) {
        if (grp.length < 2) continue;
        const res = joinPieces(this.piecesOf(grp), tol, rep);
        if (res.length === grp.length && !res.some(j => j.closed)) continue;
        joinedFrom += grp.length; joinedInto += res.length; closedN += res.filter(j => j.closed).length;
        const like = grp[0]; this.store.remove(grp.map(e => e.id));
        for (const j of res) { const ent = this.store.add(pieceToShape(j.pts, j.closed ? j.bulge : j.bulge.slice(0, j.pts.length - 1), j.closed), { layer: like.layer, color: like.color, w: like.w }); if (like.group?.length) ent.group = like.group.slice(); }
      }
    });
    this.sel = new Set(); this.changed('sel');
    const parts: string[] = [];
    if (dup.length) parts.push(`removed ${dup.length} duplicate${dup.length > 1 ? 's' : ''}`);
    if (tiny.length) parts.push(`removed ${tiny.length} zero-size object${tiny.length > 1 ? 's' : ''}`);
    if (joinedFrom) parts.push(`joined ${joinedFrom} pieces into ${joinedInto} path${joinedInto > 1 ? 's' : ''}${closedN ? ` (${closedN} closed)` : ''}`);
    if (rep.gapsClosed) parts.push(`closed ${rep.gapsClosed} gap${rep.gapsClosed > 1 ? 's' : ''} (largest ${fmt(rep.maxGap, 3)} mm)`);
    this.toast(parts.length ? 'Tidy: ' + parts.join(' · ') : 'Tidy: nothing to fix');
  }
  /** Selection split into units that move together: each outer group, or a single ungrouped object. */
  selUnits(): { ids: string[]; box: Box }[] {
    const by = new Map<string, Entity[]>();
    for (const e of this.selected()) { const k = this.groupRoot(e) || e.id; by.set(k, [...(by.get(k) || []), e]); }
    return [...by.values()].map(es => ({ ids: es.map(e => e.id), box: unionBox(es.map(e => this.bbox(e)))! }));
  }
  private moveUnit(ids: string[], v: Point) {
    if (Math.abs(v.x) < 1e-12 && Math.abs(v.y) < 1e-12) return;
    const A = affMove(cp(v)); for (const id of ids) { const e = this.store.byId(id); if (e) this.store.replace(id, affEnt(e as Shape, A)); }
  }
  /**
   * Align the selection: left / centre / right / top / middle / bottom.
   * To the selection's own bounds (2+ objects or groups), or to the sheet.
   */
  alignSel(kind: 'left' | 'hcentre' | 'right' | 'top' | 'vmiddle' | 'bottom', to: 'sel' | 'page' = 'sel') {
    const U = this.selUnits(); if (!U.length) { this.toast('Select objects to align'); return; }
    if (to === 'sel' && U.length < 2) to = 'page';
    const pg = this.doc.page, R: Box = to === 'page' ? { x0: 0, y0: 0, x1: pg.w, y1: pg.h } : unionBox(U.map(u => u.box))!;
    this.store.change(() => { for (const u of U) {
      const b = u.box, v = P(0, 0);
      if (kind === 'left') v.x = R.x0 - b.x0; else if (kind === 'right') v.x = R.x1 - b.x1; else if (kind === 'hcentre') v.x = (R.x0 + R.x1) / 2 - (b.x0 + b.x1) / 2;
      else if (kind === 'bottom') v.y = R.y0 - b.y0; else if (kind === 'top') v.y = R.y1 - b.y1; else v.y = (R.y0 + R.y1) / 2 - (b.y0 + b.y1) / 2;
      this.moveUnit(u.ids, v);
    } });
    this.toast(`Aligned ${U.length} ${U.length === 1 ? 'object' : 'objects'} ${({ left: 'left', hcentre: 'centre', right: 'right', top: 'top', vmiddle: 'middle', bottom: 'bottom' })[kind]}${to === 'page' ? ' on the sheet' : ''}`);
  }
  /** Even gaps between 3+ objects/groups, horizontally or vertically (outermost stay put). */
  distributeSel(axis: 'h' | 'v') {
    const U = this.selUnits(); if (U.length < 3) { this.toast('Select three or more objects to space evenly'); return; }
    const lo = (b: Box) => axis === 'h' ? b.x0 : b.y0, hi = (b: Box) => axis === 'h' ? b.x1 : b.y1;
    U.sort((a, b) => (lo(a.box) + hi(a.box)) - (lo(b.box) + hi(b.box)));
    const span = hi(U[U.length - 1].box) - lo(U[0].box), sizes = U.reduce((a, u) => a + hi(u.box) - lo(u.box), 0), gap = (span - sizes) / (U.length - 1);
    let at = lo(U[0].box);
    this.store.change(() => { for (const u of U) { const d = at - lo(u.box); this.moveUnit(u.ids, axis === 'h' ? P(d, 0) : P(0, d)); at += hi(u.box) - lo(u.box) + gap; } });
    this.toast(`Spaced ${U.length} objects evenly · gap ${fmt(gap, 2)} mm`);
  }
  selectAll() { this.setSelection(this.doc.ents.filter(this.store.usable).map(e => e.id)); }

  // ---- view ----
  w2s = (p: Point) => P((p.x - this.view.ox) * this.view.k, this.view.H - (p.y - this.view.oy) * this.view.k);
  s2w = (p: Point) => P(p.x / this.view.k + this.view.ox, (this.view.H - p.y) / this.view.k + this.view.oy);
  setSize(W: number, H: number) { this.view.W = W; this.view.H = H; this.changed('view'); }
  fit() { const { w, h } = this.doc.page, m = 36, V = this.view; const k = Math.min((V.W - m * 2) / w, (V.H - m * 2) / h); V.k = k > 0 ? k : 1; V.ox = -(V.W / V.k - w) / 2; V.oy = -(V.H / V.k - h) / 2; this.changed('view'); }
  zoomAt(sp: Point, f: number) { const b = this.s2w(sp); this.view.k = Math.min(400, Math.max(0.05, this.view.k * f)); const a = this.s2w(sp); this.view.ox += b.x - a.x; this.view.oy += b.y - a.y; this.changed('view'); }
  panBy(dx: number, dy: number) { this.view.ox += dx / this.view.k; this.view.oy -= dy / this.view.k; this.changed('view'); }

  // ---- readout helpers ----
  readout() { const p = this.cursorPoint(), r = sub(p, this.rel); return { p, r, dist: len(r), ang: normA(angOf(P(0, 0), r)) / DEG }; }
}

function segDist(p: Point, a: Point, b: Point) { const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy; let t = L ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)); }
function arcDist(p: Point, pr: Extract<Prim, { t: 'arc' }>) {
  const a = Math.atan2(p.y - pr.c.y, p.x - pr.c.x), d = Math.hypot(p.x - pr.c.x, p.y - pr.c.y);
  if (pr.full || normA(a - pr.a0!) <= normA(pr.a1! - pr.a0!) + 1e-12) return Math.abs(d - pr.r);
  const s = P(pr.c.x + pr.r * Math.cos(pr.a0!), pr.c.y + pr.r * Math.sin(pr.a0!)), e = P(pr.c.x + pr.r * Math.cos(pr.a1!), pr.c.y + pr.r * Math.sin(pr.a1!));
  return Math.min(Math.hypot(p.x - s.x, p.y - s.y), Math.hypot(p.x - e.x, p.y - e.y));
}
export { boxCentre };

/** Geometry fingerprint for duplicate detection (direction-independent for lines). */
function shapeKey(e: Shape): string {
  const r = (v: number) => (Math.round(v * 1e5) / 1e5).toFixed(5), pt = (p: Point) => r(p.x) + ',' + r(p.y);
  switch (e.type) {
    case 'line': return 'L' + [pt(e.a), pt(e.b)].sort().join(';');
    case 'circle': return 'C' + pt(e.c) + ';' + r(e.r);
    case 'arc': return 'A' + pt(e.c) + ';' + r(e.r) + ';' + r(normA(e.a0)) + ';' + r(normA(e.a1));
    case 'ellipse': return 'E' + JSON.stringify(e);
    case 'poly': return 'P' + (e.closed ? 'c' : 'o') + e.pts.map(pt).join(';') + '|' + (e.bulge || []).map(r).join(';');
    default: return Math.random().toString();
  }
}
