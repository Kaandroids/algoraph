/**
 * Data-structure domain model.
 *
 * Algoraph lets a learner drop data structures onto the canvas to watch the state
 * an algorithm keeps (a visited set, a distance map, a frontier queue, …). Every
 * fact about a kind — its metadata, how a fresh instance is seeded, how its size
 * reads — lives in a single descriptor here, so adding a kind is one entry rather
 * than a change spread across half a dozen `switch` statements.
 */

/** The data structures available in the library. */
export type DataStructureKind = 'LIST' | 'STACK' | 'QUEUE' | 'SET' | 'MAP' | 'PQUEUE' | 'MATRIX';

/** A single key → value pair held by a MAP node. */
export interface MapEntry {
  key: string;
  value: string | number;
}

/** A value with its priority, held by a PQUEUE (min-heap) node. */
export interface HeapEntry {
  value: string;
  priority: number;
}

/**
 * A data-structure node — pure display. It holds contents and renders them, but
 * has no ports and no input/output: it exists only to make an algorithm's state
 * visible. Only the field matching `kind` is meaningful; the rest stay empty.
 */
export interface DataNode {
  id: string;
  kind: DataStructureKind;
  /** Variable-style name shown in the header, e.g. `dist`, `pq`, `visited`. */
  label: string;
  position: { x: number; y: number };
  /** LIST · STACK · QUEUE · SET — linear contents. */
  items: (string | number)[];
  /** MAP — key → value rows. */
  entries: MapEntry[];
  /** PQUEUE — values with priority, kept sorted (lowest priority first). */
  heap: HeapEntry[];
  /** MATRIX — row-major numeric grid. */
  matrix: number[][];
}

/** A data-structure entry in the tool library (its kind plus display metadata). */
export interface DataPaletteItem {
  kind: DataStructureKind;
  label: string;
  sub: string;
  icon: string;
  color: string;
  description: string;
}

/**
 * Everything Algoraph needs to know about one kind, in one place. New kinds are
 * added by appending a descriptor here (and an arm to the shared `dsBody`
 * template) — there are no other switches to keep in sync.
 */
export interface DataStructureDescriptor {
  /** Full name shown in the library and the info modal (e.g. "Priority Queue"). */
  readonly label: string;
  /** Compact tag shown on the node header and in lists (e.g. "Priority Q"). */
  readonly tag: string;
  /** One-line summary shown beneath the label in the library. */
  readonly sub: string;
  /** Icon name from the shared icon set. */
  readonly icon: string;
  /** Accent colour, exposed to the template as the node's `--nc`. */
  readonly color: string;
  /** Textbook (CLRS-style) description for the info modal. */
  readonly description: string;
  /** Default variable name when the structure is dropped from the library. */
  readonly defaultLabel: string;
  /** Seed a fresh node's contents with a small sample so the card is never empty. */
  seed(node: DataNode): void;
  /** Current element count, formatted for the globals list (e.g. "3", "3×3"). */
  size(node: DataNode): string;
}

