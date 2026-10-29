/**
 * "Trace image" window: load a picture, clean it up, trace it to outlines and
 * place them in the drawing at an exact size. Includes an eraser brush for
 * the picture (drag to remove flakes and background; Alt-drag restores).
 */
import { trace, whyEmpty, lastLabelMap, type TraceOpts, type TraceResult, type Img } from '../trace/trace';
import { P, fmt, parseLength, type Point } from '../geometry/vec';
import { fitSpline } from '../geometry/spline';
import type { Editor } from '../editor/editor';
import type { Shape } from '../model/types';

interface Settings { mode: 'silhouette' | 'colours'; threshold: number; auto: boolean; invert: boolean; flatten: boolean; fillHoles: boolean; colours: number; merge: boolean; clean: number; smooth: number; detail: number; speckMm: number; widthMm: number; res: number; showImg: boolean; brush: number; curves: boolean }
const DEFAULTS: Settings = { mode: 'silhouette', threshold: 128, auto: true, invert: false, flatten: false, fillHoles: false, colours: 4, merge: false, clean: 1, smooth: 2, detail: 6, speckMm: 1, widthMm: 100, res: 800, showImg: true, brush: 12, curves: true };
const S: Settings = { ...DEFAULTS };

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);
export const tolFromDetail = (d: number) => 0.25 * Math.pow(1.35, 10 - d);

/** A decoded picture: anything canvas can draw, with its pixel size. */
interface Pic { src: CanvasImageSource; naturalWidth: number; naturalHeight: number }

/**
 * Decode a picture file. Tries createImageBitmap first (needs no URL, so it
 * works inside sandboxed pages that block blob: images), then a data: URL,
 * then a blob: URL.
 */
export async function decodeImage(file: Blob): Promise<Pic> {
  const errors: string[] = [];
  if (typeof createImageBitmap === 'function') {
    try { const b = await createImageBitmap(file); return { src: b, naturalWidth: b.width, naturalHeight: b.height }; } catch (e: any) { errors.push(e?.message || 'bitmap'); }
  }
  const viaUrl = (url: string) => new Promise<Pic>((ok, bad) => { const im = new Image(); im.onload = () => ok({ src: im, naturalWidth: im.naturalWidth, naturalHeight: im.naturalHeight }); im.onerror = () => bad(new Error('image')); im.src = url; });
  try { const url = await new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => bad(r.error); r.readAsDataURL(file); }); return await viaUrl(url); } catch (e: any) { errors.push(e?.message || 'data'); }
  const u = URL.createObjectURL(file);
  try { return await viaUrl(u); } finally { URL.revokeObjectURL(u); }
}

export async function openTrace(ed: Editor, file: Blob, name = (file as File).name || 'pasted image') {
  if (file.type && /heic|heif/i.test(file.type + name)) { ed.toast('HEIC photos (iPhone) cannot be read by browsers — save it as JPEG or PNG first'); return; }
  ed.toast('Opening ' + name + '…');
  try { build(ed, await decodeImage(file), name); }
  catch { ed.toast(`${name} could not be read as an image — try saving it as PNG or JPEG`); }
}

