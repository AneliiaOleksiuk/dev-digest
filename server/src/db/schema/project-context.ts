import { pgTable, uuid, text, integer, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';

/**
 * Project Context (SPEC-01) — manual document attachments. One row = one
 * document path attached to one Skill or one Agent (`surface`/`surfaceId`),
 * scoped to the repo clone it was discovered in (`repoId`).
 *
 * `surfaceId` is deliberately NOT a foreign key — it's polymorphic
 * (`skills.id` or `agents.id` depending on `surface`). Compensating
 * controls (R-D of docs/plans/spec-01-project-context.md): `AgentsService
 * .delete`/`SkillsService.delete` explicitly call
 * `contextRepo.deleteForSurface` to avoid orphan rows, and every read joins
 * through an already-authorized agent/skill so an orphan row can never be
 * returned even if one existed.
 */
export const projectContextAttachments = pgTable(
  'project_context_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    surface: text('surface', { enum: ['skill', 'agent'] }).notNull(),
    surfaceId: uuid('surface_id').notNull(),
    path: text('path').notNull(),
    order: integer('order').notNull().default(0),
    createdAt: now(),
  },
  (t) => ({
    // Re-attach idempotency: the Spec's stated attachment key.
    uq: uniqueIndex('project_context_attachments_surface_path_uq').on(
      t.surface,
      t.surfaceId,
      t.repoId,
      t.path,
    ),
    // AC-8 "Used by N agents" count, grouped by repo.
    repoIdx: index('project_context_attachments_repo_idx').on(t.repoId),
  }),
);
