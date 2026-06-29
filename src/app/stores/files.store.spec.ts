import { describe, it, expect, beforeEach } from 'vitest';
import '@angular/compiler'; // provides the JIT compiler for `Injector.create` under bare vitest
import { Injector } from '@angular/core';
import { FilesStore } from './files.store';

// `FilesStore` is a dependency-free `@Injectable` (signals only, no `inject()`),
// so a bare core `Injector` resolves a fresh instance per test without needing
// the Angular DOM testing platform — which `npx vitest run` can't wire up
// outside the `@angular/build:unit-test` harness.

describe('FilesStore', () => {
  let store: FilesStore;

  beforeEach(() => {
    store = Injector.create({ providers: [FilesStore] }).get(FilesStore);
  });

  // ── Defaults ──────────────────────────────────────────────
  describe('defaults', () => {
    it('starts with a single empty main file', () => {
      expect(store.files().length).toBe(1);
      const f = store.files()[0];
      expect(f.id).toBe('main');
      expect(f.name).toBe('main.algo');
      expect(f.content).toBe('');
      expect(f.notes).toEqual([]);
    });

    it('main is active by default', () => {
      expect(store.activeId()).toBe('main');
      expect(store.active().id).toBe('main');
      expect(store.main().id).toBe('main');
    });

    it('activeLineCount of an empty file is 1', () => {
      expect(store.activeLineCount()).toBe(1);
    });

    it('starts with no inline rename in progress', () => {
      expect(store.renamingId()).toBeNull();
      expect(store.renameDraft()).toBe('');
    });
  });

  // ── Content / notes ───────────────────────────────────────
  describe('content & notes', () => {
    it('setContent writes to the active file and updates the line count', () => {
      store.setContent('a\nb\nc');
      expect(store.active().content).toBe('a\nb\nc');
      expect(store.activeLineCount()).toBe(3);
    });

    it('setNotes writes per-line notes to the active file', () => {
      const notes = [{ line: 1, text: 'hi' }] as never;
      store.setNotes(notes);
      expect(store.activeNotes()).toBe(notes);
      expect(store.active().notes).toBe(notes);
    });
  });

  // ── Active selection ──────────────────────────────────────
  it('setActive switches the open tab', () => {
    store.add(); // f1
    expect(store.activeId()).toBe('f1');
    store.setActive('main');
    expect(store.activeId()).toBe('main');
    expect(store.active().id).toBe('main');
  });

  // ── Adding files ──────────────────────────────────────────
  describe('add / addFile', () => {
    it('add creates a uniquely named module and focuses it', () => {
      store.add();
      expect(store.files().length).toBe(2);
      const added = store.files()[1];
      expect(added.id).toBe('f1');
      expect(added.name).toBe('module.algo');
      expect(store.activeId()).toBe('f1');
    });

    it('add disambiguates repeated module names', () => {
      store.add();
      store.add();
      store.add();
      expect(store.files().map((f) => f.name)).toEqual([
        'main.algo',
        'module.algo',
        'module2.algo',
        'module3.algo',
      ]);
    });

    it('addFile appends a .algo extension and focuses the file', () => {
      store.addFile('helpers', 'export function f() end');
      const f = store.files()[1];
      expect(f.name).toBe('helpers.algo');
      expect(f.content).toBe('export function f() end');
      expect(store.activeId()).toBe(f.id);
    });

    it('addFile keeps an existing .algo extension', () => {
      store.addFile('bfs.algo', 'x');
      expect(store.files()[1].name).toBe('bfs.algo');
    });

    it('addFile uniquifies a duplicate name', () => {
      store.addFile('dup', 'a');
      store.addFile('dup', 'b');
      expect(store.files().map((f) => f.name)).toEqual(['main.algo', 'dup.algo', 'dup2.algo']);
    });

    it('addFile falls back to imported.algo for a blank name', () => {
      store.addFile('   ', 'x');
      expect(store.files()[1].name).toBe('imported.algo');
    });
  });

  // ── Bundles ───────────────────────────────────────────────
  describe('loadBundle', () => {
    it('replaces the workspace, making the first file main', () => {
      store.add(); // some pre-existing module
      store.loadBundle([
        { name: 'entry.algo', content: 'main body' },
        { name: 'lib.algo', content: 'helper' },
      ]);
      expect(store.files().length).toBe(2);
      expect(store.files()[0].id).toBe('main');
      expect(store.files()[0].name).toBe('entry.algo');
      expect(store.main().content).toBe('main body');
      expect(store.activeId()).toBe('main');
    });

    it('carries per-file notes along', () => {
      const notes = [{ line: 2, text: 'note' }] as never;
      store.loadBundle([{ name: 'entry.algo', content: 'x', notes }]);
      expect(store.files()[0].notes).toBe(notes);
    });

    it('ignores an empty bundle', () => {
      store.loadBundle([]);
      expect(store.files().length).toBe(1);
      expect(store.files()[0].id).toBe('main');
    });
  });

  // ── Closing tabs ──────────────────────────────────────────
  describe('close', () => {
    it('closes a module file', () => {
      store.add(); // f1
      store.close(new Event('click'), 'f1');
      expect(store.files().length).toBe(1);
      expect(store.files()[0].id).toBe('main');
    });

    it('falls back to main when the active file is closed', () => {
      store.add(); // f1, now active
      store.close(new Event('click'), 'f1');
      expect(store.activeId()).toBe('main');
    });

    it('never closes the main entry file', () => {
      store.close(new Event('click'), 'main');
      expect(store.files().length).toBe(1);
    });
  });

  // ── Inline rename ─────────────────────────────────────────
  describe('rename', () => {
    it('startRename seeds the draft and marks the tab', () => {
      store.add(); // f1 / module.algo
      const file = store.files()[1];
      store.startRename(new Event('click'), file);
      expect(store.renamingId()).toBe('f1');
      expect(store.renameDraft()).toBe('module.algo');
    });

    it('never starts renaming the main file', () => {
      store.startRename(new Event('click'), store.main());
      expect(store.renamingId()).toBeNull();
    });

    it('commitRename applies the draft with a .algo extension', () => {
      store.add(); // f1
      store.startRename(new Event('click'), store.files()[1]);
      store.renameDraft.set('renamed');
      store.commitRename();
      expect(store.files()[1].name).toBe('renamed.algo');
      expect(store.renamingId()).toBeNull();
    });

    it('commitRename rejects a name already taken', () => {
      store.add(); // f1 / module.algo
      store.add(); // f2 / module2.algo
      store.startRename(new Event('click'), store.files()[2]); // rename f2
      store.renameDraft.set('module'); // collides with f1
      store.commitRename();
      expect(store.files()[2].name).toBe('module2.algo');
      expect(store.renamingId()).toBeNull();
    });

    it('cancelRename clears the in-progress rename', () => {
      store.add();
      store.startRename(new Event('click'), store.files()[1]);
      store.cancelRename();
      expect(store.renamingId()).toBeNull();
    });
  });
});
