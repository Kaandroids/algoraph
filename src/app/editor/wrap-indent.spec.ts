// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { wrapIndent } from './wrap-indent';

/**
 * `wrapIndent()` is a ViewPlugin that hangs soft-wrapped lines under their own
 * indentation by setting a negative `text-indent` plus matching `padding-left`
 * on each indented line. Tested against a live `EditorView` in jsdom, reading
 * the inline style it places on every `.cm-line`.
 */
describe('wrapIndent', () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  function mount(doc: string): EditorView {
    view = new EditorView({
      state: EditorState.create({ doc, extensions: [wrapIndent()] }),
      parent: document.body,
    });
    return view;
  }

  const lines = (v: EditorView) => [...v.contentDOM.querySelectorAll('.cm-line')];

  it('returns a defined extension', () => {
    expect(wrapIndent()).toBeDefined();
  });

  it('leaves an unindented line without a hanging-indent style', () => {
    const v = mount('top\n  indented');
    const style = lines(v)[0].getAttribute('style') ?? '';
    expect(style).not.toContain('text-indent');
  });

  // `calc(16px + Nch)` may be serialised in either operand order by the DOM, so
  // accept both `16px + Nch` and `Nch + 16px` when asserting the padding.
  const padLeft = (n: number) =>
    new RegExp(`padding-left:\\s*calc\\((?:16px \\+ ${n}ch|${n}ch \\+ 16px)\\)`);

  it('hangs a space-indented line under its indent (1 ch per space)', () => {
    const v = mount('top\n  indented');
    const style = lines(v)[1].getAttribute('style') ?? '';
    expect(style).toContain('text-indent: -2ch');
    expect(style).toMatch(padLeft(2));
  });

  it('counts each leading tab as a single character', () => {
    const v = mount('top\n\tnested');
    const style = lines(v)[1].getAttribute('style') ?? '';
    expect(style).toContain('text-indent: -1ch');
    expect(style).toMatch(padLeft(1));
  });

  it('scales the hang with the depth of the indentation', () => {
    const v = mount('    four');
    const style = lines(v)[0].getAttribute('style') ?? '';
    expect(style).toContain('text-indent: -4ch');
    expect(style).toMatch(padLeft(4));
  });
});
