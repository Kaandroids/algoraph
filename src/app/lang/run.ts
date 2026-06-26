/**
 * Orchestration: compile the files, then run the entry against the live canvas.
 *
 * This is the single call the Run workspace makes. If compilation produced any
 * errors, it returns them without executing; otherwise it walks `main` eagerly
 * and returns the full trace to scrub through.
 */
import { compile, type CompileResult, type SourceFile } from './compile';
import { Interpreter, type RunInput } from './interpreter';
import type { RunResult } from './trace';

export type { RunInput } from './interpreter';

function failed(compiled: CompileResult, message: string): RunResult {
  return {
    steps: [],
    diagnostics: compiled.diagnostics,
    error: message,
    bigO: { time: 'O(?)', space: 'O(?)' },
  };
}

export function runProgram(compiled: CompileResult, input: RunInput): RunResult {
  const errors = compiled.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length) return failed(compiled, 'Fix the errors before running.');

  const entry = compiled.modules.find((m) => m.fileId === input.entryId) ?? compiled.modules[0];
  if (!entry) return failed(compiled, 'There is no entry file to run.');

  const result = new Interpreter(entry, compiled.functions, input).run();
  result.diagnostics = compiled.diagnostics;
  return result;
}

export function compileAndRun(files: readonly SourceFile[], input: RunInput): RunResult {
  return runProgram(compile(files), input);
}
