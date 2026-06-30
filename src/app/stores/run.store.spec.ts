import { describe, it, expect, beforeEach } from 'vitest';
import '@angular/compiler'; // load the JIT compiler so injectables compile under raw vitest
import { Injector } from '@angular/core';
import { RunStore } from './run.store';
import { CanvasStore } from './canvas.store';
import { FilesStore } from './files.store';
import { makeDataNode } from '../models/data-structure.model';
import { makeInputPort, makeOutputPort } from '../models/port.util';
import type { GEdge, GNode } from '../models/graph.model';

// These three stores are plain `@Injectable({providedIn:'root'})` services wired
// with `inject()` — no DOM, no change detection. A bare `Injector.create` that
// provides all three gives RunStore its real CanvasStore/FilesStore dependencies
// and a fresh, fully isolated instance per test, without the browser test
// platform (which would need a DOM the `node` vitest environment doesn't have).

// A tiny deterministic program. Each statement is one line, so line N (1-based)
// is the Nth line below — handy for locating its step in the trace.
const PROGRAM =
  [
    'x ← 1', //                 1
    'y ← 2', //                 2
    'x ← x + 10', //            3  x changes 1 → 11
    'visited.add(source())', // 4  the visited set grows by "A"
    'spotlight("x")', //        5
    'note("x", "the x note")', //6
    'pin("y")', //              7
    'pin("x")', //              8  x pinned after y → floats above it
    'pin(visited)', //          9
    'pin(dist)', //            10  dist pinned after visited → floats above it
    'clearMarks()', //         11  drops spotlight + notes, keeps pins
  ].join('\n') + '\n';

let run: RunStore;
let canvas: CanvasStore;
let files: FilesStore;

/** Seed a 2-vertex graph (A → B) plus a `visited` set and a `dist` map. */
function seedCanvas(): void {
  const nodes: GNode[] = [
    { id: 'A', kind: 'START', label: 'A', position: { x: 0, y: 0 } },
    { id: 'B', kind: 'NODE', label: 'B', position: { x: 100, y: 0 } },
  ];
  const edges: GEdge[] = [
    { id: 'e1', outputId: makeOutputPort('A'), inputId: makeInputPort('B'), weight: 1, directed: true },
  ];
  canvas.load({
    nodes,
    edges,
    dataNodes: [
      makeDataNode('SET', 'ds-visited', { x: 0, y: 0 }, 'visited'),
      makeDataNode('MAP', 'ds-dist', { x: 0, y: 0 }, 'dist'),
    ],
  });
}

