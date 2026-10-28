/**
 * Living hinge window (Make ▾ → Living hinge…):
 *  • Wrap a shape — a hinged strip that wraps a selected shape (or a circle), with base/lid plates;
 *  • Inside a shape — fill a selected closed shape with hinge slits;
 *  • Test strips — small strips at four spacings, to try on your material first.
 */
import { MATERIALS, recommend, wrapPlan, roundCorners, fillHinge, testStrips, slitLen, minRadius, bestPitch, pitchRange, laserTime, outlineOf, curveOf, radii, type Part, type WrapOpts, type Joint, type WrapPlan } from '../hinge/hinge';
import { isClosedShape } from '../geometry/boolean';
import { bbox, unionBox, flatten, lengthOf } from '../geometry/entity';
import { affEnt, affMove } from '../geometry/affine';
import { fmt, P, cp, type Point } from '../geometry/vec';
import type { Editor } from '../editor/editor';
import type { Shape } from '../model/types';

type Mode = 'wrap' | 'fill' | 'test';
const S = {
  mode: 'wrap' as Mode, useCircle: false, circD: 250, H: 60, mat: 'ply', t: 3, kerf: 0.15,
  where: 'bends' as 'bends' | 'all', adapt: true, D: 2.5, m: 2, G: 3.6, open: true,
  base: 'shelf' as Joint, lid: 'none' as Joint, tabs: 5, tabW: 12, lip: 5, clearance: 0.1,
  speed: 15, passes: 1, vertical: true, fillR: 40, fillL: 30, gap: 8, recommended: false,
};
const JOINTS: [Joint, string][] = [['none', 'None'], ['plain', 'Plain (just the shape)'], ['shelf', 'Shelf (two layers, easiest)'], ['tabs', 'Slots and tabs']];
const mins = (s: number) => s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`;
const metres = (mm: number) => mm >= 1000 ? `${fmt(mm / 1000, 1)} m` : `${fmt(mm, 0)} mm`;

/** Lay parts out in rows no wider than the sheet; returns each part's move. */
function layout(parts: Part[], sheetW: number, gap: number): { part: Part; dx: number; dy: number }[] {
  const out: { part: Part; dx: number; dy: number }[] = []; let x = 0, y = 0, row = 0;
  for (const part of parts) {
    const all = [...part.cut, ...(part.slits || []), ...(part.mark || [])], b = unionBox(all.map(s => bbox(s)))!; if (!b) continue;
    const w = b.x1 - b.x0, h = b.y1 - b.y0;
    if (x > 0 && x + w > sheetW) { x = 0; y -= row + gap; row = 0; }
    out.push({ part, dx: x - b.x0, dy: y - b.y1 }); x += w + gap; row = Math.max(row, h);
  }
  return out;
}
const moved = (s: Shape, dx: number, dy: number) => { const t: any = affEnt(s, affMove(P(dx, dy))); if (t.pts) t.pts = t.pts.map(cp); if (t.a) { t.a = cp(t.a); t.b = cp(t.b); } if (t.c) t.c = cp(t.c); return t as Shape; };

export function openHinge(ed: Editor) {
  document.querySelector('#hinge')?.remove();
  const selShapes = () => ed.selected().filter(e => isClosedShape(e as Shape)) as Shape[];
  const root = document.createElement('div'); root.id = 'hinge';
  const num = (id: string, label: string, v: number, step: number, unit = 'mm', min = 0, title = '') => `<label class="sl" ${title ? `title="${title}"` : ''}>${label} <input type="text" inputmode="decimal" id="${id}" value="${v}" data-step="${step}" data-min="${min}"> <span>${unit}</span></label>`;
  const seg = (id: string, items: [string, string][]) => `<div class="segc" id="${id}" role="group">${items.map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join('')}</div>`;
  const sel = (id: string, items: [string, string][]) => `<select id="${id}">${items.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`;
  root.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-labelledby="hTitle">
    <div class="head"><strong id="hTitle">Living hinge</strong>${seg('hMode', [['wrap', 'Wrap a shape'], ['fill', 'Inside a shape'], ['test', 'Test strips']])}<button class="x" id="hClose" aria-label="Close">✕</button></div>
    <div class="body">
      <div class="view"><svg id="hSvg" aria-label="Preview"></svg><p class="stat" id="hStat"></p><div class="key"><span class="k-ok">● bends fine</span><span class="k-tight">● tight</span><span class="k-bad">● too tight</span><span class="k-mark">— engrave (guide marks)</span></div></div>
      <div class="ctl">
        <div data-for="wrap">
          <h4>1 · The shape</h4>
          <p class="hint" id="hShapeInfo"></p>
          <div id="hCircRow">${num('hCircD', 'Circle diameter', S.circD, 5, 'mm', 10)}</div>
          ${num('hH', 'Strip height (wall)', S.H, 5, 'mm', 8)}
        </div>
        <div data-for="fill"><h4>1 · The shape</h4><p class="hint" id="hFillInfo"></p>
          ${seg('hDir', [['1', 'Bends left–right'], ['0', 'Bends up–down']])}
          ${num('hFillR', 'Tightest bend radius', S.fillR, 5, 'mm', 2, 'How tightly it must bend')}${num('hFillL', 'Slit length', S.fillL, 1, 'mm', 4)}</div>
        <h4>2 · Material</h4>
        <label class="sl">Material ${sel('hMat', MATERIALS.map(m => [m.id, m.name]))}</label>
        ${num('hT', 'Thickness', S.t, 0.5, 'mm', 0.5)}${num('hK', 'Laser kerf', S.kerf, 0.01, 'mm', 0)}
        <div data-for="wrap fill">
          <h4>3 · Hinge cuts <button type="button" class="btn primary rec" id="hRec" title="Choose spacing, slit length and gaps for this shape and material">★ Recommend</button></h4>
          <div data-for="wrap">${seg('hWhere', [['bends', 'Only where it bends'], ['all', 'All the way round']])}
          ${seg('hAdapt', [['1', 'Spacing fits the curve'], ['0', 'Same spacing']])}</div>
          <div id="hDRow">${num('hD', 'Spacing between cuts', S.D, 0.1, 'mm', 0.3)}</div>
          <div data-for="wrap">${num('hM', 'Slits across the strip', S.m, 1, '', 1)}</div>
          ${num('hG', 'Gap (bridge)', S.G, 0.1, 'mm', 0.5, 'Solid wood left between slits and at the edges')}
          <label class="chk" data-for="wrap"><input type="checkbox" id="hOpen">Slits run out to the edges (bends more easily)</label>
        </div>
        <div data-for="wrap">
          <h4>4 · Joining it</h4>
          <label class="sl">Base ${sel('hBase', JOINTS)}</label>
          <label class="sl">Lid ${sel('hLid', JOINTS)}</label>
          <div id="hTabRow">${num('hTabs', 'Tabs', S.tabs, 1, '', 1)}${num('hTabW', 'Tab width', S.tabW, 1, 'mm', 3)}${num('hFit', 'Slot clearance', S.clearance, 0.05, 'mm', 0)}</div>
          <div id="hLipRow">${num('hLip', 'Ledge round the strip', S.lip, 1, 'mm', 1)}</div>
        </div>
        <h4>Laser time</h4>
        ${num('hSp', 'Cutting speed', S.speed, 1, 'mm/s', 0.5)}${num('hPa', 'Passes', S.passes, 1, '', 1)}
        <p class="hint" id="hHelp"></p>
      </div>
    </div>
    <div class="foot"><div class="warn" id="hWarn"></div><button class="btn" id="hCancel">Cancel</button><button class="btn primary" id="hPlace">Place on sheet</button></div>
  </div>`;
  document.body.append(root);
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector(s) as T;
  const close = () => { root.remove(); window.removeEventListener('keydown', onKey, true); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } };
  window.addEventListener('keydown', onKey, true);
  $('#hClose').onclick = close; $('#hCancel').onclick = close;
  root.addEventListener('click', e => { if (e.target === root) close(); });
  if (!selShapes().length) S.useCircle = true; else S.useCircle = false;

  const mat = () => MATERIALS.find(m => m.id === S.mat) || MATERIALS[0];
  const shapes = (): Shape[] => S.useCircle || !selShapes().length ? [{ type: 'circle', c: P(0, 0), r: S.circD / 2 } as Shape] : selShapes().map(e => structuredClone(e) as Shape);
  const opts = (): WrapOpts => ({ H: S.H, t: S.t, kerf: S.kerf, mat: mat(), sf: 1.5, pattern: { D: S.D, m: Math.max(1, Math.round(S.m)), G: S.G, open: S.open },
    adapt: S.adapt, where: S.where, base: S.base, lid: S.lid, tabs: S.tabs, tabW: S.tabW, lip: S.lip, clearance: S.clearance, maxLen: ed.doc.page.w - 10 });
  /** tightest radius the hinge part of the shape needs (for Recommend) */
  const tightest = (): number => {
    const o = outlineOf(shapes()); if (!o) return 50;
    const r = radii(curveOf(o)), freeR = mat().freeK * S.t; let m = Infinity;
    for (const x of r.R) { const a = Math.abs(x) + S.t / 2; if (a < m && a > pitchRange(S.t, S.kerf, mat()).lo) m = a; }
    return isFinite(m) && m < freeR ? m : Math.min(freeR, 200);
  };
  let current: { parts: Part[]; plan?: WrapPlan; ghost?: Shape[]; error?: string } = { parts: [] };

  function compute() {
    if (S.mode === 'wrap') {
      const p = wrapPlan(shapes(), opts());
      if ('error' in p) { current = { parts: [], error: p.error }; return; }
      current = { parts: p.parts, plan: p, ghost: S.base === 'none' ? shapes() : undefined };
    } else if (S.mode === 'fill') {
      const sh = selShapes();
      if (!sh.length) { current = { parts: [], error: 'Select a closed shape first (use Select, V), then open Living hinge again' }; return; }
      const slits = fillHinge(sh as Shape[], { D: S.D, m: 1, G: S.G, open: false }, S.fillL, S.vertical);
      current = { parts: [{ name: 'Hinge slits', cut: [], slits }], ghost: sh as Shape[] };
    } else current = { parts: testStrips(S.t, S.kerf, mat()).map(x => x.part) };
  }

  function render() {
    root.querySelectorAll<HTMLElement>('[data-for]').forEach(el => el.hidden = !el.dataset.for!.split(' ').includes(S.mode));
    const pressed = (id: string, v: string) => root.querySelectorAll<HTMLElement>(`#${id} button`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
    pressed('hMode', S.mode); pressed('hWhere', S.where); pressed('hAdapt', S.adapt ? '1' : '0'); pressed('hDir', S.vertical ? '1' : '0');
    $<HTMLSelectElement>('#hMat').value = S.mat; $<HTMLSelectElement>('#hBase').value = S.base; $<HTMLSelectElement>('#hLid').value = S.lid; $<HTMLInputElement>('#hOpen').checked = S.open;
    const hasSel = selShapes().length > 0;
    $('#hShapeInfo').innerHTML = hasSel ? (S.useCircle ? `Using a circle. <button type="button" class="lnk" id="hUseSel">Use my selected shape instead</button>` : `Using your selected shape. <button type="button" class="lnk" id="hUseCirc">Use a circle instead</button>`)
      : 'No shape selected, so this wraps a circle. To wrap your own shape (e.g. a jelly bean), close this, select the shape and open it again.';
    $('#hCircRow').hidden = !S.useCircle && hasSel;
    $('#hFillInfo').innerHTML = hasSel ? 'Fills your selected shape with slits, keeping a gap from its edge.' : '<b>Select a closed shape first</b> (use Select, V), then open Living hinge again.';
    $('#hDRow').hidden = S.mode === 'wrap' && S.adapt;
    $('#hTabRow').hidden = !(S.base === 'tabs' || S.lid === 'tabs'); $('#hLipRow').hidden = !(['shelf', 'tabs'].includes(S.base) || ['shelf', 'tabs'].includes(S.lid));
    const u1 = root.querySelector<HTMLElement>('#hUseSel'), u2 = root.querySelector<HTMLElement>('#hUseCirc');
    if (u1) u1.onclick = () => { S.useCircle = false; update(); }; if (u2) u2.onclick = () => { S.useCircle = true; update(); };
    $('#hHelp').innerHTML = S.mode === 'wrap'
      ? 'The strip length is measured along the <b>middle of the wood</b> — the line that neither stretches nor squashes — so it wraps exactly. Shapes with sharp corners need rounding first. Glue or clamp the strip as it goes round.'
      : S.mode === 'fill' ? 'Good for book covers, bendy panels and lamp shades. The slits bend the wood across their direction.'
      : 'Cut these four strips from the wood you will use. Bend each one round something round: the widest spacing that still bends without cracking is the one to use. Strip 1 has one hole, strip 2 two holes, and so on.';
    // preview
    const lay = layout(current.parts, ed.doc.page.w, S.gap), lines: string[] = [];
    const d = (s: Shape) => { const f = flatten(s, 0.05); return `M${f.pts.map(q => `${fmt(q.x, 2)} ${fmt(-q.y, 2)}`).join('L')}${f.closed ? 'Z' : ''}`; };
    for (const { part, dx, dy } of lay) {
      for (const s of part.cut) lines.push(`<path class="cut" d="${d(moved(s, dx, dy))}"/>`);
      (part.slits || []).forEach((s, i) => lines.push(`<path class="sl ${part.slitState?.[i] || 'ok'}" d="${d(moved(s, dx, dy))}"/>`));
      for (const s of part.mark || []) lines.push(`<path class="mk" d="${d(moved(s, dx, dy))}"/>`);
      const b = unionBox(part.cut.concat(part.slits || []).map(s => bbox(moved(s, dx, dy))))!;
      if (b) lines.push(`<text x="${fmt((b.x0 + b.x1) / 2, 1)}" y="${fmt(-b.y1 - 2, 1)}">${part.name}</text>`);
    }
    // the shape itself, with too-sharp corners ringed in red
    let ghostOff: Point | null = null;
    if (current.ghost?.length && S.mode === 'wrap') {
      const all = lay.flatMap(l => [...l.part.cut, ...(l.part.slits || [])].map(s => bbox(moved(s, l.dx, l.dy)))), B = unionBox(all), g = unionBox(current.ghost.map(s => bbox(s)))!;
      ghostOff = B ? P(B.x0 - g.x0, B.y0 - 10 - g.y1) : P(0, 0);
      for (const s of current.ghost) lines.push(`<path class="ghost" d="${d(moved(s, ghostOff.x, ghostOff.y))}"/>`);
      lines.push(`<text x="${fmt((g.x0 + g.x1) / 2 + ghostOff.x, 1)}" y="${fmt(-(g.y1 + ghostOff.y) - 2, 1)}">your shape (not cut)</text>`);
    } else if (current.ghost?.length) for (const s of current.ghost) lines.push(`<path class="ghost" d="${d(s)}"/>`);
    if (current.plan?.corners.length) {
      const base = lay.find(l => l.part.name.startsWith('Base') || l.part.name === 'Lid'), off = base ? P(base.dx, base.dy) : ghostOff;
      if (off) for (const c of current.plan.corners) lines.push(`<circle class="bad" cx="${fmt(c.x + off.x, 2)}" cy="${fmt(-(c.y + off.y), 2)}" r="${fmt(Math.max(3, S.t * 2), 1)}"/>`);
    }
    const svg = $('#hSvg');
    const bs = [...lay.flatMap(l => [...l.part.cut, ...(l.part.slits || []), ...(l.part.mark || [])].map(s => bbox(moved(s, l.dx, l.dy)))), ...(current.ghost || []).map(s => bbox(ghostOff ? moved(s, ghostOff.x, ghostOff.y) : s))];
    const B = unionBox(bs);
    if (B) { const pad = 8; svg.setAttribute('viewBox', `${fmt(B.x0 - pad, 2)} ${fmt(-B.y1 - pad - 4, 2)} ${fmt(B.x1 - B.x0 + 2 * pad, 2)} ${fmt(B.y1 - B.y0 + 2 * pad + 4, 2)}`); }
    svg.innerHTML = current.error ? '' : lines.join('');
    // stats & warnings
    const warn: string[] = [];
    if (current.error) { $('#hStat').textContent = current.error; $('#hWarn').innerHTML = ''; $<HTMLButtonElement>('#hPlace').disabled = true; return; }
    $<HTMLButtonElement>('#hPlace').disabled = false;
    const slitN = current.parts.reduce((a, p) => a + (p.slits?.length || 0), 0);
    const cut = current.plan ? current.plan.cutLen : current.parts.reduce((a, p) => a + [...p.cut, ...(p.slits || [])].reduce((b, s) => b + lengthOf(s), 0), 0);
    const paths = current.parts.reduce((a, p) => a + p.cut.length + (p.slits?.length || 0), 0), time = laserTime(cut, paths, S.speed, S.passes);
    if (S.mode === 'wrap' && current.plan) {
      const p = current.plan, L = slitLen(S.H, Math.max(1, Math.round(S.m)), S.G);
      $('#hStat').innerHTML = `<b>Strip length ${fmt(p.total, 1)} mm</b> (round the middle of the wood) · height ${fmt(S.H, 1)} mm · tightest bend R ${isFinite(p.tightest) ? fmt(p.tightest - S.t / 2, 1) : '—'} mm · slits ${fmt(L, 1)} mm long${p.columns.length ? `, spacing ${p.Drange[0] === p.Drange[1] ? fmt(p.Drange[0], 2) : `${fmt(p.Drange[0], 2)}–${fmt(p.Drange[1], 2)}`} mm` : ''} · <b>${slitN} slits</b> · cutting ${metres(cut)} · <b>about ${mins(time)}</b>`;
      const st = p.state === 'ok' ? '<span class="ok">✓ It should bend round your shape.</span>' : p.state === 'tight' ? '<span class="tight">⚠ Some bends are tight — press ★ Recommend, or make test strips first.</span>' : '<span class="bad">✕ Too tight in places (red). Press ★ Recommend, use a taller strip, or round the corners.</span>';
      warn.push(st);
      for (const w of p.warnings) warn.push(w);
      if (p.corners.length && !S.useCircle && selShapes().length) {
        const r = roundRadius(); warn.push(`<button type="button" class="btn" id="hRound">Round the corners (R ${fmt(r, 1)} mm)</button>`);
      }
    } else if (S.mode === 'fill') {
      const Rm = minRadius(S.D, S.fillL, S.t, S.kerf, mat().gamma);
      $('#hStat').innerHTML = `<b>${slitN} slits</b>, ${fmt(S.fillL, 1)} mm long, ${fmt(S.D, 2)} mm apart · bends to about R ${fmt(Rm * 1.5, 0)} mm · cutting ${metres(cut)} · <b>about ${mins(time)}</b>`;
      warn.push(Rm * 1.5 <= S.fillR ? '<span class="ok">✓ Should bend to the radius you want.</span>' : Rm <= S.fillR ? '<span class="tight">⚠ Tight — press ★ Recommend.</span>' : '<span class="bad">✕ Too stiff for that radius — press ★ Recommend.</span>');
      if (mat().warn) warn.push(mat().note!);
    } else {
      $('#hStat').innerHTML = `4 test strips · ${slitN} slits · cutting ${metres(cut)} · about ${mins(time)}`;
    }
    if (!S.recommended && S.mode !== 'test') warn.push('Tip: press <b>★ Recommend</b> to choose the cuts for you.');
    $('#hWarn').innerHTML = warn.map(w => `<div>${w}</div>`).join('');
    const rb = root.querySelector<HTMLElement>('#hRound'); if (rb) rb.onclick = roundSel;
  }
  /** smallest inside-corner radius this material and strip can bend round */
  function roundRadius(): number {
    const L = slitLen(S.H, Math.max(1, Math.round(S.m)), S.G), m = mat(), { lo } = pitchRange(S.t, S.kerf, m);
    return Math.max(3 * S.t, Math.ceil(minRadius(lo, Math.max(L, 1), S.t, S.kerf, m.gamma) * 1.5 - S.t / 2 + 0.5));
  }
  function roundSel() {
    const sel = selShapes(); if (!sel.length) return;
    const r = roundRadius(), res = roundCorners(sel as Shape[], r);
    if (!res) { ed.toast('That shape is too small to round by ' + fmt(r, 1) + ' mm'); return; }
    const ids = ed.store.change(() => { ed.store.remove(sel.map(e => (e as any).id as string)); return [ed.store.add(res).id]; });
    ed.setSelection(ids); ed.toast(`Corners rounded to R ${fmt(r, 1)} mm (Undo puts them back)`); update();
  }
  function doRecommend() {
    const m = mat();
    if (S.mode === 'wrap') {
      const R = tightest(), r = recommend(S.H, S.t, S.kerf, m, R);
      S.G = r.G; S.m = r.m; S.D = r.D; S.recommended = true;
      ed.toast(r.error ? r.error : r.ok ? `Recommended: ${r.m} slit${r.m > 1 ? 's' : ''} across, ${fmt(r.L, 1)} mm long, gap ${fmt(r.G, 1)} mm, spacing ${S.adapt ? 'fitted to each curve' : fmt(r.D, 2) + ' mm'}` : 'Even the closest spacing is too stiff for the tightest curve — round the corners or use a taller strip');
    } else if (S.mode === 'fill') {
      S.G = Math.round(Math.max(1.5, 1.2 * S.t) * 10) / 10; const D = bestPitch(S.fillR, S.fillL, S.t, S.kerf, m, 1.5);
      S.D = D ?? pitchRange(S.t, S.kerf, m).lo; S.recommended = true;
      ed.toast(D ? `Recommended spacing ${fmt(S.D, 2)} mm` : 'Too tight even at the closest spacing — use longer slits or a gentler bend');
    }
    syncInputs(); update();
  }
  function syncInputs() {
    const set = (id: string, v: number) => { const el = $<HTMLInputElement>(id); if (document.activeElement !== el) el.value = String(+v.toFixed(3)); };
    set('#hD', S.D); set('#hM', S.m); set('#hG', S.G); set('#hCircD', S.circD); set('#hH', S.H); set('#hT', S.t); set('#hK', S.kerf);
    set('#hTabs', S.tabs); set('#hTabW', S.tabW); set('#hFit', S.clearance); set('#hLip', S.lip); set('#hSp', S.speed); set('#hPa', S.passes); set('#hFillR', S.fillR); set('#hFillL', S.fillL);
  }
  let timer = 0;
  function update() { compute(); render(); }
  const later = () => { clearTimeout(timer); timer = window.setTimeout(update, 120); };
  const bindNum = (id: string, key: keyof typeof S, min = 0) => { const el = $<HTMLInputElement>(id); el.addEventListener('input', () => { const v = parseFloat(el.value); if (isFinite(v) && v >= min) { (S as any)[key] = v; later(); } }); };
  bindNum('#hCircD', 'circD', 10); bindNum('#hH', 'H', 8); bindNum('#hT', 't', 0.5); bindNum('#hK', 'kerf', 0); bindNum('#hD', 'D', 0.3); bindNum('#hM', 'm', 1); bindNum('#hG', 'G', 0.5);
  bindNum('#hTabs', 'tabs', 1); bindNum('#hTabW', 'tabW', 3); bindNum('#hFit', 'clearance', 0); bindNum('#hLip', 'lip', 1); bindNum('#hSp', 'speed', 0.5); bindNum('#hPa', 'passes', 1);
  bindNum('#hFillR', 'fillR', 2); bindNum('#hFillL', 'fillL', 4);
  const segBind = (id: string, f: (v: string) => void) => root.querySelectorAll<HTMLElement>(`#${id} button`).forEach(b => b.onclick = () => { f(b.dataset.v!); update(); });
  segBind('hMode', v => S.mode = v as Mode); segBind('hWhere', v => S.where = v as any); segBind('hAdapt', v => S.adapt = v === '1'); segBind('hDir', v => S.vertical = v === '1');
  $<HTMLSelectElement>('#hMat').onchange = e => { S.mat = (e.target as HTMLSelectElement).value; update(); };
  $<HTMLSelectElement>('#hBase').onchange = e => { S.base = (e.target as HTMLSelectElement).value as Joint; update(); };
  $<HTMLSelectElement>('#hLid').onchange = e => { S.lid = (e.target as HTMLSelectElement).value as Joint; update(); };
  $<HTMLInputElement>('#hOpen').onchange = e => { S.open = (e.target as HTMLInputElement).checked; update(); };
  $('#hRec').onclick = doRecommend;
  $('#hPlace').onclick = () => {
    if (current.error || !current.parts.length) return;
    if (S.mode === 'fill') {
      const slits = current.parts[0].slits || [], g = 'g' + (ed.doc.seq++);
      const ids = ed.store.change(() => slits.map(s => { const e = ed.store.add(s); e.group = [g]; return e.id; }));
      ed.setTool('select'); ed.setSelection(ids); close(); ed.toast(`${ids.length} hinge slits added inside your shape (grouped)`); return;
    }
    const lay = layout(current.parts, ed.doc.page.w - 10, S.gap), boxes = lay.flatMap(l => [...l.part.cut, ...(l.part.slits || [])].map(s => bbox(moved(s, l.dx, l.dy)))), B = unionBox(boxes)!, pg = ed.doc.page;
    const ox = Math.round((pg.w - (B.x1 - B.x0)) / 2 - B.x0), oy = Math.round((pg.h - (B.y1 - B.y0)) / 2 - B.y0);
    const ids = ed.store.change(() => lay.flatMap(({ part, dx, dy }) => {
      const g = 'g' + (ed.doc.seq++), out: string[] = [];
      for (const s of [...part.cut, ...(part.slits || [])]) { const e = ed.store.add(moved(s, dx + ox, dy + oy)); e.group = [g]; out.push(e.id); }
      for (const s of part.mark || []) { const e = ed.store.add(moved(s, dx + ox, dy + oy), { color: 'blue' }); e.group = [g]; out.push(e.id); }
      return out;
    }));
    ed.setTool('select'); ed.setSelection(ids); close(); ed.fit();
    const big = B.x1 - B.x0 > pg.w || B.y1 - B.y0 > pg.h;
    ed.toast(`${current.parts.length} part${current.parts.length > 1 ? 's' : ''} placed, each as a group${current.parts.some(p => p.mark?.length) ? ' · blue lines are engrave guides' : ''}${big ? ' · bigger than the bed: move parts onto more sheets' : ''}`);
  };
  syncInputs(); update();
}
