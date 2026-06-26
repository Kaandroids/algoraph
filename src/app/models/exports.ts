/**
 * Shape of an exported helper, surfaced in the Algorithm overview and offered as
 * a call completion in the editor.
 *
 * Produced by the resolver (`src/app/lang/resolver.ts`) from the parsed modules.
 */
export interface ExportRef {
  /** Helper name, e.g. `relax`. */
  name: string;
  /** Parameter names joined for display, e.g. `u, v` (may be empty). */
  params: string;
  /** Name of the file the export lives in, e.g. `helpers.algo`. */
  file: string;
}
