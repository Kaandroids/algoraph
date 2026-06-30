import { describe, it, expect, beforeEach } from 'vitest';
import { lex } from './lexer';
import { parseModule } from './parser';
import type { Diagnostic } from './diagnostics';
import type { Expr, Module, Stmt } from './ast';

/** Parse one source string and return the diagnostics the parser collected. */
function parseDiagnostics(src: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  parseModule(lex(src), 'main', 'main.algo', diagnostics);
  return diagnostics;
}

/** Parse one source string, returning both the module and the diagnostics. */
function parse(src: string): { module: Module; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const module = parseModule(lex(src), 'main', 'main.algo', diagnostics);
  return { module, diagnostics };
}

/** The value expression of a `return` parsed as the module's first statement. */
function returnValue(src: string): Expr | null {
  const stmt = parse(src).module.items[0] as Extract<Stmt, { kind: 'return' }>;
  expect(stmt.kind).toBe('return');
  return stmt.value;
}

/** Whether an error diagnostic mentioning `fragment` was produced. */
function hasError(src: string, fragment: string): boolean {
  return parseDiagnostics(src).some((d) => d.severity === 'error' && d.message.includes(fragment));
}

describe('parser diagnostics', () => {
  let diagnostics: Diagnostic[];
  beforeEach(() => {
    diagnostics = [];
  });

  it('parses a well-formed statement with no diagnostics', () => {
    parseModule(lex('x ← 1\n'), 'main', 'main.algo', diagnostics);
    expect(diagnostics).toEqual([]);
  });

  it("reports a missing 'end' for a do-block (while)", () => {
    expect(hasError('while flag do\n  x ← 1\n', "Expected 'end'")).toBe(true);
  });

  it("reports a missing 'end' for a then-block (if)", () => {
    expect(hasError('if flag then\n  x ← 1\n', "Expected 'end'")).toBe(true);
  });

  it('reports a malformed assignment (left side is not assignable)', () => {
    const found = parseDiagnostics('5 ← x\n');
    expect(found.some((d) => d.severity === 'error' && d.message.includes('Left side of ←'))).toBe(true);
  });

  it('reports an unexpected token at the start of an expression', () => {
    const found = parseDiagnostics('* 5\n');
    expect(found.some((d) => d.severity === 'error' && d.message.includes("Unexpected '*'"))).toBe(true);
  });

  it('reports a missing closing paren in a call', () => {
    expect(hasError('foo(\n', "Expected ')' after arguments")).toBe(true);
  });

  it('tags diagnostics with the file id and a 1-based line', () => {
    const found = parseDiagnostics('x ← 1\nwhile flag do\n  y ← 2\n');
    const err = found.find((d) => d.severity === 'error');
    expect(err).toBeDefined();
    expect(err!.fileId).toBe('main');
    expect(err!.line).toBeGreaterThanOrEqual(1);
  });

  it('recovers after one error so a later valid line still parses cleanly', () => {
    // The stray '*' on line 1 errors once; the assignment on line 2 is fine.
    const found = parseDiagnostics('* 5\nx ← 1\n');
    expect(found.filter((d) => d.severity === 'error')).toHaveLength(1);
  });

  it('recovers from a malformed function header by skipping the rest of its line', () => {
    // Missing function name → one error, then recovery discards the trailing
    // garbage on that line so the following statement parses cleanly.
    const { module, diagnostics } = parse('function 123 bad\nx ← 1\n');
    expect(diagnostics.some((d) => d.severity === 'error' && d.message.includes('function name'))).toBe(true);
    const assign = module.items.find((i) => i.kind === 'assign') as Extract<Stmt, { kind: 'assign' }>;
    expect(assign).toBeDefined();
    expect(assign.target).toMatchObject({ kind: 'name', name: 'x' });
  });
});

describe('parser grammar paths', () => {
  it('parses a parenthesised expression, unwrapping to the inner node', () => {
    const { module, diagnostics } = parse('x ← (1 + 2)\n');
    expect(diagnostics).toEqual([]);
    const assign = module.items[0] as Extract<Stmt, { kind: 'assign' }>;
    expect(assign.kind).toBe('assign');
    // The parentheses carry no node of their own — the inner binary surfaces directly.
    expect(assign.value).toMatchObject({ kind: 'binary', op: '+' });
  });

  it("reports a missing ')' that closes a parenthesised expression", () => {
    expect(hasError('x ← (1 + 2\n', "Expected ')' to close (")).toBe(true);
  });

  it('reads a bare return (no value) when no expression follows', () => {
    expect(returnValue('return\n')).toBeNull();
    expect(parse('return\n').diagnostics).toEqual([]);
  });

  it('recognises every expression-starting token after return', () => {
    expect(returnValue('return 1\n')).toMatchObject({ kind: 'num' });
    expect(returnValue('return "s"\n')).toMatchObject({ kind: 'str' });
    expect(returnValue('return x\n')).toMatchObject({ kind: 'name' });
    expect(returnValue('return (x)\n')).toMatchObject({ kind: 'name' }); // parens unwrap
    expect(returnValue('return not x\n')).toMatchObject({ kind: 'unary', op: 'not' });
    expect(returnValue('return -x\n')).toMatchObject({ kind: 'unary', op: '-' });
  });
});

describe('parser — for loop variables', () => {
  /** The first statement, asserted to be a `forIn`. */
  const forStmt = (src: string) => {
    const s = parse(src).module.items[0] as Extract<Stmt, { kind: 'forIn' }>;
    expect(s.kind).toBe('forIn');
    return s;
  };

  it('parses a single-variable for as one loop (body sits directly inside)', () => {
    const stmt = forStmt('for i in 0 .. 3 do\n  x ← i\nend\n');
    expect(stmt.varName).toBe('i');
    expect(stmt.iterable.kind).toBe('range');
    expect(stmt.body[0].kind).toBe('assign');
  });

  it('still accepts the optional leading type in the single-variable form', () => {
    const stmt = forStmt('for int i in 0 .. 3 do\n  x ← i\nend\n');
    expect(stmt.varName).toBe('i');
    expect(stmt.body[0].kind).toBe('assign');
  });

  it('desugars `for i, j in …` into perfectly nested loops over one iterable', () => {
    const outer = forStmt('for i, j in 0 .. 3 do\n  x ← i\nend\n');
    expect(outer.varName).toBe('i');
    const inner = outer.body[0] as Extract<Stmt, { kind: 'forIn' }>;
    expect(inner.kind).toBe('forIn');
    expect(inner.varName).toBe('j');
    expect(outer.body.length).toBe(1); // the outer holds only the inner loop
    expect(inner.body[0].kind).toBe('assign'); // the user's body sits innermost
    expect(outer.iterable).toBe(inner.iterable); // the same range is shared by every level
  });

  it('nests three variables outermost-first', () => {
    const a = forStmt('for k, i, j in nodes() do\n  visit(j)\nend\n');
    const b = a.body[0] as Extract<Stmt, { kind: 'forIn' }>;
    const c = b.body[0] as Extract<Stmt, { kind: 'forIn' }>;
    expect([a.varName, b.varName, c.varName]).toEqual(['k', 'i', 'j']);
    expect(c.body[0].kind).toBe('exprStmt');
  });
});
