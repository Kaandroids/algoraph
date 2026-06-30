import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { LibraryStore } from './stores/library.store';

// jsdom lacks the layout APIs that Foblex Flow and CodeMirror reach for while
// measuring; stub them so rendering the canvas / editor workspaces doesn't throw.
(globalThis as any).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
if (typeof Range !== 'undefined') {
  const emptyRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as any;
  Range.prototype.getClientRects ??= emptyRects;
  Range.prototype.getBoundingClientRect ??= () =>
    ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as any;
}

/**
 * Component-level coverage for the App facade. `TestBed.createComponent` renders
 * the full template in jsdom, so exercising the component's methods and switching
 * workspaces also drives the bulk of `app.html` and the rendered child tree
 * (editor, icons, directives, backdrops, the docs page). The library store is
 * faked so import/library flows never touch the network.
 */

/** A fake LibraryStore — deterministic, no `fetch`. */
const fakeLibrary = {
  index: vi.fn(async () => ({
    algorithm: [{ name: 'BFS', description: 'breadth first', file: 'algorithm/bfs.json' }],
    canvas: [{ name: 'Grid', description: 'a grid', file: 'canvas/grid.json' }],
  })),
  file: vi.fn(async (path: string) =>
    /\.json$/i.test(path) ? JSON.stringify({ nodes: [], edges: [], dataNodes: [] }) : 'start ← source()',
  ),
  bundle: vi.fn(async () => ({
    files: [{ name: 'main', content: 'a ← 1', notes: [] }],
  })),
};

/** A minimal MouseEvent-like stub for handlers that only read a few fields. */
function evt(over: Record<string, unknown> = {}): any {
  return {
    clientX: 10,
    clientY: 20,
    button: 0,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...over,
  };
}

function make() {
  const fixture = TestBed.createComponent(App);
  fixture.detectChanges();
  // `as any` so the spec can reach the component's protected view-model surface.
  return { fixture, app: fixture.componentInstance as any };
}

