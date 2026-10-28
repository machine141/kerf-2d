/** SVG export (mm-sized, true arcs/ellipses, Inkscape layers) and basic SVG import. */
import { type Point, P, add, sub, mul, dist, normA, angOf, polar, clean, cp, fmt, DEG } from '../geometry/vec';
import { dimGeom } from '../geometry/dims';
import { COLORS, type Doc, type Shape, type ColorKey } from '../model/types';

const nf = (v: number) => fmt(clean(v), 6);
const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);
const slug = (s: string) => (s.replace(/[^A-Za-z0-9_-]+/g, '_') || 'layer');

export interface SvgOptions { includeHidden?: boolean }

export function exportSVG(doc: Doc, opt: SvgOptions = {}): string {
  const { w, h } = doc.page, Y = (y: number) => nf(h - y), out: string[] = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${nf(w)}mm" height="${nf(h)}mm" viewBox="0 0 ${nf(w)} ${nf(h)}">`,
    `<!-- ${esc(doc.name)} · 1 user unit = 1 mm -->`);
  for (const L of doc.layers) {
    if (!L.visible && !opt.includeHidden) continue;
    const ents = doc.ents.filter(e => e.layer === L.id); if (!ents.length) continue;
    out.push(`<g id="${esc(slug(L.name))}" inkscape:groupmode="layer" inkscape:label="${esc(L.name)}" fill="none" stroke-linecap="round" stroke-linejoin="round"${L.visible ? '' : ' style="display:none"'}>`);
    for (const e of ents) {
      const st = `stroke="${COLORS[e.color]?.hex || '#000000'}" stroke-width="${nf(e.w)}"`;
      if (e.type === 'line') out.push(`<line x1="${nf(e.a.x)}" y1="${Y(e.a.y)}" x2="${nf(e.b.x)}" y2="${Y(e.b.y)}" ${st}/>`);
      else if (e.type === 'poly') out.push(`<${e.closed ? 'polygon' : 'polyline'} points="${e.pts.map(p => nf(p.x) + ',' + Y(p.y)).join(' ')}" ${st}/>`);
      else if (e.type === 'circle') out.push(`<circle cx="${nf(e.c.x)}" cy="${Y(e.c.y)}" r="${nf(e.r)}" ${st}/>`);
      else if (e.type === 'ellipse') out.push(`<ellipse cx="${nf(e.c.x)}" cy="${Y(e.c.y)}" rx="${nf(e.rx)}" ry="${nf(e.ry)}"${Math.abs(e.rot) > 1e-12 ? ` transform="rotate(${nf(-e.rot / DEG)} ${nf(e.c.x)} ${Y(e.c.y)})"` : ''} ${st}/>`);
      else if (e.type === 'arc') {
        const s = polar(e.c, e.r, e.a0), f = polar(e.c, e.r, e.a1), lg = normA(e.a1 - e.a0) > Math.PI ? 1 : 0;
        out.push(`<path d="M ${nf(s.x)} ${Y(s.y)} A ${nf(e.r)} ${nf(e.r)} 0 ${lg} 0 ${nf(f.x)} ${Y(f.y)}" ${st}/>`);
      } else if (e.type === 'dim') {
        const g = dimGeom(e, doc.dim);
        out.push(`<g class="dimension">` + g.lines.map(([a, b]) => `<line x1="${nf(a.x)}" y1="${Y(a.y)}" x2="${nf(b.x)}" y2="${Y(b.y)}" ${st}/>`).join('') +
          `<text x="${nf(g.text.p.x)}" y="${Y(g.text.p.y)}" transform="rotate(${nf(-g.text.ang / DEG)} ${nf(g.text.p.x)} ${Y(g.text.p.y)})" font-family="Arial, sans-serif" font-size="${nf(g.text.h)}" text-anchor="middle" fill="${COLORS[e.color]?.hex || '#000000'}" stroke="none">${esc(g.text.str)}</text></g>`);
      }
    }
    out.push(`</g>`);
  }
  out.push(`</svg>`); return out.join('\n');
}

