import { Injectable, computed, inject, signal } from '@angular/core';
import { CanvasStore } from './canvas.store';
import { FilesStore } from './files.store';
import { compileAndRun, type RunInput } from '../lang/run';
import { emptyEffects, type DataSnapshot, type GraphInput, type RunResult, type SavedCanvas } from '../lang/trace';
import type { GEdge, GNode, NodeKind } from '../models/graph.model';
import { makeDataNode, type DataNode, type HeapEntry } from '../models/data-structure.model';
import { makeInputPort, makeOutputPort, sourceNodeId, targetNodeId } from '../models/port.util';
import { diffData, heapKey, type DataDiff } from './run-diff';

/** Playback speeds, cycled by the transport's speed button. */
const SPEEDS = [0.5, 1, 2, 4] as const;
/** Dwell at 1× — one step roughly every two-thirds of a second. */
const BASE_DWELL_MS = 700;

/** A graph-snapshot vertex (or a saved-canvas vertex) as the canvas/run view model. */
function snapshotNodeToGNode(n: { id: string; type: string; label: string; x: number; y: number }): GNode {
  return { id: n.id, kind: n.type as NodeKind, label: n.label, position: { x: n.x, y: n.y } };
}

/** A graph-snapshot edge (or a saved-canvas edge) as the canvas/run view model. */
function snapshotEdgeToGEdge(e: { id: string; src: string; tgt: string; weight: number; directed: boolean }): GEdge {
  return { id: e.id, outputId: makeOutputPort(e.src), inputId: makeInputPort(e.tgt), weight: e.weight, directed: e.directed };
}

/** A data-structure snapshot (with its current contents) as a renderable DataNode. */
function snapshotToDataNode(d: DataSnapshot): DataNode {
  return {
    id: d.id,
    kind: d.kind,
    label: d.label,
    position: { x: d.x, y: d.y },
    items: d.items,
    entries: d.entries,
    heap: d.heap,
    matrix: d.matrix,
    rowLabels: d.rowLabels,
    colLabels: d.colLabels,
  };
}

/**
 * Owns step-by-step execution of the entry file. It compiles + runs the
 * algorithm against the live canvas into an eager trace, then exposes the
 * current step (line, data structures, canvas effects, op count) plus transport
 * controls. Stepping and scrubbing only index the trace; only playback is timed.
 */
@Injectable({ providedIn: 'root' })
export class RunStore {
  private readonly canvas = inject(CanvasStore);
  private readonly files = inject(FilesStore);

  private readonly result = signal<RunResult | null>(null);
  /** Index of the current step within the trace. */
  private readonly index = signal(0);
  readonly playing = signal(false);
  readonly speed = signal<number>(1);
  /** Which file the Run workspace executes — switchable from the entry selector. */
  readonly entryId = signal('main');
  /** The file currently chosen to run (falls back to the first file). */
  readonly entryFile = computed(
    () => this.files.files().find((f) => f.id === this.entryId()) ?? this.files.files()[0] ?? null,
  );

  /** Switch which file runs and re-run it from the start. */
  setEntry(id: string): void {
    this.entryId.set(id);
    this.build();
  }

  // ── Derived view of the current step ──────────────────────
  private readonly steps = computed(() => this.result()?.steps ?? []);
  readonly total = computed(() => this.steps().length);
  readonly hasRun = computed(() => this.total() > 0);
  readonly error = computed(() => this.result()?.error ?? null);

  private readonly currentStep = computed(() => this.steps()[this.index()] ?? null);
  /** 1-based line of the current step, or null once finished / before running. */
  readonly currentLine = computed(() => {
    const line = this.currentStep()?.line ?? 0;
    return line > 0 ? line : null;
  });
  readonly dataState = computed(() => this.currentStep()?.data ?? []);
  /** The running file's plain variables (name + current value), for the watch panel. */
  readonly vars = computed(() => this.currentStep()?.vars ?? []);
  readonly effects = computed(() => this.currentStep()?.effects ?? emptyEffects());
  readonly ops = computed(() => this.currentStep()?.ops ?? 0);

  // Canvas effects as maps/sets for cheap per-node lookups in the template.
  /** Vertex id → mark type for the current step (drives the per-type node colour). */
  readonly marks = computed(() => this.effects().marks);
  /** Edge key (`src->tgt`) → mark type for the current step. */
  readonly edgeMarks = computed(() => this.effects().markedEdges);
  /** Vertices an enclosing `for each` currently holds — the iteration cursor. */
  readonly cursorSet = computed(() => new Set(this.effects().cursors));
  /** The snackbar message to show at the current step, or null. */
  readonly message = computed(() => this.effects().message);

