/**
 * "Export for laser": an SVG laid out for LightBurn (and any laser software that reads SVG).
 *  - shapes are written one after another in cut order (see order.ts);
 *  - each colour is written with LightBurn's exact layer colour, so it lands on the right layer;
 *  - the sheet outline can go on LightBurn's tool layer T1 (shown for lining up, never sent to the laser).
 */
import { fmt, clean } from '../geometry/vec';
import { COLORS, modeOf, MODE_LABEL, type Doc } from '../model/types';
import { cutOrder, PHASE_LABEL, type OrderOptions, type OrderResult, type Phase } from './order';
import { lbHex, lbName, LB_T1, type LaserKey } from './palette';
import { segsD } from './segs';

export interface LaserExportOptions extends OrderOptions { /** sheet outline on LightBurn's tool layer T1 (default on) */ outline?: boolean }
export interface LegendRow { key: LaserKey; label: string; kerfHex: string; layer: string; lbHex: string; does: string; count: number }
export interface LaserExport { svg: string; result: OrderResult; legend: LegendRow[]; counts: Record<Phase, number> }

const nf = (v: number) => fmt(clean(v), 6);
const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);

export function exportLaserSVG(doc: Doc, o: LaserExportOptions = {}): LaserExport {
  const { w, h } = doc.page, result = cutOrder(doc, o), out: string[] = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${nf(w)}mm" height="${nf(h)}mm" viewBox="0 0 ${nf(w)} ${nf(h)}">`,
    `<!-- ${esc(doc.name)} · Kerf 2D export for laser · 1 user unit = 1 mm · shapes are in cut order: engrave areas, engraved lines, then cuts (holes before outlines) -->`,
    `<g id="kerf-laser-job" fill="none" stroke-linecap="round" stroke-linejoin="round">`);
  if (o.outline !== false) out.push(`<rect id="sheet-outline" x="0" y="0" width="${nf(w)}" height="${nf(h)}" stroke="${LB_T1}" stroke-width="0.1"/>`);
  result.paths.forEach((p, i) => {
    const hx = lbHex(p.key), d = p.rings.map(r => segsD(r, p.kind === 'area' || p.closed, h)).join(' ');
    out.push(p.kind === 'area'
      ? `<path id="step-${i + 1}" d="${d}" fill="${hx}" fill-rule="evenodd" stroke="${hx}" stroke-width="${nf(p.w)}"/>`
      : `<path id="step-${i + 1}" d="${d}" stroke="${hx}" stroke-width="${nf(p.w)}"/>`);
  });
  out.push(`</g>`, `</svg>`);

  const counts: Record<Phase, number> = { engrave: 0, score: 0, cut: 0 }, per = new Map<LaserKey, number>();
  for (const p of result.paths) { counts[p.phase]++; per.set(p.key, (per.get(p.key) || 0) + 1); }
  const legend: LegendRow[] = [...per].map(([k, n]) => ({
    key: k, count: n, layer: lbName(k), lbHex: lbHex(k),
    label: k === 'paint' ? 'Paint-bucket fills' : COLORS[k].label, kerfHex: k === 'paint' ? '#F7B9D0' : COLORS[k].hex,
    does: k === 'paint' ? PHASE_LABEL.engrave : MODE_LABEL[modeOf(doc, k)],
  })).sort((a, b) => a.layer.localeCompare(b.layer));
  return { svg: out.join('\n'), result, legend, counts };
}
