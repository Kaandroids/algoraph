import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  output,
  signal,
} from '@angular/core';
import { IconComponent } from '../shared/icon.component';
import { DOCS, DOC_GROUPS, type DocAction } from './docs-content';

/**
 * The Docs workspace — a full-page, scrollable getting-started guide with a
 * sticky section nav. Pure documentation: the content is data-driven from
 * `docs-content.ts`, and the only outward dependency is the `navigate` output,
 * which a guide CTA fires to ask the shell to open a workspace or panel.
 */
@Component({
  selector: 'app-docs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  templateUrl: './docs.component.html',
  styleUrl: './docs.component.scss',
})
export class DocsComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly sections = DOCS;
  /** Sidebar groups, each carrying the sections that sit under its heading. */
  protected readonly navGroups = DOC_GROUPS.map((g) => ({
    ...g,
    sections: DOCS.filter((s) => s.group === g.id),
  }));
  /** The section currently in view — drives the active state in the nav. */
  protected readonly activeId = signal(DOCS[0].id);

  /** A CTA inside the guide asks the shell to switch workspace or open a panel. */
  readonly navigate = output<DocAction>();

  /** DOM id for a section's scroll anchor — namespaced so it can't clash. */
  protected anchor(id: string): string {
    return `docs-${id}`;
  }

  constructor() {
    const destroyRef = inject(DestroyRef);
    // Scroll-spy: highlight the nav link of whichever section is in view.
    afterNextRender(() => {
      const root = this.host.nativeElement.querySelector('.docs-content') as HTMLElement | null;
      const sections = this.host.nativeElement.querySelectorAll<HTMLElement>('.docs-section');
      if (!root || !sections.length) return;
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) this.activeId.set((entry.target as HTMLElement).id.slice(5));
          }
        },
        { root, rootMargin: '0px 0px -65% 0px', threshold: 0 },
      );
      sections.forEach((el) => observer.observe(el));
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  /** Jump the page to a section and mark its nav link active. */
  select(id: string): void {
    this.activeId.set(id);
    const el = this.host.nativeElement.querySelector(`#${this.anchor(id)}`) as HTMLElement | null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  go(action: DocAction): void {
    this.navigate.emit(action);
  }
}
