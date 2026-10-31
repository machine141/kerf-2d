/**
 * The laser as Kerf knows it (saved on this computer): bed size, which way round it is, where the head parks,
 * and the settings last used. Nothing here talks to the machine yet.
 */
import { P, type Point } from '../geometry/vec';
import type { JobSettings, PhaseSet } from './sim';

/** Corners as you stand at the FRONT of the machine. */
export type Corner = 'back-left' | 'back-right' | 'front-left' | 'front-right';
/** What kind of laser it is. */
export type LaserKind = 'co2' | 'diode' | 'fibre';
/** The board inside the laser that runs it: decides which software can drive it, and later how Kerf talks to it. */
export type Controller = 'ruida' | 'grbl' | 'trocen' | 'topwisdom' | 'm2nano' | 'galvo' | 'driver' | 'other';
export const KINDS: Record<LaserKind, string> = { co2: 'CO₂ (glass or metal tube)', diode: 'Diode', fibre: 'Fibre' };
/**
 * Controllers, in plain words, with what works today (Kerf saves a file) and what's planned (Kerf drives it).
 * Facts about which software drives which controller are from the makers' and LightBurn's public documentation.
 */
export const CONTROLLERS: Record<Controller, { label: string; about: string; now: string; later: string }> = {
  ruida: { label: 'Ruida', about: 'Most CO₂ lasers made in China (e.g. RDC6442, 644XS)', now: 'Save file for LightBurn', later: 'Send straight from Kerf: planned (USB, or the network with a small helper app)' },
  grbl: { label: 'GRBL', about: 'Most diode lasers and some small CO₂ lasers', now: 'Save file for LightBurn or LaserGRBL', later: 'Send straight from Kerf: planned, by USB in Chrome or Edge. Likely the first one Kerf can drive' },
  trocen: { label: 'Trocen', about: 'AWC series, on some CO₂ lasers', now: 'Save file for LightBurn', later: 'Not planned yet' },
  topwisdom: { label: 'TopWisdom', about: 'TL series, on some CO₂ lasers', now: 'Save file for LightBurn', later: 'Not planned yet' },
  m2nano: { label: 'K40 stock board', about: 'The M2 Nano board that small K40 lasers come with', now: 'Save the SVG for K40 Whisperer or MeerK40t (LightBurn needs an upgraded board)', later: 'Not planned yet' },
  galvo: { label: 'Galvo (EZCAD-type)', about: 'Fibre and UV lasers that steer the beam with mirrors', now: 'Save file for LightBurn (galvo version) or EZCAD', later: 'Not planned' },
  driver: { label: "Maker's own driver", about: 'Trotec, Epilog, Universal and others that print from their own software', now: "Save the SVG and open it in the maker's own software", later: "Not possible: these are driven by the maker's software" },
  other: { label: 'Other / not sure', about: 'Any other laser', now: 'Save the SVG and import it into your laser software', later: 'Tell us the make and model' },
};
export interface Machine {
  /** each saved laser has its own id; materials made on it carry the id */
  id: string;
  name: string; bedW: number; bedH: number;
  kind: LaserKind; controller: Controller;
  /** tube or module power in watts (0 = not set) */
  watts: number;
  /** the bed moves up and down with a motor; the laser can find the focus height by itself */
  motorBed: boolean; autofocus: boolean;
  /** cut shadows left on this laser's bed (kept while another laser is chosen) */
  traces?: Trace[];
  /** the corner the head goes to when the laser is switched on */
  park: Corner;
  /** the picture (and later the moves) turned round to match the real machine */
  flipLR: boolean; flipFB: boolean;
  /** set up once: then the "Your laser" step stays folded */
  setUp: boolean;
}
/** A material saved by the user: settings for each colour (and for any other colour, by what it does). */
export interface MyMaterial { id: string; name: string; /** the laser it was made on (its id); none = any laser */ laser?: string; colors: Record<string, PhaseSet>; phase: JobSettings; /** mm (0 or missing: read from the name, e.g. "3 mm MDF") */ thickness?: number }
/** Where something was already cut on this sheet of material (bed coordinates), so the next job can go beside it. */
export interface Trace { when: string; name: string; parts: Point[][]; box: { x0: number; y0: number; x1: number; y1: number }; /** where the laser started cutting, and where the head was when it finished */ start: Point; end?: Point }
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
  /** the bed view: snap to grid (and how fine), the cross in the middle of the bed */
  snap: boolean; snapStep: number; showCentre: boolean;
  /** locks: stop the job or the laser being moved by accident */
  lockJob: boolean; lockLaser: boolean;
  /** moving the laser with the arrows: how far each press goes (mm) and how fast it moves while held (mm/s);
   *  the "base" is the number last typed: the mouse wheel goes up and down in steps of it (10 → 20, 30…) */
  jogStep: number; jogStepBase: number; jogSpeed: number; jogSpeedBase: number;
  /** settings (the ⚙ menu): optional tools are off at first, so a first-time user sees a simple screen */
  showAlign: boolean; showTurn: boolean;
  /** step lock: drags move in whole steps from where they started */
  stepLock: boolean; lockStep: number;
  /** where warnings (doesn't fit, lands on something already cut) are shown: in step 3, under the bed, on the bed at the top right */
  warnStep: boolean; warnUnder: boolean; warnTopRight: boolean;
  /** quick changes: how much one scroll or arrow changes a size or angle by; keep the shape when resizing */
  spinStep: number; keepShape: boolean;
  /** the last job file applied (its time stamp), so opening the Laser screen again keeps the technician's own changes */
  jobAt?: string;
  /** cutting extras (step 2): a test piece cut first, start somewhere different each pass, tabs (how many per part, how wide) */
  testPiece: boolean; spreadStarts: boolean; tabs: boolean; tabN: number; tabW: number;
  /** the material test last set up (Material test screen) */
  test?: import('./mattest').TestSpec;
  /** the other lasers saved on this computer (the one in use is `machine`) */
  lasers: Machine[];
}

