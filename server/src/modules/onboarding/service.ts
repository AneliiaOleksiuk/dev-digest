import { z } from 'zod';
import {
  ONBOARDING_SECTION_KINDS,
  Onboarding,
  OnboardingSectionKind,
  type OnboardingGenerationUsage,
  type OnboardingStatus,
  type OnboardingTourResponse,
  type Provider,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { RepoRepository } from '../repos/repository.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import type { IndexState } from '../repo-intel/types.js';
import { collectFacts } from './facts.js';
import { buildOnboardingMessages } from './prompt.js';
import { buildSkeletonSections, deriveStatus, groundAndCapSections, isBelowMinimum } from './helpers.js';
import type { OnboardingRepository, OnboardingRow } from './repository.js';

/**
 * Module-local response schema for the single structured call (AC-4): exactly
 * five sections whose `kind`s equal `ONBOARDING_SECTION_KINDS` IN ORDER — a
 * response that omits, reorders, duplicates or adds a section fails
 * validation before persistence. `OnboardingSection.kind` itself stays
 * `z.string()` in the shared contract (reused as-is); this is the module's
 * own narrowing.
 */
const OnboardingLlmSection = z.object({
  kind: OnboardingSectionKind,
  title: z.string(),
  body: z.string(),
  diagram: z.string().nullish(),
  links: z.array(z.object({ label: z.string(), path: z.string() })),
});

const OnboardingLlmResponse = z.object({
  sections: z
    .array(OnboardingLlmSection)
    .length(ONBOARDING_SECTION_KINDS.length)
    .refine((sections) => sections.every((s, i) => s.kind === ONBOARDING_SECTION_KINDS[i]), {
      message: `sections must be exactly [${ONBOARDING_SECTION_KINDS.join(', ')}], in order`,
    }),
});

/** Minimal logger shape (matches `req.log` / `project-context/service.ts`'s
 *  `WriteLogger`) — avoids a hard pino dependency in this module. */
export interface OnboardingLogger {
  info: (obj: unknown, msg?: string) => void;
}

export class OnboardingService {
  private repos: RepoRepository;
  /** AC-27 — one in-flight generation per repo. In-process only (no
   *  multi-replica safety, `server/AGENTS.md`'s already-documented
   *  single-API-process assumption); a second concurrent request attaches to
   *  the running promise instead of starting a second model call. */
  private inFlight = new Map<string, Promise<OnboardingTourResponse>>();

  constructor(
    private repo: OnboardingRepository,
    private container: Container,
  ) {
    this.repos = new RepoRepository(container.db);
  }

  /** GET /repos/:id/onboarding — serves the stored row, or a model-free
   *  skeleton when none exists yet. NEVER a model call (AC-1). */
  async getTour(workspaceId: string, repoId: string): Promise<OnboardingTourResponse> {
    const repoRow = await this.repos.getById(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');

    const row = await this.repo.getByRepoId(repoId);
    if (row) {
      const indexState = await this.container.repoIntel.getIndexState(repoId);
      return responseFromRow(row, indexState);
    }

    // never_generated — still collect deterministic facts (facade + bounded
    // clone reads, NO model call) so the first-visit skeleton is useful
    // rather than an empty box (AC-22).
    const facts = await collectFacts(this.container, repoId, repoRow.clonePath);
    return {
      sections: buildSkeletonSections(facts),
      status: 'never_generated',
      generated_at: null,
      files_indexed: facts.indexState.filesIndexed,
      index_status: facts.indexState.status,
      index_sha: facts.indexState.lastIndexedSha || null,
      stale: false,
      usage: null,
      reason: 'No onboarding tour has been generated for this repo yet.',
    };
  }

  /** POST /repos/:id/onboarding/generate — the confirmed generation (AC-6).
   *  Attaches to an already-running generation for this repo (AC-27) rather
   *  than starting a second model call. */
  async generate(workspaceId: string, repoId: string, log?: OnboardingLogger): Promise<OnboardingTourResponse> {
    const existing = this.inFlight.get(repoId);
    if (existing) return existing;

    const task = this.runGeneration(workspaceId, repoId, log).finally(() => {
      this.inFlight.delete(repoId);
    });
    this.inFlight.set(repoId, task);
    return task;
  }

  private async runGeneration(
    workspaceId: string,
    repoId: string,
    log?: OnboardingLogger,
  ): Promise<OnboardingTourResponse> {
    const repoRow = await this.repos.getById(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');

    // AC-3/AC-24 — facts come from repoIntel.* reads + bounded clone reads
    // ONLY; never a new index/refresh/resync job, never a `git.sync` call.
    const facts = await collectFacts(this.container, repoId, repoRow.clonePath);
    const indexState = facts.indexState;

    if (isBelowMinimum(facts)) {
      const { status, reason } = deriveStatus(indexState, facts);
      log?.info(
        { repoId, status, filesIndexed: indexState.filesIndexed, indexStatus: indexState.status },
        'onboarding: generation skipped (facts below minimum, zero model calls)',
      );
      return {
        sections: buildSkeletonSections(facts),
        status,
        generated_at: null,
        files_indexed: indexState.filesIndexed,
        index_status: indexState.status,
        index_sha: indexState.lastIndexedSha || null,
        stale: false,
        usage: null,
        reason,
      };
    }

    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'onboarding');
    const messages = await buildOnboardingMessages(facts, repoRow.fullName);

    let result;
    try {
      const llm = await this.container.llm(provider);
      // ONE completeStructured call — never `complete`, never a second call,
      // no manual retry loop beyond the adapter's own `maxRetries` (AC-2).
      // `timeoutMs` intentionally unset — inherits the adapters'
      // `DEFAULT_TIMEOUT` (60s); Q9 (latency target) is deliberately unset,
      // not invented here.
      result = await llm.completeStructured({
        model,
        schema: OnboardingLlmResponse,
        schemaName: 'OnboardingTour',
        messages,
      });
    } catch (err) {
      // Covers a missing provider key (D-13), a throwing provider, and a
      // response that still fails schema validation after the adapter's own
      // retries (AC-20) — all funnel through this ONE catch. Persists
      // nothing: the previous row (if any) survives unchanged (AC-21).
      log?.info(
        { repoId, status: 'llm_failed', err: (err as Error).message },
        'onboarding: generation failed',
      );
      return {
        sections: buildSkeletonSections(facts),
        status: 'llm_failed',
        generated_at: null,
        files_indexed: indexState.filesIndexed,
        index_status: indexState.status,
        index_sha: indexState.lastIndexedSha || null,
        stale: false,
        usage: null,
        reason: 'The last generation attempt failed. The previous tour, if any, is unchanged.',
      };
    }

    const groundedSections = groundAndCapSections(result.data.sections, facts);
    const { status, reason } = deriveStatus(indexState, facts);

    const savedRow = await this.repo.upsert(repoId, {
      json: { sections: groundedSections },
      status,
      provider,
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
      callCount: 1,
      indexSha: indexState.lastIndexedSha || null,
      filesIndexed: indexState.filesIndexed,
      indexStatus: indexState.status,
    });

    // Outcome logging: repo id, status, fact counts/sizes, model, tokens,
    // cost — NEVER file contents, the assembled facts text, or the raw
    // response body (AC-30, `run-executor.ts:271-275`'s rule).
    log?.info(
      {
        repoId,
        status,
        filesIndexed: indexState.filesIndexed,
        indexStatus: indexState.status,
        rankedFileCount: facts.rankedFiles.length,
        droppedForBudgetCount: facts.droppedForBudget.length,
        runLocallySourceCount: facts.runLocallySources.length,
        provider,
        model: result.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: result.costUsd,
      },
      'onboarding: generation completed',
    );

    return responseFromRow(savedRow, indexState);
  }
}

function usageFromRow(row: OnboardingRow): OnboardingGenerationUsage | null {
  if (!row.provider || !row.model) return null;
  return {
    provider: row.provider as Provider,
    model: row.model,
    call_count: row.callCount,
    tokens_in: row.tokensIn ?? 0,
    tokens_out: row.tokensOut ?? 0,
    cost_usd: row.costUsd,
  };
}

function reasonForRow(status: OnboardingStatus, row: OnboardingRow, stale: boolean): string {
  const base =
    status === 'partial_index'
      ? `Generated from a partial index of ${row.filesIndexed ?? 0} files — some files may be missing.`
      : `Generated from a full index of ${row.filesIndexed ?? 0} files.`;
  return stale
    ? `${base} The index has moved since this tour was generated — regenerate for a fresh tour.`
    : base;
}

/** Map a persisted row into the response, re-parsing `json` against the
 *  `Onboarding` contract on read (AC-36) so a corrupted or schema-drifted
 *  row degrades to a status instead of crashing the page (E-15). Staleness
 *  (AC-26) compares the persisted `index_sha` against the CURRENT
 *  `IndexState.lastIndexedSha` — reported, never auto-regenerated. */
function responseFromRow(row: OnboardingRow, indexState: IndexState): OnboardingTourResponse {
  const stale =
    indexState.lastIndexedSha.length > 0 && row.indexSha !== null && row.indexSha !== indexState.lastIndexedSha;

  const parsed = Onboarding.safeParse(row.json);
  if (!parsed.success) {
    return {
      sections: [],
      status: 'llm_failed',
      generated_at: row.generatedAt.toISOString(),
      files_indexed: row.filesIndexed ?? 0,
      index_status: row.indexStatus ?? '',
      index_sha: row.indexSha,
      stale,
      usage: usageFromRow(row),
      reason:
        'The stored onboarding tour could not be read (corrupted or from an older format) — regenerate to fix this.',
    };
  }

  const status = row.status as OnboardingStatus;

  return {
    sections: parsed.data.sections,
    status,
    generated_at: row.generatedAt.toISOString(),
    files_indexed: row.filesIndexed ?? 0,
    index_status: row.indexStatus ?? '',
    index_sha: row.indexSha,
    stale,
    usage: usageFromRow(row),
    reason: reasonForRow(status, row, stale),
  };
}
