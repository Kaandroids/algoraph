import { describe, it, expect } from 'vitest';
import { API_GROUP, apiGroupMembers, dataMembers, buildEditorGlobals } from './editor-globals';
import { GLOBAL_REFERENCE } from '../node-api';
import { DATA_STRUCTURES, makeDataNode } from '../models/data-structure.model';
import type { LocalStructure } from '../lang/locals';

describe('API_GROUP magic titles', () => {
  it('pins the exact group-title literals', () => {
    expect(API_GROUP).toEqual({
      graph: 'Graph access',
      visualization: 'Visualization',
      canvasEditing: 'Canvas editing',
      scratch: 'Scratch structures',
      panel: 'Panel structures',
    });
  });

  it('every title actually matches a group in the global reference (no drift)', () => {
    const titles = GLOBAL_REFERENCE.groups.map((g) => g.title);
    for (const title of Object.values(API_GROUP)) {
      expect(titles, title).toContain(title);
      // …and resolving it yields real members, proving the literal is live.
      expect(apiGroupMembers(title).length, title).toBeGreaterThan(0);
    }
  });
});

describe('apiGroupMembers', () => {
  it('maps a signature to its full autocomplete entry', () => {
    const members = apiGroupMembers(API_GROUP.graph);
    const weight = members.find((m) => m.label === 'weight');
    expect(weight).toEqual({
      label: 'weight',
      detail: ': number',
      info: 'Weight of edge u → v. · O(1)',
      apply: 'weight(u, v)',
    });
  });

  it('turns a no-arg call into a `name()` apply with its return type', () => {
    const nodes = apiGroupMembers(API_GROUP.graph).find((m) => m.label === 'nodes');
    expect(nodes).toEqual({
      label: 'nodes',
      detail: ': list<vertex>',
      info: 'Every vertex on the canvas. · O(V)',
      apply: 'nodes()',
    });
  });

  it('deduplicates overloaded names — `mark` appears once', () => {
    const labels = apiGroupMembers(API_GROUP.visualization).map((m) => m.label);
    expect(labels.filter((l) => l === 'mark')).toHaveLength(1);
  });

  it('returns an empty list for an unknown group title', () => {
    expect(apiGroupMembers('Does not exist')).toEqual([]);
  });
});

describe('dataMembers', () => {
  it('lists a kind’s members in order, skipping bracket / phrase signatures', () => {
    // `arr[int i]` and `for each value x in arr` have no member name → skipped.
    expect(dataMembers('LIST').map((m) => m.label)).toEqual([
      'name',
      'type',
      'push',
      'pop',
      'insert',
      'removeAt',
      'contains',
      'indexOf',
      'size',
      'isEmpty',
      'clear',
    ]);
  });

  it('renders a property (no cost) as a bare-name apply with desc as info', () => {
    const name = dataMembers('STACK').find((m) => m.label === 'name');
    expect(name).toEqual({
      label: 'name',
      detail: ': string',
      info: 'Unique identifier used to refer to this node in pseudocode.',
      apply: 'name',
    });
  });

  it('keeps each method only once across the kind’s groups', () => {
    const labels = dataMembers('STACK').map((m) => m.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('buildEditorGlobals', () => {
  it('always starts with the four global namespaces', () => {
    const globals = buildEditorGlobals([], []);
    expect(globals.map((g) => g.name)).toEqual(['graph', 'canvas', 'scratch', 'panel']);
    expect(globals.map((g) => g.type)).toEqual(['Graph', 'Canvas', 'Scratch', 'Panel']);
  });

  it('merges the canvas namespace from visualization + canvas-editing members', () => {
    const canvas = buildEditorGlobals([], []).find((g) => g.name === 'canvas')!;
    const expected =
      apiGroupMembers(API_GROUP.visualization).length + apiGroupMembers(API_GROUP.canvasEditing).length;
    expect(canvas.members).toHaveLength(expected);
  });

  it('appends a placed data node with its tag as the type and its kind’s members', () => {
    const node = makeDataNode('STACK', 'd1', { x: 0, y: 0 }, 'frontier');
    const globals = buildEditorGlobals([node], []);
    const frontier = globals.find((g) => g.name === 'frontier')!;
    expect(frontier.type).toBe(DATA_STRUCTURES.STACK.tag); // 'Stack'
    expect(frontier.members).toEqual(dataMembers('STACK'));
    expect(globals).toHaveLength(5);
  });

  it('drops a code-created local whose name a placed node already covers', () => {
    const node = makeDataNode('STACK', 'd1', { x: 0, y: 0 }, 'frontier');
    const locals: LocalStructure[] = [
      { name: 'frontier', kind: 'QUEUE' }, // shadowed by the placed Stack
      { name: 'aux', kind: 'SET' }, // unique → kept
    ];
    const globals = buildEditorGlobals([node], locals);
    const names = globals.map((g) => g.name);
    expect(names.filter((n) => n === 'frontier')).toHaveLength(1);
    expect(globals.find((g) => g.name === 'frontier')!.type).toBe('Stack');
    expect(globals.find((g) => g.name === 'aux')!.type).toBe('Set');
  });
});
