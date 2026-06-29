import { Directive, ElementRef, afterEveryRender, inject, input } from '@angular/core';

/**
 * Slides its host to a new list position with a FLIP transition instead of
 * letting it jump. Bind the item's `$index`; the directive animates only when
 * that index actually changes (a reorder — e.g. pin/unpin), so ordinary
 * per-step content growth that merely shifts rows down doesn't animate.
 *
 * FLIP: after the DOM has reordered, we measure the new layout offset, place the
 * element back at its old offset with an instant `translateY`, then transition
 * that transform to zero so it glides into place. `offsetTop` is used (not
 * `getBoundingClientRect`) because it ignores any in-flight transform, keeping
 * the baseline correct if a second reorder lands mid-animation.
 */
@Directive({ selector: '[agFlip]', standalone: true })
export class FlipDirective {
  /** The item's index in the rendered list — a change to it means a reorder. */
  readonly agFlip = input<number>(0);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private lastTop: number | null = null;
  private lastIndex: number | null = null;

  constructor() {
    afterEveryRender(() => {
      const el = this.host.nativeElement;
      const top = el.offsetTop;
      const index = this.agFlip();
      const reordered = this.lastIndex !== null && this.lastIndex !== index;
      if (reordered && this.lastTop !== null && Math.abs(this.lastTop - top) > 1) {
        const delta = this.lastTop - top;
        el.style.transition = 'none';
        el.style.transform = `translateY(${delta}px)`;
        requestAnimationFrame(() => {
          el.style.transition = 'transform 300ms ease';
          el.style.transform = '';
        });
      }
      this.lastTop = top;
      this.lastIndex = index;
    });
  }
}
