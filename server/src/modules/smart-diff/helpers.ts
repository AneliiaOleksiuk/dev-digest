/**
 * Pure Smart Diff helpers — path classification, grouping, split suggestion.
 * No DB / adapter / container imports (onion `no-helpers-to-io`).
 */
import type {
  ProposedSplit,
  SmartDiffFile,
  SmartDiffGroup,
  SmartDiffRole,
} from '@devdigest/shared';
import {
  BOILERPLATE_BASENAME_MARKERS,
  BOILERPLATE_BASENAMES,
  BOILERPLATE_DIR_SEGMENTS,
  BOILERPLATE_EXTENSIONS,
  BOILERPLATE_LOCKFILES,
  BOILERPLATE_TEST_SEGMENTS,
  MAX_FINDING_LINES_PER_FILE,
  SPLIT_SUGGESTION_MAX_LINES,
  WIRING_BOOTSTRAP_BASENAMES,
  WIRING_CONFIG_BASENAMES,
  WIRING_DIR_SEGMENTS,
  WIRING_EXTENSIONS,
} from './constants.js';

export interface PrFileInput {
  path: string;
  additions: number;
  deletions: number;
}

export interface FindingLineInput {
  file: string;
  start_line: number;
  end_line?: number;
}

export interface SplitSuggestion {
  too_big: boolean;
  total_lines: number;
  proposed_splits: ProposedSplit[];
}

const ROLE_ORDER: SmartDiffRole[] = ['core', 'wiring', 'boilerplate'];

/** POSIX-normalise + lowercase for deterministic matching. */
export function normalisePath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? path;
}

function segments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function isTestBasename(name: string): boolean {
  // foo.test.ts, foo.spec.tsx, foo.test.js, …
  return /\.(test|spec)\.[^.]+$/.test(name);
}

function isConfigBasename(name: string): boolean {
  if (/^tsconfig(\..+)?\.json$/.test(name)) return true;
  if (/\.config\.(ts|js|mjs|cjs|json)$/.test(name)) return true;
  if (/^docker-compose(\..+)?\.(yml|yaml)$/.test(name)) return true;
  if (/^\.env(\..+)?$/.test(name) || name === '.env') return true;
  return false;
}

function matchesExtension(name: string, ext: string): boolean {
  return name.endsWith(ext);
}

function isBoilerplate(_norm: string, name: string, segs: string[]): boolean {
  if ((BOILERPLATE_LOCKFILES as readonly string[]).includes(name)) return true;
  if ((BOILERPLATE_BASENAMES as readonly string[]).includes(name)) return true;
  if (segs.some((s) => (BOILERPLATE_DIR_SEGMENTS as readonly string[]).includes(s))) return true;
  if (segs.some((s) => (BOILERPLATE_TEST_SEGMENTS as readonly string[]).includes(s))) return true;
  if (isTestBasename(name)) return true;
  if ((BOILERPLATE_EXTENSIONS as readonly string[]).some((ext) => matchesExtension(name, ext))) {
    return true;
  }
  if ((BOILERPLATE_BASENAME_MARKERS as readonly string[]).some((m) => name.includes(m))) {
    return true;
  }
  return false;
}

function isWiring(_norm: string, name: string, segs: string[]): boolean {
  if ((WIRING_BOOTSTRAP_BASENAMES as readonly string[]).includes(name)) return true;
  if ((WIRING_CONFIG_BASENAMES as readonly string[]).includes(name)) return true;
  if (isConfigBasename(name)) return true;
  if (segs.some((s) => (WIRING_DIR_SEGMENTS as readonly string[]).includes(s))) return true;
  if ((WIRING_EXTENSIONS as readonly string[]).some((ext) => matchesExtension(name, ext))) {
    return true;
  }
  return false;
}

/**
 * Classify a file path into core / wiring / boilerplate.
 * Order: boilerplate → wiring → core (default).
 */
export function classifyPath(path: string): SmartDiffRole {
  const norm = normalisePath(path);
  const name = basename(norm);
  const segs = segments(norm);

  if (isBoilerplate(norm, name, segs)) return 'boilerplate';
  if (isWiring(norm, name, segs)) return 'wiring';
  return 'core';
}

/** Unique ascending pin lines for a path — prefer start_line (trigger citation). */
export function findingLinesFor(findings: FindingLineInput[], path: string): number[] {
  const lines = new Set<number>();
  for (const f of findings) {
    if (f.file !== path) continue;
    const pin = Math.max(1, Math.trunc(f.start_line));
    lines.add(pin);
  }
  return [...lines].sort((a, b) => a - b).slice(0, MAX_FINDING_LINES_PER_FILE);
}

/**
 * Group PR files by role. Empty groups omitted.
 * Within a group: size desc, path asc. pseudocode_summary always null (no LLM).
 */
export function groupFiles(
  files: PrFileInput[],
  findings: FindingLineInput[],
): SmartDiffGroup[] {
  const buckets: Record<SmartDiffRole, SmartDiffFile[]> = {
    core: [],
    wiring: [],
    boilerplate: [],
  };

  for (const file of files) {
    const role = classifyPath(file.path);
    buckets[role].push({
      path: file.path,
      // Always null this iteration — docs/plans/smart-diff.md (no LLM summaries).
      pseudocode_summary: null,
      additions: file.additions,
      deletions: file.deletions,
      finding_lines: findingLinesFor(findings, file.path),
    });
  }

  for (const role of ROLE_ORDER) {
    buckets[role].sort((a, b) => {
      const sizeDiff = b.additions + b.deletions - (a.additions + a.deletions);
      if (sizeDiff !== 0) return sizeDiff;
      return a.path.localeCompare(b.path);
    });
  }

  return ROLE_ORDER.filter((role) => buckets[role].length > 0).map((role) => ({
    role,
    files: buckets[role],
  }));
}

/**
 * too_big when totalLines > SPLIT_SUGGESTION_MAX_LINES.
 * proposed_splits = one per non-empty role only when too_big and ≥2 groups.
 */
export function buildSplitSuggestion(
  groups: SmartDiffGroup[],
  totalLines: number,
): SplitSuggestion {
  const too_big = totalLines > SPLIT_SUGGESTION_MAX_LINES;
  const proposed_splits: ProposedSplit[] =
    too_big && groups.length >= 2
      ? groups.map((g) => ({
          name: g.role,
          files: g.files.map((f) => f.path),
        }))
      : [];

  return { too_big, total_lines: totalLines, proposed_splits };
}
