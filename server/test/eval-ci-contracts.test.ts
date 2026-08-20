import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  EvalExpectation,
  EvalExpectationEntry,
  EvalCaseInput,
  EvalCaseRecord,
  EvalBatchRecord,
  EvalComparison,
  EvalDashboard,
  EvalTrendPoint,
  EvalCaseFromFindingInput,
} from '@devdigest/shared';

/**
 * Phase A (WI1) contract tests — docs/plans/eval-pipeline.md "Phase A —
 * contracts + schema", oracle drawn from specs/eval-pipeline.md AC-11,
 * AC-12, AC-13, AC-24, AC-25, AC-27 and E-11/E-17 (see each test's comment
 * for the exact citation). This phase shipped contracts only — no routes,
 * service, repository or scorer exist yet — so these are schema-validation
 * unit tests, not integration tests.
 */

describe('EvalExpectation / EvalExpectationEntry — AC-11, AC-12, AC-13, Q-6', () => {
  it('parses a valid payload with an explicit match_scope: "file" entry', () => {
    // AC-11: version discriminator + must_find[] + must_not_flag[]; Q-6:
    // match_scope carries 'file' for the four full-file-kinds (secret_leak,
    // lethal_trifecta, phantom, hook).
    const parsed = EvalExpectation.parse({
      version: 1,
      must_find: [
        {
          file: 'src/config.ts',
          start_line: 12,
          end_line: 12,
          match_scope: 'file',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key',
          source_finding_id: 'f1',
        },
      ],
      must_not_flag: [],
    });
    expect(parsed.must_find).toHaveLength(1);
    expect(parsed.must_find[0]!.match_scope).toBe('file');
  });

  it('defaults match_scope to "range" when the field is omitted', () => {
    // AC-11 + Q-6 default: a hand-authored case (no derivation) gets 'range'.
    const parsed = EvalExpectation.parse({
      version: 1,
      must_find: [{ file: 'src/api.ts', start_line: 10, end_line: 20 }],
      must_not_flag: [],
    });
    expect(parsed.must_find[0]!.match_scope).toBe('range');
  });

  it('defaults must_find/must_not_flag to [] when omitted', () => {
    // AC-11 — both arrays default to [].
    const parsed = EvalExpectation.parse({ version: 1 });
    expect(parsed.must_find).toEqual([]);
    expect(parsed.must_not_flag).toEqual([]);
  });

  it('rejects a wrong version discriminator', () => {
    // AC-13: "a row written by an earlier shape degrades... instead of
    // crashing" — at the schema layer this means safeParse fails so the
    // service layer can catch it and mark expectation_status: 'unusable'.
    const result = EvalExpectation.safeParse({
      version: 2,
      must_find: [],
      must_not_flag: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an entry with start_line as a string', () => {
    // AC-13/E-12 degradation contract at the schema layer.
    const result = EvalExpectation.safeParse({
      version: 1,
      must_find: [{ file: 'a.ts', start_line: '12', end_line: 12 }],
      must_not_flag: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an entry missing the required file field', () => {
    const result = EvalExpectation.safeParse({
      version: 1,
      must_find: [{ start_line: 1, end_line: 2 }],
      must_not_flag: [],
    });
    expect(result.success).toBe(false);
  });

  it('accepts severity/category/title differing but still parses (advisory-only fields, AC-12)', () => {
    // AC-12: only file + line range + match_scope participate in matching;
    // severity/category/title are advisory. This is a schema-layer check
    // that those fields are optional/nullish, not required for a valid
    // entry — the actual "never affects a metric" behavior is scorer.ts's
    // concern (WI6, not yet shipped).
    const a = EvalExpectationEntry.parse({ file: 'a.ts', start_line: 1, end_line: 2 });
    const b = EvalExpectationEntry.parse({
      file: 'a.ts',
      start_line: 1,
      end_line: 2,
      severity: 'LOW',
      category: 'style',
      title: 'nit',
    });
    expect(a.file).toBe(b.file);
    expect(a.start_line).toBe(b.start_line);
    expect(a.end_line).toBe(b.end_line);
  });
});

describe('EvalCaseInput.expected_output — replaces z.unknown() (AC-11)', () => {
  it('rejects an arbitrary object that is not a valid EvalExpectation', () => {
    // Proves z.unknown() was actually replaced, not just renamed: a bare
    // object that would have passed z.unknown() must now fail.
    const result = EvalCaseInput.safeParse({
      owner_kind: 'agent',
      owner_id: 'agent-1',
      name: 'case 1',
      input_diff: 'diff --git a/x b/x',
      expected_output: { arbitrary: 'shape', foo: 'bar' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a well-formed EvalExpectation as expected_output', () => {
    const result = EvalCaseInput.safeParse({
      owner_kind: 'agent',
      owner_id: 'agent-1',
      name: 'case 1',
      input_diff: 'diff --git a/x b/x',
      expected_output: { version: 1, must_find: [], must_not_flag: [] },
    });
    expect(result.success).toBe(true);
  });
});

describe('EvalCaseRecord — read-shape degradation contract (AC-13)', () => {
  it('accepts expected_output: null with expectation_status: "unusable"', () => {
    const parsed = EvalCaseRecord.parse({
      id: 'c1',
      owner_kind: 'agent',
      owner_id: 'agent-1',
      name: 'case 1',
      input_diff: '',
      expected_output: null,
      expectation_status: 'unusable',
    });
    expect(parsed.expected_output).toBeNull();
    expect(parsed.expectation_status).toBe('unusable');
  });

  it('rejects an expectation_status outside the ok/unusable enum', () => {
    const result = EvalCaseRecord.safeParse({
      id: 'c1',
      owner_kind: 'agent',
      owner_id: 'agent-1',
      name: 'case 1',
      input_diff: '',
      expected_output: null,
      expectation_status: 'broken',
    });
    expect(result.success).toBe(false);
  });
});

describe('EvalBatchRecord — nullable metrics (E-11, AC-24/25/27 representability)', () => {
  const base = {
    id: 'b1',
    owner_kind: 'agent' as const,
    owner_id: 'agent-1',
    agent_version: 7,
    provider: 'openrouter',
    model: 'gpt-4.1',
    ran_at: new Date().toISOString(),
    status: 'completed' as const,
    cases_total: 8,
    cases_passed: 5,
    cases_failed: 3,
    recall_cases: 8,
    precision_cases: 8,
    citation_cases: 8,
  };

  it('accepts null for recall/precision/citation_accuracy (an undefined metric is null, never 1.0)', () => {
    const parsed = EvalBatchRecord.parse({
      ...base,
      recall: null,
      precision: null,
      citation_accuracy: null,
      findings_total: null,
      duration_ms: null,
      cost_usd: null,
    });
    expect(parsed.recall).toBeNull();
    expect(parsed.precision).toBeNull();
    expect(parsed.citation_accuracy).toBeNull();
    expect(parsed.cost_usd).toBeNull();
  });

  it('still accepts real numeric values for those same fields (not forced always-null)', () => {
    const parsed = EvalBatchRecord.parse({
      ...base,
      recall: 0.82,
      precision: 0.91,
      citation_accuracy: 0.95,
      findings_total: 12,
      duration_ms: 4200,
      cost_usd: 0.23,
    });
    expect(parsed.recall).toBe(0.82);
    expect(parsed.precision).toBe(0.91);
    expect(parsed.citation_accuracy).toBe(0.95);
    expect(parsed.cost_usd).toBe(0.23);
  });

  it('defaults skills_fingerprint to [] and accepts a populated fingerprint (Q-3)', () => {
    const nullMetrics = {
      recall: null,
      precision: null,
      citation_accuracy: null,
      findings_total: null,
      duration_ms: null,
      cost_usd: null,
    };
    const empty = EvalBatchRecord.parse({ ...base, ...nullMetrics });
    expect(empty.skills_fingerprint).toEqual([]);

    const populated = EvalBatchRecord.parse({
      ...base,
      ...nullMetrics,
      skills_fingerprint: [{ skill_id: 's1', version: 3 }],
    });
    expect(populated.skills_fingerprint).toEqual([{ skill_id: 's1', version: 3 }]);
  });

  it('accepts an explicit skills_fingerprint: null (a genuinely NULL DB column) and normalizes it to [] (Q-3 regression)', () => {
    // Previously `.default([])` only fired on an omitted key, not on an
    // explicit `null` — a NULL DB column read back as `null` and failed
    // parsing. Now `.nullish().transform((v) => v ?? [])` must accept the
    // explicit-null case too and normalize it to the same [] end state as
    // the omitted-key case above.
    const nullMetrics = {
      recall: null,
      precision: null,
      citation_accuracy: null,
      findings_total: null,
      duration_ms: null,
      cost_usd: null,
    };
    const result = EvalBatchRecord.safeParse({
      ...base,
      ...nullMetrics,
      skills_fingerprint: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skills_fingerprint).toEqual([]);
    }
  });

  it('rejects a status outside completed/failed', () => {
    const result = EvalBatchRecord.safeParse({
      ...base,
      status: 'running',
      recall: null,
      precision: null,
      citation_accuracy: null,
    });
    expect(result.success).toBe(false);
  });
});

describe('EvalComparison — snapshot prompts null independent of batch presence (AC-32)', () => {
  const batch = {
    id: 'b1',
    owner_kind: 'agent' as const,
    owner_id: 'agent-1',
    agent_version: 6,
    provider: 'openrouter',
    model: 'gpt-4.1',
    ran_at: new Date().toISOString(),
    status: 'completed' as const,
    cases_total: 8,
    cases_passed: 6,
    cases_failed: 2,
    recall: 0.7,
    precision: 0.8,
    citation_accuracy: 0.9,
    recall_cases: 8,
    precision_cases: 8,
    citation_cases: 8,
    findings_total: 10,
    duration_ms: 5000,
    cost_usd: 0.4,
  };

  it('accepts base_prompt/head_prompt: null even when both batches are present (missing snapshot renders null, not the current prompt)', () => {
    const parsed = EvalComparison.parse({
      base: batch,
      head: { ...batch, id: 'b2', agent_version: 7 },
      delta: { recall: 0.1, precision: -0.05, citation_accuracy: 0.02, cost_usd: 0.01 },
      base_prompt: null,
      head_prompt: null,
    });
    expect(parsed.base_prompt).toBeNull();
    expect(parsed.head_prompt).toBeNull();
  });

  it('accepts a real string prompt for one side and null for the other (partial snapshot loss)', () => {
    const parsed = EvalComparison.parse({
      base: batch,
      head: { ...batch, id: 'b2', agent_version: 7 },
      delta: { recall: null, precision: null, citation_accuracy: null, cost_usd: null },
      base_prompt: 'You are a careful reviewer...',
      head_prompt: null,
    });
    expect(parsed.base_prompt).toBe('You are a careful reviewer...');
    expect(parsed.head_prompt).toBeNull();
  });

  it('accepts a fully-null delta block (all four fields independently nullable)', () => {
    const parsed = EvalComparison.parse({
      base: batch,
      head: batch,
      delta: { recall: null, precision: null, citation_accuracy: null, cost_usd: null },
      base_prompt: 'p1',
      head_prompt: 'p2',
    });
    expect(parsed.delta).toEqual({ recall: null, precision: null, citation_accuracy: null, cost_usd: null });
  });
});

describe('EvalDashboard — nullable current metrics + nullable delta block (E-11, E-17)', () => {
  const base = {
    owner_kind: 'agent' as const,
    owner_id: 'agent-1',
    cases_total: 8,
    trend: [],
    recent_runs: [],
    alert: null,
  };

  it('accepts current.recall/.precision/.citation_accuracy: null (E-11 — undefined metric is null, never a flattering 1.0)', () => {
    const parsed = EvalDashboard.parse({
      ...base,
      current: {
        recall: null,
        precision: null,
        citation_accuracy: null,
        traces_passed: 0,
        traces_total: 8,
        cost_usd: null,
      },
      delta: null,
    });
    expect(parsed.current.recall).toBeNull();
    expect(parsed.current.precision).toBeNull();
    expect(parsed.current.citation_accuracy).toBeNull();
  });

  it('still accepts real numeric values for current metrics (not forced always-null)', () => {
    const parsed = EvalDashboard.parse({
      ...base,
      current: {
        recall: 0.75,
        precision: 0.6,
        citation_accuracy: 0.88,
        traces_passed: 6,
        traces_total: 8,
        cost_usd: 1.2,
      },
      delta: null,
    });
    expect(parsed.current.recall).toBe(0.75);
    expect(parsed.current.precision).toBe(0.6);
    expect(parsed.current.citation_accuracy).toBe(0.88);
  });

  it('accepts delta: null as a whole block (E-17 — a first batch has no delta, not a delta of zero)', () => {
    const parsed = EvalDashboard.parse({
      ...base,
      current: {
        recall: null,
        precision: null,
        citation_accuracy: null,
        traces_passed: 0,
        traces_total: 0,
        cost_usd: null,
      },
      delta: null,
    });
    expect(parsed.delta).toBeNull();
  });

  it('still accepts a populated delta block when the agent has ≥2 batches', () => {
    const parsed = EvalDashboard.parse({
      ...base,
      current: {
        recall: 0.8,
        precision: 0.7,
        citation_accuracy: 0.9,
        traces_passed: 7,
        traces_total: 8,
        cost_usd: 0.5,
      },
      delta: { recall: 0.1, precision: -0.02, citation_accuracy: 0.0 },
    });
    expect(parsed.delta).toEqual({ recall: 0.1, precision: -0.02, citation_accuracy: 0.0 });
  });

  it('rejects recent_runs items shaped as the old EvalRunRecord (per-case) instead of EvalBatchRecord', () => {
    // D-3 / plan Recommendation 1: EvalDashboard.recent_runs must now be
    // EvalBatchRecord[], not EvalRunRecord[] — a per-case run row (case_id,
    // no cases_total/agent_version) must fail to parse as a recent_runs entry.
    const result = EvalDashboard.safeParse({
      ...base,
      current: {
        recall: null,
        precision: null,
        citation_accuracy: null,
        traces_passed: 0,
        traces_total: 0,
        cost_usd: null,
      },
      delta: null,
      recent_runs: [
        {
          id: 'r1',
          case_id: 'c1',
          ran_at: new Date().toISOString(),
          actual_output: {},
          pass: true,
          recall: 1,
          precision: 1,
          citation_accuracy: 1,
          findings_total: 1,
          duration_ms: 100,
          cost_usd: 0.01,
          batch_id: null,
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('EvalTrendPoint — nullable metrics + batch_id/agent_version (D-3 reinterpretation)', () => {
  it('accepts null metrics alongside a required batch_id and agent_version', () => {
    const parsed = EvalTrendPoint.parse({
      batch_id: 'b1',
      agent_version: 5,
      ran_at: new Date().toISOString(),
      recall: null,
      precision: null,
      citation_accuracy: null,
      pass_rate: 0,
      cost_usd: null,
    });
    expect(parsed.recall).toBeNull();
    expect(parsed.batch_id).toBe('b1');
    expect(parsed.agent_version).toBe(5);
  });

  it('still accepts real numeric metric values', () => {
    const parsed = EvalTrendPoint.parse({
      batch_id: 'b1',
      agent_version: 5,
      ran_at: new Date().toISOString(),
      recall: 0.9,
      precision: 0.85,
      citation_accuracy: 0.95,
      pass_rate: 0.75,
      cost_usd: 0.3,
    });
    expect(parsed.recall).toBe(0.9);
    expect(parsed.citation_accuracy).toBe(0.95);
  });

  it('rejects a point missing batch_id (the field that makes trend one-point-per-batch, not per-run)', () => {
    const result = EvalTrendPoint.safeParse({
      agent_version: 5,
      ran_at: new Date().toISOString(),
      recall: null,
      precision: null,
      citation_accuracy: null,
      pass_rate: 0,
      cost_usd: null,
    });
    expect(result.success).toBe(false);
  });
});

describe('EvalCaseFromFindingInput — server-derives everything else (AC-3, D-7)', () => {
  it('accepts a body with an optional name only', () => {
    expect(() => EvalCaseFromFindingInput.parse({})).not.toThrow();
    expect(() => EvalCaseFromFindingInput.parse({ name: 'my case' })).not.toThrow();
    expect(() => EvalCaseFromFindingInput.parse({ name: null })).not.toThrow();
  });

  it('rejects a body-supplied expectation kind (unit test asserting a body-supplied kind is impossible by construction)', () => {
    // AC-3: "a body-supplied kind is ignored" — at the schema layer this
    // means the input schema simply has no such field, so passing one is
    // silently stripped by zod's default (non-strict) object parsing. We
    // assert the parsed value carries no trace of the extra field, which is
    // what "impossible by construction" means for a schema with no `kind`.
    const parsed = EvalCaseFromFindingInput.parse({ name: 'x', kind: 'must_find' });
    expect(parsed).not.toHaveProperty('kind');
    expect(Object.keys(parsed)).toEqual(['name']);
  });
});

describe('Vendored contract mirror — byte identity (AC-11)', () => {
  it('server and client copies of eval-ci.ts are byte-identical', () => {
    // WI1's own Definition of done names `git diff --no-index
    // server/src/vendor/shared/contracts/eval-ci.ts
    // client/src/vendor/shared/contracts/eval-ci.ts` as the exact check
    // (root AGENTS.md — hand-mirrored, no sync script). Mirrored here as a
    // vitest assertion so it runs inside the normal unit-test lane too;
    // the shell form is also wired into WI14's verify-l06.sh (Phase E,
    // out of this phase's scope) and the plan's Test plan section.
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const serverPath = join(dir, '..', 'src', 'vendor', 'shared', 'contracts', 'eval-ci.ts');
    const clientPath = join(dir, '..', '..', 'client', 'src', 'vendor', 'shared', 'contracts', 'eval-ci.ts');
    const serverContents = readFileSync(serverPath, 'utf8');
    const clientContents = readFileSync(clientPath, 'utf8');
    expect(clientContents).toBe(serverContents);
  });
});
