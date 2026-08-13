/**
 * Thrown by `GitClient.sync` when the clone's working tree has uncommitted
 * changes (AC-50) — in-app document editing/creation (SPEC-01 amendment)
 * writes into a clone `sync()` otherwise treats as a disposable read-only
 * mirror, so a resync must refuse rather than silently discard the edit
 * with `reset --hard`. `paths` is the (bounded) `git status --porcelain`
 * output — display text only, never fed to another filesystem/shell call
 * (Untrusted-inputs table).
 */
export class DirtyCloneError extends Error {
  constructor(public readonly paths: string[]) {
    super(`Clone has uncommitted changes: ${paths.join(', ')}`);
    this.name = 'DirtyCloneError';
  }
}
