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
import arimo from '@fontsource/arimo/files/arimo-latin-700-normal.woff?inline';
import arimoReg from '@fontsource/arimo/files/arimo-latin-400-normal.woff?inline';
import roboto from '@fontsource/roboto/files/roboto-latin-700-normal.woff?inline';
import opensans from '@fontsource/open-sans/files/open-sans-latin-700-normal.woff?inline';
import lato from '@fontsource/lato/files/lato-latin-700-normal.woff?inline';
import montserrat from '@fontsource/montserrat/files/montserrat-latin-700-normal.woff?inline';
import poppins from '@fontsource/poppins/files/poppins-latin-600-normal.woff?inline';
import nunito from '@fontsource/nunito/files/nunito-latin-800-normal.woff?inline';
import atkinson from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff?inline';
import oswald from '@fontsource/oswald/files/oswald-latin-600-normal.woff?inline';
import merri from '@fontsource/merriweather/files/merriweather-latin-700-normal.woff?inline';
import playfair from '@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff?inline';
import comicneue from '@fontsource/comic-neue/files/comic-neue-latin-700-normal.woff?inline';
import slab from '@fontsource/roboto-slab/files/roboto-slab-latin-600-normal.woff?inline';

export type FontGroup = 'simple' | 'fun' | 'script' | 'engrave';
export interface FontInfo { id: string; name: string; note: string; group: FontGroup; data?: string; licence: string }
const OFL = 'SIL OFL 1.1';
export const FONTS: FontInfo[] = [
  // simple, easy to read
  { id: 'arimo', name: 'Arimo Bold', note: 'plain and clear (like Arial) — the default', group: 'simple', data: arimo, licence: OFL },
  { id: 'arimo-reg', name: 'Arimo', note: 'plain, thinner — good for engraving', group: 'simple', data: arimoReg, licence: OFL },
  { id: 'roboto', name: 'Roboto', note: 'clean and modern', group: 'simple', data: roboto, licence: OFL },
  { id: 'opensans', name: 'Open Sans', note: 'friendly and very readable', group: 'simple', data: opensans, licence: OFL },
  { id: 'lato', name: 'Lato', note: 'smooth and neat', group: 'simple', data: lato, licence: OFL },
  { id: 'atkinson', name: 'Atkinson Hyperlegible', note: 'made to be easy to read', group: 'simple', data: atkinson, licence: OFL },
  { id: 'montserrat', name: 'Montserrat', note: 'wide and bold — signs and posters', group: 'simple', data: montserrat, licence: OFL },
  { id: 'poppins', name: 'Poppins', note: 'round and geometric', group: 'simple', data: poppins, licence: OFL },
  { id: 'nunito', name: 'Nunito', note: 'soft rounded ends', group: 'simple', data: nunito, licence: OFL },
  { id: 'oswald', name: 'Oswald', note: 'tall and narrow — fits long words', group: 'simple', data: oswald, licence: OFL },
  { id: 'slab', name: 'Roboto Slab', note: 'classic, with feet (serifs)', group: 'simple', data: slab, licence: 'Apache 2.0' },
  { id: 'merri', name: 'Merriweather', note: 'book style serif', group: 'simple', data: merri, licence: OFL },
  { id: 'playfair', name: 'Playfair Display', note: 'elegant serif — awards and plaques', group: 'simple', data: playfair, licence: OFL },
  // fun
  { id: 'fredoka', name: 'Fredoka', note: 'rounded and cute', group: 'fun', data: fredoka, licence: OFL },
  { id: 'baloo', name: 'Baloo 2', note: 'chunky and friendly', group: 'fun', data: baloo, licence: OFL },
  { id: 'comicneue', name: 'Comic Neue', note: 'comic style, clear', group: 'fun', data: comicneue, licence: OFL },
  { id: 'comfortaa', name: 'Comfortaa', note: 'round and modern', group: 'fun', data: comfortaa, licence: OFL },
  { id: 'bebas', name: 'Bebas Neue', note: 'tall capitals', group: 'fun', data: bebas, licence: OFL },
  { id: 'bungee', name: 'Bungee', note: 'blocky sign letters', group: 'fun', data: bungee, licence: OFL },
  { id: 'stencil', name: 'Allerta Stencil', note: 'stencil — letter middles stay when cut out', group: 'fun', data: stencil, licence: OFL },
  // script
  { id: 'pacifico', name: 'Pacifico', note: 'joined-up script — names cut as one piece', group: 'script', data: pacifico, licence: OFL },
  { id: 'lobster', name: 'Lobster', note: 'bold script', group: 'script', data: lobster, licence: OFL },
  { id: 'caveat', name: 'Caveat', note: 'handwriting', group: 'script', data: caveat, licence: OFL },
  // engraving
  { id: 'kerf-line', name: 'Kerf single-line', note: 'engraving — one line per stroke, fastest', group: 'engrave', licence: 'Kerf 2D' },
];
export const FONT_GROUPS: [FontGroup, string][] = [['simple', 'Simple'], ['fun', 'Fun'], ['script', 'Script'], ['engrave', 'Engraving']];
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
  if (!FONTS.some(f => f.id === id)) FONTS.push({ id, name, note: 'your font', group: 'fun', licence: 'check the font’s own licence' });
  return id;
}
/** Font data URL for the font menu's previews. */
export const fontDataUrl = (id: string) => FONTS.find(f => f.id === id)?.data;
