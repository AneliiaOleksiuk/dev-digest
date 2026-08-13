/**
 * Project Context (SPEC-01 amendment) — `ProjectContextService.saveDocument`
 * / `createDocument` / the widened `getDocumentContent` (WI3). Real tmp-dir
 * filesystem, stubbed `ContextRepository` (no DB) — same pattern as
 * `test/project-context-service.test.ts` / `test/repo-intel-resync.test.ts`.
 * Oracle: AC-33 (server half), AC-34, AC-36, AC-37, AC-39, AC-40, AC-41,
 * AC-42 (service half), AC-44, AC-46, AC-49 — derived from the Spec/Plan
 * before `service.ts` was read for wiring facts.
 *
 * AC-38 ("no git operation" — verified via a real `git status --porcelain`)
 * and AC-53 (clean-clone `sync()` regression) need a REAL git fixture, not
 * this stubbed-repository harness — see
 * `test/project-context-git-integrity.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectContextService } from '../src/modules/project-context/service.js';
import { ConflictError, NotFoundError, ValidationError } from '../src/platform/errors.js';
import { revisionOf } from '../src/modules/project-context/helpers.js';
import { MAX_DOC_FILE_BYTES } from '../src/modules/project-context/constants.js';
import type { ContextRepository } from '../src/modules/project-context/repository.js';
import type { Container } from '../src/platform/container.js';

function makeService(clonePath: string | null | undefined) {
  const repo = {
    getRepo: async () => (clonePath === undefined ? undefined : { id: 'repo-1', clonePath }),
    usageCountsByPath: async () => new Map<string, number>(),
  } as unknown as ContextRepository;
  const container = {
    tokenizer: { count: (text: string) => Math.ceil(text.length / 4) },
    config: { projectContextRoots: ['specs', 'docs', 'insights'] },
  } as unknown as Container;
  return new ProjectContextService(repo, container);
}

describe('ProjectContextService.saveDocument', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'project-context-write-'));
    await mkdir(join(root, 'docs'), { recursive: true });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('AC-34/AC-40: overwrites the file at its resolved path and returns fresh metadata + revision, no DB copy of the text', async () => {
    await writeFile(join(root, 'docs', 'a.md'), 'old content');
    const service = makeService(root);
    const revision = revisionOf(Buffer.from('old content', 'utf8'));

    const result = await service.saveDocument('ws1', 'repo1', {
      path: 'docs/a.md',
      content: 'new content',
      revision,
    });

    const onDisk = await readFile(join(root, 'docs', 'a.md'), 'utf8');
    expect(onDisk).toBe('new content');
    expect(result.document.path).toBe('docs/a.md');
    expect(result.revision).toBe(revisionOf(Buffer.from('new content', 'utf8')));
    // The write result is derived from the caller's content/tokenizer, not
    // from any persisted row — nothing here is a DB read.
    expect(result.document.tokens).toBe(Math.ceil('new content'.length / 4));
  });

  it('AC-36 / E-18: rejects a save whose path does not resolve to an EXISTING file (never creates on save)', async () => {
    const service = makeService(root);
    await expect(
      service.saveDocument('ws1', 'repo1', {
        path: 'docs/does-not-exist.md',
        content: 'x',
        revision: 'irrelevant',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(stat(join(root, 'docs', 'does-not-exist.md'))).rejects.toThrow();
  });

  it('AC-36: rejects a path that is not a .md file under a configured root — package.json case', async () => {
    await writeFile(join(root, 'package.json'), '{}');
    const service = makeService(root);
    await expect(
      service.saveDocument('ws1', 'repo1', { path: 'package.json', content: 'x', revision: 'r' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('AC-36: rejects a .md file that exists on disk but outside every configured search root', async () => {
    await mkdir(join(root, 'notes'), { recursive: true });
    await writeFile(join(root, 'notes', 'a.md'), 'x');
    const service = makeService(root);
    await expect(
      service.saveDocument('ws1', 'repo1', { path: 'notes/a.md', content: 'y', revision: 'r' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await readFile(join(root, 'notes', 'a.md'), 'utf8')).toBe('x'); // untouched
  });

  it('AC-35: rejects a path escaping the clone (traversal), writes nothing', async () => {
    const service = makeService(root);
    await expect(
      service.saveDocument('ws1', 'repo1', {
        path: '../../etc/passwd.md',
        content: 'x',
        revision: 'r',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('AC-37: rejects with ConflictError (409) when the on-disk content moved since it was loaded, and leaves the out-of-band content untouched', async () => {
    await writeFile(join(root, 'docs', 'a.md'), 'original');
    const service = makeService(root);
    const staleRevision = revisionOf(Buffer.from('original', 'utf8'));

    // Mutate out of band AFTER the caller's "load" but BEFORE their save.
    await writeFile(join(root, 'docs', 'a.md'), 'changed out of band');

    const attempt = service.saveDocument('ws1', 'repo1', {
      path: 'docs/a.md',
      content: 'the editor’s stale draft',
      revision: staleRevision,
    });
    await expect(attempt).rejects.toBeInstanceOf(ConflictError);
    await expect(attempt).rejects.toMatchObject({ statusCode: 409 });

    const survivorContent = await readFile(join(root, 'docs', 'a.md'), 'utf8');
    expect(survivorContent).toBe('changed out of band');
  });

  it('AC-37 vs AC-36: a stale-revision rejection (409) is a distinct error TYPE from a bad-path rejection (422/ValidationError)', async () => {
    await writeFile(join(root, 'docs', 'a.md'), 'v1');
    const service = makeService(root);

    const badPath = service.saveDocument('ws1', 'repo1', {
      path: '../escape.md',
      content: 'x',
      revision: 'whatever',
    });
    await expect(badPath).rejects.toBeInstanceOf(ValidationError);
    await expect(badPath).rejects.toMatchObject({ statusCode: 422 });

    const staleSave = service.saveDocument('ws1', 'repo1', {
      path: 'docs/a.md',
      content: 'x',
      revision: 'not-the-real-hash',
    });
    await expect(staleSave).rejects.toBeInstanceOf(ConflictError);
    await expect(staleSave).rejects.toMatchObject({ statusCode: 409 });
  });

  it('AC-36: a "file" that is actually a directory at that path is treated as not-an-existing-document (existingStat.isFile() gate)', async () => {
    // Documents the boundary between AC-36 (path doesn't resolve to an
    // existing FILE) and AC-39 (an existing file whose WRITE then fails) —
    // see project-context-write-failure.test.ts for the real AC-39 case,
    // which needs a mocked `writeFile` to reach the write step at all.
    await mkdir(join(root, 'docs', 'weird.md'), { recursive: true });
    const service = makeService(root);
    await expect(
      service.saveDocument('ws1', 'repo1', {
        path: 'docs/weird.md',
        content: 'x',
        revision: 'irrelevant-never-reached',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('AC-49: rejects content over MAX_DOC_FILE_BYTES and writes nothing', async () => {
    await writeFile(join(root, 'docs', 'a.md'), 'small');
    const service = makeService(root);
    const revision = revisionOf(Buffer.from('small', 'utf8'));
    const bigContent = 'a'.repeat(MAX_DOC_FILE_BYTES + 1);

    await expect(
      service.saveDocument('ws1', 'repo1', { path: 'docs/a.md', content: bigContent, revision }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await readFile(join(root, 'docs', 'a.md'), 'utf8')).toBe('small');
  });

  it('throws NotFoundError when the repo is not found in the workspace (workspace-scoped lookup)', async () => {
    const service = makeService(undefined);
    await expect(
      service.saveDocument('ws1', 'repo1', { path: 'docs/a.md', content: 'x', revision: 'r' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('ProjectContextService.createDocument', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'project-context-create-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('AC-41: creates a new .md file inside the clone with the given content', async () => {
    const service = makeService(root);
    const result = await service.createDocument('ws1', 'repo1', {
      path: 'docs/new.md',
      content: 'brand new',
    });
    expect(await readFile(join(root, 'docs', 'new.md'), 'utf8')).toBe('brand new');
    expect(result.document.path).toBe('docs/new.md');
  });

  it('AC-46: creates missing nested directories under a configured root', async () => {
    const service = makeService(root);
    await service.createDocument('ws1', 'repo1', { path: 'docs/adr/0005/deep.md', content: 'x' });
    expect(await readFile(join(root, 'docs', 'adr', '0005', 'deep.md'), 'utf8')).toBe('x');
  });

  it('AC-46: rejects a create under an excluded directory (node_modules) even though it sits under a configured root', async () => {
    const service = makeService(root);
    await expect(
      service.createDocument('ws1', 'repo1', { path: 'docs/node_modules/pwned.md', content: 'x' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(stat(join(root, 'docs', 'node_modules'))).rejects.toThrow();
  });

  it('AC-44/E-23: a second create at the SAME path is rejected atomically (wx flag), and the first file survives untouched', async () => {
    const service = makeService(root);
    const first = await service.createDocument('ws1', 'repo1', {
      path: 'docs/dup.md',
      content: 'first write',
    });
    expect(first.document.path).toBe('docs/dup.md');

    await expect(
      service.createDocument('ws1', 'repo1', { path: 'docs/dup.md', content: 'second write — must not land' }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(await readFile(join(root, 'docs', 'dup.md'), 'utf8')).toBe('first write');
  });

  it('AC-49: rejects create content over MAX_DOC_FILE_BYTES and creates nothing', async () => {
    const service = makeService(root);
    const bigContent = 'a'.repeat(MAX_DOC_FILE_BYTES + 1);
    await expect(
      service.createDocument('ws1', 'repo1', { path: 'docs/toobig.md', content: bigContent }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(stat(join(root, 'docs', 'toobig.md'))).rejects.toThrow();
  });

  it('AC-43: rejects a create whose path escapes the clone, is outside every configured root, or is not .md — one clause each', async () => {
    const service = makeService(root);
    await expect(
      service.createDocument('ws1', 'repo1', { path: '../../etc/passwd.md', content: 'x' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      service.createDocument('ws1', 'repo1', { path: 'random/outside.md', content: 'x' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      service.createDocument('ws1', 'repo1', { path: 'docs/not-markdown.txt', content: 'x' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError when the repo is not found in the workspace', async () => {
    const service = makeService(undefined);
    await expect(
      service.createDocument('ws1', 'repo1', { path: 'docs/a.md', content: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('ProjectContextService.getDocumentContent — widened with revision (Rec-1)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'project-context-read-'));
    await mkdir(join(root, 'docs'), { recursive: true });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns a content-hash revision alongside path/content, matching revisionOf(file bytes)', async () => {
    await writeFile(join(root, 'docs', 'a.md'), 'hello world');
    const service = makeService(root);
    const doc = await service.getDocumentContent('ws1', 'repo1', 'docs/a.md');
    expect(doc).toBeDefined();
    expect(doc!.content).toBe('hello world');
    expect(doc!.revision).toBe(revisionOf(Buffer.from('hello world', 'utf8')));
  });

  it('AC-33 (server half): a re-read after an out-of-band change returns the NEW content and a NEW revision — never a cached body', async () => {
    await writeFile(join(root, 'docs', 'a.md'), 'v1');
    const service = makeService(root);
    const first = await service.getDocumentContent('ws1', 'repo1', 'docs/a.md');

    await writeFile(join(root, 'docs', 'a.md'), 'v2');
    const second = await service.getDocumentContent('ws1', 'repo1', 'docs/a.md');

    expect(first!.content).toBe('v1');
    expect(second!.content).toBe('v2');
    expect(second!.revision).not.toBe(first!.revision);
  });
});
