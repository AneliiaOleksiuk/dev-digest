import type { Conflict, ConflictTake, FindingGroup, FindingGroupMember, Severity } from '@devdigest/shared';

/**
 * L07 (SPEC-04) — pure derivation of the two batch-read-only views over a
 * multi-agent run's findings: near-duplicate groups (AC-22..AC-25) and
 * "where agents disagree" conflicts. NO infrastructure imports, no DB
 * access, no mutation of inputs — everything here is derived at READ time
 * from already-persisted findings (see `multi-agent-read.ts`, the only
 * caller) and mutates nothing.
 */

/** A finding as seen by this module — a flat projection of the persisted
 *  `FindingRow` plus the run/agent it came from. */
export interface DerivableFinding {
  id: string;
  run_id: string;
  agent_id: string;
  agent_name: string;
  file: string;
  start_line: number;
  end_line: number;
  category: string;
  severity: Severity;
  title: string;
  rationale: string;
  suggestion?: string | null;
  confidence: number;
}

/** One child run of the batch, with only the findings it actually persisted
 *  (a failed/cancelled run has none — the app never inserts findings for
 *  those; see `run-executor.ts`). */
export interface DerivableRun {
  run_id: string;
  agent_id: string;
  agent_name: string;
  status: 'done' | 'failed' | 'running' | 'cancelled';
  findings: DerivableFinding[];
}

/**
 * Normalize a file path for GROUPING/CONFLICT comparison ONLY (E-12) — NEVER
 * used for filesystem access. Collapses backslashes to forward slashes and
 * strips a leading `./` so `./src/x.ts`, `src/x.ts`, and `src\x.ts` (an
 * agent on a different OS) compare equal.
 */
export function normalizeFilePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

const LINE_EXPANSION = 3;
const MAX_SPAN_FOR_EXPANSION = 20;

/** The [start, end] range a finding contributes to an overlap check —
 *  expanded by ±3 lines ONLY when the finding's OWN span is ≤20 lines. A
 *  finding spanning MORE than 20 lines is never expanded, so it can't
 *  swallow unrelated nearby findings into its group. */
function expandedRange(f: DerivableFinding): [number, number] {
  const span = f.end_line - f.start_line + 1;
  if (span <= MAX_SPAN_FOR_EXPANSION) {
    return [f.start_line - LINE_EXPANSION, f.end_line + LINE_EXPANSION];
  }
  return [f.start_line, f.end_line];
}

function rangesOverlap(a: [number, number], b: [number, number]): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

/** Only runs that COMPLETED SUCCESSFULLY participate in every derived view
 *  (groups AND conflicts) — `failed`/`cancelled` runs are excluded outright
 *  (never even reported as an 'ignored' take), and a still-`running` run
 *  hasn't finished evaluating yet, so it's excluded too rather than being
 *  treated as silently ignoring every location. */
function participatingRuns(runs: DerivableRun[]): DerivableRun[] {
  return runs.filter((r) => r.status === 'done');
}

// ---- Groups (AC-22..AC-25) --------------------------------------------------

/**
 * Cluster findings from participating runs into near-duplicate groups: same
 * (normalized-path) file, same category, and overlapping ranges after the
 * ±3-line expansion rule above. A finding flagged by only one agent still
 * comes back as a group of one (AC-25). Implemented as union-find over the
 * flat finding list — O(n²) within each (file, category) bucket, which is
 * fine at one batch's finding-count scale.
 */
