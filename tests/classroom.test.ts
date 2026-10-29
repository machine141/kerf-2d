import { describe, it, expect } from 'vitest';
import { P, type Point } from '../src/geometry/vec';
import { newDoc, type Doc } from '../src/model/types';
import { checkDesign, canHandIn } from '../src/classroom/checks';
import { handInFile, readDesign, newestOnly, classCsv, classEntry } from '../src/classroom/handin';
import { nestSheets, type NestJob } from '../src/nest/nest';
import { nestShape, findParts } from '../src/nest/parts';
import { sheetDoc, sheetOf } from '../src/io/sheets';

const circ = (c: Point, r: number, n = 48): Point[] => Array.from({ length: n }, (_, i) => P(c.x + r * Math.cos(i * 2 * Math.PI / n), c.y + r * Math.sin(i * 2 * Math.PI / n)));
let seq = 0;
const poly = (pts: Point[], closed = true, color: any = 'ink'): any => ({ id: 'e' + (++seq), layer: 'L1', color, w: 0.1, type: 'poly', closed, pts });
const docOf = (...ents: any[]): Doc => { const d = newDoc(); d.ents = ents; return d; };

describe('Hand-in checks', () => {
  it('a good key ring: closed, with a hole, nothing thin → all ticks', () => {
    const cs = checkDesign(docOf(poly(circ(P(50, 50), 20)), poly(circ(P(50, 64), 3))));
    expect(cs.every(c => c.level === 'ok')).toBe(true); expect(canHandIn(cs)).toBe(true);
  });
  it('empty drawing or nothing in a cut colour cannot be handed in', () => {
    expect(canHandIn(checkDesign(docOf()))).toBe(false);
    expect(canHandIn(checkDesign(docOf(poly(circ(P(50, 50), 20), true, 'blue'))))).toBe(false);   // blue = engrave line
  });
  it('lines that don’t join up are found (and lines that do are fine)', () => {
    const gap = docOf(poly([P(0, 0), P(40, 0), P(40, 40)], false), poly([P(40, 40.5), P(0, 40), P(0, 0)], false));   // 0.5 mm gap
    const c1 = checkDesign(gap); expect(c1.some(c => c.level === 'warn' && /join up/.test(c.text))).toBe(true);
    const ok = docOf(poly([P(0, 0), P(40, 0), P(40, 40)], false), poly([P(40, 40), P(0, 40), P(0, 0)], false));
    expect(checkDesign(ok).some(c => c.level === 'ok' && /joins up/.test(c.text))).toBe(true);
  });
  it('no hole → warning (can still hand in)', () => {
    const cs = checkDesign(docOf(poly(circ(P(50, 50), 20)))); expect(cs.some(c => c.level === 'warn' && /No hole/.test(c.text))).toBe(true); expect(canHandIn(cs)).toBe(true);
  });
  it('a 1 mm stalk is thin; a 3 mm one is not; star points are not', () => {
    const stalk = (w: number) => docOf(poly([P(0, 0), P(30, 0), P(30, 30), P(15 + w / 2, 30), P(15 + w / 2, 50), P(15 - w / 2, 50), P(15 - w / 2, 30), P(0, 30)]));
    expect(checkDesign(stalk(1)).some(c => c.level === 'warn' && /thinner/.test(c.text))).toBe(true);
    expect(checkDesign(stalk(3)).some(c => c.level === 'warn' && /thinner/.test(c.text))).toBe(false);
    const star: Point[] = []; for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 12 : 30; star.push(P(r * Math.cos(a), r * Math.sin(a))); }
    expect(checkDesign(docOf(poly(star))).some(c => /thinner/.test(c.text) && c.level === 'warn')).toBe(false);
  });
  it('text set to cut gets a warning', () => {
    const t = { id: 't1', layer: 'L1', color: 'ink', w: 0.1, type: 'text', text: 'MIA', font: 'arimo', size: 8, spacing: 0, lineSpacing: 1.6, align: 'left', at: P(0, 0), angle: 0 };
    expect(checkDesign(docOf(poly(circ(P(10, 3), 25)), t)).some(c => /text is set to cut/i.test(c.text))).toBe(true);
  });
  it('bigger than the sheet cannot be handed in', () => {
    expect(canHandIn(checkDesign(docOf(poly([P(0, 0), P(400, 0), P(400, 10), P(0, 10)]))))).toBe(false);
  });
});

