import { describe, it, expect } from 'vitest';
import { P, type Point } from '../src/geometry/vec';
import { Editor } from '../src/editor/editor';
import { ALL_TOOLS } from '../src/tools';
import { flatten } from '../src/geometry/entity';
import type { Shape } from '../src/model/types';

const near = (s: any, p: Point) => { const f = flatten(s, 0.005), q = f.closed ? [...f.pts, f.pts[0]] : f.pts; let best = Infinity; for (let i = 0; i < q.length - 1; i++) { const a = q[i], b = q[i + 1], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1e-12, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)); best = Math.min(best, Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y)); } return best; };
describe('Soften shapes: pick, choose corners, then soften', () => {
  it('nothing changes on click; Shift adds shapes; a dot switches a corner; Enter softens', () => {
    const ed = new Editor(ALL_TOOLS); ed.view = { k: 4, ox: 0, oy: 0, W: 1600, H: 1200 };
    const a = ed.store.add({ type: 'poly', closed: true, pts: [P(0, 0), P(40, 0), P(40, 40), P(0, 40)] } as Shape);
    const b = ed.store.add({ type: 'poly', closed: true, pts: [P(60, 0), P(100, 0), P(100, 40), P(60, 40)] } as Shape); ed.store.emit();
    ed.setTool('smooth'); ed.opt.smRound = 5;
    const I = (p: Point, shift = false) => ({ sp: ed.w2s(p), shift, alt: false, ctrl: false });
    const click = (p: Point, shift = false) => { ed.pointerMove(p, I(p, shift)); ed.pointerDown(p, 0, I(p, shift)); ed.pointerUp(p, I(p, shift)); };
    click(P(20, 0)); expect(ed.state.sp.ids).toEqual([a.id]); expect((ed.store.byId(a.id) as any).type).toBe('poly');   // picked, not changed
    click(P(80, 0), true); expect(ed.state.sp.ids).toEqual([a.id, b.id]);
    click(P(0, 40));   // the top-left corner's dot of the first square: switch it off
    expect(ed.tool.onKey!(ed, 'Enter', { shift: false, alt: false, ctrl: false })).toBe(true);
    const A = ed.store.byId(a.id)!, B = ed.store.byId(b.id)!;
    expect(A.type).toBe('spline'); expect(near(A, P(0, 40))).toBeLessThan(0.05); expect(near(A, P(40, 0))).toBeGreaterThan(1.5);
    expect(near(B, P(60, 40))).toBeGreaterThan(1.5);
    ed.store.undo(); expect(ed.store.byId(a.id)!.type).toBe('poly'); expect(ed.store.byId(b.id)!.type).toBe('poly');
  });
});
