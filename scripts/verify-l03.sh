#!/usr/bin/env bash
#
# Lesson 03 self-check (Intent layer · Smart Diff) — proves L03's deliverables
# still compile and their existing tests still pass, as a single
# pre-submission gate. Course lab name: `verify:l03`.
#
#   ./scripts/verify-l03.sh          # run all four lanes, fail fast
#   ./scripts/verify-l03.sh --help   # print this block
#
# Four lanes, run in order, fail fast (stops at the first failure and names
# it; exits 0 only when all four pass):
#   1. server typecheck — tsc --noEmit -p tsconfig.json
#   2. server unit tests, NARROWED to the L03 suites (intent-inputs,
#      intent-service, smart-diff-classifier, smart-diff-service) plus
#      --exclude '**/*.it.test.ts'. Narrowing is load-bearing, not an
#      optimisation: server/test/indexer-pipeline.test.ts has 6 known
#      Windows-only flakes (server/INSIGHTS.md) that would fail a
#      whole-suite gate on a clean checkout; the --exclude also keeps
#      reviews.it.test.ts (Docker-backed) out.
#   3. client typecheck — tsc --noEmit. Package-wide by construction; tsc
#      has no honest "just these folders" mode here.
#   4. client's FULL test suite — vitest run. Verified against
#      client/vitest.config.ts (a single include: "src/**/*.test.{ts,tsx}")
#      and client/package.json (only `test: "vitest run"`): there is no
#      narrower per-folder script and no tag/project split to key off. The
#      suite is jsdom-only (no Docker), so running all of it is cheap —
#      cheaper and more robust than a path filter that would silently stop
#      covering L03 code the moment a file moves (this very lesson's files
#      keep moving across the plans that touch it).
#
# Deliberately excluded: reviewer-core. L03 also touched
# reviewer-core/src/prompt.ts, src/review/run.ts, and added
# reviewer-core/test/prompt-intent.test.ts (commit 97fa7e8), so a third lane
# would be defensible — but this gate is scoped to client + server only
# (user decision, 2026-08-09), not overlooked. Adding it later is three
# lines: `cd reviewer-core && ./node_modules/.bin/vitest run` (npm-installed,
# not pnpm).
#
# Local binaries are invoked directly — ./node_modules/.bin/tsc,
# ./node_modules/.bin/vitest — never `pnpm typecheck` / `pnpm exec vitest`.
# Root INSIGHTS.md documents `pnpm <script>` aborting with
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
    -h|--help) sed -n '2,53p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

# --- prerequisites (never installs; fails with an actionable message) -------
[ -d server/node_modules ] || { warn "server/node_modules missing — run: cd server && pnpm install"; exit 1; }
[ -d client/node_modules ] || { warn "client/node_modules missing — run: cd client && pnpm install"; exit 1; }

# --- the four lanes -----------------------------------------------------------
server_typecheck() { (cd server && ./node_modules/.bin/tsc --noEmit -p tsconfig.json); }

server_unit_tests_l03() {
  (cd server && ./node_modules/.bin/vitest run --exclude '**/*.it.test.ts' \
    test/intent-inputs.test.ts \
    test/intent-service.test.ts \
    test/smart-diff-classifier.test.ts \
    test/smart-diff-service.test.ts)
}

client_typecheck() { (cd client && ./node_modules/.bin/tsc --noEmit); }

client_tests_full() { (cd client && ./node_modules/.bin/vitest run); }

run_lane() {
  local name="$1"; shift
  log "$name"
  if "$@"; then
    printf '\033[1;32m✓ %s\033[0m\n' "$name"
  else
    printf '\033[1;31m✗ %s failed — verify-l03 stopped here\033[0m\n' "$name" >&2
    exit 1
  fi
}

run_lane "1/4 server typecheck"                              server_typecheck
run_lane "2/4 server unit tests (L03: intent + smart-diff)"  server_unit_tests_l03
run_lane "3/4 client typecheck"                              client_typecheck
run_lane "4/4 client tests (full suite)"                     client_tests_full

log "all four lanes passed — L03 (Intent layer · Smart Diff) is green"
