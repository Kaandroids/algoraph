import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
  type WritableSignal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import {
  EFConnectionType,
  EFMarkerType,
  FCanvasComponent,
  FCanvasChangeEvent,
  FCreateConnectionEvent,
  FFlowModule,
  FMoveNodesEvent,
  FSelectionChangeEvent,
} from '@foblex/flow';
import { IconComponent } from './shared/icon.component';
import { CodeEditorComponent } from './editor/code-editor.component';
import { DocsComponent } from './docs/docs.component';
import { type DocAction } from './docs/docs-content';
import { type EditorGlobal } from './editor/dsl';
import { type EditorDiagnostic } from './editor/diagnostics';
import { type LineNote } from './editor/line-notes';
import { API_GROUP, buildEditorGlobals } from './editor/editor-globals';
import { downloadJson, downloadText, readFileAsText } from './shared/file-transfer';
import { CanvasViewport } from './canvas-viewport';
import {
  ApiGroup,
  DATA_STRUCTURE_API,
  EDGE_API,
  GRAPH_NODE_API,
  GLOBAL_REFERENCE,
} from './node-api';
import { type AlgoFile } from './models/algo-file.model';
import { type ExportRef } from './models/exports';
import { compile } from './lang/compile';
import { estimateComplexity } from './lang/complexity';
import { collectLocalStructures, type LocalStructure } from './lang/locals';
import { SYNTAX_GUIDE } from './models/syntax-guide';
import { FilesStore } from './stores/files.store';
import { CanvasStore } from './stores/canvas.store';
import { RunStore } from './stores/run.store';
import { LibraryStore, type LibraryEntry, type LibraryIndex } from './stores/library.store';
import {
  DATA_PALETTE,
  DATA_STRUCTURES,
  dataSize,
  type DataNode,
  type DataPaletteItem,
  type DataStructureKind,
  type HeapEntry,
} from './models/data-structure.model';
import {
  GRAPH_PALETTE,
  nodeColor,
  nodeIcon,
  nodeTypeLabel,
  type GEdge,
  type GNode,
  type NodeKind,
  type PaletteItem,
} from './models/graph.model';

/** View model for the info modal — shared by graph nodes and data structures. */
interface NodeInfo {
  eyebrow: string;
  label: string;
  icon: string;
  color: string;
  description: string;
  groups: ApiGroup[];
}

/** The collapsible inspector rails, keyed for the shared `#railHead` chrome. */
type InspectorRail = 'code' | 'data' | 'runcode';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FFlowModule, IconComponent, CodeEditorComponent, DocsComponent, NgTemplateOutlet],
  templateUrl: './app.html',
  styleUrls: ['./app.scss', './editor-chrome.scss', './editor-nodes.scss', './data-nodes.scss'],
})
export class App {
  private readonly elRef = inject(ElementRef);
  /** The canvas model (graph + data structures) lives in its own store; this component is a facade. */
  protected readonly canvas = inject(CanvasStore);
  /** Algorithm files live in their own store; this component is a thin facade over it. */
  protected readonly fileStore = inject(FilesStore);
  /** Step-by-step execution state for the Run workspace. */
  protected readonly run = inject(RunStore);
  /** The bundled library of ready-made algorithms and canvases. */
  private readonly library = inject(LibraryStore);
  private readonly fCanvas = viewChild(FCanvasComponent);
  private readonly importInput = viewChild<ElementRef<HTMLInputElement>>('importInput');
  private readonly renameInput = viewChild<ElementRef<HTMLInputElement>>('renameInput');

  /** Camera control (zoom, pan, run scroll-follow) — the imperative Foblex/DOM work. */
  private readonly viewport = new CanvasViewport(this.elRef.nativeElement, () => this.fCanvas());

  /** Focus & select the rename field when a file tab enters rename mode. */
  private readonly focusRename = effect(() => {
    if (this.renamingFileId()) {
      const el = this.renameInput()?.nativeElement;
      if (el) {
        el.focus();
        el.select();
      }
    }
  });

  readonly EFConnectionType = EFConnectionType;
  readonly EFMarkerType = EFMarkerType;

  protected readonly title = signal('Algoraph');

  /** Which workspace is showing — graph builder, algorithm editor, step-by-step run, or the docs guide. */
  protected readonly activeView = signal<'canvas' | 'algorithm' | 'run' | 'docs'>('canvas');

  /** Compile + run the algorithm afresh each time the Run workspace is opened. */
  private readonly autoBuild = effect(() => {
    if (this.activeView() === 'run') untracked(() => this.run.build());
  });

  /** Error from the last Run-button press, shown in the algorithm overview (null = clean). */
  protected readonly runError = signal<string | null>(null);

  /** A run error is stale once the code changes — clear it on the next recompile. */
  private readonly clearRunError = effect(() => {
    this.activeFileId();
    this.compiled();
    untracked(() => this.runError.set(null));
  });

