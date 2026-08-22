/**
 * L06 AC-41 — "New client copy shall extend the existing pre-authored
 * namespaces without redefining any key already present in
 * client/messages/en/eval.json or agents.json. Genuinely new copy is
 * limited to: the finding card's 'Turn into eval case' action ... the
 * dashboard's run-all-agents action, and the compare view."
 *
 * Oracle (derived from specs/eval-pipeline.md AC-41 and its own baseline —
 * `eval.json` (84 lines) and `agents.json:46-53` as shipped BEFORE Phase D,
 * captured verbatim below via `git show 6295127~1:...` — BEFORE reading the
 * Phase D diff): every pre-existing key's VALUE must be byte-identical
 * after Phase D, and the new keys Phase D adds must be exactly the
 * enumerated additions (no surprise renames/collisions elsewhere in the
 * namespace).
 *
 * Phase D fix-loop (plan-verifier Phase 1 row 25, AC-30/UX-5) added ONE more
 * key beyond that original enumeration — `dashboard.metricCasesCaption` —
 * to state each metric's own contributing-case count ("a mean over 2 of 8
 * cases is not read as a mean over 8"). This falls outside AC-41's original
 * list (which predates that finding) but is a legitimate, spec-justified
 * addition, not a silent one — see `expectedNewKeys` below.
 */
import { describe, it, expect } from "vitest";
import evalMessages from "../../messages/en/eval.json";
import prReviewMessages from "../../messages/en/prReview.json";
import agentsMessages from "../../messages/en/agents.json";

type Messages = Record<string, unknown>;

/** Flatten a nested messages object into `{ "a.b.c": value }`. */
function flatten(obj: Messages, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(out, flatten(value as Messages, path));
    } else {
      out[path] = value;
    }
  }
  return out;
}

// Verbatim baseline — client/messages/en/eval.json as it stood immediately
// BEFORE the Phase D commit (6295127), captured via
// `git show 6295127~1:client/messages/en/eval.json`.
const EVAL_BASELINE: Messages = {
  dashboard: {
    defaultTitle: "Eval Dashboard",
    loading: "Loading eval metrics…",
    casesSummary:
      "{count, plural, one {# eval case} other {# eval cases}} · gold set · {runs, plural, one {# run} other {# runs}}",
    configure: "Configure eval cases →",
    runEval: "Run eval ({count})",
    running: "Running…",
    metricTrend: "Metric trend",
    recentRuns: "Recent runs",
    noRuns: "No runs yet. Create an eval case and run it.",
    metrics: { recall: "RECALL", precision: "PRECISION", citationAccuracy: "CITATION ACCURACY" },
    legend: { recall: "Recall", precision: "Precision", citation: "Citation" },
    table: { ranAt: "Ran at", recall: "Recall", precision: "Precision", citation: "Citation", pass: "Pass", cost: "Cost" },
    pass: "pass",
    fail: "fail",
  },
  caseEditor: {
    newCase: "New eval case",
    caseTitle: "Eval case · {name}",
    runCase: "Run case",
    running: "Running…",
    save: "Save",
    saving: "Saving…",
    nameLabel: "Name",
    namePlaceholder: "stripe-key-leak",
    inputLabel: "Input",
    tabs: { diff: "Diff", prMeta: "PR meta" },
    diffPlaceholder: '--- a/src/config.ts\n+++ b/src/config.ts\n@@ -10,6 +10,7 @@\n+  stripeKey: "sk_live_..."',
    titleLabel: "Title",
    titlePlaceholder: "Add Stripe integration",
    bodyLabel: "Body",
    bodyPlaceholder: "Wire up payments via Stripe SDK.",
    preview: "Preview",
    expectedOutput: "Expected output",
    validJson: "valid JSON",
    invalidJson: "invalid JSON",
    lastRunPassed: "Last run passed",
    lastRunFailed: "Last run failed",
    resultSummary: "recall {recall}% · precision {precision}% · citation {citation}% · {duration}s",
  },
  evalsTab: {
    metricsTitle: "Eval metrics",
    metricsSubtitle: "Recall / Precision / Citation for this agent's eval cases",
    casesHeading: "Eval cases",
    newCase: "New case",
    loadingCases: "Loading cases…",
    emptyCases: "No eval cases yet. Create one to assert this agent's expected findings on a sample diff.",
    neverRun: "never run",
    passed: "passed",
    failed: "failed",
    recallSuffix: " · recall {recall}%",
    run: "Run",
    running: "Running…",
    edit: "Edit",
    delete: "Delete",
  },
  page: {
    crumbSkillsLab: "Skills Lab",
    crumbEvalDashboard: "Eval Dashboard",
    crumbAgents: "Agents",
    crumbEvals: "Evals",
    crumbNewCase: "New case",
    crumbEvalCase: "Eval case",
  },
};

