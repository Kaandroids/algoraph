import { Component, signal } from '@angular/core';
import { FFlowModule } from '@foblex/flow';

/** A graph node. */
export interface GNode {
  id: string;
  label: string;
  position: { x: number; y: number };
}

/** A graph edge (directed, weighted). */
export interface GEdge {
  id: string;
  from: string;
  to: string;
  weight: number;
  directed: boolean;
}

@Component({
  selector: 'app-root',
  imports: [FFlowModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly title = signal('Algoraph');

  /** Sample graph to validate the shell (will be replaced by the editor). */
  protected readonly nodes = signal<GNode[]>([
    { id: 'A', label: 'A', position: { x: 40, y: 140 } },
    { id: 'B', label: 'B', position: { x: 260, y: 60 } },
    { id: 'C', label: 'C', position: { x: 220, y: 280 } },
    { id: 'D', label: 'D', position: { x: 460, y: 180 } },
    { id: 'E', label: 'E', position: { x: 600, y: 320 } },
  ]);

  protected readonly edges = signal<GEdge[]>([
    { id: 'AB', from: 'A', to: 'B', weight: 4, directed: true },
    { id: 'AC', from: 'A', to: 'C', weight: 2, directed: true },
    { id: 'CB', from: 'C', to: 'B', weight: 1, directed: true },
    { id: 'BD', from: 'B', to: 'D', weight: 5, directed: true },
    { id: 'CD', from: 'C', to: 'D', weight: 8, directed: true },
    { id: 'DE', from: 'D', to: 'E', weight: 3, directed: true },
  ]);
}