  /**
   * Pan the Run canvas when the algorithm calls `scrollTo(…)` on a step — to a
   * single vertex, or to the midpoint of an edge. The imperative work lives in
   * the viewport controller; the effect just reacts to the new target.
   */
  private readonly followScroll = effect(() => {
    const target = this.run.effects().scrollTo;
    if (!target || untracked(() => this.activeView()) !== 'run') return;
    untracked(() => this.viewport.followScroll(target, this.run.animMs(), this.edges()));
  });

  /**
   * Place the iteration popup beside the loop's `for each` line (fixed there for
   * the loop's whole run — it does not follow the active line down into the body)
   * and keep its current row in view. Anchors vertically to that source line in
   * the code rail; falls back to centred when it can't be measured (e.g. the code
   * rail is collapsed). Scrolls only the popup list, never the page.
   */
  private readonly placeLoopPopup = effect(() => {
    const lp = this.run.loop();
    if (!lp || untracked(() => this.activeView()) !== 'run') return;
    untracked(() => {
      requestAnimationFrame(() => {
        const stage = this.elRef.nativeElement.querySelector('.ag-runstage') as HTMLElement | null;
        const pop = this.elRef.nativeElement.querySelector('.ag-loop-pop') as HTMLElement | null;
        if (!stage || !pop) return;

        // Anchor to the `for each` line itself (1-based → nth rendered code line).
        const lines = this.elRef.nativeElement.querySelectorAll('.ag-runcode-rail .cm-line');
        const lineEl = lines[lp.line - 1] as HTMLElement | undefined;
        if (lineEl) {
          const s = stage.getBoundingClientRect();
          const l = lineEl.getBoundingClientRect();
          const half = pop.offsetHeight / 2;
          const y = Math.max(half + 8, Math.min(s.height - half - 8, l.top + l.height / 2 - s.top));
          pop.style.setProperty('--loop-top', `${y}px`);
        } else {
          pop.style.removeProperty('--loop-top');
        }

        // Keep the current row centred within the popup list.
        const list = pop.querySelector('.ag-loop-pop-list') as HTMLElement | null;
        const row = list?.querySelector('.ag-loop-pop-row.is-current') as HTMLElement | null;
        if (list && row) {
          list.scrollTo({ top: row.offsetTop - list.clientHeight / 2 + row.clientHeight / 2, behavior: 'smooth' });
        }
      });
    });
  });

  /** In algorithm mode, which library item's inline reference card is open (`graph:KIND` / `data:KIND`). */
  protected readonly expandedLib = signal<string | null>(null);

  // ── Algorithm source files (owned by FilesStore; re-exposed for the template) ──
  protected readonly files = this.fileStore.files;
  protected readonly activeFileId = this.fileStore.activeId;
  protected readonly renamingFileId = this.fileStore.renamingId;
  protected readonly renameDraft = this.fileStore.renameDraft;
  protected readonly activeFile = this.fileStore.active;
  protected readonly activeLineCount = this.fileStore.activeLineCount;
  protected readonly activeFileNotes = this.fileStore.activeNotes;

  /** Parsed + resolved program — shared by the export list and the complexity estimate. */
  private readonly compiled = computed(() => compile(this.files()));

  /** Exported helpers across all files — listed in the overview and offered in autocomplete. */
  protected readonly editorExports = computed<ExportRef[]>(() => this.compiled().exports);

  /** Compiler diagnostics for the active file — underlined in the editor. */
  protected readonly editorDiagnostics = computed<EditorDiagnostic[]>(() =>
    this.compiled()
      .diagnostics.filter((d) => d.fileId === this.activeFileId())
      .map((d) => ({ line: d.line, severity: d.severity, message: d.message })),
  );

  /** Diagnostics for the file the Run workspace is showing (read-only rail). */
  protected readonly runDiagnostics = computed<EditorDiagnostic[]>(() =>
    this.compiled()
      .diagnostics.filter((d) => d.fileId === this.run.entryFile()?.id)
      .map((d) => ({ line: d.line, severity: d.severity, message: d.message })),
  );

  /**
   * Run the file open in the editor in place — compile + execute it without
   * leaving the editor. On an error (compile or runtime) surface it below the
   * Run button; on success it just runs (debug output comes later).
   */
  runActive(): void {
    this.run.entryId.set(this.activeFileId());
    this.run.build(); // compile + run now
    this.runError.set(this.run.error()); // null when clean, message on failure
    if (this.run.debug().length) this.debugOpen.set(true); // surface fresh printDebug output
  }

  /** Estimated Big-O of the entry algorithm, shown in the overview's Complexity card. */
  protected readonly complexity = computed(() => {
    const program = this.compiled();
    const dsKinds = new Map(this.dataNodes().map((d) => [d.label, d.kind] as const));
    return estimateComplexity(
      program.modules.find((m) => m.fileId === 'main'),
      program.functions,
      dsKinds,
    );
  });

