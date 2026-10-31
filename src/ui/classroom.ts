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
import { handInFile, readDesign, newestOnly, clashes, uniqueOwners, toInitials, okInitials, toClassCode, designEnts, classEntry, classCsv, type Design } from '../classroom/handin';
import { unzipFiles } from '../io/unzip';
import { sheetOf } from '../io/sheets';
import { openNest } from './nest';
import { COMMON_MATERIALS, COMMON_THICKNESS } from '../laser/jobinfo';
import { loadState as loadLaser } from '../laser/machine';
/** Material names for pupils to pick from: any saved on this computer (without their thickness), then a short common list. */
const matNames = () => [...new Set([...loadLaser().myMaterials.map(m => m.name.replace(/\d+(?:[.,]\d+)?\s*mm\b/gi, '').trim()), ...COMMON_MATERIALS])].filter(Boolean);

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
/**
 * Where pupils are told to put their file. The teacher can set it with a link to Kerf 2D,
 * e.g. kerf.html?handin=Upload%20it%20to%20Teams%20›%20D%26T%20›%20Files%20›%20{class}
 * ({class} becomes the pupil's class code); the text is then remembered on that computer.
 */
export function handInWhere(cls: string): string {
  let t = '';
  try { const q = new URLSearchParams(location.search).get('handin') || new URLSearchParams(location.hash.slice(1)).get('handin'); if (q) { t = q.slice(0, 200); remember.set('handinWhere', t); } } catch { /* no location */ }
  t = t || remember.get('handinWhere');
  const c = cls || 'your class';
  return t ? esc(t).replace(/\{class\}/gi, '<b>' + esc(c) + '</b>') : `Now upload it to the <b>${esc(c)}</b> folder in Teams (or wherever your teacher asked).`;
}

