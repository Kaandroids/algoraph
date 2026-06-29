import { describe, it, expect, beforeEach } from 'vitest';
import '@angular/compiler'; // provides the JIT compiler for `Injector.create` under bare vitest
import { Injector } from '@angular/core';
import { CanvasStore } from './canvas.store';

// `CanvasStore` is a dependency-free `@Injectable` (signals only, no `inject()`),
// so a bare core `Injector` resolves a fresh instance per test without needing
// the Angular DOM testing platform — which `npx vitest run` can't wire up
// outside the `@angular/build:unit-test` harness.

describe('CanvasStore', () => {
  let store: CanvasStore;

  beforeEach(() => {
    store = Injector.create({ providers: [CanvasStore] }).get(CanvasStore);
  });

  it('starts blank', () => {
    expect(store.nodes().length).toBe(0);
    expect(store.edges().length).toBe(0);
    expect(store.dataNodes().length).toBe(0);
  });

  // ── Graph vertices ────────────────────────────────────────
  describe('vertices', () => {
    it('adds a vertex with an auto id, kind and uppercase label', () => {
      store.addNode('NODE');
      expect(store.nodes().length).toBe(1);
      const n = store.nodes()[0];
      expect(n.id).toBe('n1');
      expect(n.kind).toBe('NODE');
      expect(n.label).toBe('N1');
    });

    it('addNodeAt places the vertex at the given position', () => {
      store.addNodeAt('START', { x: 11, y: 22 });
      const n = store.nodes()[0];
      expect(n.kind).toBe('START');
      expect(n.position).toEqual({ x: 11, y: 22 });
    });

    it('gives sequential ids and distinct labels across adds', () => {
      store.addNode('NODE');
      store.addNode('GOAL');
      expect(store.nodes().map((n) => n.id)).toEqual(['n1', 'n2']);
      expect(store.nodes().map((n) => n.label)).toEqual(['N1', 'N2']);
    });

    it('deletes a vertex by id', () => {
      store.addNode('NODE');
      store.addNode('NODE');
      store.deleteNode('n1');
      expect(store.nodes().map((n) => n.id)).toEqual(['n2']);
    });

    it('deleting a vertex also drops edges touching its ports', () => {
      store.addNode('NODE'); // n1
      store.addNode('NODE'); // n2
      store.connect('n1-out', 'n2-in');
      store.connect('n2-out', 'n1-in');
      expect(store.edges().length).toBe(2);
      store.deleteNode('n1');
      expect(store.edges().length).toBe(0);
    });

    it('copies a vertex with a unique label and offset position', () => {
      store.addNodeAt('NODE', { x: 100, y: 100 }); // n1 / N1
      store.copyNode('n1');
      expect(store.nodes().length).toBe(2);
      const copy = store.nodes()[1];
      expect(copy.id).not.toBe('n1');
      expect(copy.label).not.toBe('N1');
      expect(copy.position).toEqual({ x: 140, y: 140 });
    });

    it('copyNode on a missing id is a no-op', () => {
      store.copyNode('nope');
      expect(store.nodes().length).toBe(0);
    });

    it('renames a graph vertex', () => {
      store.addNode('NODE');
      store.renameNode('n1', 'graph', 'Hello');
      expect(store.nodes()[0].label).toBe('Hello');
    });
  });

  // ── Names / dedup ─────────────────────────────────────────
  describe('names', () => {
    it('usedNames collects lower-cased labels from vertices and data nodes', () => {
      store.addNode('NODE'); // N1
      store.addDataNode('STACK'); // stack
      const used = store.usedNames();
      expect(used.has('n1')).toBe(true);
      expect(used.has('stack')).toBe(true);
    });

    it('usedNames can exclude one id', () => {
      store.addNode('NODE'); // n1 / N1
      expect(store.usedNames('n1').has('n1')).toBe(false);
    });

    it('uniqueName returns the base when free, else a numbered variant', () => {
      expect(store.uniqueName('foo')).toBe('foo');
      store.addNode('NODE'); // label N1
      expect(store.uniqueName('N1')).toBe('N12');
    });
  });

  // ── Edges ─────────────────────────────────────────────────
  describe('edges', () => {
    it('connect creates a directed, weight-1 edge', () => {
      store.connect('n1-out', 'n2-in');
      expect(store.edges().length).toBe(1);
      const e = store.edges()[0];
      expect(e.outputId).toBe('n1-out');
      expect(e.inputId).toBe('n2-in');
      expect(e.weight).toBe(1);
      expect(e.directed).toBe(true);
    });

    it('connect ignores a null/undefined target', () => {
      store.connect('n1-out', null);
      store.connect('n1-out', undefined);
      expect(store.edges().length).toBe(0);
    });

    it('setEdgeDirected can make an edge bidirectional', () => {
      store.connect('n1-out', 'n2-in');
      const id = store.edges()[0].id;
      store.setEdgeDirected(id, false);
      expect(store.edges()[0].directed).toBe(false);
    });

    it('setEdgeWeight updates a valid weight and ignores NaN', () => {
      store.connect('n1-out', 'n2-in');
      const id = store.edges()[0].id;
      store.setEdgeWeight(id, 7);
      expect(store.edges()[0].weight).toBe(7);
      store.setEdgeWeight(id, Number.NaN);
      expect(store.edges()[0].weight).toBe(7);
    });

    it('deleteEdge / deleteEdges remove edges by id', () => {
      store.load({
        edges: [
          { id: 'e1', outputId: 'a', inputId: 'b', weight: 1, directed: true },
          { id: 'e2', outputId: 'b', inputId: 'c', weight: 1, directed: true },
          { id: 'e3', outputId: 'c', inputId: 'd', weight: 1, directed: true },
        ],
      });
      store.deleteEdge('e2');
      expect(store.edges().map((e) => e.id)).toEqual(['e1', 'e3']);
      store.deleteEdges(['e1', 'e3']);
      expect(store.edges().length).toBe(0);
    });
  });

  // ── Data-structure nodes ──────────────────────────────────
  describe('data nodes', () => {
    it('adds a data node with the kind default label', () => {
      store.addDataNode('QUEUE');
      expect(store.dataNodes().length).toBe(1);
      const d = store.dataNodes()[0];
      expect(d.id).toBe('ds1');
      expect(d.kind).toBe('QUEUE');
      expect(d.label).toBe('queue');
    });

    it('addDataNodeAt places it at the given position', () => {
      store.addDataNodeAt('LIST', { x: 5, y: 6 });
      expect(store.dataNodes()[0].position).toEqual({ x: 5, y: 6 });
    });

    it('deletes a data node by id', () => {
      store.addDataNode('SET');
      store.deleteDataNode('ds1');
      expect(store.dataNodes().length).toBe(0);
    });

    it('updateDataNode applies a change function', () => {
      store.addDataNode('LIST'); // ds1
      store.updateDataNode('ds1', (n) => ({ ...n, items: [1, 2, 3] }));
      expect(store.dataNodes()[0].items).toEqual([1, 2, 3]);
    });

    it('copyDataNode deep-copies items into a separate node', () => {
      store.addDataNode('LIST'); // ds1
      store.updateDataNode('ds1', (n) => ({ ...n, items: [9] }));
      store.copyDataNode('ds1');
      expect(store.dataNodes().length).toBe(2);
      const copy = store.dataNodes()[1];
      expect(copy.id).not.toBe('ds1');
      expect(copy.items).toEqual([9]);
      // Mutating the original must not touch the copy.
      store.updateDataNode('ds1', (n) => ({ ...n, items: [9, 10] }));
      expect(store.dataNodes()[1].items).toEqual([9]);
    });

    it('renames a data node', () => {
      store.addDataNode('MAP'); // ds1 / map
      store.renameNode('ds1', 'data', 'dist');
      expect(store.dataNodes()[0].label).toBe('dist');
    });
  });

  // ── Movement ──────────────────────────────────────────────
  it('moveNodes repositions matching vertices and data nodes', () => {
    store.addNode('NODE'); // n1
    store.addDataNode('STACK'); // ds1
    store.moveNodes([
      { id: 'n1', position: { x: 1, y: 2 } },
      { id: 'ds1', position: { x: 3, y: 4 } },
    ]);
    expect(store.nodes()[0].position).toEqual({ x: 1, y: 2 });
    expect(store.dataNodes()[0].position).toEqual({ x: 3, y: 4 });
  });

  // ── Summary ───────────────────────────────────────────────
  it('summary counts kinds and edge directedness', () => {
    store.addNode('START');
    store.addNode('GOAL');
    store.addNode('NODE');
    store.connect('a-out', 'b-in'); // directed
    const id = store.edges()[0].id;
    store.setEdgeDirected(id, false); // now undirected
    const s = store.summary();
    expect(s.starts).toBe(1);
    expect(s.goals).toBe(1);
    expect(s.plain).toBe(1);
    expect(s.directed).toBe(0);
    expect(s.undirected).toBe(1);
  });

  // ── Import / export ───────────────────────────────────────
  describe('snapshot / load', () => {
    it('snapshot reflects the current canvas', () => {
      store.addNode('NODE');
      store.addDataNode('LIST');
      const snap = store.snapshot();
      expect(snap.version).toBe(1);
      expect(snap.nodes.length).toBe(1);
      expect(snap.dataNodes.length).toBe(1);
      expect(snap.edges.length).toBe(0);
    });

    it('load bulk-sets nodes, edges and data nodes', () => {
      store.load({
        nodes: [{ id: 'n5', kind: 'NODE', label: 'X', position: { x: 0, y: 0 } }],
        edges: [{ id: 'e1', outputId: 'n5-o', inputId: 'n5-i', weight: 2, directed: true }],
        dataNodes: [],
      });
      expect(store.nodes().length).toBe(1);
      expect(store.edges().length).toBe(1);
    });

    it('load keeps the id counters ahead of imported ids', () => {
      store.load({ nodes: [{ id: 'n5', kind: 'NODE', label: 'X', position: { x: 0, y: 0 } }] });
      store.addNode('NODE');
      expect(store.nodes()[1].id).toBe('n6');
    });

    it('load ignores fields that are not arrays', () => {
      store.addNode('NODE');
      store.load({});
      // Nothing replaced — the existing vertex stays.
      expect(store.nodes().length).toBe(1);
    });
  });
});
