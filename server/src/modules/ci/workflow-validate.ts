import { parse as parseYaml } from 'yaml';
import {
  ALLOWED_TRIGGERS,
  devdigestDirFor,
  FORK_GUARD_EXPR,
  FORBIDDEN_EVENTS,
  ingestSecretNameFor,
  PERMISSIONS_NO_POST,
  PERMISSIONS_POST,
  PINNED_ACTIONS,
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
 * SPEC-05 AC-24 widens this file's threat model: a hand-edited override
 * must not be able to aim one agent's workflow at ANOTHER agent's namespace
 * (via `DEVDIGEST_DIR`) or another agent's ingest secret. Two new checks,
 * both against `ExpectedLayout` (this installation's OWN resolved
 * namespace, from `constants.ts`'s derivations — Recommendation 2, never a
 * value re-derived independently here):
 *   - `DEVDIGEST_DIR` (Recommendation 4): `env:` inherits workflow → job →
 *     step in GitHub Actions, so this is refused anywhere EXCEPT the review
 *     step's own `env`, where it must equal the expected value (namespaced)
 *     or be entirely absent (legacy) — string equality is what makes `..`,
 *     `.devdigest/other-agent`, an absolute path and a trailing-slash
 *     variant all refuse without special-casing traversal.
 *   - `${{ secrets.X }}` inside ANY `env:` OR `with:` value (Recommendation
 *     5, widened by fix-loop iteration 1): an allowlist of
 *     `OPENROUTER_API_KEY`, `GITHUB_TOKEN` and this installation's own
 *     ingest secret — anything else refuses. This is a new scan surface:
 *     `containsForbiddenExpression` below only ever inspected `run:` bodies,
 *     which never carry a `secrets.*` reference inside a mapping VALUE (as
 *     opposed to a script). `with:` is scanned by the SAME
 *     `mapHasForeignSecretRef` helper as `env:`, at every level (workflow,
 *     job, step) `env:` is already checked at, under the SAME
 *     `foreign_secret_reference` name — structurally it is the identical
 *     scan applied to a sibling mapping, not a new invariant.
 *
 * Fix-loop iteration 1 (`plan-verifier`, two Major findings against AC-24's
 * "an override must not be able to aim one agent's workflow at another
 * agent's namespace" invariant):
 *   - `$GITHUB_ENV`: nothing inspected `run:` bodies for
 *     `>> $GITHUB_ENV`, so a step BEFORE the review step could write
 *     `DEVDIGEST_DIR=<foreign namespace>` into the job's environment and the
 *     review step would inherit it — bypassing the `DEVDIGEST_DIR`
 *     env-map checks above entirely, since `GITHUB_ENV` is a THIRD way (next
 *     to `env:` inheritance) a step's environment gets populated that this
 *     file didn't watch. Refused unconditionally: this module's OWN
 *     generated `run:` bodies (`workflow.ts`) never reference `GITHUB_ENV`
 *     at all, so refusing the bare token — not just a `DEVDIGEST_DIR=`-
 *     prefixed write — closes off variable-indirection/reordering bypasses
 *     of a narrower pattern with zero legitimate false-positive risk.
 *   - `uses:` pinning: the old check (`UNPINNED_ACTION_RE`) verified SHAPE
 *     only (`owner/repo@<40-hex>`), never IDENTITY — `attacker/exfil@<any
 *     40 hex>` passed. Every step's `uses:` is now matched against
 *     `constants.ts`'s `PINNED_ACTIONS` allowlist by exact `owner/repo@sha`
 *     equality. This is a STRICTER superset of the old shape check (every
 *     value the old regex rejected, the new allowlist rejects too — nothing
 *     the old check refused is now accepted), so it keeps the same intent
 *     but is no longer well-described by the old `unpinned_action` name (a
 *     value can have perfectly valid 40-hex shape and still not be an
 *     allowlisted action) — refused under the new `action_not_allowlisted`
 *     name instead, per plan-verifier's explicit "own distinct violated
 *     name" instruction for this check.
 *
 * Refuses, never sanitizes (A10 fail-closed) — every failure path returns
 * `{ ok: false, violated: <name> }` naming the invariant that failed; the
 * caller commits nothing on any `ok: false` result.
 */

export type WorkflowValidationResult = { ok: true } | { ok: false; violated: string };

/** This installation's resolved layout, as `service.ts`'s `resolveLayout`
 *  (or `computeLayout`) produced it — the SAME namespace `workflow.ts` used
 *  to generate the ORIGINAL file, never re-derived independently here. */
export interface ExpectedLayout {
  namespace: string | null;
}

const SECRET_EXPR_RE = /\$\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}/g;

/** Every `uses:` value this workflow may EVER reference — exact
 *  `owner/repo@sha` equality against `constants.ts`'s `PINNED_ACTIONS`
 *  (Q-5's single source of truth), never a shape-only pattern. Built once,
 *  module-load time. */
const ALLOWED_ACTION_REFS = new Set(
  Object.values(PINNED_ACTIONS).map((action) => `${action.name}@${action.sha}`),
);

/** `GITHUB_ENV` (fix-loop iteration 1): the literal env-var name, refused
 *  anywhere it appears in a `run:` body — this module's OWN generated
 *  scripts (`workflow.ts`) never reference it, so there is no legitimate
 *  use to preserve, and matching the bare token (rather than only an
 *  `>> $GITHUB_ENV`-shaped append) closes off variable-indirection or
 *  differently-ordered-assignment bypasses of a narrower pattern. */
const GITHUB_ENV_RE = /GITHUB_ENV/;

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

/** Every `${{ secrets.X }}` reference inside `value` whose `X` is not in
 *  `allowed` (Recommendation 5) — collects all offenders rather than
 *  short-circuiting on the first, though the caller only needs to know
 *  whether the list is non-empty. */
function foreignSecretRefs(value: string, allowed: ReadonlySet<string>): string[] {
  const offenders: string[] = [];
  SECRET_EXPR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SECRET_EXPR_RE.exec(value))) {
    const name = match[1];
    if (name && !allowed.has(name)) offenders.push(name);
  }
  return offenders;
}

