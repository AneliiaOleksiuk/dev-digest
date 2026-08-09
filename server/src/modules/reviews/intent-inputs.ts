import { join, resolve, sep } from 'node:path';
import type { Intent, IntentSource, UnifiedDiff } from '@devdigest/shared';

/**
 * Pure builders for the Intent classifier's input and output rendering. NO I/O
 * here — no `db`/`adapters`/`container` imports. `IntentService`
 * (`intent-service.ts`) is the only caller and owns all the actual fetching
 * (GitHub issue, spec files, diff loading); this file only shapes strings and
 * makes deterministic decisions from already-fetched data.
 *
 * `synthesizeHunkHeaders`'s parameter type (`IntentDiffSummary`) is narrower
 * than `UnifiedDiff` on purpose: it has no `raw` field and no hunk body text at
 * all, only the four numeric fields a `@@ -a,b +c,d @@` header needs. That
 * makes "the classifier's input never contains diff/hunk bodies" a
 * signature-level guarantee inside this function, not a comment — the
 * function's own code cannot reference `.raw` because the type has none.
 */

// ---------------------------------------------------------------- diff summary

export interface IntentDiffHunkSummary {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

export interface IntentDiffFileSummary {
  path: string;
  additions: number;
  deletions: number;
  hunks: IntentDiffHunkSummary[];
}

export interface IntentDiffSummary {
  files: IntentDiffFileSummary[];
}

/** Cap per §B — 200 files × 20 hunks — so a huge diff can't blow the
 *  classifier's context or cost. */
const MAX_FILES = 200;
const MAX_HUNKS_PER_FILE = 20;

/**
 * Convert an already-loaded `UnifiedDiff` into the narrowed summary the
 * classifier is allowed to see — strips `raw` and each hunk's
 * `file`/`newLineNumbers`, keeping only the four numeric fields a header
 * needs. The one place both callers (`run-executor.ts`'s shared pre-work,
 * `intent-service.ts`'s manual-route path) do this conversion.
 */
export function toIntentDiffSummary(diff: UnifiedDiff): IntentDiffSummary {
  return {
    files: diff.files.map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      hunks: f.hunks.map((h) => ({
        oldStart: h.oldStart,
        oldLines: h.oldLines,
        newStart: h.newStart,
        newLines: h.newLines,
      })),
    })),
  };
}

/**
 * `path (+additions/-deletions)` per file, followed by one synthesized
 * `@@ -oldStart,oldLines +newStart,newLines @@` line per hunk — never the
 * hunk body itself (the input type has no body text to leak).
 */
