// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { setDiagnostics, diagnosticsHighlight, type EditorDiagnostic } from './diagnostics';

/**
 * The pure surface of `diagnostics.ts` — the `setDiagnostics` state-effect
 * contract and the extension factory — is asserted directly. The line →
 * character-offset decoration mapping (dedup-by-line "first wins", out-of-range
 * filtering, empty-line skipping and sorting) lives inside the private
 * `StateField.update` and is exercised against a live `EditorView` rendered in
 * jsdom, reading the resulting `.cm-diag-error` / `.cm-diag-warn` marks.
 */
describe('setDiagnostics state effect', () => {
  it('round-trips the diagnostics payload through the effect value', () => {
    const diags: EditorDiagnostic[] = [
      { line: 1, severity: 'error', message: 'boom' },
      { line: 3, severity: 'warning', message: 'careful' },
    ];
    const effect = setDiagnostics.of(diags);
    expect(effect.is(setDiagnostics)).toBe(true);
    expect(effect.value).toEqual(diags);
  });

  it('carries an empty payload (clearing the diagnostics)', () => {
    const effect = setDiagnostics.of([]);
    expect(effect.is(setDiagnostics)).toBe(true);
    expect(effect.value).toEqual([]);
  });
});

describe('diagnosticsHighlight', () => {
  it('returns a defined CodeMirror extension', () => {
    const ext = diagnosticsHighlight();
    expect(ext).toBeDefined();
    // It is composed as an array of fields (the self-contained diagnostics state field).
    expect(Array.isArray(ext)).toBe(true);
    expect((ext as unknown[]).length).toBeGreaterThan(0);
  });
});

describe('diagnosticsHighlight — decoration mapping (live editor)', () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  /** Render a 3-line document with the diagnostics field attached. */
  function mount(doc = 'alpha\nbeta\ngamma'): EditorView {
    view = new EditorView({
      state: EditorState.create({ doc, extensions: [diagnosticsHighlight()] }),
      parent: document.body,
    });
    return view;
  }

  function dispatch(v: EditorView, diags: EditorDiagnostic[]): void {
    v.dispatch({ effects: setDiagnostics.of(diags) });
  }

  const errors = (v: EditorView) => v.contentDOM.querySelectorAll('.cm-diag-error');
  const warns = (v: EditorView) => v.contentDOM.querySelectorAll('.cm-diag-warn');

  it('renders no marks before any diagnostics are dispatched', () => {
    const v = mount();
    expect(errors(v)).toHaveLength(0);
    expect(warns(v)).toHaveLength(0);
  });

  it('underlines an error line with the message as a hover title', () => {
    const v = mount();
    dispatch(v, [{ line: 2, severity: 'error', message: 'unexpected token' }]);
    const marks = errors(v);
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('beta'); // the whole second line
    expect(marks[0].getAttribute('title')).toBe('unexpected token');
    expect(warns(v)).toHaveLength(0);
  });

  it('uses the warning class for a warning severity', () => {
    const v = mount();
    dispatch(v, [{ line: 1, severity: 'warning', message: 'shadowed name' }]);
    expect(warns(v)).toHaveLength(1);
    expect(warns(v)[0].textContent).toBe('alpha');
    expect(errors(v)).toHaveLength(0);
  });

  it('keeps only the first diagnostic per line (first wins)', () => {
    const v = mount();
    dispatch(v, [
      { line: 2, severity: 'error', message: 'first' },
      { line: 2, severity: 'warning', message: 'second' },
    ]);
    // Deduped to a single mark, and the first (error) entry is the survivor.
    expect(errors(v)).toHaveLength(1);
    expect(warns(v)).toHaveLength(0);
    expect(errors(v)[0].getAttribute('title')).toBe('first');
  });

  it('marks several distinct lines at once', () => {
    const v = mount();
    dispatch(v, [
      { line: 3, severity: 'error', message: 'c' },
      { line: 1, severity: 'warning', message: 'a' },
    ]);
    expect(errors(v)).toHaveLength(1);
    expect(warns(v)).toHaveLength(1);
    expect(errors(v)[0].textContent).toBe('gamma');
    expect(warns(v)[0].textContent).toBe('alpha');
  });

  it('drops out-of-range lines (below 1 or past the last line)', () => {
    const v = mount(); // 3 lines
    dispatch(v, [
      { line: 0, severity: 'error', message: 'too low' },
      { line: 99, severity: 'error', message: 'too high' },
    ]);
    expect(errors(v)).toHaveLength(0);
    expect(warns(v)).toHaveLength(0);
  });

  it('skips empty lines (there is nothing to underline)', () => {
    const v = mount('alpha\n\ngamma'); // line 2 is empty
    dispatch(v, [{ line: 2, severity: 'error', message: 'on a blank line' }]);
    expect(errors(v)).toHaveLength(0);
  });

  it('clears all marks when an empty diagnostics list is dispatched', () => {
    const v = mount();
    dispatch(v, [{ line: 1, severity: 'error', message: 'x' }]);
    expect(errors(v)).toHaveLength(1);
    dispatch(v, []);
    expect(errors(v)).toHaveLength(0);
  });

  it('maps an existing mark across a later document edit', () => {
    const v = mount();
    dispatch(v, [{ line: 3, severity: 'error', message: 'persisted' }]);
    expect(errors(v)).toHaveLength(1);
    // A plain edit on an earlier line (no diagnostics effect) must keep the mark.
    v.dispatch({ changes: { from: 0, insert: 'PREFIX ' } });
    const marks = errors(v);
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('gamma');
    expect(marks[0].getAttribute('title')).toBe('persisted');
  });
});
