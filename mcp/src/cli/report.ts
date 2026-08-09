import type { Finding } from '@devdigest/shared';

/** Terminal rendering for the pre-push CLI. stdout is the human report; see `cli.ts`. */

function severityCounts(findings: Finding[]): Record<'CRITICAL' | 'WARNING' | 'SUGGESTION', number> {
  const c = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const f of findings) c[f.severity] += 1;
  return c;
}

function locate(f: Finding): string {
  return `${f.file}:${f.start_line}${f.end_line !== f.start_line ? `-${f.end_line}` : ''}`;
}

/**
 * One line per finding as `SEVERITY  path:line  title`, then the rationale,
 * then a summary line (`N findings — X critical, Y warning, Z suggestion`).
 */
export function renderReport(findings: Finding[]): string {
  const c = severityCounts(findings);
  const summary = `${findings.length} finding${findings.length === 1 ? '' : 's'} — ${c.CRITICAL} critical, ${c.WARNING} warning, ${c.SUGGESTION} suggestion`;

  if (findings.length === 0) {
    return `No findings — nothing to report.\n\n${summary}`;
  }

  const blocks = findings.map((f) => {
    const header = `${f.severity.padEnd(10)}${locate(f)}  ${f.title}`;
    const suggestion = f.suggestion ? `\n  Suggestion: ${f.suggestion}` : '';
    return `${header}\n  ${f.rationale}${suggestion}`;
  });

  return `${blocks.join('\n\n')}\n\n${summary}`;
}

/** `--json` output — the same data, machine-readable. */
export function renderJson(findings: Finding[], blockers: number): string {
  const c = severityCounts(findings);
  return JSON.stringify(
    {
      findings,
      summary: { total: findings.length, ...c, blockers },
    },
    null,
    2,
  );
}
