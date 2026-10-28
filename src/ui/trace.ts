/**
 * "Trace image" window: load a picture, clean it up, trace it to outlines and
 * place them in the drawing at an exact size. Includes an eraser brush for
 * the picture (drag to remove flakes and background; Alt-drag restores).
 */
import { trace, type TraceOpts, type TraceResult, type Img } from '../trace/trace';
import { P, fmt } from '../geometry/vec';
import type { Editor } from '../editor/editor';
import type { Shape } from '../model/types';

interface Settings { mode: 'silhouette' | 'colours'; threshold: number; auto: boolean; invert: boolean; flatten: boolean; fillHoles: boolean; colours: number; merge: boolean; clean: number; smooth: number; detail: number; speckMm: number; widthMm: number; res: number; showImg: boolean; brush: number }
const S: Settings = { mode: 'silhouette', threshold: 128, auto: true, invert: false, flatten: false, fillHoles: false, colours: 4, merge: false, clean: 1, smooth: 2, detail: 6, speckMm: 1, widthMm: 100, res: 800, showImg: true, brush: 12 };

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);
export const tolFromDetail = (d: number) => 0.25 * Math.pow(1.35, 10 - d);

export function openTrace(ed: Editor, file: File) {
  const url = URL.createObjectURL(file), im = new Image();
  im.onload = () => { build(ed, im, file.name); URL.revokeObjectURL(url); };
  im.onerror = () => { ed.toast('That file could not be read as an image'); URL.revokeObjectURL(url); };
  im.src = url;
}

