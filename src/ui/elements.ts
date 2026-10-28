/**
 * Elements window: pick a ready-made outline, choose its size, place it on the sheet.
 * "My elements" holds designs the user saved from their own drawing (kept in this
 * browser, and shareable as a .kerf-elements file a teacher can hand round).
 */
import { ELEMENTS, ELEMENT_CATS, placeElement, type Element } from '../elements/elements';
import { flatten } from '../geometry/entity';
import { P, fmt } from '../geometry/vec';
import type { Editor } from '../editor/editor';
import type { Shape } from '../model/types';

const MY = 'My elements', STORE = 'kerf2d.myElements';
interface Saved { id: string; name: string; shapes: Shape[] }
let sizeMm = 40, cat = 'All', query = '';

export function loadMine(): Saved[] { try { const v = JSON.parse(localStorage.getItem(STORE) || '[]'); return Array.isArray(v) ? v.filter(x => x && x.name && Array.isArray(x.shapes) && x.shapes.length) : []; } catch { return []; } }
function saveMine(list: Saved[]): boolean { try { localStorage.setItem(STORE, JSON.stringify(list)); return true; } catch { return false; } }
const asElement = (s: Saved): Element => ({ id: s.id, name: s.name, cat: 'Shapes', make: () => JSON.parse(JSON.stringify(s.shapes)) });
/** geometry only: drop id, layer, colour, width and grouping; leave out dimensions */
function cleanShapes(ents: any[]): Shape[] {
  return ents.filter(e => e.type !== 'dim').map(e => { const { id, layer, color, w, group, ...g } = e; void id; void layer; void color; void w; void group; return JSON.parse(JSON.stringify(g)); });
}
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function thumb(el: Element): string {
  let shapes: Shape[] = []; try { shapes = placeElement(el, 40, P(0, 0)); } catch { /* broken saved element */ }
  const lines = shapes.map(s => { const f = flatten(s, 0.05), d = f.pts.map((p, i) => `${i ? 'L' : 'M'}${fmt(p.x, 2)} ${fmt(-p.y, 2)}`).join(' '); return `<path d="${d}${f.closed ? ' Z' : ''}"/>`; }).join('');
  return `<svg viewBox="-23 -23 46 46" aria-hidden="true">${lines}</svg>`;
}

/** Ask for a name and save the selected shapes as a new element under "My elements". */
export function saveSelectionAsElement(ed: Editor, after?: () => void) {
  const sel = cleanShapes(ed.selected() as any[]);
  if (!sel.length) { ed.toast('Select the shapes you want to save first (use Select, V), then try again'); return; }
  document.querySelector('#elname')?.remove();
  const root = document.createElement('div'); root.id = 'elname';
  root.innerHTML = `<form class="box" role="dialog" aria-modal="true" aria-labelledby="enTitle">
    <div class="head"><strong id="enTitle">Save as an element</strong></div>
    <div class="nbody">${thumb(asElement({ id: 'x', name: '', shapes: sel }))}
      <label>Name <input type="text" id="enName" maxlength="40" placeholder="e.g. My rocket" required></label>
      <p class="hint">${sel.length} shape${sel.length > 1 ? 's' : ''}. It will appear in <b>Make ▾ → Elements → My elements</b>, kept in this browser.</p></div>
    <div class="foot"><button type="button" class="btn" id="enCancel">Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`;
  document.body.append(root);
  const inp = root.querySelector<HTMLInputElement>('#enName')!; setTimeout(() => inp.focus(), 0);
  const close = () => { root.remove(); window.removeEventListener('keydown', onKey, true); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } };
  window.addEventListener('keydown', onKey, true);
  root.querySelector<HTMLElement>('#enCancel')!.onclick = close;
  root.addEventListener('click', e => { if (e.target === root) close(); });
  root.querySelector('form')!.addEventListener('submit', e => {
    e.preventDefault(); const name = inp.value.trim(); if (!name) return;
    const list = loadMine(); list.push({ id: 'u' + Date.now().toString(36), name, shapes: sel });
    if (!saveMine(list)) { ed.toast('Could not save here (this browser blocks saving). Try the downloaded file version of Kerf 2D.'); return; }
    close(); ed.toast(`Saved "${name}" to My elements`); after?.();
  });
}

