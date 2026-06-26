/**
 * Execution trace — the eager record the Run workspace scrubs through.
 *
 * The interpreter runs the whole program up front and appends one `StepSnapshot`
 * per executed line of the entry file (`main`). Stepping forward/back, scrubbing
 * and playback are then just indexing into `steps`; nothing re-executes.
 */
import type { DataStructureKind, HeapEntry, MapEntry } from '../models/data-structure.model';
import type { Diagnostic } from './diagnostics';

/** A vertex value the algorithm passes around (identity is its node id). */
export interface VertexRef {
  id: string;
  label: string;
  /** Graph node kind — NODE / START / GOAL. */
  type: string;
  /** Canvas position (so created vertices can be drawn and committed). */
  x: number;
  y: number;
}

/** An edge in a topology snapshot. */
export interface EdgeSnapshot {
  id: string;
  src: string;
  tgt: string;
  weight: number;
  directed: boolean;
}

/** Live graph the program runs against (vertex ids, directed/undirected edges). */
export interface GraphInput {
  vertices: VertexRef[];
  edges: { src: string; tgt: string; weight: number; directed: boolean }[];
}

/** The graph topology at one step — the program may create/delete during a run. */
export interface GraphSnapshot {
  nodes: VertexRef[];
  edges: EdgeSnapshot[];
}

/** A data structure as the panel renders it — mirrors the renderable `DataNode` fields. */
export interface DataSnapshot {
  id: string;
  kind: DataStructureKind;
  label: string;
  /** Canvas position (so created structures can be drawn and committed). */
  x: number;
  y: number;
  /** Whether to draw this on the run canvas. False for panel-only structures. */
  rendered: boolean;
  items: (string | number)[];
  entries: MapEntry[];
  heap: HeapEntry[];
  matrix: number[][];
}

/**
 * A plain (non-data-structure) variable of the running file with its current value.
 * Data structures live in `DataSnapshot`; this tracks scalars — counters, the
 * current vertex, a `dist` lookup, a `neighbors(u)` list — so the Run panel can
 * watch them change step by step.
 */
export interface VarSnapshot {
  name: string;
  /** Pre-formatted display value, e.g. `7`, `C`, `[B, C]`, `nil`, `∞`. */
  value: string;
  /** Value category for tinting: vertex / number / text / bool / nil / list / other. */
  kind: string;
}

/** Where `scrollTo` should pan: a single vertex, or the midpoint of an edge. */
export type ScrollTarget =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; from: string; to: string };

/** A snackbar the algorithm flashes on screen via `showMessage`. */
export interface CanvasMessage {
  text: string;
  /** `''` default, or `success`/`danger`/`warn`/`info` — colours the snackbar. */
  type: string;
}

/** What the algorithm has asked the canvas to show at a given step. */
export interface CanvasEffects {
  /** Marked vertices → mark type (`''` default, or `success`/`danger`/`warn`/`info`). */
  marks: Record<string, string>;
  /** Marked edges, keyed `"srcId->tgtId"` → mark type. */
  markedEdges: Record<string, string>;
  /** Per-vertex text labels, e.g. a distance. */
  labels: Record<string, string>;
  /** Vertices held by an enclosing `for each` right now — the iteration cursor(s). */
  cursors: string[];
  /** A snackbar message to show, or null — persists until the next showMessage. */
  message: CanvasMessage | null;
  /** A vertex or edge the canvas should pan to and centre (consumed once). */
  scrollTo: ScrollTarget | null;
}

/** The innermost active `for each` loop's progress, shown in the iteration popup. */
export interface LoopFrame {
  /** Loop variable name, e.g. `node`. */
  varName: string;
  /** 1-based source line of the `for each` — the popup anchors here, fixed. */
  line: number;
  /** Display label of every element, in iteration order — the popup rows. */
  items: string[];
  /** 0-based index of the element being iterated right now. */
  index: number;
  /** When the loop iterates a data structure, its id — for the panel highlight. */
  dsId: string | null;
}

export interface StepSnapshot {
  /** File the line belongs to (always the entry file for now). */
  fileId: string;
  /** 1-based line about to execute (0 once the program has finished). */
  line: number;
  /** Graph topology as of this step (shared between steps that don't mutate it). */
  graph: GraphSnapshot;
  data: DataSnapshot[];
  /** Plain variables of the running file (scalars, vertices, lists) and their values. */
  vars: VarSnapshot[];
  effects: CanvasEffects;
  /** The enclosing for-each loop's progress, or null outside any loop. */
  loop: LoopFrame | null;
  /** Cumulative operation count up to and including this step. */
  ops: number;
  /** Optional human note, e.g. `call relax(A, B)`. */
  note?: string;
}

/** The canvas state an algorithm committed via `saveCanvas()`, ready to persist. */
export interface SavedCanvas {
  nodes: VertexRef[];
  edges: EdgeSnapshot[];
  data: { id: string; kind: DataStructureKind; label: string; x: number; y: number }[];
}

export interface RunResult {
  steps: StepSnapshot[];
  diagnostics: Diagnostic[];
  /** Runtime error that stopped execution, if any. */
  error: string | null;
  /** Estimated asymptotic complexity (filled by the complexity pass). */
  bigO: { time: string; space: string };
  /** Graph the program asked to persist (saveCanvas), or null to leave the canvas as-is. */
  savedCanvas: SavedCanvas | null;
}

export function emptyEffects(): CanvasEffects {
  return { marks: {}, markedEdges: {}, labels: {}, cursors: [], message: null, scrollTo: null };
}
