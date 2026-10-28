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

export type GhostStyle = 'preview' | 'selected' | 'source';
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
  need: number | 'open';
  minPoints?: number;
  prompts: string[];
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
    prompt: ed => def.prompts[Math.min(ed.pts.length, def.prompts.length - 1)],
    down(ed, raw, info) {
      const s = ed.snapAt(raw); ed.snapRes = s; const before = ed.pts.length;
      ed.locate(s.p);
      if (def.drag && before === 0 && ed.pts.length === 1) ed.state.dragStart = info.sp;
    },
    up(ed, raw, info) {
      const ds = ed.state.dragStart; ed.state.dragStart = null;
      if (ds && ed.pts.length === 1 && Math.hypot(info.sp.x - ds.x, info.sp.y - ds.y) > 6) { const s = ed.snapAt(raw); ed.locate(s.p); }
    },
    located(ed, p) {
      if (def.intercept?.(ed, p)) return;
      ed.pts.push(p); ed.rel = p;
      if (typeof def.need === 'number' && ed.pts.length >= def.need) { const pts = ed.pts.slice(); ed.pts = []; def.make(ed, pts); }
      ed.changed('prompt');
    },
    finish(ed) {
      if (def.need === 'open') {
        const pts = ed.pts.filter((q, i) => i === 0 || Math.hypot(q.x - ed.pts[i - 1].x, q.y - ed.pts[i - 1].y) > 1e-9);
        ed.pts = [];
        if (pts.length >= (def.minPoints ?? 2)) def.make(ed, pts, !!ed.state.close);
        ed.state.close = false; ed.changed('prompt');
      } else if (ed.pts.length) { ed.pts = []; ed.changed('prompt'); }
    },
    cancel(ed) {
      if (!ed.pts.length) return false;
      if (def.need === 'open' && ed.pts.length >= (def.minPoints ?? 2)) { t.finish!(ed); return true; }
      ed.pts = []; ed.changed('prompt'); return true;
    },
    onKey(ed, key) {
      if ((key === 'Backspace' || key === 'F2') && ed.pts.length) { ed.pts.pop(); ed.rel = ed.pts[ed.pts.length - 1] || ed.rel; ed.changed('prompt'); return true; }
      return def.keyExtra?.(ed, key) ?? false;
    },
    dblclick(ed) { if (def.need === 'open' && ed.pts.length) { ed.pts.pop(); t.finish!(ed); } },
    overlay(ed, o) { if (ed.pts.length && def.preview) def.preview(ed, ed.pts, ed.cursorPoint(), o); },
  };
  return t;
}
