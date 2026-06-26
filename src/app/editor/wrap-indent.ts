/**
 * Hang soft-wrapped lines under their own indentation instead of snapping the
 * continuation back to column 0. A long statement that wraps then stays visually
 * aligned with where its content starts.
 *
 * Indentation is purely cosmetic in this DSL — blocks are `do … end` / `then …
 * end` and statements end at a newline, so leading whitespace is skipped by the
 * lexer. This is readability only, used by the read-only (line-wrapped) Run rail.
 */
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder, type Extension } from '@codemirror/state';

export function wrapIndent(): Extension {
  return ViewPlugin.fromClass(
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
        for (const { from, to } of view.visibleRanges) {
          for (let pos = from; pos <= to; ) {
            const line = view.state.doc.lineAt(pos);
            // Leading whitespace, in characters; one `ch` per char in a monospace font.
            const indent = /^[ \t]*/.exec(line.text)![0].length;
            if (indent > 0) {
              // Keep the editor's base line padding (.cm-line is `0 16px`) — adding only
              // the indent — so the text stays put and merely the wrap hangs under it.
              builder.add(
                line.from,
                line.from,
                Decoration.line({
                  attributes: { style: `text-indent: -${indent}ch; padding-left: calc(16px + ${indent}ch)` },
                }),
              );
            }
            pos = line.to + 1;
          }
        }
        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations },
  );
}
