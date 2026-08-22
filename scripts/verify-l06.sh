#!/usr/bin/env bash
#
# Lesson 06 self-check (Eval Pipeline) — proves L06's deliverables still
# compile, still respect the module boundary rules, and their existing tests
# still pass, as a single pre-submission gate. Course lab name: `verify:l06`.
#
#   ./scripts/verify-l06.sh          # run all five lanes, fail fast
#   ./scripts/verify-l06.sh --help   # print this block
#
# Five lanes, run in order, fail fast (stops at the first failure and names
# it; exits 0 only when all five pass):
#   1. server typecheck — tsc --noEmit -p tsconfig.json
#   2. server arch:check — depcruise --config .dependency-cruiser.cjs src.
#      modules/eval/ is the repo's first module built entirely under the
#      onion-architecture boundary rules (it is not in PRE_EXISTING_MODULES),
#      so a gate that only typechecks would happily pass a
#      service.ts -> db/schema import; this lane is what actually catches
#      that class of mistake (docs/plans/eval-pipeline.md, Recommendation 4).
#   3. server unit tests, NARROWED to the L06 suites (eval-ci-contracts,
#      eval-helpers, eval-runner, eval-scorer) plus
#      --exclude '**/*.it.test.ts'. Narrowing is load-bearing, not an
#      optimisation, for the same two reasons verify-l03.sh's lane 2 has:
#      server/test/indexer-pipeline.test.ts has known Windows-only flakes
#      (server/INSIGHTS.md) that would fail a whole-suite gate on a clean
#      checkout, and the --exclude keeps the Docker-backed eval-*.it.test.ts
#      files (eval-cases, eval-create-from-finding, eval-read-apis,
#      eval-runner-batch) out so this gate passes with Docker stopped.
#   4. client typecheck — tsc --noEmit. Package-wide by construction; tsc
#      has no honest "just these folders" mode here.
#   5. client's FULL test suite — vitest run. Same reasoning as
#      verify-l03.sh's lane 4: no narrower per-folder script or tag/project
#      split exists in client/vitest.config.ts or client/package.json, the
#      suite is jsdom-only (no Docker), and a path filter would silently stop
#      covering L06 code the moment a file moves.
#
# Deliberately excluded: reviewer-core. Unlike L03 (which touched
# reviewer-core/src/prompt.ts and src/review/run.ts, making its exclusion a
# scoping call over files that HAD changed), L06's Eval Pipeline does not
# touch reviewer-core at all — it consumes reviewPullRequest exactly as-is
# (docs/plans/eval-pipeline.md Scope: "a second grounding implementation is
# forbidden"). `git diff --stat main...L06-Evals-homework -- reviewer-core`
# is empty for this feature, so there is nothing here for a reviewer-core
# lane to verify, not an oversight.
#
# Local binaries are invoked directly — ./node_modules/.bin/tsc,
# ./node_modules/.bin/vitest, ./node_modules/.bin/depcruise — never
# `pnpm typecheck` / `pnpm exec vitest` / `pnpm arch:check`. Root INSIGHTS.md
# documents `pnpm <script>` aborting with
# ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY in a non-interactive shell, and
# a gate script is always non-interactive, so side-stepping pnpm's runner is
# the right call here, not a workaround bolted on after a first failure.
# Relatedly: never run bare `pnpm test run` (client/INSIGHTS.md — that is
# not "run the tests") and never `cd server && pnpm test` (server/AGENTS.md
# — that also runs Docker-backed integration tests). Neither belongs
# anywhere in this script, including in a comment demonstrating what not
# to do.
#
# Designed to pass with Docker stopped. Installs nothing and never writes to
# the working tree — if server/'s or client/'s node_modules is missing, this
# fails with an actionable message instead of a bare "command not found".

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

for arg in "$@"; do
  case "$arg" in
    -h|--help) sed -n '2,60p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

# --- prerequisites (never installs; fails with an actionable message) -------
[ -d server/node_modules ] || { warn "server/node_modules missing — run: cd server && pnpm install"; exit 1; }
[ -d client/node_modules ] || { warn "client/node_modules missing — run: cd client && pnpm install"; exit 1; }

# --- the five lanes -----------------------------------------------------------
server_typecheck() { (cd server && ./node_modules/.bin/tsc --noEmit -p tsconfig.json); }

server_arch_check() { (cd server && ./node_modules/.bin/depcruise --config .dependency-cruiser.cjs src); }

server_unit_tests_l06() {
  (cd server && ./node_modules/.bin/vitest run --exclude '**/*.it.test.ts' \
    test/eval-ci-contracts.test.ts \
    test/eval-helpers.test.ts \
    test/eval-runner.test.ts \
    test/eval-scorer.test.ts)
}

client_typecheck() { (cd client && ./node_modules/.bin/tsc --noEmit); }

client_tests_full() { (cd client && ./node_modules/.bin/vitest run); }

run_lane() {
  local name="$1"; shift
  log "$name"
  if "$@"; then
    printf '\033[1;32m✓ %s\033[0m\n' "$name"
  else
    printf '\033[1;31m✗ %s failed — verify-l06 stopped here\033[0m\n' "$name" >&2
    exit 1
  fi
}

run_lane "1/5 server typecheck"                              server_typecheck
run_lane "2/5 server arch:check (onion boundary)"            server_arch_check
run_lane "3/5 server unit tests (L06: eval pipeline)"        server_unit_tests_l06
run_lane "4/5 client typecheck"                              client_typecheck
run_lane "5/5 client tests (full suite)"                     client_tests_full

log "all five lanes passed — L06 (Eval Pipeline) is green"
