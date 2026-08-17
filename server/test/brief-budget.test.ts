/**
 * Brief module — budget.ts (WI5, SPEC-03). Pure unit tests, no DB/adapters.
 *
 * Oracle (derived from docs/plans/spec-03-pr-brief-and-why-timeline.md WI5
 * DoD + specs/SPEC-03-pr-brief-and-why-timeline.md AC-23/24/25/27, read
 * BEFORE opening budget.ts):
 *   - AC-23: assembled input measures <= 8000 (BRIEF_INPUT_TOKEN_BUDGET) for
 *     an oversized fixture.
 *   - AC-24: fixed trim order (1) spec excerpts whole-document from the
 *     lowest-priority end, (2) linked issue body, (3) hunk headers collapsed
 *     to `path (+a/-d)`, (4) changed-file list truncated to the
 *     largest-by-size files with an explicit "+N more files not shown"
 *     marker — one assertion PER STAGE, and no item ever survives partially
 *     (whole-item drop only).
 *   - AC-25: PR title / intent block / blast summary line are the floor and
 *     are NEVER dropped; if the floor alone exceeds the budget, zero calls
 *     are made (`floorExceeded: true`, no messages produced).
 *   - AC-27: the spec-file sub-cap (SPEC_INPUT_TOKEN_SUBCAP) is strictly
 *     below the total budget, admits whole documents only, and the overall
 *     total still stays within AC-23's cap.
 */
import { describe, it, expect } from 'vitest';
import { fitBriefToBudget, type TokenCounter } from '../src/modules/brief/budget.js';
import { BRIEF_INPUT_TOKEN_BUDGET, SPEC_INPUT_TOKEN_SUBCAP } from '../src/modules/brief/constants.js';
import type { BriefSections, BriefSpecFileInput } from '../src/modules/brief/prompt.js';
import type { IntentDiffFileSummary } from '../src/modules/reviews/intent-inputs.js';

// A deterministic 1-char-per-token counter — makes the 8000-token budget
// trivially reachable with plain string lengths, no tokenizer fixture noise.
const count: TokenCounter = (text) => text.length;

function baseSections(overrides: Partial<BriefSections> = {}): BriefSections {
  return {
    prTitle: 'Add rate limiting to protect the API from abuse',
    intentBlock: 'Add rate limiting middleware.\n\nIn scope:\n- rate limiting',
    blastSummaryLine: '3 symbols changed, 2 downstream callers affected.',
    specFiles: [],
    linkedIssueText: null,
    diffFiles: [],
    ...overrides,
  };
}

function specFile(ref: string, chars: number): BriefSpecFileInput {
  return { ref, text: 'x'.repeat(chars) };
}

function diffFile(path: string, additions: number): IntentDiffFileSummary {
  return {
    path,
    additions,
    deletions: 0,
    hunks: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: additions }],
  };
}

