/**
 * Hinge brush: paint where a part should bend (the way it should bend), draw a
 * fold line across a corner, or click inside an area. Each pastel colour is a
 * slit pattern. "Make cuts" turns all the painted areas into slits at once.
 */
import { type Point, P, dist, fmt, TAU } from '../geometry/vec';
import { flatten } from '../geometry/entity';
import { findRegion } from '../geometry/region';
import type { Tool, OptionSpec } from '../editor/tool';
import type { Editor } from '../editor/editor';
import type { HingeMark, HingePattern, Shape } from '../model/types';
import { computeHinge, autoAngle, HINGE_PATTERNS, patternInfo, MATERIALS, suggest, bendCheck, type HingeArea, type BrushSettings, type MaterialSet } from '../hinge/brush';
import { laserTime } from '../hinge/hinge';

export const HB_ICON = '<path d="M2 18L5.3 6L8.7 18L12 6L15.3 18L18.7 6L22 18"/>';

const settings = (ed: Editor): BrushSettings => ({ pitch: Math.max(0.5, +ed.opt.hbPitch || 2.5), slit: Math.max(1, +ed.opt.hbSlit || 15), bridge: Math.max(0.5, +ed.opt.hbBridge || 3), edge: Math.max(0, +ed.opt.hbEdge || 0) });
/** The drawing the paint is checked against (not the hinge slits themselves, not dimensions). */
function envOf(ed: Editor) {
  const lines: { pts: Point[]; closed: boolean }[] = [];
  for (const e of ed.doc.ents) {
    if (!ed.store.visible(e) || e.type === 'dim' || e.gen === 'hinge') continue;
    const parts = e.type === 'text' ? (flattenText(e)) : [flatten(e as Shape)];
    for (const f of parts) if (f.pts.length > 1) lines.push({ pts: f.pts, closed: f.closed });
  }
  return { lines };
}
import { ext } from '../geometry/entity';
const flattenText = (e: any) => ext.textShapes(e).map(s => flatten(s));
/**
 * Centre for circles / spokes: the one picked, or else the middle of the
 * biggest closed outline round `at` (the whole flower, the whole donut), or of the drawing.
 */
function defaultCentre(ed: Editor, at?: Point): Point {
  if (ed.opt.hbCentre && typeof ed.opt.hbCentre === 'object') return ed.opt.hbCentre;
  const lines = envOf(ed).lines.filter(l => l.closed && l.pts.length > 2);
  const box = (p: Point[]) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of p) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); } return { x0, y0, x1, y1 }; };
  const inPoly = (p: Point, poly: Point[]) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c; } return c; };
  let best: { x0: number; y0: number; x1: number; y1: number } | null = null, ba = -1;
  if (at) for (const l of lines) if (inPoly(at, l.pts)) { const b = box(l.pts), a = (b.x1 - b.x0) * (b.y1 - b.y0); if (a > ba) { ba = a; best = b; } }
  if (!best) { const all = lines.flatMap(l => l.pts); if (all.length) best = box(all); }
  return best ? P((best.x0 + best.x1) / 2, (best.y0 + best.y1) / 2) : P(ed.doc.page.w / 2, ed.doc.page.h / 2);
}
let cache: { key: string; res: HingeArea[] } | null = null;
/** The painted areas and their slits (cached until the drawing or the settings change). */
export function hingeAreas(ed: Editor): HingeArea[] {
  const marks = ed.doc.hinge || []; if (!marks.length) return [];
  const set = settings(ed), key = [ed.ver, JSON.stringify(set), JSON.stringify(marks).length, ed.doc.ents.length].join('|');
  if (cache?.key === key) return cache.res;
  const res = computeHinge(marks, envOf(ed), set, defaultCentre(ed, marks[0].kind === 'erase' ? undefined : (marks[0] as any).pts?.[0]));
  cache = { key, res }; return res;
}
const centred = (p: HingePattern) => p === 'rings' || p === 'spokes';
const slitsOf = (areas: HingeArea[]) => areas.flatMap(a => a.slits);

