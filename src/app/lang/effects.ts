/**
 * The interpreter's live canvas-effect state.
 *
 * As the program runs, the visualization built-ins (`mark`, `setLabel`,
 * `scrollTo`, …) accumulate the highlights, labels, snackbar and pending pan
 * that the Run canvas should show. Each step the interpreter snapshots this into
 * the plain `CanvasEffects` record carried by the trace. Keeping the mutable
 * state (and its snapshot) here lets the interpreter focus on execution.
 */
import { emptyEffects, type CanvasEffects, type CanvasMessage, type ScrollTarget } from './trace';

export class EffectsState {
  private readonly marks = new Map<string, string>(); // vertex id → mark type
  private readonly markedEdges = new Map<string, string>(); // edge key (`src->tgt`) → mark type
  private readonly labels = new Map<string, string>(); // vertex id → badge text
  private readonly spotlit = new Set<string>(); // panel entries (var name / DS id|label) to emphasise
  private readonly notes = new Map<string, string>(); // panel entry → transient author note
  private readonly pinned = new Set<string>(); // panel entries pinned to the top, in pin order
  private message: CanvasMessage | null = null; // snackbar for the current step (cleared as each stepped statement begins)
  private scrollTo: ScrollTarget | null = null; // pending pan, consumed by the next step

  markVertex(id: string, type: string): void {
    this.marks.set(id, type);
  }
  unmarkVertex(id: string): void {
    this.marks.delete(id);
  }
  markEdge(key: string, type: string): void {
    this.markedEdges.set(key, type);
  }
  unmarkEdge(key: string): void {
    this.markedEdges.delete(key);
  }
  setLabel(id: string, text: string): void {
    this.labels.set(id, text);
  }
  spotlight(token: string): void {
    this.spotlit.add(token);
  }
  unspotlight(token: string): void {
    this.spotlit.delete(token);
  }
  setNote(token: string, text: string): void {
    if (text) this.notes.set(token, text);
    else this.notes.delete(token);
  }
  pin(token: string): void {
    this.pinned.delete(token); // re-add so the most recently pinned entry sorts to the top
    this.pinned.add(token);
  }
  unpin(token: string): void {
    this.pinned.delete(token);
  }
  setMessage(message: CanvasMessage | null): void {
    this.message = message;
  }
  panTo(target: ScrollTarget): void {
    this.scrollTo = target;
  }
  /** Clear every highlight and label (the `clearMarks` built-in). */
  clear(): void {
    this.marks.clear();
    this.markedEdges.clear();
    this.labels.clear();
    this.spotlit.clear();
    this.notes.clear();
  }

  /** A snapshot for the current step; `cursors` are the active loop cursors. */
  snapshot(cursors: string[]): CanvasEffects {
    const effects = emptyEffects();
    effects.marks = Object.fromEntries(this.marks);
    effects.markedEdges = Object.fromEntries(this.markedEdges);
    effects.labels = Object.fromEntries(this.labels);
    effects.cursors = cursors;
    effects.message = this.message;
    effects.scrollTo = this.scrollTo;
    effects.spotlight = [...this.spotlit];
    effects.notes = Object.fromEntries(this.notes);
    effects.pins = [...this.pinned];
    return effects;
  }

  /** A pan is consumed by the step that shows it. */
  consumePan(): void {
    this.scrollTo = null;
  }
}
