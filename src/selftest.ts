/**
 * Accuracy self-test. Runs real tool workflows through a separate, headless
 * Editor (so the user's drawing is untouched) and measures the results.
 * Used by the in-app Accuracy tab and by the automated test suite.
 */
import { type Point, P, sub, dist, normA, rotP, polar, fmt, DEG, parseLength } from './geometry/vec';
import { prims, distPrim, bbox } from './geometry/entity';
import { affEnt } from './geometry/affine';
import { Editor } from './editor/editor';
import { ALL_TOOLS } from './tools';
import { trimAt } from './tools/trim';
import { offsetBegin, offsetResult, offsetPick } from './tools/offset';
import { connectedGroup } from './geometry/offset';
import { handles, handleTransform, nodeHandles, nodeApply } from './tools/select';
import { exportDXF, importDXF } from './io/dxf';
import { exportSVG, importSVG } from './io/svg';
import type { Entity, Shape } from './model/types';
import { applyAllCorners, applyCorner } from './tools/fillet';
import { pathCorner, linesCorner } from './geometry/corner';
import { pathLength, hasBulge, segsOf } from './geometry/path';

export interface TestResult { name: string; ok: boolean; detail: string }

function coordsOf(e: any): number[] {
  if (e.type === 'line') return [e.a.x, e.a.y, e.b.x, e.b.y];
  if (e.type === 'circle') return [e.c.x, e.c.y, e.r];
  if (e.type === 'ellipse') return [e.c.x, e.c.y, e.rx, e.ry, Math.cos(2 * e.rot), Math.sin(2 * e.rot)];
  if (e.type === 'arc') { const s = polar(e.c, e.r, e.a0), f = polar(e.c, e.r, e.a1); return [e.c.x, e.c.y, e.r, s.x, s.y, f.x, f.y]; }
  if (e.type === 'poly') return e.pts.flatMap((p: Point) => [p.x, p.y]).concat((e.bulge || []).map((b: number) => b * 1000));
  return [];
}
function maxDev(A: any[], B: any[]) {
  if (A.length !== B.length) return Infinity; let m = 0;
  for (let i = 0; i < A.length; i++) { if (A[i].type !== B[i].type) return Infinity; const a = coordsOf(A[i]), b = coordsOf(B[i]); if (a.length !== b.length) return Infinity; for (let j = 0; j < a.length; j++) m = Math.max(m, Math.abs(a[j] - b[j])); }
  return m;
}
function contourError(res: Shape[], src: Shape[], d: number) {
  const pr = src.flatMap(e => prims(e)); let worst = 0;
  for (const e of res) for (const p of (e as any).pts) { let m = Infinity; for (const q of pr) m = Math.min(m, distPrim(p, q)); worst = Math.max(worst, Math.abs(m - d)); }
  return worst;
}

