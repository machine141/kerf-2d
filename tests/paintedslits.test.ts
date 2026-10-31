import { describe, it, expect } from 'vitest';
import { P } from '../src/geometry/vec';
import { Editor } from '../src/editor/editor';
import { ALL_TOOLS } from '../src/tools';
import { withPaintedSlits } from '../src/tools/hingebrush';
import { cutOrder } from '../src/laser/order';
import { exportLaserSVG } from '../src/laser/export';

const rect = (x: number, y: number, w: number, h: number) => [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)];

describe('What you see is what gets cut: painted hinge patterns', () => {
  for (const pattern of ['honeycomb', 'lattice', 'straight'] as const) {
    it(`a ${pattern} pattern painted (Make cuts not pressed) goes to the laser and the export`, () => {
      const ed = new Editor(ALL_TOOLS);
      ed.store.change(() => { ed.store.add({ type: 'poly', closed: true, pts: rect(10, 20, 120, 60) } as any, { color: 'red' }); });
      ed.doc.attrs.color = 'red';
      ed.doc.hinge = [{ kind: 'area', pattern, pts: rect(20, 30, 100, 40) } as any];
      const before = cutOrder(ed.doc).paths.length, d = withPaintedSlits(ed), after = cutOrder(d).paths.length;
      expect(before).toBe(1);
      expect(after).toBeGreaterThan(5);
      expect(exportLaserSVG(d).svg.match(/<path id="step-/g)!.length).toBe(after);
      expect(ed.doc.ents.length).toBe(1);            // the drawing itself is untouched
    });
  }
  it('after Make cuts the slits are already in the drawing, so nothing is added twice', () => {
    const ed = new Editor(ALL_TOOLS);
    ed.store.change(() => { ed.store.add({ type: 'poly', closed: true, pts: rect(10, 20, 120, 60) } as any, { color: 'red' }); });
    ed.doc.hinge = [{ kind: 'area', pattern: 'straight', pts: rect(20, 30, 100, 40) } as any]; ed.doc.hingeMade = true;
    expect(withPaintedSlits(ed)).toBe(ed.doc);
  });
});
