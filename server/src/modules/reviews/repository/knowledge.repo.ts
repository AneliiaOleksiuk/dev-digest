import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { MemoryKind, MemoryScope, MemorySource } from '@devdigest/shared';

/**
 * L07 (SPEC-04) — data access for the `Learn → memory` and `Turn into eval
 * case` finding actions. Colocated under `modules/reviews/repository/` (not
 * a new module) — both actions only ever originate from a finding, which
 * this module already owns end to end.
 */

export type MemoryRow = typeof t.memory.$inferSelect;
export type EvalCaseRow = typeof t.evalCases.$inferSelect;
export type EvalCaseOwnerKind = 'skill' | 'agent' | 'finding';

/** Postgres `unique_violation` (23505) — the `postgres` driver surfaces this
 *  as `.code` on the thrown error. Used to turn a DB-level uniqueness
 *  constraint into a real idempotency guarantee (fix-loop iteration 1):
 *  a concurrent double-submit races past the app-level SELECT-then-INSERT
 *  check, hits the constraint instead of creating a duplicate row, and the
 *  caller re-fetches the row the other request just committed. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505';
}

// ---- memory (Learn → memory, AC-39) ----------------------------------------

/** Insert one `memory` row. `embedding` is ALWAYS null here — this action
 *  never calls the embedder, not even conditionally (Rec-6 / this repo's
 *  EMBEDDINGS_ENABLED convention: zero embedder calls unless a caller
 *  explicitly opts in, which this action never does).
 *
 *  `learnedFindingId`, when provided, is the idempotency key for a Learn
 *  action (backed by `memory_learned_finding_uq`, a plain unique index — see
 *  the schema comment for why nullable + plain, not partial, is correct
 *  here). On a race (two concurrent Learn calls for the same finding), the
 *  losing insert hits the unique violation and this function re-fetches +
 *  returns the row the winner just committed, instead of throwing/duplicating. */
export async function insertMemory(
  db: Db,
  values: {
    workspaceId: string;
    repoId: string | null;
    scope: MemoryScope;
    kind: MemoryKind;
    content: string;
    confidence: number | null;
    sources: MemorySource[];
    learnedFindingId?: string | null;
  },
): Promise<MemoryRow> {
  try {
    const [row] = await db
      .insert(t.memory)
      .values({
        workspaceId: values.workspaceId,
        repoId: values.repoId,
        scope: values.scope,
        kind: values.kind,
        content: values.content,
        embedding: null,
        confidence: values.confidence,
        sources: values.sources,
        learnedFindingId: values.learnedFindingId ?? null,
      })
      .returning();
    return row!;
  } catch (err) {
    if (values.learnedFindingId && isUniqueViolation(err)) {
      const existing = await findMemoryByLearnedFinding(db, values.workspaceId, values.learnedFindingId);
      if (existing) return existing;
    }
    throw err;
  }
}

/**
 * Idempotency lookup (AC-39): a memory row already learned from this exact
 * finding, via the dedicated `learned_finding_id` column — a direct indexed
 * equality lookup, not a scan over `sources[].context` (superseded approach;
 * see the schema comment on `memory.learnedFindingId`).
 */
export async function findMemoryByLearnedFinding(
  db: Db,
  workspaceId: string,
  findingId: string,
): Promise<MemoryRow | undefined> {
  const [row] = await db
    .select()
    .from(t.memory)
    .where(and(eq(t.memory.workspaceId, workspaceId), eq(t.memory.learnedFindingId, findingId)));
  return row;
}

// ---- eval_cases (Turn into eval case) --------------------------------------

/** Idempotency lookup: one eval case per (workspace, owner_kind, owner_id) —
 *  calling the action twice on the same finding returns the existing case. */
export async function findEvalCaseByOwner(
  db: Db,
  workspaceId: string,
  ownerKind: EvalCaseOwnerKind,
  ownerId: string,
): Promise<EvalCaseRow | undefined> {
  const [row] = await db
    .select()
    .from(t.evalCases)
    .where(
      and(
        eq(t.evalCases.workspaceId, workspaceId),
        eq(t.evalCases.ownerKind, ownerKind),
        eq(t.evalCases.ownerId, ownerId),
      ),
    );
  return row;
}

/** Insert one `eval_cases` row. On a race (two concurrent "Turn into eval
 *  case" calls for the same owner), the losing insert hits
 *  `eval_cases_ws_owner_uq` and this function re-fetches + returns the row
 *  the winner just committed, instead of throwing/duplicating — same pattern
 *  as `insertMemory` above. */
export async function insertEvalCase(
  db: Db,
  values: {
    workspaceId: string;
    ownerKind: EvalCaseOwnerKind;
    ownerId: string;
    name: string;
    inputDiff: string | null;
    inputFiles: unknown;
    inputMeta: unknown;
    expectedOutput: unknown;
  },
): Promise<EvalCaseRow> {
  try {
    const [row] = await db
      .insert(t.evalCases)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        name: values.name,
        inputDiff: values.inputDiff,
        inputFiles: values.inputFiles as object | undefined,
        inputMeta: values.inputMeta as object | undefined,
        expectedOutput: values.expectedOutput as object | undefined,
      })
      .returning();
    return row!;
  } catch (err) {
    if (isUniqueViolation(err)) {
      const existing = await findEvalCaseByOwner(db, values.workspaceId, values.ownerKind, values.ownerId);
      if (existing) return existing;
    }
    throw err;
  }
}
