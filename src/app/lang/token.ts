/**
 * Token model for the Algoraph pseudocode lexer.
 *
 * The lexer turns source text into a flat token stream the parser consumes.
 * Newlines are significant — they terminate statements — so they are emitted as
 * their own tokens rather than skipped as whitespace.
 */

export type TokenKind =
  | 'num'
  | 'str'
  | 'name'
  | 'keyword'
  | 'op'
  | 'lparen'
  | 'rparen'
  | 'lbracket'
  | 'rbracket'
  | 'comma'
  | 'dot'
  | 'newline'
  | 'eof';

export interface Token {
  kind: TokenKind;
  /** The token text — operators are normalised to their Unicode form (`<-` → `←`). */
  value: string;
  /** 1-based line of the token's first character. */
  line: number;
  /** 1-based column of the token's first character. */
  col: number;
  /** Document offset of the token start (for editor diagnostics). */
  from: number;
  /** Document offset just past the token end. */
  to: number;
}

/** Reserved words. `and`/`or`/`not`/`in` are operators the parser reads as keywords. */
export const KEYWORDS = new Set([
  'export', 'function', 'return', 'if', 'then', 'else', 'end',
  'while', 'do', 'for', 'each', 'in', 'continue', 'break',
  'and', 'or', 'not',
]);

/** Identifier-shaped literals recognised by the parser as atoms, not variables. */
export const ATOMS = new Set(['INFINITY', 'true', 'false', 'nil']);
