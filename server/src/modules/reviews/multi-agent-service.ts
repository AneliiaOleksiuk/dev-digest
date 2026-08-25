import PQueue from 'p-queue';
import type { Container } from '../../platform/container.js';
import type { AgentRow, PullRow } from '../../db/rows.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { ReviewRepository } from './repository.js';
import { ReviewRunExecutor, type Logger } from './run-executor.js';
import { IntentService } from './intent-service.js';
import { loadDiff } from './diff-loader.js';
import { toIntentDiffSummary } from './intent-inputs.js';
import { MULTI_AGENT_CONCURRENCY } from './constants.js';

/** Derived from `ReviewRepository.getRepo`'s own return type rather than
 *  importing `db/schema.js` directly (onion-architecture: a service file
 *  never touches `src/db/schema`, even for a type-only import). */
type RepoRow = NonNullable<Awaited<ReturnType<ReviewRepository['getRepo']>>>;

/**
 * L07 (SPEC-04) — multi-agent batch orchestration. Runs an explicit,
 * caller-chosen subset of workspace agents concurrently against one PR as a
 * single addressable batch grouped under a `multi_agent_runs` parent.
 *
 * Hard architectural rule: `run-executor.ts` is NOT modified. Concurrency
 * comes from calling `ReviewRunExecutor.executeRuns` ONCE PER AGENT with a
 * single-element `jobs` array, fanned out via a `p-queue` — mirrors the
 * existing `platform/jobs.ts` `concurrency: 3` pattern. This is also why
 * `loadDiff` (`diff-loader.ts`) grew a memoization cache (WI3): calling
 * `executeRuns` N times means N independent diff loads for the SAME PR
 * unless they're coalesced.
 */
export class MultiAgentService {
  private executor: ReviewRunExecutor;
  private intentService: IntentService;

  constructor(
    private container: Container,
    private repo: ReviewRepository,
    private agents: Container['agentsRepo'],
  ) {
    this.executor = new ReviewRunExecutor(container, repo, agents);
    this.intentService = new IntentService(repo, container);
  }

  /**
   * Validate the agent-id set, create exactly one `multi_agent_runs` parent
   * + N `agent_runs` children, and return the batch id + child run ids
   * IMMEDIATELY — mirrors `ReviewService.runReview`'s existing
   * create-rows-then-fire-and-forget pattern. The actual runs execute in the
   * background (`executeBatch`, not awaited by callers of this method).
   *
   * Security-critical (IDOR): every agent id is verified to belong to the
   * CALLER's workspace BEFORE any row (parent or child) is created — a
   * foreign-workspace id rejects the whole request with zero partial state,
   * never a batch that silently omits it.
   */
  async runBatch(
    workspaceId: string,
    prId: string,
    agentIds: string[],
    logger?: Logger,
  ): Promise<{
    multi_agent_run_id: string;
    runs: { run_id: string; agent_id: string; agent_name: string }[];
  }> {
    if (agentIds.length === 0) {
      throw new AppError('invalid_agent_ids', 'Provide at least one agent id', 400);
    }
    const uniqueIds = Array.from(new Set(agentIds));
    if (uniqueIds.length !== agentIds.length) {
      throw new AppError('invalid_agent_ids', 'Duplicate agent ids are not allowed', 400);
    }

    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repoRow = await this.repo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');

    // ---- Resolve + verify every agent BEFORE any row is created (IDOR) -----
    // OQ-4: "max agents per batch = workspace's agent count" is enforced
    // exactly here — a batch cannot contain more agents than exist, because
    // every id must resolve to a real agent in THIS workspace.
    const targets: AgentRow[] = [];
    for (const id of uniqueIds) {
      const agent = await this.agents.getById(workspaceId, id);
      if (!agent) throw new NotFoundError(`Agent not found: ${id}`);
      targets.push(agent);
    }

    // ---- Create exactly one parent + N children ----------------------------
    // A single-agent batch still creates a parent — no special case.
    const multiAgentRunId = await this.repo.createMultiAgentRun({ workspaceId, prId });
    const runs: { run_id: string; agent_id: string; agent_name: string }[] = [];
    const jobs: { agent: AgentRow; runId: string }[] = [];
    for (const agent of targets) {
      const runId = await this.repo.createAgentRun({
        workspaceId,
        agentId: agent.id,
        prId,
        provider: agent.provider,
        model: agent.model,
        multiAgentRunId,
      });
      runs.push({ run_id: runId, agent_id: agent.id, agent_name: agent.name });
      jobs.push({ agent, runId });
    }

    // Fire-and-forget: the HTTP response returns now with the batch + run
    // ids; the background execution persists each run as it finishes.
    void this.executeBatch(workspaceId, pull, repoRow, jobs, logger).catch((err) => {
      logger?.error(
        { prId, multiAgentRunId, err: (err as Error).message },
        'multi-agent-run: background execution crashed',
      );
    });

    return { multi_agent_run_id: multiAgentRunId, runs };
  }

  /**
   * Background execution: ONE `intent.getOrClassify` call, awaited, BEFORE
   * the concurrent fan-out (ordering, not locking — Rec-6) so every
   * per-agent `executeRuns` call below reuses the SAME persisted intent
   * record via `IntentService`'s own head-sha cache, instead of several
   * concurrent classify calls racing to be first. Then each agent runs via
   * its OWN single-element `executeRuns` call, queued at concurrency 3 —
   * one agent failing leaves siblings' execution and persisted rows
   * untouched (each `executeRuns` call already isolates its own job's
   * failure internally and never rejects because of it).
   */
  private async executeBatch(
    workspaceId: string,
    pull: PullRow,
    repoRow: RepoRow,
    jobs: { agent: AgentRow; runId: string }[],
    logger?: Logger,
  ): Promise<void> {
    try {
      const diff = await loadDiff(this.container, this.repo, workspaceId, pull, repoRow);
      await this.intentService.getOrClassify(workspaceId, pull, repoRow, toIntentDiffSummary(diff));
    } catch (err) {
      // Best-effort, same degradation contract as the single-agent path
      // (`run-executor.ts`'s `buildOrLoadIntent`): a failure here never
      // blocks the fan-out below — each per-agent `executeRuns` call will
      // attempt its own (independently best-effort) classification instead.
      logger?.info(
        { prId: pull.id, err: (err as Error).message },
        'multi-agent-run: pre-fan-out intent resolution failed; each agent will classify independently',
      );
    }

    const queue = new PQueue({ concurrency: MULTI_AGENT_CONCURRENCY });
    await Promise.allSettled(
      jobs.map((job) =>
        queue.add(() => this.executor.executeRuns(workspaceId, pull, repoRow, [job], logger)),
      ),
    );
  }
}
