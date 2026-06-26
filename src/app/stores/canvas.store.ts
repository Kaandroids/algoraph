import { Injectable, computed, signal } from '@angular/core';
import { type GEdge, type GNode, type NodeKind } from '../models/graph.model';
import {
  DATA_STRUCTURES,
  makeDataNode,
  type DataNode,
  type DataStructureKind,
} from '../models/data-structure.model';

/** A node move reported by the canvas — only the id and its new position. */
interface NodeMove {
  id: string;
  position: { x: number; y: number };
}

/** A serialisable snapshot of the whole canvas (graph + data structures). */
export interface CanvasSnapshot {
  version: number;
  nodes: GNode[];
  edges: GEdge[];
  dataNodes: DataNode[];
}

/**
 * The canvas model — graph vertices, the edges between them and the
 * data-structure nodes, with all the pure operations that mutate them. Graph
 * vertices and data structures share one name namespace (`usedNames`). UI-only
 * concerns (context menus, the inline editors, pan/zoom) stay in the component.
 */
@Injectable({ providedIn: 'root' })
export class CanvasStore {
  /** The canvas starts blank — the learner builds the graph and drops data structures. */
  readonly nodes = signal<GNode[]>([]);
  readonly edges = signal<GEdge[]>([]);
  readonly dataNodes = signal<DataNode[]>([]);

  /** Per-kind breakdown shown in the overview panel. */
  readonly summary = computed(() => {
    const ns = this.nodes();
    const es = this.edges();
    return {
      starts: ns.filter((n) => n.kind === 'START').length,
      goals: ns.filter((n) => n.kind === 'GOAL').length,
      plain: ns.filter((n) => n.kind === 'NODE').length,
      directed: es.filter((e) => e.directed).length,
      undirected: es.filter((e) => !e.directed).length,
    };
  });

  private nextNodeId = 1;
  private nextDataId = 1;

  // ── Names (graph vertices + data structures share one namespace) ──
  /** Lower-cased names currently taken by any node, optionally excluding one id. */
  usedNames(exceptId?: string): Set<string> {
    const names = new Set<string>();
    for (const n of this.nodes()) if (n.id !== exceptId) names.add(n.label.toLowerCase());
    for (const d of this.dataNodes()) if (d.id !== exceptId) names.add(d.label.toLowerCase());
    return names;
  }

  /** `base`, or `base2`, `base3`, … — the first variant not already in use. */
  uniqueName(base: string, exceptId?: string): string {
    const used = this.usedNames(exceptId);
    if (!used.has(base.toLowerCase())) return base;
    let i = 2;
    while (used.has(`${base}${i}`.toLowerCase())) i++;
    return `${base}${i}`;
  }

  // ── Graph vertices ────────────────────────────────────────
  /** Add a vertex at a random spot near the top-left (library click). */
  addNode(kind: NodeKind): void {
    this.addNodeAt(kind, { x: 220 + Math.random() * 220, y: 120 + Math.random() * 220 });
  }

  /** Add a vertex at a specific canvas position (right-click menu). */
  addNodeAt(kind: NodeKind, position: { x: number; y: number }): void {
    const id = `n${this.nextNodeId++}`;
    const label = this.uniqueName(id.toUpperCase());
    this.nodes.update((list) => [...list, { id, kind, label, position }]);
  }

  deleteNode(id: string): void {
    this.nodes.update((list) => list.filter((n) => n.id !== id));
    this.edges.update((list) =>
      list.filter((e) => !e.outputId.startsWith(`${id}-`) && !e.inputId.startsWith(`${id}-`)),
    );
  }

  copyNode(id: string): void {
    const node = this.nodes().find((n) => n.id === id);
    if (!node) return;
    const newId = `n${this.nextNodeId++}`;
    const label = this.uniqueName(node.label);
    this.nodes.update((list) => [
      ...list,
      { id: newId, kind: node.kind, label, position: { x: node.position.x + 40, y: node.position.y + 40 } },
    ]);
  }

  // ── Data-structure nodes ──────────────────────────────────
  addDataNode(kind: DataStructureKind): void {
    this.addDataNodeAt(kind, { x: 240 + Math.random() * 220, y: 460 + Math.random() * 160 });
  }

