/**
 * Pure onboarding helpers — grounding, capping, deterministic skeleton, and
 * status derivation. No DB / adapter / container imports (onion
 * `no-helpers-to-io`); `facts.ts` is a plain sibling import (fact collection
 * already happened by the time these run).
 */
import type { OnboardingLink, OnboardingSection, OnboardingStatus } from '@devdigest/shared';
import { ONBOARDING_SECTION_KINDS } from '@devdigest/shared';
import type { IndexState } from '../repo-intel/types.js';
import type { CollectedFacts, FileExcerpt } from './facts.js';
import {
  MAX_CRITICAL_PATH_ROWS,
  MAX_FIRST_TASK_CARDS,
  MAX_LINKS_PER_SECTION,
  MAX_READING_PATH_ENTRIES,
  MAX_RUN_LOCALLY_STEPS,
} from './constants.js';

// ---------------------------------------------------------------- AC-19 gate

/** Facts fall below the minimum needed to write a grounded tour: no clone,
 *  or no ranked files AND no readable `package.json`/README (AC-19) — the
 *  LLM call must be skipped entirely so a degraded repo costs nothing. */
export function isBelowMinimum(facts: CollectedFacts): boolean {
  if (facts.noClone) return true;
  if (facts.rankedFiles.length > 0) return false;
  return !facts.runLocallySources.some(
    (s) => s.path.endsWith('package.json') || s.path.toLowerCase().endsWith('readme.md'),
  );
}

// ------------------------------------------------------------ AC-17 status

export interface DerivedStatus {
  status: OnboardingStatus;
  reason: string;
}

/**
 * One enumerated status + human reason from the collected facts and the
 * repo's index state (AC-17), following `blast/helpers.ts`'s `deriveStatus`
 * shape. Covers every non-failure outcome: called BEFORE the LLM call to
 * decide whether to skip it (no_clone / not_indexed), and AFTER a successful
 * call to label what was persisted (partial_index / ok) — by the time the
 * second call site runs, `isBelowMinimum` has already ruled out no_clone/
 * not_indexed, so it only ever returns partial_index/ok there.
 *
 * `degradedReason: 'repo_too_large'` reads differently from a plain
 * `'no_data'` (AC-16, E-2, E-3) even though both fall under the same
 * `not_indexed` enum value — `OnboardingStatus` has no slot for a 7th state,
 * so the distinction lives in `reason`, which the response always carries.
 */
export function deriveStatus(indexState: IndexState, facts: CollectedFacts): DerivedStatus {
  if (facts.noClone) {
    return {
      status: 'no_clone',
      reason: 'This repo has no local clone yet — clone it before generating an onboarding tour.',
    };
  }
  if (indexState.degradedReason === 'repo_too_large') {
    return {
      status: 'not_indexed',
      reason:
        'This repo is too large to index — the tour is built from a bounded, deterministic file sample instead of the import graph.',
    };
  }
  if (isBelowMinimum(facts) || indexState.status === 'degraded' || indexState.status === 'failed') {
    return {
      status: 'not_indexed',
      reason:
        'This repo has not been indexed yet — the tour is built from a bounded, deterministic file sample instead of the import graph.',
    };
  }
  if (indexState.status === 'partial') {
    return {
      status: 'partial_index',
      reason: `Generated from a partial index of ${indexState.filesIndexed} files — some files may be missing.`,
    };
  }
  return { status: 'ok', reason: `Generated from a full index of ${indexState.filesIndexed} files.` };
}

// ---------------------------------------------------------- AC-7/AC-8/AC-14

/** Every path a section may legitimately cite — ranked files, run-locally
 *  source files, and every file in a critical-path chain. A link/path NOT in
 *  this set is dropped in code (AC-7), never trusted from the model, which
 *  also means a `../../etc/passwd`-shaped path never survives (AC-35's
 *  server half) since it can never be a member of this allowlist. */
export function knownPaths(facts: CollectedFacts): Set<string> {
  return new Set<string>([
    ...facts.rankedFiles,
    ...facts.runLocallySources.map((s) => s.path),
    ...facts.criticalPathChains.flat(),
  ]);
}

const FENCE_RE = /```([a-zA-Z0-9]*)\n([\s\S]*?)```/g;

