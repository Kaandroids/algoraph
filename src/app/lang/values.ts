/**
 * Runtime values for the interpreter.
 *
 * Holds the graph adapter (read live from the canvas), the data-structure
 * runtime classes that implement the `node-api.ts` methods, and the vertex /
 * range values the tree-walker passes around. Every operation that the API
 * attributes a cost to charges the shared operation counter (`charge`) so the
 * Run workspace can show the work growing in step with the complexity.
 */
import type {
  DataNode,
  DataStructureKind,
  HeapEntry,
  MapEntry,
} from '../models/data-structure.model';
import type { DataSnapshot, EdgeSnapshot, GraphSnapshot, VertexRef } from './trace';

/** Cost accumulator — each charged operation adds to it. */
export type Charge = (units: number) => void;

/** A graph vertex; identity is the node id. */
export class Vertex implements VertexRef {
  constructor(
    readonly id: string,
    readonly label: string,
    readonly type: string,
    readonly x: number,
    readonly y: number,
  ) {}
}

/**
 * An edge value returned by `edges()` — its two endpoints, weight and direction.
 * For an undirected edge `startVertex`/`endVertex` are simply the two ends in
 * storage order; the order carries no meaning, so read `isDirected` to know
 * whether `start → end` is a real direction.
 */
export class Edge {
  constructor(
    readonly startVertex: Vertex,
    readonly endVertex: Vertex,
    readonly weight: number,
    readonly isDirected: boolean,
  ) {}
}

/** An inclusive integer range produced by `a..b`, iterable by a counted loop. */
export class RangeValue {
  constructor(
    readonly from: number,
    readonly to: number,
  ) {}
}

/** A global namespace (`graph` / `canvas`) whose methods dispatch to the builtins. */
export class Namespace {
  constructor(readonly name: string) {}
}

export type Value =
  | number
  | string
  | boolean
  | null
  | Vertex
  | Edge
  | RangeValue
  | RDataStructure
  | Namespace
  | Value[];

const log2 = (n: number): number => (n <= 1 ? 1 : Math.ceil(Math.log2(n)));

/** A stable key for set/map membership: vertices by id, primitives by value. */
export function keyOf(value: Value): string {
  if (value instanceof Vertex) return `v:${value.id}`;
  if (value instanceof Edge) return `e:${value.startVertex.id}->${value.endVertex.id}`;
  if (typeof value === 'number') return `n:${value}`;
  if (typeof value === 'string') return `s:${value}`;
  if (typeof value === 'boolean') return `b:${value}`;
  if (value === null) return 'nil';
  return `o:${String(value)}`;
}

