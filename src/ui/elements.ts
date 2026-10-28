/** Elements window: pick a ready-made outline, choose its size, place it on the sheet. */
import { ELEMENTS, ELEMENT_CATS, placeElement } from '../elements/elements';
import { flatten } from '../geometry/entity';
import { P, fmt } from '../geometry/vec';
import type { Editor } from '../editor/editor';

let sizeMm = 40, cat = 'All', query = '';
function thumb(id: string): string {
  const el = ELEMENTS.find(e => e.id === id)!, shapes = placeElement(el, 40, P(0, 0));
  const lines = shapes.map(s => { const f = flatten(s, 0.05), d = f.pts.map((p, i) => `${i ? 'L' : 'M'}${fmt(p.x, 2)} ${fmt(-p.y, 2)}`).join(' '); return `<path d="${d}${f.closed ? ' Z' : ''}"/>`; }).join('');
  return `<svg viewBox="-23 -23 46 46" aria-hidden="true">${lines}</svg>`;
}
export function openElements(ed: Editor) {
  document.querySelector('#elements')?.remove();
  const root = document.createElement('div'); root.id = 'elements';
  root.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-labelledby="eTitle">
    <div class="head"><strong id="eTitle">Elements</strong><label class="sz">Size <input type="text" inputmode="decimal" id="eSize" data-step="5" data-min="5" value="${sizeMm}"> mm</label><button class="x" id="eClose" aria-label="Close">✕</button></div>
    <div class="etabs" role="tablist">${['All', ...ELEMENT_CATS].map(c => `<button type="button" role="tab" data-cat="${c}">${c}</button>`).join('')}<input type="search" id="eFind" placeholder="Find…" aria-label="Find an element" value="${query}"></div>
    <div class="grid">${ELEMENTS.map(e => `<button type="button" class="card" data-id="${e.id}" data-cat="${e.cat}" data-name="${e.name.toLowerCase()}" title="Place a ${e.name.toLowerCase()}">${thumb(e.id)}<span>${e.name}</span></button>`).join('')}</div>
    <div class="foot"><p class="hint">Click one to place it in the middle of your view, then stretch it, add a ring (K), or combine it with other shapes. These designs are original to Kerf 2D, so they're free to use.<br>
      <b>More free pictures:</b> <a href="https://openclipart.org" target="_blank" rel="noopener">Openclipart</a> (public domain — free for anything). Download a PNG or SVG, then drop it on Kerf: an SVG opens as outlines, a PNG/JPG opens in Trace image.</p></div>
  </div>`;
  document.body.append(root);
  const close = () => { root.remove(); window.removeEventListener('keydown', onKey, true); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } };
  window.addEventListener('keydown', onKey, true);
  root.querySelector<HTMLElement>('#eClose')!.onclick = close;
  root.addEventListener('click', e => { if (e.target === root) close(); });
  const filter = () => {
    root.querySelectorAll<HTMLElement>('.etabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.cat === cat)));
    root.querySelectorAll<HTMLElement>('.card').forEach(c => c.hidden = !((cat === 'All' || c.dataset.cat === cat) && c.dataset.name!.includes(query)));
  };
  root.querySelectorAll<HTMLElement>('.etabs button').forEach(b => b.onclick = () => { cat = b.dataset.cat!; filter(); });
  const fi = root.querySelector<HTMLInputElement>('#eFind')!; fi.oninput = () => { query = fi.value.trim().toLowerCase(); if (query) cat = 'All'; filter(); };
  filter();
  const si = root.querySelector<HTMLInputElement>('#eSize')!;
  si.onchange = si.oninput = () => { const v = parseFloat(si.value); if (v >= 5 && v <= 2000) sizeMm = v; };
  root.querySelectorAll<HTMLElement>('.card').forEach(b => b.onclick = () => {
    const el = ELEMENTS.find(e => e.id === b.dataset.id)!, W = ed.view.W, H = ed.view.H;
    const at = ed.s2w(P(W / 2, H / 2)), shapes = placeElement(el, sizeMm, P(Math.round(at.x), Math.round(at.y)));
    const g = shapes.length > 1 ? 'g' + (ed.doc.seq++) : null;
    const ids = ed.store.change(() => shapes.map(s => { const e = ed.store.add(s); if (g) e.group = [g]; return e.id; }));
    ed.setTool('select'); ed.setSelection(ids); close();
    ed.toast(`${el.name} placed (${fmt(sizeMm, 1)} mm)${g ? ' as a group' : ''} — resize it with the handles or in Properties`);
  });
}