  /** The mark type on a vertex at the current step (`''` default), or null when unmarked. */
  markOf(id: string): string | null {
    return this.marks()[id] ?? null;
  }
  /** The mark type on an edge at the current step, or null when unmarked. */
  edgeMarkOf(edge: GEdge): string | null {
    const src = sourceNodeId(edge.outputId);
    const tgt = targetNodeId(edge.inputId);
    return this.edgeMarks()[`${src}->${tgt}`] ?? null;
  }
  /** The innermost active `for each` loop's progress, for the iteration popup. */
  readonly loop = computed(() => this.currentStep()?.loop ?? null);
  /** Up to 5 popup rows windowed around the current index (long loops don't grow). */
  readonly loopRows = computed<{ index: number; item: string }[]>(() => {
    const lp = this.loop();
    if (!lp) return [];
    const window = 5;
    const start = Math.max(0, Math.min(lp.index - 2, lp.items.length - window));
    return lp.items.slice(start, start + window).map((item, k) => ({ index: start + k, item }));
  });
  readonly labels = computed(() => this.effects().labels);

  // ── Run-canvas topology — drawn per step, so create/delete are visible ─────
  /** Graph vertices as of the current step (created/deleted ones included). */
  readonly graphNodes = computed<GNode[]>(() => {
    const g = this.currentStep()?.graph;
    if (!g) return this.canvas.nodes();
    return g.nodes.map(snapshotNodeToGNode);
  });
  /** Graph edges as of the current step. */
  readonly graphEdges = computed<GEdge[]>(() => {
    const g = this.currentStep()?.graph;
    if (!g) return this.canvas.edges();
    return g.edges.map(snapshotEdgeToGEdge);
  });
  /** Data-structure nodes drawn on the run canvas — only the rendered ones (panel-only structures are skipped). */
  readonly runDataNodes = computed<DataNode[]>(() => {
    const step = this.currentStep();
    if (!step) return this.canvas.dataNodes();
    return step.data.filter((d) => d.rendered).map(snapshotToDataNode);
  });
  /** Effect transition duration (ms), shortened as the playback speeds up. */
  readonly animMs = computed(() => Math.round(450 / this.speed()));
  readonly bigO = computed(() => this.result()?.bigO ?? { time: 'O(?)', space: 'O(?)' });
  /** Lines the algorithm wrote with printDebug during the last run (for the Algorithm debug panel). */
  readonly debug = computed(() => this.result()?.debug ?? []);
  readonly note = computed(() => this.currentStep()?.note ?? '');

  // ── Step-to-step change highlighting (panel flash) ─────────
  /** The step before the current one — the baseline for "what changed". Null at the very start. */
  private readonly prevStep = computed(() => (this.index() > 0 ? this.steps()[this.index() - 1] ?? null : null));

  /** Variable names whose displayed value differs from the previous step (newly-declared ones included). */
  readonly changedVars = computed<Set<string>>(() => {
    const before = this.prevStep();
    if (!before) return new Set();
    const prev = new Map(before.vars.map((v) => [v.name, v.value]));
    const out = new Set<string>();
    for (const v of this.vars()) if (prev.get(v.name) !== v.value) out.add(v.name);
    return out;
  });

  /** Per-structure diff vs the previous step, computed once and read by the cheap lookups below. */
  private readonly dataDiff = computed<Map<string, DataDiff>>(() => {
    const before = this.prevStep();
    const out = new Map<string, DataDiff>();
    if (!before) return out; // nothing has "changed" on the first step
    const prev = new Map(before.data.map((d) => [d.id, d]));
    for (const d of this.dataState()) out.set(d.id, diffData(prev.get(d.id), d));
    return out;
  });

  /** Whether a variable's value changed at the current step. */
  varChanged(name: string): boolean {
    return this.changedVars().has(name);
  }
  /** Whether a sequence/set item value was newly added at the current step. */
  itemChanged(dsId: string, value: string | number): boolean {
    return this.dataDiff().get(dsId)?.values.has(String(value)) ?? false;
  }
  /** Whether a priority-queue entry was newly added at the current step. */
  heapChanged(dsId: string, entry: HeapEntry): boolean {
    return this.dataDiff().get(dsId)?.values.has(heapKey(entry)) ?? false;
  }
  /** Whether a map key was added, or its value changed, at the current step. */
  entryChanged(dsId: string, key: string): boolean {
    return this.dataDiff().get(dsId)?.keys.has(key) ?? false;
  }
  /** Whether a matrix row's contents changed at the current step. */
  rowChanged(dsId: string, row: number): boolean {
    return this.dataDiff().get(dsId)?.rows.has(row) ?? false;
  }
  /** Whether a structure changed in any way (add / update / removal) — drives its header pulse. */
  dataChanged(dsId: string): boolean {
    return this.dataDiff().get(dsId)?.changed ?? false;
  }

  // ── Author-driven panel emphasis (spotlight / note built-ins) ─────────
  /** Panel entries the algorithm asked to spotlight at the current step. */
  private readonly spotlit = computed(() => new Set(this.effects().spotlight));
  /** Author notes pinned to panel entries at the current step. */
  private readonly panelNotes = computed(() => this.effects().notes);

  /** Whether a panel entry (variable name, or structure id/label) is spotlighted now. */
  isSpotlit(token: string): boolean {
    return this.spotlit().has(token);
  }
  /** The author note pinned to a panel entry at the current step, or null. */
  noteOf(token: string): string | null {
    return this.panelNotes()[token] ?? null;
  }

