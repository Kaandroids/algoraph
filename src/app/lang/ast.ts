/**
 * Abstract syntax tree for the Algoraph pseudocode DSL.
 *
 * Every node carries a 1-based `line` so the Run workspace can step the source
 * line by line and the resolver can attach diagnostics to a location.
 */

export type Expr =
  | { kind: 'num'; value: number; line: number }
  | { kind: 'str'; value: string; line: number }
  | { kind: 'atom'; name: string; line: number }
  | { kind: 'name'; name: string; line: number }
  | { kind: 'call'; callee: Expr; args: Expr[]; line: number }
  | { kind: 'member'; object: Expr; name: string; line: number }
  | { kind: 'index'; object: Expr; index: Expr; line: number }
  | { kind: 'unary'; op: string; operand: Expr; line: number }
  | { kind: 'binary'; op: string; left: Expr; right: Expr; line: number }
  | { kind: 'range'; from: Expr; to: Expr; line: number };

export type Stmt =
  | { kind: 'assign'; target: Expr; value: Expr; line: number }
  | { kind: 'exprStmt'; expr: Expr; line: number }
  | { kind: 'if'; cond: Expr; thenBody: Stmt[]; elseBody: Stmt[] | null; line: number }
  | { kind: 'while'; cond: Expr; body: Stmt[]; line: number }
  | { kind: 'forIn'; varName: string; iterable: Expr; body: Stmt[]; line: number }
  | { kind: 'continue'; line: number }
  | { kind: 'break'; line: number }
  | { kind: 'return'; value: Expr | null; line: number };

/** A function parameter; the optional type is parsed but not enforced. */
export interface Param {
  name: string;
  type?: string;
}

export interface FunctionDecl {
  kind: 'function';
  name: string;
  params: Param[];
  body: Stmt[];
  exported: boolean;
  line: number;
}

/** A top-level item: either a function declaration or a bare statement (entry file). */
export type Item = FunctionDecl | Stmt;

/** One parsed source file. */
export interface Module {
  fileId: string;
  fileName: string;
  items: Item[];
}
