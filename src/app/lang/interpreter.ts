/**
 * Tree-walking interpreter that runs the entry file eagerly and records a Trace.
 *
 * Stepping is line-by-line over `main`: each executed statement appends a
 * snapshot of the data structures, the canvas effects and the running operation
 * count. A call to a user function is **stepped over** — its body runs to
 * completion as part of the call line's step, never descending — which matches
 * the Run workspace's "main goes line by line, helpers are one step" model.
 */
import type { Expr, FunctionDecl, Module, Stmt } from './ast';
import type { CanvasEffects, CanvasMessage, DataSnapshot, LoopFrame, RunResult, SavedCanvas, ScrollTarget, StepSnapshot, VarSnapshot, VertexRef } from './trace';
import { emptyEffects } from './trace';
import { DATA_STRUCTURES, type DataNode, type DataStructureKind } from '../models/data-structure.model';
import {
  Edge,
  GraphValue,
  Namespace,
  RDataStructure,
  RList,
  RMap,
  RMatrix,
  RangeValue,
  RuntimeError,
  Vertex,
  display,
  keyOf,
  makeRuntimeDS,
  makeRuntimeDSByKind,
  type Value,
} from './values';

/** Everything the interpreter needs that doesn't come from the source. */
export interface RunInput {
  entryId: string;
  graph: { vertices: VertexRef[]; edges: { src: string; tgt: string; weight: number; directed: boolean }[] };
  data: DataNode[];
}

const MAX_STEPS = 100_000;

/** A live `for each` loop on the interpreter's stack (snapshotted as a `LoopFrame`). */
interface LoopFrameState {
  varName: string;
  line: number;
  items: string[];
  index: number;
  dsId: string | null;
  /** Current element's vertex id, if it is a vertex — drives the canvas cursor. */
  cursorId: string | null;
}

// Control-flow signals, thrown to unwind loops and calls.
class ContinueSignal {}
class BreakSignal {}
class ReturnSignal {
  constructor(readonly value: Value) {}
}

/** A create*'s optional trailing `name` argument as a string, or undefined if omitted. */
function optionalName(value: Value | undefined): string | undefined {
  return value != null ? String(display(value)) : undefined;
}

/** `scratch.createMap()` / `panel.createMap()` → the kind of off-canvas structure it builds. */
const OFF_CANVAS_KINDS: Record<string, DataStructureKind> = {
  createList: 'LIST',
  createStack: 'STACK',
  createQueue: 'QUEUE',
  createSet: 'SET',
  createMap: 'MAP',
  createPQueue: 'PQUEUE',
  createMatrix: 'MATRIX',
};

/** A mark's optional `type` argument (`danger`/`warn`/…); `''` is the default highlight. */
function markType(value: Value | undefined): string {
  return typeof value === 'string' ? value : '';
}

/** Coarse value category for a watched variable, so the panel can tint it. */
function varKind(value: Value): string {
  if (value instanceof Vertex) return 'vertex';
  if (value instanceof Edge) return 'edge';
  if (Array.isArray(value)) return 'list';
  if (value === null) return 'nil';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'string') return 'text';
  return 'other';
}

export class Interpreter {
  private readonly steps: StepSnapshot[] = [];
  private opCount = 0;
  private stepping = true;
  private error: string | null = null;

  private readonly charge = (units: number): void => {
    this.opCount += units;
  };

  private readonly graph: GraphValue;
  private readonly dsList: RDataStructure[];
  private readonly dsByLabel = new Map<string, RDataStructure>();
  private nextDataId: number;
  /** Graph the program asked to persist via saveCanvas() (last call wins), or null. */
  private savedCanvas: SavedCanvas | null = null;
  private readonly functions: Map<string, FunctionDecl>;
  private readonly entryStmts: Stmt[];
  private readonly entryId: string;

