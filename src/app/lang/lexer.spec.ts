import { describe, it, expect, beforeEach } from 'vitest';
import { lex } from './lexer';
import type { Token } from './token';

/** The token kinds, in order, dropping the trailing eof. */
function kinds(src: string): string[] {
  return lex(src)
    .filter((t) => t.kind !== 'eof')
    .map((t) => t.kind);
}

/** The operator token values, in order (normalised to their Unicode glyphs). */
function ops(src: string): string[] {
  return lex(src)
    .filter((t) => t.kind === 'op')
    .map((t) => t.value);
}

/** The first token of a given kind, or undefined. */
function firstOf(src: string, kind: Token['kind']): Token | undefined {
  return lex(src).find((t) => t.kind === kind);
}

describe('lexer', () => {
  beforeEach(() => {
    // pure-function lexer — no state to reset between cases
  });

  it('always terminates the stream with an eof token', () => {
    const tokens = lex('x ← 1');
    expect(tokens.at(-1)!.kind).toBe('eof');
  });

  it('normalises ASCII operator digraphs to their Unicode glyphs', () => {
    expect(ops('a <- b')).toEqual(['←']); // <- → ←
    expect(ops('a <= b')).toEqual(['≤']);
    expect(ops('a >= b')).toEqual(['≥']);
    expect(ops('a != b')).toEqual(['≠']);
  });

  it('reads the bare single-character comparison and assignment operators', () => {
    expect(ops('a ← b')).toEqual(['←']);
    expect(ops('a = b')).toEqual(['=']);
    expect(ops('a < b')).toEqual(['<']);
    expect(ops('a > b')).toEqual(['>']);
    expect(ops('a + b - c')).toEqual(['+', '-']);
  });

  it('lexes the .. range operator between numbers', () => {
    expect(kinds('1..3')).toEqual(['num', 'op', 'num']);
    expect(ops('1..3')).toEqual(['..']);
  });

  it('drops // line comments, keeping the trailing newline', () => {
    // A whole-line comment yields no tokens (just eof).
    expect(kinds('// just a comment')).toEqual([]);
    // A trailing comment is stripped but the line break survives.
    const tokens = lex('x ← 1 // tail comment\n');
    expect(tokens.map((t) => t.value)).toEqual(['x', '←', '1', '\n', '']);
    expect(tokens.some((t) => t.value.includes('tail'))).toBe(false);
  });

  it('tokenises integer and decimal numbers, keeping the literal text', () => {
    expect(kinds('42 3.14')).toEqual(['num', 'num']);
    expect(lex('42 3.14').filter((t) => t.kind === 'num').map((t) => t.value)).toEqual(['42', '3.14']);
  });

  it('tokenises string literals and unescapes embedded quotes', () => {
    expect(firstOf('"hello world"', 'str')!.value).toBe('hello world');
    // Source: "a\"b"  →  the escaped quote becomes a literal " inside the value.
    expect(firstOf('"a\\"b"', 'str')!.value).toBe('a"b');
  });

  it('classifies keywords vs plain identifiers', () => {
    const tokens = lex('while foo');
    expect(tokens.filter((t) => t.kind !== 'eof').map((t) => [t.kind, t.value])).toEqual([
      ['keyword', 'while'],
      ['name', 'foo'],
    ]);
  });

  it('records punctuation as its own token kinds', () => {
    expect(kinds('f(a, b)[0].x')).toEqual([
      'name', 'lparen', 'name', 'comma', 'name', 'rparen', 'lbracket', 'num', 'rbracket', 'dot', 'name',
    ]);
  });

  it('degrades gracefully on malformed input rather than reporting a token error', () => {
    // A stray character is silently dropped (the parser reports the gap, not the lexer).
    const dropped = lex('a @ b');
    expect(dropped.filter((t) => t.kind !== 'eof').map((t) => t.value)).toEqual(['a', 'b']);
    expect(dropped.some((t) => t.value === '@')).toBe(false);
    // An unterminated string still lexes to a single str token without throwing.
    expect(firstOf('"unterminated', 'str')!.value).toBe('unterminated');
  });
});
