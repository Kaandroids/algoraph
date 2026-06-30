// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CanvasViewport } from './canvas-viewport';
import type { FCanvasComponent } from '@foblex/flow';
import type { GEdge } from './models/graph.model';
import type { ScrollTarget } from './lang/trace';

/**
 * `CanvasViewport` is pure imperative DOM + Foblex camera work, so we drive it in
 * jsdom against a hand-built host element and a stub canvas whose methods are
 * spies. Every method early-returns when `getCanvas()` is undefined, so each group
 * also exercises that no-canvas path. jsdom's `getBoundingClientRect` returns zeros;
 * where the geometry matters we monkeypatch a specific rect onto the element.
 */

/** A minimal stand-in for the Foblex canvas — every method is a spy. */
function makeFakeCanvas(scale = 1, position = { x: 0, y: 0 }) {
  return {
    getScale: vi.fn(() => scale),
    setScale: vi.fn(),
    redrawWithAnimation: vi.fn(),
    resetScaleAndCenter: vi.fn(),
    getPosition: vi.fn(() => ({ ...position })),
    _setPosition: vi.fn(),
    redraw: vi.fn(),
    emitCanvasChangeEvent: vi.fn(),
    centerGroupOrNode: vi.fn(),
  };
}
type FakeCanvas = ReturnType<typeof makeFakeCanvas>;

/** Build a detached host element with optional inner markup. */
function makeHost(html = ''): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

/** Cast a fake canvas to the Foblex type the controller expects. */
function asCanvas(c: FakeCanvas): FCanvasComponent {
  return c as unknown as FCanvasComponent;
}