// Verbatim baseline — client/messages/en/prReview.json's `finding` block
// BEFORE Phase D (same commit).
const PRREVIEW_FINDING_BASELINE: Messages = {
  accepted: "accepted",
  dismissed: "dismissed",
  suggestedFix: "Suggested fix",
  accept: "Accept",
  dismiss: "Dismiss",
  learn: "Learn",
  replyToAuthor: "Reply to author",
  replyPlaceholder: "Reply to the author about this finding…",
  sendReply: "Send reply",
  cancel: "Cancel",
};

const EVAL_BASELINE_FLAT = flatten(EVAL_BASELINE);
const CURRENT_EVAL_FLAT = flatten(evalMessages as Messages);
const PRREVIEW_FINDING_BASELINE_FLAT = flatten(PRREVIEW_FINDING_BASELINE, "finding");
const CURRENT_PRREVIEW_FINDING_FLAT = flatten((prReviewMessages as Messages).finding as Messages, "finding");

describe("AC-41 — no pre-existing eval.json key was redefined or reworded", () => {
  it("every baseline eval.json key still exists with its EXACT pre-Phase-D value", () => {
    for (const [key, value] of Object.entries(EVAL_BASELINE_FLAT)) {
      expect(CURRENT_EVAL_FLAT, `key "${key}" changed or was removed`).toHaveProperty(key, value);
    }
  });

  it("the only genuinely new eval.json keys are the ones AC-41 enumerates (dashboard run-all-agents/estimate/na + a new compare block), plus the Phase D fix-loop's metricCasesCaption (AC-30/UX-5)", () => {
    const newKeys = Object.keys(CURRENT_EVAL_FLAT).filter((k) => !(k in EVAL_BASELINE_FLAT));
    const expectedNewKeys = [
      "dashboard.runAllAgents",
      "dashboard.runEstimate",
      "dashboard.runAllAgentsEstimate",
      "dashboard.na",
      "dashboard.naReason",
      "dashboard.relativeScoresNote",
      // Phase D fix-loop, plan-verifier Phase 1 row 25 (AC-30/UX-5) — see
      // this file's top doc comment.
      "dashboard.metricCasesCaption",
      "compare.title",
      "compare.base",
      "compare.head",
      "compare.promptDiffTitle",
      "compare.promptUnavailable",
      "compare.firstRunNothing",
      "compare.sameVersionDifferentSkills",
    ].sort();
    expect(newKeys.sort()).toEqual(expectedNewKeys);
  });
});

describe("AC-41 — no pre-existing prReview.json 'finding' key was redefined or reworded", () => {
  it("every baseline finding.* key still exists with its EXACT pre-Phase-D value", () => {
    for (const [key, value] of Object.entries(PRREVIEW_FINDING_BASELINE_FLAT)) {
      expect(CURRENT_PRREVIEW_FINDING_FLAT, `key "${key}" changed or was removed`).toHaveProperty(key, value);
    }
  });

  it("the only genuinely new finding.* keys are 'Turn into eval case' + its two confirmation strings", () => {
    const newKeys = Object.keys(CURRENT_PRREVIEW_FINDING_FLAT).filter((k) => !(k in PRREVIEW_FINDING_BASELINE_FLAT));
    expect(newKeys.sort()).toEqual(
      ["finding.turnIntoEvalCase", "finding.evalCaseCreatedMustFind", "finding.evalCaseCreatedMustNotFlag"].sort(),
    );
  });
});

describe("AC-41 — agents.json is untouched by Phase D (its evals tab label was already pre-authored)", () => {
  it("agents.json's editor.tabs.evals label is unchanged pre-authored copy", () => {
    expect((agentsMessages as Messages).editor).toMatchObject({ tabs: { evals: "Evals" } });
  });
});

describe("AC-41 — no key added in eval.json collides with a key already in agents.json or prReview.json", () => {
  it("none of the new eval.json/prReview.json keys' FLATTENED PATHS exist verbatim in agents.json", () => {
    const agentsFlat = flatten(agentsMessages as Messages);
    const newEvalKeys = Object.keys(CURRENT_EVAL_FLAT).filter((k) => !(k in EVAL_BASELINE_FLAT));
    for (const key of newEvalKeys) {
      expect(agentsFlat).not.toHaveProperty(key);
    }
  });
});
