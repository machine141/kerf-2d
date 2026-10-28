/** Toolbox icons (24×24 stroke drawings). Original artwork for Kerf 2D. */
export const ICONS: Record<string, string> = {
  select: '<path d="M6 3l11 9-5 1 3 6-2 1-3-6-4 4z"/>',
  line: '<path d="M3 18l5-9 6 6 7-11"/><circle cx="3" cy="18" r="1.3"/><circle cx="21" cy="4" r="1.3"/>',
  rect: '<rect x="4" y="6" width="16" height="12"/>',
  circle: '<ellipse cx="12" cy="12" rx="9" ry="7"/><circle cx="12" cy="12" r="1"/>',
  arc: '<path d="M4 18a10 10 0 0 1 16-8"/><circle cx="12" cy="18" r="1"/>',
  dim: '<path d="M4 7v10M20 7v10M4 12h16M4 12l3-2M4 12l3 2M20 12l-3-2M20 12l-3 2"/>',
  offset: '<rect x="8" y="8" width="8" height="8" rx="1"/><rect x="3" y="3" width="18" height="18" rx="5" stroke-dasharray="3 2"/>',
  trim: '<path d="M3 12h7M14 12h7"/><path d="M12 4v16" stroke-dasharray="2 2"/><path d="M9 9l6 6M15 9l-6 6"/>',
  move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M17 3v3h3"/>',
  mirror: '<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M9 7L4 17h5zM15 7l5 10h-5z"/>',
};
