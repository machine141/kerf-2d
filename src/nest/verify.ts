/** For checks and scripts: do any two parts come closer than `gap`? (each part's outline grown by just under half the gap) */
import ClipperLib from 'clipper-lib';
import type { Entity } from '../model/types';
import { findParts } from './parts';
import { growOutline } from './nest';

export function tooClose(ents: Entity[], gap: number, groupRoot: (e: Entity) => string | null): { pairs: number; parts: number } {
  const L: any = ClipperLib, parts = findParts(ents, groupRoot).map(p => growOutline(p.polys, gap / 2 - 0.05, 0));
  let pairs = 0;
  for (let i = 0; i < parts.length; i++) for (let k = i + 1; k < parts.length; k++) {
    const c = new L.Clipper(), out = new L.Paths(); c.AddPaths(parts[i], 0, true); c.AddPaths(parts[k], 1, true); c.Execute(0, out, 1, 1);
    if ((out as any[]).some(q => Math.abs(L.Clipper.Area(q)) > 100)) pairs++;
  }
  return { pairs, parts: parts.length };
}
