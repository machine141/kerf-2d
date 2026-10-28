/**
 * Editor: owns the document store, selection, view, the active tool and all
 * input routing. It has no DOM dependencies, so it runs headless in tests.
 */
import { type Point, P, add, sub, angOf, len, DEG, cp, normA } from '../geometry/vec';
import { prims, bbox as shapeBox, unionBox, boxCentre, type Box, type Prim } from '../geometry/entity';
import { affEnt, affMove, affScale, type Affine } from '../geometry/affine';
import { dimGeom } from '../geometry/dims';
import { joinPieces, arcBulge, type Piece } from '../geometry/path';
import { explodePath, pieceToShape } from '../geometry/trim';
import { snapPoint, type SnapResult } from '../snap/snap';
import { DocStore } from '../model/document';
import type { Entity, Shape } from '../model/types';
import type { Tool, PointerInfo } from './tool';

export type CoordMode = 'abs' | 'rel' | 'pol';
export type ChangeKind = 'doc' | 'sel' | 'tool' | 'prompt' | 'view' | 'aids' | 'opts';

export const DEFAULT_OPTS: Record<string, any> = {
  rectFrom: 'corner', circFrom: 'centre', fixedR: '', dimMode: 'a', rotAngle: 60, rotCopies: 5, moveCopy: false, mirKeep: true,
  offMode: 'shape', offSide: 'auto', offD: 5, offRound: '1', offCount: 1, offFollow: false, trimMode: 'whole', lockAspect: false,
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
  opt: Record<string, any> = { ...DEFAULT_OPTS };
  /** scratch space for the active tool */
  state: Record<string, any> = {};
  private listeners = new Map<string, Set<(k: ChangeKind) => void>>();
  private pan: { sp: Point; ox: number; oy: number } | null = null;

  constructor(tools: Tool[]) {
    for (const t of tools) this.tools[t.id] = t;
    this.tool = tools[0];
    this.store.on(() => { for (const id of [...this.sel]) if (!this.store.byId(id)) this.sel.delete(id); this.changed('doc'); });
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
  geomPrims(e: Entity | Shape): Prim[] { return e.type === 'dim' ? dimGeom(e as any, this.doc.dim).lines.map(([a, b]) => ({ t: 'seg', a, b }) as Prim) : prims(e as Shape); }
  bbox(e: Entity | Shape): Box { return shapeBox(e as Shape, (x: any) => dimGeom(x, this.doc.dim)); }
  selected(): Entity[] { return [...this.sel].map(id => this.store.byId(id)).filter(Boolean) as Entity[]; }
  selBox(): Box | null { return unionBox(this.selected().map(e => this.bbox(e))); }
  setSelection(ids: Iterable<string>) { this.sel = new Set(ids); this.changed('sel'); }

  pick(raw: Point, tolPx = 7, filter?: (e: Entity) => boolean): { e: Entity; d: number; pr: Prim } | null {
    const tol = tolPx / this.view.k; let best: { e: Entity; d: number; pr: Prim } | null = null;
    const ents = this.doc.ents;
    for (let i = ents.length - 1; i >= 0; i--) {
      const e = ents[i]; if (!this.store.usable(e) || (filter && !filter(e))) continue;
      const b = this.bbox(e); if (raw.x < b.x0 - tol || raw.x > b.x1 + tol || raw.y < b.y0 - tol || raw.y > b.y1 + tol) continue;
      for (const pr of this.geomPrims(e)) {
        const q = pr.t === 'seg' ? segDist(raw, pr.a, pr.b) : arcDist(raw, pr);
        if (q <= tol && (!best || q < best.d - 1e-9)) best = { e, d: q, pr };
      }
    }
    return best;
  }

  snapAt(raw: Point, o: { exclude?: Set<string>; drawing?: boolean } = {}): SnapResult {
    return snapPoint(raw, {
      ents: this.doc.ents, visible: this.store.visible, aids: this.doc.aids, k: this.view.k,
      last: this.pts[this.pts.length - 1], constrain45: this.mods.shift && !!this.tool.constrain45,
      drawing: o.drawing ?? !!this.tool.draws, exclude: o.exclude,
    });
  }
  /** Current cursor position after snapping (what a click would locate). */
  cursorPoint() { return this.snapRes ? this.snapRes.p : this.cur; }

  // ---- tools ----
  setTool(id: string) {
    const t = this.tools[id]; if (!t) return false;
    if (t.needsSelection && !this.sel.size) { this.toast(`Select objects first, then choose ${t.label.toLowerCase()}`); return false; }
    this.tool.deactivate?.(this);
    this.tool = t; this.pts = []; this.state = {};
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
  finish() { this.tool.finish?.(this); }
  cancel() {
    if (this.tool.cancel?.(this)) return;
    if (this.tool.id !== 'select') { this.setTool('select'); return; }
    if (this.sel.size) { this.sel.clear(); this.changed('sel'); }
  }

  // ---- input (world coordinates + screen point) ----
  pointerDown(raw: Point, button: number, info: PointerInfo, spaceHeld = false) {
    this.mods = { shift: info.shift, alt: info.alt, ctrl: info.ctrl }; this.cur = raw;
    if (button === 1 || (button === 0 && spaceHeld)) { this.pan = { sp: info.sp, ox: this.view.ox, oy: this.view.oy }; return; }
    if (button === 2) { this.tool.finish && this.pts.length ? this.tool.finish(this) : this.cancel(); return; }
    if (button === 0) this.tool.down?.(this, raw, info);
    this.changed('view');
  }
  pointerMove(raw: Point, info: PointerInfo) {
    this.mods = { shift: info.shift, alt: info.alt, ctrl: info.ctrl }; this.cur = raw; this.hover = true;
    if (this.pan) { this.view.ox = this.pan.ox - (info.sp.x - this.pan.sp.x) / this.view.k; this.view.oy = this.pan.oy + (info.sp.y - this.pan.sp.y) / this.view.k; this.changed('view'); return; }
    this.snapRes = this.tool.draws ? this.snapAt(raw) : null;
    this.tool.move?.(this, raw, info);
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
    this.store.change(() => { for (const e of sel) if (e.type === 'poly') out.push(...this.store.splice(e.id, explodePath(e)).map(x => x.id)); else out.push(e.id); });
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
  /** Make Path: join selected lines, arcs and open paths that touch end-to-end into single paths (true arcs kept). */
  makePathSel() {
    const sel = this.selected().filter(e => e.type === 'line' || e.type === 'arc' || (e.type === 'poly' && !e.closed));
    if (sel.length < 2) { this.toast('Select two or more lines, arcs or open paths that touch end to end'); return; }
    const pieces: Piece[] = sel.map(e => e.type === 'line' ? { pts: [e.a, e.b], bulge: [0] }
      : e.type === 'arc' ? { pts: [P(e.c.x + e.r * Math.cos(e.a0), e.c.y + e.r * Math.sin(e.a0)), P(e.c.x + e.r * Math.cos(e.a1), e.c.y + e.r * Math.sin(e.a1))], bulge: [arcBulge(e.a0, e.a1)] }
      : { pts: (e as any).pts.slice(), bulge: (e as any).bulge?.slice(0, (e as any).pts.length - 1) || (e as any).pts.slice(1).map(() => 0) });
    const joined = joinPieces(pieces), first = sel[0], made: string[] = [];
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
    this.sel = new Set(made); this.changed('sel');
    const closed = joined.filter(j => j.closed).length;
    this.toast(`Made ${joined.length} path${joined.length > 1 ? 's' : ''}${closed ? ` (${closed} closed)` : ''} from ${sel.length} pieces`);
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