/** Put the slits for `areas` into the drawing in place of earlier ones (inside a store change). */
function placeSlits(ed: Editor, areas: HingeArea[]) {
  ed.store.remove(ed.doc.ents.filter(e => e.gen === 'hinge').map(e => e.id));
  const g = 'g' + ed.doc.seq++;
  for (const s of slitsOf(areas)) { const e = ed.store.add(s.length === 2 ? { type: 'line', a: s[0], b: s[1] } as Shape : { type: 'poly', closed: false, pts: s } as Shape); e.gen = 'hinge'; e.group = [g]; }
}
/** Change the painted areas (one undo step). After Make cuts, the slits follow straight away. */
function mutate(ed: Editor, fn: () => void) {
  ed.store.change(() => {
    fn();
    const marks = ed.doc.hinge || [];
    if (ed.doc.hingeMade) placeSlits(ed, marks.length ? computeHinge(marks, envOf(ed), settings(ed), defaultCentre(ed)) : []);
  });
}
function addMark(ed: Editor, m: HingeMark) { mutate(ed, () => { (ed.doc.hinge ??= []).push(m); }); }

/** Turn every painted area into slits (replacing slits made before). One undo step. */
export function makeCuts(ed: Editor) {
  const areas = hingeAreas(ed), slits = slitsOf(areas);
  if (!areas.length) { ed.toast('Fill or paint an area first — then Make cuts'); return; }
  let total = 0; for (const s of slits) for (let i = 1; i < s.length; i++) total += dist(s[i - 1], s[i]);
  if (!slits.length) { ed.toast('These areas are too small for slits — make them bigger or the slits shorter'); return; }
  ed.store.change(() => { placeSlits(ed, areas); ed.doc.hingeMade = true; });
  const secs = laserTime(total, slits.length, 15, 1), bad = areas.filter(a => bendCheck(a.pattern, settings(ed), matSet(ed), bendR(ed)).state === 'bad').length;
  ed.toast(`Made ${slits.length} slits in ${areas.length} area${areas.length > 1 ? 's' : ''} · ${fmt(total / 1000, 2)} m of cutting ≈ ${Math.max(1, Math.round(secs / 60))} min at 15 mm/s` + (bad ? ` · ⚠ ${bad} area${bad > 1 ? 's' : ''} may snap (red) — widen the spacing` : ' · click an area to change it — the slits follow'));
}

