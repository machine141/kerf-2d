/** Handing designs in (pupil) and gathering a class's designs onto one worksheet (teacher). */
import type { Doc, Entity, ClassEntry } from '../model/types';
import { migrateDoc } from '../model/types';
import { checkDesign, type Check } from './checks';

const clean = (t: string) => t.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();
export const ownerName = (name: string, cls: string) => clean(name) + (clean(cls) ? ' · ' + clean(cls) : '');

/** The file a pupil hands in: their drawing plus who made it and what the checks said. */
export function handInFile(doc: Doc, name: string, cls: string, title: string, checks: Check[]): { filename: string; text: string } {
  const d: Doc = JSON.parse(JSON.stringify(doc));
  d.name = clean(title) || d.name;
  d.handin = { name: clean(name), cls: clean(cls), title: clean(title) || d.name, at: new Date().toISOString(), warnings: checks.filter(c => c.level !== 'ok').map(c => c.text) };
  const filename = [clean(cls), clean(name), clean(title) || 'design'].filter(Boolean).join(' - ') + '.json';
  return { filename, text: JSON.stringify(d) };
}

/** One handed-in file, read back by the teacher. */
export interface Design { file: string; doc: Doc; name: string; cls: string; title: string; at: string; checks: Check[]; owner: string; error?: string }
export function readDesign(file: string, text: string, modified = 0): Design {
  const base = file.replace(/\.json$/i, '');
  try {
    const raw = JSON.parse(text); if (!raw || !Array.isArray(raw.ents) || !raw.page) throw new Error('not a Kerf 2D drawing');
    const doc = migrateDoc(raw), h = raw.handin;
    // a drawing saved with plain Save: take the name from the file name ("7B - Mia Jones - Star")
    const bits = base.split(/\s+-\s+/);
    const name = h?.name || (bits.length >= 2 ? bits[bits.length - 2] : base), cls = h?.cls ?? (bits.length >= 3 ? bits[0] : ''), title = h?.title || (bits.length >= 2 ? bits[bits.length - 1] : doc.name);
    return { file, doc, name, cls, title, at: h?.at || (modified ? new Date(modified).toISOString() : ''), checks: checkDesign(doc), owner: ownerName(name, cls) };
  } catch (e: any) {
    return { file, doc: null as any, name: base, cls: '', title: '', at: '', checks: [], owner: base, error: 'Could not read: ' + (e?.message || e) };
  }
}
/** The newest file for each pupil wins; older copies are marked. */
export function newestOnly(ds: Design[]): Set<Design> {
  const best = new Map<string, Design>();
  for (const d of ds) { if (d.error) continue; const k = d.owner.toLowerCase(), b = best.get(k); if (!b || d.at > b.at) best.set(k, d); }
  return new Set(best.values());
}
/** The objects of a design that go on the worksheet (visible layers, no dimensions). */
export function designEnts(d: Design): Entity[] {
  const vis = new Set(d.doc.layers.filter(l => l.visible).map(l => l.id));
  return d.doc.ents.filter(e => vis.has(e.layer) && e.type !== 'dim');
}
export function classEntry(d: Design): ClassEntry {
  return { owner: d.owner, name: d.name, cls: d.cls, title: d.title, file: d.file, warnings: d.checks.filter(c => c.level !== 'ok').map(c => c.text) };
}
/** CSV of the class list (who is on which sheet), for the technician. */
export function classCsv(rows: { e: ClassEntry; sheet: string }[]): string {
  const q = (t: string) => /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  return ['Name,Class,Design,Sheet,Notes', ...rows.map(r => [r.e.name, r.e.cls, r.e.title, r.sheet, r.e.warnings.join(' | ')].map(q).join(','))].join('\r\n');
}
