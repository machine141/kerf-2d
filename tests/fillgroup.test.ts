import { describe, it, expect } from 'vitest';
import { P, type Point } from '../src/geometry/vec';
import { Editor } from '../src/editor/editor';
import { ALL_TOOLS } from '../src/tools';
import { regroupFills } from '../src/tools/bucket';

const circ = (c: Point, r: number) => ({ type: 'circle', c, r } as any);
const rect = (x: number, y: number, w: number, h: number) => ({ type: 'poly', closed: true, pts: [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)] } as any);
const line = (a: Point, b: Point) => ({ type: 'line', a, b } as any);
const info = { sp: P(0, 0), shift: false, alt: false, ctrl: false };
const fills = (ed: Editor) => ed.doc.ents.filter(e => e.type === 'fill');
/** Everything that moves when this object is clicked with Select (its whole outer group). */
const movesWith = (ed: Editor, id: string) => ed.withGroups([id]);
function paint(ed: Editor, at: Point) { ed.setTool('bucket'); ed.opt.paint = 'pink'; ed.tool.down!(ed, at, info); return fills(ed)[fills(ed).length - 1]; }

describe('Fills move with the shape they fill', () => {
  it('one closed shape and its hole', () => {
    const ed = new Editor(ALL_TOOLS); let body: any, hole: any; ed.store.change(() => { body = ed.store.add(circ(P(50, 50), 20)); hole = ed.store.add(circ(P(50, 62), 3)); });
    const f = paint(ed, P(50, 40));
    for (const id of [body.id, hole.id, f.id]) expect(movesWith(ed, id)).toEqual(new Set([body.id, hole.id, f.id]));
  });
  it('a square drawn as 4 separate lines', () => {
    const ed = new Editor(ALL_TOOLS); const ids: string[] = [];
    ed.store.change(() => { for (const [a, b] of [[P(0, 0), P(40, 0)], [P(40, 0), P(40, 40)], [P(40, 40), P(0, 40)], [P(0, 40), P(0, 0)]]) ids.push(ed.store.add(line(a, b)).id); });
    const f = paint(ed, P(20, 20));
    expect(movesWith(ed, ids[2])).toEqual(new Set([...ids, f.id]));
  });
  it('a frame made of overlapping rectangles (like a box side): each filled band moves with all the pieces', () => {
    const ed = new Editor(ALL_TOOLS); const ids: string[] = [];
    ed.store.change(() => { for (const r of [rect(0, 0, 150, 20), rect(0, 0, 20, 100), rect(130, 0, 20, 100), rect(0, 0, 150, 100)]) ids.push(ed.store.add(r).id); });
    const f = paint(ed, P(10, 50));    // the left band: edges from three of the rectangles
    const m = movesWith(ed, f.id); expect(m.has(f.id)).toBe(true);
    expect([...m].filter(id => ids.includes(id)).length).toBeGreaterThanOrEqual(2);
    for (const id of m) expect(movesWith(ed, id)).toEqual(m);
  });
  it('a key ring with a ring added (two shapes touching, not welded)', () => {
    const ed = new Editor(ALL_TOOLS); let body: any, ring: any, hole: any;
    ed.store.change(() => { body = ed.store.add(circ(P(50, 50), 20)); ring = ed.store.add(circ(P(50, 72), 6)); hole = ed.store.add(circ(P(50, 74), 2.5)); });
    const f = paint(ed, P(50, 45));
    const m = movesWith(ed, body.id); expect(m.has(f.id)).toBe(true); expect(m.has(ring.id)).toBe(true); expect(m.has(hole.id)).toBe(true);
  });
  it('a shape already in a group: the fill joins that group (nothing new wrapped around it)', () => {
    const ed = new Editor(ALL_TOOLS); let a: any, b: any;
    ed.store.change(() => { a = ed.store.add(rect(0, 0, 30, 30)); b = ed.store.add(rect(50, 0, 30, 30)); });
    ed.setSelection([a.id, b.id]); ed.groupSel(); const g = a.group.slice();
    const f = paint(ed, P(10, 10)); expect(f.group).toEqual(g); expect(movesWith(ed, b.id).has(f.id)).toBe(true);
  });
  it('moving the outline with Select moves the fill by the same amount', () => {
    const ed = new Editor(ALL_TOOLS); const ids: string[] = [];
    ed.store.change(() => { for (const [a, b] of [[P(0, 0), P(40, 0)], [P(40, 0), P(40, 40)], [P(40, 40), P(0, 40)], [P(0, 40), P(0, 0)]]) ids.push(ed.store.add(line(a, b)).id); });
    const f = paint(ed, P(20, 20)) as any, x0 = f.rings[0].map((p: Point) => p.x);
    ed.setSelection(ed.withGroups([ids[0]])); ed.moveSel(P(25, 5));
    const f2 = ed.store.byId(f.id) as any; expect(f2.rings[0].map((p: Point) => p.x)).toEqual(x0.map((x: number) => x + 25));
  });
});

describe('Old drawings', () => {
  it('a loose fill (saved before this fix) is grouped with its shapes when the file is opened', () => {
    const ed = new Editor(ALL_TOOLS); const ids: string[] = [];
    ed.store.change(() => { for (const [a, b] of [[P(0, 0), P(40, 0)], [P(40, 0), P(40, 40)], [P(40, 40), P(0, 40)], [P(0, 40), P(0, 0)]]) ids.push(ed.store.add(line(a, b)).id); });
    const f = paint(ed, P(20, 20)) as any;
    for (const e of ed.doc.ents) delete (e as any).group;            // as an old file would be
    expect(regroupFills(ed)).toBe(1);
    expect(ed.withGroups([ids[0]])).toEqual(new Set([...ids, f.id]));
    expect(regroupFills(ed)).toBe(0);
  });
});
