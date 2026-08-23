/**
 * Project Context (SPEC-01) — bounded recursive `.md` discovery.
 *
 * Modelled on `modules/repo-intel/pipeline/walk.ts`: same `readdir`/`stat`
 * shape, same "sort for stable order, then bound" ending. Differences: starts
 * from each configured search root (a root absent from the repo contributes
 * nothing — E-16), filters on `.md` only, and every resolved path —
 * directory entries included — passes `isInsideClone` before any `stat`/read
 * so a symlink escaping the clone is dropped (E-10). Metadata only: content
 * is read on demand by the service (AC-5 — no cached body is ever served).
 */
import { readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { EXCLUDED_DIRS } from '../repo-intel/constants.js';
import { isInsideClone } from '../reviews/intent-inputs.js';
import { DOC_EXT, MAX_DISCOVERED_DOCS, MAX_DOC_FILE_BYTES } from './constants.js';

const EXCLUDED_SET: ReadonlySet<string> = new Set(EXCLUDED_DIRS);

export interface DiscoveredDoc {
  /** Repo-relative path, forward-slash normalized. */
  path: string;
  /** Which configured search root this was found under (e.g. "docs"). */
  sourceFolder: string;
  bytes: number;
}

export interface DiscoverResult {
  documents: DiscoveredDoc[];
  /** True when the walk exceeded MAX_DISCOVERED_DOCS and was truncated. */
  bounded: boolean;
}

/**
 * Recursively walk `clonePath` under each of `roots`, returning every
 * discovered `.md` file's metadata (path/source folder/size). A root that
 * doesn't exist in this repo (E-16) or a symlink escaping the clone (E-10) is
 * silently skipped, never an error.
 */
export async function discoverDocuments(
  clonePath: string,
  roots: string[],
): Promise<DiscoverResult> {
  const out: DiscoveredDoc[] = [];

  for (const root of roots) {
    const rootAbs = isInsideClone(clonePath, root);
    if (!rootAbs) continue; // configured root escapes the clone — treat as absent
    let rootStat;
    try {
      rootStat = await stat(rootAbs);
    } catch {
      continue; // E-16 — root doesn't exist in this repo, not an error
    }
    if (!rootStat.isDirectory()) continue;
    await walkDir(clonePath, rootAbs, root, out);
  }

  // Stable order (alphabetical repo-relative path), then bound (E-15).
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const bounded = out.length > MAX_DISCOVERED_DOCS;
  if (bounded) out.length = MAX_DISCOVERED_DOCS;

  return { documents: out, bounded };
}

async function walkDir(
  clonePath: string,
  dir: string,
  sourceFolder: string,
  out: DiscoveredDoc[],
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch {
    return; // unreadable directory — skip cleanly, keep walking the rest
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue; // E-10 — never follow symlinks

    const full = join(dir, entry.name);
    const rel = relative(clonePath, full).split(sep).join('/');
    // Every resolved path — directory entries included — must stay inside
    // the clone before any further stat/read (E-10).
    if (!isInsideClone(clonePath, rel)) continue;

    if (entry.isDirectory()) {
      if (EXCLUDED_SET.has(entry.name)) continue;
      await walkDir(clonePath, full, sourceFolder, out);
      continue;
    }

    if (!entry.isFile()) continue;
    if (extname(entry.name).toLowerCase() !== DOC_EXT) continue;

    let size: number;
    try {
      size = (await stat(full)).size;
    } catch {
      continue;
    }
    if (size > MAX_DOC_FILE_BYTES) continue; // E-3 — oversized document

    out.push({ path: rel, sourceFolder, bytes: size });
  }
}