/** Centre and angles of an SVG endpoint-form arc (world coords, y up). */
export function svgArcCenter(s: Point, f: Point, r: number, large: number, sweep: number) {
  let a = s, b = f; if (sweep) [a, b] = [f, s];
  const m = mul(add(a, b), .5), c = dist(a, b), hh = Math.sqrt(Math.max(0, r * r - (c / 2) ** 2)), u = mul(sub(b, a), 1 / c), n = P(-u.y, u.x);
  for (const cen of [add(m, mul(n, hh)), sub(m, mul(n, hh))]) {
    const a0 = angOf(cen, a), a1 = angOf(cen, b);
    if ((normA(a1 - a0) > Math.PI + 1e-9) === !!large || hh < 1e-12) return { c: cp(cen), a0: normA(a0), a1: normA(a1) };
  }
  const cen = add(m, mul(n, hh)); return { c: cp(cen), a0: normA(angOf(cen, a)), a1: normA(angOf(cen, b)) };
}

export function importSVG(text: string): (Shape & { layer: string })[] {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml'), svg = doc.documentElement;
  if (svg.nodeName !== 'svg') throw new Error('Not an SVG file');
  const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number), hmm = parseFloat(svg.getAttribute('height') || '') || vb[3];
  const unit = /mm$/.test(svg.getAttribute('height') || '') && vb.length === 4 ? hmm / vb[3] : 1, H = (vb[3] || hmm);
  const Wp = (x: number, y: number) => P(clean(x * unit), clean((H - y) * unit)), ents: any[] = [];
  const hexToKey = (hx: string | null): ColorKey => ((Object.entries(COLORS).find(([, c]) => c.hex.toLowerCase() === (hx || '').toLowerCase()) || ['ink'])[0]) as ColorKey;
  for (const el of Array.from(svg.querySelectorAll('line,circle,ellipse,polyline,polygon,path,rect'))) {
    const par = el.parentNode as Element | null; if (par?.getAttribute?.('class') === 'dimension') continue;
    const g = el.closest('g'), layer = g ? (g.getAttribute('inkscape:label') || g.getAttribute('id') || '0') : '0';
    const base = { layer, color: hexToKey(el.getAttribute('stroke')), w: clean(parseFloat(el.getAttribute('stroke-width') || '') * unit || 0.1) }, n = (a: string) => parseFloat(el.getAttribute(a) || '');
    const tag = el.nodeName;
    if (tag === 'line') ents.push({ ...base, type: 'line', a: Wp(n('x1'), n('y1')), b: Wp(n('x2'), n('y2')) });
    else if (tag === 'circle') ents.push({ ...base, type: 'circle', c: Wp(n('cx'), n('cy')), r: clean(n('r') * unit) });
    else if (tag === 'ellipse') { const m = /rotate\(\s*([-\d.e]+)/.exec(el.getAttribute('transform') || ''); ents.push({ ...base, type: 'ellipse', c: Wp(n('cx'), n('cy')), rx: clean(n('rx') * unit), ry: clean(n('ry') * unit), rot: normA(m ? -parseFloat(m[1]) * DEG : 0) }); }
    else if (tag === 'rect') { const x = n('x') || 0, y = n('y') || 0, w = n('width'), h = n('height'); ents.push({ ...base, type: 'poly', closed: true, pts: [Wp(x, y + h), Wp(x + w, y + h), Wp(x + w, y), Wp(x, y)] }); }
    else if (tag === 'polyline' || tag === 'polygon') { const v = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number), pts: Point[] = []; for (let i = 0; i + 1 < v.length; i += 2) pts.push(Wp(v[i], v[i + 1])); ents.push({ ...base, type: 'poly', closed: tag === 'polygon', pts }); }
    else if (tag === 'path') {
      const tk = (el.getAttribute('d') || '').match(/[MLAZmlaz]|-?[\d.]+(?:e-?\d+)?/g) || []; let i = 0, cur: Point | null = null, start: Point | null = null, cmd = '';
      const num = () => parseFloat(tk[i++]);
      while (i < tk.length) {
        if (/[A-Za-z]/.test(tk[i])) cmd = tk[i++];
        if (cmd === 'M') { cur = Wp(num(), num()); start = cur; cmd = 'L'; }
        else if (cmd === 'L') { const p = Wp(num(), num()); ents.push({ ...base, type: 'line', a: cur, b: p }); cur = p; }
        else if (cmd === 'A') { const rx = num(); num(); num(); const lg = num(), sw = num(), p = Wp(num(), num()); const ar = svgArcCenter(cur!, p, rx * unit, lg, sw); ents.push({ ...base, type: 'arc', c: ar.c, r: clean(rx * unit), a0: ar.a0, a1: ar.a1 }); cur = p; }
        else if (cmd === 'Z' || cmd === 'z') { if (start && cur && dist(cur, start) > 1e-9) ents.push({ ...base, type: 'line', a: cur, b: start }); cur = start; }
        else i++;
      }
    }
  }
  return ents;
}