/** Every shell command in `run_locally` must be reproduced verbatim from a
 *  real run-locally source file (AC-8) — checked per fenced-code-block line;
 *  a line not found (trimmed, substring match) anywhere in the sources is
 *  dropped, and a fence left with nothing but blank/comment lines is removed
 *  entirely rather than rendered empty. */
export function groundRunLocallyBody(body: string, sources: FileExcerpt[]): string {
  const haystack = sources.map((s) => s.content).join('\n');
  return body.replace(FENCE_RE, (whole, lang: string, code: string) => {
    const lines = code.split('\n');
    const kept = lines.filter((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith('#')) return true;
      return haystack.includes(trimmed);
    });
    if (kept.every((l) => l.trim().length === 0 || l.trim().startsWith('#'))) return '';
    return '```' + lang + '\n' + kept.join('\n') + '```';
  });
}

/** Cap the total number of non-blank, non-comment fenced-code lines across
 *  the WHOLE `run_locally` body to `MAX_RUN_LOCALLY_STEPS` (AC-14) —
 *  dropping trailing steps deterministically, never scrolled. */
function capRunLocallySteps(body: string, maxSteps: number): string {
  let seen = 0;
  return body.replace(FENCE_RE, (whole, lang: string, code: string) => {
    const lines = code.split('\n');
    const kept: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      const isStep = trimmed.length > 0 && !trimmed.startsWith('#');
      if (isStep) {
        if (seen >= maxSteps) continue; // drop excess steps, keep counting
        seen += 1;
      }
      kept.push(line);
    }
    if (kept.every((l) => l.trim().length === 0 || l.trim().startsWith('#'))) return '';
    return '```' + lang + '\n' + kept.join('\n') + '```';
  });
}

/** Top-level Markdown bullet/numbered lines (`- `, `* `, `1. `). A line
 *  belongs to the PRECEDING item until the next top-level marker. */
const BULLET_RE = /^\s*(?:[-*]|\d+\.)\s+/;

/** Cap a markdown body to its first `maxItems` top-level bullet/numbered
 *  list items (AC-14) — dropping the rest (and their continuation lines)
 *  deterministically. Non-list prose (a heading, an intro sentence) is left
 *  untouched. */
export function capBulletItems(body: string, maxItems: number): string {
  const lines = body.split('\n');
  const out: string[] = [];
  let itemCount = 0;
  let dropping = false;
  for (const line of lines) {
    if (BULLET_RE.test(line)) {
      itemCount += 1;
      dropping = itemCount > maxItems;
    }
    if (!dropping) out.push(line);
  }
  return out.join('\n');
}

/** Grounding + capping for one LLM-authored section (AC-7, AC-8, AC-14, D-8)
 *  — pure, no I/O. `diagram` is forced to `null` for every kind but
 *  `architecture`, matching the template's own rule regardless of what the
 *  model returned. */
export function groundAndCapSection(
  section: OnboardingSection,
  facts: CollectedFacts,
): OnboardingSection {
  const paths = knownPaths(facts);
  const links: OnboardingLink[] = section.links
    .filter((l) => paths.has(l.path))
    .slice(0, MAX_LINKS_PER_SECTION);

  let body = section.body;
  if (section.kind === 'run_locally') {
    body = groundRunLocallyBody(body, facts.runLocallySources);
    body = capRunLocallySteps(body, MAX_RUN_LOCALLY_STEPS);
  } else if (section.kind === 'reading_path') {
    body = capBulletItems(body, MAX_READING_PATH_ENTRIES);
  } else if (section.kind === 'critical_paths') {
    body = capBulletItems(body, MAX_CRITICAL_PATH_ROWS);
  } else if (section.kind === 'first_tasks') {
    body = capBulletItems(body, MAX_FIRST_TASK_CARDS);
  }

  return {
    kind: section.kind,
    title: section.title,
    body,
    diagram: section.kind === 'architecture' ? (section.diagram ?? null) : null,
    links,
  };
}

export function groundAndCapSections(
  sections: OnboardingSection[],
  facts: CollectedFacts,
): OnboardingSection[] {
  return sections.map((s) => groundAndCapSection(s, facts));
}

