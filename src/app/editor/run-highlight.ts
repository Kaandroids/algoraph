/**
 * CodeMirror extension that highlights the line the Run workspace is currently
 * executing — a debugger-style cursor driven from Angular, not from the editor.
 *
 * The host component dispatches `setCurrentLine` with a 1-based line (or null to
 * clear) as the step changes; the field turns it into a single line decoration.
 */
import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

/** Set the executing line (1-based), or clear the highlight with `null`. */
export const setCurrentLine = StateEffect.define<number | null>();

const currentLineMark = Decoration.line({ class: 'cm-run-current' });

const currentLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setCurrentLine)) continue;
      const line = effect.value;
      if (line == null || line < 1 || line > tr.state.doc.lines) return Decoration.none;
      return Decoration.set([currentLineMark.range(tr.state.doc.line(line).from)]);
    }
    return decorations.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function runHighlight(): Extension {
  return [currentLineField];
}
