# Development Plan: Multiple review agents on one repository in CI (SPEC-05)

Spec: [`specs/SPEC-05-multi-agent-ci-per-repo.md`](../../specs/SPEC-05-multi-agent-ci-per-repo.md)
Extends: SPEC-04 ([`docs/features/export-to-ci.md`](../features/export-to-ci.md),
[`docs/adr/0007-ci-ingest-bearer-token-hash-lookup.md`](../adr/0007-ci-ingest-bearer-token-hash-lookup.md))
Baseline commit: `9b047ad` (clean working tree; `specs/SPEC-05-*.md` untracked, to
land with this plan's own SDD-stage commit).

## Objective

Remove SPEC-04's "one repository hosts exactly one DevDigest agent" limit by
giving every new installation its own namespace under `.devdigest/<ns>/`, its own
`.github/workflows/devdigest-review-<ns>.yml`, and its own
`DEVDIGEST_INGEST_TOKEN_<NAMESPACE>` secret — while freezing every pre-existing
installation on its current unnamespaced layout forever, and without changing one
line of `agent-runner/`.

## Scope

- **Packages/modules touched:** `server/` (`src/modules/ci/**`,
  `src/db/schema/ci.ts` + a generated migration, `src/vendor/shared/contracts/eval-ci.ts`),
  `client/` (`src/vendor/shared/contracts/eval-ci.ts`, `src/lib/hooks/ci.ts`,
  `ExportWizard/**`, `CiTab/**`, `messages/en/ci.json`).
- **Execution mode:** multi-agent — full handoff chain
  (`implementer` → `test-writer` → `plan-verifier` → `doc-writer`), each a
  separate invocation. Tests and verification are NOT implementer work items;
  every AC's `(verify: …)` clause is `test-writer`'s oracle, not this plan's.
- **Explicitly out of scope:**
  - `agent-runner/**` — decision D-1, not one line (`DEVDIGEST_DIR` already
    exists at `agent-runner/src/index.ts:31`).
  - A per-agent branch or PR — decision D-2; the shared `devdigest/ci` branch and
    the reused PR stay exactly as `service.ts` implements them today, stale title
    and all (E-3).
  - Any migration of legacy installations — decision D-3.
  - An uninstall that removes files from the target repo (OQ-5), runner-bundle
    fingerprinting (OQ-1), a per-repo export lock or re-sized ingest limit (OQ-4),
    a CI-tab check-name display (OQ-3), CircleCI/Jenkins/CLI targets, MCP/pre-push
    parity, CI Runs pagination/grouping.
  - Removing `CiExportInput.replace_existing` from the contract — OQ-2 resolved:
    it stays, server-ignored.

## Constraints

- **Onion architecture** (`.claude/skills/onion-architecture`): `modules/ci/`
  keeps routes → service → repository port; `repository.drizzle.ts` remains the
  only file in the module importing `db/schema`. `helpers.ts` stays pure (the
  `no-helpers-to-io` dependency-cruiser rule). `service.ts` must not import
  `node:fs` (it calls `bundle.ts`). `pnpm arch:check` is the gate.
- **`constants.ts` is the single source of truth** both `workflow.ts` and
  `workflow-validate.ts` read (SPEC-04 Recommendation 2, restated as a binding
  simplicity constraint by SPEC-05). Namespaced paths derive from those constants;
  **no `LayoutStrategy` seam**, no per-file legacy conditional scattered through
  the generator — legacy is one boolean-shaped value resolved once per export.
- **Do-not-touch (root `AGENTS.md`):** `*/src/db/migrations/**` is generated —
  produce it with `cd server && pnpm db:generate`, never hand-write or hand-edit
  it. `*/src/vendor/**` is hand-mirrored — the two `eval-ci.ts` copies must end up
  byte-identical (`git diff --no-index` clean), no sync script exists.
- **Tenancy (A01, `server/src/modules/ci/repository.ts:7-20`):** `ci_installations`
  has **no** `workspace_id` column; every repository method that takes a
  `workspaceId` joins through `agents.workspace_id`. Any new "installations of this
  repository" read must keep that join (AC-37).
- **INSIGHTS entries that bind this work:**
  - `INSIGHTS.md` (2026-08-23, SPEC-04 Phase A): the two vendored `eval-ci.ts`
    copies are verified with `git diff --no-index`; a Zod const used before its own
    declaration in `eval-ci.ts` throws at module-eval time (TDZ) — declare new
    schemas after their dependencies.
  - `server/INSIGHTS.md:766` — `ci_installations.token_hash` is a lowercase hex
    string; any hand-inserted fixture row must match that encoding. (See Risks: the
    surrounding prose about `timingSafeEqual` is stale.)
  - `server/INSIGHTS.md:1602` — the `agents.workspace_id` join is the module's only
    tenancy mechanism.
  - Root `AGENTS.md`: migrations are never applied on boot — run
    `cd server && pnpm db:migrate` by hand after generating.

## Recommendations

1. **Model legacy as `namespace IS NULL`, not as a `layout` enum.** Add a single
   **nullable** `ci_installations.namespace text` column. Every row that exists at
   migration time is legacy by construction — no backfill, no data migration, and
   AC-14's "frozen forever" becomes a property of the schema rather than of code
   discipline. It also yields exactly the one boolean-shaped branch
   (`row.namespace === null`) the spec's simplicity constraints demand.
2. **Do NOT add a DB unique index for namespace uniqueness.** A
   `unique(repo, namespace)` index would be *global* across workspaces, and since
   two workspaces may legitimately hold same-named repositories it would make
   workspace B's export collide with workspace A's — the precise failure AC-37
   forbids. Uniqueness is per `(workspace, repo)` and must be enforced in the
   service over the workspace-scoped `findInstallationsByRepo` read. The residual
   race (two concurrent first-exports of same-slugging agents to one repo) is the
   same class as E-5, which the spec already accepts; recorded under Risks, not
   fixed here.
3. **`disambiguate()` cannot be reused literally for AC-2.** It suffixes duplicates
   *within one list*. With taken = `['sec', 'sec-2']` and candidate `sec`,
   `disambiguate([...taken, 'sec'])` yields `sec-2` for the candidate — colliding
   with the existing `sec-2`. AC-2 needs a "increment the suffix until it is not in
   the taken set" derivation that reuses the same `-2`/`-3` *shape*, next to
   `disambiguate` in `helpers.ts`. Do not change `disambiguate` itself — the skill
   slug path depends on its current semantics.
4. **AC-24 must cover inherited `env:`, not just the review step.** GitHub Actions
   resolves `env:` workflow → job → step, so an override can aim the runner at a
   foreign namespace by declaring `DEVDIGEST_DIR` at workflow or job level and
   leaving the review step clean. The validator must refuse a `DEVDIGEST_DIR` key
   anywhere *except* the review step's own `env`, and equal-match it there.
5. **AC-24's secret check needs a new scan surface.** `containsForbiddenExpression`
   (`workflow-validate.ts:46-48`) only inspects `run:` bodies; `${{ secrets.* }}`
   inside an `env:` value is currently unchecked. Implement an allowlist over every
   `env:` map — `OPENROUTER_API_KEY`, `GITHUB_TOKEN`, and this installation's own
   ingest secret name — refusing anything else. This is deliberately *tighter* than
   SPEC-04 (a hand-edit may no longer introduce an unrelated secret); it is the only
   shape that honestly implements "an ingest secret other than this installation's
   own", since a foreign name is not enumerable. Flagged so the user can reject it.
6. **The Preview response must carry the ingest secret name.** AC-28's secrets panel
   renders *before* any installation exists, so the name cannot come from
   `CiInstallation`. Deriving it client-side would duplicate server-owned namespace
   logic and drift. Extend the preview response from `{ files }` to
   `{ files, ingest_secret_name }` — one server-derived value feeding both the
   Configure panel and (via `CiExport.installation`) the token dialog.
7. **Drop the client's workflow-path literal — it is load-bearing and about to
   break.** `ExportWizard/helpers.ts:8`'s `WORKFLOW_PATH` is how `PreviewStep.tsx:68`
   decides which file gets the editable textarea and how `ExportWizard.tsx:110`
   writes the override back. With a per-agent filename it silently stops matching:
   no textarea, and `workflow_override` can never be set again. Key off the
   server-supplied `file.editable === true` instead (the server already marks
   exactly one file editable), and match the memory file by `endsWith("memory.jsonl")`.
8. **Bump `WORKFLOW_VERSION` to 2.** `constants.ts:101-103` requires a hand bump
   whenever `workflow.ts` changes what it emits. Legacy re-exports emit
   byte-identical YAML but will record `2` — harmless: the CI tab's drift banner
   compares `agent_version`, not `workflow_version` (`CiTab/helpers.ts`'s `isDrifted`).

## Module shape after this change

```
server/src/modules/ci/
  constants.ts          + pure path/name derivations from the existing literals
  helpers.ts            + deriveNamespace (slugify + collision suffixing)
  manifest.ts           ~ emitSkillFile takes the resolved skills dir
  workflow.ts           ~ BuildWorkflowInput gains the resolved layout
  workflow-validate.ts  ~ validateWorkflowOverride gains the expected layout
  service.ts            + resolveLayout; − ConflictError branch; + AC-7/AC-8 guards
  repository.ts         ~ namespace on the row + upsert input
  repository.drizzle.ts ~ maps the new column
```

## Work items

### 1. Contracts + schema + migration

- **Files/modules:** `server/src/vendor/shared/contracts/eval-ci.ts`,
  `client/src/vendor/shared/contracts/eval-ci.ts`, `server/src/db/schema/ci.ts`,
  a **generated** file under `server/src/db/migrations/`.
- **What:**
  - `CiInstallation` gains `ingest_secret_name: z.string()` (AC-28, AC-31) — the
    name only, never a value (AC-29).
  - Add a preview response schema (e.g. `CiExportPreview = z.object({ files:
    z.array(CiFile), ingest_secret_name: z.string() })`) so Recommendation 6 has a
    contract instead of an inline type. Declare it after `CiFile` (TDZ trap).
  - `CiExportInput.replace_existing` **stays**; amend its doc comment to state it is
    ignored on the `gha` path (AC-12, OQ-2). Do not remove the field.
  - `ci_installations` gains `namespace: text('namespace')` — **nullable, no
    default** (Recommendation 1). Document on the column, in the same voice as the
    existing `manifestPath` comment, that `NULL` means "legacy installation, frozen
    on the unnamespaced SPEC-04 layout forever (AC-14)". Add **no** unique index
    (Recommendation 2) — say why in the comment.
  - Generate the migration with `cd server && pnpm db:generate`; apply with
    `pnpm db:migrate`. Never hand-edit either.
- **Applicable skills:** `zod`, `typescript-expert` (contracts);
  `drizzle-orm-patterns`, `postgresql-table-design` (schema/migration).
- **Definition of done:** both packages typecheck; `git diff --no-index
  server/src/vendor/shared/contracts/eval-ci.ts
  client/src/vendor/shared/contracts/eval-ci.ts` is empty; the migration file is
  drizzle-kit output and applies cleanly against the running Postgres.

### 2. Namespace derivation + layout path derivation

- **Files/modules:** `server/src/modules/ci/helpers.ts`,
  `server/src/modules/ci/constants.ts`.
- **What:**
  - `helpers.ts`: add `deriveNamespace(agentName: string, taken: readonly string[]):
    string` — `slugify(agentName)` (inheriting every hostile-input guarantee at
    `helpers.ts:57-64` verbatim, AC-1), then the `-2`/`-3` suffix increment until the
    result is absent from `taken` (AC-2, Recommendation 3). Pure, no I/O. Leave
    `slugify` and `disambiguate` untouched.
  - `constants.ts`: add pure derivations beside the existing literals — agents dir,
    skills dir, memory path, workflow path, the runner's `DEVDIGEST_DIR` value, the
    ingest secret name, and the namespaced workflow `name:` — each taking
    `namespace: string | null` and returning the existing SPEC-04 literal when
    `null`. `RUNNER_PATH` and `RUN_COMMAND` are **not** parameterised (AC-6, AC-20).
    Secret name = `DEVDIGEST_INGEST_TOKEN_${ns.toUpperCase().replace(/-/g, '_')}`,
    `DEVDIGEST_INGEST_TOKEN` when `null` (AC-25, AC-22).
  - Keep the import direction one-way: `helpers.ts` may not import `constants.ts`'s
    derivations and `constants.ts` may not import `helpers.ts` — namespace *derivation*
    (name→slug) lives in helpers, path *shape* lives in constants.
- **Applicable skills:** `typescript-expert`.
- **Definition of done:** `pnpm typecheck` and `pnpm arch:check` clean; every
  namespaced path in the module is produced by one of these functions — no
  `.devdigest/` or `.github/workflows/` string literal exists anywhere outside
  `constants.ts`.

### 3. Generator — namespaced vs legacy file set

- **Files/modules:** `server/src/modules/ci/workflow.ts`,
  `server/src/modules/ci/manifest.ts`, `server/src/modules/ci/service.ts`
  (`generateFiles`).
- **What:**
  - Introduce one resolved layout value threaded through generation (e.g.
    `{ namespace: string | null; manifestPath: string }`), replacing
    `generateFiles`'s `manifestPathOverride?` parameter. One value, resolved once
    (WI5), passed down — not re-derived per file.
  - `emitSkillFile` takes the resolved skills directory instead of importing
    `SKILLS_SUBDIR` directly.
  - Memory placeholder path comes from the layout (`.devdigest/<ns>/memory.jsonl`
    vs `.devdigest/memory.jsonl`).
  - `workflow.ts`: `BuildWorkflowInput` gains the namespace. Namespaced variant
    emits a top-level `name:` derived from the namespace (AC-21); legacy emits
    **no** `name:` key at all (AC-16 — a changed workflow name silently invalidates
    a configured required status check). Review step gains
    `DEVDIGEST_DIR: .devdigest/<ns>` in its `env` when namespaced, and nothing when
    legacy (AC-19). Reporting step's `INGEST_TOKEN` references the derived secret
    name (AC-22). `run:` stays `RUN_COMMAND`, byte-identical, for both (AC-20).
  - Every SPEC-04 invariant is untouched for both variants: `pull_request`-only
    triggers, the exact two-key `permissions:`, SHA-pinned actions, the fork guard,
    no `github.event.*`/`secrets.*` inside a `run:` body, the Node floor (AC-23).
  - Bump `WORKFLOW_VERSION` to `2` (Recommendation 8).
  - AC-7 guard: after the file list is assembled, assert exactly one `*.yaml` exists
    under this export's own agents directory and throw (fail-closed, nothing
    committed) otherwise — `agent-runner/src/manifest.ts:37-45` refuses to start
    otherwise.
- **Applicable skills:** `typescript-expert`, `security` (this is the file whose
  output executes in a repository DevDigest does not own).
- **Definition of done:** for a given agent, the emitted path set is exactly
  AC-5's for a namespaced layout and exactly SPEC-04's for a legacy one; the AC-7
  assertion throws before any GitHub call.

### 4. Hand-edited-override re-validation (AC-24)

- **Files/modules:** `server/src/modules/ci/workflow-validate.ts` (callers in
  `service.ts`).
- **What:**
  - `validateWorkflowOverride` gains the expected layout (the namespace, hence the
    expected `DEVDIGEST_DIR` value and the expected ingest secret name).
  - Refuse unless the review step's own `env.DEVDIGEST_DIR` is exactly the expected
    string (namespaced) or absent entirely (legacy). String equality is what makes
    `..`, `.devdigest/other-agent`, an absolute path and a trailing-slash variant all
    refuse without special-casing traversal.
  - Refuse a `DEVDIGEST_DIR` key declared at workflow level or job level, or on any
    step other than the review step — `env:` inherits downward (Recommendation 4).
  - Refuse a `${{ secrets.X }}` reference in **any** `env:` value where `X` is not in
    `{ OPENROUTER_API_KEY, GITHUB_TOKEN, <this installation's ingest secret> }`
    (Recommendation 5). Keep the existing `run:`-body scan unchanged.
  - Each refusal returns a distinct `violated` name (e.g. `devdigest_dir_mismatch`,
    `devdigest_dir_inherited`, `foreign_secret_reference`) so the thrown
    `ValidationError` names the invariant, and nothing is committed (A10).
- **Applicable skills:** `security`, `typescript-expert`.
- **Definition of done:** an override with a foreign `DEVDIGEST_DIR`, one with
  `DEVDIGEST_DIR: ..`, one inheriting `DEVDIGEST_DIR` from job level, and one
  referencing another installation's ingest secret are each refused with a named
  invariant and zero GitHub writes.

### 5. Service — layout resolution, conflict removal, cross-installation guard

- **Files/modules:** `server/src/modules/ci/service.ts`,
  `server/src/modules/ci/repository.ts`,
  `server/src/modules/ci/repository.drizzle.ts`,
  `server/src/modules/ci/routes.ts`.
- **What:**
  - **Repository:** `CiInstallationRow` and `UpsertInstallationInput` gain
    `namespace: string | null`; `repository.drizzle.ts` maps the column in
    `toInstallationRow` and persists it on insert. `onConflictDoUpdate`'s `set`
    must **omit** `namespace` — like `tokenHash`, it is set once at insert and must
    be structurally incapable of being rewritten on update (AC-4, AC-14). Say so in
    the doc comment, mirroring the existing `tokenHash` comment.
  - **`resolveLayout(workspaceId, agentId, repo)`** — one read-only resolution used
    by Preview, Install and Zip, so "what Preview shows" and "what Install commits"
    cannot drift (SPEC-04 AC-5, AC-32):
    - existing installation for this `(agent, repo)` → reuse its own persisted
      `namespace` **and** `manifestPath` verbatim, forever (AC-4, AC-9, AC-14, AC-26);
    - otherwise → `deriveNamespace(agent.name, <namespaces already taken on this
      repo in this workspace>)` and a manifest path under that namespace (AC-17 —
      no "first agent gets the short paths" case).
    The taken set comes from `findInstallationsByRepo(workspaceId, repo)`, which
    already carries the `agents.workspace_id` join (AC-37).
  - **Delete the `ConflictError` branch** (`service.ts:284-294`) and everything it
    fed: the `conflicting` lookup-and-inherit of another installation's
    `manifestPath` (`service.ts:296-311`) and the `deleteInstallation(conflicting.id)`
    step (`service.ts:335-337`). A different agent on the same repo is an ordinary
    install (AC-11). `input.replace_existing` is read nowhere on this path (AC-12).
  - **AC-8 guard, fail-closed before `commitFiles`:** using the same
    already-fetched list of the repository's other installations, compute each
    foreign installation's owned paths from its own persisted namespace (a legacy
    row owns `.devdigest/agents/`, `.devdigest/skills/`, `.devdigest/memory.jsonl`
    and `WORKFLOW_PATH`; a namespaced row owns `.devdigest/<ns>/` and its own
    workflow file) and refuse the export if any generated path other than
    `RUNNER_PATH` falls inside one. Compare on **path segments**, not raw string
    prefixes — `.devdigest/agents/` must not appear to contain
    `.devdigest/api-contract/agents/…`.
  - `toInstallationContract` populates `ingest_secret_name` from the row's namespace.
  - Preview route returns `{ files, ingest_secret_name }` (Recommendation 6); Zip
    resolves the same layout (candidate namespace for a not-yet-installed agent) and
    passes it to both the generator and the override validator.
  - Logging: add `namespace` and keep `installationId` on the export and ingest log
    lines (A09). A secret *name* is loggable; a token or hash never is (AC-29).
  - Ingest (`service.ts:487-569`) is **unchanged** — the hash-keyed lookup already
    resolves exactly one installation and therefore one agent (AC-34), the
    repo-equality check stays a repo check (AC-35), and idempotency stays on
    `(installation, actions_run_id)` (AC-36).
