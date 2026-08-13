/**
 * Project Context (SPEC-01 amendment) — AC-39: a write that fails after
 * every guard has already passed (permissions, read-only mount, disk error)
 * must surface as an error and report no success — the best-effort,
 * never-fail contract of AC-20 governs run-time READS only and is NOT
 * extended to a user-initiated write (NFR A10). Isolated into its own file
 * because it needs `node:fs/promises`'s `writeFile` mocked to actually
 * reach the write step (a permission/disk failure can't be reliably forced
 * cross-platform any other way) — fixture setup below therefore uses the
 * SYNC `node:fs` API, which this mock does not touch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectContextService } from '../src/modules/project-context/service.js';
import { revisionOf } from '../src/modules/project-context/helpers.js';
import type { ContextRepository } from '../src/modules/project-context/repository.js';
import type { Container } from '../src/platform/container.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn().mockRejectedValue(
      Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }),
    ),
  };
});

function makeService(clonePath: string) {
  const repo = {
    getRepo: async () => ({ id: 'repo-1', clonePath }),
    usageCountsByPath: async () => new Map<string, number>(),
  } as unknown as ContextRepository;
  const container = {
    tokenizer: { count: (text: string) => Math.ceil(text.length / 4) },
    config: { projectContextRoots: ['specs', 'docs', 'insights'] },
  } as unknown as Container;
  return new ProjectContextService(repo, container);
}

describe('AC-39 — a write that fails after every guard passes propagates loudly', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'project-context-writefail-'));
    mkdirSync(join(root, 'docs'), { recursive: true });
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('saveDocument: an existing, correctly-staged save whose writeFile() throws propagates the error (no success reported)', async () => {
    writeFileSync(join(root, 'docs', 'a.md'), 'existing content');
    const service = makeService(root);
    const revision = revisionOf(Buffer.from('existing content', 'utf8'));

    await expect(
      service.saveDocument('ws1', 'repo1', { path: 'docs/a.md', content: 'new content', revision }),
    ).rejects.toThrow(/permission denied/);
  });

  it('createDocument: a correctly-staged create whose writeFile() throws (non-EEXIST) propagates the raw error, not a generic "already exists" 4xx', async () => {
    const service = makeService(root);
    await expect(
      service.createDocument('ws1', 'repo1', { path: 'docs/new.md', content: 'x' }),
    ).rejects.toThrow(/permission denied/);
  });
});
