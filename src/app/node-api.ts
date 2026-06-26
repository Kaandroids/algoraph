/**
 * Pseudocode API reference shown in the per-node info modal.
 *
 * This is documentation only — the interpreter does not exist yet. The catalog
 * lists, for each node kind, the properties and methods a learner can use in the
 * DSL, with typed parameters, what each one returns, and the Big-O the operation
 * counter attributes.
 *
 * Syntax conventions (chosen with the maintainer):
 *   • Stack / Queue / Set / PriorityQueue use method calls — `q.enqueue(value x)`.
 *   • List / Map / Matrix use bracket indexing — `arr[int i]`, `m[key k]`, `M[int i][int j]`.
 *   • Membership reads as `value x in s` / `key k in m`.
 *   • Graph access is global functions — `neighbors(vertex u)`, `weight(vertex u, vertex v)`.
 *
 * Type vocabulary: void · bool · int · number · value · vertex · edge · key ·
 * string · list<…>. `value` is an element whose type depends on what was stored.
 *
 * A `list<…>` result (e.g. `nodes()`, `neighbors(u)`, `m.keys()`) is read-only but
 * still queryable: `.size()`, `.isEmpty()`, `.contains(x)`, `.indexOf(x)`, `.get(i)`
 * and `[i]` indexing — so `graph.nodes().size()` works.
 */

export interface ApiMember {
  /** Signature with typed parameters, exactly as the user would type it. */
  sig: string;
  desc: string;
  /** What it evaluates to; omitted for language constructs that return nothing. */
  returns?: string;
  /** Big-O the operation counter attributes; omitted for properties / language. */
  cost?: string;
}

export interface ApiGroup {
  title: string;
  members: ApiMember[];
}

/** Baseline properties every node carries. */
const NODE_PROPS: ApiGroup = {
  title: 'Properties',
  members: [
    { sig: 'name', desc: 'Unique identifier used to refer to this node in pseudocode.', returns: 'string' },
    { sig: 'type', desc: 'What kind of node this is.', returns: 'string' },
  ],
};

/** Bookkeeping shared by every data structure. */
const DS_COMMON: ApiMember[] = [
  { sig: 'size()', desc: 'Number of elements held.', returns: 'int', cost: 'O(1)' },
  { sig: 'isEmpty()', desc: 'True when it holds no elements.', returns: 'bool', cost: 'O(1)' },
  { sig: 'clear()', desc: 'Remove every element.', returns: 'void', cost: 'O(n)' },
];

