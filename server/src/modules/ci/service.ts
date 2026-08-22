import type { CiExportInput, CiFile } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { AgentsService } from '../agents/service.js';
import type { CiRepository } from './repository.js';
import { AGENTS_SUBDIR, MEMORY_PATH, RUNNER_PATH, WORKFLOW_PATH } from './constants.js';
import { disambiguate, slugify } from './helpers.js';
import {
  buildManifest,
  emitManifestYaml,
  emitMemoryPlaceholder,
  emitSkillFile,
  assertManifestRoundTrips,
} from './manifest.js';
import { emitWorkflowYaml } from './workflow.js';
import { previewPlaceholder, readRunnerBundle } from './bundle.js';

/** Structural log sink — `req.log` (pino) satisfies this as-is, same shape
 *  `EvalLogSink`/`IntentLogSink` already use elsewhere. Never logs generated
 *  file contents, the system prompt, skill bodies or request bodies (AC-74,
 *  A09) — only repo, agent id, file count, outcome. */
export interface CiLogSink {
  info(obj: Record<string, unknown>, msg?: string): void;
}

/**
 * CI module application service. Depends on the repository PORT (never a
 * concrete Drizzle class) plus `Container`, used only to construct
 * `AgentsService` for the cross-module read `linkedSkillsForRun` exists for
 * (onion-architecture "Cross-module reads" rule — never import
 * `AgentsRepository` directly). Same pattern `modules/eval/service.ts` uses.
 */
export class CiService {
  constructor(
    // Wired for Phase C (WI12) call sites; Preview (this phase) makes ZERO
    // repository calls, so `repo` is unused for now — kept as a constructor
    // param (not omitted) so the container/route wiring doesn't change shape
    // again once Phase C adds real methods.
    private repo: CiRepository,
    private container: Container,
  ) {}

  /**
   * Assemble the exported file set for an agent, in the fixed order AC-9
   * requires: manifest → one file per enabled linked skill (agent order) →
   * memory placeholder → runner bundle (preview-omitted) → workflow. Zero
   * side effects (AC-2): no GitHub call, no DB write, no token minted. Used
   * by BOTH the Preview route (as-is) and, in Phase C, as the first step of
   * Install (which then commits the result).
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
    // no side effects to protect); Install (Phase C, WI13) is the actual
    // trust boundary — it re-validates before committing anything.
    const workflowText =
      input.workflow_override ??
      emitWorkflowYaml({ triggers: input.triggers, postAs: input.post_as, ingestUrl: input.ingest_url });
    files.push({ path: WORKFLOW_PATH, contents: workflowText, editable: true, preview_omitted: false });

    return files;
  }
}
