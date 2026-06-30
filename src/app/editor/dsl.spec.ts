import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { algoraphLanguage, globalsFacet, exportsFacet, type EditorGlobal } from './dsl';
import type { ExportRef } from '../models/exports';

/**
 * `dsl.ts` is editor sugar; its richest pure surface is the completion source.
 * It is not exported directly, so each case drives it the way CodeMirror does:
 * build an `EditorState` with `algoraphLanguage()` (plus the canvas-fed
 * `globalsFacet` / `exportsFacet`), then invoke the registered `autocomplete`
 * provider through a `CompletionContext`. No DOM is needed — only the state.
 */
interface Opts {
  pos?: number;
  explicit?: boolean;
  globals?: EditorGlobal[];
  exports?: ExportRef[];
}

function complete(doc: string, opts: Opts = {}): CompletionResult | null {
  const pos = opts.pos ?? doc.length;
  const state = EditorState.create({
    doc,
    selection: { anchor: pos },
    extensions: [
      algoraphLanguage(),
      globalsFacet.of(opts.globals ?? []),
      exportsFacet.of(opts.exports ?? []),
    ],
  });
  const sources = state.languageDataAt<(c: CompletionContext) => CompletionResult | null>(
    'autocomplete',
    pos,
  );
  const cx = new CompletionContext(state, pos, opts.explicit ?? true);
  for (const source of sources) {
    const result = source(cx);
    if (result) return result;
  }
  return null;
}

const labels = (result: CompletionResult | null) => (result?.options ?? []).map((o) => o.label);

describe('algoraphLanguage', () => {
  it('returns a non-empty extension array', () => {
    const ext = algoraphLanguage();
    expect(Array.isArray(ext)).toBe(true);
    expect(ext.length).toBeGreaterThan(0);
  });
});

describe('globalsFacet / exportsFacet', () => {
  it('flattens every globals contribution into one list', () => {
    const state = EditorState.create({
      extensions: [
        globalsFacet.of([{ name: 'graph', type: 'Graph' }]),
        globalsFacet.of([{ name: 'frontier', type: 'Stack' }]),
      ],
    });
    expect(state.facet(globalsFacet).map((g) => g.name)).toEqual(['graph', 'frontier']);
  });

  it('flattens every exports contribution into one list', () => {
    const state = EditorState.create({
      extensions: [
        exportsFacet.of([{ name: 'relax', params: 'u, v', file: 'a.algo' }]),
        exportsFacet.of([{ name: 'init', params: '', file: 'b.algo' }]),
      ],
    });
    expect(state.facet(exportsFacet).map((e) => e.name)).toEqual(['relax', 'init']);
  });
});

