import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
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
import { ApiGroup, DATA_STRUCTURE_API, GRAPH_NODE_API, GLOBAL_REFERENCE } from './node-api';

type NodeKind = 'NODE' | 'START' | 'GOAL';

/** A graph vertex rendered as a node card. */
interface GNode {
  id: string;
  kind: NodeKind;
  label: string;
  position: { x: number; y: number };
}

/** A graph edge — stored by the Foblex port ids it connects. */
interface GEdge {
  id: string;
  outputId: string;
  inputId: string;
  weight: number;
  /** true = directed (single arrow at the target); false = undirected (plain line, no arrows). */
  directed: boolean;
}

interface PaletteItem {
  kind: NodeKind;
  label: string;
  sub: string;
  icon: string;
  color: string;
  description: string;
}

/** The data structures a learner can drop on the canvas to watch an algorithm's state. */
type DataStructureKind = 'LIST' | 'STACK' | 'QUEUE' | 'SET' | 'MAP' | 'PQUEUE' | 'MATRIX';

interface MapEntry {
  key: string;
  value: string | number;
}

interface HeapEntry {
  value: string;
  priority: number;
}

/**
 * A data-structure node — pure display. It holds contents and renders them on the
 * canvas, but has no ports and no input/output mechanism: it exists only to make the
 * state an algorithm keeps (visited set, distance map, frontier queue, …) visible.
 */
interface DataNode {
  id: string;
  kind: DataStructureKind;
  /** Variable-style name shown in the header, e.g. `dist`, `pq`, `visited`. */
  label: string;
  position: { x: number; y: number };
  /** LIST · STACK · QUEUE · SET — linear contents. */
  items: (string | number)[];
  /** MAP — key → value rows. */
  entries: MapEntry[];
  /** PQUEUE — values with priority, kept sorted (lowest priority first). */
  heap: HeapEntry[];
  /** MATRIX — row-major numeric grid. */
  matrix: number[][];
}

interface DataPaletteItem {
  kind: DataStructureKind;
  label: string;
  sub: string;
  icon: string;
  color: string;
  description: string;
}

/** View model for the info modal — shared by graph nodes and data structures. */
interface NodeInfo {
  eyebrow: string;
  label: string;
  icon: string;
  color: string;
  description: string;
  groups: ApiGroup[];
}

/** Static metadata (label, header tag, icon, accent colour, description) per data-structure kind. */
const DATA_STRUCTURES: Record<
  DataStructureKind,
  { label: string; tag: string; sub: string; icon: string; color: string; description: string }
> = {
  LIST: {
    label: 'List / Array',
    tag: 'Array',
    sub: 'Indexed, ordered values',
    icon: 'list',
    color: 'oklch(0.6 0.13 230)',
    description:
      'An ordered sequence addressed by position. Reading or overwriting any index is O(1); inserting or removing in the middle shifts the following elements, so it costs O(n).',
  },
  STACK: {
    label: 'Stack',
    tag: 'Stack',
    sub: 'LIFO — push / pop on top',
    icon: 'layers',
    color: 'oklch(0.58 0.14 300)',
    description:
      'A last-in, first-out (LIFO) collection: you push onto the top and pop from the top, so only the most recently added element is reachable. Backs depth-first search and backtracking.',
  },
  QUEUE: {
    label: 'Queue',
    tag: 'Queue',
    sub: 'FIFO — front to back',
    icon: 'arrowRightLeft',
    color: 'oklch(0.6 0.13 200)',
    description:
      'A first-in, first-out (FIFO) collection: you enqueue at the back and dequeue from the front, so elements leave in the order they arrived. It is the frontier of breadth-first search.',
  },
  SET: {
    label: 'Set',
    tag: 'Set',
    sub: 'Unique membership',
    icon: 'braces',
    color: 'oklch(0.58 0.15 350)',
    description:
      'An unordered collection of distinct elements. Adding an element and testing membership are amortized O(1). Graph traversals use it to remember which vertices have been visited.',
  },
  MAP: {
    label: 'Map',
    tag: 'Map',
    sub: 'Key → value lookup',
    icon: 'arrowRight',
    color: 'oklch(0.58 0.14 162)',
    description:
      'A collection of key → value pairs (dictionary / hash map). Every key is unique and maps to a single value; lookups and updates are amortized O(1). Stores distances, predecessors, colours and similar per-vertex data.',
  },
  PQUEUE: {
    label: 'Priority Queue',
    tag: 'Priority Q',
    sub: 'Min-heap by priority',
    icon: 'gitBranch',
    color: 'oklch(0.64 0.15 50)',
    description:
      'A queue ordered by priority instead of arrival time. Removing the smallest (or largest) element takes O(log n) with a binary heap. It drives Dijkstra, Prim and A*.',
  },
  MATRIX: {
    label: '2D Matrix',
    tag: 'Matrix',
    sub: 'Row × column grid',
    icon: 'grid',
    color: 'oklch(0.56 0.13 20)',
    description:
      'A two-dimensional grid of values indexed by row and column. As an adjacency matrix it records a weight for every pair of vertices in O(V²) space with O(1) access. Used by Floyd–Warshall.',
  },
};

/** Default variable name used when a structure is dropped from the library. */
const DEFAULT_DATA_LABEL: Record<DataStructureKind, string> = {
  LIST: 'list',
  STACK: 'stack',
  QUEUE: 'queue',
  SET: 'set',
  MAP: 'map',
  PQUEUE: 'pq',
  MATRIX: 'matrix',
};

