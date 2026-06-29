import { describe, it, expect } from 'vitest';
import {
  GRAPH_PALETTE,
  nodeIcon,
  nodeColor,
  nodeTypeLabel,
  type NodeKind,
} from './graph.model';

const KINDS: NodeKind[] = ['NODE', 'START', 'GOAL'];

describe('nodeIcon', () => {
  it('returns the registered icon for each kind', () => {
    expect(nodeIcon('NODE')).toBe('circle');
    expect(nodeIcon('START')).toBe('play');
    expect(nodeIcon('GOAL')).toBe('target');
  });

  it('returns a non-empty icon for every kind', () => {
    for (const kind of KINDS) {
      expect(nodeIcon(kind)).toBeTruthy();
    }
  });
});

describe('nodeColor', () => {
  it('returns the registered accent colour for each kind', () => {
    expect(nodeColor('NODE')).toBe('oklch(0.58 0.13 65)');
    expect(nodeColor('START')).toBe('oklch(0.55 0.14 150)');
    expect(nodeColor('GOAL')).toBe('oklch(0.6 0.17 290)');
  });

  it('uses an oklch() colour token (no hard-coded hex) for every kind', () => {
    for (const kind of KINDS) {
      expect(nodeColor(kind)).toMatch(/^oklch\(/);
    }
  });

  it('gives every kind a distinct colour', () => {
    const colors = KINDS.map(nodeColor);
    expect(new Set(colors).size).toBe(KINDS.length);
  });
});

describe('nodeTypeLabel', () => {
  it('is the kind itself, shown in upper case', () => {
    expect(nodeTypeLabel('NODE')).toBe('NODE');
    expect(nodeTypeLabel('START')).toBe('START');
    expect(nodeTypeLabel('GOAL')).toBe('GOAL');
  });

  it('returns an already-upper-case label for every kind', () => {
    for (const kind of KINDS) {
      const label = nodeTypeLabel(kind);
      expect(label).toBe(label.toUpperCase());
    }
  });
});

describe('GRAPH_PALETTE', () => {
  it('has one entry per node kind, in registry order', () => {
    expect(GRAPH_PALETTE.map((p) => p.kind)).toEqual(KINDS);
  });

  it('carries the descriptor metadata for each item', () => {
    const byKind = new Map(GRAPH_PALETTE.map((p) => [p.kind, p]));

    expect(byKind.get('NODE')).toMatchObject({
      kind: 'NODE',
      label: 'Vertex',
      sub: 'A plain graph node',
      icon: 'circle',
      color: 'oklch(0.58 0.13 65)',
    });
    expect(byKind.get('START')).toMatchObject({
      kind: 'START',
      label: 'Start',
      sub: 'Source / entry node',
      icon: 'play',
    });
    expect(byKind.get('GOAL')).toMatchObject({
      kind: 'GOAL',
      label: 'Goal',
      sub: 'Target / destination',
      icon: 'target',
    });
  });

  it('exposes every field the palette UI renders, all non-empty', () => {
    for (const item of GRAPH_PALETTE) {
      expect(item.label).toBeTruthy();
      expect(item.sub).toBeTruthy();
      expect(item.icon).toBeTruthy();
      expect(item.color).toBeTruthy();
      expect(item.description).toBeTruthy();
    }
  });

  it('stays consistent with the icon/color helpers', () => {
    for (const item of GRAPH_PALETTE) {
      expect(item.icon).toBe(nodeIcon(item.kind));
      expect(item.color).toBe(nodeColor(item.kind));
    }
  });
});
