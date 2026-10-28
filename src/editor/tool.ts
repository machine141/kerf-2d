/**
 * The Tool contract. Every drawing/editing tool is a small object implementing
 * some of these hooks; the Editor handles snapping, typed coordinates, undo,
 * rendering and UI around it. New tools are added by registering a Tool.
 */
import type { Point } from '../geometry/vec';
import type { Shape } from '../model/types';
import type { Editor } from './editor';

export type OptionSpec =
  | { key: string; label: string; type: 'seg'; choices: [string, string][]; hint?: string; show?: (ed: Editor) => boolean }
  | { key: string; label: string; type: 'number'; min?: number; max?: number; step?: number; unit?: string; placeholder?: string; show?: (ed: Editor) => boolean }
  | { key: string; label: string; type: 'check'; show?: (ed: Editor) => boolean }
  | { key: string; label: string; type: 'select'; choices: [string, string][]; show?: (ed: Editor) => boolean }
  | { key: string; label: string; type: 'button'; run: (ed: Editor) => void; show?: (ed: Editor) => boolean }
  | { key: string; label: string; type: 'hint'; show?: (ed: Editor) => boolean };

export interface PointerInfo { sp: Point; shift: boolean; alt: boolean; ctrl: boolean }

export type GhostStyle = 'preview' | 'selected' | 'source' | 'remove';
/** What a tool may draw on top of the drawing each frame. */
export interface Overlay {
  ghost(s: Shape, style?: GhostStyle): void;
  hide(ids: Iterable<string>): void;
  highlight(ids: Iterable<string>, style?: 'selected' | 'source'): void;
  label(text: string, at?: Point): void;
  custom(fn: (ctx: CanvasRenderingContext2D, ed: Editor, colors: Record<string, string>) => void): void;
}

export interface Tool {
  id: string;
  label: string;
  key: string;
  icon: string;
  /** toolbox group (separators between groups) */
  group: number;
  /** uses snapping and accepts typed coordinates */
  draws?: boolean;
  /** the first point of the shape being drawn snaps to close it */
  closes?: boolean;
  /** Shift gives 45° steps from the last point */
  constrain45?: boolean;
  needsSelection?: boolean;
  options?: OptionSpec[];
  prompt(ed: Editor): string;
  activate?(ed: Editor): void;
  deactivate?(ed: Editor): void;
  down?(ed: Editor, raw: Point, info: PointerInfo): void;
  move?(ed: Editor, raw: Point, info: PointerInfo): void;
  up?(ed: Editor, raw: Point, info: PointerInfo): void;
  dblclick?(ed: Editor, raw: Point, info: PointerInfo): void;
  /** return true if the wheel was used by the tool (otherwise it zooms) */
  wheel?(ed: Editor, dir: 1 | -1, info: PointerInfo): boolean;
  /** return true if the key was handled */
  onKey?(ed: Editor, key: string, info: { shift: boolean; alt: boolean; ctrl: boolean }): boolean;
  /** a point was located (clicked with snapping, or typed) */
  located?(ed: Editor, p: Point): void;
  /** right-click: return true if the tool used it (e.g. to freeze its preview) */
  rightClick?(ed: Editor): boolean;
  /** Enter / right-click / double-click finish */
  finish?(ed: Editor): void;
  /** Esc: return true if the tool cancelled something internally */
  cancel?(ed: Editor): boolean;
  overlay?(ed: Editor, o: Overlay): void;
  cursor?(ed: Editor, sp: Point): string;
}

/** Definition for the common "locate N points, then make something" tool. */
export interface PointToolDef {
  id: string; label: string; key: string; icon: string; group: number;
  need: number | 'open' | ((ed: Editor) => number);
  minPoints?: number;
  prompts: string[] | ((ed: Editor) => string[]);
  drag?: boolean;
  constrain45?: boolean;
  needsSelection?: boolean;
  options?: OptionSpec[];
  /** intercept a located point; return true to stop normal handling */
  intercept?(ed: Editor, p: Point): boolean;
  make(ed: Editor, pts: Point[], closed?: boolean): void;
  preview?(ed: Editor, pts: Point[], cur: Point, o: Overlay): void;
  keyExtra?(ed: Editor, key: string): boolean;
}