describe('Hand-in files', () => {
  it('file name and who made it go with the drawing; the teacher reads them back', () => {
    const d = docOf(poly(circ(P(50, 50), 20)), poly(circ(P(50, 64), 3)));
    const f = handInFile(d, 'Mia Jones', '9B', 'Star / key ring', checkDesign(d));
    expect(f.filename).toBe('9B - Mia Jones - Star key ring.json');
    const r = readDesign(f.filename, f.text); expect(r.error).toBeUndefined();
    expect([r.name, r.cls, r.title, r.owner]).toEqual(['Mia Jones', '9B', 'Star key ring', 'Mia Jones · 9B']);
    expect(r.doc.ents.length).toBe(2);
  });
  it('a plain saved drawing takes its name from the file name; junk files are reported', () => {
    const r = readDesign('7C - Sam Lee - Cat.json', JSON.stringify(docOf(poly(circ(P(0, 0), 10)))));
    expect([r.name, r.cls, r.title]).toEqual(['Sam Lee', '7C', 'Cat']);
    expect(readDesign('notes.json', '{"hello":1}').error).toBeTruthy();
  });
  it('the newest copy from each pupil wins', () => {
    const d = docOf(poly(circ(P(0, 0), 10))), a = readDesign('a.json', handInFile(d, 'Mia', '9B', 'One', []).text);
    const b = { ...a, at: '2099-01-01T00:00:00Z', file: 'b.json' };
    const c = readDesign('c.json', handInFile(d, 'Sam', '9B', 'Two', []).text);
    const keep = newestOnly([a, b, c]); expect(keep.has(b)).toBe(true); expect(keep.has(a)).toBe(false); expect(keep.has(c)).toBe(true);
  });
  it('class list CSV quotes commas', () => {
    const e = classEntry(readDesign('x.json', handInFile(docOf(poly(circ(P(0, 0), 10))), 'Lee, Sam', '9B', 'Cat', []).text));
    expect(classCsv([{ e, sheet: 'Sheet 2' }]).split('\r\n')[1]).toBe('"Lee, Sam",9B,Cat,Sheet 2,"No hole found. If this is a key ring, add one (Add a ring tool, or a small circle inside)."');
  });
});

describe('Several sheets', () => {
  it('60 rings that need two A4 sheets go on two, none lost', () => {
    const ring = nestShape({ ids: [], polys: [circ(P(0, 0), 15)] }, 2);
    const job: NestJob = { shapes: [ring], counts: [60], W: 297, H: 210, margin: 5, gap: 2, angles: [0] };
    const r = nestSheets(job);
    expect(r.sheets.length).toBe(2); expect(r.placed).toBe(60); expect(r.missing[0]).toBe(0);
    expect(r.sheets[0].placed.length).toBeGreaterThan(40);
  });
  it('a part bigger than the sheet is missing, the rest still placed', () => {
    const ring = nestShape({ ids: [], polys: [circ(P(0, 0), 15)] }, 2), big = nestShape({ ids: [], polys: [[P(0, 0), P(400, 0), P(400, 20), P(0, 20)]] }, 2);
    const r = nestSheets({ shapes: [ring, big], counts: [10, 1], W: 297, H: 210, margin: 5, gap: 2, angles: [0, Math.PI / 2] });
    expect(r.placed).toBe(10); expect(r.missing).toEqual([0, 1]); expect(r.sheets.length).toBe(1);
  });
  it('export picks one sheet and moves it to (0, 0)', () => {
    const d = docOf(poly(circ(P(50, 50), 10)), poly(circ(P(297 + 20 + 50, 50), 10))); d.sheets = 2;
    expect(sheetOf(d, d.ents[1] as any)).toBe(1);
    const s2 = sheetDoc(d, 1); expect(s2.ents.length).toBe(1);
    const xs = (s2.ents[0] as any).pts.map((p: Point) => p.x); expect(Math.min(...xs)).toBeCloseTo(40, 6);
    expect(sheetDoc(d, 0).ents.length).toBe(1);
  });
  it('two pupils’ overlapping designs stay separate parts', () => {
    const a = { ...poly(circ(P(0, 0), 10)), owner: 'Mia · 9B' }, b = { ...poly(circ(P(5, 0), 10)), owner: 'Sam · 9B' };
    expect(findParts([a, b], () => null).length).toBe(2);
    expect(findParts([{ ...a, owner: undefined }, { ...b, owner: undefined }], () => null).length).toBe(1);
  });
});

describe('One pupil’s design stays together', () => {
  it('a hole inside an outline with a gap goes with it (same pupil only)', () => {
    const pts: Point[] = []; for (let k = 0; k < 10; k++) { const a = Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 14 : 25; pts.push(P(r * Math.cos(a), r * Math.sin(a))); }
    const star = { ...poly(pts, false), owner: 'Harry · 9B' }, hole = { ...poly(circ(P(0, 12), 2.5)), owner: 'Harry · 9B' };
    expect(findParts([star, hole], () => null).length).toBe(1);
    expect(findParts([star, { ...hole, owner: 'Sam · 9B' }], () => null).length).toBe(2);
  });
});