- **Applicable skills:** `onion-architecture`, `drizzle-orm-patterns`,
  `fastify-best-practices` (routes), `security`, `typescript-expert`.
- **Definition of done:** exporting a second, different agent to a repo that
  already hosts one succeeds with no confirmation flag, produces two rows, two
  namespaces and two token hashes, deletes nothing, and commits no path under the
  other installation's namespace; a legacy installation re-exported produces a
  byte-identical path set and secret name; `pnpm arch:check` clean.

### 6. Client — data layer + Export Wizard

- **Files/modules:** `client/src/lib/hooks/ci.ts`,
  `client/src/app/agents/[id]/_components/AgentEditor/_components/ExportWizard/helpers.ts`,
  `.../ExportWizard/ExportWizard.tsx`, `.../ExportWizard/_components/PreviewStep.tsx`,
  `.../ExportWizard/_components/InstallStep.tsx`,
  `.../ExportWizard/_components/ConfigureStep.tsx`.
- **What:**
  - `useCiPreview` returns the new preview contract; the wizard holds
    `ingestSecretName` in the same single parent-owned state block as `files`.
  - Delete `WORKFLOW_PATH`/`MEMORY_PATH` literals from `helpers.ts`; select the
    editable file by `file.editable === true` and the memory note by
    `path.endsWith("memory.jsonl")` (Recommendation 7). The override write-back in
    `ExportWizard.tsx:110` keys off the same predicate.
  - Remove `replaceExisting` from `WizardState` and stop sending `replace_existing`
    in `buildExportInput` (AC-12).
  - `InstallStep.tsx`: delete the 409 `conflict` branch and its box
    (`InstallStep.tsx:52,105-113`); `onInstall` loses its `replaceExisting`
    parameter; the one-time token dialog names the exact secret to paste under
    (AC-28, UX-3) from `install.data.installation.ingest_secret_name`.
  - `ConfigureStep.tsx`: the secrets panel's ingest row shows the server-supplied
    name instead of the literal `DEVDIGEST_INGEST_TOKEN`, keeping the existing
    "DevDigest cannot read, set or verify a repository secret" disclaimer and its
    honest-checklist framing (AC-28, UX-4).
  - Preview keeps showing exact paths — with namespacing those now read as the
    namespace the user will see in their repo (UX-2); no new UI element needed.
