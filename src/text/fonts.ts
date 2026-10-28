/**
 * Fonts for the Text tool. All are free to use and embed (SIL Open Font
 * Licence or Apache 2.0, via Fontsource), trimmed to Latin letters and built
 * into the app so it works offline. Read with opentype.js (MIT).
 * Plus the Kerf single-line font (engraving, original to Kerf 2D).
 */
import { parse } from 'opentype.js';
import fredoka from '@fontsource/fredoka/files/fredoka-latin-600-normal.woff?inline';
import baloo from '@fontsource/baloo-2/files/baloo-2-latin-700-normal.woff?inline';
import pacifico from '@fontsource/pacifico/files/pacifico-latin-400-normal.woff?inline';
import lobster from '@fontsource/lobster/files/lobster-latin-400-normal.woff?inline';
import bebas from '@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff?inline';
import bungee from '@fontsource/bungee/files/bungee-latin-400-normal.woff?inline';
import comfortaa from '@fontsource/comfortaa/files/comfortaa-latin-700-normal.woff?inline';
import caveat from '@fontsource/caveat/files/caveat-latin-700-normal.woff?inline';
import stencil from '@fontsource/allerta-stencil/files/allerta-stencil-latin-400-normal.woff?inline';
import slab from '@fontsource/roboto-slab/files/roboto-slab-latin-600-normal.woff?inline';

export interface FontInfo { id: string; name: string; note: string; data?: string; licence: string }
export const FONTS: FontInfo[] = [
  { id: 'fredoka', name: 'Fredoka', note: 'rounded and cute', data: fredoka, licence: 'SIL OFL 1.1' },
  { id: 'baloo', name: 'Baloo 2', note: 'chunky and friendly', data: baloo, licence: 'SIL OFL 1.1' },
  { id: 'pacifico', name: 'Pacifico', note: 'joined-up script — names cut as one piece', data: pacifico, licence: 'SIL OFL 1.1' },
  { id: 'lobster', name: 'Lobster', note: 'bold script', data: lobster, licence: 'SIL OFL 1.1' },
  { id: 'bebas', name: 'Bebas Neue', note: 'tall capitals', data: bebas, licence: 'SIL OFL 1.1' },
  { id: 'bungee', name: 'Bungee', note: 'blocky sign letters', data: bungee, licence: 'SIL OFL 1.1' },
  { id: 'comfortaa', name: 'Comfortaa', note: 'round and modern', data: comfortaa, licence: 'SIL OFL 1.1' },
  { id: 'caveat', name: 'Caveat', note: 'handwriting', data: caveat, licence: 'SIL OFL 1.1' },
  { id: 'stencil', name: 'Allerta Stencil', note: 'stencil — letter middles stay when cut out', data: stencil, licence: 'SIL OFL 1.1' },
  { id: 'slab', name: 'Roboto Slab', note: 'classic', data: slab, licence: 'Apache 2.0' },
  { id: 'kerf-line', name: 'Kerf single-line', note: 'engraving — one line per stroke, fastest', licence: 'Kerf 2D' },
];
const parsed = new Map<string, any>();
/** The parsed opentype font (null for the single-line font or if it can't be read). */
export function otFont(id: string): any | null {
  if (parsed.has(id)) return parsed.get(id);
  const f = FONTS.find(x => x.id === id), extra = userFonts.get(id); let font: any = null;
  try {
    if (extra) font = extra;
    else if (f?.data) { const b64 = f.data.slice(f.data.indexOf(',') + 1), bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); font = parse(u.buffer); }
  } catch { font = null; }
  parsed.set(id, font); return font;
}
/** Fonts the user dropped in (kept for this session). */
const userFonts = new Map<string, any>();
export function addUserFont(name: string, buf: ArrayBuffer): string {
  const font = parse(buf), id = 'user-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  userFonts.set(id, font); parsed.delete(id);
  if (!FONTS.some(f => f.id === id)) FONTS.push({ id, name, note: 'your font', licence: 'check the font’s own licence' });
  return id;
}
/** Font data URL for the font menu's previews. */
export const fontDataUrl = (id: string) => FONTS.find(f => f.id === id)?.data;