export function deriveFindingGroups(runs: DerivableRun[]): FindingGroup[] {
  const findings = participatingRuns(runs).flatMap((r) => r.findings);
  const n = findings.length;
  if (n === 0) return [];

  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const union = (i: number, j: number) => {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  };

  const byFileCategory = new Map<string, number[]>();
  findings.forEach((f, i) => {
    const key = `${normalizeFilePath(f.file)}::${f.category}`;
    const list = byFileCategory.get(key);
    if (list) list.push(i);
    else byFileCategory.set(key, [i]);
  });

  for (const indices of byFileCategory.values()) {
    for (let a = 0; a < indices.length; a++) {
      for (let b = a + 1; b < indices.length; b++) {
        const i = indices[a]!;
        const j = indices[b]!;
        if (rangesOverlap(expandedRange(findings[i]!), expandedRange(findings[j]!))) {
          union(i, j);
        }
      }
    }
  }

  const clusters = new Map<number, number[]>();
  findings.forEach((_, i) => {
    const root = find(i);
    const list = clusters.get(root);
    if (list) list.push(i);
    else clusters.set(root, [i]);
  });

  const groups: FindingGroup[] = [];
  for (const indices of clusters.values()) {
    const members: FindingGroupMember[] = indices.map((i) => {
      const f = findings[i]!;
      return {
        id: f.id,
        run_id: f.run_id,
        agent_id: f.agent_id,
        agent_name: f.agent_name,
        severity: f.severity,
        title: f.title,
        rationale: f.rationale,
        suggestion: f.suggestion ?? null,
        confidence: f.confidence,
      };
    });
    const first = findings[indices[0]!]!;
    groups.push({
      file: first.file,
      normalized_file: normalizeFilePath(first.file),
      start_line: Math.min(...indices.map((i) => findings[i]!.start_line)),
      end_line: Math.max(...indices.map((i) => findings[i]!.end_line)),
      category: first.category as FindingGroup['category'],
      members,
    });
  }

  // Deterministic order for a stable UI (no meaning otherwise).
  groups.sort(
    (a, b) => a.normalized_file.localeCompare(b.normalized_file) || a.start_line - b.start_line,
  );
  return groups;
}

// ---- Conflicts ---------------------------------------------------------------

/**
 * Every shared location — category-agnostic (deliberately a different
 * criterion from groups: the same location can be "not a duplicate" for
 * grouping but still be a location worth comparing takes on). A location is
 * EVERY distinct (normalized file, exact start_line) mentioned by at least
 * one participating run's finding — the "one per-location index" the plan
 * describes: for every such location, every participating run gets a take —
 * its own finding there, or `'ignored'` when it completed successfully and
 * simply didn't flag that exact line.
 *
 * Emits EVERY such location, not just genuine conflicts (AC-31's OFF state
 * needs the full set — including locations where every agent agrees). This
 * function does NOT decide what counts as a "genuine conflict" per AC-30
 * (a silent/`'ignored'` participant, OR 2+ non-ignored takes with differing
 * severity) — every entry's `takes[]` already carries everything a consumer
 * needs to compute that locally; do not pre-filter here.
 */
export function deriveConflicts(runs: DerivableRun[]): Conflict[] {
  const active = participatingRuns(runs);
  if (active.length < 2) return [];

  const locations = new Map<string, { file: string; line: number }>();
  for (const run of active) {
    for (const f of run.findings) {
      const key = `${normalizeFilePath(f.file)}::${f.start_line}`;
      if (!locations.has(key)) locations.set(key, { file: f.file, line: f.start_line });
    }
  }

  const conflicts: Conflict[] = [];
  for (const [key, loc] of locations) {
    const takes: ConflictTake[] = [];
    let title = '';
    for (const run of active) {
      const hit = run.findings.find((f) => `${normalizeFilePath(f.file)}::${f.start_line}` === key);
      if (hit) {
        if (!title) title = hit.title;
        takes.push({
          agent_id: run.agent_id,
          persona: run.agent_name,
          verdict: hit.severity,
          note: hit.rationale,
        });
      } else {
        takes.push({
          agent_id: run.agent_id,
          persona: run.agent_name,
          verdict: 'ignored',
          note: 'Not flagged by this agent.',
        });
      }
    }

    // Emit every location unconditionally (AC-31 OFF state) — the caller/
    // consumer computes AC-30's "genuine conflict" criterion locally from
    // `takes[]` (a silent/'ignored' participant, OR 2+ non-ignored takes
    // with differing severity) rather than this function pre-filtering.
    conflicts.push({ file: loc.file, line: loc.line, title, takes });
  }

  conflicts.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return conflicts;
}
