/**
 * Text tool: click empty space to type a line of text; click on a line, arc,
 * circle or curve to write along it; click existing text to change it.
 * Also the text helpers the Select tool uses (wheel, sliding, flipping, dropping onto a path).
 */
import { type Point, P, fmt } from '../geometry/vec';
import { boxCentre } from '../geometry/entity';
import { affRot } from '../geometry/affine';
import type { Tool, PointerInfo } from '../editor/tool';
import type { Editor } from '../editor/editor';
import type { Entity, Shape, TextEnt, TextPath } from '../model/types';
import { textShapes, TEXT_DEFAULTS } from '../text/text';
import { FONTS } from '../text/fonts';
import { canCarryText, placeOnPath, slideTo } from '../text/place';
import { ICONS } from './icons';

export const isText = (e: any): e is TextEnt => e?.type === 'text';
const geomOf = (e: Entity): Shape => { const { id, layer, color, w, group, ...g } = e as any; void id; void layer; void color; void w; void group; return structuredClone(g); };

/** The line/curve under the pointer that text could follow (not text, not dimensions). */
export function pathUnder(ed: Editor, raw: Point, exclude?: Set<string>): Entity | null {
  return ed.pick(raw, undefined, e => canCarryText(e) && !exclude?.has(e.id))?.e ?? null;
}
/** Attach text to a path at the point p (keeps size, font and effect). */
export function attachToPath(t: TextEnt, path: Entity, p: Point, o: { side?: TextPath['side']; effect?: TextPath['effect']; fit?: boolean } = {}) {
  const geom = geomOf(path), pl = placeOnPath(geom, p, o.side ?? 'above');
  t.path = { ref: path.id, geom, pos: pl.pos, anchor: o.fit ? 'fit' : 'center', side: pl.side, flip: pl.flip, effect: o.effect ?? 'rainbow', lift: 0 };
}

/** A text object from the tool's settings, ready to add. */
export function textFromOpts(ed: Editor, at: Point, text = 'Text'): TextEnt {
  const o = ed.opt;
  return { ...TEXT_DEFAULTS, type: 'text', text, font: o.txtFont || TEXT_DEFAULTS.font, size: +o.txtSize > 0 ? +o.txtSize : 10, spacing: +o.txtSpacing || 0, align: o.txtAlign || 'left', at, angle: 0 } as TextEnt;
}
/** Make new text (straight at `at`, or along `path` near `at`) and open the typing box. */
export function makeText(ed: Editor, at: Point, path: Entity | null, text = 'Text'): Entity {
  const t = textFromOpts(ed, at, text), o = ed.opt;
  if (path) attachToPath(t, path, at, { side: o.txtSide, effect: o.txtEffect, fit: !!o.txtFit });
  ed.store.checkpoint();
  const e = ed.store.add(t as Shape, o.txtEngrave ? { color: 'blue' } : {});
  ed.store.emit(); ed.setSelection([e.id]);
  ed.textEditor?.(e.id, true);
  return e;
}

/** Copy a text object's settings into the tool options (so the strip shows them). */
export function optsFromText(ed: Editor, t: TextEnt) {
  const o = ed.opt; o.txtFont = t.font; o.txtSize = t.size; o.txtSpacing = t.spacing; o.txtAlign = t.align; o.txtEngrave = t.color === 'blue';
  if (t.path) { o.txtEffect = t.path.effect; o.txtSide = t.path.side; o.txtFit = t.path.anchor === 'fit'; }
  ed.changed('opts');
}

/** Change selected text objects; quick repeats (typing a size, turning the wheel) are one undo step. */
let lastEdit = { key: '', at: 0 };
export function editTexts(ed: Editor, fn: (t: TextEnt) => void, key = '', ids: string[] = [...ed.sel]): number {
  const ts = ids.map(id => ed.store.byId(id)).filter(isText) as TextEnt[]; if (!ts.length) return 0;
  const now = Date.now();
  if (!key || key !== lastEdit.key || now - lastEdit.at > 1200) ed.store.checkpoint();
  lastEdit = { key, at: now };
  for (const t of ts) fn(t);
  ed.store.emit(); return ts.length;
}