  /**
   * Data structures the active file's run creates (static reachability scan) —
   * shown in the overview's "Local" section and offered in autocomplete.
   */
  protected readonly localStructures = computed<LocalStructure[]>(() => {
    const compiled = this.compiled();
    const module = compiled.modules.find((m) => m.fileId === this.activeFileId());
    return module ? collectLocalStructures(module, compiled.functions) : [];
  });

  /** Names in scope for the editor's autocomplete — the graph, the canvas, and data structures. */
  protected readonly editorGlobals = computed<EditorGlobal[]>(() =>
    buildEditorGlobals(this.dataNodes(), this.localStructures()),
  );

  // ── Node palette (tool library rail) ──────────────────────
  protected readonly palette: PaletteItem[] = GRAPH_PALETTE;

  // ── Data-structure palette (display-only state nodes) ─────
  protected readonly dataPalette: DataPaletteItem[] = DATA_PALETTE;

  /**
   * Algorithm-only library entries — built-in globals (`graph`, `canvas`), not
   * addable blocks. Clicking one opens its reference card; nothing is placed.
   */
  protected readonly builtinLibItems: {
    key: string;
    label: string;
    sub: string;
    icon: string;
    color: string;
    description: string;
    groups: ApiGroup[];
  }[] = [
    {
      key: 'graph',
      label: 'Graph',
      sub: 'Vertices, edges & queries',
      icon: 'workflow',
      color: 'oklch(0.58 0.13 65)',
      description:
        'The graph built on the canvas — query its vertices and edges as the algorithm explores them.',
      groups: GLOBAL_REFERENCE.groups.filter((g) => g.title === API_GROUP.graph),
    },
    {
      key: 'canvas',
      label: 'Canvas',
      sub: 'Highlight, build & edit',
      icon: 'maximize',
      color: 'oklch(0.6 0.17 290)',
      description:
        'The drawing surface — highlight vertices and edges, and create or delete graph parts and ' +
        'data structures from code (saveCanvas to keep the changes).',
      groups: GLOBAL_REFERENCE.groups.filter(
        (g) => g.title === API_GROUP.visualization || g.title === API_GROUP.canvasEditing,
      ),
    },
    {
      key: 'scratch',
      label: 'Scratch',
      sub: 'Hidden working structures',
      icon: 'eyeOff',
      color: 'oklch(0.6 0.06 230)',
      description:
        'Off-canvas data structures for an algorithm\'s private bookkeeping — created with ' +
        'scratch.createMap(), scratch.createQueue(), and friends. They behave like any structure ' +
        'but are never drawn on the canvas or shown in the run data panel.',
      groups: GLOBAL_REFERENCE.groups.filter((g) => g.title === API_GROUP.scratch),
    },
    {
      key: 'panel',
      label: 'Panel',
      sub: 'Off-canvas, watchable',
      icon: 'panelRight',
      color: 'oklch(0.62 0.1 160)',
      description:
        'Data structures that stay off the canvas but still appear in the run data panel — ' +
        'created with panel.createMap(), panel.createQueue(), and friends. Use them to watch an ' +
        'algorithm\'s bookkeeping step by step without cluttering the drawing.',
      groups: GLOBAL_REFERENCE.groups.filter((g) => g.title === API_GROUP.panel),
    },
  ];

  /** Edge reference card in the Graph library section (not addable — edges are made by linking ports). */
  protected readonly edgeLibItem = {
    label: 'Edge',
    sub: 'A weighted link',
    icon: 'link',
    color: 'oklch(0.55 0.04 250)',
    description:
      'A connection between two vertices. Iterate the graph\'s edges with edges(), then read each one\'s ' +
      'endpoints, weight and direction.',
    groups: EDGE_API,
  };
  /** Whether the Edge reference shows under the current library search. */
  protected readonly edgeVisible = computed(() => {
    const q = this.librarySearch().trim().toLowerCase();
    return !q || 'edge'.includes(q);
  });

  // ── Canvas state — re-exposed from CanvasStore (facade) ───
  protected readonly nodes = this.canvas.nodes;
  protected readonly edges = this.canvas.edges;
  protected readonly dataNodes = this.canvas.dataNodes;

  // Zoom % + pan-in-progress flag are owned by the viewport controller (facade).
  protected readonly zoomLevel = this.viewport.zoomLevel;
  protected readonly panning = this.viewport.panning;
  protected readonly railCollapsed = signal(false);
  protected readonly codeRailCollapsed = signal(false);
  protected readonly runDataCollapsed = signal(false);
  protected readonly runCodeCollapsed = signal(false);
  /** Width of the Run code rail (px), adjustable by dragging its left edge. */
  protected readonly runCodeWidth = signal(320);
  /** True while the user is dragging a panel's resize handle. */
  protected readonly resizing = signal(false);

