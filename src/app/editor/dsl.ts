/**
 * CodeMirror 6 language support for the Algoraph pseudocode DSL.
 *
 * This is editor sugar only — syntax colouring, completion, the warm-paper
 * theme and the ASCII→Unicode input helper. The real lexer / parser /
 * interpreter live elsewhere (coming next); nothing here executes code.
 */
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { Facet, RangeSetBuilder } from '@codemirror/state';
import {
  HighlightStyle,
  StreamLanguage,
  LanguageSupport,
  syntaxHighlighting,
  indentService,
} from '@codemirror/language';
import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';
import { GLOBAL_REFERENCE } from '../node-api';
import type { ExportRef } from '../models/exports';

// ── Token sets ──────────────────────────────────────────────
const KEYWORDS = new Set([
  'export', 'function', 'return', 'if', 'then', 'else', 'end', 'while', 'do',
  'for', 'each', 'in', 'continue', 'break', 'and', 'or', 'not',
]);
const ATOMS = new Set(['INFINITY', 'true', 'false', 'nil']);
const BUILTINS = new Set([
  'neighbors', 'weight', 'hasEdge', 'degree', 'inDegree', 'outDegree',
  'source', 'goal', 'nodes', 'edges',
  'visit', 'mark', 'unmark', 'markEdge', 'setLabel',
]);

// ── Stream tokenizer (shared spirit with the future lexer) ──
const dslStream = StreamLanguage.define<{ }>({
  name: 'algoraph',
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^\/\/.*/)) return 'comment';
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string';
    if (stream.match(/^\d+(?:\.\d+)?/)) return 'number';
    if (stream.match(/^(?:←|≤|≥|≠|\.\.|[=<>+\-*/%])/)) return 'operator';
    const word = stream.match(/^[A-Za-z_]\w*/) as RegExpMatchArray | null;
    if (word) {
      const w = word[0];
      if (KEYWORDS.has(w)) return 'keyword';
      if (ATOMS.has(w)) return 'atom';
      if (BUILTINS.has(w)) return 'builtin';
      if (stream.peek() === '(') return 'func';
      return 'variable';
    }
    stream.next();
    return null;
  },
  tokenTable: {
    keyword: t.keyword,
    atom: t.atom,
    number: t.number,
    string: t.string,
    comment: t.lineComment,
    operator: t.operator,
    builtin: t.standard(t.variableName),
    func: t.function(t.variableName),
    variable: t.variableName,
  },
  languageData: { commentTokens: { line: '//' }, indentOnInput: /^\s*(?:end|else)$/ },
});

// ── Highlight palette (Postwerk tokens) ─────────────────────
const dslHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--accent)', fontWeight: '600' },
  { tag: t.lineComment, color: 'var(--fg-subtle)', fontStyle: 'italic' },
  { tag: t.number, color: 'var(--tone-violet)' },
  { tag: t.string, color: 'var(--success)' },
  { tag: t.operator, color: 'var(--fg-muted)' },
  { tag: t.atom, color: 'var(--tone-amber)', fontWeight: '600' },
  { tag: t.standard(t.variableName), color: 'oklch(0.6 0.13 230)' }, // built-ins
  { tag: t.function(t.variableName), color: 'var(--accent)' },        // call sites
  { tag: t.variableName, color: 'var(--fg)' },
]);

// ── Completion (built from the node-api catalog) ────────────
const KEYWORD_COMPLETIONS: Completion[] = [
  'export', 'function', 'return', 'if', 'then', 'else', 'end', 'while', 'do',
  'for each', 'in', 'continue', 'break', 'and', 'or', 'not', 'INFINITY',
].map((label) => ({ label, type: label === 'INFINITY' ? 'constant' : 'keyword' }));

const API_COMPLETIONS: Completion[] = GLOBAL_REFERENCE.groups
  .filter((g) => g.title !== 'Language')
  .flatMap((g) => g.members)
  .map((m) => {
    const name = /^[A-Za-z_]\w*/.exec(m.sig)?.[0] ?? m.sig;
    return {
      label: name,
      type: 'function',
      detail: m.returns ? `: ${m.returns}` : '',
      info: m.cost ? `${m.desc}  ·  ${m.cost}` : m.desc,
    } satisfies Completion;
  });

