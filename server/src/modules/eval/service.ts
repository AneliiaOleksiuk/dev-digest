import { z } from 'zod';
import { EvalCaseInputMeta } from '@devdigest/shared';
import type { EvalCaseInput, EvalCaseRecord, EvalExpectation } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { AgentsService } from '../agents/service.js';
import {
  assertDiffWithinCap,
  buildDiffText,
  buildExpectationEntry,
  deriveExpectationKind,
  mapRowToRecord,
} from './helpers.js';
import type { EvalCaseUpdate, EvalRepository } from './repository.js';

/** Partial update payload for `PATCH /eval-cases/:id` — every field of
 *  `EvalCaseInput` optional. */
export type EvalCaseInputPatch = Partial<EvalCaseInput>;

/**
 * Eval module application service. Depends on the repository PORT (never a
 * concrete Drizzle class) plus `Container`, used only to construct sibling
 * modules' `Service` classes for cross-module reads (`AgentsService`) —
 * exactly the pattern `modules/brief/sources.node.ts` uses to construct
 * `BlastService`, and `modules/blast/service.ts` itself uses `Container` the
 * same way for its own facade calls. Never imports `AgentsRepository`
 * directly (onion-architecture "Cross-module reads" rule).
 */
export class EvalService {
  constructor(
    private repo: EvalRepository,
    private container: Container,
  ) {}

  async listForAgent(workspaceId: string, agentId: string): Promise<EvalCaseRecord[]> {
    // Tenancy first (AC-42), then confirm the agent itself is in this
    // workspace before listing — a foreign-workspace agent id 404s instead
    // of silently returning an empty list.
    await this.assertOwnerAgent(workspaceId, agentId);
    const rows = await this.repo.listForAgent(workspaceId, agentId);
    return rows.map(mapRowToRecord);
  }

  async getById(workspaceId: string, id: string): Promise<EvalCaseRecord | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? mapRowToRecord(row) : undefined;
  }

  async create(workspaceId: string, input: EvalCaseInput): Promise<EvalCaseRecord> {
    // AC-43 — the worst IDOR surface: `owner_id` is a bare string in the
    // contract. Resolved through AgentsService, never a raw id comparison.
    await this.assertOwnerAgent(workspaceId, input.owner_id);
    assertDiffWithinCap(input.input_diff);
    const row = await this.repo.insert({
      workspaceId,
      // D-9 — 'agent' only at the API level this iteration; the route's own
      // body schema already restricts owner_kind to the literal 'agent'.
      ownerKind: 'agent',
      ownerId: input.owner_id,
      name: input.name,
      inputDiff: input.input_diff,
      inputFiles: input.input_files ?? null,
      inputMeta: input.input_meta ?? null,
      expectedOutput: input.expected_output,
      notes: input.notes ?? null,
    });
    return mapRowToRecord(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: EvalCaseInputPatch,
  ): Promise<EvalCaseRecord | undefined> {
    if (patch.owner_id !== undefined) await this.assertOwnerAgent(workspaceId, patch.owner_id);
    if (patch.input_diff !== undefined) assertDiffWithinCap(patch.input_diff);

    const values: EvalCaseUpdate = {
      ...(patch.owner_id !== undefined ? { ownerId: patch.owner_id } : {}),
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.input_diff !== undefined ? { inputDiff: patch.input_diff } : {}),
      ...(patch.input_files !== undefined ? { inputFiles: patch.input_files } : {}),
      ...(patch.input_meta !== undefined ? { inputMeta: patch.input_meta } : {}),
      ...(patch.expected_output !== undefined ? { expectedOutput: patch.expected_output } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    };
    const row = await this.repo.update(workspaceId, id, values);
    return row ? mapRowToRecord(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /** AC-43's gate: `owner_id` must name a real agent IN THIS WORKSPACE.
   *  404s (never a 403-with-detail — that would leak cross-tenant existence)
   *  when it doesn't. */
  private async assertOwnerAgent(workspaceId: string, agentId: string): Promise<void> {
    const agents = new AgentsService(this.container);
    const agent = await agents.get(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
  }

  /**
   * WI5 — one-click "create case from finding". Every field beyond an
   * optional `name` is derived server-side from the finding/review/pull;
   * refuses and writes nothing on any of: cross-workspace finding (404),
   * an undecided finding, a review with no `agent_id`, or a file with no
   * stored patch.
   */
  async createFromFinding(
    workspaceId: string,
    findingId: string,
    name: string | null | undefined,
  ): Promise<EvalCaseRecord> {
    const ctx = await this.repo.getFindingContext(findingId);
    // AC-5 — a finding outside the caller's workspace 404s, same as a
    // finding that doesn't exist at all (don't leak cross-tenant existence).
    if (!ctx || ctx.pull.workspaceId !== workspaceId) {
      throw new NotFoundError('Finding not found');
    }
    const { finding, review, pull } = ctx;

    // AC-3/D-7 — server-derived, only. A pending finding (neither timestamp
    // set) refuses rather than guessing.
    const kind = deriveExpectationKind(finding);
    if (!kind) {
      throw new AppError(
        'finding_not_decided',
        'Finding has not been accepted or dismissed yet',
        422,
      );
    }

    // AC-6 — owner = the review's agent_id; a null agent_id refuses rather
    // than guessing an owner.
    if (!review.agentId) {
      throw new AppError(
        'review_missing_agent',
        "This finding's review has no agent — cannot determine a case owner",
        422,
      );
    }

    // AC-7/AC-8 — inputs pinned at creation, never re-derived later. No
    // pr_files row with a non-null patch → refuse, never store an empty diff.
    const prFile = await this.repo.getPrFileByPath(pull.id, finding.file);
    if (!prFile?.patch) {
      throw new AppError(
        'no_diff_available',
        `No stored patch for '${finding.file}' — cannot pin an eval case`,
        422,
      );
    }

    const entry = buildExpectationEntry(finding);
    const expectedOutput: EvalExpectation = {
      version: 1,
      must_find: kind === 'must_find' ? [entry] : [],
      must_not_flag: kind === 'must_not_flag' ? [entry] : [],
    };

    // AC-46 — this write path built its own diff via `buildDiffText` instead
    // of taking `input_diff` straight from a validated request body (like
    // `create`/`update` do), so it must cap-check that diff itself before
    // the insert — otherwise a PR-author-controlled `pr_files.patch` (plain
    // `text`, no length bound) reaches storage uncapped, then Phase C's LLM
    // prompt uncapped after it.
    const inputDiff = buildDiffText([{ path: finding.file, patch: prFile.patch }]);
    assertDiffWithinCap(inputDiff);

    // `input_meta`/`input_files` are server-constructed here rather than
    // pulled from a zod-validated request body (`create`/`update` get that
    // validation for free from the route's `EvalCaseCreateBody`/
    // `EvalCaseUpdateBody` schema, now that both fields are typed instead of
    // `z.unknown()`) — so this call site validates its own constructed
    // values explicitly, the same shape guarantee the other two paths get
    // from the route boundary.
    const inputFiles = z.array(z.string()).parse([finding.file]);
    const inputMeta = EvalCaseInputMeta.parse({ title: pull.title, body: pull.body ?? '' });

    const row = await this.repo.insert({
      workspaceId,
      ownerKind: 'agent',
      ownerId: review.agentId,
      name: name ?? finding.title,
      inputDiff,
      inputFiles,
      inputMeta,
      expectedOutput,
      notes: null,
    });
    return mapRowToRecord(row);
  }
}
