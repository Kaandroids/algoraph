import { Injectable } from '@angular/core';

/** One ready-made item in the bundled library (an algorithm file or a canvas). */
export interface LibraryEntry {
  /** Display name shown in the import modal. */
  name: string;
  /** One-line summary. */
  description: string;
  /** Path under `public/library/`, e.g. `algorithm/dijkstra.algo`. */
  file: string;
}

/** The library manifest — algorithms (`.algo`) and canvases (`.json`), kept apart by type. */
export interface LibraryIndex {
  algorithm: LibraryEntry[];
  canvas: LibraryEntry[];
}

/**
 * Reads the bundled library shipped under `public/library/`. A static SPA can't
 * list a folder over HTTP, so the available items live in a hand-kept manifest
 * (`index.json`); this store fetches that and the individual files on demand.
 * Paths are relative so they respect the app's `<base href>` (e.g. GitHub Pages).
 */
@Injectable({ providedIn: 'root' })
export class LibraryStore {
  private cachedIndex: LibraryIndex | null = null;

  /** Fetch (and cache) the manifest of library items. */
  async index(): Promise<LibraryIndex> {
    if (this.cachedIndex) return this.cachedIndex;
    const res = await fetch('library/index.json');
    const data = (await res.json()) as Partial<LibraryIndex>;
    this.cachedIndex = { algorithm: data.algorithm ?? [], canvas: data.canvas ?? [] };
    return this.cachedIndex;
  }

  /** Fetch the raw text of a library file (`.algo` source or canvas `.json`). */
  async file(path: string): Promise<string> {
    const res = await fetch(`library/${path}`);
    return res.text();
  }
}