  // Mutable canvas effects, snapshotted (and scroll consumed) on each step.
  private marks = new Map<string, string>(); // vertex id → mark type
  private markedEdges = new Map<string, string>(); // edge key → mark type
  private labels = new Map<string, string>();
  private message: CanvasMessage | null = null; // snackbar, persists until changed
  private scrollTo: ScrollTarget | null = null;
  // Stack of active `for each` loops, innermost last. Each frame drives the
  // iteration popup and (when its element is a vertex) the canvas cursor + pan,
  // so a loop visualizes itself without the algorithm marking anything.
  private readonly loopFrames: LoopFrameState[] = [];

  private scope = new Map<string, Value>();

  constructor(
    entry: Module,
    functions: Map<string, FunctionDecl>,
    input: RunInput,
  ) {
    this.entryId = input.entryId;
    this.functions = functions;
    this.entryStmts = entry.items.filter((i): i is Stmt => i.kind !== 'function');
    this.graph = new GraphValue({ vertices: input.graph.vertices, edges: input.graph.edges }, this.charge);
    this.dsList = input.data.map((node) => makeRuntimeDS(node, this.charge));
    for (const ds of this.dsList) this.dsByLabel.set(ds.label, ds);
    this.nextDataId = Math.max(0, ...input.data.map((d) => Number(/^ds(\d+)$/.exec(d.id)?.[1] ?? 0))) + 1;
  }

  run(): RunResult {
    try {
      this.emit(this.firstLine(), 'start');
      this.execBlock(this.entryStmts);
      this.emit(0, 'done');
    } catch (e) {
      if (e instanceof ReturnSignal || e instanceof ContinueSignal || e instanceof BreakSignal) {
        this.emit(0, 'done');
      } else if (e instanceof RuntimeError) {
        this.error = e.message;
        this.emit(0, 'error');
      } else {
        throw e;
      }
    }
    return {
      steps: this.steps,
      diagnostics: [],
      error: this.error,
      bigO: { time: 'O(?)', space: 'O(?)' },
      savedCanvas: this.savedCanvas,
    };
  }

  // ── Stepping ────────────────────────────────────────────────
  private firstLine(): number {
    return this.entryStmts[0]?.line ?? 1;
  }

  private emit(line: number, note?: string): void {
    if (!this.stepping) return;
    if (this.steps.length >= MAX_STEPS) {
      throw new RuntimeError(`Execution exceeded ${MAX_STEPS} steps (possible infinite loop)`);
    }
    this.steps.push({
      fileId: this.entryId,
      line,
      graph: this.graph.snapshot(),
      // Tracked structures reach the data panel (and, if rendered, the canvas). Fully-hidden
      // scratch structures (tracked = false) are left out of the trace entirely.
      data: this.dsList.filter((d) => d.tracked).map((d) => d.snapshot()) as DataSnapshot[],
      vars: this.snapshotVars(),
      effects: this.snapshotEffects(),
      loop: this.snapshotLoop(),
      ops: this.opCount,
      note,
    });
    this.scrollTo = null; // a pan is consumed by the step that shows it
  }

  /**
   * The running file's plain variables and their current values. Data structures
   * are excluded — they have their own panel — leaving scalars, vertices and the
   * lists returned by graph queries. `this.scope` holds the entry file's top-level
   * bindings (helper calls run in a swapped scope with stepping off), so every
   * emitted step sees exactly the variables the user wrote in this file.
   */
  private snapshotVars(): VarSnapshot[] {
    const out: VarSnapshot[] = [];
    for (const [name, value] of this.scope) {
      if (value instanceof RDataStructure) continue;
      const text = String(display(value));
      out.push({
        name,
        value: text.length > 42 ? `${text.slice(0, 41)}…` : text,
        kind: varKind(value),
      });
    }
    return out;
  }

  /** The innermost active loop's progress for this step (items shared, index copied). */
  private snapshotLoop(): LoopFrame | null {
    const top = this.loopFrames[this.loopFrames.length - 1];
    if (!top) return null;
    return { varName: top.varName, line: top.line, items: top.items, index: top.index, dsId: top.dsId };
  }

