/**
 * Laser workspace (first version, nothing talks to the machine yet).
 * A column of numbered steps you work down every time you cut, beside a picture of the bed
 * drawn as you stand at the front of the laser:
 *   1 Your laser (set up once, then folded)   2 Settings   3 Place it on the bed   4 Check it   5 Send
 */
import type { Editor } from '../editor/editor';
import { P, type Point } from '../geometry/vec';
import { COLORS, type Doc, type ColorKey } from '../model/types';
import { sheetDoc } from '../io/sheets';
import { cutOrder, type LPath, type Phase, PHASES } from '../laser/order';
import { exportLaserSVG } from '../laser/export';
import { simulate, placement, fmtTime, clock, DEFAULT_MOTION, type Sim, type Step } from '../laser/sim';
import { loadState, saveState, cornerPt, fitsBed, MATERIALS, type LaserState, type Corner, type Material } from '../laser/machine';

const PH_LABEL: Record<Phase, string> = { engrave: 'Engrave area', score: 'Engrave line', cut: 'Cut' };
const PH_HELP: Record<Phase, string> = {
  engrave: 'Fills the inside of a shape by sweeping back and forth (like a printer).',
  score: 'Marks the line on the surface without cutting through.',
  cut: 'Cuts right through the material.',
};
const CORNER_LABEL: Record<Corner, string> = { 'back-left': 'back-left', 'back-right': 'back-right', 'front-left': 'front-left', 'front-right': 'front-right' };
const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);
const r1 = (v: number) => (Math.round(v * 10) / 10).toString();
const hexOf = (k: string) => k === 'paint' ? '#E58FB0' : (COLORS[k as ColorKey]?.hex || '#000');

