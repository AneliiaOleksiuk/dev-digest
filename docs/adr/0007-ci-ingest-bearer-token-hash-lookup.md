# ADR 0007: CI ingest authenticates via a single Bearer token hashed into a lookup key, not a separate installation-id header with a constant-time compare

- **Status:** Accepted (supersedes an in-flight design that shipped broken
  and was fixed before merge)
- **Date:** 2026-08-23
- **Context:** SPEC-04 — Export to CI (`specs/SPEC-04-export-to-ci.md`,
  decision D-1, acceptance criterion AC-51) — how `POST /ci/ingest`, the
  product's first unauthenticated-shaped write, proves a caller is entitled
  to write a CI run row for one specific installation

## Context

`POST /ci/ingest` is structurally different from every other route in this
codebase: it has no human session to resolve tenancy from. Every other route
calls `getContext(app.container, req)` and derives the workspace from a
logged-in user; the CI job that calls this endpoint is a `curl` command
running inside a stranger's GitHub Actions runner, authenticated by nothing
but a value pasted into that repo's own Actions secrets at Install time
(`DEVDIGEST_INGEST_TOKEN`). Whatever this endpoint accepts as proof of
identity **is** the entire tenancy derivation — a bug here is not an IDOR
against a logged-in user, it is an unauthenticated cross-workspace write
(`E-23`).

The Spec's original design (AC-51, D-1, as first written) specified two
things arriving together: a header naming *which* installation was posting,
and a **separate**, constant-time comparison of the presented token against
that installation's stored hash — a "look up by id, then verify by
constant-time compare" shape, modeled on a typical API-key pattern where the
key's prefix or a companion id narrows the search before the secret itself
is checked.

That design could not be implemented as specified, for a reason specific to
this feature's own AC-5: **Preview must produce byte-identical files to what
Install later commits.** Preview runs before any installation exists at
all — there is no installation id yet to bake into the generated workflow at
generation time, and no later step is allowed to change the workflow's bytes
between Preview and Install without breaking AC-5. The generated workflow
therefore had no way to carry a separate installation-identifying value, and
the first implementation shipped with the ingest endpoint reading two custom
headers (`x-devdigest-installation` / `x-devdigest-token`) that the generator
never actually emitted — the ingest path could never authenticate against a
real CI run in production. `plan-verifier`'s Phase 1 audit caught this before
merge; it was fixed in fix-loop iteration 1, and the Spec's AC-51 and D-1
were amended afterward (`b2117f5`) to describe the design actually shipped,
rather than leaving the superseded text as the record of intent.

## Decision

**Authenticate with a single `Authorization: Bearer <token>` header. Hash
the presented token with SHA-256 and look it up directly against
`ci_installations.token_hash` — the hash-keyed lookup itself is the
authentication.** No separate installation-identifying header exists
anywhere in the design; no constant-time comparison is performed.

```ts
const token = parseBearerToken(authorizationHeader);
const hash = createHash('sha256').update(token, 'utf8').digest('hex');
const installation = await this.repo.findInstallationByTokenHash(hash);
if (!installation) throw new UnauthorizedError(...);   // 401, writes nothing
```

