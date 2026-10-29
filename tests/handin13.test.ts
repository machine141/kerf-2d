import { describe, it, expect } from 'vitest';
// @ts-ignore — Node's zlib, used only to make test zips (no Node types in this project)
import { deflateRawSync } from 'node:zlib';
import { P, type Point } from '../src/geometry/vec';
import { newDoc, type Doc } from '../src/model/types';
import { checkDesign } from '../src/classroom/checks';
import { handInFile, readDesign, newestOnly, clashes, uniqueOwners, toInitials, okInitials, toClassCode } from '../src/classroom/handin';
import { unzip, unzipFiles } from '../src/io/unzip';
import { crc32 } from '../src/io/zip';

const circ = (c: Point, r: number, n = 48): Point[] => Array.from({ length: n }, (_, i) => P(c.x + r * Math.cos(i * 2 * Math.PI / n), c.y + r * Math.sin(i * 2 * Math.PI / n)));
let seq = 0;
const poly = (pts: Point[]): any => ({ id: 'e' + (++seq), layer: 'L1', color: 'ink', w: 0.1, type: 'poly', closed: true, pts });
const ring = (r = 20): Doc => { const d = newDoc(); d.ents = [poly(circ(P(50, 50), r)), poly(circ(P(50, 50 + r - 6), 3))]; return d; };

/** A zip like the ones Windows / OneDrive make: some entries deflated, some stored, folders, UTF-8 names. */
function makeZip(files: { path: string; text: string; deflate?: boolean }[], comment = ''): Uint8Array {
  const enc = new TextEncoder(), parts: Uint8Array[] = [], cen: Uint8Array[] = []; let off = 0;
  for (const f of files) {
    const nm = enc.encode(f.path), raw = enc.encode(f.text), dir = f.path.endsWith('/');
    const data = f.deflate && !dir ? new Uint8Array(deflateRawSync(raw)) : raw, crc = crc32(raw), m = f.deflate && !dir ? 8 : 0;
    const lh = new Uint8Array(30 + nm.length), a = new DataView(lh.buffer);
    a.setUint32(0, 0x04034b50, true); a.setUint16(4, 20, true); a.setUint16(6, 0x800, true); a.setUint16(8, m, true); a.setUint16(10, (10 << 11) | (42 << 5), true); a.setUint16(12, ((2026 - 1980) << 9) | (10 << 5) | 29, true);
    a.setUint32(14, crc, true); a.setUint32(18, data.length, true); a.setUint32(22, raw.length, true); a.setUint16(26, nm.length, true); lh.set(nm, 30);
    const ch = new Uint8Array(46 + nm.length), c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true); c.setUint16(10, m, true); c.setUint16(12, (10 << 11) | (42 << 5), true); c.setUint16(14, ((2026 - 1980) << 9) | (10 << 5) | 29, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, raw.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true); ch.set(nm, 46);
    parts.push(lh, data); cen.push(ch); off += lh.length + data.length;
  }
  const cm = enc.encode(comment), cenLen = cen.reduce((n, x) => n + x.length, 0);
  const end = new Uint8Array(22 + cm.length), d = new DataView(end.buffer);
  d.setUint32(0, 0x06054b50, true); d.setUint16(8, files.length, true); d.setUint16(10, files.length, true); d.setUint32(12, cenLen, true); d.setUint32(16, off, true); d.setUint16(20, cm.length, true); end.set(cm, 22);
  const all = [...parts, ...cen, end], out = new Uint8Array(all.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of all) { out.set(x, p); p += x.length; }
  return out;
}

describe('Initials and class codes', () => {
  it('turns what pupils type into two capitals', () => {
    expect(toInitials('mj')).toBe('MJ');
    expect(toInitials('Mia Jones')).toBe('MJ');
    expect(toInitials('  mia  van dijk ')).toBe('MD');
    expect(toInitials('Zoë Ölander')).toBe('ZÖ');
    expect(toInitials('M.J.')).toBe('MJ');
    expect(okInitials('MJ')).toBe(true); expect(okInitials('M')).toBe(false); expect(okInitials('MJK')).toBe(false); expect(okInitials('M1')).toBe(false);
  });
  it('class codes are capitals without spaces', () => {
    expect(toClassCode(' 9b ')).toBe('9B'); expect(toClassCode('10 dt/2')).toBe('10DT2'); expect(toClassCode('Y8-Red')).toBe('Y8-RED');
  });
  it('a hand-in with initials is named "9B - MJ - Star.json" and reads back', () => {
    const d = ring(), f = handInFile(d, 'MJ', '9B', 'Star', checkDesign(d));
    expect(f.filename).toBe('9B - MJ - Star.json');
    const r = readDesign(f.filename, f.text); expect([r.name, r.cls, r.title, r.owner]).toEqual(['MJ', '9B', 'Star', 'MJ · 9B']);
  });
});

