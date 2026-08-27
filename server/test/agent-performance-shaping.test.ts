import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toAgentStats, toAgentPerf, type AgentMeta } from '../src/modules/agents/performance.js';
import type { PerfRangeResult } from '../src/modules/reviews/repository/run.repo.js';

/**
 * SPEC-06 WI3 — pure shaping helpers (`toAgentStats`/`toAgentPerf`).
 *
 * Oracle derived from docs/plans/spec-06-agent-performance-dashboard.md
 * (Test plan → Coverage test-writer must add: AC-7, AC-8, AC-21, AC-9,
 * AC-12) and specs/SPEC-06-agent-performance-dashboard.md (AC-7, AC-8, AC-9,
 * AC-12, AC-21, AC-23, AC-24, AC-27) BEFORE reading `performance.ts` in
 * depth beyond the WI2/WI3 wiring facts (import paths, exported names).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENTS_MODULE_DIR = path.resolve(__dirname, '../src/modules/agents');

function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectTsFiles(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const RANGE = { start: new Date('2026-01-01T00:00:00.000Z'), end: new Date('2026-02-01T00:00:00.000Z') };

const AGENT_A: AgentMeta = { id: 'agent-a', name: 'Security Reviewer', provider: 'openai', model: 'gpt-4.1' };
const AGENT_B: AgentMeta = { id: 'agent-b', name: 'Style Bot', provider: 'anthropic', model: 'claude-x' };

describe('AC-7 — one aggregation, two projections (grep-level: no second accept-rate/cost formula)', () => {
  it('toAgentStats(single-agent call) and toAgentPerf(workspace-agents call) produce IDENTICAL numbers for the same agent from the SAME fixture run-set', () => {
    const data: PerfRangeResult = {
      runs: [
        { agentId: 'agent-a', model: 'gpt-4.1', costUsd: 0.01, durationMs: 1000, findingsCount: 2, ranAt: new Date('2026-01-05T00:00:00.000Z') },
        { agentId: 'agent-a', model: 'gpt-4.1', costUsd: 0.03, durationMs: 3000, findingsCount: 1, ranAt: new Date('2026-01-10T00:00:00.000Z') },
      ],
      findings: [{ agentId: 'agent-a', severity: 'CRITICAL', total: 2, accepted: 1, dismissed: 1 }],
    };

    // Single call shape — GET /agents/:id/stats passes ONE agent id.
    const stats = toAgentStats(AGENT_A, data, RANGE);
    // Workspace call shape — GET /agents/performance passes ALL workspace agents.
    const perf = toAgentPerf([AGENT_A, AGENT_B], data, RANGE);
    const row = perf.agents.find((r) => r.agent_id === 'agent-a')!;

    expect(row.runs).toBe(stats.runs);
    expect(row.avg_cost_usd).toBe(stats.avg_cost_usd);
    expect(row.avg_latency_ms).toBe(stats.avg_latency_ms);
    expect(row.accept_rate).toBe(stats.accept_rate);
    expect(row.findings_total).toBe(stats.findings_total);
    expect(row.avg_findings_per_run).toBe(stats.avg_findings_per_run);

    // Sanity: the numbers are the real computed values, not both-null.
    expect(stats.runs).toBe(2);
    expect(stats.avg_cost_usd).toBeCloseTo(0.02, 10);
    expect(stats.avg_latency_ms).toBe(2000);
    expect(stats.accept_rate).toBe(0.5);
  });

  it('grep-level: the accept-rate formula is defined exactly once in performance.ts and reused by both projections — no competing formula anywhere else in modules/agents', () => {
    const perfSrc = readFileSync(path.join(AGENTS_MODULE_DIR, 'performance.ts'), 'utf8');
    expect((perfSrc.match(/function acceptRate\(/g) ?? []).length).toBe(1);
    // 2 call sites: toAgentStats and toAgentPerf, and no third.
    expect((perfSrc.match(/\bacceptRate\(accepted, dismissed\)/g) ?? []).length).toBe(2);

    const otherFiles = collectTsFiles(AGENTS_MODULE_DIR).filter((f) => !f.endsWith(`${path.sep}performance.ts`));
    for (const f of otherFiles) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f} must not re-derive an accept-rate formula`).not.toMatch(
        /accepted\s*\/\s*\(?\s*accepted\s*\+\s*dismissed\)?/,
      );
    }
  });

  it('grep-level: per-agent cost/duration aggregation is built by ONE shared aggregateRuns() function, called once per projection', () => {
    const perfSrc = readFileSync(path.join(AGENTS_MODULE_DIR, 'performance.ts'), 'utf8');
    expect((perfSrc.match(/function aggregateRuns\(/g) ?? []).length).toBe(1);
    // 1 definition + 2 call sites (toAgentStats, toAgentPerf) = 3 occurrences of the identifier.
    expect((perfSrc.match(/\baggregateRuns\(/g) ?? []).length).toBe(3);
  });
});

describe('AC-8 — tiles/table rows/donuts all sum from the SAME counted run set', () => {
  it('summary.runs equals the sum of every row.runs, and both cost donuts sum to summary.total_cost_usd', () => {
    const data: PerfRangeResult = {
      runs: [
        { agentId: 'agent-a', model: 'gpt-4.1', costUsd: 0.01, durationMs: 1000, findingsCount: 1, ranAt: new Date('2026-01-05T00:00:00.000Z') },
        { agentId: 'agent-a', model: 'claude-x', costUsd: 0.02, durationMs: 2000, findingsCount: 0, ranAt: new Date('2026-01-06T00:00:00.000Z') },
        { agentId: 'agent-b', model: 'claude-x', costUsd: 0.05, durationMs: 500, findingsCount: 3, ranAt: new Date('2026-01-07T00:00:00.000Z') },
      ],
      findings: [
        { agentId: 'agent-a', severity: 'CRITICAL', total: 1, accepted: 1, dismissed: 0 },
        { agentId: 'agent-b', severity: 'WARNING', total: 3, accepted: 2, dismissed: 1 },
      ],
    };

    const perf = toAgentPerf([AGENT_A, AGENT_B], data, RANGE);

    const rowRunsSum = perf.agents.reduce((s, r) => s + r.runs, 0);
    expect(rowRunsSum).toBe(perf.summary.runs);
    expect(perf.summary.runs).toBe(3);

    const costByAgentSum = perf.cost_by_agent.reduce((s, seg) => s + seg.value, 0);
    const costByModelSum = perf.cost_by_model.reduce((s, seg) => s + seg.value, 0);
    expect(costByAgentSum).toBeCloseTo(perf.summary.total_cost_usd!, 10);
    expect(costByModelSum).toBeCloseTo(perf.summary.total_cost_usd!, 10);
    expect(perf.summary.total_cost_usd).toBeCloseTo(0.08, 10);
  });
});

describe('AC-21 — cost_by_agent / cost_by_model each reconcile to summary.total_cost_usd, including a NULL-model run', () => {
  it('a run with a NULL model lands in an explicit "unknown model" bucket, not dropped from the reconciliation', () => {
    const data: PerfRangeResult = {
      runs: [
        { agentId: 'agent-a', model: 'gpt-4.1', costUsd: 0.1, durationMs: 1000, findingsCount: 0, ranAt: new Date('2026-01-05T00:00:00.000Z') },
        { agentId: 'agent-a', model: null, costUsd: 0.2, durationMs: 1000, findingsCount: 0, ranAt: new Date('2026-01-06T00:00:00.000Z') },
      ],
      findings: [],
    };

    const perf = toAgentPerf([AGENT_A], data, RANGE);

    expect(perf.summary.total_cost_usd).toBeCloseTo(0.3, 10);
    const costByModelSum = perf.cost_by_model.reduce((s, seg) => s + seg.value, 0);
    expect(costByModelSum).toBeCloseTo(perf.summary.total_cost_usd!, 10);
    // An explicit bucket exists for the NULL-model run — not silently dropped.
    expect(perf.cost_by_model.some((seg) => seg.value > 0 && seg.label !== 'gpt-4.1')).toBe(true);

    const costByAgentSum = perf.cost_by_agent.reduce((s, seg) => s + seg.value, 0);
    expect(costByAgentSum).toBeCloseTo(perf.summary.total_cost_usd!, 10);
  });
});

describe('AC-27 — a NULL cost_usd in the counted set flags the total as partial, never coerced to 0', () => {
  it('total_cost_partial is true and total_cost_usd sums only the NON-null costs', () => {
    const data: PerfRangeResult = {
      runs: [
        { agentId: 'agent-a', model: 'gpt-4.1', costUsd: 0.1, durationMs: 1000, findingsCount: 0, ranAt: new Date('2026-01-05T00:00:00.000Z') },
        { agentId: 'agent-a', model: 'gpt-4.1', costUsd: null, durationMs: 1000, findingsCount: 0, ranAt: new Date('2026-01-06T00:00:00.000Z') },
      ],
      findings: [],
    };

    const perf = toAgentPerf([AGENT_A], data, RANGE);
    expect(perf.summary.total_cost_partial).toBe(true);
    expect(perf.summary.total_cost_usd).toBeCloseTo(0.1, 10);
  });

  it('no NULL cost in the counted set leaves total_cost_partial false', () => {
    const data: PerfRangeResult = {
      runs: [{ agentId: 'agent-a', model: 'gpt-4.1', costUsd: 0.1, durationMs: 1000, findingsCount: 0, ranAt: new Date('2026-01-05T00:00:00.000Z') }],
      findings: [],
    };
    const perf = toAgentPerf([AGENT_A], data, RANGE);
    expect(perf.summary.total_cost_partial).toBe(false);
  });
});

describe('AC-9 — a run not attributable to any scored agent contributes to no total', () => {
  it('a run whose agentId is absent from the `agents` list passed to toAgentPerf is excluded from every row AND from summary.runs/total_cost_usd', () => {
    // Models the AC-9/D-12 invariant at the pure-shaping layer: WI2's SQL
    // query is what actually drops an agent_id-IS-NULL run before this
    // function ever sees it (see the AC-9 integration test in
    // agent-performance.it.test.ts for that DB-level guarantee) — here we
    // assert the shaping helper's own half of the invariant: a run for an
    // agent that isn't in the scored `agents` set never leaks into a total.
    const data: PerfRangeResult = {
      runs: [
        { agentId: 'agent-a', model: 'gpt-4.1', costUsd: 0.01, durationMs: 1000, findingsCount: 0, ranAt: new Date('2026-01-05T00:00:00.000Z') },
        { agentId: 'orphaned-agent', model: 'gpt-4.1', costUsd: 99, durationMs: 99000, findingsCount: 5, ranAt: new Date('2026-01-06T00:00:00.000Z') },
      ],
      findings: [],
    };

    const perf = toAgentPerf([AGENT_A], data, RANGE);
    expect(perf.agents).toHaveLength(1);
    expect(perf.agents[0]!.runs).toBe(1);
    expect(perf.summary.runs).toBe(1);
    expect(perf.summary.total_cost_usd).toBeCloseTo(0.01, 10);
  });
});

describe('AC-12 — accept_rate is null (never 0) when nothing is decided yet', () => {
  it('an agent with runs but zero accepted+dismissed findings yields accept_rate: null on BOTH projections', () => {
    const data: PerfRangeResult = {
      runs: [{ agentId: 'agent-a', model: 'gpt-4.1', costUsd: 0.01, durationMs: 1000, findingsCount: 0, ranAt: new Date('2026-01-05T00:00:00.000Z') }],
      findings: [],
    };

    const stats = toAgentStats(AGENT_A, data, RANGE);
    const perf = toAgentPerf([AGENT_A], data, RANGE);

    expect(stats.accept_rate).toBeNull();
    expect(stats.dismiss_rate).toBeNull();
    expect(perf.agents[0]!.accept_rate).toBeNull();
    expect(perf.agents[0]!.accept_rate).not.toBe(0);
    expect(perf.summary.avg_accept_rate).toBeNull();
  });
});

describe('AC-23 — summary.avg_accept_rate is the POOLED rate, not the unweighted mean of per-agent rates', () => {
  it('two agents with very different decided-findings volumes pool to total-accepted/total-decided, not (rateA+rateB)/2', () => {
    const data: PerfRangeResult = {
      runs: [
        { agentId: 'agent-a', model: 'gpt-4.1', costUsd: 0.01, durationMs: 1000, findingsCount: 1, ranAt: new Date('2026-01-05T00:00:00.000Z') },
        { agentId: 'agent-b', model: 'claude-x', costUsd: 0.01, durationMs: 1000, findingsCount: 1, ranAt: new Date('2026-01-05T00:00:00.000Z') },
      ],
      findings: [
        // agent-a: 1/10 accepted = 10%
        { agentId: 'agent-a', severity: 'WARNING', total: 10, accepted: 1, dismissed: 9 },
        // agent-b: 9/10 accepted = 90%
        { agentId: 'agent-b', severity: 'WARNING', total: 10, accepted: 9, dismissed: 1 },
      ],
    };

    const perf = toAgentPerf([AGENT_A, AGENT_B], data, RANGE);
    // Unweighted mean would be 50%; pooled is (1+9)/(10+10) = 50% too in this
    // SYMMETRIC case, so use an asymmetric second fixture to actually
    // distinguish pooled from unweighted.
    expect(perf.summary.avg_accept_rate).toBeCloseTo(0.5, 10);
  });

  it('asymmetric decided-volume: pooled rate is NOT the simple average of the two per-agent rates', () => {
    const data: PerfRangeResult = {
      runs: [
        { agentId: 'agent-a', model: 'gpt-4.1', costUsd: 0.01, durationMs: 1000, findingsCount: 1, ranAt: new Date('2026-01-05T00:00:00.000Z') },
        { agentId: 'agent-b', model: 'claude-x', costUsd: 0.01, durationMs: 1000, findingsCount: 1, ranAt: new Date('2026-01-05T00:00:00.000Z') },
      ],
      findings: [
        // agent-a: 1 decided, 100% accepted
        { agentId: 'agent-a', severity: 'WARNING', total: 1, accepted: 1, dismissed: 0 },
        // agent-b: 99 decided, 0% accepted
        { agentId: 'agent-b', severity: 'WARNING', total: 99, accepted: 0, dismissed: 99 },
      ],
    };

    const perf = toAgentPerf([AGENT_A, AGENT_B], data, RANGE);
    // Unweighted mean of (100%, 0%) would be 50% — the pooled rate is
    // 1/100 = 1%, which is what AC-23/D-13 requires.
    expect(perf.summary.avg_accept_rate).toBeCloseTo(0.01, 10);
    expect(perf.summary.avg_accept_rate).not.toBeCloseTo(0.5, 5);
  });
});

describe('AC-24 — most_active_agent / most_active_agent_id is the highest run count, ties broken by most recent ran_at', () => {
  it('a strict run-count winner is picked regardless of ran_at', () => {
    const data: PerfRangeResult = {
      runs: [
        { agentId: 'agent-a', model: 'gpt-4.1', costUsd: 0.01, durationMs: 1000, findingsCount: 0, ranAt: new Date('2026-01-01T00:00:00.000Z') },
        { agentId: 'agent-a', model: 'gpt-4.1', costUsd: 0.01, durationMs: 1000, findingsCount: 0, ranAt: new Date('2026-01-02T00:00:00.000Z') },
        { agentId: 'agent-b', model: 'claude-x', costUsd: 0.01, durationMs: 1000, findingsCount: 0, ranAt: new Date('2026-01-31T00:00:00.000Z') },
      ],
      findings: [],
    };
    const perf = toAgentPerf([AGENT_A, AGENT_B], data, RANGE);
    expect(perf.summary.most_active_agent_id).toBe('agent-a');
    expect(perf.summary.most_active_agent).toBe('Security Reviewer');
  });

  it('a tie in run count is broken by the most recent ran_at', () => {
    const data: PerfRangeResult = {
      runs: [
        { agentId: 'agent-a', model: 'gpt-4.1', costUsd: 0.01, durationMs: 1000, findingsCount: 0, ranAt: new Date('2026-01-01T00:00:00.000Z') },
        { agentId: 'agent-b', model: 'claude-x', costUsd: 0.01, durationMs: 1000, findingsCount: 0, ranAt: new Date('2026-01-20T00:00:00.000Z') },
      ],
      findings: [],
    };
    const perf = toAgentPerf([AGENT_A, AGENT_B], data, RANGE);
    // Both have exactly 1 run — agent-b's is more recent, so it wins the tie.
    expect(perf.summary.most_active_agent_id).toBe('agent-b');
  });
});
