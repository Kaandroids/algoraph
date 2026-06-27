import { Injectable } from '@angular/core';
import type { LineNote } from '../editor/line-notes';

/** One ready-made item in the bundled library (an algorithm file or a canvas). */
export interface LibraryEntry {
  /** Display name shown in the import modal. */
  name: string;
  /** One-line summary. */
  description: string;
  /** Path under `public/library/`, e.g. `algorithm/dijkstra.algo` or `algorithm/bfs.json`. */
  file: string;
}

/** One source file inside a multi-file algorithm bundle. */
export interface BundleFile {
  name: string;
  content: string;
  /** Inline per-line explanations (shown collapsed, expand on click in the Run view). */
  notes?: LineNote[];
}

/** A multi-file algorithm: the clean entry file plus its helper modules. */
export interface AlgorithmBundle {
  files: BundleFile[];
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

  /** Fetch a multi-file algorithm bundle (`.json`): the entry file plus its modules. */
  async bundle(path: string): Promise<AlgorithmBundle> {
    const res = await fetch(`library/${path}`);
    const data = (await res.json()) as Partial<AlgorithmBundle>;
    return { files: data.files ?? [] };
  }
}
