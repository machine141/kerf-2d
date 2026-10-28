/** Opening sample: a pair of glasses (lenses + bridge, outer frame made with Contour). */
import { P, normA, DEG } from './geometry/vec';
import { makeSource, contour } from './geometry/offset';
import type { Editor } from './editor/editor';
import { newDoc, type Shape } from './model/types';

export function loadSample(ed: Editor) {
  const d = newDoc(); d.name = 'Glasses front'; d.page = { w: 297, h: 210, preset: 'A4L' };
  d.layers = [{ id: 'L1', name: 'Cut', visible: true, active: true }, { id: 'L2', name: 'Construction', visible: true, active: true }, { id: 'L3', name: 'Dimensions', visible: true, active: true }];
  ed.store.load(d, false);
  const S = ed.store, cut = { layer: 'L1', color: 'red' as const, w: 0.1 };
  const lensL = { type: 'ellipse', c: P(118, 110), rx: 24, ry: 19, rot: 0 } as Shape, lensR = { type: 'ellipse', c: P(179, 110), rx: 24, ry: 19, rot: 0 } as Shape;
  const bridge = { type: 'arc', c: P(148.5, 108), r: 9, a0: normA(20 * DEG), a1: normA(160 * DEG) } as Shape;
  S.add(lensL, cut); S.add(lensR, cut); S.add(bridge, { layer: 'L2', color: 'blue', w: 0.1 });
  for (const pts of contour(makeSource([lensL, lensR, bridge]), 5, 'out', true)) S.add({ type: 'poly', closed: true, pts } as Shape, cut);
  const dm = { layer: 'L3', color: 'ink' as const, w: 0.1 };
  S.add({ type: 'dim', mode: 'h', p1: P(94, 110), p2: P(142, 110), off: P(0, 150) } as Shape, dm);
  S.add({ type: 'dim', mode: 'v', p1: P(203, 91), p2: P(203, 129), off: P(222, 0) } as Shape, dm);
  S.emit();
}
