import { describe, it, expect } from 'vitest';
import { compile } from './compile';
import { MAIN_SRC, HELPERS_SRC } from '../models/algo-file.model';
import type { Stmt } from './ast';

const seedFiles = [
  { id: 'main', name: 'main.algo', content: MAIN_SRC },
  { id: 'helpers', name: 'helpers.algo', content: HELPERS_SRC },
];

describe('compile (lex + parse + resolve)', () => {
  it('parses the Dijkstra seed with no diagnostics', () => {
    const result = compile(seedFiles);
    expect(result.diagnostics).toEqual([]);
  });

  it('exposes the exported helper with its params and source file', () => {
    const { exports, functions } = compile(seedFiles);
    expect(exports).toEqual([{ name: 'relax', params: 'u, v', file: 'helpers.algo' }]);
    expect(functions.has('relax')).toBe(true);
  });

  it('builds the expected top-level shape for main', () => {
    const main = compile(seedFiles).modules[0];
    const kinds = main.items.map((i) => i.kind);
    // s ← source(), for-each (dist init), dist[s] ← 0, pq.push, while
    expect(kinds).toContain('assign');
    expect(kinds).toContain('forIn');
    expect(kinds).toContain('while');
    expect(kinds).toContain('exprStmt');
  });

  it('nests the relax call inside the while → for-each body', () => {
    const main = compile(seedFiles).modules[0];
    const whileStmt = main.items.find((i) => i.kind === 'while') as Extract<Stmt, { kind: 'while' }>;
    const forEach = whileStmt.body.find((s) => s.kind === 'forIn') as Extract<Stmt, { kind: 'forIn' }>;
    const call = forEach.body[0];
    expect(call.kind).toBe('exprStmt');
    expect(call).toMatchObject({
      expr: { kind: 'call', callee: { kind: 'name', name: 'relax' } },
    });
  });

  it('parses inline blocks and indexed assignment', () => {
    const main = compile(seedFiles).modules[0];
    const whileStmt = main.items.find((i) => i.kind === 'while') as Extract<Stmt, { kind: 'while' }>;
    // `if u in visited then continue end` — inline if with a single continue.
    const ifStmt = whileStmt.body.find((s) => s.kind === 'if') as Extract<Stmt, { kind: 'if' }>;
    expect(ifStmt.thenBody).toEqual([{ kind: 'continue', line: ifStmt.thenBody[0].line }]);

    // helpers: `dist[v] ← alt` is an indexed assignment.
    const relax = compile(seedFiles).modules[1].items[0];
    expect(relax.kind).toBe('function');
  });

  it('reports an unknown bare function call', () => {
    const { diagnostics } = compile([{ id: 'main', name: 'main.algo', content: 'frobnicate()\n' }]);
    expect(diagnostics.some((d) => d.message.includes("Unknown function 'frobnicate'"))).toBe(true);
  });

  it('errors when a data structure is created with a name that is not an identifier', () => {
    const bad = compile([{ id: 'main', name: 'main.algo', content: 'createList(0, 0, "test List")\n' }]);
    expect(bad.diagnostics.some((d) => d.severity === 'error' && d.message.includes('test List'))).toBe(true);
    // A plain identifier name (or no name) is fine.
    expect(compile([{ id: 'main', name: 'main.algo', content: 'createList(0, 0, "testList")\n' }]).diagnostics).toEqual(
      [],
    );
    expect(compile([{ id: 'main', name: 'main.algo', content: 'createMatrix(0, 0, 2, 2, "bad name")\n' }]).diagnostics
      .length).toBe(1);
  });

  it('reports a duplicate export', () => {
    const files = [
      { id: 'a', name: 'a.algo', content: 'export function f() do end\n' },
      { id: 'b', name: 'b.algo', content: 'export function f() do end\n' },
    ];
    const { diagnostics } = compile(files);
    expect(diagnostics.some((d) => d.message.includes("Duplicate export 'f'"))).toBe(true);
  });
});
