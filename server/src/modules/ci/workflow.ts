import { Document } from 'yaml';
import {
  ALLOWED_TRIGGERS,
  FORK_GUARD_EXPR,
  NODE_VERSION,
  PERMISSIONS_NO_POST,
  PERMISSIONS_POST,
  PINNED_ACTIONS,
  RUN_COMMAND,
} from './constants.js';

/**
 * `workflow.ts` — the GitHub Actions generator. This is the security-critical
 * file (this feature's whole product is a configuration that will execute in
 * a repository DevDigest does not own). Every value below is a `constants.ts`
 * export, never a local literal (Recommendation 2) — `workflow-validate.ts`
 * checks a hand-edited override against the SAME constants, so the two can
 * never independently drift on what "safe" means.
 *
 * Built as an object graph via `yaml`'s `Document` API (never string
 * concatenation/interpolation — same rule `manifest.ts` follows) so the
 * pinned-action version comments below can be attached as real trailing YAML
 * comments rather than baked into the scalar value itself.
 */

export type PostAs = 'github_review' | 'pr_comment' | 'none';

export interface BuildWorkflowInput {
  /** Caller-requested trigger types — intersected against `ALLOWED_TRIGGERS`
   *  here, not trusted as-is, so an unexpected value can never reach the
   *  emitted YAML regardless of what called this (AC-19, AC-20, E-4). */
  triggers: string[];
  postAs: PostAs;
  /** The literal ingest URL baked into the reporting step (Q-8). */
  ingestUrl: string;
}

/** Attach `# <version>` as a REAL trailing YAML comment on a mapping value,
 *  not as text embedded in the scalar (which would either corrupt the value
 *  or require quoting that defeats the point of a comment). */
function withVersionComment(doc: Document, path: (string | number)[], version: string): void {
  const node = doc.getIn(path, true);
  if (node && typeof node === 'object') {
    (node as { comment?: string }).comment = ` ${version}`;
  }
}

/**
 * Build the generated workflow as a parsed `yaml.Document` — callers that
 * need the raw object (e.g. `workflow-validate.ts`, for symmetry in a future
 * self-check) can call `.toJSON()`; `emitWorkflowYaml` below is the normal
 * entry point that also attaches the pinned-action comments and stringifies.
 */
