/**
 * Add a ring (key-ring helper): hover round the edge of a closed shape — a
 * round tab with a hole follows the cursor — click to join it on.
 */
import { ringPlace, ringShapes, type RingOpts } from '../geometry/ring';
import { isClosedShape } from '../geometry/boolean';
import { fmt } from '../geometry/vec';
import type { Tool } from '../editor/tool';
import type { Editor } from '../editor/editor';
import type { Point } from '../geometry/vec';
import type { Entity, Shape } from '../model/types';

const ICON = '<path d="M5 9h9v10H5z"/><circle cx="16" cy="8" r="5"/><circle cx="16" cy="8" r="2"/>';
const opts = (ed: Editor): RingOpts => ({ outerD: +ed.opt.ringD, holeD: +ed.opt.ringHole, overlap: +ed.opt.ringOverlap });

function target(ed: Editor, raw: Point): Entity | null {
  const sel = ed.selected().filter(e => isClosedShape(e as Shape));
  if (sel.length === 1) return sel[0];
  return ed.pick(raw, 40, e => isClosedShape(e as Shape))?.e || null;
}
let memo: { key: string; e: Entity; res: ReturnType<typeof ringShapes> } | null = null;
function plan(ed: Editor, raw: Point) {
  const e = target(ed, raw); if (!e) return null;
  const o = opts(ed), pl = ringPlace(e as Shape, raw, o, 8 / ed.view.k);
  const key = `${e.id}|${JSON.stringify(e)}|${pl.C.x},${pl.C.y}|${o.outerD},${o.holeD}`;
  if (!memo || memo.key !== key || memo.e !== e) memo = { key, e, res: ringShapes(e as Shape, pl.C, o) };
  return { e, pl, res: memo.res };
}

export const ringTool: Tool = {
  id: 'ring', label: 'Add a ring (key ring)', key: 'K', icon: ICON, group: 3,
  options: [
    { key: 'ringD', label: 'Ring Ø', type: 'number', min: 2, unit: 'mm' },
    { key: 'ringHole', label: 'Hole Ø', type: 'number', min: 0.5, unit: 'mm' },
    { key: 'ringOverlap', label: 'Overlap', type: 'number', min: 0, unit: 'mm' },
    { key: 'ringHint', label: 'Snaps to midpoints, corners and N/E/S/W', type: 'hint' },
  ],
  prompt: () => 'Hover round the edge of a closed shape · click to add the ring',
  down(ed, raw) {
    const p = plan(ed, raw);
    if (!p) { ed.toast('Point at the edge of a closed shape (rectangle, circle or closed path)'); return; }
    if ('error' in p.res) { ed.toast(p.res.error); return; }
    ed.replaceWith([p.e], p.res.shapes, p.e);
    const o = opts(ed); ed.toast(`Ring added: Ø${fmt(o.outerD, 2)} mm, hole Ø${fmt(o.holeD, 2)} mm, wall ${fmt((o.outerD - o.holeD) / 2, 2)} mm — outline and hole grouped`);
  },
  overlay(ed, o) {
    if (!ed.hover) return; const p = plan(ed, ed.cur); if (!p) return;
    if ('error' in p.res) { o.highlight([p.e.id], 'source'); o.label(p.res.error.split(' — ')[0], p.pl.C); return; }
    o.hide([p.e.id]); for (const s of p.res.shapes) o.ghost(s, 'selected');
    o.label(`Ring Ø${fmt(+ed.opt.ringD, 2)} · hole Ø${fmt(+ed.opt.ringHole, 2)}`, p.pl.C);
  },
};
