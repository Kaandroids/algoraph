import { describe, it, expect } from 'vitest';
import {
  Vertex,
  Edge,
  RangeValue,
  Namespace,
  RuntimeError,
  GraphValue,
  RList,
  RSet,
  RMap,
  RPQueue,
  RMatrix,
  keyOf,
  display,
  makeRuntimeDS,
  makeRuntimeDSByKind,
} from './values';
import { makeDataNode } from '../models/data-structure.model';

/** A charge accumulator so tests can assert the operation count an op adds. */
function makeCharge() {
  let total = 0;
  const charge = (units: number) => {
    total += units;
  };
  return { charge, total: () => total };
}

const noopCharge = () => {};

const A = new Vertex('n1', 'A', 'NODE', 0, 0);
const B = new Vertex('n2', 'B', 'NODE', 10, 0);

describe('keyOf', () => {
  it('keys a vertex by its node id', () => {
    expect(keyOf(A)).toBe('v:n1');
    // Identity is the id, not the label — two vertices with the same id collide.
    expect(keyOf(new Vertex('n1', 'different-label', 'NODE', 99, 99))).toBe('v:n1');
  });

  it('keys an edge by its endpoint ids', () => {
    expect(keyOf(new Edge(A, B, 3, true))).toBe('e:n1->n2');
  });

  it('keys primitives by tagged value', () => {
    expect(keyOf(7)).toBe('n:7');
    expect(keyOf('hi')).toBe('s:hi');
    expect(keyOf(true)).toBe('b:true');
    expect(keyOf(false)).toBe('b:false');
    expect(keyOf(null)).toBe('nil');
  });

  it('distinguishes a number from a string with the same text', () => {
    expect(keyOf(7)).not.toBe(keyOf('7'));
  });

  it('falls back to a stringified object key for other values', () => {
    expect(keyOf([1, 2])).toBe('o:1,2');
  });
});

describe('display', () => {
  it('shows a vertex by its label', () => {
    expect(display(A)).toBe('A');
  });

  it('shows a directed edge with an arrow and an undirected edge with a dash', () => {
    expect(display(new Edge(A, B, 1, true))).toBe('A → B');
    expect(display(new Edge(A, B, 1, false))).toBe('A — B');
  });

  it('renders infinities with the math symbol', () => {
    expect(display(Infinity)).toBe('∞');
    expect(display(-Infinity)).toBe('-∞');
  });

  it('renders null as nil', () => {
    expect(display(null)).toBe('nil');
  });

  it('passes numbers and strings through unchanged (and keeps the number type)', () => {
    expect(display(42)).toBe(42);
    expect(display('hello')).toBe('hello');
  });

  it('stringifies booleans', () => {
    expect(display(true)).toBe('true');
    expect(display(false)).toBe('false');
  });

  it('renders arrays recursively, mapping each element through display', () => {
    expect(display([1, 'x', null])).toBe('[1, x, nil]');
    expect(display([A, B])).toBe('[A, B]');
    expect(display([[1, 2], [3]])).toBe('[[1, 2], [3]]');
    expect(display([])).toBe('[]');
  });
});

describe('value wrappers', () => {
  it('Vertex keeps its constructor fields', () => {
    const v = new Vertex('n5', 'E', 'GOAL', 1, 2);
    expect([v.id, v.label, v.type, v.x, v.y]).toEqual(['n5', 'E', 'GOAL', 1, 2]);
  });

  it('Edge keeps endpoints, weight and direction', () => {
    const e = new Edge(A, B, 4, false);
    expect(e.startVertex).toBe(A);
    expect(e.endVertex).toBe(B);
    expect(e.weight).toBe(4);
    expect(e.isDirected).toBe(false);
  });

  it('RangeValue and Namespace keep their fields', () => {
    const r = new RangeValue(1, 5);
    expect([r.from, r.to]).toEqual([1, 5]);
    expect(new Namespace('graph').name).toBe('graph');
  });
});

