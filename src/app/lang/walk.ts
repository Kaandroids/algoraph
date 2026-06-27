/**
 * One structural walk over the AST, shared by the passes that need to visit
 * every node (the resolver's call check, the static locals scan). Each pass
 * supplies the hooks it cares about; the exhaustive `Stmt` / `Expr` recursion
 * lives here once, so a new node kind is handled in a single place.
 *
 * The complexity estimator keeps its own walk — it threads loop-nesting context
 * through the recursion, which is more than a uniform per-node visit.
 */
import type { Expr, Stmt } from './ast';

/** Per-node hooks; both are optional, called before the node's children are visited. */
export interface AstVisitor {
  onStmt?: (stmt: Stmt) => void;
  onExpr?: (expr: Expr) => void;
}

export function walkStmts(stmts: Stmt[], visitor: AstVisitor): void {
  for (const stmt of stmts) walkStmt(stmt, visitor);
}

export function walkStmt(stmt: Stmt, visitor: AstVisitor): void {
  visitor.onStmt?.(stmt);
  switch (stmt.kind) {
    case 'assign':
      walkExpr(stmt.target, visitor);
      walkExpr(stmt.value, visitor);
      break;
    case 'exprStmt':
      walkExpr(stmt.expr, visitor);
      break;
    case 'if':
      walkExpr(stmt.cond, visitor);
      walkStmts(stmt.thenBody, visitor);
      if (stmt.elseBody) walkStmts(stmt.elseBody, visitor);
      break;
    case 'while':
      walkExpr(stmt.cond, visitor);
      walkStmts(stmt.body, visitor);
      break;
    case 'forIn':
      walkExpr(stmt.iterable, visitor);
      walkStmts(stmt.body, visitor);
      break;
    case 'return':
      if (stmt.value) walkExpr(stmt.value, visitor);
      break;
    case 'continue':
    case 'break':
      break;
  }
}

export function walkExpr(expr: Expr, visitor: AstVisitor): void {
  visitor.onExpr?.(expr);
  switch (expr.kind) {
    case 'call':
      walkExpr(expr.callee, visitor);
      expr.args.forEach((a) => walkExpr(a, visitor));
      break;
    case 'member':
      walkExpr(expr.object, visitor);
      break;
    case 'index':
      walkExpr(expr.object, visitor);
      walkExpr(expr.index, visitor);
      break;
    case 'unary':
      walkExpr(expr.operand, visitor);
      break;
    case 'binary':
      walkExpr(expr.left, visitor);
      walkExpr(expr.right, visitor);
      break;
    case 'range':
      walkExpr(expr.from, visitor);
      walkExpr(expr.to, visitor);
      break;
    case 'num':
    case 'str':
    case 'atom':
    case 'name':
      break;
  }
}