  /** Whether the Algorithm view's bottom debug panel (printDebug output) is expanded. */
  protected readonly debugOpen = signal(false);
  /** Height (px) of the expanded debug panel — drag its top edge to resize. */
  protected readonly debugHeight = signal(180);
  protected readonly librarySearch = signal('');
  protected readonly tipsOpen = signal(false);
  private readonly selectedConnectionIds = signal<string[]>([]);

  // Context menus
  protected readonly ctxMenuOpen = signal(false);
  protected readonly ctxMenuPos = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  protected readonly nodeCtxMenuOpen = signal(false);
  protected readonly nodeCtxMenuPos = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  protected readonly nodeCtxTarget = signal<string | null>(null);
  /** Whether the open node context menu targets a graph vertex or a data-structure node. */
  protected readonly nodeCtxKind = signal<'graph' | 'data'>('graph');

  // Edge editor (weight + direction)
  protected readonly editEdgeId = signal<string | null>(null);
  protected readonly editPos = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  protected readonly editingEdge = computed(() => this.edges().find((e) => e.id === this.editEdgeId()) ?? null);

  // Node editor (rename for every node + contents for data-structure nodes)
  protected readonly editNodeId = signal<string | null>(null);
  protected readonly editNodeKind = signal<'graph' | 'data'>('graph');
  protected readonly editNodePos = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  /** Live text of the name field — kept separate from the model so an invalid draft isn't reset. */
  protected readonly nameDraft = signal('');
  protected readonly editingDataNode = computed(
    () => this.dataNodes().find((n) => n.id === this.editNodeId()) ?? null,
  );
  /** Empty when the drafted name is valid; otherwise the reason it can't be applied. */
  protected readonly nameError = computed(() => {
    const id = this.editNodeId();
    if (!id) return '';
    const name = this.nameDraft().trim();
    if (!name) return 'Name is required';
    // Data structures are referenced by name in code, so they must be valid identifiers.
    if (this.editNodeKind() === 'data' && !/^[A-Za-z_]\w*$/.test(name)) {
      return 'Use letters, digits, _ — no spaces or symbols';
    }
    if (this.canvas.usedNames(id).has(name.toLowerCase())) return 'Name already in use';
    return '';
  });

  // Info modal — graph node / data-structure reference (description, methods next)
  protected readonly infoCard = signal<NodeInfo | null>(null);

  // Syntax-guide modal — DSL reference with worked examples, opened from the library rail.
  protected readonly syntaxGuide = SYNTAX_GUIDE;
  protected readonly syntaxOpen = signal(false);

  private ctxCanvasPos = { x: 0, y: 0 };

  // ── Foblex triggers ───────────────────────────────────────
  /** Left-drag on empty canvas pans (Figma-style). */
  protected readonly canvasMoveTrigger = (_event: MouseEvent | TouchEvent): boolean => true;
  /** Only zoom on wheel when pinching / Ctrl(⌘)+wheel; a plain wheel is left alone. */
  protected readonly zoomOnPinch = (event: MouseEvent | TouchEvent | WheelEvent): boolean =>
    (event as MouseEvent).ctrlKey || (event as MouseEvent).metaKey;

  // ── Derived ───────────────────────────────────────────────
  protected readonly libraryItems = computed(() => {
    const q = this.librarySearch().trim().toLowerCase();
    if (!q) return this.palette;
    return this.palette.filter((i) => i.label.toLowerCase().includes(q) || i.sub.toLowerCase().includes(q));
  });

  protected readonly dataLibraryItems = computed(() => {
    const q = this.librarySearch().trim().toLowerCase();
    if (!q) return this.dataPalette;
    return this.dataPalette.filter((i) => i.label.toLowerCase().includes(q) || i.sub.toLowerCase().includes(q));
  });

  // ── Node helpers ──────────────────────────────────────────
  outputId(node: GNode): string {
    return `${node.id}-out`;
  }
  inputId(node: GNode): string {
    return `${node.id}-in`;
  }
  /** Template hooks for the per-kind vertex appearance (defined in the model). */
  protected readonly nodeIcon = nodeIcon;
  protected readonly nodeColor = nodeColor;
  protected readonly nodeTypeLabel = nodeTypeLabel;

  // ── Data-structure node helpers ───────────────────────────
  dataIcon(kind: DataStructureKind): string {
    return DATA_STRUCTURES[kind].icon;
  }
  dataColor(kind: DataStructureKind): string {
    return DATA_STRUCTURES[kind].color;
  }
  dataTypeLabel(kind: DataStructureKind): string {
    return DATA_STRUCTURES[kind].tag;
  }
  /** Template hooks for the data-structure presentation helpers (defined in the model). */
  protected readonly dataSizeLabel = dataSize;
  /** Stacks grow upward, so render the top (last pushed) element first. */
  reversed(items: (string | number)[]): (string | number)[] {
    return [...items].reverse();
  }
  /** Priority queues are displayed lowest-priority-first regardless of edit order. */
  sortedHeap(node: { heap: HeapEntry[] }): HeapEntry[] {
    return [...node.heap].sort((a, b) => a.priority - b.priority);
  }
  /** `[0, 1, …, n-1]` — used to render matrix index headers. */
  range(n: number): number[] {
    return Array.from({ length: n }, (_, i) => i);
  }