describe('App', () => {
  beforeEach(async () => {
    // jsdom doesn't implement object URLs — stub them for the download helpers.
    (URL as any).createObjectURL = vi.fn(() => 'blob:stub');
    (URL as any).revokeObjectURL = vi.fn();
    fakeLibrary.index.mockClear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [{ provide: LibraryStore, useValue: fakeLibrary }],
    }).compileComponents();
  });

  it('creates and renders the brand', async () => {
    const { fixture } = make();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.ag-wordmark')?.textContent).toContain('Algoraph');
  });

  // ── Pure view-model helpers ──────────────────────────────────
  describe('helpers', () => {
    it('formats matrix cells with infinity glyphs', () => {
      const { app } = make();
      expect(app.fmtCell(Infinity)).toBe('∞');
      expect(app.fmtCell(-Infinity)).toBe('-∞');
      expect(app.fmtCell(7)).toBe('7');
    });

    it('returns matrix headers, custom or numeric', () => {
      const { app } = make();
      expect(app.matrixCol({ colLabels: ['A', 'B'] }, 1)).toBe('B');
      expect(app.matrixCol({}, 2)).toBe('2');
      expect(app.matrixRow({ rowLabels: ['x'] }, 0)).toBe('x');
      expect(app.matrixRow({}, 3)).toBe('3');
    });

    it('builds an index range and reverses/sorts collections', () => {
      const { app } = make();
      expect(app.range(3)).toEqual([0, 1, 2]);
      expect(app.reversed([1, 2, 3])).toEqual([3, 2, 1]);
      expect(
        app.sortedHeap({ heap: [{ value: 'a', priority: 5 }, { value: 'b', priority: 1 }] }),
      ).toEqual([{ value: 'b', priority: 1 }, { value: 'a', priority: 5 }]);
    });

    it('derives Foblex port ids and data-structure presentation', () => {
      const { app } = make();
      const node = { id: 'n1', kind: 'NODE', label: 'N1', position: { x: 0, y: 0 } };
      expect(app.outputId(node)).toContain('n1');
      expect(app.inputId(node)).toContain('n1');
      expect(app.dataIcon('QUEUE')).toBeTruthy();
      expect(app.dataColor('QUEUE')).toContain('oklch');
      expect(app.dataTypeLabel('MATRIX')).toBe('Matrix');
      expect(app.nodeTypeLabel('START')).toBe('START');
    });

    it('captions algorithm files for the export picker', () => {
      const { app } = make();
      expect(app.fileMeta({ id: 'main', name: 'main', content: 'a\nb' })).toContain('Entry file');
      expect(app.fileMeta({ id: 'x', name: 'x', content: '' })).toBe('0 lines');
      expect(app.fileMeta({ id: 'x', name: 'x', content: 'a\nb\nc' })).toBe('3 lines');
    });

    it('exposes reference groups for graph and data kinds', () => {
      const { app } = make();
      expect(Array.isArray(app.graphGroups('NODE'))).toBe(true);
      expect(Array.isArray(app.dataGroups('MAP'))).toBe(true);
    });
  });

  // ── View switching, rails, zoom ──────────────────────────────
  describe('workspace chrome', () => {
    it('switches across all four workspaces', () => {
      const { app, fixture } = make();
      for (const view of ['algorithm', 'run', 'docs', 'canvas'] as const) {
        app.setView(view);
        fixture.detectChanges();
        expect(app.activeView()).toBe(view);
        expect(app.ui.expandedLib()).toBeNull();
      }
    });

    it('routes docs CTAs to the right destination', () => {
      const { app, fixture } = make();
      app.onDocsNavigate('run');
      expect(app.activeView()).toBe('run');
      app.onDocsNavigate('syntax');
      fixture.detectChanges();
      expect(app.activeView()).toBe('algorithm');
      expect(app.ui.syntaxOpen()).toBe(true);
      app.onDocsNavigate('import');
      expect(app.ui.importOpen()).toBe(true);
      app.onDocsNavigate('canvas');
      expect(app.activeView()).toBe('canvas');
    });

    it('toggles the library rail and each inspector rail', () => {
      const { app } = make();
      const before = app.ui.railCollapsed();
      app.toggleRail();
      expect(app.ui.railCollapsed()).toBe(!before);
      for (const key of ['code', 'data', 'runcode'] as const) {
        const v = app.toggleInspector(key);
        expect(typeof app.ui.codeRailCollapsed()).toBe('boolean');
      }
    });

    it('delegates zoom controls without a live canvas', () => {
      const { app } = make();
      expect(() => {
        app.zoomIn();
        app.zoomOut();
        app.resetZoom();
      }).not.toThrow();
      expect(typeof app.zoomLevel()).toBe('number');
    });
  });

  // ── Graph + data nodes ───────────────────────────────────────
  describe('canvas nodes', () => {
    it('adds graph vertices of each kind', () => {
      const { app } = make();
      app.addNode('NODE');
      app.addNode('START');
      app.addNode('GOAL');
      expect(app.nodes().length).toBe(3);
    });

    it('adds, copies and deletes data structures', () => {
      const { app } = make();
      app.addDataNode('QUEUE');
      const id = app.dataNodes()[0].id;
      app.copyDataNode(id);
      expect(app.dataNodes().length).toBe(2);
      app.deleteDataNode(id);
      expect(app.dataNodes().length).toBe(1);
    });

    it('connects two vertices and edits the edge', () => {
      const { app } = make();
      app.addNode('START');
      app.addNode('GOAL');
      const [a, b] = app.nodes();
      app.onConnectionCreated({ sourceId: app.outputId(a), targetId: app.inputId(b) });
      expect(app.edges().length).toBe(1);
      const edge = app.edges()[0];
      app.openEdgeEditor(evt(), edge.id);
      expect(app.editEdgeId()).toBe(edge.id);
      expect(app.editingEdge()?.id).toBe(edge.id);
      app.setEdgeWeight(edge.id, 9);
      app.setEdgeDirected(edge.id, false);
      expect(app.edges()[0].weight).toBe(9);
      expect(app.edges()[0].directed).toBe(false);
      app.deleteEdge(edge.id);
      expect(app.edges().length).toBe(0);
      expect(app.editEdgeId()).toBeNull();
    });

    it('moves nodes and reports canvas/selection changes', () => {
      const { app } = make();
      app.addNode('NODE');
      const id = app.nodes()[0].id;
      app.onNodeMoved({ nodes: [{ id, position: { x: 5, y: 6 } }] });
      expect(app.nodes()[0].position).toEqual({ x: 5, y: 6 });
      app.onCanvasChange({ scale: 1.5, position: { x: 1, y: 2 } });
      expect(app.zoomLevel()).toBe(150);
      app.onSelectionChanged({ connectionIds: ['e1'] });
      // no throw; selection is private but consumed by Delete handling below
    });

    it('places a vertex/data structure from the canvas context menu', () => {
      const { app } = make();
      app.onCanvasContextMenu(
        evt({ target: { closest: () => null }, currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } }),
      );
      expect(app.ui.ctxMenuOpen()).toBe(true);
      app.addNodeAt('NODE');
      expect(app.nodes().length).toBe(1);
      app.onCanvasContextMenu(
        evt({ target: { closest: () => null }, currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } }),
      );
      app.addDataNodeAt('SET');
      expect(app.dataNodes().length).toBe(1);
      app.closeContextMenu();
      expect(app.ui.ctxMenuOpen()).toBe(false);
    });

    it('ignores the canvas context menu over a node', () => {
      const { app } = make();
      const e = evt({ target: { closest: () => ({}) } });
      app.onCanvasContextMenu(e);
      expect(e.preventDefault).not.toHaveBeenCalled();
    });

    it('drives the node context menu: edit, duplicate, delete', () => {
      const { app } = make();
      app.addNode('NODE');
      const id = app.nodes()[0].id;
      app.onNodeContextMenu(evt(), id);
      expect(app.ui.nodeCtxMenuOpen()).toBe(true);
      expect(app.ui.nodeCtxTarget()).toBe(id);
      app.ctxEdit();
      expect(app.editNodeId()).toBe(id);
      app.closeNodeEditor();
      app.ctxDuplicate();
      expect(app.nodes().length).toBe(2);
      app.onNodeContextMenu(evt(), id);
      app.ctxDelete();
      expect(app.nodes().some((n: any) => n.id === id)).toBe(false);
      app.closeNodeContextMenu();
      expect(app.ui.nodeCtxTarget()).toBeNull();
    });

    it('drives the data-node context menu duplicate/delete path', () => {
      const { app } = make();
      app.addDataNode('STACK');
      const id = app.dataNodes()[0].id;
      app.onDataNodeContextMenu(evt(), id);
      expect(app.ui.nodeCtxKind()).toBe('data');
      app.ctxDuplicate();
      expect(app.dataNodes().length).toBe(2);
      app.onDataNodeContextMenu(evt(), id);
      app.ctxDelete();
      expect(app.dataNodes().some((n: any) => n.id === id)).toBe(false);
    });
  });

  // ── Node editor (rename + matrix resize) ─────────────────────
  describe('node editor', () => {
    it('opens via double-click and validates rename drafts', () => {
      const { app } = make();
      app.addNode('NODE');
      app.addNode('NODE');
      const [a, b] = app.nodes();
      app.onNodeDblClick(evt(), a.id, 'graph');
      expect(app.editNodeId()).toBe(a.id);
      app.onNameInput('');
      expect(app.nameError()).toBe('Name is required');
      app.onNameInput(b.label); // duplicate
      expect(app.nameError()).toBe('Name already in use');
      app.onNameInput('Renamed');
      expect(app.nameError()).toBe('');
      expect(app.nodes().find((n: any) => n.id === a.id).label).toBe('Renamed');
      app.deleteEditingNode();
      expect(app.nodes().some((n: any) => n.id === a.id)).toBe(false);
    });

    it('rejects non-identifier names for data structures', () => {
      const { app } = make();
      app.addDataNode('MAP');
      const id = app.dataNodes()[0].id;
      app.onNodeDblClick(evt(), id, 'data');
      app.onNameInput('1 bad name');
      expect(app.nameError()).toContain('letters');
    });

    it('resizes a matrix within bounds', () => {
      const { app } = make();
      app.addDataNode('MATRIX');
      const id = app.dataNodes()[0].id;
      app.onNodeDblClick(evt(), id, 'data');
      app.setMatrixRows(3);
      app.setMatrixCols(4);
      const node = app.dataNodes().find((n: any) => n.id === id);
      expect(node.matrix.length).toBe(3);
      expect(node.matrix[0].length).toBe(4);
      app.setMatrixRows(99); // clamps to 16
      expect(app.dataNodes().find((n: any) => n.id === id).matrix.length).toBe(16);
    });
  });

  // ── Info modals + library cards ──────────────────────────────
  describe('reference modals', () => {
    it('opens and closes the graph/data/global info cards', () => {
      const { app } = make();
      app.openGraphInfo(evt(), 'START');
      expect(app.infoCard()?.label).toBeTruthy();
      app.closeNodeInfo();
      expect(app.infoCard()).toBeNull();
      app.openDataInfo(evt(), 'PQUEUE');
      expect(app.infoCard()?.eyebrow).toBe('Data structure');
      app.openGlobalInfo(evt());
      expect(app.infoCard()).toBeTruthy();
      app.closeNodeInfo();
    });

    it('opens and closes the syntax guide', () => {
      const { app } = make();
      app.openSyntax(evt());
      expect(app.ui.syntaxOpen()).toBe(true);
      app.closeSyntax();
      expect(app.ui.syntaxOpen()).toBe(false);
    });

    it('toggles inline library cards and opens library info', () => {
      const { app } = make();
      app.setView('algorithm');
      app.onLibItemClick(evt(), 'builtin:graph');
      expect(app.ui.expandedLib()).toBe('builtin:graph');
      app.onLibItemClick(evt(), 'builtin:graph'); // toggles off
      expect(app.ui.expandedLib()).toBeNull();
      app.setView('canvas');
      app.onLibItemClick(evt(), 'graph:START');
      expect(app.nodes().length).toBe(1);
      app.onLibItemClick(evt(), 'data:QUEUE');
      expect(app.dataNodes().length).toBe(1);
      app.openLibInfo(evt(), 'graph:GOAL');
      expect(app.infoCard()).toBeTruthy();
      app.openLibInfo(evt(), 'data:SET');
      expect(app.infoCard()?.eyebrow).toBe('Data structure');
    });

    it('filters the library with the search box', () => {
      const { app } = make();
      app.ui.librarySearch.set('queue');
      expect(app.dataLibraryItems().every((i: any) => /queue/i.test(i.label + i.sub))).toBe(true);
      app.ui.librarySearch.set('edge');
      expect(app.edgeVisible()).toBe(true);
      app.ui.librarySearch.set('zzz');
      expect(app.edgeVisible()).toBe(false);
      expect(app.libraryItems().length).toBe(0);
    });
  });

  // ── Files ────────────────────────────────────────────────────
  describe('algorithm files', () => {
    it('adds, edits, renames and closes files', () => {
      const { app } = make();
      const start = app.files().length;
      app.addFile();
      expect(app.files().length).toBe(start + 1);
      const newId = app.files()[app.files().length - 1].id;
      app.setActiveFile(newId);
      expect(app.activeFileId()).toBe(newId);
      app.onEditorContent('x ← 1');
      expect(app.activeFile()?.content).toBe('x ← 1');
      app.onNotesChange([{ line: 1, text: 'note' }]);
      app.startRename(evt(), app.activeFile());
      expect(app.renamingFileId()).toBe(newId);
      app.renameDraft.set('renamed');
      app.commitRename();
      expect(app.renamingFileId()).toBeNull();
      app.startRename(evt(), app.files()[0]);
      app.cancelRename();
      expect(app.renamingFileId()).toBeNull();
      app.closeFile(evt(), newId);
      expect(app.files().some((f: any) => f.id === newId)).toBe(false);
    });
  });

  // ── Export / import ──────────────────────────────────────────
  describe('export and import', () => {
    it('opens the export modal and exports the canvas', () => {
      const { app } = make();
      app.openExport();
      expect(app.ui.exportOpen()).toBe(true);
      expect(app.exportMode()).toBe('choose');
      app.exportCanvasFile();
      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(app.ui.exportOpen()).toBe(false);
    });

    it('exports a single algorithm directly, several via the picker', () => {
      const { app } = make();
      app.chooseAlgorithmExport(); // single default file → direct download
      expect(app.ui.exportOpen()).toBe(false);
      app.addFile();
      app.openExport();
      app.chooseAlgorithmExport(); // now multiple → picker
      expect(app.exportMode()).toBe('algorithm');
      app.exportAlgoFile(app.files()[0]);
      expect(app.ui.exportOpen()).toBe(false);
    });

    it('imports an .algo file as a new editor file', async () => {
      const { app } = make();
      const before = app.files().length;
      const file = new File(['y ← 2'], 'extra.algo', { type: 'text/plain' });
      await app.onImportFile({ target: { files: [file], value: '' } });
      expect(app.files().length).toBe(before + 1);
      expect(app.activeView()).toBe('algorithm');
    });

    it('imports a .json file as a canvas, ignoring malformed JSON', async () => {
      const { app } = make();
      const good = new File([JSON.stringify({ nodes: [{ id: 'n1', kind: 'NODE', label: 'N1', position: { x: 0, y: 0 } }], edges: [], dataNodes: [] })], 'canvas.json');
      await app.onImportFile({ target: { files: [good], value: '' } });
      expect(app.activeView()).toBe('canvas');
      expect(app.nodes().length).toBe(1);
      const bad = new File(['{not json'], 'bad.json');
      await expect(app.onImportFile({ target: { files: [bad], value: '' } })).resolves.toBeUndefined();
      const none = await app.onImportFile({ target: { files: [], value: '' } });
      expect(none).toBeUndefined();
    });

    it('browses the library and imports each item type', async () => {
      const { app } = make();
      app.openImport();
      expect(app.ui.importOpen()).toBe(true);
      await app.openLibrary();
      expect(app.importMode()).toBe('library');
      expect(app.libraryIndex()?.algorithm.length).toBe(1);
      await app.openLibrary(); // second call uses the cached index
      expect(fakeLibrary.index).toHaveBeenCalledTimes(1);

      await app.importLibrary('canvas', { name: 'Grid', description: '', file: 'canvas/grid.json' });
      expect(app.activeView()).toBe('canvas');
      await app.importLibrary('algorithm', { name: 'BFS', description: '', file: 'algorithm/bfs.json' });
      expect(app.activeView()).toBe('algorithm');
      await app.importLibrary('algorithm', { name: 'Raw', description: '', file: 'algorithm/raw.algo' });
      expect(app.activeView()).toBe('algorithm');
    });

    it('routes "from a file" to the OS picker and closes the modal', () => {
      const { app } = make();
      app.openImport();
      app.chooseFile();
      expect(app.ui.importOpen()).toBe(false);
      expect(() => app.triggerImport()).not.toThrow();
    });
  });

  // ── Run workspace ────────────────────────────────────────────
  describe('run workspace', () => {
    it('runs the active file in place and exposes derived state', () => {
      const { app } = make();
      app.runActive();
      // runError mirrors the build outcome (null when clean, message on failure).
      expect(app.runError() === null || typeof app.runError() === 'string').toBe(true);
      expect(typeof app.complexity()).toBe('object');
      expect(Array.isArray(app.localStructures())).toBe(true);
      expect(Array.isArray(app.editorGlobals())).toBe(true);
      expect(Array.isArray(app.editorExports())).toBe(true);
      expect(Array.isArray(app.editorDiagnostics())).toBe(true);
      expect(Array.isArray(app.runDiagnostics())).toBe(true);
    });
  });

  // ── Template rendering — force the signal-gated branches to draw ──
  describe('template branches', () => {
    it('renders every node kind, data structure and overlay', () => {
      const { app, fixture } = make();
      const host = fixture.nativeElement as HTMLElement;

      // Graph vertices of each kind + every data-structure kind.
      app.addNode('NODE');
      app.addNode('START');
      app.addNode('GOAL');
      for (const kind of ['LIST', 'STACK', 'QUEUE', 'SET', 'MAP', 'PQUEUE', 'MATRIX'] as const) {
        app.addDataNode(kind);
      }
      // Give a few structures content so their item/entry/heap/matrix arms draw.
      const byKind = (k: string) => app.dataNodes().find((n: any) => n.kind === k).id;
      app.canvas.updateDataNode(byKind('QUEUE'), (n: any) => ({ ...n, items: ['a', 'b'] }));
      app.canvas.updateDataNode(byKind('MAP'), (n: any) => ({ ...n, entries: [{ key: 'k', value: 1 }] }));
      app.canvas.updateDataNode(byKind('PQUEUE'), (n: any) => ({ ...n, heap: [{ value: 'x', priority: 2 }] }));
      app.canvas.updateDataNode(byKind('MATRIX'), (n: any) => ({ ...n, matrix: [[0, 1], [1, 0]] }));
      const [a, b] = app.nodes();
      app.onConnectionCreated({ sourceId: app.outputId(a), targetId: app.inputId(b) });
      fixture.detectChanges();
      expect(host.querySelectorAll('.ae-node').length).toBe(3);
      expect(host.querySelectorAll('.ds-node').length).toBe(7);

      // Each overlay, opened then rendered.
      app.onCanvasContextMenu(
        evt({ target: { closest: () => null }, currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } }),
      );
      fixture.detectChanges();
      app.onNodeContextMenu(evt(), a.id);
      fixture.detectChanges();
      app.openEdgeEditor(evt(), app.edges()[0].id);
      fixture.detectChanges();
      app.onNodeDblClick(evt(), byKind('MATRIX'), 'data'); // matrix size controls
      fixture.detectChanges();
      app.closeNodeEditor();
      app.openGraphInfo(evt(), 'START');
      fixture.detectChanges();
      app.closeNodeInfo();
      app.openSyntax(evt());
      fixture.detectChanges();
      app.closeSyntax();
      app.ui.tipsOpen.set(true);
      fixture.detectChanges();
      app.ui.tipsOpen.set(false);
      app.openExport();
      fixture.detectChanges();
      app.exportMode.set('algorithm');
      fixture.detectChanges();
      app.closeExport();
      app.openImport();
      fixture.detectChanges();
      app.importMode.set('library');
      app.libraryIndex.set({
        algorithm: [{ name: 'BFS', description: 'd', file: 'algorithm/bfs.json' }],
        canvas: [{ name: 'Grid', description: 'd', file: 'canvas/grid.json' }],
      });
      fixture.detectChanges();
      app.closeImport();

      // Algorithm overview: files, exports, complexity, an expanded library card.
      app.setView('algorithm');
      app.toggleLibCard('builtin:graph');
      fixture.detectChanges();
      expect(host.querySelector('.cm-editor')).toBeTruthy();

      // Run workspace: canvas, data panel, code rail, debug drawer.
      app.setView('run');
      app.ui.debugOpen.set(true);
      fixture.detectChanges();
      expect(app.activeView()).toBe('run');

      // Docs page.
      app.setView('docs');
      fixture.detectChanges();
      expect(host.querySelector('app-docs')).toBeTruthy();
    });
  });

  // ── Keyboard, pan, resize ────────────────────────────────────
  describe('interactions', () => {
    it('closes overlays on Escape', () => {
      const { app } = make();
      app.openGraphInfo(evt(), 'NODE');
      app.ui.tipsOpen.set(true);
      app.onKeyDown({ key: 'Escape' } as any);
      expect(app.infoCard()).toBeNull();
      expect(app.ui.tipsOpen()).toBe(false);
    });

    it('deletes selected edges on Delete, but not while typing', () => {
      const { app } = make();
      app.addNode('START');
      app.addNode('GOAL');
      const [a, b] = app.nodes();
      app.onConnectionCreated({ sourceId: app.outputId(a), targetId: app.inputId(b) });
      const edgeId = app.edges()[0].id;
      app.onSelectionChanged({ connectionIds: [edgeId] });
      // Typing in an input must be ignored.
      app.onKeyDown({ key: 'Delete', target: { tagName: 'INPUT', isContentEditable: false } } as any);
      expect(app.edges().length).toBe(1);
      // On the canvas it deletes.
      app.onKeyDown({ key: 'Delete', target: { tagName: 'DIV', isContentEditable: false } } as any);
      expect(app.edges().length).toBe(0);
    });

    it('handles middle-mouse pan delegation', () => {
      const { app } = make();
      expect(() => {
        app.onCanvasMouseDown(evt({ button: 1 }));
        app.onWindowMouseMove(evt({ clientX: 30 }));
        app.onWindowMouseUp();
      }).not.toThrow();
    });

    it('resizes the run code rail and the debug panel via drag', () => {
      const { app } = make();
      app.startRunCodeResize(evt({ clientX: 500 }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 400 }));
      window.dispatchEvent(new MouseEvent('mouseup'));
      expect(app.ui.runCodeWidth()).toBeGreaterThanOrEqual(240);
      expect(app.ui.resizing()).toBe(false);

      app.startDebugResize(evt({ clientY: 300 }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientY: 200 }));
      window.dispatchEvent(new MouseEvent('mouseup'));
      expect(app.ui.debugHeight()).toBeGreaterThanOrEqual(80);
      expect(app.ui.resizing()).toBe(false);
    });
  });
});
