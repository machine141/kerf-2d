/** Tool registry — the toolbox is built from this list, in order. Add new tools here. */
import type { Tool } from '../editor/tool';
import { selectTool } from './select';
import { lineTool, rectTool, circleTool, arcTool, dimTool } from './draw';
import { offsetTool } from './offset';
import { trimTool } from './trim';
import { ringTool } from './ring';
import { filletTool } from './fillet';
import { moveTool, rotateTool, mirrorTool } from './transform';

export const ALL_TOOLS: Tool[] = [selectTool, lineTool, rectTool, circleTool, arcTool, dimTool, offsetTool, filletTool, trimTool, ringTool, moveTool, rotateTool, mirrorTool];
