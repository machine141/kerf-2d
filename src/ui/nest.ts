/** Nest window: fit many parts (e.g. 30 key rings) on the sheet — or several sheets — previewed live, then placed. */
import type { Editor } from '../editor/editor';
import { sheetX, type Entity, type Shape } from '../model/types';
import { fmt, P, type Point } from '../geometry/vec';
import { affEnt } from '../geometry/affine';
import { MultiNester, nestOrder, placeTransform, rng, growOutline, type NestJob, type MultiResult, type IP } from '../nest/nest';
import { findParts, nestShape, outlineOf, type Part } from '../nest/parts';
import { sheetOf } from '../io/sheets';
import { modeOf } from '../model/types';
import { lineIssues } from '../nest/problems';
import { closePairs } from '../nest/verify';

const TURNS: [string, string, number][] = [['none', 'No turning', 0], ['90', '90°', 4], ['45', '45°', 8], ['15', 'Any (15°)', 24]];
const S = { copies: 1, fill: false, gap: 2, margin: 5, turn: '90', clear: true, more: false };
export interface NestOpen { /** start with "use more sheets" on and one of each (class worksheets) */ classMode?: boolean }

export function openNest(ed: Editor, o: NestOpen = {}) {
  const visible = new Set(ed.doc.layers.filter(l => l.visible).map(l => l.id));
  const usable = (e: Entity) => visible.has(e.layer) && e.type !== 'dim';
  const picked = ed.sel.size ? [...ed.withGroups(ed.sel)].map(id => ed.store.byId(id)!).filter(e => e && usable(e)) : ed.doc.ents.filter(usable);
  const parts: Part[] = findParts(picked, e => ed.groupRoot(e));
  if (!parts.length) { ed.toast('Nothing to nest: draw or select some parts first'); return; }
  if (o.classMode) { S.copies = 1; S.fill = false; S.more = true; }
  const pickedIds = new Set(picked.map(e => e.id));
  // other things already on the first sheet are kept clear of
  const others = ed.doc.ents.filter(e => usable(e) && !pickedIds.has(e.id) && sheetOf(ed.doc, e as Shape) === 0);
  const counts = parts.map(() => S.copies);
  const ownerOf = (p: Part) => p.ids.map(id => ed.store.byId(id)?.owner).find(Boolean);
  // cut lines inside each design that cross, touch or lie on top of each other
  const issues = parts.map(p => lineIssues(p.ids.map(id => ed.store.byId(id)!).filter(Boolean), e => modeOf(ed.doc, e.color) === 'cut'));
  const hasIssue = (k: number) => issues[k].cross.length + issues[k].overlap.length > 0;
  const nameOf = (k: number) => ownerOf(parts[k])?.split(' · ')[0] || `the ${thumbs[k]?.label.replace(/ mm$/, '')} mm part`;

  document.querySelector('#boxmaker')?.remove();
  const root = document.createElement('div'); root.id = 'boxmaker'; root.className = 'nest';
  const num = (id: string, label: string, v: number, unit = 'mm') => `<label class="sl">${label} <input type="text" inputmode="decimal" id="${id}" value="${v}"> <span>${unit}</span></label>`;
  const pg = ed.doc.page, SG = sheetX(ed.doc, 1) - pg.w;
  root.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-labelledby="nTitle">
    <div class="head"><strong id="nTitle">Nest parts on the sheet</strong><button class="x" id="nClose" aria-label="Close">✕</button></div>
    <div class="body">
      <div class="view"><svg id="nSvg" aria-label="Layout preview"></svg><p class="stat" id="nStat"></p></div>
      <div class="ctl">
        <p class="hint">${parts.length} part${parts.length > 1 ? 's' : ''} ${ed.sel.size ? 'from your selection' : 'in the drawing'}. A part is a group, or a shape with everything inside or touching it (holes, engraving, a ring).</p>
        <label class="sl">How many of each <input type="text" inputmode="numeric" id="nCopies" value="${S.copies}"> <span></span></label>
        <label class="chk"><input type="checkbox" id="nFill" ${S.fill ? 'checked' : ''}>Fill the sheet (as many as fit)</label>
        <label class="chk"><input type="checkbox" id="nMore" ${S.more ? 'checked' : ''}>Use more sheets if they don't all fit</label>
        <div class="nparts" id="nParts"></div>
        ${num('nGap', 'Gap between parts', S.gap)}${num('nMargin', 'Margin from the edge', S.margin)}
        <div>Turning parts<div class="segc" id="nTurn" role="group">${TURNS.map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join('')}</div></div>
        ${others.length ? `<label class="chk"><input type="checkbox" id="nClear" ${S.clear ? 'checked' : ''}>Keep clear of the other ${others.length} object${others.length > 1 ? 's' : ''} on the sheet</label>` : ''}
        <p class="hint">Sheet: ${pg.w} × ${pg.h} mm (change it with Bed in the top bar). Gap: at least the kerf, 2 mm is a safe start. No turning keeps the wood grain the same way on every part.</p>
      </div>
    </div>
    <div class="foot"><p class="hint" id="nWarn"></p><button class="btn" id="nHarder" title="Tries more orders and keeps the best layout">Try harder</button><button class="btn" id="nCancel">Cancel</button><button class="btn primary" id="nPlace">Place on sheet</button></div>
  </div>`;
  document.body.append(root);
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector(s) as T;

  // ---- parts list with thumbnails and their own counts ----
  const pathD = (polys: Point[][]) => polys.map(q => 'M' + q.map(p => `${fmt(p.x, 2)} ${fmt(-p.y, 2)}`).join('L') + 'Z').join('');
  const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const thumbs = parts.map(p => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of p.polys) for (const v of q) { x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); } const who = ownerOf(p); return { vb: `${x0 - 1} ${-y1 - 1} ${x1 - x0 + 2} ${y1 - y0 + 2}`, d: pathD(p.polys), label: (who ? esc(who) + ' · ' : '') + `${fmt(x1 - x0, 1)} × ${fmt(y1 - y0, 1)} mm` }; });
  const issueText = (k: number) => [issues[k].cross.length ? `${issues[k].cross.length} place${issues[k].cross.length > 1 ? 's' : ''} where lines cross or touch` : '', issues[k].overlap.length ? 'lines drawn on top of each other' : ''].filter(Boolean).join(' · ');
  const renderParts = () => {
    $('#nParts').innerHTML = parts.length > 1 || !S.fill ? parts.map((_, i) => `<div class="np${hasIssue(i) ? ' bad' : ''}"><svg viewBox="${thumbs[i].vb}"><path d="${thumbs[i].d}"/></svg><span>${thumbs[i].label}${hasIssue(i) ? `<br><b>⚠ ${issueText(i)}</b>` : ''}</span>${S.fill ? '' : `<label>× <input type="text" inputmode="numeric" data-i="${i}" value="${counts[i]}"></label>`}</div>`).join('') : '';
    root.querySelectorAll<HTMLInputElement>('#nParts input').forEach(inp => inp.addEventListener('input', () => { const v = parseInt(inp.value); if (v >= 0 && v <= 2000) { counts[+inp.dataset.i!] = v; restart(); } }));
  };

  // ---- the job and the run ----
  const angles = () => { const n = TURNS.find(t => t[0] === S.turn)![2]; return n ? Array.from({ length: n }, (_, i) => i * 2 * Math.PI / n) : [0]; };
  let job: NestJob, shapes: ReturnType<typeof nestShape>[] = [], shapesGap = -1, cache = new Map<string, IP[]>();
  const makeJob = (): NestJob => {
    if (shapesGap !== S.gap) { shapes = parts.map(p => nestShape(p, S.gap)); shapesGap = S.gap; cache = new Map(); }
    const fixed = S.clear && others.length ? growOutline(others.flatMap(e => outlineOf(e)), S.gap / 2) : undefined;
    return { shapes, counts: S.fill ? parts.map(() => Infinity) : counts.slice(), W: pg.w, H: pg.h, margin: S.margin, gap: S.gap, angles: angles(), fixed };
  };
  const multi = () => S.more && !S.fill;
  let lineWarn = '';
  let best: MultiResult | null = null, runId = 0, tries = 0, harder = false;
  const better = (a: MultiResult, b: MultiResult | null) => !b || a.score < b.score - 1e-6;
  async function run(rnd?: () => number) {
    const my = runId, n = new MultiNester(job, nestOrder(job, rnd), cache, multi() ? 20 : 1);
    let t0 = performance.now();
    while (n.step()) {
      if (my !== runId) return null;
      if (performance.now() - t0 > 30) { if (!best) draw(n.result(), n.progress); await new Promise(r => setTimeout(r, 0)); t0 = performance.now(); }
    }
    return my === runId ? n.result() : null;
  }
  let timer = 0;
  function restart() { clearTimeout(timer); timer = window.setTimeout(start, 150); }
  async function start() {
    runId++; best = null; tries = 0; setHarder(false);
    job = makeJob();
    const r = await run(); if (!r) return;
    best = r; tries = 1; draw(best);
  }
  async function tryHarder() {
    setHarder(true); const my = runId, t0 = performance.now();
    while (harder && my === runId && performance.now() - t0 < 30000) {
      const r = await run(rng(1 + tries * 7919)); if (!r || my !== runId) return;
      tries++; if (better(r, best)) best = r; draw(best!);
    }
    if (my === runId) setHarder(false);
  }
  function setHarder(on: boolean) { harder = on; $('#nHarder').textContent = on ? 'Stop' : 'Try harder'; if (!on && best) draw(best); }

  // ---- preview: every sheet side by side ----
  function draw(r: MultiResult, progress?: number) {
    const svg = $('#nSvg'), pad = 6, n = Math.max(1, r.sheets.length), Wt = n * pg.w + (n - 1) * SG;
    svg.setAttribute('viewBox', `${-pad} ${-pg.h - pad - 10} ${Wt + 2 * pad} ${pg.h + 2 * pad + 10}`);
    const m = S.margin, out: string[] = [];
    for (let k = 0; k < n; k++) {
      const x = k * (pg.w + SG);
      out.push(`<rect class="sheet" x="${x}" y="${-pg.h}" width="${pg.w}" height="${pg.h}"/>`, `<rect class="marg" x="${x + m}" y="${-pg.h + m}" width="${Math.max(0, pg.w - 2 * m)}" height="${Math.max(0, pg.h - 2 * m)}"/>`);
      if (n > 1) out.push(`<text class="sh" x="${x}" y="${-pg.h - 3}">Sheet ${k + 1}</text>`);
    }
    if (job.fixed) out.push(`<path class="fixed" d="${pathD(others.flatMap(e => outlineOf(e)))}"/>`);
    // every placed part, where it lands; problem parts in red with a ring round each trouble spot
    const laid: { k: number; polys: Point[][] }[] = [], rings: string[] = [];
    r.sheets.forEach((sr, sk) => { for (const p of sr.placed) {
      const A = placeTransform(P(0, 0), p.angle, P(p.at.x + sk * (pg.w + SG), p.at.y)), map = (v: Point) => P(A.a * v.x + A.b * v.y + A.e, A.c * v.x + A.d * v.y + A.f);
      laid.push({ k: p.shape, polys: shapes[p.shape].raw.map(q => q.map(map)) });
      if (hasIssue(p.shape)) { const c = shapes[p.shape].centre; for (const q of [...issues[p.shape].cross, ...issues[p.shape].overlap]) { const m = map(P(q.x - c.x, q.y - c.y)); rings.push(`<circle class="hit" cx="${fmt(m.x, 2)}" cy="${fmt(-m.y, 2)}" r="2.5"/>`); } }
    } });
    const close = progress === undefined ? closePairs(laid, S.gap) : [], tooClose = new Set(close.flat());
    laid.forEach((l, i) => out.push(`<path${hasIssue(l.k) || tooClose.has(i) ? ' class="bad"' : ''} d="${pathD(l.polys)}"/>`));
    out.push(...rings);
    svg.innerHTML = out.join('');
    const badParts = [...new Set(laid.filter(l => hasIssue(l.k)).map(l => l.k))];
    lineWarn = (badParts.length ? `⚠ ${badParts.length} design${badParts.length > 1 ? 's have' : ' has'} cut lines that cross, touch or overlap (red rings): ${badParts.slice(0, 5).map(nameOf).join(', ')}${badParts.length > 5 ? '…' : ''}. The laser would cut extra pieces or burn twice — Union them into one outline, or move them apart. ` : '')
      + (close.length ? `⚠ ${close.length} pair${close.length > 1 ? 's' : ''} of parts closer than the gap (red). ` : '');
    const want = S.fill ? null : counts.reduce((a, b) => a + b, 0), miss = r.missing.reduce((a, b) => a + b, 0);
    const use = r.sheets.length ? Math.round(r.sheets.reduce((t, s) => t + s.use, 0) / r.sheets.length * 100) : 0;
    const sheets = r.sheets.length > 1 ? `${r.sheets.length} sheets · ` : '';
    const lb = r.sheets[r.sheets.length - 1]?.box, box = lb ? ` · ${r.sheets.length > 1 ? 'last sheet' : 'layout'} ${fmt(lb[2] - lb[0], 0)} × ${fmt(lb[3] - lb[1], 0)} mm` : '';
    $('#nStat').textContent = progress !== undefined ? `Placing… ${Math.round(progress * 100)} %` :
      `${r.placed}${want !== null ? ` of ${want}` : ''} placed · ${sheets}${use} % of the sheet${r.sheets.length > 1 ? 's' : ''} used${box}${tries > 1 ? ` · best of ${tries} tries` : ''}${harder ? ' · trying more…' : ''}`;
    $('#nWarn').textContent = progress !== undefined ? '' : lineWarn + (miss ? `${miss} didn't fit${multi() ? ' on any sheet (bigger than the sheet?)' : ''}${S.fill ? '' : ' — copies are not made; your own parts go beside the sheet'}.${multi() ? '' : ' Tick "Use more sheets", or try a smaller gap or more turning.'}` : r.placed ? '' : 'Nothing fits on this sheet.');
    ($('#nPlace') as HTMLButtonElement).disabled = progress !== undefined || !r.placed;
  }

  // ---- place ----
  function place() {
    if (!best) return;
    const r = best, made: string[] = [], beside: number[] = [], nS = Math.max(1, r.sheets.length);
    const placed = r.sheets.flatMap((sr, k) => sr.placed.map(p => ({ ...p, at: P(p.at.x + sheetX(ed.doc, k), p.at.y) })));
    ed.store.change(() => {
      // keep any sheet that still has other things on it
      let keep = nS; for (const e of ed.doc.ents) if (!pickedIds.has(e.id)) keep = Math.max(keep, sheetOf(ed.doc, e as Shape) + 1);
      ed.doc.sheets = keep;
      let bx = sheetX(ed.doc, keep - 1) + pg.w + 10;
      parts.forEach((part, k) => {
        const own = part.ids.map(id => ed.store.byId(id)!).filter(Boolean), pls = placed.filter(p => p.shape === k);
        // a part made of several loose objects is grouped, so it moves as one afterwards
        const roots = new Set(own.map(e => ed.groupRoot(e))), groupIt = own.length > 1 && (roots.size > 1 || roots.has(null));
        if (!pls.length) {
          // a part of yours that didn't fit: put it beside the sheets so nothing is lost
          const sh = shapes[k], w = sh.raw.flat().reduce((m, v) => Math.max(m, v.x), 0) * 2, h = sh.raw.flat().reduce((m, v) => Math.max(m, v.y), 0);
          const A = placeTransform(sh.centre, 0, P(bx + w / 2, pg.h - h)); bx += w + 10;
          for (const e of own) ed.store.replace(e.id, affEnt(e as Shape, A)); beside.push(k); return;
        }
        pls.forEach((pl, c) => {
          const A = placeTransform(shapes[k].centre, pl.angle, pl.at);
          if (c === 0) {
            const g = groupIt ? 'g' + (ed.doc.seq++) : null;
            for (const e of own) { const n: any = affEnt(e as Shape, A); if (g) n.group = [...(e.group || []), g]; ed.store.replace(e.id, n); made.push(e.id); }
          } else {
            const gm = new Map<string, string>(), g = groupIt ? 'g' + (ed.doc.seq++) : null;
            for (const e of own) {
              const { id, ...rest } = affEnt(e as Shape, A) as any;
              if (rest.group) rest.group = rest.group.map((x: string) => gm.get(x) || (gm.set(x, 'g' + (ed.doc.seq++)), gm.get(x)));
              if (g) rest.group = [...(rest.group || []), g];
              made.push(ed.store.add(rest as Shape, { layer: e.layer, color: e.color, w: e.w }).id);
            }
          }
        });
      });
    });
    ed.setTool('select'); ed.setSelection(made); close(); ed.fit();
    const use = Math.round(r.sheets.reduce((t, s) => t + s.use, 0) / nS * 100);
    ed.toast(`Nested ${r.placed} parts${nS > 1 ? ` on ${nS} sheets` : ''} · ${use} % used${beside.length ? ` · ${beside.length} of yours didn't fit (beside the sheets)` : ''} · Undo puts everything back${nS > 1 ? ' · Export asks which sheet' : ''}`);
  }

  // ---- wiring ----
  const close = () => { runId++; harder = false; clearTimeout(timer); root.remove(); window.removeEventListener('keydown', onKey, true); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } };
  window.addEventListener('keydown', onKey, true);
  const bindNum = (id: string, key: 'gap' | 'margin', min: number) => { const el = $<HTMLInputElement>(id); el.addEventListener('input', () => { const v = parseFloat(el.value); if (isFinite(v) && v >= min) { S[key] = v; restart(); } }); };
  bindNum('#nGap', 'gap', 0); bindNum('#nMargin', 'margin', 0);
  $<HTMLInputElement>('#nCopies').addEventListener('input', e => { const v = parseInt((e.target as HTMLInputElement).value); if (v >= 0 && v <= 2000) { S.copies = v; counts.fill(v); renderParts(); restart(); } });
  const syncFill = () => { $<HTMLInputElement>('#nCopies').disabled = S.fill; $<HTMLInputElement>('#nMore').disabled = S.fill; };
  $<HTMLInputElement>('#nFill').onchange = e => { S.fill = (e.target as HTMLInputElement).checked; syncFill(); renderParts(); restart(); };
  $<HTMLInputElement>('#nMore').onchange = e => { S.more = (e.target as HTMLInputElement).checked; restart(); };
  const turnBtns = () => root.querySelectorAll<HTMLElement>('#nTurn button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S.turn)));
  root.querySelectorAll<HTMLElement>('#nTurn button').forEach(b => b.onclick = () => { S.turn = b.dataset.v!; turnBtns(); restart(); });
  const clr = root.querySelector<HTMLInputElement>('#nClear'); if (clr) clr.onchange = () => { S.clear = clr.checked; restart(); };
  $('#nHarder').onclick = () => { if (harder) setHarder(false); else if (best) tryHarder(); };
  $('#nClose').onclick = close; $('#nCancel').onclick = close; $('#nPlace').onclick = place;
  root.addEventListener('click', e => { if (e.target === root) close(); });
  syncFill(); turnBtns(); renderParts(); start();
  // for the self-test and scripts
  (root as any).nest = { get best() { return best; }, place };
}
