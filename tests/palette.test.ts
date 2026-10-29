import { describe, it, expect } from 'vitest';
import { P, type Point } from '../src/geometry/vec';
import { newDoc, modeOf, colorLabel, COLORS, type Doc } from '../src/model/types';
import { exportSVG } from '../src/io/svg';
import { exportDXF } from '../src/io/dxf';
import { computeHinge, BRUSH_DEFAULTS, bendCheck, suggest, MATERIALS } from '../src/hinge/brush';

const doc = (): Doc => { const d = newDoc(); d.ents.push(
  { id: 'a', layer: d.current, color: 'red', w: 0.1, type: 'circle', c: P(50, 50), r: 20 } as any,
  { id: 'b', layer: d.current, color: 'slate', w: 0.1, type: 'line', a: P(0, 0), b: P(10, 10) } as any,
  { id: 'c', layer: d.current, color: 'yellow', w: 0.1, type: 'circle', c: P(100, 50), r: 10 } as any); return d; };

describe('colour palette and laser settings', () => {
  it('has 23 colours with names and default laser settings', () => {
    expect(Object.keys(COLORS).length).toBe(23);
    const d = newDoc(); expect(modeOf(d, 'red')).toBe('cut'); expect(modeOf(d, 'blue')).toBe('score'); expect(colorLabel(d, 'blue')).toBe('Blue · Engrave line');
  });
  it('"Don\'t cut" colours are left out of SVG and DXF; "Engrave area" shapes are filled in SVG', () => {
    const d = doc(); d.modes = { slate: 'off' };
    const svg = exportSVG(d), dxf = exportDXF(d);
    expect(svg).not.toContain('<line'); expect(dxf.split('\n').filter(l => l.trim() === 'LINE').length).toBe(0);
    expect(svg).toMatch(/<circle[^>]*r="10"[^>]*fill="#E6C200"/);
    expect(svg).toMatch(/<circle[^>]*r="20"(?![^>]*fill=)[^>]*\/>/);
  });
});
describe('hinge brush: two-way patterns and the bend check', () => {
  const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
  const env = { lines: [{ pts: rect(0, 0, 120, 80), closed: true }] };
  const segCross = (a: Point, b: Point, c: Point, d: Point) => { const o = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x); return o(a, b, c) * o(a, b, d) < -1e-9 && o(c, d, a) * o(c, d, b) < -1e-9; };
  for (const pattern of ['lattice', 'honeycomb'] as const) it(`${pattern}: cuts never cross each other`, () => {
    const [a] = computeHinge([{ kind: 'area', pattern, pts: rect(0, 0, 120, 80), at: P(60, 40) }], env, BRUSH_DEFAULTS, P(60, 40));
    expect(a.slits.length).toBeGreaterThan(30);
    const segs = a.slits.flatMap(s => s.slice(1).map((q, i) => [s[i], q] as [Point, Point]));
    let crossings = 0; for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (segCross(segs[i][0], segs[i][1], segs[j][0], segs[j][1])) crossings++;
    expect(crossings).toBe(0);
  });
  it('bend check: red when the wood between slits is too thin, orange when it cannot bend as tight as asked', () => {
    const ms = { mat: MATERIALS[0], t: 3, kerf: 0.2 };
    expect(bendCheck('straight', { ...BRUSH_DEFAULTS, pitch: 1 }, ms).state).toBe('bad');
    const ok = bendCheck('straight', BRUSH_DEFAULTS, ms); expect(ok.state).toBe('ok');
    expect(bendCheck('straight', BRUSH_DEFAULTS, ms, ok.Rmin / 2).state).toBe('tight');
    const s = suggest(ms, 30); expect(s.ok).toBe(true); expect(bendCheck('straight', s, ms, 30).state).toBe('ok');
  });
});