describe('RList (LIST / STACK / QUEUE)', () => {
  function list(kind: 'LIST' | 'STACK' | 'QUEUE' = 'LIST', charge = noopCharge) {
    return new RList('l1', 'xs', kind, charge, 0, 0);
  }

  it('reports its kind and is rank-1 indexable', () => {
    expect(list('STACK').kind).toBe('STACK');
    expect(list().rank).toBe(1);
  });

  it('push / pop behave like a stack on the back', () => {
    const l = list();
    expect(l.call('push', [1], 1)).toBeNull();
    l.call('push', [2], 1);
    expect(l.call('pop', [], 1)).toBe(2);
    expect(l.call('pop', [], 1)).toBe(1);
    expect(l.call('pop', [], 1)).toBeNull(); // empty pops are nil, not undefined
  });

  it('peek reads the top without removing it', () => {
    const l = list('STACK');
    l.call('push', [10], 1);
    l.call('push', [20], 1);
    expect(l.call('peek', [], 1)).toBe(20);
    expect(l.call('size', [], 1)).toBe(2);
  });

  it('enqueue / dequeue / front behave like a FIFO queue', () => {
    const l = list('QUEUE');
    l.call('enqueue', ['a'], 1);
    l.call('enqueue', ['b'], 1);
    expect(l.call('front', [], 1)).toBe('a');
    expect(l.call('dequeue', [], 1)).toBe('a');
    expect(l.call('dequeue', [], 1)).toBe('b');
    expect(l.call('dequeue', [], 1)).toBeNull();
  });

  it('insert and removeAt shift elements at a position', () => {
    const l = list();
    l.call('push', [1], 1);
    l.call('push', [3], 1);
    l.call('insert', [1, 2], 1); // insert 2 at index 1 → [1,2,3]
    expect(l.elements()).toEqual([1, 2, 3]);
    l.call('removeAt', [0], 1); // → [2,3]
    expect(l.elements()).toEqual([2, 3]);
  });

  it('contains and indexOf use value identity', () => {
    const l = list();
    l.call('push', [5], 1);
    l.call('push', ['k'], 1);
    expect(l.call('contains', [5], 1)).toBe(true);
    expect(l.call('contains', [9], 1)).toBe(false);
    expect(l.call('indexOf', ['k'], 1)).toBe(1);
    expect(l.call('indexOf', [99], 1)).toBe(-1);
  });

  it('get / set and subscript access read and write by index, out of range reads nil', () => {
    const l = list();
    l.call('push', [1], 1);
    l.call('push', [2], 1);
    expect(l.get(0)).toBe(1);
    expect(l.subscriptGet([1])).toBe(2);
    expect(l.get(9)).toBeNull();
    l.set(0, 100);
    l.subscriptSet([1], 200);
    expect(l.elements()).toEqual([100, 200]);
  });

  it('size / isEmpty / clear are shared bookkeeping', () => {
    const l = list();
    expect(l.call('isEmpty', [], 1)).toBe(true);
    l.call('push', [1], 1);
    l.call('push', [2], 1);
    expect(l.call('size', [], 1)).toBe(2);
    expect(l.call('isEmpty', [], 1)).toBe(false);
    expect(l.call('clear', [], 1)).toBeNull();
    expect(l.call('size', [], 1)).toBe(0);
  });

  it('snapshot displays items and leaves the other views empty', () => {
    const l = list('LIST');
    l.call('push', [1], 1);
    l.call('push', [null], 1);
    l.call('push', [A], 1);
    const snap = l.snapshot();
    expect(snap.items).toEqual([1, 'nil', 'A']);
    expect(snap.entries).toEqual([]);
    expect(snap.heap).toEqual([]);
    expect(snap.matrix).toEqual([]);
    expect(snap.id).toBe('l1');
    expect(snap.kind).toBe('LIST');
    expect(snap.label).toBe('xs');
    expect(snap.rendered).toBe(true);
  });

  it('charges one unit for push / pop / get / set', () => {
    const c = makeCharge();
    const l = new RList('l1', 'xs', 'LIST', c.charge, 0, 0);
    l.call('push', [1], 1); // +1
    l.call('pop', [], 1); // +1
    expect(c.total()).toBe(2);
  });

  it('clear charges the element count it discards', () => {
    const c = makeCharge();
    const l = new RList('l1', 'xs', 'LIST', c.charge, 0, 0);
    l.call('push', [1], 1); // +1
    l.call('push', [2], 1); // +1
    l.call('push', [3], 1); // +1
    l.call('clear', [], 1); // +3 (count)
    expect(c.total()).toBe(6);
  });

  it('throws a RuntimeError for an unknown method', () => {
    expect(() => list().call('frobnicate', [], 7)).toThrow(RuntimeError);
    expect(() => list().call('frobnicate', [], 7)).toThrow(/no method 'frobnicate'/);
  });
});

