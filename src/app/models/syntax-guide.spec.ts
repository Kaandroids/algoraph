import { describe, it, expect } from 'vitest';
import { SYNTAX_GUIDE, type SyntaxSection } from './syntax-guide';

describe('SYNTAX_GUIDE', () => {
  it('is a non-empty list of sections', () => {
    expect(Array.isArray(SYNTAX_GUIDE)).toBe(true);
    expect(SYNTAX_GUIDE.length).toBeGreaterThan(0);
  });

  it('gives every section a title and some content', () => {
    for (const section of SYNTAX_GUIDE) {
      expect(section.title.trim().length, JSON.stringify(section)).toBeGreaterThan(0);
      // A section is only useful if it carries prose, items, or a worked example.
      const hasContent = Boolean(section.intro) || Boolean(section.items?.length) || Boolean(section.example);
      expect(hasContent, section.title).toBe(true);
    }
  });

  it('has unique section titles', () => {
    const titles = SYNTAX_GUIDE.map((s) => s.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('gives every item a non-empty syntax and description', () => {
    for (const section of SYNTAX_GUIDE) {
      for (const item of section.items ?? []) {
        expect(item.syntax.trim().length, `${section.title}: syntax`).toBeGreaterThan(0);
        expect(item.desc.trim().length, `${section.title}: ${item.syntax}`).toBeGreaterThan(0);
      }
    }
  });

  it('uses a non-empty string for any worked example', () => {
    for (const section of SYNTAX_GUIDE) {
      if (section.example !== undefined) {
        expect(typeof section.example).toBe('string');
        expect(section.example.trim().length, section.title).toBeGreaterThan(0);
      }
    }
  });

  it('covers the core topics a learner needs', () => {
    const titles = SYNTAX_GUIDE.map((s) => s.title);
    for (const expected of ['Basics', 'Operators', 'Conditionals', 'Loops']) {
      expect(titles, expected).toContain(expected);
    }
  });

  it('teaches the ← arrow rather than the <- shorthand in its examples', () => {
    const basics = SYNTAX_GUIDE.find((s) => s.title === 'Basics') as SyntaxSection;
    expect(basics.example).toContain('←');
    // Examples are rendered as the canonical DSL, so the shorthand should not leak.
    for (const section of SYNTAX_GUIDE) {
      if (section.example) expect(section.example, section.title).not.toContain('<-');
    }
  });
});
