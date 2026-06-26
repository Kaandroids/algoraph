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
