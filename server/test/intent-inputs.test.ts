/**
 * Intent Layer — pure builders in `intent-inputs.ts`
 * (docs/plans/intent-layer.md work item 3 / Test plan).
 *
 * No I/O, no Container. Pins: synthesized hunk headers never include body
 * text; reference extraction splits paths / URLs / issues; traversal guard
 * rejects `../`; confidence capping on unresolved sources.
 */
import { describe, it, expect } from 'vitest';
import { join, resolve, sep } from 'node:path';
import {
  synthesizeHunkHeaders,
  extractReferences,
  isInsideClone,
  capConfidence,
  renderIntentBlock,
  CONFIDENCE_CAP_ON_UNRESOLVED,
  type IntentDiffFileSummary,
} from '../src/modules/reviews/intent-inputs.js';
import type { Intent, IntentSource } from '@devdigest/shared';

describe('synthesizeHunkHeaders', () => {
  it('emits path (±counts) and @@ headers only — never hunk body text', () => {
    const files: IntentDiffFileSummary[] = [
      {
        path: 'src/config.ts',
        additions: 1,
        deletions: 0,
        hunks: [{ oldStart: 10, oldLines: 3, newStart: 10, newLines: 4 }],
      },
    ];
    const out = synthesizeHunkHeaders(files);

    expect(out).toContain('src/config.ts (+1/-0)');
    expect(out).toContain('@@ -10,3 +10,4 @@');
    // Signature-level guarantee: input type has no body; still assert the
    // classic leak strings that would appear if a caller smuggled a patch.
    expect(out).not.toContain('stripeKey');
    expect(out).not.toMatch(/^diff --git/m);
    expect(out).not.toContain('--- a/');
    expect(out).not.toContain('+++ b/');
    expect(out).not.toMatch(/^\+[^+]/m); // no unified-diff added-line body
  });

  it('joins multiple files with a blank line and caps hunks per file', () => {
    const hunks = Array.from({ length: 25 }, (_, i) => ({
      oldStart: i + 1,
      oldLines: 1,
      newStart: i + 1,
      newLines: 1,
    }));
    const out = synthesizeHunkHeaders([
      { path: 'a.ts', additions: 1, deletions: 0, hunks },
      { path: 'b.ts', additions: 0, deletions: 1, hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 0 }] },
    ]);
    expect(out).toContain('a.ts (+1/-0)');
    expect(out).toContain('b.ts (+0/-1)');
    // Cap is 20 hunks/file — header for hunk 21 must not appear.
    expect(out).not.toContain('@@ -21,1 +21,1 @@');
    expect(out).toContain('@@ -20,1 +20,1 @@');
  });
});

describe('extractReferences', () => {
  it('splits local .md paths, external URLs, and issue numbers', () => {
    // Keep URLs off trailing sentence punctuation — the extractor's regex is
    // deliberately greedy to the next whitespace/`)`; punctuation stripping
    // is not part of the plan's contract.
    const body = [
      'Fixes #471 and closes #482',
      'See [the plan](docs/plans/intent-layer.md) and specs/foo.md',
      'Also https://jira.example/ABC-1 and https://notion.so/page',
      'Foreign md URL: [x](https://github.com/other/repo/blob/main/SPEC.md)',
    ].join('\n');

    const refs = extractReferences(body);

    expect(refs.issueNumbers).toEqual(expect.arrayContaining([471, 482]));
    expect(refs.localPaths).toEqual(
      expect.arrayContaining(['docs/plans/intent-layer.md', 'specs/foo.md']),
    );
    expect(refs.localPaths).not.toContain('https://github.com/other/repo/blob/main/SPEC.md');
    expect(refs.externalUrls).toEqual(
      expect.arrayContaining([
        'https://jira.example/ABC-1',
        'https://notion.so/page',
        'https://github.com/other/repo/blob/main/SPEC.md',
      ]),
    );
  });

  it('returns empty buckets for a body with no references', () => {
    expect(extractReferences('Just a plain description.')).toEqual({
      issueNumbers: [],
      localPaths: [],
      externalUrls: [],
    });
  });
});

