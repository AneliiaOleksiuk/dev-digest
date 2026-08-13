import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

/** Document "type" label — currently always the file extension without its
 *  dot (only `.md` is discovered today, so this is always "md"). */
export function docType(path: string): string {
  const ext = extname(path).slice(1).toLowerCase();
  return ext || 'md';
}

export function truncateText(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

/**
 * AC-19: each injected entry's text must carry its repo-relative path INSIDE
 * the untrusted block (`wrapUntrusted` wraps whatever this returns) — not in
 * `wrapUntrusted`'s own `label` argument, which is a trusted attribute, not
 * content. Same fix already applied to the intent classifier's spec header
 * (see server/INSIGHTS.md).
 */
export function buildEntryText(path: string, body: string): string {
  return `${path}\n\n${body}`;
}

/**
 * Read a file as UTF-8, or `null` if it is missing, unreadable, or not
 * valid UTF-8 (E-2 / E-5). Node's `readFile(path, 'utf8')` does **not**
 * throw on invalid UTF-8 — it decodes with U+FFFD replacement characters —
 * so a binary `.md` must be rejected via `isUtf8` on the raw Buffer, not
 * via `.catch()` on a decoded string.
 */
export async function readUtf8OrNull(absPath: string): Promise<string | null> {
  const buf = await readFile(absPath).catch(() => null);
  if (buf == null) return null;
  if (!isUtf8(buf)) return null;
  return buf.toString('utf8');
}

/**
 * Content-hash staleness token (AC-37, Rec-1) — sha256 hex of the file's raw
 * UTF-8 bytes. A content hash rather than an mtime: the dev environment is
 * win32, where a same-tick out-of-band write can share an mtime with the
 * read that preceded it, which would let a concurrent edit slip past a
 * staleness check that trusted mtime alone.
 */
export function revisionOf(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}