- **Applicable skills:** `react-project-structure` (colocated `_components/<Name>/`,
  hooks only via `src/lib/hooks/*`), `react-best-practices`, `next-best-practices`,
  `typescript-expert`.
- **Definition of done:** the wizard's `gha` path never renders a replace-existing
  confirmation, the workflow textarea still appears for a namespaced workflow
  filename, and every displayed secret name comes from the server.

### 7. Client — CI tab + i18n

- **Files/modules:**
  `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/CiTab.tsx`,
  `client/messages/en/ci.json`.
- **What:**
  - Render each installation's `ingest_secret_name` on its row (AC-31, UX-3) — it is
    not re-derivable by hand once the agent has been renamed. The tab keeps listing
    only this agent's own installations (AC-30); add no cross-agent count or link.
  - `ci.json`: delete `exportWizard.conflictTitle` and `exportWizard.conflictConfirm`
    (UX-1). Parameterise `exportWizard.secretsPanel.ingestTokenName` and
    `exportWizard.tokenBlock.warning` on the secret name. Reword
    `runs.emptyBody`, which hard-codes `DEVDIGEST_INGEST_TOKEN`. Add a CI-tab label
    for the secret name. Avoid any copy implying an agent owns a repository
    exclusively (UX-6).
  - The CI Runs page needs **no** change — it already renders an agent column and an
    agent filter (AC-33).
