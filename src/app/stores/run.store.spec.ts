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
});