/** The area (painted piece) under a point, if any. */
function areaAt(ed: Editor, p: Point): HingeArea | null {
  const inPoly = (q: Point, poly: Point[]) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > q.y) !== (b.y > q.y) && q.x < (b.x - a.x) * (q.y - a.y) / (b.y - a.y) + a.x) c = !c; } return c; };
  for (const a of hingeAreas(ed)) { let n = 0; for (const poly of a.mask) if (inPoly(p, poly)) n++; if (n % 2 === 1) return a; }
  return null;
}
const sameSel = (a: number[] | null | undefined, b: number[]) => !!a && a.length === b.length && a.every((x, i) => x === b[i]);
/** The area that is selected for changing (its marks), refreshed after changes. */
function selArea(ed: Editor): HingeArea | null { const s: number[] | null = ed.state.hbSel; if (!s) return null; return hingeAreas(ed).find(a => a.marks.some(i => s.includes(i))) || null; }
function selectArea(ed: Editor, a: HingeArea | null) {
  ed.state.hbSel = a ? a.marks.slice() : null;
  if (a) { const m: any = (ed.doc.hinge || [])[a.index]; ed.opt.hbPattern = a.pattern; ed.opt.hbAngle = m?.angle != null ? m.angle : ''; }
  ed.changed('opts'); ed.changed('prompt'); ed.changed('tool');
}
const normA = (x: number) => Math.round(((x % 180) + 180) % 180) % 180;
/** Turn the selected area's slits (or the next fill's) by `step` degrees. */
function rotate(ed: Editor, step: number) {
  const sel = selArea(ed);
  if (sel) {
    const base = sel.angle ?? autoAngle(sel.mask), ang = normA(base + step);
    if (!(lastRot.at > Date.now() - 1200 && sameSel(lastRot.sel, sel.marks))) ed.store.checkpoint();
    lastRot = { at: Date.now(), sel: sel.marks.slice() };
    for (const i of sel.marks) (ed.doc.hinge![i] as any).angle = ang;
    if (ed.doc.hingeMade) placeSlits(ed, computeHinge(ed.doc.hinge!, envOf(ed), settings(ed), defaultCentre(ed)));
    ed.store.emit(); ed.opt.hbAngle = ang; ed.changed('opts'); ed.state.hbMsg = { t: `Slits at ${ang}°`, until: Date.now() + 1200 }; return;
  }
  const prev = ed.state.hbPrev?.areas?.[0] as HingeArea | undefined;
  const base = ed.opt.hbAngle !== '' && ed.opt.hbAngle != null ? +ed.opt.hbAngle : prev?.angle ?? 0;
  ed.opt.hbAngle = normA(base + step); ed.changed('opts'); if (ed.opt.hbMode === 'area') previewFill(ed, ed.cur); ed.state.hbMsg = { t: `Slits at ${ed.opt.hbAngle}° · click to fill`, until: Date.now() + 1200 };
}
let lastRot: { at: number; sel: number[] } = { at: 0, sel: [] };

/** What a click would fill, shown before clicking (re-traced only when the pointer leaves the last area). */
function previewFill(ed: Editor, raw: Point) {
  const P0 = ed.state.hbPrev;
  const inPoly = (q: Point, poly: Point[]) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > q.y) !== (b.y > q.y) && q.x < (b.x - a.x) * (q.y - a.y) / (b.y - a.y) + a.x) c = !c; } return c; };
  let region: Point[] | null = P0?.region && inPoly(raw, P0.region) && P0.ver === ed.ver ? P0.region : null;
  if (!region) {
    const shapes = ed.doc.ents.filter(e => ed.store.visible(e) && e.type !== 'dim' && e.gen !== 'hinge').flatMap(e => e.type === 'text' ? ext.textShapes(e) : [e as Shape]);
    const r = shapes.length ? findRegion(raw, shapes) : { ok: false, pts: [] as Point[] };
    region = r.ok ? r.pts : null;
  }
  if (!region) { ed.state.hbPrev = null; return; }
  const pattern = ed.opt.hbPattern as HingePattern, angle = ed.opt.hbAngle === '' || ed.opt.hbAngle == null ? undefined : +ed.opt.hbAngle;
  const key = [region.length, region[0].x, region[0].y, pattern, angle, JSON.stringify(settings(ed)), ed.ver].join('|');
  if (P0?.key === key) { P0.at = raw; return; }
  const m: HingeMark = { kind: 'area', pattern, pts: region, at: raw, angle, c: centred(pattern) ? defaultCentre(ed, raw) : undefined };
  ed.state.hbPrev = { key, region, ver: ed.ver, at: raw, mark: m, areas: computeHinge([m], envOf(ed), settings(ed), defaultCentre(ed, raw)) };
}

