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
}

/** Live graph the program runs against (vertex ids, directed/undirected edges). */
export interface GraphInput {
  vertices: VertexRef[];
  edges: { src: string; tgt: string; weight: number; directed: boolean }[];
}

/** A data structure as the panel renders it — mirrors the renderable `DataNode` fields. */
export interface DataSnapshot {
  id: string;
  kind: DataStructureKind;
  label: string;
  items: (string | number)[];
  entries: MapEntry[];
  heap: HeapEntry[];
  matrix: number[][];
}

/** What the algorithm has asked the canvas to show at a given step. */
export interface CanvasEffects {
  /** Vertices marked visited (a settled highlight). */
  visited: string[];
  /** Vertices currently active / being examined (a brighter highlight). */
  active: string[];
  /** Highlighted edges, keyed `"srcId->tgtId"`. */
  markedEdges: string[];
  /** Per-vertex text labels, e.g. a distance. */
  labels: Record<string, string>;
  /** A vertex the canvas should pan to and centre (consumed once). */
  scrollTo: string | null;
}

export interface StepSnapshot {
  /** File the line belongs to (always the entry file for now). */
  fileId: string;
  /** 1-based line about to execute (0 once the program has finished). */
  line: number;
  data: DataSnapshot[];
  effects: CanvasEffects;
  /** Cumulative operation count up to and including this step. */
  ops: number;
  /** Optional human note, e.g. `call relax(A, B)`. */
  note?: string;
}

export interface RunResult {
  steps: StepSnapshot[];
  diagnostics: Diagnostic[];
  /** Runtime error that stopped execution, if any. */
  error: string | null;
  /** Estimated asymptotic complexity (filled by the complexity pass). */
  bigO: { time: string; space: string };
}

export function emptyEffects(): CanvasEffects {
  return { visited: [], active: [], markedEdges: [], labels: {}, scrollTo: null };
}
