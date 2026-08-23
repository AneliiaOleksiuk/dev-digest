import { createHash, randomBytes } from 'node:crypto';
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
  AppError,
  ExternalServiceError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../platform/errors.js';
import { AgentsService } from '../agents/service.js';
import type { CiInstallationRow, CiInstallationWithLastRun, CiRepository, CiRunListRow } from './repository.js';
import {
  agentsSubdirFor,
  ciBranchFor,
  ingestSecretNameFor,
  INGEST_TOKEN_BYTES,
  memoryPathFor,
  RUNNER_PATH,
  skillsSubdirFor,
  workflowPathFor,
  WORKFLOW_VERSION,
} from './constants.js';
import { deriveNamespace, disambiguate, slugify, type RepoRef } from './helpers.js';
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

/**
 * A resolved installation LAYOUT (SPEC-05) — the one value threaded through
 * `generateFiles`, the override re-validator and the AC-8 guard for a SINGLE
 * export, so "what Preview shows" and "what Install commits" cannot drift
 * (Recommendation 6). `namespace: null` means legacy (AC-14).
 */
export interface CiExportLayout {
  namespace: string | null;
  manifestPath: string;
}

/** `resolveLayout`'s full result — the layout PLUS the two installation
 *  lists every caller already needs alongside it, so nothing re-queries the
 *  same `(workspace, repo)` row set twice. */
export interface ResolvedLayout {
  layout: CiExportLayout;
  /** This installation's own existing row, if any — drives AC-9's "update,
   *  keep the token" branch. */
  existing: CiInstallationRow | undefined;
  /** Every OTHER installation already on this (workspace, repo) — drives
   *  the AC-8 path-collision guard and, for a brand-new installation, the
   *  taken-namespace set `deriveNamespace` disambiguates against. */
  others: CiInstallationRow[];
}

/** Every path an installation with this ROW's own persisted layout owns —
 *  the same subdirectories/files a namespaced or legacy export ever writes,
 *  minus `RUNNER_PATH` (AC-6's one intentionally-shared path). */
function ownedDirsAndFiles(row: CiInstallationRow): { dirs: string[]; files: string[] } {
  return {
    dirs: [agentsSubdirFor(row.namespace), skillsSubdirFor(row.namespace)],
    files: [memoryPathFor(row.namespace), workflowPathFor(row.namespace)],
  };
}

/** AC-8: `true` when `path` falls inside `dir` — compared on PATH SEGMENTS
 *  (an exact `dir` boundary via `dir + '/'`), never a raw string prefix, so
 *  `.devdigest/agents` can never appear to "contain" a sibling directory
 *  that merely shares the prefix text (e.g. a namespace slug beginning with
 *  `agents`) — only a path that is ACTUALLY nested under `dir` matches. */
