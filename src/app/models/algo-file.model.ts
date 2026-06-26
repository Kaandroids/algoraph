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

/** Seed for the entry file — the algorithm the Run workspace steps through. */
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
  visit(u)
  scrollTo(u)
  setLabel(u, dist[u])

  for each vertex v in neighbors(u) do
    relax(u, v)
  end
end
`;

/** Seed for a module file — exports a helper the entry calls. */
export const HELPERS_SRC = `// Edge relaxation — shared helper
export function relax(u, v) do
  alt ← dist[u] + weight(u, v)
  if alt < dist[v] then
    dist[v] ← alt
    pq.push(v, alt)
    markEdge(u, v)
    setLabel(v, alt)
  end
end
`;
