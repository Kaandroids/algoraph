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
import { algoraphLanguage, globalsFacet, type EditorGlobal } from './dsl';
import { lineNotes, loadNotes, notesChanged, notesFromState, type LineNote } from './line-notes';

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
  /** Per-line notes for the active file (addressed by line number). */
  readonly notes = input<LineNote[]>([]);
  readonly notesChange = output<LineNote[]>();
  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private readonly globalsComp = new Compartment();
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
  }

  private init(): void {
    const state = EditorState.create({
      doc: this.content(),
      extensions: [
        lineNotes,
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
        algoraphLanguage(),
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
  }
}
