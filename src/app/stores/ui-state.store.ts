import { Injectable, signal } from '@angular/core';

/**
 * Transient chrome state for the workspace shell — rail collapse, panel sizes,
 * context-menu and modal visibility, the library search box. None of it is domain
 * state (the graph, files and run trace live in their own stores) and none of it
 * persists; pulling it out of the root component keeps that component focused on
 * orchestration rather than owning a grab-bag of UI flags.
 *
 * Note: the node/edge *editor* state (which name is being edited, the live draft,
 * validity) deliberately stays on the component — it's coupled to the canvas model
 * through computeds and belongs with the canvas-editing behaviour.
 */
@Injectable({ providedIn: 'root' })
export class UIStateStore {
  // ── Rails & panels ──
  readonly railCollapsed = signal(false);
  readonly codeRailCollapsed = signal(false);
  readonly runDataCollapsed = signal(false);
  readonly runCodeCollapsed = signal(false);
  /** Width of the Run code rail (px), adjustable by dragging its left edge. */
  readonly runCodeWidth = signal(320);
  /** True while the user is dragging a panel's resize handle. */
  readonly resizing = signal(false);
  /** Whether the Algorithm view's bottom debug panel (printDebug output) is expanded. */
  readonly debugOpen = signal(false);
  /** Height (px) of the expanded debug panel — drag its top edge to resize. */
  readonly debugHeight = signal(180);

  // ── Library rail ──
  readonly librarySearch = signal('');
  /** The library entry whose card is expanded, or null. */
  readonly expandedLib = signal<string | null>(null);

  // ── Context menus ──
  readonly ctxMenuOpen = signal(false);
  readonly ctxMenuPos = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  readonly nodeCtxMenuOpen = signal(false);
  readonly nodeCtxMenuPos = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  readonly nodeCtxTarget = signal<string | null>(null);
  /** Whether the open node context menu targets a graph vertex or a data-structure node. */
  readonly nodeCtxKind = signal<'graph' | 'data'>('graph');

  // ── Modals ──
  readonly tipsOpen = signal(false);
  readonly syntaxOpen = signal(false);
  readonly exportOpen = signal(false);
  readonly importOpen = signal(false);
}