/** Scan every string value of a plain mapping — `env:` OR `with:` — for a
 *  foreign secret reference (Recommendation 5, widened to `with:` in
 *  fix-loop iteration 1) — distinct from `containsForbiddenExpression`,
 *  which only ever inspected `run:` SCRIPT bodies. Both mappings share this
 *  ONE scan because the attack is identical either way: a
 *  `${{ secrets.X }}` reference reaching an arbitrary third-party action,
 *  whether via that action's `env:` or its own `with:` inputs. */
function mapHasForeignSecretRef(map: unknown, allowed: ReadonlySet<string>): boolean {
  if (!isPlainObject(map)) return false;
  return Object.values(map).some(
    (value) => typeof value === 'string' && foreignSecretRefs(value, allowed).length > 0,
  );
}

/** `GITHUB_ENV` (fix-loop iteration 1): `true` if `script` references the
 *  token anywhere — refused unconditionally, on EVERY step's `run:` body,
 *  not just the review step's, since the bypass this closes is a step
 *  BEFORE the review step writing into the job's environment for the
 *  review step to inherit. */
function containsGithubEnvWrite(script: string): boolean {
  return GITHUB_ENV_RE.test(script);
}

export function validateWorkflowOverride(text: string, layout: ExpectedLayout): WorkflowValidationResult {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch {
    return { ok: false, violated: 'unparseable_yaml' };
  }
  if (!isPlainObject(doc)) return { ok: false, violated: 'not_an_object' };

  const expectedDevdigestDir = devdigestDirFor(layout.namespace);
  const allowedSecrets = new Set([
    'OPENROUTER_API_KEY',
    'GITHUB_TOKEN',
    ingestSecretNameFor(layout.namespace),
  ]);

  // ---- AC-24 / Recommendation 5: no foreign secret ref at workflow level,
  // in EITHER env: or with: (fix-loop iteration 1 widens the scan to with:) --
  if (mapHasForeignSecretRef(doc.env, allowedSecrets) || mapHasForeignSecretRef(doc.with, allowedSecrets)) {
    return { ok: false, violated: 'foreign_secret_reference' };
  }
  // ---- AC-24 / Recommendation 4: DEVDIGEST_DIR never at workflow level ----
  if (isPlainObject(doc.env) && 'DEVDIGEST_DIR' in doc.env) {
    return { ok: false, violated: 'devdigest_dir_inherited' };
  }

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

    // ---- AC-24 / Recommendation 4/5: job-level env — no DEVDIGEST_DIR
    // (env: inherits workflow -> job -> step), no foreign secret ref in
    // EITHER env: or with:. ----
    if (isPlainObject(job.env)) {
      if (mapHasForeignSecretRef(job.env, allowedSecrets)) {
        return { ok: false, violated: 'foreign_secret_reference' };
      }
      if ('DEVDIGEST_DIR' in job.env) return { ok: false, violated: 'devdigest_dir_inherited' };
    }
    if (mapHasForeignSecretRef(job.with, allowedSecrets)) {
      return { ok: false, violated: 'foreign_secret_reference' };
    }

    const steps = job.steps;
    if (!Array.isArray(steps)) continue;

    for (const step of steps) {
      if (!isPlainObject(step)) continue;
      const isReviewStep = step.id === 'review';

      // ---- every uses: is an EXACT owner/repo@sha match against
      // constants.ts's PINNED_ACTIONS allowlist (AC-24, Q-5, fix-loop
      // iteration 1 — identity, not shape) ----
      if (typeof step.uses === 'string' && !ALLOWED_ACTION_REFS.has(step.uses)) {
        return { ok: false, violated: 'action_not_allowlisted' };
      }

      // ---- AC-24 / Recommendation 5 widened to with: (fix-loop iteration 1)
      // — a foreign secret reference reaching a step's action INPUTS is the
      // same exfiltration shape as one reaching its env:. ----
      if (mapHasForeignSecretRef(step.with, allowedSecrets)) {
        return { ok: false, violated: 'foreign_secret_reference' };
      }

      // ---- AC-24 / Recommendation 4: DEVDIGEST_DIR ONLY on the review
      // step's own env, equal-matched against the expected value (namespaced)
      // or required absent (legacy) — string equality alone refuses `..`,
      // `.devdigest/other-agent`, an absolute path, and a trailing-slash
      // variant, with no traversal special-casing needed. ----
      const stepEnv = isPlainObject(step.env) ? step.env : null;
      if (stepEnv && mapHasForeignSecretRef(stepEnv, allowedSecrets)) {
        return { ok: false, violated: 'foreign_secret_reference' };
      }
      const stepHasDevdigestDir = !!stepEnv && 'DEVDIGEST_DIR' in stepEnv;
      if (stepHasDevdigestDir && !isReviewStep) {
        return { ok: false, violated: 'devdigest_dir_inherited' };
      }
      if (isReviewStep) {
        const actual = stepHasDevdigestDir ? stepEnv!.DEVDIGEST_DIR : undefined;
        if (actual !== (expectedDevdigestDir ?? undefined)) {
          return { ok: false, violated: 'devdigest_dir_mismatch' };
        }
      }

      if (typeof step.run === 'string') {
        // ---- no PR-content / secret expression inside a run: body (AC-30) ----
        if (containsForbiddenExpression(step.run)) {
          return { ok: false, violated: 'run_injection' };
        }
        // ---- no $GITHUB_ENV write, on ANY step, not just the review step
        // (AC-24, fix-loop iteration 1) — a step BEFORE the review step
        // writing DEVDIGEST_DIR (or anything else) into $GITHUB_ENV would
        // otherwise bypass every env:-map check above, since GITHUB_ENV is
        // a THIRD way (next to env: inheritance) a step's environment gets
        // populated. ----
        if (containsGithubEnvWrite(step.run)) {
          return { ok: false, violated: 'github_env_write' };
        }
        // ---- the review step's run: is RUN_COMMAND, exactly (AC-25) — the
        // one string-equality check (Recommendation 3); this is what refuses
        // `node .devdigest/runner/index.js --agent other`.
        if (isReviewStep) {
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
