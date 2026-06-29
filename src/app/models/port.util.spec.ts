import { describe, it, expect } from 'vitest';
import { makeOutputPort, makeInputPort, sourceNodeId, targetNodeId } from './port.util';

describe('port.util', () => {
  describe('makeOutputPort / makeInputPort', () => {
    it('appends the "-out" / "-in" suffix to a vertex id', () => {
      expect(makeOutputPort('A')).toBe('A-out');
      expect(makeInputPort('A')).toBe('A-in');
    });

    it('works for multi-character ids', () => {
      expect(makeOutputPort('node-42')).toBe('node-42-out');
      expect(makeInputPort('node-42')).toBe('node-42-in');
    });
  });

  describe('sourceNodeId / targetNodeId', () => {
    it('strips the trailing "-out" / "-in" suffix', () => {
      expect(sourceNodeId('A-out')).toBe('A');
      expect(targetNodeId('A-in')).toBe('A');
    });

    it('returns ids without the matching suffix unchanged', () => {
      // sourceNodeId only strips "-out"; an input port id is left alone.
      expect(sourceNodeId('A-in')).toBe('A-in');
      // targetNodeId only strips "-in"; an output port id is left alone.
      expect(targetNodeId('A-out')).toBe('A-out');
      expect(sourceNodeId('A')).toBe('A');
      expect(targetNodeId('A')).toBe('A');
    });

    it('only strips the suffix, not "-out" / "-in" occurring mid-string', () => {
      // "-out" / "-in" appear inside the id but not at the end → untouched.
      expect(sourceNodeId('out-going')).toBe('out-going');
      expect(targetNodeId('in-bound')).toBe('in-bound');
      expect(sourceNodeId('a-out-b')).toBe('a-out-b');
      expect(targetNodeId('a-in-b')).toBe('a-in-b');
    });

    it('only strips a single trailing suffix occurrence', () => {
      // The regex is anchored to the end, so only the final "-out" / "-in" goes.
      expect(sourceNodeId('A-out-out')).toBe('A-out');
      expect(targetNodeId('A-in-in')).toBe('A-in');
    });
  });

  describe('round-trips', () => {
    it('source: sourceNodeId(makeOutputPort(id)) === id', () => {
      for (const id of ['A', 'B', 'node-42', 'x_y', '0']) {
        expect(sourceNodeId(makeOutputPort(id))).toBe(id);
      }
    });

    it('target: targetNodeId(makeInputPort(id)) === id', () => {
      for (const id of ['A', 'B', 'node-42', 'x_y', '0']) {
        expect(targetNodeId(makeInputPort(id))).toBe(id);
      }
    });

    it('round-trips an id that itself ends in "-out" / "-in"', () => {
      expect(sourceNodeId(makeOutputPort('foo-out'))).toBe('foo-out');
      expect(targetNodeId(makeInputPort('foo-in'))).toBe('foo-in');
    });
  });
});
