/**
 * Project Context (SPEC-01) — service.ts self-check (implementer's own
 * verification; test-writer owns the full suite per WI5's stated
 * Definition of done). Stubs `ContextRepository` (no DB) + a stub Tokenizer
 * via a fake `Container`, same pattern as `test/repo-intel-resync.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectContextService } from '../src/modules/project-context/service.js';
import type { ContextRepository, EffectiveAttachmentRow } from '../src/modules/project-context/repository.js';
import type { Container } from '../src/platform/container.js';

async function writeFileAt(root: string, rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  const dir = full.slice(0, full.lastIndexOf('/'));
  if (dir && dir !== root) await mkdir(dir, { recursive: true });
  await writeFile(full, contents);
}

function makeService(opts: {
  clonePath: string | null;
  effective: EffectiveAttachmentRow[];
  usageCounts?: Map<string, number>;
  attachedPaths?: string[];
  mismatched?: { path: string; repoId: string }[];
}) {
  const repo = {
    getRepo: async () => ({ id: 'repo-1', clonePath: opts.clonePath }),
    listForAgentEffective: async () => opts.effective,
    listMismatchedForAgent: async () => opts.mismatched ?? [],
    usageCountsByPath: async () => opts.usageCounts ?? new Map<string, number>(),
    distinctAttachedPaths: async () => opts.attachedPaths ?? [],
  } as unknown as ContextRepository;

  // Simple deterministic "tokenizer": 1 token per 4 chars, like the real
  // fallback heuristic — good enough to exercise the budget cutoff.
  const container = {
    tokenizer: { count: (text: string) => Math.ceil(text.length / 4) },
    config: { projectContextRoots: ['specs', 'docs', 'insights'] },
  } as unknown as Container;

  return new ProjectContextService(repo, container);
}

describe('ProjectContextService.resolveEffectiveSet', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'project-context-service-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('dedupes a document attached both directly and via a skill, keeping the lowest order (AC-14/D-1)', async () => {
    await writeFileAt(root, 'docs/shared.md', 'shared rule text');
    const service = makeService({
      clonePath: root,
      effective: [
        { path: 'docs/shared.md', order: 1, source: 'skill', skillName: 'Sec' },
        { path: 'docs/shared.md', order: 0, source: 'agent' },
      ],
    });
    const result = await service.resolveEffectiveSet('ws1', 'agent1', 'repo1');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.path).toBe('docs/shared.md');
  });

  it('embeds the repo-relative path inside the entry text (AC-19)', async () => {
    await writeFileAt(root, 'docs/rule.md', 'the api module must not import db directly');
    const service = makeService({
      clonePath: root,
      effective: [{ path: 'docs/rule.md', order: 0, source: 'agent' }],
    });
    const result = await service.resolveEffectiveSet('ws1', 'agent1', 'repo1');
    expect(result.entries[0]!.text.startsWith('docs/rule.md\n')).toBe(true);
    expect(result.entries[0]!.text).toContain('must not import db directly');
  });

  it('skips a whitespace-only document without emitting an entry (E-4)', async () => {
    await writeFileAt(root, 'docs/empty.md', '   \n\t  ');
    const service = makeService({
      clonePath: root,
      effective: [{ path: 'docs/empty.md', order: 0, source: 'agent' }],
    });
    const result = await service.resolveEffectiveSet('ws1', 'agent1', 'repo1');
    expect(result.entries).toEqual([]);
    expect(result.skipped).toEqual(['docs/empty.md']);
  });

  it('skips a deleted/unreadable attached document (AC-20/E-2), never throws', async () => {
    const service = makeService({
      clonePath: root,
      effective: [{ path: 'docs/gone.md', order: 0, source: 'agent' }],
    });
    const result = await service.resolveEffectiveSet('ws1', 'agent1', 'repo1');
    expect(result.entries).toEqual([]);
    expect(result.skipped).toEqual(['docs/gone.md']);
  });

  it('cuts the ordered list at the token budget and reports the remainder truncated (AC-22)', async () => {
    // Each body is longer than MAX_DOC_CHARS (20,000) so it's truncated to
    // exactly that many chars (~5000 tokens under the ceil(len/4) stub
    // tokenizer) — two of those together (~10,000 tokens) exceed the 8000
    // PROJECT_CONTEXT_TOKEN_BUDGET, so the second must be cut.
    await writeFileAt(root, 'docs/a.md', 'a'.repeat(25_000));
    await writeFileAt(root, 'docs/b.md', 'b'.repeat(25_000));
    const service = makeService({
      clonePath: root,
      effective: [
        { path: 'docs/a.md', order: 0, source: 'agent' },
        { path: 'docs/b.md', order: 1, source: 'agent' },
      ],
    });
    const result = await service.resolveEffectiveSet('ws1', 'agent1', 'repo1');
    expect(result.entries.map((e) => e.path)).toEqual(['docs/a.md']);
    expect(result.truncated).toEqual(['docs/b.md']);
  });

  it('returns an empty result when the repo has no local clone (E-1)', async () => {
    const service = makeService({ clonePath: null, effective: [] });
    const result = await service.resolveEffectiveSet('ws1', 'agent1', 'repo1');
    expect(result).toEqual({ entries: [], skipped: [], truncated: [], mismatched: [] });
  });

  // test-writer addition — WI5's Definition of done names E-5 explicitly
  // ("binary skipped, no throw"); the implementer's self-check above never
  // wrote it. Phase-1 oracle from the Spec: "E-5 Non-UTF8 / binary file with
  // a `.md` extension. Read must not throw the run; skip like E-2." Kept as
  // the Spec states it, per the two-phase rule — see the "Behavior
  // mismatches found" section of this session's report if this fails.
  it('skips a non-UTF8/binary .md file without throwing (E-5)', async () => {
    const full = join(root, 'docs', 'binary.md');
    await mkdir(join(root, 'docs'), { recursive: true });
    // Invalid UTF-8 byte sequences with no whitespace-only decode.
    await writeFile(full, Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x9c, 0x8f, 0xc3, 0x28]));
    const service = makeService({
      clonePath: root,
      effective: [{ path: 'docs/binary.md', order: 0, source: 'agent' }],
    });
    await expect(service.resolveEffectiveSet('ws1', 'agent1', 'repo1')).resolves.not.toThrow();
    const result = await service.resolveEffectiveSet('ws1', 'agent1', 'repo1');
    expect(result.entries).toEqual([]);
    expect(result.skipped).toEqual(['docs/binary.md']);
  });

  it('skips a disabled-skill attachment before read so it contributes nothing (AC-15)', async () => {
    await writeFileAt(root, 'docs/from-disabled.md', 'disabled skill body');
    await writeFileAt(root, 'docs/from-enabled.md', 'enabled skill body');
    const service = makeService({
      clonePath: root,
      effective: [
        {
          path: 'docs/from-disabled.md',
          order: 0,
          source: 'skill',
          skillName: 'Off',
          enabled: false,
        },
        {
          path: 'docs/from-enabled.md',
          order: 1,
          source: 'skill',
          skillName: 'On',
          enabled: true,
        },
      ],
    });
    const result = await service.resolveEffectiveSet('ws1', 'agent1', 'repo1');
    expect(result.entries.map((e) => e.path)).toEqual(['docs/from-enabled.md']);
    expect(result.skipped).not.toContain('docs/from-disabled.md');
    expect(result.truncated).not.toContain('docs/from-disabled.md');
    expect(result.entries.map((e) => e.path)).not.toContain('docs/from-disabled.md');
  });

  it('surfaces other-repo attachment paths in mismatched and does not inject them (E-8)', async () => {
    await writeFileAt(root, 'docs/this-repo.md', 'this repo body');
    await writeFileAt(root, 'docs/other-repo.md', 'other repo body');
    const service = makeService({
      clonePath: root,
      effective: [{ path: 'docs/this-repo.md', order: 0, source: 'agent' }],
      mismatched: [{ path: 'docs/other-repo.md', repoId: 'repo-other' }],
    });
    const result = await service.resolveEffectiveSet('ws1', 'agent1', 'repo1');
    expect(result.mismatched).toEqual(['docs/other-repo.md']);
    expect(result.entries.map((e) => e.path)).toEqual(['docs/this-repo.md']);
    expect(result.entries.map((e) => e.path)).not.toContain('docs/other-repo.md');
  });
});

describe('ProjectContextService.listDocuments', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'project-context-service-list-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // test-writer addition — AC-2 ("display, for every listed document, an
  // estimated token count derived from that document's full text") is named
  // in WI5's Definition of done but the implementer's self-check only
  // exercised `resolveEffectiveSet`, never `listDocuments`.
  it('returns a per-document estimated token count derived from the stub Tokenizer (AC-2)', async () => {
    await writeFileAt(root, 'docs/rule.md', 'x'.repeat(40)); // 40 chars ⇒ 10 tokens under the stub
    const service = makeService({ clonePath: root, effective: [] });
    const listing = await service.listDocuments('ws1', 'repo1');
    expect(listing.documents).toHaveLength(1);
    expect(listing.documents[0]).toMatchObject({ path: 'docs/rule.md', tokens: 10, missing: false });
    expect(listing.total_tokens).toBe(10);
    expect(listing.total_files).toBe(1);
  });
});
