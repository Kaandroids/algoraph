import { Injectable, computed, signal } from '@angular/core';
import { type AlgoFile } from '../models/algo-file.model';
import type { LineNote } from '../editor/line-notes';

/**
 * Owns the algorithm-workspace files: the entry `main`, any module files, which
 * tab is active, and the inline-rename draft. Keeping this out of the App
 * component lets the file logic be reasoned about (and tested) on its own.
 */
@Injectable({ providedIn: 'root' })
export class FilesStore {
  /** Start with just the empty entry file; the learner writes the algorithm. */
  readonly files = signal<AlgoFile[]>([{ id: 'main', name: 'main.algo', content: '', notes: [] }]);
  readonly activeId = signal('main');
  /** Id of the tab being renamed inline (null = none); `main` is never renamable. */
  readonly renamingId = signal<string | null>(null);
  readonly renameDraft = signal('');

  /** The tab currently open in the editor. */
  readonly active = computed(() => this.files().find((f) => f.id === this.activeId()) ?? this.files()[0]);
  /** Line count of the active file, shown in the editor footer. */
  readonly activeLineCount = computed(() => this.active().content.split('\n').length);
  /** Per-line notes of the active file, bound into the editor. */
  readonly activeNotes = computed(() => this.active().notes);
  /** The entry file — shown read-only in the Run workspace. */
  readonly main = computed(() => this.files().find((f) => f.id === 'main') ?? this.files()[0]);

  private nextId = 1;

  setActive(id: string): void {
    this.activeId.set(id);
  }

  /** Persist the editor's content back to the active file. */
  setContent(text: string): void {
    this.patchActive((f) => ({ ...f, content: text }));
  }

  /** Persist per-line notes back to the active file. */
  setNotes(notes: LineNote[]): void {
    this.patchActive((f) => ({ ...f, notes }));
  }

  /** Add a fresh module file with a unique name and focus it. */
  add(): void {
    const id = `f${this.nextId++}`;
    const used = new Set(this.files().map((f) => f.name));
    let name = 'module.algo';
    for (let i = 2; used.has(name); i++) name = `module${i}.algo`;
    this.files.update((list) => [...list, { id, name, content: '// new module\n', notes: [] }]);
    this.activeId.set(id);
  }

  /** Add a file with given content (e.g. an imported `.algo`), under a unique name, and focus it. */
  addFile(name: string, content: string): void {
    const id = `f${this.nextId++}`;
    let base = name.trim() || 'imported.algo';
    if (!/\.algo$/i.test(base)) base += '.algo';
    const used = new Set(this.files().map((f) => f.name));
    let unique = base;
    for (let i = 2; used.has(unique); i++) unique = base.replace(/\.algo$/i, `${i}.algo`);
    this.files.update((list) => [...list, { id, name: unique, content, notes: [] }]);
    this.activeId.set(id);
  }

  /** Close a module file; the entry `main` can't be closed. */
  close(event: Event, id: string): void {
    event.stopPropagation();
    if (id === 'main') return;
    this.files.update((list) => list.filter((f) => f.id !== id));
    if (this.activeId() === id) this.activeId.set('main');
  }

  /** Begin inline rename of a tab (the entry `main` can't be renamed). */
  startRename(event: Event, file: AlgoFile): void {
    event.stopPropagation();
    if (file.id === 'main') return;
    this.renameDraft.set(file.name);
    this.renamingId.set(file.id);
  }

  /** Apply the rename draft, ensuring a `.algo` extension and a unique name. */
  commitRename(): void {
    const id = this.renamingId();
    if (!id) return;
    let name = this.renameDraft().trim();
    if (name) {
      if (!/\.algo$/i.test(name)) name += '.algo';
      const taken = this.files().some((f) => f.id !== id && f.name === name);
      if (!taken) this.files.update((list) => list.map((f) => (f.id === id ? { ...f, name } : f)));
    }
    this.renamingId.set(null);
  }

  cancelRename(): void {
    this.renamingId.set(null);
  }

  private patchActive(change: (file: AlgoFile) => AlgoFile): void {
    const id = this.activeId();
    this.files.update((list) => list.map((f) => (f.id === id ? change(f) : f)));
  }
}
