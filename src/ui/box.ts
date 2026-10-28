/** Box maker window: finger-jointed box with kerf compensation, previewed live, placed as a net. */
import { boxLayout, fingerCount, type BoxOpts } from '../box/box';
import { fmt, P } from '../geometry/vec';
import type { Editor } from '../editor/editor';

const S: BoxOpts = { w: 100, d: 70, h: 50, inside: true, t: 3, finger: 10, kerf: 0.15, clearance: 0, lid: true, layout: 'net', gap: 5 };
const FITS: [string, number][] = [['Press fit', 0], ['Normal', 0.1], ['Loose', 0.2]];

export function openBox(ed: Editor) {
  document.querySelector('#boxmaker')?.remove();
  const root = document.createElement('div'); root.id = 'boxmaker';
  const num = (id: string, label: string, v: number, step: number, unit = 'mm', min = 0) => `<label class="sl">${label} <input type="text" inputmode="decimal" id="${id}" value="${v}" data-step="${step}" data-min="${min}"> <span>${unit}</span></label>`;
  root.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-labelledby="bTitle">
    <div class="head"><strong id="bTitle">Box maker · finger joints</strong><button class="x" id="bxClose" aria-label="Close">✕</button></div>
    <div class="body">
      <div class="view"><svg id="bxSvg" aria-label="Box net preview"></svg><p class="stat" id="bxStat"></p></div>
      <div class="ctl">
        ${num('bxW', 'Width', S.w, 5)}${num('bxD', 'Depth', S.d, 5)}${num('bxH', 'Height', S.h, 5)}
        <div class="segc" id="bxIn" role="group"><button type="button" data-v="1">Inside sizes</button><button type="button" data-v="0">Outside sizes</button></div>
        ${num('bxT', 'Material thickness', S.t, 0.5, 'mm', 0.5)}${num('bxF', 'Finger width (about)', S.finger, 1, 'mm', 1)}
        ${num('bxK', 'Laser kerf', S.kerf, 0.01, 'mm', 0)}
        <label class="sl">Fit <select id="bxFit">${FITS.map(([l, v]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
        <label class="chk"><input type="checkbox" id="bxLid">Lid (closed box)</label>
        <div class="segc" id="bxLay" role="group"><button type="button" data-v="net">Net</button><button type="button" data-v="rows">Rows (saves material)</button></div>
        ${num('bxG', 'Gap between parts', S.gap, 1, 'mm', 1)}
        <p class="hint">Kerf: measure it once with a test cut (the slot width minus the drawn width, ÷1). Parts are made bigger by half the kerf so they come out the drawn size; "Fit" leaves a little room for easier assembly.</p>
      </div>
    </div>
    <div class="foot"><p class="hint" id="bxWarn"></p><button class="btn" id="bxCancel">Cancel</button><button class="btn primary" id="bxPlace">Place on sheet</button></div>
  </div>`;
  document.body.append(root);
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector(s) as T;
  const close = () => { root.remove(); window.removeEventListener('keydown', onKey, true); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } };
  window.addEventListener('keydown', onKey, true);
  const opts = (): BoxOpts => ({ ...S, sheetW: ed.doc.page.w - 10 });
  function render() {
    root.querySelectorAll<HTMLElement>('#bxIn button').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.v === '1') === S.inside)));
    root.querySelectorAll<HTMLElement>('#bxLay button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S.layout)));
    $<HTMLInputElement>('#bxLid').checked = S.lid; $<HTMLSelectElement>('#bxFit').value = String(S.clearance);
    const lay = boxLayout(opts()), pts = lay.flatMap(p => (p.shape as any).pts as { x: number; y: number }[]);
    const x0 = Math.min(...pts.map(p => p.x)), x1 = Math.max(...pts.map(p => p.x)), y0 = Math.min(...pts.map(p => p.y)), y1 = Math.max(...pts.map(p => p.y)), pad = 4;
    const svg = $('#bxSvg'); svg.setAttribute('viewBox', `${x0 - pad} ${-y1 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`);
    svg.innerHTML = lay.map(p => { const q = (p.shape as any).pts as { x: number; y: number }[], cx = q.reduce((a, b) => a + b.x, 0) / q.length, cy = q.reduce((a, b) => a + b.y, 0) / q.length;
      return `<path d="M${q.map(r => `${fmt(r.x, 3)} ${fmt(-r.y, 3)}`).join('L')}Z"/><text x="${fmt(cx, 2)}" y="${fmt(-cy, 2)}">${p.name}</text>`; }).join('');
    const t = S.t, W = S.inside ? S.w + 2 * t : S.w, D = S.inside ? S.d + 2 * t : S.d, H = S.inside ? S.h + (S.lid ? 2 : 1) * t : S.h;
    $('#bxStat').textContent = `Outside ${fmt(W, 1)} × ${fmt(D, 1)} × ${fmt(H, 1)} mm · inside ${fmt(W - 2 * t, 1)} × ${fmt(D - 2 * t, 1)} × ${fmt(H - (S.lid ? 2 : 1) * t, 1)} mm · fingers ${fingerCount(W, S.finger)} / ${fingerCount(D, S.finger)} / ${fingerCount(H, S.finger)} · ${lay.length} parts · uses ${fmt(x1 - x0, 0)} × ${fmt(y1 - y0, 0)} mm`;
    const pg = ed.doc.page, warn: string[] = [];
    if (x1 - x0 > pg.w || y1 - y0 > pg.h) warn.push(`Bigger than the ${pg.w} × ${pg.h} mm sheet${S.layout === 'net' ? ' — try Rows' : ''}`);
    if (S.finger < 2 * t) warn.push('Fingers narrower than twice the thickness are fragile');
    if (Math.min(W, D, H) < 4 * t) warn.push('Box is very small for this thickness');
    $('#bxWarn').textContent = warn.join(' · ');
  }
  const bindNum = (id: string, key: keyof BoxOpts, min = 0) => { const el = $<HTMLInputElement>(id); el.addEventListener('input', () => { const v = parseFloat(el.value); if (isFinite(v) && v >= min) { (S as any)[key] = v; render(); } }); };
  bindNum('#bxW', 'w', 5); bindNum('#bxD', 'd', 5); bindNum('#bxH', 'h', 5); bindNum('#bxT', 't', 0.5); bindNum('#bxF', 'finger', 1); bindNum('#bxK', 'kerf', 0); bindNum('#bxG', 'gap', 1);
  root.querySelectorAll<HTMLElement>('#bxIn button').forEach(b => b.onclick = () => { S.inside = b.dataset.v === '1'; render(); });
  root.querySelectorAll<HTMLElement>('#bxLay button').forEach(b => b.onclick = () => { S.layout = b.dataset.v as any; render(); });
  $<HTMLInputElement>('#bxLid').onchange = e => { S.lid = (e.target as HTMLInputElement).checked; render(); };
  $<HTMLSelectElement>('#bxFit').onchange = e => { S.clearance = +(e.target as HTMLSelectElement).value; render(); };
  $('#bxClose').onclick = close; $('#bxCancel').onclick = close;
  root.addEventListener('click', e => { if (e.target === root) close(); });
  $('#bxPlace').onclick = () => {
    const lay = boxLayout(opts()), pts = lay.flatMap(p => (p.shape as any).pts as { x: number; y: number }[]);
    const x0 = Math.min(...pts.map(p => p.x)), x1 = Math.max(...pts.map(p => p.x)), y0 = Math.min(...pts.map(p => p.y)), y1 = Math.max(...pts.map(p => p.y)), pg = ed.doc.page;
    const dx = Math.round((pg.w - (x1 - x0)) / 2 - x0), dy = Math.round((pg.h - (y1 - y0)) / 2 - y0), box = 'g' + (ed.doc.seq++);
    const ids = ed.store.change(() => lay.map(p => { const sh: any = p.shape; sh.pts = sh.pts.map((q: any) => P(+(q.x + dx).toFixed(4), +(q.y + dy).toFixed(4))); const e = ed.store.add(sh); e.group = [box]; return e.id; }));
    ed.setTool('select'); ed.setSelection(ids); close(); ed.fit();
    ed.toast(`Box placed: ${lay.length} parts as one group (Explode to move parts separately)`);
  };
  render();
}
