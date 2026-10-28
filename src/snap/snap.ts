/**
 * Snapping ("Attach" in 2D Design) and drawing locks.
 * Priority: perpendicular/tangent (when ticked and within the target) →
 * nearest key point (end/mid/centre/quadrant) or intersection → nearest point →
 * radial lock → grid lock → step lock → free.
 */
import { type Point, P, sub, add, mul, dot, dist, angOf, polar, DEG, cp } from '../geometry/vec';
import { prims, keypoints, intersect, nearestOnPrim, bbox, type Prim, type SnapKind } from '../geometry/entity';
import type { Aids, Entity, Shape } from '../model/types';

export type SnapLabel = SnapKind | 'grid' | 'step' | 'radial' | 'track' | null;
export interface SnapResult { p: Point; k: SnapLabel; guides?: { from: Point; to: Point }[] }
export interface SnapContext {
  ents: Entity[];
  visible: (e: Entity) => boolean;
  aids: Aids;
  /** pixels per mm */
  k: number;
  /** last located point (for radial lock, perpendicular, tangent) */
  last?: Point;
  /** temporary 45° constraint (Shift on the line tool) */
  constrain45?: boolean;
  /** radial/grid/step locks only apply when drawing */
  drawing: boolean;
  exclude?: Set<string>;
  geomPrims?: (e: Entity) => Prim[];
  /** recently touched snap points used for alignment guides */
  track?: Point[];
}

export function snapPoint(raw: Point, c: SnapContext): SnapResult {
  const A = c.aids, at = A.attach;
  if (at.on) {
    const tol = at.box / 2 / c.k;
    let best: { p: Point; k: SnapKind; d: number } | null = null;
    const near: { pr: Prim; id: string }[] = [];
    const consider = (p: Point, k: SnapKind, d = dist(p, raw)) => { if (d <= tol && (!best || d < best.d - 1e-9)) best = { p, k, d }; };
    for (const e of c.ents) {
      if (!c.visible(e) || c.exclude?.has(e.id) || e.type === 'dim') continue;
      const b = bbox(e as Shape);
      if (raw.x < b.x0 - tol || raw.x > b.x1 + tol || raw.y < b.y0 - tol || raw.y > b.y1 + tol) continue;
      for (const kp of keypoints(e as Shape)) if ((at as any)[kp.k]) consider(kp.p, kp.k);
      for (const pr of prims(e as Shape)) if (dist(nearestOnPrim(raw, pr), raw) <= tol) near.push({ pr, id: e.id });
    }
    if (at.inter && near.length < 400) {
      for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
        if (near[i].id === near[j].id) continue;
        for (const x of intersect(near[i].pr, near[j].pr)) {
          const d = dist(x, raw);
          if (d <= tol && (!best || d < (best as any).d - 1e-9 || (best as any).k === 'mid' || (best as any).k === 'quad')) best = { p: x, k: 'inter', d };
        }
      }
    }
    // perpendicular / tangent from the last point override other attaches
    if (c.last && (at.perp || at.tangent)) {
      let over: { p: Point; k: SnapKind; d: number } | null = null;
      for (const { pr } of near) {
        if (at.perp) { const f = perpFoot(c.last, pr); if (f) { const d = dist(f, raw); if (d <= tol * 1.5 && (!over || d < over.d)) over = { p: f, k: 'perp', d }; } }
        if (at.tangent && pr.t === 'arc') for (const t of tangentPoints(c.last, pr)) { const d = dist(t, raw); if (d <= tol * 1.5 && (!over || d < over.d)) over = { p: t, k: 'tangent', d }; }
      }
      if (over) return { p: cp(over.p), k: over.k };
    }
    if (best) return { p: cp((best as any).p), k: (best as any).k };
    const tr = trackSnap(raw, c, tol); if (tr) return tr;
    if (at.nearest && near.length) {
      let nb: Point | null = null, nd = Infinity;
      for (const { pr } of near) { const q = nearestOnPrim(raw, pr), d = dist(q, raw); if (d < nd) { nd = d; nb = q; } }
      if (nb) return { p: nb, k: 'nearest' };
    }
  }
  if (c.drawing && c.last && (A.radial.on || c.constrain45)) {
    const st = (c.constrain45 ? 45 : A.radial.step) * DEG, s0 = c.constrain45 ? 0 : A.radial.start * DEG, a = angOf(c.last, raw);
    const sa = s0 + Math.round((a - s0) / st) * st; let r = dist(c.last, raw) * Math.cos(a - sa);
    if (A.gridLock || A.stepLock) r = Math.round(r / A.step) * A.step;
    return { p: cp(polar(c.last, r, sa)), k: 'radial' };
  }
  if (A.gridLock) { const g = A.grid.spacing; return { p: cp(P(Math.round(raw.x / g) * g, Math.round(raw.y / g) * g)), k: 'grid' }; }
  if (A.stepLock) { const g = A.step; return { p: cp(P(Math.round(raw.x / g) * g, Math.round(raw.y / g) * g)), k: 'step' }; }
  return { p: raw, k: null };
}

