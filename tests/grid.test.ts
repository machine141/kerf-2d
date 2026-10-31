import { describe, it, expect } from 'vitest';
import { gridSnap, isoPt, isoDx, sheetCentre } from '../src/snap/grid';
import { P } from '../src/geometry/vec';
import { SHEET_GAP } from '../src/model/types';

const page = { w: 297, h: 210 };
describe('background grids and grid lock', () => {
  it('squares and dots snap to whole steps', () => {
    for (const style of ['lines', 'dots'] as const) expect(gridSnap(P(13.2, 26.9), { show: true, spacing: 5, style })).toEqual(P(15, 25));
  });
  it('isometric points are the same distance apart along every grid line', () => {
    const s = 10, a = isoPt(s, 0, 0), up = isoPt(s, 0, 1), right30 = isoPt(s, 1, 0), down30 = isoPt(s, 1, -1);
    for (const q of [up, right30, down30]) expect(Math.hypot(q.x - a.x, q.y - a.y)).toBeCloseTo(s, 9);
    // the line to the next column climbs at 30°
    expect(Math.atan2(right30.y - a.y, right30.x - a.x) * 180 / Math.PI).toBeCloseTo(30, 9);
    expect(Math.atan2(down30.y - a.y, down30.x - a.x) * 180 / Math.PI).toBeCloseTo(-30, 9);
  });
  it('isometric lock lands on the nearest isometric point', () => {
    const s = 10;
    for (const style of ['iso', 'isodots'] as const) {
      const q = gridSnap(P(isoDx(s) * 3 + 1, 35 + 2), { show: true, spacing: s, style });
      expect(q.x).toBeCloseTo(isoDx(s) * 3, 9); expect(q.y).toBeCloseTo(35, 9);   // column 3 is odd: rows at 5, 15, 25, 35…
    }
    // whatever the point, the answer is never further than one spacing away and is a grid point
    for (let n = 0; n < 200; n++) {
      const p = P(Math.sin(n) * 150 + 150, Math.cos(n * 1.7) * 100 + 100), q = gridSnap(p, { show: true, spacing: s, style: 'iso' });
      expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeLessThanOrEqual(s * 0.58);
      const i = Math.round(q.x / isoDx(s)), off = (((i % 2) + 2) % 2) * s / 2;
      expect(Math.abs((q.y - off) / s - Math.round((q.y - off) / s))).toBeLessThan(1e-9);
    }
  });
  it('circles snap to rings and spokes round the middle of the sheet', () => {
    const c = P(page.w / 2, page.h / 2);
    const q = gridSnap(P(c.x + 19, c.y + 3), { show: true, spacing: 10, style: 'polar', spokes: 15 }, page);
    expect(q.x).toBeCloseTo(c.x + 20 * Math.cos(Math.PI / 12), 9); expect(q.y).toBeCloseTo(c.y + 20 * Math.sin(Math.PI / 12), 9);
    expect(gridSnap(P(c.x + 2, c.y - 1), { show: true, spacing: 10, style: 'polar' }, page)).toEqual(c);
    // the second sheet has its own middle
    expect(sheetCentre(P(page.w + SHEET_GAP + 10, 5), page)).toEqual(P(page.w + SHEET_GAP + page.w / 2, page.h / 2));
  });
});
