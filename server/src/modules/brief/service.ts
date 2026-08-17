import { z } from 'zod';
import {
  ReviewFocusItem,
  Risk,
  RiskSeverity,
  type BriefRecord,
  type BriefResponse,
  type BriefTimelineEntry,
  type BriefTimelineResponse,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ConflictError, NotFoundError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { extractReferences, renderIntentBlock, specPathsFrom, toIntentDiffSummary } from '../reviews/intent-inputs.js';
import { MAX_SPEC_FILES, MAX_TIMELINE_ENTRIES } from './constants.js';
import { fitBriefToBudget } from './budget.js';
import { groundBrief } from './grounding.js';
import type { BriefSections, BriefSpecFileInput } from './prompt.js';
import { buildInputStatus, deriveBriefState, mapRowToRecord, markRiskChanges } from './helpers.js';
import type { BriefPull, BriefRepository } from './repository.js';
import type { BriefSources } from './sources.js';

/** Optional structural log sink — `req.log` satisfies this, same shape
 *  `IntentLogSink`/`OnboardingLogger` already use elsewhere. Never logs diff
 *  bodies, spec-file contents, the assembled input, or the raw response
 *  (AC-41). */
export interface BriefLogSink {
  info(msg: string, data?: unknown): void;
}

/**
 * Module-local response schema for the single structured call (the
 * `IntentClassifierOutput`/`OnboardingLlmResponse` pattern) — reuses the
 * vendored `Risk`/`RiskSeverity`/`ReviewFocusItem` zod schemas directly
 * rather than redeclaring an equivalent shape.
 */
const BriefLlmResponse = z.object({
  what: z.string(),
  why: z.string(),
  risk_level: RiskSeverity,
  risks: z.array(Risk),
  review_focus: z.array(ReviewFocusItem),
});

export class BriefService {
  /** E-5 — one in-flight generation per (prId, headSha). In-process only, no
   *  multi-replica safety (`server/AGENTS.md`'s already-documented
   *  single-API-process assumption). The composite PK (WI2) makes the ROW
   *  idempotent (replace-not-append); this map is the actual SPEND guard —
   *  it does not prevent two truly concurrent processes from both paying for
   *  a call, only two concurrent requests within this one process. */
  private inFlight = new Map<string, Promise<BriefResponse>>();

  constructor(
    private repo: BriefRepository,
    private sources: BriefSources,
    private container: Container,
  ) {}

  /** GET /pulls/:id/brief — always `reused: true`, zero model calls
   *  (AC-1/AC-2/AC-12). Never returns `budget_exceeded`/`failed` — those are
   *  transient generate-only outcomes that are never persisted. */
  async getBrief(workspaceId: string, prId: string): Promise<BriefResponse> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const [currentRow, latestRow] = await Promise.all([
      this.repo.getBrief(prId, pull.headSha),
      this.repo.getLatestBrief(prId),
    ]);
    const { state, record, reason } = deriveBriefState(currentRow, latestRow);
    return { state, current_head_sha: pull.headSha, record, reused: true, reason };
  }

  /** POST /pulls/:id/brief/generate — the confirmed generation. */
  async generate(
    workspaceId: string,
    prId: string,
    input: { headSha: string; force?: boolean },
    log?: BriefLogSink,
  ): Promise<BriefResponse> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    // AC-16/E-6 — capture pull.headSha ONCE (above) and refuse any other
    // requested SHA before any further work, zero calls.
    if (input.headSha !== pull.headSha) {
      throw new ConflictError(
        `Requested head_sha (${input.headSha}) is not this PR's current head (${pull.headSha}) — a brief can only be generated for the current commit.`,
      );
    }

    if (!input.force) {
      const existing = await this.repo.getBrief(prId, pull.headSha);
      if (existing) {
        const record = mapRowToRecord(existing);
        if (record) {
          return { state: 'current', current_head_sha: pull.headSha, record, reused: true, reason: null };
        }
        // Corrupted existing row — fall through and regenerate.
      }
    }

    const key = `${prId}:${pull.headSha}`;
    const inFlight = this.inFlight.get(key);
    if (inFlight) return inFlight;

    const task = this.runGeneration(workspaceId, pull, log).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, task);
    return task;
  }

  private async runGeneration(
    workspaceId: string,
    pull: BriefPull,
    log?: BriefLogSink,
  ): Promise<BriefResponse> {
    const repoRow = await this.repo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');

    // ---- AC-6/E-3 — read persisted intent, never classify. A missing or
    // SHA-mismatched record degrades and is recorded as unresolved; per D-10
    // this also empties the spec-file input, since those paths come from
    // the intent record's own resolved sources[]. ----
    const intentRecord = await this.repo.getIntentRecord(pull.id);
    const intentStatus: 'used' | 'missing' | 'stale' =
      !intentRecord ? 'missing' : intentRecord.head_sha !== pull.headSha ? 'stale' : 'used';
    const intentBlock = intentStatus === 'used' && intentRecord ? renderIntentBlock(intentRecord) : null;

    // ---- AC-5/E-14/E-15 — resolved spec paths, re-read fresh through the
    // sources adapter's containment-guarded reader. ----
    const specRefs = intentStatus === 'used' && intentRecord ? specPathsFrom(intentRecord).slice(0, MAX_SPEC_FILES) : [];
    const specFiles: BriefSpecFileInput[] = [];
    const specFilesUsed: string[] = [];
    const specFilesUnresolved: string[] = [];
    for (const ref of specRefs) {
      const text = repoRow.clonePath ? await this.sources.readSpecFile(repoRow.clonePath, ref) : null;
      if (text == null) {
        specFilesUnresolved.push(ref);
        continue;
      }
      specFiles.push({ ref, text });
      specFilesUsed.push(ref);
    }

    // ---- AC-7/E-4 — blast module's own composed output, never repoIntel
    // directly, never a model call. ----
    const blast = await this.sources.getBlastSummary(workspaceId, pull.id);
    const blastSummaryLine =
      blast.status === 'full'
        ? blast.summary
        : `${blast.summary} (${blast.status}${blast.reason ? `: ${blast.reason}` : ''})`;

    // ---- AC-4 — linked issue resolved through the same reference-extraction
    // path the intent classifier uses (never a second fetch mechanism). ----
    const refs = extractReferences(pull.body ?? '');
    const issueNumber = refs.issueNumbers[0];
    let linkedIssueText: string | null = null;
    let linkedIssueStatus: 'used' | 'unresolved' | 'not_referenced' = 'not_referenced';
    if (issueNumber != null) {
      linkedIssueText = await this.sources.fetchLinkedIssue(repoRow, issueNumber);
      linkedIssueStatus = linkedIssueText != null ? 'used' : 'unresolved';
    }

    // ---- AC-8 — diff data reaches this call only as stats + hunk headers
    // (IntentDiffSummary has no body field — a signature-level guarantee).
    // The FULL diff is kept for grounding (E-10). ----
    const diff = await this.sources.loadDiff(workspaceId, pull, repoRow);
    const diffSummary = toIntentDiffSummary(diff);

    const sections: BriefSections = {
      prTitle: pull.title,
      intentBlock,
      blastSummaryLine,
      specFiles,
      linkedIssueText,
      diffFiles: diffSummary.files,
    };

    const fit = fitBriefToBudget(sections, (text) => this.container.tokenizer.count(text));
    if (fit.floorExceeded) {
      log?.info('brief: generation skipped — floor alone exceeds the input budget, zero calls made', {
        prId: pull.id,
        headSha: pull.headSha,
        outcome: 'budget_exceeded',
      });
      return {
        state: 'budget_exceeded',
        current_head_sha: pull.headSha,
        record: null,
        reused: false,
        reason: 'The composed inputs alone exceed the 8,000-token budget — no call was made and nothing was charged.',
      };
    }

    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'risk_brief');

    let result;
    try {
      const llm = await this.container.llm(provider);
      // ONE completeStructured call — never `complete`, never a second call,
      // no manual retry loop beyond the adapter's own retries (AC-3).
      // `timeoutMs` intentionally unset — inherits the adapters'
      // DEFAULT_TIMEOUT (60s); Q-2 (latency target) deliberately unset here.
      result = await llm.completeStructured({
        model,
        schema: BriefLlmResponse,
        schemaName: 'PrBrief',
        messages: fit.messages,
        sessionId: `${repoRow.owner}/${repoRow.name}:brief:${pull.headSha}`,
      });
    } catch (err) {
      // Covers a throwing provider AND a response that still fails schema
      // validation after the adapter's own retries (AC-42) — one catch.
      // Persists nothing; any prior row for this SHA is left untouched.
      log?.info('brief: generation failed', {
        prId: pull.id,
        headSha: pull.headSha,
        outcome: 'failed',
        err: (err as Error).message,
      });
      return {
        state: 'failed',
        current_head_sha: pull.headSha,
        record: null,
        reused: false,
        reason: 'The last generation attempt failed. Any previously stored brief for this commit is unchanged.',
      };
    }

    const grounded = groundBrief(result.data, diff);

    const inputStatus = buildInputStatus({
      intentStatus,
      blastStatus: blast.status,
      changedFileCount: diffSummary.files.length,
      specFilesUsed,
      specFilesUnresolved,
      linkedIssueStatus,
      droppedInputs: fit.droppedInputs,
    });

    const storedJson = {
      what: grounded.brief.what,
      why: grounded.brief.why,
      risk_level: grounded.brief.risk_level,
      risks: grounded.brief.risks,
      review_focus: grounded.brief.review_focus,
      input_status: {
        intent_status: inputStatus.intent_status,
        blast_status: inputStatus.blast_status,
        changed_file_count: inputStatus.changed_file_count,
        spec_files_used: inputStatus.spec_files_used,
        spec_files_unresolved: inputStatus.spec_files_unresolved,
        linked_issue_status: inputStatus.linked_issue_status,
      },
    };

    const savedRow = await this.repo.upsertBrief(pull.id, pull.headSha, {
      json: storedJson,
      provider,
      model: result.model,
      inputTokens: fit.inputTokens,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
      droppedRiskRefs: grounded.droppedRiskRefs,
      droppedFocusItems: grounded.droppedFocusItems,
      droppedInputs: fit.droppedInputs,
    });

    // Outcome log (AC-41): ids, SHAs, counts, model, tokens, cost — NEVER
    // diff bodies, spec-file contents, the assembled input, or the raw
    // response body.
    log?.info('brief: generation completed', {
      prId: pull.id,
      headSha: pull.headSha,
      inputTokens: fit.inputTokens,
      droppedInputsCount: fit.droppedInputs.length,
      droppedRiskRefs: grounded.droppedRiskRefs,
      droppedFocusItems: grounded.droppedFocusItems,
      provider,
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
    });

    const record = mapRowToRecord(savedRow);
    if (!record) {
      // Defensive only — the row we just wrote should always re-parse.
      return {
        state: 'failed',
        current_head_sha: pull.headSha,
        record: null,
        reused: false,
        reason: 'The generated brief could not be re-read after saving. Please try again.',
      };
    }
    return { state: 'current', current_head_sha: pull.headSha, record, reused: false, reason: null };
  }

  /** GET /pulls/:id/brief/timeline — zero model calls (AC-14/AC-15). */
  async getTimeline(workspaceId: string, prId: string): Promise<BriefTimelineResponse> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const [rows, commitCount] = await Promise.all([
      this.repo.listBriefs(prId, MAX_TIMELINE_ENTRIES),
      this.repo.countCommits(prId),
    ]);
    const records = rows.map(mapRowToRecord).filter((r): r is BriefRecord => r !== null);

    const entries: BriefTimelineEntry[] = markRiskChanges(records).map((r) => ({
      head_sha: r.head_sha,
      generated_at: r.generated_at,
      risk_level: r.risk_level,
      is_current_head: r.head_sha === pull.headSha,
      risk_changed: r.risk_changed,
      record: r,
    }));

    return { entries, brief_count: records.length, commit_count: commitCount };
  }
}
