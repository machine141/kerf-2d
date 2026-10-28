/** Browser UI: builds the toolbox, option strips, panels and status bar around an Editor. */
import { type Point, P, dist, normA, angOf, polar, fmt, DEG, parseLength, clean, cp, mul, add, sub, len } from '../geometry/vec';
import { prims, lengthOf, boxCentre } from '../geometry/entity';
import { affMove, affScale, affRot } from '../geometry/affine';
import { geomSettings } from '../geometry/entity';
import type { Editor, CoordMode } from '../editor/editor';
import type { OptionSpec, PointerInfo } from '../editor/tool';
import { Renderer } from '../render/renderer';
import { COLORS, WIDTHS, PAGES, newDoc, type Entity, type Shape, type ColorKey } from '../model/types';
import { exportSVG, importSVG } from '../io/svg';
import { exportDXF, importDXF, type DxfOptions } from '../io/dxf';
import { zipOne } from '../io/zip';
import { enterNodeEdit } from '../tools/select';
import { runSelfTest, type TestResult } from '../selftest';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);

export function startUI(ed: Editor) {
  const cv = $<HTMLCanvasElement>('#cv'), R = new Renderer(cv, ed);
  const ui = { tab: 'props', spaceDown: false, lastTest: null as null | { results: TestResult[]; doc: string | null }, exportOpts: { splitArcs: false, includeHidden: false, curveTol: 0.01 } as DxfOptions };
  let DL: any = null;
  (async () => { try { DL = (window as any).claude?.use ? await (window as any).claude.use('downloads') : null; } catch { DL = null; } })();

  // ---------- canvas ----------
  new ResizeObserver(() => { const first = ed.view.W === 800 && ed.view.H === 600; R.resize(); if (first) ed.fit(); R.request(); }).observe(cv);
  const scheme = matchMedia('(prefers-color-scheme: dark)'); scheme.addEventListener('change', () => { R.readColors(); R.request(); });
  new MutationObserver(() => { R.readColors(); R.request(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const evP = (ev: MouseEvent): Point => { const r = cv.getBoundingClientRect(); return P(ev.clientX - r.left, ev.clientY - r.top); };
  const info = (ev: MouseEvent | KeyboardEvent, sp: Point): PointerInfo => ({ sp, shift: ev.shiftKey, alt: ev.altKey, ctrl: ev.ctrlKey || ev.metaKey });
  cv.addEventListener('pointerdown', ev => { cv.setPointerCapture(ev.pointerId); const sp = evP(ev); ed.pointerDown(ed.s2w(sp), ev.button, info(ev, sp), ui.spaceDown); });
  cv.addEventListener('pointermove', ev => { const sp = evP(ev); ed.pointerMove(ed.s2w(sp), info(ev, sp)); cv.style.cursor = ed.tool.id === 'select' ? (ed.tool.cursor?.(ed, sp) || 'default') : 'none'; updateReadout(); });
  cv.addEventListener('pointerup', ev => { const sp = evP(ev); ed.pointerUp(ed.s2w(sp), info(ev, sp)); });
  cv.addEventListener('pointerleave', () => { ed.hover = false; R.request(); });
  cv.addEventListener('dblclick', ev => { const sp = evP(ev); ed.dblclick(ed.s2w(sp), info(ev, sp)); });
  cv.addEventListener('contextmenu', ev => ev.preventDefault());
  cv.addEventListener('wheel', ev => {
    ev.preventDefault(); const sp = evP(ev);
    if (!ev.ctrlKey && ed.wheelTool(((ev.deltaY || ev.deltaX) < 0 ? 1 : -1), info(ev, sp))) { syncOptions(); R.request(); return; }
    const mouseWheel = ev.deltaMode !== 0 || (ev.deltaX === 0 && Math.abs(ev.deltaY) >= 40 && Number.isInteger(ev.deltaY));
    if (ev.ctrlKey || (mouseWheel && !ev.shiftKey)) ed.zoomAt(sp, Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015) * (ev.deltaMode === 1 ? 30 : 1)));
    else { const dx = ev.shiftKey && ev.deltaX === 0 ? ev.deltaY : ev.deltaX, dy = ev.shiftKey && ev.deltaX === 0 ? 0 : ev.deltaY; ed.panBy(dx, dy); }
  }, { passive: false });

  // ---------- change routing ----------
  ed.on(k => {
    if (k === 'view') { R.request(); return; }
    if (k === 'doc') { renderAttr(); renderPane(); syncButtons(); }
    if (k === 'sel') { renderAttr(); if (ui.tab === 'props') renderPane(); }
    if (k === 'tool') { renderToolbox(); renderOptions(); }
    if (k === 'opts') syncOptions();
    if (k === 'aids') { renderToggles(); if (ui.tab === 'aids') renderPane(); }
    updatePrompt(); R.request();
  });
  let toastT: any; ed.onToast(m => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2800); });

  // ---------- toolbox ----------
  function renderToolbox() {
    const nav = $('#tools'); const tools = Object.values(ed.tools); let html = '', g = -1;
    for (const t of tools) { if (g >= 0 && t.group !== g) html += '<div class="sep"></div>'; g = t.group; html += `<button class="tool" data-t="${t.id}" aria-pressed="${t.id === ed.tool.id}" title="${esc(t.label)} (${t.key})" aria-label="${esc(t.label)}"><svg viewBox="0 0 24 24">${t.icon}</svg><kbd>${t.key}</kbd></button>`; }
    nav.innerHTML = html; nav.querySelectorAll<HTMLElement>('.tool').forEach(b => b.onclick = () => ed.setTool(b.dataset.t!));
  }
  // ---------- option strip (generated from tool.options) ----------
  function renderOptions() {
    const t = ed.tool, specs = (t.options || []).filter(o => !o.show || o.show(ed));
    $('#optName').textContent = t.label + (specs.length ? '' : ' · no options');
    $('#toolOpts').innerHTML = specs.map(o => optHTML(o)).join('');
    for (const o of specs) bindOpt(o);
  }
  function optHTML(o: OptionSpec): string {
    const v = ed.opt[o.key];
    if (o.type === 'seg') return `<label>${esc(o.label)} <span class="segc" role="group" data-opt="${o.key}">${o.choices.map(([cv, l]) => `<button type="button" data-v="${cv}" aria-pressed="${String(v) === cv}">${esc(l)}</button>`).join('')}</span></label>`;
    if (o.type === 'number') return `<label>${esc(o.label)} <input type="text" inputmode="decimal" data-opt="${o.key}" value="${esc(String(v ?? ''))}" placeholder="${esc(o.placeholder || '')}">${o.unit ? `<span>${o.unit}</span>` : ''}</label>`;
    if (o.type === 'check') return `<label><input type="checkbox" data-opt="${o.key}" ${v ? 'checked' : ''}> ${esc(o.label)}</label>`;
    if (o.type === 'select') return `<label>${esc(o.label)} <select data-opt="${o.key}">${o.choices.map(([cv, l]) => `<option value="${cv}" ${String(v) === cv ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    if (o.type === 'button') return `<button class="btn" data-opt="${o.key}">${esc(o.label)}</button>`;
    return `<span class="hint">${esc(o.label)}</span>`;
  }
  function bindOpt(o: OptionSpec) {
    const el = document.querySelector<HTMLElement>(`#toolOpts [data-opt="${o.key}"]`); if (!el) return;
    if (o.type === 'seg') el.querySelectorAll<HTMLElement>('button').forEach(b => b.onclick = () => { ed.opt[o.key] = b.dataset.v; renderOptions(); ed.changed('opts'); R.request(); });
    else if (o.type === 'number') { const inp = el as HTMLInputElement; inp.oninput = () => { const v = o.unit === 'mm' ? parseLength(inp.value) : parseFloat(inp.value); if (inp.value.trim() === '') { ed.opt[o.key] = ''; } else if (isFinite(v)) { ed.opt[o.key] = v; if (o.key === 'offD') ed.opt.offFollow = false; } R.request(); }; inp.onkeydown = e => { if (e.key === 'Enter' || e.key === 'Escape') { inp.blur(); syncOptions(); } }; }
    else if (o.type === 'check') (el as HTMLInputElement).onchange = () => { ed.opt[o.key] = (el as HTMLInputElement).checked; R.request(); };
    else if (o.type === 'select') (el as HTMLSelectElement).onchange = () => { ed.opt[o.key] = (el as HTMLSelectElement).value; R.request(); };
    else if (o.type === 'button') el.onclick = () => { o.run(ed); R.request(); };
  }
  function syncOptions() {
    document.querySelectorAll<HTMLInputElement>('#toolOpts input[data-opt]').forEach(i => { const v = ed.opt[i.dataset.opt!]; if (i.type === 'checkbox') i.checked = !!v; else if (document.activeElement !== i) i.value = String(v ?? ''); });
  }

  // ---------- attribute bar ----------
  function renderAttr() {
    const sel = ed.selected(), one = (f: (e: Entity) => any, def: any) => { const v = new Set(sel.map(f)); return sel.length ? (v.size === 1 ? [...v][0] : '') : def; };
    const dash = (cond: boolean) => cond ? '<option value="">—</option>' : '';
    const lv = one(e => e.layer, ed.doc.current), cv2 = one(e => e.color, ed.doc.attrs.color), wv = one(e => e.w, ed.doc.attrs.w);
    $('#aLayer').innerHTML = dash(lv === '') + ed.doc.layers.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join(''); ($('#aLayer') as HTMLSelectElement).value = lv;
    $('#aColor').innerHTML = dash(cv2 === '') + Object.entries(COLORS).map(([k, c]) => `<option value="${k}">${c.label}</option>`).join(''); ($('#aColor') as HTMLSelectElement).value = cv2;
    $('#aWidth').innerHTML = dash(wv === '') + WIDTHS.map(w => `<option value="${w}">${w} mm</option>`).join(''); ($('#aWidth') as HTMLSelectElement).value = String(wv);
  }
  const applyAttr = (key: 'layer' | 'color' | 'w', val: any) => {
    if (ed.sel.size) ed.store.change(() => { for (const e of ed.selected()) (e as any)[key] = val; });
    else { if (key === 'layer') ed.doc.current = val; else (ed.doc.attrs as any)[key] = val; renderAttr(); renderPane(); }
  };
  ($('#aLayer') as HTMLSelectElement).onchange = e => { const v = (e.target as HTMLSelectElement).value; if (v) applyAttr('layer', v); };
  ($('#aColor') as HTMLSelectElement).onchange = e => { const v = (e.target as HTMLSelectElement).value; if (v) applyAttr('color', v as ColorKey); };
  ($('#aWidth') as HTMLSelectElement).onchange = e => { const v = (e.target as HTMLSelectElement).value; if (v) applyAttr('w', +v); };

  // ---------- toggles / prompt / readout ----------
  const TOGGLES: [string, string, () => boolean, () => void][] = [
    ['grid', 'GRID', () => ed.doc.aids.grid.show, () => ed.doc.aids.grid.show = !ed.doc.aids.grid.show],
    ['gridLock', 'GRID LOCK', () => ed.doc.aids.gridLock, () => ed.doc.aids.gridLock = !ed.doc.aids.gridLock],
    ['stepLock', 'STEP', () => ed.doc.aids.stepLock, () => ed.doc.aids.stepLock = !ed.doc.aids.stepLock],
    ['radial', 'RADIAL', () => ed.doc.aids.radial.on, () => ed.doc.aids.radial.on = !ed.doc.aids.radial.on],
    ['attach', 'ATTACH', () => ed.doc.aids.attach.on, () => ed.doc.aids.attach.on = !ed.doc.aids.attach.on],
  ];
  const toggle = (k: string) => { TOGGLES.find(t => t[0] === k)?.[3](); ed.changed('aids'); };
  function renderToggles() { $('#toggles').innerHTML = TOGGLES.map(([k, l, g]) => `<button class="tg" data-k="${k}" aria-pressed="${g()}">${l}</button>`).join(''); $('#toggles').querySelectorAll<HTMLElement>('.tg').forEach(b => b.onclick = () => toggle(b.dataset.k!)); }
  function updatePrompt() { $('#prompt').innerHTML = `<b>${esc(ed.tool.label)}</b>${esc(ed.tool.prompt(ed))}`; }
  function updateReadout() { const r = ed.readout(); $('#readout').innerHTML = `<span>Abs <b>${fmt(r.p.x, 3)}, ${fmt(r.p.y, 3)}</b></span><span>Rel <b>${fmt(r.r.x, 3)}, ${fmt(r.r.y, 3)}</b></span><span>Dist <b>${fmt(r.dist, 3)}</b></span><span>Angle <b>${fmt(r.ang, 2)}°</b></span>`; }

  // ---------- coordinate entry ----------
  const CM: Record<CoordMode, [string, string, string]> = { abs: ['Abs', 'X', 'Y'], rel: ['Rel', 'ΔX', 'ΔY'], pol: ['Pol', 'Dist', 'Angle°'] };
  const setCm = (m: CoordMode) => { ed.cmode = m; const [b, x, y] = CM[m]; $('#cm').textContent = b; $('#laA').textContent = x; $('#laB').textContent = y; };
  function applyCoord() {
    const A = $<HTMLInputElement>('#ca'), B = $<HTMLInputElement>('#cb');
    if (!A.value.trim() && !B.value.trim()) { A.blur(); ed.finish(); return; }
    const a = parseLength(A.value), b = ed.cmode === 'pol' ? parseFloat(B.value) : parseLength(B.value);
    if (!isFinite(a) || !isFinite(b)) { ed.toast('Type two numbers, e.g. 120 Tab 90 Enter (units like 2cm or 1in are fine)'); return; }
    if (ed.typed(ed.cmode, a, b)) { A.value = ''; B.value = ''; A.focus(); updateReadout(); }
  }
  $('#cm').onclick = () => setCm(({ abs: 'rel', rel: 'pol', pol: 'abs' } as const)[ed.cmode]);
  $('#cOk').onclick = applyCoord;
  for (const id of ['#ca', '#cb']) $(id).addEventListener('keydown', (ev: KeyboardEvent) => { if (ev.key === 'Enter') { ev.preventDefault(); applyCoord(); } if (ev.key === 'Escape') (ev.target as HTMLElement).blur(); });

  // ---------- keyboard ----------
  window.addEventListener('keydown', ev => {
    const k = ev.key, tgt = ev.target as HTMLElement, typing = tgt.matches?.('input,select,textarea');
    if (k === 'Shift' || k === 'Alt') { ed.mods = { ...ed.mods, shift: ev.shiftKey, alt: ev.altKey }; if (k === 'Alt' && ed.hover) ev.preventDefault(); R.request(); }
    if (ev.altKey && ['a', 'r', 'p'].includes(k.toLowerCase())) { ev.preventDefault(); setCm(({ a: 'abs', r: 'rel', p: 'pol' } as any)[k.toLowerCase()]); return; }
    if ((ev.ctrlKey || ev.metaKey) && !typing) {
      const c = k.toLowerCase();
      if (c === 'z') { ev.preventDefault(); ev.shiftKey ? ed.store.redo() : ed.store.undo(); }
      else if (c === 'y' || c === 'r') { ev.preventDefault(); ed.store.redo(); }
      else if (c === 'a') { ev.preventDefault(); ed.selectAll(); }
      else if (c === 's') { ev.preventDefault(); saveNative(); }
      else if (c === 'e') { ev.preventDefault(); ed.explodeSel(); }
      return;
    }
    if (typing || !$('#modal').hidden) return;
    const fkeys: Record<string, () => void> = { F3: () => resetRel(), F4: () => toggle('grid'), F5: () => toggle('gridLock'), F6: () => toggle('stepLock'), F7: () => toggle('attach'), F8: () => toggle('radial'), F9: () => ed.setTool('select') };
    if (fkeys[k]) { ev.preventDefault(); fkeys[k](); return; }
    if (k === ' ') { ev.preventDefault(); if (!ui.spaceDown) resetRel(); ui.spaceDown = true; return; }
    if (ed.tool.onKey?.(ed, k, { shift: ev.shiftKey, alt: ev.altKey, ctrl: ev.ctrlKey })) { ev.preventDefault(); return; }
    if (/^[0-9.\-]$/.test(k) && ed.tool.draws) { ev.preventDefault(); const A = $<HTMLInputElement>('#ca'); A.value = k; A.focus(); return; }
    if (/^[0-9.]$/.test(k) && ed.tool.id === 'offset') { const i = document.querySelector<HTMLInputElement>('#toolOpts [data-opt="offD"]'); if (i) { ev.preventDefault(); i.value = k; i.focus(); } return; }
    if (k === 'Escape') { ed.cancel(); return; }
    if (k === 'Enter') { ed.finish(); return; }
    if (k === 'Delete' || k === 'Backspace') { ed.deleteSel(); return; }
    if (k.toUpperCase() === 'F' && !ev.altKey) { ed.fit(); return; }
    if (k.toUpperCase() === 'G') { toggle('gridLock'); return; }
    if (k.toUpperCase() === 'S') { toggle('stepLock'); return; }
    const t = Object.values(ed.tools).find(x => x.key === k.toUpperCase()); if (t) ed.setTool(t.id);
  });
  window.addEventListener('keyup', ev => { if (ev.key === ' ') ui.spaceDown = false; if (ev.key === 'Shift' || ev.key === 'Alt') { ed.mods = { ...ed.mods, shift: ev.shiftKey, alt: ev.altKey }; R.request(); } });
  function resetRel() { ed.rel = ed.cursorPoint(); updateReadout(); ed.toast('Relative origin reset'); }

  // ---------- files ----------
  const base = () => (ed.doc.name || 'drawing').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'drawing';
  async function saveFile(name: string, text: string) {
    if (DL) {
      let fname = name, data: any = text;
      if (/\.dxf$/i.test(name)) { data = zipOne(name, text); fname = name.replace(/\.dxf$/i, '') + '-dxf.zip'; }
      try { await DL.save({ filename: fname, data }); ed.toast('Saved ' + fname); } catch (e: any) { ed.toast(e?.code === 'declined' ? 'Save cancelled' : 'Saving is not available here — use Copy text'); }
      return;
    }
    try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' })); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); ed.toast('Downloaded ' + name); }
    catch { ed.toast('Saving is not available here — use Copy text'); }
  }
  function showExport(kind: 'svg' | 'dxf') {
    const build = () => kind === 'svg' ? exportSVG(ed.doc, ui.exportOpts) : exportDXF(ed.doc, ui.exportOpts);
    const name = base() + '.' + kind, refresh = () => { const t = build(); $<HTMLTextAreaElement>('#mText').value = t; $('#mSave').onclick = () => saveFile(name, t); $('#mCopy').onclick = async () => { try { await navigator.clipboard.writeText(t); ed.toast('Copied'); } catch { $<HTMLTextAreaElement>('#mText').select(); ed.toast('Text selected — press Ctrl+C'); } }; };
    $('#mTitle').textContent = kind === 'svg' ? 'Export SVG (mm)' : 'Export DXF (R12, mm)';
    const n = ed.doc.ents.filter(e => ed.store.visible(e) || ui.exportOpts.includeHidden).length;
    $('#mHint').textContent = `${ed.doc.page.w} × ${ed.doc.page.h} mm · ${n} objects` + (kind === 'dxf' && DL ? ' · saved as a .zip containing the .dxf' : '');
    $('#mOpts').innerHTML = `<label class="chk"><input type="checkbox" id="xHidden" ${ui.exportOpts.includeHidden ? 'checked' : ''}> Include hidden layers</label>` +
      (kind === 'dxf' ? `<label class="chk"><input type="checkbox" id="xSplit" ${ui.exportOpts.splitArcs ? 'checked' : ''}> Split arcs &amp; circles into lines</label><label class="chk">Curve tolerance <input type="text" id="xTol" value="${ui.exportOpts.curveTol}" style="width:60px" class="mono"> mm</label>` : '');
    const rebind = () => { ui.exportOpts.includeHidden = $<HTMLInputElement>('#xHidden').checked; if (kind === 'dxf') { ui.exportOpts.splitArcs = $<HTMLInputElement>('#xSplit').checked; const t = parseLength($<HTMLInputElement>('#xTol').value); if (t > 0) ui.exportOpts.curveTol = t; } refresh(); };
    $('#mOpts').querySelectorAll('input').forEach(i => i.addEventListener('change', rebind));
    refresh(); $('#modal').hidden = false;
  }
  $('#mClose').onclick = () => { $('#modal').hidden = true; };
  $('#modal').addEventListener('click', ev => { if ((ev.target as HTMLElement).id === 'modal') $('#modal').hidden = true; });
  const saveNative = () => saveFile(base() + '.json', JSON.stringify(ed.doc, null, 1));
  $('#bSave').onclick = saveNative; $('#bSvg').onclick = () => showExport('svg'); $('#bDxf').onclick = () => showExport('dxf');
  $('#bOpen').onclick = () => $('#fileIn').click();
  $<HTMLInputElement>('#fileIn').onchange = async ev => {
    const inp = ev.target as HTMLInputElement, f = inp.files?.[0]; if (!f) return; const text = await f.text(); inp.value = '';
    try {
      if (/\.json$/i.test(f.name)) { const d = JSON.parse(text); if (!d.ents || !d.page) throw new Error('Not a Kerf 2D drawing'); ed.sel.clear(); ed.store.load(d); ($('#docName') as HTMLInputElement).value = ed.doc.name; ed.fit(); ed.toast('Opened ' + f.name); }
      else loadImported(/\.dxf$/i.test(f.name) ? importDXF(text) : importSVG(text), f.name);
    } catch (e: any) { ed.toast('Could not open ' + f.name + ': ' + e.message); }
  };
  function loadImported(ents: any[], src: string) {
    const ACI = Object.fromEntries(Object.entries(COLORS).map(([k, c]) => [c.aci, k]));
    ed.store.change(() => { for (const e of ents) {
      let L = ed.doc.layers.find(l => l.name.toUpperCase() === String(e.layer).toUpperCase());
      if (!L) { L = { id: 'L' + (ed.doc.seq++), name: e.layer, visible: true, active: true }; ed.doc.layers.push(L); }
      const { aci, ...rest } = e; ed.store.add({ ...rest, layer: L.id, color: e.color || ACI[aci] || 'ink' } as Shape);
    } });
    ed.toast(`Imported ${ents.length} objects from ${src}`);
  }
  $('#bNew').onclick = () => { const d = newDoc(); d.page = { ...ed.doc.page }; d.aids = structuredClone(ed.doc.aids); ed.sel.clear(); ed.store.load(d); ($('#docName') as HTMLInputElement).value = d.name; ed.fit(); };
  $('#bUndo').onclick = () => ed.store.undo(); $('#bRedo').onclick = () => ed.store.redo(); $('#bFit').onclick = () => ed.fit();
  ($('#docName') as HTMLInputElement).onchange = ev => { ed.doc.name = (ev.target as HTMLInputElement).value; };
  function syncButtons() { ($('#bUndo') as HTMLButtonElement).disabled = !ed.store.canUndo; ($('#bRedo') as HTMLButtonElement).disabled = !ed.store.canRedo; }

  // ---------- side panel ----------
  document.querySelectorAll<HTMLElement>('.tabs button').forEach(b => b.onclick = () => { ui.tab = b.dataset.tab!; document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', String(x === b))); renderPane(); });
  let fid = 0;
  type Field = { html: string; id: string; set: (v: number) => void; unit?: boolean };
  const numField = (label: string, val: number, set: (v: number) => void, unit = true): Field => { const id = 'f' + (++fid); return { id, set, unit, html: `<label for="${id}">${label}</label><input type="text" inputmode="decimal" id="${id}" value="${fmt(val, 6)}">` }; };
  const bindFields = (fields: Field[]) => { for (const f of fields) $(`#${f.id}`).onchange = (ev: Event) => { const t = (ev.target as HTMLInputElement).value, v = f.unit ? parseLength(t) : parseFloat(t); if (!isFinite(v)) { renderPane(); return; } ed.store.change(() => f.set(v)); }; };
  function sizeBlock(): { html: string; fields: Field[] } {
    const b = ed.selBox(); if (!b) return { html: '', fields: [] };
    const F: Field[] = [numField('X', b.x0, v => { const bb = ed.selBox()!; ed.transformSel(affMove(P(v - bb.x0, 0))); }), numField('Y', b.y0, v => { const bb = ed.selBox()!; ed.transformSel(affMove(P(0, v - bb.y0))); })];
    const lock = ed.opt.lockAspect;
    if (b.x1 - b.x0 > 1e-9) F.push(numField('Width', b.x1 - b.x0, v => { const bb = ed.selBox()!, w = bb.x1 - bb.x0, h = bb.y1 - bb.y0, s = v / w; ed.transformSel(affScale(P(bb.x0, bb.y0), s, lock && h > 1e-9 ? s : 1)); }));
    if (b.y1 - b.y0 > 1e-9) F.push(numField('Height', b.y1 - b.y0, v => { const bb = ed.selBox()!, w = bb.x1 - bb.x0, h = bb.y1 - bb.y0, s = v / h; ed.transformSel(affScale(P(bb.x0, bb.y0), lock && w > 1e-9 ? s : 1, s)); }));
    return { fields: F, html: `<h3>Size &amp; position</h3><div class="grid2">${F.map(f => f.html).join('')}</div>
      <div class="row"><label class="chk"><input type="checkbox" id="pLock" ${lock ? 'checked' : ''}>Keep proportions</label></div>
      <div class="row"><span class="hint">Rotate by</span><input type="text" id="pRot" value="90" style="width:60px" class="mono"><span class="hint">°</span><button class="btn" id="pRotGo">Rotate</button><button class="btn" id="pFlipH">Flip ↔</button><button class="btn" id="pFlipV">Flip ↕</button></div>` };
  }
  function bindSize() {
    const lk = document.querySelector<HTMLInputElement>('#pLock'); if (lk) lk.onchange = () => { ed.opt.lockAspect = lk.checked; };
    const go = document.querySelector<HTMLElement>('#pRotGo'); if (go) go.onclick = () => { const b = ed.selBox(), t = parseFloat($<HTMLInputElement>('#pRot').value) * DEG; if (!b || !isFinite(t)) return; ed.store.change(() => ed.transformSel(affRot(boxCentre(b), t))); };
    const fh = document.querySelector<HTMLElement>('#pFlipH'); if (fh) fh.onclick = () => ed.flipSel('h');
    const fv = document.querySelector<HTMLElement>('#pFlipV'); if (fv) fv.onclick = () => ed.flipSel('v');
  }
  function renderPane() {
    const pane = $('#pane'), t = ui.tab;
    if (t === 'props') {
      const sel = ed.selected();
      if (!sel.length) {
        pane.innerHTML = `<h3>Nothing selected</h3><p class="hint">Click a shape to see its handles and exact sizes. Double-click a shape to edit its points.</p>
          <h3>Drawing</h3><div class="grid2"><label>Objects</label><span class="mono">${ed.doc.ents.length}</span><label>Page</label><span class="mono">${ed.doc.page.w} × ${ed.doc.page.h} mm</span><label>Units</label><span class="mono">mm (type 2cm or 1in if you like)</span></div>
          <h3>Keys</h3><p class="hint">Type numbers at any prompt to enter coordinates · Alt+A / R / P switch Abs, Rel, Pol · Space or F3 resets the relative origin · Backspace removes the last point · F4 grid · F5 grid lock · F6 step · F7 attach · F8 radial · Esc cancels · wheel zooms, Shift+wheel or middle-drag pans.</p>`;
        return;
      }
      const sz = sizeBlock();
      if (sel.length > 1) {
        const types: Record<string, number> = {}; sel.forEach(e => types[e.type] = (types[e.type] || 0) + 1);
        pane.innerHTML = `<h3>${sel.length} objects selected</h3><p class="hint">${Object.entries(types).map(([k, v]) => `${v} × ${k}`).join(', ')}</p>${sz.html}<div class="row"><button class="btn" id="pExplode">Explode</button><button class="btn" id="pDel">Delete</button></div>`;
        bindFields(sz.fields); bindSize(); $('#pExplode').onclick = () => ed.explodeSel(); $('#pDel').onclick = () => ed.deleteSel(); return;
      }
      const e: any = sel[0], F: Field[] = [];
      const pt = (lbl: string, k: string) => { F.push(numField(lbl + ' X', e[k].x, v => { (ed.store.byId(e.id) as any)[k] = P(v, e[k].y); })); F.push(numField(lbl + ' Y', e[k].y, v => { (ed.store.byId(e.id) as any)[k] = P(e[k].x, v); })); };
      let title: string = e.type, extra = '';
      const live = () => ed.store.byId(e.id) as any;
      if (e.type === 'line') { title = 'Line'; pt('Start', 'a'); pt('End', 'b');
        F.push(numField('Length', dist(e.a, e.b), v => { const x = live(), u = sub(x.b, x.a), L = len(u) || 1; x.b = cp(add(x.a, mul(u, v / L))); }));
        F.push(numField('Angle °', normA(angOf(e.a, e.b)) / DEG, v => { const x = live(); x.b = cp(polar(x.a, dist(x.a, x.b), v * DEG)); }, false)); }
      else if (e.type === 'circle') { title = 'Circle'; pt('Centre', 'c'); F.push(numField('Radius', e.r, v => live().r = Math.abs(v))); F.push(numField('Diameter', e.r * 2, v => live().r = Math.abs(v) / 2)); }
      else if (e.type === 'ellipse') { title = 'Ellipse'; pt('Centre', 'c'); F.push(numField('Width', e.rx * 2, v => live().rx = Math.abs(v) / 2)); F.push(numField('Height', e.ry * 2, v => live().ry = Math.abs(v) / 2)); F.push(numField('Rotation °', normA(e.rot) / DEG, v => live().rot = normA(v * DEG), false)); }
      else if (e.type === 'arc') { title = 'Arc'; pt('Centre', 'c'); F.push(numField('Radius', e.r, v => live().r = Math.abs(v)));
        F.push(numField('Start °', normA(e.a0) / DEG, v => live().a0 = normA(v * DEG), false)); F.push(numField('End °', normA(e.a1) / DEG, v => live().a1 = normA(v * DEG), false));
        extra = `<p class="hint">Arc length ${fmt(lengthOf(e), 3)} mm · runs anticlockwise from start to end</p>`; }
      else if (e.type === 'poly') { title = e.closed ? 'Closed path' : 'Path';
        if (e.pts.length <= 24) e.pts.forEach((p: Point, i: number) => { F.push(numField(`P${i + 1} X`, p.x, v => { const x = live(); x.pts[i] = P(v, x.pts[i].y); })); F.push(numField(`P${i + 1} Y`, p.y, v => { const x = live(); x.pts[i] = P(x.pts[i].x, v); })); });
        extra = `<p class="hint">${e.closed ? 'Perimeter' : 'Length'} ${fmt(lengthOf(e), 3)} mm · ${e.pts.length} points${e.pts.length > 24 ? ' (edit points on the drawing)' : ''}</p><div class="row"><button class="btn" id="pExplode">Explode to lines</button></div>`; }
      else if (e.type === 'dim') { title = 'Dimension'; pt('Point 1', 'p1'); pt('Point 2', 'p2'); extra = `<div class="grid2"><label for="dTxt">Text override</label><input type="text" id="dTxt" value="${esc(e.text || '')}" placeholder="${esc(fmt(ed.dimGeom(e).val, ed.doc.dim.dec))}"></div>`; }
      pane.innerHTML = `<h3>${title}</h3><div class="grid2">${F.map(f => f.html).join('')}</div>${extra}
        <div class="row"><button class="btn" id="pNodes">${ed.state.node ? 'Finish editing points' : 'Edit points'}</button></div>${sz.html}
        <p class="hint">Layer ${esc(ed.store.layer(e.layer)?.name || '?')} · ${COLORS[e.color as ColorKey]?.label || e.color} · ${e.w} mm</p>`;
      bindFields(F.concat(sz.fields)); bindSize();
      document.querySelector<HTMLElement>('#pExplode')?.addEventListener('click', () => ed.explodeSel());
      $('#pNodes').onclick = () => { if (ed.state.node) { ed.state.node = null; ed.changed('prompt'); renderPane(); } else { ed.setTool('select'); enterNodeEdit(ed, e); } };
      document.querySelector<HTMLInputElement>('#dTxt')?.addEventListener('change', ev => ed.store.change(() => { live().text = (ev.target as HTMLInputElement).value; }));
    } else if (t === 'layers') {
      pane.innerHTML = `<h3>Layers</h3><p class="hint">Only one layer is current. Hidden layers are left out of exports unless you tick "Include hidden layers". Inactive layers can't be selected.</p><div id="lyr"></div><div class="row"><button class="btn" id="lAdd">Add layer</button></div>`;
      $('#lyr').innerHTML = ed.doc.layers.map(l => `<div class="layer ${l.id === ed.doc.current ? 'cur' : ''}" data-id="${l.id}">
        <input type="radio" name="cur" aria-label="Make current" ${l.id === ed.doc.current ? 'checked' : ''}>
        <input type="text" value="${esc(l.name)}" aria-label="Layer name">
        <label class="mini"><input type="checkbox" data-f="visible" ${l.visible ? 'checked' : ''}>Show</label>
        <label class="mini"><input type="checkbox" data-f="active" ${l.active ? 'checked' : ''}>Active</label>
        <button class="x" aria-label="Delete layer" title="Delete layer (must be empty)">✕</button></div>`).join('');
      $('#lyr').querySelectorAll<HTMLElement>('.layer').forEach(row => {
        const L = ed.store.layer(row.dataset.id!)!;
        row.querySelector<HTMLInputElement>('[type=radio]')!.onchange = () => { ed.doc.current = L.id; renderPane(); renderAttr(); };
        row.querySelector<HTMLInputElement>('[type=text]')!.onchange = ev => { L.name = (ev.target as HTMLInputElement).value || L.name; renderAttr(); };
        row.querySelectorAll<HTMLInputElement>('[data-f]').forEach(c => c.onchange = () => { (L as any)[c.dataset.f!] = c.checked; ed.store.emit(); });
        row.querySelector<HTMLElement>('.x')!.onclick = () => { if (ed.doc.layers.length < 2 || ed.doc.ents.some(e => e.layer === L.id)) return ed.toast('Only empty layers can be deleted'); ed.doc.layers = ed.doc.layers.filter(x => x !== L); if (ed.doc.current === L.id) ed.doc.current = ed.doc.layers[0].id; renderPane(); renderAttr(); };
      });
      $('#lAdd').onclick = () => { const id = 'L' + (ed.doc.seq++); ed.doc.layers.push({ id, name: 'Layer ' + ed.doc.layers.length, visible: true, active: true }); ed.doc.current = id; renderPane(); renderAttr(); };
    } else if (t === 'aids') {
      const A = ed.doc.aids, pg = ed.doc.page, at = A.attach;
      pane.innerHTML = `<h3>Page / material</h3><div class="grid2">
        <label for="sPre">Size</label><select id="sPre">${Object.entries(PAGES).map(([k, v]) => `<option value="${k}">${v[2]}</option>`).join('')}</select>
        <label for="sW">Width mm</label><input type="text" id="sW" value="${pg.w}"><label for="sH">Height mm</label><input type="text" id="sH" value="${pg.h}"></div>
        <h3>Grid &amp; locks</h3><div class="grid2">
        <label for="sG">Grid spacing</label><input type="text" id="sG" value="${A.grid.spacing}">
        <label for="sSt">Step size</label><input type="text" id="sSt" value="${A.step}">
        <label for="sRs">Radial start °</label><input type="text" id="sRs" value="${A.radial.start}">
        <label for="sRp">Radial step °</label><input type="text" id="sRp" value="${A.radial.step}"></div>
        <h3>Attach (snap to)</h3><div class="row">${[['end', 'Endpoints'], ['mid', 'Midpoints'], ['centre', 'Centres'], ['quad', 'Quadrants'], ['inter', 'Intersections'], ['nearest', 'Nearest'], ['perp', 'Perpendicular'], ['tangent', 'Tangent']].map(([k, l]) => `<label class="chk"><input type="checkbox" data-a="${k}" ${(at as any)[k] ? 'checked' : ''}>${l}</label>`).join('')}</div>
        <div class="grid2"><label for="sBox">Target box px</label><input type="text" id="sBox" value="${at.box}"></div>
        <h3>Dimensions</h3><div class="grid2"><label for="sDd">Decimals</label><input type="text" id="sDd" value="${ed.doc.dim.dec}"><label for="sDh">Text height mm</label><input type="text" id="sDh" value="${ed.doc.dim.textH}"></div>
        <h3>Accuracy</h3><div class="grid2"><label for="sTol">Curve tolerance</label><input type="text" id="sTol" value="${geomSettings.flatTol}"></div>
        <p class="hint">Curve tolerance is how closely contours follow curves (mm). Smaller is more accurate but makes bigger files. These settings, except tolerance, are saved with the drawing.</p>`;
      ($('#sPre') as HTMLSelectElement).value = pg.preset || 'CUSTOM';
      const num = (id: string, f: (v: number) => void, unit = true) => { $(`#${id}`).onchange = (ev: Event) => { const t2 = (ev.target as HTMLInputElement).value, v = unit ? parseLength(t2) : parseFloat(t2); if (isFinite(v)) { f(v); ed.changed('view'); } }; };
      ($('#sPre') as HTMLSelectElement).onchange = ev => { const k = (ev.target as HTMLSelectElement).value, v = PAGES[k]; pg.preset = k; if (v[0]) { pg.w = v[0]; pg.h = v[1]; } renderPane(); ed.fit(); };
      num('sW', v => { pg.w = Math.max(1, v); pg.preset = 'CUSTOM'; ed.fit(); }); num('sH', v => { pg.h = Math.max(1, v); pg.preset = 'CUSTOM'; ed.fit(); });
      num('sG', v => A.grid.spacing = Math.max(0.1, v)); num('sSt', v => A.step = Math.max(0.01, v));
      num('sRs', v => A.radial.start = v, false); num('sRp', v => A.radial.step = Math.max(0.1, v), false);
      num('sBox', v => at.box = Math.max(4, v), false); num('sDd', v => ed.doc.dim.dec = Math.min(6, Math.max(0, Math.round(v))), false); num('sDh', v => ed.doc.dim.textH = Math.max(0.5, v));
      num('sTol', v => { geomSettings.flatTol = Math.min(0.1, Math.max(0.0001, v)); });
      pane.querySelectorAll<HTMLInputElement>('[data-a]').forEach(c => c.onchange = () => { (at as any)[c.dataset.a!] = c.checked; });
    } else if (t === 'test') {
      pane.innerHTML = `<h3>Accuracy self-test</h3><p class="hint">Runs real tool workflows in a separate, hidden drawing and measures the results: typed coordinates, rectangle and circle modes, trimming, rotate with repeats, snapping (incl. tangent and perpendicular), contours (incl. an area bounded by crossing lines), the glasses and key-ring examples, handles, point editing, dimensions, undo, and SVG/DXF round trips.</p>
        <div class="row"><button class="btn primary" id="tRun">Run test</button><button class="btn" id="tShow" ${ui.lastTest?.doc ? '' : 'disabled'}>Open test drawing</button></div><div id="tOut"></div>`;
      $('#tRun').onclick = () => { ui.lastTest = runSelfTest(); renderPane(); };
      $('#tShow').onclick = () => { if (!ui.lastTest?.doc) return; ed.sel.clear(); ed.store.load(JSON.parse(ui.lastTest.doc)); ($('#docName') as HTMLInputElement).value = ed.doc.name; ed.fit(); };
      if (ui.lastTest) {
        const r = ui.lastTest.results, pass = r.every(x => x.ok);
        $('#tOut').innerHTML = `<div class="summary"><span class="pill ${pass ? 'ok' : 'bad'}">${pass ? 'ALL PASS' : 'FAILURES'}</span> ${r.filter(x => x.ok).length} of ${r.length} checks</div>
          <table class="res">${r.map(x => `<tr><td>${esc(x.name)}<br><span class="hint mono">${esc(x.detail)}</span></td><td><span class="pill ${x.ok ? 'ok' : 'bad'}">${x.ok ? 'pass' : 'fail'}</span></td></tr>`).join('')}</table>`;
      }
    }
  }

  // ---------- boot ----------
  setCm('abs'); renderToolbox(); renderOptions(); renderAttr(); renderToggles(); renderPane(); updatePrompt(); syncButtons(); updateReadout();
  R.resize(); ed.fit();
  return { R, ui };
}
export { clean, prims };
