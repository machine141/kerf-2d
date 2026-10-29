import type { Point } from '../geometry/vec';

/** Colour keys double as laser conventions (red = cut, blue = engrave). */
export type ColorKey = 'ink' | 'red' | 'blue' | 'green' | 'magenta' | 'orange' | 'grey'
  | 'yellow' | 'gold' | 'brown' | 'coral' | 'pink' | 'maroon' | 'purple' | 'violet' | 'navy' | 'sky' | 'cyan' | 'teal' | 'mint' | 'lime' | 'olive' | 'slate';
/** What the laser does with a colour: cut through, engrave the line, engrave (fill) the area inside, or nothing (left out of exports). */
export type LaserMode = 'cut' | 'score' | 'fill' | 'off';

/** group: stack of group ids, outermost last (selecting one member selects the whole outer group). */
export interface EntBase { id: string; layer: string; color: ColorKey; w: number; group?: string[]; /** made by a tool and rebuilt by it (e.g. 'hinge' = Hinge brush slits) */ gen?: string; /** whose design this is (class worksheets), e.g. "Mia Jones · 7B" */ owner?: string }
export interface LineEnt extends EntBase { type: 'line'; a: Point; b: Point }
/** bulge[i] (optional) makes segment i a true arc: tan(sweep/4), + anticlockwise, − clockwise. */
export interface PolyEnt extends EntBase { type: 'poly'; pts: Point[]; closed: boolean; bulge?: number[] }
export interface CircleEnt extends EntBase { type: 'circle'; c: Point; r: number }
export interface EllipseEnt extends EntBase { type: 'ellipse'; c: Point; rx: number; ry: number; rot: number }
/** Arc runs anticlockwise from a0 to a1 (radians). */
export interface ArcEnt extends EntBase { type: 'arc'; c: Point; r: number; a0: number; a1: number }
export interface DimEnt extends EntBase { type: 'dim'; mode: 'a' | 'h' | 'v' | 'r' | 'd'; p1: Point; p2: Point; off: Point; text?: string }
/* Radius ('r') / diameter ('d') dimensions: p1 = centre, p2 = a point on the circle, off = label position. */

/** Smooth curve: anchors with in/out handles (cubic Bézier segments). */
export interface SplineEnt extends EntBase { type: 'spline'; pts: Point[]; h: [Point, Point][]; closed: boolean }
/** Where text sits on a line or curve (see text/text.ts). */
export interface TextPath { ref?: string; geom: Shape; pos: number; anchor: 'start' | 'center' | 'end' | 'fit'; side: 'above' | 'on' | 'below'; flip: boolean; effect: 'rainbow' | 'stretch' | 'skew' | 'stair'; lift: number }
/** Editable text: size = capital height (mm); at = alignment point on the first baseline; optionally on a path. */
export interface TextEnt extends EntBase { type: 'text'; text: string; font: string; size: number; spacing: number; lineSpacing: number; align: 'left' | 'center' | 'right'; at: Point; angle: number; mirror?: boolean; path?: TextPath }
/** Paint-bucket fill: an enclosed area (first ring the outside, any more are holes), in a soft colour. */
export interface FillEnt extends EntBase { type: 'fill'; rings: Point[][]; paint: PaintKey }
export type Entity = LineEnt | PolyEnt | CircleEnt | EllipseEnt | ArcEnt | SplineEnt | DimEnt | TextEnt | FillEnt;
/** Soft fill colours for the paint bucket (shown see-through on screen; exported as solid colours). */
export type PaintKey = 'pink' | 'peach' | 'lemon' | 'mint' | 'sky' | 'lavender' | 'coral' | 'aqua' | 'sand' | 'grey';
export const PAINTS: Record<PaintKey, { label: string; hex: string }> = {
  pink: { label: 'Pink', hex: '#F7B9D0' }, peach: { label: 'Peach', hex: '#FFD3A8' }, lemon: { label: 'Lemon', hex: '#FFF0A0' }, mint: { label: 'Mint', hex: '#BDEBC8' },
  sky: { label: 'Sky', hex: '#B5DBFA' }, lavender: { label: 'Lavender', hex: '#D7C6F2' }, coral: { label: 'Coral', hex: '#FFB3A3' }, aqua: { label: 'Aqua', hex: '#B3EEE8' },
  sand: { label: 'Sand', hex: '#EBDDC2' }, grey: { label: 'Grey', hex: '#D6D6D6' },
};
/** An entity before it has been given an id/layer/colour. */
export type Shape = DistributiveOmit<Entity, keyof EntBase> & Partial<EntBase>;
type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;