const isSel = (ed: Editor) => !!ed.state.hbSel;
const matSet = (ed: Editor): MaterialSet => ({ mat: MATERIALS.find(m => m.id === ed.opt.hbMat) || MATERIALS[0], t: Math.max(0.5, +ed.opt.hbT || 3), kerf: Math.max(0, +ed.opt.hbKerf || 0.2) });
const bendR = (ed: Editor) => +ed.opt.hbBendR > 0 ? +ed.opt.hbBendR : undefined;
/** Spacing, slit, bridge and edge gap to suit the material (and the bend asked for). */
function recommend(ed: Editor) {
  const ms = matSet(ed), r = suggest(ms, bendR(ed));
  Object.assign(ed.opt, { hbPitch: r.pitch, hbSlit: r.slit, hbBridge: r.bridge, hbEdge: r.edge }); ed.changed('opts');
  ed.toast((r.ok ? `For ${ms.t} mm ${ms.mat.name.toLowerCase()}: spacing ${r.pitch}, slit ${r.slit}, bridge ${r.bridge} mm` : `R${bendR(ed)} mm is too tight for ${ms.t} mm ${ms.mat.name.toLowerCase()} — set to the closest it can do`) + (ms.mat.note ? ' · ' + ms.mat.note : ''));
}
/** A small sample of this pattern to cut from scrap first. */
function testStrip(ed: Editor) {
  let x1 = -Infinity, y0 = Infinity; for (const e of ed.doc.ents) { if (e.gen === 'hinge' || !ed.store.visible(e)) continue; const b = ed.bbox(e); x1 = Math.max(x1, b.x1); y0 = Math.min(y0, b.y0); }
  const x = isFinite(x1) ? x1 + 10 : 10, y = isFinite(y0) ? y0 : 10, W = 90, H = 30, pts = [P(x, y), P(x + W, y), P(x + W, y + H), P(x, y + H)];
  const pattern = ed.opt.hbPattern as HingePattern;
  mutate(ed, () => { ed.store.add({ type: 'poly', closed: true, pts } as Shape); (ed.doc.hinge ??= []).push({ kind: 'area', pattern, pts, at: P(x + W / 2, y + H / 2), angle: angleOpt(ed), c: centred(pattern) ? P(x + W / 2, y + H / 2) : undefined }); });
  ed.toast('Test strip added (90 × 30 mm) — Make cuts, cut it from scrap, and check the bend before cutting your real part');
}
const OPTIONS: OptionSpec[] = [
  { key: 'hbMode', label: 'Mark by', type: 'seg', choices: [['area', 'Fill an area'], ['paint', 'Paint'], ['fold', 'Fold line'], ['erase', 'Eraser']] },
  { key: 'hbPattern', label: 'Pattern', type: 'swatch', choices: HINGE_PATTERNS.map(p => [p.id, p.label, p.fill, p.edge] as [string, string, string, string]) },
  { key: 'hbAngle', label: 'Angle of slits', type: 'number', min: 0, max: 180, step: 15, unit: '°', placeholder: 'best', show: ed => !centred(ed.opt.hbPattern) },
  { key: 'hbTurn', label: 'Turn 90°', type: 'button', run: ed => { rotate(ed, 90); ed.changed('tool'); }, show: ed => !centred(ed.opt.hbPattern) },
  { key: 'hbAuto', label: 'Best angle', type: 'button', run: ed => { ed.opt.hbAngle = ''; applyOpt(ed, 'hbAngle'); ed.changed('opts'); ed.changed('tool'); ed.toast('Slits set across the area’s length, so it bends along it'); }, show: ed => !centred(ed.opt.hbPattern) && ed.opt.hbAngle !== '' && ed.opt.hbAngle != null },
  { key: 'hbR', label: 'Brush size', type: 'number', min: 1, step: 1, unit: 'mm', show: ed => ed.opt.hbMode !== 'area' },
  { key: 'hbFollow', label: 'Slits follow the stroke (snake)', type: 'check', show: ed => ed.opt.hbMode === 'paint' && !centred(ed.opt.hbPattern) },
  { key: 'hbOver', label: 'Paint over', type: 'check', show: ed => ed.opt.hbMode !== 'erase' },
  { key: 'hbPick', label: 'Pick centre', type: 'button', run: ed => { ed.state.pickCentre = true; ed.toast('Click where the centre should be'); ed.changed('prompt'); }, show: ed => centred(ed.opt.hbPattern) },
  { key: 'hbMat', label: 'Material', type: 'select', choices: MATERIALS.map(m => [m.id, m.name] as [string, string]) },
  { key: 'hbT', label: 'Thickness', type: 'number', min: 0.5, step: 0.5, unit: 'mm' },
  { key: 'hbKerf', label: 'Kerf', type: 'number', min: 0, step: 0.05, unit: 'mm' },
  { key: 'hbBendR', label: 'Bend to R', type: 'number', min: 1, step: 5, unit: 'mm', placeholder: 'any' },
  { key: 'hbSuggest', label: '★ Recommend', type: 'button', run: recommend },
  { key: 'hbPitch', label: 'Spacing', type: 'number', min: 0.5, step: 0.5, unit: 'mm' },
  { key: 'hbSlit', label: 'Slit', type: 'number', min: 1, step: 1, unit: 'mm' },
  { key: 'hbBridge', label: 'Bridge', type: 'number', min: 0.5, step: 0.5, unit: 'mm' },
  { key: 'hbEdge', label: 'Edge gap', type: 'number', min: 0, step: 0.5, unit: 'mm' },
  { key: 'hbPreview', label: 'Show slits', type: 'check' },
  { key: 'hbDel', label: 'Remove this area', type: 'button', run: ed => removeSel(ed), show: isSel },
  { key: 'hbTest', label: 'Test strip', type: 'button', run: testStrip },
  { key: 'hbMake', label: 'Make cuts', type: 'button', run: makeCuts },
  { key: 'hbClear', label: 'Clear paint', type: 'button', run: ed => { if (!(ed.doc.hinge || []).length) return; ed.state.hbSel = null; ed.store.change(() => { ed.doc.hinge = []; ed.doc.hingeMade = false; }); ed.toast('Paint cleared (the slits already made stay — undo to bring the paint back)'); } },
];
function removeSel(ed: Editor) {
  const s: number[] | null = ed.state.hbSel; if (!s) return; ed.state.hbSel = null;
  mutate(ed, () => { ed.doc.hinge = (ed.doc.hinge || []).filter((_, i) => !s.includes(i)); });
  ed.changed('tool'); ed.toast('Area removed');
}
/** Changing the pattern or angle while an area is selected changes that area. */
function applyOpt(ed: Editor, key: string) {
  const s: number[] | null = ed.state.hbSel; if (!s || (key !== 'hbPattern' && key !== 'hbAngle')) return;
  mutate(ed, () => { for (const i of s) { const m: any = ed.doc.hinge![i]; if (!m || m.kind === 'erase') continue; if (key === 'hbPattern') m.pattern = ed.opt.hbPattern; else if (ed.opt.hbAngle === '' || ed.opt.hbAngle == null) delete m.angle; else m.angle = normA(+ed.opt.hbAngle); } });
}