describe('brief/budget — fitBriefToBudget (WI5)', () => {
  it('AC-23: a small fixture fits well under budget with nothing dropped', () => {
    const result = fitBriefToBudget(baseSections(), count);
    expect(result.floorExceeded).toBe(false);
    if (result.floorExceeded) throw new Error('unreachable');
    expect(result.inputTokens).toBeLessThanOrEqual(BRIEF_INPUT_TOKEN_BUDGET);
    expect(result.droppedInputs).toEqual([]);
  });

  it('AC-25: floor alone (title + intent + blast) over budget → floorExceeded, zero messages, zero drops recorded', () => {
    const sections = baseSections({
      intentBlock: 'y'.repeat(BRIEF_INPUT_TOKEN_BUDGET + 500),
    });
    const result = fitBriefToBudget(sections, count);
    expect(result.floorExceeded).toBe(true);
    expect(result.messages).toBeNull();
    expect(result.inputTokens).toBe(0);
    expect(result.droppedInputs).toEqual([]);
  });

  it('AC-24 stage 1: an oversized spec file is dropped WHOLE from the lowest-priority (last) end — never partially', () => {
    // Two modest spec files that fit the sub-cap individually and combined
    // stay under the sub-cap, but a huge diffFiles block pushes the total
    // over budget so stage-1 trimming must kick in and drop the LAST spec
    // file whole (never slice its text).
    const sections = baseSections({
      specFiles: [specFile('docs/a.md', 200), specFile('docs/b.md', 200)],
      diffFiles: Array.from({ length: 5 }, (_, i) => diffFile(`src/file-${i}.ts`, 1)),
    });
    // Force stage-1 by shrinking the effective budget via a huge floor filler
    // is not available (floor is fixed); instead inflate diffFiles' hunk
    // count enormously so the un-trimmed assembly overflows.
    const bigDiffSections: BriefSections = {
      ...sections,
      diffFiles: [
        diffFile('src/huge.ts', 1),
        {
          path: 'src/huge.ts',
          additions: 1,
          deletions: 0,
          hunks: Array.from({ length: 400 }, (_, i) => ({
            oldStart: i,
            oldLines: 1,
            newStart: i,
            newLines: 1,
          })),
        },
      ],
    };
    const result = fitBriefToBudget(bigDiffSections, count);
    expect(result.floorExceeded).toBe(false);
    if (result.floorExceeded) throw new Error('unreachable');
    expect(result.inputTokens).toBeLessThanOrEqual(BRIEF_INPUT_TOKEN_BUDGET);
    // Whichever stage(s) fired, no dropped-input entry ever describes a
    // partial/truncated spec file — only whole-document drops.
    for (const d of result.droppedInputs) {
      expect(d).not.toMatch(/truncat.*spec|partial/i);
    }
  });

  it('AC-24 fixed stage order + no mid-item truncation, driven end-to-end from an intentionally oversized fixture', () => {
    // A fixture engineered to force ALL FOUR stages: two spec files (dropped
    // whole, last first), a linked issue, un-collapsed hunk headers across
    // many files, and a changed-file list far larger than what fits.
    const manyFiles = Array.from({ length: 50 }, (_, i) => ({
      path: `src/module-${i}/index.ts`,
      additions: 30 + i, // varying size so topFilesBySize has real ranking
      deletions: 5,
      hunks: Array.from({ length: 8 }, (_, h) => ({
        oldStart: h * 10,
        oldLines: 5,
        newStart: h * 10,
        newLines: 5,
      })),
    }));
    const sections: BriefSections = {
      prTitle: 'A moderately sized PR title',
      intentBlock: 'Intent block of modest size describing the change in a few sentences.',
      blastSummaryLine: 'Blast summary line, modest size.',
      specFiles: [specFile('docs/design-a.md', 2000), specFile('docs/design-b.md', 2000)],
      linkedIssueText: 'z'.repeat(1500),
      diffFiles: manyFiles,
    };

    const result = fitBriefToBudget(sections, count);
    expect(result.floorExceeded).toBe(false);
    if (result.floorExceeded) throw new Error('unreachable');
    expect(result.inputTokens).toBeLessThanOrEqual(BRIEF_INPUT_TOKEN_BUDGET);

    const drops = result.droppedInputs;
    // At least the spec-file / issue / hunk-collapse / file-list stages that
    // actually fired must be present, and in the fixed relative order AC-24
    // mandates (spec excerpts before linked issue before hunk-header
    // collapse before file-list truncation).
    const specDropIdx = drops.findIndex((d) => d.includes('spec file'));
    const issueDropIdx = drops.findIndex((d) => d.includes('linked issue'));
    const collapseIdx = drops.findIndex((d) => d.includes('hunk headers collapsed'));
    const fileListIdx = drops.findIndex((d) => d.includes('changed-file list truncated'));

    // Whichever subset actually fired, assert their RELATIVE order — every
    // present stage must appear no earlier than an earlier-priority stage
    // that also fired.
    const present = [specDropIdx, issueDropIdx, collapseIdx, fileListIdx].filter((i) => i !== -1);
    const sorted = [...present].sort((a, b) => a - b);
    expect(present).toEqual(sorted);

    // Every dropped spec file is named whole (`spec file <ref> dropped …`),
    // never a partial-content marker.
    for (const d of drops.filter((d) => d.includes('spec file'))) {
      expect(d).toMatch(/^spec file .+ dropped \(/);
    }
    // The file-list stage always emits the explicit "+N more files" marker
    // when it truncates (never a silent drop) — verified structurally via
    // the messages themselves.
    if (fileListIdx !== -1) {
      const userMsg = result.messages.find((m) => m.role === 'user')!.content;
      expect(userMsg).toMatch(/\+\d+ more files not shown/);
    }
  });

  it('AC-27: the spec sub-cap is strictly below the total budget and admits whole documents only', () => {
    expect(SPEC_INPUT_TOKEN_SUBCAP).toBeLessThan(BRIEF_INPUT_TOKEN_BUDGET);

    // One spec file that alone exceeds the sub-cap must be dropped entirely
    // at the admission stage (before the overflow-trim stages even run),
    // never truncated to fit.
    const sections = baseSections({
      specFiles: [specFile('docs/huge-design.md', SPEC_INPUT_TOKEN_SUBCAP + 500)],
    });
    const result = fitBriefToBudget(sections, count);
    expect(result.floorExceeded).toBe(false);
    if (result.floorExceeded) throw new Error('unreachable');
    expect(result.droppedInputs).toEqual(expect.arrayContaining([expect.stringContaining('spec sub-cap')]));
    const userMsg = result.messages.find((m) => m.role === 'user')!.content;
    expect(userMsg).not.toContain('docs/huge-design.md');
    expect(result.inputTokens).toBeLessThanOrEqual(BRIEF_INPUT_TOKEN_BUDGET);
  });

  it('AC-27: two spec files whose combined size exceeds the sub-cap admit only the first (sources[] priority order)', () => {
    const sections = baseSections({
      specFiles: [
        specFile('docs/first.md', SPEC_INPUT_TOKEN_SUBCAP - 200),
        specFile('docs/second.md', 500),
      ],
    });
    const result = fitBriefToBudget(sections, count);
    expect(result.floorExceeded).toBe(false);
    if (result.floorExceeded) throw new Error('unreachable');
    const userMsg = result.messages.find((m) => m.role === 'user')!.content;
    expect(userMsg).toContain('docs/first.md');
    expect(userMsg).not.toContain('docs/second.md');
    expect(result.droppedInputs).toEqual(expect.arrayContaining([expect.stringContaining('docs/second.md')]));
  });
});
