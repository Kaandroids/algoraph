/**
 * CodeMirror extension that underlines diagnostic lines (errors / warnings)
 * driven from Angular — the compiler produces diagnostics per file, the host
 * component dispatches them, and the field turns each into a line-wide mark with
 * the message on hover. Self-contained; no @codemirror/lint dependency.
 */
import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

/** A diagnostic to show — a 1-based line, its severity and the message. */
export interface EditorDiagnostic {
  line: number;
  severity: 'error' | 'warning';
  message: string;
}

/** Replace the editor's diagnostics. */
export const setDiagnostics = StateEffect.define<EditorDiagnostic[]>();

const diagnosticsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setDiagnostics)) continue;
      const byLine = new Map<number, EditorDiagnostic>(); // one mark per line, first wins
      for (const d of effect.value) if (!byLine.has(d.line)) byLine.set(d.line, d);
      const ranges = [...byLine.values()]
        .filter((d) => d.line >= 1 && d.line <= tr.state.doc.lines)
        .map((d) => ({ d, line: tr.state.doc.line(d.line) }))
        .filter((x) => x.line.to > x.line.from) // skip empty lines (nothing to underline)
        .sort((a, b) => a.line.from - b.line.from)
        .map((x) =>
          Decoration.mark({
            class: x.d.severity === 'error' ? 'cm-diag-error' : 'cm-diag-warn',
            attributes: { title: x.d.message },
          }).range(x.line.from, x.line.to),
        );
      return Decoration.set(ranges);
    }
    return decorations.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function diagnosticsHighlight(): Extension {
  return [diagnosticsField];
}