export const DATA_STRUCTURE_API: Record<string, ApiGroup[]> = {
  LIST: [
    NODE_PROPS,
    {
      title: 'Methods',
      members: [
        { sig: 'arr[int i]', desc: 'Read or overwrite the element at 0-based index i.', returns: 'value', cost: 'O(1)' },
        { sig: 'arr.push(value x)', desc: 'Append x to the end.', returns: 'void', cost: 'O(1)*' },
        { sig: 'arr.pop()', desc: 'Remove and return the last element.', returns: 'value', cost: 'O(1)' },
        { sig: 'arr.insert(int i, value x)', desc: 'Insert x at index i, shifting the rest right.', returns: 'void', cost: 'O(n)' },
        { sig: 'arr.removeAt(int i)', desc: 'Remove the element at index i.', returns: 'void', cost: 'O(n)' },
        { sig: 'arr.contains(value x)', desc: 'Whether x appears in the list.', returns: 'bool', cost: 'O(n)' },
        { sig: 'arr.indexOf(value x)', desc: 'First index of x, or −1 if absent.', returns: 'int', cost: 'O(n)' },
        { sig: 'for each value x in arr', desc: 'Iterate from front to back.', cost: 'O(n)' },
        ...DS_COMMON,
      ],
    },
  ],
  STACK: [
    NODE_PROPS,
    {
      title: 'Methods',
      members: [
        { sig: 'st.push(value x)', desc: 'Push x onto the top.', returns: 'void', cost: 'O(1)' },
        { sig: 'st.pop()', desc: 'Remove and return the top element.', returns: 'value', cost: 'O(1)' },
        { sig: 'st.peek()', desc: 'Read the top without removing it.', returns: 'value', cost: 'O(1)' },
        ...DS_COMMON,
      ],
    },
  ],
  QUEUE: [
    NODE_PROPS,
    {
      title: 'Methods',
      members: [
        { sig: 'q.enqueue(value x)', desc: 'Add x to the back.', returns: 'void', cost: 'O(1)' },
        { sig: 'q.dequeue()', desc: 'Remove and return the front element.', returns: 'value', cost: 'O(1)' },
        { sig: 'q.front()', desc: 'Read the front without removing it.', returns: 'value', cost: 'O(1)' },
        ...DS_COMMON,
      ],
    },
  ],
  SET: [
    NODE_PROPS,
    {
      title: 'Methods',
      members: [
        { sig: 's.add(value x)', desc: 'Insert x; no effect if already present.', returns: 'void', cost: 'O(1)*' },
        { sig: 's.remove(value x)', desc: 'Delete x.', returns: 'void', cost: 'O(1)*' },
        { sig: 'value x in s', desc: 'Whether x is a member.', returns: 'bool', cost: 'O(1)*' },
        { sig: 'for each value x in s', desc: 'Iterate the elements (unordered).', cost: 'O(n)' },
        ...DS_COMMON,
      ],
    },
  ],
  MAP: [
    NODE_PROPS,
    {
      title: 'Methods',
      members: [
        { sig: 'm[key k]', desc: 'Read or write the value stored for key k.', returns: 'value', cost: 'O(1)*' },
        { sig: 'key k in m', desc: 'Whether key k has a value.', returns: 'bool', cost: 'O(1)*' },
        { sig: 'm.remove(key k)', desc: 'Delete key k and its value.', returns: 'void', cost: 'O(1)*' },
        { sig: 'm.keys()', desc: 'The keys, to iterate over.', returns: 'list<key>', cost: 'O(n)' },
        { sig: 'm.values()', desc: 'The values, to iterate over.', returns: 'list<value>', cost: 'O(n)' },
        ...DS_COMMON,
      ],
    },
  ],
  PQUEUE: [
    NODE_PROPS,
    {
      title: 'Methods',
      members: [
        { sig: 'pq.push(value x, number p)', desc: 'Insert x with priority p.', returns: 'void', cost: 'O(log n)' },
        { sig: 'pq.popMin()', desc: 'Remove and return the lowest-priority element.', returns: 'value', cost: 'O(log n)' },
        { sig: 'pq.peekMin()', desc: 'Read the lowest-priority element.', returns: 'value', cost: 'O(1)' },
        { sig: 'pq.decreaseKey(value x, number p)', desc: "Lower x's priority to p.", returns: 'void', cost: 'O(log n)' },
        { sig: 'value x in pq', desc: 'Whether x is currently queued.', returns: 'bool', cost: 'O(1)*' },
        ...DS_COMMON,
      ],
    },
  ],
  MATRIX: [
    NODE_PROPS,
    {
      title: 'Methods',
      members: [
        { sig: 'M[int i][int j]', desc: 'Read or write the cell at row i, column j (0-based).', returns: 'number', cost: 'O(1)' },
        { sig: 'M.rows()', desc: 'Number of rows.', returns: 'int', cost: 'O(1)' },
        { sig: 'M.cols()', desc: 'Number of columns.', returns: 'int', cost: 'O(1)' },
        { sig: 'M.fill(number x)', desc: 'Set every cell to x.', returns: 'void', cost: 'O(R·C)' },
      ],
    },
  ],
};

/** Global graph functions that operate on any vertex. */
const GRAPH_WORKS_WITH: ApiMember[] = [
  { sig: 'neighbors(vertex u)', desc: 'Vertices reachable from u by one edge.', returns: 'list<vertex>', cost: 'O(deg u)' },
  { sig: 'weight(vertex u, vertex v)', desc: 'Weight of the edge u → v.', returns: 'number', cost: 'O(1)' },
  { sig: 'hasEdge(vertex u, vertex v)', desc: 'Whether an edge u → v exists.', returns: 'bool', cost: 'O(1)' },
  { sig: 'degree(vertex u)', desc: 'Number of edges incident to u.', returns: 'int', cost: 'O(1)' },
  { sig: 'mark(vertex u, string type?)', desc: 'Highlight u — type "danger" / "warn" / "success" / "info" recolours it (default accent).', returns: 'void' },
];

