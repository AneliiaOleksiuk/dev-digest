import { describe, it, expect } from 'vitest';
import { CiExportInput } from '@devdigest/shared';
import {
  agentsSubdirFor,
  skillsSubdirFor,
  memoryPathFor,
  workflowPathFor,
  devdigestDirFor,
  ingestSecretNameFor,
  workflowNameFor,
  RUNNER_PATH,
  RUN_COMMAND,
  WORKFLOW_PATH,
  AGENTS_SUBDIR,
  SKILLS_SUBDIR,
  MEMORY_PATH,
  INGEST_SECRET_NAME_LEGACY,
} from '../src/modules/ci/constants.js';

/**
 * Oracle: specs/SPEC-05-multi-agent-ci-per-repo.md AC-5, AC-6, AC-14, AC-18,
 * AC-19, AC-20, AC-21, AC-22, AC-25, derived from the spec's EARS wording and
 * the plan's WI2 BEFORE reading `constants.ts`'s own comments beyond the
 * exported function names/signatures.
 */

const NS = 'security-reviewer';

describe('AC-5/AC-18: namespaced layout paths — .devdigest/<ns>/… and a per-namespace workflow filename', () => {
  it('agentsSubdirFor/skillsSubdirFor/memoryPathFor nest under the namespace', () => {
    expect(agentsSubdirFor(NS)).toBe(`.devdigest/${NS}/agents`);
    expect(skillsSubdirFor(NS)).toBe(`.devdigest/${NS}/skills`);
    expect(memoryPathFor(NS)).toBe(`.devdigest/${NS}/memory.jsonl`);
  });

  it('workflowPathFor emits a per-namespace filename under .github/workflows/', () => {
    expect(workflowPathFor(NS)).toBe(`.github/workflows/devdigest-review-${NS}.yml`);
  });

  it('two different namespaces never collide on a path', () => {
    const other = 'api-contract-reviewer';
    expect(agentsSubdirFor(NS)).not.toBe(agentsSubdirFor(other));
    expect(workflowPathFor(NS)).not.toBe(workflowPathFor(other));
  });
});

describe('AC-14: legacy (namespace: null) reproduces the exact unnamespaced SPEC-04 literals', () => {
  it('agentsSubdirFor/skillsSubdirFor/memoryPathFor/workflowPathFor fall back to the SPEC-04 constants', () => {
    expect(agentsSubdirFor(null)).toBe(AGENTS_SUBDIR);
    expect(skillsSubdirFor(null)).toBe(SKILLS_SUBDIR);
    expect(memoryPathFor(null)).toBe(MEMORY_PATH);
    expect(workflowPathFor(null)).toBe(WORKFLOW_PATH);
  });
});

describe('AC-6/AC-20: RUNNER_PATH and RUN_COMMAND are NOT parameterised by namespace', () => {
  it('RUNNER_PATH/RUN_COMMAND are plain constants, not functions of namespace', () => {
    expect(RUNNER_PATH).toBe('.devdigest/runner/index.js');
    expect(RUN_COMMAND).toBe('node .devdigest/runner/index.js');
  });
});

describe('AC-19: devdigestDirFor — the runner env value, null for legacy', () => {
  it('returns .devdigest/<ns> for a namespaced installation', () => {
    expect(devdigestDirFor(NS)).toBe(`.devdigest/${NS}`);
  });

  it('returns null for legacy — emit NO DEVDIGEST_DIR key at all', () => {
    expect(devdigestDirFor(null)).toBeNull();
  });
});

describe('AC-21/AC-16: workflowNameFor — namespace-derived name:, null (no name: key) for legacy', () => {
  it('derives the workflow name from the namespace charset, never the raw agent display name', () => {
    expect(workflowNameFor(NS)).toBe(`devdigest-review-${NS}`);
  });

  it('two agents on one repo emit two DISTINCT workflow names', () => {
    const a = workflowNameFor('security-reviewer');
    const b = workflowNameFor('api-contract-reviewer');
    expect(a).not.toBe(b);
  });

  it('the emitted name contains no character outside the slug charset [a-z0-9-]', () => {
    const name = workflowNameFor(NS)!;
    expect(name).toMatch(/^[a-z0-9-]+$/);
  });

  it('returns null for legacy — AC-16: no name: key emitted, so a configured required check is never invalidated', () => {
    expect(workflowNameFor(null)).toBeNull();
  });
});

describe('AC-25: ingestSecretNameFor — DEVDIGEST_INGEST_TOKEN_<NAMESPACE>, legacy bare DEVDIGEST_INGEST_TOKEN', () => {
  it.each([
    ['security-reviewer', 'DEVDIGEST_INGEST_TOKEN_SECURITY_REVIEWER'],
    ['2fa-checker', 'DEVDIGEST_INGEST_TOKEN_2FA_CHECKER'],
    ['untitled', 'DEVDIGEST_INGEST_TOKEN_UNTITLED'],
  ])('uppercases the namespace and replaces "-" with "_": %s -> %s', (namespace, expected) => {
    expect(ingestSecretNameFor(namespace)).toBe(expected);
  });

  it('satisfies GitHub Actions secret-naming rules: alphanumerics/underscores only, not digit-leading, not GITHUB_-prefixed', () => {
    for (const ns of ['security-reviewer', '2fa-checker', 'untitled', 'a'.repeat(48)]) {
      const name = ingestSecretNameFor(ns);
      expect(name).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/);
      expect(name.startsWith('GITHUB_')).toBe(false);
    }
  });

  it('every distinct namespace in a representative set maps to a distinct secret name (pairwise distinctness)', () => {
    const names = ['security-reviewer', 'api-contract-reviewer', '2fa-checker', 'untitled'].map(
      ingestSecretNameFor,
    );
    expect(new Set(names).size).toBe(names.length);
  });

  it('returns the legacy INGEST_SECRET_NAME_LEGACY constant for namespace: null (AC-14)', () => {
    expect(ingestSecretNameFor(null)).toBe(INGEST_SECRET_NAME_LEGACY);
    expect(INGEST_SECRET_NAME_LEGACY).toBe('DEVDIGEST_INGEST_TOKEN');
  });
});

describe('AC-3: the export input contract carries NO namespace field — it is server-derived only, never client-supplied', () => {
  it('CiExportInput.shape has no "namespace" key', () => {
    expect(Object.keys(CiExportInput.shape)).not.toContain('namespace');
  });

  it('parsing a body WITH an extra "namespace" field silently drops it (never round-trips into the parsed value)', () => {
    const parsed = CiExportInput.parse({
      repo: 'acme/payments-api',
      ingest_url: 'https://studio.example.com/ci/ingest',
      namespace: '../../etc/passwd',
    });
    expect(parsed).not.toHaveProperty('namespace');
  });
});
