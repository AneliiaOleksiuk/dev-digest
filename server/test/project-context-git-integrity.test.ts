/**
 * Project Context (SPEC-01 amendment) — clone integrity, against a REAL git
 * fixture (bare origin + seed working copy + a clone laid out exactly as
 * `SimpleGitClient.clonePathFor` expects: `<cloneDir>/<owner>/<name>`), not
 * `MockGitClient`. The Development Plan's own Risks section (R-7) flags
 * AC-38 and AC-53 specifically as needing this — `MockGitClient`'s
 * `dirtyPaths` option only covers the service-level AC-51 branch.
 *
 * Oracle (derived from the Spec/Plan before `simple-git.ts` was read for
 * wiring facts):
 *   - AC-38: a save performs NO git operation — `git status --porcelain`
 *     shows the file modified/uncommitted afterward, and HEAD is unchanged.
 *   - AC-50: `sync()` refuses on a dirty working tree (tracked-modified OR
 *     untracked), checked via `--untracked-files=all` BEFORE any
 *     fetch/reset.
 *   - AC-53: on a CLEAN clone, `sync()` behaves exactly as before this
 *     amendment — same fetch, same `reset --hard`, same returned head.
 *
 * Requires a working `git` binary on PATH (available in this environment —
 * verified interactively before writing this file). All git fixture setup
 * below uses raw `execSync` calls, independent of the adapter under test.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { SimpleGitClient } from '../src/adapters/git/simple-git.js';
import { DirtyCloneError } from '../src/adapters/git/errors.js';
import { ProjectContextService } from '../src/modules/project-context/service.js';
import { revisionOf } from '../src/modules/project-context/helpers.js';
import type { ContextRepository } from '../src/modules/project-context/repository.js';
import type { Container } from '../src/platform/container.js';

function sh(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

/** Like `sh`, but does NOT trim — `git status --porcelain`'s leading column
 *  (staged vs. unstaged) is a significant leading space/char, which `.trim()`
 *  would destroy. Used only for porcelain-status assertions. */
