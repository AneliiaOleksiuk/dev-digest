import type { GitRunner } from './repo.js';
import { getUntrackedFiles, getWorkingDiff } from './repo.js';

export type ReviewMode = 'working' | 'staged' | 'branch';

/** All modes the CLI knows about — used to validate `--mode` and to render `--help`. */
export const REVIEW_MODES: ReviewMode[] = ['working', 'staged', 'branch'];

export interface DiffCollectionOk {
  ok: true;
  /** Raw unified diff, ready for `parseUnifiedDiff`. */
  raw: string;
  /** Untracked files `git diff HEAD` cannot see — surfaced as a stderr warning. */
  untracked: string[];
}

export interface DiffCollectionFail {
  ok: false;
  /** Clean, actionable message — never a stack trace. Drives exit code 2. */
  message: string;
}

export type DiffCollectionResult = DiffCollectionOk | DiffCollectionFail;

/** One mode = one way to produce a raw diff to review. */
export type DiffCollector = (git: GitRunner, repoRoot: string) => Promise<DiffCollectionResult>;

async function collectWorking(git: GitRunner, repoRoot: string): Promise<DiffCollectionResult> {
  const raw = await getWorkingDiff(git, repoRoot);
  if (!raw.trim()) {
    return {
      ok: false,
      message:
        'No changes found (`git diff HEAD` is empty) — nothing to review. Stage/edit some tracked ' +
        'files first, or check `git status`.',
    };
  }
  const untracked = await getUntrackedFiles(git, repoRoot);
  return { ok: true, raw, untracked };
}

/**
 * A deliberate, LISTED stub — registered and present in `--help` so the
 * eventual implementation is a drop-in. Mirrors the listed-stub convention
 * `mcp/src/tools/get-blast-radius.ts` established for the MCP tools: always
 * an explicit failure, never a silent success, never a thrown exception.
 */
function notImplemented(mode: ReviewMode): DiffCollector {
  return async () => ({
    ok: false,
    message: `--mode ${mode} is not implemented yet. Only --mode working is currently supported.`,
  });
}

/**
 * `Record<ReviewMode, DiffCollector>` — adding a mode later is one entry
 * here (WI12). Only `working` is implemented; `staged`/`branch` are
 * registered and listed but return an explicit "not implemented" failure.
 */
export const MODES: Record<ReviewMode, DiffCollector> = {
  working: collectWorking,
  staged: notImplemented('staged'),
  branch: notImplemented('branch'),
};
