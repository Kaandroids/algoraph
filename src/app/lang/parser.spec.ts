import { describe, it, expect, beforeEach } from 'vitest';
import { lex } from './lexer';
import { parseModule } from './parser';
import type { Diagnostic } from './diagnostics';

/** Parse one source string and return the diagnostics the parser collected. */
function parseDiagnostics(src: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  parseModule(lex(src), 'main', 'main.algo', diagnostics);
  return diagnostics;
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
});