function shRaw(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

/** Bare `origin.git` + a `seed` working copy used to push new commits + a
 *  clone laid out at `<root>/acme/repo` (matches `clonePathFor`). Returns
 *  the root and a `push(file, content)` helper to advance origin. */
function makeFixture(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const originDir = join(root, 'origin.git');
  const seedDir = join(root, 'seed');
  mkdirSync(originDir, { recursive: true });
  sh('git init --bare -b main -q', originDir);
  mkdirSync(seedDir, { recursive: true });
  sh('git init -b main -q', seedDir);
  sh('git config user.email test@test.com', seedDir);
  sh('git config user.name test', seedDir);
  mkdirSync(join(seedDir, 'docs'), { recursive: true });
  writeFileSync(join(seedDir, 'docs', 'a.md'), '# doc a\ninitial');
  sh('git add -A', seedDir);
  sh('git commit -q -m init', seedDir);
  sh(`git remote add origin "${originDir}"`, seedDir);
  sh('git push -q origin main', seedDir);

  const ownerDir = join(root, 'acme');
  mkdirSync(ownerDir, { recursive: true });
  sh(`git clone -q "${originDir}" repo`, ownerDir);
  const clonePath = join(ownerDir, 'repo');

  return {
    root,
    clonePath,
    /** Advance `origin` by committing+pushing a new file from the seed copy. */
    advanceOrigin(relPath: string, content: string) {
      const full = join(seedDir, relPath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
      sh('git add -A', seedDir);
      sh(`git commit -q -m "add ${relPath}"`, seedDir);
      sh('git push -q origin main', seedDir);
      return sh('git rev-parse HEAD', seedDir);
    },
  };
}

function cleanup(root: string) {
  rmSync(root, { recursive: true, force: true });
}

describe('SimpleGitClient.sync — clean clone (AC-53 regression: byte-identical to before this amendment)', () => {
  let fx: ReturnType<typeof makeFixture>;

  beforeAll(() => {
    fx = makeFixture('project-context-git-clean-');
  });
  afterAll(() => cleanup(fx.root));

  it('fetches + resets exactly as before on a clean clone: same returned head, worktree advances, no refusal', async () => {
    const newHead = fx.advanceOrigin('docs/b.md', '# doc b\nadded upstream');

    const client = new SimpleGitClient(fx.root);
    const result = await client.sync({ owner: 'acme', name: 'repo' }, 'main');

    expect(result.head).toBe(newHead);
    // reset --hard actually advanced the worktree to the new upstream file.
    expect(readFileSync(join(fx.clonePath, 'docs', 'b.md'), 'utf8')).toContain('added upstream');
    // A clean clone is never refused — status after sync is clean.
    expect(sh('git status --porcelain', fx.clonePath)).toBe('');
    expect(sh('git rev-parse HEAD', fx.clonePath)).toBe(newHead);
  });
});

describe('SimpleGitClient.sync — dirty clone refuses (AC-50)', () => {
  let fx: ReturnType<typeof makeFixture>;

  beforeAll(() => {
    fx = makeFixture('project-context-git-dirty-');
  });
  afterAll(() => cleanup(fx.root));

  it('refuses when a TRACKED file has uncommitted modifications, leaving the worktree and HEAD unchanged', async () => {
    const headBefore = sh('git rev-parse HEAD', fx.clonePath);
    // Simulate an in-app edit: mutate a tracked file directly, no git add/commit.
    writeFileSync(join(fx.clonePath, 'docs', 'a.md'), '# doc a\nEDITED IN-APP, UNCOMMITTED');

    const client = new SimpleGitClient(fx.root);
    await expect(client.sync({ owner: 'acme', name: 'repo' }, 'main')).rejects.toBeInstanceOf(
      DirtyCloneError,
    );

    expect(sh('git rev-parse HEAD', fx.clonePath)).toBe(headBefore);
    expect(readFileSync(join(fx.clonePath, 'docs', 'a.md'), 'utf8')).toContain(
      'EDITED IN-APP, UNCOMMITTED',
    );
  });

  it('refuses when an UNTRACKED (newly created) file is present — AC-50 explicitly includes untracked files', async () => {
    // Revert the tracked edit from the previous test so only an untracked
    // file is dirty this time.
    sh('git checkout -- docs/a.md', fx.clonePath);
    writeFileSync(join(fx.clonePath, 'docs', 'created-in-app.md'), '# brand new, never committed');
    const headBefore = sh('git rev-parse HEAD', fx.clonePath);

    const client = new SimpleGitClient(fx.root);
    let caught: unknown;
    try {
      await client.sync({ owner: 'acme', name: 'repo' }, 'main');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DirtyCloneError);
    expect((caught as InstanceType<typeof DirtyCloneError>).paths).toContain('docs/created-in-app.md');
    expect(sh('git rev-parse HEAD', fx.clonePath)).toBe(headBefore);
  });
});

describe('AC-38 — ProjectContextService.saveDocument performs no git operation', () => {
  let fx: ReturnType<typeof makeFixture>;

  beforeAll(() => {
    fx = makeFixture('project-context-git-save-');
  });
  afterAll(() => cleanup(fx.root));

  it('after a save, git status --porcelain shows the file modified and HEAD is unchanged — no staging, no commit', async () => {
    const headBefore = sh('git rev-parse HEAD', fx.clonePath);
    expect(sh('git status --porcelain', fx.clonePath)).toBe(''); // clean before the save

    const original = readFileSync(join(fx.clonePath, 'docs', 'a.md'), 'utf8');
    const revision = revisionOf(Buffer.from(original, 'utf8'));

    const repo = {
      getRepo: async () => ({ id: 'repo-1', clonePath: fx.clonePath }),
      usageCountsByPath: async () => new Map<string, number>(),
    } as unknown as ContextRepository;
    const container = {
      tokenizer: { count: (text: string) => Math.ceil(text.length / 4) },
      config: { projectContextRoots: ['specs', 'docs', 'insights'] },
    } as unknown as Container;
    const service = new ProjectContextService(repo, container);

    await service.saveDocument('ws1', 'repo1', {
      path: 'docs/a.md',
      content: '# doc a\nedited via the in-app editor',
      revision,
    });

    const status = shRaw('git status --porcelain', fx.clonePath);
    expect(status).toContain('docs/a.md');
    expect(sh('git rev-parse HEAD', fx.clonePath)).toBe(headBefore); // HEAD unchanged — no commit
    // Nothing was staged either — a real commit would need `git add` first,
    // and the porcelain 'M' in the SECOND column (not the first) confirms
    // the change is unstaged.
    const line = status.split('\n').find((l) => l.includes('docs/a.md'))!;
    expect(line[0]).toBe(' '); // index column is blank — not staged
    expect(line[1]).toBe('M'); // worktree column shows the modification
  });
});
