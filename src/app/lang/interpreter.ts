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
import type { CanvasEffects, DataSnapshot, DebugLine, LoopFrame, RunResult, SavedCanvas, StepSnapshot, VarSnapshot, VertexRef } from './trace';
import { EffectsState } from './effects';
import { DATA_STRUCTURES, type DataNode, type DataStructureKind } from '../models/data-structure.model';
import { CREATE_KINDS } from './builtins';
import {
  Edge,
  GraphValue,
  Namespace,
  RDataStructure,
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

/** A mark's optional `type` argument (`danger`/`warn`/…); `''` is the default highlight. */
function markType(value: Value | undefined): string {
  return typeof value === 'string' ? value : '';
}

/**
 * The panel key a `spotlight`/`note` call targets: a data structure resolves to
 * its id, anything else (typically a variable name passed as a string) to its
 * display text. The Run panel matches this against variable names and structure
 * ids/labels.
 */
function panelToken(value: Value | undefined): string {
  return value instanceof RDataStructure ? value.id : String(display(value as Value));
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

/** The per-call context handed to every built-in handler (shared argument sugar). */
interface BuiltinCall {
  args: Value[];
  line: number;
  /** The first argument as a vertex (throws if it isn't one). */
  v0: () => Vertex;
  /** Whether the second argument is a vertex — i.e. this addresses an edge u → v. */
  isEdge: boolean;
  /** The `src->tgt` key for the edge addressed by args[0]/args[1]. */
  edgeKey: () => string;
}

/** One global built-in's implementation. Registered by name in `buildBuiltins`. */
type BuiltinHandler = (call: BuiltinCall) => Value;

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
  /** Lines emitted by printDebug, in execution order — surfaced in the Algorithm debug panel. */
  private readonly debugLog: DebugLine[] = [];
  /** Graph the program asked to persist via saveCanvas() (last call wins), or null. */
  private savedCanvas: SavedCanvas | null = null;
  private readonly functions: Map<string, FunctionDecl>;
  private readonly entryStmts: Stmt[];
  private readonly entryId: string;

  // Mutable canvas effects (highlights, labels, snackbar, pending pan),
  // snapshotted — and the scroll consumed — on each step.
  private readonly effects = new EffectsState();
  // Stack of active `for each` loops, innermost last. Each frame drives the
  // iteration popup and (when its element is a vertex) the canvas cursor + pan,
  // so a loop visualizes itself without the algorithm marking anything.
  private readonly loopFrames: LoopFrameState[] = [];

  private scope = new Map<string, Value>();

  /** Global built-ins, keyed by name — the dispatch table behind `callBuiltin`. */
  private readonly builtins: Record<string, BuiltinHandler>;

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
    this.builtins = this.buildBuiltins();
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
      debug: this.debugLog,
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
    this.effects.consumePan(); // a pan is consumed by the step that shows it
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
    const cursors = [...new Set(this.loopFrames.map((f) => f.cursorId).filter((id): id is string => id !== null))];
    return this.effects.snapshot(cursors);
  }

  // ── Statements ──────────────────────────────────────────────
  private execBlock(stmts: Stmt[]): void {
    for (const stmt of stmts) this.execStmt(stmt);
  }

  private execStmt(stmt: Stmt): void {
    // A snackbar message belongs to the step that shows it. Clear any prior one as
    // each new stepped statement begins, so a message doesn't linger across steps
    // (stepping back over a showMessage removes it). Statements inside a helper run
    // with stepping off, so the message they set survives to the call's single step.
    if (this.stepping) this.effects.setMessage(null);
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
          if (this.stepping) this.effects.setMessage(null); // each re-test is its own step
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
            if (elem instanceof Vertex) this.effects.panTo({ kind: 'node', id: elem.id });
            if (this.stepping) this.effects.setMessage(null); // each iteration is its own step
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
      // Matrix: M[i][j] ← x — a rank-2 structure takes both indices at once.
      if (target.object.kind === 'index') {
        const base = this.evalExpr(target.object.object);
        if (base instanceof RDataStructure && base.rank === 2) {
          base.subscriptSet([this.evalExpr(target.object.index), this.evalExpr(target.index)], value, target.line);
          return;
        }
      }
      const obj = this.evalExpr(target.object);
      const idx = this.evalExpr(target.index);
      if (obj instanceof RDataStructure) obj.subscriptSet([idx], value, target.line);
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
    // Matrix: M[i][j] — a rank-2 structure takes both indices at once.
    if (expr.object.kind === 'index') {
      const base = this.evalExpr(expr.object.object);
      if (base instanceof RDataStructure && base.rank === 2) {
        return base.subscriptGet([this.evalExpr(expr.object.index), this.evalExpr(expr.index)], expr.line);
      }
    }
    const obj = this.evalExpr(expr.object);
    const idx = this.evalExpr(expr.index);
    if (obj instanceof RDataStructure) return obj.subscriptGet([idx], expr.line);
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
    const handler = this.builtins[name];
    if (!handler) throw new RuntimeError(`Unknown function '${name}' (line ${line})`);
    const v0 = () => this.asVertex(args[0], line);
    // An edge is addressed by two vertices; mark/unmark/scrollTo overload on whether
    // the second argument is a vertex (an edge) or not (a vertex + optional type).
    const isEdge = args[1] instanceof Vertex;
    const edgeKey = () => `${v0().id}->${this.asVertex(args[1], line).id}`;
    return handler({ args, line, v0, isEdge, edgeKey });
  }

  /**
   * Build the built-in dispatch table once per run. Each handler reads the
   * shared argument sugar (`v0`, `isEdge`, `edgeKey`) from its call context;
   * adding a built-in is a single entry here (and one in `lang/builtins.ts`).
   */
  private buildBuiltins(): Record<string, BuiltinHandler> {
    const degree: BuiltinHandler = ({ v0 }) => this.graph.degree(v0());
    const table: Record<string, BuiltinHandler> = {
      // ── Graph access ──
      nodes: () => this.graph.nodes(),
      edges: () => this.graph.edges(),
      neighbors: ({ v0 }) => this.graph.neighbors(v0()),
      weight: ({ v0, args, line }) => this.graph.weight(v0(), this.asVertex(args[1], line)),
      hasEdge: ({ v0, args, line }) => this.graph.hasEdge(v0(), this.asVertex(args[1], line)),
      degree,
      inDegree: degree,
      outDegree: degree,
      source: () => this.graph.source(),
      goal: () => this.graph.goal(),
      // ── Visualization ──
      mark: ({ isEdge, edgeKey, v0, args }) => {
        // mark(u, type?) highlights a vertex; mark(u, v, type?) highlights an edge.
        this.charge(1);
        if (isEdge) this.effects.markEdge(edgeKey(), markType(args[2]));
        else this.effects.markVertex(v0().id, markType(args[1]));
        return null;
      },
      unmark: ({ isEdge, edgeKey, v0 }) => {
        this.charge(1);
        if (isEdge) this.effects.unmarkEdge(edgeKey());
        else this.effects.unmarkVertex(v0().id);
        return null;
      },
      setLabel: ({ v0, args }) => {
        this.charge(1);
        this.effects.setLabel(v0().id, String(display(args[1])));
        return null;
      },
      spotlight: ({ args }) => {
        // Emphasise a variable or data structure in the Run panel — pass the structure
        // itself, or a variable's name as a string. Persists like a mark until cleared.
        this.charge(1);
        this.effects.spotlight(panelToken(args[0]));
        return null;
      },
      unspotlight: ({ args }) => {
        this.charge(1);
        this.effects.unspotlight(panelToken(args[0]));
        return null;
      },
      note: ({ args }) => {
        // Pin a short note onto a panel entry (a structure, or a variable by name).
        this.charge(1);
        this.effects.setNote(panelToken(args[0]), String(display(args[1])));
        return null;
      },
      pin: ({ args }) => {
        // Float a panel entry to the top of its section; survives clearMarks(), unpin() removes it.
        this.charge(1);
        this.effects.pin(panelToken(args[0]));
        return null;
      },
      unpin: ({ args }) => {
        this.charge(1);
        this.effects.unpin(panelToken(args[0]));
        return null;
      },
      showMessage: ({ args }) => {
        // A snackbar for the current step; empty text clears it. Cleared as the next step begins.
        this.charge(1);
        const text = String(display(args[0]));
        this.effects.setMessage(text ? { text, type: markType(args[1]) } : null);
        return null;
      },
      hideMessage: () => {
        this.charge(1);
        this.effects.setMessage(null);
        return null;
      },
      printDebug: ({ args, line }) => {
        // Instrumentation only — append a line to the debug panel; never charge the op counter.
        this.debugLog.push({ line, text: String(display(args[0])) });
        return null;
      },
      scrollTo: ({ isEdge, v0, args, line }) => {
        this.charge(1);
        this.effects.panTo(
          isEdge
            ? { kind: 'edge', from: v0().id, to: this.asVertex(args[1], line).id }
            : { kind: 'node', id: v0().id },
        );
        return null;
      },
      clearMarks: () => {
        this.charge(1);
        this.effects.clear();
        return null;
      },
      // ── Canvas editing — mutate the graph / data structures ──
      createNode: ({ args }) => this.graph.createNode(Number(args[0]), Number(args[1]), optionalName(args[2])),
      deleteNode: ({ v0 }) => {
        this.graph.deleteNode(v0());
        return null;
      },
      createEdge: ({ v0, args, line }) => {
        this.graph.createEdge(
          v0(),
          this.asVertex(args[1], line),
          args[2] != null ? Number(args[2]) : 1,
          args[3] != null ? this.truthy(args[3]) : true,
        );
        return null;
      },
      deleteEdge: ({ v0, args, line }) => {
        this.graph.deleteEdge(v0(), this.asVertex(args[1], line));
        return null;
      },
      createMatrix: ({ args }) =>
        this.createDS('MATRIX', args, Number(args[2]), Number(args[3]), optionalName(args[4])),
      deleteDS: ({ args }) => {
        this.deleteDS(args[0]);
        return null;
      },
      clearGraph: () => {
        this.graph.clear();
        return null;
      },
      clearCanvas: () => {
        this.graph.clear();
        this.dsList.length = 0;
        this.dsByLabel.clear();
        return null;
      },
      saveCanvas: () => {
        this.commitCanvas();
        return null;
      },
    };
    // The coordinate-placed constructors (everything but the matrix) share one shape.
    for (const [fn, kind] of Object.entries(CREATE_KINDS)) {
      if (kind !== 'MATRIX') table[fn] = ({ args }) => this.createDS(kind, args);
    }
    return table;
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
    const kind = CREATE_KINDS[method];
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