- **Applicable skills:** `react-project-structure`, `react-best-practices`.
- **Definition of done:** no `next-intl` key is referenced-but-missing or
  defined-but-unused; the CI tab shows a secret name per installation; the CI Runs
  page is untouched.

## Test plan

Owned by `test-writer`, not by `implementer`. Commands, per package
(`server/AGENTS.md`, `client/AGENTS.md` — these are the exact strings; the server
split is not in `package.json` and must be typed out):

```bash
# server
cd server
pnpm typecheck
pnpm arch:check
pnpm exec vitest run --exclude '**/*.it.test.ts'   # unit
pnpm exec vitest run .it.test                      # integration (Docker required)
pnpm test                                          # both

# client
cd client
pnpm typecheck
pnpm test

# vendored-contract byte identity (AC-38)
git diff --no-index server/src/vendor/shared/contracts/eval-ci.ts client/src/vendor/shared/contracts/eval-ci.ts

# migration (Docker must be up; migrations are never applied on boot)
cd server && pnpm db:migrate
```

Notes for whoever writes the tests:

- **The `ci` module currently has zero tests** — no `server/test/ci-*.test.ts`, no
  `CiTab`/`ExportWizard` `*.test.tsx`. SPEC-04 shipped deliberately without them
  (`constants.ts:1-11`). This is net-new test infrastructure, not an extension.