/**
 * Alignment guides: if the cursor lines up horizontally or vertically with a
 * recently touched snap point, lock to that line (or to the crossing of two).
 */
function trackSnap(raw: Point, c: SnapContext, tol: number): SnapResult | null {
  if (!c.aids.track || !c.drawing || !c.track?.length) return null;
  let bx: { t: Point; d: number } | null = null, by: { t: Point; d: number } | null = null;
  for (const t of c.track) {
    const dx = Math.abs(raw.x - t.x), dy = Math.abs(raw.y - t.y);
    if (dx <= tol && (!bx || dx < bx.d)) bx = { t, d: dx };
    if (dy <= tol && (!by || dy < by.d)) by = { t, d: dy };
  }
  if (!bx && !by) return null;
  const g = c.aids.gridLock ? c.aids.grid.spacing : c.aids.stepLock ? c.aids.step : 0, rnd = (v: number) => g ? Math.round(v / g) * g : v;
  if (bx && by && bx.t !== by.t) { const p = cp(P(bx.t.x, by.t.y)); return { p, k: 'track', guides: [{ from: bx.t, to: p }, { from: by.t, to: p }] }; }
  if (bx && (!by || bx.d <= by.d)) { const p = cp(P(bx.t.x, rnd(raw.y))); return { p, k: 'track', guides: [{ from: bx.t, to: p }] }; }
  const p = cp(P(rnd(raw.x), by!.t.y)); return { p, k: 'track', guides: [{ from: by!.t, to: p }] };
}

/** Foot of the perpendicular from p onto a primitive (if it lands on it). */
export function perpFoot(p: Point, pr: Prim): Point | null {
  if (pr.t === 'seg') { const d = sub(pr.b, pr.a), L = dot(d, d); if (!L) return null; const t = dot(sub(p, pr.a), d) / L; if (t < -1e-9 || t > 1 + 1e-9) return null; return add(pr.a, mul(d, t)); }
  if (dist(p, pr.c) < 1e-12) return null;
  const q = polar(pr.c, pr.r, angOf(pr.c, p)); return pr.full || nearestOnPrim(q, pr) === q || dist(nearestOnPrim(q, pr), q) < 1e-9 ? q : null;
}
/** Tangent points on a circle/arc from an outside point. */
export function tangentPoints(p: Point, pr: Extract<Prim, { t: 'arc' }>): Point[] {
  const d = dist(p, pr.c); if (d <= pr.r + 1e-12) return [];
  const base = angOf(pr.c, p), off = Math.acos(pr.r / d);
  return [polar(pr.c, pr.r, base + off), polar(pr.c, pr.r, base - off)].filter(q => dist(nearestOnPrim(q, pr), q) < 1e-9);
}