describe('dslAutocomplete — top-level names', () => {
  it('offers DSL keywords from the start of the typed word', () => {
    const result = complete('wh');
    expect(result?.from).toBe(0);
    expect(labels(result)).toEqual(expect.arrayContaining(['while', 'if', 'for each', 'INFINITY']));
  });

  it('surfaces canvas globals as variables with their type as the detail', () => {
    const result = complete('g', { globals: [{ name: 'graph', type: 'Graph' }] });
    const graph = result?.options.find((o) => o.label === 'graph');
    expect(graph).toMatchObject({ label: 'graph', type: 'variable', detail: ': Graph' });
  });

  it('offers exported helpers as calls that insert their parameter names', () => {
    const result = complete('r', { exports: [{ name: 'relax', params: 'u, v', file: 'helpers.algo' }] });
    const relax = result?.options.find((o) => o.label === 'relax');
    expect(relax).toEqual({
      label: 'relax',
      type: 'function',
      detail: '(u, v)',
      info: 'Exported helper · helpers.algo',
      apply: 'relax(u, v)',
    });
  });

  it('completes an assignment target bound earlier in the file', () => {
    const result = complete('dist ← 0\nd');
    const dist = result?.options.find((o) => o.label === 'dist');
    expect(dist).toEqual({ label: 'dist', type: 'variable' });
  });

  it('completes a loop variable introduced by `for each`', () => {
    const result = complete('for each node in nodes()\nno');
    expect(labels(result)).toContain('node');
  });

  it('completes every comma-separated loop variable of a nested for', () => {
    const result = complete('for i, j in 0 .. n do\n  i');
    expect(labels(result)).toEqual(expect.arrayContaining(['i', 'j']));
  });

  it('completes function parameters (the last word of each `type name` pair)', () => {
    const result = complete('function f(vertex a, b)\nx');
    expect(labels(result)).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('completes a non-exported function declared in this file as a call', () => {
    const result = complete('function tests() do\nend\n\nexport function fwInit() do\n  te', {
      exports: [{ name: 'fwInit', params: '', file: 'main.algo' }],
    });
    const tests = result?.options.find((o) => o.label === 'tests');
    expect(tests).toEqual({
      label: 'tests',
      type: 'function',
      detail: '()',
      info: 'Helper in this file',
      apply: 'tests()',
    });
  });

  it('inserts a local helper call with its parameter names', () => {
    const result = complete('function relax(int u, vertex v) do\nend\nr');
    const relax = result?.options.find((o) => o.label === 'relax');
    expect(relax).toMatchObject({ type: 'function', detail: '(u, v)', apply: 'relax(u, v)' });
  });

  it('does not duplicate a current-file export already in the exports list', () => {
    const result = complete('export function fwInit() do\nend\nfw', {
      exports: [{ name: 'fwInit', params: '', file: 'main.algo' }],
    });
    const matches = (result?.options ?? []).filter((o) => o.label === 'fwInit');
    expect(matches).toHaveLength(1);
    expect(matches[0].info).toBe('Exported helper · main.algo'); // the exported entry is kept
  });

  it('returns null when there is nothing before the cursor and completion is implicit', () => {
    expect(complete('', { pos: 0, explicit: false })).toBeNull();
  });
});

describe('dslAutocomplete — member access on a named global', () => {
  const graphWithMembers: EditorGlobal = {
    name: 'graph',
    type: 'Graph',
    members: [
      { label: 'nodes', detail: '(): list<vertex>', info: 'every vertex', apply: 'nodes()' },
      { label: 'weight', detail: '(u, v): number', info: 'edge weight', apply: 'weight(u, v)' },
    ],
  };

  it('lists the global’s own members after the dot', () => {
    const result = complete('graph.', { globals: [graphWithMembers] });
    expect(result?.from).toBe('graph.'.length); // right after the dot
    expect(labels(result)).toEqual(['nodes', 'weight']);
    const nodes = result?.options.find((o) => o.label === 'nodes');
    expect(nodes).toMatchObject({ type: 'method', apply: 'nodes()', detail: '(): list<vertex>' });
  });

  it('returns null for a known global that exposes no members', () => {
    expect(complete('graph.', { globals: [{ name: 'graph', type: 'Graph' }] })).toBeNull();
  });
});

describe('dslAutocomplete — inferred local types', () => {
  it('treats `for each v in nodes()` as a vertex and offers vertex members', () => {
    const result = complete('for each v in nodes()\nv.');
    expect(labels(result)).toEqual(
      expect.arrayContaining(['neighbors', 'degree', 'hasEdge', 'weight', 'name', 'type']),
    );
    expect(result?.options.find((o) => o.label === 'neighbors')?.apply).toBe('neighbors()');
  });

  it('treats `for each e in edges()` as an edge and offers edge members', () => {
    const result = complete('for each e in edges()\ne.');
    expect(labels(result)).toEqual(['startVertex', 'endVertex', 'weight', 'isDirected']);
  });

  it('infers a vertex from `s ← source()` assignment', () => {
    const result = complete('s ← source()\ns.');
    expect(labels(result)).toContain('neighbors');
  });

  it('returns null for a dotted variable whose type cannot be inferred', () => {
    expect(complete('mystery ← 1\nmystery.')).toBeNull();
  });
});

describe('dslAutocomplete — chained query results', () => {
  it('offers list-query methods after a list-returning call', () => {
    const result = complete('nodes().');
    expect(result?.from).toBe('nodes().'.length);
    expect(labels(result)).toEqual(['size', 'isEmpty', 'contains', 'indexOf', 'get']);
  });

  it('offers vertex members after a vertex-returning call', () => {
    const result = complete('source().');
    expect(labels(result)).toEqual(
      expect.arrayContaining(['neighbors', 'degree', 'hasEdge', 'weight', 'name', 'type']),
    );
  });

  it('walks nested parentheses to the outer call head', () => {
    // `neighbors(foo(x))` returns a list → list-query methods, proving the
    // paren-matching in headCallName resolves to the outer `neighbors` call.
    const result = complete('neighbors(foo(x)).');
    expect(labels(result)).toEqual(['size', 'isEmpty', 'contains', 'indexOf', 'get']);
  });
});
