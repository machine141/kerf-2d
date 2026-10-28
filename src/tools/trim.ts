/**
 * Delete Part (trim): remove a piece back to the nearest crossings.
 *  • Hover shows exactly what will be removed (red) before you click.
 *  • Ends of lines/arcs that stop on (or within the join tolerance of) a shape count as crossings.
 *  • A closed shape is never deleted whole by a trim — it needs two crossings.
 */
import { trimInfo, type TrimResult } from '../geometry/trim';
import type { Tool } from '../editor/tool';
import type { Editor } from '../editor/editor';
import type { Point } from '../geometry/vec';
import type { Entity, Shape } from '../model/types';
import { ICONS } from './icons';

/** End points of open shapes other than `skip` (used as touch-crossings). */
export function openEndPoints(ed: Editor, skip?: string): Point[] {
  const out: Point[] = [];
  for (const e of ed.doc.ents) {
    if (e.id === skip || !ed.store.visible(e)) continue;
    if (e.type === 'line') out.push(e.a, e.b);
    else if (e.type === 'arc') out.push({ x: e.c.x + e.r * Math.cos(e.a0), y: e.c.y + e.r * Math.sin(e.a0) }, { x: e.c.x + e.r * Math.cos(e.a1), y: e.c.y + e.r * Math.sin(e.a1) });
    else if (e.type === 'poly' && !e.closed && e.pts.length > 1) out.push(e.pts[0], e.pts[e.pts.length - 1]);
  }
  return out;
}

function plan(ed: Editor, raw: Point, tolPx = 7): { e: Entity; r: TrimResult } | null {
  const hit = ed.pick(raw, tolPx, e => e.type !== 'dim');
  if (!hit) return null;
  const cutters = ed.doc.ents.filter(o => o.id !== hit.e.id && ed.store.visible(o)).flatMap(o => ed.geomPrims(o));
  const touch = { pts: openEndPoints(ed, hit.e.id), tol: Math.max(1e-6, +ed.opt.joinTol || 0) };
  return { e: hit.e, r: trimInfo(hit.e as Shape, raw, cutters, ed.opt.trimMode, touch) };
}

export function trimAt(ed: Editor, raw: Point, tolPx = 7): boolean {
  const p = plan(ed, raw, tolPx);
  if (!p) { ed.toast('Nothing to trim here'); return false; }
  if ('error' in p.r) { ed.toast(p.r.error); return false; }
  const keep = p.r.keep;
  ed.store.change(() => ed.store.splice(p.e.id, keep));
  return true;
}

export const trimTool: Tool = {
  id: 'trim', label: 'Delete part (trim)', key: 'T', icon: ICONS.trim, group: 3,
  options: [
    { key: 'trimMode', label: 'Paths', type: 'seg', choices: [['whole', 'As a whole'], ['segments', 'Segment by segment']] },
    { key: 'trimHint', label: 'Red shows what will be removed', type: 'hint' },
  ],
  prompt: () => 'Hover to see what will go (red) · click to remove it',
  down(ed, raw) { trimAt(ed, raw); },
  overlay(ed, o) {
    if (!ed.hover) return;
    const p = plan(ed, ed.cur); if (!p) return;
    if ('error' in p.r) { o.highlight([p.e.id], 'source'); o.label(p.r.error.split(' — ')[0].split('. ')[0]); return; }
    for (const s of p.r.removed) o.ghost(s, 'remove');
  },
};
