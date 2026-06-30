import { describe, it, expect } from 'vitest';
import { setDiagnostics, diagnosticsHighlight, type EditorDiagnostic } from './diagnostics';

/**
 * Only the genuinely pure surface of `diagnostics.ts` is unit-tested here: the
 * `setDiagnostics` state-effect contract and the extension factory.
 *
 * SKIPPED: the line → character-offset decoration mapping (dedup-by-line "first
 * wins", out-of-range line filtering, empty-line skipping and sorting) lives
 * inside the private `StateField.update` and only runs against a live
 * transaction / `EditorState`. Per the task it is intentionally not exercised,
 * since reproducing it needs a real editor runtime to compute document offsets.
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