export interface Layer { id: string; name: string; visible: boolean; active: boolean }

export interface Aids {
  grid: { show: boolean; spacing: number };
  /** alignment guides from recently touched snap points */
  track: boolean;
  gridLock: boolean;
  stepLock: boolean;
  step: number;
  radial: { on: boolean; start: number; step: number };
  attach: { on: boolean; box: number; end: boolean; mid: boolean; centre: boolean; quad: boolean; inter: boolean; nearest: boolean; perp: boolean; tangent: boolean };
}

export interface DimStyle { dec: number; textH: number; arrow: number; color: ColorKey; unit: 'mm' | 'in' | 'none' }

export interface Doc {
  v: number;
  name: string;
  units: 'mm';
  page: { w: number; h: number; preset: string };
  aids: Aids;
  dim: DimStyle;
  layers: Layer[];
  current: string;
  attrs: { color: ColorKey; w: number };
  seq: number;
  ents: Entity[];
  /** Hinge brush: painted areas, in the order they were made (not exported; turned into slits by Make cuts) */
  hinge?: HingeMark[];
  /** Make cuts has been used: changes to the painted areas rebuild the slits straight away */
  hingeMade?: boolean;
  /** laser setting per colour (missing = the default) */
  modes?: Partial<Record<ColorKey, LaserMode>>;
  /** how many sheets (the extra ones sit to the right of the first, SHEET_GAP apart) */
  sheets?: number;
  /** set when a student hands the design in */
  handin?: HandIn;
  /** class worksheet: whose designs are on it */
  classList?: ClassEntry[];
}
/** What a student fills in when handing in. */
export interface HandIn { name: string; cls: string; title: string; at: string; warnings: string[] }
/** One student's design on a class worksheet. */
export interface ClassEntry { owner: string; name: string; cls: string; title: string; file: string; warnings: string[] }
/** Space between sheets on the page, mm. */
export const SHEET_GAP = 20;
/** Left edge of sheet k (0 = the first). */
export const sheetX = (doc: { page: { w: number } }, k: number) => k * (doc.page.w + SHEET_GAP);
/** Which sheet a point is on (-1 = none). */
export function sheetAt(doc: { page: { w: number; h: number }; sheets?: number }, x: number, y: number): number {
  const n = Math.max(1, doc.sheets || 1);
  for (let k = 0; k < n; k++) { const x0 = sheetX(doc, k); if (x >= x0 - 1e-6 && x <= x0 + doc.page.w + 1e-6 && y >= -1e-6 && y <= doc.page.h + 1e-6) return k; }
  return -1;
}
/** Hinge brush pattern: each has its own pastel colour. */
export type HingePattern = 'straight' | 'wavy' | 'lattice' | 'honeycomb' | 'rings' | 'spokes' | 'fold';
/** One painted area: a brush stroke, a fold line, a clicked area, or an eraser stroke. */
export type HingeMark =
  | { kind: 'brush'; pattern: HingePattern; pts: Point[]; r: number; over?: boolean; c?: Point; angle?: number; follow?: boolean }
  | { kind: 'fold'; pattern: HingePattern; a: Point; b: Point; w: number; over?: boolean; c?: Point; angle?: number }
  | { kind: 'area'; pattern: HingePattern; pts: Point[]; at?: Point; over?: boolean; c?: Point; angle?: number }
  | { kind: 'erase'; pts: Point[]; r: number };

