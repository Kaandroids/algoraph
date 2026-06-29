import { describe, it, expect } from 'vitest';
import {
  DATA_STRUCTURES,
  DATA_STRUCTURE_KINDS,
  DATA_PALETTE,
  makeDataNode,
  dataSize,
  formatDataItems,
  type DataStructureKind,
  type DataNode,
} from './data-structure.model';

const ALL_KINDS: DataStructureKind[] = ['LIST', 'STACK', 'QUEUE', 'SET', 'MAP', 'PQUEUE', 'MATRIX'];

describe('DATA_STRUCTURES registry', () => {
  it('declares exactly the seven kinds, in library order', () => {
    expect(DATA_STRUCTURE_KINDS).toEqual(ALL_KINDS);
  });

  it('gives every kind a complete descriptor', () => {
    for (const kind of ALL_KINDS) {
      const d = DATA_STRUCTURES[kind];
      expect(d.label, kind).toBeTruthy();
      expect(d.tag, kind).toBeTruthy();
      expect(d.sub, kind).toBeTruthy();
      expect(d.icon, kind).toBeTruthy();
      expect(d.description, kind).toBeTruthy();
      expect(d.defaultLabel, kind).toBeTruthy();
      // Colours come from the design system as oklch(...) strings, never hard-coded hex.
      expect(d.color, kind).toMatch(/^oklch\(/);
      expect(typeof d.size, kind).toBe('function');
    }
  });

  it('uses the expected tags and default labels', () => {
    expect(DATA_STRUCTURES.LIST.tag).toBe('Array');
    expect(DATA_STRUCTURES.LIST.defaultLabel).toBe('list');
    expect(DATA_STRUCTURES.PQUEUE.tag).toBe('Priority Q');
    expect(DATA_STRUCTURES.PQUEUE.defaultLabel).toBe('pq');
    expect(DATA_STRUCTURES.MATRIX.tag).toBe('Matrix');
    expect(DATA_STRUCTURES.MAP.defaultLabel).toBe('map');
    expect(DATA_STRUCTURES.SET.defaultLabel).toBe('set');
    expect(DATA_STRUCTURES.STACK.tag).toBe('Stack');
    expect(DATA_STRUCTURES.QUEUE.tag).toBe('Queue');
  });

  it('keys each descriptor under its own kind (no copy/paste mismatch)', () => {
    // The full descriptive label spells out the kind, so a quick sanity check.
    expect(DATA_STRUCTURES.MAP.label).toBe('Map');
    expect(DATA_STRUCTURES.SET.label).toBe('Set');
    expect(DATA_STRUCTURES.PQUEUE.label).toBe('Priority Queue');
    expect(DATA_STRUCTURES.MATRIX.label).toBe('2D Matrix');
  });
});

describe('DATA_PALETTE', () => {
  it('mirrors the registry, one entry per kind in order', () => {
    expect(DATA_PALETTE.map((p) => p.kind)).toEqual(ALL_KINDS);
  });

  it('carries the display metadata copied from each descriptor', () => {
    for (const item of DATA_PALETTE) {
      const d = DATA_STRUCTURES[item.kind];
      expect(item.label).toBe(d.label);
      expect(item.sub).toBe(d.sub);
      expect(item.icon).toBe(d.icon);
      expect(item.color).toBe(d.color);
      expect(item.description).toBe(d.description);
    }
  });
});

describe('makeDataNode', () => {
  it('builds an empty node with all backing fields initialised', () => {
    const node = makeDataNode('LIST', 'ds1', { x: 5, y: 6 });
    expect(node).toEqual({
      id: 'ds1',
      kind: 'LIST',
      label: 'list', // defaulted from the descriptor
      position: { x: 5, y: 6 },
      items: [],
      entries: [],
      heap: [],
      matrix: [],
    });
  });

  it('defaults the label to the descriptor default for each kind', () => {
    for (const kind of ALL_KINDS) {
      const node = makeDataNode(kind, 'id', { x: 0, y: 0 });
      expect(node.label, kind).toBe(DATA_STRUCTURES[kind].defaultLabel);
      expect(node.kind, kind).toBe(kind);
    }
  });

  it('uses an explicit label when one is given', () => {
    expect(makeDataNode('MAP', 'id', { x: 0, y: 0 }, 'dist').label).toBe('dist');
  });

  it('gives each node its own empty arrays (no shared mutable state)', () => {
    const a = makeDataNode('LIST', 'a', { x: 0, y: 0 });
    const b = makeDataNode('LIST', 'b', { x: 0, y: 0 });
    a.items.push(1);
    expect(b.items).toEqual([]);
  });
});

/** A DataNode with the field for `kind` populated and the rest left empty. */
function nodeWith(kind: DataStructureKind, fields: Partial<DataNode>): DataNode {
  return { ...makeDataNode(kind, 'id', { x: 0, y: 0 }), ...fields };
}

describe('dataSize', () => {
  it('counts items for the linear / set kinds', () => {
    for (const kind of ['LIST', 'STACK', 'QUEUE', 'SET'] as DataStructureKind[]) {
      expect(dataSize(nodeWith(kind, { items: [1, 2, 3] })), kind).toBe('3');
    }
  });

  it('counts map entries', () => {
    expect(dataSize(nodeWith('MAP', { entries: [{ key: 'a', value: 1 }] }))).toBe('1');
  });

  it('counts priority-queue heap entries', () => {
    expect(
      dataSize(
        nodeWith('PQUEUE', {
          heap: [
            { value: 'a', priority: 1 },
            { value: 'b', priority: 2 },
          ],
        }),
      ),
    ).toBe('2');
  });

  it('reports a matrix as rows × cols, or 0 when empty', () => {
    expect(
      dataSize(
        nodeWith('MATRIX', {
          matrix: [
            [1, 2, 3],
            [4, 5, 6],
          ],
        }),
      ),
    ).toBe('2×3');
    expect(dataSize(nodeWith('MATRIX', { matrix: [] }))).toBe('0');
  });

  it('reports 0 for a freshly made node of every kind', () => {
    for (const kind of ALL_KINDS) {
      expect(dataSize(makeDataNode(kind, 'id', { x: 0, y: 0 })), kind).toBe('0');
    }
  });
});

describe('formatDataItems', () => {
  it('wraps a set in braces and everything else in brackets', () => {
    expect(formatDataItems({ kind: 'SET', items: [1, 2, 3] })).toBe('{ 1, 2, 3 }');
    expect(formatDataItems({ kind: 'LIST', items: [1, 2, 3] })).toBe('[1, 2, 3]');
    expect(formatDataItems({ kind: 'QUEUE', items: ['a', 'b'] })).toBe('[a, b]');
  });

  it('handles empty contents', () => {
    expect(formatDataItems({ kind: 'LIST', items: [] })).toBe('[]');
    expect(formatDataItems({ kind: 'SET', items: [] })).toBe('{  }');
  });
});
