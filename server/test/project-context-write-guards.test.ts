/**
 * Project Context (SPEC-01 amendment) — write-path guard chain
 * (`project-context/write-guards.ts`, WI2). Pure functions, no DB/fs, so
 * every AC-43/AC-45/AC-46/AC-47 clause gets its own rejection-reason
 * assertion rather than one shared boolean (WI2's stated Definition of
 * done). Oracle: AC-35, AC-36, AC-43, AC-45, AC-46, AC-47, AC-49, E-22 —
 * derived from the Spec/Plan before this file was opened.
 */
import { describe, it, expect } from 'vitest';
import {
  validateDocPathShape,
  resolveWritablePath,
  assertContentWithinCap,
} from '../src/modules/project-context/write-guards.js';
import { isInsideClone } from '../src/modules/reviews/intent-inputs.js';
import { MAX_DOC_FILE_BYTES, MAX_DOC_PATH_DEPTH, MAX_DOC_PATH_LENGTH } from '../src/modules/project-context/constants.js';

const ROOTS = ['specs', 'docs', 'insights'];
const CLONE = '/mock/clone';

describe('validateDocPathShape (AC-47) — one rejection reason per clause', () => {
  it('accepts a well-formed nested .md path', () => {
    expect(validateDocPathShape('docs/adr/0001-x.md')).toEqual({ ok: true });
  });

  it('rejects a non-.md extension', () => {
    expect(validateDocPathShape('docs/package.json')).toEqual({
      ok: false,
      reason: 'invalid_extension',
    });
  });

  it('rejects a "." segment', () => {
    expect(validateDocPathShape('docs/./a.md')).toEqual({
      ok: false,
      reason: 'invalid_segment',
    });
  });

  it('rejects a ".." traversal segment', () => {
    expect(validateDocPathShape('docs/../secrets.md')).toEqual({
      ok: false,
      reason: 'invalid_segment',
    });
  });

  it('rejects a backslash (win32-style) separator', () => {
    expect(validateDocPathShape('docs\\a.md')).toEqual({
      ok: false,
      reason: 'invalid_separator',
    });
  });

  it('rejects a UNC form (\\\\?\\...)', () => {
    expect(validateDocPathShape('\\\\?\\C:\\docs\\a.md')).toEqual({
      ok: false,
      reason: 'invalid_separator',
    });
  });

  it('rejects a posix absolute path', () => {
    expect(validateDocPathShape('/etc/passwd.md')).toEqual({
      ok: false,
      reason: 'invalid_form',
    });
  });

  it('rejects a win32 drive-letter form using forward slashes (C:/foo.md)', () => {
    expect(validateDocPathShape('C:/foo.md')).toEqual({
      ok: false,
      reason: 'invalid_form',
    });
  });

  it('rejects a segment outside the ASCII [A-Za-z0-9._-] charset (e.g. a space)', () => {
    expect(validateDocPathShape('docs/my notes.md')).toEqual({
      ok: false,
      reason: 'invalid_charset',
    });
  });

  it('rejects a path deeper than MAX_DOC_PATH_DEPTH', () => {
    const tooDeep = Array.from({ length: MAX_DOC_PATH_DEPTH }, (_, i) => `seg${i}`).join('/') + '/x.md';
    expect(validateDocPathShape(tooDeep)).toEqual({ ok: false, reason: 'path_too_deep' });
  });

  it('accepts a path at exactly MAX_DOC_PATH_DEPTH segments', () => {
    const segments = Array.from({ length: MAX_DOC_PATH_DEPTH - 1 }, (_, i) => `s${i}`);
    const atDepth = [...segments, 'x.md'].join('/');
    expect(atDepth.split('/').length).toBe(MAX_DOC_PATH_DEPTH);
    expect(validateDocPathShape(atDepth)).toEqual({ ok: true });
  });

  it('rejects a path longer than MAX_DOC_PATH_LENGTH characters', () => {
    const tooLong = 'docs/' + 'a'.repeat(MAX_DOC_PATH_LENGTH) + '.md';
    expect(tooLong.length).toBeGreaterThan(MAX_DOC_PATH_LENGTH);
    expect(validateDocPathShape(tooLong)).toEqual({ ok: false, reason: 'path_too_long' });
  });

  it('checks extension before all other clauses (order matters for the first-failed-gate contract)', () => {
    // Both an invalid extension AND a traversal segment — extension is checked first.
    expect(validateDocPathShape('../secret.txt')).toEqual({
      ok: false,
      reason: 'invalid_extension',
    });
  });
});

