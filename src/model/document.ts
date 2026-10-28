/** Document store: entities, layers, ids and undo/redo history. */
import { newDoc, migrateDoc, type Doc, type Entity, type Shape, type Layer } from './types';

export class DocStore {
  doc: Doc;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private listeners = new Set<() => void>();

  constructor(doc: Doc = newDoc()) { this.doc = doc; }

  on(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const f of this.listeners) f(); }

  get ents() { return this.doc.ents; }
  byId(id: string) { return this.doc.ents.find(e => e.id === id); }
  layer(id: string): Layer | undefined { return this.doc.layers.find(l => l.id === id); }
  visible = (e: Entity) => this.layer(e.layer)?.visible !== false;
  usable = (e: Entity) => { const l = this.layer(e.layer); return !!l && l.visible && l.active; };
  newId() { return 'e' + (this.doc.seq++); }

  /** Record the current state so the next change can be undone. */
  checkpoint() { this.undoStack.push(JSON.stringify(this.doc)); if (this.undoStack.length > 300) this.undoStack.shift(); this.redoStack = []; }
  /** Drop the last checkpoint (used when an operation turns out to change nothing). */
  discardCheckpoint() { this.undoStack.pop(); }
  /** Run a change as one undoable step. */
  change<T>(fn: () => T): T { this.checkpoint(); const r = fn(); this.emit(); return r; }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  undo() { if (!this.undoStack.length) return false; this.redoStack.push(JSON.stringify(this.doc)); this.doc = JSON.parse(this.undoStack.pop()!); this.emit(); return true; }
  redo() { if (!this.redoStack.length) return false; this.undoStack.push(JSON.stringify(this.doc)); this.doc = JSON.parse(this.redoStack.pop()!); this.emit(); return true; }
  load(d: any, keepHistory = true) { if (keepHistory) this.checkpoint(); else { this.undoStack = []; this.redoStack = []; } this.doc = migrateDoc(d); this.emit(); }

  /** Add a shape, filling in id / layer / colour / width from the current attributes. */
  add(s: Shape, attrs: Partial<Pick<Entity, 'layer' | 'color' | 'w'>> = {}): Entity {
    const e = { ...s, id: this.newId(), layer: attrs.layer ?? s.layer ?? this.doc.current, color: attrs.color ?? s.color ?? this.doc.attrs.color, w: attrs.w ?? s.w ?? this.doc.attrs.w } as Entity;
    this.doc.ents.push(e); return e;
  }
  /** Replace an entity in place, keeping its id and position in the drawing order. */
  replace(id: string, s: Shape): Entity | undefined {
    const i = this.doc.ents.findIndex(e => e.id === id); if (i < 0) return;
    const old = this.doc.ents[i];
    const n = { ...s, id, layer: s.layer ?? old.layer, color: s.color ?? old.color, w: s.w ?? old.w } as Entity;
    this.doc.ents[i] = n; return n;
  }
  /** Replace one entity with several (e.g. trim, explode); returns the new entities. */
  splice(id: string, shapes: Shape[]): Entity[] {
    const i = this.doc.ents.findIndex(e => e.id === id); if (i < 0) return [];
    const old = this.doc.ents[i];
    const made = shapes.map(s => ({ ...s, id: this.newId(), layer: s.layer ?? old.layer, color: s.color ?? old.color, w: s.w ?? old.w }) as Entity);
    this.doc.ents.splice(i, 1, ...made); return made;
  }
  remove(ids: Iterable<string>) { const set = new Set(ids); this.doc.ents = this.doc.ents.filter(e => !set.has(e.id)); }
}