const ALL_COMPLETIONS = [...KEYWORD_COMPLETIONS, ...API_COMPLETIONS];

/** A name in scope, fed in from the canvas (the graph + the placed data structures). */
export interface EditorGlobal {
  name: string;
  type: string;
  members?: { label: string; detail?: string; info?: string }[];
}

/** Current globals — reconfigured from Angular whenever the canvas changes. */
export const globalsFacet = Facet.define<EditorGlobal[], EditorGlobal[]>({
  combine: (values) => values.flat(),
});

/** Exported helpers in scope — reconfigured whenever a module file changes. */
export const exportsFacet = Facet.define<ExportRef[], ExportRef[]>({
  combine: (values) => values.flat(),
});

function dslAutocomplete(context: CompletionContext): CompletionResult | null {
  const globals = context.state.facet(globalsFacet);
  const exports = context.state.facet(exportsFacet);

  // Member access: `ident.partial` → suggest that variable's methods.
  const dotted = context.matchBefore(/[A-Za-z_]\w*\.\w*/);
  if (dotted) {
    const m = /^([A-Za-z_]\w*)\.(\w*)$/.exec(dotted.text);
    if (!m) return null;
    const owner = globals.find((g) => g.name === m[1]);
    if (!owner?.members?.length) return null;
    return {
      from: dotted.from + m[1].length + 1,
      options: owner.members.map((mm) => ({
        label: mm.label,
        type: 'method',
        detail: mm.detail ?? '',
        info: mm.info,
      })),
      validFor: /^\w*$/,
    };
  }

  const word = context.matchBefore(/[\w]+/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  const names: Completion[] = globals.map((g) => ({
    label: g.name,
    type: 'variable',
    detail: `: ${g.type}`,
  }));
  const exported: Completion[] = exports.map((e) => ({
    label: e.name,
    type: 'function',
    detail: `(${e.params})`,
    info: `Exported helper · ${e.file}`,
  }));
  return {
    from: word.from,
    options: [...names, ...exported, ...ALL_COMPLETIONS],
    validFor: /^[\w]*$/,
  };
}

// ── ASCII → Unicode while typing (<- ≤ ≥ ≠) ─────────────────
const DIGRAPHS: Record<string, Record<string, string>> = {
  '-': { '<': '←' },
  '=': { '<': '≤', '>': '≥', '!': '≠' },
};

const aliasInput = EditorView.inputHandler.of((view, from, to, text) => {
  const map = DIGRAPHS[text];
  if (!map) return false;
  const prev = view.state.sliceDoc(from - 1, from);
  const glyph = map[prev];
  if (!glyph) return false;
  view.dispatch({
    changes: { from: from - 1, to, insert: glyph },
    selection: { anchor: from - 1 + glyph.length },
    userEvent: 'input.type',
  });
  return true;
});

// ── Indent guides — a vertical line per nesting level (book style) ──
const INDENT_UNIT = 2;

function leadingWidth(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ' ') n += 1;
    else if (text[i] === '\t') n += INDENT_UNIT;
    else return n;
  }
  return n; // whitespace-only line
}

const indentGuides = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      const doc = view.state.doc;
      for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to; ) {
          const line = doc.lineAt(pos);
          const depth = this.depthAt(view, line.number);
          if (depth > 0) {
            builder.add(
              line.from,
              line.from,
              Decoration.line({ attributes: { class: 'cm-indent-guides', style: `--cm-indent:${depth}` } }),
            );
          }
          pos = line.to + 1;
        }
      }
      return builder.finish();
    }
    /** A blank line keeps the guides that span across it (min of its neighbours). */
    private depthAt(view: EditorView, lineNo: number): number {
      const doc = view.state.doc;
      const text = doc.line(lineNo).text;
      if (text.trim() !== '') return Math.floor(leadingWidth(text) / INDENT_UNIT);
      let prev = 0;
      for (let i = lineNo - 1; i >= 1; i--) {
        const t = doc.line(i).text;
        if (t.trim() !== '') { prev = leadingWidth(t); break; }
      }
      let next = 0;
      for (let i = lineNo + 1; i <= doc.lines; i++) {
        const t = doc.line(i).text;
        if (t.trim() !== '') { next = leadingWidth(t); break; }
      }
      return Math.floor(Math.min(prev, next) / INDENT_UNIT);
    }
  },
  { decorations: (v) => v.decorations },
);

