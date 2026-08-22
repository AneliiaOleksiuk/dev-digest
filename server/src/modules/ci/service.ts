import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import JSZip from 'jszip';
import type {
  CiExport,
  CiExportInput,
  CiFile,
  CiIngestInput as CiIngestInputType,
  CiInstallation,
  CiRun,
  CiRunFilters,
  CiRunStatus,
} from '@devdigest/shared';
import { CiIngestInput } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import {
  ConflictError,
  ExternalServiceError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../platform/errors.js';
import { AgentsService } from '../agents/service.js';
import type { CiInstallationRow, CiInstallationWithLastRun, CiRepository, CiRunListRow } from './repository.js';
import {
  AGENTS_SUBDIR,
  CI_BRANCH,
  INGEST_TOKEN_BYTES,
  MEMORY_PATH,
  RUNNER_PATH,
  WORKFLOW_PATH,
  WORKFLOW_VERSION,
} from './constants.js';
import { disambiguate, slugify, type RepoRef } from './helpers.js';
import {
  buildManifest,
  emitManifestYaml,
  emitMemoryPlaceholder,
  emitSkillFile,
  assertManifestRoundTrips,
} from './manifest.js';
import { emitWorkflowYaml } from './workflow.js';
import { validateWorkflowOverride } from './workflow-validate.js';
import { previewPlaceholder, readRunnerBundle } from './bundle.js';

/** Structural log sink — `req.log` (pino) satisfies this as-is, same shape
 *  `EvalLogSink`/`IntentLogSink` already use elsewhere. Never logs generated
 *  file contents, the system prompt, skill bodies, the ingest token, its
 *  hash, or the raw request body (AC-74, AC-60, A09) — only repo/agent/
 *  installation/run ids, counts, cost, and outcome. */
export interface CiLogSink {
  info(obj: Record<string, unknown>, msg?: string): void;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `installation.tokenHash` is stored as a hex string (see
 *  `repository.drizzle.ts`) — parse defensively so a corrupt/short stored
 *  value degrades to "auth failed" rather than throwing (A10). */
function hexToBuffer(hex: string): Buffer | null {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return null;
  return Buffer.from(hex, 'hex');
}

/**
 * Constant-time digest comparison (AC-51, A04). `timingSafeEqual` THROWS on a
 * length mismatch rather than returning false — so length is checked and
 * ruled out FIRST, and it is never called on two mismatched-length buffers.
 */
function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function installPrBody(agentName: string): string {
  return [
    `Adds DevDigest's automated review for **${agentName}** to this repository's GitHub Actions.`,
    '',
    'This workflow runs on every pull request, posts findings, and reports the run back to DevDigest.',
    'DevDigest never merges, approves, or requests elevated permissions on its own — review the',
    'workflow file below before merging, the same as any other change to this repository.',
  ].join('\n');
}

function toInstallationContract(row: CiInstallationWithLastRun): CiInstallation {
  return {
    id: row.id,
    agent_id: row.agentId,
    repo: row.repo,
    target_type: row.targetType,
    installed_at: row.installedAt.toISOString(),
    workflow_version: row.workflowVersion,
    agent_version: row.agentVersion,
    ingest_url: row.ingestUrl,
    post_as: row.postAs,
    triggers: row.triggers,
    base: row.baseBranch,
    last_run: row.lastRun
      ? {
          ran_at: row.lastRun.ranAt.toISOString(),
          status: row.lastRun.status as CiRunStatus,
          // Display-only coalesce — `CiInstallation.last_run.findings_count`
          // is a required int (unlike `CiRun.findings_count`, which stays
          // nullable). A failed run's REAL findings_count is null in the DB
          // (AC-58 — never invented at write time); 0 here is only a render
          // default for this summary badge, never a persisted value.
          findings_count: row.lastRun.findingsCount ?? 0,
        }
      : null,
  };
}

function toCiRunContract(row: CiRunListRow): CiRun {
  return {
    id: row.id,
    ci_installation_id: row.ciInstallationId,
    pr_number: row.externalPrNumber,
    ran_at: row.ranAt ? row.ranAt.toISOString() : null,
    status: row.status,
    findings_count: row.findingsCount,
    cost_usd: row.costUsd,
    github_url: row.jobUrl,
    source: row.sourceLabel,
    agent: row.agentName,
    duration_s: row.durationMs != null ? row.durationMs / 1000 : null,
    repo: row.repo,
    head_sha: row.headSha,
    pr_title: row.prTitle,
    agent_id: row.agentId,
    critical: row.critical,
    warning: row.warning,
    suggestion: row.suggestion,
  };
}

/**
 * CI module application service. Depends on the repository PORT (never a
 * concrete Drizzle class) plus `Container`, used only to construct
 * `AgentsService` for cross-module reads (onion-architecture "Cross-module
 * reads" rule — never import `AgentsRepository` directly) and to obtain the
 * workspace's `GitHub` client (`container.github()`, which itself resolves
 * `GITHUB_TOKEN` only through the injected `SecretsProvider` — this file
 * contains zero `process.env` reads, AC-73).
 */
export class CiService {
  constructor(
    private repo: CiRepository,
    private container: Container,
  ) {}

  /**
   * Assemble the exported file set for an agent, in the fixed order AC-9
   * requires: manifest → one file per enabled linked skill (agent order) →
   * memory placeholder → runner bundle (preview-omitted) → workflow. Zero
   * side effects (AC-2): no GitHub call, no DB write, no token minted. Used
   * by the Preview route AS-IS, and by `install`/`exportZip` below as their
   * first step (both then swap the placeholder runner entry for the real
   * bundle bytes via `withRealBundle` — Q-3 keeps that swap OUT of this
   * shared method, so Preview's "placeholder only" guarantee holds by
   * construction, not by caller discipline).
   */
  async generateFiles(workspaceId: string, agentId: string, input: CiExportInput): Promise<CiFile[]> {
    const agentsService = new AgentsService(this.container);
    const agent = await agentsService.get(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const linkedSkills = await agentsService.linkedSkillsForRun(agentId);
    const enabledOrdered = linkedSkills.filter((s) => s.enabled).sort((a, b) => a.order - b.order);
    const slugs = disambiguate(enabledOrdered.map((s) => slugify(s.name)));
    const skillsWithSlug = enabledOrdered.map((s, i) => ({ slug: slugs[i]!, body: s.body }));

    const manifest = buildManifest(agent, skillsWithSlug);
    const manifestYaml = emitManifestYaml(manifest);
    assertManifestRoundTrips(manifestYaml, manifest);

    const files: CiFile[] = [];

    const agentSlug = slugify(agent.name);
    files.push({
      path: `${AGENTS_SUBDIR}/${agentSlug}.yaml`,
      contents: manifestYaml,
      editable: false,
      preview_omitted: false,
    });

    for (const skill of skillsWithSlug) {
      const skillFile = emitSkillFile(skill);
      files.push({ ...skillFile, editable: false, preview_omitted: false });
    }

    files.push({
      path: MEMORY_PATH,
      contents: emitMemoryPlaceholder(),
      editable: false,
      preview_omitted: false,
    });

    // AC-17: a missing bundle fails HERE (at Preview), not only at Install —
    // no GitHub call and no DB write happen before or after this line.
    const bundle = await readRunnerBundle();
    const bundleBytes = Buffer.byteLength(bundle, 'utf8');
    files.push({
      path: RUNNER_PATH,
      contents: previewPlaceholder(bundleBytes),
      editable: false,
      preview_omitted: true,
    });

    // AC-5/AC-6: the workflow is the ONE file the client may submit an edited
    // version of. Preview echoes the override back unvalidated (Preview has
    // no side effects to protect); Install/exportZip (below) are the actual
    // trust boundary — they re-validate before committing/downloading anything.
    const workflowText =
      input.workflow_override ??
      emitWorkflowYaml({ triggers: input.triggers, postAs: input.post_as, ingestUrl: input.ingest_url });
    files.push({ path: WORKFLOW_PATH, contents: workflowText, editable: true, preview_omitted: false });

    return files;
  }

  /** Swap the Preview-only placeholder runner entry for the REAL bundle
   *  bytes — Install/zip only, never Preview (Q-3). Re-reads the bundle
   *  rather than threading it out of `generateFiles`'s return value, so
   *  Preview's "placeholder only" contract can't be broken by a future edit
   *  to this method. */
  private async withRealBundle(files: CiFile[]): Promise<CiFile[]> {
    const bundle = await readRunnerBundle();
    return files.map((f) => (f.path === RUNNER_PATH ? { ...f, contents: bundle, preview_omitted: false } : f));
  }

  /**
   * AC-39/D-3: the target tree must never hold two `.devdigest/agents/*.yaml`
   * files — `agent-runner`'s `findManifestPath` refuses to start otherwise.
   * ACTUAL deletion of the conflicting installation's manifest path is not
   * expressible through the existing `commitFiles({path, contents})` port
   * (GitHub's Trees API needs a `sha: null` entry to delete a path, which
   * this port does not carry — D-10/AC-80 forbid adding a new adapter
   * method, and WI13's file scope is `service.ts`/`routes.ts` only, not
   * `adapters/github/octokit.ts`). Deleting is therefore out of reach here;
   * OVERWRITING is: writing the NEW agent's manifest at the conflicting
   * installation's own already-committed manifest path leaves exactly one
   * `.yaml` file in the tree post-commit, which is the runner's actual
   * constraint (file COUNT — `findManifestPath` never reads the filename).
   * The tradeoff (flagged for human review, same as the zip-path decision
   * below): the new agent's manifest ships under a filename that no longer
   * matches its own slug in this one replace-conflict case. A true delete
   * needs a GitHub adapter change, out of this phase's scope.
   */
  private async avoidDoubleManifest(
    workspaceId: string,
    conflicting: CiInstallationRow,
    files: CiFile[],
  ): Promise<CiFile[]> {
    const agentsService = new AgentsService(this.container);
    const oldAgent = await agentsService.get(workspaceId, conflicting.agentId);
    // `ci_installations.agent_id` is `ON DELETE CASCADE` off `agents` — a
    // conflicting installation row cannot outlive its agent, so this should
    // be unreachable. Best-effort no-op (keep the new agent's own slug)
    // rather than throw, if it ever is.
    if (!oldAgent) return files;
    const oldManifestPath = `${AGENTS_SUBDIR}/${slugify(oldAgent.name)}.yaml`;
    return files.map((f) =>
      f.path.startsWith(`${AGENTS_SUBDIR}/`) && f.path !== oldManifestPath
        ? { ...f, path: oldManifestPath }
        : f,
    );
  }

  /**
   * Install (and re-Install/"Update CI config" — AC-45, same route, no
   * second path): commits the generated file set to `CI_BRANCH` and opens
   * (or reuses) an ordinary pull request, minting a one-time ingest token
   * only when a NEW installation is created. Follows the plan's binding
   * order of operations — everything through step 6 below must succeed
   * before ANYTHING is written; the installation row is persisted LAST.
   */
  async install(
    workspaceId: string,
    agentId: string,
    repoRef: RepoRef,
    input: CiExportInput,
    log: CiLogSink,
  ): Promise<CiExport> {
    const agentsService = new AgentsService(this.container);
    const agent = await agentsService.get(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    // Steps 1 + 3: regenerate the WHOLE file set server-side (the only
    // client-supplied content is `workflow_override`); a missing runner
    // bundle fails inside `generateFiles`, before any GitHub call and before
    // any token is minted (AC-17, E-1).
    let files = await this.generateFiles(workspaceId, agentId, input);
    files = await this.withRealBundle(files);

    // Step 2: re-validate a client-supplied workflow override SERVER-SIDE —
    // never trust the client's own "valid" claim (AC-32, AC-33, A06).
    if (input.workflow_override != null) {
      const result = validateWorkflowOverride(input.workflow_override);
      if (!result.ok) {
        throw new ValidationError(
          `Workflow override rejected — violates required invariant "${result.violated}".`,
        );
      }
    }

    // Step 4: conflict check.
    const existing = await this.repo.findInstallationByAgentAndRepo(workspaceId, agentId, input.repo);
    if (!existing) {
      const conflicts = await this.repo.findInstallationsByRepo(workspaceId, input.repo);
      const conflicting = conflicts.find((c) => c.agentId !== agentId);
      if (conflicting) {
        if (!input.replace_existing) {
          throw new ConflictError(
            `${input.repo} is already exported from a different agent. Set replace_existing to confirm replacing it.`,
          );
        }
        files = await this.avoidDoubleManifest(workspaceId, conflicting, files);
        await this.repo.deleteInstallation(workspaceId, conflicting.id);
      }
    }

    // Step 5: mint the token ONLY when creating a new installation
    // (AC-38/UX-12 — an update keeps the existing token untouched; the
    // repository's `upsertInstallation` also enforces this at the DB level
    // regardless of what is passed here).
    let ingestToken: string | null = null;
    let tokenHash: string;
    if (existing) {
      tokenHash = existing.tokenHash;
    } else {
      ingestToken = randomBytes(INGEST_TOKEN_BYTES).toString('base64url');
      tokenHash = createHash('sha256').update(ingestToken, 'utf8').digest('hex');
    }

    // Step 6: commit, then reuse-or-open the PR. Never the base branch
    // itself (AC-34, AC-36, E-9, E-10) — `commitFiles` only ever
    // creates/fast-forwards `CI_BRANCH`. Reuses the adapter exactly as it
    // exists today — no new GitHub port method (D-10, AC-80).
    const github = await this.container.github();
    const message = existing
      ? `Update DevDigest CI review config for "${agent.name}"`
      : `Add DevDigest CI review for "${agent.name}"`;
    const commitResult = await github.commitFiles(repoRef, {
      branch: CI_BRANCH,
      base: input.base,
      files: files.map((f) => ({ path: f.path, contents: f.contents })),
      message,
    });

    let prUrl: string;
    try {
      const openPr = await github.findOpenPr(repoRef, commitResult.branch);
      if (openPr) {
        prUrl = openPr.url;
      } else {
        const opened = await github.openPullRequest(repoRef, {
          title: `DevDigest CI review — ${agent.name}`,
          head: commitResult.branch,
          base: input.base,
          body: installPrBody(agent.name),
        });
        prUrl = opened.url;
      }
    } catch (err) {
      // AC-40, A10: no half-state. The commit already landed on
      // `commitResult.branch` — report that plainly, and persist NOTHING,
      // so a retry can pick the branch back up (via `findOpenPr`/create-PR)
      // without needing to re-commit.
      throw new ExternalServiceError(
        `Files were committed to branch "${commitResult.branch}" but opening the pull request failed: ` +
          `${(err as Error).message}. The installation was NOT recorded — retry Install; your files are ` +
          'already on that branch.',
      );
    }

    // Step 7: persist the installation LAST — only after the commit AND the
    // PR step both succeeded.
    await this.repo.upsertInstallation({
      agentId,
      repo: input.repo,
      targetType: 'gha',
      ingestUrl: input.ingest_url,
      workflowVersion: WORKFLOW_VERSION,
      agentVersion: agent.version,
      postAs: input.post_as,
      triggers: input.triggers,
      baseBranch: input.base,
      tokenHash,
    });

    const installations = await this.repo.listInstallationsForAgent(workspaceId, agentId);
    const installationRow = installations.find((i) => i.repo === input.repo);
    /* c8 ignore next 3 -- unreachable: the upsert above just wrote this row */
    if (!installationRow) {
      throw new ExternalServiceError('Installation was written but could not be re-read.');
    }

    // AC-74, A09 — repo, agent id, installation id, workflow/agent version,
    // outcome. NEVER the token, its hash, file contents, the system prompt,
    // or skill bodies.
    log.info(
      {
        repo: input.repo,
        agentId,
        installationId: installationRow.id,
        workflowVersion: WORKFLOW_VERSION,
        agentVersion: agent.version,
        outcome: existing ? 'updated' : 'created',
      },
      'ci export installed',
    );

    return {
      installation: toInstallationContract(installationRow),
      files,
      pr_url: prUrl,
      // AC-50: present ONLY on the immediate response of a CREATE. `null` on
      // every update (including this same route's "Update CI config" use).
      ingest_token: ingestToken,
    };
  }

  /**
   * "Copy files as a zip" (AC-37) — same generation, same server-side
   * workflow-override re-validation, `application/zip` of the identical file
   * set including the REAL bundle bytes. Zero GitHub writes.
   *
   * Plan decision (flagged for human review): this path creates NO
   * installation and mints NO token. AC-50 mints a token "when an
   * installation is created"; this path creates none — it is a "take these
   * files and install them yourself" escape hatch. CI Runs will not record
   * runs for a repo installed this way until the user later installs via
   * the PR path.
   */
  async exportZip(workspaceId: string, agentId: string, input: CiExportInput): Promise<Buffer> {
    if (input.workflow_override != null) {
      const result = validateWorkflowOverride(input.workflow_override);
      if (!result.ok) {
        throw new ValidationError(
          `Workflow override rejected — violates required invariant "${result.violated}".`,
        );
      }
    }
    let files = await this.generateFiles(workspaceId, agentId, input);
    files = await this.withRealBundle(files);

    const zip = new JSZip();
    for (const file of files) zip.file(file.path, file.contents);
    return zip.generateAsync({ type: 'nodebuffer' });
  }

  /**
   * `POST /ci/ingest` — the module's one and only result-accepting route
   * (AC-49). Binding order (AC-51..AC-62): header credential check (401,
   * writes nothing, on ANY failure) → tenancy resolved ONLY from the
   * authenticated installation (`getContext` is never called for this path,
   * AC-52) → zod-validate the body (422 on failure) → repo string-equality
   * check (AC-54) → one explicit-column insert, idempotent on the
   * `(installation, actions_run_id)` unique index (AC-57).
   */
  async ingest(
    installationIdHeader: string | undefined,
    tokenHeader: string | undefined,
    rawBody: unknown,
    log: CiLogSink,
  ): Promise<void> {
    if (!installationIdHeader || !tokenHeader || !UUID_RE.test(installationIdHeader)) {
      throw new UnauthorizedError('Invalid or missing ingest credentials');
    }

    // The ingest path's own exception to "every method takes workspaceId" —
    // tenancy is exactly what this lookup resolves (repository.ts docblock).
    const installation = await this.repo.findInstallationById(installationIdHeader);
    if (!installation) {
      throw new UnauthorizedError('Invalid or missing ingest credentials');
    }

    const presented = createHash('sha256').update(tokenHeader, 'utf8').digest();
    const stored = hexToBuffer(installation.tokenHash);
    if (!stored || !constantTimeEqual(presented, stored)) {
      throw new UnauthorizedError('Invalid or missing ingest credentials');
    }

    // AC-52: from here on, tenancy comes ONLY from `installation.workspaceId`
    // (resolved above, from the authenticated row) — never from `getContext`.
    const parsed = CiIngestInput.safeParse(rawBody);
    if (!parsed.success) {
      throw new ValidationError('Ingest payload failed validation', parsed.error.issues);
    }
    const body: CiIngestInputType = parsed.data;

    if (body.repo !== installation.repo) {
      throw new ValidationError('Reported repo does not match the installed repo.');
    }

    // A08: every column assigned explicitly — nothing spread from `body`.
    await this.repo.insertCiRun({
      workspaceId: installation.workspaceId,
      agentId: installation.agentId,
      ciInstallationId: installation.id,
      repo: body.repo,
      externalPrNumber: body.pr_number,
      headSha: body.head_sha,
      actionsRunId: body.actions_run_id,
      jobUrl: body.job_url,
      sourceLabel: body.source,
      status: body.status,
      findingsCount: body.result?.findings_count ?? null,
      critical: body.result?.critical ?? null,
      warning: body.result?.warning ?? null,
      suggestion: body.result?.suggestion ?? null,
      costUsd: body.result?.cost_usd ?? null,
      durationMs: body.duration_ms,
      error: body.error ?? null,
    });

    // AC-60, AC-74: installation id, actions run id, head sha, findings,
    // cost, outcome. NEVER the token, the hash, or the request body.
    log.info(
      {
        installationId: installation.id,
        actionsRunId: body.actions_run_id,
        headSha: body.head_sha,
        findingsCount: body.result?.findings_count ?? null,
        costUsd: body.result?.cost_usd ?? null,
        status: body.status,
      },
      'ci run ingested',
    );
  }

  /** `GET /ci/runs` (WI15) — `source='ci'` only, filters applied after the
   *  workspace predicate (enforced in `repository.drizzle.ts`). Zero GitHub
   *  calls, zero LLM calls. */
  async listRuns(workspaceId: string, filters: CiRunFilters): Promise<CiRun[]> {
    const rows = await this.repo.listCiRuns(workspaceId, {
      sinceDays: filters.since_days,
      agentId: filters.agent_id ?? null,
      repo: filters.repo ?? null,
      status: filters.status ?? null,
      sourceLabel: filters.source ?? null,
    });
    return rows.map(toCiRunContract);
  }

  /** `GET /agents/:id/ci-installations` (WI15) — 404 outside the workspace
   *  (via the agent lookup, same pattern every other agent-scoped route in
   *  this codebase uses). Zero GitHub calls. */
  async listInstallations(workspaceId: string, agentId: string): Promise<CiInstallation[]> {
    const agentsService = new AgentsService(this.container);
    const agent = await agentsService.get(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const rows = await this.repo.listInstallationsForAgent(workspaceId, agentId);
    return rows.map(toInstallationContract);
  }

  /** `DELETE /ci/installations/:id` (WI16, Q-6) — workspace-scoped via the
   *  repository's `agents` join; no GitHub call. `agent_runs
   *  .ci_installation_id` is `ON DELETE SET NULL`, so past CI runs stay
   *  readable (E-24's precedent). */
  async deleteInstallation(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteInstallation(workspaceId, id);
  }
}
