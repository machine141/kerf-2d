/** Tool registry — the toolbox is built from this list, in order. Add new tools here. */
import type { Tool } from '../editor/tool';
import { selectTool } from './select';
import { lineTool, rectTool, circleTool, arcTool, dimTool, polygonTool, splineTool, spiralTool } from './draw';
import { offsetTool } from './offset';
import { trimTool } from './trim';
import { ringTool } from './ring';
import { eraserTool } from './eraser';
import { arrayTool } from './array';
import { filletTool } from './fillet';
import { moveTool, rotateTool, mirrorTool } from './transform';
import { textTool } from './text';
import { hingeBrushTool } from './hingebrush';
import { smoothTool } from './smooth';
import { bucketTool } from './bucket';

/**
 * The toolbox, top to bottom, in groups (a thin line between groups), laid out like most drawing and CAD
 * programs (Illustrator, Inkscape, Onshape and Fusion 360 sketches, 2D Design): select first, then the shapes
 * you draw most, then arranging (move, rotate, mirror, repeat), then changing shapes, then the extras.
 * In the two-column toolbox each row is a pair that belongs together.
 */
const LAYOUT: Tool[][] = [
  [selectTool],
  // draw: line & rectangle, circle & arc, polygon & curve, text & spiral
  [lineTool, rectTool, circleTool, arcTool, polygonTool, splineTool, textTool, spiralTool],
  // arrange: move & rotate, mirror & repeat
  [moveTool, rotateTool, mirrorTool, arrayTool],
  // change shapes: trim & erase, fillet & offset, smooth
  [trimTool, eraserTool, filletTool, offsetTool, smoothTool],
  // extras: fill & dimension, key ring & hinge brush
  [bucketTool, dimTool, ringTool, hingeBrushTool],
];
LAYOUT.forEach((g, i) => g.forEach(t => { t.group = i; }));
export const ALL_TOOLS: Tool[] = LAYOUT.flat();
