import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { Intent, IntentSource, PrIntentRecord } from '@devdigest/shared';
import type { PullRow } from '../../../db/rows.js';

const NUL_CHARACTER = String.fromCharCode(0);

/** Postgres text columns reject NUL bytes outright, regardless of encoding —
 *  strip any that slipped in from LLM output before it reaches the DB. Same
 *  fix as `modules/conventions/repository.drizzle.ts`'s `removeNulBytes()`. */
function removeNulBytes(value: string): string {
  return value.split(NUL_CHARACTER).join('');
}
const scrubList = (values: string[]): string[] => values.map(removeNulBytes);
const scrubSources = (sources: IntentSource[]): IntentSource[] =>
  sources.map((s) => ({ ...s, ref: s.ref != null ? removeNulBytes(s.ref) : s.ref }));

// ---- PR lookup (workspace-scoped) -----------------------------------------

export async function getPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<PullRow | undefined> {
  const [row] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  return row;
}

export async function getRepo(
  db: Db,
  repoId: string,
): Promise<typeof t.repos.$inferSelect | undefined> {
  const [row] = await db.select().from(t.repos).where(eq(t.repos.id, repoId));
  return row;
}

export async function getPrFiles(
  db: Db,
  prId: string,
): Promise<(typeof t.prFiles.$inferSelect)[]> {
  return db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
}

/**
 * Record the commit a review just ran against, so the PR list can derive
 * `reviewed` vs `needs_review` (head moved since the last review) vs `stale`.
 */
export async function markReviewed(db: Db, prId: string, sha: string): Promise<void> {
  await db
    .update(t.pullRequests)
    .set({ lastReviewedSha: sha })
    .where(eq(t.pullRequests.id, prId));
}

// ---- intent ---------------------------------------------------------------

/** Everything `upsertIntent` needs beyond the classified `Intent` itself —
 *  the commit it describes and which provider/model produced it. */
export interface UpsertIntentInput extends Intent {
  headSha: string | null;
  provider: string | null;
  model: string | null;
}

/** Every LLM-derived string field NUL-scrubbed before it reaches Postgres —
 *  see `removeNulBytes` above (same fix as `modules/conventions`). */
export async function upsertIntent(db: Db, prId: string, intent: UpsertIntentInput): Promise<void> {
  const values = {
    prId,
    intent: removeNulBytes(intent.intent),
    inScope: scrubList(intent.in_scope),
    outOfScope: scrubList(intent.out_of_scope),
    headSha: intent.headSha,
    confidence: intent.confidence ?? null,
    sources: scrubSources(intent.sources),
    missingContext: scrubList(intent.missing_context),
    riskAreas: scrubList(intent.risk_areas),
    provider: intent.provider,
    model: intent.model,
    classifiedAt: new Date(),
  };
  await db
    .insert(t.prIntent)
    .values(values)
    .onConflictDoUpdate({ target: t.prIntent.prId, set: values });
}

export async function getIntent(db: Db, prId: string): Promise<Intent | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  if (!row) return undefined;
  return {
    intent: row.intent,
    in_scope: row.inScope,
    out_of_scope: row.outOfScope,
    confidence: row.confidence,
    sources: row.sources as IntentSource[],
    missing_context: row.missingContext,
    risk_areas: row.riskAreas,
  };
}

/** Full persisted record, incl. classification metadata for the card/trace
 *  (head_sha for the "stale, re-run?" comparison, provider/model/classified_at
 *  for the freshness badge). */
export async function getIntentRecord(db: Db, prId: string): Promise<PrIntentRecord | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  if (!row) return undefined;
  return {
    pr_id: row.prId,
    intent: row.intent,
    in_scope: row.inScope,
    out_of_scope: row.outOfScope,
    confidence: row.confidence,
    sources: row.sources as IntentSource[],
    missing_context: row.missingContext,
    risk_areas: row.riskAreas,
    head_sha: row.headSha,
    provider: row.provider,
    model: row.model,
    classified_at: row.classifiedAt.toISOString(),
  };
}
