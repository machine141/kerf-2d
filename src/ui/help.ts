/**
 * Help tab: short, picture-led "how to use it" guides for every tool, written
 * for 11–16 year olds. Each guide is a few numbered steps; each step has a small
 * drawing (mouse button lit up, numbered clicks, dashed preview = what will be made).
 */

// ---------- tiny drawing kit (viewBox 0 0 200 100) ----------
const A = 'var(--accent)', INK = 'var(--ink, currentColor)', MUTED = 'var(--muted)', RED = 'var(--c-red, #e03131)';
/** numbered click point */
const pt = (x: number, y: number, n?: number | string) => `<circle cx="${x}" cy="${y}" r="3.2" fill="${A}"/>` + (n != null ? `<g><circle cx="${x + 8}" cy="${y - 8}" r="6" fill="${A}"/><text x="${x + 8}" y="${y - 5.6}" font-size="8" font-weight="700" fill="#fff" text-anchor="middle">${n}</text></g>` : '');
/** mouse with a button lit: L, R, W (wheel), or none */
const mouse = (x: number, y: number, b: 'L' | 'R' | 'W' | '' = 'L') => `<g transform="translate(${x} ${y})"><rect x="-9" y="-13" width="18" height="26" rx="9" fill="var(--sheet,#fff)" stroke="${INK}" stroke-width="1.2"/>`
  + (b === 'L' ? `<path d="M-9 -4V-4A9 9 0 0 1 0 -13V-4Z" fill="${A}"/>` : '') + (b === 'R' ? `<path d="M0 -13A9 9 0 0 1 9 -4H0Z" fill="${A}"/>` : '')
  + `<path d="M-9 -4H9M0 -13V-4" stroke="${INK}" stroke-width="1"/>` + (b === 'W' ? `<rect x="-1.8" y="-10" width="3.6" height="6" rx="1.5" fill="${A}"/><path d="M13 -10l3 -4 3 4M13 2l3 4 3 -4" stroke="${A}" fill="none" stroke-width="1.4"/>` : '')
  + (b === 'L' ? `<text x="0" y="24" font-size="7" text-anchor="middle" fill="${MUTED}">left</text>` : b === 'R' ? `<text x="0" y="24" font-size="7" text-anchor="middle" fill="${MUTED}">right</text>` : b === 'W' ? `<text x="0" y="24" font-size="7" text-anchor="middle" fill="${MUTED}">wheel</text>` : '') + '</g>';
/** pointer arrow (tip at x,y) */
const cur = (x: number, y: number) => `<path d="M${x} ${y}l0 13 3.4 -3.2 2.6 5.6 2.4 -1.1 -2.6 -5.5 4.7 -.3z" fill="#fff" stroke="#000" stroke-width=".9" stroke-linejoin="round"/>`;
const solid = (d: string, fill = false) => `<path d="${d}" fill="${fill ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'none'}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`;
const dash = (d: string) => `<path d="${d}" fill="none" stroke="${A}" stroke-width="1.4" stroke-dasharray="4 3" stroke-linejoin="round"/>`;
const red = (d: string) => `<path d="${d}" fill="none" stroke="${RED}" stroke-width="2.4" stroke-linecap="round"/>`;
const arrow = (x1: number, y1: number, x2: number, y2: number, c = MUTED) => { const a = Math.atan2(y2 - y1, x2 - x1), h = 5; return `<path d="M${x1} ${y1}L${x2} ${y2}M${x2 - h * Math.cos(a - 0.5)} ${y2 - h * Math.sin(a - 0.5)}L${x2} ${y2}L${x2 - h * Math.cos(a + 0.5)} ${y2 - h * Math.sin(a + 0.5)}" stroke="${c}" stroke-width="1.3" fill="none" stroke-linecap="round"/>`; };
const lock = (x: number, y: number) => `<g transform="translate(${x} ${y})" stroke="${A}" stroke-width="1.8" fill="none"><rect x="-6" y="-3" width="12" height="10" rx="1.5" fill="var(--sheet,#fff)"/><path d="M-3.5 -3V-6A3.5 3.5 0 0 1 3.5 -6V-3"/></g>`;
const key = (x: number, y: number, t: string) => { const w = Math.max(16, t.length * 5.4 + 8); return `<g><rect x="${x}" y="${y - 9}" width="${w}" height="14" rx="3" fill="var(--sheet,#fff)" stroke="${INK}" stroke-width="1"/><text x="${x + w / 2}" y="${y + 1}" font-size="8" text-anchor="middle" fill="${INK}" font-family="var(--f-mono,monospace)">${t}</text></g>`; };
const txt = (x: number, y: number, t: string, c = MUTED, anchor = 'middle') => `<text x="${x}" y="${y}" font-size="8" fill="${c}" text-anchor="${anchor}">${t}</text>`;
/** a mini option bar at the top of a picture */
const bar = (items: string) => `<rect x="4" y="3" width="192" height="15" rx="3" fill="color-mix(in srgb, var(--accent) 8%, transparent)" stroke="${MUTED}" stroke-width=".6"/><text x="10" y="13.5" font-size="7.5" fill="${INK}">${items}</text>`;
const barPic = (items: string) => `<svg viewBox="0 0 200 21" role="img" aria-hidden="true">${bar(items)}</svg>`;
const pic = (body: string) => `<svg viewBox="0 0 200 100" role="img" aria-hidden="true">${body}</svg>`;
const hexPts = (cx: number, cy: number, r: number, n = 6, a0 = 0) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos(a0 + i * 2 * Math.PI / n), cy + r * Math.sin(a0 + i * 2 * Math.PI / n)]);
const polyD = (p: number[][], close = true) => 'M' + p.map(q => q.map(v => +v.toFixed(1)).join(' ')).join('L') + (close ? 'Z' : '');

