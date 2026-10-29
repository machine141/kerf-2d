/**
 * Ready-to-cut checks for a pupil's design, run when it is handed in (and again
 * when the teacher loads it). Friendly words; "stop" means it can't be handed in yet.
 */
import ClipperLib from 'clipper-lib';
import { type Point, P, fmt } from '../geometry/vec';
import { flatten, bbox, unionBox } from '../geometry/entity';
import { chainPieces } from '../geometry/offset';
import { pointInPoly } from '../geometry/region';
import { modeOf, type Doc, type Entity, type Shape } from '../model/types';

const L = ClipperLib, S = 1000;
export interface Check { level: 'ok' | 'warn' | 'stop'; text: string; at?: Point }
type IP = { X: number; Y: number }[];
const toI = (pts: Point[]): IP => pts.map(p => ({ X: Math.round(p.x * S), Y: Math.round(p.y * S) }));
const areaI = (q: IP) => Math.abs(L.Clipper.Area(q)) / (S * S);
const polyArea = (q: Point[]) => { let a = 0; for (let i = 0, j = q.length - 1; i < q.length; j = i++) a += (q[j].x + q[i].x) * (q[j].y - q[i].y); return Math.abs(a) / 2; };

/** Thinnest part a 3 mm sheet survives well, mm. */
export const MIN_WIDTH = 1.5;

export function checkDesign(doc: Doc): Check[] {
  const out: Check[] = [];
  const vis = new Set(doc.layers.filter(l => l.visible).map(l => l.id));
  const ents = doc.ents.filter(e => vis.has(e.layer) && e.type !== 'dim' && e.type !== 'fill' && modeOf(doc, e.color) !== 'off') as Entity[];
  const cut = ents.filter(e => modeOf(doc, e.color) === 'cut');
  if (!cut.length) { out.push({ level: 'stop', text: ents.length ? 'Nothing is set to cut — the outline needs a cut colour (e.g. Black · Cut).' : 'There is nothing in the drawing yet.' }); return out; }

  // size
  const box = unionBox(ents.map(e => bbox(e as Shape)).filter(Boolean) as any);
  if (box) {
    const w = box.x1 - box.x0, h = box.y1 - box.y0;
    if (w > doc.page.w + 1e-6 || h > doc.page.h + 1e-6) out.push({ level: 'stop', text: `It is ${fmt(w, 0)} × ${fmt(h, 0)} mm — bigger than the ${doc.page.w} × ${doc.page.h} mm sheet.` });
    else out.push({ level: 'ok', text: `Size ${fmt(w, 1)} × ${fmt(h, 1)} mm` });
  }

  // cut outlines: closed shapes, plus open lines that join up into loops
  const closed: Point[][] = [], open: Point[][] = [];
  for (const e of cut) {
    if (e.type === 'text') continue;
    const f = flatten(e as Shape, 0.05);
    if (f.pts.length < 2) continue;
    (f.closed && f.pts.length > 2 ? closed : open).push(f.pts);
  }
  const chains = chainPieces(open, 0.05);
  const gaps = chains.filter(c => !c.closed);
  for (const c of chains) if (c.closed) closed.push(c.pts);
  if (gaps.length) out.push({ level: 'warn', text: `${gaps.length} cut line${gaps.length > 1 ? 's don’t' : ' doesn’t'} join up (there's a gap), so the part may not drop out. Select the lines and press Make path, or close the gap.`, at: gaps[0].pts[0] });
  else out.push({ level: 'ok', text: 'Every cut line joins up' });

  // text set to cut: the letters drop out as separate bits
  const cutText = cut.filter(e => e.type === 'text');
  if (cutText.length) out.push({ level: 'warn', text: 'Some text is set to cut, so each letter will drop out as a loose piece. Give it an engrave colour, or Contour it so the letters join into one piece.' });

  // a hole for the key ring: some cut outline inside another
  let hole = false;
  for (const a of closed) { if (hole) break; const pa = polyArea(a); for (const b of closed) if (b !== a && polyArea(b) > pa && pointInPoly(a[0], b)) { hole = true; break; } }
  out.push(hole ? { level: 'ok', text: 'Has a hole (for the key ring)' } : { level: 'warn', text: 'No hole found. If this is a key ring, add one (Add a ring tool, or a small circle inside).' });

  // thin bits that may snap: what a 1.5 mm wide "brush" can't reach
  const material = (() => { const c = new L.Clipper(), u = new L.Paths(); c.AddPaths(closed.filter(q => q.length > 2).map(toI), L.PolyType.ptSubject, true); c.Execute(L.ClipType.ctUnion, u, L.PolyFillType.pftEvenOdd, L.PolyFillType.pftEvenOdd); return u as IP[]; })();
  const off = (paths: IP[], d: number) => { const co = new L.ClipperOffset(2, 0.02 * S), r = new L.Paths(); co.AddPaths(paths, L.JoinType.jtRound, L.EndType.etClosedPolygon); co.Execute(r, d * S); return r as IP[]; };
  const r = MIN_WIDTH / 2, opened = off(off(material, -r), r);
  const lost = (() => { const c = new L.Clipper(), d = new L.Paths(); c.AddPaths(material, L.PolyType.ptSubject, true); c.AddPaths(opened, L.PolyType.ptClip, true); c.Execute(L.ClipType.ctDifference, d, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero); return off(off(d as IP[], -0.05), 0.05); })();
  const thin = lost.filter(q => areaI(q) > 1.5);
  if (thin.length) { const q = thin[0], c = q.reduce((a, v) => P(a.x + v.X / S / q.length, a.y + v.Y / S / q.length), P(0, 0)); out.push({ level: 'warn', text: `${thin.length === 1 ? 'A part is' : thin.length + ' parts are'} thinner than about ${MIN_WIDTH} mm and may snap. Make ${thin.length === 1 ? 'it' : 'them'} a little wider.`, at: c }); }
  else out.push({ level: 'ok', text: `Nothing thinner than ${MIN_WIDTH} mm` });
  return out;
}
export const canHandIn = (checks: Check[]) => !checks.some(c => c.level === 'stop');
