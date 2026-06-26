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
  Decoration,
  EditorView,
  GutterMarker,
  WidgetType,
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

      const lineNo = view.state.doc.lineAt(pos).number;
      const existing = view.state
        .field(notesField)
        .find((n) => view.state.doc.lineAt(n.from).number === lineNo);

      const ta = document.createElement('textarea');
      ta.placeholder = 'Note for this line…  (**bold**, *italic*, - list)';
      ta.rows = 4;
      ta.value = existing?.text ?? '';

      // ── Formatting toolbar — buttons keep the textarea's focus (mousedown
      //    preventDefault) so clicking them never blurs/commits the note. ──
      const wrap = (before: string, after: string, placeholder: string) => {
        const { selectionStart: a, selectionEnd: b, value } = ta;
        const sel = value.slice(a, b) || placeholder;
        ta.value = value.slice(0, a) + before + sel + after + value.slice(b);
        ta.focus();
        ta.selectionStart = a + before.length;
        ta.selectionEnd = a + before.length + sel.length;
      };
      const prefixLine = (prefix: string) => {
        const { selectionStart: a, value } = ta;
        const start = value.lastIndexOf('\n', a - 1) + 1;
        ta.value = value.slice(0, start) + prefix + value.slice(start);
        ta.focus();
        ta.selectionStart = ta.selectionEnd = a + prefix.length;
      };
      const tool = (label: string, title: string, run: () => void, cls = '') => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `cm-note-tool ${cls}`.trim();
        b.title = title;
        b.textContent = label;
        b.addEventListener('mousedown', (e) => {
          e.preventDefault();
          run();
        });
        return b;
      };
      const tools = document.createElement('div');
      tools.className = 'cm-note-tools';
      tools.append(
        tool('B', 'Bold', () => wrap('**', '**', 'bold'), 'is-bold'),
        tool('I', 'Italic', () => wrap('*', '*', 'italic'), 'is-italic'),
        tool('•', 'List item', () => prefixLine('- ')),
      );

      let done = false;
      const commit = () => {
        if (done) return;
        done = true;
        view.dispatch({ effects: [saveNote.of({ from: pos, text: ta.value }), setEditing.of(null)] });
      };

      // ── Footer — hint + Clear + Save ──
      const hint = document.createElement('span');
      hint.className = 'cm-note-hint';
      hint.textContent = '⌘/Ctrl + ↵';
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'cm-note-btn';
      clearBtn.textContent = 'Clear';
      clearBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        ta.value = '';
        ta.focus();
      });
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'cm-note-btn cm-note-btn-primary';
      saveBtn.textContent = 'Save';
      saveBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        commit();
        view.focus();
      });
      const btns = document.createElement('div');
      btns.className = 'cm-note-btns';
      btns.append(clearBtn, saveBtn);
      const foot = document.createElement('div');
      foot.className = 'cm-note-foot';
      foot.append(hint, btns);

      dom.append(tools, ta, foot);

      setTimeout(() => {
        ta.focus();
        ta.select();
      }, 0);

      ta.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          commit();
          view.focus();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          done = true; // cancel — don't let the deferred blur save afterwards
          view.dispatch({ effects: setEditing.of(null) });
          view.focus();
        }
      });
      // Save on click-away (focus leaves the whole tooltip). Deferred so it never
      // dispatches while a CodeMirror update is mid-flight.
      dom.addEventListener('focusout', (e) => {
        if (dom.contains(e.relatedTarget as Node | null)) return; // moving within the tooltip
        setTimeout(() => commit(), 0);
      });

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
    padding: '8px',
    background: 'var(--bg)',
    border: '0.5px solid var(--border-strong)',
    borderRadius: '12px',
    boxShadow: '0 14px 34px -12px rgba(34, 28, 18, 0.34)',
  },
  '.cm-note-tools': {
    display: 'flex',
    gap: '4px',
    marginBottom: '7px',
  },
  '.cm-note-tool': {
    width: '26px',
    height: '26px',
    display: 'grid',
    placeItems: 'center',
    border: '0.5px solid var(--border)',
    borderRadius: '7px',
    background: 'var(--bg-2)',
    color: 'var(--fg-muted)',
    fontFamily: 'var(--font-sans)',
    fontSize: '13px',
    cursor: 'pointer',
  },
  '.cm-note-tool:hover': { color: 'var(--accent)', borderColor: 'var(--accent)' },
  '.cm-note-tool.is-bold': { fontWeight: '700' },
  '.cm-note-tool.is-italic': { fontStyle: 'italic', fontFamily: 'var(--font-serif)' },
  '.cm-note-tooltip textarea': {
    display: 'block',
    width: '320px',
    minHeight: '96px',
    maxHeight: '220px',
    padding: '9px 11px',
    border: '0.5px solid var(--border)',
    borderRadius: '9px',
    background: 'var(--field-bg)',
    color: 'var(--fg)',
    font: 'inherit',
    fontFamily: 'var(--font-sans)',
    fontSize: '13px',
    lineHeight: '1.55',
    resize: 'vertical',
    outline: 'none',
  },
  '.cm-note-tooltip textarea:focus': {
    borderColor: 'var(--accent)',
    boxShadow: '0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent)',
  },
  '.cm-note-foot': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: '8px',
  },
  '.cm-note-hint': {
    fontSize: '10.5px',
    fontFamily: 'var(--font-sans)',
    color: 'var(--fg-subtle)',
  },
  '.cm-note-btns': { display: 'flex', gap: '6px' },
  '.cm-note-btn': {
    padding: '5px 12px',
    border: '0.5px solid var(--border)',
    borderRadius: '8px',
    background: 'var(--bg-2)',
    color: 'var(--fg)',
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
  },
  '.cm-note-btn:hover': { borderColor: 'var(--border-strong)', background: 'var(--bg)' },
  '.cm-note-btn-primary': {
    border: '0.5px solid transparent',
    background: 'var(--accent)',
    color: '#fff',
  },
  '.cm-note-btn-primary:hover': { filter: 'brightness(1.07)', background: 'var(--accent)' },
  // Run view: a noted line is clickable; clicking opens the note card below it.
  '.cm-note-line': { cursor: 'pointer' },
  '.cm-note-line:hover': { background: 'color-mix(in srgb, var(--accent) 5%, transparent)' },
  '.cm-note-block': {
    margin: '3px 14px 8px 38px',
    padding: '9px 12px 9px 13px',
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
    lineHeight: '1.55',
    color: 'var(--fg)',
    background: 'var(--bg-2)',
    border: '0.5px solid var(--border)',
    borderLeft: '2.5px solid var(--accent)',
    borderRadius: '9px',
    boxShadow: '0 1px 3px rgba(34, 28, 18, 0.05)',
  },
  '.cm-note-block p': { margin: '0' },
  '.cm-note-block p + p, .cm-note-block p + ul, .cm-note-block ul + p': { marginTop: '5px' },
  '.cm-note-block strong': { fontWeight: '650', color: 'var(--fg)' },
  '.cm-note-block em': { fontStyle: 'italic' },
  '.cm-note-block ul': { margin: '0', paddingLeft: '17px' },
  '.cm-note-block li': { marginBottom: '2px' },
  '.cm-note-block li::marker': { color: 'var(--accent)' },
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

