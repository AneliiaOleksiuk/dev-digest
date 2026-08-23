/**
 * Project Context (SPEC-01 amendment) — write-path guard chain. Pure
 * functions only (no `node:fs`, no I/O) so every AC-43/AC-45/AC-47 clause is
 * a distinct unit-testable rejection, not a shared boolean. One shared
 * module used by both `saveDocument` and `createDocument` (Rec-6) — the
 * Spec's own flowchart is a single ordered chain with a two-branch tail, and
 * duplicating it per route is how one branch silently loses a gate.
 *
 * A write must clear MORE than `isInsideClone` alone: `.git/hooks/pre-commit`
 * and `package.json` both resolve inside the clone, and the server runs git
 * against that clone (`adapters/git/simple-git.ts`), so a written hook could
 * execute under the API process (E-22). Every write therefore clears, in
 * order: path shape → configured search root → not an excluded directory →
 * `isInsideClone`.
 */
import { isInsideClone } from '../reviews/intent-inputs.js';
import { EXCLUDED_DIRS } from '../repo-intel/constants.js';
import {
  DOC_EXT,
  MAX_DOC_FILE_BYTES,
  MAX_DOC_PATH_DEPTH,
  MAX_DOC_PATH_LENGTH,
} from './constants.js';

const EXCLUDED_SET: ReadonlySet<string> = new Set(EXCLUDED_DIRS);

/** Only these ASCII characters are accepted in a path segment (AC-47) — no
 *  spaces, no shell metacharacters, no non-ASCII homoglyphs. */
const SEGMENT_CHARSET = /^[A-Za-z0-9._-]+$/;

/** One rejection reason per AC-43/AC-45/AC-47/AC-46 clause — never a shared
 *  boolean, so a rejected write can tell the caller (and the caller's log
 *  line, NFR A09) exactly which gate it failed. */
export type WriteGuardRejection =
  | 'invalid_extension'
  | 'invalid_segment'
  | 'invalid_separator'
  | 'invalid_form'
  | 'invalid_charset'
  | 'path_too_deep'
  | 'path_too_long'
  | 'outside_configured_root'
  | 'excluded_directory'
  | 'escapes_clone';

export type GuardResult = { ok: true } | { ok: false; reason: WriteGuardRejection };

/**
 * Shape-only validation (AC-47) — no filesystem, no config. Rejects, in
 * order: a non-`.md` extension; any `.` or `..` segment; any separator other
 * than `/`; an absolute, drive-letter (`C:/`) or UNC (`\\?\`) form; a
 * segment outside the ASCII `[A-Za-z0-9._-]` allowlist; and a path over
 * `MAX_DOC_PATH_DEPTH` or `MAX_DOC_PATH_LENGTH` (D-12, values approved by
 * the product owner — see `constants.ts` docblocks).
 */
export function validateDocPathShape(path: string): GuardResult {
  if (!path.toLowerCase().endsWith(DOC_EXT)) {
    return { ok: false, reason: 'invalid_extension' };
  }

  const segments = path.split('/');
  if (segments.some((seg) => seg === '.' || seg === '..')) {
    return { ok: false, reason: 'invalid_segment' };
  }

  // Any backslash means either a Windows-style separator or a UNC form
  // (`\\?\...`) — reject before any join/resolve ever sees it.
  if (path.includes('\\')) {
    return { ok: false, reason: 'invalid_separator' };
  }

  // Absolute posix form, or a win32 drive-letter form using forward slashes
  // (`C:/foo.md`) — a UNC form is already caught by the backslash check above.
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    return { ok: false, reason: 'invalid_form' };
  }

  if (segments.some((seg) => !SEGMENT_CHARSET.test(seg))) {
    return { ok: false, reason: 'invalid_charset' };
  }

  if (segments.length > MAX_DOC_PATH_DEPTH) {
    return { ok: false, reason: 'path_too_deep' };
  }

  if (path.length > MAX_DOC_PATH_LENGTH) {
    return { ok: false, reason: 'path_too_long' };
  }

  return { ok: true };
}

/**
 * Full write-path resolution: shape → first segment is a configured search
 * root → no segment is an excluded directory (`EXCLUDED_DIRS`) → resolves
 * inside the clone (`isInsideClone`). Returns the absolute path on success,
 * or the first-failed gate's rejection reason.
 */
export function resolveWritablePath(
  clonePath: string,
  roots: string[],
  path: string,
): { ok: true; absPath: string } | { ok: false; reason: WriteGuardRejection } {
  const shape = validateDocPathShape(path);
  if (!shape.ok) return shape;

  const segments = path.split('/');
  if (!roots.includes(segments[0]!)) {
    return { ok: false, reason: 'outside_configured_root' };
  }

  if (segments.some((seg) => EXCLUDED_SET.has(seg))) {
    return { ok: false, reason: 'excluded_directory' };
  }

  const absPath = isInsideClone(clonePath, path);
  if (!absPath) {
    return { ok: false, reason: 'escapes_clone' };
  }

  return { ok: true, absPath };
}

/** AC-49 — content must not exceed the per-document byte cap. Measures the
 *  UTF-8 byte length, not the JS string length (multi-byte characters). */
export function assertContentWithinCap(content: string): boolean {
  return Buffer.byteLength(content, 'utf8') <= MAX_DOC_FILE_BYTES;
}
