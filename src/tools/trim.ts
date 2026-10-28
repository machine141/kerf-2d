/** Delete Part (trim): remove a piece back to the nearest crossings. */
import { trimShape } from '../geometry/trim';
import type { Tool } from '../editor/tool';
import type { Editor } from '../editor/editor';
import type { Point } from '../geometry/vec';
import type { Shape } from '../model/types';
import { ICONS } from './icons';

export function trimAt(ed: Editor, raw: Point, tolPx = 7): boolean {
  const hit = ed.pick(raw, tolPx, e => e.type !== 'dim');
  if (!hit) { ed.toast('Nothing to trim here'); return false; }
  const cutters = ed.doc.ents.filter(o => o.id !== hit.e.id && ed.store.visible(o)).flatMap(o => ed.geomPrims(o));
  const res = trimShape(hit.e as Shape, raw, cutters, ed.opt.trimMode);
  if (!res) { ed.toast('This object cannot be trimmed'); return false; }
  ed.store.change(() => ed.store.splice(hit.e.id, res));
  return true;
}

export const trimTool: Tool = {
  id: 'trim', label: 'Delete part (trim)', key: 'T', icon: ICONS.trim, group: 3,
  options: [
    { key: 'trimMode', label: 'Paths', type: 'seg', choices: [['whole', 'As a whole'], ['segments', 'Segment by segment']] },
    { key: 'trimHint', label: 'Removes back to the nearest crossings', type: 'hint' },
  ],
  prompt: () => 'Click the part of a line, arc, circle or path to remove',
  down(ed, raw) { trimAt(ed, raw); },
  overlay(ed, o) { const h = ed.hover && ed.pick(ed.cur, 7, e => e.type !== 'dim'); if (h) o.highlight([h.e.id], 'source'); },
};
