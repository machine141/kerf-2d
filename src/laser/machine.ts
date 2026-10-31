/**
 * The laser as Kerf knows it (saved on this computer): bed size, which way round it is, where the head parks,
 * and the settings last used. Nothing here talks to the machine yet.
 */
import { P, type Point } from '../geometry/vec';
import type { JobSettings, PhaseSet } from './sim';

/** Corners as you stand at the FRONT of the machine. */
export type Corner = 'back-left' | 'back-right' | 'front-left' | 'front-right';
export interface Machine {
  name: string; bedW: number; bedH: number;
  /** the corner the head goes to when the laser is switched on */
  park: Corner;
  /** the picture (and later the moves) turned round to match the real machine */
  flipLR: boolean; flipFB: boolean;
  /** set up once: then the "Your laser" step stays folded */
  setUp: boolean;
}
/** A material saved by the user: settings for each colour (and for any other colour, by what it does). */
export interface MyMaterial { id: string; name: string; colors: Record<string, PhaseSet>; phase: JobSettings }
/** Where something was already cut on this sheet of material (bed coordinates), so the next job can go beside it. */
export interface Trace { when: string; name: string; parts: Point[][]; box: { x0: number; y0: number; x1: number; y1: number }; start: Point }
export interface LaserState {
  machine: Machine;
  /** chosen material: '' (none), 'ex:…' (an example) or one of mine by id */
  material: string;
  myMaterials: MyMaterial[];
  /** settings per Kerf colour (like LightBurn's layers) */
  colors: Record<string, PhaseSet>;
  /** settings for colours not set yet, by what the colour does */
  phase: JobSettings;
  /** where the job goes: as placed on the bed, or starting where the head is */
  placeMode: 'bed' | 'head';
  /** job top-left on the bed (bed mode) */
  at: Point;
  /** head position (head mode) and which part of the job sits under it */
  head: Point; anchor: 'top-left' | 'centre';
  /** quarter turns clockwise, copies and the gap between them */
  turns: number; copies: number; gap: number;
  /** what has been cut on the current sheet of material, and whether to show it */
  traces: Trace[]; showTraces: boolean;
  help: boolean;
}

/**
 * Example starting points only, for a 60 W CO₂ laser. Every machine and every sheet is different:
 * always do a test cut on a scrap and change these to what works on your laser.
 */
export const EXAMPLES: Record<string, { label: string; s: JobSettings }> = {
  ply3: { label: '3 mm birch plywood', s: {
    engrave: { speed: 300, power: 22, passes: 1, air: true, on: true, interval: 0.1 },
    score: { speed: 120, power: 18, passes: 1, air: true, on: true },
    cut: { speed: 15, power: 65, passes: 1, air: true, on: true } } },
  mdf3: { label: '3 mm MDF', s: {
    engrave: { speed: 300, power: 20, passes: 1, air: true, on: true, interval: 0.1 },
    score: { speed: 120, power: 16, passes: 1, air: true, on: true },
    cut: { speed: 12, power: 65, passes: 1, air: true, on: true } } },
  acrylic3: { label: '3 mm acrylic', s: {
    engrave: { speed: 300, power: 18, passes: 1, air: false, on: true, interval: 0.1 },
    score: { speed: 150, power: 12, passes: 1, air: false, on: true },
    cut: { speed: 10, power: 70, passes: 1, air: false, on: true } } },
};
export const START_SETTINGS: JobSettings = {
  engrave: { speed: 250, power: 20, passes: 1, air: true, on: true, interval: 0.1 },
  score: { speed: 100, power: 15, passes: 1, air: true, on: true },
  cut: { speed: 15, power: 60, passes: 1, air: true, on: true },
};

export const defaultState = (): LaserState => ({
  machine: { name: 'Ruida 644XS', bedW: 600, bedH: 400, park: 'back-right', flipLR: false, flipFB: false, setUp: false },
  material: '', myMaterials: [], colors: {}, phase: structuredClone(START_SETTINGS),
  placeMode: 'bed', at: P(10, 10), head: P(300, 200), anchor: 'top-left',
  turns: 0, copies: 1, gap: 5, traces: [], showTraces: true, help: true,
});

const KEY = 'kerf.laser';
export function loadState(): LaserState {
  const d = defaultState();
  try {
    const raw = localStorage.getItem(KEY); if (!raw) return d;
    const s = JSON.parse(raw);
    const phase = { engrave: { ...d.phase.engrave, ...s.phase?.engrave }, score: { ...d.phase.score, ...s.phase?.score }, cut: { ...d.phase.cut, ...s.phase?.cut } };
    return { ...d, ...s, machine: { ...d.machine, ...s.machine }, phase, colors: s.colors || {}, myMaterials: Array.isArray(s.myMaterials) ? s.myMaterials : [], traces: Array.isArray(s.traces) ? s.traces : [] };
  } catch { return d; }
}
export function saveState(s: LaserState) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private window: keep for this visit only */ } }

/** Do two boxes overlap (with a margin)? */
export const boxesMeet = (a: Trace['box'], b: Trace['box'], m = 0) => a.x0 < b.x1 + m && b.x0 < a.x1 + m && a.y0 < b.y1 + m && b.y0 < a.y1 + m;
/** Is a point inside a closed outline? */
export function inside(p: Point, q: Point[]): boolean {
  let c = false; for (let i = 0, j = q.length - 1; i < q.length; j = i++) { const a = q[i], b = q[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c; } return c;
}
/** Would a job's outlines (bed coords) land on something already cut? Checks each outline's points against the traces' outlines. */
export function overlapsTraces(job: Point[][], traces: Trace[], margin = 1): number {
  let hits = 0;
  for (const t of traces) for (const part of t.parts) {
    if (part.length < 3) continue;
    const pb = part.reduce((b, p) => ({ x0: Math.min(b.x0, p.x), y0: Math.min(b.y0, p.y), x1: Math.max(b.x1, p.x), y1: Math.max(b.y1, p.y) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
    for (const q of job) {
      if (!q.length) continue;
      const qb = q.reduce((b, p) => ({ x0: Math.min(b.x0, p.x), y0: Math.min(b.y0, p.y), x1: Math.max(b.x1, p.x), y1: Math.max(b.y1, p.y) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
      if (!boxesMeet(pb, qb, margin)) continue;
      if (q.some(p => inside(p, part)) || (q.length > 2 && part.some(p => inside(p, q)))) { hits++; break; }
    }
  }
  return hits;
}

/** The parking corner in bed coordinates (x from the left, y from the back). */
export function cornerPt(m: Machine, c: Corner = m.park): Point {
  return P(c.endsWith('left') ? 0 : m.bedW, c.startsWith('back') ? 0 : m.bedH);
}

/** Does a box (bed coordinates) fit on the bed? If not, a plain sentence saying which way it goes over. */
export function fitsBed(m: Machine, b: { x0: number; y0: number; x1: number; y1: number }): string | null {
  const over: string[] = [], r = (v: number) => Math.ceil(v);
  if (b.x0 < 0) over.push(`${r(-b.x0)} mm past the left-hand side`);
  if (b.x1 > m.bedW) over.push(`${r(b.x1 - m.bedW)} mm past the right-hand side`);
  if (b.y0 < 0) over.push(`${r(-b.y0)} mm past the back`);
  if (b.y1 > m.bedH) over.push(`${r(b.y1 - m.bedH)} mm past the front`);
  return over.length ? 'This would go ' + over.join(' and ') + '.' : null;
}