  // ── Node operations — delegated to CanvasStore ────────────
  addNode(kind: NodeKind): void {
    this.canvas.addNode(kind);
  }

  deleteNode(nodeId: string): void {
    this.canvas.deleteNode(nodeId);
  }

  // ── Data-structure node operations ────────────────────────
  addDataNode(kind: DataStructureKind): void {
    this.canvas.addDataNode(kind);
  }

  addDataNodeAt(kind: DataStructureKind): void {
    this.ctxMenuOpen.set(false);
    this.canvas.addDataNodeAt(kind, this.ctxCanvasPos);
  }

  deleteDataNode(nodeId: string): void {
    this.canvas.deleteDataNode(nodeId);
  }

  copyDataNode(nodeId: string): void {
    this.canvas.copyDataNode(nodeId);
    this.closeNodeContextMenu();
  }

  // ── Node editor (rename + data-structure contents) ────────
  private openNodeEditorAt(id: string, kind: 'graph' | 'data', pos: { x: number; y: number }): void {
    this.ctxMenuOpen.set(false);
    this.nodeCtxMenuOpen.set(false);
    this.closeEdgeEditor();
    const node =
      kind === 'data' ? this.dataNodes().find((n) => n.id === id) : this.nodes().find((n) => n.id === id);
    if (!node) return;
    this.editNodeKind.set(kind);
    this.editNodePos.set(pos);
    this.nameDraft.set(node.label);
    this.editNodeId.set(id);
  }

  onNodeDblClick(event: MouseEvent, id: string, kind: 'graph' | 'data'): void {
    event.preventDefault();
    event.stopPropagation();
    this.openNodeEditorAt(id, kind, { x: event.clientX, y: event.clientY });
  }

  /** Open the editor from the node context menu's Edit / Rename item. */
  ctxEdit(): void {
    const id = this.nodeCtxTarget();
    if (!id) return;
    this.openNodeEditorAt(id, this.nodeCtxKind(), this.nodeCtxMenuPos());
  }

  closeNodeEditor(): void {
    this.editNodeId.set(null);
  }

  /** Delete the node currently open in the editor (graph vertex or data structure). */
  deleteEditingNode(): void {
    const id = this.editNodeId();
    if (!id) return;
    if (this.editNodeKind() === 'data') this.deleteDataNode(id);
    else this.deleteNode(id);
    this.closeNodeEditor();
  }

  // ── Info modal (graph node / data-structure reference) ────
  openGraphInfo(event: Event, kind: NodeKind): void {
    const item = this.palette.find((p) => p.kind === kind);
    if (!item) return;
    this.showInfo(event, {
      eyebrow: 'Graph node',
      label: item.label,
      icon: item.icon,
      color: item.color,
      description: item.description,
      groups: GRAPH_NODE_API[kind],
    });
  }

  openDataInfo(event: Event, kind: DataStructureKind): void {
    const m = DATA_STRUCTURES[kind];
    this.showInfo(event, {
      eyebrow: 'Data structure',
      label: m.label,
      icon: m.icon,
      color: m.color,
      description: m.description,
      groups: DATA_STRUCTURE_API[kind],
    });
  }

  openGlobalInfo(event: Event): void {
    this.showInfo(event, { ...GLOBAL_REFERENCE });
  }

  private showInfo(event: Event, info: NodeInfo): void {
    event.preventDefault();
    event.stopPropagation();
    this.ctxMenuOpen.set(false);
    this.nodeCtxMenuOpen.set(false);
    this.closeNodeEditor();
    this.infoCard.set(info);
  }

  closeNodeInfo(): void {
    this.infoCard.set(null);
  }

  /** Open / close the pseudocode syntax-guide modal (library rail "?"). */
  openSyntax(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.syntaxOpen.set(true);
  }
  closeSyntax(): void {
    this.syntaxOpen.set(false);
  }

  /** Rename live; an empty or duplicate draft surfaces an error and leaves the model untouched. */
  onNameInput(value: string): void {
    this.nameDraft.set(value);
    if (this.nameError()) return;
    const id = this.editNodeId();
    if (!id) return;
    this.canvas.renameNode(id, this.editNodeKind(), value.trim());
  }

  private updateEditingData(change: (node: DataNode) => DataNode): void {
    const id = this.editNodeId();
    if (!id) return;
    this.canvas.updateDataNode(id, change);
  }

