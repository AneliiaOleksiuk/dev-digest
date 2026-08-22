import { NotFoundError } from '../../platform/errors.js';
import type { Container } from '../../platform/container.js';
import type { ReviewRepository } from './repository.js';
import { loadDiff } from './diff-loader.js';

/**
 * L07 (SPEC-04) — "Turn into eval case", registered as its OWN route
 * (`POST /findings/:id/eval-case`) — NOT a `FindingActionKind` (that enum has
 * no `'eval-case'` member and none should be added; see `findings.ts` for the
 * accept/dismiss/learn switch this deliberately sits outside of).
 *
 * Same ownership-chain check as `findings.ts`'s actions (finding → review →
 * PR → workspace). Idempotent on (workspace, owner_kind='finding', owner_id):
 * calling this twice on the same finding returns the SAME eval case, never a
 * duplicate. Whitelists every field it copies from the finding/PR/agent —
 * this route's only input is the `:id` param, so there is no client-supplied
 * object to (and this must never) spread into the insert.
 */
export async function createEvalCaseFromFinding(
  repo: ReviewRepository,
  container: Container,
  workspaceId: string,
  findingId: string,
): Promise<{ eval_case_id: string }> {
  const ctx = await repo.findingContext(findingId);
  if (!ctx || ctx.pull.workspaceId !== workspaceId) {
    throw new NotFoundError('Finding not found');
  }

  const existing = await repo.findEvalCaseByOwner(workspaceId, 'finding', findingId);
  if (existing) return { eval_case_id: existing.id };

  const repoRow = await repo.getRepo(ctx.pull.repoId);
  if (!repoRow) throw new NotFoundError('Repo not found');

  // Reuse the existing diff-loading utility (memoized as of WI3) rather than
  // reinventing diff assembly here.
  const diff = await loadDiff(container, repo, workspaceId, ctx.pull, repoRow);

  const agent = ctx.review.agentId
    ? await container.agentsRepo.getById(workspaceId, ctx.review.agentId)
    : undefined;

  const evalCase = await repo.insertEvalCase({
    workspaceId,
    ownerKind: 'finding',
    ownerId: findingId,
    name: `Finding: ${ctx.finding.title}`.slice(0, 200),
    inputDiff: diff.raw,
    inputFiles: diff.files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })),
    inputMeta: {
      agent_id: ctx.review.agentId,
      agent_name: agent?.name ?? null,
      run_id: ctx.review.runId,
      pr_head_sha: ctx.pull.headSha,
    },
    expectedOutput: {
      severity: ctx.finding.severity,
      category: ctx.finding.category,
      file: ctx.finding.file,
      start_line: ctx.finding.startLine,
      end_line: ctx.finding.endLine,
      suggestion: ctx.finding.suggestion,
    },
  });

  return { eval_case_id: evalCase.id };
}