describe('RunStore', () => {
  beforeEach(() => {
    const injector = Injector.create({ providers: [CanvasStore, FilesStore, RunStore] });
    canvas = injector.get(CanvasStore);
    files = injector.get(FilesStore);
    run = injector.get(RunStore);
    seedCanvas();
    files.setContent(PROGRAM);
  });

  /** First trace index whose current (1-based) line equals `line`. */
  function indexOfLine(line: number): number {
    for (let i = 0; i < run.total(); i++) {
      run.seek(i);
      if (run.currentLine() === line) return i;
    }
    throw new Error(`no step on line ${line}`);
  }

  it('starts empty, then build() produces a trace', () => {
    expect(run.hasRun()).toBe(false);
    expect(run.total()).toBe(0);
    expect(run.error()).toBeNull();

    run.build();

    expect(run.error()).toBeNull();
    expect(run.hasRun()).toBe(true);
    expect(run.total()).toBeGreaterThan(1);
  });

  it('restart() re-runs from the first step', () => {
    run.build();
    run.seek(run.total() - 1);
    expect(run.atEnd()).toBe(true);

    run.restart();

    expect(run.hasRun()).toBe(true);
    expect(run.stepNumber()).toBe(0);
    expect(run.atStart()).toBe(true);
  });

  it('reports an error and produces no trace for a broken program', () => {
    files.setContent('nope()\n');
    run.build();

    expect(run.error()).toBeTruthy();
    expect(run.hasRun()).toBe(false);
    expect(run.total()).toBe(0);
  });

  it('stepForward / stepBack / seek respect the trace bounds', () => {
    run.build();
    const last = run.total() - 1;

    expect(run.stepNumber()).toBe(0);
    expect(run.atStart()).toBe(true);
    expect(run.atEnd()).toBe(false);

    run.stepBack(); // already at the start — stays put
    expect(run.stepNumber()).toBe(0);

    run.stepForward();
    expect(run.stepNumber()).toBe(1);
    expect(run.atStart()).toBe(false);

    run.seek(10_000); // clamps to the last step
    expect(run.stepNumber()).toBe(last);
    expect(run.atEnd()).toBe(true);

    run.stepForward(); // already at the end — stays put
    expect(run.stepNumber()).toBe(last);

    run.seek(-50); // clamps to the first step
    expect(run.stepNumber()).toBe(0);
    expect(run.atStart()).toBe(true);
  });

  it('surfaces currentLine, ops and bigO from the trace', () => {
    run.build();

    // The start step sits on the first statement with nothing run yet.
    expect(run.stepNumber()).toBe(0);
    expect(run.currentLine()).toBe(1);
    expect(run.ops()).toBe(0);

    // The final step has finished: no current line, operations accumulated.
    run.seek(run.total() - 1);
    expect(run.currentLine()).toBeNull();
    expect(run.ops()).toBeGreaterThan(0);

    // bigO is passed straight through from the run result (the complexity pass
    // runs in the component, so the run pipeline leaves it as the unknown default).
    expect(run.bigO()).toEqual({ time: 'O(?)', space: 'O(?)' });
  });

  it('varChanged flags a scalar that changed vs the previous step', () => {
    run.build();
    const i = indexOfLine(3); // x ← x + 10

    run.seek(i);
    expect(run.varChanged('x')).toBe(true);
    expect(run.varChanged('y')).toBe(false);

    run.seek(i - 1); // the step before — x has not changed yet
    expect(run.varChanged('x')).toBe(false);
  });

  it('itemChanged and dataChanged flag a structure that grew', () => {
    run.build();
    run.seek(indexOfLine(4)); // visited.add(source())

    expect(run.dataChanged('ds-visited')).toBe(true);
    expect(run.itemChanged('ds-visited', 'A')).toBe(true); // source() is vertex A
    expect(run.dataChanged('ds-dist')).toBe(false); // the map was untouched this step
  });

  it('spotlight() and note() emphasise a panel entry until cleared', () => {
    run.build();
    run.seek(indexOfLine(10)); // after spotlight/note, before clearMarks

    expect(run.isSpotlit('x')).toBe(true);
    expect(run.noteOf('x')).toBe('the x note');
  });

  it('pin() floats the most-recently-pinned entry to the top; clearMarks keeps pins but drops spotlight', () => {
    run.build();

    run.seek(indexOfLine(10));
    // x pinned after y → x floats above y; dist pinned after visited → dist above visited.
    expect(run.varsView().map((v) => v.name)).toEqual(['x', 'y']);
    expect(run.dataView().map((d) => d.label)).toEqual(['dist', 'visited']);
    expect(run.isPinned('x')).toBe(true);
    expect(run.isPinned('ds-dist')).toBe(true);

    // Final step: clearMarks() has run — spotlight + notes gone, pins survive.
    run.seek(run.total() - 1);
    expect(run.isSpotlit('x')).toBe(false);
    expect(run.noteOf('x')).toBeNull();
    expect(run.isPinned('x')).toBe(true);
    expect(run.isPinned('ds-dist')).toBe(true);
    expect(run.varsView().map((v) => v.name)).toEqual(['x', 'y']);
    expect(run.dataView().map((d) => d.label)).toEqual(['dist', 'visited']);
  });

  // ── Transport: derived progress / clamping at the ends ──────
  it('reports lastStep, progress and the start/end flags across the trace', () => {
    run.build();
    const last = run.total() - 1;
    expect(last).toBeGreaterThan(0);

    expect(run.lastStep()).toBe(last);
    expect(run.stepNumber()).toBe(0);
    expect(run.atStart()).toBe(true);
    expect(run.atEnd()).toBe(false);
    expect(run.progress()).toBe(0);

    run.seek(last);
    expect(run.atStart()).toBe(false);
    expect(run.atEnd()).toBe(true);
    expect(run.progress()).toBe(1);

    // A middle step is a clean fraction of the (last) step count.
    const mid = Math.floor(last / 2);
    run.seek(mid);
    expect(run.progress()).toBeCloseTo(mid / last);
  });

  it('annotates the first step "start" and the final step "done"', () => {
    run.build();

    run.seek(0);
    expect(run.note()).toBe('start');

    run.seek(1);
    expect(run.note()).toBe(''); // a plain statement carries no note

    run.seek(run.total() - 1);
    expect(run.note()).toBe('done');
  });

  // ── Playback speed / animation timing ──────────────────────
  it('cycleSpeed rotates 1 → 2 → 4 → 0.5 → 1 and shortens animMs', () => {
    expect(run.speed()).toBe(1);
    expect(run.animMs()).toBe(450);

    run.cycleSpeed();
    expect(run.speed()).toBe(2);
    expect(run.animMs()).toBe(225); // 450 / 2

    run.cycleSpeed();
    expect(run.speed()).toBe(4);

    run.cycleSpeed();
    expect(run.speed()).toBe(0.5);
    expect(run.animMs()).toBe(900); // 450 / 0.5

    run.cycleSpeed();
    expect(run.speed()).toBe(1); // wrapped back around
  });

  // ── Playback flag (no wall-clock — pause clears the timer) ──
  it('play / pause / togglePlay drive the playing flag', () => {
    // play() builds the trace when nothing has run yet.
    expect(run.hasRun()).toBe(false);
    run.play();
    expect(run.hasRun()).toBe(true);
    expect(run.playing()).toBe(true);
    run.pause();
    expect(run.playing()).toBe(false);

    // play() from the end rewinds to the first step.
    run.seek(run.total() - 1);
    expect(run.atEnd()).toBe(true);
    run.play();
    expect(run.stepNumber()).toBe(0);
    run.pause();

    // togglePlay flips the flag both ways.
    run.togglePlay();
    expect(run.playing()).toBe(true);
    run.togglePlay();
    expect(run.playing()).toBe(false);
  });

  // ── Entry switching ────────────────────────────────────────
  it('setEntry switches the running file and re-runs it', () => {
    files.files.set([
      { id: 'main', name: 'main.algo', content: 'a ← source()\n', notes: [] },
      { id: 'second', name: 'second.algo', content: 'c ← source()\n', notes: [] },
    ]);

    run.build(); // default entry is "main"
    expect(run.error()).toBeNull();
    expect(run.entryFile()?.id).toBe('main');
    run.seek(run.total() - 1); // the start step runs nothing yet — read the end state
    let names = run.vars().map((v) => v.name);
    expect(names).toContain('a');
    expect(names).not.toContain('c');

    run.setEntry('second'); // switches entry and rebuilds
    expect(run.entryFile()?.id).toBe('second');
    expect(run.hasRun()).toBe(true);
    expect(run.atStart()).toBe(true);
    run.seek(run.total() - 1);
    names = run.vars().map((v) => v.name);
    expect(names).toContain('c');
    expect(names).not.toContain('a');
  });

  // ── Run-canvas topology mirrors the live canvas, then the trace ──
  it('mirrors the live canvas before a run, with no trace yet', () => {
    expect(run.hasRun()).toBe(false);
    expect(run.graphNodes().map((n) => n.label)).toEqual(['A', 'B']);
    expect(run.graphEdges()).toHaveLength(1);
    expect(run.runDataNodes().map((d) => d.label).sort()).toEqual(['dist', 'visited']);
  });

  it('draws graph create / delete per step (topology is snapshotted)', () => {
    files.setContent(
      'clearGraph()\n' + //          1
        'a ← createNode(0, 0, "P")\n' + // 2
        'b ← createNode(10, 0, "Q")\n' + //3
        'createEdge(a, b, 3)\n' + //   4
        'deleteNode(b)\n', //         5
    );
    run.build();
    expect(run.error()).toBeNull();

    // The start step still shows the original seeded graph (before clearGraph).
    run.seek(0);
    expect(run.graphNodes().map((n) => n.label)).toEqual(['A', 'B']);

    // After the edge is added, both created vertices and the edge are present.
    run.seek(indexOfLine(4));
    expect(run.graphNodes().map((n) => n.label)).toEqual(['P', 'Q']);
    expect(run.graphEdges()).toHaveLength(1);

    // The deletion removes the vertex and its incident edge.
    run.seek(run.total() - 1);
    expect(run.graphNodes().map((n) => n.label)).toEqual(['P']);
    expect(run.graphEdges()).toHaveLength(0);
  });

  it('runDataNodes draws only rendered structures; the panel feed keeps the hidden one', () => {
    files.setContent('m ← panel.createMap("hidden")\nvisited.add(source())\n');
    run.build();
    run.seek(run.total() - 1);

    // panel.createMap is tracked (panel feed) but off-canvas (not rendered).
    expect(run.runDataNodes().map((d) => d.label).sort()).toEqual(['dist', 'visited']);
    expect(run.dataState().map((d) => d.label).sort()).toEqual(['dist', 'hidden', 'visited']);
  });

  // ── Canvas effect views ────────────────────────────────────
  it('exposes marks, edge marks, labels and the snackbar message of the current step', () => {
    files.setContent(
      'a ← source()\n' + //              1  A
        'b ← neighbors(a)[0]\n' + //     2  B
        'mark(a, "success")\n' + //      3  vertex A
        'mark(a, b, "danger")\n' + //    4  edge A→B
        'setLabel(a, "start")\n' + //    5
        'showMessage("hello", "info")\n', // 6
    );
    run.build();
    expect(run.error()).toBeNull();
    run.seek(run.total() - 1);

    expect(run.marks()).toEqual({ A: 'success' });
    expect(run.markOf('A')).toBe('success');
    expect(run.markOf('B')).toBeNull(); // B was never marked as a vertex

    const edgeAB: GEdge = {
      id: 'e1',
      outputId: makeOutputPort('A'),
      inputId: makeInputPort('B'),
      weight: 1,
      directed: true,
    };
    expect(run.edgeMarks()).toEqual({ 'A->B': 'danger' });
    expect(run.edgeMarkOf(edgeAB)).toBe('danger');

    expect(run.labels()).toEqual({ A: 'start' });
    expect(run.message()).toEqual({ text: 'hello', type: 'info' });
  });

  it('exposes the active loop frame, its windowed rows and the iteration cursor', () => {
    files.setContent('for each u in graph.nodes() do\n  mark(u)\nend\n');
    run.build();
    expect(run.error()).toBeNull();

    // Find the step that sits on the loop's first element.
    let at = -1;
    for (let k = 0; k < run.total(); k++) {
      run.seek(k);
      if (run.loop() && run.loop()!.index === 0) {
        at = k;
        break;
      }
    }
    expect(at).toBeGreaterThanOrEqual(0);

    run.seek(at);
    const frame = run.loop()!;
    expect(frame.varName).toBe('u');
    expect(frame.items).toEqual(['A', 'B']); // the two seeded vertices, in order
    expect(run.loopRows()).toEqual([
      { index: 0, item: 'A' },
      { index: 1, item: 'B' },
    ]);
    expect(run.cursorSet().has('A')).toBe(true); // current vertex is the cursor

    // Once the loop has finished there is no frame and no popup rows.
    run.seek(run.total() - 1);
    expect(run.loop()).toBeNull();
    expect(run.loopRows()).toEqual([]);
  });

  it('collects printDebug output, tagged with its source line', () => {
    files.setContent('a ← source()\nprintDebug("from " + a)\n');
    run.build();
    expect(run.debug()).toEqual([{ line: 2, text: 'from A' }]);
  });

  // ── Change highlighting across the data panel's kinds ──────
  it('flags additions to a set / map / pqueue / matrix and a changed var', () => {
    canvas.load({
      nodes: [{ id: 'A', kind: 'START', label: 'A', position: { x: 0, y: 0 } }],
      edges: [],
      dataNodes: [
        makeDataNode('SET', 'ds-seen', { x: 0, y: 0 }, 'seen'),
        makeDataNode('MAP', 'ds-map', { x: 0, y: 0 }, 'dist'),
        makeDataNode('PQUEUE', 'ds-pq', { x: 0, y: 0 }, 'pq'),
        makeDataNode('MATRIX', 'ds-grid', { x: 0, y: 0 }, 'grid'),
      ],
    });
    files.setContent(
      'a ← source()\n' + //   1  A
        'n ← 1\n' + //        2
        'seen.add(a)\n' + //  3  set grows by A
        'dist[a] ← 5\n' + //  4  map gains key A
        'pq.push(a, 2)\n' + //5  heap gains (A, 2)
        'grid[0][0] ← 7\n' + //6  matrix row 0 changes
        'n ← n + 1\n', //     7  var n: 1 → 2
    );
    run.build();
    expect(run.error()).toBeNull();

    run.seek(indexOfLine(3));
    expect(run.dataChanged('ds-seen')).toBe(true);
    expect(run.itemChanged('ds-seen', 'A')).toBe(true);
    expect(run.dataChanged('ds-map')).toBe(false); // untouched this step

    run.seek(indexOfLine(4));
    expect(run.dataChanged('ds-map')).toBe(true);
    expect(run.entryChanged('ds-map', 'A')).toBe(true);
    expect(run.dataChanged('ds-seen')).toBe(false);

    run.seek(indexOfLine(5));
    expect(run.dataChanged('ds-pq')).toBe(true);
    expect(run.heapChanged('ds-pq', { value: 'A', priority: 2 })).toBe(true);

    run.seek(indexOfLine(6));
    expect(run.dataChanged('ds-grid')).toBe(true);
    expect(run.rowChanged('ds-grid', 0)).toBe(true);

    run.seek(indexOfLine(7));
    expect(run.varChanged('n')).toBe(true);
    expect(run.varChanged('a')).toBe(false);
  });
});