  // Matrix size — the one structural input; contents start empty and the
  // algorithm fills every structure at runtime, so there is no manual data entry.
  private resizeMatrix(rows: number, cols: number): void {
    const R = Math.max(1, Math.min(8, Math.round(rows || 1)));
    const C = Math.max(1, Math.min(8, Math.round(cols || 1)));
    this.updateEditingData((n) => ({
      ...n,
      matrix: Array.from({ length: R }, (_, r) => Array.from({ length: C }, (_, c) => n.matrix[r]?.[c] ?? 0)),
    }));
  }
  setMatrixRows(rows: number): void {
    const node = this.editingDataNode();
    if (node) this.resizeMatrix(rows, node.matrix[0]?.length ?? 1);
  }
  setMatrixCols(cols: number): void {
    const node = this.editingDataNode();
    if (node) this.resizeMatrix(node.matrix.length, cols);
  }

  // ── Foblex events ─────────────────────────────────────────
  onConnectionCreated(event: FCreateConnectionEvent): void {
    this.canvas.connect(event.sourceId, event.targetId);
  }

  // ── Edge editor (weight + direction) ──────────────────────
  openEdgeEditor(event: MouseEvent, edgeId: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.ctxMenuOpen.set(false);
    this.nodeCtxMenuOpen.set(false);
    this.editPos.set({ x: event.clientX, y: event.clientY });
    this.editEdgeId.set(edgeId);
  }

  closeEdgeEditor(): void {
    this.editEdgeId.set(null);
  }

  setEdgeWeight(edgeId: string, weight: number): void {
    this.canvas.setEdgeWeight(edgeId, weight);
  }

  setEdgeDirected(edgeId: string, directed: boolean): void {
    this.canvas.setEdgeDirected(edgeId, directed);
  }

  deleteEdge(edgeId: string): void {
    this.canvas.deleteEdge(edgeId);
    if (this.editEdgeId() === edgeId) this.closeEdgeEditor();
  }

  onSelectionChanged(event: FSelectionChangeEvent): void {
    this.selectedConnectionIds.set(event.connectionIds);
  }

  onNodeMoved(event: FMoveNodesEvent): void {
    this.canvas.moveNodes(event.nodes);
  }

  onCanvasChange(event: FCanvasChangeEvent): void {
    this.viewport.onCanvasChange(event.scale, event.position);
  }

  // ── Middle-mouse pan (delegated to the viewport controller) ──
  onCanvasMouseDown(event: MouseEvent): void {
    this.viewport.startPan(event);
  }

  @HostListener('window:mousemove', ['$event'])
  onWindowMouseMove(event: MouseEvent): void {
    this.viewport.movePan(event);
  }

  @HostListener('window:mouseup')
  onWindowMouseUp(): void {
    this.viewport.endPan();
  }

