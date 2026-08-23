import { describe, it, expect } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import { validateWorkflowOverride } from '../src/modules/ci/workflow-validate.js';
import { buildWorkflow } from '../src/modules/ci/workflow.js';

/**
 * Oracle: specs/SPEC-05-multi-agent-ci-per-repo.md AC-24, derived from the
 * spec text and the plan's Recommendations 4/5 ("AC-24 must cover inherited
 * env:, not just the review step" / "AC-24's secret check needs a new scan
 * surface … an allowlist over every env: map") BEFORE reading
 * `workflow-validate.ts`'s own implementation beyond its exported signature
 * and the `violated` string shape.
 *
 * Also exercises the SPEC-04 baseline invariants this validator already
 * enforced (unpinned action, forbidden event, run-body injection, exact
 * permissions, run-command equality) — this module has ZERO prior test
 * coverage, so these are net-new for SPEC-04's shipped behavior too,
 * wherever SPEC-05 touches the same validator.
 */

const NS_LAYOUT = { namespace: 'security-reviewer' };
const LEGACY_LAYOUT = { namespace: null };

/** A minimal VALID workflow object for a given layout — built via the same
 *  generator under test elsewhere (`workflow.ts`) so we start from something
 *  the validator is known to accept, then mutate ONE thing per test. */
function validWorkflowObject(layout: { namespace: string | null }) {
  const doc = buildWorkflow({
    triggers: ['opened', 'synchronize', 'reopened'],
    postAs: 'github_review',
    ingestUrl: 'https://studio.example.com/ci/ingest',
    namespace: layout.namespace,
  });
  return doc.toJSON() as any;
}

function toYaml(obj: unknown): string {
  return stringifyYaml(obj);
}

describe('baseline: a workflow generated for a layout validates OK against that SAME layout', () => {
  it('namespaced', () => {
    const result = validateWorkflowOverride(toYaml(validWorkflowObject(NS_LAYOUT)), NS_LAYOUT);
    expect(result).toEqual({ ok: true });
  });

  it('legacy', () => {
    const result = validateWorkflowOverride(toYaml(validWorkflowObject(LEGACY_LAYOUT)), LEGACY_LAYOUT);
    expect(result).toEqual({ ok: true });
  });
});

describe('AC-24: DEVDIGEST_DIR aimed at ANOTHER installation\'s namespace is refused', () => {
  it('a foreign namespace on the review step is refused with devdigest_dir_mismatch', () => {
    const wf = validWorkflowObject(NS_LAYOUT);
    const reviewStep = wf.jobs.review.steps.find((s: any) => s.id === 'review');
    reviewStep.env.DEVDIGEST_DIR = '.devdigest/some-other-agent';
    const result = validateWorkflowOverride(toYaml(wf), NS_LAYOUT);
    expect(result).toEqual({ ok: false, violated: 'devdigest_dir_mismatch' });
  });

  it('a ".." traversal value is refused with devdigest_dir_mismatch (string equality alone catches it)', () => {
    const wf = validWorkflowObject(NS_LAYOUT);
    const reviewStep = wf.jobs.review.steps.find((s: any) => s.id === 'review');
    reviewStep.env.DEVDIGEST_DIR = '..';
    const result = validateWorkflowOverride(toYaml(wf), NS_LAYOUT);
    expect(result).toEqual({ ok: false, violated: 'devdigest_dir_mismatch' });
  });

  it('a legacy layout with a DEVDIGEST_DIR present at all on the review step is refused', () => {
    const wf = validWorkflowObject(LEGACY_LAYOUT);
    const reviewStep = wf.jobs.review.steps.find((s: any) => s.id === 'review');
    reviewStep.env.DEVDIGEST_DIR = '.devdigest/some-agent';
    const result = validateWorkflowOverride(toYaml(wf), LEGACY_LAYOUT);
    expect(result).toEqual({ ok: false, violated: 'devdigest_dir_mismatch' });
  });
});

