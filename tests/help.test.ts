import { describe, it, expect } from 'vitest';
import { GUIDES, helpHtml } from '../src/ui/help';
import { ELEMENTS } from '../src/elements/elements';

const TOOL_IDS = ['select', 'line', 'rect', 'circle', 'arc', 'polygon', 'spline', 'spiral', 'dim', 'offset', 'fillet', 'trim', 'ring', 'eraser', 'move', 'rotate', 'mirror', 'array'];
describe('help guides', () => {
  it('every tool has a guide with numbered steps', () => {
    for (const id of TOOL_IDS) { const g = GUIDES.find(x => x.id === id); expect(g, id).toBeTruthy(); expect(g!.steps.length).toBeGreaterThanOrEqual(2); }
  });
  it('every guide renders, and unknown tools fall back to Getting started', () => {
    const icons = Object.fromEntries(TOOL_IDS.map(id => [id, { icon: '<path d="M0 0"/>', label: id, key: 'X' }]));
    for (const g of GUIDES) { const h = helpHtml('line', g.id, icons); expect(h).toContain(g.title); expect((h.match(/class="hstep"/g) || []).length).toBe(g.steps.length); }
    expect(helpHtml('nope', null, icons)).toContain('Getting started');
  });
  it('element ids are unique', () => { expect(new Set(ELEMENTS.map(e => e.id)).size).toBe(ELEMENTS.length); });
});
