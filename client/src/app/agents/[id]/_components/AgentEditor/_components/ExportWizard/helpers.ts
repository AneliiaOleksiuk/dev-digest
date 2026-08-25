import { API_BASE } from "@/lib/api";
import type { CiExportInputBody, CiFile } from "@/lib/types";

/**
 * SPEC-05: there is no longer one fixed workflow filename or memory path —
 * each installation's files live under its OWN namespace
 * (`.devdigest/<ns>/…`, `.github/workflows/devdigest-review-<ns>.yml`), or
 * under the unnamespaced SPEC-04 paths for a legacy installation. The wizard
 * can no longer recognize "the workflow file" or "the memory file" by a
 * literal path — it keys off what the SERVER already told it: the one file
 * marked `editable: true` is always the workflow (`generateFiles` in
 * `service.ts` marks exactly one), and the memory placeholder is always the
 * one file whose path ends in `memory.jsonl`.
 */
export function isWorkflowFile(file: CiFile): boolean {
  return file.editable === true;
}

export function isMemoryFile(file: CiFile): boolean {
  return file.path.endsWith("memory.jsonl");
}

const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/** Client-side hint only (AC-4) — the server re-validates regardless. */
export function isValidRepoRef(repo: string): boolean {
  return REPO_RE.test(repo.trim());
}

/** Q-8 — a GitHub Actions runner cannot reach a URL pointing at the
 *  operator's own machine. */
export function isLocalhostUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(url.trim());
}

/** Default ingest URL — this studio's own `/ci/ingest` route. Defaulting to
 *  `API_BASE` (localhost in a local dev setup) is deliberate: it makes the
 *  Q-8 localhost warning fire honestly out of the box instead of hiding the
 *  problem behind an empty field. */
export function defaultIngestUrl(): string {
  return `${API_BASE}/ci/ingest`;
}

export interface WizardState {
  repo: string;
  base: string;
  triggers: string[];
  postAs: CiExportInputBody["post_as"];
  ingestUrl: string;
  workflowOverride: string | null;
}

/**
 * Builds the exact body every one of Preview/Install/Zip sends — the same
 * object shape for all three is what keeps "what Preview shows" and "what
 * Install commits" from ever drifting apart (UX-1).
 *
 * SPEC-05 AC-12: `replace_existing` is no longer sent — a different agent
 * already installed on this repo is not a conflict on the `gha` path, so
 * there is nothing left for it to confirm. The field stays in the shared
 * contract (server-ignored) for compatibility with an in-flight client; this
 * wizard simply omits it, which the server's `.default(false)` covers.
 */
export function buildExportInput(state: WizardState): CiExportInputBody {
  return {
    repo: state.repo,
    target: "gha",
    post_as: state.postAs,
    triggers: state.triggers,
    base: state.base,
    workflow_override: state.workflowOverride,
    ingest_url: state.ingestUrl,
  };
}

/** Client-side-only file save — no network request. Same technique as
 *  `OnboardingTourView/helpers.ts`'s `downloadTextFile`, generalized to an
 *  already-binary `Blob` (the zip download, AC-37). */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