function isPathInsideDir(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

/** Structural log sink — `req.log` (pino) satisfies this as-is, same shape
 *  `EvalLogSink`/`IntentLogSink` already use elsewhere. Never logs generated
 *  file contents, the system prompt, skill bodies, the ingest token, its
 *  hash, or the raw request body (AC-74, AC-60, A09) — only repo/agent/
 *  installation/run ids, counts, cost, and outcome. */
export interface CiLogSink {
  info(obj: Record<string, unknown>, msg?: string): void;
}

/**
 * Fix (finding 1): parse `Authorization: Bearer <token>` (case-insensitive
 * on the scheme, per RFC 7235 §2.1). Anything else — an absent header, a
 * different scheme, or a scheme with no token — returns `null` and is
 * treated identically to a missing header always was: 401, write nothing
 * (AC-51). This replaces the old two-custom-header
 * (`x-devdigest-installation` / `x-devdigest-token`) read, which the
 * generated workflow (`workflow.ts`) never actually emitted — see
 * `routes.ts`'s module docblock and `workflow.ts`'s own comment on why THAT
 * file needed no change for this fix.
 */
function parseBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
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
    ingest_secret_name: ingestSecretNameFor(row.namespace),
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
   * SPEC-05: the ONE read-only layout resolution used by Preview, Install
   * and Zip alike (Recommendation 6) — so "what Preview shows" and "what
   * Install commits" cannot drift. A single `findInstallationsByRepo` read
   * (already workspace-scoped via the `agents` join, AC-37) serves both this
   * installation's OWN row (if any, `existing` — AC-4/AC-9's "reuse verbatim"
   * branch) and every OTHER installation on the repo (`others` — AC-8's
   * guard input, and the taken-namespace set for a brand-new installation).
   *
   * - existing → reuse ITS OWN persisted `namespace`/`manifestPath` verbatim,
   *   however many times the agent has since been renamed (AC-4, AC-9,
   *   AC-14, AC-26).
   * - no existing → `deriveNamespace(agent.name, others' namespaces)` and a
   *   manifest path under that namespace — uniformly, including the FIRST
   *   agent on a fresh repository (AC-1, AC-2, AC-17: no "first agent gets
   *   the short paths" special case).
   */
  async resolveLayout(workspaceId: string, agentId: string, repo: string): Promise<ResolvedLayout> {
    const agentsService = new AgentsService(this.container);
    const agent = await agentsService.get(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const rows = await this.repo.findInstallationsByRepo(workspaceId, repo);
    const existing = rows.find((r) => r.agentId === agentId);
    const others = rows.filter((r) => r.agentId !== agentId);

    if (existing) {
      return { layout: { namespace: existing.namespace, manifestPath: existing.manifestPath }, existing, others };
    }

    const taken = others.map((r) => r.namespace).filter((ns): ns is string => ns !== null);
    const namespace = deriveNamespace(agent.name, taken);
    const manifestPath = `${agentsSubdirFor(namespace)}/${slugify(agent.name)}.yaml`;
    return { layout: { namespace, manifestPath }, existing: undefined, others };
  }

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
   *
   * `layout` (SPEC-05, replacing the old `manifestPathOverride?` parameter):
   * resolved ONCE per export via `resolveLayout` above and passed down here
   * — never re-derived per file. Every namespaced (or legacy) path this
   * method emits comes from `layout.namespace` via `constants.ts`'s
   * derivations, so the manifest, skill files, memory placeholder and
   * workflow all land under the SAME directory.
   */
  async generateFiles(
    workspaceId: string,
    agentId: string,
    input: CiExportInput,
    layout: CiExportLayout,
  ): Promise<CiFile[]> {
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

    files.push({
      path: layout.manifestPath,
      contents: manifestYaml,
      editable: false,
      preview_omitted: false,
    });

    const skillsDir = skillsSubdirFor(layout.namespace);
    for (const skill of skillsWithSlug) {
      const skillFile = emitSkillFile(skill, skillsDir);
      files.push({ ...skillFile, editable: false, preview_omitted: false });
    }

    files.push({
      path: memoryPathFor(layout.namespace),
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
      emitWorkflowYaml({
        triggers: input.triggers,
        postAs: input.post_as,
        ingestUrl: input.ingest_url,
        namespace: layout.namespace,
      });
    files.push({
      path: workflowPathFor(layout.namespace),
      contents: workflowText,
      editable: true,
      preview_omitted: false,
    });

    // AC-7: `.devdigest/<ns>/agents/` (or the legacy `.devdigest/agents/`)
    // must hold EXACTLY one manifest after this export — `agent-runner`
    // refuses to start otherwise (`agent-runner/src/manifest.ts:37-45`).
    // Fail-closed HERE, before any GitHub call, rather than commit a tree
    // that cannot run (A10).
    const agentsDir = agentsSubdirFor(layout.namespace);
    const manifestCount = files.filter(
      (f) => f.path.startsWith(`${agentsDir}/`) && f.path.endsWith('.yaml'),
    ).length;
    if (manifestCount !== 1) {
      throw new AppError(
        'manifest_count_invalid',
        `Expected exactly one agent manifest under ${agentsDir}, would commit ${manifestCount}.`,
        500,
      );
    }

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
   * Install (and re-Install/"Update CI config" — AC-45, same route, no
   * second path): commits the generated file set to this installation's OWN
   * branch (`ciBranchFor(layout.namespace)`) and opens (or reuses, on a
   * re-export of the SAME agent) that branch's own pull request, minting a
   * one-time ingest token only when a NEW installation is created. Follows
   * the plan's binding order of operations — everything through the
   * commit/PR step below must succeed before ANYTHING is written; the
   * installation row is persisted LAST.
   *
   * SPEC-05 AC-11: a different agent already installed on this repo is no
   * longer a conflict — `resolveLayout` below simply derives this agent its
   * own namespace among `others`' taken namespaces, and the export proceeds
   * as an ordinary install. No confirmation, no deletion of another
   * installation's row, no inheriting another installation's namespace,
   * manifest path or ingest token. `input.replace_existing` is read nowhere
   * on this path (AC-12) — there is nothing left for it to confirm.
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

    // Read-only — resolves this installation's own namespace/manifest path
    // (reused verbatim if `existing`) and the repo's OTHER installations
    // (`others`), which both the AC-8 guard below and (for a brand-new
    // installation) the namespace derivation itself need.
    const { layout, existing, others } = await this.resolveLayout(workspaceId, agentId, input.repo);

    // Regenerate the WHOLE file set server-side (the only client-supplied
    // content is `workflow_override`); a missing runner bundle fails inside
    // `generateFiles`, before any GitHub call and before any token is minted
    // (AC-17, E-1). The AC-7 "exactly one manifest" guard runs inside
    // `generateFiles` too.
    let files = await this.generateFiles(workspaceId, agentId, input, layout);
    files = await this.withRealBundle(files);

    // AC-8: this export must never write a path belonging to ANOTHER
    // installation on this repo — the two committed file sets may intersect
    // ONLY at the shared runner bundle (AC-6). Fail-closed, before any
    // GitHub call.
    for (const other of others) {
      const { dirs, files: ownedFiles } = ownedDirsAndFiles(other);
      for (const f of files) {
        if (f.path === RUNNER_PATH) continue;
        const collides = ownedFiles.includes(f.path) || dirs.some((dir) => isPathInsideDir(f.path, dir));
        if (collides) {
          throw new AppError(
            'namespace_collision',
            `Generated path "${f.path}" would overwrite installation ${other.id}'s own files.`,
            500,
          );
        }
      }
    }

    // Re-validate a client-supplied workflow override SERVER-SIDE — never
    // trust the client's own "valid" claim (AC-32, AC-33, A06). AC-24: also
    // refuses an override aimed at another installation's namespace or
    // ingest secret, checked against THIS installation's own resolved
    // layout, never re-derived independently.
    if (input.workflow_override != null) {
      const result = validateWorkflowOverride(input.workflow_override, { namespace: layout.namespace });
      if (!result.ok) {
        throw new ValidationError(
          `Workflow override rejected — violates required invariant "${result.violated}".`,
        );
      }
    }

    // Mint the token ONLY when creating a new installation (AC-38/UX-12 — an
    // update keeps the existing token untouched; the repository's
    // `upsertInstallation` also enforces this at the DB level regardless of
    // what is passed here).
    let ingestToken: string | null = null;
    let tokenHash: string;
    if (existing) {
      tokenHash = existing.tokenHash;
    } else {
      ingestToken = randomBytes(INGEST_TOKEN_BYTES).toString('base64url');
      tokenHash = createHash('sha256').update(ingestToken, 'utf8').digest('hex');
    }

    // Commit, then reuse-or-open THIS INSTALLATION'S OWN PR. Never the base
    // branch itself (AC-34, AC-36, E-9, E-10) — `commitFiles` only ever
    // creates/fast-forwards `ciBranchFor(layout.namespace)`, a branch scoped
    // to this installation alone (legacy keeps sharing `CI_BRANCH`, per
    // AC-14's freeze — there can only ever be one legacy installation per
    // repo anyway). `findOpenPr` below is branch-scoped, so it can never
    // return another installation's PR, and a new PR's title (from
    // `agent.name`, just below) can never later be seen as "shared" with a
    // different agent's export.
    const github = await this.container.github();
    const branch = ciBranchFor(layout.namespace);
    const message = existing
      ? `Update DevDigest CI review config for "${agent.name}"`
      : `Add DevDigest CI review for "${agent.name}"`;
    const commitResult = await github.commitFiles(repoRef, {
      branch,
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
      // without needing to re-commit. This leaves every OTHER installation
      // on this repo untouched (AC-13).
      throw new ExternalServiceError(
        `Files were committed to branch "${commitResult.branch}" but opening the pull request failed: ` +
          `${(err as Error).message}. The installation was NOT recorded — retry Install; your files are ` +
          'already on that branch.',
      );
    }

    // Persist the installation LAST — only after the commit AND the PR step
    // both succeeded.
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
      manifestPath: layout.manifestPath,
      namespace: layout.namespace,
      tokenHash,
    });

    const installations = await this.repo.listInstallationsForAgent(workspaceId, agentId);
    const installationRow = installations.find((i) => i.repo === input.repo);
    /* c8 ignore next 3 -- unreachable: the upsert above just wrote this row */
    if (!installationRow) {
      throw new ExternalServiceError('Installation was written but could not be re-read.');
    }

    // AC-74, A09 — repo, agent id, installation id, namespace, workflow/agent
    // version, outcome. NEVER the token, its hash, file contents, the system
    // prompt, or skill bodies.
    log.info(
      {
        repo: input.repo,
        agentId,
        installationId: installationRow.id,
        namespace: layout.namespace,
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
   *
   * SPEC-05: resolves the SAME layout Preview/Install would (a candidate
   * namespace, for a not-yet-installed agent — pre-existing shape, widened
   * rather than fixed, see the plan's Risks section) and passes it to both
   * the generator and the override validator, same as Install.
   */
  async exportZip(workspaceId: string, agentId: string, input: CiExportInput): Promise<Buffer> {
    const { layout } = await this.resolveLayout(workspaceId, agentId, input.repo);

    if (input.workflow_override != null) {
      const result = validateWorkflowOverride(input.workflow_override, { namespace: layout.namespace });
      if (!result.ok) {
        throw new ValidationError(
          `Workflow override rejected — violates required invariant "${result.violated}".`,
        );
      }
    }
    let files = await this.generateFiles(workspaceId, agentId, input, layout);
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
   *
   * Fix (finding 1): authenticates via a SINGLE `Authorization: Bearer
   * <token>` header — the exact shape the generated workflow's reporting
   * step has always sent (`workflow.ts`) — instead of the two custom headers
   * (`x-devdigest-installation` / `x-devdigest-token`) this used to read,
   * which nothing ever emitted.
   */
  async ingest(authorizationHeader: string | undefined, rawBody: unknown, log: CiLogSink): Promise<void> {
    const token = parseBearerToken(authorizationHeader);
    if (!token) {
      throw new UnauthorizedError('Invalid or missing ingest credentials');
    }

    const hash = createHash('sha256').update(token, 'utf8').digest('hex');

    // The ingest path's own exception to "every method takes workspaceId" —
    // tenancy is exactly what this lookup resolves (repository.ts docblock).
    // The LOOKUP ITSELF is the authentication: a hash match proves
    // possession of the token; there is no separate "installation unknown"
    // step to fold in, since an unmatched hash simply returns no row, which
    // is the 401 case below.
    //
    // This is why NO `timingSafeEqual`/constant-time comparison is needed
    // here, unlike the old compare-then-fetch flow it replaces. What
    // `timingSafeEqual` defends against is an attacker learning a SECRET
    // buffer's bytes incrementally, one byte at a time, by timing how far a
    // byte-by-byte comparison gets before it bails out early on a mismatch —
    // that only works when the attacker controls one side of an explicit
    // buffer-vs-buffer comparison whose early-exit point they can observe.
    // A hash-KEYED lookup performs no such comparison in attacker-visible
    // time: Postgres resolves `WHERE token_hash = $1` via the index in
    // essentially the same time whether zero rows match (a wrong guess) or
    // one row matches (the right guess) — there is no partial-match signal
    // to narrow in on, because equality on an indexed column is not
    // evaluated byte-by-byte from the caller's perspective. The 256-bit
    // token space also makes a blind guess computationally infeasible
    // regardless of timing precision, but that's a backstop, not the reason
    // this is safe — the reason is there is no incremental signal to time.
    const installation = await this.repo.findInstallationByTokenHash(hash);
    if (!installation) {
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

    // AC-60, AC-74, A09: installation id, namespace, actions run id, head
    // sha, findings, cost, outcome. NEVER the token, the hash, or the
    // request body.
    log.info(
      {
        installationId: installation.id,
        namespace: installation.namespace,
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
