import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type {
  EvalCaseInsert,
  EvalCaseOwnerKind,
  EvalCaseRow,
  EvalCaseUpdate,
  EvalFindingContext,
  EvalPrFileRow,
  EvalRepository,
} from './repository.js';

/**
 * The only file in `modules/eval/` that imports `db/schema` — implements
 * `EvalRepository` (the port) against Postgres via Drizzle.
 */
export class DrizzleEvalRepository implements EvalRepository {
  constructor(private db: Db) {}

  // ---- eval_cases CRUD ------------------------------------------------

  async listForAgent(workspaceId: string, agentId: string): Promise<EvalCaseRow[]> {
    const rows = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerId, agentId)));
    return rows.map(toRow);
  }

  async getById(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)));
    return row ? toRow(row) : undefined;
  }

  async insert(values: EvalCaseInsert): Promise<EvalCaseRow> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        name: values.name,
        inputDiff: values.inputDiff,
        inputFiles: values.inputFiles ?? null,
        inputMeta: values.inputMeta ?? null,
        expectedOutput: values.expectedOutput,
        notes: values.notes ?? null,
      })
      .returning();
    return toRow(row!);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: EvalCaseUpdate,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set({
        ...(patch.ownerId !== undefined ? { ownerId: patch.ownerId } : {}),
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.inputDiff !== undefined ? { inputDiff: patch.inputDiff } : {}),
        ...(patch.inputFiles !== undefined ? { inputFiles: patch.inputFiles } : {}),
        ...(patch.inputMeta !== undefined ? { inputMeta: patch.inputMeta } : {}),
        ...(patch.expectedOutput !== undefined ? { expectedOutput: patch.expectedOutput } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning();
    return row ? toRow(row) : undefined;
  }

  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  // ---- create-from-finding read path -----------------------------------

  /** Re-implements (does not import) the same finding → review → pull join
   *  `modules/reviews/repository.ts`'s `findingContext` performs — the
   *  onion-architecture "Cross-module reads" rule forbids importing another
   *  module's repository.ts/repository.drizzle.ts directly. */
  async getFindingContext(findingId: string): Promise<EvalFindingContext | undefined> {
    const [finding] = await this.db
      .select({
        id: t.findings.id,
        reviewId: t.findings.reviewId,
        file: t.findings.file,
        startLine: t.findings.startLine,
        endLine: t.findings.endLine,
        severity: t.findings.severity,
        category: t.findings.category,
        title: t.findings.title,
        kind: t.findings.kind,
        acceptedAt: t.findings.acceptedAt,
        dismissedAt: t.findings.dismissedAt,
      })
      .from(t.findings)
      .where(eq(t.findings.id, findingId));
    if (!finding) return undefined;

    const [review] = await this.db
      .select({ id: t.reviews.id, agentId: t.reviews.agentId, prId: t.reviews.prId })
      .from(t.reviews)
      .where(eq(t.reviews.id, finding.reviewId));
    if (!review) return undefined;

    const [pull] = await this.db
      .select({
        id: t.pullRequests.id,
        workspaceId: t.pullRequests.workspaceId,
        title: t.pullRequests.title,
        body: t.pullRequests.body,
      })
      .from(t.pullRequests)
      .where(eq(t.pullRequests.id, review.prId));
    if (!pull) return undefined;

    return { finding, review, pull };
  }

  async getPrFileByPath(prId: string, path: string): Promise<EvalPrFileRow | undefined> {
    const [row] = await this.db
      .select({ path: t.prFiles.path, patch: t.prFiles.patch })
      .from(t.prFiles)
      .where(and(eq(t.prFiles.prId, prId), eq(t.prFiles.path, path)));
    return row;
  }
}

type EvalCaseSelectRow = typeof t.evalCases.$inferSelect;

/** `evalCases.ownerKind` is already typed as the `'skill' | 'agent'` DB
 *  text-enum at the schema level (`db/schema/eval.ts`) — this narrows it to
 *  the port's own literal type, not a runtime check. */
function toRow(row: EvalCaseSelectRow): EvalCaseRow {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    ownerKind: row.ownerKind as EvalCaseOwnerKind,
    ownerId: row.ownerId,
    name: row.name,
    inputDiff: row.inputDiff,
    inputFiles: row.inputFiles,
    inputMeta: row.inputMeta,
    expectedOutput: row.expectedOutput,
    notes: row.notes,
  };
}