function build(ed: Editor, im: Pic, name: string) {
  document.querySelector('#trace')?.remove();
  Object.assign(S, { ...DEFAULTS, showImg: S.showImg, brush: S.brush });
  const root = document.createElement('div'); root.id = 'trace';
  root.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-labelledby="tTitle">
    <div class="head"><strong id="tTitle">Trace image · ${esc(name)}</strong><button class="x" id="tClose" aria-label="Close">✕</button></div>
    <div class="body">
      <div class="view"><canvas id="tCv" aria-label="Trace preview"></canvas><div class="vbar"><span class="segc" role="group" aria-label="Brush"><button type="button" id="tErase" aria-pressed="false" title="Drag to remove flakes, detail or background · Alt-drag restores · wheel = brush size">Erase</button><button type="button" id="tFillB" aria-pressed="false" title="Drag to paint solid shape — fills holes and gaps (Colours: paints the colour where you start) · Alt-drag restores · wheel = brush size">Fill</button></span><label class="hint bsz">Brush size <input type="text" id="tBrush" class="mono" inputmode="decimal" style="width:52px"> mm</label><button class="btn" id="tClear" title="Remove all erase and fill painting">Clear brush</button><span class="segc zoomc" role="group" aria-label="Zoom"><button type="button" id="tZout" title="Zoom out">−</button><button type="button" id="tZfit" title="Whole picture"><span id="tZoomO">100%</span></button><button type="button" id="tZin" title="Zoom in (or roll the mouse wheel over the picture; drag to move round)">+</button></span>
        <label class="chk">Line <select id="tLine"><option value="#ff1493">Pink</option><option value="#00b4d8">Cyan</option><option value="#ff7a00">Orange</option><option value="#12b886">Green</option><option value="#000000">Black</option></select></label><label class="chk"><input type="checkbox" id="tShow">Show picture</label></div></div>
      <div class="ctl">
        <div class="row"><button class="btn" id="tUndo" title="Undo (Ctrl/Cmd+Z)">Undo</button><button class="btn" id="tRedo" title="Redo (Ctrl/Cmd+Y)">Redo</button><button class="btn" id="tReset" title="Back to the starting settings and clear erasing">Reset</button></div>
        <div class="segc" role="group" id="tMode"><button type="button" data-v="silhouette">Silhouette</button><button type="button" data-v="colours">Colours</button></div>
        <div id="tSil">
          <label class="sl">Threshold <input type="range" id="tTh" min="1" max="254"><output id="tThO"></output></label>
          <div class="row"><label class="chk"><input type="checkbox" id="tAuto">Auto</label><label class="chk"><input type="checkbox" id="tInv">Light shape on dark</label></div>
        </div>
        <div id="tCol">
          <label class="sl">Colours <input type="range" id="tK" min="2" max="8"><output id="tKO"></output></label>
          <div id="tPal" class="pal"></div>
          <p class="hint">Click a colour to drop or keep it. Colours that fill the picture's edges are treated as background and dropped.</p>
          <label class="chk"><input type="checkbox" id="tMerge">Join kept colours into one silhouette</label>
        </div>
        <label class="chk"><input type="checkbox" id="tFlat">Even out a graduated background</label>
        <label class="chk" title="Fills every enclosed area, so only the outer edge is traced — e.g. just the head-and-shoulders outline of a portrait"><input type="checkbox" id="tFill">Outer outline only (fill holes)</label>
        <label class="sl">Noise clean-up <input type="range" id="tClean" min="0" max="5"><output id="tCleanO"></output></label>
        <label class="sl">Ignore specks under <input type="text" id="tSpeck" class="mono" inputmode="decimal"> mm</label>
        <label class="sl">Detail <input type="range" id="tDet" min="1" max="10"><output id="tDetO"></output></label>
        <label class="sl">Smoothness <input type="range" id="tSm" min="0" max="4"><output id="tSmO"></output></label>
        <label class="chk" title="Lines become smooth curves (sharp corners stay sharp). Untick for straight-line segments."><input type="checkbox" id="tCurves">Smooth curves</label>
        <label class="sl">Width <input type="text" id="tW" class="mono" inputmode="decimal"> mm <span class="hint" id="tH"></span></label>
        <label class="sl">Working size <select id="tRes"><option value="400">400 px (fast)</option><option value="800">800 px</option><option value="1200">1200 px (fine)</option></select></label>
        <p class="stat" id="tStat">Tracing…</p>
      </div>
    </div>
    <div class="foot"><p class="hint">Outlines are placed as one group, centred on the sheet. Use the Eraser tool (X) afterwards for any flakes left.</p><button class="btn" id="tCancel">Cancel</button><button class="btn primary" id="tPlace">Place in drawing</button></div>
  </div>`;
  document.body.append(root);
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector(s) as T;
  const cv = $<HTMLCanvasElement>('#tCv'), ctx = cv.getContext('2d')!;
  let img: Img, erase: Uint8Array, res: TraceResult | null = null, keep: boolean[] | undefined, timer = 0, painting = false, brush: 'off' | 'erase' | 'fill' = 'off', paintVal = 1, lineCol = '#ff1493';
  const erasing = () => brush !== 'off';
  const close = () => { root.remove(); window.removeEventListener('keydown', onKey, true); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); return; }
    const typing = (e.target as HTMLElement)?.matches?.('input[type=text],textarea');
    if ((e.ctrlKey || e.metaKey) && !typing) {
      const k = e.key.toLowerCase();
      if (k === 'z' || k === 'y') { e.preventDefault(); e.stopImmediatePropagation(); (k === 'y' || e.shiftKey) ? redo() : undo(); }
    }
  };
  window.addEventListener('keydown', onKey, true);

  // ---- undo / redo / reset (settings, kept colours and erasing) ----
  type Snap = { s: Settings; keep?: boolean[]; erase: Uint8Array };
  const hist: Snap[] = []; let hi = -1, commitT = 0;
  const snap = (): Snap => ({ s: { ...S }, keep: keep?.slice(), erase });
  function commit(now = false) {
    clearTimeout(commitT);
    const same = (a: Snap, b: Snap) => a.erase === b.erase && JSON.stringify([a.s, a.keep]) === JSON.stringify([b.s, b.keep]);
    const go = () => { const n = snap(); if (hi >= 0 && same(hist[hi], n)) return; hist.splice(hi + 1); hist.push(n); if (hist.length > 40) hist.shift(); hi = hist.length - 1; histButtons(); };
    if (now) go(); else commitT = window.setTimeout(go, 350);
  }
  function restore(h: Snap) {
    const resChanged = h.s.res !== S.res; Object.assign(S, h.s); keep = h.keep?.slice();
    if (resChanged) load(); erase = h.erase; sync(); run(); histButtons();
  }
  function undo() { clearTimeout(commitT); if (hi > 0) restore(hist[--hi]); }
  function redo() { if (hi < hist.length - 1) restore(hist[++hi]); }
  function histButtons() { ($('#tUndo') as HTMLButtonElement).disabled = hi <= 0; ($('#tRedo') as HTMLButtonElement).disabled = hi >= hist.length - 1; }
  function reset() { const resChanged = S.res !== DEFAULTS.res; Object.assign(S, { ...DEFAULTS, showImg: S.showImg, brush: S.brush }); keep = undefined; if (resChanged) load(); erase = new Uint8Array(img.w * img.h); sync(); run(); commit(true); }

  function load() {
    const k = Math.min(1, S.res / Math.max(im.naturalWidth, im.naturalHeight)), w = Math.max(8, Math.round(im.naturalWidth * k)), h = Math.max(8, Math.round(im.naturalHeight * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d')!; x.drawImage(im.src, 0, 0, w, h);
    const old = img, oldE = erase; img = { w, h, data: x.getImageData(0, 0, w, h).data };
    erase = new Uint8Array(w * h);
    if (old && oldE) for (let y = 0; y < h; y++) for (let x2 = 0; x2 < w; x2++) erase[y * w + x2] = oldE[Math.min(old.h - 1, Math.floor(y * old.h / h)) * old.w + Math.min(old.w - 1, Math.floor(x2 * old.w / w))];
  }
  const pxPerMm = () => img.w / Math.max(1, S.widthMm);
  function opts(): TraceOpts {
    return { mode: S.mode, threshold: S.auto ? 'auto' : S.threshold, invert: S.invert, flatten: S.flatten, fillHoles: S.fillHoles, colours: S.colours, keep, merge: S.merge,
      clean: S.clean, smooth: S.smooth, speckPx: (S.speckMm * pxPerMm()) ** 2, tolPx: tolFromDetail(S.detail), erase };
  }
  function run() {
    clearTimeout(timer); $('#tStat').textContent = 'Tracing…';
    timer = window.setTimeout(() => {
      const t0 = performance.now(); res = trace(img, opts());
      if (S.auto && S.mode === 'silhouette') { S.threshold = Math.round(res.threshold); sync(); }
      const many = res.loops.length > 1500;
      const why = whyEmpty(res, opts());
      $('#tStat').innerHTML = `${res.loops.length} outline${res.loops.length === 1 ? '' : 's'} · ${res.points} points${S.mode === 'colours' ? ` · ${res.palette.length} colours found` : ''} · ${Math.round(performance.now() - t0)} ms${many ? '<br><b>Very many pieces</b> — raise "Ignore specks", noise clean-up, or use the eraser.' : ''}${why ? `<br><b class="warn">${esc(why)}</b>` : ''}`;
      renderPal(); draw();
    }, 90);
  }
  // ---- preview ----
  let fit = { k: 1, ox: 0, oy: 0 };
  /** zoom (1 = whole picture) and the picture point shown in the middle */
  const zv = { z: 1, cx: NaN, cy: NaN };
  function draw() {
    const r = cv.parentElement!.getBoundingClientRect(), dpr = devicePixelRatio || 1, W = Math.max(100, r.width), H = Math.max(100, r.height - 44);
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    if (!isFinite(zv.cx)) { zv.cx = img.w / 2; zv.cy = img.h / 2; }
    const k = Math.min(W / img.w, H / img.h) * 0.96 * zv.z; fit = { k, ox: W / 2 - zv.cx * k, oy: H / 2 - zv.cy * k };
    $('#tZoomO').textContent = Math.round(zv.z * 100) + '%';
    ctx.fillStyle = '#fff'; ctx.fillRect(fit.ox, fit.oy, img.w * k, img.h * k);
    if (S.showImg) { ctx.globalAlpha = .45; ctx.drawImage(im.src, fit.ox, fit.oy, img.w * k, img.h * k); ctx.globalAlpha = 1; }
    // brush painting: erased (red) and filled (green)
    for (const [val, col] of [[1, 'rgba(224,49,49,.30)'], [2, 'rgba(18,184,134,.32)']] as [number, string][]) {
      ctx.fillStyle = col;
      for (let y = 0; y < img.h; y++) { let x0 = -1; for (let x = 0; x <= img.w; x++) { const e = x < img.w ? erase[y * img.w + x] : 0, on = val === 1 ? e === 1 : e >= 2; if (on && x0 < 0) x0 = x; if (!on && x0 >= 0) { ctx.fillRect(fit.ox + x0 * k, fit.oy + y * k, (x - x0) * k, k + .5); x0 = -1; } } }
    }
    if (res) {
      ctx.beginPath();
      for (const l of res.loops) {
        const cl = l.closed !== false, X = (p: Point) => fit.ox + p.x * k, Y = (p: Point) => fit.oy + p.y * k;
        if (S.curves && l.pts.length > 3) {
          const f = fitSpline(l.pts, cl), n = f.pts.length; ctx.moveTo(X(f.pts[0]), Y(f.pts[0]));
          for (let i = 0; i < (cl ? n : n - 1); i++) { const j = (i + 1) % n, c1 = f.h[i][1], c2 = f.h[j][0], q = f.pts[j]; ctx.bezierCurveTo(X(c1), Y(c1), X(c2), Y(c2), X(q), Y(q)); }
          if (cl) ctx.closePath();
        } else { l.pts.forEach((p, i) => { i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p)); }); if (cl) ctx.closePath(); }
      }
      ctx.lineJoin = 'round'; ctx.strokeStyle = lineCol === '#000000' ? '#ffffff' : 'rgba(255,255,255,.9)'; ctx.lineWidth = 4; ctx.stroke();
      ctx.strokeStyle = lineCol; ctx.lineWidth = 1.8; ctx.stroke();
    }
    const bi = $<HTMLInputElement>('#tBrush'); if (document.activeElement !== bi) bi.value = fmt(S.brush / pxPerMm(), 1);
  }
  const toImg = (ev: PointerEvent | WheelEvent) => { const r = cv.getBoundingClientRect(); return P((ev.clientX - r.left - fit.ox) / fit.k, (ev.clientY - r.top - fit.oy) / fit.k); };
  function paint(ev: PointerEvent) {
    const p = toImg(ev), R = S.brush, v = ev.altKey ? 0 : paintVal;
    for (let y = Math.max(0, Math.floor(p.y - R)); y <= Math.min(img.h - 1, Math.ceil(p.y + R)); y++)
      for (let x = Math.max(0, Math.floor(p.x - R)); x <= Math.min(img.w - 1, Math.ceil(p.x + R)); x++) if ((x + .5 - p.x) ** 2 + (y + .5 - p.y) ** 2 <= R * R) erase[y * img.w + x] = v;
    draw(); brushRing(ev);
  }
  function brushRing(ev: PointerEvent | WheelEvent) {
    if (!erasing()) return; const r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    ctx.strokeStyle = brush === 'fill' ? '#12b886' : '#e03131'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, S.brush * fit.k, 0, Math.PI * 2); ctx.stroke();
  }
  let pan: { x: number; y: number; cx: number; cy: number } | null = null;
  cv.addEventListener('pointerdown', ev => {
    // no brush (or middle button): drag to move round the zoomed picture
    if (!erasing() || ev.button === 1) { if (zv.z > 1 || ev.button === 1) { pan = { x: ev.clientX, y: ev.clientY, cx: zv.cx, cy: zv.cy }; cv.setPointerCapture(ev.pointerId); cv.style.cursor = 'grabbing'; } return; }
    paintVal = 1;
    if (brush === 'fill') {
      paintVal = 2;
      if (S.mode === 'colours' && !S.merge) {
        const p = toImg(ev), L = lastLabelMap(), i = Math.min(img.h - 1, Math.max(0, Math.floor(p.y))) * img.w + Math.min(img.w - 1, Math.max(0, Math.floor(p.x)));
        const lab = L && L.length === img.w * img.h ? L[i] : 255;
        if (lab === 255) { ed.toast('Start a Fill stroke inside a colour you are keeping — it paints that colour'); return; }
        paintVal = 2 + lab;
      }
    }
    painting = true; erase = erase.slice(); cv.setPointerCapture(ev.pointerId); paint(ev); });
  cv.addEventListener('pointermove', ev => { if (pan) { zv.cx = pan.cx - (ev.clientX - pan.x) / fit.k; zv.cy = pan.cy - (ev.clientY - pan.y) / fit.k; draw(); return; } if (painting) paint(ev); else if (erasing()) { draw(); brushRing(ev); } });
  cv.addEventListener('pointerup', () => { if (pan) { pan = null; cv.style.cursor = erasing() ? 'crosshair' : zv.z > 1 ? 'grab' : ''; return; } if (painting) { painting = false; run(); commit(true); } });
  /** zoom about a screen point (keeps the picture point under it still) */
  function zoomAt(f: number, sx?: number, sy?: number) {
    const r = cv.getBoundingClientRect(), x = sx ?? r.width / 2, y = sy ?? r.height / 2, px = (x - fit.ox) / fit.k, py = (y - fit.oy) / fit.k;
    const z = Math.max(1, Math.min(40, zv.z * f)); if (z === 1) { zv.z = 1; zv.cx = img.w / 2; zv.cy = img.h / 2; draw(); return; }
    const k = fit.k * z / zv.z; zv.z = z; zv.cx = px - (x - r.width / 2) / k; zv.cy = py - (y - (r.height) / 2) / k; draw();
    if (!erasing()) cv.style.cursor = 'grab';
  }
  cv.addEventListener('wheel', ev => {
    // wheel zooms the preview; with Erase / Fill on it sizes the brush (Ctrl+wheel still zooms)
    if (!erasing() || ev.ctrlKey) { ev.preventDefault(); const r = cv.getBoundingClientRect(); zoomAt(Math.exp(-Math.max(-200, Math.min(200, ev.deltaY)) * 0.003), ev.clientX - r.left, ev.clientY - r.top); return; }
    ev.preventDefault(); S.brush = Math.max(1, Math.min(200, Math.round(S.brush * (ev.deltaY < 0 ? 1.15 : 1 / 1.15)))); draw(); brushRing(ev); }, { passive: false });

  // ---- controls ----
  function renderPal() {
    const pal = $('#tPal'); if (!res || S.mode !== 'colours') { pal.innerHTML = ''; return; }
    const kp = res.palette.map((_, j) => keep?.[j] ?? !res!.backgrounds.includes(j));
    pal.innerHTML = res.palette.map((c, j) => `<button type="button" data-j="${j}" aria-pressed="${kp[j]}" title="${kp[j] ? 'Kept — click to drop' : 'Dropped — click to keep'}${res!.backgrounds.includes(j) ? ' (background)' : ''}" style="--sw:rgb(${c.join(',')})"></button>`).join('');
    pal.querySelectorAll<HTMLElement>('button').forEach(b => b.onclick = () => { const j = +b.dataset.j!; keep = kp.slice(); keep[j] = !keep[j]; run(); commit(true); });
  }
  function sync() {
    root.querySelectorAll<HTMLElement>('#tMode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S.mode)));
    $('#tSil').hidden = S.mode !== 'silhouette'; $('#tCol').hidden = S.mode !== 'colours';
    const set = (id: string, v: any) => { const el = $<HTMLInputElement>(id); if (el.type === 'checkbox') el.checked = !!v; else if (document.activeElement !== el) el.value = String(v); };
    set('#tTh', S.threshold); $('#tThO').textContent = S.auto ? `${S.threshold} (auto)` : String(S.threshold);
    set('#tAuto', S.auto); set('#tInv', S.invert); set('#tFlat', S.flatten); set('#tFill', S.fillHoles); set('#tMerge', S.merge); set('#tShow', S.showImg); set('#tCurves', S.curves);
    set('#tK', S.colours); $('#tKO').textContent = String(S.colours);
    set('#tClean', S.clean); $('#tCleanO').textContent = String(S.clean);
    set('#tDet', S.detail); $('#tDetO').textContent = `${S.detail} · ±${fmt(tolFromDetail(S.detail) / pxPerMm(), 2)} mm`;
    set('#tSm', S.smooth); $('#tSmO').textContent = String(S.smooth);
    set('#tSpeck', S.speckMm); set('#tW', S.widthMm); $<HTMLSelectElement>('#tRes').value = String(S.res);
    $('#tH').textContent = `× ${fmt(S.widthMm * img.h / img.w, 1)} mm`;
  }
  const bind = (id: string, f: (el: HTMLInputElement) => void, ev = 'input') => $<HTMLInputElement>(id).addEventListener(ev, e => { const el = e.target as HTMLInputElement; f(el); if (el.type === 'text') el.blur(); sync(); run(); commit(ev === 'change'); });
  root.querySelectorAll<HTMLElement>('#tMode button').forEach(b => b.onclick = () => { S.mode = b.dataset.v as any; sync(); run(); commit(true); });
  bind('#tTh', e => { S.threshold = +e.value; S.auto = false; });
  bind('#tAuto', e => { S.auto = e.checked; }, 'change'); bind('#tInv', e => { S.invert = e.checked; }, 'change');
  bind('#tFlat', e => { S.flatten = e.checked; }, 'change'); bind('#tFill', e => { S.fillHoles = e.checked; }, 'change'); bind('#tMerge', e => { S.merge = e.checked; }, 'change');
  bind('#tK', e => { S.colours = +e.value; keep = undefined; });
  bind('#tClean', e => { S.clean = +e.value; }); bind('#tDet', e => { S.detail = +e.value; }); bind('#tSm', e => { S.smooth = +e.value; });
  bind('#tSpeck', e => { const v = parseFloat(e.value); if (v >= 0) S.speckMm = v; }, 'change');
  bind('#tW', e => { const v = parseFloat(e.value); if (v > 0) { S.widthMm = Math.min(3000, Math.max(5, v)); if (v < 5) ed.toast('Smallest width is 5 mm'); } }, 'change');
  $<HTMLSelectElement>('#tRes').onchange = e => { S.res = +(e.target as HTMLSelectElement).value; load(); sync(); run(); commit(true); };
  $<HTMLInputElement>('#tShow').onchange = e => { S.showImg = (e.target as HTMLInputElement).checked; draw(); };
  $('#tZin').onclick = () => zoomAt(1.5); $('#tZout').onclick = () => zoomAt(1 / 1.5); $('#tZfit').onclick = () => zoomAt(0);
  $<HTMLInputElement>('#tCurves').onchange = e => { S.curves = (e.target as HTMLInputElement).checked; draw(); };
  // brush size: type it (mm), or roll the wheel over the picture while Erase / Fill is on
  $<HTMLInputElement>('#tBrush').onchange = e => { const v = parseLength((e.target as HTMLInputElement).value); if (v > 0) S.brush = Math.max(1, Math.min(200, Math.round(v * pxPerMm()))); draw(); };
  const setBrush = (b: typeof brush) => { brush = brush === b ? 'off' : b; $('#tErase').setAttribute('aria-pressed', String(brush === 'erase')); $('#tFillB').setAttribute('aria-pressed', String(brush === 'fill')); cv.style.cursor = erasing() ? 'crosshair' : ''; draw(); };
  $('#tErase').onclick = () => setBrush('erase'); $('#tFillB').onclick = () => setBrush('fill');
  $<HTMLSelectElement>('#tLine').onchange = e => { lineCol = (e.target as HTMLSelectElement).value; draw(); };
  $('#tClear').onclick = () => { erase = new Uint8Array(img.w * img.h); run(); commit(true); };
  $('#tUndo').onclick = undo; $('#tRedo').onclick = redo; $('#tReset').onclick = reset;
  $('#tClose').onclick = close; $('#tCancel').onclick = close;
  root.addEventListener('click', e => { if (e.target === root) close(); });
  $('#tPlace').onclick = () => {
    if (!res || !res.loops.length) { ed.toast('Nothing traced yet'); return; }
    const s = S.widthMm / img.w, pg = ed.doc.page, H = img.h * s, ox = (pg.w - S.widthMm) / 2, oy = (pg.h - H) / 2;
    const shapes = res.loops.map(l => {
      const pts = l.pts.map(p => P(+(ox + p.x * s).toFixed(4), +(oy + (img.h - p.y) * s).toFixed(4))), cl = l.closed !== false;
      if (S.curves && pts.length > 3) { const f = fitSpline(pts, cl); return { type: 'spline', pts: f.pts, h: f.h, closed: cl } as Shape; }
      return { type: 'poly', closed: cl, pts } as Shape;
    });
    const g = 'g' + (ed.doc.seq++);
    const ids = ed.store.change(() => shapes.map(sh => { const e = ed.store.add(sh); if (shapes.length > 1) e.group = [g]; return e.id; }));
    ed.setSelection(ids); close();
    ed.toast(`Placed ${shapes.length} outline${shapes.length > 1 ? 's' : ''} (${fmt(S.widthMm, 1)} × ${fmt(H, 1)} mm)${shapes.length > 1 ? ' as a group' : ''}`);
  };
  new ResizeObserver(() => res && draw()).observe(cv.parentElement!);
  load(); sync(); run(); commit(true);
}
