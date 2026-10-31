/** Toolbox icons (24×24 stroke drawings). Original artwork for Kerf 2D. */
export const ICONS: Record<string, string> = {
  select: '<path d="M6 3l11 9-5 1 3 6-2 1-3-6-4 4z"/>',
  line: '<path d="M3 18l5-9 6 6 7-11"/><circle cx="3" cy="18" r="1.3"/><circle cx="21" cy="4" r="1.3"/>',
  rect: '<rect x="4" y="6" width="16" height="12"/>',
  circle: '<circle cx="12" cy="12" r="8.5"/>',
  arc: '<path d="M4 16a8 8 0 0 1 16 0"/><circle cx="4" cy="16" r="1.2"/><circle cx="20" cy="16" r="1.2"/>',
  text: '<path d="M3 6V4h12v2M9 4v15M6.5 19h5"/><path d="M15 13l6 7M21 13l-6 7"/>',
  dim: '<path d="M4 7v10M20 7v10M4 12h16M4 12l3-2M4 12l3 2M20 12l-3-2M20 12l-3 2"/>',
  offset: '<rect x="8" y="8" width="8" height="8" rx="1"/><rect x="3" y="3" width="18" height="18" rx="5" stroke-dasharray="3 2"/>',
  trim: '<circle cx="6" cy="17.5" r="3"/><circle cx="18" cy="17.5" r="3"/><path d="M8.2 15.4L17 3.5M15.8 15.4L7 3.5"/><circle cx="12" cy="9.6" r=".6"/>',
  circBox: '<rect x="3" y="3" width="18" height="18" stroke-dasharray="2.5 2" stroke-width="1"/><circle cx="12" cy="12" r="9"/><circle cx="3" cy="3" r="1.6" fill="currentColor"/><circle cx="21" cy="21" r="1.6" fill="currentColor"/>',
  circCentre: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><path d="M12 12l6.4-6.4" stroke-dasharray="2 1.6"/>',
  bucket: '<path d="M5 11l7-7 7.5 7.5-7 7z"/><path d="M5 11h14.5"/><path d="M12 4L9.5 1.5"/><path d="M20.5 14.5c1 1.6 1.5 2.6 1.5 3.3a1.5 1.5 0 0 1-3 0c0-.7.5-1.7 1.5-3.3z" fill="currentColor"/>',
  move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M17 3v3h3"/>',
  mirror: '<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M9 7L4 17h5zM15 7l5 10h-5z"/>',
};
