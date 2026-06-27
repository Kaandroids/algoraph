/**
 * Resolver / linker for the parsed modules.
 *
 * Builds the global export table (an `export function` is visible to every file
 * and called directly, with no `import`), reports duplicate exports and direct
 * calls to functions that are neither declared nor built in, and produces the
 * `ExportRef[]` the overview and autocomplete consume. Data-structure method
 * calls (`pq.push`, `m.keys`) are member calls and are checked at runtime, not
 * here.
 */
import { BUILTIN_NAMES, DS_CREATE_NAME_ARG } from './builtins';
import { walkStmts } from './walk';
import type { Diagnostic } from './diagnostics';
import type { FunctionDecl, Module } from './ast';
import type { ExportRef } from '../models/exports';

export interface ResolveResult {
  /** Exported helpers, in declaration order, for the overview + autocomplete. */
  exports: ExportRef[];
  /** Every function callable by bare name: exported helpers + all declarations. */
  functions: Map<string, FunctionDecl>;
}

export function resolve(modules: Module[], diagnostics: Diagnostic[]): ResolveResult {
  const exports: ExportRef[] = [];
  const functions = new Map<string, FunctionDecl>();
  const exportedAt = new Map<string, string>(); // name → fileName of first export

  for (const module of modules) {
    for (const item of module.items) {
      if (item.kind !== 'function') continue;
      functions.set(item.name, item);
      if (!item.exported) continue;
      if (exportedAt.has(item.name)) {
        diagnostics.push({
          severity: 'error',
          message: `Duplicate export '${item.name}' (already exported from ${exportedAt.get(item.name)})`,
          fileId: module.fileId,
          line: item.line,
        });
        continue;
      }
      exportedAt.set(item.name, module.fileName);
      exports.push({
        name: item.name,
        params: item.params.map((p) => p.name).join(', '),
        file: module.fileName,
      });
    }
  }

  // Flag bare calls to unknown names, and data structures created with a name
  // that can't be referenced in code (must be a plain identifier).
  const known = new Set([...functions.keys(), ...BUILTIN_NAMES]);
  for (const module of modules) {
    for (const item of module.items) {
      const body = item.kind === 'function' ? item.body : [item];
      walkStmts(body, { onExpr: (expr) => {
        if (expr.kind !== 'call') return;
        if (expr.callee.kind === 'name' && !known.has(expr.callee.name)) {
          diagnostics.push({
            severity: 'error',
            message: `Unknown function '${expr.callee.name}'`,
            fileId: module.fileId,
            line: expr.line,
          });
        }
        const fname =
          expr.callee.kind === 'name' || expr.callee.kind === 'member' ? expr.callee.name : null;
        const nameArg = fname ? DS_CREATE_NAME_ARG[fname] : undefined;
        if (nameArg !== undefined) {
          const arg = expr.args[nameArg];
          if (arg?.kind === 'str' && !IDENT.test(arg.value)) {
            diagnostics.push({
              severity: 'error',
              message: `"${arg.value}" isn't a valid name — use letters, digits and _ (no spaces or symbols), or omit the name to auto-number it.`,
              fileId: module.fileId,
              line: expr.line,
            });
          }
        }
      } });
    }
  }

  return { exports, functions };
}

/** A name usable as a DSL identifier; anything else can't be referenced by name. */
const IDENT = /^[A-Za-z_]\w*$/;
