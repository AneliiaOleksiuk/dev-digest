import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type {
  EvalBatchClose,
  EvalBatchInsert,
  EvalBatchRow,
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

  /** Opens with placeholder aggregate fields — `status: 'failed'`, every
   *  count 0, every metric `null` — overwritten by `closeBatch` once the
   *  runner has a real aggregate. Never read back by a caller before
   *  `closeBatch` runs (the service holds the row in memory for that
   *  window), so the placeholder values are never user-visible. */
  async insertBatch(values: EvalBatchInsert): Promise<EvalBatchRow> {
    const [row] = await this.db
      .insert(t.evalBatches)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        agentVersion: values.agentVersion,
        provider: values.provider,
        model: values.model,
        skillsFingerprint: values.skillsFingerprint,
        status: 'failed',
        casesTotal: 0,
        casesPassed: 0,
        casesFailed: 0,
        recall: null,
        precision: null,
        citationAccuracy: null,
        recallCases: 0,
        precisionCases: 0,
        citationCases: 0,
        findingsTotal: null,
        durationMs: null,
        costUsd: null,
        error: null,
      })
      .returning();
    return toBatchRow(row!);
  }

  async closeBatch(id: string, patch: EvalBatchClose): Promise<EvalBatchRow> {
    const [row] = await this.db
      .update(t.evalBatches)
      .set({
        status: patch.status,
        casesTotal: patch.casesTotal,
        casesPassed: patch.casesPassed,
        casesFailed: patch.casesFailed,
        recall: patch.recall,
        recallCases: patch.recallCases,
        precision: patch.precision,
        precisionCases: patch.precisionCases,
        citationAccuracy: patch.citationAccuracy,
        citationCases: patch.citationCases,
        findingsTotal: patch.findingsTotal,
        durationMs: patch.durationMs,
        costUsd: patch.costUsd,
        error: patch.error,
      })
      .where(eq(t.evalBatches.id, id))
      .returning();
    return toBatchRow(row!);
  }

  async insertRun(values: EvalRunInsert): Promise<EvalRunRow> {
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({
        caseId: values.caseId,
        batchId: values.batchId,
        actualOutput: values.actualOutput as object | null,
        pass: values.pass,
        recall: values.recall,
        precision: values.precision,
        citationAccuracy: values.citationAccuracy,
        findingsTotal: values.findingsTotal,
        durationMs: values.durationMs,
        costUsd: values.costUsd,
        error: values.error,
      })
      .returning();
    return toRunRow(row!);
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