export interface HelpStep { t: string; svg?: string }
export interface HelpGuide { id: string; title: string; intro: string; steps: HelpStep[]; tip?: string; needsSel?: boolean }

const LOCK_STEPS: HelpStep[] = [
  { t: '<b>Freeze it:</b> after your first click, <b>right-click</b>. A padlock appears and the shape stops following the mouse.', svg: pic(dash(polyD(hexPts(70, 55, 28))) + pt(70, 55) + lock(98, 55) + mouse(160, 50, 'R')) },
  { t: '<b>Move it:</b> hold the <b>left</b> button on the page and drag. It snaps to the grid and to points.', svg: pic(dash(polyD(hexPts(55, 55, 22))) + solid(polyD(hexPts(125, 55, 22))) + arrow(70, 55, 105, 55, A) + lock(147, 55) + mouse(180, 50, 'L')) },
  { t: '<b>Change it:</b> type new numbers in the bar at the top (or click in a box and use the mouse wheel). The shape stays where it is.', svg: pic(bar('Sides  [ 8 ]      Star ☐') + dash(polyD(hexPts(80, 62, 26, 8))) + lock(110, 62) + mouse(165, 60, 'W')) },
  { t: '<b>Place it:</b> a plain left-click (or Enter). <b>Right-click</b> again to unfreeze, <b>Esc</b> to cancel.', svg: pic(solid(polyD(hexPts(70, 55, 26, 8)), true) + mouse(140, 50, 'L') + key(160, 82, 'Enter')) },
];