(`server/src/modules/ci/service.ts`'s `ingest`; the lookup itself is
`findInstallationByTokenHash` in `repository.drizzle.ts`, backed by a plain,
non-unique index on `token_hash` in `server/src/db/schema/ci.ts`.) The
generated workflow's reporting step sends exactly this header shape
(`workflow.ts`'s `reportScript`), and needed no change to align with the
fix — only the ingest endpoint's own reading of the request changed.

## Rationale

- **A separate installation id was never load-bearing for security — it was
  only ever a search-narrowing convenience — and this feature has no place
  to put it before Install exists.** AC-5's byte-identity requirement rules
  out baking an installation id into the workflow at Preview time. Since the
  design has to work without one, the simplest correct alternative is to
  make the secret itself the whole lookup key.
- **A hash-keyed lookup needs no constant-time comparison to be safe, and
  this is not a coincidence worth glossing over.** `timingSafeEqual`/
  constant-time comparison defends against an attacker who controls one side
  of an explicit byte-by-byte buffer comparison and can observe how far it
  gets before it bails out on a mismatch — that signal only exists when the
  comparison itself is byte-by-byte and its early-exit point is observable.
  A `WHERE token_hash = $1` lookup against an indexed column is not a
  byte-by-byte comparison from the caller's perspective: Postgres resolves
  it via the index in essentially the same time whether zero rows match (a
  wrong guess) or one row matches (the right guess) — there is no partial-
  match signal for an attacker to narrow in on incrementally. The 256-bit
  token space (`INGEST_TOKEN_BYTES = 32`) also makes a blind guess
  computationally infeasible regardless of timing precision, but that is a
  backstop, not the reason this is safe — the reason is that there is no
  incremental signal to time in the first place.
- **The plaintext token is never persisted, only its hash** — unchanged from
  the original design and not affected by this fix. `ci_installations
  .token_hash` stores `sha256(token)`; the plaintext exists only in the
  immediate Install response (`CiExport.ingest_token`), shown once, never
  re-fetchable, never logged.
- **This keeps the module's stated simplicity constraint** ("Ingest auth is
  a shared secret and nothing else… no signing, no JWT, no key rotation, no
  nonce, no replay window") **honest rather than aspirational.** The original
  two-header design was already a small step toward a heavier mechanism (a
  companion identifier alongside the secret); the fix moves toward, not away
  from, the stated v1 scope.

## Consequences

- **The blast radius of a leaked token is unchanged from the original
  intent**, and is bounded the same way either design would have bounded it:
  the token authorizes writing CI run rows for **one** installation and
  nothing else (AC-52) — it cannot read, cannot export, cannot reach another
  workspace. v1 still has no rotation or revocation; the documented remedy
  is still delete-the-installation-and-re-export (Q-6, made executable by
  `DELETE /ci/installations/:id`, which this decision did not need to
  touch).
- **`token_hash` is intentionally not a unique index.** A hash collision is
  not this feature's threat model (SHA-256 over a 256-bit random input); a
  plain index is enough for the lookup's performance and correctness.
- **The zod body-validation ordering became load-bearing in a way it wasn't
  before.** Because the auth check is now the *only* gate before tenancy is
  known, `POST /ci/ingest` deliberately does not declare a Fastify route
  `schema.body` (unlike every other route in this codebase) — that would run
  automatic validation *before* the handler, which would validate an
  unauthenticated caller's body before the header check ever ran.
  `CiService.ingest` performs the zod parse itself, strictly after the auth
  check succeeds, so an unauthenticated caller learns nothing about whether
  their body would even have been well-formed.
- **This class of bug — a shared invariant expressed in two places that can
  independently drift — recurred exactly once even with Recommendation 2's
  discipline in force.** The generator (`workflow.ts`) and the ingest
  endpoint's header contract were the one pair of "must agree" values *not*
  backed by a single shared constant, and they silently disagreed until
  `plan-verifier`'s audit caught it. The fix did not introduce a new shared
  constant for this pair either — flagged in the Development Plan's Risks
  section as a standing structural risk, not fully closed, and worth
  re-raising the next time this module is touched.
- **A future reader must not "restore" the two-header shape** believing it
  is more secure — it is not implementable given AC-5's constraint, and the
  single-header hash-keyed lookup carries no known weaker property than the
  originally-specified design once the timing-analysis reasoning above is
  accounted for.

## Alternatives considered

1. **The originally-specified installation-id header + constant-time
   compare.** Rejected — not a security downgrade to abandon, but a design
   that cannot be implemented at all given AC-5's Preview/Install
   byte-identity requirement, since no installation exists at Preview time
   to name in the generated workflow.
2. **Carry the installation id as a query parameter or path segment on the
   ingest URL instead of a header** (e.g. `POST /ci/ingest/:installationId`),
   set only once Install knows the installation's id, with the *workflow's
   ingest URL* baked in at Install time rather than at Preview/generation
   time. Considered and rejected: it would still require the ingest URL
   itself (which the generator does emit, into `env.INGEST_URL`) to differ
   between what Preview shows and what Install commits, which is exactly
   what AC-5 forbids — Preview and Install must produce byte-identical
   files, and the ingest URL is one of those file's contents.
3. **A stateless signed token (JWT or HMAC) encoding the installation id,
   verified without a database lookup.** Out of scope by D-1's explicit
   "no signing, no JWT" simplicity constraint, and would not have avoided
   the core problem — the signed token would still need to be generated at
   Install time (once an installation exists), and the same
   Preview/Install byte-identity constraint would apply to whatever the
   generated workflow embeds as its credential reference.
