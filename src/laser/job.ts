/**
 * The job as it goes on the bed: the sheet's drawing, turned in quarter turns and repeated as copies,
 * moved so its laser paths start at (0, 0). Cut order, preview, time and the LightBurn file all use this.
 */
import { P, type Point } from '../geometry/vec';
import { affEnt, affMove, affRot } from '../geometry/affine';
import type { Doc, Entity, Shape } from '../model/types';
import { laserPaths } from './order';

export interface JobOpts { /** quarter turns clockwise, as seen on the bed */ turns: number; copies: number; gap: number; /** most copies side by side before starting a new row */ cols: number }

/** Box round the laser paths of a drawing (drawing coords, y up). */
export function laserBox(doc: Doc, fills = false) {
  const pts = laserPaths(doc, { fills }).flatMap(p => p.pts);
  if (!pts.length) return null;
  return pts.reduce((b, p) => ({ x0: Math.min(b.x0, p.x), y0: Math.min(b.y0, p.y), x1: Math.max(b.x1, p.x), y1: Math.max(b.y1, p.y) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
}

/** How many copies fit side by side, starting `x` mm from the left of a bed `bedW` wide. */
export const colsThatFit = (bedW: number, x: number, w: number, gap: number) => Math.max(1, Math.floor((bedW - x + gap) / (w + gap) + 1e-9));

/** The job drawing: turned, copied, and moved so its paths fill (0, 0)–(W, H). */
export function buildJob(base: Doc, o: JobOpts): { doc: Doc; W: number; H: number; one: { w: number; h: number }; rows: number; cols: number } {
  const b = laserBox(base);
  if (!b) return { doc: { ...base, ents: [], page: { ...base.page, w: 1, h: 1 } }, W: 0, H: 0, one: { w: 0, h: 0 }, rows: 0, cols: 0 };
  const t = ((Math.round(o.turns) % 4) + 4) % 4, c = P((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
  // clockwise on the bed (y down) = clockwise on the drawing (y up) = a negative angle
  const R = affRot(c, -t * Math.PI / 2);
  const w0 = b.x1 - b.x0, h0 = b.y1 - b.y0, w = t % 2 ? h0 : w0, h = t % 2 ? w0 : h0;
  const n = Math.max(1, Math.min(200, Math.round(o.copies))), cols = Math.max(1, Math.min(n, o.cols)), rows = Math.ceil(n / cols);
  const H = rows * h + (rows - 1) * o.gap, W = Math.min(n, cols) * w + (Math.min(n, cols) - 1) * o.gap;
  const ents: Entity[] = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    // copies go right, then the next row goes towards the front (down the bed = down the drawing)
    const dx = -(c.x - w / 2) + col * (w + o.gap), dy = H - (c.y + h / 2) - row * (h + o.gap);
    for (const e of base.ents) {
      const s = t ? affEnt(e as Shape, R) : (e as Shape);
      const m = affEnt(s, affMove(P(dx, dy))) as any;
      ents.push({ ...m, id: n > 1 ? `${e.id}#${i}` : e.id, layer: e.layer, color: e.color, w: e.w });
    }
  }
  return { doc: { ...base, ents, page: { ...base.page, w: W, h: H } }, W, H, one: { w, h }, rows, cols };
}

/** A rough outline of what a job cut, for the "already cut" trace: closed cut shapes as point lists (bed coords), thinned to about 0.5 mm. */
export function thin(pts: Point[], step = 0.5): Point[] {
  if (pts.length < 3) return pts.slice();
  const out = [pts[0]]; for (const p of pts) { const l = out[out.length - 1]; if (Math.hypot(p.x - l.x, p.y - l.y) >= step) out.push(p); }
  return out;
}