describe('RSet', () => {
  function set(charge = noopCharge) {
    return new RSet('s1', 'visited', 'SET', charge, 0, 0);
  }

  it('add stores unique members keyed by value', () => {
    const s = set();
    s.call('add', [1], 1);
    s.call('add', [1], 1); // duplicate — no growth
    s.call('add', [2], 1);
    expect(s.call('size', [], 1)).toBe(2);
  });

  it('treats two vertices with the same id as the same member', () => {
    const s = set();
    s.call('add', [A], 1);
    s.call('add', [new Vertex('n1', 'A-again', 'NODE', 5, 5)], 1);
    expect(s.call('size', [], 1)).toBe(1);
    expect(s.contains(A)).toBe(true);
  });

  it('remove and contains work by value identity', () => {
    const s = set();
    s.call('add', ['x'], 1);
    expect(s.call('contains', ['x'], 1)).toBe(true);
    s.call('remove', ['x'], 1);
    expect(s.call('contains', ['x'], 1)).toBe(false);
  });

  it('elements and snapshot reflect inserted values, in insertion order', () => {
    const s = set();
    s.call('add', [A], 1);
    s.call('add', [3], 1);
    expect(s.elements()).toEqual([A, 3]);
    const snap = s.snapshot();
    expect(snap.items).toEqual(['A', 3]);
    expect(snap.entries).toEqual([]);
    expect(snap.kind).toBe('SET');
  });

  it('cannot be indexed (rank 0)', () => {
    expect(set().rank).toBe(0);
    expect(() => set().subscriptGet([0], 4)).toThrow(RuntimeError);
  });
});

describe('RMap', () => {
  function map(charge = noopCharge) {
    return new RMap('m1', 'dist', 'MAP', charge, 0, 0);
  }

  it('is rank-1 indexable; get/set read and write by key', () => {
    const m = map();
    expect(m.rank).toBe(1);
    m.set('a', 1);
    expect(m.get('a')).toBe(1);
    expect(m.subscriptGet(['a'])).toBe(1);
    m.subscriptSet(['a'], 2); // overwrite same key
    expect(m.get('a')).toBe(2);
    expect(m.get('missing')).toBeNull(); // absent key reads nil
  });

  it('uses value identity for keys (a vertex keys by its id)', () => {
    const m = map();
    m.set(A, 5);
    expect(m.get(new Vertex('n1', 'whatever', 'NODE', 1, 1))).toBe(5);
  });

  it('keys() and values() return the stored pairs', () => {
    const m = map();
    m.set('a', 1);
    m.set('b', 2);
    expect(m.call('keys', [], 1)).toEqual(['a', 'b']);
    expect(m.call('values', [], 1)).toEqual([1, 2]);
    expect(m.call('size', [], 1)).toBe(2);
  });

  it('remove deletes a key and contains tests key membership', () => {
    const m = map();
    m.set('a', 1);
    expect(m.contains('a')).toBe(true);
    m.call('remove', ['a'], 1);
    expect(m.contains('a')).toBe(false);
  });

  it('elements yields the keys', () => {
    const m = map();
    m.set('a', 1);
    m.set('b', 2);
    expect(m.elements()).toEqual(['a', 'b']);
  });

  it('snapshot renders key→value entries (key stringified, value displayed)', () => {
    const m = map();
    m.set(5, 10);
    m.set(A, Infinity);
    const snap = m.snapshot();
    expect(snap.entries).toEqual([
      { key: '5', value: 10 },
      { key: 'A', value: '∞' },
    ]);
    expect(snap.items).toEqual([]);
    expect(snap.kind).toBe('MAP');
  });
});

