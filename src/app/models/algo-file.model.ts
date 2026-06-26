/**
 * Algorithm-workspace file model.
 *
 * The algorithm editor is multi-file: one entry file (`main`) that the Run
 * workspace steps through, plus any number of module files that `export`
 * helpers the entry can call. Each file carries its own per-line notes.
 */
import type { LineNote } from '../editor/line-notes';

/** One editable source file in the algorithm workspace (entry `main` + module files). */
export interface AlgoFile {
  id: string;
  name: string;
  content: string;
  /** Per-line notes the learner attached, addressed by line number. */
  notes: LineNote[];
}

/**
 * Sample Dijkstra entry file. The workspace itself starts with an empty
 * `main.algo`; this constant is the reference algorithm the lang tests run.
 */
export const MAIN_SRC = `// Dijkstra — shortest paths from the Start vertex
s ← source()
for each vertex u in nodes() do
  dist[u] ← INFINITY
end
dist[s] ← 0
pq.push(s, 0)

while not pq.isEmpty() do
  u ← pq.popMin()
  if u in visited then continue end
  visited.add(u)
  mark(u, "success")
  scrollTo(u)
  setLabel(u, dist[u])

  for each vertex v in neighbors(u) do
    relax(u, v)
  end
end
`;

/** Companion module for the Dijkstra sample — exports the relax helper (test fixture). */
export const HELPERS_SRC = `// Edge relaxation — shared helper
export function relax(u, v) do
  alt ← dist[u] + weight(u, v)
  if alt < dist[v] then
    dist[v] ← alt
    pq.push(v, alt)
    mark(u, v)
    setLabel(v, alt)
  end
end
`;
