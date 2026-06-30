import { describe, it, expect } from 'vitest';
import { MAIN_SRC, HELPERS_SRC } from './algo-file.model';

/**
 * `MAIN_SRC` / `HELPERS_SRC` are the Dijkstra seed the workspace and the lang
 * tests build on. compile.spec.ts proves they parse with no diagnostics; here we
 * lock the surface-level invariants that keep them valid DSL — non-empty, the
 * arrow operator (never the `<-` ASCII shorthand), and the landmarks each one is
 * expected to contain.
 */
describe('algo-file seed sources', () => {
  it('are non-empty multi-line strings', () => {
    for (const [name, src] of [
      ['MAIN_SRC', MAIN_SRC],
      ['HELPERS_SRC', HELPERS_SRC],
    ] as const) {
      expect(typeof src, name).toBe('string');
      expect(src.trim().length, name).toBeGreaterThan(0);
      expect(src.split('\n').length, name).toBeGreaterThan(1);
    }
  });

  it('use the ← assignment operator, never the <- shorthand', () => {
    for (const src of [MAIN_SRC, HELPERS_SRC]) {
      expect(src).toContain('←');
      expect(src).not.toContain('<-');
    }
  });

  describe('MAIN_SRC (Dijkstra entry)', () => {
    it('seeds from the Start vertex and initialises distances', () => {
      expect(MAIN_SRC).toContain('source()');
      expect(MAIN_SRC).toContain('dist[s] ← 0');
      expect(MAIN_SRC).toContain('INFINITY');
    });

    it('runs the main loop and delegates relaxation to the helper', () => {
      expect(MAIN_SRC).toContain('while not pq.isEmpty() do');
      expect(MAIN_SRC).toContain('for each vertex u in nodes() do');
      expect(MAIN_SRC).toContain('relax(u, v)');
    });

    it('balances its do/then blocks with end', () => {
      const opens =
        (MAIN_SRC.match(/\bdo\b/g) ?? []).length + (MAIN_SRC.match(/\bthen\b/g) ?? []).length;
      const ends = (MAIN_SRC.match(/\bend\b/g) ?? []).length;
      expect(ends).toBe(opens);
    });
  });

  describe('HELPERS_SRC (relax module)', () => {
    it('exports the relax(u, v) helper', () => {
      expect(HELPERS_SRC).toContain('export function relax(u, v) do');
    });

    it('relaxes against the current best distance', () => {
      expect(HELPERS_SRC).toContain('alt ← dist[u] + weight(u, v)');
      expect(HELPERS_SRC).toContain('if alt < dist[v] then');
      expect(HELPERS_SRC).toContain('pq.push(v, alt)');
    });

    it('balances its do/then blocks with end', () => {
      const opens =
        (HELPERS_SRC.match(/\bdo\b/g) ?? []).length + (HELPERS_SRC.match(/\bthen\b/g) ?? []).length;
      const ends = (HELPERS_SRC.match(/\bend\b/g) ?? []).length;
      expect(ends).toBe(opens);
    });
  });
});
