import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';
import '@angular/compiler'; // provides the JIT compiler for `Injector.create` under bare vitest
import { Injector } from '@angular/core';
import { LibraryStore } from './library.store';

// `LibraryStore` is a dependency-free `@Injectable` (no `inject()`; it only calls
// `fetch`), so a bare core `Injector` resolves a fresh instance per test without
// needing the Angular DOM testing platform — which `npx vitest run` can't wire up
// outside the `@angular/build:unit-test` harness.

/** Build a fake fetch that resolves to a Response-like object. */
function fakeFetch(body: { json?: unknown; text?: string }) {
  return vi.fn(async () => ({
    json: async () => body.json,
    text: async () => body.text ?? '',
  })) as unknown as typeof fetch;
}

describe('LibraryStore', () => {
  let store: LibraryStore;

  beforeEach(() => {
    store = Injector.create({ providers: [LibraryStore] }).get(LibraryStore);
  });

  // ── index() ───────────────────────────────────────────────
  describe('index', () => {
    it('fetches and returns the manifest', async () => {
      globalThis.fetch = fakeFetch({
        json: {
          algorithm: [{ name: 'BFS', description: 'd', file: 'algorithm/bfs.json' }],
          canvas: [{ name: 'Grid', description: 'g', file: 'canvas/grid.json' }],
        },
      });
      const idx = await store.index();
      expect(idx.algorithm.length).toBe(1);
      expect(idx.algorithm[0].name).toBe('BFS');
      expect(idx.canvas.length).toBe(1);
      expect(globalThis.fetch).toHaveBeenCalledWith('library/index.json');
    });

    it('defaults missing sections to empty arrays', async () => {
      globalThis.fetch = fakeFetch({ json: {} });
      const idx = await store.index();
      expect(idx.algorithm).toEqual([]);
      expect(idx.canvas).toEqual([]);
    });

    it('caches the manifest after the first fetch', async () => {
      globalThis.fetch = fakeFetch({ json: { algorithm: [], canvas: [] } });
      await store.index();
      await store.index();
      await store.index();
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
  });

  // ── file() ────────────────────────────────────────────────
  describe('file', () => {
    it('fetches the raw text under the library path', async () => {
      globalThis.fetch = fakeFetch({ text: 'raw source' });
      const txt = await store.file('algorithm/bfs.algo');
      expect(txt).toBe('raw source');
      expect(globalThis.fetch).toHaveBeenCalledWith('library/algorithm/bfs.algo');
    });
  });

  // ── bundle() ──────────────────────────────────────────────
  describe('bundle', () => {
    it('fetches and returns a multi-file bundle', async () => {
      globalThis.fetch = fakeFetch({
        json: {
          files: [
            { name: 'main.algo', content: 'main' },
            { name: 'lib.algo', content: 'lib' },
          ],
        },
      });
      const b = await store.bundle('algorithm/bfs.json');
      expect(b.files.length).toBe(2);
      expect(b.files[0].name).toBe('main.algo');
      expect(globalThis.fetch).toHaveBeenCalledWith('library/algorithm/bfs.json');
    });

    it('defaults to an empty file list when none is present', async () => {
      globalThis.fetch = fakeFetch({ json: {} });
      const b = await store.bundle('algorithm/empty.json');
      expect(b.files).toEqual([]);
    });
  });
});