describe('Same initials in one class', () => {
  const hand = (ini: string, cls: string, title: string, at: string) => { const d = ring(); const f = handInFile(d, ini, cls, title, []); const r = readDesign(f.filename, f.text); r.at = at; return r; };
  it('two pupils "MJ · 9B" with different designs are both kept and flagged; the same design keeps the newest', () => {
    const star1 = hand('MJ', '9B', 'Star', '2026-10-01'), star2 = hand('MJ', '9B', 'Star', '2026-10-05'), moon = hand('MJ', '9B', 'Moon', '2026-10-02'), sam = hand('SL', '9B', 'Cat', '2026-10-02');
    const all = [star1, star2, moon, sam], cur = newestOnly(all);
    expect(cur.has(star2) && cur.has(moon) && cur.has(sam)).toBe(true); expect(cur.has(star1)).toBe(false);
    expect([...clashes(all)]).toEqual(['mj · 9b']);
    const u = uniqueOwners([star2, moon, sam]).map(d => d.owner);
    expect(u).toEqual(['MJ · 9B · Star', 'MJ · 9B · Moon', 'SL · 9B']);
    expect(new Set(u).size).toBe(3);
  });
  it('the same initials in different classes are different pupils', () => {
    const a = hand('MJ', '9B', 'Star', '2026-10-01'), b = hand('MJ', '9C', 'Star', '2026-10-01');
    expect(newestOnly([a, b]).size).toBe(2); expect(clashes([a, b]).size).toBe(0);
  });
  it('design names differing only in spaces or capitals count as the same design', () => {
    const a = hand('MJ', '9B', 'Star key ring', '2026-10-01'), b = hand('MJ', '9B', 'star  key ring', '2026-10-03');
    expect([...newestOnly([a, b])]).toEqual([b]);
  });
});

describe('Opening a zip of hand-ins (Teams / OneDrive download)', () => {
  const files = Array.from({ length: 30 }, (_, i) => { const d = ring(15 + (i % 5)); const f = handInFile(d, String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + ((i * 7) % 26)), i < 15 ? '9B' : '9C', 'Design ' + i, []); return f; });
  it('reads deflated and stored entries, sub-folders, UTF-8 names and a comment; skips folders and __MACOSX', async () => {
    const z = makeZip([
      { path: '9B/', text: '' },
      ...files.map((f, i) => ({ path: (i < 15 ? '9B/' : '9C/') + f.filename, text: f.text, deflate: i % 2 === 0 })),
      { path: '__MACOSX/9B/._x.json', text: 'junk' },
      { path: '9B/Zoë notes.txt', text: 'hello', deflate: true },
    ], 'made by OneDrive');
    const es = await unzip(z);
    expect(es.length).toBe(31);
    expect(es.find(e => e.name === 'Zoë notes.txt')).toBeTruthy();
    const fs = await unzipFiles(new Blob([z as BlobPart]));
    const designs = [];
    for (const f of fs.filter(f => f.name.endsWith('.json'))) designs.push(readDesign(f.name, await f.text(), f.lastModified));
    expect(designs.length).toBe(30); expect(designs.every(d => !d.error && d.doc.ents.length === 2)).toBe(true);
    expect(designs.map(d => d.file).sort()).toEqual(files.map(f => f.filename).sort());
    expect(new Date(fs[0].lastModified).getFullYear()).toBe(2026);
  });
  it('a file that is not a zip says so', async () => {
    await expect(unzip(new TextEncoder().encode('hello, not a zip at all'))).rejects.toThrow(/not a zip/);
  });
  it('the content survives byte for byte', async () => {
    const big = 'x'.repeat(200000) + 'é✓';
    const [e] = await unzip(makeZip([{ path: 'a.txt', text: big, deflate: true }]));
    expect(new TextDecoder().decode(e.data)).toBe(big);
  });
});
