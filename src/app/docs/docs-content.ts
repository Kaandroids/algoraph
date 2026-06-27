/**
 * Content for the Docs workspace — a linear "getting started" guide.
 *
 * Documentation only. It walks a learner through the three workspaces in order
 * (Canvas → Algorithm → Run) and then how to save and share, framed so a student
 * can either write their own algorithm or open one a teacher prepared and watch
 * it run. The deep DSL reference lives separately in the Syntax guide
 * (`models/syntax-guide.ts`); this guide points there rather than duplicating it.
 */

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
 */
export interface DocBlock {
  kind: 'lead' | 'steps' | 'points' | 'code' | 'callout' | 'image';
  text?: string;
  items?: { head: string; body: string }[];
  caption?: string;
  code?: string;
  tone?: 'tip' | 'note' | 'teacher';
  title?: string;
  /** For `image` — path under the served root (e.g. `docs/main-readable.png`). */
  src?: string;
  alt?: string;
}

/** A top-level section — one entry in the sidebar and one block of the page. */
export interface DocSection {
  /** Stable key used for the nav link and the scroll anchor. */
  id: string;
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

export const DOCS: DocSection[] = [
  {
    id: 'welcome',
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
          'The complete language — every operator, loop, graph query and canvas call — lives in the ' +
          'Syntax guide, with a worked Dijkstra at the end.',
      },
    ],
    cta: { label: 'Open the syntax guide', action: 'syntax', icon: 'code' },
  },
  {
    id: 'run',
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
];