/** Build a data-structure node seeded with small sample contents so the card isn't empty. */
function makeDataNode(
  kind: DataStructureKind,
  id: string,
  position: { x: number; y: number },
  label: string = DEFAULT_DATA_LABEL[kind],
): DataNode {
  const node: DataNode = { id, kind, label, position, items: [], entries: [], heap: [], matrix: [] };
  switch (kind) {
    case 'LIST':
      node.items = [5, 3, 8, 1, 4];
      break;
    case 'STACK':
      node.items = [4, 2, 7];
      break;
    case 'QUEUE':
      node.items = ['A', 'B', 'C', 'D'];
      break;
    case 'SET':
      node.items = ['A', 'C', 'F'];
      break;
    case 'MAP':
      node.entries = [
        { key: 'A', value: 0 },
        { key: 'B', value: 4 },
        { key: 'C', value: 2 },
      ];
      break;
    case 'PQUEUE':
      node.heap = [
        { value: 'A', priority: 0 },
        { value: 'C', priority: 2 },
        { value: 'B', priority: 4 },
      ];
      break;
    case 'MATRIX':
      node.matrix = [
        [0, 4, 2],
        [4, 0, 1],
        [2, 1, 0],
      ];
      break;
  }
  return node;
}

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FFlowModule, IconComponent],
  templateUrl: './app.html',
  styleUrls: ['./app.scss', './editor-chrome.scss', './editor-nodes.scss', './data-nodes.scss'],
})
export class App {
  private readonly elRef = inject(ElementRef);
  private readonly fCanvas = viewChild(FCanvasComponent);
  private readonly importInput = viewChild<ElementRef<HTMLInputElement>>('importInput');

  readonly EFConnectionType = EFConnectionType;
  readonly EFMarkerType = EFMarkerType;

  protected readonly title = signal('Algoraph');

  /** Which workspace is showing — the graph builder or the algorithm editor. */
  protected readonly activeView = signal<'canvas' | 'algorithm'>('canvas');

  /** In algorithm mode, which library item's inline reference card is open (`graph:KIND` / `data:KIND`). */
  protected readonly expandedLib = signal<string | null>(null);

  /**
   * Sample pseudocode shown in the algorithm editor. Static for now — the live
   * CodeMirror editor and the interpreter come later; this is the design shell.
   */
  protected readonly pseudocodeLines: string[] = [
    '// Dijkstra — shortest paths from the Start vertex',
    's ← source()',
    'for each vertex u in nodes() do',
    '  dist[u] ← INFINITY',
    'end',
    'dist[s] ← 0',
    'pq.push(s, 0)',
    '',
    'while not pq.isEmpty() do',
    '  u ← pq.popMin()',
    '  if u in visited then continue end',
    '  visited.add(u)',
    '',
    '  for each vertex v in neighbors(u) do',
    '    alt ← dist[u] + weight(u, v)',
    '    if alt < dist[v] then',
    '      dist[v] ← alt',
    '      pq.push(v, alt)',
    '    end',
    '  end',
    'end',
  ];

  // ── Node palette (tool library rail) ──────────────────────
  protected readonly palette: PaletteItem[] = [
    {
      kind: 'NODE',
      label: 'Vertex',
      sub: 'A plain graph node',
      icon: 'circle',
      color: 'oklch(0.58 0.13 65)',
      description:
        'A plain graph vertex — a point the algorithm can visit and link with edges. Its incoming and outgoing edges define its neighbours, and most traversals iterate over the set of vertices.',
    },
    {
      kind: 'START',
      label: 'Start',
      sub: 'Source / entry node',
      icon: 'play',
      color: 'oklch(0.55 0.14 150)',
      description:
        'The source vertex an algorithm begins from. Single-source traversals and shortest-path searches expand outward from here, so its own distance is initialised to 0.',
    },
    {
      kind: 'GOAL',
      label: 'Goal',
      sub: 'Target / destination',
      icon: 'target',
      color: 'oklch(0.6 0.17 290)',
      description:
        'The target vertex a search is trying to reach. Goal-directed algorithms such as A* and bidirectional search can stop as soon as it is settled.',
    },
  ];

  // ── Data-structure palette (display-only state nodes) ─────
  protected readonly dataPalette: DataPaletteItem[] = (
    ['LIST', 'STACK', 'QUEUE', 'SET', 'MAP', 'PQUEUE', 'MATRIX'] as DataStructureKind[]
  ).map((kind) => ({ kind, ...DATA_STRUCTURES[kind] }));

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
  nodeIcon(kind: NodeKind): string {
    return kind === 'START' ? 'play' : kind === 'GOAL' ? 'target' : 'circle';
  }
  nodeColor(kind: NodeKind): string {
    return kind === 'START'
      ? 'oklch(0.55 0.14 150)'
      : kind === 'GOAL'
        ? 'oklch(0.6 0.17 290)'
        : 'oklch(0.58 0.13 65)';
  }
  nodeTypeLabel(kind: NodeKind): string {
    return kind;
  }

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
    const label = this.uniqueName(DEFAULT_DATA_LABEL[kind]);
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

  // ── View switch (graph builder ↔ algorithm editor) ────────
  setView(view: 'canvas' | 'algorithm'): void {
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