// -------------------------------------------------------- AC-19/AC-22/UX-13
// Deterministic skeleton — model-free facts only, rendered when the LLM call
// is skipped (below-minimum) or failed. Never an empty body dressed as
// success (AC-22) — every section gets a real fallback line (UX-13).

export interface DeterministicCommand {
  command: string;
  source: string;
}

/** Deterministic "how to run locally" commands, with NO model: `package.json`
 *  scripts (attributed to their file), plus verbatim fenced-code lines from
 *  README/compose/`.env.example` (E-7, AC-8, AC-34). */
export function extractDeterministicCommands(sources: FileExcerpt[]): DeterministicCommand[] {
  const out: DeterministicCommand[] = [];
  for (const source of sources) {
    if (source.path.endsWith('package.json')) {
      try {
        const pkg = JSON.parse(source.content) as { scripts?: Record<string, string> };
        for (const [name, script] of Object.entries(pkg.scripts ?? {})) {
          out.push({ command: `npm run ${name}  # ${script}`, source: source.path });
        }
      } catch {
        // unparseable package.json — no scripts to extract, never throw
      }
      continue;
    }
    for (const match of source.content.matchAll(FENCE_RE)) {
      const code = match[2] ?? '';
      for (const line of code.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
        out.push({ command: trimmed, source: source.path });
      }
    }
  }
  return out;
}

const NO_SUMMARY_YET = 'No AI-generated summary is available yet.';

/** The five sections, built ONLY from facts that need no model: indexed file
 *  count/status, `extractDeterministicCommands`'s verified run-locally
 *  commands, and the ranked file list where available (AC-22) — a fallback
 *  one-line reason per reading-path entry (UX-13), never an empty body
 *  dressed as success. */
export function buildSkeletonSections(facts: CollectedFacts): OnboardingSection[] {
  const architectureBody =
    facts.rankedFiles.length > 0
      ? `${NO_SUMMARY_YET} Top-ranked files by import graph:\n\n${facts.rankedFiles
          .slice(0, MAX_READING_PATH_ENTRIES)
          .map((p) => `- \`${p}\``)
          .join('\n')}`
      : `${NO_SUMMARY_YET} No import-graph data was found for this repo.`;

  const criticalPathsBody =
    facts.criticalPathChains.length > 0
      ? facts.criticalPathChains
          .slice(0, MAX_CRITICAL_PATH_ROWS)
          .map((chain) => `- ${chain.map((p) => `\`${p}\``).join(' → ')}`)
          .join('\n')
      : 'No dependency chains are available yet — this repo has no usable import graph.';

  const commands = extractDeterministicCommands(facts.runLocallySources);
  const runLocallyBody =
    commands.length > 0
      ? commands
          .slice(0, MAX_RUN_LOCALLY_STEPS)
          .map((c) => `- \`${c.command}\` (from \`${c.source}\`)`)
          .join('\n')
      : "No run-locally instructions were found in this repo's package.json, README, compose file, or .env.example.";

  const readingPathBody =
    facts.rankedFiles.length > 0
      ? facts.rankedFiles
          .slice(0, MAX_READING_PATH_ENTRIES)
          .map(
            (p, i) =>
              `${i + 1}. \`${p}\` — ${
                facts.flatRank
                  ? 'no import-graph signal available; order is not importance'
                  : 'one of the most-imported files in this repo'
              }.`,
          )
          .join('\n')
      : 'No ranked file order is available yet — this repo has not been indexed.';

  const firstTasksBody =
    'First tasks are not available until an onboarding tour is generated for a usable index.';

  const sections: Record<(typeof ONBOARDING_SECTION_KINDS)[number], { title: string; body: string }> = {
    architecture: { title: 'Architecture overview', body: architectureBody },
    critical_paths: { title: 'Critical paths', body: criticalPathsBody },
    run_locally: { title: 'How to run locally', body: runLocallyBody },
    reading_path: { title: 'Guided reading path', body: readingPathBody },
    first_tasks: { title: 'First tasks', body: firstTasksBody },
  };

  return ONBOARDING_SECTION_KINDS.map((kind) => ({
    kind,
    title: sections[kind].title,
    body: sections[kind].body,
    diagram: null,
    links: [],
  }));
}