export function openHandIn(ed: Editor, save: Save, askLaser = false) {
  const checks = checkDesign(ed.doc), ok = canHandIn(checks);
  const title = ed.doc.handin?.title || (ed.doc.name && ed.doc.name !== 'Untitled' ? ed.doc.name : '');
  const ini0 = toInitials(ed.doc.handin?.name || remember.get('name')), cls0 = toClassCode(ed.doc.handin?.cls || remember.get('cls'));
  const { $, close } = dialog('Hand in your design', `
    <div class="hrow">
      <label class="sl">Your initials <input type="text" id="hName" class="ini" autocomplete="off" spellcheck="false" maxlength="12" placeholder="MJ" value="${esc(ini0)}"></label>
      <label class="sl">Class code <input type="text" id="hCls" class="ini" autocomplete="off" spellcheck="false" maxlength="12" placeholder="9B" value="${esc(cls0)}"></label>
    </div>
    <label class="sl">Design name <input type="text" id="hTitle" placeholder="e.g. Star key ring" value="${esc(title)}"></label>
    ${askLaser ? `<div class="hrow">
      <label class="sl">Material <input type="text" id="hMat" list="hMats" placeholder="e.g. MDF" value="${esc(remember.get('jobMat'))}" autocomplete="off"></label><datalist id="hMats">${matNames().map(n => `<option value="${esc(n)}">`).join('')}</datalist>
      <label class="sl">Thickness (mm) <input type="text" id="hTh" class="ini" list="hThs" inputmode="decimal" placeholder="3" value="${esc(remember.get('jobTh'))}"></label><datalist id="hThs">${COMMON_THICKNESS.map(n => `<option value="${n}">`).join('')}</datalist>
      <label class="sl">How many <input type="text" id="hN" class="ini" inputmode="numeric" value="1"></label>
    </div>` : ''}
    <p class="hint">Your file will be called <b class="mono" id="hFile"></b></p>
    <h4>Ready to cut?</h4>
    <ul class="checks">${checks.map((c, i) => `<li class="${c.level}">${mark(c.level)}<span>${esc(c.text)}</span>${c.at ? `<button type="button" class="link" data-i="${i}">Show me</button>` : ''}</li>`).join('')}</ul>
    <p class="hint" id="hMsg"></p>`,
    `<button class="btn" id="hCancel">Cancel</button><button class="btn primary" id="hGo" ${ok ? '' : 'disabled'}>Hand in (save file)</button>`);
  const nameIn = $<HTMLInputElement>('#hName'), clsIn = $<HTMLInputElement>('#hCls'), titleIn = $<HTMLInputElement>('#hTitle');
  const status = ok ? (checks.some(c => c.level === 'warn') ? 'You can still hand it in, but fixing the <b>!</b> items first gives a better cut.' : 'All good!') : 'Fix the <b>✕</b> item before handing in.';
  // live: tidy initials and class code as they are typed, and show the file name straight away
  const iniOf = (v: string) => /\s/.test(v.trim()) ? toInitials(v) : v.trim().toUpperCase();
  const live = () => {
    // capitals as they type; a full name ("Mia Jones") is turned into initials when they leave the box
    if (!/\s/.test(nameIn.value)) { const n = nameIn.value.replace(/[^\p{L}]/gu, '').toUpperCase(); if (n !== nameIn.value) nameIn.value = n; }
    const c = toClassCode(clsIn.value); if (clsIn.value !== c) clsIn.value = c;
    const ini = iniOf(nameIn.value), f = handInFile(ed.doc, ini || '??', clsIn.value || '??', titleIn.value, []);
    $('#hFile').textContent = f.filename;
    nameIn.classList.toggle('bad', !!nameIn.value && !okInitials(ini));
    $('#hMsg').innerHTML = `${status} The file is saved to your computer. ${handInWhere(clsIn.value)}`;
  };
  nameIn.oninput = live; clsIn.oninput = live; titleIn.oninput = live;
  nameIn.onchange = () => { nameIn.value = iniOf(nameIn.value); live(); };
  $('#hCancel').onclick = close;
  document.querySelectorAll<HTMLElement>('#boxmaker .checks .link').forEach(b => b.onclick = () => {
    const c = checks[+b.dataset.i!]; if (!c.at) return; close();
    const V = ed.view; V.k = Math.max(V.k, 8); V.ox = c.at.x - V.W / V.k / 2; V.oy = c.at.y - V.H / V.k / 2; ed.changed('view');
    ed.toast('Here: ' + c.text);
  });
  $('#hGo').onclick = async () => {
    const name = iniOf(nameIn.value), cls = toClassCode(clsIn.value), t = titleIn.value.trim();
    if (!okInitials(name)) { $('#hMsg').innerHTML = 'Please type your <b>two initials</b> (e.g. <b>MJ</b> for Mia Jones), so your teacher knows whose it is.'; nameIn.focus(); return; }
    if (!cls) { $('#hMsg').innerHTML = 'Please type your <b>class code</b> (e.g. <b>9B</b>).'; clsIn.focus(); return; }
    remember.set('name', name); remember.set('cls', cls);
    const f = handInFile(ed.doc, name, cls, t, checks);
    if (askLaser) {
      // what to cut it from goes in the handed-in file only, so the pupil's own drawing still opens as a drawing
      const mat = $<HTMLInputElement>('#hMat').value.trim(), th = parseFloat($<HTMLInputElement>('#hTh').value.replace(',', '.')), n = Math.round(+$<HTMLInputElement>('#hN').value);
      if (!mat) { $('#hMsg').innerHTML = 'Please say what to <b>cut it from</b> (e.g. <b>MDF</b>), so the technician knows.'; $('#hMat').focus(); return; }
      remember.set('jobMat', mat); remember.set('jobTh', th > 0 ? String(th) : '');
      const d = JSON.parse(f.text); d.job = { material: mat, thickness: th > 0 && th < 100 ? th : 0, copies: n >= 1 && n <= 50 ? n : 1, from: `${name} · ${cls}`, at: new Date().toISOString() }; f.text = JSON.stringify(d);
    }
    // keep who made it with the drawing too, so a plain Save remembers it
    ed.doc.handin = JSON.parse(f.text).handin;
    await save(f.filename, f.text); close();
    ed.toast(`Saved “${f.filename}”. ${handInWhere(cls).replace(/<[^>]+>/g, '')}`);
  };
  live();
  setTimeout(() => (nameIn.value && clsIn.value ? $('#hGo') : nameIn.value ? clsIn : nameIn).focus(), 0);
}

