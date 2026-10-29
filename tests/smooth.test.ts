import { describe, it, expect } from 'vitest';
import { P } from '../src/geometry/vec';
import { Editor } from '../src/editor/editor';
import { ALL_TOOLS } from '../src/tools';
import { smoothDab } from '../src/tools/smooth';
import type { Shape } from '../src/model/types';

describe('Smooth brush', () => {
  it('irons out a bump in a path; ends of an open path stay put; points outside the brush do not move', () => {
    const ed = new Editor(ALL_TOOLS);
    const pts = Array.from({ length: 21 }, (_, i) => P(i * 5, i === 10 ? 6 : 0));
    const e = ed.store.add({ type: 'poly', closed: false, pts } as Shape) as any; ed.store.emit();
    for (let k = 0; k < 8; k++) smoothDab(ed, P(50, 0), 'smooth', 0.45, 12);
    expect(Math.abs(e.pts[10].y)).toBeLessThan(2);
    expect(e.pts[0]).toEqual(P(0, 0)); expect(e.pts[20]).toEqual(P(100, 0)); expect(e.pts[3]).toEqual(P(15, 0));
  });
  it('a kink in a curve becomes smooth; Sharpen turns a smooth point into a corner', () => {
    const ed = new Editor(ALL_TOOLS);
    const pts = [P(0, 0), P(20, 0), P(40, 0), P(60, 0)];
    const h = [[P(0, 0), P(5, 0)], [P(15, 0), P(20, 8)], [P(35, 0), P(45, 0)], [P(55, 0), P(60, 0)]];   // a kink at the 2nd point
    const e = ed.store.add({ type: 'spline', closed: false, pts, h } as Shape) as any; ed.store.emit();
    for (let k = 0; k < 5; k++) smoothDab(ed, P(20, 0), 'smooth', 0.75, 6);
    const [hi, ho] = e.h[1], cross = (ho.x - e.pts[1].x) * (e.pts[1].y - hi.y) - (ho.y - e.pts[1].y) * (e.pts[1].x - hi.x);
    expect(Math.abs(cross)).toBeLessThan(1);           // in and out handles nearly in line → smooth
    smoothDab(ed, P(40, 0), 'sharpen', 1, 6);
    expect(e.h[2][0]).toEqual(e.pts[2]); expect(e.h[2][1]).toEqual(e.pts[2]);
  });
});
