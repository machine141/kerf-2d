/**
 * The typing box for text: appears just under the text on the sheet; the
 * letters update on the drawing as you type. Enter makes a new line (text on a
 * line is one line, so Enter finishes there); Esc, Ctrl+Enter or clicking
 * away finishes. Empty text is removed.
 */
import type { Editor } from '../editor/editor';
import type { TextEnt } from '../model/types';
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

export function attachTextEditor(ed: Editor, host: HTMLElement, cv: HTMLCanvasElement) {
  let cur: { ta: HTMLTextAreaElement; id: string; isNew: boolean; start: string; pushed: boolean; finish: () => void } | null = null;
  ed.textEditor = (id, isNew) => {
    cur?.finish();
    const e = ed.store.byId(id) as TextEnt | undefined; if (!e || e.type !== 'text') return;
    const ta = document.createElement('textarea'); ta.className = 'txed'; ta.value = e.text; ta.spellcheck = false; ta.setAttribute('aria-label', 'Type your text');
    ta.style.fontFamily = cssFont(e.font); ta.rows = Math.max(1, e.text.split('\n').length);
    const place = () => {
      const t = ed.store.byId(id); if (!t) return; const b = ed.bbox(t), hr = host.getBoundingClientRect(), cr = cv.getBoundingClientRect();
      const p = ed.w2s({ x: b.x0, y: b.y0 }), x = Math.max(4, Math.min(cr.left - hr.left + p.x, hr.width - 220)), y = Math.min(cr.top - hr.top + p.y + 10, hr.height - 70);
      ta.style.left = x + 'px'; ta.style.top = Math.max(4, y) + 'px';
    };
    const st = { ta, id, isNew, start: e.text, pushed: isNew, finish: () => {} };
    let done = false;
    st.finish = () => {
      if (done) return; done = true; cur = null; ed.state.typing = null; ta.remove();
      const t = ed.store.byId(id) as TextEnt | undefined; if (!t) return;
      if (!t.text.trim()) {
        if (isNew) { ed.store.remove([id]); ed.store.discardCheckpoint(); }
        else { if (!st.pushed) ed.store.checkpoint(); ed.store.remove([id]); }
        ed.toast('Empty text removed');
      } else if (!st.pushed && t.text !== st.start) ed.store.checkpoint();
      ed.store.emit();
    };
    ta.addEventListener('input', () => {
      const t = ed.store.byId(id) as TextEnt | undefined; if (!t) return;
      if (!st.pushed) { ed.store.checkpoint(); st.pushed = true; }
      t.text = t.path ? ta.value.replace(/\n/g, ' ') : ta.value; ta.rows = Math.max(1, ta.value.split('\n').length);
      ed.changed('view'); place();
    });
    ta.addEventListener('keydown', ev => {
      ev.stopPropagation();
      const t = ed.store.byId(id) as TextEnt | undefined;
      if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey || t?.path))) { ev.preventDefault(); st.finish(); }
    });
    ta.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== ta) st.finish(); }, 0));
    host.append(ta); place(); cur = st; ed.state.typing = st.finish;
    // focus after the click that opened it has finished (the canvas would take focus back)
    setTimeout(() => { if (done) return; ta.focus(); if (isNew) ta.select(); else ta.setSelectionRange(ta.value.length, ta.value.length); }, 40);
  };
  /** Keep the box under its text when the view moves. */
  return { reposition: () => { if (cur) { const id = cur.id, t = ed.store.byId(id); if (!t) return; cur.ta.style.fontFamily = cssFont((t as TextEnt).font); } } };
}
