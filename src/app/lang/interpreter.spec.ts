import { describe, it, expect } from 'vitest';
import { compileAndRun } from './run';
import { MAIN_SRC, HELPERS_SRC } from '../models/algo-file.model';
import { makeDataNode } from '../models/data-structure.model';
import type { DataSnapshot } from './trace';

const files = [
  { id: 'main', name: 'main.algo', content: MAIN_SRC },
  { id: 'helpers', name: 'helpers.algo', content: HELPERS_SRC },
];

// A → B(4), A → C(2), C → B(1), B → D(5), C → D(8), D → E(3).
const graph = {
  vertices: [
    { id: 'A', label: 'A', type: 'START' },
    { id: 'B', label: 'B', type: 'NODE' },
    { id: 'C', label: 'C', type: 'NODE' },
    { id: 'D', label: 'D', type: 'NODE' },
    { id: 'E', label: 'E', type: 'GOAL' },
  ],
  edges: [
    { src: 'A', tgt: 'B', weight: 4, directed: true },
    { src: 'A', tgt: 'C', weight: 2, directed: true },
    { src: 'C', tgt: 'B', weight: 1, directed: true },
    { src: 'B', tgt: 'D', weight: 5, directed: true },
    { src: 'C', tgt: 'D', weight: 8, directed: true },
    { src: 'D', tgt: 'E', weight: 3, directed: true },
  ],
};

const data = [
  makeDataNode('SET', 'ds-visited', { x: 0, y: 0 }, 'visited'),
  makeDataNode('MAP', 'ds-dist', { x: 0, y: 0 }, 'dist'),
  makeDataNode('PQUEUE', 'ds-pq', { x: 0, y: 0 }, 'pq'),
];

function run() {
  return compileAndRun(files, { entryId: 'main', graph, data });
}

function snapshotOf(steps: { data: DataSnapshot[] }, label: string): DataSnapshot {
  return steps.data.find((d) => d.label === label)!;
}

