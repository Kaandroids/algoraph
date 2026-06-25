/**
 * Per-line notes for the algorithm editor.
 *
 * Click a line number to attach a short note to that line. Notes are anchored
 * to a document position, so they ride up and down as lines are inserted or
 * removed above them. A dot in a slim gutter marks lines that carry a note.
 *
 * Only the authoring side lives here; surfacing notes during a run (snackbar /
 * hover) comes later. Notes are mirrored out to Angular via `notesChanged`.
 */
import {
  EditorView,
  GutterMarker,
  gutter,
  lineNumbers,
  showTooltip,
  type Tooltip,
  type ViewUpdate,
} from '@codemirror/view';
import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';

/** A note as seen by Angular — addressed by 1-based line number. */
export interface LineNote {
  line: number;
  text: string;
}

/** Internally a note is anchored to the line-start position so it follows edits. */
interface Anchored {
  from: number;
  text: string;
}

const saveNote = StateEffect.define<{ from: number; text: string }>();
const setEditing = StateEffect.define<number | null>();
/** Replace all notes — used to load a file's notes when the document is swapped. */
export const loadNotes = StateEffect.define<LineNote[]>();

const notesField = StateField.define<Anchored[]>({
  create: () => [],
  update(notes, tr) {
    let next = tr.docChanged ? notes.map((n) => ({ ...n, from: tr.changes.mapPos(n.from, 1) })) : notes;
    for (const e of tr.effects) {
      if (e.is(saveNote)) {
        const lineNo = tr.state.doc.lineAt(e.value.from).number;
        next = next.filter((n) => tr.state.doc.lineAt(n.from).number !== lineNo);
        if (e.value.text.trim()) next = [...next, { from: tr.state.doc.line(lineNo).from, text: e.value.text.trim() }];
      } else if (e.is(loadNotes)) {
        next = e.value
          .filter((n) => n.text.trim() && n.line >= 1 && n.line <= tr.state.doc.lines)
          .map((n) => ({ from: tr.state.doc.line(n.line).from, text: n.text.trim() }));
      }
    }
    return next;
  },
});

/** The line currently being edited (its start position), or null. Drives the tooltip. */
const editingField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    let v = value != null && tr.docChanged ? tr.changes.mapPos(value) : value;
    for (const e of tr.effects) if (e.is(setEditing)) v = e.value;
    return v;
  },
  provide: (f) => showTooltip.from(f, noteTooltip),
});

function noteTooltip(pos: number | null): Tooltip | null {
  if (pos == null) return null;
  return {
    pos,
    above: false,
    arrow: false,
    create(view) {
      const dom = document.createElement('div');
      dom.className = 'cm-note-tooltip';
      const ta = document.createElement('textarea');
      ta.placeholder = 'Note for this line…';
      ta.rows = 3;
      const lineNo = view.state.doc.lineAt(pos).number;
      const existing = view.state
        .field(notesField)
        .find((n) => view.state.doc.lineAt(n.from).number === lineNo);
      ta.value = existing?.text ?? '';
      const hint = document.createElement('div');
      hint.className = 'cm-note-hint';
      hint.textContent = '⌘/Ctrl + ↵ to save · Esc to cancel';
      dom.appendChild(ta);
      dom.appendChild(hint);
      setTimeout(() => {
        ta.focus();
        ta.select();
      }, 0);
      const commit = () =>
        view.dispatch({ effects: [saveNote.of({ from: pos, text: ta.value }), setEditing.of(null)] });
      ta.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          commit();
          view.focus();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          view.dispatch({ effects: setEditing.of(null) });
          view.focus();
        }
      });
      ta.addEventListener('blur', commit);
      return { dom };
    },
  };
}

/** Line-start position of the note currently being dragged, or null. */
let draggingFrom: number | null = null;

