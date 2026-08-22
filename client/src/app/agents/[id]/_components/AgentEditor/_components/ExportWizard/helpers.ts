import { API_BASE } from "@/lib/api";
import type { CiExportInputBody } from "@/lib/types";

/** The exact fixed paths AC-9 requires (Simplicity constraints: no target
 *  abstraction, so these are literals here too — the server is still the
 *  real source of truth, this only lets the wizard recognize which
 *  returned file is which for its own display rules). */
export const WORKFLOW_PATH = ".github/workflows/devdigest-review.yml";
export const MEMORY_PATH = ".devdigest/memory.jsonl";

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
  replaceExisting: boolean;
}

/** Builds the exact body every one of Preview/Install/Zip sends — the same
 *  object shape for all three is what keeps "what Preview shows" and "what
 *  Install commits" from ever drifting apart (UX-1). */
export function buildExportInput(state: WizardState): CiExportInputBody {
  return {
    repo: state.repo,
    target: "gha",
    post_as: state.postAs,
    triggers: state.triggers,
    base: state.base,
    workflow_override: state.workflowOverride,
    ingest_url: state.ingestUrl,
    replace_existing: state.replaceExisting,
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
