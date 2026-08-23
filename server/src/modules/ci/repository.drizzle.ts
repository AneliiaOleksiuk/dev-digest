import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type {
  CiInstallationRow,
  CiInstallationWithLastRun,
  CiInstallationWithWorkspace,
  CiPostAs,
  CiRepository,
  CiRunFilterInput,
  CiRunListRow,
  CiTargetType,
  InsertCiRunInput,
  UpsertInstallationInput,
} from './repository.js';

/**
 * The only file in `modules/ci/` allowed to import Drizzle/`db/schema`
 * (onion-architecture).
 */
export class DrizzleCiRepository implements CiRepository {
  constructor(private db: Db) {}

  // ---- installations (workspace-scoped via the `agents` join) -------------

  async listInstallationsForAgent(
    workspaceId: string,
    agentId: string,
  ): Promise<CiInstallationWithLastRun[]> {
    const rows = await this.db
      .select({ installation: t.ciInstallations })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.ciInstallations.agentId, agentId)));

    const installations = rows.map((r) => toInstallationRow(r.installation));
    const lastRuns = await this.lastRunsFor(installations.map((i) => i.id));
    return installations.map((i) => ({ ...i, lastRun: lastRuns.get(i.id) ?? null }));
  }

  async findInstallationByAgentAndRepo(
    workspaceId: string,
    agentId: string,
    repo: string,
  ): Promise<CiInstallationRow | undefined> {
    const [row] = await this.db
      .select({ installation: t.ciInstallations })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(
        and(
          eq(t.agents.workspaceId, workspaceId),
          eq(t.ciInstallations.agentId, agentId),
          eq(t.ciInstallations.repo, repo),
        ),
      );
    return row ? toInstallationRow(row.installation) : undefined;
  }

  async findInstallationsByRepo(workspaceId: string, repo: string): Promise<CiInstallationRow[]> {
    const rows = await this.db
      .select({ installation: t.ciInstallations })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.ciInstallations.repo, repo)));
    return rows.map((r) => toInstallationRow(r.installation));
  }

  /** `onConflictDoUpdate`'s `set` deliberately omits `tokenHash` — see
   *  `UpsertInstallationInput.tokenHash`'s doc comment (repository.ts). An
   *  existing row's token hash therefore cannot be overwritten by this call
   *  under any input, by construction, not by caller discipline. */
  async upsertInstallation(input: UpsertInstallationInput): Promise<CiInstallationRow> {
    const [row] = await this.db
      .insert(t.ciInstallations)
      .values({
        agentId: input.agentId,
        repo: input.repo,
        targetType: input.targetType,
        ingestUrl: input.ingestUrl,
        workflowVersion: input.workflowVersion,
        agentVersion: input.agentVersion,
        postAs: input.postAs,
        triggers: input.triggers,
        baseBranch: input.baseBranch,
        manifestPath: input.manifestPath,
        tokenHash: input.tokenHash,
      })
      .onConflictDoUpdate({
        target: [t.ciInstallations.agentId, t.ciInstallations.repo],
        set: {
          targetType: input.targetType,
          ingestUrl: input.ingestUrl,
          workflowVersion: input.workflowVersion,
          agentVersion: input.agentVersion,
          postAs: input.postAs,
          triggers: input.triggers,
          baseBranch: input.baseBranch,
          // Fix (finding 2): the caller has already resolved the STABLE
          // value (fresh / inherited / reused from `existing.manifestPath`)
          // before calling this method, so persisting whatever is passed is
          // correct here — unlike `tokenHash`, there is no "never overwrite"
          // requirement for this column.
          manifestPath: input.manifestPath,
          updatedAt: new Date(),
          // tokenHash intentionally absent — see doc comment above.
        },
      })
      .returning();
    return toInstallationRow(row!);
  }

  async deleteInstallation(workspaceId: string, id: string): Promise<boolean> {
    // Confirm tenancy via the `agents` join BEFORE deleting — Drizzle's
    // `.delete()` has no join clause, so the workspace check is a separate
    // read, and only a confirmed match proceeds to the actual delete.
    const [row] = await this.db
      .select({ id: t.ciInstallations.id })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(and(eq(t.ciInstallations.id, id), eq(t.agents.workspaceId, workspaceId)));
    if (!row) return false;
    await this.db.delete(t.ciInstallations).where(eq(t.ciInstallations.id, id));
    return true;
  }

  // ---- ingest-path exception (see repository.ts's module docblock) -------

  /** Fix (finding 1) — see `repository.ts`'s doc comment. `token_hash` has a
   *  plain (non-unique) index (`db/schema/ci.ts`); a collision is not this
   *  feature's threat model (D-1), so `LIMIT 1` via destructuring the first
   *  row is an accepted, deliberate simplification, not an oversight. */
  async findInstallationByTokenHash(hash: string): Promise<CiInstallationWithWorkspace | undefined> {
    const [row] = await this.db
      .select({ installation: t.ciInstallations, workspaceId: t.agents.workspaceId })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(eq(t.ciInstallations.tokenHash, hash));
    return row ? { ...toInstallationRow(row.installation), workspaceId: row.workspaceId } : undefined;
  }

  /** Relies on `agent_runs_ci_installation_actions_run_uq` — a conflict is
   *  swallowed via `onConflictDoNothing` (AC-57, E-16), never surfaced as an
   *  error to the CI job that (harmlessly) retried a report. */
  async insertCiRun(row: InsertCiRunInput): Promise<void> {
    await this.db
      .insert(t.agentRuns)
      .values({
        workspaceId: row.workspaceId,
        agentId: row.agentId,
        prId: null,
        source: 'ci',
        ciInstallationId: row.ciInstallationId,
        repo: row.repo,
        externalPrNumber: row.externalPrNumber,
        headSha: row.headSha,
        actionsRunId: row.actionsRunId,
        jobUrl: row.jobUrl,
        sourceLabel: row.sourceLabel,
        status: row.status,
        findingsCount: row.findingsCount,
        critical: row.critical,
        warning: row.warning,
        suggestion: row.suggestion,
        costUsd: row.costUsd,
        durationMs: row.durationMs,
        error: row.error,
        // Fields the ingest artifact never reports — explicit null, never
        // invented (A08).
        provider: null,
        model: null,
        tokensIn: null,
        tokensOut: null,
        grounding: null,
        score: null,
        blockers: null,
      })
      .onConflictDoNothing({
        target: [t.agentRuns.ciInstallationId, t.agentRuns.actionsRunId],
      });
  }

  // ---- CI Runs list (workspace-scoped directly off `agent_runs`) ----------

  async listCiRuns(workspaceId: string, filters: CiRunFilterInput): Promise<CiRunListRow[]> {
    const since = new Date(Date.now() - filters.sinceDays * 24 * 60 * 60 * 1000);
    const conditions = [
      eq(t.agentRuns.workspaceId, workspaceId),
      eq(t.agentRuns.source, 'ci'),
      gte(t.agentRuns.ranAt, since),
    ];
    if (filters.agentId) conditions.push(eq(t.agentRuns.agentId, filters.agentId));
    if (filters.repo) conditions.push(eq(t.agentRuns.repo, filters.repo));
    if (filters.status) conditions.push(eq(t.agentRuns.status, filters.status));
    if (filters.sourceLabel) conditions.push(eq(t.agentRuns.sourceLabel, filters.sourceLabel));

    // Left-join the agent for its (possibly since-deleted) name, and
    // left-join repos+pull_requests by (workspace, full_name, number) to
    // recover a title where a local PR row happens to exist — `agent_runs`
    // never carries `pr_id` for a CI run (AC-56, E-25), so this is a
    // denormalized match, not an FK join.
    const rows = await this.db
      .select({
        run: t.agentRuns,
        agentName: t.agents.name,
        prTitle: t.pullRequests.title,
      })
      .from(t.agentRuns)
      .leftJoin(t.agents, eq(t.agentRuns.agentId, t.agents.id))
      .leftJoin(
        t.repos,
        and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, t.agentRuns.repo)),
      )
      .leftJoin(
        t.pullRequests,
        and(eq(t.pullRequests.repoId, t.repos.id), eq(t.pullRequests.number, t.agentRuns.externalPrNumber)),
      )
      .where(and(...conditions))
      .orderBy(desc(t.agentRuns.ranAt));

    return rows.map((r) => ({
      id: r.run.id,
      ciInstallationId: r.run.ciInstallationId,
      agentId: r.run.agentId,
      agentName: r.agentName ?? null,
      repo: r.run.repo,
      externalPrNumber: r.run.externalPrNumber,
      headSha: r.run.headSha,
      ranAt: r.run.ranAt,
      status: r.run.status,
      findingsCount: r.run.findingsCount,
      critical: r.run.critical,
      warning: r.run.warning,
      suggestion: r.run.suggestion,
      costUsd: r.run.costUsd,
      durationMs: r.run.durationMs,
      jobUrl: r.run.jobUrl,
      sourceLabel: r.run.sourceLabel,
      prTitle: r.prTitle ?? null,
    }));
  }

  // ---- internal ------------------------------------------------------------

  /** Latest `source='ci'` run per installation id, in ONE query (avoids an
   *  N+1 across `listInstallationsForAgent`'s rows) — ordered `ranAt` desc
   *  and reduced in JS to "first row wins per id" rather than a SQL
   *  `DISTINCT ON`, since Drizzle's query builder has no first-class
   *  cross-dialect `DISTINCT ON` helper. */
  private async lastRunsFor(
    installationIds: string[],
  ): Promise<Map<string, { ranAt: Date; status: string; findingsCount: number | null }>> {
    const result = new Map<string, { ranAt: Date; status: string; findingsCount: number | null }>();
    if (installationIds.length === 0) return result;
    const rows = await this.db
      .select({
        ciInstallationId: t.agentRuns.ciInstallationId,
        ranAt: t.agentRuns.ranAt,
        status: t.agentRuns.status,
        findingsCount: t.agentRuns.findingsCount,
      })
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.source, 'ci'), inArray(t.agentRuns.ciInstallationId, installationIds)))
      .orderBy(desc(t.agentRuns.ranAt));
    for (const r of rows) {
      if (!r.ciInstallationId || result.has(r.ciInstallationId)) continue;
      result.set(r.ciInstallationId, {
        ranAt: r.ranAt,
        status: r.status ?? 'succeeded',
        findingsCount: r.findingsCount,
      });
    }
    return result;
  }
}

type CiInstallationSelectRow = typeof t.ciInstallations.$inferSelect;

function toInstallationRow(row: CiInstallationSelectRow): CiInstallationRow {
  return {
    id: row.id,
    agentId: row.agentId,
    repo: row.repo,
    targetType: row.targetType as CiTargetType,
    installedAt: row.installedAt,
    tokenHash: row.tokenHash,
    ingestUrl: row.ingestUrl,
    workflowVersion: row.workflowVersion,
    agentVersion: row.agentVersion,
    postAs: row.postAs as CiPostAs,
    triggers: row.triggers,
    baseBranch: row.baseBranch,
    manifestPath: row.manifestPath,
    updatedAt: row.updatedAt,
  };
}
