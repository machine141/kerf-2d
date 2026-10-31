import { describe, it, expect } from 'vitest';
import { defaultState, laserFile, readLaserFile, materialsFor, START_SETTINGS, CONTROLLERS, BED_PRESETS } from '../src/laser/machine';

describe('laser profiles: more than one laser, shared by file', () => {
  const st = () => { const s = defaultState(); s.machine.setUp = true; s.machine.name = 'Room 4 laser';
    s.myMaterials = [{ id: 'a', name: '3 mm MDF', laser: s.machine.id, colors: {}, phase: structuredClone(START_SETTINGS) }, { id: 'b', name: 'Old card', colors: {}, phase: structuredClone(START_SETTINGS) }, { id: 'c', name: 'Other laser ply', laser: 'Lzzz', colors: {}, phase: structuredClone(START_SETTINGS) }];
    s.traces = [{ when: '', name: 'x', parts: [], box: { x0: 0, y0: 0, x1: 1, y1: 1 }, start: { x: 0, y: 0 } }]; return s; };
  it('a laser shows its own materials and older untagged ones, not another laser\'s', () => {
    expect(materialsFor(st()).map(m => m.id)).toEqual(['a', 'b']);
  });
  it('the shared file has the set-up and its materials, not the cut shadows, and asks to be set up again', () => {
    const f = laserFile(st());
    expect(f.kerfLaser).toBe(1); expect(f.machine.name).toBe('Room 4 laser'); expect(f.machine.setUp).toBe(false);
    expect((f.machine as any).traces).toBeUndefined(); expect(f.materials.map(m => m.id)).toEqual(['a', 'b']);
  });
  it('reading it gives a new laser id with its materials tagged, so nothing of yours is replaced', () => {
    const s = st(), got = readLaserFile(JSON.stringify(laserFile(s)))!;
    expect(got.machine.id).not.toBe(s.machine.id); expect(got.machine.bedW).toBe(600);
    expect(got.materials.every(m => m.laser === got.machine.id)).toBe(true); expect(got.materials.map(m => m.id)).not.toContain('a');
  });
  it('anything else is refused', () => {
    expect(readLaserFile('{"ents":[],"page":{}}')).toBeNull(); expect(readLaserFile('not json')).toBeNull();
    expect(readLaserFile('{"kerfLaser":1,"machine":{"bedW":0,"bedH":10}}')).toBeNull();
  });
  it('an old file without kind or controller gets sensible values', () => {
    const got = readLaserFile('{"kerfLaser":1,"machine":{"name":"Old","bedW":300,"bedH":200}}')!;
    expect(got.machine.kind).toBe('co2'); expect(got.machine.controller).toBe('ruida'); expect(got.machine.park).toBe('back-right');
  });
  it('every preset names a controller Kerf knows', () => { for (const b of BED_PRESETS) expect(CONTROLLERS[b.controller]).toBeTruthy(); });
});
