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
    { id: 'A', label: 'A', type: 'START', x: 0, y: 0 },
    { id: 'B', label: 'B', type: 'NODE', x: 100, y: 0 },
    { id: 'C', label: 'C', type: 'NODE', x: 200, y: 0 },
    { id: 'D', label: 'D', type: 'NODE', x: 300, y: 0 },
    { id: 'E', label: 'E', type: 'GOAL', x: 400, y: 0 },
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

/** Run a one-file program against the fixture graph (optionally with data structures). */
function runSrc(src: string, dataNodes: typeof data = []) {
  return compileAndRun([{ id: 'main', name: 'main.algo', content: src }], {
    entryId: 'main',
    graph,
    data: dataNodes,
  });
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
    const src = 'for each u in graph.nodes() do\n  canvas.mark(u)\nend\n';
    const result = compileAndRun([{ id: 'main', name: 'main.algo', content: src }], {
      entryId: 'main',
      graph,
      data: [],
    });
    expect(result.error).toBeNull();
    expect(Object.keys(result.steps.at(-1)!.effects.marks).sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
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
    const src = 'for each u in graph.nodes() do\n  mark(u)\nend\n';
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
      '  mark(x)\n' +
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
    expect(Object.keys(result.steps.at(-1)!.effects.markedEdges).sort()).toEqual(['A->B', 'A->C']);
    const edgePans = result.steps.map((s) => s.effects.scrollTo).filter((t) => t?.kind === 'edge');
    expect(edgePans).toContainEqual({ kind: 'edge', from: 'A', to: 'B' });
  });

  it('auto-highlights the current loop vertex as an iteration cursor', () => {
    const src = 'for each u in graph.nodes() do\n  mark(u)\nend\n';
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
      '    mark(u, v)\n' +
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
      'mark(a)\n' +
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
    expect(last.effects.marks).toEqual({});
    expect(last.effects.markedEdges).toEqual({});
    expect(last.effects.labels).toEqual({});
  });

  it('spotlight() and note() emphasise panel entries (a structure by value, a variable by name)', () => {
    const result = runSrc(
      'total ← 5\n' +
        'spotlight("total")\n' +
        'spotlight(pq)\n' +
        'note(pq, "extract-min")\n',
      [makeDataNode('PQUEUE', 'ds-pq', { x: 0, y: 0 }, 'pq')],
    );
    expect(result.error).toBeNull();
    const last = result.steps.at(-1)!;
    expect([...last.effects.spotlight].sort()).toEqual(['ds-pq', 'total']); // structure → id, variable → name
    expect(last.effects.notes).toEqual({ 'ds-pq': 'extract-min' });
  });

  it('unspotlight() drops one spotlight; clearMarks() wipes spotlights and notes', () => {
    const partial = runSrc('spotlight("a")\nspotlight("b")\nunspotlight("a")\nnote("b", "seen")\n');
    expect(partial.error).toBeNull();
    const last = partial.steps.at(-1)!;
    expect(last.effects.spotlight).toEqual(['b']);
    expect(last.effects.notes).toEqual({ b: 'seen' });

    const cleared = runSrc('spotlight("a")\nnote("a", "x")\nclearMarks()\n');
    const lastCleared = cleared.steps.at(-1)!;
    expect(lastCleared.effects.spotlight).toEqual([]);
    expect(lastCleared.effects.notes).toEqual({});
  });

  it('pin() records entries in pin order and survives clearMarks(); unpin() removes one', () => {
    const result = runSrc(
      'pin(pq)\n' + // structure → id
        'pin("dist")\n' + // variable → name
        'clearMarks()\n' + // pins must survive a highlight reset
        'unpin("dist")\n',
      [makeDataNode('PQUEUE', 'ds-pq', { x: 0, y: 0 }, 'pq')],
    );
    expect(result.error).toBeNull();
    expect(result.steps.find((s) => s.line === 3)!.effects.pins).toEqual(['ds-pq', 'dist']); // before clearMarks
    const last = result.steps.at(-1)!;
    expect(last.effects.pins).toEqual(['ds-pq']); // clearMarks kept pins; unpin dropped "dist"
  });

  it('sources() / goals() return every Start / Goal; source() / goal() the first', () => {
    const multi = {
      vertices: [
        { id: 'A', label: 'A', type: 'START', x: 0, y: 0 },
        { id: 'B', label: 'B', type: 'START', x: 1, y: 0 },
        { id: 'C', label: 'C', type: 'NODE', x: 2, y: 0 },
        { id: 'D', label: 'D', type: 'GOAL', x: 3, y: 0 },
        { id: 'E', label: 'E', type: 'GOAL', x: 4, y: 0 },
      ],
      edges: [],
    };
    const src =
      'allStarts ← sources()\n' +
      'allGoals ← goals()\n' +
      'firstStart ← source()\n' +
      'ns ← 0\n' +
      'for each s in sources() do\n  ns ← ns + 1\nend\n';
    const result = compileAndRun([{ id: 'main', name: 'main.algo', content: src }], {
      entryId: 'main',
      graph: multi,
      data: [],
    });
    expect(result.error).toBeNull();
    const vars = Object.fromEntries(result.steps.at(-1)!.vars.map((v) => [v.name, v.value]));
    expect(vars['firstStart']).toBe('A'); // source() = the first START
    expect(vars['ns']).toBe('2'); // two STARTs iterated
    expect(vars['allStarts']).toBe('[A, B]'); // sources() lists every START
    expect(vars['allGoals']).toBe('[D, E]'); // goals() lists every GOAL
  });

  it('createNode adds vertices (auto-named) and createEdge connects them', () => {
    const result = runSrc(
      'clearGraph()\n' +
        'a ← createNode(100, 200, "X")\n' +
        'b ← createNode(300, 200)\n' +
        'createEdge(a, b, 5)\n',
    );
    expect(result.error).toBeNull();
    const last = result.steps.at(-1)!;
    expect(last.graph.nodes.map((n) => n.label)).toEqual(['X', 'N2']); // 2nd is auto-named
    expect(last.graph.nodes.find((n) => n.label === 'X')).toMatchObject({ x: 100, y: 200 });
    expect(last.graph.edges).toHaveLength(1);
    expect(last.graph.edges[0]).toMatchObject({ weight: 5, directed: true });
  });

  it('deleteNode removes the vertex and its incident edges', () => {
    const result = runSrc(
      'clearGraph()\n' +
        'a ← createNode(0, 0, "A")\n' +
        'b ← createNode(0, 0, "B")\n' +
        'createEdge(a, b)\n' +
        'deleteNode(a)\n',
    );
    expect(result.error).toBeNull();
    const last = result.steps.at(-1)!;
    expect(last.graph.nodes.map((n) => n.label)).toEqual(['B']);
    expect(last.graph.edges).toHaveLength(0);
  });

  it('createSet/deleteDS and clearCanvas manage data structures', () => {
    const created = runSrc('clearCanvas()\ns ← createSet(50, 60, "seen")\ns.add(1)\ns.add(2)\n');
    expect(created.error).toBeNull();
    const last = created.steps.at(-1)!;
    expect(last.graph.nodes).toEqual([]); // clearCanvas wiped the graph too
    expect(last.data).toHaveLength(1);
    expect(last.data[0]).toMatchObject({ kind: 'SET', label: 'seen', x: 50, y: 60 });
    expect([...last.data[0].items].sort()).toEqual([1, 2]);

    const removed = runSrc('s ← createSet(0, 0, "tmp")\ndeleteDS(s)\n');
    expect(removed.steps.at(-1)!.data).toEqual([]);
  });

  it('concatenates strings with + for dynamic names', () => {
    const result = runSrc('clearGraph()\nfor i in 1..3 do\n  createNode(i, i, "N" + i)\nend\n');
    expect(result.error).toBeNull();
    expect(result.steps.at(-1)!.graph.nodes.map((n) => n.label)).toEqual(['N1', 'N2', 'N3']);
  });

  it('makes code-created names unique, like the canvas', () => {
    const result = runSrc('createSet(0, 0, "N")\ncreateSet(0, 0, "N")\ncreateSet(0, 0, "N")\n');
    expect(result.error).toBeNull();
    expect(result.steps.at(-1)!.data.map((d) => d.label)).toEqual(['N', 'N2', 'N3']);
  });

  it('persists only when saveCanvas() is called', () => {
    expect(runSrc('createNode(0, 0)\n').savedCanvas).toBeNull();
    const saved = runSrc('clearGraph()\ncreateNode(10, 20, "P")\nsaveCanvas()\n').savedCanvas;
    expect(saved).not.toBeNull();
    expect(saved!.nodes.map((n) => n.label)).toEqual(['P']);
  });

  it('mark takes an optional type that recolours vertices and edges', () => {
    const result = runSrc('a ← source()\nb ← goal()\nmark(a, "danger")\nmark(a, b, "success")\n');
    expect(result.error).toBeNull();
    const eff = result.steps.at(-1)!.effects;
    expect(eff.marks['A']).toBe('danger');
    expect(eff.markedEdges['A->E']).toBe('success'); // source = A, goal = E
    // A plain mark carries the empty (default) type.
    expect(runSrc('mark(source())\n').steps.at(-1)!.effects.marks['A']).toBe('');
  });

  it('shows a typed snackbar on the step that set it, cleared on the next step', () => {
    const result = runSrc('showMessage("processing", "warn")\nmark(source())\nshowMessage("done", "success")\n');
    expect(result.error).toBeNull();
    const msgs = result.steps.map((s) => s.effects.message);
    expect(msgs).toContainEqual({ text: 'processing', type: 'warn' }); // shown on its own step
    expect(result.steps.find((s) => s.line === 2)!.effects.message).toBeNull(); // the mark step in between carries nothing
    expect(result.steps.at(-1)!.effects.message).toEqual({ text: 'done', type: 'success' });
  });

  it('showMessage with empty text clears the snackbar', () => {
    expect(runSrc('showMessage("hi")\nshowMessage("")\n').steps.at(-1)!.effects.message).toBeNull();
  });

  it('hideMessage dismisses the snackbar', () => {
    const result = runSrc('showMessage("hi", "info")\nmark(source())\nhideMessage()\n');
    expect(result.error).toBeNull();
    // "hi" shows only on its own step; the steps after it (and the end) carry nothing.
    expect(result.steps.map((s) => s.effects.message)).toContainEqual({ text: 'hi', type: 'info' });
    expect(result.steps.at(-1)!.effects.message).toBeNull();
  });

  it('queries the plain list from graph.nodes()/neighbors() with size/contains/indexOf and []', () => {
    const msg = (src: string) => runSrc(src).steps.at(-1)!.effects.message!.text;
    expect(msg('showMessage("" + graph.nodes().size())\n')).toBe('5'); // five vertices
    expect(msg('showMessage("" + neighbors(source()).size())\n')).toBe('2'); // A → B, A → C
    expect(msg('showMessage("" + graph.nodes().contains(goal()))\n')).toBe('true');
    expect(msg('showMessage("" + graph.nodes().isEmpty())\n')).toBe('false');
    // A vertex pulled out of the list by index is still a usable vertex.
    const r = runSrc('mark(neighbors(source())[0], "success")\n');
    expect(r.error).toBeNull();
    expect(Object.values(r.steps.at(-1)!.effects.marks)).toContain('success');
  });

  it('watches the running file\'s scalar variables with their current values', () => {
    const src =
      'count ← 0\n' +
      'start ← source()\n' +
      'for each u in neighbors(start) do\n' +
      '  count ← count + 1\n' +
      'end\n';
    const result = runSrc(src);
    expect(result.error).toBeNull();
    // The final step sees every top-level binding with its end value and category.
    const vars = result.steps.at(-1)!.vars;
    const byName = Object.fromEntries(vars.map((v) => [v.name, v]));
    expect(byName['count']).toEqual({ name: 'count', value: '2', kind: 'number' }); // A → B, A → C
    expect(byName['start']).toEqual({ name: 'start', value: 'A', kind: 'vertex' });
    expect(byName['u']).toMatchObject({ kind: 'vertex' }); // loop var lingers at its last value
    // `count` climbs as the loop runs.
    const counts = result.steps.map((s) => s.vars.find((v) => v.name === 'count')?.value);
    expect(counts).toContain('1');
    expect(counts).toContain('2');
  });

  it('keeps data structures out of the variable watch (they have their own panel)', () => {
    // `pq` binds a created priority queue — it belongs to the data panel, not vars.
    const result = runSrc('pq ← createPQueue(5, 5)\nn ← graph.nodes().size()\n');
    expect(result.error).toBeNull();
    const vars = result.steps.at(-1)!.vars;
    expect(vars.find((v) => v.name === 'pq')).toBeUndefined();
    expect(vars.find((v) => v.name === 'n')).toEqual({ name: 'n', value: '5', kind: 'number' });
  });

  it('calls graph queries as vertex methods and reads vertex properties', () => {
    const src =
      'a ← source()\n' +
      'b ← graph.nodes().get(1)\n' + // B
      'showMessage(a.degree() + "|" + a.hasEdge(b) + "|" + a.weight(b) + "|" + a.name + "|" + a.type)\n';
    const result = runSrc(src);
    expect(result.error).toBeNull();
    expect(result.steps.at(-1)!.effects.message!.text).toBe('2|true|4|A|START');
    // chained: vertex method then list query
    expect(runSrc('showMessage("" + source().neighbors().size())\n').steps.at(-1)!.effects.message!.text).toBe('2');
  });

  it('edges() returns edge values with endpoints, weight and direction', () => {
    const result = runSrc(
      'es ← edges()\n' +
      'e0 ← es.get(0)\n' + // A → B, weight 4, directed
      'showMessage(e0.startVertex + "|" + e0.endVertex + "|" + e0.weight + "|" + e0.isDirected + "|" + es.size())\n',
    );
    expect(result.error).toBeNull();
    expect(result.steps.at(-1)!.effects.message!.text).toBe('A|B|4|true|6');
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

describe('scratch structures (hidden, off-canvas bookkeeping)', () => {
  it('scratch.* builds a working structure, usable by its variable', () => {
    const result = runSrc(
      'a ← source()\n' +
      'inDeg ← scratch.createMap("inDeg")\n' +
      'inDeg[a] ← 7\n' +
      'inDeg[a] ← inDeg[a] + 1\n' +
      'showMessage("" + inDeg[a])\n',
    );
    expect(result.error).toBeNull();
    expect(result.steps.at(-1)!.effects.message!.text).toBe('8');
  });

  it('never appears in the data panel, unlike a visible createMap', () => {
    const visible = runSrc('m ← createMap(10, 20, "shown")\nm[source()] ← 1\n');
    expect(visible.steps.at(-1)!.data.map((d) => d.label)).toEqual(['shown']);

    const hidden = runSrc('m ← scratch.createMap("hidden")\nm[source()] ← 1\n');
    expect(hidden.steps.every((s) => s.data.length === 0)).toBe(true);
  });

  it('keeps full FIFO/queue semantics while staying hidden', () => {
    const result = runSrc(
      'q ← scratch.createQueue()\n' +
      'q.enqueue(source())\n' +
      'q.enqueue(goal())\n' +
      'showMessage(q.dequeue() + "|" + q.size())\n',
    );
    expect(result.error).toBeNull();
    expect(result.steps.at(-1)!.effects.message!.text).toBe('A|1'); // A dequeues first, E remains
  });

  it('stays out of both the data panel and the variable watch', () => {
    const result = runSrc('seen ← scratch.createSet()\nseen.add(1)\nn ← seen.size()\n');
    expect(result.error).toBeNull();
    const last = result.steps.at(-1)!;
    expect(last.data).toEqual([]);
    expect(last.vars.find((v) => v.name === 'seen')).toBeUndefined();
    expect(last.vars.find((v) => v.name === 'n')).toMatchObject({ value: '1' });
  });

  it('scratch.createMatrix takes rows and cols', () => {
    const result = runSrc('M ← scratch.createMatrix(2, 3)\nshowMessage(M.rows() + "x" + M.cols())\n');
    expect(result.error).toBeNull();
    expect(result.steps.at(-1)!.effects.message!.text).toBe('2x3');
    expect(result.steps.at(-1)!.data).toEqual([]);
  });

  it('is not persisted by saveCanvas()', () => {
    const saved = runSrc('clearGraph()\ninDeg ← scratch.createMap("inDeg")\ninDeg[source()] ← 1\nsaveCanvas()\n').savedCanvas;
    expect(saved).not.toBeNull();
    expect(saved!.data).toEqual([]); // the scratch map is left out of the saved canvas
  });

  it('rejects an unknown scratch structure kind with a helpful message', () => {
    const result = runSrc('x ← scratch.heap()\n');
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('scratch.heap');
  });
});

describe('panel structures (off-canvas, watchable in the data panel)', () => {
  it('appears in the data panel feed but is flagged off-canvas (rendered = false)', () => {
    const result = runSrc('inDeg ← panel.createMap("inDeg")\ninDeg[source()] ← 5\n');
    expect(result.error).toBeNull();
    const snap = result.steps.at(-1)!.data.find((d) => d.label === 'inDeg');
    expect(snap).toBeDefined();              // tracked → reaches the data panel
    expect(snap!.rendered).toBe(false);      // but not drawn on the run canvas
    expect(snap!.entries).toEqual([{ key: 'A', value: 5 }]);
  });

  it('contrasts with createMap (rendered) and scratch.createMap (absent from the trace)', () => {
    const visible = runSrc('m ← createMap(10, 20, "shown")\n').steps.at(-1)!;
    expect(visible.data.find((d) => d.label === 'shown')!.rendered).toBe(true);

    const scratch = runSrc('m ← scratch.createMap("hidden")\nm[source()] ← 1\n');
    expect(scratch.steps.every((s) => s.data.length === 0)).toBe(true);
  });

  it('keeps full semantics and is reachable by name', () => {
    const result = runSrc('q ← panel.createQueue("q")\nq.enqueue(source())\nshowMessage(q.front() + "|" + q.size())\n');
    expect(result.error).toBeNull();
    expect(result.steps.at(-1)!.effects.message!.text).toBe('A|1');
  });

  it('is not persisted by saveCanvas() (it is not on the canvas)', () => {
    const saved = runSrc('clearGraph()\nseen ← panel.createSet("seen")\nseen.add(source())\nsaveCanvas()\n').savedCanvas;
    expect(saved).not.toBeNull();
    expect(saved!.data).toEqual([]);
  });

  it('rejects an unknown panel structure kind with a helpful message', () => {
    const result = runSrc('x ← panel.heap()\n');
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('panel.heap');
  });
});

describe('printDebug', () => {
  it('collects output tagged with its source line', () => {
    const result = runSrc(
      'a ← source()\n' +
      'b ← goal()\n' +
      'printDebug("from " + a)\n' +
      'printDebug("to " + b)\n',
    );
    expect(result.error).toBeNull();
    expect(result.debug).toEqual([
      { line: 3, text: 'from A' },
      { line: 4, text: 'to E' },
    ]);
  });

  it('is instrumentation only — it never charges the operation counter', () => {
    const withDebug = runSrc('a ← source()\nprintDebug(a)\nprintDebug(a)\n');
    const without = runSrc('a ← source()\n');
    expect(withDebug.steps.at(-1)!.ops).toBe(without.steps.at(-1)!.ops);
  });
});

describe('atoms and operators', () => {
  it('evaluates the literal atoms true, false, nil and INFINITY', () => {
    const result = runSrc('t ← true\nf ← false\nn ← nil\ninf ← INFINITY\n');
    expect(result.error).toBeNull();
    const vars = Object.fromEntries(result.steps.at(-1)!.vars.map((v) => [v.name, v]));
    expect(vars['t']).toMatchObject({ value: 'true', kind: 'bool' });
    expect(vars['f']).toMatchObject({ value: 'false', kind: 'bool' });
    expect(vars['n']).toMatchObject({ value: 'nil', kind: 'nil' });
    expect(vars['inf']).toMatchObject({ value: '∞', kind: 'number' });
  });

  it('evaluates arithmetic, comparison, unary and boolean operators', () => {
    const result = runSrc(
      'add ← 2 + 3\n' +
        'sub ← 7 - 4\n' +
        'mul ← 3 * 4\n' +
        'div ← 12 / 4\n' +
        'mod ← 7 % 3\n' +
        'lt ← 1 < 2\n' +
        'gt ← 5 > 9\n' +
        'le ← 2 ≤ 2\n' +
        'ge ← 3 ≥ 4\n' +
        'eq ← 1 = 1\n' +
        'ne ← 1 ≠ 2\n' +
        'neg ← -5\n' +
        'notF ← not false\n' +
        'andV ← true and false\n' +
        'orV ← false or true\n',
    );
    expect(result.error).toBeNull();
    const v = Object.fromEntries(result.steps.at(-1)!.vars.map((x) => [x.name, x.value]));
    expect(v).toMatchObject({
      add: '5',
      sub: '3',
      mul: '12',
      div: '3',
      mod: '1',
      lt: 'true',
      gt: 'false',
      le: 'true',
      ge: 'false',
      eq: 'true',
      ne: 'true',
      neg: '-5',
      notF: 'true',
      andV: 'false',
      orV: 'true',
    });
  });

  it('tests membership with `in` over arrays, and reads false against a non-container', () => {
    const inArray = runSrc('a ← source()\nshowMessage("" + (a in nodes()))\n');
    expect(inArray.steps.at(-1)!.effects.message!.text).toBe('true');
    const inScalar = runSrc('showMessage("" + (5 in 3))\n');
    expect(inScalar.steps.at(-1)!.effects.message!.text).toBe('false');
  });
});

describe('runtime errors', () => {
  it('errors when a graph builtin gets a non-vertex argument', () => {
    expect(runSrc('mark(5)\n').error).toContain('Expected a vertex');
  });

  it('errors when iterating a value that is not a collection', () => {
    expect(runSrc('for each x in 5 do\n  mark(x)\nend\n').error).toContain('not iterable');
  });

  it('errors when indexing a value that cannot be indexed', () => {
    expect(runSrc('n ← 5\nx ← n[0]\n').error).toContain('Cannot index');
  });

  it('errors when assigning into a value that is not a structure', () => {
    expect(runSrc('arr ← nodes()\narr[0] ← 5\n').error).toContain('Cannot assign into');
  });

  it('rejects unknown vertex / edge properties and method-only member access', () => {
    expect(runSrc('a ← source()\nx ← a.foo\n').error).toContain("vertex has no property 'foo'");
    expect(runSrc('e ← edges().get(0)\nx ← e.foo\n').error).toContain("edge has no property 'foo'");
    expect(runSrc('n ← 5\nx ← n.foo\n').error).toContain('must be called as a method');
  });

  it('rejects calling an unknown method on a plain list', () => {
    expect(runSrc('x ← nodes().frobnicate()\n').error).toContain('is not a method of a list');
  });

  it('points you at parenthesis-free edge field reads', () => {
    expect(runSrc('e ← edges().get(0)\nx ← e.weight()\n').error).toContain('without parentheses');
  });

  it('rejects calling a method on a value that has none', () => {
    expect(runSrc('n ← 5\nx ← n.foo()\n').error).toContain('is not a method of');
  });
});
