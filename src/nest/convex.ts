/**
 * Fast no-fit polygons: split outlines into convex pieces once, then
 *   A ⊕ B = ∪ (Aᵢ ⊕ Bⱼ)   and for convex pieces  Aᵢ ⊕ Bⱼ = hull of all vertex sums.
 * A few dozen small hulls to union instead of n × m quads.
 * Integer coordinates (µm) throughout, as Clipper uses.
 */
import ClipperLib from 'clipper-lib';

const L = ClipperLib;
type V = { X: number; Y: number }; type IP = V[];
const cross = (o: V, a: V, b: V) => (a.X - o.X) * (b.Y - o.Y) - (a.Y - o.Y) * (b.X - o.X);

/** Triangulate a simple counter-clockwise ring by ear clipping (indices). null if it gets stuck. */
function triangulate(p: IP): number[][] | null {
  const idx = p.map((_, i) => i), tris: number[][] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let cut = -1;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      const a = p[i0], b = p[i1], c = p[i2], cr = cross(a, b, c);
      if (cr < 0) continue;                                   // reflex
      if (cr === 0) { cut = k; break; }                        // collinear: just drop the middle point
      let inside = false;
      for (const j of idx) { if (j === i0 || j === i1 || j === i2) continue; const q = p[j]; if (cross(a, b, q) >= 0 && cross(b, c, q) >= 0 && cross(c, a, q) >= 0) { inside = true; break; } }
      if (!inside) { cut = k; break; }
    }
    if (cut < 0) return null;
    const i0 = idx[(cut + idx.length - 1) % idx.length], i1 = idx[cut], i2 = idx[(cut + 1) % idx.length];
    if (cross(p[i0], p[i1], p[i2]) !== 0) tris.push([i0, i1, i2]);
    idx.splice(cut, 1);
  }
  if (idx.length === 3 && cross(p[idx[0]], p[idx[1]], p[idx[2]]) > 0) tris.push(idx.slice());
  return tris;
}
const convexRing = (p: IP, r: number[]) => { for (let k = 0; k < r.length; k++) if (cross(p[r[k]], p[r[(k + 1) % r.length]], p[r[(k + 2) % r.length]]) < 0) return false; return true; };
/** Join triangles across shared edges while the result stays convex (Hertel–Mehlhorn style). */
function mergeConvex(p: IP, tris: number[][]): number[][] {
  const pieces = tris.map(t => t.slice());
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let a = 0; a < pieces.length; a++) for (let b = a + 1; b < pieces.length; b++) {
      const A = pieces[a], B = pieces[b];
      for (let i = 0; i < A.length; i++) {
        const u = A[i], v = A[(i + 1) % A.length], j = B.indexOf(v);
        if (j < 0 || B[(j + 1) % B.length] !== u) continue;   // shared edge u→v in A is v→u in B
        // A with B spliced in between u and v
        const m: number[] = [];
        for (let k = 0; k <= i; k++) m.push(A[k]);
        for (let k = 2; k < B.length; k++) m.push(B[(j + k) % B.length]);
        for (let k = i + 1; k < A.length; k++) m.push(A[k]);
        if (convexRing(p, m)) { pieces[a] = m; pieces.splice(b, 1); changed = true; break outer; }
      }
    }
  }
  return pieces;
}
/** Convex pieces covering a ring exactly (counter-clockwise rings in, counter-clockwise pieces out). */
export function convexPieces(ring: IP): IP[] | null {
  const p = L.Clipper.Orientation(ring) ? ring : ring.slice().reverse();
  if (p.length < 3) return [];
  if (convexRing(p, p.map((_, i) => i))) return [p];
  const t = triangulate(p); if (!t) return null;
  return mergeConvex(p, t).map(r => r.map(i => p[i]));
}
/** Convex hull (monotone chain), counter-clockwise. */
function hull(pts: V[]): IP {
  const s = pts.slice().sort((a, b) => a.X - b.X || a.Y - b.Y); if (s.length < 3) return s;
  const lo: V[] = [], hi: V[] = [];
  for (const q of s) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = s.length - 1; i >= 0; i--) { const q = s[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  lo.pop(); hi.pop(); return lo.concat(hi);
}
/** Minkowski sum of two sets of convex pieces, unioned. */
export function sumPieces(A: IP[], B: IP[]): IP[] {
  const c = new L.Clipper();
  for (const a of A) for (const b of B) {
    const pts: V[] = []; for (const u of a) for (const v of b) pts.push({ X: u.X + v.X, Y: u.Y + v.Y });
    const h = hull(pts); if (h.length > 2) c.AddPath(h, L.PolyType.ptSubject, true);
  }
  const out = new L.Paths(); c.Execute(L.ClipType.ctUnion, out, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero); return out as IP[];
}
