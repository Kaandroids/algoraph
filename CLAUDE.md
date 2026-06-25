# Algoraph — Project Guide

## Language convention (important)

**English is the working language of this repository.** Everything that is part of the
codebase is written in English — no exceptions:

- source code: identifiers (classes, methods, variables), file and branch names
- code comments and JSDoc
- commit messages and pull-request titles & bodies
- **user-facing UI text / product copy** — Algoraph's interface is English-only
- documentation, READMEs, config comments

> Unlike a bilingual product, Algoraph has **no i18n exception**: every string the user
> sees in the app is also English. If you find Turkish (or any non-English) text in a
> source file, treat it as a bug and translate it to English.

The chat with the maintainer may be in Turkish, but nothing in this repository is.

## Project overview

Algoraph is an interactive **graph-algorithm learning platform** that runs entirely in the
browser (no backend). A user builds a graph (nodes + directed/bidirectional, weighted
edges), writes an algorithm in a small custom **pseudocode DSL** in the code panel, and the
app runs it **step by step** — visualizing each step on the graph and **counting
operations** so the algorithm's complexity becomes visible.

## Tech stack

- **Angular 21** — standalone components, signals, SCSS. Static SPA, **no SSR / no backend**
  (deployable as static files, e.g. GitHub Pages).
- **[Foblex Flow](https://flow.foblex.com)** (`@foblex/flow`) — node-based graph canvas.
- **[CodeMirror 6](https://codemirror.net)** — the pseudocode editor.

## Conventions

- DRY, feature-based folder layout; prefer signals over RxJS for component state.
- Design tokens / palette live in `src/styles/_themes.scss` (the shared "Postwerk" design
  system — warm-paper light theme + dark variants, Geist fonts). Use the CSS custom
  properties (`--bg`, `--fg`, `--accent`, …); do not hard-code colors.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, …).

## Pseudocode DSL (design)

- Assignment `←`, comparison `=` / `<` / `>`.
- Explicit blocks: `do ... end`, `then ... end`.
- Comments with `//`; longer per-line explanations live in a separate annotation layer,
  shown on hover. Textbook (CLRS) style.

## Dev

```bash
npm start        # dev server at http://localhost:4200/
npm run build    # production build into dist/
npm test         # unit tests (Vitest)
```
