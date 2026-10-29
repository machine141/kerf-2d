/** Browser UI: builds the toolbox, option strips, panels and status bar around an Editor. */
import { type Point, P, dist, normA, angOf, polar, fmt, DEG, parseLength, clean, cp, mul, add, sub, len } from '../geometry/vec';
import { prims, lengthOf, boxCentre } from '../geometry/entity';
import { affMove, affScale, affRot } from '../geometry/affine';
import { geomSettings } from '../geometry/entity';
import type { BoolOp } from '../geometry/boolean';
import { openTrace } from './trace';
import { openElements, saveSelectionAsElement } from './elements';
import { helpHtml, GUIDES } from './help';
import { openNest } from './nest';
import { openHandIn, openClassLoad, openClassList } from './classroom';
import { sheetDoc } from '../io/sheets';
import { openBox } from './box';
import { openHinge } from './hinge';
import { openBend } from './profile';
import { DEFAULT_OPTS, type Editor, type CoordMode } from '../editor/editor';
import type { OptionSpec, PointerInfo } from '../editor/tool';
import { Renderer } from '../render/renderer';
import { COLORS, WIDTHS, PAGES, MODE_LABEL, modeOf, colorLabel, newDoc, type Entity, type Shape, type ColorKey, type LaserMode, type TextEnt as TextEntT } from '../model/types';
import { exportSVG, importSVG } from '../io/svg';
import { exportDXF, importDXF, type DxfOptions } from '../io/dxf';
import { zipOne } from '../io/zip';
import { enterNodeEdit } from '../tools/select';
import { isText, editTexts, flipText, optsFromText } from '../tools/text';
import { cssFont } from './textedit';
import { textShapes } from '../text/text';
import { weldShapes } from '../text/place';
import { simplifyShape, deviation, smoothNode, cornerNode } from '../geometry/fitcurve';
import { softenPreview, applySoften } from '../tools/smooth';
import { FONTS, FONT_GROUPS } from '../text/fonts';
import { runSelfTest, type TestResult } from '../selftest';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);

