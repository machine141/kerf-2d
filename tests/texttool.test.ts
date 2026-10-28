import { describe, it, expect } from 'vitest';
import { P, dist, type Point } from '../src/geometry/vec';
import { Editor } from '../src/editor/editor';
import { ALL_TOOLS } from '../src/tools';
import { textShapes, anchorPoint } from '../src/text/text';
import { weldShapes, placeOnPath, snapPoints } from '../src/text/place';
import { flatten } from '../src/geometry/entity';
import { areaOf } from '../src/geometry/boolean';
import type { Shape, TextEnt } from '../src/model/types';
import { handles } from '../src/tools/select';
import { flipText } from '../src/tools/text';
import { offsetResult } from '../src/tools/offset';

function setup() {
  const ed = new Editor(ALL_TOOLS);
  ed.view = { k: 4, ox: 0, oy: 0, W: 1600, H: 1200 };
  const a = ed.doc.aids; a.attach.on = false; a.gridLock = false; a.stepLock = false; a.radial.on = false; a.track = false;
  const opened: [string, boolean][] = []; ed.textEditor = (id, n) => opened.push([id, n]);
  const I = (p: Point, extra: Partial<{ shift: boolean; alt: boolean }> = {}) => ({ sp: ed.w2s(p), shift: false, alt: false, ctrl: false, ...extra });
  const click = (p: Point) => { ed.pointerMove(p, I(p)); ed.pointerDown(p, 0, I(p)); ed.pointerUp(p, I(p)); };
  const drag = (a: Point, b: Point) => { ed.pointerMove(a, I(a)); ed.pointerDown(a, 0, I(a)); for (let k = 1; k <= 6; k++) { const q = P(a.x + (b.x - a.x) * k / 6, a.y + (b.y - a.y) * k / 6); ed.pointerMove(q, I(q)); } ed.pointerUp(b, I(b)); };
  return { ed, opened, click, drag, I };
}
const texts = (ed: Editor) => ed.doc.ents.filter(e => e.type === 'text') as TextEnt[];
const boxOf = (t: TextEnt) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const s of textShapes(t)) for (const p of flatten(s, 0.05).pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); } return { x0, y0, x1, y1 }; };