function build(ed: Editor, im: HTMLImageElement, name: string) {
  document.querySelector('#trace')?.remove();
  const root = document.createElement('div'); root.id = 'trace';
  root.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-labelledby="tTitle">
    <div class="head"><strong id="tTitle">Trace image · ${esc(name)}</strong><button class="x" id="tClose" aria-label="Close">✕</button></div>
    <div class="body">
      <div class="view"><canvas id="tCv" aria-label="Trace preview"></canvas><div class="vbar"><button class="btn" id="tErase" aria-pressed="false" title="Drag over the picture to remove flakes and background · Alt-drag restores · wheel = brush size">Eraser brush</button><span class="hint" id="tBrush"></span><button class="btn" id="tClear">Clear erasing</button><label class="chk"><input type="checkbox" id="tShow">Show picture</label></div></div>
      <div class="ctl">
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
        <label class="chk"><input type="checkbox" id="tFill">Fill holes</label>
        <label class="sl">Noise clean-up <input type="range" id="tClean" min="0" max="5"><output id="tCleanO"></output></label>
        <label class="sl">Ignore specks under <input type="text" id="tSpeck" class="mono" inputmode="decimal"> mm</label>
        <label class="sl">Detail <input type="range" id="tDet" min="1" max="10"><output id="tDetO"></output></label>
        <label class="sl">Smoothness <input type="range" id="tSm" min="0" max="4"><output id="tSmO"></output></label>
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
  let img: Img, erase: Uint8Array, res: TraceResult | null = null, keep: boolean[] | undefined, timer = 0, erasing = false, painting = false;
  const close = () => { root.remove(); window.removeEventListener('keydown', onKey, true); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  window.addEventListener('keydown', onKey, true);

  function load() {
    const k = Math.min(1, S.res / Math.max(im.naturalWidth, im.naturalHeight)), w = Math.max(8, Math.round(im.naturalWidth * k)), h = Math.max(8, Math.round(im.naturalHeight * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d')!; x.drawImage(im, 0, 0, w, h);
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
      $('#tStat').innerHTML = `${res.loops.length} outline${res.loops.length === 1 ? '' : 's'} · ${res.points} points · ${Math.round(performance.now() - t0)} ms${many ? '<br><b>Very many pieces</b> — raise "Ignore specks", noise clean-up, or use the eraser.' : ''}`;
      renderPal(); draw();
    }, 90);
  }
  // ---- preview ----
  let fit = { k: 1, ox: 0, oy: 0 };
  function draw() {
    const r = cv.parentElement!.getBoundingClientRect(), dpr = devicePixelRatio || 1, W = Math.max(100, r.width), H = Math.max(100, r.height - 44);
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const k = Math.min(W / img.w, H / img.h) * 0.96; fit = { k, ox: (W - img.w * k) / 2, oy: (H - img.h * k) / 2 };
    ctx.fillStyle = '#fff'; ctx.fillRect(fit.ox, fit.oy, img.w * k, img.h * k);
    if (S.showImg) { ctx.globalAlpha = .45; ctx.drawImage(im, fit.ox, fit.oy, img.w * k, img.h * k); ctx.globalAlpha = 1; }
    // erased areas
    ctx.fillStyle = 'rgba(224,49,49,.28)';
    for (let y = 0; y < img.h; y++) { let x0 = -1; for (let x = 0; x <= img.w; x++) { const on = x < img.w && erase[y * img.w + x]; if (on && x0 < 0) x0 = x; if (!on && x0 >= 0) { ctx.fillRect(fit.ox + x0 * k, fit.oy + y * k, (x - x0) * k, k + .5); x0 = -1; } } }
    if (res) {
      ctx.strokeStyle = '#0b7285'; ctx.lineWidth = 1.4; ctx.beginPath();
      for (const l of res.loops) { l.pts.forEach((p, i) => { const X = fit.ox + p.x * k, Y = fit.oy + p.y * k; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); ctx.closePath(); }
      ctx.stroke();
    }
    $('#tBrush').textContent = `brush ${fmt(S.brush / pxPerMm(), 1)} mm`;
  }
  const toImg = (ev: PointerEvent | WheelEvent) => { const r = cv.getBoundingClientRect(); return P((ev.clientX - r.left - fit.ox) / fit.k, (ev.clientY - r.top - fit.oy) / fit.k); };
  function paint(ev: PointerEvent) {
    const p = toImg(ev), R = S.brush, v = ev.altKey ? 0 : 1;
    for (let y = Math.max(0, Math.floor(p.y - R)); y <= Math.min(img.h - 1, Math.ceil(p.y + R)); y++)
      for (let x = Math.max(0, Math.floor(p.x - R)); x <= Math.min(img.w - 1, Math.ceil(p.x + R)); x++) if ((x + .5 - p.x) ** 2 + (y + .5 - p.y) ** 2 <= R * R) erase[y * img.w + x] = v;
    draw(); brushRing(ev);
  }
  function brushRing(ev: PointerEvent | WheelEvent) {
    if (!erasing) return; const r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    ctx.strokeStyle = '#e03131'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, S.brush * fit.k, 0, Math.PI * 2); ctx.stroke();
  }
  cv.addEventListener('pointerdown', ev => { if (!erasing) return; painting = true; cv.setPointerCapture(ev.pointerId); paint(ev); });
  cv.addEventListener('pointermove', ev => { if (painting) paint(ev); else if (erasing) { draw(); brushRing(ev); } });
  cv.addEventListener('pointerup', () => { if (painting) { painting = false; run(); } });
  cv.addEventListener('wheel', ev => { if (!erasing) return; ev.preventDefault(); S.brush = Math.max(1, Math.min(200, Math.round(S.brush * (ev.deltaY < 0 ? 1.15 : 1 / 1.15)))); draw(); brushRing(ev); }, { passive: false });

  // ---- controls ----
  function renderPal() {
    const pal = $('#tPal'); if (!res || S.mode !== 'colours') { pal.innerHTML = ''; return; }
    const kp = res.palette.map((_, j) => keep?.[j] ?? !res!.backgrounds.includes(j));
    pal.innerHTML = res.palette.map((c, j) => `<button type="button" data-j="${j}" aria-pressed="${kp[j]}" title="${kp[j] ? 'Kept — click to drop' : 'Dropped — click to keep'}${res!.backgrounds.includes(j) ? ' (background)' : ''}" style="--sw:rgb(${c.join(',')})"></button>`).join('');
    pal.querySelectorAll<HTMLElement>('button').forEach(b => b.onclick = () => { const j = +b.dataset.j!; keep = kp.slice(); keep[j] = !keep[j]; run(); });
  }
  function sync() {
    root.querySelectorAll<HTMLElement>('#tMode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S.mode)));
    $('#tSil').hidden = S.mode !== 'silhouette'; $('#tCol').hidden = S.mode !== 'colours';
    const set = (id: string, v: any) => { const el = $<HTMLInputElement>(id); if (el.type === 'checkbox') el.checked = !!v; else if (document.activeElement !== el) el.value = String(v); };
    set('#tTh', S.threshold); $('#tThO').textContent = S.auto ? `${S.threshold} (auto)` : String(S.threshold);
    set('#tAuto', S.auto); set('#tInv', S.invert); set('#tFlat', S.flatten); set('#tFill', S.fillHoles); set('#tMerge', S.merge); set('#tShow', S.showImg);
    set('#tK', S.colours); $('#tKO').textContent = String(S.colours);
    set('#tClean', S.clean); $('#tCleanO').textContent = String(S.clean);
    set('#tDet', S.detail); $('#tDetO').textContent = `${S.detail} · ±${fmt(tolFromDetail(S.detail) / pxPerMm(), 2)} mm`;
    set('#tSm', S.smooth); $('#tSmO').textContent = String(S.smooth);
    set('#tSpeck', S.speckMm); set('#tW', S.widthMm); $<HTMLSelectElement>('#tRes').value = String(S.res);
    $('#tH').textContent = `× ${fmt(S.widthMm * img.h / img.w, 1)} mm`;
  }
  const bind = (id: string, f: (el: HTMLInputElement) => void, ev = 'input') => $<HTMLInputElement>(id).addEventListener(ev, e => { f(e.target as HTMLInputElement); sync(); run(); });
  root.querySelectorAll<HTMLElement>('#tMode button').forEach(b => b.onclick = () => { S.mode = b.dataset.v as any; sync(); run(); });
  bind('#tTh', e => { S.threshold = +e.value; S.auto = false; });
  bind('#tAuto', e => { S.auto = e.checked; }, 'change'); bind('#tInv', e => { S.invert = e.checked; }, 'change');
  bind('#tFlat', e => { S.flatten = e.checked; }, 'change'); bind('#tFill', e => { S.fillHoles = e.checked; }, 'change'); bind('#tMerge', e => { S.merge = e.checked; }, 'change');
  bind('#tK', e => { S.colours = +e.value; keep = undefined; });
  bind('#tClean', e => { S.clean = +e.value; }); bind('#tDet', e => { S.detail = +e.value; }); bind('#tSm', e => { S.smooth = +e.value; });
  bind('#tSpeck', e => { const v = parseFloat(e.value); if (v >= 0) S.speckMm = v; }, 'change');
  bind('#tW', e => { const v = parseFloat(e.value); if (v > 0) S.widthMm = v; }, 'change');
  $<HTMLSelectElement>('#tRes').onchange = e => { S.res = +(e.target as HTMLSelectElement).value; load(); sync(); run(); };
  $<HTMLInputElement>('#tShow').onchange = e => { S.showImg = (e.target as HTMLInputElement).checked; draw(); };
  $('#tErase').onclick = () => { erasing = !erasing; $('#tErase').setAttribute('aria-pressed', String(erasing)); cv.style.cursor = erasing ? 'crosshair' : ''; };
  $('#tClear').onclick = () => { erase.fill(0); run(); };
  $('#tClose').onclick = close; $('#tCancel').onclick = close;
  root.addEventListener('click', e => { if (e.target === root) close(); });
  $('#tPlace').onclick = () => {
    if (!res || !res.loops.length) { ed.toast('Nothing traced yet'); return; }
    const s = S.widthMm / img.w, pg = ed.doc.page, H = img.h * s, ox = (pg.w - S.widthMm) / 2, oy = (pg.h - H) / 2;
    const shapes = res.loops.map(l => ({ type: 'poly', closed: true, pts: l.pts.map(p => P(+(ox + p.x * s).toFixed(4), +(oy + (img.h - p.y) * s).toFixed(4))) }) as Shape);
    const g = 'g' + (ed.doc.seq++);
    const ids = ed.store.change(() => shapes.map(sh => { const e = ed.store.add(sh); if (shapes.length > 1) e.group = [g]; return e.id; }));
    ed.setSelection(ids); close();
    ed.toast(`Placed ${shapes.length} outline${shapes.length > 1 ? 's' : ''} (${fmt(S.widthMm, 1)} × ${fmt(H, 1)} mm)${shapes.length > 1 ? ' as a group' : ''}`);
  };
  new ResizeObserver(() => res && draw()).observe(cv.parentElement!);
  load(); sync(); run();
}
