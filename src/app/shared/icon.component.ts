import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Minimal inline-SVG icon set (Lucide-style, 24x24 stroke icons).
 * Selector `app-icon` so the ported editor SCSS (`app-icon { ... }`) sizes it directly.
 */
@Component({
  selector: 'app-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    @switch (name()) {
      @case ('arrowLeft') {
        <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
      }
      @case ('play') {
        <polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none" />
      }
      @case ('pause') {
        <rect x="6" y="4" width="4" height="16" fill="currentColor" stroke="none" rx="1" />
        <rect x="14" y="4" width="4" height="16" fill="currentColor" stroke="none" rx="1" />
      }
      @case ('reset') {
        <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
      }
      @case ('stepForward') {
        <line x1="5" y1="4" x2="5" y2="20" /><polygon points="9 4 20 12 9 20 9 4" fill="currentColor" stroke="none" />
      }
      @case ('stepBack') {
        <line x1="19" y1="4" x2="19" y2="20" /><polygon points="15 4 4 12 15 20 15 4" fill="currentColor" stroke="none" />
      }
      @case ('plus') {
        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
      }
      @case ('minus') {
        <line x1="5" y1="12" x2="19" y2="12" />
      }
      @case ('x') {
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      }
      @case ('check') {
        <polyline points="20 6 9 17 4 12" />
      }
      @case ('maximize') {
        <path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" />
        <path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" />
      }
      @case ('target') {
        <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
      }
      @case ('help') {
        <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      }
      @case ('grid') {
        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
      }
      @case ('link') {
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      }
      @case ('search') {
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      }
      @case ('chevronRight') {
        <polyline points="9 18 15 12 9 6" />
      }
      @case ('chevronLeft') {
        <polyline points="15 18 9 12 15 6" />
      }
      @case ('chevronDown') {
        <polyline points="6 9 12 15 18 9" />
      }
      @case ('chevronUp') {
        <polyline points="18 15 12 9 6 15" />
      }
      @case ('workflow') {
        <rect x="3" y="3" width="8" height="8" rx="2" /><path d="M7 11v4a2 2 0 0 0 2 2h4" />
        <rect x="13" y="13" width="8" height="8" rx="2" />
      }
      @case ('circle') {
        <circle cx="12" cy="12" r="9" />
      }
      @case ('flag') {
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" />
      }
      @case ('code') {
        <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
      }
      @case ('copy') {
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      }
      @case ('list') {
        <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
        <line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" />
        <line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
      }
      @case ('layers') {
        <polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" />
        <polyline points="2 12 12 17 22 12" />
      }
      @case ('arrowRightLeft') {
        <path d="m16 3 4 4-4 4" /><path d="M20 7H4" /><path d="m8 21-4-4 4-4" /><path d="M4 17h16" />
      }
      @case ('arrowRight') {
        <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
      }
      @case ('braces') {
        <path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1" />
        <path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1" />
      }
      @case ('gitBranch') {
        <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
      }
      @case ('edit') {
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      }
      @case ('download') {
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
      }
      @case ('upload') {
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
      }
      @case ('trash') {
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      }
      @case ('eyeOff') {
        <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
        <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
        <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
        <line x1="2" y1="2" x2="22" y2="22" />
      }
      @case ('panelRight') {
        <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="15" y1="3" x2="15" y2="21" />
      }
    }
  </svg>`,
  styles: [`
    :host { display: inline-flex; width: 1em; height: 1em; line-height: 0; }
    svg { width: 100%; height: 100%; display: block; }
  `],
})
export class IconComponent {
  readonly name = input.required<string>();
}
