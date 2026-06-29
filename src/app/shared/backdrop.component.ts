import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * A full-screen click-catcher behind a popover or modal. Replaces the handful of
 * near-identical `<div class="…-backdrop" (click)=…>` elements: the host element
 * itself carries the backdrop class (so existing CSS applies one-to-one) and
 * emits `close` on click. It also projects content, so it works both as an empty
 * sibling backdrop and as the centring wrapper a modal sits inside.
 *
 * `closeOnContextMenu` (used by the context-menu backdrops) makes a right-click
 * dismiss too and swallows the browser menu. Off by default, so right-clicking a
 * modal's content keeps the native menu (e.g. copy/paste in a textarea).
 */
@Component({
  selector: 'app-backdrop',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  host: {
    '[class]': 'variant()',
    '(click)': 'close.emit()',
    '(contextmenu)': 'onContextMenu($event)',
  },
})
export class BackdropComponent {
  /** The backdrop's CSS class, e.g. `ds-modal-backdrop` / `ae-ctx-backdrop`. */
  readonly variant = input.required<string>();
  /** When set, a right-click also dismisses (and suppresses the browser menu). */
  readonly closeOnContextMenu = input(false);
  /** Emitted when the backdrop is clicked — dismiss the overlay it sits behind. */
  readonly close = output<void>();

  protected onContextMenu(e: Event): void {
    if (!this.closeOnContextMenu()) return;
    e.preventDefault();
    this.close.emit();
  }
}