  private snapshotEffects(): CanvasEffects {
    const effects = emptyEffects();
    effects.marks = Object.fromEntries(this.marks);
    effects.markedEdges = Object.fromEntries(this.markedEdges);
    effects.labels = Object.fromEntries(this.labels);
    effects.cursors = [...new Set(this.loopFrames.map((f) => f.cursorId).filter((id): id is string => id !== null))];
    effects.message = this.message;
    effects.scrollTo = this.scrollTo;
    return effects;
  }

  // ── Statements ──────────────────────────────────────────────
  private execBlock(stmts: Stmt[]): void {
    for (const stmt of stmts) this.execStmt(stmt);
  }

  private execStmt(stmt: Stmt): void {
    switch (stmt.kind) {
      case 'assign':
        this.doAssign(stmt.target, this.evalExpr(stmt.value));
        this.emit(stmt.line);
        break;
      case 'exprStmt':
        this.evalExpr(stmt.expr);
        this.emit(stmt.line);
        break;
      case 'if': {
        const taken = this.truthy(this.evalExpr(stmt.cond));
        this.emit(stmt.line);
        if (taken) this.execBlock(stmt.thenBody);
        else if (stmt.elseBody) this.execBlock(stmt.elseBody);
        break;
      }
      case 'while':
        for (;;) {
          const more = this.truthy(this.evalExpr(stmt.cond));
          this.emit(stmt.line);
          if (!more) break;
          try {
            this.execBlock(stmt.body);
          } catch (e) {
            if (e instanceof ContinueSignal) continue;
            if (e instanceof BreakSignal) break;
            throw e;
          }
        }
        break;
      case 'forIn': {
        const iterable = this.evalExpr(stmt.iterable);
        const seq = this.toIterable(iterable);
        const frame: LoopFrameState = {
          varName: stmt.varName,
          line: stmt.line,
          items: seq.map((v) => String(display(v))),
          index: 0,
          dsId: iterable instanceof RDataStructure ? iterable.id : null,
          cursorId: null,
        };
        this.loopFrames.push(frame);
        try {
          for (let i = 0; i < seq.length; i++) {
            const elem = seq[i];
            this.scope.set(stmt.varName, elem);
            frame.index = i;
            // A vertex element becomes the canvas cursor and the canvas follows it.
            frame.cursorId = elem instanceof Vertex ? elem.id : null;
            if (elem instanceof Vertex) this.scrollTo = { kind: 'node', id: elem.id };
            this.emit(stmt.line);
            try {
              this.execBlock(stmt.body);
            } catch (e) {
              if (e instanceof ContinueSignal) continue;
              if (e instanceof BreakSignal) break;
              throw e;
            }
          }
        } finally {
          this.loopFrames.pop();
        }
        break;
      }
      case 'continue':
        this.emit(stmt.line);
        throw new ContinueSignal();
      case 'break':
        this.emit(stmt.line);
        throw new BreakSignal();
      case 'return': {
        const value = stmt.value ? this.evalExpr(stmt.value) : null;
        this.emit(stmt.line);
        throw new ReturnSignal(value);
      }
    }
  }

  private doAssign(target: Expr, value: Value): void {
    if (target.kind === 'name') {
      this.scope.set(target.name, value);
      return;
    }
    if (target.kind === 'index') {
      // Matrix: M[i][j] ← x
      if (target.object.kind === 'index') {
        const base = this.evalExpr(target.object.object);
        if (base instanceof RMatrix) {
          base.set(Number(this.evalExpr(target.object.index)), Number(this.evalExpr(target.index)), value);
          return;
        }
      }
      const obj = this.evalExpr(target.object);
      const idx = this.evalExpr(target.index);
      if (obj instanceof RMap) obj.set(idx, value);
      else if (obj instanceof RList) obj.set(Number(idx), value);
      else throw new RuntimeError(`Cannot assign into ${display(obj)} (line ${target.line})`);
      return;
    }
    throw new RuntimeError(`Invalid assignment target (line ${target.line})`);
  }