/** The single source of truth for every data-structure kind. */
export const DATA_STRUCTURES: Record<DataStructureKind, DataStructureDescriptor> = {
  LIST: {
    label: 'List / Array',
    tag: 'Array',
    sub: 'Indexed, ordered values',
    icon: 'list',
    color: 'oklch(0.6 0.13 230)',
    defaultLabel: 'list',
    description:
      'An ordered sequence addressed by position. Reading or overwriting any index is O(1); inserting or removing in the middle shifts the following elements, so it costs O(n).',
    seed: (node) => void (node.items = [5, 3, 8, 1, 4]),
    size: (node) => `${node.items.length}`,
  },
  STACK: {
    label: 'Stack',
    tag: 'Stack',
    sub: 'LIFO — push / pop on top',
    icon: 'layers',
    color: 'oklch(0.58 0.14 300)',
    defaultLabel: 'stack',
    description:
      'A last-in, first-out (LIFO) collection: you push onto the top and pop from the top, so only the most recently added element is reachable. Backs depth-first search and backtracking.',
    seed: (node) => void (node.items = [4, 2, 7]),
    size: (node) => `${node.items.length}`,
  },
  QUEUE: {
    label: 'Queue',
    tag: 'Queue',
    sub: 'FIFO — front to back',
    icon: 'arrowRightLeft',
    color: 'oklch(0.6 0.13 200)',
    defaultLabel: 'queue',
    description:
      'A first-in, first-out (FIFO) collection: you enqueue at the back and dequeue from the front, so elements leave in the order they arrived. It is the frontier of breadth-first search.',
    seed: (node) => void (node.items = ['A', 'B', 'C', 'D']),
    size: (node) => `${node.items.length}`,
  },
  SET: {
    label: 'Set',
    tag: 'Set',
    sub: 'Unique membership',
    icon: 'braces',
    color: 'oklch(0.58 0.15 350)',
    defaultLabel: 'set',
    description:
      'An unordered collection of distinct elements. Adding an element and testing membership are amortized O(1). Graph traversals use it to remember which vertices have been visited.',
    seed: (node) => void (node.items = ['A', 'C', 'F']),
    size: (node) => `${node.items.length}`,
  },
  MAP: {
    label: 'Map',
    tag: 'Map',
    sub: 'Key → value lookup',
    icon: 'arrowRight',
    color: 'oklch(0.58 0.14 162)',
    defaultLabel: 'map',
    description:
      'A collection of key → value pairs (dictionary / hash map). Every key is unique and maps to a single value; lookups and updates are amortized O(1). Stores distances, predecessors, colours and similar per-vertex data.',
    seed: (node) =>
      void (node.entries = [
        { key: 'A', value: 0 },
        { key: 'B', value: 4 },
        { key: 'C', value: 2 },
      ]),
    size: (node) => `${node.entries.length}`,
  },
  PQUEUE: {
    label: 'Priority Queue',
    tag: 'Priority Q',
    sub: 'Min-heap by priority',
    icon: 'gitBranch',
    color: 'oklch(0.64 0.15 50)',
    defaultLabel: 'pq',
    description:
      'A queue ordered by priority instead of arrival time. Removing the smallest (or largest) element takes O(log n) with a binary heap. It drives Dijkstra, Prim and A*.',
    seed: (node) =>
      void (node.heap = [
        { value: 'A', priority: 0 },
        { value: 'C', priority: 2 },
        { value: 'B', priority: 4 },
      ]),
    size: (node) => `${node.heap.length}`,
  },
  MATRIX: {
    label: '2D Matrix',
    tag: 'Matrix',
    sub: 'Row × column grid',
    icon: 'grid',
    color: 'oklch(0.56 0.13 20)',
    defaultLabel: 'matrix',
    description:
      'A two-dimensional grid of values indexed by row and column. As an adjacency matrix it records a weight for every pair of vertices in O(V²) space with O(1) access. Used by Floyd–Warshall.',
    seed: (node) =>
      void (node.matrix = [
        [0, 4, 2],
        [4, 0, 1],
        [2, 1, 0],
      ]),
    size: (node) => (node.matrix.length ? `${node.matrix.length}×${node.matrix[0].length}` : '0'),
  },
};

/** Library order — preserves the order kinds are declared in the registry above. */
export const DATA_STRUCTURE_KINDS = Object.keys(DATA_STRUCTURES) as DataStructureKind[];

/** The data-structure tool library, derived from the descriptor registry. */
export const DATA_PALETTE: DataPaletteItem[] = DATA_STRUCTURE_KINDS.map((kind) => {
  const d = DATA_STRUCTURES[kind];
  return { kind, label: d.label, sub: d.sub, icon: d.icon, color: d.color, description: d.description };
});

/** Build a fresh data-structure node, seeded with sample contents. */
export function makeDataNode(
  kind: DataStructureKind,
  id: string,
  position: { x: number; y: number },
  label: string = DATA_STRUCTURES[kind].defaultLabel,
): DataNode {
  const node: DataNode = { id, kind, label, position, items: [], entries: [], heap: [], matrix: [] };
  DATA_STRUCTURES[kind].seed(node);
  return node;
}

/** Current element count, formatted for the globals list. */
export function dataSize(node: DataNode): string {
  return DATA_STRUCTURES[node.kind].size(node);
}

/** Readable inline form of a linear structure's items — sets in braces, the rest in brackets. */
export function formatDataItems(node: DataNode): string {
  const inner = node.items.join(', ');
  return node.kind === 'SET' ? `{ ${inner} }` : `[${inner}]`;
}
