/**
 * Hand-written lexer for the Algoraph pseudocode DSL.
 *
 * Produces a flat `Token[]` ending in an `eof` token. ASCII operator digraphs
 * are normalised to their Unicode form (`<-` → `←`, `<=` → `≤`, `>=` → `≥`,
 * `!=` → `≠`) so the parser and interpreter only ever see the canonical glyphs,
 * regardless of whether the editor's input helper ran. Line breaks are emitted
 * as `newline` tokens because the grammar uses them to terminate statements.
 */
import { KEYWORDS, type Token, type TokenKind } from './token';

/** Two-character operators, checked before single characters. */
const DIGRAPHS: Record<string, string> = {
  '<-': '←',
  '<=': '≤',
  '>=': '≥',
  '!=': '≠',
  '..': '..',
};

const SINGLE_OPS = new Set(['←', '=', '≠', '<', '>', '≤', '≥', '+', '-', '*', '/', '%']);

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch);
}
function isIdentPart(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}
function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

export function lex(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;

  const push = (kind: TokenKind, value: string, from: number, startCol: number): void => {
    tokens.push({ kind, value, line, col: startCol, from, to: i });
  };

  while (i < src.length) {
    const ch = src[i];

    // Newlines (handle CRLF as one break).
    if (ch === '\n' || ch === '\r') {
      const from = i;
      if (ch === '\r' && src[i + 1] === '\n') i++;
      i++;
      push('newline', '\n', from, col);
      line++;
      col = 1;
      continue;
    }

    // Horizontal whitespace.
    if (ch === ' ' || ch === '\t') {
      i++;
      col++;
      continue;
    }

    // Line comments.
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n' && src[i] !== '\r') i++;
      continue;
    }

    const startCol = col;
    const from = i;

    // Strings.
    if (ch === '"') {
      i++;
      col++;
      let value = '';
      while (i < src.length && src[i] !== '"' && src[i] !== '\n') {
        if (src[i] === '\\' && i + 1 < src.length) {
          value += src[i + 1];
          i += 2;
          col += 2;
        } else {
          value += src[i];
          i++;
          col++;
        }
      }
      if (src[i] === '"') {
        i++;
        col++;
      }
      push('str', value, from, startCol);
      continue;
    }

    // Numbers.
    if (isDigit(ch)) {
      while (i < src.length && isDigit(src[i])) {
        i++;
        col++;
      }
      if (src[i] === '.' && isDigit(src[i + 1])) {
        i++;
        col++;
        while (i < src.length && isDigit(src[i])) {
          i++;
          col++;
        }
      }
      push('num', src.slice(from, i), from, startCol);
      continue;
    }

    // Identifiers and keywords.
    if (isIdentStart(ch)) {
      while (i < src.length && isIdentPart(src[i])) {
        i++;
        col++;
      }
      const word = src.slice(from, i);
      push(KEYWORDS.has(word) ? 'keyword' : 'name', word, from, startCol);
      continue;
    }

    // Operator digraphs (ASCII → Unicode).
    const pair = src.slice(i, i + 2);
    if (DIGRAPHS[pair]) {
      const value = DIGRAPHS[pair];
      i += 2;
      col += 2;
      push('op', value, from, startCol);
      continue;
    }

    // Single-character operators and punctuation.
    i++;
    col++;
    if (SINGLE_OPS.has(ch)) push('op', ch, from, startCol);
    else if (ch === '(') push('lparen', ch, from, startCol);
    else if (ch === ')') push('rparen', ch, from, startCol);
    else if (ch === '[') push('lbracket', ch, from, startCol);
    else if (ch === ']') push('rbracket', ch, from, startCol);
    else if (ch === ',') push('comma', ch, from, startCol);
    else if (ch === '.') push('dot', ch, from, startCol);
    // Anything else (a stray character) is dropped; the parser reports the gap.
  }

  tokens.push({ kind: 'eof', value: '', line, col, from: i, to: i });
  return tokens;
}
