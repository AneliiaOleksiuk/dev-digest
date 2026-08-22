import { readFile as fsReadFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError } from '../../platform/errors.js';

/**
 * `bundle.ts` — reads the `agent-runner` bundle from disk, fails loudly.
 *
 * `node:fs` is permitted here (this is not `service.ts`) and consistent with
 * `modules/onboarding/facts.ts:11`, which imports `node:fs/promises` directly
 * and passes `arch:check`; `service.ts` must never import `node:fs` itself —
 * it calls this function.
 *
 * The path is resolved from `import.meta.url`, NOT `process.cwd()`. The
 * server runs from `server/` under `tsx` (this file lives at
 * `server/src/modules/ci/bundle.ts`) and from `server/dist/` after a build
 * (`server/dist/modules/ci/bundle.js`) — in BOTH layouts this module's own
 * directory is exactly four levels below the repo root
 * (`ci → modules → src|dist → server → <root>`), so walking up four levels
 * from `import.meta.url` reaches the repo root regardless of which layout is
 * running. A `cwd`-relative path would silently break under one of the two.
 */
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..', '..', '..');
export const RUNNER_BUNDLE_PATH = path.join(REPO_ROOT, 'agent-runner', 'dist', 'index.js');

export interface BundleDeps {
  readFile?: (path: string) => Promise<string>;
}

/**
 * Read `agent-runner/dist/index.js`. The bundle is git-ignored and absent on
 * a fresh clone (`agent-runner/.gitignore:2`) — that is the normal first-run
 * experience, so a missing/unreadable file fails with a message naming the
 * exact path AND the command that produces it, rather than a raw ENOENT
 * (AC-17, E-1). No side effect happens before this call resolves — a caller
 * (Preview or Install) that hits this failure has committed nothing, opened
 * no pull request, and persisted no installation.
 */
export async function readRunnerBundle(deps: BundleDeps = {}): Promise<string> {
  const readFile = deps.readFile ?? ((p: string) => fsReadFile(p, 'utf8'));
  try {
    return await readFile(RUNNER_BUNDLE_PATH);
  } catch (err) {
    throw new ConfigError(
      `Runner bundle not found at ${RUNNER_BUNDLE_PATH}. Build it first: cd agent-runner && pnpm build`,
      { cause: err instanceof Error ? err.message : String(err) },
    );
  }
}

/**
 * One-line human-readable placeholder for the Preview response (Q-3) — the
 * real bundle bytes are never sent to or received from the client; Install
 * re-reads them from disk server-side.
 */
export function previewPlaceholder(bytes: number): string {
  const kb = (bytes / 1024).toFixed(1);
  return `# Runner bundle omitted from preview (~${kb} KB). The real file is embedded server-side at Install — it is never uploaded or downloaded through the wizard.`;
}