describe('resolveWritablePath (AC-36/AC-43/AC-46, E-22) — root confinement + excluded dirs + isInsideClone', () => {
  it('resolves a valid path under a configured root to an absolute path', () => {
    const result = resolveWritablePath(CLONE, ROOTS, 'docs/adr/0001-x.md');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.absPath.replace(/\\/g, '/')).toContain('docs/adr/0001-x.md');
    }
  });

  it('rejects a path whose first segment is not a configured search root', () => {
    expect(resolveWritablePath(CLONE, ROOTS, 'notes/random.md')).toEqual({
      ok: false,
      reason: 'outside_configured_root',
    });
  });

  it(
    'E-22 — .git/hooks/pre-commit.md resolves INSIDE the clone (isInsideClone alone would allow it) ' +
      'but is rejected specifically by the root-confinement gate, not by escapes_clone',
    () => {
      // Prove isInsideClone alone is not the guard that stops this input.
      expect(isInsideClone(CLONE, '.git/hooks/pre-commit.md')).not.toBeNull();
      // The full chain rejects it one gate earlier, with a distinct reason.
      expect(resolveWritablePath(CLONE, ROOTS, '.git/hooks/pre-commit.md')).toEqual({
        ok: false,
        reason: 'outside_configured_root',
      });
    },
  );

  it('AC-46 — rejects a path under an excluded directory even inside a configured root (node_modules)', () => {
    expect(resolveWritablePath(CLONE, ['docs'], 'docs/node_modules/pwned.md')).toEqual({
      ok: false,
      reason: 'excluded_directory',
    });
  });

  it('AC-46 — rejects a path under .git even when a root happened to be named that (excluded dir gate, not just root gate)', () => {
    expect(resolveWritablePath(CLONE, ['docs', '.git'], '.git/hooks/pre-commit.md')).toEqual({
      ok: false,
      reason: 'excluded_directory',
    });
  });

  it('AC-46 — a nested new directory under a configured root that is NOT excluded is accepted (dirs are created, not rejected)', () => {
    const result = resolveWritablePath(CLONE, ROOTS, 'docs/adr/0004/rfc/draft.md');
    expect(result.ok).toBe(true);
  });

  it('propagates a shape rejection before ever checking roots/excluded dirs', () => {
    expect(resolveWritablePath(CLONE, ROOTS, 'docs/../etc.md')).toEqual({
      ok: false,
      reason: 'invalid_segment',
    });
  });
});

describe('assertContentWithinCap (AC-49)', () => {
  it('accepts content at or below MAX_DOC_FILE_BYTES', () => {
    expect(assertContentWithinCap('a'.repeat(MAX_DOC_FILE_BYTES))).toBe(true);
  });

  it('rejects content one byte over MAX_DOC_FILE_BYTES', () => {
    expect(assertContentWithinCap('a'.repeat(MAX_DOC_FILE_BYTES + 1))).toBe(false);
  });

  it('measures UTF-8 byte length, not JS string length, for multi-byte characters', () => {
    // Each '€' is 1 UTF-16 code unit but 3 UTF-8 bytes — a naive `.length`
    // check would under-count and let this through.
    const perChar = 3;
    const chars = Math.floor(MAX_DOC_FILE_BYTES / perChar) + 1;
    const content = '€'.repeat(chars);
    expect(content.length).toBeLessThan(MAX_DOC_FILE_BYTES); // string length alone looks fine…
    expect(assertContentWithinCap(content)).toBe(false); // …but the byte length is over the cap
  });
});
