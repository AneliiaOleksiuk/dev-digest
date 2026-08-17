import type { ChatMessage } from '@devdigest/shared';
import type { IntentDiffFileSummary } from '../reviews/intent-inputs.js';
import { BRIEF_INPUT_TOKEN_BUDGET, SPEC_INPUT_TOKEN_SUBCAP } from './constants.js';
import { assembleBriefMessages, renderSpecFileBlock, type BriefSections, type BriefSpecFileInput } from './prompt.js';

/**
 * Token budget + fixed trim order (AC-23–AC-27). Pure — takes `count` as a
 * parameter so `container.tokenizer` is injected by the caller, never
 * imported directly (E-11: the tokenizer silently degrades to
 * `ceil(chars/4)` and is `cl100k_base` regardless of provider — a budget
 * guard, not a provider-exact guarantee).
 */
export type TokenCounter = (text: string) => number;

export type BriefBudgetResult =
  | { floorExceeded: true; messages: null; inputTokens: 0; droppedInputs: [] }
  | { floorExceeded: false; messages: ChatMessage[]; inputTokens: number; droppedInputs: string[] };

function measure(count: TokenCounter, messages: ChatMessage[]): number {
  return count(messages.map((m) => m.content).join('\n'));
}

/** The N largest files by `additions + deletions`, preserving their
 *  original relative order — stable, deterministic tie-break on original
 *  index (never re-sorted for display, only for SELECTION). */
function topFilesBySize(files: IntentDiffFileSummary[], n: number): IntentDiffFileSummary[] {
  if (n >= files.length) return files;
  if (n <= 0) return [];
  const ranked = files
    .map((f, i) => ({ f, i, size: f.additions + f.deletions }))
    .sort((a, b) => b.size - a.size || a.i - b.i)
    .slice(0, n);
  const kept = new Set(ranked.map((r) => r.i));
  return files.filter((_, i) => kept.has(i));
}

/**
 * Fit `sections` into `BRIEF_INPUT_TOKEN_BUDGET`, applying AC-24's stages in
 * fixed order, whole items only — never a mid-item truncation. Every stage
 * that actually drops something appends a human string to `droppedInputs`.
 */
export function fitBriefToBudget(sections: BriefSections, count: TokenCounter): BriefBudgetResult {
  // ---- AC-25: the floor (title + intent + blast summary) is never dropped.
  // If it alone exceeds the budget, zero calls are made. ----
  const floorSections: BriefSections = { ...sections, specFiles: [], linkedIssueText: null, diffFiles: [] };
  const floorTokens = measure(count, assembleBriefMessages(floorSections, { collapseHunkHeaders: true }).messages);
  if (floorTokens > BRIEF_INPUT_TOKEN_BUDGET) {
    return { floorExceeded: true, messages: null, inputTokens: 0, droppedInputs: [] };
  }

  const droppedInputs: string[] = [];

  // ---- AC-27: spec sub-cap, whole-document admission only, sources[] order.
  // A document that would push the running spec total over the sub-cap is
  // dropped entire — never excerpted, sliced, or head-truncated. ----
  let specTotal = 0;
  const admittedSpecs: BriefSpecFileInput[] = [];
  sections.specFiles.forEach((f, i) => {
    const tokens = count(renderSpecFileBlock(f, i));
    if (specTotal + tokens > SPEC_INPUT_TOKEN_SUBCAP) {
      droppedInputs.push(`spec file ${f.ref} dropped (spec sub-cap)`);
      return;
    }
    specTotal += tokens;
    admittedSpecs.push(f);
  });

  // ---- Assemble with everything admitted so far; measure. ----
  let working: BriefSections = { ...sections, specFiles: admittedSpecs };
  let opts = { collapseHunkHeaders: false, filesNotShown: 0 };
  let messages = assembleBriefMessages(working, opts).messages;
  let total = measure(count, messages);

  if (total <= BRIEF_INPUT_TOKEN_BUDGET) {
    return { floorExceeded: false, messages, inputTokens: total, droppedInputs };
  }

  // ---- AC-24 stage 1: drop spec excerpts whole-document from the
  // lowest-priority (last-referenced) end. ----
  while (working.specFiles.length > 0 && total > BRIEF_INPUT_TOKEN_BUDGET) {
    const dropped = working.specFiles[working.specFiles.length - 1]!;
    working = { ...working, specFiles: working.specFiles.slice(0, -1) };
    droppedInputs.push(`spec file ${dropped.ref} dropped (input budget)`);
    messages = assembleBriefMessages(working, opts).messages;
    total = measure(count, messages);
  }

  // ---- AC-24 stage 2: drop the linked issue block. ----
  if (total > BRIEF_INPUT_TOKEN_BUDGET && working.linkedIssueText) {
    working = { ...working, linkedIssueText: null };
    droppedInputs.push('linked issue dropped (input budget)');
    messages = assembleBriefMessages(working, opts).messages;
    total = measure(count, messages);
  }

  // ---- AC-24 stage 3: collapse hunk headers to `path (+a/-d)` lines. ----
  if (total > BRIEF_INPUT_TOKEN_BUDGET && !opts.collapseHunkHeaders) {
    opts = { ...opts, collapseHunkHeaders: true };
    droppedInputs.push('hunk headers collapsed to file stats (input budget)');
    messages = assembleBriefMessages(working, opts).messages;
    total = measure(count, messages);
  }

  // ---- AC-24 stage 4: reduce the changed-file list to the largest-by-size
  // N via binary search on N, always emitting "+N more files not shown". ----
  if (total > BRIEF_INPUT_TOKEN_BUDGET) {
    const allFiles = working.diffFiles;
    let lo = 0; // floor check already proved 0 files fits
    let hi = allFiles.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const trialFiles = topFilesBySize(allFiles, mid);
      const trialOpts = { ...opts, filesNotShown: allFiles.length - trialFiles.length };
      const trialTotal = measure(
        count,
        assembleBriefMessages({ ...working, diffFiles: trialFiles }, trialOpts).messages,
      );
      if (trialTotal <= BRIEF_INPUT_TOKEN_BUDGET) lo = mid;
      else hi = mid - 1;
    }
    const keptFiles = topFilesBySize(allFiles, lo);
    const notShown = allFiles.length - keptFiles.length;
    working = { ...working, diffFiles: keptFiles };
    opts = { ...opts, filesNotShown: notShown };
    if (notShown > 0) droppedInputs.push(`changed-file list truncated to ${lo} file(s) (input budget)`);
    messages = assembleBriefMessages(working, opts).messages;
    total = measure(count, messages);
  }

  return { floorExceeded: false, messages, inputTokens: total, droppedInputs };
}
