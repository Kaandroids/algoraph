/**
 * Graph domain model.
 *
 * The graph a learner builds — vertices and the weighted edges between them.
 * Like the data structures, every vertex kind is described once in a registry so
 * its colour, icon and library copy stay in a single place rather than being
 * duplicated between the palette and the node-rendering helpers.
 */

/** The kinds of vertex a graph can hold. */
export type NodeKind = 'NODE' | 'START' | 'GOAL';

/** A graph vertex rendered as a node card on the canvas. */
export interface GNode {
  id: string;
  kind: NodeKind;
  label: string;
  position: { x: number; y: number };
}

/** A graph edge — stored by the Foblex port ids it connects. */
export interface GEdge {
  id: string;
  outputId: string;
  inputId: string;
  weight: number;
  /** true = directed (single arrow at the target); false = undirected (plain line, no arrows). */
  directed: boolean;
}

/** A vertex entry in the tool library (its kind plus display metadata). */
export interface PaletteItem {
  kind: NodeKind;
  label: string;
  sub: string;
  icon: string;
  color: string;
  description: string;
}

/** Per-kind display metadata — the single source of truth for vertex appearance. */
interface GraphNodeDescriptor {
  readonly label: string;
  readonly sub: string;
  readonly icon: string;
  readonly color: string;
  readonly description: string;
}

const GRAPH_NODES: Record<NodeKind, GraphNodeDescriptor> = {
  NODE: {
    label: 'Vertex',
    sub: 'A plain graph node',
    icon: 'circle',
    color: 'oklch(0.58 0.13 65)',
    description:
      'A plain graph vertex — a point the algorithm can visit and link with edges. Its incoming and outgoing edges define its neighbours, and most traversals iterate over the set of vertices.',
  },
  START: {
    label: 'Start',
    sub: 'Source / entry node',
    icon: 'play',
    color: 'oklch(0.55 0.14 150)',
    description:
      'The source vertex an algorithm begins from. Single-source traversals and shortest-path searches expand outward from here, so its own distance is initialised to 0.',
  },
  GOAL: {
    label: 'Goal',
    sub: 'Target / destination',
    icon: 'target',
    color: 'oklch(0.6 0.17 290)',
    description:
      'The target vertex a search is trying to reach. Goal-directed algorithms such as A* and bidirectional search can stop as soon as it is settled.',
  },
};

/** The vertex tool library, derived from the descriptor registry. */
export const GRAPH_PALETTE: PaletteItem[] = (Object.keys(GRAPH_NODES) as NodeKind[]).map((kind) => ({
  kind,
  ...GRAPH_NODES[kind],
}));

/** Icon name for a vertex kind. */
export function nodeIcon(kind: NodeKind): string {
  return GRAPH_NODES[kind].icon;
}

/** Accent colour for a vertex kind (exposed as the node's `--nc`). */
export function nodeColor(kind: NodeKind): string {
  return GRAPH_NODES[kind].color;
}

/** Header type label for a vertex — the kind itself, shown in upper case. */
export function nodeTypeLabel(kind: NodeKind): string {
  return kind;
}