describe('isInsideClone', () => {
  const clonePath = join('/tmp', 'clones', 'acme-payments');

  it('accepts a path that stays inside the clone', () => {
    const safe = isInsideClone(clonePath, 'specs/intent-layer.md');
    expect(safe).not.toBeNull();
    // Guard compares resolve()'d paths (Windows-safe); bare join() is not.
    expect(safe!.startsWith(resolve(clonePath) + sep)).toBe(true);
    expect(safe!.endsWith(join('specs', 'intent-layer.md'))).toBe(true);
  });

  it('rejects path traversal with ../', () => {
    expect(isInsideClone(clonePath, '../../etc/passwd')).toBeNull();
    expect(isInsideClone(clonePath, 'specs/../../etc/passwd')).toBeNull();
  });
});

describe('capConfidence', () => {
  const resolved: IntentSource[] = [
    { kind: 'pr_title', ref: null, resolved: true },
    { kind: 'changed_files', ref: null, resolved: true },
  ];
  const withUnresolved: IntentSource[] = [
    ...resolved,
    { kind: 'external_link', ref: 'https://jira.example/ABC-1', resolved: false },
  ];

  it('passes the model confidence through when every source is resolved', () => {
    expect(capConfidence(0.87, resolved)).toBe(0.87);
  });

  it('caps to CONFIDENCE_CAP_ON_UNRESOLVED when any source is unresolved', () => {
    expect(CONFIDENCE_CAP_ON_UNRESOLVED).toBe(0.5);
    expect(capConfidence(0.9, withUnresolved)).toBe(0.5);
    expect(capConfidence(0.3, withUnresolved)).toBe(0.3);
  });

  it('returns null when the model omitted confidence', () => {
    expect(capConfidence(null, withUnresolved)).toBeNull();
    expect(capConfidence(undefined, resolved)).toBeNull();
  });
});

describe('renderIntentBlock', () => {
  // WI10 DoD (docs/plans/intent-layer.md): risk_areas must be folded into
  // the plain-text block handed to reviewer-core as PromptParts.intent, so
  // the reviewer prompt actually sees them.
  const full: Intent = {
    intent: 'Add rate limiting to protect the API from abuse.',
    in_scope: ['rate limiting middleware'],
    out_of_scope: ['auth rewrite'],
    confidence: 0.8,
    sources: [],
    missing_context: ['https://jira.example/ABC-1 could not be retrieved'],
    risk_areas: ['New dependency: ioredis', 'Auth surface touched'],
  };

  it('includes a "Risk areas:" section with each bullet when risk_areas is non-empty', () => {
    const out = renderIntentBlock(full);

    expect(out).toContain('Risk areas:');
    expect(out).toContain('- New dependency: ioredis');
    expect(out).toContain('- Auth surface touched');
    // Sanity on the surrounding sections so risk_areas is proven to sit
    // between scope and confidence, not lost/duplicated.
    expect(out).toContain(full.intent);
    expect(out).toContain('In scope:');
    expect(out).toContain('- rate limiting middleware');
    expect(out).toContain('Out of scope:');
    expect(out).toContain('- auth rewrite');
    expect(out).toContain('Confidence: 0.80');
    expect(out).toContain('Missing context (could not be retrieved):');

    const riskIdx = out.indexOf('Risk areas:');
    const scopeIdx = out.indexOf('Out of scope:');
    const confidenceIdx = out.indexOf('Confidence:');
    expect(scopeIdx).toBeGreaterThan(-1);
    expect(riskIdx).toBeGreaterThan(scopeIdx);
    expect(confidenceIdx).toBeGreaterThan(riskIdx);
  });

  it('omits the "Risk areas:" section entirely when risk_areas is empty', () => {
    const noRisks: Intent = { ...full, risk_areas: [] };
    const out = renderIntentBlock(noRisks);

    expect(out).not.toContain('Risk areas:');
    expect(out).toContain(full.intent);
  });

  it('a minimal intent (no scope/risks/confidence/missing_context) renders just the objective', () => {
    const minimal: Intent = {
      intent: 'Fix a typo in the README.',
      in_scope: [],
      out_of_scope: [],
      confidence: null,
      sources: [],
      missing_context: [],
      risk_areas: [],
    };
    expect(renderIntentBlock(minimal)).toBe('Fix a typo in the README.');
  });
});
