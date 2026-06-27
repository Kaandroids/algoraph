/**
 * Content for the Docs workspace.
 *
 * Documentation only, in three groups (see `DOC_GROUPS`):
 *   • Getting started — a linear walk through the three workspaces.
 *   • Language        — the pseudocode DSL in detail, with worked examples.
 *   • Library         — every built-in, graph node and data structure, with the
 *                       API tables pulled straight from the catalog in
 *                       `node-api.ts` so signatures, returns and costs never drift.
 */
import {
  type ApiGroup,
  DATA_STRUCTURE_API,
  EDGE_API,
  GLOBAL_REFERENCE,
  GRAPH_NODE_API,
} from '../node-api';
import { API_GROUP } from '../editor/editor-globals';

/** A workspace or panel a guide CTA can ask the shell to open. */
export type DocAction = 'canvas' | 'algorithm' | 'run' | 'syntax' | 'import';

/** The button at the foot of a section that jumps the reader into the app. */
export interface DocCta {
  label: string;
  action: DocAction;
  icon?: string;
}

/**
 * One renderable block within a section. A single shape with optional fields
 * (rather than a discriminated union) keeps the Angular template's `@switch`
 * free of narrowing gymnastics.
 *
 * - `lead`    — an intro paragraph (`text`).
 * - `steps`   — an ordered, numbered list of `items` (head + body).
 * - `points`  — a term/description list of `items` (head shown as a code chip).
 * - `code`    — a worked snippet (`code`, optional `caption`).
 * - `callout` — a tinted aside (`tone`, optional `title`, `text`).
 * - `image`   — a screenshot figure (`src`, `alt`, optional `caption`).
 * - `api`     — reference tables (`apiGroups`) of signatures, returns and costs.
 * - `subhead` — a small in-section heading (`text`, optional `chip` tag).
 */
export interface DocBlock {
  kind: 'lead' | 'steps' | 'points' | 'code' | 'callout' | 'image' | 'api' | 'subhead';
  text?: string;
  items?: { head: string; body: string }[];
  caption?: string;
  code?: string;
  tone?: 'tip' | 'note' | 'teacher';
  title?: string;
  /** For `image` — path under the served root (e.g. `docs/main-readable.png`). */
  src?: string;
  alt?: string;
  /** For `image` — cap the figure's display width (px) so narrow shots aren't blown up. */
  width?: number;
  /** For `api` — reference groups rendered as signature/returns/cost rows. */
  apiGroups?: ApiGroup[];
  /** For `subhead` — a small trailing tag chip (e.g. a data structure's kind). */
  chip?: string;
}

/** A sidebar group — sections are listed under their group's heading. */
export interface DocGroup {
  id: string;
  label: string;
}

export const DOC_GROUPS: DocGroup[] = [
  { id: 'start', label: 'Getting started' },
  { id: 'language', label: 'Language' },
  { id: 'library', label: 'Library' },
];

/** A top-level section — one entry in the sidebar and one block of the page. */
export interface DocSection {
  /** Stable key used for the nav link and the scroll anchor. */
  id: string;
  /** Which sidebar group it sits under (a `DOC_GROUPS` id). */
  group: string;
  /** Short label shown in the sidebar. */
  nav: string;
  /** Small kicker above the title (e.g. "Step 1"). */
  eyebrow: string;
  title: string;
  /** Icon name from the shared icon set. */
  icon: string;
  blocks: DocBlock[];
  cta?: DocCta;
}

// ── Catalog helpers — reuse node-api.ts as the single source of truth ──────────

/** The `GLOBAL_REFERENCE` groups with one of the given titles, in catalog order. */
const refGroups = (...titles: string[]): ApiGroup[] =>
  GLOBAL_REFERENCE.groups.filter((g) => titles.includes(g.title));

/** size()/isEmpty()/clear() live on every structure — shown once, not per kind. */
const COMMON_SIGS = new Set(['size()', 'isEmpty()', 'clear()']);

