/**
 * Affine transforms (move, rotate, mirror, scale, squash) applied exactly to entities.
 * Circles/arcs stay true circles/arcs under similarity transforms; a non-uniform
 * squash turns a circle into an exact ellipse and an arc into a fine polyline.
 */
import { type Point, P, angOf, normA, polar, clean, cp } from './vec';
import { flatten } from './entity';
import type { Shape } from '../model/types';

/** x' = a·x + b·y + e ;  y' = c·x + d·y + f */
export interface Affine { a: number; b: number; c: number; d: number; e: number; f: number }

export const apA = (A: Affine, p: Point) => P(A.a * p.x + A.b * p.y + A.e, A.c * p.x + A.d * p.y + A.f);
export const affAbout = (o: Point, a: number, b: number, c: number, d: number): Affine => ({ a, b, c, d, e: o.x - (a * o.x + b * o.y), f: o.y - (c * o.x + d * o.y) });
export const affMove = (v: Point): Affine => ({ a: 1, b: 0, c: 0, d: 1, e: v.x, f: v.y });
export const affRot = (o: Point, t: number) => affAbout(o, Math.cos(t), -Math.sin(t), Math.sin(t), Math.cos(t));
export const affMir = (p: Point, q: Point) => { const t = 2 * angOf(p, q); return affAbout(p, Math.cos(t), Math.sin(t), Math.sin(t), -Math.cos(t)); };
export const affScale = (o: Point, sx: number, sy: number) => affAbout(o, sx, 0, 0, sy);

/** 2×2 SVD: M = R(phi)·diag(s1, s2)·R(theta) */
export function svd2(a: number, b: number, c: number, d: number) {
  const E = (a + d) / 2, F = (a - d) / 2, G = (c + b) / 2, H = (c - b) / 2, Q = Math.hypot(E, H), R = Math.hypot(F, G);
  const a1 = Math.atan2(G, F), a2 = Math.atan2(H, E);
  return { s1: Q + R, s2: Q - R, phi: (a2 + a1) / 2 };
}

/** Apply an affine transform to a shape, returning a new shape (same id/attributes). */
export function affEnt<T extends Shape>(e: T, A: Affine): Shape {
  const n: any = structuredClone(e), f = (p: Point) => cp(apA(A, p)), det = A.a * A.d - A.b * A.c;
  const tol = 1e-9 * Math.max(1, Math.abs(A.a), Math.abs(A.b), Math.abs(A.c), Math.abs(A.d));
  const conformal = (Math.abs(A.a - A.d) < tol && Math.abs(A.b + A.c) < tol) || (Math.abs(A.a + A.d) < tol && Math.abs(A.b - A.c) < tol);
  const s = Math.sqrt(Math.abs(det));
  const keep = { id: (e as any).id, layer: (e as any).layer, color: (e as any).color, w: (e as any).w };
  const toEllipse = (c: Point, M: number[]): Shape => {
    const v = svd2(M[0], M[1], M[2], M[3]), rx = Math.abs(v.s1), ry = Math.abs(v.s2);
    if (Math.abs(rx - ry) < 1e-9) return { ...keep, type: 'circle', c: f(c), r: clean(rx) } as Shape;
    return { ...keep, type: 'ellipse', c: f(c), rx: clean(rx), ry: clean(ry), rot: normA(v.phi) } as Shape;
  };
  switch (e.type) {
    case 'line': n.a = f(e.a); n.b = f(e.b); return n;
    case 'poly': n.pts = e.pts.map(f); return n;
    case 'dim': n.p1 = f(e.p1); n.p2 = f(e.p2); n.off = f(e.off); return n;
    case 'circle':
      if (conformal) { n.c = f(e.c); n.r = clean(e.r * s); return n; }
      return toEllipse(e.c, [A.a * e.r, A.b * e.r, A.c * e.r, A.d * e.r]);
    case 'ellipse': {
      const c = Math.cos(e.rot), si = Math.sin(e.rot), m = [c * e.rx, -si * e.ry, si * e.rx, c * e.ry];
      return toEllipse(e.c, [A.a * m[0] + A.b * m[2], A.a * m[1] + A.b * m[3], A.c * m[0] + A.d * m[2], A.c * m[1] + A.d * m[3]]);
    }
    case 'arc':
      if (conformal) {
        const c2 = f(e.c), s0 = apA(A, polar(e.c, e.r, e.a0)), s1 = apA(A, polar(e.c, e.r, e.a1));
        let a0 = normA(angOf(c2, s0)), a1 = normA(angOf(c2, s1)); if (det < 0) [a0, a1] = [a1, a0];
        n.c = c2; n.r = clean(e.r * s); n.a0 = a0; n.a1 = a1; return n;
      }
      return { ...keep, type: 'poly', closed: false, pts: flatten(e).pts.map(f) } as Shape;
  }
  return n;
}