  // ── Expressions ─────────────────────────────────────────────
  private evalExpr(expr: Expr): Value {
    switch (expr.kind) {
      case 'num': return expr.value;
      case 'str': return expr.value;
      case 'atom': return this.atom(expr.name);
      case 'name': return this.lookup(expr.name, expr.line);
      case 'range':
        return new RangeValue(Number(this.evalExpr(expr.from)), Number(this.evalExpr(expr.to)));
      case 'unary': {
        if (expr.op === 'not') return !this.truthy(this.evalExpr(expr.operand));
        return -Number(this.evalExpr(expr.operand));
      }
      case 'binary': return this.evalBinary(expr);
      case 'index': return this.evalIndex(expr);
      case 'member': return this.evalMember(expr);
      case 'call': return this.evalCall(expr);
    }
  }

  private evalBinary(expr: Extract<Expr, { kind: 'binary' }>): Value {
    const { op } = expr;
    if (op === 'and') return this.truthy(this.evalExpr(expr.left)) && this.truthy(this.evalExpr(expr.right));
    if (op === 'or') return this.truthy(this.evalExpr(expr.left)) || this.truthy(this.evalExpr(expr.right));
    const left = this.evalExpr(expr.left);
    const right = this.evalExpr(expr.right);
    switch (op) {
      case '=': return keyOf(left) === keyOf(right);
      case '≠': return keyOf(left) !== keyOf(right);
      case '<': return Number(left) < Number(right);
      case '>': return Number(left) > Number(right);
      case '≤': return Number(left) <= Number(right);
      case '≥': return Number(left) >= Number(right);
      case '+':
        // String on either side concatenates (e.g. "N" + i); otherwise numeric add.
        return typeof left === 'string' || typeof right === 'string'
          ? `${display(left)}${display(right)}`
          : Number(left) + Number(right);
      case '-': return Number(left) - Number(right);
      case '*': return Number(left) * Number(right);
      case '/': return Number(left) / Number(right);
      case '%': return Number(left) % Number(right);
      case 'in': return this.member(left, right);
      default: throw new RuntimeError(`Unknown operator '${op}' (line ${expr.line})`);
    }
  }

  private member(value: Value, container: Value): boolean {
    if (container instanceof RDataStructure) return container.contains(value);
    if (Array.isArray(container)) return container.some((x) => keyOf(x) === keyOf(value));
    return false;
  }

  private evalIndex(expr: Extract<Expr, { kind: 'index' }>): Value {
    // Matrix: M[i][j]
    if (expr.object.kind === 'index') {
      const base = this.evalExpr(expr.object.object);
      if (base instanceof RMatrix) {
        return base.get(Number(this.evalExpr(expr.object.index)), Number(this.evalExpr(expr.index)));
      }
    }
    const obj = this.evalExpr(expr.object);
    const idx = this.evalExpr(expr.index);
    if (obj instanceof RMap) return obj.get(idx);
    if (obj instanceof RList) return obj.get(Number(idx));
    if (Array.isArray(obj)) { this.charge(1); return obj[Number(idx)] ?? null; }
    throw new RuntimeError(`Cannot index ${display(obj)} (line ${expr.line})`);
  }

  private evalMember(expr: Extract<Expr, { kind: 'member' }>): Value {
    const owner = this.evalExpr(expr.object);
    // A namespaced accessor used without parentheses — `graph.nodes`, `graph.source`.
    // The zero-argument graph accessors read as properties (CLRS `G.V` style); a
    // member that needs arguments (`graph.neighbors`) surfaces a clear error from
    // its builtin instead of silently returning nothing.
    if (owner instanceof Namespace) return this.callBuiltin(expr.name, [], expr.line);
    // Vertex properties — its identifier and kind.
    if (owner instanceof Vertex) {
      if (expr.name === 'name' || expr.name === 'label') return owner.label;
      if (expr.name === 'type') return owner.type;
      if (expr.name === 'id') return owner.id;
      throw new RuntimeError(`A vertex has no property '${expr.name}' — did you mean ${expr.name}()? (line ${expr.line})`);
    }
    // Edge properties — endpoints, weight, direction (read without parentheses).
    if (owner instanceof Edge) {
      if (expr.name === 'startVertex') return owner.startVertex;
      if (expr.name === 'endVertex') return owner.endVertex;
      if (expr.name === 'weight') return owner.weight;
      if (expr.name === 'isDirected') return owner.isDirected;
      throw new RuntimeError(`An edge has no property '${expr.name}' (line ${expr.line})`);
    }
    throw new RuntimeError(`'${expr.name}' must be called as a method (line ${expr.line})`);
  }

