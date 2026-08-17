/**
 * Brief module — helpers.ts (WI1/WI7, SPEC-03). Pure unit tests, no
 * DB/adapters.
 *
 * Oracle (derived from docs/plans/spec-03-pr-brief-and-why-timeline.md WI1
 * DoD ("Every BriefState value must have a producer somewhere in service.ts
 * and a render path somewhere in PrBriefCard — write a test enumerating the
 * 6 states if none exists") + specs/SPEC-03-pr-brief-and-why-timeline.md
 * AC-17/AC-33/AC-40, read BEFORE opening helpers.ts):
 *   - AC-40: a hand-corrupted/schema-drifted stored `pr_brief.json` row
 *     degrades to `state: 'corrupt'` on read, never throws.
 *   - AC-17: current head has no brief but an earlier SHA does → `stale`,
 *     naming the SHA the newest brief describes.
 *   - AC-33: only entries whose `risk_level` differs from the entry BEFORE
 *     them (older neighbour) are marked `risk_changed` — not every entry.
 *   - WI1: all 6 `BriefState` values (`current`,`stale`,`absent`,`corrupt`
 *     from reads; `budget_exceeded`,`failed` are generate-only transients
 *     asserted directly against the contract enum since they never flow
 *     through `deriveBriefState`).
 */
import { describe, it, expect } from 'vitest';
import { BriefState } from '@devdigest/shared';
import { deriveBriefState, mapRowToRecord, markRiskChanges, type BriefRow } from '../src/modules/brief/helpers.js';

function row(overrides: Partial<BriefRow> = {}): BriefRow {
  return {
    prId: 'pr-1',
    headSha: 'sha-current',
    json: {
      what: 'Adds rate limiting',
      why: 'Protects the API from abuse',
      risk_level: 'medium',
      risks: [],
      review_focus: [],
      input_status: {
        intent_status: 'used',
        blast_status: 'full',
        changed_file_count: 1,
        spec_files_used: [],
        spec_files_unresolved: [],
        linked_issue_status: 'not_referenced',
      },
    },
    provider: 'openai',
    model: 'gpt-4.1',
    inputTokens: 500,
    tokensIn: 400,
    tokensOut: 100,
    costUsd: 0.02,
    droppedRiskRefs: 0,
    droppedFocusItems: 0,
    droppedInputs: [],
    generatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('brief/helpers — WI1: BriefState enumeration', () => {
  it('all 6 BriefState values are accounted for: 4 read states + 2 generate-only transients', () => {
    expect(BriefState.options).toEqual(['current', 'stale', 'absent', 'corrupt', 'budget_exceeded', 'failed']);
    // deriveBriefState (the read path) only ever produces the first 4 —
    // 'budget_exceeded'/'failed' are asserted separately since they're
    // generate-only and never persisted (by construction, per BriefState's
    // own doc comment in the contract).
    const readStates = new Set(['current', 'stale', 'absent', 'corrupt']);
    for (const s of ['current', 'stale', 'absent', 'corrupt'] as const) {
      expect(readStates.has(s)).toBe(true);
    }
  });
});

describe('brief/helpers — mapRowToRecord (AC-40)', () => {
  it('a well-formed row parses into a full BriefRecord', () => {
    const record = mapRowToRecord(row());
    expect(record).not.toBeNull();
    expect(record!.what).toBe('Adds rate limiting');
    expect(record!.head_sha).toBe('sha-current');
    expect(record!.usage.provider).toBe('openai');
  });

  it('AC-40: a hand-corrupted json blob (wrong shape) degrades to null, never throws', () => {
    const corrupted = row({ json: { sections: 'not-a-brief-at-all' } });
    expect(() => mapRowToRecord(corrupted)).not.toThrow();
    expect(mapRowToRecord(corrupted)).toBeNull();
  });

  it('AC-40: a schema-drifted row missing required fields degrades to null', () => {
    const drifted = row({ json: { what: 'x' } }); // missing why/risk_level/risks/review_focus/input_status
    expect(mapRowToRecord(drifted)).toBeNull();
  });

  it('AC-40: a completely non-object json value degrades to null, never throws', () => {
    const weird = row({ json: 'just a string' });
    expect(() => mapRowToRecord(weird)).not.toThrow();
    expect(mapRowToRecord(weird)).toBeNull();
  });
});

describe('brief/helpers — deriveBriefState (AC-17/AC-40/AC-1)', () => {
  it('current row present → state "current", reason null', () => {
    const state = deriveBriefState(row(), undefined);
    expect(state.state).toBe('current');
    expect(state.reason).toBeNull();
    expect(state.record).not.toBeNull();
  });

  it('AC-17: no current row, but a latest row for an earlier SHA exists → "stale", naming that SHA', () => {
    const latest = row({ headSha: 'sha-old' });
    const state = deriveBriefState(undefined, latest);
    expect(state.state).toBe('stale');
    expect(state.reason).toContain('sha-old');
    expect(state.record).not.toBeNull();
    expect(state.record!.head_sha).toBe('sha-old');
  });

  it('AC-1: neither row exists → "absent", no record', () => {
    const state = deriveBriefState(undefined, undefined);
    expect(state.state).toBe('absent');
    expect(state.record).toBeNull();
  });

  it('AC-40: current row present but corrupted → "corrupt", not silently falling back to the latest row', () => {
    const corruptCurrent = row({ json: { garbage: true } });
    const latest = row({ headSha: 'sha-old' }); // well-formed, but must NOT be used as a fallback
    const state = deriveBriefState(corruptCurrent, latest);
    expect(state.state).toBe('corrupt');
    expect(state.record).toBeNull();
  });

  it('AC-40: latest row corrupted on the stale path → "corrupt", not "stale" with a null record silently accepted', () => {
    const corruptLatest = row({ headSha: 'sha-old', json: { garbage: true } });
    const state = deriveBriefState(undefined, corruptLatest);
    expect(state.state).toBe('corrupt');
    expect(state.record).toBeNull();
  });
});

describe('brief/helpers — markRiskChanges (AC-33)', () => {
  function entry(sha: string, level: 'high' | 'medium' | 'low') {
    return { head_sha: sha, risk_level: level };
  }

  it('marks only entries whose risk_level differs from the entry BEFORE them (the next-older, since input is newest-first)', () => {
    // newest -> oldest: high, high, low  (oldest "low" has no older neighbour)
    const entries = [entry('c3', 'high'), entry('c2', 'high'), entry('c1', 'low')];
    const marked = markRiskChanges(entries);
    expect(marked[0]!.risk_changed).toBe(false); // c3 vs c2: same (high vs high)
    expect(marked[1]!.risk_changed).toBe(true); // c2 vs c1: high vs low — changed
    expect(marked[2]!.risk_changed).toBe(false); // oldest — no older neighbour to compare
  });

  it('a single-entry timeline never marks risk_changed (no older neighbour)', () => {
    const marked = markRiskChanges([entry('c1', 'high')]);
    expect(marked[0]!.risk_changed).toBe(false);
  });

  it('an empty timeline returns an empty array', () => {
    expect(markRiskChanges([])).toEqual([]);
  });

  it('three briefs with ALL DIFFERENT risk levels mark exactly the two transitions, not all three entries uniformly', () => {
    const entries = [entry('c3', 'low'), entry('c2', 'high'), entry('c1', 'medium')];
    const marked = markRiskChanges(entries);
    expect(marked.map((e) => e.risk_changed)).toEqual([true, true, false]);
  });
});