describe('AC-24/Recommendation 4: DEVDIGEST_DIR declared at workflow or job level (env: inherits downward) is refused', () => {
  it('a workflow-level env.DEVDIGEST_DIR is refused with devdigest_dir_inherited', () => {
    const wf = validWorkflowObject(NS_LAYOUT);
    wf.env = { DEVDIGEST_DIR: '.devdigest/security-reviewer' };
    const result = validateWorkflowOverride(toYaml(wf), NS_LAYOUT);
    expect(result).toEqual({ ok: false, violated: 'devdigest_dir_inherited' });
  });

  it('a job-level env.DEVDIGEST_DIR is refused with devdigest_dir_inherited', () => {
    const wf = validWorkflowObject(NS_LAYOUT);
    wf.jobs.review.env = { DEVDIGEST_DIR: '.devdigest/security-reviewer' };
    const result = validateWorkflowOverride(toYaml(wf), NS_LAYOUT);
    expect(result).toEqual({ ok: false, violated: 'devdigest_dir_inherited' });
  });

  it('a DEVDIGEST_DIR on a step OTHER than the review step is refused with devdigest_dir_inherited', () => {
    const wf = validWorkflowObject(NS_LAYOUT);
    const reportStep = wf.jobs.review.steps.find((s: any) => s.name === 'Report result to DevDigest');
    reportStep.env.DEVDIGEST_DIR = '.devdigest/security-reviewer';
    const result = validateWorkflowOverride(toYaml(wf), NS_LAYOUT);
    expect(result).toEqual({ ok: false, violated: 'devdigest_dir_inherited' });
  });
});

describe('AC-24/Recommendation 5: a foreign ${{ secrets.X }} reference in ANY env: value is refused', () => {
  it('a foreign secret reference in the reporting step is refused with foreign_secret_reference', () => {
    const wf = validWorkflowObject(NS_LAYOUT);
    const reportStep = wf.jobs.review.steps.find((s: any) => s.name === 'Report result to DevDigest');
    reportStep.env.INGEST_TOKEN = '${{ secrets.DEVDIGEST_INGEST_TOKEN_SOME_OTHER_AGENT }}';
    const result = validateWorkflowOverride(toYaml(wf), NS_LAYOUT);
    expect(result).toEqual({ ok: false, violated: 'foreign_secret_reference' });
  });

  it('a foreign secret reference at workflow-level env: is refused', () => {
    const wf = validWorkflowObject(NS_LAYOUT);
    wf.env = { EXTRA: '${{ secrets.SOME_UNRELATED_SECRET }}' };
    const result = validateWorkflowOverride(toYaml(wf), NS_LAYOUT);
    expect(result).toEqual({ ok: false, violated: 'foreign_secret_reference' });
  });

  it('a foreign secret reference at job-level env: is refused', () => {
    const wf = validWorkflowObject(NS_LAYOUT);
    wf.jobs.review.env = { EXTRA: '${{ secrets.SOME_UNRELATED_SECRET }}' };
    const result = validateWorkflowOverride(toYaml(wf), NS_LAYOUT);
    expect(result).toEqual({ ok: false, violated: 'foreign_secret_reference' });
  });

  it('the allowlisted OPENROUTER_API_KEY / GITHUB_TOKEN / this installation\'s own ingest secret remain accepted', () => {
    // The review step's own env already references OPENROUTER_API_KEY and
    // GITHUB_TOKEN unmodified (from buildWorkflow) — this asserts that
    // baseline still validates OK, i.e. the allowlist doesn't over-refuse.
    const result = validateWorkflowOverride(toYaml(validWorkflowObject(NS_LAYOUT)), NS_LAYOUT);
    expect(result.ok).toBe(true);
  });
});

describe('fix-loop iteration 1 — Major finding 1: $GITHUB_ENV bypasses the DEVDIGEST_DIR guard', () => {
  it('a step BEFORE the review step writing DEVDIGEST_DIR into $GITHUB_ENV is refused (the exact reported bypass, against a LEGACY installation)', () => {
    const wf = validWorkflowObject(LEGACY_LAYOUT);
    wf.jobs.review.steps.unshift({
      name: 'Sneaky env write',
      run: 'echo "DEVDIGEST_DIR=.devdigest/victim-ns" >> $GITHUB_ENV',
    });
    const result = validateWorkflowOverride(toYaml(wf), LEGACY_LAYOUT);
    expect(result).toEqual({ ok: false, violated: 'github_env_write' });
  });

  it('a $GITHUB_ENV write on a namespaced installation is refused too (not legacy-specific)', () => {
    const wf = validWorkflowObject(NS_LAYOUT);
    wf.jobs.review.steps.unshift({
      name: 'Sneaky env write',
      run: 'echo "DEVDIGEST_DIR=.devdigest/some-other-agent" >> $GITHUB_ENV',
    });
    const result = validateWorkflowOverride(toYaml(wf), NS_LAYOUT);
    expect(result).toEqual({ ok: false, violated: 'github_env_write' });
  });
});

