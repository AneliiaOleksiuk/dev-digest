import { parse as parseYaml } from 'yaml';
import {
  ALLOWED_TRIGGERS,
  FORK_GUARD_EXPR,
  FORBIDDEN_EVENTS,
  PERMISSIONS_NO_POST,
  PERMISSIONS_POST,
  RUN_COMMAND,
} from './constants.js';

/**
 * `workflow-validate.ts` — server-side re-validation of a hand-edited
 * workflow (AC-32, AC-33). Client-side editing is not a trust boundary
 * (E-19): whatever the wizard's textarea contains is re-checked here before
 * anything is committed to a stranger's repository.
 *
 * Recommendation 3: validate the PARSED yaml object, not the raw string.
 * AC-32's four named attacks (`pull_request_target`, `permissions:
 * write-all`, an unpinned `uses:` tag, and a `--agent other` flag appended to
 * the run command) are all trivially bypassable against a regex over raw
 * text (comments, quoting, flow style, anchors) — parsing first closes that
 * off. The ONE string-level check kept is the run command's exact equality
 * against `RUN_COMMAND`, which is what catches the fourth attack.
 *
 * Refuses, never sanitizes (A10 fail-closed) — every failure path returns
 * `{ ok: false, violated: <name> }` naming the invariant that failed; the
 * caller commits nothing on any `ok: false` result.
 */

export type WorkflowValidationResult = { ok: true } | { ok: false; violated: string };

const UNPINNED_ACTION_RE = /^[^/@]+\/[^/@]+@[0-9a-f]{40}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function permissionsEqual(value: unknown, expected: Record<string, string>): boolean {
  if (!isPlainObject(value)) return false;
  const expectedKeys = Object.keys(expected);
  const actualKeys = Object.keys(value);
  if (actualKeys.length !== expectedKeys.length) return false;
  return expectedKeys.every((key) => value[key] === expected[key]);
}

function containsForbiddenExpression(script: string): boolean {
  return /\$\{\{\s*github\.event\./.test(script) || /\$\{\{\s*secrets\./.test(script);
}

export function validateWorkflowOverride(text: string): WorkflowValidationResult {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch {
    return { ok: false, violated: 'unparseable_yaml' };
  }
  if (!isPlainObject(doc)) return { ok: false, violated: 'not_an_object' };

  // ---- on: block — pull_request only, allowed types only (AC-19, AC-20) ----
  const on = doc.on;
  if (!isPlainObject(on)) return { ok: false, violated: 'on_block' };
  const onKeys = Object.keys(on);
  const hasForbiddenEvent = onKeys.some((k) => (FORBIDDEN_EVENTS as readonly string[]).includes(k));
  if (hasForbiddenEvent) return { ok: false, violated: 'forbidden_event' };
  if (onKeys.length !== 1 || onKeys[0] !== 'pull_request') {
    return { ok: false, violated: 'on_block' };
  }
  const pr = on.pull_request;
  if (!isPlainObject(pr) || !Array.isArray(pr.types) || pr.types.length === 0) {
    return { ok: false, violated: 'on_block' };
  }
  const typesOk = pr.types.every(
    (t) => typeof t === 'string' && (ALLOWED_TRIGGERS as readonly string[]).includes(t),
  );
  if (!typesOk) return { ok: false, violated: 'on_block' };

  // ---- permissions — exact match, no job-level override (AC-21, AC-22, D-7) ----
  const permissions = doc.permissions;
  if (!permissionsEqual(permissions, PERMISSIONS_POST) && !permissionsEqual(permissions, PERMISSIONS_NO_POST)) {
    return { ok: false, violated: 'permissions' };
  }

  const jobs = doc.jobs;
  if (!isPlainObject(jobs) || Object.keys(jobs).length === 0) {
    return { ok: false, violated: 'jobs_missing' };
  }

  let reviewStepFound = false;
  let forkGuardFound = false;

  for (const job of Object.values(jobs)) {
    if (!isPlainObject(job)) return { ok: false, violated: 'jobs_missing' };
    if ('permissions' in job) return { ok: false, violated: 'job_level_permissions' };
    if (typeof job.if === 'string' && job.if.trim() === FORK_GUARD_EXPR) forkGuardFound = true;

    const steps = job.steps;
    if (!Array.isArray(steps)) continue;

    for (const step of steps) {
      if (!isPlainObject(step)) continue;

      // ---- every uses: is a full 40-hex-pinned SHA (AC-24) ----
      if (typeof step.uses === 'string' && !UNPINNED_ACTION_RE.test(step.uses)) {
        return { ok: false, violated: 'unpinned_action' };
      }

      if (typeof step.run === 'string') {
        // ---- no PR-content / secret expression inside a run: body (AC-30) ----
        if (containsForbiddenExpression(step.run)) {
          return { ok: false, violated: 'run_injection' };
        }
        // ---- the review step's run: is RUN_COMMAND, exactly (AC-25) — the
        // one string-equality check (Recommendation 3); this is what refuses
        // `node .devdigest/runner/index.js --agent other`.
        if (step.id === 'review') {
          reviewStepFound = true;
          if (step.run.trim() !== RUN_COMMAND) {
            return { ok: false, violated: 'run_command_mismatch' };
          }
        }
      }
    }
  }

  if (!reviewStepFound) return { ok: false, violated: 'review_step_missing' };
  if (!forkGuardFound) return { ok: false, violated: 'fork_guard_missing' };

  return { ok: true };
}