describe('Text tool', () => {
  it('a click in empty space makes straight text there and opens the typing box', () => {
    const { ed, opened, click } = setup(); ed.setTool('text'); ed.opt.txtSize = 12;
    click(P(50, 60));
    const [t] = texts(ed); expect(t.text).toBe('Text'); expect(t.size).toBe(12); expect(t.path).toBeUndefined();
    expect(dist(t.at, P(50, 60))).toBeLessThan(1e-9); expect(opened).toEqual([[t.id, true]]);
    // undo removes it in one step
    ed.store.undo(); expect(texts(ed).length).toBe(0);
  });
  it('clicking the bottom of a circle writes along it, upright and outside (badge style)', () => {
    const { ed, click } = setup();
    const c = ed.store.add({ type: 'circle', c: P(100, 100), r: 40 } as Shape); ed.store.emit();
    ed.setTool('text'); click(P(100, 140));
    const [top] = texts(ed); expect(top.path?.ref).toBe(c.id); expect(top.path?.flip).toBe(false); expect(top.path?.side).toBe('above');
    const outside = (t: TextEnt) => textShapes(t).every(s => flatten(s, 0.05).pts.every(p => dist(p, P(100, 100)) > 40 - 0.3));
    expect(outside(top)).toBe(true); expect(boxOf(top).y1).toBeGreaterThan(145);   // top text sits outside, above the circle
    const pl = placeOnPath(top.path!.geom, P(100, 60), 'above');
    expect(pl.flip).toBe(true); expect(pl.side).toBe('below');
    const bot: TextEnt = { ...top, path: { ...top.path!, pos: pl.pos, flip: pl.flip, side: pl.side } };
    const b = boxOf(bot); expect(outside(bot)).toBe(true); expect(b.y0).toBeLessThan(55);   // bottom text outside, below the circle
    expect(Math.abs((b.x0 + b.x1) / 2 - 100)).toBeLessThan(2);      // centred under it (letters are not symmetrical)
  });
  it('text on a line drawn right-to-left still reads left to right', () => {
    const geom = { type: 'line', a: P(100, 0), b: P(0, 0) } as Shape;
    expect(placeOnPath(geom, P(50, 0)).flip).toBe(true);
    expect(placeOnPath({ type: 'line', a: P(0, 0), b: P(100, 0) } as Shape, P(50, 0)).flip).toBe(false);
  });
  it('dragging path text slides it along, snapping to start, middle and end', () => {
    const { ed, drag } = setup();
    const ln = ed.store.add({ type: 'line', a: P(0, 0), b: P(200, 0) } as Shape); ed.store.emit();
    ed.setTool('text'); ed.opt.txtSize = 8; ed.pointerDown(P(150, 0), 0, { sp: ed.w2s(P(150, 0)), shift: false, alt: false, ctrl: false });
    const [t] = texts(ed); expect(t.path?.ref).toBe(ln.id);
    ed.setTool('select'); ed.setSelection([t.id]);
    const ap = anchorPoint(t)!; drag(P(ap.x, 4), P(101.5, 4));
    expect(t.path!.pos).toBeCloseTo(0.5, 9); expect(t.path!.anchor).toBe('center');
    drag(P(100, 4), P(1.5, 4));
    expect(t.path!.pos).toBe(0); expect(t.path!.anchor).toBe('start'); expect(boxOf(t).x0).toBeGreaterThan(-0.5); expect(boxOf(t).x0).toBeLessThan(2);
    drag(P(10, 4), P(70, 4));
    expect(t.path!.pos).toBeCloseTo(0.35, 2); expect(t.path!.anchor).toBe('center');
    // one undo step per drag
    ed.store.undo(); expect(t.path!.anchor).toBe('center');
    const u = texts(ed)[0]; expect(u.path!.anchor).toBe('start');
  });
  it('the text follows its line when the line is edited', () => {
    const { ed, click } = setup();
    const ln = ed.store.add({ type: 'line', a: P(0, 0), b: P(100, 0) } as Shape); ed.store.emit();
    ed.setTool('text'); click(P(50, 0));
    ed.store.change(() => { (ed.store.byId(ln.id) as any).b = P(100, 50); });
    const [t] = texts(ed); expect((t.path!.geom as any).b).toEqual(P(100, 50));
  });
  it('dropping straight text onto a line puts it on the line', () => {
    const { ed, click, drag } = setup();
    const ln = ed.store.add({ type: 'line', a: P(0, 100), b: P(200, 100) } as Shape); ed.store.emit();
    ed.setTool('text'); click(P(20, 20));
    const [t] = texts(ed); ed.setTool('select'); ed.setSelection([t.id]);
    const b = boxOf(t); drag(P((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2), P(120, 100));
    expect(t.path?.ref).toBe(ln.id); expect(t.path!.pos).toBeCloseTo(0.6, 2);
    expect(dist(t.at, P(20, 20))).toBeLessThan(1e-9);   // not moved as well
  });
  it('the wheel over selected text changes spacing (Shift: size, Alt: lift) as single undo steps', () => {
    const { ed, click, I } = setup(); ed.setTool('text'); click(P(0, 0));
    const [t] = texts(ed), b = boxOf(t), mid = P((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    ed.setTool('select'); ed.setSelection([t.id]); ed.pointerMove(mid, I(mid));
    for (let i = 0; i < 3; i++) expect(ed.wheelTool(1, I(mid))).toBe(true);
    expect(t.spacing).toBeCloseTo(0.9, 9);
    expect(ed.wheelTool(1, I(mid, { shift: true }))).toBe(true); expect(t.size).toBeCloseTo(10.5, 9);
    ed.store.undo(); const u = texts(ed)[0]; expect(u.size).toBe(10); expect(u.spacing).toBeCloseTo(0.9, 9);
    // not over the text: the wheel zooms as usual
    ed.pointerMove(P(300, 300), I(P(300, 300))); expect(ed.wheelTool(1, I(P(300, 300)))).toBe(false);
  });
  it('flip handles: other side of the line, and back to front', () => {
    const { ed, click } = setup();
    ed.store.add({ type: 'arc', c: P(0, 0), r: 50, a0: 0, a1: Math.PI } as Shape); ed.store.emit();
    ed.setTool('text'); click(P(0, 50));
    const [t] = texts(ed); ed.setTool('select'); ed.setSelection([t.id]);
    const before = boxOf(t), f0 = t.path!.flip;
    expect(f0).toBe(true);   // the arc runs right to left over the top, so the text was turned to read left to right
    const hs = handles(ed).map(h => h.k); expect(hs.sort()).toEqual(['flipH', 'flipV']);   // path text: only the flip handles
    flipText(ed, t, 'v');
    const after = boxOf(t); expect(after.y1).toBeLessThan(before.y1);   // now under the arc
    expect(Math.abs((after.x0 + after.x1) / 2)).toBeLessThan(1);
    flipText(ed, texts(ed)[0], 'h'); expect(texts(ed)[0].mirror).toBe(true);
    ed.store.undo(); ed.store.undo(); expect(texts(ed)[0].path!.flip).toBe(f0); expect(texts(ed)[0].mirror).toBeFalsy();
  });
  it('options in the strip apply to the selected text', () => {
    const { ed, click } = setup(); ed.setTool('text'); click(P(0, 0));
    const [t] = texts(ed); ed.opt.txtFont = 'pacifico'; ed.tool.onOpt!(ed, 'txtFont'); expect(t.font).toBe('pacifico');
    ed.opt.txtAlign = 'center'; ed.tool.onOpt!(ed, 'txtAlign'); expect(t.align).toBe('center');
  });
  it('snap points: start / middle / end of a line, top / bottom / sides of a circle', () => {
    expect(snapPoints({ type: 'line', a: P(0, 0), b: P(10, 0) } as Shape, false).map(s => s.label)).toEqual(['start', 'middle', 'end']);
    const c = snapPoints({ type: 'circle', c: P(0, 0), r: 10 } as Shape, false);
    expect(c.map(s => s.label)).toEqual(['top', 'bottom', 'left', 'right']);
    expect(dist(c[0].p, P(0, 10))).toBeLessThan(0.05);
  });
  it('weld joins overlapping script letters but keeps the holes in letters', () => {
    const t = { type: 'text', text: 'Bo', font: 'fredoka', size: 20, spacing: -6, lineSpacing: 1.6, align: 'left', at: P(0, 0), angle: 0 } as unknown as TextEnt;
    const parts = textShapes(t), w = weldShapes(parts);
    expect(parts.length).toBe(4);           // B (outline + hole), o (outline + hole)
    expect(w.length).toBe(3);               // B and o joined into one outline; both holes kept
    const big = w.map(areaOf).sort((a, b) => b - a);
    expect(big[0]).toBeLessThan(areaOf(parts[0]) + areaOf(parts[2]));   // they overlapped
    expect(big[1]).toBeGreaterThan(50); expect(big[2]).toBeGreaterThan(25);
  });
  it('new text uses a plain, easy-to-read font by default', () => {
    const { ed, click } = setup(); ed.setTool('text'); click(P(0, 0));
    expect(texts(ed)[0].font).toBe('arimo');
  });
  it('selecting text shows the text settings in the option bar (Select tool)', () => {
    const { ed, click } = setup(); ed.setTool('text'); click(P(0, 0));
    ed.setTool('select'); ed.setSelection([]);
    const shown = () => (ed.tool.options || []).filter(o => !o.show || o.show(ed)).map(o => o.key);
    expect(shown()).toEqual([]);
    ed.setSelection([texts(ed)[0].id]);
    expect(shown()).toEqual(['txtFont', 'txtSize', 'txtSpacing', 'txtAlign', 'txtEngrave']);
    ed.opt.txtSize = 25; ed.tool.onOpt!(ed, 'txtSize'); expect(texts(ed)[0].size).toBe(25);
  });
  it('contour of spaced-out text with a line drawn through it is one outline round everything', () => {
    const { ed } = setup();
    const t = ed.store.add({ type: 'text', text: 'A B', font: 'arimo', size: 20, spacing: 12, lineSpacing: 1.6, align: 'left', at: P(0, 0), angle: 0 } as Shape) as TextEnt;
    const tb = boxOf(t);
    const ln = ed.store.add({ type: 'spline', closed: false, pts: [P(-4, 10), P(tb.x1 / 2, 14), P(tb.x1 + 4, 10)], h: [[P(-4, 10), P(10, 12)], [P(tb.x1 / 2 - 15, 14), P(tb.x1 / 2 + 15, 14)], [P(tb.x1 - 10, 12), P(tb.x1 + 4, 10)]] } as Shape);
    ed.store.emit();
    ed.setSelection([t.id]); ed.setTool('offset'); ed.opt.offD = 3; ed.opt.offSide = 'out'; ed.opt.offCount = 1; ed.opt.offFollow = false;
    expect([...ed.state.off.ids]).toContain(ln.id);
    const res = offsetResult(ed, P(-50, -50));
    const outer = res.filter(s => { const f = flatten(s, 0.05).pts; const x0 = Math.min(...f.map(p => p.x)), x1 = Math.max(...f.map(p => p.x)); return x0 < tb.x0 && x1 > tb.x1; });
    expect(outer.length).toBe(1);           // one piece round all the letters
    // without the line and with "Join letters" off, the letters stay apart (no outline goes round them all)
    ed.state.off = null; ed.setTool('select'); ed.store.remove([ln.id]); ed.store.emit(); ed.opt.offJoin = false; ed.setSelection([t.id]); ed.setTool('offset');
    const res2 = offsetResult(ed, P(-50, -50));
    expect(res2.filter(s => { const f = flatten(s, 0.05).pts; return Math.min(...f.map(p => p.x)) < tb.x0 && Math.max(...f.map(p => p.x)) > tb.x1; }).length).toBe(0);
  });
  it('Join letters: spaced-out text contours as one piece, without loops inside the letters', () => {
    const { ed } = setup();
    const t = ed.store.add({ type: 'text', text: 'Bob', font: 'arimo', size: 20, spacing: 10, lineSpacing: 1.6, align: 'left', at: P(0, 0), angle: 0 } as Shape) as TextEnt;
    ed.store.emit(); const tb = boxOf(t);
    ed.setSelection([t.id]); ed.opt.offD = 3; ed.opt.offSide = 'out'; ed.setTool('offset');
    const res = offsetResult(ed, P(-50, -50));
    expect(res.length).toBe(1);
    const f = flatten(res[0], 0.05).pts; expect(Math.min(...f.map(p => p.x))).toBeLessThan(tb.x0); expect(Math.max(...f.map(p => p.x))).toBeGreaterThan(tb.x1);
  });
  it('badge: text along the top and bottom of a circle (circle deleted) contours as a ring — outside and inside', () => {
    const { ed, click } = setup();
    const c = ed.store.add({ type: 'circle', c: P(100, 100), r: 40 } as Shape); ed.store.emit();
    ed.setTool('text'); ed.opt.txtSize = 10;
    click(P(100, 140)); texts(ed)[0].text = 'HAPPY BIRTHDAY';
    click(P(100, 60)); texts(ed)[1].text = 'SAM';
    ed.setTool('select'); ed.store.remove([c.id]); ed.store.emit();
    ed.setSelection(texts(ed).map(t => t.id)); ed.opt.offD = 3; ed.opt.offSide = 'out'; ed.setTool('offset');
    const res = offsetResult(ed, P(0, 0)), rad = (s: Shape) => { const f = flatten(s, 0.05).pts; return f.reduce((a, p) => a + dist(p, P(100, 100)), 0) / f.length; };
    expect(res.length).toBe(2);                                   // one outer outline + the hole in the middle
    const r = res.map(rad).sort((a, b) => a - b);
    expect(r[0]).toBeLessThan(40); expect(r[1]).toBeGreaterThan(50);
  });
  it('a circle drawn through the letters is used as a line: contours on both sides of it', () => {
    const { ed, click } = setup();
    ed.setTool('text'); ed.opt.txtSize = 10;
    ed.store.add({ type: 'circle', c: P(100, 100), r: 40 } as Shape); ed.store.emit();
    click(P(100, 140)); texts(ed)[0].text = 'TOP'; click(P(100, 60)); texts(ed)[1].text = 'BOTTOM';
    const ring = ed.store.add({ type: 'circle', c: P(100, 100), r: 45 } as Shape); ed.store.emit();   // through the middle of the letters
    ed.setTool('select'); ed.setSelection([texts(ed)[0].id]); ed.opt.offJoin = false; ed.opt.offD = 3; ed.opt.offSide = 'out'; ed.setTool('offset');
    expect(ed.state.off.ids.has(ring.id)).toBe(true);
    const res = offsetResult(ed, P(0, 0)), rr = res.map(s => { const f = flatten(s, 0.05).pts.map(p => dist(p, P(100, 100))); return [Math.min(...f), Math.max(...f)]; });
    expect(rr.some(([a, b]) => b < 43)).toBe(true);                // the inside contour runs round inside the ring
    expect(rr.some(([, b]) => b > 52)).toBe(true);                // and the outside one round the outside
  });
});
