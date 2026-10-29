/**
 * Classroom windows:
 *  • Hand in (pupils): name and class, ready-to-cut checks, then a named file to upload to the teacher.
 *  • Load class designs (teacher): many handed-in files at once onto one worksheet, then Nest.
 *  • Class list (teacher/technician): who is on which sheet; click a name to find their design.
 */
import type { Editor } from '../editor/editor';
import { sheetX, type Entity, type Shape } from '../model/types';
import { affEnt, affMove } from '../geometry/affine';
import { bbox, unionBox } from '../geometry/entity';
import { P } from '../geometry/vec';
import { checkDesign, canHandIn, type Check } from '../classroom/checks';
import { handInFile, readDesign, newestOnly, designEnts, classEntry, classCsv, type Design } from '../classroom/handin';
import { sheetOf } from '../io/sheets';
import { openNest } from './nest';

type Save = (name: string, text: string) => Promise<void> | void;
const esc = (t: string) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const mark = (l: Check['level']) => l === 'ok' ? '<b class="ok">✓</b>' : l === 'warn' ? '<b class="warn">!</b>' : '<b class="stop">✕</b>';
const remember = { get(k: string) { try { return localStorage.getItem('kerf.' + k) || ''; } catch { return ''; } }, set(k: string, v: string) { try { localStorage.setItem('kerf.' + k, v); } catch { /* private window */ } } };

