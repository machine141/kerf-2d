/**
 * LightBurn's layer colours (its fixed import palette, as listed in its public documentation).
 * LightBurn puts an imported shape on the layer whose colour matches exactly, so the
 * laser export writes these exact values. Kerf colours keep their own look on screen.
 */
import { COLORS, type ColorKey } from '../model/types';

export const LB_PALETTE: string[] = [
  '#000000', '#0000FF', '#FF0000', '#00E000', '#D0D000', '#FF8000', '#00E0E0', '#FF00FF', '#B4B4B4', '#0000A0',
  '#A00000', '#00A000', '#A0A000', '#C08000', '#00A0FF', '#A000A0', '#808080', '#7D87B9', '#BB7784', '#4A6FE3',
  '#D33F6A', '#8CD78C', '#F0B98D', '#F6C4E1', '#FA9ED4', '#500A78', '#B45A00', '#004754', '#86FA88', '#FFDB66',
];

/** Key for paint-bucket fills (they get a layer of their own). */
export type LaserKey = ColorKey | 'paint';

// Kerf colours that have a natural partner in LightBurn's palette keep it, so red stays layer 02, blue 01 …
const PINNED: Partial<Record<ColorKey, number>> = { ink: 0, blue: 1, red: 2, green: 3, yellow: 4, orange: 5, cyan: 6, magenta: 7, grey: 16, navy: 9, maroon: 10 };

const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const d2 = (a: string, b: string) => { const p = rgb(a), q = rgb(b); return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2; };

/** Every Kerf colour (and paint fills) → a LightBurn layer number, always the same one, never shared. */
export const LB_LAYER: Record<LaserKey, number> = (() => {
  const out: Record<string, number> = {}, used = new Set<number>();
  for (const [k, i] of Object.entries(PINNED)) { out[k] = i!; used.add(i!); }
  for (const k of Object.keys(COLORS) as ColorKey[]) {
    if (k in out) continue;
    let best = -1; for (let i = 0; i < LB_PALETTE.length; i++) if (!used.has(i) && (best < 0 || d2(COLORS[k].hex, LB_PALETTE[i]) < d2(COLORS[k].hex, LB_PALETTE[best]))) best = i;
    out[k] = best; used.add(best);
  }
  let p = 0; while (used.has(p)) p++; out.paint = p;
  return out as Record<LaserKey, number>;
})();

export const lbHex = (k: LaserKey) => LB_PALETTE[LB_LAYER[k]];
export const lbName = (k: LaserKey) => String(LB_LAYER[k]).padStart(2, '0');