/** An option in the strip was changed: apply it to the selected text. */
export function applyOpt(ed: Editor, key: string) {
  const o = ed.opt;
  const map: Record<string, (t: TextEnt) => void> = {
    txtFont: t => { t.font = o.txtFont; },
    txtSize: t => { if (+o.txtSize > 0) t.size = +o.txtSize; },
    txtSpacing: t => { t.spacing = +o.txtSpacing || 0; },
    txtAlign: t => { t.align = o.txtAlign; },
    txtEffect: t => { if (t.path) t.path.effect = o.txtEffect; },
    txtSide: t => { if (t.path) t.path.side = o.txtSide; },
    txtFit: t => { if (t.path) t.path.anchor = o.txtFit ? 'fit' : 'center'; },
    txtEngrave: t => { t.color = o.txtEngrave ? 'blue' : ed.doc.attrs.color; },
  };
  if (map[key]) editTexts(ed, map[key], key);
}

/**
 * Mouse wheel over selected text: letter spacing · Shift: size · Alt: lift off
 * the line (text on a path) or line spacing (several lines). Returns false if not over selected text.
 */
export function textWheel(ed: Editor, dir: 1 | -1, info: PointerInfo): boolean {
  const hit = ed.pick(ed.cur, undefined, isText)?.e; if (!hit || !ed.sel.has(hit.id)) return false;
  let msg = '';
  editTexts(ed, t => {
    if (info.shift) { t.size = Math.max(0.5, +(t.size * (dir > 0 ? 1.05 : 1 / 1.05)).toFixed(2)); msg = `Size ${fmt(t.size, 2)} mm`; }
    else if (info.alt) {
      if (t.path) { t.path.lift = +((t.path.lift || 0) + dir * Math.max(0.2, t.size * 0.05)).toFixed(2); msg = `Lift ${fmt(t.path.lift, 2)} mm`; }
      else { t.lineSpacing = Math.max(0.6, +((t.lineSpacing || 1.6) + dir * 0.1).toFixed(2)); msg = `Line spacing ${fmt(t.lineSpacing, 2)}`; }
    } else { const st = Math.max(0.1, +(t.size * 0.03).toFixed(1)); t.spacing = Math.max(-t.size * 0.4, +(t.spacing + dir * st).toFixed(2)); msg = `Letter spacing ${fmt(t.spacing, 2)} mm`; }
  }, 'wheel' + (info.shift ? 's' : info.alt ? 'a' : ''), [...ed.sel]);
  const t = hit as TextEnt; optsFromText(ed, t); ed.state.textMsg = { msg, until: Date.now() + 1200 };
  return true;
}

/** Flip handles on text: ↕ puts path text on the other side of its line (straight text turns upside down); ↔ mirrors it back to front. */
export function flipText(ed: Editor, t: TextEnt, axis: 'h' | 'v') {
  if (axis === 'h') { if (t.path) editTexts(ed, x => { x.mirror = !x.mirror; }, '', [t.id]); else ed.flipSel('h'); return; }
  if (t.path) { editTexts(ed, x => { x.path!.flip = !x.path!.flip; }, '', [t.id]); return; }
  const b = ed.bbox(t); ed.store.change(() => ed.transformSel(affRot(boxCentre(b), Math.PI)));
}

/** Drag path text along its path, snapping to the ends, middle (lines) or top, bottom and sides (closed shapes). */
export function slideText(ed: Editor, t: TextEnt, raw: Point): string | null {
  const r = slideTo(t, raw, 10 / ed.view.k); t.path!.pos = r.pos; t.path!.anchor = r.anchor; return r.snap?.label ?? null;
}

