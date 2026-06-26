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
import { type EditorGlobal } from './editor/dsl';
import { type LineNote } from './editor/line-notes';
import {
  ApiGroup,
  DATA_STRUCTURE_API,
  GRAPH_NODE_API,
  GLOBAL_REFERENCE,
  memberName,
} from './node-api';
import { type AlgoFile } from './models/algo-file.model';
import { type ExportRef } from './models/exports';
import { compile } from './lang/compile';
import { estimateComplexity } from './lang/complexity';
import { SYNTAX_GUIDE } from './models/syntax-guide';
import { FilesStore } from './stores/files.store';
import { CanvasStore } from './stores/canvas.store';
import { RunStore } from './stores/run.store';
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
  imports: [FFlowModule, IconComponent, CodeEditorComponent, NgTemplateOutlet],
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
  private readonly fCanvas = viewChild(FCanvasComponent);
  private readonly importInput = viewChild<ElementRef<HTMLInputElement>>('importInput');
  private readonly renameInput = viewChild<ElementRef<HTMLInputElement>>('renameInput');

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

  /** Which workspace is showing — graph builder, algorithm editor, or step-by-step run. */
  protected readonly activeView = signal<'canvas' | 'algorithm' | 'run'>('canvas');

  /** Compile + run the algorithm afresh each time the Run workspace is opened. */
  private readonly autoBuild = effect(() => {
    if (this.activeView() === 'run') untracked(() => this.run.build());
  });

  /** Cleared/reset whenever a new `scrollTo` pan begins (see `followScroll`). */
  private panTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Pan the Run canvas when the algorithm calls `scrollTo(…)` on a step — to a
   * single vertex, or to the midpoint of an edge.
   *
   * Foblex's animated centring eases (`ease-in-out`) but only over 150 ms, which
   * reads as a snap. We briefly tag the canvas with `is-scrolling`, whose CSS
   * stretches the transform transition to a perceptible, speed-scaled duration
   * with a pronounced ease-in-out curve, then drop the tag so manual panning and
   * zooming stay instant.
   */
  private readonly followScroll = effect(() => {
    const target = this.run.effects().scrollTo;
    if (!target || untracked(() => this.activeView()) !== 'run') return;
    untracked(() => {
      const canvas = this.fCanvas();
      if (!canvas) return;
      const host = this.elRef.nativeElement.querySelector('.ag-runcanvas f-canvas') as HTMLElement | null;
      if (host) {
        const ms = Math.round(this.run.animMs() * 1.4); // a touch longer than the effect fades
        host.style.setProperty('--run-pan', `${ms}ms`);
        host.classList.add('is-scrolling');
        if (this.panTimer !== null) clearTimeout(this.panTimer);
        this.panTimer = setTimeout(() => host.classList.remove('is-scrolling'), ms + 120);
      }
      try {
        if (target.kind === 'edge') this.panToEdge(canvas, target.from, target.to);
        else canvas.centerGroupOrNode(target.id, true);
      } catch {
        // A node may not be laid out yet; ignore and let the next step retry.
      }
    });
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

  /**
   * Centre the canvas on an edge by its weight badge — the point the learner sees
   * labelling the edge. Foblex only centres a node by id, so we pan by the screen
   * delta that brings the badge to the viewport centre, which is exact at any zoom
   * (panning adds straight to the transform's translation). Falls back to centring
   * the head vertex if the edge or its badge isn't found.
   */
  private panToEdge(canvas: FCanvasComponent, from: string, to: string): void {
    const edge = this.edges().find((e) => {
      const s = e.outputId.replace(/-out$/, '');
      const t = e.inputId.replace(/-in$/, '');
      return (s === from && t === to) || (s === to && t === from);
    });
    const flow = this.elRef.nativeElement.querySelector('.ag-runcanvas f-flow') as HTMLElement | null;
    const badge = edge
      ? (this.elRef.nativeElement.querySelector(
          `.ag-runcanvas .ag-edge-badge[data-edge="${edge.id}"]`,
        ) as HTMLElement | null)
      : null;
    if (!flow || !badge) {
      canvas.centerGroupOrNode(to, true);
      return;
    }
    const b = badge.getBoundingClientRect();
    const f = flow.getBoundingClientRect();
    const pos = canvas.getPosition();
    canvas._setPosition({
      x: pos.x + (f.left + f.width / 2 - (b.left + b.width / 2)),
      y: pos.y + (f.top + f.height / 2 - (b.top + b.height / 2)),
    });
    canvas.redraw();
  }

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
  protected readonly mainFile = this.fileStore.main;

  /** Parsed + resolved program — shared by the export list and the complexity estimate. */
  private readonly compiled = computed(() => compile(this.files()));

  /** Exported helpers across all files — listed in the overview and offered in autocomplete. */
  protected readonly editorExports = computed<ExportRef[]>(() => this.compiled().exports);

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

  /** Names in scope for the editor's autocomplete — the graph, the canvas, and data structures. */
  protected readonly editorGlobals = computed<EditorGlobal[]>(() => {
    const structures = this.dataNodes().map((d) => ({
      name: d.label,
      type: DATA_STRUCTURES[d.kind].tag,
      members: this.dataMembers(d.kind),
    }));
    return [
      { name: 'graph', type: 'Graph', members: this.apiGroupMembers('Graph access') },
      { name: 'canvas', type: 'Canvas', members: this.apiGroupMembers('Visualization') },
      ...structures,
    ];
  });

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
      groups: GLOBAL_REFERENCE.groups.filter((g) => g.title === 'Graph access'),
    },
    {
      key: 'canvas',
      label: 'Canvas',
      sub: 'Highlight & visualise',
      icon: 'maximize',
      color: 'oklch(0.6 0.17 290)',
      description:
        'The drawing surface — highlight vertices and edges to show what the algorithm is doing.',
      groups: GLOBAL_REFERENCE.groups.filter((g) => g.title === 'Visualization'),
    },
  ];

  // ── Canvas state — re-exposed from CanvasStore (facade) ───
  protected readonly nodes = this.canvas.nodes;
  protected readonly edges = this.canvas.edges;
  protected readonly dataNodes = this.canvas.dataNodes;

  /** Run-canvas data structures: each node keeps its canvas position but shows the
   *  live runtime contents (the same snapshot the Data panel uses), not builder data. */
  protected readonly runDataNodes = computed<DataNode[]>(() => {
    const live = new Map(this.run.dataState().map((d) => [d.id, d]));
    return this.dataNodes().map((n) => {
      const s = live.get(n.id);
      return s ? { ...n, items: s.items, entries: s.entries, heap: s.heap, matrix: s.matrix } : n;
    });
  });

  protected readonly zoomLevel = signal(100);
  protected readonly panning = signal(false);
  protected readonly railCollapsed = signal(false);
  protected readonly codeRailCollapsed = signal(false);
  protected readonly runDataCollapsed = signal(false);
  protected readonly runCodeCollapsed = signal(false);
  protected readonly librarySearch = signal('');
  protected readonly tipsOpen = signal(false);
  protected readonly legendOpen = signal(true);
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
    if (this.canvas.usedNames(id).has(name.toLowerCase())) return 'Name already in use';
    return '';
  });

  // Info modal — graph node / data-structure reference (description, methods next)
  protected readonly infoCard = signal<NodeInfo | null>(null);

  // Syntax-guide modal — DSL reference with worked examples, opened from the library rail.
  protected readonly syntaxGuide = SYNTAX_GUIDE;
  protected readonly syntaxOpen = signal(false);

  private currentCanvasPos = { x: 0, y: 0 };
  private ctxCanvasPos = { x: 0, y: 0 };
  private panStart = { x: 0, y: 0 };
  private canvasPosStart = { x: 0, y: 0 };
  private panSetPosition = { x: 0, y: 0 };

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
  /** Whether the algorithm has highlighted this edge at the current Run step. */
  edgeMarked(edge: GEdge): boolean {
    const src = edge.outputId.replace(/-out$/, '');
    const tgt = edge.inputId.replace(/-in$/, '');
    return this.run.markedSet().has(`${src}->${tgt}`);
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
  /** Autocomplete entries for a data structure's methods (from the API catalog). */
  private dataMembers(kind: DataStructureKind): { label: string; detail?: string; info?: string }[] {
    const out: { label: string; detail?: string; info?: string }[] = [];
    const seen = new Set<string>();
    for (const group of DATA_STRUCTURE_API[kind]) {
      for (const m of group.members) {
        const label = memberName(m.sig);
        if (!label || seen.has(label)) continue;
        seen.add(label);
        out.push({
          label,
          detail: m.returns ? `: ${m.returns}` : undefined,
          info: m.cost ? `${m.desc} · ${m.cost}` : m.desc,
        });
      }
    }
    return out;
  }

  /** Autocomplete members for a global namespace (`graph.` / `canvas.`), from its API group. */
  private apiGroupMembers(title: string): { label: string; detail?: string; info?: string }[] {
    const out: { label: string; detail?: string; info?: string }[] = [];
    const seen = new Set<string>();
    for (const m of GLOBAL_REFERENCE.groups.find((g) => g.title === title)?.members ?? []) {
      const label = memberName(m.sig);
      if (!label || seen.has(label)) continue;
      seen.add(label);
      out.push({
        label,
        detail: m.returns ? `: ${m.returns}` : undefined,
        info: m.cost ? `${m.desc} · ${m.cost}` : m.desc,
      });
    }
    return out;
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
    this.zoomLevel.set(Math.round(event.scale * 100));
    this.currentCanvasPos = event.position;
  }

  // ── Middle-mouse pan ──────────────────────────────────────
  /** Hold the middle mouse button and drag to pan (left-drag already pans via Foblex). */
  onCanvasMouseDown(event: MouseEvent): void {
    if (event.button !== 1) return; // middle button only
    event.preventDefault();
    const canvas = this.fCanvas();
    this.panStart = { x: event.clientX, y: event.clientY };
    this.canvasPosStart = canvas ? { ...canvas.getPosition() } : { ...this.panSetPosition };
    this.panning.set(true);
  }

  @HostListener('window:mousemove', ['$event'])
  onWindowMouseMove(event: MouseEvent): void {
    if (!this.panning()) return;
    const canvas = this.fCanvas();
    if (!canvas) return;
    const newPos = {
      x: this.canvasPosStart.x + (event.clientX - this.panStart.x),
      y: this.canvasPosStart.y + (event.clientY - this.panStart.y),
    };
    this.panSetPosition = newPos;
    canvas._setPosition(newPos);
    canvas.redraw();
    canvas.emitCanvasChangeEvent();
  }

  @HostListener('window:mouseup')
  onWindowMouseUp(): void {
    if (this.panning()) this.panning.set(false);
  }

  // ── Context menus ─────────────────────────────────────────
  onCanvasContextMenu(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest('.ae-node, .ds-node')) return;
    event.preventDefault();
    this.ctxMenuPos.set({ x: event.clientX, y: event.clientY });
    const wrap = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const scale = this.zoomLevel() / 100;
    this.ctxCanvasPos = {
      x: (event.clientX - wrap.left - this.currentCanvasPos.x) / scale,
      y: (event.clientY - wrap.top - this.currentCanvasPos.y) / scale,
    };
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

  // ── Zoom controls ─────────────────────────────────────────
  private canvasCenter(): { x: number; y: number } {
    const wrap = this.elRef.nativeElement.querySelector('.ae-canvas-wrap') as HTMLElement | null;
    if (!wrap) return { x: 0, y: 0 };
    const r = wrap.getBoundingClientRect();
    return { x: r.width / 2, y: r.height / 2 };
  }

  private zoomBy(delta: number): void {
    const canvas = this.fCanvas();
    if (!canvas) return;
    const current = canvas.getScale();
    const next = Math.min(3, Math.max(0.2, Math.round((current + delta) * 10) / 10));
    if (next === current) return;
    canvas.setScale(next, this.canvasCenter());
    canvas.redrawWithAnimation();
    this.zoomLevel.set(Math.round(next * 100));
  }

  zoomIn(): void {
    this.zoomBy(0.1);
  }
  zoomOut(): void {
    this.zoomBy(-0.1);
  }
  resetZoom(): void {
    const canvas = this.fCanvas();
    if (!canvas) return;
    canvas.resetScaleAndCenter(true);
    this.zoomLevel.set(100);
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

  // ── View switch (graph builder ↔ algorithm editor) ────────
  setView(view: 'canvas' | 'algorithm' | 'run'): void {
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

  /** Download the whole canvas (graph + data structures) as a JSON file. */
  exportCanvas(): void {
    const blob = new Blob([JSON.stringify(this.canvas.snapshot(), null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'algoraph-canvas.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  triggerImport(): void {
    this.importInput()?.nativeElement.click();
  }

  onImportFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // let the same file be re-imported later
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        this.canvas.load(JSON.parse(reader.result as string));
      } catch {
        // Invalid JSON — ignored for now (a toast can surface this later).
      }
    };
    reader.readAsText(file);
  }
}
