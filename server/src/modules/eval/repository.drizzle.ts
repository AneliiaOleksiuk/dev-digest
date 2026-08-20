import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type {
  EvalBatchRow,
  EvalBatchWrite,
  EvalCaseInsert,
  EvalCaseOwnerKind,
  EvalCaseRow,
  EvalCaseUpdate,
  EvalFindingContext,
  EvalPrFileRow,
  EvalRepository,
  EvalRunInsert,
  EvalRunRow,
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

  // ---- batch runner (WI7) -------------------------------------------------

  /** The ONLY write to `eval_batches`/`eval_runs` for a run — see
   *  `EvalBatchWrite`'s doc comment (repository.ts) for why the batch itself
   *  is a single insert of an already-closed row rather than an
   *  open-with-placeholder-then-update. A batch still running therefore has
   *  no row at all, so it can never be `listBatchesForOwner`'s `batches[0]`
   *  (or appear in any other read) until this call actually happens.
   *
   *  Both inserts happen inside one `db.transaction` (Phase C fix-loop
   *  iteration 2, Minor finding #1) — a throw partway through (e.g. an FK
   *  violation on one of the `runs` inserts) rolls back the batch insert too,
   *  so a committed batch's `cases_total` and its persisted `eval_runs` row
   *  count can never diverge. See `EvalBatchWrite`'s doc comment for the one
   *  risk this transaction does NOT cover (spend from cases that ran before
   *  this call, lost on a crash before the transaction starts). */
  async insertBatchWithRuns(
    batch: EvalBatchWrite,
    runs: Omit<EvalRunInsert, 'batchId'>[],
  ): Promise<{ batch: EvalBatchRow; runs: EvalRunRow[] }> {
    return this.db.transaction(async (tx) => {
      const [batchRow] = await tx
        .insert(t.evalBatches)
        .values({
          workspaceId: batch.workspaceId,
          ownerKind: batch.ownerKind,
          ownerId: batch.ownerId,
          agentVersion: batch.agentVersion,
          provider: batch.provider,
          model: batch.model,
          skillsFingerprint: batch.skillsFingerprint,
          ranAt: batch.ranAt,
          status: batch.status,
          casesTotal: batch.casesTotal,
          casesPassed: batch.casesPassed,
          casesFailed: batch.casesFailed,
          recall: batch.recall,
          precision: batch.precision,
          citationAccuracy: batch.citationAccuracy,
          recallCases: batch.recallCases,
          precisionCases: batch.precisionCases,
          citationCases: batch.citationCases,
          findingsTotal: batch.findingsTotal,
          durationMs: batch.durationMs,
          costUsd: batch.costUsd,
          error: batch.error,
        })
        .returning();
      const closedBatch = toBatchRow(batchRow!);

      const runRows: EvalRunRow[] = [];
      for (const r of runs) {
        const [row] = await tx
          .insert(t.evalRuns)
          .values({
            caseId: r.caseId,
            batchId: closedBatch.id,
            actualOutput: r.actualOutput as object | null,
            pass: r.pass,
            recall: r.recall,
            precision: r.precision,
            citationAccuracy: r.citationAccuracy,
            findingsTotal: r.findingsTotal,
            durationMs: r.durationMs,
            costUsd: r.costUsd,
            error: r.error,
          })
          .returning();
        runRows.push(toRunRow(row!));
      }

      return { batch: closedBatch, runs: runRows };
    });
  }

  // ---- read APIs (WI8) -----------------------------------------------------

  async getBatchById(workspaceId: string, id: string): Promise<EvalBatchRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalBatches)
      .where(and(eq(t.evalBatches.workspaceId, workspaceId), eq(t.evalBatches.id, id)));
    return row ? toBatchRow(row) : undefined;
  }

  async listBatchesForOwner(
    workspaceId: string,
    ownerId: string,
    limit?: number,
  ): Promise<EvalBatchRow[]> {
    const query = this.db
      .select()
      .from(t.evalBatches)
      .where(and(eq(t.evalBatches.workspaceId, workspaceId), eq(t.evalBatches.ownerId, ownerId)))
      .orderBy(desc(t.evalBatches.ranAt));
    const rows = limit !== undefined ? await query.limit(limit) : await query;
    return rows.map(toBatchRow);
  }

  async listRunsForBatch(batchId: string): Promise<{ run: EvalRunRow; caseName: string | null }[]> {
    const rows = await this.db
      .select({ run: t.evalRuns, caseName: t.evalCases.name })
      .from(t.evalRuns)
      .leftJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(eq(t.evalRuns.batchId, batchId));
    return rows.map((r) => ({ run: toRunRow(r.run), caseName: r.caseName ?? null }));
  }

  async listDashboardOwnerIds(
    workspaceId: string,
  ): Promise<{ ownerKind: EvalCaseOwnerKind; ownerId: string }[]> {
    const [caseOwners, batchOwners] = await Promise.all([
      this.db
        .selectDistinct({ ownerKind: t.evalCases.ownerKind, ownerId: t.evalCases.ownerId })
        .from(t.evalCases)
        .where(eq(t.evalCases.workspaceId, workspaceId)),
      this.db
        .selectDistinct({ ownerKind: t.evalBatches.ownerKind, ownerId: t.evalBatches.ownerId })
        .from(t.evalBatches)
        .where(eq(t.evalBatches.workspaceId, workspaceId)),
    ]);
    const seen = new Map<string, { ownerKind: EvalCaseOwnerKind; ownerId: string }>();
    for (const o of [...caseOwners, ...batchOwners]) {
      seen.set(`${o.ownerKind}:${o.ownerId}`, { ownerKind: o.ownerKind as EvalCaseOwnerKind, ownerId: o.ownerId });
    }
    return [...seen.values()];
  }

  async countCasesForOwner(workspaceId: string, ownerId: string): Promise<number> {
    const rows = await this.db
      .select({ id: t.evalCases.id })
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerId, ownerId)));
    return rows.length;
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

type EvalBatchSelectRow = typeof t.evalBatches.$inferSelect;

function toBatchRow(row: EvalBatchSelectRow): EvalBatchRow {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    ownerKind: row.ownerKind as EvalCaseOwnerKind,
    ownerId: row.ownerId,
    agentVersion: row.agentVersion,
    provider: row.provider,
    model: row.model,
    skillsFingerprint: row.skillsFingerprint,
    ranAt: row.ranAt,
    status: row.status as 'completed' | 'failed',
    casesTotal: row.casesTotal,
    casesPassed: row.casesPassed,
    casesFailed: row.casesFailed,
    recall: row.recall,
    precision: row.precision,
    citationAccuracy: row.citationAccuracy,
    recallCases: row.recallCases,
    precisionCases: row.precisionCases,
    citationCases: row.citationCases,
    findingsTotal: row.findingsTotal,
    durationMs: row.durationMs,
    costUsd: row.costUsd,
    error: row.error,
  };
}

type EvalRunSelectRow = typeof t.evalRuns.$inferSelect;

function toRunRow(row: EvalRunSelectRow): EvalRunRow {
  return {
    id: row.id,
    caseId: row.caseId,
    batchId: row.batchId,
    ranAt: row.ranAt,
    actualOutput: row.actualOutput,
    pass: row.pass,
    recall: row.recall,
    precision: row.precision,
    citationAccuracy: row.citationAccuracy,
    findingsTotal: row.findingsTotal,
    durationMs: row.durationMs,
    costUsd: row.costUsd,
    error: row.error,
  };
}