describe('RPQueue (min-heap)', () => {
  function pq(charge = noopCharge) {
    return new RPQueue('p1', 'pq', 'PQUEUE', charge, 0, 0);
  }

  it('popMin / peekMin return the lowest-priority item regardless of insertion order', () => {
    const p = pq();
    p.call('push', ['C', 3], 1);
    p.call('push', ['A', 1], 1);
    p.call('push', ['B', 2], 1);
    expect(p.elements()).toEqual(['A', 'B', 'C']); // kept sorted ascending
    expect(p.call('peekMin', [], 1)).toBe('A');
    expect(p.call('popMin', [], 1)).toBe('A');
    expect(p.call('popMin', [], 1)).toBe('B');
    expect(p.call('popMin', [], 1)).toBe('C');
    expect(p.call('popMin', [], 1)).toBeNull();
  });

  it('decreaseKey re-prioritises an item and re-sorts the heap', () => {
    const p = pq();
    p.call('push', ['A', 1], 1);
    p.call('push', ['B', 2], 1);
    p.call('push', ['C', 3], 1);
    p.call('decreaseKey', ['C', 0], 1); // C jumps to the front
    expect(p.elements()).toEqual(['C', 'A', 'B']);
    expect(p.call('popMin', [], 1)).toBe('C');
  });

  it('contains tests item membership', () => {
    const p = pq();
    p.call('push', ['A', 1], 1);
    expect(p.contains('A')).toBe(true);
    expect(p.contains('Z')).toBe(false);
  });

  it('snapshot renders heap entries with priorities', () => {
    const p = pq();
    p.call('push', ['A', 5], 1);
    p.call('push', ['B', 2], 1);
    const snap = p.snapshot();
    expect(snap.heap).toEqual([
      { value: 'B', priority: 2 },
      { value: 'A', priority: 5 },
    ]);
    expect(snap.items).toEqual([]);
    expect(snap.kind).toBe('PQUEUE');
  });

  it('size / isEmpty / clear work', () => {
    const p = pq();
    expect(p.call('isEmpty', [], 1)).toBe(true);
    p.call('push', ['A', 1], 1);
    expect(p.call('size', [], 1)).toBe(1);
    p.call('clear', [], 1);
    expect(p.call('isEmpty', [], 1)).toBe(true);
  });
});

