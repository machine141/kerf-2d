/** Several sheets on one page: pick out one sheet's objects for export (moved to the sheet's own origin). */
import { affEnt, affMove } from '../geometry/affine';
import { bbox } from '../geometry/entity';
import { P } from '../geometry/vec';
import { sheetAt, sheetX, type Doc, type Shape } from '../model/types';

/** Which sheet an object belongs to: where the middle of its box is (-1 = on no sheet). */
export function sheetOf(doc: Doc, e: Shape): number {
  const b = bbox(e); if (!b) return -1;
  return sheetAt(doc, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
}
/** A copy of the drawing holding only sheet k, moved so that sheet starts at (0, 0). */
export function sheetDoc(doc: Doc, k: number): Doc {
  const dx = -sheetX(doc, k), A = affMove(P(dx, 0));
  const ents = doc.ents.filter(e => sheetOf(doc, e as Shape) === k).map(e => (dx ? affEnt(e as Shape, A) : structuredClone(e)) as any);
  return { ...doc, ents, sheets: 1 };
}