export function runSelfTest(): { results: TestResult[]; doc: string | null } {
  const R: TestResult[] = [], ok = (name: string, pass: any, detail: string) => R.push({ name, ok: !!pass, detail });
  const ed = new Editor(ALL_TOOLS);
  ed.view = { k: 4, ox: 0, oy: 0, W: 1600, H: 1200 };
  ed.opt.arcMode = 'centre';
  const d = ed.doc; d.name = 'Accuracy test'; d.page = { w: 600, h: 400, preset: 'BED' }; d.aids.attach.on = false;
  d.layers = [{ id: 'L1', name: 'Test', visible: true, active: true }];
  const typed = (...pts: [any, number, number][]) => pts.forEach(([m, a, b]) => ed.typed(m, a, b));
  const last = () => ed.doc.ents[ed.doc.ents.length - 1];
  const byId = (id: string) => ed.store.byId(id)!;
  try {
    // 1 · Tutorial 23 coordinate data entry
    ed.setTool('line'); typed(['abs', 120, 90], ['rel', 130, 0], ['pol', 75.42, 45], ['abs', 250, 170], ['rel', 0, 40], ['rel', -80, 0]); ed.finish();
    ed.setTool('arc'); typed(['abs', 170, 160], ['abs', 170, 210], ['rel', -50, -50]);
    ed.setTool('line'); typed(['rel', 0, 0], ['rel', 0, -70]); ed.finish();
    const [pl, ar, ln] = ed.doc.ents as any[], q = 75.42 * Math.SQRT1_2;
    const exp = [[120, 90], [250, 90], [250 + q, 90 + q], [250, 170], [250, 210], [170, 210]];
    const dv = Math.max(...exp.map((e, i) => Math.hypot(pl.pts[i].x - e[0], pl.pts[i].y - e[1])));
    ok('Typed Abs / Rel / Pol entry', dv < 1e-9, `6 vertices, max error ${dv.toExponential(1)} mm`);
    const as = polar(ar.c, ar.r, ar.a0), ae = polar(ar.c, ar.r, ar.a1);
    ok('Arc by centre, start, end', Math.abs(ar.r - 50) < 1e-9 && dist(as, P(170, 210)) < 1e-9 && dist(ae, P(120, 160)) < 1e-9, `R ${fmt(ar.r, 6)}`);
    ok('Shape closes exactly', ln.type === 'line' && dist(ln.b, pl.pts[0]) < 1e-9 && dist(ln.a, ae) < 1e-9, `closing line ends at (${fmt(ln.b.x, 6)}, ${fmt(ln.b.y, 6)})`);
    ok('Lengths typed with units', parseLength('2cm') === 20 && parseLength('1in') === 25.4 && parseLength('12.5') === 12.5, '2cm → 20 mm · 1in → 25.4 mm');
    // 2 · rectangle & circle modes
    ed.setTool('rect'); ed.opt.rectFrom = 'corner'; typed(['abs', 20, 300], ['rel', 40, 20]); const r1 = last();
    ed.opt.rectFrom = 'centre'; typed(['abs', 100, 310], ['rel', 15, 10]); const r2 = last();
    ed.mods.shift = true; ed.opt.rectFrom = 'corner'; typed(['abs', 140, 300], ['rel', 30, 12]); const r3 = last(); ed.mods.shift = false;
    const bw = (e: Entity) => { const b = ed.bbox(e); return [b.x1 - b.x0, b.y1 - b.y0, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; };
    ok('Rectangle: corner, centre, Shift = square', bw(r1)[0] === 40 && bw(r1)[1] === 20 && bw(r2)[0] === 30 && bw(r2)[1] === 20 && bw(r2)[2] === 100 && bw(r2)[3] === 310 && bw(r3)[0] === 30 && bw(r3)[1] === 30,
      `40×20 · 30×20 centred (100, 310) · square ${bw(r3)[0]}×${bw(r3)[1]}`);
    ed.setTool('circle'); ed.opt.circFrom = 'box'; typed(['abs', 200, 300], ['rel', 40, 20]); const el: any = last();
    ed.mods.shift = true; typed(['abs', 260, 300], ['rel', 30, 18]); const ec: any = last(); ed.mods.shift = false; ed.opt.circFrom = 'centre';
    ok('Circle tool: box → ellipse, Shift → perfect circle', el.type === 'ellipse' && el.rx === 20 && el.ry === 10 && ec.type === 'circle' && ec.r === 15 && ec.c.x === 275 && ec.c.y === 315,
      `ellipse ${el.rx * 2}×${el.ry * 2} · circle R${ec.r} at (${ec.c.x}, ${ec.c.y})`);
    // 3 · trim
    ed.setTool('line'); typed(['abs', 20, 20], ['abs', 100, 20]); ed.finish(); typed(['abs', 60, 0], ['abs', 60, 40]); ed.finish();
    const before = ed.doc.ents.length; trimAt(ed, P(85, 20), 2);
    const tl: any = ed.doc.ents.find((e: any) => e.type === 'line' && e.a.y === 20 && e.b.y === 20);
    ok('Delete part trims a line to the intersection', tl && dist(tl.a, P(20, 20)) < 1e-9 && dist(tl.b, P(60, 20)) < 1e-9 && ed.doc.ents.length === before, tl ? `kept (20, 20) → (${fmt(tl.b.x, 6)}, 20)` : 'line missing');
    ed.setTool('circle'); typed(['abs', 60, 260], ['rel', 15, 0]); ed.setTool('line'); typed(['abs', 30, 260], ['abs', 90, 260]); ed.finish();
    trimAt(ed, P(60, 275), 2); const ta: any = ed.doc.ents.find((e: any) => e.type === 'arc' && e.c.y === 260);
    ok('Delete part turns a circle into an arc', ta && Math.abs(normA(ta.a1 - ta.a0) - Math.PI) < 1e-9, ta ? `arc ${fmt(normA(ta.a0) / DEG, 6)}° → ${fmt(normA(ta.a1) / DEG, 6)}°` : 'no arc');
    // 4 · rotate with repeats
    ed.setTool('circle'); typed(['abs', 330, 40], ['rel', 5, 0]); ed.setSelection([last().id]); ed.opt.rotAngle = 60; ed.opt.rotCopies = 5; ed.setTool('rotate'); typed(['abs', 330, 80]);
    const ring = ed.doc.ents.filter((e: any) => e.type === 'circle' && Math.abs(dist(e.c, P(330, 80)) - 40) < 1e-6), opp = ring.find((e: any) => dist(e.c, P(330, 120)) < 1e-9);
    ok('Rotate 60° × 5 repeats', ring.length === 6 && !!opp, `${ring.length} circles on the R40 ring`);
    // 5 · snapping
    ed.setTool('line'); typed(['abs', 200, 240], ['abs', 270, 275]); ed.finish(); typed(['abs', 200, 270], ['abs', 270, 235]); ed.finish();
    d.aids.attach.on = true; const sn = ed.snapAt(P(230.8, 255.6)), snc = ed.snapAt(P(330.8, 39.5));
    ok('Attach snaps to exact intersection and centre', sn.k === 'inter' && dist(sn.p, P(230, 255)) < 1e-9 && snc.k === 'centre' && dist(snc.p, P(330, 40)) < 1e-9, `inter (${fmt(sn.p.x, 9)}, ${fmt(sn.p.y, 9)}) · centre (${fmt(snc.p.x, 6)}, ${fmt(snc.p.y, 6)})`);
    // perpendicular + tangent from a line start
    d.aids.attach.perp = true; d.aids.attach.tangent = true;
    ed.setTool('circle'); typed(['abs', 400, 300], ['rel', 20, 0]); const tc: any = last();
    ed.setTool('line'); typed(['abs', 360, 300]);
    const tExp = polar(tc.c, 20, Math.PI + Math.acos(20 / 40)), ts = ed.snapAt(P(tExp.x + 0.6, tExp.y - 0.4));
    ed.cancel(); typed(['abs', 380, 240]);
    const pExp = polar(tc.c, 20, Math.atan2(240 - 300, 380 - 400)), ps = ed.snapAt(P(pExp.x + 0.5, pExp.y - 0.4));
    ed.cancel(); ed.setTool('select'); d.aids.attach.perp = false; d.aids.attach.tangent = false;
    ok('Tangent and perpendicular snaps', ts.k === 'tangent' && dist(ts.p, tExp) < 1e-9 && ps.k === 'perp' && dist(ps.p, pExp) < 1e-9,
      `tangent point (${fmt(ts.p.x, 6)}, ${fmt(ts.p.y, 6)}) · perpendicular foot (${fmt(ps.p.x, 6)}, ${fmt(ps.p.y, 6)})`);
    d.aids.attach.on = false;
    // 6 · contours
    const contourOf = (ents: Shape[], dd: number, side: string, round = true) => { ed.opt.offD = dd; ed.opt.offSide = side; ed.opt.offRound = round ? '1' : '0'; ed.opt.offFollow = false; ed.opt.offCount = 1; ed.opt.offMode = 'shape'; offsetBegin(ed, ents, []); const r = offsetResult(ed, P(0, 0)); ed.state.off = null; return r; };
    ed.setTool('circle'); typed(['abs', 420, 360], ['rel', 20, 0]); const cc = last() as Shape; ed.setTool('select');
    const co = contourOf([cc], 5, 'out'), ci = contourOf([cc], 5, 'in'), eo = contourError(co, [cc], 5), ei = contourError(ci, [cc], 5);
    ok('Contour of a circle, outside and inside', co.length === 1 && ci.length === 1 && eo < 0.002 && ei < 0.002, `R20 → R25 error ${eo.toExponential(1)} mm · R20 → R15 error ${ei.toExponential(1)} mm`);
    ed.setTool('rect'); ed.opt.rectFrom = 'corner'; typed(['abs', 480, 340], ['rel', 40, 20]); const rr = last() as Shape; ed.setTool('select');
    const ro = contourOf([rr], 5, 'out', true), so: any[] = contourOf([rr], 5, 'out', false), rerr = contourError(ro, [rr], 5), sb = bbox(so[0]);
    ok('Contour of a rectangle: round and sharp corners', ro.length === 1 && rerr < 0.002 && so[0].pts.length === 4 && sb.x1 - sb.x0 === 50 && sb.y1 - sb.y0 === 30, `round: error ${rerr.toExponential(1)} · sharp: ${sb.x1 - sb.x0}×${sb.y1 - sb.y0} mm`);
    ed.setTool('line'); typed(['abs', 480, 200], ['rel', 30, 0]); ed.finish(); const l1 = last(); typed(['rel', 0, 0], ['rel', 0, 20]); ed.finish(); typed(['rel', 0, 0], ['rel', -30, 0]); ed.finish(); typed(['rel', 0, 0], ['rel', 0, -20]); ed.finish(); ed.setTool('select');
    const grp = connectedGroup(l1, ed.doc.ents), gc: any[] = contourOf(grp as Shape[], 3, 'out', false), gb = gc[0] && bbox(gc[0]);
    ok('Contour finds a shape made of separate lines', grp.length === 4 && gc.length === 1 && gb && gb.x1 - gb.x0 === 36 && gb.y1 - gb.y0 === 26, `${grp.length} joined lines → ${gb ? `${gb.x1 - gb.x0}×${gb.y1 - gb.y0}` : '—'} mm`);
    // Closed contour: click inside an area bounded by CROSSING lines (# shape)
    ed.setTool('line');
    for (const [a, b, c, e] of [[540, 260, 590, 260], [540, 280, 590, 280], [550, 250, 550, 290], [580, 250, 580, 290]]) { typed(['abs', a, b], ['abs', c, e]); ed.finish(); }
    ed.setTool('offset'); ed.opt.offMode = 'shape'; ed.opt.offSide = 'in'; ed.opt.offD = 2; ed.opt.offRound = '0'; ed.opt.offCount = 1;
    const picked = offsetPick(ed, P(565, 270)), hres: any[] = picked ? offsetResult(ed, P(565, 270)) : []; ed.state.off = null; ed.setTool('select');
    const hb = hres[0] && bbox(hres[0]);
    ok('Closed contour traces an area bounded by crossing lines', picked && hres.length === 1 && hb.x1 - hb.x0 === 26 && hb.y1 - hb.y0 === 16, hb ? `30×20 area found inside a # · inside contour 2 mm → ${hb.x1 - hb.x0}×${hb.y1 - hb.y0} mm` : 'no area found');
    // 7 · glasses
    ed.setTool('circle'); typed(['abs', 100, 140], ['rel', 22, 0]); const lensL = last(); typed(['abs', 156, 140], ['rel', 22, 0]); const lensR = last();
    ed.setTool('arc'); typed(['abs', 128, 130], ['abs', 137, 144], ['abs', 119, 144]); const bridge = last(); ed.setTool('select');
    const face = contourOf([lensL, lensR, bridge] as Shape[], 4, 'out'), ferr = contourError(face, [lensL, lensR, bridge] as Shape[], 4);
    ok('Glasses: one outline around both lenses and the bridge', face.length === 1 && ferr < 0.002, `${face.length} outline, every point 4 mm from the nearest part (error ${ferr.toExponential(1)} mm)`);
    ed.store.change(() => ed.store.add(structuredClone(face[0])));
    // 8 · key ring
    ed.setTool('rect'); typed(['abs', 300, 140], ['rel', 50, 30]); const body = last();
    ed.setTool('circle'); typed(['abs', 300, 170], ['rel', 10, 0]); const loop = last(); ed.setTool('select');
    const kr = contourOf([body, loop] as Shape[], 3, 'out'), krerr = contourError(kr, [body, loop] as Shape[], 3);
    ok('Key ring: contour joins body and loop into one outline', kr.length === 1 && krerr < 0.002, `${kr.length} outline, error ${krerr.toExponential(1)} mm`);
    ed.store.change(() => ed.store.add(structuredClone(kr[0])));
    ed.setTool('circle'); typed(['abs', 300, 170], ['rel', 4, 0]);
    ed.setTool('line'); typed(['abs', 320, 160], ['abs', 320, 210]); ed.finish(); typed(['abs', 335, 160], ['abs', 335, 210]); ed.finish(); ed.setTool('select');
    trimAt(ed, P(327, 173), 3);
    const kept: any = ed.doc.ents.find((e: any) => e.type === 'poly' && !e.closed && e.pts.length > 10);
    const endsOK = kept && [kept.pts[0], kept.pts[kept.pts.length - 1]].every((p: Point) => Math.abs(p.x - 320) < 1e-6 || Math.abs(p.x - 335) < 1e-6) && Math.abs(kept.pts[0].y - 173) < 1e-6;
    ok('Trim removes a section of the contour between two lines', endsOK && !kept.pts.some((p: Point) => p.x > 320 + 1e-6 && p.x < 335 - 1e-6 && p.y > 172), kept ? `open path now ends at (${fmt(kept.pts[0].x, 6)}, ${fmt(kept.pts[0].y, 6)}) and (${fmt(kept.pts[kept.pts.length - 1].x, 6)}, ${fmt(kept.pts[kept.pts.length - 1].y, 6)})` : 'no path kept');
    // 9 · single edge offset
    ed.setTool('line'); typed(['abs', 400, 100], ['rel', 60, 20]); ed.finish(); const se: any = last(); ed.setTool('select');
    ed.opt.offMode = 'edge'; ed.opt.offD = 7; ed.opt.offSide = 'auto'; offsetBegin(ed, [se], [se.id], { edge: prims(se)[0] }); const sr: any = offsetResult(ed, P(420, 140))[0]; ed.state.off = null; ed.opt.offMode = 'shape';
    const sd = sr && distPrim(sr.a, prims(se)[0]), sd2 = sr && distPrim(sr.b, prims(se)[0]);
    ok('Offset one edge: parallel line at exact distance', sr && Math.abs(sd - 7) < 1e-9 && Math.abs(sd2 - 7) < 1e-9, sr ? `both ends ${fmt(sd, 9)} mm from the original` : 'none');
    // 10 · handles & points
    ed.setTool('select'); ed.setSelection([r1.id]);
    const right = handles(ed).find(h => h.k === 'scale' && h.fx === 1 && h.fy === 0)!;
    const tx = handleTransform(ed, right, P(60, 310), P(80, 310), { shift: false, alt: false }); ed.store.change(() => ed.transformSel(tx.A));
    const r1b = ed.bbox(byId(r1.id));
    ok('Edge handle stretches a rectangle exactly', r1b.x1 - r1b.x0 === 60 && r1b.y1 - r1b.y0 === 20 && r1b.x0 === 20, `40×20 → ${r1b.x1 - r1b.x0}×${r1b.y1 - r1b.y0} mm, left edge fixed`);
    ed.setSelection([ec.id]); const top = handles(ed).find(h => h.k === 'scale' && h.fx === 0 && h.fy === 1)!;
    const sq = handleTransform(ed, top, P(275, 330), P(275, 320), { shift: false, alt: false }); ed.store.change(() => ed.transformSel(sq.A)); const ecn: any = byId(ec.id);
    ok('Squashing a circle makes an exact ellipse', ecn.type === 'ellipse' && Math.abs(ecn.rx - 15) < 1e-9 && Math.abs(ecn.ry - 10) < 1e-9, `R15 circle → ${fmt(ecn.rx * 2, 6)} × ${fmt(ecn.ry * 2, 6)} ellipse`);
    ed.setSelection([ar.id]); ed.flipSel('h'); const arf: any = byId(ar.id), fs = polar(arf.c, arf.r, arf.a0), fe = polar(arf.c, arf.r, arf.a1);
    ok('Flip keeps arcs exact', Math.abs(arf.r - 50) < 1e-9 && dist(arf.c, P(120, 160)) < 1e-9 && dist(fs, P(170, 160)) < 1e-9 && dist(fe, P(120, 210)) < 1e-9, `centre (${fmt(arf.c.x, 6)}, ${fmt(arf.c.y, 6)}), R ${fmt(arf.r, 6)}`);
    const plE = byId(pl.id), nh = nodeHandles(ed, plE).find(h => h.k === 'v' && h.i === 2)!;
    ed.store.change(() => ed.store.replace(pl.id, nodeApply(plE, nh, P(300, 140))));
    const pln: any = byId(pl.id);
    ok('Editing a point moves only that vertex', pln.pts[2].x === 300 && pln.pts[1].x === 250 && pln.pts.length === 6, `vertex 3 now (${pln.pts[2].x}, ${pln.pts[2].y})`);
    ed.setSelection([]);
    // 11 · dimension
    d.layers.push({ id: 'L2', name: 'Dimensions', visible: true, active: true }); d.current = 'L2'; d.attrs.color = 'ink';
    ed.opt.dimMode = 'a'; ed.setTool('dim'); typed(['abs', 250, 90], ['pol', 75.42, 45], ['abs', 300, 100]); d.current = 'L1'; d.attrs.color = 'red';
    const dm: any = last(); ok('Aligned dimension reads true length', Math.abs(ed.dimGeom(dm).val - 75.42) < 1e-9, `measured ${fmt(ed.dimGeom(dm).val, 9)} mm`);
    ed.setTool('select');
    // 12a · v0.4 features
    ed.setTool('rect'); ed.opt.rectFrom = 'corner'; typed(['abs', 450, 60], ['rel', 40, 20]); const fr: any = last(); ed.setTool('select');
    ed.setSelection([fr.id]); ed.opt.filletMode = 'fillet'; ed.opt.filletR = 5; applyAllCorners(ed);
    const frn: any = byId(fr.id), expLen = 2 * (40 + 20) - 8 * 5 + 2 * Math.PI * 5;
    const arcsOK = hasBulge(frn) && segsOf(frn).filter(sg => sg.kind === 'arc').every((sg: any) => Math.abs(sg.r - 5) < 1e-9 && Math.abs(Math.abs(sg.sweep) - Math.PI / 2) < 1e-9);
    ok('Fillet all corners: rectangle keeps true arcs', frn.pts.length === 8 && arcsOK && Math.abs(pathLength(frn) - expLen) < 1e-9, `perimeter ${fmt(pathLength(frn), 9)} mm (expected ${fmt(expLen, 9)}), four R5 quarter arcs`);
    ed.setTool('rect'); typed(['abs', 450, 110], ['rel', 40, 20]); const cr: any = last(); ed.setTool('select');
    const ci2 = cr.pts.findIndex((q: Point) => q.x === 450 && q.y === 110); ed.opt.filletMode = 'chamfer';
    applyCorner(ed, { kind: 'vertex', id: cr.id, i: ci2, V: cr.pts[ci2], theta: pathCorner(cr, ci2)!.theta }, 5); ed.opt.filletMode = 'fillet';
    const crn: any = byId(cr.id), cLen = 120 - 10 + 5 * Math.SQRT2;
    ok('Chamfer one corner exactly', crn.pts.length === 5 && Math.abs(pathLength(crn) - cLen) < 1e-9, `perimeter ${fmt(pathLength(crn), 9)} mm (expected ${fmt(cLen, 9)})`);
    ed.setTool('line'); typed(['abs', 450, 150], ['abs', 480, 150]); ed.finish(); const la: any = last(); typed(['abs', 490, 160], ['abs', 490, 190]); ed.finish(); const lb: any = last(); ed.setTool('select');
    const lg: any = linesCorner(la, P(460, 150), lb, P(490, 180));
    applyCorner(ed, { kind: 'lines', idA: la.id, clickA: P(460, 150), idB: lb.id, clickB: P(490, 180), V: lg.X, theta: lg.theta }, 5);
    const lan: any = byId(la.id), lbn: any = byId(lb.id), fa: any = last();
    ok('Fillet two lines that do not meet', lan.b.x === 485 && lan.b.y === 150 && lbn.b.x === 490 && lbn.b.y === 155 && fa.type === 'arc' && fa.c.x === 485 && fa.c.y === 155 && fa.r === 5,
      `lines trimmed/extended to (485, 150) and (490, 155); R5 arc centred (${fa.c.x}, ${fa.c.y})`);
    ed.setTool('line'); typed(['abs', 530, 150], ['abs', 530, 180]); ed.finish(); typed(['abs', 550, 150], ['abs', 550, 180]); ed.finish();
    ed.opt.arcMode = '3pt'; ed.setTool('arc'); typed(['abs', 530, 180], ['abs', 550, 180], ['abs', 540, 190]); const a3: any = last();
    ok('3-point arc joins two parallel lines', a3.type === 'arc' && a3.c.x === 540 && a3.c.y === 180 && a3.r === 10 && Math.abs(normA(a3.a1 - a3.a0) - Math.PI) < 1e-9, `centre (${a3.c.x}, ${a3.c.y}), R ${a3.r}, 180° sweep`);
    ed.setTool('line'); typed(['abs', 530, 200], ['abs', 550, 200]); ed.finish();
    ed.opt.arcMode = 'tangent'; ed.setTool('arc'); typed(['abs', 550, 200], ['abs', 550, 220]); const ta2: any = last(); ed.opt.arcMode = 'centre'; ed.setTool('select');
    ok('Tangent arc leaves a line smoothly', ta2.type === 'arc' && ta2.c.x === 550 && ta2.c.y === 210 && ta2.r === 10, `centre (${ta2.c.x}, ${ta2.c.y}) sits square to the line end, R ${ta2.r}`);
    ed.setSelection([fr.id]); const copyIds = ed.store.change(() => ed.transformSel({ a: 1, b: 0, c: 0, d: 1, e: 0, f: -40 } as any, 1));
    ed.setSelection(copyIds); ed.explodeSel(); const pieces = [...ed.sel]; ed.makePathSel(); const mp: any = ed.selected()[0];
    ok('Explode then Make Path rebuilds one closed path', pieces.length === 8 && ed.sel.size === 1 && mp.closed && hasBulge(mp) && Math.abs(pathLength(mp) - expLen) < 1e-9, `${pieces.length} pieces → 1 closed path, perimeter ${fmt(pathLength(mp), 9)} mm`);
    ed.setSelection([lensL.id, lensR.id]); ed.groupSel(); const gsel = ed.withGroups([lensL.id]);
    ed.setSelection(gsel); ed.explodeSel(); const ungrouped = !byId(lensL.id).group && !byId(lensR.id).group;
    ok('Group selects together; Explode ungroups', gsel.size === 2 && ungrouped, 'clicking one lens selects both · Explode removed the group');
    d.aids.attach.on = true; ed.setTool('line'); ed.track = [P(565, 310)];
    const tk1 = ed.snapAt(P(565.4, 350)); ed.track = [P(565, 310), P(590, 380)]; const tk2 = ed.snapAt(P(565.3, 379.6));
    ed.setTool('select'); d.aids.attach.on = false;
    ok('Alignment guides lock to touched points', tk1.k === 'track' && tk1.p.x === 565 && tk1.p.y === 350 && tk2.k === 'track' && tk2.p.x === 565 && tk2.p.y === 380, `vertical guide → (${tk1.p.x}, ${tk1.p.y}) · crossing of two guides → (${tk2.p.x}, ${tk2.p.y})`);
    // 12b · fixes: trim keeps closed shapes, Make Path closes tiny gaps
    ed.setTool('rect'); typed(['abs', 620, 300], ['rel', 40, 30]); const gl: any = last(); ed.setTool('select');
    ed.opt.arcMode = '3pt'; ed.setTool('arc'); typed(['abs', 660, 320], ['abs', 680, 320], ['abs', 670, 325]); ed.opt.arcMode = 'centre'; ed.setTool('select');
    const nBefore = ed.doc.ents.length; trimAt(ed, P(660, 310), 2); const glKept: any = byId(gl.id);
    ok('Trim never deletes a closed shape whole', ed.doc.ents.length === nBefore && !!glKept && glKept.closed, 'lens edge with only one crossing (bridge arc end) → refused, rectangle kept');
    ed.setTool('line'); typed(['abs', 620, 350], ['abs', 650, 350]); ed.finish(); const g1: any = last(); typed(['abs', 650, 350], ['abs', 650, 370]); ed.finish(); const g2: any = last();
    typed(['abs', 650, 370], ['abs', 620, 370]); ed.finish(); const g3: any = last(); typed(['abs', 620, 370], ['abs', 620, 350.02]); ed.finish(); const g4: any = last(); ed.setTool('select');
    ed.setSelection([g1.id, g2.id, g3.id, g4.id]); ed.makePathSel(); const gp: any = ed.selected()[0];
    ok('Make Path closes a 0.02 mm gap', ed.sel.size === 1 && gp.type === 'poly' && gp.closed && gp.pts.length === 4, '4 lines with a 0.02 mm gap → 1 closed path (close-gaps setting 0.05 mm)');
    // 12 · file round trips
    d.layers[1].visible = false;
    const geo = ed.doc.ents.filter(e => e.type !== 'dim'), geoNoEll = geo.filter(e => e.type !== 'ellipse');
    const dxf = exportDXF(ed.doc), all = importDXF(dxf), fromDxf = all.filter((_, i) => geo[i]?.type !== 'ellipse'), dd = maxDev(geoNoEll, fromDxf);
    ok('DXF export → re-import', dd <= 0.001, `${fromDxf.length}/${geoNoEll.length} entities, max deviation ${dd === Infinity ? 'mismatch' : dd.toExponential(2)} mm`);
    const ellDxf: any[] = all.filter((_, i) => geo[i]?.type === 'ellipse'), ellSrc: any[] = geo.filter(e => e.type === 'ellipse'); let ellErr = 0;
    ellDxf.forEach((pe, i) => { const e = ellSrc[i]; for (const p of pe.pts) { const dd2 = rotP(sub(p, e.c), P(0, 0), -e.rot); ellErr = Math.max(ellErr, Math.abs(Math.hypot(dd2.x / e.rx, dd2.y / e.ry) - 1) * Math.max(e.rx, e.ry)); } });
    ok('Ellipses export to DXF R12 as fine polylines', ellDxf.length === ellSrc.length && ellErr < 0.001, `${ellDxf.length} ellipse(s), vertices on the curve within ${ellErr.toExponential(1)} mm`);
    const split = importDXF(exportDXF(ed.doc, { splitArcs: true, curveTol: 0.01 }));
    ok('DXF option: split arcs into lines', !split.some(e => e.type === 'arc' || e.type === 'circle') && split.length === geo.length, `${split.filter(e => e.type === 'poly').length} curves written as polylines (0.01 mm tolerance)`);
    ok('DXF declares millimetres', /\$INSUNITS\r\n70\r\n4\r\n/.test(dxf) && /AC1009/.test(dxf), 'R12 (AC1009), $INSUNITS = 4 (mm)');
    const svg = exportSVG(ed.doc), fromSvg = importSVG(svg), ds = maxDev(geo, fromSvg);
    ok('SVG export → re-import (incl. ellipses)', ds <= 0.001, `${fromSvg.length}/${geo.length} entities, max deviation ${ds === Infinity ? 'mismatch' : ds.toExponential(2)} mm`);
    ok('SVG physical size', /width="600mm" height="400mm" viewBox="0 0 600 400"/.test(svg), 'width 600mm, height 400mm, 1 unit = 1 mm');
    d.layers[1].visible = true;
    // 13 · undo restores exactly
    const snapshot = JSON.stringify(ed.doc.ents); ed.setSelection([r2.id]); ed.deleteSel(); ed.store.undo();
    ok('Undo restores the drawing exactly', JSON.stringify(ed.doc.ents) === snapshot, `${ed.doc.ents.length} objects restored`);
    return { results: R, doc: JSON.stringify(ed.doc) };
  } catch (err: any) {
    ok('Test run', false, String(err?.stack || err)); return { results: R, doc: null };
  }
}
export { affEnt };
