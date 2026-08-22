import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { agents } from './agents';
import { pullRequests } from './pulls';
import { ciInstallations } from './ci';

// ============================================================ Observability

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    prId: uuid('pr_id').references(() => pullRequests.id, { onDelete: 'set null' }),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    provider: text('provider'),
    model: text('model'),
    durationMs: integer('duration_ms'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    costUsd: doublePrecision('cost_usd'),
    status: text('status'),
    /** Failure reason when status='failed' (LLM/API error, timeout, quota, …). */
    error: text('error'),
    source: text('source', { enum: ['local', 'ci'] }).notNull().default('local'),
    findingsCount: integer('findings_count'),
    grounding: text('grounding'),
    /** Review score (0-100) for this run; null on failed/cancelled runs. */
    score: integer('score'),
    /** Findings that tripped the agent's gate (severity ≥ ciFailOn). */
    blockers: integer('blockers'),
    // CI linkage (AC-56, AC-58, AC-66) — all nullable: a local run has none
    // of them, and a failed CI run has no metrics. `prId` stays nullable and
    // untouched (AC-56, E-25) — a CI run reviews an external repo's PR, not
    // necessarily one imported into `pull_requests`.
    ciInstallationId: uuid('ci_installation_id').references(() => ciInstallations.id, {
      onDelete: 'set null',
    }),
    repo: text('repo'),
    externalPrNumber: integer('external_pr_number'),
    headSha: text('head_sha'),
    actionsRunId: text('actions_run_id'),
    jobUrl: text('job_url'),
    sourceLabel: text('source_label'),
    critical: integer('critical'),
    warning: integer('warning'),
    suggestion: integer('suggestion'),
  },
  (t) => ({
    // AC-57 dedupe. Both columns are NULL for every local run, and Postgres
    // treats NULLs as distinct for uniqueness purposes, so this constraint
    // does not collide with (or affect) any pre-existing local row.
    ciInstallationActionsRunUq: uniqueIndex('agent_runs_ci_installation_actions_run_uq').on(
      t.ciInstallationId,
      t.actionsRunId,
    ),
    // CI Runs list is a workspace-scoped scan filtered to source='ci', ordered
    // by time (AC-65, NFR Performance).
    workspaceSourceRanAtIdx: index('agent_runs_workspace_source_ran_at_idx').on(
      t.workspaceId,
      t.source,
      t.ranAt,
    ),
  }),
);

/** Whole trace of one run as a SINGLE jsonb document. */
export const runTraces = pgTable('run_traces', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => agentRuns.id, { onDelete: 'cascade' }),
  trace: jsonb('trace').notNull(),
});

export const multiAgentRuns = pgTable('multi_agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
});