/** Every file in a drop, opening dropped folders (and their sub-folders). Must be called during the drop event. */
export function dropFiles(dt: DataTransfer | null): Promise<File[]> {
  if (!dt) return Promise.resolve([]);
  const entries = [...(dt.items || [])].map(i => (i as any).webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length || !entries.some((e: any) => e.isDirectory)) return Promise.resolve([...(dt.files || [])]);
  const walk = async (e: any): Promise<File[]> => {
    if (e.isFile) return [await new Promise<File>((res, rej) => e.file(res, rej))];
    const rd = e.createReader(), kids: any[] = [];
    for (;;) { const batch: any[] = await new Promise((res, rej) => rd.readEntries(res, rej)); if (!batch.length) break; kids.push(...batch); }
    return (await Promise.all(kids.map(walk))).flat();
  };
  return Promise.all(entries.map(walk)).then(a => a.flat());
}
/** True if a list of files holds handed-in designs (several drawings, or a zip). */
export const looksLikeClass = (fs: File[]) => fs.some(f => /\.zip$/i.test(f.name)) || fs.filter(f => /\.json$/i.test(f.name)).length > 1;

// ---------------------------------------------------------------- teacher: load
/** A folder the teacher opened (e.g. a Teams folder synced to this computer), remembered between visits. */
const DB = 'kerf-folders';
function idb<T>(mode: IDBTransactionMode, f: (st: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return new Promise(res => {
    try {
      const o = indexedDB.open(DB, 1); o.onupgradeneeded = () => o.result.createObjectStore('h');
      o.onsuccess = () => { try { const r = f(o.result.transaction('h', mode).objectStore('h')); r.onsuccess = () => res(r.result); r.onerror = () => res(undefined); } catch { res(undefined); } };
      o.onerror = () => res(undefined);
    } catch { res(undefined); }
  });
}
const canOpenFolder = () => typeof (window as any).showDirectoryPicker === 'function';
/** All .json and .zip files in a folder and its sub-folders, with their path. */
async function folderFiles(dir: any, pre = ''): Promise<{ path: string; file: File }[]> {
  const out: { path: string; file: File }[] = [];
  for await (const [name, h] of dir.entries()) {
    if (h.kind === 'directory') { if (!name.startsWith('.')) out.push(...await folderFiles(h, pre + name + '/')); }
    else if (/\.(json|zip)$/i.test(name)) out.push({ path: pre + name, file: await h.getFile() });
  }
  return out;
}

export async function openClassLoad(ed: Editor, files: File[]) {
  let designs: Design[] = [];
  const seen = new Map<string, Design[]>();   // source (file or folder path + date) → its designs, so re-checking a folder only adds what changed
  const skipped: string[] = [];
  /** Read files (designs, or zips of designs); `key` identifies where they came from. */
  const read = async (fs: File[], keyOf: (f: File) => string = f => 'file:' + f.name + ':' + f.lastModified + ':' + f.size) => {
    let added = 0;
    for (const f of fs) {
      const key = keyOf(f), stamp = ':' + f.lastModified + ':' + f.size, base = key.endsWith(stamp) ? key.slice(0, -stamp.length) : key;
      if (seen.has(key)) continue;
      // a newer version of the same file (Teams/OneDrive replace it in place): drop the old reading
      for (const [k, ds] of seen) if (k !== key && k.startsWith(base + ':')) { designs = designs.filter(d => !ds.includes(d)); seen.delete(k); }
      const got: Design[] = [];
      if (/\.zip$/i.test(f.name)) {
        try { for (const z of await unzipFiles(f)) { if (/\.json$/i.test(z.name)) got.push(readDesign(z.name, await z.text(), z.lastModified)); else skipped.push(f.name + ' › ' + z.name); } }
        catch (e: any) { got.push({ ...readDesign(f.name, '', 0), error: 'Could not open the zip: ' + (e?.message || e) }); }
      } else if (/\.json$/i.test(f.name)) got.push(readDesign(f.name, await f.text(), f.lastModified));
      else skipped.push(f.name);
      seen.set(key, got); designs.push(...got); added += got.length;
    }
    return added;
  };
  await read(files);
  const folderBtns = canOpenFolder() ? `<button class="btn" id="cFolder" title="Open a folder on this computer — e.g. your Teams class folder synced with OneDrive — and keep watching it for new hand-ins">Open folder…</button>` : '';
  const { root, $, close } = dialog('Load class designs', `
    <p class="hint">Choose the handed-in files, or the <b>.zip</b> that Teams gives you when you download a whole folder, or drop files, zips or a folder on this window.${canOpenFolder() ? ' Or <b>Open folder</b> (e.g. your Teams folder synced to this computer): new hand-ins then appear here by themselves.' : ''} The newest file from each pupil is used, then Nest packs them onto as many sheets as needed.</p>
    <p class="hint" id="cWatch" hidden></p>
    <div class="ctable"><table><thead><tr><th></th><th>Initials</th><th>Class</th><th>Design</th><th>Checks</th></tr></thead><tbody id="cRows"></tbody></table></div>`,
    `<p class="hint" id="cSum"></p>${folderBtns}<button class="btn" id="cMore">Add files…</button><input type="file" id="cFiles" accept=".json,.zip" multiple hidden><button class="btn" id="cCancel">Cancel</button><button class="btn primary" id="cGo">Add and nest</button>`, true);
  const on = new Set<Design>();
  const resetOn = () => { on.clear(); for (const d of newestOnly(designs)) if (!d.error && canHandIn(d.checks)) on.add(d); };
  /** After re-checking a folder: keep the teacher's ticks, tick what is new, untick what was replaced. */
  const mergeOn = (before: Set<Design>) => { const now = newestOnly(designs); for (const d of [...on]) if (!now.has(d)) on.delete(d); for (const d of now) if (!before.has(d) && !d.error && canHandIn(d.checks)) on.add(d); };
  const render = () => {
    const newest = newestOnly(designs), clash = clashes(designs), sorted = designs.slice().sort((a, b) => (a.cls + a.name + a.title).localeCompare(b.cls + b.name + b.title));
    $('#cRows').innerHTML = sorted.map(d => {
      const i = designs.indexOf(d), warn = d.checks.filter(c => c.level === 'warn'), stop = d.checks.filter(c => c.level === 'stop');
      const note = d.error ? `<span class="stop">${esc(d.error)}</span>` : stop.length ? `${mark('stop')} ${esc(stop[0].text)}` : warn.length ? `<span title="${esc(warn.map(c => c.text).join('\n'))}">${mark('warn')} ${warn.length} to look at: ${esc(warn[0].text.split(/[.—(]/)[0])}…</span>` : mark('ok') + ' Ready';
      const twin = newest.has(d) && clash.has(d.owner.toLowerCase()) ? ` <span class="warn" title="More than one design from ${esc(d.owner)}: two pupils with the same initials, or one pupil who renamed their design. Untick any you don't want.">⚠ same initials</span>` : '';
      return `<tr class="${newest.has(d) ? '' : 'old'}"><td><input type="checkbox" data-i="${i}" ${on.has(d) ? 'checked' : ''} ${d.error ? 'disabled' : ''}></td><td>${esc(d.name)}${newest.has(d) || d.error ? '' : ' <i>(older copy)</i>'}${twin}</td><td>${esc(d.cls)}</td><td>${esc(d.title)}</td><td>${note}</td></tr>`;
    }).join('') || '<tr><td colspan="5" class="hint">No files yet — press Add files…</td></tr>';
    root.querySelectorAll<HTMLInputElement>('#cRows input').forEach(c => c.onchange = () => { const d = designs[+c.dataset.i!]; if (c.checked) on.add(d); else on.delete(d); sum(); });
    sum();
  };
  const sum = () => {
    const n = on.size, cur = newestOnly(designs).size, files = designs.length;
    $('#cSum').textContent = `${files} file${files === 1 ? '' : 's'} · ${cur} design${cur === 1 ? '' : 's'} · ${n} chosen` + (skipped.length ? ` · ${skipped.length} other file${skipped.length === 1 ? '' : 's'} skipped` : '');
    $('#cSum').title = skipped.length ? 'Skipped (not Kerf 2D designs):\n' + skipped.slice(0, 30).join('\n') : '';
    ($('#cGo') as HTMLButtonElement).disabled = !n; ($('#cGo') as HTMLElement).textContent = `Add ${n} and nest`;
  };
  const addFiles = async (fs: File[]) => { await read(fs); resetOn(); render(); };
  $('#cMore').onclick = () => $('#cFiles').click();
  $<HTMLInputElement>('#cFiles').onchange = e => { const inp = e.target as HTMLInputElement; const fs = [...(inp.files || [])]; inp.value = ''; addFiles(fs); };
  root.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); });
  root.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); document.body.classList.remove('dropping'); dropFiles(e.dataTransfer).then(addFiles); });

  // ---- a watched folder (Chrome / Edge): re-read every 10 s while this window is open, and on "Check now"
  let dir: any = null, timer = 0, busy = false;
  const check = async (quiet = false) => {
    if (!dir || busy) return; busy = true;
    try {
      const before = new Set(newestOnly(designs)), list = await folderFiles(dir), byFile = new Map(list.map(x => [x.file, x.path]));
      const added = await read(list.map(x => x.file), f => 'dir:' + byFile.get(f) + ':' + f.lastModified + ':' + f.size);
      // files deleted from the folder disappear here too
      const live = new Set(list.map(x => 'dir:' + x.path + ':' + x.file.lastModified + ':' + x.file.size));
      for (const [k, ds] of seen) if (k.startsWith('dir:') && !live.has(k)) { designs = designs.filter(d => !ds.includes(d)); seen.delete(k); }
      mergeOn(before); render();
      $('#cWatch').innerHTML = `Watching <b>${esc(dir.name)}</b> · checked ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}${added ? ` · <b>${added} new</b>` : ''} <button type="button" class="link" id="cCheck">Check now</button>`;
      $('#cCheck').onclick = () => check();
      if (added && !quiet) ed.toast(`${added} new design${added === 1 ? '' : 's'} in ${dir.name}`);
    } catch (e: any) { $('#cWatch').innerHTML = `<span class="stop">Can't read ${esc(dir?.name || 'the folder')}: ${esc(e?.message || e)}</span>`; }
    finally { busy = false; }
  };
  const watch = async (h: any) => {
    dir = h; $('#cWatch').hidden = false; await idb('readwrite', st => st.put(h, 'class'));
    await check(true); clearInterval(timer); timer = window.setInterval(() => { if (!root.isConnected) clearInterval(timer); else check(); }, 10000);
  };
  if (canOpenFolder()) {
    $('#cFolder').onclick = async () => {
      try { await watch(await (window as any).showDirectoryPicker({ id: 'kerf-class', mode: 'read' })); }
      catch (e: any) { if (e?.name !== 'AbortError') ed.toast('Could not open the folder: ' + (e?.message || e)); }
    };
    // offer the folder used last time (the browser asks once more before reading it)
    const last: any = await idb('readonly', st => st.get('class'));
    if (last && root.isConnected) {
      $('#cWatch').hidden = false;
      $('#cWatch').innerHTML = `Last time: <b>${esc(last.name)}</b> <button type="button" class="btn" id="cReopen">Open ${esc(last.name)} again</button>`;
      $('#cReopen').onclick = async () => {
        try { if ((await last.requestPermission?.({ mode: 'read' })) === 'denied') throw new Error('permission refused'); await watch(last); }
        catch (e: any) { ed.toast('Could not open ' + last.name + ': ' + (e?.message || e) + ' — use Open folder…'); }
      };
    }
  }
  $('#cCancel').onclick = () => { clearInterval(timer); close(); };
  $('#cGo').onclick = () => {
    const chosen = uniqueOwners(designs.filter(d => on.has(d))); if (!chosen.length) return;
    clearInterval(timer);
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