describe('fix-loop iteration 1 — Major finding 2: uses: identity + with: secret-reference scan', () => {
  it('a 40-hex-shaped but non-allowlisted action is refused as action_not_allowlisted (identity, not shape)', () => {
    const wf = validWorkflowObject(NS_LAYOUT);
    wf.jobs.review.steps[0].uses = 'attacker/exfil@' + '0'.repeat(40);
    const result = validateWorkflowOverride(toYaml(wf), NS_LAYOUT);
    expect(result).toEqual({ ok: false, violated: 'action_not_allowlisted' });
  });

  it('a foreign secret reference inside a step\'s with: map is refused as foreign_secret_reference', () => {
    const wf = validWorkflowObject(NS_LAYOUT);
    wf.jobs.review.steps[1].with = {
      ...wf.jobs.review.steps[1].with,
      token: '${{ secrets.DEVDIGEST_INGEST_TOKEN_SOME_OTHER_AGENT }}',
    };
    const result = validateWorkflowOverride(toYaml(wf), NS_LAYOUT);
    expect(result).toEqual({ ok: false, violated: 'foreign_secret_reference' });
  });
});

describe('baseline SPEC-04 invariants — zero prior test coverage, exercised here for both layouts', () => {
  it('an unpinned action (no 40-hex sha) is refused — fix-loop iteration 1: the check is now identity-based against PINNED_ACTIONS, so this refuses as action_not_allowlisted rather than the old shape-only unpinned_action', () => {
    const wf = validWorkflowObject(NS_LAYOUT);
    wf.jobs.review.steps[0].uses = 'actions/checkout@v4';
    const result = validateWorkflowOverride(toYaml(wf), NS_LAYOUT);
    expect(result).toEqual({ ok: false, violated: 'action_not_allowlisted' });
  });

  it('a forbidden trigger event (pull_request_target) is refused', () => {
    const wf = validWorkflowObject(NS_LAYOUT);
    wf.on = { pull_request_target: { types: ['opened'] } };
    const result = validateWorkflowOverride(toYaml(wf), NS_LAYOUT);
    expect(result).toEqual({ ok: false, violated: 'forbidden_event' });
  });

  it('a run: body containing ${{ github.event.* }} is refused as run_injection', () => {
    const wf = validWorkflowObject(NS_LAYOUT);
    const reportStep = wf.jobs.review.steps.find((s: any) => s.name === 'Report result to DevDigest');
    reportStep.run = 'echo "${{ github.event.pull_request.title }}"';
    const result = validateWorkflowOverride(toYaml(wf), NS_LAYOUT);
    expect(result).toEqual({ ok: false, violated: 'run_injection' });
  });

  it('a widened permissions map (contents: write) is refused', () => {
    const wf = validWorkflowObject(NS_LAYOUT);
    wf.permissions = { contents: 'write', 'pull-requests': 'write' };
    const result = validateWorkflowOverride(toYaml(wf), NS_LAYOUT);
    expect(result).toEqual({ ok: false, violated: 'permissions' });
  });

  it('a job-level permissions override (widening beyond the workflow-level grant) is refused', () => {
    const wf = validWorkflowObject(NS_LAYOUT);
    wf.jobs.review.permissions = { contents: 'write' };
    const result = validateWorkflowOverride(toYaml(wf), NS_LAYOUT);
    expect(result).toEqual({ ok: false, violated: 'job_level_permissions' });
  });

  it('run: with an appended --agent flag is refused as run_command_mismatch (the fourth SPEC-04 attack)', () => {
    const wf = validWorkflowObject(NS_LAYOUT);
    const reviewStep = wf.jobs.review.steps.find((s: any) => s.id === 'review');
    reviewStep.run = 'node .devdigest/runner/index.js --agent other';
    const result = validateWorkflowOverride(toYaml(wf), NS_LAYOUT);
    expect(result).toEqual({ ok: false, violated: 'run_command_mismatch' });
  });

  it('unparseable YAML is refused', () => {
    const result = validateWorkflowOverride('not: valid: yaml: [', NS_LAYOUT);
    expect(result.ok).toBe(false);
  });
});
