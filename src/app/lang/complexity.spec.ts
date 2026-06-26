import { describe, it, expect } from 'vitest';
import { compile } from './compile';
import { estimateComplexity } from './complexity';
import { MAIN_SRC, HELPERS_SRC } from '../models/algo-file.model';
import type { DataStructureKind } from '../models/data-structure.model';

const seedFiles = [
  { id: 'main', name: 'main.algo', content: MAIN_SRC },
  { id: 'helpers', name: 'helpers.algo', content: HELPERS_SRC },
];

const seedKinds = new Map<string, DataStructureKind>([
  ['visited', 'SET'],
  ['dist', 'MAP'],
  ['pq', 'PQUEUE'],
]);

function estimate(files: { id: string; name: string; content: string }[], kinds = seedKinds) {
  const c = compile(files);
  return estimateComplexity(c.modules[0], c.functions, kinds);
}

describe('estimateComplexity', () => {
  it('reads Dijkstra as O((V + E) log V) time, O(V) space', () => {
    expect(estimate(seedFiles)).toEqual({ time: 'O((V + E) log V)', space: 'O(V)' });
  });

  it('reads a single pass over the vertices as O(V)', () => {
    const src = 'for each vertex u in nodes() do\n  visit(u)\nend\n';
    expect(estimate([{ id: 'main', name: 'main.algo', content: src }], new Map()).time).toBe('O(V)');
  });

  it('reads a nested vertex scan as O(V²)', () => {
    const src =
      'for each vertex u in nodes() do\n  for each vertex v in nodes() do\n    visit(v)\n  end\nend\n';
    expect(estimate([{ id: 'main', name: 'main.algo', content: src }], new Map()).time).toBe('O(V²)');
  });

  it('reports O(V²) space when a matrix is on the canvas', () => {
    const kinds = new Map<string, DataStructureKind>([['adj', 'MATRIX']]);
    expect(estimate(seedFiles, kinds).space).toBe('O(V²)');
  });

  it('reads straight-line code as O(1)', () => {
    expect(estimate([{ id: 'main', name: 'main.algo', content: 'x ← 1\ny ← 2\n' }], new Map()).time).toBe(
      'O(1)',
    );
  });
});