/**
 * Common kinds of laser, as a starting point: check the bed size against your own machine.
 * Once Kerf is connected to a laser it will read the size from the laser itself.
 */
export const BED_PRESETS: { name: string; w: number; h: number; kind: LaserKind; controller: Controller }[] = [
  { name: 'Ruida 644XS · 6040 CO₂', w: 600, h: 400, kind: 'co2', controller: 'ruida' },
  { name: '9060 CO₂ (Ruida)', w: 900, h: 600, kind: 'co2', controller: 'ruida' },
  { name: '1390 CO₂ (Ruida, large)', w: 1300, h: 900, kind: 'co2', controller: 'ruida' },
  { name: 'K40 CO₂ (stock board)', w: 300, h: 200, kind: 'co2', controller: 'm2nano' },
  { name: 'Desktop diode laser (GRBL)', w: 400, h: 400, kind: 'diode', controller: 'grbl' },
  { name: 'Fibre galvo (110 mm lens)', w: 110, h: 110, kind: 'fibre', controller: 'galvo' },
];
export const newLaserId = () => 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
/** A file to share a laser with a colleague: its set-up and the materials made on it. */
export interface LaserFile { kerfLaser: 1; machine: Machine; materials: MyMaterial[] }
export function laserFile(s: LaserState): LaserFile {
  const { traces: _t, ...m } = s.machine;
  return { kerfLaser: 1, machine: { ...m, setUp: false } as Machine, materials: s.myMaterials.filter(x => !x.laser || x.laser === s.machine.id) };
}
/** Read a shared laser file: a new id (so it never replaces one of yours), its materials tagged with it. Null if it isn't one. */
export function readLaserFile(text: string): { machine: Machine; materials: MyMaterial[] } | null {
  try {
    const f = JSON.parse(text); if (!f || f.kerfLaser !== 1 || !f.machine || !(f.machine.bedW > 0) || !(f.machine.bedH > 0)) return null;
    const d = defaultState().machine, id = newLaserId();
    const machine: Machine = { ...d, ...f.machine, id, setUp: false, traces: [] };
    const materials: MyMaterial[] = (Array.isArray(f.materials) ? f.materials : []).filter((x: any) => x && x.name && x.phase).map((x: any, i: number) => ({ ...x, id: 'm' + Date.now().toString(36) + i, laser: id }));
    return { machine, materials };
  } catch { return null; }
}
/** Materials that belong with the laser in use (its own, and ones made before lasers had names). */
export const materialsFor = (s: LaserState) => s.myMaterials.filter(m => !m.laser || m.laser === s.machine.id);

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
  machine: { id: 'L-first', name: 'Ruida 644XS', bedW: 600, bedH: 400, kind: 'co2', controller: 'ruida', watts: 0, motorBed: true, autofocus: false, park: 'back-right', flipLR: false, flipFB: false, setUp: false },
  lasers: [],
  material: '', myMaterials: [], colors: {}, phase: structuredClone(START_SETTINGS),
  placeMode: 'bed', at: P(10, 10), head: P(300, 200), anchor: 'top-left',
  turns: 0, copies: 1, gap: 5, traces: [], showTraces: true, help: true,
  snap: true, snapStep: 5, showCentre: true, lockJob: false, lockLaser: false,
  jogStep: 10, jogStepBase: 10, jogSpeed: 50, jogSpeedBase: 10, spinStep: 1, keepShape: true,
  showAlign: false, showTurn: false, stepLock: false, lockStep: 1,
  warnStep: true, warnUnder: true, warnTopRight: false,
  testPiece: false, spreadStarts: false, tabs: false, tabN: 2, tabW: 0.6,
});

/** Grid spacing for a bed drawn at `s` pixels per mm: fine lines at least ~7 px apart, labels at least ~45 px apart. */
export function gridSteps(s: number): { minor: number; major: number; label: number } {
  const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500];
  const minor = nice.find(v => v * s >= 7) ?? 500, major = nice.find(v => v >= minor * 5 && v % minor === 0) ?? minor * 5, label = nice.find(v => v * s >= 45 && v % major === 0) ?? major;
  return { minor, major, label };
}
/** Round to the snap grid. */
export const snapTo = (v: number, step: number) => Math.round(v / step) * step;

const KEY = 'kerf.laser';
export function loadState(): LaserState {
  const d = defaultState();
  try {
    const raw = localStorage.getItem(KEY); if (!raw) return d;
    const s = JSON.parse(raw);
    const phase = { engrave: { ...d.phase.engrave, ...s.phase?.engrave }, score: { ...d.phase.score, ...s.phase?.score }, cut: { ...d.phase.cut, ...s.phase?.cut } };
    if (typeof s.jogSpeed !== 'number') delete s.jogSpeed;      // older versions saved 'slow' / 'medium' / 'fast'
    return { ...d, ...s, machine: { ...d.machine, ...s.machine }, phase, colors: s.colors || {}, myMaterials: Array.isArray(s.myMaterials) ? s.myMaterials : [], traces: Array.isArray(s.traces) ? s.traces : [], lasers: Array.isArray(s.lasers) ? s.lasers.map((m: any) => ({ ...d.machine, ...m })) : [] };
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
