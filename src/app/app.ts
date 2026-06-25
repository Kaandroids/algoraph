import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  signal,
  viewChild,
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
import { HELPERS_SRC, MAIN_SRC, type AlgoFile } from './models/algo-file.model';
import {
  DATA_PALETTE,
  DATA_STRUCTURES,
  dataSize,
  formatDataItems,
  makeDataNode,
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

  /** In algorithm mode, which library item's inline reference card is open (`graph:KIND` / `data:KIND`). */
  protected readonly expandedLib = signal<string | null>(null);

  // ── Algorithm source files (entry `main` + module files) ──
  protected readonly files = signal<AlgoFile[]>([
    { id: 'main', name: 'main.algo', content: MAIN_SRC, notes: [] },
    { id: 'helpers', name: 'helpers.algo', content: HELPERS_SRC, notes: [] },
  ]);
  protected readonly activeFileId = signal('main');
  /** Id of the file tab being renamed inline (null = none); `main` is never renamable. */
  protected readonly renamingFileId = signal<string | null>(null);
  protected readonly renameDraft = signal('');
  protected readonly activeFile = computed(
    () => this.files().find((f) => f.id === this.activeFileId()) ?? this.files()[0],
  );
  /** Line count of the file open in the editor. */
  protected readonly activeLineCount = computed(() => this.activeFile().content.split('\n').length);
  /** Per-line notes for the file open in the editor. */
  protected readonly activeFileNotes = computed(() => this.activeFile().notes);
  /** The entry file — shown read-only in the Run workspace. */
  protected readonly mainFile = computed(
    () => this.files().find((f) => f.id === 'main') ?? this.files()[0],
  );
  /** Names in scope for the editor's autocomplete — the graph + canvas data structures. */
  protected readonly editorGlobals = computed<EditorGlobal[]>(() => {
    const structures = this.dataNodes().map((d) => ({
      name: d.label,
      type: DATA_STRUCTURES[d.kind].tag,
      members: this.dataMembers(d.kind),
    }));
    return [{ name: 'graph', type: 'Graph' }, ...structures];
  });
  private nextFileId = 1;

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

  // ── Canvas state ──────────────────────────────────────────
  protected readonly nodes = signal<GNode[]>([
    { id: 'A', kind: 'START', label: 'A', position: { x: 60, y: 140 } },
    { id: 'B', kind: 'NODE', label: 'B', position: { x: 360, y: 60 } },
    { id: 'C', kind: 'NODE', label: 'C', position: { x: 360, y: 320 } },
    { id: 'D', kind: 'NODE', label: 'D', position: { x: 680, y: 200 } },
    { id: 'E', kind: 'GOAL', label: 'E', position: { x: 980, y: 280 } },
  ]);

  protected readonly edges = signal<GEdge[]>([
    { id: 'e1', outputId: 'A-out', inputId: 'B-in', weight: 4, directed: true },
    { id: 'e2', outputId: 'A-out', inputId: 'C-in', weight: 2, directed: true },
    { id: 'e3', outputId: 'C-out', inputId: 'B-in', weight: 1, directed: true },
    { id: 'e4', outputId: 'B-out', inputId: 'D-in', weight: 5, directed: true },
    { id: 'e5', outputId: 'C-out', inputId: 'D-in', weight: 8, directed: true },
    { id: 'e6', outputId: 'D-out', inputId: 'E-in', weight: 3, directed: true },
  ]);

  // Data-structure nodes — seeded to mirror the Dijkstra sample in the code rail.
  protected readonly dataNodes = signal<DataNode[]>([
    makeDataNode('SET', 'ds-visited', { x: 60, y: 470 }, 'visited'),
    makeDataNode('MAP', 'ds-dist', { x: 320, y: 470 }, 'dist'),
    makeDataNode('PQUEUE', 'ds-pq', { x: 600, y: 470 }, 'pq'),
  ]);

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
  /** Live text of the comma-separated values field (LIST · STACK · QUEUE · SET). */
  protected readonly itemsDraft = signal('');
  protected readonly editingDataNode = computed(
    () => this.dataNodes().find((n) => n.id === this.editNodeId()) ?? null,
  );
  /** Empty when the drafted name is valid; otherwise the reason it can't be applied. */
  protected readonly nameError = computed(() => {
    const id = this.editNodeId();
    if (!id) return '';
    const name = this.nameDraft().trim();
    if (!name) return 'Name is required';
    if (this.usedNames(id).has(name.toLowerCase())) return 'Name already in use';
    return '';
  });

  // Info modal — graph node / data-structure reference (description, methods next)
  protected readonly infoCard = signal<NodeInfo | null>(null);

  private nextNodeId = 1;
  private nextDataId = 1;
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

  /** Template hooks for the data-structure presentation helpers (defined in the model). */
  protected readonly formatItems = formatDataItems;
  protected readonly dataSizeLabel = dataSize;
  /** Stacks grow upward, so render the top (last pushed) element first. */
  reversed(items: (string | number)[]): (string | number)[] {
    return [...items].reverse();
  }
  /** Priority queues are displayed lowest-priority-first regardless of edit order. */
  sortedHeap(node: DataNode): HeapEntry[] {
    return [...node.heap].sort((a, b) => a.priority - b.priority);
  }
  /** `[0, 1, …, n-1]` — used to render matrix index headers. */
  range(n: number): number[] {
    return Array.from({ length: n }, (_, i) => i);
  }

  // ── Unique names (graph vertices + data structures share one namespace) ──
  /** Lower-cased names currently taken by any node, optionally excluding one id. */
  private usedNames(exceptId?: string): Set<string> {
    const names = new Set<string>();
    for (const n of this.nodes()) if (n.id !== exceptId) names.add(n.label.toLowerCase());
    for (const d of this.dataNodes()) if (d.id !== exceptId) names.add(d.label.toLowerCase());
    return names;
  }
  /** `base`, or `base2`, `base3`, … — the first variant not already in use. */
  private uniqueName(base: string, exceptId?: string): string {
    const used = this.usedNames(exceptId);
    if (!used.has(base.toLowerCase())) return base;
    let i = 2;
    while (used.has(`${base}${i}`.toLowerCase())) i++;
    return `${base}${i}`;
  }

  // ── Node operations ───────────────────────────────────────
  private createNodeAt(kind: NodeKind, position: { x: number; y: number }): void {
    const id = `n${this.nextNodeId++}`;
    const label = this.uniqueName(id.toUpperCase());
    this.nodes.update((list) => [...list, { id, kind, label, position }]);
  }

  addNode(kind: NodeKind): void {
    this.createNodeAt(kind, { x: 220 + Math.random() * 220, y: 120 + Math.random() * 220 });
  }

  deleteNode(nodeId: string): void {
    this.nodes.update((list) => list.filter((n) => n.id !== nodeId));
    this.edges.update((list) =>
      list.filter((e) => !e.outputId.startsWith(`${nodeId}-`) && !e.inputId.startsWith(`${nodeId}-`)),
    );
  }

  // ── Data-structure node operations ────────────────────────
  private createDataNodeAt(kind: DataStructureKind, position: { x: number; y: number }): void {
    const id = `ds${this.nextDataId++}`;
    const label = this.uniqueName(DATA_STRUCTURES[kind].defaultLabel);
    this.dataNodes.update((list) => [...list, makeDataNode(kind, id, position, label)]);
  }

  addDataNode(kind: DataStructureKind): void {
    this.createDataNodeAt(kind, { x: 240 + Math.random() * 220, y: 460 + Math.random() * 160 });
  }

  addDataNodeAt(kind: DataStructureKind): void {
    this.ctxMenuOpen.set(false);
    this.createDataNodeAt(kind, { x: this.ctxCanvasPos.x, y: this.ctxCanvasPos.y });
  }

  deleteDataNode(nodeId: string): void {
    this.dataNodes.update((list) => list.filter((n) => n.id !== nodeId));
  }

  copyDataNode(nodeId: string): void {
    const node = this.dataNodes().find((n) => n.id === nodeId);
    if (!node) return;
    const id = `ds${this.nextDataId++}`;
    const label = this.uniqueName(node.label);
    this.dataNodes.update((list) => [
      ...list,
      {
        ...node,
        id,
        label,
        position: { x: node.position.x + 40, y: node.position.y + 40 },
        items: [...node.items],
        entries: node.entries.map((e) => ({ ...e })),
        heap: node.heap.map((h) => ({ ...h })),
        matrix: node.matrix.map((row) => [...row]),
      },
    ]);
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
    this.itemsDraft.set('items' in node ? node.items.join(', ') : '');
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

  /** Rename live; an empty or duplicate draft surfaces an error and leaves the model untouched. */
  onNameInput(value: string): void {
    this.nameDraft.set(value);
    if (this.nameError()) return;
    const id = this.editNodeId();
    if (!id) return;
    const name = value.trim();
    const rename = <T extends { id: string; label: string }>(list: T[]): T[] =>
      list.map((n) => (n.id === id ? { ...n, label: name } : n));
    if (this.editNodeKind() === 'data') this.dataNodes.update(rename);
    else this.nodes.update(rename);
  }

  private updateEditingData(change: (node: DataNode) => DataNode): void {
    const id = this.editNodeId();
    if (!id) return;
    this.dataNodes.update((list) => list.map((n) => (n.id === id ? change(n) : n)));
  }

  /** LIST · STACK · QUEUE · SET — parse the comma-separated field into items. */
  onItemsInput(value: string): void {
    this.itemsDraft.set(value);
    const node = this.editingDataNode();
    if (!node) return;
    let items: (string | number)[] = value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => (!Number.isNaN(Number(s)) ? Number(s) : s));
    if (node.kind === 'SET') items = [...new Set(items)];
    this.updateEditingData((n) => ({ ...n, items }));
  }

  // MAP entries
  addMapEntry(): void {
    this.updateEditingData((n) => ({ ...n, entries: [...n.entries, { key: '', value: '' }] }));
  }
  setMapKey(index: number, key: string): void {
    this.updateEditingData((n) => ({ ...n, entries: n.entries.map((e, i) => (i === index ? { ...e, key } : e)) }));
  }
  setMapValue(index: number, value: string): void {
    this.updateEditingData((n) => ({ ...n, entries: n.entries.map((e, i) => (i === index ? { ...e, value } : e)) }));
  }
  removeMapEntry(index: number): void {
    this.updateEditingData((n) => ({ ...n, entries: n.entries.filter((_, i) => i !== index) }));
  }

  // Priority-queue items
  addHeapEntry(): void {
    this.updateEditingData((n) => ({ ...n, heap: [...n.heap, { value: '', priority: 0 }] }));
  }
  setHeapValue(index: number, value: string): void {
    this.updateEditingData((n) => ({ ...n, heap: n.heap.map((h, i) => (i === index ? { ...h, value } : h)) }));
  }
  setHeapPriority(index: number, priority: number): void {
    if (Number.isNaN(priority)) return;
    this.updateEditingData((n) => ({ ...n, heap: n.heap.map((h, i) => (i === index ? { ...h, priority } : h)) }));
  }
  removeHeapEntry(index: number): void {
    this.updateEditingData((n) => ({ ...n, heap: n.heap.filter((_, i) => i !== index) }));
  }

  // Matrix size + cells
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
  setMatrixCell(r: number, c: number, value: number): void {
    if (Number.isNaN(value)) return;
    this.updateEditingData((n) => ({
      ...n,
      matrix: n.matrix.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? value : cell)) : row)),
    }));
  }

  // ── Foblex events ─────────────────────────────────────────
  onConnectionCreated(event: FCreateConnectionEvent): void {
    if (!event.targetId) return;
    this.edges.update((list) => [
      ...list,
      { id: `e${Date.now()}`, outputId: event.sourceId, inputId: event.targetId!, weight: 1, directed: true },
    ]);
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
    if (Number.isNaN(weight)) return;
    this.edges.update((list) => list.map((e) => (e.id === edgeId ? { ...e, weight } : e)));
  }

  setEdgeDirected(edgeId: string, directed: boolean): void {
    this.edges.update((list) => list.map((e) => (e.id === edgeId ? { ...e, directed } : e)));
  }

  deleteEdge(edgeId: string): void {
    this.edges.update((list) => list.filter((e) => e.id !== edgeId));
    if (this.editEdgeId() === edgeId) this.closeEdgeEditor();
  }

  onSelectionChanged(event: FSelectionChangeEvent): void {
    this.selectedConnectionIds.set(event.connectionIds);
  }

  onNodeMoved(event: FMoveNodesEvent): void {
    const updates = event.nodes;
    const reposition = <T extends { id: string; position: { x: number; y: number } }>(n: T): T => {
      const moved = updates.find((u) => u.id === n.id);
      return moved ? { ...n, position: moved.position } : n;
    };
    this.nodes.update((list) => list.map(reposition));
    this.dataNodes.update((list) => list.map(reposition));
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
    this.createNodeAt(kind, { x: this.ctxCanvasPos.x, y: this.ctxCanvasPos.y });
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
    const node = this.nodes().find((n) => n.id === nodeId);
    if (!node) return;
    const id = `n${this.nextNodeId++}`;
    const label = this.uniqueName(node.label);
    this.nodes.update((list) => [
      ...list,
      { id, kind: node.kind, label, position: { x: node.position.x + 40, y: node.position.y + 40 } },
    ]);
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
      this.tipsOpen.set(false);
      return;
    }
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    const target = event.target as HTMLElement;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return;
    const connIds = this.selectedConnectionIds();
    if (connIds.length > 0) {
      this.edges.update((list) => list.filter((e) => !connIds.includes(e.id)));
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
  toggleRail(): void {
    this.railCollapsed.update((v) => !v);
  }
  toggleCodeRail(): void {
    this.codeRailCollapsed.update((v) => !v);
  }
  toggleRunData(): void {
    this.runDataCollapsed.update((v) => !v);
  }
  toggleRunCode(): void {
    this.runCodeCollapsed.update((v) => !v);
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

  /** Library click — drops a node in builder mode, expands its inline reference card in algorithm mode. */
  onGraphLibClick(_event: Event, kind: NodeKind): void {
    if (this.activeView() === 'algorithm') this.toggleLibCard('graph:' + kind);
    else this.addNode(kind);
  }
  onDataLibClick(_event: Event, kind: DataStructureKind): void {
    if (this.activeView() === 'algorithm') this.toggleLibCard('data:' + kind);
    else this.addDataNode(kind);
  }

  // ── Algorithm files (entry `main` + modules) ──────────────
  setActiveFile(id: string): void {
    this.activeFileId.set(id);
  }
  /** Persist the editor's content back to the active file. */
  onEditorContent(text: string): void {
    const id = this.activeFileId();
    this.files.update((list) => list.map((f) => (f.id === id ? { ...f, content: text } : f)));
  }
  /** Persist per-line notes back to the active file. */
  onNotesChange(notes: LineNote[]): void {
    const id = this.activeFileId();
    this.files.update((list) => list.map((f) => (f.id === id ? { ...f, notes } : f)));
  }
  addFile(): void {
    const id = `f${this.nextFileId++}`;
    const used = new Set(this.files().map((f) => f.name));
    let name = 'module.algo';
    for (let i = 2; used.has(name); i++) name = `module${i}.algo`;
    this.files.update((list) => [...list, { id, name, content: '// new module\n', notes: [] }]);
    this.activeFileId.set(id);
  }
  /** Close a module file; the entry `main` can't be closed. */
  closeFile(event: Event, id: string): void {
    event.stopPropagation();
    if (id === 'main') return;
    this.files.update((list) => list.filter((f) => f.id !== id));
    if (this.activeFileId() === id) this.activeFileId.set('main');
  }

  /** Double-click a tab to rename it inline (the entry `main` can't be renamed). */
  startRename(event: Event, file: AlgoFile): void {
    event.stopPropagation();
    if (file.id === 'main') return;
    this.renameDraft.set(file.name);
    this.renamingFileId.set(file.id);
  }
  commitRename(): void {
    const id = this.renamingFileId();
    if (!id) return;
    let name = this.renameDraft().trim();
    if (name) {
      if (!/\.algo$/i.test(name)) name += '.algo';
      const taken = this.files().some((f) => f.id !== id && f.name === name);
      if (!taken) this.files.update((list) => list.map((f) => (f.id === id ? { ...f, name } : f)));
    }
    this.renamingFileId.set(null);
  }
  cancelRename(): void {
    this.renamingFileId.set(null);
  }

  // ── Canvas overview + import / export ─────────────────────
  /** Per-kind breakdown shown in the right-hand overview panel. */
  protected readonly canvasSummary = computed(() => {
    const ns = this.nodes();
    const es = this.edges();
    return {
      starts: ns.filter((n) => n.kind === 'START').length,
      goals: ns.filter((n) => n.kind === 'GOAL').length,
      plain: ns.filter((n) => n.kind === 'NODE').length,
      directed: es.filter((e) => e.directed).length,
      undirected: es.filter((e) => !e.directed).length,
    };
  });

  /** Download the whole canvas (graph + data structures) as a JSON file. */
  exportCanvas(): void {
    const data = { version: 1, nodes: this.nodes(), edges: this.edges(), dataNodes: this.dataNodes() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
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
        this.loadCanvas(JSON.parse(reader.result as string));
      } catch {
        // Invalid JSON — ignored for now (a toast can surface this later).
      }
    };
    reader.readAsText(file);
  }

  private loadCanvas(data: { nodes?: GNode[]; edges?: GEdge[]; dataNodes?: DataNode[] }): void {
    if (Array.isArray(data.nodes)) this.nodes.set(data.nodes);
    if (Array.isArray(data.edges)) this.edges.set(data.edges);
    if (Array.isArray(data.dataNodes)) this.dataNodes.set(data.dataNodes);
    // Keep new-node counters ahead of any imported ids so they never collide.
    this.nextNodeId = this.maxIdNumber(this.nodes(), 'n') + 1;
    this.nextDataId = this.maxIdNumber(this.dataNodes(), 'ds') + 1;
  }

  private maxIdNumber(items: { id: string }[], prefix: string): number {
    let max = 0;
    for (const it of items) {
      const m = new RegExp(`^${prefix}(\\d+)$`).exec(it.id);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max;
  }
}
