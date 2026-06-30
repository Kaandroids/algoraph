// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { setCurrentLine, runHighlight } from './run-highlight';

/**
 * `run-highlight.ts` exposes the `setCurrentLine` state effect and the
 * `runHighlight()` extension. The effect contract is asserted directly; the
 * `StateField.update` (null clears, out-of-range clears, mapping across edits)
 * runs against a live `EditorView` in jsdom, reading the `.cm-run-current`
 * line decoration.
 */
describe('setCurrentLine state effect', () => {
  it('carries a 1-based line number', () => {
    const effect = setCurrentLine.of(4);
    expect(effect.is(setCurrentLine)).toBe(true);
    expect(effect.value).toBe(4);
  });

  it('carries null to clear the highlight', () => {
    const effect = setCurrentLine.of(null);
    expect(effect.is(setCurrentLine)).toBe(true);
    expect(effect.value).toBeNull();
  });
});

describe('runHighlight', () => {
  it('returns a defined CodeMirror extension array', () => {
    const ext = runHighlight();
    expect(ext).toBeDefined();
    expect(Array.isArray(ext)).toBe(true);
    expect((ext as unknown[]).length).toBeGreaterThan(0);
  });
});

describe('runHighlight — current-line decoration (live editor)', () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  function mount(doc = 'one\ntwo\nthree'): EditorView {
    view = new EditorView({
      state: EditorState.create({ doc, extensions: [runHighlight()] }),
      parent: document.body,
    });
    return view;
  }

  const current = (v: EditorView) => v.contentDOM.querySelectorAll('.cm-line.cm-run-current');

  it('renders no highlight before any line is set', () => {
    const v = mount();
    expect(current(v)).toHaveLength(0);
  });

  it('highlights exactly the requested line', () => {
    const v = mount();
    v.dispatch({ effects: setCurrentLine.of(2) });
    const marked = current(v);
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toBe('two');
  });

  it('moves the highlight when a new line is set', () => {
    const v = mount();
    v.dispatch({ effects: setCurrentLine.of(1) });
    expect(current(v)[0].textContent).toBe('one');
    v.dispatch({ effects: setCurrentLine.of(3) });
    const marked = current(v);
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toBe('three');
  });

  it('clears the highlight when null is dispatched', () => {
    const v = mount();
    v.dispatch({ effects: setCurrentLine.of(2) });
    expect(current(v)).toHaveLength(1);
    v.dispatch({ effects: setCurrentLine.of(null) });
    expect(current(v)).toHaveLength(0);
  });

  it('clears the highlight for a line below 1', () => {
    const v = mount();
    v.dispatch({ effects: setCurrentLine.of(2) });
    v.dispatch({ effects: setCurrentLine.of(0) });
    expect(current(v)).toHaveLength(0);
  });

  it('clears the highlight for a line past the end of the document', () => {
    const v = mount(); // 3 lines
    v.dispatch({ effects: setCurrentLine.of(2) });
    v.dispatch({ effects: setCurrentLine.of(99) });
    expect(current(v)).toHaveLength(0);
  });

  it('maps the highlight across a later document edit', () => {
    const v = mount();
    v.dispatch({ effects: setCurrentLine.of(3) });
    expect(current(v)).toHaveLength(1);
    // A plain edit on an earlier line (no setCurrentLine) keeps the highlight.
    v.dispatch({ changes: { from: 0, insert: 'zero\n' } });
    const marked = current(v);
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toBe('three');
  });
});
