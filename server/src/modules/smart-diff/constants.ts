/**
 * Path-classification thresholds and matchers for Smart Diff.
 * Evaluated in order: boilerplate → wiring → core (default).
 * Matching is plain segment/basename/extension checks — no glob library.
 */

/** PRs above this many changed lines (additions + deletions) are "too big". */
export const SPLIT_SUGGESTION_MAX_LINES = 400;

/** Cap on finding_lines per file so a huge multi-line finding doesn't dominate. */
export const MAX_FINDING_LINES_PER_FILE = 50;

/** Lockfile basenames — generated dependency graphs, skim only. */
export const BOILERPLATE_LOCKFILES = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  'cargo.lock',
  'poetry.lock',
  'composer.lock',
  'gemfile.lock',
  'go.sum',
] as const;

/**
 * package.json itself is boilerplate (mechanical dep/script churn), matching
 * the mock UI — not wiring like other config files.
 */
export const BOILERPLATE_BASENAMES = ['package.json'] as const;

/** Path segments that mark generated / vendor / snapshot output. */
export const BOILERPLATE_DIR_SEGMENTS = [
  'dist',
  'build',
  'out',
  '.next',
  'coverage',
  'node_modules',
  'vendor',
  'migrations',
  '__snapshots__',
] as const;

/** Path segments that mark test trees — skim, not the logic under review. */
export const BOILERPLATE_TEST_SEGMENTS = ['test', 'tests', '__tests__', 'e2e'] as const;

/** Exact suffix / compound-extension markers for generated or binary assets. */
export const BOILERPLATE_EXTENSIONS = [
  '.snap',
  '.map',
  '.min.js',
  '.d.ts',
  '.gen.ts',
  '.pb.go',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.pdf',
] as const;

/** Substring markers inside a basename (e.g. foo.generated.ts). */
export const BOILERPLATE_BASENAME_MARKERS = ['.generated.'] as const;

/** Bootstrap / barrel basenames — deliberate: barrels dominate; logic in index.ts is misfiled. */
export const WIRING_BOOTSTRAP_BASENAMES = [
  'index.ts',
  'index.tsx',
  'index.js',
  'index.mjs',
  'index.cjs',
  'server.ts',
  'server.js',
  'app.ts',
  'app.tsx',
  'app.js',
  'main.ts',
  'main.js',
  'bootstrap.ts',
  'container.ts',
  'middleware.ts',
  'config.ts',
  'config.js',
] as const;

/** Exact config / env basenames. */
export const WIRING_CONFIG_BASENAMES = [
  'dockerfile',
  'license',
  'license.md',
  'license.txt',
] as const;

/** Path segment that marks CI / GitHub workflow wiring. */
export const WIRING_DIR_SEGMENTS = ['.github'] as const;

/** File extensions treated as wiring when nothing else matched. */
export const WIRING_EXTENSIONS = [
  '.json',
  '.yml',
  '.yaml',
  '.md',
  '.mdx',
  '.css',
  '.scss',
] as const;
