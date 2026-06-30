/**
 * Hand-written recursive-descent + Pratt parser for the Algoraph DSL.
 *
 * One `Parser` instance turns a single file's token stream into a `Module`.
 * Statements are newline-terminated and blocks are delimited by keywords
 * (`do`/`then` … `end`/`else`), which lets inline blocks such as
 * `if u in visited then continue end` parse on one line. Parse errors are
 * collected as diagnostics and recovered from by skipping to the next line, so
 * one mistake doesn't cascade.
 */
import { ATOMS, type Token } from './token';
import type { Diagnostic } from './diagnostics';
import type { Expr, FunctionDecl, Item, Module, Param, Stmt } from './ast';

/** Binary operator precedence (higher binds tighter); `..` is handled separately. */
const BINARY_PRECEDENCE: Record<string, number> = {
  or: 1,
  and: 2,
  '=': 3, '≠': 3, '<': 3, '>': 3, '≤': 3, '≥': 3, in: 3,
  '+': 4, '-': 4,
  '*': 5, '/': 5, '%': 5,
};

export class Parser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly fileId: string,
    private readonly fileName: string,
    private readonly diagnostics: Diagnostic[],
  ) {}

  parseModule(): Module {
    const items: Item[] = [];
    this.skipNewlines();
    while (!this.atEnd()) {
      const before = this.pos;
      const item = this.parseItem();
      if (item) items.push(item);
      if (this.pos === before) this.advance(); // guarantee progress on error
      this.skipNewlines();
    }
    return { fileId: this.fileId, fileName: this.fileName, items };
  }

  // ── Items & statements ──────────────────────────────────────
  private parseItem(): Item | null {
    if (this.atKeyword('export') || this.atKeyword('function')) return this.parseFunction();
    return this.parseStatement();
  }

  private parseFunction(): FunctionDecl | null {
    const line = this.peek().line;
    const exported = this.matchKeyword('export');
    if (!this.expectKeyword('function')) return this.recover(line);
    const name = this.expect('name', 'function name');
    if (!name) return this.recover(line);
    if (!this.expect('lparen', "'(' after function name")) return this.recover(line);
    const params = this.parseParams();
    if (!this.expect('rparen', "')' after parameters")) return this.recover(line);
    this.expectKeyword('do');
    const body = this.parseBlock(['end']);
    this.expectKeyword('end');
    return { kind: 'function', name: name.value, params, body, exported, line };
  }

  private parseParams(): Param[] {
    const params: Param[] = [];
    if (this.at('rparen')) return params;
    do {
      const first = this.expect('name', 'parameter name');
      if (!first) break;
      // `type name` — a leading type identifier (parsed, not enforced).
      if (this.at('name')) {
        const actual = this.advance();
        params.push({ name: actual.value, type: first.value });
      } else {
        params.push({ name: first.value });
      }
    } while (this.match('comma'));
    return params;
  }

  private parseBlock(terminators: string[]): Stmt[] {
    const body: Stmt[] = [];
    this.skipNewlines();
    while (!this.atEnd() && !this.atOneOfKeywords(terminators)) {
      const before = this.pos;
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
      if (this.pos === before) this.advance();
      this.skipNewlines();
    }
    return body;
  }

  private parseStatement(): Stmt | null {
    const tok = this.peek();
    if (tok.kind === 'keyword') {
      switch (tok.value) {
        case 'if': return this.parseIf();
        case 'while': return this.parseWhile();
        case 'for': return this.parseFor();
        case 'return': return this.parseReturn();
        case 'continue': this.advance(); return { kind: 'continue', line: tok.line };
        case 'break': this.advance(); return { kind: 'break', line: tok.line };
        case 'function':
        case 'export':
          // A nested function isn't valid inside a block; report and skip.
          this.error('Functions can only be declared at the top level');
          return this.recover(tok.line);
      }
    }
    const line = tok.line;
    const expr = this.parseExpression();
    if (this.atOp('←')) {
      this.advance();
      const value = this.parseExpression();
      if (expr.kind !== 'name' && expr.kind !== 'index') {
        this.error('Left side of ← must be a variable or an indexed element', line);
      }
      return { kind: 'assign', target: expr, value, line };
    }
    return { kind: 'exprStmt', expr, line };
  }

  private parseIf(): Stmt {
    const line = this.peek().line;
    this.expectKeyword('if');
    const cond = this.parseExpression();
    this.expectKeyword('then');
    const thenBody = this.parseBlock(['else', 'end']);
    let elseBody: Stmt[] | null = null;
    if (this.matchKeyword('else')) elseBody = this.parseBlock(['end']);
    this.expectKeyword('end');
    return { kind: 'if', cond, thenBody, elseBody, line };
  }

  private parseWhile(): Stmt {
    const line = this.peek().line;
    this.expectKeyword('while');
    const cond = this.parseExpression();
    this.expectKeyword('do');
    const body = this.parseBlock(['end']);
    this.expectKeyword('end');
    return { kind: 'while', cond, body, line };
  }

  /**
   * `for [each] [type] i in <iterable> do … end`, or the nested shorthand
   * `for i, j, … in <iterable> do … end`. A single variable is one ordinary loop;
   * several comma-separated variables desugar into perfectly nested loops over the
   * same range or collection — pseudocode shorthand common in matrix algorithms
   * (e.g. Floyd–Warshall's `for k, i, j in 0 .. n`). The nesting is built here, so
   * every later pass (resolver, interpreter, complexity, trace) sees plain loops.
   */
  private parseFor(): Stmt {
    const line = this.peek().line;
    this.expectKeyword('for');
    this.matchKeyword('each'); // optional sugar — `for each` and `for` both iterate `in`
    const vars: string[] = [];
    const first = this.expect('name', 'loop variable');
    let firstVar = first?.value ?? '_';
    // `for [each] type name in …` — a leading type identifier is optional.
    if (first && this.at('name')) firstVar = this.advance().value;
    vars.push(firstVar);
    // `for i, j, … in …` — each extra comma-separated variable nests another loop.
    while (this.match('comma')) {
      const v = this.expect('name', 'loop variable');
      vars.push(v?.value ?? '_');
    }
    this.expectKeyword('in');
    const iterable = this.parseExpression();
    this.expectKeyword('do');
    const body = this.parseBlock(['end']);
    this.expectKeyword('end');
    // One variable → a single loop; several → nested loops, innermost first.
    let nested: Stmt[] = body;
    for (let k = vars.length - 1; k >= 0; k--) {
      nested = [{ kind: 'forIn', varName: vars[k], iterable, body: nested, line }];
    }
    return nested[0];
  }

  private parseReturn(): Stmt {
    const line = this.peek().line;
    this.expectKeyword('return');
    const value = this.startsExpression() ? this.parseExpression() : null;
    return { kind: 'return', value, line };
  }

  // ── Expressions (precedence climbing) ───────────────────────
  private parseExpression(): Expr {
    const left = this.parseBinary(1);
    if (this.atOp('..')) {
      const line = this.peek().line;
      this.advance();
      const to = this.parseBinary(1);
      return { kind: 'range', from: left, to, line };
    }
    return left;
  }

  private parseBinary(minPrec: number): Expr {
    let left = this.parseUnary();
    for (;;) {
      const tok = this.peek();
      const op = this.binaryOpOf(tok);
      if (!op || BINARY_PRECEDENCE[op] < minPrec) break;
      this.advance();
      const right = this.parseBinary(BINARY_PRECEDENCE[op] + 1);
      left = { kind: 'binary', op, left, right, line: tok.line };
    }
    return left;
  }

  private parseUnary(): Expr {
    const tok = this.peek();
    if (this.atKeyword('not') || this.atOp('-')) {
      this.advance();
      const operand = this.parseUnary();
      return { kind: 'unary', op: tok.value, operand, line: tok.line };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();
    for (;;) {
      if (this.at('lparen')) {
        const line = this.peek().line;
        this.advance();
        const args = this.parseArgs();
        this.expect('rparen', "')' after arguments");
        expr = { kind: 'call', callee: expr, args, line };
      } else if (this.at('dot')) {
        const line = this.peek().line;
        this.advance();
        const name = this.expect('name', 'property name after .');
        expr = { kind: 'member', object: expr, name: name?.value ?? '', line };
      } else if (this.at('lbracket')) {
        const line = this.peek().line;
        this.advance();
        const index = this.parseExpression();
        this.expect('rbracket', "']' after index");
        expr = { kind: 'index', object: expr, index, line };
      } else {
        break;
      }
    }
    return expr;
  }

  private parseArgs(): Expr[] {
    const args: Expr[] = [];
    if (this.at('rparen')) return args;
    do {
      args.push(this.parseExpression());
    } while (this.match('comma'));
    return args;
  }

  private parsePrimary(): Expr {
    const tok = this.peek();
    switch (tok.kind) {
      case 'num':
        this.advance();
        return { kind: 'num', value: Number(tok.value), line: tok.line };
      case 'str':
        this.advance();
        return { kind: 'str', value: tok.value, line: tok.line };
      case 'name':
        this.advance();
        return ATOMS.has(tok.value)
          ? { kind: 'atom', name: tok.value, line: tok.line }
          : { kind: 'name', name: tok.value, line: tok.line };
      case 'lparen': {
        this.advance();
        const inner = this.parseExpression();
        this.expect('rparen', "')' to close (");
        return inner;
      }
      default:
        this.error(`Unexpected ${this.describe(tok)}`);
        this.advance();
        return { kind: 'atom', name: 'nil', line: tok.line };
    }
  }

  // ── Token helpers ───────────────────────────────────────────
  private peek(): Token {
    return this.tokens[this.pos];
  }
  private advance(): Token {
    const tok = this.tokens[this.pos];
    if (this.pos < this.tokens.length - 1) this.pos++;
    return tok;
  }
  private atEnd(): boolean {
    return this.peek().kind === 'eof';
  }
  private at(kind: Token['kind']): boolean {
    return this.peek().kind === kind;
  }
  private atOp(op: string): boolean {
    const tok = this.peek();
    return tok.kind === 'op' && tok.value === op;
  }
  private atKeyword(kw: string): boolean {
    const tok = this.peek();
    return tok.kind === 'keyword' && tok.value === kw;
  }
  private atOneOfKeywords(kws: string[]): boolean {
    const tok = this.peek();
    return tok.kind === 'keyword' && kws.includes(tok.value);
  }
  private match(kind: Token['kind']): boolean {
    if (this.at(kind)) {
      this.advance();
      return true;
    }
    return false;
  }
  private matchKeyword(kw: string): boolean {
    if (this.atKeyword(kw)) {
      this.advance();
      return true;
    }
    return false;
  }
  private expect(kind: Token['kind'], what: string): Token | null {
    if (this.at(kind)) return this.advance();
    this.error(`Expected ${what}`);
    return null;
  }
  private expectKeyword(kw: string): boolean {
    if (this.matchKeyword(kw)) return true;
    this.error(`Expected '${kw}'`);
    return false;
  }
  private skipNewlines(): void {
    while (this.at('newline')) this.advance();
  }
  /** Skip to the next line after an error, so recovery doesn't loop. */
  private recover(_line: number): null {
    while (!this.atEnd() && !this.at('newline')) this.advance();
    return null;
  }
  private startsExpression(): boolean {
    const tok = this.peek();
    if (tok.kind === 'num' || tok.kind === 'str' || tok.kind === 'name' || tok.kind === 'lparen') {
      return true;
    }
    return this.atKeyword('not') || this.atOp('-');
  }
  private binaryOpOf(tok: Token): string | null {
    if (tok.kind === 'op' && BINARY_PRECEDENCE[tok.value] != null) return tok.value;
    if (tok.kind === 'keyword' && (tok.value === 'and' || tok.value === 'or' || tok.value === 'in')) {
      return tok.value;
    }
    return null;
  }
  private describe(tok: Token): string {
    if (tok.kind === 'eof') return 'end of file';
    if (tok.kind === 'newline') return 'end of line';
    return `'${tok.value}'`;
  }
  private error(message: string, line = this.peek().line): void {
    const tok = this.peek();
    this.diagnostics.push({
      severity: 'error',
      message,
      fileId: this.fileId,
      line,
      from: tok.from,
      to: tok.to,
    });
  }
}

/** Parse one file into a module, appending any diagnostics found. */
export function parseModule(
  tokens: Token[],
  fileId: string,
  fileName: string,
  diagnostics: Diagnostic[],
): Module {
  return new Parser(tokens, fileId, fileName, diagnostics).parseModule();
}
