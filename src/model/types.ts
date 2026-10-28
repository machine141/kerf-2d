import type { Point } from '../geometry/vec';

/** Colour keys double as laser conventions (red = cut, blue = engrave). */
export type ColorKey = 'ink' | 'red' | 'blue' | 'green' | 'magenta' | 'orange' | 'grey';

/** group: stack of group ids, outermost last (selecting one member selects the whole outer group). */
export interface EntBase { id: string; layer: string; color: ColorKey; w: number; group?: string[] }
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
export type Entity = LineEnt | PolyEnt | CircleEnt | EllipseEnt | ArcEnt | SplineEnt | DimEnt | TextEnt;
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
}

export const COLORS: Record<ColorKey, { label: string; hex: string; aci: number; tok: string }> = {
  ink: { label: 'Black', hex: '#000000', aci: 7, tok: '--ink' },
  red: { label: 'Red · cut', hex: '#FF0000', aci: 1, tok: '--c-red' },
  blue: { label: 'Blue · engrave', hex: '#0000FF', aci: 5, tok: '--c-blue' },
  green: { label: 'Green', hex: '#00FF00', aci: 3, tok: '--c-green' },
  magenta: { label: 'Magenta', hex: '#FF00FF', aci: 6, tok: '--c-magenta' },
  orange: { label: 'Orange', hex: '#FF8000', aci: 30, tok: '--c-orange' },
  grey: { label: 'Grey · dimensions', hex: '#808080', aci: 8, tok: '--c-grey' },
};
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
