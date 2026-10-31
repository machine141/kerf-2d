/**
 * The laser as Kerf knows it (saved on this computer): bed size, which way round it is, where the head parks,
 * and the settings last used. Nothing here talks to the machine yet.
 */
import { P, type Point } from '../geometry/vec';
import type { JobSettings } from './sim';

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
export type Material = 'custom' | 'ply3' | 'mdf3' | 'acrylic3';
export interface LaserState {
  machine: Machine;
  material: Material;
  settings: JobSettings;
  /** where the job goes: as placed on the bed, or starting where the head is */
  placeMode: 'bed' | 'head';
  /** sheet top-left on the bed (bed mode) */
  at: Point;
  /** head position (head mode) and which part of the job sits under it */
  head: Point; anchor: 'top-left' | 'centre';
  help: boolean;
}

/**
 * Example starting points only, for a 60 W CO₂ laser. Every machine and every sheet is different:
 * always do a test cut on a scrap and change these to what works on your laser.
 */
export const MATERIALS: Record<Material, { label: string; s: JobSettings }> = {
  custom: { label: 'My own settings', s: {
    engrave: { speed: 250, power: 20, passes: 1, air: true, on: true, interval: 0.1 },
    score: { speed: 100, power: 15, passes: 1, air: true, on: true },
    cut: { speed: 15, power: 60, passes: 1, air: true, on: true } } },
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

export const defaultState = (): LaserState => ({
  machine: { name: 'Ruida 644XS', bedW: 600, bedH: 400, park: 'back-right', flipLR: false, flipFB: false, setUp: false },
  material: 'custom', settings: structuredClone(MATERIALS.custom.s),
  placeMode: 'bed', at: P(10, 10), head: P(300, 200), anchor: 'top-left', help: true,
});

const KEY = 'kerf.laser';
export function loadState(): LaserState {
  const d = defaultState();
  try {
    const raw = localStorage.getItem(KEY); if (!raw) return d;
    const s = JSON.parse(raw);
    return { ...d, ...s, machine: { ...d.machine, ...s.machine }, settings: { engrave: { ...d.settings.engrave, ...s.settings?.engrave }, score: { ...d.settings.score, ...s.settings?.score }, cut: { ...d.settings.cut, ...s.settings?.cut } } };
  } catch { return d; }
}
export function saveState(s: LaserState) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private window: keep for this visit only */ } }

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
