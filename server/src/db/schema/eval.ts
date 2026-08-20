import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, doublePrecision, index } from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { pullRequests } from './pulls';

// ============================================================ Eval / Conformance / Compose

// NOTE: `eval_runs` has NO `workspace_id` column of its own (deliberate,
// scaffolding-era shape) — every read of it MUST scope through its owning
// `eval_cases` row (`case_id`) or its `eval_batches` row (`batch_id`), never
// by run id alone, or the tenancy guarantee below silently doesn't apply.
export const evalCases = pgTable(
  'eval_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    inputDiff: text('input_diff'),
    inputFiles: jsonb('input_files'),
    inputMeta: jsonb('input_meta'),
    expectedOutput: jsonb('expected_output'),
    notes: text('notes'),
  },
  (t) => ({
    workspaceOwnerIdx: index('eval_cases_workspace_owner_idx').on(t.workspaceId, t.ownerId),
  }),
);

/**
 * One version-pinned run of an owner's whole eval-case set. Stores its own
 * aggregate (recall/precision/citation_accuracy + contributing case counts)
 * so deleting a case later can never rewrite a past batch's score. This
 * table has its own `workspace_id` tenancy anchor — `eval_runs` (below)
 * deliberately does not — every batch read is scoped through it.
 */
export const evalBatches = pgTable(
  'eval_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    agentVersion: integer('agent_version').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    /** Ordered `{skill_id, version}[]` of the agent's enabled linked skills
     *  at batch start (Q-3) — makes a skill-only edit visible on the batch
     *  even though it does not bump `agents.version`. */
    skillsFingerprint: jsonb('skills_fingerprint')
      .notNull()
      .default(sql`'[]'::jsonb`),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    status: text('status', { enum: ['completed', 'failed'] }).notNull(),
    casesTotal: integer('cases_total').notNull(),
    casesPassed: integer('cases_passed').notNull(),
    casesFailed: integer('cases_failed').notNull(),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    /** Contributing case count per metric — a batch mean is over non-null
     *  per-case values only, so these can be less than `casesTotal`. */
    recallCases: integer('recall_cases').notNull(),
    precisionCases: integer('precision_cases').notNull(),
    citationCases: integer('citation_cases').notNull(),
    findingsTotal: integer('findings_total'),
    durationMs: integer('duration_ms'),
    costUsd: doublePrecision('cost_usd'),
    error: text('error'),
  },
  (t) => ({
    workspaceOwnerRanAtIdx: index('eval_batches_workspace_owner_ran_at_idx').on(
      t.workspaceId,
      t.ownerId,
      t.ranAt,
    ),
  }),
);

export const evalRuns = pgTable('eval_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id')
    .notNull()
    .references(() => evalCases.id, { onDelete: 'cascade' }),
  /** Nullable — `ON DELETE SET NULL` so deleting a batch can't cascade away
   *  the per-case rows it produced. */
  batchId: uuid('batch_id').references(() => evalBatches.id, { onDelete: 'set null' }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
  actualOutput: jsonb('actual_output'),
  pass: boolean('pass'),
  recall: doublePrecision('recall'),
  precision: doublePrecision('precision'),
  citationAccuracy: doublePrecision('citation_accuracy'),
  findingsTotal: integer('findings_total'),
  durationMs: integer('duration_ms'),
  costUsd: doublePrecision('cost_usd'),
  error: text('error'),
});

export const conformanceChecks = pgTable('conformance_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  specId: text('spec_id').notNull(),
  completenessPct: doublePrecision('completeness_pct'),
  items: jsonb('items'),
});

export const composedReviews = pgTable('composed_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  verdict: text('verdict'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  githubReviewId: text('github_review_id'),
});
