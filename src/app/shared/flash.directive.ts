import { Directive, ElementRef, effect, inject, input } from '@angular/core';

/**
 * Replays a one-shot CSS flash on its host whenever the bound trigger changes to
 * a new non-null value — used by the Run panel to draw the eye to the variable or
 * data-structure entry the current step just changed.
 *
 * The trigger is normally the step number, emitted only while the element is
 * "changed" (and `null` otherwise). Toggling the `is-flashing` class alone would
 * not restart the animation on back-to-back changes, so we force a reflow between
 * removing and re-adding it. A `null` trigger simply clears the flash.
 */
@Directive({ selector: '[agFlash]', standalone: true })
export class FlashDirective {
  /** Changing this to a new non-null value replays the flash; `null` clears it. */
  readonly agFlash = input<unknown>(null);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    effect(() => {
      const trigger = this.agFlash();
      const el = this.host.nativeElement;
      el.classList.remove('is-flashing');
      if (trigger == null) return;
      void el.offsetWidth; // force reflow so the animation restarts even on repeat changes
      el.classList.add('is-flashing');
    });
  }
}
