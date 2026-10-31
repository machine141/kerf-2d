/**
 * "For the laser" notes that travel with a drawing (Hand in, or Export → For the technician):
 * what to cut it from, how thick, how many. When the technician opens the file, Kerf goes to the
 * Laser screen and picks the saved material that matches, so nobody scrolls through a long list.
 * Optional: teachers switch it on in Settings (it is off at first).
 */
import { EXAMPLES, type MyMaterial } from './machine';
import type { JobInfo } from '../model/types';

export type { JobInfo };

/** A short list for pupils to choose from when no materials are saved on their computer. */
export const COMMON_MATERIALS = ['Plywood', 'MDF', 'Acrylic', 'Card', 'Cardboard', 'Paper', 'Cork', 'Felt', 'Leather'];
export const COMMON_THICKNESS = [1, 1.5, 2, 3, 4, 5, 6];

/** "3 mm birch ply" → 3; "MDF 6mm" → 6; nothing → 0 */
export function thicknessIn(name: string): number {
  const m = /(\d+(?:[.,]\d+)?)\s*mm\b/i.exec(name); return m ? parseFloat(m[1].replace(',', '.')) : 0;
}
/** The words that say what a material is, without the thickness: "3 mm Birch Ply" → ["birch", "ply"] */
export function materialWords(name: string): string[] {
  return name.toLowerCase().replace(/\d+(?:[.,]\d+)?\s*mm\b/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter(w => w.length > 1);
}
// plywood, ply and birch ply are the same thing; perspex is acrylic
const SAME: Record<string, string> = { plywood: 'ply', perspex: 'acrylic', plexiglass: 'acrylic', pmma: 'acrylic' };
const norm = (w: string) => SAME[w] || w;

export interface MatChoice { value: string; name: string; thickness: number }
/** Every material that could be chosen in the Laser screen: the user's own first, then the examples. */
export function materialChoices(mine: MyMaterial[]): MatChoice[] {
  return [
    ...mine.map(m => ({ value: m.id, name: m.name, thickness: m.thickness || thicknessIn(m.name) })),
    ...Object.entries(EXAMPLES).map(([k, e]) => ({ value: 'ex:' + k, name: e.label, thickness: thicknessIn(e.label) })),
  ];
}

/**
 * Saved materials that match what was asked for: every word the pupil chose appears in the material's name
 * (plywood = ply, perspex = acrylic), and the thickness is the same when both say one. Own materials come first.
 */
export function matchMaterial(job: Pick<JobInfo, 'material' | 'thickness'>, mine: MyMaterial[]): MatChoice[] {
  const want = materialWords(job.material).map(norm); if (!want.length) return [];
  return materialChoices(mine).filter(c => {
    const have = new Set(materialWords(c.name).map(norm));
    if (!want.every(w => have.has(w))) return false;
    return !(job.thickness > 0 && c.thickness > 0 && Math.abs(c.thickness - job.thickness) > 0.01);
  }).sort((a, b) => Number(b.thickness > 0) - Number(a.thickness > 0));
}

/** "3 mm MDF · 2 copies" */
export function jobLabel(j: JobInfo): string {
  const t = j.thickness > 0 ? `${j.thickness} mm ` : '';
  return `${t}${j.material || 'material not said'}${j.copies > 1 ? ` · ${j.copies} copies` : ''}`;
}
