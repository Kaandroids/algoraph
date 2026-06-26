/**
 * Lightweight scan of `export function` declarations across the algorithm files.
 *
 * This is a stop-gap until the real parser / resolver (coming next) produces the
 * export table. It keeps the same shape so the Algorithm overview and the editor
 * autocomplete can already list every exported helper and the file it came from;
 * the resolver will later replace the scan internals without changing this type.
 */
export interface ExportRef {
  /** Helper name, e.g. `relax`. */
  name: string;
  /** Raw parameter list as written, e.g. `u, v` (may be empty). */
  params: string;
  /** Name of the file the export lives in, e.g. `helpers.algo`. */
  file: string;
}

/** Minimal view of a source file the scan needs — any `AlgoFile` satisfies it. */
interface SourceFile {
  name: string;
  content: string;
}

const EXPORT_FN = /^[ \t]*export[ \t]+function[ \t]+([A-Za-z_]\w*)[ \t]*\(([^)]*)\)/gm;

/** Every `export function` across the given files, in document order. */
export function scanExports(files: readonly SourceFile[]): ExportRef[] {
  const found: ExportRef[] = [];
  for (const file of files) {
    EXPORT_FN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = EXPORT_FN.exec(file.content))) {
      found.push({ name: match[1], params: match[2].trim(), file: file.name });
    }
  }
  return found;
}
