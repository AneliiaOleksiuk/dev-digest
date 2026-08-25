import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  doublePrecision,
  jsonb,
  uniqueIndex,
  index,
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
     * it exists only in the immediate Install response (AC-50). Looked up
     * directly (fix, finding 1) by `findInstallationByTokenHash` — the hash
     * match itself IS the authentication on `POST /ci/ingest`, hence the
     * plain (non-unique) index below.
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
    /**
     * Fix (finding 2): a STABLE, persisted property of the installation —
     * set once (fresh install: the agent's own slug-derived path; a
     * confirmed replace-conflict: inherited from the conflicting
     * installation's own `manifestPath`) and reused verbatim on every later
     * re-export, regardless of how many times the agent is renamed. Without
     * this, a second export of an already-installed, previously-replaced
     * agent re-derives the path from the agent's CURRENT name, leaving the
     * old path's manifest file still committed — two `.devdigest/agents/*.yaml`
     * files, which makes `agent-runner`'s `findManifestPath` refuse to start.
     */
    manifestPath: text('manifest_path').notNull(),
    /**
     * SPEC-05 (multi-agent CI per repo) Recommendation 1: NULLABLE, no
     * default. Every row that existed before this column was added is
     * `NULL` by construction — that IS the definition of "legacy" (AC-14):
     * a legacy installation keeps its unnamespaced `.devdigest/agents/`
     * paths, its `.github/workflows/devdigest-review.yml` filename and its
     * bare `DEVDIGEST_INGEST_TOKEN` secret forever, and is NEVER migrated,
     * re-namespaced or re-keyed on any later export. A row inserted after
     * this column exists always gets a non-null, server-derived namespace
     * (`helpers.ts`'s `deriveNamespace`) — set once at first install and
     * reused verbatim on every later re-export, exactly like `manifestPath`
     * above.
     *
     * Deliberately NO unique index here (Recommendation 2): uniqueness is
     * per `(workspace, repo)`, enforced in `service.ts` over the
     * workspace-scoped `findInstallationsByRepo` read — a GLOBAL unique
     * index on `(repo, namespace)` would make workspace B's export collide
     * with workspace A's same-named repo, which AC-37 forbids.
     */
    namespace: text('namespace'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // AC-38's "update, don't duplicate" enforced by the database, not only the service.
    agentRepoUq: uniqueIndex('ci_installations_agent_repo_uq').on(t.agentId, t.repo),
    // Fix (finding 1): the ingest endpoint's lookup path. A hash collision is
    // not this feature's threat model (D-1's simplicity mandate) — plain,
    // not unique.
    tokenHashIdx: index('ci_installations_token_hash_idx').on(t.tokenHash),
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
