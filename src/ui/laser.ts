/**
 * Laser workspace (first version, nothing talks to the machine yet).
 * A column of numbered steps you work down every time you cut, beside a picture of the bed
 * drawn as you stand at the front of the laser:
 *   1 Your laser (set up once, then folded)   2 Settings   3 Place it on the bed   4 Check it   5 Send
 */
import type { Editor } from '../editor/editor';
import { P, type Point } from '../geometry/vec';
import { COLORS, MODE_LABEL, modeOf, type Doc, type ColorKey } from '../model/types';
import { sheetDoc } from '../io/sheets';
import { cutOrder, type LPath, type Phase, PHASES } from '../laser/order';
import { exportLaserSVG } from '../laser/export';
import { simulate, placement, fmtTime, clock, DEFAULT_MOTION, type Sim, type Step, type PhaseSet } from '../laser/sim';
import { loadState, saveState, cornerPt, fitsBed, overlapsTraces, inside as insidePoly, EXAMPLES, type LaserState, type Corner } from '../laser/machine';
import { buildJob, colsThatFit, thin, laserBox } from '../laser/job';
import { laserPaths } from '../laser/order';
import { findParts } from '../nest/parts';
import { affEnt, affMove, affScale } from '../geometry/affine';
import type { Entity, Shape } from '../model/types';