// ── Auto-indent: open a level after `do`/`then`, dedent `end`/`else` ──
const BLOCK_OPENER = /\b(?:do|then)\s*$/;
const BLOCK_CLOSER = /^\s*(?:end|else)\b/;

const dslIndentService = indentService.of((context, pos) => {
  const doc = context.state.doc;
  // `lineAt(pos, ±1)` respects the simulated line break Enter inserts.
  const current = context.lineAt(pos, 1); // the line being indented (the new line on Enter)
  const before = context.lineAt(pos, -1); // content before the break
  // Nearest non-blank line at or above `before`.
  let prevText = '';
  for (let n = doc.lineAt(before.from).number; n >= 1; n--) {
    const t = doc.line(n).text;
    if (t.trim() !== '') { prevText = t; break; }
  }
  let indent = leadingWidth(prevText);
  if (BLOCK_OPENER.test(prevText)) indent += INDENT_UNIT;
  if (BLOCK_CLOSER.test(current.text)) indent -= INDENT_UNIT;
  return Math.max(0, indent);
});

// ── Warm-paper theme ────────────────────────────────────────
const postwerkTheme = EditorView.theme(
  {
    '&': { color: 'var(--fg)', backgroundColor: 'transparent', height: '100%' },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', fontSize: '13px', lineHeight: '1.7' },
    '.cm-content': { padding: '14px 0', caretColor: 'var(--accent)' },
    '.cm-line': { padding: '0 16px' },
    '.cm-line.cm-indent-guides': {
      backgroundImage:
        'repeating-linear-gradient(to right, color-mix(in srgb, var(--fg-subtle) 42%, transparent) 0 1px, transparent 1px 2ch)',
      backgroundRepeat: 'no-repeat',
      backgroundPositionX: '16px',
      backgroundSize: 'calc(var(--cm-indent) * 2ch) 100%',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      border: 'none',
      color: 'var(--fg-subtle)',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 14px', minWidth: '34px' },
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 5%, transparent)' },
    // The line the Run workspace is executing — a debugger-style cursor.
    '.cm-line.cm-run-current': {
      backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)',
      boxShadow: 'inset 3px 0 0 var(--accent)',
    },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--fg-muted)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'color-mix(in srgb, var(--accent) 16%, transparent)',
    },
    '.cm-matchingBracket': {
      backgroundColor: 'color-mix(in srgb, var(--accent) 18%, transparent)',
      outline: 'none',
    },
    // Autocomplete popup
    '.cm-tooltip': {
      background: 'var(--bg)',
      border: '0.5px solid var(--border-strong)',
      borderRadius: '10px',
      boxShadow: '0 10px 30px -10px rgba(34,28,18,0.28)',
      overflow: 'hidden',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-mono)', maxHeight: '15em' },
    '.cm-tooltip-autocomplete ul li': { padding: '4px 10px', color: 'var(--fg-muted)' },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
      color: 'var(--fg)',
    },
    '.cm-completionLabel': { color: 'var(--fg)' },
    '.cm-completionDetail': { color: 'var(--fg-subtle)', fontStyle: 'normal', marginLeft: '6px' },
    '.cm-completionIcon': { color: 'var(--fg-subtle)', paddingRight: '6px' },
    '.cm-tooltip.cm-completionInfo': {
      fontFamily: 'var(--font-sans)',
      fontSize: '12px',
      lineHeight: '1.5',
      color: 'var(--fg-muted)',
      padding: '9px 11px',
      maxWidth: '260px',
    },
  },
  { dark: false },
);

/** Everything the editor needs to speak the Algoraph DSL. */
export function algoraphLanguage() {
  return [
    new LanguageSupport(dslStream, [
      dslStream.data.of({ autocomplete: dslAutocomplete }),
    ]),
    syntaxHighlighting(dslHighlightStyle),
    dslIndentService,
    indentGuides,
    aliasInput,
    postwerkTheme,
  ];
}
