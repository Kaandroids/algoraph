/**
 * Front-end pipeline: lex + parse every file, then resolve them together.
 *
 * This is the single entry point the rest of the app uses to turn the algorithm
 * files into an analysed program — the export list for the overview/autocomplete
 * and (next) the AST the interpreter walks. It deliberately does not execute.
 */
import { lex } from './lexer';
import { parseModule } from './parser';
import { resolve } from './resolver';
import type { Diagnostic } from './diagnostics';
import type { FunctionDecl, Module } from './ast';
import type { ExportRef } from '../models/exports';

/** Minimal view of a source file the compiler needs — any `AlgoFile` satisfies it. */
export interface SourceFile {
  id: string;
  name: string;
  content: string;
}

export interface CompileResult {
  modules: Module[];
  /** Exported helpers, for the overview + autocomplete. */
  exports: ExportRef[];
  /** Every function callable by bare name. */
  functions: Map<string, FunctionDecl>;
  diagnostics: Diagnostic[];
}

export function compile(files: readonly SourceFile[]): CompileResult {
  const diagnostics: Diagnostic[] = [];
  const modules = files.map((f) => parseModule(lex(f.content), f.id, f.name, diagnostics));
  const { exports, functions } = resolve(modules, diagnostics);
  return { modules, exports, functions, diagnostics };
}
