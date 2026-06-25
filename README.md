# Algoraph

**Algoraph** is an interactive graph-algorithm learning platform that runs entirely in the
browser — no backend.

You build a graph (nodes + directed/bidirectional, weighted edges), write an algorithm in a
small **pseudocode** language in the code panel, and Algoraph runs it **step by step**,
visualizing every step on the graph while **counting operations** so you can see the
algorithm's complexity emerge.

## Status

Early scaffold. Working:

- Angular 21 (standalone, signals), static SPA — no SSR, no backend.
- App shell: top bar + graph canvas + pseudocode/counters panels.
- Graph rendering via [`@foblex/flow`](https://flow.foblex.com) with a sample graph.

### Roadmap

1. **Graph editor** — create/delete nodes & edges, toggle directed/bidirectional, set weights.
2. **Pseudocode language** — lexer + parser + tree-walking interpreter (CodeMirror 6 editor,
   custom syntax highlighting, hover annotations).
3. **Step player** — run the interpreter to a trace; play / pause / step forward / step back.
4. **Operation counting & complexity** — categorized counters + empirical complexity view.

## Pseudocode language (design)

- Assignment with `←`, comparison with `=` / `<` / `>`.
- Explicit blocks: `do ... end`, `then ... end`.
- Comments with `//`; longer per-line explanations live in a separate annotation layer,
  shown on hover.

## Tech

- [Angular 21](https://angular.dev)
- [Foblex Flow](https://flow.foblex.com) — node-based graph canvas
- [CodeMirror 6](https://codemirror.net) — code editor

## Development

```bash
npm start        # dev server at http://localhost:4200/
npm run build    # production build into dist/
npm test         # unit tests (Vitest)
```
