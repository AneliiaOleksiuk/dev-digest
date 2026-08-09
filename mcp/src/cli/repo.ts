import { execFile } from 'node:child_process';

/**
 * Git access for the pre-push CLI. Uses `node:child_process` `execFile`
 * directly (no `simple-git` dependency, per WI12) and is injectable so
 * `mcp/test/cli-*.test.ts` can run hermetically with a fake `GitRunner` —
 * no real git repo, no network.
 */
export type GitRunner = (args: string[], cwd?: string) => Promise<string>;

/** Real git runner — shells out to the `git` binary on PATH. */
export const runGit: GitRunner = (args, cwd) =>
  new Promise((resolvePromise, reject) => {
    execFile(
      'git',
      args,
      { cwd, maxBuffer: 1024 * 1024 * 64 },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        resolvePromise(stdout);
      },
    );
  });

/** `git rev-parse --show-toplevel` — the repo root, used as `cwd` for every other call. */
export async function getRepoRoot(git: GitRunner = runGit): Promise<string> {
  const out = await git(['rev-parse', '--show-toplevel']);
  return out.trim();
}

/**
 * `git diff HEAD` — staged + unstaged changes to TRACKED files. Deliberately
 * excludes untracked files (see `getUntrackedFiles` + the CLI's stderr warning).
 */
export async function getWorkingDiff(git: GitRunner = runGit, cwd?: string): Promise<string> {
  return git(['diff', 'HEAD'], cwd);
}

/** `git ls-files --others --exclude-standard` — untracked, non-gitignored files. */
export async function getUntrackedFiles(git: GitRunner = runGit, cwd?: string): Promise<string[]> {
  const out = await git(['ls-files', '--others', '--exclude-standard'], cwd);
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}