/** How a value reads in the data panel (a vertex shows its label). */
export function display(value: Value): string | number {
  if (value instanceof Vertex) return value.label;
  if (value instanceof Edge) return `${value.startVertex.label} ${value.isDirected ? '→' : '—'} ${value.endVertex.label}`;
  if (value === Infinity) return '∞';
  if (value === -Infinity) return '-∞';
  if (value === null) return 'nil';
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(display).join(', ')}]`;
  return String(value);
}

export class RuntimeError extends Error {}

// ── Graph adapter ─────────────────────────────────────────────
/** The live graph the program reads and (via create/delete) mutates. */
export class GraphValue {
  private readonly byId = new Map<string, Vertex>();
  private readonly edgeList: EdgeSnapshot[] = [];
  private adj = new Map<string, { vertex: Vertex; weight: number }[]>();
  private weights = new Map<string, number>();
  private nextNode = 1;
  private nextEdge = 1;
  // Topology snapshot is cached and only rebuilt after a mutation, so steps that
  // don't touch the graph share one object (cheap, and step-back stays trivial).
  private dirty = true;
  private snap: GraphSnapshot = { nodes: [], edges: [] };

  constructor(
    graph: { vertices: VertexRef[]; edges: { src: string; tgt: string; weight: number; directed: boolean }[] },
    private readonly charge: Charge,
  ) {
    for (const v of graph.vertices) this.byId.set(v.id, new Vertex(v.id, v.label, v.type, v.x, v.y));
    for (const e of graph.edges) this.edgeList.push({ id: `e${this.nextEdge++}`, ...e });
    this.nextNode = maxIdNum([...this.byId.keys()], 'n') + 1;
    this.reindex();
  }

  // ── Reads ───────────────────────────────────────────────────
  nodes(): Vertex[] {
    this.charge(this.byId.size);
    return [...this.byId.values()];
  }
  edges(): Edge[] {
    this.charge(Math.max(1, this.edgeList.length));
    const out: Edge[] = [];
    for (const e of this.edgeList) {
      const s = this.byId.get(e.src);
      const t = this.byId.get(e.tgt);
      if (s && t) out.push(new Edge(s, t, e.weight, e.directed));
    }
    return out;
  }
  neighbors(u: Vertex): Vertex[] {
    const list = this.adj.get(u.id) ?? [];
    this.charge(Math.max(1, list.length));
    return list.map((e) => e.vertex);
  }
  weight(u: Vertex, v: Vertex): number {
    this.charge(1);
    return this.weights.get(`${u.id}->${v.id}`) ?? Infinity;
  }
  hasEdge(u: Vertex, v: Vertex): boolean {
    this.charge(1);
    return this.weights.has(`${u.id}->${v.id}`);
  }
  degree(u: Vertex): number {
    this.charge(1);
    return (this.adj.get(u.id) ?? []).length;
  }
  source(): Vertex | null {
    this.charge(1);
    return [...this.byId.values()].find((v) => v.type === 'START') ?? null;
  }
  goal(): Vertex | null {
    this.charge(1);
    return [...this.byId.values()].find((v) => v.type === 'GOAL') ?? null;
  }

  // ── Mutations (createNode / createEdge / delete / clear) ─────
  createNode(x: number, y: number, name?: string): Vertex {
    this.charge(1);
    const num = this.nextNode++;
    const id = `n${num}`;
    const v = new Vertex(id, this.uniqueLabel(name ?? `N${num}`), 'NODE', x, y);
    this.byId.set(id, v);
    this.adj.set(id, []);
    this.dirty = true;
    return v;
  }
  deleteNode(u: Vertex): void {
    this.charge(1);
    this.byId.delete(u.id);
    for (let i = this.edgeList.length - 1; i >= 0; i--) {
      const e = this.edgeList[i];
      if (e.src === u.id || e.tgt === u.id) this.edgeList.splice(i, 1);
    }
    this.reindex();
  }
  createEdge(u: Vertex, v: Vertex, weight: number, directed: boolean): void {
    this.charge(1);
    this.edgeList.push({ id: `e${this.nextEdge++}`, src: u.id, tgt: v.id, weight, directed });
    this.reindex();
  }
  deleteEdge(u: Vertex, v: Vertex): void {
    this.charge(1);
    for (let i = this.edgeList.length - 1; i >= 0; i--) {
      const e = this.edgeList[i];
      const hit = (e.src === u.id && e.tgt === v.id) || (!e.directed && e.src === v.id && e.tgt === u.id);
      if (hit) this.edgeList.splice(i, 1);
    }
    this.reindex();
  }
  clear(): void {
    this.charge(1);
    this.byId.clear();
    this.edgeList.length = 0;
    this.reindex();
  }

  snapshot(): GraphSnapshot {
    if (this.dirty) {
      this.snap = {
        nodes: [...this.byId.values()].map((v) => ({ id: v.id, label: v.label, type: v.type, x: v.x, y: v.y })),
        edges: this.edgeList.map((e) => ({ ...e })),
      };
      this.dirty = false;
    }
    return this.snap;
  }

  // ── Internals ───────────────────────────────────────────────
  private reindex(): void {
    this.adj = new Map();
    this.weights = new Map();
    for (const id of this.byId.keys()) this.adj.set(id, []);
    for (const e of this.edgeList) {
      this.link(e.src, e.tgt, e.weight);
      if (!e.directed) this.link(e.tgt, e.src, e.weight);
    }
    this.dirty = true;
  }
  private link(srcId: string, tgtId: string, weight: number): void {
    const tgt = this.byId.get(tgtId);
    const list = this.adj.get(srcId);
    if (!tgt || !list) return;
    list.push({ vertex: tgt, weight });
    this.weights.set(`${srcId}->${tgtId}`, weight);
  }
  private uniqueLabel(base: string): string {
    const used = new Set([...this.byId.values()].map((v) => v.label.toLowerCase()));
    if (!used.has(base.toLowerCase())) return base;
    let i = 2;
    while (used.has(`${base}${i}`.toLowerCase())) i++;
    return `${base}${i}`;
  }
}

/** Highest numeric suffix among ids with the given prefix (`n3` → 3, else 0). */
function maxIdNum(ids: string[], prefix: string): number {
  let max = 0;
  for (const id of ids) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

// ── Data structures ───────────────────────────────────────────
export abstract class RDataStructure {
  constructor(
    readonly id: string,
    readonly label: string,
    readonly kind: DataStructureKind,
    protected readonly charge: Charge,
    readonly x: number,
    readonly y: number,
    /** Whether to draw this on the canvas (false for off-canvas scratch / panel structures). */
    readonly rendered = true,
    /** Whether to list this in the run data panel (false for fully-hidden scratch structures). */
    readonly tracked = true,
  ) {}

  /** Dispatch a method call from `obj.method(args)`. */
  abstract call(method: string, args: Value[], line: number): Value;
  /** Membership test for `x in obj`. */
  abstract contains(value: Value): boolean;
  /** Renderable view for the Run data panel. */
  abstract snapshot(): DataSnapshot;
  /** Elements yielded by `for each x in this` (empty for non-iterable kinds). */
  elements(): Value[] {
    return [];
  }

  /**
   * How many indices subscripting takes — 1 for a list or map (`a[i]`, `m[k]`),
   * 2 for a matrix (`M[i][j]`), 0 (the default) for kinds that can't be indexed.
   * Lets the interpreter route every `a[i]` / `a[i] ← x` through one abstraction
   * instead of testing for each concrete subclass.
   */
  readonly rank: number = 0;

  /** Read `this[…]`; the index count matches `rank`. Not indexable by default. */
  subscriptGet(_indices: Value[], line: number): Value {
    throw new RuntimeError(`Cannot index ${this.label} (line ${line})`);
  }

  /** Write `this[…] ← value`. Not assignable by default. */
  subscriptSet(_indices: Value[], _value: Value, line: number): void {
    throw new RuntimeError(`Cannot assign into ${this.label} (line ${line})`);
  }

  /**
   * The bookkeeping methods every collection shares — `size`, `isEmpty` and
   * `clear` — so each concrete `call` only spells out its own operations.
   * `count` is the live element count and `empty` drops the backing store.
   * Returns `undefined` when `method` isn't one of the shared three.
   */
  protected common(method: string, count: number, empty: () => void): Value | undefined {
    switch (method) {
      case 'size': this.charge(1); return count;
      case 'isEmpty': this.charge(1); return count === 0;
      case 'clear': this.charge(count); empty(); return null;
      default: return undefined;
    }
  }

  protected unknown(method: string, line: number): never {
    throw new RuntimeError(`${this.label} has no method '${method}' (line ${line})`);
  }

  protected base(): Omit<DataSnapshot, 'items' | 'entries' | 'heap' | 'matrix'> {
    return { id: this.id, kind: this.kind, label: this.label, x: this.x, y: this.y, rendered: this.rendered };
  }
}

/** LIST / STACK / QUEUE share linear storage; only the method names differ. */
export class RList extends RDataStructure {
  private data: Value[] = [];

  call(method: string, args: Value[], line: number): Value {
    const shared = this.common(method, this.data.length, () => { this.data = []; });
    if (shared !== undefined) return shared;
    switch (method) {
      // List
      case 'push': this.charge(1); this.data.push(args[0]); return null;
      case 'pop': this.charge(1); return this.data.pop() ?? null;
      case 'insert': this.charge(this.data.length); this.data.splice(Number(args[0]), 0, args[1]); return null;
      case 'removeAt': this.charge(this.data.length); this.data.splice(Number(args[0]), 1); return null;
      case 'contains': this.charge(this.data.length); return this.contains(args[0]);
      case 'indexOf': this.charge(this.data.length); return this.data.findIndex((x) => keyOf(x) === keyOf(args[0]));
      // Stack
      case 'peek': this.charge(1); return this.data[this.data.length - 1] ?? null;
      // Queue
      case 'enqueue': this.charge(1); this.data.push(args[0]); return null;
      case 'dequeue': this.charge(1); return this.data.shift() ?? null;
      case 'front': this.charge(1); return this.data[0] ?? null;
      default: this.unknown(method, line);
    }
  }
  override readonly rank = 1;
  override subscriptGet(indices: Value[]): Value {
    return this.get(Number(indices[0]));
  }
  override subscriptSet(indices: Value[], value: Value): void {
    this.set(Number(indices[0]), value);
  }
  /** Index read for `list[i]`. */
  get(i: number): Value {
    this.charge(1);
    return this.data[i] ?? null;
  }
  /** Index write for `list[i] ← x`. */
  set(i: number, value: Value): void {
    this.charge(1);
    this.data[i] = value;
  }
  contains(value: Value): boolean {
    return this.data.some((x) => keyOf(x) === keyOf(value));
  }
  override elements(): Value[] {
    return [...this.data];
  }
  snapshot(): DataSnapshot {
    return { ...this.base(), items: this.data.map(display), entries: [], heap: [], matrix: [] };
  }
}

export class RSet extends RDataStructure {
  private data = new Map<string, Value>();

  call(method: string, args: Value[], line: number): Value {
    const shared = this.common(method, this.data.size, () => this.data.clear());
    if (shared !== undefined) return shared;
    switch (method) {
      case 'add': this.charge(1); this.data.set(keyOf(args[0]), args[0]); return null;
      case 'remove': this.charge(1); this.data.delete(keyOf(args[0])); return null;
      case 'contains': this.charge(1); return this.contains(args[0]);
      default: this.unknown(method, line);
    }
  }
  contains(value: Value): boolean {
    this.charge(1);
    return this.data.has(keyOf(value));
  }
  override elements(): Value[] {
    return [...this.data.values()];
  }
  snapshot(): DataSnapshot {
    return { ...this.base(), items: [...this.data.values()].map(display), entries: [], heap: [], matrix: [] };
  }
}

export class RMap extends RDataStructure {
  private data = new Map<string, { key: Value; value: Value }>();

  call(method: string, args: Value[], line: number): Value {
    const shared = this.common(method, this.data.size, () => this.data.clear());
    if (shared !== undefined) return shared;
    switch (method) {
      case 'remove': this.charge(1); this.data.delete(keyOf(args[0])); return null;
      case 'keys': this.charge(this.data.size); return [...this.data.values()].map((e) => e.key);
      case 'values': this.charge(this.data.size); return [...this.data.values()].map((e) => e.value);
      default: this.unknown(method, line);
    }
  }
  override readonly rank = 1;
  override subscriptGet(indices: Value[]): Value {
    return this.get(indices[0]);
  }
  override subscriptSet(indices: Value[], value: Value): void {
    this.set(indices[0], value);
  }
  /** Read for `map[k]`. */
  get(key: Value): Value {
    this.charge(1);
    return this.data.get(keyOf(key))?.value ?? null;
  }
  /** Write for `map[k] ← v`. */
  set(key: Value, value: Value): void {
    this.charge(1);
    this.data.set(keyOf(key), { key, value });
  }
  contains(value: Value): boolean {
    this.charge(1);
    return this.data.has(keyOf(value));
  }
  override elements(): Value[] {
    return [...this.data.values()].map((e) => e.key);
  }
  snapshot(): DataSnapshot {
    const entries: MapEntry[] = [...this.data.values()].map((e) => ({
      key: String(display(e.key)),
      value: display(e.value),
    }));
    return { ...this.base(), items: [], entries, heap: [], matrix: [] };
  }
}

/** Min-heap kept sorted ascending by priority; operations charge the heap cost. */
export class RPQueue extends RDataStructure {
  private data: { item: Value; priority: number }[] = [];

  call(method: string, args: Value[], line: number): Value {
    const shared = this.common(method, this.data.length, () => { this.data = []; });
    if (shared !== undefined) return shared;
    switch (method) {
      case 'push': {
        this.charge(log2(this.data.length + 1));
        this.insert(args[0], Number(args[1]));
        return null;
      }
      case 'popMin': {
        this.charge(log2(this.data.length + 1));
        return this.data.shift()?.item ?? null;
      }
      case 'peekMin': this.charge(1); return this.data[0]?.item ?? null;
      case 'decreaseKey': {
        this.charge(this.data.length + log2(this.data.length + 1));
        const k = keyOf(args[0]);
        const entry = this.data.find((e) => keyOf(e.item) === k);
        if (entry) {
          entry.priority = Number(args[1]);
          this.data.sort((a, b) => a.priority - b.priority);
        }
        return null;
      }
      default: this.unknown(method, line);
    }
  }
  private insert(item: Value, priority: number): void {
    const at = this.data.findIndex((e) => e.priority > priority);
    const entry = { item, priority };
    if (at === -1) this.data.push(entry);
    else this.data.splice(at, 0, entry);
  }
  contains(value: Value): boolean {
    this.charge(1);
    const k = keyOf(value);
    return this.data.some((e) => keyOf(e.item) === k);
  }
  override elements(): Value[] {
    return this.data.map((e) => e.item);
  }
  snapshot(): DataSnapshot {
    const heap: HeapEntry[] = this.data.map((e) => ({ value: String(display(e.item)), priority: e.priority }));
    return { ...this.base(), items: [], entries: [], heap, matrix: [] };
  }
}

export class RMatrix extends RDataStructure {
  constructor(id: string, label: string, charge: Charge, x: number, y: number, private grid: number[][], rendered = true, tracked = true) {
    super(id, label, 'MATRIX', charge, x, y, rendered, tracked);
  }
  call(method: string, args: Value[], line: number): Value {
    switch (method) {
      case 'rows': this.charge(1); return this.grid.length;
      case 'cols': this.charge(1); return this.grid[0]?.length ?? 0;
      case 'fill': {
        const x = Number(args[0]);
        this.charge(this.grid.length * (this.grid[0]?.length ?? 0));
        this.grid = this.grid.map((row) => row.map(() => x));
        return null;
      }
      default: this.unknown(method, line);
    }
  }
  override readonly rank = 2;
  override subscriptGet(indices: Value[], line: number): Value {
    if (indices.length !== 2) throw new RuntimeError(`A matrix is indexed as M[i][j] (line ${line})`);
    return this.get(Number(indices[0]), Number(indices[1]));
  }
  override subscriptSet(indices: Value[], value: Value, line: number): void {
    if (indices.length !== 2) throw new RuntimeError(`A matrix is indexed as M[i][j] (line ${line})`);
    this.set(Number(indices[0]), Number(indices[1]), value);
  }
  get(i: number, j: number): Value {
    this.charge(1);
    return this.grid[i]?.[j] ?? 0;
  }
  set(i: number, j: number, value: Value): void {
    this.charge(1);
    if (this.grid[i]) this.grid[i][j] = Number(value);
  }
  contains(): boolean {
    return false;
  }
  snapshot(): DataSnapshot {
    return { ...this.base(), items: [], entries: [], heap: [], matrix: this.grid.map((r) => [...r]) };
  }
}

/** Build a fresh, empty runtime structure for a canvas data node. */
export function makeRuntimeDS(node: DataNode, charge: Charge): RDataStructure {
  const { x, y } = node.position;
  const rows = node.matrix.length || 1;
  const cols = node.matrix[0]?.length || 1;
  return makeRuntimeDSByKind(node.kind, node.id, node.label, x, y, charge, rows, cols);
}

/** Build a fresh, empty runtime structure from scratch — used by the `create*` builtins. */
export function makeRuntimeDSByKind(
  kind: DataStructureKind,
  id: string,
  label: string,
  x: number,
  y: number,
  charge: Charge,
  rows = 1,
  cols = 1,
  rendered = true,
  tracked = true,
): RDataStructure {
  switch (kind) {
    case 'SET':
      return new RSet(id, label, 'SET', charge, x, y, rendered, tracked);
    case 'MAP':
      return new RMap(id, label, 'MAP', charge, x, y, rendered, tracked);
    case 'PQUEUE':
      return new RPQueue(id, label, 'PQUEUE', charge, x, y, rendered, tracked);
    case 'MATRIX':
      return new RMatrix(id, label, charge, x, y, Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0)), rendered, tracked);
    case 'LIST':
    case 'STACK':
    case 'QUEUE':
      return new RList(id, label, kind, charge, x, y, rendered, tracked);
  }
}
