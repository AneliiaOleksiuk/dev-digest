# Dependency audit — 2026-08-19

Scope: all 6 packages in this repo (`client`, `server`, `reviewer-core`,
`mcp`, `e2e`, `evals`). This is **not** a workspace/monorepo — each package
has its own `package.json` and lockfile, so sizes, outdated checks, and
vulnerability audits below are per-package and not deduplicated against
each other.

## TL;DR

- **~2.3 GB** of `node_modules` measured across 5 of 6 packages (`e2e`'s
  `node_modules` isn't installed — size not measured, see note below).
  Total repo on disk: **~2.72 GB**; `.git` is a comparatively small 14.8 MB.
- **101 vulnerabilities** reported in total across the six independent
  audits (32 + 35 + 8 + 5 + 20 + 1), including **5 separate "critical"
  findings** — but all 5 trace back to the *same* root cause (`vitest`
  <3.2.6), just counted once per package because nothing here is deduped.
  Real distinct critical issues: **1**.
- Two concrete, high-value fixes:
  1. **`server`: `drizzle-orm` 0.38.4 → 0.45.2** (direct prod dependency).
     Versions below 0.45.2 have a **high-severity SQL injection** advisory
     (improperly escaped SQL identifiers, GHSA-gpj5-g38j-94v9). The fix
     version is already the latest release — this is a straight bump, not
     a research project.
  2. **`client`: `next` 15.5.19 → ≥15.5.21** (patch bump, not a major).
     Closes two high-severity advisories: a Server Actions DoS
     (GHSA-m99w-x7hq-7vfj) and a Server Actions SSRF on custom servers
     (GHSA-89xv-2m56-2m9x).
- `typescript`, `vitest`, and `@types/node` are outdated by the same margin
  in every package that declares them (2, 2, and 4 major versions behind,
  respectively) — version ranges are consistent across packages, so there's
  no drift problem, just a repo-wide "haven't bumped tooling" problem.

## Method

Per package: `pnpm outdated` / `npm outdated`, `pnpm audit` / `npm audit`
(picking the tool matching that package's actual lockfile — not the one
AGENTS.md documents, see note below), and `node_modules` size via
`Get-ChildItem -Recurse -File | Measure-Object -Property Length -Sum`
(PowerShell; `du` from Git Bash was too slow to finish inside a reasonable
timeout on this many small files under Windows/NTFS). No `install` was run
anywhere — where `node_modules` was already missing (`e2e`), that
package's size is reported as unmeasured rather than triggering an
install.

**Correction to AGENTS.md:** the docs say *"`reviewer-core/` is the only
package on npm ... every other package is pnpm."* That's no longer
accurate — `mcp` and `e2e` are also npm (`package-lock.json`), not pnpm.
Only `client`, `server`, and `evals` use `pnpm-lock.yaml`. Worth a doc fix.

## Package inventory & size

| Package | Manager | Direct deps (prod/dev) | `node_modules` size |
|---|---|---|---|
| `client` (`@devdigest/web`) | pnpm | 11 / 12 | 560.7 MB |
| `server` (`@devdigest/api`) | pnpm | 22 / 8 | 1,211.4 MB |
| `reviewer-core` (`@devdigest/reviewer-core`) | npm | 2 / 4 | 72.6 MB |
| `mcp` (`@devdigest/mcp`) | npm | 2 / 4 | 149.7 MB |
| `e2e` (`@devdigest/e2e`) | npm | 0 / 3 | **not measured** — `node_modules` absent, install was intentionally skipped |
| `evals` (`@devdigest/evals`) | pnpm | 2 / 5 | 322.9 MB |
| **Total measured** | | | **~2,317 MB (~2.26 GB)** |

Caveat: `client`, `server`, and `evals` use pnpm, which hardlinks packages
from a single global content-addressable store. The sizes above are the
*apparent* (logical) size of each `node_modules` tree; actual incremental
disk cost from adding these three packages is lower than the sum implies
because shared package versions aren't stored twice on disk. `reviewer-core`
and `mcp` (npm) don't get that benefit — their sizes are closer to true
marginal disk cost.

`server` is by far the heaviest package (1.2 GB) — largely explained by
`@ast-grep/napi` (native bindings), `@anthropic-ai/sdk`, `octokit`, and
`testcontainers`/`@testcontainers/postgresql` (pulls in a Docker client and
Testcontainers' own dependency tree, dev-only but heavy).

## Outdated packages

Version ranges for shared tooling are consistent across every package that
declares them — no cross-package drift. The gaps are all "haven't bumped
recently," not "different packages pinned differently."

**Repo-wide (every package that has it is behind by the same amount):**

| Package | Current | Latest | Gap |
|---|---|---|---|
| `typescript` (dev) | 5.9.3 | 7.0.2 | 2 majors |
| `@types/node` (dev) | ~22.19–22.20 | 26.2.0 | 4 majors |
| `vitest` (dev) | 2.1.9 | 4.1.11 | 2 majors — client/server/reviewer-core/mcp/evals (not `e2e`, which has no test runner) |
| `zod` | 3.25.76 | 4.4.3 | 1 major — client/server/reviewer-core/mcp |

**Per-package, notable:**

- `client`: `next` 15.5.19 → 16.3.1 (1 major; patch fix alone closes the CVEs, see below), `next-intl` 3.26.5 → 4.13.7 (1 major), `recharts` 2.15.4 → 3.10.1 (1 major), `lucide-react` 0.469.0 → 1.32.0 (0.x → 1.x), `mermaid` 11.15.0 → 11.16.1 (patch, closes a prototype-pollution advisory), `react`/`react-dom` 19.2.7 → 19.2.8 (patch).
- `server`: `@anthropic-ai/sdk` 0.33.1 → 0.117.1 (large gap within 0.x), `drizzle-orm` 0.38.4 → 0.45.2 (see security section — this one matters), `drizzle-kit` 0.30.6 → 0.31.10, `openai` 4.104.0 → 7.5.0 (3 majors), `octokit` 4.1.4 → 5.0.5 (1 major), `testcontainers`/`@testcontainers/postgresql` 10.28.0 → 12.1.0 (2 majors, dev-only).
- `reviewer-core` / `mcp`: only the repo-wide tooling gaps above (`openai` also outdated in `reviewer-core`: 4.104.0 → 7.5.0).
- `evals`: `openai` 4.104.0 → 7.5.0 (3 majors), `@anthropic-ai/claude-agent-sdk` 0.3.198 → 0.3.235 (minor, low urgency).
- `e2e`: derived from `package-lock.json` only, since `node_modules` isn't installed (unverified against an actual install): `tsx` 4.22.4 → 4.23.12, `typescript` 5.9.3 → 7.0.2, `@types/node` 22.19.21 → 26.2.0.

## Vulnerabilities

| Package | Total | Critical | High | Moderate | Low |
|---|---|---|---|---|---|
| `client` | 32 | 1 | 10 | 18 | 3 |
| `server` | 35 | 1 | 17 | 14 | 3 |
| `reviewer-core` | 8 | 1 | 4 | 3 | 0 |
| `mcp` | 5 | 1 | 1 | 3 | 0 |
| `evals` | 20 | 1 | 8 | 10 | 1 |
| `e2e`* | 1 | 0 | 0 | 0 | 1 |
| **Sum (not deduped)** | **101** | **5** | **40** | **48** | **8** |

\* `e2e`'s audit ran against `package-lock.json` only (`npm audit` doesn't
require `node_modules`) — not cross-checked against an actual install.

### The "5 criticals" are 1 issue, not 5

Every critical finding above is the same advisory: **`vitest` <3.2.6 —
"When Vitest UI server is listening, arbitrary file can be read and
executed"** (GHSA-5xrq-8626-4rwp). All five packages that declare
`vitest ^2.1.x` as a dev dependency (`client`, `server`, `reviewer-core`,
`mcp`, `evals`) get their own independent audit hit for it because there's
no shared lockfile to dedupe against. One `vitest` bump per package (or
better, a shared minimum version policy) clears all 5.

### Other high-severity findings worth acting on

- **`drizzle-orm` <0.45.2 (server, direct prod dep)** — SQL injection via
  improperly escaped SQL identifiers (GHSA-gpj5-g38j-94v9). Server is on
  0.38.4. This is the one finding in this whole audit that's both
  direct-dependency and prod-facing; prioritize it over the transitive
  dev-tooling noise below.
- **`next` <15.5.21 (client, direct prod dep)** — Server Actions DoS
  (GHSA-m99w-x7hq-7vfj) and SSRF on custom servers (GHSA-89xv-2m56-2m9x).
  Client is on 15.5.19; a patch bump (not the 16.x major) closes both.
- **`sharp` <0.35.0 (client, transitive via `next`)** — inherited libvips
  CVEs (CVE-2026-33327/33328/35590/35591).
- **`undici` (server, transitive via `testcontainers`)** — WebSocket
  unbounded memory consumption, Set-Cookie SameSite downgrade, HTTP
  response queue poisoning. All dev-only (testcontainers is a devDependency)
  but worth a bump since it's low-cost.
- **`vite` <=6.4.2 (client/reviewer-core/mcp/evals, transitive via
  vitest)** — `server.fs.deny` bypass **specifically on Windows alternate
  paths** (GHSA-fx2h-pf6j-xcff), which is directly relevant since this repo
  runs its dev servers on Windows.
- **`hono` chain (evals, transitive via `@anthropic-ai/claude-agent-sdk` →
  `@modelcontextprotocol/sdk`)** — several advisories (prototype pollution,
  algorithmic-complexity DoS, `serve-static` path traversal on Windows via
  encoded backslash). All dev/tooling surface, not runtime-reachable from
  the app, but the Windows path-traversal one pairs badly with the vite
  finding above if anyone spins up local MCP tooling.
- **`form-data` 4.0.0–4.0.5 (client via `jsdom`, reviewer-core direct)** —
  CRLF injection via unescaped multipart field/filenames.
- Most of the remaining "moderate" volume in every package is the same
  `esbuild`/`vite`/`vite-node`/`@vitest/mocker` chain hanging off the
  outdated `vitest` — bumping `vitest` to 4.x clears the bulk of it in one
  move per package.

## Bottom line / suggested order of operations

1. `server`: bump `drizzle-orm` to `>=0.45.2` — closes the one prod-facing
   SQL-injection advisory in this audit.
2. `client`: bump `next` to `>=15.5.21` (stay on 15.x, don't need the 16.x
   major yet) — closes two high-severity advisories for a patch-level change.
3. Bump `vitest` to 4.x in `client`, `server`, `reviewer-core`, `mcp`,
   `evals` — clears the critical UI-server advisory plus most of the
   moderate `esbuild`/`vite` noise in one move, repeated per package (no
   shared lockfile to do it once).
4. Lower priority, batch when convenient: `typescript` → 7.x and
   `@types/node` → 26.x repo-wide (tooling only, no security impact found);
   `openai` SDK major bump in `server`/`reviewer-core`/`evals`; `zod` 4.x
   migration in `client`/`server`/`reviewer-core`/`mcp` (has breaking
   changes, budget real time for it).
5. `e2e`: install its dependencies at some point so its size and
   vulnerability posture can actually be verified instead of inferred from
   the lockfile.
