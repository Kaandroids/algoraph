/**
 * Static scan for the data structures a file's run creates — so they can be
 * offered in autocomplete and the overview's "Local" section before any run.
 *
 * A file's locals are everything reachable from its top-level code: structures
 * created directly, plus those created inside any function it calls (transitively,
 * across files via the global function table). A function that is declared but
 * never called doesn't run, so its creations are not counted.
 */
import type { Expr, FunctionDecl, Module, Stmt } from './ast';
import type { DataStructureKind } from '../models/data-structure.model';

/** A data structure the code creates, by name and kind. */
export interface LocalStructure {
  name: string;
  kind: DataStructureKind;
  /** `panel.*` structures surface under "Globals" (they show in the run data panel); others are file-local. */
  global: boolean;
}

/** A name usable as a DSL identifier — spaced / punctuated labels can't be referenced. */
const IDENT = /^[A-Za-z_]\w*$/;

const CREATE_KIND: Record<string, DataStructureKind> = {
  createList: 'LIST',
  createStack: 'STACK',
  createQueue: 'QUEUE',
  createSet: 'SET',
  createMap: 'MAP',
  createPQueue: 'PQUEUE',
  createMatrix: 'MATRIX',
};

/** Short method names on the `scratch` / `panel` namespaces (e.g. `scratch.map`). */
const OFF_CANVAS_KIND: Record<string, DataStructureKind> = {
  list: 'LIST',
  stack: 'STACK',
  queue: 'QUEUE',
  set: 'SET',
  map: 'MAP',
  pqueue: 'PQUEUE',
  matrix: 'MATRIX',
};

/** The called function's name, for both `f(…)` and `canvas.f(…)`. */
function callName(callee: Expr): string | null {
  if (callee.kind === 'name') return callee.name;
  if (callee.kind === 'member') return callee.name;
  return null;
}

/**
 * A data-structure constructor call → its kind and the index of its optional
 * `name` argument. Recognises `createMap(x, y, name)` (bare or `canvas.`-prefixed,
 * name at arg 2 / 4 for a matrix) as well as the coordinate-free off-canvas forms
 * `scratch.map(name)` / `panel.map(name)` (name at arg 0 / 2 for a matrix).
 */
function constructorInfo(expr: Expr): { kind: DataStructureKind; nameArg: number; global: boolean } | null {
  if (expr.kind !== 'call') return null;
  const callee = expr.callee;
  if (callee.kind !== 'name' && callee.kind !== 'member') return null;
  const created = CREATE_KIND[callee.name];
  if (created) return { kind: created, nameArg: created === 'MATRIX' ? 4 : 2, global: false };
  if (
    callee.kind === 'member' &&
    callee.object.kind === 'name' &&
    (callee.object.name === 'scratch' || callee.object.name === 'panel')
  ) {
    const off = OFF_CANVAS_KIND[callee.name];
    if (off) return { kind: off, nameArg: off === 'MATRIX' ? 2 : 0, global: callee.object.name === 'panel' };
  }
  return null;
}

export function collectLocalStructures(entry: Module, functions: Map<string, FunctionDecl>): LocalStructure[] {
  const out: LocalStructure[] = [];
  const seenNames = new Set<string>();
  const seenFns = new Set<string>();

  const add = (name: string, kind: DataStructureKind, global: boolean): void => {
    if (seenNames.has(name)) return;
    seenNames.add(name);
    out.push({ name, kind, global });
  };

  const visitStmts = (stmts: Stmt[]): void => {
    for (const s of stmts) visitStmt(s);
  };

  const visitStmt = (s: Stmt): void => {
    switch (s.kind) {
      case 'assign': {
        // `x ← create*(…)` / `x ← scratch.map(…)` — the variable is that structure.
        const info = constructorInfo(s.value);
        if (info && s.target.kind === 'name') add(s.target.name, info.kind, info.global);
        visitExpr(s.target);
        visitExpr(s.value);
        break;
      }
      case 'exprStmt':
        visitExpr(s.expr);
        break;
      case 'if':
        visitExpr(s.cond);
        visitStmts(s.thenBody);
        if (s.elseBody) visitStmts(s.elseBody);
        break;
      case 'while':
        visitExpr(s.cond);
        visitStmts(s.body);
        break;
      case 'forIn':
        visitExpr(s.iterable);
        visitStmts(s.body);
        break;
      case 'return':
        if (s.value) visitExpr(s.value);
        break;
      case 'continue':
      case 'break':
        break;
    }
  };

  const visitExpr = (expr: Expr): void => {
    if (expr.kind === 'call') {
      const info = constructorInfo(expr);
      if (info) {
        // The literal label, if it's a usable identifier — its position depends on the form.
        const arg = expr.args[info.nameArg];
        if (arg?.kind === 'str' && IDENT.test(arg.value)) add(arg.value, info.kind, info.global);
      } else {
        // A user-function call — follow it once so its creations count too.
        const fname = callName(expr.callee);
        const fn = fname ? functions.get(fname) : undefined;
        if (fn && fname && !seenFns.has(fname)) {
          seenFns.add(fname);
          visitStmts(fn.body);
        }
      }
      visitExpr(expr.callee);
      for (const arg of expr.args) visitExpr(arg);
      return;
    }
    switch (expr.kind) {
      case 'unary':
        visitExpr(expr.operand);
        break;
      case 'binary':
        visitExpr(expr.left);
        visitExpr(expr.right);
        break;
      case 'index':
        visitExpr(expr.object);
        visitExpr(expr.index);
        break;
      case 'member':
        visitExpr(expr.object);
        break;
      case 'range':
        visitExpr(expr.from);
        visitExpr(expr.to);
        break;
      // num · str · atom · name are leaves
    }
  };

  visitStmts(entry.items.filter((i): i is Stmt => i.kind !== 'function'));
  return out;
}
