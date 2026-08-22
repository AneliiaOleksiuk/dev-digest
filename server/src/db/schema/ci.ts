import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  doublePrecision,
  jsonb,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { agents } from './agents';

export const ciInstallations = pgTable(
  'ci_installations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    repo: text('repo').notNull(),
    targetType: text('target_type', { enum: ['gha', 'circle', 'jenkins', 'cli'] }).notNull(),
    installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow().notNull(),
    /**
     * sha256(token) — the plaintext one-time ingest token is NEVER stored;
     * it exists only in the immediate Install response (AC-50).
     */
    tokenHash: text('token_hash').notNull(),
    /** Where the CI job POSTs its result artifact back to (Q-8). */
    ingestUrl: text('ingest_url').notNull(),
    workflowVersion: integer('workflow_version').notNull().default(1),
    agentVersion: integer('agent_version').notNull().default(1),
    postAs: text('post_as', { enum: ['github_review', 'pr_comment', 'none'] })
      .notNull()
      .default('github_review'),
    triggers: jsonb('triggers').$type<string[]>().notNull(),
    baseBranch: text('base_branch').notNull().default('main'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // AC-38's "update, don't duplicate" enforced by the database, not only the service.
    agentRepoUq: uniqueIndex('ci_installations_agent_repo_uq').on(t.agentId, t.repo),
  }),
);

/**
 * Q-2/D-11: deliberately NOT written by SPEC-04 — `agent_runs` rows with
 * `source = 'ci'` (see `runs.ts`) are the single CI run store going forward.
 * Left in place rather than dropped; no new code should write to this table.
 */
export const ciRuns = pgTable('ci_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  ciInstallationId: uuid('ci_installation_id').references(() => ciInstallations.id, {
    onDelete: 'set null',
  }),
  prNumber: integer('pr_number'),
  ranAt: timestamp('ran_at', { withTimezone: true }),
  status: text('status'),
  findingsCount: integer('findings_count'),
  costUsd: doublePrecision('cost_usd'),
  githubUrl: text('github_url'),
  source: text('source'),
});
