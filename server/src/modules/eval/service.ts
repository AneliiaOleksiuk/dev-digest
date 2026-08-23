import { z } from 'zod';
import { EvalCaseInputMeta, EvalExpectation } from '@devdigest/shared';
import type {
  Agent,
  EvalBatchRecord,
  EvalCaseInput,
  EvalCaseRecord,
  EvalComparison,
  EvalDashboard,
  EvalRunRecord,
  EvalTrendPoint,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, ConflictError, NotFoundError } from '../../platform/errors.js';
import { AgentsService } from '../agents/service.js';
import { runBatch, type RunnerAgentSnapshot, type RunnerCase } from './runner.js';
import { aggregateBatch } from './scorer.js';
import { MAX_CASES_PER_BATCH } from './constants.js';
import {
  assertDiffWithinCap,
  buildDiffText,
  buildExpectationEntry,
  deriveExpectationKind,
  mapBatchRowToRecord,
  mapRowToRecord,
  mapRunRowToRecord,
} from './helpers.js';
import type { EvalCaseOwnerKind, EvalCaseRow, EvalCaseUpdate, EvalRepository } from './repository.js';

/** Structural log sink — `req.log` (pino) satisfies this as-is, same shape
 *  `IntentLogSink`/`BriefLogSink` already use elsewhere. Never logs
 *  `input_diff` contents, the assembled prompt, or the raw model response
 *  (AC-48, A09 — `modules/reviews/intent-service.ts:36-39`'s stated rule). */
export interface EvalLogSink {
  info(obj: Record<string, unknown>, msg?: string): void;
}

/** Partial update payload for `PATCH /eval-cases/:id` — every field of
 *  `EvalCaseInput` optional. */
export type EvalCaseInputPatch = Partial<EvalCaseInput>;

/**
 * Eval module application service. Depends on the repository PORT (never a
 * concrete Drizzle class) plus `Container`, used only to construct sibling
 * modules' `Service` classes for cross-module reads (`AgentsService`) —
 * exactly the pattern `modules/brief/sources.node.ts` uses to construct
 * `BlastService`, and `modules/blast/service.ts` itself uses `Container` the
 * same way for its own facade calls. Never imports `AgentsRepository`
 * directly (onion-architecture "Cross-module reads" rule).
 */
export class EvalService {
  /** E-14 — one in-flight batch per `workspaceId:agentId`. In-process only,
   *  no multi-replica safety (`server/AGENTS.md`'s already-documented
   *  single-API-process assumption) — same honest scope as
   *  `modules/brief/service.ts:50-51`'s `inFlight` guard: this prevents two
   *  concurrent requests within THIS process from both paying for a batch
   *  against the same agent, not two truly concurrent server processes. */
  private runningBatches = new Set<string>();

  constructor(
    private repo: EvalRepository,
    private container: Container,
  ) {}

  async listForAgent(workspaceId: string, agentId: string): Promise<EvalCaseRecord[]> {
    // Tenancy first (AC-42), then confirm the agent itself is in this
    // workspace before listing — a foreign-workspace agent id 404s instead
    // of silently returning an empty list.
    await this.assertOwnerAgent(workspaceId, agentId);
    const rows = await this.repo.listForAgent(workspaceId, agentId);
    return rows.map(mapRowToRecord);
  }

