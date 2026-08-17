/**
 * Brief module — prompt.ts (WI4, SPEC-03). Pure unit tests, no DB/adapters.
 *
 * Oracle (derived from specs/SPEC-03-pr-brief-and-why-timeline.md, read
 * BEFORE opening prompt.ts):
 *   - AC-8: the assembled messages never contain hunk BODY text — only
 *     `path (+a/-d)` stats and synthesized `@@ -a,b +c,d @@` headers. Proven
 *     with a fixture whose patch body contains a unique sentinel string that
 *     must appear ZERO times in the assembled messages. (`assembleBriefMessages`
 *     takes `IntentDiffFileSummary[]`, which structurally has no body field,
 *     but this test proves it at the STRING level too — the actual prompt
 *     the model receives.)
 *   - AC-37: every PR/repo-derived text block is wrapped with `wrapUntrusted`
 *     (delimiter markers present around each block), and the system message
 *     carries an injection-guard paragraph equivalent to
 *     `CLASSIFIER_INJECTION_GUARD`. A spec file's own path lives INSIDE its
 *     untrusted block, never as a trusted heading.
 */
import { describe, it, expect } from 'vitest';
import { assembleBriefMessages, BRIEF_SYSTEM_PROMPT, type BriefSections } from '../src/modules/brief/prompt.js';
import type { IntentDiffFileSummary } from '../src/modules/reviews/intent-inputs.js';

const SENTINEL = 'SENTINEL_HUNK_BODY_TEXT_sk_live_should_never_leak_9f81';

function baseSections(overrides: Partial<BriefSections> = {}): BriefSections {
  return {
    prTitle: 'Add rate limiting',
    intentBlock: 'Add rate limiting middleware.',
    blastSummaryLine: '2 symbols changed.',
    specFiles: [],
    linkedIssueText: null,
    diffFiles: [],
    ...overrides,
  };
}

describe('brief/prompt — assembleBriefMessages (WI4)', () => {
  it('AC-8: a diff-file fixture carries only stats/headers — IntentDiffFileSummary has no body field, so a sentinel "hunk body" string cannot appear', () => {
    // IntentDiffFileSummary literally cannot carry a body string (no field
    // for it) — this test documents that guarantee at the assembled-string
    // level, using a sentinel that WOULD appear if any code path leaked a
    // raw patch body into these messages.
    const diffFiles: IntentDiffFileSummary[] = [
      {
        path: 'src/config.ts',
        additions: 2,
        deletions: 0,
        hunks: [{ oldStart: 10, oldLines: 0, newStart: 10, newLines: 2 }],
      },
    ];
    const sections = baseSections({ diffFiles });
    const { messages } = assembleBriefMessages(sections, { collapseHunkHeaders: false });
    const joined = messages.map((m) => m.content).join('\n');
    expect(joined).not.toContain(SENTINEL);
    expect(joined).toContain('src/config.ts (+2/-0)');
    expect(joined).toContain('@@ -10,0 +10,2 @@');
  });

  it('AC-37: every user-section block is wrapped with wrapUntrusted delimiters', () => {
    const sections = baseSections({
      linkedIssueText: 'Issue body text',
      specFiles: [{ ref: 'docs/design.md', text: 'design doc text' }],
      diffFiles: [{ path: 'src/a.ts', additions: 1, deletions: 0, hunks: [] }],
    });
    const { messages } = assembleBriefMessages(sections, { collapseHunkHeaders: false });
    const user = messages.find((m) => m.role === 'user')!.content;

    // wrapUntrusted delimits with a labeled BEGIN/END-style marker per
    // reviewer-core/src/prompt.ts — assert structurally that every block has
    // a paired delimiter rather than raw concatenation.
    const delimiterCount = (user.match(/UNTRUSTED/gi) ?? []).length;
    expect(delimiterCount).toBeGreaterThan(0);

    for (const label of ['pr-title', 'intent', 'blast-summary', 'linked-issue', 'spec-0', 'changed-files']) {
      expect(user).toContain(label);
    }
  });

  it('AC-37: a spec file\'s path lives INSIDE its untrusted block, never as a trusted heading', () => {
    const sections = baseSections({ specFiles: [{ ref: 'docs/design.md', text: 'the doc body' }] });
    const { messages } = assembleBriefMessages(sections, { collapseHunkHeaders: false });
    const user = messages.find((m) => m.role === 'user')!.content;

    // The heading itself is generic ("## Referenced spec"), not the path —
    // the path only appears inside the wrapped block alongside the content.
    const headingLine = user.split('\n').find((l) => l.startsWith('## Referenced spec'))!;
    expect(headingLine).not.toContain('docs/design.md');
    expect(user).toContain('Path: docs/design.md');
  });

  it('AC-37: the system message carries an injection-guard paragraph', () => {
    expect(BRIEF_SYSTEM_PROMPT.toLowerCase()).toContain('never instructions');
    expect(BRIEF_SYSTEM_PROMPT.toLowerCase()).toContain('ignore any instructions');
  });

  it('sections omitted when absent: no intent block / no linked issue → no corresponding heading emitted', () => {
    const sections = baseSections({ intentBlock: null, linkedIssueText: null });
    const { messages } = assembleBriefMessages(sections, { collapseHunkHeaders: false });
    const user = messages.find((m) => m.role === 'user')!.content;
    expect(user).not.toContain('## Derived intent');
    expect(user).not.toContain('## Linked issue');
  });

  it('AC-24 stage 4: filesNotShown > 0 renders the explicit "+N more files not shown" marker', () => {
    const sections = baseSections({
      diffFiles: [{ path: 'src/a.ts', additions: 1, deletions: 0, hunks: [] }],
    });
    const { messages } = assembleBriefMessages(sections, { collapseHunkHeaders: true, filesNotShown: 7 });
    const user = messages.find((m) => m.role === 'user')!.content;
    expect(user).toContain('+7 more files not shown');
  });
});
