/**
 * Project Context (SPEC-01) — discover.ts self-check (implementer's own
 * verification; test-writer owns the full suite per the work item's stated
 * Definition of done).
 *
 * No DB. Builds a temp clone on disk, runs `discoverDocuments`, asserts the
 * edge cases the plan's WI3 Definition of done names explicitly: nested
 * discovery, a missing root (E-16), an empty clone (E-14), and the
 * oversized-file exclusion (E-3).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverDocuments } from '../src/modules/project-context/discover.js';
import { MAX_DOC_FILE_BYTES } from '../src/modules/project-context/constants.js';

async function writeFileAt(root: string, rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  const dir = full.slice(0, full.lastIndexOf('/'));
  if (dir && dir !== root) await mkdir(dir, { recursive: true });
  await writeFile(full, contents);
}

describe('discoverDocuments', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'project-context-discover-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('finds a nested .md document under a configured root (AC-1)', async () => {
    await writeFileAt(root, 'docs/adr/0001-x.md', '# ADR 0001');
    const result = await discoverDocuments(root, ['specs', 'docs', 'insights']);
    expect(result.documents).toEqual([
      { path: 'docs/adr/0001-x.md', sourceFolder: 'docs', bytes: 10 },
    ]);
  });

  it('treats a missing configured root as a no-op, not an error (E-16)', async () => {
    await writeFileAt(root, 'docs/x.md', 'x');
    const result = await discoverDocuments(root, ['specs', 'docs', 'insights']);
    expect(result.documents.map((d) => d.path)).toEqual(['docs/x.md']);
  });

  it('returns an empty set for a clone with zero .md files (E-14)', async () => {
    await writeFileAt(root, 'docs/readme.ts', 'export {}');
    const result = await discoverDocuments(root, ['specs', 'docs', 'insights']);
    expect(result.documents).toEqual([]);
    expect(result.bounded).toBe(false);
  });

  it('excludes a file above MAX_DOC_FILE_BYTES (E-3)', async () => {
    await writeFileAt(root, 'docs/big.md', 'x'.repeat(MAX_DOC_FILE_BYTES + 1));
    await writeFileAt(root, 'docs/small.md', 'small');
    const result = await discoverDocuments(root, ['docs']);
    expect(result.documents.map((d) => d.path)).toEqual(['docs/small.md']);
  });

  it('ignores non-.md files', async () => {
    await writeFileAt(root, 'docs/readme.txt', 'nope');
    await writeFileAt(root, 'docs/readme.md', 'yep');
    const result = await discoverDocuments(root, ['docs']);
    expect(result.documents.map((d) => d.path)).toEqual(['docs/readme.md']);
  });

  // test-writer addition — WI3's stated Definition of done names this fifth
  // case explicitly ("a symlink pointing outside the clone is excluded,
  // E-10") but the implementer's self-check above never created one.
  it('excludes a symlink escaping the clone, even when it resolves to a directory (E-10)', async () => {
    await writeFileAt(root, 'docs/inside.md', 'inside');
    const outside = await mkdtemp(join(tmpdir(), 'project-context-outside-'));
    try {
      if (process.platform === 'win32') {
        // Windows: a FILE symlink needs Developer Mode / admin (EPERM
        // otherwise); a directory JUNCTION does not. `discoverDocuments`
        // rejects on `entry.isSymbolicLink()` before ever looking at
        // file-vs-directory, so a junction exercises the identical guard
        // (walkDir's `if (entry.isSymbolicLink()) continue`).
        await symlink(outside, join(root, 'docs', 'escaped'), 'junction');
      } else {
        await writeFile(join(outside, 'secret.md'), 'leaked');
        await symlink(join(outside, 'secret.md'), join(root, 'docs', 'escaped.md'));
      }
      const result = await discoverDocuments(root, ['docs']);
      expect(result.documents.map((d) => d.path)).toEqual(['docs/inside.md']);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
