import { describe, it, expect } from 'vitest';
import { matchMaterial, thicknessIn, materialWords, jobLabel } from '../src/laser/jobinfo';
import { START_SETTINGS, type MyMaterial } from '../src/laser/machine';

const mat = (id: string, name: string, thickness?: number): MyMaterial => ({ id, name, thickness, colors: {}, phase: structuredClone(START_SETTINGS) });
const mine = [mat('a', '3 mm MDF'), mat('b', '6 mm MDF'), mat('c', 'Birch ply', 3), mat('d', 'Clear acrylic 3mm')];

describe('job sent with a file: finding the right material', () => {
  it('reads the thickness from a name', () => {
    expect(thicknessIn('3 mm MDF')).toBe(3); expect(thicknessIn('Acrylic 1.5mm')).toBe(1.5); expect(thicknessIn('MDF')).toBe(0);
    expect(materialWords('3 mm Birch-Ply')).toEqual(['birch', 'ply']);
  });
  it('picks the material and thickness asked for', () => {
    expect(matchMaterial({ material: 'MDF', thickness: 6 }, mine).map(c => c.value)).toEqual(['b']);
    expect(matchMaterial({ material: 'mdf', thickness: 3 }, mine)[0].value).toBe('a');
  });
  it('plywood finds ply, perspex finds acrylic, thickness from the field or the name', () => {
    expect(matchMaterial({ material: 'Plywood', thickness: 3 }, mine)[0].value).toBe('c');
    expect(matchMaterial({ material: 'Perspex', thickness: 3 }, mine)[0].value).toBe('d');
  });
  it('no thickness given: every thickness of that material', () => {
    expect(matchMaterial({ material: 'MDF', thickness: 0 }, mine).filter(c => !c.value.startsWith('ex:')).map(c => c.value)).toEqual(['a', 'b']);
  });
  it('falls back to the examples, and finds nothing for an unknown material', () => {
    expect(matchMaterial({ material: 'MDF', thickness: 3 }, [])[0].value).toBe('ex:mdf3');
    expect(matchMaterial({ material: 'Cork', thickness: 3 }, mine)).toEqual([]);
    expect(matchMaterial({ material: 'MDF', thickness: 4 }, mine)).toEqual([]);
  });
  it('a short label', () => {
    expect(jobLabel({ material: 'MDF', thickness: 3, copies: 2, at: '' })).toBe('3 mm MDF · 2 copies');
    expect(jobLabel({ material: 'Card', thickness: 0, copies: 1, at: '' })).toBe('Card');
  });
});