const PH_LABEL: Record<Phase, string> = { engrave: 'Engrave area', score: 'Engrave line', cut: 'Cut' };
const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);
const r1 = (v: number) => (Math.round(v * 10) / 10).toString();
type Box = { x0: number; y0: number; x1: number; y1: number };
const boxOf = (pts: Point[]): Box => pts.reduce((b, p) => ({ x0: Math.min(b.x0, p.x), y0: Math.min(b.y0, p.y), x1: Math.max(b.x1, p.x), y1: Math.max(b.y1, p.y) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
const ALIGN_ICON: Record<string, string> = {
  left: '<path d="M3 2v16"/><rect x="6" y="5" width="9" height="3"/><rect x="6" y="11" width="5" height="3"/>',
  centre: '<path d="M10 2v16" stroke-dasharray="2 1.5"/><rect x="4" y="5" width="12" height="3"/><rect x="6.5" y="11" width="7" height="3"/>',
  right: '<path d="M17 2v16"/><rect x="5" y="5" width="9" height="3"/><rect x="9" y="11" width="5" height="3"/>',
  back: '<path d="M2 3h16"/><rect x="5" y="6" width="3" height="9"/><rect x="11" y="6" width="3" height="5"/>',
  middle: '<path d="M2 10h16" stroke-dasharray="2 1.5"/><rect x="5" y="4" width="3" height="12"/><rect x="11" y="6.5" width="3" height="7"/>',
  front: '<path d="M2 17h16"/><rect x="5" y="5" width="3" height="9"/><rect x="11" y="9" width="3" height="5"/>',
};
const hexOf = (k: string) => k === 'paint' ? '#E58FB0' : (COLORS[k as ColorKey]?.hex || '#000');

export function openLaser(ed: Editor, saveFile: (name: string, text: string) => void) {
  document.getElementById('laserWs')?.remove();
  const S: LaserState = loadState();
  const nS = Math.max(1, ed.doc.sheets || 1); let sheet = 0;
  let base: Doc, doc: Doc, paths: LPath[] = [], box = { x0: 0, y0: 0, x1: 0, y1: 0 }, sim: Sim | null = null;
  let addingMat = false, matDirty = false;
  // quick changes on the bed: picked parts (by object id), parts left out of this cut, the parts themselves (bed coords)
  const sel = new Set<string>(), left = new Set<string>();
  let parts: { ids: string[]; polys: Point[][]; box: Box }[] = [], cbOff = { dx: 0, dy: 0, w: 0, h: 0 };
  let selDrag: Point | null = null, boxSel: { a: Point; b: Point } | null = null, setupAnim: number | null = null;
  let ruler: Point | null = null, rulerOn = false, tPlay = 0, playing = false, speed = 10, showTravel = true, frameAnim: number | null = null;
  const save = () => saveState(S);

  const root = document.createElement('div'); root.id = 'laserWs'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Laser');
  root.innerHTML = `
    <div class="lw-head">
      <strong>Laser</strong>
      <span class="lw-sheet" id="lwSheet"></span>
      <label class="tog" title="Short explanations under each step"><input type="checkbox" role="switch" id="lwHelp" ${S.help ? 'checked' : ''}> Help</label>
      <button class="btn" id="lwClose">Back to drawing</button>
    </div>
    <div class="lw-body">
      <aside class="lw-steps" id="lwSteps"></aside>
      <main class="lw-main">
        <div class="lw-bedwrap"><canvas id="lwBed" aria-label="The laser bed, as you stand at the front"></canvas>
          <button type="button" class="lw-arrow" id="lwArrFB" title="Flip front ↕ back" aria-label="Flip front and back" hidden>⇅</button>
          <button type="button" class="lw-arrow" id="lwArrLR" title="Flip left ↔ right" aria-label="Flip left and right" hidden>⇆</button></div>
        <div class="lw-player">
          <button class="btn primary" id="lwPlay" title="Play the job: watch the order the laser will follow">▶ Play</button>
          <input type="range" id="lwScrub" min="0" max="1000" value="0" aria-label="Where in the job">
          <span class="mono" id="lwClock">0:00 / 0:00</span>
          <div class="segc" id="lwSpeed" role="group" aria-label="Play speed">${[1, 10, 50].map(v => `<button type="button" data-v="${v}" aria-pressed="${v === speed}">${v}×</button>`).join('')}</div>
          <label class="tog"><input type="checkbox" role="switch" id="lwTravel" checked> Moves with laser off</label>
        </div>
        <p class="lw-msg" id="lwMsg" role="status"></p>
      </main>
    </div>`;
  document.body.append(root);
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector(s) as T;
  const canvas = $<HTMLCanvasElement>('#lwBed'), ctx = canvas.getContext('2d')!;

  // ---------- the job ----------
  function loadJob() { base = nS > 1 ? sheetDoc(ed.doc, sheet) : ed.doc; makeJob(); }
  /** the sheet's drawing turned and copied as asked, moved to (0, 0) */
  function makeJob() {
    const one = buildJob(base, { turns: S.turns, copies: 1, gap: S.gap, cols: 1 });
    const x = S.placeMode === 'bed' ? S.at.x : S.head.x - (S.anchor === 'centre' ? one.W / 2 : 0);
    const j = S.copies > 1 ? buildJob(base, { turns: S.turns, copies: S.copies, gap: S.gap, cols: colsThatFit(S.machine.bedW, x, one.one.w, S.gap) }) : one;
    doc = j.doc; box = { x0: 0, y0: 0, x1: j.W, y1: j.H }; sel.clear(); left.clear();
    rebuild();
  }
  /** settings for a colour: its own row, or (until it has one) what its kind of job starts with */
  const setFor = (k: string, ph: Phase): PhaseSet => S.colors[k] ?? S.phase[ph];
  const refW = () => box.x1 - box.x0, refH = () => box.y1 - box.y0;
  /** where the job's frame (as it was made) has its top-left on the bed */
  const jobAt = (): Point => S.placeMode === 'bed' ? S.at : S.anchor === 'centre' ? P(S.head.x - refW() / 2, S.head.y - refH() / 2) : S.head;
  const startPt = (): Point => S.placeMode === 'bed' ? cornerPt(S.machine) : S.head;
  /** what will actually be cut, on the bed (after quick changes and leaving parts out) */
  const jobBox = (): Box => { const a = jobAt(); return { x0: a.x + cbOff.dx, y0: a.y + cbOff.dy, x1: a.x + cbOff.dx + cbOff.w, y1: a.y + cbOff.dy + cbOff.h }; };
  const jobW = () => cbOff.w, jobH = () => cbOff.h;
  const cutDoc = (): Doc => left.size ? { ...doc, ents: doc.ents.filter(e => !left.has(e.id)) } : doc;
  function rebuild() {
    const pl = placement(box, jobAt());
    // order again from where the head really starts, then simulate
    const st = pl.toDoc(startPt()); paths = cutOrder(cutDoc(), { start: st }).paths;
    sim = simulate(paths, pl.toBed, p => setFor(String(p.key), p.phase), startPt(), DEFAULT_MOTION);
    // the parts you can pick on the bed (a part = an outline with its holes and engraving; copies are separate)
    const lasered = new Set(laserPaths(doc).flatMap(p => p.ids)), copyOf = (e: Entity) => e.id.split('#')[1] || '';
    parts = findParts(doc.ents.filter(e => lasered.has(e.id)) as Entity[], e => e.group?.length ? e.group[e.group.length - 1] + '#' + copyOf(e) : null)
      .map(q => { const polys = q.polys.map(r => r.map(pl.toBed)); return { ids: q.ids, polys, box: boxOf(polys.flat()) }; });
    const a = jobAt(), cb = sim.box || { x0: a.x, y0: a.y, x1: a.x + refW(), y1: a.y + refH() };
    cbOff = { dx: cb.x0 - a.x, dy: cb.y0 - a.y, w: cb.x1 - cb.x0, h: cb.y1 - cb.y0 };
    tPlay = Math.min(tPlay, sim.total); msg('');
    overlapN = S.traces.length ? overlapsTraces(jobParts().map(q => thin(q, 1)), S.traces) : 0;
    renderSteps(); draw(); updatePlayer();
  }
  const present = () => new Set(paths.map(p => p.phase));
  /** the colours in the job, in the order the laser does them */
  const colours = () => { const seen = new Map<string, Phase>(); for (const ph of PHASES) for (const p of paths) if (p.phase === ph && !seen.has(String(p.key))) seen.set(String(p.key), ph); return [...seen]; };
  /** outlines of the job on the bed (from the simulation) */
  const jobParts = () => (sim?.steps || []).flatMap(st => st.k === 'line' ? [st.pts] : st.k === 'area' ? st.rings : []);
  let overlapN = 0;
  const overlap = () => overlapN;

  // ---------- quick changes to picked parts (the drawing itself is not changed) ----------
  const pickedParts = () => parts.filter(q => q.ids.some(id => sel.has(id)) && !q.ids.every(id => left.has(id)));
  const pickedBox = () => { const ps = pickedParts(); return ps.length ? boxOf(ps.flatMap(q => [P(q.box.x0, q.box.y0), P(q.box.x1, q.box.y1)])) : null; };
  function changePicked(A: (c: Point) => Parameters<typeof affEnt>[1]) {
    const ids = new Set(pickedParts().flatMap(q => q.ids)); if (!ids.size) return;
    const sub = laserBox({ ...doc, ents: doc.ents.filter(e => ids.has(e.id)) }); if (!sub) return;
    const T = A(P((sub.x0 + sub.x1) / 2, (sub.y0 + sub.y1) / 2));
    doc = { ...doc, ents: doc.ents.map(e => ids.has(e.id) ? { ...(affEnt(e as Shape, T) as any), id: e.id, layer: e.layer, color: e.color, w: e.w, group: e.group } : e) };
    rebuild();
  }
  const scalePicked = (f: number) => changePicked(c => affScale(c, f, f));
  /** move by a distance on the bed (y from the back = down the drawing) */
  const movePicked = (d: Point) => changePicked(() => affMove(P(d.x, -d.y)));
  function partAt(p: Point) {
    for (let i = parts.length - 1; i >= 0; i--) { const q = parts[i]; if (q.ids.every(id => left.has(id))) continue; if (p.x < q.box.x0 - 1 || p.x > q.box.x1 + 1 || p.y < q.box.y0 - 1 || p.y > q.box.y1 + 1) continue; if (q.polys.some(r => r.length > 2 && insidePoly(p, r))) return q; }
    return null;
  }

  // ---------- steps ----------
  function stepHtml(n: number, title: string, open: boolean, summary: string, body: string, id: string) {
    return `<section class="lw-step${open ? ' open' : ''}" id="${id}"><div class="lw-sh"><span class="lw-n">${n}</span><b>${title}</b>${!open && summary ? `<span class="lw-sum">${summary}</span>` : ''}</div>${open ? `<div class="lw-sb">${body}</div>` : ''}</section>`;
  }
  const help = (t: string) => S.help ? `<p class="lw-help">${t}</p>` : '';
  function renderSteps() {
    const m = S.machine, has = present(), fit = fitsBed(m, jobBox()), est = sim;
    $('#lwSheet').innerHTML = nS > 1 ? `Sheet <span class="segc" id="lwSh">${Array.from({ length: nS }, (_, i) => `<button type="button" data-v="${i}" aria-pressed="${i === sheet}">${i + 1}</button>`).join('')}</span>` : esc(ed.doc.name || '');
    const s1 = stepHtml(1, 'Your laser', !m.setUp, `✓ ${esc(m.name)} · ${m.bedW} × ${m.bedH} mm <button type="button" class="lw-link" id="lwChange">Change</button>`, `
      ${help('Do this once. Stand at the <b>front</b> of the laser. The big picture is the bed: the pink bands are the <b>back</b> and the <b>sides</b>; you stand at the open edge.')}
      <div class="lw-grid"><label for="lwName">Name</label><span class="lw-in"><input type="text" id="lwName" value="${esc(m.name)}"></span>
        <label for="lwBW">Bed width</label><span class="lw-in"><input type="text" inputmode="decimal" id="lwBW" value="${m.bedW}"> mm</span>
        <label for="lwBH">Bed depth</label><span class="lw-in"><input type="text" inputmode="decimal" id="lwBH" value="${m.bedH}"> mm</span></div>
      <ol class="lw-howto">
        <li>Switch the laser on. On the big picture, <b>click the corner the head goes to</b> (the green dot).</li>
        <li>Press <b>▶ Show how it should frame</b> and watch the picture. Then press Frame on the real laser.</li>
        <li>Did the real head go the other way? Click the <b>⇅</b> or <b>⇆</b> arrow on the bed until the picture moves the same way as the laser.</li>
      </ol>
      <div class="lw-row wrap"><button type="button" class="btn" id="lwOriPlay">▶ Show how it should frame</button>${m.flipLR || m.flipFB ? `<span class="lw-read small">Flipped: ${[m.flipLR ? 'left ↔ right' : '', m.flipFB ? 'front ↕ back' : ''].filter(Boolean).join(', ')}</span>` : ''}</div>
      <button type="button" class="btn primary" id="lwSetUp">Done: my laser is set up</button>`, 'lwS1');
    const mine = S.myMaterials.find(m => m.id === S.material);
    const rows = colours().map(([k, ph]) => { const st = setFor(k, ph), name = k === 'paint' ? 'Fills' : COLORS[k as ColorKey]?.label || k;
      const does = k === 'paint' ? PH_LABEL.engrave : MODE_LABEL[modeOf(doc, k as ColorKey)];
      return `<tr data-k="${k}" data-ph="${ph}" class="${st.on ? '' : 'off'}" title="${esc(name)}: ${does.toLowerCase()} (set in the drawing)"><td><span class="sw" style="background:${hexOf(k)}"></span>${esc(name)}</td>
        <td><input type="text" inputmode="decimal" data-f="speed" value="${st.speed}" aria-label="${esc(name)} speed"></td>
        <td><input type="text" inputmode="decimal" data-f="power" value="${st.power}" aria-label="${esc(name)} power"></td>
        <td><input type="text" inputmode="numeric" data-f="passes" value="${st.passes}" aria-label="${esc(name)} passes"></td>
        <td><label class="tog sm"><input type="checkbox" role="switch" data-f="air" ${st.air ? 'checked' : ''} aria-label="${esc(name)} air"></label></td>
        <td><label class="tog sm"><input type="checkbox" role="switch" data-f="on" ${st.on ? 'checked' : ''} aria-label="${esc(name)} on"></label></td></tr>`; }).join('');
    const s2 = stepHtml(2, 'Material and settings', true, '', `
      <div class="lw-row"><select id="lwMat" aria-label="Material">
        <option value="" ${S.material === '' ? 'selected' : ''}>Choose a material…</option>
        ${S.myMaterials.length ? `<optgroup label="My materials">${S.myMaterials.map(m => `<option value="${m.id}" ${m.id === S.material ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</optgroup>` : ''}
        <optgroup label="Examples (test on scrap first)">${Object.entries(EXAMPLES).map(([k, e]) => `<option value="ex:${k}" ${'ex:' + k === S.material ? 'selected' : ''}>${e.label}</option>`).join('')}</optgroup>
      </select><button type="button" class="btn" id="lwAddMat">+ Add material</button></div>
      ${addingMat ? `<div class="lw-row"><input type="text" id="lwMatName" placeholder="Name, e.g. 3 mm birch ply" style="width:190px"><button type="button" class="btn primary" id="lwMatSave">Save</button><button type="button" class="lw-link" id="lwMatCancel">Cancel</button></div>` : ''}
      ${mine ? `<div class="lw-row small">${matDirty ? `<button type="button" class="lw-link" id="lwMatUpd">Save changes to “${esc(mine.name)}”</button>` : ''}<button type="button" class="lw-link" id="lwMatDel">Delete “${esc(mine.name)}”</button></div>` : ''}
      ${rows ? `<table class="lw-lay"><thead><tr><th></th><th>Speed<small>mm/s</small></th><th>Power<small>%</small></th><th>Passes</th><th>Air</th><th>On</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="bad">Nothing on this sheet is set to cut or engrave.</p>'}
      ${help('One row per colour in your drawing, done top to bottom. <b>Speed</b>: how fast the head moves (slower cuts deeper). <b>Power</b>: how strong the laser is. <b>Passes</b>: how many times it goes round. <b>Air</b>: blows away smoke and flames. <b>On</b>: switch a colour off to skip it. Got settings that work? <b>+ Add material</b> keeps them for next time. The examples are only a starting point: always test on a scrap first.')}`, 'lwS2');
    const placeBody = `
      <div class="lw-cards" role="radiogroup">
        <button type="button" role="radio" data-pm="bed" aria-checked="${S.placeMode === 'bed'}"><b>Where it is on the bed</b><span>The picture is where it cuts. Drag the job, or type how far from the back-left corner.</span></button>
        <button type="button" role="radio" data-pm="head" aria-checked="${S.placeMode === 'head'}"><b>Start where the laser head is</b><span>Move the head over your material; the job sits under it.</span></button>
      </div>
      ${S.placeMode === 'bed' ? `
        <div class="lw-grid"><label for="lwX">From the left</label><span class="lw-in"><input type="text" inputmode="decimal" id="lwX" value="${r1(jobBox().x0)}"> mm</span>
          <label for="lwY">From the back</label><span class="lw-in"><input type="text" inputmode="decimal" id="lwY" value="${r1(jobBox().y0)}"> mm</span>
          <span class="lw-lab">Line up</span><span class="lw-in"><span class="segc icons" role="group" aria-label="Line up across the bed">${['left', 'centre', 'right'].map(k => `<button type="button" data-al="${k}" title="Line up with the ${k === 'centre' ? 'middle' : k + '-hand side'} of the bed"><svg viewBox="0 0 20 20">${ALIGN_ICON[k]}</svg></button>`).join('')}</span>
            <span class="segc icons" role="group" aria-label="Line up front to back">${['back', 'middle', 'front'].map(k => `<button type="button" data-al="${k}" title="Line up with the ${k} of the bed"><svg viewBox="0 0 20 20">${ALIGN_ICON[k]}</svg></button>`).join('')}</span></span></div>` : `
        <div class="lw-grid"><label for="lwHX">Head from the left</label><span class="lw-in"><input type="text" inputmode="decimal" id="lwHX" value="${r1(S.head.x)}"> mm</span>
          <label for="lwHY">Head from the back</label><span class="lw-in"><input type="text" inputmode="decimal" id="lwHY" value="${r1(S.head.y)}"> mm</span>
          <span class="lw-lab">Head is at the job’s</span><span class="lw-in"><span class="segc" id="lwAnchor"><button type="button" data-v="top-left" aria-pressed="${S.anchor === 'top-left'}">top-left corner</button><button type="button" data-v="centre" aria-pressed="${S.anchor === 'centre'}">middle</button></span></span></div>
        ${help('Until Kerf is connected to the laser, type where you moved the head to (or drag the red cross on the bed). The job moves with the head, so what you see is what Frame will trace.')}`}
      <div class="lw-grid"><span class="lw-lab">Turn</span><span class="lw-in"><button type="button" class="btn sm" id="lwTurnL" title="Turn a quarter turn anticlockwise">⟲</button><button type="button" class="btn sm" id="lwTurnR" title="Turn a quarter turn clockwise">⟳</button></span>
        <label for="lwCopies">Copies</label><span class="lw-in"><input type="text" inputmode="numeric" id="lwCopies" value="${S.copies}">${S.copies > 1 ? `<label class="lw-sub">gap <input type="text" inputmode="decimal" id="lwGap" value="${S.gap}"> mm</label>` : ''}</span></div>
      ${quickHtml()}
      <div class="lw-row wrap"><button type="button" class="btn${rulerOn ? ' on' : ''}" id="lwRuler" aria-pressed="${rulerOn}">📏 Ruler</button>${ruler ? `<button type="button" class="btn" id="lwToRuler" title="Put the job's top-left corner on the ruler point">Move job to the ruler point</button><button type="button" class="lw-link" id="lwRulerClear">Clear ruler</button>` : ''}</div>
      ${ruler ? `<p class="lw-read">From the ruler point, the job starts <b>${r1(jobBox().x0 - ruler.x)} mm</b> ${jobBox().x0 >= ruler.x ? 'to the right' : 'to the left'} and <b>${r1(jobBox().y0 - ruler.y)} mm</b> ${jobBox().y0 >= ruler.y ? 'towards the front' : 'towards the back'}.</p>` : help('<b>Ruler</b>: click the bed to put a reference point (e.g. the corner of your acrylic). Kerf shows how far the job is from it.')}
      <div class="lw-cut">
        <label class="tog"><input type="checkbox" role="switch" id="lwTraces" ${S.showTraces ? 'checked' : ''}> Show what’s already been cut${S.traces.length ? ` (${S.traces.length})` : ''}</label>
        <div class="lw-row wrap"><button type="button" class="btn" id="lwMarkCut" title="Leave a grey shadow of this job on the bed">✓ Mark this job as cut</button>${S.traces.length ? `<button type="button" class="btn" id="lwNext">Next to the last cut</button><button type="button" class="lw-link" id="lwClearCut">New sheet: clear</button>` : ''}</div>
        ${help(S.traces.length ? 'Grey = already cut. The flag shows where the laser <b>started</b> the last job and the red ring where the head <b>finished</b>. Put the next job (or a re-cut) in the empty space.' : 'After the laser has cut a job, press <b>✓ Mark this job as cut</b>. A grey shadow stays on the bed, with where the laser started and finished, so the next job (or a re-cut) goes in the space that’s left. <b>Try it now:</b> press it, then <b>Next to the last cut</b>.')}
      </div>
      <p class="lw-read">Job size: <b>${r1(jobW())} × ${r1(jobH())} mm</b>${S.copies > 1 ? ` (${S.copies} copies)` : ''}${left.size ? ` · ${parts.filter(q => q.ids.every(id => left.has(id))).length} left out` : ''}</p>
      ${fit ? `<p class="bad">⚠ ${fit} Move the job so it fits on the bed.</p>` : `<p class="ok">✓ Fits on the bed.</p>`}
      ${overlap() ? `<p class="bad">⚠ This lands on something already cut. Move it into the empty space (or press <b>Next to the last cut</b>).</p>` : ''}`;
    const s3 = stepHtml(3, 'Place it on the bed', true, '', placeBody, 'lwS3');
    const s4 = stepHtml(4, 'Check it', true, '', est ? `
      <p class="lw-big">About <b>${fmtTime(est.total)}</b></p>
      <p class="lw-read">Cutting and marking ${r1(est.cutLen / 1000)} m${est.engraveTime ? ` · engraving ${fmtTime(est.engraveTime)}` : ''} · moves with the laser off ${r1(est.travelLen / 1000)} m</p>
      <div class="lw-row wrap"><button type="button" class="btn primary" id="lwPrev">▶ Preview the job</button><button type="button" class="btn" id="lwFrameScr">Show the frame</button><button type="button" class="btn" disabled title="Comes when Kerf is connected to the laser">Frame on the laser</button></div>
      ${help('<b>Preview</b> plays the job in the order the laser will follow (holes before outlines; red dashes are moves with the laser off). <b>Show the frame</b> draws the box the head will trace around the job. The time is an estimate; it gets closer once we read your laser’s own settings.')}` : '', 'lwS4');
    const s5 = stepHtml(5, 'Send', true, '', `
      <div class="lw-row wrap"><button type="button" class="btn primary" id="lwSave">Save file for LightBurn</button><button type="button" class="btn" disabled>Send to the laser</button></div>
      <button type="button" class="btn" id="lwCutDone" title="Leave a grey shadow of this job on the bed, so the next one goes in the space that's left">✓ Mark this job as cut</button>
      ${help('For now, save the file and open it in LightBurn (<b>File → Import</b>; in Optimization Settings switch optimisation off to keep this order). Sending straight to the laser comes when we connect Kerf to it, with a check before anything moves.')}`, 'lwS5');
    $('#lwSteps').innerHTML = s1 + s2 + s3 + s4 + s5;
    bindSteps(); draw();
  }
  function quickHtml() {
    const ps = pickedParts(), n = parts.filter(q => !q.ids.every(id => left.has(id))).length, out = parts.filter(q => q.ids.every(id => left.has(id))).length, pb = pickedBox();
    return `<div class="lw-quick">
      <div class="lw-qh"><b>Quick changes</b>${n > 1 ? `<button type="button" class="lw-link" id="lwSelAll">Pick all ${n}</button>` : ''}${ps.length ? `<button type="button" class="lw-link" id="lwSelNone">Clear</button>` : ''}</div>
      ${ps.length && pb ? `<p class="lw-read small">${ps.length} of ${n} part${n > 1 ? 's' : ''} picked</p>
        <div class="lw-grid"><label for="lwSW">Width</label><span class="lw-in"><input type="text" inputmode="decimal" id="lwSW" value="${r1(pb.x1 - pb.x0)}"> mm</span>
          <label for="lwSH">Height</label><span class="lw-in"><input type="text" inputmode="decimal" id="lwSH" value="${r1(pb.y1 - pb.y0)}"> mm <span class="lw-sub">(keeps its shape)</span></span></div>
        <div class="lw-row wrap"><button type="button" class="btn sm" id="lwSmaller" title="10% smaller">− 10%</button><button type="button" class="btn sm" id="lwBigger" title="10% bigger">+ 10%</button><button type="button" class="btn sm" id="lwLeave" title="Don't cut these this time">Leave out</button></div>`
      : help('Click a part on the bed to pick it (<b>Shift</b>+click for more), or drag a box round several. Then change their size, drag them, or leave them out of this cut. Your drawing isn’t changed.')}
      ${out ? `<p class="lw-read small">${out} part${out > 1 ? 's' : ''} left out of this cut · <button type="button" class="lw-link" id="lwBringBack">Bring back</button></p>` : ''}
    </div>`;
  }

  function num(v: string, lo: number, hi: number): number | null { const n = parseFloat(v.replace(',', '.')); return isFinite(n) && n >= lo && n <= hi ? n : null; }
  function bindSteps() {
    const on = (id: string, ev: string, f: (e: Event) => void) => { const el = root.querySelector('#' + id); if (el) el.addEventListener(ev, f); };
    root.querySelectorAll<HTMLElement>('#lwSh button').forEach(b => b.onclick = () => { sheet = +b.dataset.v!; loadJob(); });
    on('lwChange', 'click', () => { S.machine.setUp = false; save(); renderSteps(); });
    on('lwName', 'change', e => { S.machine.name = (e.target as HTMLInputElement).value.trim() || 'My laser'; save(); });
    on('lwBW', 'change', e => { const v = num((e.target as HTMLInputElement).value, 50, 3000); if (v) { S.machine.bedW = v; save(); rebuild(); } });
    on('lwBH', 'change', e => { const v = num((e.target as HTMLInputElement).value, 50, 3000); if (v) { S.machine.bedH = v; save(); rebuild(); } });
    on('lwOriPlay', 'click', () => playSetup());
    on('lwSetUp', 'click', () => { S.machine.setUp = true; save(); rebuild(); });
    on('lwMat', 'change', e => {
      const v = (e.target as HTMLSelectElement).value; if (!v) return;
      if (v.startsWith('ex:')) { S.phase = structuredClone(EXAMPLES[v.slice(3)].s); S.colors = {}; }
      else { const m = S.myMaterials.find(x => x.id === v); if (m) { S.phase = structuredClone(m.phase); S.colors = structuredClone(m.colors); } }
      S.material = v; matDirty = false; save(); rebuild();
    });
    on('lwAddMat', 'click', () => { addingMat = true; renderSteps(); root.querySelector<HTMLInputElement>('#lwMatName')?.focus(); });
    on('lwMatCancel', 'click', () => { addingMat = false; renderSteps(); });
    const snapshot = () => { const colors: Record<string, PhaseSet> = structuredClone(S.colors); for (const [k, ph] of colours()) colors[k] = structuredClone(setFor(k, ph)); return colors; };
    const addMat = () => {
      const name = root.querySelector<HTMLInputElement>('#lwMatName')?.value.trim(); if (!name) { root.querySelector<HTMLInputElement>('#lwMatName')?.focus(); return; }
      const id = 'm' + Date.now().toString(36); S.myMaterials.push({ id, name, colors: snapshot(), phase: structuredClone(S.phase) });
      S.material = id; addingMat = false; matDirty = false; save(); renderSteps(); msg(`Saved “${name}”. Choose it next time to get these settings back.`);
    };
    on('lwMatSave', 'click', addMat);
    on('lwMatName', 'keydown', e => { if ((e as KeyboardEvent).key === 'Enter') addMat(); });
    on('lwMatUpd', 'click', () => { const m = S.myMaterials.find(x => x.id === S.material); if (!m) return; m.colors = snapshot(); m.phase = structuredClone(S.phase); matDirty = false; save(); renderSteps(); msg(`Saved the changes to “${m.name}”.`); });
    on('lwMatDel', 'click', () => { const m = S.myMaterials.find(x => x.id === S.material); if (!m) return; S.myMaterials = S.myMaterials.filter(x => x !== m); S.material = ''; save(); renderSteps(); msg(`Deleted “${m.name}”. Your settings below are unchanged.`); });
    root.querySelectorAll<HTMLInputElement>('.lw-lay input').forEach(i => i.addEventListener('change', () => {
      const tr = i.closest('tr') as HTMLElement, k = tr.dataset.k!, ph = tr.dataset.ph as Phase, f = i.dataset.f!;
      const st = { ...setFor(k, ph) } as any;
      if (f === 'air' || f === 'on') st[f] = i.checked;
      else { const v = num(i.value, f === 'passes' ? 1 : 0.1, f === 'power' ? 100 : f === 'passes' ? 20 : 2000); if (v == null) { i.value = String(st[f]); return; } st[f] = f === 'passes' ? Math.round(v) : v; }
      S.colors[k] = st;
      if (S.material.startsWith('ex:')) S.material = ''; else if (S.material) matDirty = true;
      save(); rebuild();
    }));
    root.querySelectorAll<HTMLElement>('.lw-cards button').forEach(b => b.onclick = () => { S.placeMode = b.dataset.pm as any; save(); rebuild(); });
    // typed positions and lining up refer to what will be cut (its top-left corner)
    const setAt = (x: number | null, y: number | null) => { const jb = jobBox(); if (x != null) S.at = P(S.at.x + x - jb.x0, S.at.y); if (y != null) S.at = P(S.at.x, S.at.y + y - jb.y0); save(); rebuild(); };
    on('lwX', 'change', e => setAt(num((e.target as HTMLInputElement).value, -5000, 5000), null));
    on('lwY', 'change', e => setAt(null, num((e.target as HTMLInputElement).value, -5000, 5000)));
    root.querySelectorAll<HTMLElement>('[data-al]').forEach(b => b.onclick = () => {
      const m = S.machine, k = b.dataset.al!, w = jobW(), h = jobH();
      if (k === 'left') setAt(0, null); else if (k === 'centre') setAt(Math.round((m.bedW - w) / 2 * 10) / 10, null); else if (k === 'right') setAt(m.bedW - w, null);
      else if (k === 'back') setAt(null, 0); else if (k === 'middle') setAt(null, Math.round((m.bedH - h) / 2 * 10) / 10); else setAt(null, m.bedH - h);
    });
    on('lwSelAll', 'click', () => { parts.forEach(q => q.ids.forEach(id => sel.add(id))); renderSteps(); });
    on('lwSelNone', 'click', () => { sel.clear(); renderSteps(); });
    const sizeTo = (want: number | null, cur: number) => { if (want && cur > 0) scalePicked(want / cur); };
    on('lwSW', 'change', e => { const pb = pickedBox(); if (pb) sizeTo(num((e.target as HTMLInputElement).value, 0.5, 5000), pb.x1 - pb.x0); });
    on('lwSH', 'change', e => { const pb = pickedBox(); if (pb) sizeTo(num((e.target as HTMLInputElement).value, 0.5, 5000), pb.y1 - pb.y0); });
    on('lwSmaller', 'click', () => scalePicked(0.9));
    on('lwBigger', 'click', () => scalePicked(1 / 0.9));
    on('lwLeave', 'click', () => { for (const q of pickedParts()) q.ids.forEach(id => left.add(id)); sel.clear(); rebuild(); msg('Left out of this cut. Your drawing isn’t changed.'); });
    on('lwBringBack', 'click', () => { left.clear(); rebuild(); });
    on('lwMarkCut', 'click', () => markCut());
    on('lwHX', 'change', e => { const v = num((e.target as HTMLInputElement).value, -5000, 5000); if (v != null) { S.head = P(v, S.head.y); save(); rebuild(); } });
    on('lwHY', 'change', e => { const v = num((e.target as HTMLInputElement).value, -5000, 5000); if (v != null) { S.head = P(S.head.x, v); save(); rebuild(); } });
    root.querySelectorAll<HTMLElement>('#lwAnchor button').forEach(b => b.onclick = () => { S.anchor = b.dataset.v as any; save(); rebuild(); });
    on('lwRuler', 'click', () => { rulerOn = !rulerOn; msg(rulerOn ? 'Click the bed to put the ruler point.' : ''); renderSteps(); draw(); });
    on('lwRulerClear', 'click', () => { ruler = null; rulerOn = false; renderSteps(); draw(); });
    on('lwToRuler', 'click', () => { if (!ruler) return; if (S.placeMode === 'bed') S.at = ruler; else S.head = S.anchor === 'centre' ? P(ruler.x + jobW() / 2, ruler.y + jobH() / 2) : ruler; save(); rebuild(); });
    on('lwTurnL', 'click', () => { S.turns = (S.turns + 3) % 4; save(); makeJob(); });
    on('lwTurnR', 'click', () => { S.turns = (S.turns + 1) % 4; save(); makeJob(); });
    on('lwCopies', 'change', e => { const v = num((e.target as HTMLInputElement).value, 1, 200); if (v != null) { S.copies = Math.round(v); save(); makeJob(); } });
    on('lwGap', 'change', e => { const v = num((e.target as HTMLInputElement).value, 0, 200); if (v != null) { S.gap = v; save(); makeJob(); } });
    on('lwTraces', 'change', e => { S.showTraces = (e.target as HTMLInputElement).checked; save(); draw(); });
    on('lwClearCut', 'click', () => { S.traces = []; save(); rebuild(); msg('Cleared: the bed is empty again.'); });
    on('lwNext', 'click', () => {
      const last = S.traces[S.traces.length - 1]; if (!last) return; const g = 5, m = S.machine;
      const tries = [P(last.box.x1 + g, last.box.y0), P(last.box.x0, last.box.y1 + g), P(g, last.box.y1 + g)];
      const ok = tries.find(t => !fitsBed(m, { x0: t.x, y0: t.y, x1: t.x + jobW(), y1: t.y + jobH() }));
      if (!ok) { msg('There isn’t room beside the last cut. Try turning the job, or start a new sheet.', true); return; }
      S.placeMode = 'bed'; S.at = ok; save(); rebuild(); msg('Moved next to the last cut.');
    });
    on('lwCutDone', 'click', () => markCut());
    on('lwPrev', 'click', () => { if (sim && tPlay >= sim.total) tPlay = 0; play(true); });
    on('lwFrameScr', 'click', () => showFrame());
    on('lwSave', 'click', () => { const x = exportLaserSVG(doc, { start: placement(box, jobAt()).toDoc(startPt()) }); saveFile((ed.doc.name || 'drawing').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + (nS > 1 ? `-sheet${sheet + 1}` : '') + '-laser.svg', x.svg); });
  }
  function markCut() {
    const ps = jobParts().map(q => thin(q, 0.5)); if (!ps.length || !sim) return;
    const first = sim.steps.find(x => x.k !== 'travel') as any, start = first ? (first.k === 'line' ? first.pts[0] : P(first.rings[0][0].x, first.y0)) : jobAt();
    S.traces.push({ when: new Date().toISOString(), name: ed.doc.name || 'job', parts: ps, box: jobBox(), start, end: sim.end });
    if (S.traces.length > 30) S.traces.shift();
    S.showTraces = true; save(); rebuild(); msg('Marked as cut. The grey shadow shows what’s gone; the flag is where the laser started and the red ring where it finished.');
  }
  const msg = (t: string, bad = false) => { const el = $('#lwMsg'); el.textContent = t; el.classList.toggle('bad', bad); };

  // ---------- setting up: the bed picture turned round by the flips, and a frame test on it ----------
  function playSetup() {
    const t0 = performance.now(); setupAnim = 0;
    const step = (now: number) => { if (!root.isConnected) return; setupAnim = (now - t0) / 3000; draw(); if (setupAnim < 1.2) requestAnimationFrame(step); else { setupAnim = null; draw(); } };
    requestAnimationFrame(step);
  }
  const flipPt = (p: Point) => P(S.machine.flipLR ? S.machine.bedW - p.x : p.x, S.machine.flipFB ? S.machine.bedH - p.y : p.y);
  $('#lwArrFB').onclick = () => { S.machine.flipFB = !S.machine.flipFB; save(); renderSteps(); playSetup(); };
  $('#lwArrLR').onclick = () => { S.machine.flipLR = !S.machine.flipLR; save(); renderSteps(); playSetup(); };

  // ---------- the bed ----------
  let view = { s: 1, ox: 0, oy: 0 };
  function fitView() {
    const wrap = canvas.parentElement!, dpr = window.devicePixelRatio || 1, W = wrap.clientWidth, H = wrap.clientHeight;
    canvas.width = Math.max(10, W * dpr); canvas.height = Math.max(10, H * dpr); canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const m = S.machine, padL = 56, padT = 44, padR = 40, padB = 44;
    const s = Math.min((W - padL - padR) / m.bedW, (H - padT - padB) / m.bedH);
    view = { s, ox: padL + ((W - padL - padR) - m.bedW * s) / 2, oy: padT + ((H - padT - padB) - m.bedH * s) / 2 };
  }
  const toScr = (p: Point) => P(view.ox + p.x * view.s, view.oy + p.y * view.s);
  const toBedPt = (sx: number, sy: number) => P((sx - view.ox) / view.s, (sy - view.oy) / view.s);

  function draw() {
    if (!root.isConnected) return;
    fitView();
    const dpr = window.devicePixelRatio || 1, cs = getComputedStyle(document.documentElement), m = S.machine, s = view.s;
    const col = (v: string, d: string) => (cs.getPropertyValue(v) || d).trim();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    const a = toScr(P(0, 0)), bw = m.bedW * s, bh = m.bedH * s, setup = !m.setUp;
    // back and sides bands (while setting up, the flips turn the picture round), the bed, the grid
    ctx.fillStyle = '#F7C6D6'; const band = 12, backAtFront = setup && m.flipFB;
    if (backAtFront) { ctx.fillRect(a.x - band, a.y, band, bh + band); ctx.fillRect(a.x + bw, a.y, band, bh + band); ctx.fillRect(a.x, a.y + bh, bw, band); }
    else { ctx.fillRect(a.x - band, a.y - band, band, bh + band); ctx.fillRect(a.x + bw, a.y - band, band, bh + band); ctx.fillRect(a.x, a.y - band, bw, band); }
    ctx.fillStyle = col('--sheet', '#fff'); ctx.fillRect(a.x, a.y, bw, bh);
    ctx.lineWidth = 1;
    for (let x = 0; x <= m.bedW + 1e-6; x += 10) { ctx.strokeStyle = x % 50 ? col('--grid', '#e5e5e5') : col('--grid-major', '#ccc'); ctx.beginPath(); ctx.moveTo(a.x + x * s, a.y); ctx.lineTo(a.x + x * s, a.y + bh); ctx.stroke(); }
    for (let y = 0; y <= m.bedH + 1e-6; y += 10) { ctx.strokeStyle = y % 50 ? col('--grid', '#e5e5e5') : col('--grid-major', '#ccc'); ctx.beginPath(); ctx.moveTo(a.x, a.y + y * s); ctx.lineTo(a.x + bw, a.y + y * s); ctx.stroke(); }
    ctx.strokeStyle = col('--fg', '#222'); ctx.strokeRect(a.x, a.y, bw, bh);
    ctx.fillStyle = col('--muted', '#666'); ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
    for (let x = 0; x <= m.bedW; x += 100) ctx.fillText(String(x), a.x + x * s, a.y - band - 4);
    ctx.textAlign = 'right'; for (let y = 0; y <= m.bedH; y += 100) ctx.fillText(String(y), a.x - band - 4, a.y + y * s + 4);
    ctx.textAlign = 'center'; ctx.font = '600 11px system-ui, sans-serif';
    if (backAtFront) { ctx.fillText('FRONT · you stand here', a.x + bw / 2, a.y - band - 18); ctx.fillText('BACK', a.x + bw / 2, a.y + bh + 26); }
    else { ctx.fillText('BACK', a.x + bw / 2, a.y - band - 18); ctx.fillText('FRONT · you stand here', a.x + bw / 2, a.y + bh + 22); }
    const lr = setup && m.flipLR ? ['RIGHT', 'LEFT'] : ['LEFT', 'RIGHT'];
    ctx.save(); ctx.translate(a.x - band - 34, a.y + bh / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(lr[0], 0, 0); ctx.restore();
    ctx.save(); ctx.translate(a.x + bw + band + 18, a.y + bh / 2); ctx.rotate(Math.PI / 2); ctx.fillText(lr[1], 0, 0); ctx.restore();
    // flip arrows on the bands (only while setting up)
    const arrFB = $<HTMLButtonElement>('#lwArrFB'), arrLR = $<HTMLButtonElement>('#lwArrLR'); arrFB.hidden = arrLR.hidden = !setup;
    if (setup) { arrFB.style.left = `${a.x + bw * 0.75}px`; arrFB.style.top = `${backAtFront ? a.y + bh + band / 2 : a.y - band / 2}px`; arrLR.style.left = `${a.x + bw + band / 2}px`; arrLR.style.top = `${a.y + bh * 0.25}px`; }
    // parking corner
    const hm = toScr(setup ? flipPt(cornerPt(m)) : cornerPt(m)); ctx.fillStyle = '#1a7f37'; ctx.beginPath(); ctx.arc(hm.x, hm.y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.font = '10.5px system-ui, sans-serif'; ctx.textAlign = hm.x > a.x + bw / 2 ? 'right' : 'left'; ctx.fillText('parks here', hm.x + (hm.x > a.x + bw / 2 ? -8 : 8), hm.y + (hm.y > a.y + bh / 2 ? -8 : 14));
    if (setup) { drawSetup(); return; }
    // what's already been cut on this sheet: grey shadows, and where the last job started and finished
    if (S.showTraces && S.traces.length) {
      S.traces.forEach((t, i) => {
        const lastOne = i === S.traces.length - 1;
        ctx.beginPath(); for (const q of t.parts) q.forEach((p, j) => { const v = toScr(p); j ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y); });
        ctx.fillStyle = lastOne ? 'rgba(90,104,98,.28)' : 'rgba(90,104,98,.18)'; ctx.fill('evenodd');
        ctx.strokeStyle = 'rgba(90,104,98,.7)'; ctx.lineWidth = 1; ctx.stroke();
        if (lastOne) {
          const f = toScr(t.start); ctx.fillStyle = '#2b5f8a'; ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x, f.y - 16); ctx.lineTo(f.x + 11, f.y - 12); ctx.lineTo(f.x, f.y - 8); ctx.fill();
          ctx.font = '600 10.5px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('started', f.x + 13, f.y + 12);
          if (t.end) { const e = toScr(t.end); ctx.strokeStyle = '#c62828'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(e.x, e.y, 6, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1; ctx.fillStyle = '#c62828'; ctx.beginPath(); ctx.arc(e.x, e.y, 2, 0, Math.PI * 2); ctx.fill(); ctx.fillText('laser finished here', e.x + 10, e.y - 9); }
        }
      });
    }
    // the job
    const jb = jobBox(), fit = fitsBed(m, jb) || (overlap() ? 'overlap' : null), j0 = toScr(P(jb.x0, jb.y0));
    ctx.fillStyle = fit ? 'rgba(198,40,40,.06)' : 'rgba(13,107,94,.05)'; ctx.fillRect(j0.x, j0.y, (jb.x1 - jb.x0) * s, (jb.y1 - jb.y0) * s);
    ctx.setLineDash([4, 3]); ctx.strokeStyle = fit ? '#c62828' : col('--accent', '#0d6b5e'); ctx.strokeRect(j0.x, j0.y, (jb.x1 - jb.x0) * s, (jb.y1 - jb.y0) * s); ctx.setLineDash([]);
    const done = sim && (playing || tPlay > 0) ? tPlay : -1;
    if (sim) {
      for (const st of sim.steps) drawStep(st, done < 0 ? 'idle' : st.t0 + st.dur <= done ? 'done' : st.t0 >= done ? 'todo' : 'now', done);
      if (done >= 0) { const h = headAt(done); ctx.fillStyle = '#c62828'; ctx.beginPath(); ctx.arc(h.x, h.y, 4.5, 0, Math.PI * 2); ctx.fill(); }
    }
    if (S.placeMode === 'head') { const h = toScr(S.head); ctx.strokeStyle = '#c62828'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(h.x - 9, h.y); ctx.lineTo(h.x + 9, h.y); ctx.moveTo(h.x, h.y - 9); ctx.lineTo(h.x, h.y + 9); ctx.stroke(); ctx.lineWidth = 1; }
    if (ruler) {
      const r = toScr(ruler), c = toScr(P(jb.x0, jb.y0)); ctx.strokeStyle = '#7B2CBF'; ctx.fillStyle = '#7B2CBF'; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(c.x, r.y); ctx.lineTo(c.x, c.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(r.x, r.y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`${r1(Math.abs(jb.x0 - ruler.x))} mm`, (r.x + c.x) / 2, r.y - 6);
      ctx.textAlign = 'left'; ctx.fillText(`${r1(Math.abs(jb.y0 - ruler.y))} mm`, c.x + 6, (r.y + c.y) / 2);
    }
    // parts left out of this cut (faint), picked parts (outlined), a part being dragged, the box being dragged out
    ctx.lineWidth = 1;
    for (const q of parts) {
      const out = q.ids.every(id => left.has(id)), picked = !out && q.ids.some(id => sel.has(id)); if (!out && !picked) continue;
      const d = picked && selDrag ? selDrag : P(0, 0);
      ctx.beginPath(); for (const r of q.polys) r.forEach((p, i) => { const v = toScr(P(p.x + d.x, p.y + d.y)); i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y); });
      if (out) { ctx.setLineDash([3, 3]); ctx.strokeStyle = '#9aa5a0'; ctx.stroke(); ctx.setLineDash([]); }
      else { ctx.fillStyle = 'rgba(13,107,94,.12)'; ctx.fill('evenodd'); ctx.strokeStyle = col('--accent', '#0d6b5e'); ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1; }
    }
    const pb = pickedBox();
    if (pb) { const d = selDrag || P(0, 0), u = toScr(P(pb.x0 + d.x, pb.y0 + d.y)); ctx.setLineDash([5, 3]); ctx.strokeStyle = col('--accent', '#0d6b5e'); ctx.strokeRect(u.x - 3, u.y - 3, (pb.x1 - pb.x0) * s + 6, (pb.y1 - pb.y0) * s + 6); ctx.setLineDash([]); }
    if (boxSel) { const u = toScr(boxSel.a), v = toScr(boxSel.b); ctx.setLineDash([4, 3]); ctx.strokeStyle = '#2b5f8a'; ctx.fillStyle = 'rgba(43,95,138,.08)'; ctx.fillRect(Math.min(u.x, v.x), Math.min(u.y, v.y), Math.abs(v.x - u.x), Math.abs(v.y - u.y)); ctx.strokeRect(Math.min(u.x, v.x), Math.min(u.y, v.y), Math.abs(v.x - u.x), Math.abs(v.y - u.y)); ctx.setLineDash([]); }
    if (frameAnim != null) drawFrameAnim(frameAnim);
  }
  /** while setting up: a sample job in the middle, and (when playing) the head going from its corner round it */
  function drawSetup() {
    const m = S.machine, jb = { x0: m.bedW * 0.35, y0: m.bedH * 0.3, x1: m.bedW * 0.65, y1: m.bedH * 0.65 };
    const u = toScr(P(jb.x0, jb.y0)), v = toScr(P(jb.x1, jb.y1));
    ctx.strokeStyle = '#999'; ctx.setLineDash([4, 4]); ctx.strokeRect(u.x, u.y, v.x - u.x, v.y - u.y); ctx.setLineDash([]);
    ctx.fillStyle = '#5a6862'; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('a job', (u.x + v.x) / 2, (u.y + v.y) / 2 + 4);
    if (setupAnim == null) return;
    // the route in the machine's own terms, shown through the flips
    const route = [cornerPt(m), P(jb.x0, jb.y0), P(jb.x1, jb.y0), P(jb.x1, jb.y1), P(jb.x0, jb.y1), P(jb.x0, jb.y0)].map(p => toScr(flipPt(p)));
    const lens = route.slice(1).map((p, i) => Math.hypot(p.x - route[i].x, p.y - route[i].y)), L = lens.reduce((x, y) => x + y, 0);
    let rest = Math.min(1, setupAnim) * L, head = route[0];
    ctx.strokeStyle = '#0d6b5e'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(route[0].x, route[0].y);
    for (let i = 0; i < lens.length && rest > 0; i++) { const f = Math.min(1, rest / lens[i]); head = P(route[i].x + (route[i + 1].x - route[i].x) * f, route[i].y + (route[i + 1].y - route[i].y) * f); ctx.lineTo(head.x, head.y); rest -= lens[i]; }
    ctx.stroke(); ctx.lineWidth = 1; ctx.fillStyle = '#c62828'; ctx.beginPath(); ctx.arc(head.x, head.y, 6, 0, Math.PI * 2); ctx.fill();
  }
  function strokeColour(st: Step) { return st.k === 'travel' ? '#c62828' : hexOf(st.key); }
  function drawStep(st: Step, state: 'idle' | 'done' | 'now' | 'todo', t: number) {
    if (st.k === 'travel' && (!showTravel || state === 'idle' || state === 'todo')) return;
    ctx.globalAlpha = state === 'todo' ? 0.25 : 1; ctx.strokeStyle = strokeColour(st); ctx.lineWidth = state === 'idle' ? 1.1 : 1.6;
    if (st.k === 'travel') ctx.setLineDash([4, 4]);
    const frac = state === 'now' ? Math.max(0, Math.min(1, (t - st.t0) / st.dur)) : 1;
    if (st.k === 'area') {
      ctx.save();
      if (frac < 1) { const yCut = toScr(P(0, st.y0 + (st.y1 - st.y0) * frac)).y; ctx.beginPath(); ctx.rect(0, 0, canvas.width, yCut); ctx.clip(); }
      ctx.beginPath(); for (const r of st.rings) r.forEach((p, i) => { const q = toScr(p); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); ctx.closePath();
      ctx.fillStyle = hexOf(st.key); ctx.globalAlpha *= 0.55; ctx.fill('evenodd'); ctx.restore(); ctx.globalAlpha = 1; return;
    }
    ctx.beginPath(); let left = frac * st.len;
    st.pts.forEach((p, i) => { const q = toScr(p); if (!i) { ctx.moveTo(q.x, q.y); return; } const prev = st.pts[i - 1], d = Math.hypot(p.x - prev.x, p.y - prev.y);
      if (left <= 0) return; if (d <= left || frac >= 1) ctx.lineTo(q.x, q.y); else { const f = left / d, pq = toScr(P(prev.x + (p.x - prev.x) * f, prev.y + (p.y - prev.y) * f)); ctx.lineTo(pq.x, pq.y); } left -= d; });
    ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.lineWidth = 1;
  }
  function headAt(t: number): Point {
    if (!sim || !sim.steps.length) return toScr(startPt());
    const st = sim.steps.find(x => t >= x.t0 && t <= x.t0 + x.dur) || (t <= 0 ? null : sim.steps[sim.steps.length - 1]);
    if (!st) return toScr(sim.start);
    const f = Math.max(0, Math.min(1, (t - st.t0) / st.dur));
    if (st.k === 'area') { const y = st.y0 + (st.y1 - st.y0) * f, xs = st.rings.flat().map(p => p.x); return toScr(P(Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * ((Math.floor(f * st.rows) % 2) ? 1 - (f * st.rows % 1) : f * st.rows % 1), y)); }
    let left = f * st.len; for (let i = 1; i < st.pts.length; i++) { const a = st.pts[i - 1], b = st.pts[i], d = Math.hypot(b.x - a.x, b.y - a.y); if (d >= left) { const g = d ? left / d : 0; return toScr(P(a.x + (b.x - a.x) * g, a.y + (b.y - a.y) * g)); } left -= d; }
    return toScr(st.pts[st.pts.length - 1]);
  }

  // ---------- frame on screen ----------
  function showFrame() {
    const jb = jobBox(), fit = fitsBed(S.machine, jb);
    if (fit) { msg('⚠ ' + fit + ' The laser would not frame this. Move the job first.', true); return; }
    msg('The head would go from where it is to the job, then round it once with the laser off.');
    const t0 = performance.now(); stopPlay();
    const step = (now: number) => { if (!root.isConnected) return; frameAnim = (now - t0) / 3000; draw(); if (frameAnim < 1.15) requestAnimationFrame(step); else { frameAnim = null; draw(); } };
    requestAnimationFrame(step);
  }
  function drawFrameAnim(t: number) {
    const jb = jobBox(), route = [startPt(), P(jb.x0, jb.y0), P(jb.x1, jb.y0), P(jb.x1, jb.y1), P(jb.x0, jb.y1), P(jb.x0, jb.y0)].map(toScr);
    const lens = route.slice(1).map((p, i) => Math.hypot(p.x - route[i].x, p.y - route[i].y)), L = lens.reduce((x, y) => x + y, 0);
    let left = Math.min(1, t) * L, head = route[0];
    ctx.strokeStyle = '#0d6b5e'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(route[0].x, route[0].y);
    for (let i = 0; i < lens.length && left > 0; i++) { const f = Math.min(1, left / lens[i]); head = P(route[i].x + (route[i + 1].x - route[i].x) * f, route[i].y + (route[i + 1].y - route[i].y) * f); ctx.lineTo(head.x, head.y); left -= lens[i]; }
    ctx.stroke(); ctx.lineWidth = 1; ctx.fillStyle = '#c62828'; ctx.beginPath(); ctx.arc(head.x, head.y, 5, 0, Math.PI * 2); ctx.fill();
  }

  // ---------- player ----------
  let raf = 0, last = 0;
  function play(go: boolean) {
    playing = go && !!sim && sim.total > 0; $('#lwPlay').textContent = playing ? '❚❚ Pause' : '▶ Play';
    cancelAnimationFrame(raf); if (!playing) return; last = performance.now();
    const tick = (now: number) => { if (!root.isConnected || !playing || !sim) return; tPlay = Math.min(sim.total, tPlay + (now - last) / 1000 * speed); last = now; updatePlayer(); draw(); if (tPlay >= sim.total) { play(false); msg('Finished. When the real laser has cut it, press ✓ Mark this job as cut to leave its shadow.'); } else raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
  }
  const stopPlay = () => play(false);
  function updatePlayer() { const T = sim?.total || 0; $<HTMLInputElement>('#lwScrub').value = String(T ? Math.round(tPlay / T * 1000) : 0); $('#lwClock').textContent = `${clock(tPlay)} / ${clock(T)}`; }
  $('#lwPlay').onclick = () => { if (sim && tPlay >= sim.total) tPlay = 0; play(!playing); };
  $<HTMLInputElement>('#lwScrub').oninput = e => { stopPlay(); tPlay = (sim?.total || 0) * +(e.target as HTMLInputElement).value / 1000; updatePlayer(); draw(); };
  root.querySelectorAll<HTMLElement>('#lwSpeed button').forEach(b => b.onclick = () => { speed = +b.dataset.v!; root.querySelectorAll('#lwSpeed button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
  $<HTMLInputElement>('#lwTravel').onchange = e => { showTravel = (e.target as HTMLInputElement).checked; draw(); };

  // ---------- on the bed: pick parts, drag them or the whole job (or the head), box-pick, the ruler, setting up ----------
  let drag: { kind: 'job' | 'head' | 'parts' | 'box'; from: Point; at0: Point } | null = null;
  const bedPt = (ev: PointerEvent) => { const r = canvas.getBoundingClientRect(); return toBedPt(ev.clientX - r.left, ev.clientY - r.top); };
  const inJob = (p: Point) => { const jb = jobBox(); return p.x >= jb.x0 && p.x <= jb.x1 && p.y >= jb.y0 && p.y <= jb.y1; };
  const allPicked = () => { const live = parts.filter(q => !q.ids.every(id => left.has(id))); return live.length > 0 && live.every(q => q.ids.some(id => sel.has(id))); };
  canvas.addEventListener('pointerdown', ev => {
    const p = bedPt(ev), m = S.machine;
    if (!m.setUp) {   // setting up: click a corner of the bed for where the head parks
      const q = flipPt(p); let c: Corner = `${q.y < m.bedH / 2 ? 'back' : 'front'}-${q.x < m.bedW / 2 ? 'left' : 'right'}` as Corner; m.park = c; save(); draw(); return;
    }
    if (rulerOn) { ruler = P(Math.round(p.x * 2) / 2, Math.round(p.y * 2) / 2); rulerOn = false; msg(''); renderSteps(); draw(); return; }
    const hit = partAt(p);
    if (hit) {
      const isPicked = hit.ids.some(id => sel.has(id));
      if (ev.shiftKey) { hit.ids.forEach(id => isPicked ? sel.delete(id) : sel.add(id)); renderSteps(); return; }
      if (!isPicked) { sel.clear(); hit.ids.forEach(id => sel.add(id)); renderSteps(); }
      // all of it picked (or just one part): drag the whole job; otherwise drag the picked parts
      drag = allPicked() || parts.length === 1 ? (S.placeMode === 'bed' ? { kind: 'job', from: p, at0: S.at } : { kind: 'head', from: p, at0: S.head }) : { kind: 'parts', from: p, at0: P(0, 0) };
    } else if (inJob(p)) { sel.clear(); drag = S.placeMode === 'bed' ? { kind: 'job', from: p, at0: S.at } : { kind: 'head', from: p, at0: S.head }; renderSteps(); }
    else if (S.placeMode === 'head' && Math.hypot(p.x - S.head.x, p.y - S.head.y) < 12 / view.s) drag = { kind: 'head', from: p, at0: S.head };
    else { drag = { kind: 'box', from: p, at0: p }; boxSel = { a: p, b: p }; }
    canvas.setPointerCapture(ev.pointerId); stopPlay(); tPlay = 0;
  });
  canvas.addEventListener('pointermove', ev => {
    const p = bedPt(ev);
    if (!drag) { canvas.style.cursor = !S.machine.setUp ? 'pointer' : rulerOn ? 'crosshair' : partAt(p) ? 'pointer' : inJob(p) ? 'grab' : 'crosshair'; return; }
    const d = P(Math.round((p.x - drag.from.x) * 2) / 2, Math.round((p.y - drag.from.y) * 2) / 2);
    if (drag.kind === 'job') S.at = P(drag.at0.x + d.x, drag.at0.y + d.y);
    else if (drag.kind === 'head') S.head = P(drag.at0.x + d.x, drag.at0.y + d.y);
    else if (drag.kind === 'parts') selDrag = d;
    else boxSel = { a: drag.from, b: p };
    draw();
  });
  canvas.addEventListener('pointerup', () => {
    if (!drag) return; const k = drag.kind; drag = null;
    if (k === 'parts') { const d = selDrag; selDrag = null; if (d && (d.x || d.y)) movePicked(d); else draw(); return; }
    if (k === 'box' && boxSel) {
      const x0 = Math.min(boxSel.a.x, boxSel.b.x), x1 = Math.max(boxSel.a.x, boxSel.b.x), y0 = Math.min(boxSel.a.y, boxSel.b.y), y1 = Math.max(boxSel.a.y, boxSel.b.y); boxSel = null;
      sel.clear();
      if ((x1 - x0) * view.s > 4 || (y1 - y0) * view.s > 4)   // a box touching a part picks it
        for (const q of parts) if (!q.ids.every(id => left.has(id)) && q.box.x1 >= x0 && q.box.x0 <= x1 && q.box.y1 >= y0 && q.box.y0 <= y1) q.ids.forEach(id => sel.add(id));
      renderSteps(); return;
    }
    save(); rebuild();
  });

  // ---------- open / close ----------
  const close = () => { cancelAnimationFrame(raf); playing = false; root.remove(); window.removeEventListener('resize', onResize); window.removeEventListener('keydown', onKey, true); };
  const onResize = () => draw();
  const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { if (rulerOn) { rulerOn = false; renderSteps(); draw(); } else if (sel.size) { sel.clear(); renderSteps(); } else close(); ev.stopPropagation(); } else if (ev.key === ' ' && !(ev.target as HTMLElement).matches('input,select,textarea,button')) { ev.preventDefault(); $('#lwPlay').click(); } };
  $('#lwClose').onclick = close;
  $<HTMLInputElement>('#lwHelp').onchange = e => { S.help = (e.target as HTMLInputElement).checked; save(); renderSteps(); };
  window.addEventListener('resize', onResize); window.addEventListener('keydown', onKey, true);
  loadJob();
  if (!paths.length) msg('Nothing on this sheet is set to cut or engrave yet.', true);
  requestAnimationFrame(() => draw());
  return { close };
}