export const GUIDES: HelpGuide[] = [
  { id: 'start', title: 'Getting started', intro: 'Kerf 2D draws exact shapes for the laser cutter. Every size is in millimetres.', steps: [
    { t: 'Pick a tool from the buttons on the <b>left</b>. Each one has a letter key too (L = line, R = rectangle…).', svg: pic(`<rect x="10" y="12" width="22" height="22" rx="4" fill="color-mix(in srgb, var(--accent) 20%, transparent)" stroke="${A}"/><rect x="36" y="12" width="22" height="22" rx="4" fill="none" stroke="${MUTED}"/><rect x="10" y="38" width="22" height="22" rx="4" fill="none" stroke="${MUTED}"/><rect x="36" y="38" width="22" height="22" rx="4" fill="none" stroke="${MUTED}"/>` + solid('M15 28L27 18') + solid('M41 18h12v10h-12z') + cur(24, 22) + arrow(70, 30, 110, 30) + key(120, 34, 'L') + txt(150, 34, 'or', MUTED) + key(160, 34, 'R')) },
    { t: 'Read the <b>message at the bottom left</b>. It always tells you what to click next.', svg: pic(`<rect x="4" y="70" width="192" height="20" rx="3" fill="color-mix(in srgb, var(--accent) 10%, transparent)" stroke="${A}"/>` + txt(10, 83, 'Locate next point · right-click to finish', INK, 'start') + arrow(100, 40, 100, 66, A)) },
    { t: 'Made a mistake? <b>Undo</b> (Ctrl+Z). Want to stop what you are doing? Press <b>Esc</b>.', svg: pic(key(30, 50, 'Ctrl') + txt(70, 51, '+', INK) + key(78, 50, 'Z') + txt(110, 51, 'undo', MUTED) + key(140, 50, 'Esc') + txt(140, 70, 'stop', MUTED, 'start')) },
    { t: 'Change a shape after drawing it: pick <b>Select</b> (V), click the shape and type its exact size in <b>Properties</b>.' },
  ] },
  { id: 'lock', title: 'Freeze, move and change a shape', intro: 'Works with rectangle, circle, polygon, spiral, arc, mirror, rotate and dimensions. Great when the shape keeps running away from you while you change the settings.', steps: LOCK_STEPS },
  { id: 'view', title: 'Moving around the page', intro: 'Zoom in for detail, zoom out to see everything.', steps: [
    { t: '<b>Zoom</b> with the mouse wheel. It zooms in towards wherever the pointer is.', svg: pic(solid('M40 70h40v-30h-40z') + solid('M120 85h70v-60h-70z') + arrow(85, 55, 115, 55) + mouse(100, 25, 'W')) },
    { t: '<b>Slide the page</b>: hold Shift and use the wheel, or hold the middle button (or Space) and drag.', svg: pic(key(20, 50, 'Shift') + txt(60, 51, '+', INK) + mouse(80, 45, 'W') + txt(120, 51, 'or', MUTED) + key(140, 50, 'Space') + txt(140, 70, '+ drag', MUTED, 'start')) },
    { t: 'Lost? Press <b>Fit page</b> (or F) to see the whole sheet again.', svg: pic(key(80, 50, 'F')) },
  ] },
  { id: 'select', title: 'Select', intro: 'Pick shapes so you can move, resize, copy or delete them.', steps: [
    { t: '<b>Click</b> a shape to select it. Square handles appear round it.', svg: pic(solid('M50 30h60v40h-60z') + dash('M44 24h72v52h-72z') + [[44, 24], [116, 24], [44, 76], [116, 76], [80, 24], [80, 76]].map(([x, y]) => `<rect x="${x - 3}" y="${y - 3}" width="6" height="6" fill="#fff" stroke="${A}"/>`).join('') + cur(84, 46) + mouse(165, 50, 'L')) },
    { t: '<b>Lots at once</b>: drag a box round them, or hold Shift and click each one.', svg: pic(solid('M30 40h25v25h-25z') + solid(`M${polyD(hexPts(100, 52, 14)).slice(1)}`) + `<circle cx="145" cy="52" r="12" fill="none" stroke="${INK}" stroke-width="1.6"/>` + dash('M20 28h145v50h-145z') + cur(165, 78)) },
    { t: '<b>Resize</b>: drag a corner handle (or type width and height in Properties). <b>Move</b>: drag the shape itself.', svg: pic(solid('M40 40h50v30h-50z') + dash('M40 30h80v40h-80z') + arrow(92, 40, 118, 32, A) + `<rect x="117" y="27" width="6" height="6" fill="#fff" stroke="${A}"/>` + cur(121, 31)) },
    { t: '<b>Double-click</b> a shape to edit its points. Drag a point, or click + to add one. <b>Delete</b> removes what is selected.', svg: pic(solid('M30 70L70 30L120 60L160 35') + [[30, 70], [70, 30], [120, 60], [160, 35]].map(([x, y]) => `<rect x="${x - 3.5}" y="${y - 3.5}" width="7" height="7" fill="#fff" stroke="${A}"/>`).join('') + cur(70, 30) + key(150, 85, 'Delete')) },
  ] },
  { id: 'line', title: 'Line', intro: 'Straight lines joined end to end. Use it for outlines with corners.', steps: [
    { t: '<b>Click</b> where the line starts, then click at each corner.', svg: pic(solid('M25 75L75 30L130 70') + pt(25, 75, 1) + pt(75, 30, 2) + pt(130, 70, 3) + mouse(178, 50, 'L')) },
    { t: 'The dashed line that follows your mouse is the <b>"tail"</b>. It is the next line, not drawn yet.', svg: pic(solid('M25 75L75 30L130 70') + dash('M130 70L170 35') + cur(170, 35) + txt(150, 92, 'the tail', A)) },
    { t: '<b>To finish and get rid of the tail</b>: right-click (or press Enter, or double-click).', svg: pic(solid('M20 75L65 30L115 70') + red('M115 70L150 38') + txt(150, 30, '✕', RED) + mouse(178, 50, 'R') + key(130, 92, 'Enter')) },
    { t: '<b>Close the shape</b>: go back to the first point. It snaps on and finishes for you (or press C).', svg: pic(solid('M40 80L90 25L150 80Z', true) + pt(40, 80, 1) + `<circle cx="40" cy="80" r="8" fill="none" stroke="${A}" stroke-width="1.5"/>` + cur(41, 81) + key(170, 50, 'C')) },
  ], tip: 'Hold Shift to keep lines straight (steps of 45°). Type a number to give an exact length.' },
  { id: 'rect', title: 'Rectangle', intro: 'Boxes and tags. Exact sizes are easy.', steps: [
    { t: '<b>Click</b> one corner, then <b>click</b> the opposite corner (or press, drag and let go).', svg: pic(dash('M40 25h90v55h-90z') + pt(40, 25, 1) + pt(130, 80, 2) + mouse(175, 50, 'L')) },
    { t: 'Hold <b>Shift</b> for a perfect square. Hold <b>Alt</b> to draw out from the middle.', svg: pic(dash('M40 25h55v55h-55z') + key(120, 45, 'Shift') + txt(160, 46, 'square', MUTED, 'start')) },
    { t: '<b>Exact size</b>: after the first click, type the width and height in the boxes at the bottom (Rel) and press Enter.', svg: pic(`<rect x="10" y="65" width="180" height="22" rx="3" fill="none" stroke="${MUTED}" stroke-width=".7"/>` + key(16, 80, 'Rel') + key(50, 80, ' 60 ') + key(90, 80, ' 30 ') + key(140, 80, 'Enter') + solid('M60 15h60v30h-60z') + txt(90, 57, '60 × 30 mm', A)) },
  ] },
  { id: 'circle', title: 'Circle / ellipse', intro: 'Round holes, wheels, eyes… or ovals.', steps: [
    { t: '<b>Click</b> the centre.', svg: pic(pt(80, 52, 1) + mouse(170, 50, 'L')) },
    { t: 'Move out and <b>click</b> again. That sets the size. You can type an exact radius too.', svg: pic(`<circle cx="80" cy="52" r="32" fill="none" stroke="${A}" stroke-width="1.4" stroke-dasharray="4 3"/>` + pt(80, 52, 1) + pt(112, 52, 2) + txt(96, 47, 'R', A)) },
    { t: 'For an <b>oval</b>, choose <b>In a box</b> at the top, then drag out a box.', svg: pic(bar('Draw  [From centre] [In a box]') + `<ellipse cx="90" cy="60" rx="55" ry="25" fill="none" stroke="${A}" stroke-dasharray="4 3" stroke-width="1.4"/>` + dash('M35 35h110v50h-110z')) },
  ] },
  { id: 'arc', title: 'Arc', intro: 'A part of a circle. Pick how you want to draw it in the bar at the top.', steps: [
    { t: 'Choose the arc type at the top (for example <b>3 points</b>).', svg: barPic('Arc  [3 points] [Tangent] [Centre, start, end]') },
    { t: '3 points: click the <b>start</b>, a point the arc goes <b>through</b>, then the <b>end</b>.', svg: pic(dash('M30 80A55 55 0 0 1 140 80') + pt(30, 80, 1) + pt(85, 26, 2) + pt(140, 80, 3)) },
  ], tip: 'Right-click after the first click to freeze it while you change the options.' },
  { id: 'polygon', title: 'Polygon / star', intro: 'Triangles, hexagons, stars, any number of sides.', steps: [
    { t: 'Set the number of <b>sides</b> at the top. Tick <b>Star</b> for a star.', svg: pic(bar('Sides  [ 6 ]   Star ☐') + dash(polyD(hexPts(100, 62, 28)))) },
    { t: '<b>Click</b> the centre, then move out and <b>click</b> a corner.', svg: pic(dash(polyD(hexPts(80, 52, 32))) + pt(80, 52, 1) + pt(112, 52, 2) + mouse(170, 50, 'L')) },
    { t: 'Want to change the sides without it moving? <b>Right-click</b> to freeze it first.', svg: pic(dash(polyD(hexPts(80, 52, 32, 5, -Math.PI / 2))) + lock(118, 52) + mouse(170, 50, 'R')) },
  ], tip: 'It turns in 15° steps. Hold Shift to turn it freely.' },
  { id: 'spline', title: 'Spline (smooth curve)', intro: 'Flowing curves: leaves, waves, letters.', steps: [
    { t: '<b>Click</b> points along your curve. The line bends smoothly through them.', svg: pic(solid('M20 70C45 15 70 15 90 50S140 90 175 30') + pt(20, 70, 1) + pt(90, 50, 2) + pt(175, 30, 3)) },
    { t: '<b>Finish</b> with a right-click (or Enter). To make a closed shape, click back on the first point.', svg: pic(solid('M40 60C40 20 140 20 140 55S60 95 40 60Z', true) + pt(40, 60, 1) + `<circle cx="40" cy="60" r="8" fill="none" stroke="${A}" stroke-width="1.5"/>` + mouse(178, 50, 'R')) },
    { t: 'Change it later: <b>double-click</b> it and drag the points, or the round handles that bend it.', svg: pic(solid('M25 70C50 20 110 20 150 60') + `<path d="M25 70L50 20M150 60L110 20" stroke="${A}" stroke-width="1"/>` + [[50, 20], [110, 20]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.5" fill="#fff" stroke="${A}"/>`).join('') + [[25, 70], [150, 60]].map(([x, y]) => `<rect x="${x - 3.5}" y="${y - 3.5}" width="7" height="7" fill="#fff" stroke="${A}"/>`).join('') + cur(110, 20)) },
  ] },
  { id: 'spiral', title: 'Spiral', intro: 'Coils, snails, shells and springs.', steps: [
    { t: '<b>Click</b> the centre, then move out. Roll the <b>mouse wheel</b> to add or remove turns.', svg: pic(dash('M80 52a4 4 0 0 1 8 0a8 8 0 0 1 -16 0a12 12 0 0 1 24 0a16 16 0 0 1 -32 0a20 20 0 0 1 40 0a24 24 0 0 1 -48 0') + pt(80, 52, 1) + mouse(170, 50, 'W')) },
    { t: '<b>Click</b> where the outside end should be.', svg: pic(solid('M80 52a4 4 0 0 1 8 0a8 8 0 0 1 -16 0a12 12 0 0 1 24 0a16 16 0 0 1 -32 0a20 20 0 0 1 40 0') + pt(80, 52, 1) + pt(120, 52, 2)) },
    { t: 'Choose <b>Even</b> (same gap) or <b>Growing</b> (like a shell). "Start from Outer end" lets you join two spirals end to end.', svg: barPic('Coils [Even] [Growing]  Start from [Centre] [Outer end]') },
  ], tip: 'Right-click after the first click to freeze it, then change the turns.' },
  { id: 'text', title: 'Text', intro: 'Names, words and numbers — straight, or following a line, arc or circle. Lots of fonts, all cut-ready.', steps: [
    { t: '<b>Click</b> on an empty part of the page, then just type (or paste). Your words go in the box in the <b>Properties</b> panel and appear on the page as you type. Press Esc or click away when you have finished.', svg: pic(`<text x="20" y="62" font-size="26" font-weight="700" fill="none" stroke="${INK}" stroke-width="1.2">Hello</text>` + `<rect x="128" y="30" width="66" height="22" rx="3" fill="none" stroke="${A}" stroke-width="1.4"/>` + txt(160, 45, 'Hello|', A) + txt(160, 24, 'Properties') + arrow(126, 44, 100, 52, A) + pt(20, 62)) },
    { t: '<b>Click on a line, arc or circle</b> and the words follow it. Click the <b>bottom</b> of a circle and they read the right way up underneath.', svg: pic(`<circle cx="80" cy="54" r="28" fill="none" stroke="${INK}" stroke-width="1.4"/><path id="hA" d="M44 54a36 36 0 0 1 72 0" fill="none"/><text font-size="10" fill="${A}"><textPath href="#hA" startOffset="50%" text-anchor="middle">HAPPY BIRTHDAY</textPath></text><path id="hB" d="M48 58a32 32 0 0 0 64 0" fill="none"/><text font-size="10" fill="${A}"><textPath href="#hB" startOffset="50%" text-anchor="middle">SAM</textPath></text>` + pt(80, 86) + mouse(170, 50, 'L')) },
    { t: '<b>Drag</b> the words along their line. They snap to the start, middle and end (top, bottom and sides of a circle). Already-typed text can be dragged <b>onto</b> a line to follow it.', svg: pic(solid('M20 70C60 30 120 30 180 70') + `<path id="hC" d="M20 66C60 26 120 26 180 66" fill="none"/><text font-size="11" fill="${A}"><textPath href="#hC" startOffset="58%" text-anchor="middle">wavy words</textPath></text>` + arrow(90, 72, 125, 72, A) + pt(100, 41) + txt(100, 90, 'snaps to start · middle · end')) },
    { t: 'Click text with the Select tool and its settings (font, size, spacing…) appear in the bar at the top. Roll the <b>mouse wheel</b> over selected text to space the letters out. <b>Shift</b>+wheel changes the size, <b>Alt</b>+wheel lifts it off the line.', svg: pic(`<text x="30" y="60" font-size="22" letter-spacing="7" fill="none" stroke="${INK}" stroke-width="1.1">S P A C E</text>` + mouse(175, 50, 'W')) },
    { t: 'The ◇ handles flip it: <b>↕</b> puts it on the other side of the line, <b>↔</b> turns it back to front. Pick <b>A–D</b> for how the letters follow the curve.', svg: pic(bar('On a line [A Rainbow] [B Stretch] [C Skew] [D Stair]') + solid('M30 80Q100 30 170 80') + `<path d="M100 34l6 6-6 6-6-6z" fill="var(--sheet,#fff)" stroke="${A}" stroke-width="1.4"/>` + txt(100, 30, 'other side', A)) },
    { t: 'For a <b>key ring</b>: pick a chunky or joined-up font, <b>Contour</b> round the text, then <b>Add a ring</b> to the contour. Letters far apart? Draw a line or curve through the middle of them first — the contour goes round every letter and along the line, so it all cuts as one piece.', svg: pic(`<rect x="34" y="34" width="120" height="40" rx="20" fill="none" stroke="${INK}" stroke-width="1.4"/><circle cx="46" cy="54" r="5" fill="none" stroke="${INK}" stroke-width="1.4"/><text x="60" y="61" font-size="20" font-style="italic" font-weight="700" fill="none" stroke="${A}" stroke-width="1">Mia</text>`) },
  ], tip: 'Size is the height of the CAPITAL letters in mm — what you would measure on the cut part. Letters thinner than about 1.5 mm may burn away: make them bigger, or engrave them (blue).' },
  { id: 'dim', title: 'Dimension', intro: 'Show sizes on your drawing, like on a real plan.', steps: [
    { t: '<b>Click</b> the two points you want to measure.', svg: pic(solid('M40 70h110') + pt(40, 70, 1) + pt(150, 70, 2)) },
    { t: 'Move up or down and <b>click</b> where the measurement should sit.', svg: pic(solid('M40 75h110') + `<path d="M40 72V35M150 72V35" stroke="${RED}" stroke-width=".8"/>` + arrow(95, 40, 42, 40, RED) + arrow(95, 40, 148, 40, RED) + txt(95, 34, '110 mm', RED) + pt(120, 40, 3)) },
    { t: 'For circles choose <b>Radius</b> or <b>Diameter</b> at the top, then click the circle.', svg: pic(bar('Type [Aligned] [Horizontal] [Vertical] [Radius] [Diameter]') + `<circle cx="80" cy="62" r="25" fill="none" stroke="${INK}" stroke-width="1.6"/>` + arrow(80, 62, 98, 44, RED) + txt(125, 45, 'R25', RED)) },
  ] },
  { id: 'offset', title: 'Contour / offset', intro: 'A copy of an outline that is a set distance bigger or smaller, like a border.', steps: [
    { t: '<b>Click</b> the shape (or select it first).', svg: pic(solid('M50 35h70v35h-70z') + cur(85, 52) + mouse(170, 50, 'L')) },
    { t: 'Move <b>outside</b> for bigger, <b>inside</b> for smaller. The mouse wheel changes the distance.', svg: pic(solid('M50 35h70v35h-70z') + dash('M42 27h86v51h-86z') + mouse(170, 50, 'W')) },
    { t: '<b>Click</b> to make it.', svg: pic(solid('M50 35h70v35h-70z') + solid('M42 27h86v51h-86z')) },
  ] },
  { id: 'fillet', title: 'Fillet / chamfer', intro: 'Round off (or cut off) sharp corners so parts are safe to hold.', steps: [
    { t: '<b>Click</b> a corner.', svg: pic(solid('M40 80V30h100') + pt(40, 30) + cur(41, 31) + mouse(170, 50, 'L')) },
    { t: 'Roll the <b>wheel</b> (or move the mouse) to set the size, then <b>click</b>.', svg: pic(solid('M40 80V55A25 25 0 0 1 65 30H140') + dash('M40 30h25M40 30v25') + mouse(170, 50, 'W')) },
    { t: 'Click a rounded corner again to change its size. "All corners" does every corner of a selected shape.' },
  ] },
  { id: 'trim', title: 'Delete part (trim)', intro: 'Cut away the bit of a line between two crossings.', steps: [
    { t: '<b>Hover</b> over a line. The part that will go turns <b>red</b>.', svg: pic(solid('M20 50h160') + solid('M70 20v60M130 20v60') + red('M70 50h60') + cur(100, 50)) },
    { t: '<b>Click</b> to remove it.', svg: pic(solid('M20 50h50M130 50h50') + solid('M70 20v60M130 20v60') + mouse(100, 25, 'L')) },
  ] },
  { id: 'ring', title: 'Add a ring (key ring)', intro: 'Adds a loop with a hole so your design can go on a key ring.', steps: [
    { t: '<b>Hover</b> round the edge of a closed shape. A ring follows your mouse.', svg: pic(solid('M60 70C30 50 40 25 60 35C80 25 90 50 60 70Z') + `<circle cx="60" cy="27" r="9" fill="none" stroke="${A}" stroke-dasharray="3 2"/><circle cx="60" cy="27" r="4" fill="none" stroke="${A}"/>`) },
    { t: '<b>Click</b>. The ring joins on and the hole is cut. Set the sizes in the bar at the top.', svg: pic(solid('M60 70C30 50 40 27 51 31A9 9 0 1 1 69 31C80 27 90 50 60 70Z', true) + `<circle cx="60" cy="27" r="4" fill="var(--sheet,#fff)" stroke="${INK}" stroke-width="1.6"/>` + mouse(170, 50, 'L')) },
  ] },
  { id: 'eraser', title: 'Eraser brush', intro: 'Rub out bits, such as tiny specks left after tracing a picture.', steps: [
    { t: '<b>Hold the left button and drag</b> over what you want gone.', svg: pic(solid('M30 40h40M90 60h30') + `<circle cx="140" cy="40" r="2" fill="${INK}"/><circle cx="150" cy="55" r="2" fill="${INK}"/>` + `<circle cx="146" cy="47" r="12" fill="color-mix(in srgb, var(--accent) 15%, transparent)" stroke="${A}"/>` + mouse(185, 50, 'L')) },
    { t: 'With <b>Only small pieces</b> ticked, it only removes little bits, so your main shape is safe.', svg: barPic('Brush [ 40 ] px   ☑ Only small pieces') },
  ] },
  { id: 'move', title: 'Move / copy', needsSel: true, intro: 'Move shapes an exact distance.', steps: [
    { t: '<b>Click</b> a point to move from (a corner is good).', svg: pic(solid('M30 40h40v30h-40z') + pt(30, 70, 1)) },
    { t: '<b>Click</b> where that point should go. Tick <b>Leave original</b> to make a copy.', svg: pic(solid('M30 40h40v30h-40z') + dash('M110 25h40v30h-40z') + arrow(32, 68, 108, 56, A) + pt(110, 55, 2)) },
  ] },
  { id: 'rotate', title: 'Rotate / repeat', needsSel: true, intro: 'Turn shapes, or make copies going round in a circle.', steps: [
    { t: 'Type the <b>angle</b> and how many <b>repeats</b> in the bar at the top (0 repeats = just turn it).', svg: barPic('Angle ° [ 45 ]   Repeats [ 3 ]') },
    { t: '<b>Click</b> the point to turn round.', svg: pic(solid('M70 76h70v10h-70z', true) + [45, 90, 135].map(a => `<g transform="rotate(-${a} 70 81)">${dash('M70 76h70v10h-70z')}</g>`).join('') + arrow(150, 70, 132, 36, A) + txt(160, 50, '45°', A, 'start') + pt(70, 81, 1)) },
  ] },
  { id: 'mirror', title: 'Mirror', needsSel: true, intro: 'Flip shapes, like a reflection.', steps: [
    { t: '<b>Click</b> two points on the mirror line. It turns in 15° steps; hold Shift to turn it freely.', svg: pic(solid('M40 30L80 50L40 75Z') + `<path d="M100 15V90" stroke="${A}" stroke-dasharray="6 3"/>` + dash('M160 30L120 50L160 75Z') + pt(100, 20, 1) + pt(100, 85, 2)) },
    { t: 'Tick <b>Keep original</b> to have both halves, which is great for symmetrical designs.' },
  ] },
  { id: 'array', title: 'Array / pattern', needsSel: true, intro: 'Lots of copies in rows, or round a circle.', steps: [
    { t: 'Choose <b>Grid</b> or <b>Circular</b> at the top.', svg: barPic('Pattern [Grid] [Circular]   Columns [4]  Rows [2]') },
    { t: '<b>Grid</b>: move to set the spacing and <b>click</b>.', svg: pic([0, 1, 2, 3].flatMap(i => [0, 1].map(j => (i + j ? dash : solid)(`M${30 + i * 35} ${30 + j * 32}h20v20h-20z`))).join('')) },
    { t: '<b>Circular</b>: point at a circle to go round its centre, then <b>click</b>. Change the numbers and click again to place.', svg: pic(`<circle cx="100" cy="55" r="5" fill="none" stroke="${INK}"/>` + Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4, x = 100 + 32 * Math.cos(a), y = 55 + 32 * Math.sin(a); return (i ? dash : solid)(`M${x - 6} ${y - 6}h12v12h-12z`); }).join('')) },
  ] },
  { id: 'make', title: 'Make menu: boxes, elements, pictures', intro: 'Ready-made things, found under <b>Make ▾</b> at the top.', steps: [
    { t: '<b>Box maker</b>: type the box size and material thickness. It draws all the sides with finger joints that slot together.', svg: pic(solid('M30 30h50v40h-50z') + solid('M90 30h50v40h-50z') + '<path d="M80 34h-5v6h5v6h-5v6h5v6h-5v6h5" fill="none" stroke="var(--accent)" stroke-width="1.4"/>') },
    { t: '<b>Elements</b>: hearts, animals, blanks for key rings… Click one to place it, then resize it.', svg: pic(solid('M50 70C20 50 25 25 50 38C75 25 80 50 50 70Z') + solid('M120 30l6 14 15 1-12 9 4 15-13-8-13 8 4-15-12-9 15-1z')) },
    { t: '<b>Save your own element</b>: select your shapes, then choose <b>Make ▾ → Save selection as element</b> and give it a name. It appears under <b>My elements</b>.', svg: pic(solid('M30 30h40v40h-40z', true) + arrow(80, 50, 115, 50, A) + `<rect x="120" y="28" width="60" height="44" rx="5" fill="none" stroke="${A}"/>` + txt(150, 64, 'My design', INK)) },
    { t: '<b>Living hinge</b>: slits that let wood bend round a shape — see the Living hinge topic.' },
    { t: '<b>Trace image</b>: drop in a picture and it turns into outlines you can cut.' },
  ] },
  { id: 'hinge', title: 'Living hinge (bendy wood)', intro: 'Rows of slits let flat plywood bend like a snake — to wrap round a shape, make a curved wall, or a bendy cover. Find it under <b>Make ▾ → Living hinge</b>.', steps: [
    { t: '<b>Draw or pick your shape</b> (a jelly bean, a circle…), select it, then open <b>Make ▾ → Living hinge</b>. No shape selected? It wraps a circle of the size you type.', svg: pic(solid('M30 60C30 30 70 25 90 40S140 45 150 60S120 90 90 80S30 85 30 60Z', true) + dash('M24 60C24 24 72 18 92 34S146 38 157 60S124 97 90 87S24 92 24 60Z')) },
    { t: 'Press <b>★ Recommend</b>. It works out the strip’s exact length, where it needs slits and how far apart — closer on tight curves, wider on gentle ones, none on straight bits.', svg: pic(solid('M10 30h180v40h-180z') + [20, 24, 28, 32, 36, 40, 60, 80, 100, 120, 140, 160, 164, 168, 172, 176].map((x, i) => `<path d="M${x} ${i % 2 ? 30 : 34}V${i % 2 ? 48 : 66}${i % 2 ? `M${x} 52V70` : ''}" stroke="#2b8a3e" stroke-width="1.2"/>`).join('') + txt(30, 85, 'tight curve', MUTED) + txt(100, 85, 'gentle', MUTED) + txt(170, 85, 'tight', MUTED)) },
    { t: 'Check the colours: <b style="color:#2b8a3e">green</b> bends fine, <b style="color:#e67700">orange</b> is tight, <b style="color:#e03131">red</b> is too tight. Red rings show corners that are too sharp — press <b>Round the corners</b>.', svg: pic(solid(polyD(hexPts(60, 52, 32))) + hexPts(60, 52, 32).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6" fill="none" stroke="${RED}" stroke-width="1.5"/>`).join('') + arrow(100, 52, 120, 52, A) + `<path d="M${hexPts(160, 52, 32).map(([x, y]) => `${x} ${y}`).join('L')}Z" fill="none" stroke="${INK}" stroke-width="5" stroke-linejoin="round" opacity=".25"/>` + solid('M147 24h26q6 0 9 5l13 22q3 5 0 10l-13 22q-3 5 -9 5h-26q-6 0 -9 -5l-13 -22q-3 -5 0 -10l13 -22q3 -5 9 -5z')) },
    { t: 'Choose how it joins: <b>Shelf</b> (a bigger base with your shape glued on top — the strip sits round it; easiest), <b>Tabs on the shape</b> (your shape gets tabs that poke out through slots in the strip) or <b>Tabs on the strip</b> (tabs drop into slots in a bigger base).', svg: pic(solid('M30 70h140v10h-140z', true) + solid('M45 60h110v10h-110z', true) + `<path d="M40 70V25M160 70V25" stroke="${A}" stroke-width="3"/>` + txt(100, 92, 'base · shelf · strip round it', MUTED)) },
    { t: '<b>Cut test strips first</b> (the Test strips tab) from the same wood: bend each one, and use the widest spacing that doesn’t crack.' },
  ], tip: 'Shapes with straight sides and sharp corners (like a hexagon) can’t fold to a point — round the corners first. Straight sides need no slits, so “Only where it bends” saves laser time. Hundreds of slits take a while: the window shows the cutting time.' },
  { id: 'bend', title: 'Bend to a profile (leaf, face, wing)', intro: 'Make a flat part bend along a curve you choose — a leaf curling, a face sloping back, a wing folding forward. Find it under <b>Make ▾ → Bend to a profile</b>.', steps: [
    { t: '<b>Select your shape</b> (and, if you like, a curve you drew beside it as the side view), then open <b>Make ▾ → Bend to a profile</b>.', svg: pic(`<ellipse cx="60" cy="50" rx="24" ry="38" fill="none" stroke="${INK}" stroke-width="1.6"/>` + solid('M120 12C140 30 140 40 125 50S110 75 128 88')) },
    { t: 'In the <b>side view</b>, drag the points forwards and backwards. Click the line to add a point, double-click a point to remove it — or pick a ready-made curve (Arc, S-curve, Slope back…).', svg: pic(`<path d="M40 10V90" stroke="${MUTED}" stroke-dasharray="3 3"/>` + solid('M40 10C40 30 75 40 70 55S40 80 40 90') + `<circle cx="40" cy="10" r="3.5" fill="${A}"/><circle cx="70" cy="55" r="3.5" fill="#fff" stroke="${A}" stroke-width="1.5"/><circle cx="40" cy="90" r="3.5" fill="${A}"/>` + arrow(78, 55, 100, 55, A) + mouse(140, 50, 'L')) },
    { t: 'A point <b>stops moving</b> when the bend gets tighter than the wood can take. Colours show green (fine), orange (tight), red (too tight).' },
    { t: '<b>Keep how it looks</b>: your drawing is what you’ll see, so the flat piece comes out <b>longer</b> (the wood follows the curve). <b>Keep its length</b>: your drawing is the flat piece; it can curl and fold over.', svg: pic(`<ellipse cx="45" cy="50" rx="18" ry="30" fill="none" stroke="${MUTED}" stroke-dasharray="3 2"/>` + arrow(70, 50, 95, 50, A) + `<ellipse cx="135" cy="50" rx="18" ry="42" fill="none" stroke="${INK}" stroke-width="1.6"/>` + [26, 34, 42, 50, 58, 66, 74].map(y => `<path d="M${122} ${y}h26" stroke="#2b8a3e"/>`).join('') + txt(45, 96, 'what you see', MUTED) + txt(135, 99, 'flat piece', MUTED)) },
    { t: 'Add a <b>former</b> (a stand cut to the side view) to glue it to, or leave it free to flop. Press <b>Place the new copy</b>: your original stays, the new flat copy goes beside it.' },
  ], tip: 'Narrow tips have short slits, so they bend less — give them a gentler curve. A part can bend one way at a time (along its length): it can’t make a dome.' },
  { id: 'laser', title: 'Getting ready to cut', intro: 'A few checks before you send your design to the laser.', steps: [
    { t: 'Put lines to <b>cut</b> on the Cut layer and lines to <b>mark</b> (draw on the surface) on the Engrave layer, using the bar at the top.', svg: barPic('Layer [Cut ▾]   Colour [Black ▾]') },
    { t: 'Check your design fits on the <b>Bed</b> (the sheet size) and that small parts aren’t thinner than about 2 mm.' },
    { t: 'Press <b>Export SVG</b> (or DXF) and open the file in the laser software.', svg: pic(`<rect x="60" y="35" width="80" height="26" rx="5" fill="${A}"/>` + txt(100, 52, 'Export SVG', '#fff')) },
  ] },
];

const TOPICS = ['start', 'lock', 'view', 'make', 'hinge', 'bend', 'laser'];

/** HTML for the Help tab. `toolId` = the tool in use; `showId` = the guide to show (defaults to the tool's). */
export function helpHtml(toolId: string, showId: string | null, icons: Record<string, { icon: string; label: string; key: string }>): string {
  const id = showId || (GUIDES.some(g => g.id === toolId) ? toolId : 'start'), g = GUIDES.find(x => x.id === id) || GUIDES[0];
  const ic = icons[g.id];
  const steps = g.steps.map((s, i) => `<li class="hstep"><span class="hnum">${i + 1}</span><div><p>${s.t}</p>${s.svg || ''}</div></li>`).join('');
  const toolBtns = Object.entries(icons).filter(([k]) => GUIDES.some(x => x.id === k)).map(([k, t]) => `<button type="button" class="hbtn${k === g.id ? ' on' : ''}" data-help="${k}" title="${t.label} (${t.key})"><svg viewBox="0 0 24 24">${t.icon}</svg><span>${t.label.split(' (')[0]}</span></button>`).join('');
  const topicBtns = TOPICS.map(k => `<button type="button" class="htopic${k === g.id ? ' on' : ''}" data-help="${k}">${GUIDES.find(x => x.id === k)!.title}</button>`).join('');
  return `<div class="help">
    <div class="hhead">${ic ? `<span class="hicon"><svg viewBox="0 0 24 24">${ic.icon}</svg></span>` : '<span class="hicon hq">?</span>'}<div><h3>${g.title}${ic ? ` <kbd>${ic.key}</kbd>` : ''}</h3><p class="hint">${g.intro}${g.needsSel ? ' <b>Select the shapes first.</b>' : ''}</p></div></div>
    <ol class="hsteps">${steps}</ol>
    ${g.tip ? `<p class="htip"><b>Tip:</b> ${g.tip}</p>` : ''}
    ${id !== toolId && GUIDES.some(x => x.id === toolId) ? `<button type="button" class="btn" data-help="${toolId}">← Back to the tool you are using</button>` : ''}
    <h3>Help topics</h3><div class="htopics">${topicBtns}</div>
    <h3>Every tool</h3><div class="hgrid">${toolBtns}</div>
  </div>`;
}
