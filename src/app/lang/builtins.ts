/**
 * The single source of truth for the DSL's global built-in functions.
 *
 * A built-in is a function callable by bare name (`neighbors(u)`, `mark(u)`,
 * `createMap(x, y)`) — as opposed to a data-structure method (`pq.push(…)`) or a
 * user-declared `function`. Four very different consumers need to agree on this
 * list:
 *
 *   • the interpreter's `callBuiltin` dispatch (the actual behaviour),
 *   • the resolver's "unknown function" check,
 *   • the editor's syntax highlighting (`builtin` token), and
 *   • the complexity estimator's per-call cost.
 *
 * Keeping the list here — rather than re-deriving it from the documentation
 * catalogue or hand-maintaining a parallel `Set` in each consumer — means adding
 * a built-in is one entry in one place. The catalogue in `node-api.ts` stays the
 * source of the *human-facing* docs (signatures, prose, Big-O); this is the
 * source of the *machine* facts the toolchain branches on.
 */

/** Static metadata for one global built-in function. */
export interface BuiltinSpec {
  /** The bare identifier as written in pseudocode. */
  readonly name: string;
  /**
   * For a data-structure constructor (`createMap`, `createMatrix`, …), the index
   * of its optional trailing `name` argument. The resolver uses this to flag a
   * structure created with a name that can't be referenced in code. Omitted for
   * built-ins that take no such name.
   */
  readonly nameArg?: number;
}

/**
 * Every global built-in, grouped by purpose for readability. The ordering is
 * documentation-only; consumers look names up by identity.
 */
export const BUILTINS: readonly BuiltinSpec[] = [
  // ── Graph access ──
  { name: 'nodes' },
  { name: 'edges' },
  { name: 'neighbors' },
  { name: 'weight' },
  { name: 'hasEdge' },
  { name: 'degree' },
  { name: 'inDegree' },
  { name: 'outDegree' },
  { name: 'source' },
  { name: 'goal' },
  // ── Visualization ──
  { name: 'mark' },
  { name: 'unmark' },
  { name: 'setLabel' },
  { name: 'scrollTo' },
  { name: 'clearMarks' },
  { name: 'showMessage' },
  { name: 'hideMessage' },
  { name: 'printDebug' },
  // ── Canvas editing ──
  { name: 'createNode' },
  { name: 'deleteNode' },
  { name: 'createEdge' },
  { name: 'deleteEdge' },
  { name: 'createList', nameArg: 2 },
  { name: 'createStack', nameArg: 2 },
  { name: 'createQueue', nameArg: 2 },
  { name: 'createSet', nameArg: 2 },
  { name: 'createMap', nameArg: 2 },
  { name: 'createPQueue', nameArg: 2 },
  { name: 'createMatrix', nameArg: 4 },
  { name: 'deleteDS' },
  { name: 'clearGraph' },
  { name: 'clearCanvas' },
  { name: 'saveCanvas' },
];

/** Names callable by bare identifier — for highlighting and the resolver's call check. */
export const BUILTIN_NAMES: ReadonlySet<string> = new Set(BUILTINS.map((b) => b.name));

/**
 * Data-structure `create*` functions → the index of their optional `name`
 * argument. Both the bare `createMap(x, y, name)` and the namespaced
 * `scratch.createMap(name)` forms share the bare name, so this also covers the
 * `scratch.*` / `panel.*` member calls the resolver checks.
 */
export const DS_CREATE_NAME_ARG: Readonly<Record<string, number>> = Object.fromEntries(
  BUILTINS.filter((b) => b.nameArg !== undefined).map((b) => [b.name, b.nameArg as number]),
);
