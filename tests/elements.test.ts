import { describe, it, expect } from 'vitest';
import { P } from '../src/geometry/vec';
import { ELEMENTS, placeElement } from '../src/elements/elements';
import { bbox, unionBox } from '../src/geometry/entity';

describe('elements library', () => {
  for (const el of ELEMENTS) it(`${el.name} builds and scales to 40 mm`, () => {
    const s = placeElement(el, 40, P(100, 100)); expect(s.length).toBeGreaterThan(0);
    const b = unionBox(s.map(x => bbox(x)))!, w = b.x1 - b.x0, h = b.y1 - b.y0;
    expect(Math.max(w, h)).toBeCloseTo(40, 3);
    expect((b.x0 + b.x1) / 2).toBeCloseTo(100, 3); expect((b.y0 + b.y1) / 2).toBeCloseTo(100, 3);
  });
});
