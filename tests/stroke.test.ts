import { describe, it, expect } from 'vitest';
import { strokeText, textWidth, GLYPHS } from '../src/text/stroke';
import { bbox, unionBox } from '../src/geometry/entity';
describe('engraving font', () => {
  it('has every capital and digit, and sizes text exactly', () => {
    for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') expect(GLYPHS[c]?.length).toBeGreaterThan(0);
    const s = strokeText('FORMER', 6), b = unionBox(s.map(x => bbox(x)))!;
    expect(b.y1 - b.y0).toBeCloseTo(6, 6); expect(b.x1 - b.x0).toBeCloseTo(textWidth('FORMER', 6), 6);
    expect(strokeText('former', 6)).toEqual(s);   // lower case drawn as capitals
  });
});