export const GRAPH_NODE_API: Record<string, ApiGroup[]> = {
  NODE: [NODE_PROPS, { title: 'Works with', members: GRAPH_WORKS_WITH }],
  START: [
    NODE_PROPS,
    {
      title: 'Works with',
      members: [
        { sig: 'source()', desc: 'Returns this Start vertex — where the algorithm begins.', returns: 'vertex', cost: 'O(1)' },
        ...GRAPH_WORKS_WITH,
      ],
    },
  ],
  GOAL: [
    NODE_PROPS,
    {
      title: 'Works with',
      members: [
        { sig: 'goal()', desc: 'Returns this Goal vertex — the search target.', returns: 'vertex', cost: 'O(1)' },
        ...GRAPH_WORKS_WITH,
      ],
    },
  ],
};

/** The library-level "?" — built-ins and language constructs, tied to no single node. */
export const GLOBAL_REFERENCE: {
  eyebrow: string;
  label: string;
  icon: string;
  color: string;
  description: string;
  groups: ApiGroup[];
} = {
  eyebrow: 'Pseudocode',
  label: 'Global reference',
  icon: 'code',
  color: 'var(--accent)',
  description: 'Built-ins and language constructs available everywhere, independent of any single node.',
  groups: [
    {
      title: 'Graph access',
      members: [
        { sig: 'nodes()', desc: 'Every vertex on the canvas.', returns: 'list<vertex>', cost: 'O(V)' },
        { sig: 'edges()', desc: 'Every edge.', returns: 'list<edge>', cost: 'O(E)' },
        { sig: 'neighbors(vertex u)', desc: 'Out-neighbours of u.', returns: 'list<vertex>', cost: 'O(deg u)' },
        { sig: 'weight(vertex u, vertex v)', desc: 'Weight of edge u → v.', returns: 'number', cost: 'O(1)' },
        { sig: 'hasEdge(vertex u, vertex v)', desc: 'Whether edge u → v exists.', returns: 'bool', cost: 'O(1)' },
        { sig: 'degree(vertex u)', desc: 'Edges incident to u (also inDegree / outDegree).', returns: 'int', cost: 'O(1)' },
        { sig: 'source()', desc: 'The Start vertex.', returns: 'vertex', cost: 'O(1)' },
        { sig: 'goal()', desc: 'The Goal vertex.', returns: 'vertex', cost: 'O(1)' },
      ],
    },
    {
      title: 'Visualization',
      members: [
        { sig: 'mark(vertex u, string type?)', desc: 'Highlight a vertex. type "danger" / "warn" / "success" / "info" recolours it (default accent).', returns: 'void' },
        { sig: 'mark(vertex u, vertex v, string type?)', desc: 'Highlight the edge u → v — same type options (danger / warn / success / info).', returns: 'void' },
        { sig: 'unmark(vertex u) / unmark(vertex u, vertex v)', desc: 'Remove a vertex or edge highlight.', returns: 'void' },
        { sig: 'setLabel(vertex u, string text)', desc: 'Show a value on u, e.g. its distance.', returns: 'void' },
        { sig: 'scrollTo(vertex u)', desc: 'Pan to centre a vertex — or an edge with scrollTo(u, v).', returns: 'void' },
        { sig: 'clearMarks()', desc: 'Clear every highlight and label.', returns: 'void' },
        { sig: 'showMessage(string text, string type?)', desc: 'Flash a snackbar; type danger / warn / success / info colours it (empty text clears).', returns: 'void' },
      ],
    },
    {
      title: 'Canvas editing',
      members: [
        { sig: 'createNode(number x, number y, string name?)', desc: 'Add a vertex at (x, y); auto-named N1, N2… when no name is given.', returns: 'vertex' },
        { sig: 'deleteNode(vertex u)', desc: 'Remove a vertex and every edge touching it.', returns: 'void' },
        { sig: 'createEdge(vertex u, vertex v, number weight?, bool directed?)', desc: 'Connect u → v (weight 1, directed by default).', returns: 'void' },
        { sig: 'deleteEdge(vertex u, vertex v)', desc: 'Remove the edge u → v.', returns: 'void' },
        { sig: 'createList(number x, number y, string name?)', desc: 'Drop a List on the canvas; returns the live structure.', returns: 'List' },
        { sig: 'createStack(number x, number y, string name?)', desc: 'Drop a Stack.', returns: 'Stack' },
        { sig: 'createQueue(number x, number y, string name?)', desc: 'Drop a Queue.', returns: 'Queue' },
        { sig: 'createSet(number x, number y, string name?)', desc: 'Drop a Set.', returns: 'Set' },
        { sig: 'createMap(number x, number y, string name?)', desc: 'Drop a Map.', returns: 'Map' },
        { sig: 'createPQueue(number x, number y, string name?)', desc: 'Drop a priority queue.', returns: 'PQueue' },
        { sig: 'createMatrix(number x, number y, int rows, int cols, string name?)', desc: 'Drop an R×C matrix of zeros.', returns: 'Matrix' },
        { sig: 'deleteDS(structure d)', desc: 'Remove a data structure from the canvas.', returns: 'void' },
        { sig: 'clearGraph()', desc: 'Remove all vertices and edges (data structures stay).', returns: 'void' },
        { sig: 'clearCanvas()', desc: 'Remove everything — vertices, edges and data structures.', returns: 'void' },
        { sig: 'saveCanvas()', desc: 'Persist the current canvas so the changes survive after the run.', returns: 'void' },
      ],
    },
    {
      title: 'Language',
      members: [
        { sig: 'x ← e', desc: 'Assignment.' },
        { sig: '=  <  >  ≤  ≥', desc: 'Comparison operators.', returns: 'bool' },
        { sig: 'and  or  not', desc: 'Boolean logic.', returns: 'bool' },
        { sig: 'for each value x in C do … end', desc: 'Iterate a collection.' },
        { sig: 'for int i in a..b do … end', desc: 'Counted loop.' },
        { sig: 'while cond do … end', desc: 'Repeat while a condition holds.' },
        { sig: 'if cond then … end / else', desc: 'Conditional branch.' },
        { sig: 'INFINITY', desc: 'Sentinel for an unreachable / not-yet-known value.', returns: 'number' },
        { sig: '// comment', desc: 'A line comment.' },
      ],
    },
  ],
};

