/**
 * Camera control for the graph canvas — zoom, middle-mouse panning, the
 * screen→canvas coordinate mapping, and the Run workspace's animated
 * scroll-to-vertex/edge follow.
 *
 * This is the imperative Foblex + DOM work the App component would otherwise
 * carry directly. The component keeps the Angular glue (the reactive effects and
 * `@HostListener`s) and delegates each one here; it owns the `zoomLevel` /
 * `panning` signals through this controller (re-exposed as a facade).
 */
import { signal } from '@angular/core';
import type { FCanvasComponent } from '@foblex/flow';
import type { GEdge } from './models/graph.model';
import type { ScrollTarget } from './lang/trace';

export class CanvasViewport {
  /** Current zoom as a percentage (100 = 1:1), shown in the toolbar. */
  readonly zoomLevel = signal(100);
  /** True while a middle-mouse pan drag is in progress (drives the cursor). */
  readonly panning = signal(false);

  /** Canvas translation reported by the last Foblex change — for screen→canvas mapping. */
  private currentPos = { x: 0, y: 0 };
  // Middle-mouse pan drag state.
  private panStart = { x: 0, y: 0 };
  private posStart = { x: 0, y: 0 };
  private lastPanPos = { x: 0, y: 0 };
  /** Cleared/reset whenever a new `scrollTo` pan begins (see `followScroll`). */
  private panTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly getCanvas: () => FCanvasComponent | undefined,
  ) {}

  // ── Zoom ──────────────────────────────────────────────────
  private center(): { x: number; y: number } {
    const wrap = this.host.querySelector('.ae-canvas-wrap') as HTMLElement | null;
    if (!wrap) return { x: 0, y: 0 };
    const r = wrap.getBoundingClientRect();
    return { x: r.width / 2, y: r.height / 2 };
  }

  private zoomBy(delta: number): void {
    const canvas = this.getCanvas();
    if (!canvas) return;
    const current = canvas.getScale();
    const next = Math.min(3, Math.max(0.2, Math.round((current + delta) * 10) / 10));
    if (next === current) return;
    canvas.setScale(next, this.center());
    canvas.redrawWithAnimation();
    this.zoomLevel.set(Math.round(next * 100));
  }

  zoomIn(): void {
    this.zoomBy(0.1);
  }
  zoomOut(): void {
    this.zoomBy(-0.1);
  }
  reset(): void {
    const canvas = this.getCanvas();
    if (!canvas) return;
    canvas.resetScaleAndCenter(true);
    this.zoomLevel.set(100);
  }

  // ── Middle-mouse pan ──────────────────────────────────────
  /** Hold the middle mouse button and drag to pan (left-drag already pans via Foblex). */
  startPan(event: MouseEvent): void {
    if (event.button !== 1) return; // middle button only
    event.preventDefault();
    const canvas = this.getCanvas();
    this.panStart = { x: event.clientX, y: event.clientY };
    this.posStart = canvas ? { ...canvas.getPosition() } : { ...this.lastPanPos };
    this.panning.set(true);
  }

  movePan(event: MouseEvent): void {
    if (!this.panning()) return;
    const canvas = this.getCanvas();
    if (!canvas) return;
    const newPos = {
      x: this.posStart.x + (event.clientX - this.panStart.x),
      y: this.posStart.y + (event.clientY - this.panStart.y),
    };
    this.lastPanPos = newPos;
    canvas._setPosition(newPos);
    canvas.redraw();
    canvas.emitCanvasChangeEvent();
  }

  endPan(): void {
    if (this.panning()) this.panning.set(false);
  }

  // ── Foblex change + coordinate mapping ────────────────────
  onCanvasChange(scale: number, position: { x: number; y: number }): void {
    this.zoomLevel.set(Math.round(scale * 100));
    this.currentPos = position;
  }

  /** Map a screen point to canvas coordinates, given the canvas wrapper's rect. */
  toCanvasCoords(clientX: number, clientY: number, wrap: DOMRect): { x: number; y: number } {
    const scale = this.zoomLevel() / 100;
    return {
      x: (clientX - wrap.left - this.currentPos.x) / scale,
      y: (clientY - wrap.top - this.currentPos.y) / scale,
    };
  }

  // ── Run-canvas scroll follow (the `scrollTo` built-in) ────
  /**
   * Pan the Run canvas to a vertex or the midpoint of an edge. Foblex's animated
   * centring eases but only over 150 ms (reads as a snap), so we briefly tag the
   * canvas with `is-scrolling`, whose CSS stretches the transform transition to a
   * perceptible, speed-scaled duration, then drop the tag.
   */
  followScroll(target: ScrollTarget, animMs: number, edges: readonly GEdge[]): void {
    const canvas = this.getCanvas();
    if (!canvas) return;
    const host = this.host.querySelector('.ag-runcanvas f-canvas') as HTMLElement | null;
    if (host) {
      const ms = Math.round(animMs * 1.4); // a touch longer than the effect fades
      host.style.setProperty('--run-pan', `${ms}ms`);
      host.classList.add('is-scrolling');
      if (this.panTimer !== null) clearTimeout(this.panTimer);
      this.panTimer = setTimeout(() => host.classList.remove('is-scrolling'), ms + 120);
    }
    try {
      if (target.kind === 'edge') this.panToEdge(canvas, target.from, target.to, edges);
      else canvas.centerGroupOrNode(target.id, true);
    } catch {
      // A node may not be laid out yet; ignore and let the next step retry.
    }
  }

  /**
   * Centre the canvas on an edge by its weight badge. Foblex only centres a node
   * by id, so we pan by the screen delta that brings the badge to the viewport
   * centre (exact at any zoom). Falls back to centring the head vertex.
   */
  private panToEdge(canvas: FCanvasComponent, from: string, to: string, edges: readonly GEdge[]): void {
    const edge = edges.find((e) => {
      const s = e.outputId.replace(/-out$/, '');
      const t = e.inputId.replace(/-in$/, '');
      return (s === from && t === to) || (s === to && t === from);
    });
    const flow = this.host.querySelector('.ag-runcanvas f-flow') as HTMLElement | null;
    const badge = edge
      ? (this.host.querySelector(`.ag-runcanvas .ag-edge-badge[data-edge="${edge.id}"]`) as HTMLElement | null)
      : null;
    if (!flow || !badge) {
      canvas.centerGroupOrNode(to, true);
      return;
    }
    const b = badge.getBoundingClientRect();
    const f = flow.getBoundingClientRect();
    const pos = canvas.getPosition();
    canvas._setPosition({
      x: pos.x + (f.left + f.width / 2 - (b.left + b.width / 2)),
      y: pos.y + (f.top + f.height / 2 - (b.top + b.height / 2)),
    });
    canvas.redraw();
  }
}
