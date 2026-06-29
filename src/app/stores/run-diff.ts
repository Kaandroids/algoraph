/**
 * Pure step-to-step diffing for the Run panel's change highlight. Kept out of
 * RunStore so the (state-free) logic can be unit-tested directly and the store
 * stays focused on reactive wiring and transport.
 */
import type { DataSnapshot } from '../lang/trace';
import type { HeapEntry } from '../models/data-structure.model';

/** What a single data structure changed between two steps — drives the panel flash. */
export interface DataDiff {
  /** Display values newly present vs the previous step (sequence/set items; pqueue `value priority`). */
  values: Set<string>;
  /** Map keys added, or whose value changed. */
  keys: Set<string>;
  /** Matrix row indices whose contents changed. */
  rows: Set<number>;
  /** Whether anything at all changed (including a pure removal) — drives the header pulse. */
  changed: boolean;
}

/** Stable key for a priority-queue entry, so equal values at different priorities are distinct. */
export const heapKey = (e: HeapEntry): string => `${e.value} ${e.priority}`;

/**
 * Diff one structure against its previous-step snapshot (a missing `prev` means it
 * was just created). Items/heap use a multiset compare so a value is flagged only
 * when a *new* occurrence appears; maps compare per key; matrices compare per row.
 */
export function diffData(prev: DataSnapshot | undefined, cur: DataSnapshot): DataDiff {
  const values = new Set<string>();
  const keys = new Set<string>();
  const rows = new Set<number>();

  const curVals = cur.kind === 'PQUEUE' ? cur.heap.map(heapKey) : cur.items.map(String);
  const prevVals = !prev ? [] : prev.kind === 'PQUEUE' ? prev.heap.map(heapKey) : prev.items.map(String);
  const prevCount = new Map<string, number>();
  for (const v of prevVals) prevCount.set(v, (prevCount.get(v) ?? 0) + 1);
  const curCount = new Map<string, number>();
  for (const v of curVals) curCount.set(v, (curCount.get(v) ?? 0) + 1);
  for (const [v, n] of curCount) if (n > (prevCount.get(v) ?? 0)) values.add(v);

  const prevMap = new Map((prev?.entries ?? []).map((e) => [e.key, String(e.value)]));
  for (const e of cur.entries) if (prevMap.get(e.key) !== String(e.value)) keys.add(e.key);

  for (let r = 0; r < cur.matrix.length; r++) {
    if ((prev?.matrix[r] ?? []).join(' ') !== cur.matrix[r].join(' ')) rows.add(r);
  }

  const sizeChanged =
    !prev || curVals.length !== prevVals.length || cur.entries.length !== (prev.entries?.length ?? 0);
  const changed = !prev || values.size > 0 || keys.size > 0 || rows.size > 0 || sizeChanged;
  return { values, keys, rows, changed };
}
