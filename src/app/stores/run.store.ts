import { Injectable, computed, inject, signal } from '@angular/core';
import { CanvasStore } from './canvas.store';
import { FilesStore } from './files.store';
import { compileAndRun, type RunInput } from '../lang/run';
import { emptyEffects, type GraphInput, type RunResult, type SavedCanvas } from '../lang/trace';
import type { GEdge, GNode, NodeKind } from '../models/graph.model';
import { makeDataNode, type DataNode } from '../models/data-structure.model';

/** Playback speeds, cycled by the transport's speed button. */
const SPEEDS = [0.5, 1, 2, 4] as const;
/** Dwell at 1× — one step roughly every two-thirds of a second. */
const BASE_DWELL_MS = 700;

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
    const src = edge.outputId.replace(/-out$/, '');
    const tgt = edge.inputId.replace(/-in$/, '');
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
    return g.nodes.map((n) => ({ id: n.id, kind: n.type as NodeKind, label: n.label, position: { x: n.x, y: n.y } }));
  });
  /** Graph edges as of the current step. */
  readonly graphEdges = computed<GEdge[]>(() => {
    const g = this.currentStep()?.graph;
    if (!g) return this.canvas.edges();
    return g.edges.map((e) => ({
      id: e.id,
      outputId: `${e.src}-out`,
      inputId: `${e.tgt}-in`,
      weight: e.weight,
      directed: e.directed,
    }));
  });
  /** Data-structure nodes as of the current step (live content + position). */
  readonly runDataNodes = computed<DataNode[]>(() => {
    const step = this.currentStep();
    if (!step) return this.canvas.dataNodes();
    return step.data.map((d) => ({
      id: d.id,
      kind: d.kind,
      label: d.label,
      position: { x: d.x, y: d.y },
      items: d.items,
      entries: d.entries,
      heap: d.heap,
      matrix: d.matrix,
    }));
  });
  /** Effect transition duration (ms), shortened as the playback speeds up. */
  readonly animMs = computed(() => Math.round(450 / this.speed()));
  readonly bigO = computed(() => this.result()?.bigO ?? { time: 'O(?)', space: 'O(?)' });
  readonly note = computed(() => this.currentStep()?.note ?? '');

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
      nodes: saved.nodes.map((n) => ({
        id: n.id,
        kind: n.type as NodeKind,
        label: n.label,
        position: { x: n.x, y: n.y },
      })),
      edges: saved.edges.map((e) => ({
        id: e.id,
        outputId: `${e.src}-out`,
        inputId: `${e.tgt}-in`,
        weight: e.weight,
        directed: e.directed,
      })),
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
      src: e.outputId.replace(/-out$/, ''),
      tgt: e.inputId.replace(/-in$/, ''),
      weight: e.weight,
      directed: e.directed,
    }));
    return { vertices, edges };
  }
}