- Server integration tests follow `server/test/eval-read-apis.it.test.ts`'s harness:
  `startPg`/`dockerAvailable` from `test/helpers/pg.ts`, `buildApp({ config, db,
  overrides })`, skipped when Docker is absent.
- `MockGitHubClient` (`server/src/adapters/mocks.ts:131`) already records
  `committed` payloads and `openedPrs`, injectable via
  `ContainerOverrides.github` — that is how AC-5/AC-8/AC-10/AC-13 assert the exact
  committed path set without a real GitHub token.
- **`readRunnerBundle()` reads the gitignored `agent-runner/dist/index.js`**, and
  `service.ts` calls it with no injectable dep, so any test that reaches
  `generateFiles` needs `cd agent-runner && pnpm build` first (or the bundle read
  made injectable — a design change, not a given).
- Client component tests use `react-testing-library` per `client/AGENTS.md`'s
  colocated `_components/<Name>/*.test.tsx` convention.

## Risks / Open questions

- **Namespace-uniqueness race.** With no DB-enforceable constraint
  (Recommendation 2), two genuinely concurrent first-exports of same-slugging
  agents to one repo can both pick the same namespace. Same class as the spec's
  E-5 shared-branch race, which SPEC-05 accepts without a lock. Not fixed here;
  raise with the user if the implementer believes it warrants one.