// ── Click-to-expand notes (read-only Run view) ──────────────
/** Toggle the inline note under a line, addressed by its line-start position. */
const toggleNoteOpen = StateEffect.define<number>();

/** Line-start positions whose note is expanded inline right now. */
const expandedNotes = StateField.define<Set<number>>({
  create: () => new Set(),
  update(set, tr) {
    let next = tr.docChanged ? new Set([...set].map((p) => tr.changes.mapPos(p, 1))) : set;
    for (const e of tr.effects) {
      if (e.is(toggleNoteOpen)) {
        next = new Set(next);
        if (next.has(e.value)) next.delete(e.value);
        else next.add(e.value);
      } else if (e.is(loadNotes)) {
        next = new Set(); // a fresh document/notes set collapses everything
      }
    }
    return next;
  },
});

/** Escape HTML so user note text can never inject markup. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Inline marks on already-escaped text: `**bold**`, then `*italic*`. */
function inlineMarks(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

/**
 * Render a note's lightweight markdown to safe HTML: `**bold**`, `*italic*` and
 * `- ` bullet lists. Text is escaped first, so only our own tags reach the DOM.
 */
function renderNoteHtml(text: string): string {
  const out: string[] = [];
  let inList = false;
  for (const line of text.split('\n')) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inlineMarks(escapeHtml(bullet[1]))}</li>`);
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      if (line.trim()) out.push(`<p>${inlineMarks(escapeHtml(line))}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('');
}

/** The note text rendered as a formatted block beneath its line when expanded. */
class NoteBlock extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  override eq(other: WidgetType) {
    return other instanceof NoteBlock && other.text === this.text;
  }
  override toDOM() {
    const dom = document.createElement('div');
    dom.className = 'cm-note-block';
    dom.innerHTML = renderNoteHtml(this.text);
    return dom;
  }
}

/** Mark noted lines (the click target) and drop a note block under expanded ones. */
const noteBlocks = EditorView.decorations.compute([notesField, expandedNotes], (state) => {
  const open = state.field(expandedNotes);
  const notes = [...state.field(notesField)].sort((a, b) => a.from - b.from);
  const builder = new RangeSetBuilder<Decoration>();
  for (const n of notes) {
    const line = state.doc.lineAt(n.from);
    const isOpen = open.has(line.from);
    builder.add(line.from, line.from, Decoration.line({ class: isOpen ? 'cm-note-line cm-note-open' : 'cm-note-line' }));
    if (isOpen) {
      builder.add(line.to, line.to, Decoration.widget({ widget: new NoteBlock(n.text), block: true, side: 1 }));
    }
  }
  return builder.finish();
});

/** Click a noted line to expand/collapse its note inline (Run view). */
const noteToggleClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    if ((event.target as HTMLElement).closest('.cm-note-block')) return false; // clicks on the note itself
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;
    const line = view.state.doc.lineAt(pos);
    const noted = view.state.field(notesField).some((n) => view.state.doc.lineAt(n.from).number === line.number);
    if (!noted) return false;
    view.dispatch({ effects: toggleNoteOpen.of(line.from) });
    return false;
  },
});

/** Read-only notes — a dot marks each noted line; click the line to open the note below it. */
export const lineNotesReadonly: Extension = [
  notesField,
  expandedNotes,
  readGutter,
  lineNumbers(),
  noteBlocks,
  noteToggleClick,
  noteTheme,
];

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
