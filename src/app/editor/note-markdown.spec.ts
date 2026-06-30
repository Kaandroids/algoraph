import { describe, it, expect } from 'vitest';
import { renderNoteHtml } from './note-markdown';

describe('renderNoteHtml — paragraphs', () => {
  it('wraps a plain line in a paragraph', () => {
    expect(renderNoteHtml('hello world')).toBe('<p>hello world</p>');
  });

  it('emits one paragraph per non-blank line', () => {
    expect(renderNoteHtml('first\nsecond')).toBe('<p>first</p><p>second</p>');
  });

  it('drops blank and whitespace-only lines (no empty paragraphs)', () => {
    expect(renderNoteHtml('a\n\n   \nb')).toBe('<p>a</p><p>b</p>');
  });

  it('renders the empty string as nothing', () => {
    expect(renderNoteHtml('')).toBe('');
  });
});

describe('renderNoteHtml — inline marks', () => {
  it('renders **bold**', () => {
    expect(renderNoteHtml('a **b** c')).toBe('<p>a <strong>b</strong> c</p>');
  });

  it('renders *italic*', () => {
    expect(renderNoteHtml('a *b* c')).toBe('<p>a <em>b</em> c</p>');
  });

  it('renders bold and italic in the same line', () => {
    expect(renderNoteHtml('**b** and *i*')).toBe('<p><strong>b</strong> and <em>i</em></p>');
  });

  it('applies bold before italic so **x** is not mistaken for italics', () => {
    // The bold pass consumes the doubled stars first; nothing is left for the italic pass.
    expect(renderNoteHtml('**x**')).toBe('<p><strong>x</strong></p>');
  });

  it('leaves an unbalanced single star untouched', () => {
    expect(renderNoteHtml('2 * 3 = 6')).toBe('<p>2 * 3 = 6</p>');
  });
});

describe('renderNoteHtml — bullet lists', () => {
  it('wraps consecutive bullets in a single <ul>', () => {
    expect(renderNoteHtml('- one\n- two')).toBe('<ul><li>one</li><li>two</li></ul>');
  });

  it('accepts both - and * as bullet markers', () => {
    expect(renderNoteHtml('* star\n- dash')).toBe('<ul><li>star</li><li>dash</li></ul>');
  });

  it('allows leading indentation before the marker', () => {
    expect(renderNoteHtml('   - indented')).toBe('<ul><li>indented</li></ul>');
  });

  it('renders inline marks inside a list item', () => {
    expect(renderNoteHtml('- **bold** item')).toBe('<ul><li><strong>bold</strong> item</li></ul>');
  });

  it('closes the list before a following paragraph', () => {
    expect(renderNoteHtml('- item\ntext')).toBe('<ul><li>item</li></ul><p>text</p>');
  });

  it('closes the list at end of input', () => {
    expect(renderNoteHtml('intro\n- item')).toBe('<p>intro</p><ul><li>item</li></ul>');
  });

  it('a blank line ends the list', () => {
    expect(renderNoteHtml('- item\n\nafter')).toBe('<ul><li>item</li></ul><p>after</p>');
  });

  it('treats *italic* (no space) as a paragraph, not a bullet', () => {
    // A bullet needs whitespace after the marker; `*word*` has none, so it is italic text.
    expect(renderNoteHtml('*italic*')).toBe('<p><em>italic</em></p>');
  });

  it('requires whitespace after the marker — `-item` stays a paragraph', () => {
    expect(renderNoteHtml('-item')).toBe('<p>-item</p>');
  });
});

describe('renderNoteHtml — HTML escaping', () => {
  it('escapes &, < and > in plain text', () => {
    expect(renderNoteHtml('a < b & c > d')).toBe('<p>a &lt; b &amp; c &gt; d</p>');
  });

  it('neutralises injected markup before our own tags are added', () => {
    expect(renderNoteHtml('<script>alert(1)</script>')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );
  });

  it('escapes user content inside emphasis but keeps our real tags', () => {
    expect(renderNoteHtml('**<b>**')).toBe('<p><strong>&lt;b&gt;</strong></p>');
  });

  it('escapes user content inside a list item', () => {
    expect(renderNoteHtml('- a & <b>')).toBe('<ul><li>a &amp; &lt;b&gt;</li></ul>');
  });
});