  private evalCall(expr: Extract<Expr, { kind: 'call' }>): Value {
    const args = expr.args.map((a) => this.evalExpr(a));
    if (expr.callee.kind === 'name') {
      const name = expr.callee.name;
      const fn = this.functions.get(name);
      if (fn) return this.callUser(fn, args);
      return this.callBuiltin(name, args, expr.line);
    }
    if (expr.callee.kind === 'member') {
      const obj = this.evalExpr(expr.callee.object);
      if (obj instanceof RDataStructure) return obj.call(expr.callee.name, args, expr.line);
      if (obj instanceof Namespace) {
        // `scratch.createMap(…)` / `panel.createMap(…)` build off-canvas structures; graph./canvas. forward to builtins.
        if (obj.name === 'scratch') return this.createOffCanvasDS('scratch', expr.callee.name, args, expr.line, false);
        if (obj.name === 'panel') return this.createOffCanvasDS('panel', expr.callee.name, args, expr.line, true);
        return this.callBuiltin(expr.callee.name, args, expr.line);
      }
      // Read-only methods on a plain list — e.g. graph.nodes().size(), neighbors(u).contains(v).
      if (Array.isArray(obj)) return this.arrayMethod(obj, expr.callee.name, args, expr.line);
      // Vertex method sugar — `v.hasEdge(w)` runs the graph builtin with v as the first arg.
      if (obj instanceof Vertex) return this.callBuiltin(expr.callee.name, [obj, ...args], expr.line);
      if (obj instanceof Edge) {
        throw new RuntimeError(`Read an edge's fields without parentheses, e.g. e.weight (line ${expr.line})`);
      }
      throw new RuntimeError(`'${expr.callee.name}' is not a method of ${display(obj)} (line ${expr.line})`);
    }
    throw new RuntimeError(`Expression is not callable (line ${expr.line})`);
  }

  /**
   * Read-only query methods on a plain list — the value returned by `graph.nodes()`,
   * `neighbors(u)`, `m.keys()`, etc. These results aren't data structures (no `add`/
   * `remove`), but you can still ask their size or membership, mirroring the DS API.
   */
  private arrayMethod(arr: Value[], method: string, args: Value[], line: number): Value {
    switch (method) {
      case 'size': this.charge(1); return arr.length;
      case 'isEmpty': this.charge(1); return arr.length === 0;
      case 'contains': this.charge(arr.length); return arr.some((x) => keyOf(x) === keyOf(args[0]));
      case 'indexOf': this.charge(arr.length); return arr.findIndex((x) => keyOf(x) === keyOf(args[0]));
      case 'get': this.charge(1); return arr[Number(args[0])] ?? null;
    }
    throw new RuntimeError(`'${method}' is not a method of a list (line ${line})`);
  }

  /** Step over a user function: run its body atomically, no inner steps. */
  private callUser(fn: FunctionDecl, args: Value[]): Value {
    const savedScope = this.scope;
    const savedStepping = this.stepping;
    this.scope = new Map<string, Value>();
    fn.params.forEach((p, i) => this.scope.set(p.name, args[i] ?? null));
    this.stepping = false;
    try {
      this.execBlock(fn.body);
      return null;
    } catch (e) {
      if (e instanceof ReturnSignal) return e.value;
      if (e instanceof ContinueSignal || e instanceof BreakSignal) return null;
      throw e;
    } finally {
      this.scope = savedScope;
      this.stepping = savedStepping;
    }
  }

