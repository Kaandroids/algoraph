/**
 * Foblex Flow addresses an edge by its two port ids, derived from the vertex id:
 * the source's output port `"<id>-out"` and the target's input port `"<id>-in"`.
 * These helpers are the single place that knows that convention, so the suffixes
 * aren't hand-written (and re-stripped) across the canvas, viewport and run store.
 */

/** The output (source) port id for a vertex. */
export function makeOutputPort(nodeId: string): string {
  return `${nodeId}-out`;
}

/** The input (target) port id for a vertex. */
export function makeInputPort(nodeId: string): string {
  return `${nodeId}-in`;
}

/** The vertex id behind an output port id (`"A-out"` → `"A"`). */
export function sourceNodeId(outputPortId: string): string {
  return outputPortId.replace(/-out$/, '');
}

/** The vertex id behind an input port id (`"A-in"` → `"A"`). */
export function targetNodeId(inputPortId: string): string {
  return inputPortId.replace(/-in$/, '');
}