/** A data structure's distinctive methods (its `Methods` group minus the common bookkeeping). */
const dsMethods = (kind: string): ApiGroup[] =>
  DATA_STRUCTURE_API[kind]
    .filter((g) => g.title === 'Methods')
    .map((g) => ({ title: 'Methods', members: g.members.filter((m) => !COMMON_SIGS.has(m.sig)) }));

/** A graph node's "Works with" globals (e.g. source() for Start) — props/methods shown under Vertex. */
const worksWith = (groups: ApiGroup[]): ApiGroup[] => groups.filter((g) => g.title === 'Works with');

export const DOCS: DocSection[] = [
  // ════════════════════════════ Getting started ════════════════════════════
  {
    id: 'welcome',
    group: 'start',
    nav: 'Welcome',
    eyebrow: 'Start here',
    title: 'Welcome to Algoraph',
    icon: 'workflow',
    blocks: [
      {
        kind: 'lead',
        text:
          'Algoraph turns an algorithm into something you can watch. You build a graph, describe an ' +
          'algorithm in a small pseudocode language, then run it one step at a time — every vertex it ' +
          'visits lights up on the canvas, and every operation is counted, so the algorithm’s ' +
          'complexity becomes something you can see rather than just read about.',
      },
      {
        kind: 'steps',
        items: [
          {
            head: 'Canvas',
            body: 'Draw the graph the algorithm runs on — vertices, weighted edges, and any data structures it needs.',
          },
          {
            head: 'Algorithm',
            body: 'Write the algorithm in pseudocode, and call the canvas to highlight what each step is doing.',
          },
          {
            head: 'Run',
            body: 'Play it step by step. Watch the highlights move, follow each loop, and read the operation count and estimated Big-O.',
          },
        ],
      },
      {
        kind: 'callout',
        tone: 'teacher',
        title: 'Two ways in',
        text:
          'Write and test your own algorithm from scratch, or open one a teacher prepared and watch it ' +
          'run on their graph — the same step-by-step view, with nothing to set up.',
      },
    ],
  },
  {
    id: 'build',
    group: 'start',
    nav: 'Build a graph',
    eyebrow: 'Step 1',
    title: 'Build a graph',
    icon: 'workflow',
    blocks: [
      {
        kind: 'lead',
        text:
          'Open the Canvas tab. The library on the left lists everything you can place — click an item to ' +
          'drop it onto the board, or right-click the canvas to add one exactly where you clicked.',
      },
      {
        kind: 'steps',
        items: [
          {
            head: 'Add vertices',
            body: 'Drop a Vertex for each node. Mark one as Start — the source an algorithm begins from — and, for a search, one as Goal.',
          },
          {
            head: 'Connect edges',
            body: 'Drag from a vertex’s output port to another vertex’s input port to draw an edge between them.',
          },
          {
            head: 'Set weight & direction',
            body: 'Double-click an edge to set its weight and switch it between directed (a single arrow) and undirected.',
          },
          {
            head: 'Drop data structures',
            body: 'Add a Set, Map, Stack, Queue, Priority Queue, List or Matrix for the algorithm to fill as it runs. They all start empty.',
          },
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        text:
          'Your code reaches the marked vertices with source() and goal(), and reads the graph with ' +
          'nodes(), neighbors(u) and weight(u, v) — so the picture you draw is exactly what the algorithm sees.',
      },
    ],
    cta: { label: 'Open the Canvas', action: 'canvas', icon: 'workflow' },
  },
  {
    id: 'write',
    group: 'start',
    nav: 'Write the algorithm',
    eyebrow: 'Step 2',
    title: 'Write the algorithm',
    icon: 'code',
    blocks: [
      {
        kind: 'lead',
        text:
          'Switch to the Algorithm tab and write in Algoraph’s CLRS-style pseudocode. Each file is a ' +
          'tab, and main is the entry point the run starts from. The editor underlines mistakes as you type.',
      },
      {
        kind: 'points',
        items: [
          {
            head: 'x ← e',
            body: 'Assign with ← (type <- and it converts). Compare with =, <, >, ≤, ≥.',
          },
          {
            head: 'for each v in neighbors(u)',
            body: 'Loop with while, for each over a collection, and counted for i in a..b ranges.',
          },
          {
            head: 'neighbors(u) · weight(u, v)',
            body: 'Query the graph you drew on the canvas as the algorithm explores it.',
          },
          {
            head: 'mark(u) · setLabel(u, d)',
            body: 'Drive the canvas so each step is visible — highlight a vertex or edge, or pin a value on it.',
          },
        ],
      },
      {
        kind: 'code',
        caption: 'Relax an edge, then show the result on the canvas',
        code:
          'alt ← dist[u] + weight(u, v)\n' +
          'if alt < dist[v] then\n' +
          '  dist[v] ← alt\n' +
          '  setLabel(v, alt)\n' +
          '  mark(u, v, "success")\n' +
          'end',
      },
      {
        kind: 'callout',
        tone: 'note',
        text:
          'The full language and the whole library are documented below — see the Language and Library ' +
          'sections in the sidebar. The same reference is a click away inside the editor.',
      },
    ],
    cta: { label: 'Open the syntax guide', action: 'syntax', icon: 'code' },
  },
  {
    id: 'run',
    group: 'start',
    nav: 'Run it step by step',
    eyebrow: 'Step 3',
    title: 'Run it step by step',
    icon: 'play',
    blocks: [
      {
        kind: 'lead',
        text:
          'Open the Run tab. Algoraph compiles your algorithm and steps through it line by line, right on ' +
          'the graph, so you can see exactly what each line does.',
      },
      {
        kind: 'steps',
        items: [
          {
            head: 'Transport controls',
            body: 'Play, pause, step forward or back, and restart. Slow the playback speed down to study a tricky part.',
          },
          {
            head: 'Step & operation count',
            body: 'Watch the step number and the running operation count — the cost the algorithm is paying as it goes.',
          },
          {
            head: 'Follow the loops',
            body: 'The vertex a for-each loop is on is ringed automatically, and a popup lists the loop’s remaining items, so no iteration is hidden.',
          },
          {
            head: 'See the complexity',
            body: 'The estimated Big-O is shown alongside the run, giving the growing operation count a shape you can name.',
          },
        ],
      },
      {
        kind: 'callout',
        tone: 'tip',
        text:
          'In a hurry? Press Run inside the Algorithm view to compile and run the open file in place, ' +
          'without leaving the editor.',
      },
    ],
    cta: { label: 'Open the Run view', action: 'run', icon: 'play' },
  },
  {
    id: 'helpers',
    group: 'start',
    nav: 'Keep main readable',
    eyebrow: 'Technique',
    title: 'Hide the complexity, show the story',
    icon: 'braces',
    blocks: [
      {
        kind: 'lead',
        text:
          'When the goal is to explain an algorithm, the Run should read like a story — one clear, named ' +
          'step at a time. So keep the fiddly work out of main: push the highlighting, labels, messages ' +
          'and bookkeeping into helper functions, and call them by name.',
      },
      {
        kind: 'lead',
        text:
          'The Run steps main line by line and treats a call to your function as a single step. So an ' +
          'export function — even one kept in its own module file — lets the complex logic run behind the ' +
          'scenes while the audience sees a simple, meaningful call.',
      },
      {
        kind: 'code',
        caption: 'Without helpers — every step is buried in canvas plumbing',
        code:
          'u ← pq.popMin()\n' +
          'mark(u, "info")\n' +
          'setLabel(u, dist[u])\n' +
          'showMessage("Visiting " + u)\n' +
          'for each v in neighbors(u) do\n' +
          '  alt ← dist[u] + weight(u, v)\n' +
          '  if alt < dist[v] then\n' +
          '    dist[v] ← alt\n' +
          '    setLabel(v, alt)\n' +
          '    mark(u, v, "success")\n' +
          '    pq.push(v, alt)\n' +
          '  end\n' +
          'end',
      },
      {
        kind: 'code',
        caption: 'With helpers — main.algo reads as the algorithm itself',
        code:
          'u ← pq.popMin()\n' +
          'visit(u)\n' +
          'for each v in neighbors(u) do\n' +
          '  relax(u, v)\n' +
          'end',
      },
      {
        kind: 'code',
        caption: 'steps.algo — a module of export functions that carries the machinery',
        code:
          'export function visit(u) do\n' +
          '  mark(u, "info")\n' +
          '  setLabel(u, dist[u])\n' +
          '  showMessage("Visiting " + u)\n' +
          'end\n' +
          '\n' +
          'export function relax(u, v) do\n' +
          '  alt ← dist[u] + weight(u, v)\n' +
          '  if alt < dist[v] then\n' +
          '    dist[v] ← alt\n' +
          '    setLabel(v, alt)\n' +
          '    mark(u, v, "success")\n' +
          '    pq.push(v, alt)\n' +
          '  end\n' +
          'end',
      },
      {
        kind: 'image',
        src: 'docs/editor-modules.png',
        alt: 'The Algorithm editor with main.algo and steps.algo tabs; main reads as visit and relax calls, and the overview lists both as exports from steps.algo.',
        caption: 'In the editor — main.algo stays at the level of the algorithm, while visit and relax live in the steps.algo module (shown under Exports).',
      },
      {
        kind: 'points',
        items: [
          {
            head: 'one call = one step',
            body: 'In the Run, visit(u) advances a single step — the audience reads the idea, not the plumbing inside it.',
          },
          {
            head: 'export function',
            body: 'Marks a helper as shared, so any file — including main — can call it by name. There is no import.',
          },
          {
            head: 'a module file',
            body: 'Keep helpers in their own .algo tab. main stays at the level of the algorithm; the module holds the detail.',
          },
        ],
      },
      {
        kind: 'image',
        src: 'docs/run-step.png',
        alt: 'The Run view stepped onto the visit(u) line, with vertices marked and labelled on the canvas and the dist map filled in the data panel.',
        caption: 'In the Run — the current step is a single visit(u) call, yet the canvas and data panel show everything the hidden helper just did.',
      },
      {
        kind: 'callout',
        tone: 'teacher',
        title: 'Why it matters',
        text:
          'This is the difference between code a student can follow and code they get lost in. Keep main at ' +
          'the level of the idea — “pick the closest vertex, visit it, relax its edges” — and let the ' +
          'modules carry the machinery.',
      },
    ],
  },
  {
    id: 'share',
    group: 'start',
    nav: 'Save & share',
    eyebrow: 'Share',
    title: 'Save, share & open algorithms',
    icon: 'upload',
    blocks: [
      {
        kind: 'lead',
        text:
          'Nothing is saved to a server — your work lives in files you keep. Use Export and Import in the ' +
          'toolbar to move algorithms and graphs in and out of the app.',
      },
      {
        kind: 'points',
        items: [
          {
            head: 'Export',
            body: 'Download the current graph as a canvas .json, or any algorithm as a .algo file.',
          },
          {
            head: 'Import a file',
            body: 'Open a .algo or canvas .json from your computer — the algorithm opens as a new tab, the canvas loads onto the board.',
          },
          {
            head: 'Open from the library',
            body: 'Start from a ready-made algorithm or canvas bundled with the app.',
          },
        ],
      },
      {
        kind: 'callout',
        tone: 'teacher',
        title: 'For teachers',
        text:
          'Build the graph and write the algorithm, export the .algo and the canvas .json, and hand both ' +
          'to your students. They import the pair and watch your algorithm run, step by step, on your graph.',
      },
    ],
    cta: { label: 'Open the library', action: 'import', icon: 'layers' },
  },

  // ════════════════════════════════ Language ════════════════════════════════
  {
    id: 'lang-basics',
    group: 'language',
    nav: 'Basics & values',
    eyebrow: 'Language',
    title: 'Basics & values',
    icon: 'braces',
    blocks: [
      {
        kind: 'lead',
        text:
          'Algoraph runs a small, CLRS-style pseudocode. Each statement sits on its own line, and blocks ' +
          'are written explicitly with do … end or then … end. ASCII shortcuts are converted as you type, ' +
          'so you can keep your hands on the keyboard and still get the textbook symbols.',
      },
      {
        kind: 'points',
        items: [
          { head: 'x ← e', body: 'Assignment — bind the value of e to the name x. Type <- to get ←.' },
          { head: '42 · 3.5 · "text"', body: 'Number and string literals. + concatenates when either side is a string.' },
          { head: 'true · false · nil', body: 'The two booleans and the empty value, nil.' },
          { head: 'INFINITY', body: 'A sentinel larger than any weight — for an unreachable or not-yet-known value.' },
          { head: '// comment', body: 'A line comment, ignored when the algorithm runs.' },
        ],
      },
      {
        kind: 'code',
        caption: 'A few bindings',
        code:
          's ← source()\n' +
          'best ← INFINITY\n' +
          'found ← false\n' +
          'label ← "from " + s    // "from A"',
      },
      {
        kind: 'callout',
        tone: 'note',
        title: 'Typed as ASCII, shown as symbols',
        text: '<- becomes ←, <= becomes ≤, >= becomes ≥, and != becomes ≠ the moment you type them.',
      },
      {
        kind: 'image',
        src: 'docs/autocomplete.png',
        alt: 'The editor showing an autocomplete dropdown of members after typing a name followed by a dot.',
        caption: 'As you type, the editor completes names in scope and their members — the graph, the canvas, and every data structure on the board.',
      },
    ],
  },
  {
    id: 'lang-operators',
    group: 'language',
    nav: 'Operators',
    eyebrow: 'Language',
    title: 'Operators',
    icon: 'plus',
    blocks: [
      {
        kind: 'lead',
        text: 'The usual arithmetic, comparison and boolean operators, plus two that read the way the textbook does.',
      },
      {
        kind: 'points',
        items: [
          { head: '+  -  *  /  %', body: 'Arithmetic. % is the remainder. With a string on either side, + concatenates.' },
          { head: '=  ≠  <  >  ≤  ≥', body: 'Comparison — each evaluates to a boolean.' },
          { head: 'and  or  not', body: 'Boolean logic, short-circuiting left to right.' },
          { head: 'x in C', body: 'Membership — whether x is in a set, a map’s keys, a list, or a priority queue.' },
          { head: 'a..b', body: 'An inclusive integer range, used by counted for loops.' },
        ],
      },
      {
        kind: 'code',
        caption: 'Operators in a guard',
        code:
          'if alt < dist[v] and not (v in visited) then\n' +
          '  dist[v] ← alt\n' +
          'end\n' +
          '\n' +
          'for i in 1..degree(u) do\n' +
          '  total ← total + i\n' +
          'end',
      },
    ],
  },
  {
    id: 'lang-conditionals',
    group: 'language',
    nav: 'Conditionals',
    eyebrow: 'Language',
    title: 'Conditionals',
    icon: 'gitBranch',
    blocks: [
      {
        kind: 'lead',
        text:
          'Branch with if … then … end, optionally with an else block. The condition is any expression — ' +
          'nil, false, 0 and the empty string are falsy, everything else is truthy.',
      },
      {
        kind: 'code',
        caption: 'A branch, and an early-out guard',
        code:
          'if u in visited then\n' +
          '  continue\n' +
          'else\n' +
          '  visited.add(u)\n' +
          'end\n' +
          '\n' +
          '// one-liners are fine when the body is short\n' +
          'if u in visited then continue end',
      },
      {
        kind: 'callout',
        tone: 'tip',
        text:
          'In the Run, the if line is one step that shows which way the branch went — handy for watching a ' +
          'guard accept or reject a vertex.',
      },
    ],
  },
  {
    id: 'lang-loops',
    group: 'language',
    nav: 'Loops',
    eyebrow: 'Language',
    title: 'Loops',
    icon: 'reset',
    blocks: [
      { kind: 'lead', text: 'Three loop forms. Use continue to skip to the next iteration and break to leave the loop early.' },
      {
        kind: 'points',
        items: [
          { head: 'while cond do … end', body: 'Repeat while a condition holds — the workhorse of queue/priority-queue drains.' },
          { head: 'for each x in C do … end', body: 'Iterate the elements of a collection: nodes(), neighbors(u), a set, a list…' },
          { head: 'for i in a..b do … end', body: 'A counted loop over an inclusive integer range.' },
          { head: 'continue · break', body: 'Skip to the next iteration · leave the loop early.' },
        ],
      },
      {
        kind: 'code',
        caption: 'A queue drain with a nested edge scan',
        code:
          'while not pq.isEmpty() do\n' +
          '  u ← pq.popMin()\n' +
          '  for each v in neighbors(u) do\n' +
          '    relax(u, v)\n' +
          '  end\n' +
          'end',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Loops visualize themselves',
        text:
          'In the Run, the vertex a for-each loop is currently on is ringed automatically — nested loops ring ' +
          'each level — and a popup lists the remaining items, so you never have to mark the iteration yourself.',
      },
    ],
  },
  {
    id: 'lang-functions',
    group: 'language',
    nav: 'Functions & modules',
    eyebrow: 'Language',
    title: 'Functions & modules',
    icon: 'braces',
    blocks: [
      {
        kind: 'lead',
        text:
          'Group reusable steps into functions. A plain function is private to its file; an export function ' +
          'is visible to every file and can be called by name — there is no import. The Run steps the main ' +
          'file line by line and treats a call to your function as a single step.',
      },
      {
        kind: 'points',
        items: [
          { head: 'function name(params) do … end', body: 'A file-private helper.' },
          { head: 'export function name(params) do … end', body: 'A helper callable from any file.' },
          { head: 'return e', body: 'Return a value from a function — or a bare return to stop early.' },
        ],
      },
      {
        kind: 'code',
        caption: 'An exported helper that returns a value',
        code:
          'export function relax(u, v) do\n' +
          '  alt ← dist[u] + weight(u, v)\n' +
          '  if alt < dist[v] then\n' +
          '    dist[v] ← alt\n' +
          '    pq.push(v, alt)\n' +
          '    return true\n' +
          '  end\n' +
          '  return false\n' +
          'end',
      },
      {
        kind: 'callout',
        tone: 'note',
        text:
          'A function runs in its own scope: it sees its parameters and the named structures on the canvas, ' +
          'but not main’s local variables. Pass what it needs as arguments. See “Keep main readable” for ' +
          'why this is the key to a clean, watchable run.',
      },
    ],
  },

  // ════════════════════════════════ Library ═════════════════════════════════
  {
    id: 'lib-graph',
    group: 'library',
    nav: 'Graph',
    eyebrow: 'Library · Built-in',
    title: 'Graph',
    icon: 'workflow',
    blocks: [
      {
        kind: 'lead',
        text:
          'The Algorithm library groups everything you can reference from code. Its four built-ins — Graph, ' +
          'Canvas, Scratch and Panel — are always in scope; click any one in the library to read its ' +
          'reference inline.',
      },
      {
        kind: 'lead',
        text:
          'Graph reads the vertices and edges you drew on the canvas. These global functions are how an ' +
          'algorithm explores the structure it runs on.',
      },
      { kind: 'api', apiGroups: refGroups(API_GROUP.graph) },
      {
        kind: 'code',
        caption: 'Sum the weight of every edge',
        code:
          'total ← 0\n' +
          'for each u in nodes() do\n' +
          '  for each v in neighbors(u) do\n' +
          '    total ← total + weight(u, v)\n' +
          '  end\n' +
          'end',
      },
    ],
  },
  {
    id: 'lib-canvas',
    group: 'library',
    nav: 'Canvas',
    eyebrow: 'Library · Built-in',
    title: 'Canvas',
    icon: 'maximize',
    blocks: [
      {
        kind: 'lead',
        text:
          'Canvas is the drawing surface. Use it to highlight what a step is doing, and to build or edit the ' +
          'graph and data structures from code. The two halves below are Visualization (highlighting) and ' +
          'Canvas editing (mutating the board).',
      },
      { kind: 'api', apiGroups: refGroups(API_GROUP.visualization, API_GROUP.canvasEditing) },
      {
        kind: 'code',
        caption: 'Settle a vertex, then walk its edges',
        code:
          'mark(u, "success")\n' +
          'setLabel(u, dist[u])\n' +
          'for each v in neighbors(u) do\n' +
          '  mark(u, v)\n' +
          'end',
      },
      {
        kind: 'callout',
        tone: 'tip',
        title: 'Changes are a sandbox',
        text:
          'Edits made from code (createNode, createEdge, create…) are undone after the run unless you call ' +
          'saveCanvas(). Begin a graph generator with clearGraph() so re-running doesn’t stack up duplicates.',
      },
    ],
  },
  {
    id: 'lib-scratch-panel',
    group: 'library',
    nav: 'Scratch & Panel',
    eyebrow: 'Library · Built-in',
    title: 'Scratch & Panel',
    icon: 'eyeOff',
    blocks: [
      {
        kind: 'lead',
        text:
          'Sometimes an algorithm needs bookkeeping that shouldn’t clutter the drawing. Scratch and Panel ' +
          'both create off-canvas structures — the difference is whether you can watch them.',
      },
      {
        kind: 'points',
        items: [
          { head: 'scratch.*', body: 'Fully hidden — never drawn on the canvas, never shown in the run data panel. Private working state.' },
          { head: 'panel.*', body: 'Off the canvas, but still listed in the run data panel — so you can watch it change step by step.' },
        ],
      },
      { kind: 'api', apiGroups: refGroups(API_GROUP.scratch, API_GROUP.panel) },
      {
        kind: 'code',
        caption: 'A hidden helper and a watchable one',
        code:
          'seen ← scratch.createSet()        // private, off-canvas\n' +
          'order ← panel.createList("order") // watchable in the data panel\n' +
          'order.push(u)',
      },
      {
        kind: 'image',
        src: 'docs/run-panel.png',
        width: 340,
        alt: 'The Run view data panel listing the variables and the data structures the algorithm is filling.',
        caption: 'The Run data panel — panel structures appear here beside the on-canvas ones; scratch structures stay hidden.',
      },
    ],
  },
  {
    id: 'lib-nodes',
    group: 'library',
    nav: 'Graph nodes',
    eyebrow: 'Library · Canvas',
    title: 'Graph nodes',
    icon: 'circle',
    blocks: [
      {
        kind: 'lead',
        text:
          'The pieces you place on the canvas to build the graph: plain vertices, the special Start and Goal ' +
          'vertices, and the weighted edges that link them.',
      },
      {
        kind: 'image',
        src: 'docs/graph-nodes.png',
        alt: 'A small graph on the canvas with a Start vertex, plain vertices, a Goal vertex, and weighted directed edges.',
        caption: 'A Start (green), plain vertices, a Goal (violet), and weighted directed edges between them.',
      },
      { kind: 'subhead', text: 'Vertex', chip: 'node' },
      { kind: 'lead', text: 'A plain graph node — a point the algorithm can visit and link with edges.' },
      { kind: 'api', apiGroups: GRAPH_NODE_API['NODE'] },
      { kind: 'subhead', text: 'Start', chip: 'source' },
      {
        kind: 'lead',
        text: 'The source vertex an algorithm begins from — everything a Vertex has, plus the source() global.',
      },
      { kind: 'api', apiGroups: worksWith(GRAPH_NODE_API['START']) },
      { kind: 'subhead', text: 'Goal', chip: 'target' },
      {
        kind: 'lead',
        text: 'The target a search is trying to reach — everything a Vertex has, plus the goal() global.',
      },
      { kind: 'api', apiGroups: worksWith(GRAPH_NODE_API['GOAL']) },
      { kind: 'subhead', text: 'Edge', chip: 'link' },
      {
        kind: 'lead',
        text: 'A weighted connection between two vertices, made by linking ports. Read its fields without parentheses.',
      },
      { kind: 'api', apiGroups: EDGE_API },
    ],
  },
  {
    id: 'lib-data',
    group: 'library',
    nav: 'Data structures',
    eyebrow: 'Library · Canvas',
    title: 'Data structures',
    icon: 'layers',
    blocks: [
      {
        kind: 'lead',
        text:
          'Drop a structure onto the canvas and refer to it by its name. Lists, maps and matrices use bracket ' +
          'indexing; stacks, queues, sets and priority queues use method calls. Every one starts empty when ' +
          'the algorithm runs, and the operation counter charges each operation the cost shown below.',
      },
      {
        kind: 'image',
        src: 'docs/data-nodes.png',
        alt: 'The seven data structure nodes filled with example contents: List, Stack, Queue, Set, Map, Priority Queue and Matrix.',
        caption: 'The seven structures you can place, shown filled — refer to each in code by the name on its node.',
      },
      {
        kind: 'callout',
        tone: 'note',
        text: 'Every structure also offers .size(), .isEmpty() and .clear() — listed once here rather than under each.',
      },
      { kind: 'subhead', text: 'List / Array', chip: 'Array' },
      { kind: 'lead', text: 'Indexed, ordered values — index access and append.' },
      { kind: 'api', apiGroups: dsMethods('LIST') },
      { kind: 'subhead', text: 'Stack', chip: 'Stack' },
      { kind: 'lead', text: 'Last in, first out — push and pop from the top.' },
      { kind: 'api', apiGroups: dsMethods('STACK') },
      { kind: 'subhead', text: 'Queue', chip: 'Queue' },
      { kind: 'lead', text: 'First in, first out — enqueue at the back, dequeue from the front.' },
      { kind: 'api', apiGroups: dsMethods('QUEUE') },
      { kind: 'subhead', text: 'Set', chip: 'Set' },
      { kind: 'lead', text: 'Unique membership — add, remove, and test with x in s.' },
      { kind: 'api', apiGroups: dsMethods('SET') },
      { kind: 'subhead', text: 'Map', chip: 'Map' },
      { kind: 'lead', text: 'Key → value lookup with bracket indexing.' },
      { kind: 'api', apiGroups: dsMethods('MAP') },
      { kind: 'subhead', text: 'Priority Queue', chip: 'Priority Q' },
      { kind: 'lead', text: 'A min-heap by priority — push with a priority, pop the smallest.' },
      { kind: 'api', apiGroups: dsMethods('PQUEUE') },
      { kind: 'subhead', text: '2D Matrix', chip: 'Matrix' },
      { kind: 'lead', text: 'A fixed rows × columns grid of numbers, indexed M[i][j].' },
      { kind: 'api', apiGroups: dsMethods('MATRIX') },
    ],
  },
];