- **The zip path mints a namespace nothing owns.** `exportZip` creates no
  installation (SPEC-04's documented limitation, restated in SPEC-05's non-goals),
  so its generated workflow references a `DEVDIGEST_INGEST_TOKEN_<NS>` secret for a
  candidate namespace that no installation will ever hold, and a later real export
  of the same agent may derive a different suffix. Pre-existing shape, widened.
  Document it; do not silently "fix" it by minting an installation.
- **Preview's candidate namespace can go stale.** For a not-yet-installed agent,
  Preview resolves a candidate; if another agent installs to the same repo before
  Install runs, the committed namespace may carry a different suffix than the one
  previewed. Cosmetic, deterministic, and self-correcting on re-preview.
- **Recommendation 5 tightens what a hand-edited override may contain**
  (an env-level `${{ secrets.X }}` outside the three-name allowlist now refuses).
  This is the honest reading of AC-24 but is stricter than SPEC-04 shipped. If the
  user wants hand-edits to keep introducing arbitrary secrets, say so before WI4
  lands.
- **`server/INSIGHTS.md:766`'s surrounding prose is stale.** It describes the
  ingest path re-hashing to a raw Buffer and comparing with `timingSafeEqual`; the
  shipped code (`service.ts:493-521`, commit `26ad30b`, ADR-0007) uses a
  hash-**keyed lookup** with no comparison at all. The hex-encoding fact itself is
  still correct and still load-bearing for fixture rows. `implementer` should
  correct that entry at session end (`engineering-insights` skill) — this plan
  cannot, its write scope is `docs/plans/`.