export function startUI(ed: Editor) {
  const cv = $<HTMLCanvasElement>('#cv'), R = new Renderer(cv, ed);
  const prefs = loadPrefs(); if (prefs.joinTol != null) ed.opt.joinTol = prefs.joinTol; if (prefs.pickPx != null) ed.opt.pickPx = prefs.pickPx;
  const ui = { soft: 50, softC: 'both', simp: 35, helpShow: null as string | null, alignTo: 'sel' as 'sel' | 'page', ptsOpen: false, tab: 'props', spaceDown: false, lastTest: null as null | { results: TestResult[]; doc: string | null }, exportOpts: { splitArcs: false, includeHidden: false, curveTol: 0.01, skipDims: true } as DxfOptions };
  let DL: any = null;
  // ---------- typing text: the box is in the Properties panel; the drawing changes as you type ----------
  /** The text being typed into (one undo step from first key to finishing). */
  let typing: { id: string; isNew: boolean; pushed: boolean } | null = null;
  function finishTyping() {
    const s = typing; typing = null; ed.state.typing = null; if (!s) return;
    const t = ed.store.byId(s.id) as TextEntT | undefined; if (!t) return;
    if (!t.text.trim()) {
      if (s.isNew) { ed.store.remove([s.id]); ed.store.discardCheckpoint(); } else { if (!s.pushed) ed.store.checkpoint(); ed.store.remove([s.id]); }
      ed.toast('Empty text removed'); ed.store.emit(); return;
    }
    if (s.pushed) ed.store.emit();
  }
  ed.textEditor = (id, isNew) => {
    if (typing && typing.id !== id) finishTyping();
    typing = { id, isNew, pushed: isNew };
    if (ui.tab !== 'props') { ui.tab = 'props'; document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', String((x as HTMLElement).dataset.tab === 'props'))); }
    renderPane();
    // focus straight away, so typing can start at once; the click's own mousedown is told not to take focus back
    const ta = document.querySelector<HTMLTextAreaElement>('#pTxt'); if (!ta) return;
    ta.focus(); if (isNew) ta.select(); else ta.setSelectionRange(ta.value.length, ta.value.length);
    keepFocus = true; setTimeout(() => { keepFocus = false; }, 300);
    if (matchMedia('(max-width: 900px)').matches) ta.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  let keepFocus = false;
  cv.addEventListener('mousedown', ev => { if (keepFocus) { ev.preventDefault(); keepFocus = false; } });
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
    // Wheel zooms at the pointer (pinch = ctrlKey also zooms). Shift+wheel pans; the "Two-finger pan" setting makes scrolling pan.
    const unit = ev.deltaMode === 1 ? 30 : ev.deltaMode === 2 ? 300 : 1;
    if (ev.ctrlKey || (!ev.shiftKey && !prefs.wheelPans)) {
      const dy = Math.max(-200, Math.min(200, (ev.deltaY || ev.deltaX) * unit));
      ed.zoomAt(sp, Math.exp(-dy * (ev.ctrlKey ? 0.01 : 0.002)));
    } else { const dx = ev.shiftKey && ev.deltaX === 0 ? ev.deltaY : ev.deltaX, dy = ev.shiftKey && ev.deltaX === 0 ? 0 : ev.deltaY; ed.panBy(dx * unit, dy * unit); }
  }, { passive: false });

  // ---------- mouse wheel on a focused number box nudges its value ----------
  const NUMERIC = /^\s*-?(\d+\.?\d*|\.\d+)\s*(mm|cm|in|°|%)?\s*$/i;
  const changeT = new WeakMap<HTMLInputElement, number>();
  document.addEventListener('wheel', ev => {
    const el = ev.target as HTMLInputElement;
    if (!(el instanceof HTMLInputElement) || el.type !== 'text' || document.activeElement !== el || !NUMERIC.test(el.value || '0')) return;
    ev.preventDefault();
    const base = parseFloat(el.dataset.step || '') || (/^\s*-?\d+\s*$/.test(el.value) || !el.value ? 1 : 1), step = ev.shiftKey ? base / 10 : ev.altKey ? base * 10 : base;
    const dir = (ev.deltaY || ev.deltaX) < 0 ? 1 : -1, cur = parseFloat(el.value) || 0, dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    let v = +(Math.round((cur + dir * step) / step) * step).toFixed(dec);
    if (el.dataset.min != null) v = Math.max(+el.dataset.min, v); if (el.dataset.max != null) v = Math.min(+el.dataset.max, v);
    el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true }));
    clearTimeout(changeT.get(el)); changeT.set(el, window.setTimeout(() => el.dispatchEvent(new Event('change', { bubbles: true })), 300));
  }, { passive: false, capture: true });

  // ---------- change routing ----------
  ed.on(k => {
    if (k === 'view') { R.request(); return; }
    if (k === 'doc') { ed.state.simp = null; renderAttr(); renderPane(); syncButtons(); }
    if (k === 'prompt' && ui.tab === 'props' && ed.state.node) renderPane();
    if (k === 'sel') { ed.state.simp = null;
      renderAttr(); if (ui.tab === 'props') renderPane();
      if (ed.tool.id === 'select') { const st = ed.selected(); if (st.length && st.every(isText)) optsFromText(ed, st[0] as TextEntT); renderOptions(); }
    }
    if (k === 'tool') { renderToolbox(); renderOptions(); ui.helpShow = null; if (ui.tab === 'help') renderPane(); coach(); }
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
  /** Re-render the options strip if some options depend on others (keeps the focused box focused). */
  function refreshOptions() {
    if (!(ed.tool.options || []).some(o => o.show)) return;
    const k = (document.activeElement as HTMLElement | null)?.dataset?.opt;
    renderOptions();
    if (k) { const el = document.querySelector<HTMLInputElement>(`#toolOpts [data-opt="${k}"]`); if (el && el.type !== 'checkbox') { el.focus(); const n = el.value.length; try { el.setSelectionRange(n, n); } catch { /* ignore */ } } }
  }
  function renderOptions() {
    const t = ed.tool, specs = (t.options || []).filter(o => !o.show || o.show(ed));
    $('#optName').textContent = t.id === 'select' && specs.length ? 'Text' : t.label + (specs.length ? '' : ' · no options');
    $('#toolOpts').innerHTML = specs.map(o => optHTML(o)).join('');
    for (const o of specs) bindOpt(o);
  }
  function optHTML(o: OptionSpec): string {
    const v = ed.opt[o.key];
    if (o.type === 'seg') return `<label>${esc(o.label)} <span class="segc" role="group" data-opt="${o.key}">${o.choices.map(([cv, l]) => `<button type="button" data-v="${cv}" aria-pressed="${String(v) === cv}">${esc(l)}</button>`).join('')}</span></label>`;
    if (o.type === 'number') return `<label>${esc(o.label)} <input type="text" inputmode="decimal" data-opt="${o.key}" data-step="${o.step ?? 1}"${o.min != null ? ` data-min="${o.min}"` : ''}${o.max != null ? ` data-max="${o.max}"` : ''} value="${esc(String(v ?? ''))}" placeholder="${esc(o.placeholder || '')}">${o.unit ? `<span>${o.unit}</span>` : ''}</label>`;
    if (o.type === 'check') return `<label><input type="checkbox" data-opt="${o.key}" ${v ? 'checked' : ''}> ${esc(o.label)}</label>`;
    if (o.type === 'select') return `<label>${esc(o.label)} <select data-opt="${o.key}">${o.choices.map(([cv, l]) => `<option value="${cv}" ${String(v) === cv ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    if (o.type === 'button') return `<button class="btn" data-opt="${o.key}">${esc(o.label)}</button>`;
    if (o.type === 'swatch') return `<label>${esc(o.label)} <span class="segc swatches" role="group" data-opt="${o.key}">${o.choices.map(([cv, l, fill, edge]) => `<button type="button" data-v="${cv}" aria-pressed="${String(v) === cv}" style="--sw:${fill};--swe:${edge}"><i></i>${esc(l)}</button>`).join('')}</span></label>`;
    return `<span class="hint">${esc(o.label)}</span>`;
  }
  function bindOpt(o: OptionSpec) {
    const el = document.querySelector<HTMLElement>(`#toolOpts [data-opt="${o.key}"]`); if (!el) return;
    const told = () => ed.tool.onOpt?.(ed, o.key);
    if (o.type === 'seg' || o.type === 'swatch') el.querySelectorAll<HTMLElement>('button').forEach(b => b.onclick = () => { ed.opt[o.key] = b.dataset.v; told(); renderOptions(); ed.changed('opts'); R.request(); });
    else if (o.type === 'number') { const inp = el as HTMLInputElement; inp.oninput = () => { const v = o.unit === 'mm' ? parseLength(inp.value) : parseFloat(inp.value); if (inp.value.trim() === '') { ed.opt[o.key] = ''; } else if (isFinite(v)) { ed.opt[o.key] = v; if (o.key === 'offD') ed.opt.offFollow = false; told(); } R.request(); }; inp.onkeydown = e => { if (e.key === 'Enter' || e.key === 'Escape') { inp.blur(); syncOptions(); } }; inp.onchange = () => refreshOptions(); }
    else if (o.type === 'check') (el as HTMLInputElement).onchange = () => { ed.opt[o.key] = (el as HTMLInputElement).checked; told(); refreshOptions(); R.request(); };
    else if (o.type === 'select') (el as HTMLSelectElement).onchange = () => { ed.opt[o.key] = (el as HTMLSelectElement).value; told(); R.request(); };
    else if (o.type === 'button') el.onclick = () => { o.run(ed); R.request(); };
  }
  function syncOptions() {
    document.querySelectorAll<HTMLInputElement>('#toolOpts input[data-opt]').forEach(i => { const v = ed.opt[i.dataset.opt!]; if (i.type === 'checkbox') i.checked = !!v; else if (document.activeElement !== i) i.value = String(v ?? ''); });
    document.querySelectorAll<HTMLSelectElement>('#toolOpts select[data-opt]').forEach(i => { i.value = String(ed.opt[i.dataset.opt!] ?? ''); });
    document.querySelectorAll<HTMLElement>('#toolOpts .segc[data-opt]').forEach(g => g.querySelectorAll<HTMLElement>('button').forEach(b => b.setAttribute('aria-pressed', String(String(ed.opt[g.dataset.opt!]) === b.dataset.v))));
  }

  // ---------- attribute bar ----------
  function renderAttr() {
    const sel = ed.selected(), one = (f: (e: Entity) => any, def: any) => { const v = new Set(sel.map(f)); return sel.length ? (v.size === 1 ? [...v][0] : '') : def; };
    const dash = (cond: boolean) => cond ? '<option value="">—</option>' : '';
    const lv = one(e => e.layer, ed.doc.current), cv2 = one(e => e.color, ed.doc.attrs.color), wv = one(e => e.w, ed.doc.attrs.w);
    $('#aLayer').innerHTML = dash(lv === '') + ed.doc.layers.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join(''); ($('#aLayer') as HTMLSelectElement).value = lv;
    renderColor(cv2);
    $('#aWidth').innerHTML = dash(wv === '') + WIDTHS.map(w => `<option value="${w}">${w} mm</option>`).join(''); ($('#aWidth') as HTMLSelectElement).value = String(wv);
    renderBed();
  }
  function renderBed() {
    const pg = ed.doc.page, bed = $<HTMLSelectElement>('#aBed');
    if (!bed.options.length) bed.innerHTML = Object.entries(PAGES).map(([k, v]) => `<option value="${k}">${v[2]}</option>`).join('');
    bed.value = PAGES[pg.preset] ? pg.preset : 'CUSTOM';
    const W = $<HTMLInputElement>('#aBedW'), H = $<HTMLInputElement>('#aBedH');
    if (document.activeElement !== W) W.value = fmt(pg.w, 3); if (document.activeElement !== H) H.value = fmt(pg.h, 3);
  }
  $<HTMLSelectElement>('#aBed').onchange = ev => { const k = (ev.target as HTMLSelectElement).value, v = PAGES[k], pg = ed.doc.page; pg.preset = k; if (v[0]) { pg.w = v[0]; pg.h = v[1]; } renderBed(); ed.fit(); if (ui.tab === 'aids') renderPane(); };
  for (const id of ['#aBedW', '#aBedH']) $<HTMLInputElement>(id).onchange = ev => { const v = parseLength((ev.target as HTMLInputElement).value); if (!(v > 0)) { renderBed(); return; } const pg = ed.doc.page; if (id === '#aBedW') pg.w = v; else pg.h = v; pg.preset = 'CUSTOM'; renderBed(); ed.fit(); };
  const applyAttr = (key: 'layer' | 'color' | 'w', val: any) => {
    if (ed.sel.size) ed.store.change(() => { for (const e of ed.selected()) (e as any)[key] = val; });
    else { if (key === 'layer') ed.doc.current = val; else (ed.doc.attrs as any)[key] = val; renderAttr(); renderPane(); }
  };
  ($('#aLayer') as HTMLSelectElement).onchange = e => { const v = (e.target as HTMLSelectElement).value; if (v) applyAttr('layer', v); };
  // ---------- colour palette ----------
  /** The colour button: a swatch and "Red · Cut" (or "Mixed" for a selection of several colours). */
  function renderColor(cur: ColorKey | '') {
    const c = cur ? COLORS[cur] : null;
    $('#aColorSw').style.background = c ? c.hex : 'linear-gradient(135deg,#e03131 50%,#1c4fd8 50%)';
    $('#aColorTxt').textContent = cur ? colorLabel(ed.doc, cur) : 'Mixed';
    if (!$('#aColorPop').hidden) renderPalette(cur);
  }
  function renderPalette(cur: ColorKey | '') {
    const pop = $('#aColorPop'), k = (cur || ed.doc.attrs.color) as ColorKey, m = modeOf(ed.doc, k);
    pop.innerHTML = `<div class="grid">${(Object.keys(COLORS) as ColorKey[]).map(key => `<button type="button" class="sw" data-c="${key}" aria-pressed="${key === cur}" title="${esc(colorLabel(ed.doc, key))}"><i style="background:${COLORS[key].hex}"></i>${esc(COLORS[key].label)}<small>${esc(MODE_LABEL[modeOf(ed.doc, key)])}</small></button>`).join('')}</div>
      <h4>What the laser does with ${esc(COLORS[k].label.toLowerCase())}</h4>
      <span class="segc" role="group">${(['cut', 'score', 'fill', 'off'] as LaserMode[]).map(md => `<button type="button" data-m="${md}" aria-pressed="${md === m}">${MODE_LABEL[md]}</button>`).join('')}</span>
      <p class="hint" style="margin:8px 0 0">${m === 'cut' ? 'Cuts right through the material.' : m === 'score' ? 'Engraves along the line (marks, faces, labels).' : m === 'fill' ? 'Engraves the whole area inside the shape (shown lightly filled).' : 'Left out of SVG / DXF exports — for guide lines and notes.'} Every drawing keeps its own settings.</p>`;
    pop.querySelectorAll<HTMLElement>('[data-c]').forEach(b => b.onclick = () => { applyAttr('color', b.dataset.c as ColorKey); renderAttr(); renderPalette(b.dataset.c as ColorKey); });
    pop.querySelectorAll<HTMLElement>('[data-m]').forEach(b => b.onclick = () => { ed.store.change(() => { (ed.doc.modes ??= {})[k] = b.dataset.m as LaserMode; }); renderAttr(); renderPalette(k); });
  }
  $('#aColorBtn').onclick = ev => {
    ev.stopPropagation(); const pop = $('#aColorPop'); pop.hidden = !pop.hidden; $('#aColorBtn').setAttribute('aria-expanded', String(!pop.hidden));
    if (!pop.hidden) { const r = $('#aColorBtn').getBoundingClientRect(); pop.style.top = (r.bottom + 4) + 'px'; pop.style.left = Math.max(8, Math.min(r.left, innerWidth - 430)) + 'px'; renderAttr(); }
  };
  document.addEventListener('click', ev => { if (!(ev.target as HTMLElement).closest?.('.colpick')) { $('#aColorPop').hidden = true; $('#aColorBtn').setAttribute('aria-expanded', 'false'); } });
  ($('#aWidth') as HTMLSelectElement).onchange = e => { const v = (e.target as HTMLSelectElement).value; if (v) applyAttr('w', +v); };

  // ---------- toggles / prompt / readout ----------
  const TOGGLES: [string, string, () => boolean, () => void, string][] = [
    ['grid', 'GRID', () => ed.doc.aids.grid.show, () => ed.doc.aids.grid.show = !ed.doc.aids.grid.show, 'F4'],
    ['gridLock', 'GRID LOCK', () => ed.doc.aids.gridLock, () => ed.doc.aids.gridLock = !ed.doc.aids.gridLock, 'F5'],
    ['stepLock', 'STEP', () => ed.doc.aids.stepLock, () => ed.doc.aids.stepLock = !ed.doc.aids.stepLock, 'F6'],
    ['attach', 'ATTACH', () => ed.doc.aids.attach.on, () => ed.doc.aids.attach.on = !ed.doc.aids.attach.on, 'F7'],
    ['radial', 'RADIAL', () => ed.doc.aids.radial.on, () => ed.doc.aids.radial.on = !ed.doc.aids.radial.on, 'F8'],
    ['track', 'GUIDES', () => ed.doc.aids.track, () => ed.doc.aids.track = !ed.doc.aids.track, 'F10'],
  ];
  const toggle = (k: string) => { TOGGLES.find(t => t[0] === k)?.[3](); ed.changed('aids'); flash(`#toggles [data-k="${k}"]`); };
  /** Briefly light up a button so a keyboard shortcut is visibly acknowledged. */
  function flash(sel: string) {
    setTimeout(() => { const el = document.querySelector<HTMLElement>(sel); if (!el) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 400); }, 0);
  }
  const undo = () => { if (!ed.store.canUndo) ed.toast('Nothing to undo'); else { ed.store.undo(); ed.toast('Undo'); } flash('#bUndo'); };
  const redo = () => { if (!ed.store.canRedo) ed.toast('Nothing to redo'); else { ed.store.redo(); ed.toast('Redo'); } flash('#bRedo'); };
  function renderToggles() { $('#toggles').innerHTML = TOGGLES.map(([k, l, g, , f]) => `<button class="tg" data-k="${k}" aria-pressed="${g()}" title="${l} (${f})">${l} <span class="fk">${f}</span></button>`).join(''); $('#toggles').querySelectorAll<HTMLElement>('.tg').forEach(b => b.onclick = () => toggle(b.dataset.k!)); }
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
      const bop = ev.altKey ? ({ KeyU: 'union', KeyS: 'subtract', KeyI: 'intersect' } as Record<string, BoolOp>)[ev.code] : undefined;
      if (bop) { ev.preventDefault(); ed.booleanSel(bop); return; }
      if (c === 'z') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); }
      else if (c === 'y' || c === 'r') { ev.preventDefault(); redo(); }
      else if (c === 'a') { ev.preventDefault(); ed.selectAll(); }
      else if (c === 's') { ev.preventDefault(); saveNative(); flash('#bSave'); }
      else if (c === 'e') { ev.preventDefault(); ed.explodeSel(); }
      else if (c === 'g') { ev.preventDefault(); ed.groupSel(); }
      else if (c === 'u') { ev.preventDefault(); ed.ungroupSel(); }
      else if (c === 'h') { ev.preventDefault(); ed.makePathSel(); }
      return;
    }
    if (typing || !$('#modal').hidden) return;
    const fkeys: Record<string, () => void> = { F3: () => resetRel(), F4: () => toggle('grid'), F5: () => toggle('gridLock'), F6: () => toggle('stepLock'), F7: () => toggle('attach'), F8: () => toggle('radial'), F9: () => ed.setTool('select'), F10: () => toggle('track') };
    if (fkeys[k]) { ev.preventDefault(); fkeys[k](); return; }
    if (k === ' ') { ev.preventDefault(); if (!ui.spaceDown) resetRel(); ui.spaceDown = true; return; }
    if (ed.tool.onKey?.(ed, k, { shift: ev.shiftKey, alt: ev.altKey, ctrl: ev.ctrlKey })) { ev.preventDefault(); return; }
    if (/^[0-9.\-]$/.test(k) && ed.tool.draws) { ev.preventDefault(); const A = $<HTMLInputElement>('#ca'); A.value = k; A.focus(); return; }
    if (/^[0-9.]$/.test(k) && ed.tool.id === 'offset') { const i = document.querySelector<HTMLInputElement>('#toolOpts [data-opt="offD"]'); if (i) { ev.preventDefault(); i.value = k; i.focus(); } return; }
    if (k === 'Escape') { ed.cancel(); return; }
    if (k === 'Enter') { ed.finish(); return; }
    if (k === 'Delete' || k === 'Backspace') { ed.deleteSel(); return; }
    if (k.toUpperCase() === 'F' && !ev.altKey) { ed.fit(); flash('#bFit'); return; }
    if (k.toUpperCase() === 'G') { toggle('gridLock'); return; }
    if (k.toUpperCase() === 'S') { toggle('stepLock'); return; }
    const t = Object.values(ed.tools).find(x => x.key === k.toUpperCase()); if (t) { ed.setTool(t.id); flash(`#tools [data-t="${t.id}"]`); }
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
  let exportSheet = 0;
  function showExport(kind: 'svg' | 'dxf') {
    const nS = Math.max(1, ed.doc.sheets || 1); if (exportSheet >= nS) exportSheet = 0;
    const src = () => nS > 1 ? sheetDoc(ed.doc, exportSheet) : ed.doc;
    const build = () => kind === 'svg' ? exportSVG(src(), ui.exportOpts) : exportDXF(src(), ui.exportOpts);
    const fname = () => base() + (nS > 1 ? `-sheet${exportSheet + 1}` : '') + '.' + kind, refresh = () => { const t = build(); $<HTMLTextAreaElement>('#mText').value = t; $('#mSave').onclick = () => saveFile(fname(), t); if (nS > 1) $('#mHint').textContent = `Sheet ${exportSheet + 1} of ${nS} · ${src().ents.length} objects · export each sheet in turn`; $('#mCopy').onclick = async () => { try { await navigator.clipboard.writeText(t); ed.toast('Copied'); } catch { $<HTMLTextAreaElement>('#mText').select(); ed.toast('Text selected — press Ctrl+C'); } }; };
    $('#mTitle').textContent = kind === 'svg' ? 'Export SVG (mm)' : 'Export DXF (R12, mm)';
    const n = ed.doc.ents.filter(e => (ed.store.visible(e) || ui.exportOpts.includeHidden) && !(ui.exportOpts.skipDims && e.type === 'dim')).length;
    $('#mHint').textContent = `${ed.doc.page.w} × ${ed.doc.page.h} mm · ${n} objects` + (kind === 'dxf' && DL ? ' · saved as a .zip containing the .dxf' : '');
    $('#mOpts').innerHTML = (nS > 1 ? `<div>Sheet <div class="segc" id="xSheet" role="group">${Array.from({ length: nS }, (_, i) => `<button type="button" data-v="${i}" aria-pressed="${i === exportSheet}">${i + 1}</button>`).join('')}</div></div>` : '') + `<label class="chk"><input type="checkbox" id="xHidden" ${ui.exportOpts.includeHidden ? 'checked' : ''}> Include hidden layers</label><label class="chk"><input type="checkbox" id="xDims" ${ui.exportOpts.skipDims ? '' : 'checked'}> Include dimensions</label>` +
      (kind === 'dxf' ? `<label class="chk"><input type="checkbox" id="xSplit" ${ui.exportOpts.splitArcs ? 'checked' : ''}> Split arcs &amp; circles into lines</label><label class="chk">Curve tolerance <input type="text" id="xTol" value="${ui.exportOpts.curveTol}" style="width:60px" class="mono"> mm</label>` : '');
    const rebind = () => { ui.exportOpts.includeHidden = $<HTMLInputElement>('#xHidden').checked; ui.exportOpts.skipDims = !$<HTMLInputElement>('#xDims').checked; if (kind === 'dxf') { ui.exportOpts.splitArcs = $<HTMLInputElement>('#xSplit').checked; const t = parseLength($<HTMLInputElement>('#xTol').value); if (t > 0) ui.exportOpts.curveTol = t; } refresh(); };
    $('#mOpts').querySelectorAll('input').forEach(i => i.addEventListener('change', rebind));
    $('#mOpts').querySelectorAll<HTMLElement>('#xSheet button').forEach(b => b.onclick = () => { exportSheet = +b.dataset.v!; $('#mOpts').querySelectorAll('#xSheet button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); refresh(); });
    refresh(); $('#modal').hidden = false;
  }
  $('#mClose').onclick = () => { $('#modal').hidden = true; };
  $('#modal').addEventListener('click', ev => { if ((ev.target as HTMLElement).id === 'modal') $('#modal').hidden = true; });
  const saveNative = () => saveFile(base() + '.json', JSON.stringify(ed.doc, null, 1));
  $('#bSave').onclick = saveNative; $('#bSvg').onclick = () => showExport('svg'); $('#bDxf').onclick = () => showExport('dxf');
  $('#bOpen').onclick = () => $('#fileIn').click();
  const isImage = (f: File) => /^image\//i.test(f.type) || /\.(png|jpe?g|jfif|gif|webp|bmp|avif|heic|heif)$/i.test(f.name);
  $('#bTrace').onclick = () => { document.querySelector<HTMLElement>('#mkMenu .pop')!.hidden = true; $('#imgIn').click(); };
  $('#bElements').onclick = () => { closeMake(); openElements(ed, saveFile); };
  $('#bSaveEl').onclick = () => { closeMake(); saveSelectionAsElement(ed); };
  $('#bHelp').onclick = () => openHelp();
  $('#bBox').onclick = () => { closeMake(); openBox(ed); };
  $('#bNest').onclick = () => { closeMake(); openNest(ed); };
  $('#bHandIn').onclick = () => openHandIn(ed, saveFile);
  $('#bClassLoad').onclick = () => { closeMake(); $('#classIn').click(); };
  $('#bClassList').onclick = () => { closeMake(); openClassList(ed, saveFile); };
  $<HTMLInputElement>('#classIn').onchange = ev => { const inp = ev.target as HTMLInputElement, fs = [...(inp.files || [])]; inp.value = ''; if (fs.length) openClassLoad(ed, fs); };
  $('#bHinge').onclick = () => { closeMake(); openHinge(ed); };
  $('#bBend').onclick = () => { closeMake(); openBend(ed); };
  const makePop = () => document.querySelector<HTMLElement>('#mkMenu .pop')!;
  const closeMake = () => { makePop().hidden = true; $('#bMake').setAttribute('aria-expanded', 'false'); };
  $('#bMake').onclick = ev => { ev.stopPropagation(); const p = makePop(); p.hidden = !p.hidden; $('#bMake').setAttribute('aria-expanded', String(!p.hidden)); };
  document.addEventListener('click', ev => { if (!(ev.target as HTMLElement).closest?.('#mkMenu')) closeMake(); });
  $<HTMLInputElement>('#imgIn').onchange = ev => { const inp = ev.target as HTMLInputElement, f = inp.files?.[0]; inp.value = ''; if (f) openTrace(ed, f); };
  // drop a picture (or drawing) anywhere on the window; paste a picture with Ctrl/Cmd+V
  const hasFiles = (ev: DragEvent) => [...(ev.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragover', ev => { if (!hasFiles(ev)) return; ev.preventDefault(); if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy'; document.body.classList.add('dropping'); });
  window.addEventListener('dragleave', ev => { if (!ev.relatedTarget) document.body.classList.remove('dropping'); });
  window.addEventListener('drop', ev => {
    document.body.classList.remove('dropping');
    const all = [...(ev.dataTransfer?.files || [])], f = all[0]; if (!f) return; ev.preventDefault();
    // several drawings dropped at once: a class's handed-in designs
    if (all.filter(x => /\.json$/i.test(x.name)).length > 1) { openClassLoad(ed, all); return; }
    if (isImage(f)) openTrace(ed, f);
    else { const dt = new DataTransfer(); dt.items.add(f); const inp = $<HTMLInputElement>('#fileIn'); inp.files = dt.files; inp.dispatchEvent(new Event('change')); }
  });
  window.addEventListener('paste', ev => {
    const t = ev.target as HTMLElement; if (t?.matches?.('input,textarea')) return;
    const item = [...(ev.clipboardData?.items || [])].find(i => i.kind === 'file' && i.type.startsWith('image/'));
    const f = item?.getAsFile(); if (!f) return; ev.preventDefault(); openTrace(ed, f, 'pasted image');
  });
  $<HTMLInputElement>('#fileIn').onchange = async ev => {
    const inp = ev.target as HTMLInputElement, f = inp.files?.[0]; if (!f) return; inp.value = '';
    if (isImage(f)) { openTrace(ed, f); return; }
    const text = await f.text();
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
  $('#bUndo').onclick = undo; $('#bRedo').onclick = redo; $('#bFit').onclick = () => ed.fit();
  ($('#docName') as HTMLInputElement).onchange = ev => { ed.doc.name = (ev.target as HTMLInputElement).value; };
  function syncButtons() { ($('#bUndo') as HTMLButtonElement).disabled = !ed.store.canUndo; ($('#bRedo') as HTMLButtonElement).disabled = !ed.store.canRedo; }

  // ---------- side panel ----------
  document.querySelectorAll<HTMLElement>('.tabs button').forEach(b => b.onclick = () => { ui.tab = b.dataset.tab!; document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', String(x === b))); renderPane(); });
  let fid = 0;
  type Field = { html: string; id: string; set: (v: number) => void; unit?: boolean };
  const numField = (label: string, val: number, set: (v: number) => void, unit = true): Field => { const id = 'f' + (++fid); return { id, set, unit, html: `<label for="${id}">${label}</label><input type="text" inputmode="decimal" id="${id}" value="${fmt(val, dp())}" title="Exact: ${fmt(val, 6)}">` }; };
  const dp = () => Math.min(6, Math.max(0, prefs.dp ?? 2));
  /**
   * Number boxes change the drawing as you type (live): the first key makes one undo step, each
   * new value is applied to the drawing as it was before you started typing, and Enter or
   * leaving the box finishes. A box left empty or nonsense puts things back.
   */
  let liveEdit: { id: string; snap: string } | null = null;
  const bindFields = (fields: Field[]) => { for (const f of fields) {
    const inp = $<HTMLInputElement>(`#${f.id}`), parse = (t: string) => f.unit ? parseLength(t) : parseFloat(t);
    inp.oninput = () => {
      const v = parse(inp.value); if (!isFinite(v)) return;
      if (!liveEdit || liveEdit.id !== f.id) { liveEdit = { id: f.id, snap: JSON.stringify(ed.doc) }; ed.store.checkpoint(); }
      else ed.store.doc = JSON.parse(liveEdit.snap);
      f.set(v); ed.syncTextPaths(); ed.changed('view');
    };
    inp.onchange = () => {
      const v = parse(inp.value), le = liveEdit && liveEdit.id === f.id ? liveEdit : null; liveEdit = null;
      if (le) { if (!isFinite(v)) { ed.store.doc = JSON.parse(le.snap); ed.store.discardCheckpoint(); } ed.store.emit(); return; }
      if (!isFinite(v)) { renderPane(); return; } ed.store.change(() => f.set(v));
    };
  } };
  function sizeBlock(): { html: string; fields: Field[] } {
    const b = ed.selBox(); if (!b) return { html: '', fields: [] };
    const F: Field[] = [numField('X', b.x0, v => { const bb = ed.selBox()!; ed.transformSel(affMove(P(v - bb.x0, 0))); }), numField('Y', b.y0, v => { const bb = ed.selBox()!; ed.transformSel(affMove(P(0, v - bb.y0))); })];
    const lock = ed.opt.lockAspect;
    if (b.x1 - b.x0 > 1e-9) F.push(numField('Width', b.x1 - b.x0, v => { const bb = ed.selBox()!, w = bb.x1 - bb.x0, h = bb.y1 - bb.y0, s = v / w; ed.transformSel(affScale(P(bb.x0, bb.y0), s, lock && h > 1e-9 ? s : 1)); }));
    if (b.y1 - b.y0 > 1e-9) F.push(numField('Height', b.y1 - b.y0, v => { const bb = ed.selBox()!, w = bb.x1 - bb.x0, h = bb.y1 - bb.y0, s = v / h; ed.transformSel(affScale(P(bb.x0, bb.y0), lock && w > 1e-9 ? s : 1, s)); }));
    return { fields: F, html: `<h3>Size &amp; position</h3><div class="grid2">${F.map(f => f.html).join('')}</div>
      <div class="row"><label class="chk"><input type="checkbox" id="pLock" ${lock ? 'checked' : ''}>Keep proportions</label></div>
      ${alignBlock(ed.selUnits().length)}
      <div class="row"><span class="hint">Rotate by</span><input type="text" id="pRot" value="90" style="width:60px" class="mono"><span class="hint">°</span><button class="btn" id="pRotGo">Rotate</button><button class="btn" id="pFlipH">Flip ↔</button><button class="btn" id="pFlipV">Flip ↕</button></div>` };
  }
  /** Align / distribute buttons (Figma / Fusion style). */
  function alignBlock(n: number): string {
    const I = (d: string) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6">${d}</svg>`;
    const B: [string, string, string][] = [
      ['left', 'Align left', '<path d="M4 3v18"/><rect x="7" y="6" width="12" height="4"/><rect x="7" y="14" width="7" height="4"/>'],
      ['hcentre', 'Align centres (horizontally)', '<path d="M12 3v18"/><rect x="5" y="6" width="14" height="4"/><rect x="8" y="14" width="8" height="4"/>'],
      ['right', 'Align right', '<path d="M20 3v18"/><rect x="5" y="6" width="12" height="4"/><rect x="10" y="14" width="7" height="4"/>'],
      ['top', 'Align top', '<path d="M3 4h18"/><rect x="6" y="7" width="4" height="12"/><rect x="14" y="7" width="4" height="7"/>'],
      ['vmiddle', 'Align middles (vertically)', '<path d="M3 12h18"/><rect x="6" y="5" width="4" height="14"/><rect x="14" y="8" width="4" height="8"/>'],
      ['bottom', 'Align bottom', '<path d="M3 20h18"/><rect x="6" y="5" width="4" height="12"/><rect x="14" y="10" width="4" height="7"/>'],
    ];
    const to = n > 1 ? ui.alignTo : 'page';
    return `<h3>Align</h3><div class="row align">${B.map(([k, t, d]) => `<button class="btn ico" data-al="${k}" title="${t}${to === 'page' ? ' — on the sheet' : ''}" aria-label="${t}">${I(d)}</button>`).join('')}
      ${n > 2 ? `<button class="btn ico" data-dist="h" title="Space evenly — across" aria-label="Space evenly across">${I('<rect x="3" y="7" width="4" height="10"/><rect x="10" y="7" width="4" height="10"/><rect x="17" y="7" width="4" height="10"/>')}</button><button class="btn ico" data-dist="v" title="Space evenly — up and down" aria-label="Space evenly up and down">${I('<rect x="7" y="3" width="10" height="4"/><rect x="7" y="10" width="10" height="4"/><rect x="7" y="17" width="10" height="4"/>')}</button>` : ''}</div>
      ${n > 1 ? `<div class="row"><span class="hint">Align to</span><span class="segc" role="group" id="alTo"><button type="button" data-v="sel" aria-pressed="${to === 'sel'}">Selection</button><button type="button" data-v="page" aria-pressed="${to === 'page'}">Sheet</button></span></div>` : '<p class="hint">One object aligns to the sheet (e.g. centre it on the material).</p>'}`;
  }
  function bindAlign() {
    document.querySelectorAll<HTMLElement>('#pane [data-al]').forEach(b => b.onclick = () => ed.alignSel(b.dataset.al as any, ed.sel.size > 1 && ed.selUnits().length > 1 ? ui.alignTo : 'page'));
    document.querySelectorAll<HTMLElement>('#pane [data-dist]').forEach(b => b.onclick = () => ed.distributeSel(b.dataset.dist as any));
    document.querySelectorAll<HTMLElement>('#alTo button').forEach(b => b.onclick = () => { ui.alignTo = b.dataset.v as any; renderPane(); });
  }
  function bindSize() {
    bindAlign();
    const lk = document.querySelector<HTMLInputElement>('#pLock'); if (lk) lk.onchange = () => { ed.opt.lockAspect = lk.checked; };
    const go = document.querySelector<HTMLElement>('#pRotGo'); if (go) go.onclick = () => { const b = ed.selBox(), t = parseFloat($<HTMLInputElement>('#pRot').value) * DEG; if (!b || !isFinite(t)) return; ed.store.change(() => ed.transformSel(affRot(boxCentre(b), t))); };
    const fh = document.querySelector<HTMLElement>('#pFlipH'); if (fh) fh.onclick = () => ed.flipSel('h');
    const fv = document.querySelector<HTMLElement>('#pFlipV'); if (fv) fv.onclick = () => ed.flipSel('v');
  }
  /** Properties for a piece of text: what it says, font, size, spacing, and its line if it follows one. */
  function textPane(e: TextEntT, sz: { html: string; fields: Field[] }) {
    const pane = $('#pane'), pp = e.path, live = () => ed.store.byId(e.id) as TextEntT, F: Field[] = [];
    const set = (f: (t: TextEntT) => void, key = '') => { editTexts(ed, f, key, [e.id]); const t = live(); if (t) optsFromText(ed, t); };
    F.push(numField('Size (capitals) mm', e.size, v => { if (v > 0) live().size = v; }));
    F.push(numField('Letter spacing', e.spacing, v => { live().spacing = v; }));
    if (pp) F.push(numField('Lift off the line', pp.lift || 0, v => { live().path!.lift = v; }));
    else { F.push(numField('Line spacing ×', e.lineSpacing || 1.6, v => { if (v > 0) live().lineSpacing = v; }, false)); F.push(numField('Angle °', normA(e.angle || 0) / DEG, v => { live().angle = normA(v * DEG); }, false)); }
    const seg = (id: string, cur: string, ch: [string, string, string?][]) => `<span class="segc" role="group" id="${id}">${ch.map(([v, l, t]) => `<button type="button" data-v="${v}" aria-pressed="${cur === v}"${t ? ` title="${esc(t)}"` : ''}>${esc(l)}</button>`).join('')}</span>`;
    const fbtn = (f: typeof FONTS[number]) => `<button type="button" data-font="${f.id}" aria-pressed="${f.id === e.font}" title="${esc(f.name + ' — ' + f.note)}" style="font-family:${esc(cssFont(f.id))}">${f.id === 'kerf-line' ? 'ABC' : 'Abc'}<small>${esc(f.name)}</small></button>`;
    const fonts = FONT_GROUPS.map(([g, label]) => { const fs = FONTS.filter(f => f.group === g); return fs.length ? `<div class="hint fgl">${label}</div>` + fs.map(fbtn).join('') : ''; }).join('');
    pane.innerHTML = `<h3>${pp ? 'Text on a line' : 'Text'}</h3>
      <textarea id="pTxt" aria-label="Text" spellcheck="false" placeholder="Type or paste your text here">${esc(e.text)}</textarea>
      <p class="hint">Type or paste here — the drawing changes as you type.${pp ? '' : ' Enter = new line.'}</p>
      <div class="fontgrid" role="group" aria-label="Font">${fonts}</div>
      <div class="grid2">${F.map(f => f.html).join('')}</div>
      ${pp ? `<div class="row"><span class="hint">Letters</span>${seg('pEff', pp.effect, [['rainbow', 'A Rainbow', 'Letters turn to follow the line'], ['stretch', 'B Stretch', 'Letters bend with the line'], ['skew', 'C Skew', 'Letters stay upright and slant with the line'], ['stair', 'D Stair', 'Letters stay upright, stepping along the line']])}</div>
        <div class="row"><span class="hint">Sit</span>${seg('pSide', pp.side, [['above', 'Above'], ['on', 'On'], ['below', 'Below']])}<label class="chk"><input type="checkbox" id="pFit" ${pp.anchor === 'fit' ? 'checked' : ''}>Fit to the whole line</label></div>
        <div class="row"><button class="btn" id="pTFlip" title="Put the text on the other side of the line (on a circle: along the bottom, reading upright)">Other side ↕</button><button class="btn" id="pTMir" title="Back to front">Back to front ↔</button><button class="btn" id="pDetach" title="Let go of the line: straight text again">Make straight</button></div>
        <p class="hint">Drag the text along its line — it snaps to the start, middle and end (top, bottom and sides of a circle). Its line can still be edited; the text follows.</p>`
      : `<div class="row"><span class="hint">Align</span>${seg('pAlign', e.align, [['left', '⇤ Left'], ['center', 'Centre'], ['right', 'Right ⇥']])}<button class="btn" id="pTFlip" title="Upside down">Upside down</button><button class="btn" id="pTMir" title="Back to front">Back to front ↔</button></div>
        <p class="hint">Drag the text onto a line, arc or circle and let go: it follows it.</p>`}
      <h3>Make it cuttable</h3>
      <div class="row"><label class="chk"><input type="checkbox" id="pEng" ${e.color === 'blue' ? 'checked' : ''}>Engrave (blue)</label><button class="btn" id="pOutl" title="Turn the letters into ordinary shapes you can edit point by point (the text can't be retyped after)">Convert to outlines</button><button class="btn" id="pWeld" title="Letters that touch join into one outline — good for names cut out in a script font">Weld letters</button><button class="btn" id="pDel">Delete</button></div>
      <p class="hint">Mouse wheel over selected text: letter spacing · Shift+wheel: size · Alt+wheel: ${pp ? 'lift off the line' : 'line spacing'} · double-click to retype. For a key ring: Contour the text, then add a ring to the contour — if the letters are far apart, draw a line through them first and the contour follows it.</p>
      ${pp ? '' : sz.html}`;
    bindFields(F.concat(pp ? [] : sz.fields)); if (!pp) bindSize();
    const ta = $<HTMLTextAreaElement>('#pTxt'); ta.style.fontFamily = cssFont(e.font);
    ta.onfocus = () => { if (!typing || typing.id !== e.id) typing = { id: e.id, isNew: false, pushed: false }; ed.state.typing = finishTyping; ed.state.typingFocused = true; };
    ta.oninput = () => {
      const t = live(); if (!t) return;
      if (!typing || typing.id !== e.id) typing = { id: e.id, isNew: false, pushed: false };
      if (!typing.pushed) { ed.store.checkpoint(); typing.pushed = true; }
      t.text = t.path ? ta.value.replace(/\n/g, ' ') : ta.value; ed.changed('view');
    };
    ta.onkeydown = ev => { if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey || live()?.path))) { ev.preventDefault(); ta.blur(); } };
    ta.onblur = () => { ed.state.typingFocused = false; }; ta.addEventListener('blur', () => setTimeout(() => { if (document.activeElement?.id !== 'pTxt') finishTyping(); }, 0));
    pane.querySelectorAll<HTMLElement>('[data-font]').forEach(b => b.onclick = () => set(t => { t.font = b.dataset.font!; }));
    const segBind = (id: string, f: (t: TextEntT, v: string) => void) => document.querySelectorAll<HTMLElement>(`#${id} button`).forEach(b => b.onclick = () => set(t => f(t, b.dataset.v!)));
    segBind('pEff', (t, v) => { t.path!.effect = v as any; }); segBind('pSide', (t, v) => { t.path!.side = v as any; }); segBind('pAlign', (t, v) => { t.align = v as any; });
    document.querySelector<HTMLInputElement>('#pFit')?.addEventListener('change', ev => set(t => { t.path!.anchor = (ev.target as HTMLInputElement).checked ? 'fit' : 'center'; }));
    $('#pTFlip').onclick = () => flipText(ed, live(), 'v'); $('#pTMir').onclick = () => flipText(ed, live(), 'h');
    document.querySelector<HTMLElement>('#pDetach')?.addEventListener('click', () => { const b = ed.bbox(live()); set(t => { delete t.path; t.at = P(b.x0, b.y0); t.angle = 0; t.align = 'left'; t.mirror = false; }); });
    $<HTMLInputElement>('#pEng').onchange = ev => set(t => { t.color = (ev.target as HTMLInputElement).checked ? 'blue' : (ed.doc.attrs.color === 'blue' ? 'red' : ed.doc.attrs.color); });
    $('#pOutl').onclick = () => { const t = live(), n = ed.replaceWith([t], textShapes(t), t).length; ed.toast(`Text turned into ${n} outline${n === 1 ? '' : 's'} (grouped)`); };
    $('#pWeld').onclick = () => { const t = live(), w = weldShapes(textShapes(t)), n = ed.replaceWith([t], w, t).length; ed.toast(`Letters welded into ${n} outline${n === 1 ? '' : 's'}`); };
    $('#pDel').onclick = () => ed.deleteSel();
  }
  // ---------- Simplify (fewer, smoother nodes) and point editing ----------
  const simpTol = (v: number) => +Math.pow(10, Math.log10(2) + (Math.log10(0.02) - Math.log10(2)) * v / 100).toPrecision(2);
  function simplifyBlock() {
    return `<h3>Simplify</h3><p class="hint">Rebuild the line from as few smooth curves as it needs — sharp corners stay sharp.</p>
      <div class="row"><span class="hint">Fewer nodes</span><input type="range" id="pSimp" min="0" max="100" value="${ui.simp}" style="flex:1"><span class="hint">More exact</span></div>
      <p class="hint" id="pSimpInfo">Move the slider to see it.</p><div class="row"><button class="btn primary" id="pSimpGo" disabled>Simplify</button><button class="btn" id="pSimpNo" hidden>Cancel</button></div>`;
  }
  function bindSimplify() {
    const r = document.querySelector<HTMLInputElement>('#pSimp'); if (!r) return;
    const preview = () => {
      ui.simp = +r.value; const tol = simpTol(ui.simp), src = ed.selected().filter(x => x.type === 'poly' || x.type === 'spline');
      const shapes: Shape[] = [], ids: string[] = []; let before = 0, after = 0, dev = 0;
      for (const x of src) { const sh = simplifyShape(x as Shape, tol); if (!sh) continue; ids.push(x.id); shapes.push(sh); before += (x as any).pts.length; after += (sh as any).pts.length; dev = Math.max(dev, deviation(x as Shape, sh)); }
      ed.state.simp = { ids, shapes, tol }; R.request();
      $('#pSimpInfo').innerHTML = `<b>${before} → ${after} nodes</b> · stays within ${fmt(Math.max(dev, 0.001), 3)} mm of the original`;
      $<HTMLButtonElement>('#pSimpGo').disabled = !shapes.length; $('#pSimpNo').hidden = false;
    };
    r.oninput = preview;
    $('#pSimpGo').onclick = () => {
      const sp = ed.state.simp; if (!sp) return; ed.state.simp = null;
      ed.store.change(() => { sp.ids.forEach((id: string, k: number) => ed.store.replace(id, sp.shapes[k])); }); ed.toast('Simplified — one Undo puts the old line back');
    };
    $('#pSimpNo').onclick = () => { ed.state.simp = null; renderPane(); R.request(); };
  }
  /** Soften: round every corner of the selected shapes (live preview; thin parts that would be lost are left alone). */
  const softR = (v: number) => +(0.2 * Math.pow(100, v / 100)).toPrecision(2);   // 0.2 … 20 mm
  function softenBlock() {
    return `<h3>Soften corners</h3><p class="hint">Rounds every corner — great for friendly key rings and cute shapes. Size stays the same.</p>
      <div class="row"><span class="hint">Roundness</span><input type="range" id="pSoftn" min="0" max="100" value="${ui.soft}" style="flex:1"><span class="mono" id="pSoftnV">${softR(ui.soft)} mm</span></div>
      <div class="row"><span class="hint">Corners</span><span class="segc" id="pSoftnC">${[['both', 'All'], ['outer', 'Outside'], ['inner', 'Inside']].map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${ui.softC === v}">${l}</button>`).join('')}</span></div>
      <p class="hint" id="pSoftnInfo">Move the slider to see it.</p><div class="row"><button class="btn primary" id="pSoftnGo" disabled>Soften all corners</button><button class="btn" id="pSoftnPick" title="See every corner as a dot and switch each one on or off before softening">Choose corners…</button></div>`;
  }
  function bindSoften() {
    const r = document.querySelector<HTMLInputElement>('#pSoftn'); if (!r) return;
    const preview = () => {
      ui.soft = +r.value; const rad = softR(ui.soft); $('#pSoftnV').textContent = rad + ' mm';
      const pv = softenPreview(ed, [...ed.sel], rad, ui.softC as any);
      ed.state.simp = { ids: pv.ids, shapes: pv.shapes }; ed.state.softPv = pv; R.request();
      $('#pSoftnInfo').innerHTML = pv.ids.length ? `<b>${pv.ids.length} shape${pv.ids.length > 1 ? 's' : ''}</b> softened${pv.kept.length ? ` · <b class="warn">${pv.kept.length} would lose a thin part</b> — left as ${pv.kept.length > 1 ? 'they are' : 'it is'}; try less roundness` : ''}` : pv.kept.length ? '<b class="warn">A thin part would be lost</b> — try less roundness' : 'Nothing to soften here (circles are already round)';
      $<HTMLButtonElement>('#pSoftnGo').disabled = !pv.ids.length;
    };
    r.oninput = preview;
    document.querySelectorAll<HTMLElement>('#pSoftnC button').forEach(b => b.onclick = () => { ui.softC = b.dataset.v!; document.querySelectorAll('#pSoftnC button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); preview(); });
    $('#pSoftnPick').onclick = () => { ed.state.simp = null; ed.opt.smMode = 'shape'; ed.opt.smRound = softR(ui.soft); ed.opt.smCorners = ui.softC; ed.setTool('smooth'); ed.changed('tool'); };
    $('#pSoftnGo').onclick = () => { const pv = ed.state.softPv; ed.state.simp = null; ed.state.softPv = null; if (pv) applySoften(ed, pv); };
  }
  /** Point editing extras: soft drag, and the selected point made smooth / sharp / removed (keeping the shape). */
  function nodeBlock(e: any) {
    const nd = ed.state.node, i = nd && nd.id === e.id ? nd.sel : null;
    const soft = `<div class="row"><label class="chk" title="Neighbouring points follow when you drag a point, fading with distance — reshape a whole side smoothly"><input type="checkbox" id="pSoft" ${ed.opt.softDrag ? 'checked' : ''}>Soft drag</label><label class="hint">reach <input type="text" id="pSoftR" value="${ed.opt.softR}" style="width:48px" class="mono"> mm</label></div>`;
    if (!nd || nd.id !== e.id) return `<h3>Points</h3><p class="hint">${e.pts.length} points · <b>Edit points</b> to drag them.</p>` + soft;
    return `<h3>Points</h3><p class="hint">${i == null ? 'Click a point to choose it.' : `Point ${i + 1} of ${e.pts.length}`}</p>
      ${i != null && e.type === 'spline' ? `<div class="row"><button class="btn" id="pNSmooth" title="Handles in a straight line: the curve flows through">Smooth point</button><button class="btn" id="pNCorner" title="A crisp corner">Sharp corner</button><button class="btn" id="pNDel" title="Remove the point and refit the curve so the shape stays">Delete point</button></div>` : i != null ? '<div class="row"><button class="btn" id="pNDel">Delete point</button></div>' : ''}` + soft;
  }
  function bindNodes(e: any) {
    const sc = document.querySelector<HTMLInputElement>('#pSoft'); if (sc) sc.onchange = () => { ed.opt.softDrag = sc.checked; R.request(); };
    const sr = document.querySelector<HTMLInputElement>('#pSoftR'); if (sr) sr.onchange = () => { const v = parseLength(sr.value); if (v > 0) ed.opt.softR = v; };
    const i = ed.state.node?.sel, live = () => ed.store.byId(e.id) as any;
    document.querySelector<HTMLElement>('#pNSmooth')?.addEventListener('click', () => ed.store.change(() => { const x = live(), r = smoothNode(x, i); x.h = r.h; }));
    document.querySelector<HTMLElement>('#pNCorner')?.addEventListener('click', () => ed.store.change(() => { const x = live(), r = cornerNode(x, i); x.h = r.h; }));
    document.querySelector<HTMLElement>('#pNDel')?.addEventListener('click', () => { ed.tool.onKey?.(ed, 'Delete', { shift: false, alt: false, ctrl: false }); renderPane(); });
  }
  /** Open the Help tab, optionally at a guide. */
  function openHelp(id: string | null = null) {
    ui.tab = 'help'; ui.helpShow = id && id !== ed.tool.id ? id : null;
    document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', String((x as HTMLElement).dataset.tab === 'help')));
    renderPane(); $('#pane').scrollTop = 0; document.querySelector('#coach')?.remove();
    if (matchMedia('(max-width: 900px)').matches) $('#side').scrollIntoView({ behavior: 'smooth' });
  }
  /** First time a tool is used: a small card offering its picture guide. */
  function coach() {
    document.querySelector('#coach')?.remove();
    const id = ed.tool.id, g = GUIDES.find(x => x.id === id);
    if (!g || prefs.noTips || id === 'select' || (prefs.seen || []).includes(id) || ui.tab === 'help') return;
    prefs.seen = [...(prefs.seen || []), id]; savePrefs(prefs);
    const c = document.createElement('div'); c.id = 'coach'; c.setAttribute('role', 'status');
    c.innerHTML = `<span class="hicon"><svg viewBox="0 0 24 24">${ed.tool.icon}</svg></span><div><b>New tool: ${ed.tool.label}</b><p>${g.steps[0].t}</p><div class="row"><button class="btn primary" id="cShow">Show me how</button><button class="btn" id="cOk">Got it</button><label class="chk"><input type="checkbox" id="cOff">No more tips</label></div></div>`;
    $('#main').append(c);
    c.querySelector<HTMLElement>('#cShow')!.onclick = () => openHelp();
    c.querySelector<HTMLElement>('#cOk')!.onclick = () => c.remove();
    c.querySelector<HTMLInputElement>('#cOff')!.onchange = e => { prefs.noTips = (e.target as HTMLInputElement).checked; savePrefs(prefs); if (prefs.noTips) c.remove(); };
  }
  /** Re-render the side panel, keeping the focused number box focused (so the wheel keeps working). */
  function renderPane() {
    const a = document.activeElement as HTMLInputElement | null, pane = $('#pane');
    const key = a && pane.contains(a) ? (a.id && !/^f\d+$/.test(a.id) ? '#' + a.id : pane.querySelector(`label[for="${a.id}"]`)?.textContent || null) : null;
    renderPaneInner();
    if (!key) return;
    let el: HTMLInputElement | null = null;
    if (key.startsWith('#')) el = pane.querySelector<HTMLInputElement>(key);
    else { const l = [...pane.querySelectorAll('label')].find(x => x.textContent === key); el = l ? pane.querySelector<HTMLInputElement>('#' + l.htmlFor) : null; }
    if (el) { el.focus(); const n = el.value.length; try { el.setSelectionRange(n, n); } catch { /* ignore */ } }
  }
  function renderPaneInner() {
    const pane = $('#pane'), t = ui.tab;
    if (t === 'props') {
      const sel = ed.selected();
      if (!sel.length) {
        pane.innerHTML = `<h3>Nothing selected</h3><p class="hint">Click a shape to see its handles and exact sizes. Double-click a shape to edit its points.</p>
          <h3>Drawing</h3><div class="grid2"><label>Objects</label><span class="mono">${ed.doc.ents.length}</span><label>Page</label><span class="mono">${ed.doc.page.w} × ${ed.doc.page.h} mm</span><label>Units</label><span class="mono">mm (type 2cm or 1in if you like)</span></div>
          <h3>Keys</h3><p class="hint">Type numbers at any prompt to enter coordinates · Alt+A / R / P switch Abs, Rel, Pol · Space or F3 resets the relative origin · Backspace removes the last point · F4 grid · F5 grid lock · F6 step · F7 attach · F8 radial · Esc cancels · wheel zooms, Shift+wheel or middle-drag pans.</p>
          <h3>Clean up</h3><div class="row"><button class="btn" id="bTidyAll" title="Remove duplicates and zero-size objects; join pieces that meet (within the close-gaps setting)">Tidy drawing</button></div>`;
        $('#bTidyAll').onclick = () => ed.tidySel();
        return;
      }
      const sz = sizeBlock();
      if (sel.length > 1) {
        const types: Record<string, number> = {}; sel.forEach(e => types[e.type] = (types[e.type] || 0) + 1);
        const grouped = sel.some(e => e.group?.length), roots = new Set(sel.map(e => ed.groupRoot(e)).filter(Boolean));
        pane.innerHTML = `<h3>${sel.length} objects selected</h3><p class="hint">${Object.entries(types).map(([k, v]) => `${v} × ${k}`).join(', ')}${grouped ? ` · ${roots.size === 1 && sel.every(e => e.group?.length) ? 'one group' : 'includes groups'}` : ''}</p>${sz.html}
          <div class="row"><button class="btn" id="pGroup" title="Ctrl+G">Group</button><button class="btn" id="pUngroup" title="Ctrl+U" ${grouped ? '' : 'disabled'}>Ungroup</button><button class="btn" id="pPath" title="Join touching lines and arcs into one path (Ctrl+H)">Make path</button><button class="btn" id="pExplode" title="Ctrl+E">Explode</button><button class="btn" id="pDel">Delete</button></div>
          <p class="hint">Explode ungroups one level at a time; on paths it breaks them into lines and arcs.</p>
          <h3>Combine shapes</h3><div class="row"><button class="btn" id="bUnion" title="Join overlapping closed shapes into one outline (Ctrl+Alt+U)">Union</button><button class="btn" id="bSub" title="Cut the smaller shapes out of the largest (Ctrl+Alt+S)">Subtract</button><button class="btn" id="bInt" title="Keep only the overlap (Ctrl+Alt+I)">Intersect</button><button class="btn" id="bTidy" title="Remove duplicates and zero-size objects; join pieces that meet">Tidy</button></div>
          <p class="hint">Subtract keeps the largest shape and cuts the others out of it. Curves stay true arcs.</p>${sel.some(x => x.type === 'poly' || x.type === 'spline') ? softenBlock() + simplifyBlock() : ''}`;
        if (sel.some(x => x.type === 'poly' || x.type === 'spline')) { bindSimplify(); bindSoften(); }
        bindFields(sz.fields); bindSize(); $('#pExplode').onclick = () => ed.explodeSel(); $('#pDel').onclick = () => ed.deleteSel(); $('#pGroup').onclick = () => ed.groupSel(); $('#pUngroup').onclick = () => ed.ungroupSel(); $('#pPath').onclick = () => ed.makePathSel();
        $('#bUnion').onclick = () => ed.booleanSel('union'); $('#bSub').onclick = () => ed.booleanSel('subtract'); $('#bInt').onclick = () => ed.booleanSel('intersect'); $('#bTidy').onclick = () => ed.tidySel(); return;
      }
      if (isText(sel[0])) { textPane(sel[0], sz); return; }
      const e: any = sel[0], F: Field[] = [];
      const pt = (lbl: string, k: string) => { F.push(numField(lbl + ' X', e[k].x, v => { (ed.store.byId(e.id) as any)[k] = P(v, e[k].y); })); F.push(numField(lbl + ' Y', e[k].y, v => { (ed.store.byId(e.id) as any)[k] = P(e[k].x, v); })); };
      let title: string = e.type, extra = '', ptsHtml = '';
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
        const PF: Field[] = [];
        if (e.pts.length <= 60) e.pts.forEach((p: Point, i: number) => { PF.push(numField(`P${i + 1} X`, p.x, v => { const x = live(); x.pts[i] = P(v, x.pts[i].y); })); PF.push(numField(`P${i + 1} Y`, p.y, v => { const x = live(); x.pts[i] = P(x.pts[i].x, v); })); });
        F.push(...PF); ptsHtml = PF.length ? `<details id="pPts" ${ui.ptsOpen ? 'open' : ''}><summary>Point coordinates (${e.pts.length})</summary><div class="grid2">${PF.map(f => f.html).join('')}</div></details>` : '';
        extra = `<p class="hint">${e.closed ? 'Perimeter' : 'Length'} ${fmt(lengthOf(e), dp())} mm · ${e.pts.length} points</p>`; }
      else if (e.type === 'spline') { title = e.closed ? 'Closed curve' : 'Curve'; extra = `<p class="hint">${e.closed ? 'Perimeter' : 'Length'} ${fmt(lengthOf(e), dp())} mm · ${e.pts.length} points · Edit points to drag points and handles (Alt = sharp corner, click + to add a point)</p>`; }
      else if (e.type === 'dim') { title = 'Dimension'; pt('Point 1', 'p1'); pt('Point 2', 'p2'); extra = `<div class="grid2"><label for="dTxt">Text override</label><input type="text" id="dTxt" value="${esc(e.text || '')}" placeholder="${esc(fmt(ed.dimGeom(e).val, ed.doc.dim.dec))}"></div>`; }
      const mainF = F.filter(f => !ptsHtml.includes(`id="${f.id}"`));
      pane.innerHTML = `<h3>${title}</h3>
        <div class="row"><button class="btn" id="pNodes" title="Drag points; double-click a shape to do the same">${ed.state.node ? 'Finish editing points' : 'Edit points'}</button>${e.type === 'poly' ? '<button class="btn" id="pExplode" title="Ctrl+E">Explode to lines</button>' : e.type === 'spline' ? '<button class="btn" id="pExplode" title="Turn the curve into a path of short lines (Ctrl+E)">Convert to path</button>' : ''}<button class="btn" id="pDel">Delete</button></div>
        ${mainF.length ? `<div class="grid2">${mainF.map(f => f.html).join('')}</div>` : ''}${extra}${e.type === 'poly' || e.type === 'spline' ? nodeBlock(e) + softenBlock() + simplifyBlock() : ''}${sz.html}${ptsHtml}
        <p class="hint">Layer ${esc(ed.store.layer(e.layer)?.name || '?')} · ${colorLabel(ed.doc, e.color as ColorKey)} · ${e.w} mm</p>`;
      if (e.type === 'poly' || e.type === 'spline') { bindSimplify(); bindSoften(); bindNodes(e); }
      bindFields(F.concat(sz.fields)); bindSize();
      document.querySelector<HTMLElement>('#pExplode')?.addEventListener('click', () => ed.explodeSel()); $('#pDel').onclick = () => ed.deleteSel();
      document.querySelector<HTMLDetailsElement>('#pPts')?.addEventListener('toggle', ev => { ui.ptsOpen = (ev.target as HTMLDetailsElement).open; });
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
        <h3>Dimensions</h3><div class="grid2"><label for="sDd">Decimals</label><input type="text" id="sDd" value="${ed.doc.dim.dec}"><label for="sDh">Text height mm</label><input type="text" id="sDh" value="${ed.doc.dim.textH}">
        <label for="sDu">Units shown</label><select id="sDu"><option value="mm">mm</option><option value="in">inches</option><option value="none">none</option></select>
        <label for="sDc">Colour</label><select id="sDc">${Object.entries(COLORS).map(([k, c]) => `<option value="${k}">${c.label}</option>`).join('')}</select></div>
        <p class="hint">New dimensions use this colour. Dimensions are left out of SVG/DXF exports unless you tick "Include dimensions", so they are never cut.</p>
        <h3>Accuracy</h3><div class="grid2"><label for="sTol">Curve tolerance</label><input type="text" id="sTol" value="${geomSettings.flatTol}"><label for="sJt">Close gaps up to mm</label><input type="text" id="sJt" value="${ed.opt.joinTol}"><label for="sDp">Decimals shown</label><input type="text" id="sDp" value="${dp()}"><label for="sPk">Click reach px</label><input type="text" id="sPk" value="${ed.opt.pickPx}"></div>
        <h3>Mouse &amp; trackpad</h3><div class="row"><label class="chk"><input type="radio" name="wh" value="zoom" ${prefs.wheelPans ? '' : 'checked'}>Wheel zooms at pointer</label><label class="chk"><input type="radio" name="wh" value="pan" ${prefs.wheelPans ? 'checked' : ''}>Two-finger scroll pans (pinch zooms)</label></div>
        <p class="hint">Click reach: how far from a line (in screen pixels) a click still picks it — the nearest line wins. Decimals shown: sizes are kept exactly; this only rounds what you see (hover a box for the exact value). Close gaps: Make Path and Trim treat ends this close as touching. Curve tolerance is how closely contours follow curves (mm). Smaller is more accurate but makes bigger files. These settings, except tolerance, are saved with the drawing.</p>
        <h3>Defaults</h3><div class="row"><button class="btn" id="sReset" title="Grid, snaps, dimensions, click reach, tool options… back to how they started. Your drawing is not changed.">Reset all settings to defaults</button></div>
        <h3>Help</h3><div class="row"><label class="chk"><input type="checkbox" id="sTips" ${prefs.noTips ? '' : 'checked'}>Show a tip the first time each tool is used</label><button class="btn" id="sTipsAgain" title="Show the first-time tips again, for a new person on this computer">Show tips again</button></div>
        <p class="hint">Tip: click in any number box, then use the mouse wheel to change it (Shift = finer, Alt = coarser).</p>`;
      $<HTMLInputElement>('#sTips').onchange = e => { prefs.noTips = !(e.target as HTMLInputElement).checked; savePrefs(prefs); };
      $('#sTipsAgain').onclick = () => { prefs.seen = []; prefs.noTips = false; savePrefs(prefs); renderPane(); ed.toast('Tips will show again the first time each tool is used'); };
      ($('#sPre') as HTMLSelectElement).value = pg.preset || 'CUSTOM';
      const du = $<HTMLSelectElement>('#sDu'), dc = $<HTMLSelectElement>('#sDc'); du.value = ed.doc.dim.unit; dc.value = ed.doc.dim.color;
      du.onchange = () => { ed.doc.dim.unit = du.value as any; ed.changed('view'); };
      dc.onchange = () => { const c = dc.value as ColorKey; ed.doc.dim.color = c; ed.store.change(() => { for (const e of ed.doc.ents) if (e.type === 'dim') e.color = c; }); };
      const num = (id: string, f: (v: number) => void, unit = true) => { $(`#${id}`).onchange = (ev: Event) => { const t2 = (ev.target as HTMLInputElement).value, v = unit ? parseLength(t2) : parseFloat(t2); if (isFinite(v)) { f(v); ed.changed('view'); } }; };
      ($('#sPre') as HTMLSelectElement).onchange = ev => { const k = (ev.target as HTMLSelectElement).value, v = PAGES[k]; pg.preset = k; if (v[0]) { pg.w = v[0]; pg.h = v[1]; } renderPane(); ed.fit(); };
      num('sW', v => { pg.w = Math.max(1, v); pg.preset = 'CUSTOM'; ed.fit(); }); num('sH', v => { pg.h = Math.max(1, v); pg.preset = 'CUSTOM'; ed.fit(); });
      num('sG', v => A.grid.spacing = Math.max(0.1, v)); num('sSt', v => A.step = Math.max(0.01, v));
      num('sRs', v => A.radial.start = v, false); num('sRp', v => A.radial.step = Math.max(0.1, v), false);
      num('sBox', v => at.box = Math.max(4, v), false); num('sDd', v => ed.doc.dim.dec = Math.min(6, Math.max(0, Math.round(v))), false); num('sDh', v => ed.doc.dim.textH = Math.max(0.5, v));
      num('sTol', v => { geomSettings.flatTol = Math.min(0.1, Math.max(0.0001, v)); });
      $('#sReset').onclick = ev => {
        const b = ev.currentTarget as HTMLButtonElement;
        if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Click again to reset'; b.classList.add('primary'); setTimeout(() => { if (b.isConnected) { b.dataset.armed = ''; b.textContent = 'Reset all settings to defaults'; b.classList.remove('primary'); } }, 3000); return; }
        const d0 = newDoc(); ed.doc.aids = d0.aids; ed.doc.dim = d0.dim; Object.keys(ed.opt).forEach(k => delete ed.opt[k]); Object.assign(ed.opt, structuredClone(DEFAULT_OPTS));
        geomSettings.flatTol = 0.0005; for (const k of Object.keys(prefs)) delete (prefs as any)[k]; savePrefs(prefs);
        renderToggles(); renderOptions(); renderPane(); ed.changed('view'); ed.toast('Settings reset to defaults — your drawing is unchanged');
      };
      num('sPk', v => { ed.opt.pickPx = Math.min(60, Math.max(3, Math.round(v))); prefs.pickPx = ed.opt.pickPx; savePrefs(prefs); }, false);
      num('sDp', v => { prefs.dp = Math.min(6, Math.max(0, Math.round(v))); savePrefs(prefs); }, false);
      num('sJt', v => { ed.opt.joinTol = Math.min(2, Math.max(0, v)); prefs.joinTol = ed.opt.joinTol; savePrefs(prefs); });
      pane.querySelectorAll<HTMLInputElement>('[name=wh]').forEach(r => r.onchange = () => { prefs.wheelPans = r.value === 'pan'; savePrefs(prefs); });
      pane.querySelectorAll<HTMLInputElement>('[data-a]').forEach(c => c.onchange = () => { (at as any)[c.dataset.a!] = c.checked; });
    } else if (t === 'help') {
      const icons = Object.fromEntries(Object.values(ed.tools).map(x => [x.id, { icon: x.icon, label: x.label, key: x.key }]));
      pane.innerHTML = helpHtml(ed.tool.id, ui.helpShow, icons);
      pane.querySelectorAll<HTMLElement>('[data-help]').forEach(b => b.onclick = () => { ui.helpShow = b.dataset.help === ed.tool.id ? null : b.dataset.help!; renderPane(); pane.scrollTop = 0; });
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

/** Per-browser conveniences (never essential; storage may be unavailable). */
interface Prefs { noTips?: boolean; seen?: string[]; wheelPans?: boolean; joinTol?: number; dp?: number; pickPx?: number }
function loadPrefs(): Prefs { try { return JSON.parse(localStorage.getItem('kerf2d.prefs') || '{}') || {}; } catch { return {}; } }
function savePrefs(p: Prefs) { try { localStorage.setItem('kerf2d.prefs', JSON.stringify(p)); } catch { /* ignore */ } }
