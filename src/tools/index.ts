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

export const ALL_TOOLS: Tool[] = [selectTool, lineTool, rectTool, polygonTool, circleTool, arcTool, splineTool, spiralTool, dimTool, offsetTool, filletTool, trimTool, ringTool, eraserTool, moveTool, rotateTool, mirrorTool, arrayTool];
