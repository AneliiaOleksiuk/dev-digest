/**
 * Deterministic fact collection for the onboarding generator. File I/O lives
 * HERE — out of `service.ts` and out of the pure-only `helpers.ts` — mirroring
 * `project-context/discover.ts`'s role split (a new, equally non-exempt
 * module that already passes `arch:check` with `node:fs/promises` imports
 * outside `helpers.ts`).
 *
 * Never runs or enqueues an index/refresh/resync job (AC-3) — only reads the
 * `repoIntel` facade and the clone already on disk.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Container } from '../../platform/container.js';
import { EXCLUDED_DIRS } from '../repo-intel/constants.js';
import type { IndexState } from '../repo-intel/types.js';
import { isInsideClone } from '../reviews/intent-inputs.js';
import {
  FACTS_TOKEN_BUDGET,
  MAX_EXCERPT_CHARS,
  MAX_RANKED_FILES_SAMPLED,
  MAX_RUN_LOCALLY_SOURCES,
  REPO_MAP_TOKEN_BUDGET,
  RUN_LOCALLY_WALK_DEPTH,
} from './constants.js';

export interface FileExcerpt {
  /** Repo-relative path, forward-slash normalized. */
  path: string;
  content: string;
}

export interface CollectedFacts {
  indexState: IndexState;
  repoMapText: string;
  repoMapDegraded: boolean;
  /** Ranked files in the facade's OWN order (AC-9) — never re-ranked here. */
  rankedFiles: string[];
  /** Bounded excerpts for the ranked files that survived the token budget,
   *  in the SAME descending-rank order (AC-9). */
  rankedExcerpts: FileExcerpt[];
  /** Paths dropped purely for `FACTS_TOKEN_BUDGET` (AC-13) — always a
   *  contiguous ascending-rank tail of `rankedFiles`. */
  droppedForBudget: string[];
  /** True when the sampled ranked files carry ≤ 1 distinct percentile (E-4)
   *  — "no import-graph signal", never presented as importance order. */
  flatRank: boolean;
  /** repo-intel's own `file_rank` percentiles for the sampled ranked files
   *  (AC-12's deterministic-signal option). */
  fileRankByPath: Map<string, number>;
  criticalPathChains: string[][];
  /** package.json(s) + README + compose file + `.env.example`, each
   *  attributed to its own repo-relative path (E-7, AC-8, AC-34). */
  runLocallySources: FileExcerpt[];
  /** True when `repos.clone_path` is null — nothing else was collected
   *  (AC-18, E-1). */
  noClone: boolean;
}

const README_CANDIDATES = ['README.md'];
const COMPOSE_CANDIDATES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
const ENV_EXAMPLE_CANDIDATES = ['.env.example'];

/**
 * Collect every deterministic fact the single LLM call and the render layer
 * need. `clonePath` null short-circuits to the no-clone marker before any
 * clone read or rank-dependent facade call (AC-18).
 */
export async function collectFacts(
  container: Container,
  repoId: string,
  clonePath: string | null,
): Promise<CollectedFacts> {
  const indexState = await container.repoIntel.getIndexState(repoId);

  if (!clonePath) {
    return {
      indexState,
      repoMapText: '',
      repoMapDegraded: true,
      rankedFiles: [],
      rankedExcerpts: [],
      droppedForBudget: [],
      flatRank: false,
      fileRankByPath: new Map(),
      criticalPathChains: [],
      runLocallySources: [],
      noClone: true,
    };
  }

  const [repoMap, rankedFiles, criticalPathChains] = await Promise.all([
    container.repoIntel.getRepoMap(repoId, REPO_MAP_TOKEN_BUDGET),
    container.repoIntel.getTopFilesByRank(repoId, MAX_RANKED_FILES_SAMPLED),
    container.repoIntel.getCriticalPaths(repoId),
  ]);
  const fileRankRows =
    rankedFiles.length > 0 ? await container.repoIntel.getFileRank(repoId, rankedFiles) : [];
  const fileRankByPath = new Map(fileRankRows.map((r) => [r.path, r.percentile] as const));
  const distinctPercentiles = new Set(fileRankRows.map((r) => r.percentile)).size;
  const flatRank = fileRankRows.length > 1 && distinctPercentiles <= 1;

  const [runLocallySources, allExcerpts] = await Promise.all([
    collectRunLocallySources(clonePath),
    readRankedExcerpts(clonePath, rankedFiles),
  ]);

  const runLocallyTokens = runLocallySources.reduce(
    (sum, s) => sum + container.tokenizer.count(s.content),
    0,
  );
  const budgetForExcerpts = Math.max(0, FACTS_TOKEN_BUDGET - runLocallyTokens - repoMap.tokens);
  const { kept, dropped } = cutToTokenBudget(container, allExcerpts, budgetForExcerpts);

  return {
    indexState,
    repoMapText: repoMap.text,
    repoMapDegraded: !!repoMap.degraded,
    rankedFiles,
    rankedExcerpts: kept,
    droppedForBudget: dropped.map((f) => f.path),
    flatRank,
    fileRankByPath,
    criticalPathChains,
    runLocallySources,
    noClone: false,
  };
}

