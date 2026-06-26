/**
 * Diagnostics produced by the lexer, parser and resolver.
 *
 * A diagnostic is addressed to a file + line (and an optional document span) so
 * the editor can underline it and the Run workspace can refuse to execute a
 * program that has errors.
 */

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  severity: Severity;
  message: string;
  fileId: string;
  /** 1-based line. */
  line: number;
  /** Document offsets, when known, for editor underlining. */
  from?: number;
  to?: number;
}
