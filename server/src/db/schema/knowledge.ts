import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  doublePrecision,
  integer,
  vector,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';
import { skills } from './skills';

// ============================================================ Knowledge / RAG

export const memory = pgTable(
  'memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['repo', 'global', 'team'] }).notNull(),
    kind: text('kind', {
      enum: ['decision', 'convention', 'preference', 'fact', 'learning'],
    }).notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    confidence: doublePrecision('confidence'),
    sources: jsonb('sources'),
    /** Set only for a memory row created by the "Learn" finding action (L07,
     *  SPEC-04) — the finding's id, used as the idempotency key so a repeat
     *  Learn on the same finding is a DB-guaranteed no-op rather than an
     *  app-level SELECT-then-INSERT race. Null for every other memory row
     *  (manual entries, curator merges, etc.) — a plain (non-partial) unique
     *  index still works here since Postgres treats NULLs as distinct from
     *  each other under a standard unique index. */
    learnedFindingId: uuid('learned_finding_id'),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({
    wsIdx: index('memory_ws_idx').on(t.workspaceId),
    learnedFindingUq: uniqueIndex('memory_learned_finding_uq').on(t.learnedFindingId),
  }),
);

export const conventions = pgTable('conventions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
  rule: text('rule').notNull(),
  evidencePath: text('evidence_path'),
  evidenceSnippet: text('evidence_snippet'),
  evidenceLine: integer('evidence_line'),
  confidence: doublePrecision('confidence'),
  category: text('category'),
  status: text('status', { enum: ['pending', 'accepted', 'rejected'] })
    .notNull()
    .default('accepted'),
  skillId: uuid('skill_id').references(() => skills.id, { onDelete: 'set null' }),
});
