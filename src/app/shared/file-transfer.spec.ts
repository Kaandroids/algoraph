// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downloadText, downloadJson, readFileAsText } from './file-transfer';

/**
 * `file-transfer` touches three browser APIs that jsdom either stubs as
 * "not implemented" (URL.createObjectURL / revokeObjectURL) or actually drives
 * (the anchor element, FileReader). We replace the object-URL pair with spies and
 * intercept the anchor's `click` so a "download" runs without navigating, then
 * assert the plumbing was wired with the right name / blob / content.
 */
/** Read a Blob's text via jsdom's FileReader (its Blob has no `.text()`). */
function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe('file-transfer', () => {
  describe('downloadText / downloadJson', () => {
    let createObjectURL: ReturnType<typeof vi.fn>;
    let revokeObjectURL: ReturnType<typeof vi.fn>;
    let clickSpy: ReturnType<typeof vi.fn>;
    let lastAnchor: HTMLAnchorElement | null;
    let lastBlob: Blob | null;
    const origCreateObjectURL = (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
    const origRevokeObjectURL = (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;

    beforeEach(() => {
      lastAnchor = null;
      lastBlob = null;
      clickSpy = vi.fn();

      createObjectURL = vi.fn((blob: Blob) => {
        lastBlob = blob;
        return 'blob:mock-url';
      });
      revokeObjectURL = vi.fn();
      // jsdom leaves these unimplemented, so assign rather than spyOn.
      (URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL;
      (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeObjectURL;

      // Capture the anchor the helper builds and neutralise its navigation.
      const realCreate = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = realCreate(tag);
        if (tag === 'a') {
          lastAnchor = el as HTMLAnchorElement;
          (el as HTMLAnchorElement).click = clickSpy as unknown as () => void;
        }
        return el;
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
      (URL as unknown as { createObjectURL: unknown }).createObjectURL = origCreateObjectURL;
      (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = origRevokeObjectURL;
    });

    it('builds a typed Blob, names the anchor and clicks it', () => {
      downloadText('notes.txt', 'hello world', 'text/plain');

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(lastBlob).toBeInstanceOf(Blob);
      expect(lastBlob!.type).toBe('text/plain');
      expect(lastAnchor).not.toBeNull();
      expect(lastAnchor!.download).toBe('notes.txt');
      expect(lastAnchor!.href).toContain('blob:mock-url');
      expect(clickSpy).toHaveBeenCalledTimes(1);
    });

    it('revokes the object URL after triggering the download', () => {
      downloadText('a.txt', 'x', 'text/plain');
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });

    it('puts the given text into the Blob', async () => {
      downloadText('a.txt', 'the body', 'text/plain');
      expect(await blobText(lastBlob!)).toBe('the body');
    });

    it('downloadJson pretty-prints the value and tags it application/json', async () => {
      downloadJson('data.json', { a: 1, b: [2, 3] });

      expect(lastBlob!.type).toBe('application/json');
      expect(lastAnchor!.download).toBe('data.json');
      // 2-space pretty-print, matching JSON.stringify(value, null, 2).
      expect(await blobText(lastBlob!)).toBe(JSON.stringify({ a: 1, b: [2, 3] }, null, 2));
      expect(clickSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('readFileAsText', () => {
    it("resolves to the file's text contents", async () => {
      const file = new File(['line one\nline two'], 'doc.txt', { type: 'text/plain' });
      await expect(readFileAsText(file)).resolves.toBe('line one\nline two');
    });

    it('reads an empty file as an empty string', async () => {
      const file = new File([''], 'empty.txt', { type: 'text/plain' });
      await expect(readFileAsText(file)).resolves.toBe('');
    });

    it('round-trips JSON written by downloadJson semantics', async () => {
      const payload = JSON.stringify({ nodes: [], edges: [] }, null, 2);
      const blob = new Blob([payload], { type: 'application/json' }) as Blob as File;
      await expect(readFileAsText(blob)).resolves.toBe(payload);
    });
  });
});
