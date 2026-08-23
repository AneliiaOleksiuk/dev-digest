import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, jsonb, timestamp, doublePrecision, primaryKey } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';
import type { IntentSource } from '../../vendor/shared/contracts/brief';

// ============================================================ Review & findings

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id'),
  /** The agent_run that produced this review (links the timeline run ↔ review). */
  runId: uuid('run_id'),
  kind: text('kind', { enum: ['summary', 'review'] }).notNull(),
  verdict: text('verdict'),
  summary: text('summary'),
  score: integer('score'),
  model: text('model'),
  createdAt: now(),
});

export const findings = pgTable('findings', {
  id: uuid('id').primaryKey().defaultRandom(),
  reviewId: uuid('review_id')
    .notNull()
    .references(() => reviews.id, { onDelete: 'cascade' }),
  file: text('file').notNull(),
  startLine: integer('start_line').notNull(),
  endLine: integer('end_line').notNull(),
  severity: text('severity').notNull(),
  category: text('category').notNull(),
  title: text('title').notNull(),
  rationale: text('rationale').notNull(),
  suggestion: text('suggestion'),
  confidence: doublePrecision('confidence').notNull(),
  kind: text('kind').notNull().default('finding'),
  trifectaComponents: jsonb('trifecta_components').$type<string[]>(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
});

export const prIntent = pgTable('pr_intent', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  intent: text('intent').notNull(),
  inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /** Which commit the intent describes; drives the "stale, re-run?" state. */
  headSha: text('head_sha'),
  /** Capped confidence (see `capConfidence` in `intent-inputs.ts`). */
  confidence: doublePrecision('confidence'),
  /** Provenance, incl. unresolved refs. Server-computed, never model-authored. */
  sources: jsonb('sources').$type<IntentSource[]>().notNull().default(sql`'[]'::jsonb`),
  /** Explicit "couldn't get this" list. */
  missingContext: jsonb('missing_context').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /** Short classifier-authored risk bullets (mock "Risk Areas"), e.g. "New
   *  dependency: ioredis". Distinct from the unbuilt `pr_brief` `Risks`. */
  riskAreas: jsonb('risk_areas').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /** Proves the classifier ran on a different provider/model than the review. */
  provider: text('provider'),
  model: text('model'),
  /** Freshness display. */
  classifiedAt: timestamp('classified_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * SPEC-03 — one row per (PR, head_sha), NOT one row per PR (D-4). Repurposed
 * from a never-written `pr_id`-primary-key/single-`json` shape: no
 * repository/service/route referenced it anywhere in `server/src` before
 * this, so the key change costs nothing (no rows to migrate, no reader to
 * break). Composite PK serves both access paths (exact `(prId, headSha)`
 * lookup, and a `prId`-prefix scan for the Why Timeline) and gives
 * `onConflictDoUpdate` a natural target so AC-13's "replace, never append"
 * is enforced by the database itself.
 *
 * `json` holds the model-authored `Brief` fields (`what`/`why`/`risk_level`/
 * `risks`/`review_focus`) PLUS a nested `input_status` object (everything in
 * `BriefInputStatus` except `dropped_inputs`, which gets its own column
 * below) — re-parsed against the module's own stored-json contract on every
 * read (AC-40), same "corrupted row degrades, never crashes" contract
 * `onboarding.json` already has. Usage/cost columns mirror `agent_runs`
 * field-for-field (`doublePrecision` for `costUsd`, per server/INSIGHTS.md).
 */
export const prBrief = pgTable(
  'pr_brief',
  {
    prId: uuid('pr_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    headSha: text('head_sha').notNull(),
    json: jsonb('json').notNull(),
    provider: text('provider'),
    model: text('model'),
    /** Pre-call measurement of the fully assembled input (AC-23) — always
     *  present once a generation succeeds, unlike the provider-reported
     *  tokensIn/tokensOut below. */
    inputTokens: integer('input_tokens'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    costUsd: doublePrecision('cost_usd'),
    /** AC-22 grounding-drop counts — how many risks[].file_refs / review_focus[]
     *  entries were discarded after the call for citing an ungrounded path/line. */
    droppedRiskRefs: integer('dropped_risk_refs').notNull().default(0),
    droppedFocusItems: integer('dropped_focus_items').notNull().default(0),
    /** AC-24/AC-26 — human strings naming which whole INPUTS the 8k budget
     *  dropped (spec file / linked issue / hunk headers / file list tail).
     *  Distinct from the grounding-drop counts above, which are about the
     *  model's OUTPUT, not its input. */
    droppedInputs: jsonb('dropped_inputs').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.prId, t.headSha] }),
  }),
);
