import { Injectable, computed, inject, signal } from '@angular/core';
import { CanvasStore } from './canvas.store';
import { FilesStore } from './files.store';
import { compileAndRun, type RunInput } from '../lang/run';
import { emptyEffects, type GraphInput, type RunResult } from '../lang/trace';

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
  readonly effects = computed(() => this.currentStep()?.effects ?? emptyEffects());
  readonly ops = computed(() => this.currentStep()?.ops ?? 0);
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
    const input: RunInput = { entryId: 'main', graph: this.graph(), data: this.canvas.dataNodes() };
    this.result.set(compileAndRun(files, input));
    this.index.set(0);
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
    const vertices = this.canvas.nodes().map((n) => ({ id: n.id, label: n.label, type: n.kind }));
    const edges = this.canvas.edges().map((e) => ({
      src: e.outputId.replace(/-out$/, ''),
      tgt: e.inputId.replace(/-in$/, ''),
      weight: e.weight,
      directed: e.directed,
    }));
    return { vertices, edges };
  }
}
