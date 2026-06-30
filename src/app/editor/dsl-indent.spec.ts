// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { getIndentation, IndentContext } from '@codemirror/language';
import { dslIndentService, indentGuides } from './dsl-indent';

/**
 * `dsl-indent.ts` ships two extensions:
 *  - `dslIndentService` — auto-indent that opens a level after `do` / `then`
 *    and dedents `end` / `else`. Tested through `getIndentation`, the same
 *    entry point CodeMirror uses on Enter / reindent.
 *  - `indentGuides` — a ViewPlugin that draws a vertical guide per nesting
 *    level. Tested against a live `EditorView` in jsdom.
 */
describe('dslIndentService — auto-indent', () => {
  /** Indentation the service would apply at `pos` (no simulated break). */
  function indentAt(doc: string, pos: number): number | null {
    const state = EditorState.create({ doc, extensions: [dslIndentService] });
    return getIndentation(state, pos);
  }

  /** Start offset of a 1-based line in `doc`. */
  function lineStart(doc: string, lineNo: number): number {
    return EditorState.create({ doc }).doc.line(lineNo).from;
  }

  it('opens a level after a `do` opener', () => {
    const doc = 'while x do\n'; // line 2 is the fresh (empty) line
    expect(indentAt(doc, lineStart(doc, 2))).toBe(2);
  });

  it('opens a level after a `then` opener', () => {
    const doc = 'if cond then\n';
    expect(indentAt(doc, lineStart(doc, 2))).toBe(2);
  });

  it('stacks onto an already-indented opener', () => {
    const doc = '  while x do\n'; // opener itself sits at 2
    expect(indentAt(doc, lineStart(doc, 2))).toBe(4);
  });

  it('keeps the previous indentation on an ordinary line', () => {
    const doc = '  x ← 1\n';
    expect(indentAt(doc, lineStart(doc, 2))).toBe(2);
  });

  it('counts a leading tab as one indent unit', () => {
    const doc = '\tx ← 1\n';
    expect(indentAt(doc, lineStart(doc, 2))).toBe(2);
  });

  it('dedents an `end` line by one level', () => {
    const doc = '    end'; // sitting at column 4
    expect(indentAt(doc, lineStart(doc, 1))).toBe(2);
  });

  it('dedents an `else` line by one level', () => {
    const doc = '    else';
    expect(indentAt(doc, lineStart(doc, 1))).toBe(2);
  });

  it('clamps a closer at column 0 to zero (never negative)', () => {
    const doc = 'end';
    expect(indentAt(doc, lineStart(doc, 1))).toBe(0);
  });

  it('skips blank lines when looking for the line to inherit from', () => {
    const doc = '  do\n\n'; // opener, blank line, then the fresh line 3
    expect(indentAt(doc, lineStart(doc, 3))).toBe(4); // 2 (opener indent) + 2 (open level)
  });

  it('opens a level for a simulated break right after `do` (Enter)', () => {
    const doc = 'while x do';
    const state = EditorState.create({ doc, extensions: [dslIndentService] });
    const cx = new IndentContext(state, { simulateBreak: doc.length });
    expect(getIndentation(cx, doc.length)).toBe(2);
  });
});

describe('indentGuides — vertical guides (live editor)', () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  function mount(doc: string): EditorView {
    view = new EditorView({
      state: EditorState.create({ doc, extensions: [indentGuides] }),
      parent: document.body,
    });
    return view;
  }

  const lines = (v: EditorView) => [...v.contentDOM.querySelectorAll('.cm-line')];
  const depthOf = (el: Element): string | null => {
    const style = el.getAttribute('style') ?? '';
    const m = /--cm-indent:\s*(\d+)/.exec(style);
    return m ? m[1] : null;
  };

  it('adds no guide to unindented lines and one per level to indented ones', () => {
    const v = mount('do\n  body\n    deep\nend');
    const [open, body, deep, close] = lines(v);
    expect(open.classList.contains('cm-indent-guides')).toBe(false);
    expect(close.classList.contains('cm-indent-guides')).toBe(false);
    expect(body.classList.contains('cm-indent-guides')).toBe(true);
    expect(depthOf(body)).toBe('1'); // 2 spaces → 1 level
    expect(depthOf(deep)).toBe('2'); // 4 spaces → 2 levels
  });

  it('lets a blank line keep the guides that span across it', () => {
    const v = mount('  a\n\n  b'); // both neighbours are indented at 2
    const [, blank] = lines(v);
    expect(blank.classList.contains('cm-indent-guides')).toBe(true);
    expect(depthOf(blank)).toBe('1');
  });

  it('draws no guide on a blank line with no non-blank neighbour above', () => {
    const v = mount('\n  b'); // line 1 is blank with nothing above it
    const [blank] = lines(v);
    expect(blank.classList.contains('cm-indent-guides')).toBe(false);
  });
});