  // ── Context menus ─────────────────────────────────────────
  onCanvasContextMenu(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest('.ae-node, .ds-node')) return;
    event.preventDefault();
    this.ctxMenuPos.set({ x: event.clientX, y: event.clientY });
    const wrap = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.ctxCanvasPos = this.viewport.toCanvasCoords(event.clientX, event.clientY, wrap);
    this.nodeCtxMenuOpen.set(false);
    this.ctxMenuOpen.set(true);
  }

  addNodeAt(kind: NodeKind): void {
    this.ctxMenuOpen.set(false);
    this.canvas.addNodeAt(kind, this.ctxCanvasPos);
  }

  closeContextMenu(): void {
    this.ctxMenuOpen.set(false);
  }

  onNodeContextMenu(event: MouseEvent, nodeId: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.ctxMenuOpen.set(false);
    this.nodeCtxMenuPos.set({ x: event.clientX, y: event.clientY });
    this.nodeCtxTarget.set(nodeId);
    this.nodeCtxKind.set('graph');
    this.nodeCtxMenuOpen.set(true);
  }

  onDataNodeContextMenu(event: MouseEvent, nodeId: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.ctxMenuOpen.set(false);
    this.nodeCtxMenuPos.set({ x: event.clientX, y: event.clientY });
    this.nodeCtxTarget.set(nodeId);
    this.nodeCtxKind.set('data');
    this.nodeCtxMenuOpen.set(true);
  }

  closeNodeContextMenu(): void {
    this.nodeCtxMenuOpen.set(false);
    this.nodeCtxTarget.set(null);
  }

  /** Duplicate / delete from the node context menu, routed to the right collection. */
  ctxDuplicate(): void {
    const id = this.nodeCtxTarget();
    if (!id) return;
    if (this.nodeCtxKind() === 'data') this.copyDataNode(id);
    else this.copyNode(id);
  }

  ctxDelete(): void {
    const id = this.nodeCtxTarget();
    if (!id) return;
    if (this.nodeCtxKind() === 'data') this.deleteDataNode(id);
    else this.deleteNode(id);
    this.closeNodeContextMenu();
  }

  copyNode(nodeId: string): void {
    this.canvas.copyNode(nodeId);
    this.closeNodeContextMenu();
  }

  // ── Keyboard ──────────────────────────────────────────────
  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.ctxMenuOpen.set(false);
      this.closeNodeContextMenu();
      this.closeEdgeEditor();
      this.closeNodeEditor();
      this.closeNodeInfo();
      this.closeSyntax();
      this.tipsOpen.set(false);
      return;
    }
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    const target = event.target as HTMLElement;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return;
    const connIds = this.selectedConnectionIds();
    if (connIds.length > 0) {
      this.canvas.deleteEdges(connIds);
      this.selectedConnectionIds.set([]);
    }
  }

  // ── Zoom controls (delegated to the viewport controller) ──
  zoomIn(): void {
    this.viewport.zoomIn();
  }
  zoomOut(): void {
    this.viewport.zoomOut();
  }
  resetZoom(): void {
    this.viewport.reset();
  }

  // ── Rails ─────────────────────────────────────────────────
  /** The library rail on the far left — collapsed independently of the inspectors. */
  toggleRail(): void {
    this.railCollapsed.update((v) => !v);
  }

  /**
   * Collapse signal for each inspector rail, keyed by the `#railHead` template.
   * `code` is shared by the Canvas and Algorithm overviews (only one shows at a time).
   */
  private readonly inspectorRails: Record<InspectorRail, WritableSignal<boolean>> = {
    code: this.codeRailCollapsed,
    data: this.runDataCollapsed,
    runcode: this.runCodeCollapsed,
  };

  /** Toggle one inspector rail by its key — drives the shared rail chrome. */
  toggleInspector(key: InspectorRail): void {
    this.inspectorRails[key].update((v) => !v);
  }

  /** Drag the Run code rail's left edge to grow/shrink it (clamped). It sits on the
   *  right, so dragging the edge left widens it — the delta is inverted. */
  startRunCodeResize(event: MouseEvent): void {
    event.preventDefault();
    const startX = event.clientX;
    const startW = this.runCodeWidth();
    const move = (e: MouseEvent) =>
      this.runCodeWidth.set(Math.max(240, Math.min(640, startW + (startX - e.clientX))));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      this.resizing.set(false);
    };
    this.resizing.set(true);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  /** Drag the debug panel's top edge to grow/shrink it. It sits at the bottom, so
   *  dragging the edge up widens it — the delta is inverted (clamped 80–500px). */
  startDebugResize(event: MouseEvent): void {
    event.preventDefault();
    const startY = event.clientY;
    const startH = this.debugHeight();
    const move = (e: MouseEvent) =>
      this.debugHeight.set(Math.max(80, Math.min(500, startH + (startY - e.clientY))));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      this.resizing.set(false);
    };
    this.resizing.set(true);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  // ── View switch (graph builder ↔ algorithm editor) ────────
  setView(view: 'canvas' | 'algorithm' | 'run' | 'docs'): void {
    this.activeView.set(view);
    this.expandedLib.set(null);
  }

  /** Toggle the inline reference card under a library item (algorithm mode). */
  toggleLibCard(key: string): void {
    this.expandedLib.update((cur) => (cur === key ? null : key));
  }
  graphGroups(kind: NodeKind): ApiGroup[] {
    return GRAPH_NODE_API[kind];
  }
  dataGroups(kind: DataStructureKind): ApiGroup[] {
    return DATA_STRUCTURE_API[kind];
  }

  /**
   * Library click. In builder (canvas) mode an addable item drops onto the
   * canvas; otherwise — algorithm mode, or a reference-only built-in — the
   * inline reference card toggles. The `key` (`graph:KIND` / `data:KIND` /
   * `builtin:NAME`) carries both the card identity and the dispatch target.
   */
  onLibItemClick(_event: Event, key: string): void {
    const [type, kind] = this.splitLibKey(key);
    if (this.activeView() === 'algorithm' || type === 'builtin') {
      this.toggleLibCard(key);
    } else if (type === 'graph') {
      this.addNode(kind as NodeKind);
    } else {
      this.addDataNode(kind as DataStructureKind);
    }
  }

  /** Open the reference modal for a library item (the builder-mode "?" button). */
  openLibInfo(event: Event, key: string): void {
    const [type, kind] = this.splitLibKey(key);
    if (type === 'graph') this.openGraphInfo(event, kind as NodeKind);
    else if (type === 'data') this.openDataInfo(event, kind as DataStructureKind);
  }

  /** Split a library key (`type:rest`) into its `[type, rest]` parts. */
  private splitLibKey(key: string): [string, string] {
    const i = key.indexOf(':');
    return [key.slice(0, i), key.slice(i + 1)];
  }

  // ── Algorithm files — thin delegations to FilesStore ──────
  setActiveFile(id: string): void {
    this.fileStore.setActive(id);
  }
  onEditorContent(text: string): void {
    this.fileStore.setContent(text);
  }
  onNotesChange(notes: LineNote[]): void {
    this.fileStore.setNotes(notes);
  }
  addFile(): void {
    this.fileStore.add();
  }
  closeFile(event: Event, id: string): void {
    this.fileStore.close(event, id);
  }
  startRename(event: Event, file: AlgoFile): void {
    this.fileStore.startRename(event, file);
  }
  commitRename(): void {
    this.fileStore.commitRename();
  }
  cancelRename(): void {
    this.fileStore.cancelRename();
  }

  // ── Canvas overview + import / export ─────────────────────
  /** Per-kind breakdown shown in the right-hand overview panel. */
  protected readonly canvasSummary = this.canvas.summary;

  // ── Export modal ──────────────────────────────────────────
  protected readonly exportOpen = signal(false);
  /** Which pane of the export modal is showing: the two choices, or the file picker. */
  protected readonly exportMode = signal<'choose' | 'algorithm'>('choose');

  /** Open the export modal at its choice screen (canvas vs. algorithm). */
  openExport(): void {
    this.exportMode.set('choose');
    this.exportOpen.set(true);
  }

  closeExport(): void {
    this.exportOpen.set(false);
  }

  /** Export the whole canvas (graph + data structures) as a JSON file. */
  exportCanvasFile(): void {
    downloadJson('algoraph-canvas.json', this.canvas.snapshot());
    this.closeExport();
  }

  /** Export an algorithm: with a single file, download it straight away; otherwise pick. */
  chooseAlgorithmExport(): void {
    const files = this.fileStore.files();
    if (files.length === 1) this.exportAlgoFile(files[0]);
    else this.exportMode.set('algorithm');
  }

  /** Download one algorithm file as `.algo`. */
  exportAlgoFile(file: AlgoFile): void {
    downloadText(file.name, file.content, 'text/plain;charset=utf-8');
    this.closeExport();
  }

  /** A short caption for an algorithm file in the export picker. */
  fileMeta(file: AlgoFile): string {
    const lines = file.content ? file.content.split('\n').length : 0;
    return file.id === 'main' ? `Entry file · ${lines} lines` : `${lines} lines`;
  }

  triggerImport(): void {
    this.importInput()?.nativeElement.click();
  }

  /** Open a file from the computer: a `.algo` becomes a new editor file, a `.json` loads the canvas. */
  async onImportFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // let the same file be re-imported later
    if (!file) return;
    const text = await readFileAsText(file);
    if (/\.algo$/i.test(file.name)) {
      this.fileStore.addFile(file.name, text);
      this.setView('algorithm');
    } else {
      try {
        this.canvas.load(JSON.parse(text));
        this.setView('canvas');
      } catch {
        // Invalid JSON — ignored for now (a toast can surface this later).
      }
    }
  }

  // ── Import modal ──────────────────────────────────────────
  protected readonly importOpen = signal(false);
  /** Which pane of the import modal is showing: the two choices, or the library browser. */
  protected readonly importMode = signal<'choose' | 'library'>('choose');
  protected readonly libraryIndex = signal<LibraryIndex | null>(null);

  /** Open the import modal at its choice screen (library vs. own file). */
  openImport(): void {
    this.importMode.set('choose');
    this.importOpen.set(true);
  }

  closeImport(): void {
    this.importOpen.set(false);
  }

  /** Switch to the library browser, lazily fetching the manifest the first time. */
  async openLibrary(): Promise<void> {
    this.importMode.set('library');
    if (!this.libraryIndex()) this.libraryIndex.set(await this.library.index());
  }

  /** "From a file" — hand off to the OS file picker. */
  chooseFile(): void {
    this.closeImport();
    this.triggerImport();
  }

  /**
   * Import a library item. A canvas loads onto the board. An algorithm is either
   * a single `.algo` (opened as one new file) or a `.json` bundle — the clean
   * entry plus its helper modules, with notes — which replaces the workspace.
   */
  async importLibrary(kind: 'algorithm' | 'canvas', item: LibraryEntry): Promise<void> {
    if (kind === 'canvas') {
      try {
        this.canvas.load(JSON.parse(await this.library.file(item.file)));
        this.setView('canvas');
      } catch {
        // Malformed library canvas — ignore (these are bundled, so this shouldn't happen).
      }
    } else if (/\.json$/i.test(item.file)) {
      this.fileStore.loadBundle((await this.library.bundle(item.file)).files);
      this.setView('algorithm');
    } else {
      this.fileStore.addFile(item.file.split('/').pop() ?? 'imported.algo', await this.library.file(item.file));
      this.setView('algorithm');
    }
    this.closeImport();
  }

  /** Open the documentation workspace — the full-page getting-started guide. */
  openDocs(): void {
    this.setView('docs');
  }

  /**
   * A CTA inside the docs guide jumps the reader into the app: a workspace tab,
   * the syntax-guide modal, or the import/library modal.
   */
  onDocsNavigate(action: DocAction): void {
    switch (action) {
      case 'canvas':
      case 'algorithm':
      case 'run':
        this.setView(action);
        break;
      case 'syntax':
        this.setView('algorithm');
        this.syntaxOpen.set(true);
        break;
      case 'import':
        this.openImport();
        break;
    }
  }
}
