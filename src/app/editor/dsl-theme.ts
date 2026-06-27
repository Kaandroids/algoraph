/**
 * The warm-paper ("Postwerk") CodeMirror theme for the pseudocode editor —
 * colours and spacing for the gutter, active line, run cursor, diagnostics and
 * the autocomplete popup. Composed into the editor by `algoraphLanguage()`.
 */
import { EditorView } from '@codemirror/view';

export const postwerkTheme = EditorView.theme(
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
    // Compiler diagnostics — a wavy underline, message on hover (title attribute).
    '.cm-diag-error': {
      textDecoration: 'underline wavy var(--danger)',
      textDecorationSkipInk: 'none',
    },
    '.cm-diag-warn': {
      textDecoration: 'underline wavy var(--warning)',
      textDecorationSkipInk: 'none',
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
