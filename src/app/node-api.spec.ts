import { describe, it, expect } from 'vitest';
import {
  DATA_STRUCTURE_API,
  GRAPH_NODE_API,
  EDGE_API,
  GLOBAL_REFERENCE,
  memberName,
  signatureApply,
  type ApiGroup,
  type ApiMember,
} from './node-api';
import { DATA_STRUCTURE_KINDS } from './models/data-structure.model';
import { BUILTINS } from './lang/builtins';

/** Every group across every catalogue, flattened for blanket invariant checks. */
function allGroups(): ApiGroup[] {
  return [
    ...Object.values(DATA_STRUCTURE_API).flat(),
    ...Object.values(GRAPH_NODE_API).flat(),
    ...EDGE_API,
    ...GLOBAL_REFERENCE.groups,
  ];
}

function allMembers(): ApiMember[] {
  return allGroups().flatMap((g) => g.members);
}

describe('node-api structural invariants', () => {
  it('gives every group a title and at least one member', () => {
    for (const g of allGroups()) {
      expect(g.title, JSON.stringify(g)).toBeTruthy();
      expect(Array.isArray(g.members)).toBe(true);
      expect(g.members.length, g.title).toBeGreaterThan(0);
    }
  });

  it('gives every member a non-empty signature and description', () => {
    for (const m of allMembers()) {
      expect(typeof m.sig).toBe('string');
      expect(m.sig.trim().length, JSON.stringify(m)).toBeGreaterThan(0);
      expect(typeof m.desc).toBe('string');
      expect(m.desc.trim().length, m.sig).toBeGreaterThan(0);
    }
  });

  it('formats every declared cost as a Big-O expression', () => {
    for (const m of allMembers()) {
      if (m.cost !== undefined) {
        expect(m.cost, m.sig).toMatch(/^O\(/);
      }
    }
  });

  it('uses a non-empty return type wherever one is declared', () => {
    for (const m of allMembers()) {
      if (m.returns !== undefined) {
        expect(m.returns.trim().length, m.sig).toBeGreaterThan(0);
      }
    }
  });
});

describe('DATA_STRUCTURE_API', () => {
  it('documents every data-structure kind', () => {
    for (const kind of DATA_STRUCTURE_KINDS) {
      expect(DATA_STRUCTURE_API[kind], kind).toBeDefined();
      expect(DATA_STRUCTURE_API[kind].length, kind).toBeGreaterThan(0);
    }
  });

  it('has no catalogue entries for unknown kinds', () => {
    const known = new Set<string>(DATA_STRUCTURE_KINDS);
    for (const key of Object.keys(DATA_STRUCTURE_API)) {
      expect(known.has(key), key).toBe(true);
    }
  });

  it('leads each kind with a Properties group exposing name + type', () => {
    for (const kind of DATA_STRUCTURE_KINDS) {
      const props = DATA_STRUCTURE_API[kind][0];
      expect(props.title, kind).toBe('Properties');
      const sigs = props.members.map((m) => m.sig);
      expect(sigs, kind).toContain('name');
      expect(sigs, kind).toContain('type');
    }
  });
});

describe('GRAPH_NODE_API', () => {
  it('documents the plain, Start and Goal vertex kinds', () => {
    expect(Object.keys(GRAPH_NODE_API).sort()).toEqual(['GOAL', 'NODE', 'START']);
  });

  it('gives every graph-node kind a non-empty group list', () => {
    for (const [kind, groups] of Object.entries(GRAPH_NODE_API)) {
      expect(groups.length, kind).toBeGreaterThan(0);
    }
  });

  it('exposes source()/goal() helpers on Start/Goal respectively', () => {
    const startSigs = GRAPH_NODE_API['START'].flatMap((g) => g.members.map((m) => m.sig));
    const goalSigs = GRAPH_NODE_API['GOAL'].flatMap((g) => g.members.map((m) => m.sig));
    expect(startSigs.some((s) => s.startsWith('source('))).toBe(true);
    expect(goalSigs.some((s) => s.startsWith('goal('))).toBe(true);
  });
});

describe('EDGE_API', () => {
  it('is a non-empty list of well-formed groups', () => {
    expect(EDGE_API.length).toBeGreaterThan(0);
    const sigs = EDGE_API.flatMap((g) => g.members.map((m) => m.sig));
    expect(sigs).toContain('e.weight');
    expect(sigs).toContain('e.isDirected');
  });
});

describe('GLOBAL_REFERENCE', () => {
  it('carries the modal header metadata', () => {
    expect(GLOBAL_REFERENCE.eyebrow).toBeTruthy();
    expect(GLOBAL_REFERENCE.label).toBeTruthy();
    expect(GLOBAL_REFERENCE.icon).toBeTruthy();
    expect(GLOBAL_REFERENCE.color).toBeTruthy();
    expect(GLOBAL_REFERENCE.description).toBeTruthy();
    expect(GLOBAL_REFERENCE.groups.length).toBeGreaterThan(0);
  });

  it('uses a design-token colour, never a hard-coded hex', () => {
    expect(GLOBAL_REFERENCE.color).toMatch(/^var\(--/);
  });
});

describe('builtins ↔ docs cross-check (catches doc drift)', () => {
  /** Function names that GLOBAL_REFERENCE documents with their own signature. */
  const documented = new Set(
    GLOBAL_REFERENCE.groups
      .flatMap((g) => g.members.map((m) => memberName(m.sig)))
      .filter((n): n is string => n !== null),
  );

  // inDegree / outDegree have no signature of their own — they are folded into
  // the `degree(vertex u)` entry's prose ("also inDegree / outDegree").
  const KNOWN_UNDOCUMENTED = new Set(['inDegree', 'outDegree']);

  it('documents every built-in that is meant to have its own signature', () => {
    const missing = BUILTINS.map((b) => b.name).filter(
      (name) => !KNOWN_UNDOCUMENTED.has(name) && !documented.has(name),
    );
    expect(missing).toEqual([]);
  });

  it('still mentions the undocumented built-ins in the degree entry prose', () => {
    const text = GLOBAL_REFERENCE.groups.flatMap((g) => g.members).map((m) => m.desc).join(' ');
    for (const name of KNOWN_UNDOCUMENTED) {
      expect(text, name).toContain(name);
    }
  });
});

describe('memberName', () => {
  it('extracts the method name from a dotted call', () => {
    expect(memberName('pq.push(value x, number p)')).toBe('push');
    expect(memberName('arr.indexOf(value x)')).toBe('indexOf');
    expect(memberName('m.keys()')).toBe('keys');
  });

  it('extracts the function name from a bare call', () => {
    expect(memberName('size()')).toBe('size');
    expect(memberName('createNode(number x, number y, string name?)')).toBe('createNode');
  });

  it('returns a bare property name unchanged', () => {
    expect(memberName('name')).toBe('name');
    expect(memberName('type')).toBe('type');
  });

  it('returns null for non-member forms (indexing, membership, prose)', () => {
    expect(memberName('arr[int i]')).toBeNull();
    expect(memberName('value x in s')).toBeNull();
    expect(memberName('M[int i][int j]')).toBeNull();
    expect(memberName('for each value x in arr')).toBeNull();
  });
});

describe('signatureApply', () => {
  it('fills a call template with the trailing parameter names', () => {
    expect(signatureApply('pq.push(value x, number p)')).toBe('push(x, p)');
    expect(signatureApply('createNode(number x, number y, string name?)')).toBe(
      'createNode(x, y, name)',
    );
    expect(signatureApply('M.setLabels(list rows, list cols?)')).toBe('setLabels(rows, cols)');
  });

  it('keeps the parens for a zero-arg call', () => {
    expect(signatureApply('size()')).toBe('size()');
    expect(signatureApply('clearMarks()')).toBe('clearMarks()');
  });

  it('inserts just the name for a property', () => {
    expect(signatureApply('name')).toBe('name');
  });

  it('returns null for non-member signatures', () => {
    expect(signatureApply('arr[int i]')).toBeNull();
    expect(signatureApply('value x in s')).toBeNull();
  });
});
