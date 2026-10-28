import { describe, it, expect } from 'vitest';
import { P } from '../src/geometry/vec';
import { textShapes, layoutLine, nearestPos, expandText, TEXT_DEFAULTS } from '../src/text/text';
import { FONTS } from '../src/text/fonts';
import { bbox, unionBox, prims } from '../src/geometry/entity';
import { affEnt, affScale, affMir } from '../src/geometry/affine';
import type { Shape } from '../src/model/types';

const T = (o: any) => ({ type: 'text', text: 'HELLO', ...TEXT_DEFAULTS, at: P(0, 0), angle: 0, ...o }) as any;
const box = (s: Shape[]) => unionBox(s.map(x => bbox(x)))!;
const cx = (s: Shape[]) => { const b = box(s); return (b.x0 + b.x1) / 2; };
const cy = (s: Shape[]) => { const b = box(s); return (b.y0 + b.y1) / 2; };

describe('text', () => {
  it('every font loads and size is the capital height', () => {
    for (const f of FONTS) {
      const s = textShapes(T({ text: 'H', font: f.id, size: 10 })), b = box(s);
      expect(s.length, f.id).toBeGreaterThan(0);
      expect(b.y1, f.id).toBeGreaterThan(9.5); expect(b.y1, f.id).toBeLessThan(10.6);      // the capital reaches the size
      if (f.id !== 'caveat') expect(b.y0, f.id).toBeGreaterThan(-0.6);                    // (handwriting dips a little)
    }
  });
  it('spacing adds between letters; alignment and lines', () => {
    const w0 = layoutLine('fredoka', 'HELLO', 10, 0).width, w2 = layoutLine('fredoka', 'HELLO', 10, 2).width;
    expect(w2 - w0).toBeCloseTo(8, 6);
    expect(cx(textShapes(T({ align: 'center', at: P(50, 0) })))).toBeCloseTo(50, 0);
    const r = box(textShapes(T({ align: 'right', at: P(50, 0) }))); expect(r.x1).toBeLessThan(50.5); expect(r.x1).toBeGreaterThan(48);
    const two = box(textShapes(T({ text: 'HI\nHI', size: 10, lineSpacing: 1.6 }))); expect(two.y1 - two.y0).toBeCloseTo(26, 0);
  });
  it('on a straight line: centred, sitting above / on / below', () => {
    const geom = { type: 'line', a: P(0, 0), b: P(100, 0) } as Shape, base = { geom, pos: 0.5, anchor: 'center', flip: false, effect: 'rainbow', lift: 0 };
    const above = textShapes(T({ path: { ...base, side: 'above' } })), on = textShapes(T({ path: { ...base, side: 'on' } })), below = textShapes(T({ path: { ...base, side: 'below' } }));
    expect(cx(above)).toBeCloseTo(50, 0); expect(box(above).y0).toBeGreaterThan(-0.6);
    expect(cy(on)).toBeCloseTo(0, 0); expect(box(below).y1).toBeLessThan(0.6);
    const start = box(textShapes(T({ path: { ...base, side: 'above', pos: 0, anchor: 'start' } }))); expect(start.x0).toBeGreaterThan(-0.5); expect(start.x0).toBeLessThan(2);
  });
  it('circle: top text and bottom text both read the right way up', () => {
    const geom = { type: 'circle', c: P(0, 0), r: 30 } as Shape;
    const top = textShapes(T({ text: 'HAPPY', path: { geom, pos: nearestPos(geom, P(0, 30)), anchor: 'center', side: 'above', flip: false, effect: 'rainbow', lift: 0 } }));
    expect(Math.abs(cx(top))).toBeLessThan(1); expect(box(top).y1).toBeGreaterThan(39.5); expect(box(textShapes(T({ text: 'P', path: { geom, pos: nearestPos(geom, P(0, 30)), anchor: 'center', side: 'above', flip: false, effect: 'rainbow', lift: 0 } }))).y0).toBeGreaterThan(29.5);
    // reading order: first letter on the left
    expect(cx([top[0]])).toBeLessThan(cx([top[top.length - 1]]));
    const bot = textShapes(T({ text: 'MAX', path: { geom, pos: nearestPos(geom, P(0, -30)), anchor: 'center', side: 'above', flip: true, effect: 'rainbow', lift: 0 } }));
    expect(Math.abs(cx(bot))).toBeLessThan(1); expect(box(bot).y0).toBeGreaterThan(-30.5); expect(box(bot).y1).toBeLessThan(-16);
    expect(cx([bot[0]])).toBeLessThan(cx([bot[bot.length - 1]]));          // M left of X: upright, not upside down
  });
  it('the four effects and the single-line font', () => {
    const geom = { type: 'arc', c: P(0, 0), r: 40, a0: Math.PI / 6, a1: 5 * Math.PI / 6 } as Shape;
    for (const effect of ['rainbow', 'stretch', 'skew', 'stair']) {
      const s = textShapes(T({ path: { geom, pos: 0.5, anchor: 'center', side: 'above', flip: false, effect, lift: 0 } }));
      expect(s.length, effect).toBeGreaterThan(4); expect(Math.abs(cx(s)), effect).toBeLessThan(1);
    }
    const line = textShapes(T({ font: 'kerf-line', text: 'AB' })); expect(line.every(s => s.type === 'line' || (s.type === 'poly' && !s.closed))).toBe(true);
  });
  it('exports as outlines, scales and mirrors', () => {
    const t = { ...T({ text: 'KEY' }), id: 't1', layer: 'L1', color: 'red', w: 0.1 };
    const ex = expandText([t]); expect(ex.length).toBeGreaterThan(2); expect(ex.every((e: any) => e.type !== 'text' && e.color === 'red')).toBe(true);
    const big = affEnt(t as any, affScale(P(0, 0), 2, 2)) as any; expect(big.size).toBeCloseTo(20, 9);
    const m = affEnt(t as any, affMir(P(0, 0), P(0, 1))) as any; expect(m.mirror).toBe(true); expect(cx(textShapes(m))).toBeCloseTo(-cx(textShapes(t as any)), 6);
    expect(prims(t as any).length).toBeGreaterThan(10);
  });
});