  async getById(workspaceId: string, id: string): Promise<EvalCaseRecord | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? mapRowToRecord(row) : undefined;
  }

  async create(workspaceId: string, input: EvalCaseInput): Promise<EvalCaseRecord> {
    // AC-43 — the worst IDOR surface: `owner_id` is a bare string in the
    // contract. Resolved through AgentsService, never a raw id comparison.
    await this.assertOwnerAgent(workspaceId, input.owner_id);
    assertDiffWithinCap(input.input_diff);
    const row = await this.repo.insert({
      workspaceId,
      // D-9 — 'agent' only at the API level this iteration; the route's own
      // body schema already restricts owner_kind to the literal 'agent'.
      ownerKind: 'agent',
      ownerId: input.owner_id,
      name: input.name,
      inputDiff: input.input_diff,
      inputFiles: input.input_files ?? null,
      inputMeta: input.input_meta ?? null,
      expectedOutput: input.expected_output,
      notes: input.notes ?? null,
    });
    return mapRowToRecord(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: EvalCaseInputPatch,
  ): Promise<EvalCaseRecord | undefined> {
    if (patch.owner_id !== undefined) await this.assertOwnerAgent(workspaceId, patch.owner_id);
    if (patch.input_diff !== undefined) assertDiffWithinCap(patch.input_diff);

    const values: EvalCaseUpdate = {
      ...(patch.owner_id !== undefined ? { ownerId: patch.owner_id } : {}),
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.input_diff !== undefined ? { inputDiff: patch.input_diff } : {}),
      ...(patch.input_files !== undefined ? { inputFiles: patch.input_files } : {}),
      ...(patch.input_meta !== undefined ? { inputMeta: patch.input_meta } : {}),
      ...(patch.expected_output !== undefined ? { expectedOutput: patch.expected_output } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    };
    const row = await this.repo.update(workspaceId, id, values);
    return row ? mapRowToRecord(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /** AC-43's gate: `owner_id` must name a real agent IN THIS WORKSPACE.
   *  404s (never a 403-with-detail — that would leak cross-tenant existence)
   *  when it doesn't. */
  private async assertOwnerAgent(workspaceId: string, agentId: string): Promise<void> {
    const agents = new AgentsService(this.container);
    const agent = await agents.get(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
  }

  /**
   * WI5 — one-click "create case from finding". Every field beyond an
   * optional `name` is derived server-side from the finding/review/pull;
   * refuses and writes nothing on any of: cross-workspace finding (404),
   * an undecided finding, a review with no `agent_id`, or a file with no
   * stored patch.
   */
  async createFromFinding(
    workspaceId: string,
    findingId: string,
    name: string | null | undefined,
  ): Promise<EvalCaseRecord> {
    const ctx = await this.repo.getFindingContext(findingId);
    // AC-5 — a finding outside the caller's workspace 404s, same as a
    // finding that doesn't exist at all (don't leak cross-tenant existence).
    if (!ctx || ctx.pull.workspaceId !== workspaceId) {
      throw new NotFoundError('Finding not found');
    }
    const { finding, review, pull } = ctx;

    // AC-3/D-7 — server-derived, only. A pending finding (neither timestamp
    // set) refuses rather than guessing.
    const kind = deriveExpectationKind(finding);
    if (!kind) {
      throw new AppError(
        'finding_not_decided',
        'Finding has not been accepted or dismissed yet',
        422,
      );
    }

    // AC-6 — owner = the review's agent_id; a null agent_id refuses rather
    // than guessing an owner.
    if (!review.agentId) {
      throw new AppError(
        'review_missing_agent',
        "This finding's review has no agent — cannot determine a case owner",
        422,
      );
    }

    // AC-7/AC-8 — inputs pinned at creation, never re-derived later. No
    // pr_files row with a non-null patch → refuse, never store an empty diff.
    const prFile = await this.repo.getPrFileByPath(pull.id, finding.file);
    if (!prFile?.patch) {
      throw new AppError(
        'no_diff_available',
        `No stored patch for '${finding.file}' — cannot pin an eval case`,
        422,
      );
    }

    const entry = buildExpectationEntry(finding);
    const expectedOutput: EvalExpectation = {
      version: 1,
      must_find: kind === 'must_find' ? [entry] : [],
      must_not_flag: kind === 'must_not_flag' ? [entry] : [],
    };

    // AC-46 — this write path built its own diff via `buildDiffText` instead
    // of taking `input_diff` straight from a validated request body (like
    // `create`/`update` do), so it must cap-check that diff itself before
    // the insert — otherwise a PR-author-controlled `pr_files.patch` (plain
    // `text`, no length bound) reaches storage uncapped, then Phase C's LLM
    // prompt uncapped after it.
    const inputDiff = buildDiffText([{ path: finding.file, patch: prFile.patch }]);
    assertDiffWithinCap(inputDiff);

    // `input_meta`/`input_files` are server-constructed here rather than
    // pulled from a zod-validated request body (`create`/`update` get that
    // validation for free from the route's `EvalCaseCreateBody`/
    // `EvalCaseUpdateBody` schema, now that both fields are typed instead of
    // `z.unknown()`) — so this call site validates its own constructed
    // values explicitly, the same shape guarantee the other two paths get
    // from the route boundary.
    const inputFiles = z.array(z.string()).parse([finding.file]);
    const inputMeta = EvalCaseInputMeta.parse({ title: pull.title, body: pull.body ?? '' });

    const row = await this.repo.insert({
      workspaceId,
      ownerKind: 'agent',
      ownerId: review.agentId,
      name: name ?? finding.title,
      inputDiff,
      inputFiles,
      inputMeta,
      expectedOutput,
      notes: null,
    });
    return mapRowToRecord(row);
  }

  // ===========================================================================
  // WI7 — version-pinned batch runner
  // ===========================================================================

  /** `POST /agents/:id/eval-runs` — run an agent's WHOLE case set as one
   *  batch (AC-14, AC-45). */
  async runForAgent(
    workspaceId: string,
    agentId: string,
    logger?: EvalLogSink,
  ): Promise<EvalBatchRecord> {
    const agents = new AgentsService(this.container);
    const agent = await agents.get(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const rows = await this.repo.listForAgent(workspaceId, agentId);
    if (rows.length === 0) {
      throw new AppError('no_eval_cases', 'This agent has no eval cases to run', 422);
    }
    // A06 / Q-4 — bounds the worst-case spend of one batch.
    if (rows.length > MAX_CASES_PER_BATCH) {
      throw new AppError(
        'too_many_cases',
        `A batch is capped at ${MAX_CASES_PER_BATCH} cases (this set has ${rows.length})`,
        422,
      );
    }

    return this.runPinnedBatch(workspaceId, agent, rows, logger);
  }

  /** `POST /eval-cases/:id/run` — a single case → a one-case batch, so the
   *  SAME pin/isolate/aggregate invariants that govern `runForAgent` hold
   *  for both paths (AC-14). */
  async runOneCase(
    workspaceId: string,
    caseId: string,
    logger?: EvalLogSink,
  ): Promise<EvalBatchRecord> {
    const row = await this.repo.getById(workspaceId, caseId);
    if (!row) throw new NotFoundError('Eval case not found');
    const agents = new AgentsService(this.container);
    const agent = await agents.get(workspaceId, row.ownerId);
    if (!agent) throw new NotFoundError('Agent not found');

    return this.runPinnedBatch(workspaceId, agent, [row], logger);
  }

  /**
   * Shared batch execution — both `runForAgent` and `runOneCase` funnel
   * through here so the pin/guard/isolate/aggregate/log sequence is
   * identical for both entry points.
   *
   * Sequence: guard → resolve provider + enabled linked skills ONCE (pins
   * `agent_version`/`provider`/`model`/`skills_fingerprint`/`ran_at` in
   * memory, AC-15/AC-16 — a mid-batch config change cannot affect these
   * already-captured values regardless of when the row is written) → run
   * every case SERIALLY (Q-4) through `runner.runBatch` (per-case isolation
   * is `runner.ts`'s job, AC-20) → compute the aggregate (AC-21, AC-30) →
   * insert the batch row ALREADY CLOSED plus every case's `eval_runs` row in
   * ONE transaction via `insertBatchWithRuns` (the ONLY write to
   * `eval_batches`/`eval_runs` for a run; see `EvalBatchWrite`'s doc comment
   * for why there's no separate open-with-placeholder step, and for the one
   * residual risk the transaction does NOT cover) → log a summary line that
   * NEVER includes diff/prompt/raw-response content (AC-48, A09).
   */
  private async runPinnedBatch(
    workspaceId: string,
    agent: Agent,
    rows: EvalCaseRow[],
    logger?: EvalLogSink,
  ): Promise<EvalBatchRecord> {
    const guardKey = `${workspaceId}:${agent.id}`;
    if (this.runningBatches.has(guardKey)) {
      // E-14 — in-process only; see the field's own doc comment for scope.
      throw new ConflictError('A batch is already running for this agent');
    }
    this.runningBatches.add(guardKey);

    try {
      const agentsSvc = new AgentsService(this.container);
      const llm = await this.container.llm(agent.provider);
      const linkedSkills = await agentsSvc.linkedSkillsForRun(agent.id);
      // Only ENABLED linked skills reach the prompt (same rule
      // `run-executor.ts` enforces) — already ordered ascending by
      // `AgentsRepository.linkedSkills`, so filtering preserves order.
      const enabledSkills = linkedSkills.filter((s) => s.enabled);
      const skillBodies = enabledSkills.map((s) => `### ${s.name}\n${s.body}`);
      const skillsFingerprint = enabledSkills.map((s) => ({ skill_id: s.skill_id, version: s.version }));

      // ---- OPEN (in memory only — no DB write yet, see EvalBatchWrite's
      // doc comment): pin agent_version/provider/model/skills_fingerprint/
      // ran_at NOW — a config change after this point cannot affect this
      // batch (AC-15/16), regardless of when the row actually gets written.
      const ranAt = new Date();

      const runnerCases: RunnerCase[] = rows.map((r) => {
        const expectationParsed = EvalExpectation.safeParse(r.expectedOutput);
        const metaParsed = EvalCaseInputMeta.nullable().safeParse(r.inputMeta ?? null);
        return {
          id: r.id,
          inputDiff: r.inputDiff ?? '',
          inputMeta: metaParsed.success ? metaParsed.data : null,
          expectation: expectationParsed.success ? expectationParsed.data : null,
        };
      });

      const snapshot: RunnerAgentSnapshot = {
        systemPrompt: agent.system_prompt,
        model: agent.model,
        strategy: agent.strategy,
        skills: skillBodies,
        llm,
      };

      const batchStart = Date.now();
      const results = await runBatch(snapshot, runnerCases);
      const durationMs = Date.now() - batchStart;

      // ---- Aggregate (AC-21, AC-30) -------------------------------------
      const agg = aggregateBatch(
        results.map((r) => ({
          ok: r.ok,
          pass: r.pass,
          recall: r.recall,
          precision: r.precision,
          citation_accuracy: r.citation_accuracy,
        })),
      );
      const okResults = results.filter((r) => r.ok);
      // findings_total / cost_usd — null (never zero/invented) when NOTHING
      // executed successfully; a partial run sums only what actually ran.
      const findingsTotal =
        okResults.length === 0
          ? null
          : okResults.reduce((sum, r) => sum + (r.findingsTotal ?? 0), 0);
      // Batch-level cost is only reported when EVERY case that ran has a
      // known cost — summing a mix of real + `null` per-case costs would
      // silently understate spend, which is worse than reporting nothing.
      const allCostsKnown = okResults.length > 0 && okResults.every((r) => r.costUsd !== null);
      const costUsd = allCostsKnown ? okResults.reduce((sum, r) => sum + (r.costUsd ?? 0), 0) : null;

      // ---- Insert the batch row ALREADY CLOSED plus every case's
      // `eval_runs` row in ONE transaction (Phase C fix-loop iteration 2,
      // Minor finding #1) — the ONLY write to `eval_batches`/`eval_runs` for
      // this run. See `EvalBatchWrite`'s doc comment for the residual risk
      // this transaction does NOT cover (spend from cases that ran before
      // this call, lost on a crash before the transaction starts).
      const { batch: closed } = await this.repo.insertBatchWithRuns(
        {
          workspaceId,
          ownerKind: 'agent',
          ownerId: agent.id,
          agentVersion: agent.version,
          provider: agent.provider,
          model: agent.model,
          skillsFingerprint,
          ranAt,
          status: agg.status,
          casesTotal: agg.cases_total,
          casesPassed: agg.cases_passed,
          casesFailed: agg.cases_failed,
          recall: agg.recall,
          recallCases: agg.recall_cases,
          precision: agg.precision,
          precisionCases: agg.precision_cases,
          citationAccuracy: agg.citation_accuracy,
          citationCases: agg.citation_cases,
          findingsTotal,
          durationMs,
          costUsd,
          error: agg.status === 'failed' ? 'Every case in this batch failed to execute' : null,
        },
        results.map((r) => ({
          caseId: r.caseId,
          actualOutput: r.actualOutput,
          pass: r.pass,
          recall: r.recall,
          precision: r.precision,
          citationAccuracy: r.citation_accuracy,
          findingsTotal: r.findingsTotal,
          durationMs: r.durationMs,
          costUsd: r.costUsd,
          error: r.error,
        })),
      );

      // ---- Log (AC-48, A09) — NEVER input_diff, the assembled prompt, or
      // the raw model response; only ids/counts/metrics/model/tokens/cost.
      const tokensIn = okResults.reduce((sum, r) => sum + r.tokensIn, 0);
      const tokensOut = okResults.reduce((sum, r) => sum + r.tokensOut, 0);
      logger?.info(
        {
          batchId: closed.id,
          agentId: agent.id,
          agentVersion: agent.version,
          caseCount: rows.length,
          provider: agent.provider,
          model: agent.model,
          status: closed.status,
          recall: closed.recall,
          precision: closed.precision,
          citationAccuracy: closed.citationAccuracy,
          tokensIn,
          tokensOut,
          costUsd: closed.costUsd,
          durationMs: closed.durationMs,
        },
        `eval batch ${closed.id} for agent "${agent.name}" — ${closed.casesPassed}/${closed.casesTotal} passed`,
      );

      return mapBatchRowToRecord(closed);
    } finally {
      this.runningBatches.delete(guardKey);
    }
  }

  // ===========================================================================
  // WI8 — read APIs (dashboard, history, compare) — zero LLM calls
  // ===========================================================================

  /** `GET /agents/:id/eval-dashboard`. */
  async getDashboardForAgent(workspaceId: string, agentId: string): Promise<EvalDashboard> {
    const agents = new AgentsService(this.container);
    const agent = await agents.get(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    return this.buildDashboard(workspaceId, 'agent', agentId);
  }

  /** `GET /eval-dashboard` — one entry per agent that has EITHER a case or a
   *  batch in this workspace (E-15 — an owner keeps its history even after
   *  every one of its cases has been deleted). */
  async getWorkspaceDashboard(workspaceId: string): Promise<EvalDashboard[]> {
    const owners = await this.repo.listDashboardOwnerIds(workspaceId);
    const dashboards: EvalDashboard[] = [];
    for (const o of owners) {
      dashboards.push(await this.buildDashboard(workspaceId, o.ownerKind, o.ownerId));
    }
    return dashboards;
  }

  private async buildDashboard(
    workspaceId: string,
    ownerKind: EvalCaseOwnerKind,
    ownerId: string,
  ): Promise<EvalDashboard> {
    const [casesTotal, batchRows] = await Promise.all([
      this.repo.countCasesForOwner(workspaceId, ownerId),
      this.repo.listBatchesForOwner(workspaceId, ownerId), // most-recent-first
    ]);
    const batches = batchRows.map(mapBatchRowToRecord);
    const latest = batches[0];
    const previous = batches[1];

    const current = {
      recall: latest?.recall ?? null,
      precision: latest?.precision ?? null,
      citation_accuracy: latest?.citation_accuracy ?? null,
      traces_passed: latest?.cases_passed ?? 0,
      traces_total: latest?.cases_total ?? 0,
      cost_usd: latest?.cost_usd ?? null,
    };

    // E-17 — fewer than two batches → no delta at ALL (never a zero delta).
    //
    // Per-field null when EITHER endpoint's OWN metric is null (a batch that
    // never exercised that metric, e.g. no must_find entries in any of its
    // cases) — `EvalDashboard.delta`'s three fields were widened to
    // `.nullable()` during Phase C's plan-verifier fix-loop
    // (docs/plans/eval-pipeline.md WI1/Recommendation 1) specifically so
    // this never has to fabricate a `0` baseline, which read as a false
    // swing (e.g. "recall dropped by 0.8" when really "recall is simply
    // unmeasured this batch"). Mirrors `compare()`'s existing pattern below.
    const delta =
      latest && previous
        ? {
            recall:
              latest.recall !== null && previous.recall !== null
                ? latest.recall - previous.recall
                : null,
            precision:
              latest.precision !== null && previous.precision !== null
                ? latest.precision - previous.precision
                : null,
            citation_accuracy:
              latest.citation_accuracy !== null && previous.citation_accuracy !== null
                ? latest.citation_accuracy - previous.citation_accuracy
                : null,
          }
        : null;

    // Trend — one point per batch, oldest first (chronological reading order).
    const trend: EvalTrendPoint[] = [...batches].reverse().map((b) => ({
      batch_id: b.id,
      agent_version: b.agent_version,
      ran_at: b.ran_at,
      recall: b.recall,
      precision: b.precision,
      citation_accuracy: b.citation_accuracy,
      pass_rate: b.cases_total === 0 ? 0 : b.cases_passed / b.cases_total,
      cost_usd: b.cost_usd,
    }));

    return {
      owner_kind: ownerKind,
      owner_id: ownerId,
      cases_total: casesTotal,
      current,
      delta,
      trend,
      recent_runs: batches,
      // Not computed this iteration — the spec names no threshold/condition
      // for this field; flagged rather than guessing one (A10 fail-closed:
      // no signal is safer than an invented one).
      alert: null,
    };
  }

  /** `GET /agents/:id/eval-batches` — history table (D-3: rows are batches). */
  async listBatchesForAgent(workspaceId: string, agentId: string): Promise<EvalBatchRecord[]> {
    const agents = new AgentsService(this.container);
    const agent = await agents.get(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const rows = await this.repo.listBatchesForOwner(workspaceId, agentId);
    return rows.map(mapBatchRowToRecord);
  }

  /** `GET /eval-batches/:id` — the batch plus its per-case `eval_runs` rows.
   *  Workspace-scoped through the BATCH row (AC-44); `undefined` → the route
   *  maps to 404. */
  async getBatch(
    workspaceId: string,
    id: string,
  ): Promise<{ batch: EvalBatchRecord; runs: EvalRunRecord[] } | undefined> {
    const row = await this.repo.getBatchById(workspaceId, id);
    if (!row) return undefined;
    const runRows = await this.repo.listRunsForBatch(row.id);
    return {
      batch: mapBatchRowToRecord(row),
      runs: runRows.map(({ run, caseName }) => mapRunRowToRecord(run, caseName)),
    };
  }

  /** `GET /agents/:id/eval-compare?base=<id>&head=<id>` — read-only, two
   *  batches side by side (D-8, Q-2 — no promote/revert). Both prompts come
   *  from `agent_versions` SNAPSHOTS via `AgentsService.getVersion`, never
   *  the agent's current prompt (AC-32) — a missing snapshot degrades to a
   *  `null` prompt with the batch's own metrics still rendered. */
  async compare(
    workspaceId: string,
    agentId: string,
    baseId: string,
    headId: string,
  ): Promise<EvalComparison> {
    const agents = new AgentsService(this.container);
    const agent = await agents.get(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const [baseRow, headRow] = await Promise.all([
      this.repo.getBatchById(workspaceId, baseId),
      this.repo.getBatchById(workspaceId, headId),
    ]);
    // AC-44 — workspace-scoped AND must belong to THIS agent (never a
    // cross-agent batch id smuggled through the query string).
    if (!baseRow || baseRow.ownerId !== agentId) throw new NotFoundError('Base batch not found');
    if (!headRow || headRow.ownerId !== agentId) throw new NotFoundError('Head batch not found');

    const base = mapBatchRowToRecord(baseRow);
    const head = mapBatchRowToRecord(headRow);

    const [baseVersion, headVersion] = await Promise.all([
      agents.getVersion(workspaceId, agentId, base.agent_version),
      agents.getVersion(workspaceId, agentId, head.agent_version),
    ]);

    return {
      base,
      head,
      delta: {
        recall: base.recall !== null && head.recall !== null ? head.recall - base.recall : null,
        precision:
          base.precision !== null && head.precision !== null ? head.precision - base.precision : null,
        citation_accuracy:
          base.citation_accuracy !== null && head.citation_accuracy !== null
            ? head.citation_accuracy - base.citation_accuracy
            : null,
        cost_usd: base.cost_usd !== null && head.cost_usd !== null ? head.cost_usd - base.cost_usd : null,
      },
      base_prompt: baseVersion?.config.system_prompt ?? null,
      head_prompt: headVersion?.config.system_prompt ?? null,
    };
  }
}
