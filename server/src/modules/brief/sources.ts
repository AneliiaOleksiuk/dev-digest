/**
 * The non-DB input port (`BriefSources`) — the single seam through which
 * `BriefService` obtains everything that isn't a row in this module's own
 * tables: the diff, spec-file contents, the blast summary, and the linked
 * issue. Keeps composition (constructing `BlastService`, calling
 * `container.github()`, reading the filesystem) out of `service.ts` entirely
 * (onion boundary — `service.ts` imports no adapter and constructs no other
 * module's service).
 */
import type { BlastRadiusResponse, UnifiedDiff } from '@devdigest/shared';
import type { BriefPull, BriefRepoRow } from './repository.js';

export interface BriefSources {
  /** The full unified diff for the PR (never sent to the model as-is — the
   *  caller narrows it before it reaches the prompt; grounding uses the full
   *  thing, per E-10). */
  loadDiff(workspaceId: string, pull: BriefPull, repoRow: BriefRepoRow): Promise<UnifiedDiff>;

  /** Re-read one spec/plan file fresh from the clone at generation time
   *  (content is never cached — D-10). `null` on any escape/read failure
   *  (E-14/E-15) — never throws. */
  readSpecFile(clonePath: string, ref: string): Promise<string | null>;

  /** The blast module's already-composed output (AC-7) — never a `repoIntel`
   *  call or a model call from this module directly. */
  getBlastSummary(workspaceId: string, prId: string): Promise<BlastRadiusResponse>;

  /** Resolve one linked issue's title+body through the existing GitHub port.
   *  `null` on any failure (missing token, 404, network) — never throws
   *  (E-15's degrade-don't-fail rule, same shape `intent-service.ts` already
   *  uses for this exact call). */
  fetchLinkedIssue(repoRow: BriefRepoRow, issueNumber: number): Promise<string | null>;
}