- **Dirty working tree — RESOLVED/checkpointed.** The pre-existing uncommitted edits
  to `workflow.ts`, `ConfigureStep.tsx`, `ExportWizard/styles.ts`, `CiTab/styles.ts`
  and `ci.json`, plus three stray `NUL` artifacts, were committed/removed as
  baseline `9b047ad` before this plan was written. Only `specs/SPEC-05-*.md` is
  untracked, to land with this plan's own SDD-stage commit. Note that `9b047ad`
  changed what `workflow.ts` emits (`continue-on-error` + `if: always()`) **without**
  bumping `WORKFLOW_VERSION` — WI3's bump to `2` covers both that change and this one.
- **OQ-1/OQ-3/OQ-4/OQ-5 stay open by decision**, not by omission: the shared runner
  bundle carries no version marker, the CI tab does not surface a check name for
  branch protection, there is no per-repo fan-out cap or export lock, and there is
  no uninstall that removes committed files. `implementer` must not resolve any of
  them silently.

## Explicitly out of scope

- Writing tests or running a verification pass — `test-writer` and `plan-verifier`
  own those, as separate invocations.
- Feature docs, API reference and any ADR (e.g. for the nullable-namespace legacy
  freeze) — `doc-writer` owns those, including the `AGENTS.md` docs index.
- Architecture review and security review — separate agents own these.
- Editing `specs/**` — human-authored (and `spec-creator`-authored) territory.
