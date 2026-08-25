import type { FindingActionKind, MemorySource } from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { Container } from '../../platform/container.js';
import type { FindingRow, PullRow, ReviewRepository, ReviewRow } from './repository.js';
import { findingRowToDto, type ReviewDtoFinding } from './helpers.js';

interface FindingContext {
  finding: FindingRow;
  review: ReviewRow;
  pull: PullRow;
}

/**
 * Finding actions: accept / dismiss / learn (L07, SPEC-04 adds `learn`).
 * These decisions are the dataset later lessons build on (eval cases from
 * accept/dismiss/learn, etc.). `reply` (`FindingActionKind`'s fourth member)
 * is out of scope per this feature's Open Questions (OQ-7).
 */
export async function actOnFinding(
  repo: ReviewRepository,
  agents: Container['agentsRepo'],
  workspaceId: string,
  findingId: string,
  action: FindingActionKind,
): Promise<{ finding?: ReviewDtoFinding; memory_id?: string }> {
  const ctx = await repo.findingContext(findingId);
  if (!ctx || ctx.pull.workspaceId !== workspaceId) {
    throw new NotFoundError('Finding not found');
  }

  switch (action) {
    case 'accept': {
      const row = await repo.setFindingAccepted(findingId, new Date());
      return { finding: findingRowToDto(row!) };
    }
    case 'dismiss': {
      const row = await repo.setFindingDismissed(findingId, new Date());
      return { finding: findingRowToDto(row!) };
    }
    case 'learn': {
      const memoryId = await learnFromFinding(repo, agents, ctx);
      return { memory_id: memoryId };
    }
    default:
      throw new AppError('invalid_action', `Action '${action}' is not available in the starter`, 400);
  }
}

/** Markdown content for the memory row — title + rationale + suggestion,
 *  verbatim (no paraphrase), so the learned memory is traceable back to
 *  exactly what the agent reported. */
function buildMemoryContent(finding: { title: string; rationale: string; suggestion: string | null }): string {
  const parts = [finding.title, finding.rationale];
  if (finding.suggestion) parts.push(`Suggestion: ${finding.suggestion}`);
  return parts.join('\n\n');
}

/**
 * "Learn → memory" (AC-39). Additive — never sets `accepted_at`/
 * `dismissed_at` on the finding. Idempotent: learning the same finding
 * twice returns the SAME `memory_id`, no second row — enforced at the DB
 * level via `memory.learned_finding_id`'s unique index (fix-loop iteration
 * 1; `repo.insertMemory` re-fetches on a concurrent-race unique violation,
 * see `knowledge.repo.ts`), not just this app-level check-then-insert.
 * Whitelists every field it copies from the finding/PR (never spreads a
 * client-supplied object — this action's only input is the `:id` route
 * param, so there is nothing client-supplied to spread anyway) and calls the
 * embedder NEVER, not even conditionally.
 */
async function learnFromFinding(
  repo: ReviewRepository,
  agents: Container['agentsRepo'],
  ctx: FindingContext,
): Promise<string> {
  const existing = await repo.findMemoryByLearnedFinding(ctx.pull.workspaceId, ctx.finding.id);
  if (existing) return existing.id;

  const agentName = ctx.review.agentId
    ? ((await agents.getById(ctx.pull.workspaceId, ctx.review.agentId))?.name ?? 'unknown agent')
    : 'unknown agent';
  // Human-readable provenance only (PR + file:line + agent name) — no
  // machine-readable token needed anymore; `learnedFindingId` is the real
  // idempotency key now (see above).
  const source: MemorySource = {
    pr: ctx.pull.number,
    context: `${ctx.finding.file}:${ctx.finding.startLine} · ${agentName}`,
  };

  const row = await repo.insertMemory({
    workspaceId: ctx.pull.workspaceId,
    repoId: ctx.pull.repoId,
    scope: 'repo',
    kind: 'learning',
    content: buildMemoryContent(ctx.finding),
    confidence: ctx.finding.confidence,
    sources: [source],
    learnedFindingId: ctx.finding.id,
  });
  return row.id;
}