describe('RMatrix', () => {
  function matrix(grid: number[][], charge = noopCharge) {
    return new RMatrix('mx1', 'M', charge, 0, 0, grid);
  }

  it('reports its dimensions and is rank-2 indexable', () => {
    const m = matrix([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(m.kind).toBe('MATRIX');
    expect(m.rank).toBe(2);
    expect(m.call('rows', [], 1)).toBe(2);
    expect(m.call('cols', [], 1)).toBe(3);
  });

  it('get / set and subscript access read and write by [i][j]', () => {
    const m = matrix([
      [1, 2],
      [3, 4],
    ]);
    expect(m.get(0, 1)).toBe(2);
    expect(m.subscriptGet([1, 0], 1)).toBe(3);
    m.set(0, 0, 9);
    m.subscriptSet([1, 1], 8, 1);
    expect(m.snapshot().matrix).toEqual([
      [9, 2],
      [3, 8],
    ]);
  });

  it('reads out-of-bounds cells as 0 and ignores out-of-bounds writes', () => {
    const m = matrix([[1, 2]]);
    expect(m.get(5, 5)).toBe(0);
    m.set(5, 5, 99); // no row 5 — silently ignored
    expect(m.snapshot().matrix).toEqual([[1, 2]]);
  });

  it('fill overwrites every cell', () => {
    const m = matrix([
      [1, 2],
      [3, 4],
    ]);
    m.call('fill', [0], 1);
    expect(m.snapshot().matrix).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });

  it('rejects subscripting with the wrong number of indices', () => {
    const m = matrix([[1]]);
    expect(() => m.subscriptGet([0], 9)).toThrow(RuntimeError);
    expect(() => m.subscriptSet([0], 1, 9)).toThrow(/M\[i\]\[j\]/);
  });

  it('snapshot returns a deep copy of the grid, not the live rows', () => {
    const m = matrix([[1, 2]]);
    const snap = m.snapshot();
    snap.matrix[0][0] = 999;
    expect(m.get(0, 0)).toBe(1); // mutation of the snapshot did not leak back
  });

  it('is not a membership container', () => {
    expect(matrix([[1]]).contains()).toBe(false);
  });
});

describe('makeRuntimeDSByKind', () => {
  it('builds the right concrete class per kind', () => {
    const at = (kind: Parameters<typeof makeRuntimeDSByKind>[0]) =>
      makeRuntimeDSByKind(kind, 'id', 'lbl', 0, 0, noopCharge);
    expect(at('SET')).toBeInstanceOf(RSet);
    expect(at('MAP')).toBeInstanceOf(RMap);
    expect(at('PQUEUE')).toBeInstanceOf(RPQueue);
    expect(at('MATRIX')).toBeInstanceOf(RMatrix);
    expect(at('LIST')).toBeInstanceOf(RList);
    expect(at('STACK')).toBeInstanceOf(RList);
    expect(at('QUEUE')).toBeInstanceOf(RList);
  });

  it('preserves the linear kind on the RList instances', () => {
    expect(makeRuntimeDSByKind('STACK', 'id', 'lbl', 0, 0, noopCharge).kind).toBe('STACK');
    expect(makeRuntimeDSByKind('QUEUE', 'id', 'lbl', 0, 0, noopCharge).kind).toBe('QUEUE');
  });

  it('sizes a fresh matrix to rows × cols, all zero', () => {
    const m = makeRuntimeDSByKind('MATRIX', 'id', 'M', 0, 0, noopCharge, 2, 3) as RMatrix;
    expect(m.call('rows', [], 1)).toBe(2);
    expect(m.call('cols', [], 1)).toBe(3);
    expect(m.get(0, 0)).toBe(0);
  });

  it('honours the rendered / tracked flags and id / label / position', () => {
    const ds = makeRuntimeDSByKind('SET', 'sid', 'mySet', 7, 8, noopCharge, 1, 1, false, false);
    expect(ds.id).toBe('sid');
    expect(ds.label).toBe('mySet');
    expect(ds.x).toBe(7);
    expect(ds.y).toBe(8);
    expect(ds.rendered).toBe(false);
    expect(ds.tracked).toBe(false);
    expect(ds.snapshot().rendered).toBe(false);
  });
});

describe('makeRuntimeDS (from a canvas DataNode)', () => {
  it('builds an empty runtime structure positioned at the node', () => {
    const node = makeDataNode('LIST', 'ds1', { x: 12, y: 34 }, 'xs');
    const ds = makeRuntimeDS(node, noopCharge);
    expect(ds).toBeInstanceOf(RList);
    expect(ds.id).toBe('ds1');
    expect(ds.label).toBe('xs');
    expect(ds.x).toBe(12);
    expect(ds.y).toBe(34);
    expect(ds.call('size', [], 1)).toBe(0);
  });

  it('defaults an empty matrix node to a 1×1 grid', () => {
    const node = makeDataNode('MATRIX', 'ds2', { x: 0, y: 0 }, 'M');
    const m = makeRuntimeDS(node, noopCharge) as RMatrix;
    expect(m).toBeInstanceOf(RMatrix);
    expect(m.call('rows', [], 1)).toBe(1);
    expect(m.call('cols', [], 1)).toBe(1);
  });
});

describe('GraphValue', () => {
  // n1(A,START) → n2(B), n2(B) — n3(C,GOAL) undirected.
  function graph(charge = noopCharge) {
    return new GraphValue(
      {
        vertices: [
          { id: 'n1', label: 'A', type: 'START', x: 0, y: 0 },
          { id: 'n2', label: 'B', type: 'NODE', x: 10, y: 0 },
          { id: 'n3', label: 'C', type: 'GOAL', x: 20, y: 0 },
        ],
        edges: [
          { src: 'n1', tgt: 'n2', weight: 5, directed: true },
          { src: 'n2', tgt: 'n3', weight: 2, directed: false },
        ],
      },
      charge,
    );
  }
  const byId = (g: GraphValue, id: string) => g.nodes().find((v) => v.id === id)!;

  it('nodes() returns every vertex as a Vertex value', () => {
    const g = graph();
    const ns = g.nodes();
    expect(ns).toHaveLength(3);
    expect(ns.every((v) => v instanceof Vertex)).toBe(true);
    expect(ns.map((v) => v.label)).toEqual(['A', 'B', 'C']);
  });

  it('edges() returns Edge values for every stored edge', () => {
    const es = graph().edges();
    expect(es).toHaveLength(2);
    expect(es[0]).toBeInstanceOf(Edge);
    expect(es[0].weight).toBe(5);
    expect(es[1].isDirected).toBe(false);
  });

  it('neighbors follow direction; undirected edges go both ways', () => {
    const g = graph();
    const [a, b, c] = [byId(g, 'n1'), byId(g, 'n2'), byId(g, 'n3')];
    expect(g.neighbors(a).map((v) => v.id)).toEqual(['n2']);
    expect(g.neighbors(b).map((v) => v.id)).toEqual(['n3']);
    expect(g.neighbors(c).map((v) => v.id)).toEqual(['n2']);
  });

  it('weight respects direction (Infinity when no edge that way)', () => {
    const g = graph();
    const [a, b, c] = [byId(g, 'n1'), byId(g, 'n2'), byId(g, 'n3')];
    expect(g.weight(a, b)).toBe(5);
    expect(g.weight(b, a)).toBe(Infinity); // directed n1→n2 only
    expect(g.weight(b, c)).toBe(2);
    expect(g.weight(c, b)).toBe(2); // undirected
  });

  it('hasEdge and degree match the adjacency', () => {
    const g = graph();
    const [a, b] = [byId(g, 'n1'), byId(g, 'n2')];
    expect(g.hasEdge(a, b)).toBe(true);
    expect(g.hasEdge(b, a)).toBe(false);
    expect(g.degree(a)).toBe(1);
  });

  it('source() and goal() find the START / GOAL vertices', () => {
    const g = graph();
    expect(g.source()?.label).toBe('A');
    expect(g.goal()?.label).toBe('C');
  });

  it('createNode adds a vertex with a unique label', () => {
    const g = graph();
    const created = g.createNode(50, 60, 'A'); // 'A' already taken → deduped
    expect(created.label).toBe('A2');
    expect(g.nodes()).toHaveLength(4);
  });

  it('createEdge then hasEdge reflects the new edge', () => {
    const g = graph();
    const [a, c] = [byId(g, 'n1'), byId(g, 'n3')];
    expect(g.hasEdge(a, c)).toBe(false);
    g.createEdge(a, c, 9, true);
    expect(g.hasEdge(a, c)).toBe(true);
    expect(g.weight(a, c)).toBe(9);
  });

  it('snapshot is cached between non-mutating reads and rebuilt after a mutation', () => {
    const g = graph();
    const s1 = g.snapshot();
    expect(g.snapshot()).toBe(s1); // same reference — not dirty
    g.createNode(0, 0);
    expect(g.snapshot()).not.toBe(s1); // mutation invalidated the cache
    expect(g.snapshot().nodes).toHaveLength(4);
  });
});
