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

  it('reads a single counted loop as O(n) and the nested `for i, j` shorthand as O(n²)', () => {
    const one = 'for i in 0 .. n do\n  x ← i\nend\n';
    expect(estimate([{ id: 'main', name: 'main.algo', content: one }], new Map()).time).toBe('O(n)');
    const two = 'for i, j in 0 .. n do\n  x ← i + j\nend\n';
    expect(estimate([{ id: 'main', name: 'main.algo', content: two }], new Map()).time).toBe('O(n²)');
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

  it('reads a triple-nested vertex scan as O(V^3) (power ≥ 3 spells out the exponent)', () => {
    const src =
      'for each u in nodes() do\n' +
      '  for each v in nodes() do\n' +
      '    for each w in nodes() do\n' +
      '      visit(w)\n' +
      '    end\n' +
      '  end\n' +
      'end\n';
    expect(estimate([{ id: 'main', name: 'main.algo', content: src }], new Map()).time).toBe('O(V^3)');
  });

  it('costs a range whose bound is a graph query by the bound (range used as a value)', () => {
    // `1 .. nodes()` is evaluated as an expression, so its cost is the dominant
    // endpoint factor (nodes() ⇒ V) rather than a loop's per-iteration factor.
    const src = 'x ← 1 .. nodes()\n';
    expect(estimate([{ id: 'main', name: 'main.algo', content: src }], new Map()).time).toBe('O(V)');
  });

  it('inlines a helper used as a value, taking its dominant non-loop op factor', () => {
    // `cost` exercises every statement kind funcFactor walks (assign, exprStmt,
    // if/else, while, for-each, return). Its dominant op is nodes() ⇒ V, so a
    // single straight-line call to it reads as O(V).
    const src =
      'function cost(u) do\n' +
      '  a ← nodes()\n' +
      '  edges()\n' +
      '  if a then\n' +
      '    b ← 1\n' +
      '  else\n' +
      '    c ← 2\n' +
      '  end\n' +
      '  while a do\n' +
      '    a ← 0\n' +
      '  end\n' +
      '  for each x in a do\n' +
      '    mark(x)\n' +
      '  end\n' +
      '  return nodes()\n' +
      'end\n' +
      'total ← cost(source())\n';
    expect(estimate([{ id: 'main', name: 'main.algo', content: src }], new Map()).time).toBe('O(V)');
  });

  it('guards against recursion when inlining a helper used as a value', () => {
    // A self-recursive helper would otherwise loop forever; the inlining guard
    // returns null on re-entry, so the estimate terminates as O(1).
    const src = 'function rec(n) do\n  return rec(n)\nend\nr ← rec(5)\n';
    expect(estimate([{ id: 'main', name: 'main.algo', content: src }], new Map()).time).toBe('O(1)');
  });
});