/** A rect object literal that satisfies the parts the code reads. */
function rect(left: number, top: number, width = 0, height = 0): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('CanvasViewport', () => {
  // ── Zoom ──────────────────────────────────────────────────
  describe('zoomIn / zoomOut', () => {
    it('zooms in by one 0.1 step and updates the zoom level', () => {
      const canvas = makeFakeCanvas(1);
      const vp = new CanvasViewport(makeHost(), () => asCanvas(canvas));

      vp.zoomIn();

      expect(canvas.setScale).toHaveBeenCalledTimes(1);
      expect(canvas.setScale).toHaveBeenCalledWith(1.1, { x: 0, y: 0 });
      expect(canvas.redrawWithAnimation).toHaveBeenCalledTimes(1);
      expect(vp.zoomLevel()).toBe(110);
    });

    it('zooms out by one 0.1 step', () => {
      const canvas = makeFakeCanvas(1);
      const vp = new CanvasViewport(makeHost(), () => asCanvas(canvas));

      vp.zoomOut();

      expect(canvas.setScale).toHaveBeenCalledWith(0.9, { x: 0, y: 0 });
      expect(vp.zoomLevel()).toBe(90);
    });

    it('rounds the next scale to the nearest 0.1 step', () => {
      const canvas = makeFakeCanvas(1.04);
      const vp = new CanvasViewport(makeHost(), () => asCanvas(canvas));

      vp.zoomIn();

      // (1.04 + 0.1) -> round to 1.1, not 1.14.
      expect(canvas.setScale).toHaveBeenCalledWith(1.1, { x: 0, y: 0 });
      expect(vp.zoomLevel()).toBe(110);
    });

    it('clamps the upper bound to 3 (300%)', () => {
      const canvas = makeFakeCanvas(2.95);
      const vp = new CanvasViewport(makeHost(), () => asCanvas(canvas));

      vp.zoomIn();

      expect(canvas.setScale).toHaveBeenCalledWith(3, { x: 0, y: 0 });
      expect(vp.zoomLevel()).toBe(300);
    });

    it('clamps the lower bound to 0.2 (20%)', () => {
      const canvas = makeFakeCanvas(0.25);
      const vp = new CanvasViewport(makeHost(), () => asCanvas(canvas));

      vp.zoomOut();

      expect(canvas.setScale).toHaveBeenCalledWith(0.2, { x: 0, y: 0 });
      expect(vp.zoomLevel()).toBe(20);
    });

    it('is a no-op when the clamped next scale equals the current scale (at max)', () => {
      const canvas = makeFakeCanvas(3);
      const vp = new CanvasViewport(makeHost(), () => asCanvas(canvas));
      vp.zoomLevel.set(300);

      vp.zoomIn();

      expect(canvas.setScale).not.toHaveBeenCalled();
      expect(canvas.redrawWithAnimation).not.toHaveBeenCalled();
      expect(vp.zoomLevel()).toBe(300);
    });

    it('is a no-op when the clamped next scale equals the current scale (at min)', () => {
      const canvas = makeFakeCanvas(0.2);
      const vp = new CanvasViewport(makeHost(), () => asCanvas(canvas));

      vp.zoomOut();

      expect(canvas.setScale).not.toHaveBeenCalled();
    });

    it('centres the zoom on the wrapper midpoint when one is present', () => {
      const host = makeHost('<div class="ae-canvas-wrap"></div>');
      const wrap = host.querySelector('.ae-canvas-wrap') as HTMLElement;
      wrap.getBoundingClientRect = () => rect(0, 0, 200, 100);
      const canvas = makeFakeCanvas(1);
      const vp = new CanvasViewport(host, () => asCanvas(canvas));

      vp.zoomIn();

      expect(canvas.setScale).toHaveBeenCalledWith(1.1, { x: 100, y: 50 });
    });

    it('does nothing when there is no canvas', () => {
      const vp = new CanvasViewport(makeHost(), () => undefined);
      expect(() => vp.zoomIn()).not.toThrow();
      expect(vp.zoomLevel()).toBe(100);
    });
  });

  // ── Reset ─────────────────────────────────────────────────
  describe('reset', () => {
    it('resets scale + centre and snaps the zoom level back to 100', () => {
      const canvas = makeFakeCanvas(2);
      const vp = new CanvasViewport(makeHost(), () => asCanvas(canvas));
      vp.zoomLevel.set(250);

      vp.reset();

      expect(canvas.resetScaleAndCenter).toHaveBeenCalledWith(true);
      expect(vp.zoomLevel()).toBe(100);
    });

    it('does nothing when there is no canvas', () => {
      const vp = new CanvasViewport(makeHost(), () => undefined);
      vp.zoomLevel.set(250);
      vp.reset();
      expect(vp.zoomLevel()).toBe(250);
    });
  });

  // ── Middle-mouse pan ──────────────────────────────────────
  describe('startPan', () => {
    it('starts a pan only on the middle button and reads the canvas position', () => {
      const canvas = makeFakeCanvas(1, { x: 7, y: 9 });
      const vp = new CanvasViewport(makeHost(), () => asCanvas(canvas));
      const preventDefault = vi.fn();

      vp.startPan({ button: 1, clientX: 5, clientY: 6, preventDefault } as any);

      expect(vp.panning()).toBe(true);
      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(canvas.getPosition).toHaveBeenCalledTimes(1);
    });

    it('ignores non-middle buttons', () => {
      const canvas = makeFakeCanvas();
      const vp = new CanvasViewport(makeHost(), () => asCanvas(canvas));
      const preventDefault = vi.fn();

      vp.startPan({ button: 0, clientX: 5, clientY: 6, preventDefault } as any);

      expect(vp.panning()).toBe(false);
      expect(preventDefault).not.toHaveBeenCalled();
      expect(canvas.getPosition).not.toHaveBeenCalled();
    });

    it('falls back to the last pan position when there is no canvas', () => {
      const vp = new CanvasViewport(makeHost(), () => undefined);
      vp.startPan({ button: 1, clientX: 5, clientY: 6, preventDefault: vi.fn() } as any);
      expect(vp.panning()).toBe(true);
    });
  });

  describe('movePan', () => {
    it('translates the canvas by the drag delta while panning', () => {
      const canvas = makeFakeCanvas(1, { x: 5, y: 6 });
      const vp = new CanvasViewport(makeHost(), () => asCanvas(canvas));

      vp.startPan({ button: 1, clientX: 100, clientY: 200, preventDefault: vi.fn() } as any);
      vp.movePan({ clientX: 130, clientY: 240 } as any);

      // posStart {5,6} + (delta {30,40}) = {35,46}.
      expect(canvas._setPosition).toHaveBeenCalledWith({ x: 35, y: 46 });
      expect(canvas.redraw).toHaveBeenCalledTimes(1);
      expect(canvas.emitCanvasChangeEvent).toHaveBeenCalledTimes(1);
    });

    it('does nothing when not panning', () => {
      const canvas = makeFakeCanvas();
      const vp = new CanvasViewport(makeHost(), () => asCanvas(canvas));

      vp.movePan({ clientX: 1, clientY: 1 } as any);

      expect(canvas._setPosition).not.toHaveBeenCalled();
      expect(canvas.redraw).not.toHaveBeenCalled();
    });

    it('does nothing when panning but the canvas has gone away', () => {
      const vp = new CanvasViewport(makeHost(), () => undefined);
      vp.startPan({ button: 1, clientX: 0, clientY: 0, preventDefault: vi.fn() } as any);
      expect(() => vp.movePan({ clientX: 5, clientY: 5 } as any)).not.toThrow();
      expect(vp.panning()).toBe(true);
    });
  });

  describe('endPan', () => {
    it('clears the panning flag', () => {
      const canvas = makeFakeCanvas();
      const vp = new CanvasViewport(makeHost(), () => asCanvas(canvas));
      vp.startPan({ button: 1, clientX: 0, clientY: 0, preventDefault: vi.fn() } as any);
      expect(vp.panning()).toBe(true);

      vp.endPan();

      expect(vp.panning()).toBe(false);
    });

    it('stays cleared when called while not panning', () => {
      const vp = new CanvasViewport(makeHost(), () => makeFakeCanvas() as unknown as FCanvasComponent);
      vp.endPan();
      expect(vp.panning()).toBe(false);
    });
  });

  // ── Foblex change + coordinate mapping ────────────────────
  describe('onCanvasChange + toCanvasCoords', () => {
    it('stores the reported scale as a percentage zoom level', () => {
      const vp = new CanvasViewport(makeHost(), () => undefined);
      vp.onCanvasChange(2, { x: 10, y: 20 });
      expect(vp.zoomLevel()).toBe(200);
    });

    it('maps a screen point to canvas coordinates using the stored scale + position', () => {
      const vp = new CanvasViewport(makeHost(), () => undefined);
      vp.onCanvasChange(2, { x: 10, y: 20 });

      const coords = vp.toCanvasCoords(100, 50, rect(5, 5));

      // x = (100 - 5 - 10) / 2 = 42.5 ; y = (50 - 5 - 20) / 2 = 12.5
      expect(coords).toEqual({ x: 42.5, y: 12.5 });
    });

    it('uses an identity scale at 100% with no stored translation', () => {
      const vp = new CanvasViewport(makeHost(), () => undefined);
      const coords = vp.toCanvasCoords(30, 40, rect(0, 0));
      expect(coords).toEqual({ x: 30, y: 40 });
    });
  });

  // ── Run-canvas scroll follow ──────────────────────────────
  describe('followScroll', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const RUN_CANVAS_HTML = '<div class="ag-runcanvas"><f-canvas></f-canvas></div>';

    it('tags the run canvas as scrolling and centres on a node target', () => {
      const host = makeHost(RUN_CANVAS_HTML);
      const fcanvas = host.querySelector('.ag-runcanvas f-canvas') as HTMLElement;
      const canvas = makeFakeCanvas();
      const vp = new CanvasViewport(host, () => asCanvas(canvas));
      const target: ScrollTarget = { kind: 'node', id: 'A' };

      vp.followScroll(target, 100, []);

      expect(fcanvas.classList.contains('is-scrolling')).toBe(true);
      expect(fcanvas.style.getPropertyValue('--run-pan')).toBe('140ms');
      expect(canvas.centerGroupOrNode).toHaveBeenCalledWith('A', true);
    });

    it('drops the is-scrolling tag once the timer elapses', () => {
      const host = makeHost(RUN_CANVAS_HTML);
      const fcanvas = host.querySelector('.ag-runcanvas f-canvas') as HTMLElement;
      const canvas = makeFakeCanvas();
      const vp = new CanvasViewport(host, () => asCanvas(canvas));

      vp.followScroll({ kind: 'node', id: 'A' }, 100, []);
      expect(fcanvas.classList.contains('is-scrolling')).toBe(true);

      vi.advanceTimersByTime(140 + 120);
      expect(fcanvas.classList.contains('is-scrolling')).toBe(false);
    });

    it('clears a pending timer when a new follow begins', () => {
      const host = makeHost(RUN_CANVAS_HTML);
      const canvas = makeFakeCanvas();
      const vp = new CanvasViewport(host, () => asCanvas(canvas));

      vp.followScroll({ kind: 'node', id: 'A' }, 100, []);
      // Second call before the first timer fires must clear it without throwing.
      expect(() => vp.followScroll({ kind: 'node', id: 'B' }, 100, [])).not.toThrow();
      expect(canvas.centerGroupOrNode).toHaveBeenCalledTimes(2);
    });

    it('does nothing when there is no canvas', () => {
      const host = makeHost(RUN_CANVAS_HTML);
      const fcanvas = host.querySelector('.ag-runcanvas f-canvas') as HTMLElement;
      const vp = new CanvasViewport(host, () => undefined);

      vp.followScroll({ kind: 'node', id: 'A' }, 100, []);

      expect(fcanvas.classList.contains('is-scrolling')).toBe(false);
    });

    it('swallows an error thrown while centring', () => {
      const host = makeHost(RUN_CANVAS_HTML);
      const fcanvas = host.querySelector('.ag-runcanvas f-canvas') as HTMLElement;
      const canvas = makeFakeCanvas();
      canvas.centerGroupOrNode.mockImplementation(() => {
        throw new Error('not laid out yet');
      });
      const vp = new CanvasViewport(host, () => asCanvas(canvas));

      expect(() => vp.followScroll({ kind: 'node', id: 'A' }, 100, [])).not.toThrow();
      // The tag is applied before the (failing) centring attempt.
      expect(fcanvas.classList.contains('is-scrolling')).toBe(true);
    });

    it('still routes node targets when the run-canvas element is absent', () => {
      const canvas = makeFakeCanvas();
      const vp = new CanvasViewport(makeHost(), () => asCanvas(canvas));

      vp.followScroll({ kind: 'node', id: 'Z' }, 80, []);

      expect(canvas.centerGroupOrNode).toHaveBeenCalledWith('Z', true);
    });
  });

  // ── panToEdge (via the followScroll edge path) ────────────
  describe('followScroll → panToEdge', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const edges: GEdge[] = [
      { id: 'e1', outputId: 'A-out', inputId: 'B-in', weight: 5, directed: true },
    ];

    it('pans by the screen delta that brings the edge badge to centre', () => {
      const host = makeHost(
        '<div class="ag-runcanvas">' +
          '<f-canvas></f-canvas>' +
          '<f-flow></f-flow>' +
          '<span class="ag-edge-badge" data-edge="e1"></span>' +
          '</div>',
      );
      const flow = host.querySelector('.ag-runcanvas f-flow') as HTMLElement;
      const badge = host.querySelector('.ag-edge-badge') as HTMLElement;
      flow.getBoundingClientRect = () => rect(0, 0, 100, 100);
      badge.getBoundingClientRect = () => rect(10, 20, 4, 4);

      const canvas = makeFakeCanvas(1, { x: 1, y: 2 });
      const vp = new CanvasViewport(host, () => asCanvas(canvas));

      vp.followScroll({ kind: 'edge', from: 'A', to: 'B' }, 100, edges);

      // x = 1 + (0 + 50 - (10 + 2)) = 39 ; y = 2 + (0 + 50 - (20 + 2)) = 30
      expect(canvas._setPosition).toHaveBeenCalledWith({ x: 39, y: 30 });
      expect(canvas.redraw).toHaveBeenCalledTimes(1);
      expect(canvas.centerGroupOrNode).not.toHaveBeenCalled();
    });

    it('matches the edge regardless of traversal direction', () => {
      const host = makeHost(
        '<div class="ag-runcanvas">' +
          '<f-canvas></f-canvas>' +
          '<f-flow></f-flow>' +
          '<span class="ag-edge-badge" data-edge="e1"></span>' +
          '</div>',
      );
      const canvas = makeFakeCanvas(1, { x: 0, y: 0 });
      const vp = new CanvasViewport(host, () => asCanvas(canvas));

      // from/to reversed relative to the stored edge direction.
      vp.followScroll({ kind: 'edge', from: 'B', to: 'A' }, 100, edges);

      expect(canvas._setPosition).toHaveBeenCalledTimes(1);
      expect(canvas.centerGroupOrNode).not.toHaveBeenCalled();
    });

    it('falls back to centring the head vertex when the flow element is missing', () => {
      const host = makeHost('<div class="ag-runcanvas"><f-canvas></f-canvas></div>');
      const canvas = makeFakeCanvas();
      const vp = new CanvasViewport(host, () => asCanvas(canvas));

      vp.followScroll({ kind: 'edge', from: 'A', to: 'B' }, 100, edges);

      expect(canvas.centerGroupOrNode).toHaveBeenCalledWith('B', true);
      expect(canvas._setPosition).not.toHaveBeenCalled();
    });

    it('falls back when no badge matches the edge', () => {
      const host = makeHost(
        '<div class="ag-runcanvas"><f-canvas></f-canvas><f-flow></f-flow></div>',
      );
      const canvas = makeFakeCanvas();
      const vp = new CanvasViewport(host, () => asCanvas(canvas));

      // No edge matches from/to, so `edge` is undefined and no badge is sought.
      vp.followScroll({ kind: 'edge', from: 'X', to: 'Y' }, 100, edges);

      expect(canvas.centerGroupOrNode).toHaveBeenCalledWith('Y', true);
      expect(canvas._setPosition).not.toHaveBeenCalled();
    });
  });
});