export const COLORS: Record<ColorKey, { label: string; hex: string; aci: number; tok: string }> = {
  ink: { label: 'Black', hex: '#000000', aci: 7, tok: '--ink' },
  red: { label: 'Red', hex: '#FF0000', aci: 1, tok: '--c-red' },
  blue: { label: 'Blue', hex: '#0000FF', aci: 5, tok: '--c-blue' },
  green: { label: 'Green', hex: '#00FF00', aci: 3, tok: '--c-green' },
  magenta: { label: 'Magenta', hex: '#FF00FF', aci: 6, tok: '--c-magenta' },
  orange: { label: 'Orange', hex: '#FF8000', aci: 30, tok: '--c-orange' },
  grey: { label: 'Grey', hex: '#808080', aci: 8, tok: '--c-grey' },
  yellow: { label: 'Yellow', hex: '#E6C200', aci: 2, tok: '' },
  gold: { label: 'Gold', hex: '#B8860B', aci: 42, tok: '' },
  brown: { label: 'Brown', hex: '#8B4513', aci: 24, tok: '' },
  coral: { label: 'Coral', hex: '#FF6F61', aci: 20, tok: '' },
  pink: { label: 'Pink', hex: '#FF69B4', aci: 221, tok: '' },
  maroon: { label: 'Maroon', hex: '#800000', aci: 14, tok: '' },
  purple: { label: 'Purple', hex: '#7B2CBF', aci: 200, tok: '' },
  violet: { label: 'Violet', hex: '#A685E2', aci: 191, tok: '' },
  navy: { label: 'Navy', hex: '#000080', aci: 178, tok: '' },
  sky: { label: 'Sky blue', hex: '#3FA9F5', aci: 140, tok: '' },
  cyan: { label: 'Cyan', hex: '#00B7C7', aci: 4, tok: '' },
  teal: { label: 'Teal', hex: '#008080', aci: 134, tok: '' },
  mint: { label: 'Mint', hex: '#3EB489', aci: 110, tok: '' },
  lime: { label: 'Lime', hex: '#7CB518', aci: 82, tok: '' },
  olive: { label: 'Olive', hex: '#6B7A1E', aci: 54, tok: '' },
  slate: { label: 'Slate', hex: '#4A5A6A', aci: 250, tok: '' },
};
/** Laser settings each colour starts with: most cut; blues engrave the line; yellow and gold engrave the area. */
export const DEFAULT_MODES: Record<ColorKey, LaserMode> = Object.fromEntries((Object.keys(COLORS) as ColorKey[]).map(k => [k, k === 'blue' || k === 'sky' || k === 'navy' ? 'score' : k === 'yellow' || k === 'gold' ? 'fill' : 'cut'])) as any;
export const MODE_LABEL: Record<LaserMode, string> = { cut: 'Cut', score: 'Engrave line', fill: 'Engrave area', off: 'Don’t cut' };
export const modeOf = (doc: { modes?: Partial<Record<ColorKey, LaserMode>> }, k: ColorKey): LaserMode => doc.modes?.[k] ?? DEFAULT_MODES[k] ?? 'cut';
/** e.g. "Red · Cut" */
export const colorLabel = (doc: { modes?: Partial<Record<ColorKey, LaserMode>> }, k: ColorKey) => `${COLORS[k]?.label ?? k} · ${MODE_LABEL[modeOf(doc, k)]}`;
export const WIDTHS = [0.01, 0.1, 0.25, 0.35, 0.5, 0.75, 1];
export const PAGES: Record<string, [number, number, string]> = {
  A4L: [297, 210, 'A4 landscape'], A4P: [210, 297, 'A4 portrait'], A3L: [420, 297, 'A3 landscape'], A3P: [297, 420, 'A3 portrait'],
  L300: [300, 200, 'Laser 300 × 200'], L400: [400, 300, 'Laser 400 × 300'], BED: [600, 400, 'Laser 600 × 400'], L700: [700, 500, 'Laser 700 × 500'], L900: [900, 600, 'Laser 900 × 600'], L1000: [1000, 600, 'Laser 1000 × 600'], CUSTOM: [0, 0, 'Custom'],
};

export function newDoc(): Doc {
  return {
    v: 3, name: 'Untitled', units: 'mm', page: { w: 297, h: 210, preset: 'A4L' },
    aids: {
      grid: { show: true, spacing: 10 }, track: true, gridLock: false, stepLock: false, step: 1, radial: { on: false, start: 0, step: 45 },
      attach: { on: true, box: 12, end: true, mid: true, centre: true, quad: false, inter: true, nearest: true, perp: false, tangent: false },
    },
    dim: { dec: 2, textH: 3.5, arrow: 2.5, color: 'grey', unit: 'mm' },
    layers: [{ id: 'L1', name: 'Cut', visible: true, active: true }], current: 'L1',
    attrs: { color: 'ink', w: 0.1 }, seq: 1, ents: [],
  };
}

/** Bring older saved drawings up to the current format. */
export function migrateDoc(d: any): Doc {
  const base = newDoc();
  const out: Doc = { ...base, ...d, aids: { ...base.aids, ...(d.aids || {}), attach: { ...base.aids.attach, ...(d.aids?.attach || {}) } }, dim: { ...base.dim, ...(d.dim || {}) } };
  out.v = base.v;
  return out;
}
