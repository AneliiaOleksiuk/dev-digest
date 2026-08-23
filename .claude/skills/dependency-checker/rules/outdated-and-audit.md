# Outdated versions & security audit

Both checks are plain CLI calls with JSON output — no bundled script needed,
just run the right command per package manager (see `discovery.md` for how
you already determined pnpm vs npm per package) and parse the JSON.

## Outdated

```
pnpm outdated --format json      # pnpm packages: client, server, evals (verify per-package, don't assume)
npm outdated --json              # npm packages: reviewer-core, mcp, e2e (verify per-package, don't assume)
```

Run from inside each package directory. Both commands **exit non-zero when
outdated packages exist** — that's their normal "found something" signal,
not a failure. Don't treat a non-zero exit code as an error; check whether
stdout parsed as valid JSON instead. A genuine failure (network down,
registry unreachable) usually produces no parseable JSON at all — in that
case, note in the report that the outdated check was skipped for that
package and why, rather than silently omitting it.

Each entry gives current vs. wanted (satisfies the declared range) vs.
latest (ignores the range) version. The gap that matters most for the
report is **current → latest major-version-behind** — a dependency stuck
several majors behind is a bigger latent-risk signal than one a patch
version behind.

## Security audit

```
pnpm audit --json      # pnpm packages
npm audit --json       # npm packages
```

Same exit-code caveat: both exit non-zero when vulnerabilities are found.
Parse JSON regardless of exit code.

This is a **basic, repo-wide sweep** meant to feed the size/outdated
report with one more prioritization signal (e.g. "this heavy, outdated
package also has a known high-severity advisory — fix that one first").
It is not a substitute for a dedicated security review — if the sweep
surfaces something that looks serious, point the user at this repo's
`security` skill or a proper audit rather than trying to triage the
vulnerability yourself here.

If a package's registry is unreachable (offline dev environment, corporate
proxy blocking the audit endpoint), report "audit skipped for `<package>`:
registry unreachable" for that package and move on — don't block the rest
of the report on one package's network failure.

## Cross-package version consistency

While you have `dependencies`/`devDependencies` loaded for every package
(from `discovery.md`'s pass), check for the same dependency name pinned to
materially different versions across packages — e.g. `zod` on `^3.24` in
one package and `^3.22` in another. This isn't wrong by itself, but it's
worth a line in the report: two copies of the same library at different
versions is a common source of "works on my package, not the other one"
bugs, and it's cheap to spot from data you already have.