describe('interpreter (Dijkstra seed)', () => {
  it('runs without error and produces a trace', () => {
    const result = run();
    expect(result.error).toBeNull();
    expect(result.steps.length).toBeGreaterThan(10);
    expect(result.steps[0].line).toBe(2); // line 1 is a comment
  });

  it('computes the correct shortest-path distances', () => {
    const last = run().steps.at(-1)!;
    const dist = snapshotOf(last, 'dist');
    const map = Object.fromEntries(dist.entries.map((e) => [e.key, e.value]));
    expect(map).toEqual({ A: 0, B: 3, C: 2, D: 8, E: 11 });
  });

  it('settles every reachable vertex into the visited set', () => {
    const last = run().steps.at(-1)!;
    const visited = snapshotOf(last, 'visited');
    expect([...visited.items].sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('empties the priority queue and counts operations', () => {
    const last = run().steps.at(-1)!;
    expect(snapshotOf(last, 'pq').heap).toEqual([]);
    expect(last.ops).toBeGreaterThan(0);
  });

  it('steps over the relax call (helper lines never become steps)', () => {
    const result = run();
    // Every step belongs to the entry file and a line that exists in main.
    const mainLineCount = MAIN_SRC.split('\n').length;
    for (const step of result.steps) {
      expect(step.fileId).toBe('main');
      expect(step.line).toBeLessThanOrEqual(mainLineCount);
    }
  });

  it('supports graph.* and canvas.* namespaced builtins', () => {
    const src = 'for each u in graph.nodes() do\n  canvas.visit(u)\nend\n';
    const result = compileAndRun([{ id: 'main', name: 'main.algo', content: src }], {
      entryId: 'main',
      graph,
      data: [],
    });
    expect(result.error).toBeNull();
    expect(result.steps.at(-1)!.effects.visited.sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('reads zero-argument graph accessors as bare properties (no parens)', () => {
    const src = 'for each node in graph.nodes do\n  canvas.scrollTo(node)\nend\n';
    const result = compileAndRun([{ id: 'main', name: 'main.algo', content: src }], {
      entryId: 'main',
      graph,
      data: [],
    });
    expect(result.error).toBeNull();
    // Each iteration pans to its vertex (the loop auto-follows, plus the explicit
    // scrollTo — same target, so collapse consecutive duplicates).
    const panned = result.steps
      .map((s) => s.effects.scrollTo)
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .map((t) => (t.kind === 'node' ? t.id : `${t.from}->${t.to}`));
    const distinct = panned.filter((v, i) => v !== panned[i - 1]);
    expect(distinct).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('exposes the active loop frame — items and a walking index', () => {
    const src = 'for each u in graph.nodes() do\n  visit(u)\nend\n';
    const result = compileAndRun([{ id: 'main', name: 'main.algo', content: src }], {
      entryId: 'main',
      graph,
      data: [],
    });
    expect(result.error).toBeNull();
    const frame = result.steps.map((s) => s.loop).find(Boolean)!;
    expect(frame.varName).toBe('u');
    expect(frame.items).toEqual(['A', 'B', 'C', 'D', 'E']); // vertex labels, in order
    expect(frame.dsId).toBeNull(); // graph.nodes() isn't a placed data structure
    // The index advances 0..4 across the for-each line's steps (the 'start' frame
    // sits on the same line but before any loop is pushed, so skip null frames).
    const indices = result.steps.filter((s) => s.line === 1 && s.loop).map((s) => s.loop!.index);
    expect(indices).toEqual([0, 1, 2, 3, 4]);
    expect(result.steps.at(-1)!.loop).toBeNull(); // no frame once the loop is done
  });

  it('reports the data-structure id when a loop iterates one', () => {
    const list = makeDataNode('LIST', 'ds-list', { x: 0, y: 0 }, 'bag');
    const src =
      'bag.push(source())\n' +
      'bag.push(goal())\n' +
      'for each x in bag do\n' +
      '  visit(x)\n' +
      'end\n';
    const result = compileAndRun([{ id: 'main', name: 'main.algo', content: src }], {
      entryId: 'main',
      graph,
      data: [list],
    });
    expect(result.error).toBeNull();
    const frame = result.steps.map((s) => s.loop).find(Boolean)!;
    expect(frame.dsId).toBe('ds-list');
    expect(frame.items).toEqual(['A', 'E']); // source = A, goal = E
  });

  it('marks and scrolls to edges via the two-argument overloads', () => {
    const src =
      'a ← source()\n' +
      'for each b in neighbors(a) do\n' +
      '  mark(a, b)\n' +
      '  scrollTo(a, b)\n' +
      'end\n';
    const result = compileAndRun([{ id: 'main', name: 'main.algo', content: src }], {
      entryId: 'main',
      graph,
      data: [],
    });
    expect(result.error).toBeNull();
    // A → B and A → C are the Start vertex's out-edges.
    expect([...result.steps.at(-1)!.effects.markedEdges].sort()).toEqual(['A->B', 'A->C']);
    const edgePans = result.steps.map((s) => s.effects.scrollTo).filter((t) => t?.kind === 'edge');
    expect(edgePans).toContainEqual({ kind: 'edge', from: 'A', to: 'B' });
  });

  it('auto-highlights the current loop vertex as an iteration cursor', () => {
    const src = 'for each u in graph.nodes() do\n  visit(u)\nend\n';
    const result = compileAndRun([{ id: 'main', name: 'main.algo', content: src }], {
      entryId: 'main',
      graph,
      data: [],
    });
    expect(result.error).toBeNull();
    // Every vertex is the cursor on the step that iterates it.
    const seen = new Set(result.steps.flatMap((s) => s.effects.cursors));
    expect([...seen].sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
    // Each in-loop step carries exactly one cursor; the cursor clears once the loop ends.
    expect(result.steps.every((s) => s.effects.cursors.length <= 1)).toBe(true);
    expect(result.steps.at(-1)!.effects.cursors).toEqual([]);
  });

  it('rings each level of nested loops at once', () => {
    const src =
      'for each u in graph.nodes() do\n' +
      '  for each v in neighbors(u) do\n' +
      '    markEdge(u, v)\n' +
      '  end\n' +
      'end\n';
    const result = compileAndRun([{ id: 'main', name: 'main.algo', content: src }], {
      entryId: 'main',
      graph,
      data: [],
    });
    expect(result.error).toBeNull();
    const nested = result.steps.find((s) => s.effects.cursors.length === 2);
    expect(nested).toBeDefined();
    // Outer A iterates first; its first out-neighbour is B.
    expect(nested!.effects.cursors.sort()).toEqual(['A', 'B']);
  });

  it('clearMarks() wipes every highlight and label', () => {
    const src =
      'a ← source()\n' +
      'visit(a)\n' +
      'mark(a)\n' +
      'setLabel(a, "x")\n' +
      'for each b in neighbors(a) do\n' +
      '  mark(a, b)\n' +
      'end\n' +
      'clearMarks()\n';
    const result = compileAndRun([{ id: 'main', name: 'main.algo', content: src }], {
      entryId: 'main',
      graph,
      data: [],
    });
    expect(result.error).toBeNull();
    const last = result.steps.at(-1)!;
    expect(last.effects.visited).toEqual([]);
    expect(last.effects.active).toEqual([]);
    expect(last.effects.markedEdges).toEqual([]);
    expect(last.effects.labels).toEqual({});
  });

  it('refuses to run a program with errors', () => {
    const broken = compileAndRun([{ id: 'main', name: 'main.algo', content: 'nope()\n' }], {
      entryId: 'main',
      graph,
      data,
    });
    expect(broken.error).toBeTruthy();
    expect(broken.steps).toEqual([]);
  });
});