export function openLaser(ed: Editor, saveFile: (name: string, text: string) => void) {
  document.getElementById('laserWs')?.remove();
  const S: LaserState = loadState();
  const nS = Math.max(1, ed.doc.sheets || 1); let sheet = 0;
  let doc: Doc, paths: LPath[] = [], box = { x0: 0, y0: 0, x1: 0, y1: 0 }, sim: Sim | null = null;
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
        <div class="lw-bedwrap"><canvas id="lwBed" aria-label="The laser bed, as you stand at the front"></canvas></div>
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
  function loadJob() {
    doc = nS > 1 ? sheetDoc(ed.doc, sheet) : ed.doc;
    const start0 = P(0, doc.page.h);
    paths = cutOrder(doc, { start: start0 }).paths;
    const pts = paths.flatMap(p => p.pts);
    box = pts.length ? pts.reduce((b, p) => ({ x0: Math.min(b.x0, p.x), y0: Math.min(b.y0, p.y), x1: Math.max(b.x1, p.x), y1: Math.max(b.y1, p.y) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }) : { x0: 0, y0: 0, x1: 0, y1: 0 };
    rebuild();
  }
  const jobW = () => box.x1 - box.x0, jobH = () => box.y1 - box.y0;
  /** where the job's top-left goes on the bed */
  const jobAt = (): Point => S.placeMode === 'bed' ? S.at : S.anchor === 'centre' ? P(S.head.x - jobW() / 2, S.head.y - jobH() / 2) : S.head;
  const startPt = (): Point => S.placeMode === 'bed' ? cornerPt(S.machine) : S.head;
  const jobBox = () => { const a = jobAt(); return { x0: a.x, y0: a.y, x1: a.x + jobW(), y1: a.y + jobH() }; };
  function rebuild() {
    const pl = placement(box, jobAt());
    // order again from where the head really starts, then simulate
    const st = pl.toDoc(startPt()); paths = cutOrder(doc, { start: st }).paths;
    sim = simulate(paths, pl.toBed, S.settings, startPt(), DEFAULT_MOTION);
    tPlay = Math.min(tPlay, sim.total); msg('');
    renderSteps(); draw(); updatePlayer();
  }
  const present = () => new Set(paths.map(p => p.phase));

  // ---------- steps ----------
  function stepHtml(n: number, title: string, open: boolean, summary: string, body: string, id: string) {
    return `<section class="lw-step${open ? ' open' : ''}" id="${id}"><div class="lw-sh"><span class="lw-n">${n}</span><b>${title}</b>${!open && summary ? `<span class="lw-sum">${summary}</span>` : ''}</div>${open ? `<div class="lw-sb">${body}</div>` : ''}</section>`;
  }
  const help = (t: string) => S.help ? `<p class="lw-help">${t}</p>` : '';
  function renderSteps() {
    const m = S.machine, has = present(), fit = fitsBed(m, jobBox()), est = sim;
    $('#lwSheet').innerHTML = nS > 1 ? `Sheet <span class="segc" id="lwSh">${Array.from({ length: nS }, (_, i) => `<button type="button" data-v="${i}" aria-pressed="${i === sheet}">${i + 1}</button>`).join('')}</span>` : esc(ed.doc.name || '');
    const s1 = stepHtml(1, 'Your laser', !m.setUp, `✓ ${esc(m.name)} · ${m.bedW} × ${m.bedH} mm <button type="button" class="lw-link" id="lwChange">Change</button>`, `
      ${help('Do this once. Stand at the <b>front</b> of the laser. In the picture, the shaded bands are the <b>back</b> and the <b>sides</b>; you stand at the open edge.')}
      <div class="lw-row"><label>Name <input type="text" id="lwName" value="${esc(m.name)}"></label></div>
      <div class="lw-row"><label>Bed width <input type="text" inputmode="decimal" id="lwBW" value="${m.bedW}"> mm</label><label>depth <input type="text" inputmode="decimal" id="lwBH" value="${m.bedH}"> mm</label></div>
      <canvas id="lwOri" width="300" height="200" aria-label="The laser seen from the front"></canvas>
      ${help('Click the <b>corner the head goes to</b> when you switch the laser on (the green dot). Then press <b>Show how it should frame</b> and compare with the real laser’s Frame. If the real head went the other way, press a <b>Flip</b> until the picture matches.')}
      <div class="lw-row wrap"><button type="button" class="btn" id="lwOriPlay">▶ Show how it should frame</button><button type="button" class="btn" id="lwFlipLR" aria-pressed="${m.flipLR}">Flip left ↔ right</button><button type="button" class="btn" id="lwFlipFB" aria-pressed="${m.flipFB}">Flip front ↕ back</button></div>
      <button type="button" class="btn primary" id="lwSetUp">Done: my laser is set up</button>`, 'lwS1');
    const rows = PHASES.filter(ph => has.has(ph)).map(ph => { const st = S.settings[ph]; const cols = [...new Set(paths.filter(p => p.phase === ph).map(p => p.key))];
      return `<div class="lw-op${st.on ? '' : ' off'}" data-ph="${ph}">
        <div class="lw-oph">${cols.map(k => `<span class="sw" style="background:${hexOf(String(k))}"></span>`).join('')}<b>${PH_LABEL[ph]}</b><label class="tog" title="Switch this off to skip it"><input type="checkbox" role="switch" data-f="on" ${st.on ? 'checked' : ''} aria-label="${PH_LABEL[ph]}: do this"> ${st.on ? 'On' : 'Off'}</label></div>
        ${S.help ? `<div class="lw-help small">${PH_HELP[ph]}</div>` : ''}
        <div class="lw-opf"><label>Speed <input type="text" inputmode="decimal" data-f="speed" value="${st.speed}"> <small>mm/s</small></label><label>Power <input type="text" inputmode="decimal" data-f="power" value="${st.power}"> <small>%</small></label><label>Passes <input type="text" inputmode="numeric" data-f="passes" value="${st.passes}"></label><label class="tog"><input type="checkbox" role="switch" data-f="air" ${st.air ? 'checked' : ''}> Air</label></div>
      </div>`; }).join('');
    const s2 = stepHtml(2, 'Material and settings', true, '', `
      <label class="lw-row">Material <select id="lwMat">${(Object.keys(MATERIALS) as Material[]).map(k => `<option value="${k}" ${k === S.material ? 'selected' : ''}>${MATERIALS[k].label}</option>`).join('')}</select></label>
      ${rows || '<p class="bad">Nothing on this sheet is set to cut or engrave.</p>'}
      ${has.size ? `<p class="lw-read small">The laser does them in this order: ${PHASES.filter(ph => has.has(ph)).map(ph => PH_LABEL[ph].toLowerCase()).join(' → ')}.</p>` : ''}
      ${help('<b>Speed</b>: how fast the head moves (slower cuts deeper). <b>Power</b>: how strong the laser is. <b>Passes</b>: how many times it goes round. <b>Air</b>: blows away smoke and flames. The material settings are <b>examples only</b>: always test on a scrap first and change them to what works on your laser.')}`, 'lwS2');
    const placeBody = `
      <div class="lw-cards" role="radiogroup">
        <button type="button" role="radio" data-pm="bed" aria-checked="${S.placeMode === 'bed'}"><b>Where it is on the bed</b><span>The picture is where it cuts. Drag the job, or type how far from the back-left corner.</span></button>
        <button type="button" role="radio" data-pm="head" aria-checked="${S.placeMode === 'head'}"><b>Start where the laser head is</b><span>Move the head over your material; the job sits under it.</span></button>
      </div>
      ${S.placeMode === 'bed' ? `
        <div class="lw-row"><label>From the left <input type="text" inputmode="decimal" id="lwX" value="${r1(S.at.x)}"> mm</label><label>From the back <input type="text" inputmode="decimal" id="lwY" value="${r1(S.at.y)}"> mm</label></div>
        <div class="lw-row wrap"><button type="button" class="btn" id="lwCornerBL">Back-left corner</button><button type="button" class="btn" id="lwMid">Middle of the bed</button></div>` : `
        <div class="lw-row"><label>Head from the left <input type="text" inputmode="decimal" id="lwHX" value="${r1(S.head.x)}"> mm</label><label>from the back <input type="text" inputmode="decimal" id="lwHY" value="${r1(S.head.y)}"> mm</label></div>
        <div class="lw-row">The head is at the job’s <div class="segc" id="lwAnchor"><button type="button" data-v="top-left" aria-pressed="${S.anchor === 'top-left'}">top-left corner</button><button type="button" data-v="centre" aria-pressed="${S.anchor === 'centre'}">middle</button></div></div>
        ${help('Until Kerf is connected to the laser, type where you moved the head to (or drag the cross on the bed). The job moves with the head, so what you see is what Frame will trace.')}`}
      <div class="lw-row wrap"><button type="button" class="btn${rulerOn ? ' on' : ''}" id="lwRuler" aria-pressed="${rulerOn}">📏 Ruler</button>${ruler ? `<button type="button" class="lw-link" id="lwRulerClear">Clear ruler</button>` : ''}</div>
      ${ruler ? `<p class="lw-read">From the ruler point, the job starts <b>${r1(jobBox().x0 - ruler.x)} mm</b> ${jobBox().x0 >= ruler.x ? 'to the right' : 'to the left'} and <b>${r1(jobBox().y0 - ruler.y)} mm</b> ${jobBox().y0 >= ruler.y ? 'towards the front' : 'towards the back'}.</p>` : help('<b>Ruler</b>: click the bed to put a reference point (e.g. the corner of your acrylic). Kerf shows how far the job is from it.')}
      <p class="lw-read">Job size: <b>${r1(jobW())} × ${r1(jobH())} mm</b></p>
      ${fit ? `<p class="bad">⚠ ${fit} Move the job so it fits on the bed.</p>` : `<p class="ok">✓ Fits on the bed.</p>`}`;
    const s3 = stepHtml(3, 'Place it on the bed', true, '', placeBody, 'lwS3');
    const s4 = stepHtml(4, 'Check it', true, '', est ? `
      <p class="lw-big">About <b>${fmtTime(est.total)}</b></p>
      <p class="lw-read">Cutting and marking ${r1(est.cutLen / 1000)} m${est.engraveTime ? ` · engraving ${fmtTime(est.engraveTime)}` : ''} · moves with the laser off ${r1(est.travelLen / 1000)} m</p>
      <div class="lw-row wrap"><button type="button" class="btn primary" id="lwPrev">▶ Preview the job</button><button type="button" class="btn" id="lwFrameScr">Show the frame</button><button type="button" class="btn" disabled title="Comes when Kerf is connected to the laser">Frame on the laser</button></div>
      ${help('<b>Preview</b> plays the job in the order the laser will follow (holes before outlines; red dashes are moves with the laser off). <b>Show the frame</b> draws the box the head will trace around the job. The time is an estimate; it gets closer once we read your laser’s own settings.')}` : '', 'lwS4');
    const s5 = stepHtml(5, 'Send', true, '', `
      <div class="lw-row wrap"><button type="button" class="btn primary" id="lwSave">Save file for LightBurn</button><button type="button" class="btn" disabled>Send to the laser</button></div>
      ${help('For now, save the file and open it in LightBurn (<b>File → Import</b>; in Optimization Settings switch optimisation off to keep this order). Sending straight to the laser comes when we connect Kerf to it, with a check before anything moves.')}`, 'lwS5');
    $('#lwSteps').innerHTML = s1 + s2 + s3 + s4 + s5;
    bindSteps(); drawOri();
  }

  function num(v: string, lo: number, hi: number): number | null { const n = parseFloat(v.replace(',', '.')); return isFinite(n) && n >= lo && n <= hi ? n : null; }
  function bindSteps() {
    const on = (id: string, ev: string, f: (e: Event) => void) => { const el = root.querySelector('#' + id); if (el) el.addEventListener(ev, f); };
    root.querySelectorAll<HTMLElement>('#lwSh button').forEach(b => b.onclick = () => { sheet = +b.dataset.v!; loadJob(); });
    on('lwChange', 'click', () => { S.machine.setUp = false; save(); renderSteps(); });
    on('lwName', 'change', e => { S.machine.name = (e.target as HTMLInputElement).value.trim() || 'My laser'; save(); });
    on('lwBW', 'change', e => { const v = num((e.target as HTMLInputElement).value, 50, 3000); if (v) { S.machine.bedW = v; save(); rebuild(); } });
    on('lwBH', 'change', e => { const v = num((e.target as HTMLInputElement).value, 50, 3000); if (v) { S.machine.bedH = v; save(); rebuild(); } });
    on('lwFlipLR', 'click', () => { S.machine.flipLR = !S.machine.flipLR; save(); renderSteps(); playOri(); });
    on('lwFlipFB', 'click', () => { S.machine.flipFB = !S.machine.flipFB; save(); renderSteps(); playOri(); });
    on('lwOriPlay', 'click', () => playOri());
    on('lwSetUp', 'click', () => { S.machine.setUp = true; save(); rebuild(); });
    const ori = root.querySelector<HTMLCanvasElement>('#lwOri');
    if (ori) ori.onclick = ev => { const r = ori.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
      let c: Corner = `${y < 0.5 ? 'back' : 'front'}-${x < 0.5 ? 'left' : 'right'}` as Corner;
      if (S.machine.flipLR) c = c.replace(/left|right/, w => w === 'left' ? 'right' : 'left') as Corner;
      if (S.machine.flipFB) c = c.replace(/back|front/, w => w === 'back' ? 'front' : 'back') as Corner;
      S.machine.park = c; save(); rebuild(); };
    on('lwMat', 'change', e => { S.material = (e.target as HTMLSelectElement).value as Material; S.settings = structuredClone(MATERIALS[S.material].s); save(); rebuild(); });
    root.querySelectorAll<HTMLInputElement>('.lw-op input').forEach(i => i.addEventListener('change', () => {
      const ph = (i.closest('.lw-op') as HTMLElement).dataset.ph as Phase, f = i.dataset.f!, st = S.settings[ph] as any;
      if (f === 'air' || f === 'on') st[f] = i.checked;
      else { const v = num(i.value, f === 'passes' ? 1 : 0.1, f === 'power' ? 100 : f === 'passes' ? 20 : 2000); if (v != null) st[f] = f === 'passes' ? Math.round(v) : v; }
      S.material = 'custom'; MATERIALS.custom.s = structuredClone(S.settings); save(); rebuild();
    }));
    root.querySelectorAll<HTMLElement>('.lw-cards button').forEach(b => b.onclick = () => { S.placeMode = b.dataset.pm as any; save(); rebuild(); });
    const setAt = (x: number | null, y: number | null) => { if (x != null) S.at = P(x, S.at.y); if (y != null) S.at = P(S.at.x, y); save(); rebuild(); };
    on('lwX', 'change', e => setAt(num((e.target as HTMLInputElement).value, -5000, 5000), null));
    on('lwY', 'change', e => setAt(null, num((e.target as HTMLInputElement).value, -5000, 5000)));
    on('lwCornerBL', 'click', () => { S.at = P(5, 5); save(); rebuild(); });
    on('lwMid', 'click', () => { S.at = P(Math.round((S.machine.bedW - jobW()) / 2), Math.round((S.machine.bedH - jobH()) / 2)); save(); rebuild(); });
    on('lwHX', 'change', e => { const v = num((e.target as HTMLInputElement).value, -5000, 5000); if (v != null) { S.head = P(v, S.head.y); save(); rebuild(); } });
    on('lwHY', 'change', e => { const v = num((e.target as HTMLInputElement).value, -5000, 5000); if (v != null) { S.head = P(S.head.x, v); save(); rebuild(); } });
    root.querySelectorAll<HTMLElement>('#lwAnchor button').forEach(b => b.onclick = () => { S.anchor = b.dataset.v as any; save(); rebuild(); });
    on('lwRuler', 'click', () => { rulerOn = !rulerOn; msg(rulerOn ? 'Click the bed to put the ruler point.' : ''); renderSteps(); draw(); });
    on('lwRulerClear', 'click', () => { ruler = null; rulerOn = false; renderSteps(); draw(); });
    on('lwPrev', 'click', () => { if (sim && tPlay >= sim.total) tPlay = 0; play(true); });
    on('lwFrameScr', 'click', () => showFrame());
    on('lwSave', 'click', () => { const x = exportLaserSVG(doc); saveFile((ed.doc.name || 'drawing').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + (nS > 1 ? `-sheet${sheet + 1}` : '') + '-laser.svg', x.svg); });
  }
  const msg = (t: string, bad = false) => { const el = $('#lwMsg'); el.textContent = t; el.classList.toggle('bad', bad); };

  // ---------- the small "your laser" picture: bands at the back and sides, a frame test ----------
  let oriT = -1;
  function drawOri() {
    const c = root.querySelector<HTMLCanvasElement>('#lwOri'); if (!c) return;
    const g = c.getContext('2d')!, W = c.width, H = c.height, m = S.machine, cs = getComputedStyle(document.documentElement);
    const band = 14, pad = 22, bx = pad, by = pad + 12, bw = W - 2 * pad, bh = H - 2 * pad - 26;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
    g.save();
    // flips turn the whole picture round
    g.translate(W / 2, (H - 14) / 2); g.scale(m.flipLR ? -1 : 1, m.flipFB ? -1 : 1); g.translate(-W / 2, -(H - 14) / 2);
    g.fillStyle = '#F7C6D6'; g.strokeStyle = '#333';
    g.fillRect(bx - band, by - band, band, bh + band); g.fillRect(bx + bw, by - band, band, bh + band); g.fillRect(bx, by - band, bw, band);
    g.fillStyle = cs.getPropertyValue('--sheet') || '#fff'; g.fillRect(bx, by, bw, bh); g.lineWidth = 1; g.strokeRect(bx, by, bw, bh);
    g.restore();
    const map = (p: Point) => { let x = bx + p.x / m.bedW * bw, y = by + p.y / m.bedH * bh; if (m.flipLR) x = W - x; if (m.flipFB) y = (H - 14) - y; return P(x, y); };
    g.fillStyle = cs.getPropertyValue('--muted') || '#666'; g.font = '11px system-ui, sans-serif'; g.textAlign = 'center';
    const top = by - band - 5, bottom = by + bh + 15;
    g.fillText('BACK', W / 2, m.flipFB ? bottom + band : top); g.fillText('FRONT · you stand here', W / 2, m.flipFB ? top : bottom + 3);
    // a sample job in the middle, and the parking corner
    const jb = { x0: m.bedW * 0.35, y0: m.bedH * 0.3, x1: m.bedW * 0.65, y1: m.bedH * 0.65 };
    const a = map(P(jb.x0, jb.y0)), b = map(P(jb.x1, jb.y1));
    g.strokeStyle = '#999'; g.setLineDash([3, 3]); g.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); g.setLineDash([]);
    const home = map(cornerPt(m));
    // frame test animation: from the parked head to the job, then round the job (back-left, back-right, front-right, front-left)
    if (oriT >= 0) {
      const route = [cornerPt(m), P(jb.x0, jb.y0), P(jb.x1, jb.y0), P(jb.x1, jb.y1), P(jb.x0, jb.y1), P(jb.x0, jb.y0)].map(map);
      const lens = route.slice(1).map((p, i) => Math.hypot(p.x - route[i].x, p.y - route[i].y)), L = lens.reduce((x, y) => x + y, 0);
      let left = Math.min(1, oriT) * L, head = route[0];
      g.strokeStyle = '#0d6b5e'; g.lineWidth = 2; g.beginPath(); g.moveTo(route[0].x, route[0].y);
      for (let i = 0; i < lens.length && left > 0; i++) { const f = Math.min(1, left / lens[i]); head = P(route[i].x + (route[i + 1].x - route[i].x) * f, route[i].y + (route[i + 1].y - route[i].y) * f); g.lineTo(head.x, head.y); left -= lens[i]; }
      g.stroke(); g.fillStyle = '#c62828'; g.beginPath(); g.arc(head.x, head.y, 4, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#1a7f37'; g.beginPath(); g.arc(home.x, home.y, 5, 0, Math.PI * 2); g.fill();
  }
  function playOri() {
    const t0 = performance.now(); oriT = 0;
    const step = (now: number) => { if (!root.isConnected) return; oriT = (now - t0) / 2500; drawOri(); if (oriT < 1.3) requestAnimationFrame(step); else { oriT = -1; drawOri(); } };
    requestAnimationFrame(step);
  }

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
    const a = toScr(P(0, 0)), bw = m.bedW * s, bh = m.bedH * s;
    // back and sides bands, the bed, the grid
    ctx.fillStyle = '#F7C6D6'; const band = 12;
    ctx.fillRect(a.x - band, a.y - band, band, bh + band); ctx.fillRect(a.x + bw, a.y - band, band, bh + band); ctx.fillRect(a.x, a.y - band, bw, band);
    ctx.fillStyle = col('--sheet', '#fff'); ctx.fillRect(a.x, a.y, bw, bh);
    ctx.lineWidth = 1;
    for (let x = 0; x <= m.bedW + 1e-6; x += 10) { ctx.strokeStyle = x % 50 ? col('--grid', '#e5e5e5') : col('--grid-major', '#ccc'); ctx.beginPath(); ctx.moveTo(a.x + x * s, a.y); ctx.lineTo(a.x + x * s, a.y + bh); ctx.stroke(); }
    for (let y = 0; y <= m.bedH + 1e-6; y += 10) { ctx.strokeStyle = y % 50 ? col('--grid', '#e5e5e5') : col('--grid-major', '#ccc'); ctx.beginPath(); ctx.moveTo(a.x, a.y + y * s); ctx.lineTo(a.x + bw, a.y + y * s); ctx.stroke(); }
    ctx.strokeStyle = col('--fg', '#222'); ctx.strokeRect(a.x, a.y, bw, bh);
    ctx.fillStyle = col('--muted', '#666'); ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
    for (let x = 0; x <= m.bedW; x += 100) ctx.fillText(String(x), a.x + x * s, a.y - band - 4);
    ctx.textAlign = 'right'; for (let y = 0; y <= m.bedH; y += 100) ctx.fillText(String(y), a.x - band - 4, a.y + y * s + 4);
    ctx.textAlign = 'center'; ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText('BACK', a.x + bw / 2, a.y - band - 18); ctx.fillText('FRONT · you stand here', a.x + bw / 2, a.y + bh + 22);
    ctx.save(); ctx.translate(a.x - band - 34, a.y + bh / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('LEFT', 0, 0); ctx.restore();
    ctx.save(); ctx.translate(a.x + bw + band + 18, a.y + bh / 2); ctx.rotate(Math.PI / 2); ctx.fillText('RIGHT', 0, 0); ctx.restore();
    // parking corner
    const hm = toScr(cornerPt(m)); ctx.fillStyle = '#1a7f37'; ctx.beginPath(); ctx.arc(hm.x, hm.y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.font = '10.5px system-ui, sans-serif'; ctx.textAlign = hm.x > a.x + bw / 2 ? 'right' : 'left'; ctx.fillText('parks here', hm.x + (hm.x > a.x + bw / 2 ? -8 : 8), hm.y + (hm.y > a.y + bh / 2 ? -8 : 14));
    // the job
    const jb = jobBox(), fit = fitsBed(m, jb), j0 = toScr(P(jb.x0, jb.y0));
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
    if (frameAnim != null) drawFrameAnim(frameAnim);
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
    const tick = (now: number) => { if (!root.isConnected || !playing || !sim) return; tPlay = Math.min(sim.total, tPlay + (now - last) / 1000 * speed); last = now; updatePlayer(); draw(); if (tPlay >= sim.total) play(false); else raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
  }
  const stopPlay = () => play(false);
  function updatePlayer() { const T = sim?.total || 0; $<HTMLInputElement>('#lwScrub').value = String(T ? Math.round(tPlay / T * 1000) : 0); $('#lwClock').textContent = `${clock(tPlay)} / ${clock(T)}`; }
  $('#lwPlay').onclick = () => { if (sim && tPlay >= sim.total) tPlay = 0; play(!playing); };
  $<HTMLInputElement>('#lwScrub').oninput = e => { stopPlay(); tPlay = (sim?.total || 0) * +(e.target as HTMLInputElement).value / 1000; updatePlayer(); draw(); };
  root.querySelectorAll<HTMLElement>('#lwSpeed button').forEach(b => b.onclick = () => { speed = +b.dataset.v!; root.querySelectorAll('#lwSpeed button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
  $<HTMLInputElement>('#lwTravel').onchange = e => { showTravel = (e.target as HTMLInputElement).checked; draw(); };

  // ---------- dragging the job (or the head), and the ruler ----------
  let drag: { from: Point; at0: Point } | null = null;
  canvas.addEventListener('pointerdown', ev => {
    const r = canvas.getBoundingClientRect(), p = toBedPt(ev.clientX - r.left, ev.clientY - r.top);
    if (rulerOn) { ruler = P(Math.round(p.x * 2) / 2, Math.round(p.y * 2) / 2); rulerOn = false; msg(''); renderSteps(); draw(); return; }
    const jb = jobBox(), inJob = p.x >= jb.x0 && p.x <= jb.x1 && p.y >= jb.y0 && p.y <= jb.y1;
    if (S.placeMode === 'bed' && inJob) drag = { from: p, at0: S.at };
    else if (S.placeMode === 'head') drag = { from: p, at0: S.head };
    if (drag) { canvas.setPointerCapture(ev.pointerId); stopPlay(); tPlay = 0; }
  });
  canvas.addEventListener('pointermove', ev => {
    const r = canvas.getBoundingClientRect(), p = toBedPt(ev.clientX - r.left, ev.clientY - r.top);
    canvas.style.cursor = rulerOn ? 'crosshair' : (S.placeMode === 'bed' ? ((() => { const jb = jobBox(); return p.x >= jb.x0 && p.x <= jb.x1 && p.y >= jb.y0 && p.y <= jb.y1; })() ? 'grab' : 'default') : 'move');
    if (!drag) return;
    const q = P(Math.round((drag.at0.x + p.x - drag.from.x) * 2) / 2, Math.round((drag.at0.y + p.y - drag.from.y) * 2) / 2);
    if (S.placeMode === 'bed') S.at = q; else S.head = q;
    draw();
  });
  canvas.addEventListener('pointerup', () => { if (!drag) return; drag = null; save(); rebuild(); });

  // ---------- open / close ----------
  const close = () => { cancelAnimationFrame(raf); playing = false; root.remove(); window.removeEventListener('resize', onResize); window.removeEventListener('keydown', onKey, true); };
  const onResize = () => draw();
  const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { if (rulerOn) { rulerOn = false; renderSteps(); draw(); } else close(); ev.stopPropagation(); } else if (ev.key === ' ' && !(ev.target as HTMLElement).matches('input,select,textarea,button')) { ev.preventDefault(); $('#lwPlay').click(); } };
  $('#lwClose').onclick = close;
  $<HTMLInputElement>('#lwHelp').onchange = e => { S.help = (e.target as HTMLInputElement).checked; save(); renderSteps(); };
  window.addEventListener('resize', onResize); window.addEventListener('keydown', onKey, true);
  loadJob();
  if (!paths.length) msg('Nothing on this sheet is set to cut or engrave yet.', true);
  requestAnimationFrame(() => draw());
  return { close };
}
