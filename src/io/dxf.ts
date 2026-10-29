import { expandText } from '../text/text';
/**
 * DXF export (AutoCAD R12 ASCII, millimetres) and import.
 * Options follow 2D Design's DXF Export dialog: split arcs into lines (avoids
 * tiny gaps some software creates where arcs meet lines), include hidden layers,
 * and a curve tolerance for anything turned into lines.
 */
import { type Point, P, add, sub, mul, len, dist, normA, angOf, clean, cp, fmt, DEG } from '../geometry/vec';
import { flatten } from '../geometry/entity';
import { dimGeom } from '../geometry/dims';
import { hasBulge, flattenPath } from '../geometry/path';
import { COLORS, modeOf, type Doc, type Shape } from '../model/types';

const nf = (v: number) => fmt(clean(v), 6);
export interface DxfOptions { splitArcs?: boolean; includeHidden?: boolean; curveTol?: number; skipDims?: boolean }

export function exportDXF(doc: Doc, opt: DxfOptions = {}): string {
  const { w, h } = doc.page, o: string[] = [], g = (c: number, v: string | number) => o.push(String(c), String(v));
  const tol = opt.curveTol ?? 0.01;
  const layerName = (id: string) => (doc.layers.find(l => l.id === id)?.name || '0').replace(/[<>/\\":;?*|=`]/g, '_').toUpperCase();
  const layers = doc.layers.filter(l => l.visible || opt.includeHidden);
  const include = new Set(layers.map(l => l.id));
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); g(70, 4); g(9, '$MEASUREMENT'); g(70, 1);
  g(9, '$EXTMIN'); g(10, 0); g(20, 0); g(30, 0); g(9, '$EXTMAX'); g(10, nf(w)); g(20, nf(h)); g(30, 0);
  g(9, '$LIMMIN'); g(10, 0); g(20, 0); g(9, '$LIMMAX'); g(10, nf(w)); g(20, nf(h)); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 1); g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0); g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, layers.length + 1); g(0, 'LAYER'); g(2, '0'); g(70, 0); g(62, 7); g(6, 'CONTINUOUS');
  for (const L of layers) { g(0, 'LAYER'); g(2, layerName(L.id)); g(70, 0); g(62, L.visible ? 7 : -7); g(6, 'CONTINUOUS'); }
  g(0, 'ENDTAB'); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  for (const e of expandText(doc.ents)) {
    if (!include.has(e.layer) || (opt.skipDims && e.type === 'dim') || (e.type !== 'dim' && modeOf(doc, e.color) === 'off')) continue;
    const head = (t: string) => { g(0, t); g(8, layerName(e.layer)); g(62, COLORS[e.color]?.aci ?? 7); };
    const line = (a: Point, b: Point) => { head('LINE'); g(10, nf(a.x)); g(20, nf(a.y)); g(30, 0); g(11, nf(b.x)); g(21, nf(b.y)); g(31, 0); };
    const poly = (pts: Point[], closed: boolean, bulge?: number[]) => {
      head('POLYLINE'); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, closed ? 1 : 0);
      pts.forEach((p, i) => { g(0, 'VERTEX'); g(8, layerName(e.layer)); g(10, nf(p.x)); g(20, nf(p.y)); g(30, 0); const b = bulge?.[i] ?? 0; if (Math.abs(b) > 1e-12) g(42, fmt(b, 12)); });
      g(0, 'SEQEND'); g(8, layerName(e.layer));
    };
    if (e.type === 'line') line(e.a, e.b);
    else if (e.type === 'poly') { if (hasBulge(e) && opt.splitArcs) poly(flattenPath(e, tol), e.closed); else poly(e.pts, e.closed, e.bulge); }
    else if (e.type === 'ellipse') poly(flatten(e, tol).pts, true);
    else if (e.type === 'spline') poly(flatten(e, tol).pts, e.closed);
    else if (e.type === 'circle') { if (opt.splitArcs) poly(flatten(e, tol).pts, true); else { head('CIRCLE'); g(10, nf(e.c.x)); g(20, nf(e.c.y)); g(30, 0); g(40, nf(e.r)); } }
    else if (e.type === 'arc') { if (opt.splitArcs) poly(flatten(e, tol).pts, false); else { head('ARC'); g(10, nf(e.c.x)); g(20, nf(e.c.y)); g(30, 0); g(40, nf(e.r)); g(50, nf(normA(e.a0) / DEG)); g(51, nf(normA(e.a1) / DEG)); } }
    else if (e.type === 'dim') {
      const gg = dimGeom(e, doc.dim); gg.lines.forEach(([a, b]) => line(a, b));
      head('TEXT'); g(10, nf(gg.text.p.x)); g(20, nf(gg.text.p.y)); g(30, 0); g(40, nf(gg.text.h)); g(1, gg.text.str.replace(/Ø/g, '%%c')); g(50, nf(gg.text.ang / DEG)); g(72, 1); g(11, nf(gg.text.p.x)); g(21, nf(gg.text.p.y)); g(31, 0);
    }
  }
  g(0, 'ENDSEC'); g(0, 'EOF');
  return o.join('\r\n') + '\r\n';
}