export function pointTool(def: PointToolDef): Tool {
  const t: Tool = {
    id: def.id, label: def.label, key: def.key, icon: def.icon, group: def.group, draws: true, constrain45: def.constrain45,
    needsSelection: def.needsSelection, options: def.options,
    prompt: ed => {
      const pr = typeof def.prompts === 'function' ? def.prompts(ed) : def.prompts, base = pr[Math.min(ed.pts.length, pr.length - 1)];
      if (ed.state.frozen) return 'Frozen 🔒 — drag it to move it, change the options above, then click (or Enter) to place · right-click to unfreeze';
      return base + (typeof def.need === 'number' && ed.pts.length ? ' · right-click freezes the preview so you can change options' : '');
    },
    /** Right-click while placing a shape freezes the preview where it is (options can then be changed); again unfreezes. */
    rightClick(ed) {
      if (typeof def.need !== 'number' || !ed.pts.length) return false;
      ed.state.fmove = null; ed.state.frozen = ed.state.frozen ? null : ed.cursorPoint(); ed.changed('prompt'); return true;
    },
    down(ed, raw, info) {
      // frozen: press-and-drag moves the whole preview; a plain click places it
      if (ed.state.frozen) { ed.state.fmove = { grab: raw, sp: info.sp, pts0: ed.pts.slice(), f0: ed.state.frozen, moved: false }; return; }
      const s = ed.snapAt(raw); ed.snapRes = s; const before = ed.pts.length;
      ed.locate(s.p);
      if (def.drag && before === 0 && ed.pts.length === 1) ed.state.dragStart = info.sp;
    },
    move(ed, raw, info) {
      const m = ed.state.fmove; if (!m) return;
      if (!m.moved && Math.hypot(info.sp.x - m.sp.x, info.sp.y - m.sp.y) <= 4) return;
      m.moved = true;
      // the shape's first point follows the pointer and snaps (grid, ends, centres…) so it can be dropped exactly
      const a0 = m.pts0[0], s = ed.snapAt({ x: a0.x + raw.x - m.grab.x, y: a0.y + raw.y - m.grab.y }, { drawing: false });
      const dx = s.p.x - a0.x, dy = s.p.y - a0.y, sh = (q: Point) => ({ x: q.x + dx, y: q.y + dy });
      ed.pts = m.pts0.map(sh); ed.rel = ed.pts[ed.pts.length - 1]; ed.state.frozen = sh(m.f0); ed.snapRes = { ...s, p: s.p };
    },
    up(ed, raw, info) {
      const m = ed.state.fmove;
      if (m) { ed.state.fmove = null; if (!m.moved) { const f = ed.state.frozen; ed.state.frozen = null; ed.locate(f); } else ed.changed('prompt'); return; }
      const ds = ed.state.dragStart; ed.state.dragStart = null;
      if (ds && ed.pts.length === 1 && Math.hypot(info.sp.x - ds.x, info.sp.y - ds.y) > 6) { const s = ed.snapAt(raw); ed.locate(s.p); }
    },
    located(ed, p) {
      if (def.intercept?.(ed, p)) return;
      ed.pts.push(p); ed.rel = p;
      const need = typeof def.need === 'function' ? def.need(ed) : def.need;
      if (typeof need === 'number' && ed.pts.length >= need) { const pts = ed.pts.slice(); ed.pts = []; def.make(ed, pts); }
      ed.changed('prompt');
    },
    finish(ed) {
      if (def.need === 'open') {
        const pts = ed.pts.filter((q, i) => i === 0 || Math.hypot(q.x - ed.pts[i - 1].x, q.y - ed.pts[i - 1].y) > 1e-9);
        ed.pts = [];
        if (pts.length >= (def.minPoints ?? 2)) def.make(ed, pts, !!ed.state.close);
        ed.state.close = false; ed.changed('prompt');
      } else if (ed.state.frozen) { const f = ed.state.frozen; ed.state.frozen = null; ed.locate(f); }
      else if (ed.pts.length) { ed.pts = []; ed.changed('prompt'); }
    },
    cancel(ed) {
      if (ed.state.fmove) { const m = ed.state.fmove; ed.pts = m.pts0; ed.state.frozen = m.f0; ed.state.fmove = null; ed.changed('prompt'); return true; }
      if (ed.state.frozen) { ed.state.frozen = null; ed.changed('prompt'); return true; }
      if (!ed.pts.length) return false;
      if (def.need === 'open' && ed.pts.length >= (def.minPoints ?? 2)) { t.finish!(ed); return true; }
      ed.pts = []; ed.changed('prompt'); return true;
    },
    onKey(ed, key) {
      if ((key === 'Backspace' || key === 'F2') && ed.pts.length) { ed.pts.pop(); ed.rel = ed.pts[ed.pts.length - 1] || ed.rel; ed.changed('prompt'); return true; }
      return def.keyExtra?.(ed, key) ?? false;
    },
    dblclick(ed) { if (def.need === 'open' && ed.pts.length) { ed.pts.pop(); t.finish!(ed); } },
    overlay(ed, o) {
      if (!ed.pts.length || !def.preview) return;
      const f: Point | null = ed.state.frozen; def.preview(ed, ed.pts, f || ed.cursorPoint(), o);
      if (f) o.custom((ctx, ed2, C) => { const s = ed2.w2s(f); ctx.strokeStyle = C['--accent']; ctx.lineWidth = 2; ctx.setLineDash([]); ctx.beginPath(); ctx.rect(s.x - 6, s.y - 6, 12, 12); ctx.moveTo(s.x - 3, s.y - 6); ctx.lineTo(s.x - 3, s.y - 10); ctx.arc(s.x, s.y - 10, 3, Math.PI, 0); ctx.lineTo(s.x + 3, s.y - 6); ctx.stroke(); });
    },
  };
  return t;
}
