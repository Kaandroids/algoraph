/**
 * Indentation support for the pseudocode editor: a vertical guide per nesting
 * level (book style) and auto-indent that opens a level after `do` / `then` and
 * dedents `end` / `else`. Composed into the editor by `algoraphLanguage()`.
 */
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { indentService } from '@codemirror/language';

const INDENT_UNIT = 2;

/** Leading-whitespace width of a line (tabs count as one indent unit). */
function leadingWidth(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ' ') n += 1;
    else if (text[i] === '\t') n += INDENT_UNIT;
    else return n;
  }
  return n; // whitespace-only line
}

// ── Indent guides — a vertical line per nesting level (book style) ──
export const indentGuides = ViewPlugin.fromClass(
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

export const dslIndentService = indentService.of((context, pos) => {
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
