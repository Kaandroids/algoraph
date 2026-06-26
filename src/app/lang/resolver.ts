/**
 * Resolver / linker for the parsed modules.
 *
 * Builds the global export table (an `export function` is visible to every file
 * and called directly, with no `import`), reports duplicate exports and direct
 * calls to functions that are neither declared nor built in, and produces the
 * `ExportRef[]` the overview and autocomplete consume. Data-structure method
 * calls (`pq.push`, `m.keys`) are member calls and are checked at runtime, not
 * here.
 */
import { GLOBAL_REFERENCE, memberName } from '../node-api';
import type { Diagnostic } from './diagnostics';
import type { Expr, FunctionDecl, Module, Stmt } from './ast';
import type { ExportRef } from '../models/exports';

/** Global graph / visualization functions callable by bare name. */
const BUILTIN_FUNCTIONS: ReadonlySet<string> = new Set([
  ...GLOBAL_REFERENCE.groups
    .filter((g) => g.title !== 'Language')
    .flatMap((g) => g.members)
    .map((m) => memberName(m.sig))
    .filter((name): name is string => name !== null),
  // Aliases the combined reference signatures don't expose individually.
  'inDegree', 'outDegree', 'unmark',
]);

export interface ResolveResult {
  /** Exported helpers, in declaration order, for the overview + autocomplete. */
  exports: ExportRef[];
  /** Every function callable by bare name: exported helpers + all declarations. */
  functions: Map<string, FunctionDecl>;
}

export function resolve(modules: Module[], diagnostics: Diagnostic[]): ResolveResult {
  const exports: ExportRef[] = [];
  const functions = new Map<string, FunctionDecl>();
  const exportedAt = new Map<string, string>(); // name → fileName of first export

  for (const module of modules) {
    for (const item of module.items) {
      if (item.kind !== 'function') continue;
      functions.set(item.name, item);
      if (!item.exported) continue;
      if (exportedAt.has(item.name)) {
        diagnostics.push({
          severity: 'error',
          message: `Duplicate export '${item.name}' (already exported from ${exportedAt.get(item.name)})`,
          fileId: module.fileId,
          line: item.line,
        });
        continue;
      }
      exportedAt.set(item.name, module.fileName);
      exports.push({
        name: item.name,
        params: item.params.map((p) => p.name).join(', '),
        file: module.fileName,
      });
    }
  }

  // Flag bare calls to names that are neither declared nor built in.
  const known = new Set([...functions.keys(), ...BUILTIN_FUNCTIONS]);
  for (const module of modules) {
    for (const item of module.items) {
      const body = item.kind === 'function' ? item.body : [item];
      walkStmts(body, (expr) => {
        if (expr.kind === 'call' && expr.callee.kind === 'name' && !known.has(expr.callee.name)) {
          diagnostics.push({
            severity: 'error',
            message: `Unknown function '${expr.callee.name}'`,
            fileId: module.fileId,
            line: expr.line,
          });
        }
      });
    }
  }

  return { exports, functions };
}

// ── Minimal AST walk to visit every expression ────────────────
function walkStmts(stmts: Stmt[], visit: (expr: Expr) => void): void {
  for (const stmt of stmts) walkStmt(stmt, visit);
}

function walkStmt(stmt: Stmt, visit: (expr: Expr) => void): void {
  switch (stmt.kind) {
    case 'assign':
      walkExpr(stmt.target, visit);
      walkExpr(stmt.value, visit);
      break;
    case 'exprStmt':
      walkExpr(stmt.expr, visit);
      break;
    case 'if':
      walkExpr(stmt.cond, visit);
      walkStmts(stmt.thenBody, visit);
      if (stmt.elseBody) walkStmts(stmt.elseBody, visit);
      break;
    case 'while':
      walkExpr(stmt.cond, visit);
      walkStmts(stmt.body, visit);
      break;
    case 'forIn':
      walkExpr(stmt.iterable, visit);
      walkStmts(stmt.body, visit);
      break;
    case 'return':
      if (stmt.value) walkExpr(stmt.value, visit);
      break;
    case 'continue':
    case 'break':
      break;
  }
}

function walkExpr(expr: Expr, visit: (expr: Expr) => void): void {
  visit(expr);
  switch (expr.kind) {
    case 'call':
      walkExpr(expr.callee, visit);
      expr.args.forEach((a) => walkExpr(a, visit));
      break;
    case 'member':
      walkExpr(expr.object, visit);
      break;
    case 'index':
      walkExpr(expr.object, visit);
      walkExpr(expr.index, visit);
      break;
    case 'unary':
      walkExpr(expr.operand, visit);
      break;
    case 'binary':
      walkExpr(expr.left, visit);
      walkExpr(expr.right, visit);
      break;
    case 'range':
      walkExpr(expr.from, visit);
      walkExpr(expr.to, visit);
      break;
    case 'num':
    case 'str':
    case 'atom':
    case 'name':
      break;
  }
}