const FONT_CHOICES = (): [string, string][] => FONTS.map(f => [f.id, f.name]);
/** Selected text objects (Select tool), or null when the selection isn't all text. */
const selTexts = (ed: Editor): TextEnt[] | null => { const s = ed.selected(); return s.length && s.every(isText) ? s as TextEnt[] : null; };
/**
 * The text settings for the option bar. The Text tool always shows them; the
 * Select tool shows them while text is selected (the "on a line" ones only for text on a line).
 */
export function textOptions(forSelect: boolean): NonNullable<Tool['options']> {
  const any = (ed: Editor) => !forSelect || !!selTexts(ed), onLine = (ed: Editor) => !forSelect || !!selTexts(ed)?.some(t => t.path), straight = (ed: Editor) => !forSelect || !!selTexts(ed)?.some(t => !t.path);
  return [
    { key: 'txtFont', label: 'Font', type: 'select', choices: FONT_CHOICES(), show: any },
    { key: 'txtSize', label: 'Size', type: 'number', min: 0.5, step: 1, unit: 'mm', show: any },
    { key: 'txtSpacing', label: 'Spacing', type: 'number', step: 0.1, unit: 'mm', show: any },
    { key: 'txtAlign', label: 'Align', type: 'seg', choices: [['left', '⇤ Left'], ['center', 'Centre'], ['right', 'Right ⇥']], show: straight },
    { key: 'txtEffect', label: 'On a line', type: 'seg', choices: [['rainbow', 'A Rainbow'], ['stretch', 'B Stretch'], ['skew', 'C Skew'], ['stair', 'D Stair']], show: onLine },
    { key: 'txtSide', label: 'Sits', type: 'seg', choices: [['above', 'Above'], ['on', 'On'], ['below', 'Below']], show: onLine },
    { key: 'txtFit', label: 'Fit to length', type: 'check', show: onLine },
    { key: 'txtEngrave', label: 'Engrave (blue)', type: 'check', show: any },
  ];
}
export const textTool: Tool = {
  id: 'text', label: 'Text', key: 'W', icon: ICONS.text, group: 1, draws: true,
  get options() { return textOptions(false); },
  prompt: () => 'Click to type · click on a line, arc or circle to write along it · click text to change it · wheel over selected text: spacing (Shift: size)',
  move(ed, raw) {
    const onText = ed.pick(raw, undefined, isText)?.e;
    ed.state.tHover = onText ? null : pathUnder(ed, raw)?.id ?? null;
  },
  down(ed, raw) {
    if (ed.state.typing) { ed.state.typing(); return; }   // a click away from the typing box just finishes it
    const hit = ed.pick(raw, undefined, isText)?.e as TextEnt | undefined;
    if (hit) { ed.setSelection([hit.id]); optsFromText(ed, hit); ed.textEditor?.(hit.id, false); return; }
    const path = pathUnder(ed, raw);
    if (path) { makeText(ed, ed.snapAt(raw, { drawing: false }).p, path); return; }
    makeText(ed, ed.snapAt(raw).p, null);
  },
  located(ed, p) { makeText(ed, p, null); },
  wheel: (ed, dir, info) => textWheel(ed, dir, info),
  onOpt: applyOpt,
  activate(ed) { const s = ed.selected(); if (s.length === 1 && isText(s[0])) optsFromText(ed, s[0]); },
  overlay(ed, o) {
    o.highlight(ed.sel, 'selected');
    if (!ed.hover) return;
    const id = ed.state.tHover, path = id && ed.store.byId(id);
    const t = textFromOpts(ed, ed.snapRes?.p ?? ed.cur, 'Text');
    if (path) { attachToPath(t, path, ed.cur, { side: ed.opt.txtSide, effect: ed.opt.txtEffect, fit: !!ed.opt.txtFit }); o.highlight([id], 'source'); o.label('Click to write along this', ed.cur); }
    for (const s of textShapes(t)) o.ghost(s, 'preview');
  },
};
export { P };
