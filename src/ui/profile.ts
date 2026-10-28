/**
 * Bend to a profile window (Make ▾ → Bend to a profile…).
 * Left: the side view — a line you bend by dragging points (click the line to add
 * a point, double-click a point to remove it). Points stop moving when the bend
 * gets tighter than the wood can take. Middle: what you'll see, and the flat
 * piece to cut (your original stays; this is the new copy). Right: settings.
 */
import { MATERIALS, pitchRange, bestPitch, laserTime, type Column } from '../hinge/hinge';
import { bendPlan, presetNodes, PRESETS, profileCurve, nodesFromCurve, hardLimit, tightestOf, monotoneU, resample, type PNode, type BendMode, type Axis, type BendPlan } from '../hinge/profile';
import { isClosedShape } from '../geometry/boolean';
import { bbox, unionBox, flatten } from '../geometry/entity';
import { affEnt, affMove } from '../geometry/affine';
import { fmt, P, cp } from '../geometry/vec';
import type { Editor } from '../editor/editor';
import type { Shape } from '../model/types';

const S = {
  mode: 'look' as BendMode, axis: 'v' as Axis, mat: 'ply', t: 3, kerf: 0.15, where: 'bends' as 'bends' | 'all', adapt: true,
  D: 2.5, L: 30, G: 3.6, ribs: 1, ribDepth: 20, open: true, ribLabel: 'FORMER', speed: 15, passes: 1, depth: 100, preset: 'arc',
};
const mins = (s: number) => s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`;
const metres = (mm: number) => mm >= 1000 ? `${fmt(mm / 1000, 1)} m` : `${fmt(mm, 0)} mm`;
const moved = (s: Shape, dx: number, dy: number) => { const t: any = affEnt(s, affMove(P(dx, dy))); if (t.pts) t.pts = t.pts.map(cp); if (t.a) { t.a = cp(t.a); t.b = cp(t.b); } if (t.c) t.c = cp(t.c); return t as Shape; };
const pathD = (s: Shape) => { const f = flatten(s, 0.05); return `M${f.pts.map(q => `${fmt(q.x, 2)} ${fmt(-q.y, 2)}`).join('L')}${f.closed ? 'Z' : ''}`; };

/** Map every point of a line / path / circle through f. */
const mapShape = (s: Shape, f: (p: any) => any): Shape => { const t: any = structuredClone(s); if (t.pts) t.pts = t.pts.map(f); if (t.a) { t.a = f(t.a); t.b = f(t.b); } if (t.c) t.c = f(t.c); return t; };
/** Stand a former (and its label) upright: u runs down the sheet, z across; returns the move to put its top-left at (x, yTop). */
function upright(r: Shape, vert: boolean) { const turn = (q: any) => vert ? P(q.y, -q.x) : P(q.x, q.y), pts = (r as any).pts.map(turn), rb = unionBox([bbox({ type: 'poly', closed: true, pts } as Shape)])!; return { turn, rb }; }

export function openBend(ed: Editor) {
  document.querySelector('#bend')?.remove();
  const sel = ed.selected() as Shape[], parts = sel.filter(isClosedShape), curves = sel.filter(s => !isClosedShape(s) && s.type !== 'dim');
  const root = document.createElement('div'); root.id = 'bend';
  const num = (id: string, label: string, v: number, step: number, unit = 'mm', min = 0, title = '') => `<label class="sl" ${title ? `title="${title}"` : ''}>${label} <input type="text" inputmode="decimal" id="${id}" value="${v}" data-step="${step}" data-min="${min}"> <span>${unit}</span></label>`;
  const seg = (id: string, items: [string, string][]) => `<div class="segc" id="${id}" role="group">${items.map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join('')}</div>`;
  root.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-labelledby="pbTitle">
    <div class="head"><strong id="pbTitle">Bend to a profile</strong>${seg('pbMode', [['look', 'Keep how it looks'], ['length', 'Keep its length']])}<button class="x" id="pbClose" aria-label="Close">✕</button></div>
    <div class="body">
      <div class="side"><div class="cap">Side view — drag the points <span class="hint">· click the line to add a point · double-click a point to remove it</span></div><div class="axes"><span id="pbTopLab">↑ top</span></div><svg id="pbSide" aria-label="Side profile editor"></svg><div class="axes"><span>← back</span><span>forward →</span></div>
        <div class="presets">${PRESETS.map(p => `<button type="button" class="btn" data-preset="${p.id}">${p.name}</button>`).join('')}</div></div>
      <div class="view"><svg id="pbView" aria-label="Preview"></svg><p class="stat" id="pbStat"></p><div class="key"><span class="k-ok">● bends fine</span><span class="k-tight">● tight</span><span class="k-bad">● too tight</span><span class="k-mark">— engrave (where the former goes)</span></div></div>
      <div class="ctl">
        <p class="hint" id="pbInfo"></p>
        <label class="sl">Bends along ${seg('pbAxis', [['v', 'Up–down'], ['h', 'Left–right']])}</label>
        <label class="sl depth" title="Makes the whole profile deeper or flatter">Depth of the curve <input type="range" id="pbDepthR" min="0" max="200" step="1" value="${S.depth}"><input type="text" inputmode="decimal" id="pbDepth" value="${S.depth}" data-step="10" data-min="0"> <span>%</span> <button type="button" class="btn" id="pbDepth0" title="Back to 100%">↺</button></label>
        <h4>Material</h4>
        <label class="sl">Material <select id="pbMat">${MATERIALS.map(m => `<option value="${m.id}">${m.name}</option>`).join('')}</select></label>
        ${num('pbT', 'Thickness', S.t, 0.5, 'mm', 0.5)}${num('pbK', 'Laser kerf', S.kerf, 0.01, 'mm', 0)}
        <h4>Hinge cuts <button type="button" class="btn primary rec" id="pbRec" title="Choose slit length, gap and spacing for this shape and profile">★ Recommend</button></h4>
        ${seg('pbWhere', [['bends', 'Only where it bends'], ['all', 'All along']])}
        ${seg('pbAdapt', [['1', 'Spacing fits the curve'], ['0', 'Same spacing']])}
        <div id="pbDRow">${num('pbD', 'Spacing between cuts', S.D, 0.1, 'mm', 0.3)}</div>
        ${num('pbL', 'Slit length', S.L, 1, 'mm', 4)}${num('pbG', 'Gap (bridge)', S.G, 0.1, 'mm', 0.5)}
        <label class="chk"><input type="checkbox" id="pbOpen" checked>Every other row runs out through the edges (needed for it to bend)</label>
        <h4>Former (holds the shape)</h4>
        ${seg('pbRibs', [['0', 'None'], ['1', 'One'], ['2', 'Two']])}
        <div id="pbRibRow">${num('pbRD', 'Former depth', S.ribDepth, 5, 'mm', 5)}
          <label class="sl txt" title="Engraved small on the former. Leave empty for no label.">Label (engraved) <input type="text" id="pbLab" value="${S.ribLabel}" maxlength="20"></label></div>
        <p class="hint">A former is a stand cut to the side profile: glue the bent piece onto its edge (or leave the piece free to flop).</p>
        <h4>Laser time</h4>${num('pbSp', 'Cutting speed', S.speed, 1, 'mm/s', 0.5)}${num('pbPa', 'Passes', S.passes, 1, '', 1)}
      </div>
    </div>
    <div class="foot"><div class="warn" id="pbWarn"></div><button class="btn" id="pbCancel">Cancel</button><button class="btn primary" id="pbPlace">Place the new copy</button></div>
  </div>`;
  document.body.append(root);
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector(s) as T;
  const close = () => { root.remove(); window.removeEventListener('keydown', onKey, true); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } };
  window.addEventListener('keydown', onKey, true);
  $('#pbClose').onclick = close; $('#pbCancel').onclick = close;
  root.addEventListener('click', e => { if (e.target === root) close(); });

  const mat = () => MATERIALS.find(m => m.id === S.mat) || MATERIALS[0];
  const B = parts.length ? unionBox(parts.map(s => bbox(s)))! : null;
  const Lu = () => !B ? 100 : S.axis === 'v' ? B.y1 - B.y0 : B.x1 - B.x0;
  const Wv = () => !B ? 40 : S.axis === 'v' ? B.x1 - B.x0 : B.y1 - B.y0;
  let nodes: PNode[] = [], plan: BendPlan | null = null, error = '';
  const fromDrawn = curves.length ? nodesFromCurve(curves[0], Lu()) : null;
  nodes = fromDrawn || presetNodes(S.preset, Lu(), S.depth / 100);

  function compute() {
    if (!parts.length) { plan = null; error = 'Select the shape to bend first (with Select, V) — and, if you like, a curve you drew as its side profile — then open this again.'; return; }
    const r = bendPlan(parts.map(s => structuredClone(s)), nodes, { mode: S.mode, axis: S.axis, t: S.t, kerf: S.kerf, mat: mat(), sf: 1.5, G: S.G, L: S.L, adapt: S.adapt, where: S.where, D: S.D, ribs: S.ribs, ribDepth: S.ribDepth, open: S.open, ribLabel: S.ribLabel });
    if ('error' in r) { plan = null; error = r.error; } else { plan = r; error = ''; }
  }

  // ---------------- side-view editor ----------------
  const side = $<SVGSVGElement & HTMLElement>('#pbSide');
  let view = { x0: 0, y0: 0, w: 1, h: 1 };
  /** side view coordinates: horizontal = z (forward →), vertical = u (down) */
  function drawSide() {
    const L = Lu(), cur = profileCurve(nodes), zs = cur.map(p => p.y).concat([0]), us = cur.map(p => p.x).concat([0, L]);
    const zmin = Math.min(...zs, -L * 0.25), zmax = Math.max(...zs, L * 0.25), umin = Math.min(...us), umax = Math.max(...us), pad = L * 0.08;
    view = { x0: zmin - pad, y0: umin - pad, w: zmax - zmin + 2 * pad, h: umax - umin + 2 * pad };
    side.setAttribute('viewBox', `${fmt(view.x0, 2)} ${fmt(view.y0, 2)} ${fmt(view.w, 2)} ${fmt(view.h, 2)}`);
    const r = Math.max(view.w, view.h) / 70, out: string[] = [];
    out.push(`<line class="ref" x1="0" y1="0" x2="0" y2="${fmt(L, 2)}"/>`);
    $('#pbTopLab').textContent = S.axis === 'v' ? '↑ top' : '↑ left end';
    // the curve, coloured by the bend check (columns along s)
    const rs = resample(cur, 0.5), cols = plan?.columns || [], k = plan && S.mode === 'length' ? (rs.total ? plan.Ls / rs.total : 1) : 1;
    const rank = { none: 0, ok: 1, tight: 2, bad: 3 } as const;
    const stateAt = (s: number): Column['state'] | 'none' => { let w: Column['state'] | 'none' = 'none'; for (const c of cols) if (Math.abs(c.x - s * k) <= Math.max(3, c.D * 1.5) && rank[c.state] > rank[w]) w = c.state; return w; };
    let run: string[] = [], last = '';
    const flush = () => { if (run.length > 1) out.push(`<polyline class="prof ${last}" points="${run.join(' ')}"/>`); };
    rs.pts.forEach((p, i) => { const st = stateAt(rs.s[i]); const pt = `${fmt(p.y, 2)},${fmt(p.x, 2)}`; if (st !== last) { if (run.length) run.push(pt); flush(); run = [pt]; last = st; } else run.push(pt); });
    flush();
    nodes.forEach((n, i) => out.push(`<circle class="node${i === 0 || (S.mode === 'look' && i === nodes.length - 1) ? ' end' : ''}" data-i="${i}" cx="${fmt(n.z, 3)}" cy="${fmt(n.u, 3)}" r="${fmt(r, 3)}"/>`));
    side.innerHTML = out.join('');
  }
  const toSide = (ev: PointerEvent | MouseEvent) => { const rc = side.getBoundingClientRect(), s = Math.max(view.w / rc.width, view.h / rc.height), cx = rc.left + rc.width / 2, cy = rc.top + rc.height / 2; return { z: view.x0 + view.w / 2 + (ev.clientX - cx) * s, u: view.y0 + view.h / 2 + (ev.clientY - cy) * s }; };
  /** is this node set allowed? (bend not tighter than the wood can take; 'look' never turns back) */
  const ok = (ns: PNode[]) => { const L = Lu(); if (S.mode === 'look' && !monotoneU(profileCurve(ns))) return false; return tightestOf(ns, S.mode, L) >= hardLimit(S.L, S.t, S.kerf, mat()) * 0.999; };
  let drag: number | null = null, limited = false;
  side.addEventListener('pointerdown', ev => {
    const t = ev.target as Element;
    if (t.classList.contains('node')) { drag = +(t as HTMLElement).dataset.i!; side.setPointerCapture(ev.pointerId); ev.preventDefault(); return; }
    // click on the line: add a point there
    const p = toSide(ev), cur = profileCurve(nodes); let bi = -1, bd = Infinity;
    cur.forEach((q, i) => { const d = Math.hypot(q.y - p.z, q.x - p.u); if (d < bd) { bd = d; bi = i; } });
    if (bd > Math.max(view.w, view.h) / 25) return;
    // insert between the pair of neighbouring points whose straight join passes closest
    const at = cur[bi], segD = (a: PNode, b: PNode) => { const dx = b.z - a.z, dy = b.u - a.u, L2 = dx * dx + dy * dy || 1e-12, t = Math.max(0, Math.min(1, ((at.y - a.z) * dx + (at.x - a.u) * dy) / L2)); return Math.hypot(at.y - a.z - t * dx, at.x - a.u - t * dy); };
    let idx = 1, best = Infinity; for (let i = 0; i < nodes.length - 1; i++) { const d = segD(nodes[i], nodes[i + 1]); if (d < best) { best = d; idx = i + 1; } }
    nodes.splice(idx, 0, { u: at.x, z: at.y }); update();
  });
  side.addEventListener('pointermove', ev => {
    if (drag == null) return;
    const p = toSide(ev), L = Lu(), i = drag, prev = nodes.map(n => ({ ...n }));
    let target: PNode = { u: p.u, z: p.z };
    if (S.mode === 'look') {
      if (i === 0) target.u = 0; else if (i === nodes.length - 1) target.u = L;
      else target.u = Math.min(nodes[i + 1].u - 2, Math.max(nodes[i - 1].u + 2, p.u));
    } else if (i === 0) target = { u: 0, z: 0 };
    // move as far towards the pointer as the wood allows
    const from = nodes[i]; let lo = 0, hi = 1;
    const tryAt = (f: number) => { const ns = prev.map(n => ({ ...n })); ns[i] = { u: from.u + (target.u - from.u) * f, z: from.z + (target.z - from.z) * f }; return ns; };
    if (ok(tryAt(1))) lo = 1; else { for (let k = 0; k < 10; k++) { const m = (lo + hi) / 2; if (ok(tryAt(m))) lo = m; else hi = m; } }
    limited = lo < 1; nodes = tryAt(lo); update(true);
  });
  const endDrag = () => { if (drag != null) { drag = null; limited = false; update(); } };
  side.addEventListener('pointerup', endDrag); side.addEventListener('pointercancel', endDrag);
  side.addEventListener('dblclick', ev => { const t = ev.target as HTMLElement; if (!t.classList.contains('node')) return; const i = +t.dataset.i!; if (i === 0 || i === nodes.length - 1 || nodes.length <= 2) return; nodes.splice(i, 1); update(); });

  // ---------------- preview ----------------
  function drawView() {
    const svg = $('#pbView'), out: string[] = [];
    if (!plan) { svg.innerHTML = ''; return; }
    // what you'll see (front), then the flat piece to cut, then the former(s)
    const fb = unionBox(plan.front.map(s => bbox(s)))!, flb = unionBox(plan.flat.map(s => bbox(s)))!, gap = Math.max(10, Wv() * 0.25);
    const fdx = -fb.x0, fdy = -fb.y1, ldx = (fb.x1 - fb.x0) + gap - flb.x0, ldy = -flb.y1;
    for (const s of plan.front) out.push(`<path class="ghost" d="${pathD(moved(s, fdx, fdy))}"/>`);
    out.push(`<text x="${fmt((fb.x1 - fb.x0) / 2, 1)}" y="${fmt(-3, 1)}">what you'll see</text>`);
    for (const s of plan.flat) out.push(`<path class="cut" d="${pathD(moved(s, ldx, ldy))}"/>`);
    plan.slits.forEach((s, i) => out.push(`<path class="sl ${plan!.slitState[i]}" d="${pathD(moved(s, ldx, ldy))}"/>`));
    for (const s of plan.marks) out.push(`<path class="mk" d="${pathD(moved(s, ldx, ldy))}"/>`);
    out.push(`<text x="${fmt(ldx + (flb.x0 + flb.x1) / 2, 1)}" y="${fmt(-3, 1)}">flat piece to cut</text>`);
    let x = ldx + flb.x1 + gap, maxY = Math.max(fb.y1 - fb.y0, flb.y1 - flb.y0);
    plan.ribs.forEach((r, k) => {
      // show the former upright beside the piece (u down, z across), with its engraved label
      const { turn, rb } = upright(r, true), f = (q: any) => { const t = turn(q); return P(t.x - rb.x0 + x, t.y - rb.y1); };
      out.push(`<path class="cut" d="${pathD(mapShape(r, f))}"/>`);
      for (const l of plan!.ribLabels[k] || []) out.push(`<path class="mk lbl" d="${pathD(mapShape(l, f))}"/>`);
      out.push(`<text x="${fmt(x + (rb.x1 - rb.x0) / 2, 1)}" y="${fmt(-3, 1)}">former</text>`);
      x += rb.x1 - rb.x0 + gap; maxY = Math.max(maxY, rb.y1 - rb.y0);
    });
    const W = x, Hh = maxY;
    svg.setAttribute('viewBox', `${fmt(-6, 1)} ${fmt(-12, 1)} ${fmt(W + 12, 1)} ${fmt(Hh + 18, 1)}`);
    svg.innerHTML = out.join('');
  }

  function render() {
    const pressed = (id: string, v: string) => root.querySelectorAll<HTMLElement>(`#${id} button`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
    pressed('pbMode', S.mode); pressed('pbAxis', S.axis); pressed('pbWhere', S.where); pressed('pbAdapt', S.adapt ? '1' : '0'); pressed('pbRibs', String(S.ribs));
    root.querySelectorAll<HTMLElement>('[data-preset]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.preset === S.preset)));
    $<HTMLSelectElement>('#pbMat').value = S.mat; $('#pbDRow').hidden = S.adapt; $('#pbRibRow').hidden = S.ribs === 0;
    $('#pbInfo').innerHTML = !parts.length ? '<b>Select the shape to bend first.</b>' : S.mode === 'look'
      ? `Your drawing is what you'll <b>see</b>. The new copy is the flat piece — longer, because the wood follows the curve.${fromDrawn ? ' Using the curve you drew as the profile.' : ''}`
      : `Your drawing is the <b>flat piece</b>. Bent, it looks shorter from the front. The profile can curl and fold over.${fromDrawn ? ' Using the curve you drew as the profile.' : ''}`;
    drawSide(); drawView();
    const warn: string[] = [];
    if (!plan) { $('#pbStat').textContent = error; $('#pbWarn').innerHTML = ''; $<HTMLButtonElement>('#pbPlace').disabled = true; return; }
    $<HTMLButtonElement>('#pbPlace').disabled = false;
    const p = plan, n = p.slits.length, cut = p.cutLen, time = laserTime(cut, n + p.flat.length + p.ribs.length, S.speed, S.passes);
    const Ds = p.columns.map(c => c.D), dr = Ds.length ? (Math.min(...Ds) === Math.max(...Ds) ? fmt(Ds[0], 2) : `${fmt(Math.min(...Ds), 2)}–${fmt(Math.max(...Ds), 2)}`) : '—';
    $('#pbStat').innerHTML = `Your drawing is <b>${fmt(p.Lu, 1)} mm</b> long; the flat piece is <b>${fmt(S.mode === 'look' ? p.Ls : p.Lu, 1)} mm</b>${S.mode === 'look' && p.Ls > p.Lu + 0.05 ? ` (+${fmt((p.stretch - 1) * 100, 1)}%)` : ''} · tightest bend R ${isFinite(p.tightest) ? fmt(p.tightest, 1) : '—'} mm · spacing ${dr} mm · <b>${n} slits</b> · cutting ${metres(cut)} · <b>about ${mins(time)}</b>`;
    warn.push(p.state === 'ok' ? '<span class="ok">✓ It should bend to this profile.</span>' : p.state === 'tight' ? '<span class="tight">⚠ Some parts are tight — press ★ Recommend, or try test strips first.</span>' : '<span class="bad">✕ Too tight in places (red) — soften the curve there.</span>');
    if (limited) warn.push('<span class="tight">That point can’t go further — the wood won’t bend any tighter.</span>');
    warn.push(...p.warnings);
    $('#pbWarn').innerHTML = warn.map(w => `<div>${w}</div>`).join('');
  }
  let timer = 0;
  function update(quick = false) { compute(); render(); if (!quick) syncInputs(); }
  const later = () => { clearTimeout(timer); timer = window.setTimeout(() => update(), 120); };
  function syncInputs() {
    const set = (id: string, v: number) => { const el = $<HTMLInputElement>(id); if (document.activeElement !== el) el.value = String(+v.toFixed(3)); };
    set('#pbD', S.D); set('#pbL', S.L); set('#pbG', S.G); set('#pbT', S.t); set('#pbK', S.kerf); set('#pbRD', S.ribDepth); set('#pbSp', S.speed); set('#pbPa', S.passes); set('#pbDepth', S.depth); dR.value = String(S.depth);
  }
  const bindNum = (id: string, key: keyof typeof S, min = 0) => { const el = $<HTMLInputElement>(id); el.addEventListener('input', () => { const v = parseFloat(el.value); if (isFinite(v) && v >= min) { (S as any)[key] = v; later(); } }); };
  bindNum('#pbT', 't', 0.5); bindNum('#pbK', 'kerf', 0); bindNum('#pbD', 'D', 0.3); bindNum('#pbL', 'L', 4); bindNum('#pbG', 'G', 0.5); bindNum('#pbRD', 'ribDepth', 5); bindNum('#pbSp', 'speed', 0.5); bindNum('#pbPa', 'passes', 1);
  // depth: scale every point's forward/back distance
  const dEl = $<HTMLInputElement>('#pbDepth');
  const dR = $<HTMLInputElement>('#pbDepthR');
  /** scale every point's forward/back distance to the new depth (stops where the wood can't follow) */
  const setDepth = (v: number) => {
    if (!isFinite(v) || v < 0) return;
    const k = S.depth > 0 ? v / S.depth : 0, ns = nodes.map(n => ({ ...n, z: S.depth > 0 ? n.z * k : n.z }));
    if (ok(ns) || v < S.depth) { nodes = ns; S.depth = v; dR.value = String(v); if (document.activeElement !== dEl) dEl.value = String(v); later(); }
    else { dR.value = String(S.depth); ed.toast('That deep, the wood won\u2019t bend tight enough'); }
  };
  dEl.addEventListener('input', () => setDepth(parseFloat(dEl.value)));
  dR.addEventListener('input', () => setDepth(parseFloat(dR.value)));
  $('#pbDepth0').onclick = () => setDepth(100);
  const segBind = (id: string, f: (v: string) => void) => root.querySelectorAll<HTMLElement>(`#${id} button`).forEach(b => b.onclick = () => { f(b.dataset.v!); update(); });
  segBind('pbMode', v => { S.mode = v as BendMode; if (S.mode === 'look' && !monotoneU(profileCurve(nodes))) { nodes = presetNodes(S.preset, Lu(), S.depth / 100); ed.toast('That profile turns back on itself, so it was reset for "Keep how it looks"'); } });
  segBind('pbAxis', v => { S.axis = v as Axis; const k = Lu() / (nodes[nodes.length - 1].u || 1); nodes = nodes.map(n => ({ u: n.u * k, z: n.z * k })); });
  segBind('pbWhere', v => S.where = v as any); segBind('pbAdapt', v => S.adapt = v === '1'); segBind('pbRibs', v => S.ribs = +v);
  root.querySelectorAll<HTMLElement>('[data-preset]').forEach(b => b.onclick = () => {
    S.preset = b.dataset.preset!; let d = 1, ns = presetNodes(S.preset, Lu(), d);   // every preset starts at 100%
    for (let k = 0; k < 12 && !ok(ns); k++) { d *= 0.8; ns = presetNodes(S.preset, Lu(), d); }   // shallow it until the wood can take it
    S.depth = Math.round(d * 100); dR.value = String(S.depth); if (d < 1) ed.toast(`Made shallower (depth ${S.depth}%) so the wood can bend to it`);
    nodes = ns; update();
  });
  $<HTMLInputElement>('#pbOpen').onchange = e => { S.open = (e.target as HTMLInputElement).checked; update(); };
  const lab = $<HTMLInputElement>('#pbLab'); lab.addEventListener('input', () => { S.ribLabel = lab.value.toUpperCase().slice(0, 20); later(); });
  $<HTMLSelectElement>('#pbMat').onchange = e => { S.mat = (e.target as HTMLSelectElement).value; update(); };
  $('#pbRec').onclick = () => {
    const m = mat(); S.G = Math.round(Math.max(1.5, 1.2 * S.t) * 10) / 10;
    S.L = Math.round(Math.max(2 * S.G + 2, Math.min(15 * S.t, Wv() / 2 - S.G)));
    const R = tightestOf(nodes, S.mode, Lu()), D = bestPitch(isFinite(R) ? R : 200, S.L, S.t, S.kerf, m, 1.5);
    S.D = D ?? pitchRange(S.t, S.kerf, m).lo;
    update(); ed.toast(`Recommended: slits ${fmt(S.L, 0)} mm long, gap ${fmt(S.G, 1)} mm, spacing ${S.adapt ? 'fitted to each part of the curve' : fmt(S.D, 2) + ' mm'}`);
  };
  $('#pbPlace').onclick = () => {
    if (!plan || !B) return;
    // the new copy goes beside the original; the former(s) beside that
    const all = unionBox(sel.map(s => bbox(s)))!, flb = unionBox(plan.flat.map(s => bbox(s)))!, gap = 10, dx = all.x1 + gap - flb.x0, dy = 0;
    const ids = ed.store.change(() => {
      const out: string[] = [], g = 'g' + (ed.doc.seq++);
      for (const s of [...plan!.flat, ...plan!.slits]) { const e = ed.store.add(moved(s, dx, dy)); e.group = [g]; out.push(e.id); }
      for (const s of plan!.marks) { const e = ed.store.add(moved(s, dx, dy), { color: 'blue' }); e.group = [g]; out.push(e.id); }
      let x = flb.x1 + dx + gap;
      plan!.ribs.forEach((r, k) => {
        const { turn, rb } = upright(r, S.axis === 'v'), f = (q: any) => { const t = turn(q); return cp(P(t.x - rb.x0 + x, t.y - rb.y1 + B.y1)); }, g2 = 'g' + (ed.doc.seq++);
        const e = ed.store.add(mapShape(r, f)); e.group = [g2]; out.push(e.id);
        for (const l of plan!.ribLabels[k] || []) { const le = ed.store.add(mapShape(l, f), { color: 'blue' }); le.group = [g2]; out.push(le.id); }
        x += rb.x1 - rb.x0 + gap;
      });
      return out;
    });
    ed.setTool('select'); ed.setSelection(ids); close(); ed.fit();
    ed.toast(`New flat copy placed beside your original (${plan.slits.length} slits)${plan.ribs.length ? ` with ${plan.ribs.length} former${plan.ribs.length > 1 ? 's' : ''}` : ''} · blue = engrave`);
  };
  update();
}
