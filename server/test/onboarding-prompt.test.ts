/**
 * Onboarding WI5 — prompt assembly unit tests (no DB, no network, no mocking
 * needed: `renderPrompt` reads the real `src/prompts/onboarding.system.md`
 * file off disk).
 *
 * Oracle: WI5's Definition of done — "a unit test over the assembled
 * `ChatMessage[]` asserts (a) every fact block is delimiter-wrapped, (b) the
 * system message contains no repo-derived substring, (c) the template no
 * longer names `routes_and_apis` and the rendered `{{sections}}`/
 * `{{language}}` placeholders are both substituted" — and Spec AC-32
 * ("every repo-derived block ... check the actual message content, not just
 * that the function was called").
 */
import { describe, it, expect } from 'vitest';
import type { IndexState } from '../src/modules/repo-intel/types.js';
import type { CollectedFacts } from '../src/modules/onboarding/facts.js';
import {
  buildOnboardingMessages,
  buildOnboardingSystemPrompt,
  buildOnboardingUserMessage,
} from '../src/modules/onboarding/prompt.js';

function fakeIndexState(): IndexState {
  return {
    repoId: 'repo-1',
    status: 'full',
    filesIndexed: 10,
    filesSkipped: 0,
    durationMs: 5,
    lastIndexedSha: 'sha-1',
    indexerVersion: 2,
    updatedAt: new Date(),
  };
}

function baseFacts(overrides: Partial<CollectedFacts> = {}): CollectedFacts {
  return {
    indexState: fakeIndexState(),
    repoMapText: 'CANARY_REPO_MAP src/server.ts: fn boot()',
    repoMapDegraded: false,
    rankedFiles: ['src/server.ts', 'src/db.ts'],
    rankedExcerpts: [
      { path: 'src/server.ts', content: 'CANARY_EXCERPT_SERVER export function boot() {}' },
      { path: 'src/db.ts', content: 'CANARY_EXCERPT_DB export function connect() {}' },
    ],
    droppedForBudget: [],
    flatRank: false,
    fileRankByPath: new Map(),
    criticalPathChains: [['src/server.ts', 'src/db.ts']],
    runLocallySources: [{ path: 'package.json', content: 'CANARY_PKG {"scripts":{"dev":"vite"}}' }],
    noClone: false,
    ...overrides,
  };
}

describe('buildOnboardingUserMessage — AC-32 wrapUntrusted on every repo-derived block', () => {
  it('wraps the repo map, ranked-file list, each excerpt, critical paths, and each run-locally source in <untrusted> delimiters', () => {
    const facts = baseFacts();
    const message = buildOnboardingUserMessage(facts, 'acme/widgets');

    expect(message).toContain('<untrusted source="repo-map">\nCANARY_REPO_MAP src/server.ts: fn boot()\n</untrusted>');
    expect(message).toContain('<untrusted source="ranked-files">');
    expect(message).toContain(
      '<untrusted source="excerpt:src/server.ts">\nCANARY_EXCERPT_SERVER export function boot() {}\n</untrusted>',
    );
    expect(message).toContain(
      '<untrusted source="excerpt:src/db.ts">\nCANARY_EXCERPT_DB export function connect() {}\n</untrusted>',
    );
    expect(message).toContain('<untrusted source="critical-paths">');
    expect(message).toContain(
      '<untrusted source="run-locally:package.json">\nCANARY_PKG {"scripts":{"dev":"vite"}}\n</untrusted>',
    );
  });

  it('no repo-derived canary text appears OUTSIDE an <untrusted> block (never concatenated raw)', () => {
    const facts = baseFacts();
    const message = buildOnboardingUserMessage(facts, 'acme/widgets');
    for (const canary of ['CANARY_REPO_MAP', 'CANARY_EXCERPT_SERVER', 'CANARY_EXCERPT_DB', 'CANARY_PKG']) {
      const idx = message.indexOf(canary);
      expect(idx).toBeGreaterThan(-1);
      const before = message.slice(0, idx);
      const lastOpen = before.lastIndexOf('<untrusted source=');
      const lastClose = before.lastIndexOf('</untrusted>');
      // The nearest preceding delimiter must be an OPEN, not a CLOSE — i.e.
      // the canary sits inside an open-but-not-yet-closed block.
      expect(lastOpen).toBeGreaterThan(lastClose);
    }
  });

  it('E-4 flat-rank note appears in the ranked-file block when facts.flatRank is true', () => {
    const message = buildOnboardingUserMessage(baseFacts({ flatRank: true }), 'acme/widgets');
    expect(message).toContain('NOTE: this repo has no usable import-graph signal');
  });

  it('an empty facts object produces a message with no fact blocks (nothing to wrap)', () => {
    const empty = baseFacts({
      repoMapText: '',
      rankedFiles: [],
      rankedExcerpts: [],
      criticalPathChains: [],
      runLocallySources: [],
    });
    const message = buildOnboardingUserMessage(empty, 'acme/widgets');
    expect(message).not.toContain('<untrusted');
  });
});

describe('buildOnboardingSystemPrompt — AC-32/D-6/E-8 system message', () => {
  it('contains no repo-derived substring — only the fixed section list + language', async () => {
    const system = await buildOnboardingSystemPrompt();
    for (const canary of ['CANARY_REPO_MAP', 'CANARY_EXCERPT_SERVER', 'acme/widgets']) {
      expect(system).not.toContain(canary);
    }
  });

  it('substitutes {{sections}} and {{language}} — no literal placeholder survives, and English is present (D-11/E-18)', async () => {
    const system = await buildOnboardingSystemPrompt();
    expect(system).not.toContain('{{sections}}');
    expect(system).not.toContain('{{language}}');
    expect(system).toContain('English');
    for (const kind of ['architecture', 'critical_paths', 'run_locally', 'reading_path', 'first_tasks']) {
      expect(system).toContain(kind);
    }
  });

  it('D-6/E-8: no longer names the stale `routes_and_apis` section', async () => {
    const system = await buildOnboardingSystemPrompt();
    expect(system).not.toContain('routes_and_apis');
  });
});

describe('buildOnboardingMessages', () => {
  it('assembles exactly a system + user message, in that order, with the user message carrying the wrapped facts', async () => {
    const messages = await buildOnboardingMessages(baseFacts(), 'acme/widgets');
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe('system');
    expect(messages[1]!.role).toBe('user');
    expect(messages[1]!.content).toContain('<untrusted source="repo-map">');
    // Repo-derived content never leaks into the system message.
    expect(messages[0]!.content).not.toContain('CANARY_REPO_MAP');
  });
});