/** A small window in the shared dialog style; returns its root and a close function. */
function dialog(title: string, body: string, foot: string, wide = false) {
  document.querySelector('#boxmaker')?.remove();
  const root = document.createElement('div'); root.id = 'boxmaker'; root.className = 'classroom' + (wide ? ' wide' : '');
  root.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-labelledby="crTitle"><div class="head"><strong id="crTitle">${title}</strong><button class="x" id="crClose" aria-label="Close">✕</button></div><div class="cbody">${body}</div><div class="foot">${foot}</div></div>`;
  document.body.append(root);
  const close = () => { root.remove(); window.removeEventListener('keydown', onKey, true); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } };
  window.addEventListener('keydown', onKey, true);
  root.querySelector<HTMLElement>('#crClose')!.onclick = close;
  root.addEventListener('click', e => { if (e.target === root) close(); });
  return { root, close, $: <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector(s) as T };
}
/** Zoom the view onto some objects and select them. */
function showEnts(ed: Editor, ids: string[]) {
  const ents = ids.map(id => ed.store.byId(id)).filter(Boolean) as Entity[]; if (!ents.length) return;
  const b = unionBox(ents.map(e => bbox(e as Shape)).filter(Boolean) as any); if (!b) return;
  const V = ed.view, w = Math.max(10, b.x1 - b.x0), h = Math.max(10, b.y1 - b.y0);
  V.k = Math.min(8, Math.min((V.W - 120) / w, (V.H - 120) / h)); V.ox = (b.x0 + b.x1) / 2 - V.W / V.k / 2; V.oy = (b.y0 + b.y1) / 2 - V.H / V.k / 2;
  ed.setTool('select'); ed.setSelection(ids); ed.changed('view');
}

// ---------------------------------------------------------------- pupils
export function openHandIn(ed: Editor, save: Save) {
  const checks = checkDesign(ed.doc), ok = canHandIn(checks);
  const title = ed.doc.handin?.title || (ed.doc.name && ed.doc.name !== 'Untitled' ? ed.doc.name : '');
  const { $, close } = dialog('Hand in your design', `
    <label class="sl">Your name <input type="text" id="hName" autocomplete="name" value="${esc(ed.doc.handin?.name || remember.get('name'))}"></label>
    <label class="sl">Class <input type="text" id="hCls" placeholder="e.g. 9B" value="${esc(ed.doc.handin?.cls || remember.get('cls'))}"></label>
    <label class="sl">Design name <input type="text" id="hTitle" placeholder="e.g. Star key ring" value="${esc(title)}"></label>
    <h4>Ready to cut?</h4>
    <ul class="checks">${checks.map((c, i) => `<li class="${c.level}">${mark(c.level)}<span>${esc(c.text)}</span>${c.at ? `<button type="button" class="link" data-i="${i}">Show me</button>` : ''}</li>`).join('')}</ul>
    <p class="hint" id="hMsg">${ok ? (checks.some(c => c.level === 'warn') ? 'You can still hand it in, but fixing the <b>!</b> items first gives a better cut.' : 'All good!') : 'Fix the <b>✕</b> item before handing in.'} The file is saved to your computer: then upload it to your teacher (Teams, Google Classroom or the shared drive).</p>`,
    `<button class="btn" id="hCancel">Cancel</button><button class="btn primary" id="hGo" ${ok ? '' : 'disabled'}>Hand in (save file)</button>`);
  $('#hCancel').onclick = close;
  document.querySelectorAll<HTMLElement>('#boxmaker .checks .link').forEach(b => b.onclick = () => {
    const c = checks[+b.dataset.i!]; if (!c.at) return; close();
    const V = ed.view; V.k = Math.max(V.k, 8); V.ox = c.at.x - V.W / V.k / 2; V.oy = c.at.y - V.H / V.k / 2; ed.changed('view');
    ed.toast('Here: ' + c.text);
  });
  $('#hGo').onclick = async () => {
    const name = $<HTMLInputElement>('#hName').value.trim(), cls = $<HTMLInputElement>('#hCls').value.trim(), t = $<HTMLInputElement>('#hTitle').value.trim();
    if (!name) { $('#hMsg').textContent = 'Please type your name, so your teacher knows whose it is.'; $<HTMLInputElement>('#hName').focus(); return; }
    remember.set('name', name); remember.set('cls', cls);
    const f = handInFile(ed.doc, name, cls, t, checks);
    // keep who made it with the drawing too, so a plain Save remembers it
    ed.doc.handin = JSON.parse(f.text).handin;
    await save(f.filename, f.text); close();
    ed.toast(`Saved “${f.filename}” — now upload it to your teacher`);
  };
  setTimeout(() => (($('#hName') as HTMLInputElement).value ? $('#hGo') : $('#hName')).focus(), 0);
}

// ---------------------------------------------------------------- teacher: load
export async function openClassLoad(ed: Editor, files: File[]) {
  let designs: Design[] = [];
  const read = async (fs: File[]) => { for (const f of fs) if (/\.json$/i.test(f.name)) designs.push(readDesign(f.name, await f.text(), f.lastModified)); };
  await read(files);
  const { root, $, close } = dialog('Load class designs', `
    <p class="hint">Choose all the handed-in files at once (Ctrl+A in the file box), or drop them on this window. The newest file from each pupil is used. Designs are added beside the sheet, then Nest packs them onto as many sheets as needed.</p>
    <div class="ctable"><table><thead><tr><th></th><th>Name</th><th>Class</th><th>Design</th><th>Checks</th></tr></thead><tbody id="cRows"></tbody></table></div>`,
    `<p class="hint" id="cSum"></p><button class="btn" id="cMore">Add files…</button><input type="file" id="cFiles" accept=".json" multiple hidden><button class="btn" id="cCancel">Cancel</button><button class="btn primary" id="cGo">Add and nest</button>`, true);
  const on = new Set<Design>();
  const resetOn = () => { on.clear(); for (const d of newestOnly(designs)) if (!d.error && canHandIn(d.checks)) on.add(d); };
  const render = () => {
    const newest = newestOnly(designs), sorted = designs.slice().sort((a, b) => (a.cls + a.name).localeCompare(b.cls + b.name));
    $('#cRows').innerHTML = sorted.map(d => {
      const i = designs.indexOf(d), warn = d.checks.filter(c => c.level === 'warn'), stop = d.checks.filter(c => c.level === 'stop');
      const note = d.error ? `<span class="stop">${esc(d.error)}</span>` : stop.length ? `${mark('stop')} ${esc(stop[0].text)}` : warn.length ? `<span title="${esc(warn.map(c => c.text).join('\n'))}">${mark('warn')} ${warn.length} to look at: ${esc(warn[0].text.split(/[.—(]/)[0])}…</span>` : mark('ok') + ' Ready';
      return `<tr class="${newest.has(d) ? '' : 'old'}"><td><input type="checkbox" data-i="${i}" ${on.has(d) ? 'checked' : ''} ${d.error ? 'disabled' : ''}></td><td>${esc(d.name)}${newest.has(d) || d.error ? '' : ' <i>(older copy)</i>'}</td><td>${esc(d.cls)}</td><td>${esc(d.title)}</td><td>${note}</td></tr>`;
    }).join('') || '<tr><td colspan="5" class="hint">No files yet — press Add files…</td></tr>';
    root.querySelectorAll<HTMLInputElement>('#cRows input').forEach(c => c.onchange = () => { const d = designs[+c.dataset.i!]; if (c.checked) on.add(d); else on.delete(d); sum(); });
    sum();
  };
  const sum = () => { const n = on.size, pupils = new Set(designs.filter(d => !d.error).map(d => d.owner.toLowerCase())).size; $('#cSum').textContent = `${designs.length} file${designs.length === 1 ? '' : 's'} · ${pupils} pupil${pupils === 1 ? '' : 's'} · ${n} chosen`; ($('#cGo') as HTMLButtonElement).disabled = !n; ($('#cGo') as HTMLElement).textContent = `Add ${n} and nest`; };
  const addFiles = async (fs: File[]) => { await read(fs); resetOn(); render(); };
  $('#cMore').onclick = () => $('#cFiles').click();
  $<HTMLInputElement>('#cFiles').onchange = e => { const inp = e.target as HTMLInputElement; const fs = [...(inp.files || [])]; inp.value = ''; addFiles(fs); };
  root.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); });
  root.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); document.body.classList.remove('dropping'); addFiles([...(e.dataTransfer?.files || [])]); });
  $('#cCancel').onclick = close;
  $('#cGo').onclick = () => {
    const chosen = designs.filter(d => on.has(d)); if (!chosen.length) return;
    const ids = addDesigns(ed, chosen); close();
    ed.toast(`Added ${chosen.length} design${chosen.length > 1 ? 's' : ''} — now nesting them`);
    ed.setSelection(ids); openNest(ed, { classMode: true });
  };
  resetOn(); render();
}

/** Put pupils' designs beside the sheets (in rows, apart), tagged with their names; returns the new ids. */
export function addDesigns(ed: Editor, chosen: Design[]): string[] {
  const ids: string[] = [], pg = ed.doc.page;
  ed.store.change(() => {
    const n = Math.max(1, ed.doc.sheets || 1), x0 = sheetX(ed.doc, n - 1) + pg.w + 30; let x = x0, y = pg.h, rowH = 0;
    const list = ed.doc.classList ? ed.doc.classList.slice() : [];
    for (const d of chosen) {
      const ents = designEnts(d), b = unionBox(ents.map(e => bbox(e as Shape)).filter(Boolean) as any); if (!b) continue;
      const w = b.x1 - b.x0, h = b.y1 - b.y0;
      if (x > x0 && x + w > x0 + 4 * pg.w) { x = x0; y -= rowH + 15; rowH = 0; }
      const A = affMove(P(x - b.x0, y - b.y1)), gm = new Map<string, string>();
      for (const e of ents) {
        const { id, ...rest } = affEnt(e as Shape, A) as any;
        if (rest.group) rest.group = rest.group.map((g: string) => gm.get(g) || (gm.set(g, 'g' + (ed.doc.seq++)), gm.get(g)));
        rest.owner = d.owner;
        ids.push(ed.store.add(rest as Shape, { layer: ed.doc.current, color: e.color, w: e.w }).id);
      }
      x += w + 15; rowH = Math.max(rowH, h);
      const k = list.findIndex(c => c.owner.toLowerCase() === d.owner.toLowerCase()); if (k >= 0) list.splice(k, 1);
      list.push(classEntry(d));
    }
    ed.doc.classList = list;
  });
  return ids;
}

// ---------------------------------------------------------------- teacher: who is where
export function openClassList(ed: Editor, save: Save) {
  const list = ed.doc.classList || [];
  const rows = list.map(e => {
    const ids = ed.doc.ents.filter(x => x.owner === e.owner).map(x => x.id), sheets = new Set(ids.map(id => sheetOf(ed.doc, ed.store.byId(id)! as Shape)));
    const sheet = !ids.length ? 'removed' : [...sheets].sort().map(s => s < 0 ? 'off the sheet' : 'Sheet ' + (s + 1)).join(', ');
    return { e, ids, sheet };
  }).sort((a, b) => (a.sheet + a.e.cls + a.e.name).localeCompare(b.sheet + b.e.cls + b.e.name));
  const { root, $, close } = dialog('Class list', list.length ? `
    <p class="hint">Click a name to find and select that pupil's design. "Off the sheet" means it didn't fit — nest again or move it on.</p>
    <div class="ctable"><table><thead><tr><th>Name</th><th>Class</th><th>Design</th><th>Sheet</th><th>Notes</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td><button type="button" class="link" data-i="${i}">${esc(r.e.name)}</button></td><td>${esc(r.e.cls)}</td><td>${esc(r.e.title)}</td><td>${esc(r.sheet)}</td><td>${r.e.warnings.length ? `<span title="${esc(r.e.warnings.join('\n'))}">${mark('warn')} ${r.e.warnings.length}</span>` : mark('ok')}</td></tr>`).join('')}</tbody></table></div>` :
    '<p class="hint">No class designs on this worksheet yet. Use <b>Make ▾ → Load class designs…</b> first.</p>',
    `<p class="hint">${list.length} pupil${list.length === 1 ? '' : 's'} · ${Math.max(1, ed.doc.sheets || 1)} sheet${(ed.doc.sheets || 1) > 1 ? 's' : ''}</p><button class="btn" id="lCsv" ${list.length ? '' : 'disabled'}>Save list (.csv)</button><button class="btn primary" id="lClose">Close</button>`, true);
  root.querySelectorAll<HTMLElement>('.link').forEach(b => b.onclick = () => { const r = rows[+b.dataset.i!]; close(); showEnts(ed, r.ids); ed.toast(`${r.e.name}${r.e.cls ? ' (' + r.e.cls + ')' : ''} · ${r.e.title} · ${r.sheet}`); });
  $('#lClose').onclick = close;
  $('#lCsv').onclick = () => save(`${(ed.doc.name || 'class').replace(/[^\w\- ]+/g, '').trim() || 'class'} - class list.csv`, classCsv(rows.map(r => ({ e: r.e, sheet: r.sheet }))));
}