  addDataNodeAt(kind: DataStructureKind, position: { x: number; y: number }): void {
    const id = `ds${this.nextDataId++}`;
    const label = this.uniqueName(DATA_STRUCTURES[kind].defaultLabel);
    this.dataNodes.update((list) => [...list, makeDataNode(kind, id, position, label)]);
  }

  deleteDataNode(id: string): void {
    this.dataNodes.update((list) => list.filter((n) => n.id !== id));
  }

  copyDataNode(id: string): void {
    const node = this.dataNodes().find((n) => n.id === id);
    if (!node) return;
    const newId = `ds${this.nextDataId++}`;
    const label = this.uniqueName(node.label);
    this.dataNodes.update((list) => [
      ...list,
      {
        ...node,
        id: newId,
        label,
        position: { x: node.position.x + 40, y: node.position.y + 40 },
        items: [...node.items],
        entries: node.entries.map((e) => ({ ...e })),
        heap: node.heap.map((h) => ({ ...h })),
        matrix: node.matrix.map((row) => [...row]),
      },
    ]);
  }

  /** Apply a change to one data-structure node by id (used by the inline editor). */
  updateDataNode(id: string, change: (node: DataNode) => DataNode): void {
    this.dataNodes.update((list) => list.map((n) => (n.id === id ? change(n) : n)));
  }

  /** Rename any node (graph vertex or data structure) by id. */
  renameNode(id: string, kind: 'graph' | 'data', label: string): void {
    const rename = <T extends { id: string; label: string }>(list: T[]): T[] =>
      list.map((n) => (n.id === id ? { ...n, label } : n));
    if (kind === 'data') this.dataNodes.update(rename);
    else this.nodes.update(rename);
  }

  // ── Edges ─────────────────────────────────────────────────
  connect(sourceId: string, targetId: string | null | undefined): void {
    if (!targetId) return;
    this.edges.update((list) => [
      ...list,
      { id: `e${Date.now()}`, outputId: sourceId, inputId: targetId, weight: 1, directed: true },
    ]);
  }

  setEdgeWeight(id: string, weight: number): void {
    if (Number.isNaN(weight)) return;
    this.edges.update((list) => list.map((e) => (e.id === id ? { ...e, weight } : e)));
  }

  setEdgeDirected(id: string, directed: boolean): void {
    this.edges.update((list) => list.map((e) => (e.id === id ? { ...e, directed } : e)));
  }

  deleteEdge(id: string): void {
    this.edges.update((list) => list.filter((e) => e.id !== id));
  }

  deleteEdges(ids: string[]): void {
    this.edges.update((list) => list.filter((e) => !ids.includes(e.id)));
  }

  // ── Movement (drag) ───────────────────────────────────────
  moveNodes(moves: readonly NodeMove[]): void {
    const reposition = <T extends { id: string; position: { x: number; y: number } }>(n: T): T => {
      const moved = moves.find((m) => m.id === n.id);
      return moved ? { ...n, position: moved.position } : n;
    };
    this.nodes.update((list) => list.map(reposition));
    this.dataNodes.update((list) => list.map(reposition));
  }

  // ── Import / export ───────────────────────────────────────
  /** A snapshot of the whole canvas for download. */
  snapshot(): CanvasSnapshot {
    return { version: 1, nodes: this.nodes(), edges: this.edges(), dataNodes: this.dataNodes() };
  }

  /** Replace the canvas from an imported snapshot, keeping id counters ahead. */
  load(data: Partial<CanvasSnapshot>): void {
    if (Array.isArray(data.nodes)) this.nodes.set(data.nodes);
    if (Array.isArray(data.edges)) this.edges.set(data.edges);
    if (Array.isArray(data.dataNodes)) this.dataNodes.set(data.dataNodes);
    this.nextNodeId = maxIdNumber(this.nodes(), 'n') + 1;
    this.nextDataId = maxIdNumber(this.dataNodes(), 'ds') + 1;
  }
}

/** Highest numeric suffix among ids with the given prefix (`n3` → 3). */
function maxIdNumber(items: { id: string }[], prefix: string): number {
  let max = 0;
  for (const it of items) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(it.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}
