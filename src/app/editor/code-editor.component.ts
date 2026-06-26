import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  effect,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import {
  EditorView,
  keymap,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
} from '@codemirror/view';
import { Compartment, EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { indentOnInput, bracketMatching } from '@codemirror/language';
import {
  autocompletion,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
} from '@codemirror/autocomplete';
import { algoraphLanguage, globalsFacet, exportsFacet, type EditorGlobal } from './dsl';
import { runHighlight, setCurrentLine } from './run-highlight';
import { diagnosticsHighlight, setDiagnostics, type EditorDiagnostic } from './diagnostics';
import type { ExportRef } from '../models/exports';
import {
  lineNotes,
  lineNotesReadonly,
  loadNotes,
  notesChanged,
  notesFromState,
  type LineNote,
} from './line-notes';

function sameNotes(a: LineNote[], b: LineNote[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((n, i) => n.line === b[i].line && n.text === b[i].text);
}

/**
 * Thin CodeMirror 6 wrapper. Two-way bound to `content`; swapping the bound
 * value (e.g. switching file tabs) replaces the document. All DSL flavour —
 * highlighting, completion, ASCII→Unicode, theme — lives in `dsl.ts`.
 */
@Component({
  selector: 'app-code-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #host class="cm-host"></div>`,
  styles: [
    `
      :host { display: block; height: 100%; min-height: 0; }
      .cm-host { height: 100%; }
      .cm-host .cm-editor { height: 100%; }
    `,
  ],
})
export class CodeEditorComponent {
  readonly content = model<string>('');
  /** Names in scope (graph + canvas data structures) for autocomplete. */
  readonly globals = input<EditorGlobal[]>([]);
  /** Exported helpers across all files, offered as call completions. */
  readonly exports = input<ExportRef[]>([]);
  /** Per-line notes for the active file (addressed by line number). */
  readonly notes = input<LineNote[]>([]);
  readonly notesChange = output<LineNote[]>();
  /** Read-only viewer (Run workspace) — no editing, notes shown on hover. */
  readonly readOnly = input<boolean>(false);
  /** 1-based line the Run workspace is executing (null clears the highlight). */
  readonly activeLine = input<number | null>(null);
  /** Compiler diagnostics for this file — underlined with the message on hover. */
  readonly diagnostics = input<EditorDiagnostic[]>([]);
  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private readonly globalsComp = new Compartment();
  private readonly exportsComp = new Compartment();
  private view?: EditorView;

  constructor() {
    afterNextRender(() => this.init());

    // External content / notes change (file switch) → swap the document and its
    // notes atomically so notes never map onto a different file's text.
    effect(() => {
      const next = this.content();
      const notes = this.notes();
      const view = this.view;
      if (!view) return;
      if (view.state.doc.toString() !== next) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: next },
          effects: loadNotes.of(notes),
        });
      } else if (!sameNotes(notesFromState(view.state), notes)) {
        view.dispatch({ effects: loadNotes.of(notes) });
      }
    });

    // Canvas globals changed → reconfigure the autocomplete facet.
    effect(() => {
      const globals = this.globals();
      this.view?.dispatch({ effects: this.globalsComp.reconfigure(globalsFacet.of(globals)) });
    });

    // Exported helpers changed (a module edited) → reconfigure their facet.
    effect(() => {
      const exports = this.exports();
      this.view?.dispatch({ effects: this.exportsComp.reconfigure(exportsFacet.of(exports)) });
    });

    // Run step changed → move the executing-line highlight and scroll to it.
    effect(() => {
      const line = this.activeLine();
      this.applyActiveLine(line);
    });

    // Compiler diagnostics changed → re-underline.
    effect(() => {
      const diagnostics = this.diagnostics();
      this.view?.dispatch({ effects: setDiagnostics.of(diagnostics) });
    });
  }

  /** Move the run highlight to a 1-based line (null clears it) and scroll to it. */
  private applyActiveLine(line: number | null): void {
    const view = this.view;
    if (!view) return;
    const valid = line != null && line >= 1 && line <= view.state.doc.lines;
    const pos = valid ? view.state.doc.line(line).from : null;
    view.dispatch({
      effects: [
        setCurrentLine.of(valid ? line : null),
        ...(pos != null ? [EditorView.scrollIntoView(pos, { y: 'center' })] : []),
      ],
    });
  }

  private init(): void {
    const ro = this.readOnly();
    const state = EditorState.create({
      doc: this.content(),
      extensions: [
        ro ? lineNotesReadonly : lineNotes,
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        drawSelection(),
        dropCursor(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        this.globalsComp.of(globalsFacet.of(this.globals())),
        this.exportsComp.of(exportsFacet.of(this.exports())),
        runHighlight(),
        diagnosticsHighlight(),
        algoraphLanguage(),
        ...(ro
          ? [EditorState.readOnly.of(true), EditorView.editable.of(false), EditorView.lineWrapping]
          : []),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) this.content.set(u.state.doc.toString());
          if (notesChanged(u)) this.notesChange.emit(notesFromState(u.state));
        }),
      ],
    });
    this.view = new EditorView({ state, parent: this.host().nativeElement });
    // Apply any current run highlight + diagnostics now that the view exists.
    this.applyActiveLine(this.activeLine());
    this.view.dispatch({ effects: setDiagnostics.of(this.diagnostics()) });
  }
}
