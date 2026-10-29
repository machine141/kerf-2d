import { describe, it, expect } from 'vitest';
import { P, dist, type Point } from '../src/geometry/vec';
import { Editor } from '../src/editor/editor';
import { ALL_TOOLS } from '../src/tools';
import { hingeAreas, makeCuts } from '../src/tools/hingebrush';
import type { Shape } from '../src/model/types';

function setup() {
  const ed = new Editor(ALL_TOOLS); ed.view = { k: 4, ox: 0, oy: 0, W: 1600, H: 1200 };
  const a = ed.doc.aids; a.attach.on = false; a.gridLock = false; a.stepLock = false;
  const I = (p: Point, extra = {}) => ({ sp: ed.w2s(p), shift: false, alt: false, ctrl: false, ...extra });
  const click = (p: Point) => { ed.pointerMove(p, I(p)); ed.pointerDown(p, 0, I(p)); ed.pointerUp(p, I(p)); };
  const rect = ed.store.add({ type: 'poly', closed: true, pts: [P(0, 0), P(120, 0), P(120, 60), P(0, 60)] } as Shape); ed.store.emit();
  ed.setTool('hbrush');
  return { ed, I, click, rect };
}
const dirs = (ed: Editor) => hingeAreas(ed).flatMap(a => a.slits).map(s => { const a = s[0], b = s[s.length - 1], l = dist(a, b) || 1; return Math.abs((b.x - a.x) / l); });

describe('Hinge brush tool', () => {
  it('fills an enclosed area by default; slits all run one way; the wheel turns them before clicking', () => {
    const { ed, click, I } = setup();
    expect(ed.opt.hbMode).toBe('area');
    ed.pointerMove(P(60, 30), I(P(60, 30)));
    ed.state.hbPrevT = 0; ed.tool.move!(ed, P(60, 30), I(P(60, 30)));
    for (let i = 0; i < 6; i++) ed.wheelTool(1, I(P(60, 30)));          // 6 × 15° = 90° from the auto angle
    click(P(60, 30));
    const a = hingeAreas(ed); expect(a.length).toBe(1);
    expect(a[0].angle).toBeCloseTo(0, 5);                                  // auto was 90° (across the long side) → turned to 0°
    expect(Math.min(...dirs(ed))).toBeGreaterThan(0.999);                  // every slit horizontal
  });
  it('overlapping paint of one colour is one area with one direction (no crossing slits)', () => {
    const { ed } = setup();
    ed.store.change(() => { ed.doc.hinge = [
      { kind: 'brush', pattern: 'straight', pts: [P(20, 30), P(60, 30)], r: 15 },
      { kind: 'brush', pattern: 'straight', pts: [P(50, 10), P(80, 50)], r: 15 }] as any; });
    const a = hingeAreas(ed); expect(a.length).toBe(1);
    const d = dirs(ed); expect(Math.max(...d) - Math.min(...d)).toBeLessThan(2e-3);
  });
  it('click a filled area to change it; after Make cuts the slits follow at once', () => {
    const { ed, click, I } = setup();
    click(P(60, 30)); makeCuts(ed);
    const n0 = ed.doc.ents.filter(e => e.gen === 'hinge').length; expect(n0).toBeGreaterThan(10);
    click(P(60, 30)); expect(ed.state.hbSel).toEqual([0]);                // selected
    ed.opt.hbPattern = 'wavy'; ed.tool.onOpt!(ed, 'hbPattern');
    expect(ed.doc.hinge![0]).toMatchObject({ pattern: 'wavy' });
    const wavy = ed.doc.ents.filter(e => e.gen === 'hinge'); expect(wavy.length).toBeGreaterThan(10); expect(wavy.every(e => e.type === 'poly')).toBe(true);
    ed.wheelTool(1, I(P(60, 30))); expect((ed.doc.hinge![0] as any).angle).toBeDefined();
    ed.tool.onKey!(ed, 'Delete', { shift: false, alt: false, ctrl: false });
    expect(ed.doc.hinge!.length).toBe(0); expect(ed.doc.ents.filter(e => e.gen === 'hinge').length).toBe(0);
  });
  it('deleting the slits takes the paint away too; deleting the shape hides its paint', () => {
    const { ed, click, rect } = setup();
    click(P(60, 30)); makeCuts(ed);
    ed.store.change(() => ed.store.remove(ed.doc.ents.filter(e => e.gen === 'hinge').map(e => e.id)));
    expect(ed.doc.hinge!.length).toBe(0); expect(hingeAreas(ed).length).toBe(0);
    ed.store.undo(); expect(ed.doc.hinge!.length).toBe(1);               // undo brings both back
    const { ed: ed2, click: click2, rect: r2 } = setup(); void rect;
    click2(P(60, 30)); expect(hingeAreas(ed2).length).toBe(1);
    ed2.store.change(() => ed2.store.remove([r2.id])); expect(hingeAreas(ed2).length).toBe(0);
  });
});
