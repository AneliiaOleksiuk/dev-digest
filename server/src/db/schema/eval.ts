import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  doublePrecision,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { workspaces } from './core';
import { pullRequests } from './pulls';

// ============================================================ Eval / Conformance / Compose

export const evalCases = pgTable(
  'eval_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text('owner_kind', { enum: ['skill', 'agent', 'finding'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    inputDiff: text('input_diff'),
    inputFiles: jsonb('input_files'),
    inputMeta: jsonb('input_meta'),
    expectedOutput: jsonb('expected_output'),
    notes: text('notes'),
  },
  (t) => ({
    // "Turn into eval case" idempotency (L07, SPEC-04) — a DB-level guarantee
    // against a concurrent double-submit racing past the app-level
    // SELECT-then-INSERT check in `eval-case.ts`. Scoped to owner_kind='finding'
    // only: pre-existing skill/agent eval fixtures legitimately have multiple
    // cases per (workspace, owner_kind, owner_id) (confirmed against real data —
    // an unscoped constraint fails migration on this repo's own dev database).
    uq: uniqueIndex('eval_cases_ws_owner_uq')
      .on(t.workspaceId, t.ownerKind, t.ownerId)
      .where(sql`${t.ownerKind} = 'finding'`),
  }),
);

export const evalRuns = pgTable('eval_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id')
    .notNull()
    .references(() => evalCases.id, { onDelete: 'cascade' }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
  actualOutput: jsonb('actual_output'),
  pass: boolean('pass'),
  recall: doublePrecision('recall'),
  precision: doublePrecision('precision'),
  citationAccuracy: doublePrecision('citation_accuracy'),
  durationMs: integer('duration_ms'),
  costUsd: doublePrecision('cost_usd'),
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
