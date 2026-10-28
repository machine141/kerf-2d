import { describe, it, expect } from 'vitest';
import { P, dist } from '../src/geometry/vec';
import { dimGeom, dimValue } from '../src/geometry/dims';
import { exportDXF, importDXF } from '../src/io/dxf';
import { exportSVG } from '../src/io/svg';
import { newDoc } from '../src/model/types';

const D = { dec: 2, textH: 3.5, arrow: 2.5, color: 'grey', unit: 'mm' } as any;
describe('dimensions', () => {
  it('show units', () => {
    expect(dimValue(20, D)).toBe('20 mm');
    expect(dimValue(25.4, { ...D, unit: 'in' })).toBe('1 in');
    expect(dimValue(12.345, { ...D, unit: 'none' })).toBe('12.35');
    expect(dimGeom({ mode: 'h', p1: P(0, 0), p2: P(40, 0), off: P(0, 10) }, D).text.str).toBe('40 mm');
  });
  it('radius and diameter of a hole', () => {
    const r = dimGeom({ mode: 'r', p1: P(50, 50), p2: P(56, 50), off: P(70, 70) }, D);
    expect(r.val).toBe(6); expect(r.text.str).toBe('R6 mm');
    const d = dimGeom({ mode: 'd', p1: P(50, 50), p2: P(56, 50), off: P(70, 70) }, D);
    expect(d.val).toBe(12); expect(d.text.str).toBe('Ø12 mm');
    // the leader crosses the full diameter: from the far side of the circle out to the label
    const lead = d.lines[0]; expect(dist(lead[0], P(50, 50))).toBeCloseTo(6, 9); expect(lead[1]).toEqual(P(70, 70));
  });
  it('diameter symbol survives DXF (as %%c), SVG keeps Ø, and dimensions can be left out', () => {
    const doc = newDoc();
    doc.ents.push({ id: 'c', layer: 'L1', color: 'ink', w: 0.1, type: 'circle', c: P(50, 50), r: 6 } as any,
      { id: 'd', layer: 'L1', color: 'grey', w: 0.1, type: 'dim', mode: 'd', p1: P(50, 50), p2: P(56, 50), off: P(70, 70) } as any);
    expect(exportDXF(doc)).toContain('%%c12 mm'); expect(exportSVG(doc)).toContain('Ø12 mm');
    const cutOnly = importDXF(exportDXF(doc, { skipDims: true }));
    expect(cutOnly.length).toBe(1); expect(cutOnly[0].type).toBe('circle');
    expect(exportSVG(doc, { skipDims: true })).not.toContain('Ø');
  });
  it('new drawings: black lines, grey dimensions, nearest snap on', () => {
    const d = newDoc(); expect(d.attrs.color).toBe('ink'); expect(d.dim.color).toBe('grey'); expect(d.aids.attach.nearest).toBe(true);
  });
});
