import { describe, it, expect } from 'vitest';
import { compile } from './compile';
import { collectLocalStructures } from './locals';

/** Compile the files and return the entry's local structures as `name:KIND` strings. */
function locals(files: { id: string; name: string; content: string }[], entryId = 'main'): string[] {
  const compiled = compile(files);
  const module = compiled.modules.find((m) => m.fileId === entryId)!;
  return collectLocalStructures(module, compiled.functions)
    .map((l) => `${l.name}:${l.kind}`)
    .sort();
}

describe('local structure scan', () => {
  it('finds direct creations — literal name, assigned variable, canvas. prefix, matrix', () => {
    const src =
      'createList(0, 0, "testList")\n' +
      's ← createSet(0, 0)\n' +
      'canvas.createQueue(0, 0, "q")\n' +
      'createMatrix(0, 0, 3, 3, "grid")\n';
    expect(locals([{ id: 'main', name: 'main.algo', content: src }])).toEqual([
      'grid:MATRIX',
      'q:QUEUE',
      's:SET',
      'testList:LIST',
    ]);
  });

  it('follows a called function across files and counts its creations', () => {
    expect(
      locals([
        { id: 'main', name: 'main.algo', content: 'setup()\n' },
        { id: 'helpers', name: 'helpers.algo', content: 'export function setup() do\n  createMap(0, 0, "dist")\nend\n' },
      ]),
    ).toEqual(['dist:MAP']);
  });

  it('follows calls transitively', () => {
    const src =
      'a()\n' +
      'function a() do\n  b()\nend\n' +
      'function b() do\n  createPQueue(0, 0, "pq")\nend\n';
    expect(locals([{ id: 'main', name: 'main.algo', content: src }])).toEqual(['pq:PQUEUE']);
  });

  it('skips names that are not usable identifiers (spaces), but keeps the variable', () => {
    const src = 'createList(0, 0, "bad name")\nn ← createSet(0, 0, "also bad")\n';
    // The spaced labels can't be referenced by name; only the variable `n` can.
    expect(locals([{ id: 'main', name: 'main.algo', content: src }])).toEqual(['n:SET']);
  });

  it('ignores a function that is declared but never called', () => {
    const src =
      'function unused() do\n  createSet(0, 0, "never")\nend\n' +
      'createList(0, 0, "used")\n';
    expect(locals([{ id: 'main', name: 'main.algo', content: src }])).toEqual(['used:LIST']);
  });
});