export function openElements(ed: Editor, saveFile?: (name: string, text: string) => void) {
  document.querySelector('#elements')?.remove();
  const root = document.createElement('div'); root.id = 'elements';
  const cats = ['All', MY, ...ELEMENT_CATS];
  root.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-labelledby="eTitle">
    <div class="head"><strong id="eTitle">Elements</strong><label class="sz">Size <input type="text" inputmode="decimal" id="eSize" data-step="5" data-min="5" value="${sizeMm}"> mm</label><button class="x" id="eClose" aria-label="Close">✕</button></div>
    <div class="etabs" role="tablist">${cats.map(c => `<button type="button" role="tab" data-cat="${c}">${c === MY ? '★ ' + c : c}</button>`).join('')}<input type="search" id="eFind" placeholder="Find…" aria-label="Find an element" value="${esc(query)}"></div>
    <div class="grid" id="eGrid"></div>
    <div class="foot"><p class="hint" id="eHint"></p></div>
  </div>`;
  document.body.append(root);
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector(s) as T;
  const close = () => { root.remove(); window.removeEventListener('keydown', onKey, true); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('#elname')) { e.stopImmediatePropagation(); close(); } };
  window.addEventListener('keydown', onKey, true);
  $('#eClose').onclick = close;
  root.addEventListener('click', e => { if (e.target === root) close(); });
  const si = $<HTMLInputElement>('#eSize');
  si.onchange = si.oninput = () => { const v = parseFloat(si.value); if (v >= 5 && v <= 2000) sizeMm = v; };

  const place = (el: Element) => {
    const W = ed.view.W, H = ed.view.H, at = ed.s2w(P(W / 2, H / 2)), shapes = placeElement(el, sizeMm, P(Math.round(at.x), Math.round(at.y)));
    const g = shapes.length > 1 ? 'g' + (ed.doc.seq++) : null;
    const ids = ed.store.change(() => shapes.map(s => { const e = ed.store.add(s); if (g) e.group = [g]; return e.id; }));
    ed.setTool('select'); ed.setSelection(ids); close();
    ed.toast(`${el.name} placed (${fmt(sizeMm, 1)} mm)${g ? ' as a group' : ''} — resize it with the handles or in Properties`);
  };
  function render() {
    const mine = loadMine();
    root.querySelectorAll<HTMLElement>('.etabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.cat === cat)));
    const show = (name: string, c: string) => (cat === 'All' || c === cat) && name.toLowerCase().includes(query);
    const myCards = mine.filter(m => show(m.name, MY)).map(m => `<div class="card mine" data-mine="${m.id}" role="button" tabindex="0" title="Place ${esc(m.name)}">${thumb(asElement(m))}<span>${esc(m.name)}</span><button type="button" class="del" data-del="${m.id}" aria-label="Delete ${esc(m.name)}" title="Delete">✕</button></div>`).join('');
    const addCard = cat === MY || cat === 'All' && !query ? `<button type="button" class="card add" id="eAdd" title="Save the shapes you have selected as a new element"><svg viewBox="-23 -23 46 46" aria-hidden="true"><path d="M0 -12V12M-12 0H12"/></svg><span>Save selection…</span></button>` : '';
    const built = ELEMENTS.filter(e => show(e.name, e.cat)).map(e => `<button type="button" class="card" data-id="${e.id}" title="Place a ${e.name.toLowerCase()}">${thumb(e)}<span>${e.name}</span></button>`).join('');
    $('#eGrid').innerHTML = (cat === MY || cat === 'All' ? addCard + myCards : '') + (cat === MY ? '' : built)
      + (cat === MY && !mine.length ? `<p class="hint empty">No saved elements yet. Draw something, select it with <b>Select (V)</b>, then press <b>Save selection…</b> here (or <b>Make ▾ → Save selection as element</b>).</p>` : '');
    $('#eHint').innerHTML = cat === MY
      ? `Saved elements stay in this browser. Share them with a class: <button type="button" class="btn" id="eExport" ${mine.length ? '' : 'disabled'}>Download my elements</button> <label class="btn" for="eImport">Add from a file…</label><input type="file" id="eImport" accept=".json,.kerf-elements,application/json" hidden>`
      : `Click one to place it in the middle of your view, then stretch it, add a ring (K), or combine it with other shapes. These designs are original to Kerf 2D, so they're free to use.<br><b>More free pictures:</b> <a href="https://openclipart.org" target="_blank" rel="noopener">Openclipart</a> (public domain). Download a PNG or SVG, then drop it on Kerf: an SVG opens as outlines, a PNG/JPG opens in Trace image.`;
    root.querySelectorAll<HTMLElement>('.card[data-id]').forEach(b => b.onclick = () => place(ELEMENTS.find(e => e.id === b.dataset.id)!));
    root.querySelectorAll<HTMLElement>('.card[data-mine]').forEach(b => {
      const go = () => { const m = loadMine().find(x => x.id === b.dataset.mine); if (m) place(asElement(m)); };
      b.onclick = e => { if ((e.target as HTMLElement).closest('.del')) return; go(); };
      b.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    });
    root.querySelectorAll<HTMLElement>('.del').forEach(b => b.onclick = () => {
      const list = loadMine(), m = list.find(x => x.id === b.dataset.del); if (!m) return;
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Delete?'; b.classList.add('sure'); setTimeout(() => { if (b.isConnected) { b.dataset.sure = ''; b.textContent = '✕'; b.classList.remove('sure'); } }, 2500); return; }
      saveMine(list.filter(x => x.id !== m.id)); ed.toast(`Deleted "${m.name}"`); render();
    });
    const add = root.querySelector<HTMLElement>('#eAdd'); if (add) add.onclick = () => saveSelectionAsElement(ed, render);
    const ex = root.querySelector<HTMLElement>('#eExport');
    if (ex) ex.onclick = () => saveFile?.('my-elements.kerf-elements.json', JSON.stringify({ kerf2dElements: 1, elements: loadMine() }, null, 1));
    const im = root.querySelector<HTMLInputElement>('#eImport');
    if (im) im.onchange = async () => {
      const f = im.files?.[0]; if (!f) return;
      try {
        const d = JSON.parse(await f.text()), got: Saved[] = (Array.isArray(d) ? d : d.elements || []).filter((x: any) => x && typeof x.name === 'string' && Array.isArray(x.shapes) && x.shapes.length);
        if (!got.length) throw new Error();
        const list = loadMine(), names = new Set(list.map(x => x.name + JSON.stringify(x.shapes)));
        let n = 0; for (const g of got) if (!names.has(g.name + JSON.stringify(g.shapes))) { list.push({ id: 'u' + Date.now().toString(36) + (n++), name: g.name.slice(0, 40), shapes: g.shapes }); }
        saveMine(list); ed.toast(n ? `Added ${n} element${n > 1 ? 's' : ''}` : 'Those elements are already here'); render();
      } catch { ed.toast('That file is not a Kerf 2D elements file'); }
    };
  }
  root.querySelectorAll<HTMLElement>('.etabs button').forEach(b => b.onclick = () => { cat = b.dataset.cat!; render(); });
  const fi = $<HTMLInputElement>('#eFind'); fi.oninput = () => { query = fi.value.trim().toLowerCase(); if (query) cat = 'All'; render(); };
  render();
}
