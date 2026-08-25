import type { Container } from '../../platform/container.js';
import type { UnifiedDiff } from '@devdigest/shared';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import * as schema from '../../db/schema.js';
import type { ReviewRepository, PullRow } from './repository.js';

/**
 * Load the unified diff for a PR. Prefers a real `git diff base...head`; falls
 * back to assembling a synthetic unified diff from the persisted pr_files
 * patches (so the reviewer works even before a clone completes / in tests).
 */
async function loadDiffUncached(
  container: Container,
  repo: ReviewRepository,
  workspaceId: string,
  pull: PullRow,
  repoRow: typeof schema.repos.$inferSelect,
): Promise<UnifiedDiff> {
  try {
    const diff = await container.git.diff(
      { owner: repoRow.owner, name: repoRow.name },
      pull.base,
      pull.headSha,
    );
    if (diff.files.length > 0) return diff;
  } catch {
    /* fall through to pr_files reconstruction */
  }
  return diffFromPrFiles(repo, pull.id);
}

// ---- Memoization (L07) -----------------------------------------------------
// Multi-agent batches call `loadDiff` ONCE PER AGENT (run-executor.ts's
// RunLogger fan-out requires a single-element jobs array per `executeRuns`
// call — see `multi-agent-service.ts`), which would otherwise reload/re-diff
// the SAME PR N times concurrently. Keyed by `${pull.id}:${pull.headSha}` so
// a head-SHA change (new commits pushed mid-batch) always misses. Bounded
// (oldest-out) and small — this is a request-coalescing cache, not a
// correctness-critical store; a cold miss just re-does the (idempotent) load.
const MAX_DIFF_CACHE_ENTRIES = 16;
const diffCache = new Map<string, Promise<UnifiedDiff>>();

function diffCacheKey(pull: PullRow): string {
  return `${pull.id}:${pull.headSha}`;
}

export async function loadDiff(
  container: Container,
  repo: ReviewRepository,
  workspaceId: string,
  pull: PullRow,
  repoRow: typeof schema.repos.$inferSelect,
): Promise<UnifiedDiff> {
  const key = diffCacheKey(pull);
  const cached = diffCache.get(key);
  if (cached) return cached;

  const promise = loadDiffUncached(container, repo, workspaceId, pull, repoRow);
  diffCache.set(key, promise);
  // Never let a failed load poison the cache for a subsequent (potentially
  // successful, e.g. after a transient git error) retry.
  promise.catch(() => diffCache.delete(key));

  if (diffCache.size > MAX_DIFF_CACHE_ENTRIES) {
    const oldestKey = diffCache.keys().next().value;
    if (oldestKey !== undefined && oldestKey !== key) diffCache.delete(oldestKey);
  }

  return promise;
}

/** Test-only: reset the in-memory diff memoization between test cases. */
export function resetDiffCache(): void {
  diffCache.clear();
}

/** Reconstruct a UnifiedDiff from persisted pr_files patches. */
export async function diffFromPrFiles(repo: ReviewRepository, prId: string): Promise<UnifiedDiff> {
  const files = await repo.getPrFiles(prId);
  const parts: string[] = [];
  for (const f of files) {
    if (!f.patch) continue;
    parts.push(`diff --git a/${f.path} b/${f.path}`);
    parts.push(`--- a/${f.path}`);
    parts.push(`+++ b/${f.path}`);
    parts.push(f.patch);
  }
  return parseUnifiedDiff(parts.join('\n'));
}
