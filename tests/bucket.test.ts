import { describe, it, expect } from 'vitest';
import { P, type Point } from '../src/geometry/vec';
import { Editor } from '../src/editor/editor';
import { ALL_TOOLS } from '../src/tools';
import { areaAt } from '../src/tools/bucket';
import { affEnt, affMove } from '../src/geometry/affine';
import { exportSVG } from '../src/io/svg';
import { exportDXF } from '../src/io/dxf';
import { bbox } from '../src/geometry/entity';
import { findParts } from '../src/nest/parts';
import { checkDesign } from '../src/classroom/checks';
import { makeCircle } from '../src/tools/draw';

const circ = (c: Point, r: number) => ({ type: 'circle', c, r } as any);
const rect = (x: number, y: number, w: number, h: number) => ({ type: 'poly', closed: true, pts: [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)] } as any);
const info = { sp: P(0, 0), shift: false, alt: false, ctrl: false };

describe('Paint bucket', () => {
  it('fills a key ring body and leaves its hole clear; clicking in the hole fills just the hole', () => {
    const shapes = [circ(P(50, 50), 20), circ(P(50, 62), 3)];
    const a = areaAt(shapes, P(50, 40))!; expect(a.rings.length).toBe(2);
    const h = areaAt(shapes, P(50, 62))!; expect(h.rings.length).toBe(1);
  });
  it('an outline with a gap is reported, not filled', () => {
    const open = { type: 'poly', closed: false, pts: [P(0, 0), P(40, 0), P(40, 40), P(0, 40), P(0, 1)] } as any;
    const a = areaAt([open], P(20, 20))!; expect(a.rings.length).toBe(0); expect(a.reason).toBeTruthy();
  });
  it('fills an area made by crossing lines (no closed shape needed)', () => {
    const lines = [[P(0, 0), P(40, 0)], [P(35, -5), P(35, 40)], [P(40, 35), P(0, 35)], [P(5, 40), P(5, -5)]].map(([a, b]) => ({ type: 'line', a, b } as any));
    const a = areaAt(lines, P(20, 20))!; expect(a.rings.length).toBe(1);
  });
  it('the tool: click fills, click again with another colour recolours, Alt+click removes; one undo step each', () => {
    const ed = new Editor(ALL_TOOLS); ed.store.change(() => { ed.store.add(circ(P(50, 50), 20)); ed.store.add(circ(P(50, 62), 3)); });
    ed.setTool('bucket'); ed.opt.paint = 'mint'; ed.tool.down!(ed, P(50, 40), info);
    const fills = () => ed.doc.ents.filter(e => e.type === 'fill') as any[];
    expect(fills().length).toBe(1); expect(fills()[0].paint).toBe('mint'); expect(fills()[0].rings.length).toBe(2);
    ed.opt.paint = 'sky'; ed.tool.down!(ed, P(50, 40), info); expect(fills().length).toBe(1); expect(fills()[0].paint).toBe('sky');
    ed.tool.down!(ed, P(50, 40), { ...info, alt: true }); expect(fills().length).toBe(0);
    ed.store.undo(); expect(fills().length).toBe(1);
  });
  it('a fill moves and turns with its shape, exports to SVG as a solid colour, is left out of DXF, nests with its outline, and is not a "cut"', () => {
    const f = { id: 'f', layer: 'L1', color: 'ink', w: 0.1, type: 'fill', paint: 'pink', rings: [[P(0, 0), P(10, 0), P(10, 10), P(0, 10)]] } as any;
    const m: any = affEnt(f, affMove(P(5, 5))); expect(m.rings[0][0]).toEqual(P(5, 5));
    expect(bbox(f)).toEqual({ x0: 0, y0: 0, x1: 10, y1: 10 });
    const ed = new Editor(ALL_TOOLS); ed.store.change(() => { const o = ed.store.add(rect(0, 0, 10, 10)); void o; ed.doc.ents.push({ ...f, layer: ed.doc.current }); });
    const svg = exportSVG(ed.doc); expect(svg).toMatch(/fill="#F7B9D0" fill-rule="evenodd" stroke="none"/);
    expect(exportSVG(ed.doc, { skipFills: true })).not.toMatch(/#F7B9D0/);
    expect(exportDXF(ed.doc)).not.toMatch(/F7B9D0/);
    expect(findParts(ed.doc.ents, () => null).length).toBe(1);
    const onlyFill = new Editor(ALL_TOOLS); onlyFill.doc.ents.push({ ...f, layer: onlyFill.doc.current });
    expect(checkDesign(onlyFill.doc).some(c => c.level === 'stop')).toBe(true);
  });
});

describe('Circle: corner to corner by default', () => {
  it('two corners give a circle (even if the box is not quite square); Shift makes an oval', () => {
    const ed = new Editor(ALL_TOOLS); expect(ed.opt.circFrom).toBe('box');
    const c: any = makeCircle([P(0, 0), P(20, 20)], { shift: false, alt: false }, 'box'); expect(c.type).toBe('circle'); expect(c.c).toEqual(P(10, 10)); expect(c.r).toBe(10);
    const d: any = makeCircle([P(0, 0), P(30, 19.9)], { shift: false, alt: false }, 'box'); expect(d.type).toBe('circle'); expect(d.r).toBe(15);
    const e: any = makeCircle([P(0, 0), P(30, 20)], { shift: true, alt: false }, 'box'); expect(e.type).toBe('ellipse'); expect([e.rx, e.ry]).toEqual([15, 10]);
  });
});

describe('Paint bucket keeps the fill with its shape', () => {
  it('fill, outline and hole become one group; moving the outline moves the fill', () => {
    const ed = new Editor(ALL_TOOLS); let ids: string[] = [];
    ed.store.change(() => { ids = [ed.store.add(circ(P(50, 50), 20)).id, ed.store.add(circ(P(50, 62), 3)).id]; });
    ed.setTool('bucket'); ed.tool.down!(ed, P(50, 40), info);
    const f = ed.doc.ents.find(e => e.type === 'fill')!, o = ed.store.byId(ids[0])!, h = ed.store.byId(ids[1])!;
    expect(f.group).toEqual(o.group); expect(h.group).toEqual(o.group);
    ed.setSelection([...ed.withGroups([ids[0]])]); expect(ed.sel.size).toBe(3);
    ed.moveSel(P(100, 0)); expect((ed.doc.ents.find(e => e.type === 'fill') as any).rings[0].every((p: Point) => p.x > 100)).toBe(true);
  });
});
