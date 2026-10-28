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
- **v0.8.1**: Right-click freezes the preview of any click-click tool (rectangle, circle, polygon, spiral, arc, dimension, mirror, rotate…) after its first point, so options can be changed with the shape staying put; click anywhere or Enter places it, right-click again or Esc unfreezes. A padlock marks the frozen point.
- **v0.8**: Box maker (Make ▾ → Box maker…): finger-jointed box from inside or outside sizes, material thickness, finger width (odd whole number per edge), laser kerf compensation (parts grown by (kerf − clearance)/2), fit (press / normal / loose), lid or open top, layout as a net or packed rows (parts turned onto their long side, tallest first), live preview with sizes and sheet warning; placed as one group. Spiral: Start from Centre or Outer end (snap onto another spiral's end to join them). Make ▾ menu groups Box maker, Elements and Trace image.
- **v0.7.1**: Spiral tool (J): Even (Archimedean, constant gap) or Growing (logarithmic) coils, turns (wheel after the first click), inner radius, direction; built as editable Bézier curves from exact tangents.
- **v0.7**: Spline tool (B) — smooth curves through clicked points stored as exact Béziers; edit points and handles (smooth by default, Alt = sharp corner, + adds a point keeping the shape, Delete removes), SVG export as true curves, DXF as fine polylines, Convert to path. Polygon / star tool (N) — sides, size to corner or flat side, 15° turn steps (Shift free), star with inner %. Closing snap: Line and Spline pull onto the first point (green ring) and close the shape. Elements window — 24 original outline designs (heart, star, flower, daisy, rainbow, cloud, bow tie, fire, lightning, leaf, moon, raindrop, paw, house, tree, fish, butterfly, crown, music note, apple, speech bubble, arrow, gem, hexagon) placed at a chosen size, plus a link to Openclipart (public domain). Array: "Gaps shrink too" and "Fill the same length / circle" for shrinking patterns. Two-column toolbox.
- **v0.6.5**: Align (left / centre / right / top / middle / bottom) to the selection or the sheet, and Space evenly across / up-down — groups move as one; smart alignment while dragging (edges and centres snap to other shapes and the sheet with pink guide lines; Alt = off). Array: first click fixes the spacing / centre so you can change numbers in the options strip with the preview staying, then click / Enter / Place; circular pattern goes round the centre of a circle you point at; grid and circular keep separate size-change and symmetry settings; pattern type change resets the fixed point.
- **v0.6.4**: Array / pattern tool (P): grid (columns × rows, spacing typed or set by cursor, snapped to the step) and circular (copies, angle, turn copies) with size change per copy (%) and 2-way / 4-way symmetry (mirrored copies). Mirror: axis turns in angle steps (15° default, absolute angles), Shift = free; object snaps used exactly; "Keep original" now off by default. Mouse wheel nudges any focused number box (Shift finer, Alt coarser). Setup: "Reset all settings to defaults" (drawing unchanged).
- **v0.6.3**: Trace: Erase / Fill brush (Fill paints solid shape to close holes and gaps; in Colours it paints the colour where the stroke starts), "Outer outline only (fill holes)", choice of preview line colour with a white halo; Colours mode traces one shared network so a boundary between two colours is a single line (no doubled lines) and colour specks are merged away. Drawing: Click reach setting (default 14 px, nearest line wins) for trim, fillet, contour, dimension and select.
- **v0.6.2**: Trace window: Undo / Redo (buttons and Ctrl/Cmd+Z/Y, covering settings, kept colours and erasing), Reset to starting settings, every new picture starts from the default settings, plain-English reason when nothing is found (e.g. specks setting larger than every piece, threshold, all colours dropped, all erased), width limited to ≥ 5 mm, "N colours found".
- **v0.6.1**: Pictures now open in the hosted version: decoded with createImageBitmap (no blob: URL, which the host's security policy blocks), falling back to data:/blob: URLs; drop a picture anywhere on the window (dashed outline shows the drop target); paste a picture with Ctrl/Cmd+V; clearer messages (HEIC photos must be saved as JPEG/PNG).
- **v0.6**: Trace image (button, Open… or drop a picture): Silhouette (auto/manual threshold, light-on-dark, fill holes) or Colours (k-means, click swatches to drop/keep, border colours dropped as background, optional join into one silhouette); noise clean-up, even out graduated backgrounds, ignore specks under N mm, detail and smoothness sliders with live outline/point count, exact width in mm; eraser brush on the picture (Alt-drag restores, wheel = size). Eraser tool (X) in the drawing: drag to delete pieces the brush touches, only small pieces by default. Own clean-room tracer (pixel-edge loops → Chaikin → Douglas–Peucker), no external tracing library.
- **v0.5.3**: Radius and Diameter dimensions (click a circle, arc or rounded corner, place the label: "R6 mm" / "Ø12 mm"; DXF writes %%c); dimension units (mm / inches / none) and their own colour (grey by default, Setup → Dimensions); dimensions left out of SVG/DXF unless "Include dimensions" is ticked; new drawings draw in black; Nearest snap on by default; keyboard shortcuts flash their button (tools, Undo/Redo, F-key toggles, Save, Fit) and Undo/Redo show a toast.
- **v0.5.2**: Contours are now exact lines and arcs (Clipper result refitted onto the true offset curves — parallel lines, concentric arcs, round-corner arcs, square caps), so they trim, fillet and export like hand-drawn geometry instead of thousands of tiny segments. Contours of a circle are circles.
- **v0.5.1**: Fillet works next to arcs (a line running onto a bump), on separate line/arc pairs, and on existing fillets (hover/click a fillet, or click the two edges either side, to resize it — also for two-line fillets); Properties panel shows actions first, point coordinates fold away, sizes shown to 2 decimals by default (Setup → Decimals shown; exact value on hover).
- **v0.5**: Union / Subtract / Intersect for closed shapes (Clipper for the area maths, then every edge refitted onto its exact source line or arc, so results keep true arcs and exact corners); Add a ring tool (K) for key rings — ring Ø, hole Ø, overlap, snaps to midpoints/corners/N-E-S-W, joined and grouped with its hole; Tidy (remove duplicates and zero-size objects, join pieces within the close-gaps tolerance); exact bounding boxes for curved paths.
- **v0.4.1**: mouse wheel always zooms at the pointer (Shift+wheel pans; optional "two-finger scroll pans" setting); Trim previews what will be removed and never deletes a closed shape whole (needs two crossings); ends of lines/arcs within the close-gaps tolerance count as crossings; Make Path closes gaps up to 0.05 mm (setting), reports larger gaps and marks open ends red.
- **v0.4**: paths with true arcs (bulges) everywhere (draw, trim, transform, SVG/DXF); Fillet / chamfer tool (click a corner or two lines; wheel, cursor or typed size; all corners); Arc tool with 3-point, tangent and centre modes; hover snap points (ends, midpoints, centres, N/E/S/W) and alignment guides; Group / Ungroup (Explode ungroups one level) and Make Path; Bed size selector; F-key labels on toggles.
- **v0.3**: TypeScript framework; boundary finder (Closed contour); tangent/perpendicular/nearest snaps; trim modes; DXF export options; unit entry; 2D Design F-keys.
