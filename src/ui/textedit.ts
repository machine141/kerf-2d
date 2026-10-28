/** Fonts for the page itself (font previews and the text box in the Properties panel). */
import { fontDataUrl } from '../text/fonts';

const loaded = new Set<string>();
/** Make one of the built-in fonts usable by the page (for previews and the typing box). */
export function cssFont(id: string): string {
  const fam = 'kerf-' + id;
  if (!loaded.has(id)) {
    loaded.add(id); const url = fontDataUrl(id);
    try { if (url && 'FontFace' in window) { const f = new FontFace(fam, `url(${url})`); (document as any).fonts.add(f); f.load().catch(() => { /* ignore */ }); } } catch { /* ignore */ }
  }
  return `"${fam}", system-ui, sans-serif`;
}
