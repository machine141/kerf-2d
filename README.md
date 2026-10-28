# Kerf 2D

A lightweight, browser-based precision 2D CAD tool for design & technology and laser cutting, modelled on the behaviour of TechSoft 2D Design V3. It is a clean-room implementation: no TechSoft code, icons, help text or drawings are used.

## Commands
```
npm install
npm run dev              # local development server
npm test                 # automated tests (geometry + full workflow self-test)
npm run typecheck        # TypeScript checks
npm run build            # one self-contained, offline HTML file → dist/index.html
npm run build:artifact   # same, packaged for publishing as a page → dist/kerf-artifact.html
```

## Architecture
```
src/
  geometry/   pure maths, no UI — candidate for a Rust/WebAssembly kernel later
    vec.ts        points, angles, number cleaning, unit parsing (2cm, 1in…)
    entity.ts     flattening, primitives, intersections, distances, snap points, bounding boxes
    affine.ts     move / rotate / mirror / scale / squash (exact for circles, arcs, ellipses)
    offset.ts     contour/offset engine (Clipper), chaining touching pieces, single-edge offsets
    region.ts     boundary finder: the enclosed area around a point, even with crossing lines
    trim.ts       Delete Part (whole path or segment by segment)
    dims.ts       dimension geometry
  model/      document types, colours/pages, document store with undo/redo
  snap/       Attach snapping (end, mid, centre, quadrant, intersection, nearest, perpendicular, tangent) + locks
  editor/     Editor (selection, view, input routing, transforms) and the Tool contract
  tools/      one file per tool group; registry in tools/index.ts
  render/     canvas renderer
  io/         SVG and DXF import/export, zip helper
  ui/         browser shell: toolbox, option strips, panels, status bar, files
  selftest.ts accuracy checks run in-app (Accuracy tab) and in `npm test`
tests/        Vitest suites
```

### Adding a tool
Most drawing tools are "locate N points, then make something". For example:
```ts
export const myTool = pointTool({
  id: 'slot', label: 'Slot', key: 'K', icon: '<path d="…"/>', group: 1, need: 2,
  prompts: ['Locate first centre', 'Locate second centre'],
  options: [{ key: 'slotW', label: 'Width', type: 'number', unit: 'mm' }],
  make(ed, [a, b]) { ed.store.change(() => ed.store.add(/* shape */)); },
  preview(ed, [a], cur, o) { o.ghost(/* preview shape */); o.label('…'); },
});
```
Register it in `src/tools/index.ts`. The toolbox button, keyboard shortcut and option strip appear automatically, and snapping, typed coordinates, drag-to-draw, Backspace (remove last point), undo and export all work without extra code.

## Changelog
- **v0.5**: Union / Subtract / Intersect for closed shapes (Clipper for the area maths, then every edge refitted onto its exact source line or arc, so results keep true arcs and exact corners); Add a ring tool (K) for key rings — ring Ø, hole Ø, overlap, snaps to midpoints/corners/N-E-S-W, joined and grouped with its hole; Tidy (remove duplicates and zero-size objects, join pieces within the close-gaps tolerance); exact bounding boxes for curved paths.
- **v0.4.1**: mouse wheel always zooms at the pointer (Shift+wheel pans; optional "two-finger scroll pans" setting); Trim previews what will be removed and never deletes a closed shape whole (needs two crossings); ends of lines/arcs within the close-gaps tolerance count as crossings; Make Path closes gaps up to 0.05 mm (setting), reports larger gaps and marks open ends red.
- **v0.4**: paths with true arcs (bulges) everywhere (draw, trim, transform, SVG/DXF); Fillet / chamfer tool (click a corner or two lines; wheel, cursor or typed size; all corners); Arc tool with 3-point, tangent and centre modes; hover snap points (ends, midpoints, centres, N/E/S/W) and alignment guides; Group / Ungroup (Explode ungroups one level) and Make Path; Bed size selector; F-key labels on toggles.
- **v0.3**: TypeScript framework; boundary finder (Closed contour); tangent/perpendicular/nearest snaps; trim modes; DXF export options; unit entry; 2D Design F-keys.