  private callBuiltin(name: string, args: Value[], line: number): Value {
    const v0 = () => this.asVertex(args[0], line);
    // An edge is addressed by two vertices; mark/unmark/scrollTo overload on whether
    // the second argument is a vertex (an edge) or not (a vertex + optional type).
    const isEdge = args[1] instanceof Vertex;
    const edgeKey = () => `${v0().id}->${this.asVertex(args[1], line).id}`;
    switch (name) {
      case 'nodes': return this.graph.nodes();
      case 'edges': return this.graph.edges();
      case 'neighbors': return this.graph.neighbors(v0());
      case 'weight': return this.graph.weight(v0(), this.asVertex(args[1], line));
      case 'hasEdge': return this.graph.hasEdge(v0(), this.asVertex(args[1], line));
      case 'degree':
      case 'inDegree':
      case 'outDegree': return this.graph.degree(v0());
      case 'source': return this.graph.source();
      case 'goal': return this.graph.goal();
      case 'mark':
        // mark(u, type?) highlights a vertex; mark(u, v, type?) highlights an edge.
        this.charge(1);
        if (isEdge) this.markedEdges.set(edgeKey(), markType(args[2]));
        else this.marks.set(v0().id, markType(args[1]));
        return null;
      case 'unmark':
        this.charge(1);
        if (isEdge) this.markedEdges.delete(edgeKey());
        else this.marks.delete(v0().id);
        return null;
      case 'setLabel': this.charge(1); this.labels.set(v0().id, String(display(args[1]))); return null;
      case 'showMessage': {
        // A snackbar; empty text clears it. Stays until the next showMessage.
        this.charge(1);
        const text = String(display(args[0]));
        this.message = text ? { text, type: markType(args[1]) } : null;
        return null;
      }
      case 'hideMessage': this.charge(1); this.message = null; return null;
      case 'scrollTo':
        this.charge(1);
        this.scrollTo = isEdge
          ? { kind: 'edge', from: v0().id, to: this.asVertex(args[1], line).id }
          : { kind: 'node', id: v0().id };
        return null;
      case 'clearMarks':
        this.charge(1);
        this.marks.clear();
        this.markedEdges.clear();
        this.labels.clear();
        return null;
      // ── Canvas editing — mutate the graph / data structures ──
      case 'createNode':
        return this.graph.createNode(Number(args[0]), Number(args[1]), optionalName(args[2]));
      case 'deleteNode': this.graph.deleteNode(v0()); return null;
      case 'createEdge':
        this.graph.createEdge(
          v0(),
          this.asVertex(args[1], line),
          args[2] != null ? Number(args[2]) : 1,
          args[3] != null ? this.truthy(args[3]) : true,
        );
        return null;
      case 'deleteEdge': this.graph.deleteEdge(v0(), this.asVertex(args[1], line)); return null;
      case 'createList': return this.createDS('LIST', args);
      case 'createStack': return this.createDS('STACK', args);
      case 'createQueue': return this.createDS('QUEUE', args);
      case 'createSet': return this.createDS('SET', args);
      case 'createMap': return this.createDS('MAP', args);
      case 'createPQueue': return this.createDS('PQUEUE', args);
      case 'createMatrix':
        return this.createDS('MATRIX', args, Number(args[2]), Number(args[3]), optionalName(args[4]));
      case 'deleteDS': this.deleteDS(args[0]); return null;
      case 'clearGraph': this.graph.clear(); return null;
      case 'clearCanvas':
        this.graph.clear();
        this.dsList.length = 0;
        this.dsByLabel.clear();
        return null;
      case 'saveCanvas': this.commitCanvas(); return null;
      default: throw new RuntimeError(`Unknown function '${name}' (line ${line})`);
    }
  }

  /** Create a data structure on the canvas and register it for lookup by label. */
  private createDS(
    kind: DataStructureKind,
    args: Value[],
    rows = 1,
    cols = 1,
    name = optionalName(args[2]),
  ): RDataStructure {
    return this.registerDS(kind, Number(args[0]), Number(args[1]), name, rows, cols, true, true);
  }

