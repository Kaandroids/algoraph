/**
 * Heuristic static complexity estimator.
 *
 * Walks the entry file's AST, attributing a cost to each statement from the
 * loops that enclose it and the operations it performs (data-structure method
 * costs come from `node-api.ts`, keyed by the structure's kind on the canvas).
 * Nested `neighbors(u)` loops are amortised — iterating every vertex's
 * neighbours touches each edge once, so a vertex-loop × neighbour-loop pair
 * counts as E, not V·deg. The result is an estimate (it recognises the common
 * textbook shapes; it is not a general analyser) and is labelled as such in the UI.
 */
import type { Expr, FunctionDecl, Module, Stmt } from './ast';
import type { DataStructureKind } from '../models/data-structure.model';

type Factor = 'V' | 'E' | 'logV' | 'n' | 'logn';
type Term = Factor[]; // a product of factors; the empty term is O(1)
/** A loop's per-iteration factor; `neighbors` is an amortisation marker (see `amortise`). */
type LoopFactor = Factor | 'neighbors';

export interface Complexity {
  time: string;
  space: string;
}

export function estimateComplexity(
  entry: Module | undefined,
  functions: Map<string, FunctionDecl>,
  dsKinds: Map<string, DataStructureKind>,
): Complexity {
  if (!entry) return { time: 'O(?)', space: 'O(?)' };
  const ctx: Ctx = { functions, dsKinds, terms: [], inlining: new Set() };
  const stmts = entry.items.filter((i): i is Stmt => i.kind !== 'function');
  walkBlock(stmts, [], ctx);
  return { time: ctx.terms.length ? formatSum(ctx.terms) : 'O(1)', space: estimateSpace(dsKinds) };
}

interface Ctx {
  functions: Map<string, FunctionDecl>;
  dsKinds: Map<string, DataStructureKind>;
  terms: Term[];
  inlining: Set<string>;
}

// ── Walk ──────────────────────────────────────────────────────
function walkBlock(stmts: Stmt[], loops: LoopFactor[], ctx: Ctx): void {
  for (const stmt of stmts) walkStmt(stmt, loops, ctx);
}

function walkStmt(stmt: Stmt, loops: LoopFactor[], ctx: Ctx): void {
  switch (stmt.kind) {
    case 'assign':
      emit(loops, max(opFactor(stmt.value, ctx), opFactor(stmt.target, ctx)), ctx);
      break;
    case 'exprStmt': {
      const fn = userCall(stmt.expr, ctx);
      if (fn) inlineCall(fn, loops, ctx);
      else emit(loops, opFactor(stmt.expr, ctx), ctx);
      break;
    }
    case 'if':
      walkBlock(stmt.thenBody, loops, ctx);
      if (stmt.elseBody) walkBlock(stmt.elseBody, loops, ctx);
      break;
    case 'while':
      walkBlock(stmt.body, [...loops, 'V'], ctx);
      break;
    case 'forIn':
      walkBlock(stmt.body, [...loops, loopFactor(stmt.iterable)], ctx);
      break;
    case 'return':
      if (stmt.value) emit(loops, opFactor(stmt.value, ctx), ctx);
      break;
    case 'continue':
    case 'break':
      break;
  }
}

/** The helper a statement-level call resolves to, or null for builtins/methods. */
function userCall(expr: Expr, ctx: Ctx): FunctionDecl | null {
  if (expr.kind === 'call' && expr.callee.kind === 'name') {
    return ctx.functions.get(expr.callee.name) ?? null;
  }
  return null;
}

/** Inline a stepped-over helper at the call site's loop depth. */
function inlineCall(fn: FunctionDecl, loops: LoopFactor[], ctx: Ctx): void {
  if (ctx.inlining.has(fn.name)) return; // guard against recursion
  ctx.inlining.add(fn.name);
  walkBlock(fn.body, loops, ctx);
  ctx.inlining.delete(fn.name);
}

function emit(loops: LoopFactor[], op: Factor | null, ctx: Ctx): void {
  const term = amortise(loops);
  if (op) term.push(op);
  ctx.terms.push(term);
}

/** Collapse a `V` (or `while`) immediately consumed by a neighbour loop into `E`. */
function amortise(loops: LoopFactor[]): Factor[] {
  const out: Factor[] = [];
  for (const f of loops) {
    if (f === 'neighbors') {
      const v = out.lastIndexOf('V');
      if (v !== -1) out[v] = 'E';
      else out.push('E');
    } else {
      out.push(f);
    }
  }
  return out;
}

// ── Cost of a single loop / operation ─────────────────────────
function loopFactor(iterable: Expr): LoopFactor {
  if (iterable.kind === 'range') return 'n';
  if (iterable.kind === 'call' && iterable.callee.kind === 'name') {
    if (iterable.callee.name === 'nodes') return 'V';
    if (iterable.callee.name === 'edges') return 'E';
    if (iterable.callee.name === 'neighbors') return 'neighbors';
  }
  return 'n';
}

/** The dominant cost factor of evaluating an expression (null = O(1)). */
function opFactor(expr: Expr, ctx: Ctx): Factor | null {
  switch (expr.kind) {
    case 'call': {
      let here: Factor | null = null;
      if (expr.callee.kind === 'member') {
        here = dsMethodFactor(expr.callee.object, expr.callee.name, ctx);
      } else if (expr.callee.kind === 'name') {
        const fn = ctx.functions.get(expr.callee.name);
        here = fn ? funcFactor(fn, ctx) : builtinFactor(expr.callee.name);
      }
      return expr.args.reduce<Factor | null>((acc, a) => max(acc, opFactor(a, ctx)), here);
    }
    case 'member':
      return opFactor(expr.object, ctx);
    case 'index':
      return max(opFactor(expr.object, ctx), opFactor(expr.index, ctx));
    case 'unary':
      return opFactor(expr.operand, ctx);
    case 'binary':
      return max(opFactor(expr.left, ctx), opFactor(expr.right, ctx));
    case 'range':
      return max(opFactor(expr.from, ctx), opFactor(expr.to, ctx));
    default:
      return null;
  }
}