export function buildWorkflow(input: BuildWorkflowInput): Document {
  const types = ALLOWED_TRIGGERS.filter((t) => input.triggers.includes(t));
  const permissions = input.postAs === 'none' ? PERMISSIONS_NO_POST : PERMISSIONS_POST;

  const reviewEnv: Record<string, string> = {
    OPENROUTER_API_KEY: '${{ secrets.OPENROUTER_API_KEY }}',
    GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
    GITHUB_REPOSITORY: '${{ github.repository }}',
    PR_NUMBER: '${{ github.event.pull_request.number }}',
    DEVDIGEST_POST_AS: input.postAs,
  };

  // Fix (finding 3): `status` is derived from the ARTIFACT's own content,
  // never from `steps.review.outcome`. The review step's exit code is
  // DELIBERATELY non-zero whenever the deterministic gate triggers
  // REQUEST_CHANGES — that's how a CRITICAL finding turns the check red
  // (AC-31/D-9, see the gate step below, which still reads
  // `$REVIEW_OUTCOME` for THAT decision and is unchanged). Conflating the two
  // meant a correctly-blocking review was recorded as `failed`, indistinguishable
  // from a genuine pre-review crash, and made `no_findings` unreachable.
  // Here: RESULT missing/literally `null` (the runner's hard-fail path wrote
  // no artifact) -> failed; RESULT present with findings_count === 0 ->
  // no_findings; any other findings_count -> succeeded.
  const reportScript = [
    'if [ -f devdigest-result.json ]; then',
    '  RESULT=$(cat devdigest-result.json)',
    'else',
    '  RESULT=null',
    'fi',
    'if [ "$RESULT" = "null" ]; then',
    '  STATUS=failed',
    'else',
    "  FINDINGS_COUNT=$(echo \"$RESULT\" | jq -r '.findings_count')",
    '  if [ "$FINDINGS_COUNT" = "0" ]; then',
    '    STATUS=no_findings',
    '  else',
    '    STATUS=succeeded',
    '  fi',
    'fi',
    'BODY=$(jq -n \\',
    '  --argjson result "$RESULT" \\',
    '  --arg repo "$REPO" \\',
    '  --arg head_sha "$HEAD_SHA" \\',
    '  --arg pr_number "$PR_NUMBER" \\',
    '  --arg actions_run_id "$ACTIONS_RUN_ID" \\',
    '  --arg job_url "$JOB_URL" \\',
    '  --arg status "$STATUS" \\',
    "  '{result: $result, repo: $repo, head_sha: $head_sha, pr_number: ($pr_number | tonumber? // null), actions_run_id: $actions_run_id, job_url: $job_url, source: \"github_actions\", status: $status, duration_ms: null, error: null}')",
    'curl -sS -X POST "$INGEST_URL" \\',
    '  -H "Authorization: Bearer $INGEST_TOKEN" \\',
    '  -H "Content-Type: application/json" \\',
    '  -d "$BODY"',
  ].join('\n');

  const gateScript = [
    'echo "Review step outcome: $REVIEW_OUTCOME"',
    'if [ "$REVIEW_OUTCOME" = "failure" ]; then',
    '  echo "Review reported blocking findings or failed to run; failing the job."',
    '  exit 1',
    'fi',
  ].join('\n');

  const workflowObject = {
    on: { pull_request: { types } },
    permissions,
    jobs: {
      review: {
        if: FORK_GUARD_EXPR,
        'runs-on': 'ubuntu-latest',
        steps: [
          {
            name: 'Checkout',
            uses: `${PINNED_ACTIONS.checkout.name}@${PINNED_ACTIONS.checkout.sha}`,
          },
          {
            name: 'Set up Node',
            uses: `${PINNED_ACTIONS.setupNode.name}@${PINNED_ACTIONS.setupNode.sha}`,
            with: { 'node-version': NODE_VERSION },
          },
          {
            name: 'DevDigest review',
            id: 'review',
            'continue-on-error': true,
            env: reviewEnv,
            run: RUN_COMMAND,
          },
          {
            name: 'Report result to DevDigest',
            if: 'always()',
            'continue-on-error': true,
            env: {
              INGEST_URL: input.ingestUrl,
              INGEST_TOKEN: '${{ secrets.DEVDIGEST_INGEST_TOKEN }}',
              REPO: '${{ github.repository }}',
              HEAD_SHA: '${{ github.event.pull_request.head.sha }}',
              PR_NUMBER: '${{ github.event.pull_request.number }}',
              ACTIONS_RUN_ID: '${{ github.run_id }}',
              JOB_URL:
                '${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}',
              // NOTE: deliberately NOT passing REVIEW_OUTCOME here (finding 3)
              // — this step's status derivation reads ONLY the artifact
              // (RESULT/findings_count) above. REVIEW_OUTCOME is still read,
              // unchanged, by the separate "Gate on review outcome" step below,
              // which is what actually turns the job (and the check) red.
            },
            run: reportScript,
          },
          {
            name: 'Gate on review outcome',
            // Explicit always() (not the default success()): the reporting
            // step above is `continue-on-error: true` so its own failure
            // (e.g. an unreachable ingest URL — the normal case for a
            // local-first studio) must never cause this step to be skipped.
            // The job's pass/fail must come from `steps.review.outcome`
            // alone, never from whether the ingest POST succeeded.
            if: 'always()',
            env: { REVIEW_OUTCOME: '${{ steps.review.outcome }}' },
            run: gateScript,
          },
        ],
      },
    },
  };

  const doc = new Document();
  doc.contents = doc.createNode(workflowObject);
  withVersionComment(doc, ['jobs', 'review', 'steps', 0, 'uses'], PINNED_ACTIONS.checkout.version);
  withVersionComment(doc, ['jobs', 'review', 'steps', 1, 'uses'], PINNED_ACTIONS.setupNode.version);
  return doc;
}

/** `yaml`'s stringify (via the `Document` built above) — never string
 *  concatenation. `lineWidth: 0` disables line-folding so long lines (the
 *  `curl`/`jq` script, the fork-guard `if:` expression) are never wrapped
 *  mid-token into something that would change shell/expression semantics. */
export function emitWorkflowYaml(input: BuildWorkflowInput): string {
  const doc = buildWorkflow(input);
  return doc.toString({ lineWidth: 0 });
}
