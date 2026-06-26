/**
 * Content for the pseudocode "Syntax guide" modal opened from the library rail.
 *
 * Documentation only — it mirrors the DSL the parser/interpreter implement
 * (`src/app/lang/`) and the API catalog in `node-api.ts`, grouped into sections
 * with worked examples so a learner can write an algorithm without leaving the app.
 */

export interface SyntaxItem {
  /** The construct exactly as it is typed. */
  syntax: string;
  desc: string;
}

export interface SyntaxSection {
  title: string;
  intro?: string;
  items?: SyntaxItem[];
  /** A multi-line worked example shown in a code block. */
  example?: string;
}

export const SYNTAX_GUIDE: SyntaxSection[] = [
  {
    title: 'Basics',
    intro:
      'Algoraph runs a small, CLRS-style pseudocode. Each statement sits on its own line; ' +
      'blocks are written explicitly with do … end or then … end. ASCII shortcuts are converted ' +
      'as you type: <- becomes ←, <= becomes ≤, >= becomes ≥, != becomes ≠.',
    items: [
      { syntax: 'x ← e', desc: 'Assignment — bind the value of e to x (type <- to get ←).' },
      { syntax: '// comment', desc: 'A line comment, ignored when the algorithm runs.' },
      { syntax: 'INFINITY', desc: 'Sentinel for an unreachable or not-yet-known value.' },
      { syntax: 'true · false · nil', desc: 'Boolean literals and the empty value.' },
    ],
    example: 's ← source()\ndist[s] ← 0\nbest ← INFINITY',
  },
  {
    title: 'Operators',
    items: [
      { syntax: '+  -  *  /  %', desc: 'Arithmetic (% is remainder).' },
      { syntax: '=  ≠  <  >  ≤  ≥', desc: 'Comparison — evaluates to a boolean.' },
      { syntax: 'and  or  not', desc: 'Boolean logic (short-circuiting).' },
      { syntax: 'x in C', desc: 'Membership — whether x is in a set, map keys, or queue.' },
      { syntax: 'a..b', desc: 'An inclusive integer range, for counted loops.' },
    ],
    example: 'if alt < dist[v] and not (v in visited) then\n  dist[v] ← alt\nend',
  },
  {
    title: 'Conditionals',
    intro: 'Branch with if … then … end, optionally with an else block.',
    example: 'if u in visited then\n  continue\nelse\n  visited.add(u)\nend',
  },
  {
    title: 'Loops',
    intro:
      'Three loop forms. Use continue to skip to the next iteration and break to leave the loop. ' +
      'In the Run workspace, the vertex a for-each loop is currently on is ringed automatically — ' +
      'nested loops ring each level — so the iteration is visible without marking anything yourself.',
    items: [
      { syntax: 'while cond do … end', desc: 'Repeat while a condition holds.' },
      { syntax: 'for each x in C do … end', desc: 'Iterate the elements of a collection.' },
      { syntax: 'for i in a..b do … end', desc: 'Counted loop over an inclusive range.' },
      { syntax: 'continue · break', desc: 'Skip to the next iteration · leave the loop early.' },
    ],
    example:
      'while not pq.isEmpty() do\n' +
      '  u ← pq.popMin()\n' +
      '  for each v in neighbors(u) do\n' +
      '    relax(u, v)\n' +
      '  end\n' +
      'end',
  },
  {
    title: 'Functions & modules',
    intro:
      'Group reusable steps into functions. An export function is visible to every file and can be ' +
      'called by name — there is no import. The Run workspace steps the main file line by line and ' +
      'treats a call to your function as a single step.',
    items: [
      { syntax: 'function name(params) do … end', desc: 'A file-private helper.' },
      { syntax: 'export function name(params) do … end', desc: 'A helper callable from any file.' },
      { syntax: 'return e', desc: 'Return a value from a function (or bare return to stop).' },
    ],
    example:
      'export function relax(u, v) do\n' +
      '  alt ← dist[u] + weight(u, v)\n' +
      '  if alt < dist[v] then\n' +
      '    dist[v] ← alt\n' +
      '    pq.push(v, alt)\n' +
      '  end\n' +
      'end',
  },
  {
    title: 'Graph access',
    intro: 'Global functions that query the graph you built on the canvas.',
    items: [
      { syntax: 'nodes()', desc: 'Every vertex on the canvas.' },
      { syntax: 'edges()', desc: 'Every edge.' },
      { syntax: 'neighbors(u)', desc: 'Vertices reachable from u by one edge.' },
      { syntax: 'weight(u, v)', desc: 'Weight of the edge u → v.' },
      { syntax: 'hasEdge(u, v)', desc: 'Whether an edge u → v exists.' },
      { syntax: 'degree(u)', desc: 'Number of edges at u (also inDegree / outDegree).' },
      { syntax: 'source() · goal()', desc: 'The Start vertex · the Goal vertex.' },
    ],
  },
  {
    title: 'Visualization',
    intro:
      'Drive the canvas so each step is visible. These mark the graph; they return nothing. ' +
      'mark, unmark and scrollTo take one vertex, or two vertices to address the edge between them.',
    items: [
      { syntax: 'visit(u)', desc: 'Mark u settled — a green ring on the vertex.' },
      { syntax: 'mark(u) · unmark(u)', desc: 'Toggle a bright "active" highlight on vertex u.' },
      { syntax: 'mark(u, v) · unmark(u, v)', desc: 'Toggle the highlight on the edge u → v (markEdge is the same as mark(u, v)).' },
      { syntax: 'setLabel(u, text)', desc: 'Pin a value on u, e.g. its distance.' },
      { syntax: 'scrollTo(u) · scrollTo(u, v)', desc: 'Pan the canvas to a vertex, or to the edge u → v.' },
      { syntax: 'clearMarks()', desc: 'Clear every highlight and label — wipe the canvas back to its base state.' },
    ],
  },
  {
    title: 'Data structures',
    intro:
      'Drop a structure onto the canvas and refer to it by its name. Lists, maps and matrices use ' +
      'bracket indexing; stacks, queues, sets and priority queues use method calls. They start ' +
      'empty when the algorithm runs.',
    items: [
      { syntax: 'arr[i]  ·  arr.push(x)', desc: 'List / Array — index access and append.' },
      { syntax: 'st.push(x)  ·  st.pop()', desc: 'Stack — LIFO.' },
      { syntax: 'q.enqueue(x)  ·  q.dequeue()', desc: 'Queue — FIFO.' },
      { syntax: 's.add(x)  ·  x in s', desc: 'Set — membership.' },
      { syntax: 'm[k]  ·  k in m  ·  m.keys()', desc: 'Map — key → value lookup.' },
      { syntax: 'pq.push(x, p)  ·  pq.popMin()', desc: 'Priority queue — min-heap by priority p.' },
      { syntax: 'M[i][j]  ·  M.rows()', desc: 'Matrix — row, column grid.' },
      { syntax: '.size()  ·  .isEmpty()', desc: 'Available on every structure.' },
    ],
  },
  {
    title: 'A complete example — Dijkstra',
    intro:
      'Build a graph with a Start vertex, drop a set (visited), a map (dist) and a priority queue ' +
      '(pq), then write:',
    example:
      '// main.algo\n' +
      's ← source()\n' +
      'for each u in nodes() do\n' +
      '  dist[u] ← INFINITY\n' +
      'end\n' +
      'dist[s] ← 0\n' +
      'pq.push(s, 0)\n' +
      '\n' +
      'while not pq.isEmpty() do\n' +
      '  u ← pq.popMin()\n' +
      '  if u in visited then continue end\n' +
      '  visited.add(u)\n' +
      '  visit(u)\n' +
      '  setLabel(u, dist[u])\n' +
      '  for each v in neighbors(u) do\n' +
      '    relax(u, v)\n' +
      '  end\n' +
      'end',
  },
];
