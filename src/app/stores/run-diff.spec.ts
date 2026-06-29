import { describe, it, expect } from 'vitest';
import { diffData, heapKey } from './run-diff';
import type { DataSnapshot } from '../lang/trace';
import type { DataStructureKind, HeapEntry, MapEntry } from '../models/data-structure.model';

/** Build a full DataSnapshot inline; callers override only the fields they care about. */
function snap(kind: DataStructureKind, over: Partial<DataSnapshot> = {}): DataSnapshot {
  return {
    id: 'ds1',
    kind,
    label: 'ds',
    x: 0,
    y: 0,
    rendered: true,
    items: [],
    entries: [],
    heap: [],
    matrix: [],
    ...over,
  };
}

describe('heapKey', () => {
  it('combines value and priority', () => {
    expect(heapKey({ value: 'A', priority: 3 })).toBe('A 3');
  });

  it('distinguishes equal values at different priorities', () => {
    const a: HeapEntry = { value: 'A', priority: 1 };
    const b: HeapEntry = { value: 'A', priority: 2 };
    expect(heapKey(a)).not.toBe(heapKey(b));
  });
});

describe('diffData', () => {
  it('flags a newly added sequence item (multiset: once when its count rises)', () => {
    const prev = snap('LIST', { items: ['A', 'B'] });
    const cur = snap('LIST', { items: ['A', 'B', 'C'] });
    const d = diffData(prev, cur);
    expect(d.values).toEqual(new Set(['C']));
    expect(d.changed).toBe(true);
  });

  it('flags a duplicate value only when its occurrence count increases', () => {
    // 'A' goes from one occurrence to two → flagged once. 'B' is unchanged.
    const prev = snap('LIST', { items: ['A', 'B'] });
    const cur = snap('LIST', { items: ['A', 'A', 'B'] });
    const d = diffData(prev, cur);
    expect(d.values).toEqual(new Set(['A']));
  });

  it('does not flag an item that was already present at the same count', () => {
    const prev = snap('QUEUE', { items: ['A', 'B', 'C'] });
    const cur = snap('QUEUE', { items: ['A', 'B', 'C'] });
    const d = diffData(prev, cur);
    expect(d.values.size).toBe(0);
    expect(d.changed).toBe(false);
  });

  it('coerces numeric items to display strings before comparing', () => {
    const prev = snap('LIST', { items: [1, 2] });
    const cur = snap('LIST', { items: [1, 2, 3] });
    const d = diffData(prev, cur);
    expect(d.values).toEqual(new Set(['3']));
  });

  it('flags a pure removal as changed (via size) but adds no values', () => {
    const prev = snap('STACK', { items: ['A', 'B', 'C'] });
    const cur = snap('STACK', { items: ['A', 'B'] });
    const d = diffData(prev, cur);
    expect(d.values.size).toBe(0);
    expect(d.changed).toBe(true);
  });

  it('flags an added MAP key in keys', () => {
    const prevEntries: MapEntry[] = [{ key: 'A', value: 0 }];
    const curEntries: MapEntry[] = [
      { key: 'A', value: 0 },
      { key: 'B', value: 5 },
    ];
    const prev = snap('MAP', { entries: prevEntries });
    const cur = snap('MAP', { entries: curEntries });
    const d = diffData(prev, cur);
    expect(d.keys).toEqual(new Set(['B']));
    expect(d.changed).toBe(true);
  });

  it('flags a MAP key whose value changed', () => {
    const prev = snap('MAP', { entries: [{ key: 'A', value: 7 }] });
    const cur = snap('MAP', { entries: [{ key: 'A', value: 3 }] });
    const d = diffData(prev, cur);
    expect(d.keys).toEqual(new Set(['A']));
    expect(d.changed).toBe(true);
  });

  it('does not flag a MAP key whose value is unchanged', () => {
    const entries: MapEntry[] = [
      { key: 'A', value: 1 },
      { key: 'B', value: 2 },
    ];
    const prev = snap('MAP', { entries });
    const cur = snap('MAP', { entries: [...entries] });
    const d = diffData(prev, cur);
    expect(d.keys.size).toBe(0);
    expect(d.changed).toBe(false);
  });

  it('keys PQUEUE entries by value+priority', () => {
    // Same value 'A' but a new priority counts as a newly added entry.
    const prev = snap('PQUEUE', { heap: [{ value: 'A', priority: 1 }] });
    const cur = snap('PQUEUE', {
      heap: [
        { value: 'A', priority: 1 },
        { value: 'A', priority: 2 },
      ],
    });
    const d = diffData(prev, cur);
    expect(d.values).toEqual(new Set(['A 2']));
    expect(d.changed).toBe(true);
  });

  it('does not flag an unchanged PQUEUE', () => {
    const heap: HeapEntry[] = [
      { value: 'A', priority: 1 },
      { value: 'B', priority: 2 },
    ];
    const prev = snap('PQUEUE', { heap });
    const cur = snap('PQUEUE', { heap: [...heap] });
    const d = diffData(prev, cur);
    expect(d.values.size).toBe(0);
    expect(d.changed).toBe(false);
  });

  it('detects changed MATRIX rows by index', () => {
    const prev = snap('MATRIX', {
      matrix: [
        [1, 2],
        [3, 4],
      ],
    });
    const cur = snap('MATRIX', {
      matrix: [
        [1, 2],
        [3, 9],
      ],
    });
    const d = diffData(prev, cur);
    expect(d.rows).toEqual(new Set([1]));
    expect(d.changed).toBe(true);
  });

  it('detects a newly added MATRIX row', () => {
    const prev = snap('MATRIX', { matrix: [[1, 2]] });
    const cur = snap('MATRIX', {
      matrix: [
        [1, 2],
        [3, 4],
      ],
    });
    const d = diffData(prev, cur);
    expect(d.rows).toEqual(new Set([1]));
    expect(d.changed).toBe(true);
  });

  it('flags a brand-new structure (prev=undefined) as changed', () => {
    const cur = snap('SET', { items: ['A'] });
    const d = diffData(undefined, cur);
    expect(d.changed).toBe(true);
    // Against an empty baseline, every current value is "new".
    expect(d.values).toEqual(new Set(['A']));
  });

  it('flags an empty brand-new structure as changed even with no contents', () => {
    const d = diffData(undefined, snap('LIST'));
    expect(d.changed).toBe(true);
    expect(d.values.size).toBe(0);
    expect(d.keys.size).toBe(0);
    expect(d.rows.size).toBe(0);
  });

  it('yields an empty diff and changed=false for identical snapshots', () => {
    const prev = snap('MAP', {
      entries: [{ key: 'A', value: 1 }],
      items: ['x'],
    });
    const cur = snap('MAP', {
      entries: [{ key: 'A', value: 1 }],
      items: ['x'],
    });
    const d = diffData(prev, cur);
    expect(d.values.size).toBe(0);
    expect(d.keys.size).toBe(0);
    expect(d.rows.size).toBe(0);
    expect(d.changed).toBe(false);
  });
});
