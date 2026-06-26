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
import type { CanvasEffects, DataSnapshot, RunResult, StepSnapshot } from './trace';
import { emptyEffects } from './trace';
import type { DataNode } from '../models/data-structure.model';
import {
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
  type Value,
} from './values';

/** Everything the interpreter needs that doesn't come from the source. */
export interface RunInput {
  entryId: string;
  graph: { vertices: Vertex[] | { id: string; label: string; type: string }[]; edges: { src: string; tgt: string; weight: number; directed: boolean }[] };
  data: DataNode[];
}

const MAX_STEPS = 100_000;

// Control-flow signals, thrown to unwind loops and calls.
class ContinueSignal {}
class BreakSignal {}
class ReturnSignal {
  constructor(readonly value: Value) {}
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
  private readonly functions: Map<string, FunctionDecl>;
  private readonly entryStmts: Stmt[];
  private readonly entryId: string;

  // Mutable canvas effects, snapshotted (and scroll consumed) on each step.
  private visited = new Set<string>();
  private active = new Set<string>();
  private markedEdges = new Set<string>();
  private labels = new Map<string, string>();
  private scrollTo: string | null = null;

  private scope = new Map<string, Value>();

  constructor(
    entry: Module,
    functions: Map<string, FunctionDecl>,
    input: RunInput,
  ) {
    this.entryId = input.entryId;
    this.functions = functions;
    this.entryStmts = entry.items.filter((i): i is Stmt => i.kind !== 'function');
    this.graph = new GraphValue(
      { vertices: input.graph.vertices as { id: string; label: string; type: string }[], edges: input.graph.edges },
      this.charge,
    );
    this.dsList = input.data.map((node) => makeRuntimeDS(node, this.charge));
    for (const ds of this.dsList) this.dsByLabel.set(ds.label, ds);
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
      data: this.dsList.map((d) => d.snapshot()) as DataSnapshot[],
      effects: this.snapshotEffects(),
      ops: this.opCount,
      note,
    });
    this.scrollTo = null; // a pan is consumed by the step that shows it
  }

  private snapshotEffects(): CanvasEffects {
    const effects = emptyEffects();
    effects.visited = [...this.visited];
    effects.active = [...this.active];
    effects.markedEdges = [...this.markedEdges];
    effects.labels = Object.fromEntries(this.labels);
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
        const seq = this.toIterable(this.evalExpr(stmt.iterable));
        for (const elem of seq) {
          this.scope.set(stmt.varName, elem);
          this.emit(stmt.line);
          try {
            this.execBlock(stmt.body);
          } catch (e) {
            if (e instanceof ContinueSignal) continue;
            if (e instanceof BreakSignal) break;
            throw e;
          }
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
      case 'member':
        throw new RuntimeError(`'${expr.name}' must be called as a method (line ${expr.line})`);
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
      case '+': return Number(left) + Number(right);
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
    throw new RuntimeError(`Cannot index ${display(obj)} (line ${expr.line})`);
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
      // `graph.nodes()` / `canvas.visit(u)` — namespaced forms of the global builtins.
      if (obj instanceof Namespace) return this.callBuiltin(expr.callee.name, args, expr.line);
      throw new RuntimeError(`'${expr.callee.name}' is not a method of ${display(obj)} (line ${expr.line})`);
    }
    throw new RuntimeError(`Expression is not callable (line ${expr.line})`);
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
      case 'visit': this.charge(1); this.visited.add(v0().id); return null;
      case 'mark': this.charge(1); this.active.add(v0().id); return null;
      case 'unmark': this.charge(1); this.active.delete(v0().id); return null;
      case 'markEdge': this.charge(1); this.markedEdges.add(`${v0().id}->${this.asVertex(args[1], line).id}`); return null;
      case 'setLabel': this.charge(1); this.labels.set(v0().id, String(display(args[1]))); return null;
      case 'scrollTo': this.charge(1); this.scrollTo = v0().id; return null;
      default: throw new RuntimeError(`Unknown function '${name}' (line ${line})`);
    }
  }

  // ── Values & helpers ────────────────────────────────────────
  private lookup(name: string, line: number): Value {
    if (this.scope.has(name)) return this.scope.get(name) as Value;
    const ds = this.dsByLabel.get(name);
    if (ds) return ds;
    if (name === 'graph' || name === 'canvas') return new Namespace(name);
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
