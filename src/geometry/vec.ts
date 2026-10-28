/** Basic 2D vector maths. World units are millimetres, y axis up. */
export interface Point { x: number; y: number }

export const TAU = Math.PI * 2;
export const EPS = 1e-9;
export const DEG = Math.PI / 180;

export const P = (x: number, y: number): Point => ({ x, y });
export const add = (a: Point, b: Point) => P(a.x + b.x, a.y + b.y);
export const sub = (a: Point, b: Point) => P(a.x - b.x, a.y - b.y);
export const mul = (a: Point, k: number) => P(a.x * k, a.y * k);
export const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
export const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
export const len = (a: Point) => Math.hypot(a.x, a.y);
export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a: Point, b: Point) => P((a.x + b.x) / 2, (a.y + b.y) / 2);

/** Normalise an angle to [0, 2π). */
export const normA = (a: number) => { a %= TAU; return a < 0 ? a + TAU : a; };
export const angOf = (c: Point, p: Point) => Math.atan2(p.y - c.y, p.x - c.x);
export const polar = (c: Point, r: number, a: number) => P(c.x + r * Math.cos(a), c.y + r * Math.sin(a));
/** True if angle a lies on the anticlockwise sweep from a0 to a1. */
export const angIn = (a: number, a0: number, a1: number) => normA(a - a0) <= normA(a1 - a0) + 1e-12;
export const rotP = (p: Point, c: Point, t: number) => {
  const s = Math.sin(t), k = Math.cos(t), d = sub(p, c);
  return P(c.x + d.x * k - d.y * s, c.y + d.x * s + d.y * k);
};

/**
 * Remove floating-point noise: values within 1e-10 of an integer, or within
 * 1e-10 of a 6-decimal value, are snapped. Keeps typed values exact.
 */
export const clean = (v: number) => {
  const r = Math.round(v);
  if (Math.abs(v - r) < 1e-10) return r;
  const r6 = Math.round(v * 1e6);
  return Math.abs(v * 1e6 - r6) < 1e-4 ? r6 / 1e6 : v;
};
export const cp = (p: Point) => P(clean(p.x), clean(p.y));

/** Format a number with up to d decimals, trimming trailing zeros. */
export function fmt(v: number, d = 3): string {
  if (!isFinite(v)) return '—';
  let s = v.toFixed(d);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

/**
 * Parse a length typed with an optional unit (mm default), e.g. "20", "2cm", "1in", "0.5 inch".
 * Returns NaN when it cannot be read.
 */
export function parseLength(text: string, defaultUnit: 'mm' | 'cm' | 'm' | 'in' = 'mm'): number {
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*([a-z"']*)\s*$/i.exec(text);
  if (!m) return NaN;
  const v = parseFloat(m[1]);
  const u = (m[2] || defaultUnit).toLowerCase();
  const f: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, inch: 25.4, inches: 25.4, '"': 25.4, ft: 304.8, feet: 304.8, "'": 304.8 };
  return u in f ? clean(v * f[u]) : NaN;
}