  /**
   * Create a coordinate-free off-canvas structure for an algorithm's bookkeeping.
   * `scratch.*` is fully hidden (tracked = false); `panel.*` stays in the run data
   * panel but off the canvas (tracked = true). Both never draw on the canvas.
   */
  private createOffCanvasDS(ns: string, method: string, args: Value[], line: number, tracked: boolean): RDataStructure {
    const kind = OFF_CANVAS_KINDS[method];
    if (!kind) {
      throw new RuntimeError(
        `'${ns}.${method}' is not a structure — try ${ns}.createMap / createSet / createQueue / createStack / createList / createPQueue / createMatrix (line ${line})`,
      );
    }
    const isMatrix = kind === 'MATRIX';
    const rows = isMatrix ? Number(args[0]) : 1;
    const cols = isMatrix ? Number(args[1]) : 1;
    const name = optionalName(isMatrix ? args[2] : args[0]);
    return this.registerDS(kind, 0, 0, name, rows, cols, false, tracked);
  }

  /** Mint an id + unique label, build the structure, and register it for lookup. */
  private registerDS(
    kind: DataStructureKind,
    x: number,
    y: number,
    name: string | undefined,
    rows: number,
    cols: number,
    rendered: boolean,
    tracked: boolean,
  ): RDataStructure {
    this.charge(1);
    const id = `ds${this.nextDataId++}`;
    const label = this.uniqueDataLabel(name ?? DATA_STRUCTURES[kind].defaultLabel);
    const ds = makeRuntimeDSByKind(kind, id, label, x, y, this.charge, rows, cols, rendered, tracked);
    this.dsList.push(ds);
    this.dsByLabel.set(label, ds);
    return ds;
  }

  private deleteDS(value: Value): void {
    this.charge(1);
    if (!(value instanceof RDataStructure)) return;
    const i = this.dsList.indexOf(value);
    if (i >= 0) this.dsList.splice(i, 1);
    this.dsByLabel.delete(value.label);
  }

  private uniqueDataLabel(base: string): string {
    if (!this.dsByLabel.has(base)) return base;
    let i = 2;
    while (this.dsByLabel.has(`${base}${i}`)) i++;
    return `${base}${i}`;
  }

  /** Capture the current graph + data structures for saveCanvas() to persist. */
  private commitCanvas(): void {
    this.charge(1);
    const g = this.graph.snapshot();
    this.savedCanvas = {
      nodes: g.nodes.map((n) => ({ ...n })),
      edges: g.edges.map((e) => ({ ...e })),
      data: this.dsList
        .filter((d) => d.rendered)
        .map((d) => ({ id: d.id, kind: d.kind, label: d.label, x: d.x, y: d.y })),
    };
  }

  // ── Values & helpers ────────────────────────────────────────
  private lookup(name: string, line: number): Value {
    if (this.scope.has(name)) return this.scope.get(name) as Value;
    const ds = this.dsByLabel.get(name);
    if (ds) return ds;
    if (name === 'graph' || name === 'canvas' || name === 'scratch' || name === 'panel') {
      return new Namespace(name);
    }
    throw new RuntimeError(`'${name}' is not defined (line ${line})`);
  }

  private atom(name: string): Value {
    switch (name) {
      case 'INFINITY': return Infinity;
      case 'true': return true;
      case 'false': return false;
      default: return null; // nil
    }
  }

  private asVertex(value: Value, line: number): Vertex {
    if (value instanceof Vertex) return value;
    throw new RuntimeError(`Expected a vertex but got ${display(value)} (line ${line})`);
  }

  private toIterable(value: Value): Value[] {
    if (value instanceof RangeValue) {
      const out: Value[] = [];
      for (let i = value.from; i <= value.to; i++) out.push(i);
      return out;
    }
    if (Array.isArray(value)) return value;
    if (value instanceof RDataStructure) return value.elements();
    throw new RuntimeError('Value is not iterable');
  }

  private truthy(value: Value): boolean {
    if (value === false || value === null || value === 0 || value === '') return false;
    if (typeof value === 'number' && Number.isNaN(value)) return false;
    return true;
  }
}