  // ── Pinning (pin / unpin built-ins) — float entries to the top of the panel ──
  /** Panel entries pinned at the current step, in pin order. */
  private readonly pins = computed(() => this.effects().pins);

  /** Whether a panel entry (variable name, or structure id/label) is pinned now. */
  isPinned(token: string): boolean {
    return this.pins().includes(token);
  }

  /** Variables with pinned ones floated to the top (pin order), the rest left as-is. */
  readonly varsView = computed(() => {
    const pins = this.pins();
    if (!pins.length) return this.vars();
    const rank = (name: string) => {
      const i = pins.indexOf(name);
      return i < 0 ? Infinity : -i; // most recently pinned (highest index) floats to the top
    };
    return [...this.vars()].sort((a, b) => rank(a.name) - rank(b.name)); // Array.sort is stable
  });

  /** Data structures with pinned ones floated to the top (matched by id or label). */
  readonly dataView = computed(() => {
    const pins = this.pins();
    if (!pins.length) return this.dataState();
    const rank = (d: { id: string; label: string }) => {
      const i = Math.max(pins.indexOf(d.id), pins.indexOf(d.label)); // one side is -1; take the match
      return i < 0 ? Infinity : -i; // most recently pinned floats to the top
    };
    return [...this.dataState()].sort((a, b) => rank(a) - rank(b));
  });

  // ── Transport state for the template ──────────────────────
  readonly stepNumber = computed(() => this.index());
  readonly lastStep = computed(() => Math.max(0, this.total() - 1));
  readonly atStart = computed(() => this.index() <= 0);
  readonly atEnd = computed(() => this.index() >= this.total() - 1);
  readonly progress = computed(() => (this.total() > 1 ? this.index() / (this.total() - 1) : 0));

  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Compile + run the entry against the current canvas; reset to the first step. */
  build(): void {
    this.pause();
    const files = this.files.files().map((f) => ({ id: f.id, name: f.name, content: f.content }));
    const input: RunInput = {
      entryId: this.entryFile()?.id ?? 'main',
      graph: this.graph(),
      data: this.canvas.dataNodes(),
    };
    const result = compileAndRun(files, input);
    this.result.set(result);
    this.index.set(0);
    // saveCanvas() in the program persists its graph; otherwise the canvas is untouched.
    if (result.savedCanvas) this.commit(result.savedCanvas);
  }

  /** Persist a saved graph back onto the canvas (replacing it). */
  private commit(saved: SavedCanvas): void {
    this.canvas.load({
      nodes: saved.nodes.map(snapshotNodeToGNode),
      edges: saved.edges.map(snapshotEdgeToGEdge),
      dataNodes: saved.data.map((d) => makeDataNode(d.kind, d.id, { x: d.x, y: d.y }, d.label)),
    });
  }

  stepForward(): void {
    this.pause();
    this.index.update((i) => Math.min(this.total() - 1, i + 1));
  }
  stepBack(): void {
    this.pause();
    this.index.update((i) => Math.max(0, i - 1));
  }
  seek(i: number): void {
    this.index.set(Math.max(0, Math.min(this.total() - 1, i)));
  }
  /** Re-run from scratch (picks up any edits to the code or canvas). */
  restart(): void {
    this.build();
  }

  play(): void {
    if (!this.hasRun()) this.build();
    if (this.atEnd()) this.index.set(0);
    this.playing.set(true);
    this.scheduleTick();
  }
  pause(): void {
    this.playing.set(false);
    this.clearTimer();
  }
  togglePlay(): void {
    if (this.playing()) this.pause();
    else this.play();
  }

  /** Cycle the playback speed (0.5× → 1× → 2× → 4× → …). */
  cycleSpeed(): void {
    const next = SPEEDS[(SPEEDS.indexOf(this.speed() as (typeof SPEEDS)[number]) + 1) % SPEEDS.length];
    this.speed.set(next);
    if (this.playing()) this.scheduleTick(); // apply the new dwell immediately
  }

  // ── Internals ─────────────────────────────────────────────
  private scheduleTick(): void {
    this.clearTimer();
    if (!this.playing()) return;
    this.timer = setTimeout(() => {
      if (!this.playing()) return;
      if (this.atEnd()) {
        this.pause();
        return;
      }
      this.index.update((i) => i + 1);
      this.scheduleTick();
    }, BASE_DWELL_MS / this.speed());
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Normalise the canvas into the graph the interpreter reads (strip port suffixes). */
  private graph(): GraphInput {
    const vertices = this.canvas.nodes().map((n) => ({
      id: n.id,
      label: n.label,
      type: n.kind,
      x: n.position.x,
      y: n.position.y,
    }));
    const edges = this.canvas.edges().map((e) => ({
      src: sourceNodeId(e.outputId),
      tgt: targetNodeId(e.inputId),
      weight: e.weight,
      directed: e.directed,
    }));
    return { vertices, edges };
  }
}