export function importDXF(text: string): (Shape & { layer: string; aci?: number })[] {
  const Ls = text.split(/\r?\n/), pairs: [number, string][] = [];
  for (let i = 0; i + 1 < Ls.length; i += 2) pairs.push([parseInt(Ls[i].trim(), 10), Ls[i + 1].trim()]);
  let scale = 1; const hi = pairs.findIndex(p => p[0] === 9 && p[1] === '$INSUNITS');
  if (hi >= 0) { const u = +pairs[hi + 1][1]; scale = ({ 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 } as Record<number, number>)[u] || 1; }
  const s = pairs.findIndex((p, i) => p[0] === 2 && p[1] === 'ENTITIES' && pairs[i - 1]?.[1] === 'SECTION');
  if (s < 0) throw new Error('No ENTITIES section found');
  const ents: any[] = []; let i = s + 1; const sc = (v: string | undefined) => clean(+(v ?? 0) * scale);
  const read = () => { const d = { t: pairs[i][1], g: [] as [number, string][] }; i++; while (i < pairs.length && pairs[i][0] !== 0) { d.g.push(pairs[i]); i++; } return d; };
  const get = (d: { g: [number, string][] }, c: number) => d.g.find(p => p[0] === c)?.[1];
  const bulgeSegs = (vs: { x: number; y: number; bulge: number }[], closed: boolean, layer: string) => {
    const out: any[] = [], n = vs.length, m = closed ? n : n - 1;
    for (let k = 0; k < m; k++) {
      const a = vs[k], b = vs[(k + 1) % n];
      if (Math.abs(a.bulge || 0) < 1e-12) { out.push({ type: 'line', a: P(a.x, a.y), b: P(b.x, b.y), layer }); continue; }
      const th = 4 * Math.atan(a.bulge), c = dist(a, b), r = c / (2 * Math.sin(Math.abs(th) / 2)), mid = mul(add(a, b), .5), u = mul(sub(b, a), 1 / c), nrm = P(-u.y, u.x);
      const hgt = r * Math.cos(th / 2) * Math.sign(th), cen = add(mid, mul(nrm, hgt)); let a0 = angOf(cen, a), a1 = angOf(cen, b); if (th < 0) [a0, a1] = [a1, a0];
      out.push({ type: 'arc', c: cp(cen), r: clean(Math.abs(r)), a0: normA(a0), a1: normA(a1), layer });
    }
    return out;
  };
  while (i < pairs.length) {
    if (pairs[i][0] !== 0) { i++; continue; }
    const t = pairs[i][1]; if (t === 'ENDSEC' || t === 'EOF') break;
    const d = read(), layer = get(d, 8) || '0', aci = +(get(d, 62) ?? 7);
    if (t === 'LINE') ents.push({ type: 'line', a: P(sc(get(d, 10)), sc(get(d, 20))), b: P(sc(get(d, 11)), sc(get(d, 21))), layer, aci });
    else if (t === 'CIRCLE') ents.push({ type: 'circle', c: P(sc(get(d, 10)), sc(get(d, 20))), r: sc(get(d, 40)), layer, aci });
    else if (t === 'ARC') ents.push({ type: 'arc', c: P(sc(get(d, 10)), sc(get(d, 20))), r: sc(get(d, 40)), a0: normA(+get(d, 50)! * DEG), a1: normA(+get(d, 51)! * DEG), layer, aci });
    else if (t === 'ELLIPSE') { const mj = P(sc(get(d, 11)), sc(get(d, 21))), rx = len(mj); ents.push({ type: 'ellipse', c: P(sc(get(d, 10)), sc(get(d, 20))), rx: clean(rx), ry: clean(rx * +get(d, 40)!), rot: normA(Math.atan2(mj.y, mj.x)), layer, aci }); }
    else if (t === 'LWPOLYLINE') {
      const vs: { x: number; y: number; bulge: number }[] = []; let cur: any = null;
      for (const [c, v] of d.g) { if (c === 10) { cur = { x: sc(v), y: 0, bulge: 0 }; vs.push(cur); } else if (c === 20 && cur) cur.y = sc(v); else if (c === 42 && cur) cur.bulge = +v; }
      const closed = (+(get(d, 70) ?? 0) & 1) === 1;
      const pl: any = { type: 'poly', closed, pts: vs.map(v => P(v.x, v.y)), layer, aci }; if (vs.some(v => Math.abs(v.bulge) > 1e-12)) pl.bulge = vs.map(v => v.bulge).slice(0, closed ? vs.length : vs.length - 1); ents.push(pl);
    } else if (t === 'POLYLINE') {
      const closed = (+(get(d, 70) ?? 0) & 1) === 1, vs: { x: number; y: number; bulge: number }[] = [];
      while (i < pairs.length && pairs[i][1] === 'VERTEX') { const v = read(); vs.push({ x: sc(get(v, 10)), y: sc(get(v, 20)), bulge: +(get(v, 42) || 0) }); }
      if (pairs[i]?.[1] === 'SEQEND') read();
      const pl: any = { type: 'poly', closed, pts: vs.map(v => P(v.x, v.y)), layer, aci }; if (vs.some(v => Math.abs(v.bulge) > 1e-12)) pl.bulge = vs.map(v => v.bulge).slice(0, closed ? vs.length : vs.length - 1); ents.push(pl);
    }
  }
  return ents;
}
