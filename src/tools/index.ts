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

export const ALL_TOOLS: Tool[] = [selectTool, lineTool, rectTool, polygonTool, circleTool, arcTool, splineTool, spiralTool, textTool, dimTool, offsetTool, filletTool, trimTool, ringTool, hingeBrushTool, eraserTool, moveTool, rotateTool, mirrorTool, arrayTool];
