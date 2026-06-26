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
import type { DataSnapshot, GraphInput, VertexRef } from './trace';

/** Cost accumulator — each charged operation adds to it. */
export type Charge = (units: number) => void;

/** A graph vertex; identity is the node id. */
export class Vertex implements VertexRef {
  constructor(
    readonly id: string,
    readonly label: string,
    readonly type: string,
  ) {}
}

/** An inclusive integer range produced by `a..b`, iterable by a counted loop. */
export class RangeValue {
  constructor(
    readonly from: number,
    readonly to: number,
  ) {}
}

export type Value =
  | number
  | string
  | boolean
  | null
  | Vertex
  | RangeValue
  | RDataStructure
  | Value[];

const log2 = (n: number): number => (n <= 1 ? 1 : Math.ceil(Math.log2(n)));

/** A stable key for set/map membership: vertices by id, primitives by value. */
export function keyOf(value: Value): string {
  if (value instanceof Vertex) return `v:${value.id}`;
  if (typeof value === 'number') return `n:${value}`;
  if (typeof value === 'string') return `s:${value}`;
  if (typeof value === 'boolean') return `b:${value}`;
  if (value === null) return 'nil';
  return `o:${String(value)}`;
}

/** How a value reads in the data panel (a vertex shows its label). */
export function display(value: Value): string | number {
  if (value instanceof Vertex) return value.label;
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
export class GraphValue {
  private readonly byId = new Map<string, Vertex>();
  private readonly adj = new Map<string, { vertex: Vertex; weight: number }[]>();
  private readonly weights = new Map<string, number>();

  constructor(
    graph: GraphInput,
    private readonly charge: Charge,
  ) {
    for (const v of graph.vertices) {
      const vertex = new Vertex(v.id, v.label, v.type);
      this.byId.set(v.id, vertex);
      this.adj.set(v.id, []);
    }
    for (const e of graph.edges) {
      this.link(e.src, e.tgt, e.weight);
      if (!e.directed) this.link(e.tgt, e.src, e.weight);
    }
  }

  private link(srcId: string, tgtId: string, weight: number): void {
    const tgt = this.byId.get(tgtId);
    const list = this.adj.get(srcId);
    if (!tgt || !list) return;
    list.push({ vertex: tgt, weight });
    this.weights.set(`${srcId}->${tgtId}`, weight);
  }

  nodes(): Vertex[] {
    this.charge(this.byId.size);
    return [...this.byId.values()];
  }
  edges(): Vertex[][] {
    this.charge(this.weights.size);
    return [];
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
}

// ── Data structures ───────────────────────────────────────────
export abstract class RDataStructure {
  constructor(
    readonly id: string,
    readonly label: string,
    readonly kind: DataStructureKind,
    protected readonly charge: Charge,
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

  protected unknown(method: string, line: number): never {
    throw new RuntimeError(`${this.label} has no method '${method}' (line ${line})`);
  }

  protected base(): Omit<DataSnapshot, 'items' | 'entries' | 'heap' | 'matrix'> {
    return { id: this.id, kind: this.kind, label: this.label };
  }
}

/** LIST / STACK / QUEUE share linear storage; only the method names differ. */
export class RList extends RDataStructure {
  private data: Value[] = [];

  call(method: string, args: Value[], line: number): Value {
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
      // Common
      case 'size': this.charge(1); return this.data.length;
      case 'isEmpty': this.charge(1); return this.data.length === 0;
      case 'clear': this.charge(this.data.length); this.data = []; return null;
      default: this.unknown(method, line);
    }
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
    switch (method) {
      case 'add': this.charge(1); this.data.set(keyOf(args[0]), args[0]); return null;
      case 'remove': this.charge(1); this.data.delete(keyOf(args[0])); return null;
      case 'contains': this.charge(1); return this.contains(args[0]);
      case 'size': this.charge(1); return this.data.size;
      case 'isEmpty': this.charge(1); return this.data.size === 0;
      case 'clear': this.charge(this.data.size); this.data.clear(); return null;
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
    switch (method) {
      case 'remove': this.charge(1); this.data.delete(keyOf(args[0])); return null;
      case 'keys': this.charge(this.data.size); return [...this.data.values()].map((e) => e.key);
      case 'values': this.charge(this.data.size); return [...this.data.values()].map((e) => e.value);
      case 'size': this.charge(1); return this.data.size;
      case 'isEmpty': this.charge(1); return this.data.size === 0;
      case 'clear': this.charge(this.data.size); this.data.clear(); return null;
      default: this.unknown(method, line);
    }
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
      case 'size': this.charge(1); return this.data.length;
      case 'isEmpty': this.charge(1); return this.data.length === 0;
      case 'clear': this.charge(this.data.length); this.data = []; return null;
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
  constructor(id: string, label: string, charge: Charge, private grid: number[][]) {
    super(id, label, 'MATRIX', charge);
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
  switch (node.kind) {
    case 'SET':
      return new RSet(node.id, node.label, 'SET', charge);
    case 'MAP':
      return new RMap(node.id, node.label, 'MAP', charge);
    case 'PQUEUE':
      return new RPQueue(node.id, node.label, 'PQUEUE', charge);
    case 'MATRIX':
      // Matrices are input data — kept (zeroed to the same shape) rather than emptied.
      return new RMatrix(node.id, node.label, charge, node.matrix.map((r) => r.map(() => 0)));
    case 'LIST':
    case 'STACK':
    case 'QUEUE':
      return new RList(node.id, node.label, node.kind, charge);
  }
}
