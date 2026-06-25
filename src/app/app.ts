import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
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
import { EditorView, basicSetup } from 'codemirror';
import { IconComponent } from './shared/icon.component';

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
}

const SAMPLE_PSEUDOCODE = `// Dijkstra — shortest path
algorithm Dijkstra(source):
    for each v in nodes() do
        dist[v] ← infinity        // unreachable at first
    end for
    dist[source] ← 0

    pq ← priorityQueue()
    pq.push(source, 0)

    while not pq.isEmpty() do
        u ← pq.popMin()           // nearest unvisited
        visit(u)
        for each v in neighbors(u) do
            if dist[u] + weight(u, v) < dist[v] then   // relaxation
                dist[v] ← dist[u] + weight(u, v)
                pq.push(v, dist[v])
            end if
        end for
    end while
end algorithm
`;

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FFlowModule, IconComponent],
  templateUrl: './app.html',
  styleUrls: ['./app.scss', './editor-chrome.scss', './editor-nodes.scss'],
})
export class App implements AfterViewInit, OnDestroy {
  private readonly elRef = inject(ElementRef);
  private readonly fCanvas = viewChild(FCanvasComponent);
  private readonly editorHost = viewChild<ElementRef<HTMLElement>>('editorHost');
  private editorView?: EditorView;

  readonly EFConnectionType = EFConnectionType;
  readonly EFMarkerType = EFMarkerType;

  protected readonly title = signal('Algoraph');

  // ── Node palette (tool library rail) ──────────────────────
  protected readonly palette: PaletteItem[] = [
    { kind: 'NODE', label: 'Vertex', sub: 'A plain graph node', icon: 'circle', color: 'oklch(0.58 0.13 65)' },
    { kind: 'START', label: 'Start', sub: 'Source / entry node', icon: 'play', color: 'oklch(0.55 0.14 150)' },
    { kind: 'GOAL', label: 'Goal', sub: 'Target / destination', icon: 'target', color: 'oklch(0.6 0.17 290)' },
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

  // Edge editor (weight + direction)
  protected readonly editEdgeId = signal<string | null>(null);
  protected readonly editPos = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  protected readonly editingEdge = computed(() => this.edges().find((e) => e.id === this.editEdgeId()) ?? null);

  private nextNodeId = 1;
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

  // ── Lifecycle ─────────────────────────────────────────────
  ngAfterViewInit(): void {
    const host = this.editorHost()?.nativeElement;
    if (!host) return;
    this.editorView = new EditorView({
      doc: SAMPLE_PSEUDOCODE,
      extensions: [basicSetup, EditorView.lineWrapping, App.editorTheme],
      parent: host,
    });
  }

  ngOnDestroy(): void {
    this.editorView?.destroy();
  }

  private static readonly editorTheme = EditorView.theme(
    {
      '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--fg)', fontSize: '12.5px' },
      '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.65' },
      '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--fg-subtle)' },
      '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--fg-muted)' },
      '.cm-cursor': { borderLeftColor: 'var(--accent)' },
      '&.cm-focused': { outline: 'none' },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
        backgroundColor: 'color-mix(in srgb, var(--accent) 18%, transparent)',
      },
    },
    { dark: false },
  );

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

  // ── Node operations ───────────────────────────────────────
  private createNodeAt(kind: NodeKind, position: { x: number; y: number }): void {
    const id = `n${this.nextNodeId++}`;
    this.nodes.update((list) => [...list, { id, kind, label: id.toUpperCase(), position }]);
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
    this.nodes.update((list) =>
      list.map((n) => {
        const moved = updates.find((u) => u.id === n.id);
        return moved ? { ...n, position: moved.position } : n;
      }),
    );
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
    if (target.closest('.ae-node')) return;
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
    this.nodeCtxMenuOpen.set(true);
  }

  closeNodeContextMenu(): void {
    this.nodeCtxMenuOpen.set(false);
    this.nodeCtxTarget.set(null);
  }

  copyNode(nodeId: string): void {
    const node = this.nodes().find((n) => n.id === nodeId);
    if (!node) return;
    const id = `n${this.nextNodeId++}`;
    this.nodes.update((list) => [
      ...list,
      { id, kind: node.kind, label: id.toUpperCase(), position: { x: node.position.x + 40, y: node.position.y + 40 } },
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
}