/**
 * The identifier from an API signature, used to drive autocomplete:
 * `pq.push(value x, number p)` → `push`, `size()` → `size`, `name` → `name`.
 * Returns null for forms that aren't a member call (`arr[i]`, `x in s`, …).
 */
export function memberName(sig: string): string | null {
  const dot = /^[A-Za-z_]\w*\.(\w+)/.exec(sig);
  if (dot) return dot[1];
  const call = /^([A-Za-z_]\w*)\s*\(/.exec(sig);
  if (call) return call[1];
  const prop = /^([A-Za-z_]\w*)$/.exec(sig);
  if (prop) return prop[1];
  return null;
}

/**
 * The text autocomplete inserts for a member. A call form fills the parameter
 * names in as a template (`push(x)`, `createNode(x, y, name)`); a property
 * inserts just its name. Returns null for non-member signatures.
 */
export function signatureApply(sig: string): string | null {
  const name = memberName(sig);
  if (!name) return null;
  const paren = /\(([^)]*)\)/.exec(sig);
  if (!paren) return name; // a property — insert just the name
  const params = paren[1].trim();
  if (!params) return `${name}()`;
  const names = params.split(',').map((p) => {
    const words = p.trim().replace(/\?$/, '').match(/[A-Za-z_]\w*/g);
    return words ? words[words.length - 1] : p.trim();
  });
  return `${name}(${names.join(', ')})`;
}
