import { parseUnifiedDiff, reviewPullRequest } from '@devdigest/reviewer-core';
import type { EvalExpectation } from '@devdigest/shared';
import type { LLMProvider, ReviewStrategy } from '@devdigest/shared';
import { withTimeout } from '../../platform/resilience.js';
import { EVAL_CASE_TIMEOUT_MS } from './constants.js';
import { scoreCase, type FindingLocation } from './scorer.js';

/**
 * WI7 — the version-pinned batch runner's per-case execution. Pure
 * orchestration: no DB, no `Container` — every dependency (the resolved
 * `LLMProvider`, the pinned prompt/model/strategy/skills) is passed in
 * already-resolved by `service.ts`, which owns all the I/O (persistence,
 * cross-module reads via `AgentsService`). `service.ts` is the only caller.
 */

/** The agent config PINNED at batch open (AC-15/AC-16) — never re-read
 *  mid-batch, so a concurrent config edit can't leak into a running batch. */
export interface RunnerAgentSnapshot {
  systemPrompt: string;
  model: string;
  strategy: ReviewStrategy;
  /** Resolved bodies of the agent's ENABLED linked skills, ordered — never
   *  slugs (mirrors `modules/reviews/run-executor.ts`'s own
   *  `### name\nbody` rendering, reused for the same prompt shape). */
  skills: string[];
  llm: LLMProvider;
}

/** The subset of a persisted `eval_cases` row `runOneCase` needs. */
export interface RunnerCase {
  id: string;
  inputDiff: string;
  inputMeta: { title: string; body: string } | null;
  /** `null` when the case's `expected_output` failed to re-parse
   *  (`expectation_status: 'unusable'`, AC-13/E-12) — the case still RUNS
   *  (so `actual_output` is recorded), it just contributes no metrics. */
  expectation: EvalExpectation | null;
}

export interface CaseRunResult {
  caseId: string;
  /** `false` when the case FAILED TO EXECUTE (provider error, unparseable
   *  diff, schema-invalid response, or a `withTimeout` expiry, AC-20) —
   *  distinct from a real `pass: false` score. */
  ok: boolean;
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
  findingsTotal: number | null;
  actualOutput: unknown;
  durationMs: number;
  costUsd: number | null;
  tokensIn: number;
  tokensOut: number;
  error: string | null;
}

/**
 * Execute ONE eval case against a pinned agent snapshot (AC-18, D-2). The
 * `ReviewInput` assembled here deliberately carries NONE of `callers`,
 * `repoMap`, `specs`, `intent` — an eval run must never lean on repo-intel /
 * project-context enrichment the case didn't itself pin at creation time;
 * only `systemPrompt`, `model`, `diff`, `llm`, `strategy`, `skills` and
 * (when present) `prDescription` are set. Never throws: a provider error,
 * unparseable diff, schema-invalid response, or timeout is caught here and
 * returned as a failed outcome, so the caller's per-case isolation loop
 * (AC-20) needs no try/catch of its own.
 */
export async function runOneCase(
  agent: RunnerAgentSnapshot,
  evalCase: RunnerCase,
): Promise<CaseRunResult> {
  const start = Date.now();
  try {
    const diff = parseUnifiedDiff(evalCase.inputDiff);
    const outcome = await withTimeout(
      reviewPullRequest({
        systemPrompt: agent.systemPrompt,
        model: agent.model,
        diff,
        llm: agent.llm,
        strategy: agent.strategy,
        ...(agent.skills.length > 0 ? { skills: agent.skills } : {}),
        ...(evalCase.inputMeta?.body ? { prDescription: evalCase.inputMeta.body } : {}),
      }),
      EVAL_CASE_TIMEOUT_MS,
    );
    const durationMs = Date.now() - start;

    const grounded: FindingLocation[] = outcome.review.findings.map((f) => ({
      file: f.file,
      start_line: f.start_line,
      end_line: f.end_line,
    }));

    // No usable expectation (AC-13/E-12) — the run still happened and
    // `actual_output` is worth recording, but there is nothing to score
    // against, so every metric stays null (never a fabricated pass/fail).
    if (!evalCase.expectation) {
      return {
        caseId: evalCase.id,
        ok: true,
        pass: null,
        recall: null,
        precision: null,
        citation_accuracy: null,
        findingsTotal: grounded.length,
        actualOutput: outcome.review,
        durationMs,
        costUsd: outcome.costUsd,
        tokensIn: outcome.tokensIn,
        tokensOut: outcome.tokensOut,
        error: null,
      };
    }

    const scored = scoreCase({
      expectation: evalCase.expectation,
      grounded,
      droppedCount: outcome.dropped.length,
    });

    return {
      caseId: evalCase.id,
      ok: true,
      pass: scored.pass,
      recall: scored.recall,
      precision: scored.precision,
      citation_accuracy: scored.citation_accuracy,
      findingsTotal: scored.findings_total,
      actualOutput: outcome.review,
      durationMs,
      costUsd: outcome.costUsd,
      tokensIn: outcome.tokensIn,
      tokensOut: outcome.tokensOut,
      error: null,
    };
  } catch (err) {
    // AC-20 — per-case isolation: a provider error, an unparseable diff, a
    // schema-invalid response (thrown from inside `reviewPullRequest`'s
    // `completeStructured`), or a `withTimeout` expiry (`TimeoutError`) all
    // land here as ONE failed case — never a failed batch by themselves.
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    return {
      caseId: evalCase.id,
      ok: false,
      pass: null,
      recall: null,
      precision: null,
      citation_accuracy: null,
      findingsTotal: null,
      actualOutput: null,
      durationMs,
      costUsd: null,
      tokensIn: 0,
      tokensOut: 0,
      error: message,
    };
  }
}

/**
 * Run every case SERIALLY against the same pinned snapshot (Q-4) — never
 * `Promise.all`: a batch is provider-bound, and running cases in parallel
 * would multiply the spend RATE against the same 10/min rate limit AC-45
 * sets on the route that triggers this.
 */
export async function runBatch(
  agent: RunnerAgentSnapshot,
  cases: RunnerCase[],
): Promise<CaseRunResult[]> {
  const results: CaseRunResult[] = [];
  for (const evalCase of cases) {
    results.push(await runOneCase(agent, evalCase));
  }
  return results;
}