/**
 * Walk `excerpts` (already in descending-rank order) accumulating tokens; the
 * first item that would exceed `budgetTokens` — and every item after it (the
 * lower-ranked tail) — is dropped. Equivalent to "drop whole items in
 * ascending rank order" (AC-13): the dropped set is always the lowest-ranked
 * contiguous tail. Same cutoff technique as
 * `project-context/service.ts`'s `resolveEffectiveSet`.
 */
function cutToTokenBudget(
  container: Container,
  excerpts: FileExcerpt[],
  budgetTokens: number,
): { kept: FileExcerpt[]; dropped: FileExcerpt[] } {
  let used = 0;
  let cutoff = excerpts.length;
  for (let i = 0; i < excerpts.length; i++) {
    const tokens = container.tokenizer.count(excerpts[i]!.content);
    if (used + tokens > budgetTokens) {
      cutoff = i;
      break;
    }
    used += tokens;
  }
  return { kept: excerpts.slice(0, cutoff), dropped: excerpts.slice(cutoff) };
}

/** Bounded reads for the ranked files, in the SAME order the facade returned
 *  them (AC-9) — capped per-file at `MAX_EXCERPT_CHARS`, unreadable files
 *  silently skipped (never an error). Every path passes `isInsideClone`
 *  before any read (server `INSIGHTS.md`: facade paths are already
 *  repo-root-relative — `join` directly, no re-rooting). */
async function readRankedExcerpts(clonePath: string, paths: string[]): Promise<FileExcerpt[]> {
  const results = await Promise.all(paths.map((path) => readClampedFile(clonePath, path)));
  return results.filter((x): x is FileExcerpt => x !== null);
}

async function readClampedFile(clonePath: string, path: string): Promise<FileExcerpt | null> {
  const abs = isInsideClone(clonePath, path);
  if (!abs) return null;
  const content = await readFile(abs, 'utf8').catch(() => null);
  return content == null ? null : { path, content: content.slice(0, MAX_EXCERPT_CHARS) };
}

/** First candidate (in list order) that reads successfully, or `null`. */
async function readFirstExisting(clonePath: string, candidates: string[]): Promise<FileExcerpt | null> {
  for (const path of candidates) {
    const excerpt = await readClampedFile(clonePath, path);
    if (excerpt) return excerpt;
  }
  return null;
}

/**
 * "How to run locally" source files (D-2 — the repo map carries no scripts/
 * stack/routes, so this needs its own bounded deterministic reads): every
 * `package.json` at depth ≤ `RUN_LOCALLY_WALK_DEPTH` (E-7, Recommendation 3),
 * plus the first README / compose file / `.env.example` found at the repo
 * root. Deterministic and attributed (AC-34, UX-8) — never a guessed command.
 */
async function collectRunLocallySources(clonePath: string): Promise<FileExcerpt[]> {
  const packageJsonPaths = await findPackageJsonFiles(clonePath);
  const [packageJsons, readme, compose, envExample] = await Promise.all([
    Promise.all(packageJsonPaths.map((path) => readClampedFile(clonePath, path))),
    readFirstExisting(clonePath, README_CANDIDATES),
    readFirstExisting(clonePath, COMPOSE_CANDIDATES),
    readFirstExisting(clonePath, ENV_EXAMPLE_CANDIDATES),
  ]);
  const singles = [readme, compose, envExample].filter((x): x is FileExcerpt => x !== null);
  return [...packageJsons.filter((x): x is FileExcerpt => x !== null), ...singles];
}

/** Deterministic, bounded (`RUN_LOCALLY_WALK_DEPTH`) walk for `package.json`
 *  files — sorted by path, capped at `MAX_RUN_LOCALLY_SOURCES`. This repo is
 *  itself the anchor case: five packages, no workspace, root `AGENTS.md`. */
async function findPackageJsonFiles(clonePath: string): Promise<string[]> {
  const found: string[] = [];
  const excludedSet: ReadonlySet<string> = new Set(EXCLUDED_DIRS);

  async function walk(dirAbs: string, dirRel: string, depth: number): Promise<void> {
    if (depth > RUN_LOCALLY_WALK_DEPTH) return;
    let entries;
    try {
      entries = await readdir(dirAbs, { withFileTypes: true });
    } catch {
      return; // unreadable directory — skip cleanly
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const entryRel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (excludedSet.has(entry.name)) continue;
        await walk(join(dirAbs, entry.name), entryRel, depth + 1);
      } else if (entry.isFile() && entry.name === 'package.json') {
        found.push(entryRel);
      }
    }
  }

  await walk(clonePath, '', 0);
  found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return found.slice(0, MAX_RUN_LOCALLY_SOURCES);
}