class NoteDot extends GutterMarker {
  constructor(
    readonly from: number,
    readonly text: string,
    readonly drag: boolean,
  ) {
    super();
  }
  override eq(other: GutterMarker) {
    return (
      other instanceof NoteDot &&
      other.from === this.from &&
      other.text === this.text &&
      other.drag === this.drag
    );
  }
  override toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-note-dot';
    if (this.drag) {
      el.draggable = true;
      el.style.cursor = 'grab';
      el.title = this.text ? `${this.text}\n— drag to move` : 'Drag to move this note';
      el.addEventListener('dragstart', (e) => {
        draggingFrom = this.from;
        e.dataTransfer?.setData('application/x-algoraph-note', '1');
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
      el.addEventListener('dragend', () => {
        draggingFrom = null;
      });
    } else {
      el.style.cursor = 'help';
      el.title = this.text;
    }
    return el;
  }
}

const openEditor = (view: EditorView, line: { from: number }): boolean => {
  view.dispatch({ effects: setEditing.of(line.from) });
  return true;
};

function makeNoteGutter(drag: boolean) {
  return gutter({
    class: 'cm-note-gutter',
    markers(view) {
      const builder = new RangeSetBuilder<GutterMarker>();
      const seen = new Set<number>();
      for (const n of view.state.field(notesField)) {
        const line = view.state.doc.lineAt(n.from);
        if (seen.has(line.number)) continue;
        seen.add(line.number);
        builder.add(line.from, line.from, new NoteDot(line.from, n.text, drag));
      }
      return builder.finish();
    },
  });
}
const editGutter = makeNoteGutter(true);
const readGutter = makeNoteGutter(false);

const noteLineNumbers = lineNumbers({ domEventHandlers: { mousedown: openEditor } });

/** Drag a note dot onto another line to move the note there. */
const noteDnd = EditorView.domEventHandlers({
  dragover(e) {
    if (draggingFrom == null) return false;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    return false;
  },
  drop(e, view) {
    if (draggingFrom == null) return false;
    e.preventDefault();
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }, false);
    const srcLineNo = view.state.doc.lineAt(draggingFrom).number;
    const src = view.state.field(notesField).find((n) => view.state.doc.lineAt(n.from).number === srcLineNo);
    const targetLine = view.state.doc.lineAt(pos);
    if (src && targetLine.number !== srcLineNo) {
      view.dispatch({
        effects: [
          saveNote.of({ from: src.from, text: '' }),
          saveNote.of({ from: targetLine.from, text: src.text }),
        ],
      });
    }
    draggingFrom = null;
    return true;
  },
});

const noteTheme = EditorView.theme({
  '.cm-lineNumbers .cm-gutterElement': { cursor: 'pointer' },
  '.cm-lineNumbers .cm-gutterElement:hover': { color: 'var(--accent)' },
  '.cm-note-gutter': { width: '11px' },
  '.cm-note-gutter .cm-gutterElement': { display: 'flex', justifyContent: 'center' },
  '.cm-note-dot': {
    width: '5px',
    height: '5px',
    marginTop: '0.62em',
    borderRadius: '50%',
    background: 'var(--accent)',
    cursor: 'grab',
  },
  '.cm-note-tooltip': {
    padding: '7px',
    background: 'var(--bg)',
    border: '0.5px solid var(--border-strong)',
    borderRadius: '10px',
    boxShadow: '0 10px 28px -10px rgba(34, 28, 18, 0.3)',
  },
  '.cm-note-tooltip textarea': {
    display: 'block',
    width: '260px',
    minHeight: '54px',
    maxHeight: '170px',
    padding: '6px 9px',
    border: '0.5px solid var(--border)',
    borderRadius: '7px',
    background: 'var(--field-bg)',
    color: 'var(--fg)',
    font: 'inherit',
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
    lineHeight: '1.5',
    resize: 'vertical',
    outline: 'none',
  },
  '.cm-note-hint': {
    marginTop: '5px',
    fontSize: '10px',
    fontFamily: 'var(--font-sans)',
    color: 'var(--fg-subtle)',
    textAlign: 'right',
  },
});

/** Line numbers + the note dot gutter + click-to-edit tooltip. Replaces `lineNumbers()`. */
/** Interactive notes — click a line number to add/edit, drag a dot to move. */
export const lineNotes: Extension = [
  notesField,
  editingField,
  editGutter,
  noteLineNumbers,
  noteTheme,
  noteDnd,
];

/** Read-only notes — dots only, with the note shown on hover (for the Run view). */
export const lineNotesReadonly: Extension = [notesField, readGutter, lineNumbers(), noteTheme];

/** Current notes, addressed by line number — for mirroring to Angular. */
export function notesFromState(state: EditorView['state']): LineNote[] {
  return state
    .field(notesField)
    .map((n) => ({ line: state.doc.lineAt(n.from).number, text: n.text }))
    .sort((a, b) => a.line - b.line);
}

/** Whether this update changed the set of notes. */
export function notesChanged(update: ViewUpdate): boolean {
  return update.startState.field(notesField) !== update.state.field(notesField);
}