/** Dominant non-loop op factor of a helper body (for calls used as values). */
function funcFactor(fn: FunctionDecl, ctx: Ctx): Factor | null {
  if (ctx.inlining.has(fn.name)) return null;
  ctx.inlining.add(fn.name);
  let factor: Factor | null = null;
  const visit = (stmts: Stmt[]): void => {
    for (const s of stmts) {
      if (s.kind === 'assign') factor = max(factor, max(opFactor(s.value, ctx), opFactor(s.target, ctx)));
      else if (s.kind === 'exprStmt') factor = max(factor, opFactor(s.expr, ctx));
      else if (s.kind === 'if') { visit(s.thenBody); if (s.elseBody) visit(s.elseBody); }
      else if (s.kind === 'while') visit(s.body);
      else if (s.kind === 'forIn') visit(s.body);
      else if (s.kind === 'return' && s.value) factor = max(factor, opFactor(s.value, ctx));
    }
  };
  visit(fn.body);
  ctx.inlining.delete(fn.name);
  return factor;
}

/**
 * The dominant cost factor of each data-structure method that isn't O(1), by
 * kind. Kept structured here — rather than parsed from the Big-O prose in the
 * docs catalogue — so rewording a cost string ("O(N)" vs "O(n)") can't silently
 * shift the estimate. A method absent from a kind's map is treated as O(1) and
 * left to the enclosing loop. Linear/quadratic ops read as `V` (≈ the graph
 * size), heap ops as `logV`.
 */
const DS_METHOD_FACTOR: Partial<Record<DataStructureKind, Record<string, Factor>>> = {
  LIST: { insert: 'V', removeAt: 'V', contains: 'V', indexOf: 'V', clear: 'V' },
  STACK: { clear: 'V' },
  QUEUE: { clear: 'V' },
  SET: { clear: 'V' },
  MAP: { keys: 'V', values: 'V', clear: 'V' },
  PQUEUE: { push: 'logV', popMin: 'logV', decreaseKey: 'logV', clear: 'V' },
  MATRIX: { fill: 'V' },
};

function dsMethodFactor(obj: Expr, method: string, ctx: Ctx): Factor | null {
  if (obj.kind !== 'name') return null;
  const kind = ctx.dsKinds.get(obj.name);
  if (!kind) return null;
  return DS_METHOD_FACTOR[kind]?.[method] ?? null;
}

function builtinFactor(name: string): Factor | null {
  if (name === 'nodes') return 'V';
  if (name === 'edges') return 'E';
  return null; // weight / hasEdge / degree / source / goal / viz are O(1)
}

// ── Domination & formatting ───────────────────────────────────
const ORDER: Factor[] = ['V', 'E', 'n', 'logV', 'logn'];

function max(a: Factor | null, b: Factor | null): Factor | null {
  const rank = (f: Factor | null): number => (f === null ? -1 : ['logn', 'logV', 'n', 'E', 'V'].indexOf(f));
  return rank(a) >= rank(b) ? a : b;
}

function counts(term: Term): Map<Factor, number> {
  const m = new Map<Factor, number>();
  for (const f of term) m.set(f, (m.get(f) ?? 0) + 1);
  return m;
}

/** Whether term A is dominated by term B (A's factors are a sub-multiset of B's). */
function dominated(a: Term, b: Term): boolean {
  const cb = counts(b);
  for (const [f, n] of counts(a)) if ((cb.get(f) ?? 0) < n) return false;
  return a.length < b.length || a.length === b.length;
}

function formatSum(terms: Term[]): string {
  // De-duplicate and drop dominated terms.
  const unique: Term[] = [];
  const key = (t: Term): string => [...t].sort().join('*');
  const seen = new Set<string>();
  for (const t of terms) {
    const k = key(t);
    if (!seen.has(k)) { seen.add(k); unique.push(t); }
  }
  const kept = unique.filter((a) => !unique.some((b) => a !== b && key(a) !== key(b) && dominated(a, b)));
  return `O(${formatTerms(kept)})`;
}

function formatTerms(terms: Term[]): string {
  if (terms.length === 0) return '1';
  if (terms.length === 1) return formatTerm(terms[0]);
  // Factor out a common factor shared by every term, if any.
  const common = ORDER.find((f) => terms.every((t) => t.includes(f)));
  if (common) {
    const rest = terms.map((t) => removeOne(t, common));
    return `(${formatTerms(rest)}) ${formatFactor(common)}`;
  }
  return terms.map(formatTerm).join(' + ');
}

function removeOne(term: Term, f: Factor): Term {
  const out = [...term];
  out.splice(out.indexOf(f), 1);
  return out;
}

function formatTerm(term: Term): string {
  if (term.length === 0) return '1';
  const c = counts(term);
  return ORDER.filter((f) => c.has(f)).map((f) => formatFactor(f, c.get(f)!)).join(' ');
}

function formatFactor(f: Factor, power = 1): string {
  const base = f === 'logV' ? 'log V' : f === 'logn' ? 'log n' : f;
  if (power === 1) return base;
  if (power === 2) return `${base}²`;
  return `${base}^${power}`;
}

// ── Space ─────────────────────────────────────────────────────
function estimateSpace(dsKinds: Map<string, DataStructureKind>): string {
  if (dsKinds.size === 0) return 'O(1)';
  for (const kind of dsKinds.values()) if (kind === 'MATRIX') return 'O(V²)';
  return 'O(V)';
}