const brushPx = (ed: Editor) => Math.max(1, +ed.opt.hbR || 12) * ed.view.k;
const angleOpt = (ed: Editor) => ed.opt.hbAngle === '' || ed.opt.hbAngle == null || centred(ed.opt.hbPattern) ? undefined : normA(+ed.opt.hbAngle);

export const hingeBrushTool: Tool = {
  id: 'hbrush', label: 'Hinge brush', key: 'H', icon: HB_ICON, group: 3,
  options: OPTIONS,
  onOpt: applyOpt,
  prompt: ed => ed.state.pickCentre ? 'Click where the centre of the circles / spokes should be'
    : ed.state.hbSel ? 'Area selected · pick a colour or angle to change it · wheel turns the slits · Delete removes it · Esc to finish'
    : ed.opt.hbMode === 'fold' ? (ed.state.foldA ? 'Click the other end of the fold line' : 'Click one end of the fold line (across a corner or flap)')
    : ed.opt.hbMode === 'area' ? 'Point inside an area to see the slits · mouse wheel turns them · click to fill · click a filled area to change it'
    : ed.opt.hbMode === 'erase' ? 'Drag over paint to rub it out · wheel changes the size'
    : 'Paint the area · wheel changes the brush size, Shift+wheel turns the slits · then Make cuts',
  activate(ed) { ed.state.hbSel = null; ed.state.hbPrev = null; },
  deactivate(ed) { ed.state.hbSel = null; ed.state.hbPrev = null; },
  down(ed, raw) {
    if (ed.state.pickCentre) { ed.opt.hbCentre = ed.snapAt(raw).p; ed.state.pickCentre = false; ed.toast('Centre set'); ed.changed('prompt'); return; }
    const pattern = ed.opt.hbPattern as HingePattern, over = !!ed.opt.hbOver, c = centred(pattern) ? defaultCentre(ed, raw) : undefined, mode = ed.opt.hbMode, angle = angleOpt(ed);
    if (mode === 'fold') {
      const p = ed.snapAt(raw).p;
      if (!ed.state.foldA) { ed.state.foldA = p; ed.changed('prompt'); return; }
      const a = ed.state.foldA; ed.state.foldA = null; ed.changed('prompt');
      if (dist(a, p) < 1) return;
      addMark(ed, { kind: 'fold', pattern, a, b: p, w: Math.max(2, 2 * (+ed.opt.hbR || 12)), over, c }); return;
    }
    if (mode === 'area') {
      // a click on a filled area selects it for changing; anywhere else fills
      const hit = areaAt(ed, raw);
      if (hit) { selectArea(ed, sameSel(ed.state.hbSel, hit.marks) ? null : hit); return; }
      if (ed.state.hbSel) { selectArea(ed, null); }
      previewFill(ed, raw); const pv = ed.state.hbPrev;
      if (!pv) { ed.toast('Click inside a closed area'); return; }
      addMark(ed, { ...pv.mark, over, angle, c }); ed.state.hbPrev = null; return;
    }
    ed.state.stroke = [raw];
  },
  move(ed, raw) {
    const st: Point[] | undefined = ed.state.stroke;
    if (st) { if (dist(st[st.length - 1], raw) > Math.max(0.3, (+ed.opt.hbR || 12) / 8)) st.push(raw); return; }
    if (ed.opt.hbMode === 'area' && !ed.state.hbSel) {
      const now = performance.now(); if (now - (ed.state.hbPrevT || 0) < 60) return; ed.state.hbPrevT = now;
      if (areaAt(ed, raw)) { ed.state.hbPrev = null; return; }
      previewFill(ed, raw);
    }
  },
  up(ed, raw) {
    const st: Point[] | undefined = ed.state.stroke; if (!st) return; ed.state.stroke = null;
    if (dist(st[st.length - 1], raw) > 1e-6) st.push(raw);
    const r = Math.max(1, +ed.opt.hbR || 12), pattern = ed.opt.hbPattern as HingePattern;
    if (ed.opt.hbMode === 'erase') addMark(ed, { kind: 'erase', pts: st, r });
    else addMark(ed, { kind: 'brush', pattern, pts: st, r, over: !!ed.opt.hbOver, angle: ed.opt.hbFollow ? undefined : angleOpt(ed), follow: !!ed.opt.hbFollow || undefined, c: centred(pattern) ? defaultCentre(ed, st[0]) : undefined });
  },
  wheel(ed, dir, info) {
    const mode = ed.opt.hbMode, step = (info.shift && mode === 'area') || (info.alt) ? 5 : 15;
    if (ed.state.hbSel || mode === 'area' || (mode === 'paint' && info.shift)) { if (centred(ed.opt.hbPattern)) return false; rotate(ed, dir * step); return true; }
    ed.opt.hbR = Math.max(1, Math.min(200, +((+ed.opt.hbR || 12) * (dir > 0 ? 1.15 : 1 / 1.15)).toFixed(1))); ed.changed('opts'); return true;
  },
  onKey(ed, key) {
    if ((key === 'Delete' || key === 'Backspace') && ed.state.hbSel) { removeSel(ed); return true; }
    return false;
  },
  cancel(ed) {
    if (ed.state.hbSel) { selectArea(ed, null); return true; }
    if (ed.state.stroke || ed.state.foldA || ed.state.pickCentre) { ed.state.stroke = null; ed.state.foldA = null; ed.state.pickCentre = false; ed.changed('prompt'); return true; }
    return false;
  },
  /** the painted areas, light and see-through, always visible (very faint once the cuts are made) */
  underlay(ctx, ed) {
    const areas = hingeAreas(ed); if (!areas.length) return;
    const active = ed.tool.id === 'hbrush', made = !!ed.doc.hingeMade;
    ctx.save();
    for (const a of areas) {
      ctx.beginPath(); for (const poly of a.mask) { poly.forEach((p, i) => { const s = ed.w2s(p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); }); ctx.closePath(); }
      const pi = patternInfo(a.pattern);
      ctx.globalAlpha = made ? (active ? 0.22 : 0.1) : (active ? 0.42 : 0.25); ctx.fillStyle = pi.fill; ctx.fill('evenodd');
      if (made && active) { ctx.globalAlpha = 0.6; ctx.strokeStyle = pi.edge; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]); }
    }
    ctx.restore();
  },
  overlay(ed, o) {
    const pat = patternInfo(ed.opt.hbPattern);
    o.custom((ctx, ed2) => {
      const areas = hingeAreas(ed2), made = !!ed2.doc.hingeMade, sel = selArea(ed2);
      const strokeSlits = (list: HingeArea[], alpha: number) => {
        ctx.save(); ctx.lineWidth = 1; ctx.globalAlpha = alpha;
        for (const a of list) { ctx.strokeStyle = patternInfo(a.pattern).edge; ctx.beginPath(); for (const s of a.slits) s.forEach((p, i) => { const q = ed2.w2s(p); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.stroke(); }
        ctx.restore();
      };
      // faint preview of the slits (once made, the real slits are drawn by the drawing itself)
      if (ed2.opt.hbPreview && !made) strokeSlits(areas, 0.8);
      // what a click would fill
      const pv = ed2.state.hbPrev;
      if (pv && ed2.opt.hbMode === 'area' && !ed2.state.hbSel && ed2.hover) {
        ctx.save(); ctx.globalAlpha = 0.3; ctx.fillStyle = pat.fill;
        for (const a of pv.areas as HingeArea[]) { ctx.beginPath(); for (const poly of a.mask) { poly.forEach((p: Point, i: number) => { const s = ed2.w2s(p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); }); ctx.closePath(); } ctx.fill('evenodd'); }
        ctx.restore(); strokeSlits(pv.areas, 0.7);
      }
      // the selected area: outlined
      if (sel) {
        ctx.save(); ctx.strokeStyle = patternInfo(sel.pattern).edge; ctx.lineWidth = 2.5; ctx.setLineDash([]);
        ctx.beginPath(); for (const poly of sel.mask) { poly.forEach((p, i) => { const s = ed2.w2s(p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); }); ctx.closePath(); } ctx.stroke(); ctx.restore();
      }
      // bend-direction arrows and centres (while this tool is in use)
      for (const a of areas) {
        if (made && a !== sel) continue;
        if (a.arrow) arrow2(ctx, ed2.w2s(a.arrow.p), P(a.arrow.d.x, -a.arrow.d.y), patternInfo(a.pattern).edge);
        if (a.centre) target(ctx, ed2.w2s(a.centre), patternInfo(a.pattern).edge);
      }
      // bend check on each area: green fine, orange not as tight as asked, red may snap
      for (const a of areas) {
        const bc = bendCheck(a.pattern, settings(ed2), matSet(ed2), bendR(ed2)), two = a.pattern === 'lattice' || a.pattern === 'honeycomb';
        const at = a.arrow?.p ?? (() => { let x = 0, y = 0, n = 0; for (const q of a.mask[0]) { x += q.x; y += q.y; n++; } return P(x / n, y / n); })(), s0 = ed2.w2s(at), txt = (bc.state === 'bad' ? '⚠ may snap' : two ? 'bends both ways' : `≈ R${Math.round(bc.Rmin)} mm`) + (bc.state === 'tight' ? ' (too loose)' : '');
        ctx.save(); ctx.font = '600 11px system-ui, sans-serif'; const w = ctx.measureText(txt).width + 12, x = s0.x - w / 2, y = s0.y + 16;
        ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.strokeStyle = bc.state === 'ok' ? '#2b8a3e' : bc.state === 'tight' ? '#e67700' : '#e03131'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.roundRect(x, y, w, 18, 9); ctx.fill(); ctx.stroke(); ctx.fillStyle = ctx.strokeStyle; ctx.fillText(txt, x + 6, y + 13); ctx.restore();
      }
      if (centred(ed2.opt.hbPattern) && ed2.hover && !sel) target(ctx, ed2.w2s(defaultCentre(ed2, ed2.cur)), pat.edge);
      // the stroke being painted, the fold line being drawn, the brush
      const st: Point[] | undefined = ed2.state.stroke, erase = ed2.opt.hbMode === 'erase', R = brushPx(ed2);
      if (st && st.length) {
        ctx.save(); ctx.globalAlpha = erase ? 0.25 : 0.45; ctx.strokeStyle = erase ? '#999' : pat.fill; ctx.lineWidth = 2 * R; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); [...st, ed2.cur].forEach((p, i) => { const q = ed2.w2s(p); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.stroke(); ctx.restore();
      }
      if (ed2.opt.hbMode === 'fold' && ed2.state.foldA) {
        const a = ed2.w2s(ed2.state.foldA), b = ed2.w2s(ed2.snapRes?.p ?? ed2.cur);
        ctx.save(); ctx.globalAlpha = 0.45; ctx.strokeStyle = pat.fill; ctx.lineWidth = 2 * R; ctx.lineCap = 'butt'; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.globalAlpha = 1; ctx.strokeStyle = pat.edge; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore();
      }
      if (ed2.hover && (ed2.opt.hbMode === 'paint' || erase)) {
        const c = ed2.w2s(ed2.cur); ctx.save(); ctx.strokeStyle = erase ? '#888' : pat.edge; ctx.lineWidth = 1.5; ctx.setLineDash(erase ? [4, 3] : []); ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, TAU); ctx.stroke(); ctx.restore();
      }
    });
    const msg = ed.state.hbMsg; if (msg && Date.now() < msg.until) o.label(msg.t, ed.cur);
  },
};
function arrow2(ctx: CanvasRenderingContext2D, p: Point, d: Point, col: string) {
  const L = 16, h = 6, a = P(p.x - d.x * L, p.y - d.y * L), b = P(p.x + d.x * L, p.y + d.y * L), n = P(-d.y, d.x);
  ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  for (const [t, s] of [[b, 1], [a, -1]] as [Point, number][]) { ctx.moveTo(t.x - d.x * h * s + n.x * h * 0.6, t.y - d.y * h * s + n.y * h * 0.6); ctx.lineTo(t.x, t.y); ctx.lineTo(t.x - d.x * h * s - n.x * h * 0.6, t.y - d.y * h * s - n.y * h * 0.6); }
  ctx.stroke(); ctx.restore();
}
function target(ctx: CanvasRenderingContext2D, p: Point, col: string) {
  ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.setLineDash([]); ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, TAU); ctx.moveTo(p.x - 11, p.y); ctx.lineTo(p.x + 11, p.y); ctx.moveTo(p.x, p.y - 11); ctx.lineTo(p.x, p.y + 11); ctx.stroke(); ctx.restore();
}