export function synthesizeHunkHeaders(files: IntentDiffFileSummary[]): string {
  return files
    .slice(0, MAX_FILES)
    .map((file) => {
      const header = `${file.path} (+${file.additions}/-${file.deletions})`;
      const hunkLines = file.hunks
        .slice(0, MAX_HUNKS_PER_FILE)
        .map((h) => `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
      return [header, ...hunkLines].join('\n');
    })
    .join('\n\n');
}

// ---------------------------------------------------------------- references

export interface ExtractedReferences {
  issueNumbers: number[];
  localPaths: string[];
  externalUrls: string[];
}

/** Same pattern as `OctokitGitHub.resolveLinkedIssue` — `(closes|fixes|resolves)?\s*#(\d+)`. */
const ISSUE_REF_RE = /(?:closes|fixes|resolves)?\s*#(\d+)/gi;
/** Markdown links pointing at a local `.md` file, e.g. `[spec](specs/foo.md)`. */
const MD_LINK_RE = /\[[^\]]*\]\(([^)\s]+\.md)\)/gi;
/** Bare inline `.md` path mentions, not already inside a markdown link. */
const MD_BARE_RE = /(?<![[(])\b([\w.-]+(?:\/[\w.-]+)*\.md)\b/gi;
const URL_RE = /https?:\/\/[^\s)]+/gi;

/**
 * Regexes the PR description LOCALLY (no fetch) for: issue numbers, local
 * `.md` path references, and external URLs (Jira/Notion/Linear/foreign
 * GitHub — recorded as unresolved, never fetched; see §B / §D).
 */
export function extractReferences(body: string): ExtractedReferences {
  const issueNumbers = [
    ...new Set([...body.matchAll(ISSUE_REF_RE)].map((m) => Number(m[1])).filter((n) => Number.isFinite(n))),
  ];

  const mdRefs = new Set<string>();
  for (const m of body.matchAll(MD_LINK_RE)) mdRefs.add(m[1]!);
  for (const m of body.matchAll(MD_BARE_RE)) mdRefs.add(m[1]!);

  const localPaths = new Set<string>();
  const externalUrls = new Set<string>();
  for (const ref of mdRefs) {
    if (/^https?:\/\//i.test(ref)) externalUrls.add(ref);
    else localPaths.add(ref);
  }
  // Any other URL (Jira/Notion/Linear/foreign GitHub, not ending in `.md`) —
  // `.md` URLs were already classified above via `mdRefs`.
  for (const m of body.matchAll(URL_RE)) {
    if (!m[0].endsWith('.md')) externalUrls.add(m[0]);
  }

  return { issueNumbers, localPaths: [...localPaths], externalUrls: [...externalUrls] };
}

// ---------------------------------------------------------------- path guard

/**
 * Path-traversal guard (`security` skill): resolve `ref` against `clonePath`
 * and reject unless the result stays inside the clone. A
 * `../../etc/passwd`-style reference lands in the *unresolved* bucket, never
 * reads a file. Returns the safe absolute path, or `null` when it escapes.
 */
export function isInsideClone(clonePath: string, ref: string): string | null {
  const target = resolve(join(clonePath, ref));
  const root = resolve(clonePath) + sep;
  return target.startsWith(root) ? target : null;
}

// ---------------------------------------------------------------- confidence

/** §A.4 — the floor is meaningful, the ceiling is not: cap the model's
 *  self-reported confidence whenever ANY source is unresolved. */
export const CONFIDENCE_CAP_ON_UNRESOLVED = 0.5;

export function capConfidence(
  modelConfidence: number | null | undefined,
  sources: IntentSource[],
): number | null {
  if (modelConfidence == null) return null;
  const hasUnresolved = sources.some((s) => !s.resolved);
  return hasUnresolved ? Math.min(modelConfidence, CONFIDENCE_CAP_ON_UNRESOLVED) : modelConfidence;
}

// ---------------------------------------------------------------- rendering

/**
 * Plain-text block handed to `reviewer-core` as `PromptParts.intent`
 * (pre-rendered, same contract as `callers`/`repoMap`). Keeps `reviewer-core`
 * free of any new contract coupling.
 */
export function renderIntentBlock(intent: Intent): string {
  const lines: string[] = [intent.intent];

  if (intent.in_scope.length > 0) {
    lines.push('', 'In scope:', ...intent.in_scope.map((s) => `- ${s}`));
  }
  if (intent.out_of_scope.length > 0) {
    lines.push('', 'Out of scope:', ...intent.out_of_scope.map((s) => `- ${s}`));
  }
  if (intent.risk_areas.length > 0) {
    lines.push('', 'Risk areas:', ...intent.risk_areas.map((s) => `- ${s}`));
  }
  if (intent.confidence != null) {
    lines.push('', `Confidence: ${intent.confidence.toFixed(2)}`);
  }
  if (intent.missing_context.length > 0) {
    lines.push('', 'Missing context (could not be retrieved):', ...intent.missing_context.map((s) => `- ${s}`));
  }

  return lines.join('\n');
}

/**
 * Resolved spec/plan file paths from an intent record's `sources[]`
 * (`kind === 'spec_file' && resolved && ref`). Used by `run-executor` to
 * populate `RunTrace.specs_read` — only on a *fresh* classification this run,
 * never on a head-SHA cache hit (those paths were read in an earlier run).
 */
export function specPathsFrom(intent: { sources: IntentSource[] }): string[] {
  return intent.sources
    .filter((s): s is IntentSource & { ref: string } => s.kind === 'spec_file' && s.resolved && !!s.ref)
    .map((s) => s.ref);
}
